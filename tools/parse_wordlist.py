#!/usr/bin/env python3
"""解析大考中心《高中英文參考詞彙表（111 學年度起適用）》PDF，輸出結構化 JSON。

來源（官方公告頁）：https://www.ceec.edu.tw/xmdoc?xsmsid=0K213553204833715309
PDF：https://www.ceec.edu.tw/files/file_pool/1/0k213571061045122620/
     %e9%ab%98%e4%b8%ad%e8%8b%b1%e6%96%87%e5%8f%83%e8%80%83%e8%a9%9e%e5%bd%99%e8%a1%a8
     %28111%e5%ad%b8%e5%b9%b4%e5%ba%a6%e8%b5%b7%e9%81%a9%e7%94%a8%29.pdf

PDF 內同一份詞表排了兩次：
  * 「依級別排序」（印刷頁 1–51）：只有「詞彙＋詞類」，級別由欄內標題「第一級」…「第六級」決定。
  * 「依字母排序」（印刷頁 53–103）：每筆為「詞彙＋詞類＋級別數字」。
本腳本兩份都解析，以「依字母排序」為主資料，再逐筆與「依級別排序」交叉比對級別與詞類。

版面判讀靠字型而非純文字（pdftotext 的多欄排版會把換行的條目拆散）：
  * Arial-BoldMT 12pt                → 詞彙本體（含括號、斜線）
  * TimesNewRomanPS-ItalicMT 11pt    → 詞類（n. v. adj. … 及 (n.)）
  * TimesNewRomanPSMT 11pt 的 1–6    → 級別（只在依字母排序出現）
  * DFKaiShu 12pt「第X級」            → 依級別排序的級別標題
  * Arial-Black 12pt 單一字母          → 依字母排序的字母分隔標題
三欄左緣固定在 x≈63.8／229.9／396.0；換行的續行有懸掛縮排。

只用 Python 標準庫＋pdfplumber。可重跑：
    python3 tools/parse_wordlist.py                       # 用預設路徑
    python3 tools/parse_wordlist.py --pdf X.pdf --out Y.json --sample 30 --seed 115
    python3 tools/parse_wordlist.py --legacy91 data/raw/vocab/legacy-91/4.pdf   # 加做新舊版差異
結束碼：兩種排序交叉比對完全一致時為 0，否則為 1（可放進 CI）。
輸出的 JSON 是陣列（依原表字母順序），每筆：
    {word, level, pos, variants, raw, pages, tags}
  word     主要詞形（斜線前、括號外的第一個形式）
  level    1–6（取自依字母排序的級別數字）
  pos      詞類陣列，照原表標示（例：["v.", "(n.)"]）
  variants 其他形式：斜線後的拼法、括號中的形式展開（agree(ment) → agreement）、
           代名詞括號中的格變化（we (us, our, ours, ourselves)）
  raw      依字母排序中該條目的原文（含詞類與級別數字；排版換行已還原）
  pages    {"alpha": 依字母排序印刷頁碼, "level": 依級別排序印刷頁碼}
  tags     條目型態：slash-forms（斜線並列）、paren-ment（-ment 衍生名詞）、
           paren-plural（(s) 常用複數）、paren-suffix（其他字尾，如 capital(ism)）、
           paren-full-form（括號內為完整詞形，如 argue(argument)）、pronoun-forms（代名詞格變化）
"""
from __future__ import annotations

import argparse
import collections
import json
import random
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PDF = ROOT / "data/raw/vocab/ceec-wordlist-111.pdf"
DEFAULT_OUT = ROOT / "data/vocab/ceec-wordlist.json"

BODY_TOP, BODY_BOTTOM = 55.0, 790.0          # 頁首約 top=36、頁碼約 top=810
COL_LEFTS = (63.8, 229.9, 396.0)              # 三欄左緣（印刷頁 1–103 全部一致，已逐頁統計確認）
COL_SPLITS = (225.0, 391.0)                   # 欄界
INDENT_TOL = 2.0                              # 行首 x 與欄左緣相差 < 2pt 視為新條目
LINE_TOL = 4.0                                # 同一行的 top 容差
LEVEL_HEAD = {"第一級": 1, "第二級": 2, "第三級": 3, "第四級": 4, "第五級": 5, "第六級": 6}
POS_TAGS = {"n.", "v.", "adj.", "adv.", "prep.", "conj.", "pron.", "art.", "aux."}


