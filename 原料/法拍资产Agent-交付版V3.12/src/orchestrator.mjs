import path from "node:path";
import { appendJsonLine, loadJson, saveJsonAtomic, shanghaiDateKey } from "./utils.mjs";
import { validateAgentConfig } from "./config.mjs";
import { collectionPaths, runCollection } from "./collector.mjs";
import { loadAgentState, saveAgentState, statePaths, terminalStatePatch } from "./state.mjs";
import { reviewCompletedRun } from "./review/index.mjs";
import { updateHistory } from "./history.mjs";
import { writeDailyReports } from "./reports.mjs";
import { identifyOpportunitySignals } from "./opportunities.mjs";
import { collectionGroupRows, materializeScopeConfig, restoreCustomScopeAnchorBaseline } from "./task-scope.mjs";
import { exportWorkbenchReview } from "./workbench-review.mjs";
import { saveCustomHighWaterProfile } from "./custom-high-water.mjs";
import { releaseWorkerLock } from "./worker-lock.mjs";
import { assertBatchBinding, isPathInside } from "./batch-binding.mjs";
import { assertWorkerOperation } from "./worker-lock.mjs";
import { clearVerification, verificationCheckpoint } from "./verification-state.mjs";
import { auditGroupCompletion } from "./progress-summary.mjs";
import { expectedGroupCount, statusLabelFor, statusScopeFields } from "./status-scope.mjs";

async function event(config, type, data = {}) {
  await appendJsonLine(statePaths(config).events, { at: new Date().toISOString(), type, ...data });
}

export function shouldAwaitReviewChoice(config, hasReviewChoice) {
  return config.ai?.requireChoiceAfterCollection !== false && !hasReviewChoice;
}

export function finalCollectionProgressPatch(collection = {}) {
  const summary = collection.summary;
  if (!summary || typeof summary !== "object") return {};
  const processed = Math.max(0, Number(summary.processed || 0));
  const planned = Math.max(processed, Number(summary.planned || 0));
  return {
    progressSummary: summary,
    count: processed,
    totalCount: planned,
  };
}

function collectionMessage(snapshot) {
  if (snapshot.userActionRequired) {
    return snapshot.taskState.lastMessage || "检测到登录或安全认证，已打开Edge等待人工处理";
  }
  if (snapshot.progress?.current?.stage === "category_classification") {
    return snapshot.progress.current.title || "正在核验标的类型";
  }
  if (snapshot.taskState?.status === "waiting_to_retry" && /(?:EBUSY|resource busy|locked).*\.xlsx/iu.test(String(snapshot.taskState.lastMessage || ""))) {
    return "详情采集已完成，但最终Excel被占用；正在等待关闭工作簿";
  }
  if (snapshot.summary?.scanComplete && snapshot.summary?.remaining === 0) return "全部详情已采集，正在生成并检查最终工作簿";
  if (snapshot.summary?.scanComplete) return `正在采集详情：已完成${snapshot.summary.processed}条，剩余${snapshot.summary.remaining}条`;
  if (snapshot.progress?.current?.statusFilter === "既有链接刷新") return "正在刷新历史未结束记录（该模式不会计入今日新增）";
  if ((snapshot.summary?.scannedGroups || 0) > 0) {
    return `正在扫描增量列表：已核对${snapshot.summary.scannedGroups}/${snapshot.summary.groupTotal}组，当前发现${snapshot.summary.planned}条`;
  }
  return "正在打开首个增量列表并核对高水位";
}

export async function finalizeWithoutReview(config, collectionConfig, dateKey, paths) {
  const progress = await loadJson(paths.progress, { records: [] });
  const history = await updateHistory(config, progress.records || [], dateKey, []);
  const opportunities = identifyOpportunitySignals(progress.records || [], config.opportunities);
  const reports = await writeDailyReports({ runDir: paths.runDir, dateKey, records: progress.records || [], candidates: [], changes: [], anomalies: [], operationalFailures: [], history, opportunities });
  await saveAgentState(config, terminalStatePatch("completed", {
    dateKey,
    message: "采集完成；本次已按用户选择跳过AI复核，可直接使用工作簿或开始新任务",
    workbook: paths.workbook,
    report: reports.markdownPath,
    summary: reports.summary,
    reviewMode: "off",
    review: { method: "off", status: "skipped", completedAt: new Date().toISOString() },
  }));
  const completedState = await loadAgentState(config);
  await releaseWorkerLock(config, completedState, "completed_without_review");
  await event(config, "review_skipped", { taskId: completedState.taskId, batchId: completedState.batchId });
  return { status: "completed", skippedReview: true, ...reports.summary };
}

