import path from "node:path";
import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { archiveTaskState } from "./batch-binding.mjs";
import { normalizeTaskState } from "./task-state-model.mjs";

export function statePaths(config) {
  return {
    agentState: path.join(config.agentDataDir, "agent-state.json"),
    pauseRequest: path.join(config.agentDataDir, "pause-request.json"),
    volumeApproval: path.join(config.agentDataDir, "volume-approval.json"),
    newTaskRequest: path.join(config.agentDataDir, "new-task-request.json"),
    reviewChoice: path.join(config.agentDataDir, "review-choice.json"),
    lastCustomHighWater: path.join(config.agentDataDir, "last-custom-high-water.json"),
    customHighWaterProfiles: path.join(config.agentDataDir, "custom-scope-high-water.json"),
    history: path.join(config.agentDataDir, "history", "records.json"),
    events: path.join(config.agentDataDir, "events.jsonl"),
    workerLock: path.join(config.agentDataDir, "worker-lock.json"),
  };
}

export async function loadAgentState(config) {
  const persisted = await loadJson(statePaths(config).agentState, {
    version: 1, status: "idle", updatedAt: new Date().toISOString(),
  });
  const state = normalizeTaskState(persisted);
  // Older runs could persist a completed task with a live-looking PID and a
  // stale V2 "running" status. Normalize that legacy shape on every read so
  // the UI and watchdog cannot treat a terminal task as active.
  if (["completed", "partial_completed", "failed", "terminated"].includes(state.status)) return {
    ...state,
    workerPid: null,
    workerRunId: null,
    workerStartedAt: null,
    workerRole: null,
    childPid: null,
    v2Status: state.status,
    gate: null,
    userActionDeadline: null,
    pauseWaitSeconds: 0,
    verification: state.verification?.required ? { ...state.verification, required: false, status: "cancelled" } : state.verification,
  };
  return state;
}

export async function saveAgentState(config, patch) {
  const current = await loadAgentState(config);
  const next = normalizeTaskState({ ...current, ...patch, version: 1, updatedAt: new Date().toISOString() });
  await saveJsonAtomic(statePaths(config).agentState, next);
  if (next.taskId && next.batchId && config.outputDir) await archiveTaskState(config, next);
  return next;
}

export function terminalStatePatch(status, patch = {}) {
  const now = new Date().toISOString();
  return {
    ...patch,
    status,
    workerPid: null,
    workerRunId: null,
    workerStartedAt: null,
    workerRole: null,
    childPid: null,
    v2Status: status,
    gate: null,
    userActionDeadline: null,
    pauseWaitSeconds: 0,
    verification: patch.verification || { required: false, owner: null, url: null },
    completedAt: status === "completed" ? (patch.completedAt || now) : (patch.completedAt ?? null),
  };
}
