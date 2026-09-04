import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkbook } from "../src/workbook/index.mjs";
import { loadPlaywright } from "./runtime.mjs";
import { loadRunConfig } from "../src/config/load.mjs";
import { classifyJdAccessSnapshot, classifyListSnapshot } from "./list-readiness.mjs";
import {
  ACTIVE_STATUSES,
  ALIBABA_CATEGORY_IDS,
  ALIBABA_LIST_URL,
  ALIBABA_PC_LIST_URL,
  ALIBABA_PC_LOCATION_CODES,
  ALIBABA_PC_PROPERTY_IDS,
  CATEGORIES,
  JD_ACTION_DELAY_MAX_MS,
  JD_ACTION_DELAY_MIN_MS,
  JD_LIST_URL,
  OUTPUT_PROPERTY_TYPES,
  STATUS_FILTERS,
} from "../src/core/constants.mjs";
import { canonicalUrl } from "../src/core/urls.mjs";
import {
  cleanAuctionTitle as cleanAuctionTitleShared,
  cleanPropertyTitle as cleanPropertyTitleShared,
} from "../src/extractors/title.mjs";
import {
  extractAreaByPriority as extractAreaByPriorityShared,
  extractAreaFromText as extractAreaFromTextShared,
  areaNoteFromResult,
  textAfterLastMarker as textAfterLastMarkerShared,
} from "../src/extractors/area.mjs";
import { extractCommunityNameWithEvidence } from "../src/extractors/community.mjs";
import { extractParticipation } from "../src/extractors/participation.mjs";
import {
  ASSESSMENT_PRICE_LABELS,
  DISPOSAL_PRICE_LABELS,
  MARKET_PRICE_LABELS,
  START_PRICE_LABELS,
  extractAssessmentPrice,
  extractPriceByPriority,
  extractStartPrice,
} from "../src/extractors/price.mjs";
import { fieldEvidence } from "../src/extractors/field-evidence.mjs";

const CONTEXT_CLOSERS = new WeakMap();
const ALIBABA_LAST_REQUEST = new WeakMap();

const FUJIAN_AREAS = {
  福州市: [
    "鼓楼区",
    "台江区",
    "仓山区",
    "马尾区",
    "晋安区",
    "长乐区",
    "闽侯县",
    "连江县",
    "罗源县",
    "闽清县",
    "永泰县",
    "平潭县",
    "福清市",
    "平潭综合实验区",
  ],
  厦门市: ["思明区", "海沧区", "湖里区", "集美区", "同安区", "翔安区"],
  莆田市: ["城厢区", "涵江区", "荔城区", "秀屿区", "仙游县"],
  三明市: [
    "三元区",
    "沙县区",
    "明溪县",
    "清流县",
    "宁化县",
    "大田县",
    "尤溪县",
    "将乐县",
    "泰宁县",
    "建宁县",
    "永安市",
  ],
  泉州市: [
    "鲤城区",
    "丰泽区",
    "洛江区",
    "泉港区",
    "惠安县",
    "安溪县",
    "永春县",
    "德化县",
    "金门县",
    "石狮市",
    "晋江市",
    "南安市",
    "泉州台商投资区",
  ],
  漳州市: [
    "芗城区",
    "龙文区",
    "龙海区",
    "长泰区",
    "云霄县",
    "漳浦县",
    "诏安县",
    "东山县",
    "南靖县",
    "平和县",
    "华安县",
  ],
  南平市: [
    "延平区",
    "建阳区",
    "顺昌县",
    "浦城县",
    "光泽县",
    "松溪县",
    "政和县",
    "邵武市",
    "武夷山市",
    "建瓯市",
  ],
  龙岩市: ["新罗区", "永定区", "长汀县", "上杭县", "武平县", "连城县", "漳平市"],
  宁德市: [
    "蕉城区",
    "霞浦县",
    "古田县",
    "屏南县",
    "寿宁县",
    "周宁县",
    "柘荣县",
    "福安市",
    "福鼎市",
  ],
};

function parseArgs(argv, config = {}) {
  const parsed = {
    command: argv[0] && !argv[0].startsWith("--") ? argv[0] : "run",
    headless: config.headless ?? false,
    dryRun: config.dryRun ?? false,
    lowFrequency: config.lowFrequency ?? false,
    restart: false,
    skipHistoricalRefresh: config.skipHistoricalRefresh ?? false,
    includeParties: config.includeParties ?? false,
    checkpointEvery: config.checkpointEvery ?? 1,
    requestIntervalMs: config.requestIntervalMs ?? 8_000,
    platform: config.platform ?? "all",
    categories: config.categories ? [...config.categories] : Object.keys(CATEGORIES),
    statusFilters: config.statusFilters ? [...config.statusFilters] : [...STATUS_FILTERS],
    maxItems: config.maxItems ?? Number.POSITIVE_INFINITY,
    maxPages: config.maxPages ?? 100,
    loginWaitMinutes: config.loginWaitMinutes ?? 15,
    outputDir: path.resolve(config.outputDir || "房源整理结果"),
    outputDirProvided: Boolean(config.outputDir),
    runName: config.runName || "",
    stateDir: path.resolve(config.stateDir || "path"),
    profileDir: config.profileDir ? path.resolve(config.profileDir) : undefined,
    workbookAdapter: config.workbookAdapter || "standard",
    province: config.province || "福建省",
    cities: config.cities ? [...config.cities] : [],
    scanOnly: config.scanOnly ?? false,
    includeBankruptcy: config.includeBankruptcy !== false,
  };
  const args = parsed.command === argv[0] ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--headless") parsed.headless = true;
    else if (arg === "--headed") parsed.headless = false;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--scan-only") parsed.scanOnly = true;
    else if (arg === "--low-frequency") parsed.lowFrequency = true;
    else if (arg === "--restart") parsed.restart = true;
    else if (arg === "--skip-historical-refresh") parsed.skipHistoricalRefresh = true;
    else if (arg === "--include-parties") parsed.includeParties = true;
    else if (arg === "--include-bankruptcy") parsed.includeBankruptcy = true;
    else if (arg === "--exclude-bankruptcy") parsed.includeBankruptcy = false;
    else if (arg === "--checkpoint-every" && next) {
      parsed.checkpointEvery = Number(next);
      index += 1;
    }
    else if (arg === "--request-interval-ms" && next) {
      parsed.requestIntervalMs = Number(next);
      index += 1;
    }
    else if (arg === "--platform" && next) {
      parsed.platform = next;
      index += 1;
    } else if (arg === "--category" && next) {
      parsed.categories = next.split(",").map((item) => item.trim());
      index += 1;
    } else if (arg === "--status" && next) {
      parsed.statusFilters = next.split(",").map((item) => item.trim());
      index += 1;
    } else if (arg === "--province" && next) {
      parsed.province = next.trim();
      index += 1;
    } else if (arg === "--cities" && next) {
      parsed.cities = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--max-items" && next) {
      parsed.maxItems = Number(next);
      index += 1;
    } else if (arg === "--max-pages" && next) {
      parsed.maxPages = Number(next);
      index += 1;
    } else if (arg === "--login-wait-minutes" && next) {
      parsed.loginWaitMinutes = Number(next);
      index += 1;
    } else if (arg === "--output-dir" && next) {
      parsed.outputDir = path.resolve(next);
      parsed.outputDirProvided = true;
      index += 1;
    } else if (arg === "--run-name" && next) {
      if (!/^\d{8}(?:（\d+）)?$/u.test(next)) throw new Error("--run-name 必须是YYYYMMDD或YYYYMMDD（序号）");
      parsed.runName = next;
      index += 1;
    } else if (arg === "--state-dir" && next) {
      parsed.stateDir = path.resolve(next);
      index += 1;
    } else if (arg === "--profile-dir" && next) {
      parsed.profileDir = path.resolve(next);
      index += 1;
    } else if (arg === "--urls-file" && next) {
      parsed.urlsFile = path.resolve(next);
      index += 1;
    } else if (arg === "--anchors-file" && next) {
      parsed.anchorsFile = path.resolve(next);
      index += 1;
    } else if (arg === "--workbook-adapter" && next) {
      parsed.workbookAdapter = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.command = "help";
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!["all", "jd", "jd_pc", "alibaba", "alibaba_pc", "alibaba_pc_all", "alibaba_jd_pc", "alibaba_pc_jd_pc"].includes(parsed.platform)) {
    throw new Error("--platform 不支持当前平台组合");
  }
  if (!["codex", "standard"].includes(parsed.workbookAdapter)) {
    throw new Error("--workbook-adapter 仅支持 codex、standard");
  }
  for (const category of parsed.categories) {
    if (!CATEGORIES[category]) {
      throw new Error(`不支持的标的类型：${category}`);
    }
  }
  for (const status of parsed.statusFilters) {
    if (!STATUS_FILTERS.includes(status)) {
      throw new Error(`不支持的状态筛选：${status}`);
    }
  }
  if (
    !(parsed.maxItems > 0) ||
    !(parsed.maxPages > 0) ||
    !(parsed.loginWaitMinutes > 0) ||
    !(parsed.requestIntervalMs >= 0) ||
    !(parsed.checkpointEvery > 0)
  ) {
    throw new Error(
      "--max-items、--max-pages、--login-wait-minutes 和 --checkpoint-every 必须大于 0；--request-interval-ms 不得小于 0",
    );
  }
  parsed.profileDir ||= path.join(parsed.stateDir, "edge-profile");
  return parsed;
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  if (!value) return null;
  const match = String(value)
    .replaceAll(",", "")
    .match(/(-?\d+(?:\.\d+)?)\s*(亿|万|元)?/);
  if (!match) return null;
  const scale = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  return Number(match[1]) * scale;
}

function shouldStopListScan(anchor, anchorFound, foundCount, maxItems) {
  // A finite maxItems limits queued detail records, not high-water discovery.
  // When an anchor exists, keep scanning until the anchor or maxPages is hit.
  return anchor ? anchorFound : foundCount >= maxItems;
}

function resolveAnchorBoundary(url, anchor, knownBoundaryUrls = new Set()) {
  const current = canonicalUrl(url || "");
  const primary = canonicalUrl(anchor || "");
  if (primary && current === primary) return { matched: true, mode: "primary", url: current };
  if (primary && knownBoundaryUrls?.has(current)) {
    return { matched: true, mode: "known_record_fallback", url: current };
  }
  return { matched: false, mode: "", url: "" };
}

function labeledMoney(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `${escaped}\\s*[：:]?\\s*￥?\\s*([\\d,.]+)\\s*(亿|万|元)?`,
      ),
    );
    if (match) return parseMoney(`${match[1]}${match[2] || ""}`);
  }
  return null;
}

function toIsoDate(groups) {
  const [year, month, day, hour = "0", minute = "0", second = "0"] = groups;
  const pad = (value) => String(value).padStart(2, "0");
  const value = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(
    minute,
  )}:${pad(second)}+08:00`;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function extractAuctionDates(text) {
  const normalized = text.replace(/\s+/g, "");
  const range = normalized.match(
    /将于(?:计划网拍时间|计划网络拍卖时间|网络拍卖时间|拍卖时间|变卖时间|竞价时间)?[：:]?(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2})时(?:(\d{1,2})分)?(?:起)?至(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2})时(?:(\d{1,2})分)?(?:止)?/,
  );
  if (range) {
    return {
      start: toIsoDate([range[1], range[2], range[3], range[4], range[5] || "0"]),
      end: toIsoDate([range[6], range[7], range[8], range[9], range[10] || "0"]),
    };
  }
  const label = (name) => {
    const match = normalized.match(
      new RegExp(
        `${name}[：:]?(\\d{4})年(\\d{1,2})月(\\d{1,2})日(\\d{1,2})[时:](\\d{1,2})`,
      ),
    );
    return match
      ? toIsoDate([match[1], match[2], match[3], match[4], match[5]])
      : null;
  };
  const compact = (suffixPattern) => {
    const match = text.match(
      new RegExp(
        `(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\s*(\\d{1,2}):(\\d{1,2})(?::\\d{1,2})?\\s*${suffixPattern}`,
      ),
    );
    return match
      ? toIsoDate([match[1], match[2], match[3], match[4], match[5]])
      : null;
  };
  const prefixedCompact = (labelPattern) => {
    const match = text.match(
      new RegExp(
        `${labelPattern}\\s*[：:]?\\s*(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})\\s+(\\d{1,2}):(\\d{1,2})(?::\\d{1,2})?`,
      ),
    );
    return match
      ? toIsoDate([match[1], match[2], match[3], match[4], match[5]])
      : null;
  };
  return {
    start:
      label("(?:起拍时间|开拍时间|开始时间|竞价开始时间|变卖开始时间)") ||
      prefixedCompact("(?:起拍时间|开拍时间|开始时间|竞价开始时间|变卖开始时间)") ||
      compact("(?:开拍|开始|起拍)"),
    end:
      label("(?:结束时间|竞价结束时间|变卖结束时间)") ||
      prefixedCompact("(?:结束时间|竞价结束时间|变卖结束时间)") ||
      compact("(?:结束|截止)"),
  };
}

function nearestYearlessAuctionDate(text, suffix, referenceNow = new Date()) {
  const match = String(text || "").match(
    new RegExp(`(\\d{1,2})\\s*\\u6708\\s*(\\d{1,2})\\s*\\u65e5\\s*(\\d{1,2}):(\\d{1,2})(?::(\\d{1,2}))?\\s*${suffix}`),
  );
  if (!match) return null;
  const now = referenceNow instanceof Date ? referenceNow : new Date(referenceNow);
  if (Number.isNaN(now.valueOf())) return null;
  const candidates = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
    .map((year) => toIsoDate([year, match[1], match[2], match[3], match[4], match[5] || "0"]))
    .filter(Boolean);
  return candidates.sort(
    (left, right) => Math.abs(new Date(left) - now) - Math.abs(new Date(right) - now),
  )[0] || null;
}

function resolveAuctionDates(text, stage, referenceNow = new Date()) {
  const dates = extractAuctionDates(text);
  const bannerStart = dates.start
    ? null
    : nearestYearlessAuctionDate(text, "(?:\\u5f00\\u59cb|\\u5f00\\u62cd)", referenceNow);
  const bannerEnd = dates.end
    ? null
    : nearestYearlessAuctionDate(text, "(?:\\u7ed3\\u675f|\\u622a\\u6b62)", referenceNow);
  return {
    start: dates.start || bannerStart,
    end: dates.end || bannerEnd,
    endSource: dates.end || bannerEnd ? "页面明确时间" : "未找到",
  };
}

function cleanPartyValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:执行)?案号\s*[：:].*$/i, "")
    .replace(
      /\s+(?:执行依据|案件编号|联系电话|处置单位)\s*[：:].*$/i,
      "",
    )
    .replace(/^[：:、，,；;\s]+|[：:、，,；;。.!！)）\s]+$/g, "")
    .trim();
}

function extractParty(text, labels, fallbackPatterns = []) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`${escaped}\\s*[：:]\\s*([^\\n，。；;]{2,120})`),
    );
    if (match) {
      const value = cleanPartyValue(match[1]);
      if (value && !/^(无|暂无|不详|未披露)$/.test(value)) return value;
    }
  }
  for (const pattern of fallbackPatterns) {
    const match = text.match(pattern);
    const value = cleanPartyValue(match?.[1]);
    if (value && !/^(其|该|及其|历史|无|暂无|不详|未披露)$/.test(value)) {
      return value;
    }
  }
  return "未找到";
}

function valueAfterRowLabel(cells, labelPattern) {
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cleanPartyValue(cells[index]);
    const inline = cell.match(
      new RegExp(`^(?:${labelPattern.source})\\s*[：:]\\s*(.+)$`),
    );
    if (inline?.[1]) return cleanPartyValue(inline[1]);
    if (new RegExp(`^(?:${labelPattern.source})$`).test(cell)) {
      const following = cells
        .slice(index + 1)
        .map(cleanPartyValue)
        .filter(Boolean)
        .join("、");
      if (following) return following;
    }
  }
  return "";
}

function cleanMortgageCreditor(value) {
  const organizations = cleanPartyValue(value)
    .split(/[、,，；;\n]+/)
    .map((part) =>
      cleanPartyValue(part)
        .replace(/^\d+\s*[、.．)]\s*/, "")
        .replace(
          /^(?:抵押登记权利人|抵押权利人|抵押权人|抵押情况|抵押|已抵押)(?:为|是|于|给)?\s*[：:]?\s*/,
          "",
        )
        .replace(/^(?:本案)?申请执行人(?:为|是)?\s*[：:]?\s*/, "")
        .replace(/^(?:权利人为|权利人)\s*[：:]?\s*/, "")
        .replace(/^(?:于|给)\s*/, "")
        .replace(
          /(?:债权数额|担保债权|抵押金额|最高债权额|债权确定期间|登记时间|登记日期|登记证明|证号|查封|轮候查封)\s*[：:]?.*$/u,
          "",
        )
        .replace(/[（(](?:债权|担保|抵押|登记).*$/u, "")
        .trim(),
    )
    .filter(
      (part) =>
        part.length >= 2 &&
        part.length <= 100 &&
        !/等当事人|拍卖财产相关|被执行人的债务|税费|债权数额|抵押金额|登记信息/.test(
          part,
        ) &&
        !/^(无|暂无|不详|未披露|未设定抵押|已抵押|有抵押|设有抵押|有|是|否|详见.*)$/.test(
          part,
        ),
    );
  if (!organizations.length) return "未找到";
  return [...new Set(organizations)].join("、") || "未找到";
}

function cleanOwner(value) {
  let cleaned = cleanPartyValue(value);
  const inherited = cleaned.match(
    /^被执行人([^，。；;]{2,50}?)继承的登记在.+名下$/,
  );
  if (inherited?.[1]) cleaned = cleanPartyValue(inherited[1]);
  else {
    cleaned = cleanPartyValue(
      cleaned
        .replace(/^被执行人\s*/, "")
        .replace(/(?:名下|所有)$/, ""),
    );
  }
  if (
    !cleaned ||
    /^(无|暂无|不详|未披露|被执行人名下)$/.test(cleaned) ||
    /^(?:的|及|承担|本次|相关)/.test(cleaned) ||
    /拍卖财产相关|被执行人的债务|交易产生的税费|土地使用权人均为|权利份额.*房屋坐落|幢号.*建筑面积.*用途|房屋性质.*登记时间/.test(
      cleaned,
    )
  ) {
    return "未找到";
  }
  return cleaned;
}

function extractOwnerFromTitle(value) {
  const title = cleanAuctionTitle(value);
  const match = title.match(
    /^(.{2,100}?)名下(?:坐落|位于|所有|的(?:国有|房产|不动产|房地产))/,
  );
  return cleanOwner(match?.[1]);
}

function extractMortgagePhraseCandidates(text) {
  const candidates = [];
  const pattern =
    /(?:(?:抵押登记权利人|抵押权利人|抵押权人)(?:为|是)?|(?:已)?抵押(?:于|给)|抵押\s*[：:])\s*[：:]?\s*((?:本案)?(?:申请执行人(?:为|是)?)?\s*[^；;。\n]{2,300})/gu;
  for (const match of String(text || "").matchAll(pattern)) {
    if (match[1]) candidates.push(match[1]);
  }
  return candidates;
}

function extractAlibabaInvestigation(rows, text = "") {
  let owner = "";
  const mortgageCandidates = [];
  for (const rawCells of rows || []) {
    const cells = rawCells.map(cleanPartyValue).filter(Boolean);
    if (!cells.length) continue;
    owner ||= valueAfterRowLabel(
      cells,
      /标的物所有人|标的所有人|标的物权利人|标的权利人|拍品所有人|拍品权利人|不动产权利人|房屋所有权人|登记所有权人|所有权人|产权人/,
    );
    const directMortgage = valueAfterRowLabel(
      cells,
      /抵押|抵押情况|抵押权人|抵押权利人|抵押登记权利人/,
    );
    if (directMortgage) mortgageCandidates.push(directMortgage);
    mortgageCandidates.push(
      ...extractMortgagePhraseCandidates(cells.join("\n")),
    );
  }
  owner ||= extractParty(text, [
    "标的物所有人",
    "标的所有人",
    "标的物权利人",
    "标的权利人",
    "拍品所有人",
    "拍品权利人",
    "不动产权利人",
    "房屋所有权人",
    "登记所有权人",
    "所有权人",
  ]);
  mortgageCandidates.push(...extractMortgagePhraseCandidates(text));
  let mortgage = cleanMortgageCreditor(mortgageCandidates.join("、"));
  if (mortgage === "未找到") {
    mortgage = cleanMortgageCreditor(
      extractParty(
      text,
      ["抵押权人", "债权人", "申请执行人"],
      [
        /(?:本案)?申请执行人为?([\u4e00-\u9fa5（）()]{4,100}(?:公司|银行|分行|支行|信用社|合作社))/,
      ],
      ),
    );
  }
  return {
    owner: cleanOwner(owner),
    mortgageCreditor: mortgage,
  };
}

function extractCourt(text, preferred) {
  if (preferred?.trim()) return preferred.trim();
  const match = text.match(
    /([\u4e00-\u9fa5]{2,35}(?:中级人民法院|高级人民法院|人民法院))/,
  );
  return match ? match[1] : "未找到";
}

function splitLocation(...values) {
  let cityOnly = "";
  for (const value of values.filter(Boolean)) {
    const text = String(value);
    for (const [candidateCity, areas] of Object.entries(FUJIAN_AREAS)) {
      const candidateArea = areas.find((item) => text.includes(item));
      if (candidateArea) {
        return {
          所在省份: "福建省",
          城市: candidateCity,
          区域: candidateArea,
        };
      }
      if (!cityOnly && text.includes(candidateCity)) cityOnly = candidateCity;
    }
  }
  return { 所在省份: "福建省", 城市: cityOnly, 区域: "" };
}

function cleanAuctionTitle(value) {
  return cleanAuctionTitleShared(value);
}

function cleanPropertyTitle(value) {
  return cleanPropertyTitleShared(value);
}

function classifyPropertyType(sourceCategory, title) {
  if (sourceCategory === "商业用房") return "商业";
  if (sourceCategory === "工业用房") return "工业";
  const normalizedTitle = String(title || "");
  if (/停车位|车位/u.test(normalizedTitle)) return "车位";
  if (/别墅/u.test(normalizedTitle)) return "别墅";
  return "住宅";
}

function sourceCategoryForRecord(record) {
  if (CATEGORIES[record?._源分类]) return record._源分类;
  if (CATEGORIES[record?.标的类型]) return record.标的类型;
  if (["车位", "住宅", "别墅"].includes(record?.标的类型)) return "住宅用房";
  if (record?.标的类型 === "商业") return "商业用房";
  if (record?.标的类型 === "工业") return "工业用房";
  return "";
}

function extractAreaFromText(text) {
  return extractAreaFromTextShared(text);
}

function textAfterLastMarker(text, markers, maxLength = 40_000) {
  return textAfterLastMarkerShared(text, markers, maxLength);
}

function extractAreaByPriority(documents) {
  return extractAreaByPriorityShared(documents);
}

async function extractAlibabaHelpCenterArea(page, itemUrl, options) {
  const itemId = String(itemUrl || "").match(/\/(\d+)\.htm/i)?.[1];
  if (!itemId) return { area: null, source: "未找到", ruleId: "area-help-not-found-v1" };
  const helpUrl = `https://sf-item.taobao.com/help_center.htm?item_id=${itemId}`;
  await waitForAlibabaRequestSlot(page, options, "打开帮助中心");
  const helpPage = await page.context().newPage();
  try {
    await gotoWithTransientRetry(helpPage, helpUrl);
    await helpPage.waitForTimeout(1_500);
    await helpPage
      .waitForFunction(
        () => /这套房关键信息|建筑面积/.test(document.body?.innerText || ""),
        null,
        { timeout: 8_000 },
      )
      .catch(() => {});
    await helpPage
      .evaluate(async () => {
        const maxY = Math.min(document.body?.scrollHeight || 0, 12_000);
        for (let y = 0; y < maxY; y += 800) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        window.scrollTo(0, 0);
      })
      .catch(() => {});
    const text = await helpPage.locator("body").innerText().catch(() => "");
    if (isAlibabaAuthGate(helpPage, text) || isBrowserErrorPage(helpPage)) {
    return { area: null, source: "未找到", ruleId: "area-help-not-found-v1" };
    }
    const keyInfo = textAfterLastMarker(
      text,
      ["这套房关键信息是什么？", "这套房关键信息是什么"],
      8_000,
    );
    const area = extractAreaFromText(`${keyInfo}\n${text}`);
    return area === null
      ? { area: null, source: "未找到", ruleId: "area-help-not-found-v1" }
      : { area, source: "帮助中心-这套房关键信息", ruleId: "area-help-center-v1" };
  } finally {
    await helpPage.close().catch(() => {});
  }
}

