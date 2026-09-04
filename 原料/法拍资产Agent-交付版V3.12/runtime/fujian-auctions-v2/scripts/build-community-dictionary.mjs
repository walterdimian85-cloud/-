import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
};

const sourcePath = valueAfter("--source");
const outputPath = valueAfter("--output");
if (!sourcePath || !outputPath) {
  throw new Error("用法：node scripts/build-community-dictionary.mjs --source <小区清单.txt> --output <community-dictionary.json>");
}

const source = await fs.readFile(sourcePath, "utf8");
const genericNames = new Set(["商住小区", "工业区", "工业房地产", "房地产"]);
const byName = new Map();

for (const line of source.split(/\r?\n/u)) {
  if (!line.includes("\t")) continue;
  const [locationText, rawName] = line.split("\t");
  const name = String(rawName || "").trim();
  const significant = name.replace(/[^\p{L}\p{N}]/gu, "");
  if (!name || significant.length < 2 || genericNames.has(name)) continue;
  const locations = String(locationText || "")
    .split("/")
    .map((value) => value.trim())
    .filter(Boolean);
  const entry = byName.get(name) || { name, locations: [] };
  entry.locations.push(...locations);
  entry.locations = [...new Set(entry.locations)].sort((a, b) => a.localeCompare(b, "zh-CN"));
  byName.set(name, entry);
}

const entries = [...byName.values()].sort((left, right) =>
  right.name.length - left.name.length || left.name.localeCompare(right.name, "zh-CN"),
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({
    schemaVersion: 1,
    sourceDescription: "福州、泉州历史人工整理小区名称清单",
    generatedAt: new Date().toISOString(),
    genericFallbacksExcluded: [...genericNames],
    count: entries.length,
    entries,
  }, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ outputPath: path.resolve(outputPath), count: entries.length }, null, 2));
