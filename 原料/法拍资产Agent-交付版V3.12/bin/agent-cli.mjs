#!/usr/bin/env node
import path from "node:path";
import { DEFAULT_CONFIG_PATH, loadAgentConfig } from "../src/config.mjs";
import { runAgent } from "../src/orchestrator.mjs";
import { serve } from "../src/server.mjs";
import { loadAgentState, saveAgentState, terminalStatePatch } from "../src/state.mjs";
import { materializeScopeConfig } from "../src/task-scope.mjs";
import { applyWorkbenchReview, exportWorkbenchReview } from "../src/workbench-review.mjs";
import { assertWorkerOperation, releaseWorkerLock, workerRunIdMatches } from "../src/worker-lock.mjs";
import { sleep } from "../src/utils.mjs";
import { developerPasswordConfigured, setDeveloperPassword } from "../src/developer-auth.mjs";
import { isDeveloperDistribution } from "../src/distribution.mjs";

async function readSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("请在交互式终端中设置开发者密码");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n");
      error ? reject(error) : resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("已取消"));
        if (char === "\u007f" || char === "\b") { if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); } }
        else { value += char; process.stdout.write("*"); }
      }
    };
    process.stdin.on("data", onData);
  });
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] || "serve";
const configPath = path.resolve(option("--config", DEFAULT_CONFIG_PATH));
try {
  if (command === "serve") {
    await serve({ port: Number(option("--port", 8765)), configPath });
  } else if (command === "run") {
    const config = await loadAgentConfig(configPath);
    const workerOperation = process.env.AGENT_WORKER_OPERATION || option("--operation");
    assertWorkerOperation(workerOperation);
    const expectedWorkerRunId = process.env.AGENT_WORKER_RUN_ID || null;
    if (expectedWorkerRunId) {
      let authorized = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (workerRunIdMatches(expectedWorkerRunId, await loadAgentState(config))) {
          authorized = true;
          break;
        }
        await sleep(50);
      }
      if (!authorized) throw new Error("Worker identity no longer matches the active task; refusing to run.");
    }
    console.log(JSON.stringify(await runAgent(config, { operation: workerOperation }), null, 2));
  } else if (command === "status") {
    const config = await loadAgentConfig(configPath);
    console.log(JSON.stringify(await loadAgentState(config), null, 2));
  } else if (command === "developer-password") {
    if (!await isDeveloperDistribution()) throw new Error("交付版不允许设置或修改开发者密码");
    const action = process.argv[3] || "set";
    if (!["set", "change"].includes(action)) throw new Error("仅支持 developer-password set 或 change");
    const configured = await developerPasswordConfigured();
    const current = configured ? await readSecret("原开发者密码：") : null;
    const password = await readSecret("新开发者密码（至少10位）：");
    const confirmation = await readSecret("再次输入新密码：");
    if (password !== confirmation) throw new Error("两次输入的密码不一致");
    await setDeveloperPassword(password, current);
    console.log("开发者密码已安全保存到Windows凭据管理器。");
  } else if (command === "review-export") {
    const baseConfig = await loadAgentConfig(configPath);
    const state = await loadAgentState(baseConfig);
    const dateKey = option("--date") || state.dateKey || undefined;
    const runName = option("--run-name") || state.runName || undefined;
    const config = await materializeScopeConfig(baseConfig);
    const exported = await exportWorkbenchReview(config, dateKey, runName, { taskId: state.taskId, batchId: state.batchId });
    await saveAgentState(baseConfig, {
      status: "review_pending_workbench", review: exported,
      message: exported.recoveredRecords
        ? `已从本批隔离状态恢复${exported.recoveredRecords}条记录，等待工作台复核。`
        : `已导出${exported.candidates}条工作台复核候选。`,
    });
    console.log(JSON.stringify(exported, null, 2));
  } else if (command === "review-apply") {
    const baseConfig = await loadAgentConfig(configPath);
    const state = await loadAgentState(baseConfig);
    const dateKey = option("--date") || state.dateKey || undefined;
    const runName = option("--run-name") || state.runName || undefined;
    const config = await materializeScopeConfig(baseConfig);
    const result = await applyWorkbenchReview(config, dateKey, runName, { taskId: state.taskId, batchId: state.batchId });
    await saveAgentState(baseConfig, {
      status: "completed",
      stage: "complete",
      message: `工作台复核已完成：复核 ${result.reviewed} 条，应用 ${result.changes} 项修正。`,
      workbook: result.workbook,
      report: result.report,
      completedAt: new Date().toISOString(),
    });
    await saveAgentState(baseConfig, terminalStatePatch("completed"));
    await releaseWorkerLock(baseConfig, await loadAgentState(baseConfig), "workbench_review_completed");
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "help") {
    console.log("用法：node bin/agent-cli.mjs serve|run|status|review-export|review-apply [--config FILE] [--date YYYYMMDD] [--port 8765]");
  } else throw new Error(`未知命令：${command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
