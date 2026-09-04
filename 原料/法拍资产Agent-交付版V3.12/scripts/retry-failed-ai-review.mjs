import path from "node:path";
import { DEFAULT_CONFIG_PATH, loadAgentConfig } from "../src/config.mjs";
import { activatePersistentCredential } from "../src/credentials.mjs";
import { collectionPaths } from "../src/collector.mjs";
import { reviewCompletedRun } from "../src/review/index.mjs";
import { loadJson, saveJsonAtomic, shanghaiDateKey } from "../src/utils.mjs";
import { saveAgentState } from "../src/state.mjs";
import { updateHistory } from "../src/history.mjs";
import { identifyOpportunitySignals } from "../src/opportunities.mjs";
import { writeDailyReports } from "../src/reports.mjs";

const configPath = process.argv[2] || DEFAULT_CONFIG_PATH;
const config = await loadAgentConfig(configPath);
await activatePersistentCredential(config);
const dateKey = shanghaiDateKey();
const paths = collectionPaths(config, dateKey);
const artifactPath = path.join(paths.runDir, "AI复核变更.json");
const previous = await loadJson(artifactPath, { changes: [], anomalies: [], operationalFailures: [] });
const legacyFailures = (previous.anomalies || []).filter((item) => item.reason === "AI复核失败");
const failed = [...legacyFailures, ...(previous.operationalFailures || [])];
const failedUrls = [...new Set(failed.map((item) => item.url).filter(Boolean))];

if (!failedUrls.length) {
  console.log(JSON.stringify({ retried: 0, message: "没有需要重试的AI技术失败" }, null, 2));
  process.exit(0);
}

await saveAgentState(config, {
  status: "reviewing", dateKey, message: `正在仅重试${failedUrls.length}条AI技术失败记录`,
  review: { type: "retry_operational_failures", index: 0, total: failedUrls.length },
});

const rerun = await reviewCompletedRun(config, paths, async (info) => {
  await saveAgentState(config, {
    status: info.type === "verification" ? "waiting_user_action" : "reviewing",
    dateKey, review: info, message: info.message || `正在重试AI复核 ${info.index || 0}/${info.total || failedUrls.length}`,
  });
}, { candidateUrls: failedUrls, writeArtifacts: false });

const failedSet = new Set(failedUrls);
const changes = [
  ...(previous.changes || []).filter((item) => !failedSet.has(item.url)),
  ...rerun.changes,
];
const anomalies = [
  ...(previous.anomalies || []).filter((item) => item.reason !== "AI复核失败" && !failedSet.has(item.url)),
  ...rerun.anomalies,
];
const operationalFailures = rerun.operationalFailures || [];
await saveJsonAtomic(artifactPath, { changes, anomalies, operationalFailures });

const history = await updateHistory(config, rerun.records, dateKey, changes);
const opportunities = identifyOpportunitySignals(rerun.records, config.opportunities);
const reports = await writeDailyReports({
  runDir: paths.runDir, dateKey, records: rerun.records,
  candidates: { length: Math.max(config.ai.maxReviewItems || 0, failedUrls.length) },
  changes, anomalies, operationalFailures, history, opportunities,
});
await saveAgentState(config, {
  status: operationalFailures.length ? "review_pending" : "completed",
  dateKey, completedAt: new Date().toISOString(), childPid: null,
  message: operationalFailures.length
    ? `AI复核重试完成，仍有${operationalFailures.length}条技术失败`
    : "AI技术失败记录已全部重试完成，报告已重新生成",
  workbook: paths.workbook, report: reports.markdownPath, summary: reports.summary,
  review: { type: "retry_completed", retried: failedUrls.length, operationalFailures: operationalFailures.length },
});
console.log(JSON.stringify({ retried: failedUrls.length, changes: rerun.changes.length,
  anomalies: rerun.anomalies.length, operationalFailures: operationalFailures.length }, null, 2));
