import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWorkbook,
  extractCommunityName,
  sortRecords,
  statusBucket,
} from "./build_workbook.mjs";
import {
  classifyPropertyType,
  cleanPropertyTitle,
  detectAlibabaOutcome,
  canonicalUrl,
  detectOutcome,
  interpretJdResult,
  detectStage,
  extractAlibabaInvestigation,
  extractAuctionDates,
  extractAreaByPriority,
  extractAreaFromText,
  extractOwnerFromTitle,
  extractParty,
  inferStatusGroup,
  isAlibabaAssetTradingPage,
  jdActionDelayMs,
  jdFilterPlan,
  assertHighWaterCompleteness,
  formatMissingHighWaterMarks,
  matchesStatusFilter,
  missingHighWaterMarks,
  normalizeAnchorPayload,
  parseMoney,
  progressPlan,
  qualityFields,
  restoreCheckpointRecords,
  shouldStopListScan,
  resolveAnchorBoundary,
  resolveAuctionDates,
  splitLocation,
} from "./run.mjs";

assert.equal(shouldStopListScan("https://example/anchor", false, 1, 1), false);
assert.equal(shouldStopListScan("https://example/anchor", true, 1, 1), true);
assert.equal(shouldStopListScan("", true, 1, 1), true);
assert.deepEqual(
  resolveAnchorBoundary("https://example/new", "https://example/moved", new Set(["https://example/new"])),
  { matched: true, mode: "known_record_fallback", url: "https://example/new" },
);
assert.deepEqual(
  resolveAnchorBoundary("https://example/moved", "https://example/moved", new Set()),
  { matched: true, mode: "primary", url: "https://example/moved" },
);

