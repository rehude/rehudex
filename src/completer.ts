import { readdirSync } from "node:fs";
import { readFile as fsRead } from "node:fs/promises";
import pc from "picocolors";
import { safePath } from "./tools/safePath.js";
import { allCommands } from "./commands.js";

type CompleterResult = [string[], string];

function completePath(input: string): string[] {
  const normalized = input.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const dirRel = lastSlash === -1 ? "." : normalized.slice(0, lastSlash) || ".";
  const partial = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);

  let dirAbs: string;
  try {
    dirAbs = safePath(dirRel);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  const prefix = dirRel === "." ? "" : dirRel.endsWith("/") ? dirRel : dirRel + "/";
  return entries
    .filter((e) => e.name.startsWith(partial))
    .map((e) => prefix + e.name + (e.isDirectory() ? "/" : ""))
    .sort();
}

export function buildCompleter(): (line: string) => CompleterResult {
  return (line: string): CompleterResult => {
    const m = line.match(/(\S*)$/);
    const word = m?.[1] ?? "";

    if (word.startsWith("/") && !word.slice(1).includes("/")) {
      const prefix = word.slice(1);
      const hits = allCommands()
        .filter((c) => c.name.startsWith(prefix))
        .map((c) => "/" + c.name);
      return [hits, word];
    }

    if (word.startsWith("@")) {
      const paths = completePath(word.slice(1));
      return [paths.map((p) => "@" + p), word];
    }

    return [[], word];
  };
}

export async function expandAtRefs(input: string): Promise<string> {
  const refs = [...input.matchAll(/(?:^|\s)@([^\s]+)/g)].map((m) => m[1]);
  if (refs.length === 0) return input;
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    try {
      const abs = safePath(ref);
      const content = await fsRead(abs, "utf8");
      blocks.push(`--- 附件: ${ref} ---\n${content}\n--- 结束 ---`);
      console.log(pc.dim(`[附加] ${ref} (${content.length} 字节)`));
    } catch (e: any) {
      console.log(pc.yellow(`[跳过] @${ref}: ${e.message}`));
    }
  }
  if (blocks.length === 0) return input;
  return blocks.join("\n\n") + "\n\n" + input;
}
