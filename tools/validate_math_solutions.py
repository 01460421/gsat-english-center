#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
檢查本站數學詳解 data/exams/math-solutions/{paper-id}.json（格式 gsat-math-solutions/v1）。
有 error 以 1 結束。

  python3 tools/validate_math_solutions.py --all
  python3 tools/validate_math_solutions.py data/exams/math-solutions/gsat-matha-115.json
  python3 tools/validate_math_solutions.py --all --katex /path/to/node_modules/katex

檢查項目：
- 題目齊全：每一題（依 data/exams/parsed-math/{paper-id}.json）都有詳解，題號與題型一致，沒有多餘的題。
  --all 時 108 課綱每一卷都要有詳解檔；舊課綱（era「舊課綱」，100–110）的詳解另排，沒有檔案只列出、不算 error
  （網站該卷顯示「詳解準備中」）。
- difficulty.official_p 等於試題 JSON 的 stats.P（兩者都取自官方答對率及鑑別度表，
  stats 由 tools/merge_math_stats.py 併入）；沒有 stats 的題目 official_p 必須是 null。
- check.official 與歷屆試題 JSON 的官方答案（選擇、選填各格）一致；非選擇題 official 必須是 null。
- 選擇（填）題 check.agree 必須等於「解題者 A＝解題者 B＝官方」；非選擇題 agree 由兩位解題者比對。
  agree 為 false 的題目必須有 flags（severity：resolved＝已複核、說明差異；owner_review＝待站主決定）。
- solution_md 有「解題關鍵」「詳解」「答案」段落；多選題逐一說明 (1)–(5)；非選擇題有「評分重點」。
- 不含禁止字詞（官方機構名稱、「評分原則」「參考答案」、AI 模型名稱）。
- KaTeX：$…$、$$…$$ 成對；--katex（或自動找到 apps/web/node_modules/katex、node_modules/katex）時
  以 KaTeX（throwOnError）實際排版每一段公式；找不到 KaTeX 時只做靜態檢查並提示。
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARSED = os.path.join(ROOT, "data", "exams", "parsed-math")
SOLS = os.path.join(ROOT, "data", "exams", "math-solutions")
SCHEMA = "gsat-math-solutions/v1"
LEVELS = {"穩定基礎", "進階練習", "超越頂標"}
SEVERITIES = {"resolved", "owner_review"}
# 與 packages/shared/src/assist-methods-zh.test.ts 的寫法一致（不分大小寫）
FORBIDDEN_RE = re.compile(r"大考中心|考試中心|ceec|評分原則|參考答案|claude|anthropic|opus|sonnet|haiku|gpt|gemini|openai",
                          re.I)
REQUIRED_KEYS = {"no", "type", "unit", "unit_tags", "difficulty", "solution_md", "answer_display",
                 "check", "flags"}
KATEX_DIRS = [os.path.join(ROOT, "apps", "web", "node_modules", "katex"),
              os.path.join(ROOT, "node_modules", "katex")]


class Report:
    def __init__(self, name):
        self.name, self.errors, self.warnings = name, [], []

    def err(self, m):
        self.errors.append(m)

    def warn(self, m):
        self.warnings.append(m)


def math_segments(s):
    """回傳 [(tex, display)]；同時檢查 $ 成對。不成對時回傳 None。"""
    out, i, n = [], 0, len(s)
    while i < n:
        if s.startswith("$$", i):
            j = s.find("$$", i + 2)
            if j < 0:
                return None
            out.append((s[i + 2:j], True))
            i = j + 2
        elif s[i] == "$":
            j = s.find("$", i + 1)
            if j < 0:
                return None
            out.append((s[i + 1:j], False))
            i = j + 1
        else:
            i += 1
    return out


def official_key(it):
    t = it["type"]
    if t == "single":
        return it["answer"]
    if t == "multi":
        return ",".join(it["answer"])
    if t == "fill":
        return {c: it["fill"]["answer_cells"][c] for c in it["fill"]["cells"]}
    return None


