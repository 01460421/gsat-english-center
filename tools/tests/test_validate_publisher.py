"""tools/validate_publisher.py 的測試（docs/design/weak-paper.md §8.4、§8.5、§8.8）。

只用合成的出版社題組（tools/tests/data/publisher/pub-test/v1/**，站方為測試自己寫的題目）與測試用的來源登記
（tools/tests/data/publisher-sources.json）；D8 指紋與歷屆題庫換成測試自己造的假資料，不讀任何出版社或官方的內容。
每個測試都在暫存目錄裡複製一份再改，不動原檔。
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

import validate_bank as vb  # noqa: E402
import validate_publisher as vp  # noqa: E402

DATA = Path(__file__).resolve().parent / 'data'
PUB = DATA / 'publisher'
CZ = PUB / 'pub-test/v1/cloze/advanced/pb.cz.5a6b7c@1.json'
MX = PUB / 'pub-test/v1/mixed/advanced/pb.mx.7a8b9c@1.json'
SOURCES = vp.load_sources(DATA / 'publisher-sources.json')
TODAY = '2026-11-02'

FAKE_OFFICIAL_EN = 'the quiet harbor lights welcomed every tired fisherman home tonight'
FAKE_OFFICIAL_HAN = '評分時請特別注意句型的完整度與正確性'


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def fake_official():
    toks = vb.en_tokens(FAKE_OFFICIAL_EN)
    en = {' '.join(toks[i:i + vb.OFFICIAL_NGRAM]): 'fake-exam 中譯英1' for i in range(len(toks) - vb.OFFICIAL_NGRAM + 1)}
    han = {FAKE_OFFICIAL_HAN[i:i + vb.OFFICIAL_HAN_RUN]: 'fake-exam 中譯英1' for i in range(len(FAKE_OFFICIAL_HAN) - vb.OFFICIAL_HAN_RUN + 1)}
    return {'en': en, 'han': han, 'tr_stems': [], 'cp_stems': {}}


PAST_PASSAGE = ('Every winter the mountain village opens a small museum of old sleds, and visitors can ride the oldest one '
                'down the hill behind the school while the children sing songs about the first snow of the year.')
PAST_STEM = 'Which of the following best describes how the village celebrates the first snow of the year?'


def fake_past():
    group = {'id': 'g1', 'passage': PAST_PASSAGE, 'passage_parts': None,
             'questions': [{'label': '41', 'stem': PAST_STEM}]}
    own = set(vp.ngrams(vp.group_text(group)))
    toks = vb.en_tokens(PAST_STEM)
    return {'shingles': {k: {'gsat-999 g1'} for k in own}, 'sizes': {'gsat-999 g1': len(own)},
            'stems': {' '.join(toks): 'gsat-999 第 41 題'}}


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved = (vb._official, vp._past)
        vb._official = fake_official()
        vp._past = fake_past()

    def tearDown(self):
        vb._official, vp._past = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def copy_fixture(self, src, mutate=None, rel=None):
        d = load(src)
        if mutate:
            mutate(d)
        dest = self.tmp / (rel or src.relative_to(PUB))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')
        return dest

    def check(self, src, mutate=None, rel=None):
        return vp.check_file(self.copy_fixture(src, mutate, rel), SOURCES, TODAY)

    def assert_error(self, report, needle):
        self.assertTrue(any(needle in e for e in report.errors), f'沒有「{needle}」：{report.errors}')


class Contract(Case):
    def test_fixtures_pass(self):
        for f in (CZ, MX):
            r = self.check(f)
            self.assertEqual(r.errors, [], f)
        # 綜合測驗是 3 格（標準是 5 格）：只進題庫練習。
        self.assertTrue(any('標準形狀' in w for w in self.check(CZ).warnings))
        self.assertFalse(any('標準形狀' in w for w in self.check(MX).warnings))

    def test_open_key_only_complete(self):
        r = self.check(MX, lambda d: d.update(open_key='listed'))
        self.assert_error(r, 'open_key 必須是 complete')
        r = self.check(MX, lambda d: d.pop('open_key'))
        self.assert_error(r, 'open_key 必須是 complete')
        r = self.check(CZ, lambda d: d.update(open_key='complete'))
        self.assert_error(r, '只有混合題可以有 open_key')

    def test_source_and_location(self):
        self.assert_error(self.check(CZ, lambda d: d.update(source_id='pub-other')), '和目錄 pub-test 不一致')
        r = self.check(CZ, lambda d: d.update(source_id='pub-none'), rel='pub-none/v1/cloze/advanced/pb.cz.5a6b7c@1.json')
        self.assert_error(r, '不在來源登記檔裡')
        self.assert_error(self.check(CZ, lambda d: d.update(source_id='ai-bank'), rel='ai-bank/v1/cloze/advanced/pb.cz.5a6b7c@1.json'), '不在來源登記檔裡')
        self.assert_error(self.check(CZ, rel='pub-test/v1/cloze/basic/pb.cz.5a6b7c@1.json'), '應該放在 v1/cloze/advanced/')
        self.assert_error(self.check(CZ, lambda d: d.update(version=2)), '和檔名不一致')
        self.assert_error(self.check(CZ, rel='pub-test/v1/cloze/advanced/pb.cz.5a6b7c.json'), '檔名必須是')

    def test_inactive_source_is_a_warning(self):
        sources = copy.deepcopy(SOURCES)
        sources['pub-test']['licence']['until'] = '2020-01-01'
        r = vp.check_file(self.copy_fixture(CZ), sources, TODAY)
        self.assertEqual(r.errors, [])
        self.assertTrue(any('停用或過了到期日' in w for w in r.warnings))

    def test_provenance_review_status(self):
        self.assert_error(self.check(CZ, lambda d: d['provenance'].update(derivation='adapted')), 'publisher-licensed／verbatim')
        self.assert_error(self.check(CZ, lambda d: d['review'].update(checks=['answers', 'tier'])), 'checks（至少 answers、d8）')
        self.assert_error(self.check(CZ, lambda d: d['review'].update(date='2026/11/01')), 'YYYY-MM-DD')
        self.assert_error(self.check(CZ, lambda d: d.update(status='published')), 'status')
        r = self.check(CZ, lambda d: d['provenance'].update(attribution_text='本題改編自大考中心試題'))
        self.assert_error(r, '出處句不能含 大考中心')

    def test_bases_and_extras(self):
        self.assert_error(self.check(CZ, lambda d: d.update(tier_basis='guess')), 'tier_basis')
        self.assert_error(self.check(CZ, lambda d: d.update(tag_basis='ai')), 'tag_basis')
        self.assert_error(self.check(CZ, lambda d: d.update(explanation_basis='publisher')), '沒有 annotations.explanations')
        self.assert_error(self.check(MX, lambda d: d.update(explanation_basis=None)), '不能有 annotations.explanations')
        self.assert_error(self.check(CZ, lambda d: d.update(skill_extra={'9': {'sense': 'core'}})), '不存在的題號')
        self.assert_error(self.check(CZ, lambda d: d.update(skill_extra={'1': {'topic': 'x'}})), '必須是 {題號: {clue_type')
        self.assert_error(self.check(MX, lambda d: d['scoring_extra']['1'].update(partial_credit_forms='borrows')), '必須是 {題號: {partial_credit_forms')
        self.assert_error(self.check(CZ, lambda d: d.update(source_ref={'labels': []})), 'source_ref')


class Shape(Case):
    def test_answers_and_blanks(self):
        self.assert_error(self.check(CZ, lambda d: d['group']['questions'][0].update(answer='E')), '不在選項')
        self.assert_error(self.check(CZ, lambda d: d['group'].update(passage=d['group']['passage'].replace('[[2]]', '___'))), '空格')
        self.assert_error(self.check(CZ, lambda d: d['group']['questions'][1].update(label='B')), 'label 應等於題號')

        def bad_accepted(d):
            d['group']['questions'][0]['accepted_answers'] = ['borrows']
        self.assert_error(self.check(MX, bad_accepted), 'accepted_answers')
        self.assert_error(self.check(MX, lambda d: d['group']['questions'][0].update(scoring_notes='評分說明')), 'scoring_notes 不收')


class D8AndPast(Case):
    def test_d8_rejects_official_translation_and_scoring_notes(self):
        def put_en(d):
            d['group']['passage'] += ' ' + FAKE_OFFICIAL_EN.capitalize() + '.'
        self.assert_error(self.check(MX, put_en), 'D8：和官方參考譯文相同的片段')

        def put_han(d):
            d['annotations']['explanations']['items']['1']['explanation_zh'] = FAKE_OFFICIAL_HAN
        self.assert_error(self.check(MX, put_han), 'D8：和官方評分原則相同的片段')

    def test_past_exam_copy(self):
        def copy_passage(d):
            d['group']['passage'] = PAST_PASSAGE
        self.assert_error(self.check(MX, copy_passage), 'official_copy：和歷屆試題 gsat-999 g1')

        def copy_stem(d):
            d['group']['questions'][2]['stem'] = PAST_STEM
        self.assert_error(self.check(MX, copy_stem), 'official_copy：題幹和 gsat-999 第 41 題 完全相同')

        def short_generic(d):
            d['group']['questions'][2]['stem'] = 'What is the passage mainly about?'
        self.assertEqual(self.check(MX, short_generic).errors, [])

    def test_forbidden_terms_in_content_are_listed(self):
        r = self.check(MX, lambda d: d['group'].update(passage=d['group']['passage'] + ' (CEEC style)'))
        self.assertEqual(r.errors, [])
        self.assertTrue(any('CEEC' in w and '人工檢查表' in w for w in r.warnings))


class G50(Case):
    RULE = {'theta': 0.5,
            'full': {'Pc': {'const': -0.1, 'P': 3.16, 'Ph': -1.08, 'Pl': -1.09}, 'Pb': {'const': 0.0, 'P': 1.0, 'Ph': 0.5, 'Pl': -0.5}},
            'p_only': {'coefficients': {'Pc': {'const': -0.2414, 'P': 1.4417}, 'Pb': {'const': -0.0345, 'P': 1.3604}},
                       'thresholds': {'basic_min_P': 0.5143, 'advanced_min_P': 0.3929}}}

    def test_reads_p_only_from_bands(self):
        rule = vp.g50_rule()
        p_only = rule['p_only']
        for key, g in (('basic_min_P', 'Pc'), ('advanced_min_P', 'Pb')):
            c = p_only['coefficients'][g]
            self.assertAlmostEqual(p_only['thresholds'][key], (0.5 - c['const']) / c['P'], places=4)

    def test_group_tier_from_overall_rate_only(self):
        tier = lambda p: vp.group_g50([{'stats': {'correct_rate': p}}], self.RULE)['tier']  # noqa: E731
        self.assertEqual([tier(0.52), tier(0.45), tier(0.38)], ['basic', 'advanced', 'top'])
        self.assertIsNone(vp.group_g50([{'stats': None}], self.RULE))
        five = vp.group_g50([{'stats': {'five_groups': [0.9, 0.7, 0.45, 0.3, 0.2]}}], self.RULE)
        self.assertEqual((five['tier'], five['basis']), ('advanced', ['five_group']))

    def test_mismatch_is_a_warning(self):
        def stats(d):
            for q in d['group']['questions']:
                q['stats'] = {'correct_rate': 0.3}
        r = self.check(CZ, stats)
        self.assertEqual(r.errors, [])
        self.assertEqual(r.g50['tier'], 'top')
        self.assertTrue(any('G50 推估是 top' in w for w in r.warnings))


class Cli(Case):
    def test_exit_codes(self):
        good = self.copy_fixture(CZ)
        bad = self.copy_fixture(MX, lambda d: d.update(open_key=None), rel='pub-test/v1/mixed/advanced/pb.mx.7a8b9c@1.json')
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(vp.main(['--sources', str(DATA / 'publisher-sources.json'), str(good)]), 0)
            self.assertEqual(vp.main(['--sources', str(DATA / 'publisher-sources.json'), '--json', str(good), str(bad)]), 1)
        self.assertIn('"ok": false', out.getvalue())

    def test_duplicate_uid_across_sources(self):
        a = self.copy_fixture(CZ)
        b = self.copy_fixture(CZ, rel='pub-other/v1/cloze/advanced/pb.cz.5a6b7c@1.json')
        reports = [vp.check_file(f, SOURCES, TODAY) for f in (a, b)]
        vp.check_duplicate_uids([a, b], reports)
        self.assertEqual([e for e in reports[0].errors if 'uid' in e and '不能重複' in e], [])
        self.assert_error(reports[1], '也出現在來源 pub-test')
        # 同一個來源的不同版本不算重複。
        c = self.copy_fixture(CZ, lambda d: d.update(version=2), rel='pub-test/v1/cloze/advanced/pb.cz.5a6b7c@2.json')
        more = [vp.check_file(f, SOURCES, TODAY) for f in (a, c)]
        vp.check_duplicate_uids([a, c], more)
        self.assertFalse(any('不能重複' in e for r in more for e in r.errors))


if __name__ == '__main__':
    unittest.main()
