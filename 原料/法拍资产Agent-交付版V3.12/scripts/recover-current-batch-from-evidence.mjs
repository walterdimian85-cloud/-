import fs from "node:fs/promises";
import path from "node:path";
import { loadAgentConfig } from "../src/config.mjs";
import { summarizeProgress } from "../src/progress-summary.mjs";
import { saveAgentState, statePaths } from "../src/state.mjs";
import { saveJsonAtomic } from "../src/utils.mjs";

const runDir = process.argv[2];
if (!runDir) throw new Error("用法：node scripts/recover-current-batch-from-evidence.mjs <当日结果目录>");

const progressPath = path.join(runDir, "采集进度.json");
const evidencePath = path.join(runDir, "本次采集证据.json");
const [progressText, evidenceText] = await Promise.all([
  fs.readFile(progressPath, "utf8"),
  fs.readFile(evidencePath, "utf8"),
]);
const progress = JSON.parse(progressText);
const evidenceBundle = JSON.parse(evidenceText);
const currentEvidence = (evidenceBundle.evidence || []).filter((item) => item.action === "new-or-update" && item.record);
if (!currentEvidence.length) throw new Error("证据文件中没有new-or-update记录，未执行恢复");

const records = currentEvidence.map((item) => item.record);
const groups = {};
for (const platform of ["jd", "alibaba"]) {
  for (const category of ["住宅用房", "商业用房", "工业用房"]) {
    for (const status of ["即将开始", "已结束"]) {
      groups[`${platform}:${category}:${status}`] = {
        priorAnchor: "", firstUrl: "", anchorFound: true, pagesScanned: null, items: [],
      };
    }
  }
}
for (const record of records) {
  const url = record.网站链接;
  const platform = /paimai\.jd\.com/iu.test(url) ? "jd" : "alibaba";
  const category = record._源分类;
  const status = record._状态分组;
  const key = `${platform}:${category}:${status}`;
  if (!groups[key].firstUrl) groups[key].firstUrl = url;
  groups[key].items.push({ url, title: record.标的名称 || "" });
}

const completedUrls = records.map((record) => record.网站链接);
const restored = {
  ...progress,
  status: "已完成",
  updatedAt: new Date().toISOString(),
  groups,
  completedUrls,
  newSavedCount: records.length,
  current: { platform: "", category: "", statusFilter: "", title: "全部采集、检查和排序完成", url: "" },
  records,
  failures: evidenceBundle.failures || [],
  evidence: evidenceBundle.evidence || [],
  counts: { ...(progress.counts || {}), completedUrls: completedUrls.length, records: records.length },
};

const backupPath = `${progressPath}.before-evidence-recovery-${Date.now()}.json`;
await fs.copyFile(progressPath, backupPath);
const tempPath = `${progressPath}.tmp-${process.pid}`;
await fs.writeFile(tempPath, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
await fs.rename(tempPath, progressPath);
if (process.argv.includes("--restore-agent-state")) {
  const config = await loadAgentConfig();
  const summary = summarizeProgress(restored, { expectedGroupCount: Object.keys(groups).length });
  const runName = path.basename(runDir);
  await saveJsonAtomic(statePaths(config).reviewChoice, {
    active: false, dateKey: restored.dateKey, runName, clearedAt: new Date().toISOString(),
  });
  await saveAgentState(config, {
    status: "awaiting_review_choice",
    dateKey: restored.dateKey,
    runName,
    workerPid: null,
    childPid: null,
    agentRecoveryCount: 0,
    count: summary.processed,
    totalCount: summary.processed,
    progressSummary: summary,
    v2Status: "completed",
    message: `本轮${summary.processed}条数据及Excel已经完成，请选择：模型API自动复核、Codex/WorkBuddy工作台复核，或暂不复核。`,
    review: null,
    gate: null,
    current: {},
  });
}
console.log(JSON.stringify({ ok: true, records: records.length, groups: Object.keys(groups).length, backupPath }, null, 2));
