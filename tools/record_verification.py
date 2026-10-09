#!/usr/bin/env python3
"""把驗證結果寫進 gsat-bank/v1 檔案的 verification，算唯一正解並判定 status（SPEC §5.2 步驟 4–9、§5.6、§5.7）。

用法：
    python3 tools/record_verification.py BANK.json --blind-a a.json --blind-b b.json --audit audit.json
    python3 tools/record_verification.py BANK.json ... --extra similarity.json --extra fact_check.json
    python3 tools/record_verification.py BANK.json ... --dry-run          # 只印結果，不寫檔
    python3 tools/record_verification.py BANK.json ... --json             # 機器可讀摘要

輸入檔的格式（盲解 gsat-bank-blind/v1、稽核 gsat-bank-audit/v1、其他檢查 gsat-bank-check/v1）見 data/bank/README.md。

做的事：
    1. program：用 tools/validate_bank.py 檢查題組本身（不含 status／verification 的一致性），順便重算 metrics。
    2. blind_solver ×2：答案等於標準答案、信心至少 medium、also_plausible 為空、證據句逐字在選文裡；
       文意選填與篇章結構還要有每格的 feasible（可行選項集合）。
       混合題（SPEC §5.6）：多選的 answer 是代號陣列，每個選項的判斷（選或不選）都要和標準答案一致，also_plausible
       （「可能也對」的選項）必須為空；超越頂標標 E2 的正解，兩位盲解者在 option_evidence 引用的證據句要有交集。
       填充、簡答的 answer 是字串，正規化後（SPEC §4.6）要在 accepted_answers 內，also_plausible 列的其他寫法也都要在
       accepted_answers 內（否則是可接受答案清單不完整，出題規格書 MIX-FIL-07）。
    3. distractor_audit：每個錯誤選項都有判定（文意選填可只判詞性相容的選項，缺的列 warn），
       沒有任何 arguably_acceptable，證據句逐字在選文裡。
    4. unique_solution（文意選填、篇章結構）：兩位盲解者的可行集合取聯集寫成 annotations.elimination，
       算「每格各放一個不同選項」的填法數，必須剛好 1 且等於標準答案；篇章結構的多餘句在每一格都不可行。
    5. 判定：上面全部通過（warn 也算通過，但人工審核會 100% 看）且 --extra 沒有 fail → verified；
       否則 rejected，status_reason 列出原因。缺少必要的輸入時維持 draft，不判定。
中譯英、作文（README §5.5、§5.6；SPEC §5.7）不做干擾選項稽核（給 --audit 是輸入錯誤），--blind-a／--blind-b 改成：
    中譯英「盲譯」（gsat-bank-blind-translation/v1）：驗證者只看學生畫面資料的中文題目自己翻譯（answers），寫完才打開題組檔
       對答案（review）。程式比對：譯文命中標的詞彙 ≥80%（出題規格書 WRT-TRN-KEY-02）、自然用到這一句全部的標的句型、
       譯文落在可接受寫法內、參考譯文與 4 部分切分的判定不是 fail（warn 列 warning）。
    作文「盲評」（gsat-bank-blind-grading/v1）：驗證者只看題目與兩篇範文（student_view.py --grading，中性代號 E1、E2），
       依評分規準給四項分數。穩健版總分要在 14–17、頂標版 18–20，切題、回應每項要求、沒有語言錯誤；兩位評分差 >2 分時
       兩份都判 fail（出題規格書 WRT-MOD-SCR-01）。
    兩位驗證者（A、B）都通過、program 沒有 error → verified。
同一種檢查重跑時取代舊紀錄（盲解依 A／B 分別取代）。結束碼：0 verified、1 rejected、2 輸入錯誤、3 輸入不齊（draft）。
"""
import argparse
import copy
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import text_metrics as tm  # noqa: E402
import validate_bank as vb  # noqa: E402

TOOL = 'record_verification.py'
CONFIDENCE = ('high', 'medium', 'low')
VERDICTS = ('clearly_wrong', 'arguably_acceptable')
ERROR_TYPES = ('pos_mismatch', 'grammar', 'collocation', 'meaning', 'logic', 'register', 'cohesion', 'off_topic',
               'factual', 'other')
