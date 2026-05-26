import { readFile as fsRead, writeFile as fsWrite } from "node:fs/promises";
import { existsSync } from "node:fs";
import { safePath } from "./safePath.js";
import { approveTool } from "../approval.js";
import type { Tool } from "../types.js";

type Format = "search_replace" | "unified_diff";

function detectFormat(patch: string): Format | null {
  if (/^<{7}\s*SEARCH\b/m.test(patch)) return "search_replace";
  if (/^@@ /m.test(patch)) return "unified_diff";
  return null;
}

interface SRBlock {
  search: string;
  replace: string;
}

function parseSearchReplace(patch: string): SRBlock[] {
  const blocks: SRBlock[] = [];
  // 兼容标记长度 7 / 不同空白
  const re = /<{7}\s*SEARCH\s*\n([\s\S]*?)\n={7}\s*\n([\s\S]*?)\n>{7}\s*REPLACE\s*(?:\n|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(patch))) {
    blocks.push({ search: m[1], replace: m[2] });
  }
  return blocks;
}

function findSimilarContext(content: string, needle: string): string {
  if (!needle.trim()) return "(文件中未找到相似内容)";
  const needleFirstLine = needle.split("\n")[0].trim();
  if (!needleFirstLine) return "(SEARCH 段以空行开头,无法定位)";
  const lines = content.split("\n");
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let score = 0;
    if (ln.trim() === needleFirstLine) score = 100;
    else if (ln.includes(needleFirstLine.slice(0, Math.min(20, needleFirstLine.length)))) score = 50;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return "(文件中未找到相似内容)";
  const from = Math.max(0, bestIdx - 2);
  const to = Math.min(lines.length, bestIdx + 5);
  return lines
    .slice(from, to)
    .map((l, k) => `  ${from + k + 1}: ${l}`)
    .join("\n");
}

function applySearchReplace(content: string, blocks: SRBlock[], fileExists: boolean): string {
  let cur = content;
  for (let i = 0; i < blocks.length; i++) {
    const { search, replace } = blocks[i];
    if (search === "") {
      // 空 SEARCH:新建文件场景。如果文件已有内容且不是首块,拒绝。
      if (cur !== "" && i === 0 && fileExists) {
        throw new Error(`第 ${i + 1} 块:SEARCH 为空表示新建文件,但目标文件已有内容`);
      }
      cur = replace;
      continue;
    }
    const idx = cur.indexOf(search);
    if (idx === -1) {
      const sample = search.split("\n").slice(0, 3).join("\n");
      throw new Error(
        `第 ${i + 1} 块匹配失败。\n` +
          `SEARCH 前 3 行:\n${sample}\n` +
          `文件中相似位置:\n${findSimilarContext(cur, search)}\n` +
          `提示:SEARCH 必须与文件完全字面匹配(含缩进与空白)。`,
      );
    }
    cur = cur.slice(0, idx) + replace + cur.slice(idx + search.length);
  }
  return cur;
}

interface Hunk {
  oldStart: number;
  oldLines: string[]; // 含上下文 + 删除
  newLines: string[]; // 含上下文 + 增加
}

function parseUnifiedDiff(patch: string): Hunk[] {
  const lines = patch.split(/\r?\n/);
  const hunks: Hunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const oldStart = parseInt(m[1], 10);
    i++;
    const oldLines: string[] = [];
    const newLines: string[] = [];
    while (i < lines.length && !/^@@ /.test(lines[i])) {
      const ln = lines[i];
      if (ln.startsWith("\\")) {
        // \ No newline at end of file — 忽略
      } else if (ln.startsWith(" ")) {
        oldLines.push(ln.slice(1));
        newLines.push(ln.slice(1));
      } else if (ln.startsWith("-")) {
        oldLines.push(ln.slice(1));
      } else if (ln.startsWith("+")) {
        newLines.push(ln.slice(1));
      } else if (ln === "") {
        // 兼容裁掉前导空格的空行
        oldLines.push("");
        newLines.push("");
      } else {
        // diff 头(--- / +++)等非 hunk 体行,跳过
      }
      i++;
    }
    hunks.push({ oldStart, oldLines, newLines });
  }
  return hunks;
}

