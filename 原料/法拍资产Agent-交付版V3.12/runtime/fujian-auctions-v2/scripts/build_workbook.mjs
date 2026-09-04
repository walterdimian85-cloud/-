import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtifactTool } from "./runtime.mjs";
import { cleanPropertyTitle } from "../src/extractors/title.mjs";
import { extractCommunityName } from "../src/extractors/community.mjs";

export { extractCommunityName };

const PINYIN_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  numeric: true,
});
const PLATFORM_ORDER = new Map([
  ["阿里资产", 0],
  ["京东拍卖", 1],
]);
export const STATUS_SHEETS = ["即将开始", "成交标的", "流拍标的"];
export const REVIEW_SHEET = "待复核";

export const UPCOMING_HEADERS = [
  "所在省份",
  "城市",
  "区域",
  "标的名称",
  "小区名称（仅供参考）",
  "标的类型",
  "平台",
  "发拍次数",
  "拍卖时间",
  "是否成交",
  "处置法院",
  "面积/㎡",
  "起拍单价-元/㎡",
  "起拍价格",
  "评估价",
  "折扣率(%)",
  "备注",
  "网站链接",
];
export const ENDED_HEADERS = [
  ...UPCOMING_HEADERS.slice(0, 16),
  "成交金额",
  "溢价率",
  "成交单价",
  "竞买记录",
  "报名人数",
  ...UPCOMING_HEADERS.slice(16),
];
export const FAILED_HEADERS = ENDED_HEADERS.filter(
  (header) => !["成交金额", "溢价率", "成交单价"].includes(header),
);
// Backward-compatible export for callers that only need the upcoming schema.
export const HEADERS = UPCOMING_HEADERS;
export const PARTY_HEADERS = ["债权人", "债务人"];

export function dataHeaders(includeParties = false, statusGroup = "即将开始") {
  const headers =
    statusGroup === "成交标的" || statusGroup === "已结束"
      ? ENDED_HEADERS
      : statusGroup === "流拍标的"
        ? FAILED_HEADERS
        : UPCOMING_HEADERS;
  if (!includeParties) return [...headers];
  return [...headers.slice(0, 13), ...PARTY_HEADERS, ...headers.slice(13)];
}

function columnLetter(columnNumber) {
  let value = columnNumber;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export const REVIEW_HEADERS = [
  "平台",
  "标的类型",
  "列表状态",
  "标的名称",
  "网站链接",
  "待复核原因",
  "记录时间",
];

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  // Artifact Tool writes Date values using UTC components. Auction timestamps
  // are stored as absolute ISO instants, so shift them to a Shanghai wall-clock
  // Date before export to make Excel display the source page's UTC+8 time.
  return new Date(date.valueOf() + 8 * 60 * 60 * 1000);
}

function rawDateValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.valueOf();
}

function auctionTimeForRecord(record) {
  if (record.拍卖时间) return record.拍卖时间;
  if (statusBucket(record) === "已结束") {
    return /^按/u.test(String(record._endTimeSource || ""))
      ? null
      : record.竞拍结束时间;
  }
  return record.发拍时间;
}

export function statusBucket(record, nowMs = Date.now()) {
  const explicit =
    record._状态分组 || record._statusGroup || record.状态分组 || "";
  if (STATUS_SHEETS.includes(explicit)) return explicit;
  if (record.是否成交 === "即将开始") return "即将开始";
  if (["是", "否", "已撤回", "已中止", "已暂缓"].includes(record.是否成交)) {
    return "已结束";
  }
  const start = rawDateValue(record.发拍时间);
  const end = rawDateValue(record.竞拍结束时间);
  if (start !== null && start > nowMs) return "即将开始";
  if (end !== null) return end > nowMs ? "即将开始" : "已结束";
  return "即将开始";
}

function cleanedTitle(value) {
  return cleanPropertyTitle(value);
}

