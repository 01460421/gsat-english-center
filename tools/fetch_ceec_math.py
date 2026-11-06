#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大考中心（CEEC, https://www.ceec.edu.tw）學測數學考科資料：清單建立與下載工具。

與 tools/fetch_ceec.py（英文）共用 HTTP、HTML 解析、PDF 文字層判斷等函式，
只在「篩哪些列、檔案放哪裡」上不同。只用 Python 3 標準庫＋poppler-utils。

下載的檔案一律視為不可信資料：本工具只讀取位元組、計算雜湊、呼叫 pdftotext
判斷文字層，絕不執行或開啟檔案內容。其他會讀這些檔案的 Python 腳本請用
`python3 -I` 執行。

範圍
----
  第一層（108 課綱）：學測 數學A、數學B，111 學年度起（目前 111–115）
      exam = gsat-matha / gsat-mathb
  第二層（舊課綱）：學測 數學，100–110 學年度（--tier2-min 可往前延伸）
      exam = gsat-math
  參考資料：學測參考試卷、考試說明、110 試辦考試中的數學檔
      exam = reference-math
  每一年收：試題（PDF＋官方 Word 版）、選擇（填）題答案、答題卷、
  非選擇題評分原則（只供內部參考，不得轉載，見 docs/research/10-math-gsat.md §6），
  以及試題統計（答對率／鑑別度、選項分析、非選擇題得分）。

子命令
------
  discover  爬大考中心列表頁，建立／更新 data/exams/math-manifest.json
  fetch     依 manifest 下載到 data/raw/ceec/{exam}/{year}/{kind}[-n].{ext}（預設）
  verify    只比對本機檔案與 manifest 的 sha256，不連網
  summary   印出 exam × 年 × kind 的統計

範例
----
  python3 tools/fetch_ceec_math.py discover
  python3 tools/fetch_ceec_math.py fetch --exam gsat-matha --exam gsat-mathb
  python3 tools/fetch_ceec_math.py fetch --kind paper --kind answer
  python3 tools/fetch_ceec_math.py verify
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as _dt
import json
import os
import re
import shutil
import sys
import threading
import time
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_ceec as fc  # noqa: E402  共用函式

PROJECT_ROOT = fc.PROJECT_ROOT
DEFAULT_MANIFEST = os.path.join(PROJECT_ROOT, "data", "exams", "math-manifest.json")
RAW_PREFIX = fc.RAW_PREFIX
GSAT = fc.SITES["gsat"]

TIER1_MIN = 111
TIER2_MIN_DEFAULT = 100
TIER2_MAX = 110

EXAM_ORDER = {"gsat-matha": 0, "gsat-mathb": 1, "gsat-math": 2, "reference-math": 3}
KIND_ORDER = fc.KIND_ORDER
SUBKIND_ORDER = dict(fc.SUBKIND_ORDER)

# 不得轉載的種類（只放 data/raw，不進版控、不在網站上顯示）
NO_REPUBLISH_SUBKINDS = {"scoring", "analysis"}


def subject_of(title: str):
    """列表標題「115學年度學科能力測驗－數學A」→ 'A'／'B'／''（舊數學）／None。"""
    subj = title.rsplit("－", 1)[-1].strip()
    m = re.fullmatch(r"數學\s*([AB])?", subj)
    if not m:
        return None
    return m.group(1) or ""


def exam_key(letter: str) -> str:
    return {"A": "gsat-matha", "B": "gsat-mathb", "": "gsat-math"}[letter]


def classify_math_file(label: str, fmt: str):
    if "試題內容" in label:
        return ("paper", "paper") if fmt == "pdf" else ("paper", "paper_word")
    if "封面" in label:
        return "other", "cover"
    if "答題卷" in label:
        return "other", "answer_sheet"
    if "答案" in label:
        return "answer", "answer"
    if "評分" in label:
        return "scoring", "scoring"
    return "other", None


def _item(**kw):
    it = fc._item(**kw)
    if it.get("subkind") in NO_REPUBLISH_SUBKINDS:
        it["republish"] = False
    return it


