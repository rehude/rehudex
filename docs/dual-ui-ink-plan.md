# 渐进式双 UI 架构实施计划

本文档用于跟踪 reهدudex 从当前 readline/ANSI 终端实现，渐进迁移到 classic + Ink 双 UI 架构的实施过程。

## 目标

- 默认使用 Ink UI，保留 classic UI 作为显式兼容/回退入口。
- 渐进增强 Ink UI，不一次性重写 agent 核心逻辑。
- 将输入、输出、状态、工具调用展示从业务逻辑中抽离，形成可替换 UI backend。
- 保持 JSONL 会话、工具调用闭环、`@path` 展开、`!cmd` shell、slash command 等现有能力。

## 非目标

- 第一阶段不重写 LLM、tool registry、session 存储。
- 第一阶段不追求完整富 Markdown 组件化渲染。
- 第一阶段不移除 readline classic UI。
- 默认 UI 已切换为 Ink；classic 仅作为兼容模式和非 TTY 回退。

## 总体策略

采用渐进式双 UI 架构：

1. 先抽象 UI 事件和交互接口。
2. 用 classic backend 复刻当前行为，确保功能不退化。
3. 再新增 Ink backend，逐步接管输入框、状态栏、会话列表和流式输出。
4. 最后根据稳定性决定是否切换默认 UI。

## 当前进度快照

- 当前代码已搭好 classic + Ink 双 UI 骨架。
- `pnpm build` 已通过。
- Ink 已切换为默认 UI，classic 保留为 `--ui classic` 兼容模式。
- Ink UI 已有实验入口、基础输入框、补全候选、消息区、状态区、流式输出区。
- 本轮已修复 Ink MVP 的闭环问题：启动前事件丢失、普通回答不固化、用户消息不展示、Ctrl+C 输入挂起。
- 开发目标已完成；剩余仅为后续真实使用反馈与可选配置偏好。

## 阶段 0：现状基线

- [x] 跑通 `pnpm build`，记录当前 TypeScript 基线。
- [x] 确认 `pnpm dev` 下普通聊天、流式输出、工具调用正常。
- [x] 确认 `/help`、`/list`、`/load`、`/new`、`/clear`、`/edit`、`/compact`、`/copy`、`/export` 行为。
- [x] 确认 `!cmd` shell 直跑行为。
- [x] 确认 `/` 命令补全和 `@path` 文件补全。
- [x] 记录当前必须保持兼容的终端行为。

## 阶段 1：抽离 UI Adapter

### 1.1 定义 UI 事件模型

- [x] 新增 `src/ui/types.ts`。
- [x] 定义基础输出事件：
  - [x] `status`
  - [x] `info`
  - [x] `warning`
  - [x] `error`
  - [x] `userMessage`
  - [x] `assistantStart`
  - [x] `assistantDelta`
  - [x] `assistantDone`
  - [x] `reasoningStart`
  - [x] `reasoningDelta`
  - [x] `reasoningDone`
  - [x] `toolCall`
  - [x] `toolResult`
  - [x] `shellStart`
  - [x] `shellOutput`
  - [x] `shellDone`
- [x] 定义 `UiAdapter` 接口：
  - [x] `start()`
  - [x] `stop()`
  - [x] `readInput()`
  - [x] `confirm()`
  - [x] `emit(event)`
  - [x] `renderHistory(messages)`
  - [x] `suspend()`
  - [x] `resume()`

### 1.2 接入 classic backend

- [x] 新增 `src/ui/classic.ts`。
- [x] 将当前 `readline` 输入逻辑迁移到 classic adapter。
- [x] 将当前 `buildPrompt()` token 展示逻辑接入 classic adapter。
- [x] 保留同步 completer，不改 `src/completer.ts` 的同步约束。
- [x] 将 `src/render.ts` 的流式 Markdown 渲染封装进 classic adapter。
- [x] 将 `renderHistory()` 封装进 classic adapter。
- [x] 确认 classic backend 下视觉行为与当前版本一致。

