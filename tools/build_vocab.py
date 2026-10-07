#!/usr/bin/env python3
"""WIP — fetch stage only (build stage written next)."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import os
import random
import ssl
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data/raw/vocab-sources"
VOCAB = ROOT / "data/vocab"
SOURCES_JSON = VOCAB / "sources.json"
USER_AGENT = "gsat-english-center-vocab-pipeline/1.0 (+https://github.com/; educational, non-commercial)"

ECDICT_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
OEWN_TAG_COMMIT = "dc343f2683279ecbb13fab4e2fd778d7b162d287"
OLP_COMMIT = "d4e45b75b38f27b30dfc5c44d8c571aec7e7092f"
TATOEBA = "https://downloads.tatoeba.org/exports/per_language"

SOURCES = [
    # --- ECDICT (MIT) ---
    dict(id="ecdict", group="ecdict", file="ecdict/ecdict.csv",
         url=f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_COMMIT}/ecdict.csv",
         version=f"git {ECDICT_COMMIT}", license="MIT"),
    dict(id="ecdict-license", group="ecdict", file="ecdict/LICENSE",
         url=f"https://raw.githubusercontent.com/skywind3000/ECDICT/{ECDICT_COMMIT}/LICENSE",
         version=f"git {ECDICT_COMMIT}", license="MIT"),
    # --- Open English WordNet 2025 (CC BY 4.0) ---
    dict(id="oewn", group="oewn", file="oewn/english-wordnet-2025-json.zip",
         url="https://en-word.net/static/english-wordnet-2025-json.zip",
         version=f"2025 Edition (released 2025-12-31; git tag 2025-edition {OEWN_TAG_COMMIT})",
         license="CC-BY-4.0"),
    dict(id="oewn-license", group="oewn", file="oewn/LICENSE.md",
         url="https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/LICENSE.md",
         version="git tag 2025-edition", license="CC-BY-4.0"),
    dict(id="oewn-wndb-license", group="oewn", file="oewn/WNDB_License.txt",
         url="https://raw.githubusercontent.com/globalwordnet/english-wordnet/2025-edition/WNDB_License.txt",
         version="git tag 2025-edition", license="WordNet-3.0"),
    # --- Tatoeba (CC BY 2.0 FR / CC0) ---
    dict(id="tatoeba-eng", group="tatoeba", file="tatoeba/eng_sentences_detailed.tsv.bz2",
         url=f"{TATOEBA}/eng/eng_sentences_detailed.tsv.bz2", version="weekly export",
         license="CC-BY-2.0-FR"),
    dict(id="tatoeba-cmn", group="tatoeba", file="tatoeba/cmn_sentences_detailed.tsv.bz2",
         url=f"{TATOEBA}/cmn/cmn_sentences_detailed.tsv.bz2", version="weekly export",
         license="CC-BY-2.0-FR"),
    dict(id="tatoeba-links", group="tatoeba", file="tatoeba/eng-cmn_links.tsv.bz2",
         url=f"{TATOEBA}/eng/eng-cmn_links.tsv.bz2", version="weekly export",
         license="CC-BY-2.0-FR"),
    dict(id="tatoeba-eng-cc0", group="tatoeba", file="tatoeba/eng_sentences_CC0.tsv.bz2",
         url=f"{TATOEBA}/eng/eng_sentences_CC0.tsv.bz2", version="weekly export",
         license="CC0-1.0"),
    dict(id="tatoeba-cmn-cc0", group="tatoeba", file="tatoeba/cmn_sentences_CC0.tsv.bz2",
         url=f"{TATOEBA}/cmn/cmn_sentences_CC0.tsv.bz2", version="weekly export",
         license="CC0-1.0"),
    # --- CEFR-J Wordlist 1.6 (official) + OLP (CEFR-J 1.5 CSV, Octanove C1–C2) ---
    dict(id="cefrj", group="cefrj", file="cefrj/CEFRJ_wordlist_ver1.6.zip",
         url="https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip",
         version="CEFR-J Wordlist Version 1.6 (2020-03-24)", license="CEFR-J (research & commercial use with acknowledgement)"),
    dict(id="olp-cefrj", group="cefrj", file="cefrj/cefrj-vocabulary-profile-1.5.csv",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/cefrj-vocabulary-profile-1.5.csv",
         version=f"olp-en-cefrj git {OLP_COMMIT}", license="CEFR-J (research & commercial use with acknowledgement)"),
    dict(id="octanove", group="cefrj", file="cefrj/octanove-vocabulary-profile-c1c2-1.0.csv",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/octanove-vocabulary-profile-c1c2-1.0.csv",
         version=f"Octanove Vocabulary Profile C1/C2 1.0 (olp-en-cefrj git {OLP_COMMIT})", license="CC-BY-SA-4.0"),
    dict(id="olp-readme", group="cefrj", file="cefrj/olp-README.md",
         url=f"https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/{OLP_COMMIT}/README.md",
         version=f"olp-en-cefrj git {OLP_COMMIT}", license="(documentation)"),
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def _ssl_context() -> ssl.SSLContext:
    ctx = None
    for var in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        p = os.environ.get(var)
        if p and os.path.exists(p):
            ctx = ssl.create_default_context(cafile=p)
            break
    if ctx is None:
        ctx = ssl.create_default_context()
    if hasattr(ssl, "VERIFY_X509_STRICT"):
        ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return ctx


def http_get(url: str, dest: Path, *, retries: int = 6, base_delay: float = 2.0,
             timeout: float = 180.0) -> dict:
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
            if e.code in (403, 404, 407, 410):
                raise
        except (urllib.error.URLError, http.client.HTTPException, OSError, TimeoutError) as e:
            last = f"{type(e).__name__}: {e}"
        finally:
            if tmp and os.path.exists(tmp):
                os.unlink(tmp)
    raise RuntimeError(f"giving up on {url}: {last}")


def cmd_fetch(args):
    today = dt.date.today().isoformat()
    out = []
    for s in SOURCES:
        dest = RAW / s["file"]
        log(f"GET {s['url']}")
        meta = http_get(s["url"], dest)
        out.append(dict(s, retrieved_at=today, **meta))
        log(f"  -> {dest.relative_to(ROOT)} {meta['bytes']} bytes sha256={meta['sha256'][:12]}…")
    doc = {"description": "vocab pipeline sources", "sources": out}
    SOURCES_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch"])
    a = ap.parse_args()
    cmd_fetch(a)
