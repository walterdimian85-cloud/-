export function normalizePropertyTitleText(value) {
  return String(value || "")
    .replace(/(?<!不)可贷款/gu, "")
    .replace(/([\u3400-\u9fff])\s+(?=[A-Za-z0-9])/gu, "$1")
    .replace(/([A-Za-z0-9])\s+(?=[\u3400-\u9fff])/gu, "$1")
    .replace(/\s{2,}/gu, " ")
    .trim();
}
