import fs from "node:fs/promises";
import path from "node:path";

const ALLOWED_KEYS = new Set([
  "platform", "categories", "statusFilters", "headless", "dryRun", "lowFrequency",
  "includeParties", "checkpointEvery", "requestIntervalMs", "maxItems", "maxPages",
  "loginWaitMinutes", "outputDir", "stateDir", "profileDir", "workbookAdapter",
  "province", "cities", "runName",
  "scanOnly",
]);

function resolveConfiguredPath(value, baseDir) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export async function loadRunConfig(argv, cwd = process.cwd()) {
  const cleanArgv = [];
  let configPath = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--config") {
      if (!argv[index + 1]) throw new Error("--config 需要JSON文件路径");
      configPath = path.resolve(cwd, argv[index + 1]);
      index += 1;
    } else {
      cleanArgv.push(argv[index]);
    }
  }
  if (!configPath) return { argv: cleanArgv, config: {}, configPath: "" };
  const payload = JSON.parse(await fs.readFile(configPath, "utf8"));
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`配置文件含未知字段：${key}`);
  }
  const baseDir = path.dirname(configPath);
  for (const key of ["outputDir", "stateDir", "profileDir"]) {
    if (payload[key]) payload[key] = resolveConfiguredPath(payload[key], baseDir);
  }
  return { argv: cleanArgv, config: payload, configPath };
}
