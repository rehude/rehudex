import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const BASE_PROMPT = `你是 easyAgent,一个运行在用户终端的命令行助手。
你可以调用工具来读写文件、执行 shell 命令、按正则/glob 搜索代码,帮助用户完成任务。
原则:
- 工具调用前先简短说明意图
- 路径相对于用户当前工作目录
- 执行有副作用的操作(写文件/编辑/shell)时,默认会询问确认
- 修改文件优先用 edit_file 的 SEARCH/REPLACE 格式(精确替换,无需大段重写)
- 搜索代码优先用 grep / glob,避免靠 read_file 全文搜索
- 回复用中文,简洁直接`;

const PROJECT_FILES = ["CLAUDE.md", "AGENTS.md"];
const MAX_FILE_BYTES = 32 * 1024;

/** 注入项目级别的 CLAUDE.md / AGENTS.md(若存在) */
function readProjectFile(cwd: string, name: string): string | null {
  const file = path.join(cwd, name);
  if (!existsSync(file)) return null;
  try {
    let text = readFileSync(file, "utf8");
    if (text.length > MAX_FILE_BYTES) {
      text = text.slice(0, MAX_FILE_BYTES) + "\n\n[... truncated]";
    }
    return text;
  } catch {
    return null;
  }
}

export function buildSystemPrompt(cwd: string = process.cwd(), yolo = false): string {
  const sections: string[] = [
    BASE_PROMPT,
    yolo
      ? "当前处于 YOLO 模式:副作用操作不会再弹出确认,请直接执行必要步骤并保持谨慎。"
      : "",
  ].filter(Boolean);
  for (const name of PROJECT_FILES) {
    const text = readProjectFile(cwd, name);
    if (text) {
      sections.push(`<project_context source="${name}">\n${text}\n</project_context>`);
    }
  }
  return sections.join("\n\n");
}

/** 兼容旧导出:仅基础提示,无项目上下文。新代码请用 buildSystemPrompt()。 */
export const SYSTEM_PROMPT = BASE_PROMPT;
