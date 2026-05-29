#!/usr/bin/env node
import "./proxy.js";
import pc from "picocolors";
import { agentRun } from "./agent.js";
import { buildSystemPrompt } from "./prompts.js";
import { registerTool } from "./tools/index.js";
import { readFile } from "./tools/readFile.js";
import { writeFile } from "./tools/writeFile.js";
import { shell } from "./tools/shell.js";
import { editFile } from "./tools/editFile.js";
import { grep } from "./tools/grep.js";
import { glob } from "./tools/glob.js";
import { askUser } from "./tools/askUser.js";
import { getRL } from "./cli.js";
import { SessionStore } from "./session.js";
import { getCommand, type CommandContext } from "./commands.js";
import { buildCompleter, expandAtRefs } from "./completer.js";
import { runShell, CURRENT_SHELL } from "./shellExec.js";
import { createUiAdapter, type UiType } from "./ui/index.js";
import { setCurrentUi } from "./ui/current.js";
import type OpenAI from "openai";

// 解析命令行参数
function parseArgs(argv: string[]): { uiType: UiType; continueLast: boolean; help: boolean } {
  const args = argv.slice(2);
  let uiType: UiType = "classic";
  let continueLast = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--ui" && i + 1 < args.length) {
      const val = args[++i];
      if (val === "classic" || val === "ink") {
        uiType = val;
      } else {
        console.error(pc.red(`❌ 未知的 UI 类型: ${val}`));
        console.error(`   支持的值: classic, ink`);
        process.exit(1);
      }
    } else if (arg === "-c") {
      continueLast = true;
    }
  }

  return { uiType, continueLast, help };
}

function showHelp(): void {
  console.log(pc.cyan("rehudex v0.4 — AI 终端助手"));
  console.log("");
  console.log("用法:");
  console.log(`  rehudex [选项]`);
  console.log("");
  console.log("选项:");
  console.log(`  -c, --continue       续接最后一个会话`);
  console.log(`  --ui <type>          选择 UI (classic|ink, 默认 classic)`);
  console.log(`  -h, --help           显示本帮助`);
  console.log("");
  console.log("示例:");
  console.log(`  rehudex              启动新会话，使用 classic UI`);
  console.log(`  rehudex -c           续接会话，使用 classic UI`);
  console.log(`  rehudex --ui ink     启动新会话，使用 Ink UI (实验)`);
}

const { uiType, continueLast, help } = parseArgs(process.argv);

if (help) {
  showHelp();
  process.exit(0);
}

registerTool(readFile);
registerTool(writeFile);
registerTool(shell);
registerTool(editFile);
registerTool(grep);
registerTool(glob);
registerTool(askUser);

// 非 TTY 环境下强制使用 classic UI（或者可选择简化输出）
const effectiveUiType: UiType = !process.stdout.isTTY ? "classic" : uiType;
if (!process.stdout.isTTY && uiType !== "classic") {
  console.warn(pc.yellow(`⚠ 非交互终端下不支持 Ink UI，强制改用 classic`));
}

const ui = await createUiAdapter(effectiveUiType);
setCurrentUi(ui);
// classic UI 复用 readline,Ink 自己接管 stdin 因此跳过 getRL
const rl = effectiveUiType === "classic" ? getRL(buildCompleter()) : null;

// 先启动 UI,确保 Ink App 已订阅事件总线后再 emit 初始状态和历史。
await ui.start();

const systemMsg: OpenAI.ChatCompletionMessageParam = {
  role: "system",
  content: buildSystemPrompt(),
};

let store: SessionStore;
let history: OpenAI.ChatCompletionMessageParam[];

if (continueLast) {
  const latest = SessionStore.loadLatest();
  if (latest) {
    store = latest.store;
    history = latest.messages;
    ui.emit({
      type: "info",
      data: `续接会话 ${store.id.slice(0, 8)} (${history.length} 条消息)`,
    });
    ui.renderHistory(history);
  } else {
    ui.emit({
      type: "warning",
      data: "本项目无历史会话,创建新会话",
    });
    store = SessionStore.create();
    history = [systemMsg];
    store.append(systemMsg);
  }
} else {
  store = SessionStore.create();
  history = [systemMsg];
  store.append(systemMsg);
}
ui.emit({ type: "status", data: `session: ${store.file}` });

