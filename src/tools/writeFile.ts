import { writeFile as fsWrite } from "node:fs/promises";
import { safePath } from "./safePath.js";
import { approveTool } from "../approval.js";
import type { Tool } from "../types.js";

export const writeFile: Tool = {
  name: "write_file",
  description: "将文本内容写入 cwd 范围内的文件(可覆盖)",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(args: { path: string; content: string }) {
    const abs = safePath(args.path);
    const ok = await approveTool(writeFile, args, `写入 ${abs}(${args.content.length} 字符)?`);
    if (!ok) return "用户取消了写入";
    await fsWrite(abs, args.content, "utf8");
    return `已写入 ${abs}`;
  },
};
