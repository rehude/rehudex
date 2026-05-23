import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { confirm } from "../confirm.js";
import type { Tool } from "../types.js";

const pexec = promisify(exec);

// Windows 上按 pwsh → powershell.exe → cmd.exe 顺序探测,选第一个能跑通的。
// 其他平台返回 undefined,让 exec 走默认 /bin/sh。
function detectShell(): string | undefined {
  if (process.platform !== "win32") return undefined;
  for (const candidate of ["pwsh.exe", "powershell.exe"]) {
    try {
      execSync(`${candidate} -NoProfile -Command "exit 0"`, { stdio: "ignore" });
      return candidate;
    } catch {
      // 不存在或被策略禁用,继续找下一个
    }
  }
  return "cmd.exe"; // 兜底,Windows 永远有
}

const SHELL = detectShell();
export const CURRENT_SHELL = SHELL ?? "/bin/sh";

function shellSyntaxHint(s: string): string {
  if (s.includes("pwsh") || s.includes("powershell")) {
    return "请使用 PowerShell 语法(如 Get-ChildItem、$env:VAR、-Force);不要使用 Unix 短选项(ls -la 等)。";
  }
  if (s.toLowerCase().includes("cmd.exe")) {
    return "请使用 Windows cmd 语法(如 dir、%VAR%、type)。";
  }
  return "请使用 POSIX sh 语法。";
}

export const shell: Tool = {
  name: "execute_shell",
  description:
    `在 cwd 下执行 shell 命令并返回 stdout/stderr。涉及副作用,需用户确认。\n` +
    `当前 shell:${CURRENT_SHELL}。${shellSyntaxHint(CURRENT_SHELL)}`,
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
  async execute({ command }) {
    const ok = await confirm(`执行命令: ${command}?`);
    if (!ok) return "用户取消了命令";
    try {
      const { stdout, stderr } = await pexec(command, {
        cwd: process.cwd(),
        timeout: 30_000,
        shell: SHELL,
      });
      return `stdout:\n${stdout}\nstderr:\n${stderr}`;
    } catch (e: any) {
      return `命令失败: ${e.message}\nstdout:\n${e.stdout ?? ""}\nstderr:\n${e.stderr ?? ""}`;
    }
  },
};
