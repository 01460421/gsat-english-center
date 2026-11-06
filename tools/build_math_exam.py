#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
學測數學A／數學B（108 課綱）與舊課綱學測數學（100–110）題本 → `gsat-math-exam/v1`
JSON 骨架（docs/math-exam-json-schema.md）。

輸入：官方 Word 版題本（經 tools/docx_math_draft.py 轉成草稿）＋選擇（填）題答案 PDF。
輸出：data/exams/parsed-math/{id}.json 的「骨架」：大題、題組、題號、題幹、選項、
官方答案（選擇題、選填格）、配分。選填題的作答格式（template）、圖、表與所有
修正，要看 PDF 頁面影像後人工補上；所以本工具預設不覆寫既有檔案。

不收錄非選擇題的參考答案與評分原則（只記錄題型與配分）。

用法（讀不可信檔案，請用 -I）：
  python3 -I tools/build_math_exam.py --subject a --year 115 [--out PATH] [--force]
  python3 -I tools/build_math_exam.py --subject old --year 110 [--docx PATH]

舊課綱（--subject old，id gsat-math-{學年度}）：第貳部分是選填題 A、B、C…，答案卡列號
（⑭⑮…）全卷連號。骨架裡選填題的 `fill.official_cells` 與 template 留空，全卷的選填
答案（列號→劃記）暫放在頂層 `_fill_key`；看過 PDF 後用 `apply_official_template()`
依「用列號寫的 template」（例如 `\frac{[[19]]}{[[20]][[21]]}`）填入 cells／answer_cells，
全部選填題處理完再刪掉 `_fill_key`（validator 看到底線開頭的頂層欄位會報 error）。
100–102 的官方 Word 檔是舊版 .doc：先用 LibreOffice（headless、獨立的設定目錄）轉成
.docx 再以 --docx 指定；轉檔後 OLE 的 ProgID 會變成空字串，docx_math_draft 仍會讀出
MathType（MTEF v5）公式，Equation 3.0（MTEF v3）物件則留 [[EQ-ERROR]] 由人工依 PDF 補。
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
PART_RX = re.compile(r"^第([壹貳參肆])部分[、，：:]\s*(.+?)[（(]占\s*(\d+)\s*分[）)]")
ITEM_RX = re.compile(r"^((?:\[\[(?:IMG|TXBX) [^\]]*\]\]\s*)*)(\d{1,2})\.\s*\t?(.*)$")
LEAD_MARK_RX = re.compile(r"\[\[(IMG|TXBX) ([^\]]*)\]\]")
OPT_RX = re.compile(r"\((\d)\)\s*")
GROUP_RX = re.compile(r"^(\d{1,2})\s*[-－至~]\s*(\d{1,2})\s*題為題組")
EACH_RX = re.compile(r"每題\s*(\d+)\s*分")
MIXED_TAG_RX = re.compile(r"[（(]\s*(單選題|多選題|選填題|非選擇題)\s*[，,]\s*(\d+)\s*分\s*[）)]\s*$")

SEC_TYPE = {"單選題": "single", "多選題": "multi", "選填題": "fill", "混合題": "mixed",
            "非選擇題": "mixed"}
ITEM_TYPE = {"單選題": "single", "多選題": "multi", "選填題": "fill", "非選擇題": "constructed"}


def _option_marks(ln):
    """一行中選項標記 (n) 的位置：不在 $…$ 內，且在行首或空白之後。"""
    marks, in_math = [], False
    for i, ch in enumerate(ln):
        if ch == "$":
            in_math = not in_math
            continue
        if in_math or ch != "(":
            continue
        m = OPT_RX.match(ln, i)
        if m and (i == 0 or ln[i - 1] in " \t\u3000"):
            marks.append((i, m.end(), m.group(1)))
    return marks


def split_options(lines):
    """選項行（可能一行多個、用 tab 分隔）→ {"1": "...", ...}；回傳 (stem_lines, options)。"""
    opts = {}
    stem = []
    cur = None
    for ln in lines:
        s = re.sub(r"\]\]\(", "]] (", ln.strip())
        lead = re.match(r"^((?:\[\[(?:IMG|TXBX) [^\]]*\]\]\s*)+)", s)
        if lead and _option_marks(s[lead.end():])[:1] and _option_marks(s[lead.end():])[0][0] == 0:
            stem.append(lead.group(1))  # 圖的標記留在題幹，選項照常切
            s = s[lead.end():]
        marks = _option_marks(s)
        if marks and marks[0][0] == 0:
            for j, (st, en, k) in enumerate(marks):
                end = marks[j + 1][0] if j + 1 < len(marks) else len(s)
                cur = k
                opts[k] = s[en:end].strip()
        elif cur is not None:
            opts[cur] = (opts[cur] + " " + s).strip()
        else:
            stem.append(ln)
    return stem, opts


