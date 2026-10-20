#!/usr/bin/env python3
"""產生中譯英、作文的批次規格（data/bank/lots/translation-*.json、composition-*.json）。

用法：
    python3 tools/make_writing_lots.py                      # 主題總表 data/bank/topic-plan-writing.json 的全部批次（已存在的檔案略過）
    python3 tools/make_writing_lots.py --sections translation --tiers basic
    python3 tools/make_writing_lots.py --dry-run            # 只印要產生的檔案與摘要
    python3 tools/make_writing_lots.py --force              # 覆寫已存在的檔案（批次規格開始生成後不要用）
    python3 tools/make_writing_lots.py --check-topics       # 檢查主題總表：配額、重複、與其他題型的主題總表、題庫、歷屆試題撞題

站主要求：中譯英每個難度 100 句（50 組×2 句，translation-{basic,advanced,top}-{01..05}，每批 10 組），
作文每個難度 15 題（composition-{basic,advanced,top}-01 各 10 題＋2026-10-20 擴充的 -02 各 5 題，每題附穩健版與頂標版範文；
擴充是為了讓自組模擬考每個難度至少可連續組 15 份全新卷）。作文批次的 count 取主題數，site_target 記開這一批時的站主要求
（COMPOSITION_TARGETS）；主題總表 lots[] 寫了 created_on 時，那一批的 created_on 用它（沒寫時照舊用總表的 created_on）。
補足批次（seq 06 起，主題總表 lots[] 標 "supplement": true）：01–05 批退件留下的缺口另開批次補，組數 1–10、
句型依題庫已通過題組的缺口分配（README §7.2）；主題總表沒有補足批次時，輸出與檢查結果和以前完全相同。
規格來源：SPEC §3.5（難度規則）、§5.2 步驟 1（批次規格）、§5.4、§5.7；出題規格書 data/exams/generation-spec/writing.json；
句型 data/curriculum/grammar-patterns.json；格式與驗證流程 data/bank/README.md §3.5–3.7、§5.5–5.6。
tools/make_lots.py（其他六種題型）另有工作線在改，這支只處理中譯英與作文，兩者寫出的檔案名稱不重疊。只用標準函式庫。
"""
import argparse
import functools
import json
import math
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOTS = ROOT / 'data' / 'bank' / 'lots'
BANK = ROOT / 'data' / 'bank' / 'v1'
PLAN = ROOT / 'data' / 'bank' / 'topic-plan-writing.json'
OTHER_PLAN = ROOT / 'data' / 'bank' / 'topic-plan.json'
SPEC = ROOT / 'data' / 'exams' / 'generation-spec' / 'writing.json'
TIERS_JSON = ROOT / 'data' / 'specs' / 'tiers.json'
GRAMMAR = ROOT / 'data' / 'curriculum' / 'grammar-patterns.json'
PARSED = ROOT / 'data' / 'exams' / 'parsed'

PLAN_SCHEMA = 'gsat-bank-topic-plan-writing/v1'
LOT_SCHEMA = 'gsat-bank-lot/v1'
TIERS = ('basic', 'advanced', 'top')
SECTIONS = ('translation', 'composition')
SPEC_KEY = {'basic': 'foundation', 'advanced': 'advanced', 'top': 'beyond_top'}
TIER_LABELS = {'basic': '穩定基礎', 'advanced': '進階練習', 'top': '超越頂標'}
SECTION_LABELS = {'translation': '中譯英', 'composition': '英文作文'}
UID_CODES = {'translation': 'tr', 'composition': 'cp'}
FORMATS = {'translation': ('translation-2', 2), 'composition': ('composition-1', 1)}
RECENT_EXAMS = ('gsat-111', 'gsat-112', 'gsat-113', 'gsat-114', 'gsat-115', 'ref-110', 'ref-111', 'ref-115')
TOPIC_REQUIRED = ('id', 'lot', 'slot', 'domain_zh', 'topic_zh', 'angle_en', 'keywords')
COMPOSITION_REQUIRED = ('prompt_type', 'essay_type', 'figures_hint_zh', 'moves')
# 作文的站主要求（每個難度的題數）：(開始適用的批號, site_target)。批次規格記下開這一批時的要求，所以已存在的 01 批規格逐位元組不變。
# 2026-10-20 站主要求擴充題庫：自組模擬考每份卷 1 題作文，每個難度至少可連續組 15 份全新卷 → 每個難度 15 題（02 批 5 題）。
COMPOSITION_TARGETS = (
    (1, {'items_per_tier': 10, 'lots_per_tier': 1,
         'basis_zh': '站主要求作文每個難度 10 題（每題附穩健版與頂標版範文）；ROADMAP §9.2 原訂每個難度 4 題，依站主要求放大'}),
    (2, {'items_per_tier': 15, 'lots_per_tier': 2,
         'basis_zh': '站主要求擴充題庫：自組模擬考每個難度至少可連續組 15 份全新卷（每份卷 1 題作文），作文每個難度 15 題'
                     '（第 1 批 10 題＋第 2 批 5 題，每題附穩健版與頂標版範文）'}),
)
# 每個難度的組數（--check-topics 比對；補足批次另計）：中譯英 50 組（100 句），作文取 COMPOSITION_TARGETS 最新的要求
SITE_GROUPS = {'translation': 50, 'composition': COMPOSITION_TARGETS[-1][1]['items_per_tier']}


def composition_site_target(seq):
    """開這一批（批號 seq）時，作文每個難度的站主要求。"""
    return dict(next(t for start, t in reversed(COMPOSITION_TARGETS) if int(seq) >= start))

# 句型配置（README §3.5；SPEC §3.5、出題規格書 tiers.*.translation.structure_pool）。
# 每批 20 句：穩定基礎每句 1 個句構、進階 2 個、超越頂標 2 個（一組至少 1 個指定句型）。
# 數量依歷屆 119 句的句構次數（writing.json question_type_mix.translation_structures_all_119）等比例分配。
BASIC_SLOTS = [('PERF', 3), ('COMP', 3), ('PARA', 2), ('ADVCL', 2), ('PASS', 2),
               ('REL', 2), ('PURP', 2), ('PREPVING', 2), ('NFSUBJ', 2)]
# 進階另外放 VOC（gp-v-o-to-v 等，歷屆 12 句）與 BASIC（should、no longer、used to 這類高頻句型）各 2 個，
# 讓 grammar-patterns.json 裡歷屆出現 ≥4 次的句型都有題目練到
ADVANCED_SLOTS = [('PERF', 3), ('COMP', 3), ('PARA', 3), ('ADVCL', 3), ('PASS', 4), ('NCL', 4), ('REL', 3), ('PART', 3),
                  ('PURP', 3), ('NFSUBJ', 3), ('PREPVING', 2), ('VOC', 2), ('BASIC', 2), ('CORR', 1), ('PROG', 1)]
# 超越頂標的指定句型（SPEC §3.5：非限定關係子句、句尾分詞表結果、no matter＋wh-、what 子句；出題規格書另含 whether 子句）
TOP_AST = [('NRREL', 'gp-nonrestrictive', 4), ('PART', 'gp-participle-result', 4), ('NCL', 'gp-what-clause', 2),
           ('NCL', 'gp-wh-clause', 2), ('ADVCL', 'gp-no-matter', 2)]
