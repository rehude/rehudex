import { chatStream, type Usage } from "./llm.js";
import { getTool, toOpenAITools } from "./tools/index.js";
import { CFG } from "./config.js";
import { createStreamRenderer } from "./render.js";
import { formatApiError } from "./errors.js";
import pc from "picocolors";
import type OpenAI from "openai";

export interface AgentRunResult {
  usage: Usage;
  error?: string;
}

export async function agentRun(
  userInput: string,
  history: OpenAI.ChatCompletionMessageParam[],
): Promise<AgentRunResult> {
  history.push({ role: "user", content: userInput });

  const renderer = createStreamRenderer();
  const total: Usage = { prompt: 0, completion: 0, total: 0 };

  try {
    for (let i = 0; i < CFG.maxIterations; i++) {
      const state = { phase: "none" as "none" | "reasoning" | "content" };
      const { message: assistant, usage } = await chatStream(
        history,
        toOpenAITools(),
        (t) => {
          if (state.phase !== "content") {
            if (state.phase === "reasoning") process.stdout.write("\n");
            process.stdout.write(pc.cyan("[回答]\n"));
            renderer.reset();
            state.phase = "content";
          }
          renderer.write(t);
        },
        (t) => {
          if (state.phase !== "reasoning") {
            process.stdout.write(pc.dim("[思考] "));
            state.phase = "reasoning";
          }
          process.stdout.write(pc.dim(t));
        },
      );
      if (state.phase === "content") renderer.finish();
      if (usage) {
        total.prompt += usage.prompt;
        total.completion += usage.completion;
        total.total += usage.total;
      }
      history.push(assistant);

      if (!assistant.tool_calls?.length) {
        return { usage: total };
      }

      if (state.phase !== "none") process.stdout.write("\n");
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
    return { usage: total };
  } catch (err) {
    renderer.reset();
    const msg = formatApiError(err);
    console.log(pc.red(`\n✖ ${msg}`));
    return { usage: total, error: msg };
  }
}
