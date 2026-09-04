#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v7：最后一轮，滚动页面触发懒加载，仍缺则标记未找到"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "kywd"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

JS_EXTRACT = r"""(() => {
  const t = document.body ? document.body.innerText : '';
  const g = r => { const m = t.match(r); return m ? m[1] : null; };
  const ci = t.indexOf('人民法院');
  let court = null;
  if (ci > 0) {
    const slice = t.slice(Math.max(0, ci - 30), ci + 5).replace(/\s+/g, '');
    const m2 = slice.match(/[\u4e00-\u9fa5]{2,}人民法院/);
    if (m2) court = m2[0];
  }
  const startT = g(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*开拍/);
  const endT = g(/(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const round = g(/(一拍|二拍|变卖|再次拍卖|最后一拍)/);
  const sold = t.includes('本场已成交') ? '是' : t.includes('本场已流拍') ? '否' : t.includes('本场已结束') ? '待核验' : (startT ? '未开始' : null);
  return JSON.stringify({
    area: g(/房屋建筑面积\s*([\d.]+)\s*㎡/) || g(/建筑面积[为是：:]\s*([\d.]+)\s*平方米/) || g(/产权面积[^0-9]*([\d.]+)\s*㎡/) || g(/([\d.]+)\s*㎡/) || g(/面积[为是：:]\s*([\d.]+)/),
    start: g(/起拍价[^0-9]*¥?\s*([\d,]+)/) || g(/变卖价[^0-9]*¥?\s*([\d,]+)/) || g(/变卖预缴款[^0-9]*¥?\s*([\d,]+)/),
    assess: g(/评估价[^0-9]*¥?\s*([\d,.]+)/),
    court: court,
    startTime: startT,
    endTime: endT,
    round: round,
    sold: sold,
    deal: g(/拍下价[^0-9]*([\d,]+)/),
    bids: g(/竞买记录\s*\(\s*(\d+)\s*\)/),
    signups: g(/(\d+)\s*人报名/)
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

def scroll_bottom():
    run(["evaluate", "--session", SESSION,
         "window.scrollTo(0, document.body.scrollHeight); 'scrolled'"])

KEY_FIELDS = ['起拍价格', '评估价', '面积/㎡', '拍卖时间', '处置法院', '发拍次数']

def missing_fields(d):
    return [k for k in KEY_FIELDS if k not in d or d[k] in (None, '', '未找到')]

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    todo = [(i, x) for i, x in enumerate(recs) if missing_fields(x)]
    print(f"最后一轮补采: {len(todo)} 条", flush=True)
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        miss = missing_fields(rec)
        print(f"[{n}/{len(todo)}] 缺{miss} | {url[-30:]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(12)
        d = ev()
        if d is None or (d.get('area') is None and d.get('assess') is None and d.get('start') is None):
            scroll_bottom()
            time.sleep(3)
            d = ev()
        if not d:
            print("  ⚠ 仍失败", flush=True)
            continue
        changed = False
        for k, dk in [('面积/㎡', 'area'), ('起拍价格', 'start'), ('评估价', 'assess'), ('拍卖时间', 'endTime'), ('处置法院', 'court'), ('发拍次数', 'round')]:
            if rec.get(k) in (None, '', '未找到'):
                v = d.get(dk)
                if v not in (None, ''):
                    if dk == 'endTime':
                        rec[k] = v
                    elif dk == 'start':
                        rec[k] = float(v.replace(',', ''))
                    elif dk == 'assess':
                        rec[k] = float(v.replace(',', ''))
                    elif dk == 'area':
                        rec[k] = float(v)
                    else:
                        rec[k] = v
                    changed = True
        if rec.get('拍卖时间') in (None, '', '未找到') and d.get('startTime'):
            rec['拍卖时间'] = d['startTime'] + ':00'
            changed = True
        if d.get('sold') and rec.get('是否成交') in (None, '', '待核验'):
            rec['是否成交'] = d['sold']
        if d.get('deal') and rec.get('成交金额') in (None, 0):
            rec['成交金额'] = float(d['deal'].replace(',', ''))
        if d.get('bids') and rec.get('竞买记录') is None:
            rec['竞买记录'] = int(d['bids'])
        if d.get('signups') and rec.get('报名人数') is None:
            rec['报名人数'] = int(d['signups'])
        # 仍缺的标记未找到
        left = missing_fields(rec)
        for k in left:
            rec[k] = '未找到'
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
        print(f"    -> 起拍={rec.get('起拍价格')} 面积={rec.get('面积/㎡')} 评估={rec.get('评估价')}", flush=True)
    # 最终统计
    miss = {}
    for k in KEY_FIELDS:
        miss[k] = sum(1 for x in recs if x.get(k) in (None, '', '未找到'))
    print(f"\n最终缺失: {miss}")

if __name__ == '__main__':
    main()
