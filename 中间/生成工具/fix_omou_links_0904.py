# -*- coding: utf-8 -*-
"""OMo2Uu V列补链 2026-09-04：给 V 列为空的 41 行从泉州房源上新.html 补链接。
仅补空行，已有链接不碰；HTML 源=F.HTML_DIR(E:/dsh/产物/html)。"""
import sys, os, re
os.environ['PYTHONUTF8'] = '1'
sys.path.insert(0, r'E:\归档\法拍\后台数据\脚本')
import feishu_sync as F

def norm_dist(s):
    s = (s or '').strip()
    for p in ('福建省', '泉州市'):
        if s.startswith(p):
            s = s[len(p):]
    return re.sub(r'(市|县|区)$', '', s)

def norm_num(v):
    try:
        return round(float((v or '').strip().replace(',', '')), 2)
    except Exception:
        return None

def get_url(cell):
    m = re.search(r'href=["\']([^"\']+)["\']', cell or '')
    return m.group(1) if m else ''

html = open(os.path.join(F.HTML_DIR, '泉州房源上新.html'), encoding='utf-8').read()
hrows = []
for tr in re.findall(r'<tr[^>]*>\s*(.*?)</tr>', html, re.S):
    tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)
    if len(tds) >= 16:
        hrows.append(dict(dist=norm_dist(F.clean_html(tds[1])), stage=F.clean_html(tds[2]),
                          addr=F.clean_addr(F.clean_html(tds[3])),
                          price=norm_num(F.raw_num(tds[6])), area=norm_num(F.raw_num(tds[10])),
                          url=get_url(tds[15])))
    elif len(tds) >= 13:
        hrows.append(dict(dist=norm_dist(F.clean_html(tds[1])), stage=F.clean_html(tds[2]),
                          addr=F.clean_addr(F.clean_html(tds[3])),
                          price=norm_num(F.raw_num(tds[6])), area=norm_num(F.raw_num(tds[7])),
                          url=get_url(tds[12])))

rows = F.csv_get('OMo2Uu', 'A1:Z120')
data = [r for r in rows[1:] if r and (r[0] or '').strip()]

def resolve(r):
    dist = norm_dist(r[1]); stage = (r[2] or '').strip()
    price = norm_num(r[6] if len(r) > 6 else ''); area = norm_num(r[7] if len(r) > 7 else '')
    addr = F.clean_addr(r[3] or '')
    strict = [h for h in hrows if h['dist'] == dist and h['stage'] == stage
              and h['price'] == price and h['area'] == area]
    urls = {h['url'] for h in strict if h['url']}
    if len(urls) == 1:
        return urls.pop(), 'strict'
    cands = [h for h in hrows if h['price'] == price and h['area'] == area] or \
            [h for h in hrows if h['price'] == price]
    hit = []
    for h in cands:
        a = h['addr']
        if a and (a in addr or addr in a) and len(a) >= 6 and len(addr) >= 6 and h['url']:
            hit.append(h['url'])
    urls = set(hit)
    if len(urls) == 1:
        return urls.pop(), 'addr'
    return None, 'none' if not cands else 'ambig'

# 仅补空行
tofix = []  # (行号row, 链接)
stats = {}
for i, r in enumerate(data):
    row_no = i + 2
    cur = (r[21] if len(r) > 21 else '').strip()
    if cur:
        continue  # 已有链接不动
    good, how = resolve(r)
    stats[how] = stats.get(how, 0) + 1
    if good:
        r[21] = good
        tofix.append(row_no)

print('空链待补:', sum(stats.values()), '| 匹配:', stats)
print('将补行号:', tofix[:60])

if tofix:
    # 整列写 V2（含已有行原值，仅空行补新）
    vrows = [[(r[21] if len(r) > 21 else '').strip()] for r in data]
    res = F.csv_put('OMo2Uu', 'V2', vrows)
    print('V列整写:', res)
else:
    print('无需修正')
print('DONE')
