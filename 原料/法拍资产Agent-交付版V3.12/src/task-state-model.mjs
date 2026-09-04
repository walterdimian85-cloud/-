export const TASK_STATUSES = new Set([
  "unconfigured", "idle", "running", "waiting_user_action", "pause_requested",
  "paused", "completed", "partial_completed", "failed", "terminated",
]);

export const TASK_PHASES = new Set([
  "configuration", "idle", "task_preparation", "list_scan", "detail_collection",
  "category_classification", "collector_verification", "workbook_generation", "review_choice", "ai_review",
  "review_verification", "workbench_review", "finalization", "complete",
]);

const LEGACY_STATUS_MAP = {
  starting: ["running", "task_preparation"],
  collecting: ["running", "list_scan"],
  reviewing: ["running", "ai_review"],
  awaiting_review_choice: ["waiting_user_action", "review_choice"],
  awaiting_high_water_confirmation: ["waiting_user_action", "list_scan"],
  waiting_output_unlock: ["waiting_user_action", "workbook_generation"],
  review_pending_workbench: ["waiting_user_action", "workbench_review"],
  review_pending: ["paused", "ai_review"],
  collection_failed: ["failed", "detail_collection"],
};

function inferRunningPhase(state, rawStatus) {
  if (rawStatus === "reviewing" || state.workerRole === "review" || String(state.workerOperation || "").includes("review")) return "ai_review";
  if (rawStatus === "starting") return "task_preparation";
  if (state.current?.stage === "category_classification") return "category_classification";
  if (state.progressSummary?.scanComplete) {
    if (Number(state.progressSummary?.remaining || 0) === 0 && state.v2Status === "completed") return "workbook_generation";
    return "detail_collection";
  }
  return "list_scan";
}

function inferWaitingPhase(state, fallback = "idle") {
  if (state.verification?.required && state.verification.owner === "review") return "review_verification";
  if (state.verification?.required && state.verification.owner === "collector") return "collector_verification";
  if (state.review?.type === "verification") return "review_verification";
  if (state.workerRole === "review" && state.review?.type === "verification") return "review_verification";
  if (state.v2Status === "needs_user_action" && state.verification?.required !== false) return "collector_verification";
  return fallback;
}

export function deriveAllowedActions(state = {}) {
  const reviewFlow = state.workerRole === "review" || String(state.workerOperation || "").includes("review")
    || ["ai_review", "review_verification", "workbench_review"].includes(state.phase);
  const collectorFlow = !reviewFlow;
  const runningCollector = state.status === "running" && collectorFlow
    && ["task_preparation", "list_scan", "detail_collection"].includes(state.phase);
  const resumeCollection = collectorFlow && (["paused", "failed"].includes(state.status)
    || (state.status === "waiting_user_action" && ["workbook_generation", "list_scan"].includes(state.phase))
    || (state.status === "idle" && state.newTaskPending === true));
  return {
    createTask: !state.newTaskPending && !resumeCollection
      && ["idle", "paused", "completed", "partial_completed", "failed", "terminated"].includes(state.status),
    pauseCollection: runningCollector || state.status === "pause_requested",
    resumeCollection,
    abandonCollection: collectorFlow && ["paused", "failed", "waiting_user_action"].includes(state.status),
    chooseReview: state.status === "waiting_user_action"
      && ["review_choice", "workbench_review"].includes(state.phase),
    resumeReview: reviewFlow && ["paused", "failed"].includes(state.status) && state.phase === "ai_review" && Boolean(state.reviewMode),
    reopenCollectorVerification: state.status === "waiting_user_action" && state.phase === "collector_verification"
      && (state.verification?.required === true || (!state.verification && state.v2Status === "needs_user_action"))
      && (!state.verification?.owner || state.verification.owner === "collector"),
    reopenReviewVerification: ["waiting_user_action", "paused"].includes(state.status) && state.phase === "review_verification"
      && (state.verification?.required === true || (!state.verification && state.review?.type === "verification"))
      && (!state.verification?.owner || state.verification.owner === "review"),
    openBatchFolder: Boolean(state.taskId && state.batchId && state.paths?.batchDirectory),
  };
}

