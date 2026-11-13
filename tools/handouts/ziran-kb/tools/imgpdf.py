# Make print copies of scan crops: near-grayscale images -> 8-bit grayscale PNG (same pixels size).
import sys, os, glob
import numpy as np
from PIL import Image
SRC = '/tmp/claude-0/zhw/sci/kbank/img'; DST = '/tmp/claude-0/zhw/sci/kbank/img-pdf'
n = g = 0
for f in glob.glob(SRC + '/*/*'):
    rel = os.path.relpath(f, SRC); out = os.path.join(DST, rel)
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(f): continue
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im = Image.open(f)
    if im.mode in ('RGBA', 'LA', 'P'): 
        bg = Image.new('RGB', im.size, 'white'); bg.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[3]); im = bg
    im = im.convert('RGB'); a = np.asarray(im).astype(np.int16)
    n += 1
    if (a.max(2) - a.min(2)).max() < 40:
        im = im.convert('L'); g += 1
    im.save(out, optimize=True)
print('processed', n, 'gray', g)
