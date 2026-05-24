# 调试 / 抓包

想用 Reqable / Fiddler / mitmproxy / Charles 抓到程序与 DeepSeek 之间的 HTTP 请求,需要两件事:

1. **让 Node 走代理**:OpenAI SDK 底层是 Node 内置 `fetch`(undici),**默认不读 `HTTPS_PROXY`**,需要显式挂上 `EnvHttpProxyAgent`。
2. **让 Node 信任抓包工具的根证书**:用 `NODE_EXTRA_CA_CERTS` 指向导出的 CA 文件(PEM 格式)。

---

## 一次性准备

### ① 安装 undici

```bash
pnpm add -D undici
```

### ② 在项目根新建 `proxy-preload.cjs`

> 该文件已加入 `.gitignore`,首次使用需要手动创建。用 `.cjs` 后缀是因为 `--require` 只吃 CommonJS,跟项目 `"type": "module"` 不冲突。

```js
const { setGlobalDispatcher, EnvHttpProxyAgent } = require("undici");

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.error(
    `[proxy] enabled via ${process.env.HTTPS_PROXY || process.env.HTTP_PROXY}`,
  );
}
```

用 `EnvHttpProxyAgent` 而不是 `ProxyAgent` 的好处:自动读 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`,无需把端口写死在代码里。

### ③ `package.json` 已有 `dev:proxy` 脚本

```json
"dev:proxy": "tsx --require ./proxy-preload.cjs src/index.ts"
```

无 `HTTPS_PROXY` 时该脚本与 `pnpm dev` 行为一致——预加载脚本只在检测到代理环境变量时才挂代理。

### ④ 安装抓包工具的根 CA

以 Reqable 为例:打开 Reqable → 证书设置 → 导出 CA(选 PEM/Base-64 编码),保存为 `D:\reqable-ca.crt`。

Fiddler / mitmproxy / Charles 同理,导出 PEM 格式根证书即可。

---

## 每次抓包

### PowerShell 一键命令(以 Reqable @ 8888 为例)

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:8888"
$env:HTTP_PROXY  = "http://127.0.0.1:8888"
$env:NODE_EXTRA_CA_CERTS = "D:/reqable-ca.crt"
pnpm dev:proxy
```

### CMD 版本

```cmd
set HTTPS_PROXY=http://127.0.0.1:8888
set HTTP_PROXY=http://127.0.0.1:8888
set NODE_EXTRA_CA_CERTS=D:\reqable-ca.crt
pnpm dev:proxy
```

### Git Bash / Linux / macOS 版本

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
export HTTP_PROXY=http://127.0.0.1:8888
export NODE_EXTRA_CA_CERTS="D:/reqable-ca.crt"
pnpm dev:proxy
```

启动时看到 `[proxy] enabled via http://127.0.0.1:8888` 说明代理已挂上。问一句话,抓包工具里应能看到 `POST https://api.deepseek.com/v1/chat/completions`。

> ⚠️ 环境变量**只对当前终端窗口有效**,新开窗口要重新设。可以把上面命令存成 `dev-proxy.ps1` / `dev-proxy.bat`,以后一条命令搞定。

---

## 排查清单

| 现象 | 原因 |
|---|---|
| 没打印 `[proxy] enabled ...` | env var 没生效(常见于开了新窗口),或忘了用 `dev:proxy` 脚本 |
| 打印了但抓包工具没流量 | 端口不对,或抓包工具没启动 |
| `unable to verify the first certificate` / `self-signed certificate` | `NODE_EXTRA_CA_CERTS` 路径错,或证书是 DER 不是 PEM(记事本打开应看到 `-----BEGIN CERTIFICATE-----`) |
| `proxy-preload.cjs not found` | 没建文件,回到「一次性准备 ②」 |

---

## 重要提醒

> ⚠️ `NODE_EXTRA_CA_CERTS` **不能写在 `.env` 里**——Node 在 TLS 初始化阶段就读它,那时 dotenv 还没加载。必须在 `pnpm dev:proxy` 之前在 shell 里设好。

> 不需要抓包时,继续用 `pnpm dev` 即可,代理逻辑只在 `pnpm dev:proxy` 路径下生效。