const sessionUsage = { prompt: 0, completion: 0, total: 0 };
let closed = false;

const shutdown = async (code = 0) => {
  if (closed) return;
  closed = true;
  if (sessionUsage.total > 0) {
    ui.emit({
      type: "status",
      data: `本次会话累计 token:prompt=${sessionUsage.prompt} completion=${sessionUsage.completion} total=${sessionUsage.total}`,
    });
  }
  ui.emit({ type: "info", data: "再见 👋" });
  await ui.stop();
  process.exit(code);
};

if (rl) {
  rl.on("SIGINT", () => void shutdown(0));
  rl.on("close", () => {
    if (!closed) void shutdown(0);
  });
} else {
  // Ink 模式:用 process 信号兜底
  process.on("SIGINT", () => void shutdown(0));
}

ui.emit({ type: "info", data: "rehudex v0.4 — 输入 exit 或按 Ctrl+C 退出" });
ui.emit({
  type: "info",
  data: `UI: ${effectiveUiType} | 提示: / 命令(Tab 补全) | @文件 引用 | !cmd 直接 shell | 行尾 \\ 续行 | /edit 长输入 | /help 查看全部`,
});

const cmdCtx: CommandContext = {
  history,
  store,
  systemMsg,
  sessionUsage,
  ui,
  setStore(s) {
    store = s;
    cmdCtx.store = s;
  },
};

function formatTok(n: number): string {
  if (n <= 0) return "";
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function buildPrompt(): string {
  const tag = formatTok(sessionUsage.total);
  if (!tag) return pc.green("> ");
  return `${pc.dim(`[${tag}]`)} ${pc.green(">")} `;
}

/**
 * 多行输入读取:行尾以 `\` 结尾就续行(去掉 `\`),否则把累积内容用 `\n` 连接后返回。
 */
async function readUserInput(): Promise<string> {
  return ui.readInput(buildPrompt);
}

/**
 * 把一段文本当成本轮 user 输入:走 @ 展开 + agentRun + sessionUsage 累加。
 */
async function processMessage(text: string): Promise<void> {
  ui.emit({ type: "userMessage", data: text });
  const expanded = await expandAtRefs(text);
  const { usage } = await agentRun(expanded, history, store, ui);
  if (usage.total > 0) {
    sessionUsage.prompt += usage.prompt;
    sessionUsage.completion += usage.completion;
    sessionUsage.total += usage.total;
    ui.emit({
      type: "info",
      data: `(本轮 ${usage.total} / 累计 ${sessionUsage.total} tokens)`,
    });
  }
}

while (!closed) {
  let input: string;
  try {
    input = (await readUserInput()).trim();
  } catch {
    break;
  }
  if (closed) break;
  if (!input) continue;
  if (input === "exit") {
    await shutdown(0);
    break;
  }

  // ! 前缀:直接执行 shell,结果入 history
  if (input.startsWith("!")) {
    const cmd = input.slice(1).trim();
    if (!cmd) continue;
    ui.emit({ type: "shellStart", data: { shell: CURRENT_SHELL, cmd } });
    const { stdout, stderr, error } = await runShell(cmd);
    ui.emit({ type: "shellOutput", data: { stdout, stderr, error } });
    ui.emit({ type: "shellDone" });
    const summary =
      `[用户在 shell 执行] ${cmd}\nstdout:\n${stdout}\nstderr:\n${stderr}` +
      (error ? `\nerror:\n${error}` : "");
    const msg: OpenAI.ChatCompletionMessageParam = { role: "user", content: summary };
    history.push(msg);
    store.append(msg);
    continue;
  }

  // / 前缀:走命令注册表
  if (input.startsWith("/")) {
    const [name, ...rest] = input.slice(1).split(/\s+/);
    const cmd = getCommand(name);
    if (!cmd) {
      ui.emit({
        type: "error",
        data: `未知命令: /${name}`,
      });
      ui.emit({ type: "info", data: "输入 /help 查看可用命令" });
      continue;
    }
    const result = await cmd.run(rest.join(" "), cmdCtx);
    // 命令返回非空字符串 → 作为本轮 user 输入继续走 agentRun
    if (typeof result === "string" && result.trim()) {
      await processMessage(result);
    }
    continue;
  }

  // 其余:@ 文件引用展开后丢给 LLM
  await processMessage(input);
}
