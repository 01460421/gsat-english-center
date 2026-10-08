#!/usr/bin/env python3
"""把 data/exams/parsed/*.json 從 gsat-exam/v1（含各檔自行加的擴充欄位）升級成 gsat-exam/v1.1，
並列出需要看原卷才能完成的工作清單 data/exams/normalize-todo.json。

用法：
    python3 tools/normalize_exams.py                    # 備份、正規化全部檔案、寫出工作清單
    python3 tools/normalize_exams.py --check            # 只檢查：有任何檔案還需要改就以 1 結束，不寫檔
    python3 tools/normalize_exams.py --backup-dir DIR   # 指定備份目錄（預設在系統暫存目錄）

可以重跑（冪等）：已經是 v1.1 的檔案再跑一次不會有任何變動；備份只在備份目錄裡還沒有該檔時才寫入，
所以重跑不會用正規化後的檔案蓋掉第一次的原始備份。

這支腳本只做「不看原卷也能決定」的機械性統一，規則見 docs/exam-json-schema.md 的「v1.1 變更」：
  1. 擴充欄位：頂層 parts、sources.paper_word／answer_sheet／other、section.stats（含舊的
     section.score_distribution）、group.group_label、figure.label／question_no、question.reused_from、
     question.answer_table、question.stats 的 omit_rate 等，統一名稱與形狀；section.part_title／
     part_instructions 併入頂層 parts。
  2. 文字：不換行空格等看不見的特殊空白換成一般空格；選文段落分隔統一為單一 "\\n"（詩的分節例外）。
  3. 標註：word_requirement → word_count、essay_type／grammar_point／clue 收斂到封閉集合、
     item_type 的 NOT／EXCEPT 與讀圖規則、answer_pos 的片語規則、題組 text_format。
  4. 編號：翻譯與作文的 no 改為大題內序號，label 用題本印的大題名稱。
需要人判斷的（refers_to、answer_segments、scoring_exception、無法確定的讀圖題、圖片選項、
extraction.issues 裡的待決事項）不改資料，只寫進工作清單。
"""
import argparse
import json
import re
import shutil
import sys
import tempfile
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / 'data' / 'exams' / 'parsed'
MANIFEST = ROOT / 'data' / 'exams' / 'manifest.json'
TODO = ROOT / 'data' / 'exams' / 'normalize-todo.json'
DEFAULT_BACKUP = Path(tempfile.gettempdir()) / 'gsat-exam-normalize-backup'

SCHEMA_ID = 'gsat-exam/v1.1'
CHOICE_MODES = {'single_choice', 'multi_select', 'bank_choice'}
ITEM_TYPE_SECTIONS = {'reading', 'mixed', 'short_answer', 'other'}
NOT_RULE_SECTIONS = {'reading', 'mixed'}          # 「閱讀／混合題」
NO_TEXT_FORMAT_SECTIONS = {'translation', 'composition'}

# ---------------------------------------------------------------------------
# 封閉集合與對應表（新出現的值一律讓腳本停下來，逐一判斷後補進這裡）
# ---------------------------------------------------------------------------

ESSAY_TYPES = ['picture', 'chart', 'letter', 'topic', 'continuation', 'other']
ESSAY_MAP = {'two_paragraph': 'topic'}            # 段數已記在 tags.paragraphs

GRAMMAR_POINTS = ['tense', 'passive', 'participle', 'relative_clause', 'noun_clause', 'adverb_clause',
                  'conditional', 'subjunctive', 'inversion', 'comparison', 'infinitive_gerund', 'modal',
                  'agreement', 'pronoun', 'determiner', 'article', 'preposition', 'conjunction',
                  'parallel_structure', 'with_construction', 'causative', 'emphasis', 'existential',
                  'substitution', 'degree', 'other']
GRAMMAR_MAP = {
    'modal_perfect': 'modal',
    'with_absolute_construction': 'with_construction',
    'parallelism': 'parallel_structure',
    'there_be': 'existential',
    'existential_there': 'existential',
    'emphatic_do': 'emphasis',
    'dummy_it': 'pronoun',
    'auxiliary_substitution': 'substitution',
    'concessive_clause': 'adverb_clause',
    'not_until': 'inversion',
    'enough_to': 'degree',
    'degree_adverb': 'degree',
    'correlative_conjunction': 'conjunction',
    'indirect_question': 'noun_clause',
}

CLUES = ['pronoun_reference', 'lexical_cohesion', 'transition_word', 'topic_sentence', 'contrast', 'example',
         'elaboration', 'enumeration', 'summary', 'chronology', 'other']
CLUE_MAP = {'lexical_link': 'lexical_cohesion', 'keyword_repetition': 'lexical_cohesion', 'conclusion': 'summary'}

POS = {'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause'}

# 兩個字以上、原本沒有標 answer_pos 的答案：逐題看過後決定（整句對話回應算 clause，其餘算 phrase）。
ANSWER_POS_MANUAL = {
    ('gsat-84', '2'): 'clause',    # Where were we?
    ('gsat-84', '3'): 'clause',    # but I'm afraid
    ('gsat-84', '4'): 'clause',    # How about you?
    ('gsat-84', '5'): 'clause',    # What do you do?
    ('gsat-84', '6'): 'clause',    # I'm sorry, he's out at this moment.
    ('gsat-84', '7'): 'clause',    # I'm not sure. Can I take a message?
    ('gsat-84', '8'): 'clause',    # Moskovik, M-O-S-K-O-V-I-K.
    ('gsat-84', '9'): 'clause',    # Don't worry. All we have to do is ask.
    ('gsat-84', '10'): 'clause',   # You ask a policeman.
    ('gsat-86', '27'): 'clause',   # What a pity!
    ('gsat-86', '30'): 'clause',   # That's nothing
    ('gsat-100', '26'): 'phrase',  # the latter
    ('gsat-86', '11'): 'phrase',   # there is
    ('gsat-86', '14'): 'phrase',   # any left
    ('gsat-86', '26'): 'phrase',   # Not too bad
    ('gsat-86', '28'): 'phrase',   # How on earth
    ('gsat-87', '16'): 'phrase',   # to help
    ('gsat-87', '18'): 'phrase',   # early enough
    ('gsat-87', '37'): 'phrase',   # as much
    ('gsat-89', '22'): 'phrase',   # The other
}

