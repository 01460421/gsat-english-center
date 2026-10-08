#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
大考中心（CEEC, https://www.ceec.edu.tw）歷屆英文考科資料：清單建立與下載工具。

只使用 Python 3 標準庫；若系統有 poppler-utils 的 `pdftotext`，會用它測試 PDF
前兩頁能否擷取文字（判斷是否為掃描檔）。下載的檔案一律視為不可信資料：本工具
只讀取位元組、計算雜湊、呼叫 pdftotext 解析，絕不執行檔案內容。

子命令
------
  discover  重新爬大考中心網站的列表頁，建立／更新 data/exams/manifest.json
            （已下載項目的 bytes／sha256／text_extractable 依 url 保留）。
  fetch     讀 manifest，下載到 data/raw/ceec/{exam}/{year}/{kind}[-n].{ext}；
            檔案已存在且 sha256 與 manifest 相符就略過；下載後回寫
            bytes／sha256／text_extractable。（預設子命令）
  verify    只檢查本機檔案與 manifest 的 sha256 是否一致，不連網。
  summary   印出 年份 × 種類 的覆蓋統計。

範例
----
  python3 tools/fetch_ceec.py discover
  python3 tools/fetch_ceec.py fetch --workers 2
  python3 tools/fetch_ceec.py fetch --exam gsat --year 115 --kind paper
  python3 tools/fetch_ceec.py verify

網路
----
大考中心網站偶爾 connection reset，所有請求都有指數退避重試（含隨機抖動）。
會依環境變數 HTTPS_PROXY 走代理，並以 SSL_CERT_FILE / REQUESTS_CA_BUNDLE /
CURL_CA_BUNDLE 指定的 CA bundle 驗證 TLS（未設定則用系統預設）。
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as _dt
import hashlib
import html
import http.client
import json
import os
import random
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

BASE = "https://www.ceec.edu.tw"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_MANIFEST = os.path.join(PROJECT_ROOT, "data", "exams", "manifest.json")
RAW_PREFIX = "data/raw/ceec"  # 相對於專案根目錄
USER_AGENT = ("Mozilla/5.0 (compatible; gsat-english-center-fetcher/1.0; "
              "personal study use)")

# ---------------------------------------------------------------------------
# 大考中心網站的列表頁（xsmsid）。來源：網站選單，2026-10-07 檢視。
# ---------------------------------------------------------------------------
SITES = {
    "gsat": {
        "label": "學科能力測驗",
        "papers": "0J052424829869345634",   # 歷年試題及答題卷 > 一般試題
        "stats": "0J018604485538810196",    # 統計資料
        "essays": "0J071624926253508127",   # 佳作
        "reference": "0J018586101460336585",  # 參考試卷
        "spec": "0J018585845010094026",     # 考試說明
        "year_min": 83,
        "year_max": None,
    },
    "ast": {
        "label": "指定科目考試",
        "papers": "0J052427633128416650",   # 分科測驗(110前指考) > 一般試題
        "stats": "0J018611000723433352",
        "essays": "0J071646661300229964",
        "reference": "0J018609919479141840",
        "spec": "0J018609653929908281",
        "year_min": 91,
        "year_max": 110,                    # 111 起改為分科測驗（不考英文）
    },
}
# 學測試辦考試（108 課綱）：110 年有英文；109 年只有社會、自然。
TRIAL_LISTS = ["0M091481045388073608", "0M091481446101700680"]

KIND_ORDER = {"paper": 0, "answer": 1, "scoring": 2, "stats": 3, "other": 4}
EXAM_ORDER = {"gsat": 0, "ast": 1, "reference": 2}
SUBKIND_ORDER = {
    "paper": 0, "paper_word": 1, "answer": 2, "scoring": 3, "scoring_note": 4,
    "pd_table": 5, "option_analysis": 6, "nonmc_score_dist": 7,
    "cover": 8, "answer_sheet": 9, "answer_sheet_a4": 10, "paper_note": 11,
    "analysis": 12, "exam_spec": 13, "essay_sample": 14,
    # 2026-10-08 新增；排在既有 stats 子類之後，既有檔案的 stats-N 編號不會變動
    "score_standard": 15, "score_conversion": 16,
}
FORMAT_ORDER = {"pdf": 0, "docx": 1, "doc": 2, "xls": 3, "xlsx": 4, "jpg": 5,
                "png": 6}

_print_lock = threading.Lock()


