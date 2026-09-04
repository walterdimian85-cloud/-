import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanPropertyTitle } from "../../src/extractors/title.mjs";
import {
  extractCommunityNameWithEvidence,
} from "../../src/extractors/community.mjs";
import { extractParticipation } from "../../src/extractors/participation.mjs";
import {
  extractAreaFromText,
  extractAreaByPriority,
  findSummedComponentArea,
  areaNoteFromResult,
} from "../../src/extractors/area.mjs";
import { fieldEvidence } from "../../src/extractors/field-evidence.mjs";
import { recordRow } from "../../scripts/build_workbook.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const golden = JSON.parse(
  await fs.readFile(path.join(root, "tests/fixtures/v2-golden.json"), "utf8"),
);
const runSource = await fs.readFile(path.join(root, "scripts/run.mjs"), "utf8");
assert.match(runSource, /const jdAssessmentEvidence = extractAssessmentPrice\(body\)/u);
assert.match(runSource, /const jdListAssessmentPrice = parseMoney\(item\.assessment\)/u);
assert.match(runSource, /readAlibabaLabeledPriceEvidence[\s\S]*?element\.nextElementSibling[\s\S]*?element\.parentElement/u);
assert.match(runSource, /structuredAssessmentEvidence[\s\S]*?announcementAssessmentEvidence[\s\S]*?structuredMarketEvidence[\s\S]*?announcementMarketEvidence/u);
assert.match(runSource, /ASSESSMENT_PRICE_LABELS\.includes\(assessmentLabel\)/u);

for (const sample of golden.titles) {
  assert.equal(cleanPropertyTitle(sample.input), sample.expected, sample.id);
  const row = recordRow({
    标的名称: sample.input,
    标的类型: "住宅",
    平台: "阿里资产",
    网站链接: `https://example.invalid/${sample.id}`,
  });
  assert.equal(row[3], sample.expected, `${sample.id}: Excel必须复用统一标题解析器`);
}

for (const sample of golden.communities) {
  const result = extractCommunityNameWithEvidence({
    标的名称: sample.title,
    标的类型: sample.propertyType,
    平台: "阿里资产",
  });
  assert.equal(result.value, sample.expected, sample.id);
  assert.equal(result.evidence.value, sample.expected, `${sample.id}: 缺少证据值`);
  assert.equal(result.evidence.source.section, "标的名称后处理");
}

assert.equal(extractAreaFromText("建筑面积为105.41m²"), 105.41);
const areaResult = extractAreaByPriority([
  { text: "竞买公告 房屋建筑面积225.97平方米", rows: [] },
]);
assert.equal(areaResult.area, 225.97);
assert.equal(areaResult.source, "竞买公告标的物文字");
assert.equal(areaResult.rawExpression, "房屋建筑面积225.97平方米");
assert.match(areaResult.ruleId, /^area-/u);

for (const [text, expected] of [
  ["建筑面积113.34㎡（其中住宅建筑面积为105.21㎡；C013储藏间建筑面积为8.13㎡）", 105.21],
  ["建筑面积140.67㎡（其中住宅建筑面积为128.18㎡；储藏间建筑面积为12.49㎡）", 128.18],
  ["建筑面积152.25平方米（含住宅133.33平方米、储藏间18.92平方米）", 133.33],
]) {
  const result = extractAreaByPriority([{ text: "", rows: [[text]] }]);
  assert.equal(result.area, expected, `主住宅与附属物同时列示时只取主住宅：${text}`);
  assert.equal(result.ruleId, "area-main-with-ancillary-v2");
}

const nestedMainArea = extractAreaByPriority([{
  text: "建筑面积：房屋114.84平方米（储藏间5.84平方米）",
  rows: [],
}]);
assert.equal(nestedMainArea.area, 114.84);
assert.equal(areaNoteFromResult(nestedMainArea), "主住宅：114.84㎡；储藏间：5.84㎡。");

