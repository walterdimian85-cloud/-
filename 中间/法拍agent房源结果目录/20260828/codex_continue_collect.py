#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""codex 接续：browser-skill 批量采集阿里标的（福州即将开始，13条待处理）"""
import subprocess, json, re, time, sys, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "lndu"
OUT = r"E:\dsh\中间\法拍agent房源结果目录\20260828\20260828_browser-skill补采记录.json"
PROGRESS = r"E:\dsh\中间\法拍agent房源结果目录\20260828\20260828_browser-skill采集进度.json"

def run(args, timeout=60):
    r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    return r.stdout

def tab_open(url):
    run(["tab", "create", "--session", SESSION, "--url", url])
    time.sleep(5)

def snap():
    out = run(["snapshot", "--session", SESSION])
    return out

def extract(text):
    """从snapshot文本提取关键字段"""
    d = {}
    # 标题/轮次
    m = re.search(r'heading "([一二三拍变卖]+) ([^"]+)"', text)
    if m:
        d['轮次'] = m.group(1)
        d['标的名称'] = m.group(2).strip()
    # 起拍价
    m = re.search(r'起拍价\s*:\s*¥([\d,]+)', text)
    if m: d['起拍价格'] = int(m.group(1).replace(',', ''))
    # 评估价
    m = re.search(r'评估价\s*:\s*¥([\d,]+(?:\.\d+)?)', text)
    if m: d['评估价'] = float(m.group(1).replace(',', ''))
    # 变卖预缴款
    m = re.search(r'变卖预缴款\s*:\s*¥([\d,]+)', text)
    if m: d['变卖预缴'] = int(m.group(1).replace(',', ''))
    # 面积
    m = re.search(r'建筑面积[：:]\s*([\d.]+)平方米', text)
    if m: d['面积'] = float(m.group(1))
    # 拍卖时间
    m = re.search(r'\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})开拍\)', text)
    if m: d['拍卖时间'] = f"{m.group(1)} {m.group(2)}:00"
    # 结束时间
    m = re.search(r'结束时间\s*(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})', text)
    if m: d['结束时间'] = m.group(1)
    # 本场状态
    if '本场已结束' in text:
        d['状态'] = '已结束'
    elif '本场已流拍' in text:
        d['状态'] = '流拍'
    elif '本场已成交' in text:
        d['状态'] = '成交'
    elif '开拍' in text:
        d['状态'] = '即将开始'
    # 法院（多个）
    courts = re.findall(r'button "([^"]*人民法院)"', text)
    if courts:
        d['处置法院'] = courts[0]
    # 区域（从名称推断）
    m = re.search(r'(福州市|泉州市)([^区县市]+[区县市])', d.get('标的名称', ''))
    if m: d['区域'] = m.group(2)
    return d

# 待处理链接
pending = [
    "https://sf-item.taobao.com/sf_item/1078857153285.htm",
    "https://sf-item.taobao.com/sf_item/1077807222550.htm",
    "https://sf-item.taobao.com/sf_item/1077806782709.htm",
    "https://sf-item.taobao.com/sf_item/1077798202336.htm",
    "https://sf-item.taobao.com/sf_item/1076937051741.htm",
    "https://sf-item.taobao.com/sf_item/1079849072567.htm",
    "https://sf-item.taobao.com/sf_item/1078844425988.htm",
    "https://sf-item.taobao.com/sf_item/1077781954826.htm",
    "https://sf-item.taobao.com/sf_item/1077781782009.htm",
    "https://sf-item.taobao.com/sf_item/1079776852586.htm",
    "https://sf-item.taobao.com/sf_item/1076857615108.htm",
    "https://sf-item.taobao.com/sf_item/1076844007468.htm",
    "https://sf-item.taobao.com/sf_item/1076842995306.htm",
]

# 读取已有记录（避免重复）
existing = []
if os.path.exists(OUT):
    with open(OUT, encoding='utf-8') as f:
        existing = json.load(f)
done_links = set(x.get('网站链接', '') for x in existing)

results = list(existing)
start_idx = 0
# 从进度文件的"当前链接"开始（接续）
with open(PROGRESS, encoding='utf-8') as f:
    prog = json.load(f)
cur_link = prog.get('当前链接', '')
# 第1条(1078857153285)已手动完成，从第2条开始
if cur_link == "https://sf-item.taobao.com/sf_item/1078857153285.htm":
    cur_link = "https://sf-item.taobao.com/sf_item/1077807222550.htm"
if cur_link in pending:
    start_idx = pending.index(cur_link)
    print(f"接续自: {cur_link} (index {start_idx})")

for i in range(start_idx, len(pending)):
    url = pending[i]
    if url in done_links:
        print(f"[跳过] 已完成 {url}")
        continue
    print(f"\n[{i+1}/{len(pending)}] 采集 {url}")
    tab_open(url)
    text = snap()
    d = extract(text)
    d['网站链接'] = url
    d['城市'] = '福州市' if '福州市' in d.get('标的名称', '') else '泉州市'
    d['平台'] = '阿里资产'
    print(f"  名称: {d.get('标的名称', '?')[:40]}")
    print(f"  起拍: {d.get('起拍价格', '?')} 评估: {d.get('评估价', '?')} 面积: {d.get('面积', '?')}")
    print(f"  法院: {d.get('处置法院', '?')} 时间: {d.get('拍卖时间', d.get('结束时间', '?'))} 状态: {d.get('状态', '?')}")
    results.append(d)
    done_links.add(url)
    # 保存进度
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    prog['当前链接'] = url
    with open(PROGRESS, 'w', encoding='utf-8') as f:
        json.dump(prog, f, ensure_ascii=False, indent=2)

print(f"\n完成！共 {len(results)} 条记录")
