# easyAgent

一个跑在终端的命令行 AI 助手,基于 DeepSeek 大模型,具备流式输出、Markdown 富文本渲染、工具调用闭环能力。

## 特性

- 🚀 **流式输出**:文本边产生边打印,思考与回答分阶段展示
- 🎨 **终端 Markdown 富文本**:基于 [md4x](https://www.npmjs.com/package/md4x) 实时渲染标题/加粗/代码块等
- 🛠 **工具调用闭环**:Agent 主循环自动多轮调用工具直到任务完成
- 🔒 **沙箱保护**:文件操作限制在工作目录内,写文件 / 执行 shell 需用户确认
- 💬 **DeepSeek 思考模式兼容**:保留 `reasoning_content` 字段供 round-trip 使用

## 安装

```bash
pnpm install
```

需要 Node.js ≥ 20。

## 配置

复制 `.env.example` 为 `.env`,填入你的 DeepSeek API Key:

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选,默认为官方地址
DEEPSEEK_MODEL=deepseek-chat                 # 可选,默认 deepseek-chat
```

申请 API Key:<https://platform.deepseek.com/>

## 启动

```bash
pnpm dev
```

进入交互式 REPL,在 `>` 提示符后输入问题。`exit` 或 `Ctrl+C` 退出。

## 内置工具

| 工具 | 说明 | 需要确认 |
|---|---|---|
| `read_file` | 读取工作目录内某个文件的全部文本内容 | 否 |
| `write_file` | 将文本内容写入工作目录内的文件(可覆盖) | ✅ |
| `execute_shell` | 在工作目录下执行 shell 命令(默认 30 秒超时) | ✅ |

所有路径都经过 [safePath](src/tools/safePath.ts) 校验,无法越出 `cwd`。

## 示例

```
> 读 package.json,告诉我有哪些 dependencies
⚙ read_file({"path":"package.json"})
[回答]
当前 dependencies 有 4 个:
- dotenv ^17.4.2
- md4x ^0.0.25
- openai ^6.39.0
- picocolors ^1.1.1
(本轮 312 / 累计 312 tokens)
```

## 项目结构

```
src/
├── index.ts        # REPL 入口
├── agent.ts        # 多轮 tool_call Agent 主循环
├── llm.ts          # OpenAI SDK 封装(指向 DeepSeek)
├── render.ts       # 流式 Markdown 终端渲染
├── prompts.ts      # 系统提示词
├── config.ts       # 环境变量配置
├── confirm.ts      # 阻塞式 y/N 确认
├── errors.ts       # API 错误中文化
└── tools/
    ├── index.ts        # 工具注册表
    ├── safePath.ts     # 路径越界保护
    ├── readFile.ts
    ├── writeFile.ts
    └── shell.ts
```

## 开发

```bash
pnpm dev        # 用 tsx 直接运行 TS 源码
pnpm build      # 编译到 dist/
pnpm start      # 运行编译产物
```