TOP_OTHERS = [('REL', 6), ('PASS', 6), ('NFSUBJ', 5), ('COMP', 5), ('PART', 4)]
TOP_AST_IDS = {g for _, g, _ in TOP_AST}
GRAMMAR_BY_CODE = {
    'basic': {'PERF': ['gp-present-perfect'], 'COMP': ['gp-comparative-superlative', 'gp-more-and-more', 'gp-as-as'],
              'PARA': ['gp-parallelism'], 'ADVCL': ['gp-time-clause', 'gp-condition-real'], 'PASS': ['gp-passive'],
              'REL': ['gp-relative-pronoun', 'gp-relative-adverb'], 'PURP': ['gp-infinitive-purpose', 'gp-so-that-purpose'],
              'PREPVING': ['gp-prep-gerund'], 'NFSUBJ': ['gp-gerund-subject', 'gp-it-adj-to']},
    'advanced': {'PERF': ['gp-present-perfect', 'gp-present-perfect-progressive'],
                 'COMP': ['gp-comparative-superlative', 'gp-more-and-more', 'gp-the-more', 'gp-compared-with'],
                 'PARA': ['gp-parallelism'], 'ADVCL': ['gp-time-clause', 'gp-condition-real', 'gp-concession-clause', 'gp-so-such-that'],
                 'PASS': ['gp-passive', 'gp-perfect-passive'], 'NCL': ['gp-that-clause', 'gp-wh-clause', 'gp-wh-to'],
                 'REL': ['gp-relative-pronoun', 'gp-relative-adverb', 'gp-for-those-who'],
                 'PART': ['gp-participle-clause', 'gp-participle-modifier', 'gp-conj-participle'],
                 'PURP': ['gp-infinitive-purpose', 'gp-so-that-purpose'], 'NFSUBJ': ['gp-gerund-subject', 'gp-it-adj-to'],
                 'PREPVING': ['gp-prep-gerund'], 'CORR': ['gp-not-only-but-also', 'gp-not-but'], 'PROG': ['gp-progressive-trend'],
                 'VOC': ['gp-v-o-to-v', 'gp-svoc', 'gp-regard-as'], 'BASIC': ['gp-should-advice', 'gp-no-longer', 'gp-used-to', 'gp-compound-adj']},
    'top': {'REL': ['gp-relative-pronoun', 'gp-relative-adverb', 'gp-for-those-who'], 'PASS': ['gp-passive', 'gp-perfect-passive'],
            'NFSUBJ': ['gp-gerund-subject', 'gp-it-adj-to'],
            'COMP': ['gp-comparative-superlative', 'gp-the-more', 'gp-compared-with', 'gp-times'],
            'PART': ['gp-participle-modifier', 'gp-participle-clause', 'gp-conj-participle']},
}
RESTRUCTURE_CODES = ('NFSUBJ', 'PASS', 'PREPVING', 'REL')

# 作文評分規準的範本（本站自己的文字；validate_bank.py 會檢查不重製評分原則原文）。出題者照抄 bands，另寫每題的 focus_zh。
RUBRIC_TEMPLATE = {
    'criteria': {
        'content': [
            (4, 5, '回應題目的每一項要求，主旨明確；用具體的事例、細節或親身經驗撐起每個重點。'),
            (3, 3, '大致回應題目，但有一項要求寫得單薄，或細節偏籠統、說服力不足。'),
            (1, 2, '漏掉題目的主要要求或主旨模糊，多數句子空泛、重複或偏離題目。'),
            (0, 0, '空白、離題、只抄題目，或內容少到無法判斷要說什麼。'),
        ],
        'organization': [
            (4, 5, '兩段分工清楚，各有主題句；句與句、段與段的銜接自然，轉承語用得恰當，篇幅分配合理。'),
            (3, 3, '段落大致分明，但有的地方跳接或重複，轉承語偏少或用得生硬。'),
            (1, 2, '重點排列混亂，前後句常接不起來，讀者不容易跟上。'),
            (0, 0, '看不出段落與順序，句子彼此無關。'),
        ],
        'grammar': [
            (4, 5, '句子幾乎沒有文法、標點錯誤，能交替使用簡單句、複句與不同的句首。'),
            (3, 3, '偶有時態、單複數或標點錯誤，但讀得懂意思；句型變化有限。'),
            (1, 2, '錯誤多到常讓人誤解意思，句子結構常不完整。'),
            (0, 0, '幾乎沒有正確的句子，無法理解。'),
        ],
        'vocabulary': [
            (4, 5, '用字精準、貼切，搭配自然，少有重複；拼字與大小寫幾乎全對。'),
            (3, 3, '字彙範圍偏窄、常重複同幾個字，偶有用字不當或拼錯，但不妨礙理解。'),
            (1, 2, '用錯字或拼錯字很多，常讓人看不懂。'),
            (0, 0, '幾乎每個字都用錯或拼錯，無法理解。'),
        ],
    },
    'deductions_zh': '字數明顯不足（少於 100 個單詞）或沒有分成兩段，各扣總分 1 分；兩種情形同時發生只扣 1 分。離題或空白以 0 分計。',
}
SCAFFOLD_RULES = {
    'basic': {'kind': 'outline+sentence_starters', 'required': True,
              'rule_zh': '提供構思圖（5W1H：什麼時候、在哪裡、誰、發生什麼、你的感受、後來呢，branches ≥4）、兩段大綱（每段主題句＋2–3 個細節）'
                         '與每段 2–3 個英文句型開頭（SPEC §3.5、§6.9 步驟 1–2）'},
    'advanced': {'kind': 'outline', 'required': False,
                 'rule_zh': '只給兩段大綱，不給句型開頭（SPEC §3.5）；也可以是 null'},
    'top': {'kind': 'checklist', 'required': False,
            'rule_zh': '只給規劃檢核表（≥3 條，例如「第一段有沒有讀出 2–3 個明確對比」）；不給句型開頭；也可以是 null'},
}


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


@functools.lru_cache(maxsize=None)
def _phrase_re(phrase):
    """phrase_in 用的正規式（快取：兩份主題總表的關鍵字超過 re 模組內建快取的 512 個，每次重編會讓 --check-topics 慢好幾倍）。"""
    p = re.escape(phrase.lower().strip()).replace(r'\ ', r'\s+')
    return re.compile(rf'(?<![a-z0-9]){p}(?:s|es)?(?![a-z0-9])') if p else None


def phrase_in(phrase, text):
    """phrase 以完整字詞出現在 text（不分大小寫；允許 -s／-es 複數）。"""
    rx = _phrase_re(phrase)
    return rx is not None and rx.search(text.lower()) is not None


def topic_text(t):
    return ' '.join([t.get('angle_en') or ''] + list(t.get('keywords') or []))


def collides(a_kws, a_text, b_kws, b_text):
    """兩個主題撞題：任一方的關鍵字出現在另一方的切入角度或關鍵字。回傳撞到的字或 None。"""
    for k in a_kws:
        if phrase_in(k, b_text):
            return k
    for k in b_kws:
        if phrase_in(k, a_text):
            return k
    return None


def exam_topics():
    """歷屆試題中譯英、作文的主題（tags.topic）：[(exam_id, section_type, topic)]。"""
    out = []
    for p in sorted(PARSED.glob('*.json')) if PARSED.exists() else []:
        try:
            d = load(p)
        except Exception:  # noqa: BLE001
            continue
        for s in d.get('sections') or []:
            if s.get('type') not in SECTIONS:
                continue
            for g in s.get('groups') or []:
                ts = {((g.get('tags') or {}).get('topic'))} | {((q.get('tags') or {}).get('topic')) for q in g.get('questions') or []}
                for t in ts - {None}:
                    out.append((d.get('id') or p.stem, s.get('type'), t))
    return out


