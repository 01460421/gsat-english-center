#!/usr/bin/env python3
"""出版社模考 → 題庫正規化檔（gsat-pub/v1）的匯入工具（docs/design/weak-paper.md §8，WP-P2）。

用法（在專案根目錄；轉錄檔是不可信的資料，一律用 python3 -I）：
    python3 -I tools/import_publisher.py --work DIR                 # 匯入 DIR/papers 裡所有有 .verify.json 的試卷
    python3 -I tools/import_publisher.py --work DIR --paper ny-113-n2 [--paper ...]   # 只重做指定的試卷（其他試卷的檔案不動）
    python3 -I tools/import_publisher.py --work DIR --dry-run       # 只印結果，不寫任何檔案

輸入（都不進 repo）：
    DIR/manifest.json                         28 回的清單（冊別、學年度、系列代號、目錄標示、考試名稱）
    DIR/papers/{paper_id}.json                整份試卷（gsat-exam/v1.1；答案取自出版社的答案表）
    DIR/papers/{paper_id}.extras.json         出版社證據、逐題答案表、出版社難易度標示、詳解（詳解不輸出）
    DIR/papers/{paper_id}.verify.json         獨立稽核（修正、爭議、未決事項）；沒有這個檔的試卷還沒定稿，不匯入
    tools/publisher_import/overrides/{paper_id}.json   站方的人工決定（格式見該目錄的 README.md）

輸出（進 repo）：
    data/sources.json                         來源登記：保留既有內容，每回試卷補一筆（已經有的來源不覆寫，站主改過的欄位保留）
    data/publisher/{來源 id}/v1/{題型}/{難度}/pb.{題型碼}.{hex}@{版本}.json
    docs/publisher-import/report.md           匯入檢查表（給站主；不含題目與詳解文字）

規則摘要：
    - 只收六種題型（詞彙、綜合測驗、文意選填、篇章結構、閱讀、混合題）；中譯英與作文第一版不收；其他題型 unsupported_section。
    - 切題組：詞彙整個大題一組；綜合測驗、閱讀、混合題每篇一組；文意選填、篇章結構一組。組內題號從 1 起重編，
      選文的 [[n]]（與轉錄用來表示同一題第二個空格的 ___n___）、圖的 question_no 一起改；原卷題號留在 source_ref.labels。
    - 形狀不是標準形狀的照收（format_version 寫實際形狀，只進題庫練習）。
    - uid：sha256(來源 id + ':' + 原卷位置) 的前 24 位元；原卷位置＝原卷題號以逗號串起（例如 11,12,13,14,15）。
      和已存在的 pb uid 撞到時 +1 順延。已經輸出過的題組（同來源、同原卷題號）沿用原本的 uid；內容（狀態與人工檢查紀錄以外的欄位）
      改了才寫新版本（版本 +1，舊版本的檔案保留，由建置取最大的 verified 版本）。
    - 難度：詳解印了逐題五級難易度的試卷（翰林、北模、中模；來源登記有 tier_labels）＝publisher：逐題標示經 tier_labels 換成 basic/advanced/top（0/1/2），
      取平均，< 0.5 basic、< 1.5 advanced、其餘 top（剛好在界線上算較難的一級）。其他＝metrics：見 metrics_tier()。
      覆寫檔指定的難度＝manual。沒有作答統計，所以 G50（stats）不適用。
    - 狀態：試卷有 .verify.json、題組沒有未解決的答案爭議、沒有未確認或會影響答案的稽核未決事項 → verified；否則 draft。
      混合題要覆寫檔補齊所有填充／簡答的可接受寫法並標 open_key_complete 才輸出（validate_publisher 只收 open_key complete，
      所以沒補齊的混合題不輸出，列在檢查表的「待補齊」）。
    - 不輸出：詳解、轉錄與稽核備註（refers_to.note、*_raw 標註）、scoring_notes、卷頭卷尾說明（大題說明、題組標題）。
    - 跨卷重複：8 個英文字的片段重疊 ≥ 50%（以片段較少的一組為分母）就只留一組（已輸出過的優先，其次學年度早的），其餘列在檢查表。
    - 歷屆原題（和 data/exams/parsed 重疊 ≥ 30% 或題幹完全相同）與 D8 命中的題組不輸出（validate_publisher 也會拒收）。

只用標準函式庫。測試：tools/tests/test_import_publisher.py（只用合成資料）。
"""
import argparse
import hashlib
import importlib.util
import json
import re
import statistics
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import text_metrics as tm  # noqa: E402  — 文章指標與詞表級別
import validate_bank as vb  # noqa: E402  — 英文斷字、D8 指紋
import validate_exam as ve  # noqa: E402  — 標記處理、空格格式

ROOT = TOOLS.parent
OUT_DIR = ROOT / 'data' / 'publisher'
SOURCES_FILE = ROOT / 'data' / 'sources.json'
OVERRIDES_DIR = TOOLS / 'publisher_import' / 'overrides'
REPORT_FILE = ROOT / 'docs' / 'publisher-import' / 'report.md'
PARSED_DIR = ROOT / 'data' / 'exams' / 'parsed'

SCHEMA = 'gsat-pub/v1'
IMPORT_DATE = '2026-10-24'
REVIEW = {'by': 'ai-auditor', 'checks': ['answers', 'tier', 'tags_sample', 'd8']}
UID_CODES = {'vocabulary': 'vo', 'cloze': 'cz', 'word_bank': 'wb', 'structure': 'st', 'reading': 'rd', 'mixed': 'mx'}
SECTION_ZH = {'vocabulary': '詞彙', 'cloze': '綜合測驗', 'word_bank': '文意選填', 'structure': '篇章結構', 'reading': '閱讀測驗',
              'mixed': '混合題', 'translation': '中譯英', 'composition': '英文作文'}
NOT_V1 = ('translation', 'composition')
TIERS = ('basic', 'advanced', 'top')
TIER_ZH = {'basic': '穩定基礎', 'advanced': '進階練習', 'top': '超越頂標'}
BLANK_SECTIONS = ('cloze', 'word_bank', 'structure')
OPEN_MODES = ('fill_in_blank', 'short_answer', 'table_completion')
FILENAME_RE = re.compile(r'^(pb\.(vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)\.json$')
SOURCE_ID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')

# 輸出欄位（白名單；其他欄位一律丟掉）
GROUP_TAG_KEYS = ('topic', 'genre', 'sdgs', 'text_format')
QUESTION_KEYS = ('no', 'label', 'mode', 'stem', 'options', 'answer', 'accepted_answers', 'points', 'stats', 'tags', 'refers_to',
                 'answer_table')
CHOICE_TAGS = ('test_point', 'answer_pos', 'answer_function', 'grammar_point', 'key_phrase')
QUESTION_TAGS = {'vocabulary': CHOICE_TAGS, 'cloze': CHOICE_TAGS, 'word_bank': CHOICE_TAGS,
                 'structure': ('clue', 'key_phrase'), 'reading': ('item_type', 'key_phrase'), 'mixed': ('item_type', 'key_phrase')}
FIGURE_KEYS = ('kind', 'label', 'caption', 'description', 'rows', 'question_no', 'chart')
REFERS_TO_KEYS = ('text', 'occurrence')

# ---------------------------------------------------------------------------
# 來源登記
# ---------------------------------------------------------------------------

