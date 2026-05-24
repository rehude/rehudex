import pc from "picocolors";
import { SessionStore } from "./session.js";
import { renderHistory } from "./render.js";
import type OpenAI from "openai";

export interface CommandContext {
  history: OpenAI.ChatCompletionMessageParam[];
  store: SessionStore;
  systemMsg: OpenAI.ChatCompletionMessageParam;
  setStore(s: SessionStore): void;
}

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  run(args: string, ctx: CommandContext): Promise<void> | void;
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
    console.log(pc.dim("提示: 输入 / 后按 Tab 可补全命令名;输入 @ 后按 Tab 可补全文件路径;以 ! 开头直接执行 shell。"));
  },
});
