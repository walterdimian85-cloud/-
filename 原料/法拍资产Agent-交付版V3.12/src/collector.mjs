import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadJson, processAlive, shanghaiDateKey, sleep } from "./utils.mjs";
import { statePaths } from "./state.mjs";
import { summarizeProgress } from "./progress-summary.mjs";
import { statusScopeFields, workbookName } from "./status-scope.mjs";
import { collectionGroupRows } from "./task-scope.mjs";

async function terminateTree(child) {
  if (!child?.pid || !processAlive(child.pid)) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore", windowsHide: true,
      });
      killer.once("exit", resolve); killer.once("error", resolve);
    });
  } else child.kill("SIGTERM");
}

export function collectionPaths(config, dateKey = null) {
  dateKey = dateKey || config.collection?.dateKey || shanghaiDateKey();
  const runName = config.collection?.runName || dateKey;
  const runDir = path.join(config.outputDir, runName);
  return {
    dateKey, runDir,
    progress: path.join(runDir, "采集进度.json"),
    result: path.join(runDir, "运行结果.json"),
    workbook: config.collection?.workbookPath || path.join(runDir, workbookName(dateKey, statusScopeFields(config.collection).selectedStatuses)),
    v2TaskState: path.join(config.stateDir, "任务状态.json"),
  };
}

async function finalizeWorkbookPath(paths) {
  const legacyWorkbook = path.join(paths.runDir, `${paths.dateKey}新增房源信息.xlsx`);
  if (path.resolve(legacyWorkbook) === path.resolve(paths.workbook)) return;
  const targetExists = await fs.access(paths.workbook).then(() => true).catch(() => false);
  const legacyExists = await fs.access(legacyWorkbook).then(() => true).catch(() => false);
  if (!targetExists && legacyExists) await fs.rename(legacyWorkbook, paths.workbook);
}

function expectedGroups(config) {
  return collectionGroupRows(config.collection).length;
}

function expectedGroupKeys(config) {
  return collectionGroupRows(config.collection).map((row) => row.key);
}

export function pauseCheckpointReady(pauseRequest, progress, workbookSavedAt) {
  if (!pauseRequest?.active) return false;
  const requestedAt = Date.parse(pauseRequest.requestedAt || "");
  const progressSavedAt = Date.parse(progress?.updatedAt || "");
  return Number.isFinite(requestedAt) && progressSavedAt >= requestedAt && workbookSavedAt >= requestedAt;
}

export function collectorVerificationSignal(taskState, childStartedAt, consecutiveSamples = 1) {
  if (!taskState || taskState.needsUserAction === false) return false;
  const requested = taskState.needsUserAction === true || taskState.status === "needs_user_action";
  if (!requested) return false;
  const heartbeatAt = Date.parse(taskState.lastHeartbeatAt || taskState.updatedAt || taskState.requestedAt || "");
  const startedAt = Number(childStartedAt || 0);
  if (!Number.isFinite(heartbeatAt) || !startedAt || heartbeatAt < startedAt - 1000) return false;
  // The V2 supervisor can briefly latch a login/verification signal while the
  // collector has already resumed and continues saving records. A genuinely
  // blocked browser has stopped making progress; an actively advancing task
  // must not be presented as safely paused.
  const idleSeconds = Number(taskState.idleSeconds);
  if (Number.isFinite(idleSeconds) && idleSeconds < 15) return false;
  return Number(consecutiveSamples || 0) >= 2;
}