function detectStage(title, text) {
  const titleStage = String(title || "").match(
    /^\s*(?:【\s*)?(一拍|二拍|三拍|再次拍卖|变卖|第一次拍卖|第二次拍卖|第三次拍卖)(?:\s*】)?(?:\s+|$)/,
  )?.[1];
  if (titleStage) {
    if (titleStage === "第一次拍卖") return "一拍";
    if (titleStage === "第二次拍卖") return "二拍";
    if (titleStage === "三拍" || titleStage === "第三次拍卖") {
      return "再次拍卖";
    }
    return titleStage;
  }
  const source = `${title}\n${text.slice(0, 6000)}`;
  const bracket = source.match(/【(一拍|二拍|三拍|再次拍卖|变卖)】/);
  if (bracket) return bracket[1];
  if (/第二次拍卖|二拍/.test(source)) return "二拍";
  if (/第三次拍卖|三拍|再次拍卖/.test(source)) return "再次拍卖";
  if (/变卖/.test(source)) return "变卖";
  if (/第一次拍卖|一拍/.test(source)) return "一拍";
  return "待核验";
}

function detectOutcome(text) {
  const head = text.slice(0, 6000);
  if (/已撤回/.test(head)) return "已撤回";
  if (/已中止/.test(head)) return "已中止";
  if (/已暂缓/.test(head)) return "已暂缓";
  if (/距开始\s*[\d天时分秒.]|即将开始|预告中|尚未开始/.test(head)) {
    return "即将开始";
  }
  if (/距结束\s*[\d天时分秒.]|正在进行|竞价进行中/.test(head)) {
    return "正在进行";
  }
  if (
    /本场(?:拍卖|变卖)?已成交|拍卖成交|成交价[：:]\s*￥?\s*[\d,]/.test(
      head,
    )
  ) {
    return "是";
  }
  if (
    /本场(?:拍卖|变卖)?已流拍|本场已结束|竞价已结束|无人出价|(?:^|\n)\s*已结束(?:\s|$)/.test(
      head,
    )
  ) {
    const bid = head.match(/(?:被出价|出价)(\d+)次|(\d+)次出价/);
    const count = bid ? Number(bid[1] || bid[2]) : null;
    if (count !== null) return count > 0 ? "是" : "否";
    return "待核验";
  }
  return "待核验";
}

function interpretJdResult(statusText, transactionAmount = null) {
  const status = String(statusText || "").replace(/\s+/g, "");
  if (status === "已流拍") return { outcome: "否", amount: 0 };
  if (status === "已成交") {
    return {
      outcome: "是",
      amount: Number.isFinite(transactionAmount) ? transactionAmount : null,
    };
  }
  return { outcome: "待核验", amount: null };
}

function detectAlibabaOutcome(text) {
  const head = text.slice(0, 9000);
  if (/已撤回/.test(head)) return "已撤回";
  if (/已中止/.test(head)) return "已中止";
  if (/已暂缓/.test(head)) return "已暂缓";
  if (/距开始\s*[\d天时分秒.]|即将开始|预告中|尚未开始/.test(head)) {
    return "即将开始";
  }
  if (/距结束\s*[\d天时分秒.]|正在进行|竞价进行中/.test(head)) {
    return "正在进行";
  }

  // 阿里结束页只以页面右侧价格下方的结果文案判断成交与否。
  // 拍下价、当前价与起拍价的关系只能用于质量复核，不能推翻结果文案。
  // 页面底部流程说明中的“竞价成功”等通用文字不属于成交证据。
  if (/本场已流拍(?:，?无人出价)?/.test(head)) {
    return "否";
  }
  if (/本场已结束|本场(?:拍卖|变卖)?已成交/.test(head)) {
    return "是";
  }
  return "待核验";
}

function inferStatusGroup(outcome, dates = {}, nowMs = Date.now()) {
  if (outcome === "即将开始") return "即将开始";
  if (["是", "否", "已撤回", "已中止", "已暂缓"].includes(outcome)) {
    return "已结束";
  }
  const start = dates.start ? new Date(dates.start).valueOf() : Number.NaN;
  const end = dates.end ? new Date(dates.end).valueOf() : Number.NaN;
  if (Number.isFinite(start) && start > nowMs) return "即将开始";
  if (Number.isFinite(end)) return end > nowMs ? "即将开始" : "已结束";
  return "即将开始";
}

function resolveStatusGroup(listStatusGroup, outcome, dates = {}) {
  if (["是", "否", "已撤回", "已中止", "已暂缓"].includes(outcome)) {
    return "已结束";
  }
  if (STATUS_FILTERS.includes(listStatusGroup)) return listStatusGroup;
  return inferStatusGroup(outcome, dates);
}

function matchesStatusFilter(value, statusFilter) {
  const text = String(value || "").replace(/\s+/g, "");
  if (!text) return false;
  if (statusFilter === "即将开始") {
    return /即将开始|即将开拍|预告|未开始|距开始/.test(text);
  }
  if (statusFilter === "已结束") {
    return /已结束|竞价结束|已成交|成交|流拍|结束/.test(text);
  }
  return false;
}

function isExplicitEmptyList(value) {
  return /暂无(?:相关)?(?:标的|拍品|数据|结果)|没有找到|没有您要找的拍品|未找到相关|无相关(?:标的|拍品|数据)/.test(
    String(value || "").replace(/\s+/g, ""),
  );
}

function qualityFields(record, includeParties = false) {
  const required = [
    "城市",
    "区域",
    "标的名称",
    "标的类型",
    "发拍次数",
    "拍卖时间",
    "处置法院",
  ];
  if (includeParties) required.push("债权人", "债务人");
  const missing = required.filter(
    (field) => !record[field] || record[field] === "未找到" || record[field] === "待核验",
  );
  if (!Number.isFinite(record.起拍价格)) missing.push("起拍价格");
  if (!Number.isFinite(record.评估价)) missing.push("评估价");
  if (!OUTPUT_PROPERTY_TYPES.has(record.标的类型)) missing.push("标的类型");
  if (!Number.isFinite(record["面积/㎡"])) missing.push("面积/㎡");
  if (!record.网站链接) missing.push("网站链接");
  if (record.是否成交 === "待核验") missing.push("是否成交");
  if (record.是否成交 === "是" && !Number.isFinite(record.成交金额)) {
    missing.push("成交金额");
  }
  if (record._participationExtractionAttempted && record._状态分组 === "已结束") {
    if (!Number.isInteger(record.报名人数) || record.报名人数 < 0) missing.push("报名人数");
    if (!Number.isInteger(record.竞买记录) || record.竞买记录 < 0) missing.push("竞买记录");
    if (record.是否成交 === "是" && record.报名人数 <= 0) missing.push("报名人数");
    if (record.是否成交 === "是" && record.竞买记录 <= 0) missing.push("竞买记录");
  }
  return [...new Set(missing)];
}

function alibabaShellReviewItems(failures) {
  const byUrl = new Map();
  for (const failure of failures) {
    if (failure.platform !== "alibaba") continue;
    const error = String(failure.error || "");
    const url = String(failure.url || "");
    if (
      !/susong-item\.taobao\.com|新版诉讼详情页|未返回可解析内容|淘宝登录页未正常加载|login\.taobao\.com|havanaone\/login|chrome-error:\/\/chromewebdata/.test(
        `${url}\n${error}`,
      )
    ) {
      continue;
    }
    const canonical = canonicalUrl(url);
    if (!canonical) continue;
    byUrl.set(canonical, {
      平台: "阿里资产",
      标的类型: failure.category || "",
      列表状态: failure.status || failure.statusGroup || "",
      标的名称: failure.title || "",
      网站链接: canonical,
      待复核原因: "新版阿里诉讼详情页仅返回空壳或登录页，需人工核验",
      记录时间: failure.capturedAt || new Date().toISOString(),
    });
  }
  return [...byUrl.values()];
}

function fieldConflictReviewItems(records) {
  const items = [];
  for (const record of records || []) {
    if (record._propertyTypeReviewRequired) {
      const candidates = Array.isArray(record._propertyTypeCandidates)
        ? record._propertyTypeCandidates.filter(Boolean)
        : [];
      items.push({
        平台: record.平台 || "",
        标的类型: record.标的类型 || "",
        列表状态: record._状态分组 || "",
        标的名称: record.标的名称 || "",
        网站链接: record.网站链接 || "",
        待复核原因: candidates.length > 1
          ? `平台物业类型存在冲突：${candidates.join("、")}`
          : "平台未能唯一确认物业类型，当前结果来自低置信度回退规则",
        记录时间: record._capturedAt || new Date().toISOString(),
        待复核字段: ["标的类型"],
      });
    }
    for (const [fieldName, evidence] of Object.entries(record._fieldEvidence || {})) {
      if (!evidence?.reviewRequired || !Array.isArray(evidence.conflicts) || !evidence.conflicts.length) continue;
      const descriptions = evidence.conflicts.map((conflict) => {
        if (["mixed-component-total-ambiguous", "main-area-with-ancillary-components"].includes(conflict.type)) {
          return `当前选择${conflict.selectedArea}㎡；若合并附属物/车位则为${conflict.possibleCombinedArea}㎡，页面未明确总面积口径`;
        }
        return JSON.stringify(conflict);
      });
      items.push({
        平台: record.平台 || "",
        标的类型: record.标的类型 || "",
        列表状态: record._状态分组 || "",
        标的名称: record.标的名称 || "",
        网站链接: record.网站链接 || "",
        待复核原因: `${fieldName}存在候选值冲突：${descriptions.join("；")}`,
        记录时间: record._capturedAt || new Date().toISOString(),
        待复核字段: [fieldName],
      });
    }
  }
  return items;
}

async function waitForList(page, selector) {
  await page.locator(selector).first().waitFor({ state: "attached", timeout: 15_000 }).catch(() => {});
}

async function waitForJdListOutcome(page, selector, timeoutMs = 25_000) {
  const startedAt = Date.now();
  let emptyStableSince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await page.evaluate((itemSelector) => {
      const text = String(document.body?.innerText || "").replace(/\s+/g, "");
      const itemCount = document.querySelectorAll(itemSelector).length;
      const listShell = document.querySelector(".goods-list-container");
      const filterShell = document.querySelector(".s-location");
      const shellChildCount = listShell?.querySelectorAll("li").length || 0;
      const loading = [...document.querySelectorAll(
        ".loading,.ui-loading,.j-loading,[class*='loading']",
      )].some((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      return {
        itemCount,
        shellChildCount,
        shellReady: Boolean(listShell && filterShell),
        filterReady: Boolean(filterShell),
        bodyTextLength: text.length,
        browserError: /ERR_[A-Z_]+|无法访问此页面|页面无响应|网络连接已中断/.test(text),
        loading,
        explicitEmpty: /暂无(?:相关)?(?:拍品|商品|标的|数据)|没有找到|未找到相关|无相关(?:拍品|商品|标的|数据)/.test(text),
      };
    }, selector).catch(() => ({ itemCount: 0, shellReady: false, loading: false, explicitEmpty: false }));

    const stableForMs = emptyStableSince ? Date.now() - emptyStableSince : 0;
    const outcome = classifyListSnapshot(snapshot, stableForMs);
    if (outcome.kind !== "pending") return outcome;
    if (
      snapshot.filterReady
      && snapshot.bodyTextLength >= 200
      && !snapshot.browserError
      && snapshot.shellChildCount === 0
      && !snapshot.loading
    ) {
      if (!emptyStableSince) emptyStableSince = Date.now();
    } else {
      emptyStableSince = 0;
    }
    await page.waitForTimeout(500);
  }
  return { kind: "not_ready", reason: "list_shell_timeout" };
}

function isLoginPage(page, text) {
  return (
    page.url().includes("login.taobao.com") ||
    (page.url().includes("login") && /登录/.test(text.slice(0, 500)))
  );
}

function isAlibabaAuthGate(page, text) {
  const url = page.url();
  return (
    isLoginPage(page, text) ||
    /(?:login|passport|verify|nocaptcha|punish)/i.test(url) ||
    /验证码拦截|请完成验证|通过验证以确保正常访问|请按住滑块|安全验证|滑动验证|扫码登录/.test(
      text.slice(0, 1500),
    )
  );
}

function isAlibabaAssetTradingPage(page, text = "") {
  // The judicial-auction list can occasionally contain items whose detail
  // breadcrumb belongs to the broader "资产交易" channel. They are outside
  // the requested judicial-auction scope and must be skipped, not retried or
  // written to the review sheet.
  return /\u8d44\u4ea7\u4ea4\u6613/.test(`${page.url()}\n${text}`);
}

function isAlibabaPersonalHomeRedirectUrl(url = "") {
  try {
    const parsed = new URL(String(url));
    return parsed.hostname.toLowerCase() === "i.taobao.com" && /^\/my_itaobao(?:\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function alibabaDeferredReviewItems(evidence) {
  const byUrl = new Map();
  for (const item of evidence || []) {
    if (item?.action !== "deferred-alibaba-bankruptcy-layout") continue;
    const canonical = canonicalUrl(item.url || "");
    if (!canonical) continue;
    byUrl.set(canonical, {
      平台: "阿里资产",
      标的类型: item.category || "",
      列表状态: item.status || "",
      标的名称: item.title || "",
      网站链接: canonical,
      待复核原因:
        "疑似破产拍卖/非标准详情布局，详情返回后跳转淘宝个人页；已保留列表链接并从下一条继续",
      记录时间: item.capturedAt || new Date().toISOString(),
    });
  }
  return [...byUrl.values()];
}

function throwIfAlibabaAssetTrading(page, text = "") {
  if (!isAlibabaAssetTradingPage(page, text)) return;
  const error = new Error(`EXCLUDED_NON_JUDICIAL_ASSET_TRADING:${page.url()}`);
  error.code = "EXCLUDED_NON_JUDICIAL_ASSET_TRADING";
  throw error;
}

async function tryAlibabaQuickLogin(page) {
  for (const frame of page.frames()) {
    const button = frame.getByText("快捷登录", { exact: true }).first();
    if (!(await button.isVisible().catch(() => false))) continue;
    console.log("检测到淘宝“快捷登录”按钮，按用户授权点击一次。");
    await button.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    return true;
  }
  return false;
}

function isBrowserErrorPage(page) {
  return page.url().startsWith("chrome-error://");
}

const ALIBABA_PC_ITEM_SELECTOR = [
  'a[href*="/sf_item/"]:not([href*="puimod-pc-search-recommend-list"])',
  'a[href*="sf-item.taobao.com"]:not([href*="puimod-pc-search-recommend-list"])',
  'a[href*="zc-item.taobao.com"]:not([href*="puimod-pc-search-recommend-list"])',
].join(",");
const ALIBABA_PC_RECOMMENDATION_SELECTOR = [
  '[class*="recommend"]',
  '[id*="recommend"]',
  '[data-spm*="recommend"]',
  '[class*="puimod-pc-search-recommend-list"]',
].join(",");

function isAlibabaDetailHost(hostname) {
  return ["sf-item.taobao.com", "zc-item.taobao.com"].includes(hostname);
}

function isAlibabaBankruptcyCardText(value) {
  return /\u7834\u4ea7|\u4f01\u4e1a\u7834\u4ea7|\u7834\u4ea7\u8d44\u4ea7/u.test(String(value || ""));
}

async function countAlibabaPcResultLinks(page) {
  return page.locator(ALIBABA_PC_ITEM_SELECTOR).evaluateAll(
    (nodes, recommendationSelector) => nodes.filter(
      (node) => !node.closest(recommendationSelector),
    ).length,
    ALIBABA_PC_RECOMMENDATION_SELECTOR,
  );
}

function isSameAlibabaTarget(currentValue, targetValue) {
  try {
    const current = new URL(currentValue);
    const target = new URL(targetValue);
    const itemId = (url) =>
      url.href.match(
        /(?:sf-item\.taobao\.com\/sf_item|susong-item\.taobao\.com\/auction)\/(\d+)/i,
      )?.[1] || "";
    const currentItemId = itemId(current);
    const targetItemId = itemId(target);
    if (currentItemId && targetItemId && currentItemId === targetItemId) {
      return true;
    }
    if (target.hostname === "huodong.taobao.com") {
      return current.hostname === target.hostname
        && current.pathname === target.pathname
        && alibabaPcFilterMismatches(current.href, target.href).length === 0;
    }
    const normalizedPath = (value) => value.replace(/\/+/g, "/").replace(/\/$/, "");
    return (
      current.hostname === target.hostname &&
      normalizedPath(current.pathname) === normalizedPath(target.pathname)
    );
  } catch {
    return false;
  }
}

async function hasAlibabaTargetContent(page, targetUrl, body) {
  if (body.trim().length < 100) return false;
  const target = new URL(targetUrl);
  const current = new URL(page.url());
  if (target.hostname === "huodong.taobao.com") {
    if (current.hostname !== target.hostname || current.pathname !== target.pathname) {
      return false;
    }
    const itemCount = await countAlibabaPcResultLinks(page);
    return itemCount > 0 || isExplicitEmptyList(body);
    /* c8 ignore next 3 -- retained below temporarily for source compatibility */
    return /分类|所在地|物业类型|资产类型/u.test(body)
      && (/即将开始|已结束|暂无|没有相关|没有您要找的拍品/u.test(body)
        || (await page.locator(ALIBABA_PC_ITEM_SELECTOR).count()) > 0);
  }
  if (!isSameAlibabaTarget(page.url(), targetUrl)) return false;
  if (target.hostname === "zc-item.taobao.com") {
    return body.length > 500
      && /\u5f53\u524d\u4ef7|\u8d77\u62cd\u4ef7|\u8bc4\u4f30\u4ef7|\u53d8\u5356\u4ef7|\u7ade\u4ef7|\u62cd\u5356|\u6807\u7684\u7269|\u4fdd\u8bc1\u91d1/u.test(body);
  }
  if (isAlibabaDetailHost(target.hostname)) {
    return /起拍价|变卖价|开拍时间|竞价时间|处置法院|处置单位|标的物调查/.test(
      body,
    );
  }
  return (
    (await page
      .locator(
        '.sf-item-list ul.sf-pai-item-list > li.pai-item > a.link-wrap[href*="/sf_item/"]',
      )
      .count()) > 0
  );
}

async function gotoWithTransientRetry(page, targetUrl, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await page.goto(targetUrl, {
        waitUntil: "commit",
        timeout: 45_000,
      });
      await page
        .waitForLoadState("domcontentloaded", { timeout: 15_000 })
        .catch(() => {});
      return response;
    } catch (error) {
      lastError = error;
      if (
        attempt === maxAttempts ||
        !/ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|Timeout.*exceeded/i.test(
          String(error),
        )
      ) {
        throw error;
      }
      console.log(
        `网络状态切换，${attempt} 秒后重试阿里资产页面（${attempt}/${maxAttempts}）。`,
      );
      await page.waitForTimeout(attempt * 1_000);
    }
  }
  throw lastError;
}

async function waitForAlibabaTargetContent(page, targetUrl) {
  const isPcList = new URL(targetUrl).hostname === "huodong.taobao.com";
  const deadline = Date.now() + (isPcList ? 45_000 : 6_000);
  let body = "";
  while (Date.now() < deadline) {
    body = await page.locator("body").innerText().catch(() => "");
    if (isAlibabaAuthGate(page, body) || isBrowserErrorPage(page)) {
      return { body, ready: false };
    }
    if (await hasAlibabaTargetContent(page, targetUrl, body)) {
      return { body, ready: true };
    }
    await page.waitForTimeout(1_000);
  }
  return { body, ready: false };
}

async function navigateAlibaba(page, targetUrl, options) {
  const loginUrl =
    "https://login.taobao.com/havanaone/login/login.htm?bizName=taobao";
  let body = await page.locator("body").innerText().catch(() => "");
  const currentUrl = page.url();
  const alreadyAtTarget = isSameAlibabaTarget(currentUrl, targetUrl);
  if (!alreadyAtTarget && !isAlibabaAuthGate(page, body)) {
    try {
      await waitForAlibabaRequestSlot(page, options, "页面跳转");
      await gotoWithTransientRetry(page, targetUrl, options.headless ? 3 : 1);
    } catch (error) {
      if (
        options.headless ||
        !/ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_RESET|ERR_TIMED_OUT|Timeout.*exceeded/i.test(
          String(error),
        )
      ) {
        throw error;
      }
      console.log(
        "阿里资产入口暂时连接超时，改为打开淘宝官方登录页；登录后将返回原目标页。",
      );
      await gotoWithTransientRetry(page, loginUrl);
    }
  }
  let readiness = await waitForAlibabaTargetContent(page, targetUrl);
  body = readiness.body;
  if (readiness.ready) return body;
  if (!isAlibabaAuthGate(page, body) && !isBrowserErrorPage(page)) {
    await waitForAlibabaRequestSlot(page, options, "页面重新加载");
    await gotoWithTransientRetry(page, targetUrl);
    readiness = await waitForAlibabaTargetContent(page, targetUrl);
    body = readiness.body;
    if (readiness.ready) return body;
  }
  if (
    !options.headless &&
    !isAlibabaAuthGate(page, body) &&
    ["sf-item.taobao.com", "zc-item.taobao.com", "huodong.taobao.com"].includes(
      new URL(targetUrl).hostname,
    )
  ) {
    // A logged-out detail or PC-list request can land on a blank application
    // shell without any login wording. Open the official login page explicitly
    // so the user sees an actionable prompt, then resume the original target.
    await gotoWithTransientRetry(page, loginUrl);
    await page.waitForTimeout(1_500);
    body = await page.locator("body").innerText().catch(() => "");
  }
  if (options.headless) {
    throw new Error(
      "阿里资产需要人工登录或验证；请使用 --headed 运行，程序会打开 Edge 并等待登录完成。",
    );
  }

  if (isBrowserErrorPage(page)) {
    try {
      await gotoWithTransientRetry(page, loginUrl);
      await page.waitForTimeout(1_500);
      body = await page.locator("body").innerText().catch(() => "");
    } catch (error) {
      throw new Error(`淘宝登录页无法在 Edge 中打开：${error}`);
    }
  }
  if (!isAlibabaAuthGate(page, body)) {
    if (
      new URL(targetUrl).hostname === "huodong.taobao.com" &&
      isAlibabaPersonalHomeRedirectUrl(page.url())
    ) {
      await waitForAlibabaRequestSlot(page, options, "登录后返回PC列表");
      await gotoWithTransientRetry(page, targetUrl);
      readiness = await waitForAlibabaTargetContent(page, targetUrl);
      body = readiness.body;
      if (readiness.ready) return body;
    }
    if (
      isAlibabaDetailHost(new URL(targetUrl).hostname) &&
      isAlibabaPersonalHomeRedirectUrl(page.url())
    ) {
      const error = new Error(`ALIBABA_DETAIL_REDIRECTED_TO_PERSONAL_HOME:${page.url()}`);
      error.code = "ALIBABA_DETAIL_REDIRECTED_TO_PERSONAL_HOME";
      throw error;
    }
    throw new Error(`淘宝登录页未正常加载：${page.url()}`);
  }

  await tryAlibabaQuickLogin(page);
  body = await page.locator("body").innerText().catch(() => "");

  const waitMs = options.loginWaitMinutes * 60_000;
  const deadline = Date.now() + waitMs;
  console.log("AGENT_EVENT:USER_ACTION_REQUIRED:alibaba");
  console.log(
    `\n检测到阿里资产登录/验证页面。请在弹出的 Microsoft Edge 中完成淘宝登录；程序将自动检测并继续，最长等待 ${options.loginWaitMinutes} 分钟。\n`,
  );
  await showBrowserForUserAction(page);
  let lastLoginReload = 0;
  let lastTargetRetry = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("ALIBABA_AUTH_PAGE_CLOSED:验证标签页已关闭，需重建浏览器会话后续爬");
    }
    await page.waitForTimeout(1_500);
    body = await page.locator("body").innerText().catch(() => "");
    if (isBrowserErrorPage(page)) {
      if (Date.now() - lastLoginReload > 10_000) {
        lastLoginReload = Date.now();
        await gotoWithTransientRetry(page, loginUrl).catch(() => {});
      }
      continue;
    }
    if (isAlibabaAuthGate(page, body)) continue;
    if (
      !page.url().includes("taobao.com") &&
      !page.url().includes("alibaba.com")
    ) {
      continue;
    }
    if (await hasAlibabaTargetContent(page, targetUrl, body)) {
      console.log("AGENT_EVENT:USER_ACTION_CLEARED:alibaba");
      console.log("淘宝登录/验证已确认，继续采集阿里资产。\n");
      await hideBrowserAfterUserAction(page);
      return body;
    }
    // 仅“离开验证页”并不能证明登录已成功。验证Cookie及跳转可能需要数秒
    // 才稳定；在等待期限内低频重开原目标页，直到真实列表/详情内容出现。
    const targetRetryMs = new URL(targetUrl).hostname === "huodong.taobao.com"
      ? 45_000
      : 5_000;
    if (Date.now() - lastTargetRetry < targetRetryMs) continue;
    lastTargetRetry = Date.now();
    await gotoWithTransientRetry(page, targetUrl).catch(() => {});
    await page.waitForTimeout(1_500);
    body = await page.locator("body").innerText().catch(() => "");
    if (
      !isAlibabaAuthGate(page, body) &&
      !isBrowserErrorPage(page) &&
      (await hasAlibabaTargetContent(page, targetUrl, body))
    ) {
      console.log("AGENT_EVENT:USER_ACTION_CLEARED:alibaba");
      console.log("淘宝登录/验证已确认，继续采集阿里资产。\n");
      await hideBrowserAfterUserAction(page);
      return body;
    }
    // 个人首页、空壳页或Cookie尚未生效时继续等待，不宣称验证成功，也不
    // 立即把后续六个组都记成失败。下一轮会再次检查并重开原目标页。
  }
  throw new Error(
    `等待淘宝登录超过 ${options.loginWaitMinutes} 分钟，未继续采集；登录状态未被修改或绕过。`,
  );
}

