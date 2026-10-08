#!/usr/bin/env python3
"""彙整 data/exams/parsed/*.json，產生跨年出題統計，供出題引擎校準與分析文件使用。

用法：
    python3 tools/exam_stats.py            # 寫入 data/exams/stats/*.json 與 docs/analysis/exam-stats.md
    python3 tools/exam_stats.py --check    # 只檢查能不能跑完，不寫檔

輸出：
    data/exams/stats/summary.json        每份考卷的結構（大題、題數、配分）與各題型的標註分布
    data/exams/stats/items.json          逐題扁平表（考試、年度、時期、題型、題號、答案文字、答案級數、答對率、標註）
    data/exams/stats/passages.json       逐篇選文（字數、生字比例、體裁、主題、SDGs、文本形式）
    data/exams/stats/word-frequency.json 詞彙表每個條目在歷屆試題中的出現次數（分正解、選項、選文）
    docs/analysis/exam-stats.md          人看的摘要表

只讀 gsat-exam/v1.1 的檔案（v1 檔案請先跑 tools/normalize_exams.py）。

「時期」把考卷分成三組，因為題型與詞彙表版本在這些時間點改變：
    gsat-legacy  學測 83–110（舊制，詞彙表 91 年版或更早）
    gsat-current 學測 111 起（108 課綱新制，詞彙表 111 年版）
    ast          指考 91–110（難度較高，當「超越頂標」的參考）
參考試卷（ref-*）只列在 summary，不算進統計，避免和正式考試混在一起；另外任何帶 reused_from
（沿用歷屆試題）的小題也一律排除，同一題才不會被算兩次。

作文字數用 tags.word_count（{min, max, approx}，例如「≥120」「≈120」「120–150」）；片語答案的功能詞性
用 tags.answer_function（answer_pos 為 phrase 時的原詞性）。

詞形還原：有 data/vocab/forms-index.json（tools/build_vocab.py 產生）就用它；
沒有的話退回簡單的字尾規則，結果會略有誤差，報告中會註明用了哪一種。
"""
import json
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARSED = ROOT / 'data' / 'exams' / 'parsed'
OUT = ROOT / 'data' / 'exams' / 'stats'
DOC = ROOT / 'docs' / 'analysis' / 'exam-stats.md'
WORDLIST = ROOT / 'data' / 'vocab' / 'ceec-wordlist.json'
FORMS = ROOT / 'data' / 'vocab' / 'forms-index.json'

WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
# 題本文字裡的強調標記（<u>…</u>、<b>…</b>，見 docs/exam-json-schema.md〈文字規則〉）。斷詞前要先拿掉，
# 不然 <b>so</b> 會被切成 b、so、b，選文字數與詞彙統計都會多算。
MARKUP_RE = re.compile(r'</?[bu]>')
BLANK_RE = re.compile(r'\[\[\d+\]\]')
CHOICE_TYPES = ('vocabulary', 'cloze', 'word_bank')
SCHEMA_ID = 'gsat-exam/v1.1'
TAG_FIELDS = ('test_point', 'answer_pos', 'answer_function', 'grammar_point', 'item_type', 'clue', 'essay_type')
# 詞類全是這些的條目算功能詞（介系詞、代名詞、連接詞、助動詞、冠詞）。它們在片語答案裡大量出現，
# 但對「哪些實詞常考」沒有參考價值，所以排名時放到最後，數字照樣保留。
FUNCTION_POS = {'prep.', 'pron.', 'conj.', 'aux.', 'art.'}


def words_of(text):
    """把題本文字切成英文單字；先去掉強調標記。"""
    return WORD_RE.findall(MARKUP_RE.sub('', text or ''))


def era_of(exam):
    if exam['exam'] == 'ast':
        return 'ast'
    if exam['exam'] == 'gsat':
        return 'gsat-current' if exam['year'] >= 111 else 'gsat-legacy'
    return 'reference'


# ---------- 詞彙表與詞形還原 ----------