# ---------------------------------------------------------------------------
# 版面 → token
# ---------------------------------------------------------------------------
def classify(word: dict) -> str:
    font = word["fontname"].split("+")[-1]
    text = word["text"]
    if font.startswith("Arial-Bold"):
        return "H"                                   # headword
    if "Italic" in font:
        return "P"                                   # part of speech
    if font == "TimesNewRomanPSMT" and re.fullmatch(r"[1-6]", text):
        return "L"                                   # level digit
    if font.startswith("Arial-Black"):
        return "LETTER"
    if font.startswith("DFKaiShu") and text in LEVEL_HEAD:
        return "LEVELHEAD"
    if text == "/":
        return "SLASH"                               # 少數斜線用了 PMingLiU 等其他字型
    return "OTHER"


def column_of(x0: float) -> int:
    if x0 < COL_SPLITS[0]:
        return 0
    if x0 < COL_SPLITS[1]:
        return 1
    return 2


def page_lines(page) -> tuple[str | None, list[list[dict]]]:
    """回傳（印刷頁碼, 依欄→行排序的行列表）。每行是 token 列表。"""
    words = page.extract_words(extra_attrs=["fontname", "size"], keep_blank_chars=False)
    printed = None
    body = []
    for w in words:
        if w["top"] >= BODY_BOTTOM:
            if re.fullmatch(r"\d+", w["text"]):
                printed = w["text"]
            continue
        if w["top"] <= BODY_TOP:
            continue
        kind = classify(w)
        font = w["fontname"].split("+")[-1]
        # 版面大標題（DFKaiShu 14/16pt「依級別排序」「高中英文參考詞彙表」）不是內容
        if kind == "OTHER" and font.startswith("DFKaiShu"):
            continue
        w = dict(w, kind=kind, col=column_of(w["x0"]))
        body.append(w)
    lines: list[list[dict]] = []
    for col in range(3):
        toks = sorted((w for w in body if w["col"] == col), key=lambda w: (w["top"], w["x0"]))
        cur: list[dict] = []
        for t in toks:
            if cur and abs(t["top"] - cur[0]["top"]) > LINE_TOL:
                lines.append(sorted(cur, key=lambda w: w["x0"]))
                cur = []
            cur.append(t)
        if cur:
            lines.append(sorted(cur, key=lambda w: w["x0"]))
    return printed, lines


def join_tokens(tokens: list[dict], wraps: list | None = None) -> str:
    """依 token 間距還原原文：同一行間距 > 1pt 補一個空白。
    跨行（排版換行）時：前一段以「/」結尾或下一段以「/」開頭 → 不補空白
    （chairperson/chair/⏎chairman）；前後都是字母且同為詞彙字型 → 視為排版把單字
    從中間斷開（sportswoma⏎n），直接接起來並記錄到 wraps；其餘補一個空白。"""
    out = ""
    prev = None
    for t in tokens:
        if prev is not None:
            same_line = abs(t["top"] - prev["top"]) <= LINE_TOL
            if same_line:
                if t["x0"] - prev["x1"] > 1.0:
                    out += " "
            elif out.endswith("/") or t["text"].startswith("/"):
                pass
            elif (prev["kind"] == t["kind"] == "H" and out[-1:].isalpha() and t["text"][:1].isalpha()):
                if wraps is not None:
                    wraps.append(f"{out}⏎{t['text']}")
            else:
                out += " "
        out += t["text"]
        prev = t
    return out


