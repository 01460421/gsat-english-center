"""中譯英（translation）與作文（composition）的檢查、學生畫面資料、盲譯／盲評寫入與批次規格的測試。

範例（只當測試資料，不在 data/bank/v1）：
    data/ai.tr.0b1c2d@1.json   手寫的「中譯英‧穩定基礎」：自備水壺上學（現在完成式、不定詞表目的）
    data/ai.cp.0e1f2a@1.json   手寫的「作文‧穩定基礎」：打掃時間的分工（看圖＋個人經驗，附 SVG 示意圖、構思圖與句型開頭、兩篇範文）
    data/tr-blind-a.json、tr-blind-b.json   假盲譯（gsat-bank-blind-translation/v1）
    data/cp-grade-a.json、cp-grade-b.json   假盲評（gsat-bank-blind-grading/v1）
走完 validate → student_view → 假驗證結果 → record_verification。每個測試都在暫存目錄裡複製一份再改，不動原檔。
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
from collections import Counter
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import make_writing_lots as mw  # noqa: E402
import record_verification as rv  # noqa: E402
import student_view as sv  # noqa: E402
import validate_bank as vb  # noqa: E402

DATA = Path(__file__).resolve().parent / 'data'
TRANSLATION = DATA / 'ai.tr.0b1c2d@1.json'
COMPOSITION = DATA / 'ai.cp.0e1f2a@1.json'


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def run_quiet(fn, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = fn(argv)
    return code, out.getvalue()


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def write(self, name, data):
        p = self.tmp / name
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return p

    def check(self, src, mutate=None):
        d = load(src)
        if mutate:
            mutate(d)
        p = self.write(Path(src).name, d)
        return vb.check_bank(p, d)

    def assertHas(self, msgs, needle):
        self.assertTrue(any(needle in m for m in msgs), f'找不到「{needle}」：\n' + '\n'.join(msgs))

    def assertLacks(self, msgs, needle):
        self.assertFalse(any(needle in m for m in msgs), f'不該有「{needle}」：\n' + '\n'.join(m for m in msgs if needle in m))


def tr_item(d, no='1'):
    return d['annotations']['rubric']['items'][no]


def model(d, label):
    return next(m for m in d['annotations']['model_texts'] if m['label'] == label)


class TranslationChecks(Case):
    def test_fixture_has_no_errors(self):
        r = self.check(TRANSLATION)
        self.assertEqual(r.errors, [])
        self.assertLacks(r.warnings, '題型專屬檢查尚未實作')

    def test_needs_two_references(self):
        def m(d):
            tr_item(d)['references'] = tr_item(d)['references'][:1]
            d['group']['questions'][0]['accepted_answers'] = None
        self.assertHas(self.check(TRANSLATION, m).errors, '本站參考譯文要 ≥2 種')

    def test_answer_and_accepted_answers_match_references(self):
        def m(d):
            d['group']['questions'][0]['answer'] = 'Many students bring water bottles.'
            d['group']['questions'][1]['accepted_answers'] = ['Something else entirely.']
        r = self.check(TRANSLATION, m)
        self.assertHas(r.errors, 'answer 必須等於')
        self.assertHas(r.errors, 'accepted_answers 必須是 null 或等於 references[1:]')

    def test_every_reference_contains_target_words(self):
        def m(d):
            tr_item(d)['target_words'][2]['alternatives'] = []   # bring 不再接受 carry
            tr_item(d)['references'][1] = 'Many students have begun carrying their own water bottles to school in recent years.'
            d['group']['questions'][0]['accepted_answers'] = [tr_item(d)['references'][1]]
        self.assertHas(self.check(TRANSLATION, m).errors, '沒有用到標的詞彙「bring」')

        def ok(d):
            tr_item(d)['references'][1] = 'Many students have begun carrying their own water bottles to school in recent years.'
            d['group']['questions'][0]['accepted_answers'] = [tr_item(d)['references'][1]]
        self.assertLacks(self.check(TRANSLATION, ok).errors, '標的詞彙「bring」')   # alternatives 有 carry

    def test_every_reference_uses_the_pattern(self):
        def m(d):
            tr_item(d)['references'][1] = 'Many students began bringing their own water bottles to school in recent years.'
            d['group']['questions'][0]['accepted_answers'] = [tr_item(d)['references'][1]]
        self.assertHas(self.check(TRANSLATION, m).errors, '看不出用了句構 PERF')

    def test_rubric_has_four_parts(self):
        def m(d):
            tr_item(d)['parts'] = tr_item(d)['parts'][:3]
        self.assertHas(self.check(TRANSLATION, m).errors, 'parts 必須剛好 4 個評分部分')

    def test_part_must_fit_every_reference(self):
        def m(d):
            tr_item(d)['parts'][2]['accepted'] = ['to bring their own water bottles']
        self.assertHas(self.check(TRANSLATION, m).errors, 'references[1] 裡找不到這一部分的任何可接受寫法')

    def test_part_zh_must_be_in_stem(self):
        def m(d):
            tr_item(d)['parts'][0]['zh'] = '最近幾年'
        self.assertHas(self.check(TRANSLATION, m).errors, '要逐字出現在中文題目')

    def test_reference_length_follows_spec_3_5(self):
        long_ref = ('In recent years, many of the students in our school have already started to bring their own '
                    'reusable water bottles to school every day.')

        def m(d):
            tr_item(d)['references'][0] = long_ref
            d['group']['questions'][0]['answer'] = long_ref
        self.assertHas(self.check(TRANSLATION, m).errors, 'basic 的參考譯文應為 10–18 字（SPEC §3.5）')

    def test_target_word_level(self):
        def m(d):
            tr_item(d)['target_words'].append({'word': 'corridor', 'zh': '走廊'})
        self.assertHas(self.check(TRANSLATION, m).errors, '標的詞彙「corridor」是 L5')

    def test_inversion_and_subjunctive_only_as_bonus(self):
        def m(d):
            tr_item(d)['patterns'].append({'code': 'ADVCL', 'grammar_id': 'gp-not-until-inversion', 'label_zh': 'Not until 倒裝',
                                           'frame': 'Not until … + 助動詞 + S + V', 'zh_trigger': '近年來'})
        self.assertHas(self.check(TRANSLATION, m).errors, '不可當標的句型：倒裝、假設、強調只放 bonus')

    def test_points_must_be_four(self):
        def m(d):
            d['group']['questions'][0]['points'] = 5
        self.assertHas(self.check(TRANSLATION, m).errors, '中譯英每句 4 分')

    def test_d8_reference_must_not_copy_official_translation(self):
        official = 'Now, more and more senior high school English teachers have increased the percentage of English use in class.'

        def m(d):
            tr_item(d)['references'][1] = official
            d['group']['questions'][0]['accepted_answers'] = [official]
        self.assertHas(self.check(TRANSLATION, m).errors, 'D8')

    def test_stem_must_not_rewrite_recent_exam(self):
        def m(d):
            d['group']['questions'][0]['stem'] = '現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。'
        self.assertHas(self.check(TRANSLATION, m).errors, '太接近原題')

    def test_top_needs_designated_pattern(self):
        def m(d):
            d['tier'] = 'top'
            d['generation']['lot'] = 'translation-top-01'
            d['generation']['spec_id'] = 'translation-top@2026-10-09'
        self.assertHas(self.check(TRANSLATION, m).errors, '超越頂標一組至少要有 1 個指定句型')

    def test_rubric_required(self):
        def m(d):
            d['annotations']['rubric'] = None
        self.assertHas(self.check(TRANSLATION, m).errors, '中譯英要有評分規準')


class CompositionChecks(Case):
    def test_fixture_has_no_errors(self):
        r = self.check(COMPOSITION)
        self.assertEqual(r.errors, [])
        self.assertLacks(r.warnings, '強調標記')

    def test_two_model_texts(self):
        def m(d):
            d['annotations']['model_texts'] = d['annotations']['model_texts'][:1]
        self.assertHas(self.check(COMPOSITION, m).errors, '範文要剛好兩篇')

    def test_model_text_length_and_paragraphs(self):
        def m(d):
            st = model(d, 'steady')
            st['text'] = st['text'].split('\n')[0]
        r = self.check(COMPOSITION, m)
        self.assertHas(r.errors, '至少 120 字')
        self.assertHas(r.errors, '範文要剛好 2 段')

    def test_notes_must_be_verbatim(self):
        def m(d):
            model(d, 'steady')['notes'][0]['text'] = 'Firstly,'
        self.assertHas(self.check(COMPOSITION, m).errors, '不在範文裡（必須逐字）')

    def test_connective_functions_at_least_four(self):
        def m(d):
            st = model(d, 'steady')
            st['notes'] = [n for n in st['notes'] if n.get('function') not in ('example', 'conclusion')]
        self.assertHas(self.check(COMPOSITION, m).errors, '轉承詞涵蓋 3 種功能')

    def test_detail_and_experience_notes_required(self):
        def m(d):
            top = model(d, 'top')
            top['notes'] = [n for n in top['notes'] if n['kind'] != 'experience']
        self.assertHas(self.check(COMPOSITION, m).errors, '沒有標註個人經驗句')

    def test_self_assessment_targets(self):
        def m(d):
            model(d, 'top')['self_assessment']['scores'] = {'content': 4, 'organization': 4, 'grammar': 4, 'vocabulary': 4}
        self.assertHas(self.check(COMPOSITION, m).errors, '頂標版的目標總分是 18–20')

    def test_scaffold_by_tier(self):
        def basic_without(d):
            d['annotations']['rubric']['scaffold'] = None
        self.assertHas(self.check(COMPOSITION, basic_without).errors, '穩定基礎要提供構思圖與句型開頭')

        def advanced_with(d):
            d['tier'] = 'advanced'
            d['generation']['lot'] = 'composition-advanced-01'
            d['generation']['spec_id'] = 'composition-advanced@2026-10-09'
            d['annotations']['rubric']['moves'][2]['code'] = 'opinion'
        self.assertHas(self.check(COMPOSITION, advanced_with).errors, 'advanced 不提供句型開頭')

    def test_top_needs_chart_or_pictures_and_evaluation(self):
        def m(d):
            d['tier'] = 'top'
            d['generation']['lot'] = 'composition-top-01'
            d['generation']['spec_id'] = 'composition-top@2026-10-09'
            d['annotations']['rubric']['scaffold'] = None
        r = self.check(COMPOSITION, m)
        self.assertHas(r.errors, '超越頂標要用圖表')
        self.assertHas(r.errors, '超越頂標第二段要評估或提出方案')
        self.assertHas(r.errors, '9-V-7')

    def test_prompt_must_specify_two_paragraphs(self):
        def m(d):
            d['group']['questions'][0]['stem'] = '提示：請描述圖片並寫出你的經驗。'
        self.assertHas(self.check(COMPOSITION, m).errors, '文分兩段')

    def test_svg_safety(self):
        def m(d):
            f = d['group']['figures'][0]
            f['svg'] = f['svg'].replace('<rect', '<script>alert(1)</script><rect', 1).replace('role="img"', 'role="img" onload="x()"')
        r = self.check(COMPOSITION, m)
        self.assertHas(r.errors, 'svg 不可有腳本')
        self.assertHas(r.errors, 'svg 不可有事件屬性')

    def test_rubric_must_not_copy_official_rubric(self):
        def m(d):
            d['annotations']['rubric']['criteria']['content']['bands'][0]['descriptor_zh'] = '主題清楚，並有具體、完整的相關細節支持。'
        self.assertHas(self.check(COMPOSITION, m).errors, 'D8：評分規準要用本站自己的文字')

    def test_model_text_must_not_copy_official(self):
        def m(d):
            st = model(d, 'steady')
            st['text'] = st['text'].replace('Now I am proud of my job.', 'Now I am proud of my job. Avoiding conflicts and ensuring '
                                            'world peace should be the goal that all humans pursue.')
        self.assertHas(self.check(COMPOSITION, m).errors, 'D8：範文要自己寫')


class StudentViews(Case):
    def test_translation_view_shows_only_chinese(self):
        v = sv.view_of(load(TRANSLATION))
        s = json.dumps(v, ensure_ascii=False)
        for banned in ('rubric', 'references', 'patterns', 'In recent years', 'answer"', 'tags', 'basic'):
            self.assertNotIn(banned, s)
        self.assertEqual([q['stem'] for q in v['group']['questions']],
                         ['近年來，許多學生已經開始自己帶水壺到學校。', '為了減少塑膠垃圾，學校的福利社也不再賣瓶裝水。'])
        self.assertTrue(all('answer_format' in q for q in v['group']['questions']))

    def test_grading_view_hides_labels_and_targets(self):
        bank = load(COMPOSITION)
        v = sv.grading_view(bank)
        s = json.dumps(v, ensure_ascii=False)
        for banned in ('"steady"', '"top"', 'self_assessment', '"notes"', 'explanation_zh', '穩健版', '頂標版', 'sentence_starters'):
            self.assertNotIn(banned, s)
        order = sv.grading_order(bank)
        texts = {m['label']: m['text'] for m in bank['annotations']['model_texts']}
        self.assertEqual([e['id'] for e in v['grading']['essays']], ['E1', 'E2'])
        for e in v['grading']['essays']:
            self.assertEqual(e['text'], texts[order[e['id']]])
            self.assertEqual(e['paragraphs'], 2)
        self.assertEqual(set(v['grading']['criteria']), {'content', 'organization', 'grammar', 'vocabulary'})
        self.assertIn('svg', v['group']['figures'][0])

    def test_grading_flag_only_for_composition(self):
        code, _ = run_quiet(sv.main, ['--grading', str(TRANSLATION)])
        self.assertEqual(code, 2)


class Verification(Case):
    def setup_bank(self, src):
        p = self.tmp / Path(src).name
        shutil.copy(src, p)
        return p

    def blind(self, name, mutate=None, data_name=None):
        d = load(DATA / name)
        if mutate:
            mutate(d)
        return self.write(data_name or name, d)

    def run_rv(self, argv):
        return run_quiet(rv.main, argv + ['--json'])

    def test_translation_full_chain_verified(self):
        bank = self.setup_bank(TRANSLATION)
        code, out = self.run_rv([str(bank), '--blind-a', str(DATA / 'tr-blind-a.json'), '--blind-b', str(DATA / 'tr-blind-b.json')])
        self.assertEqual(code, 0, out)
        d = load(bank)
        self.assertEqual(d['status'], 'verified')
        blinds = [v for v in d['verification'] if v['kind'] == 'blind_solver']
        self.assertEqual({b['details']['task'] for b in blinds}, {'blind_translation'})
        self.assertEqual(blinds[0]['details']['checks']['1']['target_hit_rate'], 1.0)
        self.assertTrue(blinds[0]['details']['checks']['1']['program_match'])
        # verified 的中譯英不需要干擾選項稽核
        r = vb.check_bank(bank, d)
        self.assertEqual(r.errors, [])

    def test_translation_missing_pattern_rejected(self):
        bank = self.setup_bank(TRANSLATION)

        def m(d):
            d['answers']['1']['translation'] = 'Recently, many students bring their own water bottles to school.'
            d['review']['1']['used_patterns'] = []
        a = self.blind('tr-blind-a.json', m)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'tr-blind-b.json'), '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('沒有用到標的句型', out)

    def test_translation_low_target_hit_rate_rejected(self):
        bank = self.setup_bank(TRANSLATION)

        def m(d):
            d['answers']['2']['translation'] = 'To decrease the rubbish made of plastic, the campus shop does not offer drinks in plastic containers now.'
        a = self.blind('tr-blind-a.json', m)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'tr-blind-b.json'), '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('個標的詞彙', out)

    def test_translation_outside_accepted_and_review_results(self):
        bank = self.setup_bank(TRANSLATION)

        def outside(d):
            d['review']['2']['within_accepted'] = False
        a = self.blind('tr-blind-a.json', outside)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'tr-blind-b.json'), '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('不在可接受寫法內', out)

        def warn(d):
            d['review']['1']['parts_check'] = 'warn'
            d['review']['1']['issues_zh'] = ['第 3 部分可以再接受 carry']
        a = self.blind('tr-blind-a.json', warn, 'tr-warn.json')
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'tr-blind-b.json'), '--dry-run'])
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)['checks'][1]['result'], 'warn')

        def no_reason(d):
            d['review']['1']['reference_check'] = 'fail'
        a = self.blind('tr-blind-a.json', no_reason, 'tr-noreason.json')
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'tr-blind-b.json'), '--dry-run'])
        self.assertEqual(code, 1)

    def test_translation_audit_is_input_error_and_missing_blind_is_draft(self):
        bank = self.setup_bank(TRANSLATION)
        code, _ = self.run_rv([str(bank), '--blind-a', str(DATA / 'tr-blind-a.json'), '--audit', str(DATA / 'audit.json'), '--dry-run'])
        self.assertEqual(code, 2)
        code, out = self.run_rv([str(bank), '--blind-a', str(DATA / 'tr-blind-a.json'), '--dry-run'])
        self.assertEqual(code, 3)
        self.assertEqual(json.loads(out)['missing'], ['blind_solver:B'])
        code, _ = self.run_rv([str(bank), '--blind-a', str(DATA / 'blind-a.json'), '--dry-run'])   # 選擇題格式的盲解檔
        self.assertEqual(code, 2)

    def test_composition_full_chain_verified(self):
        bank = self.setup_bank(COMPOSITION)
        code, out = self.run_rv([str(bank), '--blind-a', str(DATA / 'cp-grade-a.json'), '--blind-b', str(DATA / 'cp-grade-b.json')])
        self.assertEqual(code, 0, out)
        d = load(bank)
        self.assertEqual(d['status'], 'verified')
        b = next(v for v in d['verification'] if v['kind'] == 'blind_solver' and v['details']['solver'] == 'A')
        self.assertEqual(b['details']['task'], 'blind_grading')
        self.assertEqual(b['details']['totals'], {'steady': 15, 'top': 19})
        self.assertEqual(vb.check_bank(bank, d).errors, [])

    def test_composition_scores_out_of_range_rejected(self):
        bank = self.setup_bank(COMPOSITION)
        order = sv.grading_order(load(COMPOSITION))
        steady_id = next(k for k, v in order.items() if v == 'steady')

        def m(d):
            d['essays'][steady_id]['scores'] = {'content': 3, 'organization': 3, 'grammar': 3, 'vocabulary': 3}
        a = self.blind('cp-grade-a.json', m)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'cp-grade-b.json'), '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('穩健版要在 14–17', out)

    def test_composition_graders_must_agree(self):
        bank = self.setup_bank(COMPOSITION)
        order = sv.grading_order(load(COMPOSITION))
        steady_id = next(k for k, v in order.items() if v == 'steady')

        def low(d):
            d['essays'][steady_id]['scores'] = {'content': 4, 'organization': 3, 'grammar': 4, 'vocabulary': 3}   # 14
        def high(d):
            d['essays'][steady_id]['scores'] = {'content': 5, 'organization': 4, 'grammar': 4, 'vocabulary': 4}   # 17
        a = self.blind('cp-grade-a.json', low)
        b = self.blind('cp-grade-b.json', high)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(b), '--dry-run'])
        self.assertEqual(code, 1)
        self.assertIn('總分差 3 分', out)

    def test_composition_language_errors_rejected(self):
        bank = self.setup_bank(COMPOSITION)

        def m(d):
            d['essays']['E1']['errors'] = [{'excerpt': 'Each student has a different job.', 'explanation_zh': '假設的錯誤'}]
            d['essays']['E2']['errors'] = [{'excerpt': 'not in the essay at all', 'explanation_zh': '引文不在範文'}]
        a = self.blind('cp-grade-a.json', m)
        code, out = self.run_rv([str(bank), '--blind-a', str(a), '--blind-b', str(DATA / 'cp-grade-b.json'), '--dry-run'])
        self.assertEqual(code, 1)


class Lots(Case):
    def test_group_generated_from_plan_topic_is_not_a_collision(self):
        # 依總表某個主題出好的題組（run_id 指向該主題的批次）不能被當成和那個主題撞題。
        self.assertTrue(mw.generated_from('agent-2026-10-09-composition-basic-01', 'composition-basic-01'))
        self.assertFalse(mw.generated_from('agent-2026-10-09-composition-basic-01', 'composition-advanced-01'))
        self.assertFalse(mw.generated_from('agent-2026-10-09-translation-basic-01', 'translation-basic-1'))
        self.assertFalse(mw.generated_from('', 'composition-basic-01'))
        self.assertFalse(mw.generated_from('agent-2026-10-09-composition-basic-01', None))
        # 退件重出的題組（run_id 多了 -regen）也是依同一個批次的主題出的
        self.assertTrue(mw.generated_from('agent-2026-10-09-translation-advanced-04-regen', 'translation-advanced-04'))
        self.assertFalse(mw.generated_from('agent-2026-10-09-translation-advanced-04-regen', 'translation-advanced-05'))
        self.assertFalse(mw.generated_from('agent-2026-10-09-translation-advanced-04-regenx', 'translation-advanced-04'))

    def test_topic_plan_is_clean_and_lots_exist(self):
        plan = load(mw.PLAN)
        errs, _ = mw.check_topics(plan)
        self.assertEqual(errs, [])
        want = {f'translation-{t}-{s:02d}': (10, 2) for t in mw.TIERS for s in range(1, 6)}
        want |= {f'composition-{t}-01': (10, 1) for t in mw.TIERS}
        want |= {f'composition-{t}-02': (5, 1) for t in mw.TIERS}     # 2026-10-20 擴充（自組模擬考每個難度 15 份）
        self.assertEqual(len(want), 21)
        for lot_id, (count, per) in want.items():
            lot = load(vb.LOTS_DIR / f'{lot_id}.json')
            self.assertEqual((lot['count'], lot['questions_per_group']), (count, per), lot_id)
            self.assertEqual(len(lot['topics']), count)
            if lot_id.startswith('translation-'):
                self.assertEqual(len(lot['pattern_plan']), count)
        # 每個難度：中譯英 100 句、作文 15 題（01 批 10 題＋02 批 5 題）
        self.assertEqual(mw.SITE_GROUPS, {'translation': 50, 'composition': 15})
        for t in mw.TIERS:
            self.assertEqual(sum(load(vb.LOTS_DIR / f'translation-{t}-{s:02d}.json')['count'] * 2 for s in range(1, 6)), 100)
            self.assertEqual(sum(load(vb.LOTS_DIR / f'composition-{t}-{s:02d}.json')['count'] for s in (1, 2)), 15)

    def test_composition_targets_by_seq(self):
        """作文批次的 count 取主題數；site_target 是開這一批時的站主要求（01 批 10 題、02 批 15 題），已存在的 01 批規格不變。"""
        plan = load(mw.PLAN)
        lots = {lot['lot']: lot for lot in mw.build_all(plan, ('composition',), mw.TIERS, plan['created_on'])}
        entries = {x['lot']: x for x in plan['lots']}
        quota = {'basic': {'picture_scene': 5}, 'advanced': {'picture_issue': 5},
                 'top': {'chart': 2, 'picture_issue_abstract': 2, 'social_phenomenon': 1}}
        for t in mw.TIERS:
            first, second = lots[f'composition-{t}-01'], lots[f'composition-{t}-02']
            self.assertEqual((first['count'], first['site_target']['items_per_tier'], first['site_target']['lots_per_tier']), (10, 10, 1))
            self.assertEqual((second['count'], second['site_target']['items_per_tier'], second['site_target']['lots_per_tier']), (5, 15, 2))
            self.assertEqual(second['prompt_type_quota'], quota[t])
            self.assertEqual(first['created_on'], plan['created_on'])                       # lots[] 沒寫 created_on：用總表的
            self.assertEqual(second['created_on'], entries[f'composition-{t}-02']['created_on'])
        self.assertEqual(mw.composition_site_target('01')['items_per_tier'], 10)
        self.assertEqual(mw.composition_site_target('05')['items_per_tier'], 15)
        # 中譯英不受影響：一般批次照舊每批 10 組（逐位元組比對在 SupplementLots.test_regular_lots_are_unchanged）
        tr = mw.build_all(plan, ('translation',), mw.TIERS, plan['created_on'])
        self.assertTrue(all(x['count'] == 10 for x in tr if not mw.is_supplement(entries[x['lot']])))

    def test_pattern_plan_follows_tier_rules(self):
        plan = load(mw.PLAN)
        lots = mw.build_all(plan, mw.SECTIONS, mw.TIERS, plan['created_on'])
        per_sentence = {'basic': 1, 'advanced': 2, 'top': 2}
        for lot in lots:
            if lot['section_type'] != 'translation':
                continue
            for p in lot['pattern_plan']:
                for s in p['sentences']:
                    codes = [x['code'] for x in s['patterns']]
                    self.assertEqual(len(codes), per_sentence[lot['tier']], lot['lot'])
                    self.assertEqual(len(set(codes)), len(codes), lot['lot'])
                if lot['tier'] == 'top':
                    gids = {x['grammar_id'] for s in p['sentences'] for x in s['patterns']}
                    self.assertTrue(gids & set(vb.TOP_TRANSLATION_GRAMMAR_IDS), (lot['lot'], p['slot']))

    def test_topic_collision_is_detected(self):
        plan = copy.deepcopy(load(mw.PLAN))
        plan['topics'][0]['keywords'] = ['night market']   # topic-plan.json 已用過
        errs, _ = mw.check_topics(plan)
        self.assertTrue(any('night market' in e for e in errs))

    def test_lot_check_for_writing(self):
        tr = load(TRANSLATION)
        dup = copy.deepcopy(tr)
        dup['uid'] = 'ai.tr.0b1c2e'
        banks = [(self.write('ai.tr.0b1c2d@1.json', tr), tr), (self.write('ai.tr.0b1c2e@1.json', dup), dup)]
        r = vb.check_lot(vb.LOTS_DIR / 'translation-basic-01.json', banks)
        self.assertHas(r.errors, '同一批有重複的主題')
        self.assertHas(r.errors, '同一批有重複的中文題目')
        self.assertEqual(r.metrics['letters'], {})


class SupplementLots(Case):
    """補足批次（主題總表 lots[] 標 supplement: true，seq 06 起；README §7.2）。"""

    def plan(self):
        return load(mw.PLAN)

    def sup_entries(self, plan):
        return [x for x in plan['lots'] if mw.is_supplement(x)]

    def test_regular_lots_are_unchanged(self):
        # 01–05 批與作文的輸出和已存在的檔案逐位元組相同；拿掉補足批次後輸出也一樣
        plan = self.plan()
        regular = {x['lot'] for x in plan['lots'] if not mw.is_supplement(x)}
        lots = {lot['lot']: lot for lot in mw.build_all(plan, mw.SECTIONS, mw.TIERS, plan['created_on'])}
        for lot_id in sorted(regular):
            text = json.dumps(lots[lot_id], ensure_ascii=False, indent=2) + '\n'
            self.assertEqual(text, (vb.LOTS_DIR / f'{lot_id}.json').read_text(encoding='utf-8'), lot_id)
        stripped = copy.deepcopy(plan)
        stripped['lots'] = [x for x in stripped['lots'] if not mw.is_supplement(x)]
        stripped['topics'] = [t for t in stripped['topics'] if t['lot'] in regular]
        del stripped['supplement']
        built = mw.build_all(stripped, mw.SECTIONS, mw.TIERS, plan['created_on'])
        self.assertEqual(built, [lots[lot['lot']] for lot in built])
        self.assertEqual(mw.check_supplements(stripped, stripped['topics'], {x['lot']: x for x in stripped['lots']}), ([], []))

    def test_supplement_lot_files_follow_plan(self):
        plan = self.plan()
        entries = self.sup_entries(plan)
        self.assertTrue(entries)
        for x in entries:
            lot = load(vb.LOTS_DIR / f'{x["lot"]}.json')
            topics = [t for t in plan['topics'] if t['lot'] == x['lot']]
            self.assertTrue(1 <= x['count'] <= mw.SUPPLEMENT_MAX_COUNT)
            self.assertEqual((lot['count'], len(lot['topics']), len(lot['pattern_plan'])), (x['count'],) * 3, x['lot'])
            self.assertEqual([t['topic_zh'] for t in lot['topics']], [t['topic_zh'] for t in sorted(topics, key=lambda t: t['slot'])])
            self.assertIn('補足批次', lot['label_zh'])
            self.assertEqual(lot['supplement']['tier_gap']['lots'], plan['supplement']['translation'][x['tier']]['lots'])
            used = {q['grammar_id'] for p in lot['pattern_plan'] for s in p['sentences'] for q in s['patterns']}
            self.assertEqual(sorted(used), lot['pattern_coverage']['required_grammar_ids'])
            self.assertTrue(used <= set(mw.tier_pattern_codes(x['tier'])), x['lot'])
            for p in lot['pattern_plan']:
                codes = [[q['code'] for q in s['patterns']] for s in p['sentences']]
                self.assertTrue(all(len(c) == mw.PATTERNS_PER_SENTENCE[x['tier']] == len(set(c)) for c in codes), x['lot'])
                if x['tier'] == 'basic':
                    self.assertNotEqual(codes[0], codes[1], x['lot'])
                if x['tier'] == 'top':
                    gids = {q['grammar_id'] for s in p['sentences'] for q in s['patterns']}
                    self.assertTrue(gids & set(vb.TOP_TRANSLATION_GRAMMAR_IDS), (x['lot'], p['slot']))
        # 每個難度：已通過＋補足批次的組數 ≥ 50，缺口算式一致
        for tier, e in plan['supplement']['translation'].items():
            n = sum(x['count'] for x in entries if x['tier'] == tier)
            self.assertEqual(n, e['new_groups'])
            self.assertGreaterEqual(e['verified_groups'] + n, 50)
            self.assertEqual(e['need_groups'], 50 - e['verified_groups'])

    def test_pass_probability(self):
        self.assertAlmostEqual(mw.pass_probability(4, 0.85, 2), 0.988, places=3)
        self.assertAlmostEqual(mw.pass_probability(9, 0.85, 6), 0.966, places=3)
        self.assertAlmostEqual(mw.pass_probability(20, 0.75, 13), 0.898, places=3)
        self.assertAlmostEqual(mw.pass_probability(2, 0.9, 1), 0.99, places=6)

    def test_verified_counts_use_latest_version(self):
        bank = self.tmp / 'bank'
        d = bank / 'translation' / 'basic'
        d.mkdir(parents=True)
        tr = load(TRANSLATION)
        tr['status'] = 'verified'
        (d / 'ai.tr.0b1c2d@1.json').write_text(json.dumps(tr, ensure_ascii=False), encoding='utf-8')
        self.assertEqual(mw.verified_pattern_counts('basic', bank),
                         (1, {'gp-present-perfect': 1, 'gp-infinitive-purpose': 1}))
        tr2 = copy.deepcopy(tr)
        tr2['version'], tr2['status'] = 2, 'rejected'          # 退回另存 @2：@1 不能再算
        (d / 'ai.tr.0b1c2d@2.json').write_text(json.dumps(tr2, ensure_ascii=False), encoding='utf-8')
        self.assertEqual(mw.verified_pattern_counts('basic', bank), (0, {}))

    def test_gap_allocation_prefers_missing_high_frequency_patterns(self):
        bank = self.tmp / 'bank'
        d = bank / 'translation' / 'basic'
        d.mkdir(parents=True)
        tr = load(TRANSLATION)
        tr['status'] = 'verified'
        (d / 'ai.tr.0b1c2d@1.json').write_text(json.dumps(tr, ensure_ascii=False), encoding='utf-8')
        gp = mw.grammar_db()
        state = mw.gap_state('basic', Counter(), 8, gp, bank)      # 沒有 01–05 批：目標分布只看歷屆次數
        start = dict(state['deficit'])
        self.assertLess(start['gp-present-perfect'], start['gp-comparative-superlative'])   # 已通過的句型缺口較小
        plan, before = mw.supplement_pattern_plan('basic', 4, state, gp)
        self.assertEqual(before, start)
        gids = [q['grammar_id'] for p in plan for s in p['sentences'] for q in s['patterns']]
        self.assertEqual(len(gids), 8)
        self.assertEqual(len(set(gids)), 8)                                                 # 高頻句型各用一次（涵蓋）
        self.assertTrue(all(state['refs'][g] >= mw.HIGH_FREQ_REFS for g in gids))
        self.assertIn('gp-comparative-superlative', gids)
        self.assertNotIn('gp-as-as', gids)                                                  # 歷屆 0 次、缺口 ≤ 0
        self.assertAlmostEqual(sum(start.values()) - sum(state['deficit'].values()), 8)     # 依序扣掉缺口
        # 同一難度的下一個補足批次從扣過的缺口接著算
        after1 = dict(state['deficit'])
        _, before2 = mw.supplement_pattern_plan('basic', 1, state, gp)
        self.assertEqual(before2, after1)
        self.assertAlmostEqual(before2[gids[0]], start[gids[0]] - 1)

    def test_check_topics_supplement_rules(self):
        plan = self.plan()
        errs, warns = mw.check_topics(plan)
        self.assertEqual((errs, warns), ([], []))
        sup = self.sup_entries(plan)[0]
        bad = copy.deepcopy(plan)
        next(x for x in bad['lots'] if x['lot'] == sup['lot'])['count'] = 11
        errs, _ = mw.check_topics(bad)
        self.assertHas(errs, '補足批次每批 1–10 組')
        self.assertHas(errs, 'new_groups')
        bad = copy.deepcopy(plan)
        bad['supplement']['translation'][sup['tier']]['need_groups'] += 1
        errs, _ = mw.check_topics(bad)
        self.assertHas(errs, 'need_groups')
        bad = copy.deepcopy(plan)
        del bad['supplement']
        errs, _ = mw.check_topics(bad)
        self.assertHas(errs, '有補足批次時要寫 supplement')
        self.assertFalse(any('共 ' in e and '站主要求 50 組' in e for e in errs))       # 補足批次不算進每個難度 50 組
        # 中文主題共用兩字實詞列 warning；記進 reviewed_overlaps 後不再列
        bad = copy.deepcopy(plan)
        t = next(t for t in bad['topics'] if t['lot'] == sup['lot'])
        t['topic_zh'] = '園遊會前的' + t['topic_zh']
        _, warns = mw.check_topics(bad)
        self.assertHas(warns, f'{t["id"]}「{t["topic_zh"]}」')
        self.assertHas(warns, '校慶園遊會')
        bad['reviewed_overlaps'].append({'id': t['id'], 'against': '校慶園遊會', 'note_zh': '測試'})
        _, warns = mw.check_topics(bad)
        self.assertLacks(warns, '校慶園遊會')

    def test_cli_writes_supplement_lots(self):
        for name in ('LOTS', 'ROOT'):   # 寫到暫存目錄（ROOT 只用在印出相對路徑）
            self.addCleanup(setattr, mw, name, getattr(mw, name))
            setattr(mw, name, self.tmp)
        code, out = run_quiet(mw.main, ['--sections', 'translation', '--tiers', 'top'])
        self.assertEqual(code, 0, out)
        plan = self.plan()
        for x in self.sup_entries(plan):
            if x['tier'] != 'top':
                continue
            lot = load(self.tmp / f'{x["lot"]}.json')
            self.assertEqual(lot['count'], x['count'])
            r = vb.check_lot(self.tmp / f'{x["lot"]}.json', [])
            self.assertEqual(r.errors, [])
            self.assertHas(r.warnings, '目前 0 組')
        code, out = run_quiet(mw.main, ['--sections', 'translation', '--tiers', 'top'])
        self.assertIn('略過', out)


if __name__ == '__main__':
    unittest.main()