class Lexicon:
    def __init__(self):
        entries = json.loads(WORDLIST.read_text(encoding='utf-8'))
        self.entries = entries
        self.by_form = defaultdict(set)   # 小寫詞形 → 條目索引
        for i, e in enumerate(entries):
            for w in [e['word'], *e.get('variants', [])]:
                self.by_form[w.lower()].add(i)
        self.mode = 'suffix-rules'
        if FORMS.exists():
            # forms-index.json 由 tools/build_vocab.py 產生：{"_meta": …, "forms": {詞形: [{"entry_id", "types"}…]}}。
            # entry_id = "{word}|{詞類以 / 連接}|{level}"（同一支腳本的定義），由 ceec-wordlist.json 的條目算回索引。
            data = json.loads(FORMS.read_text(encoding='utf-8'))
            id_to_idx = {f"{e['word']}|{'/'.join(e['pos'])}|{e['level']}": i for i, e in enumerate(entries)}
            ok = missing = 0
            for form, refs in (data.get('forms') or {}).items():
                for ref in refs:
                    idx = id_to_idx.get(ref.get('entry_id'))
                    if idx is None:
                        missing += 1
                        continue
                    self.by_form[form.lower()].add(idx)
                    ok += 1
            if missing:
                raise SystemExit(f'forms-index.json 有 {missing} 個 entry_id 對不回 ceec-wordlist.json（兩份檔案版本不一致？）')
            if ok:
                self.mode = 'forms-index'

    def lookup(self, token):
        t = token.lower().replace('’', "'")
        if t in self.by_form:
            return self.by_form[t]
        if self.mode == 'forms-index':
            return set()
        for cand in self._suffix_candidates(t):
            if cand in self.by_form:
                return self.by_form[cand]
        return set()

    @staticmethod
    def _suffix_candidates(t):
        out = []
        if t.endswith("'s"):
            out.append(t[:-2])
        if t.endswith('ies') and len(t) > 4:
            out.append(t[:-3] + 'y')
        if t.endswith('ied') and len(t) > 4:
            out.append(t[:-3] + 'y')
        if t.endswith('es'):
            out.append(t[:-2])
        if t.endswith('s') and not t.endswith('ss'):
            out.append(t[:-1])
        for suf in ('ed', 'ing', 'er', 'est'):
            if t.endswith(suf) and len(t) > len(suf) + 2:
                stem = t[:-len(suf)]
                out += [stem, stem + 'e']
                if len(stem) > 2 and stem[-1] == stem[-2]:
                    out.append(stem[:-1])
                if stem.endswith('i'):
                    out.append(stem[:-1] + 'y')
        if t.endswith('d') and len(t) > 3:
            out.append(t[:-1])
        return out

    def level_of_text(self, text):
        """單字回傳其級數；片語回傳片語中最高的級數（找不到的字略過）。"""
        levels = []
        for tok in words_of(text or ''):
            idxs = self.lookup(tok)
            if idxs:
                levels.append(min(self.entries[i]['level'] for i in idxs))
        return max(levels) if levels else None


# ---------- 讀檔 ----------

def load_exams():
    exams = []
    for p in sorted(PARSED.glob('*.json')):
        try:
            d = json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001 — 寫到一半的檔案直接略過並回報
            print(f'略過無法解析的 {p.name}：{e}', file=sys.stderr)
            continue
        if d.get('schema') != SCHEMA_ID:
            print(f'略過 {p.name}：schema 不是 {SCHEMA_ID}（請先跑 tools/normalize_exams.py）', file=sys.stderr)
            continue
        exams.append(d)
    return exams


def answer_text(q, bank):
    ans = q.get('answer')
    pool = q.get('options') or bank or {}
    if isinstance(ans, str) and ans in pool:
        return pool[ans]
    if isinstance(ans, list):
        return ' / '.join(pool.get(a, a) for a in ans)
    return ans if isinstance(ans, str) else None


def word_count_label(wc):
    """tags.word_count → 人看的字數要求，例如 {min:120} → "≥120"、{approx:120} → "≈120"、{min:120,max:150} → "120–150"。"""
    if not isinstance(wc, dict):
        return None
    lo, hi, approx = wc.get('min'), wc.get('max'), wc.get('approx')
    if approx:
        return f'≈{approx}'
    if lo and hi:
        return f'{lo}–{hi}'
    if lo:
        return f'≥{lo}'
    if hi:
        return f'≤{hi}'
    return None


def group_text(g):
    parts = [g.get('passage') or '']
    for p in g.get('passage_parts') or []:
        if isinstance(p, dict):
            parts.append(p.get('text') or '')
    return BLANK_RE.sub(' ', '\n'.join(parts))