assert.equal(
  isAlibabaAssetTradingPage({ url: () => "https://sf-item.taobao.com/example" }, "首页 > 资产交易 > 项目详情"),
  true,
);
assert.equal(
  isAlibabaAssetTradingPage({ url: () => "https://sf-item.taobao.com/example" }, "首页 > 司法拍卖 > 标的详情"),
  false,
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.dirname(scriptDir);
const args = process.argv.slice(2);
const outputDir = path.resolve(args.find((arg) => !arg.startsWith("--")) || "tmp/self-check");
const writeTemplate = args.includes("--write-template");
const renderPreview = args.includes("--preview");

assert.equal(parseMoney("￥311.4339万"), 3_114_339);
assert.equal(parseMoney("3,114,339元"), 3_114_339);
assert.equal(parseMoney("1.2亿"), 120_000_000);
assert.equal(jdActionDelayMs(0), 4_000);
assert.equal(jdActionDelayMs(0.5), 4_500);
assert.equal(jdActionDelayMs(1), 5_000);
assert.deepEqual(jdFilterPlan("即将开始"), {
  projectControls: [
    { label: "竞价项目", selected: true },
    { label: "招商项目", selected: false },
    { label: "报价项目", selected: false },
  ],
  assetNatureControls: [
    { label: "诉讼资产", selected: true },
    { label: "刑案资产", selected: true },
  ],
  stateControls: [
    { label: "已结束", code: "end", selected: false },
    { label: "预告中", code: "notice", selected: true },
  ],
  sortLabel: "最新发布",
  sortClicks: 1,
  expectedSort: "最新发布",
});
assert.deepEqual(jdFilterPlan("已结束"), {
  projectControls: [
    { label: "竞价项目", selected: true },
    { label: "招商项目", selected: false },
    { label: "报价项目", selected: false },
  ],
  assetNatureControls: [
    { label: "诉讼资产", selected: true },
    { label: "刑案资产", selected: true },
  ],
  stateControls: [
    { label: "预告中", code: "notice", selected: false },
    { label: "已结束", code: "end", selected: true },
  ],
  sortLabel: "结束时间",
  sortClicks: 2,
  expectedSort: "结束时间由近到远",
});
assert.deepEqual(
  progressPlan(
    {
      platform: "alibaba",
      categories: ["住宅用房"],
      statusFilters: ["即将开始"],
      maxPages: 5,
      dryRun: false,
    },
    "20260731",
    "state/state.json",
  ).categories,
  ["住宅用房"],
);
const restoredState = { records: {} };
restoreCheckpointRecords(restoredState, {
  records: [
    {
      网站链接: "https://sf-item.taobao.com/sf_item/1000000000999.htm",
      标的名称: "断点记录",
    },
  ],
});
assert.equal(Object.keys(restoredState.records).length, 1);
assert.equal(
  canonicalUrl("https://paimai.jd.com/310860146?utm_source=test#top"),
  "https://paimai.jd.com/310860146",
);
assert.equal(
  canonicalUrl(
    "https://sf-item.taobao.com/sf_item/1030718892530.htm?spm=abc",
  ),
  "https://sf-item.taobao.com/sf_item/1030718892530.htm",
);
assert.equal(
  canonicalUrl(
    "https://susong-item.taobao.com/auction/1030718892530.htm?spm=abc",
  ),
  "https://sf-item.taobao.com/sf_item/1030718892530.htm",
);

const dates = extractAuctionDates(
  "福建省厦门市中级人民法院将于2026年7月23日10时至2026年7月24日10时止进行公开拍卖。",
);
assert.equal(dates.start, "2026-07-23T02:00:00.000Z");
assert.equal(dates.end, "2026-07-24T02:00:00.000Z");
const aliRangeDates = extractAuctionDates(
  "本院将于2026年8月1日10时起至2026年9月30日10时止进行变卖。",
);
assert.equal(aliRangeDates.start, "2026-08-01T02:00:00.000Z");
assert.equal(aliRangeDates.end, "2026-09-30T02:00:00.000Z");
const announcementDates = extractAuctionDates(
  "某法院将于计划网拍时间2026年7月26日10时至2026年9月24日10时止（延时的除外）在淘宝网司法拍卖网络平台上进行公开变卖活动。",
);
assert.equal(announcementDates.start, "2026-07-26T02:00:00.000Z");
assert.equal(announcementDates.end, "2026-09-24T02:00:00.000Z");
assert.equal(
  extractAuctionDates("距开始 12天（2026-08-06 10:00开拍）").start,
  "2026-08-06T02:00:00.000Z",
);
assert.deepEqual(
  resolveAuctionDates("起拍时间：2026年8月1日10时00分", "二拍"),
  {
    start: "2026-08-01T02:00:00.000Z",
    end: null,
    endSource: "未找到",
  },
);
assert.equal(
  resolveAuctionDates(
    "预告中 09月25日 10:00:00开始",
    "一拍",
    new Date("2026-08-24T00:00:00+08:00"),
  ).start,
  "2026-09-25T02:00:00.000Z",
);
assert.equal(
  extractAuctionDates("结束时间 2026/07/31 10:00:00").end,
  "2026-07-31T02:00:00.000Z",
);
assert.deepEqual(splitLocation("福建厦门市思明区禾祥西路585号"), {
  所在省份: "福建省",
  城市: "厦门市",
  区域: "思明区",
});
assert.deepEqual(splitLocation("福建省晋江市东石镇"), {
  所在省份: "福建省",
  城市: "泉州市",
  区域: "晋江市",
});
assert.deepEqual(
  splitLocation(
    "厦门市集美区锦亭北路324号1204室",
    "页面推荐：厦门市思明区某房产",
  ),
  {
    所在省份: "福建省",
    城市: "厦门市",
    区域: "集美区",
  },
);
  assert.equal(
    cleanPropertyTitle("【一拍】福建省泉州市丰泽区东海街道宝珊花园45A号别墅"),
    "东海街道宝珊花园45A号别墅",
  );
  assert.equal(
    cleanPropertyTitle("龙岩大道中 29 号39 幢 15房产及B15附属用房、C0400、C0390、C0399号车位 可贷款"),
    "龙岩大道中29号39幢15房产及B15附属用房、C0400、C0390、C0399号车位",
  );
assert.equal(classifyPropertyType("住宅用房", "地下停车位A101"), "车位");
assert.equal(classifyPropertyType("住宅用房", "宝珊花园独栋别墅"), "别墅");
assert.equal(classifyPropertyType("住宅用房", "复式住宅带储藏间"), "住宅");
assert.equal(classifyPropertyType("商业用房", "地下车库车位"), "商业");
assert.equal(classifyPropertyType("工业用房", "仓储物流项目"), "工业");
assert.equal(
  extractAreaFromText("该标的建筑总面积1,234.56平方米，现状以实物为准。"),
  1234.56,
);
assert.equal(
  extractAreaFromText("标的物介绍 建筑面积 131.02m²"),
  131.02,
);
assert.equal(
  extractAreaFromText("房屋状况 建筑面积 105.41/㎡"),
  105.41,
);
const legacyAreaByPriority = (documents) => {
  const result = extractAreaByPriority(documents);
  const ruleId = result.area === null
    ? "area-not-found-v1"
    : result.source === "竞买公告标的物文字"
      ? "area-announcement-text-v1"
      : result.source === "页面表格建筑面积列"
        ? "area-table-v1"
        : result.ruleId;
  return { area: result.area, source: result.source, ruleId };
};
assert.deepEqual(
  legacyAreaByPriority([
    {
      text:
        "标的物介绍 建筑面积90平方米\n竞买公告 本次拍卖房产建筑总面积88.25平方米。",
      rows: [["建筑面积", "89.50平方米"]],
    },
  ]),
  { area: 88.25, source: "竞买公告标的物文字", ruleId: "area-announcement-text-v1" },
);
assert.deepEqual(
  legacyAreaByPriority([
    {
      text: "标的物调查情况表",
      rows: [["房屋建筑面积", "109.36平方米"]],
    },
  ]),
  { area: 109.36, source: "页面表格建筑面积列", ruleId: "area-table-v1" },
);
assert.deepEqual(
  legacyAreaByPriority([
    {
      text: "拍卖标的物调查情况表 房屋状况",
      rows: [["建筑面积", "105.41/m²"]],
    },
  ]),
  { area: 105.41, source: "页面表格建筑面积列", ruleId: "area-table-v1" },
);
assert.deepEqual(
  legacyAreaByPriority([
    {
      text: "竞买公告 拍卖标的：厦门市同安区美峰六里1号3101单元",
      rows: [
        ["项目名称", "权证号码", "用途", "建筑面积（m2）"],
        ["厦门市同安区美峰六里1号3101单元", "闽（2020）厦门市不动产权第0084498号", "SOHO办公/商品房", "269.35"],
      ],
    },
  ]),
  { area: 269.35, source: "页面表格建筑面积列", ruleId: "area-table-v1" },
);
assert.deepEqual(
  legacyAreaByPriority([
    {
      text: "竞买公告",
      rows: [
        ["项目名称", "宗地面积（m2）", "建筑面积（m2）"],
        ["测试标的", "2253.15", "143.33"],
      ],
    },
  ]),
  { area: 143.33, source: "页面表格建筑面积列", ruleId: "area-table-v1" },
);
assert.deepEqual(
  legacyAreaByPriority([{ text: "标的物介绍 未披露建筑面积", rows: [] }]),
  { area: null, source: "未找到", ruleId: "area-not-found-v1" },
);
assert.equal(
  extractCommunityName({
    标的名称: "疏港路宝珊花园朝阳苑朝晖北路45A号别墅",
    标的类型: "别墅",
  }),
  "宝珊花园",
);
assert.equal(
  extractCommunityName({
    标的名称: "某工业厂房及配套设施",
    标的类型: "工业",
  }),
  "工业区",
);
assert.equal(detectStage("【二拍】某房产", ""), "二拍");
assert.equal(
  detectStage(
    "一拍 址在永春县五里街镇仰贤社区桃源华庭C3-2603的房产",
    "竞买公告中说明流拍后将进行第二次拍卖",
  ),
  "一拍",
);
assert.equal(detectOutcome("已结束\n此标的物被出价0次"), "否");
assert.equal(detectOutcome("已结束\n此标的物被出价2次"), "是");
assert.deepEqual(interpretJdResult("已成交", 741_722.4), {
  outcome: "是",
  amount: 741_722.4,
});
assert.deepEqual(interpretJdResult("已流拍", 1_145_799.2), {
  outcome: "否",
  amount: 0,
});
assert.deepEqual(interpretJdResult("已结束", 1_000_000), {
  outcome: "待核验",
  amount: null,
});
assert.equal(
  detectAlibabaOutcome("本场已结束！\n拍下价 481,985元"),
  "是",
);
assert.equal(
  detectAlibabaOutcome("本场已流拍，无人出价！\n当前价 1,280,000元"),
  "否",
);
assert.equal(
  detectAlibabaOutcome("本场已结束！\n拍下价低于起拍价"),
  "是",
);
assert.equal(
  detectAlibabaOutcome("本场已流拍，无人出价！\n当前价与起拍价不一致"),
  "否",
);
assert.equal(
  detectAlibabaOutcome("竞拍流程：竞价成功、支付尾款"),
  "待核验",
);

const residentialAnchors = normalizeAnchorPayload([
  {
    平台: "阿里资产",
    标的类型: "住宅用房",
    状态: "即将开始",
    网站链接: "https://sf-item.taobao.com/sf_item/1000000000001.htm?spm=x",
  },
  {
    平台: "阿里资产",
    标的类型: "住宅用房",
    状态: "已结束",
    网站链接: "https://sf-item.taobao.com/sf_item/1000000000003.htm",
  },
]);
assert.equal(Object.keys(residentialAnchors).length, 2);
assert.equal(missingHighWaterMarks({}, "alibaba").length, 6);
assert.equal(missingHighWaterMarks({}, "jd").length, 6);
assert.equal(missingHighWaterMarks({}, "all").length, 12);
const missingAlibaba = missingHighWaterMarks(residentialAnchors, "alibaba");
assert.equal(missingAlibaba.length, 4);
assert.ok(
  formatMissingHighWaterMarks(missingAlibaba).includes(
    "还缺少前一日阿里资产工业用房类别中已结束的最新数据链接，请您提供链接。",
  ),
);
assert.ok(
  !formatMissingHighWaterMarks(missingAlibaba).includes(
    "阿里资产工业用房类别中正在进行",
  ),
);
const completeAlibabaAnchors = normalizeAnchorPayload({
  "alibaba:住宅用房:即将开始":
    "https://sf-item.taobao.com/sf_item/1000000000101.htm",
  "alibaba:住宅用房:已结束":
    "https://sf-item.taobao.com/sf_item/1000000000102.htm",
  "alibaba:商业用房:即将开始":
    "https://sf-item.taobao.com/sf_item/1000000000201.htm",
  "alibaba:商业用房:已结束":
    "https://sf-item.taobao.com/sf_item/1000000000202.htm",
  "alibaba:工业用房:即将开始":
    "https://sf-item.taobao.com/sf_item/1000000000301.htm",
  "alibaba:工业用房:已结束":
    "https://sf-item.taobao.com/sf_item/1000000000302.htm",
});
assert.equal(missingHighWaterMarks(completeAlibabaAnchors, "alibaba").length, 0);
assert.doesNotThrow(() =>
  assertHighWaterCompleteness(completeAlibabaAnchors, "alibaba"),
);
assert.throws(
  () => assertHighWaterCompleteness(residentialAnchors, "alibaba"),
  /前一日高水位链接不完整/,
);
assert.equal(matchesStatusFilter("即将开始 07月30日10:00", "即将开始"), true);
assert.equal(matchesStatusFilter("竞价已结束", "已结束"), true);
assert.equal(
  inferStatusGroup(
    "待核验",
    {
      start: "2026-08-01T02:00:00.000Z",
      end: "2026-08-02T02:00:00.000Z",
    },
    new Date("2026-07-24T00:00:00.000Z").valueOf(),
  ),
  "即将开始",
);
assert.equal(
  detectOutcome(
    "一拍 某房产\n距开始 34天11时33分57秒 (2026-08-27 10:00开拍)\n竞拍流程 报名交钱 出价竞拍 竞价成功 支付尾款\n流拍再买",
  ),
  "即将开始",
);
assert.equal(
  extractParty("申请执行人：中国银行股份有限公司厦门分行\n被执行人：张某", [
    "债权人",
    "申请执行人",
  ]),
  "中国银行股份有限公司厦门分行",
);
assert.equal(
  extractParty("被执行人：李某某\n标的物所在地：福建省泉州市", [
    "债务人",
    "被执行人",
  ]),
  "李某某",
);
assert.equal(
  extractParty("被执行人：罗* 案号:(2026)川0108执恢557号", [
    "债务人",
    "被执行人",
  ]),
  "罗*",
);
assert.equal(
  extractOwnerFromTitle(
    "一拍 龙岩市徽景建筑科技有限公司名下坐落于长汀县工贸新城的建筑物",
  ),
  "龙岩市徽景建筑科技有限公司",
);
assert.equal(
  extractParty("拍卖财产相关的被执行人的债务由买受人承担", [
    "债务人",
    "被执行人",
  ]),
  "未找到",
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["标的物所有人", "李某某"],
      [
        "权利限制情况",
        "查封：泉州市丰泽区人民法院；抵押：厦门银行股份有限公司泉州分行、石狮市大长江小额贷款有限公司",
      ],
    ],
    "",
  ),
  {
    owner: "李某某",
    mortgageCreditor:
      "厦门银行股份有限公司泉州分行、石狮市大长江小额贷款有限公司",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["标的物所有人", "被执行人郑某所有"],
      ["抵押", "中国邮政储蓄银行股份有限公司屏南县支行)"],
    ],
    "",
  ),
  {
    owner: "郑某",
    mortgageCreditor: "中国邮政储蓄银行股份有限公司屏南县支行",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      [
        "标的物所有人",
        "权利份额、房屋坐落、幢号、房号、所在层、建筑面积、用途、房屋性质、状态、登记时间",
      ],
      ["抵押", "有。"],
    ],
    "",
  ),
  {
    owner: "未找到",
    mortgageCreditor: "未找到",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["拍品所有人", "许某某、赵某某"],
      [
        "权利限制情况",
        "1.被法院查封2.抵押于中国农业银行股份有限公司永春县支行",
      ],
    ],
    "",
  ),
  {
    owner: "许某某、赵某某",
    mortgageCreditor: "中国农业银行股份有限公司永春县支行",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["标的物所有人", "曾某光"],
      [
        "权利限制情况",
        "1、已被本院查封；2、抵押给本案申请执行人中国银行股份有限公司莆田分行。",
      ],
    ],
    "",
  ),
  {
    owner: "曾某光",
    mortgageCreditor: "中国银行股份有限公司莆田分行",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["标的所有人", "南平博基房地产开发有限公司"],
      ["抵押", "林玉英"],
    ],
    "",
  ),
  {
    owner: "南平博基房地产开发有限公司",
    mortgageCreditor: "林玉英",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["产权人", "某某实业有限公司"],
      [
        "权利限制情况",
        "抵押于厦门银行股份有限公司泉州分行；抵押给石狮市大长江小额贷款有限公司。",
      ],
    ],
    "",
  ),
  {
    owner: "某某实业有限公司",
    mortgageCreditor:
      "厦门银行股份有限公司泉州分行、石狮市大长江小额贷款有限公司",
  },
);
assert.deepEqual(
  extractAlibabaInvestigation(
    [
      ["标的所有人", "王某某"],
      ["抵押", "已抵押"],
    ],
    "",
  ),
  {
    owner: "王某某",
    mortgageCreditor: "未找到",
  },
);
assert.deepEqual(
  qualityFields({
    城市: "厦门市",
    区域: "翔安区",
    标的名称: "示例",
    标的类型: "住宅",
    发拍次数: "一拍",
    拍卖时间: "2026-08-26T02:00:00.000Z",
    发拍时间: "2026-08-26T02:00:00.000Z",
    竞拍结束时间: "2026-08-27T02:00:00.000Z",
    处置法院: "龙岩市新罗区人民法院",
    "面积/㎡": 89.5,
    债权人: "未找到",
    债务人: "未找到",
    起拍价格: 760000,
    评估价: 950000,
    是否成交: "即将开始",
    网站链接: "https://paimai.jd.com/310998950",
  }),
  [],
);
assert.deepEqual(
  qualityFields(
    {
      城市: "厦门市",
      区域: "翔安区",
      标的名称: "示例",
      标的类型: "住宅",
      发拍次数: "一拍",
      拍卖时间: "2026-08-26T02:00:00.000Z",
      处置法院: "龙岩市新罗区人民法院",
      "面积/㎡": 89.5,
      债权人: "未找到",
      债务人: "未找到",
      起拍价格: 760000,
      评估价: 950000,
      是否成交: "即将开始",
      网站链接: "https://paimai.jd.com/310998950",
    },
    true,
  ),
  ["债权人", "债务人"],
);