BLIND_KEYS = ({'schema', 'uid', 'version', 'solver', 'reviewer', 'answers'}, {'session_id', 'created_at'})
ANSWER_KEYS = ({'answer', 'confidence', 'also_plausible', 'evidence', 'explanation_zh'}, {'feasible'})
# 混合題多選：多一個選填的 option_evidence（{選項代號: [逐字證據句]}）
MULTI_ANSWER_KEYS = ({'answer', 'confidence', 'also_plausible', 'evidence', 'explanation_zh'}, {'option_evidence'})
OPEN_MODES = ('fill_in_blank', 'short_answer')
AUDIT_KEYS = ({'schema', 'uid', 'version', 'reviewer', 'items'}, {'session_id', 'created_at'})
JUDGEMENT_KEYS = ({'verdict', 'error_type', 'evidence', 'explanation_zh'}, set())
EXTRA_KEYS = ({'schema', 'uid', 'version', 'kind', 'reviewer', 'result', 'details'}, {'created_at'})
# 中譯英盲譯、作文盲評（README §5.5、§5.6）
BLIND_TRANSLATION_SCHEMA = 'gsat-bank-blind-translation/v1'
BLIND_GRADING_SCHEMA = 'gsat-bank-blind-grading/v1'
BLIND_TR_KEYS = ({'schema', 'uid', 'version', 'solver', 'reviewer', 'answers', 'review'}, {'session_id', 'created_at'})
TR_ANSWER_KEYS = ({'translation', 'confidence', 'explanation_zh'}, set())
TR_REVIEW_KEYS = ({'used_patterns', 'used_target_words', 'within_accepted', 'reference_check', 'parts_check', 'issues_zh'},
                  {'closest_reference'})
BLIND_GR_KEYS = ({'schema', 'uid', 'version', 'solver', 'reviewer', 'essays', 'prompt_check', 'issues_zh'},
                 {'session_id', 'created_at'})
ESSAY_GRADE_KEYS = ({'scores', 'off_topic', 'covers_all_tasks', 'errors', 'comment_zh'}, set())
GRADE_ERROR_KEYS = ({'excerpt', 'explanation_zh'}, {'suggestion'})
CHECK_RESULTS = ('pass', 'warn', 'fail')
TARGET_HIT_RATE_MIN = 0.8     # 出題規格書 WRT-TRN-KEY-02：盲譯命中 ≥80% 標的詞
GRADER_GAP_MAX = 2            # 出題規格書 WRT-MOD-SCR-01：兩位評分代理差 ≤2


class InputError(Exception):
    pass


def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def keys_problems(obj, spec, where):
    if not isinstance(obj, dict):
        return [f'{where} 必須是物件']
    req, opt = spec
    out = [f'{where} 缺少欄位 {k}' for k in sorted(req - obj.keys())]
    out += [f'{where} 有未知欄位 {k}' for k in sorted(obj.keys() - req - opt)]
    out += [f'{where} 的欄位名「{k}」屬於「推理過程」類' for k in obj if vb.forbidden_key(k)]
    return out


def load_input(path, spec, schema, bank):
    try:
        d = json.loads(Path(path).read_text(encoding='utf-8'))
    except Exception as e:  # noqa: BLE001
        raise InputError(f'{path}: JSON 解析失敗：{e}') from e
    probs = keys_problems(d, spec, Path(path).name)
    if probs:
        raise InputError('；'.join(probs))
    if d.get('schema') != schema:
        raise InputError(f'{path}: schema 應為 {schema}（目前 {d.get("schema")!r}）')
    if d.get('uid') != bank.get('uid') or d.get('version') != bank.get('version'):
        raise InputError(f'{path}: uid／version（{d.get("uid")}@{d.get("version")}）與題組 {bank.get("uid")}@{bank.get("version")} 不同')
    return d


def program_entry(path, bank):
    """題組本身的程式檢查：status、verification、elimination 由本工具寫，先拿掉再檢查。"""
    d = copy.deepcopy(bank)
    d['status'], d['verification'] = 'draft', []
    d.pop('status_reason', None)
    if isinstance(d.get('annotations'), dict):
        d['annotations']['elimination'] = None
    r = vb.check_bank(path, d)
    warnings = [w for w in r.warnings if 'status 仍是 draft' not in w and 'metrics 還是 null' not in w]
    result = 'fail' if r.errors else ('warn' if warnings else 'pass')
    return {'kind': 'program', 'reviewer': 'validate_bank.py', 'result': result, 'created_at': now(),
            'details': {'errors': r.errors, 'warnings': warnings}}


