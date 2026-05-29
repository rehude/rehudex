import React from "react";
import { render, type Instance } from "ink";
import type OpenAI from "openai";
import type { UiAdapter, UiEvent, UiShortcut } from "../types.js";
import { App } from "./App.js";
import { getInkBus } from "./event-bus.js";

export class InkAdapter implements UiAdapter {
  readonly ownsStreamRendering = true;
  private instance: Instance | null = null;
  private bus = getInkBus();
  private shortcutHandler: ((shortcut: UiShortcut) => void) | null = null;
  private shortcutListenerActive = false;

  async start(): Promise<void> {
    this.instance = render(<App />, {
      // 由我们自己处理 SIGINT,避免 Ink 默认行为冲突
      exitOnCtrlC: false,
    });
    this.attachShortcutListener();
  }

  async stop(): Promise<void> {
    this.detachShortcutListener();
    if (this.instance) {
      this.instance.unmount();
      await this.instance.waitUntilExit().catch(() => {});
      this.instance = null;
    }
  }

  async readInput(prompt?: () => string): Promise<string> {
    return new Promise<string>((resolve) => {
      const promptStr = prompt ? prompt() : "> ";
      // 去除 ANSI 颜色,Ink 自己上色
      const clean = promptStr.replace(/\x1b\[[0-9;]*m/g, "");
      this.bus.emit("askInput", { prompt: clean, resolve });
    });
  }

  async confirm(msg: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.bus.emit("askConfirm", { msg, resolve });
    });
  }

  emit(event: UiEvent): void {
    this.bus.emit("ui", event);
  }

  setShortcutHandler(handler: ((shortcut: UiShortcut) => void) | null): void {
    this.shortcutHandler = handler;
  }

  renderHistory(messages: OpenAI.ChatCompletionMessageParam[]): void {
    this.bus.emit("history", messages);
  }

  async suspend(): Promise<void> {
    this.detachShortcutListener();
    if (this.instance) {
      this.instance.unmount();
      await this.instance.waitUntilExit().catch(() => {});
      this.instance = null;
    }
    // 给 stdin raw mode 一点时间释放
    await new Promise((r) => setTimeout(r, 100));
  }

  async resume(): Promise<void> {
    if (!this.instance) {
      this.instance = render(<App />, { exitOnCtrlC: false });
      this.attachShortcutListener();
    }
  }

  private handleShortcut = (shortcut: UiShortcut): void => {
    this.shortcutHandler?.(shortcut);
  };

  private attachShortcutListener(): void {
    if (this.shortcutListenerActive) return;
    this.bus.on("shortcut", this.handleShortcut);
    this.shortcutListenerActive = true;
  }

  private detachShortcutListener(): void {
    if (!this.shortcutListenerActive) return;
    this.bus.off("shortcut", this.handleShortcut);
    this.shortcutListenerActive = false;
  }
}
