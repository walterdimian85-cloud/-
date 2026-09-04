import { callOpenAiCompatible } from "./openai-compatible.mjs";
import { callOpenAi } from "./openai.mjs";
import { callAnthropic } from "./anthropic.mjs";
import { callGemini } from "./gemini.mjs";

const providers = {
  deepseek: callOpenAiCompatible,
  alibaba: callOpenAiCompatible,
  openai_compatible: callOpenAiCompatible,
  openai: callOpenAi,
  anthropic: callAnthropic,
  gemini: callGemini,
};

export async function callReviewModel({ ai, apiKey, systemPrompt, prompt, fetchImpl = fetch }) {
  const client = providers[ai.provider];
  if (!client) throw new Error(`暂不支持AI服务商：${ai.provider}`);
  if (!ai.baseUrl) throw new Error("AI服务商缺少API地址");
  if (!ai.model) throw new Error("请选择或填写AI模型ID");
  return client({ ai, apiKey, systemPrompt, prompt, fetchImpl });
}
