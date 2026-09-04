import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadJson, saveJsonAtomic } from "../utils.mjs";
import { selectReviewCandidates, applyReview } from "./candidates.mjs";
import { reviewWithConfiguredModel } from "./model.mjs";
import { createEvidenceBrowser } from "./browser.mjs";

export async function reviewCompletedRun(config, paths, onStatus = async () => {}, options = {}) {
  const progress = await loadJson(paths.progress, null);
  if (!progress?.records) throw new Error("未找到可供AI复核的采集进度记录");
  const originalRecords = progress.records;
  const selected = selectReviewCandidates(originalRecords, config.ai.maxReviewItems);
  const checkpointPath = path.join(paths.runDir, "AI复核进度.json");
  const checkpoint = await loadJson(checkpointPath, { completedUrls: [], records: {}, changes: [], anomalies: [], operationalFailures: [] });
  if (options.taskId && checkpoint.taskId && checkpoint.taskId !== options.taskId) throw new Error("AI review checkpoint taskId mismatch.");
  if (options.batchId && checkpoint.batchId && checkpoint.batchId !== options.batchId) throw new Error("AI review checkpoint batchId mismatch.");
  const completedReviewUrls = new Set(checkpoint.completedUrls || []);
  const candidateUrls = options.candidateUrls ? new Set(options.candidateUrls) : null;
  const scopedCandidates = candidateUrls ? selected.filter(({ record }) => candidateUrls.has(record.网站链接)) : selected;
  const candidates = scopedCandidates.filter(({ record }) => !completedReviewUrls.has(record.网站链接));
  const totalCandidates = scopedCandidates.length;
  const initialCompleted = totalCandidates - candidates.length;
  const anomalies = [...(checkpoint.anomalies || [])];
  const operationalFailures = [...(checkpoint.operationalFailures || [])];
  const changes = [...(checkpoint.changes || [])];
  const reviewStartedAt = new Date().toISOString();
  if (!config.ai.enabled) return {
    records: originalRecords,
    candidates: [],
    changes,
    anomalies: candidates.map(({ record, reasons }) => ({
      url: record.网站链接,
      reason: "影子验收未启用AI复核",
      suggestions: reasons,
    })),
    reviewSkipped: true,
  };
  if (candidates.length === 0) return { records: originalRecords, candidates, changes, anomalies };
  if (!process.env[config.ai.apiKeyEnv]) {
    throw new Error(`AI复核需要环境变量${config.ai.apiKeyEnv}，密钥不会写入配置文件`);
  }
  const rulesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "references", "ai-review-rules.md");
  const browser = await createEvidenceBrowser(config, onStatus);
  const byUrl = new Map(originalRecords.map((record) => [record.网站链接, checkpoint.records?.[record.网站链接] || record]));
  try {
    if (options.resumeVerificationUrl) {
      await onStatus({
        type: "review_progress",
        processed: initialCompleted,
        total: totalCandidates,
        remaining: candidates.length,
        changes: changes.length,
        anomalies: anomalies.length,
        failures: operationalFailures.length,
        startedAt: reviewStartedAt,
        url: options.resumeVerificationUrl,
        message: "正在重新打开上次未完成的验证页面；验证通过后将从复核断点继续",
      });
      await browser.capture(options.resumeVerificationUrl);
    }
    for (let index = 0; index < candidates.length; index += 1) {
      const { record, reasons } = candidates[index];
      const processedBefore = initialCompleted + index;
      await onStatus({ type: "review_progress", index: processedBefore + 1, processed: processedBefore, total: totalCandidates, remaining: totalCandidates - processedBefore, changes: changes.length, anomalies: anomalies.length, failures: operationalFailures.length, startedAt: reviewStartedAt, url: record.网站链接, reasons });
      try {
        const pageEvidence = await browser.capture(record.网站链接);
        const review = await reviewWithConfiguredModel({ config, record, reasons, pageEvidence, rulesPath });
        const applied = applyReview(record, review, {
          minimumConfidence: config.ai.minimumConfidence,
          autoApply: config.ai.autoApplyHighConfidence,
        });
        byUrl.set(record.网站链接, applied.record);
        for (const change of applied.changes) changes.push({ ...change, url: record.网站链接, reviewedAt: new Date().toISOString() });
        if (review.requiresHumanReview || applied.suggestions.length || review.otherIssues?.length) {
          anomalies.push({ url: record.网站链接, reason: review.summary || "AI建议人工复核", suggestions: applied.suggestions, otherIssues: review.otherIssues || [] });
        }
      } catch (error) {
        if (error?.code === "USER_ACTION_TIMEOUT") throw error;
        operationalFailures.push({ url: record.网站链接, reason: "AI复核运行失败", error: String(error) });
      }
      const processedAfter = initialCompleted + index + 1;
      await onStatus({ type: "review_progress", index: processedAfter, processed: processedAfter, total: totalCandidates, remaining: totalCandidates - processedAfter, changes: changes.length, anomalies: anomalies.length, failures: operationalFailures.length, startedAt: reviewStartedAt, url: record.网站链接, reasons });
      completedReviewUrls.add(record.网站链接);
      await saveJsonAtomic(checkpointPath, {
        version: 1,
        taskId: options.taskId || null,
        batchId: options.batchId || null,
        updatedAt: new Date().toISOString(),
        completedUrls: [...completedReviewUrls],
        records: Object.fromEntries(byUrl),
        changes,
        anomalies,
        operationalFailures,
      });
    }
  } finally { await browser.close(); }
  const records = originalRecords.map((record) => byUrl.get(record.网站链接) || record);
  await saveJsonAtomic(path.join(paths.runDir, "AI复核前记录.json"), originalRecords);
  progress.records = records;
  progress.aiReview = { taskId: options.taskId || null, batchId: options.batchId || null, completedAt: new Date().toISOString(), candidates: totalCandidates, changes: changes.length, anomalies: anomalies.length };
  await saveJsonAtomic(paths.progress, progress);
  const standardUrl = pathToFileURL(path.join(config.skillV2Dir, "src", "workbook", "standard.mjs")).href;
  const { buildStandardWorkbook } = await import(standardUrl);
  await buildStandardWorkbook({ records, reviewItems: [], outputPath: paths.workbook });
  if (options.writeArtifacts !== false) {
    await saveJsonAtomic(path.join(paths.runDir, "AI复核变更.json"), { changes, anomalies, operationalFailures });
  }
  return { records, candidates: scopedCandidates, changes, anomalies, operationalFailures };
}
