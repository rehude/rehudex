import { readFile as fsRead } from "node:fs/promises";
import { safePath } from "./safePath.js";
import type { Tool } from "../types.js";

export const readFile: Tool = {
  name: "read_file",
  description: "读取 cwd 范围内某个文件的全部文本内容",
  readOnly: true,
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "相对或绝对路径" } },
    required: ["path"],
  },
  async execute({ path: p }) {
    return await fsRead(safePath(p), "utf8");
  },
};
