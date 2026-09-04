#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里四路详情采集 v3：修正提取正则，支持补采已采但字段缺失的记录"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "kywd"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
LINKS_FILE = os.path.join(DIR, "ali_list_links_v2.json")
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

def is_complete(d):
    """关键字段是否齐全"""
    miss = [k for k in KEY_FIELDS if k not in d or d[k] in (None, '', '未找到')]
    return len(miss) == 0, miss

def extract(text):
    d = {}
    # 标题/轮次
    m = re.search(r'heading "([一二三拍变卖]+) ([^"]+)"', text)
    if m:
        d['发拍次数'] = m.group(1)
        d['标的名称'] = m.group(2).strip()
    # 起拍价
    m = re.search(r'起拍价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['起拍价格'] = float(m.group(1).replace(',', ''))
    # 变卖预缴款
    m = re.search(r'变卖预缴款\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['变卖预缴款'] = float(m.group(1).replace(',', ''))
    # 评估价
    m = re.search(r'评估价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['评估价'] = float(m.group(1).replace(',', ''))
    # 面积（拍品介绍"建筑面积为X平方米"）
    m = re.search(r'建筑面积[为是：:]\s*([\d.]+)\s*平方米', text)
    if m: d['面积/㎡'] = float(m.group(1))
    # 结束时间
    m = re.search(r'(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})', text)
    if m: d['拍卖时间'] = m.group(1)
    # 开拍时间（即将开始）
    m = re.search(r'\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})开拍\)', text)
    if m and '拍卖时间' not in d:
        d['拍卖时间'] = f"{m.group(1)} {m.group(2)}:00"
    # 拍下价（成交）
    m = re.search(r'StaticText "拍下价"\s*\n\s*paragraph\s*\n\s*StaticText "([\d,]+)"', text)
    if m: d['成交金额'] = float(m.group(1).replace(',', ''))
    # 状态
    if '本场已成交' in text or ('拍下价' in text and re.search(r'拍下价[\s\S]{0,120}?[\d,]+\s*元', text)):
        d['是否成交'] = '是'
    elif '本场已流拍' in text:
        d['是否成交'] = '否'
    elif '本场已结束' in text:
        d['是否成交'] = '待核验'
    elif '开拍' in text or '即将开始' in text:
        d['是否成交'] = '未开始'
    # 出价
    m = re.search(r'竞买记录\s*\(\s*(\d+)\s*\)', text)
    if m: d['竞买记录'] = int(m.group(1))
    # 报名
    m = re.search(r'(\d+)\s*人报名', text)
    if m: d['报名人数'] = int(m.group(1))
    # 法院
    courts = re.findall(r'button "([^"]*?人民法院)"', text)
    if not courts:
        courts = re.findall(r'([\u4e00-\u9fa5]{2,}(?:人民法院|法院))', text)
    if courts: d['处置法院'] = courts[0]
    return d

def city_of(name):
    name = str(name or '')
    if '泉州' in name: return '泉州市'
    if '福州' in name: return '福州市'
    for r in ['闽侯','福清','连江','罗源','闽清','永泰','平潭','鼓楼','台江','仓山','晋安','马尾','长乐']:
        if r in name: return '福州市'
    for r in ['安溪','惠安','永春','德化','南安','晋江','石狮','鲤城','丰泽','洛江','泉港','台商']:
        if r in name: return '泉州市'
    return ''

def region_of(name):
    name = str(name or '')
    FZ = {'鼓楼':'鼓楼区','台江':'台江区','仓山':'仓山区','晋安':'晋安区','马尾':'马尾区','长乐':'长乐区','福清':'福清市','闽侯':'闽侯县','连江':'连江县','罗源':'罗源县','闽清':'闽清县','永泰':'永泰县','平潭':'平潭县'}
    QZ = {'鲤城':'鲤城区','丰泽':'丰泽区','洛江':'洛江区','泉港':'泉港区','晋江':'晋江市','石狮':'石狮市','南安':'南安市','惠安':'惠安县','安溪':'安溪县','永春':'永春县','德化':'德化县','台商':'台商投资区'}
    for k, v in FZ.items():
        if re.search(rf'{k}(?:区|县|市)', name): return v
    for k, v in QZ.items():
        if re.search(rf'{k}(?:区|县|市)', name): return v
    return ''

def main():
    # 读取列表（到高水位为止）
    with open(LINKS_FILE, encoding='utf-8') as f:
        lists_raw = json.load(f)
    lists = {}
    for road, info in lists_raw.items():
        hw = info.get('高水位位置', len(info['links']) - 1)
        lists[road] = info['links'][:hw + 1]

    # 读取已有记录
    existing = []
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            existing = json.load(f)
    rec_by_link = {}
    for x in existing:
        rec_by_link[x.get('网站链接', '').split('?')[0]] = x

    # 待处理队列：未采的 + 已采但字段缺失的
    queue = []  # (road, url, title, need_refresh)
    for road, links in lists.items():
        for item in links:
            url = item['h'].split('?')[0]
            t = item.get('t', '')
            # 排除纯车位
            if re.search(r'车位|车库|储藏间|柴火房', t) and not re.search(r'房产|住宅|单元|室\b|店面|商铺|商场|办公', t):
                continue
            if url in rec_by_link:
                ok, miss = is_complete(rec_by_link[url])
                if ok:
                    continue  # 已采且完整
                queue.append((road, url, t, True))
            else:
                queue.append((road, url, t, False))

    print(f"待处理: {len(queue)} 条（含已采缺字段需补）", flush=True)
    new_count = 0
    fixed_count = 0
    for i, (road, url, title, need_refresh) in enumerate(queue, 1):
        tag = '重采' if need_refresh else '新采'
        print(f"[{i}/{len(queue)}][{tag}] {url[-35:]} | {title.split(chr(10))[0][:25]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(8)
        text = snap()
        if len(text) < 200:
            print("  ⚠ 页面未加载，重试...", flush=True)
            time.sleep(6)
            text = snap()
        d = extract(text)
        if not d.get('标的名称'):
            d['标的名称'] = title.split('\n')[0]
        d['网站链接'] = url
        d['平台'] = '阿里资产'
        d['城市'] = city_of(d.get('标的名称'))
        d['区域'] = region_of(d.get('标的名称'))
        d['所在省份'] = '福建省'
        d.setdefault('小区名称（仅供参考）', '')
        d.setdefault('标的类型', '')
        d.setdefault('是否成交', '')
        d.setdefault('成交金额', 0)
        d.setdefault('竞买记录', None)
        d.setdefault('报名人数', None)
        d.setdefault('备注', '')
        d.setdefault('_fieldEvidence', {})
        # 合并：重采时保留已有字段，新字段覆盖
        if need_refresh and url in rec_by_link:
            old = rec_by_link[url]
            for k, v in d.items():
                if v not in (None, '', 0) or k == '网站链接':
                    old[k] = v
            rec_by_link[url] = old
            fixed_count += 1
        else:
            rec_by_link[url] = d
            new_count += 1
        # 保存
        all_recs = list(rec_by_link.values())
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(all_recs, f, ensure_ascii=False, indent=1)
        ok, miss = is_complete(d)
        print(f"    -> {d.get('标的名称','')[:30]} | 起拍={d.get('起拍价格')} 面积={d.get('面积/㎡')} 状态={d.get('是否成交')} | 缺={miss if miss else '无'}", flush=True)

    print(f"\n完成！新采 {new_count}，修复 {fixed_count}，共 {len(rec_by_link)} 条")

if __name__ == '__main__':
    main()
