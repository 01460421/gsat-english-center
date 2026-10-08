#!/usr/bin/env python3
"""單字資料管線：把大考中心詞彙表和開放授權辭典資料合併成 App 用的單字庫。

輸入
  data/vocab/ceec-wordlist.json             大考中心《高中英文參考詞彙表（111 學年度起適用）》6,012 筆
                                            （由 tools/parse_wordlist.py 產生）
  data/raw/vocab-sources/                   下列來源的原始下載檔（不進 git，`fetch` 子命令重新下載）
    ecdict/ecdict.csv                       ECDICT（MIT）：音標、中文釋義、詞形變化、詞頻
    oewn/english-wordnet-2025-json.zip      Open English WordNet 2025（CC BY 4.0）：義項、同義、反義、上位、衍生
    tatoeba/*.tsv.bz2                       Tatoeba 英文句、中文句、英中連結、CC0 清單（CC BY 2.0 FR／CC0）
    cefrj/CEFRJ_wordlist_ver1.6.zip         CEFR-J Wordlist 1.6（A1–B2，需依指定格式致謝）
    cefrj/octanove-…-c1c2-1.0.csv           Octanove Vocabulary Profile C1/C2（CC BY-SA 4.0）
  data/vocab/sources.json                   每個原始檔的網址、版本、下載日期、sha256（`fetch` 寫入；`build` 核對）

輸出（全部由本腳本產生，重跑結果逐位元相同）
  data/vocab/lexicon.json                   每筆詞彙表條目一筆（超過 25 MB 時改為 lexicon-L1.json … lexicon-L6.json）
  data/vocab/forms-index.json               詞形 → entry_id（原形、拼法變體、括號衍生、代名詞格、屈折形）
  data/vocab/CREDITS.md                     各來源授權與標示文字
  data/vocab/lexicon-report.md              各欄位覆蓋率（依級別）、與 04 文件 §2.3 的比較、特殊條目處理

用法
  python3 tools/build_vocab.py fetch        # 下載全部來源並更新 sources.json（網路失敗會以指數退避重試）
  python3 tools/build_vocab.py build        # 由本地原始檔產生輸出（預設子命令）
  python3 tools/build_vocab.py check        # 在暫存目錄重建一次，和現有輸出逐位元比對（不同則結束碼 1，可放 CI）
  選項：--no-verify  不核對原始檔 sha256（例如剛換了新版 Tatoeba 匯出檔、還沒重跑 fetch 時）

依賴
  Python 3.10+ 標準庫
  OpenCC：`pip install opencc`（官方綁定，優先）或 `pip install opencc-python-reimplemented`，
          用 s2twp（簡體→繁體台灣用語）轉換 ECDICT 與 Tatoeba 中文。兩者的詞庫版本不同，轉換結果可能有細微差異，
          報告會記錄實際使用的套件與版本；要逐位元重現，請使用同一個套件版本。
  （CEFR-J 1.6 的 .xlsx 用標準庫 zipfile + xml 直接讀，不需要 openpyxl）

特殊條目的處理（對應 docs/research/03-vocab-list.md §3.2、§6.3、§6.4、§9.2）
  * 主鍵：entry_id = "{word}|{詞類以 / 連接}|{level}"，例如 "abandon|v.|4"、"content|v./(n.)|4"。
    依 03 文件 §9.2 的建議由條目內容組成，不用流水號，所以詞彙表重新解析或排序改變時 ID 不變；
    word 不唯一（§6.3 有 9 個字各兩筆），加上詞類與級別後 6,012 筆唯一（腳本會 assert）。
    calm 的原表詞類少一個句點，用的是 parse_wordlist.py 已修正的 pos 陣列（"calm|v./adj./n.|2"）。
  * 同字多筆（§6.3：backward、capital、content、downward、forward、measure、medium、outward、upward）：
    - WordNet 義項只取「條目詞類」對應的詞性（adj.→a/s、adv.→r、n.→n、v.→v），兩筆因此各自得到不同義項；
    - ECDICT 中文逐行標 match（該行詞性是否屬於條目詞類），介面可只顯示 match=true 的行；
    - Tatoeba 例句：兩筆的候選句相同時，後一筆優先避開前一筆已選的句子；(s)、(ism) 這類條目優先挑含
      該衍生形（measures、capitalism）的句子；
    - forms-index 同一詞形列出兩個 entry_id；兩筆的 cambridge_url 相同（Cambridge 不分詞類）。
  * 斜線條目（a/b，78 筆）：word 取斜線前的形式，其餘在 variants；ECDICT／OEWN／CEFR 查不到 word 時依序改查
    variants；所有 variants 及其屈折形都進 forms-index（type=slash）。原表的斜線不區分拼法變體、非正式、
    性別對應、同義並列（原則 15–17），所以不自動細分。
    am/a.m.、pm/p.m. 依原則取 am、pm 當 word，但查 ECDICT／OEWN 時改用 a.m.、p.m.（LOOKUP_OVERRIDES），
    例句只比對 a.m.／p.m.（避免把 be 動詞 am 當成例句）。
  * 括號條目：(ment) 與 argue(argument) 的衍生名詞（type=derived_ment）、capital(ism)（derived_suffix）、
    (s) 常用複數（plural_usual）、代名詞格變化（pronoun_case）都在 variants；另在 variant_info 給每個變體的
    ECDICT 音標與中文，因為 v./(n.) 的 (n.) 指的就是這個衍生名詞。代名詞格（mine、her…）在 forms-index 會和
    同形的其他條目（mine n./v.）並列，不建立詞族關係。
  * 片語條目：111 年版詞彙表沒有多字詞條（03 文件 §2.3，唯一帶連字號的是 T-shirt）。程式仍支援含空白的詞形：
    Cambridge slug 把空白換成連字號（04 文件 §2.2），Tatoeba 比對改成連續 token 序列比對。
  * 縮寫、撇號、重音：Mr.、Mrs.、Ms.、O.K.、a.m. 的句點保留在 forms-index 鍵中（tokenizer 會把 "Mr." 視為一個 token）；
    彎引號 ’ 一律轉成 '，重音字母去掉（café→cafe），全部轉小寫，這是 forms-index 的正規化鍵。
  * 大寫條目（I、Internet、Celsius、Fahrenheit、T-shirt、Coke、TV）：先精確比對，查不到再比對小寫。

其他規則
  * IPA：ECDICT 的音標用 Cyrillic ә（U+04D9）、є（U+0454）和 ASCII 符號表示 IPA，這裡統一字元：
    ә→ə、є→ɛ、'→ˈ（主重音）、緊接音標的 , 與 . →ˌ（次重音）、:→ː；". "、", "、兩段都有主重音的 "." 視為
    「多種讀法」的分隔，統一輸出為 ", "。含有無法判讀字元（\\、^ 等 ECDICT 編碼損壞）的音標不採用，
    改用 OEWN 的發音（ipa_source 標 oewn）。只統一字元，不改音標體系（ECDICT 是舊式英式標音，例如 gou）。
  * 中文：ECDICT translation 依原本的換行分行，每行拆出詞性標記（vt.、n.…）或領域標記（[計]、[醫]…），
    文字用 OpenCC s2twp 轉成台灣繁體用語。標點維持原樣。
  * en_def：優先取 OEWN 第一個（依條目詞類順序）義項的定義；沒有時退回 ECDICT 英文釋義中詞性相符的第一行。
  * 詞族（family）：以 union-find 合併 (1) 同字多筆、(2) 括號衍生形或拼法相近的斜線變體等於另一筆的詞形、
    (3) OEWN derivation／pertainym 關係（兩端都在詞彙表，且有共同字首，避免 die→death 這類跨字根連結）。
    family_id 取詞族中最短（同長取級別低、再依字母）的條目 entry_id。
  * 例句：Tatoeba 中有中文翻譯的英文句，句長 6–20 個 token，含該條目任一詞形（原形、變體、屈折形）。
    排序：(1) 句中其他字都在詞彙表且級別 ≤ 該條目級別+1（人名、數字、附錄詞不扣分；附錄詞＝詞彙表 p.104
    的數字、星期、月份、季節，視為第 1 級）；(2) 超出級別的字越少越前面；(3) 句長越接近 10 越前面；(4) 句子 ID。
    去重：句型骨架（人名→NAME、數字→NUM）相同者只留一句；第一輪再避開和已選句 token 集合 Jaccard≥0.6
    或目標詞前後文相同的句子，不足 5 句時第二輪補回。作者為空（孤兒句）且不是 CC0 的句子不採用，
    因為 CC BY 需要標示作者。中文翻譯有多句時取有作者、ID 最小的一句。
  * 決定性：所有集合在輸出前排序；不輸出建置時間；JSON 一筆一行、鍵順序固定。
"""
from __future__ import annotations

import argparse
import bz2
import collections
import csv
import datetime as dt
import hashlib
import http.client
import io
import json
import os
import random
import re
import shutil
import ssl
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/vocab-sources"
VOCAB = ROOT / "data/vocab"
WORDLIST = VOCAB / "ceec-wordlist.json"
SOURCES_JSON = VOCAB / "sources.json"
SPLIT_LIMIT = 25 * 1024 * 1024          # lexicon.json 超過 25 MB 改依級別拆檔
FAMILY_MAX_SENSE_RANK = int(os.environ.get("VOCAB_FAMILY_RANK", "3"))
USER_AGENT = "gsat-english-center-vocab-pipeline/1.0 (educational project; python-urllib)"

# ---------------------------------------------------------------------------
# 來源清單（fetch 用）
# ---------------------------------------------------------------------------
ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"   # skywind3000/ECDICT master，2026-10-07 git ls-remote
OEWN_TAG_COMMIT = "dc343f2683279ecbb13fab4e2fd778d7b162d287"  # globalwordnet/english-wordnet tag 2025-edition
OLP_COMMIT = "d4e45b75b38f27b30dfc5c44d8c571aec7e7092f"       # openlanguageprofiles/olp-en-cefrj HEAD
TATOEBA = "https://downloads.tatoeba.org/exports/per_language"

