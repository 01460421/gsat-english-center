#!/usr/bin/env python3
"""產生 AI 題庫的批次規格 data/bank/lots/{section}-{tier}-{nn}.json（SPEC §5.2 步驟 1、ROADMAP §9.2–9.3）。

用法：
    python3 tools/make_lots.py                 # 第一批：詞彙題、綜合測驗、文意選填、篇章結構、閱讀、混合題 × 三種難度（已存在的略過）
    python3 tools/make_lots.py --sections reading,mixed   # 只產生這幾種題型
    python3 tools/make_lots.py --seq 02        # 下一批（批號 02）
    python3 tools/make_lots.py --force         # 覆寫已存在的檔案（只在該批還沒開始生成時用）
    python3 tools/make_lots.py --dry-run       # 只印摘要，不寫檔
第 2 批起（擴充到每個難度 ≥100 小題；data/bank/README.md §9）：
    python3 tools/make_lots.py --topics data/bank/topic-plan.json --avoid-existing-bank            # 主題總表裡 seq 02 起的全部批次
    python3 tools/make_lots.py --seq 02,03 --sections cloze --topics data/bank/topic-plan.json --avoid-existing-bank
    python3 tools/make_lots.py --check-topics [--topics data/bank/topic-plan.json]                # 檢查主題總表（配額、重複、與已用主題撞題）
    （--seq 可寫逗號清單或範圍 02-05；給了 --topics 而沒給 --seq 時＝主題總表裡 02 以後的全部批次）

每個批次規格寫入：
    題型、難度、組數（ROADMAP §9.2：詞彙 5 組×10 題、綜合 8 組×5 格、文意選填 5 組、篇章結構 5 組）、
    主題配額（docs/research/08 §6.1：每 8 組「起源與演變 3、科普與健康 2–3、文化與歷史 2、社會與議題 1」，依組數等比例取整）、
    要避開的近期正解字與主題（data/exams/parsed 的 gsat-111～115 與 ref-115 同一大題的正解）、
    文章指標帶（SPEC §3.4 疊上出題規格書的 passage_overrides）、題目規則（SPEC §3.5，取自 data/specs/tiers.json）、
    目標考點與配比（出題規格書 data/exams/generation-spec/{section}.json 的 tiers 與 set_composition）、spec_id、uid 前綴。
閱讀、混合題（build_reading_mixed）另外寫入：
    文本形式配額 form_quota（閱讀：ROADMAP §9.2 每個難度長文 4、圖表 2、表格 1、多文本 1；混合題：雙文本 2、多則短段落 2）、
    SDG 配額 sdg_quota（SPEC §5.2、§6.6：閱讀每批至少 1 篇 SDG 3／12／14／15 的具體事件切入；出題規格書 RD-SDG-01 ≥50% 有 SDG）、
    混合題的子題格式 format（出題規格書 mixed.json format.sub_items，AI 題號 1–4）與多選正解字母上限、
    素材規則 materials（事實單、來源白名單、圖表格式）；文章指標帶疊上出題規格書的 passage_overrides
    （閱讀的 cov_L1_4、cov_L1_6、offlist、beyond_l4_ratio、mean_sent_len 是區間，整段取代 SPEC 的帶；混合題的 beyond_l4_max 是上限；
    段落數、句數、FK 這類 warning 級指標放在 passage_band.advisory，text_metrics 不檢查）。
批次規格一旦開始生成就不再修改（檔案裡的數字就是那一批的依據）；規格改了就開下一批。只用標準函式庫。
第 2 批起（build_lot）在同樣的欄位之外另加：count 取主題總表該批的組數（form_quota、topic_quota 跟著重算）、
assigned_topics（每組一個指定主題）、topic_plan（主題規則）、avoid_bank_answers（--avoid-existing-bank：data/bank/v1
已用過的正解字、正解句與干擾字）、generation_notes（第一批審查意見轉成的出題提醒）、inherited_from_seq01（第一批規格檔的人工調整）。
不加這些參數時的輸出與以前完全相同。
"""
import argparse
import functools
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import text_metrics as tm  # noqa: E402
from exam_stats import FUNCTION_POS  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / 'data' / 'exams' / 'parsed'
SPECS = ROOT / 'data' / 'exams' / 'generation-spec'
LOTS = ROOT / 'data' / 'bank' / 'lots'

RECENT_EXAMS = ['gsat-111', 'gsat-112', 'gsat-113', 'gsat-114', 'gsat-115', 'ref-115']
# ROADMAP §9.2：每個難度的組數
COUNTS = {'vocabulary': 5, 'cloze': 8, 'word_bank': 5, 'structure': 5}
SECTIONS = list(COUNTS)
TIERS = ['basic', 'advanced', 'top']
SPEC_TIER_KEY = {'basic': 'foundation', 'advanced': 'advanced', 'top': 'beyond_top'}
SET_COMPOSITION_KEY = {'vocabulary': 'practice_set_10', 'cloze': 'practice_set_5', 'word_bank': 'per_passage_blank_tier_mix',
                       'structure': 'practice_set_4'}
# 出題規格書 tiers.* 裡只供參考的觀察值，不放進批次規格（生成提示不需要，放了反而干擾）
OBSERVATIONAL = {'observed', 'blank_stats_current', 'blank_stats_gsat_91_115', 'target_stats', 'distractor_profile_observed',
                 'ast_supplement', 'expected_correct_rate_for_band_students', 'expected_passage_mean_P', 'target',
                 'label', 'label_zh', 'band_id', 'audience', 'target_group', 'rule', 'passage_overrides', 'passage'}
TOPIC_CATEGORIES = [
    ('origins_evolution', '起源與演變'),
    ('science_health', '科普與健康'),
    ('culture_history', '文化與歷史'),
    ('society_issues', '社會與議題'),
]


def topic_quota(n):
    """08 §6.1 每 8 組 3／2–3／2／1；n 組時依比例取整，總數等於 n（每類至少 1 組，n < 4 除外）。"""
    if n >= 8:
        base = {'origins_evolution': 3, 'science_health': 2, 'culture_history': 2, 'society_issues': 1}
        extra = n - 8
        order = ['science_health', 'origins_evolution', 'culture_history', 'society_issues']
        for i in range(extra):
            base[order[i % 4]] += 1
        return base
    if n >= 4:
        q = {k: 1 for k, _ in TOPIC_CATEGORIES}
        for k in ['origins_evolution', 'science_health', 'culture_history', 'origins_evolution'][:n - 4]:
            q[k] += 1
        return q
    return {k: (1 if i < n else 0) for i, (k, _) in enumerate(TOPIC_CATEGORIES)}


def lemma_of(word, lex):
    """單字的詞彙表主形（同形多筆取最低級）；查不到回傳原字。功能詞回傳 None。"""
    idxs = set()
    for c in tm.base_candidates(word):
        idxs = lex.lookup(c)
        if idxs:
            break
    if not idxs:
        return word.lower()
    entries = sorted((lex.entries[i] for i in idxs), key=lambda e: e['level'])
    if all(all(p.strip('()') in FUNCTION_POS for p in e['pos']) for e in entries):
        return None
    if entries[0]['level'] == 1:
        return None  # L1 字太常用，避開沒有意義（多半是文法或延伸義題，考點不在字本身）
    return entries[0]['word'].lower()


def recent_answers(section):
    """近期同一大題的正解：(單字主形與片語集合, 正解句子, 主題集合)。"""
    lex = tm.lexicon()
    words, sentences, topics = set(), [], set()
    for eid in RECENT_EXAMS:
        d = json.loads((PARSED / f'{eid}.json').read_text(encoding='utf-8'))
        for s in d['sections']:
            if s['type'] != section:
                continue
            for g in s['groups']:
                t = (g.get('tags') or {}).get('topic')
                if t:
                    topics.add(t)
                pool_bank = g.get('options_bank') or {}
                for q in g['questions']:
                    pool = q.get('options') or pool_bank
                    text = pool.get(q.get('answer')) if isinstance(q.get('answer'), str) else None
                    if not text:
                        continue
                    text = tm.MARKUP_RE.sub('', text).strip()
                    if section == 'structure':
                        if text not in sentences:
                            sentences.append(text)
                        continue
                    if len(text.split()) == 1:
                        lm = lemma_of(text, lex)
                        if lm:
                            words.add(lm)
                    else:
                        words.add(text.lower())
    return sorted(words), sentences, sorted(topics)


