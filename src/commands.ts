import { writeFileSync, statSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { SessionStore } from "./session.js";
import { renderHistory, createStreamRenderer } from "./render.js";
import { copyToClipboard } from "./clipboard.js";
import { editInExternal } from "./editor.js";
import { chatStream, type Usage } from "./llm.js";
import { formatApiError } from "./errors.js";
import type OpenAI from "openai";

export interface SessionUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface CommandContext {
  history: OpenAI.ChatCompletionMessageParam[];
  store: SessionStore;
  systemMsg: OpenAI.ChatCompletionMessageParam;
  sessionUsage: SessionUsage;
  setStore(s: SessionStore): void;
}

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  // 返回 string → 主循环把它当成本轮 user 输入(走 expandAtRefs + agentRun)
  // 返回 void / undefined → 命令自己处理完了
  run(args: string, ctx: CommandContext): Promise<string | void> | string | void;
}

const registry = new Map<string, SlashCommand>();

export function registerCommand(c: SlashCommand): void {
  registry.set(c.name, c);
}

export function getCommand(name: string): SlashCommand | undefined {
  return registry.get(name);
}

export function allCommands(): SlashCommand[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

registerCommand({
  name: "new",
  description: "创建新会话",
  run(_args, ctx) {
    const store = SessionStore.create();
    ctx.setStore(store);
    ctx.history.length = 0;
    ctx.history.push(ctx.systemMsg);
    store.append(ctx.systemMsg);
    console.log(pc.cyan(`新会话 ${store.id.slice(0, 8)}`));
    console.log(pc.dim(`session: ${store.file}`));
  },
});

registerCommand({
  name: "list",
  description: "列出本项目下所有历史会话",
  run() {
    const sessions = SessionStore.list();
    if (sessions.length === 0) {
      console.log(pc.dim("(无历史)"));
      return;
    }
    for (const s of sessions) {
      console.log(
        `${pc.green(s.id.slice(0, 8))}  ${s.mtime.toLocaleString()}  ${pc.dim(s.preview)}`,
      );
    }
  },
});

registerCommand({
  name: "load",
  description: "加载指定会话",
  usage: "/load <id前8位>",
  run(args, ctx) {
    const id = args.trim();
    if (!id) {
      console.log(pc.red("用法: /load <id前8位>"));
      return;
    }
    try {
      const loaded = SessionStore.load(id);
      ctx.setStore(loaded.store);
      ctx.history.length = 0;
      ctx.history.push(...loaded.messages);
      console.log(
        pc.cyan(`已加载 ${loaded.store.id.slice(0, 8)} (${ctx.history.length} 条)`),
      );
      renderHistory(ctx.history);
    } catch (e: any) {
      console.log(pc.red(e.message));
    }
  },
});

registerCommand({
  name: "clear",
  description: "清空当前上下文,保留 system prompt",
  run(_args, ctx) {
    ctx.history.length = 0;
    ctx.history.push(ctx.systemMsg);
    console.log(pc.cyan("已清空上下文"));
  },
});

registerCommand({
  name: "help",
  description: "显示本帮助",
  run() {
    const cmds = allCommands();
    const widths = cmds.map((c) => (c.usage ?? `/${c.name}`).length);
    const colWidth = Math.max(...widths, 8) + 2;
    console.log(pc.cyan("可用命令:"));
    for (const c of cmds) {
      const head = (c.usage ?? `/${c.name}`).padEnd(colWidth);
      console.log(`  ${pc.green(head)}${c.description}`);
    }
    console.log(pc.dim("提示: 输入 / 后按 Tab 可补全命令名;输入 @ 后按 Tab 可补全文件路径;以 ! 开头直接执行 shell;行尾打 \\ 回车可多行续写。"));
  },
});

function contentToText(content: OpenAI.ChatCompletionMessageParam["content"]): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (part?.type === "refusal" && typeof part.refusal === "string") return part.refusal;
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

function lastAssistantText(
  history: OpenAI.ChatCompletionMessageParam[],
): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    const text = contentToText(m.content);
    if (text.trim()) return text;
  }
  return null;
}

function defaultExportFilename(sessionId: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `rehudex-export-${sessionId.slice(0, 8)}-${ts}.md`;
}

function resolveExportPath(arg: string, sessionId: string): string {
  if (!arg) return path.resolve(process.cwd(), defaultExportFilename(sessionId));
  const looksLikeDir = arg.endsWith("/") || arg.endsWith("\\");
  const abs = path.resolve(arg);
  let isDir = false;
  if (looksLikeDir) {
    isDir = true;
  } else {
    try {
      isDir = statSync(abs).isDirectory();
    } catch {
      isDir = false;
    }
  }
  return isDir ? path.join(abs, defaultExportFilename(sessionId)) : abs;
}