SOURCES = [
    dict(id="ecdict", group="ecdict", file="ecdict/ecdict.csv",
         url=f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_COMMIT}/ecdict.csv",
         version=f"git {ECDICT_COMMIT}", license="MIT",
         license_url="https://github.com/skywind3000/ECDICT/blob/master/LICENSE"),
    dict(id="ecdict-license", group="ecdict", file="ecdict/LICENSE",
         url=f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_COMMIT}/LICENSE",
         version=f"git {ECDICT_COMMIT}", license="MIT", license_url=None),
    dict(id="oewn", group="oewn", file="oewn/english-wordnet-2025-json.zip",
         url="https://en-word.net/static/english-wordnet-2025-json.zip",
         version=f"Open English WordNet 2025 Edition (released 2025-12-31; git tag 2025-edition = {OEWN_TAG_COMMIT})",
         license="CC-BY-4.0", license_url="https://creativecommons.org/licenses/by/4.0/"),
    dict(id="oewn-license", group="oewn", file="oewn/LICENSE.md",
         url="https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/LICENSE.md",
         version="git tag 2025-edition", license="CC-BY-4.0", license_url=None),
    dict(id="oewn-wndb-license", group="oewn", file="oewn/WNDB_License.txt",
         url="https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/WNDB_License.txt",
         version="git tag 2025-edition", license="WordNet License (Princeton)", license_url=None),
    dict(id="tatoeba-eng", group="tatoeba", file="tatoeba/eng_sentences_detailed.tsv.bz2",
         url=f"{TATOEBA}/eng/eng_sentences_detailed.tsv.bz2",
         version="Tatoeba weekly export (see http_last_modified)", license="CC-BY-2.0-FR",
         license_url="https://creativecommons.org/licenses/by/2.0/fr/"),
    dict(id="tatoeba-cmn", group="tatoeba", file="tatoeba/cmn_sentences_detailed.tsv.bz2",
         url=f"{TATOEBA}/cmn/cmn_sentences_detailed.tsv.bz2",
         version="Tatoeba weekly export (see http_last_modified)", license="CC-BY-2.0-FR",
         license_url="https://creativecommons.org/licenses/by/2.0/fr/"),
    dict(id="tatoeba-links", group="tatoeba", file="tatoeba/eng-cmn_links.tsv.bz2",
         url=f"{TATOEBA}/eng/eng-cmn_links.tsv.bz2",
         version="Tatoeba weekly export (see http_last_modified)", license="CC-BY-2.0-FR",
         license_url="https://creativecommons.org/licenses/by/2.0/fr/"),
    dict(id="tatoeba-eng-cc0", group="tatoeba", file="tatoeba/eng_sentences_CC0.tsv.bz2",
         url=f"{TATOEBA}/eng/eng_sentences_CC0.tsv.bz2",
         version="Tatoeba weekly export (see http_last_modified)", license="CC0-1.0",
         license_url="https://creativecommons.org/publicdomain/zero/1.0/"),
    dict(id="tatoeba-cmn-cc0", group="tatoeba", file="tatoeba/cmn_sentences_CC0.tsv.bz2",
         url=f"{TATOEBA}/cmn/cmn_sentences_CC0.tsv.bz2",
         version="Tatoeba weekly export (see http_last_modified)", license="CC0-1.0",
         license_url="https://creativecommons.org/publicdomain/zero/1.0/"),
    dict(id="cefrj", group="cefrj", file="cefrj/CEFRJ_wordlist_ver1.6.zip",
         url="https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip",
         version="CEFR-J Wordlist Version 1.6 (xlsx dated 2020-03-24)",
         license="CEFR-J terms: free for research and commercial use with proper acknowledgement",
         license_url="https://www.cefr-j.org/download.html"),
    dict(id="olp-cefrj", group="cefrj", file="cefrj/cefrj-vocabulary-profile-1.5.csv",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/cefrj-vocabulary-profile-1.5.csv",
         version=f"CEFR-J Wordlist 1.5 CSV (olp-en-cefrj git {OLP_COMMIT}); reference only, build uses 1.6",
         license="CEFR-J terms: free for research and commercial use with proper acknowledgement",
         license_url="https://github.com/openlanguageprofiles/olp-en-cefrj"),
    dict(id="octanove", group="cefrj", file="cefrj/octanove-vocabulary-profile-c1c2-1.0.csv",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/octanove-vocabulary-profile-c1c2-1.0.csv",
         version=f"Octanove Vocabulary Profile C1/C2 ver 1.0 (olp-en-cefrj git {OLP_COMMIT})",
         license="CC-BY-SA-4.0", license_url="https://creativecommons.org/licenses/by-sa/4.0/"),
    dict(id="olp-readme", group="cefrj", file="cefrj/olp-README.md",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/README.md",
         version=f"olp-en-cefrj git {OLP_COMMIT}", license="(terms of use text)", license_url=None),
]
SOURCE_BY_ID = {s["id"]: s for s in SOURCES}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# fetch
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
    # Python 3.13 預設開啟 VERIFY_X509_STRICT，部分代理 CA 會因缺少擴充欄位被拒；只關掉嚴格模式，
    # 憑證鏈與主機名稱驗證照常進行。
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def http_get(url: str, dest: Path, *, retries: int = 6, base_delay: float = 2.0,
             timeout: float = 180.0) -> dict:
    """下載到 dest（先寫暫存檔再原子替換）。連線中斷、逾時、5xx 以指數退避重試。"""
    handlers = [urllib.request.HTTPSHandler(context=_ssl_context())]
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        handlers.append(urllib.request.ProxyHandler({"https": proxy}))
    opener = urllib.request.build_opener(*handlers)
    last = None
    for attempt in range(retries + 1):
        if attempt:
            delay = base_delay * 2 ** (attempt - 1) + random.uniform(0, 1.5)
            log(f"  retry {attempt}/{retries} in {delay:.1f}s ({last})")
            time.sleep(delay)
        tmp = None
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with opener.open(req, timeout=timeout) as resp:
                exp = resp.headers.get("Content-Length")
                exp = int(exp) if exp and exp.isdigit() else None
                dest.parent.mkdir(parents=True, exist_ok=True)
                h, n = hashlib.sha256(), 0
                fd, tmp = tempfile.mkstemp(prefix=".part-", dir=dest.parent)
                with os.fdopen(fd, "wb") as f:
                    while chunk := resp.read(1 << 16):
                        f.write(chunk)
                        h.update(chunk)
                        n += len(chunk)
                if exp is not None and n != exp:
                    raise OSError(f"short read {n}/{exp}")
                if n == 0:
                    raise OSError("empty body")
                os.chmod(tmp, 0o644)
                os.replace(tmp, dest)
                tmp = None
                return {"bytes": n, "sha256": h.hexdigest(),
                        "http_last_modified": resp.headers.get("Last-Modified"),
                        "http_etag": resp.headers.get("ETag")}
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code in (403, 404, 407, 410):      # 重試也不會改變
                raise
        except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError) as e:
            last = f"{type(e).__name__}: {e}"
        finally:
            if tmp and os.path.exists(tmp):
                os.unlink(tmp)
    raise RuntimeError(f"giving up on {url}: {last}")


def cmd_fetch(args) -> int:
    today = dt.date.today().isoformat()
    out = []
    for s in SOURCES:
        dest = RAW / s["file"]
        log(f"GET {s['url']}")
        meta = http_get(s["url"], dest)
        rec = {k: s[k] for k in ("id", "group", "file", "url", "version", "license", "license_url")}
        rec["file"] = f"data/raw/vocab-sources/{s['file']}"
        rec.update(retrieved_at=today, **meta)
        out.append(rec)
        log(f"  -> {rec['file']} {meta['bytes']:,} bytes sha256={meta['sha256'][:12]}…")
    doc = {
        "description": "單字資料管線（tools/build_vocab.py）使用的原始資料。原始檔放在 data/raw/vocab-sources/（不進 git），"
                       "用 `python3 tools/build_vocab.py fetch` 重新下載；`build` 會核對 sha256。",
        "sources": out,
    }
    SOURCES_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log(f"wrote {SOURCES_JSON.relative_to(ROOT)}")
    return 0


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def verify_sources() -> list[dict]:
    doc = json.loads(SOURCES_JSON.read_text(encoding="utf-8"))
    bad = []
    for rec in doc["sources"]:
        p = ROOT / rec["file"]
        if not p.exists():
            bad.append(f"missing {rec['file']}")
        elif sha256_file(p) != rec["sha256"]:
            bad.append(f"sha256 mismatch {rec['file']}")
    if bad:
        raise SystemExit("source check failed (run `fetch`, or pass --no-verify):\n  " + "\n  ".join(bad))
    return doc["sources"]


# ---------------------------------------------------------------------------
# 共用：正規化、OpenCC
# ---------------------------------------------------------------------------
def fold(s: str) -> str:
    """forms-index 的正規化鍵：彎引號→'、去重音、小寫。保留句點與連字號。"""
    s = s.replace("’", "'").replace("‘", "'")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower()


class Converter:
    """OpenCC s2twp（簡→繁台灣用語）。優先用官方 opencc 綁定，否則用 opencc-python-reimplemented。"""

    def __init__(self):
        import importlib.metadata as md
        import opencc  # noqa: 兩個套件的模組名稱都是 opencc
        self.cc = None
        for cfg in ("s2twp.json", "s2twp"):
            try:
                self.cc = opencc.OpenCC(cfg)
                self.cc.convert("测试")
                break
            except Exception:
                self.cc = None
        if self.cc is None:
            raise SystemExit("OpenCC s2twp unavailable")
        self.package = "?"
        for dist in ("opencc", "OpenCC", "opencc-python-reimplemented"):
            try:
                ver = md.version(dist)
            except md.PackageNotFoundError:
                continue
            files = [str(f) for f in (md.files(dist) or [])]
            if any(f.startswith("opencc/") for f in files):
                self.package = f"{dist} {ver}"
                break
        self.cache: dict[str, str] = {}

    def __call__(self, s: str) -> str:
        r = self.cache.get(s)
        if r is None:
            r = self.cc.convert(s)
            self.cache[s] = r
        return r


# ---------------------------------------------------------------------------
# 詞彙表
# ---------------------------------------------------------------------------
# 原表依規則取斜線前的形式當 word，但 am/pm 查辭典要用 a.m./p.m.，否則會查到 be 動詞 am（03 文件 §6.4）
LOOKUP_OVERRIDES = {"am|adv.|1": "a.m.", "pm|adv.|1": "p.m."}
# 例句只比對這些詞形（am、pm 本身太容易誤配）
EXAMPLE_FORM_OVERRIDES = {"am|adv.|1": ["a.m."], "pm|adv.|1": ["p.m."]}

PAREN_TYPES = {"paren-ment": "derived_ment", "paren-full-form": "derived_ment",
               "paren-suffix": "derived_suffix", "paren-plural": "plural_usual"}


def load_wordlist() -> list[dict]:
    wl = json.loads(WORDLIST.read_text(encoding="utf-8"))
    entries = []
    for e in wl:
        eid = f"{e['word']}|{'/'.join(e['pos'])}|{e['level']}"
        tags = e["tags"]
        # 變體來源：parse_wordlist.py 的 variants 順序是「括號展開 → 斜線 → 代名詞格」
        vtypes = []
        n_paren = 1 if any(t in PAREN_TYPES for t in tags) else 0
        for i, v in enumerate(e["variants"]):
            if "pronoun-forms" in tags:
                vtypes.append("pronoun_case")
            elif i < n_paren:
                vtypes.append(next(PAREN_TYPES[t] for t in tags if t in PAREN_TYPES))
            else:
                vtypes.append("slash")
        entries.append(dict(e, entry_id=eid, variant_types=vtypes))
    ids = [e["entry_id"] for e in entries]
    assert len(ids) == len(set(ids)), "entry_id not unique"
    return entries


# ---------------------------------------------------------------------------
# ECDICT
# ---------------------------------------------------------------------------
SUPPLEMENTARY_FORMS = {
    "be": [("am", "present"), ("are", "present"), ("is", "present"), ("was", "past"), ("were", "past")],
    "can": [("could", "past")], "will": [("would", "past")], "shall": [("should", "past")],
    "may": [("might", "past")],
}
EXCHANGE_TYPES = [("s", "plural"), ("p", "past"), ("d", "past_participle"), ("i", "present_participle"),
                  ("3", "third_person"), ("r", "comparative"), ("t", "superlative")]

IPA_MAP = {"\u04d9": "\u0259",   # Cyrillic schwa ә → IPA ə
           "\u0454": "\u025b",   # Cyrillic ie є → IPA ɛ
           "g": "\u0261",        # ASCII g → IPA ɡ（ECDICT 兩種混用：多數用 g，arrogant、diagram 等少數用 ɡ）
           ":": "\u02d0"}        # length mark
IPA_OK = set("abdefhijklmnoprstuvwxzæðŋɑɒɔəɚɛɜɝɪʃʊʌʒθɡɹɾʔːˈˌ()-, ̩̃")
IPA_BAD = set("\\^")


def ecdict_lookup_keys(form: str) -> list[str]:
    keys = [form, form.replace("’", "'")]
    a = unicodedata.normalize("NFKD", form.replace("’", "'"))
    keys.append("".join(c for c in a if not unicodedata.combining(c)))
    out = []
    for k in keys:
        if k not in out:
            out.append(k)
    return out


