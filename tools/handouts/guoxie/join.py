import sys
from pypdf import PdfReader, PdfWriter

cover, body, out = sys.argv[1:4]
w = PdfWriter(clone_from=body)
w.insert_page(PdfReader(cover).pages[0], 0)
w.add_metadata({'/Title': '國寫素材庫', '/Author': '學測英文中心'})
w.write(out)
