import dotenv from "dotenv";
import path from "node:path";
import { homedir } from "node:os";

// 加载顺序(后者不覆盖前者已有的 key):
//   1. cwd/.env            —— 项目内私有配置(最高优先级)
//   2. ~/.rehudex/.env     —— 全局配置,一次性配置 API Key,所有项目共用
//   3. 系统环境变量         —— shell export 的 DEEPSEEK_API_KEY 等
dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });
dotenv.config({
  path: path.join(homedir(), ".rehudex", ".env"),
  quiet: true,
});

export const CFG = {
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  maxIterations: 39,
};

if (!CFG.apiKey) {
  throw new Error(
    "DEEPSEEK_API_KEY missing。请在以下任一位置配置:\n" +
      `  - ${path.join(process.cwd(), ".env")}\n` +
      `  - ${path.join(homedir(), ".rehudex", ".env")}\n` +
      "  - 系统环境变量",
  );
}
