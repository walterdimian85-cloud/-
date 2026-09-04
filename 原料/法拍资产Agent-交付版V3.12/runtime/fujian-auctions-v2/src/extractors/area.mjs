function numericArea(value) {
  const number = Number(String(value || "").replaceAll(",", ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

const UNIT = String.raw`(?:平方米|平米|平方公尺|㎡|m²|m2|M²|M2)`;
const SEP = String.raw`\s*\/?\s*`;
const EXCLUDED_CONTEXT = /宗地|土地|占地|分摊土地|共有宗地|套内|公摊/u;
const OUT_OF_SCOPE_CONTEXT =
  /未列入.{0,12}(?:评估|拍卖)范围|不(?:属于|在|纳入).{0,12}拍卖范围|相关推荐|相似拍品/u;
const CONTENT_END_MARKER = /相关推荐|相似拍品|大家都在问/u;

const TEXT_RULES = [
  ["产权总面积", String.raw`产权总面积\s*(?:为|约|共|共计|合计|总计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`],
  ["建筑总面积", String.raw`(?:建筑总面积|总建筑面积|建筑面积合计|房屋建筑面积合计|建筑面积总共)\s*(?:为|约|共|共计|合计|总计|总共)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`],
  ["总面积简写", String.raw`(?:^|[：:；;，,。\n（(])\s*总\s*([\d,.]+)${SEP}${UNIT}\s*(?=[（(])`],
  ["房屋建筑面积", String.raw`(?:证载建筑面积|房屋建筑面积|建筑面积|房屋面积|房产面积)\s*(?:为|约|共|共计|合计|总计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`],
  ["面积", String.raw`(?<!宗地)(?<!土地)(?<!占地)(?<!分摊)(?:总?面积)\s*(?:为|约|共|共计|合计|总计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`],
  ["倒装面积", String.raw`([\d,.]+)${SEP}${UNIT}\s*(?:产权总面积|建筑总面积|总建筑面积|房屋建筑面积|建筑面积)`],
];

function findCombinedRoomArea(text) {
  const source = contentScope(text);
  if (!/建筑面积\s*[:：]/u.test(source)) return null;
  const segment = source.slice(source.search(/建筑面积\s*[:：]/u));
  const boundary = segment.search(/(?:土地|宗地|占地|分摊土地)\s*(?:使用权)?面积/u);
  const scoped = boundary > 0 ? segment.slice(0, boundary) : segment.slice(0, 500);
  if (/储藏间|附属(?:物|房|间)|车位|停车位|车库|柴火房/u.test(scoped)) return null;
  const pattern = new RegExp(String.raw`(?:^|[\s：:，,；;、])([A-Za-z]?\d{2,5}(?:[-－]\d+)?(?:号|室)?)\s+([\d,.]+)${SEP}${UNIT}`, "giu");
  const matches = [...scoped.matchAll(pattern)]
    .map((match) => ({ identity: match[1], area: numericArea(match[2]), raw: match[0].trim(), index: match.index }))
    .filter((item) => item.area !== null);
  const unique = [];
  const seen = new Set();
  for (const item of matches) {
    const key = `${item.identity}:${item.area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  if (unique.length < 2) return null;
  const rawExpression = unique.map((item) => `${item.identity} ${item.area}${/平米/u.test(item.raw) ? "平米" : "㎡"}`).join("   ");
  return {
    area: roundedAreaSum(unique.map((item) => item.area)),
    keyword: "合并拍卖多室建筑面积",
    rawExpression,
    rawText: snippet(scoped, unique[0].index, unique.at(-1).index + unique.at(-1).raw.length, 25),
    ruleId: "area-combined-rooms-sum-v2",
    confidence: "high",
    reviewRequired: false,
    outputNote: rawExpression,
    components: unique.map((item) => item.area),
    componentIdentities: unique.map((item) => item.identity),
  };
}

function normalizedIdentity(value) {
  return String(value || "")
    .replace(/\s+/gu, "")
    .replace(/(?:店面|店铺|商铺|房屋|房产|室|房)$/u, "")
    .replace(/[号#]$/u, "")
    .toUpperCase();
}

function findTitleMatchedComponentArea(text, title = "") {
  const source = contentScope(text);
  const normalizedTitle = String(title || "").replace(/\s+/gu, "").toUpperCase();
  if (!normalizedTitle || !/(?:建筑面积|房屋面积)\s*[：:]/u.test(source)) return null;
  const markerIndex = source.search(/(?:建筑面积|房屋面积)\s*[：:]/u);
  const segment = source.slice(markerIndex, markerIndex + 1_200);
  if (/储藏间|附属(?:物|房|间)|车位|停车位|车库|柴火房/u.test(segment)) return null;
  const pattern = new RegExp(
    String.raw`([A-Za-z]?\d{2,6}(?:[-－]\d+)?(?:号)?(?:店面|店铺|商铺|室|房))\s*([\d,.]+)${SEP}${UNIT}`,
    "giu",
  );
  const matches = [...segment.matchAll(pattern)]
    .map((match) => ({
      identity: match[1].replace(/\s+/gu, ""),
      normalizedIdentity: normalizedIdentity(match[1]),
      area: numericArea(match[2]),
      raw: match[0].replace(/\s+/gu, " ").trim(),
      index: match.index || 0,
    }))
    .filter((item) => item.area !== null && item.normalizedIdentity
      && normalizedTitle.includes(item.normalizedIdentity));
  const unique = [];
  const seen = new Set();
  for (const item of matches) {
    const key = `${item.normalizedIdentity}:${item.area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  if (unique.length < 2) return null;
  const area = roundedAreaSum(unique.map((item) => item.area));
  const rawExpression = unique.map((item) => item.raw).join("；");
  return {
    area,
    keyword: "标题对应多标的建筑面积合计",
    rawExpression,
    rawText: snippet(segment, unique[0].index, unique.at(-1).index + unique.at(-1).raw.length, 35),
    ruleId: "area-title-matched-components-sum-v2",
    confidence: "high",
    reviewRequired: false,
    outputNote: `${rawExpression}；合计${area}㎡。`,
    components: unique.map((item) => item.area),
    componentIdentities: unique.map((item) => item.identity),
  };
}

function snippet(source, start, end, radius = 45) {
  return source.slice(Math.max(0, start - radius), Math.min(source.length, end + radius)).replace(/\s+/gu, " ").trim();
}

function roundedAreaSum(values) {
  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(4));
}

function clauseAround(source, start, end, radius = 90) {
  const leftBoundary = Math.max(
    source.lastIndexOf("。", start - 1),
    source.lastIndexOf("；", start - 1),
    source.lastIndexOf("\n", start - 1),
    start - radius,
  );
  const rightCandidates = ["。", "；", "\n"]
    .map((token) => source.indexOf(token, end))
    .filter((index) => index >= 0);
  const rightBoundary = rightCandidates.length
    ? Math.min(...rightCandidates, end + radius)
    : Math.min(source.length, end + radius);
  return source.slice(Math.max(0, leftBoundary + 1), rightBoundary);
}

function inExcludedScope(source, start, end) {
  const prefix = source.slice(Math.max(0, start - 60), start);
  const immediate = (prefix.split(/[，；。\n]/u).at(-1) || "").slice(-24);
  return OUT_OF_SCOPE_CONTEXT.test(clauseAround(source, start, end)) || /红线外/u.test(immediate);
}

function contentScope(text) {
  const source = String(text || "").replace(/\u00a0/gu, " ");
  const marker = CONTENT_END_MARKER.exec(source);
  return marker ? source.slice(0, marker.index) : source;
}

function componentIdentity(prefix) {
  const source = String(prefix || "").replace(/\s+/gu, " ");
  const matches = [
    ...source.matchAll(
      /(?:[A-Za-z0-9-]*\d[A-Za-z0-9-]*(?:[#号幢栋楼室层单元]|店面|店铺|商铺|车位))|房屋|住宅|储藏间|附属间|柴火房|车库|厂房|建筑物/giu,
    ),
  ];
  const structured = matches.at(-1)?.[0]?.replace(/\s+/gu, "") || "";
  if (structured) return structured;
  const local = (source.split(/[，；。\n]/u).at(-1) || "").slice(-36);
  const bareIdentifiers = [...local.matchAll(/(?<!\d)([A-Za-z]?\d{1,5})(?!\d)/gu)];
  return bareIdentifiers.at(-1)?.[1] || "";
}

function componentClass(identity) {
  if (/储藏间|附属间|柴火房/u.test(identity)) return "ancillary";
  if (/车位|车库/u.test(identity)) return "parking";
  return "primary";
}

function componentDisplayName(item) {
  if (item.componentClass === "primary") return "主住宅";
  if (/储藏间/u.test(item.identity)) return "储藏间";
  if (/附属间|柴火房/u.test(item.identity)) return "附属间";
  if (/车位/u.test(item.identity)) return "车位";
  if (/车库/u.test(item.identity)) return "车库";
  return item.identity || "附属物";
}

function findMainAreaWithAncillary(text) {
  const source = contentScope(text);
  const primaryPattern = new RegExp(
    String.raw`(?:主住宅|住宅|主房|其中房|房屋)\s*(?:建筑面积|面积)?\s*(?:为|共|共计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`,
    "giu",
  );
  const secondaryPattern = new RegExp(
    String.raw`(储藏间|附属间|柴火房|车位|车库)\s*(?:建筑面积|面积)?\s*(?:为|共|共计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`,
    "giu",
  );
  const primary = [...source.matchAll(primaryPattern)]
    .map((match) => ({ area: numericArea(match[1]), match }))
    .filter((item) => item.area !== null && !inExcludedScope(source, item.match.index, item.match.index + item.match[0].length));
  const secondary = [...source.matchAll(secondaryPattern)]
    .map((match) => ({ area: numericArea(match[2]), identity: match[1], match }))
    .filter((item) => item.area !== null && !inExcludedScope(source, item.match.index, item.match.index + item.match[0].length));
  if (!primary.length || !secondary.length) return null;
  const primaryAreas = [...new Set(primary.map((item) => item.area))];
  const mainArea = roundedAreaSum(primaryAreas);
  const componentDetails = [
    { area: mainArea, identity: "住宅", componentClass: "primary", label: "主住宅" },
    ...secondary.map((item) => ({
      area: item.area,
      identity: item.identity,
      componentClass: /车位|车库/u.test(item.identity) ? "parking" : "ancillary",
      label: componentDisplayName({ identity: item.identity, componentClass: /车位|车库/u.test(item.identity) ? "parking" : "ancillary" }),
    })),
  ];
  const possibleCombinedArea = roundedAreaSum(componentDetails.map((item) => item.area));
  const start = Math.min(primary[0].match.index, secondary[0].match.index);
  const end = Math.max(
    primary.at(-1).match.index + primary.at(-1).match[0].length,
    secondary.at(-1).match.index + secondary.at(-1).match[0].length,
  );
  return {
    area: mainArea,
    keyword: "主房及附属物分项面积",
    rawExpression: snippet(source, start, end, 20),
    rawText: snippet(source, start, end, 45),
    ruleId: "area-main-with-ancillary-v2",
    confidence: "high",
    reviewRequired: false,
    conflicts: [{
      type: "main-area-with-ancillary-components",
      selectedArea: mainArea,
      possibleCombinedArea,
      components: componentDetails.map((item) => item.area),
      componentDetails,
    }],
  };
}

function findUnresolvedCompoundArea(text) {
  const source = contentScope(text);
  const pattern = new RegExp(
    String.raw`([\d,.]+)\s*\/\s*([\d,.]+)\s*(?:共|合计|共计)\s*([\d,.]+)${SEP}${UNIT}`,
    "giu",
  );
  for (const match of source.matchAll(pattern)) {
    if (inExcludedScope(source, match.index, match.index + match[0].length)) continue;
    const values = [match[1], match[2], match[3]].map(numericArea);
    if (values.some((value) => value === null)) continue;
    const rawExpression = match[0].replace(/\s+/gu, " ").trim();
    return {
      area: null,
      source: "网页多值面积表达",
      keyword: "斜杠分项及合计面积",
      rawExpression,
      rawText: snippet(source, match.index, match.index + match[0].length),
      ruleId: "area-compound-values-unresolved-v2",
      confidence: "low",
      reviewRequired: true,
      manualReviewNote: `${rawExpression}，人工需复核`,
      conflicts: [{
        type: "compound-area-values-unresolved",
        values,
        rawExpression,
      }],
    };
  }
  return null;
}

export function findSummedComponentArea(text, { allowMixedTypes = false } = {}) {
  let source = contentScope(text);
  if (/(?:产权总面积|建筑总面积|总建筑面积|建筑面积合计|房屋建筑面积合计)\s*(?:为|约|共|共计|合计|总计)?\s*[:：]?\s*[\d,.]+/u.test(source)) {
    return null;
  }
  const reminderIndex = source.search(/特别提醒|另有.{0,8}(?:建筑物|搭盖)|未列入.{0,12}(?:评估|拍卖)范围/u);
  if (reminderIndex >= 0) source = source.slice(0, reminderIndex);
  const pattern = new RegExp(
    String.raw`(?:建筑面积|房屋面积|住宅面积|储藏间面积|附属间面积|柴火房面积|车库面积|店面面积|店铺面积|商铺面积)\s*(?:为|共|共计|合计)?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}`,
    "giu",
  );
  const matches = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index || 0;
    const prefix = source.slice(Math.max(0, start - 90), start);
    const localPrefix = (prefix.split(/[，；。\n]/u).at(-1) || "").slice(-40);
    const context = `${localPrefix}${match[0]}`;
    if (/(?:专有|套内|分摊|共有|公摊|宗地|土地|占地|红线内|红线外|实测)\s*(?:房屋)?建筑?面积/u.test(context)) continue;
    if (inExcludedScope(source, start, start + match[0].length)) continue;
    const area = numericArea(match[1]);
    const identity = componentIdentity(prefix);
    if (area !== null && identity) {
      matches.push({
        area,
        identity,
        componentClass: componentClass(identity),
        index: start,
        text: context.replace(/\s+/gu, " ").trim(),
      });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const match of matches) {
    const key = `${match.identity}:${match.area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  let selectedMatches = unique;
  if (!allowMixedTypes) {
    const grouped = new Map();
    for (const item of unique) {
      const group = grouped.get(item.componentClass) || [];
      group.push(item);
      grouped.set(item.componentClass, group);
    }
    selectedMatches = grouped.get("primary")
      || grouped.get("ancillary")
      || grouped.get("parking")
      || [];
  }
  if (selectedMatches.length < 2) return null;
  return {
    area: roundedAreaSum(selectedMatches.map((item) => item.area)),
    keyword: "多标的建筑面积合计",
    rawExpression: selectedMatches.map((item) => item.text).join(" + "),
    rawText: snippet(source, selectedMatches[0].index, selectedMatches.at(-1).index + selectedMatches.at(-1).text.length, 30),
    ruleId: "area-text-component-sum-v2",
    components: selectedMatches.map((item) => item.area),
    componentIdentities: selectedMatches.map((item) => item.identity),
    componentDetails: selectedMatches.map((item) => ({
      area: item.area,
      identity: item.identity,
      componentClass: item.componentClass,
      label: componentDisplayName(item),
    })),
  };
}

export function areaNoteFromResult(result, { hasAssessmentAttachment = false } = {}) {
  if (result?.outputNote) return result.outputNote;
  if (result?.manualReviewNote) return result.manualReviewNote;
  if (result?.area == null) {
    return hasAssessmentAttachment
      ? "需打开网页评估报告提取面积"
      : "未找到评估报告";
  }
  const conflict = (result?.conflicts || []).find(
    (item) => ["main-area-with-ancillary-components", "mixed-component-total-ambiguous"].includes(item.type),
  );
  if (!conflict) return "";
  const details = conflict.componentDetails || [];
  if (!details.length) return `主住宅：${conflict.selectedArea}㎡；附属物面积需复核。`;
  const grouped = new Map();
  for (const detail of details) {
    const label = detail.componentClass === "primary" ? "主住宅" : detail.label || detail.identity || "附属物";
    grouped.set(label, Number(((grouped.get(label) || 0) + detail.area).toFixed(4)));
  }
  const parts = [...grouped.entries()].map(([label, area]) => `${label}：${area}㎡`);
  return parts.length ? `${parts.join("；")}。` : "";
}

export function findAreaInText(text, { title = "" } = {}) {
  const source = contentScope(text);
  const mainWithAncillary = findMainAreaWithAncillary(source);
  if (mainWithAncillary) return mainWithAncillary;
  const unresolvedCompound = findUnresolvedCompoundArea(source);
  if (unresolvedCompound) return unresolvedCompound;
  const explicitTotalRules = TEXT_RULES.slice(0, 3);
  for (const [keyword, patternSource] of explicitTotalRules) {
    const pattern = new RegExp(patternSource, "giu");
    for (const match of source.matchAll(pattern)) {
      const area = numericArea(match?.[1]);
      if (area === null || inExcludedScope(source, match.index, match.index + match[0].length)) continue;
      return {
        area,
        keyword,
        rawExpression: match[0].replace(/\s+/gu, " ").trim(),
        rawText: snippet(source, match.index, match.index + match[0].length),
        ruleId: "area-text-explicit-total-v2",
      };
    }
  }
  const combinedRoomArea = findCombinedRoomArea(source);
  if (combinedRoomArea) return combinedRoomArea;
  const titleMatchedComponentArea = findTitleMatchedComponentArea(source, title);
  if (titleMatchedComponentArea) return titleMatchedComponentArea;
  const componentSum = findSummedComponentArea(source);
  const mixedComponentSum = findSummedComponentArea(source, { allowMixedTypes: true });
  if (componentSum) {
    if (mixedComponentSum && mixedComponentSum.area !== componentSum.area) {
      return {
        ...componentSum,
        confidence: "medium",
        reviewRequired: false,
        conflicts: [{
          type: "main-area-with-ancillary-components",
          selectedArea: componentSum.area,
          possibleCombinedArea: mixedComponentSum.area,
          components: mixedComponentSum.components,
          componentDetails: mixedComponentSum.componentDetails,
        }],
      };
    }
    return componentSum;
  }
  for (const [keyword, patternSource] of TEXT_RULES.slice(3)) {
    const pattern = new RegExp(patternSource, "giu");
    for (const match of source.matchAll(pattern)) {
      const area = numericArea(match?.[1]);
      if (area === null) continue;
      const rawText = snippet(source, match.index, match.index + match[0].length);
      if (inExcludedScope(source, match.index, match.index + match[0].length)) continue;
      const prefix = source.slice(Math.max(0, match.index - 50), match.index);
      const localPrefix = (prefix.split(/[，；。\n]/u).at(-1) || "").slice(-40);
      // “宗地面积…/房屋建筑面积…”是两个并列字段。土地字段位于斜杠前时，
      // 不应污染斜杠后的房屋建筑面积；但“套内建筑面积”等直接限定词仍需排除。
      const directQualifier = (localPrefix.split(/[／/]/u).at(-1) || "").slice(-16);
      if (EXCLUDED_CONTEXT.test(directQualifier)) continue;
      const result = {
        area,
        keyword,
        rawExpression: match[0].replace(/\s+/gu, " ").trim(),
        rawText,
        ruleId: `area-text-${keyword === "倒装面积" ? "reversed" : "labeled"}-v2`,
      };
      if (mixedComponentSum && mixedComponentSum.area !== area) {
        return {
          ...result,
          confidence: "medium",
          reviewRequired: false,
          conflicts: [{
            type: "main-area-with-ancillary-components",
            selectedArea: area,
            possibleCombinedArea: mixedComponentSum.area,
            components: mixedComponentSum.components,
            componentDetails: mixedComponentSum.componentDetails,
          }],
        };
      }
      return result;
    }
  }
  return null;
}

export function extractAreaFromText(text) {
  return findAreaInText(text)?.area ?? null;
}

export function findAreaInTableRows(rows, { title = "" } = {}) {
  const keywords = ["产权总面积", "建筑总面积", "总建筑面积", "房屋建筑面积", "证载建筑面积", "建筑面积"];
  const excluded = /宗地|土地|占地|分摊|套内|公摊/u;
  const normalizedRows = (rows || []).map((cells) =>
    (cells || []).map((cell) => String(cell || "").replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim()),
  );
  const valuePattern = new RegExp(String.raw`^\s*(?:共|约)?\s*([\d,.]+)${SEP}${UNIT}?\s*$`, "iu");

  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    const rowText = normalizedRows[rowIndex].join(" | ");
    // Investigation tables often describe a dwelling and a parking space in
    // one cell, for example: （1702单元）139.37平方米/（154车位）34.94平方米.
    // The dwelling is the main property area; preserve the complete expression
    // in notes instead of adding the parking-space area to it.
    const mainAndParking = rowText.match(
      /[（(]([^（）()]{0,30}(?:单元|住宅|房屋|房产))[）)]\s*([\d,.]+)\s*(?:㎡|平方米|平方|平米|m2|m²)\s*[\/／]\s*[（(]([^（）()]{0,30}(?:车位|车库))[）)]\s*([\d,.]+)\s*(?:㎡|平方米|平方|平米|m2|m²)/iu,
    );
    if (mainAndParking) {
      const mainArea = numericArea(mainAndParking[2]);
      const parkingArea = numericArea(mainAndParking[4]);
      if (mainArea !== null && parkingArea !== null) {
        const expression = mainAndParking[0].replace(/\s+/gu, " ").trim();
        return {
          area: mainArea,
          keyword: "住宅/商业与车位并列表达",
          rawExpression: expression,
          rawText: rowText,
          outputNote: expression,
          tablePosition: { rowIndex },
          ruleId: "area-table-main-unit-with-parking-v2",
          confidence: "high",
          reviewRequired: false,
          conflicts: [{
            type: "main-area-with-ancillary-components", selectedArea: mainArea,
            possibleCombinedArea: roundedAreaSum([mainArea, parkingArea]),
            componentDetails: [
              { area: mainArea, identity: mainAndParking[1], componentClass: "primary", label: "主住宅/商业" },
              { area: parkingArea, identity: mainAndParking[3], componentClass: "parking", label: "车位" },
            ],
          }],
        };
      }
    }
    const candidate = findMainAreaWithAncillary(rowText);
    if (candidate) {
      return {
        ...candidate,
        tablePosition: { rowIndex },
      };
    }
    const unresolvedCompound = findUnresolvedCompoundArea(rowText);
    if (unresolvedCompound) {
      return {
        ...unresolvedCompound,
        tablePosition: { rowIndex },
      };
    }
    const titleMatched = findTitleMatchedComponentArea(rowText, title);
    if (titleMatched) return { ...titleMatched, tablePosition: { rowIndex } };
  }

  for (const keyword of keywords) {
    for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
      const cells = normalizedRows[rowIndex];
      for (let columnIndex = 0; columnIndex < cells.length; columnIndex += 1) {
        const header = cells[columnIndex];
        if (!header.includes(keyword) || excluded.test(header)) continue;
        // Some investigation tables place the total first, followed by a
        // parenthetical component breakdown. The leading total is the target.
        const leadingTotal = header.match(
          new RegExp(String.raw`(?:${keyword})?\s*[:：]?\s*([\d,.]+)${SEP}${UNIT}\s*[（(]\s*(?:其中|含)`, "iu"),
        );
        const leadingTotalArea = numericArea(leadingTotal?.[1]);
        if (leadingTotalArea !== null) {
          return {
            area: leadingTotalArea,
            keyword,
            rawExpression: leadingTotal[0].replace(/\s+/gu, " ").trim(),
            rawText: header,
            tablePosition: { rowIndex, columnIndex },
            ruleId: "area-table-leading-total-before-breakdown-v2",
          };
        }
        const sameCell = findAreaInText(header, { title });
        if (sameCell) return { ...sameCell, tablePosition: { rowIndex, columnIndex }, ruleId: "area-table-same-cell-v2" };

        for (let valueColumnIndex = columnIndex + 1; valueColumnIndex < cells.length; valueColumnIndex += 1) {
          const valueCell = cells[valueColumnIndex] || "";
          const leadingValueTotal = valueCell.match(
            new RegExp(String.raw`^\s*([\d,.]+)${SEP}${UNIT}\s*[（(【\[]`, "iu"),
          );
          const leadingValueTotalArea = numericArea(leadingValueTotal?.[1]);
          if (leadingValueTotalArea !== null) {
            return {
              area: leadingValueTotalArea,
              keyword,
              rawExpression: `${header} | ${leadingValueTotal[0].replace(/\s+/gu, " ").trim()}`,
              rawText: `${header} | ${valueCell}`,
              tablePosition: { rowIndex, columnIndex, valueRowIndex: rowIndex, valueColumnIndex },
              ruleId: "area-table-leading-total-in-value-cell-v2",
            };
          }
          if (/总面积/u.test(header)) {
            const componentSum = findSummedComponentArea(valueCell, { allowMixedTypes: true });
            if (componentSum) {
              return {
                ...componentSum,
                rawExpression: `${header} | ${componentSum.rawExpression}`,
                rawText: `${header} | ${valueCell}`,
                tablePosition: { rowIndex, columnIndex, valueRowIndex: rowIndex, valueColumnIndex },
                ruleId: "area-table-component-sum-v2",
              };
            }
          }
          const labeledCandidate = findAreaInText(valueCell, { title });
          if (labeledCandidate && !excluded.test(valueCell)) {
            return {
              ...labeledCandidate,
              rawExpression: `${header} | ${labeledCandidate.rawExpression}`,
              rawText: `${header} | ${valueCell}`,
              tablePosition: { rowIndex, columnIndex, valueRowIndex: rowIndex, valueColumnIndex },
              ruleId: "area-table-adjacent-labeled-cell-v2",
            };
          }
          const match = valuePattern.exec(valueCell);
          const area = numericArea(match?.[1]);
          if (area !== null) {
            return {
              area,
              keyword,
              rawExpression: `${header} | ${valueCell}`,
              rawText: `${header} | ${valueCell}`,
              tablePosition: { rowIndex, columnIndex, valueRowIndex: rowIndex, valueColumnIndex },
              ruleId: "area-table-adjacent-cell-v2",
            };
          }
        }
        const verticalValues = [];
        let nonValueRows = 0;
        for (let valueRowIndex = rowIndex + 1; valueRowIndex < Math.min(normalizedRows.length, rowIndex + 80); valueRowIndex += 1) {
          const valueRow = normalizedRows[valueRowIndex] || [];
          const valueCell = valueRow[columnIndex] || "";
          const match = valuePattern.exec(valueCell);
          const area = numericArea(match?.[1]);
          // DOM tables can expose internal numeric node ids in the same
          // column. They are not areas; reject implausible identifier-sized
          // values before summing vertical components.
          if (area !== null && area <= 10_000_000 && !excluded.test(valueRow.join(" "))) {
            verticalValues.push({ area, valueRowIndex, valueCell });
            nonValueRows = 0;
            continue;
          }
          if (verticalValues.length) {
            nonValueRows += 1;
            if (nonValueRows >= 1) break;
          }
        }
        if (verticalValues.length >= 2) {
          return {
            area: roundedAreaSum(verticalValues.map((item) => item.area)),
            keyword,
            rawExpression: `${header} ↓ ${verticalValues.map((item) => item.valueCell).join(" + ")}`,
            rawText: `${header} ↓ ${verticalValues.map((item) => item.valueCell).join(" + ")}`,
            tablePosition: {
              rowIndex,
              columnIndex,
              valueRowIndexes: verticalValues.map((item) => item.valueRowIndex),
              valueColumnIndex: columnIndex,
            },
            ruleId: "area-table-vertical-component-sum-v2",
            components: verticalValues.map((item) => item.area),
          };
        }
        if (verticalValues.length === 1) {
          const [item] = verticalValues;
          return {
            area: item.area,
            keyword,
            rawExpression: `${header} ↓ ${item.valueCell}`,
            rawText: `${header} ↓ ${item.valueCell}`,
            tablePosition: {
              rowIndex,
              columnIndex,
              valueRowIndex: item.valueRowIndex,
              valueColumnIndex: columnIndex,
            },
            ruleId: "area-table-below-cell-v2",
          };
        }
      }
    }
  }
  return null;
}

export function extractAreaFromTableRows(rows) {
  return findAreaInTableRows(rows)?.area ?? null;
}

export function textAfterLastMarker(text, markers, maxLength = 40_000) {
  const source = String(text || "");
  let markerIndex = -1;
  let markerLength = 0;
  for (const marker of markers) {
    const index = source.lastIndexOf(marker);
    if (index > markerIndex) {
      markerIndex = index;
      markerLength = marker.length;
    }
  }
  if (markerIndex < 0) return "";
  return source.slice(markerIndex + markerLength, markerIndex + markerLength + maxLength);
}

function selected(candidate, source, fallbackRuleId) {
  return {
    area: candidate.area,
    source,
    ruleId: candidate.ruleId || fallbackRuleId,
    keyword: candidate.keyword,
    rawExpression: candidate.rawExpression,
    rawText: candidate.rawText,
    tablePosition: candidate.tablePosition,
    confidence: candidate.confidence,
    reviewRequired: candidate.reviewRequired,
    conflicts: candidate.conflicts || [],
    componentDetails: candidate.componentDetails || [],
    manualReviewNote: candidate.manualReviewNote || "",
    outputNote: candidate.outputNote || "",
    components: candidate.components || [],
    componentIdentities: candidate.componentIdentities || [],
  };
}

export function extractAreaByPriority(documents, { title = "" } = {}) {
  const texts = (documents || []).map((document) => String(document.text || ""));
  for (const text of texts) {
    const announcement = textAfterLastMarker(text, ["竞买公告", "拍卖公告", "变卖公告"]);
    const candidate = findAreaInText(announcement, { title });
    if (candidate) return selected(candidate, "竞买公告标的物文字", "area-announcement-text-v2");
  }
  for (const text of texts) {
    for (const [keyword, patternSource] of TEXT_RULES.slice(0, 3)) {
      const pattern = new RegExp(patternSource, "iu");
      const match = pattern.exec(contentScope(text));
      const area = numericArea(match?.[1]);
      if (area !== null && !inExcludedScope(text, match.index, match.index + match[0].length)) {
        return selected({
          area,
          keyword,
          rawExpression: match[0].replace(/\s+/gu, " ").trim(),
          rawText: snippet(text, match.index, match.index + match[0].length),
          ruleId: "area-page-explicit-total-v2",
        }, "页面明确总面积", "area-page-explicit-total-v2");
      }
    }
  }
  for (const document of documents || []) {
    const candidate = findAreaInTableRows(document.rows || [], { title });
    if (candidate) return selected(candidate, "页面表格建筑面积列", "area-table-v2");
  }
  for (const document of documents || []) {
    for (const cells of document.rows || []) {
      const candidate = findAreaInText(cells.join(" "), { title });
      if (candidate) return selected(candidate, "标的物调查表表格", "area-investigation-row-v2");
    }
    const investigation = textAfterLastMarker(document.text, ["标的物调查情况表", "拍卖标的调查情况表", "调查表"]);
    const candidate = findAreaInText(investigation, { title });
    if (candidate) return selected(candidate, "标的物调查表表格", "area-investigation-text-v2");
  }
  for (const text of texts) {
    const introduction = textAfterLastMarker(text, ["标的物介绍", "拍卖标的介绍", "标的介绍"]);
    const candidate = findAreaInText(introduction, { title }) || findAreaInText(text.slice(0, 10_000), { title });
    if (candidate) return selected(candidate, "平台首页简介", "area-introduction-v2");
  }
  return { area: null, source: "未找到", ruleId: "area-not-found-v2", rawExpression: "", rawText: "" };
}