export function recordRow(record, includeParties = false, statusGroup = statusBucket(record)) {
  const title = cleanedTitle(record.标的名称) || record.标的名称 || "";
  const area = Number.isFinite(record["面积/㎡"])
    ? record["面积/㎡"]
    : "未找到";
  const baseRow = [
    record.所在省份 || "福建省",
    record.城市 || "",
    record.区域 || "",
    title,
    record["小区名称（仅供参考）"] ||
      extractCommunityName({ ...record, 标的名称: title }),
    record.标的类型 || "",
    record.平台 || "",
    record.发拍次数 || "",
    asDate(auctionTimeForRecord(record)),
    record.是否成交 || "待核验",
    record.处置法院 || "未找到",
    area,
    null,
    Number.isFinite(record.起拍价格) ? record.起拍价格 : null,
    Number.isFinite(record.评估价) ? record.评估价 : null,
    null,
    record.备注 || "",
    record.网站链接 || "",
  ];
  const endedRow = [
    ...baseRow.slice(0, 16),
    Number.isFinite(record.成交金额) ? record.成交金额 : null,
    null,
    null,
    Number.isInteger(record.竞买记录) ? record.竞买记录 : null,
    Number.isInteger(record.报名人数) ? record.报名人数 : null,
    ...baseRow.slice(16),
  ];
  const row = statusGroup === "成交标的" || statusGroup === "已结束"
    ? [
        ...endedRow,
      ]
    : statusGroup === "流拍标的"
      ? ENDED_HEADERS.map((header, index) => ({ header, value: endedRow[index] }))
          .filter(({ header }) => FAILED_HEADERS.includes(header))
          .map(({ value }) => value)
      : baseRow;
  if (includeParties) {
    row.splice(13, 0, record.债权人 || "未找到", record.债务人 || "未找到");
  }
  return row;
}

export function workbookSheetForRecord(record) {
  if (statusBucket(record) === "即将开始") return "即将开始";
  return record.是否成交 === "是" ? "成交标的" : "流拍标的";
}

export function sortRecords(records) {
  return [...records].sort((left, right) => {
    const platformOrder =
      (PLATFORM_ORDER.get(String(left.平台 || "")) ?? 99) -
      (PLATFORM_ORDER.get(String(right.平台 || "")) ?? 99);
    if (platformOrder !== 0) return platformOrder;
    const cityOrder = PINYIN_COLLATOR.compare(
      String(left.城市 || ""),
      String(right.城市 || ""),
    );
    if (cityOrder !== 0) return cityOrder;
    const areaOrder = PINYIN_COLLATOR.compare(
      String(left.区域 || ""),
      String(right.区域 || ""),
    );
    if (areaOrder !== 0) return areaOrder;
    const leftTime = asDate(auctionTimeForRecord(left))?.valueOf() || 0;
    const rightTime = asDate(auctionTimeForRecord(right))?.valueOf() || 0;
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(left.网站链接 || "").localeCompare(String(right.网站链接 || ""), "zh-CN");
  });
}

