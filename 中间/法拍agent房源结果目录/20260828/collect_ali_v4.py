#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v4：对字段缺失记录重新提取（修正调查表面积格式 + 变卖价=起拍价）"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "kywd"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

def run(args, timeout=90):
    try:
        r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        return r.stdout
    except Exception as e:
        return f"ERR:{e}"

def snap():
    return run(["snapshot", "--session", SESSION])

KEY_FIELDS = ['起拍价格', '评估价', '面积/㎡', '拍卖时间', '处置法院', '发拍次数']

def missing_fields(d):
    miss = [k for k in KEY_FIELDS if k not in d or d[k] in (None, '', '未找到')]
    return miss

def extract(text):
    """从快照提取字段，兼容调查表面积和变卖格式"""
    d = {}
    # 标题/轮次
    m = re.search(r'heading "([一二三拍变卖]+) ([^"]+)"', text)
    if m:
        d['发拍次数'] = m.group(1)
        d['标的名称'] = m.group(2).strip()
    # 起拍价
    m = re.search(r'起拍价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['起拍价格'] = float(m.group(1).replace(',', ''))
    # 变卖价（变卖标的起拍=变卖价）
    m = re.search(r'变卖价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m and '起拍价格' not in d: d['起拍价格'] = float(m.group(1).replace(',', ''))
    m = re.search(r'变卖预缴款\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m and '起拍价格' not in d: d['起拍价格'] = float(m.group(1).replace(',', ''))
    # 评估价
    m = re.search(r'评估价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['评估价'] = float(m.group(1).replace(',', ''))
    # 面积：调查表格式 cell "建筑面积（平方米）" 后 cell "132.43"
    m = re.search(r'建筑面积[（(]平方米[）)]"\s*\n\s*cell "([\d.]+)"', text)
    if m: d['面积/㎡'] = float(m.group(1))
    # 面积：拍品介绍"建筑面积为X平方米"
    m = re.search(r'建筑面积[为是：:]\s*([\d.]+)\s*平方米', text)
    if m and '面积/㎡' not in d: d['面积/㎡'] = float(m.group(1))
    # 面积：通用 "X平方米"
    m = re.search(r'([\d.]+)\s*平方米', text)
    if m and '面积/㎡' not in d: d['面积/㎡'] = float(m.group(1))
    # 时间
    m = re.search(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})', text)
    if m: d['拍卖时间'] = m.group(1)
    m = re.search(r'\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})开拍\)', text)
    if m and '拍卖时间' not in d: d['拍卖时间'] = f"{m.group(1)} {m.group(2)}:00"
    # 状态
    if '本场已成交' in text or ('拍下价' in text and re.search(r'拍下价[\s\S]{0,120}?[\d,]+\s*元', text)):
        d['是否成交'] = '是'
    elif '本场已流拍' in text:
        d['是否成交'] = '否'
    elif '本场已结束' in text:
        d['是否成交'] = '待核验'
    elif '开拍' in text or '即将开始' in text:
        d['是否成交'] = '未开始'
    # 拍下价
    m = re.search(r'StaticText "拍下价"\s*\n\s*paragraph\s*\n\s*StaticText "([\d,]+)"', text)
    if m: d['成交金额'] = float(m.group(1).replace(',', ''))
    # 出价/报名
    m = re.search(r'竞买记录\s*\(\s*(\d+)\s*\)', text)
    if m: d['竞买记录'] = int(m.group(1))
    m = re.search(r'(\d+)\s*人报名', text)
    if m: d['报名人数'] = int(m.group(1))
    # 法院
    courts = re.findall(r'button "([^"]*?人民法院)"', text)
    if not courts:
        courts = re.findall(r'([\u4e00-\u9fa5]{2,}(?:人民法院|法院))', text)
    if courts: d['处置法院'] = courts[0]
    return d

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    # 需要补采的记录
    todo = [(i, x) for i, x in enumerate(recs) if missing_fields(x)]
    print(f"需补采: {len(todo)} 条", flush=True)
    fixed = 0
    still_miss = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        miss = missing_fields(rec)
        print(f"[{n}/{len(todo)}] 缺{miss} | {url[-35:]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(8)
        text = snap()
        if len(text) < 300:
            time.sleep(6)
            text = snap()
        d = extract(text)
        changed = False
        for k in KEY_FIELDS:
            v = d.get(k)
            if v not in (None, '', '未找到') and (rec.get(k) in (None, '', '未找到') or k not in rec):
                rec[k] = v
                changed = True
        # 附带更新：状态/成交金额/出价/报名/标的名称
        for k in ['是否成交', '成交金额', '竞买记录', '报名人数', '标的名称', '发拍次数']:
            v = d.get(k)
            if v not in (None, '', 0) and rec.get(k) in (None, '', 0, '待核验'):
                rec[k] = v
                changed = True
        # 变卖标的：起拍价=变卖价
        if rec.get('发拍次数') == '变卖' and rec.get('起拍价格') is None:
            rec['起拍价格'] = d.get('起拍价格')
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
        if changed:
            fixed += 1
        left = missing_fields(rec)
        if left:
            still_miss += 1
        print(f"    -> 起拍={rec.get('起拍价格')} 面积={rec.get('面积/㎡')} 评估={rec.get('评估价')} | 剩余缺{left if left else '无'}", flush=True)
    print(f"\n完成！修复 {fixed} 条，仍缺 {still_miss} 条")

if __name__ == '__main__':
    main()
