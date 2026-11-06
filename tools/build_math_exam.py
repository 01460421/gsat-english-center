#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
學測數學A／數學B題本 → `gsat-math-exam/v1` JSON 骨架（docs/math-exam-json-schema.md）。

輸入：官方 Word 版題本（經 tools/docx_math_draft.py 轉成草稿）＋選擇（填）題答案 PDF。
輸出：data/exams/parsed-math/{id}.json 的「骨架」：大題、題組、題號、題幹、選項、
官方答案（選擇題、選填格）、配分。選填題的作答格式（template）、圖、表與所有
修正，要看 PDF 頁面影像後人工補上；所以本工具預設不覆寫既有檔案。

不收錄非選擇題的參考答案與評分原則（只記錄題型與配分）。

用法（讀不可信檔案，請用 -I）：
  python3 -I tools/build_math_exam.py --subject a --year 115 [--out PATH] [--force]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docx_math_draft as dd  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "exams", "math-manifest.json")
OUT_DIR = os.path.join(ROOT, "data", "exams", "parsed-math")
SCHEMA = "gsat-math-exam/v1"

CN_NUM = "一二三四五六七八九十"


def manifest_sources(exam, year):
    with open(MANIFEST, encoding="utf-8") as f:
        items = [it for it in json.load(f)["items"]
                 if it["exam"] == exam and it["year"] == year and it["session"] == "regular"]
    src = {"paper": None, "paper_word": [], "answer": [], "answer_sheet": [], "stats": [],
           "scoring_not_stored": []}
    for it in items:
        p, sub = it["local_path"], it["subkind"]
        if sub == "paper":
            src["paper"] = p
        elif sub == "paper_word":
            src["paper_word"].append(p)
        elif sub == "answer":
            src["answer"].append(p)
        elif sub == "answer_sheet":
            src["answer_sheet"].append(p)
        elif sub == "scoring":
            src["scoring_not_stored"].append(p)
    # 統計檔是各科合併檔，只掛在 gsat-matha 下
    with open(MANIFEST, encoding="utf-8") as f:
        for it in json.load(f)["items"]:
            if it["kind"] == "stats" and it["year"] == year and it["exam"] == "gsat-matha":
                src["stats"].append(it["local_path"])
    return src


ANS_RX = re.compile(r"(?<![\d-])(\d{1,2}(?:-\d{1,2})?)[ \t]+((?:[1-9](?:,[1-9])+)|[0-9]|／|－|-|±)(?=[ \t]|$)",
                    re.M)


