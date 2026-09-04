#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v9：点击竞买公告提取面积"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "yral"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

def run(args, timeout=90):
    try:
        r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        return r.stdout
    except Exception as e:
        return f"ERR:{e}"

def ev(js):
    out = run(["evaluate", "--session", SESSION, js])
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith('{') or line.startswith('['):
            try:
                return json.loads(line)
            except:
                continue
    return None

# 点击竞买公告并返回公告文本+面积
JS_GET_NOTICE = r"""(() => {
  // 点击竞买公告
  const els = Array.from(document.querySelectorAll('a,button,div,li,span')).filter(e => (e.innerText||'').trim() === '竞买公告');
  if (els.length) els[0].click();
  return 'clicked';
})()"""

JS_READ_NOTICE = r"""(() => {
  const el = document.getElementById('NoticeDetail');
  const t = el ? el.innerText : '';
  const g = r => { const m = t.match(r); return m ? m[1] : null; };
  return JSON.stringify({
    len: t.length,
    area: g(/建筑面积[^0-9]{0,6}([\d.]+)\s*平方米/) || g(/建筑面积[^0-9]{0,6}([\d.]+)\s*㎡/) || g(/([\d.]+)\s*平方米/) || g(/证载面积[^0-9]*([\d.]+)/) || g(/总建筑面积[^0-9]*([\d.]+)/),
    text: t.slice(0, 300)
  });
})()"""

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    todo = [(i, x) for i, x in enumerate(recs) if x.get('面积/㎡') in (None, '', '未找到')]
    print(f"需从竞买公告补面积: {len(todo)} 条", flush=True)
    fixed = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        print(f"[{n}/{len(todo)}] {url[-32:]} | {rec.get('标的名称','')[:25]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(9)
        ev(JS_GET_NOTICE)  # 点击竞买公告
        time.sleep(5)
        d = ev(JS_READ_NOTICE)
        if not d:
            time.sleep(5)
            d = ev(JS_READ_NOTICE)
        if d and d.get('area'):
            rec['面积/㎡'] = float(d['area'])
            rec['备注'] = (rec.get('备注','') + f"；面积来自竞买公告（公告原文：{d.get('text','')[:80]}...）").strip('；')
            fixed += 1
            print(f"    -> 面积={rec['面积/㎡']}", flush=True)
        else:
            ln = d.get('len') if d else '?'
            print(f"    ⚠ 公告未获取到面积 (公告长度={ln})", flush=True)
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
    miss = sum(1 for x in recs if x.get('面积/㎡') in (None, '', '未找到'))
    print(f"\n完成！修复 {fixed} 条，仍缺面积 {miss} 条")

if __name__ == '__main__':
    main()