def log(*a):
    with _print_lock:
        print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def _ssl_context() -> ssl.SSLContext:
    ctx = None
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        p = os.environ.get(var)
        if p and os.path.exists(p):
            ctx = ssl.create_default_context(cafile=p)
            break
    if ctx is None:
        ctx = ssl.create_default_context()
    # Python 3.13 起 ssl.create_default_context() 預設開啟 VERIFY_X509_STRICT
    # （https://docs.python.org/3.13/library/ssl.html#ssl.create_default_context），
    # 會拒絕缺少 Subject Key Identifier 等擴充欄位的憑證鏈（部分企業／沙箱代理 CA 如此，
    # 錯誤訊息為「Missing Subject Key Identifier」）。這裡只關掉「嚴格 RFC 5280 檢查」，
    # 憑證鏈與主機名稱驗證仍照常進行。註：curl 預設不做這項嚴格檢查；requests（urllib3 2.x）
    # 在 Python 3.13 上同樣會開啟它，因此在同一代理環境下 requests 也會失敗（2026-10-08 實測）。
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


_OPENER = None


def _opener():
    global _OPENER
    if _OPENER is None:
        handlers = [urllib.request.HTTPSHandler(context=_ssl_context())]
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        if proxy:
            handlers.append(urllib.request.ProxyHandler({"https": proxy}))
        _OPENER = urllib.request.build_opener(*handlers)
    return _OPENER


def normalize_url(url: str) -> str:
    """把非 ASCII 與空白字元百分比編碼（保留既有的 %xx）。"""
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(p.path, safe="/%:@!$&'()*+,;=-._~")
    query = urllib.parse.quote(p.query, safe="=&%/:+,;-._~")
    return urllib.parse.urlunsplit((p.scheme, p.netloc, path, query, ""))


class FetchError(Exception):
    pass


def http_get(url: str, dest: str | None = None, *, retries: int = 6,
             base_delay: float = 2.0, timeout: float = 120.0):
    """GET url。dest=None 時回傳 bytes；否則串流寫入 dest（原子替換）並回傳
    (bytes, sha256)。失敗時以指數退避 + 抖動重試。"""
    url = normalize_url(url)
    last_err = None
    for attempt in range(retries + 1):
        if attempt:
            delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 1.5)
            log(f"  retry {attempt}/{retries} in {delay:.1f}s: {last_err}")
            time.sleep(delay)
        tmp_path = None
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": USER_AGENT, "Accept": "*/*",
                "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5"})
            with _opener().open(req, timeout=timeout) as resp:
                expected = resp.headers.get("Content-Length")
                expected = int(expected) if expected and expected.isdigit() else None
                if dest is None:
                    data = resp.read()
                    if expected is not None and len(data) != expected:
                        raise FetchError(f"short read {len(data)}/{expected}")
                    return data
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                h = hashlib.sha256()
                n = 0
                fd, tmp_path = tempfile.mkstemp(prefix=".part-",
                                                dir=os.path.dirname(dest))
                with os.fdopen(fd, "wb") as f:
                    while True:
                        chunk = resp.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                        h.update(chunk)
                        n += len(chunk)
                if expected is not None and n != expected:
                    raise FetchError(f"short read {n}/{expected}")
                if n == 0:
                    raise FetchError("empty body")
                os.chmod(tmp_path, 0o644)  # mkstemp 預設 0600
                os.replace(tmp_path, dest)
                tmp_path = None
                return n, h.hexdigest()
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            if e.code in (403, 404, 407, 410):  # 不會因重試而改變
                raise FetchError(last_err) from e
        except urllib.error.URLError as e:
            last_err = f"URLError: {e.reason}"
            if isinstance(e.reason, ssl.SSLCertVerificationError):
                raise FetchError(last_err) from e  # 憑證問題重試也沒用
        except (http.client.HTTPException, OSError, FetchError, TimeoutError) as e:
            last_err = f"{type(e).__name__}: {e}"
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
    raise FetchError(f"giving up after {retries + 1} attempts: {last_err}")


def get_html(url: str, polite: float = 0.4) -> str:
    data = http_get(url)
    time.sleep(polite)
    return data.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# HTML 解析（大考中心 CMS 的固定版型）
# ---------------------------------------------------------------------------
def _text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    return "\n".join(" ".join(line.split()) for line in t.splitlines()
                     if line.strip()).strip()


def _abs(href: str) -> str:
    return urllib.parse.urljoin(BASE + "/", html.unescape(href.strip()))


def _filename(url: str) -> str:
    return urllib.parse.unquote(url.rstrip("/").rsplit("/", 1)[-1])


def _ext(url: str) -> str:
    fn = _filename(url).lower()
    return fn.rsplit(".", 1)[-1] if "." in fn else "bin"


def _main_block(page: str) -> str:
    i = page.find('id="MainForm"')
    if i < 0:
        return page
    j = page.find("</form>", i)
    return page[i:j if j > 0 else len(page)]


def _last_page(page: str, sid: str) -> int:
    pages = [int(x) for x in re.findall(
        r"xsmsid=%s&(?:amp;)?page=(\d+)" % re.escape(sid), page)]
    return max(pages) if pages else 1


def parse_xmfile_rows(page: str):
    """「歷年試題」列表：<tr><td class="date">…<td class="title">…<td class="download">…"""
    rows = []
    for m in re.finditer(
            r'<td class="date">([^<]*)</td>\s*<td class="title">(.*?)</td>\s*'
            r'<td class="download">(.*?)</td>', page, re.S):
        files = []
        for a in re.finditer(r'<a\s+href="([^"]+)"[^>]*?title="([^"]*)"[^>]*>(.*?)</a>',
                             m.group(3), re.S):
            files.append({"url": _abs(a.group(1)),
                          "name": html.unescape(a.group(2)).strip(),
                          "label": _text(a.group(3))})
        rows.append({"date": m.group(1).strip(), "title": _text(m.group(2)),
                     "files": files})
    return rows


def parse_xmdoc_entries(page: str):
    """xmdoc 列表頁中的條目連結（/xmdoc/cont?xsmsid=…&sid=…）。"""
    out, seen = [], set()
    for m in re.finditer(r'<a[^>]+href="([^"]*xmdoc/cont\?xsmsid=[^"&]+&(?:amp;)?sid=[^"]+)"'
                         r'[^>]*>(.*?)</a>', page, re.S):
        url, title = _abs(m.group(1)), _text(m.group(2))
        if not title or url in seen:
            continue
        seen.add(url)
        out.append({"url": url, "title": title})
    return out


def parse_cont_files(page: str):
    """條目內頁（MainForm 區塊）中的附檔連結；若在表格列中，順便抓同列文字（如佳作評語）。"""
    blk = _main_block(page)
    m = re.search(r'<h3 class="title"><span>(.*?)</span>', blk, re.S)
    title = _text(m.group(1)) if m else ""
    files, seen = [], set()
    for row in re.finditer(r"<tr>(.*?)</tr>", blk, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row.group(1), re.S)
        for a in re.finditer(r'<a[^>]+href="([^"]*/files/file_pool/[^"]+)"[^>]*>(.*?)</a>',
                             row.group(1), re.S):
            url = _abs(a.group(1))
            if url in seen:
                continue
            seen.add(url)
            comment = ""
            if len(cells) >= 3:
                comment = _text(cells[-1])
            files.append({"url": url, "label": _text(a.group(2)), "comment": comment})
    for a in re.finditer(r'<a[^>]+href="([^"]*/files/file_pool/[^"]+)"[^>]*>(.*?)</a>', blk, re.S):
        url = _abs(a.group(1))
        if url in seen:
            continue
        seen.add(url)
        files.append({"url": url, "label": _text(a.group(2)), "comment": ""})
    return title, files