def discover_papers(tier2_min: int):
    sid = GSAT["papers"]
    fc.log(f"[discover] 學測歷年試題列表 {fc.BASE}/xmfile?xsmsid={sid}")
    items = []
    for row in fc.crawl_xmfile(sid):
        letter = subject_of(row["title"])
        if letter is None:
            continue
        year = fc._roc_year(row["title"])
        if year is None:
            continue
        if letter in ("A", "B"):
            if year < TIER1_MIN:
                continue
            tier = 1
        else:
            if not (tier2_min <= year <= TIER2_MAX):
                continue
            tier = 2
        session = "makeup" if ("補考" in row["title"] or "補救" in row["title"]) else "regular"
        for f in row["files"]:
            fmt = fc._ext(f["url"])
            kind, sub = classify_math_file(f["label"], fmt)
            notes = []
            if session == "makeup":
                notes.append(f"補考場次（官方列表標題：{row['title']}）")
            if sub == "paper_word":
                notes.append("官方提供之 Word 版試題")
            if sub == "scoring":
                notes.append("非選擇題評分原則：只供內部參考，不得轉載或在網站顯示")
            items.append(_item(
                exam=exam_key(letter), year=year, session=session, kind=kind,
                subkind=sub, title=f"{row['title']}｜{f['label']}", label=f["label"],
                url=f["url"], source_page=row["page_url"], note="；".join(notes),
                list_date=row["date"], tier=tier))
    return items


STATS_RULES = [
    (re.compile(r"答對率及鑑別(?:度|指數)表"), "pd_table",
     "選擇（填）題各題答對率（P）與鑑別度（D）"),
    (re.compile(r"選擇題選項分析|選項分析"), "option_analysis", "選擇題各選項選答比例分析"),
    (re.compile(r"非選擇題(?:各題)?分數人數統計表"), "nonmc_score_dist",
     "非選擇題各題得分人數分布"),
]


def _stats_subject(label: str):
    """統計檔標籤裡的科目：'A'／'B'／''（數學）／'all'（各科合併）／None（其他科）。"""
    if re.search(r"數學\s*A|數A", label):
        return "A"
    if re.search(r"數學\s*B|數B", label):
        return "B"
    if "數學" in label:
        return ""
    if "各科" in label:
        return "all"
    return None


def discover_stats(tier2_min: int):
    fc.log("[discover] 學測統計資料（數學）")
    items = []
    for e in fc.crawl_xmdoc_list(GSAT["stats"]):
        year = fc._roc_year(e["title"])
        if year is None or year < tier2_min:
            continue
        _, files = fc.parse_cont_files(fc.get_html(e["url"]))
        for f in files:
            label = f["label"]
            if "初複閱" in label or "術科" in label:
                continue
            for rx, sub, desc in STATS_RULES:
                if not rx.search(label):
                    continue
                subj = _stats_subject(label)
                if subj is None:
                    break
                exams = []
                if subj == "all":
                    exams = ["gsat-matha", "gsat-mathb"] if year >= TIER1_MIN else ["gsat-math"]
                elif subj in ("A", "B") and year >= TIER1_MIN:
                    exams = [exam_key(subj)]
                elif subj == "" and year <= TIER2_MAX:
                    exams = ["gsat-math"]
                for ex in exams[:1]:  # 合併檔只收一次，掛在第一個 exam 下
                    note = desc
                    if subj == "all":
                        note += ("；各科合併檔，數學A與數學B都在內（只掛在 gsat-matha 下一次）"
                                 if year >= TIER1_MIN else "；各科合併檔，數學為其中一個工作表／區段")
                    items.append(_item(
                        exam=ex, year=year, kind="stats", subkind=sub,
                        title=f"{e['title']}｜{label}", label=label, url=f["url"],
                        source_page=e["url"], note=note,
                        tier=1 if year >= TIER1_MIN else 2))
                break
    return items


def discover_reference():
    """參考試卷、試辦考試、考試說明中的數學檔。"""
    entries = []
    fc.log("[discover] 學測參考試卷")
    for e in fc.crawl_xmdoc_list(GSAT["reference"]):
        entries.append(("ref", e))
    for sid in fc.TRIAL_LISTS:
        fc.log(f"[discover] 學測試辦考試 {sid}")
        for e in fc.crawl_xmdoc_list(sid):
            entries.append(("trial", e))
    fc.log("[discover] 學測考試說明")
    for e in fc.crawl_xmdoc_list(GSAT["spec"]):
        entries.append(("spec", e))
    items = []
    for src_kind, e in entries:
        if "特殊試題" in e["title"]:
            continue
        _, files = fc.parse_cont_files(fc.get_html(e["url"]))
        for f in files:
            fn = fc._filename(f["url"])
            hay = fn + " " + (f["label"] or "")
            if not re.search(r"數學|數[AB甲乙]", hay):
                continue
            if re.search(r"數學?[甲乙]|分科|指考", hay):
                continue  # 分科測驗數甲／數乙不在本專案範圍
            fmt = fc._ext(f["url"])
            kind, sub = fc.classify_ref_file(fn, fmt)
            if src_kind == "trial" and "試卷" in fn and "答題卷" not in fn:
                kind, sub = ("paper", "paper") if fmt == "pdf" else ("paper", "paper_word")
            year = fc._ref_year(e["title"], fn)
            m = re.search(r"數學?\s*([AB])", hay)
            notes = [{"trial": "108 課綱學測 110 年試辦考試", "spec": "考試說明",
                      "ref": "參考試卷"}[src_kind]]
            if m:
                notes.append(f"數學{m.group(1)}")
            if sub in NO_REPUBLISH_SUBKINDS or (sub == "answer" and "參考答案" in fn):
                notes.append("含非選擇題參考答案／解析：只供內部參考，不得轉載")
            it = _item(
                exam="reference-math", year=year, target="gsat", kind=kind,
                subkind=sub, title=f"{e['title']}｜{fn}", label=f["label"] or None,
                url=f["url"], source_page=e["url"], note="；".join(notes), tier=3)
            if "不得轉載" in it["note"]:
                it["republish"] = False
            items.append(it)
    return items


