#!/usr/bin/env python3
"""從大考中心「答對率及鑑別度表」與「選擇題選項分析」抽出英文科逐題統計，並與題本 JSON 對照。

用法（在專案根目錄）：
    python3 tools/extract_item_stats.py            # 寫入 data/exams/item-stats.json 與 docs/analysis/item-stats-report.md
    python3 tools/extract_item_stats.py --check    # 只跑一遍並印出摘要，不寫檔

輸入：
    data/exams/manifest.json 中 subkind 為 pd_table（各科答對率及鑑別度表）與 option_analysis
    （各科選擇題選項分析）、session 為 regular 的檔案，共 45 個考試年度（學測 91–115、指考 91–110）。
    原始檔在 data/raw/ceec/{gsat,ast}/{year}/（不進 git），讀檔前先比對 manifest 的 sha256。
    - .xls 用 xlrd 讀；各科合併檔中找出英文的表（工作表名稱含「英」，或表頭上方四列內有「英文」）。
    - gsat-91 是有文字層的 PDF，用 `pdftotext -layout` 解析。
    - ast-91 兩個 PDF 沒有文字層（Ghostscript 點陣字型，pdftotext 只得到空白），數字是以 pdftoppm
      轉圖後人工逐格抄錄，寫在本檔最後的 AST91_PD／AST91_OA 常數；程式照樣跑完所有內部檢查。
    data/exams/parsed/{gsat,ast}-{year}.json：用題號（label）對上題本，記錄大題型、題組、作答方式，並交叉比對。

輸出 data/exams/item-stats.json（json.dumps(sort_keys=True, indent=1)，重跑逐位元組相同）：
{
  "meta": {
    "schema": "item-stats/v1",
    "source": "...", "generated_by": "tools/extract_item_stats.py",
    "value_scale": "所有比率都是 0–1 的小數（原表為整數百分比 ÷ 100）；原表空白是 null",
    "column_definitions": { "P": {...}, "Ph": {...}, ... },   # 定義＋原表註腳原文與出現的考試
    "footnotes": { "<類別>": { "<註腳原文>": ["gsat-92", ...] } },
    "ground_truth_checks": [ {id, exam, selector, field, expected, found, label, pass} ],
    "counts": {...}
  },
  "exams": {
    "gsat-113": {
      "exam": "gsat", "exam_year": 113, "era": "gsat-current", "parsed_id": "gsat-113",   # era 與 tools/exam_stats.py 相同
      "examinees": {"registered": 119760, "absent": 2654, "examinees": 117106},
      "sources": {"pd_table": {path, format, sha256, method, sheet}, "option_analysis": {...}},
      "format_variants": ["..."],          # 這一年用到的格式變體代號（說明見報告）
      "items": [
        { "label": "1", "no": 1, "multi_select": false,
          "section": "vocabulary", "group": "s1g1", "mode": "single_choice", "joined": true,
          "key": "B",                       # 選項分析中標「*」的選項；多選題是排序後的陣列
          "P": 0.54, "Ph": 0.77, "Pl": 0.34, "Pa": ..., "Pb": ..., "Pc": ..., "Pd": ..., "Pe": ...,
          "T": null,                        # 多選題全對率（單選題空白）
          "D": 0.43, "D1": ..., "D2": ..., "D3": ..., "D4": ...,
          "options": {"A": {"T": 0.10, "H": 0.02, "L": 0.21}, ...},
          "omit": {"T": 0.0, "H": 0.0, "L": 0.0} }
      ]
    }
  },
  "mismatches": [ {exam, label, path, field, item_stats, parsed, detail} ],   # 與題本 JSON 不一致
  "source_checks": [ {exam, label, check, expected, found, detail} ],         # 原表內部不一致
  "gaps": [ {exam, scope, kind, detail} ]                                     # 缺漏與限制
}

多選題（學測 111–115 第 49 題，表上題號前有「*」）：P、Ph、Pl、Pa–Pe 是「得分率」不是答對率，
T 是全對率；options 是各選項被畫記的比例（各選項獨立，加總不是 100%）。

只用標準函式庫與 xlrd；pdftotext 需在 PATH 上（只有 gsat-91 用到）。
"""
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'data' / 'exams' / 'manifest.json'
PARSED = ROOT / 'data' / 'exams' / 'parsed'
OUT_JSON = ROOT / 'data' / 'exams' / 'item-stats.json'
OUT_MD = ROOT / 'docs' / 'analysis' / 'item-stats-report.md'

PD_FIELDS = ['P', 'Ph', 'Pl', 'Pa', 'Pb', 'Pc', 'Pd', 'Pe', 'T', 'D', 'D1', 'D2', 'D3', 'D4']
FIVE = ['Pa', 'Pb', 'Pc', 'Pd', 'Pe']
GROUPS = ['T', 'H', 'L']
HEADER_ALIASES = {f.lower(): f for f in PD_FIELDS}
HEADER_ALIASES['p1'] = 'Pl'          # 部分字型把 l 印成 1
NON_CHOICE_SECTIONS = {'translation', 'composition'}

COLUMN_DEFINITIONS = {
    'P': {'zh': '全體到考考生答對率', 'note': '多選題（題號前有「*」）為得分率'},
    'Ph': {'zh': '高分組答對率', 'group': '依總分排序的前 33% 考生'},
    'Pl': {'zh': '低分組答對率', 'group': '依總分排序的後 33% 考生'},
    'Pa': {'zh': '五等分組第 1 組（最高 20%）答對率'},
    'Pb': {'zh': '五等分組第 2 組答對率'},
    'Pc': {'zh': '五等分組第 3 組（中間 20%）答對率'},
    'Pd': {'zh': '五等分組第 4 組答對率'},
    'Pe': {'zh': '五等分組第 5 組（最低 20%）答對率'},
    'T': {'zh': '多選題全對率', 'note': '單選題空白（null）'},
    'D': {'zh': '鑑別度', 'formula': 'D = Ph − Pl'},
    'D1': {'zh': '五等分組鑑別度', 'formula': 'D1 = Pa − Pb'},
    'D2': {'zh': '五等分組鑑別度', 'formula': 'D2 = Pb − Pc'},
    'D3': {'zh': '五等分組鑑別度', 'formula': 'D3 = Pc − Pd'},
    'D4': {'zh': '五等分組鑑別度', 'formula': 'D4 = Pd − Pe'},
    'options': {'zh': '各選項畫記比例', 'groups': 'T＝全體到考考生、H＝高分組（前 33%）、L＝低分組（後 33%）',
                'formula': '畫記該選項人數 ÷ 該組到考人數'},
    'omit': {'zh': '未答比例', 'formula': '未畫記任一選項人數 ÷ 該組到考人數'},
    'key': {'zh': '選項分析中數字前標「*」的選項（正確或最適當的選項）'},
}

FOOTNOTE_PATTERNS = [
    ('grouping', re.compile(r'分組係依總分|依原得總分進行分組')),
    ('braille', re.compile(r'點字')),
    ('P', re.compile(r'^P\s*=')),
    ('Ph', re.compile(r'^Ph\s*=')),
    ('Pl', re.compile(r'^P[l1]\s*=')),
    ('Pa-Pe', re.compile(r'^Pa\s*[-~]\s*Pe\s*=')),
    ('T', re.compile(r'^T\s*=')),
    ('D', re.compile(r'^D\s*=')),
    ('D1-D4', re.compile(r'^D1\s*[-~]\s*D4\s*=')),
    ('multi_select_label', re.compile(r'題號前有.*(星號|\*).*(多重選擇題|多選題)')),
    ('option_groups', re.compile(r'T\s*,\s*H\s*,\s*L\s*分別')),
    ('option_rate', re.compile(r'(各選項|各答案)百分比\s*=')),
    ('omit_rate', re.compile(r'未答百分比\s*=')),
    ('key_star', re.compile(r'百分比前有.*(星號|\*)')),
    ('rounding', re.compile(r'四捨五入')),
]

# 學測 111 起詞彙表、題型改變；與 tools/exam_stats.py 的分期一致
def era_of(exam, year):
    if exam == 'ast':
        return 'ast'
    return 'gsat-current' if year >= 111 else 'gsat-legacy'


# ---------- 小工具 ----------

def norm(s):
    s = unicodedata.normalize('NFKC', s)
    return re.sub(r'\s+', ' ', s).strip()


def cell_text(v):
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else repr(v)
    return str(v)


def row_texts(sh, r):
    return [norm(cell_text(v)) for v in sh.row_values(r)]


def parse_label(v):
    """題號：'1'、' 1'、1.0、'*49'、'* 18'、全形數字、'47-1'、'47A' → (label, no, multi)。"""
    s = norm(cell_text(v))
    if not s:
        return None
    multi = s.startswith('*')
    s = s.lstrip('*').replace(' ', '')
    m = re.fullmatch(r'(\d+)(?:[-‐–](\d+)|([A-Za-z]))?', s)
    if not m:
        return None
    no = int(m.group(1))
    label = str(no) + (('-' + m.group(2)) if m.group(2) else (m.group(3).upper() if m.group(3) else ''))
    return label, no, multi


def parse_num(v):
    """'57'、' 19'、'*59'、'* 60'、57.0、'-3' → (數值或 None, 是否標星)。"""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v), False
    s = norm(str(v))
    if not s:
        return None, False
    star = '*' in s
    s = s.replace('*', '').replace(' ', '').replace('%', '')
    if not s:
        return None, star
    if not re.fullmatch(r'-?\d+(\.\d+)?', s):
        raise ValueError(f'無法解析的數值：{v!r}')
    return float(s), star


