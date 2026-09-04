import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runtimeNodeModuleRoots() {
  const roots = [];
  if (process.env.CODEX_RUNTIME_NODE_MODULES) {
    roots.push(path.resolve(process.env.CODEX_RUNTIME_NODE_MODULES));
  }
  roots.push(
    path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules",
    ),
  );
  const runtimes = path.join(os.homedir(), ".cache", "codex-runtimes");
  try {
    for (const entry of await fs.readdir(runtimes, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      roots.push(
        path.join(
          runtimes,
          entry.name,
          "dependencies",
          "node",
          "node_modules",
        ),
      );
    }
  } catch {
    // The standard Codex runtime path above remains the primary candidate.
  }
  return [...new Set(roots)];
}

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Fall through to the bundled Codex runtime.
  }
  for (const root of await runtimeNodeModuleRoots()) {
    const direct = path.join(root, "playwright-core", "index.mjs");
    if (await exists(direct)) return import(pathToFileURL(direct).href);
    const pnpmRoot = path.join(root, ".pnpm");
    try {
      const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
      const matches = entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("playwright-core@"))
        .map((entry) =>
          path.join(
            pnpmRoot,
            entry.name,
            "node_modules",
            "playwright-core",
            "index.mjs",
          ),
        );
      for (const candidate of matches) {
        if (await exists(candidate)) return import(pathToFileURL(candidate).href);
      }
    } catch {
      // Try the next runtime root.
    }
  }
  throw new Error(
    "未找到 Playwright。请在 Codex Desktop 中运行，或在当前 Node 环境安装 playwright。",
  );
}

export async function loadArtifactTool() {
  try {
    return await import("@oai/artifact-tool");
  } catch {
    // Fall through to the bundled Codex runtime.
  }
  for (const root of await runtimeNodeModuleRoots()) {
    const candidate = path.join(
      root,
      "@oai",
      "artifact-tool",
      "dist",
      "artifact_tool.mjs",
    );
    if (await exists(candidate)) return import(pathToFileURL(candidate).href);
  }
  throw new Error(
    "未找到 @oai/artifact-tool。请从 Codex Desktop 运行此 Skill。",
  );
}