# word_requirement 規則解析不了的寫法：人工判斷後寫在這裡。
WORD_COUNT_MANUAL = {
    # ast-97：說明「文長至少120個單詞」，提示又寫「請寫一篇大約120-150字的短文」
    'at least 120 words (about 120-150)': {'min': 120, 'max': 150, 'approx': None},
}

TEXT_FORMAT_BY_FIGURE = {'chart': 'chart', 'graph': 'chart', 'diagram': 'chart', 'table': 'table', 'map': 'map',
                         'form': 'form', 'timeline': 'timeline'}

# ---------------------------------------------------------------------------
# 欄位順序（輸出時依此排序，讓每份檔案的結構一致；不在清單裡的鍵放最後，validator 會報 error）
# ---------------------------------------------------------------------------

ORDER = {
    'top': ['schema', 'id', 'exam', 'year', 'session', 'title', 'time_minutes', 'full_score', 'sources', 'parts',
            'sections', 'extraction'],
    'sources': ['paper', 'paper_word', 'answer', 'scoring', 'stats', 'answer_sheet', 'other'],
    'part': ['title', 'points', 'instructions', 'sections'],
    'section': ['id', 'type', 'title', 'part', 'instructions', 'points_total', 'stats', 'groups'],
    'section_stats': ['source', 'max_score', 'registered', 'absent', 'examinees', 'rate_base', 'note',
                      'score_distribution'],
    'bin': ['range', 'min', 'max', 'count', 'rate', 'cumulative_count', 'cumulative_rate'],
    'group': ['id', 'group_label', 'passage', 'passage_parts', 'figures', 'options_bank', 'questions', 'tags'],
    'passage_part': ['label', 'title', 'text'],
    'figure': ['kind', 'label', 'caption', 'description', 'rows', 'question_no'],
    'question': ['no', 'label', 'mode', 'stem', 'refers_to', 'options', 'answer', 'answer_segments',
                 'answer_variants', 'answer_is_composite', 'answer_table', 'accepted_answers', 'scoring_exception',
                 'points', 'stats', 'scoring_notes', 'reused_from', 'tags'],
    'q_stats': ['correct_rate', 'high_group', 'low_group', 'discrimination', 'option_rates', 'option_rates_high',
                'option_rates_low', 'omit_rate', 'full_correct_rate', 'five_groups'],
    'reused_from': ['exam', 'no', 'modified'],
    'q_tags': ['test_point', 'answer_pos', 'answer_function', 'grammar_point', 'grammar_point_raw', 'key_phrase',
               'item_type', 'item_type_raw', 'clue', 'clue_raw', 'patterns', 'topic', 'essay_type', 'paragraphs',
               'word_count', 'word_requirement_raw'],
    'g_tags': ['topic', 'genre', 'sdgs', 'text_format'],
    'extraction': ['method', 'issues', 'verified_by'],
}

STATS_RENAME = {'full_marks': 'max_score', 'examinees_registered': 'registered', 'examinees_present': 'examinees',
                'percent_base': 'rate_base', 'score_distribution_base': 'rate_base', 'bins': 'score_distribution'}
BIN_RENAME = {'score_range': 'range', 'percent': 'rate', 'cum_count': 'cumulative_count',
              'cumulative_percent': 'cumulative_rate', 'cum_percent': 'cumulative_rate'}


class NormalizeError(Exception):
    pass


def ordered(obj, kind):
    keys = ORDER[kind]
    out = {k: obj[k] for k in keys if k in obj}
    for k, v in obj.items():
        if k not in out:
            out[k] = v
    return out


def rename_keys(obj, mapping, where):
    out = {}
    for k, v in obj.items():
        nk = mapping.get(k, k)
        if nk in out and out[nk] != v:
            raise NormalizeError(f'{where}: {k} 改名為 {nk} 時與既有的值衝突')
        out[nk] = v
    return out


# ---------------------------------------------------------------------------
# 文字
# ---------------------------------------------------------------------------

# 看起來像空格的字元（含所有 Unicode Zs 類空白）一律換成一般空格；零寬字元與其他格式字元（Cf）直接刪除；
# 全形空白 U+3000 只在旁邊是中文（全形）字元時保留。validator 的 check_text 用同一個定義。
SPACE_LIKE = set('\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\t')
ZERO_WIDTH = set('\u200b\u200c\u200d\u2060\ufeff\u00ad')


def is_wide(ch):
    return ch != '\u3000' and unicodedata.east_asian_width(ch) in ('W', 'F')


def clean_text(s):
    out = []
    for i, ch in enumerate(s):
        cat = unicodedata.category(ch)
        if ch in SPACE_LIKE or (cat == 'Zs' and ch not in ' \u3000'):
            out.append(' ')
        elif ch in ZERO_WIDTH or cat == 'Cf':     # 格式字元（零寬、方向標記、軟連字號…）直接刪除
            continue
        elif cat in ('Zl', 'Zp'):                  # U+2028／U+2029 行、段落分隔符 → 一般換行
            out.append('\n')
        elif ch == '\r':
            out.append('\n' if i + 1 >= len(s) or s[i + 1] != '\n' else '')
        elif cat == 'Cc' and ch != '\n':           # 其他控制字元（\v、\f…）→ 一般空格
            out.append(' ')
        elif ch == '\u3000':
            prev = s[i - 1] if i else ''
            nxt = s[i + 1] if i + 1 < len(s) else ''
            out.append(ch if (prev and is_wide(prev)) or (nxt and is_wide(nxt)) else ' ')
        else:
            out.append(ch)
    return ''.join(out)