const houseAndAnnexArea = extractAreaByPriority([{
  text: "建筑面积为：其中房：69.9㎡，附属间7.79㎡，共计77.69㎡。",
  rows: [],
}]);
assert.equal(houseAndAnnexArea.area, 69.9);
assert.equal(areaNoteFromResult(houseAndAnnexArea), "主住宅：69.9㎡；附属间：7.79㎡。");

const unresolvedVillaArea = extractAreaByPriority([{
  text: "拍卖标的调查情况表 建筑面积 71.56/874.64共946.2㎡",
  rows: [],
}]);
assert.equal(unresolvedVillaArea.area, null);
assert.equal(unresolvedVillaArea.ruleId, "area-compound-values-unresolved-v2");
assert.equal(unresolvedVillaArea.reviewRequired, true);
assert.equal(
  areaNoteFromResult(unresolvedVillaArea),
  "71.56/874.64共946.2㎡，人工需复核",
);
assert.equal(
  areaNoteFromResult(
    { area: null, ruleId: "area-not-found-v2" },
    { hasAssessmentAttachment: true },
  ),
  "需打开网页评估报告提取面积",
);
assert.equal(
  areaNoteFromResult(
    { area: null, ruleId: "area-not-found-v2" },
    { hasAssessmentAttachment: false },
  ),
  "未找到评估报告",
);

const landAndBuildingArea = extractAreaByPriority([{
  sourceModule: "竞买公告",
  sourcePriority: 1,
  text: "宗地面积12788㎡/房屋建筑面积95.6㎡",
}]);
assert.equal(landAndBuildingArea.area, 95.6);
assert.match(landAndBuildingArea.keyword, /房屋建筑面积/u);

const interiorAreaStillExcluded = extractAreaByPriority([{
  sourceModule: "竞买公告",
  sourcePriority: 1,
  text: "套内建筑面积88.6㎡，分摊面积12.4㎡",
}]);
assert.equal(interiorAreaStillExcluded.area, null);

assert.equal(
  cleanPropertyTitle("福建省平潭综合实验区黄花山路45号（大潭映象16幢1单元402室）"),
  "黄花山路45号（大潭映象16幢1单元402室）",
);
assert.equal(
  cleanPropertyTitle("福州市平潭县潭城街道景贤路288号（正达·名郡25幢1单元19层1902房）"),
  "潭城街道景贤路288号（正达·名郡25幢1单元19层1902房）",
);
assert.equal(
  cleanPropertyTitle("江南新区笋江路南侧嘉龙·尚城花园2号楼店面06（复式）"),
  "江南新区笋江路南侧嘉龙·尚城花园2号楼店面06（复式）",
);
assert.equal(
  cleanPropertyTitle("港南路77号（原港南港务公司宿舍）1#楼506单元"),
  "港南路77号1#楼506单元",
);

const curatedCommunity = extractCommunityNameWithEvidence({
  标的名称: "田淮街131号东涂新村8幢704室",
  标的类型: "住宅",
  平台: "京东拍卖",
  城市: "泉州市",
  区域: "丰泽区",
});
assert.equal(curatedCommunity.value, "东涂新村");
assert.equal(curatedCommunity.evidence.ruleId, "community-curated-dictionary-v2");

assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "江滨北路潘山段北侧泉州万科城一期5号楼2601",
    标的类型: "住宅",
    城市: "泉州市",
    区域: "丰泽区",
  }).value,
  "泉州万科城",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "建新镇金环路1号金山碧水中区风荷苑13#楼306单元",
    标的类型: "住宅",
    城市: "福州市",
    区域: "仓山区",
  }).value,
  "金山碧水风荷苑",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "陈埭镇大乡村中国（晋江）鞋都B幢B1-55店铺",
    标的类型: "商业",
    城市: "泉州市",
    区域: "晋江市",
  }).value,
  "中国（晋江）鞋都",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "螺阳镇阳川路2号3幢1梯1507房产",
    标的类型: "住宅",
    城市: "泉州市",
    区域: "惠安县",
    _documents: [{ rows: [["小区名称", "奥林阳光"]], text: "" }],
  }).value,
  "奥林阳光",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "港南路77号1#楼506单元",
    原始标的名称: "港南路77号（原港南港务公司宿舍）1#楼506单元",
    标的类型: "住宅",
    城市: "福州市",
  }).value,
  "港南港务公司宿舍",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "安吉路281-60号",
    标的类型: "住宅",
    城市: "泉州市",
  }).value,
  "东方星城",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "湖滨林边茂林路118号A幢住宅",
    标的类型: "住宅",
    城市: "泉州市",
  }).value,
  "商住小区",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "东海中芸洲海景花园城高层高尚住宅区3#楼名尊2003",
    标的类型: "住宅",
    城市: "泉州市",
    区域: "丰泽区",
  }).value,
  "东海中芸洲海景花园",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "源昌银河新城湖滨南苑二期B区2号楼1601室",
    标的类型: "住宅",
    城市: "泉州市",
    区域: "丰泽区",
  }).value,
  "源昌银河新城",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "山腰金山商业街金8#514号房产",
    标的类型: "商业",
    城市: "泉州市",
    区域: "泉港区",
  }).value,
  "金山商业街",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "双下路37号乌山西路凤湖片安置房地块一2#楼1203单元",
    标的类型: "住宅",
    城市: "福州市",
    区域: "鼓楼区",
  }).value,
  "商住小区",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "金山工业集中区福湾片区3号厂房",
    标的类型: "工业",
    城市: "福州市",
    区域: "仓山区",
  }).value,
  "金山工业集中区福湾片区",
);
assert.equal(
  extractCommunityNameWithEvidence({
    标的名称: "福建金康塑胶有限公司名下工业房地产",
    标的类型: "工业",
    城市: "泉州市",
  }).value,
  "工业区",
);

const completedParticipation = extractParticipation({
  documents: [{ text: "阿里资产 6 人报名 149 人设置提醒 5668 次围观 竞买记录（28）" }],
  statusGroup: "已结束",
  outcome: "是",
  platform: "alibaba",
});
assert.equal(completedParticipation.registrationCount, 6);
assert.equal(completedParticipation.bidCount, 28);
assert.equal(completedParticipation.reviewRequired, false);

const typoParticipation = extractParticipation({
  documents: [{ text: "阿里资产 2人报名 应买记录（11）" }],
  statusGroup: "已结束",
  outcome: "是",
  platform: "alibaba",
});
assert.equal(typoParticipation.registrationCount, 2);
assert.equal(typoParticipation.bidCount, 11, "阿里页面的‘应买记录’必须映射为竞买记录");

const unsoldParticipation = extractParticipation({
  documents: [{ text: "本场已流拍 2人报名 竞买记录（7）" }],
  statusGroup: "已结束",
  outcome: "否",
  platform: "alibaba",
});
assert.equal(unsoldParticipation.registrationCount, 2);
assert.equal(unsoldParticipation.bidCount, 0);

const jdParticipation = extractParticipation({
  documents: [{ text: "京东拍卖 已成交 3人报名 出价记录(29)" }],
  statusGroup: "已结束",
  outcome: "是",
  platform: "jd",
});
assert.equal(jdParticipation.registrationCount, 3);
assert.equal(jdParticipation.bidCount, 29, "京东出价记录必须映射为竞买记录");

const upcomingParticipation = extractParticipation({
  documents: [{ text: "3人报名 竞买记录（5）" }],
  statusGroup: "即将开始",
  outcome: "即将开始",
});
assert.equal(upcomingParticipation.registrationCount, null);
assert.equal(upcomingParticipation.bidCount, null);
assert.equal(upcomingParticipation.applicable, false);

