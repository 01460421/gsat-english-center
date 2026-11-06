#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把大考中心官方 Word 版數學題本（.docx）轉成「解析草稿」純文字：
段落文字照錄，MathType 公式換成 $LaTeX$（tools/mathtype_latex.py），
圖片寫成 [[IMG media/imageN.png]]，表格寫成 [[TABLE]] 列｜格。

草稿只是起點：公式轉換、段落順序都可能有誤，最後一定要對照 PDF 頁面影像
逐題校對（docs/math-exam-json-schema.md §校對）。

輸入是不可信檔案：只用 zipfile + xml.etree 讀取，不執行任何內容。請用
`python3 -I tools/docx_math_draft.py <paper.docx> [--out draft.txt]` 執行。
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mathtype_latex as ml  # noqa: E402

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "o": "urn:schemas-microsoft-com:office:office",
    "v": "urn:schemas-microsoft-com:vml",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}
W = "{%s}" % NS["w"]
R_ID = "{%s}id" % NS["r"]
R_EMBED = "{%s}embed" % NS["r"]
MAX_XML = 50 * 1024 * 1024  # 不可信輸入：限制解壓後大小


def _read(z, name):
    info = z.getinfo(name)
    if info.file_size > MAX_XML:
        raise ValueError(f"{name} too large")
    return z.read(name)


def load_rels(z):
    rels = {}
    root = ET.fromstring(_read(z, "word/_rels/document.xml.rels"))
    for rel in root:
        rels[rel.get("Id")] = rel.get("Target")
    return rels


def load_numbering(z):
    """numbering.xml → ({numId: (abstractId, {ilvl: start_override})}, {abstractId: {ilvl: (fmt, text, start)}})."""
    if "word/numbering.xml" not in z.namelist():
        return {}, {}
    root = ET.fromstring(_read(z, "word/numbering.xml"))
    abstracts = {}
    for an in root.findall("w:abstractNum", NS):
        aid = an.get(W + "abstractNumId")
        lv = {}
        for l in an.findall("w:lvl", NS):
            il = int(l.get(W + "ilvl"))
            fmt = l.find("w:numFmt", NS)
            txt = l.find("w:lvlText", NS)
            st = l.find("w:start", NS)
            lv[il] = (fmt.get(W + "val") if fmt is not None else "decimal",
                      txt.get(W + "val") if txt is not None else "",
                      int(st.get(W + "val")) if st is not None else 1)
        abstracts[aid] = lv
    nums = {}
    for n in root.findall("w:num", NS):
        nid = n.get(W + "numId")
        a = n.find("w:abstractNumId", NS)
        overrides = {}
        for o in n.findall("w:lvlOverride", NS):
            so = o.find("w:startOverride", NS)
            if so is not None:
                overrides[int(o.get(W + "ilvl"))] = int(so.get(W + "val"))
        nums[nid] = (a.get(W + "val") if a is not None else None, overrides)
    return nums, abstracts


SYM_MAP = {("MT Extra", "F086"): "→", ("Symbol", "F0AE"): "→", ("Symbol", "F0BE"): "¯",
           ("MT Extra", "F03F"): "¯", ("Symbol", "F0B0"): "°", ("Symbol", "F0B4"): "×",
           ("Symbol", "F0A3"): "≤", ("Symbol", "F0B3"): "≥", ("Symbol", "F0B9"): "≠",
           ("Symbol", "F02D"): "−", ("Symbol", "F0D0"): "∠", ("Symbol", "F044"): "Δ",
           ("Symbol", "F070"): "π", ("Symbol", "F071"): "θ", ("Symbol", "F0BB"): "≈",
           ("Symbol", "F0B1"): "±", ("Symbol", "F0D6"): "√", ("Symbol", "F05E"): "⊥"}


def sym_char(font, char):
    font = font or ""
    char = (char or "").upper()
    if (font, char) in SYM_MAP:
        return SYM_MAP[(font, char)]
    return f"[[SYM {font} {char}]]"


