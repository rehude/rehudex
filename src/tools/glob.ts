import { globFind } from "../searchExec.js";
import type { Tool } from "../types.js";

export const glob: Tool = {
  name: "glob",
  description:
    "在 cwd 范围内按 glob 列出文件。支持 *、**、? 通配。优先 ripgrep --files,Windows 兜底 PowerShell,POSIX 兜底 find,最后纯 JS。" +
    "默认忽略 node_modules / .git / dist / build。最多返回 500 条。",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: 'glob,如 "src/**/*.ts"、"*.md"' },
      path: { type: "string", description: "搜索起点,默认 cwd" },
    },
    required: ["pattern"],
  },
  async execute(args: { pattern: string; path?: string }) {
    const files = await globFind({
      pattern: args.pattern,
      searchPath: args.path,
      maxFiles: 500,
    });
    if (files.length === 0) return "(无匹配文件)";
    const note = files.length >= 500 ? "\n... (达到 500 条上限,截断)" : "";
    return files.join("\n") + note;
  },
};
