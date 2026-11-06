#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
從官方 PDF 題本裁切數學題的圖，寫到 data/exams/figures-math/{考卷 id}/{圖 id}.png。

依據 data/exams/parsed-math/{id}.json 裡每張圖的 `source`：
  { "page": 7, "bbox_pt": [x0, top, x1, bottom] }   # PDF 點座標（72 pt = 1 吋），原點在左上
  可選 "mask_pt": [[x0, top, x1, bottom], ...]：bbox 內要塗白的區塊（例如圖框裡混到的題幹文字）
以 pdftoppm 200 dpi 算圖，裁掉四周空白（留 6 px），轉灰階並減色成 16 階 PNG，
再把 `file`、`width`、`height` 寫回 JSON。可重跑；圖檔進版控。

PDF 是不可信檔案：只交給 pdftoppm 算圖。請用
  python3 -I tools/crop_math_figures.py gsat-matha-115 [gsat-mathb-115 ...] | --all
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARSED = os.path.join(ROOT, "data", "exams", "parsed-math")
FIG_DIR = os.path.join(ROOT, "data", "exams", "figures-math")
DPI = 200
PAD = 6


def iter_figures(doc):
    for sec in doc["sections"]:
        for g in sec["groups"]:
            for f in g.get("figures") or []:
                yield f
            for it in g["items"]:
                for f in it.get("figures") or []:
                    yield f
                for f in (it.get("options_figures") or {}).values():
                    yield f


def crop(pdf, page, bbox, out_png, masks=()):
    from PIL import Image, ImageDraw, ImageOps  # pillow：只處理我們自己算出的 PNG
    x0, y0, x1, y1 = bbox
    s = DPI / 72.0
    with tempfile.TemporaryDirectory() as td:
        base = os.path.join(td, "p")
        subprocess.run([shutil.which("pdftoppm"), "-r", str(DPI), "-f", str(page), "-l", str(page),
                        "-x", str(int(x0 * s)), "-y", str(int(y0 * s)),
                        "-W", str(int((x1 - x0) * s)), "-H", str(int((y1 - y0) * s)),
                        "-gray", "-png", "-singlefile", pdf, base],
                       check=True, timeout=120, capture_output=True)
        im = Image.open(base + ".png").convert("L")
        for mx0, my0, mx1, my1 in masks:
            ImageDraw.Draw(im).rectangle([int((mx0 - x0) * s), int((my0 - y0) * s),
                                          int((mx1 - x0) * s), int((my1 - y0) * s)], fill=255)
        box = ImageOps.invert(im).point(lambda v: 255 if v > 24 else 0).getbbox()
        if box:
            l, t, r, b = box
            im = im.crop((max(0, l - PAD), max(0, t - PAD),
                          min(im.width, r + PAD), min(im.height, b + PAD)))
        im = im.point(lambda v: (v // 16) * 17)  # 16 階灰，壓小檔案
        os.makedirs(os.path.dirname(out_png), exist_ok=True)
        im.save(out_png, optimize=True)
        return im.width, im.height


def process(doc_id):
    path = os.path.join(PARSED, doc_id + ".json")
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    pdf = os.path.join(ROOT, doc["sources"]["paper"])
    n = 0
    for fig in iter_figures(doc):
        src = fig.get("source")
        if not src:
            continue
        rel = f"data/exams/figures-math/{doc_id}/{fig['id']}.png"
        w, h = crop(pdf, src["page"], src["bbox_pt"], os.path.join(ROOT, rel), src.get("mask_pt") or ())
        fig["file"], fig["width"], fig["height"] = rel, w, h
        n += 1
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)
    print(f"[figures] {doc_id}: {n} figure(s)", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--all", action="store_true")
    a = ap.parse_args(argv)
    ids = a.ids or []
    if a.all:
        ids = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(PARSED, "*.json")))
    for i in ids:
        process(i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
