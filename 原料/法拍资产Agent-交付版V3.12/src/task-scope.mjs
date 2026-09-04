import crypto from "node:crypto";
import path from "node:path";
import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { AUCTION_STATUSES, statusScopeFields } from "./status-scope.mjs";

export const STATUSES = AUCTION_STATUSES;
export const CATEGORIES = ["住宅用房", "商业用房", "工业用房"];
export const ALIBABA_PC_PLATFORM = "alibaba_pc";
export const JD_PC_PLATFORM = "jd_pc";
export const SUPPORTED_PLATFORMS = ["alibaba", ALIBABA_PC_PLATFORM, "jd", JD_PC_PLATFORM];

export function platformModeFor(platforms = []) {
  const selected = [...new Set(platforms.filter((item) => SUPPORTED_PLATFORMS.includes(item)))];
  if (selected.includes("alibaba") && selected.includes(ALIBABA_PC_PLATFORM)) {
    throw new Error("阿里资产（PC端）与阿里资产不能同时选择");
  }
  if (selected.includes("jd") && selected.includes(JD_PC_PLATFORM)) {
    throw new Error("京东拍卖（PC端）与京东拍卖不能同时选择");
  }
  if (selected.length > 2) throw new Error("每个平台系列只能选择一个采集模式");
  if (selected.includes("alibaba") && selected.includes("jd")) return "all";
  if (selected.includes(ALIBABA_PC_PLATFORM) && selected.includes("jd")) return "alibaba_pc_all";
  if (selected.includes("alibaba") && selected.includes(JD_PC_PLATFORM)) return "alibaba_jd_pc";
  if (selected.includes(ALIBABA_PC_PLATFORM) && selected.includes(JD_PC_PLATFORM)) return "alibaba_pc_jd_pc";
  return selected[0] || "";
}

export function selectedPlatforms(collection = {}) {
  const configured = collection.scope?.platforms;
  const selected = Array.isArray(configured) && configured.length
    ? configured
    : collection.platform === "all"
      ? ["alibaba", "jd"]
      : collection.platform === "alibaba_pc_all"
        ? [ALIBABA_PC_PLATFORM, "jd"]
        : collection.platform === "alibaba_jd_pc"
          ? ["alibaba", JD_PC_PLATFORM]
          : collection.platform === "alibaba_pc_jd_pc"
            ? [ALIBABA_PC_PLATFORM, JD_PC_PLATFORM]
        : [collection.platform];
  platformModeFor(selected);
  return selected.filter((item) => SUPPORTED_PLATFORMS.includes(item));
}

export function selectedCategories(collection = {}) {
  return String(collection.category || "").split(",").map((v) => v.trim()).filter(Boolean).length
    ? String(collection.category).split(",").map((v) => v.trim()).filter(Boolean)
    : [...CATEGORIES];
}

export function normalizedScopeDescriptor(collection = {}) {
  const scope = collection.scope || {};
  const platforms = [...new Set(selectedPlatforms(collection))].sort();
  return {
    province: String(scope.province || "").trim(),
    cities: [...new Set(Array.isArray(scope.cities) ? scope.cities.filter(Boolean) : [])].sort(),
    platforms,
    categories: [...new Set(selectedCategories(collection))].sort(),
    ...(platforms.includes(ALIBABA_PC_PLATFORM)
      ? { alibabaPc: { includeBankruptcy: collection.alibabaPc?.includeBankruptcy !== false } }
      : {}),
  };
}

export function alibabaPcGroupCategory(collection = {}) {
  const categories = [...new Set(selectedCategories(collection))].sort();
  const assetScope = collection.alibabaPc?.includeBankruptcy === false
    ? "without_bankruptcy"
    : "with_bankruptcy";
  return `${categories.join("+")}@${assetScope}`;
}

export function jdPcGroupCategory(collection = {}) {
  return [...new Set(selectedCategories(collection))].sort().join("+");
}

