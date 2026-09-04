#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按用户筛选链接重抓四路列表（sort=504上新/sort=600结束, hPurpose=1,2,3）"""
import subprocess, json, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "kywd"
OUT = r"E:\dsh\中间\法拍agent房源结果目录\20260828\ali_list_links_v2.json"

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
        if line.startswith('[') or line.startswith('{'):
            try:
                return json.loads(line)
            except:
                continue
    return None

def base_url(city, sort, status=None, page=1):
    loc = {"泉州": "350500", "福州": "350100"}[city]
    su = f"&statusOrders=%5B%22{status}%22%5D" if status else ""
    return (f"https://zc-paimai.taobao.com/wow/pm/default/pc/4b80fa?"
            f"locationCodes=%5B%22{loc}%22%5D&sort={sort}"
            f"&hPurpose=%5B%221%22,%222%22,%223%22%5D&houseFrom=%5B%221%22%5D"
            f"&page={page}{su}")

def fetch(city, sort, status, max_pages=30, stop_hw=None):
    """抓列表，返回链接列表；若找到 stop_hw 则停止（含该条）"""
    all_links = []
    seen = set()
    hw_idx = None
    for page in range(1, max_pages + 1):
        url = base_url(city, sort, status, page)
        run(["navigate", "--session", SESSION, url])
        time.sleep(8)
        data = ev("JSON.stringify(Array.from(document.querySelectorAll('a')).filter(a=>a.href.includes('sf_item')&&a.href.includes('search-list')).map(a=>({h:a.href.split('?')[0],t:(a.innerText||'').trim().slice(0,90)})))")
        if not data:
            print(f"  [page {page}] 无数据，停止", flush=True)
            break
        for x in data:
            if x['h'] not in seen:
                seen.add(x['h'])
                all_links.append(x)
                if stop_hw and stop_hw in x['h']:
                    hw_idx = len(all_links) - 1
                    print(f"  ✓ 高水位 {stop_hw} 出现在第 {len(all_links)} 条（page {page}）", flush=True)
                    return all_links, hw_idx
        print(f"  [page {page}] {len(data)}条, 累计 {len(all_links)}", flush=True)
        if len(data) < 50:
            print("  列表结束", flush=True)
            break
    return all_links, hw_idx

result = {}
# 1. 泉州上新 sort=504，高水位 1076890443075
print("=== 泉州上新 (sort=504) ===", flush=True)
links, idx = fetch("泉州", 504, None, stop_hw="1076890443075")
result["泉州上新"] = {"links": links, "高水位位置": idx}
print(f"  泉州上新: {len(links)}条, 高水位位置={idx}\n", flush=True)

# 2. 泉州结束 sort=600 statusOrders=2，高水位 1073753548560
print("=== 泉州结束 (sort=600) ===", flush=True)
links, idx = fetch("泉州", 600, 2, stop_hw="1073753548560")
result["泉州结束"] = {"links": links, "高水位位置": idx}
print(f"  泉州结束: {len(links)}条, 高水位位置={idx}\n", flush=True)

# 3. 福州结束 sort=600 statusOrders=2，高水位 1070408920851
print("=== 福州结束 (sort=600) ===", flush=True)
links, idx = fetch("福州", 600, 2, stop_hw="1070408920851")
result["福州结束"] = {"links": links, "高水位位置": idx}
print(f"  福州结束: {len(links)}条, 高水位位置={idx}\n", flush=True)

# 4. 福州上新 sort=504，高水位 1077166530125（在第二页）
print("=== 福州上新 (sort=504) ===", flush=True)
links, idx = fetch("福州", 504, None, stop_hw="1077166530125")
result["福州上新"] = {"links": links, "高水位位置": idx}
print(f"  福州上新: {len(links)}条, 高水位位置={idx}\n", flush=True)

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=1)
print("已保存:", OUT)
for k, v in result.items():
    print(f"{k}: {len(v['links'])}条, 高水位位置={v['高水位位置']}")
