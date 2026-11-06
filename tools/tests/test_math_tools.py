"""數學題本工具的基本測試：MTEF→LaTeX、Word EQ 欄位、選項切分、表格抽取、validator。

執行：python3 -m unittest tools/tests/test_math_tools.py
"""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import build_math_exam as bme  # noqa: E402
import docx_math_draft as dd  # noqa: E402
import mathtype_latex as ml  # noqa: E402
import merge_math_stats as mms  # noqa: E402
import validate_math_exam as vme  # noqa: E402


def eqn_native(mtef_body: bytes) -> bytes:
    """組一個最小的 Equation Native 串流：28 bytes 標頭＋MTEF v5。"""
    header = struct.pack("<H", 28) + b"\0" * 26
    mtef = bytes([5, 1, 0, 7, 10]) + b"DSMT7\0" + bytes([0])
    return header + mtef + mtef_body


def char(c, tf=3):
    return bytes([2, 0, tf + 128]) + struct.pack("<H", ord(c))


def line(*objs):
    return bytes([1, 0]) + b"".join(objs) + bytes([0])


class MtefTest(unittest.TestCase):
    def tex(self, body):
        _, nodes = ml.parse_mtef(eqn_native(body))
        w = []
        return ml.tidy(ml.to_tex(nodes, w)), w

    def test_fraction(self):
        frac = bytes([3, 0, 11, 0, 0]) + line(char("1", 8)) + line(char("2", 8)) + bytes([0])
        tex, w = self.tex(line(frac) + bytes([0]))
        self.assertEqual(tex, r"\frac{1}{2}")
        self.assertEqual(w, [])

    def test_subscript_attaches_to_previous(self):
        sub = bytes([3, 0, 27, 0, 0]) + line(char("1", 8)) + bytes([1, 1]) + bytes([0])
        tex, _ = self.tex(line(char("a"), sub) + bytes([0]))
        self.assertEqual(tex, "a_{1}")

    def test_vector_via_limit_template(self):
        # MathType 7 以「上方字」模板 + U+20D1 表示向量箭號
        lim = bytes([3, 0, 23, 32, 0]) + line(char("v")) + bytes([1, 1]) + \
            line(bytes([2, 0, 127]) + struct.pack("<H", 0x20D1)) + bytes([0])
        tex, _ = self.tex(line(lim) + bytes([0]))
        self.assertEqual(tex, r"\overrightarrow{v}")

    def test_missing_trailing_end_is_tolerated(self):
        tex, _ = self.tex(line(char("x")))
        self.assertEqual(tex, "x")

    def test_garbage_raises_value_error(self):
        with self.assertRaises(ValueError):
            ml.parse_mtef(eqn_native(bytes([1, 0, 99])))
        with self.assertRaises(ValueError):
            ml.cfb_stream(b"not an ole file" * 50, "Equation Native")

    def test_tidy(self):
        self.assertEqual(ml.tidy(r"x_{1}+\cdot \cdot \cdot+x_{n}"), r"x_{1}+\cdots+x_{n}")
        self.assertEqual(ml.tidy(r"\frac{\quad a\quad}{b}"), r"\frac{a}{b}")
        self.assertEqual(ml.tidy(r"-\,6"), "-6")


class EqFieldTest(unittest.TestCase):
    def test_overlay_arrow(self):
        self.assertEqual(dd.field_to_text(r" EQ \o(\s\up 5(→),PQ)", "", []), r"$\overrightarrow{PQ}$")

    def test_fraction_and_root(self):
        self.assertEqual(dd.field_to_text(r"EQ \f(1,2)", "", []), r"$\frac{1}{2}$")
        self.assertEqual(dd.field_to_text(r"EQ \r(,3)", "", []), r"$\sqrt{3}$")

    def test_box_marks_fill_position(self):
        self.assertEqual(dd.field_to_text(r"EQ \x( )", "", []), "$[[BOX ]]$")

    def test_non_eq_field_uses_result(self):
        self.assertEqual(dd.field_to_text(" PAGE ", "3", []), "3")


class BuilderTest(unittest.TestCase):
    def test_option_marks_ignore_math(self):
        stem, opts = bme.split_options(["(1) $f(-20)\\le f(1)$\t(2) $f(1)<f(0)$"])
        self.assertEqual(stem, [])
        self.assertEqual(opts, {"1": "$f(-20)\\le f(1)$", "2": "$f(1)<f(0)$"})

    def test_leading_figure_marker_kept_in_stem(self):
        stem, opts = bme.split_options(["(3) a", "[[TXBX L]](4) b\t(5) c"])
        self.assertEqual(list(opts), ["3", "4", "5"])
        self.assertEqual([s.strip() for s in stem], ["[[TXBX L]]"])

    def test_extract_tables(self):
        lines, tables = bme.extract_tables(["前文", "[[TABLE]]", " ｜ 藍 ｜ 綠", "1號 ｜ 2 ｜", "[[/TABLE]]", "後文"])
        self.assertEqual(lines, ["前文", "[[TABLE:1]]", "後文"])
        self.assertEqual(tables[0]["rows"], [["", "藍", "綠"], ["1號", "2", ""]])


