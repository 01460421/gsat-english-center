#!/usr/bin/env python3
"""檢查 data/exams/parsed/*.json 是否符合 docs/exam-json-schema.md（gsat-exam/v1.1）。

用法：
    python3 tools/validate_exam.py data/exams/parsed/gsat-115.json [...]
    python3 tools/validate_exam.py --all

error 代表資料一定有問題：缺欄位或未知欄位、封閉集合以外的標註值、題號斷掉、答案不在選項裡、
選文的空格對不上題號、強調標記不成對、殘留不換行空格、新欄位（word_count、answer_segments、
scoring_exception、refers_to…）格式錯誤。v1 檔案一律是 error：請先跑 tools/normalize_exams.py。
warning 是可能合理但需要人看一眼的情況（例如舊卷沒有統計、配分加總對不上）。
有任何 error 時結束碼為 1。
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / 'data' / 'exams' / 'parsed'

SCHEMA_ID = 'gsat-exam/v1.1'

SECTION_TYPES = {'vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed',
                 'sentence_matching', 'short_answer', 'translation', 'composition', 'other'}
MODES = {'single_choice', 'multi_select', 'bank_choice', 'fill_in_blank', 'short_answer',
         'table_completion', 'translation', 'composition'}
CHOICE_MODES = {'single_choice', 'multi_select', 'bank_choice'}
BANK_TYPES = {'word_bank', 'structure', 'sentence_matching'}
BLANK_TYPES = {'cloze', 'word_bank', 'structure'}
TEST_POINTS = {'word_meaning', 'collocation', 'phrase', 'connective', 'grammar', 'word_form', 'discourse'}
POS = {'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause'}
ANSWER_FUNCTIONS = POS - {'phrase', 'clause'}
GRAMMAR_POINTS = {'tense', 'passive', 'participle', 'relative_clause', 'noun_clause', 'adverb_clause',
                  'conditional', 'subjunctive', 'inversion', 'comparison', 'infinitive_gerund', 'modal',
                  'agreement', 'pronoun', 'determiner', 'article', 'preposition', 'conjunction',
                  'parallel_structure', 'with_construction', 'causative', 'emphasis', 'existential',
                  'substitution', 'degree', 'other'}
CLUES = {'pronoun_reference', 'lexical_cohesion', 'transition_word', 'topic_sentence', 'contrast', 'example',
         'elaboration', 'enumeration', 'summary', 'chronology', 'other'}
ITEM_TYPES = {'main_idea', 'detail', 'inference', 'vocab_in_context', 'reference', 'purpose',
              'tone_attitude', 'structure', 'chart_reading', 'sequencing', 'title', 'not_mentioned',
              'application', 'synthesis'}
GENRES = {'news', 'expository', 'narrative', 'biography', 'letter_email', 'advertisement', 'dialogue',
          'opinion', 'instructions', 'poem', 'other'}
TEXT_FORMATS = {'continuous', 'chart', 'table', 'multi_text', 'map', 'form', 'timeline', 'mixed'}
ESSAY_TYPES = {'picture', 'chart', 'letter', 'topic', 'continuation', 'other'}
SCORING_EXCEPTION_TYPES = {'all_credit', 'multiple_correct', 'other'}
ID_RE = re.compile(r'^(gsat|ast)-\d{2,3}(-makeup)?$|^ref-\d{2,3}(-[a-z])?$')
BLANK_RE = re.compile(r'\[\[(\d+)\]\]')

# ---------------------------------------------------------------------------
# 欄位表：(必填, 選填)。不在兩者之內的鍵是「未知欄位」，一律 error。
# ---------------------------------------------------------------------------

TOP_KEYS = ({'schema', 'id', 'exam', 'year', 'session', 'title', 'time_minutes', 'full_score', 'sources',
             'sections', 'extraction'}, {'parts'})
SOURCES_KEYS = ({'paper', 'answer', 'scoring', 'stats'}, {'paper_word', 'answer_sheet', 'other'})
EXTRACTION_KEYS = ({'method', 'issues', 'verified_by'}, set())
PART_KEYS = ({'title', 'points', 'instructions', 'sections'}, set())
SECTION_KEYS = ({'id', 'type', 'title', 'part', 'instructions', 'points_total', 'groups'}, {'stats'})
SECTION_STATS_KEYS = ({'score_distribution'}, {'source', 'max_score', 'registered', 'absent', 'examinees',
                                               'rate_base', 'note'})
BIN_KEYS = ({'range', 'count'}, {'min', 'max', 'rate', 'cumulative_count', 'cumulative_rate'})
GROUP_KEYS = ({'id', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions', 'tags'}, {'group_label'})
PASSAGE_PART_KEYS = ({'label', 'title', 'text'}, set())
FIGURE_KEYS = ({'kind', 'caption', 'description'}, {'rows', 'label', 'question_no'})
QUESTION_KEYS = ({'no', 'label', 'mode', 'stem', 'options', 'answer', 'accepted_answers', 'points', 'stats',
                  'scoring_notes', 'tags'},
                 {'refers_to', 'answer_segments', 'answer_variants', 'answer_is_composite', 'answer_table',
                  'scoring_exception', 'reused_from'})
Q_STATS_KEYS = (set(), {'correct_rate', 'high_group', 'low_group', 'discrimination', 'option_rates',
                        'option_rates_high', 'option_rates_low', 'omit_rate', 'full_correct_rate', 'five_groups'})
REUSED_KEYS = ({'exam', 'no', 'modified'}, set())
SCORING_EXCEPTION_KEYS = ({'type'}, {'note'})
REFERS_TO_KEYS = ({'text', 'occurrence'}, {'note'})
WORD_COUNT_KEYS = ({'min', 'max', 'approx'}, set())
GROUP_TAG_KEYS = (set(), {'topic', 'genre', 'sdgs', 'text_format'})

CHOICE_TAGS = {'test_point', 'answer_pos', 'answer_function', 'grammar_point', 'grammar_point_raw', 'key_phrase'}
ITEM_TAGS = {'item_type', 'item_type_raw', 'key_phrase'}
QUESTION_TAGS_BY_SECTION = {
    'vocabulary': CHOICE_TAGS, 'cloze': CHOICE_TAGS, 'word_bank': CHOICE_TAGS, 'sentence_matching': CHOICE_TAGS,
    'structure': {'clue', 'clue_raw', 'key_phrase'},
    'reading': ITEM_TAGS, 'mixed': ITEM_TAGS, 'short_answer': ITEM_TAGS, 'other': ITEM_TAGS,
    'translation': {'patterns', 'topic'},
    'composition': {'essay_type', 'paragraphs', 'word_count', 'word_requirement_raw', 'topic'},
}

# ---------------------------------------------------------------------------
# 文字：看不見的字元、強調標記
# ---------------------------------------------------------------------------

INVISIBLE = set('\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f'
                '\u200b\u200c\u200d\u2060\ufeff\u00ad')
ALLOWED_MARKUP = {'u', 'b'}
MARKUP_RE = re.compile(r'<(/?)([A-Za-z][A-Za-z0-9]*)([^<>]*)>')
NOT_RE = re.compile(r'\b(NOT|EXCEPT)\b')
TEXT_FORMAT_BY_FIGURE = {'chart': 'chart', 'graph': 'chart', 'diagram': 'chart', 'table': 'table', 'map': 'map',
                         'form': 'form', 'timeline': 'timeline'}
# 不檢查強調標記的路徑：解析紀錄與備註會用文字提到 <u> 這類標記本身
NO_MARKUP_KEYS = {'extraction', 'reused_from', 'note', 'tags'}


class Report:
    def __init__(self, name):
        self.name = name
        self.errors = []
        self.warnings = []

    def err(self, where, msg):
        self.errors.append(f'{where}: {msg}')

    def warn(self, where, msg):
        self.warnings.append(f'{where}: {msg}')


def nonempty_str(x):
    return isinstance(x, str) and x.strip() != ''


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def is_rate(x):
    return is_num(x) and 0 <= x <= 1


def str_or_null(x):
    return x is None or isinstance(x, str)


def check_keys(r, where, obj, spec):
    if not isinstance(obj, dict):
        r.err(where, '必須是物件')
        return False
    required, optional = spec
    for k in sorted(required - obj.keys()):
        r.err(where, f'缺少欄位 {k}')
    for k in sorted(obj.keys() - required - optional):
        hint = '（v1 欄位，請先跑 tools/normalize_exams.py）' if k in V1_ONLY_KEYS else ''
        r.err(where, f'未知欄位 {k}{hint}')
    return True


V1_ONLY_KEYS = {'word_requirement', 'part_title', 'part_instructions', 'score_distribution', 'no_answer_rate',
                'bins', 'score_range', 'percent', 'cum_count', 'cum_percent', 'cumulative_percent', 'name',
                'full_marks', 'examinees_registered', 'examinees_present', 'percent_base', 'score_distribution_base'}


def markup_problem(s):
    """強調標記只允許 <u>…</u> 與 <b>…</b>，不可帶屬性、必須成對、不可交錯或自我巢狀、內容不可為空。"""
    stack = []
    last_open_end = {}
    for m in MARKUP_RE.finditer(s):
        closing, name, attrs = m.group(1) == '/', m.group(2), m.group(3)
        if name not in ALLOWED_MARKUP or attrs.strip():
            return f'不允許的標記 {m.group(0)}（只能用 <u>…</u>、<b>…</b>）'
        if not closing:
            if name in stack:
                return f'<{name}> 巢狀在另一個 <{name}> 裡'
            stack.append(name)
            last_open_end[name] = m.end()
        else:
            if not stack or stack[-1] != name:
                return f'</{name}> 沒有對應的開頭標記，或標記交錯'
            stack.pop()
            if not s[last_open_end[name]:m.start()].strip():
                return f'<{name}></{name}> 內容是空的'
    if stack:
        return f'<{stack[-1]}> 沒有結尾標記'
    return None


def strip_markup(s):
    return MARKUP_RE.sub('', s)


def is_wide(ch):
    return ch != '\u3000' and unicodedata.east_asian_width(ch) in ('W', 'F')


def check_text(r, where, s, markup):
    if '\u00a0' in s:
        r.err(where, '殘留 U+00A0（不換行空格），請換成一般空格')
    # 看不見的字元：清單內的、所有控制字元（換行除外）、格式字元（Cf：零寬、方向標記…）、
    # 行／段落分隔符（Zl、Zp），以及一般空格與 U+3000 以外的 Unicode 空白（Zs）
    bad = sorted({f'U+{ord(c):04X}' for c in s
                  if c in INVISIBLE or (unicodedata.category(c) == 'Cc' and c != '\n')
                  or unicodedata.category(c) in ('Cf', 'Zl', 'Zp')
                  or (unicodedata.category(c) == 'Zs' and c not in ' 　 ')})
    if bad:
        r.err(where, f'含看不見的特殊字元 {", ".join(bad)}')
    for i, c in enumerate(s):
        if c == '\u3000':
            prev = s[i - 1] if i else ''
            nxt = s[i + 1] if i + 1 < len(s) else ''
            if not ((prev and is_wide(prev)) or (nxt and is_wide(nxt))):
                r.err(where, '英文文字中有全形空白 U+3000')
                break
    if markup:
        p = markup_problem(s)
        if p:
            r.err(where, p)


def walk_strings(x, path, markup=True):
    if isinstance(x, str):
        yield path, x, markup
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from walk_strings(v, f'{path}[{i}]', markup)
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from walk_strings(v, f'{path}.{k}' if path else k, markup and k not in NO_MARKUP_KEYS)


def find_occurrences(text, needle):
    """needle 在 text 中出現的位置。needle 以英數字開頭（結尾）時，前（後）一個字元不可是英數字，
    所以找 "it" 不會算到 "with" 裡的 it。refers_to.occurrence 依這個定義計數。"""
    if not needle:
        return []
    out = []
    start = 0
    while True:
        i = text.find(needle, start)
        if i < 0:
            return out
        before = text[i - 1] if i else ''
        after = text[i + len(needle)] if i + len(needle) < len(text) else ''
        ok = not (needle[0].isalnum() and before.isalnum()) and not (needle[-1].isalnum() and after.isalnum())
        if ok:
            out.append(i)
        start = i + 1


def join_segments(parts):
    """answer_segments 的串接規則：略過空字串、以單一空格相接、標點前不留空格。"""
    s = ' '.join(p for p in parts if p)
    return re.sub(r'\s+([,.;:?!])', r'\1', s)


def group_text(g):
    """refers_to 計數用的選文：passage 接著各 passage_parts.text，以換行相接，去掉強調標記。"""
    texts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    return strip_markup('\n'.join(t for t in texts if t))


def expected_text_format(g):
    has_passage = nonempty_str(g.get('passage'))
    parts = g.get('passage_parts') or []
    figs = g.get('figures') or []
    has_text = has_passage or bool(parts)
    if not has_text and not figs:
        return None
    if figs and has_text:
        return 'mixed'
    if len(parts) >= 2:
        return 'multi_text'
    if figs:
        kinds = {TEXT_FORMAT_BY_FIGURE.get(f.get('kind')) for f in figs if isinstance(f, dict)}
        return kinds.pop() if len(kinds) == 1 else None
    return 'continuous'


# ---------------------------------------------------------------------------
# 標註
# ---------------------------------------------------------------------------

def check_question_tags(r, where, tags, stype, q, bank):
    if not isinstance(tags, dict):
        r.err(where, 'tags 必須是物件（沒有可標的就寫 {}）')
        return
    allowed = QUESTION_TAGS_BY_SECTION.get(stype, set())
    for k in tags:
        if k == 'word_requirement':
            r.err(where, 'tags.word_requirement 是 v1 欄位，v1.1 改為 word_count＋word_requirement_raw（請先跑 normalize）')
        elif k not in allowed:
            known = any(k in v for v in QUESTION_TAGS_BY_SECTION.values())
            r.err(where, f'tags.{k} {"不適用於 " + stype + " 大題" if known else "是未知欄位"}')

    def enum(key, values):
        v = tags.get(key)
        if key in tags and v not in values:
            r.err(where, f'tags.{key}={v!r} 不在封閉集合內')

    enum('test_point', TEST_POINTS)
    enum('answer_pos', POS)
    enum('answer_function', ANSWER_FUNCTIONS)
    enum('grammar_point', GRAMMAR_POINTS)
    enum('clue', CLUES)
    enum('item_type', ITEM_TYPES)
    enum('essay_type', ESSAY_TYPES)
    for key in ('key_phrase', 'topic', 'grammar_point_raw', 'clue_raw', 'item_type_raw', 'word_requirement_raw'):
        if key in tags and not nonempty_str(tags[key]):
            r.err(where, f'tags.{key} 必須是非空字串')
    for raw, base in (('grammar_point_raw', 'grammar_point'), ('clue_raw', 'clue'), ('item_type_raw', 'item_type')):
        if raw in tags and base not in tags:
            r.err(where, f'有 tags.{raw} 卻沒有 tags.{base}')
    if 'patterns' in tags and not (isinstance(tags['patterns'], list) and all(nonempty_str(x) for x in tags['patterns'])):
        r.err(where, 'tags.patterns 必須是字串陣列')
    if 'paragraphs' in tags and not (is_int(tags['paragraphs']) and tags['paragraphs'] >= 1):
        r.err(where, 'tags.paragraphs 必須是正整數')
    if 'answer_function' in tags and tags.get('answer_pos') != 'phrase':
        r.err(where, 'tags.answer_function 只用在 answer_pos 為 phrase 的題目')
    if 'word_count' in tags:
        check_word_count(r, where, tags['word_count'])
    elif stype == 'composition':
        r.warn(where, '作文沒有 tags.word_count')
    if 'word_requirement_raw' in tags and 'word_count' not in tags:
        r.err(where, '有 tags.word_requirement_raw 卻沒有 tags.word_count')

    # 規則：選擇題答案兩個字以上一律標 phrase（整句保留 clause）
    if stype in ('vocabulary', 'cloze', 'word_bank'):
        pool = q.get('options') or bank or {}
        at = pool.get(q.get('answer')) if isinstance(q.get('answer'), str) and isinstance(pool, dict) else None
        if isinstance(at, str):
            multi = len(strip_markup(at).split()) > 1
            pos = tags.get('answer_pos')
            if multi and pos not in ('phrase', 'clause'):
                r.err(where, f'答案「{at}」是兩個字以上，answer_pos 應為 phrase（原詞性放 answer_function）或 clause')
            elif not multi and pos in ('phrase', 'clause'):
                r.warn(where, f'答案「{at}」只有一個字，answer_pos 卻是 {pos}')
    # 規則：閱讀／混合題題幹有大寫 NOT／EXCEPT 一律 not_mentioned
    if stype in ('reading', 'mixed') and NOT_RE.search(q.get('stem') or '') and 'item_type' in tags \
            and tags['item_type'] != 'not_mentioned':
        r.err(where, f'題幹有大寫 NOT／EXCEPT，item_type 應為 not_mentioned（目前 {tags["item_type"]}）')


def check_word_count(r, where, wc):
    if not check_keys(r, f'{where}.tags.word_count', wc, WORD_COUNT_KEYS):
        return
    vals = {k: wc.get(k) for k in ('min', 'max', 'approx')}
    for k, v in vals.items():
        if v is not None and not (is_int(v) and v > 0):
            r.err(where, f'tags.word_count.{k} 必須是正整數或 null')
    if all(v is None for v in vals.values()):
        r.err(where, 'tags.word_count 的 min／max／approx 不可全是 null')
    if vals['approx'] is not None and (vals['min'] is not None or vals['max'] is not None):
        r.err(where, 'tags.word_count 有 approx 時 min、max 必須是 null')
    if is_int(vals['min']) and is_int(vals['max']) and vals['min'] > vals['max']:
        r.err(where, 'tags.word_count.min 大於 max')


def check_group_tags(r, where, tags, stype, g):
    if tags is None:
        return
    if not check_keys(r, f'{where}.tags', tags, GROUP_TAG_KEYS):
        return
    for key, values in (('genre', GENRES), ('text_format', TEXT_FORMATS)):
        if key in tags and tags[key] not in values:
            r.err(where, f'tags.{key}={tags[key]!r} 不在封閉集合內')
    if 'topic' in tags and not nonempty_str(tags['topic']):
        r.err(where, 'tags.topic 必須是非空字串')
    sdgs = tags.get('sdgs')
    if 'sdgs' in tags and (not isinstance(sdgs, list) or any(not is_int(n) or not 1 <= n <= 17 for n in sdgs)):
        r.err(where, 'tags.sdgs 必須是 1–17 的整數陣列')


def check_rates_map(r, where, key, rates, mode=None):
    if rates is None:
        return
    if not isinstance(rates, dict):
        r.err(where, f'stats.{key} 必須是物件或 null')
        return
    bad = [k for k, v in rates.items() if not re.fullmatch(r'[A-Z]', k) or not is_rate(v)]
    if bad:
        r.err(where, f'stats.{key} 的 {bad} 不是「選項代號: 0–1 的小數」')
    total = sum(v for v in rates.values() if is_num(v))
    # 多選題每個選項各自勾選，加總本來就會超過 1
    if total > 1.05 and key == 'option_rates' and mode != 'multi_select':
        r.warn(where, f'stats.{key} 加總 {total:.2f} > 1')


def check_stats(r, where, stats, mode):
    if stats is None:
        return
    if not check_keys(r, f'{where}.stats', stats, Q_STATS_KEYS):
        return
    for k in ('correct_rate', 'high_group', 'low_group', 'omit_rate', 'full_correct_rate'):
        v = stats.get(k)
        if v is not None and not is_rate(v):
            r.err(where, f'stats.{k}={v!r} 應為 0–1 的小數（百分比要除以 100）')
    d = stats.get('discrimination')
    if d is not None and not (is_num(d) and -1 <= d <= 1):
        r.err(where, f'stats.discrimination={d!r} 應為 -1–1 的數字')
    for k in ('option_rates', 'option_rates_high', 'option_rates_low'):
        check_rates_map(r, where, k, stats.get(k), mode)
    fg = stats.get('five_groups')
    if fg is not None and not (isinstance(fg, list) and len(fg) == 5 and all(is_rate(x) for x in fg)):
        r.err(where, 'stats.five_groups 必須是 5 個 0–1 小數的陣列（高分組到低分組）')
    if stats.get('full_correct_rate') is not None and mode != 'multi_select':
        r.warn(where, 'stats.full_correct_rate 通常只有多選題才有')


# ---------------------------------------------------------------------------
# 小題
# ---------------------------------------------------------------------------

_exam_cache = {}


def load_exam(eid):
    if eid not in _exam_cache:
        p = PARSED / f'{eid}.json'
        try:
            _exam_cache[eid] = json.loads(p.read_text(encoding='utf-8')) if p.exists() else None
        except Exception:  # noqa: BLE001 — 對方檔案壞掉時由它自己的檢查回報
            _exam_cache[eid] = None
    return _exam_cache[eid]


def check_reused_from(r, where, rf, stype, self_id):
    if not check_keys(r, f'{where}.reused_from', rf, REUSED_KEYS):
        return
    eid, no = rf.get('exam'), rf.get('no')
    if not isinstance(eid, str) or not ID_RE.match(eid) or eid == self_id:
        r.err(where, f'reused_from.exam={eid!r} 必須是另一份考卷的 id')
        return
    if not (is_int(no) and no >= 1):
        r.err(where, 'reused_from.no 必須是正整數（原卷同類大題中的題號）')
        return
    if not str_or_null(rf.get('modified')):
        r.err(where, 'reused_from.modified 必須是字串或 null')
    src = load_exam(eid)
    if src is None:
        r.warn(where, f'reused_from 指向的 {eid}.json 不存在或無法讀取，無法核對')
        return
    found = any(s.get('type') == stype and any(q.get('no') == no for g in s.get('groups') or []
                                                for q in g.get('questions') or [])
                for s in src.get('sections') or [])
    if not found:
        r.err(where, f'reused_from 在 {eid} 找不到 {stype} 大題的第 {no} 題')


def check_answer_extras(r, where, q, mode):
    segs = q.get('answer_segments')
    variants = q.get('answer_variants')
    composite = q.get('answer_is_composite')
    for key in ('answer_segments', 'answer_variants', 'answer_is_composite'):
        if key in q and mode != 'translation':
            r.err(where, f'{key} 只用在翻譯題（mode=translation）')
    if 'answer_segments' in q:
        if not isinstance(segs, list) or not segs:
            r.err(where, 'answer_segments 必須是非空陣列（每一段是可替換寫法的陣列）')
        else:
            for i, seg in enumerate(segs):
                sw = f'answer_segments[{i}]'
                if not isinstance(seg, list) or not seg or not all(isinstance(x, str) for x in seg):
                    r.err(where, f'{sw} 必須是非空的字串陣列')
                    continue
                if not any(x for x in seg):
                    r.err(where, f'{sw} 只有空字串（整段可省略就不要列這一段）')
                if len(set(seg)) != len(seg):
                    r.err(where, f'{sw} 有重複的寫法')
                if any(x != x.strip() or '\n' in x for x in seg):
                    r.err(where, f'{sw} 的寫法前後不可有空白或換行（串接時自動補空格）')
    if 'answer_variants' in q:
        if not isinstance(variants, list) or not variants or not all(nonempty_str(x) for x in variants):
            r.err(where, 'answer_variants 必須是非空字串的非空陣列')
        elif len(set(variants)) != len(variants):
            r.err(where, 'answer_variants 有重複的句子')
    if 'answer_is_composite' in q:
        if not isinstance(composite, bool):
            r.err(where, 'answer_is_composite 必須是 true 或 false')
        elif composite:
            if not nonempty_str(q.get('answer')):
                r.err(where, 'answer_is_composite 為 true 但 answer 不是字串')
            elif isinstance(segs, list) and segs and all(isinstance(s, list) and s for s in segs):
                first = join_segments([s[0] for s in segs])
                if first != q['answer']:
                    r.err(where, f'answer_is_composite 為 true，但 answer 與各段第一個選項串接的「{first}」不同')
    if 'answer_table' in q:
        t = q['answer_table']
        if mode != 'table_completion':
            r.err(where, 'answer_table 只用在表格填寫題（mode=table_completion）')
        if not (isinstance(t, list) and t and all(isinstance(row, list) and all(isinstance(c, str) for c in row) for row in t)):
            r.err(where, 'answer_table 必須是字串的二維陣列')


def check_scoring_exception(r, where, se, q):
    if not check_keys(r, f'{where}.scoring_exception', se, SCORING_EXCEPTION_KEYS):
        return
    t = se.get('type')
    if t not in SCORING_EXCEPTION_TYPES:
        r.err(where, f'scoring_exception.type={t!r} 不在 all_credit／multiple_correct／other 內')
    if not str_or_null(se.get('note')):
        r.err(where, 'scoring_exception.note 必須是字串或 null')
    if t == 'other' and not nonempty_str(se.get('note')):
        r.err(where, 'scoring_exception.type 為 other 時 note 必須說明')
    if t == 'multiple_correct' and q.get('mode') in CHOICE_MODES and not q.get('accepted_answers'):
        r.warn(where, 'scoring_exception 為 multiple_correct，但 accepted_answers 沒有列出其他也給分的答案')


def check_refers_to(r, where, rt, g):
    if not check_keys(r, f'{where}.refers_to', rt, REFERS_TO_KEYS):
        return
    text, occ = rt.get('text'), rt.get('occurrence')
    ok = True
    if not nonempty_str(text) or text != text.strip() or MARKUP_RE.search(text):
        r.err(where, 'refers_to.text 必須是非空字串，前後不可有空白，也不可含標記')
        ok = False
    if not (is_int(occ) and occ >= 1):
        r.err(where, 'refers_to.occurrence 必須是正整數（第幾次出現，從 1 起算）')
        ok = False
    if not str_or_null(rt.get('note')):
        r.err(where, 'refers_to.note 必須是字串或 null')
    if ok:
        gt = group_text(g)
        if not gt.strip():
            r.err(where, 'refers_to 用在沒有選文的題組')
        else:
            n = len(find_occurrences(gt, text))
            if n < occ:
                r.err(where, f'refers_to：「{text}」在選文只出現 {n} 次，occurrence={occ}')


def check_question(r, where, q, stype, g, self_id):
    bank = g.get('options_bank')
    if not check_keys(r, where, q, QUESTION_KEYS):
        return
    if not is_int(q.get('no')):
        r.err(where, 'no 必須是整數')
    if not nonempty_str(q.get('label')):
        r.err(where, 'label 必須是非空字串')
    mode = q.get('mode')
    if mode not in MODES:
        r.err(where, f'mode={mode!r} 不在允許值內')
    if q.get('points') is not None and not is_num(q.get('points')):
        r.err(where, 'points 必須是數字或 null')
    for key in ('stem', 'scoring_notes'):
        if not str_or_null(q.get(key)):
            r.err(where, f'{key} 必須是字串或 null')
    acc = q.get('accepted_answers')
    if acc is not None and not (isinstance(acc, list) and all(isinstance(x, str) for x in acc)):
        r.err(where, 'accepted_answers 必須是字串陣列或 null')
    opts = q.get('options')
    ans = q.get('answer')
    if mode in CHOICE_MODES:
        pool = opts if opts else bank
        if not pool:
            r.err(where, '選擇題沒有 options，題組也沒有 options_bank')
            pool = {}
        elif not isinstance(pool, dict):
            r.err(where, 'options 必須是物件 {"A": "..."}')
            pool = {}
        for k, v in pool.items():
            if not re.fullmatch(r'[A-Z]', k):
                r.err(where, f'選項代號 {k!r} 應為單一大寫字母')
            if not nonempty_str(v):
                r.err(where, f'選項 {k} 是空的')
        if opts and stype == 'vocabulary' and len(opts) != 4:
            r.warn(where, f'詞彙題有 {len(opts)} 個選項（通常是 4 個）')
        if mode == 'multi_select':
            if not isinstance(ans, list) or not ans:
                r.err(where, '多選題的 answer 必須是非空陣列')
            elif any(a not in pool for a in ans):
                r.err(where, f'答案 {ans} 有不在選項中的代號')
        else:
            if ans is None:
                r.err(where, '選擇題缺少官方答案')
            elif not isinstance(ans, str) or ans not in pool:
                r.err(where, f'答案 {ans!r} 不在選項 {sorted(pool)} 中')
        if opts and bank and mode == 'bank_choice':
            r.warn(where, 'bank_choice 題同時有自己的 options 和題組 options_bank')
    elif mode == 'composition':
        if ans is not None:
            r.err(where, '作文的 answer 必須是 null（範文不是官方答案）')
    elif not str_or_null(ans):
        r.err(where, 'answer 必須是字串或 null')
    if mode in ('single_choice', 'multi_select') and stype in ('vocabulary', 'reading', 'mixed') and not nonempty_str(q.get('stem')):
        r.err(where, '缺少題幹 stem')
    if mode in ('translation', 'composition') and not nonempty_str(q.get('stem')):
        r.err(where, '翻譯／作文缺少題目 stem')
    check_stats(r, where, q.get('stats'), mode)
    check_question_tags(r, where, q.get('tags'), stype, q, bank)
    check_answer_extras(r, where, q, mode)
    if 'scoring_exception' in q:
        check_scoring_exception(r, where, q['scoring_exception'], q)
    if 'refers_to' in q:
        check_refers_to(r, where, q['refers_to'], g)
    if 'reused_from' in q:
        check_reused_from(r, where, q['reused_from'], stype, self_id)


# ---------------------------------------------------------------------------
# 大題、題組
# ---------------------------------------------------------------------------

def check_section_stats(r, where, st):
    if not check_keys(r, f'{where}.stats', st, SECTION_STATS_KEYS):
        return
    for k in ('source', 'rate_base', 'note'):
        if not str_or_null(st.get(k)):
            r.err(where, f'stats.{k} 必須是字串或 null')
    if st.get('max_score') is not None and not is_num(st['max_score']):
        r.err(where, 'stats.max_score 必須是數字或 null')
    for k in ('registered', 'absent', 'examinees'):
        v = st.get(k)
        if v is not None and not (is_int(v) and v >= 0):
            r.err(where, f'stats.{k} 必須是非負整數或 null')
    bins = st.get('score_distribution')
    if not isinstance(bins, list) or not bins:
        r.err(where, 'stats.score_distribution 必須是非空陣列')
        return
    for i, b in enumerate(bins):
        bw = f'{where}.stats.score_distribution[{i}]'
        if not check_keys(r, bw, b, BIN_KEYS):
            continue
        if not nonempty_str(b.get('range')):
            r.err(bw, 'range 必須是非空字串')
        if not (is_int(b.get('count')) and b['count'] >= 0):
            r.err(bw, 'count 必須是非負整數')
        for k in ('min', 'max'):
            if b.get(k) is not None and not is_num(b[k]):
                r.err(bw, f'{k} 必須是數字或 null')
        for k in ('rate', 'cumulative_rate'):
            if b.get(k) is not None and not is_rate(b[k]):
                r.err(bw, f'{k} 必須是 0–1 的小數或 null')
        if b.get('cumulative_count') is not None and not (is_int(b['cumulative_count']) and b['cumulative_count'] >= 0):
            r.err(bw, 'cumulative_count 必須是非負整數或 null')


def check_passage_text(r, where, text, poem):
    if not isinstance(text, str):
        return
    if poem:
        if '\n\n\n' in text:
            r.err(where, '詩的分節只能用一個空行（\\n\\n）')
    elif '\n\n' in text:
        r.err(where, '段落分隔必須是單一 \\n（"\\n\\n" 只有詩可以用來分節）')
    if text != text.strip():
        r.err(where, '選文前後不可有空白或換行')
    if re.search(r'[ \t]\n|\n[ \t]', text):
        r.err(where, '段落前後不可有空白')


def independent_numbering(section):
    """翻譯、作文、簡答，以及只有非選擇作答的 other 大題，各自從 1 編號，不算進卷內連續題號。"""
    t = section.get('type')
    if t in ('translation', 'composition', 'short_answer'):
        return True
    if t == 'other':
        qs = [q for g in section.get('groups') or [] for q in g.get('questions') or []]
        return bool(qs) and all(q.get('mode') not in CHOICE_MODES for q in qs)
    return False


def check_numbering(r, sections):
    runs = []          # 每個 run 是 [(no, label, group_id)]
    prev_part = object()
    for si, s in enumerate(sections):
        qs = [(q.get('no'), q.get('label'), g.get('id')) for g in s.get('groups') or [] for q in g.get('questions') or []
              if is_int(q.get('no'))]
        if independent_numbering(s):
            nos = [n for n, _, _ in qs]
            if nos != list(range(1, len(nos) + 1)):
                r.err(f'sections[{si}]', f'{s.get("type")} 大題的題號應為大題內序號 1–{len(nos)}，目前是 {nos}')
            continue
        # 題本分部分重新編號（例如 gsat-83 第二部分從 1 起）時另起一段
        if qs and (not runs or (qs[0][0] == 1 and runs[-1] and s.get('part') != prev_part)):
            runs.append([])
        if runs:
            runs[-1].extend(qs)
        prev_part = s.get('part')
    for run in runs:
        nos = sorted({n for n, _, _ in run})
        if not nos:
            continue
        if nos[0] != 1:
            r.warn('numbering', f'題號從 {nos[0]} 開始')
        missing = sorted(set(range(nos[0], nos[-1] + 1)) - set(nos))
        if missing:
            r.err('numbering', f'題號缺少 {missing}')
        by_no = {}
        for n, label, gid in run:
            by_no.setdefault(n, []).append((label, gid))
        for n, items in sorted(by_no.items()):
            if len(items) > 1:
                labels = [x[0] for x in items]
                groups = {x[1] for x in items}
                sub_items = all(isinstance(lb, str) and re.fullmatch(rf'{n}[A-Z]', lb) for lb in labels)
                if len(groups) > 1 or len(set(labels)) != len(labels) or not sub_items:
                    r.err('numbering', f'題號 {n} 重複（{labels}）；同一題號只能用在同一題組、label 為「題號＋大寫字母」的子題（例如 47A／47B）')


def check_markup_usage(r, gw, g, stype):
    texts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    spans = [m.group(2) for t in texts for m in re.finditer(r'<(u|b)>(.*?)</\1>', t, re.S)]
    if not spans or stype == 'translation':
        return
    for span in spans:
        used = False
        for q in g.get('questions') or []:
            stem = q.get('stem') or ''
            if 'refers_to' in q or span.lower() in stem.lower() or re.search(
                    r'underlined|bold|highlighted|<u>|<b>|粗體|底線|劃線', stem, re.I):
                used = True
                break
        if not used:
            r.warn(gw, f'選文的強調標記「{span}」沒有題目用到（只在題目會用到時才標）')


def check_exam(path):
    r = Report(path.name)
    try:
        d = json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001 — 任何解析錯誤都要回報
        r.err('file', f'JSON 解析失敗：{e}')
        return r
    if not isinstance(d, dict):
        r.err('top', '頂層必須是物件')
        return r
    if d.get('schema') != SCHEMA_ID:
        r.err('top', f'schema 必須是 "{SCHEMA_ID}"（目前 {d.get("schema")!r}；v1 檔案請先跑 tools/normalize_exams.py）')
    check_keys(r, 'top', d, TOP_KEYS)
    eid = d.get('id')
    if not isinstance(eid, str) or not ID_RE.match(eid):
        r.err('top', f'id={eid!r} 不符合命名規則')
    elif path.stem != eid:
        r.err('top', f'檔名 {path.stem} 與 id {eid} 不一致')
    if d.get('exam') not in ('gsat', 'ast', 'reference'):
        r.err('top', 'exam 必須是 gsat／ast／reference')
    if not is_int(d.get('year')):
        r.err('top', 'year 必須是整數')
    if d.get('session') not in ('regular', 'makeup'):
        r.err('top', 'session 必須是 regular／makeup')
    if not nonempty_str(d.get('title')):
        r.err('top', 'title 必須是非空字串')
    if d.get('time_minutes') is not None and not is_num(d.get('time_minutes')):
        r.err('top', 'time_minutes 必須是數字或 null')
    if not is_num(d.get('full_score')):
        r.err('top', 'full_score 必須是數字')

    for path_, s, markup in walk_strings(d, ''):
        check_text(r, path_, s, markup)

    src = d.get('sources')
    if check_keys(r, 'sources', src, SOURCES_KEYS):
        if not nonempty_str(src.get('paper')):
            r.err('sources', '缺少 paper 路徑')
        for kind in ('answer', 'scoring', 'stats', 'paper_word', 'answer_sheet', 'other'):
            if kind in src and not (isinstance(src[kind], list) and all(nonempty_str(p) for p in src[kind])):
                r.err('sources', f'{kind} 必須是字串陣列')
        for kind in ('paper', 'paper_word', 'answer', 'scoring', 'stats', 'answer_sheet', 'other'):
            v = src.get(kind)
            paths = [v] if isinstance(v, str) else (v if isinstance(v, list) else [])
            for p in paths:
                if isinstance(p, str) and not (ROOT / p).exists():
                    r.warn('sources', f'{kind} 檔案不存在於本機：{p}（data/raw 可用 tools/fetch_ceec.py 重新下載）')

    sections = d.get('sections') if isinstance(d.get('sections'), list) else []
    if not sections:
        r.err('sections', '沒有任何大題')
    section_ids = [s.get('id') for s in sections if isinstance(s, dict)]

    parts = d.get('parts')
    if 'parts' in d:
        if not isinstance(parts, list) or not parts:
            r.err('parts', 'parts 必須是非空陣列（沒有就省略）')
        else:
            seen = []
            for pi, p in enumerate(parts):
                pw = f'parts[{pi}]'
                if not check_keys(r, pw, p, PART_KEYS):
                    continue
                for k in ('title', 'instructions'):
                    if not str_or_null(p.get(k)):
                        r.err(pw, f'{k} 必須是字串或 null')
                if p.get('points') is not None and not is_num(p.get('points')):
                    r.err(pw, 'points 必須是數字或 null')
                ids = p.get('sections')
                if not isinstance(ids, list) or not ids or any(i not in section_ids for i in ids):
                    r.err(pw, f'sections {ids!r} 必須是現有大題 id 的非空陣列')
                    continue
                seen += ids
                pts = sum(s.get('points_total') for s in sections if s.get('id') in ids and is_num(s.get('points_total')))
                if is_num(p.get('points')) and pts and abs(pts - p['points']) > 0.01:
                    r.warn(pw, f'points {p["points"]} 與所屬大題 points_total 加總 {pts} 不同')
            if len(seen) != len(set(seen)):
                r.err('parts', '同一個大題出現在兩個 parts')

    seen_labels = set()
    total_points = 0
    has_stats = False
    for si, s in enumerate(sections):
        sw = f'sections[{si}]'
        if not check_keys(r, sw, s, SECTION_KEYS):
            continue
        stype = s.get('type')
        if stype not in SECTION_TYPES:
            r.err(sw, f'type={stype!r} 不在允許值內')
        for k in ('id', 'title'):
            if not nonempty_str(s.get(k)):
                r.err(sw, f'{k} 必須是非空字串')
        if not str_or_null(s.get('part')):
            r.err(sw, 'part 必須是字串或 null')
        if not isinstance(s.get('instructions'), str):
            r.err(sw, 'instructions 必須是字串')
        if is_num(s.get('points_total')):
            total_points += s['points_total']
        else:
            r.warn(sw, 'points_total 不是數字')
        if 'stats' in s:
            check_section_stats(r, sw, s['stats'])
        sec_points = 0
        groups = s.get('groups') if isinstance(s.get('groups'), list) else []
        if not groups:
            r.err(sw, 'groups 必須是非空陣列')
        for gi, g in enumerate(groups):
            gw = f'{sw}.groups[{gi}]'
            if not check_keys(r, gw, g, GROUP_KEYS):
                continue
            if 'group_label' in g and not str_or_null(g['group_label']):
                r.err(gw, 'group_label 必須是字串或 null')
            if not str_or_null(g.get('passage')):
                r.err(gw, 'passage 必須是字串或 null')
            bank = g.get('options_bank')
            if bank is not None and not isinstance(bank, dict):
                r.err(gw, 'options_bank 必須是物件或 null')
            if stype in BANK_TYPES and not bank:
                r.err(gw, f'{stype} 題組缺少 options_bank')
            if stype == 'word_bank' and isinstance(bank, dict) and len(bank) < 10:
                r.warn(gw, f'文意選填選項只有 {len(bank)} 個')
            qs = g.get('questions') if isinstance(g.get('questions'), list) else []
            if not qs:
                r.err(gw, '題組沒有任何小題')
            parts_ = g.get('passage_parts')
            if parts_ is not None and not isinstance(parts_, list):
                r.err(gw, 'passage_parts 必須是陣列或 null')
                parts_ = []
            gtags = g.get('tags')
            poem = isinstance(gtags, dict) and gtags.get('genre') == 'poem'
            check_passage_text(r, f'{gw}.passage', g.get('passage'), poem)
            for pi, p in enumerate(parts_ or []):
                pw = f'{gw}.passage_parts[{pi}]'
                if check_keys(r, pw, p, PASSAGE_PART_KEYS):
                    if not str_or_null(p.get('label')) or not str_or_null(p.get('title')):
                        r.err(pw, 'label、title 必須是字串或 null')
                    if not isinstance(p.get('text'), str):
                        r.err(pw, 'text 必須是字串')
                    check_passage_text(r, f'{pw}.text', p.get('text'), poem)
            text = (g.get('passage') or '') + ''.join('\n' + (p.get('text') or '') for p in parts_ or [] if isinstance(p, dict))
            if stype in ('cloze', 'word_bank', 'structure', 'reading') and not text.strip():
                r.err(gw, '缺少選文 passage')
            if stype in BLANK_TYPES:
                blanks = [int(x) for x in BLANK_RE.findall(text)]
                nos = [q.get('no') for q in qs]
                if blanks != nos:
                    r.err(gw, f'選文中的空格 {blanks} 與小題題號 {nos} 不一致（空格要寫成 [[題號]]）')
            if stype in ('reading', 'mixed', 'cloze', 'word_bank', 'structure'):
                if not (gtags or {}).get('topic'):
                    r.warn(gw, '題組沒有 tags.topic')
            if gtags is not None and not isinstance(gtags, dict):
                r.err(gw, 'tags 必須是物件或 null')
            else:
                check_group_tags(r, gw, gtags, stype, g)
            if stype not in ('translation', 'composition'):
                exp = expected_text_format(g)
                cur = (gtags or {}).get('text_format') if isinstance(gtags, dict) else None
                if exp is None and (g.get('figures') or []) and not text.strip():
                    r.err(gw, '只有圖表沒有選文，但圖表種類對不上 chart／table／map／form／timeline')
                elif exp is not None and cur != exp:
                    r.err(gw, f'tags.text_format 應為 {exp}（目前 {cur!r}；規則：有圖表又有選文＝mixed、'
                              'passage_parts 兩篇以上＝multi_text、只有圖表＝圖表種類、其他＝continuous）')
            check_markup_usage(r, gw, g, stype)
            figs = g.get('figures')
            if not isinstance(figs, list):
                r.err(gw, 'figures 必須是陣列')
                figs = []
            group_nos = {q.get('no') for q in qs if isinstance(q, dict)}
            for fi, f in enumerate(figs):
                fw = f'{gw}.figures[{fi}]'
                if not check_keys(r, fw, f, FIGURE_KEYS):
                    continue
                if not nonempty_str(f.get('kind')):
                    r.err(fw, 'kind 必須是非空字串')
                if not str_or_null(f.get('caption')) or not str_or_null(f.get('label')):
                    r.err(fw, 'caption、label 必須是字串或 null')
                if not nonempty_str(f.get('description')) and not f.get('rows'):
                    r.err(fw, '圖表沒有文字描述也沒有 rows')
                rows = f.get('rows')
                if rows is not None and not (isinstance(rows, list) and all(isinstance(x, list) and all(isinstance(c, str) for c in x) for x in rows)):
                    r.err(fw, 'rows 必須是字串的二維陣列或 null')
                qn = f.get('question_no')
                if qn is not None and (not is_int(qn) or qn not in group_nos):
                    r.err(fw, f'question_no={qn!r} 必須是本題組小題的題號')
            for qi, q in enumerate(qs):
                if not isinstance(q, dict):
                    r.err(gw, '小題必須是物件')
                    continue
                qw = f'{gw}.q{q.get("label", qi)}'
                check_question(r, qw, q, stype, g, eid)
                label = q.get('label')
                if label in seen_labels:
                    r.err(qw, f'label {label} 重複')
                seen_labels.add(label)
                if is_num(q.get('points')):
                    sec_points += q['points']
                if q.get('stats'):
                    has_stats = True
        pt = s.get('points_total')
        if is_num(pt) and sec_points and abs(sec_points - pt) > 0.01:
            r.warn(sw, f'小題分數加總 {sec_points} 與 points_total {pt} 不同')

    check_numbering(r, [s for s in sections if isinstance(s, dict)])
    full = d.get('full_score')
    if is_num(full) and total_points and abs(total_points - full) > 0.01:
        r.warn('points', f'各大題 points_total 加總 {total_points} 與 full_score {full} 不同')
    if not has_stats:
        r.warn('stats', '整份考卷沒有任何統計資料（學測 91、指考 91 以後應該都有）')
    ext = d.get('extraction')
    if check_keys(r, 'extraction', ext, EXTRACTION_KEYS):
        if not isinstance(ext.get('method'), str):
            r.err('extraction', 'method 必須是字串')
        if not (isinstance(ext.get('issues'), list) and all(isinstance(x, str) for x in ext['issues'])):
            r.err('extraction', 'issues 必須是字串陣列')
        if not str_or_null(ext.get('verified_by')):
            r.err('extraction', 'verified_by 必須是字串或 null')
    return r


def main(argv):
    if not argv or argv == ['--all']:
        paths = sorted(PARSED.glob('*.json'))
    else:
        paths = [Path(a) for a in argv]
    bad = 0
    for p in paths:
        r = check_exam(p)
        status = 'OK' if not r.errors else 'FAIL'
        print(f'[{status}] {p.name}: {len(r.errors)} error, {len(r.warnings)} warning')
        for e in r.errors:
            print(f'  ERROR {e}')
        for w in r.warnings:
            print(f'  warn  {w}')
        bad += bool(r.errors)
    if not paths:
        print('沒有找到要檢查的檔案')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
