export async function callOpenAi({ ai, apiKey, systemPrompt, prompt, fetchImpl = fetch }) {
  const endpoint = `${ai.baseUrl.replace(/\/$/u, "")}/responses`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI请求失败：${response.status} ${await response.text()}`);
  const payload = await response.json();
  if (payload.output_text) return payload.output_text;
  return (payload.output || []).flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text || "";
}