def load_ecdict(entries: list[dict]) -> dict[str, dict]:
    """只讀詞彙表需要的列。回傳 {精確詞頭: row}，查詢時再做大小寫退回。"""
    want_exact, want_lower = set(), set()
    for e in entries:
        forms = [e["word"], *e["variants"]]
        if e["entry_id"] in LOOKUP_OVERRIDES:
            forms.append(LOOKUP_OVERRIDES[e["entry_id"]])
        for f in forms:
            for k in ecdict_lookup_keys(f):
                want_exact.add(k)
                want_lower.add(k.lower())
    rows: dict[str, dict] = {}
    csv.field_size_limit(1 << 30)
    with open(RAW / "ecdict/ecdict.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            w = row["word"]
            if (w in want_exact or w.lower() in want_lower) and w not in rows:
                rows[w] = row
    return rows


class Ecdict:
    def __init__(self, rows: dict[str, dict]):
        self.rows = rows
        self.lower: dict[str, list[str]] = collections.defaultdict(list)
        for w in sorted(rows):
            self.lower[w.lower()].append(w)

    def get(self, form: str) -> dict | None:
        keys = ecdict_lookup_keys(form)
        for k in keys:
            if k in self.rows:
                return self.rows[k]
        for k in keys:
            c = self.lower.get(k.lower())
            if c:
                # 同小寫多筆時，偏好全小寫的那筆（例如 internet），再依字母
                c2 = sorted(c, key=lambda w: (w != w.lower(), w))
                return self.rows[c2[0]]
        return None


def normalize_ipa(raw: str) -> tuple[str | None, list[str]]:
    """ECDICT 音標 → IPA 字元。回傳 (ipa 或 None, 問題清單)。"""
    s = raw.strip()
    if not s:
        return None, []
    if any(c in IPA_BAD for c in s):
        return None, ["corrupt"]
    for a, b in IPA_MAP.items():
        s = s.replace(a, b)
    # 多種讀法的分隔：". "、", "
    parts = re.split(r"\.\s+|,\s+", s)
    out_parts = []
    for p in parts:
        # 沒有空白的 "."：兩邊都有主重音 ' 才是分隔（ә'bju:s.ә'bju:z），否則是次重音（.ækә'demik）
        segs = p.split(".")
        cur = segs[0]
        sub = []
        for seg in segs[1:]:
            if "'" in cur and "'" in seg:
                sub.append(cur)
                cur = seg
            else:
                cur = cur + "\u02cc" + seg
        sub.append(cur)
        for q in sub:
            q = q.replace(",", "\u02cc").replace("'", "\u02c8")
            out_parts.append(q)
    s = ", ".join(x for x in out_parts if x)
    issues = sorted({c for c in s if c not in IPA_OK})
    if issues:
        return None, ["unexpected:" + "".join(issues)]
    return s, []


ZH_LINE = re.compile(r"^(?:(?P<pos>[a-z]{1,6}\.)\s*|\[(?P<dom>[^\]]{1,8})\]\s*)?(?P<text>.*)$")
ECDICT_POS = {   # 詞彙表詞類 → ECDICT translation 行首詞性
    "n.": {"n.", "pl."}, "v.": {"v.", "vt.", "vi."}, "adj.": {"a.", "adj.", "s."},
    "adv.": {"ad.", "adv.", "r."}, "prep.": {"prep."}, "conj.": {"conj."}, "pron.": {"pron."},
    "art.": {"art."}, "aux.": {"aux.", "v.", "modal."},
}
ECDICT_DEF_POS = {"n.": {"n"}, "v.": {"v"}, "adj.": {"a", "s"}, "adv.": {"r"}}


def split_lines(field: str) -> list[str]:
    return [x.strip() for x in re.split(r"\\n|\n", field or "") if x.strip()]


def zh_lines(row: dict, entry_pos: list[str], conv: Converter) -> list[dict]:
    allowed = set()
    for p in entry_pos:
        allowed |= ECDICT_POS.get(p, set())
    out = []
    for line in split_lines(row.get("translation", "")):
        m = ZH_LINE.match(line)
        pos, dom, text = m.group("pos"), m.group("dom"), m.group("text").strip()
        if not text:
            continue
        rec = {}
        if dom:
            rec["domain"] = conv(dom)
            rec["text"] = conv(text)
            rec["match"] = False
        else:
            rec["pos"] = pos
            rec["text"] = conv(text)
            rec["match"] = (pos in allowed) if pos else True
        out.append(rec)
    return out


def ecdict_en_def(row: dict, entry_pos: list[str]) -> str | None:
    want = []
    for p in entry_pos:
        want += sorted(ECDICT_DEF_POS.get(p, set()))
    lines = split_lines(row.get("definition", ""))
    for w in want:
        for line in lines:
            m = re.match(r"^([a-z])\.?\s+(.*)$", line)
            if m and m.group(1) == w:
                return m.group(2).strip()
    return None


def parse_exchange(ex: str) -> dict[str, str]:
    out = {}
    for part in (ex or "").split("/"):
        if ":" in part:
            k, v = part.split(":", 1)
            out.setdefault(k, v.strip())
    forms = {}
    for code, name in EXCHANGE_TYPES:
        if out.get(code):
            forms[name] = out[code]
    return forms


def int_or_none(x: str) -> int | None:
    try:
        v = int(x)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


# ---------------------------------------------------------------------------
# OEWN
# ---------------------------------------------------------------------------
WN_POS = {"n.": ["n"], "v.": ["v"], "adj.": ["a"], "adv.": ["r"], "aux.": ["v"]}


def wn_base_pos(p: str) -> str:
    """OEWN 詞性鍵／synset partOfSpeech → n／v／a／r（n-1、n-2 這類同形異義鍵去掉編號；衛星形容詞 s 併入 a）。"""
    b = p.split("-")[0]
    return "a" if b == "s" else b


def entry_wn_pos(entry_pos: list[str]) -> list[str]:
    out = []
    for p in entry_pos:
        for q in WN_POS.get(p, []):
            if q not in out:
                out.append(q)
    return out


class Wordnet:
    def __init__(self, zpath: Path):
        z = zipfile.ZipFile(zpath)
        self.entries: dict[str, dict] = {}
        self.synsets: dict[str, dict] = {}
        for name in sorted(z.namelist()):
            if not name.endswith(".json") or name == "frames.json":
                continue
            data = json.loads(z.read(name))
            if name.startswith("entries-"):
                self.entries.update(data)
            else:
                self.synsets.update(data)
        self.sense_lemma: dict[str, str] = {}
        self.sense_pos: dict[str, str] = {}       # sense id → n／v／a／r（衛星形容詞 s 併入 a）
        self.sense_by_id: dict[str, dict] = {}
        self.sense_rank: dict[str, int] = {}
        self.lemma_synset_sense: dict[tuple[str, str], str] = {}
        self.lower: dict[str, list[str]] = collections.defaultdict(list)
        for lemma in sorted(self.entries):
            self.lower[lemma.lower()].append(lemma)
            for pkey, e in self.entries[lemma].items():
                rank = 1      # 義項在同一個詞性鍵（n、n-1、v…）中的順序；OEWN 大致依使用頻率排列
                for s in e.get("sense", []):
                    self.sense_lemma[s["id"]] = lemma
                    self.sense_pos[s["id"]] = wn_base_pos(pkey)
                    self.sense_by_id[s["id"]] = s
                    self.sense_rank[s["id"]] = rank
                    self.lemma_synset_sense[(lemma, s["synset"])] = s["id"]
                    rank += 1

    def find(self, form: str) -> str | None:
        for k in ecdict_lookup_keys(form):
            if k in self.entries:
                return k
        for k in ecdict_lookup_keys(form):
            c = self.lower.get(k.lower())
            if c:
                return sorted(c, key=lambda w: (w != w.lower(), w))[0]
        return None

    def senses(self, lemma: str, wn_pos: list[str]) -> list[dict]:
        """lemma 在 wn_pos 詞性（依條目詞類順序）的義項，保留 OEWN 的義項順序。
        entries 的詞性鍵有 n、v、a、r，少數 s（衛星形容詞）與 n-1、n-2（同形異義）；s 併入 a。"""
        ent = self.entries.get(lemma, {})
        out, seen = [], set()
        for p in wn_pos:
            for k in sorted(ent):
                base = k.split("-")[0]
                if (base == "s" and p == "a") or base == p:
                    for s in ent[k].get("sense", []):
                        if s["synset"] in self.synsets and s["id"] not in seen:
                            seen.add(s["id"])
                            out.append(s)
        return out

    def represents(self, sid: str, wpos: set[str]) -> bool:
        """義項 sid 能不能代表詞類為 wpos 的條目：詞性相符；或是同一個字的轉類（OEWN 有 derivation 把這個義項連到
        同一個 lemma、詞性相符的義項，例如 war v.「打仗」↔ war n.）。continent 的形容詞義項「自制的」和名詞「大陸」
        之間沒有這種連結，所以不能代表 continent n.。"""
        if self.sense_pos.get(sid) in wpos:
            return True
        lemma = self.sense_lemma.get(sid)
        return any(self.sense_lemma.get(t) == lemma and self.sense_pos.get(t) in wpos
                   for t in self.sense_by_id.get(sid, {}).get("derivation", []))

    def all_senses(self, lemma: str) -> list[dict]:
        ent = self.entries.get(lemma, {})
        return [s for k in sorted(ent) for s in ent[k].get("sense", []) if s["synset"] in self.synsets]

    def pronunciation(self, lemma: str) -> str | None:
        """OEWN 發音（優先 US）。OEWN 已是 IPA，只把 ASCII g 換成 ɡ，並用同一份字元白名單檢查。"""
        ent = self.entries.get(lemma, {})
        for k in sorted(ent):
            prons = ent[k].get("pronunciation") or []
            if prons:
                us = [p["value"] for p in prons if p.get("variety") == "US"]
                val = (us[0] if us else prons[0]["value"]).replace("g", "\u0261")
                return val if all(c in IPA_OK for c in val) else None
        return None


def example_text(x) -> str:
    return x.get("text", "") if isinstance(x, dict) else str(x)


# ---------------------------------------------------------------------------
# CEFR-J 1.6（xlsx）＋ Octanove C1/C2
# ---------------------------------------------------------------------------
CEFR_POS = {
    "n.": {"noun"}, "v.": {"verb", "vern", "be-verb", "do-verb", "have-verb"}, "adj.": {"adjective"},
    "adv.": {"adverb"}, "prep.": {"preposition"}, "conj.": {"conjunction"},
    "pron.": {"pronoun", "determiner"}, "art.": {"determiner"},
    "aux.": {"modal auxiliary", "be-verb", "do-verb", "have-verb"},
}
CEFR_ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}


def read_xlsx_sheet(xlsx_bytes: bytes, sheet_name: str) -> list[list[str]]:
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    z = zipfile.ZipFile(io.BytesIO(xlsx_bytes))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    target = None
    for sh in wb.find("m:sheets", ns):
        if sh.get("name") == sheet_name:
            target = rels[sh.get(f"{{{ns['r']}}}id")]
    if target is None:
        raise KeyError(sheet_name)
    target = target.lstrip("/")
    if not target.startswith("xl/"):
        target = "xl/" + target
    root = ET.fromstring(z.read(target))
    rows = []
    for row in root.find("m:sheetData", ns).findall("m:row", ns):
        vals = {}
        for c in row.findall("m:c", ns):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", ns)
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif v is not None:
                val = v.text or ""
            else:
                val = "".join(t.text or "" for t in c.iter(f"{{{ns['m']}}}t"))
            vals[col] = val
        rows.append([vals.get(k, "") for k in ("A", "B", "C")])
    return rows


