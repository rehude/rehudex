import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";

const ROOT = path.join(homedir(), ".rehudex", "projects");

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/:]/g, "-");
}

function projectDir(): string {
  return path.join(ROOT, encodeCwd(process.cwd()));
}

export interface SessionMeta {
  id: string;
  mtime: Date;
  preview: string;
}

export class SessionStore {
  constructor(public id: string, public file: string) {}

  static create(): SessionStore {
    const id = randomUUID();
    const dir = projectDir();
    mkdirSync(dir, { recursive: true });
    return new SessionStore(id, path.join(dir, id + ".jsonl"));
  }

  static load(idOrPrefix: string): {
    store: SessionStore;
    messages: OpenAI.ChatCompletionMessageParam[];
  } {
    const dir = projectDir();
    const matches = existsSync(dir)
      ? readdirSync(dir).filter(
          (f) => f.endsWith(".jsonl") && f.startsWith(idOrPrefix),
        )
      : [];
    if (matches.length === 0) throw new Error(`未找到会话 ${idOrPrefix}`);
    if (matches.length > 1)
      throw new Error(`ID 前缀 ${idOrPrefix} 匹配到多个会话,请输入更长前缀`);
    const file = path.join(dir, matches[0]);
    const id = path.basename(matches[0], ".jsonl");
    const messages = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as OpenAI.ChatCompletionMessageParam);
    return { store: new SessionStore(id, file), messages };
  }

  static loadLatest(): {
    store: SessionStore;
    messages: OpenAI.ChatCompletionMessageParam[];
  } | null {
    const dir = projectDir();
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    return SessionStore.load(path.basename(files[0].name, ".jsonl"));
  }

  static list(): SessionMeta[] {
    const dir = projectDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const file = path.join(dir, f);
        const mtime = statSync(file).mtime;
        const lines = readFileSync(file, "utf8").split("\n").slice(0, 5);
        let preview = "(空)";
        for (const l of lines) {
          try {
            const m = JSON.parse(l);
            if (m.role === "user" && typeof m.content === "string") {
              preview = m.content.slice(0, 40).replace(/\n/g, " ");
              break;
            }
          } catch {
            /* skip */
          }
        }
        return { id: path.basename(f, ".jsonl"), mtime, preview };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  append(msg: OpenAI.ChatCompletionMessageParam): void {
    try {
      appendFileSync(this.file, JSON.stringify(msg) + "\n");
    } catch (e: any) {
      process.stderr.write(`[session] 写入失败: ${e.message}\n`);
    }
  }
}
