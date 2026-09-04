import fs from "node:fs/promises";
import path from "node:path";
import { saveJsonAtomic } from "./utils.mjs";

export async function writeDailyReports({ runDir, dateKey, records, candidates, changes, anomalies, operationalFailures = [], history, opportunities = [] }) {
  const summary = {
    dateKey,
    generatedAt: new Date().toISOString(),
    totalRecords: records.length,
    upcoming: records.filter((r) => r._状态分组 === "即将开始").length,
    succeeded: records.filter((r) => r.是否成交 === "是").length,
    failed: records.filter((r) => r.是否成交 === "否").length,
    reviewed: candidates.length,
    aiCorrectedRecords: new Set(changes.map((c) => c.url)).size,
    aiFieldChanges: changes.length,
    anomalies: anomalies.length,
    aiOperationalFailures: operationalFailures.length,
    historyTotalRecords: history?.totalRecords || 0,
    opportunitySignals: opportunities.length,
  };
  await saveJsonAtomic(path.join(runDir, "Agent数据摘要.json"), summary);
  await saveJsonAtomic(path.join(runDir, "Agent异常报告.json"), { dateKey, anomalies, operationalFailures, changes });
  await saveJsonAtomic(path.join(runDir, "Agent初步关注标的.json"), {
    dateKey,
    disclaimer: "仅为当日数据中的低价或竞买热度线索，不构成估值、尽调或投资建议。",
    opportunities,
  });
  const lines = [
    `# ${dateKey}福建法拍房每日摘要`, "",
    `- 本次记录：${summary.totalRecords}条`,
    `- 即将开始：${summary.upcoming}条`,
    `- 成交标的：${summary.succeeded}条`,
    `- 流拍标的：${summary.failed}条`,
    `- AI集中复核：${summary.reviewed}条`,
    `- AI自动校准：${summary.aiCorrectedRecords}个标的、${summary.aiFieldChanges}个字段`,
    `- 仍需人工处理：${summary.anomalies}条`,
    `- AI技术性失败：${summary.aiOperationalFailures}条`, "",
    "## AI自动校准", "",
    ...(changes.length ? changes.map((c) => `- ${c.url}：${c.field}「${c.before ?? "空"}」→「${c.after}」；证据：${c.evidence}`) : ["- 无"]),
    "", "## 异常与待处理", "",
    ...(anomalies.length ? anomalies.map((a) => `- ${a.url || "未知链接"}：${a.reason || a.error || "需人工复核"}`) : ["- 无"]),
    "", "## AI运行故障（不代表数据异常）", "",
    ...(operationalFailures.length ? operationalFailures.map((a) => `- ${a.url || "未知链接"}：${a.error || a.reason}`) : ["- 无"]),
    "", "## 初步关注标的", "",
    "> 仅为当日数据中的低价或竞买热度线索，不构成估值、尽调或投资建议。", "",
    ...(opportunities.length ? opportunities.map((item) => `- ${item.name || item.url}：${item.kind}；${item.reason}`) : ["- 暂无满足规则的标的"]),
  ];
  const markdownPath = path.join(runDir, "每日摘要与异常报告.md");
  await fs.writeFile(markdownPath, `${lines.join("\n")}\n`, "utf8");
  return { summary, markdownPath };
}
