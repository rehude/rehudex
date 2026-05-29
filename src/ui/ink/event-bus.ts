import { EventEmitter } from "node:events";
import type { UiEvent, UiShortcut } from "../types.js";
import type OpenAI from "openai";

/**
 * Ink adapter <-> React 组件之间的事件桥接。
 * - InkAdapter.emit() 触发 "ui" 事件,App 组件订阅。
 * - InkAdapter.readInput() / confirm() 通过 "input"/"confirm" 事件等待 App 提交。
 * - InkAdapter.renderHistory() 通过 "history" 事件让 App 重置消息列表。
 */
export interface InkBus extends EventEmitter {
  emit(event: "ui", payload: UiEvent): boolean;
  emit(event: "history", payload: OpenAI.ChatCompletionMessageParam[]): boolean;
  emit(event: "askInput", payload: { prompt: string; resolve: (value: string) => void }): boolean;
  emit(event: "askConfirm", payload: { msg: string; resolve: (value: boolean) => void }): boolean;
  emit(event: "shortcut", payload: UiShortcut): boolean;
  on(event: "ui", listener: (payload: UiEvent) => void): this;
  on(event: "history", listener: (payload: OpenAI.ChatCompletionMessageParam[]) => void): this;
  on(event: "askInput", listener: (payload: { prompt: string; resolve: (value: string) => void }) => void): this;
  on(event: "askConfirm", listener: (payload: { msg: string; resolve: (value: boolean) => void }) => void): this;
  on(event: "shortcut", listener: (payload: UiShortcut) => void): this;
  off(event: "ui", listener: (payload: UiEvent) => void): this;
  off(event: "history", listener: (payload: OpenAI.ChatCompletionMessageParam[]) => void): this;
  off(event: "askInput", listener: (payload: { prompt: string; resolve: (value: string) => void }) => void): this;
  off(event: "askConfirm", listener: (payload: { msg: string; resolve: (value: boolean) => void }) => void): this;
  off(event: "shortcut", listener: (payload: UiShortcut) => void): this;
}

let bus: InkBus | null = null;

export function getInkBus(): InkBus {
  if (!bus) {
    const e = new EventEmitter() as InkBus;
    e.setMaxListeners(50);
    bus = e;
  }
  return bus;
}