async function waitForAlibabaRequestSlot(page, options, action = "请求") {
  if (!options.lowFrequency || !options.requestIntervalMs) {
    ALIBABA_LAST_REQUEST.set(page, Date.now());
    return;
  }
  const previous = ALIBABA_LAST_REQUEST.get(page) || 0;
  const waitMs = Math.max(0, options.requestIntervalMs - (Date.now() - previous));
  if (waitMs >= 1_000) {
    console.log(
      `阿里资产低频模式：${action}前等待 ${(waitMs / 1_000).toFixed(1)} 秒。`,
    );
  }
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  ALIBABA_LAST_REQUEST.set(page, Date.now());
}

async function exactFilterHref(page, label, excludedSelector) {
  return page
    .evaluate(
      ({ target, excluded }) => {
        const normalized = (value) => String(value || "").replace(/\s+/g, "");
        for (const node of document.querySelectorAll("a[href]")) {
          if (excluded && node.closest(excluded)) continue;
          if (normalized(node.textContent) === normalized(target)) {
            return node.href;
          }
        }
        return "";
      },
      { target: label, excluded: excludedSelector },
    )
    .catch(() => "");
}

async function clickExactFilterText(page, label, excludedSelector) {
  const candidates = page.getByText(label, { exact: true });
  const count = Math.min(await candidates.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const usable = await candidate
      .evaluate(
        (node, excluded) => {
          if (excluded && node.closest(excluded)) return false;
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        },
        excludedSelector,
      )
      .catch(() => false);
    if (!usable) continue;
    const clicked = await candidate
      .click({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) continue;
    await page.waitForTimeout(1_500);
    return true;
  }
  return false;
}

async function dispatchExactFilterText(page, label, excludedSelector) {
  return page
    .evaluate(
      ({ target, excluded }) => {
        const normalized = (value) => String(value || "").replace(/\s+/g, "");
        const selectors = ["li", "a", "button", "span", "div"];
        for (const selector of selectors) {
          for (const node of document.querySelectorAll(selector)) {
            if (excluded && node.closest(excluded)) continue;
            if (normalized(node.textContent) !== normalized(target)) continue;
            const clickable =
              node.closest("li") || node.closest("a") || node.closest("button") || node;
            clickable.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
              }),
            );
            return true;
          }
        }
        return false;
      },
      { target: label, excluded: excludedSelector },
    )
    .catch(() => false);
}

function jdActionDelayMs(randomValue = Math.random()) {
  const bounded = Math.min(1, Math.max(0, Number(randomValue) || 0));
  return Math.round(
    JD_ACTION_DELAY_MIN_MS +
      bounded * (JD_ACTION_DELAY_MAX_MS - JD_ACTION_DELAY_MIN_MS),
  );
}

async function waitForJdAction(page, label) {
  const delay = jdActionDelayMs();
  console.log(`京东低频模式：${label}前等待 ${(delay / 1_000).toFixed(1)} 秒。`);
  await page.waitForTimeout(delay);
}

async function settleBrowserAction(promise, timeoutMs = 3_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// 后台采集窗口平时最小化。检测到登录或安全认证时恢复整个浏览器窗口。
async function showBrowserForUserAction(page) {
  let session = null;
  try {
    session = await page.context().newCDPSession(page);
    const targetWindow = await settleBrowserAction(
      session.send("Browser.getWindowForTarget"),
    );
    if (targetWindow?.windowId) {
      await settleBrowserAction(session.send("Browser.setWindowBounds", {
        windowId: targetWindow.windowId,
        bounds: { windowState: "normal", left: 120, top: 80, width: 1280, height: 850 },
      }));
    }
  } catch (error) {
    console.warn(`无法自动显示人工验证窗口：${error?.message || error}`);
  } finally {
    await settleBrowserAction(session?.detach().catch(() => {}) || Promise.resolve());
  }
  await settleBrowserAction(page.bringToFront()).catch((error) => {
    console.warn(`无法自动置前人工验证页面：${error?.message || error}`);
  });
}

async function hideBrowserAfterUserAction(page) {
  try {
    const session = await page.context().newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await session.detach();
  } catch {}
}

function isJdAuthGate(page, text) {
  return (
    /(?:verify|captcha|risk|safe|passport|login)/i.test(page.url()) ||
    /安全验证|请完成验证|拖动滑块|滑块验证|认证后继续|访问过于频繁|京东登录/.test(
      String(text || "").slice(0, 1800),
    )
  );
}

async function waitForJdAuthClear(page, options) {
  let body = await page.locator("body").innerText().catch(() => "");
  if (!isJdAuthGate(page, body)) return false;
  if (options.headless) {
    throw new Error("京东触发安全认证；请改用可见Edge窗口人工完成认证。");
  }
  console.log(
    `京东触发安全认证，请在Edge中人工完成；程序最多等待 ${options.loginWaitMinutes} 分钟。认证完成后会重新检查并恢复筛选。`,
  );
  console.log("AGENT_EVENT:USER_ACTION_REQUIRED:jd");
  await showBrowserForUserAction(page);
  const deadline = Date.now() + options.loginWaitMinutes * 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000);
    body = await page.locator("body").innerText().catch(() => "");
    if (!isJdAuthGate(page, body)) {
      console.log("AGENT_EVENT:USER_ACTION_CLEARED:jd");
      console.log("京东登录/验证已完成，继续采集京东拍卖。");
      await hideBrowserAfterUserAction(page);
      return true;
    }
  }
  throw new Error("等待京东人工认证超时，已停止本次采集且不推进高水位。");
}

async function jdListReady(page) {
  const shellReady = await page.locator(".s-location").first().isVisible().catch(() => false);
  if (!shellReady) return false;
  const body = await page.locator("body").innerText().catch(() => "");
  return /住宅用房|商业用房|工业用房/u.test(body);
}

async function waitForJdListReady(page, targetUrl, options) {
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    await page.locator(".s-location").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    const body = await page.locator("body").innerText().catch(() => "");
    const access = classifyJdAccessSnapshot({
      listReady: await jdListReady(page),
      authGate: isJdAuthGate(page, body),
    });
    if (access === "ready") return attempt > 0;
    if (access === "auth_required") {
      await waitForJdAuthClear(page, options);
      continue;
    }
    if (attempt === 3) break;
    await waitForJdAction(page, `京东列表加载重试 ${attempt + 1}/3`);
    await gotoWithTransientRetry(page, targetUrl);
    await page.waitForTimeout(1_500);
    await waitForJdAuthClear(page, options);
  }
  throw new Error(`京东列表连续3次未完整加载：${page.url()}。已保留断点，本次不推进高水位。`);
}

function isGlobalListSessionFailure(error) {
  return /Target page, context or browser has been closed|ALIBABA_AUTH_PAGE_CLOSED|淘宝登录页|需要人工登录|登录\/验证页|chrome-error:\/\/chromewebdata/iu.test(String(error || ""));
}

function jdFilterPlan(statusFilter) {
  if (!STATUS_FILTERS.includes(statusFilter)) {
    throw new Error(`不支持的京东状态：${statusFilter}`);
  }
  return {
    projectControls: [
      { label: "竞价项目", selected: true },
      { label: "招商项目", selected: false },
      { label: "报价项目", selected: false },
    ],
    assetNatureControls: [
      { label: "诉讼资产", selected: true },
      { label: "刑案资产", selected: true },
    ],
    stateControls:
      statusFilter === "已结束"
        ? [
            { label: "预告中", code: "notice", selected: false },
            { label: "已结束", code: "end", selected: true },
          ]
        : [
            { label: "已结束", code: "end", selected: false },
            { label: "预告中", code: "notice", selected: true },
          ],
    sortLabel: statusFilter === "已结束" ? "结束时间" : "最新发布",
    sortClicks: statusFilter === "已结束" ? 2 : 1,
    expectedSort:
      statusFilter === "已结束" ? "结束时间由近到远" : "最新发布",
  };
}

async function inspectJdFilterControl(page, label, clstagToken = "") {
  return page
    .evaluate(
      ({ targetLabel, token }) => {
        const compact = (value) => String(value || "").replace(/\s+/g, "");
        const visible = (node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        let node = token
          ? [...document.querySelectorAll("[clstag]")].find((candidate) =>
              String(candidate.getAttribute("clstag") || "").includes(token),
            )
          : null;
        if (!node) {
          const candidates = [
            ...document.querySelectorAll("[clstag],label,li,a,span"),
          ].filter(
            (candidate) =>
              compact(candidate.textContent) === compact(targetLabel) &&
              !candidate.closest(".goods-list-container,.related-goods") &&
              visible(candidate),
          );
          node =
            candidates.find((candidate) =>
              String(candidate.getAttribute("clstag") || "").includes(
                "AuctionSearch",
              ),
            ) || candidates[0];
        }
        if (!node) return { found: false, selected: null };
        const roots = [
          node,
          node.closest("[clstag]"),
          node.closest("label"),
          node.closest("li"),
          node.parentElement,
        ].filter(Boolean);
        const input = roots
          .map((root) =>
            root.matches?.('input[type="checkbox"],input[type="radio"]')
              ? root
              : root.querySelector?.(
                  'input[type="checkbox"],input[type="radio"]',
                ),
          )
          .find(Boolean);
        if (input) {
          return { found: true, selected: Boolean(input.checked) };
        }
        for (const root of roots) {
          const aria =
            root.getAttribute?.("aria-checked") ||
            root.getAttribute?.("aria-selected");
          if (aria === "true") return { found: true, selected: true };
          if (aria === "false") return { found: true, selected: false };
          const className = String(root.className || "");
          if (/(?:^|\s)(?:curr|current|selected|checked|active)(?:\s|$)/i.test(className)) {
            return { found: true, selected: true };
          }
        }
        return { found: true, selected: false };
      },
      { targetLabel: label, token: clstagToken },
    )
    .catch(() => ({ found: false, selected: null }));
}

async function setJdFilterControl(
  page,
  { label, selected, clstagToken = "" },
  options,
) {
  const before = await inspectJdFilterControl(page, label, clstagToken);
  if (!before.found) return false;
  if (before.selected === selected) return true;
  await waitForJdAction(page, `勾选“${label}”`);
  const clicked = await page
    .evaluate(
      ({ targetLabel, token }) => {
        const compact = (value) => String(value || "").replace(/\s+/g, "");
        let node = token
          ? [...document.querySelectorAll("[clstag]")].find((candidate) =>
              String(candidate.getAttribute("clstag") || "").includes(token),
            )
          : null;
        if (!node) {
          node = [
            ...document.querySelectorAll("[clstag],label,li,a,span"),
          ].find(
            (candidate) =>
              compact(candidate.textContent) === compact(targetLabel) &&
              !candidate.closest(".goods-list-container,.related-goods"),
          );
        }
        if (!node) return false;
        const root =
          node.closest("[clstag]") ||
          node.closest("label") ||
          node.closest("li") ||
          node;
        const target =
          root.querySelector?.('input[type="checkbox"],input[type="radio"]') ||
          root.querySelector?.("a") ||
          node.closest("a") ||
          node;
        target.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );
        return true;
      },
      { targetLabel: label, token: clstagToken },
    )
    .catch(() => false);
  if (!clicked) return false;
  await page.waitForTimeout(1_500);
  await waitForJdAuthClear(page, options);
  const after = await inspectJdFilterControl(page, label, clstagToken);
  return after.found && after.selected === selected;
}

async function applyJdStatusFilter(page, statusFilter, options) {
  const plan = jdFilterPlan(statusFilter);
  for (const control of plan.stateControls) {
    const applied = await setJdFilterControl(page, {
      ...control,
      clstagToken: `AuctionSearch_screenState_${control.code}`,
    }, options);
    if (!applied) return false;
  }
  return true;
}

