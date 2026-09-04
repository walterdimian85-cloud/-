function moneyValue(raw) {
  const source = String(raw || "").replace(/[￥¥,，\s]/gu, "");
  const match = source.match(/([\d.]+)\s*(亿|万|元)?/u);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return value * (match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1);
}

export const ASSESSMENT_PRICE_LABELS = ["评估价", "评估总价", "市场评估价", "评估价值"];
export const MARKET_PRICE_LABELS = ["市场价"];
export const START_PRICE_LABELS = ["起拍价"];
export const DISPOSAL_PRICE_LABELS = ["变卖价"];

function flexibleLabelPattern(label) {
  return [...String(label)]
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s*");
}

export function extractLabeledPrice(text, label) {
  const source = String(text || "").replace(/\u00a0/gu, " ");
  const escaped = flexibleLabelPattern(label);
  const pattern = new RegExp(
    `${escaped}\\s*[：:]?\\s*(?:人民币)?\\s*[￥¥]?\\s*([\\d,.，]+)\\s*(亿|万|元)?`,
    "giu",
  );
  for (const match of source.matchAll(pattern)) {
    const suffix = source.slice((match.index || 0) + match[0].length).trimStart();
    if (/^[%％折]/u.test(suffix)) continue;
    const value = moneyValue(`${match[1]}${match[2] || ""}`);
    if (Number.isFinite(value)) {
      return { value, label, rawText: match[0].replace(/\s+/gu, " ").trim() };
    }
  }
  return null;
}

export function extractPriceByPriority(text, labels) {
  for (const label of labels || []) {
    const extracted = extractLabeledPrice(text, label);
    if (extracted) return extracted;
  }
  return null;
}

export function extractAssessmentPrice(text) {
  // Business rule: an explicit assessment price always wins over market price,
  // regardless of which label appears first in the page text.
  return extractPriceByPriority(text, [
    ...ASSESSMENT_PRICE_LABELS,
    ...MARKET_PRICE_LABELS,
  ]);
}

export function extractStartPrice(text, stage = "") {
  const auctionPrice = extractPriceByPriority(text, START_PRICE_LABELS);
  if (auctionPrice) return auctionPrice;
  return stage === "变卖" ? extractPriceByPriority(text, DISPOSAL_PRICE_LABELS) : null;
}