class OldEraTest(unittest.TestCase):
    """舊課綱（100–110）：答案檔解析、以答案卡列號寫的選填 template。"""

    def test_answer_text_old(self):
        txt = ("題號   答案          題號        答案\n"
               "1     5              13   1         25   －\n"
               "7    135    B        19   －    G    31   3\n"
               "8    1,4             20   9\n")
        mc, cells = bme.parse_answer_text_old(txt, 12)
        self.assertEqual(mc, {"1": ["5"], "7": ["1", "3", "5"], "8": ["1", "4"]})
        self.assertEqual(cells, {"13": "1", "25": "-", "19": "-", "31": "3", "20": "9"})

    def test_apply_official_template(self):
        it = {"no": 16, "label": "C", "type": "fill"}
        rows = bme.apply_official_template(it, r"\frac{[[19]]}{[[20]][[21]]}",
                                           {"19": "1", "20": "1", "21": "4"})
        self.assertEqual(rows, ["19", "20", "21"])
        f = it["fill"]
        self.assertEqual(f["cells"], ["16-1", "16-2", "16-3"])
        self.assertEqual(f["template"], r"\frac{[[16-1]]}{[[16-2]][[16-3]]}")
        self.assertEqual(f["answer_latex"], r"\frac{1}{14}")
        with self.assertRaises(ValueError):
            bme.apply_official_template(dict(it), "[[21]][[20]]", {"20": "1", "21": "4"})

    def test_finalize_requires_all_rows(self):
        doc = {"_fill_key": {"14": "3", "15": "7"},
               "sections": [{"groups": [{"items": [{"type": "fill", "fill": {"official_cells": ["14"]}}]}]}]}
        with self.assertRaises(ValueError):
            bme.finalize_old_fill(doc)


class ValidatorTest(unittest.TestCase):
    def test_repo_file_passes(self):
        path = TOOLS.parent / "data" / "exams" / "parsed-math" / "gsat-matha-115.json"
        r = vme.validate(str(path), [])
        self.assertEqual(r.errors, [])

    def test_forbidden_answer_fields_rejected(self):
        path = TOOLS.parent / "data" / "exams" / "parsed-math" / "gsat-matha-115.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        d["sections"][3]["groups"][0]["items"][1]["scoring_notes"] = "評分原則…"
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "gsat-matha-115.json"
            p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            r = vme.validate(str(p), [])
        self.assertTrue(any("不得收錄" in e for e in r.errors))

    def test_era_must_match_id(self):
        path = TOOLS.parent / "data" / "exams" / "parsed-math" / "gsat-matha-115.json"
        d = json.loads(path.read_text(encoding="utf-8"))
        d["era"] = "舊課綱"
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "gsat-matha-115.json"
            p.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            r = vme.validate(str(p), [])
        self.assertTrue(any("era" in e for e in r.errors))


class MergeStatsTest(unittest.TestCase):
    """官方統計表的讀法（108 課綱的表：工作表數學A／數學B、只有選擇（填）題、儲存格前有空白）。"""

    PD = [
        ["111學年度學科能力測驗"] + [""] * 4,
        ["題號", "P", "Ph", "Pl", "T", "D"],
        ["1", "29.0", "35.0", "21.0", "", "14.0"],
        ["*7", "57.0", "73.0", "40.0", "37.0", "33.0"],
        ["13", "46.0", "69.0", "21.0", "", "48.0"],
        ["註：相關說明詳見國文科答對率及鑑別度表之備註。", "", "", "", "", ""],
    ]
    OA = [
        ["題號", "組別", "未答", "1.0", "2.0", "3.0", "4.0", "5.0", "6.0"],
        ["1", "T", "0.0", "5", "32", "9", "*29", "24", ""],
        ["", "H", "0.0", "1", "33", "3", "35", "28", ""],
        ["*7", "T", "1.0", "23", "*69", "27", "*87", "24", ""],
    ]

    def test_sources(self):
        self.assertEqual(mms.SOURCES["math_a"], ("gsat-matha", "數學A"))
        self.assertEqual(mms.SOURCES["math_b"], ("gsat-matha", "數學B"))
        self.assertEqual(mms.SOURCES["math"], ("gsat-math", "數學"))

    def test_read_pd(self):
        pd = mms.read_pd(self.PD)
        self.assertEqual(sorted(pd), [1, 7, 13])
        self.assertEqual(pd[7][0], True)
        self.assertEqual(pd[1][1]["P"], 0.29)
        self.assertIsNone(pd[13][1]["T"])

    def test_read_oa_marks_key(self):
        oa = mms.read_oa(self.OA)
        self.assertEqual(oa[1]["key"], ["4"])
        self.assertEqual(oa[7]["key"], ["2", "4"])
        self.assertEqual(oa[7]["T"]["4"], 0.87)
        self.assertEqual(oa[1]["omit"], 0.0)

    def test_repo_108_papers_have_stats_except_constructed(self):
        for name in ("gsat-matha-111", "gsat-mathb-115"):
            path = TOOLS.parent / "data" / "exams" / "parsed-math" / f"{name}.json"
            d = json.loads(path.read_text(encoding="utf-8"))
            for s in d["sections"]:
                for g in s["groups"]:
                    for it in g["items"]:
                        if it["type"] == "constructed":
                            self.assertNotIn("stats", it)
                        else:
                            self.assertIsInstance(it["stats"]["P"], float)


if __name__ == "__main__":
    unittest.main()