function shortLocationName(value = "") {
  return String(value).replace(/(?:特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/u, "");
}

function sameLocationSelection(actual = "", expected = "") {
  return shortLocationName(String(actual).trim()) === shortLocationName(String(expected).trim());
}

async function revealAlibabaCityFilters(page, province, city, excludedSelector) {
  if (!city) return true;
  const cityAlreadyPresent = await exactFilterHref(page, city, excludedSelector);
  if (cityAlreadyPresent) return true;
  const provinceCandidates = page.getByText(province, { exact: true });
  const count = Math.min(await provinceCandidates.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const candidate = provinceCandidates.nth(index);
    const usable = await candidate.evaluate((node, excluded) => {
      if (excluded && node.closest(excluded)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0
        && style.display !== "none" && style.visibility !== "hidden";
    }, excludedSelector).catch(() => false);
    if (!usable) continue;
    await candidate.hover({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await exactFilterHref(page, city, excludedSelector)) return true;
    await candidate.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1_200);
    if (await exactFilterHref(page, city, excludedSelector)) return true;
  }
  return false;
}

async function waitForJdLocationSelection(page, controlSelector, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const actual = await page.locator(controlSelector).first().locator("dt em").textContent().catch(() => "");
    if (sameLocationSelection(actual, expected)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function selectJdLocationControl(page, controlSelector, expected, suffix, options) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    // JD rebuilds the location filter DOM after every selection. Resolve a
    // fresh control on every attempt instead of retaining a stale locator.
    const control = page.locator(controlSelector).first();
    await control.locator("dt").waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    const current = await control.locator("dt em").textContent().catch(() => "");
    if (sameLocationSelection(current, expected)) return true;
    await waitForJdAction(page, `选择${expected}`);
    const opened = await control.locator("dt").click({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (!opened) continue;
    await control.locator("dd").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
    const target = control.locator("dd a").filter({ hasText: new RegExp(`^${expected}(?:${suffix})?$`, "u") }).first();
    if (!(await target.isVisible().catch(() => false))) continue;
    const selected = await target.click({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (!selected) continue;
    await waitForJdAuthClear(page, options);
    if (await waitForJdLocationSelection(page, controlSelector, expected)) return true;
  }
  return false;
}

async function chooseJdLocation(page, options) {
  const province = shortLocationName(options.province || "福建省");
  const city = shortLocationName(options.city || "");
  if (!(await selectJdLocationControl(page, ".s-location .province", province, "省", options))) return false;
  if (city && !(await selectJdLocationControl(page, ".s-location .city", city, "市", options))) return false;
  return true;
}

function jdCategoryControls(categoryScope) {
  const selected = new Set(Array.isArray(categoryScope) ? categoryScope : [categoryScope]);
  return Object.keys(CATEGORIES).map((category) => ({
    label: category,
    selected: selected.has(category),
    clstagToken: `AuctionSearch_screenCategory_${CATEGORIES[category]}`,
  }));
}

async function applyJdBaseFilters(page, categoryScope, options) {
  // Selecting province/city rebuilds JD's filter panel and may clear filters
  // chosen before it. Location must therefore be established first.
  if (!(await chooseJdLocation(page, options))) return false;
  const plan = jdFilterPlan("即将开始");
  for (const control of [
    ...plan.projectControls,
    ...plan.assetNatureControls,
  ]) {
    if (!(await setJdFilterControl(page, control, options))) return false;
  }
  for (const control of jdCategoryControls(categoryScope)) {
    if (!(await setJdFilterControl(page, control, options))) return false;
  }
  const finalProvince = await page.locator(".s-location .province dt em").textContent().catch(() => "");
  const finalCity = await page.locator(".s-location .city").first().locator("dt em").textContent().catch(() => "");
  return sameLocationSelection(finalProvince, options.province || "福建省")
    && (!options.city || sameLocationSelection(finalCity, options.city));
}

async function applyJdSortFilter(page, statusFilter, options) {
  const plan = jdFilterPlan(statusFilter);
  for (let clickIndex = 0; clickIndex < plan.sortClicks; clickIndex += 1) {
    let control =
      statusFilter === "即将开始"
        ? page
            .locator('[clstag*="AuctionSearch_AudittimeRank"]')
            .first()
        : page
            .getByText("结束时间", { exact: true })
            .filter({ visible: true })
            .first();
    if (!(await control.count().catch(() => 0))) {
      control = page
        .getByText(plan.sortLabel, { exact: true })
        .filter({ visible: true })
        .first();
    }
    await waitForJdAction(
      page,
      `第${clickIndex + 1}次点击“${plan.sortLabel}”排序`,
    );
    const clicked = await control
      .click({ timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return "";
    await page.waitForTimeout(1_500);
    await waitForJdAuthClear(page, options);
  }
  return plan.expectedSort;
}

async function inspectJdSortFingerprint(page, statusFilter) {
  const plan = jdFilterPlan(statusFilter);
  let control = statusFilter === "即将开始"
    ? page.locator('[clstag*="AuctionSearch_AudittimeRank"]').first()
    : page.getByText("结束时间", { exact: true }).filter({ visible: true }).first();
  if (!(await control.count().catch(() => 0))) {
    control = page.getByText(plan.sortLabel, { exact: true }).filter({ visible: true }).first();
  }
  return control.evaluate((node) => {
    const root = node.closest("a,li") || node;
    return JSON.stringify({
      className: String(root.className || ""),
      ariaCurrent: root.getAttribute("aria-current") || "",
      ariaPressed: root.getAttribute("aria-pressed") || "",
      ariaSelected: root.getAttribute("aria-selected") || "",
      html: root.innerHTML.replace(/\s+/g, " ").trim(),
    });
  }).catch(() => "");
}

async function applyJdIncrementalCategoryConfiguration(page, categoryScope, statusFilter, options) {
  const sortBefore = await inspectJdSortFingerprint(page, statusFilter);
  if (!sortBefore) return false;
  const baseApplied = await applyJdBaseFilters(page, categoryScope, options);
  const statusApplied = baseApplied && await applyJdStatusFilter(page, statusFilter, options);
  const verified = statusApplied
    && await verifyJdListConfiguration(page, categoryScope, statusFilter, options);
  const sortAfter = verified ? await inspectJdSortFingerprint(page, statusFilter) : "";
  return Boolean(verified && sortAfter && sortAfter === sortBefore);
}

async function verifyJdListConfiguration(page, categoryScope, statusFilter, options) {
  const plan = jdFilterPlan(statusFilter);
  for (const control of [
    ...plan.projectControls,
    ...plan.assetNatureControls,
    ...plan.stateControls.map((item) => ({
      ...item,
      clstagToken: `AuctionSearch_screenState_${item.code}`,
    })),
    ...jdCategoryControls(categoryScope),
  ]) {
    const state = await inspectJdFilterControl(
      page,
      control.label,
      control.clstagToken || "",
    );
    if (!state.found || state.selected !== control.selected) return false;
  }
  const location = await page
    .locator(".s-location .province dt em")
    .textContent()
    .catch(() => "");
  const provinceOk = sameLocationSelection(location, options.province || "福建省");
  if (!provinceOk) return false;
  if (!options.city) return true;
  const selectedCity = await page.locator(".s-location .city").first().locator("dt em").textContent().catch(() => "");
  return sameLocationSelection(selectedCity, options.city);
}

async function diagnoseJdListConfiguration(page, categoryScope, statusFilter, options) {
  const plan = jdFilterPlan(statusFilter);
  const controls = [];
  for (const control of [
    ...plan.projectControls,
    ...plan.assetNatureControls,
    ...plan.stateControls.map((item) => ({ ...item, clstagToken: `AuctionSearch_screenState_${item.code}` })),
    ...jdCategoryControls(categoryScope),
  ]) {
    const actual = await inspectJdFilterControl(page, control.label, control.clstagToken || "");
    controls.push(`${control.label}:${actual.found ? (actual.selected ? "已选" : "未选") : "未找到"}/期望${control.selected ? "已选" : "未选"}`);
  }
  const province = await page.locator(".s-location .province dt em").textContent().catch(() => "未找到");
  const city = await page.locator(".s-location .city").first().locator("dt em").textContent().catch(() => "未找到");
  const locationHtml = await page.locator(".s-location").first().evaluate((node) => node.outerHTML.slice(0, 1800)).catch(() => "");
  return `省份=${String(province).trim()}；城市=${String(city).trim()}；${controls.join("；")}；所在地结构=${locationHtml.replace(/\s+/g, " ")}`;
}

async function applyJdListConfiguration(
  page,
  category,
  statusFilter,
  options,
) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const baseApplied = await applyJdBaseFilters(page, category, options);
    const statusApplied =
      baseApplied &&
      (await applyJdStatusFilter(page, statusFilter, options));
    const sortApplied =
      statusApplied &&
      (await applyJdSortFilter(page, statusFilter, options));
    const verified =
      sortApplied &&
      (await verifyJdListConfiguration(page, category, statusFilter, options));
    if (verified) return true;
    if (attempt === 1) {
      console.log(
        "京东认证或页面刷新后筛选状态未保持，将按原顺序重新勾选一次。",
      );
      await waitForJdAction(page, "重新建立筛选条件");
    }
  }
  return false;
}

async function applyAlibabaStatusFilter(page, statusFilter, options) {
  const excluded = ".sf-item-list,.pai-item";
  const href = await exactFilterHref(page, statusFilter, excluded);
  if (href) {
    await navigateAlibaba(page, href, options);
    return true;
  }
  const clicked = await clickExactFilterText(page, statusFilter, excluded);
  const dispatched =
    clicked ||
    (await dispatchExactFilterText(page, statusFilter, excluded));
  if (dispatched) {
    if (!clicked) await page.waitForTimeout(1_500);
    const body = await page.locator("body").innerText().catch(() => "");
    if (isAlibabaAuthGate(page, body)) {
      await navigateAlibaba(page, page.url(), options);
    }
    return true;
  }
  return false;
}

async function applyAlibabaSortFilter(page, statusFilter, options) {
  const labels =
    statusFilter === "已结束"
      ? ["结拍时间由近到远", "结束时间由近到远"]
      : ["最新发布"];
  const excluded = ".sf-item-list,.pai-item";
  for (const label of labels) {
    const href = await exactFilterHref(page, label, excluded);
    if (href) {
      await navigateAlibaba(page, href, options);
      return label;
    }
    const clicked = await clickExactFilterText(page, label, excluded);
    const dispatched =
      clicked ||
      (await dispatchExactFilterText(page, label, excluded));
    if (dispatched) {
      if (!clicked) await page.waitForTimeout(1_500);
      const body = await page.locator("body").innerText().catch(() => "");
      if (isAlibabaAuthGate(page, body)) {
        await navigateAlibaba(page, page.url(), options);
      }
      return label;
    }
  }
  return "";
}

function buildAlibabaPcListUrl({
  province = "福建省",
  city = "",
  categories = Object.keys(CATEGORIES),
  includeBankruptcy = true,
  statusFilter = "即将开始",
  page = 1,
} = {}) {
  const locationCode = ALIBABA_PC_LOCATION_CODES[city]
    || ALIBABA_PC_LOCATION_CODES[province]
    || ALIBABA_PC_LOCATION_CODES["福建省"];
  const purposeIds = categories.map((category) => ALIBABA_PC_PROPERTY_IDS[category]).filter(Boolean).sort();
  if (!purposeIds.length) throw new Error("阿里资产（PC端）至少需要选择一种物业类型");
  const url = new URL(ALIBABA_PC_LIST_URL);
  url.searchParams.set("fcatV4Ids", JSON.stringify(["206058503"]));
  url.searchParams.set("zcBizTypes", JSON.stringify(includeBankruptcy ? ["6", "4", "8"] : ["6", "4"]));
  url.searchParams.set("locationCodes", JSON.stringify([locationCode]));
  url.searchParams.set("hPurpose", JSON.stringify(purposeIds));
  url.searchParams.set("structFieldMap", JSON.stringify({ hPurpose: purposeIds }));
  if (statusFilter === "即将开始") {
    url.searchParams.set("sort", "504");
    url.searchParams.set("statusOrders", JSON.stringify(["1"]));
  } else {
    url.searchParams.set("sort", "600");
    url.searchParams.set("statusOrders", JSON.stringify(["2"]));
  }
  url.searchParams.set("page", String(page));
  return url.toString();
}

function alibabaPcFilterMismatches(actualValue, expectedValue) {
  const actual = new URL(actualValue);
  const expected = new URL(expectedValue);
  const mismatches = [];
  for (const key of ["fcatV4Ids", "zcBizTypes", "locationCodes", "hPurpose", "statusOrders", "page"]) {
    if (actual.searchParams.get(key) !== expected.searchParams.get(key)) mismatches.push(key);
  }
  if (actual.searchParams.get("sort") !== expected.searchParams.get("sort")) mismatches.push("sort");
  return mismatches;
}

function verifyAlibabaPcListUrl(actualValue, expectedValue) {
  return alibabaPcFilterMismatches(actualValue, expectedValue).length === 0;
}

function isAlibabaPcPaginationOnlyMismatch(mismatches, pageNumber) {
  return pageNumber > 1 && mismatches.length === 1 && mismatches[0] === "page";
}

function classifyAlibabaPcCategory(text, selectedCategories = Object.keys(CATEGORIES)) {
  const source = String(text || "")
    .replace(/(?:市场价|评估价|起拍价|当前价)\s*[：:]?[^\n]*/gu, "")
    .replace(/(?:市场价|评估价|起拍价|当前价)/gu, "");
  const candidates = [];
  if (/工业|厂房|车间|仓库|仓储|工业园|生产用房|研发楼/u.test(source)) candidates.push("工业用房");
  if (/商业用房|商业房地产|商业用途|商铺|店面|门面|写字楼|办公楼|酒店|宾馆|商场|商务用房/u.test(source)) candidates.push("商业用房");
  if (/住宅|住房|住家|公寓|别墅|套房|单元|居室|\d+室(?:\d+厅)?/u.test(source)) candidates.push("住宅用房");
  const selected = candidates.find((category) => selectedCategories.includes(category));
  if (selected) return { category: selected, confidence: candidates.length === 1 ? "high" : "medium" };
  if (selectedCategories.length === 1) return { category: selectedCategories[0], confidence: "medium" };
  return { category: "", confidence: "low" };
}

function inferAlibabaPcTitle(text) {
  const lines = String(text || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const metadataIndex = lines.findIndex((line) => /\d+(?:\.\d+)?\s*(?:㎡|m²|m2|平方米)/iu.test(line) && line.includes("|"));
  if (metadataIndex > 0) return lines[metadataIndex - 1];
  return lines.find((line) => line.length > 8 && !/低于评估价|支持贷款|次围观|人报名/u.test(line)) || "";
}

function parseAlibabaPcCardText(text, selectedCategories = Object.keys(CATEGORIES)) {
  const normalized = String(text || "").replace(/\r/g, "");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const metadataLine = lines.find((line) => /\d+(?:\.\d+)?\s*(?:㎡|m²|m2|平方米)/iu.test(line) && line.includes("|")) || "";
  const metadata = metadataLine.split("|").map((part) => part.trim()).filter(Boolean);
  const areaMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|m2|平方米)/iu);
  const room = metadata.find((part) => /\d+室(?:\d+厅)?/u.test(part)) || "";
  const locationNames = new Set(Object.entries(FUJIAN_AREAS).flatMap(([city, areas]) => [
    city, shortLocationName(city), city.replace(/[市区县]$/u, ""),
    ...areas, ...areas.map(shortLocationName), ...areas.map((item) => item.replace(/[市区县]$/u, "")),
  ]));
  const community = metadata.find((part) => part !== room && !/\d+(?:\.\d+)?\s*(?:㎡|m²|m2|平方米)/iu.test(part)
    && !locationNames.has(part) && !/(?:省|市|区|县|旗)$/.test(part)) || "";
  const assessmentEvidence = extractAssessmentPrice(normalized);
  const currentMatch = normalized.match(/(?:当前价|起拍价)\s*[：:]?\s*[¥￥]?\s*([\d,.]+)\s*(万|元)?/u);
  const bidMatch = normalized.match(/\((\d+)\s*次出价\)/u) || normalized.match(/(\d+)\s*次出价/u);
  const category = classifyAlibabaPcCategory(normalized, selectedCategories);
  return {
    area: areaMatch ? Number(areaMatch[1]) : null,
    community,
    room,
    assessmentPrice: assessmentEvidence?.value ?? null,
    currentPrice: currentMatch ? parseMoney(`${currentMatch[1]}${currentMatch[2] || ""}`) : null,
    bidCount: bidMatch ? Number(bidMatch[1]) : null,
    category: category.category,
    categoryConfidence: category.confidence,
    rawText: normalized.slice(0, 4_000),
  };
}

async function alibabaPcVisibleFilterControlsMatch(page, statusFilter, categoryScope) {
  const labels = statusFilter === "已结束"
    ? ["已结束", "按拍卖时间排序"]
    : ["即将开始", "最新发布"];
  const categories = (Array.isArray(categoryScope) ? categoryScope : [categoryScope])
    .map((category) => String(category || "").replace(/用房$/u, ""));
  return page.evaluate(({ expectedLabels, expectedCategories }) => {
    const normalized = (value) => String(value || "").replace(/\s+/gu, "").trim();
    const visible = (node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden"
        && rect.width > 0 && rect.height > 0;
    };
    const nodes = [...document.querySelectorAll("button,a,span,div,li")]
      .filter((node) => !node.closest('a[href*="/sf_item/"],a[href*="sf-item.taobao.com"]'));
    const labelsMatch = expectedLabels.every((label) => nodes.some(
      (node) => visible(node) && normalized(node.textContent) === normalized(label),
    ));
    const propertyInputs = [...document.querySelectorAll('input[type="checkbox"]')]
      .map((input) => ({
        input,
        text: normalized(input.closest("label")?.textContent || input.parentElement?.textContent),
      }))
      .filter(({ text }) => ["住宅", "商业", "工业"].some((name) => text.includes(name)));
    const categoriesMatch = !propertyInputs.length || propertyInputs.every(({ input, text }) => {
      const category = ["住宅", "商业", "工业"].find((name) => text.includes(name));
      return Boolean(input.checked) === expectedCategories.includes(category);
    });
    return labelsMatch && categoriesMatch;
  }, { expectedLabels: labels, expectedCategories: categories }).catch(() => false);
}

async function scanAlibabaPc(page, categoryScope, statusFilter, anchor, options) {
  const found = [];
  let anchorFound = !anchor;
  let anchorMatchMode = anchor ? "" : "no_anchor";
  let matchedAnchor = "";
  let firstUrl = "";
  let listExhausted = false;
  const seenUrls = new Set();
  const itemSelector = ALIBABA_PC_ITEM_SELECTOR;
  for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
    let paginationOnlyMismatch = false;
    const listUrl = buildAlibabaPcListUrl({
      province: options.province,
      city: options.city,
      categories: options.categories,
      includeBankruptcy: options.includeBankruptcy,
      statusFilter,
      page: pageNumber,
    });
    await navigateAlibaba(page, listUrl, options);
    if (!verifyAlibabaPcListUrl(page.url(), listUrl)) {
      const mismatches = alibabaPcFilterMismatches(page.url(), listUrl);
      paginationOnlyMismatch = isAlibabaPcPaginationOnlyMismatch(mismatches, pageNumber);
      if (!paginationOnlyMismatch) {
        throw new Error(`阿里资产（PC端）筛选参数未保持（${mismatches.join("、")}），已停止${options.city || options.province}/${statusFilter}采集；当前页面：${page.url()}`);
      }
    }
    let body = "";
    let itemCount = 0;
    const resultDeadline = Date.now() + 20_000;
    while (Date.now() < resultDeadline) {
      body = await page.locator("body").innerText().catch(() => "");
      itemCount = await countAlibabaPcResultLinks(page).catch(() => 0);
      if (itemCount || isExplicitEmptyList(body)) break;
      await page.waitForTimeout(750);
    }
    const controlsMatch = await alibabaPcVisibleFilterControlsMatch(page, statusFilter, options.categories);
    if (false && !controlsMatch && !options.alibabaPcFilterRecoveryAttempted) {
      console.log(
        `阿里资产（PC端）${options.city || options.province}/${categoryScope}/${statusFilter}`
        + "实际筛选控件未保持，将强制重载目标列表一次。",
      );
      await waitForAlibabaRequestSlot(page, options, "恢复PC端筛选状态");
      await gotoWithTransientRetry(page, listUrl);
      return scanAlibabaPc(page, categoryScope, statusFilter, anchor, {
        ...options,
        alibabaPcFilterRecoveryAttempted: true,
      });
    }
    if (!itemCount && isExplicitEmptyList(body)) {
      anchorFound = true;
      anchorMatchMode = "verified_empty_list";
      listExhausted = true;
      break;
    }
    if (!itemCount) {
      throw new Error(
        `阿里资产（PC端）${options.city || options.province}/${categoryScope}/${statusFilter}`
        + `列表未加载出标的卡片；页面实际筛选状态${controlsMatch ? "已核验" : "未核验通过"}`,
      );
    }
    const rawItems = await page.locator(itemSelector).evaluateAll((nodes, recommendationSelector) => {
      const rows = [];
      const seen = new Set();
      for (const node of nodes) {
        if (node.closest(recommendationSelector)) continue;
        if (!node.href || seen.has(node.href)) continue;
        const container = node.closest("li") || node.closest('[class*="item"]') || node.closest('[class*="card"]') || node.parentElement;
        const text = (container?.innerText || node.innerText || "").trim();
        if (!text) continue;
        seen.add(node.href);
        const title = node.getAttribute("title")
          || container?.querySelector('h3,h2,[class*="title"]')?.textContent?.trim()
          || node.querySelector("img")?.getAttribute("alt")
          || text.split("\n").find((line) => line.trim().length > 8)
          || "";
        rows.push({ url: node.href, title, text });
      }
      return rows;
    }, ALIBABA_PC_RECOMMENDATION_SELECTOR);
    if (rawItems.length && rawItems.every((item) => !matchesStatusFilter(item.text, statusFilter))) {
      throw new Error(
        `阿里资产（PC端）${options.city || options.province}/${categoryScope}`
        + `筛选状态不一致：任务要求“${statusFilter}”，但当前卡片未显示该状态`,
      );
    }
    if (paginationOnlyMismatch) {
      const hasUnseenItem = rawItems.some((item) => !seenUrls.has(canonicalUrl(item.url)));
      if (!hasUnseenItem) {
        listExhausted = true;
        console.log(`阿里资产（PC端）${options.city || options.province}/${categoryScope}/${statusFilter}后续页回到前页且无新增链接，已安全判定列表到底。`);
        break;
      }
      console.log(`阿里资产（PC端）${options.city || options.province}/${categoryScope}/${statusFilter}分页参数未更新，但页面含新链接，继续按内容去重扫描。`);
    }
    const items = rawItems.filter((item) =>
      !String(item.url || "").includes("puimod-pc-search-recommend-list")
        && (options.includeBankruptcy !== false || !isAlibabaBankruptcyCardText(`${item.title}\n${item.text}`))
    ).map((item) => {
      const listEvidence = parseAlibabaPcCardText(item.text, options.categories);
      return {
        ...item,
        title: inferAlibabaPcTitle(item.text) || item.title,
        url: canonicalUrl(item.url),
        category: listEvidence.category,
        selectedCategories: [...options.categories],
        platform: "阿里资产",
        collectorPlatform: "alibaba_pc",
        statusGroup: statusFilter,
        listEvidence,
      };
    }).filter((item) => {
      if (seenUrls.has(item.url)) return false;
      seenUrls.add(item.url);
      return true;
    });
    if (!items.length && pageNumber > 1) {
      listExhausted = true;
      break;
    }
    const otherStatus = statusFilter === "即将开始" ? "已结束" : "即将开始";
    if (items.some((item) => item.text.includes(otherStatus) && !item.text.includes(statusFilter))) {
      throw new Error(`阿里资产（PC端）列表出现与${statusFilter}不一致的状态卡片，已停止写入`);
    }
    for (const item of items) {
      if (!firstUrl) firstUrl = item.url;
      const boundary = resolveAnchorBoundary(item.url, anchor, options.knownBoundaryUrls);
      if (boundary.matched) {
        anchorFound = true;
        anchorMatchMode = boundary.mode;
        matchedAnchor = boundary.url;
        break;
      }
      if (found.length < options.maxItems) found.push(item);
    }
    if (shouldStopListScan(anchor, anchorFound, found.length, options.maxItems)) break;
    if (items.length === 0) {
      listExhausted = true;
      break;
    }
  }
  if (anchor && !anchorFound && listExhausted) {
    anchorFound = true;
    anchorMatchMode = "full_list_exhausted";
  }
  return { items: found, firstUrl, anchorFound, anchorMatchMode, matchedAnchor, listExhausted };
}

function applyAlibabaPcPlatformMembership(items, memberships = {}) {
  const sets = Object.fromEntries(Object.entries(memberships).map(([category, urls]) => [
    category,
    new Set([...urls].map(canonicalUrl)),
  ]));
  return items.map((item) => {
    const url = canonicalUrl(item.url);
    const candidates = Object.entries(sets)
      .filter(([, urls]) => urls.has(url))
      .map(([category]) => category);
    if (candidates.length === 1) {
      const category = candidates[0];
      return {
        ...item,
        category,
        categorySource: "alibaba_pc_filter_membership",
        categoryConfidence: "high",
        categoryCandidates: candidates,
        categoryConflict: false,
        platformPropertyPurposeCode: ALIBABA_PC_PROPERTY_IDS[category] || "",
        listEvidence: {
          ...(item.listEvidence || {}),
          category,
          categoryConfidence: "high",
          categorySource: "alibaba_pc_filter_membership",
        },
      };
    }
    if (candidates.length > 1) {
      return {
        ...item,
        category: "",
        categorySource: "alibaba_pc_filter_conflict",
        categoryConfidence: "conflict",
        categoryCandidates: candidates,
        categoryConflict: true,
        platformPropertyPurposeCode: "",
      };
    }
    return {
      ...item,
      categorySource: item.category ? "keyword_fallback" : "unresolved",
      categoryConfidence: item.listEvidence?.categoryConfidence || "low",
      categoryCandidates: item.category ? [item.category] : [],
      categoryConflict: false,
      platformPropertyPurposeCode: "",
    };
  });
}

async function classifyAlibabaPcItemsByPlatform(page, items, statusFilter, options) {
  if (!items.length) return items;
  if (options.categories.length === 1) {
    return applyAlibabaPcPlatformMembership(items, {
      [options.categories[0]]: items.map((item) => item.url),
    });
  }
  const { targetUrls, checkpoint, memberships } = restorePcClassificationCheckpoint(
    items,
    options.categories,
    options.classificationCheckpoint,
  );
  const scanCategory = options.scanAlibabaForClassification || scanAlibabaPc;
  for (let index = 0; index < options.categories.length; index += 1) {
    const category = options.categories[index];
    const saved = checkpoint.memberships[category];
    if (saved?.status === "completed" && Array.isArray(saved.urls)) {
      memberships[category] = saved.urls.filter((url) => targetUrls.has(url));
      continue;
    }
    await options.onClassificationProgress?.({
      checkpoint: structuredClone(checkpoint),
      category,
      index: index + 1,
      total: options.categories.length,
    });
    const categoryScan = await scanCategory(page, category, statusFilter, "", {
      ...options,
      categories: [category],
      maxItems: items.length,
      knownBoundaryUrls: new Set(),
      classificationScan: true,
    });
    memberships[category] = categoryScan.items
      .map((item) => canonicalUrl(item.url))
      .filter((url) => targetUrls.has(url));
    checkpoint.memberships[category] = {
      status: "completed",
      urls: memberships[category],
      scannedAt: new Date().toISOString(),
      empty: memberships[category].length === 0,
    };
    const completed = options.categories.filter(
      (name) => checkpoint.memberships[name]?.status === "completed",
    ).length;
    checkpoint.status = completed === options.categories.length ? "completed" : "in_progress";
    checkpoint.completed = completed;
    await options.onClassificationCheckpoint?.({
      checkpoint: structuredClone(checkpoint),
      category,
      index: index + 1,
      total: options.categories.length,
    });
  }
  return applyAlibabaPcPlatformMembership(items, memberships);
}

async function scanJd(page, categoryScope, statusFilter, anchor, options) {
  const selectedCategories = Array.isArray(categoryScope) ? categoryScope : [categoryScope];
  const category = selectedCategories.join("、");
  const categoryId = selectedCategories.length === 1 ? CATEGORIES[selectedCategories[0]] : "";
  const url =
    `${JD_LIST_URL}?publishSource=7&projectType=&childrenCateId=${categoryId}`;
  let configured = false;
  if (options.reuseCurrentFilters && await jdListReady(page)) {
    console.log(`京东分类复扫：保留当前省市、状态和排序，仅切换为${category}。`);
    configured = await applyJdIncrementalCategoryConfiguration(
      page,
      selectedCategories,
      statusFilter,
      options,
    );
    if (!configured) {
      console.log("京东当前页面公共筛选未能稳定保持，将回退到完整列表重建。");
    }
  }
  if (!configured) {
    await waitForJdAction(page, `${category}/${statusFilter}列表页跳转`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    await waitForJdAuthClear(page, options);
    // The unfiltered industrial-property landing page can legitimately contain
    // zero cards. Wait for the filter shell first; the configured list is
    // validated after province, city, category and status have been applied.
    await waitForJdListReady(page, url, options);
    configured = await applyJdListConfiguration(
      page,
      selectedCategories,
      statusFilter,
      options,
    );
  }
  if (!configured) {
    const plan = jdFilterPlan(statusFilter);
    const diagnostic = await diagnoseJdListConfiguration(page, selectedCategories, statusFilter, options);
    throw new Error(
      `京东${category}未能稳定保持“竞价项目、诉讼资产、刑案资产、${options.province || "福建省"}${options.city ? `/${options.city}` : "/全省"}、${statusFilter === "即将开始" ? "仅预告中" : "仅已结束"}、${plan.expectedSort}”筛选，已停止该组采集。诊断：${diagnostic}`,
    );
  }
  const found = [];
  let anchorFound = !anchor;
  let anchorMatchMode = anchor ? "" : "no_anchor";
  let matchedAnchor = "";
  let firstUrl = "";
  let listExhausted = false;
  for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
    if (!(await verifyJdListConfiguration(page, selectedCategories, statusFilter, options))) {
      throw new Error(`京东列表第${pageNumber}页的省市或筛选条件已丢失，已停止以避免采集到范围外数据。`);
    }
    const itemSelector = ".goods-list-container > ul > li > a.goods-container";
    const listOutcome = await waitForJdListOutcome(page, itemSelector);
    if (listOutcome.kind === "empty") {
      // A verified, configured empty list is a successful zero-update scan.
      // Keep the previous anchor unchanged; do not require it to be present in
      // a list that contains no records.
      anchorFound = true;
      anchorMatchMode = listOutcome.reason;
      break;
    }
    if (listOutcome.kind !== "items") {
      throw new Error(`京东${category}、${statusFilter}列表在限定时间内未完成加载。`);
    }
    const items = await page
      .locator(itemSelector)
      .evaluateAll((nodes) =>
        nodes
          .filter((node) => !node.closest(".related-goods"))
          .map((node) => ({
            url: node.href,
            title: node.querySelector(".item-name")?.textContent?.trim() || "",
            location:
              node.querySelector(".item-location em")?.textContent?.trim() || "",
            price:
              node
                .querySelector(".item-price-curr")
                ?.textContent?.trim()
                .replace(/\s+/g, "") || "",
            assessment:
              node
                .querySelector(".item-price-assess")
                ?.textContent?.trim()
                .replace(/\s+/g, "") || "",
            status:
              node.querySelector(".item-status")?.textContent?.trim() || "",
          })),
      );
    if (!items.length) {
      throw new Error(`京东${category}（${statusFilter}）未找到列表项`);
    }
    for (const item of items) {
      item.url = canonicalUrl(item.url);
      const cardStatusMatches = matchesStatusFilter(item.status, statusFilter);
      if (item.status && !cardStatusMatches) {
        continue;
      }
      if (!firstUrl) firstUrl = item.url;
      const boundary = resolveAnchorBoundary(item.url, anchor, options.knownBoundaryUrls);
      if (boundary.matched) {
        anchorFound = true;
        anchorMatchMode = boundary.mode;
        matchedAnchor = boundary.url;
        break;
      }
      if (found.length < options.maxItems) {
        found.push({
          ...item,
          category: selectedCategories.length === 1 ? selectedCategories[0] : "",
          selectedCategories,
          platform: "京东拍卖",
          collectorPlatform: options.jdCombined ? "jd_pc" : "jd",
          statusGroup: statusFilter,
        });
      }
    }
    if (shouldStopListScan(anchor, anchorFound, found.length, options.maxItems)) break;
    const firstBefore = items[0]?.url;
    const next = page.locator(".ui-pager-next").first();
    if (!(await next.count())) {
      listExhausted = true;
      break;
    }
    await waitForJdAction(page, "列表翻页");
    await next.click({ timeout: 8_000 });
    const authCleared = await waitForJdAuthClear(page, options);
    if (authCleared) {
      throw new Error(
        "京东翻页时触发认证并清空筛选；已安全停止该组，重新运行后将重新建立筛选。",
      );
    }
    await page
      .waitForFunction(
        ({ selector, previous }) => {
          const node = document.querySelector(selector);
          return node && node.href !== previous;
        },
        {
          selector: ".goods-list-container > ul > li > a.goods-container",
          previous: firstBefore,
        },
        { timeout: 12_000 },
      )
      .catch(() => page.waitForTimeout(2_000));
  }
  if (anchor && !anchorFound && listExhausted) {
    anchorFound = true;
    anchorMatchMode = "full_list_exhausted";
  }
  return { items: found, firstUrl, anchorFound, anchorMatchMode, matchedAnchor, listExhausted };
}

function applyJdPcPlatformMembership(items, memberships = {}) {
  const sets = Object.fromEntries(Object.entries(memberships).map(([category, urls]) => [
    category,
    new Set([...urls].map(canonicalUrl)),
  ]));
  return items.map((item) => {
    const candidates = Object.entries(sets)
      .filter(([, urls]) => urls.has(canonicalUrl(item.url)))
      .map(([category]) => category);
    if (candidates.length === 1) {
      const category = candidates[0];
      return {
        ...item,
        category,
        categorySource: "jd_pc_filter_membership",
        categoryConfidence: "high",
        categoryCandidates: candidates,
        categoryConflict: false,
        platformPropertyPurposeCode: CATEGORIES[category],
      };
    }
    return {
      ...item,
      category: candidates.length > 1 ? "" : item.category,
      categorySource: candidates.length > 1 ? "jd_pc_filter_conflict" : "keyword_fallback",
      categoryConfidence: candidates.length > 1 ? "low" : (item.categoryConfidence || "low"),
      categoryCandidates: candidates,
      categoryConflict: candidates.length > 1,
    };
  });
}

function restorePcClassificationCheckpoint(items, categories, priorCheckpoint = {}) {
  const targetUrls = new Set(items.map((item) => canonicalUrl(item.url)));
  const candidateUrls = [...targetUrls].sort();
  const sameCandidates = Array.isArray(priorCheckpoint.candidateUrls)
    && priorCheckpoint.candidateUrls.length === candidateUrls.length
    && priorCheckpoint.candidateUrls.every((url, index) => url === candidateUrls[index]);
  const checkpoint = {
    schemaVersion: 1,
    candidateUrls,
    memberships: sameCandidates ? { ...(priorCheckpoint.memberships || {}) } : {},
    status: "in_progress",
    total: categories.length,
  };
  const memberships = Object.fromEntries(categories
    .filter((category) => checkpoint.memberships[category]?.status === "completed"
      && Array.isArray(checkpoint.memberships[category].urls))
    .map((category) => [
      category,
      checkpoint.memberships[category].urls.filter((url) => targetUrls.has(url)),
    ]));
  return { targetUrls, checkpoint, memberships };
}

async function classifyJdPcItemsByPlatform(page, items, statusFilter, options) {
  if (!items.length) return items;
  if (options.categories.length === 1) {
    return applyJdPcPlatformMembership(items, {
      [options.categories[0]]: items.map((item) => item.url),
    });
  }
  const { targetUrls, checkpoint, memberships } = restorePcClassificationCheckpoint(
    items,
    options.categories,
    options.classificationCheckpoint,
  );
  const scanCategory = options.scanJdForClassification || scanJd;
  for (let index = 0; index < options.categories.length; index += 1) {
    const category = options.categories[index];
    const saved = checkpoint.memberships[category];
    if (saved?.status === "completed" && Array.isArray(saved.urls)) {
      memberships[category] = saved.urls.filter((url) => targetUrls.has(url));
      continue;
    }
    await options.onClassificationProgress?.({
      checkpoint: structuredClone(checkpoint),
      category,
      index: index + 1,
      total: options.categories.length,
    });
    const categoryScan = await scanCategory(page, category, statusFilter, "", {
      ...options,
      jdCombined: false,
      categories: [category],
      maxItems: items.length,
      knownBoundaryUrls: new Set(),
      reuseCurrentFilters: true,
    });
    memberships[category] = categoryScan.items
      .map((item) => canonicalUrl(item.url))
      .filter((url) => targetUrls.has(url));
    checkpoint.memberships[category] = {
      status: "completed",
      urls: memberships[category],
      scannedAt: new Date().toISOString(),
    };
    const completed = options.categories.filter(
      (name) => checkpoint.memberships[name]?.status === "completed",
    ).length;
    checkpoint.status = completed === options.categories.length ? "completed" : "in_progress";
    checkpoint.completed = completed;
    await options.onClassificationCheckpoint?.({
      checkpoint: structuredClone(checkpoint),
      category,
      index: index + 1,
      total: options.categories.length,
    });
  }
  return applyJdPcPlatformMembership(items, memberships);
}

async function scanJdCombined(page, _categoryScope, statusFilter, anchor, options) {
  return scanJd(page, options.categories, statusFilter, anchor, {
    ...options,
    jdCombined: true,
  });
}

async function scanAlibabaCurrentList(
  page,
  category,
  statusFilter,
  anchor,
  options,
) {
  const found = [];
  let anchorFound = !anchor;
  let anchorMatchMode = anchor ? "" : "no_anchor";
  let matchedAnchor = "";
  let firstUrl = "";
  let listExhausted = false;
  const itemSelector =
    '.sf-item-list ul.sf-pai-item-list > li.pai-item > a.link-wrap[href*="/sf_item/"]';
  for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
    await waitForList(page, itemSelector);
    const items = await page
      .locator(itemSelector)
      .evaluateAll((nodes) => {
        const seen = new Set();
        const rows = [];
        for (const node of nodes) {
          if (seen.has(node.href)) continue;
          seen.add(node.href);
          const container =
            node.closest("li") ||
            node.closest('[class*="item"]') ||
            node.parentElement;
          const text = (container?.innerText || node.innerText || "")
            .trim()
            .replace(/\s+/g, " ");
          const title =
            node.getAttribute("title") ||
            container?.querySelector(".title")?.textContent?.trim() ||
            node.querySelector("img")?.getAttribute("alt") ||
            node.textContent?.trim() ||
            "";
          rows.push({
            url: node.href,
            title: title.replace(/\s*-\s*拍卖\s*$/, ""),
            text,
          });
        }
        return rows;
      });
    if (!items.length && isExplicitEmptyList(
      await page.locator("body").innerText().catch(() => ""),
    )) {
      listExhausted = true;
      break;
    }
    if (!items.length) {
      throw new Error(`阿里资产${category}（${statusFilter}）未找到列表项`);
    }
    for (const item of items) {
      item.url = canonicalUrl(item.url);
      if (!firstUrl) firstUrl = item.url;
      const boundary = resolveAnchorBoundary(item.url, anchor, options.knownBoundaryUrls);
      if (boundary.matched) {
        anchorFound = true;
        anchorMatchMode = boundary.mode;
        matchedAnchor = boundary.url;
        break;
      }
      if (found.length < options.maxItems) {
        found.push({
          ...item,
          category,
          platform: "阿里资产",
          statusGroup: statusFilter,
        });
      }
    }
    if (shouldStopListScan(anchor, anchorFound, found.length, options.maxItems)) break;
    const next = page
      .locator('a:has-text("下一页"),a.next,.pagination-next')
      .first();
    if (!(await next.count())) {
      listExhausted = true;
      break;
    }
    const disabled = await next
      .evaluate((node) => {
        const className = String(node.className || "");
        return (
          node.matches(":disabled") ||
          node.getAttribute("aria-disabled") === "true" ||
          /(?:^|\s)(?:disabled|is-disabled)(?:\s|$)/i.test(className)
        );
      })
      .catch(() => false);
    if (disabled) {
      listExhausted = true;
      break;
    }
    const previousFirstUrl = items[0]?.url || "";
    await waitForAlibabaRequestSlot(page, options, `${category}列表翻页`);
    await next.click({ timeout: 8_000 });
    const changed = await page
      .waitForFunction(
        ({ selector, previous }) => {
          const first = document.querySelector(selector);
          return Boolean(first?.href && first.href !== previous);
        },
        { selector: itemSelector, previous: previousFirstUrl },
        { timeout: 12_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!changed) {
      throw new Error(`阿里资产${category}（${statusFilter}）翻页后列表未变化，无法确认已经到达末页`);
    }
  }
  if (anchor && !anchorFound && listExhausted) {
    anchorFound = true;
    anchorMatchMode = "full_list_exhausted";
  }
  return { items: found, firstUrl, anchorFound, anchorMatchMode, matchedAnchor, listExhausted };
}

async function scanAlibaba(page, category, statusFilter, anchor, options) {
  const categoryId = ALIBABA_CATEGORY_IDS[category];
  let categoryUrl = ALIBABA_LIST_URL.replace(
    "/list/0____",
    `/list/${categoryId}____`,
  );
  // Alibaba's legacy Fujian list does not always expose prefecture links in
  // the live DOM. Use its own stable GBK city route when known, then verify
  // the selected location after navigation instead of depending on the flyout.
  const directCityRoutes = {
    福州: "%B8%A3%D6%DD",
    泉州: "%C8%AA%D6%DD",
  };
  const requestedCity = shortLocationName(options.city || "");
  if (directCityRoutes[requestedCity]) {
    categoryUrl = `https://sf.taobao.com/list/${categoryId}__2___${directCityRoutes[requestedCity]}.htm?auction_source=0&st_param=4&auction_start_seg=-1`;
  }
  await navigateAlibaba(page, categoryUrl, options);
  const requestedProvince = shortLocationName(options.province || "福建省");
  // 福建全省列表链接本身已经限定所在地；已选状态下再次点击“福建”反而找不到筛选项。
  if (requestedCity && !directCityRoutes[requestedCity]) {
    const revealed = await revealAlibabaCityFilters(
      page,
      requestedProvince || "福建",
      requestedCity,
      ".sf-item-list,.pai-item",
    );
    if (!revealed) {
      throw new Error(`阿里资产未能展开${requestedProvince || "福建"}的地级市筛选，无法选择：${requestedCity}`);
    }
  }
  const requestedLocations = [
    requestedProvince && requestedProvince !== "福建" ? requestedProvince : "",
    directCityRoutes[requestedCity] ? "" : requestedCity,
  ].filter(Boolean);
  for (const location of requestedLocations) {
    const excluded = ".sf-item-list,.pai-item";
    const href = await exactFilterHref(page, location, excluded);
    if (href) await navigateAlibaba(page, href, options);
    else {
      const clicked = (await clickExactFilterText(page, location, excluded))
        || (await dispatchExactFilterText(page, location, excluded));
      if (!clicked) throw new Error(`阿里资产未找到所在地筛选：${location}`);
      await page.waitForTimeout(1_500);
    }
  }
  const sortApplied = await applyAlibabaSortFilter(
    page,
    statusFilter,
    options,
  );
  if (!sortApplied) {
    const expectedSort =
      statusFilter === "已结束" ? "结拍时间由近到远" : "最新发布";
    throw new Error(
      `阿里资产${category}未找到“${expectedSort}”排序控件，已停止该组采集。`,
    );
  }
  const siteStatusApplied = await applyAlibabaStatusFilter(
    page,
    statusFilter,
    options,
  );
  if (!siteStatusApplied) {
    throw new Error(
      `阿里资产${category}未找到“${statusFilter}”状态筛选控件，已停止该组采集以避免写入错误分表。`,
    );
  }
  return scanAlibabaCurrentList(
    page,
    category,
    statusFilter,
    anchor,
    options,
  );
}

async function collectDetailAttachments(page) {
  const attachments = [];
  for (const frame of page.frames()) {
    const links = await frame.locator("a[href]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.href || "",
        text: (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim(),
      })).filter((item) =>
        /\.(?:pdf|docx?)(?:$|[?#])/i.test(item.href)
        || /评估报告|评估文件|评估附件|调查报告/i.test(item.text),
      ),
    ).catch(() => []);
    attachments.push(...links);
  }
  return [...new Map(attachments.filter((item) => item.href).map((item) => [item.href, item])).values()];
}

async function parseJdDetail(page, item, options) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await waitForJdAction(page, `打开京东详情页（${attempt}/2）`);
    await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForTimeout(2_500);
    await waitForJdAuthClear(page, options);
    if (canonicalUrl(page.url()) === canonicalUrl(item.url)) break;
    if (attempt === 2) {
      throw new Error(`京东认证后未返回目标详情页：${item.url}`);
    }
  }
  // JD loads investigation tables and announcement images lazily on a number
  // of detail pages. Read-only scrolling is required before collecting frame
  // text; otherwise a valid area may be reported as missing.
  await page
    .evaluate(async () => {
      const maxY = Math.min(document.body?.scrollHeight || 0, 30_000);
      for (let y = 0; y < maxY; y += 1_000) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(1_500);
  const documents = [];
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText().catch(() => "");
    const rows = await frame
      .locator("table tr")
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          Array.from(node.querySelectorAll("th,td"))
            .map((cell) => cell.innerText?.trim() || "")
            .filter(Boolean),
        ),
      )
      .catch(() => []);
    if (text || rows.length) documents.push({ text, rows });
  }
  const body = documents.map((document) => document.text).join("\n");
  const attachments = await collectDetailAttachments(page);
  const titleRaw =
    (await page.locator(".pm-name").first().innerText().catch(() => "")) ||
    (await page.locator("h1").first().innerText().catch(() => "")) ||
    item.title;
  const title = cleanAuctionTitle(titleRaw);
  const location =
    (await page.locator(".pm-location em").first().getAttribute("title").catch(() => "")) ||
    (await page.locator(".pm-location em").first().innerText().catch(() => "")) ||
    item.location;
  const court = await page.locator("#disposalUnitTag").first().innerText().catch(() => "");
  const stage = detectStage(titleRaw, body);
  const dates = resolveAuctionDates(body, stage);
  const jdStartPriceEvidence = extractStartPrice(body, stage);
  const startPrice = jdStartPriceEvidence?.value ?? null;
  // 两个平台均可能使用“评估价”或“市场价”。二者同时出现时以评估价为准。
  const jdAssessmentEvidence = extractAssessmentPrice(body);
  const jdListAssessmentPrice = parseMoney(item.assessment);
  const assessmentPrice = jdAssessmentEvidence?.value
    ?? (Number.isFinite(jdListAssessmentPrice) ? jdListAssessmentPrice : null);
  const resultPanel = await readJdResultPanel(page);
  const panelResult = interpretJdResult(
    resultPanel.status,
    parseMoney(resultPanel.transactionPrice),
  );
  const outcome =
    item.statusGroup === "已结束" ? panelResult.outcome : detectOutcome(body);
  const areaResult = extractAreaByPriority(documents, { title: titleRaw });
  const cleanedTitle = cleanPropertyTitle(title);
  const resolvedCategory = item.categoryConflict
    ? ""
    : item.collectorPlatform === "jd_pc" && !item.category
      ? classifyAlibabaPcCategory(`${cleanedTitle}\n${body}`, item.selectedCategories || options.categories).category
      : item.category;
  const propertyType = resolvedCategory ? classifyPropertyType(resolvedCategory, cleanedTitle) : "其他/待确认";
  const locationFields = splitLocation(location, title, court);
  const communityResult = extractCommunityNameWithEvidence({
    标的名称: cleanedTitle,
    原始标的名称: titleRaw,
    标的类型: propertyType,
    平台: "京东拍卖",
    _documents: documents,
    ...locationFields,
  });
  const statusGroup = resolveStatusGroup(item.statusGroup, outcome, dates);
  const participation = extractParticipation({
    documents,
    statusGroup,
    outcome,
    platform: "jd",
  });
  const record = {
    ...locationFields,
    标的名称: cleanedTitle,
    "小区名称（仅供参考）": communityResult.value,
    标的类型: propertyType,
    平台: "京东拍卖",
    发拍次数: stage,
    拍卖时间: statusGroup === "已结束" ? dates.end : dates.start,
    发拍时间: dates.start,
    竞拍结束时间: dates.end,
    是否成交: outcome,
    处置法院: extractCourt(body, court),
    "面积/㎡": areaResult.area ?? "未找到",
    备注: areaNoteFromResult(areaResult, { hasAssessmentAttachment: attachments.length > 0 }),
    ...(options.includeParties
      ? {
          债权人: extractParty(body, ["债权人", "申请执行人"]),
          债务人: extractParty(body, ["债务人", "被执行人", "标的物所有人"], [
            /被执行人\s*([^，。\n]{2,50}?)(?:名下|所有)/,
          ]),
        }
      : {}),
    起拍价格: startPrice ?? parseMoney(item.price),
    评估价: assessmentPrice,
    成交金额: outcome === "是" ? panelResult.amount : outcome === "否" ? 0 : 0,
    竞买记录: participation.bidCount,
    报名人数: participation.registrationCount,
    网站链接: canonicalUrl(item.url),
    _capturedAt: new Date().toISOString(),
    _sourceStatus: item.status || "",
    _状态分组: statusGroup,
    _源分类: resolvedCategory || "其他/待确认",
    _采集通道: item.collectorPlatform || "jd",
    _platformPropertyPurposeCode: item.platformPropertyPurposeCode || "",
    _platformPropertyPurposeLabel: resolvedCategory || "其他/待确认",
    _propertyTypeSource: item.categorySource || (item.collectorPlatform === "jd_pc" ? "keyword_fallback" : "legacy_category"),
    _propertyTypeConfidence: item.categoryConfidence || "low",
    _propertyTypeCandidates: item.categoryCandidates || (resolvedCategory ? [resolvedCategory] : []),
    _propertyTypeReviewRequired:
      !resolvedCategory
      || item.categoryConflict === true
      || (item.collectorPlatform === "jd_pc" && item.categorySource !== "jd_pc_filter_membership"),
    _areaSource: areaResult.source,
    _participationExtractionAttempted: statusGroup === "已结束",
    _attachments: attachments,
    _fieldEvidence: {
      标的名称: fieldEvidence({
        value: cleanedTitle,
        platform: "jd",
        section: "详情页标题",
        element: "标的名称",
        rawText: titleRaw,
        ruleId: "property-title-shared-v2",
        confidence: cleanedTitle ? "high" : "low",
        reviewRequired: !cleanedTitle,
      }),
      "小区名称（仅供参考）": communityResult.evidence,
      ...participation.evidence,
      "面积/㎡": fieldEvidence({
        value: areaResult.area,
        dataType: "number",
        unit: "㎡",
        platform: "jd",
        section: areaResult.source,
        element: "建筑面积",
        rawText: areaResult.rawText || areaResult.rawExpression || "",
        ruleId: areaResult.ruleId || "area-legacy-v1",
        confidence: areaResult.area === null ? "low" : areaResult.confidence || "high",
        conflicts: areaResult.conflicts || [],
        reviewRequired: areaResult.area === null || areaResult.reviewRequired === true,
      }),
      评估价: fieldEvidence({
        value: assessmentPrice,
        dataType: "number",
        unit: "元",
        platform: "jd",
        section: jdAssessmentEvidence ? "详情页竞价信息" : Number.isFinite(jdListAssessmentPrice) ? "列表页评估价格" : "详情页竞价信息",
        element: jdAssessmentEvidence?.label || (Number.isFinite(jdListAssessmentPrice) ? "列表评估价/市场价" : ""),
        rawText: jdAssessmentEvidence?.rawText || (Number.isFinite(jdListAssessmentPrice) ? String(item.assessment || "") : ""),
        ruleId: jdAssessmentEvidence?.label === "评估价"
          ? "jd-assessment-price-v2"
          : "jd-market-price-as-assessment-v2",
        confidence: jdAssessmentEvidence ? "high" : Number.isFinite(jdListAssessmentPrice) ? "medium" : "low",
        reviewRequired: !Number.isFinite(assessmentPrice),
      }),
    },
    _endTimeSource: dates.endSource,
  };
  record._missing = qualityFields(record, options.includeParties);
  return record;
}

async function readJdResultPanel(page) {
  const candidates = [];
  for (const frame of page.frames()) {
    const value = await frame
      .evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) !== 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom >= 0 &&
            rect.top <= 1500
          );
        };
        const text = (element) => (element.innerText || element.textContent || "").trim();
        const elements = [...document.querySelectorAll("body *")].filter(visible);
        const statusNode = elements
          .filter((element) => /^(已成交|已流拍)$/.test(text(element).replace(/\s+/g, "")))
          .sort(
            (left, right) =>
              left.getBoundingClientRect().top - right.getBoundingClientRect().top,
          )[0];

        let transactionPrice = "";
        const priceLabels = elements
          .filter((element) => /^成交价[：:]?$/.test(text(element).replace(/\s+/g, "")))
          .sort(
            (left, right) =>
              left.getBoundingClientRect().top - right.getBoundingClientRect().top,
          );
        for (const label of priceLabels) {
          let container = label;
          for (let depth = 0; depth < 4 && container; depth += 1) {
            const block = text(container);
            const match = block.match(/成交价[：:]?\s*[￥¥]?\s*([\d,.]+)\s*(万|元)?/);
            if (match) {
              transactionPrice = `${match[1]}${match[2] || "元"}`;
              break;
            }
            container = container.parentElement;
          }
          if (transactionPrice) break;
        }
        return {
          status: statusNode ? text(statusNode).replace(/\s+/g, "") : "",
          transactionPrice,
        };
      })
      .catch(() => null);
    if (value?.status || value?.transactionPrice) candidates.push(value);
  }
  return candidates.find((item) => item.status) || candidates[0] || {
    status: "",
    transactionPrice: "",
  };
}