def bank_topics():
    out = []
    for p in sorted(BANK.glob('*/*/*.json')) if BANK.exists() else []:
        try:
            d = load(p)
        except Exception:  # noqa: BLE001
            continue
        t = ((d.get('group') or {}).get('tags') or {}).get('topic')
        if isinstance(t, str):
            run_id = (d.get('generation') or {}).get('run_id') or ''
            out.append((d.get('uid'), t, run_id))
    return out


def generated_from(run_id, lot):
    """題組的 generation.run_id（agent-YYYY-MM-DD-{lot}，退件重出的是 …-{lot}-regen）是否表示它就是依這個批次出的題。"""
    if not lot or not run_id:
        return False
    base = run_id[: -len('-regen')] if run_id.endswith('-regen') else run_id
    return base == lot or base.endswith('-' + lot)


def check_topics(plan):
    """主題總表的檢查。回傳 (errors, warnings)。"""
    errs, warns = [], []
    if plan.get('schema') != PLAN_SCHEMA:
        errs.append(f'schema 應為 {PLAN_SCHEMA}')
    topics = [t for t in plan.get('topics') or [] if isinstance(t, dict)]
    lots = {x.get('lot'): x for x in plan.get('lots') or [] if isinstance(x, dict)}
    by_lot = {}
    for t in topics:
        miss = [k for k in TOPIC_REQUIRED if not t.get(k)]
        if t.get('lot', '').startswith('composition-'):
            miss += [k for k in COMPOSITION_REQUIRED if not t.get(k)]
        if miss:
            errs.append(f'{t.get("id")}: 缺少 {miss}')
        by_lot.setdefault(t.get('lot'), []).append(t)
    for lot, x in lots.items():
        slots = sorted(t.get('slot') for t in by_lot.get(lot, []))
        if slots != list(range(1, (x.get('count') or 0) + 1)):
            errs.append(f'{lot}: 主題的 slot {slots} 應為 1–{x.get("count")}')
    for lot in sorted(set(by_lot) - set(lots), key=str):
        errs.append(f'{lot}: 不在 lots 清單')
    # 站主要求的數量：中譯英每個難度 50 組（100 句）、作文每個難度 15 題（SITE_GROUPS；補足批次另計，見 check_supplements）
    for sec, want in SITE_GROUPS.items():
        for tier in TIERS:
            n = sum(x.get('count') or 0 for x in lots.values() if x.get('section') == sec and x.get('tier') == tier
                    and not is_supplement(x))
            if n != want:
                errs.append(f'{sec}-{tier}: 共 {n} 組，站主要求 {want} 組')
    # 總表內不重複
    names = Counter(t.get('topic_zh') for t in topics)
    for name, n in names.items():
        if n > 1:
            errs.append(f'主題「{name}」重複 {n} 次')
    ids = Counter(t.get('id') for t in topics)
    errs += [f'id {i} 重複' for i, n in ids.items() if n > 1]
    for i, a in enumerate(topics):
        for b in topics[i + 1:]:
            hit = collides(a.get('keywords') or [], topic_text(a), b.get('keywords') or [], topic_text(b))
            if hit:
                errs.append(f'{a.get("id")}「{a.get("topic_zh")}」和 {b.get("id")}「{b.get("topic_zh")}」撞題（{hit}）')
    # 其他題型的主題總表（含 used_concepts）
    if OTHER_PLAN.exists():
        other = load(OTHER_PLAN)
        others = [(o.get('id'), o.get('topic_zh'), o.get('keywords') or [], topic_text(o)) for o in other.get('topics') or []]
        others += [('used', c.get('concept_zh'), c.get('keywords') or [], ' '.join(c.get('keywords') or []))
                   for c in other.get('used_concepts') or []]
        for t in topics:
            for oid, oname, okws, otext in others:
                hit = collides(t.get('keywords') or [], topic_text(t), okws, otext)
                if hit:
                    errs.append(f'{t.get("id")}「{t.get("topic_zh")}」和 topic-plan.json {oid}「{oname}」撞題（{hit}）')
                elif t.get('topic_zh') == oname:
                    errs.append(f'{t.get("id")}「{t.get("topic_zh")}」和 topic-plan.json {oid} 同名')
    # 題庫已用過的主題
    # 依本總表的某個主題出好的題組（run_id 指向該主題的批次）就是這個主題本身，不算撞題。
    for uid, bt, run_id in bank_topics():
        for t in topics:
            if generated_from(run_id, t.get('lot')):
                continue
            if t.get('topic_zh') == bt or any(phrase_in(k, bt) for k in t.get('keywords') or []):
                errs.append(f'{t.get("id")}「{t.get("topic_zh")}」和題庫 {uid} 的主題「{bt}」撞題')
    # 歷屆中譯英、作文的主題（近期是 error，其他 warning）
    for eid, sec, et in exam_topics():
        for t in topics:
            hit = next((k for k in t.get('keywords') or [] if phrase_in(k, et)), None)
            if hit:
                msg = f'{t.get("id")}「{t.get("topic_zh")}」和歷屆 {eid} {SECTION_LABELS[sec]}的主題「{et}」撞題（{hit}）'
                (errs if eid in RECENT_EXAMS else warns).append(msg)
    # 補足批次（沒有補足批次、也沒有 supplement 說明時不做任何事，結果和以前相同）
    e2, w2 = check_supplements(plan, topics, lots)
    return errs + e2, warns + w2


def recent_avoid(section):
    """近期學測（111–115）與參考試卷同一大題的題目與主題：中譯英列中文題目，作文列主題與第二段任務。"""
    stems, topics = [], []
    for eid in RECENT_EXAMS:
        p = PARSED / f'{eid}.json'
        if not p.exists():
            continue
        d = load(p)
        for s in d.get('sections') or []:
            if s.get('type') != section:
                continue
            for g in s.get('groups') or []:
                t = (g.get('tags') or {}).get('topic')
                if t:
                    topics.append(f'{eid}：{t}')
                for q in g.get('questions') or []:
                    if section == 'translation' and q.get('stem'):
                        stems.append(f'{eid} {q.get("label")}：{q["stem"]}')
    return stems, sorted(set(topics))


def grammar_db():
    d = load(GRAMMAR)
    return {p['id']: p for p in d.get('patterns') or [] if isinstance(p, dict) and p.get('id')}


def pattern_entry(code, gid, gp):
    p = gp.get(gid) or {}
    return {'code': code, 'grammar_id': gid, 'label_zh': p.get('name_zh'), 'frame': p.get('pattern')}


def rotate(xs, k):
    k %= len(xs) or 1
    return xs[k:] + xs[:k]


def expand(slots):
    return [c for c, n in slots for _ in range(n)]


