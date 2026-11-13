# Post-process a PDF: re-encode near-grayscale RGB images as DeviceGray (lossless).
import sys, numpy as np
from pypdf import PdfReader, PdfWriter
src, dst = sys.argv[1], sys.argv[2]
w = PdfWriter(clone_from=src)
seen = set(); conv = 0; tot = 0
for page in w.pages:
    for img in page.images:
        ref = img.indirect_reference
        key = (ref.idnum if ref is not None else id(img))
        if key in seen: continue
        seen.add(key); tot += 1
        try:
            im = img.image
        except Exception:
            continue
        if im.mode != 'RGB': continue
        a = np.asarray(im).astype(np.int16)
        if (a.max(2) - a.min(2)).max() < 40:
            img.replace(im.convert('L'))
            conv += 1
w.compress_identical_objects(remove_identicals=True, remove_orphans=True)
with open(dst, 'wb') as f: w.write(f)
print('images', tot, 'gray', conv)
