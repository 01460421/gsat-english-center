#!/usr/bin/env python3
"""檢查 data/exams/parsed/*.json 是否符合 docs/exam-json-schema.md（gsat-exam/v1）。

用法：
    python3 tools/validate_exam.py data/exams/parsed/gsat-115.json [...]
    python3 tools/validate_exam.py --all

error 代表資料一定有問題（缺欄位、題號斷掉、答案不在選項裡、選文的空格對不上題號）；
warning 是可能合理但需要人看一眼的情況（例如舊卷沒有統計、題數跟同期別規格不同）。
有任何 error 時結束碼為 1。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / 'data' / 'exams' / 'parsed'

SECTION_TYPES = {'vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed',
                 'sentence_matching', 'short_answer', 'translation', 'composition', 'other'}
MODES = {'single_choice', 'multi_select', 'bank_choice', 'fill_in_blank', 'short_answer',
         'table_completion', 'translation', 'composition'}
CHOICE_MODES = {'single_choice', 'multi_select', 'bank_choice'}
BANK_TYPES = {'word_bank', 'structure', 'sentence_matching'}
BLANK_TYPES = {'cloze', 'word_bank', 'structure'}
TEST_POINTS = {'word_meaning', 'collocation', 'phrase', 'connective', 'grammar', 'word_form', 'discourse'}
POS = {'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause'}
ITEM_TYPES = {'main_idea', 'detail', 'inference', 'vocab_in_context', 'reference', 'purpose',
              'tone_attitude', 'structure', 'chart_reading', 'sequencing', 'title', 'not_mentioned',
              'application', 'synthesis'}
GENRES = {'news', 'expository', 'narrative', 'biography', 'letter_email', 'advertisement', 'dialogue',
          'opinion', 'instructions', 'poem', 'other'}
TEXT_FORMATS = {'continuous', 'chart', 'table', 'multi_text', 'map', 'form', 'timeline', 'mixed'}
ESSAY_TYPES = {'picture', 'topic', 'letter', 'chart', 'two_paragraph', 'continuation', 'other'}
ID_RE = re.compile(r'^(gsat|ast)-\d{2,3}(-makeup)?$|^ref-\d{2,3}(-[a-z])?$')
BLANK_RE = re.compile(r'\[\[(\d+)\]\]')


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


def check_tags(r, where, tags, section_type, level):
    if tags is None:
        return
    if not isinstance(tags, dict):
        r.err(where, 'tags 必須是物件')
        return
    def enum(key, allowed):
        v = tags.get(key)
        if v is not None and v not in allowed:
            r.err(where, f'tags.{key}={v!r} 不在允許值內')
    if level == 'question':
        if section_type in ('vocabulary', 'cloze', 'word_bank'):
            enum('test_point', TEST_POINTS)
            enum('answer_pos', POS)
        if section_type in ('reading', 'mixed'):
            enum('item_type', ITEM_TYPES)
        if section_type == 'composition':
            enum('essay_type', ESSAY_TYPES)
    else:
        enum('genre', GENRES)
        enum('text_format', TEXT_FORMATS)
        sdgs = tags.get('sdgs')
        if sdgs is not None and (not isinstance(sdgs, list) or any(not isinstance(n, int) or not 1 <= n <= 17 for n in sdgs)):
            r.err(where, 'tags.sdgs 必須是 1–17 的整數陣列')


def check_stats(r, where, stats, options):
    if stats is None:
        return
    if not isinstance(stats, dict):
        r.err(where, 'stats 必須是物件或 null')
        return
    for k in ('correct_rate', 'high_group', 'low_group', 'discrimination'):
        v = stats.get(k)
        if v is None:
            continue
        if not isinstance(v, (int, float)):
            r.err(where, f'stats.{k} 必須是數字')
        elif k != 'discrimination' and not 0 <= v <= 1:
            r.err(where, f'stats.{k}={v} 應為 0–1 的小數（百分比要除以 100）')
        elif k == 'discrimination' and not -1 <= v <= 1:
            r.err(where, f'stats.discrimination={v} 超出 -1–1')
    rates = stats.get('option_rates')
    if rates:
        if not isinstance(rates, dict):
            r.err(where, 'stats.option_rates 必須是物件')
        else:
            bad = [k for k, v in rates.items() if not isinstance(v, (int, float)) or not 0 <= v <= 1]
            if bad:
                r.err(where, f'stats.option_rates 的 {bad} 不是 0–1 的小數')
            total = sum(v for v in rates.values() if isinstance(v, (int, float)))
            if total > 1.05:
                r.warn(where, f'stats.option_rates 加總 {total:.2f} > 1')


def check_question(r, where, q, section_type, bank):
    for key in ('no', 'label', 'mode', 'points'):
        if key not in q:
            r.err(where, f'缺少欄位 {key}')
    if not isinstance(q.get('no'), int):
        r.err(where, 'no 必須是整數')
    mode = q.get('mode')
    if mode not in MODES:
        r.err(where, f'mode={mode!r} 不在允許值內')
    if q.get('points') is not None and not isinstance(q.get('points'), (int, float)):
        r.err(where, 'points 必須是數字或 null')
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
        if opts and section_type == 'vocabulary' and len(opts) != 4:
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
    if mode in ('single_choice', 'multi_select') and section_type in ('vocabulary', 'reading', 'mixed') and not nonempty_str(q.get('stem')):
        r.err(where, '缺少題幹 stem')
    if mode in ('translation', 'composition') and not nonempty_str(q.get('stem')):
        r.err(where, '翻譯／作文缺少題目 stem')
    if mode == 'composition' and ans is not None:
        r.warn(where, '作文的 answer 應為 null（範文不是官方答案）')
    check_stats(r, where, q.get('stats'), opts or bank or {})
    check_tags(r, where, q.get('tags'), section_type, 'question')


def check_exam(path):
    r = Report(path.name)
    try:
        d = json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001 — 任何解析錯誤都要回報
        r.err('file', f'JSON 解析失敗：{e}')
        return r
    if d.get('schema') != 'gsat-exam/v1':
        r.err('top', 'schema 必須是 "gsat-exam/v1"')
    eid = d.get('id')
    if not isinstance(eid, str) or not ID_RE.match(eid):
        r.err('top', f'id={eid!r} 不符合命名規則')
    elif path.stem != eid:
        r.err('top', f'檔名 {path.stem} 與 id {eid} 不一致')
    if d.get('exam') not in ('gsat', 'ast', 'reference'):
        r.err('top', 'exam 必須是 gsat／ast／reference')
    if not isinstance(d.get('year'), int):
        r.err('top', 'year 必須是整數')
    if d.get('session') not in ('regular', 'makeup'):
        r.err('top', 'session 必須是 regular／makeup')
    for key in ('title', 'sources', 'sections', 'extraction'):
        if key not in d:
            r.err('top', f'缺少欄位 {key}')
    src = d.get('sources') or {}
    paper = src.get('paper')
    if not nonempty_str(paper):
        r.err('sources', '缺少 paper 路徑')
    for kind in ('paper', 'answer', 'scoring', 'stats'):
        v = src.get(kind)
        paths = [v] if isinstance(v, str) else (v or [])
        for p in paths:
            if not (ROOT / p).exists():
                r.warn('sources', f'{kind} 檔案不存在於本機：{p}（data/raw 可用 tools/fetch_ceec.py 重新下載）')

    sections = d.get('sections') or []
    if not sections:
        r.err('sections', '沒有任何大題')
    seen_nos = []
    seen_labels = set()
    total_points = 0
    has_stats = False
    for si, s in enumerate(sections):
        sw = f'sections[{si}]'
        stype = s.get('type')
        if stype not in SECTION_TYPES:
            r.err(sw, f'type={stype!r} 不在允許值內')
        for key in ('id', 'title', 'instructions', 'groups'):
            if key not in s:
                r.err(sw, f'缺少欄位 {key}')
        if isinstance(s.get('points_total'), (int, float)):
            total_points += s['points_total']
        else:
            r.warn(sw, 'points_total 不是數字')
        sec_points = 0
        for gi, g in enumerate(s.get('groups') or []):
            gw = f'{sw}.groups[{gi}]'
            bank = g.get('options_bank')
            if stype in BANK_TYPES and not bank:
                r.err(gw, f'{stype} 題組缺少 options_bank')
            if stype == 'word_bank' and bank and len(bank) < 10:
                r.warn(gw, f'文意選填選項只有 {len(bank)} 個')
            qs = g.get('questions') or []
            if not qs:
                r.err(gw, '題組沒有任何小題')
            passage = g.get('passage')
            parts = g.get('passage_parts')
            text = passage or ''
            if parts:
                text += '\n'.join(p.get('text', '') for p in parts if isinstance(p, dict))
            if stype in ('cloze', 'word_bank', 'structure', 'reading') and not text.strip():
                r.err(gw, '缺少選文 passage')
            if stype in BLANK_TYPES:
                blanks = [int(x) for x in BLANK_RE.findall(text)]
                nos = [q.get('no') for q in qs]
                if blanks != nos:
                    r.err(gw, f'選文中的空格 {blanks} 與小題題號 {nos} 不一致（空格要寫成 [[題號]]）')
            if stype in ('reading', 'mixed', 'cloze', 'word_bank', 'structure'):
                tags = g.get('tags') or {}
                if not tags.get('topic'):
                    r.warn(gw, '題組沒有 tags.topic')
            check_tags(r, gw, g.get('tags'), stype, 'group')
            for fi, f in enumerate(g.get('figures') or []):
                if not nonempty_str(f.get('description')) and not f.get('rows'):
                    r.err(f'{gw}.figures[{fi}]', '圖表沒有文字描述也沒有 rows')
            for qi, q in enumerate(qs):
                qw = f'{gw}.q{q.get("label", qi)}'
                check_question(r, qw, q, stype, bank)
                if isinstance(q.get('no'), int):
                    seen_nos.append(q['no'])
                label = q.get('label')
                if label in seen_labels:
                    r.err(qw, f'label {label} 重複')
                seen_labels.add(label)
                if isinstance(q.get('points'), (int, float)):
                    sec_points += q['points']
                if q.get('stats'):
                    has_stats = True
        pt = s.get('points_total')
        if isinstance(pt, (int, float)) and sec_points and abs(sec_points - pt) > 0.01:
            r.warn(sw, f'小題分數加總 {sec_points} 與 points_total {pt} 不同')

    # 題號：選擇題、混合題的題號要從 1 連續；翻譯與作文常不編號，所以只看有出現的整數
    numbered = sorted(set(seen_nos))
    if numbered:
        expected = list(range(numbered[0], numbered[-1] + 1))
        missing = sorted(set(expected) - set(numbered))
        if numbered[0] != 1:
            r.warn('numbering', f'題號從 {numbered[0]} 開始')
        if missing:
            r.err('numbering', f'題號缺少 {missing}')
    dup = sorted({n for n in seen_nos if seen_nos.count(n) > 1})
    if dup:
        r.warn('numbering', f'題號重複 {dup}（混合題的 47A／47B 會共用題號，請確認 label 不同）')
    full = d.get('full_score')
    if isinstance(full, (int, float)) and total_points and abs(total_points - full) > 0.01:
        r.warn('points', f'各大題 points_total 加總 {total_points} 與 full_score {full} 不同')
    if not has_stats:
        r.warn('stats', '整份考卷沒有任何統計資料（學測 91、指考 91 以後應該都有）')
    ext = d.get('extraction') or {}
    if not isinstance(ext.get('issues', []), list):
        r.err('extraction', 'issues 必須是陣列')
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
