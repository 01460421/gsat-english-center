#!/usr/bin/env python3
"""把 data/curriculum/grammar-patterns.json 的歷屆翻譯題代碼對到題庫的 exam id 與題號。

grammar-patterns.json 的 exam_translation_refs／exam_refs 用研究時訂的代碼（item）：
  gsat-108-1   → 學測 108 中譯英第 1 題          → exam_id gsat-108
  ast-99-1     → 指考 99 翻譯第 1 題             → exam_id ast-99
  ast-109m-1   → 109 指考補考                    → exam_id ast-109-makeup
  gsat-110t-1  → 110 年試辦考試                  → exam_id ref-110
  ref115-1     → 115 學年度起適用參考試卷         → exam_id ref-115
題庫（data/exams/parsed/*.json）的翻譯題用大題內序號 no（1、2）。這支腳本在每個 ref 加上
exam_id 與 no，並確認題庫裡真的有那一題（translation 大題、同一個 no），兩邊才能 join 做
「句型 × 年度」分析（docs/research/00-research-index.md §3.3 第 3 點）。

用法（在 repo 根目錄）：
  python3 tools/link_grammar_refs.py          # 補上 exam_id／no 並寫回
  python3 tools/link_grammar_refs.py --check  # 只檢查；需要改動或有對不上的代碼時以 1 結束
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PATTERNS = ROOT / 'data' / 'curriculum' / 'grammar-patterns.json'
PARSED = ROOT / 'data' / 'exams' / 'parsed'
REF_KEYS = ('exam_translation_refs', 'exam_refs')

ITEM_RE = re.compile(r'(?:(gsat|ast)-(\d+)(m|t)?|ref(\d+))-(\d+)')


def exam_id_of(item):
    m = ITEM_RE.fullmatch(item)
    if not m:
        return None, None
    exam, year, suffix, ref_year, no = m.groups()
    if ref_year:
        return f'ref-{ref_year}', int(no)
    if suffix == 'm':
        return f'{exam}-{year}-makeup', int(no)
    if suffix == 't':
        return f'ref-{year}', int(no)       # 110 年試辦考試在題庫是參考試卷 ref-110
    return f'{exam}-{year}', int(no)


def translation_nos():
    """exam id → 該卷翻譯大題的題號集合。"""
    out = {}
    for f in PARSED.glob('*.json'):
        d = json.loads(f.read_text(encoding='utf-8'))
        nos = set()
        for s in d['sections']:
            if s['type'] == 'translation':
                nos |= {q['no'] for g in s['groups'] for q in g['questions']}
        out[d['id']] = nos
    return out


def link(data, nos):
    errors, changed = [], 0

    def fix(ref, where):
        nonlocal changed
        item = ref.get('item')
        exam_id, no = exam_id_of(item or '')
        if exam_id is None:
            errors.append(f'{where}: 看不懂的代碼 {item!r}')
            return
        if no not in nos.get(exam_id, set()):
            errors.append(f'{where}: {item} → {exam_id} 第 {no} 題，題庫找不到這題翻譯題')
            return
        if ref.get('exam_id') != exam_id or ref.get('no') != no:
            ref['exam_id'], ref['no'] = exam_id, no
            changed += 1

    def walk(o, path):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in REF_KEYS and isinstance(v, list):
                    for i, ref in enumerate(v):
                        if isinstance(ref, dict):
                            fix(ref, f'{path}.{k}[{i}]')
                        else:
                            errors.append(f'{path}.{k}[{i}]: ref 應該是物件，實際是 {ref!r}')
                elif k != 'field_notes':
                    walk(v, f'{path}.{k}')
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f'{path}[{i}]')

    walk(data, '$')
    return changed, errors


def main(argv):
    check = '--check' in argv
    text = PATTERNS.read_text(encoding='utf-8')
    data = json.loads(text)
    changed, errors = link(data, translation_nos())
    notes = data.setdefault('field_notes', {})
    note = ('exam_id＋no：tools/link_grammar_refs.py 由 item 代碼換算出的題庫 id（data/exams/parsed/<exam_id>.json）'
            '與翻譯大題內題號，用來和題庫 join；item 保留原代碼')
    if notes.get('exam_id_no') != note:
        notes['exam_id_no'] = note
        changed += 1
    for e in errors:
        print(e, file=sys.stderr)
    if errors:
        return 1
    if check:
        if changed:
            print(f'grammar-patterns.json 需要更新（{changed} 處）：請執行 python3 tools/link_grammar_refs.py')
            return 1
        print('grammar-patterns.json 的翻譯題代碼都已對上題庫')
        return 0
    if changed:
        PATTERNS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'已更新 {changed} 處')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
