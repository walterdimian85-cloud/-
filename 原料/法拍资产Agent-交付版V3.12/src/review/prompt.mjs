import fs from "node:fs/promises";

export const REVIEW_SYSTEM_PROMPT = "你只做证据驱动的司法拍卖字段复核，并严格返回JSON。";

export async function buildReviewPrompt({ record, reasons, pageEvidence, rulesPath }) {
  const rules = await fs.readFile(rulesPath, "utf8");
  return `你是福建司法拍卖房产数据复核员。严格依据页面证据复核，不得猜测。\n\n${rules}\n\n特别规则：\n1. 评估价值同时检索“评估价”和“市场价”；两者同时出现时取评估价，只有市场价时将市场价写入评估价字段。\n2. “应买记录”是网页对“竞买记录”的错写，与竞买记录同义；京东“出价记录”也映射为竞买记录。\n3. 标题明确列出多个同类房号、店面、商铺或房室，正文逐一给出相同编号的建筑面积时，应核对编号后一一求和。area.evidence必须保留原始分项并写出“合计=数值㎡”，不要仅返回某一个分项。\n4. 页面出现面积相关原句但仍无法安全确定总面积时，area.value返回null，同时在otherCorrections中建议“备注”写入完整面积原句并追加“人工需复核”，不得只说未找到。\n\n当前记录：\n${JSON.stringify(record, null, 2)}\n\n复核原因：${reasons.join("；")}\n\n页面证据：\n${pageEvidence.slice(0, 100000)}\n\n只返回一个JSON对象：{"fields":{"area":{"value":数字或null,"confidence":0到1,"evidence":"页面原文短句；如为求和须含合计结果","reason":"说明"},"title":{"value":"字符串或null","confidence":0到1,"evidence":"页面原文短句","reason":"说明"},"community":{"value":"字符串或null","confidence":0到1,"evidence":"页面原文短句或人工数据库命中说明","reason":"说明"}},"otherCorrections":[{"field":"仅限所在省份/城市/区域/标的类型/平台/发拍次数/拍卖时间/是否成交/处置法院/起拍价格/评估价/成交金额/报名人数/竞买记录/备注","value":"建议值","confidence":0到1,"evidence":"页面原文短句","reason":"说明"}],"otherIssues":["无法安全自动更正的其他字段问题"],"requiresHumanReview":布尔值,"summary":"简述"}`;
}
