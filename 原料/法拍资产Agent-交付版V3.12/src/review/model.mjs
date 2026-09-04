import { parseModelJson } from "./candidates.mjs";
import { buildReviewPrompt, REVIEW_SYSTEM_PROMPT } from "./prompt.mjs";
import { callReviewModel } from "./providers/index.mjs";

export async function reviewWithConfiguredModel({ config, record, reasons, pageEvidence, rulesPath }) {
  const apiKey = process.env[config.ai.apiKeyEnv];
  if (!apiKey) throw new Error(`未设置环境变量${config.ai.apiKeyEnv}`);
  const prompt = await buildReviewPrompt({ record, reasons, pageEvidence, rulesPath });
  const text = await callReviewModel({ ai: config.ai, apiKey, systemPrompt: REVIEW_SYSTEM_PROMPT, prompt });
  return parseModelJson(text);
}