# 本站題庫那一筆（P1 的 data/sources.json；沒有登記檔時從這裡開始，格式逐位元相同）。
AI_BANK_ENTRY = {
    'id': 'ai-bank', 'ns': 'ai', 'kind': 'ai_bank', 'label_zh': '本站題庫', 'publisher_zh': None, 'product_zh': None,
    'attribution_zh': 'AI 出題・已通過自動驗證・人工審核中',
    'licence': {'code': 'original-ai', 'ref': None, 'scope': ['web', 'pdf', 'ai_assist', 'explanations'], 'public_ok': True, 'until': None},
    'active': True, 'added': '2026-10-09', 'retired_on': None,
}
# 站主接受的預設授權（2026-10-24）：不含 explanations（出版社詳解不公開、不寫進 repo）。
PUBLISHER_LICENCE = {'code': 'publisher-licensed', 'ref': None, 'scope': ['web', 'pdf', 'ai_assist'], 'public_ok': True, 'until': None}

# 逐題五級難易度（翰林、北模、中模的詳解都印這一套）→ 本站三級（§8.5 的 G50 校準；理由見 overrides/README.md）。
FIVE_LEVEL_TIER_LABELS = {'易': 'basic', '中偏易': 'basic', '中': 'advanced', '中偏難': 'top', '難': 'top'}
HANLIN_TIER_LABELS = FIVE_LEVEL_TIER_LABELS

# 目錄標示（站主對出版者的說明）→ 畫面短名、預設公司名。印了逐題難易度的試卷，來源登記另外帶 tier_labels（source_entry）。
PUBLISHERS = {
    '翰林': {'label_zh': '翰林出版', 'company': '翰林出版事業股份有限公司'},
    '南一': {'label_zh': '南一', 'company': '南一書局企業股份有限公司'},
    '北模': {'label_zh': '北模', 'company': None},
    '中模': {'label_zh': '中模', 'company': None},
}
ROUND_ZH = {'1': '第一次', '2': '第二次', '3': '第三次', '4': '第四次', '5': '第五次'}
FORBIDDEN_TERMS = ('大考中心', 'CEEC')


def source_id_of(paper_id):
    return f'pub-{paper_id}'


def default_attribution(publisher, product):
    """item-source.ts 的 defaultAttribution：「本題出自{出版社}《{書名}》，經授權使用」。"""
    return f'本題出自{publisher}《{product}》，經授權使用'


def _compact(s):
    return re.sub(r'\s+', '', s or '')


def product_name(meta, printed_title):
    """印出的考試名稱縮短成書名（含回次）：「114 學年度北北基聯合模擬考（第二次）英文考科」。"""
    year = meta['school_year']
    t = _compact(printed_title)
    label = meta['label_from_toc']
    m = re.search(r'第([一二三四五])次', t)
    printed_round = f'第{m.group(1)}次' if m else None
    code_round = ROUND_ZH.get((meta.get('series_code') or '')[-1:])
    if label == '翰林':
        region = next((r for r in ('北北基', '新北基', '新竹區') if r in t), None)
        name = f'{region}聯合模擬考' if region else '全國學測模擬考'
        return f'{year} 學年度{name}（{printed_round or code_round}）英文考科'
    if label == '南一':
        return f'{year} 學年度全國公私立高中聯合模擬考（{printed_round or code_round}）英文考科'
    if label == '北模':
        term = '第一學期' if '第一學期' in t else '第二學期' if '第二學期' in t else ''
        return f'{year} 學年度{term}臺北區學測模擬考{f"（{printed_round}）" if printed_round else ""}英文考科'
    if label == '中模':
        return f'{year} 學年度臺中市立高中聯合複習考（{printed_round or code_round}）英文考科'
    raise ValueError(f'不認得的目錄標示 {label!r}')


def organizer_name(meta, evidence):
    """北模、中模的 publisher_zh：主辦單位照印（中模印在封面的單位名；北模封面只印「臺北區…學科能力測驗模擬考試」）。"""
    if evidence.get('printed_company'):
        return evidence['printed_company']
    t = _compact(evidence.get('printed_exam_title'))
    if meta['label_from_toc'] == '北模':
        return '臺北區學科能力測驗模擬考試'
    m = re.match(r'^(.*?)\d+學年度', t)
    return m.group(1) if m and m.group(1) else t


def source_entry(meta, evidence, printed_labels=()):
    """一回試卷的來源登記。printed_labels：詳解印的逐題難易度（有任何一個屬於五級標示，就登記 tier_labels，難度依據是 publisher）。"""
    label = meta['label_from_toc']
    pub = PUBLISHERS[label]
    if pub['company'] is not None:
        publisher_zh = evidence.get('printed_company') or pub['company']
    else:
        publisher_zh = organizer_name(meta, evidence)
    product = product_name(meta, evidence.get('printed_exam_title') or '')
    entry = {
        'id': source_id_of(meta['paper_id']), 'ns': 'pb', 'kind': 'publisher', 'label_zh': pub['label_zh'],
        'publisher_zh': publisher_zh, 'product_zh': product, 'attribution_zh': default_attribution(pub['label_zh'], product),
    }
    if any(x in FIVE_LEVEL_TIER_LABELS for x in printed_labels):
        entry['tier_labels'] = dict(FIVE_LEVEL_TIER_LABELS)
    entry.update({'licence': json.loads(json.dumps(PUBLISHER_LICENCE)), 'active': True, 'added': IMPORT_DATE, 'retired_on': None})
    for k in ('label_zh', 'publisher_zh', 'product_zh', 'attribution_zh'):
        upper = entry[k].upper()
        if any(t in upper for t in FORBIDDEN_TERMS):
            raise ValueError(f'{entry["id"]} 的 {k} 含禁字')
    return entry