async function readAlibabaOutcomeBanner(page) {
  for (const frame of page.frames()) {
    const text = await frame
      .evaluate(() => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= innerWidth * 0.4 &&
            rect.top >= 0 &&
            rect.top <= innerHeight * 0.75
          );
        };
        const candidates = Array.from(document.querySelectorAll("body *"))
          .map((element) => {
            const directText = Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent || "")
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            return { element, directText };
          })
          .filter(
            ({ element, directText }) =>
              /本场已流拍|本场已结束/.test(directText) && visible(element),
          )
          .sort(
            (left, right) =>
              left.directText.length - right.directText.length,
          );
        return candidates[0]?.directText || "";
      })
      .catch(() => "");
    if (text) return text;
  }
  return "";
}

async function readAlibabaLabeledPriceEvidence(page, labels) {
  for (const frame of page.frames()) {
    const evidence = await frame
      .evaluate((targetLabels) => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const normalized = (value) =>
          String(value || "")
            .replaceAll("：", ":");
        const compact = (value) => normalized(value).replace(/\s+/g, "");
        const ownText = (element) => Array.from(element.childNodes || [])
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ");
        for (const label of targetLabels) {
          const escaped = [...label]
            .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s*");
          const pattern = new RegExp(`${escaped}\\s*[:]?\\s*(?:人民币)?\\s*[￥¥]?\\s*([\\d,.，]+)\\s*(亿|万|元)?`);
          const elements = Array.from(document.querySelectorAll("body *")).filter(visible);
          const labelElements = elements.filter((element) => {
            const own = compact(ownText(element));
            const all = compact(element.innerText);
            return own.includes(compact(label)) || (all.includes(compact(label)) && all.length <= 40);
          });
          const candidates = [];
          for (const element of labelElements) {
            const scopes = [
              element,
              element.nextElementSibling,
              element.parentElement,
              element.closest("tr,li,dl,section,[class*='price'],[class*='rule']"),
            ].filter(Boolean);
            candidates.push(normalized(element.innerText));
            if (element.nextElementSibling) {
              candidates.push(`${normalized(element.innerText)} ${normalized(element.nextElementSibling.innerText)}`);
            }
            candidates.push(...scopes.map((scope) => normalized(scope.innerText)));
          }
          candidates.push(...elements
            .map((element) => normalized(element.innerText))
            .filter((text) => text.length <= 300 && compact(text).includes(compact(label))));
          const uniqueCandidates = [...new Set(candidates)]
            .filter((text) => text.length <= 300 && pattern.test(text))
            .sort((left, right) => left.length - right.length);
          const rawText = uniqueCandidates[0] || "";
          const match = rawText.match(pattern);
          if (match) {
            return {
              raw: `${match[1]}${match[2] || ""}`,
              label,
              rawText: match[0].replace(/\s+/g, " ").trim(),
              source: "label_neighbor",
            };
          }
        }
        return null;
      }, labels)
      .catch(() => null);
    const money = parseMoney(evidence?.raw);
    if (Number.isFinite(money)) return { ...evidence, value: money };
  }
  return null;
}

