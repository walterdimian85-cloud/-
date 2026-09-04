import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT } from "./config.mjs";

const CORE_DIRECTORIES = ["bin", "src", "public", "runtime", "scripts", "references", "node_modules"];
const CORE_FILES = new Set([
  "package.json", "package-lock.json", "README.md", "distribution.json",
  "用户使用手册.md", "常见问题及解决办法.md", "用户操作说明.md", "问题诊断说明.md",
]);
const ROOT_EXCLUDED_NAMES = new Set(["agent-data", "path", "config", "tmp"]);
const ANY_EXCLUDED_NAMES = new Set([".shadow", ".git", "Crashpad"]);
const EXCLUDED_FILES = new Set(["Terra网页AI故障处理中心实施指令.md", "开发者交付工作流.md"]);
const SENSITIVE_NAMES = /^(Cookies|Login Data|Web Data|Network Persistent State|agent-state\.json|worker-lock\.json)$/iu;
const execFileAsync = promisify(execFile);

async function present(target) { try { await fs.access(target); return true; } catch { return false; } }

function excluded(relative) {
  const parts = relative.split(/[\\/]/u);
  return EXCLUDED_FILES.has(path.basename(relative)) || ROOT_EXCLUDED_NAMES.has(parts[0]) ||
    parts.some((part) => ANY_EXCLUDED_NAMES.has(part)) ||
    parts.some((part) => /^(Cache|Code Cache|GPUCache|ShaderCache|DawnGraphiteCache|DawnWebGPUCache)$/iu.test(part));
}

async function copyTree(sourceRoot, targetRoot, relative) {
  if (excluded(relative)) return;
  const source = path.join(sourceRoot, relative);
  const target = path.join(targetRoot, relative);
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(source)) await copyTree(sourceRoot, targetRoot, path.join(relative, name));
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
}

function cleanDeliveryConfig() {
  return {
    version: 1,
    skillV2Dir: "../runtime/fujian-auctions-v2",
    stateDir: "../path",
    outputDir: "",
    agentDataDir: "../agent-data",
    profileDir: "../path/edge-profile",
    collection: {
      platform: "all", maxRuntimeMinutes: 240, maxRetries: 5, userActionTimeoutMinutes: 60,
      warnAtRecords: 500, stopAtRecords: 800, pauseGraceSeconds: 90, heartbeatSeconds: 15,
      pollSeconds: 5, category: "住宅用房,商业用房,工业用房", status: "即将开始,已结束",
      selectedStatuses: ["即将开始", "已结束"], dryRun: false, skipHistoricalRefresh: true,
      preScan: false, alibabaPc: { includeBankruptcy: true },
      scope: { mode: "province", province: "福建省", cities: [], platforms: ["alibaba", "jd"], anchors: {} },
    },
    ai: { enabled: true, mode: "off", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKeyEnv: "DEEPSEEK_API_KEY", requireChoiceAfterCollection: true, autoApplyHighConfidence: true, minimumConfidence: 0.9, maxReviewItems: 200 },
    opportunities: { enabled: true, minimumComparableCount: 3, lowUnitPricePercentile: 0.25, minimumRegistrations: 3, minimumBidRecords: 10 },
    summary: { localReport: true, recipients: [] },
  };
}

async function listFiles(root, relative = "") {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}

export async function inspectDeliveryTarget(targetRoot, sourceRoot = ROOT) {
  const files = await listFiles(targetRoot);
  const findings = [];
  for (const required of [
    path.join("runtime", "fujian-auctions-v2", "scripts", "run.mjs"),
    path.join("runtime", "fujian-auctions-v2", "src", "config", "load.mjs"),
  ]) {
    if (!await present(path.join(targetRoot, required))) findings.push({ type: "missing_required_file", path: required });
  }
  for (const relative of files) {
    if (SENSITIVE_NAMES.test(path.basename(relative))) findings.push({ type: "sensitive_file", path: relative });
    if (/\.(?:js|mjs|json|md|cmd|txt)$/iu.test(relative) && !relative.startsWith(`node_modules${path.sep}`)) {
      const text = await fs.readFile(path.join(targetRoot, relative), "utf8").catch(() => "");
      if (text.includes(path.resolve(sourceRoot))) findings.push({ type: "developer_absolute_path", path: relative });
      if (/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{25,})\b/u.test(text)) findings.push({ type: "possible_api_key", path: relative });
    }
  }
  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = await fs.readFile(packageJsonPath, "utf8").then(JSON.parse).catch(() => ({}));
  if (packageJson.dependencies?.exceljs) {
    const targetRequire = createRequire(packageJsonPath);
    for (const dependency of ["exceljs", "tmp"]) {
      try { targetRequire.resolve(dependency); }
      catch { findings.push({ type: "missing_runtime_dependency", path: path.join("node_modules", dependency) }); }
    }
  }
  return { safe: findings.length === 0, findings, fileCount: files.length };
}

