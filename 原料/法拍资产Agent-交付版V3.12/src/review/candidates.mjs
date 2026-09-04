const genericCommunities = new Set(["", "未找到", "商住小区", "工业区"]);

function residentialOrCommercial(record = {}) {
  return ["住宅", "商业", "住宅用房", "商业用房"].includes(record.标的类型)
    || /住宅|商业/u.test(record._源分类 || "");
}

export function recordRiskWarnings(record = {}) {
  const warnings = [];
  const area = Number(record["面积/㎡"]);
  const startPrice = Number(record.起拍价格);
  if (residentialOrCommercial(record) && Number.isFinite(area) && area > 10_000) {
    warnings.push(`数据疑似有误：${record.标的类型 || "住宅/商业"}面积为${area}㎡，超过10000㎡`);
  }
  if (Number.isFinite(area) && area > 0 && Number.isFinite(startPrice) && startPrice > 0) {
    const unitPrice = startPrice / area;
    if (unitPrice > 100_000 || unitPrice < 500) {
      warnings.push(`数据疑似有误：起拍单价约${Math.round(unitPrice)}元/㎡，超出500—100000元/㎡常规核验区间`);
    }
  }
  return warnings;
}

export function appendRiskWarnings(record = {}) {
  const warnings = recordRiskWarnings(record);
  if (!warnings.length) return record;
  const existing = String(record.备注 || "").trim();
  const additions = warnings.filter((warning) => !existing.includes(warning));
  return additions.length ? { ...record, 备注: [existing, ...additions].filter(Boolean).join("；") } : record;
}

function confidence(record, field) {
  return record?._fieldEvidence?.[field]?.confidence || "";
}

export function reviewReasons(record) {
  const reasons = [];
  if (!Number.isFinite(record?.["面积/㎡"])) reasons.push("面积未找到");
  if (!Number.isFinite(record?.评估价)) reasons.push("评估价缺失（先核对已有价格证据）");
  if (record?._fieldEvidence?.["面积/㎡"]?.reviewRequired) reasons.push("面积存在冲突");
  for (const warning of recordRiskWarnings(record)) reasons.push(warning);
  if (!record?.标的名称 || confidence(record, "标的名称") === "low") reasons.push("标的名称低置信度");
  const community = record?.["小区名称（仅供参考）"] || "";
  if (genericCommunities.has(community) || ["商业小区"].includes(community)
    || confidence(record, "小区名称（仅供参考）") === "low") {
    const titleSuggestsProject = /(?:花园|家园|佳园|公馆|华府|名城|新城|小区|大厦|广场|中心|苑|园|城|湾|府|院|里|郡|墅)/u.test(record?.标的名称 || "");
    reasons.push(titleSuggestsProject && genericCommunities.has(community)
      ? `标题疑似包含小区名但当前识别为“${community}”（先核对标题和小区名单）`
      : "小区名称需复核（先核对标题证据和小区名单）");
  }
  if (Array.isArray(record?._missing)) {
    const reviewableMissing = new Set(["面积/㎡", "标的名称", "小区名称（仅供参考）"]);
    for (const field of record._missing) if (reviewableMissing.has(field) && !reasons.some((r) => r.includes(field))) reasons.push(`${field}缺失`);
  }
  return [...new Set(reasons)];
}

export function selectReviewCandidates(records, maxItems = 200) {
  return records.map((record) => ({ record, reasons: reviewReasons(record) }))
    .filter((item) => item.reasons.length)
    .sort((a, b) => Number(b.reasons.includes("面积未找到")) - Number(a.reasons.includes("面积未找到")))
    .slice(0, maxItems);
}

export function parseModelJson(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI未返回JSON对象");
  return JSON.parse(source.slice(first, last + 1));
}

export function applyReview(record, review, { minimumConfidence = 0.9, autoApply = true } = {}) {
  const next = { ...record };
  const changes = [];
  const suggestions = [];
  const fields = review?.fields || {};
  const mappings = { area: "面积/㎡", title: "标的名称", community: "小区名称（仅供参考）" };
  for (const [key, field] of Object.entries(mappings)) {
    const item = fields[key];
    if (!item || item.value === null || item.value === undefined || item.value === "") continue;
    const confidence = Number(item.confidence || 0);
    let valid = confidence >= minimumConfidence && String(item.evidence || "").trim().length >= 2;
    if (key === "area") {
      const numeric = Number(item.value);
      valid &&= Number.isFinite(numeric) && numeric > 0;
      const normalizedEvidence = String(item.evidence || "").replace(/,/gu, "");
      const numberVariants = [String(numeric), numeric.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "")];
      valid &&= numberVariants.some((value) => normalizedEvidence.includes(value));
      item.value = numeric;
    } else valid &&= String(item.value).trim().length >= 2;
    const proposal = { field, before: record[field] ?? null, after: item.value, confidence, evidence: item.evidence, reason: item.reason || "" };
    if (autoApply && valid && proposal.before !== proposal.after) {
      next[field] = item.value; changes.push(proposal);
    } else if (proposal.before !== proposal.after) suggestions.push(proposal);
  }
  const otherFieldWhitelist = new Set([
    "所在省份", "城市", "区域", "标的类型", "平台", "发拍次数", "拍卖时间",
    "是否成交", "处置法院", "起拍价格", "评估价", "成交金额", "报名人数", "竞买记录", "备注",
  ]);
  for (const item of review?.otherCorrections || []) {
    if (!otherFieldWhitelist.has(item?.field)) continue;
    const confidence = Number(item.confidence || 0);
    const evidence = String(item.evidence || "").trim();
    let value = item.value;
    let valid = confidence >= minimumConfidence && evidence.length >= 2;
    if (["起拍价格", "评估价", "成交金额", "报名人数", "竞买记录"].includes(item.field)) {
      value = Number(value);
      valid &&= Number.isFinite(value) && value >= 0
        && evidence.replace(/,/gu, "").includes(String(value));
    } else {
      value = String(value ?? "").trim();
      valid &&= value.length > 0;
    }
    if (item.field === "是否成交") valid &&= ["是", "否", "即将开始"].includes(value);
    const proposal = {
      field: item.field, before: record[item.field] ?? null, after: value,
      confidence, evidence, reason: item.reason || "AI发现其他字段异常",
    };
    if (autoApply && valid && proposal.before !== proposal.after) {
      next[item.field] = value; changes.push(proposal);
    } else if (proposal.before !== proposal.after) suggestions.push(proposal);
  }
  return { record: appendRiskWarnings(next), changes, suggestions };
}