const endedParticipationRow = recordRow({
  标的名称: "首山路55号6#楼406单元",
  标的类型: "住宅",
  平台: "阿里资产",
  是否成交: "是",
  _状态分组: "已结束",
  "面积/㎡": 92.64,
  起拍价格: 524_496,
  评估价: 936_600,
  成交金额: 671_328,
  竞买记录: 28,
  报名人数: 6,
  网站链接: "https://sf-item.taobao.com/sf_item/1059137231549.htm",
});
assert.equal(endedParticipationRow[15], null, "折扣率由Excel公式写入");
assert.equal(endedParticipationRow[17], null, "溢价率由Excel公式写入");
assert.equal(endedParticipationRow[18], null, "成交单价由Excel公式写入");
assert.equal(endedParticipationRow[19], 28);
assert.equal(endedParticipationRow[20], 6);

const adjacentLabeledArea = extractAreaByPriority([{
  text: "",
  rows: [
    ["标的物介绍", "建筑面积", "建筑面积55.38㎡。"],
    ["分摊建筑面积", "9.84㎡"],
    ["土地总面积", "2801.29㎡"],
  ],
}]);
assert.equal(adjacentLabeledArea.area, 55.38);
assert.equal(adjacentLabeledArea.ruleId, "area-table-adjacent-labeled-cell-v2");

for (const [text, expected] of [
  ["2665.06㎡（其中1#117室建筑面积为39.76㎡、1#201室建筑面积为2625.3㎡）", 2665.06],
  ["182.66平方米（车库面积20.05平方米）", 182.66],
  ["122.88㎡（专有面积：95.24㎡）", 122.88],
]) {
  const result = extractAreaByPriority([{ text: "", rows: [["建筑面积", text]] }]);
  assert.equal(result.area, expected, `相邻值单元格总面积优先：${text}`);
  assert.equal(result.ruleId, "area-table-leading-total-in-value-cell-v2");
}

const tableComponentSum = extractAreaByPriority([{
  text: "",
  rows: [["建筑总面积", "房屋建筑面积109.83平方米，储藏间建筑面积18.16平方米。"]],
}]);
assert.equal(tableComponentSum.area, 109.83);
assert.equal(tableComponentSum.ruleId, "area-main-with-ancillary-v2");
assert.equal(areaNoteFromResult(tableComponentSum), "主住宅：109.83㎡；储藏间：18.16㎡。");

const textComponentSum = findSummedComponentArea(
  "7A21店铺建筑面积63.82平方米，专有建筑面积62.02平方米，分摊建筑面积1.8平方米；7A22店铺建筑面积35.3平方米",
);
assert.equal(textComponentSum.area, 99.12);
assert.deepEqual(textComponentSum.components, [63.82, 35.3]);

const repeatedComponentArea = findSummedComponentArea(
  "标的物住宅建筑面积为140.18平方米、柴火房面积为12.54平方米。根据权证再次记载住宅建筑面积为140.18平方米、柴火房面积为12.54平方米。",
  { allowMixedTypes: true },
);
assert.equal(repeatedComponentArea.area, 152.72, "同一组件在不同章节重复出现时只能计算一次");
assert.deepEqual(repeatedComponentArea.components, [140.18, 12.54]);

const certifiedBuildingSum = findSummedComponentArea(
  "地上建筑共2幢，其中1幢证载建筑面积196.55㎡，实测红线内建筑面积113.8㎡、红线外建筑面积88.17㎡；2幢证载建筑面积979.42㎡，实测红线内建筑面积1027.41㎡。",
);
assert.equal(certifiedBuildingSum.area, 1175.97, "证载面积不得与红线内外实测面积混加");
assert.deepEqual(certifiedBuildingSum.componentIdentities, ["1幢", "2幢"]);

const auctionScopeSum = findSummedComponentArea(
  "拍卖建筑物共2幢，其中1#建筑面积927.88平方米；2#建筑面积1345.92平方米。特别提醒：另有5#红线内建筑面积258.93平方米未列入拍卖范围。",
);
assert.equal(auctionScopeSum.area, 2273.8, "特别提醒中的范围外建筑不得计入拍卖总面积");