def clean_all(x, stats):
    if isinstance(x, str):
        y = clean_text(x)
        if y != x:
            stats['whitespace'] += 1
        return y
    if isinstance(x, list):
        return [clean_all(v, stats) for v in x]
    if isinstance(x, dict):
        return {k: clean_all(v, stats) for k, v in x.items()}
    return x


def normalize_passage(text, poem):
    """段落分隔統一為單一 \\n。詩（genre=poem）的空行是分節，保留為 \\n\\n。"""
    if not isinstance(text, str):
        return text
    return re.sub(r'\n{3,}', '\n\n', text) if poem else re.sub(r'\n{2,}', '\n', text)


# ---------------------------------------------------------------------------
# 標註
# ---------------------------------------------------------------------------

def parse_word_requirement(raw):
    s = raw.strip()
    if s in WORD_COUNT_MANUAL:
        return dict(WORD_COUNT_MANUAL[s])
    m = re.fullmatch(r'at least (\d+) words', s)
    if m:
        return {'min': int(m.group(1)), 'max': None, 'approx': None}
    m = re.fullmatch(r'(?:about )?(\d+) to (\d+) words', s) or re.fullmatch(r'(\d+)\s*至\s*(\d+)\s*字', s)
    if m:
        return {'min': int(m.group(1)), 'max': int(m.group(2)), 'approx': None}
    m = re.fullmatch(r'(?:about )?(\d+) words(?:左右)?', s) or re.fullmatch(r'(\d+)\s*字(?:左右|為原則)', s)
    if m:
        return {'min': None, 'max': None, 'approx': int(m.group(1))}
    raise NormalizeError(f'無法解析 word_requirement {raw!r}：請人工判斷後加進 WORD_COUNT_MANUAL')


def map_closed(tags, key, allowed, mapping, where, keep_raw=True):
    v = tags.get(key)
    if v is None:
        return False
    if v in allowed:
        return False
    if v not in mapping:
        raise NormalizeError(f'{where}: tags.{key}={v!r} 不在封閉集合，也沒有對應規則：請判斷後加進對應表')
    tags[key] = mapping[v]
    if keep_raw and f'{key}_raw' not in tags:
        tags[f'{key}_raw'] = v
    return True


def answer_text(q, bank):
    pool = q.get('options') or bank or {}
    a = q.get('answer')
    return pool.get(a) if isinstance(a, str) else None


FIG_WORD_RE = re.compile(r'\b(pictures?|maps?|diagrams?|charts?|graphs?|tables?|illustrations?|photos?|'
                         r'photographs?|figures?|images?|drawings?)\b', re.I)
# 解析者在 description 註明「只是配圖」的圖不算讀圖（注意不能只比對「裝飾」：gsat-114 的描述裡有「裝飾華麗的柱子」）
DECORATIVE_RE = re.compile(r'僅為裝飾|為配圖|僅為插圖|不需依圖作答|不需看圖|作答所需資訊(?:都)?在文字中')
NOT_RE = re.compile(r'\b(NOT|EXCEPT)\b')


def figure_question_nos(fig, group_nos):
    """圖表明確屬於哪些小題：question_no，或 caption／label／description 寫了「第N題」。"""
    nos = set()
    if isinstance(fig.get('question_no'), int):
        nos.add(fig['question_no'])
    for field in ('caption', 'label', 'description'):
        for m in re.finditer(r'第\s*(\d+)\s*題', fig.get(field) or ''):
            n = int(m.group(1))
            if n in group_nos:
                nos.add(n)
    return nos


def classify_figure_question(g, q):
    """回傳 'certain'（一定要讀圖）、'uncertain'（題組有圖但無法確定）或 None（與圖無關）。"""
    figs = [f for f in (g.get('figures') or []) if not DECORATIVE_RE.search(f.get('description') or '')]
    if not figs:
        return None
    group_nos = {x.get('no') for x in g['questions']}
    tied = {}
    for f in figs:
        for n in figure_question_nos(f, group_nos):
            tied.setdefault(n, []).append(f)
    stem = q.get('stem') or ''
    if q.get('no') in tied:
        # 作答用的表格（例如 ref-111 第50題）是答案格式，不一定算讀圖，交給人判斷
        if all('作答用' in (f.get('caption') or '') for f in tied[q['no']]):
            return 'uncertain'
        return 'certain'
    if FIG_WORD_RE.search(stem):
        return 'certain'
    untied = [f for f in figs if not figure_question_nos(f, group_nos)]
    return 'uncertain' if untied else None


def compute_text_format(g):
    has_passage = bool((g.get('passage') or '').strip())
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
        kinds = {TEXT_FORMAT_BY_FIGURE.get(f.get('kind')) for f in figs}
        if len(kinds) == 1 and None not in kinds:
            return kinds.pop()
        raise NormalizeError(f'{g.get("id")}: 只有圖表沒有選文，但圖表種類 {[f.get("kind") for f in figs]} 無法對應 text_format')
    return 'continuous'


# ---------------------------------------------------------------------------
# 結構
# ---------------------------------------------------------------------------

def section_heading(title):
    """大題標題去掉序號與配分，例如「二、英文作文（占20分）」→「英文作文」、「Ⅰ. 中譯英（20分）」→「中譯英」。"""
    t = (title or '').strip()
    t = re.sub(r'^(?:[一二三四五六七八九十]+、|[壹貳參肆伍陸柒捌玖拾]+[、：:]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.?|[IVX]+\.)\s*', '', t)
    t = re.sub(r'\s*[（(][^（）()]*[）)]\s*$', '', t)
    return t.strip()


def parse_range(r):
    m = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*', r or '')
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def normalize_section_stats(s, where):
    st = s.pop('stats', None)
    direct = s.pop('score_distribution', None)
    if direct is not None:
        if st is not None:
            raise NormalizeError(f'{where}: 同時有 stats 與 score_distribution，請人工合併')
        st = direct
    if st is None:
        return
    st = rename_keys(st, STATS_RENAME, where)
    bins = []
    for b in st.get('score_distribution') or []:
        b = rename_keys(b, BIN_RENAME, where)
        if 'min' not in b or 'max' not in b:
            lo, hi = parse_range(b.get('range'))
            b.setdefault('min', lo)
            b.setdefault('max', hi)
        bins.append(ordered(b, 'bin'))
    st['score_distribution'] = bins
    s['stats'] = ordered(st, 'section_stats')


