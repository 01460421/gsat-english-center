#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把官方「答對率及鑑別度表」（pd_table）與「選擇題選項分析」（option_analysis）的數學科數字
併入 data/exams/parsed-math/{id}.json 每一小題的 `stats`（docs/math-exam-json-schema.md §stats）。

  python3 -I tools/merge_math_stats.py gsat-math-110 [gsat-matha-115 ...]
  python3 -I tools/merge_math_stats.py --old          # 全部舊課綱（gsat-math-*）
  python3 -I tools/merge_math_stats.py --new          # 全部 108 課綱（gsat-matha-*、gsat-mathb-*）
  python3 -I tools/merge_math_stats.py --all          # 兩者

來源：data/exams/math-manifest.json 中的 stats 檔（各科合併的 .xls）。讀檔前比對 manifest 的 sha256；
只用 xlrd 讀儲存格，不執行任何內容。

| 卷子 | manifest 的 exam | 工作表 |
|---|---|---|
| gsat-math-{100..110}（舊課綱） | gsat-math | 數學 |
| gsat-matha-{111..}（數學A） | gsat-matha | 數學A |
| gsat-mathb-{111..}（數學B） | gsat-matha（數A、數B 合併檔只掛在 gsat-matha 下一次） | 數學B |

兩種版面相同（題號、P、Ph、Pl、…、T、D；選項分析每題 T／H／L 三列、正確選項前加「*」），
只差在 108 課綱的表只列選擇（填）題：非選擇題（constructed，每卷第 19、20 題）不在表上，也不寫 stats。
P 欄與詳解檔 data/exams/math-solutions/ 的 difficulty.official_p 來自同一個 pd_table（stats-1.xls），
兩邊一致由 tools/validate_math_solutions.py 檢查。

交叉檢查（不一致就停下來，不寫檔）：
- 表上題號前有「*」者必須是多選題，反之亦然；題號必須對得上卷內每一題（非選擇題除外）的 `no`
  （舊課綱選填題 A、B、C… 在表上依序是單選、多選之後的題號）。
- 選項分析中標「*」的選項必須等於 JSON 的官方答案；選項分析列出的題目必須正好是卷內的單選、多選題
  （108 課綱混合題組裡的單選題也在內）。
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "data", "exams", "math-manifest.json")
PARSED = os.path.join(ROOT, "data", "exams", "parsed-math")


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


def stats_files(exam, year):
    with open(MANIFEST, encoding="utf-8") as f:
        items = json.load(f)["items"]
    out = {}
    for it in items:
        if it["exam"] == exam and it["year"] == year and it["kind"] == "stats" \
                and it["subkind"] in ("pd_table", "option_analysis"):
            p = os.path.join(ROOT, it["local_path"])
            if _sha256(p) != it["sha256"]:
                raise SystemExit(f"{it['local_path']}: sha256 與 manifest 不符")
            out[it["subkind"]] = it["local_path"]
    return out


# subject → (manifest 的 exam, 工作表名稱)
SOURCES = {
    "math": ("gsat-math", "數學"),
    "math_a": ("gsat-matha", "數學A"),
    "math_b": ("gsat-matha", "數學B"),
}


def math_sheet(path, sheet="數學"):
    import xlrd  # 只讀儲存格
    book = xlrd.open_workbook(os.path.join(ROOT, path))
    for sh in book.sheets():
        if sh.name.strip() == sheet:
            return [[str(c.value).strip() for c in sh.row(r)] for r in range(sh.nrows)]
    raise SystemExit(f"{path}: 找不到「{sheet}」工作表")


def _num(v):
    if v in ("", None):
        return None
    return round(float(v) / 100, 2)


def read_pd(rows):
    hdr = next(i for i, r in enumerate(rows) if r and r[0] == "題號")
    cols = rows[hdr]
    out = {}
    for r in rows[hdr + 1:]:
        m = re.fullmatch(r"(\*?)(\d+)(?:\.0)?", r[0])
        if not m:
            continue
        rec = {c: _num(v) for c, v in zip(cols[1:], r[1:]) if c}
        out[int(m.group(2))] = (bool(m.group(1)), rec)
    return out


