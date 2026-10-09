#!/usr/bin/env python3
"""把 gsat-bank/v1 檔案轉成「學生畫面資料」，給盲解者用（SPEC §5.5）。

用法：
    python3 tools/student_view.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json            # 印到標準輸出
    python3 tools/student_view.py FILE1 FILE2 ... > views.json                                    # 多個檔案輸出 JSON 陣列
    python3 tools/student_view.py --out-dir /tmp/blind FILE...                                    # 每個檔案寫一份 {uid}@{version}.view.json

去掉的東西：答案（answer、accepted_answers、scoring_notes 與翻譯題的受保護欄位）、小題與題組標註（tags：考點、詞性、
主題都是出題筆記）、annotations、generation、verification、metrics、curriculum、provenance、難度（tier；盲解者不該知道
這組「應該多難」）。留下的只有學生作答時看得到的：說明、選文、多文本、圖表、選項庫、題號、題幹、選項、refers_to（畫面的高亮）。
圖表題在代理通道給文字描述與資料表（figures 的 description、rows、chart）：有 chart 物件的圖另外加
chart_text（每個資料點一行的文字版）與 data_table（第一列是表頭的資料表），格式見 data/bank/README.md §3.2；
盲解者引用圖表當證據時，逐字引用 chart_text 的一行或 data_table 的一列（儲存格以 " | " 相接）。
混合題的填充、多選、簡答小題另外加 answer_format（盲解結果的 answer 要寫成什麼型別）。
中譯英只留中文題目（標的詞彙、句型、參考譯文都在 tags／annotations，一律去掉），給盲譯者自己翻譯（README §5.5）；
作文只留題目提示與圖（文字描述、SVG 示意圖）。
--grading（只用在作文）：另外加 grading 區塊給盲評者——評分規準（四項各 0–5 的分數帶描述與本題重點）、題目的內容步驟，
以及兩篇範文。範文以中性代號 E1、E2 呈現、順序依 uid 決定（grading_order），不標穩健版或頂標版、不附註解與本站的目標分數
（README §5.6）。
輸出的 schema 是 gsat-bank-student/v1；選項庫與選項依代號排序，盲解者看到的順序和學生相同。只用標準函式庫。
"""
import argparse
import hashlib
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
    'translation': '依題號將中文句子譯成正確、通順、達意的英文（每句一句完整的英文句子）。',
    'composition': '依提示寫一篇英文作文，文長至少 120 個單詞（words），文分兩段。',
}


# 混合題各作答模式的作答格式（給盲解者；學生畫面也有同樣的提示）
ANSWER_FORMATS = {
    'multi_select': '選出所有正確的選項；answer 寫成選項代號陣列，例如 ["B", "E"]',
    'fill_in_blank': '填一個英文單詞（依題幹指示，可能要變化字形）；answer 寫成字串',
    'short_answer': '從文中找出題目要的字詞，照題幹要求的形態寫；answer 寫成字串',
    'table_completion': '依表格填寫；answer 寫成字串',
    'translation': '把這一句中文譯成一句完整的英文（句首大寫、句尾標點）；盲譯結果寫在 answers.{題號}.translation',
    'composition': '寫一篇至少 120 個單詞、分兩段的英文作文',
}
# 作文盲評：兩篇範文的中性代號（順序由 grading_order 依 uid 決定，盲評者看不出哪篇是穩健版）
GRADING_IDS = ('E1', 'E2')
CRITERION_LABELS = {'content': '內容', 'organization': '組織', 'grammar': '文法句構', 'vocabulary': '字彙拼字'}
GRADING_INSTRUCTIONS = ('只依題目與下面的評分規準，給兩篇範文各打四項分數（內容、組織、文法句構、字彙拼字，各 0–5 的整數），'
                        '並檢查是否切題、是否回應題目每一項要求、有沒有文法、用字、拼字、標點錯誤（逐字引用）。'
                        '結果照 data/bank/README.md §5.6 的 gsat-bank-blind-grading/v1 格式寫。')
CHART_TYPE_LABELS = {'bar': '長條圖', 'line': '折線圖', 'stacked_bar': '堆疊長條圖', 'pie': '圓餅圖'}


def sorted_map(m):
    return {k: m[k] for k in sorted(m)} if isinstance(m, dict) else m


