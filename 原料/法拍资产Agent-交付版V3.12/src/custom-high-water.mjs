import { loadJson, saveJsonAtomic } from "./utils.mjs";
import { customScopeId, normalizedScopeDescriptor, requiredScopeAnchors } from "./task-scope.mjs";
import { statePaths } from "./state.mjs";

function cleanAnchors(anchors = {}) {
  return Object.fromEntries(Object.entries(anchors)
    .map(([key, value]) => [key, String(value || "").trim()])
    .filter(([, value]) => /^https?:\/\//u.test(value)));
}

export function inspectCustomHighWater(collection = {}, anchors = {}) {
  const expectedRows = requiredScopeAnchors(collection);
  const cleaned = cleanAnchors(anchors);
  const expectedKeys = new Set(expectedRows.map((row) => row.key));
  const accepted = Object.fromEntries(Object.entries(cleaned).filter(([key]) => expectedKeys.has(key)));
  const missingKeys = expectedRows.filter((row) => !accepted[row.key]).map((row) => row.key);
  return {
    anchors: accepted,
    expectedCount: expectedRows.length,
    validCount: Object.keys(accepted).length,
    missingCount: missingKeys.length,
    missingKeys,
    complete: expectedRows.length > 0 && missingKeys.length === 0,
  };
}

export function mergeCustomHighWater(collection = {}, ...sources) {
  const merged = Object.assign({}, ...sources.map((source) => cleanAnchors(source || {})));
  return inspectCustomHighWater(collection, merged);
}

export function describeCustomScope(collection = {}) {
  return { id: customScopeId(collection), ...normalizedScopeDescriptor(collection) };
}

export async function loadCustomHighWaterProfile(config, collection = config.collection) {
  const scope = describeCustomScope(collection);
  const store = await loadJson(statePaths(config).customHighWaterProfiles, { version: 1, profiles: {} });
  return store.profiles?.[scope.id] || null;
}

export async function saveCustomHighWaterProfile(config, collection, anchors, source = "manual") {
  const scope = describeCustomScope(collection);
  const validKeys = new Set(requiredScopeAnchors(collection).map((row) => row.key));
  const accepted = Object.fromEntries(Object.entries(cleanAnchors(anchors)).filter(([key]) => validKeys.has(key)));
  const file = statePaths(config).customHighWaterProfiles;
  const store = await loadJson(file, { version: 1, profiles: {} });
  const previous = store.profiles?.[scope.id] || {};
  // Keep non-selected status anchors from the same platform/category/city scope.
  // A one-status run may advance only its own keys, never erase its sibling keys.
  const storedAnchors = { ...cleanAnchors(previous.anchors || {}), ...accepted };
  const integrity = inspectCustomHighWater(collection, storedAnchors);
  const profile = {
    version: 1,
    scope,
    anchors: storedAnchors,
    expectedCount: integrity.expectedCount,
    validCount: integrity.validCount,
    missingCount: integrity.missingCount,
    missingKeys: integrity.missingKeys,
    complete: integrity.complete,
    source,
    updatedAt: new Date().toISOString(),
  };
  await saveJsonAtomic(file, { version: 1, profiles: { ...(store.profiles || {}), [scope.id]: profile } });
  return profile;
}
