#!/usr/bin/env python3
"""檢查 AI 題庫檔案（gsat-bank/v1，data/bank/v1/{section_type}/{tier}/{uid}@{version}.json）。

用法：
    python3 tools/validate_bank.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json [...]
    python3 tools/validate_bank.py --all                          # data/bank/v1 底下全部
    python3 tools/validate_bank.py --lot data/bank/lots/word_bank-advanced-01.json   # 另做整批檢查
    python3 tools/validate_bank.py --json --all                   # 機器可讀報告
    python3 tools/validate_bank.py --facts [data/bank/facts/sdg14-0007.json ...]   # 檢查事實單（不給檔名就是全部）

規格：docs/DB_SCHEMA.md §5.3（檔案格式）、SPEC §5.4（檢查清單）、SPEC §3.4–3.5（難度帶與題目規則，
資料取自 data/specs/tiers.json＝packages/shared/src/tiers.ts 的鏡像）。檔案說明見 data/bank/README.md。

共通檢查：欄位齊全且沒有未知欄位、uid／檔名／目錄（section_type、tier）一致、format_version、題號從 1 連續、
[[n]] 與小題一一對應、答案在選項內、選項不重複、選項數符合題型、文章指標落在難度帶（tools/text_metrics.py）、
課綱代碼存在、授權在白名單、解析的 evidence 逐字存在選文、沒有「推理過程」類欄位名、
annotations.elimination 的完美配對數剛好 1 且等於標準答案、status 與 verification 一致。
題型檢查：詞彙題（正解在詞表且級別符合難度、4 個選項詞性相同、干擾與正解不在同一個 OEWN synset）、
綜合測驗（5 格各 4 選項、考點組合）、文意選填（10 個選項各用一次、每格詞性相容選項數）、
篇章結構（5 個完整句、多餘句不是任何一格的答案）、閱讀（每題有逐字證據、圖表 chart 的格式與數字一致、
文中與題目提到的數字查得到、SPEC §3.5 題型配比）、混合題（填空答案的原形在文中而答案本身不出現、簡答答案逐字在文中、
可接受答案 ≥1、多選 6／8／10 個選項且答案是陣列）；閱讀與混合題另查事實單與來源白名單（SPEC §5.3）。
中譯英（本站參考譯文 ≥2、每個參考譯文都含標的詞彙與句型、評分規準 4 個部分、SPEC §3.5 的句長與字級）與
作文（穩健版、頂標版兩篇範文各 ≥120 字 2 段、註解範圍在文中、轉承詞 ≥4 種功能、細節句與個人經驗句、鷹架依難度）；
兩者的參考譯文、範文都不可和 data/exams/parsed 的官方參考譯文有 8 字以上相同字串，評分規準不可重製評分原則原文（D8）。
--lot：同一批的組數、每組題數、答案字母分布（詞彙、綜合、閱讀：每個字母 20–30%）、要避開的近期正解字；
閱讀另查文本形式配額（長文 4、圖表 2、表格 1、多文本 1）與 SDG 配額，混合題另查多選正解字母集中度；
中譯英、作文另查主題不重複（中譯英：句型涵蓋；作文：題型配額、第二段任務輪替）。
--facts：檢查事實單 data/bank/facts/*.json（格式見 data/bank/README.md §8）。

error 一定要修；warning 要人看一眼（SPEC §5.8：任何 warn 都進 100% 人工審核）。有 error 時結束碼為 1。
data/bank/v1 不存在或沒有檔案時印訊息並以 0 結束（CI 用）。只用標準函式庫。
"""
import argparse
import itertools
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import student_view as sv  # noqa: E402  — 圖表的文字版（chart_text、data_table）和學生畫面資料共用
import text_metrics as tm  # noqa: E402
import validate_exam as ve  # noqa: E402  — gsat-exam/v1.1 的題組、小題檢查直接沿用

ROOT = Path(__file__).resolve().parent.parent
BANK_DIR = ROOT / 'data' / 'bank' / 'v1'
LOTS_DIR = ROOT / 'data' / 'bank' / 'lots'
FACTS_DIR = ROOT / 'data' / 'bank' / 'facts'
CURRICULUM = ROOT / 'data' / 'curriculum' / 'english-108.json'
LEXICON = ROOT / 'data' / 'vocab' / 'lexicon.json'
WORDLIST = ROOT / 'data' / 'vocab' / 'ceec-wordlist.json'