def crawl_xmfile(sid: str):
    url1 = f"{BASE}/xmfile?xsmsid={sid}"
    first = get_html(url1)
    rows = [dict(r, page_url=url1) for r in parse_xmfile_rows(first)]
    for p in range(2, _last_page(first, sid) + 1):
        url = f"{BASE}/xmfile?xsmsid={sid}&page={p}"
        rows += [dict(r, page_url=url) for r in parse_xmfile_rows(get_html(url))]
    return rows


def crawl_xmdoc_list(sid: str):
    first = get_html(f"{BASE}/xmdoc?xsmsid={sid}")
    entries = parse_xmdoc_entries(_main_block(first))
    for p in range(2, _last_page(first, sid) + 1):
        entries += parse_xmdoc_entries(_main_block(
            get_html(f"{BASE}/xmdoc?xsmsid={sid}&page={p}")))
    uniq, seen = [], set()
    for e in entries:
        if e["url"] not in seen:
            seen.add(e["url"])
            uniq.append(e)
    return uniq


# ---------------------------------------------------------------------------
# discover：建立 manifest 項目
# ---------------------------------------------------------------------------
def _roc_year(title: str):
    m = re.match(r"\s*0*(\d{2,3})\s*(?:學年度|年|指定|學科)", title)
    return int(m.group(1)) if m else None


def _in_range(exam: str, year) -> bool:
    if year is None:
        return False
    cfg = SITES[exam]
    if year < cfg["year_min"]:
        return False
    return cfg["year_max"] is None or year <= cfg["year_max"]


def _item(**kw):
    base = {
        "exam": None, "year": None, "session": "regular", "target": None,
        "kind": None, "subkind": None, "title": None, "label": None,
        "official_filename": None, "format": None, "url": None,
        "source_page": None, "local_path": None, "bytes": None, "sha256": None,
        "text_extractable": None, "note": "",
    }
    base.update(kw)
    base["official_filename"] = base["official_filename"] or _filename(base["url"])
    base["format"] = base["format"] or _ext(base["url"])
    return base


def classify_exam_file(label: str, fmt: str):
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


def classify_ref_file(fn: str, fmt: str):
    if "答題卷" in fn:
        return "other", ("answer_sheet_a4" if "A4" in fn else "answer_sheet")
    if "評分原則" in fn:
        return "scoring", "scoring"
    if "參考答案" in fn:
        return "answer", "answer"
    if "解析" in fn:
        return "other", "analysis"
    if "考試說明" in fn or "命題方向" in fn:
        return "other", "exam_spec"
    if "說明" in fn:
        return "other", "paper_note"
    return ("paper", "paper") if fmt == "pdf" else ("paper", "paper_word")


