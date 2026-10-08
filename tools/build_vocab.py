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
  data/vocab/forms-index.json               詞形 → entry_id（原形、拼法變體、括號衍生、代名詞格、屈折形；
                                            ECDICT 沒列複數的名詞另補規則複數 plural_rule）
  data/vocab/CREDITS.md                     各來源授權與標示文字
  data/vocab/lexicon-report.md              各欄位覆蓋率（依級別）、與 04 文件 §2.3 的比較、特殊條目處理

用法
  python3 tools/build_vocab.py fetch        # 下載全部來源並更新 sources.json（網路失敗會以指數退避重試）
  python3 tools/build_vocab.py fetch --reuse-local   # 本地檔 sha256 和 sources.json 相符的就不重新下載
  python3 tools/build_vocab.py build        # 由本地原始檔產生輸出（預設子命令）
  python3 tools/build_vocab.py check        # 在暫存目錄重建一次，和現有輸出逐位元比對；不同、或自動查核（報告 §9）
                                            # 有必須為 0 的項目不是 0，結束碼都是 1（可放 CI）
  python3 tools/build_vocab.py sample [--seed N]     # 印出每級 10 筆的分層抽樣，供人工逐欄核對
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
    ә→ə、є→ɛ、g→ɡ（U+0261，ECDICT 兩種混用）、'→ˈ（主重音）、緊接音標的 , 與 . →ˌ（次重音）、:→ː；
    ". "、", "、兩段都有主重音的 "." 視為「多種讀法」的分隔，統一輸出為 ", "。結果再用 IPA 字元白名單檢查。
    含有無法判讀字元（\\、^ 等 ECDICT 編碼損壞）的音標不採用，改用 OEWN 的發音（ipa_source 標 oewn）。
    只統一字元，不改音標體系（ECDICT 是舊式英式標音，例如 ɡəu；OEWN 是美式）。
  * 中文：ECDICT translation 依原本的換行分行，每行拆出詞性標記（vt.、n.…）或領域標記（[計]、[醫]…），
    文字用 OpenCC s2twp 轉成台灣繁體用語。標點維持原樣。
  * en_def：優先取 OEWN 第一個（依條目詞類順序）義項的定義；沒有時退回 ECDICT 英文釋義中詞性相符的第一行。
  * 詞族（family）：以 union-find 合併 (1) 同字多筆、(2) 括號衍生形或拼法相近的斜線變體等於另一筆的詞形、
    (3) OEWN 義項的衍生類關係（derivation、pertainym、participle、agent／event／result… 等 morphosemantic 關係）
    與 synset 的 attribute 關係（accurate↔accuracy）。OEWN 連結兩端的義項詞性都要能代表各自條目的詞類
    （contain v. 連到的是 continent 的形容詞義項「自制的」，不能算到 continent n.「大陸」），兩個詞要有共同字首
    （避免 die→death 這類跨字根連結），另有少數同形異義的黑名單（FAMILY_BLOCKLIST）。
    family_id 取詞族中最短（同長取級別低、再依字母）的條目 entry_id。
  * wordnet.derivations：OEWN derivation／pertainym 的目標詞中也在詞彙表、且詞類相符的條目（不要求共同字首）。
    synonyms／antonyms 標記是否在詞彙表時，優先對應詞類相符的條目。
  * 例句：Tatoeba 中有中文翻譯的英文句，句長 6–20 個 token，含該條目任一詞形（原形、變體、屈折形）。
    排序：(1) 句中其他字都在詞彙表且級別 ≤ 該條目級別+1（人名、數字、附錄詞不扣分；附錄詞＝詞彙表 p.104
    的數字、星期、月份、季節，視為第 1 級）；(2) 超出級別的字越少越前面；(3) 句長越接近 10 越前面；(4) 句子 ID。
    去重：句型骨架（人名→NAME、數字→NUM）相同者只留一句；第一輪再避開和已選句 token 集合 Jaccard≥0.6
    或目標詞前後文相同的句子，不足 5 句時第二輪補回。作者為空（孤兒句）且不是 CC0 的句子不採用，
    因為 CC BY 需要標示作者。中文翻譯有多句時取有作者、ID 最小的一句。
    同形異詞：條目原形同時是另一個級別不高於它的條目的屈折形時（saw／see、found／find、lay／lie），只靠這個
    詞形命中、而且前一個字（限定詞、連綴動詞、to／助動詞）無法判斷詞類的句子不採用；細節見選例句的程式註解。
    內容過濾：含粗話、色情、自殘字眼的句子不採用（SENSITIVE_RE；命中的字就是條目本身時例外）。
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
    prev = {}
    if SOURCES_JSON.exists():
        for r in json.loads(SOURCES_JSON.read_text(encoding="utf-8")).get("sources", []):
            prev[r["id"]] = r
    out = []
    for s in SOURCES:
        dest = RAW / s["file"]
        old = prev.get(s["id"])
        if args.reuse_local and old and dest.exists() and sha256_file(dest) == old.get("sha256"):
            # 本地檔和 sources.json 記錄的 sha256 相同：沿用原本的下載日期與 HTTP 標頭，不重新下載
            log(f"keep {s['file']} (sha256 matches sources.json, retrieved {old.get('retrieved_at')})")
            meta = {k: old.get(k) for k in ("bytes", "sha256", "http_last_modified", "http_etag")}
            retrieved = old.get("retrieved_at")
        else:
            log(f"GET {s['url']}")
            meta = http_get(s["url"], dest)
            retrieved = today
        rec = {k: s[k] for k in ("id", "group", "file", "url", "version", "license", "license_url")}
        rec["file"] = f"data/raw/vocab-sources/{s['file']}"
        rec.update(retrieved_at=retrieved, **meta)
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


# OpenCC s2twp 沒有處理、或處理後不是台灣常用說法的大陸詞（2026-10-08 逐條檢查輸出後列出）。只套用在「原文是簡體」的
# 字串上（ECDICT 全部；Tatoeba 只限 s2t 會改變文字的句子），因為「土豆」「快餐」這類詞在繁體原文裡可能是台灣作者的
# 本意（台灣的土豆是花生）。做法：轉換前把原文中的這些詞換成私用區字元，轉換後再換成右邊的台灣說法，避免 OpenCC
# 再改一次（例如 TWPhrases 會把「聲明」改成「宣告」）。長的詞先比對。
TW_PHRASES = {
    "声明": "聲明", "土豆": "馬鈴薯", "冰激凌": "冰淇淋", "冰激淋": "冰淇淋", "冰淇凌": "冰淇淋",
    "三文鱼": "鮭魚", "金枪鱼": "鮪魚", "西兰花": "花椰菜", "西红柿": "番茄", "酸奶": "優格", "曲奇": "餅乾",
    "摩托车": "機車", "空调": "冷氣", "因特网": "網際網路", "联机": "連線", "计算机": "電腦", "计算器": "計算機",
    "营销": "行銷", "宇航员": "太空人", "航天飞机": "太空梭", "航天飞船": "太空船", "航天": "航太",
    "磁带": "錄音帶", "洗发水": "洗髮精", "薯片": "洋芋片", "快餐": "速食", "导弹": "飛彈", "公交车": "公車",
    "公交": "公車", "意面": "義大利麵", "渠道": "管道", "澳大利亚": "澳洲", "菠萝": "鳳梨", "小区": "社區",
}
# 不分原文簡繁都套用的修正：Tatoeba 中文句裡混入的日文新字體與異體字（OpenCC 不轉換、也不在台灣常用的 Big5 字集），
# 以及「大坂」（大阪的舊寫法）。這些字是在輸出中檢查「不在 Big5（cp950）的漢字」時找到的。
VARIANT_CHARS = str.maketrans({"髪": "髮", "頬": "頰", "敍": "敘", "絶": "絕", "覚": "覺", "説": "說", "産": "產",
                               "鉄": "鐵", "円": "圓", "兿": "藝", "貭": "質", "幚": "幫"})
ALWAYS_PHRASES = {"大坂": "大阪"}
# 不在 Big5 但台灣也照用的字（擬聲詞、專業用字），自動檢查時不列為問題
NON_BIG5_OK = set("咔擀嵴鯿酶顬")
_TW_KEYS = sorted(TW_PHRASES, key=lambda k: (-len(k), k))
_TW_RE = re.compile("|".join(map(re.escape, _TW_KEYS)))