async function addDataSheet(
  workbook,
  name,
  records,
  tableName,
  preserveOrder = false,
  includeParties = false,
) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(3);

  const headers = dataHeaders(includeParties, name);
  const lastColumn = columnLetter(headers.length);
  sheet.getRange(`A1:${lastColumn}1`).values = [headers];
  sheet.getRange(`A1:${lastColumn}1`).format = {
    fill: "#E2F0D9",
    font: { bold: true, color: "#1F2937", typeface: "宋体", fontSize: 11 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: {
      bottom: { style: "medium", color: "#A9D18E" },
    },
  };
  sheet.getRange(`A1:${lastColumn}1`).format.rowHeight = 28;

  const sorted = preserveOrder ? [...records] : sortRecords(records);
  const lastRow = sorted.length + 1;
  if (sorted.length > 0) {
    const rows = sorted.map((record) => recordRow(record, includeParties, name));
    sheet.getRange(`A2:${lastColumn}${lastRow}`).values = rows;
    sheet.getRange(`A2:${lastColumn}${lastRow}`).format = {
      font: { typeface: "宋体", fontSize: 10 },
      verticalAlignment: "center",
      borders: {
        bottom: { style: "thin", color: "#D9EAD3" },
      },
    };
    sheet.getRange(`A2:C${lastRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`F2:J${lastRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`L2:M${lastRow}`).format.horizontalAlignment = "right";
    const columnOf = (header) => columnLetter(headers.indexOf(header) + 1);
    const startPriceColumn = columnOf("起拍价格");
    const assessmentPriceColumn = columnOf("评估价");
    const discountRateColumn = columnOf("折扣率(%)");
    const transactionColumn = headers.includes("成交金额")
      ? columnOf("成交金额")
      : null;
    const premiumRateColumn = headers.includes("溢价率") ? columnOf("溢价率") : null;
    const transactionUnitPriceColumn = headers.includes("成交单价") ? columnOf("成交单价") : null;
    const bidCountColumn = headers.includes("竞买记录") ? columnOf("竞买记录") : null;
    const registrationColumn = headers.includes("报名人数") ? columnOf("报名人数") : null;
    const noteColumn = columnOf("备注");
    const linkColumn = columnOf("网站链接");
    const numericEndColumn = transactionColumn || startPriceColumn;
    sheet.getRange(`${startPriceColumn}2:${numericEndColumn}${lastRow}`).format.horizontalAlignment = "right";
    if (bidCountColumn && registrationColumn) {
      sheet.getRange(`${bidCountColumn}2:${registrationColumn}${lastRow}`).format.horizontalAlignment = "center";
    }
    sheet.getRange(`D2:D${lastRow}`).format.horizontalAlignment = "left";
    sheet.getRange(`E2:E${lastRow}`).format.horizontalAlignment = "left";
    sheet.getRange(`K2:K${lastRow}`).format.horizontalAlignment = "left";
    if (includeParties) {
      sheet.getRange(`N2:O${lastRow}`).format.horizontalAlignment = "left";
    }
    sheet.getRange(`${noteColumn}2:${noteColumn}${lastRow}`).format.horizontalAlignment = "left";
    sheet.getRange(`${linkColumn}2:${linkColumn}${lastRow}`).format.horizontalAlignment = "left";
    sheet.getRange(`D2:E${lastRow}`).format.wrapText = true;
    sheet.getRange(`K2:${includeParties ? "O" : "M"}${lastRow}`).format.wrapText = true;
    sheet.getRange(`${noteColumn}2:${linkColumn}${lastRow}`).format.wrapText = true;

    sheet.getRange(`I2:I${lastRow}`).format.numberFormat = "mm-dd";
    sheet.getRange(`L2:L${lastRow}`).format.numberFormat = "0.00";
    sheet.getRange(`M2:M${lastRow}`).format.numberFormat = "#,##0.00";
    sheet.getRange(`${startPriceColumn}2:${numericEndColumn}${lastRow}`).format.numberFormat = "#,##0";
    sheet.getRange(`${assessmentPriceColumn}2:${assessmentPriceColumn}${lastRow}`).format.numberFormat = "#,##0.####";
    if (bidCountColumn && registrationColumn) {
      sheet.getRange(`${bidCountColumn}2:${registrationColumn}${lastRow}`).format.numberFormat = "#,##0";
    }

    sheet.getRange("M2").formulas = [
      [
        `=IF(AND(ISNUMBER(${startPriceColumn}2),ISNUMBER(L2),L2>0),ROUND(${startPriceColumn}2/L2,2),"")`,
      ],
    ];
    sheet.getRange(`M2:M${lastRow}`).fillDown();

    sheet.getRange(`${discountRateColumn}2`).formulas = [[
        `=IF(AND(ISNUMBER(${startPriceColumn}2),ISNUMBER(${assessmentPriceColumn}2),${assessmentPriceColumn}2>0),${startPriceColumn}2/${assessmentPriceColumn}2,"")`,
    ]];
    sheet.getRange(`${discountRateColumn}2:${discountRateColumn}${lastRow}`).fillDown();
    sheet.getRange(`${discountRateColumn}2:${discountRateColumn}${lastRow}`).format.numberFormat = "0.00%";

    if (premiumRateColumn && transactionUnitPriceColumn) {
      sheet.getRange(`${premiumRateColumn}2`).formulas = [[
        `=IF(AND(ISNUMBER(${transactionColumn}2),ISNUMBER(${startPriceColumn}2),${startPriceColumn}2>0),(${transactionColumn}2-${startPriceColumn}2)/${startPriceColumn}2,"")`,
      ]];
      sheet.getRange(`${premiumRateColumn}2:${premiumRateColumn}${lastRow}`).fillDown();
      sheet.getRange(`${premiumRateColumn}2:${premiumRateColumn}${lastRow}`).format.numberFormat = "0.00%";
      sheet.getRange(`${transactionUnitPriceColumn}2`).formulas = [[
        `=IF(AND(ISNUMBER(${transactionColumn}2),ISNUMBER(L2),L2>0),ROUND(${transactionColumn}2/L2,2),"")`,
      ]];
      sheet.getRange(`${transactionUnitPriceColumn}2:${transactionUnitPriceColumn}${lastRow}`).fillDown();
      sheet.getRange(`${transactionUnitPriceColumn}2:${transactionUnitPriceColumn}${lastRow}`).format.numberFormat = "#,##0.00";
    }

  }
  // Do not create a styled Excel table here. Table styles override the desired
  // white body rows and may substitute Carlito for Chinese text in some hosts.
  // The sheet keeps its explicit green header, white body and frozen panes.

  const widthByHeader = {
    所在省份: 10, 城市: 10, 区域: 11, 标的名称: 42, "小区名称（仅供参考）": 24,
    标的类型: 10, 平台: 11, 发拍次数: 10, 拍卖时间: 11, 是否成交: 14,
    处置法院: 23, "面积/㎡": 12, "起拍单价-元/㎡": 16, 债权人: 25, 债务人: 25,
    起拍价格: 14, 评估价: 15, "折扣率(%)": 12,
    成交金额: 14, 溢价率: 12, 成交单价: 14,
    竞买记录: 12, 报名人数: 12, 备注: 32, 网站链接: 48,
  };
  const widths = headers.map((header) => widthByHeader[header] || 14);
  for (let index = 0; index < widths.length; index += 1) {
    sheet.getRangeByIndexes(0, index, Math.max(2, sorted.length + 1), 1).format.columnWidth =
      widths[index];
  }
  return sheet;
}

async function addProgressSheet(workbook, progressInfo) {
  const sheet = workbook.worksheets.add("采集进度");
  sheet.showGridLines = false;
  sheet.getRange("A1:B1").values = [["进度项目", "当前状态"]];
  sheet.getRange("A1:B1").format = {
    fill: "#D9EAF7",
    font: { bold: true, color: "#1F4E78", typeface: "宋体", fontSize: 11 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { bottom: { style: "medium", color: "#9DC3E6" } },
  };
  const rows = [
    ["运行状态", progressInfo.status || "采集中"],
    ["已成功保存", Number(progressInfo.savedCount || 0)],
    ["待重试/失败", Number(progressInfo.failureCount || 0)],
    ["当前平台", progressInfo.platform || ""],
    ["当前分类", progressInfo.category || ""],
    ["当前列表状态", progressInfo.statusFilter || ""],
    ["当前标的", progressInfo.currentTitle || ""],
    ["当前链接", progressInfo.currentUrl || ""],
    ["最近保存时间", asDate(progressInfo.updatedAt)],
    ["恢复说明", progressInfo.resumeHint || "重新运行相同命令将自动续爬"],
  ];
  sheet.getRange("A2:B11").values = rows;
  sheet.getRange("A2:A11").format = {
    fill: "#EAF3F8",
    font: { bold: true, typeface: "宋体", fontSize: 10 },
    verticalAlignment: "center",
  };
  sheet.getRange("B2:B11").format = {
    font: { typeface: "宋体", fontSize: 10 },
    verticalAlignment: "center",
    wrapText: true,
  };
  sheet.getRange("B10").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  sheet.getRange("A1:B11").format.borders = {
    preset: "all",
    style: "thin",
    color: "#D9E2F3",
  };
  sheet.getRange("A1:A11").format.columnWidth = 18;
  sheet.getRange("B1:B11").format.columnWidth = 70;
  sheet.freezePanes.freezeRows(1);
  return sheet;
}

async function addReviewSheet(workbook, reviewItems) {
  const sheet = workbook.worksheets.add(REVIEW_SHEET);
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.getRange("A1:G1").values = [REVIEW_HEADERS];
  sheet.getRange("A1:G1").format = {
    fill: "#FFF2CC",
    font: { bold: true, color: "#7F6000", typeface: "宋体", fontSize: 11 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: {
      bottom: { style: "medium", color: "#FFD966" },
    },
  };
  sheet.getRange("A1:G1").format.rowHeight = 28;

  const lastRow = reviewItems.length + 1;
  if (reviewItems.length > 0) {
    sheet.getRange(`A2:G${lastRow}`).values = reviewItems.map((item) => [
      item.平台 || "阿里资产",
      item.标的类型 || "",
      item.列表状态 || "",
      item.标的名称 || "",
      item.网站链接 || "",
      item.待复核原因 || "新版详情页未返回可解析内容，需人工核验",
      asDate(item.记录时间),
    ]);
    sheet.getRange(`A2:G${lastRow}`).format = {
      font: { typeface: "宋体", fontSize: 10 },
      verticalAlignment: "center",
      borders: {
        bottom: { style: "thin", color: "#FCE4A6" },
      },
    };
    sheet.getRange(`A2:C${lastRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`D2:F${lastRow}`).format.horizontalAlignment = "left";
    sheet.getRange(`G2:G${lastRow}`).format.horizontalAlignment = "center";
    sheet.getRange(`D2:F${lastRow}`).format.wrapText = true;
    sheet.getRange(`G2:G${lastRow}`).format.numberFormat = "yyyy-mm-dd hh:mm";
  }
  if (reviewItems.length > 0) {
    const table = sheet.tables.add(`A1:G${lastRow}`, true, "AuctionReview");
    table.style = "TableStyleMedium5";
    table.showFilterButton = true;
  }
  const widths = [12, 13, 12, 42, 50, 38, 18];
  for (let index = 0; index < widths.length; index += 1) {
    sheet.getRangeByIndexes(
      0,
      index,
      Math.max(2, reviewItems.length + 1),
      1,
    ).format.columnWidth = widths[index];
  }
  return sheet;
}

export async function buildWorkbook({
  records,
  reviewItems = [],
  outputPath,
  previewDir,
  preserveOrder = false,
  progressInfo = null,
  includeParties = false,
}) {
  const { SpreadsheetFile, Workbook } = await loadArtifactTool();
  const workbook = Workbook.create();
  const allRecords = preserveOrder ? [...records] : sortRecords(records);
  const upcomingRecords = allRecords.filter(
    (record) => workbookSheetForRecord(record) === "即将开始",
  );
  const succeededRecords = allRecords.filter(
    (record) => workbookSheetForRecord(record) === "成交标的",
  );
  const failedRecords = allRecords.filter(
    (record) => workbookSheetForRecord(record) === "流拍标的",
  );
  const endedRecords = [...succeededRecords, ...failedRecords];

  if (progressInfo) await addProgressSheet(workbook, progressInfo);
  await addDataSheet(
    workbook,
    "即将开始",
    upcomingRecords,
    "AuctionUpcoming",
    preserveOrder,
    includeParties,
  );
  await addDataSheet(
    workbook,
    "成交标的",
    succeededRecords,
    "AuctionSucceeded",
    preserveOrder,
    includeParties,
  );
  await addDataSheet(
    workbook,
    "流拍标的",
    failedRecords,
    "AuctionFailed",
    preserveOrder,
    includeParties,
  );
  const upcomingLastColumn = columnLetter(dataHeaders(includeParties, "即将开始").length);
  const succeededLastColumn = columnLetter(dataHeaders(includeParties, "成交标的").length);
  const failedLastColumn = columnLetter(dataHeaders(includeParties, "流拍标的").length);
  const keyRange = `成交标的!A1:${succeededLastColumn}${Math.min(succeededRecords.length + 1, 31)}`;
  const inspection = await workbook.inspect({
    kind: "region,formula",
    sheetId: "成交标的",
    range: `A1:${succeededLastColumn}${Math.min(succeededRecords.length + 1, 31)}`,
    maxChars: 12000,
    tableMaxRows: 31,
    tableMaxCols: 18,
  });
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "final formula error scan",
  });

  if (previewDir) {
    await fs.mkdir(previewDir, { recursive: true });
    const sheetRows = {
      即将开始: upcomingRecords.length,
      成交标的: succeededRecords.length,
      流拍标的: failedRecords.length,
    };
    const previewSheets = progressInfo
      ? ["采集进度", ...STATUS_SHEETS]
      : [...STATUS_SHEETS];
    for (const sheetName of previewSheets) {
      const lastColumn =
        sheetName === "采集进度"
          ? "B"
          : sheetName === "成交标的"
            ? succeededLastColumn
            : sheetName === "流拍标的"
              ? failedLastColumn
              : upcomingLastColumn;
      const preview = await workbook.render({
        sheetName,
        range: `A1:${lastColumn}${Math.min(
          sheetName === "采集进度" ? 11 : sheetRows[sheetName] + 1,
          25,
        )}`,
        scale: 1.25,
        format: "png",
      });
      await fs.writeFile(
        path.join(previewDir, `${sheetName}.png`),
        new Uint8Array(await preview.arrayBuffer()),
      );
    }
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(outputPath);
  return {
    outputPath: path.resolve(outputPath),
    totalRows: allRecords.length,
    upcomingRows: upcomingRecords.length,
    endedRows: endedRecords.length,
    succeededRows: succeededRecords.length,
    failedRows: failedRecords.length,
    reviewRows: reviewItems.length,
    keyRange,
    inspection: inspection.ndjson,
    formulaErrors: errors.ndjson,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const includeParties = args.includes("--include-parties");
  const [recordsPath, outputPath, previewDir] = args.filter(
    (value) => value !== "--include-parties",
  );
  if (!recordsPath || !outputPath) {
    throw new Error(
      "Usage: node build_workbook.mjs <records.json> <output.xlsx> [preview-dir]",
    );
  }
  const payload = JSON.parse(await fs.readFile(recordsPath, "utf8"));
  const records = Array.isArray(payload) ? payload : payload.records || [];
  const reviewItems = Array.isArray(payload)
    ? []
    : (payload.failures || []).map((item) => ({
        平台: item.platform === "alibaba" ? "阿里资产" : "京东拍卖",
        标的类型: item.category || "",
        列表状态: item.status || "",
        标的名称: item.title || "",
        网站链接: item.url || "",
        待复核原因: item.error || "详情页未返回可解析内容",
        记录时间: payload.updatedAt || new Date().toISOString(),
      }));
  console.log(
    JSON.stringify(
      await buildWorkbook({ records, reviewItems, outputPath, previewDir, includeParties }),
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