def frac(pct):
    if pct is None:
        return None
    x = round(pct / 100.0, 4)
    return 0.0 if x == 0 else x


def parse_count(s):
    s = s.replace(',', '')
    if re.fullmatch(r'\d{1,3}(\.\d{3})+', s):     # ast-100「到考人數:77.936」用句點當千分位
        s = s.replace('.', '')
    return int(float(s))


COUNT_RES = {
    'registered': re.compile(r'(?:報考|報名總|報名)人數\s*:?\s*([0-9][0-9,\.]*)'),
    'absent': re.compile(r'缺考人數\s*:?\s*([0-9][0-9,\.]*)'),
    'examinees': re.compile(r'到考人數\s*:?\s*([0-9][0-9,\.]*)'),
}


def parse_counts(text):
    out = {}
    for k, rx in COUNT_RES.items():
        m = rx.search(text)
        out[k] = parse_count(m.group(1)) if m else None
    return out if any(v is not None for v in out.values()) else None


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def label_key(label):
    m = re.match(r'(\d+)(.*)', label)
    return (int(m.group(1)), m.group(2)) if m else (10 ** 6, label)


# ---------- 註腳 ----------

def classify_footnote(text):
    t = re.sub(r'^註\s*:?\s*', '', text)
    t = re.sub(r'^\d+\s*\.\s*', '', t).strip().rstrip('.。').strip()
    for key, rx in FOOTNOTE_PATTERNS:
        if rx.search(t):
            return key, t
    return None, None


def footnotes_from_lines(lines):
    found = {}
    formula = []
    for i, line in enumerate(lines):
        key, t = classify_footnote(line)
        if key:
            found.setdefault(key, set()).add(t)
        if '得分率' in line and '=' in line and '多選題' in line:
            parts = [line]
            for j in (i - 1, i + 1, i + 2):
                if 0 <= j < len(lines) and lines[j] and classify_footnote(lines[j])[0] is None \
                        and '得分率' not in lines[j]:
                    parts.insert(0, lines[j]) if j < i else parts.append(lines[j])
            parts = [re.sub(r'^\d+\s*\.?\s*(?=[(多])', '', p_) for p_ in parts]
            formula.append(' / '.join(parts))
    if formula:
        found['multi_select_formula'] = set(formula)
    return found


def footnotes_from_book(book):
    found = defaultdict(set)
    for sh in book.sheets():
        lines = [' '.join(x for x in row_texts(sh, r) if x) for r in range(sh.nrows)]
        for k, v in footnotes_from_lines(lines).items():
            found[k] |= v
    return found


# ---------- xls：答對率及鑑別度表 ----------

def find_tables(book, is_header):
    """回傳 [(sheet, header_row, context)]；context 是表頭上方最多 4 列（不跨到前一個表頭）的文字。"""
    out = []
    for sh in book.sheets():
        prev = -1
        for r in range(sh.nrows):
            cells = row_texts(sh, r)
            if is_header(cells):
                lo = max(prev + 1, r - 4)
                ctx = ' '.join(x for rr in range(lo, r) for x in row_texts(sh, rr) if x)
                out.append((sh, r, ctx))
                prev = r
    return out


def english_table(book, is_header, what):
    cands = [t for t in find_tables(book, is_header) if '英' in t[0].name or '英文' in t[2]]
    if len(cands) != 1:
        raise RuntimeError(f'{what}：找到 {len(cands)} 個英文表')
    return cands[0]


def is_pd_header(cells):
    low = [c.lower() for c in cells]
    return '題號' in cells and 'p' in low and 'ph' in low


def parse_pd_xls(path):
    book = xlrd.open_workbook(str(path))
    sh, hr, ctx = english_table(book, is_pd_header, f'{path} 答對率表')
    header = row_texts(sh, hr)
    cols = {}
    label_col = header.index('題號')
    for c, name in enumerate(header):
        f = HEADER_ALIASES.get(name.lower())
        if f and f not in cols:
            cols[f] = c
    missing = [f for f in PD_FIELDS if f not in cols]
    if missing:
        raise RuntimeError(f'{path}：缺欄位 {missing}')
    variants = set()
    if sh.name.isdigit():
        variants.add('sheet_numeric_name')
    if len(book.sheets()) == 1:
        variants.add('pd_single_combined_sheet')
    if label_col != 0:
        variants.add('pd_label_not_first_column')
    items = []
    r = hr + 1
    while r < sh.nrows:
        raw = sh.cell_value(r, label_col)
        lab = parse_label(raw)
        if lab is None:
            break
        if isinstance(raw, float):
            variants.add('label_numeric_cell')
        elif str(raw) != str(raw).strip():
            variants.add('label_padded_space')
        if str(raw).startswith('* '):
            variants.add('label_star_space')
        if unicodedata.normalize('NFKC', str(raw)) != str(raw):
            variants.add('label_fullwidth')
        rec = {'label': lab[0], 'no': lab[1], 'multi_select': lab[2]}
        for f in PD_FIELDS:
            v, _ = parse_num(sh.cell_value(r, cols[f]))
            rec[f] = frac(v)
            if isinstance(sh.cell_value(r, cols[f]), str) and v is not None:
                variants.add('values_as_text')
        items.append(rec)
        r += 1
    # 表尾：註腳或下一個科目
    tail = ' '.join(x for rr in range(r, min(r + 3, sh.nrows)) for x in row_texts(sh, rr) if x)
    if '國文科' in tail and ('參考' in tail or '詳見' in tail):
        variants.add('notes_in_chinese_sheet')
    counts = parse_counts(ctx)
    if counts is None:
        variants.add('pd_no_examinee_header')
    return {'items': items, 'counts': counts, 'sheet': sh.name, 'variants': variants,
            'footnotes': footnotes_from_book(book)}


# ---------- xls：選擇題選項分析 ----------

def is_oa_header(cells):
    return '題號' in cells and 'A' in cells and 'B' in cells


def group_of(v):
    m = re.fullmatch(r'\d*([THL])', norm(cell_text(v)))
    return m.group(1) if m else None


def parse_oa_xls(path):
    book = xlrd.open_workbook(str(path))
    sh, hr, ctx = english_table(book, is_oa_header, f'{path} 選項分析')
    header = row_texts(sh, hr)
    label_col = header.index('題號')
    variants = set()
    if sh.name.isdigit():
        variants.add('sheet_numeric_name')
    group_col = None
    for name in ('組別', '群組'):
        if name in header:
            group_col = header.index(name)
    if group_col is None:
        for c in range(sh.ncols):
            if c != label_col and group_of(sh.cell_value(hr + 1, c)) == 'T':
                group_col = c
                break
    if group_col is None:
        raise RuntimeError(f'{path}：找不到 T/H/L 組別欄')
    omit_col = next((c for c, n in enumerate(header) if n in ('未答', 'NONE')), None)
    opt_cols = {n: c for c, n in enumerate(header) if re.fullmatch(r'[A-Z]', n)}
    star_cols = {n: c - 1 for n, c in opt_cols.items() if c - 1 >= 0 and header[c - 1] == ''
                 and c - 1 not in (label_col, group_col)}
    if star_cols:
        variants.add('star_in_separate_column')
    if 'K' in opt_cols:
        variants.add('options_to_L')
    blocks = []
    cur = None
    r = hr + 1
    while r < sh.nrows:
        g = group_of(sh.cell_value(r, group_col))
        if g is None:
            break
        if norm(cell_text(sh.cell_value(r, group_col))) == '1T':
            variants.add('group_label_1T')
        if g == 'T':
            cur = {'label': None, 'rows': {}, 'label_row': None, 'stars': set()}
            blocks.append(cur)
        if cur is None or g in cur['rows']:
            raise RuntimeError(f'{path} 第 {r + 1} 列：T/H/L 順序不對')
        lab = parse_label(sh.cell_value(r, label_col))
        if lab:
            if cur['label'] and cur['label'][0] != lab[0]:
                raise RuntimeError(f'{path} 第 {r + 1} 列：同一題出現兩個題號')
            if cur['label'] is None:
                cur['label'] = lab
                cur['label_row'] = g
        vals = {}
        for letter, c in opt_cols.items():
            v, star = parse_num(sh.cell_value(r, c))
            if letter in star_cols and norm(cell_text(sh.cell_value(r, star_cols[letter]))) == '*':
                star = True
            if star:
                cur['stars'].add(letter)
            if v is not None:
                vals[letter] = v
        omit = parse_num(sh.cell_value(r, omit_col))[0] if omit_col is not None else None
        cur['rows'][g] = {'options': vals, 'omit': omit}
        r += 1
    if any(b['label_row'] == 'H' for b in blocks):
        variants.add('label_on_H_row')
    items = finalize_oa_blocks(blocks, path)
    if any(b['label'] and b['label'][2] for b in blocks):
        variants.add('multi_select_item')
    if any(not b['stars'] for b in blocks):
        variants.add('key_star_missing')
    zero_filled = any(all(v == 0 for v in it['raw_tail']) and it['raw_tail'] for it in items.values())
    if zero_filled:
        variants.add('zero_filled_options')
    counts = parse_counts(ctx)
    return {'items': items, 'counts': counts, 'sheet': sh.name, 'variants': variants,
            'footnotes': footnotes_from_book(book)}


