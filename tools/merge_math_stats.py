#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把官方「答對率及鑑別度表」（pd_table）與「選擇題選項分析」（option_analysis）的數學科數字
併入 data/exams/parsed-math/{id}.json 每一小題的 `stats`（docs/math-exam-json-schema.md §stats）。

  python3 -I tools/merge_math_stats.py gsat-math-110 [gsat-math-109 ...]
  python3 -I tools/merge_math_stats.py --old          # 全部舊課綱（gsat-math-*）

來源：data/exams/math-manifest.json 中該卷 exam／year 的 stats 檔（各科合併的 .xls，
工作表「數學」）。讀檔前比對 manifest 的 sha256；只用 xlrd 讀儲存格，不執行任何內容。

交叉檢查（不一致就停下來，不寫檔）：
- 表上題號前有「*」者必須是多選題，反之亦然；題號必須對得上卷內每一小題的 `no`
  （舊課綱選填題 A、B、C… 在表上依序是單選、多選之後的題號）。
- 選項分析中標「*」的選項必須等於 JSON 的官方答案。

數學 A／B（111 起）的統計是掛在 gsat-matha 下的合併檔，工作表名稱不同，尚未處理。
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


def math_sheet(path):
    import xlrd  # 只讀儲存格
    book = xlrd.open_workbook(os.path.join(ROOT, path))
    for sh in book.sheets():
        if sh.name.strip() == "數學":
            return [[str(c.value).strip() for c in sh.row(r)] for r in range(sh.nrows)]
    raise SystemExit(f"{path}: 找不到「數學」工作表")


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
    exam = re.sub(r"-\d+$", "", doc_id)
    files = stats_files(exam, doc["year"])
    if "pd_table" not in files:
        raise SystemExit(f"{doc_id}: manifest 沒有 pd_table")
    pd = read_pd(math_sheet(files["pd_table"]))
    oa = read_oa(math_sheet(files["option_analysis"])) if "option_analysis" in files else {}
    items = [it for s in doc["sections"] for g in s["groups"] for it in g["items"]]
    if sorted(pd) != [it["no"] for it in items]:
        raise SystemExit(f"{doc_id}: 統計表題號 {sorted(pd)} 與卷內題號不符")
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
    a = ap.parse_args(argv)
    ids = list(a.ids)
    if a.old:
        ids += sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(PARSED, "gsat-math-*.json")))
    for i in ids:
        merge(i)
    return 0


if __name__ == "__main__":
    sys.exit(main())
