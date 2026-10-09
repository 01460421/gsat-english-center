#!/usr/bin/env python3
"""產生 AI 題庫的批次規格 data/bank/lots/{section}-{tier}-{nn}.json（SPEC §5.2 步驟 1、ROADMAP §9.2–9.3）。

用法：
    python3 tools/make_lots.py                 # 第一批：詞彙題、綜合測驗、文意選填、篇章結構 × 三種難度，共 12 個
    python3 tools/make_lots.py --seq 02        # 下一批（批號 02）
    python3 tools/make_lots.py --force         # 覆寫已存在的檔案（只在該批還沒開始生成時用）
    python3 tools/make_lots.py --dry-run       # 只印摘要，不寫檔

每個批次規格寫入：
    題型、難度、組數（ROADMAP §9.2：詞彙 5 組×10 題、綜合 8 組×5 格、文意選填 5 組、篇章結構 5 組）、
    主題配額（docs/research/08 §6.1：每 8 組「起源與演變 3、科普與健康 2–3、文化與歷史 2、社會與議題 1」，依組數等比例取整）、
    要避開的近期正解字與主題（data/exams/parsed 的 gsat-111～115 與 ref-115 同一大題的正解）、
    文章指標帶（SPEC §3.4 疊上出題規格書的 passage_overrides）、題目規則（SPEC §3.5，取自 data/specs/tiers.json）、
    目標考點與配比（出題規格書 data/exams/generation-spec/{section}.json 的 tiers 與 set_composition）、spec_id、uid 前綴。
批次規格一旦開始生成就不再修改（檔案裡的數字就是那一批的依據）；規格改了就開下一批。只用標準函式庫。
"""
import argparse
import json
import sys
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


def main(argv):
    ap = argparse.ArgumentParser(description='產生批次規格 data/bank/lots/*.json')
    ap.add_argument('--seq', default='01', help='批號（兩位數）')
    ap.add_argument('--force', action='store_true', help='覆寫已存在的檔案')
    ap.add_argument('--dry-run', action='store_true', help='只印摘要')
    a = ap.parse_args(argv)
    LOTS.mkdir(parents=True, exist_ok=True)
    for section in SECTIONS:
        for tier in TIERS:
            lot = build(section, tier, a.seq)
            path = LOTS / f'{lot["lot"]}.json'
            summary = (f'{lot["lot"]}: {lot["count"]} 組 × {lot["questions_per_group"]} 題，避開 {len(lot["avoid"]["answer_words"])} 個正解字'
                       f'／{len(lot["avoid"]["answer_sentences"])} 句、{len(lot["avoid"]["topics"])} 個主題')
            if a.dry_run:
                print(summary)
                continue
            if path.exists() and not a.force:
                print(f'略過 {path.name}（已存在；批次規格開始生成後不再修改，要覆寫請加 --force）')
                continue
            path.write_text(json.dumps(lot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print('寫入 ' + summary)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
