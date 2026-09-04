# -*- coding: utf-8 -*-
"""OMo2Uu 链接列修复 2026-09-04：脚本错把链接写入 V 列，正表头 M 列=链接(空)。
修复：M 列 = 已有M值 > 未到开拍(J>当天)且 V 有URL 则挪到 M；V 列暂不动。"""
import sys, os, re
os.environ['PYTHONUTF8'] = '1'
sys.path.insert(0, r'E:\归档\法拍\后台数据\脚本')
import feishu_sync as F

def jtime(v):
    m = re.search(r'(\d+)月(\d+)日', v or '')
    return (int(m.group(1)), int(m.group(2))) if m else None

today = (9, 4)
rows = F.csv_get('OMo2Uu', 'A1:Z120')
data = [r for r in rows[1:] if r and (r[0] or '').strip()]
mvals = []
kept = moved = 0
for r in data:
    mc = (r[12] if len(r) > 12 else '').strip()
    if mc.startswith('http'):
        mvals.append([mc]); kept += 1; continue
    vc = (r[21] if len(r) > 21 else '').strip()
    jt = jtime(r[9]) if len(r) > 9 else None
    if jt and jt > today and vc.startswith('http'):
        mvals.append([vc]); moved += 1
    else:
        mvals.append([mc])
print('数据行:', len(data), '| M已有保留:', kept, '| V挪至M(未到开拍):', moved)
if moved:
    res = F.csv_put('OMo2Uu', 'M2', mvals)
    print('M列整写:', res)
else:
    print('无需挪动')
print('DONE')