export async function runCollection(config, { onSnapshot, volumeApproved = false, batchBaseline = 0, restart = false, scanOnly = false, taskId = null, batchId = null } = {}) {
  const paths = collectionPaths(config);
  const cli = path.join(config.skillV2Dir, "bin", "auction-cli.mjs");
  // 预扫描是一次性、只生成计划的操作，不应由“正式采集完成判定”的监工反复重启。
  const args = scanOnly
    ? [cli, "run", "--headed", "--platform", config.collection.platform,
      "--low-frequency", "--state-dir", config.stateDir, "--output-dir", config.outputDir,
      "--login-wait-minutes", String(config.collection.userActionTimeoutMinutes)]
    : [cli, "supervise", "run", "--headed", "--platform", config.collection.platform,
      "--low-frequency", "--state-dir", config.stateDir, "--output-dir", config.outputDir,
      "--login-wait-minutes", String(config.collection.userActionTimeoutMinutes),
      "--supervisor-max-retries", String(config.collection.maxRetries),
      "--supervisor-heartbeat-seconds", String(config.collection.heartbeatSeconds)];
  if (config.collection.category) args.push("--category", config.collection.category);
  if (config.collection.status) args.push("--status", config.collection.status);
  if (config.collection.scope?.province) args.push("--province", config.collection.scope.province);
  if (config.collection.scope?.cities?.length) args.push("--cities", config.collection.scope.cities.join(","));
  if (String(config.collection.platform || "").includes("alibaba_pc")) {
    args.push(config.collection.alibabaPc?.includeBankruptcy === false ? "--exclude-bankruptcy" : "--include-bankruptcy");
  }
  if (config.collection.maxItems !== null && config.collection.maxItems !== "" && Number.isFinite(Number(config.collection.maxItems))) {
    args.push("--max-items", String(config.collection.maxItems));
  }
  if (config.collection.maxPages !== null && config.collection.maxPages !== "" && Number.isFinite(Number(config.collection.maxPages))) {
    args.push("--max-pages", String(config.collection.maxPages));
  }
  if (config.collection.dryRun) args.push("--dry-run");
  if (scanOnly) args.push("--scan-only");
  if (restart) args.push("--restart");
  if (config.collection.skipHistoricalRefresh) args.push("--skip-historical-refresh");
  if (config.collection.runName) args.push("--run-name", config.collection.runName);
  if (config.profileDir) args.push("--profile-dir", config.profileDir);
  const logPath = path.join(config.agentDataDir, `collection-${paths.dateKey}.log`);
  const logHandle = await fs.open(logPath, "a");
  const child = spawn(process.execPath, args, {
    cwd: config.skillV2Dir,
    env: process.env,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
    windowsHide: false,
  });
  const started = Date.now();
  let gate = null;
  let exit = null;
  let verificationSamples = 0;
  let userActionRequired = false;
  const requiredGroupKeys = expectedGroupKeys(config);
  let lastSummary = summarizeProgress({}, {
    batchBaseline, expectedGroupCount: expectedGroups(config), expectedGroupKeys: requiredGroupKeys,
  });
  const publishSnapshot = async (snapshot) => {
    try { await onSnapshot?.(snapshot); }
    catch (error) {
      // Never leave a detached V2 supervisor collecting after the Agent
      // worker can no longer persist its authoritative state.
      await terminateTree(child);
      throw error;
    }
  };
  child.once("exit", (code, signal) => { exit = { code, signal }; });
  child.once("error", (error) => { exit = { code: null, signal: null, error: String(error) }; });
  while (!exit) {
    const progress = await loadJson(paths.progress, null);
    const taskState = await loadJson(paths.v2TaskState, null);
    const rawVerification = Boolean(taskState
      && taskState.needsUserAction !== false
      && (taskState.needsUserAction === true || taskState.status === "needs_user_action"));
    verificationSamples = rawVerification ? verificationSamples + 1 : 0;
    userActionRequired = collectorVerificationSignal(taskState, started, verificationSamples);
    const pauseRequest = await loadJson(statePaths(config).pauseRequest, null);
    // “处理量”用于500/600条安全阈值，应包含已打开但最终排除或待复核的链接。
    // 仅使用records会漏掉这些页面，导致安全闸门触发过晚。
    const summary = summarizeProgress(progress || {}, {
      batchBaseline, expectedGroupCount: expectedGroups(config), expectedGroupKeys: requiredGroupKeys,
    });
    lastSummary = summary;
    const totalCount = Number(progress?.counts?.completedUrls ?? progress?.completedUrls?.length
      ?? progress?.counts?.records ?? progress?.records?.length ?? 0);
    // 页面、安全阈值和本批次统计必须使用当前高水位范围内的详情数量，
    // 不能把同日旧任务保留在completedUrls中的历史链接重复累计。
    const count = summary.groups.length
      ? summary.processed
      : Math.max(0, totalCount - Number(batchBaseline || 0));
    const elapsedMinutes = (Date.now() - started) / 60_000;
    await publishSnapshot({ paths, childPid: child.pid, progress, taskState, userActionRequired, count, totalCount, summary, elapsedMinutes });
    const outputLocked = taskState?.status === "waiting_to_retry"
      && /(?:EBUSY|resource busy|locked).*\.xlsx/iu.test(String(taskState.lastMessage || ""))
      && summary.scanComplete && summary.remaining === 0;
    if (outputLocked) {
      gate = {
        type: "output_locked",
        count,
        message: "详情采集已经完成，但最终Excel正被占用。请关闭当日工作簿，然后点击“完成收尾并选择复核方式”。",
      };
      await terminateTree(child);
      break;
    }
    const pauseTargetsCurrentTask = pauseRequest?.active
      && (!taskId || (pauseRequest.taskId === taskId && pauseRequest.batchId === batchId));
    if (pauseTargetsCurrentTask) {
      let workbookSavedAt = 0;
      try {
        const stat = await fs.stat(progress?.checkpointWorkbookPath || path.join(paths.runDir, `${paths.dateKey}新增房源信息_采集中.xlsx`));
        workbookSavedAt = stat.mtimeMs;
      } catch {}
      const pauseWaitSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(pauseRequest.requestedAt || "")) / 1000));
      await publishSnapshot({ paths, childPid: child.pid, progress, taskState, userActionRequired, count, totalCount, summary, elapsedMinutes,
        pauseWaitSeconds, pauseGraceSeconds: config.collection.pauseGraceSeconds || 90 });
      if (pauseCheckpointReady(pauseRequest, progress, workbookSavedAt)) {
        gate = { type: "user_pause", count, message: "当前详情页已采集并保存，任务已暂停" };
        await terminateTree(child); break;
      }
      if (pauseWaitSeconds >= (config.collection.pauseGraceSeconds || 90)) {
        gate = { type: "user_pause", count, message: "当前页面等待超过90秒，已在最近一次完整保存点安全暂停；恢复后会重新处理未完成页面" };
        await terminateTree(child); break;
      }
    }
    if (count > config.collection.stopAtRecords) {
      gate = { type: "volume_stop", count, message: `已采集${count}条，超过${config.collection.stopAtRecords}条强制停止线` };
      await terminateTree(child); break;
    }
    if (count > config.collection.warnAtRecords && !volumeApproved) {
      gate = { type: "confirm_high_water", count, message: `已采集${count}条，请确认前一日高水位是否正确` };
      await terminateTree(child); break;
    }
    if (elapsedMinutes >= config.collection.maxRuntimeMinutes) {
      gate = { type: "runtime_limit", count, message: `运行达到${config.collection.maxRuntimeMinutes}分钟，已安全暂停` };
      await terminateTree(child); break;
    }
    // State, pause and final-progress observation are local file reads. Keep
    // their latency bounded even when browser polling is configured higher.
    await sleep(Math.min(config.collection.pollSeconds * 1000, 2_000));
  }
  if (!exit) {
    for (let i = 0; i < 20 && !exit; i += 1) await sleep(250);
  }
  await logHandle.close();
  // The child can persist its last group and exit between polling ticks.
  // Re-read the authoritative checkpoint so 24/24 cannot be returned as the
  // previous 23/24 snapshot and incorrectly trigger a fresh collection retry.
  const finalProgress = await loadJson(paths.progress, null);
  if (finalProgress) {
    lastSummary = summarizeProgress(finalProgress, {
      batchBaseline,
      expectedGroupCount: expectedGroups(config),
      expectedGroupKeys: requiredGroupKeys,
    });
  }
  const result = await loadJson(paths.result, null);
  const taskState = await loadJson(paths.v2TaskState, null);
  if (exit?.code === 0 && !gate) await finalizeWorkbookPath(paths);
  return { paths, exit, gate, result, taskState, userActionRequired, summary: lastSummary, logPath };
}
