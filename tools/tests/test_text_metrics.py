"""tools/text_metrics.py 的基本測試：斷詞、專有名詞與數字不進分母、-ly 衍生副詞、帶的判定。

執行：python3 -m unittest discover tools/tests
"""
import json
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import text_metrics as tm  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / 'data' / 'ai.wb.0a1b2c@1.json'


class ComputeTest(unittest.TestCase):
    def test_markup_and_blanks_are_removed(self):
        m = tm.compute('<b>The</b> boy [[1]] a book. He <u>likes</u> it.')
        self.assertEqual(m['word_count'], 7)
        self.assertEqual(m['sentences'], 2)
        self.assertEqual(m['avg_sentence_length'], 3.5)

    def test_proper_nouns_and_numbers_not_in_denominator(self):
        m = tm.compute('Last year we visited Kenya with four friends. In 1990 the town was small.')
        self.assertIn('Kenya', m['proper_nouns'])
        self.assertEqual(m['numbers'], 2)          # four、1990
        self.assertEqual(m['denominator'], m['word_count'] - 1 - 1)  # 字數不含 1990；分母再扣 Kenya、four
        self.assertEqual(m['coverage_l1_6'], 1.0)

    def test_sentence_initial_capital_off_list_word_counts_as_off_list(self):
        m = tm.compute('Zorbles are rare. They live in caves.')
        self.assertEqual(m['proper_nouns'], [])
        self.assertIn('zorbles', m['offlist_words'])
        self.assertGreater(m['offlist_ratio'], 0)

    def test_regular_ly_adverb_uses_adjective_level(self):
        self.assertIsNotNone(tm.token_level('gradual'))
        self.assertEqual(tm.token_level('gradually'), tm.token_level('gradual'))
        self.assertEqual(tm.token_level("children's"), tm.token_level('children'))

    def test_coverage_ratios_add_up(self):
        m = tm.compute('The scientist examined the peculiar specimen with a microscope and a whalebone.')
        self.assertAlmostEqual(m['coverage_l1_6'] + m['offlist_ratio'], 1.0, places=3)
        self.assertLessEqual(m['coverage_l1_4'], m['coverage_l1_6'])


class BandTest(unittest.TestCase):
    def test_spec_band_matches_tiers_json(self):
        spec = json.loads(tm.TIERS_JSON.read_text(encoding='utf-8'))
        band = tm.spec_band('word_bank', 'advanced')
        self.assertEqual(band['word_count'], spec['passage_words']['word_bank']['advanced'])
        self.assertEqual(band['coverage_l1_4'], spec['passage_bands']['advanced']['coverage_l1_4'])
        self.assertIsNone(tm.spec_band('vocabulary', 'basic'))

    def test_check_band_flags_out_of_range(self):
        m = {'word_count': 100, 'coverage_l1_4': 0.95}
        b = tm.check_band(m, {'word_count': {'min': 270, 'max': 310}, 'coverage_l1_4': {'min': 0.89, 'max': 0.93}},
                          'advanced', 'test')
        self.assertFalse(b['ok'])
        self.assertFalse(b['checks']['word_count']['ok'])
        self.assertFalse(b['checks']['coverage_l1_4']['ok'])

    def test_fixture_uses_lot_band_and_is_in_band(self):
        bank = json.loads(FIXTURE.read_text(encoding='utf-8'))
        m = tm.metrics_for_bank(bank)
        self.assertIn('word_bank-advanced-01', m['band']['basis'])
        self.assertTrue(m['band']['ok'], m['band'])
        self.assertIn('beyond_l4_ratio', m['band']['checks'])

    def test_calibration_gsat_115_close_to_spec(self):
        # SPEC §3.4：115 學測全卷 L1–6 95.2%（04 §5.4）；本工具的算法應在 ±2 個百分點內
        d = json.loads((tm.ROOT / 'data' / 'exams' / 'parsed' / 'gsat-115.json').read_text(encoding='utf-8'))
        num = den = 0
        for s in d['sections']:
            for g in s['groups']:
                if g.get('passage') or g.get('passage_parts'):
                    m = tm.compute(tm.bank_text({'group': g}))
                    num += m['coverage_l1_6'] * m['denominator']
                    den += m['denominator']
        self.assertAlmostEqual(num / den, 0.952, delta=0.02)


if __name__ == '__main__':
    unittest.main()
