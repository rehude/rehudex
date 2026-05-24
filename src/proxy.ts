// 把抓包代理支持烧进编译产物。
// 行为:仅当存在 HTTPS_PROXY / HTTP_PROXY 环境变量时,挂上 undici 的 EnvHttpProxyAgent,
// 让 OpenAI SDK(底层 fetch / undici)的请求走代理。否则一行 if 直接跳过。
// EnvHttpProxyAgent 会自动遵循 HTTPS_PROXY / HTTP_PROXY / NO_PROXY 三个标准变量。

import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.error(`[proxy] enabled via ${proxy}`);
}
