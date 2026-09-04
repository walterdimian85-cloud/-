import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG_PATH, loadAgentConfig, saveAgentConfig } from "./config.mjs";
import { loadAgentState, statePaths, terminalStatePatch } from "./state.mjs";
import { loadJson, processAlive, saveJsonAtomic, shanghaiDateKey } from "./utils.mjs";
import { formatHighWater, readHighWater, resetHighWater } from "./high-water.mjs";
import { workbenchPrompt } from "./workbench.mjs";
import { allocateBatchRunName } from "./batches.mjs";
import { activatePersistentCredential, credentialStorageLabel, forgetPersistentCredential, loadPersistentCredential, savePersistentCredential } from "./credentials.mjs";
import { collectionGroupRows, materializeScopeConfig, platformModeFor, requiredScopeAnchors, restoreCustomScopeAnchorBaseline, selectedPlatforms, validateScope } from "./task-scope.mjs";
import { inspectCustomHighWater, loadCustomHighWaterProfile, mergeCustomHighWater, saveCustomHighWaterProfile } from "./custom-high-water.mjs";
import { assertWorkerOperation, createWorkerIdentity, loadWorkerLock, recoveryDecision, releaseWorkerLock, retryOperationFor, saveWorkerLock, workerIdentityMatches, workerRoleForOperation } from "./worker-lock.mjs";
import { archiveTaskState, assertBatchBinding, assertOperationIdentity, createTaskBinding, isPathInside, listTaskHistory, loadTaskHistory, writeBatchMeta } from "./batch-binding.mjs";
import { collectionCompletionFacts, normalizeTaskState } from "./task-state-model.mjs";
import { loadTaskMetrics } from "./task-metrics.mjs";
import { verificationCheckpoint, verificationBelongsTo } from "./verification-state.mjs";
import { cleanupPreview, previewAgentCache, previewOutputCache } from "./cache-cleanup.mjs";
import { expectedGroupCount, normalizeSelectedStatuses, statusLabelFor, statusScopeFields } from "./status-scope.mjs";
import { collectionPaths } from "./collector.mjs";
import { finalizeWithoutReview } from "./orchestrator.mjs";
import { distributionInfo, isDeveloperDistribution } from "./distribution.mjs";
import { createDeveloperSession, developerPasswordConfigured, verifyDeveloperPassword } from "./developer-auth.mjs";
import { generateDelivery } from "./delivery-export.mjs";
import { completeOnboarding, onboardingStatus, recordPlatformReadiness } from "./onboarding.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "agent-cli.mjs");
const SERVER_BUILD = "20260830-safe-reselect-v1";
let newTaskStarting = false;
let reviewChoiceStarting = false;
const developerSessions = new Map();
let developerAuthFailures = [];
const onboardingLoginProcesses = new Map();

