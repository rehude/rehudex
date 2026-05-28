import { chatStream, type Usage } from "./llm.js";
import { getTool, toOpenAITools } from "./tools/index.js";
import { CFG } from "./config.js";
import { createStreamRenderer } from "./render.js";
import { formatApiError } from "./errors.js";
import { SessionStore } from "./session.js";
import pc from "picocolors";
import type OpenAI from "openai";
import type { UiAdapter } from "./ui/index.js";

export interface AgentRunResult {
  usage: Usage;
  error?: string;
}

export async function agentRun(
  userInput: string,
  history: OpenAI.ChatCompletionMessageParam[],
  store: SessionStore,
  ui: UiAdapter,
): Promise<AgentRunResult> {
  const userMsg: OpenAI.ChatCompletionMessageParam = {
    role: "user",
    content: userInput,
  };
  history.push(userMsg);
  store.append(userMsg);

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
            if (state.phase === "reasoning") ui.emit({ type: "reasoningDone" });
            ui.emit({ type: "assistantStart" });
            renderer.reset();
            state.phase = "content";
          }
          renderer.write(t);
          ui.emit({ type: "assistantDelta", data: t });
        },
        (t) => {
          if (state.phase !== "reasoning") {
            ui.emit({ type: "reasoningStart" });
            state.phase = "reasoning";
          }
          ui.emit({ type: "reasoningDelta", data: t });
        },
      );
      if (state.phase === "content") renderer.finish();
      if (usage) {
        total.prompt += usage.prompt;
        total.completion += usage.completion;
        total.total += usage.total;
      }
      history.push(assistant);
      store.append(assistant);

      if (!assistant.tool_calls?.length) {
        return { usage: total };
      }

      if (state.phase !== "none") ui.emit({ type: "assistantDone" });
      for (const call of assistant.tool_calls) {
        if (call.type !== "function") continue;
        const tool = getTool(call.function.name);
        let result: string;
        try {
          const args = JSON.parse(call.function.arguments);
          ui.emit({
            type: "toolCall",
            data: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          });
          result = tool
            ? await tool.execute(args)
            : `Error: unknown tool ${call.function.name}`;
        } catch (e: any) {
          result = `Error: ${e.message}`;
        }
        history.push({ role: "tool", tool_call_id: call.id, content: result });
        store.append({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    ui.emit({ type: "error", data: `已达最大迭代次数 ${CFG.maxIterations},强制中断` });
    return { usage: total };
  } catch (err) {
    renderer.reset();
    const msg = formatApiError(err);
    ui.emit({ type: "error", data: msg });
    return { usage: total, error: msg };
  }
}