def finalize_oa_blocks(blocks, path):
    items = {}
    for b in blocks:
        if b['label'] is None:
            raise RuntimeError(f'{path}：有一組 T/H/L 沒有題號')
        if set(b['rows']) != set(GROUPS):
            raise RuntimeError(f'{path} 題 {b["label"][0]}：缺 T/H/L 列')
        letters = sorted(set().union(*(set(b['rows'][g]['options']) for g in GROUPS)))
        raw = {l: {g: b['rows'][g]['options'].get(l) for g in GROUPS} for l in letters}
        # 補零的欄（例如 E–J 全為 0）留到對上題本後再決定要不要保留
        tail = []
        for l in reversed(letters):
            vs = [raw[l][g] for g in GROUPS]
            if all(v == 0 for v in vs):
                tail.extend(vs)
            else:
                break
        items[b['label'][0]] = {
            'label': b['label'][0], 'no': b['label'][1], 'multi_select': b['label'][2],
            'raw_options': raw, 'raw_tail': tail,
            'omit': {g: b['rows'][g]['omit'] for g in GROUPS},
            'stars': sorted(b['stars']),
        }
    return items


# ---------- PDF（gsat-91）----------

def pdftotext(path):
    try:
        res = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, check=True)
    except FileNotFoundError:
        raise RuntimeError('需要 pdftotext（poppler-utils）才能讀 gsat-91 的 PDF')
    return res.stdout.decode('utf-8', errors='replace')


PD_LINE = re.compile(r'^\s*(\*?\s*\d+)\s+((?:-?\d+\s+){12,13}-?\d+)\s*$')


def parse_pd_pdf(path):
    text = pdftotext(path)
    lines = [norm(l) for l in text.splitlines()]
    hdr = next((l for l in lines if l.startswith('題號') and ' Ph ' in f' {l} '), None)
    if not hdr or hdr.split()[1:] != PD_FIELDS:
        raise RuntimeError(f'{path}：表頭不符 {hdr!r}')
    items = []
    for line in text.splitlines():
        m = PD_LINE.match(line)
        if not m:
            continue
        lab = parse_label(m.group(1))
        nums = [float(x) for x in m.group(2).split()]
        if len(nums) == 13:          # T 欄空白（單選題）
            nums = nums[:8] + [None] + nums[8:]
        rec = {'label': lab[0], 'no': lab[1], 'multi_select': lab[2]}
        for f, v in zip(PD_FIELDS, nums):
            rec[f] = frac(v)
        items.append(rec)
    return {'items': items, 'counts': parse_counts(' '.join(lines)), 'sheet': None,
            'variants': {'pdf_text_layer'}, 'footnotes': footnotes_from_lines(lines)}


OA_LINE = re.compile(r'^\s*(\d+)?\s*([THL])\s+((?:\*?\s*-?\d+\s*){2,})$')


def oa_rows_from_lines(lines, letters, path):
    blocks, cur = [], None
    for line in lines:
        m = OA_LINE.match(line)
        if not m:
            continue
        g = m.group(2)
        toks = re.findall(r'(\*?)\s*(-?\d+)', m.group(3))
        if len(toks) != len(letters) + 1:
            raise RuntimeError(f'{path}：選項數不符 {line!r}')
        if g == 'T':
            cur = {'label': None, 'rows': {}, 'label_row': None, 'stars': set()}
            blocks.append(cur)
        if cur is None or g in cur['rows']:
            raise RuntimeError(f'{path}：T/H/L 順序不對 {line!r}')
        if m.group(1):
            lab = parse_label(m.group(1))
            if cur['label'] and cur['label'][0] != lab[0]:
                raise RuntimeError(f'{path}：同一題出現兩個題號 {line!r}')
            cur['label'] = cur['label'] or lab
            cur['label_row'] = cur['label_row'] or g
        omit = float(toks[0][1])
        vals = {}
        for letter, (star, num) in zip(letters, toks[1:]):
            vals[letter] = float(num)
            if star:
                cur['stars'].add(letter)
        cur['rows'][g] = {'options': vals, 'omit': omit}
    return blocks


def parse_oa_pdf(path):
    text = pdftotext(path)
    lines = text.splitlines()
    hdr = next((norm(l) for l in lines if norm(l).startswith('題號') and ' A ' in f' {norm(l)} '), None)
    letters = [x for x in (hdr or '').split() if re.fullmatch(r'[A-Z]', x)]
    if letters != list('ABCDEFGHIJ'):
        raise RuntimeError(f'{path}：表頭不符 {hdr!r}')
    blocks = oa_rows_from_lines(lines, letters, path)
    variants = {'pdf_text_layer', 'zero_filled_options'}
    if any(b['label_row'] == 'H' for b in blocks):
        variants.add('label_on_H_row')
    return {'items': finalize_oa_blocks(blocks, path), 'counts': None, 'sheet': None,
            'variants': variants, 'footnotes': footnotes_from_lines([norm(l) for l in lines])}


# ---------- ast-91：人工抄錄 ----------

def parse_ast91_pd():
    items = []
    for line in AST91_PD.strip().splitlines():
        t = line.split()
        lab = parse_label(t[0])
        rec = {'label': lab[0], 'no': lab[1], 'multi_select': lab[2]}
        for f, x in zip(PD_FIELDS, t[1:]):
            rec[f] = None if x == '-' else frac(float(x))
        items.append(rec)
    return {'items': items, 'counts': dict(AST91_COUNTS), 'sheet': None,
            'variants': {'pdf_no_text_layer_manual'},
            'footnotes': footnotes_from_lines(AST91_PD_NOTES.strip().splitlines())}


def parse_ast91_oa():
    blocks, cur = [], None
    for line in AST91_OA.strip().splitlines():
        t = line.split()
        lab, g, toks = parse_label(t[0]), t[1], t[2:]
        if g == 'T':
            cur = {'label': lab, 'rows': {}, 'label_row': 'T', 'stars': set()}
            blocks.append(cur)
        if cur['label'][0] != lab[0]:
            raise RuntimeError(f'AST91_OA：題號順序不對 {line!r}')
        vals = {}
        for letter, x in zip('ABCDEFGHIJ', toks[1:]):
            vals[letter] = float(x.lstrip('*'))
            if x.startswith('*'):
                cur['stars'].add(letter)
        cur['rows'][g] = {'options': vals, 'omit': float(toks[0])}
    return {'items': finalize_oa_blocks(blocks, 'AST91_OA'), 'counts': None, 'sheet': None,
            'variants': {'pdf_no_text_layer_manual'},
            'footnotes': footnotes_from_lines(AST91_OA_NOTES.strip().splitlines())}


# ---------- 題本 ----------

def load_parsed(pid):
    path = PARSED / f'{pid}.json'
    if not path.exists():
        return None
    d = json.loads(path.read_text(encoding='utf-8'))
    index = {}
    for s in d['sections']:
        if s['type'] in NON_CHOICE_SECTIONS:
            continue
        for g in s['groups']:
            bank = g.get('options_bank')
            for q in g['questions']:
                letters = sorted(q['options']) if isinstance(q.get('options'), dict) and q['options'] \
                    else (sorted(bank) if isinstance(bank, dict) and bank else None)
                index[q['label']] = {
                    'section': s['type'], 'section_id': s['id'], 'group': g['id'], 'label': q['label'],
                    'no': q['no'], 'mode': q['mode'], 'answer': q.get('answer'),
                    'accepted_answers': q.get('accepted_answers'),
                    'scoring_exception': q.get('scoring_exception'),
                    'stats': q.get('stats') or {}, 'letters': letters,
                    'options': q.get('options') if isinstance(q.get('options'), dict) else (bank or {}),
                    'passage': (g.get('passage') or '') + '\n'.join(p.get('text') or '' for p in g.get('passage_parts') or []),
                    'figures': g.get('figures') or [],
                    'path': f"{g['id']}/{q['label']}",
                }
    return {'doc': d, 'index': index}


# ---------- 組合與檢查 ----------

def as_key_list(x):
    if x is None:
        return None
    if isinstance(x, list):
        return sorted(x)
    return [x]


