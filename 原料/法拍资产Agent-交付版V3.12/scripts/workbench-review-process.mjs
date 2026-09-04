import fs from "node:fs";
import path from "node:path";

const taskPath = "C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260813/工作台复核任务.json";
const resultsPath = "C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260813/工作台复核结果.json";

const task = JSON.parse(fs.readFileSync(taskPath, "utf8"));
const existing = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const doneUrls = new Set(existing.items.map((i) => i.url));

const newItems = [];

for (const candidate of task.candidates) {
  const url = candidate.url;
  if (doneUrls.has(url)) continue;
  const r = candidate.record;
  const item = { url, review: { fields: {}, otherCorrections: [], otherIssues: [], requiresHumanReview: false, summary: "" } };
  const F = item.review.fields;
  const OC = item.review.otherCorrections;
  let s = [];

  switch (url) {
    // === 面积未找到候选 ===
    case "https://paimai.jd.com/311096156": // 华大新村
      // 面积在附件询价报告中，页面未显示
      item.review.requiresHumanReview = true;
      s.push("面积未在页面显示，需下载附件《询价报告》人工查看");
      // 拍卖时间补充
      OC.push({ field: "拍卖时间", value: "2026-09-01T02:00:00.000Z", confidence: 0.95, evidence: "09月01日 10:00:00开始", reason: "页面明确拍卖开始时间" });
      s.push("已补充拍卖时间");
      // 小区确认正确
      s.push("小区名称'华大新村'确认正确");
      break;

    case "https://paimai.jd.com/311059117": // 福州特艺城 4062+4105
      F.area = { value: 50.61, confidence: 0.95, evidence: "建筑面积：24.94、25.67平方米", reason: "两间店面合并拍卖，面积分别为24.94和25.67㎡，合计50.61㎡" };
      item.review.requiresHumanReview = true;
      s.push("面积由两间店面面积合计(24.94+25.67=50.61)，页面未直接给出合计值，需人工确认");
      s.push("小区名称'福州特艺城'确认正确");
      break;

    case "https://paimai.jd.com/311059084": // 福州特艺城 4034+4035
      F.area = { value: 71.76, confidence: 0.95, evidence: "建筑面积：4034店面35.98平方米、4035店面35.78平方米", reason: "两间店面合并拍卖，面积分别为35.98和35.78㎡，合计71.76㎡" };
      item.review.requiresHumanReview = true;
      s.push("面积由两间店面面积合计(35.98+35.78=71.76)，页面未直接给出合计值，需人工确认");
      s.push("小区名称'福州特艺城'确认正确");
      break;

    case "https://paimai.jd.com/311058991": // 福州特艺城 4063+4064+4106+4107
      F.area = { value: 108.96, confidence: 0.95, evidence: "建筑面积：4063店面27.18平方米、4064店面27.8平方米、4106店面26.73平方米、4107店面27.25平方米", reason: "四间店面合并拍卖，面积合计108.96㎡" };
      item.review.requiresHumanReview = true;
      s.push("面积由四间店面面积合计(27.18+27.8+26.73+27.25=108.96)，页面未直接给出合计值，需人工确认");
      s.push("小区名称'福州特艺城'确认正确");
      break;

    case "https://paimai.jd.com/311058973": // 福州特艺城 4061+4101+4102+4103+4104+4129
      F.area = { value: 159.11, confidence: 0.95, evidence: "建筑面积：4061店面25.85平方米、4101店面27.08平方米、4102店面26.43平方米、4103店面26.33平方米、4104店面26.01平方米、4129店面27.41平方米", reason: "六间店面合并拍卖，面积合计159.11㎡" };
      item.review.requiresHumanReview = true;
      s.push("面积由六间店面面积合计(25.85+27.08+26.43+26.33+26.01+27.41=159.11)，页面未直接给出合计值，需人工确认");
      s.push("小区名称'福州特艺城'确认正确");
      break;

    case "https://sf-item.taobao.com/sf_item/1075885560287.htm": // 南安恒大新城
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动提取面积和评估价");
      s.push("阿里资产页面需要登录，无法自动复核面积和评估价，需人工登录后处理");
      break;

    // === 小区名称需复核 - 京东 ===
    case "https://paimai.jd.com/311104896": // 潭中佳苑
      s.push("小区名称'潭中佳苑'确认正确（标题含'潭中佳苑三组团'）");
      break;

    case "https://paimai.jd.com/311104894": // 融信8A
      F.community = { value: "融信8A", confidence: 0.95, evidence: "融信8A（B区）", reason: "标题明确项目名'融信8A'，原值'商住小区'为回退值" };
      s.push("小区名称更正：商住小区→融信8A");
      break;

    case "https://paimai.jd.com/311104463": // 省农林大学宿舍
      F.community = { value: "省农林大学宿舍", confidence: 0.95, evidence: "省农林大学宿舍", reason: "标题明确项目名'省农林大学宿舍'，原值'商住小区'为回退值" };
      s.push("小区名称更正：商住小区→省农林大学宿舍");
      break;

    case "https://paimai.jd.com/311098953": // 正祥林语墅
      F.community = { value: "正祥林语墅", confidence: 0.95, evidence: "正祥林语墅", reason: "标题明确项目名'正祥林语墅'，原值'商住小区'为回退值" };
      s.push("小区名称更正：商住小区→正祥林语墅");
      break;

    case "https://paimai.jd.com/311098352": // 文华小区
      s.push("小区名称'文华小区'确认正确（标题含'文华小区'）");
      break;

    case "https://paimai.jd.com/311098337": // 洋里佳园
      F.community = { value: "洋里佳园", confidence: 0.95, evidence: "洋里佳园", reason: "标题明确项目名'洋里佳园'，原值'洋里'不完整" };
      s.push("小区名称更正：洋里→洋里佳园");
      break;

    case "https://paimai.jd.com/311098333": // 雍锦湾
      F.community = { value: "雍锦湾", confidence: 0.95, evidence: "雍锦湾", reason: "标题明确项目名'雍锦湾'，原值'商住小区'为回退值" };
      s.push("小区名称更正：商住小区→雍锦湾");
      break;

    case "https://paimai.jd.com/311098317": // 正荣府
      F.community = { value: "正荣府", confidence: 0.95, evidence: "正荣府", reason: "标题明确项目名'正荣府'，原值'交叉口西南侧正荣府'含道路描述前缀" };
      s.push("小区名称更正：交叉口西南侧正荣府→正荣府");
      break;

    case "https://paimai.jd.com/311094534": // 世欧澜山园
      s.push("小区名称'世欧澜山园'确认正确（标题含'世欧澜山园一期'）");
      break;

    case "https://paimai.jd.com/311092347": // 阳光美墅
      F.community = { value: "阳光美墅", confidence: 0.95, evidence: "阳光美墅", reason: "标题明确项目名'阳光美墅'，原值'商住小区'为回退值" };
      s.push("小区名称更正：商住小区→阳光美墅");
      break;

    case "https://paimai.jd.com/311091174": // 融信8A (73#楼)
      F.community = { value: "融信8A", confidence: 0.95, evidence: "融信8A（B区）", reason: "标题明确项目名'融信8A'，原值'源洪湾'为道路名非小区名" };
      s.push("小区名称更正：源洪湾→融信8A");
      break;

    case "https://paimai.jd.com/311090816": // 阳光城翡丽湾
      F.community = { value: "阳光城翡丽湾", confidence: 0.95, evidence: "（现：阳光城翡丽湾小区）", reason: "标题注明现用名'阳光城翡丽湾'，原值'南屿滨江城'为旧名" };
      s.push("小区名称更正：南屿滨江城→阳光城翡丽湾（现用名）");
      break;

    case "https://paimai.jd.com/311090693": // 福晟朝阳壹品
      F.community = { value: "福晟朝阳壹品", confidence: 0.95, evidence: "福晟朝阳壹品", reason: "标题明确项目名'福晟朝阳壹品'，原值'商住小区'为回退值" };
      OC.push({ field: "拍卖时间", value: "2026-08-28T02:00:00.000Z", confidence: 0.95, evidence: "08月28日 10:00:00开始", reason: "页面明确变卖开始时间" });
      s.push("小区名称更正：商住小区→福晟朝阳壹品");
      s.push("已补充拍卖时间");
      break;

    case "https://paimai.jd.com/311090642": // 苍霞新城嘉盛园
      F.community = { value: "苍霞新城嘉盛园", confidence: 0.95, evidence: "苍霞新城嘉盛园", reason: "标题含完整项目名'苍霞新城嘉盛园'，原值'苍霞新城'不完整" };
      s.push("小区名称更正：苍霞新城→苍霞新城嘉盛园");
      break;

    case "https://paimai.jd.com/310933273": // 冠城丽都
      F.community = { value: "冠城丽都", confidence: 0.95, evidence: "（冠城丽都）", reason: "标题括号内注明项目名'冠城丽都'，原值'商住小区'为回退值" };
      OC.push({ field: "是否成交", value: "是", confidence: 0.95, evidence: "已成交", reason: "页面显示已成交" });
      OC.push({ field: "成交金额", value: 771003, confidence: 0.95, evidence: "成交价：¥771,003", reason: "页面显示成交价771003元" });
      s.push("小区名称更正：商住小区→冠城丽都");
      s.push("是否成交更正：即将开始→是（页面显示已成交）");
      s.push("成交金额更正：0→771003");
      break;

    case "https://paimai.jd.com/310940161": // 潭中佳苑(一组团)
      s.push("小区名称'潭中佳苑'确认正确（标题含'潭中佳苑一组团'）");
      break;

    case "https://paimai.jd.com/311091298": // 平潭太谷城 A#1222
      F.community = { value: "平潭太谷城", confidence: 0.95, evidence: "平潭太谷城", reason: "标题明确项目名'平潭太谷城'，原值'交叉口东南侧平潭太谷城'含道路描述前缀" };
      s.push("小区名称更正：交叉口东南侧平潭太谷城→平潭太谷城");
      break;

    case "https://paimai.jd.com/311091297": // 平潭太谷城 A#1221
      F.community = { value: "平潭太谷城", confidence: 0.95, evidence: "平潭太谷城", reason: "标题明确项目名'平潭太谷城'，原值'交叉口东南侧平潭太谷城'含道路描述前缀" };
      s.push("小区名称更正：交叉口东南侧平潭太谷城→平潭太谷城");
      break;

    case "https://paimai.jd.com/311060599": // 福州金融街万达广场
      OC.push({ field: "拍卖时间", value: "2026-08-21T02:00:00.000Z", confidence: 0.95, evidence: "08月21日 10:00:00开始", reason: "页面明确变卖开始时间" });
      s.push("已补充拍卖时间");
      s.push("小区名称'福州金融街万达广场'确认正确");
      break;

    case "https://paimai.jd.com/310931043": // 安泰中心
      s.push("小区名称'安泰中心'确认正确（标题含'安泰中心'）");
      break;

    // === 阿里资产候选（需登录）===
    case "https://sf-item.taobao.com/sf_item/1073029819702.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1073867674160.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价和小区名称");
      s.push("阿里资产页面需要登录，无法自动复核，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1073007391664.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1073851086766.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1074804841276.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1067469807568.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核竞买记录");
      s.push("阿里资产页面需要登录，无法自动复核竞买记录，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1065389213259.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价和小区名称");
      s.push("阿里资产页面需要登录，无法自动复核，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1065646853692.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1072889482868.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1072046595432.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    case "https://sf-item.taobao.com/sf_item/1068558475055.htm":
      item.review.requiresHumanReview = true;
      item.review.otherIssues.push("阿里资产页面需要登录，无法自动复核评估价");
      s.push("阿里资产页面需要登录，无法自动复核评估价，需人工登录后处理");
      break;

    default:
      item.review.requiresHumanReview = true;
      s.push("未匹配处理逻辑，需人工复核");
  }

  item.review.summary = s.join("；");
  newItems.push(item);

  // 逐条追加保存
  existing.items.push(item);
  fs.writeFileSync(resultsPath, JSON.stringify(existing, null, 2), "utf8");
  console.log(`[${existing.items.length}/${task.candidates.length}] 已保存: ${url}`);
}

console.log(`\n完成！共处理 ${newItems.length} 条，结果文件共 ${existing.items.length} 条`);
