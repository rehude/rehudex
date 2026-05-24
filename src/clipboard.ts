import { spawn } from "node:child_process";
import { platform } from "node:os";

interface ClipCmd {
  cmd: string;
  args: string[];
  encoding: "utf8" | "utf16le-bom";
}

function candidates(): ClipCmd[] {
  switch (platform()) {
    case "win32":
      return [
        {
          cmd: "powershell",
          args: [
            "-NoProfile",
            "-Command",
            "[Console]::InputEncoding=[System.Text.Encoding]::UTF8;Set-Clipboard -Value ([Console]::In.ReadToEnd())",
          ],
          encoding: "utf8",
        },
        { cmd: "clip", args: [], encoding: "utf16le-bom" },
      ];
    case "darwin":
      return [{ cmd: "pbcopy", args: [], encoding: "utf8" }];
    default:
      return [
        { cmd: "wl-copy", args: [], encoding: "utf8" },
        { cmd: "xclip", args: ["-selection", "clipboard"], encoding: "utf8" },
        { cmd: "xsel", args: ["--clipboard", "--input"], encoding: "utf8" },
      ];
  }
}

function encodeText(text: string, enc: ClipCmd["encoding"]): Buffer {
  if (enc === "utf16le-bom") {
    return Buffer.from("﻿" + text, "utf16le");
  }
  return Buffer.from(text, "utf8");
}

function tryOne(text: string, c: ClipCmd): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(c.cmd, c.args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.on("error", reject);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${c.cmd} 退出码 ${code}${stderr ? ": " + stderr.trim() : ""}`));
    });
    child.stdin.end(encodeText(text, c.encoding));
  });
}

export async function copyToClipboard(text: string): Promise<void> {
  const cmds = candidates();
  let lastErr: unknown;
  for (const c of cmds) {
    try {
      await tryOne(text, c);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("没有可用的剪贴板工具(尝试了 " + cmds.map((c) => c.cmd).join(", ") + ")");
}