def format_number(v):
    """數值的文字寫法：整數不帶小數點，其他照 JSON 的寫法（41.2、0.5），不加千分位。"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def with_unit(v, unit):
    s = format_number(v)
    if not unit:
        return s
    return s + unit if unit == '%' else f'{s} {unit}'


def chart_text_lines(chart):
    """chart 物件的文字版（README §3.2）：類型與標題、軸、數列、每個資料點一行、附註、資料來源。"""
    x, y = chart.get('x') or {}, chart.get('y') or {}
    series = [s for s in chart.get('series') or [] if isinstance(s, dict)]
    cats = chart.get('categories') or []
    ctype = chart.get('type')
    lines = [f'{CHART_TYPE_LABELS.get(ctype, ctype)}：{chart.get("title")}']
    axis = '類別' if ctype == 'pie' else '橫軸'
    lines.append(f'{axis}：{x.get("label")}' + (f'（單位：{x["unit"]}）' if x.get('unit') else ''))
    lines.append(f'數值：{y.get("label")}' + (f'（單位：{y["unit"]}）' if y.get('unit') else ''))
    if len(series) > 1:
        lines.append('數列：' + '、'.join(str(s.get('name')) for s in series))
    for i, c in enumerate(cats):
        for s in series:
            vals = s.get('values') or []
            if i >= len(vals):
                continue
            label = f'{c}, {s.get("name")}' if len(series) > 1 else str(c)
            lines.append(f'{label}: {with_unit(vals[i], y.get("unit"))}')
    if chart.get('note'):
        lines.append(f'附註：{chart["note"]}')
    src = chart.get('source') or {}
    if src.get('publisher'):
        lines.append(f'資料來源：{src.get("publisher")}, {src.get("title")}（{src.get("license")}）')
    return lines


def chart_table(chart):
    """chart 物件的資料表：第一列是表頭（類別軸、各數列＋單位），之後每個類別一列；儲存格都是字串。"""
    x, y = chart.get('x') or {}, chart.get('y') or {}
    series = [s for s in chart.get('series') or [] if isinstance(s, dict)]
    unit = f' ({y["unit"]})' if y.get('unit') else ''
    head = [str(x.get('label')) + (f' ({x["unit"]})' if x.get('unit') else '')]
    head += [f'{s.get("name")}{unit}' for s in series]
    rows = [head]
    for i, c in enumerate(chart.get('categories') or []):
        rows.append([str(c)] + [format_number((s.get('values') or [])[i]) if i < len(s.get('values') or []) else ''
                                for s in series])
    return rows


def figure_view(f):
    """圖表題：保留 figure 原欄位（學生也看得到 chart 與資料來源），另加 chart_text、data_table。"""
    if not isinstance(f, dict) or not isinstance(f.get('chart'), dict):
        return f
    out = dict(f)
    try:
        out['chart_text'] = [str(x) for x in chart_text_lines(f['chart'])]
        out['data_table'] = [[str(c) for c in row] for row in chart_table(f['chart'])]
    except Exception:  # noqa: BLE001 — chart 格式錯誤（validate_bank.py 會擋）時只給原始 figure
        out.pop('chart_text', None)
        out.pop('data_table', None)
    return out


def view_of(bank):
    g = bank.get('group') or {}
    st = bank.get('section_type')
    group = {k: g.get(k) for k in GROUP_FIELDS}
    group['options_bank'] = sorted_map(group['options_bank'])
    if isinstance(group['figures'], list):
        group['figures'] = [figure_view(f) for f in group['figures']]
    questions = []
    for q in g.get('questions') or []:
        item = {k: q.get(k) for k in QUESTION_FIELDS if k in q}
        item['options'] = sorted_map(item.get('options'))
        if isinstance(q, dict) and isinstance(q.get('mode'), str) and q['mode'] in ANSWER_FORMATS:
            item['answer_format'] = ANSWER_FORMATS[q['mode']]
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


def grading_order(bank):
    """作文盲評時兩篇範文的呈現順序：{'E1': label, 'E2': label}。依 sha256(uid@version) 決定，穩健版不一定在前。"""
    seed = hashlib.sha256(f'{bank.get("uid")}@{bank.get("version")}'.encode('utf-8')).digest()[0]
    labels = ('steady', 'top') if seed % 2 == 0 else ('top', 'steady')
    return dict(zip(GRADING_IDS, labels))


def word_count(text):
    """英文字數（同 writing.ts 的 countEnglishWords）：以空白切開，含字母或數字的片段算一個字。"""
    return sum(1 for tok in (text or '').split() if any(ch.isalnum() and ch.isascii() for ch in tok))


def grading_view(bank):
    """作文盲評的資料：學生畫面＋評分規準＋兩篇範文（中性代號、不標版本、不附註解與目標分數）。"""
    if bank.get('section_type') != 'composition':
        raise ValueError(f'--grading 只用在作文（目前 {bank.get("section_type")}）')
    view = view_of(bank)
    a = bank.get('annotations') or {}
    rb = a.get('rubric') if isinstance(a.get('rubric'), dict) else {}
    texts = {m.get('label'): m.get('text') for m in a.get('model_texts') or [] if isinstance(m, dict)}
    criteria = {}
    for k, label in CRITERION_LABELS.items():
        c = (rb.get('criteria') or {}).get(k) if isinstance(rb.get('criteria'), dict) else None
        c = c if isinstance(c, dict) else {}
        criteria[k] = {'label_zh': label, 'max': 5, 'focus_zh': c.get('focus_zh'),
                       'bands': [{'min': b.get('min'), 'max': b.get('max'), 'descriptor_zh': b.get('descriptor_zh')}
                                 for b in c.get('bands') or [] if isinstance(b, dict)]}
    essays = []
    for eid, label in grading_order(bank).items():
        text = texts.get(label) or ''
        paras = [x for x in text.replace('\r\n', '\n').split('\n') if x.strip()]
        essays.append({'id': eid, 'text': text, 'word_count': word_count(text), 'paragraphs': len(paras)})
    view['grading'] = {
        'instructions': GRADING_INSTRUCTIONS,
        'criteria': criteria,
        'tasks_zh': [m.get('zh') for m in rb.get('moves') or [] if isinstance(m, dict)],
        'deductions_zh': rb.get('deductions_zh'),
        'requirements': {'min_words': 120, 'paragraphs': 2},
        'essays': essays,
    }
    return view


def main(argv):
    ap = argparse.ArgumentParser(description='gsat-bank/v1 → 學生畫面資料（盲解用）')
    ap.add_argument('files', nargs='+', type=Path)
    ap.add_argument('--out-dir', type=Path, help='每個檔案各寫一份 {uid}@{version}.view.json')
    ap.add_argument('--grading', action='store_true', help='作文盲評：另加評分規準與兩篇範文（中性代號 E1、E2）')
    a = ap.parse_args(argv)
    views = []
    for p in a.files:
        try:
            bank = json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            print(f'{p}: 讀檔失敗：{e}', file=sys.stderr)
            return 2
        if a.grading:
            try:
                views.append(grading_view(bank))
            except ValueError as e:
                print(f'{p}: {e}', file=sys.stderr)
                return 2
            continue
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
