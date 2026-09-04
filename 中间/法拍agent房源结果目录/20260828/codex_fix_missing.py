#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补采缺失面积/起拍价：重新打开页面，滚动到公告区抓取"""
import subprocess, json, re, time

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "lndu"
OUT = r"E:\dsh\中间\法拍agent房源结果目录\20260828\20260828_browser-skill补采记录.json"

def run(args, timeout=60):
    r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    return r.stdout

def snap():
    return run(["snapshot", "--session", SESSION])

def tab_open(url):
    run(["tab", "create", "--session", SESSION, "--url", url])
    time.sleep(5)

def extract_area(text):
    """多模式抓面积"""
    pats = [
        r'建筑面积[：:]\s*([\d.]+)\s*平方米',
        r'总建筑面积[：:]\s*([\d.]+)\s*平方米',
        r'建筑面积约\s*([\d.]+)\s*平方米',
        r'面积[：:]\s*([\d.]+)\s*平方米',
        r'(\d+(?:\.\d+)?)\s*平方米',
        r'面积\s*[\d.]+\s*㎡',
    ]
    for p in pats:
        m = re.search(p, text)
        if m:
            return float(m.group(1))
    return None

def extract_start(text):
    pats = [
        r'起拍价\s*:\s*¥([\d,]+)',
        r'变卖预缴款\s*:\s*¥([\d,]+)',
        r'变卖价\s*:\s*¥([\d,]+)',
    ]
    for p in pats:
        m = re.search(p, text)
        if m:
            return int(m.group(1).replace(',', ''))
    return None

with open(OUT, encoding='utf-8') as f:
    records = json.load(f)

fixed = 0
for rec in records[33:]:
    url = rec['网站链接']
    miss_area = rec.get('面积/㎡') is None
    miss_start = rec.get('起拍价格') is None
    if not miss_area and not miss_start:
        continue
    print(f"\n补采: {rec['标的名称'][:35]}")
    tab_open(url)
    text = snap()
    # 先不滚动直接抓
    area = extract_area(text)
    start = extract_start(text)
    if area is None and (miss_area):
        # 滚动到底部加载公告区
        run(["press", "--session", SESSION, "End"])
        time.sleep(2)
        text2 = snap()
        area = extract_area(text2)
        if area is None:
            # 再滚一次
            run(["press", "--session", SESSION, "End"])
            time.sleep(2)
            text2 = snap()
            area = extract_area(text2)
    if miss_start and start is None:
        start = extract_start(text)
    if miss_area and area is not None:
        rec['面积/㎡'] = area
        rec['_fieldEvidence'] = rec.get('_fieldEvidence', {})
        rec['_fieldEvidence']['面积/㎡'] = {'值': area, '来源': '补采滚动公告区', '读取时间': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'), '置信度': '高'}
        print(f"  ✅ 面积={area}")
        fixed += 1
    if miss_start and start is not None:
        rec['起拍价格'] = start
        print(f"  ✅ 起拍价={start}")
        fixed += 1
    if area is None and miss_area:
        print(f"  ⚠️ 面积仍未获取")
    if start is None and miss_start:
        print(f"  ⚠️ 起拍价仍未获取")

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=1)
print(f"\n补采完成，修复 {fixed} 个字段")
