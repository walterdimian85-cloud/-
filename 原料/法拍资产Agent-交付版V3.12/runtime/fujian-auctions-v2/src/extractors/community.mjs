import { cleanPropertyTitle } from "./title.mjs";
import { fieldEvidence } from "./field-evidence.mjs";
import communityDictionary from "../../assets/community-dictionary.json" with { type: "json" };
import addressMappings from "../../assets/community-address-mappings.json" with { type: "json" };

function normalizedLookupText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s·•・,，。；;：:（）()【】\[\]《》“”‘’'"\-—_]/gu, "")
    .toLowerCase();
}

function normalizedLocation(value) {
  return String(value || "")
    .replace(/(?:省|市|区|县|自治县)$/u, "")
    .trim();
}

function locationMatches(entry, record) {
  const city = normalizedLocation(record?.城市);
  const district = normalizedLocation(record?.区域);
  if (!city && !district) return true;
  return entry.locations.some((location) => {
    const [entryCity, entryDistrict] = location.split("·").map(normalizedLocation);
    return (!city || entryCity === city) && (!district || entryDistrict === district);
  });
}

function escapedRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function looksLikeRoadOrAdministrativeName(entry, title, record = {}) {
  const name = String(entry?.name || "");
  const source = String(title || "");
  if (!name || !source.includes(name)) return false;
  if (/^(?:东侧|西侧|南侧|北侧|东北侧|东南侧|西北侧|西南侧)/u.test(name)) return true;
  if (/(?:有限责任公司|股份有限公司|有限公司|公司)$/u.test(name)) return true;
  if (/(?:(?<!新)村|社区|街道|镇|乡)$/u.test(name) && !/(?:小区|花园|家园|公馆|苑|城|府|湾|郡|园|广场|大厦|中心|商城|商业街)$/u.test(name)) {
    return true;
  }
  if (
    record?.标的类型 !== "工业" &&
    /(?:片区|安置房|地块|[一二三四五六七八九十0-9]+区)$/u.test(name) &&
    !/(?:小区|花园|家园|公馆|苑|城|府|湾|郡|园|广场|大厦|中心|商城|商业街)$/u.test(name)
  ) return true;
  if (
    /(?:路|街|巷)$/u.test(name) &&
    !/(?:商业街|金街)$/u.test(name) &&
    new RegExp(`${escapedRegex(name)}\\s*[0-9０-９]`, "u").test(source)
  ) {
    return true;
  }
  if (new RegExp(`${escapedRegex(name)}\\s*(?:村|社区|街道|镇|乡)`, "u").test(source)) return true;
  return false;
}

function isPlanningOnlyName(value, industrialContext = false) {
  const name = String(value || "");
  return !industrialContext &&
    /(?:片区|安置房|地块|[一二三四五六七八九十0-9]+区)/u.test(name) &&
    !/(?:小区|花园|家园|公馆|苑|城|府|湾|郡|园|广场|大厦|中心|商城|商业街)/u.test(name);
}

function isProjectDivisionSuffix(value) {
  const suffix = String(value || "").trim();
  return (
    /^[（(].+[）)]$/u.test(suffix) ||
    /^(?:(?:一|二|三|四|五|六|七|八|九|十|\d+)期|[A-Za-z0-9一二三四五六七八九十]+区|[东西南北中]区|[东西南北中]院|[A-Za-z0-9-]+地块|项目)$/u.test(suffix)
  );
}

function canonicalMainProject(entry, candidates) {
  const withoutDivision = entry.name.replace(
    /(?:(?:一|二|三|四|五|六|七|八|九|十|\d+)期|[A-Za-z0-9一二三四五六七八九十]+区|[东西南北中]区|[东西南北中]院)/gu,
    "",
  );
  const normalizedWithoutDivision = normalizedLookupText(withoutDivision);
  const internalBase = candidates
    .filter((candidate) => normalizedLookupText(candidate.name) === normalizedWithoutDivision)
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (internalBase) return internalBase;
  const bases = candidates
    .filter((candidate) => candidate.name !== entry.name && entry.name.startsWith(candidate.name))
    .map((candidate) => ({ candidate, suffix: entry.name.slice(candidate.name.length) }))
    .filter(({ suffix }) => isProjectDivisionSuffix(suffix))
    .sort((left, right) => right.candidate.name.length - left.candidate.name.length);
  return bases[0]?.candidate || entry;
}

function textOutsideParentheses(value) {
  let depth = 0;
  let output = "";
  for (const character of String(value || "")) {
    if (character === "（" || character === "(") {
      depth += 1;
      continue;
    }
    if (character === "）" || character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) output += character;
  }
  return output;
}