def blind_entry(d, bank, role):
    key = vb.answer_key(bank)
    st = bank.get('section_type')
    hay = vb.evidence_haystacks(bank)
    problems = []
    if d.get('solver') != role:
        problems.append(f'檔案的 solver 是 {d.get("solver")!r}，但以盲解 {role} 輸入')
    answers = d.get('answers') if isinstance(d.get('answers'), dict) else {}
    for no in sorted(set(answers) - set(key), key=str):
        problems.append(f'第 {no} 題不存在')
    clean = {}
    for no in sorted(key, key=int):
        a = answers.get(no)
        if a is None:
            problems.append(f'第 {no} 題沒有作答')
            continue
        q = next(q for q in vb.questions_of(bank) if str(q.get('no')) == no)
        if q.get('mode') == 'multi_select' or q.get('mode') in OPEN_MODES:
            # 混合題的多選、填充、簡答（其他作答模式走下面原本的流程，結果完全不變）
            kp = keys_problems(a, MULTI_ANSWER_KEYS if q.get('mode') == 'multi_select' else ANSWER_KEYS, f'answers.{no}')
            if kp:
                problems += kp
                continue
            clean[no] = a
            problems += (blind_multi_problems if q.get('mode') == 'multi_select' else blind_open_problems)(no, a, q, bank, hay)
            continue
        kp = keys_problems(a, ANSWER_KEYS, f'answers.{no}')
        if kp:
            problems += kp
            continue
        clean[no] = a
        pool = vb.option_pool(bank, q)
        if a['answer'] != key[no]:
            problems.append(f'第 {no} 題答 {a["answer"]}，標準答案是 {key[no]}')
        if a['confidence'] not in CONFIDENCE:
            problems.append(f'第 {no} 題 confidence={a["confidence"]!r} 不在 high／medium／low')
        elif a['confidence'] == 'low':
            problems.append(f'第 {no} 題信心 low（至少要 medium）')
        if not isinstance(a['also_plausible'], list) or any(x not in pool for x in a['also_plausible']):
            problems.append(f'第 {no} 題 also_plausible 必須是選項代號陣列')
        elif a['also_plausible']:
            problems.append(f'第 {no} 題認為 {"、".join(a["also_plausible"])} 也說得通')
        evs = a['evidence'] if isinstance(a['evidence'], list) else []
        if not evs:
            problems.append(f'第 {no} 題沒有證據句')
        for e in evs:
            if not isinstance(e, str) or not vb.evidence_found(e, hay):
                problems.append(f'第 {no} 題的證據「{str(e)[:50]}」在選文裡找不到（必須逐字）')
        if st in ('word_bank', 'structure'):
            fz = a.get('feasible')
            if not isinstance(fz, list) or not fz:
                problems.append(f'第 {no} 題沒有 feasible（每格的可行選項集合）')
            elif any(x not in pool for x in fz):
                problems.append(f'第 {no} 題 feasible 有不在選項庫的代號')
            elif a['answer'] not in fz:
                problems.append(f'第 {no} 題 feasible 沒有包含自己的答案 {a["answer"]}')
    return {'kind': 'blind_solver', 'reviewer': d['reviewer'], 'result': 'fail' if problems else 'pass',
            'created_at': d.get('created_at') or now(),
            'details': {'solver': role, 'session_id': d.get('session_id'), 'answers': clean, 'problems': problems}}


def common_answer_problems(no, a, hay):
    """信心、證據句（各作答模式共用）。"""
    out = []
    if a['confidence'] not in CONFIDENCE:
        out.append(f'第 {no} 題 confidence={a["confidence"]!r} 不在 high／medium／low')
    elif a['confidence'] == 'low':
        out.append(f'第 {no} 題信心 low（至少要 medium）')
    evs = a['evidence'] if isinstance(a['evidence'], list) else []
    if not evs:
        out.append(f'第 {no} 題沒有證據句')
    for e in evs:
        if not isinstance(e, str) or not vb.evidence_found(e, hay):
            out.append(f'第 {no} 題的證據「{str(e)[:50]}」在選文裡找不到（必須逐字）')
    return out


def blind_multi_problems(no, a, q, bank, hay):
    """多選（SPEC §5.6）：每個選項的判斷都要和標準答案一致，沒有「可能也對」的選項。"""
    out = []
    pool = vb.option_pool(bank, q)
    key = set(q.get('answer') or []) if isinstance(q.get('answer'), list) else set()
    ans = a['answer']
    if not (isinstance(ans, list) and all(isinstance(x, str) and x in pool for x in ans)):
        out.append(f'第 {no} 題是多選題，answer 必須是選項代號陣列（目前 {ans!r}）')
    else:
        for opt in sorted(pool):
            if opt in ans and opt not in key:
                out.append(f'第 {no} 題選項 {opt}：盲解者判為正確，標準答案不是')
            elif opt not in ans and opt in key:
                out.append(f'第 {no} 題選項 {opt}：盲解者判為錯誤，標準答案是正解')
    ap = a['also_plausible']
    if not isinstance(ap, list) or any(not isinstance(x, str) or x not in pool for x in ap):
        out.append(f'第 {no} 題 also_plausible 必須是選項代號陣列')
    elif ap:
        out.append(f'第 {no} 題認為 {"、".join(ap)} 可能也對（多選題任何「可能也對」的選項都要退回改寫）')
    out += common_answer_problems(no, a, hay)
    oe = a.get('option_evidence')
    if 'option_evidence' in a:
        if not isinstance(oe, dict) or any(k not in pool for k in oe):
            out.append(f'第 {no} 題 option_evidence 必須是 {{選項代號: [逐字證據句]}}')
        else:
            for k, evs in sorted(oe.items()):
                for e in evs if isinstance(evs, list) else [evs]:
                    if not isinstance(e, str) or not vb.evidence_found(e, hay):
                        out.append(f'第 {no} 題選項 {k} 的證據「{str(e)[:50]}」在選文裡找不到（必須逐字）')
    return out