def build_exam(exam, year, pd, oa, parsed, mismatches, checks, gaps):
    eid = f'{exam}-{year}'
    index = parsed['index'] if parsed else {}
    items = []
    oa_items = dict(oa['items'])
    pd_labels = [it['label'] for it in pd['items']]
    if len(set(pd_labels)) != len(pd_labels):
        raise RuntimeError(f'{eid}：答對率表題號重複')
    for lab in sorted(set(pd_labels) ^ set(oa_items), key=label_key):
        checks.append({'exam': eid, 'label': lab, 'check': 'label_sets',
                       'expected': 'both tables', 'found': 'pd_table only' if lab in pd_labels else 'option_analysis only',
                       'detail': '題號只出現在其中一張表'})
    ordered = list(pd['items']) + [
        {'label': l, 'no': oa_items[l]['no'], 'multi_select': oa_items[l]['multi_select'], **{f: None for f in PD_FIELDS}}
        for l in sorted(set(oa_items) - set(pd_labels), key=label_key)]
    for base in ordered:
        lab = base['label']
        q = index.get(lab)
        o = oa_items.get(lab)
        rec = {k: base[k] for k in ['label', 'no', 'multi_select'] + PD_FIELDS}
        if o and o['multi_select'] != base['multi_select']:
            checks.append({'exam': eid, 'label': lab, 'check': 'multi_select_flag', 'expected': base['multi_select'],
                           'found': o['multi_select'], 'detail': '兩張表的「*」多選標記不一致'})
        rec['multi_select'] = bool(base['multi_select'] or (o and o['multi_select']))
        rec['joined'] = q is not None
        rec['section'] = q['section'] if q else None
        rec['group'] = q['group'] if q else None
        rec['mode'] = q['mode'] if q else None
        # 選項：補零欄依題本選項取捨
        options, omit, key = {}, None, None
        if o:
            raw = o['raw_options']
            valid = q['letters'] if q and q['letters'] else None
            if valid is not None:
                for l in sorted(raw):
                    if l in valid:
                        options[l] = raw[l]
                    elif any(raw[l][g] for g in GROUPS):
                        checks.append({'exam': eid, 'label': lab, 'check': 'option_not_in_paper',
                                       'expected': valid, 'found': l, 'detail': '選項分析有非零比例，但題本沒有這個選項'})
                for l in valid:
                    if l not in raw:
                        checks.append({'exam': eid, 'label': lab, 'check': 'option_missing_in_analysis',
                                       'expected': l, 'found': None, 'detail': '題本有這個選項，選項分析沒有'})
            else:
                letters = sorted(raw)
                while letters and all(not raw[letters[-1]][g] for g in GROUPS):
                    letters.pop()
                options = {l: raw[l] for l in letters}
            options = {l: {g: frac(v[g]) for g in GROUPS} for l, v in options.items()}
            omit = {g: frac(o['omit'][g]) for g in GROUPS}
            stars = o['stars']
            key = None if not stars else (stars if rec['multi_select'] or len(stars) > 1 else stars[0])
            if not stars:
                detail = '選項分析沒有標「*」的選項，key 留 null'
                ans = q['answer'] if q else None
                if isinstance(ans, str) and ans in raw:
                    a = [None if raw[ans][g] is None else int(raw[ans][g]) for g in GROUPS]
                    b = [None if rec[f] is None else int(round(rec[f] * 100)) for f in ('P', 'Ph', 'Pl')]
                    detail += (f'；題本答案 {ans} 該欄 T/H/L＝{a[0]}/{a[1]}/{a[2]}，答對率表 P/Ph/Pl＝{b[0]}/{b[1]}/{b[2]}'
                               + ('（相符）' if a == b else
                                  '（差 1 個百分點以內，屬四捨五入）' if None not in a + b and max(abs(x - y) for x, y in zip(a, b)) <= 1
                                  else '（不符）'))
                checks.append({'exam': eid, 'label': lab, 'check': 'no_key_star', 'expected': '*',
                               'found': None, 'detail': detail})
        rec['options'] = options
        rec['omit'] = omit
        rec['key'] = key
        internal_checks(eid, rec, checks)
        if q:
            compare_parsed(eid, rec, q, mismatches)
        items.append(rec)
    # 題本中有、統計表沒有的小題（非選擇題）
    if parsed:
        missing = [l for l, q in index.items() if l not in {it['label'] for it in items}]
        if missing:
            modes = sorted({index[l]['mode'] for l in missing})
            gaps.append({'exam': eid, 'scope': 'item_stats', 'kind': 'non_mc_items_without_item_stats',
                         'detail': f"題本小題 {compress_labels(sorted(missing, key=label_key))}（{'、'.join(modes)}）"
                                   '不在答對率表與選項分析中；大考中心只公布非選擇題大題層級的分數分布（nonmc_score_dist）'})
    return items


def internal_checks(eid, it, checks):
    def add(check, expected, found, detail):
        checks.append({'exam': eid, 'label': it['label'], 'check': check,
                       'expected': expected, 'found': found, 'detail': detail})
    pct = lambda x: None if x is None else int(round(x * 100))  # noqa: E731
    if it['Ph'] is not None and it['Pl'] is not None and it['D'] is not None:
        if pct(it['Ph']) - pct(it['Pl']) != pct(it['D']):
            add('D=Ph-Pl', pct(it['Ph']) - pct(it['Pl']), pct(it['D']), '鑑別度不等於高低分組相減（百分點）')
    for d, (a, b) in zip(['D1', 'D2', 'D3', 'D4'], zip(FIVE, FIVE[1:])):
        if None not in (it[a], it[b], it[d]) and pct(it[a]) - pct(it[b]) != pct(it[d]):
            add(f'{d}={a}-{b}', pct(it[a]) - pct(it[b]), pct(it[d]), '五等分組鑑別度不等於相鄰兩組相減（百分點）')
    if it['key'] and not it['multi_select'] and isinstance(it['key'], str) and it['options']:
        o = it['options'].get(it['key'])
        for f, g in (('P', 'T'), ('Ph', 'H'), ('Pl', 'L')):
            if o and it[f] is not None and o[g] is not None and pct(it[f]) != pct(o[g]):
                add(f'{f}=options[key].{g}', pct(it[f]), pct(o[g]),
                    f'答對率表的 {f} 與選項分析正確選項的 {g} 列比例不同（百分點）')
    if it['options'] and not it['multi_select']:
        for g in GROUPS:
            tot = sum(pct(v[g]) or 0 for v in it['options'].values()) + (pct(it['omit'][g]) or 0)
            if abs(tot - 100) > 3:
                add(f'sum_{g}', 100, tot, f'{g} 列選項加未答的總和偏離 100% 超過 3 個百分點')


COMPARED = defaultdict(int)   # 與題本 JSON 實際比對過的欄位次數（寫進 meta.counts）


def compare_parsed(eid, it, q, mismatches):
    def add(field, mine, theirs, detail=None):
        mismatches.append({'exam': eid, 'label': it['label'], 'path': q['path'], 'field': field,
                           'item_stats': mine, 'parsed': theirs, 'detail': detail})
    same = lambda a, b: round(a, 4) == round(b, 4)  # noqa: E731
    if it['key'] is not None:
        COMPARED['key'] += 1
        mine = as_key_list(it['key'])
        ans = as_key_list(q['answer'])
        alt = sorted(set(ans or []) | set(q['accepted_answers'] or [])) if q['accepted_answers'] else None
        if ans is None or (mine != ans and mine != alt):
            exc = q['scoring_exception']
            add('key', it['key'], q['answer'],
                ('題本 scoring_exception：' + exc['type']) if exc else None)
    st = q['stats']
    for f, pf in (('P', 'correct_rate'), ('Ph', 'high_group'), ('Pl', 'low_group'),
                  ('D', 'discrimination'), ('T', 'full_correct_rate')):
        if st.get(pf) is not None:
            COMPARED[f] += 1
        if st.get(pf) is not None and it[f] is not None and not same(it[f], st[pf]):
            add(f, it[f], st[pf], f'題本 stats.{pf}')
        elif st.get(pf) is not None and it[f] is None:
            add(f, None, st[pf], f'題本 stats.{pf} 有值，原表空白')
    fg = st.get('five_groups')
    if fg is not None:
        COMPARED['five_groups'] += 1
        mine = [it[f] for f in FIVE]
        if len(fg) != 5 or any(a is None or not same(a, b) for a, b in zip(mine, fg)):
            add('five_groups', mine, fg, '題本 stats.five_groups 對 Pa–Pe')
    for g, pf in (('T', 'option_rates'), ('H', 'option_rates_high'), ('L', 'option_rates_low')):
        theirs = st.get(pf)
        if not theirs or not it['options']:
            continue
        COMPARED[f'options.{g}'] += 1
        for l in sorted(set(theirs) | set(it['options'])):
            a = it['options'].get(l, {}).get(g)
            b = theirs.get(l)
            if a is None and not b:
                continue
            if b is None and not a:
                continue
            if a is None or b is None or not same(a, b):
                add(f'options.{l}.{g}', a, b, f'題本 stats.{pf}.{l}')
    if st.get('omit_rate') is not None and it['omit'] and it['omit']['T'] is not None:
        COMPARED['omit.T'] += 1
    if st.get('omit_rate') is not None and it['omit'] and it['omit']['T'] is not None \
            and not same(it['omit']['T'], st['omit_rate']):
        add('omit.T', it['omit']['T'], st['omit_rate'], '題本 stats.omit_rate')


def parsed_field_gaps(eid, items, index, gaps):
    """題本 JSON 缺、但原表有的欄位（只回報，不改題本）。"""
    joined = [it for it in items if it['joined']]
    if not joined:
        return
    fields = [('correct_rate', lambda it: it['P']), ('high_group', lambda it: it['Ph']),
              ('low_group', lambda it: it['Pl']), ('discrimination', lambda it: it['D']),
              ('five_groups', lambda it: it['Pa']), ('option_rates', lambda it: it['options']),
              ('option_rates_high', lambda it: it['options']), ('option_rates_low', lambda it: it['options']),
              ('omit_rate', lambda it: it['omit']), ('full_correct_rate', lambda it: it['T'])]
    for pf, getter in fields:
        lacking = [it['label'] for it in joined if getter(it) not in (None, {}) and index[it['label']]['stats'].get(pf) is None]
        if lacking:
            gaps.append({'exam': eid, 'scope': 'parsed', 'kind': 'parsed_missing_field',
                         'detail': f'題本 stats.{pf} 在 {len(lacking)} 題缺值（原表有）：{compress_labels(lacking)}'})


def compress_labels(labels):
    nums = [l for l in labels if l.isdigit()]
    rest = [l for l in labels if not l.isdigit()]
    ns = sorted(int(x) for x in nums)
    out, i = [], 0
    while i < len(ns):
        j = i
        while j + 1 < len(ns) and ns[j + 1] == ns[j] + 1:
            j += 1
        out.append(f'{ns[i]}–{ns[j]}' if j > i else str(ns[i]))
        i = j + 1
    return '、'.join(out + rest)


# ---------- 對照官方評論（docs/research/08-exam-commentary.md） ----------

def key_text(it, q):
    if not q or not isinstance(it['key'], str):
        return None
    return (q['options'] or {}).get(it['key'])