async function validateSource(sourceRoot) {
  const options = { cwd: sourceRoot, windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 };
  if (process.platform === "win32") {
    const command = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
    await execFileAsync(command, ["/d", "/s", "/c", "npm.cmd run check"], options);
    await execFileAsync(command, ["/d", "/s", "/c", "npm.cmd test"], options);
  } else {
    await execFileAsync("npm", ["run", "check"], options);
    await execFileAsync("npm", ["test"], options);
  }
  return { syntax: "passed", tests: "passed" };
}

export async function generateDelivery({ targetDirectory, sourceRoot = ROOT, includeDependencies = true, runChecks = true } = {}) {
  const targetRoot = path.resolve(String(targetDirectory || ""));
  if (!targetDirectory || targetRoot === path.resolve(sourceRoot) || targetRoot.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
    throw new Error("交付目录必须是开发版目录之外的新目录");
  }
  if (await present(targetRoot)) throw new Error("交付目标目录已经存在，请选择一个新的目录名称");
  const validation = runChecks ? await validateSource(sourceRoot) : { syntax: "skipped", tests: "skipped" };
  await fs.mkdir(targetRoot, { recursive: false });
  try {
    for (const directory of CORE_DIRECTORIES) {
      if (!includeDependencies && directory === "node_modules") continue;
      if (await present(path.join(sourceRoot, directory))) await copyTree(sourceRoot, targetRoot, directory);
    }
    for (const name of await fs.readdir(sourceRoot)) {
      if ((CORE_FILES.has(name) || /\.cmd$/iu.test(name)) && await present(path.join(sourceRoot, name))) {
        await copyTree(sourceRoot, targetRoot, name);
      }
    }
    await fs.mkdir(path.join(targetRoot, "config"), { recursive: true });
    await fs.mkdir(path.join(targetRoot, "agent-data"), { recursive: true });
    await fs.mkdir(path.join(targetRoot, "path", "edge-profile"), { recursive: true });
    await fs.mkdir(path.join(targetRoot, "cache"), { recursive: true });
    await fs.mkdir(path.join(targetRoot, "logs"), { recursive: true });
    await fs.writeFile(path.join(targetRoot, "distribution.json"), JSON.stringify({ schemaVersion: 1, mode: "delivery", onboardingRequired: true }, null, 2));
    await fs.writeFile(path.join(targetRoot, "config", "agent.local.json"), JSON.stringify(cleanDeliveryConfig(), null, 2));
    const inspection = await inspectDeliveryTarget(targetRoot, sourceRoot);
    const files = await listFiles(targetRoot);
    const integrity = [];
    for (const relative of files.filter((item) => !item.startsWith(`node_modules${path.sep}`))) {
      const data = await fs.readFile(path.join(targetRoot, relative));
      integrity.push({ path: relative, sha256: crypto.createHash("sha256").update(data).digest("hex"), bytes: data.length });
    }
    await fs.writeFile(path.join(targetRoot, "文件完整性清单.json"), JSON.stringify({ schemaVersion: 1, files: integrity }, null, 2));
    const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceVersion: "V2.0", targetRoot, validation, inspection, deliverable: inspection.safe && validation.syntax !== "failed" && validation.tests !== "failed" };
    await fs.writeFile(path.join(targetRoot, "交付检查报告.json"), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(targetRoot, "交付检查报告.md"), `# 交付检查报告\n\n- 生成时间：${report.generatedAt}\n- 语法检查：${validation.syntax}\n- 自动测试：${validation.tests}\n- 文件数量：${inspection.fileCount}\n- 敏感项：${inspection.findings.length}\n- 结论：${report.deliverable ? "可以进入首次启动测试" : "禁止交付"}\n`);
    return report;
  } catch (error) {
    error.partialTarget = targetRoot;
    throw error;
  }
}

export const DELIVERY_POLICY = {
  coreDirectories: CORE_DIRECTORIES,
  coreFiles: [...CORE_FILES],
  excludedNames: [...ROOT_EXCLUDED_NAMES, ...ANY_EXCLUDED_NAMES],
  excludedFiles: [...EXCLUDED_FILES],
};