def blind_open_problems(no, a, q, bank, hay):
    """填充、簡答：答案（與 also_plausible 的每個寫法）正規化後都要在可接受答案內。"""
    out = []
    acc = q.get('accepted_answers') if isinstance(q.get('accepted_answers'), list) else []
    accepted = {vb.norm_answer(x) for x in acc + [q.get('answer')] if isinstance(x, str)}
    ans = a['answer']
    if not isinstance(ans, str) or not ans.strip():
        out.append(f'第 {no} 題是{"填充" if q.get("mode") == "fill_in_blank" else "簡答"}題，answer 必須是非空字串')
    elif vb.norm_answer(ans) not in accepted:
        out.append(f'第 {no} 題答「{ans}」，不在可接受答案 {sorted(accepted)} 內')
    ap = a['also_plausible']
    if not isinstance(ap, list) or not all(isinstance(x, str) for x in ap):
        out.append(f'第 {no} 題 also_plausible 必須是字串陣列（其他也說得通的寫法）')
    else:
        missing = [x for x in ap if vb.norm_answer(x) not in accepted]
        if missing:
            out.append(f'第 {no} 題認為「{"」「".join(missing)}」也說得通，但不在 accepted_answers（補進清單或改寫題目）')
    out += common_answer_problems(no, a, hay)
    return out


def cross_check_multi(bank, blinds):
    """超越頂標的多選：標 E2 的正解，兩位盲解者在 option_evidence 引用的證據句要有交集（出題規格書 MIX-MUL-03）。
    問題直接加到兩份盲解紀錄（任一份不過就 rejected）。"""
    if bank.get('section_type') != 'mixed' or bank.get('tier') != 'top' or len(blinds) != 2:
        return
    items = vb.explanation_items(bank)
    for q in vb.questions_of(bank):
        if q.get('mode') != 'multi_select' or not isinstance(q.get('answer'), list):
            continue
        no = str(q.get('no'))
        codes = (items.get(no) or {}).get('option_codes') if isinstance(items.get(no), dict) else None
        if not isinstance(codes, dict):
            continue
        for k in sorted(q['answer']):
            if codes.get(k) != 'E2':
                continue
            sets = []
            for b in blinds:
                oe = (b['details']['answers'].get(no) or {}).get('option_evidence') or {}
                evs = oe.get(k) if isinstance(oe, dict) else None
                sets.append({vb.norm_text(e) for e in evs if isinstance(e, str)} if isinstance(evs, list) else set())
            if not (sets[0] & sets[1]):
                msg = f'第 {no} 題正解 {k}（E2）：兩位盲解者在 option_evidence 引用的證據句沒有交集'
                for b in blinds:
                    b['details']['problems'].append(msg)
                    b['result'] = 'fail'


def audit_entry(d, bank):
    key = vb.answer_key(bank)
    st = bank.get('section_type')
    hay = vb.evidence_haystacks(bank)
    problems, soft = [], []
    items = d.get('items') if isinstance(d.get('items'), dict) else {}
    for no in sorted(set(items) - set(key), key=str):
        problems.append(f'第 {no} 題不存在')
    for q in vb.questions_of(bank):
        no = str(q.get('no'))
        pool = vb.option_pool(bank, q)
        got = items.get(no) if isinstance(items.get(no), dict) else {}
        keyset = set(key[no]) if isinstance(key[no], list) else {key[no]}   # 多選題的正解是陣列
        wrong = sorted(k for k in pool if k not in keyset)
        missing = [k for k in wrong if k not in got]
        if missing:
            msg = f'第 {no} 題沒有判定選項 {"、".join(missing)}'
            (soft if st == 'word_bank' else problems).append(msg)
        for opt, j in sorted(got.items()):
            w = f'第 {no} 題選項 {opt}'
            if opt in keyset:
                problems.append(f'{w} 是正解，不應出現在干擾選項稽核')
                continue
            if opt not in pool:
                problems.append(f'{w} 不存在')
                continue
            kp = keys_problems(j, JUDGEMENT_KEYS, w)
            if kp:
                problems += kp
                continue
            if j['verdict'] not in VERDICTS:
                problems.append(f'{w} verdict={j["verdict"]!r} 不在 clearly_wrong／arguably_acceptable')
            elif j['verdict'] == 'arguably_acceptable':
                problems.append(f'{w} 被判為 arguably_acceptable（{j.get("explanation_zh", "")[:40]}）')
            if j['error_type'] not in ERROR_TYPES:
                problems.append(f'{w} error_type={j["error_type"]!r} 不在允許值內')
            if not isinstance(j['evidence'], str) or not vb.evidence_found(j['evidence'], hay):
                problems.append(f'{w} 的證據「{str(j["evidence"])[:50]}」在選文裡找不到（必須逐字）')
    result = 'fail' if problems else ('warn' if soft else 'pass')
    return {'kind': 'distractor_audit', 'reviewer': d['reviewer'], 'result': result,
            'created_at': d.get('created_at') or now(),
            'details': {'session_id': d.get('session_id'), 'items': items, 'problems': problems + soft}}


