import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function canonicalUrl(value) {
  const normalized = String(value || "").replaceAll("\\_", "_");
  const match = normalized.match(/https?:\/\/sf-item\.taobao\.com\/sf_item\/(\d+)(?:\.htm)?/iu);
  return match ? `https://sf-item.taobao.com/sf_item/${match[1]}.htm` : normalized;
}

const [progressPath, anchorInput] = process.argv.slice(2);
if (!progressPath || !anchorInput) {
  throw new Error("用法：node scripts/repair-pc-anchor-overrun.mjs <采集进度.json> <正确高水位链接>");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentState = JSON.parse(await fs.readFile(path.join(root, "agent-data", "agent-state.json"), "utf8"));
const workerLock = JSON.parse(await fs.readFile(path.join(root, "agent-data", "worker-lock.json"), "utf8"));
if (agentState.status !== "paused" || agentState.workerPid || agentState.childPid || workerLock.active) {
  throw new Error("仅允许在任务已暂停、Worker与子进程均退出且Worker锁已释放时修复。 ");
}
if (path.resolve(agentState.paths?.progress || "") !== path.resolve(progressPath)) {
  throw new Error("目标进度文件不属于当前暂停任务。 ");
}

const progress = JSON.parse(await fs.readFile(progressPath, "utf8"));
const anchor = canonicalUrl(anchorInput);
const matches = Object.entries(progress.groups || {}).filter(([, group]) =>
  (group.items || []).some((item) => canonicalUrl(item.url) === anchor));
if (matches.length !== 1) throw new Error(`高水位必须且只能命中一个分组，实际命中 ${matches.length} 个。`);

const [groupKey, group] = matches[0];
const anchorIndex = group.items.findIndex((item) => canonicalUrl(item.url) === anchor);
if (anchorIndex < 0) throw new Error("未找到正确高水位。 ");
const keptItems = group.items.slice(0, anchorIndex);
const keptUrls = new Set(keptItems.map((item) => canonicalUrl(item.url)));
const keptRecords = (progress.records || []).filter((record) => keptUrls.has(canonicalUrl(record.网站链接)));
const keptCompletedUrls = (progress.completedUrls || []).filter((url) => keptUrls.has(canonicalUrl(url)));
if (keptRecords.length !== keptItems.length || keptCompletedUrls.length !== keptItems.length) {
  throw new Error(`边界内数据不完整：计划 ${keptItems.length}，记录 ${keptRecords.length}，已完成 ${keptCompletedUrls.length}。`);
}

const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
const backupPath = path.join(path.dirname(progressPath), `采集进度.高水位越界修复前.${stamp}.json`);
await fs.copyFile(progressPath, backupPath);

const lastItem = keptItems.at(-1) || null;
progress.groups[groupKey] = {
  ...group,
  priorAnchor: anchor,
  anchorFound: true,
  anchorMatchMode: "primary",
  matchedAnchor: anchor,
  listExhausted: false,
  items: keptItems,
  status: "部分完成",
};
progress.records = keptRecords;
progress.completedUrls = keptCompletedUrls;
progress.failures = (progress.failures || []).filter((failure) => keptUrls.has(canonicalUrl(failure.url)));
progress.evidence = (progress.evidence || []).filter((entry) => {
  if (entry.action === "anchor-missing-full-list-exhausted") return false;
  const url = entry.record?.网站链接 || entry.url;
  return !url || keptUrls.has(canonicalUrl(url));
});
progress.evidence.push({
  action: "repair-pc-anchor-overrun",
  groupKey,
  anchor,
  keptCount: keptItems.length,
  removedCount: group.items.length - keptItems.length,
  repairedAt: new Date().toISOString(),
  reason: "Markdown转义的高水位未被旧版URL规范化识别",
  backupPath,
});
progress.newSavedCount = keptRecords.length;
progress.counts = {
  ...(progress.counts || {}),
  records: keptRecords.length,
  completedUrls: keptCompletedUrls.length,
  failures: progress.failures.length,
};
progress.current = lastItem ? {
  platform: "alibaba_pc",
  category: groupKey.split(":")[1] || "",
  statusFilter: groupKey.split(":")[2] || "",
  title: lastItem.title || "",
  url: canonicalUrl(lastItem.url),
} : {};
progress.updatedAt = new Date().toISOString();

const temporary = `${progressPath}.${process.pid}.tmp`;
await fs.writeFile(temporary, `${JSON.stringify(progress, null, 2)}\n`, "utf8");
await fs.rename(temporary, progressPath);
console.log(JSON.stringify({
  taskId: agentState.taskId,
  batchId: agentState.batchId,
  groupKey,
  anchor,
  keptCount: keptItems.length,
  removedCount: group.items.length - keptItems.length,
  backupPath,
}, null, 2));
