export function fieldEvidence({
  value = null,
  dataType = "string",
  unit = null,
  platform = "",
  section = "",
  element = "",
  rawText = "",
  ruleId = "",
  confidence = "medium",
  conflicts = [],
  reviewRequired = false,
} = {}) {
  return {
    value,
    dataType,
    unit,
    source: { platform, section, element, rawText },
    ruleId,
    confidence,
    conflicts: Array.isArray(conflicts) ? conflicts : [],
    reviewRequired: Boolean(reviewRequired),
  };
}

export function mergeFieldEvidence(record, fieldName, evidence) {
  return {
    ...(record?._fieldEvidence || {}),
    [fieldName]: evidence,
  };
}
