import sys
from pypdf import PdfReader, PdfWriter

cover, body, out = sys.argv[1:4]
title = sys.argv[4] if len(sys.argv) > 4 else '學測國文知識庫'
w = PdfWriter(clone_from=body)
w.insert_page(PdfReader(cover).pages[0], 0)
w.add_metadata({'/Title': title, '/Author': '學測英文中心'})
w.write(out)
