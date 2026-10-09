"""第 2 批起的批次規格（make_lots.py --topics --avoid-existing-bank）、主題總表與 validate_bank --lot 新欄位的測試。

用的資料：data/bank/topic-plan.json（主題總表，只讀）與 tools/tests/data 的範例題組；寫檔一律寫到暫存目錄，
不動 data/bank/lots、data/bank/v1。
執行：python3 -m unittest discover tools/tests
"""
import contextlib
import copy
import io
import json
import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import make_lots as ml  # noqa: E402
import validate_bank as vb  # noqa: E402

DATA = Path(__file__).resolve().parent / 'data'
WORD_BANK = DATA / 'ai.wb.0a1b2c@1.json'
READING = DATA / 'ai.rd.0c1d2e@1.json'
MIXED = DATA / 'ai.mx.0f1a2b@1.json'


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def has(msgs, *parts):
    return any(all(p in m for p in parts) for m in msgs)


def run_quiet(fn, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        try:
            code = fn(argv)
        except SystemExit as e:   # argparse 的 ap.error
            code = e.code
    return code, out.getvalue()


PLAN = ml.load_topic_plan()


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def write(self, data, name):
        p = self.tmp / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return p

    def group(self, src, lot_id, uid, topic=None):
        """拿範例題組改成某一批的題組（uid、generation.lot、tags.topic）。"""
        d = copy.deepcopy(load(src))
        d['uid'] = uid
        d['generation']['lot'] = lot_id
        if topic is not None:
            d['group']['tags']['topic'] = topic
        return d


# ---------------------------------------------------------------------------

class DefaultBehaviorTest(Case):
    def test_build_lot_without_new_options_equals_build(self):
        """不給 --topics／--avoid-existing-bank 時，第 2 批的輸出和以前（build／build_reading_mixed）完全相同。"""
        for section in ml.ALL_SECTIONS:
            for tier in ml.TIERS:
                old = ml.build(section, tier, '02') if section in ml.SECTIONS else ml.build_reading_mixed(section, tier, '02')
                self.assertEqual(ml.build_lot(section, tier, '02'), old, f'{section}-{tier}')

    def test_seq01_cannot_be_rewritten_with_topics(self):
        code, _ = run_quiet(ml.main, ['--topics', str(ml.TOPIC_PLAN), '--seq', '01', '--dry-run'])
        self.assertEqual(code, 2)
        code, _ = run_quiet(ml.main, ['--avoid-existing-bank', '--dry-run'])   # 沒給 --seq＝01
        self.assertEqual(code, 2)

    def test_parse_seqs(self):
        self.assertEqual(ml.parse_seqs('02'), ['02'])
        self.assertEqual(ml.parse_seqs('2,3'), ['02', '03'])
        self.assertEqual(ml.parse_seqs('02-05'), ['02', '03', '04', '05'])

    def test_seq01_lot_check_is_unchanged(self):
        """第一批的批次規格沒有新欄位：--lot 不做第 2 批起的檢查。"""
        d = load(WORD_BANK)
        r = vb.check_lot(vb.LOTS_DIR / 'word_bank-advanced-01.json', [(WORD_BANK, d)])
        self.assertNotIn('topics_used', r.metrics)
        self.assertFalse(has(r.warnings + r.errors, 'assigned_topics'))


class TopicPlanTest(Case):
    def test_plan_is_internally_consistent(self):
        errors, _ = ml.check_topic_plan(PLAN)
        self.assertEqual(errors, [])

    def test_every_tier_reaches_100_items(self):
        lots = ml.plan_lots(PLAN)
        for section, spec in PLAN['targets'].items():
            per = spec['questions_per_group']
            for tier, t in spec['tiers'].items():
                new = sum(e['count'] for lot_id, (e, _) in lots.items() if e['section'] == section and e['tier'] == tier)
                self.assertEqual(new, t['new_groups'], f'{section}-{tier}')
                self.assertGreaterEqual((t['counted_existing_groups'] + new) * per, 100, f'{section}-{tier}')
                self.assertTrue(all(e['count'] <= 6 for e, _ in lots.values()))

    def test_topics_are_unique_and_specific(self):
        zh = [ml.norm_topic(t['topic_zh']) for t in PLAN['topics']]
        en = [ml.norm_topic(t['angle_en']) for t in PLAN['topics']]
        self.assertEqual(len(zh), len(set(zh)))
        self.assertEqual(len(en), len(set(en)))
        self.assertGreaterEqual(len(zh), 240)

    def test_reading_forms_follow_seq01_ratio(self):
        """每個難度連同第一批（長文 4、圖表 2、表格 1、多文本 1）的文本形式比例 ≈ 4:2:1:1（每種差距 ≤1 組）。"""
        lots = ml.plan_lots(PLAN)
        for tier in ml.TIERS:
            total = dict(ml.READING_FORM_QUOTA)
            for e, topics in lots.values():
                if e['section'] == 'reading' and e['tier'] == tier:
                    for t in topics:
                        total[t['form']] += 1
            n = sum(total.values())
            for form, share in {'continuous': 4 / 8, 'chart': 2 / 8, 'table': 1 / 8, 'multi_text': 1 / 8}.items():
                self.assertLessEqual(abs(total[form] - n * share), 1, f'{tier} {form} {total}')

    def test_reading_and_mixed_lots_have_focus_sdg(self):
        for lot_id, (e, topics) in ml.plan_lots(PLAN).items():
            if e['section'] in ml.RM_SECTIONS:
                self.assertTrue(any(set(t['sdgs']) & set(ml.FOCUS_SDGS) for t in topics), lot_id)
                self.assertGreaterEqual(sum(1 for t in topics if t['sdgs']) / len(topics), 0.5, lot_id)

    def test_check_finds_problems(self):
        plan = copy.deepcopy(PLAN)
        by_id = {t['id']: t for t in plan['topics']}
        by_id['cz-b02-2']['topic_zh'] = by_id['cz-b02-1']['topic_zh']                  # 主題名重複
        by_id['cz-b02-3']['category'] = 'origins_evolution'                              # 配額不符
        for t in plan['topics']:
            if t['lot'] == 'reading-basic-02':
                t['sdgs'] = []                                                           # 沒有 SDG
        by_id['st-b02-2']['keywords'] = ['ketchup']                                      # 碰到已用主題
        plan['reserve_topics'][0]['topic_zh'] = by_id['st-b03-1']['topic_zh']             # 備用主題和已分配的重複
        errors, _ = ml.check_topic_plan(plan)
        self.assertTrue(has(errors, '備用主題', 'topic_zh 相同'))
        self.assertTrue(has(errors, 'cz-b02-2', 'topic_zh 相同'))
        self.assertTrue(has(errors, 'cloze-basic-02', '主題配額'))
        self.assertTrue(has(errors, 'reading-basic-02', 'SDG 3／12／14／15'))
        self.assertTrue(has(errors, 'st-b02-2', '番茄醬'))

    def test_check_against_bank_topics(self):
        plan = copy.deepcopy(PLAN)
        wb = load(WORD_BANK)
        wb['group']['tags']['topic'] = 'the ice pop: a frozen treat invented by accident'   # cz-b02-1 的關鍵字 ice pop
        errors, _ = ml.check_topic_plan(plan, banks=[(WORD_BANK, wb)])
        self.assertTrue(has(errors, 'cz-b02-1', '撞題', 'ice pop'))
        plan['reviewed_overlaps'].append({'id': 'cz-b02-1', 'against': wb['group']['tags']['topic'], 'note_zh': '測試'})
        errors, _ = ml.check_topic_plan(plan, banks=[(WORD_BANK, wb)])
        self.assertFalse(has(errors, 'cz-b02-1'))

    def test_chinese_topic_overlap_is_warned(self):
        """第一批閱讀、混合題起 tags.topic 是中文：共用兩字實詞列 warning；照主題出的那一組（同一個 lot）不算撞題。"""
        t = next(x for x in PLAN['topics'] if x['id'] == 'rd-b02-4')                    # 小琉球的綠蠵龜
        other = self.group(READING, 'reading-basic-01', 'ai.rd.aaaaaa', topic='綠蠵龜的產卵季')
        _, warnings = ml.check_topic_plan(PLAN, banks=[(READING, other)])
        self.assertTrue(has(warnings, 'rd-b02-4', '綠蠵'))
        mine = self.group(READING, t['lot'], 'ai.rd.bbbbbb', topic=t['topic_zh'])
        errors, warnings = ml.check_topic_plan(PLAN, banks=[(READING, mine)])
        self.assertFalse(has(errors + warnings, 'rd-b02-4'))
        same_elsewhere = self.group(READING, 'reading-basic-01', 'ai.rd.cccccc', topic=t['topic_zh'])
        errors, _ = ml.check_topic_plan(PLAN, banks=[(READING, same_elsewhere)])
        self.assertTrue(has(errors, 'rd-b02-4', '已在'))

    def test_zh_bigrams(self):
        self.assertEqual(ml.zh_bigrams('修理咖啡館'), {'修理', '理咖', '咖啡', '啡館'})
        self.assertEqual(ml.zh_bigrams('籃球的發明') & ml.zh_bigrams('籃球與排球的誕生'), {'籃球'})
        self.assertEqual(ml.zh_bigrams('history of the umbrella'), frozenset())
        self.assertEqual(ml.zh_bigrams('日本的便當文化') & ml.zh_bigrams('日本包袱巾'), frozenset())


class BuildLotTest(Case):
    def test_fields_and_counts(self):
        prev = load(WORD_BANK)
        lot = ml.build_lot('cloze', 'basic', '02', plan=PLAN, banks=[(WORD_BANK, prev)], avoid_bank=True)
        self.assertEqual(lot['lot'], 'cloze-basic-02')
        self.assertEqual(lot['count'], 6)
        self.assertEqual([a['slot'] for a in lot['assigned_topics']], [1, 2, 3, 4, 5, 6])
        self.assertEqual(sum(lot['topic_quota'][k] for k in ml.CATEGORY_KEYS), 6)
        self.assertEqual(dict(ml.topic_quota(6)), {k: lot['topic_quota'][k] for k in ml.CATEGORY_KEYS})
        keys = list(lot)
        self.assertEqual(keys[keys.index('topic_quota') + 1:keys.index('topic_quota') + 3], ['assigned_topics', 'topic_plan'])
        self.assertEqual(keys[keys.index('avoid') + 1:keys.index('avoid') + 3], ['avoid_bank_answers', 'generation_notes'])
        ab = lot['avoid_bank_answers']
        self.assertIn('protection', ab['answer_words_other_sections'])     # 文意選填用過的正解，對綜合測驗是「其他題型」
        self.assertEqual(ab['scanned_groups']['word_bank'], 1)
        ids = [x['id'] for x in lot['generation_notes']['items']]
        self.assertEqual(ids, ['GN-TOPIC', 'GN-AVOID', 'GN-DISTRACTOR', 'GN-BASIC-CONTEXT'])
        # 原本的欄位不變
        base = ml.build('cloze', 'basic', '02')
        for k in ('avoid', 'passage_band', 'item_rules', 'targets', 'set_composition', 'verification'):
            self.assertEqual(lot[k], base[k], k)

    def test_only_listed_seq01_adjustments_are_inherited(self):
        """混合題 advanced／top 第一批放寬的 passage_band 照舊沿用；規格書在第一批之後的審查修正不會被當成人工調整、蓋回舊值。"""
        mx = ml.build_lot('mixed', 'advanced', '02', plan=PLAN, banks=[])
        self.assertEqual(mx['inherited_from_seq01']['keys'], ['passage_band'])
        self.assertEqual(mx['passage_band'], load(ml.LOTS / 'mixed-advanced-01.json')['passage_band'])
        for section, tier in (('reading', 'basic'), ('word_bank', 'basic'), ('vocabulary', 'top')):
            lot = ml.build_lot(section, tier, '02', plan=PLAN, banks=[])
            self.assertNotIn('inherited_from_seq01', lot, f'{section}-{tier}')
            base = ml.build(section, tier, '02') if section in ml.SECTIONS else ml.build_reading_mixed(section, tier, '02')
            for k in ('passage_band', 'targets'):
                self.assertEqual(lot[k], base[k], f'{section}-{tier} {k}')

    def test_rejected_groups_are_not_counted(self):
        prev = load(WORD_BANK)
        prev['status'] = 'rejected'
        ab = ml.avoid_bank_answers('word_bank', [(WORD_BANK, prev)])
        self.assertEqual(ab['answer_words'], [])
        self.assertEqual(ab['scanned_groups']['word_bank'], 0)

    def test_reading_and_mixed_quotas_follow_plan(self):
        rd = ml.build_lot('reading', 'basic', '04', plan=PLAN, banks=[], avoid_bank=True)
        entry, topics = ml.plan_lots(PLAN)['reading-basic-04']
        self.assertEqual(rd['count'], 5)
        self.assertEqual({k: rd['form_quota'][k] for k in ml.PLAN_FORMS['reading']}, entry['forms'])
        self.assertEqual(rd['sdg_quota']['min_groups_with_focus_sdg'], 1)
        self.assertEqual([a['form'] for a in rd['assigned_topics']], [t['form'] for t in topics])
        mx = ml.build_lot('mixed', 'top', '05', plan=PLAN, banks=[], avoid_bank=True)
        self.assertEqual(mx['count'], 4)
        self.assertEqual(mx['sdg_quota']['min_groups_with_focus_sdg'], 1)   # 第 2 批起混合題也至少 1 篇
        self.assertEqual(mx['format'], ml.build_reading_mixed('mixed', 'top', '05')['format'])

    def test_vocabulary_topics_are_contexts(self):
        lot = ml.build_lot('vocabulary', 'top', '02', plan=PLAN, banks=[], avoid_bank=True)
        self.assertEqual(lot['count'], 5)
        self.assertTrue(all(len(a['contexts_en']) >= 5 for a in lot['assigned_topics']))
        self.assertNotIn('category', lot['assigned_topics'][0])

    def test_lot_not_in_plan(self):
        self.assertIsNone(ml.build_lot('vocabulary', 'basic', '09', plan=PLAN))

    def test_cli_writes_only_requested_lots(self):
        old = ml.LOTS
        ml.LOTS = self.tmp
        self.addCleanup(setattr, ml, 'LOTS', old)
        code, out = run_quiet(ml.main, ['--seq', '02', '--sections', 'cloze,structure', '--topics', str(ml.TOPIC_PLAN),
                                        '--avoid-existing-bank'])
        self.assertEqual(code, 0, out)
        names = sorted(p.name for p in self.tmp.glob('*.json'))
        self.assertEqual(names, [f'{s}-{t}-02.json' for s in ('cloze', 'structure') for t in ('advanced', 'basic', 'top')])
        lot = load(self.tmp / 'structure-top-02.json')
        n = ml.plan_lots(PLAN)['structure-top-02'][0]['count']
        self.assertEqual(lot['count'], n)
        self.assertEqual(len(lot['assigned_topics']), n)
        self.assertEqual(lot['created_on'], date.today().isoformat())
        r = vb.check_lot(self.tmp / 'structure-top-02.json', [])
        self.assertEqual(r.errors, [])
        self.assertTrue(has(r.warnings, '目前 0 組', f'{n} 組'))
        code, out = run_quiet(ml.main, ['--seq', '02', '--sections', 'cloze', '--topics', str(ml.TOPIC_PLAN)])
        self.assertIn('略過', out)                                   # 已存在的不覆寫


class LotCheckTest(Case):
    """validate_bank --lot 對第 2 批起新欄位的檢查。"""

    def wb_lot(self, prev):
        lot = ml.build_lot('word_bank', 'advanced', '02', plan=PLAN, banks=[(WORD_BANK, prev)], avoid_bank=True)
        return lot, self.write(lot, 'word_bank-advanced-02.json')

    def test_topics_answers_and_counts(self):
        prev = load(WORD_BANK)                                    # 第一批已用過這些正解
        lot, path = self.wb_lot(prev)
        topics = [a['topic_zh'] for a in lot['assigned_topics']]
        g1 = self.group(WORD_BANK, lot['lot'], 'ai.wb.111111', topic=topics[0])
        r = vb.check_lot(path, [(WORD_BANK, prev), (DATA / 'g1.json', g1)])
        self.assertTrue(has(r.errors, '題庫同題型已用過的正解', 'protection'))     # 文意選填：error
        self.assertTrue(has(r.warnings, '目前 1 組', '5 組'))
        self.assertEqual(r.metrics['topics_used'], '1/5')
        self.assertFalse(has(r.warnings, '在本批'))
        # 規格快照是空的（產生規格時題庫還沒有這些正解）：主題對不到、兩組同主題、其他批次用掉同一個主題、
        # 產生規格後其他批次才用掉的正解
        lot = ml.build_lot('word_bank', 'advanced', '02', plan=PLAN, banks=[], avoid_bank=True)
        path = self.write(lot, 'word_bank-advanced-02.json')
        g2 = self.group(WORD_BANK, lot['lot'], 'ai.wb.222222', topic='雨傘的歷史')
        g3 = self.group(WORD_BANK, lot['lot'], 'ai.wb.333333', topic=topics[0])
        other = self.group(WORD_BANK, 'word_bank-advanced-03', 'ai.wb.444444', topic=topics[1])
        r = vb.check_lot(path, [(DATA / 'g1.json', g1), (DATA / 'g2.json', g2), (DATA / 'g3.json', g3),
                                (DATA / 'o.json', other)])
        self.assertFalse(has(r.errors, '題庫同題型已用過的正解'))
        self.assertTrue(has(r.warnings, '雨傘的歷史', '對不到 assigned_topics'))
        self.assertTrue(has(r.errors, f'第 1 組的主題「{topics[0]}」被 2 組使用'))
        self.assertTrue(has(r.warnings, f'第 2 組的主題「{topics[1]}」已被其他批次', 'ai.wb.444444'))
        self.assertTrue(has(r.warnings, '在本批 3 組都出現'))                # 同一批不同組用同一個正解
        self.assertTrue(has(r.warnings, '其他批次（產生批次規格後新增）'))     # other 不在規格快照裡

    def test_count_and_slots_must_match(self):
        lot, _ = self.wb_lot(load(WORD_BANK))
        lot['count'] = 4
        lot['assigned_topics'][1]['topic_zh'] = lot['assigned_topics'][0]['topic_zh']
        r = vb.check_lot(self.write(lot, 'word_bank-advanced-02.json'), [])
        self.assertTrue(has(r.errors, 'assigned_topics 有 5 個主題，count 是 4'))
        self.assertTrue(has(r.errors, 'topic_zh', '出現 2 次'))

    def test_reading_sentences_sdgs_and_forms(self):
        prev = load(READING)
        lot = ml.build_lot('reading', 'basic', '02', plan=PLAN, banks=[(READING, prev)], avoid_bank=True)
        path = self.write(lot, 'reading-basic-02.json')
        a = lot['assigned_topics'][0]                              # 迴轉壽司：continuous、沒有指定 SDG
        g = self.group(READING, lot['lot'], 'ai.rd.dddddd', topic=a['topic_zh'])
        r = vb.check_lot(path, [(READING, prev), (DATA / 'g.json', g)])
        self.assertTrue(has(r.warnings, '正解句和題庫已用過的正解句相同'))      # 閱讀：warning
        self.assertTrue(has(r.warnings, '指定文本形式 continuous', 'chart'))
        b = next(x for x in lot['assigned_topics'] if x['sdgs'])
        g['group']['tags'].update(topic=b['topic_zh'], sdgs=[])
        r = vb.check_lot(path, [(DATA / 'g.json', g)])
        self.assertTrue(has(r.warnings, f'指定 SDG {sorted(b["sdgs"])}'))

    def test_mixed_answers_are_warnings(self):
        prev = load(MIXED)
        lot = ml.build_lot('mixed', 'basic', '02', plan=PLAN, banks=[(MIXED, prev)], avoid_bank=True)
        self.assertIn('weigh', lot['avoid_bank_answers']['answer_words'])
        path = self.write(lot, 'mixed-basic-02.json')
        g = self.group(MIXED, lot['lot'], 'ai.mx.eeeeee', topic=lot['assigned_topics'][0]['topic_zh'])
        r = vb.check_lot(path, [(DATA / 'g.json', g)])
        self.assertTrue(has(r.warnings, '題庫同題型已用過的正解', 'weigh'))
        self.assertFalse(has(r.errors, 'weigh'))

    def test_cloze_distractors(self):
        lot = ml.build_lot('cloze', 'top', '02', plan=PLAN, banks=[], avoid_bank=True)
        lot['avoid_bank_answers']['distractor_words'] = ['rumor']
        path = self.write(lot, 'cloze-top-02.json')

        def cloze(uid, topic, words):
            qs = [{'no': i + 1, 'answer': 'A', 'options': {'A': w[0], 'B': w[1], 'C': w[2], 'D': w[3]}} for i, w in enumerate(words)]
            return {'uid': uid, 'section_type': 'cloze', 'tier': 'top', 'status': 'draft', 'generation': {'lot': 'cloze-top-02'},
                    'group': {'tags': {'topic': topic}, 'passage': '', 'questions': qs}}
        five = [['scholar', 'harvest', 'jealous', 'rumor']] + [['wander', 'glimpse', 'thrive', 'shrink']] * 4
        g1 = cloze('ai.cz.aaaaaa', lot['assigned_topics'][0]['topic_zh'], five)
        g2 = cloze('ai.cz.bbbbbb', lot['assigned_topics'][1]['topic_zh'],
                   [['merchant', 'harvest', 'drought', 'vessel']] * 5)
        r = vb.check_lot(path, [(DATA / 'g1.json', g1), (DATA / 'g2.json', g2)])
        self.assertTrue(has(r.errors, '干擾字「harvest」在本批 2 組出現'))
        self.assertTrue(has(r.warnings, '干擾字「rumor」', '題庫已用過的干擾字'))
        self.assertFalse(has(r.errors, '干擾字「glimpse」'))      # 同一組裡重複不算

    def test_structure_clues_and_bridges(self):
        lot = ml.build_lot('structure', 'advanced', '02', plan=PLAN, banks=[], avoid_bank=True)
        path = self.write(lot, 'structure-advanced-02.json')

        def st(uid, slot, clues, openings):
            bank = {k: f'{o} sentence number {i}.' for i, (k, o) in enumerate(zip('ABCD', openings))}
            bank['E'] = 'An extra sentence that fits nowhere.'
            return {'uid': uid, 'section_type': 'structure', 'tier': 'advanced', 'status': 'draft',
                    'generation': {'lot': lot['lot']},
                    'group': {'tags': {'topic': lot['assigned_topics'][slot]['topic_zh']}, 'options_bank': bank,
                              'passage': 'One. [[1]] Two. [[2]] Three. [[3]] Four. [[4]] Five.',
                              'questions': [{'no': i + 1, 'answer': 'ABCD'[i]} for i in range(4)]},
                    'annotations': {'explanations': {'items': {str(i + 1): ({'clue_type': c} if c else {})
                                                               for i, c in enumerate(clues)}}}}
        g1 = st('ai.st.aaaaaa', 0, ['pronoun_reference', 'pronoun_reference', 'lexical_link', 'lexical_cohesion'],
                ['All of these ideas', 'This simple tool', 'Later', 'Then'])
        g2 = st('ai.st.bbbbbb', 1, ['pronoun_reference', 'contrast', 'chronology', None],
                ['All of them', 'However', 'In 1900', 'All of this'])
        r = vb.check_lot(path, [(DATA / 'g1.json', g1), (DATA / 'g2.json', g2)])
        self.assertTrue(has(r.errors, 'g1.json', '線索類型只有 2 種'))
        self.assertFalse(has(r.errors, 'g2.json', '線索類型'))
        self.assertTrue(has(r.warnings, 'g2.json', '第 4 格沒填 clue_type'))
        self.assertTrue(has(r.warnings, '承接句型 all_of_this 在本批出現 3 次'))

    def test_basic_context_needs_verified_feasibility(self):
        lot = ml.build_lot('word_bank', 'basic', '02', plan=PLAN, banks=[], avoid_bank=True)
        path = self.write(lot, 'word_bank-basic-02.json')
        g = self.group(WORD_BANK, lot['lot'], 'ai.wb.555555', topic=lot['assigned_topics'][0]['topic_zh'])
        g['tier'] = 'basic'
        g['status'] = 'verified'
        g['annotations']['elimination'] = {'feasible': {str(i): ['A'] for i in range(1, 11)}, 'perfect_matchings': 1}
        r = vb.check_lot(path, [(DATA / 'g.json', g)])
        self.assertTrue(has(r.warnings, 'GN-BASIC-CONTEXT'))
        g['annotations']['elimination']['feasible'].update({'1': ['A', 'B'], '2': ['C', 'D']})
        r = vb.check_lot(path, [(DATA / 'g.json', g)])
        self.assertFalse(has(r.warnings, 'GN-BASIC-CONTEXT'))


if __name__ == '__main__':
    unittest.main()