def _ref_year(entry_title: str, fn: str):
    for src in (fn, entry_title):
        m = re.search(r"(\d{2,3})學年度起適用", src)
        if m:
            return int(m.group(1))
    m = re.search(r"(\d{2,3})年(?:起|開始)?施測", entry_title)
    if m:
        return int(m.group(1))
    m = re.match(r"\s*(\d{2,3})(?:學年度|年)", entry_title)
    if m:
        return int(m.group(1))
    if "99課綱" in entry_title or "99課綱" in fn:
        return 102  # 依官方「99課綱(102年施測)」頁面標題
    return None


def _combined_note(fn: str) -> str:
    notes = []
    if re.search(r"國文[、.]?\s*英文|國英", fn):
        notes.append("與國文合併為同一檔")
    if re.search(r"數乙|數甲", fn):
        notes.append("多科選擇題答案合併檔（數乙、國文、英文、數甲）")
    if "記者會" in fn:
        notes.append("檔名為記者會說明資料，內含非選擇題評分原則說明")
    return "；".join(notes)


def discover_exam_papers(exam: str):
    cfg = SITES[exam]
    sid = cfg["papers"]
    src = f"{BASE}/xmfile?xsmsid={sid}"
    log(f"[discover] {exam} 歷年試題列表 {src}")
    items = []
    for row in crawl_xmfile(sid):
        title = row["title"]
        subject = title.rsplit("－", 1)[-1].strip()
        if subject != "英文":
            continue
        year = _roc_year(title)
        if not _in_range(exam, year):
            continue
        if exam == "ast" and "分科測驗" in title:
            continue
        session = "makeup" if ("補考" in title or "補救" in title) else "regular"
        for f in row["files"]:
            fmt = _ext(f["url"])
            kind, sub = classify_exam_file(f["label"], fmt)
            notes = []
            if session == "makeup":
                notes.append(f"補考場次（官方列表標題：{title}）")
            cn = _combined_note(_filename(f["url"]))
            if cn:
                notes.append(cn)
            if sub == "paper_word":
                notes.append("官方提供之 Word 版試題")
            items.append(_item(
                exam=exam, year=year, session=session, kind=kind, subkind=sub,
                title=f"{title}｜{f['label']}", label=f["label"], url=f["url"],
                source_page=row["page_url"],
                note="；".join(notes), list_date=row["date"]))
    return items


STATS_RULES = [
    # (標籤規則, subkind, 說明, 是否要求標籤含「英文」或「各科」)
    (re.compile(r"答對率及鑑別(?:度|指數)表"), "pd_table",
     "選擇題各題答對率（P）與鑑別度／鑑別指數（D）", True),
    (re.compile(r"選擇題選項分析"), "option_analysis", "選擇題各選項選答比例分析", True),
    (re.compile(r"非選擇題(?:各題)?分數人數統計表"), "nonmc_score_dist",
     "非選擇題各題得分人數分布", True),
    # 成績標準（頂標／前標／均標／後標／底標）：「超越頂標」等難度分級的校準依據。
    # 指考 91–96 的標籤是「學科成績標準一覽表」（不含「各科」），所以不套科目篩選。
    (re.compile(r"成績標準一覽表"), "score_standard",
     "各科成績標準（頂標、前標、均標、後標、底標）", False),
    # 學測原始分數（111 起稱「原得總分」）與級分對照：練習成績換算級分用（指考沒有級分）
    (re.compile(r"(?:原始分數|原得總分)與級分對照表"), "score_conversion",
     "原始分數／原得總分與級分對照", False),
]

# 「83至89學年度」這類合併條目：年度改由附檔標籤開頭的學年度決定
_RANGE_TITLE = re.compile(r"\s*(\d{2,3})\s*[至~～－-]\s*(\d{2,3})\s*學年度")
_LABEL_YEAR = re.compile(r"\s*(\d{2,3})(?:\s*[至~～－-]\s*(\d{2,3}))?\s*學年度")


