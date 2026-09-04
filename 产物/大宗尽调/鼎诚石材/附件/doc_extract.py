# -*- coding: utf-8 -*-
"""从 legacy .doc (OLE) 提取纯文本：解析 FIB + Clx + 片段表(Pcdt)。"""
import olefile, struct, sys

def extract_doc_text(path):
    ole = olefile.OleFileIO(path)
    word = ole.openstream('WordDocument').read()
    # FIB: 决定使用 0Table 还是 1Table
    flags = struct.unpack('<H', word[0x0A:0x0C])[0]
    tblname = '1Table' if (flags & 0x0200) else '0Table'
    table = ole.openstream(tblname).read()
    # fcClx @ 0x01A2, lcbClx @ 0x01A6
    fcClx = struct.unpack('<I', word[0x01A2:0x01A6])[0]
    lcbClx = struct.unpack('<I', word[0x01A6:0x01AA])[0]
    clx = table[fcClx:fcClx + lcbClx]
    i = 0
    out = []
    while i < len(clx):
        typ = clx[i]
        if typ == 0x01:  # Prc
            lcb = struct.unpack('<I', clx[i+1:i+5])[0]
            i += 5 + lcb
        elif typ == 0x02:  # Pcdt
            lcb = struct.unpack('<I', clx[i+1:i+5])[0]
            plc = clx[i+5:i+5+lcb]
            n = (lcb - 4) // 12
            cps = [struct.unpack('<I', plc[j*4:j*4+4])[0] for j in range(n+1)]
            pcds = plc[4*(n+1):]
            for j in range(n):
                pcd = pcds[j*8:j*8+8]
                fc_raw = struct.unpack('<I', pcd[2:6])[0]
                compressed = bool(fc_raw & 0x40000000)
                offset = fc_raw & 0x3FFFFFFF
                cp_start, cp_end = cps[j], cps[j+1]
                if compressed:
                    start = offset // 2
                    raw = word[start:start + (cp_end - cp_start)]
                    out.append(raw.decode('cp1252', errors='replace'))
                else:
                    start = offset
                    raw = word[start:start + (cp_end - cp_start) * 2]
                    out.append(raw.decode('utf-16-le', errors='replace'))
            break
        else:
            break
    ole.close()
    return ''.join(out)

if __name__ == '__main__':
    p = sys.argv[1]
    t = extract_doc_text(p)
    # 段落化：把多余空白压缩
    lines = [ln.strip() for ln in t.split(chr(13))]
    lines = [ln for ln in lines if ln]
    open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(lines))
    print('提取字符数:', len(t), ' 非空行:', len(lines))
