#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v8：市场价=评估价，补齐缺评估价/面积/时间记录"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "yral"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

JS_EXTRACT = r"""(() => {
  const t = document.body ? document.body.innerText : '';
  const g = r => { const m = t.match(r); return m ? m[1] : null; };
  const startT = g(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*开拍/);
  const endT = g(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);
  return JSON.stringify({
    assess: g(/评估价[^0-9]*¥?\s*([\d,]+(?:\.\d+)?)/) || g(/市场价[^0-9]*¥?\s*([\d,]+(?:\.\d+)?)/),
    area: g(/房屋建筑面积\s*([\d.]+)\s*㎡/) || g(/建筑面积[为是：:]\s*([\d.]+)\s*平方米/) || g(/产权面积[^0-9]*([\d.]+)\s*㎡/) || g(/([\d.]+)\s*㎡/) || g(/面积[为是：:]\s*([\d.]+)/),
    startTime: startT,
    endTime: endT
  });
})()"""

def run(args, timeout=90):
    try:
        r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        return r.stdout
    except Exception as e:
        return f"ERR:{e}"

def ev():
    out = run(["evaluate", "--session", SESSION, JS_EXTRACT])
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith('{'):
            try:
                return json.loads(line)
            except:
                continue
    return None

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    # 需处理：缺评估价 或 缺面积 或 缺拍卖时间
    todo = [(i, x) for i, x in enumerate(recs)
            if x.get('评估价') in (None, '', '未找到')
            or x.get('面积/㎡') in (None, '', '未找到')
            or x.get('拍卖时间') in (None, '', '未找到')]
    print(f"需补采: {len(todo)} 条", flush=True)
    fixed_assess = fixed_area = fixed_time = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        miss = []
        if rec.get('评估价') in (None, '', '未找到'): miss.append('评估价')
        if rec.get('面积/㎡') in (None, '', '未找到'): miss.append('面积')
        if rec.get('拍卖时间') in (None, '', '未找到'): miss.append('时间')
        print(f"[{n}/{len(todo)}] 缺{miss} | {url[-30:]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(9)
        d = ev()
        if not d:
            print("  ⚠ evaluate 失败", flush=True)
            continue
        changed = False
        if rec.get('评估价') in (None, '', '未找到') and d.get('assess'):
            rec['评估价'] = float(d['assess'].replace(',', ''))
            fixed_assess += 1
            changed = True
        if rec.get('面积/㎡') in (None, '', '未找到') and d.get('area'):
            rec['面积/㎡'] = float(d['area'])
            fixed_area += 1
            changed = True
        if rec.get('拍卖时间') in (None, '', '未找到'):
            if d.get('endTime'):
                rec['拍卖时间'] = d['endTime']
                fixed_time += 1
                changed = True
            elif d.get('startTime'):
                rec['拍卖时间'] = d['startTime'] + ':00'
                fixed_time += 1
                changed = True
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
        print(f"    -> 评估={rec.get('评估价')} 面积={rec.get('面积/㎡')} 时间={rec.get('拍卖时间')}", flush=True)
    # 最终统计
    from collections import Counter
    miss = Counter()
    for x in recs:
        for k in ['起拍价格','评估价','面积/㎡','拍卖时间','处置法院','发拍次数']:
            if x.get(k) in (None, '', '未找到'):
                miss[k] += 1
    print(f"\n完成！修复: 评估{fixed_assess} 面积{fixed_area} 时间{fixed_time}")
    print(f"最终缺失: {dict(miss)}")

if __name__ == '__main__':
    main()