def unique_entry(bank, blinds):
    """兩位盲解者的可行集合取聯集 → 完美配對數。回傳 (verification 項目, elimination)。"""
    union = {}
    for b in blinds:
        for no, a in b['details']['answers'].items():
            if isinstance(a.get('feasible'), list):
                union.setdefault(no, set()).update(a['feasible'])
    feasible = {no: sorted(v) for no, v in union.items()}
    total, matches, problems, norm = vb.matching_report(bank, feasible)
    method = 'perfect_matching_dp' if bank.get('section_type') == 'word_bank' else 'injective_assignment'
    entry = {'kind': 'unique_solution', 'reviewer': TOOL, 'result': 'pass' if matches and not problems else 'fail',
             'created_at': now(),
             'details': {'method': method, 'perfect_matchings': total, 'matches_key': matches, 'feasible': norm,
                         'problems': problems}}
    return entry, {'feasible': norm, 'perfect_matchings': total}


def accepted_forms(q, it):
    """中譯英可接受的整句寫法：本站參考譯文、accepted_answers、answer_segments 展開（最多 2,000 種）。"""
    forms = [x for x in [q.get('answer')] + list(q.get('accepted_answers') or []) + list((it or {}).get('references') or [])
             if isinstance(x, str)]
    segs = q.get('answer_segments')
    if isinstance(segs, list) and segs and all(isinstance(x, list) and x for x in segs):
        for i, combo in enumerate(vb.itertools.product(*segs)):
            if i >= 2000:
                break
            forms.append(vb.ve.join_segments(list(combo)))
    return {vb.norm_en(x) for x in forms}


