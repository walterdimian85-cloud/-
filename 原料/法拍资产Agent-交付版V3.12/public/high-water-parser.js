const PLATFORM_IDS = new Map([
  ["阿里资产（PC端）", "alibaba_pc"], ["阿里资产PC端", "alibaba_pc"], ["阿里PC", "alibaba_pc"],
  ["京东拍卖（PC端）", "jd_pc"], ["京东拍卖PC端", "jd_pc"], ["京东PC", "jd_pc"],
  ["阿里资产", "alibaba"], ["阿里", "alibaba"], ["淘宝司法拍卖", "alibaba"],
  ["京东拍卖", "jd"], ["京东", "jd"],
]);

const STATUS_NAMES = new Map([
  ["即将开始", "即将开始"], ["预告中", "即将开始"], ["已结束", "已结束"],
]);

export function parseBulkHighWater(text = "", options = {}) {
  const includeBankruptcy = Object.hasOwn(options, "includeBankruptcy")
    ? options.includeBankruptcy !== false
    : globalThis.document?.getElementById?.("includeAlibabaPcBankruptcy")?.checked !== false;
  const anchors = {};
  const rows = [];
  const errors = [];
  const duplicates = [];
  const lines = String(text).split(/\r?\n/u);
  lines.forEach((original, index) => {
    const line = original.trim().replace(/^[\-•*\d.、)）\s]+/u, "");
    if (!line) return;
    const match = line.match(/^([^:=：]+)\s*[:：]\s*([^:=：]+)\s*[:：]\s*([^:=：]+)\s*[:：]\s*([^=＝]+)\s*[=＝]\s*(https?:\/\/\S+)\s*$/iu);
    if (!match) {
      errors.push({ line: index + 1, text: original, reason: "格式无法识别" });
      return;
    }
    const [, platformText, cityText, categoryText, statusText, rawUrl] = match.map((value) => value.trim());
    const platform = PLATFORM_IDS.get(platformText);
    const category = categoryText.replace(/\s+/gu, "");
    const categories = category.split(/[、,+]/u).filter(Boolean);
    const status = STATUS_NAMES.get(statusText.replace(/\s+/gu, ""));
    const city = cityText.replace(/\s+/gu, "");
    const url = rawUrl.replace(/[，。；;、”’"')）\]]+$/u, "");
    if (!platform) return errors.push({ line: index + 1, text: original, reason: `未知平台：${platformText}` });
    if (!categories.length || categories.some((item) => !["住宅用房", "商业用房", "工业用房"].includes(item))) return errors.push({ line: index + 1, text: original, reason: `未知类别：${categoryText}` });
    if (!["alibaba_pc", "jd_pc"].includes(platform) && categories.length !== 1) return errors.push({ line: index + 1, text: original, reason: "仅PC端平台支持合并类别高水位" });
    if (!status) return errors.push({ line: index + 1, text: original, reason: `未知状态：${statusText}` });
    const keyCategory = platform === "alibaba_pc"
      ? `${[...new Set(categories)].sort().join("+")}@${includeBankruptcy ? "with_bankruptcy" : "without_bankruptcy"}`
      : platform === "jd_pc"
        ? [...new Set(categories)].sort().join("+")
        : category;
    const key = `${platform}:${keyCategory}:${status}:${city}`;
    if (anchors[key]) duplicates.push({ line: index + 1, key });
    anchors[key] = url;
    rows.push({ key, platform, city, category: categories.join("、"), status, url, line: index + 1 });
  });
  return { anchors, rows, errors, duplicates };
}
