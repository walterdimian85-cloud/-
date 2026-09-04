#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取阿里资产四路列表链接（泉州/福州 × 即将开始/已结束）"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "stva"
OUT = r"E:\dsh\中间\法拍agent房源结果目录\20260828\ali_list_links.json"

def run(args, timeout=90):
    r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
    return r.stdout

def ev(js):
    out = run(["evaluate", "--session", SESSION, js])
    # 提取最后一行 JSON
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith('[') or line.startswith('{'):
            try:
                return json.loads(line)
            except:
                continue
    return None

def get_page(city_code, status, page):
    """获取一页链接，返回 (links, has_next)"""
    url = (f"https://zc-paimai.taobao.com/wow/pm/default/pc/4b80fa?"
           f"locationCodes=%5B%22{city_code}%22%5D&sort=600&hPurpose=%5B%221%22%5D"
           f"&houseFrom=%5B%221%22%5D&page={page}&statusOrders=%5B%22{status}%22%5D")
    run(["navigate", "--session", SESSION, url])
    time.sleep(7)
    # 提取 search-list 的链接
    data = ev("JSON.stringify(Array.from(document.querySelectorAll('a')).filter(a=>a.href.includes('sf_item')&&a.href.includes('search-list')).map(a=>({h:a.href.split('?')[0],t:(a.innerText||'').trim().slice(0,80)})))")
    if data is None:
        return [], False
    # 去重（同一标的可能多个a）
    seen = {}
    for x in data:
        h = x['h']
        if h not in seen or len(x['t']) > len(seen[h]['t']):
            seen[h] = x
    links = list(seen.values())
    # 判断是否还有下一页（链接数>=50说明满页）
    has_next = len(links) >= 50
    return links, has_next

def fetch_all(city_code, status, max_pages=15):
    all_links = []
    seen = set()
    for page in range(1, max_pages + 1):
        print(f"  [city={city_code} status={status}] page {page}...", flush=True)
        links, has_next = get_page(city_code, status, page)
        added = 0
        for x in links:
            if x['h'] not in seen:
                seen.add(x['h'])
                all_links.append(x)
                added += 1
        print(f"    本页 {len(links)} 条，新增 {added} 条（累计 {len(all_links)}）", flush=True)
        if not has_next:
            break
    return all_links

result = {}
result["泉州即将开始"] = fetch_all("350500", 1)
result["泉州已结束"] = fetch_all("350500", 2)
result["福州已结束"] = fetch_all("350100", 2)

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

for k, v in result.items():
    print(f"{k}: {len(v)} 条")
print("已保存:", OUT)
