# rehudex

一个跑在终端的命令行 AI 助手,对接**任意兼容 OpenAI SDK 的 LLM endpoint**(DeepSeek、小米 mimo、智谱、Moonshot、本地 vLLM/Ollama 等),具备流式输出、Markdown 富文本渲染、工具调用闭环能力。

📦 已发布到 npm:<https://www.npmjs.com/package/rehudex>

## 特性

- 🚀 **流式输出**:文本边产生边打印,思考与回答分阶段展示
- 🎨 **终端 Markdown 富文本**:基于 [md4x](https://www.npmjs.com/package/md4x) 实时渲染标题/加粗/代码块等
- 🛠 **工具调用闭环**:Agent 主循环自动多轮调用工具直到任务完成
- 🔒 **沙箱保护**:文件操作限制在工作目录内,写文件 / 执行 shell 需用户确认
- 💬 **思考模式兼容**:保留 `reasoning_content` 字段供 round-trip 使用(DeepSeek-R1 / OpenAI o 系列等)
- 💾 **会话持久化**:每条消息追加写入 JSONL,按项目 cwd 隔离,支持 `-c` 续接与 `/load` 跳转

## 安装

```bash
npm i -g rehudex
# 或
pnpm add -g rehudex
```

需要 Node.js ≥ 20。

## 配置

`rehudex` 按以下顺序加载 `.env`(前者优先,不覆盖后者):

| 位置 | 用途 |
|---|---|
| `<当前目录>/.env` | 项目内私有配置(覆盖全局) |
| `~/.rehudex/.env` | **全局配置,推荐**,一次配好所有项目共用 |
| 系统环境变量 | shell `export` 的 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` |

**全局一次性配置(推荐):**

```bash
# Linux / macOS / Git Bash
mkdir -p ~/.rehudex
cat > ~/.rehudex/.env <<EOF
LLM_API_KEY=sk-xxxxxxxx
EOF
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$HOME\.rehudex" | Out-Null
"LLM_API_KEY=sk-xxxxxxxx" | Out-File -Encoding utf8 "$HOME\.rehudex\.env"
```

完整可选字段(三个变量都是 endpoint-agnostic,指向哪家由 `LLM_BASE_URL` 决定):

```
# 必填:API Key
LLM_API_KEY=sk-xxxxxxxx

# 可选:endpoint(默认 https://api.deepseek.com)
# 示例:
#   DeepSeek 官方  → https://api.deepseek.com
#   小米 mimo      → https://token-plan-cn.xiaomimimo.com/anthropic
#   智谱 GLM       → https://open.bigmodel.cn/api/paas/v4
#   本地 Ollama    → http://127.0.0.1:11434/v1
LLM_BASE_URL=https://api.deepseek.com

# 可选:模型名(默认 deepseek-chat,按 endpoint 换)
LLM_MODEL=deepseek-chat
```

只要你的 LLM 服务实现了 OpenAI Chat Completions 协议(`/chat/completions` + tool calling),就能直接对接。

## 启动

```bash
rehudex                 # 在当前目录新建一个空白会话,默认使用 Ink UI
rehudex -c              # 续接本目录最近一次会话,默认使用 Ink UI
rehudex --ui classic    # 使用 classic 兼容模式
```

进入交互式 REPL,在 `>` 提示符后输入问题。`exit` 或 `Ctrl+C` 退出。

> 工具的读写范围与会话池都按 `rehudex` 启动时所在目录(cwd)隔离,**建议在项目根目录启动**。

## 终端 UI

默认 UI 是 Ink:

- 顶部状态栏显示 session、累计 tokens、cwd、model、endpoint 与 busy/idle 状态。
- 输入框支持 `/` 命令候选与 `@path` 文件候选。
- `Tab` 接受候选,`↑` / `↓` 选择候选,`Esc` 关闭候选。
- `!cmd` 执行时会进入 shell busy 状态,结束后把 stdout/stderr 作为 shell 消息块展示。
- Markdown 在 Ink 中按标题、列表、代码块、inline code、粗体等基础结构渲染。

`--ui classic` 保留为兼容模式,也会在非 TTY / 管道输入场景自动使用。

## 会话管理

每条消息(system / user / assistant / tool)实时追加到 JSONL 文件中,按当前工作目录天然隔离:

```
~/.rehudex/projects/<cwd 编码>/<sessionUUID>.jsonl
```

cwd 编码规则:把路径里的 `\` `/` `:` 全替换为 `-`(与 Claude Code 一致)。

REPL 内置命令:

| 命令 | 说明 |
|---|---|
| `/new` | 开一个全新会话(当前会话不丢,文件保留) |
| `/list` | 列出本项目所有会话(按修改时间倒序,显示 ID 前 8 位 + 首条用户消息) |
| `/load <id前8位>` | 跳到指定会话,支持任意长度前缀(冲突会提示) |
| `exit` | 退出 |

启动参数:

| 参数 | 说明 |
|---|---|
| `-c` | 续接本项目最近一次会话,无历史则自动新建 |
| `--ui ink` | 使用 Ink UI(默认) |
| `--ui classic` | 使用 classic 兼容模式 |

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
├── index.ts        # REPL 入口 + 启动参数 / 斜杠命令分发
├── agent.ts        # 多轮 tool_call Agent 主循环
├── commands.ts     # Slash command 注册表
├── completer.ts    # / 命令与 @path 补全 / 附件展开
├── llm.ts          # OpenAI SDK 封装(指向任意兼容 endpoint)
├── session.ts      # 会话持久化(JSONL append-only)
├── render.ts       # classic UI 的流式 Markdown 终端渲染
├── prompts.ts      # 系统提示词
├── config.ts       # 环境变量配置
├── confirm.ts      # 阻塞式 y/N 确认
├── errors.ts       # API 错误中文化
├── ui/
│   ├── types.ts        # UI adapter 接口与事件类型
│   ├── classic.ts      # classic 兼容 UI
│   └── ink/            # 默认 Ink TUI
└── tools/
    ├── index.ts        # 工具注册表
    ├── safePath.ts     # 路径越界保护
    ├── readFile.ts
    ├── writeFile.ts
    └── shell.ts
```

## 开发

```bash
pnpm install
pnpm dev        # 用 tsx 直接运行 TS 源码
pnpm build      # 编译到 dist/
pnpm start      # 运行编译产物
```

## 发布到 npm

见 [docs/publishing.md](docs/publishing.md)。包含首次准备(npm login + 2FA)、每次发版流程(`npm version` / `npm publish` + OTP)、`files` 字段说明、常见报错排查。

## 调试 / 抓包

想用 Reqable / Fiddler / mitmproxy / Charles 抓到程序与 LLM endpoint 之间的 HTTP 请求,见 [docs/debugging.md](docs/debugging.md)。

简要:设置 `HTTPS_PROXY` 与 `NODE_EXTRA_CA_CERTS` 两个环境变量,然后正常启动 `rehudex`(或 `pnpm dev`)即可。代理支持已内置在 `src/proxy.ts`。