def build_parts(d, where):
    sections = d['sections']
    parts = d.get('parts')
    has_section_fields = any('part_title' in s or 'part_instructions' in s for s in sections)
    if parts:
        if has_section_fields:
            raise NormalizeError(f'{where}: 同時有頂層 parts 與 section.part_title／part_instructions')
        out = []
        for p in parts:
            p = rename_keys(p, {'name': 'title'}, where)
            p.setdefault('title', None)
            p.setdefault('points', None)
            p.setdefault('instructions', None)
            out.append(ordered(p, 'part'))
        return out
    if not has_section_fields:
        return None
    runs = []
    for s in sections:
        if runs and runs[-1][0]['part'] == s.get('part'):
            runs[-1].append(s)
        else:
            runs.append([s])
    out = []
    for run in runs:
        title = next((s['part_title'] for s in run if s.get('part_title')), None)
        instructions = next((s['part_instructions'] for s in run if s.get('part_instructions')), None)
        total = sum(s['points_total'] for s in run if isinstance(s.get('points_total'), (int, float)))
        m = re.search(r'[占佔]\s*(\d+)\s*分', title or '')
        points = int(m.group(1)) if m else (total or None)
        if m and total and int(m.group(1)) != total:
            print(f'  注意 {where}: 部分標題「{title}」的配分與所屬大題加總 {total} 不同，照標題', file=sys.stderr)
        out.append({'title': title, 'points': points, 'instructions': instructions,
                    'sections': [s['id'] for s in run]})
    for s in sections:
        s.pop('part_title', None)
        s.pop('part_instructions', None)
    return out


def load_manifest_subkinds():
    if not MANIFEST.exists():
        return {}
    items = json.loads(MANIFEST.read_text(encoding='utf-8')).get('items') or []
    return {it.get('local_path'): it.get('subkind') for it in items}


def normalize_sources(src, subkinds):
    src = dict(src)
    for k in ('paper_word', 'answer_sheet', 'other'):
        v = src.get(k)
        if isinstance(v, str):
            src[k] = [v]
    sheets = list(src.get('answer_sheet') or [])
    others = []
    for p in src.get('other') or []:
        (sheets if (subkinds.get(p) or '').startswith('answer_sheet') else others).append(p)
    src['answer_sheet'] = sheets
    src['other'] = others
    for k in ('paper_word', 'answer_sheet', 'other'):
        if k in src and not src[k]:
            del src[k]
    return ordered(src, 'sources')


# ---------------------------------------------------------------------------
# 主流程：一份考卷
# ---------------------------------------------------------------------------

def v11_no_lookup(exams):
    """(exam_id, section type, v1.1 no) 的集合：翻譯與作文用大題內序號，其他用原題號。"""
    out = set()
    for eid, d in exams.items():
        for s in d.get('sections') or []:
            qs = [q for g in s.get('groups') or [] for q in g.get('questions') or []]
            for i, q in enumerate(qs, 1):
                no = i if s.get('type') in ('translation', 'composition') else q.get('no')
                out.add((eid, s.get('type'), no))
    return out


