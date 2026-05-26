import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import pc from "picocolors";
import { confirm } from "./confirm.js";
import type { Tool } from "./types.js";

export interface ApprovalPolicy {
  autoApproveReadOnly: boolean;
  shellAllowlist: RegExp[];
  writeAlwaysAsk: boolean;
}

const DEFAULTS: ApprovalPolicy = {
  autoApproveReadOnly: true,
  shellAllowlist: [],
  writeAlwaysAsk: true,
};

function safeCompile(src: string): RegExp | null {
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

function loadFromFile(): Partial<ApprovalPolicy> {
  const file = path.join(homedir(), ".rehudex", "config.json");
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const a = raw?.approval ?? {};
    const out: Partial<ApprovalPolicy> = {};
    if (typeof a.autoApproveReadOnly === "boolean") out.autoApproveReadOnly = a.autoApproveReadOnly;
    if (typeof a.writeAlwaysAsk === "boolean") out.writeAlwaysAsk = a.writeAlwaysAsk;
    if (Array.isArray(a.shellAllowlist)) {
      out.shellAllowlist = a.shellAllowlist
        .filter((s: unknown): s is string => typeof s === "string")
        .map(safeCompile)
        .filter((r: RegExp | null): r is RegExp => r !== null);
    }
    return out;
  } catch (e: any) {
    process.stderr.write(pc.yellow(`[approval] 读取 ${file} 失败: ${e.message}\n`));
    return {};
  }
}

function loadFromEnv(): Partial<ApprovalPolicy> {
  const env = process.env.REHUDEX_SHELL_ALLOWLIST;
  if (!env) return {};
  const list = env
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(safeCompile)
    .filter((r): r is RegExp => r !== null);
  return list.length ? { shellAllowlist: list } : {};
}

let cached: ApprovalPolicy | null = null;

export function loadApproval(): ApprovalPolicy {
  if (cached) return cached;
  const fromFile = loadFromFile();
  const fromEnv = loadFromEnv();
  cached = {
    autoApproveReadOnly: fromFile.autoApproveReadOnly ?? DEFAULTS.autoApproveReadOnly,
    writeAlwaysAsk: fromFile.writeAlwaysAsk ?? DEFAULTS.writeAlwaysAsk,
    // env 与 file 的 allowlist 合并(union)
    shellAllowlist: [
      ...(fromFile.shellAllowlist ?? []),
      ...(fromEnv.shellAllowlist ?? []),
    ],
  };
  return cached;
}

export async function approveTool(tool: Tool, _args: unknown, prompt: string): Promise<boolean> {
  const policy = loadApproval();
  if (tool.readOnly && policy.autoApproveReadOnly) return true;
  if (!tool.readOnly && !policy.writeAlwaysAsk) return true;
  return await confirm(prompt);
}

export async function approveShell(command: string): Promise<boolean> {
  const policy = loadApproval();
  for (const re of policy.shellAllowlist) {
    if (re.test(command)) {
      process.stdout.write(pc.dim(`[approval] 命中 allowlist /${re.source}/,自动放行\n`));
      return true;
    }
  }
  return await confirm(`执行命令: ${command}?`);
}
