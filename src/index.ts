import readline from "node:readline/promises";
import pc from "picocolors";
import { agentRun } from "./agent.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import type OpenAI from "openai";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const history: OpenAI.ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

console.log(pc.cyan("easyAgent v0.1 — 输入 exit 或 Ctrl+C 退出"));
while (true) {
  const input = (await rl.question(pc.green("> "))).trim();
  if (!input) continue;
  if (input === "exit") break;
  await agentRun(input, history);
}
rl.close();