def normalize_exam(d, ctx):
    eid = d['id']
    where = eid
    stats = ctx['stats']
    d = clean_all(d, stats)
    d['schema'] = SCHEMA_ID
    d['sources'] = normalize_sources(d.get('sources') or {}, ctx['subkinds'])
    parts = build_parts(d, where)
    if parts is not None:
        d['parts'] = parts
    else:
        d.pop('parts', None)

    for si, s in enumerate(d['sections']):
        sw = f'{eid} sections[{si}]'
        stype = s['type']
        normalize_section_stats(s, sw)
        if stype in ('translation', 'composition'):
            heading = section_heading(s['title'])
            qs = [q for g in s['groups'] for q in g['questions']]
            if stype == 'translation':
                if '翻譯' not in heading and '中譯英' not in heading:
                    raise NormalizeError(f'{sw}: 無法從標題 {s["title"]!r} 取出翻譯大題名稱')
                heading = re.sub(r'題$', '', heading)
            elif '作文' not in heading:
                raise NormalizeError(f'{sw}: 無法從標題 {s["title"]!r} 取出作文大題名稱')
            for i, q in enumerate(qs, 1):
                if q.get('no') != i:
                    stats['renumbered'] += 1
                q['no'] = i
                if stype == 'composition':
                    label = heading if len(qs) == 1 else f'{heading}{i}'
                else:
                    m = re.search(r'(\([a-z]\)|\d+)$', q.get('label') or '')
                    label = f'{heading}{m.group(1) if m else i}'
                if q.get('label') != label:
                    stats['relabeled'] += 1
                q['label'] = label

        for gi, g in enumerate(s['groups']):
            gw = f'{sw}.groups[{gi}]'
            if 'tags' not in g:
                g['tags'] = None
            gtags = g.get('tags')
            poem = isinstance(gtags, dict) and gtags.get('genre') == 'poem'
            old = (g.get('passage'), [p.get('text') for p in g.get('passage_parts') or []])
            g['passage'] = normalize_passage(g.get('passage'), poem)
            for p in g.get('passage_parts') or []:
                p['text'] = normalize_passage(p.get('text'), poem)
            if old != (g.get('passage'), [p.get('text') for p in g.get('passage_parts') or []]):
                stats['paragraphs'] += 1
            g['passage_parts'] = [ordered(p, 'passage_part') for p in g['passage_parts']] if g.get('passage_parts') else g.get('passage_parts')
            g['figures'] = [ordered(f, 'figure') for f in g.get('figures') or []]

            if stype not in NO_TEXT_FORMAT_SECTIONS:
                tf = compute_text_format(g)
                if tf is not None:
                    if not isinstance(gtags, dict):
                        g['tags'] = gtags = {}
                    if gtags.get('text_format') != tf:
                        stats['text_format'] += 1
                        gtags['text_format'] = tf
            if isinstance(g.get('tags'), dict):
                g['tags'] = ordered(g['tags'], 'g_tags')

            bank = g.get('options_bank')
            for q in g['questions']:
                qw = f'{gw}.q{q.get("label")}'
                tags = q.get('tags')
                if not isinstance(tags, dict):
                    tags = q['tags'] = {}
                # --- stats ---
                if isinstance(q.get('stats'), dict):
                    q['stats'] = ordered(rename_keys(q['stats'], {'no_answer_rate': 'omit_rate'}, qw), 'q_stats')
                # --- reused_from ---
                rf = q.get('reused_from')
                if isinstance(rf, dict):
                    rf = dict(rf)
                    rf.setdefault('modified', None)
                    if rf.get('no') is None and stype == 'composition':
                        rf['no'] = 1
                    if (rf.get('exam'), stype, rf.get('no')) not in ctx['nos']:
                        raise NormalizeError(f'{qw}: reused_from {rf} 在原卷找不到同類大題的這一題')
                    q['reused_from'] = ordered(rf, 'reused_from')
                # --- tags ---
                if stype == 'composition':
                    if map_closed(tags, 'essay_type', ESSAY_TYPES, ESSAY_MAP, qw, keep_raw=False):
                        stats['essay_type'] += 1
                        if tags.get('paragraphs') is None:
                            tags['paragraphs'] = 2
                        elif tags['paragraphs'] != 2:
                            raise NormalizeError(f'{qw}: two_paragraph 但 paragraphs={tags["paragraphs"]}')
                    if 'word_requirement' in tags:
                        raw = tags.pop('word_requirement')
                        tags['word_count'] = parse_word_requirement(raw)
                        tags['word_requirement_raw'] = raw
                        stats['word_count'] += 1
                if map_closed(tags, 'grammar_point', GRAMMAR_POINTS, GRAMMAR_MAP, qw):
                    stats['grammar_point'] += 1
                if map_closed(tags, 'clue', CLUES, CLUE_MAP, qw):
                    stats['clue'] += 1
                if stype in ('vocabulary', 'cloze', 'word_bank'):
                    at = answer_text(q, bank)
                    if at and len(at.split()) > 1:
                        pos = tags.get('answer_pos')
                        if pos is None:
                            manual = ANSWER_POS_MANUAL.get((eid, q.get('label')))
                            if manual is None:
                                raise NormalizeError(f'{qw}: 答案「{at}」是片語但沒有 answer_pos，請判斷後加進 ANSWER_POS_MANUAL')
                            tags['answer_pos'] = manual
                            stats['answer_pos'] += 1
                        elif pos not in ('phrase', 'clause'):
                            if pos not in POS:
                                raise NormalizeError(f'{qw}: answer_pos={pos!r} 不在允許值內')
                            tags['answer_function'] = pos
                            tags['answer_pos'] = 'phrase'
                            stats['answer_pos'] += 1
                if stype in ITEM_TYPE_SECTIONS:
                    new = None
                    if stype in NOT_RULE_SECTIONS and NOT_RE.search(q.get('stem') or ''):
                        new = 'not_mentioned'
                    elif classify_figure_question(g, q) == 'certain':
                        new = 'chart_reading'
                    if new and tags.get('item_type') != new:
                        if tags.get('item_type') is not None and 'item_type_raw' not in tags:
                            tags['item_type_raw'] = tags['item_type']
                        tags['item_type'] = new
                        stats['item_type'] += 1
                q['tags'] = ordered(tags, 'q_tags')
                unknown = [k for k in q if k not in ORDER['question']]
                if unknown:
                    raise NormalizeError(f'{qw}: 未知的小題欄位 {unknown}，請決定納入、改名或併入既有欄位')
                qq = ordered(q, 'question')
                q.clear()
                q.update(qq)
            gg = ordered(g, 'group')
            g.clear()
            g.update(gg)
        ss = ordered(s, 'section')
        s.clear()
        s.update(ss)
    d['extraction'] = ordered(d.get('extraction') or {}, 'extraction')
    return ordered(d, 'top')


# ---------------------------------------------------------------------------
# 下一階段工作清單
# ---------------------------------------------------------------------------

ORDINAL = r'(?:first|second|third|fourth|fifth|sixth|seventh|last|final|\d+(?:st|nd|rd|th))'
REFER_RE = re.compile(
    r"\b(?:bold|boldface|boldfaced|underlined|underline|italic|italicized|italics|highlighted)\b"
    r"|\blines?\s+\d+"
    r"|\bthe\s+(?:word|words|phrase|expression|term|sentence|pronoun)\b"
    # 指涉選文某一句：from the last sentence in the passage（「as the final sentence」是插入句題的位置，不算）
    r"|\b(?:in|from)\s+the\s+(?:first|second|third|fourth|fifth|last|opening)\s+sentence\b"
    r"|\b(?:it|they|them|this|that|these|those|he|she|him|her|its|their|one|ones|so|such|we|us)\s+in\s+"
    r"(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|last|final|line|paragraph|\d)", re.I)
# 引號：彎雙引號、直雙引號、彎單引號（‘infectious’；開頭的 ‘ 不會是撇號）
QUOTE_RES = [re.compile(r'“\s*([^”]{1,250}?)\s*”'), re.compile(r'"\s*([^"]{1,250}?)\s*"'),
             re.compile(r"(?<![A-Za-z])‘([^’]{1,60}?)’(?![A-Za-z])")]
UNQUOTED_RES = [re.compile(r"\b(?:word|pronoun|phrase)\s+([A-Za-z][A-Za-z’'-]*)"),
                re.compile(r"\b(?:does|do)\s+(it|they|them|this|that|these|those|he|she|its|their|one|so)\s+in\b"),
                # Which of the following words from the passage is closest in meaning to surge?
                re.compile(r"\b(?:closest|nearest|similar|opposite)\s+in\s+meaning\s+to\s+([A-Za-z][A-Za-z’'-]*)\s*\??\s*$")]