class Converter:
    """OpenCC s2twp（簡→繁台灣用語），再補 TW_PHRASES 與「箇→個」。優先用官方 opencc 綁定，否則用
    opencc-python-reimplemented（兩個套件的模組名稱都是 opencc，裝在同一個目錄時以最後安裝的 __init__.py 為準）。"""

    def __init__(self):
        import importlib.metadata as md
        import opencc  # noqa: 兩個套件的模組名稱都是 opencc
        self.cc = self.s2t = None
        for cfg in ("s2twp.json", "s2twp"):
            try:
                self.cc = opencc.OpenCC(cfg)
                self.cc.convert("测试")
                self.s2t = opencc.OpenCC(cfg.replace("s2twp", "s2t"))
                break
            except Exception:
                self.cc = None
        if self.cc is None:
            raise SystemExit("OpenCC s2twp unavailable")
        # 實際載入的是哪個套件：官方綁定有 C 擴充模組 opencc_clib 與 __version__，reimplemented 沒有
        official = hasattr(opencc, "opencc_clib") or "clib" in str(getattr(opencc, "__file__", ""))
        dist = "opencc" if official else "opencc-python-reimplemented"
        try:
            ver = getattr(opencc, "__version__", None) if official else md.version(dist)
        except md.PackageNotFoundError:
            ver = None
        self.package = f"{'OpenCC（官方 Python 綁定）' if official else 'opencc-python-reimplemented'} {ver or '?'}"
        self.cache: dict[tuple[str, bool], str] = {}

    def is_simplified(self, s: str) -> bool:
        """原文是否為簡體（s2t 會改變文字）。"""
        return self.s2t.convert(s) != s

    def __call__(self, s: str, simplified_source: bool | None = None) -> str:
        """simplified_source=None 時自動判斷（Tatoeba）；ECDICT 傳 True。"""
        if simplified_source is None:
            simplified_source = self.is_simplified(s)
        key = (s, simplified_source)
        r = self.cache.get(key)
        if r is None:
            if simplified_source and _TW_RE.search(s):
                found = []

                def mark(m):
                    found.append(TW_PHRASES[m.group(0)])
                    return chr(0xE000 + len(found) - 1)
                r = self.cc.convert(_TW_RE.sub(mark, s))
                for i, t in enumerate(found):
                    r = r.replace(chr(0xE000 + i), t)
            else:
                r = self.cc.convert(s)
            # 「箇」在台灣只用於「箇中」；Tatoeba 部分繁體句（多為轉換工具產生）把「個」寫成「箇」
            r = re.sub(r"箇(?!中)", "個", r).translate(VARIANT_CHARS)
            for a, b in ALWAYS_PHRASES.items():
                r = r.replace(a, b)
            self.cache[key] = r
        return r


# ---------------------------------------------------------------------------
# 詞彙表
# ---------------------------------------------------------------------------
# 原表依規則取斜線前的形式當 word，但 am/pm 查辭典要用 a.m./p.m.，否則會查到 be 動詞 am（03 文件 §6.4）
LOOKUP_OVERRIDES = {"am|adv.|1": "a.m.", "pm|adv.|1": "p.m."}
# 例句只比對這些詞形（am、pm 本身太容易誤配）
EXAMPLE_FORM_OVERRIDES = {"am|adv.|1": ["a.m."], "pm|adv.|1": ["p.m."]}

# 詞族黑名單：OEWN 的衍生連結落在「同形但不同字」的少見義項上，例如 letter「出租的人」← let、better「打賭的人」
# ← bet、tower「拖曳者」← tow、liver「生活者」← live、stocking「進貨」← stock。詞彙表收的是信件、更好的、塔、
# 肝臟、長襪，所以這些連結不算詞族（逐筆檢查 OEWN 連結後列出；詞性不符的 contain→continent 等已由詞性檢查排除）。
FAMILY_BLOCKLIST = {frozenset(p) for p in [("let", "letter"), ("bet", "better"), ("tow", "tower"), ("live", "liver"),
                                           ("life", "liver"), ("lively", "liver"), ("stock", "stocking")]}

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
# ECDICT exchange 的資料錯誤（2026-10-08 逐筆檢查詞彙表條目的不規則形後列出）：值為 None 表示刪掉這個形式。
FORM_FIXES = {
    "sheep": {"plural": "sheep"},                                    # ECDICT：sheeps
    "picnic": {"third_person": "picnics"},                           # ECDICT：picnic
    "number": {"third_person": "numbers"},                           # ECDICT：numbs（numb 的變化）
    "ground": {"present_participle": "grounding", "third_person": "grounds"},   # ECDICT：grinding、grinds（grind 的）
    "clothe": {"present_participle": "clothing"},                    # ECDICT：cloathing
    "enroll": {"third_person": "enrolls"},                           # ECDICT：英式 enrols（詞彙表以美式拼法為主）
    "ski": {"past_participle": "skied"},                             # ECDICT：ski'd
    "stride": {"past_participle": "stridden"},                       # ECDICT：strode
    "can": {"third_person": "cans"},                                 # ECDICT：can（情態動詞）；can v.＝裝罐
    "up": {"third_person": "ups"},                                   # ECDICT：up
}
PLURAL_MIN_ATTEST = 3                      # 規則複數至少要在 Tatoeba 英文句出現幾次才收
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
    if any(c in IPA_BAD for c in s):                   # \\、^ 是編碼損壞
        return None, ["corrupt"]
    s = re.sub(r"'\s+", "'", s)                        # 主重音後誤加空白（outsider 的 "' aut'said…"）
    s = re.sub(r"'{2,}", "'", s)                       # 重複的主重音（vacuum 的 "''væk…"）
    for a, b in IPA_MAP.items():
        s = s.replace(a, b)
    # 多種讀法的分隔：". "、", "
    parts = re.split(r"\.\s+|,\s+", s)
    out_parts = []
    for p in parts:
        # 沒有空白的 "."：兩邊都有主重音 '（abuse 的兩讀），或兩邊都沒有重音記號（單音節的兩種讀法，例如
        # bath、live、brass）時是分隔；否則是次重音（academic、accommodation、kindergarten）
        segs = p.split(".")
        cur = segs[0]
        sub = []
        for seg in segs[1:]:
            lh, rh = "'" in cur, "'" in seg
            if (lh and rh) or (not lh and not rh and cur and seg):
                sub.append(cur)
                cur = seg
            else:
                cur = cur + "\u02cc" + seg
        sub.append(cur)
        for q in sub:
            # 沒有空白的 ","：一般是次重音（T-shirt、upload）；後面那段以 - 開頭或結尾時，是只寫出不同部分的第二讀法
            pieces = q.split(",")
            cur2 = pieces[0]
            for piece in pieces[1:]:
                if piece.startswith("-") or piece.endswith("-"):
                    out_parts.append(cur2.replace("'", "\u02c8"))
                    cur2 = piece
                else:
                    cur2 = cur2 + "\u02cc" + piece
            out_parts.append(cur2.replace("'", "\u02c8"))
    # 含 jj 的讀法是打字錯誤（yourselves 的第二讀法 "jjә-"），只丟掉那一段
    kept = [x for x in out_parts if x and "jj" not in x]
    if not kept:
        return None, ["corrupt"]
    s = ", ".join(kept)
    issues = sorted({c for c in s if c not in IPA_OK})
    if issues:
        return None, ["unexpected:" + "".join(issues)]
    return s, []


ZH_LINE = re.compile(r"^(?:(?P<pos>[a-z]{1,6}\.)\s*|\[(?P<dom>[^\]]{1,8})\]\s*)?(?P<text>.*)$")
ECDICT_POS = {   # 詞彙表詞類 → ECDICT translation 行首詞性（num. 是數詞，billion n.、third adj./n./adv. 用得到）
    "n.": {"n.", "pl.", "num."}, "v.": {"v.", "vt.", "vi."}, "adj.": {"a.", "adj.", "s.", "num."},
    "adv.": {"ad.", "adv.", "r."}, "prep.": {"prep."}, "conj.": {"conj."}, "pron.": {"pron."},
    "art.": {"art."}, "aux.": {"aux.", "v.", "modal."},
}
ECDICT_DEF_POS = {"n.": {"n"}, "v.": {"v"}, "adj.": {"a", "s"}, "adv.": {"r"}}


def split_lines(field: str) -> list[str]:
    """ECDICT 欄位以字面的 \n 分行；少數列還有字面的 \r（a 的中文「第一的\r」）。"""
    return [x.strip() for x in re.split(r"\\r\\n|\\n|\\r|\r?\n|\r", field or "") if x.strip()]


def clean_zh(text: str) -> str:
    """去掉 ECDICT 的「+」前綴（gym 的「+體育館」），並刪掉轉換後重複的義項（數據／資料 → 資料, 資料）。"""
    text = re.sub(r"(^|[,;，；]\s*)\+", r"\1", text).strip()
    for sep in (", ", "; ", "；", "，"):
        if sep in text:
            items = []
            for it in text.split(sep):
                if it.strip() and it not in items:
                    items.append(it)
            text = sep.join(items)
    return text


