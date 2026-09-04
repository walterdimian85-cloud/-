import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const BATCH_DIR_RE = /^(\d{8})(?:（\d+）)?$/u;
const OUTPUT_CACHE_NAMES = new Set([
  "采集进度.json", "本次采集证据.json", "待人工复核.json", "运行结果.json",
  "工作台复核规则.md", "工作台复核任务.json", "工作台复核进度.json", "工作台复核结果.json",
]);
const AGENT_CACHE_DIRS = [
  "component_crx_cache", "Default/Cache", "Default/Code Cache", "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache", "Default/GPUCache", "Default/Service Worker/ScriptCache",
  "Default/Shared Dictionary/cache", "GrShaderCache", "ShaderCache", "Crashpad",
];

function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function dayKey(value) {
  const key = String(value || "").replaceAll("-", "");
  if (!/^\d{8}$/u.test(key)) throw new Error("请选择有效的开始和结束日期。");
  return key;
}

async function exists(target) { try { await fs.access(target); return true; } catch { return false; } }

async function fileItem(target, root, category) {
  const stat = await fs.stat(target);
  return { path: target, relativePath: path.relative(root, target), size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), category };
}

async function filesBelow(directory, root, category) {
  if (!await exists(directory)) return [];
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(target, root, category));
    else if (entry.isFile()) result.push(await fileItem(target, root, category));
  }
  return result;
}

function finish(kind, root, files, skipped = []) {
  files.sort((a, b) => a.path.localeCompare(b.path));
  const signature = JSON.stringify(files.map(({ path: target, size, mtimeMs }) => [path.resolve(target), size, mtimeMs]));
  return {
    kind, root, files, skipped,
    fileCount: files.length,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    previewToken: crypto.createHash("sha256").update(`${kind}\n${path.resolve(root)}\n${signature}`).digest("hex"),
  };
}

export async function previewOutputCache(config, state, { from, to } = {}) {
  const root = path.resolve(config.outputDir || "");
  if (!config.outputDir || !await exists(root)) throw new Error("尚未配置有效的数据保存目录。");
  const first = dayKey(from); const last = dayKey(to);
  if (first > last) throw new Error("开始日期不能晚于结束日期。");
  const files = []; const skipped = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(BATCH_DIR_RE);
    if (!match || match[1] < first || match[1] > last) continue;
    const directory = path.join(root, entry.name);
    const metaPath = path.join(directory, "batch-meta.json");
    let meta;
    try { meta = JSON.parse(await fs.readFile(metaPath, "utf8")); } catch { skipped.push({ batch: entry.name, reason: "缺少有效的批次元数据" }); continue; }
    if (meta.status !== "completed") { skipped.push({ batch: entry.name, reason: "批次尚未完整完成" }); continue; }
    if ((state?.batchId && meta.batchId === state.batchId) || state?.runName === entry.name) {
      skipped.push({ batch: entry.name, reason: "这是当前任务批次" }); continue;
    }
    const workbook = path.join(directory, `${match[1]}新增房源信息.xlsx`);
    if (!await exists(workbook)) { skipped.push({ batch: entry.name, reason: "缺少最终工作簿" }); continue; }
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      if (!child.isFile()) continue;
      if (OUTPUT_CACHE_NAMES.has(child.name) || /新增房源信息_采集中\.xlsx$/u.test(child.name)) {
        files.push(await fileItem(path.join(directory, child.name), root, "已完成批次的可再生过程文件"));
      }
    }
  }
  return finish("output", root, files, skipped);
}

export async function previewAgentCache(config, state) {
  if (state?.workerPid || !["idle", "completed", "partial_completed", "failed", "terminated"].includes(state?.status || "idle")) {
    throw new Error("Agent仍在运行或等待操作，请先结束当前任务再清理程序缓存。");
  }
  const configuredProfile = config.profileDir || (config.stateDir ? path.join(config.stateDir, "edge-profile") : "");
  const root = path.resolve(configuredProfile || "");
  if (!configuredProfile || !await exists(root)) throw new Error("未找到浏览器运行目录，没有可清理的程序缓存。");
  const files = [];
  for (const relative of AGENT_CACHE_DIRS) {
    const target = path.resolve(root, ...relative.split("/"));
    if (!inside(root, target)) throw new Error("缓存白名单路径越界，已拒绝操作。");
    files.push(...await filesBelow(target, root, "浏览器可再生成缓存"));
  }
  return finish("agent", root, files);
}

export async function cleanupPreview(previewFactory, token) {
  const preview = await previewFactory();
  if (!token || token !== preview.previewToken) throw new Error("缓存内容在预览后发生变化，请重新预览再清理。");
  const deleted = []; const failed = [];
  for (const item of preview.files) {
    if (!inside(preview.root, item.path)) { failed.push({ ...item, error: "路径越界" }); continue; }
    try { await fs.rm(item.path, { force: false }); deleted.push(item); }
    catch (error) { failed.push({ ...item, error: error.message }); }
  }
  return { ...preview, deletedCount: deleted.length, deletedBytes: deleted.reduce((sum, item) => sum + item.size, 0), failed };
}

export const CACHE_POLICY = {
  outputCacheNames: [...OUTPUT_CACHE_NAMES],
  agentCacheDirectories: [...AGENT_CACHE_DIRS],
};