def pattern_plan(tier, seq, gp, counter):
    """一批 10 組的句型配置：[{slot, sentences: [{no, patterns: [...]}, …]}]。counter 讓同一難度各批輪流用不同的句型 id。"""

    def gid_for(code):
        ids = GRAMMAR_BY_CODE[tier][code]
        gid = ids[counter[code] % len(ids)]
        counter[code] += 1
        return gid

    plan = []
    if tier == 'basic':
        codes = expand(BASIC_SLOTS)
        first, second = rotate(codes[:10], seq), rotate(codes[10:], 2 * seq)
        for k in range(10):
            a, b = (first[k], second[k]) if k % 2 == 0 else (second[k], first[k])
            plan.append({'slot': k + 1, 'sentences': [
                {'no': 1, 'patterns': [pattern_entry(a, gid_for(a), gp)]},
                {'no': 2, 'patterns': [pattern_entry(b, gid_for(b), gp)]}]})
    elif tier == 'advanced':
        codes = rotate(expand(ADVANCED_SLOTS), seq * 7)
        pairs = [(codes[i], codes[i + 20]) for i in range(20)]
        for k in range(10):
            sents = []
            for j, (a, b) in enumerate(pairs[2 * k:2 * k + 2]):
                sents.append({'no': j + 1, 'patterns': [pattern_entry(a, gid_for(a), gp), pattern_entry(b, gid_for(b), gp)]})
            plan.append({'slot': k + 1, 'sentences': sents})
    else:
        ast = rotate([(c, g) for c, g, n in TOP_AST for _ in range(n)], seq * 3)
        others = rotate(expand(TOP_OTHERS), seq * 5)

        def take(avoid):
            for i, c in enumerate(others):
                if c not in avoid:
                    return others.pop(i)
            return others.pop(0)

        for k in range(10):
            c1, g1 = ast[k]
            o1 = take({c1})
            s1 = [pattern_entry(c1, g1, gp), pattern_entry(o1, gid_for(o1), gp)]
            if k < 4:
                c2, g2 = ast[10 + k]
                o2 = take({c2})
                s2 = [pattern_entry(c2, g2, gp), pattern_entry(o2, gid_for(o2), gp)]
            else:
                a = take(set())
                b = take({a})
                s2 = [pattern_entry(a, gid_for(a), gp), pattern_entry(b, gid_for(b), gp)]
            sents = [{'no': 1, 'patterns': s1}, {'no': 2, 'patterns': s2}]
            if k % 2:   # 指定句型不一定都在第 1 句
                sents = [{'no': 1, 'patterns': s2}, {'no': 2, 'patterns': s1}]
            plan.append({'slot': k + 1, 'sentences': sents})
        # 修正：同一句不可有兩個相同的句構代碼（剩下的句型都是同一種時會發生）——和別句的第二個句型對調
        allsents = [s for p in plan for s in p['sentences']]
        for s in allsents:
            codes = [x['code'] for x in s['patterns']]
            if len(set(codes)) == len(codes):
                continue
            for t in allsents:
                if t is s:
                    continue
                cand = t['patterns'][-1]
                if cand['code'] not in codes and s['patterns'][-1]['code'] not in [x['code'] for x in t['patterns'][:-1]] \
                        and cand['grammar_id'] not in TOP_AST_IDS:
                    s['patterns'][-1], t['patterns'][-1] = cand, s['patterns'][-1]
                    break
    for p in plan:
        codes = [x['code'] for s in p['sentences'] for x in s['patterns']]
        p['restructuring_hint'] = tier != 'basic' and any(c in RESTRUCTURE_CODES for c in codes)
    return plan


def base_lot(section, tier, seq, spec, created):
    fmt, per = FORMATS[section]
    lot = f'{section}-{tier}-{seq}'
    return {
        'schema': LOT_SCHEMA,
        'lot': lot,
        'section_type': section,
        'tier': tier,
        'label_zh': f'{SECTION_LABELS[section]}‧{TIER_LABELS[tier]}（第 {int(seq)} 批）',
        'created_on': created,
        'count': 10,
        'questions_per_group': per,
        'format_version': fmt,
        'uid_prefix': f'ai.{UID_CODES[section]}.',
        'path': f'data/bank/v1/{section}/{tier}/',
        'spec_id': f'{section}-{tier}@{spec.get("generated_on")}',
        'spec_file': 'data/exams/generation-spec/writing.json',
        'spec_tier_key': SPEC_KEY[tier],
        'spec_status': spec.get('status'),
    }


def translation_lot(tier, seq, topics, spec, tiers, gp, counter, created):
    t = (spec.get('tiers') or {}).get(SPEC_KEY[tier]) or {}
    tr = t.get('translation') or {}
    lot = base_lot('translation', tier, seq, spec, created)
    stems, recent_topics = recent_avoid('translation')
    plan = pattern_plan(tier, int(seq), gp, counter)
    lot.update({
        'site_target': {'groups_per_tier': 50, 'sentences_per_tier': 100, 'lots_per_tier': 5,
                        'basis_zh': '站主要求中譯英每個難度 100 句（50 組×2 句）；ROADMAP §9.2 原訂每個難度 10 組，依站主要求放大'},
        'topics': [{k: x[k] for k in ('slot', 'id', 'domain_zh', 'topic_zh', 'angle_en', 'keywords')} for x in topics],
        'topic_rule_zh': 'group.tags.topic 逐字照抄 topic_zh；兩句同一主題，第二句用代名詞、轉折詞或同一關鍵詞延續第一句（出題規格書 WRT-TRN-FMT-02）。'
                         '主題來自 data/bank/topic-plan-writing.json（已避開其他題型的主題總表、題庫與歷屆試題的主題）',
        'pattern_plan': plan,
        'pattern_rule_zh': '每組照 pattern_plan 的句型出題：patterns[].code、grammar_id 照抄，label_zh、frame 可改寫得更貼近題目，'
                           'zh_trigger 寫中文題目裡引出句型的字串。同一組兩句的句型可以對調；整批要涵蓋 pattern_coverage 的全部句型'
                           '（validate_bank.py --lot 在整批齊了以後檢查）。倒裝、假設、強調句不可當標的句型，只放 bonus（加分寫法）',
        'pattern_coverage': {
            'required_grammar_ids': sorted({x['grammar_id'] for p in plan for s in p['sentences'] for x in s['patterns']}),
            'counts': dict(sorted(Counter(x['code'] for p in plan for s in p['sentences'] for x in s['patterns']).items())),
            'basis_zh': '依歷屆 119 句的句構次數（writing.json question_type_mix.translation_structures_all_119）等比例分配到每批 20 句；'
                        '句型 id 取自 grammar-patterns.json，同一難度各批輪流用同一句構的不同句型',
        },
        'avoid': {
            'basis': 'data/exams/parsed 的 ' + '、'.join(RECENT_EXAMS) + ' 中譯英題目與主題',
            'zh_stems': stems,
            'topics': recent_topics,
            'rule_zh': '不改寫歷屆題：中文題目和任何歷屆中譯英題目有連續 10 個以上相同漢字是 error、8–9 個是 warning；'
                       '參考譯文不可和歷屆官方參考譯文有 8 字以上相同字串（D8，validate_bank.py）',
        },
        'item_rules': tiers['item_rules']['translation'][tier],
        'targets': {k: v for k, v in tr.items() if k not in ('g50_reference_years', 'reference_score_rate')},
        'design': {k: t.get(k) for k in ('distractor_rules', 'recipe', 'common_errors') if t.get(k)},
        'format': {
            'readme': 'data/bank/README.md §3.5',
            'sample': 'tools/tests/data/ai.tr.0b1c2d@1.json',
            'group_zh': '2 題 mode=translation、label "1"／"2"、各 4 分；stem 是中文題目（表外專有名詞在括號附英文）；answer＝本站首選參考譯文，'
                        'accepted_answers＝其他參考譯文（或 null）；figures []、passage null；tags.topic 必填',
            'annotations_zh': 'explanations（每句 explanation_zh＋引用中文題目的 evidence，hints 依序是語意切分、標的詞彙、句型框架）；'
                              'rubric = {kind: "translation", items: {題號: {references ≥2（超越頂標建議 ≥3）、target_words、patterns、'
                              'parts（剛好 4 個：zh、accepted、targets、common_errors）、traps、bonus、restructuring_zh}}}',
            'reference_words': tiers['item_rules']['translation'][tier]['reference_words'],
        },
        'verification': {
            'blind_translators': 2, 'blind_b_different_model': True, 'distractor_audit': False, 'unique_solution': False,
            'input_schema': 'gsat-bank-blind-translation/v1', 'target_hit_rate_min': 0.8,
            'flow_zh': '盲譯者只看 python3 tools/student_view.py FILE 的中文題目自己翻譯（answers），寫完才打開題組檔對答案（review）；'
                       '兩位都通過才 verified（README §5.5）',
            'human_review': '100%（校準期：每個題型 × 提示詞版本的前 30 組全審，SPEC §5.8）',
        },
        'materials': {'grammar_patterns': 'data/curriculum/grammar-patterns.json', 'writing_spec': 'data/exams/generation-spec/writing.json',
                      'analysis': 'docs/analysis/sections/07-writing.md',
                      'd8_zh': '本站參考譯文全部自己寫；不可重製大考中心官方參考譯文或評分原則原文（ROADMAP D8）'},
    })
    return lot