def read_oa(rows):
    hdr = next(i for i, r in enumerate(rows) if r and r[0] == "題號")
    labels = [re.sub(r"\.0$", "", c) for c in rows[hdr]]
    out, cur = {}, None
    for r in rows[hdr + 1:]:
        m = re.fullmatch(r"(\*?)(\d+)(?:\.0)?", r[0])
        if m:
            cur = int(m.group(2))
            out[cur] = {"multi": bool(m.group(1)), "key": [], "T": {}, "omit": None}
        if cur is None or len(r) < 3 or r[1] != "T":
            continue
        rec = out[cur]
        rec["omit"] = _num(r[2])
        for lab, v in zip(labels[3:], r[3:]):
            if v == "":
                continue
            if v.startswith("*"):
                rec["key"].append(lab)
                v = v[1:]
            rec["T"][lab] = _num(v)
    return out


def merge(doc_id):
    path = os.path.join(PARSED, doc_id + ".json")
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if doc.get("subject") not in SOURCES:
        raise SystemExit(f"{doc_id}: 不認得的 subject {doc.get('subject')}")
    exam, sheet = SOURCES[doc["subject"]]
    files = stats_files(exam, doc["year"])
    if "pd_table" not in files:
        raise SystemExit(f"{doc_id}: manifest 沒有 pd_table")
    pd = read_pd(math_sheet(files["pd_table"], sheet))
    oa = read_oa(math_sheet(files["option_analysis"], sheet)) if "option_analysis" in files else {}
    all_items = [it for s in doc["sections"] for g in s["groups"] for it in g["items"]]
    items = [it for it in all_items if it["type"] != "constructed"]
    if sorted(pd) != [it["no"] for it in items]:
        raise SystemExit(f"{doc_id}: 統計表題號 {sorted(pd)} 與卷內選擇（填）題題號不符")
    if oa:
        choice = sorted(it["no"] for it in items if it["type"] in ("single", "multi"))
        if sorted(oa) != choice:
            raise SystemExit(f"{doc_id}: 選項分析題號 {sorted(oa)} 與卷內單選／多選題 {choice} 不符")
    for it in all_items:
        if it["type"] == "constructed":
            it.pop("stats", None)  # 官方表沒有非選擇題
    for it in items:
        star, rec = pd[it["no"]]
        if star != (it["type"] == "multi"):
            raise SystemExit(f"{doc_id} 第{it['label']}題：統計表{'有' if star else '沒有'}多選「*」，"
                             f"但題型是 {it['type']}")
        st = {"P": rec.get("P"), "Ph": rec.get("Ph"), "Pl": rec.get("Pl"), "D": rec.get("D")}
        if it["type"] == "multi":
            st["T"] = rec.get("T")
        if it["type"] in ("single", "multi"):
            o = oa.get(it["no"])
            if o is None:
                raise SystemExit(f"{doc_id} 第{it['label']}題：選項分析缺漏")
            ans = it["answer"] if isinstance(it["answer"], list) else [it["answer"]]
            if sorted(o["key"]) != sorted(ans):
                raise SystemExit(f"{doc_id} 第{it['label']}題：選項分析標示的答案 {o['key']} ≠ JSON {ans}")
            st["options"] = {k: o["T"].get(k) for k in it["options"]}
            st["omit"] = o["omit"]
        it["stats"] = st
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)
    print(f"[stats] {doc_id}: {len(items)} items ← {files['pd_table']}"
          + (f", {files['option_analysis']}" if "option_analysis" in files else ""), file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--old", action="store_true", help="全部 gsat-math-*（舊課綱）")
    ap.add_argument("--new", action="store_true", help="全部 gsat-matha-*、gsat-mathb-*（108 課綱）")
    ap.add_argument("--all", action="store_true", help="--old 與 --new")
    a = ap.parse_args(argv)
    ids = list(a.ids)
    if a.old or a.all:
        ids += sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(PARSED, "gsat-math-*.json")))
    if a.new or a.all:
        ids += sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(PARSED, "gsat-math[ab]-*.json")))
    for i in ids:
        merge(i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
