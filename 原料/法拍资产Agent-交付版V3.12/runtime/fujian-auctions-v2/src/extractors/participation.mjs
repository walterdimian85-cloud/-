import { fieldEvidence } from "./field-evidence.mjs";

function normalizedText(documents) {
  return (documents || [])
    .map((document) => String(document?.text || ""))
    .filter(Boolean)
    .join("\n")
    .replace(/[\u00a0\u2007\u202f]/gu, " ");
}

function integerFromMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(String(match[1] || "").replace(/[,，\s]/gu, ""));
    if (Number.isSafeInteger(value) && value >= 0) {
      return { value, rawText: match[0] };
    }
  }
  return { value: null, rawText: "" };
}

export function extractParticipation({ documents = [], statusGroup = "", outcome = "待核验", platform = "" } = {}) {
  if (statusGroup !== "已结束") {
    return {
      bidCount: null,
      registrationCount: null,
      applicable: false,
      reviewRequired: false,
      evidence: {},
    };
  }

  const text = normalizedText(documents);
  const registration = integerFromMatch(text, [
    /(?:报名人数|报名人次)\s*[：:]?\s*([\d,，]+)\s*(?:人)?/u,
    /([\d,，]+)\s*人\s*报名/u,
    /(?:^|\s)([\d,，]+)\s*报名(?:\s|$)/u,
  ]);
  let bids = integerFromMatch(text, [
    /(?:竞买记录|应买记录|竞价记录|出价记录)\s*[（(]\s*([\d,，]+)\s*[）)]/u,
    /(?:竞买记录|应买记录|竞价记录|出价记录)\s*[：:]?\s*([\d,，]+)\s*(?:次|条)?/u,
  ]);

  // “已流拍”表示没有有效出价，竞买记录必定为0；报名人数仍必须读取页面，不能据此推断为0。
  if (outcome === "否") bids = { value: 0, rawText: bids.rawText || "已流拍" };
  const reviewRequired =
    registration.value === null ||
    bids.value === null ||
    (outcome === "是" && (registration.value <= 0 || bids.value <= 0));

  return {
    bidCount: bids.value,
    registrationCount: registration.value,
    applicable: true,
    reviewRequired,
    evidence: {
      竞买记录: fieldEvidence({
        value: bids.value,
        dataType: "integer",
        unit: "次",
        platform,
        section: outcome === "否" && !bids.rawText ? "成交状态" : "详情页竞买记录标签",
        element: "竞买记录（N）",
        rawText: bids.rawText,
        ruleId: outcome === "否" ? "participation-unsold-zero-bids-v2" : "participation-bid-tab-v2",
        confidence: bids.value === null ? "low" : "high",
        reviewRequired: bids.value === null || (outcome === "是" && bids.value <= 0),
      }),
      报名人数: fieldEvidence({
        value: registration.value,
        dataType: "integer",
        unit: "人",
        platform,
        section: "详情页价格区下方统计栏",
        element: "N人报名",
        rawText: registration.rawText,
        ruleId: "participation-registration-counter-v2",
        confidence: registration.value === null ? "low" : "high",
        reviewRequired: registration.value === null || (outcome === "是" && registration.value <= 0),
      }),
    },
  };
}
