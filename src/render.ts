import { renderToAnsi } from "md4x";
import pc from "picocolors";
import type OpenAI from "openai";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const REDRAW_INTERVAL_MS = 60;

let exitHandlerRegistered = false;
function ensureCursorRestoreOnExit() {
  if (exitHandlerRegistered) return;
  exitHandlerRegistered = true;
  process.on("exit", () => process.stdout.write(SHOW_CURSOR));
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6)
  );
}

function visualWidth(line: string): number {
  let w = 0;
  for (const ch of line.replace(ANSI_RE, "")) {
    w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

function visualRows(text: string, cols: number): number {
  const segments = text.split("\n");
  if (segments[segments.length - 1] === "") segments.pop();
  let rows = 0;
  for (const seg of segments) {
    rows += Math.max(1, Math.ceil(visualWidth(seg) / cols));
  }
  return rows;
}

export interface StreamRenderer {
  write(delta: string): void;
  finish(): void;
  reset(): void;
}

export function createStreamRenderer(): StreamRenderer {
  if (!process.stdout.isTTY) {
    return {
      write: (d) => void process.stdout.write(d),
      finish: () => {},
      reset: () => {},
    };
  }

  ensureCursorRestoreOnExit();

  let buffer = "";
  let prevRows = 0;
  let cursorHidden = false;
  let pendingTimer: NodeJS.Timeout | null = null;
  let lastRenderAt = 0;

  const hideCursor = () => {
    if (!cursorHidden) {
      process.stdout.write(HIDE_CURSOR);
      cursorHidden = true;
    }
  };
  const showCursor = () => {
    if (cursorHidden) {
      process.stdout.write(SHOW_CURSOR);
      cursorHidden = false;
    }
  };

  const redraw = (heal: boolean) => {
    let out = renderToAnsi(buffer, { heal });
    if (!out.endsWith("\n")) out += "\n";
    const cols = process.stdout.columns || 80;
    const move = prevRows > 0 ? `\x1b[${prevRows}A\r\x1b[J` : "\r\x1b[J";
    process.stdout.write(move + out);
    prevRows = visualRows(out, cols);
    lastRenderAt = Date.now();
  };

  const cancelTimer = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  return {
    write(delta) {
      buffer += delta;
      hideCursor();
      if (pendingTimer) return;
      const elapsed = Date.now() - lastRenderAt;
      if (elapsed >= REDRAW_INTERVAL_MS) {
        redraw(true);
      } else {
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          redraw(true);
        }, REDRAW_INTERVAL_MS - elapsed);
      }
    },
    finish() {
      cancelTimer();
      redraw(false);
      prevRows = 0;
      showCursor();
    },
    reset() {
      cancelTimer();
      buffer = "";
      prevRows = 0;
      lastRenderAt = 0;
      showCursor();
    },
  };
}

export function renderHistory(
  messages: OpenAI.ChatCompletionMessageParam[],
): void {
  for (const m of messages) {
    if (m.role === "user") {
      const content = typeof m.content === "string" ? m.content : "";
      if (content) process.stdout.write(pc.green("> ") + content + "\n");
    } else if (m.role === "assistant") {
      const content = typeof m.content === "string" ? m.content : "";
      if (content) {
        process.stdout.write(pc.cyan("[回答]\n"));
        let out = renderToAnsi(content);
        if (!out.endsWith("\n")) out += "\n";
        process.stdout.write(out);
      }
      if (m.tool_calls?.length) {
        for (const call of m.tool_calls) {
          if (call.type === "function") {
            process.stdout.write(
              pc.yellow(
                `⚙ ${call.function.name}(${call.function.arguments})`,
              ) + "\n",
            );
          }
        }
      }
    }
  }
}
