import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [statePath, session] = process.argv.slice(2);
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const missing = state.records.map((record, index) => ({ record, index })).filter(({ record }) => record['发拍次数'] === '变卖' && (!Number.isFinite(Number(record['起拍价格'])) || Number(record['起拍价格']) <= 0));
const run = (args) => execFileSync('bsk', args, { encoding: 'utf8', timeout: 15000, windowsHide: true });
const results=[];
for (const {record,index} of missing) {
  try {
    run(['navigate',record['网站链接'],'--session',session,'--wait-until','domcontentloaded','--timeout','20s']);
    run(['wait-ms','1s']);
    const text=JSON.parse(run(['snapshot','--session',session,'--json'])).text;
    const match=text.match(/cell "(起拍价|起拍价格|变卖价)\s*:\s*[￥¥]?\s*([\d,.]+)(?:元)?"/);
    const raw=match?.[2]??null; const value=raw?Number(raw.replaceAll(',','')):null;
    results.push({index,url:record['网站链接'],label:match?.[1]??null,raw,value:Number.isFinite(value)&&value>0?value:null});
  } catch (error) { results.push({index,url:record['网站链接'],value:null,error:String(error.message).slice(0,300)}); }
}
process.stdout.write(JSON.stringify({total:results.length,results},null,2));
