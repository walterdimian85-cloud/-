import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : path.resolve(root, fallback);
};
const stateDir = valueOf("--state-dir", "../../path");
const outputDir = valueOf("--output-dir", "../../房源整理结果");
const edgeCandidates = [
  path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].filter(Boolean);

async function checkWritable(directory) {
  await fs.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.workbuddy-probe-${process.pid}-${Date.now()}`);
  const token = `ok-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(probe, token, "utf8");
    const roundTrip = await fs.readFile(probe, "utf8");
    if (roundTrip !== token) {
      return { writable: false, error: "probe read-back mismatch", cleanupWarning: null };
    }
  } catch (error) {
    return { writable: false, error: String(error), cleanupWarning: null };
  }
  let cleanupWarning = null;
  try {
    await fs.rm(probe, { force: true });
  } catch (error) {
    // WorkBuddy may replace deletion with a safe-delete/recycle-bin hook and
    // deliberately throw after a successful write. Cleanup is best-effort and
    // must not turn a verified write/read round trip into a false negative.
    cleanupWarning = String(error);
  }
  return { writable: true, error: null, cleanupWarning };
}

const help = spawnSync(process.execPath, [path.join(root, "bin", "auction-cli.mjs"), "help"], {
  cwd: root,
  encoding: "utf8",
  timeout: 30_000,
});
const edgePath = (await Promise.all(edgeCandidates.map(async (candidate) =>
  fs.access(candidate).then(() => candidate).catch(() => null)
))).find(Boolean) || null;

const stateCheck = await checkWritable(stateDir);
const outputCheck = await checkWritable(outputDir);
const result = {
  ok: false,
  host: "workbuddy",
  platform: process.platform,
  node: process.version,
  nodeMajorSupported: Number(process.versions.node.split(".")[0]) >= 20,
  root,
  stateDir,
  outputDir,
  stateWritable: stateCheck.writable,
  outputWritable: outputCheck.writable,
  stateWriteError: stateCheck.error,
  outputWriteError: outputCheck.error,
  stateCleanupWarning: stateCheck.cleanupWarning,
  outputCleanupWarning: outputCheck.cleanupWarning,
  edgePath,
  cliHelpExitCode: help.status,
  cliCallable: help.status === 0,
  tempDir: os.tmpdir(),
};
result.ok = Boolean(
  result.nodeMajorSupported && result.stateWritable && result.outputWritable && result.edgePath && result.cliCallable
);
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 2;