async function runReviewPhase(config, collectionConfig, dateKey, paths, reviewMode, reviewOptions = {}) {
  const boundState = await loadAgentState(config);
  if (boundState.taskId && boundState.batchId) {
    await assertBatchBinding(config, {
      taskId: boundState.taskId,
      batchId: boundState.batchId,
      runName: boundState.runName,
      batchDirectory: paths.runDir,
      workbookPath: paths.workbook,
      progressPath: paths.progress,
      reportPath: boundState.paths?.report,
    });
    reviewOptions = { ...reviewOptions, taskId: boundState.taskId, batchId: boundState.batchId };
  }
  if (config.ai.enabled && reviewMode === "workbench") {
    const workbench = await exportWorkbenchReview(collectionConfig, dateKey, null, {
      taskId: boundState.taskId || null,
      batchId: boundState.batchId || null,
    });
    await saveAgentState(config, {
      status: "review_pending_workbench", dateKey, childPid: null, workerPid: null,
      failureReason: null, details: null,
      message: `采集已完成，已导出${workbench.candidates}条工作台复核任务；请复制Codex或WorkBuddy复核口令`,
      review: workbench,
      workbook: paths.workbook,
    });
    await event(config, "review_pending_workbench", workbench);
    return { status: "review_pending_workbench", ...workbench };
  }
  if (!config.ai.enabled || reviewMode === "off") {
    return finalizeWithoutReview(config, collectionConfig, dateKey, paths);
  }
  await saveAgentState(config, { status: "reviewing", dateKey, message: "采集已完成，AI正在集中复核疑难字段", childPid: null });
  let review;
  let reviewProgress = {};
  try {
    review = await reviewCompletedRun(config, paths, async (info) => {
      if (info.type === "review_progress") reviewProgress = info;
      const progressText = info.type === "review_progress" && info.total ? `AI正在复核：已完成${info.processed ?? Math.max(0, (info.index || 1) - 1)}/${info.total}条` : "AI正在复核";
      await saveAgentState(config, { status: info.type === "verification" ? "waiting_user_action" : "reviewing", review: info, message: info.message || progressText });
      const verificationState = await loadAgentState(config);
      await saveAgentState(config, {
        review: info.type === "verification" ? { ...reviewProgress, ...info } : info,
        verification: info.type === "verification"
          ? verificationCheckpoint(verificationState, { owner: "review", url: info.url, recordUrl: info.url })
          : clearVerification(verificationState),
        paths: { ...verificationState.paths, reviewCheckpoint: path.join(paths.runDir, "AI复核进度.json") },
      });
    }, reviewOptions);
  } catch (error) {
    const verificationInterrupted = ["USER_ACTION_TIMEOUT", "VERIFICATION_WINDOW_CLOSED"].includes(error?.code);
    const status = verificationInterrupted ? "paused" : "review_pending";
    await saveAgentState(config, { status, dateKey, message: String(error), childPid: null, workerPid: null });
    if (verificationInterrupted) {
      const interruptedState = await loadAgentState(config);
      await saveAgentState(config, {
        verification: verificationCheckpoint(interruptedState, {
          owner: "review",
          status: error.code === "VERIFICATION_WINDOW_CLOSED" ? "window_closed" : "timed_out",
          windowClosedAt: error.code === "VERIFICATION_WINDOW_CLOSED" ? new Date().toISOString() : null,
          lastError: String(error),
        }),
      });
    }
    await event(config, "review_pending", { error: String(error), code: error?.code || null });
    return { status, error: String(error) };
  }
  const history = await updateHistory(config, review.records, dateKey, review.changes);
  const opportunities = identifyOpportunitySignals(review.records, config.opportunities);
  const reports = await writeDailyReports({ runDir: paths.runDir, dateKey, ...review, history, opportunities });
  await saveAgentState(config, terminalStatePatch("completed", {
    dateKey, details: null,
    message: config.collection.dryRun
      ? "影子验收完成；生产高水位未推进"
      : "采集、AI复核、历史归档和日报均已完成",
    workbook: paths.workbook,
    report: reports.markdownPath,
    summary: reports.summary,
  }));
  await releaseWorkerLock(config, await loadAgentState(config), "completed_after_review");
  await event(config, "agent_completed", reports.summary);
  return { status: "completed", ...reports.summary };
}

