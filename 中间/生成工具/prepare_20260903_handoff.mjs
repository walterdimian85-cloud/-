import fs from "node:fs/promises";
import path from "node:path";

const root = "E:\\dsh";
const batchDir = path.join(root, "中间", "法拍agent房源结果目录", "20260903（1）");
const progressPath = path.join(batchDir, "采集进度.json");
const outputDir = path.join(root, "中间", "WorkBuddy交接", "20260903");
const inputPath = path.join(outputDir, "20260903三产物输入.json");
const manifestPath = path.join(outputDir, "manifest.json");
const dateKey = "20260903";
const newDate = "09-03";
const quanzhouOrder = ["丰泽区", "鲤城区", "洛江区", "晋江市", "石狮市", "南安市", "惠安县", "台商投资区", "泉港区", "安溪县", "永春县", "德化县"];
const fuzhouOrder = ["鼓楼区", "仓山区", "台江区", "晋安区", "闽侯县", "福清市", "马尾区", "连江县", "长乐区", "罗源县", "闽清县", "永泰县", "平潭县"];
const roundOrder = { "一拍": 1, "二拍": 2, "变卖": 3 };
const historyRoot = path.join(root, "中间", "WorkBuddy交接");

const readJson = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = async (file, data) => {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(temp, file);
};
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const normalizeUrl = (value) => String(value || "").trim().replace(/[?#].*$/u, "");
const datePart = (value) => String(value || "").slice(0, 10);
const statusName = (record) => record.是否成交 === "即将开始" ? "即将开始" : record.是否成交 === "是" ? "成交标的" : "流拍标的";
const keyOf = (record) => [record.平台, normalizeUrl(record.网站链接), record.发拍次数, statusName(record), record.拍卖时间 || record.竞拍结束时间 || ""].join("|");

function stripParentheses(value) {
  let next = String(value || "");
  let previous;
  do { previous = next; next = next.replace(/[（(][^（）()]*[）)]/gu, ""); } while (next !== previous);
  return next;
}
function standardAddress(record) {
  let value = String(record.标的名称 || "").trim();
  value = value.replace(/^(?:福建省|江苏省|福州市|泉州市)/u, "");
  value = value.replace(/^(?:址在|位于|坐落于|坐落在)/u, "");
  const region = String(record.区域 || "");
  if (region) value = value.replace(new RegExp(`^${region.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`), "");
  value = stripParentheses(value);
  value = value.replace(/的(?:房产|不动产|房地产|及室内家具家电|及屋内物品)$/u, "");
  value = value.replace(/(?:房产|不动产|房地产|及室内家具家电|及屋内物品)$/u, "");
  value = value.replace(/的$/u, "");
  return value.replace(/\s+/gu, " ").replace(/[，,]{2,}/gu, "，").trim();
}
function displayCourt(value) {
  const court = String(value || "").trim();
  if (court === "福建省泉州市中级人民法院") return "泉州市中级人民法院";
  if (court === "福建省福州市中级人民法院") return "福州市中级人民法院";
  if (/^(?:福建省|泉州市|福州市)/u.test(court) && !/^[^省]+省[^市]+市中级人民法院$/u.test(court)) return court.replace(/^(?:福建省|泉州市|福州市)/u, "");
  return court;
}
function normalizedRegion(record) {
  return record.区域 === "平潭综合实验区" ? "平潭县" : record.区域;
}
function cityRank(record) {
  const order = record.城市 === "泉州市" ? quanzhouOrder : fuzhouOrder;
  const index = order.indexOf(record.区域);
  return index < 0 ? 999 : index;
}
function outputRecord(record) {
  const area = Number(record["面积/㎡"]);
  const start = Number(record.起拍价格);
  const appraisal = Number(record.评估价);
  const won = Number(record.成交金额);
  const source = statusName(record);
  const result = {
    "所在省份": record.所在省份,
    "城市": record.城市,
    "区域": normalizedRegion(record),
    "原始标的名称": record.标的名称,
    "标准地址": standardAddress(record),
    "标的名称": standardAddress(record),
    "小区名称（仅供参考）": record["小区名称（仅供参考）"],
    "标的类型": record.标的类型,
    "平台": record.平台,
    "发拍次数": record.发拍次数,
    "拍卖时间": record.拍卖时间,
    "是否成交": record.是否成交,
    "处置法院": displayCourt(record.处置法院),
    "面积/㎡": area,
    "起拍单价-元/㎡": area > 0 ? Math.round(start / area) : null,
    "起拍价格": start,
    "评估价(万元)": Number.isFinite(appraisal) ? round(appraisal / 10000, 4) : null,
    "折扣率(%)": appraisal > 0 ? round(start / appraisal * 100, 2) : null,
    "成交金额": record.是否成交 === "是" ? won : 0,
    "溢价率": record.是否成交 === "是" && start > 0 ? round(won / start - 1, 4) : null,
    "成交单价": record.是否成交 === "是" && area > 0 ? Math.round(won / area) : null,
    "竞买记录": record.竞买记录 ?? null,
    "报名人数": record.报名人数 ?? null,
    "备注": record.备注 || null,
    "网站链接": normalizeUrl(record.网站链接),
    "_来源表": source,
    "_来源平台": record.平台,
    "_上新日期": source === "即将开始" ? newDate : null,
  };
  return result;
}

const progress = await readJson(progressPath);
for (const record of progress.records) if (record.是否成交 === "即将开始") record._上新日期 = newDate;
for (const record of progress.records) {
  if (record.网站链接 !== "https://sf-item.taobao.com/sf_item/1073200298425.htm") continue;
  // 列表原文明确“结束 2026年09月03日”，而旧字段误留未来日期；页面未披露精确时分。
  record.拍卖时间 = "2026-09-03T00:00:00Z";
  record.竞拍结束时间 = "2026-09-03T00:00:00Z";
  record._endTimeSource = "阿里列表明确结束日期（时间未披露）";
}
await writeJson(progressPath, progress);

const excluded = [];
const valid = [];
for (const record of progress.records) {
  const pureAccessory = ["车位", "车库"].includes(record.标的类型);
  if (pureAccessory) {
    excluded.push({
      "网站链接": normalizeUrl(record.网站链接), "标的名称": record.标的名称,
      "路线": record._源分类 || record.标的类型, "原始状态": record.是否成交,
      "原始标的类型": record.标的类型, "原因": "独立拍卖的纯车位/纯车库，按硬性规则§9排除",
    });
  } else valid.push(record);
}

const historyKeys = new Set();
for (const folder of await fs.readdir(historyRoot, { withFileTypes: true })) {
  if (!folder.isDirectory() || folder.name === dateKey) continue;
  const file = path.join(historyRoot, folder.name, `${folder.name}三产物输入.json`);
  try {
    const history = await readJson(file);
    for (const group of Object.values(history.表 || {})) for (const item of group || []) {
      historyKeys.add([item.平台, normalizeUrl(item.网站链接), item.发拍次数, item._来源表, item.拍卖时间 || ""].join("|"));
    }
  } catch { /* 历史批次不存在唯一输入时跳过。 */ }
}
const duplicates = [];
const deduped = [];
const seen = new Set();
for (const record of valid) {
  const key = keyOf(record);
  if (seen.has(key)) { duplicates.push({ "网站链接": record.网站链接, "原因": "本批复合去重键重复" }); continue; }
  seen.add(key);
  if (historyKeys.has(key)) { duplicates.push({ "网站链接": record.网站链接, "原因": "与历史同阶段、同轮次、同时间复合去重键重复" }); continue; }
  deduped.push(record);
}
const output = deduped.map(outputRecord);
const groups = { "即将开始": [], "成交标的": [], "流拍标的": [] };
for (const record of output) groups[record._来源表].push(record);
for (const [group, rows] of Object.entries(groups)) rows.sort((a, b) => {
  if (group !== "即将开始") {
    const dateDelta = String(a.拍卖时间 || "").localeCompare(String(b.拍卖时间 || ""));
    if (dateDelta) return dateDelta;
  }
  const cityDelta = String(a.城市).localeCompare(String(b.城市), "zh-Hans-CN");
  if (cityDelta) return cityDelta;
  const aRank = cityRank(a), bRank = cityRank(b);
  if (aRank !== bRank) return aRank - bRank;
  const roundDelta = (roundOrder[a.发拍次数] || 99) - (roundOrder[b.发拍次数] || 99);
  if (roundDelta) return roundDelta;
  return String(a.拍卖时间 || "").localeCompare(String(b.拍卖时间 || ""));
});

const unresolved = [];
for (const record of output) {
  const missing = [];
  for (const field of ["所在省份", "城市", "区域", "原始标的名称", "标准地址", "小区名称（仅供参考）", "标的类型", "平台", "发拍次数", "拍卖时间", "是否成交", "处置法院", "面积/㎡", "起拍价格", "评估价(万元)", "网站链接"]) {
    if (record[field] === null || record[field] === undefined || record[field] === "" || record[field] === "未找到" || record[field] === "待补采" || record[field] === "待核验") missing.push(field);
  }
  if (record._来源表 !== "即将开始" && (record.报名人数 === null || record.报名人数 === undefined)) missing.push("报名人数");
  if (missing.length) unresolved.push({ "网站链接": record.网站链接, "原始标题": record.原始标的名称, "城市": record.城市, "区域": record.区域, "数据阶段": record._来源表, "日期": record._来源表 === "即将开始" ? record._上新日期 : datePart(record.拍卖时间), "缺失字段": missing });
}
const input = { dateKey, generatedAt: new Date().toISOString(), 来源: [progressPath, path.join(batchDir, "20260903新增房源信息.xlsx")], 表: groups, 缺失统计: { "未解决必采字段": unresolved.length, "人工复核": unresolved } };
const count = Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length]));
const byCity = {};
for (const row of output) {
  byCity[row.城市] ||= { "即将开始": 0, "成交标的": 0, "流拍标的": 0 };
  byCity[row.城市][row._来源表] += 1;
}
const manifest = {
  dateKey, "状态": unresolved.length || duplicates.length ? "数据准备质检未通过" : "数据准备质检完成，允许进入产物生成",
  "规则正本路径": path.join(root, "中间", "采集复核与交接硬性规则.md"), "规则版本": "1.4", "批次日期": dateKey,
  "唯一主输入": inputPath, "上新归属日期映射": { "即将开始": newDate },
  "结果日期规则": "成交和流拍只按记录中的真实结束时间归档，不使用上新归属日期。",
  "地区": ["福州市", "泉州市"], "平台": [...new Set(output.map((x) => x.平台))], "数据来源": input.来源,
  "各状态数量": { "原始采集": { "即将开始": progress.records.filter((x) => x.是否成交 === "即将开始").length, "成交": progress.records.filter((x) => x.是否成交 === "是").length, "流拍": progress.records.filter((x) => x.是否成交 === "否").length, "总计": progress.records.length }, "正式交接候选": { "即将开始": count["即将开始"], "成交": count["成交标的"], "流拍": count["流拍标的"], "总计": output.length } },
  "城市状态统计": byCity, "排除清单": excluded, "重复清单": duplicates, "缺失清单": input.缺失统计,
  "排序规则": "上新：上新归属日期降序→固定区县顺序→一拍→二拍→变卖；结果：真实结束日期升序→成交/流拍分组→固定区县顺序→一拍→二拍→变卖。",
  "目标路径": { "HTML": path.join(root, "产物", "html"), "Excel": path.join(root, "产物", "excel", dateKey) },
  "是否同步飞书": false, "是否允许覆盖": false,
  "回滚依据": "原始采集进度.json、AI复核变更.json与20260903新增房源信息.xlsx；本文件不改写原始采集事实。",
  "交接前质量验收": { "候选记录数": output.length, "排除独立车位/车库数": excluded.length, "链接复合键重复数": duplicates.length, "未解决字段或异常数": unresolved.length, "是否允许产物生成": unresolved.length === 0 && duplicates.length === 0, "说明": unresolved.length === 0 && duplicates.length === 0 ? "通过。" : "未通过，需完成缺失或重复处置。" },
};
await fs.mkdir(outputDir, { recursive: true });
await writeJson(inputPath, input);
await writeJson(manifestPath, manifest);
console.log(JSON.stringify({ outputDir, total: output.length, excluded: excluded.length, duplicates: duplicates.length, unresolved: unresolved.length, counts: count }, null, 2));