assert.equal(
  extractAreaFromText("简易搭盖未列入评估、拍卖范围，红线外建筑面积合计227.41㎡，仅供参考。"),
  null,
  "范围外面积必须被整体排除",
);

const verticalTableSum = extractAreaByPriority([{
  text: "",
  rows: [
    ["序号", "房号", "建筑面积（㎡）"],
    ["1", "B-33", "57.38"],
    ["2", "B-34", "51.42"],
    ["3", "B-35", "53.39"],
    ["4", "B-36", "47.57"],
  ],
}]);
assert.equal(verticalTableSum.area, 209.76, "同一表格面积列的连续标的行应求和");
assert.equal(verticalTableSum.ruleId, "area-table-vertical-component-sum-v2");

const pageExplicitTotal = extractAreaByPriority([{
  text: "标的物房屋建筑面积合计为17902.42㎡；土地使用权面积为21125㎡。",
  rows: [["幢号", "建筑面积（㎡）"], ["1#", "519.94"]],
}]);
assert.equal(pageExplicitTotal.area, 17902.42, "页面明确总面积必须优先于表格首个分项");
assert.equal(pageExplicitTotal.ruleId, "area-page-explicit-total-v2");

const compactTotalM2 = extractAreaByPriority([{
  sourceModule: "标的物介绍",
  sourcePriority: 1,
  text: "总241.34m2（226-7、226-8号121.29m2，226-9、226-10号120.05m2）",
  rows: [],
}]);
assert.equal(compactTotalM2.area, 241.34, "1057422830091：总数简写和m2单位必须识别");
assert.equal(compactTotalM2.ruleId, "area-page-explicit-total-v2");

const buildingAreaTotalWording = extractAreaByPriority([{
  sourceModule: "标的物介绍",
  sourcePriority: 1,
  text: "该房地产建筑面积总共为97.07平方米(其中905为53.59㎡、906为43.48㎡,分摊面积分别为9.59㎡、7.78㎡)，土地使用权面积为11.49平方米",
  rows: [],
}]);
assert.equal(buildingAreaTotalWording.area, 97.07, "1063237739728：建筑面积总共必须优先于分项和土地面积");

const combinedRoomArea = extractAreaByPriority([{
  sourceModule: "标的物介绍",
  sourcePriority: 1,
  text: "建筑面积：205  124.32平米\n206  124.41平米",
  rows: [],
}]);
assert.equal(combinedRoomArea.area, 248.73, "1063637123902：同类房室合并拍卖时应汇总");
assert.equal(combinedRoomArea.ruleId, "area-combined-rooms-sum-v2");
assert.equal(areaNoteFromResult(combinedRoomArea), "205 124.32平米   206 124.41平米");

const compactStoreComponents = extractAreaByPriority([{
  sourceModule: "拍卖标的物调查情况表",
  sourcePriority: 1,
  text: "建筑面积：4063店面27.18平方米、4064店面27.8平方米、4106店面26.73平方米、4107店面27.25平方米；",
  rows: [["建筑面积", "4063店面27.18平方米、4064店面27.8平方米、4106店面26.73平方米、4107店面27.25平方米"]],
}], {
  title: "六一中路378号福州特艺城4层4063、4064、4106、4107店面",
});
assert.equal(compactStoreComponents.area, 108.96, "311058991：标题所列四间店面面积必须求和");
assert.equal(compactStoreComponents.ruleId, "area-title-matched-components-sum-v2");
assert.match(areaNoteFromResult(compactStoreComponents), /4063店面27\.18平方米/u);
assert.match(areaNoteFromResult(compactStoreComponents), /合计108\.96㎡/u);

const announcementFallbackArea = extractAreaByPriority([{
  text: "标的物介绍 未载明面积。竞买公告 建筑面积   127.02㎡",
  rows: [],
}]);
assert.equal(announcementFallbackArea.area, 127.02, "1072059715857：介绍缺失时必须回退竞买公告");
assert.equal(announcementFallbackArea.source, "竞买公告标的物文字");

