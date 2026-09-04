import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excludedDirectories = new Set(["node_modules", "tmp", ".git"]);
const forbiddenNames = new Set([
  "Cookies", "Login Data", "Web Data", "History", "Network Persistent State",
]);
const forbiddenSuffixes = [".xlsx.inspect.ndjson"];
const textExtensions = new Set([".md", ".mjs", ".js", ".json", ".yaml", ".yml"]);
const violations = [];
const personalPath = ["C:", "Users", "HUAWEI"].join("\\").toLowerCase();
const requiredDeliveryFiles = [
  "tests/fixtures/curated-html/福州房源上新.html",
  "tests/fixtures/curated-html/泉州房源上新.html",
  "tests/fixtures/curated-html/福州法拍结果.html",
  "tests/fixtures/curated-html/泉州法拍结果.html",
  "tests/fixtures/curated-html/manifest.json",
  "tests/fixtures/curated-training/golden-records.json",
  "tests/fixtures/curated-training/participation-golden.json",
  "assets/所有小区名称清单.txt",
  "assets/community-dictionary.json",
  "assets/community-address-mappings.json",
  "assets/房源信息整理模板.xlsx",
  "package-lock.json",
];
const forbiddenDeliveryPaths = [
  "node_modules",
  "tmp",
  "tests/fixtures/20260802",
  "tests/fixtures/20260803",
];

async function walk(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }
    const relative = path.relative(root, fullPath);
    if (forbiddenNames.has(entry.name) || forbiddenSuffixes.some((suffix) => entry.name.endsWith(suffix))) {
      violations.push(`禁止文件：${relative}`);
    }
    if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      const content = await fs.readFile(fullPath, "utf8");
      if (content.toLowerCase().includes(personalPath)) violations.push(`个人绝对路径：${relative}`);
      if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u.test(content)) violations.push(`私钥特征：${relative}`);
    }
  }
}

await walk(root);
for (const relative of requiredDeliveryFiles) {
  try {
    await fs.access(path.join(root, relative));
  } catch {
    violations.push(`缺少交付核心文件：${relative}`);
  }
}
for (const relative of forbiddenDeliveryPaths) {
  try {
    await fs.access(path.join(root, relative));
    violations.push(`交付目录含临时或旧样本：${relative}`);
  } catch {
    // Expected: these paths must not be shipped.
  }
}
assert.deepEqual(violations, []);
console.log("release safety checks passed");
