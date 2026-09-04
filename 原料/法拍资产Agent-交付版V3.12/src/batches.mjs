import fs from "node:fs/promises";

export function nextBatchRunName(dateKey, existingNames = []) {
  const names = new Set(existingNames);
  if (!names.has(dateKey)) return dateKey;
  let index = 1;
  while (names.has(`${dateKey}（${index}）`)) index += 1;
  return `${dateKey}（${index}）`;
}

export async function allocateBatchRunName(outputDir, dateKey) {
  let names = [];
  try { names = await fs.readdir(outputDir); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  return nextBatchRunName(dateKey, names);
}
