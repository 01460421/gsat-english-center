"""tools/difficulty_bands.py 的 rule.imputation.p_only（docs/design/weak-paper.md §8.5、§10.1）。

只有全體答對率 P 時的係數與門檻：門檻由係數算出；用門檻分級和用迴歸推估 Pc、Pb 再套 G50 的結果完全一樣；
逐年留一的正確率等於同一支工具算的基準 baseline_P_only；data/exams/difficulty-bands.json 是最新的。
執行：python3 -m unittest discover tools/tests
"""
import json
import sys
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))

import difficulty_bands as db  # noqa: E402


class POnly(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text, cls.out = db.build()
        cls.p_only = cls.out['rule']['imputation']['p_only']

    def test_file_is_up_to_date(self):
        self.assertEqual(db.OUT.read_text(encoding='utf-8'), self.text, '請重跑 python3 tools/difficulty_bands.py')

    def test_thresholds_follow_from_coefficients(self):
        coef = self.p_only['coefficients']
        th = self.p_only['thresholds']
        self.assertEqual(th['basic_min_P'], db.r4((0.5 - coef['Pc']['const']) / coef['Pc']['P']))
        self.assertEqual(th['advanced_min_P'], db.r4((0.5 - coef['Pb']['const']) / coef['Pb']['P']))
        self.assertLess(th['advanced_min_P'], th['basic_min_P'])
        # 設計文件引用的數字（約 .514／.393）。
        self.assertAlmostEqual(th['basic_min_P'], 0.514, delta=0.002)
        self.assertAlmostEqual(th['advanced_min_P'], 0.393, delta=0.002)

    def test_thresholds_equal_the_regression_rule(self):
        coef = self.p_only['coefficients']
        model = {g: [coef[g]['const'], coef[g]['P']] for g in ('Pc', 'Pb', 'Pa')}
        th = db.p_only_thresholds(model)
        for p in [i / 1000 for i in range(0, 1001)]:
            self.assertEqual(db.p_only_tier(th, p), db.imputed_tier(model, {'P': p}, p_only=True), p)

    def test_loyo_matches_baseline(self):
        val = self.out['rule']['imputation']['validation']
        self.assertEqual(self.p_only['leave_one_year_out_accuracy'], val['baseline_P_only_leave_one_year_out_accuracy'])
        self.assertGreater(self.p_only['in_sample_accuracy_gsat'], 0.9)

    def test_other_outputs_unchanged_shape(self):
        imp = self.out['rule']['imputation']
        self.assertEqual(imp['features'], ['const', 'P', 'Ph', 'Pl'])
        self.assertEqual(self.p_only['features'], ['const', 'P'])
        self.assertEqual(json.loads(json.dumps(self.p_only))['thresholds'], self.p_only['thresholds'])


if __name__ == '__main__':
    unittest.main()
