import { chatStream } from "./llm.js";
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
    let phase: "none" | "reasoning" | "content" = "none";
    const assistant = await chatStream(
      history,
      toOpenAITools(),
      (t) => {
        if (phase !== "content") {
          if (phase === "reasoning") process.stdout.write("\n");
          process.stdout.write(pc.cyan("[回答] "));
          phase = "content";
        }
        process.stdout.write(pc.gray(t));
      },
      (t) => {
        if (phase !== "reasoning") {
          process.stdout.write(pc.dim("[思考] "));
          phase = "reasoning";
        }
        process.stdout.write(pc.dim(t));
      },
    );
    history.push(assistant);

    if (!assistant.tool_calls?.length) {
      process.stdout.write("\n");
      return;
    }

    if (phase !== "none") process.stdout.write("\n");
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
