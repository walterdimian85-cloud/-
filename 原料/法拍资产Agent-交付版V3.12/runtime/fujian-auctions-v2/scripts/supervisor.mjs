import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRunConfig } from "../src/config/load.mjs";
import { dateKeyForRun, parseArgs, resolveRememberedOutputDir } from "./run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = path.join(ROOT, "bin", "auction-cli.mjs");
const USER_ACTION_REQUIRED_MARKER = "AGENT_EVENT:USER_ACTION_REQUIRED";
const USER_ACTION_CLEARED_MARKER = "AGENT_EVENT:USER_ACTION_CLEARED";
// Keep transient recovery bounded. Long silent backoffs make a deterministic
// list-page failure look like an endless collection even though no child is
// running. Five retries now wait at most two minutes each.
const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 120_000];

function dateKeyShanghai(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" })
    .format(now)
    .replaceAll("-", "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateUserActionLatch(current, text) {
  const value = String(text || "");
  const requiredAt = value.lastIndexOf(USER_ACTION_REQUIRED_MARKER);
  const clearedAt = value.lastIndexOf(USER_ACTION_CLEARED_MARKER);
  if (requiredAt >= 0 || clearedAt >= 0) return requiredAt > clearedAt;
  // Only the collector's explicit protocol may change this latch. Ordinary
  // progress/error text can mention login or verification without blocking.
  return Boolean(current);
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function saveJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(temporary, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!/[Ee](PERM|ACCES|BUSY)/.test(String(error?.code || error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  try {
    await fs.copyFile(temporary, filePath);
  } catch {
    throw lastError;
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function processAlive(pid) {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseSupervisorArgs(argv) {
  const childArgs = [];
  const supervisor = {
    maxRetries: 5,
    stallMinutes: 20,
    heartbeatSeconds: 30,
    notify: true,
  };
  const args = argv[0] === "supervise" ? argv.slice(1) : [...argv];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--supervisor-max-retries" && next) {
      supervisor.maxRetries = Number(next);
      index += 1;
    } else if (arg === "--supervisor-stall-minutes" && next) {
      supervisor.stallMinutes = Number(next);
      index += 1;
    } else if (arg === "--supervisor-heartbeat-seconds" && next) {
      supervisor.heartbeatSeconds = Number(next);
      index += 1;
    } else if (arg === "--supervisor-no-notify") {
      supervisor.notify = false;
    } else {
      childArgs.push(arg);
    }
  }
  if (childArgs.includes("--restart")) {
    throw new Error("监工模式禁止使用 --restart；必须依靠采集进度断点续爬。");
  }
  if (!(supervisor.maxRetries >= 0) || !(supervisor.stallMinutes > 0) || !(supervisor.heartbeatSeconds > 0)) {
    throw new Error("监工重试次数不得小于0，停滞分钟数和心跳秒数必须大于0。");
  }
  if (!childArgs.length || childArgs[0].startsWith("--")) childArgs.unshift("run");
  else if (childArgs[0] !== "run") throw new Error("监工模式仅支持run采集命令。");
  return { childArgs, supervisor };
}

function classifyRunOutcome({ exitCode, result, outputText, dryRun, stalled, activeUserAction }) {
  const failures = Array.isArray(result?.failures) ? result.failures : [];
  const failureText = `${outputText}\n${failures.map((item) => JSON.stringify(item)).join("\n")}`;
  const userAction = activeUserAction ?? USER_ACTION_PATTERN.test(
    `${outputText}\n${failures.map((item) => JSON.stringify(item)).join("\n")}`,
  );
  const stateOk = dryRun ? result?.stateAdvanced === false : result?.stateAdvanced === true;
  if (exitCode === 0 && failures.length === 0 && stateOk) {
    return { status: "completed", retryable: false, needsUserAction: false };
  }
  if (userAction) {
    return { status: "needs_user_action", retryable: false, needsUserAction: true };
  }
  if (/阿里资产未(?:找到所在地筛选|能展开.+地级市筛选)|未找到.+(?:筛选|排序)控件/u.test(failureText)) {
    return { status: "configuration_failed", retryable: false, needsUserAction: false };
  }
  return {
    status: stalled ? "stalled" : "retryable_failure",
    retryable: true,
    needsUserAction: false,
  };
}

async function notifyWindows(title, message, enabled = true) {
  if (!enabled || process.platform !== "win32") return;
  const escapedTitle = String(title).replaceAll("'", "''");
  const escapedMessage = String(message).replaceAll("'", "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "$n=New-Object System.Windows.Forms.NotifyIcon",
    "$n.Icon=[System.Drawing.SystemIcons]::Information",
    `$n.BalloonTipTitle='${escapedTitle}'`,
    `$n.BalloonTipText='${escapedMessage}'`,
    "$n.Visible=$true",
    "$n.ShowBalloonTip(8000)",
    "Start-Sleep -Seconds 9",
    "$n.Dispose()",
  ].join(";");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}

async function acquireLock(lockPath, statusPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await handle.close();
    return { acquired: true };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const lock = await loadJson(lockPath, {});
    if (processAlive(Number(lock.pid))) {
      return { acquired: false, existingStatus: await loadJson(statusPath, lock) };
    }
    await fs.rm(lockPath, { force: true });
    return acquireLock(lockPath, statusPath);
  }
}

async function runChildOnce({ childArgs, options, paths, heartbeatSeconds, stallMinutes, attempt, maxAttempts, onUserAction }) {
  let outputText = "";
  let lastActivityMs = Date.now();
  let lastProgressMs = 0;
  let stalled = false;
  let needsUserAction = false;
  let userActionSignalBuffer = "";
  let latestProgress = null;
  const child = spawn(process.execPath, [CLI_PATH, ...childArgs], {
    cwd: ROOT,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });
  const startedAt = new Date().toISOString();

  const receive = (stream, target) => {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      outputText = `${outputText}${text}`.slice(-30_000);
      userActionSignalBuffer = `${userActionSignalBuffer}${text}`.slice(-2_000);
      lastActivityMs = Date.now();
      const nextUserAction = updateUserActionLatch(needsUserAction, userActionSignalBuffer);
      if (nextUserAction && !needsUserAction) {
        Promise.resolve(onUserAction?.()).catch(() => {});
      }
      needsUserAction = nextUserAction;
      target.write(text);
    });
  };
  receive(child.stdout, process.stdout);
  receive(child.stderr, process.stderr);

  const heartbeat = async () => {
    try {
      const stat = await fs.stat(paths.checkpointPath).catch(() => null);
      if (stat?.mtimeMs > lastProgressMs) {
        lastProgressMs = stat.mtimeMs;
        lastActivityMs = Math.max(lastActivityMs, stat.mtimeMs);
        latestProgress = await loadJson(paths.checkpointPath, latestProgress);
      }
      const idleMs = Date.now() - lastActivityMs;
      await saveJsonAtomic(paths.statusPath, {
        version: 1,
        status: needsUserAction ? "needs_user_action" : "running",
        dateKey: paths.dateKey,
        supervisorPid: process.pid,
        childPid: child.pid,
        attempt,
        maxAttempts,
        startedAt,
        lastHeartbeatAt: new Date().toISOString(),
        lastProgressAt: lastProgressMs ? new Date(lastProgressMs).toISOString() : null,
        idleSeconds: Math.round(idleMs / 1000),
        current: latestProgress?.current || {},
        counts: latestProgress?.counts || {},
        progressStatus: latestProgress?.status || "尚未生成采集进度",
        needsUserAction,
        lastMessage: outputText.trim().split(/\r?\n/u).at(-1) || "",
        outputDir: options.outputDir,
        checkpointPath: paths.checkpointPath,
      });
      if (!needsUserAction && idleMs >= stallMinutes * 60_000) {
        stalled = true;
        child.kill("SIGTERM");
        const forceTimer = setTimeout(() => {
          if (!processAlive(child.pid) || process.platform !== "win32") return;
          const killer = spawn(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { stdio: "ignore", windowsHide: true },
          );
          killer.unref();
        }, 10_000);
        forceTimer.unref();
      }
    } catch (error) {
      console.warn(`监工心跳暂时无法写入：${String(error)}`);
    }
  };

  await heartbeat();
  const timer = setInterval(heartbeat, heartbeatSeconds * 1000);
  const exit = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
  });
  clearInterval(timer);
  await heartbeat();
  return { ...exit, outputText, stalled, latestProgress, needsUserAction, startedAt };
}

