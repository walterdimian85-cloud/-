import crypto from "node:crypto";
import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { statePaths } from "./state.mjs";
import { normalizeTaskState } from "./task-state-model.mjs";

export const WORKER_OPERATIONS = new Set([
  "new_collection", "resume_collection", "start_review", "resume_review",
  "retry_collection", "retry_review",
]);

export function assertWorkerOperation(operation) {
  if (!WORKER_OPERATIONS.has(operation)) throw new Error(`Unsupported worker operation: ${operation || "missing"}`);
  return operation;
}

export function workerRoleForOperation(operation) {
  assertWorkerOperation(operation);
  return operation.includes("review") ? "review" : "collector";
}

export function retryOperationFor(state = {}) {
  const operation = String(state.workerOperation || "");
  const normalized = normalizeTaskState(state);
  if (operation.includes("review") || normalized.phase === "ai_review") return "retry_review";
  return "retry_collection";
}

export function createWorkerIdentity(state = {}, { recovery = false, role = "agent", operation = null } = {}) {
  return {
    version: 1,
    active: true,
    workerRunId: crypto.randomUUID(),
    workerPid: null,
    role,
    operation,
    batchId: state.batchId || null,
    runName: state.runName || null,
    recovery,
    startedAt: new Date().toISOString(),
  };
}

export function workerIdentityMatches(state = {}, lock = {}) {
  if (!lock?.active || !lock.workerRunId || !state.workerRunId) return false;
  if (lock.workerRunId !== state.workerRunId) return false;
  if (Number(lock.workerPid || 0) !== Number(state.workerPid || 0)) return false;
  if ((lock.batchId || null) !== (state.batchId || null)) return false;
  if ((lock.runName || null) !== (state.runName || null)) return false;
  return true;
}

export function recoveryDecision(state = {}, maxAttempts = 5) {
  const attempt = Math.max(0, Number(state.agentRecoveryCount || 0));
  const maximum = Math.max(0, Number(maxAttempts || 0));
  return { attempt, maxAttempts: maximum, exhausted: attempt >= maximum };
}

export function workerRunIdMatches(expectedRunId, state = {}) {
  return Boolean(expectedRunId && state.workerRunId && expectedRunId === state.workerRunId);
}

export async function loadWorkerLock(config) {
  return loadJson(statePaths(config).workerLock, null);
}

export async function saveWorkerLock(config, lock) {
  await saveJsonAtomic(statePaths(config).workerLock, lock);
  return lock;
}

export async function releaseWorkerLock(config, state = {}, reason = "released") {
  const previous = await loadWorkerLock(config);
  return saveWorkerLock(config, {
    ...(previous || {}),
    version: 1,
    active: false,
    workerRunId: previous?.workerRunId || state.workerRunId || null,
    workerPid: null,
    batchId: previous?.batchId || state.batchId || null,
    runName: previous?.runName || state.runName || null,
    reason,
    releasedAt: new Date().toISOString(),
  });
}
