export function classifyListSnapshot(snapshot = {}, stableForMs = 0, emptyThresholdMs = 10_000) {
  if (Number(snapshot.itemCount || 0) > 0) {
    return { kind: "items", itemCount: Number(snapshot.itemCount) };
  }
  const configuredPageReady = Boolean(snapshot.filterReady || snapshot.shellReady)
    && Number(snapshot.bodyTextLength || 0) >= 200
    && !snapshot.browserError;
  if (configuredPageReady && snapshot.explicitEmpty) {
    return { kind: "empty", reason: "explicit_empty" };
  }
  if (
    configuredPageReady
    && Number(snapshot.shellChildCount || 0) === 0
    && !snapshot.loading
    && stableForMs >= emptyThresholdMs
  ) {
    return { kind: "empty", reason: "stable_empty_shell" };
  }
  return { kind: "pending" };
}

export function classifyJdAccessSnapshot(snapshot = {}) {
  if (snapshot.listReady === true) return "ready";
  if (snapshot.authGate === true) return "auth_required";
  return "incomplete";
}