def composition_lot(tier, seq, topics, spec, tiers, created):
    t = (spec.get('tiers') or {}).get(SPEC_KEY[tier]) or {}
    beyond = (spec.get('tiers') or {}).get('beyond_top') or {}
    found = (spec.get('tiers') or {}).get('foundation') or {}
    lot = base_lot('composition', tier, seq, spec, created)
    lot['count'] = len(topics)   # 01 批 10 題、02 批 5 題（01 批的輸出不變）
    _, recent_topics = recent_avoid('composition')
    lot.update({
        'site_target': composition_site_target(seq),
        'topics': [{k: x[k] for k in ('slot', 'id', 'domain_zh', 'topic_zh', 'angle_en', 'keywords', 'prompt_type', 'essay_type',
                                      'figures_hint_zh', 'moves')} for x in topics],
        'topic_rule_zh': 'group.tags.topic 逐字照抄 topic_zh；rubric.prompt_type、question tags.essay_type 照 topics；moves 的 code 照抄，'
                         'zh 寫這個步驟在題目提示裡的寫法',
        'prompt_type_quota': dict(sorted(Counter(x['prompt_type'] for x in topics).items())),
        'prompt_rules': {
            'spec_3_5_zh': tiers['item_rules']['composition'][tier]['summary_zh'],
            'stem_zh': '以「提示：」開頭，寫情境、看圖要求，以及「請…寫一篇英文作文，文分兩段。第一段…；第二段…」（分別指定兩段任務）；'
                       'tags.word_count = {min: 120, max: null, approx: null}、paragraphs = 2、points = 20',
            'figures_zh': '1–3 張圖（ROADMAP D9：代理畫簡單的 SVG 示意圖放在 figure.svg，或只用文字描述情境）；每張要有 caption 與完整的 description；'
                          '圖表題 kind=chart／table，數字寫在 rows（第一列表頭），是題目設定的假設調查（題目寫明「某校調查」），要能讀出 2–3 個明確對比',
            'prompt_zh_chars': (t.get('composition') or {}).get('prompt_zh_chars'),
            'moves': (t.get('composition') or {}).get('moves'),
            'p1_tasks': (t.get('composition') or {}).get('p1_tasks'),
            'p2_tasks': (t.get('composition') or {}).get('p2_tasks'),
            'curriculum': tiers['item_rules']['composition'][tier]['curriculum'],
        },
        'scaffold': SCAFFOLD_RULES[tier],
        'model_texts': {
            'steady': {'label_zh': '穩健版', 'target_score': [14, 17], 'spec': found.get('model_essay')},
            'top': {'label_zh': '頂標版', 'target_score': [18, 20], 'spec': beyond.get('model_essay')},
            'rule_zh': '每題兩篇範文（steady＝穩健版、top＝頂標版），各 ≥120 字、剛好 2 段（段落之間一個換行）；paragraphs 寫段落功能與主題句；'
                       'notes 標轉承詞（function 涵蓋 sequence／cause_effect／contrast／example／conclusion 至少 4 種）、細節句、'
                       '個人經驗句、好用句型、片語，text 都要逐字出現在範文；self_assessment 依四項指標給分（穩健版 14–17、頂標版 18–20）。'
                       '範文 0 錯，不堆砌罕見字或倒裝（07 §4.3）；spec 是出題規格書的篇章指標，不符只列 warning',
        },
        'rubric_template': {
            'criteria': {k: [{'min': lo, 'max': hi, 'descriptor_zh': s} for lo, hi, s in v]
                         for k, v in RUBRIC_TEMPLATE['criteria'].items()},
            'deductions_zh': RUBRIC_TEMPLATE['deductions_zh'],
            'rule_zh': 'rubric.criteria 的 bands 照抄這裡（本站自己的文字），每項另寫這一題的 focus_zh；不可抄評分原則原文（D8）',
        },
        'avoid': {
            'basis': 'data/exams/parsed 的 ' + '、'.join(RECENT_EXAMS) + ' 英文作文主題',
            'topics': recent_topics,
            'p2_tasks_recent': (spec.get('format') or {}).get('composition', {}).get('p2_task_rotation_current'),
            'rule_zh': '不改寫歷屆題；題目提示和歷屆作文題有連續 12 個以上相同漢字列 warning；範文不可和官方內容有 8 字以上相同字串（D8）',
        },
        'item_rules': tiers['item_rules']['composition'][tier],
        'targets': t.get('composition'),
        'design': {k: t.get(k) for k in ('distractor_rules', 'recipe', 'common_errors') if t.get(k)},
        'format': {
            'readme': 'data/bank/README.md §3.6–3.7',
            'sample': 'tools/tests/data/ai.cp.0e1f2a@1.json',
            'group_zh': '1 題 mode=composition、label "1"、answer null、points 20；stem 是題目提示；figures 1–3 張（可帶 svg）；tags.topic 必填',
            'annotations_zh': 'rubric = {kind: "composition", prompt_type, moves, criteria（四項各 bands＋focus_zh）, deductions_zh, scaffold}；'
                              'model_texts = [steady, top]；explanations 選填（審題重點，evidence 引用題目）',
        },
        'verification': {
            'blind_graders': 2, 'blind_b_different_model': True, 'distractor_audit': False, 'unique_solution': False,
            'input_schema': 'gsat-bank-blind-grading/v1', 'score_targets': {'steady': [14, 17], 'top': [18, 20]}, 'max_grader_gap': 2,
            'flow_zh': '盲評者只看 python3 tools/student_view.py --grading FILE（題目、評分規準、兩篇範文以 E1／E2 呈現，不標版本、不給目標分數），'
                       '依評分規準給四項分數；兩位都通過才 verified（README §5.6）',
            'human_review': '100%（校準期：每個題型 × 提示詞版本的前 30 組全審，SPEC §5.8）',
        },
        'materials': {'grammar_patterns': 'data/curriculum/grammar-patterns.json（轉承詞 connectives、句型 patterns）',
                      'writing_spec': 'data/exams/generation-spec/writing.json', 'analysis': 'docs/analysis/sections/07-writing.md',
                      'd8_zh': '範文全部自己寫；不可重製大考中心官方範文、佳作或評分原則原文（ROADMAP D8；佳作只連結不重製）'},
    })
    return lot