def _inline(v):
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{json.dumps(k, ensure_ascii=False)}: {_inline(x)}' for k, x in v.items()) + ' }' if v else '{}'
    if isinstance(v, list):
        return '[' + ', '.join(_inline(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)


def dump_sources(entries):
    """data/sources.json 的格式（同 P1：每個欄位一行，物件與陣列寫在同一行）。"""
    lines = ['{', '  "sources": [']
    for i, e in enumerate(entries):
        lines.append('    {')
        items = list(e.items())
        for j, (k, v) in enumerate(items):
            lines.append(f'      {json.dumps(k)}: {_inline(v)}{"," if j < len(items) - 1 else ""}')
        lines.append('    }' + (',' if i < len(entries) - 1 else ''))
    lines += ['  ]', '}']
    return '\n'.join(lines) + '\n'


def merged_sources(existing, new_entries):
    """既有登記（不覆寫）＋新來源（依 id 排序接在後面）。"""
    entries = list(existing) if existing else [AI_BANK_ENTRY]
    have = {e.get('id') for e in entries}
    added = sorted((e for e in new_entries if e['id'] not in have), key=lambda e: e['id'])
    return entries + added, [e['id'] for e in added]


def load_sources(path):
    if not Path(path).exists():
        return None
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    return raw['sources']


# ---------------------------------------------------------------------------
# 讀轉錄檔與覆寫檔
# ---------------------------------------------------------------------------

def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def load_override(paper_id, overrides_dir):
    p = Path(overrides_dir) / f'{paper_id}.json'
    if not p.exists():
        return {'paper_id': paper_id, 'groups': {}, 'unresolved': {}, 'disputes': {}, 'notes': []}
    o = load_json(p)
    if o.get('paper_id') != paper_id:
        raise ValueError(f'{p}: paper_id 必須是 {paper_id}')
    allowed = {'paper_id', 'groups', 'unresolved', 'disputes', 'notes'}
    if set(o) - allowed:
        raise ValueError(f'{p}: 不認得的欄位 {sorted(set(o) - allowed)}')
    o.setdefault('groups', {})
    o.setdefault('unresolved', {})
    o.setdefault('disputes', {})
    o.setdefault('notes', [])
    group_keys = {'exclude', 'tier', 'tier_reason', 'status', 'status_reason', 'accepted_answers', 'scoring_extra',
                  'open_key_complete', 'notes'}
    for gk, g in o['groups'].items():
        if set(g) - group_keys:
            raise ValueError(f'{p}: groups[{gk}] 不認得的欄位 {sorted(set(g) - group_keys)}')
        if 'tier' in g and g['tier'] not in TIERS:
            raise ValueError(f'{p}: groups[{gk}].tier 必須是 basic／advanced／top')
        if 'status' in g and g['status'] != 'draft':
            raise ValueError(f'{p}: groups[{gk}].status 只能是 draft（verified 由檢查決定）')
    for k, u in o['unresolved'].items():
        if not (isinstance(u, dict) and isinstance(u.get('affects_answer'), bool) and isinstance(u.get('note'), str)):
            raise ValueError(f'{p}: unresolved[{k}] 必須是 {{affects_answer: bool, note: 字串}}')
    for k, d in o['disputes'].items():
        if not (isinstance(d, dict) and d.get('decision') in ('keep', 'change') and isinstance(d.get('reason'), str)
                and (d['decision'] == 'keep' or isinstance(d.get('answer'), str))):
            raise ValueError(f'{p}: disputes[{k}] 必須是 {{decision: keep|change, answer?（change 時）, reason}}')
    return o


# ---------------------------------------------------------------------------
# 切題組與重編題號
# ---------------------------------------------------------------------------

def group_key(labels):
    """覆寫檔與檢查表用的題組鍵：原卷第一題與最後一題（11-15、1-10、47A-50）。"""
    return labels[0] if len(labels) == 1 else f'{labels[0]}-{labels[-1]}'


def split_units(paper):
    """試卷 → (要匯入的題組單位, 不匯入的大題)。單位：{section, groups: [原始題組…], labels}。"""
    units, skipped = [], []
    for s in paper.get('sections') or []:
        t = s.get('type')
        labels = [q.get('label') for g in s.get('groups') or [] for q in g.get('questions') or []]
        if t in NOT_V1:
            skipped.append({'section': t, 'labels': labels, 'reason': 'not_v1'})
            continue
        if t not in UID_CODES:
            skipped.append({'section': t, 'labels': labels, 'reason': 'unsupported_section'})
            continue
        groups = s.get('groups') or []
        if t == 'vocabulary':
            units.append({'section': t, 'groups': groups, 'labels': labels})
        else:
            for g in groups:
                units.append({'section': t, 'groups': [g], 'labels': [q.get('label') for q in g.get('questions') or []]})
    return units, skipped


def _clean_tags(tags, allowed):
    if not isinstance(tags, dict):
        return {}
    return {k: tags[k] for k in allowed if k in tags and tags[k] is not None}


def _renumber_text(text, nomap, underscores):
    if not isinstance(text, str):
        return text
    out = ve.BLANK_RE.sub(lambda m: f'[[{nomap.get(int(m.group(1)), m.group(1))}]]', text)
    if underscores:
        out = re.sub(r'(_{2,})(\d+)(_{2,})', lambda m: f'{m.group(1)}{nomap.get(int(m.group(2)), m.group(2))}{m.group(3)}', out)
    return out


def _renumber_refs(text, nomap):
    """圖的標題與描述裡的「第38題」→ 組內題號（「第4題」）。"""
    return re.sub(r'第(\s*)(\d+)(\s*)題', lambda m: f'第{m.group(1)}{nomap.get(int(m.group(2)), m.group(2))}{m.group(3)}題', text)


def build_group(unit):
    """原始題組 → gsat-exam/v1.1 的 QuestionGroup（題號從 1 起、只留公開欄位）。回傳 (group, 原題號→新題號)。"""
    section = unit['section']
    src = unit['groups']
    qs_in = [q for g in src for q in g.get('questions') or []]
    nomap = {}
    for i, q in enumerate(qs_in, 1):
        if isinstance(q.get('no'), int):
            nomap.setdefault(q['no'], i)
    underscores = section in BLANK_SECTIONS
    questions = []
    for i, q in enumerate(qs_in, 1):
        out = {k: q[k] for k in QUESTION_KEYS if k in q}
        out['no'] = i
        out['label'] = str(i)
        out['stem'] = _renumber_text(q.get('stem'), nomap, underscores)
        out['stats'] = None
        out['tags'] = _clean_tags(q.get('tags'), QUESTION_TAGS[section])
        if isinstance(q.get('refers_to'), dict):
            out['refers_to'] = {k: q['refers_to'][k] for k in REFERS_TO_KEYS if k in q['refers_to']}
        ordered = {k: out[k] for k in QUESTION_KEYS if k in out}
        questions.append(ordered)
    first = src[0] if src else {}
    figures = []
    for g in src:
        for f in g.get('figures') or []:
            fo = {k: f[k] for k in FIGURE_KEYS if k in f}
            for k in ('label', 'caption', 'description'):
                if isinstance(fo.get(k), str):
                    fo[k] = _renumber_refs(fo[k], nomap)
            qn = f.get('question_no')
            if isinstance(qn, int):
                fo['question_no'] = nomap.get(qn, qn)
            elif isinstance(qn, str) and qn.isdigit():
                fo['question_no'] = nomap.get(int(qn), int(qn))
            figures.append(fo)
    parts = first.get('passage_parts')
    if isinstance(parts, list):
        parts = [{'label': p.get('label'), 'title': p.get('title'), 'text': _renumber_text(p.get('text'), nomap, underscores)}
                 for p in parts if isinstance(p, dict)]
    tags = _clean_tags(first.get('tags'), GROUP_TAG_KEYS) if len(src) == 1 else _clean_tags(first.get('tags'), ('sdgs',))
    group = {
        'id': 'g1',
        'group_label': None,
        'passage': _renumber_text(first.get('passage'), nomap, underscores) if len(src) == 1 else None,
        'passage_parts': parts if len(src) == 1 else None,
        'figures': figures,
        'options_bank': first.get('options_bank') if len(src) == 1 else None,
        'questions': questions,
        'tags': tags or None,
    }
    return group, nomap


def format_version(section, group):
    qs = group['questions']
    n = len(qs)
    if section in ('word_bank', 'structure'):
        bank = len(group.get('options_bank') or {})
        return f'{section}-{n}x{bank}'
    base = f'{section}-{n}'
    if section in ('vocabulary', 'cloze', 'reading'):
        counts = {len(q['options']) for q in qs if isinstance(q.get('options'), dict)}
        if counts and counts != {4}:
            base += 'o' + '/'.join(str(c) for c in sorted(counts))
    return base


def is_standard_shape(section, group, fmt):
    spec = tm.tiers_spec()['section_formats'][section]
    qs = group['questions']
    if len(qs) != spec['questions'] or fmt != spec['format_version']:
        return False
    if not all(q.get('mode') in spec['modes'] for q in qs):
        return False
    if spec['options_per_question'] and not all(isinstance(q.get('options'), dict) and len(q['options']) == spec['options_per_question'] for q in qs):
        return False
    if spec['bank_options'] and len(group.get('options_bank') or {}) != spec['bank_options']:
        return False
    return True


# ---------------------------------------------------------------------------
# 難度
# ---------------------------------------------------------------------------

TIER_INDEX = {'basic': 0, 'advanced': 1, 'top': 2}


def publisher_tier(labels, tier_labels):
    """逐題的出版社標示 → 題組難度：每題換成 0/1/2 取平均，< 0.5 basic、< 1.5 advanced、其餘 top。沒有任何標示回 None。"""
    idx = [TIER_INDEX[tier_labels[x]] for x in labels if x in tier_labels]
    if not idx:
        return None
    m = sum(idx) / len(idx)
    return 'basic' if m < 0.5 else 'advanced' if m < 1.5 else 'top'


# 文章指標的距離：每個指標超出帶的量 ÷ 尺度（字數 30 字、覆蓋率與表外字 2 個百分點、平均句長 2 字）。
METRIC_SCALES = {'word_count': 30.0, 'coverage_l1_4': 0.02, 'coverage_l1_6': 0.02, 'offlist_ratio': 0.02, 'avg_sentence_length': 2.0}
# 詞彙題：10 題正解的詞表級別平均（片語取最高級的字；表外字算 6 級）。學測 91–115 的詞彙大題用 G50 校準
# （詳見 README）：< 3.85 basic、< 4.5 advanced、其餘 top。
VOCAB_BASIC_MAX = 3.85
VOCAB_ADVANCED_MAX = 4.5
VOCAB_STOP = {'a', 'an', 'the', 'to', 'of'}


def passage_text(group):
    parts = [group.get('passage') or ''] + [p.get('text') or '' for p in group.get('passage_parts') or [] if isinstance(p, dict)]
    return '\n'.join(x for x in parts if x)


def band_distance(m, band):
    d, center = 0.0, 0.0
    for key, scale in METRIC_SCALES.items():
        rng = band.get(key)
        v = m.get(key)
        if not rng or not isinstance(v, (int, float)):
            continue
        lo, hi = rng.get('min'), rng.get('max')
        if lo is not None and v < lo:
            d += (lo - v) / scale
        elif hi is not None and v > hi:
            d += (v - hi) / scale
        if lo is not None and hi is not None:
            center += abs(v - (lo + hi) / 2) / scale
    return d, center


def vocab_answer_level(q):
    opts = q.get('options')
    if not isinstance(opts, dict) or q.get('answer') not in opts:
        return None
    toks = [t for t in tm.TOKEN_RE.findall(ve.strip_markup(opts[q['answer']])) if t.lower() not in VOCAB_STOP]
    levels = [tm.token_level(t) for t in toks]
    levels = [6 if lv is None else lv for lv in levels]
    return max(levels) if levels else None


def metrics_tier(section, group):
    """(tier, 說明)。選文類：tools/text_metrics.py 的指標和每一級的帶（tiers.json：SPEC §3.4＋各題型字數）比距離，取最近的一級；
    距離相同時取離帶中心較近的，再相同取 advanced。詞彙：正解詞表級別的平均（VOCAB_*）。"""
    if section == 'vocabulary':
        levels = [lv for lv in (vocab_answer_level(q) for q in group['questions']) if lv is not None]
        if not levels:
            return 'advanced', '詞彙：讀不到正解的級別，預設進階'
        m = sum(levels) / len(levels)
        tier = 'basic' if m < VOCAB_BASIC_MAX else 'advanced' if m < VOCAB_ADVANCED_MAX else 'top'
        return tier, f'正解平均 L{m:.2f}'
    m = tm.compute(passage_text(group))
    scored = []
    for t in TIERS:
        d, c = band_distance(m, tm.spec_band(section, t))
        scored.append((round(d, 6), round(c, 6), 0 if t == 'advanced' else 1, t))
    best = min(scored)
    return best[3], (f'{m["word_count"]} 字、L1–4 {m["coverage_l1_4"]:.1%}、L1–6 {m["coverage_l1_6"]:.1%}、'
                     f'句長 {m["avg_sentence_length"]}；距離 ' + '／'.join(f'{TIER_ZH[s[3]][:2]} {s[0]:.1f}' for s in scored))


# ---------------------------------------------------------------------------
# 重複、歷屆原題、D8
# ---------------------------------------------------------------------------

NGRAM = 8
DUP_MIN = 0.50
PAST_MAX = 0.30
PAST_STEM_MIN_TOKENS = 10


def group_text(g):
    parts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    parts += [q.get('stem') or '' for q in g.get('questions') or []]
    return '\n'.join(ve.strip_markup(ve.BLANK_RE.sub(' ', x)) for x in parts)


def shingles(text, n=NGRAM):
    toks = vb.en_tokens(text)
    return {' '.join(toks[i:i + n]) for i in range(len(toks) - n + 1)}


def overlap_ratio(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


_past = None


def past_corpus(parsed_dir=PARSED_DIR):
    global _past
    if _past is None:
        sh, sizes, stems = {}, {}, {}
        for p in sorted(Path(parsed_dir).glob('*.json')) if Path(parsed_dir).exists() else []:
            try:
                exam = load_json(p)
            except Exception:  # noqa: BLE001
                continue
            eid = exam.get('id') or p.stem
            for s in exam.get('sections') or []:
                if s.get('type') in NOT_V1:
                    continue
                for g in s.get('groups') or []:
                    gid = f'{eid} {g.get("id")}'
                    own = shingles(group_text(g))
                    sizes[gid] = len(own)
                    for k in own:
                        sh.setdefault(k, set()).add(gid)
                    for q in g.get('questions') or []:
                        toks = vb.en_tokens(ve.strip_markup(q.get('stem') or ''))
                        if len(toks) >= PAST_STEM_MIN_TOKENS:
                            stems.setdefault(' '.join(toks), eid)
        _past = {'shingles': sh, 'stems': stems}
    return _past


def _validator_module():
    """P1 的 tools/validate_publisher.py（合併後就在同一個目錄）：有的話歷屆原題比對直接用它，規則永遠和 CI 一致。"""
    try:
        import validate_publisher  # noqa: PLC0415
        return validate_publisher
    except ImportError:
        return None


def official_copy(group):
    """和歷屆試題的重疊（validate_publisher 的 official_copy）：命中回 (種類, 說明)，否則 None。
    種類 passage＝選文與題幹 8 字片段重疊 ≥ 30%；stem＝只有題幹逐字相同（多半是通用問法，見檢查表）。"""
    vp = _validator_module()
    if vp is not None:
        (ratio, gid), same = vp.past_overlap(group)
        if ratio >= vp.PAST_OVERLAP_MAX:
            return 'passage', f'和歷屆試題 {gid} 的 8 字片段重疊 {ratio:.0%}'
        if same:
            return 'stem', '、'.join(f'第 {lb} 題題幹和 {where} 相同' for lb, where in same)
        return None
    corpus = past_corpus()
    own = shingles(group_text(group))
    hits = {}
    for k in own:
        for gid in corpus['shingles'].get(k, ()):
            hits[gid] = hits.get(gid, 0) + 1
    for gid, n in sorted(hits.items()):
        if own and n / len(own) >= PAST_MAX:
            return 'passage', f'和歷屆試題 {gid} 的 8 字片段重疊 {n / len(own):.0%}'
    same = []
    for q in group['questions']:
        toks = vb.en_tokens(ve.strip_markup(q.get('stem') or ''))
        if len(toks) >= PAST_STEM_MIN_TOKENS and ' '.join(toks) in corpus['stems']:
            same.append(f'第 {q["label"]} 題題幹和 {corpus["stems"][" ".join(toks)]} 相同')
    return ('stem', '、'.join(same)) if same else None


def walk_strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from walk_strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from walk_strings(v)


def d8_hit(doc):
    for s in walk_strings({k: doc.get(k) for k in ('group', 'scoring_extra')}):
        if vb.official_en_overlap(s) or vb.official_han_overlap(s):
            return 'D8：和官方參考譯文或評分原則的指紋相同'
    return None


# ---------------------------------------------------------------------------
# 既有輸出（uid 與版本的穩定性）
# ---------------------------------------------------------------------------

def content_key(doc):
    """版本比對用的內容：status、review、version 以外的全部欄位。"""
    body = {k: v for k, v in doc.items() if k not in ('status', 'review', 'version')}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def scan_existing(out_dir):
    """{(來源 id, 原卷題號…): [ {uid, version, path, key, status} ]}, 所有已用的 uid。"""
    by_pos, uids = {}, set()
    out_dir = Path(out_dir)
    if not out_dir.exists():
        return by_pos, uids
    for p in sorted(out_dir.glob('*/v1/*/*/pb.*.json')):
        m = FILENAME_RE.match(p.name)
        if not m:
            continue
        try:
            d = load_json(p)
        except Exception:  # noqa: BLE001
            continue
        uids.add(m.group(1))
        labels = tuple((d.get('source_ref') or {}).get('labels') or [])
        by_pos.setdefault((d.get('source_id'), labels), []).append(
            {'uid': m.group(1), 'version': int(m.group(3)), 'path': p, 'key': content_key(d), 'status': d.get('status')})
    return by_pos, uids


def uid_for(source_id, labels, section, used):
    """sha256(來源 id + ':' + 原卷位置) 的前 24 位元；撞到已用的 uid 時 +1 順延。"""
    pos = ','.join(labels)
    n = int(hashlib.sha256(f'{source_id}:{pos}'.encode('utf-8')).hexdigest()[:6], 16)
    code = UID_CODES[section]
    while True:
        uid = f'pb.{code}.{n:06x}'
        if uid not in used:
            return uid
        n = (n + 1) % (1 << 24)


# ---------------------------------------------------------------------------
# 一份試卷
# ---------------------------------------------------------------------------

LABEL_REF_RE = re.compile(r'(?:\bQ|第|\b)(\d{1,2}[A-Z]?)(?:\s*[–\-]\s*(\d{1,2}))?(?=題|\b|[:：(（.、 ,，])')


def referenced_labels(text, all_labels):
    """稽核未決事項提到的原卷題號（Q44、第44題、44:、31–34、第21–30題）；只回傳試卷裡真的有的題號。"""
    out = set()
    num_labels = {l for l in all_labels if l.isdigit()}
    for m in re.finditer(r'(?<![\d.])(\d{1,2})(?:[A-Z])?\s*[–\-~～]\s*(\d{1,2})(?![\d.])', text):
        a, b = int(m.group(1)), int(m.group(2))
        if 1 <= a < b <= 60 and str(a) in num_labels and str(b) in num_labels:
            out.update(str(x) for x in range(a, b + 1))
    for m in re.finditer(r'(?:\bQ|第\s*)(\d{1,2}[A-Z]?)', text):
        if m.group(1) in all_labels or m.group(1).rstrip('ABCD') in num_labels:
            out.add(m.group(1) if m.group(1) in all_labels else m.group(1).rstrip('ABCD'))
    for m in re.finditer(r'^\s*(\d{1,2}[A-Z]?)\s*[:：(（]', text):
        if m.group(1) in all_labels:
            out.add(m.group(1))
    return out


def process_paper(meta, paper, extras, verify, override, source, ctx):
    """回傳這份試卷的結果：{units: [...], skipped: [...], disputes, unresolved, ...}。不寫檔。"""
    sid = source['id']
    tier_labels = source.get('tier_labels') or None
    units, skipped = split_units(paper)
    all_labels = [q.get('label') for s in paper.get('sections') or [] for g in s.get('groups') or [] for q in g.get('questions') or []]
    label_to_unit = {}
    for i, u in enumerate(units):
        for lb in u['labels']:
            label_to_unit[lb] = i
    xq = extras.get('questions') or {}

    # 稽核的爭議與未決事項 → 每個題組的問題
    problems = {i: [] for i in range(len(units))}
    answer_changes = {}
    disputes = []
    for d in verify.get('disputes') or []:
        lb = str(d.get('label'))
        res = override['disputes'].get(lb)
        unit_i = label_to_unit.get(lb)
        entry = {'label': lb, 'key': d.get('key'), 'auditor': d.get('auditor_answer'), 'resolution': res,
                 'group': group_key(units[unit_i]['labels']) if unit_i is not None else None}
        disputes.append(entry)
        if unit_i is None:
            continue
        if res is None:
            problems[unit_i].append(f'第 {lb} 題答案爭議未決（答案表 {d.get("key")}、稽核 {d.get("auditor_answer")}）')
        elif res['decision'] == 'change':
            answer_changes[lb] = res['answer']
    unresolved = []
    for i, text in enumerate(verify.get('unresolved') or []):
        text = text if isinstance(text, str) else json.dumps(text, ensure_ascii=False)
        refs = referenced_labels(text, all_labels)
        groups_hit = sorted({label_to_unit[lb] for lb in refs if lb in label_to_unit})
        ack = override['unresolved'].get(str(i))
        order = {lb: n for n, lb in enumerate(all_labels)}
        unresolved.append({'index': i, 'labels': sorted(refs, key=lambda x: order.get(x, 999)), 'groups': [group_key(units[g]['labels']) for g in groups_hit],
                           'ack': ack})
        for g in groups_hit:
            if ack is None:
                problems[g].append(f'稽核未決事項 #{i} 提到本組，尚未確認是否影響答案')
            elif ack['affects_answer']:
                problems[g].append(f'稽核未決事項 #{i}：{ack["note"]}')

    results = []
    for i, u in enumerate(units):
        key = group_key(u['labels'])
        ov = override['groups'].get(key, {})
        r = {'key': key, 'section': u['section'], 'labels': u['labels'], 'problems': list(problems[i]), 'notes': [], 'override': ov}
        results.append(r)
        if ov.get('exclude'):
            r['excluded'] = f'站方排除：{ov["exclude"]}'
            continue
        group, nomap = build_group(u)
        for q, orig in zip(group['questions'], u['labels']):
            if orig in answer_changes:
                q['answer'] = answer_changes[orig]
                r['notes'].append(f'第 {orig} 題依爭議裁決改答案')
        # 混合題：可接受寫法要補齊
        scoring_extra = None
        if u['section'] == 'mixed':
            acc = ov.get('accepted_answers') or {}
            for q, orig in zip(group['questions'], u['labels']):
                if orig in acc:
                    q['accepted_answers'] = list(acc[orig])
            if ov.get('scoring_extra'):
                renum = dict(zip(u['labels'], (q['label'] for q in group['questions'])))
                scoring_extra = {renum[k]: v for k, v in ov['scoring_extra'].items() if k in renum}
            open_items = [(orig, q) for q, orig in zip(group['questions'], u['labels']) if q.get('mode') in OPEN_MODES]
            r['open_items'] = [{'label': orig, 'mode': q.get('mode'), 'points': q.get('points'),
                                'accepted': len(q.get('accepted_answers') or []), 'answer_table': isinstance(q.get('answer_table'), (list, dict))}
                               for orig, q in open_items]
            if not ov.get('open_key_complete'):
                r['pending_mixed'] = True
                continue
        fmt = format_version(u['section'], group)
        r['format_version'] = fmt
        r['standard'] = is_standard_shape(u['section'], group, fmt)
        # 難度
        plabels = [(xq.get(lb) or {}).get('difficulty_label') for lb in u['labels']]
        r['publisher_labels'] = plabels
        mt, mnote = metrics_tier(u['section'], group)
        r['metrics_tier'], r['metrics_note'] = mt, mnote
        if ov.get('tier'):
            tier, basis = ov['tier'], 'manual'
            r['notes'].append(f'難度由站方指定：{ov.get("tier_reason") or "（未寫理由）"}')
        elif tier_labels and publisher_tier(plabels, tier_labels):
            tier, basis = publisher_tier(plabels, tier_labels), 'publisher'
        else:
            tier, basis = mt, 'metrics'
        r['tier'], r['tier_basis'] = tier, basis
        doc = {
            'schema': SCHEMA, 'uid': None, 'version': None, 'source_id': sid,
            'source_ref': {'paper': None, 'labels': list(u['labels'])},
            'section_type': u['section'], 'format_version': fmt, 'tier': tier, 'tier_basis': basis,
            'group': group,
            'tag_basis': 'agent' if any(q['tags'] for q in group['questions']) or group.get('tags') else 'none',
            'explanation_basis': None,
        }
        if u['section'] == 'mixed':
            doc['open_key'] = 'complete'
            if scoring_extra:
                doc['scoring_extra'] = scoring_extra
        doc['provenance'] = {'license': 'publisher-licensed', 'derivation': 'verbatim', 'attribution_text': source['attribution_zh'], 'sources': []}
        doc['review'] = {'by': REVIEW['by'], 'date': IMPORT_DATE, 'checks': list(REVIEW['checks'])}
        if ov.get('status') == 'draft':
            r['problems'].append(f'站方指定草稿：{ov.get("status_reason") or "（未寫理由）"}')
        doc['status'] = 'draft' if r['problems'] else 'verified'
        hit = official_copy(group)
        if hit:
            kind, text = hit
            r['excluded'] = (f'歷屆原題（official_copy）：{text}' if kind == 'passage' else
                             f'題幹和歷屆試題逐字相同（{text}；通用問法，選文不同）：validate_publisher 目前一律拒收，檢查器放寬後重跑即可匯入')
            r['official_copy'] = kind
            continue
        hit = d8_hit(doc)
        if hit:
            r['excluded'] = hit
            continue
        r['doc'] = doc
        r['shingles'] = shingles(group_text(group))
    return {'units': results, 'skipped': skipped, 'disputes': disputes, 'unresolved': unresolved}


def assign_ids(all_results, out_dir, ctx):
    """uid、版本與輸出路徑（沿用既有檔案的 uid；內容改了才升版本）。"""
    by_pos, used = scan_existing(out_dir)
    for pr in all_results:
        sid = pr['source_id']
        for r in pr['units']:
            doc = r.get('doc')
            if doc is None or r.get('duplicate_of'):
                continue
            labels = tuple(r['labels'])
            prev = sorted(by_pos.get((sid, labels), []), key=lambda x: x['version'])
            if prev:
                uid = prev[-1]['uid']
                doc['uid'] = uid
                doc['version'] = prev[-1]['version']
                if content_key(doc) == prev[-1]['key']:
                    r['version_note'] = '內容沒變' if prev[-1]['status'] == doc['status'] else f'狀態 {prev[-1]["status"]} → {doc["status"]}'
                    r['replace'] = prev[-1]['path']
                else:
                    doc['version'] = prev[-1]['version'] + 1
                    r['version_note'] = f'內容改了：@{prev[-1]["version"]} → @{doc["version"]}'
            else:
                uid = uid_for(sid, list(labels), r['section'], used)
                used.add(uid)
                doc['uid'] = uid
                doc['version'] = 1
                r['version_note'] = '新題組'
            r['path'] = Path(out_dir) / sid / 'v1' / doc['section_type'] / doc['tier'] / f'{doc["uid"]}@{doc["version"]}.json'


def find_duplicates(all_results, existing_uids):
    """跨卷的重複題組：8 字片段重疊 ≥ 50%（以片段少的一組為分母）。保留順序：已輸出過的、verified、學年度早的、試卷 id。"""
    cands = []
    for pr in all_results:
        for r in pr['units']:
            if r.get('doc') is not None and r.get('shingles'):
                cands.append((pr, r))

    def rank(item):
        pr, r = item
        return (0 if r.get('existing') else 1, 0 if r['doc']['status'] == 'verified' else 1, pr['school_year'], pr['paper_id'], r['labels'][0])

    cands.sort(key=rank)
    kept = []
    for pr, r in cands:
        dup = None
        for kpr, kr in kept:
            ratio = overlap_ratio(r['shingles'], kr['shingles'])
            if ratio >= DUP_MIN:
                dup = (kpr, kr, ratio)
                break
        if dup:
            kpr, kr, ratio = dup
            r['duplicate_of'] = f'{kpr["source_id"]} 原卷第 {kr["key"]} 題（重疊 {ratio:.0%}）'
            r['excluded'] = f'跨卷重複：和 {r["duplicate_of"]} 相同或幾乎相同'
            r['doc'] = None
        else:
            kept.append((pr, r))


def write_doc(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


# ---------------------------------------------------------------------------
# 檢查表
# ---------------------------------------------------------------------------

def _labels_text(labels):
    return f'{labels[0]}–{labels[-1]}' if len(labels) > 1 else labels[0]


def label_range_text(labels):
    """題號清單 → 「41–44」「41–43、45」（item-source.ts 的 labelRangeText）。"""
    parts, i = [], 0
    while i < len(labels):
        j = i
        if labels[i].isdigit():
            while j + 1 < len(labels) and labels[j + 1].isdigit() and int(labels[j + 1]) == int(labels[j]) + 1:
                j += 1
        parts.append(f'{labels[i]}–{labels[j]}' if j > i else labels[i])
        i = j + 1
    return '、'.join(parts)


def _label_counts(labels):
    order = ['易', '中偏易', '中', '中偏難', '難']
    c = {x: labels.count(x) for x in order if labels.count(x)}
    return '、'.join(f'{k}{v}' for k, v in c.items()) or '—'


def render_report(all_results, pending, sources_added, validation=None):
    L = []
    w = L.append
    w('# 出版社模考匯入檢查表')
    w('')
    w('由 `tools/import_publisher.py` 產生（請勿手改；要改請改 `tools/publisher_import/overrides/` 後重跑）。'
      '本表只列題號、題型、難度與檢查結果，不含題目、答案與詳解文字。')
    w('')
    w('## 總覽')
    w('')
    tot = {'verified': 0, 'draft': 0}
    by_type_tier = {}
    excluded, pending_mixed = 0, 0
    nonstd = 0
    for pr in all_results:
        for r in pr['units']:
            if r.get('doc'):
                tot[r['doc']['status']] += 1
                k = (r['section'], r['doc']['tier'])
                by_type_tier[k] = by_type_tier.get(k, 0) + 1
                nonstd += 0 if r.get('standard') else 1
            elif r.get('pending_mixed'):
                pending_mixed += 1
            elif r.get('excluded'):
                excluded += 1
    w(f'- 匯入的試卷：{len(all_results)} 回（有獨立稽核紀錄的才匯入）；還在稽核、這次沒有匯入：{len(pending)} 回'
      + (f'（{"、".join(pending)}）' if pending else '') + '。')
    w(f'- 輸出的題組：{tot["verified"] + tot["draft"]} 組（verified {tot["verified"]}、draft {tot["draft"]}）；'
      f'其中形狀和學測標準不同、只進題庫練習的 {nonstd} 組。')
    w(f'- 沒有輸出：混合題待補齊可接受答案 {pending_mixed} 組；其他排除 {excluded} 組（原因見各卷）；中譯英、作文第一版不收。')
    agree = [r['metrics_tier'] == r['doc']['tier'] for pr in all_results for r in pr['units'] if r.get('doc') and r['doc']['tier_basis'] == 'publisher']
    if agree:
        w(f'- 依出版社標示分級的題組，和文章指標推估一致 {sum(agree)}／{len(agree)} 組（不一致時採出版社標示；站主要改可在覆寫檔指定 tier）。')
    w(f'- 來源登記（`data/sources.json`）：每回試卷一筆，這次匯入的 {len(all_results)} 回都已登記。')
    w('')
    w('| 題型 | 穩定基礎 | 進階練習 | 超越頂標 | 合計 |')
    w('|---|---|---|---|---|')
    for sec in UID_CODES:
        row = [by_type_tier.get((sec, t), 0) for t in TIERS]
        if sum(row):
            w(f'| {SECTION_ZH[sec]} | ' + ' | '.join(str(x) for x in row) + f' | {sum(row)} |')
    w('')
    if validation is not None:
        w(f'- `validate_publisher.py`：{validation["text"]}。')
        w('')
    w('## 規則')
    w('')
    w('- **授權**：每回試卷一個來源（`pub-{試卷代號}`），授權範圍 web、pdf、ai_assist（不含 explanations：出版社詳解不公開、不進 repo），'
      '`public_ok` true、沒有到期日。出處句一律用預設格式「本題出自{出版社}《{書名}》，經授權使用」。'
      '上線前請站主再確認一次：授權來自每回試卷的著作權人（翰林、南一，以及臺北區、臺中市聯合模擬考的主辦單位），'
      '不是彙編本的整理者（彙編本自己的說明寫「試題著作權屬各命題單位所有」）；repo 是公開的，推上去就等於公開題目。')
    w('- **難度（翰林、北模、中模：詳解印了逐題五級難易度）**：依出版社逐題標示，易、中偏易 → 穩定基礎；中 → 進階練習；中偏難、難 → 超越頂標。題組取各題（0／1／2）的平均，'
      '< 0.5 穩定基礎、< 1.5 進階練習、其餘超越頂標（剛好在界線上算較難的一級）。'
      '理由：G50 只靠全體答對率的門檻是 P ≥ .514 穩定基礎、.393 ≤ P < .514 進階練習；標「中」的題目答對率約五成，'
      '代入 p_only 迴歸得 Pc ≈ .48（< .50）、Pb ≈ .65（≥ .50），正好是進階練習；「中偏易」約六成以上，Pc ≥ .50，是穩定基礎；'
      '「中偏難」約四成以下，Pb < .50，是超越頂標。')
    w('- **難度（南一：詳解沒有印難易度）**：沒有作答統計（G50 的 stats 不適用）也沒有出版社標示，用文章指標：'
      '`tools/text_metrics.py` 的字數、L1–4／L1–6 覆蓋率、表外字比例、平均句長和三級的帶（`data/specs/tiers.json`）比距離，取最近的一級。'
      '詞彙題用 10 題正解的詞表級別平均：< 3.85 穩定基礎、< 4.5 進階練習、其餘超越頂標。依出版社標示分級的題組也列出指標的結果供對照。')
    w('- **狀態**：題組沒有未決的答案爭議、稽核未決事項都確認過不影響答案 → verified；否則 draft（不發布）。'
      '混合題要補齊所有填充、簡答的可接受寫法並由校對者確認後才輸出（`open_key: complete`）。')
    w('- **重複**：跨卷 8 字片段重疊 ≥ 50% 的題組只留一組。')
    w('- **形狀**：和學測標準不同的題組照收，`format_version` 寫實際形狀，只進題庫練習、不進任何卷子。')
    w('')
    for pr in all_results:
        src = pr['source']
        w(f'## {pr["paper_id"]}：{src["label_zh"]}《{src["product_zh"]}》')
        w('')
        ev = pr['evidence']
        w(f'- 來源 id：`{src["id"]}`；出版者：{src["publisher_zh"]}；目錄標示：{pr["meta"]["label_from_toc"]} {pr["meta"]["series_code"]}'
          f'（{pr["meta"]["exam_name_from_toc"]}）')
        printed = ev.get('printed_company')
        w(f'- 印刷證據：{"印有「" + printed + "」" if printed else "題本與詳解都沒有印公司名稱，依目錄標示"}；'
          f'考試名稱「{_compact(ev.get("printed_exam_title"))}」；代碼 {"、".join(ev.get("printed_codes") or []) or "—"}；'
          f'和目錄標示{"一致" if ev.get("matches_toc_label") else "不完全一致（見稽核）"}。')
        st = pr.get('stats_line')
        if st:
            w(f'- 成績統計（目錄頁）：{st}')
        w('')
        w('| 原卷題號 | 題型 | 形狀 | 難度（依據） | 出版社標示 | 指標推估 | uid@版本 | 狀態 | 備註 |')
        w('|---|---|---|---|---|---|---|---|---|')
        for r in pr['units']:
            sec = SECTION_ZH[r['section']]
            lab = _labels_text(r['labels'])
            if r.get('doc'):
                d = r['doc']
                shape = d['format_version'] + ('' if r.get('standard') else '（非標準，只進練習）')
                tier = f'{TIER_ZH[d["tier"]]}（{d["tier_basis"]}）'
                plab = _label_counts([x for x in r.get('publisher_labels') or [] if x])
                agree = '' if r['tier_basis'] != 'publisher' else ('，一致' if r['metrics_tier'] == d['tier'] else '，不一致')
                mt = f'{TIER_ZH[r["metrics_tier"]]}{agree}'
                status = d['status']
                vnote = r.get('version_note') or ''
                notes = '；'.join(r['problems'] + r['notes'] + ([vnote] if vnote.startswith(('內容改了', '狀態')) else []))
                w(f'| {lab} | {sec} | {shape} | {tier} | {plab} | {mt} | `{d["uid"]}@{d["version"]}` | {status} | {notes.strip("；")} |')
            elif r.get('pending_mixed'):
                w(f'| {lab} | {sec} | — | — | — | — | — | 未輸出 | 待補齊可接受答案（見下） |')
            else:
                w(f'| {lab} | {sec} | — | — | — | — | — | 排除 | {r.get("excluded")} |')
        for s in pr['skipped']:
            reason = '第一版不收' if s['reason'] == 'not_v1' else '學測沒有的題型（unsupported_section）'
            w(f'| {_labels_text(s["labels"])} | {SECTION_ZH.get(s["section"], s["section"])} | — | — | — | — | — | 不匯入 | {reason} |')
        w('')
        if pr['disputes']:
            w('**答案爭議**')
            w('')
            for d in pr['disputes']:
                res = d['resolution']
                if res is None:
                    rtext = '未裁決：題組維持草稿'
                elif res['decision'] == 'keep':
                    rtext = f'維持答案表：{res["reason"]}'
                else:
                    rtext = f'改答案：{res["reason"]}'
                w(f'- 第 {d["label"]} 題（題組 {d["group"]}）：答案表 {d["key"]}、稽核 {d["auditor"]} → {rtext}')
            w('')
        acks = [u for u in pr['unresolved'] if u['groups']]
        if acks:
            w('**稽核未決事項（涉及匯入的題組）**')
            w('')
            for u in acks:
                a = u['ack']
                state = '未確認：題組維持草稿' if a is None else ('影響答案：題組維持草稿；' + a['note'] if a['affects_answer'] else '不影響答案：' + a['note'])
                w(f'- #{u["index"]}（第 {label_range_text(u["labels"])} 題；題組 {"、".join(u["groups"])}）：{state}')
            w('')
        mixed = [r for r in pr['units'] if r.get('pending_mixed')]
        if mixed:
            w('**混合題待補齊**（填充、簡答要列出所有可接受寫法、部分給分寫法，校對者確認後在覆寫檔標 `open_key_complete`）')
            w('')
            for r in mixed:
                items = '、'.join(f'{x["label"]}（{x["mode"]}，{x["points"]} 分，已列可接受寫法 {x["accepted"]} 種'
                                 + ('，有表格答案' if x['answer_table'] else '') + '）' for x in r.get('open_items') or [])
                w(f'- 題組 {r["key"]}：{items or "沒有填充簡答（只要確認選擇題計分）"}')
                for u in pr['unresolved']:
                    if r['key'] in u['groups'] and u['ack'] is not None:
                        w(f'  - 稽核 #{u["index"]}：{u["ack"]["note"]}')
            w('')
        notes = pr['override'].get('notes') or []
        if notes:
            w('**站方備註**')
            w('')
            for n in notes:
                w(f'- {n}')
            w('')
    return '\n'.join(L).rstrip() + '\n'


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------

def stats_line(meta):
    t = meta.get('divider_text') or ''
    m = re.search(r'頂標 前標 均標 後標 底標 ([\d—\- ]+?) 級距', t)
    five = m.group(1).split() if m else None
    n = re.search(r'到考 ([\d,]+) 人', t)
    parts = []
    if five and len(five) == 5:
        parts.append('五標 ' + '／'.join(five) + ' 級分')
    if n:
        parts.append(f'到考 {n.group(1)} 人')
    return '、'.join(parts) if parts else None


def run(work, out_dir=OUT_DIR, sources_file=SOURCES_FILE, overrides_dir=OVERRIDES_DIR, report_file=REPORT_FILE,
        papers=None, dry_run=False, validator=None):
    work = Path(work)
    manifest = load_json(work / 'manifest.json')
    metas = {m['paper_id']: m for m in manifest['papers']}
    pdir = work / 'papers'
    # 來源登記：28 回全部登記（還在稽核的也先登記，題組等稽核完再匯入）
    existing = load_sources(sources_file)
    new_entries = []
    for pid, meta in sorted(metas.items()):
        ex = pdir / f'{pid}.extras.json'
        extras = load_json(ex) if ex.exists() else {}
        labels = [(q or {}).get('difficulty_label') for q in (extras.get('questions') or {}).values()]
        new_entries.append(source_entry(meta, extras.get('publisher_evidence') or {}, labels))
    entries, added = merged_sources(existing, new_entries)
    reg = {e['id']: e for e in entries}

    verified_ids = sorted(pid for pid in metas if (pdir / f'{pid}.verify.json').exists())
    pending = sorted(pid for pid in metas if pid not in verified_ids)
    todo = [p for p in verified_ids if papers is None or p in papers]
    by_pos, used = scan_existing(out_dir)
    results = []
    for pid in todo:
        meta = metas[pid]
        paper = load_json(pdir / f'{pid}.json')
        extras = load_json(pdir / f'{pid}.extras.json')
        verify = load_json(pdir / f'{pid}.verify.json')
        override = load_override(pid, overrides_dir)
        source = reg[source_id_of(pid)]
        pr = process_paper(meta, paper, extras, verify, override, source, {})
        pr.update({'paper_id': pid, 'source_id': source['id'], 'source': source, 'meta': meta, 'school_year': meta['school_year'],
                   'evidence': extras.get('publisher_evidence') or {}, 'override': override, 'stats_line': stats_line(meta)})
        for r in pr['units']:
            r['existing'] = bool(by_pos.get((source['id'], tuple(r['labels']))))
        results.append(pr)
    # 重複比對要看所有已匯入的試卷：只重做部分試卷時，其他試卷的題組從既有檔案讀回來比對
    others = []
    if papers is not None:
        for pid in verified_ids:
            if pid in todo:
                continue
            sid = source_id_of(pid)
            units = []
            for (s, labels), recs in by_pos.items():
                if s != sid:
                    continue
                d = load_json(sorted(recs, key=lambda x: x['version'])[-1]['path'])
                units.append({'key': group_key(list(labels)), 'labels': list(labels), 'section': d['section_type'], 'doc': d,
                              'shingles': shingles(group_text(d['group'])), 'existing': True, 'problems': [], 'notes': []})
            others.append({'paper_id': pid, 'source_id': sid, 'school_year': metas[pid]['school_year'], 'units': units})
    find_duplicates(results + others, used)
    assign_ids(results, out_dir, {})
    report_results = results
    if not dry_run:
        Path(sources_file).parent.mkdir(parents=True, exist_ok=True)
        Path(sources_file).write_text(dump_sources(entries), encoding='utf-8')
        for pr in results:
            for r in pr['units']:
                if r.get('doc') is not None:
                    write_doc(r['path'], r['doc'])
    validation = None
    if validator is not None and not dry_run:
        files = [r['path'] for pr in results for r in pr['units'] if r.get('doc') is not None]
        validation = validator(files, sources_file)
    if papers is None and not dry_run:
        Path(report_file).parent.mkdir(parents=True, exist_ok=True)
        Path(report_file).write_text(render_report(report_results, pending, added, validation), encoding='utf-8')
    return {'results': results, 'pending': pending, 'sources_added': added, 'entries': entries, 'validation': validation}


def load_validator(path):
    """載入 P1 的 validate_publisher.py（路徑可以在別的工作目錄），回傳檢查函式；同時讓 official_copy 改用它的規則。"""
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location('validate_publisher', str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules['validate_publisher'] = mod
    spec.loader.exec_module(mod)

    def check(files, sources_file):
        sources = mod.load_sources(str(sources_file))
        reports = [mod.check_file(Path(f), sources, IMPORT_DATE) for f in files]
        bad = [r for r in reports if r.errors]
        kinds = {}
        for r in reports:
            for w in r.warnings:
                k = w.split(':', 1)[0]
                kinds[k] = kinds.get(k, 0) + 1
        warn = '、'.join(f'{k} {v}' for k, v in sorted(kinds.items())) or '無'
        return {'files': len(reports), 'errors': len(bad), 'text': f'{len(reports)} 個檔案，{len(bad)} 個有 error；warning：{warn}',
                'bad': [(r.name, r.errors[:3]) for r in bad]}
    return check


def summarize(res):
    out = {'papers': len(res['results']), 'pending_papers': res['pending'], 'by_type_tier': {}, 'verified': 0, 'draft': 0,
           'pending_mixed': [], 'excluded': [], 'files': []}
    for pr in res['results']:
        for r in pr['units']:
            if r.get('doc'):
                d = r['doc']
                out[d['status']] += 1
                k = f'{d["section_type"]}/{d["tier"]}'
                out['by_type_tier'][k] = out['by_type_tier'].get(k, 0) + 1
                out['files'].append(str(r['path']))
            elif r.get('pending_mixed'):
                out['pending_mixed'].append(f'{pr["paper_id"]} {r["key"]}')
            else:
                out['excluded'].append(f'{pr["paper_id"]} {r["key"]}：{r.get("excluded")}')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--work', required=True, help='轉錄目錄（含 manifest.json 與 papers/）')
    ap.add_argument('--paper', action='append', help='只處理這份試卷（可重複）；不給就處理所有有 .verify.json 的試卷')
    ap.add_argument('--out', default=str(OUT_DIR))
    ap.add_argument('--sources', default=str(SOURCES_FILE))
    ap.add_argument('--overrides', default=str(OVERRIDES_DIR))
    ap.add_argument('--report', default=str(REPORT_FILE))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--json', action='store_true', help='印 JSON 摘要')
    ap.add_argument('--validator', help='P1 的 validate_publisher.py 路徑（預設用同目錄的；找不到就只做本工具自己的檢查）')
    a = ap.parse_args(argv)
    vpath = Path(a.validator) if a.validator else TOOLS / 'validate_publisher.py'
    validator = load_validator(vpath) if vpath.exists() else None
    res = run(a.work, Path(a.out), Path(a.sources), Path(a.overrides), Path(a.report), papers=a.paper, dry_run=a.dry_run,
              validator=validator)
    s = summarize(res)
    if a.json:
        print(json.dumps({k: v for k, v in s.items() if k != 'files'}, ensure_ascii=False, indent=1))
    else:
        print(f'試卷 {s["papers"]} 回；題組 verified {s["verified"]}、draft {s["draft"]}；混合題待補 {len(s["pending_mixed"])}；排除 {len(s["excluded"])}')
        if res['validation']:
            print(f'validate_publisher：{res["validation"]["text"]}')
            for name, errs in res['validation']['bad']:
                print(f'  ERR {name}: {errs}')
        for k, v in sorted(s['by_type_tier'].items()):
            print(f'  {k}: {v}')
        for x in s['excluded']:
            print(f'  排除 {x}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