GROUND_TRUTH = [
    # id, exam, selector, field, expected
    ('113-promises', 'gsat-113', {'key_text': 'promises'}, 'P', 0.15),
    ('114-graced', 'gsat-114', {'key_text': 'graced'}, 'P', 0.23),
    ('115-grave', 'gsat-115', {'key_text': 'grave'}, 'P', 0.24),
    ('111-31', 'gsat-111', {'label': '31'}, 'P', 0.63),
    ('111-32', 'gsat-111', {'label': '32'}, 'P', 0.45),
    ('111-33', 'gsat-111', {'label': '33'}, 'P', 0.47),
    ('111-34', 'gsat-111', {'label': '34'}, 'P', 0.50),
    ('111-32-D', 'gsat-111', {'label': '32'}, 'D', 0.26),
    ('111-32-D1', 'gsat-111', {'label': '32'}, 'D1', 0.14),
    ('115-endurance-map', 'gsat-115', {'map_item_passage': 'Endurance'}, 'P', 0.27),
    ('115-endurance-map-D', 'gsat-115', {'map_item_passage': 'Endurance'}, 'D', 0.20),
]


def run_ground_truth(exams, parsed_cache):
    out = []
    for gid, eid, sel, field, expected in GROUND_TRUTH:
        ex = exams.get(eid)
        idx = parsed_cache.get(eid, {}).get('index', {}) if parsed_cache.get(eid) else {}
        hits = []
        for it in (ex or {}).get('items', []):
            q = idx.get(it['label'])
            if 'label' in sel and it['label'] == sel['label']:
                hits.append(it)
            elif 'key_text' in sel and key_text(it, q) == sel['key_text']:
                hits.append(it)
            elif 'map_item_passage' in sel and q and sel['map_item_passage'] in q['passage'] and any(
                    f.get('kind') == 'map' and f.get('question_no') == q['no'] for f in q['figures']):
                hits.append(it)
        found = hits[0][field] if len(hits) == 1 else None
        out.append({'id': gid, 'exam': eid, 'selector': sel, 'field': field, 'expected': expected,
                    'label': hits[0]['label'] if len(hits) == 1 else None, 'found': found,
                    'pass': found is not None and abs(found - expected) <= 0.005})
    return out


# ---------- 主程式 ----------

def collect():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    files = defaultdict(dict)
    for it in manifest['items']:
        if it['subkind'] in ('pd_table', 'option_analysis') and it['session'] == 'regular':
            files[(it['exam'], it['year'])][it['subkind']] = it
    exams, mismatches, checks, gaps, parsed_cache = {}, [], [], [], {}
    footnotes = defaultdict(lambda: defaultdict(set))
    order = sorted(files, key=lambda k: (k[0] != 'gsat', k[1]))
    for exam, year in order:
        eid = f'{exam}-{year}'
        ent = files[(exam, year)]
        if set(ent) != {'pd_table', 'option_analysis'}:
            gaps.append({'exam': eid, 'scope': 'item_stats', 'kind': 'missing_file',
                         'detail': f'manifest 只有 {sorted(ent)}'})
            continue
        sources, parsed_tables = {}, {}
        for sub in ('pd_table', 'option_analysis'):
            m = ent[sub]
            path = ROOT / m['local_path']
            if not path.exists():
                raise RuntimeError(f'找不到原始檔 {m["local_path"]}（請先跑 tools/fetch_ceec.py）')
            digest = sha256(path)
            if digest != m['sha256']:
                checks.append({'exam': eid, 'label': None, 'check': 'sha256', 'expected': m['sha256'],
                               'found': digest, 'detail': f'{m["local_path"]} 與 manifest 不符'})
            if m['format'] == 'xls':
                t = (parse_pd_xls if sub == 'pd_table' else parse_oa_xls)(path)
                method = 'xlrd'
            elif eid == 'ast-91':
                t = parse_ast91_pd() if sub == 'pd_table' else parse_ast91_oa()
                method = 'manual_transcription（pdftoppm 轉圖人工抄錄，見本程式 AST91_* 常數）'
            elif m['format'] == 'pdf':
                t = (parse_pd_pdf if sub == 'pd_table' else parse_oa_pdf)(path)
                method = 'pdftotext -layout'
            else:
                raise RuntimeError(f'不支援的格式 {m["format"]}')
            parsed_tables[sub] = t
            sources[sub] = {'path': m['local_path'], 'format': m['format'], 'sha256': m['sha256'],
                            'official_filename': m.get('official_filename'), 'method': method,
                            'sheet': t['sheet']}
            for k, texts in t['footnotes'].items():
                for txt in texts:
                    footnotes[k][txt].add(eid)
        pd, oa = parsed_tables['pd_table'], parsed_tables['option_analysis']
        counts = pd['counts']
        if counts and None not in counts.values() and counts['registered'] - counts['absent'] != counts['examinees']:
            checks.append({'exam': eid, 'label': None, 'check': 'examinees_arithmetic',
                           'expected': counts['registered'] - counts['absent'], 'found': counts['examinees'],
                           'detail': '報考人數 − 缺考人數 ≠ 到考人數'})
        if oa['counts'] and counts and oa['counts'] != counts:
            checks.append({'exam': eid, 'label': None, 'check': 'examinees_between_tables',
                           'expected': counts, 'found': oa['counts'], 'detail': '兩張表的人數不同'})
        parsed = load_parsed(eid)
        parsed_cache[eid] = parsed
        if parsed is None:
            gaps.append({'exam': eid, 'scope': 'parsed', 'kind': 'no_parsed_paper',
                         'detail': f'data/exams/parsed/{eid}.json 不存在，無法對題'})
        items = build_exam(exam, year, pd, oa, parsed, mismatches, checks, gaps)
        if parsed:
            parsed_field_gaps(eid, items, parsed['index'], gaps)
        unjoined = [it['label'] for it in items if not it['joined']]
        if unjoined:
            gaps.append({'exam': eid, 'scope': 'item_stats', 'kind': 'unjoined_items',
                         'detail': f'題號對不上題本：{compress_labels(unjoined)}'})
        exams[eid] = {
            'exam': exam, 'exam_year': year, 'era': era_of(exam, year), 'parsed_id': eid if parsed else None,
            'examinees': counts, 'sources': sources,
            'format_variants': sorted(pd['variants'] | oa['variants']),
            'items': items,
        }
    if 'ast-91' in exams:
        gaps.append({'exam': 'ast-91', 'scope': 'item_stats', 'kind': 'pdf_without_text_layer',
                     'detail': 'stats-1.pdf／stats-2.pdf 是 Ghostscript 點陣字型、沒有可用文字層，pdftotext 只輸出空白；'
                               '改以 pdftoppm 轉圖人工逐格抄錄（P–D4 共 65 題、選項分析 195 列），'
                               '以 D=Ph−Pl、D1–D4、P/Ph/Pl 對正確選項 T/H/L 列等內部檢查，並與題本 JSON 既有的 P/Ph/Pl/D 與 T 列逐值比對'})
    return exams, mismatches, checks, gaps, parsed_cache, footnotes


def build_output():
    COMPARED.clear()
    exams, mismatches, checks, gaps, parsed_cache, footnotes = collect()
    gt = run_ground_truth(exams, parsed_cache)
    exam_order = {eid: i for i, eid in enumerate(exams)}
    mkey = lambda m: (exam_order.get(m['exam'], 999), label_key(m['label'] or '0'), m.get('field') or m.get('check'))  # noqa: E731
    mismatches.sort(key=mkey)
    checks.sort(key=mkey)
    gaps.sort(key=lambda g: (exam_order.get(g['exam'], 999), g['scope'], g['kind'], g['detail']))
    fn = {k: {t: sorted(v, key=lambda e: exam_order.get(e, 999)) for t, v in sorted(d.items())}
          for k, d in sorted(footnotes.items())}
    all_items = [it for ex in exams.values() for it in ex['items']]
    ph_33 = sorted({e for t, es in fn.get('Ph', {}).items() if '33%' in t for e in es}, key=lambda e: exam_order[e])
    ph_27 = sorted({e for t, es in fn.get('Ph', {}).items() if '27%' in t for e in es}, key=lambda e: exam_order[e])
    counts = {
        'exam_years': len(exams),
        'items_extracted': len(all_items),
        'items_joined': sum(it['joined'] for it in all_items),
        'items_with_five_groups': sum(all(it[f] is not None for f in FIVE) for it in all_items),
        'items_with_option_analysis': sum(bool(it['options']) for it in all_items),
        'multi_select_items': sum(it['multi_select'] for it in all_items),
        'mismatches': len(mismatches),
        'mismatched_items': len({(m['exam'], m['label']) for m in mismatches}),
        'source_checks': len(checks),
        'gaps': len(gaps),
        'ground_truth_pass': sum(g['pass'] for g in gt),
        'ground_truth_total': len(gt),
        'items_compared_with_parsed': dict(sorted(COMPARED.items())),
    }
    meta = {
        'schema': 'item-stats/v1',
        'source': '大考中心（CEEC）各科答對率及鑑別度表（pd_table）與各科選擇題選項分析（option_analysis），'
                  '學測 91–115、指考 91–110 英文科；檔案清單見 data/exams/manifest.json',
        'generated_by': 'tools/extract_item_stats.py',
        'join_target': 'data/exams/parsed/{exam}-{year}.json（regular 場次），以題號 label 對題',
        'value_scale': '所有比率都是 0–1 的小數（原表為整數百分比 ÷ 100）；原表空白是 null',
        'column_definitions': COLUMN_DEFINITIONS,
        'group_definitions_confirmed': {
            'Ph_Pl': '高分組＝依總分排序前 33%、低分組＝後 33%（不是 27%）',
            'exams_with_33pct_footnote': ph_33,
            'exams_with_27pct_footnote': ph_27,
            'Pa_Pe': '依成績高低分為各占 20% 的五種能力組，Pa 最高、Pe 最低',
            'grouping_basis': '依總分（原得總分）分組；不含使用點字卷考生',
        },
        'multi_select_note': '題號前有「*」者為多選題：P、Ph、Pl、Pa–Pe 是得分率（未答以 0 分計），T 是全對率，'
                             'options 是各選項被畫記比例（各選項獨立，加總不是 100%）。英文科只有學測 111–115 第 49 題',
        'footnotes': fn,
        'ground_truth_checks': gt,
        'counts': counts,
    }
    return {'meta': meta, 'exams': exams, 'mismatches': mismatches, 'source_checks': checks, 'gaps': gaps}