# ---------------------------------------------------------------------------
# 分段：把行切成條目
# ---------------------------------------------------------------------------
def split_entries(pdf, page_indices, mode: str, anomalies: list) -> list[dict]:
    entries: list[dict] = []
    cur: dict | None = None
    level = None

    def flush():
        nonlocal cur
        if cur and cur["tokens"]:
            entries.append(cur)
        cur = None

    for idx in page_indices:
        printed, lines = page_lines(pdf.pages[idx])
        for line in lines:
            first = line[0]
            col_left = COL_LEFTS[first["col"]]
            at_left = abs(first["x0"] - col_left) < INDENT_TOL
            if first["kind"] == "LEVELHEAD":
                flush()
                level = LEVEL_HEAD[first["text"]]
                continue
            if first["kind"] == "LETTER":
                flush()
                continue
            if mode == "level":
                if at_left and first["kind"] == "H":
                    flush()
                    cur = {"tokens": [], "page": printed, "pdf_index": idx, "level": level}
                elif cur is None:
                    anomalies.append(f"[level p.{printed}] 續行沒有對應條目：{join_tokens(line)!r}")
                    continue
                cur["tokens"].extend(line)
            else:  # alpha：條目以級別數字結尾
                if cur is None:
                    if not at_left:
                        anomalies.append(f"[alpha p.{printed}] 條目開頭有縮排：{join_tokens(line)!r}")
                    cur = {"tokens": [], "page": printed, "pdf_index": idx}
                elif at_left and first["kind"] == "H":
                    anomalies.append(f"[alpha p.{printed}] 上一條目缺級別數字：{join_tokens(cur['tokens'])!r}")
                    flush()
                    cur = {"tokens": [], "page": printed, "pdf_index": idx}
                cur["tokens"].extend(line)
                if line[-1]["kind"] == "L":
                    flush()
    flush()
    return entries


# ---------------------------------------------------------------------------
# 條目 → 結構化欄位
# ---------------------------------------------------------------------------
def split_parts(tokens: list[dict]):
    head, pos, lvl, other = [], [], [], []
    for t in tokens:
        k = t["kind"]
        if k == "H" or (k == "SLASH" and not pos):
            head.append(t)
        elif k == "P" or (k == "SLASH" and pos):
            pos.append(t)
        elif k == "L":
            lvl.append(t)
        else:
            other.append(t)
    return head, pos, lvl, other


def parse_pos(pos_text: str, anomalies: list, ctx: str) -> list[str]:
    """把「v./(n.)」切成 ["v.", "(n.)"]，保留原表寫法。
    唯一的例外：原表漏掉縮寫句點（calm v./adj./n）時補上句點並記錄異常。"""
    parts = [p.strip() for p in pos_text.replace(" ", "").split("/") if p.strip()]
    fixed = []
    for p in parts:
        core = p.strip("()")
        if core not in POS_TAGS:
            if core + "." in POS_TAGS:
                anomalies.append(f"{ctx} 原表詞類漏句點 {p!r}（詞類原文 {pos_text!r}），已補為 {core + '.'!r}")
                p = p.replace(core, core + ".")
            else:
                anomalies.append(f"{ctx} 未知詞類標示 {p!r}（詞類原文 {pos_text!r}）")
        fixed.append(p)
    return fixed


def expand_head(head: str) -> tuple[str, list[str], list[str]]:
    """把詞彙欄位拆成（主要詞形, 其他形式, 處理說明）。"""
    notes: list[str] = []
    variants: list[str] = []
    h = re.sub(r"\s+", " ", head).strip()

    # 1) 代名詞格變化：we (us, our, ours, ourselves)
    m = re.fullmatch(r"(\S+) \(([^)]*,[^)]*)\)", h)
    if m:
        base = m.group(1)
        variants = [v.strip() for v in m.group(2).split(",") if v.strip()]
        notes.append("pronoun-forms")
        return base, variants, notes

    forms: list[str] = []
    for chunk in h.split("/"):
        chunk = chunk.strip()
        if not chunk:
            continue
        pm = re.fullmatch(r"([^()]+)\(([^()]+)\)", chunk)
        if pm:
            stem, inner = pm.group(1).strip(), pm.group(2).strip()
            forms.append(stem)
            if inner.lower().startswith(stem[:3].lower()):
                variants.append(inner)                    # argue(argument)：括號內是完整詞形
                notes.append("paren-full-form")
            else:
                variants.append(stem + inner)             # agree(ment)、capital(ism)、wood(s)
                notes.append({"ment": "paren-ment", "s": "paren-plural"}.get(inner, "paren-suffix"))
        elif "(" in chunk or ")" in chunk:
            forms.append(chunk)
            notes.append("unbalanced-paren")
        else:
            forms.append(chunk)
    if not forms:
        return h, [], ["empty-head"]
    word = forms[0]
    # 括號展開形式在前、斜線後的其他拼法在後（advertise(ment)/ad → [advertisement, ad]）
    variants = variants + forms[1:]
    seen, uniq = set(), []
    for v in variants:
        if v != word and v not in seen:
            seen.add(v)
            uniq.append(v)
    if len(forms) > 1:
        notes.append("slash-forms")
    if " " in word:
        notes.append("multiword")
    return word, uniq, notes


