import OpenAI from "openai";
import { CFG } from "./config.js";

export const client = new OpenAI({ apiKey: CFG.apiKey, baseURL: CFG.baseURL });

export async function chat(
  messages: OpenAI.ChatCompletionMessageParam[],
  tools?: OpenAI.ChatCompletionTool[],
): Promise<OpenAI.ChatCompletionMessage> {
  const res = await client.chat.completions.create({
    model: CFG.model,
    messages,
    tools,
    tool_choice: tools?.length ? "auto" : undefined,
  });
  return res.choices[0].message;
}

export async function chatStream(
  messages: OpenAI.ChatCompletionMessageParam[],
  tools?: OpenAI.ChatCompletionTool[],
  onText?: (delta: string) => void,
): Promise<OpenAI.ChatCompletionMessage> {
  const stream = await client.chat.completions.create({
    model: CFG.model,
    messages,
    tools,
    tool_choice: tools?.length ? "auto" : undefined,
    stream: true,
  });

  let content = "";
  const toolCalls: any[] = [];

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      content += delta.content;
      onText?.(delta.content);
    }
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const i = tc.index!;
        if (!toolCalls[i]) {
          toolCalls[i] = { id: "", type: "function", function: { name: "", arguments: "" } };
        }
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
    }
  }

  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  } as OpenAI.ChatCompletionMessage;
}
