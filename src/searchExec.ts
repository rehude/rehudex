import { execSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { runShell, CURRENT_SHELL } from "./shellExec.js";
import { safePath } from "./tools/safePath.js";

export const HAS_RG = (() => {
  try {
    execSync("rg --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const IS_PS = /pwsh|powershell/i.test(CURRENT_SHELL);
const IS_POSIX = process.platform !== "win32";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".pnpm-store",
]);

// ---------------- glob 匹配器 ----------------

function compileGlob(pat: string): RegExp {
  const norm = pat.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === "*") {
      if (norm[i + 1] === "*") {
        // **
        re += ".*";
        i++;
        if (norm[i + 1] === "/") i++; // 吃掉 **/
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[\\^$+()[\]{}|.]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function matchGlob(filePath: string, pattern: string): boolean {
  return compileGlob(pattern).test(filePath.replace(/\\/g, "/"));
}

// ---------------- 通用:递归列文件(JS) ----------------

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== "." && e.name !== "..") {
      if (SKIP_DIRS.has(e.name)) continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full, root);
    } else if (e.isFile()) {
      yield path.relative(root, full).replace(/\\/g, "/");
    }
  }
}

// ---------------- grep ----------------

export interface GrepOpts {
  pattern: string;
  searchPath?: string;
  glob?: string;
  ignoreCase?: boolean;
  maxHits?: number;
}

export interface Hit {
  path: string;
  line: number;
  text: string;
}

function shQuote(s: string): string {
  if (IS_PS) return "'" + s.replace(/'/g, "''") + "'";
  if (IS_POSIX) return "'" + s.replace(/'/g, "'\\''") + "'";
  return '"' + s.replace(/"/g, '""') + '"';
}

function parseRgOutput(out: string, max: number): Hit[] {
  const hits: Hit[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    // path:lineno:text  (Windows 路径含 ':' → 用前两个 ':' 分割)
    const first = line.indexOf(":");
    if (first === -1) continue;
    // 跳过 Windows 盘符 'C:' 情形
    let pathEnd = first;
    if (first === 1 && /[A-Za-z]/.test(line[0])) {
      const second = line.indexOf(":", first + 1);
      if (second === -1) continue;
      pathEnd = second;
    }
    const lineNoEnd = line.indexOf(":", pathEnd + 1);
    if (lineNoEnd === -1) continue;
    const p = line.slice(0, pathEnd);
    const ln = parseInt(line.slice(pathEnd + 1, lineNoEnd), 10);
    if (!Number.isFinite(ln)) continue;
    hits.push({ path: p, line: ln, text: line.slice(lineNoEnd + 1) });
    if (hits.length >= max) break;
  }
  return hits;
}

async function rgGrep(o: GrepOpts): Promise<Hit[]> {
  const max = o.maxHits ?? 100;
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    o.ignoreCase ? "-i" : "",
    o.glob ? `-g ${shQuote(o.glob)}` : "",
    `-m ${max}`,
    "-e",
    shQuote(o.pattern),
    o.searchPath ? shQuote(o.searchPath) : ".",
  ]
    .filter(Boolean)
    .join(" ");
  const { stdout } = await runShell(`rg ${args}`, 30_000);
  return parseRgOutput(stdout, max);
}

async function psGrep(o: GrepOpts): Promise<Hit[]> {
  const max = o.maxHits ?? 100;
  const root = o.searchPath ?? ".";
  const filter = o.glob ? `-Include ${shQuote(o.glob)}` : "";
  const ci = o.ignoreCase ? "-CaseSensitive:$false" : "";
  // Get-ChildItem 默认不递归到隐藏目录;-Recurse 会;手动排除常见目录
  const ps =
    `$ErrorActionPreference='SilentlyContinue';` +
    `Get-ChildItem -Path ${shQuote(root)} -Recurse -File ${filter} | ` +
    `Where-Object { $_.FullName -notmatch '\\\\(node_modules|\\.git|dist|build)\\\\' } | ` +
    `Select-String -Pattern ${shQuote(o.pattern)} ${ci} | ` +
    `Select-Object -First ${max} | ` +
    `ForEach-Object { "$($_.Path):$($_.LineNumber):$($_.Line)" }`;
  const { stdout } = await runShell(ps, 30_000);
  return parseRgOutput(stdout, max);
}

async function posixGrep(o: GrepOpts): Promise<Hit[]> {
  const max = o.maxHits ?? 100;
  const flags = ["-rnE", o.ignoreCase ? "-i" : ""].filter(Boolean).join(" ");
  const exclude = [...SKIP_DIRS].map((d) => `--exclude-dir=${shQuote(d)}`).join(" ");
  const include = o.glob ? `--include=${shQuote(o.glob)}` : "";
  const target = o.searchPath ? shQuote(o.searchPath) : ".";
  const { stdout } = await runShell(
    `grep ${flags} ${exclude} ${include} ${shQuote(o.pattern)} ${target} | head -n ${max}`,
    30_000,
  );
  return parseRgOutput(stdout, max);
}

async function jsGrep(o: GrepOpts): Promise<Hit[]> {
  const max = o.maxHits ?? 100;
  const root = safePath(o.searchPath ?? ".");
  const re = new RegExp(o.pattern, o.ignoreCase ? "i" : "");
  const hits: Hit[] = [];
  for await (const rel of walk(root, root)) {
    if (o.glob && !matchGlob(rel, o.glob)) continue;
    let text: string;
    try {
      text = await readFile(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ path: rel, line: i + 1, text: lines[i] });
        if (hits.length >= max) return hits;
      }
    }
  }
  return hits;
}

export async function grepSearch(o: GrepOpts): Promise<Hit[]> {
  if (HAS_RG) {
    try {
      return await rgGrep(o);
    } catch {}
  }
  if (IS_PS) {
    try {
      return await psGrep(o);
    } catch {}
  } else if (IS_POSIX) {
    try {
      return await posixGrep(o);
    } catch {}
  }
  return await jsGrep(o);
}

// ---------------- glob ----------------

export interface GlobOpts {
  pattern: string;
  searchPath?: string;
  maxFiles?: number;
}

async function rgFiles(o: GlobOpts): Promise<string[]> {
  const max = o.maxFiles ?? 500;
  const root = o.searchPath ? shQuote(o.searchPath) : ".";
  const { stdout } = await runShell(
    `rg --files ${root} -g ${shQuote(o.pattern)}`,
    30_000,
  );
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, max);
}

