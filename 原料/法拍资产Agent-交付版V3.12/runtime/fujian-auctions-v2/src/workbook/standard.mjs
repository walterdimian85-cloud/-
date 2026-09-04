import fs from "node:fs/promises";
import path from "node:path";
import {
  REVIEW_HEADERS,
  REVIEW_SHEET,
  STATUS_SHEETS,
  dataHeaders,
  recordRow,
  sortRecords,
  statusBucket,
  workbookSheetForRecord,
} from "../../scripts/build_workbook.mjs";

const HEADER_FILL = "FFE2F0D9";
const HEADER_FONT = "FF1F2937";
const BORDER_COLOR = "FFD9EAD3";

function withRiskNote(record = {}) {
  const warnings = [];
  const area = Number(record["面积/㎡"]);
  const startPrice = Number(record.起拍价格);
  const residentialOrCommercial = ["住宅", "商业", "住宅用房", "商业用房"].includes(record.标的类型)
    || /住宅|商业/u.test(record._源分类 || "");
  if (residentialOrCommercial && Number.isFinite(area) && area > 10_000) {
    warnings.push(`数据疑似有误：${record.标的类型 || "住宅/商业"}面积为${area}㎡，超过10000㎡`);
  }
  if (Number.isFinite(area) && area > 0 && Number.isFinite(startPrice) && startPrice > 0) {
    const unitPrice = startPrice / area;
    if (unitPrice > 100_000 || unitPrice < 500) {
      warnings.push(`数据疑似有误：起拍单价约${Math.round(unitPrice)}元/㎡，超出500—100000元/㎡常规核验区间`);
    }
  }
  const note = String(record.备注 || "").trim();
  const additions = warnings.filter((warning) => !note.includes(warning));
  return additions.length ? { ...record, 备注: [note, ...additions].filter(Boolean).join("；") } : record;
}

function excelColumnLetter(columnNumber) {
  let value = columnNumber;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { name: "宋体", size: 11, bold: true, color: { argb: HEADER_FONT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FFA9D18E" } } };
  });
}

function bodyFontName(value) {
  if (typeof value === "number" || value instanceof Date) return "Times New Roman";
  if (typeof value === "string" && !/[\u3400-\u9fff]/u.test(value)) return "Times New Roman";
  return "宋体";
}

function styleBody(worksheet, lastRow, headers) {
  if (lastRow < 2) return;
  const columnOf = (header) => headers.indexOf(header) + 1;
  const startPriceColumn = columnOf("起拍价格");
  const assessmentPriceColumn = columnOf("评估价");
  const discountRateColumn = columnOf("折扣率(%)");
  const transactionColumn = columnOf("成交金额");
  const bidCountColumn = columnOf("竞买记录");
  const registrationColumn = columnOf("报名人数");
  const premiumRateColumn = columnOf("溢价率");
  const transactionUnitPriceColumn = columnOf("成交单价");
  for (let rowIndex = 2; rowIndex <= lastRow; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: bodyFontName(cell.value), size: 10 };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
    });
    row.getCell(9).numFmt = "mm-dd";
    row.getCell(12).numFmt = "0.00";
    row.getCell(13).numFmt = "#,##0.00";
    row.getCell(startPriceColumn).numFmt = "#,##0";
    row.getCell(assessmentPriceColumn).numFmt = "#,##0.####";
    if (transactionColumn > 0) row.getCell(transactionColumn).numFmt = "#,##0";
    if (bidCountColumn > 0) row.getCell(bidCountColumn).numFmt = "#,##0";
    if (registrationColumn > 0) row.getCell(registrationColumn).numFmt = "#,##0";
    const startPrice = Number(row.getCell(startPriceColumn).value);
    const area = Number(row.getCell(12).value);
    row.getCell(13).value = {
      formula: `IF(AND(ISNUMBER(${excelColumnLetter(startPriceColumn)}${rowIndex}),ISNUMBER(L${rowIndex}),L${rowIndex}>0),ROUND(${excelColumnLetter(startPriceColumn)}${rowIndex}/L${rowIndex},2),"")`,
      result: Number.isFinite(startPrice) && Number.isFinite(area) && area > 0
        ? Math.round((startPrice / area) * 100) / 100
        : "",
    };
    const assessmentPrice = Number(row.getCell(assessmentPriceColumn).value);
    row.getCell(discountRateColumn).value = {
      formula: `IF(AND(ISNUMBER(${excelColumnLetter(startPriceColumn)}${rowIndex}),ISNUMBER(${excelColumnLetter(assessmentPriceColumn)}${rowIndex}),${excelColumnLetter(assessmentPriceColumn)}${rowIndex}>0),${excelColumnLetter(startPriceColumn)}${rowIndex}/${excelColumnLetter(assessmentPriceColumn)}${rowIndex},"")`,
      result: Number.isFinite(startPrice) && Number.isFinite(assessmentPrice) && assessmentPrice > 0
        ? startPrice / assessmentPrice
        : "",
    };
    row.getCell(discountRateColumn).numFmt = "0.00%";
    if (premiumRateColumn > 0 && transactionUnitPriceColumn > 0) {
      const transactionAmount = Number(row.getCell(transactionColumn).value);
      row.getCell(premiumRateColumn).value = {
        formula: `IF(AND(ISNUMBER(${excelColumnLetter(transactionColumn)}${rowIndex}),ISNUMBER(${excelColumnLetter(startPriceColumn)}${rowIndex}),${excelColumnLetter(startPriceColumn)}${rowIndex}>0),(${excelColumnLetter(transactionColumn)}${rowIndex}-${excelColumnLetter(startPriceColumn)}${rowIndex})/${excelColumnLetter(startPriceColumn)}${rowIndex},"")`,
        result: Number.isFinite(transactionAmount) && Number.isFinite(startPrice) && startPrice > 0
          ? (transactionAmount - startPrice) / startPrice
          : "",
      };
      row.getCell(premiumRateColumn).numFmt = "0.00%";
      row.getCell(transactionUnitPriceColumn).value = {
        formula: `IF(AND(ISNUMBER(${excelColumnLetter(transactionColumn)}${rowIndex}),ISNUMBER(L${rowIndex}),L${rowIndex}>0),ROUND(${excelColumnLetter(transactionColumn)}${rowIndex}/L${rowIndex},2),"")`,
        result: Number.isFinite(transactionAmount) && Number.isFinite(area) && area > 0
          ? Math.round((transactionAmount / area) * 100) / 100
          : "",
      };
      row.getCell(transactionUnitPriceColumn).numFmt = "#,##0.00";
    }
  }
  // Avoid a header-only AutoFilter range. Desktop Excel may remove or repair
  // such structures when a status sheet has no data rows.
  if (lastRow > 1) {
    worksheet.autoFilter = { from: "A1", to: `${excelColumnLetter(headers.length)}${lastRow}` };
  }
}