def strip_observations(x):
    if isinstance(x, dict):
        return {k: strip_observations(v) for k, v in x.items()
                if 'counts' not in k and k not in ('pooled_gsat', 'current', 'items_with_any_option_ge_L5_current')}
    return x


def passage_band(section, tier, spec_tier):
    spec = tm.spec_band(section, tier)
    if spec is None:
        return None
    ov = spec_tier.get('passage_overrides') or spec_tier.get('passage') or {}
    band = {k: dict(v) for k, v in spec.items()}
    applied = []
    if isinstance(ov.get('words'), list) and len(ov['words']) == 2:
        band['word_count'] = {'min': ov['words'][0], 'max': ov['words'][1]}
        applied.append('words')
    if 'coverage_L1_4_min' in ov:
        # 出題規格書只給下限（「難度由空格與誘答決定」）；保留 SPEC 的上限會讓帶窄到 1 個百分點（篇章結構超越頂標 0.90–0.91），
        # 所以整段換成規格書的下限、不設上限
        band['coverage_l1_4'] = {'min': ov['coverage_L1_4_min'], 'max': None}
        applied.append('coverage_L1_4_min（取代 SPEC 的區間）')
    if 'coverage_L1_6_min' in ov:
        band['coverage_l1_6']['min'] = ov['coverage_L1_6_min']
        applied.append('coverage_L1_6_min')
    if 'offlist_max' in ov:
        band['offlist_ratio']['max'] = ov['offlist_max']
        applied.append('offlist_max')
    elif 'coverage_L1_6_min' in ov:
        band['offlist_ratio']['max'] = round(1 - ov['coverage_L1_6_min'], 4)
        applied.append('offlist_max（＝1 − coverage_L1_6_min）')
    if 'beyond_l4_ratio_max' in ov:
        band['beyond_l4_ratio'] = {'min': None, 'max': ov['beyond_l4_ratio_max']}
        applied.append('beyond_l4_ratio_max')
    basis = 'SPEC §3.4' + (f'＋出題規格書 passage_overrides（{"、".join(applied)}）' if applied else '')
    return {'basis': basis, 'spec_3_4': spec, 'overrides_note': ov.get('note'), **band}


def build(section, tier, seq):
    spec = json.loads((SPECS / f'{section}.json').read_text(encoding='utf-8'))
    tiers = tm.tiers_spec()
    st = spec['tiers'][SPEC_TIER_KEY[tier]]
    fmt = tiers['section_formats'][section]
    words, sentences, topics = recent_answers(section)
    n = COUNTS[section]
    comp = spec.get('set_composition', {}).get(SET_COMPOSITION_KEY[section])
    if isinstance(comp, dict) and SPEC_TIER_KEY[tier] in comp:
        comp = comp[SPEC_TIER_KEY[tier]]
    lot_id = f'{section}-{tier}-{seq}'
    has_passage = fmt['has_passage']
    return {
        'schema': 'gsat-bank-lot/v1',
        'lot': lot_id,
        'section_type': section,
        'tier': tier,
        'label_zh': f'{spec.get("label_zh", section)}‧{tiers["tier_labels"][tier]}（第 {int(seq)} 批）',
        'created_on': date.today().isoformat(),
        'count': n,
        'questions_per_group': fmt['questions'],
        'format_version': fmt['format_version'],
        'uid_prefix': f'ai.{tiers["bank_uid_codes"][section]}.',
        'path': f'data/bank/v1/{section}/{tier}/',
        'spec_id': f'{section}-{tier}@{spec.get("generated_on")}',
        'spec_file': f'data/exams/generation-spec/{section}.json',
        'spec_tier_key': SPEC_TIER_KEY[tier],
        'spec_status': spec.get('status'),
        'topic_quota': ({k: v for k, v in topic_quota(n).items()} | {
            'labels_zh': dict(TOPIC_CATEGORIES),
            'basis': '08 §6.1（每 8 組：起源與演變 3、科普與健康 2–3、文化與歷史 2、社會與議題 1），依組數等比例取整',
        }) if has_passage else {
            'basis': '詞彙題是單句題，不設選文主題配額；同一組 10 題的題幹情境至少 5 種（校園、科技、健康、社會、文化…）',
        },
        'answer_letter_share': [0.2, 0.3] if section in ('vocabulary', 'cloze') else None,
        'avoid': {
            'basis': f'data/exams/parsed 的 {"、".join(RECENT_EXAMS)} 同一大題（{section}）的正解'
                     + ('（單字取詞彙表主形，功能詞與 L1 字不列；片語整串列出）' if section != 'structure' else '（正解句；避免重寫成同義句）'),
            'answer_words': words,
            'answer_sentences': sentences,
            'topics': topics,
        },
        'passage_band': passage_band(section, tier, st) if has_passage else None,
        'item_rules': tiers['item_rules'][section][tier],
        'targets': strip_observations({k: v for k, v in st.items() if k not in OBSERVATIONAL}),
        'set_composition': comp,
        'verification': {
            'blind_solvers': 2,
            'blind_b_different_model': True,
            'distractor_audit': True,
            'unique_solution': section in ('word_bank', 'structure'),
            'human_review': '100%（校準期：每個題型 × 提示詞版本的前 30 組全審，SPEC §5.8）',
        },
    }


# ---------------------------------------------------------------------------
# 閱讀、混合題（ROADMAP §9.2：閱讀每個難度 8 組＝長文 4、圖表 2、表格 1、多文本 1；混合題每個難度 4 組）
# ---------------------------------------------------------------------------

RM_COUNTS = {'reading': 8, 'mixed': 4}
RM_SECTIONS = list(RM_COUNTS)
READING_FORM_QUOTA = {'continuous': 4, 'chart': 2, 'table': 1, 'multi_text': 1}
MIXED_FORM_QUOTA = {'two_texts': 2, 'entries': 2}
FOCUS_SDGS = [3, 12, 14, 15]
CHART_TYPES = ['bar', 'line', 'stacked_bar', 'pie']
SET_COMPOSITION_RM = {'reading': 'practice_set_4', 'mixed': 'one_set'}
# 出題規格書 tiers.* 裡 reading／mixed 特有的觀察值鍵（只在 build_reading_mixed 用，前四種題型不受影響）
RM_OBSERVATIONAL = OBSERVATIONAL | {'P_target_range', 'n_current'}


def strip_rm(x):
    """去掉觀察值：鍵名以 _current 結尾、含 gsat_91_115、以 observed／official 開頭的欄位。"""
    if isinstance(x, dict):
        return {k: strip_rm(v) for k, v in x.items()
                if not (k.endswith('_current') or 'gsat_91_115' in k or k.startswith(('observed', 'official')))}
    if isinstance(x, list):
        return [strip_rm(v) for v in x]
    return x


def passage_band_rm(section, tier, spec_tier):
    """SPEC §3.4 的帶疊上閱讀、混合題出題規格書的 passage_overrides（區間整段取代；README §4「帶」）。"""
    spec = tm.spec_band(section, tier)
    ov = spec_tier.get('passage_overrides') or {}
    band = {k: dict(v) for k, v in spec.items()}
    applied = []

    def rng(v):
        return {'min': v[0], 'max': v[1]} if isinstance(v, list) and len(v) == 2 else None

    if rng(ov.get('words')):
        band['word_count'] = rng(ov['words'])
        applied.append('words')
    for key, target in (('cov_L1_4', 'coverage_l1_4'), ('cov_L1_6', 'coverage_l1_6'), ('offlist', 'offlist_ratio'),
                        ('beyond_l4_ratio', 'beyond_l4_ratio'), ('mean_sent_len', 'avg_sentence_length')):
        if rng(ov.get(key)):
            band[target] = rng(ov[key])
            applied.append(f'{key}（取代 SPEC 的區間）' if target in spec else key)
    if 'beyond_l4_max' in ov:
        band['beyond_l4_ratio'] = {'min': None, 'max': ov['beyond_l4_max']}
        applied.append('beyond_l4_max')
    advisory = {k: rng(ov[k]) for k in ('paragraphs', 'sentences', 'max_sent_len', 'fk_grade', 'long_word_ratio', 'distinct_L5_6')
                if rng(ov.get(k))}
    basis = 'SPEC §3.4' + (f'＋出題規格書 passage_overrides（{"、".join(applied)}）' if applied else '')
    out = {'basis': basis, 'spec_3_4': spec, 'overrides_note': ov.get('note'), **band}
    if advisory:
        out['advisory'] = {**advisory, 'note_zh': '出題規格書 warning 級的篇章指標（RD-PAS-02／03），text_metrics 不檢查，生成時參考'}
    for k in ('structure', 'genre', 'genre_allowed', 'text_format_allowed'):
        if k in ov:
            out[k] = ov[k]
    return out


