export function verificationCheckpoint(state = {}, input = {}) {
  const previous = state.verification || {};
  const owner = input.owner || previous.owner || null;
  const url = input.url || previous.url || state.current?.url || state.review?.url || null;
  return {
    required: true,
    status: input.status || "waiting",
    owner,
    taskId: state.taskId || input.taskId || previous.taskId || null,
    batchId: state.batchId || input.batchId || previous.batchId || null,
    url,
    recordUrl: input.recordUrl || previous.recordUrl || url,
    current: input.current || previous.current || state.current || null,
    requestedAt: input.requestedAt || previous.requestedAt || new Date().toISOString(),
    deadlineAt: input.resetDeadline
      ? (input.deadlineAt || null)
      : (previous.deadlineAt || input.deadlineAt || state.userActionDeadline || null),
    windowClosedAt: input.windowClosedAt || previous.windowClosedAt || null,
    reopenCount: Number(previous.reopenCount || 0) + (input.reopened ? 1 : 0),
    lastError: input.lastError || previous.lastError || null,
  };
}

export function clearVerification(state = {}, status = "completed") {
  if (!state.verification?.required) return state.verification || { required: false, owner: null, url: null };
  return {
    ...state.verification,
    required: false,
    status,
    completedAt: status === "completed" ? new Date().toISOString() : null,
  };
}

export function verificationBelongsTo(state = {}, owner) {
  const checkpoint = state.verification;
  return Boolean(checkpoint?.required && checkpoint.owner === owner
    && (!checkpoint.taskId || checkpoint.taskId === state.taskId)
    && (!checkpoint.batchId || checkpoint.batchId === state.batchId));
}