def load_cefr() -> dict[str, list[tuple[str, str, str]]]:
    """回傳 {headword: [(pos, level, source)]}（headword 保留大小寫）。"""
    out: dict[str, list] = collections.defaultdict(list)
    with zipfile.ZipFile(RAW / "cefrj/CEFRJ_wordlist_ver1.6.zip") as z:
        name = next(n for n in sorted(z.namelist()) if n.endswith(".xlsx"))
        rows = read_xlsx_sheet(z.read(name), "ALL_sep")
    for hw, pos, lvl in rows[1:]:
        hw, pos, lvl = hw.strip(), pos.strip(), lvl.strip()
        if hw and lvl in CEFR_ORDER:
            out[hw].append((pos, lvl, "CEFR-J 1.6"))
    with open(RAW / "cefrj/octanove-vocabulary-profile-c1c2-1.0.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            hw, pos, lvl = row["headword"].strip(), (row["pos"] or "").strip(), (row["CEFR"] or "").strip()
            if hw and lvl in CEFR_ORDER:
                out[hw].append((pos, lvl, "Octanove C1/C2 1.0"))
    return out


def cefr_for(entry: dict, cefr: dict, cefr_lower: dict) -> dict | None:
    allowed = set()
    for p in entry["pos"]:
        allowed |= CEFR_POS.get(p, set())
    forms = [entry["word"], *entry["variants"]]
    if entry["entry_id"] in LOOKUP_OVERRIDES:
        forms.insert(0, LOOKUP_OVERRIDES[entry["entry_id"]])
    for f in forms:
        rows = cefr.get(f) or cefr.get(f.replace("’", "'"))
        if not rows:
            c = cefr_lower.get(fold(f))
            rows = [r for hw in c for r in cefr[hw]] if c else None
        if not rows:
            continue
        rows = sorted(set(rows), key=lambda r: (CEFR_ORDER[r[1]], r[0], r[2]))
        matched = [r for r in rows if r[0] in allowed]
        use = matched or rows
        by_pos = {}
        for pos, lvl, src in use:
            by_pos.setdefault(pos, lvl)
        best = use[0]
        # source：level 的來源；sources：by_pos 用到的全部來源（含 Octanove 時該部分為 CC BY-SA 4.0）
        return {"level": best[1], "by_pos": dict(sorted(by_pos.items())),
                "pos_matched": bool(matched), "headword": f, "source": best[2],
                "sources": sorted({r[2] for r in use})}
    return None


# ---------------------------------------------------------------------------
# Tatoeba
# ---------------------------------------------------------------------------
TOKEN_RE = re.compile(
    r"(?:Mr|Mrs|Ms|Dr|St)\.(?=\s|$)"              # 常見縮寫帶句點
    r"|(?:[A-Za-z]\.){2,}"                         # a.m.、p.m.、O.K.、U.S.
    r"|[A-Za-zÀ-ÿ]+(?:['’][A-Za-z]+)*(?:-[A-Za-zÀ-ÿ]+(?:['’][A-Za-z]+)*)*"
    r"|\d+(?:[.,:]\d+)*")
CLITICS = ("n't", "'s", "'re", "'m", "'ll", "'ve", "'d")
NEG_SPECIAL = {"can't": "can", "won't": "will", "shan't": "shall", "ain't": None}
# 詞彙表附錄（p.104）的數字、星期、月份、季節：沒有級別，選例句時視為第 1 級
APPENDIX = set("""
one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen
seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million
billion first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth
fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth fortieth fiftieth
sixtieth seventieth eightieth ninetieth hundredth thousandth millionth billionth monday tuesday wednesday
thursday friday saturday sunday january february march april may june july august september october
november december spring summer autumn fall winter
""".split())
NEUTRAL = -1      # 人名、數字、附屬詞素：不影響難度判斷


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def read_tsv_bz2(path: Path):
    with bz2.open(path, "rt", encoding="utf-8", newline="") as f:
        for line in f:
            yield line.rstrip("\n").split("\t")


def load_tatoeba(conv: Converter):
    links = collections.defaultdict(list)
    for row in read_tsv_bz2(RAW / "tatoeba/eng-cmn_links.tsv.bz2"):
        if len(row) >= 2 and row[0].isdigit() and row[1].isdigit():
            links[int(row[0])].append(int(row[1]))
    cmn_ids = {c for v in links.values() for c in v}
    cmn = {}
    for row in read_tsv_bz2(RAW / "tatoeba/cmn_sentences_detailed.tsv.bz2"):
        if len(row) >= 4 and row[0].isdigit() and int(row[0]) in cmn_ids:
            user = None if row[3] in ("\\N", "") else row[3]
            cmn[int(row[0])] = (row[2], user)
    eng = {}
    for row in read_tsv_bz2(RAW / "tatoeba/eng_sentences_detailed.tsv.bz2"):
        if len(row) >= 4 and row[0].isdigit() and int(row[0]) in links:
            user = None if row[3] in ("\\N", "") else row[3]
            eng[int(row[0])] = (row[2], user)
    cc0 = set()
    for fn in ("tatoeba/eng_sentences_CC0.tsv.bz2", "tatoeba/cmn_sentences_CC0.tsv.bz2"):
        for row in read_tsv_bz2(RAW / fn):
            if row and row[0].isdigit():
                cc0.add(int(row[0]))
    stats = {"eng_with_cmn_links": len(links), "eng_loaded": len(eng), "cmn_loaded": len(cmn), "cc0": len(cc0)}
    return links, eng, cmn, cc0, stats


def lic(sid: int, cc0: set) -> str:
    return "CC0-1.0" if sid in cc0 else "CC-BY-2.0-FR"


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
class UnionFind:
    def __init__(self, items):
        self.p = {x: x for x in items}

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if rb < ra:
                ra, rb = rb, ra
            self.p[rb] = ra


def common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def morph_related(a: str, b: str) -> bool:
    """兩個詞是否有共同字首（詞族連結的保守檢查）。"""
    a, b = fold(a), fold(b)
    short = min(len(a), len(b))
    lcp = common_prefix(a, b)
    return lcp >= 4 or (short <= 5 and lcp >= short - 2 and lcp >= 2)


def cambridge_url(word: str) -> str:
    """03 文件 §9.4：小寫、撇號→連字號、去重音、去句點；04 文件 §2.2：空白→連字號。"""
    s = word.replace("’", "'")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("'", "-").replace(".", "").replace(" ", "-")
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return "https://dictionary.cambridge.org/dictionary/english-chinese-traditional/" + urllib.parse.quote(s)


def build(outdir: Path, *, verify: bool = True) -> dict:
    t0 = time.time()
    sources = verify_sources() if verify else json.loads(SOURCES_JSON.read_text(encoding="utf-8"))["sources"]
    conv = Converter()
    entries = load_wordlist()
    by_id = {e["entry_id"]: e for e in entries}
    log(f"wordlist: {len(entries)} entries")

    # ---------------- ECDICT ----------------
    ec = Ecdict(load_ecdict(entries))
    log(f"ecdict: {len(ec.rows)} rows kept ({time.time() - t0:.0f}s)")
    wn = Wordnet(RAW / "oewn/english-wordnet-2025-json.zip")
    log(f"oewn: {len(wn.entries)} lemmas, {len(wn.synsets)} synsets ({time.time() - t0:.0f}s)")

    ipa_issues = collections.Counter()
    ipa_examples = collections.defaultdict(list)
    lex = {}
    form_map: dict[str, dict[str, dict]] = collections.defaultdict(dict)   # fold(form) → entry_id → {types, base}

    def add_form(form, eid, typ, base=None):
        k = fold(form)
        rec = form_map[k].setdefault(eid, {"types": [], "bases": []})
        if typ not in rec["types"]:
            rec["types"].append(typ)
        if base and base not in rec["bases"]:
            rec["bases"].append(base)

    for e in entries:
        eid = e["entry_id"]
        key_form = LOOKUP_OVERRIDES.get(eid, e["word"])
        row = ec.get(key_form)
        row_form = key_form
        if row is None:
            for v in e["variants"]:
                row = ec.get(v)
                if row is not None:
                    row_form = v
                    break
        rec = {"entry_id": eid, "word": e["word"], "level": e["level"], "pos": e["pos"],
               "variants": e["variants"], "raw": e["raw"], "tags": e["tags"]}
        # forms
        forms = parse_exchange(row["exchange"]) if row is not None else {}
        rec["forms"] = forms
        add_form(e["word"], eid, "lemma")
        for v, vt in zip(e["variants"], e["variant_types"]):
            add_form(v, eid, vt)
        if key_form != e["word"]:
            add_form(key_form, eid, "slash")
        for name, f in forms.items():
            add_form(f, eid, name, None if row_form == e["word"] else row_form)
        # IPA
        ipa, ipa_src, ipa_form = None, None, None
        cands = [(key_form, ec.get(key_form))] + [(v, ec.get(v)) for v in e["variants"]]
        for form, r in cands:
            if r is None or not r["phonetic"].strip():
                continue
            val, issues = normalize_ipa(r["phonetic"])
            for i in issues:
                ipa_issues[i] += 1
                ipa_examples[i].append(f"{r['word']} {r['phonetic']}")
            if val:
                ipa, ipa_src, ipa_form = val, "ecdict", form
                break
        if ipa is None:
            for form in [key_form, *e["variants"]]:
                lemma = wn.find(form)
                p = wn.pronunciation(lemma) if lemma else None
                if p:
                    ipa, ipa_src, ipa_form = p, "oewn", form
                    break
        rec["ipa"] = ipa
        rec["ipa_source"] = None if ipa is None else (
            {"source": ipa_src} if ipa_form == e["word"] else {"source": ipa_src, "form": ipa_form})
        # zh
        rec["zh"] = zh_lines(row, e["pos"], conv) if row is not None else []
        # variant_info：每個變體的音標與中文（v./(n.) 的 (n.) 就是衍生名詞）
        vinfo = []
        for v, vt in zip(e["variants"], e["variant_types"]):
            r = ec.get(v)
            vi = {"form": v, "type": vt, "ipa": None, "zh": []}
            if r is not None:
                vi["ipa"] = normalize_ipa(r["phonetic"])[0]
                vi["zh"] = [(f"{x['pos']} " if x.get("pos") else (f"[{x['domain']}] " if x.get("domain") else ""))
                            + x["text"] for x in zh_lines(r, [], conv)]
                for name, f in parse_exchange(r["exchange"]).items():
                    add_form(f, eid, name, v)
            vinfo.append(vi)
        rec["variant_info"] = vinfo
        rec["_row"] = row
        lex[eid] = rec

    # ECDICT exchange 沒有列的不規則形（be 的 am/are/were；情態動詞過去式依 04 文件 §5.4 歸到原形）
    for e in entries:
        for base, extra in SUPPLEMENTARY_FORMS.items():
            if e["word"] == base and not ({"aux.", "v."}.isdisjoint(e["pos"])):
                for f, typ in extra:
                    add_form(f, e["entry_id"], typ)

    # 詞形 → 級別（例句難度判斷用；含屈折形）
    level_of: dict[str, int] = {}
    for k, ids in form_map.items():
        level_of[k] = min(by_id[i]["level"] for i in ids)
    word_entries: dict[str, list[str]] = collections.defaultdict(list)   # 原形／變體（不含屈折）→ entry_ids
    for k, ids in form_map.items():
        for i, r in ids.items():
            if {"lemma", "slash", "derived_ment", "derived_suffix", "plural_usual"} & set(r["types"]):
                word_entries[k].append(i)

    def form_wn_pos(i: str, form: str) -> set[str]:
        """條目 i 的詞形 form 對應的 WordNet 詞性：括號衍生（-ment、-ism）與 (s) 複數是名詞（v./(n.) 的 (n.)），
        其餘沿用條目詞類。"""
        types = set(form_map.get(fold(form), {}).get(i, {}).get("types", []))
        if "lemma" not in types and types & {"derived_ment", "derived_suffix", "plural_usual"}:
            return {"n"}
        return set(entry_wn_pos(by_id[i]["pos"]))

    def vocab_ref(lemma: str, wpos: str | None = None) -> dict:
        """OEWN 的詞是否也在詞彙表（比對原形與原表變體，不比對屈折形）。wpos（n／v／a／r）有值時只留詞類相符的條目，
        都不相符才退回全部，例如形容詞 synset 裡的 present 指向 present adj./n./v.，而不是其他同形條目。"""
        ids = word_entries.get(fold(lemma), [])
        if wpos:
            ids = [i for i in ids if wpos in form_wn_pos(i, lemma)] or ids
        ids = sorted(ids, key=lambda i: (by_id[i]["level"], i))
        d = {"word": lemma.replace("_", " "), "in_list": bool(ids)}
        if ids:
            d["level"] = by_id[ids[0]]["level"]
            d["entry_ids"] = ids
        return d

    def linked_entries(src_lemma: str, senses: list[dict], rels: tuple, self_id: str, *,
                       attribute: bool = False, morph: bool = False,
                       max_rank: int | None = None) -> list[tuple[str, str, str]]:
        """沿 OEWN 義項關係 rels（以及 synset 的 attribute 關係）找也在詞彙表的條目，回傳 [(目標詞, 條目 id, 關係)]。
        只收「目標義項的詞性」和目標條目詞類相符的連結：OEWN 的 contain(v.) 有 derivation 連到 continent 的
        形容詞義項（自制的），不能因此把 continent n.（大陸）算成 contain 的衍生詞。morph=True 時另外要求兩個詞
        有共同字首（morph_related），排除 die→death 這類跨字根的連結。"""
        out, seen = [], set()
        for s in senses:
            targets = []
            for r in rels:
                for t in s.get(r, []):
                    if t in wn.sense_lemma:
                        targets.append((wn.sense_lemma[t], wn.sense_pos[t], t, r))
            if attribute:
                for T in wn.synsets[s["synset"]].get("attribute", []):
                    if T in wn.synsets:
                        tp = wn_base_pos(wn.synsets[T]["partOfSpeech"])
                        targets += [(m, tp, wn.lemma_synset_sense.get((m, T)), "attribute")
                                    for m in wn.synsets[T].get("members", [])]
            for tl, tp, tsid, r in targets:
                if max_rank and (wn.sense_rank.get(s["id"], 99) > max_rank
                                 or (tsid and wn.sense_rank.get(tsid, 99) > max_rank)):
                    continue
                if morph and not morph_related(src_lemma, tl):
                    continue
                for i in sorted(word_entries.get(fold(tl), [])):
                    ok = tp in form_wn_pos(i, tl) if tsid is None else wn.represents(tsid, form_wn_pos(i, tl))
                    if i != self_id and ok and (tl, i) not in seen:
                        seen.add((tl, i))
                        out.append((tl, i, r))
        return out

    # ---------------- WordNet ----------------
    oewn_any = {}
    family_sources: dict[str, list[tuple[str, list[dict]]]] = {}   # 詞族連結用：(OEWN lemma, 依詞類篩過的義項)
    for e in entries:
        eid = e["entry_id"]
        rec = lex[eid]
        wn_pos = entry_wn_pos(e["pos"])
        key_form = LOOKUP_OVERRIDES.get(eid, e["word"])
        lemma = None
        senses = []
        for form in [key_form, *e["variants"]]:
            lm = wn.find(form)
            if lm is None:
                continue
            if oewn_any.get(eid) is None:
                oewn_any[eid] = lm
            ss = wn.senses(lm, wn_pos) if wn_pos else []
            if ss:
                lemma, senses = lm, ss
                break
        # 詞族另外收「轉類」義項（war n. 的動詞義項 → warrior、project n. 的動詞義項 → projection）
        fam_lemma = lemma or oewn_any.get(eid)
        fam_senses = [x for x in wn.all_senses(fam_lemma) if wn.represents(x["id"], set(wn_pos))] if fam_lemma else []
        fam_src = [(fam_lemma, fam_senses)] if fam_senses else []
        # v./(n.) 的 -ment 名詞、capital(ism)、(s) 複數：用名詞義項找詞族（advertisement、capitalism…）
        for v, vt in zip(e["variants"], e["variant_types"]):
            if vt in ("derived_ment", "derived_suffix", "plural_usual"):
                lm = wn.find(v)
                ss = wn.senses(lm, ["n"]) if lm else []
                if ss and lm != fam_lemma:
                    fam_src.append((lm, ss))
        family_sources[eid] = fam_src
        en_def, en_src = None, None
        if senses:
            out_senses, antonyms, hyper = [], [], []
            for s in senses:
                syn = wn.synsets[s["synset"]]
                spos = wn_base_pos(syn.get("partOfSpeech", ""))
                members = [m for m in syn.get("members", []) if m != lemma]
                out_senses.append({
                    "synset_id": s["synset"],
                    "pos": syn.get("partOfSpeech"),
                    "definition": (syn.get("definition") or [""])[0],
                    "examples": [example_text(x) for x in syn.get("example", [])][:2],
                    "synonyms": [vocab_ref(m, spos) for m in members],
                })
                for a in s.get("antonym", []):
                    al = wn.sense_lemma.get(a)
                    if al and (al, wn.sense_pos[a]) not in antonyms:
                        antonyms.append((al, wn.sense_pos[a]))
                for h in syn.get("hypernym", []) + syn.get("instance_hypernym", []):
                    if h not in hyper:
                        hyper.append(h)
            # derivations：OEWN derivation／pertainym 的目標詞中也在詞彙表、且詞類相符的條目（不要求共同字首，
            # 所以 die→death 這類 OEWN 認定的衍生也會列出；詞族 family 才另外要求共同字首）
            der = {}
            for tl, i, _ in linked_entries(lemma, senses, ("derivation", "pertainym"), eid):
                der.setdefault(tl, []).append(i)
            der_refs = []
            for tl, ids in der.items():
                ids = sorted(set(ids), key=lambda i: (by_id[i]["level"], i))
                der_refs.append({"word": tl.replace("_", " "), "in_list": True, "level": by_id[ids[0]]["level"],
                                 "entry_ids": ids})
            seen_ant = set()
            ant_refs = []
            for al, ap in antonyms:
                if al not in seen_ant:
                    seen_ant.add(al)
                    ant_refs.append(vocab_ref(al, ap))
            rec["wordnet"] = {
                "lemma": lemma,
                "sense_count": len(senses),
                "senses": out_senses,
                "antonyms": ant_refs,
                "hypernyms": [{"synset_id": h, "words": wn.synsets[h].get("members", [])[:4],
                               "definition": (wn.synsets[h].get("definition") or [""])[0]}
                              for h in hyper[:3] if h in wn.synsets],
                "derivations": der_refs,
            }
            en_def, en_src = out_senses[0]["definition"], "oewn"
        else:
            rec["wordnet"] = None
        if en_def is None and rec["_row"] is not None:
            d = ecdict_en_def(rec["_row"], e["pos"])
            if d:
                en_def, en_src = d, "ecdict"
        rec["en_def"] = en_def
        rec["en_def_source"] = en_src
    log(f"wordnet done ({time.time() - t0:.0f}s)")

    # ---------------- 詞族 ----------------
    # union-find 合併：(1) 同字多筆（§6.3）；(2) 括號衍生形、或拼法相近的斜線變體等於另一筆的詞形；
    # (3) OEWN 義項的衍生類關係（derivation、pertainym、participle 與 agent／event／result… 等 morphosemantic 關係）
    #     以及 synset 的 attribute 關係（accurate↔accuracy），兩端詞類都要相符、而且要有共同字首。
    MORPH_RELS = ("derivation", "pertainym", "participle", "agent", "event", "result", "state", "undergoer",
                  "instrument", "by_means_of", "property", "location", "material", "vehicle", "body_part",
                  "destination", "uses")
    uf = UnionFind([e["entry_id"] for e in entries])
    fam_edges = collections.Counter()
    head_ids = collections.defaultdict(list)
    for e in entries:
        head_ids[fold(e["word"])].append(e["entry_id"])
    for ids in head_ids.values():
        for i in ids[1:]:
            uf.union(ids[0], i)
            fam_edges["same_headword"] += 1
    for e in entries:
        for v, vt in zip(e["variants"], e["variant_types"]):
            if vt == "pronoun_case":
                continue
            if vt == "slash" and not morph_related(e["word"], v):
                continue
            for other in head_ids.get(fold(v), []):
                if other != e["entry_id"] and uf.find(other) != uf.find(e["entry_id"]):
                    uf.union(e["entry_id"], other)
                    fam_edges["variant_is_headword"] += 1
    for e in entries:
        eid = e["entry_id"]
        for src_lemma, senses in family_sources[eid]:
            for tl, other, r in linked_entries(src_lemma, senses, MORPH_RELS, eid, attribute=True, morph=True,
                                               max_rank=FAMILY_MAX_SENSE_RANK):
                if uf.find(other) != uf.find(eid):
                    uf.union(eid, other)
                    fam_edges["oewn_attribute" if r == "attribute" else "oewn_derivation"] += 1
    groups = collections.defaultdict(list)
    for e in entries:
        groups[uf.find(e["entry_id"])].append(e["entry_id"])
    for members in groups.values():
        rep = sorted(members, key=lambda i: (len(by_id[i]["word"]), by_id[i]["level"], fold(by_id[i]["word"]), i))[0]
        for i in members:
            lex[i]["family_id"] = rep if len(members) > 1 else None
            lex[i]["family"] = [{"entry_id": j, "word": by_id[j]["word"], "level": by_id[j]["level"]}
                                for j in sorted(members, key=lambda j: (by_id[j]["level"], fold(by_id[j]["word"]), j))
                                if j != i]
    fam_sizes = collections.Counter(len(m) for m in groups.values())
    log(f"families: {sum(1 for m in groups.values() if len(m) > 1)} multi-member ({time.time() - t0:.0f}s)")

    # ---------------- CEFR ----------------
    cefr = load_cefr()
    cefr_lower = collections.defaultdict(list)
    for hw in sorted(cefr):
        cefr_lower[fold(hw)].append(hw)
    for e in entries:
        lex[e["entry_id"]]["cefr"] = cefr_for(e, cefr, cefr_lower)

    # ---------------- Tatoeba ----------------
    links, eng, cmn, cc0, tstats = load_tatoeba(conv)
    log(f"tatoeba: {tstats} ({time.time() - t0:.0f}s)")
    # 人名：句中（非句首）以大寫出現、而且小寫形從未出現在語料中的 token
    lower_seen, cap_mid = set(), set()
    sent_tokens = {}
    for sid in sorted(eng):
        toks = tokenize(eng[sid][0])
        sent_tokens[sid] = toks
        for i, t in enumerate(toks):
            if t[:1].islower():
                lower_seen.add(fold(t))
            elif i > 0 and t[:1].isupper():
                cap_mid.add(t)
    names = {t for t in cap_mid if fold(t) not in lower_seen and fold(t) not in level_of}

    def base_level(norm: str) -> int | None:
        if norm in level_of:
            return level_of[norm]
        if norm in APPENDIX:
            return 1
        # 規則屈折與 -ly（詞彙表原則 4：規則 -ly 副詞不另收），只用於難度判斷，不用於比對目標詞
        cands = []
        if norm.endswith("ly") and len(norm) > 4:
            st = norm[:-2]
            cands += [st, st[:-1] + "y" if st.endswith("i") else st, st + "le", st[:-2] if st.endswith("al") else st]
        for suf, reps in (("ies", ["y"]), ("es", ["", "e"]), ("s", [""]), ("ied", ["y"]), ("ed", ["", "e"]),
                          ("d", [""]), ("ing", ["", "e"]), ("er", ["", "e"]), ("est", ["", "e"])):
            if norm.endswith(suf) and len(norm) > len(suf) + 2:
                st = norm[: -len(suf)]
                for r in reps:
                    cands.append(st + r)
                if len(st) > 2 and st[-1] == st[-2]:
                    cands.append(st[:-1])
        lv = [level_of[c] for c in cands if c in level_of]
        return min(lv) if lv else None

    def token_level(tok: str) -> int | None:
        if tok[0].isdigit():
            return NEUTRAL
        if tok in names:
            return NEUTRAL
        n = fold(tok)
        lv = base_level(n)
        if lv is not None:
            return lv
        if "'" in n:
            if n in NEG_SPECIAL:
                b = NEG_SPECIAL[n]
                return NEUTRAL if b is None else base_level(b)
            for c in CLITICS:
                if n.endswith(c) and len(n) > len(c):
                    b = n[: -len(c)]
                    lv = base_level(b)
                    if lv is not None:
                        return lv
                    if tok[:1].isupper():
                        return NEUTRAL          # Tom's
                    return None
        if "-" in n:
            parts = [base_level(p) for p in n.split("-") if p]
            if parts and all(p is not None for p in parts):
                return max(parts)
        return None

    sent_info = {}      # sid → (norm tokens, levels)
    inv = collections.defaultdict(list)
    for sid in sorted(eng):
        toks = sent_tokens[sid]
        norms = [fold(t) for t in toks]
        levels = [token_level(t) for t in toks]
        sent_info[sid] = (norms, levels)
        for n in sorted(set(norms)):
            inv[n].append(sid)

    def pick_cmn(sid: int):
        opts = [c for c in links.get(sid, []) if c in cmn and cmn[c][0].strip()]
        if not opts:
            return None
        opts.sort(key=lambda c: (cmn[c][1] is None and c not in cc0, c))
        c = opts[0]
        if cmn[c][1] is None and c not in cc0:
            return None
        return c

    def skeleton(sid):
        toks = sent_tokens[sid]
        return tuple("NAME" if t in names else "NUM" if t[0].isdigit() else fold(t) for t in toks)

    # entry → 正規化詞形（例句比對用）；歧義詞形：這個條目的非 lemma 詞形同時是別筆的 lemma（medium/media 的 media），
    # 或是別筆的代名詞格（mine n./v. 的 mine）。只靠歧義詞形命中的句子排在後面。
    entry_forms: dict[str, list[str]] = collections.defaultdict(list)
    for k in sorted(form_map):
        for i in form_map[k]:
            entry_forms[i].append(k)
    lemma_of: dict[str, set] = collections.defaultdict(set)
    pron_of: dict[str, set] = collections.defaultdict(set)
    for k, ids in form_map.items():
        for i, r in ids.items():
            if "lemma" in r["types"]:
                lemma_of[k].add(i)
            if "pronoun_case" in r["types"]:
                pron_of[k].add(i)

    # 同形異詞（homograph）：條目的原形同時是另一個「級別不高於它」的條目的屈折形，例如 saw（鋸）＝see 的過去式、
    # found（建立）＝find 的過去式、lay＝lie 的過去式、rose＝rise 的過去式、learned（有學問的）＝learn 的過去式。
    # Tatoeba 裡這些詞形幾乎都是另一個字的用法，所以只靠這種詞形命中、而且前一個字不能判斷詞類的句子不採用：
    #   名詞：前一個字是限定詞或所有格（a saw、the rose、my thought、Tom's）
    #   形容詞：限定詞、連綴動詞、程度副詞或 I'm／it's 這類縮寫（is broke、a learned man、very promising）
    #   動詞原形：前一個字是 to 或助動詞（to found、will lay）
    # 例外（視為同一個字，不算衝突）：條目是介系詞或連接詞（including、regarding）；比較級／最高級本身就是
    # 形容詞或副詞條目（better、later、further）；對方只有名詞複數這種衝突（glasses、arms，只降低排序）；
    # 對方不是動詞卻被 ECDICT 列出動詞變化（engineer→engineering）。
    INFL_TYPES = {"plural", "past", "past_participle", "present_participle", "third_person", "comparative",
                  "superlative", "present"}
    BASE_TYPES = {"lemma", "slash", "derived_ment", "derived_suffix", "plural_usual"}
    infl_of: dict[str, list[tuple[str, set]]] = collections.defaultdict(list)
    for k in sorted(form_map):
        for i in sorted(form_map[k]):
            t = set(form_map[k][i]["types"])
            if t <= INFL_TYPES:
                infl_of[k].append((i, t))

    def homograph_conflict(k: str, eid: str) -> tuple[bool, bool]:
        """(是否有級別不高於本條目的其他條目把 k 當屈折形, 是否為需要上下文判斷的強衝突)"""
        e = by_id[eid]
        epos = set(e["pos"])
        base = bool(set(form_map[k][eid]["types"]) & BASE_TYPES)
        weak = strong = False
        for f, t in infl_of.get(k, []):
            if f == eid or by_id[f]["level"] > e["level"]:
                continue
            weak = True
            if not base or epos & {"prep.", "conj."} or "plural" in t:
                continue
            if t <= {"comparative", "superlative"} and epos & {"adj.", "adv."}:
                continue
            if t <= {"past", "past_participle", "present_participle", "third_person", "present"} \
                    and not ({"v.", "aux."} & set(by_id[f]["pos"])):
                continue
            strong = True
        return weak, strong

    # this／that／which／what／one 常當代名詞或關係詞（"this means"、"the sister that broke"、"no one saw"），不算限定詞；
    # already／just／never 與 I'd 後面常接完成式（"had already left"、"I'd found"），也不當作判斷依據。
    DETERMINERS = set("a an the these those my your his her its our their every each some any no another whose".split())
    S_CONTRACTIONS = set("it's that's he's she's what's there's here's who's where's let's how's when's why's".split())
    BE_FORMS = set("is are am was were be been being isn't aren't wasn't weren't".split())
    LINKERS = BE_FORMS | set("seem seems seemed look looks looked feel feels felt get gets got gotten become becomes "
                             "became".split())
    INTENSIFIERS = set("very so too really quite more most less least extremely pretty rather how as".split())
    VERB_CUES = set("to will would can could shall should may might must do does did don't doesn't didn't won't "
                    "can't cannot couldn't wouldn't shouldn't mustn't i'll you'll he'll she'll we'll they'll "
                    "please let's".split())
    # be＋這些詞形幾乎都是被動語態、而且意思和條目不同（be learned＝被學會、be left＝被留下），所以形容詞用法
    # 只接受限定詞或程度副詞（a learned man、very learned、on your left）。
    HOMOGRAPH_STRICT = {"learned|adj.|4", "left|adj./n./adv.|1"}

    def context_ok(norms: list[str], i: int, k: str, e: dict, types: list[str]) -> bool:
        prev = norms[i - 1] if i > 0 else ""
        poss = prev.endswith("'s") and prev not in S_CONTRACTIONS
        epos = set(e["pos"])
        if ("n." in epos or set(types) & {"derived_ment", "derived_suffix", "plural_usual"}) \
                and (prev in DETERMINERS or poss):
            return True
        if "adj." in epos:
            if prev in DETERMINERS or prev in INTENSIFIERS or poss:
                return True
            if e["entry_id"] not in HOMOGRAPH_STRICT and (prev in LINKERS or prev.endswith(("'m", "'re", "'s"))):
                return True
        if {"v.", "aux."} & epos and k == fold(e["word"]) and prev in VERB_CUES:
            return True
        return False

    homograph_stats = collections.Counter()
    homograph_examples: dict[str, int] = {}
    used_by_word = collections.defaultdict(set)   # 同字多筆：前一筆用過的句子
    for e in entries:
        eid = e["entry_id"]
        rec = lex[eid]
        lv = e["level"]
        hw = fold(e["word"])
        if eid in EXAMPLE_FORM_OVERRIDES:
            tforms = sorted(fold(f) for f in EXAMPLE_FORM_OVERRIDES[eid])
        else:
            tforms = entry_forms[eid]
        tset = set(tforms)
        ambiguous, strong = set(), set()
        for k in tforms:
            mine = form_map[k][eid]["types"]
            weak, st = homograph_conflict(k, eid)
            if (pron_of[k] - {eid}) or ("lemma" not in mine and (lemma_of[k] - {eid})) or weak:
                ambiguous.add(k)
            if st:
                strong.add(k)
        if strong:
            homograph_stats["entries"] += 1
        # 偏好詞形：(s) 常用複數、(ism) 衍生；同字多筆時，只屬於本條目的斜線變體（backwards 之於 backward adv.）
        siblings = [i for i in head_ids.get(hw, []) if i != eid]
        sib_forms = set()
        for i in siblings:
            sib_forms.update(entry_forms[i])
        prefer = set()
        for v, vt in zip(e["variants"], e["variant_types"]):
            if vt in ("plural_usual", "derived_suffix") or (siblings and vt == "slash" and fold(v) not in sib_forms):
                prefer.add(fold(v))
        single = [f for f in tforms if " " not in f]
        multi = [f.split() for f in tforms if " " in f]
        cand = set()
        for f in single:
            cand.update(inv.get(f, []))
        for seq in multi:
            for sid in inv.get(seq[0], []):
                norms = sent_info[sid][0]
                if any(norms[i:i + len(seq)] == seq for i in range(len(norms))):
                    cand.add(sid)
        usable = []
        for sid in sorted(cand):
            if eng[sid][1] is None and sid not in cc0:
                continue
            c = pick_cmn(sid)
            if c is not None:
                usable.append((sid, c))
        rec["_tatoeba_count"] = len(cand)
        rec["_tatoeba_usable"] = len(usable)
        scored = []
        for sid, c in usable:
            norms, levels = sent_info[sid]
            n = len(norms)
            if n < 6 or n > 20:
                continue
            unknown = 0
            pos_t = []
            for i, (nm, l) in enumerate(zip(norms, levels)):
                if nm in tset:
                    pos_t.append(i)
                    continue
                if l == NEUTRAL:
                    continue
                if l is None or l > lv + 1:
                    unknown += 1
            if not pos_t:
                continue
            hit = {norms[i] for i in pos_t}
            clean, strong_only = False, True
            for i in pos_t:
                k = norms[i]
                if k in strong:
                    if context_ok(norms, i, k, e, form_map[k][eid]["types"]):
                        clean = True
                    continue
                strong_only = False
                if k not in ambiguous:
                    clean = True
            if strong_only and not clean:
                homograph_stats["sentences_dropped"] += 1
                homograph_examples[eid] = homograph_examples.get(eid, 0) + 1
                continue
            only_ambiguous = not clean
            has_pref = bool(hit & prefer) if prefer else True
            reused = sid in used_by_word[hw]
            ctx = (norms[pos_t[0] - 1] if pos_t[0] > 0 else "^",
                   norms[pos_t[0] + 1] if pos_t[0] + 1 < n else "$")
            key = (reused, only_ambiguous, not has_pref, unknown > 0, unknown, abs(n - 10), sid)
            scored.append((key, sid, c, ctx, unknown))
        scored.sort()
        chosen, skipped, skels, zhs = [], [], set(), set()
        for key, sid, c, ctx, unknown in scored:
            sk = skeleton(sid)
            zh = conv(cmn[c][0])
            if sk in skels or zh in zhs:
                continue
            tokset = set(sent_info[sid][0]) - tset
            item = (key, sid, c, ctx, tokset, unknown)
            clash = False
            for ch in chosen:
                tok2 = ch[4]
                inter = len(tokset & tok2)
                union = len(tokset | tok2) or 1
                if inter / union >= 0.6 or ctx == ch[3]:
                    clash = True
                    break
            if clash:
                skipped.append(item)
                continue
            chosen.append(item)
            skels.add(sk)
            zhs.add(zh)
            if len(chosen) == 5:
                break
        if len(chosen) < 5:
            for item in skipped:
                sk = skeleton(item[1])
                zh = conv(cmn[item[2]][0])
                if sk in skels or zh in zhs:
                    continue
                chosen.append(item)
                skels.add(sk)
                zhs.add(zh)
                if len(chosen) == 5:
                    break
        chosen.sort(key=lambda x: x[0])
        exs = []
        for key, sid, c, ctx, _, unknown in chosen:
            zh_raw = cmn[c][0]
            zh = conv(zh_raw)
            exs.append({
                "tatoeba_id": sid,
                "en": eng[sid][0],
                "zh": zh,
                "author": eng[sid][1],
                "license": lic(sid, cc0),
                "url": f"https://tatoeba.org/en/sentences/show/{sid}",
                "zh_id": c,
                "zh_author": cmn[c][1],
                "zh_license": lic(c, cc0),
                "zh_converted": zh != zh_raw,
                "within_level": unknown == 0,
            })
            used_by_word[hw].add(sid)
        rec["examples"] = exs
    log(f"examples done ({time.time() - t0:.0f}s)")

    # ---------------- 組裝輸出 ----------------
    out_entries = []
    for e in entries:
        rec = lex[e["entry_id"]]
        row = rec.pop("_row")
        tcount = rec.pop("_tatoeba_count")
        tusable = rec.pop("_tatoeba_usable")
        o = {k: rec[k] for k in ("entry_id", "word", "level", "pos", "variants", "raw", "tags", "forms",
                                 "ipa", "ipa_source", "zh", "variant_info", "en_def", "en_def_source", "wordnet",
                                 "family_id", "family", "examples", "cefr")}
        o["freq"] = {"frq": int_or_none(row["frq"]) if row else None,
                     "bnc": int_or_none(row["bnc"]) if row else None}
        o["internal_core_flag"] = (row["oxford"].strip() == "1") if row else None
        o["internal_star"] = int_or_none(row["collins"]) if row else None
        o["cambridge_url"] = cambridge_url(e["word"])
        o["sources"] = {"ecdict": row is not None, "oewn": o["wordnet"] is not None,
                        "tatoeba_count": tcount, "tatoeba_usable": tusable, "cefr": o["cefr"] is not None}
        if not o["variant_info"]:
            del o["variant_info"]
        out_entries.append(o)

    outdir.mkdir(parents=True, exist_ok=True)
    files = {}
    body = "[\n" + ",\n".join(json.dumps(o, ensure_ascii=False, separators=(", ", ": ")) for o in out_entries) + "\n]\n"
    for old in sorted(outdir.glob("lexicon-L*.json")) + [outdir / "lexicon.json"]:
        if old.exists():
            old.unlink()
    if len(body.encode("utf-8")) <= SPLIT_LIMIT:
        (outdir / "lexicon.json").write_text(body, encoding="utf-8")
        files["lexicon.json"] = outdir / "lexicon.json"
    else:
        for lvl in range(1, 7):
            part = [o for o in out_entries if o["level"] == lvl]
            b = "[\n" + ",\n".join(json.dumps(o, ensure_ascii=False, separators=(", ", ": ")) for o in part) + "\n]\n"
            p = outdir / f"lexicon-L{lvl}.json"
            p.write_text(b, encoding="utf-8")
            files[p.name] = p

    # forms-index
    findex = {}
    for k in sorted(form_map):
        lst = []
        for i in sorted(form_map[k], key=lambda i: (by_id[i]["level"], i)):
            r = form_map[k][i]
            d = {"entry_id": i, "types": sorted(r["types"])}
            if r["bases"]:
                d["base"] = sorted(r["bases"])
            lst.append(d)
        findex[k] = lst
    meta = {
        "description": "詞形 → 詞彙表條目。鍵為正規化詞形（小寫、彎引號轉 '、去重音，保留句點與連字號）。"
                       "同形對應多筆時全部列出（依級別排序）。types：lemma＝條目主要詞形；slash／derived_ment／"
                       "derived_suffix／plural_usual／pronoun_case＝原表的變體；plural／past／past_participle／"
                       "present_participle／third_person／comparative／superlative＝ECDICT exchange 的屈折形"
                       "（base 表示是某個變體的屈折形）。",
        "entry_count": len(entries), "form_count": len(findex),
        "generated_by": "tools/build_vocab.py",
    }
    lines = ["{", f'"_meta": {json.dumps(meta, ensure_ascii=False)},', '"forms": {']
    items = [f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False, separators=(', ', ': '))}"
             for k, v in findex.items()]
    lines.append(",\n".join(items))
    lines.append("}\n}\n")
    (outdir / "forms-index.json").write_text("\n".join(lines), encoding="utf-8")
    files["forms-index.json"] = outdir / "forms-index.json"

    (outdir / "CREDITS.md").write_text(credits_md(sources, conv), encoding="utf-8")
    files["CREDITS.md"] = outdir / "CREDITS.md"

    report = report_md(out_entries, findex, sources, conv, tstats, ipa_issues, ipa_examples, fam_edges,
                       fam_sizes, files, set(oewn_any))
    (outdir / "lexicon-report.md").write_text(report, encoding="utf-8")
    files["lexicon-report.md"] = outdir / "lexicon-report.md"
    log(f"done in {time.time() - t0:.0f}s")
    return files


