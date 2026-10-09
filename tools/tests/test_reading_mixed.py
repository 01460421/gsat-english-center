"""閱讀（reading）與混合題（mixed）的檢查、學生畫面資料、盲解寫入與批次規格的測試。

範例（只當測試資料，不在 data/bank/v1、data/bank/facts）：
    data/ai.rd.0c1d2e@1.json   手寫的「圖表閱讀‧穩定基礎」：World Bank WDI 五歲以下兒童死亡率（SH.DYN.MORT，2026-10-09 查證）
    data/ai.mx.0f1a2b@1.json   手寫的「混合題‧穩定基礎」：UNEP Food Waste Index Report 2024 的數字（2026-10-09 查證）
    data/facts/sdg3-0001.json、data/facts/sdg12-0001.json   對應的事實單
    data/rd-blind-a.json、rd-blind-b.json、rd-audit.json、mx-blind-a.json、mx-blind-b.json、mx-audit.json   假盲解與稽核
走完 validate → student_view → 假盲解 → record_verification。每個測試都在暫存目錄裡複製一份再改，不動原檔。
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
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import make_lots as ml  # noqa: E402
import record_verification as rv  # noqa: E402
import student_view as sv  # noqa: E402
import validate_bank as vb  # noqa: E402

DATA = Path(__file__).resolve().parent / 'data'
FACTS = DATA / 'facts'
READING = DATA / 'ai.rd.0c1d2e@1.json'
MIXED = DATA / 'ai.mx.0f1a2b@1.json'


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def run_quiet(fn, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = fn(argv)
    return code, out.getvalue()


class Case(unittest.TestCase):
    """事實單目錄換成 tools/tests/data/facts（validate_bank.FACTS_DIR），結束時換回來。"""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        old = vb.FACTS_DIR
        vb.FACTS_DIR = FACTS
        vb._fact_cache.clear()

        def restore():
            vb.FACTS_DIR = old
            vb._fact_cache.clear()
        self.addCleanup(restore)

    def write(self, data, name):
        p = self.tmp / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return p

    def report(self, data, name):
        r, _ = vb.check_file(self.write(data, name))
        return r

    def errors(self, data, name):
        return self.report(data, name).errors

    def use_facts_dir(self, sheets):
        """把事實單寫進暫存目錄並改用它（測試壞掉的事實單）。"""
        d = self.tmp / 'facts'
        d.mkdir(exist_ok=True)
        for s in sheets:
            (d / f'{s["id"]}.json').write_text(json.dumps(s, ensure_ascii=False), encoding='utf-8')
        vb.FACTS_DIR = d
        vb._fact_cache.clear()


def has(msgs, *parts):
    return any(all(p in m for p in parts) for m in msgs)


# ---------------------------------------------------------------------------

class ReadingTest(Case):
    name = 'ai.rd.0c1d2e@1.json'

    def test_fixture_has_no_errors(self):
        r = self.report(load(READING), self.name)
        self.assertEqual(r.errors, [])
        self.assertTrue(r.metrics['band']['ok'])
        self.assertIn('reading-basic-01', r.metrics['band']['basis'])   # 帶取自批次規格（SPEC §3.4＋passage_overrides）

    def test_each_question_needs_verbatim_evidence(self):
        d = load(READING)
        d['annotations']['explanations']['items']['3']['evidence'] = ['South Asia had the lowest rate of all.']
        self.assertTrue(has(self.errors(d, self.name), 'evidence', '找不到'))
        d = load(READING)
        del d['annotations']['explanations']['items']['2']
        self.assertTrue(has(self.errors(d, self.name), '缺少這一題的解析'))
        d = load(READING)
        d['annotations']['explanations'] = None
        self.assertTrue(has(self.errors(d, self.name), 'explanations 不可為 null'))

    def test_chart_text_counts_as_evidence(self):
        d = load(READING)
        d['annotations']['explanations']['items']['2']['evidence'] = ['2020, Sub-Saharan Africa: 75.9 per 1,000 live births',
                                                                      '2020 | 39.2 | 32.4 | 75.9']
        self.assertEqual(self.errors(d, self.name), [])

    def test_chart_format(self):
        d = load(READING)
        ch = d['group']['figures'][0]['chart']
        ch['series'][0]['values'] = [93.5, 76.7, 50.6]            # 長度不一致
        ch['series'][1]['values'][1] = '90'                       # 字串不是數字
        ch['type'] = 'area'
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, 'values 有 3 個', 'categories 有 4 個'), errs)
        self.assertTrue(has(errs, '都是數字'), errs)
        self.assertTrue(has(errs, "type='area'"), errs)
        d = load(READING)
        ch = d['group']['figures'][0]['chart']
        ch['type'] = 'pie'
        self.assertTrue(has(self.errors(d, self.name), '圓餅圖', '1 個數列'))
        d = load(READING)
        del d['group']['figures'][0]['chart']
        self.assertTrue(has(self.errors(d, self.name), 'kind=chart 的圖要有 chart 物件'))

    def test_chart_source_whitelist(self):
        d = load(READING)
        d['group']['figures'][0]['chart']['source']['url'] = 'https://www.theguardian.com/data/child-deaths'
        self.assertTrue(has(self.errors(d, self.name), '禁止清單', 'guardian'))
        d['group']['figures'][0]['chart']['source']['url'] = 'https://example.com/data'
        self.assertTrue(has(self.errors(d, self.name), '不在來源白名單'))
        d['group']['figures'][0]['chart']['source'].update(url='https://ourworldindata.org/grapher/x', license='CC-BY-SA-4.0')
        self.assertTrue(has(self.errors(d, self.name), '授權必須是 CC-BY-4.0'))

    def test_numbers_must_be_found(self):
        d = load(READING)
        d['group']['passage'] = d['group']['passage'].replace('the rate was 93.5', 'the rate was 95.3')
        self.assertTrue(has(self.errors(d, self.name), 'group.passage', '95.3', '查不到'))
        d = load(READING)
        d['group']['figures'][0]['description'] += '2030 年的目標是 25。'
        self.assertTrue(has(self.errors(d, self.name), 'description', '2030', '對不上'))
        d = load(READING)
        d['group']['questions'][2]['stem'] = 'Which of the following is true about South Asia in 2005?'
        self.assertTrue(has(self.errors(d, self.name), 'q3.stem', '2005'))
        # 依文中小數位數四捨五入、同一數列兩值的差都算查得到；選項裡的錯數字只是 warning
        d = load(READING)
        d['group']['passage'] = d['group']['passage'].replace('it had dropped to 39.2', 'it had dropped to 39, 54.3 points lower')
        d['group']['questions'][1]['options']['D'] = 'The rate of 61.2 in every group.'
        r = self.report(d, self.name)
        self.assertEqual(r.errors, [])
        self.assertTrue(has(r.warnings, 'options.D', '61.2'))

    def test_chart_values_must_match_dataset(self):
        d = load(READING)
        d['group']['figures'][0]['chart']['series'][0]['values'][3] = 41.0
        d['group']['figures'][0]['description'] = d['group']['figures'][0]['description'].replace('39.2', '41')
        self.assertTrue(has(self.errors(d, self.name), '數值 41', 'datasets'))
        d = load(READING)
        d['provenance']['sources'] = [{'source_id': 'fact:sdg3-0001', 'role': 'fact'}]
        self.assertTrue(has(self.errors(d, self.name), 'role=dataset'))

    def test_facts_must_exist_for_ai_original(self):
        d = load(READING)
        d['provenance']['sources'].append({'source_id': 'fact:sdg3-9999', 'role': 'fact'})
        self.assertTrue(has(self.errors(d, self.name), 'sdg3-9999', '不存在'))

    def test_provenance_url_is_checked(self):
        d = load(READING)
        d['provenance']['sources'][1]['url'] = 'https://www.gutenberg.org/ebooks/1'
        self.assertTrue(has(self.errors(d, self.name), '禁止清單', 'gutenberg'))

    def test_broken_fact_sheet_is_an_error_in_the_bank_file(self):
        sheet = load(FACTS / 'sdg3-0001.json')
        sheet['sources'][1]['url'] = 'https://www.theguardian.com/global-development/2024/child-mortality'
        self.use_facts_dir([sheet])
        self.assertTrue(has(self.errors(load(READING), self.name), '事實單 sdg3-0001.json', 'error'))

    def test_item_type_mix_is_a_warning(self):
        d = load(READING)
        d['group']['questions'][3]['tags']['item_type'] = 'detail'
        r = self.report(d, self.name)
        self.assertEqual(r.errors, [])
        self.assertTrue(has(r.warnings, 'SPEC §3.5', '上下文詞義或指代'))

    def test_option_codes(self):
        d = load(READING)
        d['annotations']['explanations']['items']['1']['option_codes']['B'] = 'NM'   # B 是正解
        d['annotations']['explanations']['items']['2']['option_codes']['A'] = 'XX'
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '只標錯誤選項'))
        self.assertTrue(has(errs, "'XX'"))

    def test_mixed_only_fields_rejected_on_choice_items(self):
        d = load(READING)
        d['annotations']['explanations']['items']['1']['source_token'] = 'rate'
        self.assertTrue(has(self.errors(d, self.name), 'source_token 只用在 fill_in_blank'))

    def test_table_figure(self):
        d = load(READING)
        d['group']['figures'] = [{'kind': 'table', 'label': None, 'caption': 'Under-5 deaths per 1,000 live births',
                                  'description': '三個地區兩個年份的表格。',
                                  'rows': [['Region', '1990', '2020'], ['World', '93.5', '39.2'],
                                           ['South Asia', '128.6', '32.4'], ['Sub-Saharan Africa', '178.5']],
                                  'question_no': None}]
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '欄數要一樣'), errs)


class MixedTest(Case):
    name = 'ai.mx.0f1a2b@1.json'

    def test_fixture_has_no_errors(self):
        r = self.report(load(MIXED), self.name)
        self.assertEqual(r.errors, [])
        self.assertTrue(r.metrics['band']['ok'])

    def test_fill_answer_must_change_form(self):
        d = load(MIXED)
        q2 = d['group']['questions'][1]
        q2['answer'], q2['accepted_answers'] = 'fill', ['fill']           # 逐字照抄
        d['annotations']['explanations']['items']['2']['transform'] = 'none'
        d['annotations']['explanations']['items']['2']['partial_credit_forms'] = ['fills']
        errs = self.errors(d, self.name)
        # 穩定基礎允許 1 格原形（SPEC §3.5），但至少 1 格所有可接受答案都不在文中
        self.assertFalse(has(errs, '逐字出現在文中；basic'), errs)
        d['group']['questions'][0]['answer'] = 'turn'
        d['group']['questions'][0]['accepted_answers'] = ['turn']
        d['annotations']['explanations']['items']['1']['partial_credit_forms'] = ['turns']
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '逐字出現在文中', '至少 1 格要變字形'), errs)
        self.assertTrue(has(errs, 'MIX-FIL-03'), errs)

    def test_fill_base_form_must_be_in_text(self):
        d = load(MIXED)
        q1 = d['group']['questions'][0]
        q1['answer'], q1['accepted_answers'] = 'changes', ['changes']
        del d['annotations']['explanations']['items']['1']['source_token']
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '原形', '找不到'), errs)
        d['annotations']['explanations']['items']['1']['source_token'] = 'change'
        self.assertTrue(has(self.errors(d, self.name), 'source_token「change」不在文中'))

    def test_fill_single_word_and_accepted_answers(self):
        d = load(MIXED)
        d['group']['questions'][0]['accepted_answers'] = []
        self.assertTrue(has(self.errors(d, self.name), '至少要 1 個'))
        d = load(MIXED)
        d['group']['questions'][0]['accepted_answers'] = ['makes']
        self.assertTrue(has(self.errors(d, self.name), '要包含 answer 本身'))
        d = load(MIXED)
        d['group']['questions'][1]['answer'] = 'filling up'
        self.assertTrue(has(self.errors(d, self.name), '單一英文單詞'))
        d = load(MIXED)
        d['group']['questions'][0]['stem'] = d['group']['questions'][0]['stem'].replace('[[1]]', '____')
        self.assertTrue(has(self.errors(d, self.name), '[[1]]'))

    def test_short_answer_must_be_verbatim(self):
        d = load(MIXED)
        d['group']['questions'][3]['answer'] = 'weighs'
        d['group']['questions'][3]['accepted_answers'] = ['weighs']
        d['annotations']['explanations']['items']['4']['partial_credit_forms'] = ['weigh']
        self.assertTrue(has(self.errors(d, self.name), '簡答答案「weighs」必須逐字出現在文中'))
        d = load(MIXED)
        d['group']['questions'][3]['accepted_answers'] = None
        self.assertTrue(has(self.errors(d, self.name), 'q4', '至少要 1 個'))

    def test_multi_select_option_count_and_array_answer(self):
        d = load(MIXED)
        q3 = d['group']['questions'][2]
        q3['options']['G'] = 'They write about food on the school wall.'
        d['annotations']['explanations']['items']['3']['option_codes']['G'] = 'NM'
        self.assertTrue(has(self.errors(d, self.name), '6／8／10', '目前 7'))
        d = load(MIXED)
        d['group']['questions'][2]['answer'] = 'A'
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '多選題的 answer 必須是選項代號陣列') or has(errs, '多選題的 answer 必須是非空陣列'), errs)
        d = load(MIXED)
        d['group']['questions'][2]['answer'] = ['A']
        self.assertTrue(has(self.errors(d, self.name), '2–4 個正解'))

    def test_multi_select_codes(self):
        d = load(MIXED)
        d['annotations']['explanations']['items']['3']['option_codes']['A'] = 'NM'
        d['annotations']['explanations']['items']['3']['option_codes']['B'] = 'E1'
        errs = self.errors(d, self.name)
        self.assertTrue(has(errs, '多選正解 A 要標 E1／E2'))
        self.assertTrue(has(errs, '多選誤選 B'))
        d = load(MIXED)
        d['annotations']['explanations']['items']['3']['option_evidence']['C'] = ['They save money every week.']
        self.assertTrue(has(self.errors(d, self.name), 'option_evidence.C', '找不到'))

    def test_partial_credit_forms_must_not_overlap_accepted(self):
        d = load(MIXED)
        d['annotations']['explanations']['items']['1']['partial_credit_forms'] = ['makes']
        self.assertTrue(has(self.errors(d, self.name), '不可和 accepted_answers 重疊'))

    def test_numbers_checked_against_facts_as_warning(self):
        d = load(MIXED)
        d['group']['passage'] = d['group']['passage'].replace('60 percent', '70 percent')
        r = self.report(d, self.name)
        self.assertEqual(r.errors, [])                 # 沒有圖表的題組：查不到的數字只是 warning（fact_check 會再核對）
        self.assertTrue(has(r.warnings, '70', '事實單'))

    def test_existing_types_do_not_accept_new_explanation_fields(self):
        d = load(DATA / 'ai.wb.0a1b2c@1.json')
        d['annotations']['explanations']['items']['1']['option_codes'] = {'A': 'NM'}
        r, _ = vb.check_file(self.write(d, 'ai.wb.0a1b2c@1.json'))
        self.assertTrue(has(r.errors, '未知欄位 option_codes'))


class FactsTest(Case):
    def test_fixture_fact_sheets_are_valid(self):
        for p in sorted(FACTS.glob('*.json')):
            r, _ = vb.check_facts_file(p)
            self.assertEqual((p.name, r.errors, r.warnings), (p.name, [], []))

    def check(self, sheet, name=None):
        r, _ = vb.check_facts_file(self.write(sheet, f'{name or sheet["id"]}.json'))
        return r

    def test_required_fields_and_ids(self):
        s = load(FACTS / 'sdg12-0001.json')
        s['facts'][0]['source_ids'] = []
        s['facts'][1]['source_ids'] = ['s9']
        s['facts'][2]['id'] = 'f1'
        del s['sources'][0]['accessed']
        r = self.check(s)
        self.assertTrue(has(r.errors, 'source_ids 必須是非空'))
        self.assertTrue(has(r.errors, 's9 不在 sources'))
        self.assertTrue(has(r.errors, 'id f1 重複'))
        self.assertTrue(has(r.errors, '缺少欄位 accessed'))
        self.assertTrue(has(self.check(load(FACTS / 'sdg12-0001.json'), 'other-name').errors, '檔名'))

    def test_whitelist_rules(self):
        s = load(FACTS / 'sdg3-0001.json')
        s['sources'][1]['url'] = 'https://www.theguardian.com/world/2024/x'                 # Guardian：任何用途都不行
        s['sources'][2].update(url='https://sdgs.un.org/goals', use='adaptable_text', license='CC-BY-4.0')  # UN 文章不改寫
        r = self.check(s)
        self.assertTrue(has(r.errors, 'sources[1]', '禁止清單', 'guardian'))
        self.assertTrue(has(r.errors, 'sources[2]', '禁止清單', 'un-website-articles'))
        s = load(FACTS / 'sdg3-0001.json')
        s['sources'][1]['url'] = 'https://www.example.org/report'
        s['sources'][0]['license'] = 'CC-BY-NC-4.0'
        r = self.check(s)
        self.assertTrue(has(r.errors, 'sources[1]', '不在來源白名單'))
        self.assertTrue(has(r.errors, 'sources[0]', '授權必須是 CC-BY-4.0'))
        s = load(FACTS / 'sdg3-0001.json')
        s['sources'][1]['use'] = 'dataset'
        s['sources'][1]['license'] = 'CC-BY-4.0'
        self.assertTrue(has(self.check(s).errors, '禁止清單'))                          # un.org 不當 dataset

    def test_whitelist_matching(self):
        def errs(url, use, lic='CC-BY-4.0'):
            return vb.source_problems(url, use, lic)[0]
        self.assertEqual(errs('https://data.worldbank.org/indicator/SH.DYN.MORT', 'dataset'), [])
        self.assertEqual(errs('https://kids.frontiersin.org/articles/10.3389/frym.2020.1', 'adaptable_text'), [])
        self.assertTrue(errs('https://www.frontiersin.org/articles/10.3389/x', 'adaptable_text'))   # 一般 Frontiers 只取事實
        self.assertEqual(errs('https://www.moenv.gov.tw/en/news', 'fact_only', 'unknown'), [])
        self.assertEqual(errs('https://data.gov.tw/dataset/123', 'dataset', 'OGDL-Taiwan-1.0'), [])
        self.assertTrue(errs('https://dictionary.cambridge.org/dictionary/english/x', 'fact_only'))
        self.assertTrue(errs('https://www.unesco.org/en/articles/x', 'fact_only'))
        self.assertEqual(errs('https://theconversation.com/x', 'fact_only', 'all-rights-reserved'), [])
        self.assertTrue(errs('https://theconversation.com/x', 'adaptable_text'))
        self.assertTrue(errs('ftp://ourworldindata.org/x', 'dataset'))
        self.assertTrue(vb.source_problems('https://globalvoices.org/2024/x', 'adaptable_text', 'CC-BY-3.0')[1])  # 合作稿提醒

    def test_quoted_text_is_warned(self):
        s = load(FACTS / 'sdg12-0001.json')
        s['facts'][0]['text'] = '“Food waste is a global tragedy,” the report says.'
        self.assertTrue(has(self.check(s).warnings, '引號'))

    def test_dataset_needs_dataset_source(self):
        s = load(FACTS / 'sdg3-0001.json')
        s['datasets'][0]['source_id'] = 's2'
        self.assertTrue(has(self.check(s).errors, 'use 必須是 dataset'))

    def test_cli_facts_json(self):
        code, out = run_quiet(vb.main, ['--json', '--facts', str(FACTS / 'sdg3-0001.json'), str(FACTS / 'sdg12-0001.json')])
        self.assertEqual(code, 0, out)
        rep = json.loads(out)
        self.assertEqual([f['ok'] for f in rep['facts']], [True, True])
        self.assertEqual(rep['files'], [])


class StudentViewTest(Case):
    def test_chart_text_and_table(self):
        v = sv.view_of(load(READING))
        f = v['group']['figures'][0]
        self.assertIn('2020, Sub-Saharan Africa: 75.9 per 1,000 live births', f['chart_text'])
        self.assertEqual(f['data_table'][0][0], 'Year')
        self.assertEqual(f['data_table'][4], ['2020', '39.2', '32.4', '75.9'])
        self.assertTrue(any(line.startswith('資料來源：World Bank') for line in f['chart_text']))
        text = json.dumps(v, ensure_ascii=False)
        for hidden in ('"answer"', 'annotations', 'explanation', '"tags"', 'provenance', '"tier"', 'fact:'):
            self.assertNotIn(hidden, text)

    def test_mixed_view_hides_accepted_answers(self):
        v = sv.view_of(load(MIXED))
        text = json.dumps(v, ensure_ascii=False)
        for hidden in ('accepted_answers', 'turns', 'filling', 'source_token', 'partial_credit'):
            self.assertNotIn(hidden, text)
        modes = {q['no']: q.get('answer_format') for q in v['group']['questions']}
        self.assertIn('陣列', modes[3])
        self.assertIn('字串', modes[1])

    def test_existing_types_unchanged(self):
        v = sv.view_of(load(DATA / 'ai.wb.0a1b2c@1.json'))
        self.assertTrue(all('answer_format' not in q for q in v['group']['questions']))
        self.assertEqual(v['group']['figures'], [])


class ChainTest(Case):
    def chain(self, fixture, pre, blind_a=None, blind_b=None, audit=None):
        p = self.write(load(fixture), fixture.name)
        args = [str(p), '--blind-a', str(blind_a or DATA / f'{pre}-blind-a.json'),
                '--blind-b', str(blind_b or DATA / f'{pre}-blind-b.json'), '--audit', str(audit or DATA / f'{pre}-audit.json')]
        code, out = run_quiet(rv.main, args)
        return code, out, load(p), p

    def test_reading_full_chain_verified(self):
        code, out, d, p = self.chain(READING, 'rd')
        self.assertEqual(code, 0, out)
        self.assertEqual(d['status'], 'verified')
        self.assertEqual(sorted(e['kind'] for e in d['verification']),
                         ['blind_solver', 'blind_solver', 'distractor_audit', 'program'])
        self.assertIsNotNone(d['metrics'])
        r, _ = vb.check_file(p)
        self.assertEqual(r.errors, [])

    def test_mixed_full_chain_verified(self):
        code, out, d, p = self.chain(MIXED, 'mx')
        self.assertEqual(code, 0, out)
        self.assertEqual(d['status'], 'verified')
        r, _ = vb.check_file(p)
        self.assertEqual(r.errors, [])

    def test_reading_wrong_answer_rejected(self):
        b = load(DATA / 'rd-blind-b.json')
        b['answers']['3']['answer'] = 'C'
        code, _, d, _ = self.chain(READING, 'rd', blind_b=self.write(b, 'b.json'))
        self.assertEqual(code, 1)
        self.assertIn('blind_solver:B', d['status_reason'])

    def test_mixed_blind_answer_outside_accepted_rejected(self):
        b = load(DATA / 'mx-blind-b.json')
        b['answers']['1']['also_plausible'] = ['changes']           # 清單不完整
        b['answers']['4']['answer'] = 'measure'
        code, _, d, _ = self.chain(MIXED, 'mx', blind_b=self.write(b, 'b.json'))
        self.assertEqual(code, 1)
        self.assertIn('不在 accepted_answers', d['status_reason'])
        self.assertIn('不在可接受答案', d['status_reason'])

    def test_mixed_normalization_accepts_case_and_period(self):
        b = load(DATA / 'mx-blind-b.json')
        b['answers']['4']['answer'] = 'Weigh.'
        code, out, d, _ = self.chain(MIXED, 'mx', blind_b=self.write(b, 'b.json'))
        self.assertEqual(code, 0, out)

    def test_multi_select_every_option_must_agree(self):
        a = load(DATA / 'mx-blind-a.json')
        a['answers']['3']['answer'] = ['A', 'C', 'D']                # 多判一個
        b = load(DATA / 'mx-blind-b.json')
        b['answers']['3']['also_plausible'] = ['C']                   # 「可能也對」
        code, _, d, _ = self.chain(MIXED, 'mx', blind_a=self.write(a, 'a.json'), blind_b=self.write(b, 'b.json'))
        self.assertEqual(code, 1)
        self.assertIn('選項 C：盲解者判為正確', d['status_reason'])
        self.assertIn('可能也對', d['status_reason'])
        a = load(DATA / 'mx-blind-a.json')
        a['answers']['3']['answer'] = 'AD'
        code, _, d, _ = self.chain(MIXED, 'mx', blind_a=self.write(a, 'a.json'))
        self.assertEqual(code, 1)
        self.assertIn('選項代號陣列', d['status_reason'])

    def test_multi_select_audit_must_cover_every_wrong_option(self):
        au = load(DATA / 'mx-audit.json')
        del au['items']['3']['F']
        au['items']['3']['A'] = au['items']['3']['B']                 # A 是正解
        code, _, d, _ = self.chain(MIXED, 'mx', audit=self.write(au, 'audit.json'))
        self.assertEqual(code, 1)
        self.assertIn('沒有判定選項 F', d['status_reason'])
        self.assertIn('選項 A 是正解', d['status_reason'])

    def test_top_tier_e2_keys_need_shared_evidence(self):
        bank = load(MIXED)
        bank['annotations']['explanations']['items']['3']['option_codes']['A'] = 'E2'
        blinds = []
        for role, f in (('A', 'mx-blind-a.json'), ('B', 'mx-blind-b.json')):
            b = load(DATA / f)
            blinds.append(rv.blind_entry(b, bank, role))
        blinds[1]['details']['answers']['3']['option_evidence'] = {
            'A': ['Every Friday, two students weigh the food that is left in the trash can and write the result on the wall.']}
        rv.cross_check_multi(bank, copy.deepcopy(blinds))             # 不是超越頂標：不檢查
        bank['tier'] = 'top'
        rv.cross_check_multi(bank, blinds)
        self.assertEqual([b['result'] for b in blinds], ['fail', 'fail'])
        self.assertTrue(has(blinds[0]['details']['problems'], 'E2', '沒有交集'))


class LotTest(Case):
    def test_new_lots_parameters(self):
        for tier in ('basic', 'advanced', 'top'):
            rd = load(vb.LOTS_DIR / f'reading-{tier}-01.json')
            self.assertEqual((rd['count'], rd['questions_per_group']), (8, 4))
            self.assertEqual({k: rd['form_quota'][k] for k in ('continuous', 'chart', 'table', 'multi_text')},
                             {'continuous': 4, 'chart': 2, 'table': 1, 'multi_text': 1})
            self.assertEqual(rd['sdg_quota']['focus_sdgs'], [3, 12, 14, 15])
            self.assertEqual(rd['sdg_quota']['min_groups_with_focus_sdg'], 1)
            self.assertEqual(sum(rd['topic_quota'][k] for k, _ in ml.TOPIC_CATEGORIES), 8)
            self.assertIn('passage_overrides', rd['passage_band']['basis'])
            mx = load(vb.LOTS_DIR / f'mixed-{tier}-01.json')
            self.assertEqual((mx['count'], mx['questions_per_group']), (4, 4))
            self.assertEqual([s['mode'] for s in mx['format']['sub_items']], vb.MIXED_MODE_ORDER)
            self.assertTrue(set(mx['format']['sub_items'][2]['options_allowed']) <= {6, 8, 10})
        self.assertEqual(load(vb.LOTS_DIR / 'reading-basic-01.json')['passage_band']['word_count'], {'min': 280, 'max': 345})
        self.assertEqual(load(vb.LOTS_DIR / 'mixed-top-01.json')['passage_band']['beyond_l4_ratio'], {'min': None, 'max': 0.06})
        self.assertIn('innovation', load(vb.LOTS_DIR / 'mixed-basic-01.json')['avoid']['answer_words'])

    # 第一批產生之後，出題規格書（data/exams/generation-spec/）又有審查修正（origin/main #6 的定稿）；批次規格開始生成後
    # 不再修改（README §2），所以下列欄位和用現在的規格書重算的結果不同是預期的（直接取自規格書的內容，不是 make_lots 的邏輯）。
    SPEC_REVISED_SINCE_SEQ01 = {
        ('vocabulary', 'top'): ('targets.clue_rules', 'targets.distractor_rules', 'targets.routes'),
        ('cloze', 'basic'): ('passage_band.overrides_note',),
        ('word_bank', 'basic'): ('passage_band.overrides_note', 'targets.bank', 'targets.blank_tier_mix', 'targets.blank_type_mix',
                                 'targets.distractor_rules', 'targets.recipe', 'targets.recipe_example_mix', 'targets.sense_mix'),
        ('word_bank', 'advanced'): ('targets.blank_type_mix', 'targets.distractor_rules'),
        ('word_bank', 'top'): ('targets.blank_type_mix', 'targets.distractor_rules'),
    }

    def test_first_batch_lots_are_unchanged_by_make_lots(self):
        """make_lots.build 對前四種題型的輸出和已存在的 12 個批次規格一致（除了 created_on 與第一批之後規格書改過的欄位）。"""
        def drop(d, dotted):
            *parents, last = dotted.split('.')
            for p in parents:
                d = d.get(p) if isinstance(d, dict) else None
            if isinstance(d, dict):
                d.pop(last, None)

        for section in ml.SECTIONS:
            for tier in ml.TIERS:
                stored = load(vb.LOTS_DIR / f'{section}-{tier}-01.json')
                built = ml.build(section, tier, '01')
                built['created_on'] = stored['created_on']
                for path in self.SPEC_REVISED_SINCE_SEQ01.get((section, tier), ()):
                    drop(built, path)
                    drop(stored, path)
                self.assertEqual(built, stored, f'{section}-{tier}')

    def test_reading_lot_forms_and_sdgs(self):
        lot = vb.LOTS_DIR / 'reading-basic-01.json'
        d = load(READING)
        r = vb.check_lot(lot, [(READING, d)])
        self.assertEqual(r.errors, [])
        self.assertEqual(r.metrics['forms'], {'chart': 1})
        self.assertTrue(has(r.warnings, '文本形式 continuous 有 0 組'))
        d2 = copy.deepcopy(d)
        d2['group']['tags']['sdgs'] = [7]
        r = vb.check_lot(lot, [(READING, d2)])
        self.assertTrue(has(r.warnings, 'SDG 3／12／14／15 的篇數 0'))

    def test_mixed_lot_letters_and_avoid(self):
        lot = vb.LOTS_DIR / 'mixed-basic-01.json'
        d = load(MIXED)
        r = vb.check_lot(lot, [(MIXED, d)])
        self.assertEqual(r.errors, [])
        self.assertEqual(r.metrics['letters'], {'A': 1, 'D': 1})
        self.assertEqual(r.metrics['forms'], {'two_texts': 1})
        d['group']['questions'][3]['answer'] = 'innovation'
        r = vb.check_lot(lot, [(MIXED, d)])
        self.assertTrue(has(r.warnings, '近期正解字', 'innovation'))


if __name__ == '__main__':
    unittest.main()