def assign_local_paths(items):
    groups = defaultdict(list)
    for it in items:
        groups[(it["exam"], it["year"], it["kind"])].append(it)
    for (exam, year, kind), grp in groups.items():
        grp.sort(key=lambda it: (
            it["session"] != "regular", SUBKIND_ORDER.get(it["subkind"] or "", 99),
            fc.FORMAT_ORDER.get(it["format"], 9), it.get("_order", 0)))
        for n, it in enumerate(grp, 1):
            suffix = "" if len(grp) == 1 else f"-{n}"
            it["local_path"] = f"{RAW_PREFIX}/{exam}/{year}/{kind}{suffix}.{it['format']}"


def sort_items(items):
    items.sort(key=lambda it: (EXAM_ORDER[it["exam"]], -(it["year"] or 0),
                               KIND_ORDER[it["kind"]], fc._natural(it["local_path"])))


def build_manifest(items):
    return {
        "generated_at": _dt.date.today().isoformat(),
        "description": "大考中心學測數學考科下載清單：108 課綱數學A、數學B（111 起）與舊課綱學測數學"
                       "（第二層，100–110），含試題、選擇（填）題答案、答題卷、非選擇題評分原則"
                       "（只供內部參考）與試題統計；另收參考試卷、試辦考試與考試說明中的數學檔。",
        "source_site": fc.BASE,
        "tool": "tools/fetch_ceec_math.py",
        "path_rule": "local_path 相對於專案根目錄：data/raw/ceec/{exam}/{year}/{kind}[-n].{format}"
                     "（data/raw 不進版控）",
        "fields": {
            "exam": "gsat-matha=學測數學A；gsat-mathb=學測數學B；gsat-math=舊課綱學測數學；"
                    "reference-math=參考試卷／試辦考試／考試說明",
            "year": "民國學年度；reference-math 為適用／施測學年度",
            "tier": "1=108 課綱數A／數B（111 起，要結構化）；2=舊學測數學（100–110，只下載）；"
                    "3=參考資料",
            "session": "regular 或 makeup",
            "kind": "paper|answer|scoring|stats|other",
            "subkind": "paper, paper_word, answer, scoring, answer_sheet, cover, pd_table, "
                       "option_analysis, nonmc_score_dist, paper_note, analysis, exam_spec",
            "republish": "false＝受著作權保護的解答、評分原則或解析：只能內部參考，"
                         "不得轉載、不得在網站顯示（欄位不存在＝試題或答案代號，可依授權規則使用）",
            "text_extractable": "同 data/exams/manifest.json：PDF 前兩頁（不足時前五頁）以 "
                                "pdftotext 擷取到 ≥80 個有效字元且非亂碼；非 PDF 為 null",
            "text_chars": "上述判斷所擷取到的有效字元數",
            "text_quality": "ok｜none（掃描影像）｜garbled（字型缺 Unicode 對應）",
            "duplicate_of": "內容（sha256）與另一項目完全相同時，指向該項目的 local_path",
        },
        "items": items,
    }


