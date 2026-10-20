#!/usr/bin/env python3
"""
PDF 字型子集化（一次性的開發工具；Vercel 建置時不會執行，建置也不需要 Python）。

產生 apps/web/src/features/pdf/fonts/ 底下的：
  NotoSerifTC-Regular.subset.ttf.gz   中文內文（試題資料出現的每個字＋題庫會印進自組卷 PDF 的字＋前端介面文字＋教育部常用國字 4,808 字）
  NotoSerifTC-Bold.subset.ttf.gz      中文標題（大題／部分標題、bold-extra.txt、src/features/pdf/ 原始碼裡的中文）
  Tinos-{Regular,Bold,Italic}.subset.ttf.gz   英文（與 Times New Roman 等寬的襯線字）
  NotoEmoji-Regular.subset.ttf.gz     單色表情符號（112 學測混合題有 😄😠🤣😍）
  metrics.json                        實際涵蓋的字元範圍、Tinos 字寬表、中文與粗體字集、版本與雜湊（前端與 build-data 的字型檢查讀這個檔）

為什麼是「TrueType＋gzip」而不是 WOFF2：PDF 引擎（pdfmake → pdfkit → fontkit）嵌入字型時要讀原始的 glyf／loca 表；
WOFF2 會直接出錯，WOFF1 每取一個字就重新解壓整個 glyf 表（整份考卷要兩分鐘）。所以存 TTF，再用 gzip 壓縮傳輸，
瀏覽器用內建的 DecompressionStream('gzip') 解開（docs/design/mock-exam-pdf.md §3）。

用法（在 repo 根目錄）：
  pip install fonttools==4.66.1           # 只有跑這個工具時需要
  npm run build:data -w @gsat/web         # 先產生 apps/web/public/data/（要掃描試題資料裡的字）
  python3 -I apps/web/scripts/fonts/subset_fonts.py --src /tmp/gsat-font-src --download

  --download 會從 fonts.gstatic.com 下載固定版本的原始字型到 --src（已存在且雜湊相符就跳過）。
  原始字型的網址與 SHA-256 寫死在下方 SOURCES；Google Fonts 改版時要一起更新這裡與 fonts/README.md。

什麼時候要重跑：build-data 的字型檢查（scripts/font-coverage.mjs）報告缺字時——通常是新的試題資料用到常用字以外的罕用字，
或 src/features/pdf/layout/strings.ts 新增了文字；題庫（本站自組模擬考）的題本缺字時，那一組會被排除在組卷池外，
重跑之後就能再用（docs/design/bank-mock.md §7.6）。題庫會印的字串由 font-coverage.mjs --print-bank-chars 提供（需要 Node）。
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

SCRIPT_DIR = Path(__file__).resolve().parent
WEB_DIR = SCRIPT_DIR.parent.parent
OUT_DIR = WEB_DIR / 'src' / 'features' / 'pdf' / 'fonts'
EXAMS_DIR = WEB_DIR / 'public' / 'data' / 'exams'
SRC_DIR = WEB_DIR / 'src'
# PDF 上的固定文字（封面、答題卷、頁首頁尾）：粗體子集會收這些檔案裡的所有中文字。
PDF_TEXT_FILES = ('features/pdf/layout/strings.ts', 'features/pdf/layout/attribution.ts')
# 由其他模組傳進 PDF 的文字（模擬考與本站自組卷的卷名、藍圖、難度名稱…），同 font-coverage.mjs 的 PDF_DYNAMIC_FILES。
# apps/web/src 底下的檔案本來就整個收進中文子集；這裡列的是 src 以外的 @gsat/shared（只收字串常值）。
SHARED_PDF_FILES = ('packages/shared/src/tiers.ts', 'packages/shared/src/writing.ts')
REPO_DIR = WEB_DIR.parent.parent
FONT_COVERAGE = WEB_DIR / 'scripts' / 'font-coverage.mjs'

# 原始字型：Google Fonts 的固定版本網址（css2 API 以非瀏覽器 User-Agent 取得的 TTF），授權皆為 SIL OFL 1.1。
SOURCES = {
    'NotoSerifTC-Regular': (
        'https://fonts.gstatic.com/s/notoseriftc/v37/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX9aMOpD.ttf',
        '2aa67c20b8cc8b929cc2ace9c0896cee033abbdfe11fe65306a5caede1cdc6ac',
    ),
    'NotoSerifTC-Bold': (
        'https://fonts.gstatic.com/s/notoseriftc/v37/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX-9N-pD.ttf',
        '3e2b71256bf380d8aaf7b7fee13aa7690b3f20326dc8815a4e6beead3f1a23e1',
    ),
    'Tinos-Regular': (
        'https://fonts.gstatic.com/s/tinos/v26/buE4poGnedXvwgX8.ttf',
        'e30f146a85623eff54453d733e5e5102fee69f07584d8ea074175a9732028be6',
    ),
    'Tinos-Bold': (
        'https://fonts.gstatic.com/s/tinos/v26/buE1poGnedXvwj1AW0Fp.ttf',
        '6ce81af2cbe9244156ee0399ae1c2e029f99ed3e64d4a0d49f5d4c59a715d743',
    ),
    'Tinos-Italic': (
        'https://fonts.gstatic.com/s/tinos/v26/buE2poGnedXvwjX-fmE.ttf',
        '129bc194acf669456c93f8fbd9786504b85bf7516cb683567e6f4396f75e2918',
    ),
    'NotoEmoji-Regular': (
        'https://fonts.gstatic.com/s/notoemoji/v65/bMrnmSyK7YY-MEu6aWjPDs-ar6uWaGWuob-r0jwv.ttf',
        '988621dc5c9a75eb6144f28faae30317a8e3421b68b28740747b3d739e2326b8',
    ),
}

# 這些範圍內、而且 Tinos 真的有字形的字元用 Tinos 排；其餘（中文、全形標點）用 Noto Serif TC。
LATIN_WANTED = [
    (0x20, 0x7E), (0xA0, 0x17F),        # ASCII、Latin-1、Latin Extended-A
    (0x2010, 0x2027), (0x2030, 0x203A),  # 連字號、破折號、引號、刪節號、‰、′″
    (0x2044, 0x2044), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x2194), (0x2212, 0x2212),
]
# 表情符號：Emoticons 區塊與幾個常見符號（112 學測混合題）。其他表情符號出現時 build-data 的字型檢查會報缺字。
EMOJI_WANTED = [(0x1F600, 0x1F64F), (0x1F910, 0x1F92F), (0x1F970, 0x1F97A), (0x2764, 0x2764), (0x1F44D, 0x1F44E), (0x1F389, 0x1F389)]
# 全形標點、符號與數字：題本與介面常用，先放進中文子集，避免日後一用就缺字。
CJK_PUNCT_EXTRA = (
    '，。、；：？！「」『』（）〔〕【】《》〈〉—…‧·・～　︰﹏＿－＋＝／＼％＆＠＃＊※○●◎□■△▲▽▼◇◆☆★→←↑↓'
    '①②③④⑤⑥⑦⑧⑨⑩❶❷❸❹❺❻❼❽❾❿ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ'
    '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ'
)
# 所有字型統一的行高比例（Times New Roman／Tinos 的上下緣）：中英混排的行才會一樣高，基線也對齊。
ASCENT_EM, DESCENT_EM = 0.891, 0.216
SUBSET_TAG = 'subset for gsat-english-center PDF'


def in_ranges(cp: int, ranges) -> bool:
    return any(a <= cp <= b for a, b in ranges)


def to_ranges(cps) -> list[list[int]]:
    out: list[list[int]] = []
    for cp in sorted(cps):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def text_file_chars(path: Path) -> set[str]:
    lines = path.read_text(encoding='utf8').splitlines()
    return set(''.join(line for line in lines if not line.startswith('#')))


def collect_exam_chars() -> tuple[set[str], set[str]]:
    """(試題資料裡的所有字元, 大題／部分標題裡的字元)。讀 build-data 的輸出，和 PDF 實際排版的資料完全相同。"""
    files = sorted(p for p in EXAMS_DIR.glob('*.json') if p.name not in ('index.json', 'score-scales.json'))
    if not files:
        sys.exit(f'找不到 {EXAMS_DIR.relative_to(WEB_DIR.parent.parent)}/*.json，請先執行 npm run build:data -w @gsat/web')
    every: set[str] = set()
    titles: set[str] = set()
    for p in files:
        exam = json.loads(p.read_text(encoding='utf8'))
        every |= set(json.dumps(exam, ensure_ascii=False))
        for s in exam['sections']:
            titles |= set(s.get('title') or '')
        for part in exam.get('parts') or []:
            titles |= set(part.get('title') or '')
    return every, titles


def strip_comments(source: str) -> str:
    """去掉 /* */ 與整行的 // 註解（PDF 固定文字檔只需要字串裡的字）。和 font-coverage.mjs 的 stripComments 相同。"""
    return re.sub(r'^\s*//.*$', '', re.sub(r'/\*[\s\S]*?\*/', '', source), flags=re.M)


