import path from "node:path";
import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { collectionGroupRows, requiredScopeAnchors } from "./task-scope.mjs";

function platformLabel(platform) {
  if (platform === "alibaba_pc") return "阿里资产（PC端）";
  if (platform === "jd_pc") return "京东拍卖（PC端）";
  if (platform === "alibaba") return "阿里资产";
  return "京东拍卖";
}

function highWaterRows(config, state = {}) {
  const scoped = requiredScopeAnchors(config.collection);
  const sourceRows = scoped.length ? scoped : collectionGroupRows(config.collection);
  const rows = sourceRows.map((row) => ({
    ...row,
    platform: platformLabel(row.platform),
    category: row.categoryLabel || row.category,
    url: state.anchors?.[row.key] || row.url || "",
  }));
  return rows;
}

export async function readHighWater(config, { allowMissing = false } = {}) {
  if (!config.stateDir) throw new Error("请先在首次配置中选择采集状态目录并保存配置");
  const statePath = path.join(config.stateDir, "state.json");
  const state = await loadJson(statePath, null);
  if (!state && !allowMissing) throw new Error(`未找到高水位状态文件：${statePath}`);
  const effectiveState = state || { version: 1, anchors: {}, records: {} };
  const rows = highWaterRows(config, effectiveState);
  return { statePath, updatedAt: effectiveState.updatedAt || null, complete: rows.every((row) => row.url), rows };
}

export async function resetHighWater(config, anchors = {}) {
  const snapshot = await readHighWater(config, { allowMissing: true });
  const state = await loadJson(snapshot.statePath, { version: 1, anchors: {}, records: {} });
  const nextAnchors = { ...(state.anchors || {}) };
  for (const row of snapshot.rows) {
    const value = String(anchors[row.key] || "").trim();
    if (!/^https?:\/\//u.test(value)) throw new Error(`高水位链接格式不正确：${row.key}`);
    nextAnchors[row.key] = value;
  }
  await saveJsonAtomic(snapshot.statePath, {
    ...state, anchors: nextAnchors, updatedAt: new Date().toISOString(),
    anchorResetAt: new Date().toISOString(),
  });
  return readHighWater(config);
}

export function formatHighWater(snapshot) {
  return snapshot.rows.map((row) => `${row.platform}:${row.city ? `${row.city}:` : ""}${row.category}:${row.status} = ${row.url || "【缺失】"}`).join("\n");
}
