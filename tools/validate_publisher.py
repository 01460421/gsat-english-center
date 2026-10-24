#!/usr/bin/env python3
"""出版社題組（gsat-pub/v1）的匯入檢查（docs/design/weak-paper.md §8.4、§8.5、§8.8）。P1 的骨架：契約、形狀、D8、歷屆原題。

用法（在專案根目錄）：
    python3 tools/validate_publisher.py --all                    # 檢查 data/publisher/*/v1/** 全部（目錄不存在時印訊息、以 0 結束）
    python3 tools/validate_publisher.py FILE [FILE ...]          # 指定檔案（路徑要在 {來源 id}/v1/{題型}/{難度}/ 底下）
    python3 tools/validate_publisher.py --all --json             # JSON 報告（每個檔案的 errors、warnings、g50）
    python3 tools/validate_publisher.py --sources PATH ...       # 換一份來源登記檔（預設 data/sources.json；測試用）

任何一份有 error 就以 1 結束；warning 是匯入檢查表要人工看的項目，不影響結果。

檢查（error）：
    - 契約（和建置的 packages/shared/scripts/bank-select.mjs publisherProblems 同一套）：schema、uid／version 和檔名一致、
      題型縮寫、放在 v1/{題型}/{難度}/ 底下、source_id 和目錄一致而且登記成出版社來源、source_ref、tier／tier_basis、
      tag_basis、explanation_basis 和 annotations 一致、skill_extra／scoring_extra 的形狀（鍵要是題號）、
      provenance（publisher-licensed／verbatim）、review（by、date、checks ⊇ answers、d8）、status。
    - 混合題的 open_key 只收 complete（站方已補齊所有可接受寫法；第一版不做自評）。
    - 形狀：題組與小題沿用 validate_exam.py 的檢查（作答方式、選項、答案在選項裡、題幹）；題號從 1 連續、label 等於題號、
      綜合測驗／文意選填／篇章結構的 [[n]] 空格和題號一致、選項代號從 A 起、填充簡答的可接受答案含原卷答案。
    - D8：所有字串比對官方參考譯文（8 個英文字）與評分原則（8 個漢字）的指紋（validate_bank.py 的 official_corpus）。
    - 不是歷屆原題（official_copy）：選文與題幹和 data/exams/parsed 的歷屆試題比對，8 個英文字的片段重疊 ≥ 30%，
      或有一題題幹完全相同（10 個字以上；"What is the passage mainly about?" 這種通用題幹不算）。
    - 出處句（provenance.attribution_text）不能含「大考中心」「CEEC」。
檢查（warning，列進匯入檢查表）：
    - 形狀和該大題的標準形狀（data/specs/tiers.json section_formats）不同：只進題庫練習，組卷池是 ex: 'shape'（§8.5）。
    - 題目本身出現「大考中心」「CEEC」。
    - 有作答統計時，G50 推估的難度（difficulty-bands.json 的 rule；只有全體答對率時讀 rule.imputation.p_only）和 tier 不同。
    - 來源停用或過了到期日（建置不會發布）。

只用標準函式庫。測試（tools/tests/test_validate_publisher.py）只用合成的測試題組，不讀任何出版社的資料。
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

import validate_bank as vb  # noqa: E402  — D8 指紋（official_corpus）、英文斷字、形狀規格
import validate_exam as ve  # noqa: E402  — gsat-exam/v1.1 的小題檢查

ROOT = TOOLS.parent
PUBLISHER_DIR = ROOT / 'data' / 'publisher'
SOURCES_FILE = ROOT / 'data' / 'sources.json'
BANDS_FILE = ROOT / 'data' / 'exams' / 'difficulty-bands.json'
PARSED_DIR = ROOT / 'data' / 'exams' / 'parsed'

SCHEMA = 'gsat-pub/v1'
FILENAME_RE = re.compile(r'^(pb\.(vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)\.json$')
SOURCE_ID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
UID_CODES = {'vocabulary': 'vo', 'cloze': 'cz', 'word_bank': 'wb', 'structure': 'st', 'reading': 'rd', 'mixed': 'mx'}
TIERS = ('basic', 'advanced', 'top')
TIER_BASES = ('stats', 'publisher', 'metrics', 'manual')
TAG_BASES = ('publisher', 'rules', 'agent', 'manual', 'none')
STATUSES = ('draft', 'verified', 'rejected')
REQUIRED_CHECKS = ('answers', 'd8')
FORBIDDEN_TERMS = ('大考中心', 'CEEC')
BLANK_SECTIONS = ('cloze', 'word_bank', 'structure')
OPEN_MODES = ('fill_in_blank', 'short_answer', 'table_completion')
TOP_KEYS = ({'schema', 'uid', 'version', 'source_id', 'source_ref', 'section_type', 'format_version', 'tier', 'tier_basis', 'group',
             'tag_basis', 'explanation_basis', 'provenance', 'review', 'status'},
            {'skill_extra', 'open_key', 'scoring_extra', 'annotations'})

# 歷屆原題比對（§8.8）
PAST_NGRAM = 8
PAST_OVERLAP_MAX = 0.30
PAST_STEM_MIN_TOKENS = 10


class Report(ve.Report):
    def __init__(self, name):
        super().__init__(name)
        self.g50 = None

    def as_dict(self):
        return {'file': self.name, 'ok': not self.errors, 'errors': self.errors, 'warnings': self.warnings, 'g50': self.g50}


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def taipei_today():
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)).date().isoformat()


def forbidden_terms(text):
    upper = (text or '').upper()
    return [t for t in FORBIDDEN_TERMS if t in upper]


def walk_strings(x, path=''):
    if isinstance(x, str):
        yield path, x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield from walk_strings(v, f'{path}.{k}' if path else str(k))
    elif isinstance(x, list):
        for i, v in enumerate(x):
            yield from walk_strings(v, f'{path}[{i}]')


# ---------------------------------------------------------------------------
# 來源登記
# ---------------------------------------------------------------------------

def load_sources(path=SOURCES_FILE):
    """data/sources.json → {id: 來源}。格式由網站建置（apps/web/scripts/lib/item-sources.mjs）完整檢查，這裡只取用得到的欄位。"""
    raw = load_json(path)
    sources = raw.get('sources') if isinstance(raw, dict) else None
    if not isinstance(sources, list):
        raise SystemExit(f'{path}: sources 必須是陣列')
    return {s['id']: s for s in sources if isinstance(s, dict) and isinstance(s.get('id'), str)}


# ---------------------------------------------------------------------------
# G50（difficulty-bands.json 的規則；匯入工具讀 JSON 的係數與門檻，不寫死）
# ---------------------------------------------------------------------------

_bands = None


def g50_rule(path=BANDS_FILE):
    global _bands
    if _bands is None:
        rule = load_json(path)['rule']
        imp = rule['imputation']
        _bands = {'theta': rule['theta'], 'full': imp['coefficients'], 'p_only': imp['p_only']}
    return _bands


def _linear(coef, values):
    return sum(coef[k] * v for k, v in values.items())


def question_targets(stats, rule):
    """一題的 (Pc, Pb, 依據)：有五等分組直接取；有 P、Ph、Pl 用 rule.imputation 的迴歸；只有 P 用 p_only；都沒有回 None。"""
    if not isinstance(stats, dict):
        return None
    fg = stats.get('five_groups')
    if isinstance(fg, list) and len(fg) == 5 and all(ve.is_rate(x) for x in fg):
        return fg[2], fg[1], 'five_group'
    p, ph, pl = stats.get('correct_rate'), stats.get('high_group'), stats.get('low_group')
    if ve.is_rate(p) and ve.is_rate(ph) and ve.is_rate(pl):
        x = {'const': 1.0, 'P': p, 'Ph': ph, 'Pl': pl}
        return _linear(rule['full']['Pc'], x), _linear(rule['full']['Pb'], x), 'imputed'
    if ve.is_rate(p):
        x = {'const': 1.0, 'P': p}
        return _linear(rule['p_only']['coefficients']['Pc'], x), _linear(rule['p_only']['coefficients']['Pb'], x), 'p_only'
    return None


def group_g50(questions, rule=None):
    """題組的 G50 難度（§8.5：各題推估的 Pc、Pb 取平均後套規則）；沒有任何作答統計回 None。"""
    rule = rule or g50_rule()
    rows = [t for t in (question_targets(q.get('stats'), rule) for q in questions if isinstance(q, dict)) if t is not None]
    if not rows:
        return None
    pc = sum(r[0] for r in rows) / len(rows)
    pb = sum(r[1] for r in rows) / len(rows)
    tier = 'basic' if pc >= rule['theta'] else 'advanced' if pb >= rule['theta'] else 'top'
    return {'tier': tier, 'Pc': round(pc, 4), 'Pb': round(pb, 4), 'basis': sorted({r[2] for r in rows}), 'n': len(rows)}


# ---------------------------------------------------------------------------
# 歷屆原題（§8.8 official_copy）
# ---------------------------------------------------------------------------

_past = None


def past_corpus():
    """data/exams/parsed 的選擇題型題組：{8 字片段: {題組}}、{題組: 片段數}、{正規化題幹: 出處}。結果快取（測試可以換掉）。"""
    global _past
    if _past is not None:
        return _past
    shingles, sizes, stems = {}, {}, {}
    for p in sorted(PARSED_DIR.glob('*.json')) if PARSED_DIR.exists() else []:
        try:
            exam = load_json(p)
        except Exception:  # noqa: BLE001 — 壞檔由 validate_exam.py 回報
            continue
        eid = exam.get('id') or p.stem
        for s in exam.get('sections') or []:
            if s.get('type') in ('translation', 'composition'):
                continue
            for g in s.get('groups') or []:
                gid = f'{eid} {g.get("id")}'
                own = set(ngrams(group_text(g)))
                sizes[gid] = len(own)
                for k in own:
                    shingles.setdefault(k, set()).add(gid)
                for q in g.get('questions') or []:
                    toks = vb.en_tokens(ve.strip_markup(q.get('stem') or ''))
                    if len(toks) >= PAST_STEM_MIN_TOKENS:
                        stems.setdefault(' '.join(toks), f'{eid} 第 {q.get("label")} 題')
    _past = {'shingles': shingles, 'sizes': sizes, 'stems': stems}
    return _past


def group_text(g):
    parts = [g.get('passage') or '']
    parts += [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    parts += [q.get('stem') or '' for q in g.get('questions') or [] if isinstance(q, dict)]
    return '\n'.join(ve.strip_markup(ve.BLANK_RE.sub(' ', x)) for x in parts)


def ngrams(text, n=PAST_NGRAM):
    toks = vb.en_tokens(text)
    return [' '.join(toks[i:i + n]) for i in range(len(toks) - n + 1)]


def past_overlap(g):
    """(最高重疊比例, 出處) 與完全相同的題幹清單。"""
    corpus = past_corpus()
    own = set(ngrams(group_text(g)))
    best = (0.0, None)
    if own:
        hits = {}
        for k in own:
            for gid in corpus['shingles'].get(k, ()):
                hits[gid] = hits.get(gid, 0) + 1
        for gid, n in hits.items():
            ratio = n / len(own)
            if ratio > best[0]:
                best = (ratio, gid)
    same = []
    for q in g.get('questions') or []:
        if not isinstance(q, dict):
            continue
        toks = vb.en_tokens(ve.strip_markup(q.get('stem') or ''))
        key = ' '.join(toks)
        if len(toks) >= PAST_STEM_MIN_TOKENS and key in corpus['stems']:
            same.append((q.get('label'), corpus['stems'][key]))
    return best, same


# ---------------------------------------------------------------------------
# 檢查
# ---------------------------------------------------------------------------

def is_label_list(x):
    return isinstance(x, list) and len(x) > 0 and all(isinstance(v, str) and v.strip() for v in x)


def location_of(path):
    """{來源 id}/v1/{題型}/{難度}/{檔名} → (來源 id, 題型目錄, 難度目錄)；不符合回 None。"""
    parts = Path(path).resolve().parts
    if len(parts) < 5 or parts[-4] != 'v1':
        return None
    return parts[-5], parts[-3], parts[-2]


def check_contract(r, d, path, sources, today):
    m = FILENAME_RE.match(Path(path).name)
    if not m:
        r.err('file', '檔名必須是 pb.{題型}.{6 位十六進位}@{版本}.json')
        return
    uid, code, version = m.group(1), m.group(2), int(m.group(3))
    ve.check_keys(r, 'top', d, TOP_KEYS)
    if d.get('schema') != SCHEMA:
        r.err('schema', f'必須是 {SCHEMA}')
    if d.get('uid') != uid or d.get('version') != version:
        r.err('uid', f'uid／version（{d.get("uid")}@{d.get("version")}）和檔名不一致')
    section = d.get('section_type')
    if section not in UID_CODES:
        r.err('section_type', f'{section!r} 第一版不收（只收 {"、".join(UID_CODES)}）')
    elif UID_CODES[section] != code:
        r.err('uid', f'uid 的題型縮寫和 section_type {section} 不一致')
    if d.get('tier') not in TIERS:
        r.err('tier', f'{d.get("tier")!r} 不是 basic／advanced／top')
    loc = location_of(path)
    if loc is None:
        r.err('file', '要放在 data/publisher/{來源 id}/v1/{題型}/{難度}/ 底下')
    else:
        src_dir, sec_dir, tier_dir = loc
        if sec_dir != section or tier_dir != d.get('tier'):
            r.err('file', f'應該放在 v1/{section}/{d.get("tier")}/ 底下')
        if d.get('source_id') != src_dir:
            r.err('source_id', f'{d.get("source_id")!r} 和目錄 {src_dir} 不一致')
    sid = d.get('source_id')
    src = sources.get(sid) if isinstance(sid, str) else None
    if not isinstance(sid, str) or not SOURCE_ID_RE.match(sid):
        r.err('source_id', '必須是小寫英數與連字號')
    elif src is None or src.get('ns') != 'pb' or src.get('kind') != 'publisher':
        r.err('source_id', f'{sid} 不在來源登記檔裡（或不是出版社來源）')
    else:
        until = (src.get('licence') or {}).get('until')
        if src.get('active') is not True or (isinstance(until, str) and today > until):
            r.warn('source_id', f'來源 {sid} 停用或過了到期日：建置不會發布')
    if not ve.nonempty_str(d.get('format_version')):
        r.err('format_version', '缺少 format_version')
    ref = d.get('source_ref')
    if not isinstance(ref, dict) or not is_label_list(ref.get('labels')) or not ve.str_or_null(ref.get('paper')):
        r.err('source_ref', '必須是 { paper, labels: [原卷題號…] }')
    if d.get('tier_basis') not in TIER_BASES:
        r.err('tier_basis', f'必須是 {"／".join(TIER_BASES)}')
    if d.get('tag_basis') not in TAG_BASES:
        r.err('tag_basis', f'必須是 {"／".join(TAG_BASES)}')
    ann = d.get('annotations')
    has_expl = isinstance(ann, dict) and isinstance(ann.get('explanations'), dict)
    basis = d.get('explanation_basis')
    if basis == 'publisher':
        if not has_expl:
            r.err('explanation_basis', '是 publisher，但沒有 annotations.explanations')
    elif basis is None:
        if has_expl:
            r.err('explanation_basis', '是 null，不能有 annotations.explanations')
    else:
        r.err('explanation_basis', '必須是 publisher 或 null')
    if section == 'mixed':
        if d.get('open_key') != 'complete':
            r.err('open_key', '混合題的 open_key 必須是 complete（站方已補齊所有可接受答案；第一版不做自評）')
    elif d.get('open_key') is not None:
        r.err('open_key', '只有混合題可以有 open_key')
    labels = {q.get('label') for q in (d.get('group') or {}).get('questions') or [] if isinstance(q, dict)}
    extra = d.get('skill_extra')
    if extra is not None:
        ok = isinstance(extra, dict) and all(isinstance(e, dict) and all(k in ('clue_type', 'sense') and isinstance(v, str) for k, v in e.items())
                                             for e in extra.values())
        if not ok:
            r.err('skill_extra', '必須是 {題號: {clue_type?, sense?}}')
        elif set(extra) - labels:
            r.err('skill_extra', f'有不存在的題號 {sorted(set(extra) - labels)}')
    scoring = d.get('scoring_extra')
    if scoring is not None:
        ok = isinstance(scoring, dict) and all(
            isinstance(e, dict) and set(e) <= {'partial_credit_forms', 'interchangeable_with'}
            and (e.get('partial_credit_forms') is None or is_label_list(e.get('partial_credit_forms')))
            and (e.get('interchangeable_with') is None or ve.is_int(e.get('interchangeable_with')))
            for e in scoring.values())
        if not ok:
            r.err('scoring_extra', '必須是 {題號: {partial_credit_forms?, interchangeable_with?}}')
        elif set(scoring) - labels:
            r.err('scoring_extra', f'有不存在的題號 {sorted(set(scoring) - labels)}')
    pv = d.get('provenance')
    if not isinstance(pv, dict) or pv.get('license') != 'publisher-licensed' or pv.get('derivation') != 'verbatim':
        r.err('provenance', '必須是 publisher-licensed／verbatim')
    elif forbidden_terms(pv.get('attribution_text') or ''):
        r.err('provenance.attribution_text', f'出處句不能含 {"、".join(forbidden_terms(pv.get("attribution_text")))}')
    rv = d.get('review')
    checks = rv.get('checks') if isinstance(rv, dict) and isinstance(rv.get('checks'), list) else []
    if not isinstance(rv, dict) or not ve.nonempty_str(rv.get('by')) or not (isinstance(rv.get('date'), str) and ISO_DATE_RE.match(rv['date'])) \
            or not all(c in checks for c in REQUIRED_CHECKS):
        r.err('review', f'要有 by、date（YYYY-MM-DD）與 checks（至少 {"、".join(REQUIRED_CHECKS)}）')
    if d.get('status') not in STATUSES:
        r.err('status', f'必須是 {"／".join(STATUSES)}')


def check_shape(r, d):
    g = d.get('group')
    section = d.get('section_type')
    if not ve.check_keys(r, 'group', g, ve.GROUP_KEYS):
        return
    qs = g.get('questions') if isinstance(g.get('questions'), list) else []
    if not qs:
        r.err('group', '題組沒有任何小題')
    for qi, q in enumerate(qs):
        if not isinstance(q, dict):
            r.err('group', '小題必須是物件')
            continue
        qw = f'group.q{q.get("label", qi)}'
        if q.get('scoring_notes') is not None:
            r.err(qw, 'scoring_notes 不收（出版社的評分說明不發布）')
        # validate_exam 的欄位表要求 scoring_notes：出版社檔可以省略，比對時補成 null。
        ve.check_question(r, qw, {'scoring_notes': None, **q}, section, g, None)
        if q.get('label') != str(q.get('no')):
            r.err(qw, f'label 應等於題號字串（no={q.get("no")!r}，label={q.get("label")!r}）')
        opts = q.get('options')
        if isinstance(opts, dict):
            letters = sorted(opts)
            if letters != [chr(65 + i) for i in range(len(letters))]:
                r.err(qw, f'選項代號應從 A 依序排列（目前 {letters}）')
        if q.get('mode') in OPEN_MODES:
            acc = q.get('accepted_answers')
            if not (isinstance(acc, list) and acc and isinstance(q.get('answer'), str) and q['answer'] in acc):
                r.err(qw, '填充、簡答的 accepted_answers 要列出所有可接受寫法（含原卷答案）')
    nos = [q.get('no') for q in qs if isinstance(q, dict)]
    if nos != list(range(1, len(nos) + 1)):
        r.err('group', f'題號應從 1 連續編號，目前是 {nos}')
    text = (g.get('passage') or '') + ''.join('\n' + (p.get('text') or '') for p in g.get('passage_parts') or [] if isinstance(p, dict))
    if section in BLANK_SECTIONS:
        blanks = [int(x) for x in ve.BLANK_RE.findall(text)]
        if blanks != nos:
            r.err('group', f'選文中的空格 {blanks} 與小題題號 {nos} 不一致（空格寫成 [[題號]]，每格只出現一次）')
    ref = d.get('source_ref')
    if isinstance(ref, dict) and is_label_list(ref.get('labels')) and len(ref['labels']) != len(qs):
        r.warn('source_ref', f'原卷題號 {len(ref["labels"])} 個，題組有 {len(qs)} 題')
    # 標準形狀（§8.5）：不同的只進題庫練習。
    fmt = vb.tiers_spec()['section_formats'].get(section)
    if fmt:
        modes_ok = all(isinstance(q, dict) and q.get('mode') in fmt['modes'] for q in qs)
        opts_ok = not fmt['options_per_question'] or all(isinstance(q, dict) and isinstance(q.get('options'), dict)
                                                         and len(q['options']) == fmt['options_per_question'] for q in qs)
        bank = g.get('options_bank')
        bank_ok = not fmt['bank_options'] or (isinstance(bank, dict) and len(bank) == fmt['bank_options'])
        if len(qs) != fmt['questions'] or not modes_ok or not opts_ok or not bank_ok or d.get('format_version') != fmt['format_version']:
            r.warn('shape', f'和 {section} 的標準形狀 {fmt["format_version"]} 不同（format_version {d.get("format_version")!r}）：'
                            '只進題庫練習，不進任何卷子（ex: shape）')


def check_d8(r, d):
    """所有字串比對官方參考譯文與評分原則的指紋（命中就拒收）。"""
    for where, s in walk_strings({k: d.get(k) for k in ('group', 'annotations', 'scoring_extra')}):
        en = vb.official_en_overlap(s)
        if en:
            r.err(where, f'D8：和官方參考譯文相同的片段「{en[0]}」（{en[1]}）')
        han = vb.official_han_overlap(s)
        if han:
            r.err(where, f'D8：和官方評分原則相同的片段「{han[0]}」（{han[1]}）')


def check_past(r, d):
    g = d.get('group')
    if not isinstance(g, dict):
        return
    (ratio, gid), same = past_overlap(g)
    if ratio >= PAST_OVERLAP_MAX:
        r.err('group', f'official_copy：和歷屆試題 {gid} 的 {PAST_NGRAM} 字片段重疊 {ratio:.0%}（≥ {PAST_OVERLAP_MAX:.0%}）')
    for label, where in same:
        r.err(f'group.q{label}', f'official_copy：題幹和 {where} 完全相同')


def check_terms(r, d):
    for where, s in walk_strings({k: d.get(k) for k in ('group', 'annotations')}):
        hit = forbidden_terms(s)
        if hit:
            r.warn(where, f'題目內容出現 {"、".join(hit)}：列進人工檢查表')


def check_g50(r, d):
    g = d.get('group')
    if not isinstance(g, dict):
        return
    res = group_g50(g.get('questions') or [])
    r.g50 = res
    if res and d.get('tier') in TIERS and res['tier'] != d.get('tier'):
        r.warn('tier', f'G50 推估是 {res["tier"]}（{"、".join(res["basis"])}；Pc {res["Pc"]}、Pb {res["Pb"]}），檔案標 {d.get("tier")}：請站主確認（預設採 G50）')


def check_file(path, sources, today=None):
    r = Report(str(path))
    try:
        d = load_json(path)
    except Exception as e:  # noqa: BLE001
        r.err('file', f'讀不到 JSON：{e}')
        return r
    if not isinstance(d, dict):
        r.err('file', '最外層必須是物件')
        return r
    check_contract(r, d, path, sources, today or taipei_today())
    check_shape(r, d)
    check_d8(r, d)
    check_past(r, d)
    check_terms(r, d)
    check_g50(r, d)
    return r


def check_duplicate_uids(files, reports):
    """跨檔檢查：同一個 uid 出現在兩個出版社來源（建置的 selectPublisherGroups 也會擋，這裡先在匯入檢查表列出）。"""
    owner = {}
    for path, r in zip(files, reports):
        m = FILENAME_RE.match(Path(path).name)
        loc = location_of(path)
        if not m or not loc:
            continue
        uid, source = m.group(1), loc[0]
        seen = owner.get(uid)
        if seen and seen[0] != source:
            r.err('uid', f'uid {uid} 也出現在來源 {seen[0]}（{seen[1]}）：出版社題組的 uid 在所有來源之間不能重複')
        else:
            owner.setdefault(uid, (source, str(path)))


def collect_all(root=PUBLISHER_DIR):
    if not root.exists():
        return []
    return sorted(p for p in root.glob('*/v1/**/*.json'))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('files', nargs='*')
    ap.add_argument('--all', action='store_true', help='檢查 data/publisher/*/v1/** 全部')
    ap.add_argument('--sources', default=str(SOURCES_FILE), help='來源登記檔（預設 data/sources.json）')
    ap.add_argument('--json', action='store_true', help='輸出 JSON 報告')
    a = ap.parse_args(argv)
    files = [Path(f) for f in a.files] + (collect_all() if a.all else [])
    if not files:
        print('沒有找到要檢查的出版社題組（data/publisher 不存在或是空的）')
        return 0
    sources = load_sources(a.sources)
    reports = [check_file(f, sources) for f in files]
    check_duplicate_uids(files, reports)
    if a.json:
        print(json.dumps([x.as_dict() for x in reports], ensure_ascii=False, indent=1))
    else:
        for x in reports:
            print(f'{"OK " if not x.errors else "ERR"} {x.name}')
            for e in x.errors:
                print(f'  error   {e}')
            for w in x.warnings:
                print(f'  warning {w}')
        bad = sum(1 for x in reports if x.errors)
        print(f'{len(reports)} 個檔案，{bad} 個有 error')
    return 1 if any(x.errors for x in reports) else 0


if __name__ == '__main__':
    sys.exit(main())
