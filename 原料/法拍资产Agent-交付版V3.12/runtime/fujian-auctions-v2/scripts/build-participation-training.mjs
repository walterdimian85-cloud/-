import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function decodeHtml(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/giu, (_, entity) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return entities[entity] || `&${entity};`;
    })
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseParticipationRows(html, sourceFile) {
  const records = [];
  for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/giu)]
      .map((match) => decodeHtml(match[1]));
    if (cells.length < 14 || cells[8] !== "成交") continue;
    const bidCount = Number(cells[12]);
    const registrationCount = Number(cells[13]);
    if (!Number.isSafeInteger(bidCount) || !Number.isSafeInteger(registrationCount)) continue;
    records.push({
      sourceFile,
      district: cells[0],
      stage: cells[1],
      title: cells[2],
      outcome: cells[8],
      bidCount,
      registrationCount,
    });
  }
  return records;
}

async function main() {
  const [outputPath, ...inputPaths] = process.argv.slice(2);
  if (!outputPath || inputPaths.length === 0) {
    throw new Error("用法：node scripts/build-participation-training.mjs <输出.json> <结果1.html> [结果2.html]");
  }
  const records = [];
  for (const inputPath of inputPaths) {
    records.push(...parseParticipationRows(await fs.readFile(inputPath, "utf8"), path.basename(inputPath)));
  }
  const dataset = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    description: "人工法拍结果中的已成交标的报名人数与竞买记录金标准；源HTML未包含详情链接，以标的名称作为训练集键。",
    total: records.length,
    records,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath: path.resolve(outputPath), total: records.length }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
