import OpenAI from "openai";

export function formatApiError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) {
    return "鉴权失败 (401):请检查 .env 中的 LLM_API_KEY 是否正确";
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return "无权限 (403):当前 API Key 无访问该模型的权限";
  }
  if (err instanceof OpenAI.RateLimitError) {
    return "请求被限流 (429):请稍后重试或降低调用频率";
  }
  if (err instanceof OpenAI.BadRequestError) {
    return `请求参数错误 (400):${err.message}`;
  }
  if (err instanceof OpenAI.NotFoundError) {
    return `资源未找到 (404):请确认 LLM_MODEL 或 LLM_BASE_URL 配置`;
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return "网络超时:无法连接到 LLM endpoint,请检查网络或 LLM_BASE_URL 配置";
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return `网络异常:${err.message}`;
  }
  if (err instanceof OpenAI.APIError) {
    return `API 错误 (${err.status ?? "?"}):${err.message}`;
  }
  if (err instanceof Error) return `运行时错误:${err.message}`;
  return `未知错误:${String(err)}`;
}