def blind_translation_entry(d, bank, role):
    """中譯英盲譯（README §5.5）：程式比對標的詞彙與句型、可接受寫法，並檢查驗證者對參考譯文與 4 部分切分的判定。"""
    problems, soft = [], []
    if d.get('solver') != role:
        problems.append(f'檔案的 solver 是 {d.get("solver")!r}，但以盲譯 {role} 輸入')
    answers = d.get('answers') if isinstance(d.get('answers'), dict) else {}
    review = d.get('review') if isinstance(d.get('review'), dict) else {}
    rb = vb.rubric_items(bank, 'translation') or {}
    items = rb.get('items') if isinstance(rb.get('items'), dict) else {}
    qs = {str(q.get('no')): q for q in vb.questions_of(bank)}
    for key, obj in (('answers', answers), ('review', review)):
        for no in sorted(set(obj) - set(qs), key=str):
            problems.append(f'{key} 的第 {no} 題不存在')
    clean_a, clean_r, checks = {}, {}, {}
    for no in sorted(qs, key=int):
        q = qs[no]
        it = items.get(no) if isinstance(items.get(no), dict) else {}
        a, rv = answers.get(no), review.get(no)
        if a is None or rv is None:
            problems.append(f'第 {no} 題沒有{"譯文（answers）" if a is None else "對答案的判定（review）"}')
            continue
        kp = keys_problems(a, TR_ANSWER_KEYS, f'answers.{no}') + keys_problems(rv, TR_REVIEW_KEYS, f'review.{no}')
        if kp:
            problems += kp
            continue
        clean_a[no], clean_r[no] = a, rv
        tr = a['translation'] if isinstance(a['translation'], str) else ''
        if not tr.strip() or vb.CJK_RE.search(tr):
            problems.append(f'第 {no} 題的譯文必須是非空的英文句子')
            continue
        if a['confidence'] not in CONFIDENCE:
            problems.append(f'第 {no} 題 confidence={a["confidence"]!r} 不在 high／medium／low')
        elif a['confidence'] == 'low':
            problems.append(f'第 {no} 題信心 low（至少要 medium；中文題目可能有歧義）')
        # 標的詞彙：程式在盲譯裡找（詞形變化、alternatives 都算）
        tws = [tw for tw in it.get('target_words') or [] if isinstance(tw, dict) and isinstance(tw.get('word'), str)]
        found = [tw['word'] for tw in tws if vb.target_in(tw, tr)]
        rate = round(len(found) / len(tws), 3) if tws else 1.0
        if rate < TARGET_HIT_RATE_MIN - 1e-9:
            miss = [tw['word'] for tw in tws if tw['word'] not in found]
            problems.append(f'第 {no} 題盲譯只用到 {len(found)}/{len(tws)} 個標的詞彙（沒用到 {miss}；至少 80%）：'
                            '中文題目可能沒有自然引出標的詞彙，或要在 alternatives 補可接受的換字')
        words = [tw['word'] for tw in tws]
        claimed = rv['used_target_words'] if isinstance(rv['used_target_words'], list) else None
        if claimed is None or any(x not in words for x in claimed):
            problems.append(f'第 {no} 題 used_target_words 必須是這一句 target_words 的 word（目前 {rv["used_target_words"]!r}）')
        else:
            ghost = [x for x in claimed if x not in found]
            if ghost:
                soft.append(f'第 {no} 題驗證者說用了 {ghost}，程式在譯文裡找不到')
        # 標的句型：這一句的每個句型都要自然用到
        codes = [p.get('code') for p in it.get('patterns') or [] if isinstance(p, dict)]
        up = rv['used_patterns'] if isinstance(rv['used_patterns'], list) else None
        detected = {}
        if up is None or any(x not in codes for x in up):
            problems.append(f'第 {no} 題 used_patterns 必須是這一句 patterns 的 code（目前 {rv["used_patterns"]!r}）')
        else:
            miss = [c for c in codes if c not in up]
            if miss:
                problems.append(f'第 {no} 題盲譯沒有用到標的句型 {miss}：中文題目沒有自然引出這個句型（SPEC §5.7）')
            for c in up:
                detected[c] = vb.detect_structure(c, tr)
                if detected[c] is False and c in vb.STRICT_STRUCTURES:
                    soft.append(f'第 {no} 題驗證者說用了句型 {c}，程式在譯文裡看不出來')
        # 可接受寫法
        match = vb.norm_en(tr) in accepted_forms(q, it)
        if rv['within_accepted'] is not True and rv['within_accepted'] is not False:
            problems.append(f'第 {no} 題 within_accepted 必須是 true／false')
        elif rv['within_accepted'] is False:
            problems.append(f'第 {no} 題盲譯的寫法不在可接受寫法內：參考譯文或評分規準太窄（補進 references／parts.accepted），或中文有歧義')
        cr = rv.get('closest_reference')
        if 'closest_reference' in rv and not (vb.ve.is_int(cr) and 0 <= cr < len(it.get('references') or [])):
            problems.append(f'第 {no} 題 closest_reference 必須是 references 的索引')
        # 參考譯文與 4 部分切分
        for key, label in (('reference_check', '參考譯文'), ('parts_check', '4 部分切分')):
            v = rv[key]
            if v not in CHECK_RESULTS:
                problems.append(f'第 {no} 題 {key}={v!r} 必須是 pass／warn／fail')
            elif v == 'fail':
                problems.append(f'第 {no} 題驗證者判定{label}有問題（fail）：' + '；'.join(str(x) for x in rv['issues_zh'] or [])[:120])
            elif v == 'warn':
                soft.append(f'第 {no} 題驗證者對{label}有意見（warn）：' + '；'.join(str(x) for x in rv['issues_zh'] or [])[:120])
        iss = rv['issues_zh']
        if not isinstance(iss, list) or not all(isinstance(x, str) and x.strip() for x in iss):
            problems.append(f'第 {no} 題 issues_zh 必須是字串陣列')
        elif (rv['reference_check'] != 'pass' or rv['parts_check'] != 'pass') and not iss:
            problems.append(f'第 {no} 題判定不是 pass 時 issues_zh 要寫原因')
        checks[no] = {'target_words_found': found, 'target_hit_rate': rate, 'patterns_detected': detected,
                      'program_match': match}
    result = 'fail' if problems else ('warn' if soft else 'pass')
    return {'kind': 'blind_solver', 'reviewer': d['reviewer'], 'result': result, 'created_at': d.get('created_at') or now(),
            'details': {'solver': role, 'session_id': d.get('session_id'), 'task': 'blind_translation', 'answers': clean_a,
                        'review': clean_r, 'checks': checks, 'problems': problems + soft}}


