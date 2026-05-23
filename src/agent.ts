import { chat } from "./llm.js";
import { getTool, toOpenAITools } from "./tools/index.js";
import { CFG } from "./config.js";
import pc from "picocolors";
import type OpenAI from "openai";

export async function agentRun(
  userInput: string,
  history: OpenAI.ChatCompletionMessageParam[],
): Promise<void> {
  history.push({ role: "user", content: userInput });

  for (let i = 0; i < CFG.maxIterations; i++) {
    const assistant = await chat(history, toOpenAITools());
    history.push(assistant);

    if (!assistant.tool_calls?.length) {
      console.log(pc.gray(assistant.content ?? ""));
      return;
    }

    if (assistant.content) console.log(pc.gray(assistant.content));
    for (const call of assistant.tool_calls) {
      if (call.type !== "function") continue;
      const tool = getTool(call.function.name);
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments);
        console.log(pc.yellow(`⚙ ${call.function.name}(${call.function.arguments})`));
        result = tool
          ? await tool.execute(args)
          : `Error: unknown tool ${call.function.name}`;
      } catch (e: any) {
        result = `Error: ${e.message}`;
      }
      history.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  console.log(pc.red(`已达最大迭代次数 ${CFG.maxIterations},强制中断`));
}