function cookieValue(request, name) {
  const match = String(request.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function developerUnlocked(request) {
  const token = cookieValue(request, "agent_developer_session");
  const expiresAt = developerSessions.get(token) || 0;
  if (expiresAt <= Date.now()) { if (token) developerSessions.delete(token); return false; }
  return true;
}

function platformLabel(platform) {
  if (platform === "alibaba_pc") return "阿里资产（PC端）";
  if (platform === "jd_pc") return "京东拍卖（PC端）";
  if (platform === "alibaba") return "阿里资产";
  return "京东拍卖";
}

function emptyHighWaterSnapshot(config) {
  let required = requiredScopeAnchors(config.collection);
  if (!required.length && config.collection.scope?.mode === "province") {
    required = collectionGroupRows(config.collection);
  }
  const rows = required.map((row) => ({
    ...row,
    platform: platformLabel(row.platform),
    category: row.categoryLabel || row.category,
    url: "",
  }));
  return { statePath: null, updatedAt: null, complete: false, rows };
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function customCollection(config, payload = {}, anchors = {}) {
  const platforms = Array.isArray(payload.platforms) ? payload.platforms.filter(Boolean) : [];
  const categories = Array.isArray(payload.categories) ? payload.categories.filter(Boolean) : [];
  return {
    ...config.collection,
    selectedStatuses: payload.selectedStatuses || config.collection.selectedStatuses,
    status: Array.isArray(payload.selectedStatuses) ? payload.selectedStatuses.join(",") : config.collection.status,
    platform: platformModeFor(platforms),
    category: categories.join(","),
    alibabaPc: {
      ...config.collection.alibabaPc,
      includeBankruptcy: payload.includeBankruptcy !== false,
    },
    scope: {
      mode: "custom",
      province: String(payload.province || "").trim(),
      cities: Array.isArray(payload.cities) ? payload.cities.filter(Boolean) : [],
      platforms,
      includeBankruptcy: payload.includeBankruptcy !== false,
      anchors,
      anchorsConsumed: false,
    },
  };
}

async function terminateProcessTree(pid) {
  if (!pid || !processAlive(pid)) return false;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true,
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  for (let attempt = 0; attempt < 20 && processAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

function bindingFromState(state = {}) {
  return {
    taskId: state.taskId,
    batchId: state.batchId,
    runName: state.runName,
    batchDirectory: state.paths?.batchDirectory,
    workbookPath: state.paths?.workbook,
    progressPath: state.paths?.progress,
    reportPath: state.paths?.report,
  };
}

// A task directory is allocated before its worker begins.  Older workers could
// later replace its suffixed name (for example, 20260822（4）) with the bare
// date in agent-state.  Repair only the active task when its own batch metadata
// confirms the task identity; never infer a path from another task or alter any
// collected records/high-water data.
export async function repairBoundRunName(config, state) {
  const batchDirectory = state.paths?.batchDirectory;
  if (!state.taskId || !state.batchId || !batchDirectory || !isPathInside(config.outputDir, batchDirectory)) return state;
  const actualRunName = path.basename(path.resolve(batchDirectory));
  if (!actualRunName || actualRunName === state.runName) return state;
  const meta = await loadJson(path.join(batchDirectory, "batch-meta.json"), null);
  if (!meta || meta.taskId !== state.taskId || meta.batchId !== state.batchId) return state;
  const binding = { ...bindingFromState(state), runName: actualRunName };
  for (const value of [binding.workbookPath, binding.progressPath, binding.reportPath]) {
    if (value && !isPathInside(batchDirectory, value)) return state;
  }
  const collection = { ...(state.collection || {}), runName: actualRunName };
  await writeBatchMeta(binding, { collection });
  const repaired = normalizeTaskState({ ...state, runName: actualRunName, collection, updatedAt: new Date().toISOString() });
  await saveJsonAtomic(statePaths(config).agentState, repaired);
  return repaired;
}

async function startWorker(configPath, { operation, recovery = false } = {}) {
  assertWorkerOperation(operation);
  const config = await loadAgentConfig(configPath);
  const scopeProblems = validateScope(config.collection);
  if (scopeProblems.length) throw new Error(scopeProblems.join("；"));
  const state = await loadAgentState(config);
  if (state.workerPid && processAlive(state.workerPid)) throw new Error("Agent任务已经在运行");
  const existingLock = await loadWorkerLock(config);
  if (existingLock?.active && !workerIdentityMatches(state, existingLock)) {
    await releaseWorkerLock(config, state, "stale_or_mismatched_identity");
  }
  const role = workerRoleForOperation(operation);
  const identity = createWorkerIdentity(state, { recovery, role, operation });
  if (["new_collection", "resume_collection"].includes(operation)) {
    await saveJsonAtomic(statePaths(config).pauseRequest, { active: false, taskId: state.taskId || null, batchId: state.batchId || null, clearedAt: new Date().toISOString() });
  }
  await fs.mkdir(config.agentDataDir, { recursive: true });
  const log = await fs.open(path.join(config.agentDataDir, `agent-${shanghaiDateKey()}.log`), "a");
  const worker = spawn(process.execPath, [CLI, "run", "--config", configPath], {
    cwd: ROOT, detached: true, stdio: ["ignore", log.fd, log.fd], windowsHide: true,
    env: { ...process.env, AGENT_WORKER_RUN_ID: identity.workerRunId, AGENT_WORKER_OPERATION: operation },
  });
  worker.unref(); await log.close();
  const activeLock = await saveWorkerLock(config, { ...identity, workerPid: worker.pid });
  await saveJsonAtomic(statePaths(config).agentState, {
    ...state, version: 1, status: "starting", workerPid: worker.pid,
    workerRunId: activeLock.workerRunId,
    workerStartedAt: activeLock.startedAt,
    workerRole: activeLock.role,
    workerOperation: operation,
    agentRecoveryCount: recovery ? Number(state.agentRecoveryCount || 0) + 1 : 0,
    retry: {
      attempt: recovery ? Number(state.retry?.attempt || state.agentRecoveryCount || 0) + 1 : 0,
      maxAttempts: config.collection.maxRetries,
      operation,
      lastError: recovery ? (state.lastFailure || state.retry?.lastError || null) : null,
    },
    updatedAt: new Date().toISOString(),
  });
  return { workerPid: worker.pid, workerRunId: activeLock.workerRunId, operation };
}

async function lastWorkerFailure(config) {
  const logPath = path.join(config.agentDataDir, `agent-${shanghaiDateKey()}.log`);
  try {
    const text = await fs.readFile(logPath, "utf8");
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const useful = lines.filter((line) => !/^\s*[{}\[\],]\s*$/u.test(line));
    return { logPath, message: useful.at(-1) || "未能从日志中提取具体错误" };
  } catch (error) {
    return { logPath, message: `无法读取运行日志：${error.message || error}` };
  }
}

export async function prepareFreshTask(configPath, payload = {}) {
  let config = await loadAgentConfig(configPath);
  const state = await loadAgentState(config);
  const pendingRequest = await loadJson(statePaths(config).newTaskRequest, {});
  if (state.workerPid && processAlive(state.workerPid)) {
    throw new Error("\u5f53\u524d\u91c7\u96c6\u6b63\u5728\u8fd0\u884c\uff0c\u8bf7\u5148\u6682\u505c\u6216\u7b49\u5f85\u5b8c\u6210\u540e\u518d\u65b0\u5efa\u4efb\u52a1\u3002");
  }
  if (state.newTaskPending === true || pendingRequest.active === true) {
    throw new Error("\u5df2\u6709\u4e00\u4e2a\u65b0\u91c7\u96c6\u4efb\u52a1\u6b63\u5728\u51c6\u5907\u4e2d\uff0c\u8bf7\u4f7f\u7528\u201c\u7ee7\u7eed\u4e0a\u6b21\u91c7\u96c6\u201d\uff0c\u4e0d\u8981\u91cd\u590d\u65b0\u5efa\u4efb\u52a1\u3002");
  }
  if (state.status !== "unconfigured" && state.allowedActions?.createTask === false) {
    throw new Error("\u5f53\u524d\u4efb\u52a1\u5c1a\u672a\u7ed3\u675f\uff0c\u4e0d\u80fd\u65b0\u5efa\u4efb\u52a1\u3002\u8bf7\u7ee7\u7eed\u6216\u5b8c\u6210\u5f53\u524d\u4efb\u52a1\u3002");
  }
  if (Object.hasOwn(payload, "selectedStatuses")) {
    if (!Array.isArray(payload.selectedStatuses) || payload.selectedStatuses.length === 0) {
      throw new Error("请至少选择一个采集状态");
    }
    const selectedStatuses = normalizeSelectedStatuses(payload.selectedStatuses);
    const collection = {
      ...config.collection,
      selectedStatuses,
      status: selectedStatuses.join(","),
      scope: { ...config.collection.scope, selectedStatuses },
    };
    config = await saveAgentConfig({ ...config, collection }, configPath);
  }
  const dateKey = shanghaiDateKey();
  // State was read before applying a new task's scope, so a repeated request
  // cannot alter the saved scope of an already-reserved batch.
  if (state.workerPid && processAlive(state.workerPid)) {
    throw new Error("当前任务仍在运行，请先暂停后再新建任务");
  }
  if (state.taskId && state.batchId) {
    await archiveTaskState(config, state);
  }
  const runName = await allocateBatchRunName(config.outputDir, dateKey);
  // Reserve the directory immediately. Concurrent/same-day task allocation
  // can therefore never reuse and overwrite an earlier batch.
  await fs.mkdir(path.join(config.outputDir, runName), { recursive: false });
  const scope = statusScopeFields(config.collection);
  const binding = createTaskBinding(config, { dateKey, runName, collection: config.collection });
  const totalExpectedGroups = collectionGroupRows(config.collection).length;
  const { taskId, batchId } = binding;
  await writeBatchMeta(binding, { status: "idle", ...scope, statusLabel: statusLabelFor(scope.selectedStatuses), expectedGroupCount: totalExpectedGroups, collection: config.collection });
  await saveJsonAtomic(statePaths(config).newTaskRequest, {
    active: true, dateKey, taskId, batchId, runName,
    batchDirectory: binding.batchDirectory,
    workbookPath: binding.workbookPath,
    progressPath: binding.progressPath,
    ...scope, expectedGroupCount: totalExpectedGroups, collection: config.collection,
    requestedAt: new Date().toISOString(),
  });
  const approvals = await loadJson(statePaths(config).volumeApproval, {});
  delete approvals[dateKey];
  await saveJsonAtomic(statePaths(config).volumeApproval, approvals);
  await saveJsonAtomic(statePaths(config).agentState, {
    version: 1, status: "idle", dateKey, runName, taskId, batchId, batchBaseline: 0, count: 0, newTaskPending: true,
    ...scope, statusLabel: statusLabelFor(scope.selectedStatuses), expectedGroupCount: totalExpectedGroups, collection: config.collection,
    verification: { required: false, owner: null, url: null },
    metrics: {
      scope: "current_batch", taskId, batchId,
      collector: { discovered: 0, processed: 0, succeeded: 0, failed: 0, remaining: 0 },
      review: { total: 0, processed: 0, remaining: 0, failed: 0, pending: 0 },
      history: { totalRecords: 0 },
    },
    createdAt: binding.createdAt,
    paths: {
      batchDirectory: binding.batchDirectory,
      workbook: binding.workbookPath,
      progress: binding.progressPath,
      report: binding.reportPath,
    },
    message: "已新建今日任务；旧进度已归档", updatedAt: new Date().toISOString(),
  });
  return { taskId, batchId, dateKey, runName };
}

export async function serve({ port = 8765, configPath = DEFAULT_CONFIG_PATH } = {}) {
  await activatePersistentCredential(await loadAgentConfig(configPath));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === "GET" && url.pathname === "/api/status") {
        const config = await loadAgentConfig(configPath);
        const configured = Boolean(config.skillV2Dir && config.stateDir && config.outputDir);
        const state = normalizeTaskState({ ...(await loadAgentState(config)), configured });
        if (state.review?.progressPath) {
          const external = await loadJson(state.review.progressPath, null);
          if (external && (!external.taskId || external.taskId === state.taskId)
            && (!external.batchId || external.batchId === state.batchId)) {
            state.review = { ...state.review, ...external, type: "review_progress", url: external.currentUrl || null };
          }
        }
        state.metrics = await loadTaskMetrics(config, state);
        return json(response, 200, { serverBuild: SERVER_BUILD, configured, distribution: await distributionInfo(), onboarding: await onboardingStatus(config), state });
      }
      if (request.method === "GET" && url.pathname === "/api/config") {
        const config = await loadAgentConfig(configPath);
        return json(response, 200, { ...config, configPath: undefined });
      }
      if (request.method === "POST" && url.pathname === "/api/config") {
        return json(response, 200, await saveAgentConfig(await body(request), configPath));
      }
      if (request.method === "GET" && url.pathname === "/api/manual") {
        const manuals = {
          user: "\u7528\u6237\u4f7f\u7528\u624b\u518c.md",
          faq: "\u5e38\u89c1\u95ee\u9898\u53ca\u89e3\u51b3\u529e\u6cd5.md",
        };
        const fileName = manuals[url.searchParams.get("kind")];
        if (!fileName) return json(response, 400, { error: "\u4e0d\u652f\u6301\u7684\u624b\u518c\u7c7b\u578b" });
        return json(response, 200, { markdown: await fs.readFile(path.join(ROOT, fileName), "utf8") });
      }
      if (request.method === "GET" && url.pathname === "/api/developer/status") {
        const developer = await isDeveloperDistribution();
        return json(response, 200, { developer, configured: developer && await developerPasswordConfigured(), unlocked: developer && developerUnlocked(request) });
      }
      if (request.method === "POST" && url.pathname === "/api/developer/unlock") {
        if (!await isDeveloperDistribution()) return json(response, 404, { error: "交付版不提供开发者工具" });
        developerAuthFailures = developerAuthFailures.filter((time) => time > Date.now() - 15 * 60_000);
        if (developerAuthFailures.length >= 5) return json(response, 429, { error: "密码错误次数过多，请15分钟后重试" });
        const payload = await body(request);
        if (!await verifyDeveloperPassword(payload.password)) {
          developerAuthFailures.push(Date.now());
          return json(response, 403, { error: "开发者密码不正确" });
        }
        developerAuthFailures = [];
        const session = createDeveloperSession();
        developerSessions.set(session.token, session.expiresAt);
        response.setHeader("set-cookie", `agent_developer_session=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`);
        return json(response, 200, { unlocked: true, expiresAt: new Date(session.expiresAt).toISOString() });
      }
      if (request.method === "POST" && url.pathname === "/api/developer/generate-delivery") {
        if (!await isDeveloperDistribution()) return json(response, 404, { error: "交付版不提供开发者工具" });
        if (!developerUnlocked(request)) return json(response, 403, { error: "开发者工具尚未解锁或已超时" });
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        if (state.workerPid || ["running", "pause_requested"].includes(state.status)) throw new Error("当前任务仍在运行，不能生成交付版");
        const payload = await body(request);
        return json(response, 200, await generateDelivery({ targetDirectory: payload.targetDirectory }));
      }
      if (request.method === "GET" && url.pathname === "/api/onboarding") {
        const config = await loadAgentConfig(configPath);
        return json(response, 200, { ...(await onboardingStatus(config)), loginChecksRunning: [...onboardingLoginProcesses.keys()] });
      }
      if (request.method === "POST" && url.pathname === "/api/onboarding/login") {
        const payload = await body(request);
        const family = ["alibaba", "alibaba_pc"].includes(payload.platform) ? "alibaba"
          : ["jd", "jd_pc"].includes(payload.platform) ? "jd" : "";
        if (!family) return json(response, 400, { error: "不支持的平台登录准备" });
        if (onboardingLoginProcesses.has(family)) return json(response, 409, { error: "该平台登录准备窗口已经打开" });
        const config = await loadAgentConfig(configPath);
        const script = path.join(config.skillV2Dir, "scripts", "run.mjs");
        const profileDir = config.profileDir || path.join(config.stateDir, "edge-profile");
        const configuredPlatforms = selectedPlatforms(config.collection);
        const platform = family === "alibaba"
          ? (configuredPlatforms.includes("alibaba_pc") ? "alibaba_pc" : "alibaba")
          : (configuredPlatforms.includes("jd_pc") ? "jd_pc" : "jd");
        const scope = config.collection.scope || {};
        const loginArgs = [
          script, "login", "--headed", "--platform", platform,
          "--state-dir", config.stateDir, "--profile-dir", profileDir,
          "--province", scope.province || "福建省",
          "--category", config.collection.category || "住宅用房,商业用房,工业用房",
          "--status", (config.collection.selectedStatuses || ["即将开始"])[0],
        ];
        if (Array.isArray(scope.cities) && scope.cities.length) loginArgs.push("--cities", scope.cities[0]);
        loginArgs.push(config.collection.alibabaPc?.includeBankruptcy === false ? "--exclude-bankruptcy" : "--include-bankruptcy");
        await fs.mkdir(profileDir, { recursive: true });
        const child = spawn(process.execPath, loginArgs, { cwd: ROOT, stdio: "ignore", windowsHide: false });
        onboardingLoginProcesses.set(family, child.pid);
        child.once("exit", async (code) => {
          onboardingLoginProcesses.delete(family);
          await recordPlatformReadiness(config, family, code === 0, code === 0 ? "登录访问检查通过" : `登录检查退出码：${code}`).catch(() => {});
        });
        child.once("error", async (error) => {
          onboardingLoginProcesses.delete(family);
          await recordPlatformReadiness(config, family, false, error.message).catch(() => {});
        });
        return json(response, 202, { started: true, platform: family, pid: child.pid });
      }
      if (request.method === "POST" && url.pathname === "/api/onboarding/complete") {
        const config = await loadAgentConfig(configPath);
        await body(request);
        return json(response, 200, await completeOnboarding(config));
      }
      if (request.method === "GET" && url.pathname === "/api/cache/preview") {
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        const kind = url.searchParams.get("kind");
        const preview = kind === "agent"
          ? await previewAgentCache(config, state)
          : await previewOutputCache(config, state, { from: url.searchParams.get("from"), to: url.searchParams.get("to") });
        return json(response, 200, preview);
      }
      if (request.method === "POST" && url.pathname === "/api/cache/cleanup") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        const factory = payload.kind === "agent"
          ? () => previewAgentCache(config, state)
          : () => previewOutputCache(config, state, { from: payload.from, to: payload.to });
        return json(response, 200, await cleanupPreview(factory, payload.previewToken));
      }
      if (request.method === "GET" && url.pathname === "/api/credential-status") {
        const config = await loadAgentConfig(configPath);
        const stored = Boolean(await loadPersistentCredential(config).catch(() => null));
        if (stored && !process.env[config.ai.apiKeyEnv]) await activatePersistentCredential(config);
        return json(response, 200, { configured: Boolean(config.ai.apiKeyEnv && process.env[config.ai.apiKeyEnv]), stored, protection: stored ? credentialStorageLabel() : null });
      }
      if (request.method === "POST" && url.pathname === "/api/credential") {
        const value = await body(request);
        const envName = String(value.envName || "").trim();
        const apiKey = String(value.apiKey || "").trim();
        if (!/^[A-Z_][A-Z0-9_]*$/u.test(envName)) return json(response, 400, { error: "密钥环境变量名称格式不正确" });
        if (apiKey.length < 8 || apiKey.length > 8192) return json(response, 400, { error: "API Key长度不正确" });
        process.env[envName] = apiKey;
        let stored = false;
        if (value.remember === true) {
          const config = await loadAgentConfig(configPath);
          await savePersistentCredential(config, envName, apiKey);
          stored = true;
        }
        return json(response, 200, { configured: true, stored, envName });
      }
      if (request.method === "POST" && url.pathname === "/api/credential-forget") {
        const config = await loadAgentConfig(configPath);
        const forgotten = await forgetPersistentCredential(config);
        return json(response, 200, { forgotten, configured: false, storage: credentialStorageLabel() });
      }
      if (request.method === "POST" && url.pathname === "/api/start") {
        return json(response, 410, { error: "新建任务请使用新建采集接口；恢复任务必须携带当前taskId和batchId。" });
      }
      if (request.method === "POST" && url.pathname === "/api/resume") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        let state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        state = await repairBoundRunName(config, state);
        const pendingNewTask = await loadJson(statePaths(config).newTaskRequest, {});
        const reviewBlocked = state.review?.type === "verification" || state.workerRole === "review";
        const reservedButNotStarted = state.status === "idle" && pendingNewTask.active === true
          && pendingNewTask.taskId === state.taskId && pendingNewTask.batchId === state.batchId;
        const collectionResumable = (reservedButNotStarted || state.allowedActions?.resumeCollection === true)
          && !reviewBlocked;
        if (!collectionResumable) return json(response, 409, { error: "当前任务不处于可恢复采集的状态。" });
        await assertBatchBinding(config, bindingFromState(state));
        if (state.failureReason === "incomplete_group_set") {
          const scopedConfig = await materializeScopeConfig(config);
          await restoreCustomScopeAnchorBaseline(config, scopedConfig, "resume_incomplete_legacy_batch");
        }
        return json(response, 202, await startWorker(configPath, { operation: "resume_collection" }));
      }
      if (request.method === "POST" && url.pathname === "/api/review-choice") {
        if (reviewChoiceStarting) return json(response, 409, { error: "复核方式正在处理中，请勿重复点击。" });
        reviewChoiceStarting = true;
        try {
        const payload = await body(request);
        const mode = String(payload.mode || "");
        if (!["api", "workbench", "off"].includes(mode)) return json(response, 400, { error: "请选择API复核、工作台复核或暂不复核" });
        const config = await loadAgentConfig(configPath);
        const state = normalizeTaskState(await loadAgentState(config));
        assertOperationIdentity(state, payload);
        const collectionComplete = collectionCompletionFacts(state);
        const alreadyInReview = state.workerRole === "review"
          || ["ai_review", "review_verification", "workbench_review"].includes(state.phase);
        const resumableWorkbench = state.phase === "workbench_review"
          && state.status === "waiting_user_action"
          && !state.workerPid;
        const reviewChoiceReady = state.allowedActions?.chooseReview === true
          || (collectionComplete && (!alreadyInReview || resumableWorkbench));
        if (!reviewChoiceReady) return json(response, 409, {
          error: collectionComplete
            ? "当前批次已经进入复核流程，请勿重复启动。"
            : "采集尚未完成，暂时不能启动复核。",
        });
        await assertBatchBinding(config, bindingFromState(state));
        if (mode === "off") {
          await saveJsonAtomic(statePaths(config).reviewChoice, {
            active: false, mode, taskId: state.taskId, batchId: state.batchId,
            dateKey: state.dateKey, runName: state.runName,
            skippedAt: new Date().toISOString(), reason: "user_selected_no_review",
          });
          const collectionConfig = {
            ...config,
            collection: {
              ...config.collection,
              ...(state.collection || {}),
              runName: state.runName,
              dateKey: state.dateKey,
              workbookPath: state.paths?.workbook,
            },
          };
          const paths = {
            ...collectionPaths(collectionConfig, state.dateKey),
            runDir: state.paths.batchDirectory,
            workbook: state.paths.workbook,
            progress: state.paths.progress,
          };
          return json(response, 200, await finalizeWithoutReview(config, collectionConfig, state.dateKey, paths));
        }
        await saveAgentState(config, {
          status: "awaiting_review_choice", phase: "review_choice",
          message: "采集和工作簿已经完成，正在按所选方式启动复核。",
          failureReason: null, details: null,
        });
        await saveJsonAtomic(statePaths(config).reviewChoice, {
          active: true, mode, taskId: state.taskId, batchId: state.batchId,
          dateKey: state.dateKey || shanghaiDateKey(), runName: state.runName || state.dateKey || shanghaiDateKey(), requestedAt: new Date().toISOString(),
        });
        try {
          return json(response, 202, await startWorker(configPath, { operation: "start_review" }));
        } catch (error) {
          await saveJsonAtomic(statePaths(config).reviewChoice, {
            active: false, mode, taskId: state.taskId, batchId: state.batchId,
            failedAt: new Date().toISOString(), error: String(error.message || error),
          });
          await saveAgentState(config, {
            status: "awaiting_review_choice", phase: "review_choice",
            workerPid: null, childPid: null,
            message: `复核没有启动成功，请检查设置后重新选择。原因：${String(error.message || error)}`,
          });
          throw error;
        }
        } finally {
          reviewChoiceStarting = false;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/review-restart") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        const reviewBlocked = state.phase === "review_verification";
        if (!reviewBlocked) {
          return json(response, 409, { error: "当前没有卡在人工验证中的AI复核任务" });
        }
        await terminateProcessTree(state.workerPid);
        await saveJsonAtomic(statePaths(config).reviewChoice, {
          active: false,
          cancelledAt: new Date().toISOString(),
          reason: "user_requested_review_restart",
        });
        await saveJsonAtomic(statePaths(config).agentState, {
          ...state,
          status: "awaiting_review_choice",
          workerPid: null,
          workerRunId: null,
          workerRole: null,
          workerOperation: null,
          childPid: null,
          review: null,
          message: "已中止卡住的AI复核；采集结果和高水位均已保留，请重新选择复核方式",
          updatedAt: new Date().toISOString(),
        });
        await releaseWorkerLock(config, state, "review_restarted_by_user");
        return json(response, 200, { status: "awaiting_review_choice", preservedCollection: true });
      }
      if (request.method === "POST" && url.pathname === "/api/review-verification-resume") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        const verificationPaused = state.allowedActions?.reopenReviewVerification === true
          && (!state.verification?.required || verificationBelongsTo(state, "review"));
        if (!verificationPaused) return json(response, 409, { error: "当前没有因人工验证暂停的AI复核任务" });
        await terminateProcessTree(state.workerPid);
        await saveJsonAtomic(statePaths(config).reviewChoice, {
          active: true, mode: "api", taskId: state.taskId, batchId: state.batchId,
          dateKey: state.dateKey || shanghaiDateKey(),
          runName: state.runName || state.dateKey || shanghaiDateKey(),
          resumeVerificationUrl: state.verification?.url || state.review.url || "", requestedAt: new Date().toISOString(),
        });
        await saveJsonAtomic(statePaths(config).agentState, {
          ...state, status: "reviewing", workerPid: null, childPid: null,
          verification: verificationCheckpoint(state, {
            owner: "review", status: "reopening", reopened: true, resetDeadline: true,
            deadlineAt: new Date(Date.now() + config.collection.userActionTimeoutMinutes * 60_000).toISOString(),
          }),
          message: "正在重新打开待验证页面；请在Edge中完成人工验证",
          updatedAt: new Date().toISOString(),
        });
        return json(response, 202, await startWorker(configPath, { operation: "resume_review" }));
      }
      if (request.method === "POST" && url.pathname === "/api/collector-verification-resume") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        let state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        state = await repairBoundRunName(config, state);
        const resumable = state.allowedActions?.reopenCollectorVerification === true
          && (!state.verification?.required || verificationBelongsTo(state, "collector"));
        if (!resumable) return json(response, 409, { error: "当前任务没有处于采集人工验证等待状态。" });
        await terminateProcessTree(state.workerPid);
        await assertBatchBinding(config, bindingFromState(state));
        await saveJsonAtomic(statePaths(config).agentState, {
          ...state,
          verification: verificationCheckpoint(state, {
            owner: "collector", status: "reopening", reopened: true, resetDeadline: true,
            deadlineAt: new Date(Date.now() + config.collection.userActionTimeoutMinutes * 60_000).toISOString(),
          }),
          workerPid: null, childPid: null,
          message: "正在重新打开采集验证断点；已经完成的记录不会重新扫描。",
          updatedAt: new Date().toISOString(),
        });
        return json(response, 202, await startWorker(configPath, { operation: "resume_collection" }));
      }
      if (request.method === "POST" && url.pathname === "/api/review-resume") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        let state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        state = await repairBoundRunName(config, state);
        const reviewResumable = state.allowedActions?.resumeReview === true;
        if (!reviewResumable) return json(response, 409, { error: "当前任务不处于可恢复AI复核的状态。" });
        await assertBatchBinding(config, bindingFromState(state));
        return json(response, 202, await startWorker(configPath, { operation: "resume_review" }));
      }
      if (request.method === "POST" && url.pathname === "/api/collection-abandon") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        if (state.allowedActions?.abandonCollection !== true) {
          return json(response, 409, {
            error: "\u5f53\u524d\u4efb\u52a1\u5fc5\u987b\u5148\u5b89\u5168\u6682\u505c\uff0c\u624d\u80fd\u653e\u5f03\u5e76\u91cd\u65b0\u9009\u62e9\u91c7\u96c6\u8303\u56f4\u3002",
          });
        }
        await terminateProcessTree(state.childPid);
        if (state.workerPid !== state.childPid) await terminateProcessTree(state.workerPid);
        const abandonedAt = new Date().toISOString();
        const pendingRequest = await loadJson(statePaths(config).newTaskRequest, {});
        await saveJsonAtomic(statePaths(config).newTaskRequest, {
          ...pendingRequest,
          active: false,
          abandonedAt,
          abandonedTaskId: state.taskId,
          abandonedBatchId: state.batchId,
        });
        await saveJsonAtomic(statePaths(config).pauseRequest, {
          active: false,
          taskId: state.taskId,
          batchId: state.batchId,
          clearedAt: abandonedAt,
          reason: "user_abandoned_collection",
        });
        const abandonedState = normalizeTaskState({
          ...state,
          ...terminalStatePatch("terminated", {
            phase: "finalization",
            failureReason: "user_abandoned_collection",
            abandonedAt,
            newTaskPending: false,
            message: "\u5df2\u653e\u5f03\u5f53\u524d\u91c7\u96c6\u4efb\u52a1\uff1b\u65ad\u70b9\u548c\u5df2\u4fdd\u5b58\u7ed3\u679c\u4ec5\u4f5c\u5386\u53f2\u7559\u5b58\uff0c\u672c\u6b21\u5019\u9009\u9ad8\u6c34\u4f4d\u4e0d\u751f\u6548\u3002\u73b0\u5728\u53ef\u4ee5\u91cd\u65b0\u9009\u62e9\u91c7\u96c6\u8303\u56f4\u3002",
          }),
          updatedAt: abandonedAt,
        });
        await saveJsonAtomic(statePaths(config).agentState, abandonedState);
        await releaseWorkerLock(config, state, "collection_abandoned_by_user");
        await archiveTaskState(config, abandonedState);
        return json(response, 200, {
          status: "terminated",
          taskId: state.taskId,
          batchId: state.batchId,
          preservedBatchDirectory: state.paths?.batchDirectory || null,
          highWaterAdvanced: false,
        });
      }
      if (request.method === "POST" && url.pathname === "/api/new-task") {
        if (!await isDeveloperDistribution()) {
          const readiness = await onboardingStatus(await loadAgentConfig(configPath));
          if (!readiness.completed) return json(response, 409, { error: "首次运行准备尚未完成，暂不能开始采集" });
        }
        if (newTaskStarting) return json(response, 409, { error: "\u65b0\u91c7\u96c6\u4efb\u52a1\u6b63\u5728\u521b\u5efa\u4e2d\uff0c\u8bf7\u52ff\u91cd\u590d\u70b9\u51fb\u3002" });
        newTaskStarting = true;
        try {
          await prepareFreshTask(configPath, await body(request));
          return json(response, 202, await startWorker(configPath, { operation: "new_collection" }));
        } finally {
          newTaskStarting = false;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/pause") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        if (state.allowedActions?.pauseCollection !== true) {
          return json(response, 409, { error: "当前没有可以暂停的采集任务" });
        }
        const requestedAt = new Date().toISOString();
        await saveJsonAtomic(statePaths(config).pauseRequest, { active: true, taskId: state.taskId, batchId: state.batchId, requestedAt });
        await saveJsonAtomic(statePaths(config).agentState, {
          ...state, status: "pause_requested", message: "已请求暂停；正在完成并保存当前详情页", updatedAt: requestedAt,
        });
        return json(response, 202, { status: "pause_requested", requestedAt });
      }
      if (request.method === "GET" && url.pathname === "/api/high-water") {
        const config = await loadAgentConfig(configPath);
        if (config.collection.scope?.mode === "custom") {
          const state = await loadAgentState(config);
          const progressPath = path.join(config.outputDir, state.runName || state.dateKey || shanghaiDateKey(), "采集进度.json");
          const progress = await loadJson(progressPath, {});
          const rows = Object.entries(progress.newAnchors || {}).map(([key, value]) => {
            const [platformId, category, status, city] = key.split(":");
            return { key, platform: platformLabel(platformId), category, status, city, url: value };
          });
          const snapshot = { statePath: progressPath, updatedAt: progress.updatedAt || null, complete: rows.length > 0, rows };
          return json(response, 200, { ...snapshot, customResult: true, text: formatHighWater(snapshot) });
        }
        const snapshot = await readHighWater(config);
        return json(response, 200, { ...snapshot, text: formatHighWater(snapshot) });
      }
      if (request.method === "GET" && url.pathname === "/api/high-water/province") {
        const config = await loadAgentConfig(configPath);
        const provinceConfig = {
          ...config,
          collection: {
            ...config.collection,
            scope: { mode: "province", province: config.collection.scope?.province || "福建省", cities: [], anchors: {} },
          },
        };
        const snapshot = provinceConfig.stateDir
          ? await readHighWater(provinceConfig).catch(() => emptyHighWaterSnapshot(provinceConfig))
          : emptyHighWaterSnapshot(provinceConfig);
        return json(response, 200, { ...snapshot, kind: "province", text: formatHighWater(snapshot) });
      }
      if (request.method === "GET" && url.pathname === "/api/high-water/custom-last") {
        const config = await loadAgentConfig(configPath);
        let saved = await loadJson(statePaths(config).lastCustomHighWater, null);
        // Backfill the most recent successfully completed custom task created
        // before this dedicated snapshot feature was introduced.
        if (!saved && config.collection.scope?.mode === "custom") {
          const state = await loadAgentState(config);
          const progressPath = path.join(config.outputDir, state.runName || state.dateKey || shanghaiDateKey(), "采集进度.json");
          const progress = await loadJson(progressPath, {});
          if (Object.keys(progress.newAnchors || {}).length) {
            saved = {
              version: 1, dateKey: state.dateKey, runName: state.runName,
              completedAt: progress.updatedAt || state.completedAt || null,
              province: config.collection.scope.province,
              cities: config.collection.scope.cities || [],
              platforms: config.collection.scope.platforms || [],
              categories: String(config.collection.category || "").split(",").filter(Boolean),
              includeBankruptcy: config.collection.alibabaPc?.includeBankruptcy !== false,
              anchors: progress.newAnchors,
            };
            await saveJsonAtomic(statePaths(config).lastCustomHighWater, saved);
          }
        }
        if (saved) {
          const savedCollection = customCollection(config, {
            province: saved.province,
            cities: saved.cities || [],
            platforms: saved.platforms || [],
            categories: saved.categories || [],
            includeBankruptcy: saved.includeBankruptcy !== false,
          }, saved.anchors || {});
          const profile = await loadCustomHighWaterProfile(config, savedCollection);
          const integrity = mergeCustomHighWater(savedCollection, profile?.anchors || {}, saved.anchors || {});
          const completeSaved = {
            ...saved,
            scopeId: profile?.scope?.id || saved.scopeId || null,
            anchors: integrity.anchors,
            expectedCount: integrity.expectedCount,
            validCount: integrity.validCount,
            missingCount: integrity.missingCount,
            missingKeys: integrity.missingKeys,
            complete: integrity.complete,
          };
          const completeRows = requiredScopeAnchors(savedCollection).map((row) => ({
            ...row,
            platform: platformLabel(row.platform),
            category: row.categoryLabel || row.category,
            url: integrity.anchors[row.key] || "",
          }));
          const completeSnapshot = { kind: "custom-last", ...completeSaved, rows: completeRows };
          return json(response, 200, { ...completeSnapshot, text: formatHighWater(completeSnapshot) });
        }
        const rows = Object.entries(saved?.anchors || {}).map(([key, value]) => {
          const [platformId, category, status, city] = key.split(":");
          return { key, platform: platformLabel(platformId), category, status, city, url: value };
        });
        const snapshot = { kind: "custom-last", ...saved, rows, complete: rows.length > 0 };
        return json(response, 200, { ...snapshot, text: formatHighWater(snapshot) });
      }
      if (request.method === "POST" && url.pathname === "/api/high-water/reset") {
        const payload = await body(request);
        let config = await loadAgentConfig(configPath);
        if (config.collection.scope?.mode === "custom") {
          config.collection.scope.anchors = { ...(config.collection.scope.anchors || {}), ...(payload.anchors || {}) };
          config = await saveAgentConfig(config, configPath);
        }
        const effective = await materializeScopeConfig(config);
        const snapshot = await resetHighWater(effective, payload.anchors || {});
        return json(response, 200, { ...snapshot, text: formatHighWater(snapshot) });
      }
      if (request.method === "POST" && url.pathname === "/api/high-water/custom-profile") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const collection = customCollection(config, payload, {});
        const profile = await loadCustomHighWaterProfile(config, collection);
        if (!profile) throw new Error("未找到与当前省份、城市、平台和类别完全一致的小范围高水位记录");
        return json(response, 200, profile);
      }
      if (request.method === "POST" && url.pathname === "/api/high-water/custom-save") {
        const payload = await body(request);
        let config = await loadAgentConfig(configPath);
        const collection = customCollection(config, payload, payload.anchors || {});
        const validKeys = new Set(requiredScopeAnchors(collection).map((row) => row.key));
        const submitted = Object.entries(payload.anchors || {});
        if (!submitted.length) throw new Error("没有可保存的高水位链接");
        for (const [key, value] of submitted) {
          if (!validKeys.has(key)) throw new Error(`高水位不属于当前范围：${key}`);
          if (!/^https?:\/\//u.test(String(value || "").trim())) throw new Error(`高水位链接格式不正确：${key}`);
        }
        const profile = await saveCustomHighWaterProfile(config, collection, payload.anchors, "manual");
        config = await saveAgentConfig({
          ...config,
          collection: { ...collection, scope: { ...collection.scope, anchors: profile.anchors, anchorsConsumed: false } },
        }, configPath);
        return json(response, 200, profile);
      }
      if (request.method === "POST" && url.pathname === "/api/high-water/custom-apply") {
        const payload = await body(request);
        let config = await loadAgentConfig(configPath);
        const collection = customCollection(config, payload, {});
        const profile = await loadCustomHighWaterProfile(config, collection);
        if (!profile) throw new Error("当前完全相同的小范围采集范围还没有已保存高水位");
        const integrity = inspectCustomHighWater(collection, profile.anchors || {});
        if (!integrity.complete) {
          return json(response, 409, {
            error: `相同范围高水位不完整：${integrity.validCount}/${integrity.expectedCount}，缺少${integrity.missingCount}条，已阻止调用。`,
            ...integrity,
          });
        }
        config = await saveAgentConfig({
          ...config,
          collection: { ...collection, scope: { ...collection.scope, anchors: integrity.anchors, anchorsConsumed: false } },
        }, configPath);
        return json(response, 200, { ...profile, ...integrity });
      }
      if (request.method === "POST" && url.pathname === "/api/high-water/reset-province") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const provinceConfig = {
          ...config,
          collection: {
            ...config.collection,
            scope: { mode: "province", province: config.collection.scope?.province || "福建省", cities: [], anchors: {} },
          },
        };
        const snapshot = await resetHighWater(provinceConfig, payload.anchors || {});
        return json(response, 200, { ...snapshot, kind: "province", text: formatHighWater(snapshot) });
      }
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        const config = await loadAgentConfig(configPath);
        return json(response, 200, { tasks: await listTaskHistory(config) });
      }
      if (request.method === "GET" && url.pathname === "/api/task") {
        const config = await loadAgentConfig(configPath);
        const task = await loadTaskHistory(config, url.searchParams.get("taskId"));
        if (!task) return json(response, 404, { error: "Task history not found." });
        return json(response, 200, { task });
      }
      if (request.method === "POST" && url.pathname === "/api/task/open-folder") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const task = await loadTaskHistory(config, payload.taskId);
        if (!task || task.batchId !== payload.batchId) return json(response, 404, { error: "Task and batch identity not found." });
        if (!task.batchDirectory || !isPathInside(config.outputDir, task.batchDirectory)) {
          return json(response, 409, { error: "Saved batch directory is outside the configured output directory." });
        }
        const stat = await fs.stat(task.batchDirectory).catch(() => null);
        if (!stat?.isDirectory()) return json(response, 404, { error: "Saved batch directory no longer exists." });
        const explorer = spawn("explorer.exe", [path.resolve(task.batchDirectory)], {
          detached: true, stdio: "ignore", windowsHide: false,
        });
        explorer.unref();
        return json(response, 200, { opened: true, taskId: task.taskId, batchId: task.batchId });
      }
      if (request.method === "GET" && url.pathname === "/api/workbench-prompt") {
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        const target = url.searchParams.get("target") || "工作台";
        const purpose = url.searchParams.get("purpose") || "run";
        return json(response, 200, { target, purpose, prompt: workbenchPrompt(config, target, purpose, {
          dateKey: state.dateKey || shanghaiDateKey(),
          runName: state.runName || state.dateKey || shanghaiDateKey(),
        }) });
      }
      if (request.method === "POST" && url.pathname === "/api/approve-volume") {
        const payload = await body(request);
        const config = await loadAgentConfig(configPath);
        const state = await loadAgentState(config);
        assertOperationIdentity(state, payload);
        const approvals = await loadJson(statePaths(config).volumeApproval, {});
        approvals[state.batchId] = true;
        await saveJsonAtomic(statePaths(config).volumeApproval, approvals);
        return json(response, 202, await startWorker(configPath, { operation: "resume_collection" }));
      }
      if (url.pathname.startsWith("/api/")) {
        return json(response, 404, { error: "当前Agent后台不支持这个接口。若刚完成程序更新，请关闭旧后台并重新启动Agent。" });
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const publicRoot = path.join(ROOT, "public");
      const filePath = path.resolve(publicRoot, relative);
      if (!filePath.startsWith(`${publicRoot}${path.sep}`) && filePath !== path.join(publicRoot, "index.html")) return json(response, 403, { error: "forbidden" });
      const content = await fs.readFile(filePath);
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
      response.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(content);
    } catch (error) {
      const status = error?.code === "TASK_IDENTITY_REQUIRED" ? 400
        : error?.code === "TASK_IDENTITY_MISMATCH" ? 409 : 500;
      json(response, status, { error: String(error.message || error), code: error?.code || null });
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`法拍资产Agent操作页面：http://127.0.0.1:${port}`);
  if (process.env.AGENT_NO_OPEN !== "1") {
    const opener = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process 'http://127.0.0.1:${port}'`,
    ], { stdio: "ignore", windowsHide: true });
    opener.unref();
  }
  const watchdog = setInterval(async () => {
    try {
      const config = await loadAgentConfig(configPath);
      const state = await loadAgentState(config);
      const active = ["running", "pause_requested"].includes(state.status);
      if (active && state.workerPid && !processAlive(state.workerPid)) {
        const lock = await loadWorkerLock(config);
        if (state.workerRunId && !workerIdentityMatches(state, lock || {})) {
          const failure = await lastWorkerFailure(config);
          await saveJsonAtomic(statePaths(config).agentState, {
            ...state,
            ...terminalStatePatch("failed", {
              failureReason: "worker_identity_mismatch",
              lastFailure: failure.message,
              diagnosticLog: failure.logPath,
              failedAt: new Date().toISOString(),
              message: `Worker\u8eab\u4efd\u9501\u4e0e\u4efb\u52a1\u72b6\u6001\u4e0d\u4e00\u81f4\uff0c\u5df2\u505c\u6b62\u81ea\u52a8\u6062\u590d\u5e76\u4fdd\u7559\u65ad\u70b9\u3002\u65e5\u5fd7\uff1a${failure.logPath}`,
            }),
            updatedAt: new Date().toISOString(),
          });
          await releaseWorkerLock(config, state, "identity_mismatch");
          await archiveTaskState(config, await loadAgentState(config));
          return;
        }
        // 采集引擎已经明确完成、各高水位组也全部处理完时，主进程即使在
        // “写完工作簿 → 等待复核选择”的交界处退出，也不得重新启动采集。
        // 这类情况直接落到复核选择页，避免整批列表被再次扫描。
        const detailsComplete = state.status === "running"
          && state.v2Status === "completed"
          && state.progressSummary?.scanComplete === true
          && Number(state.progressSummary?.remaining || 0) === 0;
        if (detailsComplete) {
          await saveJsonAtomic(statePaths(config).agentState, {
            ...state,
            status: "awaiting_review_choice",
            workerPid: null,
            workerRunId: null,
            childPid: null,
            agentRecoveryCount: 0,
            count: Number(state.progressSummary?.processed || state.count || 0),
            message: "采集和Excel已经完成，请选择API复核、工作台复核或暂不复核。",
            updatedAt: new Date().toISOString(),
          });
          await releaseWorkerLock(config, state, "collection_completed");
          await archiveTaskState(config, await loadAgentState(config));
          return;
        }
        if (recoveryDecision(state, config.collection.maxRetries).exhausted) {
          const failure = await lastWorkerFailure(config);
          await saveJsonAtomic(statePaths(config).agentState, {
            ...state, ...terminalStatePatch("failed", {
            failureReason: "max_retries_exhausted",
            failedAt: new Date().toISOString(),
            lastFailure: failure.message,
            diagnosticLog: failure.logPath,
            message: `Agent主进程意外中断已达${config.collection.maxRetries}次，已暂停并保留断点。最后错误：${failure.message}。日志：${failure.logPath}`,
            message: `Agent主进程意外中断已达${config.collection.maxRetries}次，已暂停并保留断点`,
            message: `Agent主进程意外中断已达${config.collection.maxRetries}次，已暂停并保留断点。最后错误：${failure.message}。日志：${failure.logPath}`,
            updatedAt: new Date().toISOString(),
            }),
          });
          await releaseWorkerLock(config, state, "max_retries_exhausted");
          const failedState = await loadAgentState(config);
          await saveJsonAtomic(statePaths(config).agentState, {
            ...failedState,
            message: `\u81ea\u52a8\u6062\u590d\u5df2\u8fbe${config.collection.maxRetries}\u6b21\u4e0a\u9650\uff0c\u4efb\u52a1\u5df2\u5931\u8d25\u4f46\u65ad\u70b9\u548c\u7ed3\u679c\u5747\u5df2\u4fdd\u7559\u3002\u539f\u56e0\uff1a${failure.message}\uff1b\u65e5\u5fd7\uff1a${failure.logPath}`,
            updatedAt: new Date().toISOString(),
          });
          await archiveTaskState(config, await loadAgentState(config));
        } else {
          const retryOperation = retryOperationFor(state);
          await startWorker(configPath, { operation: retryOperation, recovery: true });
        }
      }
    } catch {}
  }, 15_000);
  watchdog.unref();
  return server;
}
