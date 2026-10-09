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
    3. distractor_audit：每個錯誤選項都有判定（文意選填可只判詞性相容的選項，缺的列 warn），
       沒有任何 arguably_acceptable，證據句逐字在選文裡。
    4. unique_solution（文意選填、篇章結構）：兩位盲解者的可行集合取聯集寫成 annotations.elimination，
       算「每格各放一個不同選項」的填法數，必須剛好 1 且等於標準答案；篇章結構的多餘句在每一格都不可行。
    5. 判定：上面全部通過（warn 也算通過，但人工審核會 100% 看）且 --extra 沒有 fail → verified；
       否則 rejected，status_reason 列出原因。缺少必要的輸入時維持 draft，不判定。
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
AUDIT_KEYS = ({'schema', 'uid', 'version', 'reviewer', 'items'}, {'session_id', 'created_at'})
JUDGEMENT_KEYS = ({'verdict', 'error_type', 'evidence', 'explanation_zh'}, set())
EXTRA_KEYS = ({'schema', 'uid', 'version', 'kind', 'reviewer', 'result', 'details'}, {'created_at'})


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
        kp = keys_problems(a, ANSWER_KEYS, f'answers.{no}')
        if kp:
            problems += kp
            continue
        clean[no] = a
        pool = vb.option_pool(bank, next(q for q in vb.questions_of(bank) if str(q.get('no')) == no))
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
        wrong = sorted(k for k in pool if k != key[no])
        missing = [k for k in wrong if k not in got]
        if missing:
            msg = f'第 {no} 題沒有判定選項 {"、".join(missing)}'
            (soft if st == 'word_bank' else problems).append(msg)
        for opt, j in sorted(got.items()):
            w = f'第 {no} 題選項 {opt}'
            if opt == key[no]:
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
        for role, p in (('A', a.blind_a), ('B', a.blind_b)):
            if p:
                blinds.append(blind_entry(load_input(p, BLIND_KEYS, 'gsat-bank-blind/v1', bank), bank, role))
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