async function readAlibabaLabeledPrice(page, labels) {
  return (await readAlibabaLabeledPriceEvidence(page, labels))?.value ?? null;
}

async function parseAlibabaDetail(page, item, options) {
  await navigateAlibaba(page, item.url, options);
  await page
    .evaluate(async () => {
      const maxY = Math.min(document.body?.scrollHeight || 0, 30_000);
      for (let y = 0; y < maxY; y += 1_000) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(1_500);
  const documents = [];
  for (const frame of page.frames()) {
    const text = await frame.locator("body").innerText().catch(() => "");
    const rows = await frame
      .locator("table tr")
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          Array.from(node.querySelectorAll("th,td"))
            .map((cell) => cell.innerText?.trim() || "")
            .filter(Boolean),
        ),
      )
      .catch(() => []);
    if (text || rows.length) documents.push({ text, rows });
  }
  const body = documents.map((document) => document.text).join("\n");
  const attachments = await collectDetailAttachments(page);
  const investigation = options.includeParties
    ? extractAlibabaInvestigation(
        documents.flatMap((document) => document.rows),
        body,
      )
    : null;
  const titleRaw =
    (await page.locator("h1").first().innerText().catch(() => "")) ||
    (await page
      .locator('[class*="title"]')
      .first()
      .innerText()
      .catch(() => "")) ||
    item.title;
  const title = cleanAuctionTitle(titleRaw);
  const stage = detectStage(titleRaw, body);
  const dates = resolveAuctionDates(body, stage);
  const pageHeadline = documents[0]?.text?.slice(0, 6_000) || body.slice(0, 6_000);
  const announcementText = documents
    .map((document) =>
      textAfterLastMarker(document.text, ["竞买公告", "拍卖公告", "变卖公告"]),
    )
    .filter(Boolean)
    .join("\n");
  const structuredAuctionPriceEvidence = await readAlibabaLabeledPriceEvidence(page, START_PRICE_LABELS);
  const structuredDisposalPriceEvidence = stage === "变卖"
    ? await readAlibabaLabeledPriceEvidence(page, DISPOSAL_PRICE_LABELS)
    : null;
  const structuredStartPriceEvidence = structuredAuctionPriceEvidence || structuredDisposalPriceEvidence;
  const structuredStartPrice = structuredStartPriceEvidence?.value ?? null;
  const headlineStartPriceEvidence = extractStartPrice(pageHeadline, stage);
  const headlineStartPrice = headlineStartPriceEvidence?.value ?? null;
  const listStartPriceEvidence = extractStartPrice(item.text || "", stage);
  const listCurrentPrice = labeledMoney(item.text || "", ["当前价"]);
  const listStartPrice = listStartPriceEvidence?.value
    ?? (item.collectorPlatform !== "alibaba_pc" && Number.isFinite(listCurrentPrice) ? listCurrentPrice : null);
  const announcementStartPriceEvidence = extractStartPrice(announcementText, stage);
  const announcementStartPrice = announcementStartPriceEvidence?.value ?? null;
  const startPrice = [
    structuredStartPrice,
    headlineStartPrice,
    listStartPrice,
    announcementStartPrice,
  ].find((value) => Number.isFinite(value)) ?? null;
  const structuredAssessmentEvidence = await readAlibabaLabeledPriceEvidence(page, ASSESSMENT_PRICE_LABELS);
  const headlineAssessmentEvidence = extractPriceByPriority(pageHeadline, ASSESSMENT_PRICE_LABELS);
  const bodyAssessmentEvidence = extractPriceByPriority(body, ASSESSMENT_PRICE_LABELS);
  const announcementAssessmentEvidence = extractPriceByPriority(announcementText, ASSESSMENT_PRICE_LABELS);
  const structuredMarketEvidence = await readAlibabaLabeledPriceEvidence(page, MARKET_PRICE_LABELS);
  const headlineMarketEvidence = extractPriceByPriority(pageHeadline, MARKET_PRICE_LABELS);
  const bodyMarketEvidence = extractPriceByPriority(body, MARKET_PRICE_LABELS);
  const announcementMarketEvidence = extractPriceByPriority(announcementText, MARKET_PRICE_LABELS);
  const selectedAssessmentEvidence = [
    structuredAssessmentEvidence,
    headlineAssessmentEvidence,
    bodyAssessmentEvidence,
    announcementAssessmentEvidence,
    structuredMarketEvidence,
    headlineMarketEvidence,
    bodyMarketEvidence,
    announcementMarketEvidence,
  ].find((item) => Number.isFinite(item?.value)) || null;
  const assessmentPrice = selectedAssessmentEvidence?.value
    ?? (Number.isFinite(item.listEvidence?.assessmentPrice) ? item.listEvidence.assessmentPrice : null);
  const assessmentLabel = selectedAssessmentEvidence?.label || "";
  const structuredShotPrice = await readAlibabaLabeledPrice(page, ["拍下价"]);
  const shotPrice =
    [structuredShotPrice, labeledMoney(pageHeadline, ["拍下价"])].find((value) =>
      Number.isFinite(value),
    ) ?? null;
  let areaResult = extractAreaByPriority(documents, { title: titleRaw });
  if (areaResult.area === null) {
    areaResult = await extractAlibabaHelpCenterArea(page, item.url, options);
  }
  if (areaResult.area === null && Number.isFinite(item.listEvidence?.area)) {
    areaResult = {
      area: item.listEvidence.area,
      source: "阿里资产PC端列表卡片",
      rawText: item.listEvidence.rawText,
      ruleId: "alibaba-pc-list-area-v1",
      confidence: "high",
    };
  }
  const outcomeBanner = await readAlibabaOutcomeBanner(page);
  const bannerOutcome = detectAlibabaOutcome(outcomeBanner);
  const pageOutcome = detectAlibabaOutcome(body);
  let outcome = ["是", "否"].includes(bannerOutcome)
    ? bannerOutcome
    : ["即将开始", "正在进行", "已撤回", "已中止", "已暂缓"].includes(
          pageOutcome,
        )
      ? pageOutcome
      : "待核验";
  if (outcome === "待核验" && item.collectorPlatform === "alibaba_pc" && item.statusGroup === "已结束" && Number.isFinite(item.listEvidence?.bidCount)) {
    outcome = item.listEvidence.bidCount > 0 ? "是" : "否";
  }
  const outcomeRule =
    outcome === "是"
      ? "本场已结束"
      : outcome === "否"
        ? "本场已流拍"
        : "";
  const labeledCourt = body.match(
    /(?:处置法院|处置单位|执行法院)\s*[：:]?\s*([\u4e00-\u9fa5]{2,40}人民法院)/,
  );
  const court = extractCourt(body, labeledCourt?.[1] || "");
  const titleOwner = options.includeParties ? extractOwnerFromTitle(title) : "未找到";
  const bodyDebtor = options.includeParties
    ? extractParty(
        body,
        [
          "债务人",
          "被执行人",
          "标的物所有人",
          "标的所有人",
          "拍品所有人",
          "标的物权利人",
          "房屋所有权人",
          "所有权人",
        ],
        [/被执行人\s*([^，。\n]{2,50}?)(?:名下|所有)/],
      )
    : "未找到";
  const cleanedTitle = cleanPropertyTitle(title);
  const resolvedPcCategory = item.categoryConflict
    ? ""
    : item.collectorPlatform === "alibaba_pc" && !item.category
      ? classifyAlibabaPcCategory(`${cleanedTitle}\n${body}`, item.selectedCategories || options.categories).category
      : item.category;
  const propertyType = resolvedPcCategory
    ? classifyPropertyType(resolvedPcCategory, cleanedTitle)
    : "类别待复核";
  const locationFields = splitLocation(title, court, body.slice(0, 5000));
  const communityResult = item.collectorPlatform === "alibaba_pc" && item.listEvidence?.community
    ? {
        value: item.listEvidence.community,
        evidence: fieldEvidence({
          value: item.listEvidence.community,
          platform: "alibaba",
          section: "阿里资产PC端列表卡片",
          element: "小区名称",
          rawText: item.listEvidence.rawText,
          ruleId: "alibaba-pc-list-community-v1",
          confidence: "high",
        }),
      }
    : extractCommunityNameWithEvidence({
        标的名称: cleanedTitle,
        原始标的名称: title,
        标的类型: propertyType,
        平台: "阿里资产",
        _documents: documents,
        ...locationFields,
      });
  const statusGroup = resolveStatusGroup(item.statusGroup, outcome, dates);
  const participation = extractParticipation({
    documents,
    statusGroup,
    outcome,
    platform: "alibaba",
  });
  const record = {
    ...locationFields,
    标的名称: cleanedTitle,
    "小区名称（仅供参考）": communityResult.value,
    标的类型: propertyType,
    平台: "阿里资产",
    发拍次数: stage,
    拍卖时间: statusGroup === "已结束" ? dates.end : dates.start,
    发拍时间: dates.start,
    竞拍结束时间: dates.end,
    是否成交: outcome,
    处置法院: court,
    "面积/㎡": areaResult.area ?? "未找到",
    备注: [
      areaNoteFromResult(areaResult, { hasAssessmentAttachment: attachments.length > 0 }),
      item.listEvidence?.room ? `户型：${item.listEvidence.room}` : "",
      !resolvedPcCategory ? "物业类型待人工复核" : "",
    ].filter(Boolean).join("；"),
    ...(options.includeParties
      ? {
          债权人:
            investigation.mortgageCreditor !== "未找到"
              ? investigation.mortgageCreditor
              : extractParty(body, ["债权人", "申请执行人", "抵押权人"]),
          债务人:
            investigation.owner !== "未找到"
              ? investigation.owner
              : titleOwner !== "未找到"
                ? titleOwner
                : bodyDebtor,
        }
      : {}),
    起拍价格: startPrice,
    评估价: assessmentPrice,
    成交金额: outcome === "是" ? (shotPrice ?? item.listEvidence?.currentPrice ?? 0) : 0,
    竞买记录: participation.bidCount ?? item.listEvidence?.bidCount,
    报名人数: participation.registrationCount,
    网站链接: canonicalUrl(item.url),
    _capturedAt: new Date().toISOString(),
    _sourceStatus: item.status || "",
    _状态分组: statusGroup,
    _源分类: resolvedPcCategory || "类别待复核",
    _采集通道: item.collectorPlatform || "alibaba",
    _platformPropertyPurposeCode: item.platformPropertyPurposeCode || "",
    _platformPropertyPurposeLabel: resolvedPcCategory || "类别待复核",
    _propertyTypeSource: item.categorySource || (item.collectorPlatform === "alibaba_pc" ? "keyword_fallback" : "legacy_category"),
    _propertyTypeConfidence: item.categoryConfidence || item.listEvidence?.categoryConfidence || "low",
    _propertyTypeCandidates: item.categoryCandidates || (resolvedPcCategory ? [resolvedPcCategory] : []),
    _propertyTypeReviewRequired:
      !resolvedPcCategory
      || item.categoryConflict === true
      || (item.collectorPlatform === "alibaba_pc"
        && item.categorySource !== "alibaba_pc_filter_membership"),
    _pcListEvidence: item.listEvidence || null,
    _areaSource: areaResult.source,
    _participationExtractionAttempted: statusGroup === "已结束",
    _attachments: attachments,
    _fieldEvidence: {
      标的名称: fieldEvidence({
        value: cleanedTitle,
        platform: "alibaba",
        section: "详情页标题",
        element: "标的名称",
        rawText: title,
        ruleId: "property-title-shared-v2",
        confidence: cleanedTitle ? "high" : "low",
        reviewRequired: !cleanedTitle,
      }),
      "小区名称（仅供参考）": communityResult.evidence,
      ...participation.evidence,
      "面积/㎡": fieldEvidence({
        value: areaResult.area,
        dataType: "number",
        unit: "㎡",
        platform: "alibaba",
        section: areaResult.source,
        element: "建筑面积",
        rawText: areaResult.rawText || areaResult.rawExpression || "",
        ruleId: areaResult.ruleId || "area-legacy-v1",
        confidence: areaResult.area === null ? "low" : areaResult.confidence || "high",
        conflicts: areaResult.conflicts || [],
        reviewRequired: areaResult.area === null || areaResult.reviewRequired === true,
      }),
      评估价: fieldEvidence({
        value: assessmentPrice,
        dataType: "number",
        unit: "元",
        platform: "alibaba",
        section: !selectedAssessmentEvidence && Number.isFinite(item.listEvidence?.assessmentPrice)
          ? "阿里资产PC端列表卡片"
          : selectedAssessmentEvidence?.source === "label_neighbor"
          ? "平台详情页标签邻接价格区"
          : selectedAssessmentEvidence === announcementAssessmentEvidence || selectedAssessmentEvidence === announcementMarketEvidence
            ? "竞买公告价格段"
            : "平台详情页价格文本",
        element: assessmentLabel || (Number.isFinite(item.listEvidence?.assessmentPrice) ? "评估价/市场价" : ""),
        rawText: selectedAssessmentEvidence?.rawText || item.listEvidence?.rawText || "",
        ruleId: !selectedAssessmentEvidence && Number.isFinite(item.listEvidence?.assessmentPrice)
          ? "alibaba-pc-list-assessment-price-v1"
          : ASSESSMENT_PRICE_LABELS.includes(assessmentLabel)
          ? "alibaba-assessment-price-v2"
          : "alibaba-market-price-as-assessment-v2",
        confidence: Number.isFinite(assessmentPrice) ? "high" : "low",
        reviewRequired: !Number.isFinite(assessmentPrice),
      }),
    },
    _startPriceSource: Number.isFinite(structuredStartPrice)
      ? structuredStartPriceEvidence?.label === "变卖价"
        ? "平台详情页标签邻接变卖价"
        : "平台详情页标签邻接起拍价"
      : Number.isFinite(headlineStartPrice)
        ? headlineStartPriceEvidence?.label === "变卖价" ? "平台详情页变卖价" : "平台详情页起拍价"
        : Number.isFinite(listStartPrice)
          ? "平台列表页"
        : Number.isFinite(announcementStartPrice)
            ? announcementStartPriceEvidence?.label === "变卖价" ? "竞买公告变卖价" : "竞买公告起拍价"
            : "未找到",
    _shotPriceSource: Number.isFinite(structuredShotPrice)
      ? "平台详情页拍下价"
      : Number.isFinite(shotPrice)
        ? "平台详情页价格区"
        : "未找到",
    _endTimeSource: dates.endSource,
    _outcomeRule: outcomeRule,
    _outcomeBanner: outcomeBanner,
  };
  record._missing = qualityFields(record, options.includeParties);
  return record;
}

async function loadState(statePath, includeParties = null) {
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    state.anchors ||= {};
    state.records ||= {};
    for (const key of Object.keys(state.anchors)) {
      if (key.endsWith(":正在进行")) delete state.anchors[key];
    }
    for (const record of Object.values(state.records)) {
      if (includeParties === false) {
        delete record.债权人;
        delete record.债务人;
      }
      const sourceCategory = sourceCategoryForRecord(record);
      record._源分类 = sourceCategory;
      record.标的名称 = cleanPropertyTitle(record.标的名称);
      record.标的类型 = classifyPropertyType(
        sourceCategory,
        record.标的名称,
      );
      if (!Number.isFinite(record["面积/㎡"])) {
        record["面积/㎡"] = "未找到";
      }
      if (record._状态分组 === "正在进行") {
        record._状态分组 = "即将开始";
      }
      record._missing = qualityFields(record);
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { version: 1, anchors: {}, records: {}, updatedAt: null };
    }
    throw error;
  }
}

