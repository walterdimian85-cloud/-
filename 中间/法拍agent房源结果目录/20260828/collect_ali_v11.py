#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""阿里补采 v11：只对缺小区名且HTML库未命中的记录，从详情页提取小区名"""
import subprocess, json, re, time, os

BSK = r"C:\Users\20616\.local\bin\bsk.exe"
DIR = r"E:\dsh\中间\法拍agent房源结果目录\20260828"
OUT = os.path.join(DIR, "20260828_browser-skill补采记录.json")

JS_EXTRACT = r"""(() => {
  const title = (document.title || '').replace(/\s*[-–—]\s*司法拍卖.*$/, '').replace(/^(变卖|二拍|一拍|再次拍卖|最后一拍)\s*/, '');
  const SUF = '花园|花苑|华庭|豪庭|明珠|名门|公馆|世家|庄园|家园|雅苑|丽景|御景|云锦|名邸|壹号|上城|悦城|香颂|尚城|澜庭|观邸|天玺|璞悦|悦府|瑞府|玺院|云庭|雅筑|书香|佳园|御苑|景苑|半岛|水岸|天地|公寓|广场|山庄|大厦|中心|新村|小区|商住楼|新苑|学府|锦城|港湾|商厦|豪园|海岸|海湾|国际海岸|府|湾|苑|城|里|都|座|岛|郡|邸|域';
  // 方式1：楼/幢/栋/单元 前的中文段里找小区名（取段末尾匹配SUF的最短结果）
  const seg = title.match(/([\u4e00-\u9fa5]{2,18})(?=[\d#A-Za-z\-]{0,4}(?:楼|幢|栋|单元))/);
  if (seg) {
    const s = seg[1];
    // 从段末尾往前找小区后缀
    for (let i = s.length; i >= 2; i--) {
      const sub = s.slice(i - 2, i);
      if (new RegExp('(?:' + SUF + ')$').test(s.slice(0, i))) {
        const m = s.slice(0, i).match(new RegExp('([\u4e00-\u9fa5]{2,14}(?:' + SUF + '))$'));
        if (m) return JSON.stringify({comm: m[1], title: title});
      }
    }
  }
  // 方式2：期/地块/X区 前
  const m2 = title.match(/([\u4e00-\u9fa5]{2,14}(?:' + SUF + '))(?=[A-Z]?区|(?:一|二|三|四)期)/);
  if (m2) return JSON.stringify({comm: m2[1], title: title});
  return JSON.stringify({comm: null, title: title});
})()"""

def run(args, timeout=90):
    try:
        r = subprocess.run([BSK] + args, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        return r.stdout
    except Exception as e:
        return f"ERR:{e}"

def ev(session, js):
    out = run(["evaluate", "--session", session, js])
    for line in reversed(out.splitlines()):
        line = line.strip()
        if line.startswith('{'):
            try:
                return json.loads(line)
            except:
                continue
    return None

def main():
    with open(OUT, encoding='utf-8') as f:
        recs = json.load(f)
    todo = [(i, x) for i, x in enumerate(recs)
            if not x.get('小区名称（仅供参考）') or x.get('小区名称（仅供参考）') in ('', '/', '未找到')]
    print(f"需网页补小区名: {len(todo)} 条", flush=True)
    if not todo:
        print("无需补采"); return
    # 启动 session
    out = run(["session", "start"])
    sid = None
    for line in out.splitlines():
        s = line.strip()
        if s and not s.startswith(('@', 'SESSION', 'hint', 'error', 'details')):
            sid = s
            break
    if not sid:
        # 从 session list 拿
        out2 = run(["session", "list"])
        for line in out2.splitlines():
            parts = line.split()
            if len(parts) >= 1 and parts[0] and parts[0] not in ('SESSION', 'BROWSER'):
                sid = parts[0]
                break
    print(f"session: {sid}", flush=True)
    fixed = 0
    for n, (idx, rec) in enumerate(todo, 1):
        url = rec.get('网站链接', '')
        print(f"[{n}/{len(todo)}] {rec.get('标的名称','')[:22]} | {url[-26:]}", flush=True)
        run(["navigate", "--session", sid, url])
        time.sleep(8)
        d = ev(sid, JS_EXTRACT)
        if not d:
            time.sleep(6)
            d = ev(sid, JS_EXTRACT)
        if d and d.get('comm'):
            c = d['comm']
            # 清洗：去掉 区/县/市/镇/街道 结尾 或 路/街/巷 等地址词（不再误伤含"村/里/号"的小区名）
            c_clean = re.sub(r'^(?:福建省)?(?:福州市|泉州市)?(?:[\u4e00-\u9fa5]{2,6}(?:区|县|市|镇|街道))', '', c)
            c_clean = re.sub(r'(路|街|巷|大道)(?:[0-9A-Za-z\-]{0,6})$', '', c_clean)
            if c_clean and len(c_clean) >= 2 and not re.search(r'(区|县|市|镇|街道)$', c_clean):
                rec['小区名称（仅供参考）'] = c_clean
                fixed += 1
                print(f"    -> {c_clean}", flush=True)
            else:
                print(f"    ⚠ 清洗后无效: {c!r} | title: {d.get('title','')[:36]}", flush=True)
        else:
            print(f"    ⚠ 未提取到 | title: {d.get('title','')[:36] if d else '?'}", flush=True)
        recs[idx] = rec
        with open(OUT, 'w', encoding='utf-8') as f:
            json.dump(recs, f, ensure_ascii=False, indent=1)
    run(["session", "stop", "--all"])
    miss = sum(1 for x in recs if not x.get('小区名称（仅供参考）') or x.get('小区名称（仅供参考）') in ('', '/', '未找到'))
    print(f"\n完成！修复 {fixed} 条，仍缺 {miss} 条")

if __name__ == '__main__':
    main()