def build_records(entries: list[dict], mode: str, anomalies: list) -> list[dict]:
    recs = []
    for e in entries:
        head, pos, lvl, other = split_parts(e["tokens"])
        layout = join_tokens(e["tokens"])
        ctx = f"[{mode} p.{e['page']}] {layout!r}"
        if other:
            anomalies.append(f"{ctx} 有無法分類的 token：{[t['text'] for t in other]}")
        if not head:
            anomalies.append(f"{ctx} 沒有詞彙本體")
            continue
        if not pos:
            anomalies.append(f"{ctx} 沒有詞類")
        wraps: list[str] = []
        head_text = join_tokens(head, wraps)
        for w in wraps:
            anomalies.append(f"{ctx} 詞彙被排版從字中斷行（{w}），已接回")
        pos_text = join_tokens(pos).replace(" ", "")
        # raw：把排版換行還原後的條目原文（詞彙 詞類 [級別]）
        raw = " ".join(x for x in (head_text, pos_text, lvl[0]["text"] if len(lvl) == 1 else "") if x)
        if mode == "alpha":
            if len(lvl) != 1:
                anomalies.append(f"{ctx} 級別數字個數 = {len(lvl)}")
                continue
            level = int(lvl[0]["text"])
        else:
            level = e["level"]
            if lvl:
                anomalies.append(f"{ctx} 依級別排序中出現級別數字")
        # 檢查 token 順序：詞彙 → 詞類 → 級別
        order = [t["kind"] for t in e["tokens"] if t["kind"] in "HPL"]
        if order != sorted(order, key=lambda k: "HPL".index(k)):
            anomalies.append(f"{ctx} token 順序不是 詞彙→詞類→級別：{order}")
        word, variants, notes = expand_head(head_text)
        recs.append({
            "head": head_text,
            "word": word,
            "variants": variants,
            "pos_text": pos_text.replace(" ", ""),
            "pos": parse_pos(pos_text, anomalies, ctx),
            "level": level,
            "raw": raw,
            "page": int(e["page"]) if e["page"] else None,
            "notes": notes,
        })
    return recs


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def find_sections(pdf) -> tuple[list[int], list[int]]:
    """依頁首（奇數頁「依級別排序」「依字母排序」）與「附錄」標題切出兩段。
    目錄頁也含這些字，所以只看頁面最上方（top < BODY_TOP）的頁首與正文開頭的大標題。"""
    level_pages, alpha_pages = [], []
    mode = None
    for i, page in enumerate(pdf.pages):
        words = page.extract_words()
        head = " ".join(w["text"] for w in words if w["top"] < 115)
        if "目" in head and "錄" in head:
            continue                                   # 目錄頁
        if "依級別排序" in head:
            mode = "level"
        elif "依字母排序" in head:
            mode = "alpha"
        elif "附錄" in head:
            mode = None
        if mode == "level":
            level_pages.append(i)
        elif mode == "alpha":
            alpha_pages.append(i)
    # 段與段之間的空白頁沒有 token，留在清單中無妨
    return level_pages, alpha_pages


# ---------------------------------------------------------------------------
# 舊版《91 參考詞彙表》（2002）：只用來做新舊版差異比對，不寫進主 JSON
# 來源：https://www.ceec.edu.tw/SourceUse/ce37/ce37.htm 第 4 項「高中英文參考詞彙表」
#       https://www.ceec.edu.tw/SourceUse/ce37/4.pdf（77 頁，表格排版，左右兩欄）
# 每欄三格：詞彙（x≈51／308）、詞類（x≈177／434）、級別（x≈282／540）；
# 每一列左邊框是一段直立細長 rect，用它的上下界判斷多行儲存格屬於哪一列。
# ---------------------------------------------------------------------------
LEGACY_BORDERS = (50.6, 307.8)                 # 左、右兩欄表格的左邊框 x


