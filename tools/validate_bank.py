#!/usr/bin/env python3
"""檢查 AI 題庫檔案（gsat-bank/v1，data/bank/v1/{section_type}/{tier}/{uid}@{version}.json）。

用法：
    python3 tools/validate_bank.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json [...]
    python3 tools/validate_bank.py --all                          # data/bank/v1 底下全部
    python3 tools/validate_bank.py --lot data/bank/lots/word_bank-advanced-01.json   # 另做整批檢查
    python3 tools/validate_bank.py --json --all                   # 機器可讀報告

規格：docs/DB_SCHEMA.md §5.3（檔案格式）、SPEC §5.4（檢查清單）、SPEC §3.4–3.5（難度帶與題目規則，
資料取自 data/specs/tiers.json＝packages/shared/src/tiers.ts 的鏡像）。檔案說明見 data/bank/README.md。

共通檢查：欄位齊全且沒有未知欄位、uid／檔名／目錄（section_type、tier）一致、format_version、題號從 1 連續、
[[n]] 與小題一一對應、答案在選項內、選項不重複、選項數符合題型、文章指標落在難度帶（tools/text_metrics.py）、
課綱代碼存在、授權在白名單、解析的 evidence 逐字存在選文、沒有「推理過程」類欄位名、
annotations.elimination 的完美配對數剛好 1 且等於標準答案、status 與 verification 一致。
題型檢查：詞彙題（正解在詞表且級別符合難度、4 個選項詞性相同、干擾與正解不在同一個 OEWN synset）、
綜合測驗（5 格各 4 選項、考點組合）、文意選填（10 個選項各用一次、每格詞性相容選項數）、
篇章結構（5 個完整句、多餘句不是任何一格的答案）。閱讀、混合題、中譯英、作文目前只做共通檢查。
--lot：同一批的組數、每組題數、答案字母分布（詞彙、綜合：每個字母 20–30%）、要避開的近期正解字。

error 一定要修；warning 要人看一眼（SPEC §5.8：任何 warn 都進 100% 人工審核）。有 error 時結束碼為 1。
data/bank/v1 不存在或沒有檔案時印訊息並以 0 結束（CI 用）。只用標準函式庫。
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
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
CHECKED_TYPES = ('vocabulary', 'cloze', 'word_bank', 'structure')
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
            if not ve.check_keys(r, w, it, EXPLANATION_KEYS):
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
                if not isinstance(notes, dict) or any(k not in pool for k in notes):
                    r.err(w, 'option_notes_zh 的鍵必須是本題的選項代號')
                elif q.get('answer') in notes:
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
            elif s.get('role') == 'fact':
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


TYPE_CHECKS = {'vocabulary': check_vocabulary, 'cloze': check_cloze, 'word_bank': check_word_bank,
               'structure': check_structure}


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
    return r


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
    a = ap.parse_args(argv)
    paths = list(a.files)
    if a.all:
        paths += collect_all()
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


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