async function saveJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await saveJson(temporary, value);
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(temporary, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!/[Ee](PERM|ACCES|BUSY)/.test(String(error?.code || error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  // Windows、杀毒软件或网页状态读取器可能短暂占用目标文件，导致
  // rename 无法替换已有 JSON。此时用已完整写好的临时文件覆盖目标，
  // 避免把一次文件占用误记成列表采集失败。
  try {
    await fs.copyFile(temporary, filePath);
  } catch {
    throw lastError;
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function saveStateAtomic(statePath, state) {
  await saveJsonAtomic(statePath, state);
}

async function resolveRememberedOutputDir(options) {
  const settingsPath = path.join(options.stateDir, "output-settings.json");
  if (options.outputDirProvided) {
    await fs.mkdir(options.outputDir, { recursive: true });
    await saveJsonAtomic(settingsPath, {
      version: 1,
      outputDir: options.outputDir,
      updatedAt: new Date().toISOString(),
    });
    return options.outputDir;
  }
  const settings = await loadJson(settingsPath, null);
  if (settings?.outputDir) {
    options.outputDir = path.resolve(settings.outputDir);
    await fs.mkdir(options.outputDir, { recursive: true });
    return options.outputDir;
  }
  throw new Error(
    "首次运行尚未设置房源结果保存目录。请先询问用户今后要把房源信息保存在哪个文件夹，并在用户明确提供路径后使用 --output-dir DIR 重新运行；不得自行猜测或保存到Skill目录。",
  );
}

function progressPlan(options, dateKey, statePath) {
  return {
    dateKey,
    statePath: path.resolve(statePath),
    platform: options.platform,
    categories: [...options.categories],
    statusFilters: [...options.statusFilters],
    maxPages: options.maxPages,
    dryRun: options.dryRun,
    includeParties: options.includeParties,
  };
}

function restoreCheckpointRecords(candidateState, checkpoint) {
  for (const record of checkpoint?.records || []) {
    if (record?.网站链接) {
      candidateState.records[record.网站链接] = record;
    }
  }
}

function assertCheckpointMonotonicity(priorCheckpoint, nextCheckpoint, restart = false) {
  if (restart || !priorCheckpoint) return true;
  const priorGroups = Object.keys(priorCheckpoint.groups || {}).length;
  const nextGroups = Object.keys(nextCheckpoint.groups || {}).length;
  const priorRecords = Array.isArray(priorCheckpoint.records) ? priorCheckpoint.records.length : 0;
  const nextRecords = Array.isArray(nextCheckpoint.records) ? nextCheckpoint.records.length : 0;
  if (nextGroups < priorGroups || nextRecords < priorRecords) {
    const error = new Error(
      `断点写入被拒绝：同一批次不得从${priorGroups}组/${priorRecords}条回退到${nextGroups}组/${nextRecords}条。`,
    );
    error.code = "CHECKPOINT_REGRESSION";
    throw error;
  }
  return true;
}

const PLATFORM_NAMES = {
  alibaba: "阿里资产",
  alibaba_pc: "阿里资产（PC端）",
  jd: "京东拍卖",
  jd_pc: "京东拍卖（PC端）",
};

function selectedPlatformIds(platform) {
  if (platform === "all") return ["alibaba", "jd"];
  if (platform === "alibaba_pc_all") return ["alibaba_pc", "jd"];
  if (platform === "alibaba_jd_pc") return ["alibaba", "jd_pc"];
  if (platform === "alibaba_pc_jd_pc") return ["alibaba_pc", "jd_pc"];
  return [platform];
}

function platformSelected(platform, platformId) {
  return selectedPlatformIds(platform).includes(platformId);
}

function alibabaPcCategoryScope(categories, includeBankruptcy = true) {
  return `${[...new Set(categories)].sort().join("+")}@${includeBankruptcy ? "with_bankruptcy" : "without_bankruptcy"}`;
}

function groupCategories(platformId, categories, includeBankruptcy = true) {
  return platformId === "alibaba_pc"
    ? [alibabaPcCategoryScope(categories, includeBankruptcy)]
    : platformId === "jd_pc"
      ? [[...new Set(categories)].sort().join("+")]
    : categories;
}

function groupKeyFor(platformId, category, status, city = "") {
  return `${platformId}:${category}:${status}${city ? `:${city}` : ""}`;
}

function missingHighWaterMarks(
  anchors = {}, platform = "all", categories = Object.keys(CATEGORIES),
  statuses = STATUS_FILTERS, cities = [], scopeOptions = {},
) {
  const missing = [];
  for (const platformId of selectedPlatformIds(platform)) {
    for (const category of groupCategories(platformId, categories, scopeOptions.includeBankruptcy !== false)) {
      for (const city of (cities.length ? cities : [""])) {
      for (const status of statuses) {
        const key = groupKeyFor(platformId, category, status, city);
        if (anchors[key]) continue;
        const platformName = PLATFORM_NAMES[platformId];
        missing.push({
          key,
          platform: platformId,
          platformName,
          category: ["alibaba_pc", "jd_pc"].includes(platformId) ? categories.join("、") : category,
          status,
          city,
          prompt: `还缺少前一日${platformName}${city ? `${city}` : ""}${category}类别中${status}的最新数据链接，请您提供链接。`,
        });
      }
      }
    }
  }
  return missing;
}

function formatMissingHighWaterMarks(missing) {
  return [
    "尚不能开始今日数据爬取：前一日高水位链接不完整。",
    ...missing.map((item) => `- ${item.prompt}`),
    "收到链接后，先将其导入状态文件；只有上述高水位全部齐全，才能开始今日列表采集。",
  ].join("\n");
}

function assertHighWaterCompleteness(anchors, platform, categories, statuses, cities, scopeOptions = {}) {
  const missing = missingHighWaterMarks(anchors, platform, categories, statuses, cities, scopeOptions);
  if (!missing.length) return;
  const error = new Error(formatMissingHighWaterMarks(missing));
  error.code = "MISSING_HIGH_WATER_MARKS";
  error.missing = missing;
  throw error;
}

function normalizeAnchorPayload(payload) {
  const source = payload?.anchors ?? payload;
  const entries = [];
  if (Array.isArray(source)) {
    for (const item of source) {
      const platformAlias = item.platform || item.平台;
      const platform =
        platformAlias === "阿里资产"
          ? "alibaba"
          : platformAlias === "阿里资产（PC端）"
            ? "alibaba_pc"
          : platformAlias === "京东拍卖"
            ? "jd"
            : platformAlias === "京东拍卖（PC端）"
              ? "jd_pc"
            : platformAlias;
      const rawCategory = item.category || item.标的类型;
      const category = platform === "jd_pc"
        ? String(rawCategory || "").split(/[+、,，]/u).map((value) => value.trim()).filter(Boolean).sort().join("+")
        : rawCategory;
      const status = item.status || item.状态;
      const url = item.url || item.网站链接;
      entries.push([`${platform}:${category}:${status}`, url]);
    }
  } else if (source && typeof source === "object") {
    entries.push(...Object.entries(source));
  } else {
    throw new Error("--anchors-file 必须是锚点对象、含 anchors 的对象或锚点数组");
  }

  const anchors = {};
  for (const [key, value] of entries) {
    if (!/^(?:(?:alibaba|jd):(住宅用房|商业用房|工业用房)|alibaba_pc:.+@(with_bankruptcy|without_bankruptcy)|jd_pc:(?:住宅用房|商业用房|工业用房)(?:\+(?:住宅用房|商业用房|工业用房))*):(即将开始|已结束)$/.test(key)) {
      throw new Error(`无效高水位键：${key}`);
    }
    try {
      anchors[key] = canonicalUrl(value);
    } catch {
      throw new Error(`高水位链接无效：${key}=${value}`);
    }
    if (!anchors[key]) throw new Error(`高水位链接为空：${key}`);
  }
  return anchors;
}

async function seedAnchors(options) {
  if (!options.anchorsFile) {
    throw new Error("seed-anchors 命令必须提供 --anchors-file FILE");
  }
  const statePath = path.join(options.stateDir, "state.json");
  const state = await loadState(statePath);
  const payload = JSON.parse(await fs.readFile(options.anchorsFile, "utf8"));
  const imported = normalizeAnchorPayload(payload);
  state.anchors = { ...(state.anchors || {}), ...imported };
  state.version ||= 1;
  state.records ||= {};
  state.anchorsSeededAt = new Date().toISOString();
  await saveStateAtomic(statePath, state);

  const missing = missingHighWaterMarks(state.anchors, options.platform, options.categories, options.statusFilters, options.cities, options);
  console.log(
    JSON.stringify(
      {
        statePath,
        imported: Object.keys(imported),
        complete: missing.length === 0,
        missing: missing.map((item) => item.key),
      },
      null,
      2,
    ),
  );
  if (missing.length) {
    const error = new Error(formatMissingHighWaterMarks(missing));
    error.code = "MISSING_HIGH_WATER_MARKS";
    throw error;
  }
}

async function findEdgeExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.LOCALAPPDATA
      ? path.join(
          process.env.LOCALAPPDATA,
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        )
      : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next standard Edge location.
    }
  }
  throw new Error("未找到 Microsoft Edge 可执行文件");
}

async function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForCdp(port, child) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    // Edge may immediately relaunch itself with --edge-skip-compat-layer-relaunch.
    // The launcher exits with code 0 while the replacement opens the requested
    // CDP port, so only a non-zero exit is an immediate launch failure.
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Microsoft Edge 在接管前退出，退出码 ${child.exitCode}`);
    }
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`等待 Microsoft Edge 本机调试端口超时：${lastError || endpoint}`);
}

async function openNativeEdgeContext(options, chromium) {
  const executable = await findEdgeExecutable();
  const port = await reserveLocalPort();
  const initialUrl =
    options.lowFrequency
      ? "about:blank"
      : selectedPlatformIds(options.platform).length === 1
        && (platformSelected(options.platform, "jd") || platformSelected(options.platform, "jd_pc"))
      ? `${JD_LIST_URL}?publishSource=7&projectType=`
      : platformSelected(options.platform, "alibaba_pc")
        ? buildAlibabaPcListUrl(options)
        : ALIBABA_LIST_URL;
  const child = spawn(
    executable,
    [
      `--user-data-dir=${options.profileDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      "--lang=zh-CN",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--start-minimized",
      "--new-window",
      initialUrl,
    ],
    {
      detached: false,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  try {
    await waitForCdp(port, child);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: 60_000,
    });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Microsoft Edge 未提供可用浏览器上下文");
    if (!context.pages().length) await context.waitForEvent("page", { timeout: 10_000 });
    const pages = context.pages();
    const workingPage = [...pages].reverse().find((page) => /^https?:/iu.test(page.url())) || pages.at(-1);
    for (const candidate of pages) {
      if (candidate !== workingPage) await candidate.close().catch(() => {});
    }
    if (workingPage && !/^https?:/iu.test(workingPage.url())) {
      await gotoWithTransientRetry(workingPage, initialUrl);
    }
    CONTEXT_CLOSERS.set(context, async () => {
      await browser.close().catch(() => {});
      if (child.exitCode === null) child.kill();
    });
    return context;
  } catch (error) {
    if (child.exitCode === null) child.kill();
    throw error;
  }
}

async function closeContext(context) {
  const close = CONTEXT_CLOSERS.get(context);
  if (close) {
    await close();
    CONTEXT_CLOSERS.delete(context);
    return;
  }
  await context.close();
}

async function openContext(options) {
  const { chromium } = await loadPlaywright();
  await fs.mkdir(options.profileDir, { recursive: true });
  if (!options.headless && process.platform === "win32") {
    return openNativeEdgeContext(options, chromium);
  }
  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: "msedge",
    headless: options.headless,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: false,
    args: ["--disable-extensions"],
  });
  CONTEXT_CLOSERS.set(context, () => context.close());
  return context;
}

async function login(options) {
  options.headless = false;
  const context = await openContext(options);
  const pages = context.pages();
  const first =
    [...pages].reverse().find((page) => page.url() !== "about:blank") ||
    pages.at(-1) ||
    (await context.newPage());
  try {
    if (platformSelected(options.platform, "alibaba") || platformSelected(options.platform, "alibaba_pc")) {
      const alibabaTarget = platformSelected(options.platform, "alibaba_pc")
        ? buildAlibabaPcListUrl({
          province: options.province,
          city: options.cities?.[0] || "",
          categories: options.categories,
          includeBankruptcy: options.includeBankruptcy,
          statusFilter: options.statusFilters?.[0] || "即将开始",
          page: 1,
        })
        : ALIBABA_LIST_URL;
      await navigateAlibaba(first, alibabaTarget, options);
      console.log(`淘宝登录态已保存在专用 Edge 配置：${options.profileDir}`);
    }
    if (platformSelected(options.platform, "jd") || platformSelected(options.platform, "jd_pc")) {
      const jdPage = platformSelected(options.platform, "alibaba") || platformSelected(options.platform, "alibaba_pc")
        ? await context.newPage()
        : first;
      const categoryId = platformSelected(options.platform, "jd_pc") ? "" : CATEGORIES[options.categories?.[0]] || "";
      const jdTarget = `${JD_LIST_URL}?publishSource=7&projectType=&childrenCateId=${categoryId}`;
      await gotoWithTransientRetry(jdPage, jdTarget);
      await waitForJdAuthClear(jdPage, options);
      await waitForJdListReady(jdPage, jdTarget, options);
      console.log(`京东登录态已保存在专用 Edge 配置：${options.profileDir}`);
    }
  } finally {
    await closeContext(context);
  }
}

function dateKeyForRun(options = {}, now = new Date()) {
  const savedRunName = String(options.runName || "");
  const match = /^(\d{8})(?:\uFF08\d+\uFF09)?$/u.exec(savedRunName);
  if (match) return match[1];
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })
    .format(now).replaceAll("-", "");
}