LEGACY_CELLS = ((0.0, 125.0), (125.0, 231.0), (231.0, 243.0))   # 詞彙／詞類／級別欄，相對左邊框的 x 範圍


def _cell_text(page, x0, x1, top, bottom) -> list[str]:
    """裁出儲存格範圍，以字元為單位取文字（避免 extract_words 把相鄰兩格黏成一個字）。"""
    chars = [c for c in page.chars
             if x0 <= (c["x0"] + c["x1"]) / 2 < x1 and top <= (c["top"] + c["bottom"]) / 2 <= bottom]
    lines: list[list[dict]] = []
    for c in sorted(chars, key=lambda c: (c["top"], c["x0"])):
        if lines and abs(c["top"] - lines[-1][0]["top"]) <= 3:
            lines[-1].append(c)
        else:
            lines.append([c])
    out = []
    for ln in lines:
        ln.sort(key=lambda c: c["x0"])
        s, prev = "", None
        for c in ln:
            if prev is not None and c["x0"] - prev["x1"] > 1.5 and not s.endswith(" "):
                s += " "
            s += c["text"]
            prev = c
        out.append(re.sub(r"\s+", " ", s).strip())
    return [x for x in out if x]


def parse_legacy91(pdf_path: Path, anomalies: list) -> list[dict]:
    recs = []
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages[1:], start=1):
            for border_x in LEGACY_BORDERS:
                bands = sorted({(round(r["top"], 1), round(r["bottom"], 1)) for r in page.rects
                                if abs(r["x0"] - border_x) < 1 and r["height"] > 5})
                for top, bottom in bands:
                    cells = [_cell_text(page, border_x + a, border_x + b, top, bottom) for a, b in LEGACY_CELLS]
                    head_lines, pos_lines, lvl_lines = cells
                    if not head_lines and not pos_lines:
                        continue
                    head_text = ""
                    for ln in head_lines:                      # 多行詞彙：斜線結尾直接接，否則補空白
                        head_text += ln if (not head_text or head_text.endswith(("/", "("))) else " " + ln
                    pos_text = ""
                    for ln in pos_lines:                       # 多行詞類：缺斜線時補斜線
                        ln = ln.replace(" ", "")
                        if pos_text and not pos_text.endswith("/") and not ln.startswith("/"):
                            pos_text += "/"
                        pos_text += ln
                    lvl_text = "".join(lvl_lines).strip()
                    if re.fullmatch(r"[A-Z]", head_text) and not pos_text:
                        continue                                 # 字母分隔列
                    if not re.fullmatch(r"[1-6]", lvl_text):
                        anomalies.append(f"[91 p.{pno}] {head_text} {pos_text}：級別欄為 {lvl_text!r}")
                        level = None
                    else:
                        level = int(lvl_text)
                    recs.append({"head": head_text, "pos_text": pos_text, "level": level, "page": pno})
    return recs


def legacy_forms(head: str) -> tuple[str, set[str]]:
    """舊版詞彙欄位 → （主要詞形, 全部詞形集合，小寫）。去掉同形異義編號 (1)(2)。"""
    h = re.sub(r"\s*\(\d\)", "", head).strip()
    # 舊版 judge(ment/judgment)：括號內含斜線，展開成兩種形式
    m = re.fullmatch(r"(\w+)\((\w+)/(\w+)\)", h)
    if m:
        forms = {m.group(1), m.group(1) + m.group(2), m.group(3)}
        return m.group(1).lower(), {f.lower() for f in forms}
    word, variants, _ = expand_head(h)
    return word.lower(), {f.lower() for f in [word] + variants}


