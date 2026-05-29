import { writeFileSync, statSync } from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { SessionStore } from "./session.js";
import { renderHistory, createStreamRenderer } from "./render.js";
import { copyToClipboard } from "./clipboard.js";
import { editInExternal } from "./editor.js";
import { chatStream, type Usage } from "./llm.js";
import { formatApiError } from "./errors.js";
import { listSkills, getSkill, loadSkills } from "./skills.js";
import type OpenAI from "openai";
import type { UiAdapter } from "./ui/index.js";

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
  ui: UiAdapter;
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
    ctx.ui.emit({ type: "info", data: `新会话 ${store.id.slice(0, 8)}` });
    ctx.ui.emit({ type: "status", data: `session: ${store.file}` });
  },
});

registerCommand({
  name: "list",
  description: "列出本项目下所有历史会话",
  run(_args, ctx) {
    const sessions = SessionStore.list();
    if (sessions.length === 0) {
      ctx.ui.emit({ type: "info", data: "(无历史)" });
      return;
    }
    const lines: string[] = [];
    for (const s of sessions) {
      lines.push(`${s.id.slice(0, 8)}  ${s.mtime.toLocaleString()}  ${s.preview}`);
    }
    ctx.ui.emit({ type: "info", data: lines.join("\n") });
  },
});

registerCommand({
  name: "load",
  description: "加载指定会话",
  usage: "/load <id前8位>",
  run(args, ctx) {
    const id = args.trim();
    if (!id) {
      ctx.ui.emit({ type: "error", data: "用法: /load <id前8位>" });
      return;
    }
    try {
      const loaded = SessionStore.load(id);
      ctx.setStore(loaded.store);
      ctx.history.length = 0;
      ctx.history.push(...loaded.messages);
      ctx.ui.emit({
        type: "info",
        data: `已加载 ${loaded.store.id.slice(0, 8)} (${ctx.history.length} 条)`,
      });
      ctx.ui.renderHistory(ctx.history);
    } catch (e: any) {
      ctx.ui.emit({ type: "error", data: e.message });
    }
  },
});

registerCommand({
  name: "clear",
  description: "清空当前上下文,保留 system prompt",
  run(_args, ctx) {
    ctx.history.length = 0;
    ctx.history.push(ctx.systemMsg);
    ctx.ui.emit({ type: "info", data: "已清空上下文" });
  },
});

registerCommand({
  name: "help",
  description: "显示本帮助",
  run(_args, ctx) {
    const cmds = allCommands();
    const widths = cmds.map((c) => (c.usage ?? `/${c.name}`).length);
    const colWidth = Math.max(...widths, 8) + 2;
    const lines: string[] = ["可用命令:"];
    for (const c of cmds) {
      const head = (c.usage ?? `/${c.name}`).padEnd(colWidth);
      lines.push(`  ${head}${c.description}`);
    }
    lines.push("");
    lines.push("提示: Ctrl+Y 切换 YOLO;输入 / 后按 Tab 可补全命令名;输入 @ 后按 Tab 可补全文件路径;以 ! 开头直接执行 shell;行尾打 \\ 回车可多行续写。");
    ctx.ui.emit({ type: "info", data: lines.join("\n") });
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
      ctx.ui.emit({ type: "info", data: `已导出 → ${file}` });
    } catch (e: any) {
      ctx.ui.emit({ type: "error", data: `导出失败: ${e.message}` });
    }
  },
});

registerCommand({
  name: "copy",
  description: "复制最近一条 LLM 回答到剪贴板",
  async run(_args, ctx) {
    const text = lastAssistantText(ctx.history);
    if (!text) {
      ctx.ui.emit({ type: "warning", data: "没有可复制的回答" });
      return;
    }
    try {
      await copyToClipboard(text);
      ctx.ui.emit({
        type: "info",
        data: `已复制最近一条回答 (${text.length} 字符)`,
      });
    } catch (e: any) {
      ctx.ui.emit({ type: "error", data: `剪贴板写入失败: ${e.message}` });
    }
  },
});

