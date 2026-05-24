import pc from "picocolors";
import { agentRun } from "./agent.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { registerTool } from "./tools/index.js";
import { readFile } from "./tools/readFile.js";
import { writeFile } from "./tools/writeFile.js";
import { shell } from "./tools/shell.js";
import { getRL, closeRL } from "./cli.js";
import { SessionStore } from "./session.js";
import { renderHistory } from "./render.js";
import type OpenAI from "openai";

registerTool(readFile);
registerTool(writeFile);
registerTool(shell);

const rl = getRL();

const continueLast = process.argv.slice(2).includes("-c");
const systemMsg: OpenAI.ChatCompletionMessageParam = {
  role: "system",
  content: SYSTEM_PROMPT,
};

let store: SessionStore;
let history: OpenAI.ChatCompletionMessageParam[];

if (continueLast) {
  const latest = SessionStore.loadLatest();
  if (latest) {
    store = latest.store;
    history = latest.messages;
    console.log(
      pc.cyan(`续接会话 ${store.id.slice(0, 8)} (${history.length} 条消息)`),
    );
    renderHistory(history);
  } else {
    console.log(pc.yellow("本项目无历史会话,创建新会话"));
    store = SessionStore.create();
    history = [systemMsg];
    store.append(systemMsg);
  }
} else {
  store = SessionStore.create();
  history = [systemMsg];
  store.append(systemMsg);
}
console.log(pc.dim(`session: ${store.file}`));

const sessionUsage = { prompt: 0, completion: 0, total: 0 };
let closed = false;

const shutdown = (code = 0) => {
  if (closed) return;
  closed = true;
  if (sessionUsage.total > 0) {
    console.log(
      pc.dim(
        `\n本次会话累计 token:prompt=${sessionUsage.prompt} completion=${sessionUsage.completion} total=${sessionUsage.total}`,
      ),
    );
  }
  console.log(pc.cyan("再见 👋"));
  closeRL();
  process.exit(code);
};

rl.on("SIGINT", () => shutdown(0));
rl.on("close", () => {
  if (!closed) shutdown(0);
});

console.log(pc.cyan("easyAgent v0.2 — 输入 exit 或按 Ctrl+C 退出"));
console.log(pc.dim("命令: /new 新会话 | /list 列出 | /load <id前8位> 加载"));
while (!closed) {
  let input: string;
  try {
    input = (await rl.question(pc.green("> "))).trim();
  } catch {
    break;
  }
  if (closed) break;
  if (!input) continue;
  if (input === "exit") {
    shutdown(0);
    break;
  }

  if (input === "/new") {
    store = SessionStore.create();
    history.length = 0;
    history.push(systemMsg);
    store.append(systemMsg);
    console.log(pc.cyan(`新会话 ${store.id.slice(0, 8)}`));
    console.log(pc.dim(`session: ${store.file}`));
    continue;
  }

  if (input === "/list") {
    const sessions = SessionStore.list();
    if (sessions.length === 0) {
      console.log(pc.dim("(无历史)"));
    } else {
      for (const s of sessions) {
        console.log(
          `${pc.green(s.id.slice(0, 8))}  ${s.mtime.toLocaleString()}  ${pc.dim(s.preview)}`,
        );
      }
    }
    continue;
  }

  if (input.startsWith("/load ")) {
    const id = input.slice(6).trim();
    try {
      const loaded = SessionStore.load(id);
      store = loaded.store;
      history.length = 0;
      history.push(...loaded.messages);
      console.log(
        pc.cyan(`已加载 ${store.id.slice(0, 8)} (${history.length} 条)`),
      );
      renderHistory(history);
    } catch (e: any) {
      console.log(pc.red(e.message));
    }
    continue;
  }

  const { usage } = await agentRun(input, history, store);
  if (usage.total > 0) {
    sessionUsage.prompt += usage.prompt;
    sessionUsage.completion += usage.completion;
    sessionUsage.total += usage.total;
    console.log(
      pc.dim(`(本轮 ${usage.total} / 累计 ${sessionUsage.total} tokens)`),
    );
  }
}