def parse_answer_key(pdf_path):
    exe = shutil.which("pdftotext")
    txt = subprocess.run([exe, "-q", "-layout", "-enc", "UTF-8", pdf_path, "-"],
                         capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
    key = {}
    for m in ANS_RX.finditer(txt):
        k, v = m.group(1), m.group(2)
        if v == "－":
            v = "-"
        if k in key and key[k] != v:
            raise ValueError(f"answer key conflict at {k}: {key[k]} vs {v}")
        key[k] = v
    return key


SEC_RX = re.compile(r"^([一二三四五六七八九十]+)、\s*(單選題|多選題|選填題|混合題|非選擇題)[^（(]*[（(]占\s*(\d+)\s*分[）)]")
PART_RX = re.compile(r"^第([壹貳參肆])部分[、，]\s*(.+?)[（(]占\s*(\d+)\s*分[）)]")
ITEM_RX = re.compile(r"^((?:\[\[(?:IMG|TXBX) [^\]]*\]\]\s*)*)(\d{1,2})\.\s*\t?(.*)$")
LEAD_MARK_RX = re.compile(r"\[\[(IMG|TXBX) ([^\]]*)\]\]")
OPT_RX = re.compile(r"\((\d)\)\s*")
GROUP_RX = re.compile(r"^(\d{1,2})\s*[-－至~]\s*(\d{1,2})\s*題為題組")
EACH_RX = re.compile(r"每題\s*(\d+)\s*分")
MIXED_TAG_RX = re.compile(r"[（(]\s*(單選題|多選題|選填題|非選擇題)\s*[，,]\s*(\d+)\s*分\s*[）)]\s*$")

SEC_TYPE = {"單選題": "single", "多選題": "multi", "選填題": "fill", "混合題": "mixed",
            "非選擇題": "mixed"}
ITEM_TYPE = {"單選題": "single", "多選題": "multi", "選填題": "fill", "非選擇題": "constructed"}


def split_options(lines):
    """選項行（可能一行多個、用 tab 分隔）→ {"1": "...", ...}；回傳 (stem_lines, options)。"""
    opts = {}
    stem = []
    cur = None
    for ln in lines:
        if OPT_RX.match(ln.strip()):
            parts = OPT_RX.split(ln.strip())
            # parts = ['', '1', 'text', '2', 'text', ...]
            for i in range(1, len(parts) - 1, 2):
                cur = parts[i]
                opts[cur] = parts[i + 1].strip()
        elif cur is not None:
            opts[cur] = (opts[cur] + " " + ln.strip()).strip()
        else:
            stem.append(ln)
    return stem, opts


def clean(s):
    s = s.replace("\t", " ")
    s = s.replace("$$", "")  # 相鄰的兩段公式合併
    s = re.sub(r"\[\[IMG media/image\d+\.wmf\]\]", "", s)
    s = re.sub(r" {2,}", " ", s)
    return s.strip()


def build(subject, year):
    exam = {"a": "gsat-matha", "b": "gsat-mathb"}[subject]
    letter = subject.upper()
    src = manifest_sources(exam, year)
    docx = os.path.join(ROOT, src["paper_word"][0])
    text, stats, warns = dd.draft(docx)
    lines = text.split("\n")
    key = parse_answer_key(os.path.join(ROOT, src["answer"][0]))

    m = re.search(r"考試時間[：:]\s*(\d+)\s*分鐘", text)
    time_minutes = int(m.group(1)) if m else None
    rules = {}
    for ln in lines:
        mm = re.match(r"^[˙․・]\s*(單選題|多選題|選填題)[：:]?(.*)$", ln)
        if mm:
            rules[ITEM_TYPE[mm.group(1)]] = clean(mm.group(2))

    parts, sections = [], []
    cur_part = cur_sec = cur_group = cur_item = None
    pending_part_instr = False
    ref_lines = []
    in_ref = False
    item_lines = []

    def flush_item():
        nonlocal cur_item, item_lines
        if cur_item is None:
            return
        stem_lines, opts = split_options(item_lines)
        stem = clean(" ".join(stem_lines))
        mt = MIXED_TAG_RX.search(stem)
        if mt:
            cur_item["type"] = ITEM_TYPE[mt.group(1)]
            cur_item["points"] = int(mt.group(2))
            cur_item["type_label_raw"] = mt.group(0).strip()
        cur_item["stem"] = stem
        cur_item["options"] = {k: clean(v) for k, v in opts.items()} or None
        cur_group["items"].append(cur_item)
        cur_item, item_lines = None, []

    def new_group(label=None):
        nonlocal cur_group
        cur_group = {"id": f"{cur_sec['id']}g{len(cur_sec['groups']) + 1}",
                     "group_label": label, "stem": None, "figures": [], "items": []}
        cur_sec["groups"].append(cur_group)

    for ln in lines:
        s = ln.strip()
        if s.startswith("參考公式"):
            flush_item()
            in_ref = True
            continue
        if in_ref:
            ref_lines.append(clean(s))
            continue
        pm = PART_RX.match(s.replace(" ", ""))
        if pm:
            flush_item()
            cur_part = {"title": s, "points": int(pm.group(3)), "instructions": None,
                        "sections": []}
            parts.append(cur_part)
            pending_part_instr = True
            if "混合題" in s or "非選擇題" in s:
                # 第貳部分本身就是一個大題（不再有「一、」標題）
                cur_sec = {"id": f"s{len(sections) + 1}", "type": "mixed", "title": s,
                           "instructions": None, "points_total": int(pm.group(3)),
                           "points_each": None, "groups": []}
                sections.append(cur_sec)
                cur_part["sections"].append(cur_sec["id"])
                cur_group = None
            continue
        sm = SEC_RX.match(s)
        if sm:
            flush_item()
            pending_part_instr = False
            cur_sec = {"id": f"s{len(sections) + 1}", "type": SEC_TYPE[sm.group(2)],
                       "title": s, "instructions": None, "points_total": int(sm.group(3)),
                       "points_each": None, "groups": []}
            sections.append(cur_sec)
            if cur_part:
                cur_part["sections"].append(cur_sec["id"])
            cur_group = None
            continue
        if cur_sec is None:
            continue
        if s.startswith("說明") and cur_item is None:
            if pending_part_instr and cur_sec["type"] == "mixed" and not cur_sec["groups"]:
                cur_part["instructions"] = clean(s)
                cur_sec["instructions"] = clean(s)
            else:
                cur_sec["instructions"] = clean(s)
            em = EACH_RX.search(s)
            if em:
                cur_sec["points_each"] = int(em.group(1))
            continue
        if pending_part_instr and cur_item is None and not cur_sec["groups"] and \
                not GROUP_RX.match(s) and not ITEM_RX.match(s):
            cur_part["instructions"] = clean((cur_part["instructions"] or "") + s)
            cur_sec["instructions"] = cur_part["instructions"]
            continue
        gm = GROUP_RX.match(s)
        if gm:
            flush_item()
            new_group(s)
            continue
        im = ITEM_RX.match(s)
        if im and (cur_item is None or 0 < int(im.group(2)) - cur_item["no"] <= 5) and \
                not OPT_RX.match(s):
            flush_item()
            if cur_group is None or (cur_group["group_label"] is None and cur_group["items"]):
                new_group()
            no = int(im.group(2))
            st = SEC_TYPE.get(cur_sec["type"], cur_sec["type"])
            cur_item = {"no": no, "label": str(no),
                        "type": {"single": "single", "multi": "multi", "fill": "fill"}.get(st, "single"),
                        "stem": None, "options": None, "answer": None,
                        "points": cur_sec["points_each"]}
            item_lines = [im.group(1) + im.group(3)]
            continue
        if cur_item is not None:
            item_lines.append(ln)
        elif cur_group is not None:
            cur_group["stem"] = clean(((cur_group["stem"] or "") + " " + s))
    flush_item()

    # 官方答案
    for sec in sections:
        for g in sec["groups"]:
            for it in g["items"]:
                n = str(it["no"])
                cells = sorted((k for k in key if k.startswith(n + "-")),
                               key=lambda k: int(k.split("-")[1]))
                if it["type"] == "fill" or (cells and n not in key):
                    it["type"] = "fill"
                    it["answer"] = None
                    it["fill"] = {"cells": cells, "template": None,
                                  "answer_cells": {c: key[c] for c in cells},
                                  "answer_latex": None}
                elif key.get(n) == "／":
                    it["type"] = "constructed"
                    it["answer"] = None
                    it["constructed"] = {"official_answer_stored": False}
                elif it["type"] == "multi":
                    it["answer"] = key[n].split(",")
                else:
                    v = key.get(n)
                    if v and "," in v:
                        it["type"] = "multi"
                        it["answer"] = v.split(",")
                    else:
                        it["answer"] = v
                for k in ("type_label_raw",):
                    pass
    doc = {
        "schema": SCHEMA,
        "id": f"{exam}-{year}",
        "exam": "gsat",
        "subject": f"math_{subject}",
        "year": year,
        "session": "regular",
        "title": f"{year}學年度學科能力測驗數學{letter}考科",
        "time_minutes": time_minutes,
        "full_score": 100,
        "sources": {k: v for k, v in src.items() if v},
        "scoring_rules": rules,
        "parts": [{**p, "sections": p["sections"]} for p in parts],
        "sections": sections,
        "reference_formulas": [r for r in ref_lines if r],
        "extraction": {
            "method": "tools/docx_math_draft.py（Word 版題本，MathType→LaTeX）產生骨架，"
                      "答案取自 answer.pdf（pdftotext）；逐題以 pdftoppm 頁面影像人工校對",
            "issues": [],
            "verified_by": None,
        },
    }
    for sec in doc["sections"]:
        sec.pop("points_each", None)
    return doc, stats, warns


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--subject", choices=["a", "b"], required=True)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true", help="覆寫已人工校對過的檔案")
    a = ap.parse_args(argv)
    doc, stats, warns = build(a.subject, a.year)
    out = a.out or os.path.join(OUT_DIR, doc["id"] + ".json")
    if os.path.exists(out) and not a.force and not a.out:
        print(f"{out} 已存在（可能已人工校對）；要覆寫請加 --force，或用 --out 另存", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    n = sum(len(g["items"]) for s in doc["sections"] for g in s["groups"])
    print(f"[build] {doc['id']}: {n} items, equations={stats['equations']}, "
          f"eq_errors={stats['eq_errors']}, warnings={len(warns)} -> {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
