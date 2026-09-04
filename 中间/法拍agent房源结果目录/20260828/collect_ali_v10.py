#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v10：从详情页 DOM 提取小区名称（参考codex）"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
SESSION = "qumq"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

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
        if line.startswith('{') or line.startswith('['):
            try:
                return json.loads(line)
            except:
                continue
    return None

# 从页面 DOM 提取小区名：优先找结构化字段，其次标题
JS_EXTRACT = r"""(() => {
  const t = document.body ? document.body.innerText : '';
  const title = (document.title || '').replace(/\s*[-–—]\s*司法拍卖.*$/, '');
  // 常见小区后缀
  const SUF = '花园|花苑|华庭|豪庭|明珠|名门|公馆|世家|庄园|家园|雅苑|丽景|御景|云锦|名邸|壹号|上城|悦城|香颂|尚城|澜庭|观邸|天玺|璞悦|悦府|瑞府|玺院|云庭|雅筑|书香|佳园|御苑|景苑|半岛|水岸|天地|公寓|广场|山庄|大厦|中心|新村|小区|商住楼|新苑|学府|锦城|港湾|商厦|豪园|湾|苑|府|城|里|都|座';
  // 候选：从标题找 号/里/村 之后的 小区名（后跟楼/幢/栋/单元）
  const m1 = title.match(new RegExp('(?:[号里村])(?:[0-9A-Za-z\\-]{0,4})([\\u4e00-\\u9fa5]{2,12}(?:' + SUF + '))(?=[\\d#A-Za-z\\-]{0,4}(?:楼|幢|栋|单元|期|地块))'));
  if (m1) return JSON.stringify({comm: m1[1], title: title});
  // 备选：整行匹配小区名+楼号（如 "安溪县城厢镇二环南路666号百福豪城3号楼"）
  const m2 = title.match(new RegExp('([\\u4e00-\\u9fa5]{2,12}(?:' + SUF + '))[\\d#A-Za-z\\-]{0,3}楼'));
  if (m2) return JSON.stringify({comm: m2[1], title: title});
  return JSON.stringify({comm: null, title: title});
})()"""

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    todo = [(i, x) for i, x in enumerate(recs)
            if not x.get('小区名称（仅供参考）') or x.get('小区名称（仅供参考）') in ('', '/', '未找到')]
    print(f"需补小区名: {len(todo)} 条", flush=True)
    fixed = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        print(f"[{n}/{len(todo)}] {rec.get('标的名称','')[:25]} | {url[-28:]}", flush=True)
        run(["navigate", "--session", SESSION, url])
        time.sleep(8)
        d = ev(JS_EXTRACT)
        if d and d.get('comm'):
            # 过滤明显误提取（含 街道/镇/县/区/市/路 前缀）
            c = d['comm']
            if not re.search(r'(街道|镇|县|区|市|路|街|村|里|号)', c):
                rec['小区名称（仅供参考）'] = c
                fixed += 1
                print(f"    -> {c}", flush=True)
            else:
                print(f"    ⚠ 疑似误提取: {c} | title: {d.get('title','')[:40]}", flush=True)
        else:
            print(f"    ⚠ 未提取到 | title: {d.get('title','')[:40] if d else '?'}", flush=True)
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
    miss = sum(1 for x in recs if not x.get('小区名称（仅供参考）') or x.get('小区名称（仅供参考）') in ('', '/', '未找到'))
    print(f"\n完成！修复 {fixed} 条，仍缺 {miss} 条")

if __name__ == '__main__':
    main()