### 1.3 收敛直接 stdout 输出

- [x] 改造 `src/index.ts`，主循环通过 `UiAdapter` 输入输出。
- [x] 改造 `src/agent.ts`，移除 agent 内直接 `console.log` / `process.stdout.write`，改为发 UI 事件。
- [x] 改造 `src/commands.ts` 中用户可见输出，改为通过命令上下文里的 UI 输出能力。
- [x] 改造 `src/confirm.ts`，确认交互走 `UiAdapter.confirm()`。
- [x] 保留工具内部返回 string，不让工具直接负责 UI 展示。
- [x] 避免改动 `src/tools/safePath.ts` 相关安全边界。

## 阶段 2：CLI 入口选择 UI

- [x] 新增启动参数解析：
  - [x] 默认 `ink`
  - [x] 支持 `--ui classic`
  - [x] 支持 `--ui ink`
- [x] 新增 `src/ui/index.ts`，按参数创建对应 adapter。
- [x] 当非 TTY 环境运行时，强制回退 classic 或 simple output。
- [x] `-c` 继续会话逻辑保持不变。
- [x] 确认 `rehudex` 默认进入 Ink UI。

## 阶段 3：新增 Ink 依赖和编译配置

- [x] 增加依赖：
  - [x] `ink`
  - [x] `react`
  - [x] 必要时增加 `@types/react`
- [x] 评估 TypeScript JSX 配置：
  - [x] 是否需要 `.tsx`
  - [x] 是否需要调整 `tsconfig.json`
  - [x] 是否影响 ESM `.js` 后缀导入约定
- [x] 新增 `src/ui/ink/` 目录。
- [x] 新增最小 Ink 启动页，先只展示状态和输入占位。
- [x] 跑通 `pnpm build`。

## 阶段 4：Ink UI MVP

### 4.1 基础布局

- [x] 实现 Ink App 组件。
- [x] 页面划分：
  - [x] 会话消息区
  - [x] 流式输出区
  - [x] 工具调用区
  - [x] 底部输入区
  - [x] 状态栏
- [x] 状态栏展示：
  - [x] session id
  - [x] token usage
  - [x] cwd
  - [x] 当前模型或 endpoint 简要信息
  - [x] busy / idle 状态

### 4.2 输入框

