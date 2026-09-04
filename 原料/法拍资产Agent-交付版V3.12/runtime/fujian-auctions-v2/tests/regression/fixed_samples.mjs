import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRows } from "../../scripts/import-curated-html.mjs";
import { parseParticipationRows } from "../../scripts/build-participation-training.mjs";
import { sha256 } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(root, "tests", "fixtures", "curated-html");
const manifest = JSON.parse(await fs.readFile(path.join(fixtureDir, "manifest.json"), "utf8"));
const gold = JSON.parse(await fs.readFile(path.join(root, "tests", "fixtures", "curated-training", "golden-records.json"), "utf8"));
const participationGold = JSON.parse(await fs.readFile(path.join(root, "tests", "fixtures", "curated-training", "participation-golden.json"), "utf8"));

const all = [];
const participation = [];
for (const [fileName, expected] of Object.entries(manifest.files)) {
  const filePath = path.join(fixtureDir, fileName);
  const content = await fs.readFile(filePath, "utf8");
  const stat = await fs.stat(filePath);
  assert.equal(stat.size, expected.bytes, `${fileName} 字节数发生变化`);
  assert.equal(await sha256(filePath), expected.sha256, `${fileName} SHA-256发生变化`);
  if (fileName.includes("法拍结果")) {
    const records = parseParticipationRows(content, fileName);
    assert.ok(records.length > 0, `${fileName} 未解析出成交记录`);
    participation.push(...records);
  } else {
    const records = parseRows(content, filePath);
    assert.ok(records.length > 0, `${fileName} 未解析出上新记录`);
    all.push(...records);
  }
}

const byUrl = new Map();
const conflicts = [];
for (const record of all) {
  const prior = byUrl.get(record.url);
  if (!prior) {
    byUrl.set(record.url, record);
    continue;
  }
  const fields = ["expectedTitle", "expectedCommunity", "expectedArea"];
  const different = fields.filter((field) => prior[field] !== record[field]);
  if (different.length) conflicts.push({ url: record.url, fields: different });
}

const counts = {
  rawRows: all.length,
  uniqueUrls: byUrl.size,
  knownConflicts: conflicts.length,
  withArea: [...byUrl.values()].filter((item) => Number.isFinite(item.expectedArea)).length,
  withoutArea: [...byUrl.values()].filter((item) => !Number.isFinite(item.expectedArea)).length,
  alibaba: [...byUrl.values()].filter((item) => item.platform === "阿里资产").length,
  jd: [...byUrl.values()].filter((item) => item.platform === "京东拍卖").length,
};
assert.deepEqual(counts, manifest.expected, "四份人工HTML的固定统计发生变化");
assert.equal(gold.records.length, manifest.expected.uniqueUrls, "派生金标准记录数与HTML不一致");
assert.deepEqual(gold.counts, {
  raw: manifest.expected.rawRows,
  unique: manifest.expected.uniqueUrls,
  conflicts: manifest.expected.knownConflicts,
  withArea: manifest.expected.withArea,
  withoutArea: manifest.expected.withoutArea,
  alibaba: manifest.expected.alibaba,
  jd: manifest.expected.jd,
});

const goldByUrl = new Map(gold.records.map((record) => [record.url, record]));
for (const [url, record] of byUrl) {
  const expected = goldByUrl.get(url);
  assert.ok(expected, `金标准缺少链接：${url}`);
  assert.equal(expected.expectedTitle, record.expectedTitle, `${url} 标的名称不一致`);
  assert.equal(expected.expectedCommunity, record.expectedCommunity, `${url} 小区名称不一致`);
  assert.equal(expected.expectedArea, record.expectedArea, `${url} 面积不一致`);
}

assert.equal(participation.length, participationGold.total, "法拍结果成交记录数与参与度金标准不一致");
assert.deepEqual(participation, participationGold.records, "法拍结果中的竞买记录或报名人数发生变化");

const communityPath = path.join(root, manifest.communitySource.path);
assert.equal((await fs.stat(communityPath)).size, manifest.communitySource.bytes, "小区名称原始清单字节数发生变化");
assert.equal(await sha256(communityPath), manifest.communitySource.sha256, "小区名称原始清单SHA-256发生变化");
const communityDictionary = JSON.parse(await fs.readFile(path.join(root, "assets", "community-dictionary.json"), "utf8"));
assert.ok(communityDictionary.count >= 790, "小区名称数据库条目异常减少");
assert.equal(communityDictionary.entries.length, communityDictionary.count, "小区名称数据库计数不一致");

console.log("Fuzhou/Quanzhou curated HTML regression samples passed");