def _eq_parse(s, i, warnings):
    """Word EQ 欄位語法的極簡剖析器：回傳 (LaTeX, 新位置)；遇到頂層 , ; ) 停止。"""
    out = []
    while i < len(s):
        c = s[i]
        if c in ",;)":
            break
        if c == "\\" and i + 1 < len(s) and s[i + 1].isalpha():
            j = i + 1
            while j < len(s) and s[j].isalpha():
                j += 1
            cmd = s[i + 1:j].lower()
            opts = []
            # 選項：\up5、\do 5、\lc\{、\ac 等
            while j < len(s) and s[j] == "\\" and j + 1 < len(s) and s[j + 1].isalpha():
                k = j + 1
                while k < len(s) and s[k].isalpha():
                    k += 1
                name = s[j + 1:k].lower()
                while k < len(s) and s[k] == " ":
                    k += 1
                m = re.match(r"-?\d+", s[k:])
                val = ""
                if m:
                    val = m.group(0)
                    k += len(val)
                elif name in ("lc", "rc", "bc") and k < len(s):
                    if s[k] == "\\" and k + 1 < len(s):
                        val = s[k + 1]
                        k += 2
                    else:
                        val = s[k]
                        k += 1
                opts.append((name, val))
                j = k
            while j < len(s) and s[j] == " ":
                j += 1
            args = []
            if j < len(s) and s[j] == "(":
                j += 1
                while True:
                    a, j = _eq_parse(s, j, warnings)
                    args.append(a)
                    if j >= len(s):
                        break
                    if s[j] in ",;":
                        j += 1
                        continue
                    if s[j] == ")":
                        j += 1
                        break
            out.append(_eq_cmd(cmd, opts, args, warnings))
            i = j
            continue
        if c == "(":
            a, j = _eq_parse(s, i + 1, warnings)
            out.append("(" + a + ")")
            i = j + 1 if j < len(s) else j
            continue
        out.append(c)
        i += 1
    return "".join(out), i


def _eq_cmd(cmd, opts, args, warnings):
    o = dict(opts)
    if cmd == "d":  # 位移／間距
        return ""
    if cmd == "x":  # 外框：選填題的作答格
        return "[[BOX %s]]" % "".join(args).strip()
    if cmd == "o":  # overlay
        def bare(a):
            return re.sub(r"^[\^_]\{(.*)\}$", r"\1", a.strip()).strip()
        syms = [a for a in args if bare(a) in ("→", "¯", "―", "—", "-", "‾")]
        body = [a for a in args if a not in syms]
        b = (body[0] if body else "").strip()
        if any(bare(x) == "→" for x in syms):
            return r"\overrightarrow{%s}" % b
        if syms:
            return r"\overline{%s}" % b
        return "".join(args)
    if cmd == "s":
        a = "".join(args)
        if "up" in o:
            return "^{%s}" % a
        if "do" in o:
            return "_{%s}" % a
        return a
    if cmd == "f" and len(args) == 2:
        return r"\frac{%s}{%s}" % (args[0], args[1])
    if cmd == "r":
        if len(args) == 2 and args[0].strip():
            return r"\sqrt[%s]{%s}" % (args[0], args[1])
        return r"\sqrt{%s}" % args[-1] if args else r"\sqrt{}"
    if cmd == "b":
        l = o.get("lc", "(")
        r = o.get("rc", ")") if "lc" not in o or "rc" in o else "."
        if "bc" in o:
            l = o["bc"]
            r = {"(": ")", "[": "]", "{": "}", "|": "|"}.get(l, l)
        def fx(x):
            return {"{": r"\{", "}": r"\}", "": "."}.get(x, x)
        return r"\left%s %s \right%s" % (fx(l), "".join(args), fx(r))
    if cmd == "a":
        return r"\begin{matrix}" + r" \\ ".join(args) + r"\end{matrix}"
    warnings.append(f"EQ field \\{cmd} not converted")
    return "[[EQ \\%s %s]]" % (cmd, ",".join(args))


def field_to_text(instr, result, warnings):
    """Word 欄位 → 文字。EQ 欄位轉成 $LaTeX$；其他欄位用顯示結果。"""
    st = instr.strip()
    if st.upper().startswith("EQ"):
        tex, _ = _eq_parse(st[2:].strip(), 0, warnings)
        tex = tex.replace("→", r"\to ").replace("−", "-").replace("≤", r"\le ") \
                 .replace("≥", r"\ge ").replace("Δ", r"\Delta ").replace("°", r"^{\circ}")
        return "$" + tex.strip() + "$"
    return result