async function supervise({
  childArgs,
  supervisor,
  options,
  retryDelaysMs = RETRY_DELAYS_MS,
  runOnce = runChildOnce,
  sleepFn = sleep,
  notifyFn = notifyWindows,
}) {
  const dateKey = dateKeyForRun(options);
  const runDir = path.join(options.outputDir, options.runName || dateKey);
  const paths = {
    dateKey,
    runDir,
    checkpointPath: path.join(runDir, "采集进度.json"),
    resultPath: path.join(runDir, "运行结果.json"),
    statusPath: path.join(options.stateDir, "任务状态.json"),
    lockPath: path.join(options.stateDir, "locks", `auction-${dateKey}.lock`),
  };
  const lock = await acquireLock(paths.lockPath, paths.statusPath);
  if (!lock.acquired) {
    console.log(JSON.stringify({ alreadyRunning: true, status: lock.existingStatus }, null, 2));
    return { exitCode: 0, status: lock.existingStatus };
  }
  const maxAttempts = supervisor.maxRetries + 1;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await saveJsonAtomic(paths.statusPath, {
        version: 1,
        status: attempt === 1 ? "starting" : "retrying",
        dateKey,
        supervisorPid: process.pid,
        attempt,
        maxAttempts,
        lastHeartbeatAt: new Date().toISOString(),
        outputDir: options.outputDir,
      });
      const childResult = await runOnce({
        childArgs,
        options,
        paths,
        heartbeatSeconds: supervisor.heartbeatSeconds,
        stallMinutes: supervisor.stallMinutes,
        attempt,
        maxAttempts,
        onUserAction: async () => {
          const currentStatus = await loadJson(paths.statusPath, {});
          await saveJsonAtomic(paths.statusPath, {
            ...currentStatus,
            status: "needs_user_action",
            needsUserAction: true,
            lastHeartbeatAt: new Date().toISOString(),
            lastMessage: "检测到平台登录或安全验证，正在等待人工处理。",
          });
          await notifyFn(
            "福建法拍房采集需要人工验证",
            "请打开Edge完成人工登录、验证码或滑块；程序会保留进度并等待。",
            supervisor.notify,
          );
        },
      });
      const resultStat = await fs.stat(paths.resultPath).catch(() => null);
      const result = resultStat && resultStat.mtimeMs >= Date.parse(childResult.startedAt) - 1_000
        ? await loadJson(paths.resultPath, null)
        : null;
      const outcome = classifyRunOutcome({
        exitCode: childResult.code,
        result,
        outputText: childResult.outputText,
        dryRun: options.dryRun,
        stalled: childResult.stalled,
        activeUserAction: childResult.needsUserAction,
      });
      const finalStatus = {
        version: 1,
        status: outcome.status,
        dateKey,
        supervisorPid: process.pid,
        childPid: null,
        attempt,
        maxAttempts,
        lastHeartbeatAt: new Date().toISOString(),
        exitCode: childResult.code,
        signal: childResult.signal || null,
        needsUserAction: outcome.needsUserAction,
        failures: result?.failures || [],
        stateAdvanced: result?.stateAdvanced ?? null,
        dryRun: result?.dryRun ?? options.dryRun,
        workbookQa: result?.workbookQa || null,
        outputDir: options.outputDir,
        resultPath: paths.resultPath,
        checkpointPath: paths.checkpointPath,
        lastMessage: childResult.outputText.trim().split(/\r?\n/u).at(-1) || "",
      };
      await saveJsonAtomic(paths.statusPath, finalStatus);
      if (outcome.status === "completed") {
        await notifyFn("福建法拍房采集完成", `任务已完成，结果保存在：${runDir}`, supervisor.notify);
        return { exitCode: 0, status: finalStatus };
      }
      if (outcome.needsUserAction) {
        await notifyFn("福建法拍房采集需要处理", "任务已暂停，请查看任务状态和Edge验证页面。", supervisor.notify);
        return { exitCode: 2, status: finalStatus };
      }
      if (!outcome.retryable) {
        const failedStatus = { ...finalStatus, status: outcome.status, retryExhausted: false };
        await saveJsonAtomic(paths.statusPath, failedStatus);
        await notifyFn("法拍房采集筛选失败", "页面筛选条件无法确认，任务已停止且高水位未推进。", supervisor.notify);
        return { exitCode: 3, status: failedStatus };
      }
      if (attempt < maxAttempts) {
        const delayMs = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)];
        await saveJsonAtomic(paths.statusPath, {
          ...finalStatus,
          status: "waiting_to_retry",
          nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
        });
        console.warn(`采集异常，将在 ${Math.round(delayMs / 1000)} 秒后按原命令断点续爬（第 ${attempt + 1}/${maxAttempts} 次）。`);
        await sleepFn(delayMs);
      } else {
        const failedStatus = { ...finalStatus, status: "failed", retryExhausted: true };
        await saveJsonAtomic(paths.statusPath, failedStatus);
        await notifyFn("福建法拍房采集失败", "自动重试次数已用完，请查看任务状态。", supervisor.notify);
        return { exitCode: 3, status: failedStatus };
      }
    }
  } finally {
    await fs.rm(paths.lockPath, { force: true }).catch(() => {});
  }
  return { exitCode: 3, status: null };
}