export function collectionGroupRows(collection = {}) {
  const scope = collection.scope || {};
  const cities = scope.mode === "custom" && Array.isArray(scope.cities) && scope.cities.length
    ? scope.cities.filter(Boolean)
    : [""];
  const statuses = statusScopeFields(collection).selectedStatuses;
  const rows = [];
  for (const platform of selectedPlatforms(collection)) {
    const categories = platform === ALIBABA_PC_PLATFORM
      ? [alibabaPcGroupCategory(collection)]
      : platform === JD_PC_PLATFORM
        ? [jdPcGroupCategory(collection)]
        : selectedCategories(collection);
    for (const category of categories) {
      for (const city of cities) {
        for (const status of statuses) {
          const key = `${platform}:${category}:${status}${city ? `:${city}` : ""}`;
          rows.push({
            key, platform, category, city, status,
            categoryLabel: platform === ALIBABA_PC_PLATFORM || platform === JD_PC_PLATFORM
              ? selectedCategories(collection).join("、")
              : category,
          });
        }
      }
    }
  }
  return rows;
}

export function customScopeId(collection = {}) {
  const signature = JSON.stringify(normalizedScopeDescriptor(collection));
  return crypto.createHash("sha256").update(signature).digest("hex").slice(0, 16);
}

export function requiredScopeAnchors(collection = {}) {
  const scope = collection.scope || {};
  if (scope.mode !== "custom") return [];
  return collectionGroupRows(collection).map((row) => ({
    ...row,
    url: scope.anchors?.[row.key] || "",
  }));
}

export function validateScope(collection = {}) {
  const scope = collection.scope || {};
  if (scope.mode !== "custom") return [];
  const problems = [];
  if (!scope.province) problems.push("小范围任务必须选择省份");
  if (!scope.cities?.length) problems.push("小范围任务必须选择至少一个地级市");
  const missing = requiredScopeAnchors(collection).filter((row) => !/^https?:\/\//u.test(row.url));
  if (missing.length) problems.push(...missing.map((row) => `缺少 ${row.platform}/${row.city}/${row.categoryLabel || row.category}/${row.status} 高水位链接`));
  return problems;
}

export async function materializeScopeConfig(config) {
  const scope = config.collection.scope || {};
  if (scope.mode !== "custom") return config;
  const problems = validateScope(config.collection);
  if (problems.length) throw new Error(problems.join("；"));
  const scopeId = customScopeId(config.collection);
  const scopedStateDir = path.join(config.stateDir, "scoped-tasks", scopeId);
  const statePath = path.join(scopedStateDir, "state.json");
  const inputAnchors = Object.fromEntries(
    requiredScopeAnchors(config.collection).map((row) => [row.key, row.url]),
  );
  const existing = await loadJson(statePath, null);
  // A custom-scope anchor set is a one-run input. Seed it only before that
  // input is consumed. Resume/review must retain the state advanced by the
  // collector instead of silently restoring the old user input.
  const shouldSeedInput = scope.anchorsConsumed !== true && Object.keys(inputAnchors).length > 0;
  if (!existing || shouldSeedInput) {
    await saveJsonAtomic(statePath, {
      version: 1,
      anchors: inputAnchors,
      records: {},
      scopeInputAt: new Date().toISOString(),
    });
  }
  return {
    ...config,
    stateDir: scopedStateDir,
    profileDir: config.profileDir || path.join(config.stateDir, "edge-profile"),
    collection: {
      ...config.collection,
      platform: platformModeFor(selectedPlatforms(config.collection)),
      category: selectedCategories(config.collection).join(","),
    },
  };
}

export async function restoreCustomScopeAnchorBaseline(baseConfig, scopedConfig, reason = "incomplete_group_set") {
  if (baseConfig.collection?.scope?.mode !== "custom") return { restored: false, reason: "not_custom" };
  const inputAnchors = Object.fromEntries(
    requiredScopeAnchors(baseConfig.collection).map((row) => [row.key, row.url]),
  );
  if (!Object.keys(inputAnchors).length) return { restored: false, reason: "missing_input_anchors" };
  const statePath = path.join(scopedConfig.stateDir, "state.json");
  const existing = await loadJson(statePath, { version: 1, records: {} });
  await saveJsonAtomic(statePath, {
    ...existing,
    anchors: inputAnchors,
    incompleteRunRollback: {
      reason,
      restoredAt: new Date().toISOString(),
      expectedCount: Object.keys(inputAnchors).length,
    },
    updatedAt: new Date().toISOString(),
  });
  return { restored: true, statePath, expectedCount: Object.keys(inputAnchors).length };
}