SCHEMA_ID = 'gsat-bank/v1'
UID_RE = re.compile(r'^ai\.(vo|cz|wb|st|rd|mx|tr|cp)\.[0-9a-f]{6}$')
FILENAME_RE = re.compile(r'^(ai\.[a-z]{2}\.[0-9a-f]{6})@([1-9]\d*)\.json$')
LOT_ID_RE = re.compile(r'^(vocabulary|cloze|word_bank|structure|reading|mixed|translation|composition)-(basic|advanced|top)-\d{2}$')
TIERS = ('basic', 'advanced', 'top')
POOLS = ('practice', 'checkpoint')
STATUSES = ('draft', 'verified', 'rejected')
LICENSES = ('original-ai', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0')
DERIVATIONS = ('ai-original-from-facts', 'adapted', 'original')
CHANNELS = ('agent', 'batch', 'human')
VERIFICATION_KINDS = ('program', 'blind_solver', 'distractor_audit', 'unique_solution', 'similarity', 'fact_check')
RESULTS = ('pass', 'warn', 'fail')
BLANK_POS = ('noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'phrase', 'clause', 'sentence')
CLUE_TYPES = ('collocation', 'definition_restatement', 'contrast', 'cause_effect', 'grammar_frame', 'connective_logic',
              'lexical_link', 'situational', 'pronoun_reference', 'lexical_cohesion', 'transition_word', 'topic_sentence',
              'example', 'elaboration', 'enumeration', 'summary', 'chronology', 'other')
SENSE_KINDS = ('core', 'extended', 'conversion', 'idiom')
FORBIDDEN = ('reasoning', 'chain_of_thought', 'step_by_step', 'thinking')
CHECKED_TYPES = ('vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed')
LETTER_SHARE = (0.20, 0.30)

# 欄位表：(必填, 選填)，與 validate_exam 同一套寫法
TOP_KEYS = ({'schema', 'uid', 'version', 'section_type', 'format_version', 'tier', 'pool', 'group', 'annotations',
             'curriculum', 'provenance', 'generation', 'metrics', 'verification', 'status'}, {'status_reason'})
ANNOTATION_KEYS = ({'explanations', 'translation_zh', 'elimination', 'guess_targets', 'open_tasks', 'rubric', 'model_texts'},
                   set())
EXPLANATION_KEYS = ({'explanation_zh', 'evidence'},
                    {'blank_pos', 'clue_type', 'sense', 'option_notes_zh', 'strategy_zh', 'hints'})
ELIMINATION_KEYS = ({'feasible', 'perfect_matchings'}, set())
CURRICULUM_KEYS = ({'code', 'weight', 'basis'}, set())
PROVENANCE_KEYS = ({'sources', 'license', 'derivation', 'share_alike', 'commercial_ok', 'attribution_text'}, set())
SOURCE_KEYS = ({'source_id', 'role'}, {'url'})
GENERATION_KEYS = ({'channel', 'run_id', 'lot', 'model', 'prompt_id', 'prompt_sha256', 'spec_id'}, {'regenerated_from'})
VERIFICATION_KEYS = ({'kind', 'reviewer', 'result', 'created_at', 'details'}, set())

POS_MAP = {'n.': 'noun', 'v.': 'verb', 'adj.': 'adjective', 'adv.': 'adverb', 'prep.': 'preposition',
           'conj.': 'conjunction', 'pron.': 'pronoun', 'aux.': 'verb', 'art.': 'determiner', 'det.': 'determiner',
           'int.': 'interjection', 'interj.': 'interjection'}
LEMMA_TYPES = {'lemma', 'slash', 'derived_ment', 'derived_suffix', 'pronoun_case', 'plural_usual'}
INFLECTION_POS = {'plural': {'noun'}, 'plural_rule': {'noun'}, 'past': {'verb'}, 'past_participle': {'verb'},
                  'present_participle': {'verb'}, 'third_person': {'verb'}, 'present': {'verb'},
                  'comparative': {'adjective', 'adverb'}, 'superlative': {'adjective', 'adverb'}}

_tiers = None
_curriculum = None
_forms = None
_entry_pos = None
_synsets = None


def tiers_spec():
    global _tiers
    if _tiers is None:
        _tiers = tm.tiers_spec()
    return _tiers


# ---------------------------------------------------------------------------
# 報告
# ---------------------------------------------------------------------------

class Report(ve.Report):
    def __init__(self, name):
        super().__init__(name)
        self.metrics = None

    def as_dict(self):
        return {'file': self.name, 'ok': not self.errors, 'errors': self.errors, 'warnings': self.warnings,
                'metrics': self.metrics}


# ---------------------------------------------------------------------------
# 共用小工具（record_verification.py 也用）
# ---------------------------------------------------------------------------

def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def questions_of(bank):
    g = bank.get('group') if isinstance(bank.get('group'), dict) else {}
    return [q for q in g.get('questions') or [] if isinstance(q, dict)]


def answer_key(bank):
    """題號字串 → 標準答案代號。"""
    return {str(q.get('no')): q.get('answer') for q in questions_of(bank)}


def option_pool(bank, q):
    g = bank.get('group') or {}
    pool = q.get('options') or g.get('options_bank') or {}
    return pool if isinstance(pool, dict) else {}


def norm_text(s):
    """比對證據句用：去標記、空格記號統一成 ＿、彎引號轉直引號、壓縮空白、去掉頭尾標點空白。"""
    s = ve.strip_markup(s or '')
    s = re.sub(r'\[\[\d+\]\]|_{2,}|＿+', '＿', s)
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('—', '-').replace('–', '-')
    s = re.sub(r'\s+', ' ', s)
    return s.strip().strip('"\' ')


def evidence_haystacks(bank):
    """證據可以出自：選文、多文本、題幹、選項庫的句子（篇章結構的正解句本身也是證據）。"""
    g = bank.get('group') or {}
    texts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    texts += [q.get('stem') or '' for q in questions_of(bank)]
    if isinstance(g.get('options_bank'), dict) and bank.get('section_type') == 'structure':
        texts += [v for v in g['options_bank'].values() if isinstance(v, str)]
    if bank.get('section_type') in READING_TYPES and isinstance(g.get('figures'), list):
        # 閱讀、混合題：圖表的文字描述、表格列與 chart 的文字版（學生畫面資料 chart_text／data_table 的每一行）也算原文
        for f in g['figures']:
            if isinstance(f, dict):
                texts += figure_texts(f)
    return [norm_text(t) for t in texts if t]


def evidence_found(ev, haystacks):
    n = norm_text(ev)
    return bool(n) and any(n in h for h in haystacks)


def enumerate_assignments(feasible, n_options, limit=2):
    """每格放一個不同選項的填法（最多列出 limit 種）與總數。feasible：每格可放的選項索引集合。
    總數用子集合動態規劃（文意選填 2^10 個狀態），列舉用回溯，兩者分開才不會在多解時列到爆。"""
    dp = {0: 1}
    for cell in feasible:
        nxt = defaultdict(int)
        for mask, c in dp.items():
            for j in cell:
                if not mask >> j & 1:
                    nxt[mask | 1 << j] += c
        dp = nxt
    total = sum(dp.values())
    found = []

    def walk(i, used, pick):
        if len(found) >= limit:
            return
        if i == len(feasible):
            found.append(list(pick))
            return
        for j in sorted(feasible[i]):
            if j not in used:
                pick.append(j)
                walk(i + 1, used | {j}, pick)
                pick.pop()

    walk(0, frozenset(), [])
    return total, found


def matching_report(bank, feasible_by_no):
    """回傳 (完美配對數, 是否等於標準答案, 問題列表, 正規化後的 feasible)。"""
    g = bank.get('group') or {}
    letters = sorted((g.get('options_bank') or {}).keys())
    idx = {L: i for i, L in enumerate(letters)}
    key = answer_key(bank)
    nos = sorted(key, key=int)
    problems = []
    cells = []
    norm = {}
    for no in nos:
        raw = feasible_by_no.get(no)
        if not isinstance(raw, list):
            problems.append(f'第 {no} 格沒有可行集合')
            raw = []
        bad = [x for x in raw if x not in idx]
        if bad:
            problems.append(f'第 {no} 格的可行集合有不在選項庫的代號 {bad}')
        good = sorted({x for x in raw if x in idx})
        norm[no] = good
        cells.append({idx[x] for x in good})
    total, found = enumerate_assignments(cells, len(letters))
    key_pick = [idx.get(key[no], -1) for no in nos]
    matches = total == 1 and bool(found) and found[0] == key_pick
    if total == 0:
        problems.append('沒有任何一種填法能讓每格各放一個不同選項（標準答案不在可行集合裡？）')
    elif total > 1:
        alt = next((f for f in found if f != key_pick), None)
        alt_s = '、'.join(f'{no}={letters[j]}' for no, j in zip(nos, alt)) if alt else ''
        problems.append(f'有 {total} 種填法說得通（例如 {alt_s}），必須剛好 1 種')
    elif not matches:
        problems.append('唯一的填法不是標準答案')
    if bank.get('section_type') == 'structure':
        used = {key[no] for no in nos}
        for extra in sorted(set(letters) - used):
            in_cells = [no for no in nos if extra in norm.get(no, [])]
            if in_cells:
                problems.append(f'多餘句 {extra} 在第 {"、".join(in_cells)} 格被判為可行')
    return total, matches, problems, norm


# ---------------------------------------------------------------------------
# 詞彙表
# ---------------------------------------------------------------------------

def curriculum_codes():
    global _curriculum
    if _curriculum is None:
        d = load_json(CURRICULUM)
        _curriculum = {x.get('code_ascii') for k in ('learning_performances', 'learning_contents') for x in d.get(k) or []}
        _curriculum |= {x.get('code') for x in d.get('core_competencies') or []}
        _curriculum.discard(None)
    return _curriculum


def forms_index():
    global _forms, _entry_pos
    if _forms is None:
        _forms = load_json(tm.FORMS).get('forms') or {} if tm.FORMS.exists() else {}
        _entry_pos = {}
        for e in load_json(WORDLIST):
            eid = f"{e['word']}|{'/'.join(e['pos'])}|{e['level']}"
            _entry_pos[eid] = {POS_MAP.get(p.strip('()'), p.strip('()')) for p in e['pos']}
    return _forms, _entry_pos


def refs_of(word):
    forms, _ = forms_index()
    return forms.get(tm.fold(word.strip()), [])


def pos_of_word(word):
    """單字可能的詞性集合（依 forms-index 的詞形種類與條目詞類）；查不到回傳 None。"""
    _, entry_pos = forms_index()
    refs = refs_of(word)
    if not refs:
        # 規則衍生的 -ly 副詞（text_metrics 沿用形容詞級別的那一類）
        return {'adverb'} if word.lower().endswith('ly') and tm.token_level(word) is not None else None
    out = set()
    for ref in refs:
        epos = entry_pos.get(ref.get('entry_id'), set())
        types = set(ref.get('types') or [])
        if types & LEMMA_TYPES:
            out |= epos
        for t in types & INFLECTION_POS.keys():
            if t in ('comparative', 'superlative'):
                out |= (INFLECTION_POS[t] & epos) or {'adjective'}
            else:
                out |= INFLECTION_POS[t]
    return out or None


def level_of_word(word):
    """詞表級別（嚴格：只用 forms-index，不套 -ly 衍生規則）；查不到回傳 None。"""
    lex = tm.lexicon()
    for c in tm.base_candidates(word):
        idxs = lex.lookup(c)
        if idxs:
            return min(lex.entries[i]['level'] for i in idxs)
    return None


def synsets_of(word):
    """單字對應條目的 OEWN synset id 集合；本機沒有 lexicon.json 回傳 None。"""
    global _synsets
    if _synsets is None:
        if not LEXICON.exists():
            _synsets = False
        else:
            _synsets = {}
            for e in load_json(LEXICON):
                wn = e.get('wordnet') or {}
                ids = {s.get('synset_id') for s in wn.get('senses') or [] if s.get('synset_id')}
                if ids:
                    _synsets[e['entry_id']] = ids
    if _synsets is False:
        return None
    out = set()
    for ref in refs_of(word):
        if set(ref.get('types') or []) & LEMMA_TYPES or len(refs_of(word)) == 1:
            out |= _synsets.get(ref.get('entry_id'), set())
    return out


# ---------------------------------------------------------------------------
# 共通檢查
# ---------------------------------------------------------------------------

def walk_keys(x, path=''):
    if isinstance(x, dict):
        for k, v in x.items():
            yield f'{path}.{k}' if path else k, k
            yield from walk_keys(v, f'{path}.{k}' if path else k)
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from walk_keys(v, f'{path}[{i}]')


def forbidden_key(k):
    low = k.lower().replace('-', '_').replace(' ', '_')
    flat = low.replace('_', '')
    return any(f in low or f.replace('_', '') in flat for f in FORBIDDEN)


def check_path(r, path, d):
    m = FILENAME_RE.match(path.name)
    uid, version = d.get('uid'), d.get('version')
    if not m:
        r.err('file', f'檔名 {path.name} 不符合 {{uid}}@{{version}}.json')
    elif m.group(1) != uid or str(version) != m.group(2):
        r.err('file', f'檔名 {path.name} 與 uid {uid!r}、version {version!r} 不一致')
    try:
        rel = path.resolve().relative_to(BANK_DIR.resolve())
    except ValueError:
        return  # 不在 data/bank/v1（測試資料、草稿），不檢查目錄
    parts = rel.parts
    if len(parts) != 3:
        r.err('file', f'路徑應為 data/bank/v1/{{section_type}}/{{tier}}/{{檔名}}，目前是 {rel}')
    elif parts[0] != d.get('section_type') or parts[1] != d.get('tier'):
        r.err('file', f'目錄 {parts[0]}/{parts[1]} 與 section_type {d.get("section_type")!r}、tier {d.get("tier")!r} 不一致')


def check_top(r, d):
    if d.get('schema') != SCHEMA_ID:
        r.err('top', f'schema 必須是 "{SCHEMA_ID}"（目前 {d.get("schema")!r}）')
    ve.check_keys(r, 'top', d, TOP_KEYS)
    st = d.get('section_type')
    t = tiers_spec()
    if st not in t['bank_section_types']:
        r.err('top', f'section_type={st!r} 不在 {t["bank_section_types"]}')
    uid = d.get('uid')
    if not isinstance(uid, str) or not UID_RE.match(uid):
        r.err('top', f'uid={uid!r} 不符合 ai.{{vo|cz|wb|st|rd|mx|tr|cp}}.{{6 位小寫十六進位}}')
    elif st in t['bank_uid_codes'] and uid.split('.')[1] != t['bank_uid_codes'][st]:
        r.err('top', f'uid 縮寫 {uid.split(".")[1]} 與 section_type {st}（應為 {t["bank_uid_codes"][st]}）不一致')
    if not (ve.is_int(d.get('version')) and d['version'] >= 1):
        r.err('top', 'version 必須是正整數')
    if d.get('tier') not in TIERS:
        r.err('top', f'tier={d.get("tier")!r} 必須是 basic／advanced／top')
    if d.get('pool') not in POOLS:
        r.err('top', f'pool={d.get("pool")!r} 必須是 practice／checkpoint')
    fmt = t['section_formats'].get(st, {}).get('format_version')
    if fmt and d.get('format_version') != fmt:
        r.err('top', f'format_version 應為 {fmt}（目前 {d.get("format_version")!r}）')
    status = d.get('status')
    if status not in STATUSES:
        r.err('top', f'status={status!r} 必須是 draft／verified／rejected')
    if status == 'rejected' and not ve.nonempty_str(d.get('status_reason')):
        r.err('top', 'status 為 rejected 時 status_reason 必須寫原因')
    if status != 'rejected' and d.get('status_reason'):
        r.warn('top', f'status 為 {status} 卻有 status_reason')
    if status == 'draft':
        r.warn('top', 'status 仍是 draft：驗證還沒走完（tools/record_verification.py），不應 merge')
    for path_, k in walk_keys(d):
        if forbidden_key(k):
            r.err(path_, f'欄位名「{k}」屬於「推理過程」類（{"、".join(FORBIDDEN)}），請改用 explanation_zh、evidence')
    for path_, s, markup in ve.walk_strings(d.get('group'), 'group'):
        if st == 'composition' and re.search(r'\.figures\[\d+\]\.svg$', path_):
            markup = False   # 作文示意圖的 SVG 本身就是標記（另由 svg_problems 檢查）
        ve.check_text(r, path_, s, markup)
    for key in ('annotations', 'curriculum', 'provenance', 'generation'):
        for path_, s, _ in ve.walk_strings(d.get(key), key):
            ve.check_text(r, path_, s, False)


def check_group(r, d):
    """題組本體：沿用 validate_exam 的小題檢查，再加 AI 題的格式規則。"""
    g = d.get('group')
    st = d.get('section_type')
    fmt = tiers_spec()['section_formats'].get(st)
    if not ve.check_keys(r, 'group', g, ve.GROUP_KEYS):
        return
    gw = 'group'
    if not ve.str_or_null(g.get('passage')):
        r.err(gw, 'passage 必須是字串或 null')
    qs = g.get('questions') if isinstance(g.get('questions'), list) else []
    if not qs:
        r.err(gw, '題組沒有任何小題')
    bank = g.get('options_bank')
    if bank is not None and not isinstance(bank, dict):
        r.err(gw, 'options_bank 必須是物件或 null')
        bank = None
    if not isinstance(g.get('figures'), list):
        r.err(gw, 'figures 必須是陣列')
    tags = g.get('tags')
    if tags is not None and not isinstance(tags, dict):
        r.err(gw, 'tags 必須是物件或 null')
    else:
        ve.check_group_tags(r, gw, tags, st, g)
    ve.check_passage_text(r, f'{gw}.passage', g.get('passage'), isinstance(tags, dict) and tags.get('genre') == 'poem')
    for pi, p in enumerate(g.get('passage_parts') or []):
        if ve.check_keys(r, f'{gw}.passage_parts[{pi}]', p, ve.PASSAGE_PART_KEYS):
            ve.check_passage_text(r, f'{gw}.passage_parts[{pi}].text', p.get('text'), False)
    for qi, q in enumerate(qs):
        if not isinstance(q, dict):
            r.err(gw, '小題必須是物件')
            continue
        qw = f'{gw}.q{q.get("label", qi)}'
        ve.check_question(r, qw, q, st, g, None)
        if q.get('label') != str(q.get('no')):
            r.err(qw, f'AI 題的 label 應等於題號字串（no={q.get("no")!r}，label={q.get("label")!r}）')
        if fmt and q.get('mode') not in fmt['modes']:
            r.err(qw, f'{st} 的作答模式應為 {"／".join(fmt["modes"])}（目前 {q.get("mode")!r}）')
        if q.get('stats') is not None:
            r.err(qw, 'AI 題沒有官方統計，stats 必須是 null')
        opts = q.get('options')
        if isinstance(opts, dict):
            seen = Counter(ve.strip_markup(v).strip().lower() for v in opts.values() if isinstance(v, str))
            dup = [v for v, c in seen.items() if c > 1]
            if dup:
                r.err(qw, f'選項重複：{dup}')
            if fmt and fmt['options_per_question'] and len(opts) != fmt['options_per_question']:
                r.err(qw, f'{st} 每題應有 {fmt["options_per_question"]} 個選項（目前 {len(opts)}）')
            letters = sorted(opts)
            if letters != [chr(65 + i) for i in range(len(letters))]:
                r.err(qw, f'選項代號應從 A 依序排列（目前 {letters}）')
    nos = [q.get('no') for q in qs if isinstance(q, dict)]
    if nos != list(range(1, len(nos) + 1)):
        r.err(gw, f'AI 題的題號應從 1 連續編號，目前是 {nos}')
    if fmt and len(qs) != fmt['questions']:
        r.err(gw, f'{st} 一組應有 {fmt["questions"]} 題（目前 {len(qs)}）')
    text = (g.get('passage') or '') + ''.join('\n' + (p.get('text') or '') for p in g.get('passage_parts') or []
                                              if isinstance(p, dict))
    if fmt:
        if fmt['has_passage'] and not text.strip():
            r.err(gw, f'{st} 必須有選文 passage')
        if not fmt['has_passage'] and text.strip():
            r.err(gw, f'{st} 不應有選文（passage 應為 null）')
        if fmt['uses_blanks'] or st in ('cloze', 'word_bank', 'structure'):
            blanks = [int(x) for x in ve.BLANK_RE.findall(text)]
            if blanks != nos:
                r.err(gw, f'選文中的空格 {blanks} 與小題題號 {nos} 不一致（空格要寫成 [[題號]]，每格只出現一次）')
        elif ve.BLANK_RE.search(text):
            r.err(gw, f'{st} 的選文不應有 [[n]] 空格')
        if fmt['bank_options']:
            if not bank:
                r.err(gw, f'{st} 必須有 options_bank')
            else:
                letters = sorted(bank)
                want = [chr(65 + i) for i in range(fmt['bank_options'])]
                if letters != want:
                    r.err(gw, f'options_bank 應為 {want[0]}–{want[-1]} 共 {len(want)} 個選項（目前 {letters}）')
                seen = Counter(ve.strip_markup(v).strip().lower() for v in bank.values() if isinstance(v, str))
                dup = [v for v, c in seen.items() if c > 1]
                if dup:
                    r.err(gw, f'options_bank 選項重複：{dup}')
        elif bank:
            r.err(gw, f'{st} 不應有 options_bank')
    if st in ('cloze', 'word_bank', 'structure', 'reading', 'mixed'):
        if not (isinstance(tags, dict) and ve.nonempty_str(tags.get('topic'))):
            r.err(gw, '題組缺少 tags.topic（批次規格的主題配額靠它統計）')
    if st not in ('translation', 'composition'):
        exp = ve.expected_text_format(g)
        cur = tags.get('text_format') if isinstance(tags, dict) else None
        if exp is not None and cur != exp:
            r.err(gw, f'tags.text_format 應為 {exp}（目前 {cur!r}）')


def check_annotations(r, d):
    a = d.get('annotations')
    if not ve.check_keys(r, 'annotations', a, ANNOTATION_KEYS):
        return
    st = d.get('section_type')
    qs = questions_of(d)
    nos = [str(q.get('no')) for q in qs]
    hay = evidence_haystacks(d)
    ex = a.get('explanations')
    if ex is None:
        if st in CHECKED_TYPES:
            r.err('annotations', 'explanations 不可為 null（每題都要有解析與逐字證據）')
    elif not isinstance(ex, dict) or not isinstance(ex.get('items'), dict) or set(ex) != {'items'}:
        r.err('annotations.explanations', '必須是 {"items": {題號: {...}}}')
    else:
        items = ex['items']
        for k in sorted(set(items) - set(nos), key=str):
            r.err('annotations.explanations', f'題號 {k} 不存在')
        for q in qs:
            no = str(q.get('no'))
            w = f'annotations.explanations.items.{no}'
            it = items.get(no)
            if it is None:
                r.err(w, '缺少這一題的解析')
                continue
            if not ve.check_keys(r, w, it, EXPLANATION_KEYS_RM if st in READING_TYPES else EXPLANATION_KEYS):
                continue
            if not ve.nonempty_str(it.get('explanation_zh')):
                r.err(w, 'explanation_zh 必須是非空字串')
            evs = it.get('evidence')
            if not (isinstance(evs, list) and evs and all(ve.nonempty_str(e) for e in evs)):
                r.err(w, 'evidence 必須是非空的字串陣列（逐字證據句）')
            else:
                for e in evs:
                    if not evidence_found(e, hay):
                        r.err(w, f'evidence「{e[:60]}」在選文／題幹裡找不到（必須逐字引用）')
            if 'blank_pos' in it and it['blank_pos'] not in BLANK_POS:
                r.err(w, f'blank_pos={it["blank_pos"]!r} 不在 {BLANK_POS}')
            if 'clue_type' in it and it['clue_type'] not in CLUE_TYPES:
                r.err(w, f'clue_type={it["clue_type"]!r} 不在允許值內')
            if 'sense' in it and it['sense'] not in SENSE_KINDS:
                r.err(w, f'sense={it["sense"]!r} 不在 {SENSE_KINDS}')
            if st == 'vocabulary' and 'sense' not in it:
                r.err(w, '詞彙題的解析要標 sense（core／extended／conversion／idiom），級別規則靠它判斷')
            notes = it.get('option_notes_zh')
            if notes is not None:
                pool = option_pool(d, q)
                ans = q.get('answer')
                keys = ans if isinstance(ans, list) else [ans]   # 多選題的答案是陣列
                if not isinstance(notes, dict) or any(k not in pool for k in notes):
                    r.err(w, 'option_notes_zh 的鍵必須是本題的選項代號')
                elif any(isinstance(k, str) and k in notes for k in keys):
                    r.warn(w, 'option_notes_zh 包含正解（這個欄位是「錯誤選項為什麼錯」）')
            hints = it.get('hints')
            if hints is not None and not (isinstance(hints, list) and len(hints) <= 3 and all(ve.nonempty_str(h) for h in hints)):
                r.err(w, 'hints 必須是最多 3 個非空字串')
    tz = a.get('translation_zh')
    if tz is not None and not (isinstance(tz, dict) and set(tz) == {'text'} and ve.nonempty_str(tz.get('text'))):
        r.err('annotations.translation_zh', '必須是 {"text": "…"} 或 null')
    for key in ('guess_targets', 'open_tasks'):
        if not isinstance(a.get(key), list):
            r.err(f'annotations.{key}', '必須是陣列（沒有就是 []）')
    el = a.get('elimination')
    if el is not None:
        if st not in ('word_bank', 'structure'):
            r.err('annotations.elimination', '只用在文意選填、篇章結構')
        elif ve.check_keys(r, 'annotations.elimination', el, ELIMINATION_KEYS) and isinstance(el.get('feasible'), dict):
            total, matches, problems, _ = matching_report(d, el['feasible'])
            for p in problems:
                r.err('annotations.elimination', p)
            if el.get('perfect_matchings') != total:
                r.err('annotations.elimination', f'perfect_matchings 寫 {el.get("perfect_matchings")!r}，實際算出 {total}')
        else:
            r.err('annotations.elimination', 'feasible 必須是 {題號: [選項代號…]}')
    elif st in ('word_bank', 'structure') and d.get('status') == 'verified':
        r.err('annotations', 'verified 的文意選填／篇章結構必須有 elimination（tools/record_verification.py 會寫入）')


def check_meta(r, d, path):
    cur = d.get('curriculum')
    if not isinstance(cur, list):
        r.err('curriculum', '必須是陣列')
    else:
        if not cur:
            r.warn('curriculum', '沒有課綱代碼')
        codes = curriculum_codes()
        for i, c in enumerate(cur):
            w = f'curriculum[{i}]'
            if not ve.check_keys(r, w, c, CURRICULUM_KEYS):
                continue
            if c.get('code') not in codes:
                r.err(w, f'課綱代碼 {c.get("code")!r} 不在 data/curriculum/english-108.json（用 ASCII 寫法，例如 3-V-12）')
            if c.get('weight') not in ('primary', 'secondary'):
                r.err(w, 'weight 必須是 primary／secondary')
            if c.get('basis') not in ('generator', 'inferred', 'ceec_feature'):
                r.err(w, 'basis 必須是 generator／inferred／ceec_feature')
    pv = d.get('provenance')
    if ve.check_keys(r, 'provenance', pv, PROVENANCE_KEYS):
        lic, der = pv.get('license'), pv.get('derivation')
        if lic not in LICENSES:
            r.err('provenance', f'license={lic!r} 不在白名單 {LICENSES}')
        if der not in DERIVATIONS:
            r.err('provenance', f'derivation={der!r} 不在 {DERIVATIONS}')
        sa = isinstance(lic, str) and '-SA-' in lic
        if pv.get('share_alike') is not sa:
            r.err('provenance', f'share_alike 應為 {str(sa).lower()}（license {lic}）')
        if not isinstance(pv.get('commercial_ok'), bool):
            r.err('provenance', 'commercial_ok 必須是 true／false')
        if der == 'adapted' and not ve.nonempty_str(pv.get('attribution_text')):
            r.err('provenance', 'CC BY 改作必須有 attribution_text（標示出處並註明修改）')
        if lic == 'original-ai' and der == 'adapted':
            r.err('provenance', 'license original-ai 不能搭配 derivation adapted')
        srcs = pv.get('sources')
        if not isinstance(srcs, list):
            r.err('provenance', 'sources 必須是陣列')
            srcs = []
        for i, s in enumerate(srcs):
            w = f'provenance.sources[{i}]'
            if not ve.check_keys(r, w, s, SOURCE_KEYS):
                continue
            if s.get('role') not in ('fact', 'dataset', 'adapted_text'):
                r.err(w, 'role 必須是 fact／dataset／adapted_text')
            sid = s.get('source_id')
            if not ve.nonempty_str(sid):
                r.err(w, 'source_id 必須是非空字串')
            elif s.get('role') == 'fact' and d.get('section_type') not in READING_TYPES:
                # 閱讀、混合題的事實單另由 check_provenance_facts 檢查（ai-original-from-facts 時不存在是 error）
                fid = sid.split(':', 1)[1] if sid.startswith('fact:') else sid
                if not (FACTS_DIR / f'{fid}.json').exists():
                    r.warn(w, f'事實單 data/bank/facts/{fid}.json 不存在')
        if der == 'ai-original-from-facts' and not any(isinstance(s, dict) and s.get('role') in ('fact', 'dataset') for s in srcs) \
                and d.get('section_type') in ('cloze', 'word_bank', 'structure', 'reading', 'mixed'):
            r.err('provenance', 'ai-original-from-facts 的選文至少要有一個 fact 或 dataset 來源')
    gen = d.get('generation')
    if ve.check_keys(r, 'generation', gen, GENERATION_KEYS):
        if gen.get('channel') not in CHANNELS:
            r.err('generation', f'channel={gen.get("channel")!r} 必須是 agent／batch／human')
        for k in ('run_id', 'model', 'prompt_id', 'spec_id'):
            if not ve.nonempty_str(gen.get(k)):
                r.err('generation', f'{k} 必須是非空字串')
        if not (isinstance(gen.get('prompt_sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', gen['prompt_sha256'])):
            r.err('generation', 'prompt_sha256 必須是 64 位小寫十六進位')
        spec = gen.get('spec_id')
        want = f'{d.get("section_type")}-{d.get("tier")}@'
        if isinstance(spec, str) and not spec.startswith(want):
            r.err('generation', f'spec_id 應以 {want} 開頭（目前 {spec}）')
        lot = gen.get('lot')
        if not isinstance(lot, str) or not LOT_ID_RE.match(lot):
            r.err('generation', f'lot={lot!r} 應為 {{section_type}}-{{tier}}-{{兩位數}}')
        elif not lot.startswith(f'{d.get("section_type")}-{d.get("tier")}-'):
            r.err('generation', f'lot {lot} 與 section_type／tier 不一致')
        elif not (LOTS_DIR / f'{lot}.json').exists():
            r.warn('generation', f'批次規格 data/bank/lots/{lot}.json 不存在')
        rf = gen.get('regenerated_from')
        if rf is not None and not (isinstance(rf, str) and UID_RE.match(rf)):
            r.err('generation', 'regenerated_from 必須是 uid 或 null')


def check_metrics(r, d):
    st = d.get('section_type')
    try:
        m = tm.metrics_for_bank(d)
    except Exception as e:  # noqa: BLE001 — 詞彙表讀不到時不要讓整個檢查掛掉
        r.warn('metrics', f'無法計算文章指標：{e}')
        return
    r.metrics = m
    b = m.get('band')
    if b is not None and not b['ok']:
        for k, c in b['checks'].items():
            if not c['ok']:
                r.err('metrics', f'{k}={c["value"]} 不在 {d.get("tier")} 的帶 {c["min"]}–{c["max"]}（{b["basis"]}）')
    stored = d.get('metrics')
    if stored is None:
        if st in ('cloze', 'word_bank', 'structure', 'reading', 'mixed'):
            r.warn('metrics', 'metrics 還是 null（請跑 python3 tools/text_metrics.py --write）')
    elif not isinstance(stored, dict):
        r.err('metrics', 'metrics 必須是物件或 null')
    else:
        for k in ('word_count', 'coverage_l1_4', 'coverage_l1_6', 'offlist_ratio', 'avg_sentence_length'):
            if stored.get(k) != m.get(k):
                r.warn('metrics', f'metrics.{k}={stored.get(k)!r} 與重新計算的 {m.get(k)!r} 不同（請重跑 text_metrics.py --write）')
                break


def check_verification(r, d):
    vs = d.get('verification')
    if not isinstance(vs, list):
        r.err('verification', '必須是陣列')
        return
    kinds = Counter()
    for i, v in enumerate(vs):
        w = f'verification[{i}]'
        if not ve.check_keys(r, w, v, VERIFICATION_KEYS):
            continue
        if v.get('kind') not in VERIFICATION_KINDS:
            r.err(w, f'kind={v.get("kind")!r} 不在 {VERIFICATION_KINDS}')
        if v.get('result') not in RESULTS:
            r.err(w, f'result={v.get("result")!r} 必須是 pass／warn／fail')
        if not ve.nonempty_str(v.get('reviewer')) or not ve.nonempty_str(v.get('created_at')):
            r.err(w, 'reviewer、created_at 必須是非空字串')
        if not isinstance(v.get('details'), dict):
            r.err(w, 'details 必須是物件')
        if v.get('result') == 'warn':
            r.warn(w, f'{v.get("kind")} 的結果是 warn（SPEC §5.8：要 100% 人工審核）')
        kinds[(v.get('kind'), v.get('result'))] += 1
    if d.get('status') == 'verified':
        need = [('program', 1), ('blind_solver', 2), ('distractor_audit', 1)]
        if d.get('section_type') in WRITING_TYPES:
            need = [('program', 1), ('blind_solver', 2)]   # 中譯英盲譯、作文盲評各兩位，沒有干擾選項稽核
        if d.get('section_type') in ('word_bank', 'structure'):
            need.append(('unique_solution', 1))
        for kind, n in need:
            ok = kinds[(kind, 'pass')] + kinds[(kind, 'warn')]
            if ok < n:
                r.err('verification', f'status 為 verified，但通過的 {kind} 只有 {ok} 筆（需要 {n}）')
        for (kind, res), c in kinds.items():
            if res == 'fail':
                r.err('verification', f'status 為 verified，但有 {c} 筆 {kind} 是 fail')


# ---------------------------------------------------------------------------
# 題型檢查
# ---------------------------------------------------------------------------

def explanation_items(d):
    ex = (d.get('annotations') or {}).get('explanations') or {}
    items = ex.get('items') if isinstance(ex, dict) else None
    return items if isinstance(items, dict) else {}


def check_vocabulary(r, d):
    tier = d.get('tier')
    rule = tiers_spec()['item_rules']['vocabulary'].get(tier)
    if not rule:
        return
    lo, hi = rule['answer_levels']['min'], rule['answer_levels']['max']
    items = explanation_items(d)
    l5_basic, l6 = [], []
    synset_missing = False
    for q in questions_of(d):
        no = str(q.get('no'))
        w = f'group.q{no}'
        opts = q.get('options') if isinstance(q.get('options'), dict) else {}
        if not re.search(r'_{2,}', q.get('stem') or ''):
            r.warn(w, '題幹沒有空格底線（____）')
        words = {k: ve.strip_markup(v).strip() for k, v in opts.items() if isinstance(v, str)}
        multi = [k for k, v in words.items() if len(v.split()) > 1]
        if multi:
            r.warn(w, f'選項 {multi} 不是單字（出題規格：詞彙題選項為單字）')
        ans = q.get('answer')
        aw = words.get(ans) if isinstance(ans, str) else None
        if not aw:
            continue
        sense = (items.get(no) or {}).get('sense', 'core')
        level = level_of_word(aw)
        if level is None:
            if tm.token_level(aw) is not None:
                r.warn(w, f'正解「{aw}」是規則衍生副詞，詞彙表沒有直接列出')
                level = tm.token_level(aw)
            else:
                r.err(w, f'正解「{aw}」不在大考詞彙表（forms-index 查不到）')
        if level is not None and not lo <= level <= hi:
            if sense in ('extended', 'conversion', 'idiom') and tier in ('advanced', 'top'):
                pass  # 常用字的延伸義、轉品（SPEC §3.5 超越頂標；出題規格書：進階的固定說法延伸義）
            elif tier == 'basic' and level == 5:
                l5_basic.append(no)
            else:
                r.err(w, f'正解「{aw}」是 L{level}，{tier} 應為 L{lo}–{hi}'
                         f'{"（延伸義、轉品請在解析標 sense）" if tier != "basic" else ""}')
        if level == 6:
            l6.append(no)
        # 詞性：4 個選項要有共同詞性
        pos_sets = {}
        for k, v in words.items():
            if len(v.split()) > 1:
                continue
            ps = pos_of_word(v)
            if ps is None:
                r.warn(w, f'選項 {k}「{v}」不在詞彙表，無法核對詞性')
            else:
                pos_sets[k] = ps
        if len(pos_sets) >= 2:
            common = set.intersection(*pos_sets.values())
            if not common:
                desc = '、'.join(f'{k} {words[k]}（{"/".join(sorted(p))}）' for k, p in sorted(pos_sets.items()))
                r.err(w, f'4 個選項詞性不一致：{desc}')
            else:
                tag_pos = (q.get('tags') or {}).get('answer_pos')
                if tag_pos in POS_MAP.values() and tag_pos not in common:
                    r.warn(w, f'tags.answer_pos={tag_pos} 不在 4 個選項的共同詞性 {sorted(common)} 內')
        # OEWN synset：干擾選項不能和正解同義
        a_syn = synsets_of(aw)
        if a_syn is None:
            synset_missing = True
        elif a_syn:
            for k, v in words.items():
                if k == ans:
                    continue
                s = synsets_of(v)
                if s and a_syn & s:
                    r.err(w, f'干擾選項 {k}「{v}」和正解「{aw}」在同一個 OEWN synset（{", ".join(sorted(a_syn & s)[:3])}）')
    if synset_missing:
        r.warn('group', '本機沒有 WordNet 資料（data/vocab/lexicon.json），略過 OEWN synset 檢查')
    if len(l5_basic) > 1:
        r.err('group', f'穩定基礎的正解應為 L2–4；第 {"、".join(l5_basic)} 題是 L5（出題規格書最多 1 題）')
    elif l5_basic:
        r.warn('group', f'穩定基礎第 {l5_basic[0]} 題的正解是 L5（SPEC §3.5 為 L2–4，出題規格書允許每組 1 題）')
    n = len(questions_of(d)) or 1
    if rule.get('level6_share_max') is not None and len(l6) / n > rule['level6_share_max'] + 1e-9:
        r.err('group', f'L6 正解 {len(l6)} 題，超過 {rule["level6_share_max"]:.0%}')


CLOZE_BUCKETS = {'word_meaning': 'content', 'word_form': 'content', 'collocation': 'phrase', 'phrase': 'phrase',
                 'connective': 'connective', 'grammar': 'grammar', 'discourse': 'discourse'}


def answer_level(text):
    levels = [tm.token_level(t) for t in re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", ve.strip_markup(text or ''))]
    levels = [lv for lv in levels if lv is not None]
    return max(levels) if levels else None


def check_cloze(r, d):
    tier = d.get('tier')
    rule = tiers_spec()['item_rules']['cloze'].get(tier)
    if not rule:
        return
    qs = questions_of(d)
    tps = [(q.get('tags') or {}).get('test_point') for q in qs]
    if None in tps:
        r.warn('group', '有小題沒有 tags.test_point，無法檢查考點組合（SPEC §3.5）')
    else:
        c = Counter(CLOZE_BUCKETS.get(t, 'other') for t in tps)
        checks = [('connective', rule['connective_blanks'], '轉承'), ('grammar', rule['grammar_blanks'], '文法')]
        if rule['phrase_collocation_blanks'] is None:
            checks.append(('content+phrase', rule['content_blanks'], '實詞與搭配'))
            c['content+phrase'] = c['content'] + c['phrase']
        else:
            checks += [('content', rule['content_blanks'], '實詞'), ('phrase', rule['phrase_collocation_blanks'], '片語搭配')]
        for key, rng, label in checks:
            v = c[key]
            if (rng['min'] is not None and v < rng['min']) or (rng['max'] is not None and v > rng['max']):
                r.err('group', f'{label} {v} 格，{tier} 應為 {rng["min"] if rng["min"] is not None else 0}–'
                               f'{rng["max"] if rng["max"] is not None else 5} 格（SPEC §3.5）')
    if rule.get('answer_level_max'):
        high = []
        for q in qs:
            pool = option_pool(d, q)
            lv = answer_level(pool.get(q.get('answer'), '')) if isinstance(q.get('answer'), str) else None
            if lv is not None and lv > rule['answer_level_max']:
                high.append(f'{q.get("no")}（L{lv}）')
        if len(high) > 1:
            r.err('group', f'穩定基礎的正解應為 L1–{rule["answer_level_max"]}；第 {"、".join(high)} 題超過（出題規格書最多 1 格）')
        elif high:
            r.warn('group', f'穩定基礎第 {high[0]} 題的正解超過 L{rule["answer_level_max"]}')


def option_function_pos(q):
    tags = q.get('tags') or {}
    pos = tags.get('answer_pos')
    if pos == 'phrase':
        return tags.get('answer_function') or 'phrase'
    return pos


def check_word_bank(r, d):
    tier = d.get('tier')
    rule = tiers_spec()['item_rules']['word_bank'].get(tier)
    qs = questions_of(d)
    bank = (d.get('group') or {}).get('options_bank') or {}
    answers = [q.get('answer') for q in qs]
    c = Counter(answers)
    dup = sorted(a for a, n in c.items() if n > 1 and a)
    unused = sorted(set(bank) - set(answers))
    if dup or unused:
        r.err('group', f'文意選填的 10 個選項必須各用一次（重複 {dup}、沒用到 {unused}）')
    if not rule:
        return
    opt_pos = {q.get('answer'): option_function_pos(q) for q in qs if isinstance(q.get('answer'), str)}
    items = explanation_items(d)
    blank_pos = {}
    for q in qs:
        no = str(q.get('no'))
        bp = (items.get(no) or {}).get('blank_pos') or option_function_pos(q)
        if bp == 'phrase':
            bp = option_function_pos(q)
        blank_pos[no] = bp
    if None in opt_pos.values() or None in blank_pos.values() or len(opt_pos) < len(bank):
        r.warn('group', '有小題沒有 tags.answer_pos（片語另需 answer_function），無法檢查詞性相容選項數（SPEC §3.5）')
        return
    groups = Counter(opt_pos.values())
    if rule.get('pos_groups_min') and len(groups) < rule['pos_groups_min']:
        r.err('group', f'選項詞性只分成 {len(groups)} 組（{dict(groups)}），{tier} 至少 {rule["pos_groups_min"]} 組')
    rng = rule['compatible_options_per_blank']
    for no, bp in blank_pos.items():
        n = sum(1 for p in opt_pos.values() if p == bp)
        if (rng['min'] is not None and n < rng['min']) or (rng['max'] is not None and n > rng['max']):
            r.err(f'group.q{no}', f'這一格需要 {bp}，詞性相容的選項有 {n} 個；{tier} 應為 '
                                  f'{rng["min"] if rng["min"] is not None else ""}–{rng["max"] if rng["max"] is not None else ""} 個')
    mix = rule.get('bank_pos_mix')
    if mix:
        # 配比以選項外觀分組：片語（answer_pos=phrase）自成一組，不併入它的功能詞性
        surface = Counter((q.get('tags') or {}).get('answer_pos') for q in qs)
        for k, rr in mix.items():
            v = surface.get(k, 0)
            if (rr['min'] is not None and v < rr['min']) or (rr['max'] is not None and v > rr['max']):
                r.warn('group', f'選項庫 {k} {v} 個，SPEC §3.5 建議 {rr["min"]}–{rr["max"]} 個')
    if rule.get('phrasal_verb_option_required'):
        if not any(len(ve.strip_markup(v).split()) > 1 and option_function_pos(q) == 'verb'
                   for q in qs for v in [bank.get(q.get('answer'), '')]):
            r.err('group', '超越頂標的選項要含片語動詞（answer_pos=phrase、answer_function=verb）')


SENTENCE_RE = re.compile(r'^["“‘(]?[A-Z].*[.!?]["”’)]?$', re.S)


def check_structure(r, d):
    qs = questions_of(d)
    bank = (d.get('group') or {}).get('options_bank') or {}
    answers = [q.get('answer') for q in qs]
    dup = sorted(a for a, n in Counter(answers).items() if n > 1 and a)
    if dup:
        r.err('group', f'篇章結構每個選項最多用一次（重複 {dup}）')
    extra = sorted(set(bank) - set(answers))
    if len(extra) != 1:
        r.err('group', f'4 空 5 選應剛好有 1 個多餘句（目前沒用到的選項是 {extra}）')
    for k, v in sorted(bank.items()):
        t = ve.strip_markup(v or '').strip()
        if not SENTENCE_RE.match(t) or len(t.split()) < 4 or ve.BLANK_RE.search(t):
            r.err(f'group.options_bank.{k}', f'選項必須是完整句（大寫開頭、句號／問號／驚嘆號結尾、至少 4 個字）：「{t[:60]}」')


# ---------------------------------------------------------------------------
# 閱讀、混合題：事實單、來源白名單、圖表（SPEC §5.2 步驟 2、§5.3、§5.4、§6.6、§6.7；README §3.2–3.4、§8）
# ---------------------------------------------------------------------------

READING_TYPES = ('reading', 'mixed')
WHITELIST = ROOT / 'data' / 'bank' / 'sources-whitelist.json'
FACTS_SCHEMA_ID = 'gsat-bank-facts/v1'
FACT_ID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
CHART_TYPES = ('bar', 'line', 'stacked_bar', 'pie')
SOURCE_USES = ('fact_only', 'adaptable_text', 'dataset')
ROLE_USE = {'fact': 'fact_only', 'dataset': 'dataset', 'adapted_text': 'adaptable_text'}
FACT_KINDS = ('number', 'date', 'cause_effect', 'person', 'place', 'event', 'definition', 'other')
FILL_TRANSFORMS = ('none', 'inflection', 'pos_shift', 'pos_shift+inflection')
# 出題規格書 reading.json distractor_taxonomy.codes；mixed.json MIX-MUL-01／02
READING_OPTION_CODES = ('TI', 'TN', 'OP', 'SP', 'OG', 'DS', 'NM', 'LS', 'CX', 'SF', 'NA', 'VS', 'MT', 'PL')
MIXED_KEY_CODES = ('E1', 'E2')
MIXED_DISTRACTOR_CODES = ('PT', 'CT', 'NM', 'PL', 'ST', 'ST*')
MIXED_MODE_ORDER = ['fill_in_blank', 'fill_in_blank', 'multi_select', 'short_answer']
MIXED_POINTS = [2, 2, 4, 2]
MULTI_SELECT_OPTION_COUNTS = (6, 8, 10)
FOCUS_SDGS = (3, 12, 14, 15)
SINGLE_WORD_RE = re.compile(r"^[A-Za-z]+(?:[-'’][A-Za-z]+)*$")
# 文中的阿拉伯數字：12,000、41.2、2015；不含 1990s、COVID-19、5th 這類黏著字母或連字號的
NUM_RE = re.compile(r'(?<![\w.\-])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?!\w)')
WORD_TOKEN_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
CIRCLED = {c: str(i + 1) for i, c in enumerate('①②③④⑤⑥⑦⑧⑨⑩')} | {c: str(i + 1) for i, c in enumerate('❶❷❸❹❺❻❼❽❾❿')}

BANK_FIGURE_KEYS = (set(ve.FIGURE_KEYS[0]), set(ve.FIGURE_KEYS[1]) | {'chart'})
CHART_KEYS = ({'type', 'title', 'x', 'y', 'categories', 'series', 'note', 'source'}, set())
AXIS_KEYS = ({'label', 'unit'}, set())
SERIES_KEYS = ({'name', 'values'}, set())
CHART_SOURCE_KEYS = ({'publisher', 'title', 'url', 'license', 'accessed'}, set())
FACTS_KEYS = ({'schema', 'id', 'title', 'created_on', 'created_by', 'sources', 'facts'}, {'sdgs', 'datasets', 'notes'})
FACT_SOURCE_KEYS = ({'id', 'publisher', 'title', 'url', 'accessed', 'license', 'use'}, {'note'})
FACT_KEYS = ({'id', 'text', 'source_ids'}, {'kind', 'note'})
DATASET_KEYS = ({'id', 'source_id', 'title', 'unit', 'categories', 'series'}, {'indicator', 'note'})
# 閱讀、混合題的解析可以多寫的欄位（各自只用在特定作答模式，見 check_rm_items）
RM_EXPLANATION_EXTRA = {
    'source_token': ('fill_in_blank',),
    'transform': ('fill_in_blank',),
    'partial_credit_forms': ('fill_in_blank', 'short_answer'),
    'interchangeable_with': ('fill_in_blank',),
    'option_codes': ('single_choice', 'multi_select'),
    'option_evidence': ('single_choice', 'multi_select'),
}
EXPLANATION_KEYS_RM = (EXPLANATION_KEYS[0], EXPLANATION_KEYS[1] | set(RM_EXPLANATION_EXTRA))

_whitelist = None
_fact_cache = {}
_families = None


def is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def whitelist():
    global _whitelist
    if _whitelist is None:
        _whitelist = load_json(WHITELIST) if WHITELIST.exists() else {'allow': [], 'deny': []}
    return _whitelist


def host_of(url):
    if not isinstance(url, str):
        return None
    try:
        u = urlsplit(url.strip())
        host = u.hostname
    except ValueError:
        return None
    if u.scheme not in ('http', 'https') or not host:
        return None
    return host.lower().rstrip('.')


def _rule_hit(rule, host):
    """規則對上主機時回傳對上的網域長度（越長越具體），沒對上回傳 0。"""
    match = rule.get('match', 'domain')
    if match == 'host':
        return len(host) if host in (rule.get('hosts') or []) else 0
    if match == 'domain':
        return max((len(dm) for dm in rule.get('domains') or [] if host == dm or host.endswith('.' + dm)), default=0)
    return 0


def source_problems(url, use, license_=None, check_license=True):
    """來源網址＋用途的白名單判定。回傳 (errors, warnings, allow 那一筆)。deny 優先，allow 取最具體的網域。"""
    host = host_of(url)
    if not host:
        return [f'url {url!r} 不是 http(s) 網址'], [], None
    wl = whitelist()
    denied = [rule for rule in wl.get('deny') or []
              if ('*' in (rule.get('uses') or []) or use in (rule.get('uses') or [])) and _rule_hit(rule, host)]
    if denied:
        return [f'{host} 在禁止清單（{rule.get("id")}：{rule.get("rule_zh")}）' for rule in denied], [], None
    best, best_len = None, 0
    for entry in wl.get('allow') or []:
        n = _rule_hit(entry, host)
        if n > best_len:
            best, best_len = entry, n
    if best is None:
        return [f'{host} 不在來源白名單（data/bank/sources-whitelist.json）'], [], None
    errs, warns = [], []
    if use not in (best.get('uses') or []):
        errs.append(f'{host}（{best.get("publisher")}）只能當 {"／".join(best.get("uses") or [])}，不能當 {use}')
    elif check_license and use in ('adaptable_text', 'dataset') and license_ not in (best.get('licenses') or []):
        errs.append(f'{host} 當 {use} 時授權必須是 {"／".join(best.get("licenses") or [])}（目前 {license_!r}）')
    if not errs and use == 'adaptable_text' and best.get('id') == 'global-voices':
        warns.append(f'{host}：逐篇確認不是合作媒體轉載稿（{best.get("conditions_zh")}）')
    return errs, warns, best


def numbers_in(text):
    """文字中的阿拉伯數字（先去掉標記與 [[n]] 空格）→ [(值, 小數位數, 原字串)]。"""
    if not isinstance(text, str):
        return []
    t = ve.BLANK_RE.sub(' ', ve.strip_markup(text))
    out = []
    for m in NUM_RE.finditer(t):
        raw = m.group(1).replace(',', '') + (m.group(2) or '')
        out.append((float(raw), len(m.group(2)) - 1 if m.group(2) else 0, m.group(0)))
    return out


def decimals_of(v):
    s = repr(float(v))
    return 0 if float(v).is_integer() or 'e' in s else len(s.split('.')[1])


class NumberPool:
    """查得到的數字：單一數值、文字裡的數字，以及表格（同一數列兩值、同一類別兩數列）的差。
    比對規則：文中的數字等於某個數值依文中的小數位數四捨五入後的值。"""

    def __init__(self):
        self.values = set()
        self.tables = []   # 每個是 [數列的數值陣列…]（依類別對齊）

    def add_text(self, text):
        self.values.update(v for v, _, _ in numbers_in(text))

    def add_table(self, series):
        clean = [[float(v) for v in s if is_number(v)] for s in series]
        for s in clean:
            self.values.update(s)
        self.tables.append(clean)

    def found(self, v, d, derived=True):
        tol = 0.5 * 10 ** -d + 1e-9
        if any(abs(x - v) <= tol for x in self.values):
            return True
        if not derived:
            return False
        for table in self.tables:
            groups = list(table) + [list(col) for col in zip(*table)] if len(table) > 1 else list(table)
            for g in groups:
                for i in range(len(g)):
                    for j in range(i + 1, len(g)):
                        if abs(abs(g[i] - g[j]) - v) <= tol:
                            return True
        return False


def check_series(r, where, categories, series):
    """chart 與事實單 datasets 共用：類別與數列的格式。回傳合格數列的 values（給數字比對）。"""
    if not (isinstance(categories, list) and categories and all(ve.nonempty_str(c) for c in categories)):
        r.err(where, 'categories 必須是非空字串的非空陣列')
        return []
    if len(set(categories)) != len(categories):
        r.err(where, f'categories 有重複：{[c for c, n in Counter(categories).items() if n > 1]}')
    if not (isinstance(series, list) and series):
        r.err(where, 'series 必須是非空陣列')
        return []
    out, names = [], []
    for si, s in enumerate(series):
        sw = f'{where}.series[{si}]'
        if not ve.check_keys(r, sw, s, SERIES_KEYS):
            continue
        if not ve.nonempty_str(s.get('name')):
            r.err(sw, 'name 必須是非空字串')
        else:
            names.append(s['name'])
        vals = s.get('values')
        if not isinstance(vals, list):
            r.err(sw, 'values 必須是數字陣列')
            continue
        if len(vals) != len(categories):
            r.err(sw, f'values 有 {len(vals)} 個，categories 有 {len(categories)} 個（長度必須一致）')
        bad = [v for v in vals if not is_number(v)]
        if bad:
            r.err(sw, f'values 必須都是數字（JSON number，不是字串或 null）：{bad[:3]}')
        out.append([v for v in vals if is_number(v)])
    dup = [n for n, c in Counter(names).items() if c > 1 and n]
    if dup:
        r.err(where, f'series 的 name 重複：{dup}')
    return out


def check_chart(r, where, chart):
    """figure.chart（README §3.2）。回傳 (數列 values, categories)。"""
    if not ve.check_keys(r, where, chart, CHART_KEYS):
        return [], []
    ctype = chart.get('type')
    if ctype not in CHART_TYPES:
        r.err(where, f'type={ctype!r} 必須是 {"／".join(CHART_TYPES)}')
    if not ve.nonempty_str(chart.get('title')):
        r.err(where, 'title 必須是非空字串')
    for ax in ('x', 'y'):
        aw = f'{where}.{ax}'
        a = chart.get(ax)
        if ve.check_keys(r, aw, a, AXIS_KEYS):
            if not ve.nonempty_str(a.get('label')):
                r.err(aw, 'label 必須是非空字串')
            if a.get('unit') is not None and not ve.nonempty_str(a.get('unit')):
                r.err(aw, 'unit 必須是非空字串或 null')
    if not ve.str_or_null(chart.get('note')):
        r.err(where, 'note 必須是字串或 null')
    cats = chart.get('categories')
    vals = check_series(r, where, cats, chart.get('series'))
    if ctype == 'pie':
        if len(chart.get('series') or []) != 1:
            r.err(where, '圓餅圖（pie）只能有 1 個數列')
        elif vals and any(v < 0 for v in vals[0]):
            r.err(where, '圓餅圖的數值不可為負')
        elif vals and (chart.get('y') or {}).get('unit') == '%' and abs(sum(vals[0]) - 100) > 1.0:
            r.warn(where, f'圓餅圖的百分比加總 {sum(vals[0]):g}，不是 100')
    if ctype == 'stacked_bar':
        if len(chart.get('series') or []) < 2:
            r.err(where, '堆疊長條圖（stacked_bar）至少要 2 個數列')
        if any(v < 0 for s in vals for v in s):
            r.warn(where, '堆疊長條圖有負值，前端不好畫')
    if ctype == 'line' and isinstance(cats, list) and len(cats) < 2:
        r.err(where, '折線圖（line）至少要 2 個類別（時間點）')
    src = chart.get('source')
    sw = f'{where}.source'
    if ve.check_keys(r, sw, src, CHART_SOURCE_KEYS):
        for k in ('publisher', 'title', 'license'):
            if not ve.nonempty_str(src.get(k)):
                r.err(sw, f'{k} 必須是非空字串')
        if not (isinstance(src.get('accessed'), str) and DATE_RE.match(src['accessed'])):
            r.err(sw, 'accessed 必須是 YYYY-MM-DD')
        errs, warns, _ = source_problems(src.get('url'), 'dataset', src.get('license'))
        for e in errs:
            r.err(sw, e)
        for x in warns:
            r.warn(sw, x)
    return vals, cats if isinstance(cats, list) else []


def figure_texts(f):
    """證據比對用：圖的說明、描述、表格列（以 ' | ' 相接）、chart 的文字版（student_view 的 chart_text 與 data_table）。"""
    out = [x for x in (f.get('caption'), f.get('description')) if isinstance(x, str)]
    rows = f.get('rows')
    if isinstance(rows, list):
        out += [' | '.join(c for c in row if isinstance(c, str)) for row in rows if isinstance(row, list)]
    ch = f.get('chart')
    if isinstance(ch, dict):
        try:
            out += [str(x) for x in sv.chart_text_lines(ch)]
            out += [' | '.join(str(c) for c in row) for row in sv.chart_table(ch)]
        except Exception:  # noqa: BLE001 — chart 格式錯誤由 check_chart 回報
            pass
    return [t for t in out if t]


# ---------------------------------------------------------------------------
# 事實單（data/bank/facts/{id}.json；README §8）
# ---------------------------------------------------------------------------

def check_facts(r, path, d):
    """事實單本身的格式、來源白名單、事實與資料集。"""
    if not ve.check_keys(r, 'facts', d, FACTS_KEYS):
        return
    if d.get('schema') != FACTS_SCHEMA_ID:
        r.err('facts', f'schema 必須是 "{FACTS_SCHEMA_ID}"（目前 {d.get("schema")!r}）')
    fid = d.get('id')
    if not (isinstance(fid, str) and FACT_ID_RE.match(fid)):
        r.err('facts', f'id={fid!r} 必須是小寫英數字與連字號（例如 sdg14-0007）')
    elif Path(path).stem != fid:
        r.err('facts', f'檔名 {Path(path).name} 與 id {fid} 不一致（應為 {fid}.json）')
    if not ve.nonempty_str(d.get('title')):
        r.err('facts', 'title 必須是非空字串')
    if not (isinstance(d.get('created_on'), str) and DATE_RE.match(d['created_on'])):
        r.err('facts', 'created_on 必須是 YYYY-MM-DD')
    if not ve.nonempty_str(d.get('created_by')):
        r.err('facts', 'created_by 必須是非空字串（整理者：模型 ID 或 admin:{users.id}）')
    sdgs = d.get('sdgs')
    if 'sdgs' in d and not (isinstance(sdgs, list) and all(ve.is_int(n) and 1 <= n <= 17 for n in sdgs)):
        r.err('facts', 'sdgs 必須是 1–17 的整數陣列')
    if not ve.str_or_null(d.get('notes')):
        r.err('facts', 'notes 必須是字串或 null')
    srcs = d.get('sources')
    if not (isinstance(srcs, list) and srcs):
        r.err('facts', 'sources 必須是非空陣列')
        srcs = []
    uses = {}
    for i, s in enumerate(srcs):
        w = f'sources[{i}]'
        if not ve.check_keys(r, w, s, FACT_SOURCE_KEYS):
            continue
        sid = s.get('id')
        if not ve.nonempty_str(sid):
            r.err(w, 'id 必須是非空字串（例如 s1）')
        elif sid in uses:
            r.err(w, f'來源 id {sid} 重複')
        for k in ('publisher', 'title', 'license'):
            if not ve.nonempty_str(s.get(k)):
                r.err(w, f'{k} 必須是非空字串（fact_only 也照實記錄原站授權，例如 all-rights-reserved）')
        if not (isinstance(s.get('accessed'), str) and DATE_RE.match(s['accessed'])):
            r.err(w, 'accessed 必須是 YYYY-MM-DD（取得日期）')
        if not ve.str_or_null(s.get('note')):
            r.err(w, 'note 必須是字串或 null')
        use = s.get('use')
        if use not in SOURCE_USES:
            r.err(w, f'use={use!r} 必須是 {"／".join(SOURCE_USES)}')
        else:
            errs, warns, _ = source_problems(s.get('url'), use, s.get('license'))
            for e in errs:
                r.err(w, e)
            for x in warns:
                r.warn(w, x)
        if ve.nonempty_str(sid):
            uses[sid] = use
    facts = d.get('facts')
    if not isinstance(facts, list):
        r.err('facts', 'facts 必須是陣列')
        facts = []
    datasets = d.get('datasets', [])
    if not isinstance(datasets, list):
        r.err('facts', 'datasets 必須是陣列')
        datasets = []
    if not facts and not datasets:
        r.err('facts', '至少要有一條事實或一個資料集')
    seen, used = set(), set()
    for i, f in enumerate(facts):
        w = f'facts[{i}]'
        if not ve.check_keys(r, w, f, FACT_KEYS):
            continue
        if not ve.nonempty_str(f.get('id')):
            r.err(w, 'id 必須是非空字串（例如 f1）')
        elif f['id'] in seen:
            r.err(w, f'id {f["id"]} 重複（事實與資料集的 id 共用一個命名空間）')
        else:
            seen.add(f['id'])
        text = f.get('text')
        if not ve.nonempty_str(text):
            r.err(w, 'text 必須是非空字串')
        else:
            if re.search(r'[“”"]', text):
                r.warn(w, 'text 有引號：事實單只寫事實、不放原句（引述請改寫成自己的話）')
            if len(text.split()) > 60:
                r.warn(w, f'text 有 {len(text.split())} 個字：一條事實寫一件事（數字、日期、因果、人名地名），不要整段摘錄')
        sids = f.get('source_ids')
        if not (isinstance(sids, list) and sids and all(ve.nonempty_str(x) for x in sids)):
            r.err(w, 'source_ids 必須是非空的來源 id 陣列（每條事實都要附來源）')
        else:
            for x in sids:
                if x not in uses:
                    r.err(w, f'source_ids 的 {x} 不在 sources')
                used.add(x)
        if 'kind' in f and f['kind'] not in FACT_KINDS:
            r.err(w, f'kind={f["kind"]!r} 必須是 {"／".join(FACT_KINDS)}')
        if not ve.str_or_null(f.get('note')):
            r.err(w, 'note 必須是字串或 null')
    for i, ds in enumerate(datasets):
        w = f'datasets[{i}]'
        if not ve.check_keys(r, w, ds, DATASET_KEYS):
            continue
        if not ve.nonempty_str(ds.get('id')):
            r.err(w, 'id 必須是非空字串（例如 d1）')
        elif ds['id'] in seen:
            r.err(w, f'id {ds["id"]} 重複（事實與資料集的 id 共用一個命名空間）')
        else:
            seen.add(ds['id'])
        sid = ds.get('source_id')
        if not isinstance(sid, str) or sid not in uses:
            r.err(w, f'source_id={sid!r} 不在 sources')
        elif uses[sid] != 'dataset':
            r.err(w, f'資料集的來源 {sid} 的 use 必須是 dataset（目前 {uses[sid]}）')
        if isinstance(sid, str):
            used.add(sid)
        if not ve.nonempty_str(ds.get('title')):
            r.err(w, 'title 必須是非空字串')
        if ds.get('unit') is not None and not ve.nonempty_str(ds.get('unit')):
            r.err(w, 'unit 必須是非空字串或 null')
        for k in ('indicator', 'note'):
            if not ve.str_or_null(ds.get(k)):
                r.err(w, f'{k} 必須是字串或 null')
        check_series(r, w, ds.get('categories'), ds.get('series'))
    for sid in sorted(set(uses) - used):
        r.warn('facts', f'來源 {sid} 沒有被任何事實或資料集引用')


def check_facts_file(path):
    path = Path(path)
    r = Report(str(path))
    try:
        d = load_json(path)
    except Exception as e:  # noqa: BLE001
        r.err('file', f'JSON 解析失敗：{e}')
        return r, None
    check_facts(r, path, d)
    return r, d


def fact_id_of(source_id):
    return source_id.split(':', 1)[1] if source_id.startswith('fact:') else source_id


def load_fact_sheet(fid):
    """回傳 (路徑, 報告, 資料)；檔案不存在回傳 (路徑, None, None)。依路徑快取（測試會換 FACTS_DIR）。"""
    p = (FACTS_DIR / f'{fid}.json').resolve()
    if p not in _fact_cache:
        _fact_cache[p] = check_facts_file(p) if p.exists() else (None, None)
    rep, data = _fact_cache[p]
    return p, rep, data


def sheet_numbers(sheet, pool, datasets_only=False):
    """把事實單的數字加進 pool：datasets 的數值與類別；datasets_only=False 時另加事實文字裡的數字。"""
    for ds in rm_list(sheet.get('datasets')):
        if isinstance(ds, dict):
            pool.add_table([rm_list(s.get('values')) for s in rm_list(ds.get('series')) if isinstance(s, dict)])
            for c in rm_list(ds.get('categories')):
                pool.add_text(c)
    if not datasets_only:
        for f in rm_list(sheet.get('facts')):
            if isinstance(f, dict):
                pool.add_text(f.get('text'))


def check_provenance_facts(r, d):
    """閱讀、混合題的來源：事實單存在且本身沒有 error、來源網址在白名單。回傳 [(role, fid, 事實單資料)]。"""
    pv = d.get('provenance') if isinstance(d.get('provenance'), dict) else {}
    der = pv.get('derivation')
    sheets = []
    for i, s in enumerate(pv.get('sources') if isinstance(pv.get('sources'), list) else []):
        if not isinstance(s, dict):
            continue
        w = f'provenance.sources[{i}]'
        role, sid = s.get('role'), s.get('source_id')
        if 'url' in s and isinstance(role, str) and role in ROLE_USE:
            license_ = pv.get('license') if role == 'adapted_text' else None
            errs, warns, _ = source_problems(s.get('url'), ROLE_USE[role], license_, check_license=role == 'adapted_text')
            for e in errs:
                r.err(w, e)
            for x in warns:
                r.warn(w, x)
        if role not in ('fact', 'dataset') or not ve.nonempty_str(sid):
            continue
        fid = fact_id_of(sid)
        if not FACT_ID_RE.match(fid):
            r.err(w, f'source_id={sid!r} 應為 fact:{{事實單 id}}（小寫英數字與連字號）')
            continue
        p, rep, data = load_fact_sheet(fid)
        data = data if isinstance(data, dict) else None
        if rep is None:
            msg = f'事實單 data/bank/facts/{fid}.json 不存在'
            if der == 'ai-original-from-facts':
                r.err(w, msg + '（ai-original-from-facts 的每個 fact／dataset 來源都要有事實單）')
            else:
                r.warn(w, msg)
            continue
        if rep.errors:
            r.err(w, f'事實單 {fid}.json 有 {len(rep.errors)} 個 error（python3 tools/validate_bank.py --facts）：{rep.errors[0]}')
        if role == 'dataset' and not (data or {}).get('datasets'):
            r.err(w, f'role=dataset 的事實單 {fid}.json 沒有 datasets（圖表資料要存原始資料與出處）')
        if isinstance(data, dict):
            sheets.append((role, fid, data))
    return sheets


# ---------------------------------------------------------------------------
# 閱讀、混合題共用：圖表、數字、解析的擴充欄位
# ---------------------------------------------------------------------------

def rm_list(x):
    """型別防護：是陣列就原樣回傳，否則回傳空陣列（格式錯誤由各自的檢查回報）。"""
    return x if isinstance(x, list) else []


def rm_explanation_items(d):
    """annotations.explanations.items（閱讀、混合題用；格式錯誤時回傳空物件，由 check_annotations 回報）。"""
    a = d.get('annotations') if isinstance(d.get('annotations'), dict) else {}
    ex = a.get('explanations') if isinstance(a.get('explanations'), dict) else {}
    items = ex.get('items')
    return items if isinstance(items, dict) else {}


def answer_keys(q):
    """小題的正解代號集合（多選是陣列）；只收字串。"""
    ans = q.get('answer')
    return {x for x in (ans if isinstance(ans, list) else [ans]) if isinstance(x, str)}


def group_plain_text(d):
    """選文（passage 接著各 passage_parts.text），去掉標記、彎引號轉直引號。"""
    g = d.get('group') or {}
    texts = [g.get('passage')] + [p.get('text') for p in rm_list(g.get('passage_parts')) if isinstance(p, dict)]
    t = ve.strip_markup('\n'.join(x for x in texts if isinstance(x, str) and x))
    return t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')


def word_occurrences(text, phrase):
    """phrase 在 text 中以完整字詞出現的次數（不分大小寫、空白壓縮）。"""
    p = re.sub(r'\s+', ' ', (phrase or '').replace('’', "'").strip())
    if not p:
        return 0
    pat = r'(?<![A-Za-z0-9])' + re.escape(p).replace('\\ ', ' ').replace(' ', r'\s+') + r'(?![A-Za-z0-9])'
    return len(re.findall(pat, text, re.I))


def norm_answer(s):
    """填充、簡答的比對正規化（SPEC §4.6）：去頭尾空白、統一引號、不分大小寫、去句尾句點、圈號數字＝阿拉伯數字。"""
    t = ''.join(CIRCLED.get(c, c) for c in str(s or ''))
    t = t.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    t = re.sub(r'\s+', ' ', t).strip().rstrip('.').strip()
    return t.lower()


def entry_ids(word):
    return {ref.get('entry_id') for ref in refs_of(word)} - {None}


def families():
    """lexicon.json 的字族：entry_id → 同字族 entry_id 集合；沒有 lexicon.json 回傳 {}。"""
    global _families
    if _families is None:
        _families = {}
        if LEXICON.exists():
            by_fam = defaultdict(set)
            for e in load_json(LEXICON):
                eid = e.get('entry_id')
                group = {eid} | {f.get('entry_id') for f in e.get('family') or [] if isinstance(f, dict)}
                if e.get('family_id'):
                    by_fam[e['family_id']] |= group
                for x in group:
                    _families.setdefault(x, set()).update(group)
            for members in by_fam.values():
                for x in members:
                    _families.setdefault(x, set()).update(members)
    return _families


def related_strict(a, b):
    """同一詞目（forms-index）或同一字族（lexicon.json family）。"""
    if a.lower() == b.lower():
        return True
    ea, eb = entry_ids(a), entry_ids(b)
    if ea & eb:
        return True
    fam = families()
    return any(fam.get(x, {x}) & eb for x in ea)


def prefix_related(a, b):
    """字首相同的退路（詞表沒有字族資料時）：共同字首 ≥4 個字母且 ≥ 較短字長 − 3。"""
    a, b = a.lower(), b.lower()
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n >= 4 and n >= min(len(a), len(b)) - 3


def check_rm_figures(r, d):
    """圖、表、chart。回傳 (charts, tables)：charts=[(位置, figure, 數列 values, categories)]、tables=[(位置, rows)]。"""
    g = d.get('group') or {}
    figs = g.get('figures') if isinstance(g.get('figures'), list) else []
    nos = {q.get('no') for q in questions_of(d) if ve.is_int(q.get('no'))}
    charts, tables = [], []
    for fi, f in enumerate(figs):
        w = f'group.figures[{fi}]'
        if not ve.check_keys(r, w, f, BANK_FIGURE_KEYS):
            continue
        kind = f.get('kind')
        if not ve.nonempty_str(kind):
            r.err(w, 'kind 必須是非空字串')
        if not ve.str_or_null(f.get('caption')) or not ve.str_or_null(f.get('label')):
            r.err(w, 'caption、label 必須是字串或 null')
        if not ve.nonempty_str(f.get('description')):
            r.err(w, 'description 必須是完整的文字描述（盲解者與無障礙都靠它）')
        rows = f.get('rows')
        if rows is not None and not (isinstance(rows, list) and all(isinstance(x, list) and all(isinstance(c, str) for c in x) for x in rows)):
            r.err(w, 'rows 必須是字串的二維陣列或 null')
            rows = None
        qn = f.get('question_no')
        if qn is not None and (not ve.is_int(qn) or qn not in nos):  # noqa: SIM102
            r.err(w, f'question_no={qn!r} 必須是本題組小題的題號')
        if 'chart' in f:
            if kind not in ('chart', 'graph'):
                r.err(w, f'chart 物件只用在 kind=chart 的圖（目前 kind={kind!r}；表格用 kind=table＋rows）')
            vals, cats = check_chart(r, f'{w}.chart', f.get('chart'))
            charts.append((w, f, vals, cats))
        elif kind in ('chart', 'graph'):
            r.err(w, 'kind=chart 的圖要有 chart 物件（前端依它繪圖，README §3.2）')
        if kind == 'table':
            if not rows or len(rows) < 2:
                r.err(w, '表格（kind=table）要有 rows，至少表頭＋1 列')
            elif len({len(x) for x in rows}) != 1 or len(rows[0]) < 2:
                r.err(w, f'表格每一列的欄數要一樣、至少 2 欄（目前 {[len(x) for x in rows]}）')
            else:
                tables.append((w, rows))
    return charts, tables


def check_chart_datasets(r, d, charts, sheets):
    """圖表的數值要對得回事實單的 datasets（SPEC §5.2 步驟 2：圖表資料存原始資料與出處）。"""
    if not charts:
        return
    pv = d.get('provenance') if isinstance(d.get('provenance'), dict) else {}
    if not any(isinstance(s, dict) and s.get('role') == 'dataset' for s in rm_list(pv.get('sources'))):
        r.err('provenance', '圖表題要有 role=dataset 的來源（事實單的 datasets 存圖表的原始資料與出處）')
        return
    ds_sheets = [data for role, _, data in sheets if role == 'dataset']
    if not ds_sheets:
        return   # 事實單不存在或有錯，check_provenance_facts 已回報
    pool = NumberPool()
    hosts = set()
    for sheet in ds_sheets:
        sheet_numbers(sheet, pool, datasets_only=True)
        src_by_id = {s.get('id'): s for s in rm_list(sheet.get('sources')) if isinstance(s, dict) and isinstance(s.get('id'), str)}
        for ds in rm_list(sheet.get('datasets')):
            if isinstance(ds, dict) and isinstance(ds.get('source_id'), str) and ds['source_id'] in src_by_id:
                hosts.add(host_of(src_by_id[ds['source_id']].get('url')))
    for w, f, vals, _ in charts:
        missing = sorted({v for s in vals for v in s if not pool.found(float(v), decimals_of(v), derived=False)})
        if missing:
            r.err(f'{w}.chart', f'數值 {", ".join(sv.format_number(v) for v in missing[:5])} 在事實單的 datasets 裡找不到'
                                '（圖表的每個數字都要對得回原始資料）')
        ch = f.get('chart') if isinstance(f.get('chart'), dict) else {}
        src_host = host_of((ch.get('source') if isinstance(ch.get('source'), dict) else {}).get('url'))
        if src_host and hosts - {None} and src_host not in hosts:
            r.warn(f'{w}.chart.source', f'來源網址的網域 {src_host} 和事實單 datasets 的來源（{"、".join(sorted(h for h in hosts if h))}）不同')


def chart_own_text(chart):
    """chart 自己的文字（標題、軸名與單位、附註）：裡面的數字（per 1,000、1990–2020）也算 chart 資料。"""
    if not isinstance(chart, dict):
        return []
    out = [chart.get('title'), chart.get('note')]
    for ax in ('x', 'y'):
        a = chart.get(ax) if isinstance(chart.get(ax), dict) else {}
        out += [a.get('label'), a.get('unit')]
    return [t for t in out if isinstance(t, str)]


CJK_PAREN_RE = re.compile(r'[（(][^（）()]*[\u3400-\u9fff][^（）()]*[）)]')
CJK_RE = re.compile(r'[\u3400-\u9fff]')


def english_only(text):
    """題幹裡的中文作答說明與配分標示（「（填充題，4分）」）不算「題目提到的數字」：去掉含中文的括號與含中文的行。"""
    t = CJK_PAREN_RE.sub(' ', text or '')
    return '\n'.join(line for line in t.split('\n') if not CJK_RE.search(line))


def check_rm_numbers(r, d, charts, tables, sheets):
    """文中與題目提到的數字都要查得到（圖表、表格、事實單）；圖的文字描述裡的數字要和 chart 資料一致。"""
    g = d.get('group') or {}
    for w, f, vals, cats in charts:
        cp = NumberPool()
        cp.add_table(vals)
        for c in cats + chart_own_text(f.get('chart')):
            if isinstance(c, str):
                cp.add_text(c)
        texts = [('description', f.get('description')), ('caption', f.get('caption'))]
        texts += [(f'rows[{i}]', ' '.join(c for c in row if isinstance(c, str))) for i, row in enumerate(rm_list(f.get('rows')))
                  if isinstance(row, list)]
        for key, text in texts:
            for v, dd, s in numbers_in(text or ''):
                if not cp.found(v, dd):
                    r.err(f'{w}.{key}', f'提到的數字 {s} 和 chart 資料對不上（圖的文字描述必須和 chart 一致）')
    pool = NumberPool()
    for _, f, vals, cats in charts:
        pool.add_table(vals)
        for c in cats + chart_own_text(f.get('chart')):
            if isinstance(c, str):
                pool.add_text(c)
    for _, rows in tables:
        for row in rows:
            for c in row:
                pool.add_text(c)
    for _, _, sheet in sheets:
        sheet_numbers(sheet, pool)
    tags = g.get('tags') if isinstance(g.get('tags'), dict) else {}
    pool.values.update(float(n) for n in rm_list(tags.get('sdgs')) if ve.is_int(n))
    has_data = bool(charts or tables)
    if not has_data and not sheets:
        return
    report_text = r.err if has_data else r.warn
    where_texts = [('group.passage', g.get('passage'))]
    where_texts += [(f'group.passage_parts[{i}]', p.get('text')) for i, p in enumerate(rm_list(g.get('passage_parts')))
                    if isinstance(p, dict)]
    where_texts += [(f'group.q{q.get("no")}.stem', english_only(q.get('stem'))) for q in questions_of(d)]
    origin = '圖表資料、表格與事實單' if has_data else '事實單'
    for where, text in where_texts:
        seen = set()
        for v, dd, s in numbers_in(text or ''):
            if s in seen or pool.found(v, dd):
                continue
            seen.add(s)
            report_text(where, f'提到的數字 {s} 在{origin}裡都查不到（衍生的數字請寫進事實單）')
    for q in questions_of(d):
        for k, text in sorted((q.get('options') or {}).items()) if isinstance(q.get('options'), dict) else []:
            for v, dd, s in numbers_in(text if isinstance(text, str) else ''):
                if not pool.found(v, dd):
                    r.warn(f'group.q{q.get("no")}.options.{k}', f'選項提到的數字 {s} 在{origin}裡查不到（誘答故意寫錯的數字可以忽略）')


def check_rm_items(r, d):
    """解析的擴充欄位：各自用在哪種作答模式、格式（README §3.3）。"""
    items = rm_explanation_items(d)
    st = d.get('section_type')
    hay = evidence_haystacks(d)
    for q in questions_of(d):
        no = str(q.get('no'))
        it = items.get(no)
        if not isinstance(it, dict):
            continue
        w = f'annotations.explanations.items.{no}'
        mode = q.get('mode') if isinstance(q.get('mode'), str) else None
        for key, modes in RM_EXPLANATION_EXTRA.items():
            if key in it and mode not in modes:
                r.err(w, f'{key} 只用在 {"／".join(modes)} 小題（本題是 {mode}）')
        pool = option_pool(d, q)
        keys = answer_keys(q)
        codes = it.get('option_codes')
        if 'option_codes' in it and mode in ('single_choice', 'multi_select'):
            if not isinstance(codes, dict) or any(k not in pool for k in codes):
                r.err(w, 'option_codes 必須是 {選項代號: 代碼}，鍵是本題的選項代號')
            elif st == 'reading':
                for k, c in sorted(codes.items()):
                    if k in keys:
                        r.err(w, f'option_codes 只標錯誤選項；{k} 是正解')
                    elif c not in READING_OPTION_CODES:
                        r.err(w, f'option_codes.{k}={c!r} 不在出題規格書的誘答碼 {"／".join(READING_OPTION_CODES)}')
            else:
                for k in sorted(pool):
                    c = codes.get(k)
                    if k in keys and c not in MIXED_KEY_CODES:
                        r.err(w, f'多選正解 {k} 要標 E1／E2（目前 {c!r}）')
                    elif k not in keys and c not in MIXED_DISTRACTOR_CODES:
                        r.err(w, f'多選誤選 {k} 要標 {"／".join(MIXED_DISTRACTOR_CODES)}（目前 {c!r}）')
        ev = it.get('option_evidence')
        if 'option_evidence' in it and mode in ('single_choice', 'multi_select'):
            if not isinstance(ev, dict) or any(k not in pool for k in ev):
                r.err(w, 'option_evidence 必須是 {選項代號: [逐字證據句…]}')
            else:
                for k, evs in sorted(ev.items()):
                    if not (isinstance(evs, list) and evs and all(ve.nonempty_str(e) for e in evs)):
                        r.err(w, f'option_evidence.{k} 必須是非空的字串陣列')
                        continue
                    for e in evs:
                        if not evidence_found(e, hay):
                            r.err(w, f'option_evidence.{k}「{e[:60]}」在選文裡找不到（必須逐字引用）')


def check_rm_common(r, d):
    sheets = check_provenance_facts(r, d)
    charts, tables = check_rm_figures(r, d)
    check_chart_datasets(r, d, charts, sheets)
    check_rm_numbers(r, d, charts, tables, sheets)
    check_rm_items(r, d)
    return charts, tables


def reading_form(g):
    """閱讀的文本形式（批次規格 form_quota 的分類）：有 chart＝chart、有表格＝table、passage_parts ≥2＝multi_text、其他＝continuous。"""
    figs = [f for f in (g or {}).get('figures') or [] if isinstance(f, dict)]
    if any('chart' in f or f.get('kind') in ('chart', 'graph') for f in figs):
        return 'chart'
    if any(f.get('kind') == 'table' for f in figs):
        return 'table'
    if len((g or {}).get('passage_parts') or []) >= 2:
        return 'multi_text'
    return 'continuous'


def mixed_form(g):
    """混合題的文本形式（批次規格 form_quota）：passage_parts 2 篇＝two_texts、3 則以上＝entries、其他＝single。"""
    n = len((g or {}).get('passage_parts') or [])
    return 'two_texts' if n == 2 else ('entries' if n >= 3 else 'single')


def count_words(text):
    return len(WORD_TOKEN_RE.findall(ve.strip_markup(text))) if isinstance(text, str) else 0


def check_reading(r, d):
    charts, tables = check_rm_common(r, d)
    tier = d.get('tier') if isinstance(d.get('tier'), str) else None
    rule = tiers_spec()['item_rules']['reading'].get(tier)
    qs = questions_of(d)
    its = [q['tags'].get('item_type') if isinstance(q.get('tags'), dict) else None for q in qs]
    its = [x if isinstance(x, str) else None for x in its]
    if None in its:
        r.warn('group', '有小題沒有 tags.item_type，無法檢查 SPEC §3.5 的題型配比')
    elif rule:
        c = Counter(its)
        probs = []
        if tier == 'basic':
            detail = c['detail'] + c['not_mentioned'] + c['sequencing'] + c['chart_reading']
            if detail < 2:
                probs.append(f'細節（含讀圖、NOT、排序）{detail} 題，應 ≥2')
            if c['main_idea'] + c['title'] < 1:
                probs.append('沒有主旨題')
            if c['vocab_in_context'] + c['reference'] < 1:
                probs.append('沒有上下文詞義或指代題')
        elif tier == 'advanced':
            if c['reference'] < 1:
                probs.append('沒有指代題')
            if c['inference'] < 1:
                probs.append('沒有推論題')
        elif tier == 'top':
            n = c['inference'] + c['purpose'] + c['tone_attitude'] + c['chart_reading'] + c['synthesis']
            if n < 2:
                probs.append(f'推論、目的或態度、圖表整合合計 {n} 題，應 ≥2')
        if probs:
            r.warn('group', f'題型配比和 SPEC §3.5（{rule["summary_zh"]}）不同：{"；".join(probs)}'
                            '（出題規格書 05-reading.md §7 對此另有建議，這裡只提醒人工審核）')
    if (charts or tables) and 'chart_reading' not in its:
        r.warn('group', '題組有圖表或表格，卻沒有任何 item_type=chart_reading 的題目（要讀圖才能答的題目標 chart_reading）')
    letters = Counter(q.get('answer') for q in qs if isinstance(q.get('answer'), str))
    many = sorted(k for k, n in letters.items() if n > 2)  # noqa: C416
    if many:
        r.warn('group', f'同一篇的正解字母 {"、".join(many)} 出現 3 次以上（出題規格書 RD-FMT-03：同一篇同字母 ≤2）')


def check_fill(r, d, q, it, text, rule):
    """填充題（混合題 47–48 型）。回傳 (答案逐字在文中, 所有可接受答案都不在文中)。"""
    no = str(q.get('no'))
    w = f'group.q{no}'
    if f'[[{no}]]' not in (q.get('stem') or ''):
        r.err(w, f'填充題的題幹要有空格 [[{no}]]（兩格共用一個摘要句時，兩題的 stem 相同，各含 [[1]]、[[2]]）')
    ans = q.get('answer')
    if not (isinstance(ans, str) and SINGLE_WORD_RE.match(ans.strip())):
        r.err(w, f'填充題的答案必須是單一英文單詞（目前 {ans!r}；出題規格書 MIX-FIL-01）')
        return False, False
    acc = q.get('accepted_answers')
    if not (isinstance(acc, list) and acc):
        r.err(w, '可接受答案 accepted_answers 至少要 1 個（AI 題寫完整清單，含 answer 本身；SPEC §5.4）')
        acc = [ans]
    elif norm_answer(ans) not in {norm_answer(a) for a in acc}:
        r.err(w, 'accepted_answers 要包含 answer 本身（AI 題的 accepted_answers 是完整的可接受答案清單）')
    bad = [a for a in acc if not (isinstance(a, str) and SINGLE_WORD_RE.match(a.strip()))]
    if bad:
        r.err(w, f'accepted_answers 的每個答案都要是單一英文單詞：{bad}')
    tokens = WORD_TOKEN_RE.findall(text)
    src = it.get('source_token')
    if 'source_token' in it:
        if not (isinstance(src, str) and SINGLE_WORD_RE.match(src.strip())):
            r.err(w, f'source_token 必須是文中的一個英文單詞（目前 {src!r}）')
        elif not word_occurrences(text, src):
            r.err(w, f'source_token「{src}」不在文中（必須逐字，出題規格書 MIX-FIL-02）')
        elif not (related_strict(ans, src) or prefix_related(ans, src)):
            r.warn(w, f'答案「{ans}」和 source_token「{src}」看不出是同一詞目或字族，請確認是「變化字形」而不是換字')
    else:
        if not any(related_strict(ans, t) for t in tokens):
            pre = next((t for t in tokens if prefix_related(ans, t)), None)
            if pre:
                r.warn(w, f'答案「{ans}」的原形應該是文中的「{pre}」（只靠字首比對），請在解析寫 source_token')
            else:
                r.err(w, f'答案「{ans}」的原形（同一詞目或字族的任何詞形）在文中找不到；SPEC §5.4：填空答案的原形要出現在文中'
                         '（轉詞性的答案請在解析寫 source_token）')
    tf = it.get('transform')
    if 'transform' not in it or 'source_token' not in it:
        r.warn(w, '解析沒有 source_token、transform（出題規格書 MIX-FIL-02：每格宣告來源字與字形變化）')
    if 'transform' in it and tf not in FILL_TRANSFORMS:
        r.err(w, f'transform={tf!r} 必須是 {"／".join(FILL_TRANSFORMS)}')
    verbatim = word_occurrences(text, ans) > 0
    if tf == 'none' and not verbatim:
        r.warn(w, '宣告 transform=none，但答案不逐字在文中')
    elif tf in FILL_TRANSFORMS and tf != 'none' and verbatim:
        r.warn(w, f'宣告 transform={tf}，但答案「{ans}」逐字出現在文中')
    if rule and rule.get('fill_requires_pos_change') and tf not in ('pos_shift', 'pos_shift+inflection'):
        r.warn(w, f'{d.get("tier")} 的填空要轉詞性（SPEC §3.5），transform 應為 pos_shift／pos_shift+inflection（目前 {tf!r}）')
    pcf = it.get('partial_credit_forms')
    if 'partial_credit_forms' in it and not (isinstance(pcf, list) and all(ve.nonempty_str(x) for x in pcf)):
        r.err(w, 'partial_credit_forms 必須是字串陣列（選字對、字形錯給 1 分的寫法；SPEC §4.6）')
    elif isinstance(pcf, list) and {norm_answer(x) for x in pcf} & {norm_answer(a) for a in acc}:
        r.err(w, 'partial_credit_forms 不可和 accepted_answers 重疊（一個是 1 分、一個是全分）')
    iw = it.get('interchangeable_with')
    fills = {x.get('no') for x in questions_of(d) if x is not q and x.get('mode') == 'fill_in_blank' and ve.is_int(x.get('no'))}
    if 'interchangeable_with' in it and iw is not None and not (ve.is_int(iw) and iw in fills):
        r.err(w, f'interchangeable_with={iw!r} 必須是另一格填充題的題號或 null')
    all_absent = not any(word_occurrences(text, a) for a in acc if isinstance(a, str))
    return verbatim, all_absent


def check_multi(r, d, q, it, rule):
    no = str(q.get('no'))
    w = f'group.q{no}'
    tier = d.get('tier')
    opts = q.get('options') if isinstance(q.get('options'), dict) else {}
    n = len(opts)
    if n not in MULTI_SELECT_OPTION_COUNTS:
        r.err(w, f'多選題的選項數必須是 6／8／10（SPEC §5.4；目前 {n}）')
    rng = (rule or {}).get('multi_select_options') or {}
    if n and ((rng.get('min') is not None and n < rng['min']) or (rng.get('max') is not None and n > rng['max'])):
        r.warn(w, f'{tier} 的多選選項數 SPEC §3.5 是 {rng.get("min")}–{rng.get("max")}（目前 {n}）')
    ans = q.get('answer')
    if not isinstance(ans, list):
        r.err(w, f'多選題的 answer 必須是選項代號陣列，例如 ["B", "E"]（目前 {ans!r}）')
        return
    if not all(isinstance(x, str) for x in ans):
        r.err(w, f'多選題的 answer 必須是選項代號（字串）陣列（目前 {ans!r}）')
        return
    if len(set(ans)) != len(ans):
        r.err(w, f'多選題的答案有重複代號：{ans}')
    if ans != sorted(ans):
        r.warn(w, f'多選題的答案請依字母排序（目前 {ans}）')
    k = len(set(ans))
    if not 2 <= k <= 4:
        r.err(w, f'多選題要有 2–4 個正解（出題規格書 MIX-FMT-02；目前 {k}）')
    elif n and not 0.25 - 1e-9 <= k / n <= 0.5 + 1e-9:
        r.warn(w, f'正解比例 {k}/{n} 不在 .25–.50（出題規格書 MIX-FMT-02）')
    codes = it.get('option_codes')
    if not isinstance(codes, dict):
        r.warn(w, '解析沒有 option_codes（正解標 E1／E2、誤選標 PT／CT／NM／PL／ST／ST*；出題規格書 MIX-MUL-01／02）')
    else:
        tricky = sum(1 for L, c in codes.items() if L not in ans and isinstance(c, str) and c in ('PL', 'ST*'))
        e2 = sum(1 for L, c in codes.items() if L in ans and c == 'E2')
        if tier == 'basic' and tricky:
            r.warn(w, '穩定基礎的多選不放 PL／ST* 型誤選（出題規格書 MIX-MUL-02）')
        elif tier == 'advanced' and tricky != 1:
            r.warn(w, f'進階練習的多選恰好放 1 個 PL 或 ST* 型誤選（目前 {tricky}）')
        elif tier == 'top' and (tricky < 1 or e2 < 2):
            r.warn(w, f'超越頂標的多選至少 1 個 PL／ST* 誤選、至少 2 個 E2 正解（目前 {tricky}、{e2}）')
    parts = [p for p in rm_list((d.get('group') or {}).get('passage_parts')) if isinstance(p, dict)]
    labels = {ve.strip_markup(x).strip().lower() for p in parts for x in (p.get('label'), p.get('title')) if isinstance(x, str)}
    texts = [ve.strip_markup(v).strip() for v in opts.values() if isinstance(v, str)]
    if texts and not all(t.lower() in labels for t in texts):
        off = [t for t in texts if not 4 <= count_words(t) <= 12]
        if off:
            r.warn(w, f'多選選項要嘛都是 4–12 字的敘述句，要嘛都是 passage_parts 的標籤（出題規格書 MIX-FMT-03）：{off[:2]}')


def check_short(r, d, q, it, text, rule):
    no = str(q.get('no'))
    w = f'group.q{no}'
    if not ve.nonempty_str(q.get('stem')):
        r.err(w, '簡答題缺少題幹 stem')
    ans = q.get('answer')
    if not ve.nonempty_str(ans):
        r.err(w, '簡答題的 answer 必須是非空字串')
        return
    acc = q.get('accepted_answers')
    if not (isinstance(acc, list) and acc and all(ve.nonempty_str(a) for a in acc)):
        r.err(w, '可接受答案 accepted_answers 至少要 1 個（AI 題寫完整清單，含 answer 本身；SPEC §5.4）')
    elif norm_answer(ans) not in {norm_answer(a) for a in acc}:
        r.err(w, 'accepted_answers 要包含 answer 本身（AI 題的 accepted_answers 是完整的可接受答案清單）')
    occ = word_occurrences(text, ans.strip().rstrip('.'))
    if occ == 0:
        r.err(w, f'簡答答案「{ans}」必須逐字出現在文中（SPEC §5.4）')
    elif occ > 1:
        r.warn(w, f'簡答答案「{ans}」在文中出現 {occ} 次（出題規格書 MIX-SHO-01：只出現一次）')
    rng = (rule or {}).get('short_answer_words') or {}
    nw = len(ans.split())
    if (rng.get('min') is not None and nw < rng['min']) or (rng.get('max') is not None and nw > rng['max']):
        r.warn(w, f'{d.get("tier")} 的簡答答案 SPEC §3.5 是 {rng.get("min")}–{rng.get("max") or ""} 個字（目前 {nw}）')


def check_mixed(r, d):
    check_rm_common(r, d)
    tier = d.get('tier') if isinstance(d.get('tier'), str) else None
    rule = tiers_spec()['item_rules']['mixed'].get(tier)
    qs = questions_of(d)
    items = rm_explanation_items(d)
    modes = [q.get('mode') for q in qs]
    if modes != MIXED_MODE_ORDER:
        r.warn('group', f'混合題的子題依序是 填充、填充、多選、簡答（出題規格書 MIX-FMT-01；目前 {modes}）')
    elif [q.get('points') for q in qs] != MIXED_POINTS:
        r.warn('group', f'配分應為 {MIXED_POINTS}（填充各 2、多選 4、簡答 2；目前 {[q.get("points") for q in qs]}）')
    text = group_plain_text(d)
    verbatim, absent = [], []
    fills = [q for q in qs if q.get('mode') == 'fill_in_blank']
    for q in qs:
        it = items.get(str(q.get('no'))) if isinstance(items.get(str(q.get('no'))), dict) else {}
        mode = q.get('mode')
        if mode == 'fill_in_blank':
            v, a = check_fill(r, d, q, it, text, rule)
            if v:
                verbatim.append(str(q.get('no')))
            absent.append(a)
        elif mode == 'multi_select':
            check_multi(r, d, q, it, rule)
        elif mode == 'short_answer':
            check_short(r, d, q, it, text, rule)
        elif mode == 'table_completion':
            r.warn(f'group.q{q.get("no")}', '表格填寫題（table_completion）目前只做共通檢查（第一批不使用）')
            if not q.get('answer_table'):
                r.err(f'group.q{q.get("no")}', '表格填寫題要有 answer_table')
    need = ((rule or {}).get('fill_blanks_inflected') or {}).get('min') or 0
    allowed = max(0, len(fills) - need)
    if len(verbatim) > allowed:
        r.err('group', f'填空第 {"、".join(verbatim)} 格的答案逐字出現在文中；{tier} 至少 {need} 格要變字形'
                       '（SPEC §3.5；§5.4：填空答案本身不出現在文中）')
    if fills and not any(absent):
        r.err('group', '填空至少要有 1 格「所有可接受答案都不逐字出現在文中」（出題規格書 MIX-FIL-03）')
    g = d.get('group') or {}
    parts = [p for p in rm_list(g.get('passage_parts')) if isinstance(p, dict)]
    pw = [count_words(p.get('text')) for p in parts]
    if not ((len(parts) == 2 and all(120 <= x <= 200 for x in pw)) or (6 <= len(parts) <= 10 and all(15 <= x <= 70 for x in pw))):
        r.warn('group', f'選文結構建議是雙文本各 120–200 字，或 6–10 則短段落各 15–70 字（出題規格書 MIX-PAS-03；目前 {len(parts)} 篇 {pw} 字）')
    intro = count_words(g.get('passage'))
    if not 35 <= intro <= 80:
        r.warn('group', f'引言（passage）建議 35–80 字，說明情境與比較主題（出題規格書 MIX-PAS-02；目前 {intro} 字）')


# ---------------------------------------------------------------------------
# 中譯英、作文（SPEC §3.5、§5.4、§5.7、§6.8、§6.9；README §3.5–3.7；出題規格書 data/exams/generation-spec/writing.json）
# ---------------------------------------------------------------------------
# 規則來源分兩級：SPEC（§3.5 的難度規則、§5.4 的檢查清單）不符是 error；出題規格書比 SPEC 細的參數（字數、詞彙負荷、
# 範文的篇章指標）不符只列 warning（SPEC §5.8：任何 warning 都進 100% 人工審核），和閱讀題的做法相同。

WRITING_TYPES = ('translation', 'composition')
WRITING_SPEC = ROOT / 'data' / 'exams' / 'generation-spec' / 'writing.json'
GRAMMAR_PATTERNS = ROOT / 'data' / 'curriculum' / 'grammar-patterns.json'
PARSED_DIR = ROOT / 'data' / 'exams' / 'parsed'
SPEC_TIER_KEY = {'basic': 'foundation', 'advanced': 'advanced', 'top': 'beyond_top'}

# 中譯英
TRANSLATION_POINTS = 4            # 每句 4 分（SPEC §4.6；writing.ts isAiGradableTranslation）
TRANSLATION_PARTS = 4             # 每句切 4 個評分部分，各 1 分
TRANSLATION_STRUCTURE_CODES = ('PERF', 'PASS', 'COMP', 'PART', 'NFSUBJ', 'ADVCL', 'REL', 'NRREL', 'PURP', 'VOC',
                               'PREPVING', 'PARA', 'CORR', 'NCL', 'PROG', 'PASTPERF', 'BASIC')
TRANSLATION_TRAP_TYPES = ('tense_trigger', 'plural_countable', 'collocation', 'word_form', 'subjectless',
                          'prenominal_modifier', 'verbal_subject', 'abstract_nominal', 'redundancy')
# 句型分類「倒裝、假設、強調」只能放加分寫法（SPEC §3.5、出題規格書 WRT-TRN-STR-02）
BONUS_ONLY_CATEGORIES = ('倒裝', '假設', '強調')
# SPEC §3.5 超越頂標的指定句型：非限定關係子句、句尾分詞表結果、no matter＋wh-、what 子句（出題規格書另含 whether 子句）
TOP_TRANSLATION_GRAMMAR_IDS = ('gp-nonrestrictive', 'gp-participle-result', 'gp-no-matter', 'gp-what-clause', 'gp-wh-clause')
# 能用程式在參考譯文裡比對的句構：嚴格（找不到就是 error）與粗略（找不到只列 warning）；VOC、BASIC 不比對
STRICT_STRUCTURES = ('PERF', 'PASTPERF', 'PROG', 'PASS', 'COMP', 'CORR', 'NRREL', 'PREPVING', 'ADVCL')
LOOSE_STRUCTURES = ('PURP', 'NFSUBJ', 'REL', 'PARA', 'NCL', 'PART')
TRANSLATION_RUBRIC_ITEM_KEYS = ({'references', 'target_words', 'patterns', 'parts', 'traps', 'bonus'},
                                {'restructuring_zh', 'notes_zh'})
TARGET_WORD_KEYS = ({'word', 'zh'}, {'alternatives'})
PATTERN_KEYS = ({'code', 'grammar_id', 'label_zh', 'frame', 'zh_trigger'}, set())
PART_KEYS = ({'zh', 'accepted', 'targets', 'common_errors'}, set())
COMMON_ERROR_KEYS = ({'wrong', 'explanation_zh'}, {'right'})
TRAP_KEYS = ({'type', 'zh', 'literal_error', 'part', 'explanation_zh'}, set())
BONUS_KEYS = ({'text', 'explanation_zh'}, {'grammar_id'})

# 作文
COMPOSITION_POINTS = 20
COMPOSITION_MIN_WORDS = 120
COMPOSITION_PARAGRAPHS = 2
MODEL_TEXT_LABELS = ('steady', 'top')                       # 穩健版、頂標版
MODEL_TEXT_TARGETS = {'steady': (14, 17), 'top': (18, 20)}   # SPEC §5.7：評分代理給分要落在這裡（四項加總，滿分 20）
MODEL_TEXT_SPEC_KEY = {'steady': 'foundation', 'top': 'beyond_top'}   # 出題規格書 tiers.*.model_essay 的參數
MODEL_TEXT_CRITERIA = ('content', 'organization', 'grammar', 'vocabulary')   # 同 writing.ts 的 ESSAY_CRITERIA
CRITERION_LABELS = {'content': '內容', 'organization': '組織', 'grammar': '文法句構', 'vocabulary': '字彙拼字'}
NOTE_KINDS = ('connective', 'detail', 'experience', 'pattern', 'phrase')
CONNECTIVE_FUNCTIONS = ('sequence', 'addition', 'cause_effect', 'contrast', 'example', 'conclusion')
# SPEC §5.4（07 §6.2）的 5 種功能：列舉或時序、因果、轉折或讓步、舉例、結論；addition（補充）不算在這 ≥4 種裡
SPEC_CONNECTIVE_FUNCTIONS = ('sequence', 'cause_effect', 'contrast', 'example', 'conclusion')
COMPOSITION_PROMPT_TYPES = ('picture_scene', 'topic_experience', 'picture_issue', 'letter', 'topic_opinion',
                            'picture_issue_abstract', 'chart', 'social_phenomenon')
MOVE_CODES = ('describe', 'compare', 'explain_function', 'describe_data', 'select_one',
              'personal_experience', 'preference_reasons', 'simple_plan', 'ideal_design', 'experience_solution',
              'imagined_plan', 'opinion', 'reasons', 'effects', 'evaluate', 'propose', 'compare_self', 'concede_rebut')
EXPERIENCE_MOVES = ('personal_experience', 'experience_solution', 'compare_self')
VIEW_MOVES = ('opinion', 'reasons', 'effects', 'evaluate', 'propose', 'concede_rebut', 'preference_reasons')
SCAFFOLD_KINDS = ('outline+sentence_starters', 'outline', 'checklist')
COMPOSITION_FIGURE_KINDS = ('picture', 'illustration', 'diagram', 'chart', 'table', 'poster', 'map', 'comic')
COMPOSITION_FIGURE_KEYS = (set(ve.FIGURE_KEYS[0]), set(ve.FIGURE_KEYS[1]) | {'svg'})
COMPOSITION_RUBRIC_KEYS = ({'kind', 'prompt_type', 'moves', 'criteria', 'deductions_zh', 'scaffold'}, set())
MOVE_KEYS = ({'paragraph', 'code', 'zh'}, set())
CRITERION_KEYS = ({'focus_zh', 'bands'}, set())
BAND_KEYS = ({'min', 'max', 'descriptor_zh'}, set())
MODEL_TEXT_KEYS = ({'label', 'text', 'paragraphs', 'notes', 'self_assessment'}, set())
MODEL_PARAGRAPH_KEYS = ({'function_zh', 'topic_sentence'}, set())
NOTE_KEYS = ({'kind', 'text', 'zh'}, {'function'})
SELF_ASSESSMENT_KEYS = ({'scores', 'explanation_zh'}, set())
SCAFFOLD_KEYS = {
    'outline+sentence_starters': ({'kind', 'planning_map', 'outline', 'sentence_starters'}, set()),
    'outline': ({'kind', 'outline'}, set()),
    'checklist': ({'kind', 'checklist_zh'}, set()),
}
OUTLINE_KEYS = ({'paragraph', 'topic_sentence_zh', 'details_zh'}, {'closing_zh'})
PLANNING_MAP_KEYS = ({'center_zh', 'branches'}, set())
BRANCH_KEYS = ({'label_zh', 'prompt_zh'}, set())
SVG_MAX_CHARS = 30000
# D8：參考譯文、範文和歷屆官方參考譯文（data/exams/parsed）不可有 8 字以上相同字串；評分規準的中文不可重製評分原則原文
OFFICIAL_NGRAM = 8
OFFICIAL_HAN_RUN = 8
STEM_HAN_RUN_ERROR = 10           # 中譯英題幹和歷屆題幹連續相同 10 個漢字以上：太接近原題
STEM_HAN_RUN_WARN = 8
COMPOSITION_STEM_HAN_RUN_WARN = 12

EN_WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)*")
HAN_RUN_RE = re.compile(r'[㐀-鿿]+')
GLOSS_RE = re.compile(r'[（(]([^（）()]*[A-Za-z][^（）()]*)[）)]')
PLACEHOLDERS = {'sb', 'sth', "one's", 'someone', 'something', 'somebody', '...', '…', 'sb.', 'sth.'}
FUNCTION_POS = {'preposition', 'conjunction', 'pronoun', 'determiner', 'interjection'}
AUX_WORDS = {'be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
             'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'not', "n't"}
ADV_FILLERS = {'not', 'never', 'already', 'just', 'ever', 'always', 'also', 'recently', 'long', 'still', 'even', 'really',
               'all', 'both', 'often', 'gradually', 'finally', 'only', 'now', 'once', 'since', 'mostly', 'largely', 'widely',
               'increasingly', 'certainly', 'probably', 'usually', 'sometimes', 'rarely', 'seldom', 'hardly', 'slowly',
               'quickly', 'greatly', 'deeply', 'gradually', 'steadily', 'actually', 'truly', 'simply', 'easily', 'n\'t'}
BE_FORMS = {'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "'re", "'m"}
GET_FORMS = {'get', 'gets', 'got', 'gotten', 'getting'}
HAVE_FORMS = {'have', 'has', "'ve"}
ING_STOP = {'thing', 'something', 'nothing', 'anything', 'everything', 'morning', 'evening', 'during', 'king', 'ring',
            'spring', 'string', 'wing', 'bring', 'sing', 'ceiling', 'nothing', 'sibling', 'awning', 'pudding', 'ping'}
PREPOSITIONS = {'by', 'without', 'after', 'before', 'of', 'for', 'in', 'on', 'about', 'from', 'at', 'with', 'besides',
                'despite', 'through', 'against', 'into', 'upon', 'like', 'than', 'instead', 'to', 'beyond', 'toward',
                'towards', 'via', 'regarding', 'including', 'concerning'}
SUBORDINATORS = ('when', 'while', 'if', 'because', 'although', 'though', 'once', 'before', 'after', 'since', 'until',
                 'till', 'unless', 'whenever', 'wherever', 'as soon as', 'even if', 'even though', 'no matter',
                 'as long as', 'so that', 'now that', 'in case', 'whereas', 'as if', 'as though', 'despite', 'in spite of')
NEGATIVE_INVERSION_RE = re.compile(
    r"(^|[.!?]\s+|\n)(never|seldom|rarely|hardly|scarcely|little|not only|not until .{1,60}?|only (?:when|after|if|by|then|in|through) .{1,60}?|no sooner|under no circumstances|nowhere|in no way)"
    r",?\s+(do|does|did|have|has|had|is|are|was|were|can|could|will|would|should|must|may|might)\s+\w+", re.I)
SUBJUNCTIVE_RE = re.compile(r"\bif\b[^.?!]{1,80}\b(were|had)\b[^.?!]{1,80}\b(would|could|might)\s+(have\s+)?\w+|\bi wish\b|"
                            r"^(were|had|should)\s+\w+\s+[^.?!]{1,60},", re.I | re.M)
# 範文的轉承詞：grammar-patterns.json 的 connectives 之外再加常見寫法（不在清單只列 warning，提醒確認標註）
EXTRA_CONNECTIVES = {
    'first', 'first of all', 'firstly', 'second', 'secondly', 'third', 'thirdly', 'then', 'next', 'finally', 'lastly',
    'to begin with', 'last but not least', 'after that', 'afterward', 'afterwards', 'later', 'at first', 'in the end',
    'eventually', 'meanwhile', 'also', 'besides', 'in addition', 'moreover', 'furthermore', "what's more", 'what is more',
    'however', 'but', 'yet', 'still', 'although', 'though', 'even though', 'while', 'whereas', 'on the other hand',
    'nevertheless', 'nonetheless', 'instead', 'in contrast', 'on the contrary', 'because', 'because of', 'since', 'as',
    'so', 'therefore', 'thus', 'hence', 'as a result', 'consequently', 'due to', 'thanks to', 'that is why',
    'this is why', 'for this reason', 'for example', 'for instance', 'such as', 'like', 'take', 'in conclusion',
    'to sum up', 'all in all', 'in short', 'overall', 'in summary', 'to conclude', 'above all', 'in fact', 'indeed',
    'as a matter of fact', 'from then on', 'since then', 'at the same time', 'in other words', 'that is', 'otherwise',
    'once', 'when', 'after', 'before', 'as soon as', 'unless', 'if', 'even if', 'not only', 'but also',
    'what is more', 'to be honest', 'personally', 'in my opinion', 'as far as i am concerned', 'admittedly',
    'of course', 'no wonder', 'as for', 'apart from', 'except for', 'in the long run', 'by contrast', 'similarly',
    'likewise', 'in the same way', 'as well', 'not to mention', 'worse still', 'to make matters worse', 'what\'s worse',
    'in the beginning', 'at last', 'from that day on', 'ever since', 'until', 'so that', 'in order to', 'as long as',
    'whenever', 'every time', 'the moment', 'as a consequence', 'on top of that', 'in turn',
}

_writing_spec = None
_grammar = None
_official = None


def writing_spec():
    global _writing_spec
    if _writing_spec is None:
        _writing_spec = load_json(WRITING_SPEC) if WRITING_SPEC.exists() else {}
    return _writing_spec


def writing_tier_spec(tier, section):
    """出題規格書 tiers.{foundation|advanced|beyond_top}.{translation|composition|model_essay}；沒有回傳 {}。"""
    t = (writing_spec().get('tiers') or {}).get(SPEC_TIER_KEY.get(tier, ''), {})
    out = t.get(section) if isinstance(t, dict) else None
    return out if isinstance(out, dict) else {}


def grammar_patterns():
    """grammar-patterns.json：(id → pattern, 轉承詞集合)。"""
    global _grammar
    if _grammar is None:
        d = load_json(GRAMMAR_PATTERNS) if GRAMMAR_PATTERNS.exists() else {}
        pats = {p.get('id'): p for p in d.get('patterns') or [] if isinstance(p, dict) and p.get('id')}
        conns = {str(c.get('word', '')).lower().strip() for c in d.get('connectives') or [] if isinstance(c, dict)}
        _grammar = (pats, {c for c in conns if c} | EXTRA_CONNECTIVES)
    return _grammar


# 句型 id → 句構代碼（不一致只列 warning：一個句型可能同時帶出兩種句構）
GRAMMAR_CODE = {
    'gp-present-perfect': 'PERF', 'gp-present-perfect-progressive': 'PERF', 'gp-perfect-passive': 'PERF',
    'gp-past-perfect': 'PASTPERF', 'gp-progressive-trend': 'PROG', 'gp-passive': 'PASS', 'gp-perception-passive': 'PASS',
    'gp-be-said-to': 'PASS', 'gp-comparative-superlative': 'COMP', 'gp-the-more': 'COMP', 'gp-more-and-more': 'COMP',
    'gp-as-as': 'COMP', 'gp-times': 'COMP', 'gp-compared-with': 'COMP', 'gp-infinitive-purpose': 'PURP',
    'gp-so-that-purpose': 'PURP', 'gp-gerund-subject': 'NFSUBJ', 'gp-it-adj-to': 'NFSUBJ',
    'gp-relative-pronoun': 'REL', 'gp-relative-adverb': 'REL', 'gp-for-those-who': 'REL', 'gp-nonrestrictive': 'NRREL',
    'gp-prep-gerund': 'PREPVING', 'gp-to-ving': 'PREPVING', 'gp-despite': 'PREPVING', 'gp-parallelism': 'PARA',
    'gp-time-clause': 'ADVCL', 'gp-condition-real': 'ADVCL', 'gp-concession-clause': 'ADVCL', 'gp-because': 'ADVCL',
    'gp-no-matter': 'ADVCL', 'gp-so-such-that': 'ADVCL', 'gp-participle-clause': 'PART', 'gp-participle-result': 'PART',
    'gp-conj-participle': 'PART', 'gp-participle-modifier': 'PART', 'gp-that-clause': 'NCL', 'gp-wh-clause': 'NCL',
    'gp-what-clause': 'NCL', 'gp-wh-to': 'NCL', 'gp-it-adj-that': 'NCL', 'gp-not-only-but-also': 'CORR',
    'gp-not-but': 'CORR', 'gp-either-neither': 'CORR', 'gp-svoc': 'VOC', 'gp-v-o-to-v': 'VOC', 'gp-regard-as': 'VOC',
    'gp-causative': 'VOC', 'gp-have-o-pp': 'VOC', 'gp-perception-verb': 'VOC', 'gp-find-it': 'VOC',
}


def count_english_words(text):
    """英文字數（同 writing.ts 的 countEnglishWords）：以空白切開，含字母或數字的片段算一個字。"""
    return sum(1 for tok in (text or '').split() if re.search(r'[A-Za-z0-9]', tok))


def paragraphs_of(text):
    """段落（同 writing.ts 的 countParagraphs）：有空白行就以空白行分段，否則每個非空白行算一段。"""
    t = (text or '').replace('\r\n', '\n').replace('\r', '\n').strip()
    if not t:
        return []
    blocks = re.split(r'\n[ \t]*\n+', t) if re.search(r'\n[ \t]*\n', t) else t.split('\n')
    return [b.strip() for b in blocks if b.strip()]


def en_tokens(text):
    t = ve.strip_markup(text or '').lower().replace('’', "'").replace('‘', "'")
    return EN_WORD_RE.findall(t)


def norm_en(text):
    """比對用：小寫、統一引號、去標點、壓縮空白。"""
    return ' '.join(en_tokens(text))


def han_count(text):
    """只計漢字（題幹括號附的英文不算）。"""
    return sum(len(x) for x in HAN_RUN_RE.findall(text or ''))


def official_corpus():
    """data/exams/parsed 的官方英文參考譯文（answer、accepted_answers、answer_variants、answer_segments 展開）的 8 字串，
    評分說明（scoring_notes）的 8 個漢字串，以及中譯英、作文的題幹。結果快取。"""
    global _official
    if _official is not None:
        return _official
    en, han, tr_stems, cp_windows = {}, {}, [], {}
    for p in sorted(PARSED_DIR.glob('*.json')) if PARSED_DIR.exists() else []:
        try:
            exam = load_json(p)
        except Exception:  # noqa: BLE001 — 歷屆檔案壞掉時由 validate_exam.py 回報
            continue
        eid = exam.get('id') or p.stem
        for s in exam.get('sections') or []:
            stype = s.get('type')
            if stype not in WRITING_TYPES:
                continue
            for g in s.get('groups') or []:
                for q in g.get('questions') or []:
                    where = f'{eid} {q.get("label")}'
                    notes = q.get('scoring_notes') or ''
                    for run in HAN_RUN_RE.findall(notes):
                        for i in range(len(run) - OFFICIAL_HAN_RUN + 1):
                            han.setdefault(run[i:i + OFFICIAL_HAN_RUN], where)
                    stem = q.get('stem') or ''
                    if stype == 'translation':
                        tr_stems.append((where, stem))
                        forms = {x for x in [q.get('answer')] + list(q.get('accepted_answers') or [])
                                 + list(q.get('answer_variants') or []) if isinstance(x, str)}
                        segs = q.get('answer_segments')
                        if isinstance(segs, list) and segs and all(isinstance(x, list) and x for x in segs):
                            for combo in itertools.product(*segs):
                                forms.add(ve.join_segments(list(combo)))
                        for f in forms:
                            toks = en_tokens(f)
                            for i in range(len(toks) - OFFICIAL_NGRAM + 1):
                                en.setdefault(' '.join(toks[i:i + OFFICIAL_NGRAM]), where)
                    else:
                        for run in HAN_RUN_RE.findall(stem):
                            for i in range(len(run) - COMPOSITION_STEM_HAN_RUN_WARN + 1):
                                cp_windows.setdefault(run[i:i + COMPOSITION_STEM_HAN_RUN_WARN], where)
                        # 作文的評分說明若有英文範文，一樣不可重製
                        for chunk in re.findall(r"[A-Za-z][A-Za-z ,.'’\-]{40,}", notes):
                            toks = en_tokens(chunk)
                            for i in range(len(toks) - OFFICIAL_NGRAM + 1):
                                en.setdefault(' '.join(toks[i:i + OFFICIAL_NGRAM]), where)
    _official = {'en': en, 'han': han, 'tr_stems': tr_stems, 'cp_stems': cp_windows}
    return _official


def official_en_overlap(text):
    """text 和官方英文參考譯文共有的第一個 8 字串：(字串, 出處) 或 None。"""
    en = official_corpus()['en']
    toks = en_tokens(text)
    for i in range(len(toks) - OFFICIAL_NGRAM + 1):
        k = ' '.join(toks[i:i + OFFICIAL_NGRAM])
        if k in en:
            return k, en[k]
    return None


def official_han_overlap(text):
    """text 和官方評分說明共有的連續 8 個漢字（只算不被標點隔開的漢字串）：(字串, 出處) 或 None。"""
    han = official_corpus()['han']
    for run in HAN_RUN_RE.findall(text or ''):
        for i in range(len(run) - OFFICIAL_HAN_RUN + 1):
            k = run[i:i + OFFICIAL_HAN_RUN]
            if k in han:
                j = i + OFFICIAL_HAN_RUN
                while j < len(run) and run[j - OFFICIAL_HAN_RUN + 1:j + 1] in han:
                    j += 1
                return run[i:j], han[k]
    return None


def longest_common_han(a, b):
    """兩段文字最長的共同漢字串（不跨標點）。"""
    best = ''
    for ra in HAN_RUN_RE.findall(a or ''):
        for rb in HAN_RUN_RE.findall(b or ''):
            prev = [0] * (len(rb) + 1)
            for i in range(1, len(ra) + 1):
                cur = [0] * (len(rb) + 1)
                for j in range(1, len(rb) + 1):
                    if ra[i - 1] == rb[j - 1]:
                        cur[j] = prev[j - 1] + 1
                        if cur[j] > len(best):
                            best = ra[i - cur[j]:i]
                prev = cur
    return best


def lemma_ids(token):
    ids = entry_ids(token)
    return ids | {tm.fold(token)}


def phrase_found(phrase, text):
    """phrase（單字或片語，可含 sb／sth／one's 佔位）以任一詞形出現在 text：逐字比對詞目（forms-index），佔位可跳過 0–3 個字。"""
    words = [w for w in re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\.\.\.|…", phrase or '')]
    pat = [None if w.lower().replace('’', "'") in PLACEHOLDERS else w for w in words]
    while pat and pat[0] is None:
        pat.pop(0)
    while pat and pat[-1] is None:
        pat.pop()
    if not pat:
        return False
    toks = re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*", ve.strip_markup(text or ''))
    keys = [lemma_ids(t) for t in toks]
    pkeys = [None if w is None else lemma_ids(w) for w in pat]

    def match(i, k):
        if k == len(pkeys):
            return True
        if pkeys[k] is None:
            return any(match(i + s, k + 1) for s in range(0, 4) if i + s <= len(toks))
        return i < len(toks) and bool(keys[i] & pkeys[k]) and match(i + 1, k + 1)

    return any(match(i, 0) for i in range(len(toks)))


def target_in(tw, text):
    """標的詞彙（或它的 alternatives 之一）出現在 text。"""
    cands = [tw.get('word')] + list(tw.get('alternatives') or [])
    return any(isinstance(c, str) and c.strip() and phrase_found(c, text) for c in cands)


def _types(word):
    return {t for ref in refs_of(word) for t in ref.get('types') or []}


def is_pp(word):
    w = word.lower()
    if w in ('been', 'born'):
        return True
    if 'past_participle' in _types(w):
        return True
    return w.endswith('ed') and len(w) > 4 and level_of_word(w) is not None


def is_ing(word):
    w = word.lower()
    if w in ING_STOP or not w.endswith('ing') or len(w) < 5:
        return False
    return 'present_participle' in _types(w) or level_of_word(w[:-3]) is not None or level_of_word(w[:-3] + 'e') is not None


def _next_content(toks, i, limit=3):
    """從 i 開始跳過副詞填充字（not、already…），回傳第一個不是填充字的位置。"""
    j, n = i, 0
    while j < len(toks) and n < limit and (toks[j] in ADV_FILLERS or (toks[j].endswith('ly') and len(toks[j]) > 4)):
        j += 1
        n += 1
    return j


def detect_structure(code, text):
    """參考譯文裡有沒有這個句構：True／False；沒有比對規則回傳 None（VOC、BASIC）。比對是保守的字面規則。"""
    raw = ve.strip_markup(text or '').replace('’', "'")
    low = raw.lower()
    toks = EN_WORD_RE.findall(low)
    if code in ('PERF', 'PASTPERF'):
        aux = HAVE_FORMS if code == 'PERF' else {'had', "'d"}
        for i, t in enumerate(toks):   # have/has/had（含情態助動詞＋have）＋（副詞）＋p.p.
            if t in aux:
                j = _next_content(toks, i + 1)
                if j < len(toks) and is_pp(toks[j]):
                    return True
        return False
    if code == 'PROG':
        for i, t in enumerate(toks):
            if t in BE_FORMS:
                j = _next_content(toks, i + 1)
                if j < len(toks) and is_ing(toks[j]):
                    return True
        return False
    if code == 'PASS':
        for i, t in enumerate(toks):
            if t in BE_FORMS or t in GET_FORMS:
                j = _next_content(toks, i + 1)
                if j < len(toks) and toks[j] != 'been' and is_pp(toks[j]):
                    return True
        return False
    if code == 'COMP':
        if any(t in ('than', 'more', 'less', 'most', 'least', 'fewer', 'fewest') for t in toks):
            return True
        if re.search(r'\bas\s+\w+(\s+\w+)?\s+as\b', low):
            return True
        return any(_types(t) & {'comparative', 'superlative'} for t in toks)
    if code == 'CORR':
        pairs = [('not only', 'but'), ('both', 'and'), ('either', 'or'), ('neither', 'nor'), ('whether', 'or'),
                 ('not', 'but'), ('rather than', ''), ('as well as', ''), ('instead of', '')]
        for a, b in pairs:
            m = re.search(rf'\b{a}\b', low)
            if m and (not b or re.search(rf'\b{b}\b', low[m.end():])):
                return True
        return False
    if code == 'NRREL':
        return bool(re.search(r",\s*(which|who|whom|whose|where|when)\b", low))
    if code == 'PREPVING':
        for i, t in enumerate(toks[:-1]):
            if t in PREPOSITIONS and is_ing(toks[i + 1]):
                if t == 'to' and not (i and toks[i - 1] in ('forward', 'used', 'addition', 'devoted', 'committed', 'contribute',
                                                         'contributes', 'contributed', 'key', 'object', 'opposed', 'adjust')):
                    continue
                return True
        return False
    if code == 'ADVCL':
        return any(re.search(rf'(^|[^a-z]){re.escape(s)}\b', low) for s in SUBORDINATORS)
    if code == 'PURP':
        if re.search(r'\b(in order to|so as to|so that|in order that)\b', low):
            return True
        return any(t == 'to' and i + 1 < len(toks) and 'verb' in (pos_of_word(toks[i + 1]) or set()) and not is_ing(toks[i + 1])
                   for i, t in enumerate(toks))
    if code == 'NFSUBJ':
        # 子句開頭（句首、逗號後、that／but／and／however 之後）是 V-ing 或 to＋原形，或虛主詞 It is … to
        starts = {0} | {i + 1 for i, t in enumerate(toks) if t in ('that', 'but', 'and', 'however', 'because', 'so', 'yet')}
        for m in re.finditer(r'[,;:]', low):
            starts.add(len(EN_WORD_RE.findall(low[:m.start()])))
        for i in sorted(starts):
            if i < len(toks) and (is_ing(toks[i]) or (toks[i] == 'to' and i + 1 < len(toks)
                                                      and 'verb' in (pos_of_word(toks[i + 1]) or set()))):
                if i + 1 < len(toks) and toks[i + 1] not in ('of', 'for'):
                    return True
        return bool(re.search(r"\bit\s+(is|was|has been|will be|can be|may be|seems|would be)\b[^.]{0,40}\bto\s+\w+", low))
    if code == 'REL':
        if re.search(r'\b(who|whom|whose|which)\b', low):
            return True
        for i, t in enumerate(toks):
            if t in ('that', 'where', 'when') and i and 'noun' in (pos_of_word(toks[i - 1]) or set()):
                return True
            # 省略關代：名詞＋代名詞主詞＋動詞（the joy they bring us）
            if i + 2 < len(toks) and 'noun' in (pos_of_word(t) or set()) and toks[i + 1] in ('i', 'you', 'we', 'they', 'he', 'she', 'people') \
                    and 'verb' in (pos_of_word(toks[i + 2]) or set()):
                return True
        return False
    if code == 'PARA':
        return any(t in ('and', 'or', 'but') for t in toks)
    if code == 'NCL':
        if re.search(r'\b(whether|what|how|why)\b', low):
            return True
        for i, t in enumerate(toks):
            if t in ('that', 'if', 'who', 'where', 'when', 'which') and i:
                prev = toks[i - 1]
                if prev in ('is', 'was', 'about', 'of', 'on', 'us', 'me', 'him', 'her', 'them', 'you', 'again') or \
                        (pos_of_word(prev) or set()) & {'verb', 'adjective'} and 'noun' not in (pos_of_word(prev) or set()):
                    return True
                if prev in ('know', 'knows', 'think', 'thinks', 'believe', 'believes', 'say', 'says', 'said', 'found', 'show',
                            'shows', 'showed', 'proves', 'proved', 'realize', 'realized', 'hope', 'feel', 'felt', 'learned'):
                    return True
        return False
    if code == 'PART':
        if toks and (is_ing(toks[0]) or is_pp(toks[0])) and ',' in raw:
            return True
        if any(is_pp(w) or is_ing(w) for w in re.findall(r",\s*(\w+)", low)):
            return True
        if re.search(r",\s*\w+ing\b", low) and any(is_ing(w) for w in re.findall(r",\s*(\w+ing)\b", low)):
            return True
        for i, t in enumerate(toks[:-1]):
            if t in ('when', 'while', 'after', 'before', 'once', 'if', 'though', 'although', 'unless', 'until') and \
                    (is_ing(toks[i + 1]) or is_pp(toks[i + 1])):
                return True
            if 'noun' in (pos_of_word(t) or set()) and (is_ing(toks[i + 1]) or is_pp(toks[i + 1])) and \
                    not (i and toks[i - 1] in BE_FORMS):
                return True
        return False
    return None


def content_levels(text, gloss_words=frozenset()):
    """參考譯文的實詞：[(token, level or None, 詞目鍵)]。去掉功能詞、專有名詞（句中大寫且不在詞表）、數字、題幹括號附的英文。"""
    raw = ve.strip_markup(text or '')
    out = []
    for i, m in enumerate(tm.TOKEN_RE.finditer(raw)):
        tok = m.group(0)
        low = tok.lower().replace('’', "'")
        if any(ch.isdigit() for ch in tok) or tm.is_number_word(tok) or low in gloss_words:
            continue
        lv = tm.token_level(tok)
        if lv is None and tok[:1].isupper() and i > 0:
            continue
        base = low.split("'")[0]
        if base in AUX_WORDS or base in ('a', 'an', 'the'):
            continue
        pos = pos_of_word(base)
        if pos and pos <= FUNCTION_POS:
            continue
        ids = entry_ids(base)
        key = sorted(ids)[0].split('|')[0] if ids else base
        out.append((tok, lv, key))
    return out


def svg_problems(svg):
    """作文看圖題的示意圖 SVG（ROADMAP D9：代理畫的簡單 SVG）。不可有腳本、事件屬性、外部連結、內嵌 HTML 或外部圖片。"""
    out = []
    if not isinstance(svg, str) or not svg.strip():
        return ['svg 必須是非空字串（完整的 <svg>…</svg>）']
    s = svg.strip()
    if len(s) > SVG_MAX_CHARS:
        out.append(f'svg 太長（{len(s)} 字元，上限 {SVG_MAX_CHARS}）')
    if not re.match(r'^<svg\b[^>]*>', s) or not s.endswith('</svg>'):
        out.append('svg 必須以 <svg …> 開頭、</svg> 結尾')
    head = re.match(r'^<svg\b([^>]*)>', s)
    if head and 'xmlns="http://www.w3.org/2000/svg"' not in head.group(1):
        out.append('svg 要有 xmlns="http://www.w3.org/2000/svg"')
    if head and 'viewBox' not in head.group(1):
        out.append('svg 要有 viewBox（前端依寬度縮放）')
    low = s.lower()
    for bad, why in (('<script', '腳本'), ('<foreignobject', '內嵌 HTML'), ('<image', '外部圖片'), ('<iframe', 'iframe'),
                     ('javascript:', 'javascript: 連結'), ('<!doctype', 'DOCTYPE'), ('<!entity', 'ENTITY'), ('<?xml', 'XML 宣告'),
                     ('<style', '樣式表（請用屬性）'), ('url(', '外部參照 url()')):
        if bad in low:
            out.append(f'svg 不可有{why}（{bad}）')
    if re.search(r'\son[a-z]+\s*=', low):
        out.append('svg 不可有事件屬性（onload、onclick…）')
    for m in re.finditer(r'(?:xlink:)?href\s*=\s*["\']([^"\']*)["\']', s):
        if not m.group(1).startswith('#'):
            out.append(f'svg 的 href 只能指向文件內的 #id（目前 {m.group(1)[:40]}）')
    if '\t' in s:
        out.append('svg 不可有 tab 字元（請用空白縮排）')
    return out


def tier_range_warn(r, where, label, value, rng, basis='出題規格書'):
    """出題規格書的區間（[min, max] 或 {min, max}）；不在區間列 warning。"""
    if rng is None or value is None:
        return
    if isinstance(rng, dict):
        lo, hi = rng.get('min'), rng.get('max')
    elif isinstance(rng, (list, tuple)) and len(rng) == 2:
        lo, hi = rng
    else:
        return
    if (lo is not None and value < lo - 1e-9) or (hi is not None and value > hi + 1e-9):
        shown = round(value, 3) if isinstance(value, float) else value
        r.warn(where, f'{label} {shown}，{basis}建議 {lo if lo is not None else ""}–{hi if hi is not None else ""}')


def writing_common(r, d):
    """中譯英、作文共用：題組主題、課綱、不可重製官方內容的提醒欄位。"""
    g = d.get('group') or {}
    tags = g.get('tags') if isinstance(g.get('tags'), dict) else {}
    if not ve.nonempty_str(tags.get('topic')):
        r.err('group', '題組缺少 tags.topic（批次規格的主題不重複檢查靠它）')
    a = d.get('annotations') if isinstance(d.get('annotations'), dict) else {}
    for key in ('guess_targets', 'open_tasks'):
        if a.get(key):
            r.warn(f'annotations.{key}', f'{d.get("section_type")} 不使用 {key}（應為 []）')
    if a.get('elimination') is not None:
        r.err('annotations.elimination', '只用在文意選填、篇章結構')


# --------------------------- 中譯英 ---------------------------

def rubric_items(d, kind):
    a = d.get('annotations') if isinstance(d.get('annotations'), dict) else {}
    rb = a.get('rubric')
    if not isinstance(rb, dict) or rb.get('kind') != kind:
        return None
    return rb


def check_translation(r, d):
    writing_common(r, d)
    tier = d.get('tier') if d.get('tier') in TIERS else None
    rule = tiers_spec()['item_rules']['translation'].get(tier) if tier else None
    sp = writing_tier_spec(tier, 'translation')
    g = d.get('group') or {}
    qs = questions_of(d)
    a = d.get('annotations') if isinstance(d.get('annotations'), dict) else {}
    if g.get('figures'):
        r.err('group.figures', '中譯英不用圖（figures 應為 []）')
    if a.get('explanations') is None:
        r.err('annotations', 'explanations 不可為 null（每句都要有解析：explanation_zh＋引用中文題目的 evidence）')
    if a.get('model_texts') is not None:
        r.err('annotations.model_texts', '只用在作文（中譯英應為 null）')
    pats_db, _ = grammar_patterns()
    rb = rubric_items(d, 'translation')
    if rb is None:
        r.err('annotations.rubric', '中譯英要有評分規準 {"kind": "translation", "items": {題號: {...}}}（README §3.5）')
    elif set(rb) != {'kind', 'items'} or not isinstance(rb.get('items'), dict):
        r.err('annotations.rubric', '必須是 {"kind": "translation", "items": {題號: {...}}}（沒有其他欄位）')
        rb = None
    items = rb['items'] if rb else {}
    nos = [str(q.get('no')) for q in qs]
    for k in sorted(set(items) - set(nos), key=str):
        r.err('annotations.rubric.items', f'題號 {k} 不存在')
    ref0 = {}
    all_patterns = []
    l3_keys, l5_keys = set(), set()
    gp_used = []
    restructured = 0
    for q in qs:
        no = str(q.get('no'))
        qw = f'group.q{no}'
        stem = q.get('stem') if isinstance(q.get('stem'), str) else ''
        if q.get('points') != TRANSLATION_POINTS:
            r.err(qw, f'中譯英每句 {TRANSLATION_POINTS} 分（points 目前 {q.get("points")!r}；SPEC §4.6）')
        gloss = {w.lower() for m in GLOSS_RE.finditer(stem) for w in re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", m.group(1))}
        outside = GLOSS_RE.sub('', stem)
        if re.search(r'[A-Za-z]{2,}', outside):
            r.warn(qw, '中文題目在括號外有英文字（表外專有名詞才在括號附英文）')
        if not HAN_RUN_RE.search(stem):
            r.err(qw, '中文題目 stem 沒有中文')
        tier_range_warn(r, qw, '中文字數（只計漢字）', han_count(outside), sp.get('source_zh_chars_per_sentence'))
        # 和歷屆題幹太像（避開近期原題，也不要改寫歷屆題）
        best, src = '', None
        for where, ostem in official_corpus()['tr_stems']:
            lc = longest_common_han(stem, ostem)
            if len(lc) > len(best):
                best, src = lc, where
        if len(best) >= STEM_HAN_RUN_ERROR:
            r.err(qw, f'中文題目和歷屆題 {src} 有連續 {len(best)} 個相同漢字「{best}」（太接近原題）')
        elif len(best) >= STEM_HAN_RUN_WARN:
            r.warn(qw, f'中文題目和歷屆題 {src} 有連續 {len(best)} 個相同漢字「{best}」')
        it = items.get(no)
        w = f'annotations.rubric.items.{no}'
        if rb and it is None:
            r.err(w, '缺少這一句的評分規準')
            continue
        if not rb or not ve.check_keys(r, w, it, TRANSLATION_RUBRIC_ITEM_KEYS):
            continue
        # 參考譯文
        refs = it.get('references')
        if not (isinstance(refs, list) and all(ve.nonempty_str(x) for x in refs)):
            r.err(w, 'references 必須是非空字串陣列（本站參考譯文）')
            refs = []
        refs = [x.strip() for x in refs]
        if len(refs) < 2:
            r.err(w, f'本站參考譯文要 ≥2 種（SPEC §5.4；目前 {len(refs)}）')
        elif tier == 'top' and len(refs) < (sp.get('reference_translations_min') or 3):
            r.warn(w, f'超越頂標的參考譯文出題規格書建議 ≥{sp.get("reference_translations_min") or 3} 種（目前 {len(refs)}）')
        if len({norm_en(x) for x in refs}) != len(refs):
            r.err(w, 'references 有重複的譯文')
        for k, ref in enumerate(refs):
            if not re.match(r'^[A-Z"“]', ref) or not re.search(r'[.!?]["”]?$', ref):
                r.err(w, f'references[{k}] 要句首大寫、句尾有標點：「{ref[:50]}」')
            if CJK_RE.search(ref):
                r.err(w, f'references[{k}] 有中文字')
        if refs:
            ref0[no] = refs[0]
            if q.get('answer') != refs[0]:
                r.err(qw, 'answer 必須等於 annotations.rubric.items 的 references[0]（本站首選參考譯文）')
            acc = q.get('accepted_answers')
            if acc is not None and list(acc) != refs[1:]:
                r.err(qw, 'accepted_answers 必須是 null 或等於 references[1:]（其他本站參考譯文，依序）')
            segs = q.get('answer_segments')
            if isinstance(segs, list) and segs and all(isinstance(x, list) and x for x in segs):
                if ve.join_segments([x[0] for x in segs]) != refs[0]:
                    r.err(qw, 'answer_segments 各段第一個寫法串起來要等於 answer')
            # SPEC §3.5 的字數（首選寫法是 error，其他寫法 warning）；出題規格書的範圍 warning
            rng = (rule or {}).get('reference_words') or {}
            for k, ref in enumerate(refs):
                n = count_english_words(ref)
                if (rng.get('min') is not None and n < rng['min']) or (rng.get('max') is not None and n > rng['max']):
                    msg = f'references[{k}] {n} 字，{tier} 的參考譯文應為 {rng.get("min")}–{rng.get("max")} 字（SPEC §3.5）'
                    (r.err if k == 0 else r.warn)(w, msg)
            tier_range_warn(r, w, '首選參考譯文字數', count_english_words(refs[0]), sp.get('reference_en_words_per_sentence'))
            for k, ref in enumerate(refs):
                if NEGATIVE_INVERSION_RE.search(ref) or SUBJUNCTIVE_RE.search(ref):
                    r.warn(w, f'references[{k}] 看起來用了倒裝或假設語氣：這類寫法只放 bonus（加分寫法），不當參考譯文（SPEC §3.5）')
        # 字級（SPEC §3.5：標的詞彙級別；進階可含 1 個 L5）
        lv_max = (rule or {}).get('target_word_level_max')
        above = (rule or {}).get('above_level_words_max') or 0
        tws = it.get('target_words')
        if not (isinstance(tws, list) and tws):
            r.err(w, 'target_words 至少 1 個（標的詞彙）')
            tws = []
        tw_words = []
        above_hits = []
        for k, tw in enumerate(tws):
            tww = f'{w}.target_words[{k}]'
            if not ve.check_keys(r, tww, tw, TARGET_WORD_KEYS):
                continue
            word = tw.get('word')
            if not ve.nonempty_str(word) or not ve.nonempty_str(tw.get('zh')):
                r.err(tww, 'word、zh 必須是非空字串')
                continue
            alts = tw.get('alternatives')
            if alts is not None and not (isinstance(alts, list) and all(ve.nonempty_str(x) for x in alts)):
                r.err(tww, 'alternatives 必須是字串陣列（也算命中的其他寫法）')
                continue
            tw_words.append(word.strip())
            content = [x for x in re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", word)
                       if x.lower() not in PLACEHOLDERS and x.lower() not in AUX_WORDS and x.lower() not in ('a', 'an', 'the')
                       and not ((pos_of_word(x.lower()) or set()) and (pos_of_word(x.lower()) or set()) <= FUNCTION_POS)]
            levels = [tm.token_level(x) for x in content]
            if content and any(lv is None for lv in levels):
                off = [x for x, lv in zip(content, levels) if lv is None]
                r.err(tww, f'標的詞彙「{word}」有詞彙表外的字 {off}（SPEC §3.5：標的詞彙要在大考詞彙表內）')
            elif content and lv_max:
                top_lv = max(levels)
                if top_lv > lv_max + (1 if above else 0):
                    r.err(tww, f'標的詞彙「{word}」是 L{top_lv}，{tier} 上限 L{lv_max}'
                               f'{f"（可含 {above} 個 L{lv_max + 1}）" if above else ""}（SPEC §3.5）')
                elif top_lv > lv_max:
                    above_hits.append(word)
            for k2, ref in enumerate(refs):
                if not target_in(tw, ref):
                    r.err(tww, f'references[{k2}] 沒有用到標的詞彙「{word}」（SPEC §5.4：每個參考譯文都要含標的詞彙；'
                               '換字的寫法請寫在 alternatives）')
        if len(above_hits) > above:
            r.err(w, f'標的詞彙 {above_hits} 超過 L{lv_max}，{tier} 每句最多 {above} 個（SPEC §3.5）')
        # 參考譯文所有實詞的級別（出題規格書 max_word_level；SPEC 只管標的詞彙，這裡列 warning）
        if refs:
            gloss_all = gloss
            cl = content_levels(refs[0], gloss_all)
            off = sorted({t for t, lv, _ in cl if lv is None})
            if off:
                r.warn(w, f'首選參考譯文有詞彙表外的字 {off}（表外專有名詞請在題目括號附英文）')
            mx = sp.get('max_word_level')
            high = sorted({f'{t}(L{lv})' for t, lv, _ in cl if lv is not None and mx and lv > mx})
            if high:
                r.warn(w, f'首選參考譯文有超過 L{mx} 的字 {high}（出題規格書 max_word_level）')
            if tier == 'advanced':
                l5 = sorted({key for _, lv, key in cl if lv is not None and lv >= 5})
                if len(l5) > 1 or any(lv == 6 for _, lv, _ in cl if lv is not None):
                    r.err(w, f'進階練習一句最多 1 個 L5 字、不用 L6（SPEC §3.5；目前 L5 以上 {l5}）')
            l3_keys |= {key for _, lv, key in cl if lv is not None and lv >= 3}
            l5_keys |= {key for _, lv, key in cl if lv is not None and lv >= 5}
        # 句型
        pts = it.get('patterns')
        if not (isinstance(pts, list) and pts):
            r.err(w, 'patterns 至少 1 個（標的句型）')
            pts = []
        codes = []
        for k, p in enumerate(pts):
            pw = f'{w}.patterns[{k}]'
            if not ve.check_keys(r, pw, p, PATTERN_KEYS):
                continue
            code, gid = p.get('code'), p.get('grammar_id')
            if code not in TRANSLATION_STRUCTURE_CODES:
                r.err(pw, f'code={code!r} 不在句構代碼 {"／".join(TRANSLATION_STRUCTURE_CODES)}（倒裝、假設、強調只放 bonus）')
                continue
            codes.append(code)
            gp = pats_db.get(gid)
            if gp is None:
                r.err(pw, f'grammar_id={gid!r} 不在 data/curriculum/grammar-patterns.json')
            else:
                gp_used.append(gid)
                if gp.get('category') in BONUS_ONLY_CATEGORIES:
                    r.err(pw, f'{gid}（{gp.get("category")}）不可當標的句型：倒裝、假設、強調只放 bonus（SPEC §3.5、WRT-TRN-STR-02）')
                elif GRAMMAR_CODE.get(gid) and GRAMMAR_CODE[gid] != code:
                    r.warn(pw, f'{gid} 通常對應句構 {GRAMMAR_CODE[gid]}（目前 code={code}）')
            for key in ('label_zh', 'frame', 'zh_trigger'):
                if not ve.nonempty_str(p.get(key)):
                    r.err(pw, f'{key} 必須是非空字串')
            if ve.nonempty_str(p.get('zh_trigger')) and p['zh_trigger'] not in stem:
                r.err(pw, f'zh_trigger「{p["zh_trigger"]}」要逐字出現在中文題目（出題規格書 WRT-TRN-STR-01）')
            pool = [re.sub(r'\(.*\)', '', x) for x in sp.get('structure_pool') or []]
            if pool and code not in pool and code not in ('VOC', 'BASIC'):   # VOC、BASIC 不是出題規格書分級用的句構
                r.warn(pw, f'{code} 不在出題規格書 {tier} 的句構範圍 {pool}')
            for k2, ref in enumerate(refs):
                found = detect_structure(code, ref)
                if found is False:
                    msg = f'references[{k2}] 看不出用了句構 {code}（{p.get("label_zh")}）'
                    if code in STRICT_STRUCTURES:
                        r.err(pw, msg + '（SPEC §5.4：每個參考譯文都要含標的句型）')
                    else:
                        r.warn(pw, msg + '（程式只能粗略比對，請人工確認）')
        all_patterns.append((no, codes, [p.get('grammar_id') for p in pts if isinstance(p, dict)]))
        srng = (rule or {}).get('structures_per_sentence') or {}
        n = len(pts)
        if (srng.get('min') is not None and n < srng['min']) or (srng.get('max') is not None and n > srng['max']):
            r.err(w, f'{tier} 每句 {srng.get("min")}–{srng.get("max") if srng.get("max") is not None else ""} 個核心句構（SPEC §3.5；目前 {n}）')
        tier_range_warn(r, w, '句構數', n, sp.get('structures_per_sentence'))
        # 評分規準：4 個部分
        parts = it.get('parts')
        if not isinstance(parts, list) or len(parts) != TRANSLATION_PARTS:
            r.err(w, f'parts 必須剛好 {TRANSLATION_PARTS} 個評分部分（SPEC §5.4；目前 {len(parts) if isinstance(parts, list) else parts!r}）')
            parts = parts if isinstance(parts, list) else []
        n_errors, pos_prev, variable = 0, -1, 0
        target_names = set(tw_words) | set(codes)
        assigned = set()
        for k, part in enumerate(parts):
            pw = f'{w}.parts[{k}]'
            if not ve.check_keys(r, pw, part, PART_KEYS):
                continue
            zh = part.get('zh')
            if not ve.nonempty_str(zh) or zh not in stem:
                r.err(pw, f'zh「{zh}」要逐字出現在中文題目（這一部分對應的中文）')
            else:
                pos = stem.find(zh)
                if pos < pos_prev:
                    r.warn(pw, '評分部分沒有依中文題目的順序排列')
                pos_prev = pos
            acc = part.get('accepted')
            if not (isinstance(acc, list) and acc and all(ve.nonempty_str(x) for x in acc)):
                r.err(pw, 'accepted 必須是非空字串陣列（這一部分的可接受寫法；第一個是首選參考譯文用的寫法）')
                acc = []
            if len(acc) >= 2:
                variable += 1
            if len({norm_en(x) for x in acc}) != len(acc):
                r.err(pw, 'accepted 有重複的寫法')
            if acc and refs and norm_en(acc[0]) not in norm_en(refs[0]):
                r.err(pw, f'accepted[0]「{acc[0]}」要出現在首選參考譯文 references[0]')
            for k2, ref in enumerate(refs):
                if acc and not any(norm_en(x) and f' {norm_en(x)} ' in f' {norm_en(ref)} ' for x in acc):
                    r.err(pw, f'references[{k2}] 裡找不到這一部分的任何可接受寫法（評分規準要能套在每個參考譯文上）')
            tg = part.get('targets')
            if not isinstance(tg, list) or not all(isinstance(x, str) for x in tg):
                r.err(pw, 'targets 必須是字串陣列（這一部分評量的標的詞彙 word 或句構 code）')
                tg = []
            unknown = [x for x in tg if x not in target_names]
            if unknown:
                r.err(pw, f'targets {unknown} 不是這一句的標的詞彙（target_words.word）或句構代碼（patterns.code）')
            assigned |= set(tg)
            if not tg:
                r.warn(pw, '這一部分沒有標的詞彙或句型（出題規格書：每部分至少 1 個評量點）')
            ce = part.get('common_errors')
            if not isinstance(ce, list):
                r.err(pw, 'common_errors 必須是陣列（這一部分的常見錯誤）')
                ce = []
            if not ce:
                r.warn(pw, '這一部分沒有列常見錯誤')
            accepted_norm = {norm_en(x) for x in acc}
            for k2, e in enumerate(ce):
                ew = f'{pw}.common_errors[{k2}]'
                if not ve.check_keys(r, ew, e, COMMON_ERROR_KEYS):
                    continue
                n_errors += 1
                if not ve.nonempty_str(e.get('wrong')) or not ve.nonempty_str(e.get('explanation_zh')):
                    r.err(ew, 'wrong、explanation_zh 必須是非空字串')
                elif norm_en(e['wrong']) in accepted_norm:
                    r.err(ew, f'常見錯誤「{e["wrong"]}」和可接受寫法相同')
                if 'right' in e and not ve.nonempty_str(e.get('right')):
                    r.err(ew, 'right 必須是非空字串')
        if parts and n_errors == 0:
            r.err(w, '評分規準至少要列 1 個常見錯誤（SPEC §6.8：常見錯誤與解析）')
        missing = sorted(target_names - assigned)
        if parts and missing:
            r.warn(w, f'標的 {missing} 沒有分配到任何評分部分（parts[].targets）')
        tier_range_warn(r, w, '可替換寫法的部分數', variable, sp.get('variable_segments_per_sentence'))
        # 誘錯點
        traps = it.get('traps')
        if not isinstance(traps, list):
            r.err(w, 'traps 必須是陣列（誘錯點）')
            traps = []
        for k, t in enumerate(traps):
            tw_ = f'{w}.traps[{k}]'
            if not ve.check_keys(r, tw_, t, TRAP_KEYS):
                continue
            if t.get('type') not in TRANSLATION_TRAP_TYPES:
                r.err(tw_, f'type={t.get("type")!r} 不在 {"／".join(TRANSLATION_TRAP_TYPES)}')
            if not (ve.is_int(t.get('part')) and 1 <= t['part'] <= TRANSLATION_PARTS):
                r.err(tw_, f'part 必須是 1–{TRANSLATION_PARTS}（誘錯點落在哪一個評分部分）')
            for key in ('zh', 'literal_error', 'explanation_zh'):
                if not ve.nonempty_str(t.get(key)):
                    r.err(tw_, f'{key} 必須是非空字串')
            if ve.nonempty_str(t.get('zh')) and t['zh'] not in stem:
                r.err(tw_, f'zh「{t["zh"]}」要逐字出現在中文題目')
        tier_range_warn(r, w, '誘錯點數', len(traps), sp.get('trap_points_per_sentence'))
        # 加分寫法
        bonus = it.get('bonus')
        if not isinstance(bonus, list):
            r.err(w, 'bonus 必須是陣列（加分寫法；倒裝、假設只放這裡）')
            bonus = []
        for k, b in enumerate(bonus):
            bw = f'{w}.bonus[{k}]'
            if not ve.check_keys(r, bw, b, BONUS_KEYS):
                continue
            if not ve.nonempty_str(b.get('text')) or not ve.nonempty_str(b.get('explanation_zh')):
                r.err(bw, 'text、explanation_zh 必須是非空字串')
            elif norm_en(b['text']) in {norm_en(x) for x in refs}:
                r.err(bw, '加分寫法不要和參考譯文相同（參考譯文是一般寫法）')
            if 'grammar_id' in b and b['grammar_id'] not in pats_db:
                r.err(bw, f'grammar_id={b["grammar_id"]!r} 不在 grammar-patterns.json')
        if it.get('restructuring_zh') is not None and not ve.nonempty_str(it.get('restructuring_zh')):
            r.err(w, 'restructuring_zh 必須是非空字串或省略')
        if ve.nonempty_str(it.get('restructuring_zh')):
            restructured += 1
        # D8：不可重製官方參考譯文
        texts = [(f'references[{k}]', x) for k, x in enumerate(refs)]
        texts += [(f'parts[{k}].accepted[{j}]', x) for k, p in enumerate(parts) if isinstance(p, dict)
                  for j, x in enumerate(p.get('accepted') if isinstance(p.get('accepted'), list) else [])]
        texts += [(f'bonus[{k}]', b.get('text')) for k, b in enumerate(bonus) if isinstance(b, dict)]
        for key, text in texts:
            hit = official_en_overlap(text if isinstance(text, str) else '')
            if hit:
                r.err(f'{w}.{key}', f'和歷屆官方參考譯文（{hit[1]}）有 {OFFICIAL_NGRAM} 字相同字串「{hit[0]}」（D8：本站譯文要自己寫）')
    # 整組
    if len(qs) == 2 and all(no in ref0 for no in ('1', '2')):
        r1, r2 = ref0['1'], ref0['2']
        first = (EN_WORD_RE.findall(r2.lower()) or [''])[0]
        shared = {k for _, lv, k in content_levels(r1)} & {k for _, lv, k in content_levels(r2)}
        if first not in ('they', 'it', 'this', 'these', 'he', 'she', 'we', 'such', 'those', 'their', 'its', 'however',
                         'therefore', 'as', 'thus', 'also', 'besides', 'moreover', 'instead') and not shared:
            r.warn('group', '兩句看不出同一主題：第二句沒有用代名詞或轉折詞開頭，也沒有和第一句共用的實詞（出題規格書 WRT-TRN-FMT-02）')
    tier_range_warn(r, 'group', '兩句合計 L3 以上詞目數', len(l3_keys), sp.get('L3plus_content_types_pair'))
    tier_range_warn(r, 'group', '兩句合計 L5 以上詞目數', len(l5_keys), sp.get('L5plus_types_pair'))
    if tier == 'basic' and len(all_patterns) == 2 and all_patterns[0][1] and all_patterns[0][1] == all_patterns[1][1]:
        r.warn('group', f'穩定基礎兩句用了同一種句構 {all_patterns[0][1]}（出題規格書：一組兩句不同家族）')
    if tier == 'top' and rb and not set(gp_used) & set(TOP_TRANSLATION_GRAMMAR_IDS):
        r.err('group', '超越頂標一組至少要有 1 個指定句型：非限定關係子句、句尾分詞表結果、no matter＋wh-、what／whether 子句'
                       f'（SPEC §3.5；grammar_id 用 {"／".join(TOP_TRANSLATION_GRAMMAR_IDS)}）')
    if tier in ('advanced', 'top') and rb and not restructured:
        r.warn('group', '進階以上兩句中至少 1 句要改寫句構才通順，請在那一句寫 restructuring_zh（出題規格書 WRT-TRN-STR-03）')
    if tier == 'top' and rb and not any((items.get(no) or {}).get('bonus') for no in nos if isinstance(items.get(no), dict)):
        r.warn('group', '超越頂標建議至少附 1 個加分寫法（bonus：倒裝、假設等，不設為唯一正解）')


# --------------------------- 作文 ---------------------------

def mattr(tokens, window=50):
    if not tokens:
        return 0.0
    if len(tokens) <= window:
        return len(set(tokens)) / len(tokens)
    vals = [len(set(tokens[i:i + window])) / window for i in range(len(tokens) - window + 1)]
    return sum(vals) / len(vals)


def model_text_metrics(text, notes):
    """範文的篇章指標（出題規格書 essay_sample_features.metric_definitions 的簡化版）。"""
    paras = paragraphs_of(text)
    words = count_english_words(text)
    sents = tm.split_sentences(ve.strip_markup(text or ''))
    lens = [count_english_words(s) for s in sents]
    mean = sum(lens) / len(lens) if lens else 0.0
    cv = (sum((x - mean) ** 2 for x in lens) / len(lens)) ** 0.5 / mean if lens and mean else 0.0
    conns = [n for n in notes if isinstance(n, dict) and n.get('kind') == 'connective' and isinstance(n.get('text'), str)]
    m = tm.compute(text or '')
    return {
        'words': words,
        'paragraphs': len(paras),
        'p2_share': round(count_english_words(paras[1]) / words, 3) if len(paras) >= 2 and words else 0.0,
        'sentences': len(sents),
        'mean_sentence_length': round(mean, 2),
        'sentence_length_cv': round(cv, 3),
        'connectives_per_100w': round(len(conns) * 100 / words, 2) if words else 0.0,
        'connective_types': len({norm_en(n['text']) for n in conns}),
        'connective_functions': len({n.get('function') for n in conns if n.get('function') in SPEC_CONNECTIVE_FUNCTIONS}),
        'L1_4_coverage': m['coverage_l1_4'],
        'L5plus_share': m['beyond_l4_ratio'],
        'mattr50': round(mattr(en_tokens(text)), 3),
        'inversion': len(NEGATIVE_INVERSION_RE.findall(text or '')),
    }


def check_model_text(r, w, mt):
    """一篇範文：格式、註解範圍、轉承詞功能、細節句與個人經驗句、自評分數、D8、出題規格書的篇章指標（warning）。"""
    label = mt.get('label')
    text = mt.get('text') if isinstance(mt.get('text'), str) else ''
    if not text.strip():
        r.err(w, 'text 必須是非空字串（兩段以一個換行分開）')
        return
    if CJK_RE.search(text):
        r.err(w, '範文裡有中文字')
    n_words = count_english_words(text)
    paras = paragraphs_of(text)
    if n_words < COMPOSITION_MIN_WORDS:
        r.err(w, f'範文只有 {n_words} 字，至少 {COMPOSITION_MIN_WORDS} 字（SPEC §5.4）')
    if len(paras) != COMPOSITION_PARAGRAPHS:
        r.err(w, f'範文要剛好 {COMPOSITION_PARAGRAPHS} 段（目前 {len(paras)} 段；段落之間用一個換行）')
    # 段落功能
    pg = mt.get('paragraphs')
    if not (isinstance(pg, list) and len(pg) == COMPOSITION_PARAGRAPHS):
        r.err(w, f'paragraphs 必須是 {COMPOSITION_PARAGRAPHS} 筆段落功能（依序）')
        pg = []
    for k, p in enumerate(pg):
        pw = f'{w}.paragraphs[{k}]'
        if not ve.check_keys(r, pw, p, MODEL_PARAGRAPH_KEYS):
            continue
        if not ve.nonempty_str(p.get('function_zh')):
            r.err(pw, 'function_zh 必須是非空字串（這一段的功能）')
        ts = p.get('topic_sentence')
        if not ve.nonempty_str(ts):
            r.err(pw, 'topic_sentence 必須是非空字串（逐字引用這一段的主題句）')
        elif k < len(paras) and ts.strip() not in paras[k]:
            r.err(pw, f'topic_sentence 要逐字出現在第 {k + 1} 段：「{ts[:50]}」')
    # 註解
    notes = mt.get('notes')
    if not isinstance(notes, list):
        r.err(w, 'notes 必須是陣列（轉承詞、細節句、個人經驗句、好用句型、片語的標註）')
        notes = []
    _, known_conns = grammar_patterns()
    kinds = Counter()
    funcs = set()
    for k, n in enumerate(notes):
        nw = f'{w}.notes[{k}]'
        if not ve.check_keys(r, nw, n, NOTE_KEYS):
            continue
        kind = n.get('kind')
        if kind not in NOTE_KINDS:
            r.err(nw, f'kind={kind!r} 不在 {"／".join(NOTE_KINDS)}')
            continue
        kinds[kind] += 1
        t = n.get('text')
        if not ve.nonempty_str(t):
            r.err(nw, 'text 必須是非空字串（逐字引用範文）')
            continue
        if t not in text:
            r.err(nw, f'註解的範圍「{t[:50]}」不在範文裡（必須逐字）')
        if not ve.nonempty_str(n.get('zh')):
            r.err(nw, 'zh 必須是非空字串（註解說明）')
        if kind == 'connective':
            f = n.get('function')
            if f not in CONNECTIVE_FUNCTIONS:
                r.err(nw, f'轉承詞要標 function：{"／".join(CONNECTIVE_FUNCTIONS)}（目前 {f!r}）')
            else:
                funcs.add(f)
            key = re.sub(r'[^a-z\' ]', '', t.lower().replace('’', "'")).strip()
            if key and key not in known_conns:
                r.warn(nw, f'「{t}」不在轉承詞清單（grammar-patterns.json connectives），請確認是轉承詞')
        elif 'function' in n:
            r.err(nw, 'function 只用在 kind=connective')
        if kind in ('detail', 'experience') and not re.search(r'[.!?]["”’]?$', t.strip()):
            r.warn(nw, f'{kind} 標註建議整句（以 . ! ? 結尾）')
    spec_funcs = funcs & set(SPEC_CONNECTIVE_FUNCTIONS)
    if len(spec_funcs) < 4:
        r.err(w, f'轉承詞涵蓋 {len(spec_funcs)} 種功能 {sorted(spec_funcs)}，至少 4 種'
                 '（列舉或時序 sequence、因果 cause_effect、轉折或讓步 contrast、舉例 example、結論 conclusion；SPEC §5.4）')
    if not kinds['detail']:
        r.err(w, '沒有標註細節句（kind=detail；SPEC §5.4）')
    elif label == 'steady' and kinds['detail'] < 2:
        r.warn(w, '穩健版建議 ≥2 個具體細節句（出題規格書 model_essay.must_show）')
    if not kinds['experience']:
        r.err(w, '沒有標註個人經驗句（kind=experience；SPEC §5.4）')
    if not kinds['pattern']:
        r.err(w, '沒有標註好用句型（kind=pattern；SPEC §6.9：1–2 個亮點句型）')
    # 自評分數（本站標的分數；盲評者看不到）
    sa = mt.get('self_assessment')
    if ve.check_keys(r, f'{w}.self_assessment', sa, SELF_ASSESSMENT_KEYS):
        sc = sa.get('scores')
        if not (isinstance(sc, dict) and set(sc) == set(MODEL_TEXT_CRITERIA)
                and all(ve.is_int(v) and 0 <= v <= 5 for v in sc.values())):
            r.err(f'{w}.self_assessment', 'scores 必須是 {content, organization, grammar, vocabulary}，各 0–5 的整數')
        elif label in MODEL_TEXT_TARGETS:
            lo, hi = MODEL_TEXT_TARGETS[label]
            total = sum(sc.values())
            if not lo <= total <= hi:
                r.err(f'{w}.self_assessment', f'{"穩健版" if label == "steady" else "頂標版"}的目標總分是 {lo}–{hi}（SPEC §5.7；目前 {total}）')
        if not ve.nonempty_str(sa.get('explanation_zh')):
            r.err(f'{w}.self_assessment', 'explanation_zh 必須是非空字串（依四項指標說明為什麼是這個分數）')
    # D8
    hit = official_en_overlap(text)
    if hit:
        r.err(w, f'範文和歷屆官方內容（{hit[1]}）有 {OFFICIAL_NGRAM} 字相同字串「{hit[0]}」（D8：範文要自己寫）')
    # 出題規格書的篇章指標（warning）
    if label in MODEL_TEXT_SPEC_KEY:
        sp = writing_tier_spec({'foundation': 'basic', 'beyond_top': 'top'}[MODEL_TEXT_SPEC_KEY[label]], 'model_essay')
        m = model_text_metrics(text, notes)
        basis = f'出題規格書 {MODEL_TEXT_SPEC_KEY[label]}.model_essay '
        tier_range_warn(r, w, '字數', m['words'], sp.get('words'), basis)
        tier_range_warn(r, w, '第二段字數占比', m['p2_share'], sp.get('p2_share'), basis)
        tier_range_warn(r, w, '句數', m['sentences'], sp.get('sentences'), basis)
        tier_range_warn(r, w, '平均句長', m['mean_sentence_length'], sp.get('mean_sentence_length'), basis)
        tier_range_warn(r, w, '轉承詞每百字', m['connectives_per_100w'], sp.get('connectives_per_100w'), basis)
        tier_range_warn(r, w, '轉承詞種類', m['connective_types'], [sp.get('connective_types_min'), None], basis)
        tier_range_warn(r, w, '句長變異係數', m['sentence_length_cv'], [sp.get('sentence_length_cv_min'), None], basis)
        tier_range_warn(r, w, 'MATTR(50)', m['mattr50'], [sp.get('mattr50_min'), None], basis)
        cov = sp.get('L1_4_coverage') or [sp.get('L1_4_coverage_min'), None]
        tier_range_warn(r, w, 'L1–4 覆蓋率', m['L1_4_coverage'], cov, basis)
        l5 = sp.get('L5plus_share') or [None, sp.get('L5plus_share_max')]
        tier_range_warn(r, w, 'L5 以上比例', m['L5plus_share'], l5, basis)
        tier_range_warn(r, w, '倒裝句數', m['inversion'], [None, sp.get('inversion_max')], basis)


def check_composition_figures(r, d):
    g = d.get('group') or {}
    figs = g.get('figures') if isinstance(g.get('figures'), list) else []
    if not 1 <= len(figs) <= 3:
        r.err('group.figures', f'作文要有 1–3 張圖（SPEC §3.5 三種難度都是看圖或圖表；出題規格書 WRT-CMP-FMT-02；目前 {len(figs)}）')
    kinds = []
    for fi, f in enumerate(figs):
        w = f'group.figures[{fi}]'
        if not ve.check_keys(r, w, f, COMPOSITION_FIGURE_KEYS):
            continue
        kind = f.get('kind')
        kinds.append(kind)
        if kind not in COMPOSITION_FIGURE_KINDS:
            r.warn(w, f'kind={kind!r} 不在常用值 {"／".join(COMPOSITION_FIGURE_KINDS)}')
        if not ve.nonempty_str(f.get('caption')):
            r.err(w, 'caption 必須是非空字串（圖的標題，例如「圖一：午休時間的教室」）')
        desc = f.get('description')
        if not ve.nonempty_str(desc) or han_count(desc) + count_english_words(desc) < 20:
            r.err(w, 'description 要完整描述圖的內容（沒有 SVG 時學生、盲評者與無障礙都靠它）')
        if not ve.str_or_null(f.get('label')):
            r.err(w, 'label 必須是字串或 null')
        if f.get('question_no') not in (None, 1):
            r.err(w, 'question_no 只能是 null 或 1')
        rows = f.get('rows')
        if rows is not None and not (isinstance(rows, list) and rows and all(isinstance(x, list) and all(isinstance(c, str) for c in x) for x in rows)):
            r.err(w, 'rows 必須是字串的二維陣列或 null')
            rows = None
        if kind in ('chart', 'table'):
            if not rows or len(rows) < 2 or len({len(x) for x in rows}) != 1:
                r.err(w, f'kind={kind} 要有 rows（第一列表頭、每列欄數相同）：圖表的數字學生與盲評者都要讀得到')
            else:
                nums = {v for row in rows for c in row for v, _, _ in numbers_in(c)}
                for v, _, s in numbers_in(desc or ''):
                    if v not in nums:
                        r.warn(w, f'description 提到的數字 {s} 在 rows 裡找不到')
        if 'svg' in f:
            for p in svg_problems(f.get('svg')):
                r.err(w, p)
    return figs, kinds


def check_composition(r, d):
    writing_common(r, d)
    tier = d.get('tier') if d.get('tier') in TIERS else None
    rule = tiers_spec()['item_rules']['composition'].get(tier) if tier else None
    sp = writing_tier_spec(tier, 'composition')
    qs = questions_of(d)
    a = d.get('annotations') if isinstance(d.get('annotations'), dict) else {}
    q = qs[0] if qs else {}
    stem = q.get('stem') if isinstance(q.get('stem'), str) else ''
    qw = 'group.q1'
    if q.get('points') != COMPOSITION_POINTS:
        r.err(qw, f'作文 points 應為 {COMPOSITION_POINTS}（目前 {q.get("points")!r}）')
    for must in ('文分兩段', '第一段', '第二段'):
        if must not in stem:
            r.err(qw, f'題目提示要寫「{must}」並分別指定兩段任務（出題規格書 WRT-CMP-FMT-01）')
    if not stem.lstrip().startswith('提示'):
        r.warn(qw, '題目提示建議以「提示：」開頭（同學測題本）')
    tier_range_warn(r, qw, '提示中文字數', han_count(stem), sp.get('prompt_zh_chars'))
    tags = q.get('tags') if isinstance(q.get('tags'), dict) else {}
    if tags.get('essay_type') not in ('picture', 'chart', 'letter', 'topic'):
        r.err(qw, f'tags.essay_type 要標 picture／chart（看圖、圖表；目前 {tags.get("essay_type")!r}）')
    if tags.get('paragraphs') != COMPOSITION_PARAGRAPHS:
        r.err(qw, f'tags.paragraphs 應為 {COMPOSITION_PARAGRAPHS}')
    if tags.get('word_count') != {'min': COMPOSITION_MIN_WORDS, 'max': None, 'approx': None}:
        r.err(qw, f'tags.word_count 應為 {{"min": {COMPOSITION_MIN_WORDS}, "max": null, "approx": null}}（文長至少 120 個單詞）')
    win = official_corpus()['cp_stems']
    for run in HAN_RUN_RE.findall(stem):
        hit = next((run[i:i + COMPOSITION_STEM_HAN_RUN_WARN] for i in range(len(run) - COMPOSITION_STEM_HAN_RUN_WARN + 1)
                    if run[i:i + COMPOSITION_STEM_HAN_RUN_WARN] in win), None)
        if hit:
            r.warn(qw, f'題目提示和歷屆作文題（{win[hit]}）有連續 {COMPOSITION_STEM_HAN_RUN_WARN} 個以上相同漢字「{hit}」')
            break
    figs, kinds = check_composition_figures(r, d)
    has_chart = any(k in ('chart', 'table') for k in kinds)
    if has_chart and tags.get('essay_type') not in ('chart',):
        r.warn(qw, '有圖表（kind=chart／table）時 tags.essay_type 建議標 chart')
    # 評分規準與題目設計
    rb = rubric_items(d, 'composition')
    if rb is None:
        r.err('annotations.rubric', '作文要有評分規準 {"kind": "composition", …}（README §3.6）')
    elif ve.check_keys(r, 'annotations.rubric', rb, COMPOSITION_RUBRIC_KEYS):
        w = 'annotations.rubric'
        if rb.get('prompt_type') not in COMPOSITION_PROMPT_TYPES:
            r.err(w, f'prompt_type={rb.get("prompt_type")!r} 不在 {"／".join(COMPOSITION_PROMPT_TYPES)}')
        moves = rb.get('moves')
        if not (isinstance(moves, list) and moves):
            r.err(w, 'moves 必須是非空陣列（題目要求的內容步驟）')
            moves = []
        by_para = defaultdict(list)
        for k, mv in enumerate(moves):
            mw = f'{w}.moves[{k}]'
            if not ve.check_keys(r, mw, mv, MOVE_KEYS):
                continue
            if mv.get('paragraph') not in (1, 2):
                r.err(mw, 'paragraph 必須是 1 或 2')
            if mv.get('code') not in MOVE_CODES:
                r.err(mw, f'code={mv.get("code")!r} 不在 {"／".join(MOVE_CODES)}')
            if not ve.nonempty_str(mv.get('zh')):
                r.err(mw, 'zh 必須是非空字串（這個步驟在題目裡怎麼寫）')
            by_para[mv.get('paragraph')].append(mv.get('code'))
        if moves and (not by_para[1] or not by_para[2]):
            r.err(w, '兩段都要有內容步驟（moves 的 paragraph 1、2 各至少 1 個；出題規格書 WRT-CMP-TSK-01）')
        tier_range_warn(r, w, '內容步驟數', len(moves), sp.get('moves'))
        p1, p2 = set(by_para[1]), set(by_para[2])
        if tier == 'basic':
            if 'describe' not in p1 and 'compare' not in p1:
                r.err(w, '穩定基礎第一段要描述圖片（moves：paragraph 1 有 describe 或 compare；SPEC §3.5）')
            if not p2 & set(EXPERIENCE_MOVES):
                r.err(w, f'穩定基礎第二段要寫個人經驗（moves：paragraph 2 有 {"／".join(EXPERIENCE_MOVES)}；SPEC §3.5）')
        elif tier == 'advanced':
            if not p2 & set(VIEW_MOVES):
                r.err(w, f'進階練習第二段要寫看法、原因或影響（moves：paragraph 2 有 {"／".join(VIEW_MOVES)} 之一；SPEC §3.5）')
        elif tier == 'top':
            if not (has_chart or len(figs) >= 2):
                r.err('group.figures', '超越頂標要用圖表（kind=chart／table）或多圖比較（≥2 張；SPEC §3.5）')
            if not p1 & {'compare', 'describe_data'}:
                r.err(w, '超越頂標第一段要比較或描述數據（moves：paragraph 1 有 compare 或 describe_data；SPEC §3.5）')
            if not p2 & {'evaluate', 'propose'}:
                r.err(w, '超越頂標第二段要評估或提出方案（moves：paragraph 2 有 evaluate 或 propose；SPEC §3.5）')
        # 評分規準（四項各 0–5，本站自己的文字）
        crit = rb.get('criteria')
        if not (isinstance(crit, dict) and set(crit) == set(MODEL_TEXT_CRITERIA)):
            r.err(w, 'criteria 必須剛好有 content、organization、grammar、vocabulary 四項（內容、組織、文法句構、字彙拼字）')
            crit = crit if isinstance(crit, dict) else {}
        for ck in MODEL_TEXT_CRITERIA:
            c = crit.get(ck)
            cw = f'{w}.criteria.{ck}'
            if c is None or not ve.check_keys(r, cw, c, CRITERION_KEYS):
                continue
            if not ve.nonempty_str(c.get('focus_zh')):
                r.err(cw, 'focus_zh 必須是非空字串（這一題在這一項要看什麼）')
            bands = c.get('bands')
            if not isinstance(bands, list) or not bands:
                r.err(cw, 'bands 必須是非空陣列（各分數帶的描述）')
                continue
            covered = []
            for k, b in enumerate(bands):
                bw = f'{cw}.bands[{k}]'
                if not ve.check_keys(r, bw, b, BAND_KEYS):
                    continue
                lo, hi = b.get('min'), b.get('max')
                if not (ve.is_int(lo) and ve.is_int(hi) and 0 <= lo <= hi <= 5):
                    r.err(bw, 'min、max 必須是 0–5 的整數且 min ≤ max')
                    continue
                covered += list(range(lo, hi + 1))
                if not ve.nonempty_str(b.get('descriptor_zh')):
                    r.err(bw, 'descriptor_zh 必須是非空字串（本站自己的文字）')
            if sorted(covered) != list(range(0, 6)):
                r.err(cw, f'bands 要剛好涵蓋 0–5 分各一次（目前 {sorted(covered)}）')
        if not ve.nonempty_str(rb.get('deductions_zh')):
            r.err(w, 'deductions_zh 必須是非空字串（字數明顯不足、未分段的扣分說明，本站文字）')
        # D8：評分規準的中文不可重製評分原則原文
        for path_, s, _ in ve.walk_strings(rb, w, False):
            hit = official_han_overlap(s)
            if hit:
                r.err(path_, f'和官方評分說明（{hit[1]}）有連續 {len(hit[0])} 個相同漢字「{hit[0]}」（D8：評分規準要用本站自己的文字）')
        # 鷹架（SPEC §3.5：穩定基礎提供構思圖與句型開頭；進階不提供句型開頭）
        sc = rb.get('scaffold')
        if sc is None:
            if tier == 'basic':
                r.err(w, '穩定基礎要提供構思圖與句型開頭（scaffold.kind = outline+sentence_starters；SPEC §3.5）')
        elif not isinstance(sc, dict) or sc.get('kind') not in SCAFFOLD_KINDS:
            r.err(f'{w}.scaffold', f'scaffold 必須是 null 或 kind 為 {"／".join(SCAFFOLD_KINDS)} 的物件')
        else:
            sw = f'{w}.scaffold'
            kind = sc['kind']
            if ve.check_keys(r, sw, sc, SCAFFOLD_KEYS[kind]):
                if tier == 'basic' and kind != 'outline+sentence_starters':
                    r.err(sw, '穩定基礎要提供構思圖與句型開頭（kind = outline+sentence_starters；SPEC §3.5）')
                if tier in ('advanced', 'top') and kind == 'outline+sentence_starters':
                    r.err(sw, f'{tier} 不提供句型開頭（SPEC §3.5；進階用 outline、超越頂標用 checklist）')
                if tier == 'advanced' and kind != 'outline':
                    r.warn(sw, '進階練習的鷹架出題規格書建議只給兩段大綱（kind = outline）')
                if tier == 'top' and kind != 'checklist':
                    r.warn(sw, '超越頂標的鷹架出題規格書建議只給規劃檢核表（kind = checklist）')
                if kind in ('outline+sentence_starters', 'outline'):
                    ol = sc.get('outline')
                    if not (isinstance(ol, list) and len(ol) == COMPOSITION_PARAGRAPHS):
                        r.err(sw, 'outline 必須是 2 筆（兩段大綱）')
                        ol = []
                    for k, o in enumerate(ol):
                        ow = f'{sw}.outline[{k}]'
                        if not ve.check_keys(r, ow, o, OUTLINE_KEYS):
                            continue
                        if o.get('paragraph') != k + 1:
                            r.err(ow, f'paragraph 應為 {k + 1}')
                        if not ve.nonempty_str(o.get('topic_sentence_zh')):
                            r.err(ow, 'topic_sentence_zh 必須是非空字串')
                        if not (isinstance(o.get('details_zh'), list) and 2 <= len(o['details_zh']) <= 3
                                and all(ve.nonempty_str(x) for x in o['details_zh'])):
                            r.err(ow, 'details_zh 必須是 2–3 個非空字串（支持細節）')
                        if 'closing_zh' in o and not ve.nonempty_str(o.get('closing_zh')):
                            r.err(ow, 'closing_zh 必須是非空字串或省略')
                if kind == 'outline+sentence_starters':
                    pm = sc.get('planning_map')
                    if ve.check_keys(r, f'{sw}.planning_map', pm, PLANNING_MAP_KEYS):
                        if not ve.nonempty_str(pm.get('center_zh')):
                            r.err(f'{sw}.planning_map', 'center_zh 必須是非空字串（構思圖中心）')
                        br = pm.get('branches')
                        if not (isinstance(br, list) and len(br) >= 4):
                            r.err(f'{sw}.planning_map', 'branches 至少 4 個（5W1H：什麼時候、在哪裡、誰、發生什麼、感受、後來）')
                            br = br if isinstance(br, list) else []
                        for k, b in enumerate(br):
                            bw = f'{sw}.planning_map.branches[{k}]'
                            if ve.check_keys(r, bw, b, BRANCH_KEYS) and not (ve.nonempty_str(b.get('label_zh')) and ve.nonempty_str(b.get('prompt_zh'))):
                                r.err(bw, 'label_zh、prompt_zh 必須是非空字串')
                    ss = sc.get('sentence_starters')
                    if not (isinstance(ss, list) and len(ss) == COMPOSITION_PARAGRAPHS
                            and all(isinstance(x, list) and 2 <= len(x) <= 3 and all(ve.nonempty_str(y) for y in x) for x in ss)):
                        r.err(sw, 'sentence_starters 必須是 2 段 × 2–3 個英文句型開頭（[[…], […]]）')
                    else:
                        for x in ss:
                            for y in x:
                                if CJK_RE.search(y):
                                    r.err(sw, f'句型開頭要是英文：「{y[:40]}」')
                if kind == 'checklist':
                    cl = sc.get('checklist_zh')
                    if not (isinstance(cl, list) and len(cl) >= 3 and all(ve.nonempty_str(x) for x in cl)):
                        r.err(sw, 'checklist_zh 至少 3 個非空字串（規劃檢核表）')
    # 範文
    mts = a.get('model_texts')
    if not isinstance(mts, list):
        r.err('annotations.model_texts', '作文要有兩篇範文（穩健版 steady、頂標版 top；SPEC §5.4）')
        mts = []
    labels = [m.get('label') for m in mts if isinstance(m, dict)]
    if sorted(x for x in labels if isinstance(x, str)) != sorted(MODEL_TEXT_LABELS) or len(mts) != 2:
        r.err('annotations.model_texts', f'範文要剛好兩篇：label 各一篇 steady（穩健版）與 top（頂標版）（目前 {labels}）')
    texts = {}
    for k, mt in enumerate(mts):
        w = f'annotations.model_texts[{k}]'
        if not ve.check_keys(r, w, mt, MODEL_TEXT_KEYS):
            continue
        if mt.get('label') not in MODEL_TEXT_LABELS:
            r.err(w, f'label={mt.get("label")!r} 必須是 steady／top')
        check_model_text(r, w, mt)
        texts[mt.get('label')] = mt.get('text') if isinstance(mt.get('text'), str) else ''
    if texts.get('steady') and texts.get('top'):
        if norm_en(texts['steady']) == norm_en(texts['top']):
            r.err('annotations.model_texts', '兩篇範文相同')
        elif count_english_words(texts['top']) <= count_english_words(texts['steady']):
            r.warn('annotations.model_texts', '頂標版通常比穩健版長（細節與個人經驗更具體；出題規格書 model_essay.words）')
    # 課綱（SPEC §3.5：超越頂標 9-Ⅴ-7、9-Ⅴ-8）
    want = (rule or {}).get('curriculum') or []
    codes = {c.get('code') for c in d.get('curriculum') or [] if isinstance(c, dict)}
    if want and not codes & set(want):
        r.err('curriculum', f'{tier} 的作文要標課綱 {"、".join(want)}（評估、提出方案；SPEC §3.5）')


def check_lot_writing(r, lot, live, complete):
    """中譯英、作文的整批檢查：主題不重複、照批次規格的主題；中譯英另查中文題目重複與句型涵蓋，作文另查題型配額與第二段任務輪替。"""
    st = lot.get('section_type')
    soft = r.err if complete else r.warn
    tail = '' if complete else '（尚未產生完畢，先列為 warning）'
    topics = Counter()
    for _, d in live:
        t = ((d.get('group') or {}).get('tags') or {}).get('topic')
        if isinstance(t, str) and t.strip():
            topics[t.strip()] += 1
    dup = sorted(t for t, n in topics.items() if n > 1)
    if dup:
        r.err('lot', f'同一批有重複的主題：{dup}（主題不重複）')
    planned = [t.get('topic_zh') for t in lot.get('topics') or [] if isinstance(t, dict) and isinstance(t.get('topic_zh'), str)]
    if planned:
        off = sorted(t for t in topics if t not in planned)
        if off:
            r.warn('lot', f'題組主題 {off[:5]} 不在批次規格的 topics（group.tags.topic 要逐字照抄 topic_zh）')
    r.metrics['topics'] = len(topics)
    if st == 'translation':
        stems = Counter(q.get('stem').strip() for _, d in live for q in questions_of(d) if isinstance(q.get('stem'), str))
        same = sorted(s for s, n in stems.items() if n > 1)
        if same:
            r.err('lot', f'同一批有重複的中文題目：{same[:3]}')
        used = Counter()
        for _, d in live:
            rb = rubric_items(d, 'translation') or {}
            for it in (rb.get('items') or {}).values() if isinstance(rb.get('items'), dict) else []:
                for p in it.get('patterns') or [] if isinstance(it, dict) else []:
                    if isinstance(p, dict) and isinstance(p.get('grammar_id'), str):
                        used[p['grammar_id']] += 1
        r.metrics['grammar_ids'] = dict(sorted(used.items()))
        want = (lot.get('pattern_coverage') or {}).get('required_grammar_ids') or []
        missing = sorted(set(want) - set(used))
        if live and missing:
            soft('lot', f'批次規格要涵蓋的句型還沒用到：{missing}' + tail)
    elif st == 'composition':
        types = Counter((rubric_items(d, 'composition') or {}).get('prompt_type') for _, d in live)
        r.metrics['prompt_types'] = {str(k): v for k, v in sorted(types.items(), key=lambda x: str(x[0]))}
        quota = {k: v for k, v in (lot.get('prompt_type_quota') or {}).items() if ve.is_int(v)}
        for k, want in sorted(quota.items()):
            if live and types.get(k, 0) != want:
                soft('lot', f'題型 {k} 有 {types.get(k, 0)} 題，批次規格是 {want} 題' + tail)
        p2 = Counter()
        for _, d in live:
            rb = rubric_items(d, 'composition') or {}
            codes = tuple(sorted({m.get('code') for m in rb.get('moves') or [] if isinstance(m, dict) and m.get('paragraph') == 2
                                  and isinstance(m.get('code'), str)}))
            if codes:
                p2[codes] += 1
        many = sorted('+'.join(k) for k, n in p2.items() if n > 3)
        if many:
            r.warn('lot', f'第二段任務組合 {many} 在同一批用了 4 次以上（出題規格書 WRT-CMP-TSK-02：第二段任務要輪替）')


TYPE_CHECKS = {'vocabulary': check_vocabulary, 'cloze': check_cloze, 'word_bank': check_word_bank,
               'structure': check_structure, 'reading': check_reading, 'mixed': check_mixed,
               'translation': check_translation, 'composition': check_composition}


def check_file(path):
    path = Path(path)
    r = Report(str(path))
    try:
        d = load_json(path)
    except Exception as e:  # noqa: BLE001
        r.err('file', f'JSON 解析失敗：{e}')
        return r, None
    if not isinstance(d, dict):
        r.err('top', '頂層必須是物件')
        return r, None
    return check_bank(path, d, r), d


def check_bank(path, d, r=None):
    """檢查已讀進來的 bank 資料（record_verification.py 寫入前也用這個）。"""
    path = Path(path)
    r = r or Report(str(path))
    check_path(r, path, d)
    check_top(r, d)
    if isinstance(d.get('group'), dict):
        check_group(r, d)
        check_annotations(r, d)
        if d.get('section_type') in TYPE_CHECKS:
            TYPE_CHECKS[d['section_type']](r, d)
        elif d.get('section_type') in tiers_spec()['bank_section_types']:
            r.warn('top', f'{d["section_type"]} 的題型專屬檢查尚未實作（目前只做共通檢查）')
        check_metrics(r, d)
    check_meta(r, d, path)
    check_verification(r, d)
    return r


# ---------------------------------------------------------------------------
# 整批（--lot）
# ---------------------------------------------------------------------------

def check_lot(lot_path, banks):
    """banks：[(path, data)]，已讀好的 bank 檔案（--all 時是全部；否則掃 data/bank/v1）。"""
    r = Report(str(lot_path))
    try:
        lot = load_json(lot_path)
    except Exception as e:  # noqa: BLE001
        r.err('lot', f'JSON 解析失敗：{e}')
        return r
    lot_id = lot.get('lot')
    if not isinstance(lot_id, str) or Path(lot_path).stem != lot_id:
        r.err('lot', f'lot={lot_id!r} 必須等於檔名 {Path(lot_path).stem}')
    st, tier = lot.get('section_type'), lot.get('tier')
    mine = [(p, d) for p, d in banks if isinstance(d, dict) and (d.get('generation') or {}).get('lot') == lot_id]
    live = [(p, d) for p, d in mine if d.get('status') != 'rejected']
    count = lot.get('count')
    per = lot.get('questions_per_group')
    if not ve.is_int(count):
        r.err('lot', 'count 必須是整數')
        count = None
    elif len(live) > count:
        r.err('lot', f'這一批有 {len(live)} 組（不含 rejected），超過批次規格的 {count} 組')
    elif len(live) < count:
        r.warn('lot', f'這一批目前 {len(live)} 組（不含 rejected），批次規格是 {count} 組（尚未產生完畢）')
    complete = count is not None and len(live) == count
    for p, d in live:
        if d.get('section_type') != st or d.get('tier') != tier:
            r.err(str(p), f'題型／難度 {d.get("section_type")}/{d.get("tier")} 與批次規格 {st}/{tier} 不同')
        n = len(questions_of(d))
        if ve.is_int(per) and n != per:
            r.err(str(p), f'{n} 題，批次規格每組 {per} 題')
    if st == 'mixed':
        # 混合題：只算多選題的正解字母（填充、簡答的答案是英文字）
        letters = Counter(k for _, d in live for q in questions_of(d) if isinstance(q.get('answer'), list)
                          for k in q['answer'] if isinstance(k, str))
    elif st in WRITING_TYPES:
        letters = Counter()   # 中譯英的答案是譯文、作文沒有答案：不算字母分布
    else:
        letters = Counter(q.get('answer') for _, d in live for q in questions_of(d) if isinstance(q.get('answer'), str))
    total = sum(letters.values())
    if st in ('vocabulary', 'cloze', 'reading') and total:
        lo, hi = lot.get('answer_letter_share') or LETTER_SHARE
        for L in 'ABCD':
            share = letters.get(L, 0) / total
            if not lo - 1e-9 <= share <= hi + 1e-9:
                msg = f'答案 {L} 占 {share:.0%}（{letters.get(L, 0)}/{total}），應在 {lo:.0%}–{hi:.0%}'
                (r.err if complete else r.warn)('lot', msg + ('' if complete else '（尚未產生完畢，先列為 warning）'))
    avoid = {w.lower() for w in ((lot.get('avoid') or {}).get('answer_words') or []) if isinstance(w, str)}
    lex = tm.lexicon()
    for p, d in live:
        for q in questions_of(d):
            pool = option_pool(d, q)
            text = pool.get(q.get('answer')) if isinstance(q.get('answer'), str) else None
            if not isinstance(text, str):
                continue
            t = ve.strip_markup(text).strip().lower()
            lemmas = {t}
            if len(t.split()) == 1:
                lemmas |= {lex.entries[i]['word'].lower() for i in lex.lookup(t)}
            hit = lemmas & avoid
            if hit and st != 'structure':
                # 綜合測驗的轉承、文法格常用同一批字（thus、would），只提醒；詞彙題、文意選填是 error
                (r.warn if st == 'cloze' else r.err)(
                    str(p), f'第 {q.get("no")} 題正解「{text}」是要避開的近期正解字（{", ".join(sorted(hit))}）')
    r.metrics = {'groups': len(live), 'rejected': len(mine) - len(live), 'letters': dict(sorted(letters.items()))}
    if st in READING_TYPES:
        check_lot_reading_mixed(r, lot, live, complete, letters)
    elif st in WRITING_TYPES:
        check_lot_writing(r, lot, live, complete)
    if any(k in lot for k in SEQ2_LOT_KEYS):
        check_lot_seq2(r, lot, live, banks)
    return r


def check_lot_reading_mixed(r, lot, live, complete, letters):
    """閱讀、混合題的整批檢查：文本形式配額、SDG 配額；混合題另查近期正解字與多選正解字母集中度。"""
    st = lot.get('section_type')
    soft = r.err if complete else r.warn
    tail = '' if complete else '（尚未產生完畢，先列為 warning）'
    form_of = reading_form if st == 'reading' else mixed_form
    forms = Counter(form_of(d.get('group')) for _, d in live)
    r.metrics['forms'] = dict(sorted(forms.items()))
    if not live:
        return   # 還沒有任何題組：組數的 warning 已經列了，不再逐項列配額
    quota = {k: v for k, v in (lot.get('form_quota') or {}).items() if ve.is_int(v)}
    for k, want in sorted(quota.items()):
        if forms.get(k, 0) != want:
            msg = f'文本形式 {k} 有 {forms.get(k, 0)} 組，批次規格是 {want} 組'
            (soft if st == 'reading' else r.warn)('lot', msg + tail)
    extra = sorted(set(forms) - set(quota))
    if quota and extra:
        (soft if st == 'reading' else r.warn)('lot', f'文本形式 {"、".join(extra)} 不在批次規格的 form_quota' + tail)
    sq = lot.get('sdg_quota') or {}
    sdgs = [set(n for n in ((d.get('group') or {}).get('tags') or {}).get('sdgs') or [] if ve.is_int(n)) for _, d in live]
    focus = set(sq.get('focus_sdgs') or [])
    n_focus = sum(1 for x in sdgs if x & focus)
    need = sq.get('min_groups_with_focus_sdg') or 0
    if live and n_focus < need:
        soft('lot', f'SDG {"／".join(map(str, sorted(focus)))} 的篇數 {n_focus}，批次規格至少 {need} 篇（SPEC §5.2）' + tail)
    share = sq.get('min_share_with_any_sdg')
    if live and share is not None and complete and sum(1 for x in sdgs if x) / len(live) < share - 1e-9:
        r.warn('lot', f'有 SDG 標籤的篇數 {sum(1 for x in sdgs if x)}/{len(live)}，批次規格建議 ≥{share:.0%}')
    if st != 'mixed':
        return
    mx = lot.get('multi_select_key_letter_share_max')
    total = sum(letters.values())
    if mx is not None and total and complete:
        for k, n in sorted(letters.items()):
            if n / total > mx + 1e-9:
                r.warn('lot', f'多選正解字母 {k} 占 {n / total:.0%}（{n}/{total}），出題規格書 MIX-MUL-04 建議 ≤{mx:.0%}')
    avoid = {w.lower() for w in ((lot.get('avoid') or {}).get('answer_words') or []) if isinstance(w, str)}
    lex = tm.lexicon()
    for p, d in live:
        for q in questions_of(d):
            if q.get('mode') not in ('fill_in_blank', 'short_answer') or not isinstance(q.get('answer'), str):
                continue
            t = ve.strip_markup(q['answer']).strip().lower()
            lemmas = {t}
            if len(t.split()) == 1:
                lemmas |= {lex.entries[i]['word'].lower() for i in lex.lookup(t)}
            hit = lemmas & avoid
            if hit:
                r.warn(str(p), f'第 {q.get("no")} 題答案「{q["answer"]}」是要避開的近期正解字（{", ".join(sorted(hit))}）')


# ---------------------------------------------------------------------------
# 第 2 批起（make_lots.py --topics --avoid-existing-bank 產生的批次規格；data/bank/README.md §9）
# 批次規格有 assigned_topics／avoid_bank_answers／generation_notes 時才檢查；第一批的批次規格沒有這些欄位，結果不變。
# 組數照舊用該批的 count（第 2 批起各批組數不同，count 取自主題總表）。
# ---------------------------------------------------------------------------

SEQ2_LOT_KEYS = ('assigned_topics', 'avoid_bank_answers', 'generation_notes')


def check_lot_seq2(r, lot, live, banks):
    import make_lots as ml   # 延後載入：只有第 2 批起的批次規格用得到（比對用的函式和產生規格共用一份）
    notes = {x.get('id') for x in ((lot.get('generation_notes') or {}).get('items') or []) if isinstance(x, dict)}
    if 'assigned_topics' in lot:
        check_lot_topics(r, lot, live, banks, ml)
    if 'avoid_bank_answers' in lot:
        check_lot_bank_answers(r, lot, live, banks, ml)
    if 'GN-DISTRACTOR' in notes:
        check_lot_distractors(r, lot, live, ml)
    if 'GN-STRUCTURE-CLUES' in notes:
        check_lot_structure_clues(r, live, ml)
    if 'GN-BASIC-CONTEXT' in notes and lot.get('section_type') in ('word_bank', 'structure'):
        for p, d in live:
            if d.get('status') != 'verified':
                continue
            feas = ((d.get('annotations') or {}).get('elimination') or {}).get('feasible') or {}
            n = sum(1 for v in feas.values() if isinstance(v, list) and len(v) > 1) if isinstance(feas, dict) else 0
            if n < 2:
                r.warn(str(p), f'elimination.feasible 不只正解的格數 {n} < 2（GN-BASIC-CONTEXT：basic 每組至少 2 格要看上下文才排除）')


def check_lot_topics(r, lot, live, banks, ml):
    """GN-TOPIC：每組一個指定主題；tags.topic 照抄 topic_zh、主題不重複、指定的 SDG 與文本形式。"""
    st, lot_id = lot.get('section_type'), lot.get('lot')
    assigned = lot.get('assigned_topics')
    if not isinstance(assigned, list) or not all(isinstance(a, dict) for a in assigned):
        r.err('lot', 'assigned_topics 必須是物件陣列（每組一個主題）')
        return
    count = lot.get('count')
    if ve.is_int(count) and len(assigned) != count:
        r.err('lot', f'assigned_topics 有 {len(assigned)} 個主題，count 是 {count}（每組一個）')
    if [a.get('slot') for a in assigned] != list(range(1, len(assigned) + 1)):
        r.err('lot', f'assigned_topics 的 slot 應為 1–{len(assigned)} 連續')
    for a in assigned:
        if not a.get('topic_zh') or not a.get('angle_en'):
            r.err('lot', f'assigned_topics 第 {a.get("slot")} 組缺少 topic_zh 或 angle_en')
    names = Counter(ml.norm_topic(a.get('topic_zh')) for a in assigned if a.get('topic_zh'))
    for k, n in sorted(names.items()):
        if n > 1:
            r.err('lot', f'assigned_topics 的 topic_zh「{k}」出現 {n} 次')
    by_zh = {ml.norm_topic(a['topic_zh']): a for a in assigned if a.get('topic_zh')}
    used = defaultdict(list)
    for p, d in live:
        g = d.get('group') or {}
        tags = g.get('tags') or {}
        a = by_zh.get(ml.norm_topic(tags.get('topic'))) if tags.get('topic') else None
        if a is None:
            r.warn(str(p), f'tags.topic「{tags.get("topic")}」對不到 assigned_topics 的 topic_zh（GN-TOPIC：逐字照抄該組的 topic_zh）')
            continue
        used[a.get('slot')].append(Path(p).name)
        want = {n for n in a.get('sdgs') or [] if ve.is_int(n)}
        have = {n for n in tags.get('sdgs') or [] if ve.is_int(n)}
        if want - have:
            r.warn(str(p), f'主題「{a["topic_zh"]}」指定 SDG {sorted(want)}，tags.sdgs 是 {sorted(have)}（要包含指定的 SDG）')
        if a.get('form') and st in READING_TYPES:
            got = (reading_form if st == 'reading' else mixed_form)(g)
            if got != a['form']:
                r.warn(str(p), f'主題「{a["topic_zh"]}」指定文本形式 {a["form"]}，題組是 {got}')
    for slot, files in sorted(used.items()):
        if len(files) > 1:
            r.err('lot', f'第 {slot} 組的主題「{assigned[slot - 1]["topic_zh"]}」被 {len(files)} 組使用（每個主題只出一組）：{"、".join(files)}')
    for p, d in banks:
        if not isinstance(d, dict) or d.get('status') == 'rejected' or (d.get('generation') or {}).get('lot') == lot_id:
            continue
        topic = ((d.get('group') or {}).get('tags') or {}).get('topic')
        a = by_zh.get(ml.norm_topic(topic)) if topic else None
        if a:
            r.warn('lot', f'第 {a.get("slot")} 組的主題「{a["topic_zh"]}」已被其他批次的 {d.get("uid")}'
                          f'（{(d.get("generation") or {}).get("lot")}）用過')
    r.metrics['topics_used'] = f'{len(used)}/{len(assigned)}'


def check_lot_bank_answers(r, lot, live, banks, ml):
    """GN-AVOID：正解避開題庫已用過的正解字、正解句（批次規格裡的快照＋產生規格後其他批次新增的）。"""
    st, lot_id = lot.get('section_type'), lot.get('lot')
    ab = lot.get('avoid_bank_answers') or {}
    lex = tm.lexicon()
    same = {w.lower() for w in ab.get('answer_words') or [] if isinstance(w, str)}
    other = {w.lower() for w in ab.get('answer_words_other_sections') or [] if isinstance(w, str)}
    sentences = {norm_text(s).lower() for s in ab.get('answer_sentences') or [] if isinstance(s, str)}
    # 產生規格之後才進題庫的其他批次（不含本批；bank_answer_snapshot 本身不算 rejected）
    now = ml.bank_answer_snapshot([(p, d) for p, d in banks if isinstance(d, dict)
                                   and (d.get('generation') or {}).get('lot') != lot_id], lex)
    later_words = (now[st]['words'] - same) if st in now else set()
    later_sentences = ({norm_text(s).lower() for s in now[st]['sentences']} - sentences) if st in now else set()
    hard_word = st in ('vocabulary', 'word_bank')     # 詞彙題、文意選填是 error；綜合測驗、混合題是 warning
    in_lot = defaultdict(set)
    for p, d in live:
        for no, kind, text in ml.group_answers(d):
            if kind == 'word' and st in ml.WORD_ANSWER_SECTIONS:
                term = ml.word_term(text, lex)
                if not term:
                    continue
                in_lot[term].add(Path(p).name)
                if term in same:
                    (r.err if hard_word else r.warn)(
                        str(p), f'第 {no} 題正解「{text}」是題庫同題型已用過的正解（{term}；avoid_bank_answers.answer_words）')
                elif term in later_words:
                    r.warn(str(p), f'第 {no} 題正解「{text}」和題庫其他批次（產生批次規格後新增）的正解重複（{term}）')
                elif term in other:
                    r.warn(str(p), f'第 {no} 題正解「{text}」是其他題型已用過的正解（{term}；answer_words_other_sections）')
            elif kind == 'sentence' and st in ml.SENTENCE_ANSWER_SECTIONS:
                key = norm_text(text).lower()
                if key in sentences:
                    (r.err if st == 'structure' else r.warn)(
                        str(p), f'第 {no} 題正解句和題庫已用過的正解句相同（avoid_bank_answers.answer_sentences）：「{text[:60]}」')
                elif key in later_sentences:
                    r.warn(str(p), f'第 {no} 題正解句和題庫其他批次（產生批次規格後新增）的正解句相同：「{text[:60]}」')
    for term, files in sorted(in_lot.items()):
        if len(files) > 1:
            r.warn('lot', f'正解「{term}」在本批 {len(files)} 組都出現（避免同一個字在題庫反覆當正解）：{"、".join(sorted(files))}')


def check_lot_distractors(r, lot, live, ml):
    """GN-DISTRACTOR（詞彙題、綜合測驗）：同一 lot 內同一個干擾字只能出現在一組（error）；題庫已用過的干擾字列 warning。"""
    lex = tm.lexicon()
    used_before = {w.lower() for w in (lot.get('avoid_bank_answers') or {}).get('distractor_words') or [] if isinstance(w, str)}
    seen = defaultdict(set)
    for p, d in live:
        for no, text in ml.group_distractors(d):
            term = ml.word_term(text, lex)
            if not term:
                continue
            seen[term].add(Path(p).name)
            if term in used_before:
                r.warn(str(p), f'第 {no} 題干擾字「{text}」是題庫已用過的干擾字（{term}；avoid_bank_answers.distractor_words）')
    for term, files in sorted(seen.items()):
        if len(files) > 1:
            r.err('lot', f'干擾字「{term}」在本批 {len(files)} 組出現（GN-DISTRACTOR：同一 lot 內只能出現在一組）：{"、".join(sorted(files))}')


def check_lot_structure_clues(r, live, ml):
    """GN-STRUCTURE-CLUES：每組 4 格至少 3 種線索類型；同一種承接句型在 lot 內最多 BRIDGE_MAX_PER_LOT 次。"""
    bridges = defaultdict(list)
    for p, d in live:
        fam, missing = ml.clue_families_of(d)
        distinct = sorted({f for f in fam.values() if f})
        if missing:
            r.warn(str(p), f'第 {"、".join(map(str, missing))} 格沒填 clue_type（GN-STRUCTURE-CLUES：解析每格都要填）')
        if len(distinct) + len(missing) < 3:
            labels = '、'.join(ml.CLUE_FAMILY_LABELS[f] for f in distinct) or '無'
            r.err(str(p), f'線索類型只有 {len(distinct)} 種（{labels}），每組至少 3 種（GN-STRUCTURE-CLUES）')
        for key, opening in ml.bridge_openings(d):
            bridges[key].append(f'{Path(p).name}「{opening}…」')
    for key, items in sorted(bridges.items()):
        if len(items) > ml.BRIDGE_MAX_PER_LOT:
            r.warn('lot', f'承接句型 {key} 在本批出現 {len(items)} 次（上限 {ml.BRIDGE_MAX_PER_LOT}，GN-STRUCTURE-CLUES）：'
                          + '；'.join(items[:6]))


# ---------------------------------------------------------------------------

def collect_all():
    if not BANK_DIR.exists():
        return []
    return sorted(BANK_DIR.glob('*/*/*.json'))


def main(argv):
    ap = argparse.ArgumentParser(description='檢查 gsat-bank/v1 檔案')
    ap.add_argument('files', nargs='*', type=Path)
    ap.add_argument('--all', action='store_true', help='檢查 data/bank/v1 底下全部')
    ap.add_argument('--lot', type=Path, help='另外檢查這一批（data/bank/lots/<lot>.json）')
    ap.add_argument('--json', action='store_true', help='輸出機器可讀報告')
    ap.add_argument('--facts', nargs='*', type=Path, metavar='FACTS',
                    help='另外檢查事實單（data/bank/facts/*.json）；不給檔名就檢查全部')
    a = ap.parse_args(argv)
    paths = list(a.files)
    if a.all:
        paths += collect_all()
    if a.facts is not None:
        return main_facts(a, paths)
    if not paths and not a.lot:
        if a.all:
            msg = 'data/bank/v1 不存在或沒有任何檔案，略過' if not BANK_DIR.exists() or not collect_all() else ''
            if a.json:
                print(json.dumps({'ok': True, 'files': [], 'lot': None, 'message': msg}, ensure_ascii=False, indent=2))
            else:
                print(msg)
            return 0
        ap.print_help()
        return 2
    reports, banks = [], []
    for p in paths:
        rep, d = check_file(p)
        reports.append(rep)
        banks.append((p, d))
    lot_rep = None
    if a.lot:
        if not a.all:
            seen = {Path(p).resolve() for p in paths}
            banks += [(p, load_json(p)) for p in collect_all() if p.resolve() not in seen]
        lot_rep = check_lot(a.lot, banks)
    bad = any(rep.errors for rep in reports) or bool(lot_rep and lot_rep.errors)
    if a.json:
        print(json.dumps({'ok': not bad, 'files': [rep.as_dict() for rep in reports],
                          'lot': lot_rep.as_dict() if lot_rep else None}, ensure_ascii=False, indent=2))
    else:
        for rep in reports + ([lot_rep] if lot_rep else []):
            status = 'OK' if not rep.errors else 'FAIL'
            print(f'[{status}] {rep.name}: {len(rep.errors)} error, {len(rep.warnings)} warning')
            for e in rep.errors:
                print(f'  ERROR {e}')
            for w in rep.warnings:
                print(f'  warn  {w}')
    return 1 if bad else 0


def main_facts(a, paths):
    """--facts：檢查事實單（可以和題組檔、--lot 一起用；JSON 報告多一個 facts 陣列）。"""
    facts = list(a.facts) or (sorted(FACTS_DIR.glob('*.json')) if FACTS_DIR.exists() else [])
    fact_reps = [check_facts_file(p)[0] for p in facts]
    reports, banks = [], []
    for p in paths:
        rep, d = check_file(p)
        reports.append(rep)
        banks.append((p, d))
    lot_rep = None
    if a.lot:
        if not a.all:
            seen = {Path(p).resolve() for p in paths}
            banks += [(p, load_json(p)) for p in collect_all() if p.resolve() not in seen]
        lot_rep = check_lot(a.lot, banks)
    everything = fact_reps + reports + ([lot_rep] if lot_rep else [])
    bad = any(rep.errors for rep in everything)
    if a.json:
        print(json.dumps({'ok': not bad, 'files': [rep.as_dict() for rep in reports],
                          'lot': lot_rep.as_dict() if lot_rep else None,
                          'facts': [{'file': rep.name, 'ok': not rep.errors, 'errors': rep.errors, 'warnings': rep.warnings}
                                    for rep in fact_reps]}, ensure_ascii=False, indent=2))
    else:
        if not facts:
            print('data/bank/facts 沒有任何事實單，略過')
        for rep in everything:
            status = 'OK' if not rep.errors else 'FAIL'
            print(f'[{status}] {rep.name}: {len(rep.errors)} error, {len(rep.warnings)} warning')
            for e in rep.errors:
                print(f'  ERROR {e}')
            for w in rep.warnings:
                print(f'  warn  {w}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