def discover_stats(exam: str):
    cfg = SITES[exam]
    sid = cfg["stats"]
    log(f"[discover] {exam} 統計資料")
    items = []
    for e in crawl_xmdoc_list(sid):
        year = _roc_year(e["title"])
        ranged = year is None and _RANGE_TITLE.match(e["title"])
        if not ranged and not _in_range(exam, year):
            continue
        if exam == "ast" and "分科" in e["title"]:
            continue
        _, files = parse_cont_files(get_html(e["url"]))
        for f in files:
            label = f["label"]
            if "初複閱" in label:
                continue
            fyear, span = year, ""
            lm = _LABEL_YEAR.match(label)
            if lm:
                fyear = int(lm.group(1))
                if lm.group(2):
                    span = f"；本檔涵蓋 {lm.group(1)}–{lm.group(2)} 學年度"
            if not _in_range(exam, fyear):
                continue
            for rx, sub, desc, need_subject in STATS_RULES:
                if not rx.search(label):
                    continue
                # 只要英文科專屬或「各科」合併檔（成績標準、級分對照表的標籤不一定寫科目，
                # 一律收，但排除術科）
                if need_subject and not ("英文" in label or "各科" in label):
                    continue
                if "術科" in label:
                    continue
                note = desc + ("；各科合併檔，英文為其中一個工作表／區段"
                               if (("各科" in label) or not need_subject) else "") + span
                items.append(_item(
                    exam=exam, year=fyear, kind="stats", subkind=sub,
                    title=f"{e['title']}｜{label}", label=label, url=f["url"],
                    source_page=e["url"], note=note))
                break
    return items


def discover_essays(exam: str):
    cfg = SITES[exam]
    log(f"[discover] {exam} 英文作文佳作")
    items = []
    for e in crawl_xmdoc_list(cfg["essays"]):
        if "英文" not in e["title"]:
            continue
        year = _roc_year(e["title"])
        if not _in_range(exam, year):
            continue
        _, files = parse_cont_files(get_html(e["url"]))
        for f in files:
            if not re.search(r"原卷", f["label"]):
                continue
            note = "考生英文作文佳作原卷影像（手寫掃描）"
            if f["comment"]:
                note += "。官方評分說明：" + f["comment"].replace("\n", " ")
            items.append(_item(
                exam=exam, year=year, kind="other", subkind="essay_sample",
                title=f"{e['title']}｜{f['label']}", label=f["label"], url=f["url"],
                source_page=e["url"], note=note))
    return items


def discover_reference():
    items, seen_fn = [], {}
    entries = []
    for exam in ("gsat", "ast"):
        log(f"[discover] {exam} 參考試卷")
        for e in crawl_xmdoc_list(SITES[exam]["reference"]):
            entries.append((exam, "ref", e))
    for sid in TRIAL_LISTS:
        log(f"[discover] 學測試辦考試 {sid}")
        for e in crawl_xmdoc_list(sid):
            entries.append(("gsat", "trial", e))
    for exam in ("gsat", "ast"):
        log(f"[discover] {exam} 考試說明")
        for e in crawl_xmdoc_list(SITES[exam]["spec"]):
            entries.append((exam, "spec", e))
    for exam, src_kind, e in entries:
        if "特殊試題" in e["title"]:
            continue
        _, files = parse_cont_files(get_html(e["url"]))
        for f in files:
            fn = _filename(f["url"])
            if "英文" not in fn and f["label"] != "英文":
                continue
            if "詞彙表" in fn or "聽力" in fn:
                continue  # 詞彙表另有子任務處理；英聽不在範圍內
            fmt = _ext(f["url"])
            kind, sub = classify_ref_file(fn, fmt)
            if src_kind == "trial" and "試卷" in fn and "答題卷" not in fn:
                kind, sub = ("paper", "paper") if fmt == "pdf" else ("paper", "paper_word")
            target = "ast" if ("指考" in fn or "分科" in fn) else (
                "gsat" if "學測" in fn else exam)
            year = _ref_year(e["title"], fn)
            notes = []
            if src_kind == "trial":
                notes.append("108 課綱學測 110 年試辦考試")
            elif sub == "exam_spec":
                notes.append("考試說明（含題型、配分與試題示例）")
            else:
                notes.append("參考試卷")
            if fn in seen_fn:
                # 同名檔在不同頁面以不同網址出現，內容可能是不同修訂版；兩者都保留，
                # fetch 後若 sha256 相同會標上 duplicate_of。
                notes.append(f"同名檔亦見於「{seen_fn[fn]['title'].split('｜')[0]}」")
            if year == 102 and "99課綱" in (e["title"] + fn) and "102" not in e["title"] + fn:
                notes.append("適用年度依官方『99課綱(102年施測)』頁面推定")
            if year and year >= 111:
                notes.append("108 課綱")
            it = _item(
                exam="reference", year=year, target=target, kind=kind, subkind=sub,
                title=f"{e['title']}｜{fn}", label=f["label"] or None, url=f["url"],
                source_page=e["url"], note="；".join(notes))
            seen_fn.setdefault(fn, it)
            items.append(it)
    return items


def assign_local_paths(items):
    groups = defaultdict(list)
    for it in items:
        groups[(it["exam"], it["year"], it["kind"])].append(it)
    for (exam, year, kind), grp in groups.items():
        grp.sort(key=lambda it: (
            it["session"] != "regular", it.get("target") or "",
            SUBKIND_ORDER.get(it["subkind"] or "", 99),
            FORMAT_ORDER.get(it["format"], 9), it.get("_order", 0)))
        for n, it in enumerate(grp, 1):
            suffix = "" if len(grp) == 1 else f"-{n}"
            it["local_path"] = f"{RAW_PREFIX}/{exam}/{year}/{kind}{suffix}.{it['format']}"


