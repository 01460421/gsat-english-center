"""tools/import_publisher.py 的測試：只用合成的試卷（不讀任何出版社資料）。

涵蓋：切題組與重編題號、uid 公式與穩定、版本、翰林難度的彙整、覆寫檔（排除、爭議、未決事項）、混合題的補齊門檻、
中譯英作文與不支援的題型、跨卷重複、來源登記檔的格式，以及輸出通過 P1 的 validate_publisher（找得到時）。

執行：python3 -m unittest discover tools/tests
P1 的 validate_publisher.py 不在 tools/ 時，可以用環境變數 GSAT_VALIDATE_PUBLISHER 指到它的路徑。
"""
import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
sys.dont_write_bytecode = True

import import_publisher as ip  # noqa: E402

# ---------------------------------------------------------------------------
# 合成資料
# ---------------------------------------------------------------------------

NOUNS = ['lantern', 'meadow', 'kettle', 'harbor', 'violin', 'orchard', 'pebble', 'blanket', 'compass', 'garden', 'ladder',
         'pillow', 'canyon', 'ribbon', 'feather', 'market', 'bridge', 'castle', 'island', 'forest']
ADJS = ['quiet', 'bright', 'gentle', 'narrow', 'golden', 'humble', 'curious', 'distant', 'tidy', 'patient']
VERBS = ['watched', 'painted', 'carried', 'visited', 'repaired', 'measured', 'described', 'collected', 'followed', 'cleaned']


def sentences(seed, n):
    out = []
    for i in range(n):
        a = ADJS[(seed * 7 + i) % len(ADJS)]
        b = NOUNS[(seed * 3 + i * 5) % len(NOUNS)]
        c = VERBS[(seed + i * 3) % len(VERBS)]
        d = NOUNS[(seed * 11 + i * 7 + 3) % len(NOUNS)]
        out.append(f'On day {seed * 100 + i} the {a} {b} keeper {c} the old {d} near village number {seed}{i}.')
    return out


def q_choice(no, answer='A', points=1, opts=None):
    return {'no': no, 'label': str(no), 'mode': 'single_choice', 'stem': None,
            'options': opts or {'A': f'alpha{no}', 'B': f'beta{no}', 'C': f'gamma{no}', 'D': f'delta{no}'},
            'answer': answer, 'accepted_answers': None, 'points': points, 'stats': None, 'scoring_notes': None,
            'tags': {'test_point': 'word_meaning', 'grammar_point_raw': '轉錄備註'}}


def q_bank(no, answer, points=1):
    return {'no': no, 'label': str(no), 'mode': 'bank_choice', 'stem': None, 'options': None, 'answer': answer,
            'accepted_answers': None, 'points': points, 'stats': None, 'scoring_notes': None, 'tags': {}}


def group(gid, passage, questions, bank=None, figures=None, tags=None):
    return {'id': gid, 'group_label': f'第{questions[0]["label"]}.至{questions[-1]["label"]}.題為題組', 'passage': passage,
            'passage_parts': None, 'figures': figures or [], 'options_bank': bank, 'questions': questions,
            'tags': tags if tags is not None else {'topic': '合成選文', 'genre': 'narrative', 'sdgs': [], 'text_format': 'continuous'}}