- [x] 实现单行输入。
- [x] 支持 Enter 提交。
- [x] 支持 Ctrl+C 退出。
- [x] 支持空输入忽略。
- [x] 支持 `exit` 退出。
- [x] 支持行尾 `\` 多行续写。

### 4.3 Slash command

- [x] 支持 `/cmd args` 分发到现有 command registry。
- [x] 支持 Tab 补全。
- [x] 展示未知命令错误。
- [x] 确认 `/help` 可在 Ink 消息区展示。

### 4.4 普通 agent 消息

- [x] 输入提交后进入现有 `agentRun()`。
- [x] assistant delta 实时更新当前回复。
- [x] 完成后固化为一条 assistant 消息。
- [x] 工具调用以独立块展示。
- [x] token usage 更新到状态栏。

## 阶段 5：Ink 补全和附件体验

- [x] 复用 `src/completer.ts` 的命令补全数据。
- [x] 为 Ink 输入框实现 `/` 命令候选。
- [x] 为 Ink 输入框实现 `@path` 文件候选。
- [x] 保持文件路径解析继续经过 `safePath()`。
- [x] 支持 Tab 接受候选。
- [x] 支持上下键选择候选。
- [x] 支持 Esc 关闭候选。
- [x] `@path` 展开结果在 UI 中显示附件提示。

## 阶段 6：外部程序和 shell 兼容

- [x] 为 Ink adapter 实现 `suspend()` / `resume()`。
- [x] `!cmd` 执行时进入 shell busy 状态，结束后恢复渲染。
- [x] shell stdout/stderr 结束后作为消息块写回 UI。
- [x] `/edit` 打开外部编辑器前暂停 Ink 渲染。
- [x] 外部编辑器返回后恢复 Ink 渲染。
- [x] 工具里的 shell 执行确认流程走 Ink confirm UI。
- [x] 非交互环境下继续自动拒绝危险确认。

## 阶段 7：Markdown 渲染增强

- [x] MVP 阶段先接受纯文本或 ANSI Markdown 输出。
- [x] 评估 Ink 中 Markdown 渲染方案：
  - [ ] 继续使用 `md4x` 转 ANSI
  - [ ] 引入 Ink Markdown 组件
  - [x] 自己做轻量 code block / list / heading 渲染
- [x] 优先支持：
  - [x] code block
  - [x] inline code
  - [x] heading
  - [x] list
  - [x] bold / dim
- [x] 确认中文宽字符不会导致布局错位。
- [x] 确认流式未闭合 Markdown 片段不会闪烁严重。

## 阶段 8：回归验证

- [x] `pnpm build` 通过。
- [x] `pnpm dev -- --ui classic` 通过基础流程。
- [x] `pnpm dev -- --ui ink` 通过基础流程。
- [x] 普通聊天流式输出正常。
- [x] 工具调用闭环正常。
- [x] `!cmd` 正常。
- [x] `/edit` 正常。
- [x] `/load` 后历史渲染正常。
- [x] `/compact` 流式摘要正常。
- [x] Ctrl+C 能恢复光标并干净退出。
- [x] Windows PowerShell 下表现正常。
- [x] 非 TTY 或管道输出不崩溃。

## 阶段 9：发布策略

- [x] 初次发布改为 Ink 默认 UI。
- [x] README 中说明默认 Ink 与 classic 兼容模式。
- [x] 收集真实使用问题后再考虑默认切换。
- [ ] 如果 Ink 稳定，再考虑：
  - [x] 默认使用 Ink
  - [x] `--ui classic` 作为兼容模式
  - [ ] 配置文件中持久化 UI 偏好

## 关键风险

- readline 和 Ink 都会接管 stdin/stdout，不能在同一运行态长期混用。
- 当前流式渲染依赖 ANSI 上移和清屏，迁移到 Ink 需要改为状态驱动渲染。
- slash command 当前直接输出到 console，必须逐步收敛到 UI adapter。
- `/edit`、shell、确认提示属于终端控制权切换点，需要专门处理。
- 中文宽字符、ANSI 控制码、Markdown 流式修复都可能造成布局错位。
- ESM `.js` 后缀导入约定必须继续遵守。

## 建议提交顺序

1. `ui: add adapter types and classic backend`
2. `refactor: route agent output through ui adapter`
3. `refactor: route commands through ui adapter`
4. `cli: add ui selection flag`
5. `ui: add experimental ink shell`
6. `ui: implement ink input and message stream`
7. `ui: add ink completions and suspend handling`
8. `ui: polish markdown and regression fixes`

## 变更记录

- 2026-05-29：补上 Ink 状态栏完整信息；显示 session、tokens、cwd、model、endpoint 和 busy/idle 状态；`!cmd` 执行期间进入 shell busy 状态。
- 2026-05-29：补上 Ink 输入补全候选；`/` 命令和 `@path` 文件路径可显示候选，支持 Tab 接受、上下键选择、Esc 关闭。
- 2026-05-29：同步代码进度；双 UI 骨架、classic adapter、Ink MVP 雏形、CLI UI 参数、Ink 依赖和 TypeScript JSX 配置已完成。保留完整回归、Markdown 精细化等后续任务。
- 2026-05-26：创建初版计划。
- 2026-05-29：默认 UI 切换为 Ink；`--ui classic` 保留为显式兼容模式，非 TTY 环境仍回退 classic。
- 2026-05-29：完成收尾开发；修复非 TTY 管道输入批处理，classic 流式渲染封装到 adapter，Ink 增加轻量 Markdown 结构化渲染，README 更新默认 Ink 说明。
