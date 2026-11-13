#!/usr/bin/env python3
"""Append back cover to each book; build cover spread (back | spine | front).
usage: python3 -I finalize30.py [first] [last]
"""
import sys, os, glob, json
from pypdf import PdfReader, PdfWriter, PageObject, Transformation

Z = '/tmp/claude-0/zhw/pkg/ziran'
MM = 72 / 25.4
S = json.load(open(f'{Z}/books30.json', encoding='utf-8'))
a, b = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (1, 30)
OUT = f'{Z}/dist/books30-out'
os.makedirs(OUT, exist_ok=True)
for n in range(a, b + 1):
    V = S['vols'][str(n)]
    tag = f"_{V['no']}_"
    src = [f for f in glob.glob(f'{Z}/dist/books30-final/*.pdf') if tag in f] or [f for f in glob.glob(f'{Z}/dist/books30/*.pdf') if tag in f]
    nn = f'{n:02d}'
    back, spine = f'{Z}/dist/books30-covers/back_{nn}.pdf', f'{Z}/dist/books30-covers/spine_{nn}.pdf'
    if not src or not os.path.exists(back):
        print('skip', n); continue
    src = src[0]
    w = PdfWriter(clone_from=src)
    if (len(w.pages) + 1) % 2:  # back cover on an even page
        w.add_blank_page(210 * MM, 297 * MM)
    w.add_page(PdfReader(back).pages[0])
    w.add_metadata({'/Title': f"學測自然知識庫 {V['no']} {V['title']}", '/Author': '穹理書房'})
    name = os.path.basename(src)
    with open(f'{OUT}/{name}', 'wb') as f: w.write(f)
    # spread
    sp = PdfReader(spine).pages[0]
    sw = float(sp.mediabox.width)
    front = PdfReader(src).pages[0]
    page = PageObject.create_blank_page(width=210 * MM * 2 + sw, height=297 * MM)
    page.merge_transformed_page(PdfReader(back).pages[0], Transformation())
    page.merge_transformed_page(sp, Transformation().translate(210 * MM, 0))
    page.merge_transformed_page(front, Transformation().translate(210 * MM + sw, 0))
    ws = PdfWriter(); ws.add_page(page)
    ws.add_metadata({'/Title': f"學測自然知識庫 {V['no']} 封面展開（封底｜書背｜封面）", '/Author': '穹理書房'})
    with open(f"{OUT}/封面展開_{V['no']}_{V['title']}.pdf", 'wb') as f: ws.write(f)
    print(n, len(w.pages), round(sw / MM, 1), 'mm')
