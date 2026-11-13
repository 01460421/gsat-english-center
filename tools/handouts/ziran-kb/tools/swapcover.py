import sys
from pypdf import PdfReader, PdfWriter
f, cov = sys.argv[1], sys.argv[2]
w = PdfWriter(clone_from=f)
c = PdfReader(cov).pages[0]
w.insert_page(c, 0)
w.remove_page(1)
tmp = f + '.tmp'
with open(tmp, 'wb') as o: w.write(o)
import os; os.replace(tmp, f)