# ---------------------------------------------------------------------------
# CREDITS.md
# ---------------------------------------------------------------------------
def credits_md(sources: list[dict], conv: Converter) -> str:
    src = {s["id"]: s for s in sources}

    def dl(i):
        s = src[i]
        return f"{s['url']}（{s['version']}；{s['retrieved_at']} 下載；sha256 `{s['sha256'][:16]}…`）"

    ecdict_license = (RAW / "ecdict/LICENSE").read_text(encoding="utf-8").strip()
    # WNDB_License.txt 每行前面有行號（"  1 This software…"），去掉行號後照錄
    wndb = "\n".join(re.sub(r"^\s*\d+ ?", "", l).rstrip()
                     for l in (RAW / "oewn/WNDB_License.txt").read_text(encoding="utf-8").splitlines()).strip()
    cefr_date = dt.date.fromisoformat(src["cefrj"]["retrieved_at"])
    return f"""# 單字資料的來源與授權標示

> 本檔由 `tools/build_vocab.py` 產生，請勿手動修改。對應 `docs/research/04-data-sources-licensing.md` §2、§7.1、§7.3。
> `lexicon.json`（或 `lexicon-L1.json`…`lexicon-L6.json`）與 `forms-index.json` 混合了下列來源；每個欄位的來源見最後一節。
> 原始檔的網址、版本、下載日期與 sha256 記錄在 `data/vocab/sources.json`。

## App 內標示文字（照 04 文件 §7.1）

| 位置 | 標示文字 |
|---|---|
| 單字卡（詞、級別、詞類） | 詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》 |
| 音標、中文釋義、詞形變化 | 音標、中文釋義與詞形變化：ECDICT（MIT License），中文經 OpenCC 轉為台灣繁體 |
| 同義詞、反義詞、上位詞、英文釋義 | 同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet |
| 例句 | 每句旁小字顯示「Tatoeba #句子ID by 作者名」並連到 `url`；中文翻譯另外標「中文 Tatoeba #zh_id by zh_author」 |
| CEFR 參考等級 | 「約 CEFR B1」，並標示「CEFR 對照依 CEFR-J Wordlist」；C1／C2 來自 Octanove（CC BY-SA 4.0） |
| 外部辭典 | 按鈕「在 Cambridge 辭典查看」（只外連，新分頁開啟） |
| Credits 頁 | 列出本檔各節的完整聲明 |

不在介面顯示 Collins 星級或 Oxford 3000 標記（04 文件 §7.4）。`internal_core_flag`（ECDICT `oxford` 欄）與
`internal_star`（ECDICT `collins` 欄）只當內部重要度特徵。

## 1. 大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》

- 欄位：`word`、`level`、`pos`、`variants`、`raw`、`tags`，以及由這些組成的 `entry_id`。
- 來源：https://www.ceec.edu.tw/xmdoc?xsmsid=0K213553204833715309
- 授權：封面聲明「僅供非營利目的使用，轉載請註明出處。若作為營利目的使用，應事前經由財團法人大學入學考試中心基金會書面同意授權。」
  App 若有任何收費或廣告，須先取得大考中心書面授權（03 文件 §9.8、04 文件 §4.3）。`commercial_ok = false`。

## 2. ECDICT

- 欄位：`forms`、`ipa`（`ipa_source.source = "ecdict"`）、`zh`、`variant_info`、`en_def`（`en_def_source = "ecdict"`）、`freq`、`internal_core_flag`、`internal_star`。
- 來源：{dl("ecdict")}
- 授權：MIT License。修改：OpenCC s2twp 轉換中文、音標字元統一為 IPA（ә→ə、є→ɛ、'→ˈ、:→ː 等）、只取詞彙表需要的列與欄。
- 中文釋義依 04 文件 §2.1 的建議，上線前還要由 Claude 改成台灣用語並人工抽查。

```
{ecdict_license}
```

## 3. Open English WordNet 2025（衍生自 Princeton WordNet）

- 欄位：`wordnet`（義項、定義、例句、同義詞、反義詞、上位詞、衍生詞）、`en_def`（`en_def_source = "oewn"`）、`ipa`（`ipa_source.source = "oewn"`）、`family`（部分連結）。
- 來源：{dl("oewn")}
- 授權：CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。「You may share and adapt this resource providing attribution is given to both Princeton WordNet and the Open English Wordnet team.」
- 標示：Open English WordNet 2025, © 2019–present The Open English WordNet Team, CC BY 4.0（https://en-word.net/）；
  以及 Princeton WordNet（WordNet 3.1 Copyright 2011 by Princeton University）。
- 引用：John P. McCrae, Alexandre Rademaker, Francis Bond, Ewa Rudnicka and Christiane Fellbaum (2019). *English WordNet 2019 – An Open-Source WordNet for English*. Proceedings of the 10th Global WordNet Conference (GWC 2019).
- 修改：只取詞彙表條目相關的義項；同義詞加上「是否在大考詞彙表與級別」的標記；上位詞只取前 3 個。
- Princeton WordNet 授權聲明（依授權條件必須隨資料附上）：

```
{wndb}
```

## 4. Tatoeba

- 欄位：`examples`（每句的 `tatoeba_id`、`en`、`author`、`license`、`url`，以及中文翻譯的 `zh_id`、`zh`、`zh_author`、`zh_license`）。
- 來源：https://tatoeba.org/ 每週匯出檔（{src['tatoeba-eng']['http_last_modified']} 版；{src['tatoeba-eng']['retrieved_at']} 下載）：
  - {src['tatoeba-eng']['url']}
  - {src['tatoeba-cmn']['url']}
  - {src['tatoeba-links']['url']}
  - {src['tatoeba-eng-cc0']['url']}、{src['tatoeba-cmn-cc0']['url']}
- 授權：句子預設 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/），列在 CC0 匯出檔中的句子為 CC0 1.0。
  CC BY 句子使用時「必須標示作者」（Tatoeba Terms of Use §6.2），所以每句都保存作者名稱與句子 ID；作者為空（孤兒句）的 CC BY 句子不採用。
- 顯示格式：`Tatoeba #{{tatoeba_id}} by {{author}}`（連到 `url`），中文翻譯 `Tatoeba #{{zh_id}} by {{zh_author}}`。
- 修改：中文句用 OpenCC s2twp 轉成台灣繁體（`zh_converted = true` 表示文字有變動），應標示「中文經轉換為台灣繁體」。
- 不使用 Tatoeba 音檔（音檔授權依錄音者而定）。

## 5. CEFR-J Wordlist 與 Octanove Vocabulary Profile

- 欄位：`cefr`（`source` 標示來自 CEFR-J 1.6 或 Octanove C1/C2 1.0）。
- CEFR-J（A1–B2）來源：{dl("cefrj")}
  - 條件：可免費用於研究與商業用途，但必須依指定格式引用。本專案的引用（依官方英文格式）：
    The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on {cefr_date.strftime('%d/%m/%y')}.
  - 日文格式：『CEFR-J Wordlist Version 1.6』 東京外国語大学投野由紀夫研究室. （URL: https://www.cefr-j.org/download.html より {cefr_date.year}年{cefr_date.month}月ダウンロード）
- Octanove（C1–C2）來源：{dl("octanove")}
  - 授權：CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）。Octanove Vocabulary Profile C1/C2 (ver 1.0), created by Octanove Labs, distributed by Open Language Profiles (https://github.com/openlanguageprofiles/olp-en-cefrj).
  - **相同方式分享**：`cefr.source` 含 Octanove 的值屬於 CC BY-SA 4.0 素材。若把這些值連同資料一起再散布，該部分要以 CC BY-SA 4.0 釋出並標示；04 文件 §7.3 的 `share_alike` 欄位應設為 true。

## 6. OpenCC

- 用途：簡體→台灣繁體（s2twp）轉換工具，本次使用 {conv.package}。Apache License 2.0（https://github.com/BYVoid/OpenCC）。轉換結果不另受 OpenCC 授權限制。

## 7. Cambridge Dictionary

- 欄位：`cambridge_url` 只是外部連結（英漢繁體），依 03 文件 §9.4 的 slug 規則由 `word` 產生。
- 沒有抓取、快取或嵌入任何 Cambridge 內容（04 文件 §2.2、§7.4）。本專案與 Cambridge University Press & Assessment 無關。

## 欄位來源對照

| 欄位 | 來源 | 授權 |
|---|---|---|
| entry_id, word, level, pos, variants, raw, tags | 大考中心詞彙表 | 非營利使用、註明出處 |
| forms, ipa, zh, variant_info, freq, internal_core_flag, internal_star | ECDICT | MIT |
| en_def | OEWN（優先）或 ECDICT | CC BY 4.0／MIT |
| wordnet | OEWN 2025 | CC BY 4.0（標示 Princeton WordNet 與 OEWN） |
| family, family_id | 本專案計算（詞彙表＋OEWN derivation） | CC BY 4.0 部分 |
| examples | Tatoeba | CC BY 2.0 FR／CC0（逐句標示） |
| cefr | CEFR-J 1.6／Octanove C1–C2 | CEFR-J 條款／CC BY-SA 4.0 |
| cambridge_url | 連結（本專案產生） | — |
"""


