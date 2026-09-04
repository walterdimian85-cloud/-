#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v5：用 evaluate(DOM innerText) 提取，补齐 snapshot 未渲染的字段"""
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
  let round = g(/(一拍|二拍|变卖|再次拍卖|最后一拍)/);
  const sold = t.includes('本场已成交') ? '是' : t.includes('本场已流拍') ? '否' : t.includes('本场已结束') ? '待核验' : (startT ? '未开始' : null);
  return JSON.stringify({
    title: (document.title || '').replace(/\s*[-–—]\s*司法拍卖.*$/, '').replace(/^【[^】]*】/, ''),
    area: g(/房屋建筑面积\s*([\d.]+)\s*㎡/) || g(/建筑面积[为是：:]\s*([\d.]+)\s*平方米/) || g(/([\d.]+)\s*㎡/) || g(/面积[为是：:]\s*([\d.]+)/),
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

KEY_FIELDS = ['起拍价格', '评估价', '面积/㎡', '拍卖时间', '处置法院', '发拍次数']

def missing_fields(d):
    return [k for k in KEY_FIELDS if k not in d or d[k] in (None, '', '未找到')]

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    todo = [(i, x) for i, x in enumerate(recs) if missing_fields(x)]
    print(f"需补采: {len(todo)} 条", flush=True)
    fixed = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        miss = missing_fields(rec)
        print(f"[{n}/{len(todo)}] 缺{miss} | {url[-32:]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(8)
        d = ev()
        if not d:
            print("  ⚠ evaluate 失败", flush=True)
            continue
        changed = False
        # 面积
        if rec.get('面积/㎡') in (None, '', '未找到') and d.get('area'):
            rec['面积/㎡'] = float(d['area'])
            changed = True
        # 起拍价（含变卖）
        if rec.get('起拍价格') in (None, '', '未找到') and d.get('start'):
            rec['起拍价格'] = float(d['start'].replace(',', ''))
            changed = True
        # 评估价
        if rec.get('评估价') in (None, '', '未找到') and d.get('assess'):
            rec['评估价'] = float(d['assess'].replace(',', ''))
            changed = True
        # 拍卖时间
        if rec.get('拍卖时间') in (None, '', '未找到'):
            if d.get('endTime'):
                rec['拍卖时间'] = d['endTime']
                changed = True
            elif d.get('startTime'):
                rec['拍卖时间'] = d['startTime'] + ':00'
                changed = True
        # 法院
        if rec.get('处置法院') in (None, '', '未找到') and d.get('court'):
            rec['处置法院'] = d['court']
            changed = True
        # 轮次
        if rec.get('发拍次数') in (None, '', '未找到') and d.get('round'):
            rec['发拍次数'] = d['round']
            changed = True
        # 状态/成交/出价/报名
        if d.get('sold') and rec.get('是否成交') in (None, '', '待核验'):
            rec['是否成交'] = d['sold']
        if d.get('deal') and rec.get('成交金额') in (None, 0):
            rec['成交金额'] = float(d['deal'].replace(',', ''))
        if d.get('bids') and rec.get('竞买记录') is None:
            rec['竞买记录'] = int(d['bids'])
        if d.get('signups') and rec.get('报名人数') is None:
            rec['报名人数'] = int(d['signups'])
        # 变卖：起拍=变卖价
        if rec.get('发拍次数') == '变卖' and rec.get('起拍价格') is None:
            rec['起拍价格'] = float(d['start'].replace(',', '')) if d.get('start') else None
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
        if changed:
            fixed += 1
        left = missing_fields(rec)
        print(f"    -> 起拍={rec.get('起拍价格')} 面积={rec.get('面积/㎡')} 评估={rec.get('评估价')} | 剩余缺{left if left else '无'}", flush=True)
    print(f"\n完成！修复 {fixed} 条")

if __name__ == '__main__':
    main()