# 沒加引號、但點名某段的名詞片語：the expected improvements in the second paragraph（只取冠詞／指示詞之後的部分）
NP_IN_PARAGRAPH_RE = re.compile(
    r"\b(?:the|a|an|this|that|these|those)\s+((?:[A-Za-z’'-]+\s+){0,4}[A-Za-z’'-]+)\s+in\s+"
    r"(?:(?:the\s+)?" + ORDINAL + r"\s+paragraph|paragraph\s+\d+)", re.I)
STOPWORDS = {'in', 'on', 'from', 'is', 'which', 'used', 'the', 'a', 'an', 'of', 'here', 'most', 'means',
             'mean', 'refers', 'best', 'closest', 'carries', 'does', 'did', 'can', 'would', 'could',
             'following', 'passage', 'author', 'information', 'idea', 'ideas', 'sentence', 'sentences'}
FIND_WORD_RE = re.compile(r'\s*Which\s+(?:word|phrase|set of words|of the following words)\b', re.I)
MARK_RE = re.compile(r'<(u|b)>(.*?)</\1>', re.S)
TAG_RE = re.compile(r'</?[a-z][^>]*>')
EMPH_ISSUE_RE = re.compile(r'粗體|底線|斜體|粗斜體')
SCORING_EXC_RE = re.compile(r'送分|一律給分|一律得\s*\d*\s*分|皆給分|均給分|都給分|皆可得分|皆得分|都算對|無適當選項|兩者皆|[A-O]\s*或\s*[A-O]')
OTHER_ISSUE_RE = re.compile(
    r'人工決定|無法還原|損壞|未查證|誤植|原文如此|原文錯誤|錯字|拼字錯誤|推測|無法確定|不確定|官方沒有說明|官方未明文|'
    r'未明文|沒有明示|未明示|內部矛盾|應視為|不宜|待確認|待查|無法判定|無法分辨|疑義')
# 只是在說明「已依規定處理、不需再判斷」的 issue（例如統計表 1 個百分點的四捨五入差異）
OTHER_ISSUE_SKIP_RE = re.compile(r'推測[是為]?四捨五入差異|四捨五入差異')
# 關鍵字命中、但逐條看過確定不需要人再判斷的 issue：(考卷 id, issue 中的一段原文)。用原文片段而不是索引，
# 之後 issues 增刪也不會對錯條。
OTHER_ISSUE_SKIP = [
    ('ast-101', '評分原則原文錯字照錄'),                 # 評分原則的錯字依逐字原則照錄，沒有待決事項
    ('ast-103', '標註（tags）為解析者判讀'),             # 「推測」是文法用語（推測過去）
    ('ast-107', '標註（tags）為解析者判讀'),
    ('ast-103', '沒有公布參考譯文，也沒有列出可接受譯法'),  # 「拼字錯誤」是評分原則舉的考生錯誤
    ('ast-106', '只舉例部分詞組的可得分譯法'),
    ('ast-91', '中文文字來源：題本中文為點陣'),          # 冒號字形放大到 600dpi 仍無法判定，看原卷也無助
    ('ast-91', '查證（verifier）獨立核對結果'),
    ('gsat-102', '英文作文 scoring_notes：依序為'),      # 評分原則用字不一致照錄
    ('gsat-102', '英文作文圖（s6g1 figures）'),          # 原圖本身無法分辨，描述已並列兩種可能
    ('gsat-106', '英文作文四格漫畫（s6g1 figures）'),    # 評分原則說各種場景皆可，描述刻意不指定
    ('gsat-108', '評分原則文字：取自 scoring.pdf'),      # 中英文間空白的來源，不影響內容
    ('gsat-113', '滿分參考答案」大括號所列第一個'),      # 「拼字錯誤」是部分給分規則
    ('gsat-114', '滿分參考答案」所列第一個'),
    ('gsat-95', '標註判斷：s4g1（stress）'),             # 標註判斷；第51題已由 NOT 規則改為 not_mentioned
    ('ref-107-b', '標註：沿用題的分類欄位'),
    ('ref-115', '中譯英評分原則第3條兩份官方文件寫法不同'),  # 已註明依 scoring.pdf
]


def group_text(g):
    parts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or []]
    return '\n'.join(TAG_RE.sub('', p) for p in parts)


def excerpt(s, n=90):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return s if len(s) <= n else s[:n] + '…'


def count_occurrences(text, needle):
    if not needle:
        return 0
    if re.fullmatch(r"[A-Za-z][A-Za-z'’-]*", needle):
        return len(re.findall(r'(?<![A-Za-z])' + re.escape(needle) + r'(?![A-Za-z])', text))
    return text.count(needle)


def _loose(s):
    """比對引文用：彎直引號、撇號、刪節號一視同仁（題幹常把選文的 doctor’s 寫成 doctor's）。"""
    return (s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('…', '...'))


def quote_count(text, needle):
    """題幹引用的字串在選文出現幾次。引文中間有刪節號時（“But … most people don’t …”），
    每一段都要在選文找得到，次數取最少的一段。"""
    t, n = _loose(text), _loose(needle).strip(' .,;:!?"\'')
    pieces = [p.strip(' .,;:!?"\'') for p in n.split('...')]
    pieces = [p for p in pieces if p]
    if not pieces:
        return 0
    return min(count_occurrences(t, p) for p in pieces)


def issue_question_nos(issue):
    """從 issue 文字抓出「第37、42、51題」「37、42 題」這類題號。"""
    nos = set()
    for m in re.finditer(r'第?\s*((?:\d{1,2}\s*[、／/,，及與和]\s*)*\d{1,2})\s*題', issue):
        for n in re.findall(r'\d{1,2}', m.group(1)):
            nos.add(int(n))
    return nos