def extract_tables(lines):
    """草稿中的 [[TABLE]]…[[/TABLE]] 區塊 → rows；原位置換成 [[TABLE:k]]。"""
    out, tables, cur = [], [], None
    for ln in lines:
        s = ln.strip()
        if s == "[[TABLE]]":
            cur = []
            continue
        if s == "[[/TABLE]]" and cur is not None:
            tables.append({"caption": None, "rows": [[clean(c) for c in r.split("｜")] for r in cur]})
            out.append(f"[[TABLE:{len(tables)}]]")
            cur = None
            continue
        if cur is not None:
            cur.append(ln.strip("\n"))
        else:
            out.append(ln)
    return out, tables


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
        item_lines, tables = extract_tables(item_lines)
        if tables:
            cur_item["tables"] = tables
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

    def close_group_stem(g):
        if g is None or "_lines" not in g:
            return
        lines_, tables = extract_tables(g.pop("_lines"))
        g["stem"] = clean(" ".join(x.strip() for x in lines_)) or None
        if tables:
            g["tables"] = tables

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
            close_group_stem(cur_group)
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
            cur_group.setdefault("_lines", []).append(ln)
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
        "era": "108課綱",
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


# ---------------------------------------------------------------------------
# 舊課綱學測數學（100–110）：gsat-math-{學年度}
# ---------------------------------------------------------------------------
OLD_ANS_RX = re.compile(r"(?<![\d,])(\d{1,2})[ \t]+([1-5](?:,?[1-5])*|[0-9]|－|–|−|-|±)(?=[ \t]|$)", re.M)
OLD_FILL_RX = re.compile(r"^((?:\[\[(?:IMG|TXBX) [^\]]*\]\]\s*)*)([A-Z])[.．]\s*\t?(.*)$")
OLD_POINTS_RX = re.compile(r"答對(?:者)?[，,]?\s*(?:得|給)\s*(\d+)\s*分")
BOX_RX = re.compile(r"\$?\[\[BOX[^\]]*\]\]\$?")