function serializeHistory(
  history: OpenAI.ChatCompletionMessageParam[],
  store: SessionStore,
): string {
  const toolCallNames = new Map<string, string>();
  for (const m of history) {
    if (m.role === "assistant" && (m as any).tool_calls) {
      for (const call of (m as any).tool_calls) {
        if (call?.type === "function" && call?.id) {
          toolCallNames.set(call.id, call.function?.name ?? "?");
        }
      }
    }
  }

  const lines: string[] = [];
  lines.push(`# 会话 ${store.id.slice(0, 8)} — 导出于 ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`> session 文件:\`${store.file}\``);
  lines.push("");

  for (const m of history) {
    if (m.role === "system") continue;
    const text = contentToText(m.content);

    if (m.role === "user") {
      lines.push("## 👤 用户");
      lines.push("");
      lines.push(text);
      lines.push("");
    } else if (m.role === "assistant") {
      lines.push("## 🤖 助手");
      lines.push("");
      if (text) {
        lines.push(text);
        lines.push("");
      }
      const calls = (m as any).tool_calls as
        | OpenAI.ChatCompletionMessageToolCall[]
        | undefined;
      if (calls?.length) {
        lines.push("<details><summary>⚙ 工具调用</summary>");
        lines.push("");
        lines.push("```json");
        for (const c of calls) {
          if (c.type === "function") {
            lines.push(JSON.stringify({ name: c.function.name, arguments: c.function.arguments }));
          }
        }
        lines.push("```");
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
    } else if (m.role === "tool") {
      const id = (m as any).tool_call_id as string | undefined;
      const name = id ? toolCallNames.get(id) ?? "工具" : "工具";
      lines.push(`## 🛠 工具结果 (${name})`);
      lines.push("");
      lines.push("```");
      lines.push(text);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

registerCommand({
  name: "export",
  description: "导出当前对话为 Markdown 文件",
  usage: "/export [path]",
  run(args, ctx) {
    const file = resolveExportPath(args.trim(), ctx.store.id);
    try {
      const md = serializeHistory(ctx.history, ctx.store);
      writeFileSync(file, md, "utf8");
      console.log(pc.cyan(`已导出 → ${file}`));
    } catch (e: any) {
      console.log(pc.red(`导出失败: ${e.message}`));
    }
  },
});

registerCommand({
  name: "copy",
  description: "复制最近一条 LLM 回答到剪贴板",
  async run(_args, ctx) {
    const text = lastAssistantText(ctx.history);
    if (!text) {
      console.log(pc.yellow("没有可复制的回答"));
      return;
    }
    try {
      await copyToClipboard(text);
      console.log(pc.cyan(`已复制最近一条回答 (${text.length} 字符)`));
    } catch (e: any) {
      console.log(pc.red(`剪贴板写入失败: ${e.message}`));
    }
  },
});

registerCommand({
  name: "edit",
  description: "在 $EDITOR 中编辑长输入并发送",
  usage: "/edit",
  async run() {
    try {
      const content = await editInExternal();
      if (!content) {
        console.log(pc.dim("(空输入,已取消)"));
        return;
      }
      return content; // 主循环把它当本轮 user 输入,走 expandAtRefs + agentRun
    } catch (e: any) {
      console.log(pc.red(`编辑器启动失败: ${e.message}`));
    }
  },
});

const COMPACT_PROMPT = `请把上面这段助手与用户的对话压缩为一段中文摘要,保留:
- 已确认的事实、结论、决定
- 已修改/创建的文件路径与关键代码定位
- 用户的偏好与明确要求
- 尚未完成或被搁置的事项
丢弃寒暄、思考过程、工具的原始 stdout 与冗余信息。控制在 500 字以内,直接输出摘要正文,不要前后铺垫。`;

registerCommand({
  name: "compact",
  description: "用 LLM 摘要当前上下文,压缩 history(JSONL 文件保留完整原始记录)",
  async run(_args, ctx) {
    if (ctx.history.length <= 1) {
      console.log(pc.dim("(空对话,无需压缩)"));
      return;
    }
    // 准备 LLM 输入:保留 systemMsg + 现有 history(除 system) + 摘要要求
    const ask: OpenAI.ChatCompletionMessageParam = {
      role: "user",
      content: COMPACT_PROMPT,
    };
    const input = [...ctx.history, ask];

    console.log(pc.cyan("[摘要]"));
    const renderer = createStreamRenderer();
    let total: Usage | null = null;
    try {
      const { message, usage } = await chatStream(input, undefined, (t) => renderer.write(t));
      renderer.finish();
      total = usage;
      const summary =
        typeof message.content === "string" ? message.content : "";
      if (!summary.trim()) {
        console.log(pc.yellow("(模型未返回摘要,放弃压缩)"));
        return;
      }
      const before = ctx.history.length;
      const summaryMsg: OpenAI.ChatCompletionMessageParam = {
        role: "user",
        content: `[历史摘要]\n${summary}`,
      };
      // 截断内存 history,JSONL 文件保留原始记录;摘要也 append 到 store
      ctx.history.length = 0;
      ctx.history.push(ctx.systemMsg, summaryMsg);
      ctx.store.append(summaryMsg);
      // 重置累计 usage(摘要后的新一轮 prompt_tokens 会重新计算)
      ctx.sessionUsage.prompt = 0;
      ctx.sessionUsage.completion = 0;
      ctx.sessionUsage.total = 0;
      console.log(
        pc.cyan(
          `已压缩:${before} 条 → 2 条;摘要 ${summary.length} 字符` +
            (total ? `,本次摘要消耗 ${total.total} tokens` : ""),
        ),
      );
    } catch (err) {
      renderer.reset();
      console.log(pc.red(`✖ 摘要失败: ${formatApiError(err)}`));
    }
  },
});

