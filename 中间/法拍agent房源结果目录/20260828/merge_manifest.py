#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合并阿里+京东 → 三产物输入 + manifest.json（交接区）"""
import json, os, re, datetime, openpyxl

DATE = "20260828"
ALI_OUT = rf"E:\dsh\中间\法拍agent房源结果目录\{DATE}\20260828_browser-skill补采记录.json"
JD_XLSX = rf"E:\dsh\中间\法拍agent房源结果目录\{DATE}（6）\20260828新增房源信息.xlsx"
HANDOFF = rf"E:\dsh\中间\WorkBuddy交接\{DATE}"
os.makedirs(HANDOFF, exist_ok=True)

# ---------- 1. 读阿里 ----------
with open(ALI_OUT, encoding='utf-8') as f:
    ali = json.load(f)

# ---------- 2. 读京东 ----------
wb = openpyxl.load_workbook(JD_XLSX, data_only=True)
jd_all = []
for sheet in ['即将开始', '成交标的', '流拍标的']:
    ws = wb[sheet]
    hdr = [ws.cell(1, c).value for c in range(1, ws.max_column + 1)]
    for r in range(2, ws.max_row + 1):
        row = {hdr[c - 1]: ws.cell(r, c).value for c in range(1, ws.max_column + 1)}
        if row.get('标的名称'):
            row['_来源表'] = sheet
            jd_all.append(row)
print(f"京东: {len(jd_all)}条")