def check_text(r, where, s, jobs):
    if not isinstance(s, str) or not s.strip():
        r.err(f"{where}: 空白")
        return
    for w in sorted(set(m.group(0) for m in FORBIDDEN_RE.finditer(s))):
        r.err(f"{where}: 含禁止字詞「{w}」")
    segs = math_segments(s)
    if segs is None:
        r.err(f"{where}: $ 不成對")
        return
    for tex, disp in segs:
        if not tex.strip():
            r.err(f"{where}: 空的公式")
            continue
        if re.search(r"[一-鿿]", tex) and r"\text" not in tex:
            r.err(f"{where}: 公式內有中文但沒有 \\text{{}}：{tex[:60]}")
        jobs.append((r, where, tex, disp))


def validate(path, jobs):
    r = Report(os.path.basename(path))
    try:
        d = json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError) as e:
        r.err(f"讀取失敗：{e}")
        return r
    if d.get("schema") != SCHEMA:
        r.err(f"schema 應為 {SCHEMA}")
    pid = d.get("paper_id")
    ppath = os.path.join(PARSED, f"{pid}.json")
    if not os.path.exists(ppath):
        r.err(f"找不到歷屆試題 {ppath}")
        return r
    paper = json.load(open(ppath, encoding="utf-8"))
    want = {}
    for s in paper["sections"]:
        for g in s["groups"]:
            for it in g["items"]:
                want[it["no"]] = it
    got = {}
    for x in d.get("items", []):
        if not isinstance(x, dict) or "no" not in x:
            r.err("items 內有格式錯誤的項目")
            continue
        if x["no"] in got:
            r.err(f"第 {x['no']} 題重複")
        got[x["no"]] = x
    for no in sorted(set(want) - set(got)):
        r.err(f"缺第 {no} 題")
    for no in sorted(set(got) - set(want)):
        r.err(f"多出第 {no} 題")
    for no in sorted(set(want) & set(got)):
        it, x, w = want[no], got[no], f"第 {no} 題"
        miss = REQUIRED_KEYS - set(x)
        if miss:
            r.err(f"{w}: 缺欄位 {sorted(miss)}")
            continue
        t = it["type"]
        if x["type"] != t:
            r.err(f"{w}: type {x['type']} ≠ 試題 {t}")
        if not str(x["unit"]).strip():
            r.err(f"{w}: unit 空白")
        if x["unit_tags"] != it["tags"]["units"]:
            r.warn(f"{w}: unit_tags 與試題 tags.units 不同")
        dif = x["difficulty"]
        if not isinstance(dif, dict) or dif.get("level") not in LEVELS:
            r.err(f"{w}: difficulty.level 應為 {sorted(LEVELS)}")
        elif dif.get("official_p") is None and dif.get("basis") != "本站估計":
            r.err(f"{w}: 沒有官方答對率時 basis 應為「本站估計」")
        else:
            stats_p = (it.get("stats") or {}).get("P")
            if dif.get("official_p") != stats_p:
                r.err(f"{w}: difficulty.official_p {dif.get('official_p')} ≠ 試題 stats.P {stats_p}"
                      "（重跑 tools/merge_math_stats.py 或更正詳解）")
        md = x["solution_md"]
        check_text(r, f"{w}.solution_md", md, jobs)
        check_text(r, f"{w}.answer_display", x["answer_display"], jobs)
        for sec in ("解題關鍵", "詳解", "答案"):
            if f"**{sec}**" not in (md or ""):
                r.err(f"{w}: solution_md 缺「{sec}」段落")
        if t == "multi":
            for k in "12345":
                if f"({k})" not in md:
                    r.err(f"{w}: 多選題沒有說明選項 ({k})")
        if t == "fill":
            for c in it["fill"]["cells"]:
                if c not in md:
                    r.warn(f"{w}: 選填題詳解沒有提到格子 {c}")
        if t == "constructed" and "**評分重點" not in md:
            r.err(f"{w}: 非選擇題缺「評分重點」")
        ck = x["check"]
        if not isinstance(ck, dict) or not {"official", "solver_a", "solver_b", "agree"} <= set(ck):
            r.err(f"{w}: check 欄位不完整")
            continue
        off = official_key(it)
        if ck["official"] != off:
            r.err(f"{w}: check.official {ck['official']} ≠ 官方答案 {off}")
        if t != "constructed":
            expect = (ck["solver_a"] == off and ck["solver_b"] == off)
            if ck["agree"] is not expect:
                r.err(f"{w}: check.agree 應為 {expect}")
        elif not isinstance(ck["agree"], bool):
            r.err(f"{w}: check.agree 應為布林值")
        flags = x["flags"]
        if not isinstance(flags, list):
            r.err(f"{w}: flags 應為陣列")
            continue
        for f in flags:
            if not isinstance(f, dict) or f.get("severity") not in SEVERITIES or not f.get("detail"):
                r.err(f"{w}: flag 格式錯誤 {f}")
            else:
                check_text(r, f"{w}.flags", f["detail"], jobs)
        if ck["agree"] is not True and not flags:
            r.err(f"{w}: 解題者與官方不一致，卻沒有 flag")
    return r


