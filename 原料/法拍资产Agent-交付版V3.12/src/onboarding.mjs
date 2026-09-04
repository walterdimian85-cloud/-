import fs from "node:fs/promises";
import path from "node:path";
import { exists, loadJson, saveJsonAtomic } from "./utils.mjs";
import { selectedPlatforms } from "./task-scope.mjs";

export function onboardingPath(config) { return path.join(config.agentDataDir, "onboarding.json"); }

export async function onboardingStatus(config) {
  const saved = await loadJson(onboardingPath(config), {});
  const checks = {
    runtime: Boolean(config.skillV2Dir && await exists(path.join(config.skillV2Dir, "scripts", "run.mjs"))),
    stateDirectory: Boolean(config.stateDir),
    outputDirectory: Boolean(config.outputDir),
    agentDataDirectory: Boolean(config.agentDataDir),
    profileDirectory: Boolean(config.profileDir || config.stateDir),
  };
  return {
    schemaVersion: 1,
    completed: saved.completed === true && Object.values(checks).every(Boolean),
    completedAt: saved.completedAt || null,
    platformReadiness: saved.platformReadiness || {},
    checks,
  };
}

export async function completeOnboarding(config) {
  const status = await onboardingStatus(config);
  if (!Object.values(status.checks).every(Boolean)) throw new Error("首次运行准备尚未完成，请先配置运行目录");
  const families = [...new Set(selectedPlatforms(config.collection).map((platform) => platform.startsWith("alibaba") ? "alibaba" : "jd"))];
  const missing = families.filter((family) => status.platformReadiness?.[family]?.ready !== true);
  if (missing.length) throw new Error(`以下平台尚未完成登录访问检查：${missing.join("、")}`);
  const platformReadiness = status.platformReadiness;
  const next = { schemaVersion: 1, completed: true, completedAt: new Date().toISOString(), platformReadiness };
  await fs.mkdir(config.agentDataDir, { recursive: true });
  await saveJsonAtomic(onboardingPath(config), next);
  return onboardingStatus(config);
}

export async function recordPlatformReadiness(config, platform, ready, message = "") {
  const current = await loadJson(onboardingPath(config), {});
  const platformReadiness = { ...(current.platformReadiness || {}), [platform]: { ready: ready === true, checkedAt: new Date().toISOString(), message } };
  await fs.mkdir(config.agentDataDir, { recursive: true });
  await saveJsonAtomic(onboardingPath(config), { ...current, schemaVersion: 1, platformReadiness });
  return onboardingStatus(config);
}