const trulyMissingArea = extractAreaByPriority([{
  text: "标的物介绍 未载明面积。竞买公告 未载明面积。",
  rows: [],
}]);
assert.equal(trulyMissingArea.area, null, "1071994886206：无页面证据时不得估算");
assert.equal(trulyMissingArea.ruleId, "area-not-found-v2");

const combinedRoomGuard = extractAreaByPriority([{
  text: "建筑面积：205室 124.32平米，C205车位 12.41平米",
  rows: [],
}]);
assert.notEqual(combinedRoomGuard.ruleId, "area-combined-rooms-sum-v2", "房屋与车位不得套用多室求和规则");

const bareUnitIdentifiers = findSummedComponentArea(
  "106建筑面积为304.30㎡、107建筑面积为316.74㎡",
);
assert.equal(bareUnitIdentifiers.area, 621.04, "连续房号即使没有室/号后缀也应识别为不同同类标的");

const mixedAreaConflict = extractAreaByPriority([{
  text: "竞买公告 住宅建筑面积为119.28平方米，附属间建筑面积为8.95平方米。",
  rows: [],
}]);
assert.equal(mixedAreaConflict.area, 119.28, "未明确总计时不得擅自把主房与附属物相加");
assert.equal(mixedAreaConflict.reviewRequired, false, "主房优先口径已确定后无需进入待复核");
assert.equal(mixedAreaConflict.conflicts[0].possibleCombinedArea, 128.23);
assert.equal(mixedAreaConflict.conflicts[0].type, "main-area-with-ancillary-components");
assert.equal(areaNoteFromResult(mixedAreaConflict), "主住宅：119.28㎡；附属间：8.95㎡。");

const mixedAreaRow = recordRow({
  标的名称: "测试住宅及储藏间",
  标的类型: "住宅",
  平台: "阿里资产",
  "面积/㎡": mixedAreaConflict.area,
  起拍价格: 1_000_000,
  评估价: 1_250_000,
  备注: areaNoteFromResult(mixedAreaConflict),
  网站链接: "https://example.invalid/mixed-area",
});
assert.equal(mixedAreaRow[11], 119.28);
assert.equal(mixedAreaRow.length, 18, "即将开始表不得包含成交金额及成交专属指标");
assert.equal(mixedAreaRow[14], 1_250_000, "评估价按元输出，与起拍价格口径一致");
assert.equal(mixedAreaRow[15], null, "折扣率由Excel公式写入");
assert.equal(mixedAreaRow[16], "主住宅：119.28㎡；附属间：8.95㎡。");
assert.equal(mixedAreaRow[17], "https://example.invalid/mixed-area");

assert.equal(
  extractAreaFromText("标的物介绍 面积：127.73平方米；套内建筑面积：94.22平方米；"),
  127.73,
  "套内建筑面积不得遮蔽同一段中的标的总面积",
);
assert.equal(
  extractAreaFromText("红线内建筑面积519.94㎡、红线外建筑面积408.77㎡；产权总面积5835.96㎡"),
  5835.96,
  "排除红线分项后必须继续扫描后续明确总面积",
);

assert.deepEqual(
  fieldEvidence({
    value: 225.97,
    dataType: "number",
    unit: "㎡",
    platform: "alibaba",
    section: "竞买公告",
    element: "建筑面积",
    rawText: "房屋建筑面积225.97平方米",
    ruleId: "area-announcement-text-v1",
    confidence: "high",
  }),
  {
    value: 225.97,
    dataType: "number",
    unit: "㎡",
    source: {
      platform: "alibaba",
      section: "竞买公告",
      element: "建筑面积",
      rawText: "房屋建筑面积225.97平方米",
    },
    ruleId: "area-announcement-text-v1",
    confidence: "high",
    conflicts: [],
    reviewRequired: false,
  },
);

console.log("V2 architecture regression cases passed");