async function jsGlob(o: GlobOpts): Promise<string[]> {
  const max = o.maxFiles ?? 500;
  const root = safePath(o.searchPath ?? ".");
  const out: string[] = [];
  for await (const rel of walk(root, root)) {
    if (matchGlob(rel, o.pattern)) {
      out.push(rel);
      if (out.length >= max) break;
    }
  }
  return out;
}

async function psFiles(o: GlobOpts): Promise<string[]> {
  const max = o.maxFiles ?? 500;
  const root = o.searchPath ?? ".";
  // 用 -Recurse 列全部文件,JS 端 glob 匹配
  const ps =
    `$ErrorActionPreference='SilentlyContinue';` +
    `Get-ChildItem -Path ${shQuote(root)} -Recurse -File | ` +
    `Where-Object { $_.FullName -notmatch '\\\\(node_modules|\\.git|dist|build)\\\\' } | ` +
    `ForEach-Object { Resolve-Path -Relative $_.FullName }`;
  const { stdout } = await runShell(ps, 30_000);
  const all = stdout
    .split(/\r?\n/)
    .map((s) => s.replace(/^\.[\\/]/, "").replace(/\\/g, "/"))
    .filter(Boolean);
  const out: string[] = [];
  for (const f of all) {
    if (matchGlob(f, o.pattern)) {
      out.push(f);
      if (out.length >= max) break;
    }
  }
  return out;
}

async function posixFind(o: GlobOpts): Promise<string[]> {
  const max = o.maxFiles ?? 500;
  const root = o.searchPath ? shQuote(o.searchPath) : ".";
  const prune = [...SKIP_DIRS]
    .map((d) => `-name ${shQuote(d)}`)
    .join(" -o ");
  const { stdout } = await runShell(
    `find ${root} \\( ${prune} \\) -prune -o -type f -print`,
    30_000,
  );
  const all = stdout
    .split(/\r?\n/)
    .map((s) => s.replace(/^\.\//, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const f of all) {
    if (matchGlob(f, o.pattern)) {
      out.push(f);
      if (out.length >= max) break;
    }
  }
  return out;
}

export async function globFind(o: GlobOpts): Promise<string[]> {
  if (HAS_RG) {
    try {
      return await rgFiles(o);
    } catch {}
  }
  if (IS_PS) {
    try {
      return await psFiles(o);
    } catch {}
  } else if (IS_POSIX) {
    try {
      return await posixFind(o);
    } catch {}
  }
  return await jsGlob(o);
}
