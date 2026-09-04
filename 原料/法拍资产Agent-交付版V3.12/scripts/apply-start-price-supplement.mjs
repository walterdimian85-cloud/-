import fs from 'node:fs/promises';
import path from 'node:path';
import { buildWorkbook } from '../runtime/fujian-auctions-v2/scripts/build_workbook.mjs';
const statePath='C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/采集进度.json';
const workbookPath='C:/Users/HUAWEI/Documents/福建法拍房数据爬取/房源整理结果/20260820/20260820新增房源信息.xlsx';
const state=JSON.parse(await fs.readFile(statePath,'utf8'));
const before={records:state.records.length,urls:state.records.map(r=>r['网站链接']).sort(),completedUrls:state.completedUrls,groups:state.groups,newAnchors:state.newAnchors};
const updates=[{index:32,value:441420,raw:'起拍价：¥441,420'}];
const backup=path.join(path.dirname(statePath),`采集进度.json.起拍价格补采备份-${new Date().toISOString().replace(/[:.]/g,'-')}`);
await fs.copyFile(statePath,backup,fs.constants.COPYFILE_EXCL);
for(const u of updates){const r=state.records[u.index];r['起拍价格']=u.value;r._fieldEvidence??={};r._fieldEvidence['起拍价格']={value:u.value,dataType:'number',unit:'元',source:{platform:'alibaba',section:'平台详情页标签邻接价格区',element:'起拍价',rawText:u.raw},ruleId:'alibaba-start-price-v2',confidence:'high',conflicts:[],reviewRequired:false};r._startPriceSource='平台详情页标签邻接价格区';if(Array.isArray(r._missing))r._missing=r._missing.filter(x=>x!=='起拍价格');}
const after={records:state.records.length,urls:state.records.map(r=>r['网站链接']).sort(),completedUrls:state.completedUrls,groups:state.groups,newAnchors:state.newAnchors};
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Non-start-price collection state changed');
await fs.writeFile(`${statePath}.start.tmp`,JSON.stringify(state,null,2),'utf8');await fs.rename(`${statePath}.start.tmp`,statePath);
const qa=await buildWorkbook({records:state.records,reviewItems:[],outputPath:workbookPath});
const missing=state.records.filter(r=>!Number.isFinite(Number(r['起拍价格']))||Number(r['起拍价格'])<=0).length;
console.log(JSON.stringify({backup,totalRecords:state.records.length,updated:updates.length,unresolvedMissing:missing,workbookPath,qa},null,2));