function matchAt(lines: string[], from: number, target: string[]): boolean {
  if (from < 0 || from + target.length > lines.length) return false;
  for (let k = 0; k < target.length; k++) {
    if (lines[from + k] !== target[k]) return false;
  }
  return true;
}

function applyUnifiedDiff(content: string, hunks: Hunk[]): string {
  const fileLines = content.split("\n");
  const trailingNewline = content.endsWith("\n");
  if (trailingNewline) fileLines.pop(); // split 末尾空字符串

  // 倒序应用,避免前面 hunk 改动影响后面 hunk 的行号
  const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (let h = 0; h < sorted.length; h++) {
    const hunk = sorted[h];
    const ideal = hunk.oldStart - 1; // 1-indexed → 0-indexed
    let matchedAt = -1;
    if (matchAt(fileLines, ideal, hunk.oldLines)) {
      matchedAt = ideal;
    } else {
      for (let delta = 1; delta <= 3 && matchedAt === -1; delta++) {
        if (matchAt(fileLines, ideal - delta, hunk.oldLines)) matchedAt = ideal - delta;
        else if (matchAt(fileLines, ideal + delta, hunk.oldLines)) matchedAt = ideal + delta;
      }
    }
    if (matchedAt === -1) {
      const sample = hunk.oldLines.slice(0, 3).join("\n");
      throw new Error(
        `hunk @${hunk.oldStart} 应用失败(±3 行内未找到匹配)。\n旧块前 3 行:\n${sample}`,
      );
    }
    fileLines.splice(matchedAt, hunk.oldLines.length, ...hunk.newLines);
  }
  return fileLines.join("\n") + (trailingNewline ? "\n" : "");
}

export const editFile: Tool = {
  name: "edit_file",
  description:
    "对 cwd 内某个文件应用 patch。两种格式自动识别,推荐 search_replace:\n" +
    "1) search_replace(Aider 风格,多块顺序应用,精确匹配):\n" +
    "<<<<<<< SEARCH\n旧内容\n=======\n新内容\n>>>>>>> REPLACE\n" +
    "   - 空 SEARCH 段表示新建文件,REPLACE 段即全文。\n" +
    "2) unified_diff(标准 `@@ -a,b +c,d @@`,±3 行模糊定位)。\n" +
    "失败时返回详细错误,你应根据错误重新生成 patch。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "目标文件相对或绝对路径(必须在 cwd 内)" },
      patch: { type: "string", description: "patch 文本,格式自动识别" },
      format: {
        type: "string",
        enum: ["search_replace", "unified_diff"],
        description: "可选,强制指定格式;默认自动识别",
      },
    },
    required: ["path", "patch"],
  },
  async execute(args: { path: string; patch: string; format?: Format }) {
    const abs = safePath(args.path);
    const fileExists = existsSync(abs);
    const original = fileExists ? await fsRead(abs, "utf8") : "";

    const fmt: Format | null = args.format ?? detectFormat(args.patch);
    if (!fmt) {
      return "Error: 无法识别 patch 格式。请在 patch 中包含 `<<<<<<< SEARCH` 标记或 `@@ -a,b +c,d @@` hunk 头,或显式传 format。";
    }

    let next: string;
    try {
      if (fmt === "search_replace") {
        const blocks = parseSearchReplace(args.patch);
        if (blocks.length === 0)
          return "Error: 未解析到任何 SEARCH/REPLACE 块,请检查标记是否为 7 个尖括号。";
        next = applySearchReplace(original, blocks, fileExists);
      } else {
        const hunks = parseUnifiedDiff(args.patch);
        if (hunks.length === 0) return "Error: 未解析到任何 hunk(@@ 行)。";
        next = applyUnifiedDiff(original, hunks);
      }
    } catch (e: any) {
      return `Error: ${e.message}`;
    }

    if (next === original) return `文件未发生变化: ${abs}`;

    const ok = await approveTool(
      editFile,
      args,
      `${fileExists ? "修改" : "新建"} ${abs}(${original.length} → ${next.length} 字符)?`,
    );
    if (!ok) return "用户取消了修改";
    await fsWrite(abs, next, "utf8");
    return `已${fileExists ? "修改" : "新建"} ${abs}(${fmt})`;
  },
};