def todo_for_exam(d):
    eid = d['id']
    items = []
    issues = (d.get('extraction') or {}).get('issues') or []

    def add(kind, location, detail):
        items.append({'id': eid, 'kind': kind, 'location': location, 'detail': detail})

    emph_issue_nos = {}
    for i, iss in enumerate(issues):
        if EMPH_ISSUE_RE.search(iss):
            for n in issue_question_nos(iss):
                emph_issue_nos.setdefault(n, []).append(i)

    for s in d['sections']:
        stype = s['type']
        for g in s['groups']:
            text = group_text(g)
            marks = [m.group(2) for t in [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or []]
                     for m in MARK_RE.finditer(t)]
            figs = g.get('figures') or []
            for q in g['questions']:
                loc = f'{g["id"]}/{q["label"]}'
                stem = q.get('stem') or ''
                tags = q.get('tags') or {}
                # ---------- refers_to ----------
                if stype in ITEM_TYPE_SECTIONS and text.strip() and 'refers_to' not in q:
                    triggers = []
                    if tags.get('item_type') in ('reference', 'vocab_in_context'):
                        triggers.append(f'item_type={tags["item_type"]}')
                    m = REFER_RE.search(stem)
                    if m:
                        triggers.append(f'題幹提到「{m.group(0)}」')
                    plain = TAG_RE.sub('', stem)
                    quoted = []
                    for rx in QUOTE_RES:
                        quoted += [x for x in rx.findall(plain) if quote_count(text, x) and x not in quoted]
                    # 沒加引號的被問字詞：The word mourned here means…、The pronoun them in line 5…、What does it in…、
                    # …closest in meaning to surge?
                    for rx in UNQUOTED_RES:
                        quoted += [x for x in rx.findall(plain)
                                   if x.lower() not in STOPWORDS and count_occurrences(text, x) and x not in quoted]
                    # 點名某段的名詞片語：the expected improvements in the second paragraph（取在選文找得到的最長尾段）；
                    # 已經有引號、標記或其他規則找到的字串時不再猜
                    for np_ in ([] if quoted or '<u>' in stem or '<b>' in stem else NP_IN_PARAGRAPH_RE.findall(plain)):
                        ws_ = np_.split()
                        for k in range(len(ws_)):
                            cand = ' '.join(ws_[k:])
                            if all(w.lower() in STOPWORDS for w in ws_[k:]):
                                break
                            if count_occurrences(text, cand) and cand not in quoted:
                                quoted.append(cand)
                                break
                    if quoted and not triggers:
                        triggers.append('題幹引用選文字串')
                    if '<u>' in stem or '<b>' in stem:
                        triggers.append('題幹有強調標記')
                    # 「Which word in the passage means …」是要考生自己找字，引號裡是定義，沒有被指涉的字串
                    if triggers and not quoted and not marks and FIND_WORD_RE.match(plain) and not m:
                        triggers = []
                    if triggers:
                        cands = []
                        for x in quoted:
                            x = x.strip(' .,…')
                            cands.append(f'「{x}」在選文出現 {quote_count(text, x)} 次')
                        for x in marks:
                            if x and (x.lower() in stem.lower() or not quoted):
                                cands.append(f'選文已用標記標出「{x}」')
                        notes = []
                        if q.get('no') in emph_issue_nos:
                            notes.append('extraction.issues[' + ','.join(map(str, emph_issue_nos[q['no']])) + '] 提到原卷粗體／底線／斜體')
                        detail = f'題幹：{excerpt(stem)}｜觸發：{"、".join(triggers)}'
                        if cands:
                            detail += '｜候選：' + '；'.join(dict.fromkeys(cands))
                        if notes:
                            detail += '｜' + '；'.join(notes)
                        if marks and any(x for x in marks):
                            detail += '｜選文中的 <u> 若原卷其實是粗體，填 refers_to 時一併改成 <b> 或移除標記'
                        add('refers_to', loc, detail + '。需看原卷確認被指涉的字串與第幾次出現，填 question.refers_to')
                # ---------- answer_segments ----------
                ans = q.get('answer') or ''
                acc = q.get('accepted_answers') or []
                # 有官方大括號／樹狀圖譯法的才列：answer 帶大括號記號，或 accepted_answers 有其他譯法
                # （只有一句官方參考譯文、沒有替換寫法的，answer 就是官方整句，不需要分段）
                if q.get('mode') == 'translation' and ans and ('{' in ans or acc) \
                        and 'answer_segments' not in q and 'answer_variants' not in q:
                    bits = []
                    if '{' in ans:
                        bits.append('answer 本身含大括號記號（不是完整句子）')
                    if any('{' in a for a in acc):
                        bits.append(f'accepted_answers 有 {sum("{" in a for a in acc)} 條大括號式')
                    elif acc:
                        bits.append(f'accepted_answers 已展開 {len(acc)} 條組合')
                    if '{' in (q.get('scoring_notes') or ''):
                        bits.append('scoring_notes 含大括號譯法')
                    rel = [i for i, iss in enumerate(issues)
                           if re.search(r'大括[號弧]|樹狀|括號', iss) and re.search(r'翻譯|中譯英', iss)]
                    composite = [i for i in rel if re.search(r'第一個(?:選項|寫法)|取各(?:大)?括[號弧]第一', issues[i])]
                    linked = [i for i in rel if re.search(r'對應關係|配對|搭配使用|平行結構|單複數', issues[i])]
                    if composite:
                        bits.append('extraction.issues[' + ','.join(map(str, composite)) + '] 說 answer 取各段第一個選項組成（answer_is_composite 候選）')
                    if linked:
                        bits.append('extraction.issues[' + ','.join(map(str, linked)) + '] 提到括號之間有相依（可能要用 answer_variants）')
                    rest = [i for i in rel if i not in composite and i not in linked]
                    if rest:
                        bits.append('樹狀圖轉錄說明見 extraction.issues[' + ','.join(map(str, rest)) + ']')
                    add('answer_segments', loc,
                        f'題目：{excerpt(stem, 50)}｜' + '；'.join(bits or ['有官方參考譯文']) +
                        '。需對照官方樹狀圖填 answer_segments（跨段相依時改填 answer_variants），並判斷 answer_is_composite')
                # ---------- scoring_exception ----------
                if 'scoring_exception' not in q:
                    reasons = []
                    if q.get('mode') in CHOICE_MODES and q.get('accepted_answers'):
                        reasons.append(f'選擇題有 accepted_answers {q["accepted_answers"]}（官方公告多個答案？）')
                    sn = q.get('scoring_notes') or ''
                    m = SCORING_EXC_RE.search(sn)
                    if m and q.get('mode') in CHOICE_MODES:
                        reasons.append(f'scoring_notes：{excerpt(sn, 60)}')
                    if reasons:
                        add('scoring_exception', loc, '；'.join(reasons) + '。需核對答案檔／評分原則後填 scoring_exception')
                # ---------- chart_reading ----------
                if stype in ITEM_TYPE_SECTIONS and tags.get('item_type') != 'chart_reading':
                    if classify_figure_question(g, q) == 'uncertain' and not (stype in NOT_RULE_SECTIONS and NOT_RE.search(stem)):
                        kinds = '、'.join(sorted({f.get('kind') or '?' for f in figs}))
                        add('chart_reading', loc,
                            f'題組有圖表（{kinds}），題幹沒有明說要看圖：{excerpt(stem, 70)}｜目前 item_type={tags.get("item_type")}。'
                            '需看原卷判斷是否必須讀圖才能作答（是就改為 chart_reading）')
                # ---------- image_options ----------
                opts = q.get('options') or {}
                img_opts = [k for k, v in opts.items() if re.match(r'^\s*[（(［\[]\s*(圖|圖片|地圖|照片|插圖)', v or '')]
                letter_opts = figs and opts and all(re.fullmatch(r'[A-H]', (v or '').strip()) for v in opts.values())
                if img_opts or letter_opts:
                    why = (f'選項 {"".join(img_opts)} 只有圖片，目前以文字描述代替' if img_opts
                           else '選項是圖上標示的代號，只看文字無法作答')
                    add('image_options', loc, f'{why}：{excerpt(stem, 60)}。需決定前端呈現方式（裁切原圖或保留文字描述）')

    # ---------- scoring_exception／other：extraction.issues ----------
    has_q_exc = any(t['kind'] == 'scoring_exception' for t in items)
    for i, iss in enumerate(issues):
        loc = f'extraction.issues[{i}]'
        if SCORING_EXC_RE.search(iss) and re.search(r'送分|給分|得一分|都算對|皆算對|無適當選項', iss) \
                and not re.search(r'部分給分|五個項目給分|五項|四項|給分規則', iss):
            # 已經從小題（scoring_notes／accepted_answers）列出來的，不再重複列 issue
            if not has_q_exc:
                add('scoring_exception', loc, f'issue 提到送分或多個答案：{excerpt(iss, 160)}')
            continue
        if OTHER_ISSUE_RE.search(iss):
            if any(eid == sid and frag in iss for sid, frag in OTHER_ISSUE_SKIP):
                continue
            body = OTHER_ISSUE_SKIP_RE.sub('', iss)
            if not OTHER_ISSUE_RE.search(body):
                continue
            hits = '、'.join(dict.fromkeys(OTHER_ISSUE_RE.findall(body)))
            add('other', loc, f'（{hits}）{excerpt(iss, 220)}')
    return items


