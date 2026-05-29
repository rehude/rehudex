import type OpenAI from "openai";

// 基础输出事件类型
export type UiEventType =
  | "status"
  | "info"
  | "warning"
  | "error"
  | "userMessage"
  | "assistantStart"
  | "assistantDelta"
  | "assistantDone"
  | "reasoningStart"
  | "reasoningDelta"
  | "reasoningDone"
  | "toolCall"
  | "toolResult"
  | "shellStart"
  | "shellOutput"
  | "shellDone";

export interface UiEvent {
  type: UiEventType;
  data?: any;
}

// 具体事件类型定义
export interface StatusEvent extends UiEvent {
  type: "status";
  data: string;
}

export interface InfoEvent extends UiEvent {
  type: "info";
  data: string;
}

export interface WarningEvent extends UiEvent {
  type: "warning";
  data: string;
}

export interface ErrorEvent extends UiEvent {
  type: "error";
  data: string;
}

export interface UserMessageEvent extends UiEvent {
  type: "userMessage";
  data: string;
}

export interface AssistantStartEvent extends UiEvent {
  type: "assistantStart";
}

export interface AssistantDeltaEvent extends UiEvent {
  type: "assistantDelta";
  data: string;
}

export interface AssistantDoneEvent extends UiEvent {
  type: "assistantDone";
}

export interface ReasoningStartEvent extends UiEvent {
  type: "reasoningStart";
}

export interface ReasoningDeltaEvent extends UiEvent {
  type: "reasoningDelta";
  data: string;
}

export interface ReasoningDoneEvent extends UiEvent {
  type: "reasoningDone";
}

export interface ToolCallEvent extends UiEvent {
  type: "toolCall";
  data: {
    name: string;
    arguments: string;
  };
}

export interface ToolResultEvent extends UiEvent {
  type: "toolResult";
  data: {
    toolCallId: string;
    result: string;
  };
}

export interface ShellStartEvent extends UiEvent {
  type: "shellStart";
  data: {
    shell: string;
    cmd: string;
  };
}

export interface ShellOutputEvent extends UiEvent {
  type: "shellOutput";
  data: {
    stdout?: string;
    stderr?: string;
    error?: string;
  };
}

export interface ShellDoneEvent extends UiEvent {
  type: "shellDone";
}

// UI Adapter 接口
export interface UiAdapter {
  // 启动/停止 UI
  start(): Promise<void>;
  stop(): Promise<void>;

  // 用户输入
  readInput(prompt?: () => string): Promise<string>;

  // 用户确认（例如危险操作）
  confirm(msg: string): Promise<boolean>;

  // 发送 UI 事件
  emit(event: UiEvent): void;

  // 渲染历史消息（例如 /load 后重新显示）
  renderHistory(messages: OpenAI.ChatCompletionMessageParam[]): void;

  // 暂停/恢复 UI 渲染（例如运行外部程序或编辑器时）
  suspend(): Promise<void>;
  resume(): Promise<void>;

  // 可选:adapter 自己负责流式输出渲染时返回 true
  // 此时 agent.ts 不再调用 createStreamRenderer 写 stdout(避免与 Ink 等 TUI 冲突)
  ownsStreamRendering?: boolean;

  // 可选:adapter 提供自己的流式渲染器。classic 用 ANSI/md4x,TUI 可选择不提供。
  createStreamRenderer?(): StreamRenderer;
}

export interface StreamRenderer {
  write(delta: string): void;
  finish(): void;
  reset(): void;
}