KATEX_JS = r"""
const katex = require(process.argv[1]);
const jobs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const bad = [];
jobs.forEach(([tex, disp], i) => {
  try { katex.renderToString(tex, {throwOnError: true, displayMode: disp, strict: 'ignore'}); }
  catch (e) { bad.push([i, String(e.message).slice(0, 160)]); }
});
process.stdout.write(JSON.stringify(bad));
"""


def run_katex(jobs, katex_dir):
    node = shutil.which("node")
    if not node:
        print("[katex] 找不到 node，略過實際排版", file=sys.stderr)
        return False
    res = subprocess.run([node, "-e", KATEX_JS, os.path.abspath(katex_dir)],
                         input=json.dumps([[j[2], j[3]] for j in jobs]).encode(),
                         capture_output=True, timeout=600)
    if res.returncode:
        print(res.stderr.decode()[:2000], file=sys.stderr)
        raise SystemExit(2)
    for i, msg in json.loads(res.stdout or b"[]"):
        rep, where, tex, _ = jobs[i]
        rep.err(f"{where}: KaTeX 無法排版：{msg}｜{tex[:80]}")
    print(f"[katex] {len(jobs)} 段公式已排版檢查（{katex_dir}）", file=sys.stderr)
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true",
                    help="檢查全部歷屆試題都有詳解檔，並逐一驗證")
    ap.add_argument("--katex", help="katex 套件目錄（node_modules/katex）")
    ap.add_argument("--require-katex", action="store_true", help="找不到 KaTeX 時算 error")
    ap.add_argument("-q", "--quiet", action="store_true", help="不印 warning")
    a = ap.parse_args(argv)
    files = list(a.files)
    n_err = 0
    pending = []
    if a.all:
        for p in sorted(glob.glob(os.path.join(PARSED, "*.json"))):
            sp = os.path.join(SOLS, os.path.basename(p))
            if os.path.exists(sp):
                files.append(sp)
            elif json.load(open(p, encoding="utf-8")).get("era") == "舊課綱":
                pending.append(os.path.basename(p)[:-5])
            else:
                print(f"ERROR 缺詳解檔 {os.path.relpath(sp, ROOT)}")
                n_err += 1
        if pending:
            print(f"[pending] 舊課綱 {len(pending)} 卷尚無詳解檔（另排）：{pending[0]} … {pending[-1]}",
                  file=sys.stderr)
    jobs = []
    reps = [validate(f, jobs) for f in files]
    kdir = a.katex or next((d for d in KATEX_DIRS if os.path.isdir(d)), None)
    rendered = False
    if kdir:
        rendered = run_katex(jobs, kdir)
    if not rendered:
        msg = "未以 KaTeX 實際排版（請加 --katex <node_modules/katex>）"
        if a.require_katex:
            print("ERROR " + msg)
            n_err += 1
        else:
            print("[katex] " + msg, file=sys.stderr)
    n_items = n_flag = n_disagree = 0
    for r in reps:
        n_err += len(r.errors)
        for e in r.errors:
            print(f"ERROR {r.name}: {e}")
        if not a.quiet:
            for w in r.warnings:
                print(f"warn  {r.name}: {w}")
    for f in files:
        try:
            d = json.load(open(f, encoding="utf-8"))
            n_items += len(d["items"])
            n_flag += sum(1 for x in d["items"] if x.get("flags"))
            n_disagree += sum(1 for x in d["items"] if not x.get("check", {}).get("agree"))
        except (OSError, ValueError, KeyError, TypeError):
            pass
    print(f"validate_math_solutions: {len(reps)} file(s), {n_items} item(s), "
          f"{n_disagree} disagreement(s), {n_flag} flagged, {n_err} error(s), "
          f"{sum(len(r.warnings) for r in reps)} warning(s)")
    return 1 if n_err else 0


if __name__ == "__main__":
    sys.exit(main())