# ---------------------------------------------------------------------------
# 補足批次（seq 06 起；主題總表 lots[] 標 "supplement": true 的批次；README §7.2）
# 只加不改：主題總表沒有補足批次時，build_all 不掃題庫、check_topics 不多出任何訊息，01–05 批的輸出逐位元組不變。
# 站主要求每個難度 ≥100 句，只算「每個 uid 最新版本且 status verified」的題組；01–05 批退件（每組只能重出一次）留下的缺口由補足批次補。
# 組數寫在主題總表（每批 1–10 組），缺口與通過率的算式寫在主題總表的 supplement；句型配置改成「依缺口補」：
#   目標分布＝01–05 批句型配置的比例與歷屆中譯英出現次數（grammar-patterns.json exam_translation_refs）的比例各半，
#   缺口＝目標 ×（已通過的標的句型數＋補足批次的句型格數）− 已通過的標的句型數；
#   逐格挑：這一批還沒用過、缺口 > 0 的歷屆高頻句型（≥2 次）優先，其次缺口大、歷屆次數多的；同一難度的補足批次依序扣缺口。
#   句型只從該難度的句構範圍挑（GRAMMAR_BY_CODE；超越頂標另含指定句型 TOP_AST），每句句構數與「超越頂標每組至少 1 個指定句型」照一般批次。
# ---------------------------------------------------------------------------

SUPPLEMENT_MAX_COUNT = 10       # 每批最多 10 組（同一般批次，一位出題者的負擔）
HIGH_FREQ_REFS = 2              # 歷屆中譯英出現 ≥2 次＝高頻句型（README §7.1 的涵蓋範圍）
PATTERNS_PER_SENTENCE = {'basic': 1, 'advanced': 2, 'top': 2}
# 中文主題比對（只用在補足批次的主題）：去掉虛詞、框架詞與泛用的前綴詞（網路、數位…），避免假警報
CJK_RUN = re.compile(r'[㐀-鿿]+')
ZH_FUNCTION_CHARS = set('的與和及或之其在是了為麼什怎如何從到會讓該不各個一每這那')
ZH_STOP_BIGRAMS = {'由來', '演變', '演進', '發明', '起源', '誕生', '歷史', '故事', '台灣', '臺灣', '世界', '文化', '秘密', '簡史',
                   '傳統', '變化', '傳播', '意外', '情境', '多元', '影響', '原因', '關係', '日本', '中國', '美國', '英國', '韓國',
                   '法國', '德國', '動物', '植物', '人類', '網路', '數位', '科技', '社會', '生活', '時間', '改變', '中心', '保護',
                   '電子', '機器'}


def is_supplement(entry):
    """主題總表 lots[] 的一筆是不是補足批次。"""
    return isinstance(entry, dict) and entry.get('supplement') is True


def zh_bigrams(text):
    """中文主題的兩字實詞集合（連續漢字切成相鄰兩字，去掉含虛詞的與框架詞）；沒有漢字回傳空集合。"""
    out = set()
    for run in CJK_RUN.findall(str(text or '')):
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if not (set(bg) & ZH_FUNCTION_CHARS) and bg not in ZH_STOP_BIGRAMS:
                out.add(bg)
    return out


def pass_probability(n, q, need):
    """n 組、每組最終通過機率 q（首輪＋一次重出）時，通過組數 ≥ need 的機率（二項分布）。"""
    return sum(math.comb(n, i) * q ** i * (1 - q) ** (n - i) for i in range(max(need, 0), n + 1))


def supplement_entry(plan, section, tier):
    return ((plan.get('supplement') or {}).get(section) or {}).get(tier) or {}


def check_supplements(plan, topics, lots):
    """補足批次的檢查：組數 1–10、缺口算式和 lots 一致、中文主題共用兩字實詞（warning）。回傳 (errors, warnings)。"""
    errs, warns = [], []
    sup = {k: x for k, x in lots.items() if is_supplement(x)}
    block = plan.get('supplement')
    if not sup and block is None:
        return errs, warns
    for lot, x in sorted(sup.items(), key=lambda kv: str(kv[0])):
        n = x.get('count')
        if x.get('section') != 'translation':
            errs.append(f'{lot}: 補足批次目前只支援中譯英')
        if lot != f'{x.get("section")}-{x.get("tier")}-{x.get("seq")}':
            errs.append(f'{lot}: lot 名稱應為 {{section}}-{{tier}}-{{seq}}')
        if not isinstance(n, int) or not 1 <= n <= SUPPLEMENT_MAX_COUNT:
            errs.append(f'{lot}: 補足批次每批 1–{SUPPLEMENT_MAX_COUNT} 組（目前 {n}）')
    if not isinstance(block, dict):
        errs.append('有補足批次時要寫 supplement（每個難度的已通過組數、缺口、通過率與批次）')
        block = {}
    covered = set()
    for sec in SECTIONS:
        for tier, e in sorted((block.get(sec) or {}).items()):
            if not isinstance(e, dict) or tier not in TIERS:
                errs.append(f'supplement.{sec}.{tier}: 難度應為 {TIERS} 之一、內容是物件')
                continue
            mine = sorted(k for k, x in sup.items() if x.get('section') == sec and x.get('tier') == tier)
            covered |= set(e.get('lots') or [])
            if sorted(e.get('lots') or []) != mine:
                errs.append(f'supplement.{sec}.{tier}.lots {e.get("lots")} 和 lots[] 的補足批次 {mine} 不同')
            n = sum(sup[k].get('count') or 0 for k in mine)
            if e.get('new_groups') != n:
                errs.append(f'supplement.{sec}.{tier}.new_groups={e.get("new_groups")}，補足批次合計 {n} 組')
            v, need = e.get('verified_groups'), e.get('need_groups')
            if not (isinstance(v, int) and isinstance(need, int)):
                errs.append(f'supplement.{sec}.{tier}: verified_groups、need_groups 必須是整數')
                continue
            if need != max(SITE_GROUPS[sec] - v, 0):
                errs.append(f'supplement.{sec}.{tier}.need_groups={need}，應為站主要求 {SITE_GROUPS[sec]} − 已通過 {v}')
            if n < need:
                errs.append(f'supplement.{sec}.{tier}: 補足 {n} 組少於缺口 {need} 組')
            for k in ('pass_rate_first', 'pass_rate_regen'):
                if not (isinstance(e.get(k), (int, float)) and 0 < e[k] <= 1):
                    errs.append(f'supplement.{sec}.{tier}.{k} 必須是 0–1 的通過率')
    for lot in sorted(set(sup) - covered, key=str):
        errs.append(f'{lot}: 補足批次沒有寫在 supplement（缺口與通過率的算式）')
    # 中文主題（題庫第一批閱讀、混合題、中譯英起 tags.topic 是中文，英文關鍵字比不到）：共用兩字實詞列 warning
    reviewed = {(r.get('id'), r.get('against')) for r in plan.get('reviewed_overlaps') or [] if isinstance(r, dict)}
    names = {}   # 主題原文 → [(出處, run_id)]
    for uid, bt, run_id in bank_topics():
        names.setdefault(bt, []).append((f'題庫 {uid}', run_id))
    if OTHER_PLAN.exists():
        other = load(OTHER_PLAN)
        for o in (other.get('topics') or []) + (other.get('reserve_topics') or []):
            names.setdefault(o.get('topic_zh'), []).append((f'topic-plan.json {o.get("id")}', None))
        for c in other.get('used_concepts') or []:
            names.setdefault(c.get('concept_zh'), []).append(('topic-plan.json used_concepts', None))
    for t in topics:
        names.setdefault(t.get('topic_zh'), []).append((f'總表 {t.get("id")}', None))
    for t in topics:
        if t.get('lot') not in sup:
            continue
        mine = zh_bigrams(t.get('topic_zh'))
        for name, where in names.items():
            if not name or name == t.get('topic_zh') or (t.get('id'), name) in reviewed:
                continue
            src = [w for w, run_id in where if not generated_from(run_id, t.get('lot'))]
            common = mine & zh_bigrams(name)
            if src and common:
                warns.append(f'{t.get("id")}「{t.get("topic_zh")}」和{"、".join(src[:3])}的中文主題「{name}」共用「{"、".join(sorted(common))}」，'
                             '請確認不是同一主題（確認後記進 reviewed_overlaps）')
    return errs, warns


