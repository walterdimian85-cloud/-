import fs from "node:fs/promises";
import path from "node:path";
import { buildWorkbook } from "../runtime/fujian-auctions-v2/scripts/build_workbook.mjs";

const [historyPath, outputDir, dateKey, cutoff] = process.argv.slice(2);
if (!historyPath || !outputDir || !dateKey || !cutoff) {
  throw new Error("Usage: node restore-history-batch.mjs <history.json> <output-dir> <YYYYMMDD> <ISO-cutoff>");
}
const history = JSON.parse(await fs.readFile(historyPath, "utf8"));
const latest = new Map();
for (const entry of Object.values(history.records || {})) {
  for (const snapshot of entry.snapshots || []) {
    const url = snapshot.record?.["网站链接"];
    if (snapshot.dateKey !== dateKey || snapshot.capturedAt >= cutoff || !url) continue;
    const previous = latest.get(url);
    if (!previous || previous.capturedAt < snapshot.capturedAt) latest.set(url, snapshot);
  }
}
const records = [...latest.values()].map((item) => item.record);
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "从Agent历史恢复的记录.json"), `${JSON.stringify({ dateKey, cutoff, records }, null, 2)}\n`, "utf8");
const outputPath = path.join(outputDir, `${dateKey}新增房源信息.xlsx`);
const workbookQa = await buildWorkbook({ records, reviewItems: [], outputPath });
await fs.writeFile(path.join(outputDir, "恢复说明.txt"), [
  `本目录由Agent历史快照恢复。`,
  `业务日期：${dateKey}`,
  `截取时间：${cutoff}`,
  `恢复记录数：${records.length}`,
  `说明：原始上午目录曾被后续任务覆盖；本文件按网站链接去重，取覆盖发生前最后一份历史快照重建。`,
].join("\r\n"), "utf8");
console.log(JSON.stringify({ records: records.length, outputPath, workbookQa }, null, 2));