const records = [
  {
    所在省份: "福建省",
    城市: "厦门市",
    区域: "思明区",
    标的名称: "福建省厦门市思明区幸福家园3号楼501室",
    标的类型: "住宅",
    平台: "京东拍卖",
    发拍次数: "一拍",
    发拍时间: "2026-07-23T02:00:00.000Z",
    竞拍结束时间: "2026-07-24T02:00:00.000Z",
    是否成交: "即将开始",
    _状态分组: "即将开始",
    处置法院: "福建省厦门市中级人民法院",
    "面积/㎡": 98.5,
    债权人: "未找到",
    债务人: "张某",
    起拍价格: 3_114_339,
    评估价: 4_449_055,
    成交金额: 0,
    网站链接: "https://paimai.jd.com/310860146",
  },
  {
    所在省份: "福建省",
    城市: "泉州市",
    区域: "晋江市",
    标的名称: "福建省泉州市晋江市某制造企业厂区不动产",
    标的类型: "工业",
    平台: "阿里资产",
    发拍次数: "二拍",
    发拍时间: "2026-07-20T02:00:00.000Z",
    竞拍结束时间: "2026-07-21T02:00:00.000Z",
    是否成交: "是",
    _状态分组: "已结束",
    处置法院: "晋江市人民法院",
    "面积/㎡": 2500,
    债权人: "某银行",
    债务人: "某公司",
    起拍价格: 10_000_000,
    评估价: 15_000_000,
    成交金额: 12_000_000,
    网站链接: "https://sf-item.taobao.com/sf_item/1000000000000.htm",
  },
  {
    所在省份: "福建省",
    城市: "福州市",
    区域: "鼓楼区",
    标的名称: "福州市鼓楼区中心大厦101店面",
    标的类型: "商业",
    平台: "京东拍卖",
    发拍次数: "一拍",
    发拍时间: "2026-08-18T02:00:00.000Z",
    竞拍结束时间: "2026-08-19T02:00:00.000Z",
    是否成交: "即将开始",
    _状态分组: "即将开始",
    处置法院: "福州市鼓楼区人民法院",
    "面积/㎡": "未找到",
    债权人: "未找到",
    债务人: "李某",
    起拍价格: 5_000_000,
    评估价: 7_000_000,
    成交金额: 0,
    网站链接: "https://paimai.jd.com/300000000",
  },
];

