import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadRunConfig } from "../src/config/load.mjs";
import { canonicalUrl } from "../src/core/urls.mjs";
import { buildStandardWorkbook } from "../src/workbook/standard.mjs";
import { normalizePropertyTitleText } from "../src/core/title.mjs";

assert.equal(
  canonicalUrl("https://susong-item.taobao.com/auction/1065103447645.htm?track_id=x"),
  "https://sf-item.taobao.com/sf_item/1065103447645.htm",
);
assert.equal(
  canonicalUrl("https://paimai.jd.com/310958848?foo=bar"),
  "https://paimai.jd.com/310958848",
);
assert.equal(
  normalizePropertyTitleText("龙岩大道中 29 号39 幢 15房产及B15附属用房、C0400、C0390、C0399号车位 可贷款"),
  "龙岩大道中29号39幢15房产及B15附属用房、C0400、C0390、C0399号车位",
);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fujian-auctions-v1-"));
try {
  const configPath = path.join(tempDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    platform: "all",
    outputDir: "./results",
    stateDir: "./state",
    workbookAdapter: "standard",
  }), "utf8");
  const loaded = await loadRunConfig(["collect", "--config", configPath], tempDir);
  assert.deepEqual(loaded.argv, ["collect"]);
  assert.equal(loaded.config.outputDir, path.join(tempDir, "results"));
  assert.equal(loaded.config.stateDir, path.join(tempDir, "state"));

  const outputPath = path.join(tempDir, "productization-check.xlsx");
  const records = [
    {
      所在省份: "福建省", 城市: "厦门市", 区域: "思明区",
      标的名称: "福建省厦门市思明区测试花园（一期）1号楼101单元",
      标的类型: "住宅", 平台: "京东拍卖", 发拍次数: "二拍",
      拍卖时间: "2026-08-03T02:00:00.000Z", 是否成交: "即将开始",
      处置法院: "厦门市思明区人民法院", "面积/㎡": 100,
      起拍价格: 1500000, 评估价: 2000000, 成交金额: 0,
      网站链接: "https://paimai.jd.com/311000001", _状态分组: "即将开始",
    },
    {
      所在省份: "福建省", 城市: "福州市", 区域: "仓山区",
      标的名称: "福建省福州市仓山区测试公馆2号楼202单元",
      标的类型: "住宅", 平台: "阿里资产", 发拍次数: "一拍",
      拍卖时间: "2026-08-02T02:00:00.000Z", 是否成交: "是",
      处置法院: "福州市仓山区人民法院", "面积/㎡": 80,
      起拍价格: 800000, 评估价: 1000000, 成交金额: 900000,
      网站链接: "https://sf-item.taobao.com/sf_item/100000001.htm", _状态分组: "已结束",
    },
  ];
  const qa = await buildStandardWorkbook({ records, outputPath });
  assert.equal(qa.totalRows, 2);
  assert.equal(qa.upcomingRows, 1);
  assert.equal(qa.endedRows, 1);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["即将开始", "成交标的", "流拍标的"]);
  const upcoming = workbook.getWorksheet("即将开始");
  const ended = workbook.getWorksheet("成交标的");
  const failed = workbook.getWorksheet("流拍标的");
  assert.equal(upcoming.rowCount, 2);
  assert.equal(ended.rowCount, 2);
  assert.equal(failed.rowCount, 1);
  assert.deepEqual(upcoming.getRow(1).values.slice(1), [
    "所在省份", "城市", "区域", "标的名称", "小区名称（仅供参考）", "标的类型",
    "平台", "发拍次数", "拍卖时间", "是否成交", "处置法院", "面积/㎡",
    "起拍单价-元/㎡", "起拍价格", "评估价", "折扣率(%)", "备注", "网站链接",
  ]);
  assert.deepEqual(ended.getRow(1).values.slice(1), [
    "所在省份", "城市", "区域", "标的名称", "小区名称（仅供参考）", "标的类型",
    "平台", "发拍次数", "拍卖时间", "是否成交", "处置法院", "面积/㎡",
    "起拍单价-元/㎡", "起拍价格", "评估价", "折扣率(%)",
    "成交金额", "溢价率", "成交单价",
    "竞买记录", "报名人数", "备注", "网站链接",
  ]);
  assert.match(String(ended.getCell("M2").value.formula), /^IF\(/u);
  assert.equal(ended.getCell("M2").value.result, 10000);
  assert.equal(ended.getCell("O2").value, 1_000_000);
  assert.match(String(ended.getCell("P2").value.formula), /^IF\(/u);
  assert.equal(ended.getCell("P2").value.result, 0.8);
  assert.equal(ended.getCell("P2").numFmt, "0.00%");
  assert.match(String(ended.getCell("R2").value.formula), /^IF\(/u);
  assert.equal(ended.getCell("R2").value.result, 0.125);
  assert.equal(ended.getCell("R2").numFmt, "0.00%");
  assert.match(String(ended.getCell("S2").value.formula), /^IF\(/u);
  assert.equal(ended.getCell("S2").value.result, 11250);
  assert.equal(ended.getCell("I2").numFmt, "mm-dd");
  assert.equal(ended.views[0].state, "frozen");

  const emptyOutputPath = path.join(tempDir, "empty.xlsx");
  await buildStandardWorkbook({ records: [], reviewItems: [], outputPath: emptyOutputPath });
  const emptyWorkbook = new ExcelJS.Workbook();
  await emptyWorkbook.xlsx.readFile(emptyOutputPath);
  for (const sheetName of ["即将开始", "成交标的", "流拍标的"]) {
    const sheet = emptyWorkbook.getWorksheet(sheetName);
    assert.equal(sheet.rowCount, 1);
    assert.equal(sheet.autoFilter, undefined);
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("portable productization checks passed");