def recent_reading_mixed(section):
    """近期同一大題：(要避開的答案字, 正解句, 主題)。閱讀記正解選項句；混合題記填充與簡答的答案（單字取詞彙表主形）。"""
    lex = tm.lexicon()
    words, sentences, topics = set(), [], set()
    for eid in RECENT_EXAMS:
        d = json.loads((PARSED / f'{eid}.json').read_text(encoding='utf-8'))
        for s in d['sections']:
            if s['type'] != section:
                continue
            for g in s['groups']:
                t = (g.get('tags') or {}).get('topic')
                if t:
                    topics.add(t)
                for q in g['questions']:
                    ans = q.get('answer')
                    if section == 'reading':
                        text = (q.get('options') or {}).get(ans) if isinstance(ans, str) else None
                        text = tm.MARKUP_RE.sub('', text).strip() if text else None
                        if text and text not in sentences:
                            sentences.append(text)
                    elif q.get('mode') in ('fill_in_blank', 'short_answer') and isinstance(ans, str):
                        for a in [ans] + [x for x in q.get('accepted_answers') or [] if isinstance(x, str)]:
                            a = tm.MARKUP_RE.sub('', a).strip().rstrip('.')
                            if len(a.split()) == 1:
                                lm = lemma_of(a, lex)
                                if lm:
                                    words.add(lm)
                            elif a:
                                words.add(a.lower())
    return sorted(words), sentences, sorted(topics)


def mixed_format(spec, tier_rules):
    subs = {x.get('mode'): x for x in spec.get('format', {}).get('sub_items') or []}
    fib, ms, sa = subs.get('fill_in_blank', {}), subs.get('multi_select', {}), subs.get('short_answer', {})
    rng = tier_rules['multi_select_options']
    allowed = [n for n in (6, 8, 10) if (rng['min'] is None or n >= rng['min']) and (rng['max'] is None or n <= rng['max'])]
    return {
        'basis': 'data/exams/generation-spec/mixed.json format.sub_items（112–115 固定格式 47–50）；AI 題號 1–4、label 等於題號',
        'sub_items': [
            {'no': 1, 'mode': 'fill_in_blank', 'points': 2, 'answer_tokens': 1,
             'stem_zh': '與第 2 題共用同一個題幹：中文作答說明＋英文摘要句，空格寫 [[1]]、[[2]]（兩題的 stem 相同）'},
            {'no': 2, 'mode': 'fill_in_blank', 'points': 2, 'answer_tokens': 1, 'stem_zh': '同第 1 題'},
            {'no': 3, 'mode': 'multi_select', 'points': 4, 'options_allowed': allowed,
             'keys': [ms.get('keys', {}).get('min', 2), ms.get('keys', {}).get('max', 4)],
             'key_ratio': [ms.get('key_ratio', {}).get('min', 0.25), ms.get('key_ratio', {}).get('max', 0.5)],
             'answer': '選項代號陣列（依字母排序），例如 ["B", "E"]', 'scoring': ms.get('scoring')},
            {'no': 4, 'mode': 'short_answer', 'points': 2, 'answer_words': tier_rules['short_answer_words'],
             'answer_source': sa.get('answer_source')},
        ],
        'stem_instruction_phrases': fib.get('stem_instruction_phrases'),
        'tag_lines': {'fill_in_blank': fib.get('tag_line'), 'multi_select': ms.get('tag_line'), 'short_answer': sa.get('tag_line')},
        'accepted_answers_zh': '填充、簡答的 accepted_answers 是完整的可接受答案清單（含 answer 本身，至少 1 個）；'
                               '選字對、字形錯的寫法放解析的 partial_credit_forms（SPEC §4.6）',
    }


def build_reading_mixed(section, tier, seq):
    spec = json.loads((SPECS / f'{section}.json').read_text(encoding='utf-8'))
    tiers = tm.tiers_spec()
    st = spec['tiers'][SPEC_TIER_KEY[tier]]
    fmt = tiers['section_formats'][section]
    rules = tiers['item_rules'][section][tier]
    words, sentences, topics = recent_reading_mixed(section)
    n = RM_COUNTS[section]
    comp = spec.get('set_composition', {}).get(SET_COMPOSITION_RM[section])
    if isinstance(comp, dict) and SPEC_TIER_KEY[tier] in comp:
        comp = comp[SPEC_TIER_KEY[tier]]
    lot_id = f'{section}-{tier}-{seq}'
    reading = section == 'reading'
    lot = {
        'schema': 'gsat-bank-lot/v1',
        'lot': lot_id,
        'section_type': section,
        'tier': tier,
        'label_zh': f'{"閱讀測驗" if reading else "混合題"}‧{tiers["tier_labels"][tier]}（第 {int(seq)} 批）',
        'created_on': date.today().isoformat(),
        'count': n,
        'questions_per_group': fmt['questions'],
        'format_version': fmt['format_version'],
        'uid_prefix': f'ai.{tiers["bank_uid_codes"][section]}.',
        'path': f'data/bank/v1/{section}/{tier}/',
        'spec_id': f'{section}-{tier}@{spec.get("generated_on")}',
        'spec_file': f'data/exams/generation-spec/{section}.json',
        'spec_tier_key': SPEC_TIER_KEY[tier],
        'spec_status': spec.get('status'),
    }
    if reading:
        lot['form_quota'] = dict(READING_FORM_QUOTA) | {
            'basis': 'ROADMAP §9.2（閱讀每個難度 8 組：長文 4、圖表 2、表格 1、多文本 1）',
            'how_counted_zh': '依題組判定（validate_bank.reading_form）：figures 有 chart 物件＝chart；有 kind=table 的表格＝table；'
                              'passage_parts 兩篇以上＝multi_text；其他＝continuous（看文選圖的配圖不改變分類）。'
                              '圖表題與表格題也要有選文，所以 tags.text_format 依 v1.1 規則是 mixed',
            'note_zh': '出題規格書 passage_overrides.text_format_allowed 只列歷屆出現過的形式；圖表、表格、多文本是產品延伸'
                       '（05-reading.md §2.4，難度未校準），第一批依 ROADMAP 的配額出題',
            'chart_types': CHART_TYPES,
        }
    else:
        lot['form_quota'] = dict(MIXED_FORM_QUOTA) | {
            'basis': 'SPEC §6.7 文本輪替（雙文本、多則留言、清單）＋出題規格書 passage_overrides.structure',
            'structure_zh': (st.get('passage_overrides') or {}).get('structure'),
            'how_counted_zh': '依題組判定（validate_bank.mixed_form）：passage_parts 2 篇＝two_texts；3 則以上＝entries（留言、條目、清單）',
        }
        lot['format'] = mixed_format(spec, rules)
    lot['topic_quota'] = topic_quota(n) | {
        'labels_zh': dict(TOPIC_CATEGORIES),
        'basis': '08 §6.1（每 8 組：起源與演變 3、科普與健康 2–3、文化與歷史 2、社會與議題 1），依組數等比例取整；'
                 '取材一律從 SDGs 的具體事件或物件切入（SPEC §6.6）',
    }
    lot['sdg_quota'] = {
        'focus_sdgs': FOCUS_SDGS,
        'min_groups_with_focus_sdg': 1 if reading else 0,
        'min_share_with_any_sdg': 0.5,
        'tag': 'group.tags.sdgs（SDG 編號陣列）',
        'rule_zh': ('每批至少 1 篇 SDG 3／12／14／15 的具體事件切入（SPEC §5.2 步驟 1、ROADMAP §9.3）；' if reading else
                    '和閱讀共用 SDGs 取材（SPEC §6.7）；「至少 1 篇 SDG 3／12／14／15」是閱讀的規定，混合題不強制；')
                   + '一批中 ≥50% 的篇有 SDG（出題規格書 RD-SDG-01）；寫成具體事件或物件（例如「冰島如何利用整條鱈魚」），不寫成政策宣導',
    }
    lot['answer_letter_share'] = [0.2, 0.3] if reading else None
    if not reading:
        lot['multi_select_key_letter_share_max'] = 0.3
    lot['avoid'] = {
        'basis': f'data/exams/parsed 的 {"、".join(RECENT_EXAMS)} 同一大題（{section}）'
                 + ('的正解選項句（避免改寫成同義的正解）與主題' if reading else
                    '的填充、簡答答案（含可接受答案；單字取詞彙表主形，功能詞與 L1 字不列，片語整串列出）與主題'),
        'answer_words': words,
        'answer_sentences': sentences,
        'topics': topics,
    }
    lot['passage_band'] = passage_band_rm(section, tier, st)
    lot['item_rules'] = rules
    lot['targets'] = strip_rm(strip_observations({k: v for k, v in st.items() if k not in RM_OBSERVATIONAL}))
    lot['set_composition'] = comp
    lot['materials'] = {
        'derivation': 'ai-original-from-facts（SPEC §5.3：生成者只拿到事實單與難度規格，不提供來源原文）',
        'facts': 'data/bank/facts/{id}.json（README §8）；provenance.sources[].source_id 寫 fact:{id}，圖表資料用 role=dataset',
        'sources_whitelist': 'data/bank/sources-whitelist.json',
        'chart_format': 'data/bank/README.md §3.2（figure.chart：type、title、x、y、categories、series、note、source）',
        'chart_types': CHART_TYPES,
        'attribution_text': '本文由 AI 參考下列資料撰寫，非原文轉載',
    }
    lot['verification'] = {
        'blind_solvers': 2,
        'blind_b_different_model': True,
        'distractor_audit': True,
        'unique_solution': False,
        'human_review': '100%（校準期：每個題型 × 提示詞版本的前 30 組全審，SPEC §5.8）',
    }
    if not reading:
        lot['verification'] |= {
            'multi_select_agreement': 'SPEC §5.6：兩位盲解者對每個選項的判斷都和標準答案一致，沒有「可能也對」的選項',
            'open_answers_in_accepted': '填充、簡答：兩位盲解者的答案（含 also_plausible）都要在 accepted_answers 內（出題規格書 MIX-FIL-07）',
        }
    return lot