KIND_ORDER = ['refers_to', 'answer_segments', 'scoring_exception', 'chart_reading', 'image_options', 'other']


# ---------------------------------------------------------------------------

def dump(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2) + '\n'


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='只檢查，不寫檔；還有檔案需要正規化時以 1 結束')
    ap.add_argument('--backup-dir', type=Path, default=DEFAULT_BACKUP, help=f'備份目錄（預設 {DEFAULT_BACKUP}）')
    args = ap.parse_args(argv)

    paths = sorted(PARSED.glob('*.json'))
    raw = {p: p.read_text(encoding='utf-8') for p in paths}
    exams = {}
    for p, text in raw.items():
        d = json.loads(text)
        exams[d['id']] = d
    ctx = {'subkinds': load_manifest_subkinds(), 'nos': v11_no_lookup(exams), 'stats': Counter()}

    results = {}
    errors = []
    for p in paths:
        d = json.loads(raw[p])
        try:
            results[p] = dump(normalize_exam(d, ctx))
        except NormalizeError as e:
            errors.append(str(e))
    if errors:
        for e in errors:
            print(f'ERROR {e}', file=sys.stderr)
        return 2

    todo = []
    for p in paths:
        todo += todo_for_exam(json.loads(results[p]))
    todo.sort(key=lambda t: (KIND_ORDER.index(t['kind']), t['id'], t['location']))
    todo_text = dump(todo)

    changed = [p for p in paths if results[p] != raw[p]]
    todo_changed = not TODO.exists() or TODO.read_text(encoding='utf-8') != todo_text
    if args.check:
        for p in changed:
            print(f'需要正規化：{p.name}')
        if todo_changed:
            print(f'工作清單需要更新：{TODO.relative_to(ROOT)}')
        return 1 if changed or todo_changed else 0

    if changed:
        args.backup_dir.mkdir(parents=True, exist_ok=True)
        kept = 0
        for p in paths:
            dst = args.backup_dir / p.name
            if not dst.exists():
                shutil.copy2(p, dst)
                kept += 1
        print(f'備份：{args.backup_dir}（新寫入 {kept} 份；已存在的備份不覆蓋）')
    for p in changed:
        p.write_text(results[p], encoding='utf-8')
    if todo_changed:
        TODO.write_text(todo_text, encoding='utf-8')
    counts = Counter(t['kind'] for t in todo)
    print(f'正規化：{len(changed)}／{len(paths)} 份檔案有變動')
    if ctx['stats']:
        print('變動統計（第一次跑時有意義；重跑應為 0 份檔案變動）：' +
              '、'.join(f'{k} {v}' for k, v in sorted(ctx['stats'].items())))
    print(f'工作清單：{TODO.relative_to(ROOT)}，共 {len(todo)} 筆（' +
          '、'.join(f'{k} {counts[k]}' for k in KIND_ORDER if counts[k]) + '）')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
