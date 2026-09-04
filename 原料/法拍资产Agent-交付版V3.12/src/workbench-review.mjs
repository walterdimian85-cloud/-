import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectionPaths } from "./collector.mjs";
import { updateHistory } from "./history.mjs";
import { identifyOpportunitySignals } from "./opportunities.mjs";
import { writeDailyReports } from "./reports.mjs";
import { applyReview, selectReviewCandidates } from "./review/candidates.mjs";
import { loadJson, saveJsonAtomic, shanghaiDateKey } from "./utils.mjs";
import { batchDataAudit, recoverEmptyBatchFromScopedState } from "./batch-data-integrity.mjs";

export function workbenchReviewPaths(config, dateKey = shanghaiDateKey(), runName = null) {
  const scopedConfig = runName
    ? { ...config, collection: { ...config.collection, runName } }
    : config;
  const paths = collectionPaths(scopedConfig, dateKey);
  return {
    ...paths,
    task: path.join(paths.runDir, "工作台复核任务.json"),
    rules: path.join(paths.runDir, "工作台复核规则.md"),
    results: path.join(paths.runDir, "工作台复核结果.json"),
    reviewProgress: path.join(paths.runDir, "工作台复核进度.json"),
    changes: path.join(paths.runDir, "AI复核变更.json"),
  };
}

export async function exportWorkbenchReview(config, dateKey = shanghaiDateKey(), runName = null, identity = {}) {
  const paths = workbenchReviewPaths(config, dateKey, runName);
  const resolvedRunName = path.basename(paths.runDir);
  let progress = await loadJson(paths.progress, null);
  const recovery = await recoverEmptyBatchFromScopedState(config, paths, identity);
  if (recovery.recovered) progress = recovery.progress;
  if (!progress?.records) throw new Error(`未找到可复核的采集进度：${paths.progress}`);
  const audit = batchDataAudit(progress);
  if (!audit.valid) throw new Error(`本批数据一致性校验失败：${audit.reason}。已阻止生成空工作簿和启动复核。`);
  const candidates = selectReviewCandidates(progress.records, config.ai.maxReviewItems);
  await saveJsonAtomic(paths.task, {
    version: 2, taskId: identity.taskId || null, batchId: identity.batchId || null,
    dateKey, runName: resolvedRunName, workbookPath: paths.workbook,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates: candidates.map(({ record, reasons }) => ({
      url: record.网站链接, reasons,
      record: {
        所在省份: record.所在省份, 城市: record.城市, 区域: record.区域,
        标的名称: record.标的名称, "小区名称（仅供参考）": record["小区名称（仅供参考）"],
        标的类型: record.标的类型, 平台: record.平台, "面积/㎡": record["面积/㎡"],
        起拍价格: record.起拍价格, 评估价: record.评估价, 备注: record.备注,
        网站链接: record.网站链接,
        面积证据: record._fieldEvidence?.["面积/㎡"] || null,
        标题证据: record._fieldEvidence?.标的名称 || null,
        小区证据: record._fieldEvidence?.["小区名称（仅供参考）"] || null,
      },
    })),
    resultSchema: { version: 1, items: [{ url: "标的链接", review: { fields: {}, otherCorrections: [], otherIssues: [], requiresHumanReview: false, summary: "" } }] },
  });
  const rulesSource = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "references", "ai-review-rules.md");
  const rules = await fs.readFile(rulesSource, "utf8");
  await fs.writeFile(paths.rules, `# 工作台复核规则\n\n${rules}\n\n## 高效执行与结果保存要求\n\n只复核任务文件中已经由规则预筛出的高风险候选，不要扩展为全量数据复核。每完成一条只需追加保存到“工作台复核结果.json”的items数组；不得删除已有结果，不得重新采集，也不要求逐条更新网页进度。全部完成后运行review-apply；该命令会把网页状态一次性更新为“复核已完成”。最终summary包含headline、最多5条keyFindings、correctedFields和needsManualReview。\n`, "utf8");
  try { await fs.access(paths.results); } catch {
    await saveJsonAtomic(paths.results, { version: 2, taskId: identity.taskId || null, batchId: identity.batchId || null, dateKey, runName: resolvedRunName, items: [] });
  }
  const savedResult = await loadJson(paths.results, { items: [] });
  const savedExternal = await loadJson(paths.reviewProgress, null);
  const belongsToBatch = savedExternal
    && (!identity.taskId || savedExternal.taskId === identity.taskId)
    && (!identity.batchId || savedExternal.batchId === identity.batchId);
  if (!belongsToBatch) {
    const processed = Math.min(candidates.length, savedResult.items?.length || 0);
    await saveJsonAtomic(paths.reviewProgress, {
      version: 1, taskId: identity.taskId || null, batchId: identity.batchId || null,
      status: processed ? "running" : "pending", total: candidates.length, processed,
      remaining: Math.max(0, candidates.length - processed), changes: 0, anomalies: 0, failures: 0,
      currentUrl: null,
      summary: { headline: processed ? "已从工作台结果恢复复核进度" : "等待外部工作台开始复核", keyFindings: [] },
      updatedAt: new Date().toISOString(),
    });
  }
  return { taskId: identity.taskId || null, batchId: identity.batchId || null, dateKey, runName: resolvedRunName, workbookPath: paths.workbook, candidates: candidates.length, taskPath: paths.task, rulesPath: paths.rules, resultsPath: paths.results, progressPath: paths.reviewProgress, recoveredRecords: recovery.count || 0 };
}

