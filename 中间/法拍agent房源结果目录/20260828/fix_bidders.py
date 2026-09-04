#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补采福州阿里成交标的的报名人数（打开页面查 X人报名）"""
import subprocess, json, re, time, sys

BSK = r'C:\Users\20616\.local\bin\bsk.exe'
SESSION = 'rmrf'

LINKS = [
    'https://sf-item.taobao.com/sf_item/1077217587867.htm',
    'https://sf-item.taobao.com/sf_item/1073199694629.htm',
    'https://sf-item.taobao.com/sf_item/1073312750523.htm',
    'https://sf-item.taobao.com/sf_item/1070118472412.htm',
    'https://sf-item.taobao.com/sf_item/1074240481226.htm',
    'https://sf-item.taobao.com/sf_item/1075201584714.htm',
    'https://sf-item.taobao.com/sf_item/1074213389855.htm',
    'https://sf-item.taobao.com/sf_item/1072182538694.htm',
    'https://sf-item.taobao.com/sf_item/1070408920851.htm',
]

JS = r"""(() => {
  const t = document.body ? document.body.innerText : '';
  const g = r => { const m = t.match(r); return m ? m[1] : null; };
  // 阿里报名人数常见格式：'2人报名' / '报名人数：2' / '报名 2人'
  let bidders = g(/(\d+)\s*人报名/) || g(/报名人数[：:]\s*(\d+)/) || g(/报名\s*(\d+)\s*人/);
  return JSON.stringify({bidders: bidders ? parseInt(bidders) : null, title: (document.title||'').slice(0,50)});
})()"""

results = {}
for i, url in enumerate(LINKS, 1):
    hid = url.split('sf_item/')[1].split('.')[0]
    ok = False
    for wait in (8, 12):
        r = subprocess.run([BSK, 'navigate', '--session', SESSION, url],
                           capture_output=True, text=True, encoding='utf-8', timeout=60)
        time.sleep(wait)
        r2 = subprocess.run([BSK, 'evaluate', '--session', SESSION, JS],
                            capture_output=True, text=True, encoding='utf-8', timeout=60)
        out = r2.stdout
        for line in reversed(out.splitlines()):
            line = line.strip()
            if line.startswith('{'):
                try:
                    d = json.loads(line)
                except:
                    continue
                if d.get('title'):
                    results[hid] = d
                    ok = True
                    break
        if ok:
            break
    print(f'{i}/{len(LINKS)} {hid}: {results.get(hid, {}).get("bidders")} | {results.get(hid, {}).get("title", "")}', flush=True)

with open(r'E:\dsh\中间\法拍agent房源结果目录\20260828\20260828_报名人数补采.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print('已保存补采结果')
