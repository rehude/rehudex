import { grepSearch } from "../searchExec.js";
import type { Tool } from "../types.js";

export const grep: Tool = {
  name: "grep",
  description:
    "在 cwd 范围内搜索文件内容(正则)。优先 ripgrep,Windows 兜底 PowerShell,POSIX 兜底 grep,最后纯 JS。" +
    "默认忽略 node_modules / .git / dist / build。最多返回 100 条命中。",
  readOnly: true,
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索起点,默认 cwd" },
      glob: { type: "string", description: "文件名 glob 过滤,如 *.ts、**/*.md" },
      ignoreCase: { type: "boolean", description: "是否忽略大小写,默认 false" },
    },
    required: ["pattern"],
  },
  async execute(args: { pattern: string; path?: string; glob?: string; ignoreCase?: boolean }) {
    const hits = await grepSearch({
      pattern: args.pattern,
      searchPath: args.path,
      glob: args.glob,
      ignoreCase: args.ignoreCase,
      maxHits: 100,
    });
    if (hits.length === 0) return "(无命中)";
    const lines = hits.map((h) => `${h.path}:${h.line}: ${h.text}`);
    const note = hits.length >= 100 ? "\n... (达到 100 条上限,截断)" : "";
    return lines.join("\n") + note;
  },
};
