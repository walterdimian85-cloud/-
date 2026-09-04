import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./config.mjs";

export async function distributionInfo(root = ROOT) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root, "distribution.json"), "utf8"));
    return { schemaVersion: 1, mode: value.mode === "delivery" ? "delivery" : "developer" };
  } catch {
    return { schemaVersion: 1, mode: "developer" };
  }
}

export async function isDeveloperDistribution(root = ROOT) {
  return (await distributionInfo(root)).mode === "developer";
}