def parse_answer_key_old(pdf_path, n_mc):
    """舊課綱答案 PDF → ({題號: 答案}, {列號: 劃記})。

    選擇題 1..n_mc 的多選答案可能寫成「1,3,5」或「135」；選填列號 n_mc+1 起每列一個字元。
    """
    exe = shutil.which("pdftotext")
    txt = subprocess.run([exe, "-q", "-layout", "-enc", "UTF-8", pdf_path, "-"],
                         capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
    return parse_answer_text_old(txt, n_mc)


def parse_answer_text_old(txt, n_mc):
    mc, cells = {}, {}
    for m in OLD_ANS_RX.finditer(txt):
        k, v = int(m.group(1)), m.group(2)
        if v in ("－", "–", "−"):
            v = "-"
        if k <= n_mc:
            val = [c for c in v if c.isdigit()]
            if not val or any(c not in "12345" for c in val):
                raise ValueError(f"選擇題 {k} 答案不合法：{v}")
            dst, val = mc, val
        else:
            if len(v.replace(",", "")) != 1:
                raise ValueError(f"選填列號 {k} 的劃記不是單一字元：{v}")
            dst, val = cells, v
        if str(k) in dst and dst[str(k)] != val:
            raise ValueError(f"answer key conflict at {k}: {dst[str(k)]} vs {val}")
        dst[str(k)] = val
    return mc, cells


def apply_official_template(item, tpl_official, fill_key):
    """舊課綱選填題：用答案卡列號寫的 template（`[[19]]`）→ fill.cells／official_cells／
    template（`[[{題號}-k]]`）／answer_cells／answer_latex。回傳用到的列號。"""
    rows = re.findall(r"\[\[(\d+)\]\]", tpl_official)
    if not rows or rows != sorted(rows, key=int) or len(set(rows)) != len(rows):
        raise ValueError(f"{item['label']}: template 的列號應遞增且不重複：{rows}")
    no = item["no"]
    cells = [f"{no}-{i}" for i in range(1, len(rows) + 1)]
    tpl = tpl_official
    for r_, c in zip(rows, cells):
        tpl = tpl.replace(f"[[{r_}]]", f"[[{c}]]", 1)
    missing = [r_ for r_ in rows if r_ not in fill_key]
    if missing:
        raise ValueError(f"{item['label']}: 答案檔沒有列號 {missing}")
    ans = {c: fill_key[r_] for r_, c in zip(rows, cells)}
    latex = tpl
    for c in cells:
        latex = latex.replace(f"[[{c}]]", ans[c])
    item["fill"] = {"cells": cells, "official_cells": rows, "template": tpl,
                    "answer_cells": ans, "answer_latex": latex}
    return rows


def finalize_old_fill(doc):
    """全部選填題都套過 template 後：檢查列號全卷連號、與答案檔一致，刪掉 `_fill_key`。"""
    key = doc.get("_fill_key") or {}
    used = []
    for sec in doc["sections"]:
        for g in sec["groups"]:
            for it in g["items"]:
                if it["type"] == "fill":
                    used += (it.get("fill") or {}).get("official_cells") or []
    want = sorted(key, key=int)
    if used != want:
        raise ValueError(f"選填列號 {used} 與答案檔 {want} 不一致")
    doc.pop("_fill_key", None)


def _unwrap_instruction_tables(lines):
    """102 等年份把大題「說明」排在一格表格裡：拆掉 [[TABLE]] 外框。"""
    out, i = [], 0
    while i < len(lines):
        if lines[i].strip() == "[[TABLE]]":
            j = i + 1
            while j < len(lines) and lines[j].strip() != "[[/TABLE]]":
                j += 1
            body = lines[i + 1:j]
            if len(body) == 1 and body[0].strip().startswith("說明"):
                out += [x.strip() for x in body[0].split(" / ")]
                i = j + 1
                continue
        out.append(lines[i])
        i += 1
    return out


def build_old(year, docx=None):
    exam = "gsat-math"
    src = manifest_sources(exam, year)
    # 舊數學的統計檔掛在 gsat-math 自己底下（數A／數B 是掛在 gsat-matha）
    with open(MANIFEST, encoding="utf-8") as f:
        src["stats"] = [it["local_path"] for it in json.load(f)["items"]
                        if it["kind"] == "stats" and it["year"] == year and it["exam"] == exam]
    word = docx or os.path.join(ROOT, src["paper_word"][0])
    text, stats, warns = dd.draft(word)
    lines = _unwrap_instruction_tables(text.split("\n"))

    m = re.search(r"考試時間[：:]\s*(\d+)\s*分鐘", text)
    time_minutes = int(m.group(1)) if m else None
    parts, sections, ref_lines = [], [], []
    rules = {}
    cur_part = cur_sec = cur_group = cur_item = None
    item_lines, in_ref, started, pending_instr = [], False, False, False
    last_no, last_letter = 0, None

    def flush_item():
        nonlocal cur_item, item_lines
        if cur_item is None:
            return
        item_lines, tables = extract_tables(item_lines)
        if tables:
            cur_item["tables"] = tables
        if cur_item["type"] == "fill":
            stem = clean(" ".join(item_lines))
            boxes = list(BOX_RX.finditer(stem))
            guess = None
            if boxes:
                a, b = boxes[0].start(), boxes[-1].end()
                # 作答格若在一段公式裡（例如 $x-[[BOX]]y+[[BOX]]z=[[BOX]]$），整段公式都算格式
                if stem[:a].count("$") % 2:
                    a = stem.rfind("$", 0, a)
                if stem[b:].count("$") % 2:
                    b = stem.find("$", b) + 1
                guess = BOX_RX.sub("[[?]]", stem[a:b]).replace("$", "")
                stem = stem[:a] + "[[FILL]]" + stem[b:]
            cur_item["stem"] = stem
            cur_item["options"] = None
            cur_item["fill"] = {"cells": [], "official_cells": [], "template": guess,
                                "answer_cells": {}, "answer_latex": None}
        else:
            stem_lines, opts = split_options(item_lines)
            cur_item["stem"] = clean(" ".join(stem_lines))
            cur_item["options"] = {k: clean(v) for k, v in opts.items()} or None
        cur_group["items"].append(cur_item)
        cur_item, item_lines = None, []

    def new_group():
        nonlocal cur_group
        cur_group = {"id": f"{cur_sec['id']}g{len(cur_sec['groups']) + 1}",
                     "group_label": None, "stem": None, "figures": [], "items": []}
        cur_sec["groups"].append(cur_group)

    def new_section(typ, title, pts):
        nonlocal cur_sec, cur_group
        cur_sec = {"id": f"s{len(sections) + 1}", "type": typ, "title": title,
                   "instructions": None, "points_total": pts, "points_each": None, "groups": []}
        sections.append(cur_sec)
        cur_part["sections"].append(cur_sec["id"])
        cur_group = None

    for ln in lines:
        s = ln.strip()
        if s.startswith("參考公式"):
            flush_item()
            in_ref = True
            continue
        if in_ref:
            if s:
                ref_lines.append(clean(s))
            continue
        pm = PART_RX.match(s.replace(" ", ""))
        if pm:
            flush_item()
            started = True
            cur_part = {"title": s, "points": int(pm.group(3)), "instructions": None,
                        "sections": []}
            parts.append(cur_part)
            if "選填題" in s:
                new_section("fill", s, int(pm.group(3)))
            continue
        if not started:
            continue
        sm = SEC_RX.match(s)
        if sm:
            flush_item()
            new_section(SEC_TYPE[sm.group(2)], s, int(sm.group(3)))
            continue
        if cur_sec is None:
            continue
        if s.startswith("說明") and cur_item is None and not cur_sec["groups"]:
            cur_sec["instructions"] = clean(s)
            pending_instr = True
            continue
        fm = OLD_FILL_RX.match(s) if cur_sec["type"] == "fill" else None
        if fm and fm.group(2) == (chr(ord(last_letter) + 1) if last_letter else "A"):
            flush_item()
            new_group()
            pending_instr = False
            last_letter = fm.group(2)
            last_no += 1
            cur_item = {"no": last_no, "label": last_letter, "type": "fill", "stem": None,
                        "options": None, "answer": None, "points": cur_sec["points_each"]}
            item_lines = [fm.group(1) + fm.group(3)]
            continue
        im = ITEM_RX.match(s) if cur_sec["type"] != "fill" else None
        if im and int(im.group(2)) == last_no + 1 and not OPT_RX.match(s):
            flush_item()
            new_group()
            pending_instr = False
            last_no = int(im.group(2))
            cur_item = {"no": last_no, "label": str(last_no), "type": cur_sec["type"],
                        "stem": None, "options": None, "answer": None,
                        "points": cur_sec["points_each"]}
            item_lines = [im.group(1) + im.group(3)]
            continue
        if pending_instr and cur_item is None:
            if s:
                cur_sec["instructions"] = clean(cur_sec["instructions"] + " " + s)
            continue
        if cur_item is not None:
            item_lines.append(ln)
    flush_item()

    for sec in sections:
        ins = sec["instructions"] or ""
        pm = OLD_POINTS_RX.search(ins)
        if pm:
            sec["points_each"] = int(pm.group(1))
            for g in sec["groups"]:
                for it in g["items"]:
                    it["points"] = sec["points_each"]
        for typ, rx in (("single", r"(各題答對.*)$"), ("multi", r"(各題之選項獨立判定.*)$"),
                        ("fill", r"(每題完全答對.*)$")):
            mm = re.search(rx, ins)
            if sec["type"] == typ and mm:
                rules[typ] = clean(mm.group(1))

    n_mc = sum(len(g["items"]) for sec in sections if sec["type"] != "fill" for g in sec["groups"])
    mc_key, fill_key = parse_answer_key_old(os.path.join(ROOT, src["answer"][0]), n_mc)
    for sec in sections:
        for g in sec["groups"]:
            for it in g["items"]:
                if it["type"] == "fill":
                    continue
                v = mc_key.get(str(it["no"]))
                if v is None:
                    raise ValueError(f"答案檔沒有第 {it['no']} 題")
                it["answer"] = v if it["type"] == "multi" else (v[0] if len(v) == 1 else v)
    for sec in sections:
        sec.pop("points_each", None)
    doc = {
        "schema": SCHEMA,
        "id": f"{exam}-{year}",
        "exam": "gsat",
        "subject": "math",
        "era": "舊課綱",
        "year": year,
        "session": "regular",
        "title": f"{year}學年度學科能力測驗數學考科",
        "time_minutes": time_minutes,
        "full_score": 100,
        "sources": {k: v for k, v in src.items() if v},
        "scoring_rules": rules,
        "parts": parts,
        "sections": sections,
        "reference_formulas": [r for r in ref_lines if r],
        "extraction": {
            "method": ("tools/docx_math_draft.py（官方 Word 版題本"
                       + ("，舊版 .doc 先以 LibreOffice 轉 .docx" if docx else "")
                       + "，MathType→LaTeX）產生骨架，答案取自 answer.pdf（pdftotext）；"
                       "逐頁以 pdftoppm 頁面影像人工校對，選填題 template 依題本答案格式人工撰寫"),
            "corrections": [],
            "issues": [],
            "verified_by": None,
        },
        "_fill_key": fill_key,
    }
    return doc, stats, warns


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--subject", choices=["a", "b", "old"], required=True,
                    help="a＝數學A、b＝數學B（111 起）；old＝舊課綱學測數學（100–110）")
    ap.add_argument("--docx", help="舊課綱：改用這個 .docx（例如由官方 .doc 轉出）")
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--out")
    ap.add_argument("--force", action="store_true", help="覆寫已人工校對過的檔案")
    a = ap.parse_args(argv)
    if a.subject == "old":
        doc, stats, warns = build_old(a.year, a.docx)
    else:
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
