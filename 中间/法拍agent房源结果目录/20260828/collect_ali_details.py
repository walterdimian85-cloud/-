#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里四路详情批量采集：从 ali_list_links.json 读取链接，逐条 snapshot 采集字段
用法: python collect_ali_details.py [路名1] [路名2] ...  (默认全部)
"""
import subprocess, json, re, time, os, sys

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "stva"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
LINKS_FILE = os.path.join(DIR, "ali_list_links_v2.json")
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")
PROGRESS = os.path.join(DIR, "20260828_browser-skill采集进度.json")

def run(args, timeout=90):
    try:
        r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        return r.stdout
    except Exception as e:
        return f"ERR:{e}"

def snap():
    return run(["snapshot", "--session", SESSION])

def extract(text):
    """从 snapshot 无障碍树提取字段（兼容 codex 格式）"""
    d = {}
    # 标题/轮次：阿里标题形如 "一拍 福州市XX"
    m = re.search(r'heading "([一二三拍变卖]+) ([^"]+)"', text)
    if m:
        d['发拍次数'] = m.group(1)
        d['标的名称'] = m.group(2).strip()
    else:
        # 无 heading 时的备选：找标题文本
        m = re.search(r'"[一二三拍变卖]+ [^"]{8,}"', text)
        if m:
            d['标的名称'] = m.group(0).strip('"')
    # 起拍价/变卖预缴款
    m = re.search(r'起拍价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['起拍价格'] = float(m.group(1).replace(',', ''))
    m = re.search(r'变卖预缴款\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['变卖预缴款'] = float(m.group(1).replace(',', ''))
    # 评估价
    m = re.search(r'评估价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['评估价'] = float(m.group(1).replace(',', ''))
    # 拍下价（已成交）
    m = re.search(r'拍下价\s*:\s*¥\s*([\d,]+(?:\.\d+)?)', text)
    if m: d['成交金额'] = float(m.group(1).replace(',', ''))
    # 面积
    m = re.search(r'建筑面积[：:]\s*([\d.]+)\s*平方米', text)
    if m: d['面积/㎡'] = float(m.group(1))
    m = re.search(r'建筑总面积[：:]\s*([\d.]+)\s*平方米', text)
    if m: d['面积/㎡'] = float(m.group(1))
    m = re.search(r'([\d.]+)\s*平方米', text)
    if m and '面积/㎡' not in d: d['面积/㎡'] = float(m.group(1))
    # 开拍/结束时间
    m = re.search(r'\((\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})开拍\)', text)
    if m: d['拍卖时间'] = f"{m.group(1)} {m.group(2)}:00"
    m = re.search(r'结束时间\s*(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})', text)
    if m: d['拍卖时间'] = m.group(1)
    # 状态
    if '本场已成交' in text or '拍下价' in text:
        d['是否成交'] = '是'
    elif '本场已流拍' in text:
        d['是否成交'] = '否'
    elif '本场已结束' in text:
        d['是否成交'] = '待核验'
    elif '开拍' in text or '即将开始' in text:
        d['是否成交'] = '未开始'
    # 法院
    courts = re.findall(r'button "([^"]*?人民法院)"', text)
    if not courts:
        courts = re.findall(r'([\u4e00-\u9fa5]{2,}(?:人民法院|法院))', text)
    if courts: d['处置法院'] = courts[0]
    # 竞买记录/报名
    m = re.search(r'(\d+)\s*次出价', text)
    if m: d['竞买记录'] = int(m.group(1))
    m = re.search(r'(\d+)\s*人报名', text)
    if m: d['报名人数'] = int(m.group(1))
    return d

def norm_url(u):
    return u.split('?')[0]

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
    # 读取列表链接
    with open(LINKS_FILE, encoding='utf-8') as f:
        lists_raw = json.load(f)
    # v2 格式: {路名: {"links": [...], "高水位位置": N}}
    lists = {}
    for road, info in lists_raw.items():
        if isinstance(info, dict) and 'links' in info:
            hw = info.get('高水位位置', len(info['links']) - 1)
            lists[road] = info['links'][:hw + 1]  # 到高水位为止（含）
        else:
            lists[road] = info
    # 读取已有记录
    existing = []
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            existing = json.load(f)
    done_links = set(norm_url(x.get('网站链接', '')) for x in existing)

    # 要处理的路
    roads = sys.argv[1:] if len(sys.argv) > 1 else list(lists.keys())
    print(f"处理路: {roads}")

    results = list(existing)
    total_new = 0
    for road in roads:
        links = lists.get(road, [])
        print(f"\n=== {road}: {len(links)} 条 ===", flush=True)
        for i, item in enumerate(links, 1):
            url = norm_url(item['h'])
            if url in done_links:
                print(f"  [{i}/{len(links)}] 跳过(已采) {url[-30:]}", flush=True)
                continue
            # 排除车位（标题含车位/车库，且不是住宅附带）
            t = item.get('t', '')
            if re.search(r'车位|车库|储藏间', t) and not re.search(r'房产|住宅|单元|室\b', t):
                print(f"  [{i}/{len(links)}] 排除(车位) {t[:35]}", flush=True)
                continue
            print(f"  [{i}/{len(links)}] 采集 {url[-35:]}", flush=True)
            run(["navigate", "--session", SESSION, url])
            time.sleep(6)
            text = snap()
            if '验证' in text[:200] or 'captcha' in text.lower()[:200]:
                print("  ⚠ 疑似验证码，请求人工处理！", flush=True)
                run(["request-help", "--session", SESSION, "--reason", "疑似滑动验证码，请人工验证"])
                input("  人工验证完成后按回车继续...")
                continue
            d = extract(text)
            d['网站链接'] = url
            d['平台'] = '阿里资产'
            name = d.get('标的名称') or t.split('\n')[0]
            d['标的名称'] = name
            d['城市'] = city_of(name)
            d['区域'] = region_of(name)
            d['所在省份'] = '福建省'
            d.setdefault('小区名称（仅供参考）', '')
            d.setdefault('标的类型', '')
            d.setdefault('是否成交', '')
            d.setdefault('成交金额', 0)
            d.setdefault('竞买记录', None)
            d.setdefault('报名人数', None)
            d.setdefault('备注', '')
            d.setdefault('_fieldEvidence', {})
            results.append(d)
            done_links.add(url)
            total_new += 1
            with open(OUT, 'w', encoding='utf-8') as f:
                json.dump(results, f, ensure_ascii=False, indent=1)
            print(f"    -> {name[:30]} | 起拍={d.get('起拍价格')} 面积={d.get('面积/㎡')} 状态={d.get('是否成交')}", flush=True)

    print(f"\n完成！本次新增 {total_new} 条，共 {len(results)} 条")

if __name__ == '__main__':
    main()
