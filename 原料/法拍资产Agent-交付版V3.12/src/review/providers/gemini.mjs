export async function callGemini({ ai, apiKey, systemPrompt, prompt, fetchImpl = fetch }) {
  const root = ai.baseUrl.replace(/\/$/u, "");
  const endpoint = `${root}/models/${encodeURIComponent(ai.model)}:generateContent`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error(`Gemini请求失败：${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}