# ---------- 報告 ----------

VARIANT_DOC = [
    ('sheet_numeric_name', '工作表以數字命名（指考 94–99 的「1」「2」…），改用表頭上方標題列的「英文科」判斷科目'),
    ('pd_single_combined_sheet', '所有科目擠在同一張工作表（指考 92 答對率表），依表頭上方的「科目 英文」與每個表頭分段'),
    ('pd_label_not_first_column', '題號不在第一欄（指考 92 前面多「科目」欄、指考 93 前面多一個空白欄）'),
    ('label_numeric_cell', '題號儲存成數值（1.0），轉成整數字串'),
    ('label_padded_space', '題號前有空白（\' 1\'），去空白'),
    ('label_star_space', '多選題題號寫成「* 18」（星號後有空白）'),
    ('label_fullwidth', '題號或數字是全形字元，先做 NFKC 正規化'),
    ('values_as_text', '數值存成文字（\'57\'、\' 19\'、\'*59\'、\'* 60\'），去空白與星號後轉數字'),
    ('notes_in_chinese_sheet', '英文表只寫「名詞解釋請參考國文科之備註」，註腳在國文工作表；整本活頁簿一起掃註腳'),
    ('pd_no_examinee_header', '答對率表沒有人數列'),
    ('star_in_separate_column', '選項分析的「*」放在選項數字左邊另一個空白表頭欄（指考 92、93）'),
    ('label_on_H_row', '選項分析的題號寫在 H 列（三列中間）或因跨頁落在不同列；以 T 列開新題、題號掛在同一組任一列'),
    ('group_label_1T', '組別欄寫「1T」而不是「T」（指考 92）'),
    ('zero_filled_options', '不存在的選項欄也填 0（例如四選一題的 E–J）；有對上題本時只保留題本有的選項，'
                            '對不上時去掉尾端全為 0 的欄'),
    ('options_to_L', '選項欄到 L（指考 100–110 文意選填有 12 個選項）'),
    ('key_star_missing', '有題目整組 T/H/L 都沒有「*」：指考 92 正確選項落在 F–J 的 5 題（31、33、34、36、40），原表 F–J 左側的星號欄全空；'
                         'key 留 null、不代填，另在內部檢查列出題本答案該欄的 T/H/L 是否等於 P/Ph/Pl'),
    ('multi_select_item', '有多選題（學測 111–115 第 49 題，表上「*49」；選項分析有多個「*」）'),
    ('pdf_text_layer', 'PDF 有文字層，用 pdftotext -layout 逐列解析（學測 91）；T 欄空白時一列只有 13 個數字'),
    ('pdf_no_text_layer_manual', 'PDF 沒有文字層，人工抄錄（指考 91）'),
]


def fmt(x):
    return '—' if x is None else (f'{x:.2f}' if isinstance(x, float) else str(x))


def render_md(out):
    meta, exams = out['meta'], out['exams']
    c = meta['counts']
    L = []
    w = L.append
    w('# 逐題統計（答對率、鑑別度、選項分析）抽取報告')
    w('')
    w('由 `python3 tools/extract_item_stats.py` 產生，請勿手改；資料在 `data/exams/item-stats.json`。')
    w('來源是大考中心「各科答對率及鑑別度表」與「各科選擇題選項分析」（manifest 的 `pd_table`、`option_analysis`），'
      '學測 91–115、指考 91–110 英文科，共 45 個考試年度。')
    w('')
    w('## 摘要')
    w('')
    w(f"- 抽出 {c['items_extracted']} 題，{c['items_joined']} 題對上題本 JSON（{c['items_joined'] * 100 // max(c['items_extracted'], 1)}%）；"
      f"{c['items_with_option_analysis']} 題有選項分析，{c['items_with_five_groups']} 題有五等分組 Pa–Pe，多選題 {c['multi_select_items']} 題。")
    w(f"- 與題本 JSON 不一致：{c['mismatches']} 筆（{c['mismatched_items']} 題）；原表內部不一致：{c['source_checks']} 筆；缺口 {c['gaps']} 筆。")
    w(f"- 官方評論對照：{c['ground_truth_pass']}/{c['ground_truth_total']} 通過。")
    gd = meta['group_definitions_confirmed']
    w(f"- 高分組／低分組是**前 33%／後 33%**，不是常見說法的 27%：45 個年度中有 {len(gd['exams_with_33pct_footnote'])} 個年度的註腳寫明 33%，"
      f"寫 27% 的有 {len(gd['exams_with_27pct_footnote'])} 個。Pa–Pe 是依總分分成各占 20% 的五組。")
    w('')
    w('## 欄位定義')
    w('')
    w('數值一律是 0–1 的小數（原表整數百分比 ÷ 100），原表空白為 `null`。')
    w('')
    w('| 欄位 | 意義 | 說明 |')
    w('|---|---|---|')
    for k, v in meta['column_definitions'].items():
        extra = '；'.join(x for x in (v.get('group'), v.get('formula'), v.get('groups'), v.get('note')) if x)
        w(f'| `{k}` | {v["zh"]} | {extra} |')
    w('')
    w('原表註腳（各年寫法略有不同，完整原文與出現年度見 JSON `meta.footnotes`）：')
    w('')
    for k in ('Ph', 'Pl', 'Pa-Pe', 'T', 'D', 'D1-D4', 'option_groups', 'omit_rate'):
        texts = meta['footnotes'].get(k, {})
        if texts:
            top = max(texts.items(), key=lambda kv: (len(kv[1]), kv[0]))
            w(f'- `{k}`：「{top[0]}」（{len(top[1])} 個年度同寫法，共 {len(texts)} 種寫法）')
    w('')
    w('多選題（學測 111–115 第 49 題）：P、Ph、Pl、Pa–Pe 是得分率，T 是全對率，選項比例是各選項被畫記的比例（加總不是 100%）。')
    w('')
    w('## 各年度涵蓋')
    w('')
    w('| 考試 | 來源格式 | 到考人數 | 抽出題數 | 對上題本 | 有選項分析 | 五等分組 | 不一致（筆） | 內部檢查（筆） |')
    w('|---|---|---:|---:|---:|---:|---:|---:|---:|')
    mm_by = defaultdict(int)
    for m in out['mismatches']:
        mm_by[m['exam']] += 1
    ck_by = defaultdict(int)
    for m in out['source_checks']:
        ck_by[m['exam']] += 1
    for eid, ex in exams.items():
        its = ex['items']
        fmt_ = '／'.join(sorted({s['format'] for s in ex['sources'].values()}))
        if 'pdf_no_text_layer_manual' in ex['format_variants']:
            fmt_ += '（人工抄錄）'
        n_exam = (ex['examinees'] or {}).get('examinees')
        w(f"| {eid} | {fmt_} | {n_exam if n_exam is not None else '—'} | {len(its)} | {sum(i['joined'] for i in its)} | "
          f"{sum(bool(i['options']) for i in its)} | {sum(all(i[f] is not None for f in FIVE) for i in its)} | "
          f"{mm_by[eid]} | {ck_by[eid]} |")
    w('')
    w('## 格式差異與處理方式')
    w('')
    w('| 代號 | 狀況與處理 | 出現年度 |')
    w('|---|---|---|')
    for code, desc in VARIANT_DOC:
        ex_list = [eid for eid, ex in exams.items() if code in ex['format_variants']]
        if ex_list:
            w(f'| `{code}` | {desc} | {compress_exams(ex_list)} |')
    w('')
    w('共通做法：表頭列以「題號」＋ P／Ph（答對率表）或 A／B（選項分析）辨認；英文表以工作表名稱含「英」或表頭上方四列內出現「英文」辨認，'
      '每本活頁簿必須剛好找到一個，否則程式中止。資料列從表頭下一列讀到第一個不是題號（或不是 T/H/L）的列為止，所以表尾的註腳、空白列、下一科都不會混進來。'
      '題號支援 `47-1`、`47A` 這類子題寫法（目前英文科沒有出現）。人數列「報考／缺考／到考」從表頭上方解析，指考 100「到考人數:77.936」的句點視為千分位。')
    w('')
    w('## 官方評論對照（docs/research/08-exam-commentary.md）')
    w('')
    w('| 項目 | 考試 | 題號 | 欄位 | 評論值 | 抽出值 | 結果 |')
    w('|---|---|---:|---|---:|---:|---|')
    for g in meta['ground_truth_checks']:
        w(f"| {g['id']} | {g['exam']} | {g['label'] or '—'} | {g['field']} | {g['expected']:.2f} | {fmt(g['found'])} | {'通過' if g['pass'] else '**不符**'} |")
    w('')
    w('## 與題本 JSON 的不一致')
    w('')
    w('只回報、不改 `data/exams/parsed/`。比對項目：(a) 選項分析的「*」對題本 `answer`；(b) P／Ph／Pl／D／T 對 `stats.correct_rate`／`high_group`／'
      '`low_group`／`discrimination`／`full_correct_rate`；(c) Pa–Pe 對 `stats.five_groups`；另外也比對各選項 T／H／L 比例與未答比例。')
    w('')
    cmp_ = c['items_compared_with_parsed']
    w('實際比對次數（題）：' + '、'.join(f'`{k}` {v}' for k, v in cmp_.items()) + '。')
    w('')
    if not out['mismatches']:
        w('**沒有任何不一致。** 題本 JSON 既有的統計值是解析時從同一批大考中心表格抄入的，本次以程式獨立重抽後逐值相符，'
          '可視為題本統計欄位已通過獨立核對；題本缺的欄位（五等分組、高低分組選項比例等）列在下方〈缺口與限制〉。')
    else:
        by_field = defaultdict(int)
        for m in out['mismatches']:
            by_field[m['field'].split('.')[0]] += 1
        w('依欄位：' + '、'.join(f'`{k}` {v} 筆' for k, v in sorted(by_field.items())) + '。')
        w('')
        w('| 考試 | 題號 | 位置 | 欄位 | 原表 | 題本 | 說明 |')
        w('|---|---:|---|---|---|---|---|')
        for m in out['mismatches']:
            w(f"| {m['exam']} | {m['label']} | {m['path']} | `{m['field']}` | {json.dumps(m['item_stats'], ensure_ascii=False)} | "
              f"{json.dumps(m['parsed'], ensure_ascii=False)} | {m['detail'] or ''} |")
    w('')
    w('## 原表內部檢查')
    w('')
    w('檢查 D＝Ph−Pl、D1–D4＝相鄰五等分組相減、單選題 P／Ph／Pl＝正確選項的 T／H／L 列、各列選項加未答≈100%（±3）、兩張表題號一致、人數加減一致。'
      '這些是大考中心原表本身的四捨五入或編輯差異，數值照原表保留。')
    w('')
    if not out['source_checks']:
        w('沒有發現不一致。')
    else:
        w('| 考試 | 題號 | 檢查 | 預期 | 實際 | 說明 |')
        w('|---|---:|---|---|---|---|')
        for m in out['source_checks']:
            w(f"| {m['exam']} | {m['label'] or '—'} | `{m['check']}` | {json.dumps(m['expected'], ensure_ascii=False)} | "
              f"{json.dumps(m['found'], ensure_ascii=False)} | {m['detail']} |")
    w('')
    w('## 缺口與限制')
    w('')
    w('- 沒有逐題統計的考試：學測 83–90（大考中心未公布）、學測 91／92 補考、指考 93／109 補考、參考試卷（ref-*）。')
    w('- 非選擇題（簡答、混合題填充與簡答、中譯英、作文）只有大題層級的分數分布，不在本檔；見各題本 `section.stats`。')
    pm = defaultdict(list)
    for g in out['gaps']:
        if g['kind'] == 'parsed_missing_field':
            field = re.search(r'stats\.(\w+)', g['detail']).group(1)
            pm[field].append(g['exam'])
        else:
            w(f"- {g['exam']}（{g['scope']}／`{g['kind']}`）：{g['detail']}")
    if pm:
        w('- 題本 JSON 缺、但原表有的統計欄位（`gaps` 中 `parsed_missing_field`，可據本檔回填題本；本工具不改題本）：')
        for field, ids in sorted(pm.items()):
            w(f'  - `stats.{field}`：{compress_exams(ids)}')
    w('')
    return '\n'.join(L)


