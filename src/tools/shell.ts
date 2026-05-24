import { confirm } from "../confirm.js";
import { runShell, CURRENT_SHELL, shellSyntaxHint } from "../shellExec.js";
import type { Tool } from "../types.js";

export { CURRENT_SHELL };

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
    const { stdout, stderr, error } = await runShell(command);
    if (error) return `命令失败: ${error}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
    return `stdout:\n${stdout}\nstderr:\n${stderr}`;
  },
};
