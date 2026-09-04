import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadAgentConfig } from "../src/config.mjs";
import { collectionPaths } from "../src/collector.mjs";
import { loadAgentState } from "../src/state.mjs";
import { materializeScopeConfig } from "../src/task-scope.mjs";
import { loadJson, saveJsonAtomic } from "../src/utils.mjs";

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const configPath = option("--config");
const url = option("--url");
const area = Number(option("--area"));
const evidence = option("--evidence");
if (!configPath || !url || !Number.isFinite(area) || area <= 0 || !evidence) {
  throw new Error("需要 --config --url --area --evidence");
}

const baseConfig = await loadAgentConfig(configPath);
const state = await loadAgentState(baseConfig);
const config = await materializeScopeConfig(baseConfig);
config.collection = { ...config.collection, runName: state.runName, dateKey: state.dateKey };
const paths = collectionPaths(config, state.dateKey);
const progress = await loadJson(paths.progress, null);
const record = progress?.records?.find((item) => item.网站链接 === url);
if (!record) throw new Error(`当前批次未找到记录：${url}`);

const stamp = Date.now();
await fs.copyFile(paths.progress, path.join(paths.runDir, `采集进度.证据修正前.${stamp}.json`));
try { await fs.copyFile(paths.workbook, path.join(paths.runDir, `${state.dateKey}新增房源信息.证据修正前.${stamp}.xlsx`)); } catch {}

const before = record["面积/㎡"];
record["面积/㎡"] = area;
const existingNote = String(record.备注 || "").trim();
record.备注 = existingNote.includes(evidence) ? existingNote : [existingNote, evidence].filter(Boolean).join("；");
record._areaSource = "用户确认的页面调查表明确证据";
record._fieldEvidence = {
  ...(record._fieldEvidence || {}),
  "面积/㎡": {
    value: area, dataType: "number", unit: "㎡",
    source: { platform: record.平台, section: "标的物调查情况表", element: "建筑面积（依据房管局备案数据）", rawText: evidence },
    ruleId: "area-table-main-unit-with-parking-v2", confidence: "high", conflicts: [], reviewRequired: false,
  },
};
progress.updatedAt = new Date().toISOString();
progress.manualCorrections = [...(progress.manualCorrections || []), { url, field: "面积/㎡", before, after: area, evidence, correctedAt: progress.updatedAt }];
await saveJsonAtomic(paths.progress, progress);

const scopedStatePath = path.join(config.stateDir, "state.json");
const scopedState = await loadJson(scopedStatePath, null);
if (scopedState?.records?.[url]) scopedState.records[url] = structuredClone(record);
if (scopedState) {
  scopedState.updatedAt = new Date().toISOString();
  await saveJsonAtomic(scopedStatePath, scopedState);
}

const standardUrl = pathToFileURL(path.join(config.skillV2Dir, "src", "workbook", "standard.mjs")).href;
const { buildStandardWorkbook } = await import(standardUrl);
let workbook = paths.workbook;
try {
  await buildStandardWorkbook({ records: progress.records, reviewItems: [], outputPath: workbook });
} catch (error) {
  if (error?.code !== "EBUSY") throw error;
  workbook = path.join(paths.runDir, `${state.dateKey}新增房源信息_证据修正版.xlsx`);
  await buildStandardWorkbook({ records: progress.records, reviewItems: [], outputPath: workbook });
}
console.log(JSON.stringify({ url, before, after: area, evidence, workbook }, null, 2));