# ---------------------------------------------------------------------------
# 第 2 批起（seq ≥ 02）：主題總表、題庫已用的正解與干擾字、出題提醒
# 只加不改：上面的 build／build_reading_mixed 與不加新參數時的行為完全不變；validate_bank --lot 也用這裡的函式。
# ---------------------------------------------------------------------------

BANK_DIR = ROOT / 'data' / 'bank' / 'v1'
TOPIC_PLAN = ROOT / 'data' / 'bank' / 'topic-plan.json'
PLAN_SCHEMA = 'gsat-bank-topic-plan/v1'
ALL_SECTIONS = SECTIONS + RM_SECTIONS
WORD_ANSWER_SECTIONS = ('vocabulary', 'cloze', 'word_bank', 'mixed')   # 正解是單字或片語（混合題：填充、簡答）
SENTENCE_ANSWER_SECTIONS = ('structure', 'reading')                     # 正解是句子（篇章結構的句子、閱讀的正解選項）
DISTRACTOR_SECTIONS = ('vocabulary', 'cloze')                           # 第一批審查：干擾字在不同組重複（harvest、rumor、jealous…）
CATEGORY_KEYS = [k for k, _ in TOPIC_CATEGORIES]
PLAN_FORMS = {'reading': list(READING_FORM_QUOTA), 'mixed': list(MIXED_FORM_QUOTA)}
TOPIC_REQUIRED = ('slot', 'id', 'topic_zh', 'angle_en')
# 篇章結構的線索類型（解析的 clue_type／小題 tags.clue）歸成第一批審查意見列的 7 種；其他類型不計
CLUE_FAMILIES = {
    'pronoun_reference': 'pronoun',
    'lexical_cohesion': 'lexical', 'lexical_link': 'lexical', 'definition_restatement': 'lexical',
    'transition_word': 'connective', 'connective_logic': 'connective', 'cause_effect': 'connective',
    'chronology': 'time',
    'enumeration': 'enumeration', 'example': 'enumeration',
    'contrast': 'contrast',
    'topic_sentence': 'main_idea', 'summary': 'main_idea', 'elaboration': 'main_idea',
}
CLUE_FAMILY_LABELS = {'pronoun': '代名詞指涉', 'lexical': '詞彙重述', 'connective': '轉折／因果連接詞', 'time': '時間序',
                      'enumeration': '列舉（含舉例）', 'contrast': '對比', 'main_idea': '段落主旨推論'}
# 篇章結構的承上啟下句型（第一批審查：幾乎都是 All of this/these＋名詞、This＋名詞，下一句再用 One such…／The simplest… 接，
# 主題句那格後面多半是 for example）。檢查正解句的開頭與每格空格後第一句的開頭，同一 lot 內同一種最多 2 次。
_NOT_NOUN = r'(?!(?:is|was|are|were|has|had|have|means|meant|may|might|can|could|will|would|should|must|did|does|do)\b)'
BRIDGE_PATTERNS = [
    ('all_of_this', 'All/Both/Each of this/these/them…', re.compile(r'^(?:all|both|each|none|many|most) of (?:this|these|those|them)\b')),
    ('demonstrative_noun', 'This／These／Those／Such＋名詞 開頭', re.compile(r'^(?:this|these|those|such) ' + _NOT_NOUN + r'[a-z]+')),
    ('one_such', 'One such…', re.compile(r'^one such\b')),
    ('superlative_opener', 'The simplest／easiest／best／most…', re.compile(r'^the (?:simplest|easiest|best|most|biggest|greatest|main)\b')),
    ('for_example', 'For example／For instance 開頭', re.compile(r'^for (?:example|instance)\b')),
]
BRIDGE_MAX_PER_LOT = 2
STOPWORDS = {'a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'as', 'is', 'are', 'was',
             'were', 'be', 'it', 'its', 'how', 'why', 'what', 'when', 'where', 'who', 'that', 'this', 'their', 'they', 'we', 'our',
             'us', 'you', 'your', 'can', 'do', 'does', 'did', 's', 'into', 'than', 'about', 'up', 'out'}


def insert_after(d, after, key, value):
    """回傳新的 dict：key 放在 after 後面（after 不存在就放最後）；保持其他鍵的順序。"""
    out = {}
    for k, v in d.items():
        if k == key:
            continue
        out[k] = v
        if k == after:
            out[key] = value
    if key not in out:
        out[key] = value
    return out


def stem(w):
    if len(w) > 4 and w.endswith('ies'):
        return w[:-3] + 'y'
    if len(w) > 4 and w.endswith(('sses', 'ches', 'shes', 'xes')):
        return w[:-2]
    if len(w) > 3 and w.endswith('s') and not w.endswith(('ss', 'us', 'is')):
        return w[:-1]
    return w


@functools.lru_cache(maxsize=None)
def topic_words(text):
    """主題字串的實詞集合（去重音、轉小寫、連字號當空格、去功能詞、簡單去複數）；用來比對主題撞題。"""
    t = unicodedata.normalize('NFKD', str(text or ''))
    t = ''.join(c for c in t if not unicodedata.combining(c)).lower()
    return frozenset(stem(w) for w in re.findall(r'[a-z0-9]+', t) if w not in STOPWORDS)


def phrase_hits(phrases, text):
    """phrases 中「每個實詞都出現在 text」的片語（關鍵字比對：片語的字全部出現才算撞題）。"""
    words = topic_words(text)
    hits = []
    for ph in phrases or []:
        pw = topic_words(ph)
        if pw and pw <= words:
            hits.append(ph)
    return hits


def norm_topic(s):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', str(s or ''))).strip().lower()


def load_topic_plan(path=None):
    p = Path(path) if path else TOPIC_PLAN
    plan = json.loads(p.read_text(encoding='utf-8'))
    if plan.get('schema') != PLAN_SCHEMA:
        raise ValueError(f'{p} 的 schema 應為 {PLAN_SCHEMA}')
    return plan