function addDataSheet(workbook, name, records, includeParties, preserveOrder) {
  const worksheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", xSplit: 3, ySplit: 1, showGridLines: false }],
  });
  const headers = dataHeaders(includeParties, name);
  const sorted = preserveOrder ? [...records] : sortRecords(records);
  worksheet.addRow(headers);
  for (const record of sorted) worksheet.addRow(recordRow(record, includeParties, name));
  styleHeader(worksheet.getRow(1));
  styleBody(worksheet, sorted.length + 1, headers);
  const widths = {
    所在省份: 10, 城市: 10, 区域: 11, 标的名称: 42, "小区名称（仅供参考）": 24,
    标的类型: 10, 平台: 11, 发拍次数: 10, 拍卖时间: 11, 是否成交: 14,
    处置法院: 23, "面积/㎡": 12, "起拍单价-元/㎡": 16, 债权人: 25, 债务人: 25,
    起拍价格: 14, 评估价: 15, "折扣率(%)": 12,
    成交金额: 14, 溢价率: 12, 成交单价: 14,
    竞买记录: 12, 报名人数: 12, 备注: 32, 网站链接: 48,
  };
  worksheet.columns.forEach((column, index) => { column.width = widths[headers[index]] || 14; });
  return worksheet;
}

function addProgressSheet(workbook, progressInfo) {
  const worksheet = workbook.addWorksheet("采集进度", { views: [{ showGridLines: false }] });
  worksheet.addRows([
    ["进度项目", "当前状态"],
    ["运行状态", progressInfo.status || "采集中"],
    ["已保存记录", progressInfo.savedCount || 0],
    ["失败记录", progressInfo.failureCount || 0],
    ["当前平台", progressInfo.platform || ""],
    ["当前分类", progressInfo.category || ""],
    ["当前状态", progressInfo.statusFilter || ""],
    ["当前标的", progressInfo.currentTitle || ""],
    ["当前链接", progressInfo.currentUrl || ""],
    ["最近保存", progressInfo.updatedAt || ""],
    ["恢复说明", progressInfo.resumeHint || "重新运行相同命令将自动续爬"],
  ]);
  styleHeader(worksheet.getRow(1));
  worksheet.columns = [{ width: 18 }, { width: 80 }];
}

function addReviewSheet(workbook, reviewItems) {
  const worksheet = workbook.addWorksheet(REVIEW_SHEET, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  worksheet.addRow(REVIEW_HEADERS);
  for (const item of reviewItems) {
    worksheet.addRow(REVIEW_HEADERS.map((header) => item[header] || ""));
  }
  styleHeader(worksheet.getRow(1));
  worksheet.columns = [12, 12, 12, 42, 48, 36, 22].map((width) => ({ width }));
}

export async function buildStandardWorkbook({
  records,
  reviewItems = [],
  outputPath,
  preserveOrder = false,
  progressInfo = null,
  includeParties = false,
}) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "fujian-auctions";
  workbook.created = new Date();
  const annotatedRecords = records.map(withRiskNote);
  const allRecords = preserveOrder ? annotatedRecords : sortRecords(annotatedRecords);
  const upcomingRecords = allRecords.filter((record) => workbookSheetForRecord(record) === "即将开始");
  const succeededRecords = allRecords.filter((record) => workbookSheetForRecord(record) === "成交标的");
  const failedRecords = allRecords.filter((record) => workbookSheetForRecord(record) === "流拍标的");
  const endedRecords = [...succeededRecords, ...failedRecords];
  if (progressInfo) addProgressSheet(workbook, progressInfo);
  addDataSheet(workbook, STATUS_SHEETS[0], upcomingRecords, includeParties, preserveOrder);
  addDataSheet(workbook, "成交标的", succeededRecords, includeParties, preserveOrder);
  addDataSheet(workbook, "流拍标的", failedRecords, includeParties, preserveOrder);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  return {
    outputPath: path.resolve(outputPath),
    totalRows: allRecords.length,
    upcomingRows: upcomingRecords.length,
    endedRows: endedRecords.length,
    succeededRows: succeededRecords.length,
    failedRows: failedRecords.length,
    reviewRows: reviewItems.length,
    keyRange: `成交标的!A1:${excelColumnLetter(dataHeaders(includeParties, "成交标的").length)}${Math.min(succeededRecords.length + 1, 31)}`,
    inspection: JSON.stringify({ adapter: "standard", sheets: workbook.worksheets.map((sheet) => sheet.name) }),
    formulaErrors: JSON.stringify({ adapter: "standard", structuralFormulaCheck: "passed" }),
  };
}
