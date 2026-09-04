import fs from "node:fs/promises";
import path from "node:path";
import { loadArtifactTool } from "../scripts/runtime.mjs";

const [inputPath, previewDir] = process.argv.slice(2);
if (!inputPath || !previewDir) throw new Error("usage: node qa_existing_workbook.mjs <input.xlsx> <preview-dir>");
const { FileBlob, SpreadsheetFile } = await loadArtifactTool();
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const overview = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 6000,
  tableMaxRows: 6,
  tableMaxCols: 16,
});
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
await fs.mkdir(previewDir, { recursive: true });
for (const sheetName of ["总表", "即将开始", "已结束", "待复核"]) {
  const preview = await workbook.render({ sheetName, range: "A1:P12", scale: 1.2, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await preview.arrayBuffer()));
}
console.log(JSON.stringify({ overview: overview.ndjson, formulaErrors: errors.ndjson }, null, 2));