export async function applyWorkbenchReview(config, dateKey = shanghaiDateKey(), runName = null, identity = {}) {
  const paths = workbenchReviewPaths(config, dateKey, runName);
  const resolvedRunName = path.basename(paths.runDir);
  const progress = await loadJson(paths.progress, null);
  const task = await loadJson(paths.task, null);
  const result = await loadJson(paths.results, null);
  const externalProgress = await loadJson(paths.reviewProgress, {});
  if (identity.taskId && task?.taskId !== identity.taskId) throw new Error("Workbench review taskId mismatch.");
  if (identity.batchId && task?.batchId !== identity.batchId) throw new Error("Workbench review batchId mismatch.");
  if (identity.taskId && result?.taskId !== identity.taskId) throw new Error("Workbench review result taskId mismatch.");
  if (identity.batchId && result?.batchId !== identity.batchId) throw new Error("Workbench review result batchId mismatch.");
  if (!progress?.records) throw new Error(`未找到采集进度：${paths.progress}`);
  if (!Array.isArray(task?.candidates)) throw new Error(`未找到工作台复核任务：${paths.task}`);
  if (!Array.isArray(result?.items)) throw new Error(`工作台复核结果格式不正确：${paths.results}`);
  if (task.runName && task.runName !== resolvedRunName) {
    throw new Error(`复核任务批次不一致：任务属于 ${task.runName}，当前目标是 ${resolvedRunName}。已拒绝写入。`);
  }
  if (result.runName && result.runName !== resolvedRunName) {
    throw new Error(`复核结果批次不一致：结果属于 ${result.runName}，当前目标是 ${resolvedRunName}。已拒绝写入。`);
  }
  if (task.workbookPath && path.resolve(task.workbookPath) !== path.resolve(paths.workbook)) {
    throw new Error(`复核工作簿不一致：任务指向 ${task.workbookPath}，当前目标是 ${paths.workbook}。已拒绝写入。`);
  }
  const expectedUrls = new Set(task.candidates.map((item) => item.url).filter(Boolean));
  const resultUrls = new Set(result.items.map((item) => item.url).filter(Boolean));
  const missingUrls = [...expectedUrls].filter((url) => !resultUrls.has(url));
  if (missingUrls.length) {
    throw new Error(`工作台复核尚未完成：仍缺少 ${missingUrls.length} 条结果。请继续复核后再执行 review-apply。`);
  }
  const byUrl = new Map(progress.records.map((record) => [record.网站链接, record]));
  const changes = [];
  const anomalies = [];
  const operationalFailures = [];
  for (const item of result.items) {
    const record = byUrl.get(item.url);
    if (!record) { operationalFailures.push({ url: item.url, error: "结果链接不在本次采集记录中" }); continue; }
    if (item.error) { operationalFailures.push({ url: item.url, error: String(item.error) }); continue; }
    const applied = applyReview(record, item.review || {}, {
      minimumConfidence: config.ai.minimumConfidence,
      autoApply: config.ai.autoApplyHighConfidence,
    });
    byUrl.set(item.url, applied.record);
    for (const change of applied.changes) changes.push({ ...change, url: item.url, reviewedAt: new Date().toISOString(), reviewer: "workbench" });
    if (item.review?.requiresHumanReview || applied.suggestions.length || item.review?.otherIssues?.length) {
      anomalies.push({ url: item.url, reason: item.review?.summary || "工作台建议人工复核", suggestions: applied.suggestions, otherIssues: item.review?.otherIssues || [] });
    }
  }
  const records = progress.records.map((record) => byUrl.get(record.网站链接) || record);
  progress.records = records;
  progress.aiReview = { completedAt: new Date().toISOString(), mode: "workbench", candidates: expectedUrls.size, changes: changes.length, anomalies: anomalies.length };
  await saveJsonAtomic(paths.progress, progress);
  const standardUrl = pathToFileURL(path.join(config.skillV2Dir, "src", "workbook", "standard.mjs")).href;
  const { buildStandardWorkbook } = await import(standardUrl);
  await buildStandardWorkbook({ records, reviewItems: [], outputPath: paths.workbook });
  await saveJsonAtomic(paths.changes, { changes, anomalies, operationalFailures, reviewer: "workbench" });
  await saveJsonAtomic(paths.reviewProgress, {
    ...externalProgress, version: 1, taskId: identity.taskId || null, batchId: identity.batchId || null,
    status: "completed", total: expectedUrls.size, processed: expectedUrls.size, remaining: 0,
    changes: changes.length, anomalies: anomalies.length, failures: operationalFailures.length, currentUrl: null,
    summary: result.summary || externalProgress.summary || { headline: `已复核${expectedUrls.size}条`, keyFindings: [] },
    completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const history = await updateHistory(config, records, dateKey, changes);
  const opportunities = identifyOpportunitySignals(records, config.opportunities);
  const reports = await writeDailyReports({ runDir: paths.runDir, dateKey, records, candidates: result.items, changes, anomalies, operationalFailures, history, opportunities });
  return { reviewed: expectedUrls.size, changes: changes.length, anomalies: anomalies.length, operationalFailures: operationalFailures.length, workbook: paths.workbook, report: reports.markdownPath };
}
