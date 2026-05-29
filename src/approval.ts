import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import pc from "picocolors";
import { confirm } from "./confirm.js";
import { getCurrentUi } from "./ui/current.js";
import type { Tool } from "./types.js";

export interface ApprovalPolicy {
  yolo: boolean;
  autoApproveReadOnly: boolean;
  shellAllowlist: RegExp[];
  writeAlwaysAsk: boolean;
}

const DEFAULTS: ApprovalPolicy = {
  yolo: false,
  autoApproveReadOnly: true,
  shellAllowlist: [],
  writeAlwaysAsk: true,
};

let runtimeOverrides: Partial<Pick<ApprovalPolicy, "yolo">> = {};

export function setApprovalOverrides(overrides: Partial<Pick<ApprovalPolicy, "yolo">>): void {
  runtimeOverrides = { ...runtimeOverrides, ...overrides };
  cached = null;
}

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
    if (typeof a.yolo === "boolean") out.yolo = a.yolo;
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

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function loadFromEnv(): Partial<ApprovalPolicy> {
  const out: Partial<ApprovalPolicy> = {};
  const yolo = parseBooleanFlag(process.env.REHUDEX_YOLO);
  if (yolo !== undefined) out.yolo = yolo;

  const env = process.env.REHUDEX_SHELL_ALLOWLIST;
  if (env) {
    const list = env
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(safeCompile)
      .filter((r): r is RegExp => r !== null);
    if (list.length) out.shellAllowlist = list;
  }

  return out;
}

let cached: ApprovalPolicy | null = null;

export function loadApproval(): ApprovalPolicy {
  if (cached) return cached;
  const fromFile = loadFromFile();
  const fromEnv = loadFromEnv();
  cached = {
    yolo: runtimeOverrides.yolo ?? fromEnv.yolo ?? fromFile.yolo ?? DEFAULTS.yolo,
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
  if (policy.yolo) return true;
  if (tool.readOnly && policy.autoApproveReadOnly) return true;
  if (!tool.readOnly && !policy.writeAlwaysAsk) return true;
  return await confirm(prompt);
}

export async function approveShell(command: string): Promise<boolean> {
  const policy = loadApproval();
  if (policy.yolo) return true;
  for (const re of policy.shellAllowlist) {
    if (re.test(command)) {
      getCurrentUi().emit({
        type: "info",
        data: pc.dim(`[approval] 命中 allowlist /${re.source}/,自动放行`),
      });
      return true;
    }
  }
  return await confirm(`执行命令: ${command}?`);
}
