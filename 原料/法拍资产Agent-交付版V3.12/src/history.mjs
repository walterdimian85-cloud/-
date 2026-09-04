import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { statePaths } from "./state.mjs";

export async function updateHistory(config, records, dateKey, changes = []) {
  const historyPath = statePaths(config).history;
  const history = await loadJson(historyPath, { version: 1, records: {} });
  const changesByUrl = new Map();
  for (const change of changes) {
    const list = changesByUrl.get(change.url) || [];
    list.push(change); changesByUrl.set(change.url, list);
  }
  for (const record of records) {
    const url = record.网站链接;
    if (!url) continue;
    const existing = history.records[url] || { firstSeen: dateKey, snapshots: [] };
    existing.lastSeen = dateKey;
    existing.current = record;
    existing.snapshots.push({ dateKey, capturedAt: new Date().toISOString(), record, aiChanges: changesByUrl.get(url) || [] });
    existing.snapshots = existing.snapshots.slice(-20);
    history.records[url] = existing;
  }
  history.updatedAt = new Date().toISOString();
  await saveJsonAtomic(historyPath, history);
  return { path: historyPath, totalRecords: Object.keys(history.records).length };
}