def blind_grading_entry(d, bank, role):
    """作文盲評（README §5.6）：E1、E2 換回穩健版／頂標版，總分要在目標區間，切題、回應每項要求、沒有語言錯誤。"""
    problems, soft = [], []
    if d.get('solver') != role:
        problems.append(f'檔案的 solver 是 {d.get("solver")!r}，但以盲評 {role} 輸入')
    order = vb.sv.grading_order(bank)
    texts = {m.get('label'): m.get('text') for m in (bank.get('annotations') or {}).get('model_texts') or [] if isinstance(m, dict)}
    essays = d.get('essays') if isinstance(d.get('essays'), dict) else {}
    for eid in sorted(set(essays) - set(order)):
        problems.append(f'essays 的 {eid} 不存在（只有 {"、".join(order)}）')
    clean, totals = {}, {}
    names = {'steady': '穩健版', 'top': '頂標版'}
    for eid, label in order.items():
        e = essays.get(eid)
        tag = f'{eid}（{names[label]}）'
        if e is None:
            problems.append(f'{tag} 沒有評分')
            continue
        kp = keys_problems(e, ESSAY_GRADE_KEYS, f'essays.{eid}')
        if kp:
            problems += kp
            continue
        sc = e['scores']
        if not (isinstance(sc, dict) and set(sc) == set(vb.MODEL_TEXT_CRITERIA)
                and all(vb.ve.is_int(v) and 0 <= v <= 5 for v in sc.values())):
            problems.append(f'{tag} scores 必須是 content、organization、grammar、vocabulary 各 0–5 的整數')
            continue
        total = sum(sc.values())
        totals[label] = total
        lo, hi = vb.MODEL_TEXT_TARGETS[label]
        if not lo <= total <= hi:
            problems.append(f'{tag} 盲評總分 {total}，{names[label]}要在 {lo}–{hi}（SPEC §5.7）')
        if e['off_topic'] is not False:
            problems.append(f'{tag} 被判離題（off_topic 必須是 false）')
        if e['covers_all_tasks'] is not True:
            problems.append(f'{tag} 沒有回應題目的每一項要求（出題規格書 WRT-MOD-TSK-01）')
        errs = e['errors'] if isinstance(e['errors'], list) else None
        if errs is None:
            problems.append(f'{tag} errors 必須是陣列（沒有錯誤就是 []）')
        else:
            for k, x in enumerate(errs):
                xp = keys_problems(x, GRADE_ERROR_KEYS, f'essays.{eid}.errors[{k}]')
                if xp:
                    problems += xp
                    continue
                if not isinstance(x['excerpt'], str) or x['excerpt'] not in (texts.get(label) or ''):
                    problems.append(f'{tag} 錯誤的引文「{str(x["excerpt"])[:40]}」不在範文裡（必須逐字）')
            if errs:
                problems.append(f'{tag} 有 {len(errs)} 個語言錯誤（範文要 0 錯，出題規格書 WRT-MOD-ERR-01）：'
                                + '；'.join(str(x.get('excerpt'))[:30] for x in errs[:3] if isinstance(x, dict)))
        if not (isinstance(e['comment_zh'], str) and e['comment_zh'].strip()):
            problems.append(f'{tag} comment_zh 必須是非空字串（簡短評語）')
        clean[label] = dict(e, id=eid)
    pc = d.get('prompt_check')
    iss = d.get('issues_zh')
    if pc not in CHECK_RESULTS:
        problems.append(f'prompt_check={pc!r} 必須是 pass／warn／fail')
    elif pc == 'fail':
        problems.append('驗證者判定題目有問題（prompt_check fail）：' + '；'.join(str(x) for x in iss or [])[:120])
    elif pc == 'warn':
        soft.append('驗證者對題目有意見（prompt_check warn）：' + '；'.join(str(x) for x in iss or [])[:120])
    if not isinstance(iss, list) or not all(isinstance(x, str) and x.strip() for x in iss):
        problems.append('issues_zh 必須是字串陣列')
    elif pc != 'pass' and not iss:
        problems.append('prompt_check 不是 pass 時 issues_zh 要寫原因')
    result = 'fail' if problems else ('warn' if soft else 'pass')
    return {'kind': 'blind_solver', 'reviewer': d['reviewer'], 'result': result, 'created_at': d.get('created_at') or now(),
            'details': {'solver': role, 'session_id': d.get('session_id'), 'task': 'blind_grading', 'order': order,
                        'essays': clean, 'totals': totals, 'prompt_check': pc, 'issues_zh': iss, 'problems': problems + soft}}


def cross_check_grading(blinds):
    """兩位盲評者對同一篇範文的總分差 >2 分時，兩份都判 fail（出題規格書 WRT-MOD-SCR-01）。"""
    if len(blinds) != 2:
        return
    for label, name in (('steady', '穩健版'), ('top', '頂標版')):
        ts = [b['details']['totals'].get(label) for b in blinds]
        if None not in ts and abs(ts[0] - ts[1]) > GRADER_GAP_MAX:
            msg = f'{name}兩位盲評的總分差 {abs(ts[0] - ts[1])} 分（{ts[0]}、{ts[1]}），超過 {GRADER_GAP_MAX} 分'
            for b in blinds:
                b['details']['problems'].append(msg)
                b['result'] = 'fail'


def extra_entry(path, bank):
    d = load_input(path, EXTRA_KEYS, 'gsat-bank-check/v1', bank)
    if d['kind'] not in ('similarity', 'fact_check'):
        raise InputError(f'{path}: kind 只能是 similarity／fact_check')
    if d['result'] not in ('pass', 'warn', 'fail'):
        raise InputError(f'{path}: result 必須是 pass／warn／fail')
    if not isinstance(d['details'], dict):
        raise InputError(f'{path}: details 必須是物件')
    return {'kind': d['kind'], 'reviewer': d['reviewer'], 'result': d['result'], 'created_at': d.get('created_at') or now(),
            'details': d['details']}


def merge_entries(old, new):
    """同一種檢查取代舊紀錄；盲解依 A／B 分別取代。"""
    def ident(e):
        return (e.get('kind'), (e.get('details') or {}).get('solver') if e.get('kind') == 'blind_solver' else None)
    replaced = {ident(e) for e in new}
    return [e for e in old if ident(e) not in replaced] + new


