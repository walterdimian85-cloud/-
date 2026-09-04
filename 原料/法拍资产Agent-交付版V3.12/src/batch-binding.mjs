import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { statusLabelFor, statusScopeFields, workbookName } from "./status-scope.mjs";

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function createTaskBinding(config, { dateKey, runName, collection = config.collection } = {}) {
  const taskId = crypto.randomUUID();
  const batchId = `${dateKey}-${crypto.randomUUID()}`;
  const batchDirectory = path.resolve(config.outputDir, runName);
  if (!isPathInside(config.outputDir, batchDirectory)) throw new Error("Batch directory escapes the configured output directory.");
  const status = statusScopeFields(collection);
  return {
    schemaVersion: 1,
    taskId,
    batchId,
    dateKey,
    runName,
    batchDirectory,
    workbookPath: path.join(batchDirectory, workbookName(dateKey, status.selectedStatuses)),
    progressPath: path.join(batchDirectory, "\u91c7\u96c6\u8fdb\u5ea6.json"),
    reportPath: path.join(batchDirectory, "\u6bcf\u65e5\u6458\u8981\u4e0e\u5f02\u5e38\u62a5\u544a.md"),
    createdAt: new Date().toISOString(),
    ...status,
    statusLabel: statusLabelFor(status.selectedStatuses),
  };
}

export function assertOperationIdentity(state = {}, payload = {}) {
  const taskId = String(payload.taskId || "");
  const batchId = String(payload.batchId || "");
  if (!taskId || !batchId) {
    const error = new Error("Operation requires taskId and batchId.");
    error.code = "TASK_IDENTITY_REQUIRED";
    throw error;
  }
  if (taskId !== state.taskId || batchId !== state.batchId) {
    const error = new Error("Task identity does not match the active batch.");
    error.code = "TASK_IDENTITY_MISMATCH";
    throw error;
  }
  return { taskId, batchId };
}

export function batchMetaPath(batchDirectory) {
  return path.join(batchDirectory, "batch-meta.json");
}

export async function writeBatchMeta(binding, patch = {}) {
  const file = batchMetaPath(binding.batchDirectory);
  const existing = await loadJson(file, {});
  const next = { ...existing, ...binding, ...patch, schemaVersion: 1, updatedAt: new Date().toISOString() };
  await saveJsonAtomic(file, next);
  return next;
}

export async function assertBatchBinding(config, binding = {}) {
  const required = ["taskId", "batchId", "runName", "batchDirectory"];
  for (const field of required) if (!binding[field]) throw new Error(`Missing batch binding field: ${field}`);
  const expectedDirectory = path.resolve(config.outputDir, binding.runName);
  if (!isPathInside(config.outputDir, expectedDirectory)) throw new Error("Batch directory escapes outputDir.");
  if (path.resolve(binding.batchDirectory) !== expectedDirectory) throw new Error("Batch directory does not match runName.");
  const meta = await loadJson(batchMetaPath(expectedDirectory), null);
  if (!meta) throw new Error("Missing batch-meta.json for the requested batch.");
  for (const field of ["taskId", "batchId", "runName"]) {
    if (String(meta[field] || "") !== String(binding[field] || "")) throw new Error(`Batch metadata mismatch: ${field}`);
  }
  for (const field of ["workbookPath", "progressPath", "reportPath"]) {
    const value = binding[field] || meta[field];
    if (value && !isPathInside(expectedDirectory, value)) throw new Error(`${field} escapes the batch directory.`);
    if (value && meta[field] && path.resolve(value) !== path.resolve(meta[field])) throw new Error(`Batch metadata mismatch: ${field}`);
  }
  return meta;
}

function taskHistoryDirectory(config) {
  return path.join(config.agentDataDir, "tasks");
}

export async function archiveTaskState(config, state = {}) {
  if (!state.taskId || !state.batchId || !state.runName) return null;
  const binding = {
    schemaVersion: 1,
    taskId: state.taskId,
    batchId: state.batchId,
    dateKey: state.dateKey,
    runName: state.runName,
    batchDirectory: state.paths?.batchDirectory || path.resolve(config.outputDir, state.runName),
    workbookPath: state.paths?.workbook || state.workbook || null,
    progressPath: state.paths?.progress || null,
    reportPath: state.paths?.report || state.report || null,
    createdAt: state.createdAt || state.startedAt || state.updatedAt,
  };
  if (!isPathInside(config.outputDir, binding.batchDirectory)) throw new Error("Refusing to archive a task outside outputDir.");
  const snapshot = {
    ...binding,
    status: state.status,
    phase: state.phase || null,
    statusMessage: state.statusMessage || state.message || "",
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    failedAt: state.failedAt || null,
    updatedAt: state.updatedAt || new Date().toISOString(),
    count: state.count || 0,
    progressSummary: state.progressSummary || null,
    review: state.review || null,
    selectedStatuses: state.selectedStatuses || null,
    statusScope: state.statusScope || null,
    statusLabel: state.statusLabel || null,
    expectedGroupCount: state.expectedGroupCount ?? null,
  };
  await saveJsonAtomic(path.join(taskHistoryDirectory(config), `${state.taskId}.json`), snapshot);
  await writeBatchMeta(binding, {
    status: snapshot.status,
    phase: snapshot.phase,
    statusMessage: snapshot.statusMessage,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    failedAt: snapshot.failedAt,
  });
  return snapshot;
}

export async function listTaskHistory(config) {
  let names = [];
  try { names = await fs.readdir(taskHistoryDirectory(config)); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const tasks = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const task = await loadJson(path.join(taskHistoryDirectory(config), name), null);
    if (task?.taskId && task?.batchId) tasks.push(task);
  }
  return tasks.sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")));
}

export async function loadTaskHistory(config, taskId) {
  if (!/^[0-9a-f-]{36}$/iu.test(String(taskId || ""))) return null;
  return loadJson(path.join(taskHistoryDirectory(config), `${taskId}.json`), null);
}