def compare_with_legacy(new_recs: list[dict], old_recs: list[dict], say, diff_out: Path | None):
    old_by_form = collections.defaultdict(list)
    old_primary = {}
    for o in old_recs:
        prim, forms = legacy_forms(o["head"])
        o["primary"], o["forms"] = prim, forms
        for f in forms:
            old_by_form[f].append(o)
        old_primary.setdefault(prim, []).append(o)
    lv_old = collections.Counter(o["level"] for o in old_recs)
    say(f"[91] 舊版條目數: {len(old_recs)}；各級: " +
        "、".join(f"L{k}={lv_old[k]}" for k in sorted(lv_old, key=lambda x: (x is None, x))))

    matched_old_ids = set()
    added, matrix = [], collections.Counter()
    level_changes = []
    for r in new_recs:
        forms = [r["word"].lower()] + [v.lower() for v in r["variants"]]
        any_form = [o for f in forms for o in old_by_form.get(f, [])]
        for o in any_form:                     # 新版任一詞形出現在舊版 → 該舊條目不算刪除
            matched_old_ids.add(id(o))
        # 級別比對優先用主要詞形相同的舊條目（同形異義 (1)(2) 取最低級）
        cands = old_primary.get(forms[0]) or any_form
        if not cands:
            added.append(r)
            continue
        levels = [o["level"] for o in cands if o["level"]]
        old_lv = min(levels) if levels else None
        matrix[(old_lv, r["level"])] += 1
        if old_lv and old_lv != r["level"]:
            level_changes.append((r, old_lv))
    removed = [o for o in old_recs if id(o) not in matched_old_ids]

    say(f"[91] 新版 {len(new_recs)} 筆中：在舊版找得到 {len(new_recs) - len(added)} 筆、"
        f"舊版沒有（新增）{len(added)} 筆（{len(added) / len(new_recs):.1%}）")
    say(f"[91] 舊版 {len(old_recs)} 筆中：新版沒有對應（刪除或併入）{len(removed)} 筆")
    say("[91] 級別對照（列＝舊版級別，欄＝新版級別；舊版同形異義取最低級）")
    say("        " + "".join(f"新L{j:<4}" for j in range(1, 7)))
    for i in range(1, 7):
        say(f"  舊L{i}  " + "".join(f"{matrix[(i, j)]:<6}" for j in range(1, 7)))
    by_new_level = collections.Counter(r["level"] for r in added)
    say("[91] 新增詞條在新版的級別分布: " + "、".join(f"L{k}={by_new_level[k]}" for k in range(1, 7)))
    by_old_level = collections.Counter(o["level"] for o in removed)
    say("[91] 刪除詞條在舊版的級別分布: " + "、".join(f"L{k}={by_old_level[k]}" for k in range(1, 7)))
    if diff_out:
        diff_out.parent.mkdir(parents=True, exist_ok=True)
        diff_out.write_text(json.dumps({
            "added": [{"word": r["word"], "level": r["level"], "raw": r["raw"]} for r in added],
            "removed": [{"head": o["head"], "pos": o["pos_text"], "level": o["level"]} for o in removed],
            "level_changes": [{"word": r["word"], "old": ol, "new": r["level"]} for r, ol in level_changes],
            "matrix": {f"{i}->{j}": n for (i, j), n in sorted(matrix.items(), key=str)},
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        say(f"[91] 差異明細已寫入 {diff_out}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--sample", type=int, default=0, help="隨機抽樣 N 筆，列出頁碼供人工回 PDF 核對")
    ap.add_argument("--seed", type=int, default=115)
    ap.add_argument("--legacy91", type=Path, default=None,
                    help="舊版 91 參考詞彙表 4.pdf 路徑；提供時輸出新舊版差異統計")
    ap.add_argument("--diff-out", type=Path, default=None, help="新舊版差異明細 JSON（選用）")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    anomalies: list[str] = []
    with pdfplumber.open(args.pdf) as pdf:
        level_pages, alpha_pages = find_sections(pdf)
        lvl_entries = split_entries(pdf, level_pages, "level", anomalies)
        alpha_entries = split_entries(pdf, alpha_pages, "alpha", anomalies)
    lvl_recs = build_records(lvl_entries, "level", anomalies)
    alpha_recs = build_records(alpha_entries, "alpha", anomalies)

    # ---- 交叉比對：以（詞彙原文, 詞類原文）為鍵 -------------------------------
    def key(r):
        return (re.sub(r"\s+", " ", r["head"]).strip(), r["pos_text"])

    lvl_index = collections.defaultdict(list)
    for r in lvl_recs:
        lvl_index[key(r)].append(r)
    alpha_keys = collections.Counter(key(r) for r in alpha_recs)
    cross = {"matched": 0, "level_mismatch": [], "only_alpha": [], "only_level": []}
    for r in alpha_recs:
        cands = lvl_index.get(key(r))
        if not cands:
            # 退一步只比詞彙原文（詞類換行時可能有差異）
            alt = [x for k, v in lvl_index.items() if k[0] == key(r)[0] for x in v]
            if alt:
                anomalies.append(f"[cross] {r['raw']!r}：詞類不一致，依級別排序為 {[x['pos_text'] for x in alt]}")
                cands = alt
            else:
                cross["only_alpha"].append(r["raw"])
                continue
        c = cands.pop(0)
        r["level_page"] = c["page"]
        if c["level"] != r["level"]:
            cross["level_mismatch"].append(f"{r['raw']!r} 依字母={r['level']} 依級別={c['level']}（p.{c['page']}）")
        else:
            cross["matched"] += 1
    for k, v in lvl_index.items():
        for c in v:
            cross["only_level"].append(f"{c['raw']!r}（第{c['level']}級 p.{c['page']}）")
    for k, n in alpha_keys.items():
        if n > 1:
            anomalies.append(f"[alpha] 重複條目（詞彙＋詞類相同）{k} ×{n}")

    # ---- 輸出 ---------------------------------------------------------------
    out = []
    for r in alpha_recs:
        out.append({
            "word": r["word"],
            "level": r["level"],
            "pos": r["pos"],
            "variants": r["variants"],
            "raw": r["raw"],
            "pages": {"alpha": r["page"], "level": r.get("level_page")},
            "tags": r["notes"],
        })
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # 一筆一行：方便 git diff 與人工檢視，仍是合法 JSON 陣列
    body = ",\n".join(json.dumps(r, ensure_ascii=False) for r in out)
    args.out.write_text("[\n" + body + "\n]\n", encoding="utf-8")

    # ---- 報告 ---------------------------------------------------------------
    def say(*a):
        if not args.quiet:
            print(*a)

    say(f"PDF: {args.pdf}")
    say(f"依級別排序頁（PDF index）: {level_pages[0]}–{level_pages[-1]}；依字母排序頁: {alpha_pages[0]}–{alpha_pages[-1]}")
    say(f"依字母排序條目數: {len(alpha_recs)}；依級別排序條目數: {len(lvl_recs)}")
    ca = collections.Counter(r["level"] for r in alpha_recs)
    cl = collections.Counter(r["level"] for r in lvl_recs)
    say("級別  依字母  依級別")
    for lv in range(1, 7):
        say(f"  {lv}   {ca[lv]:5d}  {cl[lv]:5d}")
    say(f"  計   {sum(ca.values()):5d}  {sum(cl.values()):5d}")
    say(f"交叉比對一致: {cross['matched']}；級別不一致: {len(cross['level_mismatch'])}；"
        f"只在依字母: {len(cross['only_alpha'])}；只在依級別: {len(cross['only_level'])}")
    for k in ("level_mismatch", "only_alpha", "only_level"):
        for x in cross[k]:
            say(f"  [{k}] {x}")
    note_counter = collections.Counter(n for r in alpha_recs for n in r["notes"])
    say(f"條目型態統計: {dict(note_counter)}")
    say(f"解析異常 {len(anomalies)} 筆：")
    for a in anomalies:
        say("  " + a)
    if args.sample:
        rng = random.Random(args.seed)
        say(f"隨機抽樣 {args.sample} 筆（seed={args.seed}）：")
        for r in rng.sample(out, args.sample):
            say(f"  p.{r['pages']['alpha']:>3} / 級別頁 p.{r['pages']['level']}  "
                f"L{r['level']}  {r['word']}  {'/'.join(r['pos'])}  raw={r['raw']!r}")
    say(f"已寫入 {args.out}（{len(out)} 筆）")
    if args.legacy91:
        legacy_anoms: list[str] = []
        old_recs = parse_legacy91(args.legacy91, legacy_anoms)
        for a in legacy_anoms:
            say("  " + a)
        compare_with_legacy(alpha_recs, old_recs, say, args.diff_out)
    ok = not (cross["level_mismatch"] or cross["only_alpha"] or cross["only_level"])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
