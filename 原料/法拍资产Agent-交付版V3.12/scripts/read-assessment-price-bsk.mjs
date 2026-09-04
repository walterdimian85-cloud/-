import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [statePath, session, offsetArg = '0', limitArg = '8', outputPath] = process.argv.slice(2);
if (!statePath || !session) throw new Error('Usage: node scripts/read-assessment-price-bsk.mjs <progress.json> <bsk-session>');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const allMissing = state.records
  .map((record, index) => ({ record, index }))
  .filter(({ record }) => !Number.isFinite(Number(record['评估价'])) || Number(record['评估价']) <= 0);
const offset = Number(offsetArg);
const limit = Number(limitArg);
const missing = allMissing.slice(offset, offset + limit);
const run = (args) => execFileSync('bsk', args, { encoding: 'utf8', timeout: 12000, windowsHide: true });
const results = [];
const persist = () => {
  if (!outputPath) return;
  const prior = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, 'utf8')) : { results: [] };
  const merged = new Map(prior.results.map((item) => [item.index, item]));
  for (const result of results) merged.set(result.index, result);
  const next = { task: '20260820-assessment-price-readonly-evidence', updatedAt: new Date().toISOString(), results: [...merged.values()].sort((a, b) => a.index - b.index) };
  const tempPath = `${outputPath}.tmp`;
  writeFileSync(tempPath, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tempPath, outputPath);
};
for (const { record, index } of missing) {
  const url = record['网站链接'];
  try {
    run(['navigate', url, '--session', session, '--wait-until', 'domcontentloaded', '--timeout', '30s']);
    run(['wait-ms', '1s']);
    const snapshot = JSON.parse(run(['snapshot', '--session', session, '--json'])).text;
    const match = snapshot.match(/cell "(评估价|市场价|市场参考价)\s*:\s*[￥¥]?\s*([\d,.]+)(?:元)?"/);
    const fallback = snapshot.match(/(?:评估价|市场价|市场参考价)\s*[:：]\s*[￥¥]?\s*([\d,.]+)(?:元)?/);
    const label = match?.[1] ?? (fallback ? '评估价' : null);
    const raw = match?.[2] ?? fallback?.[1] ?? null;
    const value = raw ? Number(raw.replaceAll(',', '')) : null;
    results.push({ index, url, label, raw, value: Number.isFinite(value) && value > 0 ? value : null, snapshotMatched: Boolean(match || fallback) });
  } catch (error) {
    results.push({ index, url, value: null, error: String(error.message).slice(0, 300) });
  }
  persist();
}
const payload = { generatedAt: new Date().toISOString(), total: results.length, offset, allMissing: allMissing.length, results };
persist();
process.stdout.write(JSON.stringify(payload, null, 2));
