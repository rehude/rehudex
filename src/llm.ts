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