def _fmt_num(fmt, n):
    if fmt == "decimal" or fmt == "decimalFullWidth":
        return str(n)
    if fmt == "upperLetter":
        return chr(64 + n)
    if fmt == "lowerLetter":
        return chr(96 + n)
    if fmt == "taiwaneseCountingThousand" or fmt == "ideographTraditional":
        return "一二三四五六七八九十"[n - 1] if 1 <= n <= 10 else str(n)
    if fmt == "bullet":
        return ""
    return str(n)


class Walker:
    def __init__(self, z):
        self.z = z
        self.rels = load_rels(z)
        self.nums, self.abstracts = load_numbering(z)
        self.counters = {}
        self.seen_num = set()
        self.fld = []
        self.cache = {}
        self.stats = {"equations": 0, "eq_errors": 0, "images": 0}
        self.warnings = []

    def eq(self, rid):
        target = self.rels.get(rid)
        if not target:
            return "[[EQ?]]"
        name = "word/" + target if not target.startswith("/") else target[1:]
        if name in self.cache:
            return self.cache[name]
        self.stats["equations"] += 1
        try:
            tex, warns = ml.ole_to_latex(_read(self.z, name))
            if warns:
                self.warnings.append(f"{target}: {warns}")
            out = f"${tex}$"
        except Exception as e:  # noqa: BLE001  壞檔不中斷整份
            self.stats["eq_errors"] += 1
            out = f"[[EQ-ERROR {target}: {type(e).__name__}]]"
        self.cache[name] = out
        return out

    def run_text(self, el):
        """一個 w:r 或其他行內節點的文字；處理 Word 欄位（EQ 欄位轉 LaTeX）。"""
        out = []
        for node in el.iter():
            tag = node.tag
            fs = self.fld
            if tag == W + "fldChar":
                t = node.get(W + "fldCharType")
                if t == "begin":
                    fs.append({"instr": [], "result": [], "phase": "instr", "outer": out})
                    out = fs[-1]["result"]
                elif t == "separate" and fs:
                    fs[-1]["phase"] = "result"
                elif t == "end" and fs:
                    f = fs.pop()
                    out = f["outer"]
                    out.append(field_to_text("".join(f["instr"]), "".join(f["result"]),
                                             self.warnings))
                continue
            if fs and fs[-1]["phase"] == "instr":
                if tag == W + "instrText":
                    fs[-1]["instr"].append(node.text or "")
                elif tag == W + "sym":
                    fs[-1]["instr"].append(sym_char(node.get(W + "font"), node.get(W + "char")))
                continue
            if tag == W + "sym":
                out.append(sym_char(node.get(W + "font"), node.get(W + "char")))
            elif tag == W + "t":
                out.append(node.text or "")
            elif tag == W + "tab":
                out.append("\t")
            elif tag in (W + "br", W + "cr"):
                out.append("\n")
            elif tag == "{%s}OLEObject" % NS["o"]:
                prog = node.get("ProgID") or ""
                rid = node.get(R_ID)
                if prog.startswith("Equation"):
                    out.append(self.eq(rid))
                else:
                    out.append(f"[[OLE {prog} {self.rels.get(rid)}]]")
            elif tag == "{%s}imagedata" % NS["v"]:
                # 公式物件的預覽圖（WMF）略過；只有獨立圖片才輸出
                pass
            elif tag == "{%s}blip" % NS["a"]:
                rid = node.get(R_EMBED)
                self.stats["images"] += 1
                out.append(f"[[IMG {self.rels.get(rid)}]]")
        if self.fld:  # 欄位跨越 run：先交還外層，文字留在欄位結果裡
            return ""
        return "".join(out)

    def list_label(self, p):
        """段落若使用 Word 自動編號，回傳編號字串（例如「3.\t」「(2) 」）。"""
        ppr = p.find("w:pPr", NS)
        num = ppr.find("w:numPr", NS) if ppr is not None else None
        if num is None:
            return ""
        nid_el, il_el = num.find("w:numId", NS), num.find("w:ilvl", NS)
        if nid_el is None:
            return ""
        nid = nid_el.get(W + "val")
        il = int(il_el.get(W + "val")) if il_el is not None else 0
        if nid == "0" or nid not in self.nums:
            return ""
        aid, overrides = self.nums[nid]
        lv = self.abstracts.get(aid, {})
        if il not in lv:
            return ""
        fmt, text, start = lv[il]
        if nid not in self.seen_num:
            self.seen_num.add(nid)
            for k, v in overrides.items():
                self.counters[(aid, k)] = v - 1
        key = (aid, il)
        self.counters[key] = self.counters.get(key, start - 1) + 1
        for deeper in [k for k in self.counters if k[0] == aid and k[1] > il]:
            del self.counters[deeper]
        out = text
        for lvl in range(il + 1):
            f = lv.get(lvl, ("decimal", "", 1))[0]
            n = self.counters.get((aid, lvl), lv.get(lvl, ("", "", 1))[2])
            out = out.replace("%%%d" % (lvl + 1), _fmt_num(f, n))
        if fmt == "bullet" or not out:
            return ""
        return out + ("\t" if out.endswith(".") else " ")

    def paragraph(self, p):
        self.fld = []
        parts = [self.list_label(p)]
        # 文字方塊（圖上的標籤）與 VML 備援內容：先拆出來，避免混進題幹或重複
        parent = {c: q for q in p.iter() for c in q}
        for fb in list(p.iter("{%s}Fallback" % NS["mc"])):
            parent[fb].remove(fb)
        boxes = []
        for tx in list(p.iter(W + "txbxContent")):
            t = " ".join(filter(None, (self.paragraph_plain(q) for q in tx.iter(W + "p"))))
            if t.strip():
                boxes.append(t.strip())
            if tx in parent:
                parent[tx].remove(tx)
        if boxes:
            parts.append("[[TXBX %s]]" % " | ".join(boxes))
        for child in p:
            if child.tag in (W + "r", W + "hyperlink", W + "smartTag", W + "ins"):
                parts.append(self.run_text(child))
            elif child.tag == "{%s}AlternateContent" % NS["mc"]:
                choice = child.find("mc:Choice", NS)
                parts.append(self.run_text(choice if choice is not None else child))
            elif child.tag == "{%s}oMath" % NS["m"] or child.tag == "{%s}oMathPara" % NS["m"]:
                parts.append("[[OMML]]")
        # 圖片放在 v:shape（非公式）時，w:pict／w:object 也要掃
        for pict in list(p.iter(W + "pict")) + list(p.iter(W + "object")):
            if pict.find(".//o:OLEObject", NS) is None:
                for img in pict.iter("{%s}imagedata" % NS["v"]):
                    self.stats["images"] += 1
                    parts.append(f"[[IMG {self.rels.get(img.get(R_ID))}]]")
        return "".join(parts)

    def paragraph_plain(self, p):
        saved = self.fld
        self.fld = []
        out = "".join(self.run_text(r) for r in p if r.tag == W + "r")
        self.fld = saved
        return out

    def table(self, tbl):
        lines = ["[[TABLE]]"]
        for tr in tbl.findall("w:tr", NS):
            cells = []
            for tc in tr.findall("w:tc", NS):
                txt = " / ".join(self.paragraph(p) for p in tc.findall(".//w:p", NS)).strip()
                cells.append(txt)
            lines.append(" ｜ ".join(cells))
        lines.append("[[/TABLE]]")
        return "\n".join(lines)

    def body(self):
        root = ET.fromstring(_read(self.z, "word/document.xml"))
        body = root.find("w:body", NS)
        out = []
        for el in body:
            if el.tag == W + "p":
                t = self.paragraph(el)
                if t.strip():
                    out.append(t.rstrip())
            elif el.tag == W + "tbl":
                out.append(self.table(el))
            elif el.tag == "{%s}AlternateContent" % NS["mc"]:
                for p in el.iter(W + "p"):
                    t = self.paragraph(p)
                    if t.strip():
                        out.append(t.rstrip())
        return out


def draft(path):
    with zipfile.ZipFile(path) as z:
        w = Walker(z)
        lines = w.body()
    text = "\n".join(lines)
    text = re.sub(r"[ 　]+\n", "\n", text)
    return text, w.stats, w.warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("docx")
    ap.add_argument("--out")
    a = ap.parse_args(argv)
    text, stats, warns = draft(a.docx)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    else:
        print(text)
    print(f"[draft] {stats} warnings={len(warns)}", file=sys.stderr)
    for x in warns:
        print("  " + x, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
