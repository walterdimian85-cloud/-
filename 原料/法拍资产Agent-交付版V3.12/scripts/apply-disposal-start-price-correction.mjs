import fs from 'node:fs/promises';
import path from 'node:path';
import { buildWorkbook } from '../runtime/fujian-auctions-v2/scripts/build_workbook.mjs';
const statePath='C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/采集进度.json';
const workbookPath='C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/20260820新增房源信息.xlsx';
const state=JSON.parse(await fs.readFile(statePath,'utf8'));
const before={records:state.records.length,urls:state.records.map(r=>r['网站链接']).sort(),completedUrls:state.completedUrls,groups:state.groups,newAnchors:state.newAnchors};
const updates=[23,24,25,26,27,28,29].map(index=>({index,value:21280,raw:'变卖价：¥21,280'}));
const backup=path.join(path.dirname(statePath),`采集进度.json.变卖价起拍价格更正备份-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.copyFile(statePath,backup,fs.constants.COPYFILE_EXCL);
for(const u of updates){const r=state.records[u.index];if(r['发拍次数']!=='变卖')throw new Error(`Unexpected phase at ${u.index}`);r['起拍价格']=u.value;r._fieldEvidence??={};r._fieldEvidence['起拍价格']={value:u.value,dataType:'number',unit:'元',source:{platform:'alibaba',section:'平台详情页标签邻接变卖价',element:'变卖价',rawText:u.raw},ruleId:'alibaba-disposal-price-as-start-price-v2',confidence:'high',conflicts:[],reviewRequired:false};r._startPriceSource='平台详情页标签邻接变卖价';if(Array.isArray(r._missing))r._missing=r._missing.filter(x=>x!=='起拍价格');}
const after={records:state.records.length,urls:state.records.map(r=>r['网站链接']).sort(),completedUrls:state.completedUrls,groups:state.groups,newAnchors:state.newAnchors};
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Non-target state changed');
await fs.writeFile(`${statePath}.disposal.tmp`,JSON.stringify(state,null,2),'utf8');await fs.rename(`${statePath}.disposal.tmp`,statePath);
const qa=await buildWorkbook({records:state.records,reviewItems:[],outputPath:workbookPath});
const remaining=state.records.filter(r=>!Number.isFinite(Number(r['起拍价格']))||Number(r['起拍价格'])<=0);
console.log(JSON.stringify({backup,totalRecords:state.records.length,updated:updates.length,remainingMissing:remaining.length,remaining,workbookPath,qa},null,2));