def zh_lines(row: dict, entry_pos: list[str], conv: Converter, *, fallback: bool = True) -> list[dict]:
    """ECDICT 中文逐行。match＝該行詞性屬於條目詞類（領域行 [計]、[醫]… 一律 False）。沒有任何一行相符時
    （hello n. 只有 interj. 行、Internet n. 只有 [計] 行、terrorist adj. 只有 n. 行），fallback=True 會把有詞性
    或沒標詞性的行（都沒有時改用領域行）標成 match=true 並加上 fallback=true，介面仍可只顯示 match=true 的行。"""
    allowed = set()
    for p in entry_pos:
        allowed |= ECDICT_POS.get(p, set())
    out = []
    for line in split_lines(row.get("translation", "")):
        m = ZH_LINE.match(line)
        pos, dom, text = m.group("pos"), m.group("dom"), m.group("text").strip()
        text = clean_zh(conv(text, True)) if text else ""
        if not text:
            continue
        rec = {}
        if dom:
            rec["domain"] = conv(dom, True)
            rec["text"] = text
            rec["match"] = False
        else:
            rec["pos"] = pos
            rec["text"] = text
            rec["match"] = (pos in allowed) if pos else True
        out.append(rec)
    if fallback and out and not any(r["match"] for r in out):
        cand = [r for r in out if "domain" not in r] or out
        for r in cand:
            r["match"] = True
            r["fallback"] = True
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
        self.lemma_synset_sense: dict[tuple[str, str], str] = {}
        self.lower: dict[str, list[str]] = collections.defaultdict(list)
        for lemma in sorted(self.entries):
            self.lower[lemma.lower()].append(lemma)
            for pkey, e in self.entries[lemma].items():
                for s in e.get("sense", []):
                    self.sense_lemma[s["id"]] = lemma
                    self.sense_pos[s["id"]] = wn_base_pos(pkey)
                    self.sense_by_id[s["id"]] = s
                    self.lemma_synset_sense[(lemma, s["synset"])] = s["id"]

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
# 例句的內容過濾（App 對象是高中生）：粗話、色情、自殘字眼的句子不當例句；若命中的字就是條目本身的詞形
# （詞彙表有 sexy、suicide 等字），仍可採用。naked eye、breast cancer、drunk driver 這類中性用法不受影響。
SENSITIVE_RE = re.compile(
    r"\b(?:fuck\w*|shit\w*|bitch\w*|bastards?|assholes?|cunts?|whores?|sluts?|porn\w*|penis\w*|vagina\w*|"
    r"orgasm\w*|masturbat\w*|sexy|nigg(?:er|a)s?|faggots?|suicid\w*|rap(?:e|es|ed|ing|ist|ists)|"
    r"(?:kill|hang)(?:s|ed|ing)? (?:my|your|him|her|them|our)sel(?:f|ves))\b", re.I)


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def read_tsv_bz2(path: Path):
    with bz2.open(path, "rt", encoding="utf-8", newline="") as f:
        for line in f:
            yield line.rstrip("\n").split("\t")


def load_tatoeba(conv: Converter, attest_words: set[str] = frozenset()):
    """讀 Tatoeba 匯出檔。attest_words：要在「全部」英文句（不限有中文翻譯的）計算出現次數的小寫詞（規則複數用）。"""
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
    attest = collections.Counter()
    word_re = re.compile(r"[a-z]+")
    for row in read_tsv_bz2(RAW / "tatoeba/eng_sentences_detailed.tsv.bz2"):
        if len(row) >= 4 and row[0].isdigit():
            if attest_words:
                for t in word_re.findall(row[2].lower()):
                    if t in attest_words:
                        attest[t] += 1
            if int(row[0]) in links:
                user = None if row[3] in ("\\N", "") else row[3]
                eng[int(row[0])] = (row[2], user)
    cc0 = set()
    for fn in ("tatoeba/eng_sentences_CC0.tsv.bz2", "tatoeba/cmn_sentences_CC0.tsv.bz2"):
        for row in read_tsv_bz2(RAW / fn):
            if row and row[0].isdigit():
                cc0.add(int(row[0]))
    stats = {"eng_with_cmn_links": len(links), "eng_loaded": len(eng), "cmn_loaded": len(cmn), "cc0": len(cc0)}
    return links, eng, cmn, cc0, stats, attest


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