export function collectionCompletionFacts(state = {}) {
  const summary = state.progressSummary || {};
  const total = Number(summary.groupTotal || 0);
  return total > 0
    && Number(summary.scannedGroups || 0) === total
    && Number(summary.matchedGroups || 0) === total
    && Number(summary.missingHighWaterCount || 0) === 0
    && Number(summary.unscannedGroupCount || 0) === 0
    && Number(summary.remaining || 0) === 0
    && summary.scanComplete === true
    && state.v2Status === "completed";
}

function completedPhaseMessage(phase) {
  if (phase === "review_choice") return "采集和工作簿已经完成，请选择API复核、工作台复核或暂不复核。";
  if (phase === "workbench_review") return "采集和工作簿已经完成，当前已进入工作台复核阶段。";
  if (phase === "ai_review") return "采集和工作簿已经完成，正在进行AI复核。";
  if (phase === "review_verification") return "采集已经完成，AI复核正在等待人工验证。";
  if (phase === "complete") return "采集和复核流程已经完成。";
  return "24个高水位分组均已完成，正在生成工作簿并准备复核。";
}

export function normalizeTaskState(input = {}) {
  const rawStatus = String(input.status || "idle");
  const legacyMapped = LEGACY_STATUS_MAP[String(input.legacyStatus || "")];
  const mapped = LEGACY_STATUS_MAP[rawStatus]
    || (legacyMapped?.[0] === rawStatus ? legacyMapped : null);
  let status = mapped?.[0] || (TASK_STATUSES.has(rawStatus) ? rawStatus : "failed");
  let phase = mapped?.[1] || (input.phase && TASK_PHASES.has(input.phase) ? input.phase : "idle");

  if (status === "running") phase = inferRunningPhase(input, rawStatus);
  if (status === "waiting_user_action") phase = inferWaitingPhase(input, phase);
  if (status === "paused" && input.review?.type === "verification") phase = "review_verification";
  if (status === "completed") phase = "complete";
  const claimedCompleteWithMissingGroups = input.legacyStatus === "awaiting_review_choice"
    && Number(input.progressSummary?.groupTotal || 0) > 0
    && Number(input.progressSummary?.scannedGroups || 0) < Number(input.progressSummary?.groupTotal || 0);
  if (claimedCompleteWithMissingGroups) {
    status = "failed";
    phase = "list_scan";
  }
  if (["partial_completed", "failed", "terminated"].includes(status) && !TASK_PHASES.has(phase)) phase = "finalization";
  if (input.configured === false) { status = "unconfigured"; phase = "configuration"; }

  const collectionComplete = collectionCompletionFacts(input);
  const incompleteGroupSet = !collectionComplete
    && (claimedCompleteWithMissingGroups || input.failureReason === "incomplete_group_set");
  let statusMessage = incompleteGroupSet
    ? `本次采集尚未完成：已保存 ${Number(input.progressSummary?.scannedGroups || 0)}/${Number(input.progressSummary?.groupTotal || 0)} 个高水位分组。请恢复当前采集任务，继续补齐缺失分组。`
    : String(input.message || input.statusMessage || "");
  if (collectionComplete && /采集尚未完成|继续补齐缺失分组/u.test(statusMessage)) {
    statusMessage = completedPhaseMessage(phase);
  }
  const state = {
    ...input,
    schemaVersion: 1,
    status,
    phase,
    statusMessage,
    message: statusMessage,
    legacyStatus: mapped ? rawStatus : (input.legacyStatus || null),
    failureReason: incompleteGroupSet ? "incomplete_group_set" : (collectionComplete ? null : (input.failureReason || null)),
  };
  state.allowedActions = deriveAllowedActions(state);
  return state;
}
