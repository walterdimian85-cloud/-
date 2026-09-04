import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadJson, saveJsonAtomic } from "./utils.mjs";

function platformId(record = {}) {
  if (record.平台 === "京东拍卖") return record._采集通道 === "jd_pc" ? "jd_pc" : "jd";
  if (record.平台 === "阿里资产") return record._采集通道 === "alibaba_pc" ? "alibaba_pc" : "alibaba";
  return "";
}

function categoryName(record = {}) {
  return record._源分类 || ({ 住宅: "住宅用房", 商业: "商业用房", 工业: "工业用房" }[record.标的类型]) || "";
}

export function currentScopeRecords(scopedState = {}) {
  const inputAt = Date.parse(scopedState.scopeInputAt || "");
  if (!Number.isFinite(inputAt)) return [];
  return Object.values(scopedState.records || {}).filter((record) => {
    const capturedAt = Date.parse(record?._capturedAt || "");
    return record?.网站链接 && Number.isFinite(capturedAt) && capturedAt >= inputAt;
  });
}

export function rebuildProgressRecords(progress = {}, records = []) {
  const urls = records.map((record) => record.网站链接).filter(Boolean);
  const groups = structuredClone(progress.groups || {});
  for (const record of records) {
    const platform = platformId(record);
    const status = record._状态分组 || record.是否成交 || "";
    const city = record.城市 || "";
    const key = ["jd_pc", "alibaba_pc"].includes(platform)
      ? Object.keys(groups).find((candidate) => candidate.startsWith(`${platform}:`) && candidate.endsWith(`:${status}${city ? `:${city}` : ""}`))
      : `${platform}:${categoryName(record)}:${status}:${city}`;
    if (!groups[key]) continue;
    groups[key].items = groups[key].items || [];
    if (!groups[key].items.some((item) => item.url === record.网站链接)) groups[key].items.push({ url: record.网站链接 });
  }
  return {
    ...progress, records, groups,
    completedUrls: [...new Set([...(progress.completedUrls || []), ...urls])],
    newSavedCount: records.length,
    counts: { ...(progress.counts || {}), records: records.length, completedUrls: urls.length },
    dataRecovery: { source: "scoped_state_current_scope", recovered: records.length, recoveredAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
}

export async function recoverEmptyBatchFromScopedState(config, paths, identity = {}) {
  const progress = await loadJson(paths.progress, null);
  if (!progress || (progress.records || []).length > 0) return { recovered: false, progress };
  const scopedState = await loadJson(path.join(config.stateDir, "state.json"), null);
  const records = currentScopeRecords(scopedState || {});
  if (!records.length) return { recovered: false, progress };
  const backupPath = path.join(paths.runDir, `采集进度.恢复前空文件.${Date.now()}.json`);
  await fs.copyFile(paths.progress, backupPath);
  const recoveredProgress = rebuildProgressRecords(progress, records);
  recoveredProgress.taskId = identity.taskId || recoveredProgress.taskId || null;
  recoveredProgress.batchId = identity.batchId || recoveredProgress.batchId || null;
  await saveJsonAtomic(paths.progress, recoveredProgress);
  const standardUrl = pathToFileURL(path.join(config.skillV2Dir, "src", "workbook", "standard.mjs")).href;
  const { buildStandardWorkbook } = await import(standardUrl);
  await buildStandardWorkbook({ records, reviewItems: [], outputPath: paths.workbook });
  return { recovered: true, count: records.length, backupPath, progress: recoveredProgress };
}

export function batchDataAudit(progress = {}) {
  const records = Array.isArray(progress.records) ? progress.records : [];
  const groupItems = Object.values(progress.groups || {}).reduce((sum, group) => sum + (group.items?.length || 0), 0);
  return { valid: records.length > 0 || groupItems === 0, recordCount: records.length, groupItemCount: groupItems,
    reason: groupItems > 0 && records.length === 0 ? "分组包含待处理标的，但本批记录为空" : null };
}