def tier_pattern_codes(tier):
    """該難度可當標的句型的 grammar_id → 句構代碼（GRAMMAR_BY_CODE；超越頂標另含指定句型 TOP_AST）。"""
    out = {}
    for code, ids in GRAMMAR_BY_CODE[tier].items():
        for g in ids:
            out.setdefault(g, code)
    if tier == 'top':
        for code, g, _ in TOP_AST:
            out.setdefault(g, code)
    return out


def verified_pattern_counts(tier, bank_dir=None):
    """題庫中譯英該難度、每個 uid 最新版本且 status verified 的題組：(組數, Counter(grammar_id))。"""
    d = (Path(bank_dir) if bank_dir else BANK) / 'translation' / tier
    latest = {}
    for p in sorted(d.glob('*.json')) if d.exists() else []:
        try:
            x = load(p)
        except Exception:  # noqa: BLE001
            continue
        uid, v = x.get('uid'), x.get('version')
        if isinstance(uid, str) and isinstance(v, int) and (uid not in latest or v > latest[uid].get('version')):
            latest[uid] = x
    groups, gids = 0, Counter()
    for x in latest.values():
        if x.get('status') != 'verified' or x.get('section_type') != 'translation' or x.get('tier') != tier:
            continue
        groups += 1
        items = ((x.get('annotations') or {}).get('rubric') or {}).get('items') or {}
        for it in items.values() if isinstance(items, dict) else []:
            for pt in (it.get('patterns') or []) if isinstance(it, dict) else []:
                if isinstance(pt, dict) and isinstance(pt.get('grammar_id'), str):
                    gids[pt['grammar_id']] += 1
    return groups, gids


def gap_state(tier, planned, new_slots, gp, bank_dir=None):
    """同一難度補足批次共用的缺口狀態（deficit 會被各批依序扣掉）。planned：01–05 批的句型配置次數。"""
    elig = tier_pattern_codes(tier)
    groups, verified = verified_pattern_counts(tier, bank_dir)
    refs = {g: len((gp.get(g) or {}).get('exam_translation_refs') or []) for g in elig}
    p_total = sum(planned.get(g, 0) for g in elig)
    r_total = sum(refs.values())
    v_total = sum(verified.get(g, 0) for g in elig)
    total = v_total + new_slots
    share, target = {}, {}
    for g in elig:
        parts = ([planned.get(g, 0) / p_total] if p_total else []) + ([refs[g] / r_total] if r_total else [])
        share[g] = sum(parts) / len(parts) if parts else 1 / len(elig)
        target[g] = share[g] * total
    return {'tier': tier, 'eligible': elig, 'refs': refs, 'planned': Counter({g: planned.get(g, 0) for g in elig}),
            'verified': verified, 'verified_groups': groups, 'verified_patterns': v_total, 'new_slots': new_slots,
            'share': share, 'target': target, 'deficit': {g: target[g] - verified.get(g, 0) for g in elig}}


def supplement_states(lots_sorted, gp, bank_dir=None):
    """{難度: 缺口狀態}；主題總表沒有中譯英補足批次時回傳 {}（不掃題庫）。lots_sorted 依 build_all 的順序。"""
    sup = [x for x in lots_sorted if x['section'] == 'translation' and is_supplement(x)]
    if not sup:
        return {}
    planned = {t: Counter() for t in TIERS}
    sim = {t: Counter() for t in TIERS}   # 重算 01–05 批的配置（和 build_all 同順序、另一組計數器，不影響實際輸出）
    for x in lots_sorted:
        if x['section'] == 'translation' and not is_supplement(x):
            for p in pattern_plan(x['tier'], int(x['seq']), gp, sim[x['tier']]):
                for s in p['sentences']:
                    for q in s['patterns']:
                        planned[x['tier']][q['grammar_id']] += 1
    states = {}
    for tier in TIERS:
        mine = [x for x in sup if x['tier'] == tier]
        if mine:
            slots = sum((x.get('count') or 0) * 2 * PATTERNS_PER_SENTENCE[tier] for x in mine)
            states[tier] = gap_state(tier, planned[tier], slots, gp, bank_dir)
    return states