def _natural(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def sort_items(items):
    items.sort(key=lambda it: (EXAM_ORDER[it["exam"]], it["year"] or 0,
                               KIND_ORDER[it["kind"]], _natural(it["local_path"])))


def cmd_discover(args):
    old = {}
    if os.path.exists(args.manifest):
        with open(args.manifest, encoding="utf-8") as f:
            for it in json.load(f).get("items", []):
                old[it["url"]] = it
    items = []
    for exam in ("gsat", "ast"):
        items += discover_exam_papers(exam)
        items += discover_stats(exam)
        items += discover_essays(exam)
    items += discover_reference()
    # 依 url 去重
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
            for k in ("bytes", "sha256", "text_extractable", "text_chars",
                      "text_quality", "subjects_detected", "error"):
                if prev.get(k) is not None:
                    it[k] = prev[k]
            if prev.get("local_path") != it["local_path"]:
                # 路徑變了：舊檔若存在就搬過去，避免重新下載
                src = os.path.join(PROJECT_ROOT, prev["local_path"])
                dst = os.path.join(PROJECT_ROOT, it["local_path"])
                if os.path.exists(src) and not os.path.exists(dst):
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(src, dst)
    sort_items(items)
    manifest = build_manifest(items)
    write_manifest(args.manifest, manifest)
    log(f"[discover] {len(items)} items -> {args.manifest}")


def build_manifest(items):
    return {
        "generated_at": _dt.date.today().isoformat(),
        "description": "大考中心學測（83–115）與指考（91–110）英文考科歷屆試題、答案、"
                       "非選擇題評分原則、試題統計（答對率／鑑別度、選項分析、非選擇題得分、"
                       "成績標準、原始分數與級分對照），以及參考試卷、試辦考試、考試說明與"
                       "英文作文佳作之下載清單。",
        "source_site": BASE,
        "tool": "tools/fetch_ceec.py",
        "path_rule": "local_path 相對於專案根目錄：data/raw/ceec/{exam}/{year}/{kind}[-n].{format}",
        "fields": {
            "exam": "gsat=學科能力測驗；ast=指定科目考試；reference=參考試卷／試辦考試／考試說明",
            "year": "民國學年度；reference 為適用／施測學年度",
            "session": "regular 或 makeup（補考、補救考試）",
            "target": "reference 專用：gsat 或 ast",
            "kind": "paper|answer|scoring|stats|other",
            "subkind": "paper, paper_word, answer, scoring, pd_table, option_analysis, "
                       "nonmc_score_dist, score_standard（各科成績標準：頂／前／均／後／底標）, "
                       "score_conversion（學測原始分數／原得總分與級分對照）, cover, "
                       "answer_sheet, answer_sheet_a4, paper_note, analysis, exam_spec, "
                       "essay_sample",
            "text_extractable": "PDF 前兩頁以 pdftotext 擷取到 ≥80 個有效字元（英數、漢字）"
                                "且不是亂碼時為 true（前兩頁不足時擴大到前五頁再判斷一次，"
                                "避免封面＋目錄被誤判）；非 PDF 為 null",
            "text_chars": "上述判斷所擷取到的有效字元數",
            "text_quality": "ok｜none（幾乎無文字層，掃描影像）｜garbled（有文字層但字型"
                            "對應錯亂或缺 Unicode 對應，擷取結果為亂碼或空白；有內嵌字型而"
                            "無影像的 PDF 也歸此類）",
            "duplicate_of": "內容（sha256）與另一項目完全相同時，指向該項目的 local_path",
            "subjects_detected": "答案／評分原則 PDF 全文中出現的「○○考科」科目（多於一科"
                                 "代表多科合併檔）；無文字層或亂碼時不提供",
        },
        "items": items,
    }


def write_manifest(path, manifest):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".manifest-", dir=os.path.dirname(path))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# fetch
# ---------------------------------------------------------------------------
MAGIC = {
    "pdf": [b"%PDF"],
    "doc": [b"\xd0\xcf\x11\xe0"], "xls": [b"\xd0\xcf\x11\xe0"],
    "docx": [b"PK\x03\x04"], "xlsx": [b"PK\x03\x04"],
    "jpg": [b"\xff\xd8\xff"], "png": [b"\x89PNG"],
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def check_magic(path, fmt):
    sigs = MAGIC.get(fmt)
    if not sigs:
        return True
    with open(path, "rb") as f:
        head = f.read(1024)
    # 部分 PDF 前面有少量垃圾位元組；ISO 32000 要求檔頭在第一行，但 Acrobat 等閱讀器
    # 實作上容許 %PDF 出現在前 1024 bytes 內（未驗證是否所有閱讀器皆然），這裡採寬鬆判斷
    if fmt == "pdf":
        return b"%PDF" in head
    return any(head.startswith(s) for s in sigs)


_MEANINGFUL = re.compile(r"[A-Za-z0-9㐀-鿿豈-﫿]")
# 字型編碼錯亂（缺 ToUnicode）時，pdftotext 會吐出大量 Latin-1 符號或私用區字元。
# U+F000–U+F0FF 是 Symbol／Wingdings 字型（如翻譯參考答案的大括號）的對應，不算亂碼。
_GARBAGE = re.compile(r"[¡-ÿ--�]")
_PUNCT = re.compile(r"[!-/:-@\[-`{-~]")


def _pdftotext(exe, path, first, last):
    r = subprocess.run([exe, "-q", "-enc", "UTF-8", "-f", str(first), "-l", str(last),
                        path, "-"], capture_output=True, timeout=120)
    return r.stdout.decode("utf-8", errors="replace")


def _vector_text_without_unicode(path) -> bool:
    """PDF 有內嵌字型、卻沒有任何點陣影像：代表頁面是「向量文字」而不是掃描檔，
    pdftotext 擷取不到字只是因為字型缺少 Unicode 對應（例如指考 91 統計表的
    CID 字型字元集「Adobe-WinCharSetFFFF」、指考 91 封面的 Type 3 字型）。
    需要 poppler-utils 的 pdffonts／pdfimages；不存在時回傳 False。"""
    fonts_exe, imgs_exe = shutil.which("pdffonts"), shutil.which("pdfimages")
    if not (fonts_exe and imgs_exe):
        return False
    try:
        f = subprocess.run([fonts_exe, path], capture_output=True, timeout=60)
        i = subprocess.run([imgs_exe, "-list", path], capture_output=True, timeout=60)
    except (subprocess.TimeoutExpired, OSError):
        return False
    n_fonts = len(f.stdout.decode("utf-8", "replace").splitlines()[2:])
    n_imgs = len(i.stdout.decode("utf-8", "replace").splitlines()[2:])
    return n_fonts > 0 and n_imgs == 0


def pdf_text_probe(path):
    """用 pdftotext 擷取前兩頁，回傳 (text_extractable, 有效字元數, text_quality)。
    前兩頁有效字元不足 80（常見於封面＋目錄頁）時，再擴大到前五頁判斷一次。
    text_quality：ok＝可用文字；none＝幾乎沒有文字層（多為掃描影像）；
    garbled＝有文字層但字型對應錯亂、擷取結果是亂碼或空白。pdftotext 不存在時回傳 None。"""
    exe = shutil.which("pdftotext")
    if not exe:
        return None, None, None
    try:
        text = _pdftotext(exe, path, 1, 2)
        n = len(_MEANINGFUL.findall(text))
        if n < 80:
            text = _pdftotext(exe, path, 1, 5)
            n = len(_MEANINGFUL.findall(text))
    except (subprocess.TimeoutExpired, OSError):
        return None, None, None
    if n < 80:
        # 有字型、沒有影像 → 向量文字但缺 Unicode 對應，歸為 garbled（要用視覺讀取），
        # 不是掃描檔
        return False, n, ("garbled" if _vector_text_without_unicode(path) else "none")
    bad = len(_GARBAGE.findall(text))
    punct = len(_PUNCT.findall(text))
    total = n + bad + punct
    if bad / total > 0.15 or punct / total > 0.35:
        return False, n, "garbled"
    return True, n, "ok"


_SUBJECT_RX = re.compile(r"(國文|英文|數學甲|數學乙|數學|社會|自然|物理|化學|生物|歷史|地理|"
                         r"公民與社會)\s*考\s*科")


def detect_subjects(path):
    """答案／評分原則檔常是多科合併；擷取全文找「○○考科」字樣。無文字層時回傳 None。"""
    exe = shutil.which("pdftotext")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "-q", "-enc", "UTF-8", path, "-"],
                           capture_output=True, timeout=120)
    except (subprocess.TimeoutExpired, OSError):
        return None
    text = r.stdout.decode("utf-8", errors="replace")
    # 舊 PDF（如學測 90–94、指考 92–93）的中文會擷取成「㈻」「㆗」「㈥」等相容字元，
    # 先以 NFKC 正規化（㈻→(学)），再去掉單字括號並把簡體「学」換回「學」，
    # 否則「數㈻考科」「㈳會考科」會被漏判。
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"\((\S)\)", r"\1", text).replace("学", "學")
    text = re.sub(r"[ \t]+", "", text)
    found = []
    for m in _SUBJECT_RX.finditer(text):
        if m.group(1) not in found:
            found.append(m.group(1))
    return found or None


