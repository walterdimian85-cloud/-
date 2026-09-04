export async function callAnthropic({ ai, apiKey, systemPrompt, prompt, fetchImpl = fetch }) {
  const endpoint = `${ai.baseUrl.replace(/\/$/u, "")}/v1/messages`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic请求失败：${response.status} ${await response.text()}`);
  const payload = await response.json();
  return (payload.content || []).find((part) => part.type === "text")?.text || "";
}