def supplement_pattern_plan(tier, n, state, gp):
    """補足批次 n 組的句型配置（格式同 pattern_plan），依缺口逐格挑句型並扣掉 state 的缺口。回傳 (plan, 這一批開始前的缺口)。"""
    elig, refs, deficit = state['eligible'], state['refs'], state['deficit']
    per = PATTERNS_PER_SENTENCE[tier]
    high = {g for g in elig if refs[g] >= HIGH_FREQ_REFS}
    cap = -(-(n * 2 * per) // len(elig)) + 1      # 同一批同一句型最多用幾次（讓配置分散）
    before = dict(deficit)
    used = Counter()
    plan = []
    for k in range(n):
        in_group, sents = set(), []
        for j in range(2):
            pats = []
            for pos in range(per):
                avoid = {x['code'] for x in pats}                                      # 同一句不重複句構
                if tier == 'basic' and sents:
                    avoid |= {x['code'] for x in sents[0]['patterns']}                 # 穩定基礎：一組兩句不同句構
                need_ast = tier == 'top' and j == 0 and pos == 0                       # 超越頂標：每組第一格放指定句型
                base = [g for g in elig if elig[g] not in avoid and (not need_ast or g in TOP_AST_IDS)]
                in_codes = {x['code'] for s in sents for x in s['patterns']}           # 同一組盡量不重複句構（挑不到才放寬）
                cands = ([g for g in base if g not in in_group and elig[g] not in in_codes and used[g] < cap]
                         or [g for g in base if g not in in_group and used[g] < cap]
                         or [g for g in base if g not in in_group] or base)
                g = min(cands, key=lambda g: (not (g in high and used[g] == 0 and deficit[g] > 0), -deficit[g], -refs[g], g))
                deficit[g] -= 1
                used[g] += 1
                in_group.add(g)
                pats.append(pattern_entry(elig[g], g, gp))
            sents.append({'no': j + 1, 'patterns': pats})
        if tier == 'top' and k % 2:   # 指定句型不一定都在第 1 句
            sents = [{'no': 1, 'patterns': sents[1]['patterns']}, {'no': 2, 'patterns': sents[0]['patterns']}]
        codes = [x['code'] for s in sents for x in s['patterns']]
        plan.append({'slot': k + 1, 'sentences': sents,
                     'restructuring_hint': tier != 'basic' and any(c in RESTRUCTURE_CODES for c in codes)})
    return plan, before


def insert_after(d, after, key, value):
    """在 dict 的 after 鍵後面插入 key（保留其他鍵的順序）。"""
    out = {}
    for k, v in d.items():
        out[k] = v
        if k == after:
            out[key] = value
    if key not in out:
        out[key] = value
    return out


def supplement_translation_lot(x, topics, spec, tiers, gp, state, plan, created):
    """中譯英補足批次的批次規格：共同欄位同 translation_lot，count 取主題數，pattern_plan 依缺口配置，另加 supplement、pattern_gap。"""
    tier, seq = x['tier'], x['seq']
    lot = translation_lot(tier, seq, topics, spec, tiers, gp, Counter(), created)
    sp_plan, before = supplement_pattern_plan(tier, len(topics), state, gp)
    e = supplement_entry(plan, 'translation', tier)
    block = plan.get('supplement') or {}
    lot['count'] = len(topics)
    lot['label_zh'] = f'{SECTION_LABELS["translation"]}‧{TIER_LABELS[tier]}（第 {int(seq)} 批，補足批次）'
    lot['pattern_plan'] = sp_plan
    here = Counter(q['grammar_id'] for p in sp_plan for s in p['sentences'] for q in s['patterns'])
    lot['pattern_coverage'] = {
        'required_grammar_ids': sorted(here),
        'counts': dict(sorted(Counter(q['code'] for p in sp_plan for s in p['sentences'] for q in s['patterns']).items())),
        'basis_zh': '補足批次：依題庫已通過題組的句型缺口配置（pattern_gap）；句型 id 取自 grammar-patterns.json，'
                    '只從這個難度的句構範圍挑，每句句構數與指定句型的規則同一般批次',
    }
    q1, q2 = e.get('pass_rate_first'), e.get('pass_rate_regen')
    q = q1 + (1 - q1) * q2 if isinstance(q1, (int, float)) and isinstance(q2, (int, float)) else None
    n_all, need = e.get('new_groups'), e.get('need_groups')
    lot = insert_after(lot, 'site_target', 'supplement', {
        'kind': 'supplement',
        'basis_zh': block.get('basis_zh'),
        'counting_rule_zh': block.get('counting_rule_zh'),
        'rule_zh': block.get('rule_zh'),
        'tier_gap': {k: e.get(k) for k in ('verified_groups', 'need_groups', 'pass_rate_first', 'pass_rate_regen', 'new_groups', 'lots')},
        'expected_pass_per_group': round(q, 3) if q is not None else None,
        'expected_pass_groups': round(q * n_all, 2) if q is not None and isinstance(n_all, int) else None,
        'p_reach_need': (round(pass_probability(n_all, q, need), 3)
                         if q is not None and isinstance(n_all, int) and isinstance(need, int) else None),
        'regen_rule_zh': '每組退件可附審查意見重出一次（新 uid，generation.regenerated_from 填原 uid；README §2）；重出仍不過就停在 rejected',
    })
    elig, refs = state['eligible'], state['refs']
    rows = [{'grammar_id': g, 'code': elig[g], 'label_zh': (gp.get(g) or {}).get('name_zh'), 'exam_refs': refs[g],
             'high_frequency': refs[g] >= HIGH_FREQ_REFS, 'planned_seq01_05': state['planned'][g],
             'verified': state['verified'].get(g, 0), 'target': round(state['target'][g], 2),
             'gap_before': round(before[g], 2), 'planned_here': here.get(g, 0)} for g in elig]
    rows.sort(key=lambda r: (-r['gap_before'], -r['exam_refs'], r['grammar_id']))
    lot = insert_after(lot, 'pattern_coverage', 'pattern_gap', {
        'scanned_on': date.today().isoformat(),
        'bank_zh': f'data/bank/v1/translation/{tier}/ 每個 uid 最新版本、status verified 的題組（rubric.items[].patterns[].grammar_id）',
        'verified_groups': state['verified_groups'],
        'verified_patterns': state['verified_patterns'],
        'supplement_pattern_slots': state['new_slots'],
        'method_zh': '目標分布＝01–05 批句型配置的比例與歷屆中譯英出現次數（exam_refs）的比例各半；target＝目標分布 ×（verified_patterns＋'
                     'supplement_pattern_slots）；gap_before＝target − verified（同一難度前一個補足批次已配置的先扣掉）。'
                     '逐格挑：這一批還沒用過、gap > 0 的高頻句型（exam_refs ≥2）優先，其次 gap 大、exam_refs 多的',
        'rows': rows,
    })
    return lot


def build_all(plan, sections, tiers_sel, created, bank_dir=None):
    spec = load(SPEC)
    tiers = load(TIERS_JSON)
    gp = grammar_db()
    by_lot = {}
    for t in plan.get('topics') or []:
        by_lot.setdefault(t['lot'], []).append(t)
    out = []
    counters = {tier: Counter() for tier in TIERS}
    lots_sorted = sorted(plan.get('lots') or [], key=lambda x: (SECTIONS.index(x['section']), TIERS.index(x['tier']), x['seq']))
    states = supplement_states(lots_sorted, gp, bank_dir)   # 沒有補足批次時是 {}
    for x in lots_sorted:
        topics = sorted(by_lot.get(x['lot'], []), key=lambda t: t['slot'])
        made = x.get('created_on') or created   # 主題總表 lots[] 寫了 created_on 的批次（例如 2026-10-20 擴充的作文 02 批）用它
        if x['section'] == 'translation' and is_supplement(x):
            lot = supplement_translation_lot(x, topics, spec, tiers, gp, states[x['tier']], plan, made)
        elif x['section'] == 'translation':
            lot = translation_lot(x['tier'], x['seq'], topics, spec, tiers, gp, counters[x['tier']], made)
        else:
            lot = composition_lot(x['tier'], x['seq'], topics, spec, tiers, made)
        if x['section'] in sections and x['tier'] in tiers_sel:
            out.append(lot)
    return out


def main(argv):
    ap = argparse.ArgumentParser(description='產生中譯英、作文的批次規格 data/bank/lots/{translation,composition}-*.json')
    ap.add_argument('--plan', type=Path, default=PLAN, help='主題總表（預設 data/bank/topic-plan-writing.json）')
    ap.add_argument('--sections', default='translation,composition')
    ap.add_argument('--tiers', default='basic,advanced,top')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--force', action='store_true', help='覆寫已存在的檔案')
    ap.add_argument('--check-topics', action='store_true', help='只檢查主題總表')
    ap.add_argument('--created-on', default=None, help='created_on（預設主題總表的 created_on）')
    a = ap.parse_args(argv)
    plan = load(a.plan)
    errs, warns = check_topics(plan)
    if a.check_topics:
        print(f'主題總表 {a.plan}：{len(plan.get("lots") or [])} 批、{len(plan.get("topics") or [])} 個主題')
        for e in errs:
            print(f'  ERROR {e}')
        for w in warns:
            print(f'  warn  {w}')
        print('OK' if not errs else f'{len(errs)} error')
        return 1 if errs else 0
    if errs:
        print('主題總表有 error（先跑 --check-topics）：', file=sys.stderr)
        for e in errs[:20]:
            print(f'  {e}', file=sys.stderr)
        return 1
    sections = [s for s in a.sections.split(',') if s in SECTIONS]
    tiers_sel = [t for t in a.tiers.split(',') if t in TIERS]
    created = a.created_on or plan.get('created_on') or date.today().isoformat()
    lots = build_all(plan, sections, tiers_sel, created)
    LOTS.mkdir(parents=True, exist_ok=True)
    for lot in lots:
        path = LOTS / f'{lot["lot"]}.json'
        exists = path.exists()
        tag = '略過（已存在）' if exists and not a.force else ('覆寫' if exists else '新增')
        print(f'{tag} {path.relative_to(ROOT)}：{lot["label_zh"]}，{lot["count"]} 組 × {lot["questions_per_group"]} 題')
        if a.dry_run or (exists and not a.force):
            continue
        path.write_text(json.dumps(lot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