def compress_exams(ids):
    by = defaultdict(list)
    for e in ids:
        ex, y = e.split('-')
        by[ex].append(int(y))
    parts = []
    for ex in ('gsat', 'ast'):
        ys = sorted(by.get(ex, []))
        if not ys:
            continue
        runs, i = [], 0
        while i < len(ys):
            j = i
            while j + 1 < len(ys) and ys[j + 1] == ys[j] + 1:
                j += 1
            runs.append(f'{ys[i]}–{ys[j]}' if j > i else str(ys[i]))
            i = j + 1
        parts.append(('學測 ' if ex == 'gsat' else '指考 ') + '、'.join(runs))
    return '；'.join(parts)


def main(argv):
    out = build_output()
    c = out['meta']['counts']
    if '--check' in argv:
        print(json.dumps(c, ensure_ascii=False, sort_keys=True))
        return 0
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, sort_keys=True, indent=1) + '\n', encoding='utf-8')
    OUT_MD.write_text(render_md(out), encoding='utf-8')
    print(json.dumps(c, ensure_ascii=False, sort_keys=True))
    return 0


# ---------- ast-91 人工抄錄（stats-1.pdf 2 頁、stats-2.pdf 6 頁；pdftoppm 150–300 dpi） ----------
# AST91_PD 每列：題號 P Ph Pl Pa Pb Pc Pd Pe T D D1 D2 D3 D4（百分比；T 欄空白記為 -）
# AST91_OA 每列：題號 組別 未答 A B C D …（百分比；「*」為標準答案；四選一題原表 E–J 補 0，抄錄時省略）
# 原表 11 題 H 列 C=92、57 題 H 列 A=78，與答對率表 Ph（91、77）差 1，已放大 300 dpi 確認是原表本身的差異。
AST91_COUNTS = {'registered': 113193, 'absent': 4913, 'examinees': 108280}

AST91_PD_NOTES = """
本表之分組係依總分得分而為之
P=全體到考考生答對率
Ph=高分組(前33%)考生答對率
Pl=低分組(後33%)考生答對率
Pa-Pe=依成績高低分為各佔20%的五種能力組考生答對率
D=全體到考考生鑑別度Ph-Pl
T=多重選擇題全對率
D1-D4=五種能力組考生鑑別度(D1=Pa-Pb...D4=Pd-Pe)
題號前有星號者為多重選擇題,以得分率代替答對率
"""

AST91_OA_NOTES = """
本表之分組係依總分得分而為之
題號前有星號者為多重選擇題
T,H,L 分別為全部到考考生,高分組考生(前33%),低分組考生(後33%)之答案百分比
各答案百分比前有星號者為標準答案
各答案百分比=畫記該答案人數÷該組(高分組,低分組,全體)全部到考人數
"""

AST91_PD = """
1 78 99 46 99 97 91 71 33 - 53 2 6 20 38
2 30 53 13 62 37 22 14 12 - 40 25 15 8 2
3 60 83 35 87 73 61 45 31 - 48 14 12 16 14
4 65 94 31 97 87 71 49 23 - 63 10 16 22 26
5 48 85 17 93 68 42 23 14 - 68 25 26 19 9
6 81 97 58 98 94 87 75 49 - 39 4 7 12 26
7 52 78 29 85 66 49 35 26 - 49 19 17 14 9
8 15 27 8 34 16 10 8 9 - 19 18 6 2 -1
9 29 50 15 59 33 20 14 16 - 35 26 13 6 -2
10 45 75 19 83 61 40 23 17 - 56 22 21 17 6
11 72 91 49 94 86 77 63 41 - 42 8 9 14 22
12 68 95 39 98 87 72 52 33 - 56 11 15 20 19
13 38 58 24 65 43 34 28 21 - 34 22 9 6 7
14 43 69 21 75 57 40 26 19 - 48 18 17 14 7
15 66 92 31 94 88 74 50 22 - 61 6 14 24 28
16 59 74 43 78 66 60 52 37 - 31 12 6 8 15
17 42 55 29 58 48 42 35 26 - 26 10 6 7 9
18 34 62 15 71 44 26 15 16 - 47 27 18 11 -1
19 26 40 15 44 30 22 16 15 - 25 14 8 6 1
20 36 57 22 66 40 29 23 21 - 35 26 11 6 2
21 45 71 24 78 56 41 28 22 - 47 22 15 13 6
22 60 90 29 95 80 61 40 24 - 61 15 19 21 16
23 38 63 17 71 48 34 22 16 - 46 23 14 12 6
24 50 76 26 83 64 49 34 23 - 50 19 15 15 11
25 42 51 32 54 46 42 38 29 - 19 8 4 4 9
26 47 65 26 68 58 50 37 20 - 39 10 8 13 17
27 57 75 33 75 73 63 46 26 - 42 2 10 17 20
28 66 85 45 88 79 69 56 39 - 40 9 10 13 17
29 63 81 47 87 71 60 53 43 - 34 16 11 7 10
30 52 80 26 85 68 51 35 22 - 54 17 17 16 13
31 39 66 16 76 49 34 23 13 - 50 27 15 11 10
32 47 81 15 88 66 45 26 10 - 66 22 21 19 16
33 49 70 30 78 56 46 37 27 - 40 22 10 9 10
34 57 81 31 87 71 58 44 24 - 50 16 13 14 20
35 51 78 23 84 66 51 35 17 - 55 18 15 16 18
36 64 88 39 92 79 65 53 31 - 49 13 14 12 22
37 77 98 48 99 95 85 68 37 - 50 4 10 17 31
38 46 73 21 81 59 43 30 17 - 52 22 16 13 13
39 65 90 37 94 82 68 53 29 - 53 12 14 15 24
40 61 91 26 94 84 67 44 17 - 65 10 17 23 27
41 55 89 21 94 77 56 35 14 - 68 17 21 21 21
42 57 86 27 91 74 57 40 21 - 59 17 17 17 19
43 59 86 31 92 76 60 43 25 - 55 16 16 17 18
44 46 77 19 84 62 42 26 16 - 58 22 20 16 10
45 49 79 22 86 65 46 31 17 - 57 21 19 15 14
46 50 84 19 92 69 47 28 15 - 65 23 22 19 13
47 38 75 10 86 52 28 15 9 - 65 34 24 13 6
48 35 67 13 79 44 24 14 12 - 54 35 20 10 2
49 29 53 12 63 35 21 14 12 - 41 28 14 7 2
50 39 63 19 70 49 35 24 17 - 44 21 14 11 7
51 51 85 20 90 72 49 29 15 - 65 18 23 20 14
52 31 45 23 52 32 25 22 23 - 22 20 7 3 -1
53 50 86 14 91 74 49 24 10 - 72 17 25 25 14
54 42 66 18 70 58 40 23 17 - 48 12 18 17 6
55 49 78 26 85 63 45 33 22 - 52 22 18 12 11
56 57 85 29 90 74 56 39 24 - 56 16 18 17 15
57 44 77 15 86 61 38 22 12 - 62 25 23 16 10
58 43 70 22 78 54 38 28 18 - 48 24 16 10 10
59 66 92 38 96 83 70 53 30 - 54 13 13 17 23
60 35 63 14 72 45 27 16 13 - 49 27 18 11 3
61 54 79 29 84 69 54 39 24 - 50 15 15 15 15
62 54 77 33 86 61 51 45 27 - 44 25 10 6 18
63 43 71 23 83 51 35 28 20 - 48 32 16 7 8
64 30 51 20 65 26 17 18 21 - 31 39 9 -1 -3
65 30 50 16 60 32 24 19 14 - 34 28 8 5 5
"""

