export async function callOpenAiCompatible({ ai, apiKey, systemPrompt, prompt, fetchImpl = fetch }) {
  const endpoint = `${ai.baseUrl.replace(/\/$/u, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`${ai.provider}请求失败：${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}
