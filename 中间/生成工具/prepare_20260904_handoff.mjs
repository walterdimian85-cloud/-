import fs from 'node:fs/promises';
import path from 'node:path';

const root = 'E:\\dsh';
const batch = path.join(root, '中间', '法拍agent房源结果目录', '20260904');
const progressPath = path.join(batch, '采集进度.json');
const outDir = path.join(root, '中间', 'WorkBuddy交接', '20260904');
const inputPath = path.join(outDir, '20260904三产物输入.json');
const manifestPath = path.join(outDir, 'manifest.json');
const upDate = '09-04';
const qz = ['丰泽区','鲤城区','洛江区','晋江市','石狮市','南安市','惠安县','台商投资区','泉港区','安溪县','永春县','德化县'];
const fz = ['鼓楼区','仓山区','台江区','晋安区','闽侯县','福清市','马尾区','连江县','长乐区','罗源县','闽清县','永泰县','平潭县'];
const rounds = { 一拍: 1, 二拍: 2, 变卖: 3 };
const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const write = async (p, x) => { const t = `${p}.tmp`; await fs.writeFile(t, `${JSON.stringify(x, null, 2)}\n`, 'utf8'); await fs.rename(t, p); };
const url = x => String(x || '').trim().replace(/[?#].*$/u, '');
const status = x => x.是否成交 === '即将开始' ? '即将开始' : x.是否成交 === '是' ? '成交标的' : '流拍标的';
const key = x => [x.平台, url(x.网站链接), x.发拍次数, status(x), x.拍卖时间 || x.竞拍结束时间 || ''].join('|');
const num = x => Number.isFinite(Number(x)) ? Number(x) : null;
const nround = (x, p = 2) => Number(Number(x).toFixed(p));
function address(x) {
  let v = String(x.标的名称 || '').trim().replace(/^(?:福建省|江苏省|福州市|泉州市)/u, '').replace(/^(?:址在|位于|坐落于|坐落在)/u, '');
  if (x.区域) v = v.replace(new RegExp(`^${String(x.区域).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`), '');
  do { const old = v; v = v.replace(/[（(][^（）()]*[）)]/gu, ''); if (v === old) break; } while (true);
  return v.replace(/的(?:房产|不动产|房地产|及室内家具家电|及屋内物品)$/u, '').replace(/(?:房产|不动产|房地产|及室内家具家电|及屋内物品)$/u, '').replace(/的$/u, '').replace(/\s+/gu, ' ').trim();
}
function court(v) {
  v = String(v || '').trim();
  if (v === '福建省泉州市中级人民法院') return '泉州市中级人民法院';
  if (v === '福建省福州市中级人民法院') return '福州市中级人民法院';
  return /^(?:福建省|泉州市|福州市)/u.test(v) && !/^[^省]+省[^市]+市中级人民法院$/u.test(v) ? v.replace(/^(?:福建省|泉州市|福州市)/u, '') : v;
}
function standaloneAccessory(x) {
  if (!['车位', '车库'].includes(x.标的类型)) return false;
  // 采集器类型列会把“住宅/商业＋车位”的整体标的错标为车位；只有标题不含其他房屋主体时才排除。
  return !/(?:#楼|幢|单元|\d+室|商铺|店面|住宅|房产|不动产|房地产|厂房|工业|储藏间|杂物间)/u.test(String(x.标的名称 || ''));
}
function output(x) {
  const area = num(x['面积/㎡']), start = num(x.起拍价格), appraisal = num(x.评估价), sold = num(x.成交金额), group = status(x);
  return {
    '所在省份': x.所在省份, '城市': x.城市, '区域': x.区域 === '平潭综合实验区' ? '平潭县' : x.区域,
    '原始标的名称': x.标的名称, '标准地址': address(x), '标的名称': address(x), '小区名称（仅供参考）': x['小区名称（仅供参考）'],
    '标的类型': x.标的类型, '平台': x.平台, '发拍次数': x.发拍次数, '拍卖时间': x.拍卖时间,
    '是否成交': x.是否成交, '处置法院': court(x.处置法院), '面积/㎡': area,
    '起拍单价-元/㎡': area > 0 && start !== null ? Math.round(start / area) : null, '起拍价格': start,
    '评估价(万元)': appraisal !== null ? nround(appraisal / 10000, 4) : null, '折扣率(%)': appraisal > 0 && start !== null ? nround(start / appraisal * 100, 2) : null,
    '成交金额': x.是否成交 === '是' ? sold : 0, '溢价率': x.是否成交 === '是' && start > 0 && sold !== null ? nround(sold / start - 1, 4) : null,
    '成交单价': x.是否成交 === '是' && area > 0 && sold !== null ? Math.round(sold / area) : null,
    '竞买记录': x.竞买记录 ?? null, '报名人数': x.报名人数 ?? null, '备注': x.备注 || null, '网站链接': url(x.网站链接),
    '_字段证据': url(x.网站链接) === 'https://paimai.jd.com/311210981' ? { '小区名称（仅供参考）': '用户人工核证：小区为丰明路。' } : undefined,
    '_来源表': group, '_来源平台': x.平台, '_上新日期': group === '即将开始' ? upDate : null
  };
}

const progress = await json(progressPath);
for (const x of progress.records) if (x.是否成交 === '即将开始') x._上新日期 = upDate;
await write(progressPath, progress);
const excluded = [], candidates = [];
for (const x of progress.records) {
  if (standaloneAccessory(x)) excluded.push({ '网站链接': url(x.网站链接), '标的名称': x.标的名称, '路线': x._源分类 || x.标的类型, '原始状态': x.是否成交, '原始标的类型': x.标的类型, '原因': '独立拍卖的纯车位/纯车库，按硬性规则§9排除' });
  else candidates.push(x);
}
const historical = new Set();
for (const d of await fs.readdir(path.join(root, '中间', 'WorkBuddy交接'), { withFileTypes: true })) {
  const file = path.join(root, '中间', 'WorkBuddy交接', d.name, `${d.name}三产物输入.json`);
  if (!d.isDirectory() || d.name === '20260904') continue;
  try { for (const rows of Object.values((await json(file)).表 || {})) for (const x of rows) historical.add([x.平台, url(x.网站链接), x.发拍次数, x._来源表, x.拍卖时间 || ''].join('|')); } catch {}
}
const duplicates = [], seen = new Set(), kept = [];
for (const x of candidates) {
  const k = key(x);
  if (seen.has(k)) { duplicates.push({ '网站链接': url(x.网站链接), '标的名称': x.标的名称, '原因': '本批复合去重键重复' }); continue; }
  seen.add(k);
  if (historical.has(k)) { duplicates.push({ '网站链接': url(x.网站链接), '标的名称': x.标的名称, '原因': '与历史同阶段、同轮次、同时间复合去重键重复' }); continue; }
  kept.push(x);
}
const rows = kept.map(output), tables = { '即将开始': [], '成交标的': [], '流拍标的': [] };
for (const x of rows) tables[x._来源表].push(x);
for (const [group, list] of Object.entries(tables)) list.sort((a,b) => {
  if (group !== '即将开始') { const d = String(a.拍卖时间||'').localeCompare(String(b.拍卖时间||'')); if (d) return d; }
  const ar = (a.城市 === '泉州市' ? qz : fz).indexOf(a.区域), br = (b.城市 === '泉州市' ? qz : fz).indexOf(b.区域); if (ar !== br) return (ar < 0 ? 999 : ar) - (br < 0 ? 999 : br);
  const d = (rounds[a.发拍次数] || 99) - (rounds[b.发拍次数] || 99); return d || String(a.拍卖时间||'').localeCompare(String(b.拍卖时间||''));
});
const required = ['所在省份','城市','区域','原始标的名称','标准地址','小区名称（仅供参考）','标的类型','平台','发拍次数','拍卖时间','是否成交','处置法院','面积/㎡','起拍价格','评估价(万元)','网站链接'];
const missing = [];
for (const x of rows) { const fields = required.filter(f => x[f] === null || x[f] === undefined || x[f] === '' || ['未找到','待补采','待核验'].includes(x[f])); if (x._来源表 !== '即将开始' && (x.报名人数 === null || x.报名人数 === undefined)) fields.push('报名人数'); if (fields.length) missing.push({ '网站链接': x.网站链接, '原始标题': x.原始标的名称, '城市': x.城市, '区域': x.区域, '数据阶段': x._来源表, '日期': x._上新日期 || String(x.拍卖时间||'').slice(0,10), '缺失字段': fields }); }
const counts = Object.fromEntries(Object.entries(tables).map(([k,v]) => [k,v.length]));
const city = {}; for (const x of rows) { city[x.城市] ||= { '即将开始':0,'成交标的':0,'流拍标的':0 }; city[x.城市][x._来源表]++; }
const summary = { raw: progress.records.length, excluded: excluded.length, historicalDuplicates: duplicates.length, kept: rows.length, counts, missing, city };
if (missing.length) { console.log(JSON.stringify({ ...summary, generated: false }, null, 2)); process.exit(2); }
const input = { dateKey:'20260904', generatedAt:new Date().toISOString(), 来源:[progressPath, path.join(batch,'20260904新增房源信息.xlsx')], 表:tables, 缺失统计:{ '未解决必采字段':0, '人工复核':[] } };
const manifest = { dateKey:'20260904', 状态:'数据准备质检完成，允许进入产物生成', '规则正本路径':path.join(root,'中间','采集复核与交接硬性规则.md'), '规则版本':'1.5', '批次日期':'20260904', '唯一主输入':inputPath, '上新归属日期映射':{'即将开始':upDate}, '结果日期规则':'成交和流拍只按记录中的真实结束时间归档，不使用上新归属日期。', 地区:['福州市','泉州市'], 平台:[...new Set(rows.map(x=>x.平台))], 数据来源:input.来源, '各状态数量':{'原始采集':{'即将开始':progress.records.filter(x=>x.是否成交==='即将开始').length,'成交':progress.records.filter(x=>x.是否成交==='是').length,'流拍':progress.records.filter(x=>x.是否成交==='否').length,'总计':progress.records.length},'正式交接候选':{'即将开始':counts['即将开始'],'成交':counts['成交标的'],'流拍':counts['流拍标的'],'总计':rows.length}}, '城市状态统计':city, '排除清单':excluded, '重复清单':duplicates, '缺失清单':input.缺失统计, '排序规则':'上新：上新归属日期降序→固定区县顺序→一拍→二拍→变卖；结果：真实结束日期升序→成交/流拍分组→固定区县顺序→一拍→二拍→变卖。', '目标路径':{'HTML':path.join(root,'产物','html'),'Excel':path.join(root,'产物','excel','20260904')}, '是否同步飞书':false, '是否允许覆盖':false, '回滚依据':'原始采集进度.json、AI复核变更.json与20260904新增房源信息.xlsx；本文件不改写原始采集事实。', '交接前质量验收':{'候选记录数':rows.length,'排除独立车位/车库数':excluded.length,'历史重复排除数':duplicates.length,'链接复合键重复数':0,'未解决字段或异常数':0,'是否允许产物生成':true,'说明':'通过。'} };
await fs.mkdir(outDir,{recursive:true}); await write(inputPath,input); await write(manifestPath,manifest); console.log(JSON.stringify({ ...summary, generated:true, inputPath, manifestPath },null,2));