# ---------- 統計 ----------

def describe(values):
    vals = [v for v in values if isinstance(v, (int, float))]
    if not vals:
        return None
    vals.sort()
    q = statistics.quantiles(vals, n=4) if len(vals) >= 4 else [vals[0], statistics.median(vals), vals[-1]]
    return {'n': len(vals), 'mean': round(statistics.fmean(vals), 3), 'min': round(vals[0], 3),
            'q1': round(q[0], 3), 'median': round(statistics.median(vals), 3), 'q3': round(q[-1], 3),
            'max': round(vals[-1], 3)}


def build(exams, lex):
    items, passages, summary_exams = [], [], []
    word_freq = defaultdict(lambda: Counter())          # 條目索引 → {role: count}
    word_years = defaultdict(set)                       # 條目索引 → {exam-year}
    excluded = Counter()                                # 排除在統計外的題數（reference 考卷、reused_from）

    def count_words(text, role, tag, exclude=()):
        seen = set()
        for tok in words_of(text or ''):
            for idx in lex.lookup(tok):
                if idx in exclude:
                    continue
                word_freq[idx][role] += 1
                if idx not in seen:
                    word_years[idx].add(tag)
                    seen.add(idx)

    for ex in exams:
        era = era_of(ex)
        tag = ex['id']
        secs = []
        for s in ex['sections']:
            qs = [q for g in s.get('groups', []) for q in g.get('questions', [])]
            secs.append({'type': s['type'], 'title': s.get('title'), 'questions': len(qs),
                         'points': s.get('points_total'),
                         'range': [min((q['no'] for q in qs if isinstance(q.get('no'), int)), default=None),
                                   max((q['no'] for q in qs if isinstance(q.get('no'), int)), default=None)]})
            if era == 'reference':
                excluded['reference_items'] += len(qs)
                excluded['reference_reused_items'] += sum(1 for q in qs if q.get('reused_from'))
                continue
            for g in s.get('groups', []):
                bank = g.get('options_bank')
                text = group_text(g)
                words = words_of(text)
                if words:
                    known = [w for w in words if lex.lookup(w)]
                    levels = [min(lex.entries[i]['level'] for i in lex.lookup(w)) for w in known]
                    gt = g.get('tags') or {}
                    passages.append({
                        'exam': tag, 'era': era, 'year': ex['year'], 'section': s['type'], 'group': g.get('id'),
                        'words': len(words), 'questions': len(g.get('questions', [])),
                        'in_wordlist_ratio': round(len(known) / len(words), 3),
                        'level_dist': {str(k): v for k, v in sorted(Counter(levels).items())},
                        'beyond_l4_ratio': round(sum(1 for lv in levels if lv >= 5) / len(words), 3),
                        'topic': gt.get('topic'), 'genre': gt.get('genre'), 'sdgs': gt.get('sdgs') or [],
                        'text_format': gt.get('text_format'), 'figures': len(g.get('figures') or []),
                        'multi_text': bool(g.get('passage_parts')),
                    })
                    count_words(text, 'passage', tag)
                for q in g.get('questions', []):
                    if q.get('reused_from'):
                        excluded['reused_items'] += 1
                        continue
                    at = answer_text(q, bank)
                    tags = q.get('tags') or {}
                    st = q.get('stats') or {}
                    items.append({
                        'exam': tag, 'era': era, 'year': ex['year'], 'section': s['type'], 'no': q.get('no'),
                        'label': q.get('label'), 'mode': q.get('mode'), 'answer_text': at,
                        'answer_level': lex.level_of_text(at) if s['type'] in CHOICE_TYPES and at else None,
                        'correct_rate': st.get('correct_rate'), 'discrimination': st.get('discrimination'),
                        'tags': tags, 'group_tags': g.get('tags') or {},
                    })
                    if s['type'] in CHOICE_TYPES and at:
                        # 片語答案（in addition to、pass through）裡的字分開計，免得 in、to 這類字灌爆「正解」排名
                        role = 'answer' if len(words_of(at)) == 1 else 'answer_in_phrase'
                        count_words(at, role, tag)
                    opts = q.get('options') or {}
                    for k, v in opts.items():
                        if k != q.get('answer'):
                            count_words(v, 'distractor', tag)
                    if q.get('stem'):
                        count_words(BLANK_RE.sub(' ', q['stem']), 'stem', tag)
                if bank and s['type'] in ('word_bank',):
                    answered = {q.get('answer') for q in g.get('questions', [])}
                    for k, v in bank.items():
                        if k not in answered:
                            count_words(v, 'distractor', tag)
        summary_exams.append({'id': tag, 'exam': ex['exam'], 'year': ex['year'], 'session': ex.get('session'),
                              'era': era, 'sections': secs,
                              'verified': bool((ex.get('extraction') or {}).get('verified_by'))})

    # 各時期 × 題型的分布
    by = defaultdict(lambda: defaultdict(Counter))
    rates = defaultdict(list)
    ans_levels = defaultdict(Counter)
    for it in items:
        key = f"{it['era']}|{it['section']}"
        for k in TAG_FIELDS:
            v = it['tags'].get(k)
            if v:
                by[key][k][v] += 1
        wc = word_count_label(it['tags'].get('word_count'))
        if wc:
            by[key]['word_count'][wc] += 1
        for k in ('patterns',):
            for v in it['tags'].get(k) or []:
                by[key][k][v] += 1
        if it['correct_rate'] is not None:
            rates[key].append(it['correct_rate'])
        if it['answer_level'] is not None:
            ans_levels[key][it['answer_level']] += 1
    dist = {}
    for key, fields in by.items():
        dist[key] = {k: dict(c.most_common()) for k, c in fields.items()}
    for key in set(rates) | set(ans_levels):
        dist.setdefault(key, {})
        if key in rates:
            dist[key]['correct_rate'] = describe(rates[key])
        if key in ans_levels:
            dist[key]['answer_level'] = {str(k): v for k, v in sorted(ans_levels[key].items())}

    pdist = defaultdict(lambda: {'words': [], 'genre': Counter(), 'text_format': Counter(), 'sdgs': Counter(),
                                 'beyond_l4_ratio': []})
    for p in passages:
        d = pdist[f"{p['era']}|{p['section']}"]
        d['words'].append(p['words'])
        d['beyond_l4_ratio'].append(p['beyond_l4_ratio'])
        if p['genre']:
            d['genre'][p['genre']] += 1
        if p['text_format']:
            d['text_format'][p['text_format']] += 1
        for n in p['sdgs']:
            d['sdgs'][n] += 1
    passage_dist = {k: {'words': describe(v['words']), 'beyond_l4_ratio': describe(v['beyond_l4_ratio']),
                        'genre': dict(v['genre'].most_common()), 'text_format': dict(v['text_format'].most_common()),
                        'sdgs': {str(n): c for n, c in sorted(v['sdgs'].items())}}
                    for k, v in pdist.items()}

    freq = []
    for idx, roles in word_freq.items():
        e = lex.entries[idx]
        years = sorted(word_years[idx])
        freq.append({'word': e['word'], 'level': e['level'], 'pos': e.get('pos'),
                     'function_word': bool(e.get('pos')) and all(p in FUNCTION_POS for p in e['pos']),
                     'answer': roles['answer'], 'answer_in_phrase': roles['answer_in_phrase'],
                     'distractor': roles['distractor'], 'stem': roles['stem'],
                     'passage': roles['passage'], 'total': sum(roles.values()),
                     'exams': len(years),
                     'exams_current': sum(1 for y in years if y.startswith('gsat-') and int(y.split('-')[1]) >= 111),
                     'exam_ids': years})
    freq.sort(key=lambda r: (r['function_word'], -r['answer'], -r['exams'], -r['total'], r['word']))
    unseen = [e['word'] for i, e in enumerate(lex.entries) if i not in word_freq]

    return {
        'summary': {'exams': summary_exams, 'distributions': dist, 'passages': passage_dist,
                    'lemmatizer': lex.mode, 'counts': {'exams': len(summary_exams), 'items': len(items),
                                                       'passages': len(passages)},
                    'excluded': {k: excluded[k] for k in ('reference_items', 'reference_reused_items', 'reused_items')}},
        'items': items, 'passages': passages,
        'word_frequency': {'lemmatizer': lex.mode, 'entries': freq, 'never_seen': unseen},
    }