LAST_AUDIT: list[dict] = []        # 最近一次 build 的自動查核結果（check 用）


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
    # 條目詞類以外的屈折形（ECDICT 給名詞 angle 列了 angled、給形容詞列了複數…）：不放進 lexicon.forms、不用來比對
    # 例句，只在 forms-index 標 extra_pos=true，供詞形還原（angled→angle）。見 licensed_form 的說明。
    extra_map: dict[str, dict[str, dict]] = collections.defaultdict(dict)
    form_stats = collections.Counter()

    def add_form(form, eid, typ, base=None, target=None):
        k = fold(form)
        rec = (form_map if target is None else target)[k].setdefault(eid, {"types": [], "bases": []})
        if typ not in rec["types"]:
            rec["types"].append(typ)
        if base and base not in rec["bases"]:
            rec["bases"].append(base)

    def licensed_form(name: str, pos: set[str]) -> bool:
        """ECDICT exchange 的屈折形是否屬於條目（或變體）的詞類。ECDICT 的 exchange 不分詞性，名詞 fee 會帶出
        動詞過去式 feed、形容詞 abnormal 會帶出複數 abnormals、名詞 ox 會帶出比較級 oxer。aux. 不算：情態動詞
        沒有屈折，will 的 willing、willed 屬於實義動詞 will（詞彙表沒有收），can 的 canned 由 can v. 授權。"""
        if name == "plural":
            return "n." in pos
        if name in ("past", "past_participle", "present_participle", "third_person"):
            return "v." in pos
        if name in ("comparative", "superlative"):
            return bool(pos & {"adj.", "adv."})
        return True

    def variant_pos(e: dict, vt: str) -> set[str]:
        """變體的詞類：括號衍生（-ment、-ism）與 (s) 複數是名詞；代名詞格是代名詞；斜線變體沿用條目詞類
        （v./(n.) 的 (n.) 指衍生名詞，斜線變體 ad 之類算名詞）。"""
        if vt in ("derived_ment", "derived_suffix", "plural_usual"):
            return {"n."}
        if vt == "pronoun_case":
            return {"pron."}
        return {"n." if p == "(n.)" else p for p in e["pos"]}

    def restore_case(word: str, form: str) -> str:
        """ECDICT 把 T-shirt 的複數寫成 t-shirts；條目有大寫時把相同字首換回原本的大小寫。"""
        if word != word.lower() and form == form.lower() and form.startswith(word.lower()):
            return word + form[len(word):]
        return form

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
        # forms：只收條目詞類能產生的屈折形（v./(n.) 的 (n.) 不算，那是 -ment 名詞的詞類）
        head_pos = set(e["pos"]) - {"(n.)"}
        all_forms = parse_exchange(row["exchange"]) if row is not None else {}
        forms = {}
        for name, f in all_forms.items():
            f = restore_case(e["word"], f)
            fix = FORM_FIXES.get(e["word"], {})
            if name in fix:
                f = fix[name]
                if f is None:
                    form_stats["fixed_drop"] += 1
                    continue
                form_stats["fixed"] += 1
            if licensed_form(name, head_pos):
                if f == e["word"] and name in ("comparative", "superlative", "third_person", "present_participle"):
                    form_stats["self_drop"] += 1          # best 的比較級 best、underlying 的 -ing 形 underlying 之類
                    continue
                forms[name] = f
            else:
                form_stats["pos_drop"] += 1
                if name not in ("comparative", "superlative") and f != e["word"]:
                    add_form(f, eid, name, None if row_form == e["word"] else row_form, target=extra_map)
        rec["forms"] = forms
        add_form(e["word"], eid, "lemma")
        for v, vt in zip(e["variants"], e["variant_types"]):
            add_form(v, eid, vt)
        if key_form != e["word"]:
            add_form(key_form, eid, "slash")
        # IPA
        # 依詞形順序（原形 → 拼法變體），每個詞形先查 ECDICT、再查 OEWN。只有「去掉標點後拼法相同」的變體
        # （O.K.→OK、café→cafe）才能代用；chairperson 不能拿 chair、seagull 不能拿 gull 的音標，查不到就留 null
        # （變體自己的音標在 variant_info）。
        ipa, ipa_src, ipa_form = None, None, None
        letters = lambda x: re.sub(r"[^a-z]", "", fold(x))
        for form in [key_form] + [v for v in e["variants"] if letters(v) in (letters(e["word"]), letters(key_form))]:
            r = ec.get(form)
            if r is not None and r["phonetic"].strip():
                val, issues = normalize_ipa(r["phonetic"])
                for i in issues:
                    ipa_issues[i] += 1
                    ipa_examples[i].append(f"{r['word']} {r['phonetic']}")
                if val:
                    ipa, ipa_src, ipa_form = val, "ecdict", form
                    break
            lemma = wn.find(form)
            p = wn.pronunciation(lemma) if lemma else None
            if p:
                ipa, ipa_src, ipa_form = p, "oewn", form
                break
        rec["ipa"] = ipa
        rec["ipa_source"] = None if ipa is None else (
            {"source": ipa_src} if ipa_form == e["word"] else {"source": ipa_src, "form": ipa_form})
        # 美式拼法：ECDICT 對 -l 結尾的動詞一律用英式雙寫（travelled、cancelled、modelled）。詞彙表以美式拼法為主，
        # 重音不在最後一個音節時（音標以 ˈ 開頭、至少兩個母音組）forms 改用美式（traveled），英式拼法仍列在 forms-index。
        w = e["word"]
        american_l = bool(re.fullmatch(r"[a-z]*[aeiou]l", w)) and bool(ipa) and ipa.startswith("\u02c8") \
            and (len(re.findall(r"[aeiouy]+", w)) >= 2 or bool(re.search(r"(?:ia|ua|ue|io)l$", w)))
        for name, f in list(forms.items()):
            add_form(f, eid, name, None if row_form == e["word"] else row_form)
            if american_l and name in ("past", "past_participle", "present_participle") \
                    and f in (w + "led", w + "ling"):
                forms[name] = w + f[len(w) + 1:]
                add_form(forms[name], eid, name)
                form_stats["american_l"] += 1
        # zh
        rec["zh"] = zh_lines(row, e["pos"], conv) if row is not None else []
        # variant_info：每個變體的音標與中文（v./(n.) 的 (n.) 就是衍生名詞）。中文只取變體詞類的行（代名詞格 mine
        # 只取 pron. 行，不取「礦」；斜線變體 chair 只取 n. 行）；其他詞類沒有相符的行時，斜線與衍生變體退回全部的行，
        # 代名詞格則留空。屈折形同樣只收變體詞類的（代名詞格不收，否則 mine→mined、her→hering 會對到代名詞）。
        vinfo = []
        for v, vt in zip(e["variants"], e["variant_types"]):
            r = ec.get(v)
            vi = {"form": v, "type": vt, "ipa": None, "zh": []}
            if r is not None:
                vpos = variant_pos(e, vt)
                vi["ipa"] = normalize_ipa(r["phonetic"])[0]
                lines = zh_lines(r, sorted(vpos), conv, fallback=(vt != "pronoun_case"))
                lines = [x for x in lines if x["match"]]
                vi["zh"] = [(f"{x['pos']} " if x.get("pos") else (f"[{x['domain']}] " if x.get("domain") else ""))
                            + x["text"] for x in lines]
                if vt != "pronoun_case":
                    for name, f in parse_exchange(r["exchange"]).items():
                        if licensed_form(name, vpos) and f != v:
                            add_form(restore_case(v, f), eid, name, v)
                        else:
                            form_stats["variant_drop"] += 1
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

    # 規則複數：ECDICT 沒列複數的名詞（cookie、calorie、campus、counselor…）依拼字規則產生候選（-s／-es／-ies、
    # quiz→quizzes、-o→-os／-oes、-f(e)→-ves、-man→-men、-child→-children），但只收在 Tatoeba 全部英文句
    # （約 200 萬句）中出現至少 PLURAL_MIN_ATTEST 次的拼法，排除不可數或不存在的形式（advices、aircrafts、
    # datas、deers、stepchilds、quizes、whies）。type=plural_rule；lexicon 的 forms 仍只放 ECDICT 資料。
    # 只處理全小寫的單一字；以 s 結尾的（athletics、diabetes、arms）除了 -us（campus→campuses）以外都略過。
    def plural_candidates(w: str) -> list[str]:
        if w.endswith("child"):
            return [w + "ren"]
        out = []
        if w.endswith("man") and len(w) > 4:
            out.append(w[:-3] + "men")
        if re.search(r"[^aeiou][aeiou]z$", w):
            out.append(w + "zes")
        if re.search(r"(?:s|x|z|ch|sh)$", w):
            out.append(w + "es")
        elif re.search(r"[^aeiou]y$", w):
            out.append(w[:-1] + "ies")
        elif re.search(r"[^aeiou]o$", w):
            out += [w + "es", w + "s"]
        elif w.endswith("fe"):
            out += [w[:-2] + "ves", w + "s"]
        elif w.endswith("f"):
            out += [w[:-1] + "ves", w + "s"]
        else:
            out.append(w + "s")
        return out

    plural_cands: dict[str, list[str]] = {}
    for e in entries:
        eid = e["entry_id"]
        if "n." not in e["pos"] or "plural" in lex[eid]["forms"] or "plural_usual" in e["variant_types"]:
            continue
        w = e["word"]
        if not re.fullmatch(r"[a-z]+", w) or (w.endswith("s") and not w.endswith("us")):
            continue
        plural_cands[eid] = plural_candidates(w)

    # ---------------- Tatoeba（先讀：規則複數要用英文語料確認拼法存在） ----------------
    links, eng, cmn, cc0, tstats, attest = load_tatoeba(
        conv, {c for v in plural_cands.values() for c in v})
    log(f"tatoeba: {tstats} ({time.time() - t0:.0f}s)")
    rule_plurals = rule_plural_rejected = 0
    rule_rejected_examples = []
    for eid, cands in plural_cands.items():
        ok = [c for c in cands if attest.get(c, 0) >= PLURAL_MIN_ATTEST]
        for c in ok:
            add_form(c, eid, "plural_rule")
        if ok:
            rule_plurals += 1
        else:
            rule_plural_rejected += 1
            rule_rejected_examples.append(cands[0])

    # extra_pos：同一條目已有的詞形，以及任何條目的原形或變體（feed、wedding、shorts、crossing…）都不另列
    base_forms = {k for k, ids in form_map.items()
                  if any({"lemma", "slash", "derived_ment", "derived_suffix", "plural_usual", "pronoun_case"}
                         & set(r["types"]) for r in ids.values())}
    for k in list(extra_map):
        for i in list(extra_map[k]):
            if k in base_forms or i in form_map.get(k, {}):
                del extra_map[k][i]
        if not extra_map[k]:
            del extra_map[k]

    # 詞形 → 級別（例句難度判斷用；含屈折形與 extra_pos 詞形）
    level_of: dict[str, int] = {}
    for k, ids in form_map.items():
        level_of[k] = min(by_id[i]["level"] for i in ids)
    for k, ids in extra_map.items():
        if k not in level_of:
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
        """OEWN 的詞是否也在詞彙表（比對原形與原表變體，不比對屈折形）。wpos（n／v／a／r）有值時只算詞類相符的條目，
        例如形容詞 synset 裡的 present 指向 present adj./n./v.。拼法相同但詞類不符的（abide 的同義詞 stomach 是動詞，
        詞彙表的 stomach 是名詞 L3）不算 in_list、不給 level，只在 other_pos_entry_ids 列出，避免把動詞 stomach
        標成「L3 單字」。"""
        all_ids = word_entries.get(fold(lemma), [])
        ids = [i for i in all_ids if wpos in form_wn_pos(i, lemma)] if wpos else list(all_ids)
        ids = sorted(ids, key=lambda i: (by_id[i]["level"], i))
        d = {"word": lemma.replace("_", " "), "in_list": bool(ids)}
        if ids:
            d["level"] = by_id[ids[0]]["level"]
            d["entry_ids"] = ids
        elif all_ids:
            d["other_pos_entry_ids"] = sorted(all_ids, key=lambda i: (by_id[i]["level"], i))
        return d

    def linked_entries(src_lemma: str, senses: list[dict], rels: tuple, self_id: str, *,
                       attribute: bool = False, morph: bool = False) -> list[tuple[str, str, str]]:
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
                if morph and (not morph_related(src_lemma, tl)
                              or frozenset((fold(src_lemma), fold(tl))) in FAMILY_BLOCKLIST):
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
                # 同一個字的轉類（capital n.↔capital adj.、measure v.↔measure n.）不是衍生詞，同字多筆另在 family 處理
                if fold(tl) in (fold(lemma), fold(e["word"])):
                    continue
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
            for tl, other, r in linked_entries(src_lemma, senses, MORPH_RELS, eid, attribute=True, morph=True):
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
    # I'm、I'll、I've、I'd 永遠大寫、小寫形不會出現，但不是人名
    names = {t for t in cap_mid if fold(t) not in lower_seen and fold(t) not in level_of and not t.startswith("I'")}

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
    INFL_TYPES = {"plural", "plural_rule", "past", "past_participle", "present_participle", "third_person",
                  "comparative", "superlative", "present"}
    BASE_TYPES = {"lemma", "slash", "derived_ment", "derived_suffix", "plural_usual"}
    infl_of: dict[str, list[tuple[str, set]]] = collections.defaultdict(list)
    for k in sorted(form_map):
        for i in sorted(form_map[k]):
            t = set(form_map[k][i]["types"])
            if t <= INFL_TYPES:
                infl_of[k].append((i, t))

    def homograph_conflict(k: str, eid: str) -> tuple[bool, bool]:
        """(是否有級別不高於本條目的其他條目把 k 當屈折形, 是否為需要上下文判斷的強衝突)。同字多筆的另一筆
        （measure(s) n. 的 measures 也是 measure v. 的第三人稱）不算，改由 sibling_ok 依前後文分配。"""
        e = by_id[eid]
        epos = set(e["pos"])
        base = bool(set(form_map[k][eid]["types"]) & BASE_TYPES)
        sibs = set(head_ids.get(fold(e["word"]), []))
        weak = strong = False
        for f, t in infl_of.get(k, []):
            if f == eid or f in sibs or by_id[f]["level"] > e["level"]:
                continue
            weak = True
            if not base or epos & {"prep.", "conj."} or t & {"plural", "plural_rule"}:
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

    # 屈折形被別筆當原形（反方向的同形異詞）：本條目的屈折形同時是另一筆的原形或變體，例如 wed 的 wedding（婚禮 n.）、
    # bore 的 bored／boring（形容詞條目）、grind 的 ground（地面）、clothe 的 clothes、bind 的 bound、excite 的 excited、
    # build 的 building、find 的 found。只靠這種詞形命中的句子，要前後文顯示確實是本條目的屈折用法才採用：
    #   -ing：前一個字是 by／without／avoid／keep／stop 這類接動名詞的字；或是 be 動詞（is building），但對方是
    #         形容詞條目時不算（is interesting、is boring 是形容詞）
    #   過去式／過去分詞：前一個字是主詞代名詞、人名或 have 類（I found、Tom married、had bound）
    #   第三人稱單數：前一個字是 he／she／it／who／which／that 或人名（he measures）
    #   複數：前一個字是數字或數量詞（two glasses）
    #   比較級／最高級：不採用（good 的 better／best 自己是條目）
    SUBJECTS = set("i you he she it we they who which that".split())
    SUBJ_3SG = set("he she it who which that this".split())
    HAVE_CUES = set("have has had 've 'd i've you've we've they've i'd you'd he'd she'd we'd they'd haven't "
                    "hasn't hadn't never just already".split())
    GERUND_CUES = set("by without avoid avoids avoided avoiding enjoy enjoys enjoyed keep keeps kept stop stops "
                      "stopped start starts started begin begins began finish finishes finished mind quit consider "
                      "considered suggest suggested practice practiced".split())
    NUMBER_CUES = set("two three four five six seven eight nine ten twenty hundred thousand some many few several "
                      "these those both all various numerous".split())

    def shadow_ok(norms, toks, i, types_here, others_pos) -> bool:
        prev = norms[i - 1] if i > 0 else ""
        prev2 = norms[i - 2] if i > 1 else ""
        # 人名當主詞（Tom married…）；前面還有限定詞的大寫字是專有形容詞（the African ground squirrel）
        is_name = i > 0 and toks[i - 1] in names and prev2 not in DETERMINERS
        if prev2 in BE_FORMS and prev in SUBJECTS:      # 問句 are you scared、were they surprised：形容詞
            return False
        if "present_participle" in types_here:
            if prev in GERUND_CUES:
                return True
            if "adj." not in others_pos and (prev in BE_FORMS or prev.endswith(("'m", "'re"))
                                              or prev in S_CONTRACTIONS):
                return True
        if types_here & {"past", "past_participle", "present"} and (prev in SUBJECTS or prev in HAVE_CUES or is_name):
            return True
        if "third_person" in types_here and (prev in SUBJ_3SG or is_name):
            return True
        if types_here & {"plural", "plural_rule"} and (prev in NUMBER_CUES or prev[:1].isdigit()):
            return True
        return False

    # 同字多筆（03 文件 §6.3）：兩筆共用同一個詞形，依前後文把每次出現分給詞類相符的那一筆，不再兩筆共用同一句。
    # 規則只針對這 9 組 18 筆，寫在 sibling_ok：
    #   backward／downward／forward／outward／upward：前面是限定詞或所有格（a backward step、the upward trend）才算
    #     形容詞那筆，其餘（go backward、look forward to）算副詞那筆；forward adj./n./v. 另收動詞用法（please forward）
    #   medium：後面接名詞（medium size）或「be＋medium」結尾才算 adj.，其餘算 medium/media n.
    #   content：後面接反身代名詞（content oneself with）或前面是 to／助動詞才算動詞 content(ment)，加上 contentment；
    #     其餘（be content with、the content of）算 content n./adj.
    #   measure：measured／measuring／measurement、或前面是主詞／to／助動詞的 measure(s) 算 measure(ment) v.；
    #     其餘（safety measures、a measure of）算 measure(s) n.
    #   capital：capital(ism) n. 4 只收 capitalism，或中文翻譯是「資本／資金」的 capital；capital n./adj. 2 全收
    FUNCTION_NEXT = set("is are was were be been am and or but nor of in on at to for with by from into onto than as "
                        "so that which who whom not it this these those the a an his her their its our my your".split())
    REFLEXIVE = set("oneself myself yourself himself herself itself ourselves yourselves themselves".split())

    def sibling_ok(eid, norms, toks, i, k, zh) -> bool:
        e = by_id[eid]
        w = fold(e["word"])
        prev = norms[i - 1] if i > 0 else ""
        nxt = norms[i + 1] if i + 1 < len(norms) else ""
        poss = prev.endswith("'s") and prev not in S_CONTRACTIONS
        det = prev in DETERMINERS or poss
        is_name = i > 0 and toks[i - 1] in names
        if w in ("backward", "downward", "forward", "outward", "upward"):
            if e["pos"] == ["adv."]:
                return k != w or not det
            if k == w and det:
                return True
            if "v." in e["pos"]:                     # forward adj./n./v.
                if k in ("forwarded", "forwarding") or (k == w and (prev in VERB_CUES or prev in SUBJECTS)):
                    return True
                if k == "forwards" and (prev in SUBJ_3SG or is_name):
                    return True
            return k == w and prev in LINKERS and nxt == ""   # the country is backward.
        if w == "medium":
            adj_cue = k == "medium" and ((nxt and nxt.isalpha() and nxt not in FUNCTION_NEXT)
                                         or (prev in LINKERS and nxt == ""))
            return adj_cue if "adj." in e["pos"] else not adj_cue
        if w == "content":
            verb_cue = (k in ("content", "contents") and (nxt in REFLEXIVE or prev in VERB_CUES)) \
                or (k == "contents" and (prev in SUBJ_3SG or is_name))
            if "v." in e["pos"]:
                return verb_cue or k in ("contentment", "contentments", "contented", "contenting")
            return not verb_cue
        if w == "measure":
            verb_cue = k in ("measured", "measuring") \
                or (k == "measure" and (prev in VERB_CUES or prev in SUBJECTS)) \
                or (k == "measures" and (prev in SUBJ_3SG or is_name))
            if "v." in e["pos"]:
                return verb_cue or k in ("measurement", "measurements")
            return not verb_cue
        if w == "capital":
            if "adj." in e["pos"]:
                return True
            return k in ("capitalism", "capitalisms") or any(t in zh for t in ("資本", "資金", "本錢", "資產", "本金"))
        return True

    OBJ_START = DETERMINERS | set("me you him her it us them this that".split())

    def infinitive_to(norms, i) -> bool:
        """to prep. 的例句排除不定詞：to 後面是第一詞類為動詞的條目原形（to be、to get、to play），或是兼作動詞、
        後面又直接接受詞的字（to park your car、to answer the phone）。"""
        nxt = norms[i + 1] if i + 1 < len(norms) else ""
        nxt2 = norms[i + 2] if i + 2 < len(norms) else ""
        ents = [by_id[j] for j in word_entries.get(nxt, [])]
        if any(x["pos"][0] in ("v.", "aux.") for x in ents):
            return True
        return nxt2 in OBJ_START and any("v." in x["pos"] for x in ents)

    homograph_stats = collections.Counter()
    homograph_examples: dict[str, int] = {}
    shadow_examples: dict[str, int] = {}
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
        siblings = [i for i in head_ids.get(hw, []) if i != eid]
        shadowed: dict[str, tuple[set, set]] = {}
        for k in tforms:
            mine_t = set(form_map[k][eid]["types"])
            if mine_t & (BASE_TYPES | {"pronoun_case"}):
                continue
            others = (set(word_entries.get(k, [])) | pron_of[k]) - {eid} - set(siblings)
            if others:
                shadowed[k] = (mine_t, set().union(*(set(by_id[o]["pos"]) for o in others)))
        if shadowed:
            homograph_stats["shadow_entries"] += 1
        # 偏好詞形：(s) 常用複數、(ism) 衍生；同字多筆時，只屬於本條目的斜線變體（backwards 之於 backward adv.）
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
            bad = [m.group(0) for m in SENSITIVE_RE.finditer(eng[sid][0])]
            if bad and any(not set(fold(t) for t in tokenize(b)) & tset for b in bad):
                homograph_stats["sensitive_dropped"] += 1
                continue
            toks = sent_tokens[sid]
            zh_src = cmn[c][0]
            passed = []
            for i in pos_t:
                k = norms[i]
                if siblings and not sibling_ok(eid, norms, toks, i, k, conv(zh_src)):
                    continue
                if eid == "to|prep.|1" and infinitive_to(norms, i):
                    continue
                if k in shadowed and not shadow_ok(norms, toks, i, *shadowed[k]):
                    continue
                passed.append(i)
            if not passed:
                reason = ("sibling_dropped" if siblings else "to_infinitive_dropped" if eid == "to|prep.|1"
                          else "shadow_dropped")
                homograph_stats[reason] += 1
                if reason == "shadow_dropped":
                    shadow_examples[eid] = shadow_examples.get(eid, 0) + 1
                continue
            pos_t = passed
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
            if reused and siblings:               # 同字多筆不共用同一句
                homograph_stats["sibling_dropped"] += 1
                continue
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

    # forms-index：同一鍵對應多筆時依（級別、extra_pos 在後、原形／變體在前、entry_id）排序，所以 evening 先列
    # evening n. 再列 even 的 -ing、interesting 先列 interesting adj.；saw、found 仍先列級別較低的 see、find。
    findex = {}
    base_t = {"lemma", "slash", "derived_ment", "derived_suffix", "plural_usual", "pronoun_case"}
    for k in sorted(set(form_map) | set(extra_map)):
        recs = [(i, r, False) for i, r in form_map.get(k, {}).items()] + \
               [(i, r, True) for i, r in extra_map.get(k, {}).items()]
        lst = []
        for i, r, extra in sorted(recs, key=lambda t: (by_id[t[0]]["level"], t[2],
                                                       not (set(t[1]["types"]) & base_t), t[0])):
            d = {"entry_id": i, "types": sorted(r["types"])}
            if r["bases"]:
                d["base"] = sorted(r["bases"])
            if extra:
                d["extra_pos"] = True
            lst.append(d)
        findex[k] = lst
    meta = {
        "description": "詞形 → 詞彙表條目。鍵為正規化詞形（小寫、彎引號轉 '、去重音，保留句點與連字號）。"
                       "同形對應多筆時全部列出（排序方式見最後）。types：lemma＝條目主要詞形；slash／derived_ment／"
                       "derived_suffix／plural_usual／pronoun_case＝原表的變體；plural／past／past_participle／"
                       "present_participle／third_person／comparative／superlative＝ECDICT exchange 的屈折形"
                       "（base 表示是某個變體的屈折形）；present／past 另含 be、can、will 等 ECDICT 沒列的不規則形；"
                       "plural_rule＝ECDICT 沒列複數的名詞依規則產生、且在 Tatoeba 英文句出現至少 "
                       f"{PLURAL_MIN_ATTEST} 次的複數。屈折形只收條目詞類能產生的（名詞才有複數、動詞才有時態變化、"
                       "形容詞與副詞才有比較級）；extra_pos=true 表示 ECDICT 列出、但不屬於大考詞彙表所列詞類的屈折形"
                       "（例如名詞 angle 的 angled），只供詞形還原，不是條目的詞形變化。同鍵多筆依級別、非 extra_pos、"
                       "原形或變體優先排序。",
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

    homograph_stats["rule_plurals"] = rule_plurals
    audits = audit(out_entries, findex, entries)
    LAST_AUDIT[:] = audits
    for a in audits:
        if a["hard"] and a["count"]:
            log(f"AUDIT FAIL: {a['name']}: {a['count']} " + "; ".join(a["examples"][:3]))
    extra = {"form_stats": form_stats, "extra_pos_pairs": sum(len(v) for v in extra_map.values()),
             "rule_plural_rejected": rule_plural_rejected, "rule_rejected_examples": sorted(rule_rejected_examples),
             "shadow_examples": shadow_examples, "audits": audits}
    report = report_md(out_entries, findex, sources, conv, tstats, ipa_issues, ipa_examples, fam_edges,
                       fam_sizes, files, set(oewn_any), homograph_stats, homograph_examples, extra)
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
- 授權：MIT License。修改：中文以 OpenCC s2twp 轉成台灣繁體，再以本專案的對照表（`tools/build_vocab.py` 的 `TW_PHRASES`，例如 土豆→馬鈴薯、计算机→電腦、声明→聲明）補正、刪除轉換後重複的義項；音標字元統一為 IPA（ә→ə、є→ɛ、g→ɡ、'→ˈ、:→ː 等）；屈折形只保留條目詞類能產生的形式；只取詞彙表需要的列與欄。
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
- 修改：中文句用 OpenCC s2twp 轉成台灣繁體；原文是簡體的句子另以 `TW_PHRASES` 補正大陸用語，所有句子再把日文新字體或異體字（髪、説、産…）與「箇」換成台灣通行字（`zh_converted = true` 表示文字有變動），應標示「中文經轉換為台灣繁體」。
- 不使用 Tatoeba 音檔（音檔授權依錄音者而定）。

## 5. CEFR-J Wordlist 與 Octanove Vocabulary Profile

- 欄位：`cefr`（`source` 標示來自 CEFR-J 1.6 或 Octanove C1/C2 1.0）。
- CEFR-J（A1–B2）來源：{dl("cefrj")}
  - 條件：可免費用於研究與商業用途，但必須依指定格式引用（Ver1.6 活頁簿 README 工作表：「The citation should be made as follows: The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http:XXX on dd/mm/yy.」）。本專案的引用（日期依指定的 dd/mm/yy）：
    The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on {cefr_date.strftime("%d/%m/%y")}.
  - 日文格式（同一份 README 的「引用の仕方」）：『CEFR-J Wordlist Version 1.6』 東京外国語大学投野由紀夫研究室. （URL: https://www.cefr-j.org/download.html より{cefr_date.year}年{cefr_date.month}月ダウンロード）
  - 商用時的附帶條件（同一份 README 免責事項 2）：商用且需要監修等服務時，另行洽談並支付必要費用。
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
| wordnet | OEWN 2025（`in_list`、`level`、`entry_ids` 由本專案比對詞彙表） | CC BY 4.0（標示 Princeton WordNet 與 OEWN） |
| family, family_id | 本專案計算（詞彙表＋OEWN derivation） | CC BY 4.0 部分 |
| examples | Tatoeba | CC BY 2.0 FR／CC0（逐句標示） |
| cefr | CEFR-J 1.6／Octanove C1–C2 | CEFR-J 條款／CC BY-SA 4.0 |
| cambridge_url | 連結（本專案產生） | — |
"""


# ---------------------------------------------------------------------------
# 報告
# ---------------------------------------------------------------------------
AUDIT_BRAND_RE = re.compile(r"collins|oxford|longman|merriam|webster|lexile|cambridge", re.I)
AUDIT_SKIP_KEYS = {"cambridge_url"}        # 外部辭典連結（03 文件 §9.4、04 文件 §2.2 允許外連），不是品牌標籤欄位


def audit(out: list[dict], findex: dict, entries: list[dict]) -> list[dict]:
    """對輸出做全量自動查核。hard=True 的項目必須是 0，否則 `check` 失敗。"""
    res = []

    def add(name, bad, hard=True, note=""):
        res.append({"name": name, "count": len(bad), "examples": bad[:8], "hard": hard, "note": note})

    # entry_id：唯一、且等於「word|詞類|級別」（由原表內容組成，重排或重新解析不會改變）
    ids = [o["entry_id"] for o in out]
    add("entry_id 重複", sorted(i for i, n in collections.Counter(ids).items() if n > 1))
    add("entry_id 不等於 word|pos|level", [o["entry_id"] for o, e in zip(out, entries)
                                           if o["entry_id"] != f"{e['word']}|{'/'.join(e['pos'])}|{e['level']}"])
    # 漢字：不在 Big5（cp950）的字多半是殘留的簡體字或日文新字體
    def strings(o):
        for z in o["zh"]:
            yield z["text"]
            if z.get("domain"):
                yield z["domain"]
        for v in o.get("variant_info", []):
            yield from v["zh"]
        for x in o["examples"]:
            yield x["zh"]
    nonbig5 = collections.Counter()
    for o in out:
        for t in strings(o):
            for ch in t:
                if ("㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿") and ch not in NON_BIG5_OK:
                    try:
                        ch.encode("cp950")
                    except UnicodeEncodeError:
                        nonbig5[ch] += 1
    add("中文欄位含 Big5 以外的漢字（殘留簡體或日文字形）", [f"{c}×{n}" for c, n in nonbig5.most_common()],
        note="例外：" + "".join(sorted(NON_BIG5_OK)))
    # IPA
    bad_ipa, leftover = [], []
    for o in out:
        for name, v in [("ipa", o["ipa"])] + [(vi["form"], vi["ipa"]) for vi in o.get("variant_info", [])]:
            if not v:
                continue
            if any(c not in IPA_OK for c in v):
                bad_ipa.append(f"{o['entry_id']} {name}={v}")
            if any(c in v for c in "әє':g"):
                leftover.append(f"{o['entry_id']} {name}={v}")
            if re.search(r"[ˈˌ]\s|[ˈˌ]$|[ˈˌ]{2}|ˌ,|\s{2}", v):
                bad_ipa.append(f"{o['entry_id']} {name}={v}（重音記號位置）")
    add("音標含白名單以外的字元或重音記號錯置", bad_ipa)
    add("音標殘留 Cyrillic ә／є 或 ASCII ' : g", leftover)
    # forms：只收條目詞類能產生的屈折形
    verb = {"past", "past_participle", "present_participle", "third_person"}
    bad_forms = []
    for o in out:
        pos = set(o["pos"]) - {"(n.)"}
        for t, f in o["forms"].items():
            if (t == "plural" and "n." not in pos) or (t in verb and "v." not in pos) or \
                    (t in ("comparative", "superlative") and not pos & {"adj.", "adv."}):
                bad_forms.append(f"{o['entry_id']} {t}={f}")
    add("forms 含條目詞類以外的屈折形", bad_forms)
    # forms-index：代名詞格不帶屈折形（mine→mined）、比較級只掛在形容詞／副詞條目
    pos_of = {o["entry_id"]: set(o["pos"]) for o in out}
    bad_fi = []
    for k, lst in findex.items():
        for d in lst:
            if d.get("extra_pos"):
                continue
            t = set(d["types"])
            if t & {"comparative", "superlative"} and not pos_of[d["entry_id"]] & {"adj.", "adv."}:
                bad_fi.append(f"{k}→{d['entry_id']} {sorted(t)}")
            if "pron." in pos_of[d["entry_id"]] and d.get("base") and t & (verb | {"plural"}):
                bad_fi.append(f"{k}→{d['entry_id']} {sorted(t)} base={d['base']}")
    add("forms-index 詞類不符的對應", bad_fi)
    # 例句：作者與 ID、含該條目詞形、授權值
    keys_of = collections.defaultdict(set)
    for k, lst in findex.items():
        for d in lst:
            if not d.get("extra_pos"):
                keys_of[d["entry_id"]].add(k)
    no_author, no_form, bad_lic = [], [], []
    for o in out:
        for x in o["examples"]:
            if not isinstance(x["tatoeba_id"], int) or not isinstance(x["zh_id"], int) \
                    or (not x["author"] and x["license"] != "CC0-1.0") \
                    or (not x["zh_author"] and x["zh_license"] != "CC0-1.0") \
                    or x["url"] != f"https://tatoeba.org/en/sentences/show/{x['tatoeba_id']}":
                no_author.append(f"{o['entry_id']} #{x['tatoeba_id']}")
            if x["license"] not in ("CC-BY-2.0-FR", "CC0-1.0") or x["zh_license"] not in ("CC-BY-2.0-FR", "CC0-1.0"):
                bad_lic.append(f"{o['entry_id']} #{x['tatoeba_id']}")
            if not {fold(t) for t in tokenize(x["en"])} & keys_of[o["entry_id"]]:
                no_form.append(f"{o['entry_id']} #{x['tatoeba_id']} {x['en']}")
    add("例句缺作者、句子 ID 或連結（CC0 例外）", no_author)
    add("例句授權值不是 CC-BY-2.0-FR／CC0-1.0", bad_lic)
    add("例句不含該條目的任何詞形", no_form)
    # WordNet：同義詞／反義詞標了 in_list 但詞類不符（ref 只在詞類相符時才給 level）
    wn_bad = []
    tag = {"n": {"n."}, "v": {"v.", "aux."}, "a": {"adj."}, "s": {"adj."}, "r": {"adv."}}
    for o in out:
        for sn in (o["wordnet"] or {}).get("senses", []):
            want = tag.get(sn["pos"], set())
            for x in sn["synonyms"]:
                if x["in_list"] and not any(want & (pos_of[i] | ({"n."} if "(n.)" in pos_of[i] else set()))
                                            for i in x["entry_ids"]):
                    wn_bad.append(f"{o['entry_id']} {x['word']}")
    add("同義詞標為詞彙表內、但詞彙表條目的詞類不同", wn_bad)
    # 欄位名稱不含品牌字樣
    keys = set()

    def walk(v):
        if isinstance(v, dict):
            for k2, v2 in v.items():
                keys.add(k2)
                walk(v2)
        elif isinstance(v, list):
            for v2 in v:
                walk(v2)
    walk(out)
    walk(findex)
    add("欄位名稱含品牌字樣（Collins、Oxford…）", sorted(k for k in keys if AUDIT_BRAND_RE.search(k)
                                                         and k not in AUDIT_SKIP_KEYS),
        note="cambridge_url 是外連欄位，不算")
    # Cambridge 連結規則
    add("cambridge_url 不符合 slug 規則", [o["entry_id"] for o in out if o["cambridge_url"] != cambridge_url(o["word"])
                                         or not re.fullmatch(r"https://dictionary\.cambridge\.org/dictionary/"
                                                             r"english-chinese-traditional/[a-z0-9-]+",
                                                             o["cambridge_url"])])
    # 軟性項目（列出供人工判斷，不讓 check 失敗）
    add("沒有音標的條目", [o["raw"] for o in out if not o["ipa"]], hard=False)
    add("中文沒有詞性相符的行、改用 fallback", [o["entry_id"] for o in out
                                             if any(z.get("fallback") for z in o["zh"])], hard=False)
    return res


def pct(n, d):
    return f"{n / d * 100:.1f}%" if d else "—"


def report_md(out, findex, sources, conv, tstats, ipa_issues, ipa_examples, fam_edges, fam_sizes, files,
              oewn_any, homograph_stats, homograph_examples, extra) -> str:
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
    tcount = collections.Counter(t for v in findex.values() for x in v for t in x["types"])
    fs = extra["form_stats"]
    w("- forms-index 各型態的（詞形, 條目）組數：" + "、".join(f"{t} {n:,}" for t, n in sorted(tcount.items())) + "。"
      f"其中 `plural_rule` 是 ECDICT 沒列複數、規則複數在 Tatoeba 英文句出現至少 {PLURAL_MIN_ATTEST} 次的 "
      f"{homograph_stats['rule_plurals']:,} 筆名詞；另有 {extra['rule_plural_rejected']:,} 筆名詞的規則複數沒有語料證據，"
      "不收（例如 " + "、".join(extra["rule_rejected_examples"][:12]) + "，多為不可數名詞或拼法錯誤）。")
    w(f"- 屈折形只收條目詞類能產生的形式：ECDICT exchange 中 {fs['pos_drop']:,} 個屈折形不屬於條目詞類（名詞 fee 的過去式 "
      f"feed、名詞 ox 的比較級 oxer、形容詞 abnormal 的複數 abnormals…），不放進 `forms`；其中可當詞形還原線索的 "
      f"{extra['extra_pos_pairs']:,} 組（例如名詞 angle 的 angled）在 forms-index 標 `extra_pos: true`，"
      "比較級／最高級、等於任何條目原形或變體的（feed、wedding、shorts）則完全不收。變體列的屈折形同樣依變體詞類過濾，"
      f"代名詞格（mine、her）不帶屈折形，共略過 {fs['variant_drop']:,} 個（原本 mined、mining、hering 會對到代名詞 I、she）。"
      f"ECDICT 的錯誤形式依 `FORM_FIXES` 修正 {fs['fixed']} 個（sheep 的複數 sheeps→sheep）。")
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
    leftovers = sorted(ch for ch in chars if ch in "\u04d9\u0454':g")
    nonipa = sorted(ch for ch in chars if ch not in IPA_OK)
    w(f"- 殘留的 Cyrillic ә／є、ASCII `'`、`:`、`g`：{'無' if not leftovers else ' '.join(leftovers)}；"
      f"白名單以外的字元：{'無' if not nonipa else ' '.join(nonipa)}。")
    w("- 對應：`ә`(U+04D9)→`ə`(U+0259)、`є`(U+0454)→`ɛ`(U+025B)、ASCII `g`→`ɡ`(U+0261)、`'`→`ˈ`、`:`→`ː`、"
      "緊接音標的 `,`／`.`→`ˌ`；`. `、`, ` 與兩段都有主重音的 `.` 視為多種讀法，輸出成 `, `。"
      "OEWN 補的發音本來就是 IPA（美式，例如 `ɹ`、`ɚ`），只做同樣的 `g`→`ɡ` 與白名單檢查。")
    w("- 只統一字元，不改標音體系：ECDICT 是舊式英式標音（`əu`、`ai`、`e`），OEWN 是美式寬式標音（`oʊ`、`aɪ`、`ɛ`），"
      "介面若要一致的體系需另行轉寫。`(r)`、`(ə)` 表示可省略的音，`-dəkt` 這類只寫出不同部分的第二讀法照原樣保留。")
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
    w(f"- 同形異詞處理：{homograph_stats['entries']} 筆條目的原形同時是另一個（級別不高於它的）條目的屈折形，"
      f"例如 saw／see、found／find、lay／lie、rose／rise、learned／learn。只靠這種詞形命中、而且前一個字無法判斷詞類的句子"
      f"不採用，共排除 {homograph_stats['sentences_dropped']:,} 句次。排除最多的條目："
      + "、".join(f"{k.split('|')[0]}（{v}）" for k, v in sorted(homograph_examples.items(), key=lambda t: (-t[1], t[0]))[:12])
      + "。規則見 `tools/build_vocab.py`。")
    w(f"- 反方向的同形異詞：{homograph_stats['shadow_entries']} 筆條目有屈折形同時是另一筆的原形或變體（wed 的 wedding、"
      "bore 的 bored／boring、grind 的 ground、clothe 的 clothes、find 的 found）。只靠這種詞形命中、而且前後文看不出是"
      f"本條目屈折用法的句子不採用，共排除 {homograph_stats['shadow_dropped']:,} 句次。排除最多的條目："
      + "、".join(f"{k.split('|')[0]}（{v}）" for k, v in sorted(extra["shadow_examples"].items(),
                                                              key=lambda t: (-t[1], t[0]))[:12]) + "。")
    w(f"- 同字多筆（§6.3 的 9 組）依前後文分配句子（`sibling_ok`），排除 {homograph_stats['sibling_dropped']:,} 句次；"
      f"`to prep.` 排除不定詞用法（to＋動詞原形）{homograph_stats['to_infinitive_dropped']:,} 句次。")
    w(f"- 內容過濾：含粗話、色情或自殘字眼（`SENSITIVE_RE`）的句子不採用，共排除 {homograph_stats['sensitive_dropped']:,} 句次"
      "（命中的字是條目本身時例外，例如 suicide、sexy 的例句）。")
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
      f"合併依據（實際造成合併的連結數）：同字多筆 {fam_edges['same_headword']}、變體等於另一筆詞形 {fam_edges['variant_is_headword']}、"
      f"OEWN 衍生類義項關係 {fam_edges['oewn_derivation']}、OEWN synset attribute {fam_edges['oewn_attribute']}。")
    w("- 規則：OEWN 連結兩端的「義項詞性」都要能代表各自條目的詞類（詞性相同，或 OEWN 標了同字轉類，例如 war n.↔war v.），"
      "而且兩個詞要有共同字首；另以黑名單排除 " + "、".join("–".join(sorted(p)) for p in sorted(FAMILY_BLOCKLIST, key=sorted))
      + "（OEWN 連到的是同形異義的少見義項）。")
    w("- 已知限制：OEWN 沒有連結的衍生詞不會成為詞族，例如 admire–admirable、except–exception（except 在詞彙表只是 prep./conj.）。"
      "曾試過用字尾規則補（-able、-ion…），但 apple–apply、corn–corner、list–listen 這類誤判太多，所以沒有採用。")
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

    w("## 9. 自動查核（全量）")
    w("")
    w("`build` 每次都對輸出做下列檢查；標「必須為 0」的項目只要不是 0，`python3 tools/build_vocab.py check` 就失敗。")
    w("")
    w("| 檢查 | 結果 | 必須為 0 | 例子／說明 |")
    w("|---|---:|---|---|")
    for a in extra["audits"]:
        ex = "；".join(a["examples"][:4]).replace("|", "\\|")
        note = a["note"]
        name = a["name"].replace("|", "\\|")
        w(f"| {name} | {a['count']:,} | {'是' if a['hard'] else '否'} | {ex}{('（' + note + '）') if note else ''} |")
    w("")
    w("- 中文用 Big5（cp950）字集檢查：台灣通行的繁體字都在 Big5 內，殘留的簡體字（们、这、说…）與日文新字體（髪、説）"
      "都不在。用 OpenCC 反向轉換（t2s 或對已轉換文字再跑一次 s2tw）比對會把 說明了→說明瞭、里約→裡約 這類正確的繁體"
      "也算成差異，所以不採用。")
    w("- 人工抽查用 `python3 tools/build_vocab.py sample --seed 20261008` 列出每級 10 筆（共 60 筆）的完整內容；每級優先"
      "抽同字多筆、斜線條目、括號條目、不規則變化與帶符號的條目各一筆，其餘隨機。")
    w("")
    w("## 10. 來源版本")
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
        failed = [a["name"] for a in LAST_AUDIT if a["hard"] and a["count"]]
        if bad:
            log("DIFFERENT: " + ", ".join(bad))
        else:
            log("identical: " + ", ".join(sorted(files)))
        if failed:
            log("AUDIT FAILED: " + "；".join(failed))
        return 1 if bad or failed else 0


def cmd_sample(args) -> int:
    """人工抽查：每級 10 筆（共 60 筆），每級優先抽同字多筆、斜線條目、括號／代名詞條目、不規則變化（2 筆）、
    帶符號（連字號、句點）的條目各一筆，其餘隨機；印出各欄位供逐項核對。只讀現有輸出，不重建。"""
    lex = []
    for name in ["lexicon.json"] + [f"lexicon-L{i}.json" for i in range(1, 7)]:
        if (VOCAB / name).exists():
            lex += json.loads((VOCAB / name).read_text(encoding="utf-8"))
    rnd = random.Random(args.seed)
    same = {"backward", "capital", "content", "downward", "forward", "measure", "medium", "outward", "upward"}

    def irregular(o):
        w = o["word"].lower()
        reg = {w + "s", w + "es", w[:-1] + "ies", w + "ed", w + "d", w[:-1] + "ied", w + w[-1:] + "ed", w + "ing",
               w[:-1] + "ing", w + w[-1:] + "ing", w[:-2] + "ying", w + "er", w + "r", w + "est", w + "st",
               w[:-1] + "ier", w[:-1] + "iest", w + w[-1:] + "er", w + w[-1:] + "est"}
        return any(f.lower() not in reg and not f.startswith(("more ", "most ")) for f in o["forms"].values())
    picks = [lambda o: o["word"] in same, lambda o: "slash-forms" in o["tags"],
             lambda o: any(t.startswith("paren") or t == "pronoun-forms" for t in o["tags"]),
             irregular, irregular, lambda o: bool(re.search(r"[-. ’]", o["word"]))]
    for lvl in range(1, 7):
        pool = [o for o in lex if o["level"] == lvl]
        rnd.shuffle(pool)
        chosen = []
        for pred in picks:
            for o in pool:
                if o not in chosen and pred(o):
                    chosen.append(o)
                    break
        for o in pool:
            if len(chosen) >= 10:
                break
            if o not in chosen:
                chosen.append(o)
        for o in chosen[:10]:
            print("=" * 100)
            print(f"[{o['entry_id']}] raw={o['raw']!r} variants={o['variants']} forms={o['forms']}")
            print(f"  ipa={o['ipa']} {o['ipa_source']}  cefr={o['cefr'] and o['cefr']['level']}  url={o['cambridge_url']}")
            for z in o["zh"]:
                print(f"  zh: {z}")
            for vi in o.get("variant_info", []):
                print(f"  variant: {vi}")
            wn_ = o["wordnet"]
            if wn_:
                print(f"  wordnet lemma={wn_['lemma']} senses={wn_['sense_count']}")
                for sn in wn_["senses"][:4]:
                    syn = ", ".join(x["word"] + (f"(L{x['level']})" if x["in_list"] else "") for x in sn["synonyms"])
                    print(f"    {sn['pos']} {sn['definition'][:70]} | {syn}")
                print(f"    antonyms={[(x['word'], x.get('level')) for x in wn_['antonyms']]} "
                      f"derivations={[(x['word'], x['level']) for x in wn_['derivations']]}")
            print(f"  family={[(f['word'], f['level']) for f in o['family']]}")
            for x in o["examples"]:
                print(f"  ex #{x['tatoeba_id']} {x['author']} {x['license']} | {x['en']} | {x['zh']} "
                      f"(#{x['zh_id']} {x['zh_author']})")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", nargs="?", default="build", choices=["fetch", "build", "check", "sample"])
    ap.add_argument("--seed", type=int, default=20261008, help="sample：亂數種子")
    ap.add_argument("--no-verify", action="store_true", help="不核對原始檔 sha256")
    ap.add_argument("--reuse-local", action="store_true",
                    help="fetch：本地檔的 sha256 和 sources.json 相同時不重新下載（只更新 sources.json 的其他欄位）")
    args = ap.parse_args()
    return {"fetch": cmd_fetch, "build": cmd_build, "check": cmd_check, "sample": cmd_sample}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