# ---------------------------------------------------------------------------
# 報告
# ---------------------------------------------------------------------------
def pct(n, d):
    return f"{n / d * 100:.1f}%" if d else "—"


def report_md(out, findex, sources, conv, tstats, ipa_issues, ipa_examples, fam_edges, fam_sizes, files,
              oewn_any) -> str:
    groups = [("L1", lambda o: o["level"] == 1), ("L2", lambda o: o["level"] == 2),
              ("L3", lambda o: o["level"] == 3), ("L4", lambda o: o["level"] == 4),
              ("L5", lambda o: o["level"] == 5), ("L6", lambda o: o["level"] == 6),
              ("**L3–5**", lambda o: 3 <= o["level"] <= 5), ("全部", lambda o: True)]
    G = [(name, [o for o in out if f(o)]) for name, f in groups]

    def wn(o):
        return o["wordnet"] or {}

    metrics = [
        ("variants（有變體）", lambda o: bool(o["variants"])),
        ("forms（ECDICT 屈折形）", lambda o: bool(o["forms"])),
        ("ipa", lambda o: bool(o["ipa"])),
        ("　ipa 來自 ECDICT", lambda o: bool(o["ipa"]) and o["ipa_source"]["source"] == "ecdict"),
        ("zh（ECDICT 中文）", lambda o: bool(o["zh"])),
        ("　zh 有詞性相符的行", lambda o: any(z["match"] for z in o["zh"])),
        ("en_def", lambda o: bool(o["en_def"])),
        ("　en_def 來自 OEWN", lambda o: o["en_def_source"] == "oewn"),
        ("wordnet（依條目詞類有義項）", lambda o: o["wordnet"] is not None),
        ("　≥1 義項有例句", lambda o: any(s["examples"] for s in wn(o).get("senses", []))),
        ("　≥1 義項有同義詞", lambda o: any(s["synonyms"] for s in wn(o).get("senses", []))),
        ("　同義詞中有詞彙表內的字", lambda o: any(x["in_list"] for s in wn(o).get("senses", []) for x in s["synonyms"])),
        ("　antonyms", lambda o: bool(wn(o).get("antonyms"))),
        ("　hypernyms", lambda o: bool(wn(o).get("hypernyms"))),
        ("　derivations（詞彙表內）", lambda o: bool(wn(o).get("derivations"))),
        ("family（有同詞族條目）", lambda o: bool(o["family"])),
        ("examples ≥1", lambda o: len(o["examples"]) >= 1),
        ("examples ≥3", lambda o: len(o["examples"]) >= 3),
        ("examples =5", lambda o: len(o["examples"]) == 5),
        ("　例句全部在級別內（≤level+1）", lambda o: bool(o["examples"]) and all(x["within_level"] for x in o["examples"])),
        ("Tatoeba 候選句 ≥1（tatoeba_count）", lambda o: o["sources"]["tatoeba_count"] >= 1),
        ("Tatoeba 候選句 ≥3", lambda o: o["sources"]["tatoeba_count"] >= 3),
        ("cefr", lambda o: o["cefr"] is not None),
        ("freq.frq", lambda o: o["freq"]["frq"] is not None),
        ("freq.bnc", lambda o: o["freq"]["bnc"] is not None),
        ("internal_core_flag = true", lambda o: o["internal_core_flag"] is True),
        ("internal_star 有值", lambda o: o["internal_star"] is not None),
        ("cambridge_url", lambda o: bool(o["cambridge_url"])),
    ]
    L = []
    w = L.append
    w("# 單字資料管線報告（lexicon）")
    w("")
    w("> 本檔由 `tools/build_vocab.py build` 產生，請勿手動修改。數字全部是本專案計算。")
    w("> 輸入：`data/vocab/ceec-wordlist.json`（6,012 筆）與 `data/vocab/sources.json` 列出的原始檔。")
    w("")
    w("## 1. 輸出檔")
    w("")
    w("| 檔案 | 大小 | sha256 |")
    w("|---|---:|---|")
    for name in sorted(files):
        p = files[name]
        w(f"| `data/vocab/{name}` | {p.stat().st_size:,} bytes | `{sha256_file(p)}` |")
    w("")
    w(f"- 條目數 {len(out):,}；forms-index 詞形數 {len(findex):,}。"
      f"lexicon.json 上限 25 MB，{'未超過，輸出單一檔' if 'lexicon.json' in files else '超過，已依級別拆檔'}。")
    multi = sum(1 for v in findex.values() if len({x['entry_id'] for x in v}) > 1)
    w(f"- forms-index 中對應到多個條目的詞形：{multi:,} 個（例如 {', '.join(sorted(k for k, v in findex.items() if len(v) > 1)[:12])}）。")
    w(f"- OpenCC：{conv.package}（s2twp）。重跑一致性：`python3 tools/build_vocab.py check` 會在暫存目錄重建並逐位元比對，"
      "上表 sha256 也可以直接比對。")
    w("")
    w("## 2. 各欄位非空比例（依級別）")
    w("")
    w("| 欄位 | " + " | ".join(n for n, _ in G) + " |")
    w("|---|" + "---:|" * len(G))
    w("| 條目數 | " + " | ".join(f"{len(g):,}" for _, g in G) + " |")
    for label, fn in metrics:
        w(f"| {label} | " + " | ".join(pct(sum(1 for o in g if fn(o)), len(g)) for _, g in G) + " |")
    w("")
    w("說明：")
    w("- `wordnet` 只算條目詞類對應的 WordNet 詞性（n.、v.、adj.、adv.；aux. 視為 v.）。prep.、conj.、pron.、art. 在 WordNet 沒有對應，"
      "所以 L1–2 的功能詞比例較低。")
    w("- `zh 有詞性相符的行`：ECDICT 中文的行首詞性（vt.、n.、a.…）屬於條目詞類，介面可預設只顯示這些行。")
    w("- `Tatoeba 候選句`：含該條目任一詞形（原形、變體、屈折形）且有中文翻譯的英文句數，未套用句長與作者條件；"
      "`examples` 是套用句長 6–20、作者必填（CC0 例外）、去重後實際收錄的句子（最多 5 句）。")
    w("")

    # §2.3 比較
    l35 = [o for o in out if 3 <= o["level"] <= 5]
    n = len(l35)

    def c(fn):
        k = sum(1 for o in l35 if fn(o))
        return f"{k:,}（{pct(k, n)}）"
    w("## 3. 與 04 文件 §2.3（Level 3–5 共 3,006 筆）比較")
    w("")
    w("| 資料 | 指標 | 04 文件 | 本次 | 差異說明 |")
    w("|---|---|---:|---:|---|")
    w(f"| ECDICT | 收錄且有中文釋義 | 3,006（100%） | {c(lambda o: bool(o['zh']))} | |")
    w(f"| ECDICT | 有 Collins 星級 | 2,843（94.6%） | {c(lambda o: o['internal_star'] is not None)} | 欄位改名 `internal_star` |")
    w(f"| ECDICT | `oxford`=1 | 1,003（33.4%） | {c(lambda o: o['internal_core_flag'] is True)} | 欄位改名 `internal_core_flag` |")
    w(f"| ECDICT | 有 `frq` | 2,991（99.5%） | {c(lambda o: o['freq']['frq'] is not None)} | 0 視為缺值 |")
    w(f"| ECDICT | 有 `exchange` | 2,557（85.1%） | {c(lambda o: bool(o['forms']))} | 本次只算詞頭（或第一個查得到的變體）那一列 |")
    w(f"| OEWN 2025 | 收錄 | 2,996（99.7%） | {c(lambda o: o['wordnet'] is not None)} | 本次限條目詞類；不限詞類見下一列 |")
    w(f"| OEWN 2025 | 收錄（不限詞類） | 2,996（99.7%） | {c(lambda o: o['entry_id'] in oewn_any)} | |")
    w(f"| OEWN 2025 | 至少一個 synset 有其他成員 | 2,690（89.5%） | {c(lambda o: any(s['synonyms'] for s in wn(o).get('senses', [])))} | 限條目詞類 |")
    w(f"| OEWN 2025 | 有上位詞 | 2,547（84.7%） | {c(lambda o: bool(wn(o).get('hypernyms')))} | 限條目詞類 |")
    w(f"| OEWN 2025 | synset 附例句 | 2,369（78.8%） | {c(lambda o: any(s['examples'] for s in wn(o).get('senses', [])))} | 限條目詞類 |")
    w(f"| Tatoeba 英中對照 | ≥1 句含該詞（含屈折形） | 2,652（88.2%） | {c(lambda o: o['sources']['tatoeba_count'] >= 1)} | |")
    w(f"| Tatoeba 英中對照 | ≥3 句 | 1,840（61.2%） | {c(lambda o: o['sources']['tatoeba_count'] >= 3)} | |")
    w(f"| Tatoeba（收錄） | examples ≥1 | — | {c(lambda o: len(o['examples']) >= 1)} | 句長 6–20、作者必填 |")
    w(f"| Tatoeba（收錄） | examples ≥3 | — | {c(lambda o: len(o['examples']) >= 3)} | |")
    w("")

    # CEFR 分布
    w("## 4. CEFR 對照分布（與 04 文件 §5.3 比較）")
    w("")
    w("本次用 CEFR-J **1.6**（ALL_sep 工作表，斜線並列已拆開）加 Octanove C1–C2；04 文件用的是 1.5。"
      "同一詞多個詞性時，先取和條目詞類相符的詞性中最低級，沒有相符的才取全部詞性中最低級。")
    w("")
    w("| 大考級數 | 筆數 | A1 | A2 | B1 | B2 | C1 | C2 | 無對照 |")
    w("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for lvl in range(1, 7):
        g = [o for o in out if o["level"] == lvl]
        cnt = collections.Counter(o["cefr"]["level"] if o["cefr"] else "none" for o in g)
        w(f"| L{lvl} | {len(g):,} | " + " | ".join(str(cnt.get(k, 0)) for k in ("A1", "A2", "B1", "B2", "C1", "C2", "none")) + " |")
    w("")
    w("04 文件 §5.3 的「無對照」：L1 7、L2 40、L3 112、L4 119、L5 263、L6 483。")
    w("")

    # IPA
    w("## 5. 音標字元統一")
    w("")
    src_cnt = collections.Counter(o["ipa_source"]["source"] if o["ipa_source"] else "none" for o in out)
    w(f"- 來源：ECDICT {src_cnt['ecdict']:,} 筆，OEWN 補 {src_cnt['oewn']:,} 筆，仍缺 {src_cnt['none']:,} 筆。")
    chars = collections.Counter(ch for o in out if o["ipa"] for ch in o["ipa"])
    w("- 輸出音標使用的字元：" + " ".join(f"`{ch}`" if ch != " " else "`␠`" for ch in sorted(chars)))
    leftovers = sorted(ch for ch in chars if ch in "\u04d9\u0454':")
    w(f"- 殘留的 Cyrillic ә／є、ASCII ' 或 :：{'無' if not leftovers else ' '.join(leftovers)}。")
    w("- 對應：`ә`(U+04D9)→`ə`(U+0259)、`є`(U+0454)→`ɛ`(U+025B)、`'`→`ˈ`、`:`→`ː`、緊接音標的 `,`／`.`→`ˌ`；"
      "`. `、`, ` 與兩段都有主重音的 `.` 視為多種讀法，輸出成 `, `。ASCII `g` 保留（IPA 認可 g 與 ɡ 兩種字形）。")
    for k in sorted(ipa_issues):
        w(f"- 不採用的 ECDICT 音標（{k}）：{ipa_issues[k]} 次，例如 " + "；".join(f"`{x}`" for x in sorted(set(ipa_examples[k]))[:8]))
    missing = [o["raw"] for o in out if not o["ipa"]]
    w(f"- 沒有音標的條目（{len(missing)}）：" + "、".join(missing))
    w("")

    # 例句
    w("## 6. 例句（Tatoeba）")
    w("")
    w(f"- 匯出檔：有中文連結的英文句 {tstats['eng_with_cmn_links']:,} 句（實際載入 {tstats['eng_loaded']:,}），"
      f"對應中文句 {tstats['cmn_loaded']:,} 句；CC0 清單 {tstats['cc0']:,} 句。")
    exs = [x for o in out for x in o["examples"]]
    w(f"- 收錄例句 {len(exs):,} 句次（不重複英文句 {len({x['tatoeba_id'] for x in exs}):,}）；"
      f"英文 CC0 {sum(1 for x in exs if x['license'] == 'CC0-1.0'):,} 句次；中文經 s2twp 改變文字的 {sum(1 for x in exs if x['zh_converted']):,} 句次；"
      f"全句在級別內（其他字 ≤ level+1）的 {sum(1 for x in exs if x['within_level']):,} 句次。")
    authors = collections.Counter(x["author"] for x in exs)
    w("- 英文句作者前 10：" + "、".join(f"{a}（{n:,}）" for a, n in sorted(authors.items(), key=lambda t: (-t[1], str(t[0])))[:10]))
    w("")
    w("例句數分布（依級別）：")
    w("")
    w("| 級別 | 0 句 | 1–2 句 | 3–4 句 | 5 句 |")
    w("|---|---:|---:|---:|---:|")
    for lvl in range(1, 7):
        g = [len(o["examples"]) for o in out if o["level"] == lvl]
        w(f"| L{lvl} | {sum(1 for x in g if x == 0)} | {sum(1 for x in g if 1 <= x <= 2)} | {sum(1 for x in g if 3 <= x <= 4)} | {sum(1 for x in g if x == 5)} |")
    w("")

    # 詞族
    w("## 7. 詞族")
    w("")
    multi_fams = collections.defaultdict(list)
    for o in out:
        if o["family_id"]:
            multi_fams[o["family_id"]].append(o)
    w(f"- 有 2 個以上條目的詞族 {len(multi_fams):,} 個，涵蓋 {sum(len(v) for v in multi_fams.values()):,} 筆條目。"
      f"合併依據（union 次數）：同字多筆 {fam_edges['same_headword']}、變體等於另一筆詞形 {fam_edges['variant_is_headword']}、"
      f"OEWN derivation／pertainym {fam_edges['oewn_derivation']}。")
    w("- 詞族大小分布：" + "、".join(f"{k} 筆×{v}" for k, v in sorted(fam_sizes.items()) if k > 1))
    big = sorted(multi_fams.values(), key=lambda v: (-len(v), v[0]["family_id"]))[:5]
    w("- 最大的詞族：" + "；".join("、".join(f"{o['word']}({o['level']})" for o in sorted(v, key=lambda o: (o['level'], o['word']))) for v in big))
    samples = ["admire", "accurate", "accuse", "analyze", "adolescent", "compete", "economy"]
    w("- 03 文件 §7.3 的例子：")
    for s in samples:
        o = next((o for o in out if o["word"] == s), None)
        if o:
            w(f"  - {s}（L{o['level']}）→ " + ("、".join(f"{m['word']}(L{m['level']})" for m in o["family"]) or "（無）"))
    w("")

    # 特殊條目
    w("## 8. 特殊條目抽樣")
    w("")
    w("| 條目 | entry_id | ipa | 第一行中文 | WordNet 義項數 | 例句數 | 詞族 |")
    w("|---|---|---|---|---:|---:|---|")
    pick = ["backward adj. 2", "backward/backwards adv. 2", "capital n./adj. 2", "capital(ism) n. 4",
            "content n./adj. 4", "content(ment) v./(n.) 4", "measure(ment) v./(n.) 2", "measure(s) n. 4",
            "medium adj. 1", "medium/media n. 3", "am/a.m. adv. 1", "pm/p.m. adv. 1", "O.K./OK/okay adj./adv./n./v. 1",
            "o’clock adv. 1", "café/cafe n. 2", "T-shirt n. 1", "Mr./Mister n. 1", "I (me, my, mine, myself) pron. 1",
            "advertise(ment)/ad v./(n.) 3", "chairperson/chair/chairman/chairwoman n. 6", "calm v./adj./n 2"]
    byraw = {o["raw"]: o for o in out}
    for r in pick:
        o = byraw.get(r)
        if not o:
            continue
        z = next((x for x in o["zh"] if x["match"]), o["zh"][0] if o["zh"] else None)
        zt = (z.get("pos") or "") + " " + z["text"] if z else ""
        w(f"| `{r}` | `{o['entry_id']}` | {o['ipa'] or '—'} | {zt.strip()[:30]} | "
          f"{o['wordnet']['sense_count'] if o['wordnet'] else 0} | {len(o['examples'])} | "
          f"{'、'.join(m['word'] for m in o['family']) or '—'} |")
    w("")
    w("處理規則見 `tools/build_vocab.py` 檔頭註解。")
    w("")

    w("## 9. 來源版本")
    w("")
    w("| id | 檔案 | 版本 | 下載日 | sha256 |")
    w("|---|---|---|---|---|")
    for s in sources:
        w(f"| {s['id']} | `{s['file'].replace('data/raw/vocab-sources/', '')}` | {s['version']} | {s['retrieved_at']} | `{s['sha256'][:16]}…` |")
    w("")
    return "\n".join(L)


def cmd_build(args) -> int:
    build(VOCAB, verify=not args.no_verify)
    return 0


def cmd_check(args) -> int:
    with tempfile.TemporaryDirectory(prefix="vocab-check-") as td:
        files = build(Path(td), verify=not args.no_verify)
        bad = []
        for name, p in sorted(files.items()):
            cur = VOCAB / name
            if not cur.exists() or sha256_file(cur) != sha256_file(p):
                bad.append(name)
        if bad:
            log("DIFFERENT: " + ", ".join(bad))
            return 1
        log("identical: " + ", ".join(sorted(files)))
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", default="build", choices=["fetch", "build", "check"])
    ap.add_argument("--no-verify", action="store_true", help="不核對原始檔 sha256")
    args = ap.parse_args()
    return {"fetch": cmd_fetch, "build": cmd_build, "check": cmd_check}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
