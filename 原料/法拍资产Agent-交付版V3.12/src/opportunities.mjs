function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/,/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

/**
 * 只输出“初步关注线索”，不宣称是投资建议或估值结论。
 * 即将开始：同城同类型样本足够时，提示起拍单价处于当日较低分位的标的。
 * 成交标的：提示报名或竞价活跃的标的，供负责人观察市场热度。
 */
export function identifyOpportunitySignals(records, config = {}) {
  if (config.enabled === false) return [];
  const groups = new Map();
  for (const record of records) {
    if (record._状态分组 !== "即将开始") continue;
    const unitPrice = numeric(record["起拍单价-元/㎡"])
      ?? (() => {
        const price = numeric(record.起拍价格);
        const area = numeric(record["面积/㎡"]);
        return price !== null && area > 0 ? price / area : null;
      })();
    if (unitPrice === null) continue;
    const key = `${record.城市 || ""}|${record.标的类型 || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record, unitPrice });
  }
  const signals = [];
  for (const values of groups.values()) {
    if (values.length < (config.minimumComparableCount || 3)) continue;
    const threshold = percentile(values.map((item) => item.unitPrice), config.lowUnitPricePercentile ?? 0.25);
    for (const item of values) {
      if (item.unitPrice <= threshold) signals.push({
        url: item.record.网站链接,
        name: item.record.标的名称,
        kind: "同组低起拍单价",
        reason: `当日同城同类型${values.length}条可比记录中，起拍单价位于较低分位（约${Math.round(item.unitPrice)}元/㎡）`,
      });
    }
  }
  for (const record of records) {
    if (record._状态分组 !== "成交标的" && record.是否成交 !== "是") continue;
    const registrations = numeric(record.报名人数) || 0;
    const bids = numeric(record.竞买记录) || 0;
    if (registrations >= (config.minimumRegistrations || 3) || bids >= (config.minimumBidRecords || 10)) {
      signals.push({
        url: record.网站链接,
        name: record.标的名称,
        kind: "竞买活跃",
        reason: `报名${registrations}人、竞买记录${bids}次`,
      });
    }
  }
  return signals;
}