def _probe_updates(it, dest):
    if it["format"] != "pdf":
        return {"text_extractable": None, "text_chars": None, "text_quality": None}
    ok, n, q = pdf_text_probe(dest)
    upd = {"text_extractable": ok, "text_chars": n, "text_quality": q}
    if it["kind"] in ("answer", "scoring") and q == "ok":
        upd["subjects_detected"] = detect_subjects(dest)
    return upd


def fetch_one(it, force=False, reprobe=False):
    """下載單一項目。只讀取 it，回傳 (status, updates)，由主執行緒套用 updates，
    以免背景執行緒修改 dict 時主執行緒正在序列化 manifest。"""
    dest = os.path.join(PROJECT_ROOT, it["local_path"])
    if not force and os.path.exists(dest) and it.get("sha256"):
        if sha256_file(dest) == it["sha256"]:
            upd = {}
            if reprobe or (it["format"] == "pdf" and it.get("text_quality") is None):
                upd = _probe_updates(it, dest)
            return "skip", upd
    n, digest = http_get(it["url"], dest)
    upd = {"bytes": n, "sha256": digest, "error": None}
    if not check_magic(dest, it["format"]):
        upd["error"] = f"檔頭與副檔名 {it['format']} 不符（可能是錯誤頁）"
    upd.update(_probe_updates(it, dest))
    return "downloaded", upd


