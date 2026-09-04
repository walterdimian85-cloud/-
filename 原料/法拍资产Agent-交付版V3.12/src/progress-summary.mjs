const PLATFORM_LABELS = { jd: "京东拍卖", jd_pc: "京东拍卖（PC端）", alibaba: "阿里资产", alibaba_pc: "阿里资产（PC端）" };

export function summarizeProgress(progress = {}, { batchBaseline = 0, expectedGroupCount = null, expectedGroupKeys = null } = {}) {
  const completed = new Set(progress.completedUrls || []);
  const groups = Object.entries(progress.groups || {}).map(([key, group]) => {
    const parts = key.split(":");
    const platform = parts[0] || "";
    const rawCategory = parts[1] || "";
    const category = ["alibaba_pc", "jd_pc"].includes(platform)
      ? rawCategory.replace(/@(?:with|without)_bankruptcy$/u, "").replaceAll("+", "、")
      : rawCategory;
    const status = parts[2] || "";
    const city = parts.slice(3).join(":") || "全省";
    const items = Array.isArray(group.items) ? group.items : [];
    const processed = items.filter((item) => completed.has(item.url)).length;
    const classification = group.classification || {};
    let state = "等待扫描";
    if (classification.status === "in_progress") {
      state = `正在核验标的类型 ${Number(classification.completed || 0)}/${Number(classification.total || 0)}`;
    } else if (group.anchorFound === false) state = "高水位未命中";
    else if (group.anchorFound === true && processed >= items.length) state = "已完成";
    else if (group.anchorFound === true && processed > 0) state = "采集中";
    else if (group.anchorFound === true) state = "高水位已命中";
    return {
      key, platform, platformLabel: PLATFORM_LABELS[platform] || platform,
      category, status, city, state,
      planned: items.length, processed, remaining: Math.max(0, items.length - processed),
      anchorFound: Boolean(group.anchorFound), priorAnchor: group.priorAnchor || "",
      classification: classification.status ? {
        status: classification.status,
        completed: Number(classification.completed || 0),
        total: Number(classification.total || 0),
      } : null,
    };
  });
  const planned = groups.reduce((sum, row) => sum + row.planned, 0);
  const processed = groups.reduce((sum, row) => sum + row.processed, 0);
  const remaining = groups.reduce((sum, row) => sum + row.remaining, 0);
  // A persisted group has been scanned even if its previous anchor was not
  // found. Counting only successful anchor matches kept scanComplete false
  // forever and could strand an otherwise-finished custom run.
  const scannedGroups = groups.length;
  const matchedGroups = groups.filter((row) => row.anchorFound).length;
  const missingHighWaterGroups = groups.filter((row) => !row.anchorFound).map((row) => row.key);
  const groupTotal = Number.isFinite(Number(expectedGroupCount)) && Number(expectedGroupCount) > 0
    ? Number(expectedGroupCount) : groups.length;
  const presentGroupKeys = new Set(groups.map((row) => row.key));
  const unscannedGroups = Array.isArray(expectedGroupKeys)
    ? expectedGroupKeys.filter((key) => !presentGroupKeys.has(key)) : [];
  // 有列表分组时，processed才是本次高水位范围内的真实处理量；
  // completedUrls可能包含同日早先批次和历史刷新链接。
  const batchCount = groups.length
    ? processed
    : Math.max(0, Number(progress.newSavedCount || 0));
  return {
    groups, planned, processed, remaining, batchCount,
    estimateSeconds: { minimum: remaining * 5, maximum: remaining * 7 },
    scannedGroups, matchedGroups,
    missingHighWaterCount: missingHighWaterGroups.length,
    missingHighWaterGroups,
    unscannedGroupCount: unscannedGroups.length,
    unscannedGroups,
    groupTotal,
    scanComplete: groupTotal > 0 && groups.length >= groupTotal,
  };
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0分钟";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
}

export function auditGroupCompletion(summary = {}) {
  const expected = Number(summary.groupTotal || 0);
  const scanned = Number(summary.scannedGroups || 0);
  const matched = Number(summary.matchedGroups || 0);
  const missingHighWaterCount = Number(summary.missingHighWaterCount || 0);
  return {
    complete: expected > 0 && scanned === expected && matched === expected
      && missingHighWaterCount === 0 && summary.scanComplete === true,
    expected,
    scanned,
    matched,
    missingHighWaterCount,
    missingKeys: [...new Set([...(summary.unscannedGroups || []), ...(summary.missingHighWaterGroups || [])])],
  };
}