async function run(options) {
  const statePath = path.join(options.stateDir, "state.json");
  // Resuming a saved batch after midnight must retain its original date key;
  // otherwise the checkpoint is treated as a new empty run and monotonic
  // checkpoint protection correctly rejects the attempted rollback.
  const dateKey = dateKeyForRun(options);
  const runDir = path.join(options.outputDir, options.runName || dateKey);
  const checkpointPath = path.join(runDir, "采集进度.json");
  const resultPath = path.join(runDir, "运行结果.json");
  const checkpointWorkbookPath = path.join(
    runDir,
    `${dateKey}新增房源信息_采集中.xlsx`,
  );
  const previousState = await loadState(statePath, options.includeParties);
  if (!options.urlsFile) {
    // Fail before opening Edge or scanning any list. The agent must ask the
    // user for every specifically named missing prior-day high-water link.
  assertHighWaterCompleteness(previousState.anchors || {}, options.platform, options.categories, options.statusFilters, options.cities, options);
  }
  const priorCheckpoint = options.restart
    ? null
    : await loadJson(checkpointPath, null);
  const canResume =
    priorCheckpoint?.dateKey === dateKey &&
    path.resolve(priorCheckpoint?.plan?.statePath || statePath) ===
      path.resolve(statePath);
  if (canResume && priorCheckpoint?.status === "已完成") {
    const existingResult = await loadJson(resultPath, {});
    const idempotentResult = {
      ...existingResult,
      failures: [],
      dryRun: Boolean(options.dryRun),
      stateAdvanced: !options.dryRun,
      idempotentResume: true,
      resumedAt: new Date().toISOString(),
    };
    await saveJson(resultPath, idempotentResult);
    console.log(JSON.stringify({
      ...(existingResult.workbookQa || {}),
      failures: [],
      stateAdvanced: idempotentResult.stateAdvanced,
      idempotentResume: true,
    }, null, 2));
    return;
  }
  const candidateState = structuredClone(previousState);
  if (canResume) restoreCheckpointRecords(candidateState, priorCheckpoint);
  const firstRun = Object.keys(previousState.records).length === 0;
  const failures = canResume
    ? [...(priorCheckpoint.failures || [])].filter(
        (failure) =>
          !(
            failure?.stage === "list" &&
            /EPERM|EACCES|EBUSY/i.test(String(failure?.error || "")) &&
            /采集进度\.json/i.test(String(failure?.error || ""))
          ),
      )
    : [];
  const evidence = canResume ? [...(priorCheckpoint.evidence || [])] : [];
  const newAnchors = canResume ? { ...(priorCheckpoint.newAnchors || {}) } : {};
  const completedUrls = new Set(
    canResume ? priorCheckpoint.completedUrls || [] : [],
  );
  const groups = canResume ? { ...(priorCheckpoint.groups || {}) } : {};
  const progress = {
    version: 2,
    dateKey,
    status: "采集中",
    startedAt:
      (canResume && priorCheckpoint.startedAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: progressPlan(options, dateKey, statePath),
    groups,
    completedUrls: [...completedUrls],
    newSavedCount:
      (canResume && Number(priorCheckpoint.newSavedCount || 0)) || 0,
    resumed: Boolean(canResume),
    current: priorCheckpoint?.current || {},
  };
  let changesSinceWorkbook = 0;

  const removeFailure = (predicate) => {
    for (let index = failures.length - 1; index >= 0; index -= 1) {
      if (predicate(failures[index])) failures.splice(index, 1);
    }
  };
  const currentRunRecords = () => {
    const currentRunUrls = new Set(
      Object.values(groups).flatMap((group) =>
        (group.items || []).map((item) => canonicalUrl(item.url)),
      ),
    );
    if (options.urlsFile) {
      for (const item of evidence) {
        if (item.action === "recovered-link" && item.record?.网站链接) {
          currentRunUrls.add(canonicalUrl(item.record.网站链接));
        }
      }
    }
    return Object.values(candidateState.records).filter((record) =>
      currentRunUrls.has(canonicalUrl(record.网站链接)),
    );
  };
  const persistProgress = async ({
    forceWorkbook = false,
    status = progress.status,
  } = {}) => {
    progress.status = status;
    progress.updatedAt = new Date().toISOString();
    progress.completedUrls = [...completedUrls];
    const records = currentRunRecords();
    const payload = {
      ...progress,
      records,
      failures,
      evidence,
      newAnchors,
      counts: {
        records: records.length,
        completedUrls: completedUrls.size,
        failures: failures.length,
      },
      checkpointWorkbookPath,
      resumeCommand: "使用与本次相同的 run 命令重新运行，程序会自动续爬",
    };
    assertCheckpointMonotonicity(priorCheckpoint, payload, options.restart);
    await saveJsonAtomic(checkpointPath, payload);
    changesSinceWorkbook += 1;
    if (
      forceWorkbook ||
      changesSinceWorkbook >= options.checkpointEvery
    ) {
      changesSinceWorkbook = 0;
      try {
        await buildWorkbook({
          adapter: options.workbookAdapter,
          records,
          reviewItems: [
            ...alibabaShellReviewItems(failures),
            ...alibabaDeferredReviewItems(evidence),
            ...fieldConflictReviewItems(records),
          ],
          outputPath: checkpointWorkbookPath,
          preserveOrder: true,
          progressInfo: {
            status: progress.status,
            savedCount: completedUrls.size,
            failureCount: failures.length,
            platform:
              PLATFORM_NAMES[progress.current.platform] ||
              progress.current.platform ||
              "",
            category: progress.current.category || "",
            statusFilter: progress.current.statusFilter || "",
            currentTitle: progress.current.title || "",
            currentUrl: progress.current.url || "",
            updatedAt: progress.updatedAt,
            resumeHint: payload.resumeCommand,
          },
          includeParties: options.includeParties,
        });
      } catch (error) {
        console.warn(
          `临时Excel暂时无法刷新（JSON进度已安全保存）：${String(error)}`,
        );
      }
    }
    console.log(
      `进度已保存：${completedUrls.size} 条成功，${failures.length} 条待重试；${checkpointWorkbookPath}`,
    );
  };

  if (canResume) {
    console.log(
      `检测到 ${priorCheckpoint.updatedAt || "上次"} 的未完成进度，将跳过已保存的 ${completedUrls.size} 条记录并继续。`,
    );
  }
  await persistProgress({ forceWorkbook: true });

  const context = await openContext(options);
  const pages = context.pages();
  const page =
    [...pages].reverse().find((candidate) => candidate.url() !== "about:blank") ||
    pages.at(-1) ||
    (await context.newPage());
  page.setDefaultTimeout(12_000);
  try {
    if (options.urlsFile) {
      const recoveredPayload = JSON.parse(
        await fs.readFile(options.urlsFile, "utf8"),
      );
      const recoveredItems = Array.isArray(recoveredPayload)
        ? recoveredPayload
        : recoveredPayload?.records;
      if (!Array.isArray(recoveredItems)) {
        throw new Error("--urls-file 必须是链接对象数组或含 records 数组的采集进度文件");
      }
      if (platformSelected(options.platform, "alibaba") || platformSelected(options.platform, "alibaba_pc")) {
        // Confirm the persistent Alibaba login before opening direct detail URLs.
        const loginUrl = platformSelected(options.platform, "alibaba_pc")
          ? buildAlibabaPcListUrl(options)
          : ALIBABA_LIST_URL;
        await navigateAlibaba(page, loginUrl, options);
      }
      for (const item of recoveredItems.slice(0, options.maxItems)) {
        const itemUrl = canonicalUrl(item.url || item.网站链接);
        if (completedUrls.has(itemUrl)) continue;
        const itemPlatform =
          item.platform || item.平台 || (itemUrl.includes("paimai.jd.com") ? "京东拍卖" : "阿里资产");
        const recoveredPlatform = itemPlatform === "京东拍卖"
          ? ((item._采集通道 || item.collectorPlatform) === "jd_pc" ? "jd_pc" : "jd")
          : (item._采集通道 || item.collectorPlatform) === "alibaba_pc" ? "alibaba_pc" : "alibaba";
        if (!selectedPlatformIds(options.platform).includes(recoveredPlatform)) {
          continue;
        }
        const recoveredCategory = CATEGORIES[item.category]
          ? item.category
          : CATEGORIES[item._源分类]
            ? item._源分类
            : sourceCategoryForRecord(item);
        try {
          const parser = itemPlatform === "京东拍卖" ? parseJdDetail : parseAlibabaDetail;
          const record = await parser(
            page,
            {
              url: item.url || item.网站链接,
              title: item.title || item.标的名称 || "",
              category: recoveredCategory,
              collectorPlatform: item._采集通道 || item.collectorPlatform || recoveredPlatform,
              categorySource: item.categorySource || item._propertyTypeSource || "",
              platform: itemPlatform,
              statusGroup: item.statusGroup || item._状态分组 || "",
            },
            options,
          );
          candidateState.records[record.网站链接] = record;
          completedUrls.add(record.网站链接);
          removeFailure(
            (failure) =>
              canonicalUrl(failure.url || "") === record.网站链接,
          );
          evidence.push({ action: "recovered-link", record });
        } catch (error) {
          failures.push({
            stage: "recovered-detail",
            platform: itemPlatform === "京东拍卖" ? "jd" : "alibaba",
            category: recoveredCategory,
            status: item.statusGroup || item._状态分组 || "",
            title: item.title || item.标的名称 || "",
            url: item.url || item.网站链接,
            error: String(error),
          });
        }
        progress.current = {
          platform: itemPlatform === "京东拍卖" ? "jd" : "alibaba",
          category: recoveredCategory,
          statusFilter: item.statusGroup || item._状态分组 || "",
          title: item.title || item.标的名称 || "",
          url: itemUrl,
        };
        await persistProgress();
      }
    } else {
    // A delivery installation intentionally starts without the developer's
    // private Edge profile. Authenticate selected platforms before scanning
    // any group so a first-run login cannot become many independent failures.
    // The user's own profile is reused by every later resume.
    // The PC collector verifies authentication and the complete scope on its
    // first real city list/detail. A separate province-wide preflight creates
    // an unnecessary page transition and can loop before the city task starts.
    if (platformSelected(options.platform, "alibaba")) {
      const loginPlatform = "alibaba";
      const loginUrl = ALIBABA_LIST_URL;
      progress.current = {
        platform: loginPlatform, category: "", statusFilter: "",
        title: "采集前登录状态预检", url: loginUrl,
      };
      await persistProgress();
      await navigateAlibaba(page, loginUrl, options);
    }
    if (platformSelected(options.platform, "jd") || platformSelected(options.platform, "jd_pc")) {
      progress.current = {
        platform: "jd", category: "", statusFilter: "",
        title: "采集前登录状态预检", url: JD_LIST_URL,
      };
      await persistProgress();
      await gotoWithTransientRetry(page, `${JD_LIST_URL}?publishSource=7&projectType=`);
      await page.waitForTimeout(1_500);
      await waitForJdAuthClear(page, options);
    }
    // Refresh previously unfinished rows first so today's newly ended auctions
    // are never missed even when they no longer appear in an active-only list.
    const active = options.skipHistoricalRefresh
      ? []
      : Object.values(candidateState.records).filter((record) =>
          ACTIVE_STATUSES.has(record.是否成交),
        );
    if (options.skipHistoricalRefresh) {
      console.log("已按用户要求跳过历史未结束记录刷新，直接扫描前一日高水位后的今日增量列表。");
    }
    for (const oldRecord of active.slice(0, options.maxItems)) {
      if (completedUrls.has(oldRecord.网站链接)) continue;
      const recordPlatform = oldRecord.平台 === "京东拍卖"
        ? (oldRecord._采集通道 === "jd_pc" ? "jd_pc" : "jd")
        : oldRecord._采集通道 === "alibaba_pc" ? "alibaba_pc" : "alibaba";
      if (!selectedPlatformIds(options.platform).includes(recordPlatform)) {
        continue;
      }
      const sourceCategory = sourceCategoryForRecord(oldRecord);
      if (!options.categories.includes(sourceCategory)) continue;
      try {
        const parser =
          oldRecord.平台 === "京东拍卖" ? parseJdDetail : parseAlibabaDetail;
        const refreshed = await parser(
          page,
          {
            url: oldRecord.网站链接,
            title: oldRecord.标的名称,
            category: sourceCategory,
            collectorPlatform: oldRecord._采集通道 || recordPlatform,
            categorySource: oldRecord._propertyTypeSource || "",
            platform: oldRecord.平台,
            statusGroup: oldRecord._状态分组,
          },
          options,
        );
        candidateState.records[refreshed.网站链接] = refreshed;
        completedUrls.add(refreshed.网站链接);
        removeFailure(
          (failure) =>
            failure.stage === "refresh" &&
            canonicalUrl(failure.url || "") === refreshed.网站链接,
        );
        evidence.push({ action: "refresh", record: refreshed });
      } catch (error) {
        removeFailure(
          (failure) =>
            failure.stage === "refresh" &&
            canonicalUrl(failure.url || "") === oldRecord.网站链接,
        );
        failures.push({
          stage: "refresh",
          platform: oldRecord.平台 === "阿里资产" ? "alibaba" : "jd",
          category: sourceCategory,
          status: oldRecord._状态分组 || "",
          title: oldRecord.标的名称,
          url: oldRecord.网站链接,
          error: String(error),
        });
      }
      progress.current = {
        platform: oldRecord.平台 === "阿里资产" ? "alibaba" : "jd",
        category: sourceCategory,
        statusFilter: "既有链接刷新",
        title: oldRecord.标的名称,
        url: oldRecord.网站链接,
      };
      await persistProgress();
    }

    const platformSpecs = [];
    if (platformSelected(options.platform, "jd")) {
      platformSpecs.push({
        id: "jd",
        scan: scanJd,
        parse: parseJdDetail,
      });
    }
    if (platformSelected(options.platform, "jd_pc")) {
      platformSpecs.push({
        id: "jd_pc",
        scan: scanJdCombined,
        parse: parseJdDetail,
      });
    }
    if (platformSelected(options.platform, "alibaba")) {
      platformSpecs.push({
        id: "alibaba",
        scan: scanAlibaba,
        parse: parseAlibabaDetail,
      });
    }
    if (platformSelected(options.platform, "alibaba_pc")) {
      platformSpecs.push({
        id: "alibaba_pc",
        scan: scanAlibabaPc,
        parse: parseAlibabaDetail,
      });
    }

    let remaining = Number.isFinite(options.maxItems)
      ? Math.max(0, options.maxItems - progress.newSavedCount)
      : Number.POSITIVE_INFINITY;
    for (const platform of platformSpecs) {
      for (const category of groupCategories(platform.id, options.categories, options.includeBankruptcy)) {
        for (const city of (options.cities.length ? options.cities : [""])) {
        for (const statusFilter of options.statusFilters) {
          if (remaining <= 0) break;
          const anchorKey = groupKeyFor(platform.id, category, statusFilter, city);
          const priorAnchor = previousState.anchors[anchorKey] || "";
          // “即将开始”的昨日首条会在开拍后转入“正在进行”，因此原锚点可能
          // 合理地从当前列表消失。用昨日状态库中同平台、同源分类、同状态组的
          // 任意已知链接作为第二道边界；扫描到第一条旧记录即说明新增区间结束。
          // 该集合在本次运行开始时固定取自previousState，不会把刚发现的新记录
          // 误当边界，也不会跨类别或跨状态提前停止。
          const knownBoundaryUrls = new Set(
            Object.values(previousState.records || {})
              .filter((record) => {
                const recordPlatform = record.平台 === "京东拍卖"
                  ? (record._采集通道 === "jd_pc" ? "jd_pc" : "jd")
                  : record._采集通道 === "alibaba_pc" ? "alibaba_pc" : record.平台 === "阿里资产" ? "alibaba" : "";
                return recordPlatform === platform.id
                  && (["alibaba_pc", "jd_pc"].includes(platform.id) || sourceCategoryForRecord(record) === category)
                  && String(record._状态分组 || "") === statusFilter
                  && (!city || String(record.城市 || "") === city);
              })
              .map((record) => canonicalUrl(record.网站链接))
              .filter(Boolean),
          );
          let scan = null;
          const storedGroup = groups[anchorKey];
          if (
            storedGroup?.priorAnchor === priorAnchor &&
            (storedGroup.anchorFound === true || storedGroup.listExhausted === true) &&
            Array.isArray(storedGroup.items)
          ) {
            scan = {
              items: storedGroup.items,
              firstUrl: storedGroup.firstUrl || "",
              anchorFound: Boolean(storedGroup.anchorFound),
              anchorMatchMode: storedGroup.anchorMatchMode || "",
              matchedAnchor: storedGroup.matchedAnchor || "",
              listExhausted: Boolean(storedGroup.listExhausted),
            };
            console.log(
              `从进度文件恢复列表：${platform.id}/${category}/${statusFilter}，剩余 ${
                scan.items.filter((item) => !completedUrls.has(item.url)).length
              } 条。`,
            );
          } else {
            try {
              scan = await platform.scan(
                page,
                category,
                statusFilter,
                priorAnchor,
                {
                  ...options,
                  city,
                  maxItems: remaining,
                  knownBoundaryUrls,
                },
              );
              groups[anchorKey] = {
                priorAnchor,
                firstUrl: scan.firstUrl,
                anchorFound: scan.anchorFound,
                anchorMatchMode: scan.anchorMatchMode || "",
                matchedAnchor: scan.matchedAnchor || "",
                listExhausted: Boolean(scan.listExhausted),
                items: scan.items,
                scannedAt: new Date().toISOString(),
                status: "待采集详情",
              };
              removeFailure(
                (failure) =>
                  failure.stage === "list" &&
                  failure.platform === platform.id &&
                  failure.category === category &&
                  failure.status === statusFilter &&
                  (!failure.city || failure.city === city),
              );
              progress.current = {
                platform: platform.id,
                category,
                statusFilter,
                title: "列表扫描完成",
                url: scan.firstUrl || "",
              };
              await persistProgress({ forceWorkbook: true });
            } catch (error) {
              // 浏览器或验证标签页被关闭后，当前page对后续所有组都已失效。
              // 立即交给supervisor重建同一Profile会话，不能继续制造六条相同失败。
              if (isGlobalListSessionFailure(error)) {
                throw error;
              }
              failures.push({
                stage: "list",
                platform: platform.id,
                category,
                city,
                status: statusFilter,
                error: String(error),
              });
              progress.current = {
                platform: platform.id,
                category,
                statusFilter,
                title: "列表扫描失败，等待恢复后重试",
                url: "",
              };
              await persistProgress({ forceWorkbook: true });
              continue;
            }
          }
          const classificationCallbacks = {
            classificationCheckpoint: groups[anchorKey].classification,
            onClassificationProgress: async ({ checkpoint, category: verifiedCategory, index, total }) => {
              groups[anchorKey].classification = checkpoint;
              groups[anchorKey].status = `正在核验标的类型 ${index}/${total}`;
              progress.current = {
                platform: platform.id,
                category,
                statusFilter,
                stage: "category_classification",
                classificationCategory: verifiedCategory,
                classificationIndex: index,
                classificationTotal: total,
                title: `正在核验标的类型：${verifiedCategory}（${index}/${total}）`,
                url: scan.firstUrl || "",
              };
              await persistProgress();
            },
            onClassificationCheckpoint: async ({ checkpoint, category: verifiedCategory, index, total }) => {
              groups[anchorKey].classification = checkpoint;
              groups[anchorKey].status = checkpoint.status === "completed"
                ? "标的类型核验完成，待采集详情"
                : `正在核验标的类型 ${index}/${total}`;
              progress.current = {
                platform: platform.id,
                category,
                statusFilter,
                stage: "category_classification",
                classificationCategory: verifiedCategory,
                classificationIndex: index,
                classificationTotal: total,
                title: `正在核验标的类型：${verifiedCategory}（${index}/${total}）`,
                url: scan.firstUrl || "",
              };
              await persistProgress();
            },
          };
          if (platform.id === "alibaba_pc" && scan.items.length
            && scan.items.some((item) => item.categorySource !== "alibaba_pc_filter_membership")) {
            scan.items = await classifyAlibabaPcItemsByPlatform(page, scan.items, statusFilter, {
              ...options,
              city,
              ...classificationCallbacks,
            });
            groups[anchorKey].items = scan.items;
            groups[anchorKey].status = "待采集详情";
            await persistProgress();
          }
          if (platform.id === "jd_pc" && scan.items.length
            && scan.items.some((item) => item.categorySource !== "jd_pc_filter_membership")) {
            scan.items = await classifyJdPcItemsByPlatform(page, scan.items, statusFilter, {
              ...options,
              city,
              ...classificationCallbacks,
            });
            groups[anchorKey].items = scan.items;
            groups[anchorKey].status = "待采集详情";
            await persistProgress();
          }
          newAnchors[anchorKey] = scan.firstUrl || priorAnchor;
          if (scan.anchorMatchMode === "known_record_fallback") {
            evidence.push({
              action: "anchor-status-migration-fallback",
              platform: platform.id,
              category,
              city,
              status: statusFilter,
              missingPrimaryAnchor: priorAnchor,
              matchedKnownRecord: scan.matchedAnchor,
              message: "原高水位可能因开拍而迁移状态，已在第一条昨日已知记录处安全停止",
            });
          }
          if (scan.anchorMatchMode === "full_list_exhausted") {
            evidence.push({
              action: "anchor-missing-full-list-exhausted",
              platform: platform.id,
              category,
              city,
              status: statusFilter,
              missingPrimaryAnchor: priorAnchor,
              message: "原高水位已不在当前筛选列表，但已可靠扫描至列表末页；当前列表已完整枚举",
            });
          }
          if (priorAnchor && !scan.anchorFound) {
            failures.push({
              stage: "anchor",
              platform: platform.id,
              category,
              status: statusFilter,
              error: `在 ${options.maxPages} 页内未找到昨日锚点 ${priorAnchor}`,
            });
          } else {
            removeFailure(
              (failure) =>
                failure.stage === "anchor" &&
                failure.platform === platform.id &&
                failure.category === category &&
                failure.status === statusFilter &&
                (!failure.city || failure.city === city),
            );
          }
          if (options.scanOnly) {
            groups[anchorKey].status = scan.anchorFound ? "已完成预扫描" : "高水位未命中";
            await persistProgress({ forceWorkbook: true });
            continue;
          }
          for (const item of scan.items) {
            if (remaining <= 0) break;
            item.url = canonicalUrl(item.url);
            if (completedUrls.has(item.url)) continue;
            try {
              const record = await platform.parse(page, item, options);
              candidateState.records[record.网站链接] = record;
              completedUrls.add(record.网站链接);
              progress.newSavedCount += 1;
              removeFailure(
                (failure) =>
                  failure.stage === "detail" &&
                  canonicalUrl(failure.url || "") === record.网站链接,
              );
              evidence.push({
                action: "new-or-update",
                status: statusFilter,
                record,
              });
              remaining -= 1;
            } catch (error) {
              removeFailure(
                (failure) =>
                  failure.stage === "detail" &&
                  canonicalUrl(failure.url || "") === item.url,
              );
              if (error?.code === "EXCLUDED_NON_JUDICIAL_ASSET_TRADING") {
                completedUrls.add(item.url);
                evidence.push({
                  action: "excluded-non-judicial-asset-trading",
                  status: statusFilter,
                  platform: platform.id,
                  category,
                  title: item.title || "",
                  url: item.url,
                });
                remaining -= 1;
              } else if (error?.code === "ALIBABA_DETAIL_REDIRECTED_TO_PERSONAL_HOME") {
                completedUrls.add(item.url);
                evidence.push({
                  action: "deferred-alibaba-bankruptcy-layout",
                  status: statusFilter,
                  platform: platform.id,
                  category,
                  title: item.title || "",
                  url: item.url,
                  redirectUrl: page.url(),
                  capturedAt: new Date().toISOString(),
                });
                remaining -= 1;
                // The PC list queue is already persisted with the checkpoint.
                // Reopening the dynamic list after every redirected detail can
                // add minutes of waiting without improving recoverability.
                if (platform.id !== "alibaba_pc") {
                  await navigateAlibaba(page, ALIBABA_LIST_URL, options).catch((recoveryError) => {
                    console.warn(`阿里详情返回个人页后重开列表失败，将仍按已保存队列继续：${String(recoveryError)}`);
                  });
                }
              } else {
                failures.push({
                  stage: "detail",
                  platform: platform.id,
                  category,
                  status: statusFilter,
                  title: item.title || "",
                  url: item.url,
                  error: String(error),
                });
              }
            }
            progress.current = {
              platform: platform.id,
              category,
              statusFilter,
              title: item.title || "",
              url: item.url,
            };
            groups[anchorKey].status = scan.items.every((queuedItem) =>
              completedUrls.has(canonicalUrl(queuedItem.url)),
            )
              ? "已完成"
              : "部分完成";
            await persistProgress();
          }
        }
        }
      }
    }
    if (options.scanOnly) {
      progress.current = { platform: "", category: "", statusFilter: "", title: "预扫描完成", url: "" };
      await persistProgress({ forceWorkbook: true, status: "预扫描完成，等待详情采集" });
      return { scanOnly: true, groups };
    }
    }
  } finally {
    await closeContext(context);
  }

  candidateState.anchors = {
    ...candidateState.anchors,
    ...newAnchors,
  };
  candidateState.updatedAt = new Date().toISOString();

  const outputPath = path.join(runDir, `${dateKey}新增房源信息.xlsx`);
  progress.current = {
    platform: "",
    category: "",
    statusFilter: "",
    title: "正在检查并生成最终排序版",
    url: "",
  };
  await persistProgress({
    forceWorkbook: true,
    status: failures.length ? "部分完成，正在整理" : "正在整理最终表",
  });
  const records = currentRunRecords();
  const shellReviewItems = alibabaShellReviewItems(failures);
  const deferredAlibabaReviewItems = alibabaDeferredReviewItems(evidence);
  const conflictReviewItems = fieldConflictReviewItems(records);
  const workbookReviewItems = [
    ...shellReviewItems,
    ...deferredAlibabaReviewItems,
    ...conflictReviewItems,
  ];
  const workbookQa = await buildWorkbook({
    adapter: options.workbookAdapter,
    records,
    reviewItems: workbookReviewItems,
    outputPath,
    includeParties: options.includeParties,
  });
  const reviewNeeded = records
    .filter((record) => record._missing?.length)
    .map((record) => ({
      网站链接: record.网站链接,
      标的名称: record.标的名称,
      待复核字段: record._missing,
    }))
    .concat(
      shellReviewItems.map((item) => ({
        网站链接: item.网站链接,
        标的名称: item.标的名称,
        待复核字段: ["新版详情页空壳"],
        待复核原因: item.待复核原因,
      })),
    )
    .concat(
      deferredAlibabaReviewItems.map((item) => ({
        网站链接: item.网站链接,
        标的名称: item.标的名称,
        待复核字段: ["详情页布局"],
        待复核原因: item.待复核原因,
      })),
    )
    .concat(
      conflictReviewItems.map((item) => ({
        网站链接: item.网站链接,
        标的名称: item.标的名称,
        待复核字段: item.待复核字段,
        待复核原因: item.待复核原因,
      })),
    );
  await saveJson(path.join(runDir, "本次采集证据.json"), {
    capturedAt: candidateState.updatedAt,
    firstRun,
    evidence,
    failures,
  });
  await saveJson(path.join(runDir, "待人工复核.json"), reviewNeeded);
  await saveJson(path.join(runDir, "运行结果.json"), {
    workbookQa: {
      outputPath: workbookQa.outputPath,
      totalRows: workbookQa.totalRows,
      upcomingRows: workbookQa.upcomingRows,
      endedRows: workbookQa.endedRows,
      reviewRows: workbookQa.reviewRows,
      keyRange: workbookQa.keyRange,
      formulaErrors: workbookQa.formulaErrors,
    },
    failures,
    dryRun: options.dryRun,
    lowFrequency: options.lowFrequency,
    requestIntervalMs: options.lowFrequency ? options.requestIntervalMs : 0,
    stateAdvanced: !options.dryRun && failures.length === 0,
  });

  if (!options.dryRun && failures.length === 0) {
    await saveStateAtomic(statePath, candidateState);
  }
  progress.finalOutputPath = outputPath;
  progress.current = {
    platform: "",
    category: "",
    statusFilter: "",
    title: failures.length
      ? "存在待重试项目；重新运行相同命令可继续"
      : "全部采集、检查和排序完成",
    url: "",
  };
  await persistProgress({
    forceWorkbook: true,
    status: failures.length ? "部分完成（可续爬）" : "已完成",
  });
  const summary = {
    outputPath: workbookQa.outputPath,
    totalRows: workbookQa.totalRows,
    upcomingRows: workbookQa.upcomingRows,
    endedRows: workbookQa.endedRows,
    reviewNeeded: reviewNeeded.length,
    failures,
    stateAdvanced: !options.dryRun && failures.length === 0,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = failures.length ? 2 : 0;
}

function help() {
  console.log(`房源信息整理 Skill

用法：
  node run.mjs login [--state-dir DIR]
  node run.mjs seed-anchors --anchors-file FILE [--platform all|jd|alibaba] [--state-dir DIR]
  node run.mjs run [选项]

正式自动续爬请通过统一入口运行：
  node bin/auction-cli.mjs supervise [run选项] [监工选项]

常用选项：
  --headed / --headless
  --platform all|jd|alibaba
  --category 住宅用房,商业用房,工业用房
  --status 即将开始,已结束
  --max-items N
  --max-pages N
  --login-wait-minutes N
  --low-frequency
  --request-interval-ms N
  --checkpoint-every N
  --config FILE
  --workbook-adapter codex|standard
  --include-parties（仅用户明确要求时采集并输出债权人、债务人）
  --skip-historical-refresh（仅用户明确要求时跳过历史未结束记录刷新，直接扫描高水位增量）
  --restart
  --urls-file FILE
  --anchors-file FILE
  --state-dir DIR（默认 .\\path）
  --output-dir DIR
  --dry-run

监工选项：
  --supervisor-max-retries N（默认5）
  --supervisor-stall-minutes N（默认20）
  --supervisor-heartbeat-seconds N（默认30）
  --supervisor-no-notify

正式运行默认打开可见的 Microsoft Edge；如检测到淘宝未登录，会提示并等待人工登录后自动继续。
正式列表采集前，阿里资产和京东拍卖均须具备三个分类中“即将开始”和“已结束”的全部前一日高水位；缺少时程序会逐项提示并在打开 Edge 前停止。
用户提供缺失链接后，用 seed-anchors 导入；可分批导入，但只有全部齐全后才能执行 run。
默认分别筛选“即将开始、已结束”，并导出“总表”、两个同名状态分表和“待复核”分表。
阿里“即将开始”使用“最新发布”排序；阿里“已结束”使用“结拍时间由近到远”排序。
京东页面跳转、筛选、排序和翻页前随机等待 3–5 秒；认证完成后会重新检查并恢复筛选。
每成功或失败处理一条记录都会原子保存“采集进度.json”；默认每条记录刷新一次“_采集中.xlsx”。意外中断后重新运行相同命令会自动跳过已保存链接并续爬。
--checkpoint-every N 可调整临时Excel刷新间隔；--restart 明确放弃当日未完成游标并重新建立进度。
首次采集必须由用户明确选择结果目录，并使用 --output-dir DIR 传入；选择会保存在外部 stateDir\\output-settings.json 中供后续复用。未选择且无历史设置时，程序会在打开Edge前停止。
输出目录为 <output-dir>\\YYYYMMDD\\YYYYMMDD新增房源信息.xlsx。
--low-frequency 会复用单一 Edge 会话，并在阿里页面请求之间保持固定最小间隔（默认 8000 毫秒）。`);
}

async function main() {
  const loaded = await loadRunConfig(process.argv.slice(2));
  const options = parseArgs(loaded.argv, loaded.config);
  if (options.command === "help") return help();
  if (options.command === "login") return login(options);
  if (options.command === "seed-anchors") return seedAnchors(options);
  if (options.command === "run") {
    await resolveRememberedOutputDir(options);
    return run(options);
  }
  throw new Error(`未知命令：${options.command}`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    await main();
    process.exit(process.exitCode || 0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

export {
  applyAlibabaPcPlatformMembership,
  applyJdPcPlatformMembership,
  classifyAlibabaPcItemsByPlatform,
  classifyJdPcItemsByPlatform,
  applyAlibabaSortFilter,
  applyAlibabaStatusFilter,
  buildAlibabaPcListUrl,
  isAlibabaPcPaginationOnlyMismatch,
  verifyAlibabaPcListUrl,
  classifyAlibabaPcCategory,
  inferAlibabaPcTitle,
  isAlibabaBankruptcyCardText,
  parseAlibabaPcCardText,
  alibabaPcCategoryScope,
  alibabaDeferredReviewItems,
  alibabaShellReviewItems,
  canonicalUrl,
  detectAlibabaOutcome,
  detectOutcome,
  interpretJdResult,
  detectStage,
  extractAlibabaInvestigation,
  extractAuctionDates,
  extractAreaByPriority,
  extractAreaFromText,
  extractParty,
  extractOwnerFromTitle,
  fieldConflictReviewItems,
  inferStatusGroup,
  isGlobalListSessionFailure,
  isAlibabaAssetTradingPage,
  isAlibabaPersonalHomeRedirectUrl,
  jdActionDelayMs,
  jdCategoryControls,
  jdFilterPlan,
  assertHighWaterCompleteness,
  formatMissingHighWaterMarks,
  matchesStatusFilter,
  missingHighWaterMarks,
  normalizeAnchorPayload,
  closeContext,
  navigateAlibaba,
  openContext,
  parseArgs,
  parseMoney,
  qualityFields,
  progressPlan,
  classifyPropertyType,
  cleanPropertyTitle,
  resolveRememberedOutputDir,
  restoreCheckpointRecords,
  assertCheckpointMonotonicity,
  dateKeyForRun,
  shouldStopListScan,
  resolveAnchorBoundary,
  resolveAuctionDates,
  restorePcClassificationCheckpoint as restoreJdPcClassificationCheckpoint,
  splitLocation,
  main,
};