def cmd_discover(args):
    old = {}
    if os.path.exists(args.manifest):
        with open(args.manifest, encoding="utf-8") as f:
            for it in json.load(f).get("items", []):
                old[it["url"]] = it
    items = discover_papers(args.tier2_min) + discover_stats(args.tier2_min)
    if not args.no_reference:
        items += discover_reference()
    uniq, seen = [], set()
    for i, it in enumerate(items):
        if it["url"] in seen:
            continue
        seen.add(it["url"])
        it["_order"] = i
        uniq.append(it)
    items = uniq
    assign_local_paths(items)
    for it in items:
        it.pop("_order", None)
        prev = old.get(it["url"])
        if prev:
            for k in ("bytes", "sha256", "text_extractable", "text_chars", "text_quality",
                      "error"):
                if prev.get(k) is not None:
                    it[k] = prev[k]
            if prev.get("local_path") != it["local_path"]:
                src = os.path.join(PROJECT_ROOT, prev["local_path"])
                dst = os.path.join(PROJECT_ROOT, it["local_path"])
                if os.path.exists(src) and not os.path.exists(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(src, dst)
    sort_items(items)
    fc.write_manifest(args.manifest, build_manifest(items))
    fc.log(f"[discover] {len(items)} items -> {args.manifest}")


def _probe(it, dest):
    if it["format"] != "pdf":
        return {"text_extractable": None, "text_chars": None, "text_quality": None}
    ok, n, q = fc.pdf_text_probe(dest)
    return {"text_extractable": ok, "text_chars": n, "text_quality": q}


def fetch_one(it, force=False):
    dest = os.path.join(PROJECT_ROOT, it["local_path"])
    if not force and os.path.exists(dest) and it.get("sha256"):
        if fc.sha256_file(dest) == it["sha256"]:
            upd = _probe(it, dest) if (it["format"] == "pdf" and it.get("text_quality") is None) else {}
            return "skip", upd
    n, digest = fc.http_get(it["url"], dest)
    upd = {"bytes": n, "sha256": digest, "error": None}
    if not fc.check_magic(dest, it["format"]):
        upd["error"] = f"檔頭與副檔名 {it['format']} 不符（可能是錯誤頁）"
    upd.update(_probe(it, dest))
    return "downloaded", upd


def _select(items, args):
    out = []
    for it in items:
        if args.exam and it["exam"] not in args.exam:
            continue
        if args.kind and it["kind"] not in args.kind:
            continue
        if args.year and it["year"] not in args.year:
            continue
        out.append(it)
    return out[: args.limit] if args.limit else out


def cmd_fetch(args):
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)
    items = _select(manifest["items"], args)
    fc.log(f"[fetch] {len(items)} items")
    counts = Counter()
    done = 0
    lock = threading.Lock()

    def work(it):
        try:
            status, upd = fetch_one(it, force=args.force)
        except fc.FetchError as e:
            status, upd = "failed", {"error": str(e)}
        if status == "downloaded":
            time.sleep(args.delay)
        return it, status, upd

    with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        for fut in cf.as_completed([ex.submit(work, it) for it in items]):
            it, status, upd = fut.result()
            with lock:
                fc._apply(it, upd)
                counts[status] += 1
                done += 1
                fc.log(f"[{done}/{len(items)}] {status:10s} {it['local_path']}"
                       + (f"  ERROR {it.get('error')}" if status == "failed" else ""))
                if done % 25 == 0:
                    fc.write_manifest(args.manifest, manifest)
    sort_items(manifest["items"])
    fc.mark_duplicates(manifest["items"])
    header = build_manifest([])
    header.pop("items")
    fc.write_manifest(args.manifest, {**header, "items": manifest["items"]})
    fc.log(f"[fetch] done: {dict(counts)}")
    return 0 if counts["failed"] == 0 else 1


def cmd_verify(args):
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)
    bad = 0
    for it in _select(manifest["items"], args):
        p = os.path.join(PROJECT_ROOT, it["local_path"])
        if not os.path.exists(p):
            print(f"MISSING  {it['local_path']}")
            bad += 1
        elif it.get("sha256") and fc.sha256_file(p) != it["sha256"]:
            print(f"MISMATCH {it['local_path']}")
            bad += 1
    print(f"verify: {bad} problem(s)")
    return 1 if bad else 0


def cmd_summary(args):
    with open(args.manifest, encoding="utf-8") as f:
        items = json.load(f)["items"]
    total = sum(it.get("bytes") or 0 for it in items)
    print(f"items={len(items)} bytes={total} ({total / 1048576:.1f} MiB)")
    by = Counter((it["exam"], it["year"], it["kind"]) for it in items)
    years = defaultdict(dict)
    for (ex, y, k), n in by.items():
        years[(ex, y)][k] = n
    for (ex, y) in sorted(years, key=lambda k: (EXAM_ORDER[k[0]], -(k[1] or 0))):
        cells = " ".join(f"{k}={years[(ex, y)][k]}" for k in KIND_ORDER if k in years[(ex, y)])
        print(f"  {ex:15s} {y!s:>4} {cells}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="fetch",
                    choices=["discover", "fetch", "verify", "summary"])
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--exam", action="append", choices=list(EXAM_ORDER))
    ap.add_argument("--kind", action="append", choices=list(KIND_ORDER))
    ap.add_argument("--year", action="append", type=int)
    ap.add_argument("--tier2-min", type=int, default=TIER2_MIN_DEFAULT,
                    help="舊課綱學測數學的最早學年度（預設 100）")
    ap.add_argument("--no-reference", action="store_true", help="discover 時不爬參考試卷／考試說明")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    return {"discover": cmd_discover, "fetch": cmd_fetch, "verify": cmd_verify,
            "summary": cmd_summary}[args.command](args) or 0


if __name__ == "__main__":
    sys.exit(main())
