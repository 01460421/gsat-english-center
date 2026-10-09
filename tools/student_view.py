#!/usr/bin/env python3
"""把 gsat-bank/v1 檔案轉成「學生畫面資料」，給盲解者用（SPEC §5.5）。

用法：
    python3 tools/student_view.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json            # 印到標準輸出
    python3 tools/student_view.py FILE1 FILE2 ... > views.json                                    # 多個檔案輸出 JSON 陣列
    python3 tools/student_view.py --out-dir /tmp/blind FILE...                                    # 每個檔案寫一份 {uid}@{version}.view.json

去掉的東西：答案（answer、accepted_answers、scoring_notes 與翻譯題的受保護欄位）、小題與題組標註（tags：考點、詞性、
主題都是出題筆記）、annotations、generation、verification、metrics、curriculum、provenance、難度（tier；盲解者不該知道
這組「應該多難」）。留下的只有學生作答時看得到的：說明、選文、多文本、圖表、選項庫、題號、題幹、選項、refers_to（畫面的高亮）。
圖表題在代理通道給文字描述與資料表（figures 的 description、rows、chart）。
輸出的 schema 是 gsat-bank-student/v1；選項庫與選項依代號排序，盲解者看到的順序和學生相同。只用標準函式庫。
"""
import argparse
import json
import sys
from pathlib import Path

VIEW_SCHEMA = 'gsat-bank-student/v1'
QUESTION_FIELDS = ('no', 'label', 'mode', 'stem', 'options', 'refers_to')
GROUP_FIELDS = ('passage', 'passage_parts', 'figures', 'options_bank')
SECTION_LABELS = {'vocabulary': '詞彙題', 'cloze': '綜合測驗', 'word_bank': '文意選填', 'structure': '篇章結構',
                  'reading': '閱讀測驗', 'mixed': '混合題', 'translation': '中譯英', 'composition': '英文作文'}
# 給盲解者的作答說明（不提難度、不提答案分布）
INSTRUCTIONS = {
    'vocabulary': '每題選出一個最適當的選項。',
    'cloze': '依文意選出最適當的選項填入每個空格。',
    'word_bank': '從選項庫中選出最適當的選項填入每個空格；每個選項只能用一次。',
    'structure': '從選項庫中選出最適當的句子填入每個空格；每個選項最多用一次，其中有一個選項用不到。',
    'reading': '依文章內容選出最適當的選項。',
    'mixed': '依文章內容作答（填空、多選、簡答）。',
    'translation': '把中文句子譯成正確、通順、達意的英文。',
    'composition': '依題目指示寫一篇英文作文。',
}


def sorted_map(m):
    return {k: m[k] for k in sorted(m)} if isinstance(m, dict) else m


def view_of(bank):
    g = bank.get('group') or {}
    st = bank.get('section_type')
    group = {k: g.get(k) for k in GROUP_FIELDS}
    group['options_bank'] = sorted_map(group['options_bank'])
    questions = []
    for q in g.get('questions') or []:
        item = {k: q.get(k) for k in QUESTION_FIELDS if k in q}
        item['options'] = sorted_map(item.get('options'))
        questions.append(item)
    group['questions'] = questions
    return {
        'schema': VIEW_SCHEMA,
        'uid': bank.get('uid'),
        'version': bank.get('version'),
        'section_type': st,
        'section_label': SECTION_LABELS.get(st, st),
        'format_version': bank.get('format_version'),
        'instructions': INSTRUCTIONS.get(st, ''),
        'group': group,
    }


def main(argv):
    ap = argparse.ArgumentParser(description='gsat-bank/v1 → 學生畫面資料（盲解用）')
    ap.add_argument('files', nargs='+', type=Path)
    ap.add_argument('--out-dir', type=Path, help='每個檔案各寫一份 {uid}@{version}.view.json')
    a = ap.parse_args(argv)
    views = []
    for p in a.files:
        try:
            bank = json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            print(f'{p}: 讀檔失敗：{e}', file=sys.stderr)
            return 2
        views.append(view_of(bank))
    if a.out_dir:
        a.out_dir.mkdir(parents=True, exist_ok=True)
        for v in views:
            out = a.out_dir / f'{v["uid"]}@{v["version"]}.view.json'
            out.write_text(json.dumps(v, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(f'寫入 {out}', file=sys.stderr)
        return 0
    print(json.dumps(views[0] if len(views) == 1 else views, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