def plan_lots(plan):
    """{lot_id: (lots[] 的那一筆, 依 slot 排序的主題)}。"""
    by_lot = {}
    for t in plan.get('topics') or []:
        by_lot.setdefault(t.get('lot'), []).append(t)
    return {e['lot']: (e, sorted(by_lot.get(e['lot'], []), key=lambda t: t.get('slot') or 0))
            for e in plan.get('lots') or []}


def bank_files(bank_dir=None):
    """data/bank/v1 的全部題組（含 draft、rejected）：[(path, data)]。"""
    d = Path(bank_dir) if bank_dir else BANK_DIR
    out = []
    for p in sorted(d.glob('*/*/*.json')) if d.exists() else []:
        try:
            out.append((p, json.loads(p.read_text(encoding='utf-8'))))
        except (OSError, ValueError):
            continue
    return out


def _plain(text):
    return tm.MARKUP_RE.sub('', text).strip() if isinstance(text, str) else None


def first_sentence(text):
    t = re.sub(r'\[\[\d+\]\]', '____', _plain(text) or '')
    m = re.match(r'(.+?[.!?])(?:\s|$)', t)
    return (m.group(1) if m else t)[:200]


def group_answers(d):
    """一個題組的正解：[(題號, 'word'|'sentence', 文字)]。混合題只取填充、簡答的 answer。"""
    st = d.get('section_type')
    g = d.get('group') or {}
    bank = g.get('options_bank') or {}
    out = []
    for q in g.get('questions') or []:
        ans = q.get('answer')
        if st == 'mixed':
            if q.get('mode') in ('fill_in_blank', 'short_answer') and isinstance(ans, str):
                out.append((q.get('no'), 'word', _plain(ans).rstrip('.')))
            continue
        pool = q.get('options') or bank
        text = _plain(pool.get(ans)) if isinstance(ans, str) and isinstance(pool, dict) else None
        if text:
            out.append((q.get('no'), 'sentence' if st in SENTENCE_ANSWER_SECTIONS else 'word', text))
    return out


def group_distractors(d):
    """詞彙題、綜合測驗的干擾選項：[(題號, 選項文字)]。"""
    out = []
    for q in (d.get('group') or {}).get('questions') or []:
        for k, v in (q.get('options') or {}).items():
            if k != q.get('answer') and isinstance(v, str):
                out.append((q.get('no'), _plain(v)))
    return out


def word_term(text, lex):
    """正解字／干擾字的比對形式：單字取詞彙表主形（功能詞與 L1 字回傳 None）；片語整串小寫。"""
    if not text:
        return None
    if len(text.split()) == 1:
        return lemma_of(text, lex)
    return text.lower()


def bank_answer_snapshot(banks, lex):
    """題庫（不含 rejected）各題型已用過的正解：{section: {'words': set, 'sentences': list, 'distractors': set, 'groups': n}}。"""
    snap = {s: {'words': set(), 'sentences': [], 'distractors': set(), 'groups': 0} for s in ALL_SECTIONS}
    for _, d in banks:
        st = d.get('section_type') if isinstance(d, dict) else None
        if st not in snap or d.get('status') == 'rejected':
            continue
        snap[st]['groups'] += 1
        for _, kind, text in group_answers(d):
            if kind == 'sentence':
                if text not in snap[st]['sentences']:
                    snap[st]['sentences'].append(text)
            else:
                term = word_term(text, lex)
                if term:
                    snap[st]['words'].add(term)
        if st == 'mixed':
            for q in (d.get('group') or {}).get('questions') or []:
                if q.get('mode') in ('fill_in_blank', 'short_answer'):
                    for a in q.get('accepted_answers') or []:
                        term = word_term(_plain(a).rstrip('.') if isinstance(a, str) else None, lex)
                        if term:
                            snap[st]['words'].add(term)
        if st in DISTRACTOR_SECTIONS:
            for _, text in group_distractors(d):
                term = word_term(text, lex)
                if term:
                    snap[st]['distractors'].add(term)
    return snap


def avoid_bank_answers(section, banks, lex=None):
    """批次規格的 avoid_bank_answers：data/bank/v1 現有題組（不含 rejected）已用過的正解字、正解句與干擾字。"""
    lex = lex or tm.lexicon()
    snap = bank_answer_snapshot(banks, lex)
    out = {
        'basis': 'data/bank/v1 現有題組（含 draft，不含 rejected）已用過的正解；單字取詞彙表主形（功能詞與 L1 字不列），片語整串列出。'
                 '用意是避免同一個字在題庫裡反覆當正解；這是產生本批規格當下的快照，validate_bank --lot 另外會比對當時的題庫',
        'scanned_on': date.today().isoformat(),
        'scanned_groups': {s: snap[s]['groups'] for s in ALL_SECTIONS},
    }
    if section in WORD_ANSWER_SECTIONS:
        same = snap[section]['words']
        other = set().union(*(snap[s]['words'] for s in WORD_ANSWER_SECTIONS if s != section)) - same
        out['answer_words'] = sorted(same)
        out['answer_words_other_sections'] = sorted(other)
        out['rule_zh'] = ('正解不可用 answer_words（同題型已用過；--lot：詞彙題、文意選填是 error，綜合測驗、混合題是 warning）；'
                          '也盡量避開 answer_words_other_sections（其他題型已用過；--lot 列 warning）')
    if section in SENTENCE_ANSWER_SECTIONS:
        out['answer_sentences'] = list(snap[section]['sentences'])
        out['rule_zh'] = '正解句不可和 answer_sentences 相同，也不要改寫成同義句（--lot：篇章結構相同是 error、閱讀是 warning）'
    if section in DISTRACTOR_SECTIONS:
        out['distractor_words'] = sorted(set().union(*(snap[s]['distractors'] for s in DISTRACTOR_SECTIONS)))
        out['distractor_rule_zh'] = ('干擾字避開 distractor_words（詞彙題、綜合測驗已用過的干擾字；--lot 列 warning）；'
                                     '同一 lot 內同一個干擾字（實詞取詞彙表主形、片語整串）只能出現在一組（--lot：重複是 error）')
    return out


def generation_notes(section, tier):
    """第一批（seq 01）審查意見轉成的出題提醒（2026-10-09 協調者轉達）；validate_bank --lot 依 checked_by 檢查。"""
    items = [{
        'id': 'GN-TOPIC',
        'rule_zh': 'group.tags.topic 一律逐字照抄 assigned_topics 該組的 topic_zh（繁體中文主題名）；angle_en 是英文切入角度，只給出題者參考。'
                   '每組只用自己的主題，不換題、不合併；主題不可行（例如找不到白名單內的事實來源）時先回報，不要自行換題',
        'checked_by': 'validate_bank --lot：tags.topic 對不到 topic_zh 列 warning；同一個主題被兩組用是 error；其他批次已用掉同一個主題列 warning',
    }, {
        'id': 'GN-AVOID',
        'rule_zh': '正解除了 avoid（近期學測）之外，也要避開 avoid_bank_answers（題庫已用過的正解字、正解句）',
        'checked_by': 'validate_bank --lot（嚴重度見 avoid_bank_answers.rule_zh）',
    }]
    if section in DISTRACTOR_SECTIONS:
        items.append({
            'id': 'GN-DISTRACTOR',
            'rule_zh': '第一批的干擾字在不同組重複（harvest、rumor、jealous…），學生會背到選項：干擾字避開 avoid_bank_answers.distractor_words，'
                       '同一 lot 內同一個干擾字只能出現在一組',
            'checked_by': 'validate_bank --lot：同一 lot 內重複是 error；和題庫已用干擾字重複是 warning',
        })
    if tier == 'basic':
        rule = {
            'vocabulary': '每組至少 2 題有一個干擾字「只看空格前後幾個字（搭配）說得通，要讀完整句才排除」',
            'cloze': '每組至少 2 格有一個干擾選項「只讀本句說得通，看上下文才排除」；解析的 option_notes_zh 寫明要靠哪一句排除',
            'word_bank': '每組至少 2 格有一個詞性相容的干擾字「只讀本句說得通，看上下文才排除」；解析的 option_notes_zh 寫明要靠哪一句排除',
            'structure': '每組至少 2 格有一個選項「只讀前一句說得通，看後一句才排除」（多餘句也算）；解析的 option_notes_zh 寫明要靠哪一句排除',
            'reading': '每組至少 2 題有一個干擾選項「和文中某一句字面相符、要讀前後文才排除」',
            'mixed': '多選題至少 2 個誤選選項「只看單一段落說得通、要對照其他段落或條件才排除」',
        }[section]
        items.append({
            'id': 'GN-BASIC-CONTEXT',
            'rule_zh': '第一批的穩定基礎普遍偏易（盲解者全部 high、每格只有正解可行）：basic 仍要有「只讀本句說得通、看上下文才排除」的誘答。' + rule,
            'checked_by': ('validate_bank --lot：verified 之後若 annotations.elimination.feasible 不只正解的格數 < 2，列 warning'
                           if section in ('word_bank', 'structure') else '人工審核（程式無法判斷）'),
        })
    if section == 'structure':
        items.append({
            'id': 'GN-STRUCTURE-CLUES',
            'rule_zh': '第一批篇章結構（進階最明顯）的承上啟下句幾乎都是「All of this/these＋名詞」或「This＋名詞」，下一句再用 One such…／The simplest… 接，'
                       '主題句那格後面多半是 for example，學生容易背套路。每組 4 格至少 3 種不同線索類型（'
                       + '、'.join(CLUE_FAMILY_LABELS.values()) + '），解析每格都要填 clue_type；'
                       f'同一 lot 內同一種承接句型最多出現 {BRIDGE_MAX_PER_LOT} 次',
            'clue_families': {fam: sorted(k for k, v in CLUE_FAMILIES.items() if v == fam) for fam in CLUE_FAMILY_LABELS},
            'bridge_patterns': {key: label for key, label, _ in BRIDGE_PATTERNS},
            'checked_by': 'validate_bank --lot：clue_type 歸類後少於 3 種是 error（有格沒填 clue_type 時列 warning）；'
                          f'同一種承接句型（正解句開頭與空格後第一句開頭）在 lot 內超過 {BRIDGE_MAX_PER_LOT} 次列 warning',
        })
    return {'basis': '第一批（seq 01）審查意見，2026-10-09 協調者轉達；第 2 批起每批都要遵守', 'items': items}


