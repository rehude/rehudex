import readline from "node:readline/promises";
import pc from "picocolors";
import { agentRun } from "./agent.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { registerTool } from "./tools/index.js";
import { readFile } from "./tools/readFile.js";
import { writeFile } from "./tools/writeFile.js";
import { shell } from "./tools/shell.js";
import type OpenAI from "openai";

registerTool(readFile);
registerTool(writeFile);
registerTool(shell);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const history: OpenAI.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

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
  rl.close();
  process.exit(code);
};

rl.on("SIGINT", () => shutdown(0));
rl.on("close", () => {
  if (!closed) shutdown(0);
});

console.log(pc.cyan("easyAgent v0.1 — 输入 exit 或按 Ctrl+C 退出"));
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
  const { usage } = await agentRun(input, history);
  if (usage.total > 0) {
    sessionUsage.prompt += usage.prompt;
    sessionUsage.completion += usage.completion;
    sessionUsage.total += usage.total;
    console.log(
      pc.dim(
        `(本轮 ${usage.total} / 累计 ${sessionUsage.total} tokens)`,
      ),
    );
  }
}
