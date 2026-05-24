# 调试 / 抓包

想用 Reqable / Fiddler / mitmproxy / Charles 抓到程序与 DeepSeek 之间的 HTTP 请求,需要两件事:

1. **让 Node 走代理**:`rehudex` 内置 [src/proxy.ts](../src/proxy.ts),启动时若检测到 `HTTPS_PROXY` / `HTTP_PROXY`,自动挂上 undici `EnvHttpProxyAgent`,无需额外脚本。
2. **让 Node 信任抓包工具的根证书**:用 `NODE_EXTRA_CA_CERTS` 指向导出的 CA 文件(PEM 格式)。

> dev (`pnpm dev`) 和 prod (`rehudex`) 走的是同一份代理逻辑,没有区别。

---

## 一次性准备:导出抓包工具的根 CA

以 Reqable 为例:打开 Reqable → 证书设置 → 导出 CA(选 **PEM / Base-64 编码**),保存为 `D:\reqable-ca.crt`。

Fiddler / mitmproxy / Charles 同理,导出 PEM 格式根证书即可。

> 验证证书格式:记事本打开,开头应该是 `-----BEGIN CERTIFICATE-----`。是乱码 = DER 二进制格式,Node 用不了,需要重新导出选 Base-64。

---

## 每次抓包:设两个环境变量,正常启动

### PowerShell(以 Reqable @ 8888 为例)

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:8888"
$env:HTTP_PROXY  = "http://127.0.0.1:8888"
$env:NODE_EXTRA_CA_CERTS = "D:/reqable-ca.crt"

# 然后正常启动 —— 开发期或装好后,选一个:
pnpm dev          # 开发期跑源码
rehudex           # 装好后的全局命令
```

### CMD

```cmd
set HTTPS_PROXY=http://127.0.0.1:8888
set HTTP_PROXY=http://127.0.0.1:8888
set NODE_EXTRA_CA_CERTS=D:\reqable-ca.crt
rehudex
```

### Git Bash / Linux / macOS

```bash
export HTTPS_PROXY=http://127.0.0.1:8888
export HTTP_PROXY=http://127.0.0.1:8888
export NODE_EXTRA_CA_CERTS="/path/to/reqable-ca.crt"
rehudex
```

启动时看到 `[proxy] enabled via http://127.0.0.1:8888` 说明代理已挂上。问一句话,抓包工具里应能看到 `POST https://api.deepseek.com/v1/chat/completions`。

> ⚠️ 环境变量**只对当前终端窗口有效**,新开窗口要重新设。可以做成 `dev-proxy.ps1` / `dev-proxy.bat` 一键脚本。

---

## 排查清单

| 现象 | 原因 |
|---|---|
| 没打印 `[proxy] enabled ...` | env var 没生效(常见于开了新窗口) |
| 打印了但抓包工具没流量 | 端口不对,或抓包工具没启动 |
| `unable to verify the first certificate` / `self-signed certificate` | `NODE_EXTRA_CA_CERTS` 路径错,或证书是 DER 不是 PEM |

---

## 重要提醒

> ⚠️ `NODE_EXTRA_CA_CERTS` **不能写在 `.env` 里**——Node 在 TLS 初始化阶段就读它,那时 dotenv 还没加载。必须在启动 `rehudex` / `pnpm dev` 之前在 shell 里设好。

> 不需要抓包时,不设这俩环境变量即可,`src/proxy.ts` 的 `if` 直接跳过,零开销。
