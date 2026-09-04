export const AUCTION_STATUSES = ["即将开始", "已结束"];
export function normalizeSelectedStatuses(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  const selected = new Set(values.map((item) => String(item || "").trim()));
  const normalized = AUCTION_STATUSES.filter((status) => selected.has(status));
  if (!normalized.length) throw new Error("至少选择一个拍卖状态。");
  return normalized;
}
export function statusScopeFor(selectedStatuses) {
  const selected = normalizeSelectedStatuses(selectedStatuses);
  return selected.length === 2 ? "all" : selected[0] === AUCTION_STATUSES[0] ? "upcoming_only" : "ended_only";
}
export function statusLabelFor(selectedStatuses) {
  const selected = normalizeSelectedStatuses(selectedStatuses);
  return statusScopeFor(selected) === "all" ? "即将开始 + 已结束" : selected[0];
}
export function statusScopeFields(collection = {}) {
  const selectedStatuses = normalizeSelectedStatuses(collection.selectedStatuses || collection.status || AUCTION_STATUSES);
  return { selectedStatuses, statusScope: statusScopeFor(selectedStatuses) };
}
export function workbookName(dateKey, selectedStatuses, { checkpoint = false } = {}) {
  const scope = statusScopeFor(selectedStatuses);
  const suffix = scope === "upcoming_only" ? "即将开始" : scope === "ended_only" ? "已结束" : "";
  return `${dateKey}新增房源信息${suffix ? `_${suffix}` : ""}${checkpoint ? "_采集中" : ""}.xlsx`;
}
export function expectedGroupCount({ platforms = [], categories = [], cities = [], selectedStatuses = AUCTION_STATUSES } = {}) {
  return platforms.length * categories.length * (cities.length || 1) * normalizeSelectedStatuses(selectedStatuses).length;
}
