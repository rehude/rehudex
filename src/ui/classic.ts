import pc from "picocolors";
import readline from "node:readline/promises";
import { createStreamRenderer, renderHistory } from "../render.js";
import { getRL, closeRL } from "../cli.js";
import type OpenAI from "openai";
import type { StreamRenderer, UiAdapter, UiEvent } from "./types.js";

export class ClassicAdapter implements UiAdapter {
  private rl: readline.Interface | null = null;
  private suspended = false;
  private cursorHidden = false;
  private readonly HIDE_CURSOR = "\x1b[?25l";
  private readonly SHOW_CURSOR = "\x1b[?25h";

  async start(): Promise<void> {
    // readline completer 会在 index.ts 初始化时设置，这里只获取引用
    this.rl = getRL();
  }

  async stop(): Promise<void> {
    this.showCursor();
    closeRL();
    this.rl = null;
  }

  async readInput(prompt?: () => string): Promise<string> {
    if (!this.rl) throw new Error("UI not started");
    const parts: string[] = [];
    let first = true;
    while (true) {
      const promptStr = first && prompt ? prompt() : pc.green("> ");
      first = false;
      try {
        const line = await this.rl.question(promptStr);
        if (line.endsWith("\\")) {
          parts.push(line.slice(0, -1));
          continue;
        }
        parts.push(line);
        return parts.join("\n");
      } catch {
        throw new Error("Input interrupted");
      }
    }
  }

  async confirm(msg: string): Promise<boolean> {
    if (!process.stdin.isTTY) {
      this.emit({ type: "warning", data: `${msg} (非交互终端,自动拒绝)` });
      return false;
    }
    if (!this.rl) throw new Error("UI not started");
    try {
      const ans = (await this.rl.question(pc.yellow(`${msg} (y/N) `))).trim().toLowerCase();
      return ans === "y" || ans === "yes";
    } catch {
      return false;
    }
  }

  emit(event: UiEvent): void {
    switch (event.type) {
      case "status":
        console.log(pc.cyan(event.data));
        break;
      case "info":
        console.log(pc.cyan(event.data));
        break;
      case "warning":
        console.log(pc.yellow(event.data));
        break;
      case "error":
        console.log(pc.red(event.data));
        break;
      case "userMessage":
        // classic 模式不单独显示用户消息，因为 readline 已经显示过了
        break;
      case "assistantStart":
      case "assistantDelta":
      case "assistantDone":
      case "reasoningStart":
      case "reasoningDelta":
      case "reasoningDone":
        // classic 模式下流式输出由 src/render.ts 的 createStreamRenderer 独占负责
        // (ANSI 上移清屏 + md4x 渲染 + 60ms 节流);此处保持空实现避免双写
        break;
      case "toolCall":
        console.log(pc.yellow(`⚙ ${event.data.name}(${event.data.arguments})`));
        break;
      case "toolResult":
        // 工具结果一般不直接显示，但可选择显示
        break;
      case "shellStart":
        console.log(pc.yellow(`⚙ ${event.data.shell} $ ${event.data.cmd}`));
        break;
      case "shellOutput":
        if (event.data.stdout) {
          process.stdout.write(
            event.data.stdout.endsWith("\n") ? event.data.stdout : event.data.stdout + "\n",
          );
        }
        if (event.data.stderr) {
          process.stderr.write(
            pc.red(event.data.stderr.endsWith("\n") ? event.data.stderr : event.data.stderr + "\n"),
          );
        }
        if (event.data.error) {
          console.log(pc.red(`命令异常: ${event.data.error}`));
        }
        break;
      case "shellDone":
        // 可选：显示完成标记
        break;
    }
  }

  renderHistory(messages: OpenAI.ChatCompletionMessageParam[]): void {
    renderHistory(messages);
  }

  createStreamRenderer(): StreamRenderer {
    return createStreamRenderer();
  }

  async suspend(): Promise<void> {
    this.suspended = true;
    this.showCursor();
  }

  async resume(): Promise<void> {
    this.suspended = false;
  }

  private showCursor(): void {
    if (this.cursorHidden) {
      process.stdout.write(this.SHOW_CURSOR);
      this.cursorHidden = false;
    }
  }

  private hideCursor(): void {
    if (!this.cursorHidden) {
      process.stdout.write(this.HIDE_CURSOR);
      this.cursorHidden = true;
    }
  }
}