function findDictionaryEntry(text, candidates, record = {}) {
  const source = String(text || "");
  const normalizedSource = normalizedLookupText(source);
  const exactMatches = candidates
    .map((entry) => ({ entry, index: source.indexOf(entry.name) }))
    .filter(({ entry, index }) => index >= 0 && !looksLikeRoadOrAdministrativeName(entry, source, record))
    .sort((left, right) => left.index - right.index || right.entry.name.length - left.entry.name.length);
  if (exactMatches.length) return canonicalMainProject(exactMatches[0].entry, candidates);
  for (const entry of candidates) {
    if (looksLikeRoadOrAdministrativeName(entry, source, record)) continue;
    if (normalizedSource.includes(normalizedLookupText(entry.name))) {
      return canonicalMainProject(entry, candidates);
    }
  }
  return null;
}

function extractExplicitCommunity(documents, record) {
  const labels = /^(?:小区名称|所属小区|所在小区|楼盘名称)$/u;
  for (const document of documents || []) {
    for (const row of document.rows || []) {
      const cells = row.map((cell) => String(cell || "").trim()).filter(Boolean);
      for (let index = 0; index < cells.length - 1; index += 1) {
        if (!labels.test(cells[index])) continue;
        const value = cells[index + 1].replace(/^(?:小区名称|所属小区|所在小区|楼盘名称)\s*[：:]?/u, "").trim();
        if (value && !/^(?:无|未知|未找到|不详)$/u.test(value)) return value;
      }
    }
    const match = String(document.text || "").match(
      /(?:^|\n)(?:小区名称|所属小区|所在小区|楼盘名称)\s*[：:]?\s*([^\n]{2,60})/u,
    );
    if (match && !/^(?:无|未知|未找到|不详)$/u.test(match[1].trim())) return match[1].trim();
  }
  return "";
}

function matchAddressMapping(title, record) {
  const city = normalizedLocation(record?.城市);
  return addressMappings.entries.find((entry) =>
    (!entry.city || !city || normalizedLocation(entry.city) === city) && String(title || "").includes(entry.pattern),
  ) || null;
}

export function matchCommunityDictionary(title, record = {}) {
  const normalizedTitle = normalizedLookupText(title);
  if (!normalizedTitle) return null;
  const locationCandidates = communityDictionary.entries.filter((entry) =>
    locationMatches(entry, record),
  );
  const candidates = locationCandidates.length > 0 ? locationCandidates : communityDictionary.entries;
  const primaryText = textOutsideParentheses(title);
  const embeddedShortQualifier = /[\p{L}\p{N}]（[^）]{1,6}）[\p{L}\p{N}]/u.test(String(title || ""));
  return embeddedShortQualifier
    ? findDictionaryEntry(title, candidates, record) || findDictionaryEntry(primaryText, candidates, record)
    : findDictionaryEntry(primaryText, candidates, record) || findDictionaryEntry(title, candidates, record);
}

function extractFormalIndustrialProject(title) {
  const matches = [
    ...String(title || "").matchAll(
      /([\u4e00-\u9fa5A-Za-z0-9·\-]{2,50}?(?:工业集中区|工业园区|产业园区|科技园区|园区)(?:[\u4e00-\u9fa5A-Za-z0-9·\-]{0,20}片区)?|[\u4e00-\u9fa5A-Za-z0-9·\-]{2,50}?厂区)/gu,
    ),
  ].map((match) => cleanCommunityCandidate(match[1])
    .replace(/^.*?(?:经济技术开发区|高新技术开发区|经济开发区)/u, ""))
    .filter(Boolean);
  return matches.sort((left, right) => right.length - left.length)[0] || "";
}

function cleanCommunityCandidate(value) {
  let candidate = String(value || "").trim();
  const removablePrefix =
    /^[\u4e00-\u9fa5A-Za-z0-9·\-]{1,18}(?:街道|镇|乡|村|社区|大道|路|街|巷|弄|号)/u;
  while (removablePrefix.test(candidate)) {
    candidate = candidate.replace(removablePrefix, "").trim();
  }
  return candidate
    .replace(/^[的于在坐落]+/u, "")
    .trim();
}

function canonicalizeFallbackCandidate(value, record) {
  const stripped = String(value || "").replace(
    /(?:(?:一|二|三|四|五|六|七|八|九|十|\d+)期|[A-Za-z0-9一二三四五六七八九十]+区|(?<!集)[东西南北中]区|[东西南北中]院)/gu,
    "",
  );
  if (stripped === value) return value;
  const matching = communityDictionary.entries.find(
    (entry) => locationMatches(entry, record) && normalizedLookupText(entry.name) === normalizedLookupText(stripped),
  );
  return matching?.name || value;
}

