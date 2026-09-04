/**
 * 泉州法拍月度总结（默认只预检；加 --write 才生成 HTML）。
 * 数据源：当月 WorkBuddy交接\YYYYMMDD\YYYYMMDD三产物输入.json。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'E:/dsh';
const HANDOFF_ROOT = path.join(ROOT, '中间', 'WorkBuddy交接');
const args = process.argv.slice(2);
const arg = (name, fallback = '') => args.includes(name) ? args[args.indexOf(name) + 1] ?? fallback : fallback;
const month = arg('--month', '2026-08');
const write = args.includes('--write');
const allowPartial = args.includes('--allow-partial');
if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('参数错误：--month 必须为 YYYY-MM。');
const yyyymm = month.replace('-', '');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v) => Number(v) || 0;
const yuanToWan = (v) => num(v) / 10000;
const stageOf = (name) => name.includes('成交') ? '成交' : name.includes('流拍') ? '流拍' : '上新';
const dateOf = (row, stage) => {
  const raw = stage === '上新' ? row['_上新日期'] : row['拍卖时间'];
  const match = String(raw ?? '').match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const short = String(raw ?? '').match(/^(\d{1,2})[-/](\d{1,2})$/);
  return short ? `${month.slice(0, 4)}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}` : '';
};
const bar = (label, value, max, cls = '') => `<div class="bar-row"><span>${esc(label)}</span><div class="track"><i class="${cls}" style="width:${max ? Math.max(2, value / max * 100) : 0}%"></i></div><b>${value}</b></div>`;
const stackedBar = (label, values, max) => { const total = values.up + values.deal + values.fail; return `<div class="bar-row"><span>${esc(label)}</span><div class="track"><i style="width:${values.up / max * 100}%"></i><i class="green" style="width:${values.deal / max * 100}%"></i><i class="red" style="width:${values.fail / max * 100}%"></i></div><b>${total}</b></div>`; };
const chart = (title, body, note = '') => `<section class="chart"><h2>${esc(title)}</h2>${body}${note ? `<p class="note">${esc(note)}</p>` : ''}</section>`;

const dirs = (await fs.readdir(HANDOFF_ROOT, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && new RegExp(`^${yyyymm}\\d{2}$`).test(d.name))
  .map((d) => d.name).sort();
const sources = [];
for (const day of dirs) {
  const file = path.join(HANDOFF_ROOT, day, `${day}三产物输入.json`);
  try { sources.push({ day, file, data: JSON.parse(await fs.readFile(file, 'utf8')) }); } catch { /* 没有唯一输入的日期不纳入统计 */ }
}
const seen = new Set();
const rows = [];
for (const source of sources) for (const [group, list] of Object.entries(source.data['表'] ?? {})) {
  const stage = stageOf(group);
  for (const row of list) {
    if (row['城市'] !== '泉州市') continue;
    const eventDate = dateOf(row, stage);
    if (!eventDate.startsWith(month)) continue;
    const key = [row['平台'], row['网站链接'], row['发拍次数'], stage, eventDate].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...row, stage, eventDate, sourceDay: source.day });
  }
}
if (!sources.length) throw new Error(`${month} 未找到可用的唯一输入 JSON。`);
const count = (stage) => rows.filter((r) => r.stage === stage).length;
const up = count('上新'), deal = count('成交'), fail = count('流拍'), resultCount = deal + fail;
const totalDealWan = rows.filter((r) => r.stage === '成交').reduce((s, r) => s + yuanToWan(r['成交金额']), 0);
const groups = (key) => [...rows.reduce((m, r) => {
  const k = String(r[key] ?? '未披露');
  m.set(k, (m.get(k) ?? 0) + 1); return m;
}, new Map()).entries()].sort((a, b) => b[1] - a[1]);
const daily = [...rows.reduce((m, r) => { const item = m.get(r.eventDate) ?? { up: 0, deal: 0, fail: 0 }; item[r.stage === '上新' ? 'up' : r.stage === '成交' ? 'deal' : 'fail'] += 1; m.set(r.eventDate, item); return m; }, new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
const districts = groups('区域').slice(0, 12);
const types = groups('标的类型').slice(0, 8);
const rounds = groups('发拍次数').slice(0, 6);
const maxDaily = Math.max(1, ...daily.map(([, v]) => v.up + v.deal + v.fail));
const maxDistrict = Math.max(1, ...districts.map(([, v]) => v));
const maxType = Math.max(1, ...types.map(([, v]) => v));
const topDeals = rows.filter((r) => r.stage === '成交').sort((a, b) => num(b['成交金额']) - num(a['成交金额'])).slice(0, 8);
const coverage = sources.map((s) => s.day.slice(-2)).join('、') || '无';
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>泉州法拍 ${month} 月度总结</title><style>
body{margin:0;background:#f5f7fa;color:#18212f;font:14px/1.5 "Microsoft YaHei",sans-serif}.wrap{max-width:1320px;margin:auto;padding:30px}h1{margin:0;font-size:30px}.sub,.note{color:#667085}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}.kpi,.chart{background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 3px #10182812}.kpi b{display:block;font-size:28px;color:#175cd3}.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px}.chart h2{margin:0 0 12px;font-size:17px}.bar-row{display:grid;grid-template-columns:92px 1fr 42px;gap:8px;align-items:center;margin:7px 0}.track{display:flex;height:12px;background:#eef2f6;border-radius:6px;overflow:hidden}.track i{display:block;height:100%;background:#175cd3}.track i.orange{background:#f79009}.track i.red{background:#d92d20}.track i.green{background:#039855}.legend{display:flex;gap:14px;color:#475467}.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;background:#175cd3}.legend .green{background:#039855}.legend .red{background:#d92d20}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border-bottom:1px solid #eaecf0;text-align:left}th{color:#475467}@media(max-width:800px){.grid,.charts{grid-template-columns:1fr 1fr}.wrap{padding:14px}}@media(max-width:520px){.grid,.charts{grid-template-columns:1fr}.bar-row{grid-template-columns:78px 1fr 34px}}</style></head><body><main class="wrap"><h1>泉州法拍 ${esc(month)} 月度总结</h1><p class="sub">统计口径：已接入唯一输入批次 ${esc(coverage)} 日；同平台＋链接＋轮次＋状态＋事件日期复合去重。生成时间：${new Date().toLocaleString('zh-CN')}</p><div class="grid"><div class="kpi">上新<b>${up}</b></div><div class="kpi">成交<b>${deal}</b></div><div class="kpi">流拍<b>${fail}</b></div><div class="kpi">成交率<b>${resultCount ? (deal / resultCount * 100).toFixed(1) : '0.0'}%</b></div><div class="kpi">成交总额（万元）<b>${totalDealWan.toFixed(1)}</b></div></div><div class="charts">${chart('按日期的上新与结果数量', `<p class="legend"><i></i>上新 <i class="green"></i>成交 <i class="red"></i>流拍</p>${daily.map(([d, v]) => stackedBar(d.slice(5), v, maxDaily)).join('')}`, '上新按上新归属日期，结果按真实拍卖时间。')}${chart('区域分布（前12）', districts.map(([d, v]) => bar(d, v, maxDistrict, 'orange')).join(''))}${chart('物业类型结构', types.map(([d, v]) => bar(d, v, maxType, 'green')).join(''))}${chart('拍卖轮次结构', rounds.map(([d, v]) => bar(d, v, Math.max(1, ...rounds.map((x) => x[1])), 'red')).join(''))}</div>${chart('成交金额 TOP 8', `<table><thead><tr><th>区域</th><th>标的</th><th>成交金额（万元）</th><th>平台</th></tr></thead><tbody>${topDeals.map((r) => `<tr><td>${esc(r['区域'])}</td><td>${esc(r['标的名称'])}</td><td>${yuanToWan(r['成交金额']).toFixed(2)}</td><td>${esc(r['平台'])}</td></tr>`).join('') || '<tr><td colspan="4">本月无成交标的</td></tr>'}</tbody></table>`)}</main></body></html>`;

const summary = { month, sourceBatches: sources.map((s) => s.day), records: rows.length, up, deal, fail, dealRate: resultCount ? Number((deal / resultCount * 100).toFixed(2)) : 0, totalDealWan: Number(totalDealWan.toFixed(2)), output: path.join(ROOT, '产物', '月度总结', yyyymm, '泉州法拍月度总结.html') };
if (write && !allowPartial) throw new Error(`仅发现 ${sources.map((s) => s.day).join('、')} 的唯一输入；请核实覆盖范围后使用 --write --allow-partial 明确生成。`);
if (write) { await fs.mkdir(path.dirname(summary.output), { recursive: true }); await fs.writeFile(summary.output, html, 'utf8'); }
console.log(JSON.stringify({ ...summary, mode: write ? 'written' : 'dry-run' }, null, 2));
