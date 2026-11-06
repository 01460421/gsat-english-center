#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MathType（MTEF v5）方程式 → LaTeX 轉換器，只用 Python 標準庫。

用途：大考中心官方 Word 版數學題本（.docx）裡的公式是 MathType OLE 物件
（word/embeddings/oleObjectN.bin，Compound File 格式，內含 "Equation Native"
串流）。本模組讀出 MTEF 位元組，轉成 KaTeX 可以排版的 LaTeX 字串，作為
「解析草稿」；最後仍要對照 PDF 頁面影像逐式校對（見 docs/math-exam-json-schema.md）。

安全：輸入是從網路下載的不可信檔案。本模組只解析位元組，不執行任何內容；
所有長度與索引都做邊界檢查，壞檔丟 ValueError。呼叫端請用 `python3 -I`。

參考：Design Science, "MathType MTEF v.5"（MathType 4.0 起的方程式格式說明）
https://docs.wiris.com/mathtype/en/mathtype-office-tools/mathtype-7-for-windows-and-mac/mtef-v-5--mathtype-4-0-and-later-.html
（2026-11-06 依規格實作；規格未載或與實檔不符處以實際題本校對）。
"""
from __future__ import annotations

import struct

# ---------------------------------------------------------------------------
# Compound File Binary（OLE2）最小讀取器：只讀指定名稱的串流
# ---------------------------------------------------------------------------
_CFB_SIG = bytes.fromhex("D0CF11E0A1B11AE1")
_FREESECT, _ENDOFCHAIN = 0xFFFFFFFF, 0xFFFFFFFE


def cfb_stream(data: bytes, name: str) -> bytes:
    if len(data) < 512 or data[:8] != _CFB_SIG:
        raise ValueError("not a compound file")
    ssz = 1 << struct.unpack_from("<H", data, 0x1E)[0]
    mssz = 1 << struct.unpack_from("<H", data, 0x20)[0]
    n_fat = struct.unpack_from("<I", data, 0x2C)[0]
    dir_start = struct.unpack_from("<I", data, 0x30)[0]
    cutoff = struct.unpack_from("<I", data, 0x38)[0]
    minifat_start = struct.unpack_from("<I", data, 0x3C)[0]
    difat_next = struct.unpack_from("<I", data, 0x44)[0]
    if ssz not in (512, 4096) or mssz != 64:
        raise ValueError("unexpected sector size")

    def sector(n):
        off = (n + 1) * ssz
        if n >= 0xFFFFFFFA or off + ssz > len(data):
            raise ValueError("sector out of range")
        return data[off:off + ssz]

    difat = [x for x in struct.unpack_from("<109I", data, 0x4C) if x != _FREESECT]
    guard = 0
    while difat_next not in (_ENDOFCHAIN, _FREESECT):
        s = sector(difat_next)
        vals = struct.unpack("<%dI" % (ssz // 4), s)
        difat += [x for x in vals[:-1] if x != _FREESECT]
        difat_next = vals[-1]
        guard += 1
        if guard > 10000:
            raise ValueError("DIFAT loop")
    fat = []
    for s in difat[:n_fat]:
        fat += struct.unpack("<%dI" % (ssz // 4), sector(s))

    def chain(start, table, limit):
        out, n, seen = [], start, set()
        while n not in (_ENDOFCHAIN, _FREESECT):
            if n in seen or n >= len(table) or len(out) > limit:
                raise ValueError("bad sector chain")
            seen.add(n)
            out.append(n)
            n = table[n]
        return out

    big_limit = len(data) // ssz + 1
    dir_bytes = b"".join(sector(s) for s in chain(dir_start, fat, big_limit))
    entries = []
    for i in range(0, len(dir_bytes) - 127, 128):
        e = dir_bytes[i:i + 128]
        nlen = struct.unpack_from("<H", e, 64)[0]
        ename = e[:max(0, nlen - 2)].decode("utf-16-le", "replace")
        etype = e[66]
        start, size = struct.unpack_from("<II", e, 116)
        entries.append((ename, etype, start, size))
    if not entries:
        raise ValueError("no directory")
    root = entries[0]
    for ename, etype, start, size in entries:
        if etype != 2 or ename != name:
            continue
        if size < cutoff:
            ministream = b"".join(sector(s) for s in chain(root[2], fat, big_limit))
            minifat = []
            for s in chain(minifat_start, fat, big_limit):
                minifat += struct.unpack("<%dI" % (ssz // 4), sector(s))
            parts = []
            for m in chain(start, minifat, len(ministream) // mssz + 1):
                off = m * mssz
                if off + mssz > len(ministream):
                    raise ValueError("mini sector out of range")
                parts.append(ministream[off:off + mssz])
            return b"".join(parts)[:size]
        return b"".join(sector(s) for s in chain(start, fat, big_limit))[:size]
    raise KeyError(name)


# ---------------------------------------------------------------------------
# MTEF v5 解析
# ---------------------------------------------------------------------------
END, LINE, CHAR, TMPL, PILE, MATRIX, EMBELL, RULER, FONT_STYLE_DEF, SIZE, FULL, SUB, \
    SUB2, SYM, SUBSYM, COLOR, COLOR_DEF, FONT_DEF, EQN_PREFS, ENCODING_DEF = range(20)

O_NUDGE = 0x08
O_CHAR_EMBELL = 0x01
O_CHAR_FUNC_START = 0x02
O_CHAR_ENC_CHAR_8 = 0x04
O_CHAR_ENC_CHAR_16 = 0x10
O_CHAR_ENC_NO_MTCODE = 0x20
O_LINE_NULL = 0x01
O_LINE_LSPACE = 0x04
O_LP_RULER = 0x02
O_COLOR_CMYK = 0x01
O_COLOR_SPOT = 0x02
O_COLOR_NAME = 0x04

FN_TEXT, FN_FUNCTION, FN_VARIABLE, FN_LCGREEK, FN_UCGREEK, FN_SYMBOL, FN_VECTOR, \
    FN_NUMBER, FN_USER1, FN_USER2, FN_MTEXTRA, FN_TEXT_FE = range(1, 13)
FN_EXPAND = 22


class Reader:
    def __init__(self, b: bytes):
        self.b, self.i = b, 0

    def u8(self):
        if self.i >= len(self.b):
            raise ValueError("unexpected end of MTEF")
        v = self.b[self.i]
        self.i += 1
        return v

    def u16(self):
        if self.i + 2 > len(self.b):
            raise ValueError("unexpected end of MTEF")
        v = struct.unpack_from("<H", self.b, self.i)[0]
        self.i += 2
        return v

    def cstr(self):
        j = self.b.find(b"\0", self.i)
        if j < 0:
            raise ValueError("unterminated string")
        s = self.b[self.i:j]
        self.i = j + 1
        return s.decode("latin-1")

    def peek(self):
        return self.b[self.i] if self.i < len(self.b) else END


def _nudge(r: Reader, opts: int):
    if opts & O_NUDGE:
        dx, dy = r.u8(), r.u8()
        if dx == 128 and dy == 128:
            r.u16()
            r.u16()


def _skip_nibbles(r: Reader, count: int):
    """EQN_PREFS 的尺寸陣列：每個值是一串 nibble，以 0xF 結束。"""
    done, hi = 0, None
    while done < count:
        if hi is None:
            byte = r.u8()
            nibs = [byte >> 4, byte & 0xF]
        for nb in nibs:
            if done >= count:
                break
            if nb == 0xF:
                done += 1
        hi = None


def _skip_dims(r: Reader, count: int):
    # nibble 串：第一個 nibble 是單位，接著數字，0xF 結束一個值；值與值可跨位元組
    done = 0
    buf = []
    while done < count:
        if not buf:
            byte = r.u8()
            buf = [byte >> 4, byte & 0xF]
        nb = buf.pop(0)
        if nb == 0xF:
            done += 1
    # 剩下的半個位元組直接丟棄（規格：陣列以位元組對齊）


class Node:
    __slots__ = ("kind", "attrs", "children")

    def __init__(self, kind, attrs=None, children=None):
        self.kind = kind
        self.attrs = attrs or {}
        self.children = children or []

    def __repr__(self):
        return f"Node({self.kind},{self.attrs},{self.children})"


def parse_objects(r: Reader, depth=0):
    """讀一串物件直到 END；回傳 Node 清單。"""
    if depth > 60:
        raise ValueError("MTEF nesting too deep")
    out = []
    while True:
        if depth == 0 and r.i >= len(r.b):
            return out  # 最外層允許沒有結尾的 END
        tag = r.u8()
        if tag == END:
            return out
        if tag == LINE:
            opts = r.u8()
            _nudge(r, opts)
            if opts & O_LINE_LSPACE:
                r.u16()
            if opts & O_LP_RULER:
                _skip_ruler(r)
            kids = [] if opts & O_LINE_NULL else parse_objects(r, depth + 1)
            out.append(Node("line", {"null": bool(opts & O_LINE_NULL)}, kids))
        elif tag == CHAR:
            opts = r.u8()
            _nudge(r, opts)
            tf = r.u8() - 128
            mt = None if opts & O_CHAR_ENC_NO_MTCODE else r.u16()
            fp = None
            if opts & O_CHAR_ENC_CHAR_8:
                fp = r.u8()
            if opts & O_CHAR_ENC_CHAR_16:
                fp = r.u16()
            embs = []
            if opts & O_CHAR_EMBELL:
                for e in parse_objects(r, depth + 1):
                    if e.kind == "embell":
                        embs.append(e.attrs["type"])
            out.append(Node("char", {"tf": tf, "mt": mt, "fp": fp, "emb": embs,
                                     "func": bool(opts & O_CHAR_FUNC_START)}))
        elif tag == TMPL:
            opts = r.u8()
            _nudge(r, opts)
            sel = r.u8()
            var = r.u8()
            if var & 0x80:
                var = (var & 0x7F) | (r.u8() << 7)
            topt = r.u8()
            kids = parse_objects(r, depth + 1)
            out.append(Node("tmpl", {"sel": sel, "var": var, "topt": topt}, kids))
        elif tag == PILE:
            opts = r.u8()
            _nudge(r, opts)
            halign, valign = r.u8(), r.u8()
            if opts & O_LP_RULER:
                _skip_ruler(r)
            kids = parse_objects(r, depth + 1)
            out.append(Node("pile", {"halign": halign, "valign": valign}, kids))
        elif tag == MATRIX:
            opts = r.u8()
            _nudge(r, opts)
            valign, hj, vj, rows, cols = r.u8(), r.u8(), r.u8(), r.u8(), r.u8()
            for n in (rows + 1, cols + 1):
                nbytes = (n * 2 + 7) // 8
                for _ in range(nbytes):
                    r.u8()
            kids = parse_objects(r, depth + 1)
            out.append(Node("matrix", {"rows": rows, "cols": cols, "hj": hj}, kids))
        elif tag == EMBELL:
            opts = r.u8()
            _nudge(r, opts)
            out.append(Node("embell", {"type": r.u8()}))
        elif tag == RULER:
            _skip_ruler_body(r)
        elif tag == FONT_STYLE_DEF:
            r.u8()
            r.u8()
        elif tag == SIZE:
            first = r.u8()
            if first == 101:
                r.u16()
            elif first == 100:
                r.u8()
                r.u16()
            else:
                r.u8()
        elif tag in (FULL, SUB, SUB2, SYM, SUBSYM):
            pass
        elif tag == COLOR:
            r.u8()
        elif tag == COLOR_DEF:
            opts = r.u8()
            for _ in range(4 if opts & O_COLOR_CMYK else 3):
                r.u16()
            if opts & O_COLOR_NAME:
                r.cstr()
        elif tag == FONT_DEF:
            r.u8()
            r.cstr()
        elif tag == EQN_PREFS:
            r.u8()  # options
            n = r.u8()
            _skip_dims(r, n)
            n = r.u8()
            _skip_dims(r, n)
            n = r.u8()
            for _ in range(n):
                if r.u8():
                    r.u8()
        elif tag == ENCODING_DEF:
            r.cstr()
        elif tag >= 100:
            n = r.u16()
            r.i += n
            if r.i > len(r.b):
                raise ValueError("future record overruns")
        else:
            raise ValueError(f"unknown MTEF record {tag} at {r.i - 1}")


def _skip_ruler(r: Reader):
    # 規格寫 RULER 紀錄含 tag；MathType 7 實檔有時省略 tag，直接接 n_stops
    if r.peek() == RULER:
        r.u8()
    _skip_ruler_body(r)


def _skip_ruler_body(r: Reader):
    n = r.u8()
    for _ in range(n):
        r.u8()
        r.u16()


def parse_mtef(eqn_native: bytes):
    """Equation Native 串流 → (header dict, Node 清單)。"""
    if len(eqn_native) < 28 + 5:
        raise ValueError("Equation Native too short")
    hdr_len = struct.unpack_from("<H", eqn_native, 0)[0]
    mt = eqn_native[hdr_len:]
    r = Reader(mt)
    ver = r.u8()
    if ver != 5:
        raise ValueError(f"unsupported MTEF version {ver}")
    platform, product, pver, psub = r.u8(), r.u8(), r.u8(), r.u8()
    app = r.cstr()
    eqn_opts = r.u8()
    nodes = parse_objects(r)
    return {"platform": platform, "product": product, "version": f"{pver}.{psub}",
            "app": app, "options": eqn_opts}, nodes


# ---------------------------------------------------------------------------
# Node → LaTeX
# ---------------------------------------------------------------------------
SYMBOLS = {
    0x2212: "-", 0x00B1: r"\pm", 0x2213: r"\mp", 0x00D7: r"\times", 0x00F7: r"\div",
    0x2264: r"\le", 0x2265: r"\ge", 0x2260: r"\ne", 0x2248: r"\approx", 0x2261: r"\equiv",
    0x221E: r"\infty", 0x2220: r"\angle", 0x22A5: r"\perp", 0x2225: r"\parallel",
    0x2026: r"\ldots", 0x22EF: r"\cdots", 0x22EE: r"\vdots", 0x22F1: r"\ddots",
    0x22C5: r"\cdot", 0x00B7: r"\cdot", 0x2219: r"\cdot", 0x2032: "'", 0x2033: "''",
    0x2208: r"\in", 0x2209: r"\notin", 0x2282: r"\subset", 0x2283: r"\supset",
    0x2286: r"\subseteq", 0x2287: r"\supseteq", 0x222A: r"\cup", 0x2229: r"\cap",
    0x2205: r"\varnothing", 0x2200: r"\forall", 0x2203: r"\exists", 0x00AC: r"\neg",
    0x2192: r"\to", 0x2190: r"\leftarrow", 0x2194: r"\leftrightarrow",
    0x21D2: r"\Rightarrow", 0x21D0: r"\Leftarrow", 0x21D4: r"\Leftrightarrow",
    0x2234: r"\therefore", 0x2235: r"\because", 0x00B0: r"^{\circ}", 0x2218: r"\circ",
    0x25B3: r"\triangle", 0x0394: r"\Delta", 0x2206: r"\Delta", 0x221D: r"\propto",
    0x2245: r"\cong", 0x223C: r"\sim", 0x2016: r"\|", 0x2223: r"\mid",
    0x2211: r"\sum", 0x220F: r"\prod", 0x222B: r"\int", 0x221A: r"\surd",
    0x2329: r"\langle", 0x232A: r"\rangle", 0x27E8: r"\langle", 0x27E9: r"\rangle",
    0x2309: r"\rceil", 0x2308: r"\lceil", 0x230A: r"\lfloor", 0x230B: r"\rfloor",
    0x2299: r"\odot", 0x2295: r"\oplus", 0x2297: r"\otimes", 0x2227: r"\wedge",
    0x2228: r"\vee", 0x25CB: r"\bigcirc", 0x2299 + 1: r"\circledcirc",
    0x00A0: "~", 0x2009: r"\,", 0x200A: r"\,", 0x2003: r"\quad", 0x2002: r"\;",
    0x2005: r"\,", 0x2006: r"\,", 0x2007: r"\,", 0x2008: r"\,", 0x200B: "",
    0x2061: "", 0x2062: "", 0x2063: "", 0x0302: "", 0x2016 + 1: "",
    0x0025: r"\%", 0x0023: r"\#", 0x0026: r"\&", 0x005F: r"\_", 0x007B: r"\{",
    0x007D: r"\}", 0x0024: r"\$", 0x005C: r"\backslash", 0x007E: r"\sim",
    0x2032 + 1000: "",
}
GREEK = {
    0x03B1: r"\alpha", 0x03B2: r"\beta", 0x03B3: r"\gamma", 0x03B4: r"\delta",
    0x03B5: r"\varepsilon", 0x03F5: r"\epsilon", 0x03B6: r"\zeta", 0x03B7: r"\eta",
    0x03B8: r"\theta", 0x03D1: r"\vartheta", 0x03B9: r"\iota", 0x03BA: r"\kappa",
    0x03BB: r"\lambda", 0x03BC: r"\mu", 0x03BD: r"\nu", 0x03BE: r"\xi", 0x03C0: r"\pi",
    0x03C1: r"\rho", 0x03C3: r"\sigma", 0x03C2: r"\varsigma", 0x03C4: r"\tau",
    0x03C5: r"\upsilon", 0x03C6: r"\phi", 0x03D5: r"\phi", 0x03C7: r"\chi",
    0x03C8: r"\psi", 0x03C9: r"\omega", 0x0393: r"\Gamma", 0x0398: r"\Theta",
    0x039B: r"\Lambda", 0x039E: r"\Xi", 0x03A0: r"\Pi", 0x03A3: r"\Sigma",
    0x03A5: r"\Upsilon", 0x03A6: r"\Phi", 0x03A8: r"\Psi", 0x03A9: r"\Omega",
}
# MT Extra 私用區與其他常見替代碼
MTEXTRA = {
    0xEB00: "", 0xEB01: "", 0xEB02: "", 0xEB03: "", 0xEB04: "", 0xEB05: "",
    0xEB06: "", 0xEB07: "", 0xEB08: "", 0xEB09: "",
    0xEC00: r"\overset{\frown}{}",  # 不應單獨出現
    0xEF01: r"\,", 0xEF02: r"\,", 0xEF03: r"\;", 0xEF04: r"\quad", 0xEF05: r"\quad",
    0xEF06: r"\,", 0xEF07: r"\,", 0xEF08: "",
    0xE98F: r"\overline{}",
}
FUNC_NAMES = {"sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "lim", "exp",
              "max", "min", "arg", "det", "deg", "gcd", "sinh", "cosh", "tanh"}


MATRIX_ENV = {("[", "]"): "bmatrix", ("(", ")"): "pmatrix", ("|", "|"): "vmatrix",
              (r"\|", r"\|"): "Vmatrix", (r"\{", r"\}"): "Bmatrix"}


class Unsupported(Exception):
    pass


def _char_tex(n: Node, warnings: list):
    mt, tf = n.attrs["mt"], n.attrs["tf"]
    if mt is None:
        warnings.append(f"char without MTCode (fp={n.attrs['fp']})")
        return "?"
    if mt in GREEK:
        s = GREEK[mt] + " "
    elif mt in SYMBOLS:
        s = SYMBOLS[mt]
    elif mt in MTEXTRA:
        s = MTEXTRA[mt]
    elif 0xE000 <= mt <= 0xF8FF:
        warnings.append(f"private-use char U+{mt:04X}")
        s = ""
    elif 0x4E00 <= mt <= 0x9FFF or 0x3000 <= mt <= 0x303F or 0xFF00 <= mt <= 0xFFEF:
        s = r"\text{" + chr(mt) + "}"
    elif mt == 0x20:
        s = r"\ " if tf == FN_TEXT else ""
    else:
        s = chr(mt)
    if tf == FN_TEXT and len(s) == 1 and s.isalpha():
        s = r"\text{" + s + "}"
    if s.startswith("\\") and s[-1].isalpha():
        s += " "  # 控制字後面接字母時要隔開（\quad a、\le x）
    for e in n.attrs["emb"]:
        s = _embell(s, e, warnings)
    return s


def _embell(s, e, warnings):
    m = {2: r"\dot{%s}", 3: r"\ddot{%s}", 4: r"\dddot{%s}", 5: "%s'", 6: "%s''",
         7: "{}'%s", 8: r"\tilde{%s}", 9: r"\hat{%s}", 10: r"\not %s",
         11: r"\overrightarrow{%s}", 12: r"\overleftarrow{%s}",
         13: r"\overleftrightarrow{%s}", 14: r"\overrightarrow{%s}",
         15: r"\overleftarrow{%s}", 16: r"\not %s", 17: r"\overline{%s}",
         18: "%s'''", 19: r"\overset{\frown}{%s}", 22: r"\overline{%s}",
         23: r"\underline{%s}"}.get(e)
    if m is None:
        warnings.append(f"embellishment {e}")
        return s
    return m % s.strip()


def _slot(n: Node | None, warnings):
    if n is None:
        return ""
    return to_tex([n], warnings)


def _fence_char(n: Node | None):
    if n is None or n.kind != "char" or n.attrs["mt"] is None:
        return None
    return n.attrs["mt"]


FENCE_TEX = {0x28: "(", 0x29: ")", 0x5B: "[", 0x5D: "]", 0x7B: r"\{", 0x7D: r"\}",
             0x7C: "|", 0x2016: r"\|", 0x2329: r"\langle", 0x232A: r"\rangle",
             0x27E8: r"\langle", 0x27E9: r"\rangle", 0x230A: r"\lfloor",
             0x230B: r"\rfloor", 0x2308: r"\lceil", 0x2309: r"\rceil",
             0x3008: r"\langle", 0x3009: r"\rangle"}


def _tmpl(n: Node, warnings):
    sel, var = n.attrs["sel"], n.attrs["var"]
    kids = n.children
    slots = [k for k in kids if k.kind in ("line", "pile", "matrix")]
    chars = [k for k in kids if k.kind == "char"]
    s0 = _slot(slots[0], warnings) if slots else ""
    if sel <= 9:  # 括號類：main slot + 左右括號字元
        default = {0: (r"\langle", r"\rangle"), 1: ("(", ")"), 2: (r"\{", r"\}"),
                   3: ("[", "]"), 4: ("|", "|"), 5: (r"\|", r"\|"),
                   6: (r"\lfloor", r"\rfloor"), 7: (r"\lceil", r"\rceil"),
                   8: ("[", "]"), 9: ("(", ")")}[sel]
        left = right = None  # 實際括號以模板內的括號字元為準（interval 也是）
        if chars:
            fc = [_fence_char(c) for c in chars]
            if len(fc) >= 2:
                left, right = FENCE_TEX.get(fc[0]), FENCE_TEX.get(fc[1])
            elif len(fc) == 1:
                t = FENCE_TEX.get(fc[0])
                if var & 0x1 and not var & 0x2:
                    left = t
                elif var & 0x2 and not var & 0x1:
                    right = t
                else:
                    left = t
        has_l = bool(var & 0x1) if sel != 9 else True
        has_r = bool(var & 0x2) if sel != 9 else True
        if sel != 9 and not (var & 0x3):
            has_l = has_r = True
        l = (left or default[0]) if has_l else "."
        r_ = (right or default[1]) if has_r else "."
        if l == "." and r_ == ".":
            return s0
        # 單邊大括號（聯立方程式）或含矩陣／多列時用 \left \right
        inner = slots[0].children if slots else []
        if len(inner) == 1 and inner[0].kind == "matrix" and (l, r_) in MATRIX_ENV:
            body = to_tex(inner, warnings)
            env = MATRIX_ENV[(l, r_)]
            return body.replace(r"\begin{matrix}", r"\begin{%s}" % env) \
                       .replace(r"\end{matrix}", r"\end{%s}" % env)
        if len(inner) == 1 and inner[0].kind == "pile" and l == r"\{" and r_ == ".":
            rows = [to_tex([k], warnings) for k in inner[0].children if k.kind == "line"]
            return r"\begin{cases}" + r" \\ ".join(rows) + r"\end{cases}"
        big = any(k.kind in ("pile", "matrix") for k in inner) or r"\frac" in s0 \
            or r"\sqrt" in s0 or r"\sum" in s0
        if big or l == "." or r_ == ".":
            return r"\left%s %s \right%s" % (l, s0, r_)
        sep = " " if l[-1].isalpha() else ""
        return f"{l}{sep}{s0}{r_}".strip()
    if sel == 10:  # root
        if var == 1 and len(slots) > 1:
            return r"\sqrt[%s]{%s}" % (_slot(slots[1], warnings), s0)
        return r"\sqrt{%s}" % s0
    if sel == 11:  # fraction
        s1 = _slot(slots[1], warnings) if len(slots) > 1 else ""
        if var & 0x2:  # slash fraction
            return f"{s0}/{s1}"
        return r"\frac{%s}{%s}" % (s0, s1)
    if sel == 12:
        return r"\underline{%s}" % s0
    if sel == 13:
        return r"\overline{%s}" % s0
    if sel == 14:  # arrow with text
        top = s0
        bot = _slot(slots[1], warnings) if len(slots) > 1 else ""
        a = r"\xrightarrow"
        return a + (f"[{bot}]" if bot else "") + "{" + top + "}"
    if sel in (15, 16, 17, 18, 19, 20, 21, 22):  # integrals and big operators
        op = {15: r"\int", 16: r"\sum", 17: r"\prod", 18: r"\coprod", 19: r"\bigcup",
              20: r"\bigcap", 21: r"\int", 22: r"\sum"}[sel]
        if chars and chars[-1].attrs["mt"] in (0x222C, 0x222D, 0x222E):
            op = {0x222C: r"\iint", 0x222D: r"\iiint", 0x222E: r"\oint"}[chars[-1].attrs["mt"]]
        lo = _slot(slots[1], warnings) if len(slots) > 1 else ""
        hi = _slot(slots[2], warnings) if len(slots) > 2 else ""
        s = op
        if lo:
            s += "_{" + lo + "}"
        if hi:
            s += "^{" + hi + "}"
        return s + " " + s0
    if sel == 23:  # limit／上下標字（MathType 也用它在字上方放箭頭、弧等記號）
        lo = _slot(slots[1], warnings) if len(slots) > 1 else ""
        hi = _slot(slots[2], warnings) if len(slots) > 2 else ""
        if s0.strip() in ("lim", r"\lim", r"\text{lim}"):
            return r"\lim" + ("_{" + lo + "}" if lo else "") + ("^{" + hi + "}" if hi else "")
        accent = {"\u20d1": r"\overrightarrow", "\u20d7": r"\overrightarrow",
                  r"\to": r"\overrightarrow", "\u20d6": r"\overleftarrow",
                  r"\leftarrow": r"\overleftarrow", "\u0305": r"\overline",
                  "\u00af": r"\overline", "\u2015": r"\overline", "\u0304": r"\overline",
                  "\u2322": r"\overgroup", "\u2312": r"\overgroup",
                  "\u0302": r"\widehat", "^": r"\widehat", "\u0303": r"\widetilde"}
        h = hi.strip()
        if not lo and h in accent:
            if accent[h] == r"\overgroup":
                return r"\overset{\frown}{%s}" % s0
            return accent[h] + "{" + s0 + "}"
        out = s0
        if hi:
            out = r"\overset{%s}{%s}" % (hi, out)
        if lo:
            out = r"\underset{%s}{%s}" % (lo, out)
        return out
    if sel in (24, 25):  # horizontal brace / bracket
        lab = _slot(slots[1], warnings) if len(slots) > 1 else ""
        cmd = r"\underbrace" if not (var & 0x1) else r"\overbrace"
        return cmd + "{" + s0 + "}" + (("_" if cmd == r"\underbrace" else "^") + "{" + lab + "}" if lab else "")
    if sel == 26:
        warnings.append("long division template")
        return s0
    if sel in (27, 28, 29):  # sub / sup / subsup（附在前一個元素上）
        sub = _slot(slots[0], warnings) if slots else ""
        sup = _slot(slots[1], warnings) if len(slots) > 1 else ""
        out = ""
        if sel in (27, 29) and sub:
            out += "_{" + sub + "}"
        if sel in (28, 29) and sup:
            out += "^{" + sup + "}"
        if sel == 28 and not sup and sub:
            out = "^{" + sub + "}"
        return out
    if sel == 30:
        return r"\langle %s \rangle" % s0
    if sel == 31:  # vector arrow
        if var & 0x8:  # 下方
            return r"\underrightarrow{%s}" % s0
        if var & 0x2 or var == 0:
            return r"\overrightarrow{%s}" % s0
        return r"\overrightarrow{%s}" % s0
    if sel == 32:
        return r"\widetilde{%s}" % s0
    if sel == 33:
        return r"\widehat{%s}" % s0
    if sel == 34:
        return r"\overset{\frown}{%s}" % s0
    if sel == 35:
        return s0
    if sel == 36:
        return r"\cancel{%s}" % s0
    if sel == 37:
        return r"\boxed{%s}" % s0
    warnings.append(f"unknown template {sel}")
    return s0


def to_tex(nodes, warnings):
    out = []
    i = 0
    flat = []
    for n in nodes:
        flat.append(n)
    while i < len(flat):
        n = flat[i]
        if n.kind == "line":
            out.append(to_tex(n.children, warnings))
        elif n.kind == "char":
            # 連續的函數名稱字元合併成 \sin 等
            if n.attrs["tf"] == FN_FUNCTION and n.attrs["mt"] and chr(n.attrs["mt"]).isalpha():
                j = i
                word = ""
                while j < len(flat) and flat[j].kind == "char" and \
                        flat[j].attrs["tf"] == FN_FUNCTION and flat[j].attrs["mt"] and \
                        chr(flat[j].attrs["mt"]).isalpha() and not flat[j].attrs["emb"]:
                    word += chr(flat[j].attrs["mt"])
                    j += 1
                if word in FUNC_NAMES:
                    out.append("\\" + word + " ")
                elif word:
                    out.append(r"\operatorname{" + word + "}")
                if j > i:
                    i = j
                    continue
            out.append(_char_tex(n, warnings))
        elif n.kind == "tmpl":
            out.append(_tmpl(n, warnings))
        elif n.kind == "pile":
            rows = [to_tex([k], warnings) for k in n.children if k.kind == "line"]
            out.append(r"\begin{matrix}" + r" \\ ".join(rows) + r"\end{matrix}"
                       if len(rows) > 1 else "".join(rows))
        elif n.kind == "matrix":
            rows, cols = n.attrs["rows"], n.attrs["cols"]
            cells = [to_tex([k], warnings) for k in n.children
                     if k.kind in ("line", "pile", "matrix")]
            lines = []
            for rr in range(rows):
                lines.append(" & ".join(cells[rr * cols:(rr + 1) * cols]))
            out.append(r"\begin{matrix}" + r" \\ ".join(lines) + r"\end{matrix}")
        i += 1
    return "".join(out)


def tidy(s: str) -> str:
    import re
    s = re.sub(r"\\text\{([^{}]*)\}\\text\{([^{}]*)\}", r"\\text{\1\2}", s)
    while True:
        t = re.sub(r"\\text\{([^{}]*)\}\\text\{([^{}]*)\}", r"\\text{\1\2}", s)
        if t == s:
            break
        s = t
    s = re.sub(r"\\cdot ?\\cdot ?\\cdot ?", r"\\cdots ", s)
    s = re.sub(r"\\,\s*(\\times|\\cdot|=|\+)", r"\1", s)   # 運算子前多餘的細空白
    s = re.sub(r"-\\,\s*", "-", s)                               # 負號後的細空白
    s = re.sub(r"(\\quad\s*)+(\\times)", r"\2", s)
    s = re.sub(r"\{\s*(\\quad\s*)+", "{", s)          # 分子、分母前後的排版空白
    s = re.sub(r"(\s*\\quad)+\s*\}", "}", s)
    s = re.sub(r"(\s*\\quad)+\s*$", "", s)
    s = re.sub(r" {2,}", " ", s)
    s = re.sub(r" +([}\)\],=+\-<>^_])", r"\1", s)
    s = re.sub(r"([{(\[]) +", r"\1", s)
    s = s.replace("\\left( ", "\\left(")
    return s.strip()


def ole_to_latex(ole_bytes: bytes):
    """oleObjectN.bin 內容 → (latex, warnings)。"""
    eq = cfb_stream(ole_bytes, "Equation Native")
    _, nodes = parse_mtef(eq)
    warnings: list = []
    tex = tidy(to_tex(nodes, warnings))
    return tex, warnings


if __name__ == "__main__":
    import sys
    for p in sys.argv[1:]:
        with open(p, "rb") as f:
            t, w = ole_to_latex(f.read())
        print(p, t, w if w else "")
