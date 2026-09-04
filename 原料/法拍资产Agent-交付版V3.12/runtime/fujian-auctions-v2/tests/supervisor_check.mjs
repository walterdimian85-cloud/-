import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireLock,
  classifyRunOutcome,
  dateKeyShanghai,
  parseSupervisorArgs,
  supervise,
  updateUserActionLatch,
} from "../scripts/supervisor.mjs";

assert.deepEqual(
  parseSupervisorArgs([
    "supervise",
    "--platform", "alibaba",
    "--supervisor-max-retries", "3",
    "--supervisor-stall-minutes", "5",
    "--supervisor-no-notify",
  ]),
  {
    childArgs: ["run", "--platform", "alibaba"],
    supervisor: { maxRetries: 3, stallMinutes: 5, heartbeatSeconds: 30, notify: false },
  },
);
assert.throws(() => parseSupervisorArgs(["supervise", "--restart"]), /禁止使用 --restart/u);
assert.equal(dateKeyShanghai(new Date("2026-08-05T01:00:00.000Z")), "20260805");
assert.equal(updateUserActionLatch(false, "检测到阿里资产登录/验证页，请人工完成"), true);
assert.equal(updateUserActionLatch(true, "进度已保存：4条"), true, "checkpoint output must not clear verification");
assert.equal(updateUserActionLatch(true, "淘宝登录/验证已确认，继续采集阿里资产"), false);
assert.equal(updateUserActionLatch(true, "京东登录/验证已完成，继续采集京东拍卖"), false);
assert.equal(updateUserActionLatch(false, "AGENT_EVENT:USER_ACTION_REQ"), false);
assert.equal(updateUserActionLatch(false, "AGENT_EVENT:USER_ACTION_REQUIRED:alibaba"), true);
assert.equal(updateUserActionLatch(true, "AGENT_EVENT:USER_ACTION_REQUIRED:alibaba\n普通输出\nAGENT_EVENT:USER_ACTION_CLEARED:alibaba"), false);
assert.equal(updateUserActionLatch(false, "AGENT_EVENT:USER_ACTION_CLEARED:alibaba\nAGENT_EVENT:USER_ACTION_REQUIRED:jd"), true);

assert.deepEqual(
  classifyRunOutcome({
    exitCode: 0,
    result: { failures: [], stateAdvanced: true },
    outputText: "done",
    dryRun: false,
    stalled: false,
  }),
  { status: "completed", retryable: false, needsUserAction: false },
);
assert.equal(
  classifyRunOutcome({
    exitCode: 2,
    result: { failures: [{ stage: "anchor", error: "未找到昨日锚点" }], stateAdvanced: false },
    outputText: "",
    dryRun: false,
    stalled: false,
  }).status,
  "needs_user_action",
);
assert.equal(
  classifyRunOutcome({
    exitCode: 1,
    result: null,
    outputText: "network timeout",
    dryRun: false,
    stalled: false,
  }).retryable,
  true,
);
assert.deepEqual(
  classifyRunOutcome({
    exitCode: 2,
    result: { failures: [{ stage: "list", error: "Error: 阿里资产未找到所在地筛选：泉州" }], stateAdvanced: false },
    outputText: "",
    dryRun: false,
    stalled: false,
  }),
  { status: "configuration_failed", retryable: false, needsUserAction: false },
);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fujian-auctions-supervisor-"));
try {
  const activeLock = path.join(tempDir, "active.lock");
  await fs.writeFile(activeLock, JSON.stringify({ pid: process.pid }), "utf8");
  assert.equal((await acquireLock(activeLock, path.join(tempDir, "status.json"))).acquired, false);

  const staleLock = path.join(tempDir, "stale.lock");
  await fs.writeFile(staleLock, JSON.stringify({ pid: 2147483647 }), "utf8");
  assert.equal((await acquireLock(staleLock, path.join(tempDir, "status.json"))).acquired, true);
  await fs.rm(staleLock, { force: true });

  let calls = 0;
  const result = await supervise({
    childArgs: ["run", "--dry-run"],
    supervisor: { maxRetries: 2, stallMinutes: 1, heartbeatSeconds: 1, notify: false },
    options: { stateDir: path.join(tempDir, "state"), outputDir: path.join(tempDir, "output"), dryRun: true },
    retryDelaysMs: [0],
    sleepFn: async () => {},
    notifyFn: async () => {},
    runOnce: async ({ paths }) => {
      calls += 1;
      if (calls === 1) {
        return { code: 1, signal: null, outputText: "temporary network error", stalled: false, needsUserAction: false, startedAt: new Date().toISOString() };
      }
      await fs.mkdir(paths.runDir, { recursive: true });
      await fs.writeFile(paths.resultPath, JSON.stringify({
        failures: [], dryRun: true, stateAdvanced: false,
        workbookQa: { totalRows: 1, upcomingRows: 1, endedRows: 0, reviewRows: 0 },
      }), "utf8");
      return { code: 0, signal: null, outputText: "done", stalled: false, needsUserAction: false, startedAt: new Date(Date.now() - 1_000).toISOString() };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.exitCode, 0);
  assert.equal(result.status.status, "completed");
  assert.equal((await fs.stat(path.join(tempDir, "state", "任务状态.json"))).isFile(), true);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("supervisor checks passed");
