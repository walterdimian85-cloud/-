import fs from 'node:fs/promises';
import path from 'node:path';
import { buildWorkbook } from '../runtime/fujian-auctions-v2/scripts/build_workbook.mjs';

const statePath = 'C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/采集进度.json';
const workbookPath = 'C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/20260820新增房源信息.xlsx';
const evidencePath = 'runtime/assessment-evidence-20260820.json';
const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
const baseline = JSON.stringify({ records: state.records.length, urls: state.records.map((r) => r['网站链接']).sort(), completedUrls: state.completedUrls, groups: state.groups, newAnchors: state.newAnchors });
const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8')).results;
const usable = evidence.filter((item) => Number.isFinite(item.value) && item.value > 0 && ['评估价', '市场价', '市场参考价'].includes(item.label));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(path.dirname(statePath), `采集进度.json.评估价补采备份-${stamp}`);
await fs.copyFile(statePath, backupPath, fs.constants.COPYFILE_EXCL);
for (const item of usable) {
  const record = state.records[item.index];
  record['评估价'] = item.value;
  record._fieldEvidence ??= {};
  record._fieldEvidence['评估价'] = { value: item.value, dataType: 'number', unit: '元', source: { platform: 'alibaba', section: '平台详情页标签邻接价格区', element: item.label, rawText: `${item.label}：¥${item.raw}` }, ruleId: item.label === '评估价' ? 'alibaba-assessment-price-v2' : 'alibaba-market-price-as-assessment-v2', confidence: 'high', conflicts: [], reviewRequired: false };
  if (Array.isArray(record._missing)) record._missing = record._missing.filter((field) => field !== '评估价');
}
const after = JSON.stringify({ records: state.records.length, urls: state.records.map((r) => r['网站链接']).sort(), completedUrls: state.completedUrls, groups: state.groups, newAnchors: state.newAnchors });
if (baseline !== after) throw new Error('Non-assessment collection state changed; refusing to write');
await fs.writeFile(`${statePath}.assessment.tmp`, JSON.stringify(state, null, 2), 'utf8');
await fs.rename(`${statePath}.assessment.tmp`, statePath);
const workbookQa = await buildWorkbook({ records: state.records, reviewItems: [], outputPath: workbookPath });
const stillMissing = state.records.filter((r) => !Number.isFinite(Number(r['评估价'])) || Number(r['评估价']) <= 0).length;
console.log(JSON.stringify({ backupPath, totalRecords: state.records.length, updated: usable.length, stillMissing, workbookPath, workbookQa }, null, 2));