def _apply(it, upd):
    for k, v in upd.items():
        if k == "error" and v is None:
            it.pop("error", None)
        else:
            it[k] = v


def mark_duplicates(items):
    """內容完全相同（sha256 相同）的項目，後出現者標上 duplicate_of。"""
    first = {}
    for it in items:
        it.pop("duplicate_of", None)
        h = it.get("sha256")
        if not h:
            continue
        if h in first:
            it["duplicate_of"] = first[h]["local_path"]
        else:
            first[h] = it


def _select(items, args):
    out = []
    for it in items:
        if args.exam and it["exam"] not in args.exam:
            continue
        if args.kind and it["kind"] not in args.kind:
            continue
        if args.year and it["year"] not in args.year:
            continue
        if args.skip_essays and it.get("subkind") == "essay_sample":
            continue
        out.append(it)
    return out[: args.limit] if args.limit else out


def cmd_fetch(args):
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)
    items = _select(manifest["items"], args)
    log(f"[fetch] {len(items)} items")
    lock = threading.Lock()
    counts = Counter()
    done = 0

    def work(it):
        try:
            status, upd = fetch_one(it, force=args.force, reprobe=args.reprobe)
        except FetchError as e:
            status, upd = "failed", {"error": str(e)}
        if status == "downloaded":
            time.sleep(args.delay)
        return it, status, upd

    with cf.ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = [ex.submit(work, it) for it in items]
        for fut in cf.as_completed(futs):
            it, status, upd = fut.result()
            with lock:
                _apply(it, upd)
                counts[status] += 1
                done += 1
                log(f"[{done}/{len(items)}] {status:10s} {it['local_path']}"
                    + (f"  ERROR {it.get('error')}" if status == "failed" else ""))
                if done % 25 == 0:
                    write_manifest(args.manifest, manifest)
    sort_items(manifest["items"])
    mark_duplicates(manifest["items"])
    # 表頭（欄位說明等）與目前程式版本同步
    header = build_manifest([])
    header.pop("items")
    manifest = {**header, "items": manifest["items"]}
    write_manifest(args.manifest, manifest)
    log(f"[fetch] done: {dict(counts)}")
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
        elif it.get("sha256") and sha256_file(p) != it["sha256"]:
            print(f"MISMATCH {it['local_path']}")
            bad += 1
    print(f"verify: {bad} problem(s)")
    return 1 if bad else 0


def cmd_summary(args):
    with open(args.manifest, encoding="utf-8") as f:
        items = json.load(f)["items"]
    total = sum(it.get("bytes") or 0 for it in items)
    print(f"items={len(items)} bytes={total} ({total / 1048576:.1f} MiB)")
    by = Counter((it["exam"], it["kind"]) for it in items)
    for k in sorted(by, key=lambda k: (EXAM_ORDER[k[0]], KIND_ORDER[k[1]])):
        print(f"  {k[0]:9s} {k[1]:8s} {by[k]}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="fetch",
                    choices=["discover", "fetch", "verify", "summary"])
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST)
    ap.add_argument("--exam", action="append", choices=["gsat", "ast", "reference"])
    ap.add_argument("--kind", action="append", choices=list(KIND_ORDER))
    ap.add_argument("--year", action="append", type=int)
    ap.add_argument("--skip-essays", action="store_true", help="不下載作文佳作原卷")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--delay", type=float, default=0.5, help="每次下載後的禮貌延遲（秒）")
    ap.add_argument("--force", action="store_true", help="即使 sha256 相符也重新下載")
    ap.add_argument("--reprobe", action="store_true",
                    help="已下載的 PDF 也重新以 pdftotext 判斷文字層品質")
    args = ap.parse_args(argv)
    return {"discover": cmd_discover, "fetch": cmd_fetch, "verify": cmd_verify,
            "summary": cmd_summary}[args.command](args) or 0


if __name__ == "__main__":
    sys.exit(main())
