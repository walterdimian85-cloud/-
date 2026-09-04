# -*- coding: utf-8 -*-
# 鼎诚石材破产拍卖 买方税费测算（核定简易，一组参数，不分情景）
# 口径：计税价=成交价13,354,773；包税（买卖双方税均由买方实缴）；整体打包不拆设备
P = 13354773.0  # 成交价(起拍价)

items = [
    ("增值税(简易5%)", P*0.05),
    ("附加税(增值税×10%:镇城建5%+教育3%+地教2%)", P*0.05*0.10),
    ("土地增值税(核定7%假设)", P*0.07),
    ("契税(3%)", P*0.03),
    ("印花税(双方0.05%×2=0.1%,包税)", P*0.001),
]
sw = P*0.005  # 软件服务费0.5%

lines = []
lines.append("=" * 62)
lines.append("鼎诚石材破产拍卖 · 买方税费测算（核定简易，一组参数）")
lines.append("=" * 62)
lines.append(f"{'税种':<44}{'金额(元)':>16}")
lines.append("-" * 60)
for k, v in items:
    lines.append(f"{k:<42}{v:>16,.2f}")
lines.append("-" * 60)
total_tax = sum(v for _, v in items)
lines.append(f"{'税费合计(不含软件费)':<42}{total_tax:>16,.2f}")
lines.append(f"{'软件服务费0.5%':<42}{sw:>16,.2f}")
lines.append(f"{'起拍价(给管理人)':<42}{P:>16,.2f}")
lines.append("=" * 62)
buyer = P + total_tax + sw
lines.append(f"{'买方总现金流出':<42}{buyer:>16,.2f}")
lines.append(f"{'税费占起拍价比':<42}{total_tax/P*100:>15.2f}%")
lines.append(f"{'买方总成本/起拍价':<42}{buyer/P:>15.3f}x")
lines.append("=" * 62)
lines.append("敏感性（仅土增核定率变动，其余不变，同一情景非分情景）：")
for r in (0.05, 0.07, 0.08):
    tt = P*0.05 + P*0.05*0.10 + P*r + P*0.03 + P*0.001
    lines.append(f"  土增核定 {r*100:.0f}% -> 税费合计 {tt:,.2f} / 买方总成本 {P+tt+sw:,.2f}")
lines.append("未计入(待核): 企业所得税(清算所得,依账面)、水利基金、欠费(物业/水电)、出让金/应补地价/滞纳金(第十三条兜底)")
lines.append("注: 第十三条'以相关部门最终核定为准'为兜底，本测算为核定简易估算值")

out = "\n".join(lines)
print(out)
open(r"E:\dsh\产物\尽调\鼎诚石材\税费测算_核定简易.txt", "w", encoding="utf-8").write(out)
print("\n[已存] E:\\dsh\\产物\\尽调\\鼎诚石材\\税费测算_核定简易.txt")