def make_paper(pid, seed, split_vocab=False, reading_seed=None):
    vocab_qs = []
    for i in range(1, 11):
        q = q_choice(i, 'ABCD'[i % 4], 1, {'A': ['meadow', 'kettle', 'harbor', 'violin'][i % 4], 'B': 'compass', 'C': 'garden', 'D': 'ladder'})
        q['stem'] = f'In test sentence {seed}{i} the {ADJS[i % 10]} child placed the ______ beside the {NOUNS[i]} at noon.'
        vocab_qs.append(q)
    vocab_groups = ([group(f's1g{i}', None, [q], tags=None) for i, q in enumerate(vocab_qs, 1)] if split_vocab
                    else [group('s1g1', None, vocab_qs, tags=None)])
    for g in vocab_groups:
        g['tags'] = None
        g['group_label'] = None
    s = sentences(seed, 12)
    cloze1 = group('s2g1', ' '.join(f'{x} [[{11 + i}]]' for i, x in enumerate(s[:5])), [q_choice(11 + i) for i in range(5)])
    s2 = sentences(seed + 50, 6)
    p2 = ' '.join(f'{x} [[{16 + i}]]' for i, x in enumerate(s2[:5])) + ' Later the same word ___17___ appeared again.'
    cloze2 = group('s2g2', p2, [q_choice(16 + i) for i in range(5)])
    s3 = sentences(seed + 90, 10)
    wb_bank = {chr(65 + i): f'word{seed}x{i}' for i in range(10)}
    wb = group('s3g1', ' '.join(f'{x} [[{21 + i}]]' for i, x in enumerate(s3)), [q_bank(21 + i, chr(65 + i)) for i in range(10)], bank=wb_bank)
    s4 = sentences(seed + 130, 8)
    st_bank = {chr(65 + i): f'Inserted sentence {seed} number {i} talks about the {NOUNS[i]}.' for i in range(5)}
    st = group('s4g1', ' '.join(f'{x} [[{31 + i}]]' for i, x in enumerate(s4[:4])) + ' ' + ' '.join(s4[4:]),
               [q_bank(31 + i, chr(65 + i), 2) for i in range(4)], bank=st_bank)
    rs = sentences(reading_seed if reading_seed is not None else seed + 170, 14)
    rq = [q_choice(35 + i, 'B', 2) for i in range(4)]
    for i, q in enumerate(rq):
        q['stem'] = f'Synthetic reading item {seed} asks about detail number {i} of the story?'
        q['tags'] = {'item_type': 'detail'}
    rq[1]['refers_to'] = {'text': 'keeper', 'occurrence': 1, 'note': '轉錄備註：不輸出'}
    fig = {'kind': 'chart', 'label': '第38題選項 (A)–(D)', 'caption': '第38題的四張圖', 'description': '四張簡單的長條圖。',
           'rows': None, 'question_no': 38}
    reading = group('s5g1', ' '.join(rs), rq, figures=[fig])
    ms = sentences(seed + 210, 12)
    mixed = group('s6g1', ' '.join(ms), [
        {'no': 47, 'label': '47', 'mode': 'fill_in_blank', 'stem': 'Fill [[47]] with one word.', 'options': None, 'answer': 'lantern',
         'accepted_answers': None, 'points': 2, 'stats': None, 'scoring_notes': '評分原則', 'tags': {}},
        {'no': 48, 'label': '48', 'mode': 'fill_in_blank', 'stem': 'Fill [[48]] with one word.', 'options': None, 'answer': 'meadow',
         'accepted_answers': None, 'points': 2, 'stats': None, 'scoring_notes': None, 'tags': {}},
        {'no': 49, 'label': '49', 'mode': 'multi_select', 'stem': 'Which are true?（多選題）',
         'options': {'A': 'one', 'B': 'two', 'C': 'three', 'D': 'four', 'E': 'five', 'F': 'six'}, 'answer': ['A', 'C'],
         'accepted_answers': None, 'points': 4, 'stats': None, 'scoring_notes': None, 'tags': {}},
        {'no': 50, 'label': '50', 'mode': 'short_answer', 'stem': 'Which word means a small stone?（簡答題）', 'options': None,
         'answer': 'pebble', 'accepted_answers': None, 'points': 2, 'stats': None, 'scoring_notes': None, 'tags': {}},
    ])
    tr = group('s7g1', None, [{'no': 1, 'label': '中譯英1', 'mode': 'translation', 'stem': '中文句子。', 'options': None, 'answer': 'x',
                               'accepted_answers': None, 'points': 4, 'stats': None, 'scoring_notes': None, 'tags': {}}])
    other = group('s9g1', 'Some text here.', [q_choice(51)])

    def sec(sid, t, groups):
        return {'id': sid, 'type': t, 'title': '一、標題', 'part': '選擇題', 'instructions': '說明：卷頭說明不輸出。', 'points_total': 10,
                'groups': groups}
    return {
        'schema': 'gsat-exam/v1.1', 'id': pid, 'exam': 'reference', 'year': 900, 'title': '合成模擬考',
        'sections': [sec('s1', 'vocabulary', vocab_groups), sec('s2', 'cloze', [cloze1, cloze2]), sec('s3', 'word_bank', [wb]),
                     sec('s4', 'structure', [st]), sec('s5', 'reading', [reading]), sec('s6', 'mixed', [mixed]),
                     sec('s7', 'translation', [tr]), sec('s9', 'sentence_matching', [other])],
        'extraction': {'method': 'synthetic', 'issues': ['轉錄備註']},
    }


