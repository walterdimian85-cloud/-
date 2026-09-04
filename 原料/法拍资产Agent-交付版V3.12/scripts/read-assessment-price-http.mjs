import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const [statePath, outputPath] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const candidates = state.records.map((record, index) => ({ record, index })).filter(({ record }) => !Number.isFinite(Number(record['评估价'])) || Number(record['评估价']) <= 0);
const prior = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : { results: [] };
const saved = new Map(prior.results.map((item) => [item.index, item]));
const persist = () => {
  const payload = { task: '20260820-assessment-price-readonly-evidence', updatedAt: new Date().toISOString(), results: [...saved.values()].sort((a, b) => a.index - b.index) };
  writeFileSync(`${outputPath}.tmp`, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(`${outputPath}.tmp`, outputPath);
};
const decode = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
for (const { record, index } of candidates) {
  if (saved.has(index)) continue;
  const url = record['网站链接'];
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
    const text = decode(await response.text());
    const match = text.match(/(评估价|市场参考价|市场价)\s*[:：]?\s*[￥¥]?\s*([\d,.]+)\s*(?:元)?/);
    const raw = match?.[2] ?? null;
    const value = raw ? Number(raw.replaceAll(',', '')) : null;
    saved.set(index, { index, url, label: match?.[1] ?? null, raw, value: Number.isFinite(value) && value > 0 ? value : null, httpStatus: response.status });
  } catch (error) {
    saved.set(index, { index, url, value: null, error: String(error.message).slice(0, 200) });
  }
  persist();
}
console.log(JSON.stringify({ total: saved.size, values: [...saved.values()].filter((x) => x.value).length }));