def decide(bank):
    """依 SPEC §5.7 判定。回傳 (status, reasons, missing)。"""
    vs = bank.get('verification') or []
    st = bank.get('section_type')
    need = ['program', 'blind_solver:A', 'blind_solver:B', 'distractor_audit']
    if st in vb.WRITING_TYPES:
        need = ['program', 'blind_solver:A', 'blind_solver:B']   # 中譯英盲譯、作文盲評，沒有干擾選項稽核
    if st in ('word_bank', 'structure'):
        need.append('unique_solution')
    have = {}
    for e in vs:
        k = e['kind'] + (':' + e['details'].get('solver', '') if e['kind'] == 'blind_solver' else '')
        have[k] = e
    missing = [k for k in need if k not in have]
    reasons = []
    for k, e in have.items():
        if e['result'] == 'fail':
            probs = (e.get('details') or {}).get('problems') or (e.get('details') or {}).get('errors') or []
            reasons.append(f'{k} 未通過：' + '；'.join(probs[:3]) + ('…' if len(probs) > 3 else ''))
    if reasons:
        return 'rejected', reasons, missing
    if missing:
        return 'draft', [], missing
    return 'verified', [], []


def main(argv):
    ap = argparse.ArgumentParser(description='寫入驗證結果並判定 status')
    ap.add_argument('bank', type=Path)
    ap.add_argument('--blind-a', type=Path)
    ap.add_argument('--blind-b', type=Path)
    ap.add_argument('--audit', type=Path)
    ap.add_argument('--extra', type=Path, action='append', default=[], help='similarity／fact_check 結果（可重複）')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    try:
        bank = json.loads(a.bank.read_text(encoding='utf-8'))
        new = []
        bank['metrics'] = tm.metrics_for_bank(bank)
        new.append(program_entry(a.bank, bank))
        blinds = []
        if bank.get('section_type') in vb.WRITING_TYPES:
            # 中譯英盲譯、作文盲評（README §5.5、§5.6）
            if a.audit:
                raise InputError('中譯英、作文不做干擾選項稽核（--audit 不適用；README §5.5、§5.6）')
            tr = bank.get('section_type') == 'translation'
            for role, p in (('A', a.blind_a), ('B', a.blind_b)):
                if p:
                    if tr:
                        blinds.append(blind_translation_entry(
                            load_input(p, BLIND_TR_KEYS, BLIND_TRANSLATION_SCHEMA, bank), bank, role))
                    else:
                        blinds.append(blind_grading_entry(load_input(p, BLIND_GR_KEYS, BLIND_GRADING_SCHEMA, bank), bank, role))
            if not tr:
                cross_check_grading(blinds)
            new += blinds
        else:
            for role, p in (('A', a.blind_a), ('B', a.blind_b)):
                if p:
                    blinds.append(blind_entry(load_input(p, BLIND_KEYS, 'gsat-bank-blind/v1', bank), bank, role))
            cross_check_multi(bank, blinds)
            new += blinds
            if a.audit:
                new.append(audit_entry(load_input(a.audit, AUDIT_KEYS, 'gsat-bank-audit/v1', bank), bank))
        if bank.get('section_type') in ('word_bank', 'structure') and len(blinds) == 2:
            entry, elim = unique_entry(bank, blinds)
            new.append(entry)
            bank['annotations']['elimination'] = elim
        for p in a.extra:
            new.append(extra_entry(p, bank))
    except InputError as e:
        print(f'輸入錯誤：{e}', file=sys.stderr)
        return 2
    except (OSError, ValueError) as e:
        print(f'讀檔失敗：{e}', file=sys.stderr)
        return 2
    bank['verification'] = merge_entries(bank.get('verification') or [], new)
    status, reasons, missing = decide(bank)
    bank['status'] = status
    bank['status_reason'] = '；'.join(reasons) if status == 'rejected' else None
    if not a.dry_run:
        a.bank.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = {'file': str(a.bank), 'status': status, 'reasons': reasons, 'missing': missing,
               'checks': [{'kind': e['kind'], 'solver': e['details'].get('solver'), 'result': e['result']} for e in new],
               'perfect_matchings': (bank['annotations'].get('elimination') or {}).get('perfect_matchings'),
               'written': not a.dry_run}
    if a.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f'{a.bank}：{status}{"（未寫檔）" if a.dry_run else ""}')
        for e in new:
            tag = e['kind'] + (f' {e["details"]["solver"]}' if e['kind'] == 'blind_solver' else '')
            probs = e['details'].get('problems') or e['details'].get('errors') or []
            print(f'  {tag}: {e["result"]}' + (f'（{"；".join(probs[:3])}）' if probs else ''))
        if summary['perfect_matchings'] is not None:
            print(f'  完美配對數：{summary["perfect_matchings"]}')
        if missing:
            print(f'  還缺：{"、".join(missing)}（status 維持 draft）')
        for x in reasons:
            print(f'  退回原因：{x}')
    return {'verified': 0, 'rejected': 1}.get(status, 3)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