def make_extras(pid, labels_by_q=None):
    qs = {}
    for n in list(range(1, 39)) + [47, 48, 49, 50]:
        qs[str(n)] = {'answer_key': 'A', 'difficulty_label': (labels_by_q or {}).get(str(n)), 'test_objective': None,
                      'explanation_zh': '詳解原文，不能輸出。', 'explanation_pages': [1]}
    return {'paper_id': pid, 'publisher_evidence': {'printed_company': None, 'printed_exam_title': '合成學年度第二次聯合模擬考試英文考科',
                                                    'printed_codes': ['X-1'], 'matches_toc_label': True},
            'questions': qs, 'figures': [], 'section_notes': {}, 'issues': ['轉錄備註']}


HL_LABELS = {str(n): lab for n, lab in zip(range(1, 39), ['易', '中偏易', '中', '中', '中偏難', '難', '中', '易', '中偏易', '中'] * 4)}


class Work:
    """暫存目錄裡的合成轉錄目錄、輸出目錄與覆寫檔目錄。"""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix='imp-pub-'))
        self.work = self.root / 'work'
        (self.work / 'papers').mkdir(parents=True)
        self.out = self.root / 'publisher'
        self.sources = self.root / 'sources.json'
        self.overrides = self.root / 'overrides'
        self.overrides.mkdir()
        self.report = self.root / 'report.md'
        self.papers = {}
        self.manifest = []

    def add(self, pid, label, seed, verified=True, split_vocab=False, reading_seed=None, disputes=None, unresolved=None, labels=None):
        meta = {'paper_id': pid, 'volume': 'mock2', 'label_from_toc': label, 'series_code': 'E2' if label == '翰林' else 'N2',
                'school_year': 900 + seed % 3, 'gsat_year': 901, 'exam_name_from_toc': '合成聯合模擬考',
                'divider_text': '成績統計 頂標 前標 均標 後標 底標 13 11 8 5 3 級距 6.0 到考 1,234 人'}
        self.manifest.append(meta)
        paper = make_paper(pid, seed, split_vocab, reading_seed)
        self.papers[pid] = paper
        self._write(f'{pid}.json', paper)
        self._write(f'{pid}.extras.json', make_extras(pid, labels))
        if verified:
            self._write(f'{pid}.verify.json', {'paper_id': pid, 'fixes': [], 'disputes': disputes or [], 'unresolved': unresolved or [],
                                               'publisher': {}, 'checker': 'OK'})
        (self.work / 'manifest.json').write_text(json.dumps({'papers': self.manifest}, ensure_ascii=False), encoding='utf-8')

    def _write(self, name, obj):
        (self.work / 'papers' / name).write_text(json.dumps(obj, ensure_ascii=False), encoding='utf-8')

    def override(self, pid, **kw):
        o = {'paper_id': pid, 'notes': [], 'groups': {}, 'unresolved': {}, 'disputes': {}}
        o.update(kw)
        (self.overrides / f'{pid}.json').write_text(json.dumps(o, ensure_ascii=False), encoding='utf-8')

    def run(self, **kw):
        return ip.run(self.work, self.out, self.sources, self.overrides, self.report, **kw)

    def files(self):
        return sorted(p for p in self.out.rglob('*.json'))

    def docs(self):
        return {p.relative_to(self.out).as_posix(): json.loads(p.read_text(encoding='utf-8')) for p in self.files()}

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def unit(res, pid, key):
    pr = next(p for p in res['results'] if p['paper_id'] == pid)
    return next(u for u in pr['units'] if u['key'] == key)


