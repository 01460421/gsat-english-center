#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
檢查 data/exams/parsed-math/*.json 是否符合 `gsat-math-exam/v1`
（docs/math-exam-json-schema.md）。有 error 以 1 結束。

  python3 tools/validate_math_exam.py --all
  python3 tools/validate_math_exam.py data/exams/parsed-math/gsat-matha-115.json
  python3 tools/validate_math_exam.py --all --katex /path/to/node_modules/katex

--katex：另外用 KaTeX（node）實際排版每一段 $…$、選填 template、answer_latex，
排版失敗算 error。前端加入 KaTeX 相依後（P2），預設改用 apps/web 的 node_modules。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARSED = os.path.join(ROOT, "data", "exams", "parsed-math")
SCHEMA = "gsat-math-exam/v1"

ITEM_TYPES = {"single", "multi", "fill", "constructed"}
SECTION_TYPES = {"single", "multi", "fill", "mixed"}
UNITS = {
    "real_numbers", "polynomial", "exp_log", "sequence", "counting", "probability",
    "statistics", "trigonometry", "coordinate_line", "circle", "conics", "vector_plane",
    "vector_space", "space_line_plane", "matrix", "linear_system", "inequality_lp",
    "geometry", "functions", "logic_set", "data_modeling",
}
ERAS = {"108課綱", "舊課綱"}
STATS_KEYS = {"P", "Ph", "Pl", "D", "T", "options", "omit"}
FIG_KINDS = {"diagram", "graph", "chart", "table_image", "photo", "illustration", "other"}
FILL_CELL_VALUES = set("0123456789") | {"-", "±"}
# 這些欄位一出現就代表可能收進了官方參考答案或評分原則（受著作權保護，不得收錄）
FORBIDDEN_KEYS = {"scoring_notes", "reference_answer", "official_answer", "rubric",
                  "scoring_criteria", "solution_official"}
BAD_SPACE = re.compile(r"[\u00a0\u2000-\u200b\u202f\u205f\u2028\u2029\ufeff\u00ad\t]")


class Report:
    def __init__(self, name):
        self.name, self.errors, self.warnings = name, [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)


def math_segments(s):
    """'$…$' 片段；[[FILL]] 不算。"""
    return re.findall(r"\$([^$]+)\$", s or "")


def walk_keys(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k, path + "/" + k
            yield from walk_keys(v, path + "/" + k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_keys(v, f"{path}[{i}]")


def check_text(r, where, s, allow_fill=False, n_tables=0):
    if s is None:
        return
    if not isinstance(s, str):
        r.err(f"{where}: 應為字串")
        return
    if s.count("$") % 2:
        r.err(f"{where}: $ 不成對：{s[:80]}")
    for mk in re.findall(r"\[\[([^\]]*)\]\]", s):
        if mk == "FILL" and allow_fill:
            continue
        if re.fullmatch(r"TABLE:\d+", mk) and n_tables and int(mk[6:]) <= n_tables:
            continue
        r.err(f"{where}: 不合法的標記 [[{mk}]]：{s[:80]}")
    if BAD_SPACE.search(s):
        r.err(f"{where}: 含不可見或特殊空白字元")
    if s != s.strip():
        r.err(f"{where}: 前後有空白")
    for seg in math_segments(s):
        if re.search(r"[\u4e00-\u9fff]", seg) and r"\text{" not in seg:
            r.warn(f"{where}: 公式內有中文但沒有 \\text{{}}：{seg[:60]}")


def validate(path, katex_jobs):
    r = Report(os.path.basename(path))
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        r.err(f"讀檔失敗：{e}")
        return r
    if d.get("schema") != SCHEMA:
        r.err(f"schema 應為 {SCHEMA}")
    m = re.fullmatch(r"gsat-math([ab]?)-(\d{3})", d.get("id", ""))
    old = d.get("era") == "舊課綱"
    if d.get("era") not in ERAS:
        r.err(f"era 應為 {sorted(ERAS)} 之一")
    if not m:
        r.err("id 格式應為 gsat-math{a|b}-{學年度}（108 課綱）或 gsat-math-{學年度}（舊課綱）")
    else:
        if d.get("subject") != (f"math_{m.group(1)}" if m.group(1) else "math"):
            r.err("subject 與 id 不符")
        if d.get("year") != int(m.group(2)):
            r.err("year 與 id 不符")
        if os.path.basename(path) != d["id"] + ".json":
            r.err("檔名與 id 不符")
        if bool(m.group(1)) == old:
            r.err("era 與 id 不符：gsat-math{a|b}-* 為 108課綱，gsat-math-* 為舊課綱")
        if (int(m.group(2)) >= 111) == old:
            r.err("era 與 year 不符：111 起為 108課綱，110 以前為舊課綱")
    for k in d:
        if k.startswith("_"):
            r.err(f"頂層欄位 {k} 是建置過程的暫存資料，完成前要刪除")
    for k, p in walk_keys(d):
        if k in FORBIDDEN_KEYS:
            r.err(f"{p}: 不得收錄官方參考答案／評分原則（欄位 {k}）")
    src = d.get("sources") or {}
    if not src.get("paper") or not src.get("answer"):
        r.err("sources.paper／answer 必填")
    if d.get("full_score") != 100:
        r.err("full_score 應為 100")
    for k in ("single", "multi", "fill"):
        check_text(r, f"scoring_rules.{k}", (d.get("scoring_rules") or {}).get(k))
        if k == "single" or k == "multi":
            katex_jobs += [(r, f"scoring_rules.{k}", seg) for seg in
                           math_segments((d.get("scoring_rules") or {}).get(k))]

    sec_ids = [s.get("id") for s in d.get("sections", [])]
    part_points = 0
    seen_secs = []
    for p in d.get("parts", []):
        part_points += p.get("points") or 0
        seen_secs += p.get("sections", [])
        psum = sum(s.get("points_total", 0) for s in d["sections"] if s["id"] in p.get("sections", []))
        if psum != p.get("points"):
            r.err(f"部分「{p.get('title')}」配分 {p.get('points')} ≠ 所屬大題合計 {psum}")
    if part_points != 100:
        r.err(f"各部分配分合計 {part_points} ≠ 100")
    if sorted(seen_secs) != sorted(sec_ids):
        r.err("parts.sections 與 sections 不一致")

    nos, labels = [], set()
    fill_rows, fill_letters = [], []
    total = 0
    fig_ids = set()
    for s in d.get("sections", []):
        if s.get("type") not in SECTION_TYPES:
            r.err(f"{s.get('id')}: section.type 不合法")
        ssum = 0
        for g in s.get("groups", []):
            check_text(r, f"{g['id']}.stem", g.get("stem"), n_tables=len(g.get("tables", [])))
            katex_jobs += [(r, f"{g['id']}.stem", seg) for seg in math_segments(g.get("stem"))]
            for fg in g.get("figures", []):
                check_figure(r, d, fg, f"{g['id']}", fig_ids)
            for tb in g.get("tables", []):
                check_table(r, tb, g["id"], katex_jobs)
            if not g.get("items"):
                r.err(f"{g['id']}: 題組沒有小題")
            for it in g.get("items", []):
                no = it.get("no")
                where = f"第{no}題"
                nos.append(no)
                if it.get("label") in labels:
                    r.err(f"{where}: label 重複")
                labels.add(it.get("label"))
                t = it.get("type")
                if old and t == "fill":
                    fill_letters.append(it.get("label"))
                    where = f"第{it.get('label')}題"
                elif it.get("label") != str(no):
                    r.err(f"{where}: label 應為題號 {no}")
                if t not in ITEM_TYPES:
                    r.err(f"{where}: type 不合法 {t}")
                if s["type"] in ("single", "multi", "fill") and t != s["type"]:
                    r.err(f"{where}: type {t} 與大題 {s['type']} 不符")
                pts = it.get("points")
                if not isinstance(pts, (int, float)) or pts <= 0:
                    r.err(f"{where}: points 缺漏")
                else:
                    ssum += pts
                check_text(r, f"{where}.stem", it.get("stem"), allow_fill=(t == "fill"),
                           n_tables=len(it.get("tables", [])))
                katex_jobs += [(r, f"{where}.stem", seg) for seg in math_segments(it.get("stem"))]
                opts = it.get("options")
                if t in ("single", "multi"):
                    if not opts or list(opts) != [str(i) for i in range(1, len(opts) + 1)]:
                        r.err(f"{where}: 選項應為 1..n 連號")
                    elif len(opts) < 4:
                        r.warn(f"{where}: 只有 {len(opts)} 個選項")
                    for k, v in (opts or {}).items():
                        check_text(r, f"{where}({k})", v)
                        if not v and not (it.get("options_figures") or {}).get(k):
                            r.err(f"{where}({k}): 選項空白")
                        katex_jobs += [(r, f"{where}({k})", seg) for seg in math_segments(v)]
                elif opts:
                    r.err(f"{where}: {t} 題不應有 options")
                a = it.get("answer")
                if t == "single":
                    if not (isinstance(a, str) and opts and a in opts):
                        r.err(f"{where}: 單選答案 {a!r} 不在選項內")
                elif t == "multi":
                    if not (isinstance(a, list) and a and opts and all(x in opts for x in a)
                            and a == sorted(set(a), key=int)):
                        r.err(f"{where}: 多選答案 {a!r} 不合法")
                elif t == "fill":
                    if a is not None:
                        r.err(f"{where}: 選填題 answer 應為 null（答案在 fill）")
                    check_fill(r, it, where, katex_jobs)
                    oc = (it.get("fill") or {}).get("official_cells")
                    if old:
                        if not isinstance(oc, list) or len(oc) != len((it.get("fill") or {}).get("cells") or []) \
                                or not all(isinstance(x, str) and x.isdigit() for x in oc):
                            r.err(f"{where}: 舊課綱選填題要有 fill.official_cells（答案卡列號，與 cells 一一對應）")
                        else:
                            fill_rows += [int(x) for x in oc]
                    elif oc is not None:
                        r.err(f"{where}: fill.official_cells 只用於舊課綱")
                elif t == "constructed":
                    if a is not None:
                        r.err(f"{where}: 非選擇題不得存答案")
                    c = it.get("constructed") or {}
                    if c.get("official_answer_stored") is not False:
                        r.err(f"{where}: constructed.official_answer_stored 必須是 false")
                for fg in it.get("figures", []):
                    check_figure(r, d, fg, where, fig_ids)
                for k, fg in (it.get("options_figures") or {}).items():
                    check_figure(r, d, fg, f"{where}({k})", fig_ids)
                for tb in it.get("tables", []):
                    check_table(r, tb, where, katex_jobs)
                if "stats" in it:
                    check_stats(r, it, where)
                units = (it.get("tags") or {}).get("units")
                if not units:
                    r.warn(f"{where}: 沒有 tags.units")
                elif any(u not in UNITS for u in units):
                    r.err(f"{where}: 未知單元 {[u for u in units if u not in UNITS]}")
        if ssum != s.get("points_total"):
            r.err(f"{s['id']}: 小題配分合計 {ssum} ≠ points_total {s.get('points_total')}")
        total += ssum
    if total != 100:
        r.err(f"全卷配分合計 {total} ≠ 100")
    if nos != list(range(1, len(nos) + 1)):
        r.err(f"題號不連續：{nos}")
    if old:
        n_fill = len(fill_letters)
        if fill_letters != [chr(ord("A") + i) for i in range(n_fill)]:
            r.err(f"舊課綱選填題 label 應依序為 A、B、C…：{fill_letters}")
        first = len(nos) - n_fill + 1
        if fill_rows and fill_rows != list(range(first, first + len(fill_rows))):
            r.err(f"選填題答案卡列號應從 {first} 起全卷連號：{fill_rows}")
        fill_sec = [s for s in d.get("sections", []) if s.get("type") == "fill"]
        mm = re.search(r"列號\s*[（(]\s*(\d+)\s*[–\-－~]\s*(\d+)\s*[）)]",
                       (fill_sec[0].get("instructions") or "") if fill_sec else "")
        if fill_rows and mm and (fill_rows[0], fill_rows[-1]) != (int(mm.group(1)), int(mm.group(2))):
            r.err(f"選填列號 {fill_rows[0]}–{fill_rows[-1]} 與大題說明「{mm.group(0)}」不符")
    for i, f in enumerate(d.get("reference_formulas", [])):
        check_text(r, f"reference_formulas[{i}]", f)
        katex_jobs += [(r, f"reference_formulas[{i}]", seg) for seg in math_segments(f)]
    ex = d.get("extraction") or {}
    if not ex.get("method"):
        r.err("extraction.method 必填")
    if not isinstance(ex.get("issues"), list):
        r.err("extraction.issues 應為陣列")
    return r


def check_fill(r, it, where, katex_jobs):
    f = it.get("fill") or {}
    cells = f.get("cells") or []
    if not cells or cells != [f"{it['no']}-{i}" for i in range(1, len(cells) + 1)]:
        r.err(f"{where}: fill.cells 應為 {it['no']}-1…")
    tpl = f.get("template") or ""
    if re.findall(r"\[\[(\d+-\d+)\]\]", tpl) != cells:
        r.err(f"{where}: fill.template 的格子與 cells 不一致")
    ac = f.get("answer_cells") or {}
    if list(ac) != cells:
        r.err(f"{where}: fill.answer_cells 與 cells 不一致")
    for c, v in ac.items():
        if v not in FILL_CELL_VALUES:
            r.err(f"{where}: {c} 的答案 {v!r} 不是 0–9、-、±")
    expect = tpl
    for c in cells:
        expect = expect.replace(f"[[{c}]]", ac.get(c, "?"))
    if f.get("answer_latex") != expect:
        r.err(f"{where}: answer_latex 應為 template 代入答案的結果 {expect!r}")
    if (it.get("stem") or "").count("[[FILL]]") != 1:
        r.err(f"{where}: 選填題幹要有恰好一個 [[FILL]]")
    boxed = re.sub(r"\[\[(\d+-\d+)\]\]", r"\\boxed{\1}", tpl)
    katex_jobs.append((r, f"{where}.fill.template", boxed))
    katex_jobs.append((r, f"{where}.fill.answer_latex", f.get("answer_latex") or ""))


def check_stats(r, it, where):
    st = it.get("stats")
    if not isinstance(st, dict):
        r.err(f"{where}: stats 應為物件")
        return
    for k in st:
        if k not in STATS_KEYS:
            r.err(f"{where}: stats 不認得的欄位 {k}")
    for k in ("P", "Ph", "Pl", "T", "omit"):
        v = st.get(k)
        if v is not None and not (isinstance(v, (int, float)) and 0 <= v <= 1):
            r.err(f"{where}: stats.{k}={v!r} 應為 0–1 的小數")
    d_ = st.get("D")
    if d_ is not None and not (isinstance(d_, (int, float)) and -1 <= d_ <= 1):
        r.err(f"{where}: stats.D={d_!r} 應為 −1–1")
    if "T" in st and it.get("type") != "multi":
        r.err(f"{where}: stats.T（全對率）只用於多選題")
    if "options" in st:
        if it.get("type") not in ("single", "multi") or set(st["options"]) != set(it.get("options") or {}):
            r.err(f"{where}: stats.options 的鍵應與選項相同")
        elif any(v is not None and not (0 <= v <= 1) for v in st["options"].values()):
            r.err(f"{where}: stats.options 的比例應為 0–1")


def check_figure(r, d, fg, where, fig_ids):
    fid = fg.get("id")
    if not fid or fid in fig_ids:
        r.err(f"{where}: 圖 id 缺漏或重複 {fid}")
    fig_ids.add(fid)
    if fg.get("kind") not in FIG_KINDS:
        r.err(f"{where}: 圖 kind 不合法 {fg.get('kind')}")
    if not (fg.get("alt") or "").strip() or len(fg.get("alt", "")) < 8:
        r.err(f"{where}: 圖 {fid} 缺少替代文字")
    src = fg.get("source") or {}
    if not isinstance(src.get("page"), int) or len(src.get("bbox_pt") or []) != 4:
        r.err(f"{where}: 圖 {fid} source.page／bbox_pt 缺漏")
    file = fg.get("file")
    expect = f"data/exams/figures-math/{d.get('id')}/{fid}.png"
    if file != expect:
        r.err(f"{where}: 圖 {fid} file 應為 {expect}（先跑 tools/crop_math_figures.py）")
    elif not os.path.exists(os.path.join(ROOT, file)):
        r.err(f"{where}: 找不到圖檔 {file}")


def check_table(r, tb, where, katex_jobs):
    rows = tb.get("rows")
    if not rows or not all(isinstance(x, list) for x in rows):
        r.err(f"{where}: 表格 rows 應為二維陣列")
        return
    for row in rows:
        for cell in row:
            check_text(r, f"{where}.table", cell)
            katex_jobs += [(r, f"{where}.table", seg) for seg in math_segments(cell)]


KATEX_JS = r"""
const katex = require(process.argv[1]);
const jobs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const bad = [];
jobs.forEach((tex, i) => {
  try { katex.renderToString(tex, {throwOnError: true, strict: 'ignore'}); }
  catch (e) { bad.push([i, String(e.message).slice(0, 160)]); }
});
process.stdout.write(JSON.stringify(bad));
"""


def run_katex(jobs, katex_dir):
    node = shutil.which("node")
    if not node:
        print("[katex] 找不到 node，略過", file=sys.stderr)
        return
    res = subprocess.run([node, "-e", KATEX_JS, os.path.abspath(katex_dir)],
                         input=json.dumps([j[2] for j in jobs]).encode(),
                         capture_output=True, timeout=300)
    if res.returncode:
        print(res.stderr.decode()[:2000], file=sys.stderr)
        raise SystemExit(2)
    for i, msg in json.loads(res.stdout or b"[]"):
        rep, where, tex = jobs[i]
        rep.err(f"{where}: KaTeX 無法排版：{msg}｜{tex[:80]}")
    print(f"[katex] {len(jobs)} 段公式已排版檢查", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--katex", help="katex 套件目錄（node_modules/katex）")
    ap.add_argument("-q", "--quiet", action="store_true", help="不印 warning")
    a = ap.parse_args(argv)
    files = a.files
    if a.all:
        files = sorted(glob.glob(os.path.join(PARSED, "*.json")))
    jobs = []
    reps = [validate(f, jobs) for f in files]
    if a.katex:
        run_katex(jobs, a.katex)
    n_err = 0
    for r in reps:
        n_err += len(r.errors)
        for e in r.errors:
            print(f"ERROR {r.name}: {e}")
        if not a.quiet:
            for w in r.warnings:
                print(f"warn  {r.name}: {w}")
    print(f"validate_math_exam: {len(reps)} file(s), {n_err} error(s), "
          f"{sum(len(r.warnings) for r in reps)} warning(s)")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main())