function extractProjectSuffixMatches(sourceTitle, record) {
  return [
    ...String(sourceTitle || "").matchAll(
      /([\u4e00-\u9fa5A-Za-z0-9·\-]{2,36}?(?:小区|花园|家园|华庭|公馆|公寓|山庄|映象|苑|城|府|庭|里|湾|郡|园|广场|大厦|中心|商城|商场|商业街|商贸区|街区|产业园|工业园|科技园|物流园|园区|厂区|厂房项目))/gu,
    ),
  ]
    .map((match) => canonicalizeFallbackCandidate(cleanCommunityCandidate(match[1]), record))
    .filter((value) => value.length >= 2 && !looksLikeRoadOrAdministrativeName({ name: value }, sourceTitle, record));
}

export function extractCommunityNameWithEvidence(record) {
  const title = cleanPropertyTitle(record?.标的名称);
  const industrialContext = record?.标的类型 === "工业" || /(?:工业房地产|工业厂房|工业用房|工业不动产)/u.test(title);
  const explicit = extractExplicitCommunity(record?._documents, record);
  if (explicit) {
    const normalizedExplicit = matchCommunityDictionary(explicit, record)?.name || explicit;
    return {
      value: normalizedExplicit,
      evidence: fieldEvidence({
        value: normalizedExplicit,
        platform: record?.平台 || "",
        section: "标的物详情/竞买公告",
        element: "小区名称明确字段",
        rawText: explicit,
        ruleId: "community-explicit-detail-v2",
        confidence: "high",
        reviewRequired: false,
      }),
    };
  }
  if (industrialContext) {
    const industrialProject = extractFormalIndustrialProject(title);
    if (industrialProject) {
      return {
        value: industrialProject,
        evidence: fieldEvidence({
          value: industrialProject,
          platform: record?.平台 || "",
          section: "标的名称后处理",
          element: "明确工业园区/集中区/厂区",
          rawText: title,
          ruleId: "community-formal-industrial-project-v2",
          confidence: "high",
          reviewRequired: false,
        }),
      };
    }
  }
  const dictionaryMatch = matchCommunityDictionary(title, record);
  if (dictionaryMatch && !isPlanningOnlyName(dictionaryMatch.name, industrialContext)) {
    return {
      value: dictionaryMatch.name,
      evidence: fieldEvidence({
        value: dictionaryMatch.name,
        platform: record?.平台 || "",
        section: "标的名称后处理",
        element: "福州泉州小区词典主标题匹配",
        rawText: title,
        ruleId: "community-curated-dictionary-v2",
        confidence: "high",
        reviewRequired: false,
      }),
    };
  }
  const rawTitle = String(record?.原始标的名称 || record?._rawTitle || "");
  const addressMapping = matchAddressMapping(`${rawTitle}\n${title}`, record);
  if (addressMapping) {
    return {
      value: addressMapping.community,
      evidence: fieldEvidence({
        value: addressMapping.community,
        platform: record?.平台 || "",
        section: "人工确认地址映射",
        element: addressMapping.pattern,
        rawText: `${rawTitle}\n${title}`.trim(),
        ruleId: "community-curated-address-map-v2",
        confidence: "high",
        reviewRequired: false,
      }),
    };
  }
  const primaryProject = extractProjectSuffixMatches(textOutsideParentheses(title), record)
    .find((candidate) => !isPlanningOnlyName(candidate, industrialContext));
  if (primaryProject) {
    return {
      value: primaryProject,
      evidence: fieldEvidence({
        value: primaryProject,
        platform: record?.平台 || "",
        section: "标的名称后处理",
        element: "标题正文项目名称候选",
        rawText: title,
        ruleId: "community-primary-title-suffix-v2",
        confidence: "medium",
        reviewRequired: false,
      }),
    };
  }
  const rawTitleMatch = rawTitle ? matchCommunityDictionary(rawTitle, record) : null;
  if (rawTitleMatch && !isPlanningOnlyName(rawTitleMatch.name, industrialContext)) {
    return {
      value: rawTitleMatch.name,
      evidence: fieldEvidence({
        value: rawTitleMatch.name,
        platform: record?.平台 || "",
        section: "原始标的名称",
        element: "含已删除括号的小区词典匹配",
        rawText: rawTitle,
        ruleId: "community-raw-title-dictionary-v2",
        confidence: "high",
        reviewRequired: false,
      }),
    };
  }
  const matches = extractProjectSuffixMatches(title, record);
  const usableMatch = matches.find((candidate) => !isPlanningOnlyName(candidate, industrialContext));
  const value = usableMatch || (industrialContext ? "工业区" : "商住小区");
  const matched = matches.length > 0;
  return {
    value,
    evidence: fieldEvidence({
      value,
      platform: record?.平台 || "",
      section: "标的名称后处理",
      element: matched ? "项目名称候选" : "规定回退值",
      rawText: title,
      ruleId: matched ? "community-title-suffix-v1" : "community-fallback-v1",
      confidence: matched ? "medium" : "low",
      reviewRequired: false,
    }),
  };
}

export function extractCommunityName(record) {
  return extractCommunityNameWithEvidence(record).value;
}
