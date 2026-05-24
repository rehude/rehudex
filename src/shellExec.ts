import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

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

export function shellSyntaxHint(s: string): string {
  if (s.includes("pwsh") || s.includes("powershell")) {
    return "请使用 PowerShell 语法(如 Get-ChildItem、$env:VAR、-Force);不要使用 Unix 短选项(ls -la 等)。";
  }
  if (s.toLowerCase().includes("cmd.exe")) {
    return "请使用 Windows cmd 语法(如 dir、%VAR%、type)。";
  }
  return "请使用 POSIX sh 语法。";
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  error?: string;
}

export async function runShell(command: string, timeoutMs = 30_000): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await pexec(command, {
      cwd: process.cwd(),
      timeout: timeoutMs,
      shell: SHELL,
    });
    return { stdout, stderr };
  } catch (e: any) {
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      error: e.message,
    };
  }
}