assert.deepEqual(
  sortRecords([
    { 平台: "京东拍卖", 城市: "福州市", 区域: "鼓楼区", 网站链接: "f" },
    { 平台: "阿里资产", 城市: "厦门市", 区域: "集美区", 网站链接: "x" },
    { 平台: "阿里资产", 城市: "南平市", 区域: "武夷山市", 网站链接: "w" },
    { 平台: "阿里资产", 城市: "龙岩市", 区域: "长汀县", 网站链接: "l" },
    { 平台: "阿里资产", 城市: "南平市", 区域: "建阳区", 网站链接: "j" },
    { 平台: "阿里资产", 城市: "宁德市", 区域: "福安市", 网站链接: "n" },
  ]).map((record) => `${record.平台}/${record.城市}/${record.区域}`),
  [
    "阿里资产/龙岩市/长汀县",
    "阿里资产/南平市/建阳区",
    "阿里资产/南平市/武夷山市",
    "阿里资产/宁德市/福安市",
    "阿里资产/厦门市/集美区",
    "京东拍卖/福州市/鼓楼区",
  ],
);
assert.equal(statusBucket(records[0]), "即将开始");
assert.equal(statusBucket(records[1]), "已结束");
assert.equal(statusBucket(records[2]), "即将开始");

await fs.mkdir(outputDir, { recursive: true });
const workbookQa = await buildWorkbook({
  records,
  reviewItems: [
    {
      平台: "阿里资产",
      标的类型: "住宅用房",
      列表状态: "已结束",
      标的名称: "新版页面待核验样例",
      网站链接: "https://sf-item.taobao.com/sf_item/1000000000000.htm",
      待复核原因: "新版阿里诉讼详情页仅返回空壳或登录页，需人工核验",
      记录时间: "2026-07-26T02:00:00.000Z",
    },
  ],
  outputPath: path.join(outputDir, "self-check.xlsx"),
  previewDir: renderPreview ? path.join(outputDir, "preview") : undefined,
});
const checkpointQa = await buildWorkbook({
  records: [records[2], records[0], records[1]],
  reviewItems: [],
  outputPath: path.join(outputDir, "self-check-progress.xlsx"),
  preserveOrder: true,
  progressInfo: {
    status: "采集中",
    savedCount: 2,
    failureCount: 1,
    platform: "alibaba",
    category: "住宅用房",
    statusFilter: "即将开始",
    currentTitle: "断点续爬测试",
    currentUrl:
      "https://sf-item.taobao.com/sf_item/1000000000001.htm",
    updatedAt: "2026-07-31T02:00:00.000Z",
    resumeHint: "重新运行相同命令将自动续爬",
  },
  previewDir: renderPreview
    ? path.join(outputDir, "progress-preview")
    : undefined,
});
assert.equal(workbookQa.totalRows, 3);
assert.equal(workbookQa.upcomingRows, 2);
assert.equal(workbookQa.endedRows, 1);
assert.equal(workbookQa.reviewRows, 1);
assert.ok(!workbookQa.formulaErrors.includes("#REF!"));
assert.ok(!workbookQa.formulaErrors.includes("#DIV/0!"));
assert.ok(!workbookQa.formulaErrors.includes("#VALUE!"));
assert.equal(checkpointQa.totalRows, 3);
assert.ok(
  await fs
    .access(checkpointQa.outputPath)
    .then(() => true)
    .catch(() => false),
);

let templatePath = null;
if (writeTemplate) {
  templatePath = path.join(skillDir, "assets", "房源信息整理模板.xlsx");
  await buildWorkbook({ records: [], outputPath: templatePath });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      workbook: workbookQa.outputPath,
      progressWorkbook: checkpointQa.outputPath,
      previews: renderPreview ? path.join(outputDir, "preview") : null,
      template: templatePath,
    },
    null,
    2,
  ),
);
process.exit(0);