def render_md(res):
    s = res['summary']
    lines = ['# 歷屆試題統計摘要', '',
             f"由 `tools/exam_stats.py` 自動產生，請勿手改。考卷 {s['counts']['exams']} 份、"
             f"題目 {s['counts']['items']} 題、選文 {s['counts']['passages']} 篇；詞形還原：{s['lemmatizer']}。", '',
             '時期：gsat-legacy＝學測 83–110、gsat-current＝學測 111 起、ast＝指考 91–110。', '',
             f"參考試卷不算進統計（{s['excluded']['reference_items']} 題，其中 {s['excluded']['reference_reused_items']} 題沿用歷屆試題）；"
             f"正式考卷中帶 reused_from 的題目另外排除 {s['excluded']['reused_items']} 題。"
             '作文字數取自 tags.word_count（≥＝至少、≈＝大約）；answer_function 是片語答案（answer_pos＝phrase）的功能詞性。', '']
    lines += ['## 考卷清單', '', '| 考卷 | 時期 | 大題（題數） | 已查證 |', '|---|---|---|---|']
    for e in s['exams']:
        secs = '、'.join(f"{x['type']}({x['questions']})" for x in e['sections'])
        lines.append(f"| {e['id']} | {e['era']} | {secs} | {'✓' if e['verified'] else ''} |")
    lines += ['', '## 各時期 × 題型：標註分布與答對率', '']
    for key in sorted(s['distributions']):
        d = s['distributions'][key]
        lines.append(f'### {key}')
        lines.append('')
        for k, v in d.items():
            if isinstance(v, dict) and k not in ('correct_rate',):
                top = '、'.join(f'{a} {b}' for a, b in list(v.items())[:12])
                lines.append(f'- **{k}**：{top}')
        if d.get('correct_rate'):
            c = d['correct_rate']
            lines.append(f"- **答對率**：平均 {c['mean']}、中位數 {c['median']}、四分位 {c['q1']}–{c['q3']}（n={c['n']}）")
        lines.append('')
    lines += ['## 選文', '', '| 時期｜題型 | 篇數 | 字數中位數（四分位） | L5 以上比例中位數 | 體裁 | 文本形式 |',
              '|---|---|---|---|---|---|']
    for key in sorted(s['passages']):
        p = s['passages'][key]
        w = p['words'] or {}
        b = p['beyond_l4_ratio'] or {}
        genre = '、'.join(f'{a} {c}' for a, c in list(p['genre'].items())[:5])
        fmt = '、'.join(f'{a} {c}' for a, c in list(p['text_format'].items())[:4])
        lines.append(f"| {key} | {w.get('n', 0)} | {w.get('median')}（{w.get('q1')}–{w.get('q3')}） | {b.get('median')} | {genre} | {fmt} |")
    wf = res['word_frequency']['entries']
    lines += ['', '## 最常當正解的單字（前 40；片語答案另計，功能詞排最後）', '', '| 詞 | 級 | 正解 | 干擾 | 選文 | 出現考卷數 |', '|---|---|---|---|---|---|']
    for r in wf[:40]:
        lines.append(f"| {r['word']} | {r['level']} | {r['answer']} | {r['distractor']} | {r['passage']} | {r['exams']} |")
    lines += ['', f"詞彙表中從未出現在任何考卷的條目：{len(res['word_frequency']['never_seen'])} 個。", '']
    return '\n'.join(lines)


def main(argv):
    exams = load_exams()
    lex = Lexicon()
    res = build(exams, lex)
    if '--check' in argv:
        print(json.dumps(res['summary']['counts'], ensure_ascii=False))
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    DOC.parent.mkdir(parents=True, exist_ok=True)
    dump = lambda obj: json.dumps(obj, ensure_ascii=False, indent=1) + '\n'  # noqa: E731
    (OUT / 'summary.json').write_text(dump(res['summary']), encoding='utf-8')
    (OUT / 'items.json').write_text(dump(res['items']), encoding='utf-8')
    (OUT / 'passages.json').write_text(dump(res['passages']), encoding='utf-8')
    (OUT / 'word-frequency.json').write_text(dump(res['word_frequency']), encoding='utf-8')
    DOC.write_text(render_md(res), encoding='utf-8')
    print(json.dumps(res['summary']['counts'], ensure_ascii=False), f"lemmatizer={lex.mode}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