export async function runAgent(config, { operation } = {}) {
  assertWorkerOperation(operation);
  const reviewOperation = ["start_review", "resume_review", "retry_review"].includes(operation);
  const collectionOperation = ["new_collection", "resume_collection", "retry_collection"].includes(operation);
  await validateAgentConfig(config);
  let collectionConfig = await materializeScopeConfig(config);
  const currentDateKey = shanghaiDateKey();
  let dateKey = currentDateKey;
  const approval = await loadJson(statePaths(config).volumeApproval, {});
  let volumeApproved = false;
  const previousAgentState = await loadAgentState(config);
  const pendingReviewChoice = await loadJson(statePaths(config).reviewChoice, {});
  const newTaskRequest = await loadJson(statePaths(config).newTaskRequest, {});
  // Resume is bound to its original scope, never to controls edited after it paused.
  const frozenCollection = newTaskRequest.active === true ? newTaskRequest.collection : previousAgentState.collection;
  if (frozenCollection) collectionConfig = { ...collectionConfig, collection: { ...collectionConfig.collection, ...frozenCollection, scope: frozenCollection.scope || collectionConfig.collection.scope } };
  if (operation === "new_collection" && newTaskRequest.active !== true) {
    throw new Error("new_collection requires an active new-task request.");
  }
  if (reviewOperation && !previousAgentState.taskId) {
    throw new Error("Review operation requires a bound taskId and batchId.");
  }
  if (previousAgentState.taskId && newTaskRequest.active !== true) {
    dateKey = previousAgentState.dateKey || currentDateKey;
  }
  const storedRunName = (newTaskRequest.active === true ? newTaskRequest.runName : "")
    || pendingReviewChoice.runName
    || (previousAgentState.dateKey === dateKey ? previousAgentState.runName : "")
    || dateKey;
  // A review/resume request may survive across midnight. Never let yesterday's
  // batch folder become today's output folder even when the saved request is stale.
  const requestedRunName = String(storedRunName || "").startsWith(dateKey)
    ? storedRunName
    : dateKey;
  const boundBatchDirectory = newTaskRequest.batchDirectory || previousAgentState.paths?.batchDirectory || null;
  const boundRunName = boundBatchDirectory && isPathInside(config.outputDir, boundBatchDirectory)
    ? path.basename(path.resolve(boundBatchDirectory))
    : requestedRunName;
  collectionConfig = {
    ...collectionConfig,
    collection: { ...collectionConfig.collection, runName: boundRunName, dateKey },
  };
  const scopeFields = statusScopeFields(collectionConfig.collection);
  collectionConfig.collection.selectedStatuses = scopeFields.selectedStatuses;
  collectionConfig.collection.status = scopeFields.selectedStatuses.join(",");
  collectionConfig.collection.workbookPath = newTaskRequest.workbookPath || previousAgentState.paths?.workbook || null;
  // startWorker 会先把界面状态写成 starting，因此不能再依赖旧状态仍然是
  // awaiting_review_choice。复核路由写入的、日期匹配且仅消费一次的凭证，
  // 才是进入“只复核、不采集”路径的权威信号。
  if (reviewOperation && pendingReviewChoice.active === true
    && pendingReviewChoice.dateKey === dateKey
    && (!previousAgentState.taskId || (pendingReviewChoice.taskId === previousAgentState.taskId
      && pendingReviewChoice.batchId === previousAgentState.batchId))) {
    await saveJsonAtomic(statePaths(config).reviewChoice, {
      ...pendingReviewChoice, active: false, consumedAt: new Date().toISOString(),
    });
    await event(config, "review_choice_consumed", { mode: pendingReviewChoice.mode, reviewOnly: true });
    await saveAgentState(config, {
      reviewMode: pendingReviewChoice.mode,
      workerOperation: operation,
      message: "Review operation is bound to the current batch.",
    });
    return runReviewPhase(
      config,
      collectionConfig,
      dateKey,
      collectionPaths(collectionConfig, dateKey),
      pendingReviewChoice.mode,
      { resumeVerificationUrl: pendingReviewChoice.resumeVerificationUrl || null },
    );
  }
  if (["retry_review", "resume_review"].includes(operation) && previousAgentState.reviewMode) {
    await event(config, "review_retry_started", { mode: previousAgentState.reviewMode, taskId: previousAgentState.taskId, batchId: previousAgentState.batchId });
    return runReviewPhase(
      config,
      collectionConfig,
      dateKey,
      collectionPaths(collectionConfig, dateKey),
      previousAgentState.reviewMode,
      { resumeVerificationUrl: previousAgentState.review?.type === "verification" ? previousAgentState.review.url || null : null },
    );
  }
  if (reviewOperation) throw new Error(`${operation} has no matching review request or checkpoint.`);
  if (!collectionOperation) throw new Error(`Unsupported collection operation: ${operation}`);
  const restart = newTaskRequest?.active === true && newTaskRequest?.dateKey === dateKey;
  const taskId = restart ? newTaskRequest.taskId : previousAgentState.taskId;
  const batchId = restart ? newTaskRequest.batchId : (previousAgentState.batchId || `${dateKey}-default`);
  volumeApproved = approval[batchId] === true || (!taskId && approval[dateKey] === true);
  const batchBaseline = restart ? 0 : Number(previousAgentState.batchBaseline || 0);
  if (restart) {
    // Mark custom anchors as consumed. Resume/review may still read them, but
    // the next fresh task must be explicitly saved by the user again.
    if (config.collection.scope?.mode === "custom") {
      const { saveAgentConfig } = await import("./config.mjs");
      await saveAgentConfig({
        ...config,
        collection: {
          ...config.collection,
          scope: { ...config.collection.scope, anchorsConsumed: true },
        },
      }, config.configPath);
    }
    await import("./utils.mjs").then(({ saveJsonAtomic }) =>
      saveJsonAtomic(statePaths(config).newTaskRequest, {
        ...newTaskRequest, active: false, consumedAt: new Date().toISOString(),
      }));
  }
  await saveAgentState(config, {
    status: "collecting", dateKey, startedAt: new Date().toISOString(), message: "V2采集引擎运行中",
    runName: boundRunName, taskId, batchId, newTaskPending: false,
    paths: taskId ? {
      batchDirectory: boundBatchDirectory || collectionPaths(collectionConfig, dateKey).runDir,
      workbook: newTaskRequest.workbookPath || previousAgentState.paths?.workbook || collectionPaths(collectionConfig, dateKey).workbook,
      progress: newTaskRequest.progressPath || previousAgentState.paths?.progress || collectionPaths(collectionConfig, dateKey).progress,
      report: previousAgentState.paths?.report || null,
    } : previousAgentState.paths,
    ...scopeFields,
    statusLabel: statusLabelFor(scopeFields.selectedStatuses),
    expectedGroupCount: previousAgentState.expectedGroupCount || newTaskRequest.expectedGroupCount || null,
    collection: collectionConfig.collection,
    gate: null, details: null, review: null, completedAt: null,
  });
  await event(config, "collection_started", { dateKey });
  const existingProgress = await loadJson(collectionPaths(collectionConfig).progress, {});
  const selectedCategories = String(collectionConfig.collection.category || "住宅用房,商业用房,工业用房").split(",").filter(Boolean);
  const totalExpectedGroups = collectionGroupRows(collectionConfig.collection).length;
  // 独立预扫描会把12组列表完整扫描两遍，在平台低频等待下可能额外耗时一小时以上。
  // 默认由正式采集过程边扫描边更新计划量；仅诊断时显式开启preScan。
  if (collectionConfig.collection.preScan === true
    && (restart || Object.keys(existingProgress.groups || {}).length < totalExpectedGroups)) {
    await saveAgentState(config, { status: "collecting", dateKey, message: "正在预扫描列表、核对高水位并估算任务量" });
    const planning = await runCollection(collectionConfig, {
      volumeApproved: true, batchBaseline, restart, scanOnly: true, taskId, batchId,
      onSnapshot: async (snapshot) => saveAgentState(config, {
        status: "collecting", dateKey, childPid: snapshot.childPid,
        count: snapshot.count, totalCount: snapshot.totalCount,
        taskId, batchId, batchBaseline, progressSummary: snapshot.summary,
        current: snapshot.progress?.current || {},
        pauseWaitSeconds: snapshot.pauseWaitSeconds || 0,
        pauseGraceSeconds: snapshot.pauseGraceSeconds || collectionConfig.collection.pauseGraceSeconds || 90,
        elapsedMinutes: Number(snapshot.elapsedMinutes.toFixed(1)),
        message: collectionMessage(snapshot),
      }),
    });
    if (planning.gate) return { status: "paused", gate: planning.gate };
  }
  const collection = await runCollection(collectionConfig, {
    volumeApproved, batchBaseline, restart: false, taskId, batchId,
    onSnapshot: async (snapshot) => {
      const snapshotState = await loadAgentState(config);
      return saveAgentState(config, {
      status: snapshot.userActionRequired ? "waiting_user_action" : "collecting",
      dateKey,
      childPid: snapshot.childPid,
      count: snapshot.count,
      totalCount: snapshot.totalCount,
      taskId,
      batchId,
      batchBaseline,
      progressSummary: snapshot.summary,
      current: snapshot.progress?.current || {},
      pauseWaitSeconds: snapshot.pauseWaitSeconds || 0,
      pauseGraceSeconds: snapshot.pauseGraceSeconds || collectionConfig.collection.pauseGraceSeconds || 90,
      v2Status: snapshot.taskState?.status || "starting",
      elapsedMinutes: Number(snapshot.elapsedMinutes.toFixed(1)),
      userActionDeadline: snapshot.userActionRequired
        ? (snapshotState.userActionDeadline
          || new Date(Date.now() + config.collection.userActionTimeoutMinutes * 60_000).toISOString()) : null,
      verification: snapshot.userActionRequired
        ? verificationCheckpoint(snapshotState, {
          owner: "collector",
          taskId,
          batchId,
          url: snapshot.taskState?.url || snapshot.taskState?.verificationUrl
            || snapshot.taskState?.currentUrl || snapshot.progress?.current?.url || snapshot.progress?.currentUrl || null,
          recordUrl: snapshot.progress?.current?.url || null,
          current: snapshot.progress?.current || null,
          deadlineAt: new Date(Date.now() + config.collection.userActionTimeoutMinutes * 60_000).toISOString(),
        })
        : clearVerification(snapshotState),
      message: collectionMessage(snapshot),
    }); },
  });
  // The final record can be persisted after the last polling snapshot but
  // before the V2 child exits. Make the child's final checkpoint authoritative
  // before any gate, terminal status, workbook, or review transition.
  await saveAgentState(config, finalCollectionProgressPatch(collection));
  if (collection.gate) {
    const status = collection.gate.type === "confirm_high_water"
      ? "awaiting_high_water_confirmation"
      : collection.gate.type === "output_locked" ? "waiting_output_unlock" : "paused";
    await saveAgentState(config, { status, dateKey, gate: collection.gate, message: collection.gate.message, childPid: null, workerPid: null });
    await releaseWorkerLock(config, await loadAgentState(config), `collection_gate_${collection.gate.type}`);
    await event(config, "collection_gated", collection.gate);
    return { status, gate: collection.gate };
  }
  if (collection.userActionRequired) {
    await saveAgentState(config, { status: "waiting_user_action", dateKey, message: "请完成人工验证，完成后点击继续", childPid: null });
    await releaseWorkerLock(config, await loadAgentState(config), "waiting_user_action");
    return { status: "waiting_user_action" };
  }
  const cleanResult = collection.exit?.code === 0 && (collection.result?.failures || []).length === 0;
  const groupAudit = auditGroupCompletion(collection.summary || {});
  const completed = cleanResult && groupAudit.complete && (config.collection.dryRun
    ? collection.result?.dryRun === true && collection.result?.stateAdvanced === false
    : collection.result?.stateAdvanced === true);
  if (!completed) {
    if (cleanResult && !groupAudit.complete) {
      const rollback = await restoreCustomScopeAnchorBaseline(
        config, collectionConfig, "collector_claimed_complete_with_incomplete_groups",
      );
      await saveAgentState(config, {
        status: "collecting", dateKey, childPid: null,
        v2Status: "incomplete_groups",
        failureReason: "incomplete_group_set",
        details: {
          expectedGroups: groupAudit.expected,
          scannedGroups: groupAudit.scanned,
          matchedGroups: groupAudit.matched,
          missingHighWaterGroups: groupAudit.missingKeys,
          rollback,
        },
        message: `V2虽然报告采集结束，但实际只保存了 ${groupAudit.scanned}/${groupAudit.expected} 个高水位分组。现有断点和记录已经保留，将安全重试缺失分组。`,
      });
      const error = new Error(`高水位分组不完整：当前 ${groupAudit.scanned}/${groupAudit.expected} 组，需要保留断点并继续补采。`);
      error.code = "INCOMPLETE_GROUP_SET";
      throw error;
    }
    const missingLabels = (collection.summary?.groups || [])
      .filter((group) => group.anchorFound === false)
      .map((group) => `${group.platformLabel || group.platform}：${group.city}：${group.category}：${group.status}`);
    const missingDescription = missingLabels.length
      ? `未完成分组：${missingLabels.join("；")}。`
      : "";
    await saveAgentState(config, {
      status: "collection_failed",
      dateKey,
      childPid: null,
      workerPid: null,
      v2Status: "incomplete_groups",
      failureReason: "high_water_not_reached",
      message: `本次已扫描 ${groupAudit.scanned}/${groupAudit.expected} 个分组，其中 ${groupAudit.matched}/${groupAudit.expected} 个命中高水位。${missingDescription}断点和已采集记录均已保留，请继续上次采集以重新验证未完成分组。`,
      details: {
        ...(collection.result || collection.taskState || {}),
        groupAudit,
        missingHighWaterGroups: groupAudit.missingKeys,
      },
    });
    await releaseWorkerLock(config, await loadAgentState(config), "collection_failed_preserved_checkpoint");
    return { status: "collection_failed" };
  }
  // Custom-scope results are a reusable user reference, not production state.
  // Keep the latest completed custom batch in Agent data so switching back to
  // province mode never hides it and never changes the 12 production anchors.
  if (config.collection.scope?.mode === "custom") {
    const progress = await loadJson(collection.paths.progress, {});
    const profile = await saveCustomHighWaterProfile(config, config.collection, progress.newAnchors || {}, "completed");
    await saveJsonAtomic(statePaths(config).lastCustomHighWater, {
      version: 1,
      dateKey,
      runName: requestedRunName,
      batchId,
      taskId,
      completedAt: new Date().toISOString(),
      province: config.collection.scope.province,
      cities: config.collection.scope.cities || [],
      platforms: config.collection.scope.platforms || [],
      categories: selectedCategories,
      includeBankruptcy: config.collection.alibabaPc?.includeBankruptcy !== false,
      scopeId: profile.scope.id,
      anchors: profile.anchors,
      expectedCount: profile.expectedCount,
      validCount: profile.validCount,
      missingCount: profile.missingCount,
      missingKeys: profile.missingKeys,
      complete: profile.complete,
    });
  }
  const reviewChoice = await loadJson(statePaths(config).reviewChoice, {});
  const hasReviewChoice = reviewChoice.active === true && reviewChoice.dateKey === dateKey
    && (!taskId || (reviewChoice.taskId === taskId && reviewChoice.batchId === batchId));
  if (shouldAwaitReviewChoice(config, hasReviewChoice)) {
    await saveAgentState(config, {
      status: "awaiting_review_choice", dateKey, childPid: null, workerPid: null,
      workerRunId: null, workerStartedAt: null, workerRole: null, workerOperation: null,
      v2Status: "completed",
      verification: { required: false, owner: null, url: null, status: "completed" },
      failureReason: null, details: null,
      message: "采集与Excel生成已经完成，请在“AI复核方式”中选择API、工作台或暂不复核。",
      workbook: collection.paths.workbook,
    });
    await event(config, "awaiting_review_choice", { workbook: collection.paths.workbook });
    return { status: "awaiting_review_choice", workbook: collection.paths.workbook };
  }
  const reviewMode = hasReviewChoice ? reviewChoice.mode : config.ai.mode;
  if (hasReviewChoice) await saveJsonAtomic(statePaths(config).reviewChoice, { ...reviewChoice, active: false, consumedAt: new Date().toISOString() });
  return runReviewPhase(config, collectionConfig, dateKey, collection.paths, reviewMode);
}

export async function ensureNotRunning(config) {
  const state = await loadAgentState(config);
  if (state.status === "running" && state.childPid) {
    try { process.kill(state.childPid, 0); throw new Error("已有Agent任务正在运行"); } catch (error) {
      if (error.message === "已有Agent任务正在运行") throw error;
    }
  }
}