# ---------------------------------------------------------------------------
# 測試
# ---------------------------------------------------------------------------

class ImportTest(unittest.TestCase):
    def setUp(self):
        self.w = Work()
        self.w.add('hl-900-e2', '翰林', 1, labels=HL_LABELS)
        self.w.add('ny-900-n2', '南一', 2, split_vocab=True)
        self.w.add('ny-900-n3', '南一', 3, verified=False)

    def tearDown(self):
        self.w.cleanup()

    def test_split_renumber_and_strip(self):
        res = self.w.run()
        self.assertEqual(res['pending'], ['ny-900-n3'])
        self.assertEqual(sorted(p['paper_id'] for p in res['results']), ['hl-900-e2', 'ny-900-n2'])
        # 詞彙：轉錄拆成 10 組的也併成一組 10 題
        vo = unit(res, 'ny-900-n2', '1-10')['doc']
        self.assertEqual([q['label'] for q in vo['group']['questions']], [str(i) for i in range(1, 11)])
        self.assertEqual(vo['source_ref'], {'paper': None, 'labels': [str(i) for i in range(1, 11)]})
        self.assertEqual(vo['format_version'], 'vocabulary-10')
        # 綜合測驗：題號與空格從 1 起，第二個空格的底線題號一起改
        cz = unit(res, 'hl-900-e2', '16-20')['doc']
        self.assertEqual([q['no'] for q in cz['group']['questions']], [1, 2, 3, 4, 5])
        for n in range(1, 6):
            self.assertEqual(cz['group']['passage'].count(f'[[{n}]]'), 1)
        self.assertIn('___2___', cz['group']['passage'])
        self.assertNotIn('[[16]]', cz['group']['passage'])
        self.assertEqual(cz['source_ref']['labels'], ['16', '17', '18', '19', '20'])
        self.assertIsNone(cz['group']['group_label'])
        # 閱讀：圖的題號與標題、refers_to 的備註拿掉、轉錄標註的 *_raw 拿掉
        rd = unit(res, 'hl-900-e2', '35-38')['doc']
        fig = rd['group']['figures'][0]
        self.assertEqual(fig['question_no'], 4)
        self.assertEqual(fig['label'], '第4題選項 (A)–(D)')
        self.assertEqual(rd['group']['questions'][1]['refers_to'], {'text': 'keeper', 'occurrence': 1})
        text = json.dumps(self.w.docs(), ensure_ascii=False)
        for banned in ('詳解原文', '轉錄備註', 'scoring_notes', 'explanation_zh', '卷頭說明', '評分原則', 'grammar_point_raw'):
            self.assertNotIn(banned, text)
        # 形狀
        self.assertEqual(unit(res, 'hl-900-e2', '21-30')['doc']['format_version'], 'word_bank-10x10')
        self.assertEqual(unit(res, 'hl-900-e2', '31-34')['doc']['format_version'], 'structure-4x5')
        self.assertTrue(unit(res, 'hl-900-e2', '31-34')['standard'])
        # 必填欄位
        for d in self.w.docs().values():
            self.assertEqual(d['schema'], 'gsat-pub/v1')
            self.assertIsNone(d['explanation_basis'])
            self.assertNotIn('annotations', d)
            self.assertEqual(d['tag_basis'], 'agent')
            self.assertEqual(d['provenance']['license'], 'publisher-licensed')
            self.assertEqual(d['review']['by'], 'ai-auditor')
            self.assertEqual(d['review']['checks'], ['answers', 'tier', 'tags_sample', 'd8'])

    def test_not_v1_and_unsupported_sections_listed(self):
        res = self.w.run()
        pr = next(p for p in res['results'] if p['paper_id'] == 'hl-900-e2')
        self.assertEqual({(s['section'], s['reason']) for s in pr['skipped']},
                         {('translation', 'not_v1'), ('sentence_matching', 'unsupported_section')})
        self.assertFalse(any('/translation/' in k for k in self.w.docs()))

    def test_uid_formula_and_collision(self):
        h = hashlib.sha256('pub-x:11,12,13'.encode()).hexdigest()[:6]
        self.assertEqual(ip.uid_for('pub-x', ['11', '12', '13'], 'cloze', set()), f'pb.cz.{h}')
        nxt = f'{(int(h, 16) + 1) % (1 << 24):06x}'
        self.assertEqual(ip.uid_for('pub-x', ['11', '12', '13'], 'cloze', {f'pb.cz.{h}'}), f'pb.cz.{nxt}')

    def test_rerun_is_stable_and_versions_bump_only_on_content(self):
        self.w.run()
        first = {k: v for k, v in self.w.docs().items()}
        self.w.run()
        self.assertEqual(self.w.docs(), first)
        # 改一個字 → 同 uid、版本 +1，舊版保留
        pid = 'hl-900-e2'
        paper = self.w.papers[pid]
        paper['sections'][4]['groups'][0]['questions'][0]['stem'] += ' Fixed typo.'
        self.w._write(f'{pid}.json', paper)
        res = self.w.run()
        rd = unit(res, pid, '35-38')
        self.assertEqual(rd['doc']['version'], 2)
        old_uid = next(v['uid'] for k, v in first.items() if v['source_ref']['labels'][0] == '35' and v['source_id'] == f'pub-{pid}')
        self.assertEqual(rd['doc']['uid'], old_uid)
        self.assertTrue(any(k.endswith(f'{old_uid}@1.json') for k in self.w.docs()))
        self.assertTrue(any(k.endswith(f'{old_uid}@2.json') for k in self.w.docs()))

    def test_status_change_rewrites_same_version(self):
        self.w.manifest.clear()
        w = self.w
        w.add('hl-900-e2', '翰林', 1, labels=HL_LABELS,
              disputes=[{'label': '12', 'key': 'A', 'auditor_answer': 'B', 'reason': 'x'}])
        res = w.run()
        cz = unit(res, 'hl-900-e2', '11-15')
        self.assertEqual(cz['doc']['status'], 'draft')
        self.assertIn('爭議', cz['problems'][0])
        w.override('hl-900-e2', disputes={'12': {'decision': 'keep', 'reason': '維持答案表'}})
        res = w.run()
        cz2 = unit(res, 'hl-900-e2', '11-15')
        self.assertEqual(cz2['doc']['status'], 'verified')
        self.assertEqual((cz2['doc']['uid'], cz2['doc']['version']), (cz['doc']['uid'], 1))
        self.assertEqual(len([k for k in w.docs() if cz['doc']['uid'] in k]), 1)
        # 裁決改答案 → 內容改了，版本 +1
        w.override('hl-900-e2', disputes={'12': {'decision': 'change', 'answer': 'C', 'reason': '改答案'}})
        res = w.run()
        cz3 = unit(res, 'hl-900-e2', '11-15')
        self.assertEqual(cz3['doc']['version'], 2)
        self.assertEqual(cz3['doc']['group']['questions'][1]['answer'], 'C')

    def test_unresolved_gating(self):
        self.w.manifest.clear()
        self.w.add('ny-900-n2', '南一', 2, split_vocab=True, unresolved=['Q36: the key is arguable.', 'Page images are 1700 px wide.'])
        res = self.w.run()
        self.assertEqual(unit(res, 'ny-900-n2', '35-38')['doc']['status'], 'draft')
        self.assertEqual(unit(res, 'ny-900-n2', '11-15')['doc']['status'], 'verified')
        self.w.override('ny-900-n2', unresolved={'0': {'affects_answer': False, 'note': '稽核同意答案表'}})
        res = self.w.run()
        self.assertEqual(unit(res, 'ny-900-n2', '35-38')['doc']['status'], 'verified')
        self.w.override('ny-900-n2', unresolved={'0': {'affects_answer': True, 'note': '可能兩個答案'}})
        res = self.w.run()
        self.assertEqual(unit(res, 'ny-900-n2', '35-38')['doc']['status'], 'draft')

    def test_override_exclude_tier_and_draft(self):
        self.w.override('ny-900-n2', groups={'21-30': {'exclude': '選文和別卷重複'}, '31-34': {'tier': 'top', 'tier_reason': '站主指定'},
                                             '1-10': {'status': 'draft', 'status_reason': '再看一次'}})
        res = self.w.run()
        self.assertIn('站方排除', unit(res, 'ny-900-n2', '21-30')['excluded'])
        self.assertFalse(any('pub-ny-900-n2/v1/word_bank' in k for k in self.w.docs()))
        st = unit(res, 'ny-900-n2', '31-34')['doc']
        self.assertEqual((st['tier'], st['tier_basis']), ('top', 'manual'))
        self.assertEqual(unit(res, 'ny-900-n2', '1-10')['doc']['status'], 'draft')

    def test_override_rejects_unknown_fields(self):
        self.w.override('ny-900-n2', groups={'1-10': {'tierr': 'top'}})
        with self.assertRaises(ValueError):
            self.w.run()

    def test_mixed_needs_complete_accepted_answers(self):
        res = self.w.run()
        mx = unit(res, 'hl-900-e2', '47-50')
        self.assertTrue(mx['pending_mixed'])
        self.assertEqual([x['label'] for x in mx['open_items']], ['47', '48', '50'])
        self.assertFalse(any('/mixed/' in k for k in self.w.docs()))
        self.w.override('hl-900-e2', groups={'47-50': {
            'accepted_answers': {'47': ['lantern', 'lanterns'], '48': ['meadow'], '50': ['pebble', 'a pebble']},
            'scoring_extra': {'47': {'partial_credit_forms': ['Lantern'], 'interchangeable_with': None}},
            'open_key_complete': True}})
        res = self.w.run()
        d = unit(res, 'hl-900-e2', '47-50')['doc']
        self.assertEqual(d['open_key'], 'complete')
        self.assertEqual(d['group']['questions'][0]['accepted_answers'], ['lantern', 'lanterns'])
        self.assertEqual(d['scoring_extra'], {'1': {'partial_credit_forms': ['Lantern'], 'interchangeable_with': None}})
        self.assertEqual(d['format_version'], 'mixed-4')

    def test_publisher_tier_aggregation(self):
        tl = ip.HANLIN_TIER_LABELS
        self.assertEqual(ip.publisher_tier(['易', '中偏易', '易', '中偏易'], tl), 'basic')
        self.assertEqual(ip.publisher_tier(['易', '易', '中', '中'], tl), 'advanced')     # 0.5：界線上算較難的一級
        self.assertEqual(ip.publisher_tier(['中', '中偏難', '中', '中偏易'], tl), 'advanced')
        self.assertEqual(ip.publisher_tier(['中', '中偏難', '難', '中'], tl), 'top')      # 1.5
        self.assertEqual(ip.publisher_tier([None, '難', None], tl), 'top')
        self.assertIsNone(ip.publisher_tier([None, None], tl))
        res = self.w.run()
        self.assertEqual(unit(res, 'hl-900-e2', '11-15')['doc']['tier_basis'], 'publisher')
        self.assertEqual(unit(res, 'ny-900-n2', '11-15')['doc']['tier_basis'], 'metrics')

    def test_cross_paper_duplicates_dropped(self):
        self.w.manifest.clear()
        self.w.add('hl-900-e2', '翰林', 1, labels=HL_LABELS, reading_seed=77)
        self.w.add('ny-900-n2', '南一', 2, split_vocab=True, reading_seed=77)
        res = self.w.run()
        a, b = unit(res, 'hl-900-e2', '35-38'), unit(res, 'ny-900-n2', '35-38')
        dropped = [x for x in (a, b) if x.get('duplicate_of')]
        self.assertEqual(len(dropped), 1)
        self.assertIn('跨卷重複', dropped[0]['excluded'])

    def test_sources_registry(self):
        res = self.w.run()
        text = self.w.sources.read_text(encoding='utf-8')
        p1 = ('{\n  "sources": [\n    {\n      "id": "ai-bank",\n      "ns": "ai",\n      "kind": "ai_bank",\n'
              '      "label_zh": "本站題庫",\n      "publisher_zh": null,\n      "product_zh": null,\n'
              '      "attribution_zh": "AI 出題・已通過自動驗證・人工審核中",\n'
              '      "licence": { "code": "original-ai", "ref": null, "scope": ["web", "pdf", "ai_assist", "explanations"], "public_ok": true, "until": null },\n'
              '      "active": true,\n      "added": "2026-10-09",\n      "retired_on": null\n    }')
        self.assertTrue(text.startswith(p1))
        srcs = {s['id']: s for s in json.loads(text)['sources']}
        self.assertEqual(sorted(srcs), ['ai-bank', 'pub-hl-900-e2', 'pub-ny-900-n2', 'pub-ny-900-n3'])
        hl = srcs['pub-hl-900-e2']
        self.assertEqual(hl['label_zh'], '翰林出版')
        self.assertEqual(hl['publisher_zh'], '翰林出版事業股份有限公司')
        self.assertEqual(hl['attribution_zh'], f'本題出自翰林出版《{hl["product_zh"]}》，經授權使用')
        self.assertEqual(hl['tier_labels']['中'], 'advanced')
        self.assertEqual(hl['licence'], {'code': 'publisher-licensed', 'ref': None, 'scope': ['web', 'pdf', 'ai_assist'], 'public_ok': True, 'until': None})
        self.assertEqual(srcs['pub-ny-900-n2']['publisher_zh'], '南一書局企業股份有限公司')
        self.assertNotIn('tier_labels', srcs['pub-ny-900-n2'])
        # 既有登記不覆寫（站主改過的欄位保留）
        raw = json.loads(text)
        raw['sources'][1]['active'] = False
        self.w.sources.write_text(ip.dump_sources(raw['sources']), encoding='utf-8')
        self.w.run()
        self.assertFalse(json.loads(self.w.sources.read_text(encoding='utf-8'))['sources'][1]['active'])
        self.assertEqual(res['sources_added'], ['pub-hl-900-e2', 'pub-ny-900-n2', 'pub-ny-900-n3'])

    def test_report_has_no_question_text(self):
        self.w.run()
        rep = self.w.report.read_text(encoding='utf-8')
        self.assertIn('hl-900-e2', rep)
        self.assertIn('待補齊', rep)
        for banned in ('keeper', 'lantern', '詳解原文', '轉錄備註', 'Synthetic reading'):
            self.assertNotIn(banned, rep)

    def test_outputs_pass_validate_publisher(self):
        path = os.environ.get('GSAT_VALIDATE_PUBLISHER') or str(TOOLS / 'validate_publisher.py')
        if not Path(path).exists():
            self.skipTest('找不到 validate_publisher.py（P1 合併後就在 tools/）')
        check = ip.load_validator(path)
        self.w.override('hl-900-e2', groups={'47-50': {
            'accepted_answers': {'47': ['lantern'], '48': ['meadow'], '50': ['pebble']}, 'open_key_complete': True}})
        res = self.w.run(validator=check)
        self.assertGreater(res['validation']['files'], 10)
        self.assertEqual(res['validation']['errors'], 0, res['validation']['bad'])


if __name__ == '__main__':
    unittest.main()
