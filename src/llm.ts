import OpenAI from "openai";
import { CFG } from "./config.js";

export const client = new OpenAI({ apiKey: CFG.apiKey, baseURL: CFG.baseURL });

export interface Usage {
  prompt: number;
  completion: number;
  total: number;
}

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

export interface StreamResult {
  message: OpenAI.ChatCompletionMessage;
  usage: Usage | null;
}

export async function chatStream(
  messages: OpenAI.ChatCompletionMessageParam[],
  tools?: OpenAI.ChatCompletionTool[],
  onText?: (delta: string) => void,
  onReasoning?: (delta: string) => void,
): Promise<StreamResult> {
  const stream = await client.chat.completions.create({
    model: CFG.model,
    messages,
    tools,
    tool_choice: tools?.length ? "auto" : undefined,
    stream: true,
    stream_options: { include_usage: true },
  });

  let content = "";
  let reasoning = "";
  const toolCalls: any[] = [];
  let usage: Usage | null = null;

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = {
        prompt: chunk.usage.prompt_tokens ?? 0,
        completion: chunk.usage.completion_tokens ?? 0,
        total: chunk.usage.total_tokens ?? 0,
      };
    }
    const delta = chunk.choices[0]?.delta as any;
    if (!delta) continue;

    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
      onReasoning?.(delta.reasoning_content);
    }
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

  const msg: any = {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
  if (reasoning) msg.reasoning_content = reasoning;
  return { message: msg as OpenAI.ChatCompletionMessage, usage };
}
