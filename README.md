# rehudex

一个跑在终端的命令行 AI 助手,基于 DeepSeek 大模型,具备流式输出、Markdown 富文本渲染、工具调用闭环能力。

## 特性

- 🚀 **流式输出**:文本边产生边打印,思考与回答分阶段展示
- 🎨 **终端 Markdown 富文本**:基于 [md4x](https://www.npmjs.com/package/md4x) 实时渲染标题/加粗/代码块等
- 🛠 **工具调用闭环**:Agent 主循环自动多轮调用工具直到任务完成
- 🔒 **沙箱保护**:文件操作限制在工作目录内,写文件 / 执行 shell 需用户确认
- 💬 **DeepSeek 思考模式兼容**:保留 `reasoning_content` 字段供 round-trip 使用
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
| 系统环境变量 | shell `export` 的 `DEEPSEEK_API_KEY` 等 |

**全局一次性配置(推荐):**

```bash
# Linux / macOS / Git Bash
mkdir -p ~/.rehudex
cat > ~/.rehudex/.env <<EOF
DEEPSEEK_API_KEY=sk-xxxxxxxx
EOF
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$HOME\.rehudex" | Out-Null
"DEEPSEEK_API_KEY=sk-xxxxxxxx" | Out-File -Encoding utf8 "$HOME\.rehudex\.env"
```

完整可选字段:

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com   # 可选,默认为官方地址
DEEPSEEK_MODEL=deepseek-chat                 # 可选,默认 deepseek-chat
```

申请 API Key:<https://platform.deepseek.com/>

## 启动

```bash
rehudex           # 在当前目录新建一个空白会话
rehudex -c        # 续接本目录最近一次会话
```

进入交互式 REPL,在 `>` 提示符后输入问题。`exit` 或 `Ctrl+C` 退出。

> 工具的读写范围与会话池都按 `rehudex` 启动时所在目录(cwd)隔离,**建议在项目根目录启动**。

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
├── llm.ts          # OpenAI SDK 封装(指向 DeepSeek)
├── session.ts      # 会话持久化(JSONL append-only)
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
pnpm install
pnpm dev        # 用 tsx 直接运行 TS 源码
pnpm build      # 编译到 dist/
pnpm start      # 运行编译产物
```

## 发布到 npm

```bash
pnpm build              # prepublishOnly 也会自动跑
npm publish             # 已登录 npm 后,一条命令发布
```

`package.json` 的 `files` 字段限定只打 `dist/` 和 `README.md`,不会带 `src/`、`.env` 出去。发布前可用 `npm pack` 干跑一遍验证。

## 调试 / 抓包

想用 Reqable / Fiddler / mitmproxy / Charles 抓到程序与 DeepSeek 之间的 HTTP 请求,见 [docs/debugging.md](docs/debugging.md)。

简要:设置 `HTTPS_PROXY` 与 `NODE_EXTRA_CA_CERTS` 两个环境变量,然后正常启动 `rehudex`(或 `pnpm dev`)即可。代理支持已内置在 `src/proxy.ts`。
