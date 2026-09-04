import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalUrl } from "../src/core/urls.mjs";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'");
}

function textContent(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

function numeric(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized || /^(?:未提供|未找到|未知|无|—|-)$/u.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function tdByClass(row, className) {
  const pattern = new RegExp(
    `<td\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "iu",
  );
  return row.match(pattern)?.[1] || "";
}

export function parseRows(html, sourceFile) {
  const tbody = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/iu)?.[1] || html;
  const rows = [...tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)];
  return rows.map((match, index) => {
    const row = match[1];
    const linkCell = tdByClass(row, "link");
    const href = decodeHtml(linkCell.match(/href=["']([^"']+)["']/iu)?.[1] || "");
    const url = canonicalUrl(href);
    const platformText = textContent(tdByClass(row, "platform"));
    const areaText = textContent(tdByClass(row, "area"));
    const expectedTitle = textContent(tdByClass(row, "addr"));
    const expectedCommunity = textContent(tdByClass(row, "community"));
    const propertyType = textContent(tdByClass(row, "type"));
    const expectedArea = numeric(areaText);
    const platform = /京东/u.test(platformText) ? "京东拍卖" : "阿里资产";
    const sourceCategory = ["住宅", "别墅", "车位"].includes(propertyType)
      ? "住宅用房"
      : propertyType === "商业"
        ? "商业用房"
        : propertyType === "工业"
          ? "工业用房"
          : "";
    return {
      id: `${path.basename(sourceFile)}#${index + 1}`,
      sourceFile: path.basename(sourceFile),
      sourceRow: index + 1,
      date: textContent(tdByClass(row, "date")),
      district: textContent(tdByClass(row, "district")),
      auctionRound: textContent(tdByClass(row, "round")),
      expectedTitle,
      expectedCommunity,
      propertyType,
      startPriceWan: numeric(textContent(tdByClass(row, "price"))),
      assessmentPriceWan: numeric(textContent(tdByClass(row, "assess"))),
      discountRate: numeric(textContent(tdByClass(row, "discount"))),
      roomLayout: textContent(tdByClass(row, "layout")),
      expectedArea,
      expectedAreaRaw: areaText,
      unitPrice: numeric(textContent(tdByClass(row, "avg"))),
      auctionDate: textContent(tdByClass(row, "auction-date")),
      platform,
      court: textContent(tdByClass(row, "court")),
      url,
      // 兼容V2直链采集器，使这份金标准可以直接作为--urls-file输入。
      "标的名称": expectedTitle,
      "小区名称（仅供参考）": expectedCommunity,
      "标的类型": propertyType,
      "面积/㎡": expectedArea ?? "未提供",
      "平台": platform,
      "网站链接": url,
      _源分类: sourceCategory,
    };
  }).filter((record) => record.url);
}

export async function importCuratedHtml(inputPaths, outputPath) {
  const normalizedInputs = inputPaths.map((item) => path.resolve(item));
  const normalizedOutput = path.resolve(outputPath);
  if (!normalizedInputs.length) throw new Error("至少提供一个HTML文件");

  const all = [];
  const sources = [];
  for (const inputPath of normalizedInputs) {
    const buffer = await fs.readFile(inputPath);
    const html = buffer.toString("utf8");
    const records = parseRows(html, inputPath);
    sources.push({ file: path.basename(inputPath), bytes: buffer.length, records: records.length });
    all.push(...records);
  }

  const byUrl = new Map();
  const conflicts = [];
  for (const record of all) {
    const prior = byUrl.get(record.url);
    if (prior) {
      const fields = ["expectedTitle", "expectedCommunity", "expectedArea"];
      const different = fields.filter((field) => prior[field] !== record[field]);
      if (different.length) conflicts.push({ url: record.url, fields: different, prior, current: record });
      continue;
    }
    byUrl.set(record.url, record);
  }
  const records = [...byUrl.values()];
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources,
    counts: {
      raw: all.length,
      unique: records.length,
      conflicts: conflicts.length,
      withArea: records.filter((item) => Number.isFinite(item.expectedArea)).length,
      withoutArea: records.filter((item) => !Number.isFinite(item.expectedArea)).length,
      alibaba: records.filter((item) => item.platform === "阿里资产").length,
      jd: records.filter((item) => item.platform === "京东拍卖").length,
    },
    conflicts,
    records,
  };
  await fs.mkdir(path.dirname(normalizedOutput), { recursive: true });
  await fs.writeFile(normalizedOutput, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  if (outputIndex < 0 || !args[outputIndex + 1]) {
    throw new Error("用法：node scripts/import-curated-html.mjs <html...> --output <json>");
  }
  const payload = await importCuratedHtml(args.slice(0, outputIndex), args[outputIndex + 1]);
  console.log(JSON.stringify(payload.counts, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
