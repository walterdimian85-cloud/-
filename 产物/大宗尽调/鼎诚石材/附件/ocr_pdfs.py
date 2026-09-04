# -*- coding: utf-8 -*-
import fitz, os, tempfile
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()
base = r'E:\dsh\产物\尽调\鼎诚石材\附件'

def ocr_pdf(pdf, out_txt):
    doc = fitz.open(pdf)
    lines = []
    for pi in range(doc.page_count):
        pg = doc[pi]
        pix = pg.get_pixmap(dpi=300)
        tmp = os.path.join(tempfile.gettempdir(), f'pg_{pi}.png')
        pix.save(tmp)
        res, _ = engine(tmp)
        os.remove(tmp)
        if res:
            txt = '\n'.join([r[1] for r in res])
            lines.append(f'===== 第{pi+1}页 =====\n' + txt)
        else:
            lines.append(f'===== 第{pi+1}页 ===== (无文字)')
    open(out_txt, 'w', encoding='utf-8').write('\n\n'.join(lines))
    print(f'{os.path.basename(pdf)}: {doc.page_count}页 -> {out_txt}')

ocr_pdf(os.path.join(base, '评估补充说明函.pdf'), os.path.join(base, '补充函_OCR.txt'))
ocr_pdf(os.path.join(base, '测绘报告.pdf'), os.path.join(base, '测绘报告_OCR.txt'))
