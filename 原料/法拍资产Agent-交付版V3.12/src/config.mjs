import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, loadJson, saveJsonAtomic } from "./utils.mjs";
import { normalizeSelectedStatuses } from "./status-scope.mjs";
import { selectedPlatforms } from "./task-scope.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "agent.local.json");

const defaults = {
  version: 1,
  skillV2Dir: "../runtime/fujian-auctions-v2",
  agentDataDir: "../agent-data",
  profileDir: "",
  collection: {
    platform: "all", maxRuntimeMinutes: 240, maxRetries: 5,
    userActionTimeoutMinutes: 60, warnAtRecords: 500, stopAtRecords: 800,
    pauseGraceSeconds: 90,
    heartbeatSeconds: 15, pollSeconds: 5,
    category: "", status: "", selectedStatuses: ["即将开始", "已结束"], maxItems: null, maxPages: null,
    // 每日Agent只采集高水位后的增量。历史“未结束”记录的状态刷新应由
    // 独立维护任务承担，否则每天正式任务会先重复打开数百个旧详情页。
    dryRun: false, skipHistoricalRefresh: true,
    preScan: false,
    alibabaPc: { includeBankruptcy: true },
    scope: { mode: "province", province: "福建省", cities: [], anchors: {} },
  },
  ai: {
    enabled: true, mode: "api", provider: "deepseek", baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY",
    requireChoiceAfterCollection: true,
    autoApplyHighConfidence: true, minimumConfidence: 0.9, maxReviewItems: 200,
  },
  opportunities: {
    enabled: true,
    minimumComparableCount: 3,
    lowUnitPricePercentile: 0.25,
    minimumRegistrations: 3,
    minimumBidRecords: 10,
  },
  summary: { localReport: true, recipients: [] },
};

function resolveFromConfig(configPath, value) {
  if (!value) return "";
  return path.resolve(path.dirname(configPath), value);
}

export async function loadAgentConfig(configPath = DEFAULT_CONFIG_PATH) {
  const raw = await loadJson(configPath, {});
  const config = {
    ...defaults, ...raw,
    collection: {
      ...defaults.collection, ...(raw.collection || {}),
      alibabaPc: { ...defaults.collection.alibabaPc, ...(raw.collection?.alibabaPc || {}) },
      scope: { ...defaults.collection.scope, ...(raw.collection?.scope || {}) },
    },
    ai: { ...defaults.ai, ...(raw.ai || {}) },
    opportunities: { ...defaults.opportunities, ...(raw.opportunities || {}) },
    summary: { ...defaults.summary, ...(raw.summary || {}) },
  };
  for (const key of ["skillV2Dir", "stateDir", "outputDir", "agentDataDir", "profileDir"]) {
    if (config[key]) config[key] = resolveFromConfig(configPath, config[key]);
  }
  config.configPath = path.resolve(configPath);
  return config;
}

export async function validateAgentConfig(config) {
  const problems = [];
  try { config.collection.selectedStatuses = normalizeSelectedStatuses(config.collection.selectedStatuses || config.collection.status); }
  catch (error) { problems.push(error.message); }
  try {
    if (!selectedPlatforms(config.collection).length) problems.push("请至少选择一个采集平台");
  } catch (error) { problems.push(error.message); }
  if (!config.skillV2Dir || !await exists(path.join(config.skillV2Dir, "bin", "auction-cli.mjs"))) {
    problems.push("请选择包含bin/auction-cli.mjs的法拍房Skill V2目录");
  }
  if (!config.stateDir) problems.push("请选择采集状态目录");
  if (!config.outputDir) problems.push("请选择房源结果目录");
  if (!(config.collection.maxRuntimeMinutes > 0)) problems.push("最长运行时间必须大于0");
  if (!(config.collection.maxRetries >= 0)) problems.push("自动重试次数不得小于0");
  if (!(config.collection.warnAtRecords < config.collection.stopAtRecords)) problems.push("500条提醒阈值必须小于强制停止阈值");
  if (config.ai.enabled && !["api", "workbench", "off"].includes(config.ai.mode || "api")) problems.push("AI复核方式必须为API、工作台或关闭");
  if (config.ai.enabled && (config.ai.mode || "api") === "api" && !["deepseek", "alibaba", "openai_compatible", "openai", "anthropic", "gemini"].includes(config.ai.provider)) {
    problems.push(`不支持的AI服务商：${config.ai.provider}`);
  }
  if (config.ai.enabled && (config.ai.mode || "api") === "api" && !config.ai.baseUrl) problems.push("API复核时必须填写API地址");
  if (config.ai.enabled && (config.ai.mode || "api") === "api" && !config.ai.model) problems.push("API复核时必须选择或填写AI模型ID");
  if (config.ai.enabled && (config.ai.mode || "api") === "api" && !config.ai.apiKeyEnv) problems.push("API复核时必须填写密钥环境变量名称");
  if (problems.length) throw new Error(problems.join("；"));
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.mkdir(config.agentDataDir, { recursive: true });
  return config;
}

export async function saveAgentConfig(input, configPath = DEFAULT_CONFIG_PATH) {
  const safe = {
    version: 1,
    skillV2Dir: input.skillV2Dir || "",
    stateDir: input.stateDir || "",
    outputDir: input.outputDir || "",
    agentDataDir: input.agentDataDir || "../agent-data",
    profileDir: input.profileDir || "",
    collection: {
      ...defaults.collection, ...(input.collection || {}),
      alibabaPc: { ...defaults.collection.alibabaPc, ...(input.collection?.alibabaPc || {}) },
      scope: { ...defaults.collection.scope, ...(input.collection?.scope || {}) },
    },
    ai: { ...defaults.ai, ...(input.ai || {}) },
    opportunities: { ...defaults.opportunities, ...(input.opportunities || {}) },
    summary: { ...defaults.summary, ...(input.summary || {}) },
  };
  safe.collection.selectedStatuses = normalizeSelectedStatuses(safe.collection.selectedStatuses || safe.collection.status);
  safe.collection.status = safe.collection.selectedStatuses.join(",");
  await saveJsonAtomic(configPath, safe);
  return loadAgentConfig(configPath);
}