def clue_families_of(d):
    """篇章結構一組的線索類型：({題號: 類型或 None}, 沒填 clue_type 的題號)。"""
    items = (((d.get('annotations') or {}).get('explanations') or {}).get('items') or {})
    fam, missing = {}, []
    for q in (d.get('group') or {}).get('questions') or []:
        no = q.get('no')
        ct = (items.get(str(no)) or {}).get('clue_type') or (q.get('tags') or {}).get('clue')
        if not ct:
            missing.append(no)
        fam[no] = CLUE_FAMILIES.get(ct)
    return fam, missing


def bridge_openings(d):
    """篇章結構一組的承接句型：[(句型 key, 句子開頭)]，看正解句的開頭與每格空格後第一句的開頭。"""
    g = d.get('group') or {}
    bank = g.get('options_bank') or {}
    texts = [_plain(bank.get(q.get('answer'))) for q in g.get('questions') or [] if isinstance(q.get('answer'), str)]
    passage = _plain(g.get('passage')) or ''
    for m in re.finditer(r'\[\[\d+\]\]\s*', passage):
        texts.append(passage[m.end():m.end() + 80])
    out = []
    for t in texts:
        if not t:
            continue
        low = t.strip().lstrip('“"‘\'(').lower()
        for key, _, rx in BRIDGE_PATTERNS:
            if rx.match(low):
                out.append((key, t.strip()[:40]))
                break
    return out


def exam_topics():
    """data/exams/parsed 全部考卷的選文主題：[(exam_id, section, topic)]（詞彙、中譯英、作文不列）。"""
    out = []
    for p in sorted(PARSED.glob('*.json')):
        d = json.loads(p.read_text(encoding='utf-8'))
        for s in d.get('sections') or []:
            if s.get('type') in ('vocabulary', 'translation', 'composition'):
                continue
            for g in s.get('groups') or []:
                t = (g.get('tags') or {}).get('topic')
                if t:
                    out.append((p.stem, s['type'], t))
    return out


def used_topic_records(banks):
    """題庫已用主題（含 draft、rejected）：tags.topic、選文第一句、批次與狀態。"""
    out = []
    for p, d in banks:
        if not isinstance(d, dict):
            continue
        g = d.get('group') or {}
        parts = g.get('passage_parts') or []
        text = g.get('passage') or (parts[0].get('text') if parts and isinstance(parts[0], dict) else None)
        out.append({'uid': d.get('uid'), 'section': d.get('section_type'), 'tier': d.get('tier'),
                    'lot': (d.get('generation') or {}).get('lot'), 'status': d.get('status'),
                    'topic': (g.get('tags') or {}).get('topic'), 'first_sentence': first_sentence(text) if text else None})
    return out


