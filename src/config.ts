import "dotenv/config";

export const CFG = {
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  maxIterations: 39,
};

if (!CFG.apiKey) throw new Error("DEEPSEEK_API_KEY missing in .env");