function help() {
  console.log(`福建法拍房本地监工

用法：
  node bin/auction-cli.mjs supervise [run选项] [监工选项]

监工选项：
  --supervisor-max-retries N       可恢复失败最大重试次数，默认5
  --supervisor-stall-minutes N     无活动停滞阈值，默认20分钟
  --supervisor-heartbeat-seconds N 状态心跳间隔，默认30秒
  --supervisor-no-notify           关闭Windows桌面通知

所有普通run选项均可继续使用。监工模式禁止--restart，并将状态写入stateDir\\任务状态.json。`);
}

async function main(argv = process.argv.slice(2)) {
  const { childArgs, supervisor } = parseSupervisorArgs(argv);
  if (childArgs.includes("--help") || childArgs.includes("-h")) return help();
  const loaded = await loadRunConfig(childArgs);
  const options = parseArgs(loaded.argv, loaded.config);
  await resolveRememberedOutputDir(options);
  const result = await supervise({ childArgs, supervisor, options });
  console.log(JSON.stringify(result.status, null, 2));
  process.exitCode = result.exitCode;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export {
  acquireLock,
  classifyRunOutcome,
  dateKeyShanghai,
  help,
  main,
  parseSupervisorArgs,
  processAlive,
  supervise,
  updateUserActionLatch,
};