def check_topic_plan(plan, banks=None, exams=None):
    """主題總表的檢查：(errors, warnings)。banks／exams 給了就另外比對已用主題（關鍵字片語全部出現才算撞題）。"""
    errors, warnings = [], []
    lots = plan_lots(plan)
    ids, zh_seen, en_seen = Counter(), {}, {}
    for t in plan.get('topics') or []:
        ids[t.get('id')] += 1
        if t.get('lot') not in lots:
            errors.append(f'主題 {t.get("id")} 的 lot {t.get("lot")} 不在 lots')
    for k, n in ids.items():
        if n > 1:
            errors.append(f'主題 id {k} 重複 {n} 次')
    for lot_id, (entry, topics) in lots.items():
        m = re.match(r'^(\w+)-(basic|advanced|top)-(\d{2})$', lot_id or '')
        if not m or m.group(1) not in ALL_SECTIONS or entry.get('section') != m.group(1) or entry.get('tier') != m.group(2):
            errors.append(f'{lot_id}：lot 名稱應為 {{section}}-{{tier}}-{{nn}}，且和 section／tier 一致')
            continue
        section = m.group(1)
        n = entry.get('count')
        if n != len(topics):
            errors.append(f'{lot_id}：count={n}，主題 {len(topics)} 個（每組一個）')
        if not isinstance(n, int) or not 1 <= n <= 6:
            errors.append(f'{lot_id}：每批 1–6 組（目前 {n}）')
        if [t.get('slot') for t in topics] != list(range(1, len(topics) + 1)):
            errors.append(f'{lot_id}：slot 應為 1–{len(topics)} 連續')
        for t in topics:
            miss = [k for k in TOPIC_REQUIRED if not t.get(k)]
            if miss:
                errors.append(f'{t.get("id")}：缺少 {miss}')
            if section != 'vocabulary' and t.get('category') not in CATEGORY_KEYS:
                errors.append(f'{t.get("id")}：category 應為 {CATEGORY_KEYS}')
            if section != 'vocabulary' and not t.get('keywords'):
                errors.append(f'{t.get("id")}：沒有 keywords（撞題比對用）')
            if section in RM_SECTIONS and t.get('form') not in PLAN_FORMS[section]:
                errors.append(f'{t.get("id")}：form 應為 {PLAN_FORMS[section]}')
            if section == 'vocabulary' and len(t.get('contexts_en') or []) < 5:
                errors.append(f'{t.get("id")}：詞彙題的 contexts_en 至少 5 種情境')
            for key, seen in (('topic_zh', zh_seen), ('angle_en', en_seen)):
                v = norm_topic(t.get(key))
                if v in seen:
                    errors.append(f'{t.get("id")} 與 {seen[v]} 的 {key} 相同')
                seen[v] = t.get('id')
        if section != 'vocabulary':
            want = topic_quota(n) if isinstance(n, int) else {}
            got = Counter(t.get('category') for t in topics)
            if any(got.get(k, 0) != want.get(k, 0) for k in CATEGORY_KEYS):
                errors.append(f'{lot_id}：主題配額 {dict(got)} 和 topic_quota({n}) {want} 不同')
        if section in RM_SECTIONS:
            sdgs = [set(t.get('sdgs') or []) for t in topics]
            if not any(s & set(FOCUS_SDGS) for s in sdgs):
                errors.append(f'{lot_id}：沒有 SDG 3／12／14／15 的主題（每批至少 1 篇）')
            if topics and sum(1 for s in sdgs if s) / len(topics) < 0.5:
                errors.append(f'{lot_id}：有 SDG 的主題 {sum(1 for s in sdgs if s)}/{len(topics)}，應 ≥50%')
    # 備用主題（reserve_topics：還沒分配批次；主題不可行或要加批次時從這裡取）也要和其他主題不重複
    for t in plan.get('reserve_topics') or []:
        ids[t.get('id')] += 1
        if ids[t.get('id')] > 1:
            errors.append(f'備用主題 id {t.get("id")} 重複')
        miss = [k for k in ('id', 'topic_zh', 'angle_en', 'category', 'keywords') if not t.get(k)]
        if miss:
            errors.append(f'備用主題 {t.get("id")}：缺少 {miss}')
        for key, seen in (('topic_zh', zh_seen), ('angle_en', en_seen)):
            v = norm_topic(t.get(key))
            if v in seen:
                errors.append(f'備用主題 {t.get("id")} 與 {seen[v]} 的 {key} 相同')
            seen[v] = t.get('id')
    # 主題總表內部：一個主題的關鍵字片語全部出現在另一個主題的英文角度或關鍵字裡，就算重複
    topics = [t for t in (plan.get('topics') or []) + (plan.get('reserve_topics') or []) if t.get('keywords')]
    for a in topics:
        for b in topics:
            if a is b:
                continue
            hit = phrase_hits(a['keywords'], ' '.join([b.get('angle_en') or ''] + list(b.get('keywords') or [])))
            if hit:
                errors.append(f'主題總表內重複：{a["id"]}（{a.get("topic_zh")}）的關鍵字 {hit} 出現在 {b["id"]}（{b.get("topic_zh")}）')
    reviewed = {(x.get('id'), norm_topic(x.get('against'))) for x in plan.get('reviewed_overlaps') or []}
    # 已用概念（題庫第一批的主題，人工整理成關鍵字）出現在新主題
    for c in plan.get('used_concepts') or []:
        for t in topics:
            hit = phrase_hits(c.get('keywords'), ' '.join([t.get('angle_en') or ''] + list(t.get('keywords') or [])))
            if hit and (t.get('id'), norm_topic(c.get('concept_zh'))) not in reviewed:
                errors.append(f'{t["id"]}（{t.get("topic_zh")}）碰到已用主題「{c.get("concept_zh")}」（關鍵字 {hit}）')
    # 新主題的關鍵字出現在題庫或歷屆試題的主題
    # （題庫裡 generation.lot 等於該主題 lot 的題組就是照這個主題出的，不算撞題）
    used = []
    for p, d in banks or []:
        topic = ((d.get('group') or {}).get('tags') or {}).get('topic') if isinstance(d, dict) else None
        if topic:
            used.append((f'題庫 {d.get("uid")}（{d.get("status")}）', topic, (d.get('generation') or {}).get('lot')))
    used += [(f'歷屆 {e}／{s}', t, None) for e, s, t in exams or []]
    for t in topics:
        for where, topic, lot in used:
            if lot is not None and lot == t.get('lot'):
                continue
            hit = phrase_hits(t['keywords'], topic)
            if hit and (t.get('id'), norm_topic(topic)) not in reviewed:
                errors.append(f'{t["id"]}（{t.get("topic_zh")}）和{where}的主題「{topic}」撞題（關鍵字 {hit}）')
            elif norm_topic(topic) in (norm_topic(t.get('topic_zh')), norm_topic(t.get('angle_en'))):
                errors.append(f'{t["id"]} 的主題已在{where}用過')
            elif zh_bigrams(topic) and (t.get('id'), norm_topic(topic)) not in reviewed:
                # 中文主題（第一批閱讀、混合題起 tags.topic 是中文，英文關鍵字比不到）：共用兩字實詞列 warning，人工確認後記進 reviewed_overlaps
                common = zh_bigrams(t.get('topic_zh')) & zh_bigrams(topic)
                if common:
                    warnings.append(f'{t["id"]}（{t.get("topic_zh")}）和{where}的中文主題「{topic}」共用「{"、".join(sorted(common))}」，'
                                    '請確認不是同一主題（確認後記進 reviewed_overlaps）')
    return errors, warnings


CJK_RUN = re.compile(r'[㐀-鿿]+')
# 中文主題比對時不算的字（虛詞、疑問詞）與兩字詞（題目常見的框架詞），避免「的演」「為什」這類假警報
ZH_FUNCTION_CHARS = set('的與和及或之其在是了為麼什怎如何從到會讓該不各個一每這那')
ZH_STOP_BIGRAMS = {'由來', '演變', '演進', '發明', '起源', '誕生', '歷史', '故事', '台灣', '臺灣', '世界', '文化', '秘密', '簡史',
                   '傳統', '變化', '傳播', '意外', '情境', '多元', '影響', '原因', '關係',
                   '日本', '中國', '美國', '英國', '韓國', '法國', '德國', '動物', '植物', '人類'}


@functools.lru_cache(maxsize=None)
def zh_bigrams(text):
    """中文主題的兩字實詞集合（連續漢字切成相鄰兩字，去掉含虛詞的與框架詞）；沒有漢字回傳空集合。"""
    out = set()
    for run in CJK_RUN.findall(str(text or '')):
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if not (set(bg) & ZH_FUNCTION_CHARS) and bg not in ZH_STOP_BIGRAMS:
                out.add(bg)
    return frozenset(out)


# 第一批規格檔的人工調整：(題型, 難度) → 欄位；第 2 批起沿用（inherit_seq01_adjustments）。
# 不能只用「已存的第一批規格檔 ≠ 現在重算的結果」判斷：第一批產生之後，出題規格書（data/exams/generation-spec/）
# 還有審查修正（origin/main #6 的定稿：詞彙 top、文意選填、綜合測驗 basic、閱讀的部分欄位），那種差異是規格書本身變了，
# 第 2 批起要照新的規格書，不能沿用第一批的舊值。之後再對第一批規格檔做人工調整時，記在這裡。
SEQ01_ADJUSTMENTS = {
    ('mixed', 'advanced'): ('passage_band',),   # 2026-10-09 放寬
    ('mixed', 'top'): ('passage_band',),        # 2026-10-09 放寬
}


def inherit_seq01_adjustments(lot):
    """第一批規格檔有人工調整（SEQ01_ADJUSTMENTS 列的欄位，且和 build(..., '01') 不同，例如混合題 2026-10-09 放寬的 passage_band）時，第 2 批起沿用。"""
    section, tier = lot['section_type'], lot['tier']
    path = LOTS / f'{section}-{tier}-01.json'
    if not path.exists():
        return lot
    stored = json.loads(path.read_text(encoding='utf-8'))
    fresh = build(section, tier, '01') if section in SECTIONS else build_reading_mixed(section, tier, '01')
    keys = [k for k in SEQ01_ADJUSTMENTS.get((section, tier), ())
            if k in stored and k in lot and stored.get(k) != fresh.get(k)]
    for k in keys:
        lot[k] = stored[k]
    if keys:
        lot['inherited_from_seq01'] = {
            'lot': stored['lot'], 'keys': keys,
            'note_zh': '第一批規格檔對這些欄位有人工調整（和程式算出的不同），第 2 批起沿用同一個決定',
        }
    return lot


