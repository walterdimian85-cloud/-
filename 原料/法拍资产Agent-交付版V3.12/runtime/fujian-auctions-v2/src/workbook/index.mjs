import { buildWorkbook as buildCodexWorkbook } from "../../scripts/build_workbook.mjs";

export async function buildWorkbook(options) {
  const { adapter = "codex", ...workbookOptions } = options || {};
  if (adapter === "codex") return buildCodexWorkbook(workbookOptions);
  if (adapter === "standard") {
    const { buildStandardWorkbook } = await import("./standard.mjs");
    return buildStandardWorkbook(workbookOptions);
  }
  throw new Error(`未知Excel适配器：${adapter}`);
}
