import path from "node:path";
import { loadJson } from "./utils.mjs";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function deriveTaskMetrics(state = {}, { progress = {}, history = {}, reviewCheckpoint = {} } = {}) {
  const summary = state.progressSummary || {};
  const persistedRecords = progress.dataRecovery?.source === "scoped_state_current_scope"
    && Array.isArray(progress.records) ? progress.records.length : 0;
  const discovered = Math.max(number(summary.planned), persistedRecords);
  const processed = Math.max(number(summary.processed ?? state.count), persistedRecords);
  const collectionFailures = Array.isArray(progress.failures) ? progress.failures.length
    : number(progress.counts?.failed ?? state.details?.failures?.length);
  const failed = Math.min(processed, collectionFailures);
  const succeeded = Math.max(0, processed - failed);
  const remaining = number(summary.remaining ?? Math.max(0, discovered - processed));
  const review = state.review || {};
  const reviewTotal = number(review.total ?? review.candidates ?? progress.aiReview?.candidates ?? state.summary?.reviewed);
  const checkpointCompleted = Array.isArray(reviewCheckpoint.completedUrls) ? reviewCheckpoint.completedUrls.length : 0;
  const reviewProcessed = Math.min(reviewTotal || checkpointCompleted, number(review.processed ?? checkpointCompleted));
  const reviewRemaining = Math.max(0, number(review.remaining ?? (reviewTotal - reviewProcessed)));
  return {
    scope: "current_batch",
    taskId: state.taskId || null,
    batchId: state.batchId || null,
    collector: { discovered, processed, succeeded, failed, remaining },
    review: {
      total: reviewTotal,
      processed: reviewProcessed,
      remaining: reviewRemaining,
      failed: number(review.failures ?? reviewCheckpoint.operationalFailures?.length),
      pending: reviewRemaining,
    },
    history: { totalRecords: number(Object.keys(history.records || {}).length) },
  };
}

export async function loadTaskMetrics(config, state = {}) {
  const progress = state.paths?.progress ? await loadJson(state.paths.progress, {}) : {};
  const history = await loadJson(path.join(config.agentDataDir, "history", "records.json"), {});
  const reviewCheckpoint = state.paths?.reviewCheckpoint ? await loadJson(state.paths.reviewCheckpoint, {}) : {};
  return deriveTaskMetrics(state, { progress, history, reviewCheckpoint });
}