registerCommand({
  name: "edit",
  description: "在 $EDITOR 中编辑长输入并发送",
  usage: "/edit",
  async run(_args, ctx) {
    try {
      await ctx.ui.suspend();
      const content = await editInExternal();
      await ctx.ui.resume();
      if (!content) {
        ctx.ui.emit({ type: "info", data: "(空输入,已取消)" });
        return;
      }
      return content;
    } catch (e: any) {
      await ctx.ui.resume();
      ctx.ui.emit({ type: "error", data: `编辑器启动失败: ${e.message}` });
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
      ctx.ui.emit({ type: "info", data: "(空对话,无需压缩)" });
      return;
    }
    const ask: OpenAI.ChatCompletionMessageParam = {
      role: "user",
      content: COMPACT_PROMPT,
    };
    const input = [...ctx.history, ask];

    ctx.ui.emit({ type: "info", data: "[摘要]" });
    const renderer = ctx.ui.ownsStreamRendering ? null : createStreamRenderer();
    let total: Usage | null = null;
    try {
      const { message, usage } = await chatStream(input, undefined, (t) => {
        if (renderer) renderer.write(t);
        else ctx.ui.emit({ type: "assistantDelta", data: t });
      });
      if (renderer) renderer.finish();
      else ctx.ui.emit({ type: "assistantDone" });
      total = usage;
      const summary = typeof message.content === "string" ? message.content : "";
      if (!summary.trim()) {
        ctx.ui.emit({ type: "warning", data: "(模型未返回摘要,放弃压缩)" });
        return;
      }
      const before = ctx.history.length;
      const summaryMsg: OpenAI.ChatCompletionMessageParam = {
        role: "user",
        content: `[历史摘要]\n${summary}`,
      };
      ctx.history.length = 0;
      ctx.history.push(ctx.systemMsg, summaryMsg);
      ctx.store.append(summaryMsg);
      ctx.sessionUsage.prompt = 0;
      ctx.sessionUsage.completion = 0;
      ctx.sessionUsage.total = 0;
      ctx.ui.emit({
        type: "info",
        data:
          `已压缩:${before} 条 → 2 条;摘要 ${summary.length} 字符` +
          (total ? `,本次摘要消耗 ${total.total} tokens` : ""),
      });
    } catch (err) {
      if (renderer) renderer.reset();
      ctx.ui.emit({ type: "error", data: `✖ 摘要失败: ${formatApiError(err)}` });
    }
  },
});

registerCommand({
  name: "skills",
  description: "列出所有可用 skill",
  run(_args, ctx) {
    const list = listSkills();
    if (list.length === 0) {
      ctx.ui.emit({
        type: "info",
        data: "(无 skill)。可在 ~/.rehudex/skills/、./.rehudex/skills/、./.claude/skills/ 下创建 <name>/SKILL.md",
      });
      return;
    }
    const lines = list.map(
      (s) => `  /skill ${s.name}  [${s.source}]  ${s.description || "(无描述)"}`,
    );
    ctx.ui.emit({ type: "info", data: `可用 skill (${list.length}):\n${lines.join("\n")}` });
  },
});

registerCommand({
  name: "skill",
  description: "调用某个 skill,把 SKILL.md 注入对话",
  usage: "/skill <name> | /skill list | /skill reload",
  run(args, ctx) {
    const name = args.trim();
    if (!name || name === "list") {
      const list = listSkills();
      if (list.length === 0) {
        ctx.ui.emit({
          type: "info",
          data: "(无 skill)。可在 ~/.rehudex/skills/、./.rehudex/skills/、./.claude/skills/ 下创建 <name>/SKILL.md",
        });
        return;
      }
      const lines = list.map(
        (s) => `  /skill ${s.name}  [${s.source}]  ${s.description || "(无描述)"}`,
      );
      ctx.ui.emit({ type: "info", data: `可用 skill (${list.length}):\n${lines.join("\n")}` });
      return;
    }
    if (name === "reload") {
      const m = loadSkills();
      ctx.ui.emit({ type: "info", data: `已重新加载 skill,共 ${m.size} 个` });
      return;
    }
    const sk = getSkill(name);
    if (!sk) {
      ctx.ui.emit({ type: "error", data: `未找到 skill: ${name}(用 /skills 查看可用列表)` });
      return;
    }
    const scriptList = sk.scripts.length
      ? `\n可用脚本(可通过 execute_shell 调用以下绝对路径):\n${sk.scripts.map((p) => "- " + p).join("\n")}\n`
      : "";
    const allowedHint = sk.allowedTools?.length
      ? `\n建议仅使用工具: ${sk.allowedTools.join(", ")}\n`
      : "";
    ctx.ui.emit({ type: "info", data: `[skill] 注入 ${sk.name} (${sk.source})` });
    return `[skill: ${sk.name}] ${sk.description}${allowedHint}${scriptList}\n${sk.body}`;
  },
});