AST91_OA = """
1 T 6 6 4 6 *78
1 H 0 0 0 0 99
1 L 15 13 11 16 46
2 T 23 *30 12 12 24
2 H 10 53 7 9 20
2 L 30 13 15 16 26
3 T 11 6 10 *60 13
3 H 3 1 3 83 10
3 L 21 13 18 35 13
4 T 11 *65 9 10 4
4 H 1 94 1 3 1
4 L 22 31 21 17 9
5 T 24 8 10 10 *48
5 H 7 3 3 3 85
5 L 36 11 19 17 17
6 T 8 5 3 4 *81
6 H 1 1 0 1 97
6 L 16 10 8 8 58
7 T 19 12 *52 10 8
7 H 7 10 78 1 4
7 L 27 13 29 21 10
8 T 25 *15 10 22 27
8 H 13 27 2 25 33
8 L 34 8 20 18 19
9 T 31 8 *29 10 23
9 H 14 5 50 2 29
9 L 41 10 15 18 16
10 T 25 7 13 11 *45
10 H 7 3 10 4 75
10 L 39 10 14 18 19
11 T 10 5 7 *72 5
11 H 1 2 4 92 2
11 L 20 10 11 49 10
12 T 16 3 *68 5 7
12 H 3 1 95 1 1
12 L 27 8 39 11 15
13 T 28 17 10 *38 6
13 H 17 16 5 58 4
13 L 33 16 16 24 11
14 T 13 22 12 9 *43
14 H 2 23 3 3 69
14 L 23 18 24 14 21
15 T 12 *66 7 7 8
15 H 1 92 1 1 4
15 L 25 31 16 15 14
16 T 9 17 8 *59 7
16 H 3 18 3 74 3
16 L 15 15 15 43 13
17 T 9 26 *42 6 19
17 H 2 27 55 1 15
17 L 15 24 29 11 21
18 T 17 8 15 *34 25
18 H 5 9 12 62 13
18 L 28 9 18 15 30
19 T 17 28 6 24 *26
19 H 7 29 2 22 40
19 L 24 27 10 24 15
20 T 15 *36 27 19 4
20 H 6 57 19 15 3
20 L 20 22 32 21 6
21 T 24 9 *45 12 9
21 H 8 11 71 4 6
21 L 35 8 24 21 13
22 T 12 *60 6 17 5
22 H 2 90 2 6 0
22 L 22 29 11 27 10
23 T 25 6 18 13 *38
23 H 10 2 12 13 63
23 L 35 10 24 14 17
24 T 22 11 10 *50 6
24 H 10 5 6 76 3
24 L 30 17 17 26 9
25 T 20 7 20 *42 12
25 H 8 10 17 51 14
25 L 28 6 23 32 11
26 T 14 12 9 17 *47
26 H 5 11 10 10 65
26 L 23 13 12 26 26
27 T 16 *57 12 6 9
27 H 5 75 10 4 6
27 L 26 33 17 11 13
28 T 12 9 6 *66 6
28 H 2 9 1 85 2
28 L 21 8 14 45 13
29 T 16 8 *63 5 8
29 H 5 5 81 4 5
29 L 25 11 47 7 10
30 T 18 *52 8 16 6
30 H 6 80 8 5 1
30 L 27 26 10 26 11
31 T 6 32 1 1 0 0 *39 21 0 0 0
31 H 1 24 0 0 0 0 66 8 0 0 0
31 L 12 32 1 2 1 1 16 33 0 0 0
32 T 7 0 9 27 *47 6 0 0 1 1 1
32 H 1 0 5 11 81 1 0 0 0 0 1
32 L 16 1 12 37 15 11 1 1 2 2 2
33 T 7 *49 1 1 0 0 25 17 0 0 0
33 H 1 70 0 0 0 0 19 10 0 0 0
33 L 14 30 2 2 1 1 27 22 1 1 0
34 T 6 11 1 0 1 0 24 *57 0 0 0
34 H 1 5 0 0 0 0 13 81 0 0 0
34 L 14 17 1 1 1 1 31 31 1 1 0
35 T 11 0 4 13 12 *51 0 0 4 2 2
35 H 2 0 1 13 5 78 0 0 0 0 0
35 L 22 1 8 11 17 23 1 1 7 6 4
36 T 9 0 1 2 9 2 0 0 11 1 *64
36 H 1 0 0 1 4 0 0 0 5 0 88
36 L 19 1 3 5 9 4 1 0 16 3 39
37 T 8 0 1 1 1 1 0 0 8 *77 2
37 H 1 0 0 0 0 0 0 0 1 98 0
37 L 18 1 3 2 3 2 1 1 16 48 5
38 T 9 0 5 *46 7 25 0 0 2 2 4
38 H 1 0 1 73 4 18 0 0 0 0 3
38 L 18 1 9 21 9 29 1 0 4 3 5
39 T 9 0 *65 2 12 3 0 0 2 1 5
39 H 1 0 90 0 5 1 0 0 0 0 2
39 L 19 1 37 4 19 4 1 1 4 3 7
40 T 11 1 5 1 3 2 1 0 *61 5 10
40 H 1 0 1 0 0 0 0 0 91 1 5
40 L 22 1 9 3 8 4 1 1 26 11 13
41 T 13 10 7 6 8 *55
41 H 3 3 1 1 3 89
41 L 24 15 15 12 14 21
42 T 12 10 6 8 *57 6
42 H 2 4 1 5 86 2
42 L 22 16 11 12 27 11
43 T 13 7 3 *59 14 3
43 H 3 3 0 86 7 1
43 L 24 12 8 31 19 7
44 T 14 *46 23 6 3 8
44 H 3 77 16 2 0 2
44 L 25 19 24 12 7 13
45 T 15 12 *49 7 6 11
45 H 3 10 79 3 2 3
45 L 26 12 22 12 10 18
46 T 27 5 6 7 *50 6
46 H 8 1 1 2 84 4
46 L 40 9 12 13 19 7
47 T 29 12 6 9 6 *38
47 H 10 8 2 4 2 75
47 L 42 13 10 14 10 10
48 T 30 *35 9 12 6 9
48 H 10 67 6 10 1 5
48 L 42 13 11 13 11 10
49 T 31 13 14 *29 5 9
49 H 11 12 18 53 1 4
49 L 43 13 11 12 9 12
50 T 29 5 *39 15 6 5
50 H 10 2 63 21 4 1
50 L 42 9 19 10 9 10
51 T 14 11 14 10 *51
51 H 2 3 8 2 85
51 L 25 16 17 22 20
52 T 27 13 *31 15 15
52 H 13 17 45 17 8
52 L 32 9 23 15 21
53 T 14 *50 4 9 24
53 H 2 86 0 2 10
53 L 25 14 9 16 36
54 T 16 5 *42 30 7
54 H 5 2 66 24 2
54 L 26 9 18 32 14
55 T 19 5 *49 15 12
55 H 5 1 78 6 10
55 L 29 10 26 23 13
56 T 12 9 20 *57 3
56 H 2 5 8 85 0
56 L 21 13 30 29 7
57 T 20 *44 7 15 15
57 H 5 78 3 7 8
57 L 31 15 11 23 20
58 T 13 13 22 8 *43
58 H 3 9 15 3 70
58 L 22 15 26 15 22
59 T 13 5 4 *66 11
59 H 3 2 0 92 3
59 L 23 10 10 38 20
60 T 24 12 15 14 *35
60 H 8 7 13 9 63
60 L 34 17 17 19 14
61 T 19 14 *54 6 6
61 H 5 13 79 1 1
61 L 31 14 29 13 13
62 T 23 11 8 *54 4
62 H 10 7 3 77 3
62 L 28 17 14 33 7
63 T 30 7 *43 11 9
63 H 14 4 71 7 4
63 L 36 11 23 16 15
64 T 36 14 9 *30 11
64 H 22 15 5 51 7
64 L 39 12 15 20 14
65 T 33 10 15 12 *30
65 H 18 11 17 4 50
65 L 39 8 15 22 16
"""

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