# ---------- 3. 统一阿里字段 ----------
def to_num(v):
    """字符串/数字 → float 或 None"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '').replace('元', '')
    if s in ('', '未找到', '暂无', 'None', 'nan'):
        return None
    try:
        return float(s)
    except:
        return None

def ali_to_std(x):
    """阿里记录 → 标准主文档字段（状态按成交金额/文案推断）"""
    sold = x.get('是否成交', '')
    deal = to_num(x.get('成交金额'))
    # 状态推断：拍下价>0 → 成交；本场已流拍 → 否；已结束但无法确认 → 未成交(待核验)
    if sold == '是' or (deal and deal > 0):
        table = '成交标的'
        result = '是'
    elif sold == '否':
        table = '流拍标的'
        result = '否'
    elif sold == '待核验':
        table = '流拍标的'  # 已结束未成交，按未成交处理（备注保留证据）
        result = '否'
        x['备注'] = (x.get('备注', '') + '；本场已结束，成交状态待核验（按未成交处理）').strip('；')
    else:
        table = '即将开始'
        result = '即将开始'
    start = to_num(x.get('起拍价格'))
    assess = to_num(x.get('评估价'))
    area = to_num(x.get('面积/㎡'))
    # 计算单价
    unit = round(start / area) if start and area else None
    disc = round(start / assess, 2) if start and assess else None
    rec = {
        '所在省份': '福建省',
        '城市': x.get('城市', ''),
        '区域': x.get('区域', ''),
        '标的名称': x.get('标的名称', ''),
        '小区名称（仅供参考）': x.get('小区名称（仅供参考）', ''),
        '标的类型': x.get('标的类型', ''),
        '平台': '阿里资产',
        '发拍次数': x.get('发拍次数', ''),
        '拍卖时间': x.get('拍卖时间', ''),
        '是否成交': result,
        '处置法院': x.get('处置法院', ''),
        '面积/㎡': area,
        '起拍单价-元/㎡': unit,
        '起拍价格': start,
        '评估价(万元)': round(assess / 10000, 2) if assess else None,
        '折扣率(%)': round(disc * 100, 1) if disc else None,
        '成交金额': x.get('成交金额') or 0,
        '溢价率': None,
        '成交单价': None,
        '竞买记录': x.get('竞买记录'),
        '报名人数': x.get('报名人数'),
        '备注': x.get('备注', ''),
        '网站链接': x.get('网站链接', ''),
        '_来源表': table,
        '_来源平台': '阿里资产',
    }
    return rec

# ---------- 4. 统一京东字段 ----------
def jd_to_std(x):
    table = x.get('_来源表')
    sold = x.get('是否成交', '')
    if table == '成交标的':
        result = '是'
    elif table == '流拍标的':
        result = '否'
    else:
        result = '即将开始'
    rec = {
        '所在省份': x.get('所在省份', '福建省'),
        '城市': x.get('城市', ''),
        '区域': x.get('区域', ''),
        '标的名称': x.get('标的名称', ''),
        '小区名称（仅供参考）': x.get('小区名称（仅供参考）', ''),
        '标的类型': x.get('标的类型', ''),
        '平台': '京东拍卖',
        '发拍次数': x.get('发拍次数', ''),
        '拍卖时间': x.get('拍卖时间', ''),
        '是否成交': result,
        '处置法院': x.get('处置法院', ''),
        '面积/㎡': to_num(x.get('面积/㎡')),
        '起拍单价-元/㎡': to_num(x.get('起拍单价-元/㎡')),
        '起拍价格': to_num(x.get('起拍价格')),
        '评估价(万元)': to_num(x.get('评估价(万元)')),
        '折扣率(%)': to_num(x.get('折扣率(%)')),
        '成交金额': to_num(x.get('成交金额')) or 0,
        '溢价率': to_num(x.get('溢价率')),
        '成交单价': to_num(x.get('成交单价')),
        '竞买记录': x.get('竞买记录'),
        '报名人数': x.get('报名人数'),
        '备注': x.get('备注', ''),
        '网站链接': x.get('网站链接', ''),
        '_来源表': table,
        '_来源平台': '京东拍卖',
    }
    return rec

std = []
for x in ali:
    std.append(ali_to_std(x))
for x in jd_all:
    std.append(jd_to_std(x))

# ---------- 5. 去重（按规范化URL） ----------
def norm_url(u):
    u = str(u or '').split('?')[0].strip()
    return u

def sanitize(obj):
    """递归把 datetime/date 转字符串"""
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.strftime('%Y-%m-%d %H:%M:%S') if isinstance(obj, datetime.datetime) else obj.strftime('%Y-%m-%d')
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(i) for i in obj]
    return obj

seen = {}
dups = 0
for rec in std:
    key = norm_url(rec['网站链接'])
    if not key:
        continue
    if key in seen:
        dups += 1
        # 保留平台优先：阿里(sf-item) > 京东
        old = seen[key]
        if 'sf-item' in key:
            continue
        # 新的是阿里则替换
        if 'sf-item' in key:
            seen[key] = rec
        continue
    seen[key] = rec
merged = list(seen.values())
print(f"合并去重: {len(std)} → {len(merged)}（去重{dups}）")

# ---------- 6. 分三表 ----------
tables = {'即将开始': [], '成交标的': [], '流拍标的': []}
for rec in merged:
    t = rec['_来源表']
    tables[t].append(rec)

print("=== 分表统计 ===")
for t, rows in tables.items():
    ali_n = sum(1 for r in rows if r['_来源平台'] == '阿里资产')
    jd_n = sum(1 for r in rows if r['_来源平台'] == '京东拍卖')
    print(f"{t}: {len(rows)}（阿里{ali_n} + 京东{jd_n}）")

# ---------- 7. 输出 ----------
# 三产物输入.json
input_json = {
    "dateKey": DATE,
    "generatedAt": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00"),
    "来源": ["阿里资产 browser-skill 补采", "京东拍卖 法拍资产Agent v2.0"],
    "表": {
        "即将开始": sanitize(tables['即将开始']),
        "成交标的": sanitize(tables['成交标的']),
        "流拍标的": sanitize(tables['流拍标的']),
    },
    "缺失统计": {
        "阿里-评估价未找到": sum(1 for r in merged if r['_来源平台']=='阿里资产' and r['评估价(万元)'] is None),
        "阿里-面积未找到": sum(1 for r in merged if r['_来源平台']=='阿里资产' and r['面积/㎡'] is None),
        "阿里-起拍价未找到": sum(1 for r in merged if r['_来源平台']=='阿里资产' and r['起拍价格'] is None),
    }
}
with open(os.path.join(HANDOFF, f"{DATE}三产物输入.json"), 'w', encoding='utf-8') as f:
    json.dump(input_json, f, ensure_ascii=False, indent=1)

# manifest.json
manifest = {
    "dateKey": DATE,
    "任务": "生成三产物（HTML/Excel/飞书）",
    "数据来源": {
        "主输入": f"{DATE}三产物输入.json",
        "阿里采集记录": rf"法拍agent房源结果目录\{DATE}\20260828_browser-skill补采记录.json",
        "京东采集记录": rf"法拍agent房源结果目录\{DATE}（6）\20260828新增房源信息.xlsx",
    },
    "地区": ["泉州市", "福州市"],
    "平台": ["阿里资产", "京东拍卖"],
    "去重规则": "按规范化详情URL去重（阿里sf-item/京东paimai.jd.com），阿里优先",
    "表结构": {
        "即将开始": len(tables['即将开始']),
        "成交标的": len(tables['成交标的']),
        "流拍标的": len(tables['流拍标的']),
    },
    "缺失项": {
        "评估价未找到": sum(1 for r in merged if r['评估价(万元)'] is None),
        "面积未找到": sum(1 for r in merged if r['面积/㎡'] is None),
        "起拍价未找到": sum(1 for r in merged if r['起拍价格'] is None),
    },
    "输出路径": {
        "HTML": rf"E:\dsh\产物\html",
        "Excel": rf"E:\dsh\产物\excel\{DATE}",
    },
    "是否同步飞书": False,
    "允许覆盖": True,
    "回滚依据": "三产物输入.json 保留于交接目录，可据此重新生成",
    "采集完成说明": "阿里四路：泉州上新46/泉州结束12/福州结束21/福州上新103（到高水位止）；京东：即将开始38/成交13/流拍7",
}
with open(os.path.join(HANDOFF, "manifest.json"), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(f"\n已生成: {HANDOFF}\\manifest.json")
print(f"已生成: {HANDOFF}\\{DATE}三产物输入.json")