def apply_topic_plan(lot, entry, topics, plan_file='data/bank/topic-plan.json'):
    """把主題總表的一批套進批次規格：count、topic_quota、form_quota、sdg_quota 重算，加上 assigned_topics、topic_plan。"""
    section = lot['section_type']
    n = len(topics)
    lot['count'] = n
    if section != 'vocabulary':
        q = lot.get('topic_quota') or {}
        lot['topic_quota'] = topic_quota(n) | {k: v for k, v in q.items() if k not in CATEGORY_KEYS}
        lot['topic_quota']['basis'] = (q.get('basis') or '') + f'；第 2 批起每組的主題見 assigned_topics（{plan_file}）'
    if section in RM_SECTIONS:
        forms = Counter(t['form'] for t in topics)
        fq = dict(lot['form_quota'])
        for k in PLAN_FORMS[section]:
            fq[k] = forms.get(k, 0)
        fq['basis'] = (f'{plan_file} 的分配（第 2 批起；連同第一批，每個難度的整體比例照 '
                       + ('ROADMAP §9.2 長文 4：圖表 2：表格 1：多文本 1' if section == 'reading' else '第一批的雙文本 1：多則短段落 1') + '）')
        lot['form_quota'] = {k: fq[k] for k in PLAN_FORMS[section]} | {k: v for k, v in fq.items() if k not in PLAN_FORMS[section]}
        sq = dict(lot['sdg_quota'])
        sq['min_groups_with_focus_sdg'] = max(1, sq.get('min_groups_with_focus_sdg') or 0)
        sq['rule_zh'] = ('第 2 批起閱讀與混合題每批都至少 1 篇 SDG 3／12／14／15 的具體事件切入（站主擴充題庫的要求；SPEC §5.2 原本只規定閱讀）；'
                         '一批中 ≥50% 的篇有 SDG（出題規格書 RD-SDG-01）；寫成具體事件或物件，不寫成政策宣導；'
                         'assigned_topics 的 sdgs 是指定的 SDG，group.tags.sdgs 要包含它')
        lot['sdg_quota'] = sq
    labels = dict(TOPIC_CATEGORIES)
    assigned = []
    for t in topics:
        a = {'slot': t['slot'], 'id': t['id']}
        if section != 'vocabulary':
            a['category'] = t['category']
            a['category_zh'] = labels[t['category']]
        a['domain_zh'] = t.get('domain_zh')
        a['topic_zh'] = t['topic_zh']
        a['angle_en'] = t['angle_en']
        if section == 'vocabulary':
            a['contexts_en'] = list(t.get('contexts_en') or [])
        else:
            a['keywords'] = list(t.get('keywords') or [])
        a['sdgs'] = list(t.get('sdgs') or [])
        if section in RM_SECTIONS:
            a['form'] = t['form']
            a['form_hint_zh'] = t.get('form_hint_zh')
        if t.get('note_zh'):
            a['note_zh'] = t['note_zh']
        assigned.append(a)
    lot = insert_after(lot, 'topic_quota', 'assigned_topics', assigned)
    lot = insert_after(lot, 'assigned_topics', 'topic_plan', {
        'file': plan_file,
        'rule_zh': ('每組一個指定主題（slot＝第幾組）：group.tags.topic 逐字照抄 topic_zh（繁體中文主題名）；angle_en 是英文切入角度；'
                    + ('詞彙題沒有選文：10 題的題幹情境照 contexts_en 分配（每種 1–3 題，仍要 ≥5 種）；'
                       if section == 'vocabulary' else 'keywords 是撞題比對用的英文關鍵字；')
                    + '主題總表的主題彼此不重複，也避開 data/bank/v1 第一批與歷屆試題用過的主題（make_lots.py --check-topics）'),
    })
    return lot


def build_lot(section, tier, seq, plan=None, banks=None, avoid_bank=False, plan_file='data/bank/topic-plan.json'):
    """第 2 批起的批次規格；plan 有給而主題總表沒有這一批時回傳 None。不給 plan 也不給 avoid_bank 時等於 build／build_reading_mixed。"""
    base = build(section, tier, seq) if section in SECTIONS else build_reading_mixed(section, tier, seq)
    if plan is None and not avoid_bank:
        return base
    lot = base
    if plan is not None:
        found = plan_lots(plan).get(base['lot'])
        if not found:
            return None
        entry, topics = found
        lot = apply_topic_plan(lot, entry, topics, plan_file)
        lot = inherit_seq01_adjustments(lot)
    if avoid_bank:
        lot = insert_after(lot, 'avoid', 'avoid_bank_answers', avoid_bank_answers(section, banks if banks is not None else bank_files()))
    if plan is not None:
        lot = insert_after(lot, 'avoid_bank_answers' if avoid_bank else 'avoid', 'generation_notes', generation_notes(section, tier))
    return lot


def parse_seqs(s):
    """'02'、'02,03'、'02-05' → ['02', ...]。"""
    out = []
    for part in str(s).split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1)
            out += [f'{i:02d}' for i in range(int(a), int(b) + 1)]
        else:
            out.append(f'{int(part):02d}')
    return out


def main(argv):
    ap = argparse.ArgumentParser(description='產生批次規格 data/bank/lots/*.json')
    ap.add_argument('--seq', default=None,
                    help='批號（兩位數；預設 01）。可寫逗號清單或範圍（02,03／02-05）；給了 --topics 而沒給 --seq 時＝主題總表裡的全部批次')
    ap.add_argument('--force', action='store_true', help='覆寫已存在的檔案')
    ap.add_argument('--dry-run', action='store_true', help='只印摘要')
    ap.add_argument('--sections', help=f'只產生這幾種題型（逗號分隔；預設全部：{",".join(SECTIONS + RM_SECTIONS)}）')
    ap.add_argument('--topics', type=Path, help='主題總表（data/bank/topic-plan.json）：組數與每組主題照它（第 2 批起）')
    ap.add_argument('--avoid-existing-bank', action='store_true',
                    help='另加 avoid_bank_answers：data/bank/v1 已用過的正解字、正解句與干擾字（第 2 批起）')
    ap.add_argument('--check-topics', action='store_true',
                    help='只檢查主題總表（配額、重複、和題庫與歷屆試題撞題），不寫檔；有問題結束碼 1')
    a = ap.parse_args(argv)
    if a.check_topics:
        return main_check_topics(a.topics)
    wanted = SECTIONS + RM_SECTIONS
    if a.sections:
        wanted = [x.strip() for x in a.sections.split(',') if x.strip()]
        bad = [x for x in wanted if x not in SECTIONS + RM_SECTIONS]
        if bad:
            ap.error(f'不認得的題型 {bad}')
    plan = load_topic_plan(a.topics) if a.topics else None
    plan_file = None
    if a.topics:
        try:
            plan_file = a.topics.resolve().relative_to(ROOT).as_posix()
        except ValueError:
            plan_file = str(a.topics)
    if a.seq is None:
        seqs = sorted({e['lot'].rsplit('-', 1)[1] for e in plan.get('lots') or []}) if plan else ['01']
    else:
        seqs = parse_seqs(a.seq)
    extended = plan is not None or a.avoid_existing_bank
    if extended and '01' in seqs:
        ap.error('第一批（seq 01）已開始生成，不能用 --topics／--avoid-existing-bank 重寫；請指定 02 以後的批號')
    banks = bank_files() if a.avoid_existing_bank else None
    LOTS.mkdir(parents=True, exist_ok=True)
    for seq in seqs:
        for section in [x for x in SECTIONS + RM_SECTIONS if x in wanted]:
            for tier in TIERS:
                if extended:
                    lot = build_lot(section, tier, seq, plan=plan, banks=banks, avoid_bank=a.avoid_existing_bank,
                                    plan_file=plan_file or 'data/bank/topic-plan.json')
                    if lot is None:
                        continue   # 主題總表沒有這一批
                else:
                    lot = build(section, tier, seq) if section in SECTIONS else build_reading_mixed(section, tier, seq)
                path = LOTS / f'{lot["lot"]}.json'
                summary = (f'{lot["lot"]}: {lot["count"]} 組 × {lot["questions_per_group"]} 題，避開 {len(lot["avoid"]["answer_words"])} 個正解字'
                           f'／{len(lot["avoid"]["answer_sentences"])} 句、{len(lot["avoid"]["topics"])} 個主題')
                if 'avoid_bank_answers' in lot:
                    ab = lot['avoid_bank_answers']
                    summary += (f'；題庫已用正解字 {len(ab.get("answer_words", []))}＋{len(ab.get("answer_words_other_sections", []))}'
                                f'、正解句 {len(ab.get("answer_sentences", []))}、干擾字 {len(ab.get("distractor_words", []))}')
                if 'assigned_topics' in lot:
                    summary += f'；指定主題 {len(lot["assigned_topics"])} 個'
                if a.dry_run:
                    print(summary)
                    continue
                if path.exists() and not a.force:
                    print(f'略過 {path.name}（已存在；批次規格開始生成後不再修改，要覆寫請加 --force）')
                    continue
                path.write_text(json.dumps(lot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                print('寫入 ' + summary)
    return 0


def main_check_topics(path):
    plan = load_topic_plan(path)
    errors, warnings = check_topic_plan(plan, banks=bank_files(), exams=exam_topics())
    lots = plan_lots(plan)
    print(f'主題總表 {path or TOPIC_PLAN}：{len(lots)} 批、{len(plan.get("topics") or [])} 個主題')
    for e in errors:
        print(f'  ERROR {e}')
    for w in warnings:
        print(f'  warn  {w}')
    print('OK' if not errors else f'{len(errors)} 個問題')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