def string_literal_chars(source: str) -> set[str]:
    """原始碼裡字串常值（'…'、"…"、`…`）的字，和 font-coverage.mjs 的 stringLiterals 相同。"""
    literals = re.findall(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`", strip_comments(source))
    return set(''.join(literals))


def site_paper_bold_chars() -> set[str]:
    """自組卷 PDF 的粗體字串：strings.ts 的 SITE_PAPER_BOLD 與藍圖的大題標題、部分名稱（同 font-coverage.mjs 的 sitePaperBoldText）。"""
    strings = strip_comments((SRC_DIR / 'features/pdf/layout/strings.ts').read_text(encoding='utf8'))
    block = re.search(r'export const SITE_PAPER_BOLD = \{([\s\S]*?)\} as const;', strings)
    chars = string_literal_chars(block.group(1)) if block else set()
    blueprint = SRC_DIR / 'features/mock/bank/blueprint.ts'
    if blueprint.exists():
        for m in re.finditer(r"\b(?:title|part):\s*'([^'\n]*)'", strip_comments(blueprint.read_text(encoding='utf8'))):
            chars |= set(m.group(1))
    return chars


def collect_bank_chars() -> dict[str, set[str]]:
    """題庫會印進自組卷 PDF 的字（題本、解析、資料來源），由 font-coverage.mjs 依同一套規則從 public/data 取出。"""
    out = subprocess.run(['node', str(FONT_COVERAGE), '--print-bank-chars'], capture_output=True, text=True, encoding='utf8')
    if out.returncode != 0:
        sys.exit(f'font-coverage.mjs --print-bank-chars 失敗：{out.stderr.strip()}')
    data = json.loads(out.stdout)
    return {k: set(data[k]) for k in ('booklet', 'explanations', 'sources')}


def collect_source_chars(root: Path) -> set[str]:
    chars: set[str] = set()
    for p in sorted(root.rglob('*')):
        # 測試檔不算：測試裡故意寫的罕用字（例如「粗體子集沒有這個字」的測資）不該被收進子集。
        if p.suffix in ('.ts', '.tsx') and p.is_file() and not re.search(r'\.test\.tsx?$', p.name):
            chars |= set(p.read_text(encoding='utf8'))
    return chars


def ensure_sources(src: Path, download: bool) -> None:
    src.mkdir(parents=True, exist_ok=True)
    for name, (url, digest) in SOURCES.items():
        path = src / f'{name}.ttf'
        if path.exists() and sha256(path.read_bytes()) == digest:
            continue
        if not download:
            sys.exit(f'{path} 不存在或雜湊不符；加上 --download 自動下載，或手動從 {url} 取得')
        print(f'下載 {name} …')
        with urllib.request.urlopen(url) as res:  # noqa: S310（固定的 https 網址）
            data = res.read()
        if sha256(data) != digest:
            sys.exit(f'{name} 的 SHA-256 與預期不符（{sha256(data)}）：Google Fonts 可能已改版，請確認授權與版本後更新 SOURCES')
        path.write_bytes(data)


def make_subset(src: Path, name: str, unicodes: set[int], features: list[str]) -> tuple[TTFont, bytes]:
    opts = subset.Options()
    opts.layout_features = features
    opts.hinting = False
    opts.desubroutinize = True
    opts.drop_tables += ['vhea', 'vmtx', 'BASE', 'STAT', 'DSIG']
    opts.name_IDs = ['*']          # 保留版權、授權與版本字串
    opts.name_languages = ['*']
    opts.notdef_outline = True
    font = TTFont(src / f'{name}.ttf')
    subsetter = subset.Subsetter(opts)
    subsetter.populate(unicodes=sorted(unicodes))
    subsetter.subset(font)
    upm = font['head'].unitsPerEm
    hhea, os2 = font['hhea'], font['OS/2']
    hhea.ascent, hhea.descent, hhea.lineGap = round(ASCENT_EM * upm), -round(DESCENT_EM * upm), 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = hhea.ascent, hhea.descent, 0
    name_table = font['name']
    for rec in name_table.names:
        if rec.nameID == 5 and SUBSET_TAG not in rec.toUnicode():
            rec.string = f'{rec.toUnicode()}; {SUBSET_TAG}'
    from io import BytesIO
    buf = BytesIO()
    font.save(buf)
    data = buf.getvalue()
    return TTFont(BytesIO(data)), data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--src', type=Path, required=True, help='原始 TTF 所在（或要下載到）的目錄，放在 repo 外')
    ap.add_argument('--download', action='store_true', help='缺少原始字型時從 fonts.gstatic.com 下載')
    args = ap.parse_args()
    ensure_sources(args.src, args.download)

    tinos_cmap = TTFont(args.src / 'Tinos-Regular.ttf').getBestCmap()
    emoji_cmap = TTFont(args.src / 'NotoEmoji-Regular.ttf').getBestCmap()
    noto_cmap = TTFont(args.src / 'NotoSerifTC-Regular.ttf').getBestCmap()
    latin = {cp for a, b in LATIN_WANTED for cp in range(a, b + 1) if cp in tinos_cmap}
    emoji = {cp for a, b in EMOJI_WANTED for cp in range(a, b + 1) if cp in emoji_cmap}

    def cjk_side(chars: set[str]) -> set[int]:
        return {ord(c) for c in chars if ord(c) >= 0x20 and ord(c) not in latin and ord(c) not in emoji}

    exam_chars, title_chars = collect_exam_chars()
    bank = collect_bank_chars()
    bank_chars = bank['booklet'] | bank['explanations'] | bank['sources']
    ui_chars = collect_source_chars(SRC_DIR)
    shared_chars: set[str] = set()
    for rel in SHARED_PDF_FILES:
        shared_chars |= string_literal_chars((REPO_DIR / rel).read_text(encoding='utf8'))
    site_bold = site_paper_bold_chars()
    # PDF 固定文字只放在這兩個檔案（見 strings.ts 檔頭）；不掃整個 features/pdf/，註解裡的字不該進粗體子集。
    pdf_ui_chars: set[str] = set()
    for rel in PDF_TEXT_FILES:
        pdf_ui_chars |= set(strip_comments((SRC_DIR / rel).read_text(encoding='utf8')))
    moe = text_file_chars(SCRIPT_DIR / 'moe-common-4808.txt')
    if len({c for c in moe if not c.isspace()}) != 4808:
        sys.exit('moe-common-4808.txt 應該剛好有 4,808 個字')
    bold_extra = text_file_chars(SCRIPT_DIR / 'bold-extra.txt')

    regular_cps = cjk_side(exam_chars | bank_chars | ui_chars | shared_chars | moe | set(CJK_PUNCT_EXTRA))
    bold_cps = cjk_side(title_chars | bold_extra | pdf_ui_chars | site_bold | set(CJK_PUNCT_EXTRA))
    # 只對「會印在 PDF 上」的字警告（介面原始碼裡的國際音標等不會進 PDF）。
    printed = cjk_side(exam_chars | bank_chars | pdf_ui_chars | moe)
    missing = sorted(cp for cp in printed if cp not in noto_cmap and not chr(cp).isspace())
    if missing:
        print('警告：Noto Serif TC 沒有這些字（PDF 會顯示成方框）：' + ''.join(chr(cp) for cp in missing))
        for name, chars in bank.items():
            gone = sorted(cp for cp in cjk_side(chars) if cp not in noto_cmap and not chr(cp).isspace())
            if gone:
                print(f'  其中題庫的{ {"booklet": "題本", "explanations": "解析", "sources": "資料來源"}[name] }：' + ''.join(chr(cp) for cp in gone))

    plan = [
        ('NotoSerifTC-Regular', regular_cps, ['kern', 'palt']),
        ('NotoSerifTC-Bold', bold_cps, ['kern', 'palt']),
        ('Tinos-Regular', latin, ['kern', 'liga']),
        ('Tinos-Bold', latin, ['kern', 'liga']),
        ('Tinos-Italic', latin, ['kern', 'liga']),
        ('NotoEmoji-Regular', emoji, []),
    ]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta_fonts = {}
    subsets: dict[str, TTFont] = {}
    for name, cps, features in plan:
        font, ttf = make_subset(args.src, name, cps, features)
        gz = gzip.compress(ttf, compresslevel=9, mtime=0)
        file = f'{name}.subset.ttf.gz'
        (OUT_DIR / file).write_bytes(gz)
        subsets[name] = font
        version = str(font['name'].getName(5, 3, 1, 0x409))
        meta_fonts[name] = {
            'file': file,
            'family': str(font['name'].getName(1, 3, 1, 0x409)),
            'version': version,
            'license': 'SIL Open Font License 1.1',
            'source_url': SOURCES[name][0],
            'source_sha256': SOURCES[name][1],
            'sha256': sha256(gz),
            'glyphs': font['maxp'].numGlyphs,
            'codepoints': len(font.getBestCmap()),
            'ttf_bytes': len(ttf),
            'gzip_bytes': len(gz),
        }
        print(f'{file:40s} {len(ttf) / 1024:8.1f} KB TTF  {len(gz) / 1024:8.1f} KB gzip  glyphs={font["maxp"].numGlyphs}')

    tinos = subsets['Tinos-Regular']
    upm = tinos['head'].unitsPerEm
    hmtx = tinos['hmtx'].metrics
    advance = {str(cp): round(hmtx[g][0] * 1000 / upm) for cp, g in sorted(tinos.getBestCmap().items())}
    latin_actual = set(tinos.getBestCmap())
    for other in ('Tinos-Bold', 'Tinos-Italic'):
        if set(subsets[other].getBestCmap()) != latin_actual:
            sys.exit(f'{other} 的字元集合和 Tinos-Regular 不同')
    bold_cjk = ''.join(chr(cp) for cp in sorted(subsets['NotoSerifTC-Bold'].getBestCmap()) if cp not in latin_actual)
    # 中文子集實際有字形的字（不含拉丁字母與表情符號）：前端用它判斷解析能不能印（fontRuns.ts 的 missingGlyphs，bank-mock §7.4）。
    regular_cjk = ''.join(chr(cp) for cp in sorted(subsets['NotoSerifTC-Regular'].getBestCmap()) if cp not in latin_actual and cp >= 0x20)
    metrics = {
        'generated_by': 'apps/web/scripts/fonts/subset_fonts.py',
        'note': '由 subset_fonts.py 產生，請勿手改。latinRanges／emojiRanges 決定每個字元用哪個字型（src/features/pdf/fontRuns.ts）。',
        'lineMetrics': {'ascent': ASCENT_EM, 'descent': DESCENT_EM},
        'latinRanges': to_ranges(latin_actual),
        'emojiRanges': to_ranges(set(subsets['NotoEmoji-Regular'].getBestCmap())),
        'boldCjk': bold_cjk,
        'regularCjk': regular_cjk,
        'tinosAdvance': advance,
        'fonts': meta_fonts,
    }
    (OUT_DIR / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    total = sum(f['gzip_bytes'] for f in meta_fonts.values())
    print(f'合計 gzip {total / 1024 / 1024:.2f} MB；中文內文 {len(regular_cps)} 字、粗體 {len(bold_cps)} 字；輸出到 {OUT_DIR}')


if __name__ == '__main__':
    main()
