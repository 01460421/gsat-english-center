"""tools/validate_bank.py、tools/student_view.py、tools/record_verification.py 的基本測試。

範例題組 data/ai.wb.0a1b2c@1.json 是手寫的「文意選填‧進階練習」（只當測試資料，不在 data/bank/v1）；
blind-a.json、blind-b.json、audit.json 是假的盲解與稽核結果。每個測試都在暫存目錄裡複製一份再改，不動原檔。
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

import record_verification as rv  # noqa: E402
import student_view as sv  # noqa: E402
import validate_bank as vb  # noqa: E402

DATA = Path(__file__).resolve().parent / 'data'
FIXTURE = DATA / 'ai.wb.0a1b2c@1.json'


def load(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def run_quiet(fn, argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
        code = fn(argv)
    return code, out.getvalue()


class TempCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def write(self, data, name='ai.wb.0a1b2c@1.json'):
        p = self.tmp / name
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        return p

    def errors_of(self, data, name='ai.wb.0a1b2c@1.json'):
        r, _ = vb.check_file(self.write(data, name))
        return r.errors


class ValidateTest(TempCase):
    def test_fixture_has_no_errors(self):
        r, _ = vb.check_file(FIXTURE)
        self.assertEqual(r.errors, [])
        self.assertTrue(any('draft' in w for w in r.warnings))

    def test_each_option_used_once(self):
        d = load(FIXTURE)
        d['group']['questions'][1]['answer'] = 'E'   # 第 1、2 格都填 E
        self.assertTrue(any('各用一次' in e for e in self.errors_of(d)))

    def test_evidence_must_be_verbatim(self):
        d = load(FIXTURE)
        d['annotations']['explanations']['items']['2']['evidence'] = ['from the burning sun']
        self.assertTrue(any('evidence' in e and '找不到' in e for e in self.errors_of(d)))

    def test_forbidden_field_names(self):
        d = load(FIXTURE)
        d['annotations']['explanations']['items']['1']['reasoning_zh'] = '…'
        errs = self.errors_of(d)
        self.assertTrue(any('推理過程' in e for e in errs))

    def test_uid_filename_and_section_must_agree(self):
        d = load(FIXTURE)
        d['uid'] = 'ai.cz.0a1b2c'
        errs = self.errors_of(d)
        self.assertTrue(any('檔名' in e for e in errs))
        self.assertTrue(any('uid 縮寫' in e for e in errs))

    def test_blanks_must_match_questions(self):
        d = load(FIXTURE)
        d['group']['passage'] = d['group']['passage'].replace('[[10]]', 'shift')
        self.assertTrue(any('空格' in e for e in self.errors_of(d)))

    def test_duplicate_options(self):
        d = load(FIXTURE)
        d['group']['options_bank']['J'] = 'Practical'
        self.assertTrue(any('選項重複' in e for e in self.errors_of(d)))

    def test_metrics_out_of_band(self):
        d = load(FIXTURE)
        d['group']['passage'] = d['group']['passage'].split('\n')[0]   # 只剩第一段：字數太少
        d['group']['passage'] += ' ' + ' '.join(f'[[{n}]]' for n in range(4, 11))
        self.assertTrue(any('word_count' in e for e in self.errors_of(d)))

    def test_elimination_must_have_exactly_one_matching(self):
        d = load(FIXTURE)
        key = vb.answer_key(d)
        feasible = {no: [k] for no, k in key.items()}
        feasible['1'], feasible['8'] = ['A', 'E'], ['A', 'E']   # 1 與 8 可以互換
        d['annotations']['elimination'] = {'feasible': feasible, 'perfect_matchings': 2}
        errs = self.errors_of(d)
        self.assertTrue(any('2 種填法' in e for e in errs), errs)

    def test_verified_requires_verification_entries(self):
        d = load(FIXTURE)
        d['status'] = 'verified'
        errs = self.errors_of(d)
        self.assertTrue(any('blind_solver' in e for e in errs))
        self.assertTrue(any('elimination' in e for e in errs))

    def test_lot_counts_and_letter_share(self):
        d = load(FIXTURE)
        lot = load(vb.LOTS_DIR / 'word_bank-advanced-01.json')
        lot_path = self.write(lot, 'word_bank-advanced-01.json')
        r = vb.check_lot(lot_path, [(FIXTURE, d)])
        self.assertEqual(r.errors, [])
        self.assertTrue(any('尚未產生完畢' in w for w in r.warnings))
        d2 = copy.deepcopy(d)
        d2['group']['options_bank']['E'] = 'career'      # 近期正解字（gsat 111–115）
        r = vb.check_lot(lot_path, [(FIXTURE, d2)])
        self.assertTrue(any('近期正解字' in e for e in r.errors), r.errors)

    def test_all_without_files_exits_zero(self):
        old = vb.BANK_DIR
        vb.BANK_DIR = self.tmp / 'missing'
        try:
            code, out = run_quiet(vb.main, ['--all'])
        finally:
            vb.BANK_DIR = old
        self.assertEqual(code, 0)
        self.assertIn('略過', out)

    def test_json_report(self):
        code, out = run_quiet(vb.main, ['--json', str(FIXTURE)])
        self.assertEqual(code, 0)
        rep = json.loads(out)
        self.assertTrue(rep['ok'])
        self.assertEqual(rep['files'][0]['errors'], [])


class TypeRulesTest(unittest.TestCase):
    def report(self):
        return vb.Report('test')

    def test_assignment_count(self):
        total, found = vb.enumerate_assignments([{0}, {1}, {2}], 3)
        self.assertEqual((total, found), (1, [[0, 1, 2]]))
        total, _ = vb.enumerate_assignments([{0, 1}, {0, 1}], 2)
        self.assertEqual(total, 2)
        total, _ = vb.enumerate_assignments([{0, 1, 2, 3, 4}] * 4, 5)
        self.assertEqual(total, 120)

    def test_structure_extra_sentence_and_complete_sentences(self):
        d = {'section_type': 'structure', 'group': {'options_bank': {
            'A': 'This is the first full sentence.', 'B': 'Another complete sentence is here.',
            'C': 'and this one is not', 'D': 'The fourth sentence ends properly.', 'E': 'The extra sentence is unused.'},
            'questions': [{'no': n, 'answer': a} for n, a in zip(range(1, 5), 'ABCD')]}}
        r = self.report()
        vb.check_structure(r, d)
        self.assertTrue(any('完整句' in e and 'C' in e for e in r.errors))
        d['group']['questions'][3]['answer'] = 'A'
        r = self.report()
        vb.check_structure(r, d)
        self.assertTrue(any('重複' in e for e in r.errors))

    def test_vocabulary_pos_and_level(self):
        q = {'no': 1, 'stem': 'The mayor has such a ______ schedule that he can hardly take a break.',
             'options': {'A': 'hasty', 'B': 'tight', 'C': 'quickly', 'D': 'flexible'}, 'answer': 'B', 'tags': {}}
        d = {'section_type': 'vocabulary', 'tier': 'advanced', 'group': {'questions': [q]},
             'annotations': {'explanations': {'items': {'1': {'sense': 'core'}}}}}
        r = self.report()
        vb.check_vocabulary(r, d)
        self.assertTrue(any('詞性不一致' in e for e in r.errors), r.errors)
        q['options']['C'] = 'loose'
        q['tier'] = 'advanced'
        r = self.report()
        vb.check_vocabulary(r, d)
        self.assertFalse(any('詞性' in e for e in r.errors), r.errors)
        d['tier'] = 'top'   # tight 是 L3，超越頂標要 L4–6（或標延伸義）
        r = self.report()
        vb.check_vocabulary(r, d)
        self.assertTrue(any('L3' in e for e in r.errors), r.errors)

    def test_vocabulary_same_synset_distractor(self):
        q = {'no': 1, 'stem': 'They live in a ______ house near the river.',
             'options': {'A': 'big', 'B': 'large', 'C': 'quiet', 'D': 'modern'}, 'answer': 'A', 'tags': {}}
        d = {'section_type': 'vocabulary', 'tier': 'basic', 'group': {'questions': [q]},
             'annotations': {'explanations': {'items': {'1': {'sense': 'core'}}}}}
        r = self.report()
        vb.check_vocabulary(r, d)
        if vb.LEXICON.exists():
            self.assertTrue(any('synset' in e for e in r.errors), r.errors)
        else:
            self.assertTrue(any('WordNet' in w for w in r.warnings))


class PipelineTest(TempCase):
    def bank_copy(self):
        return self.write(load(FIXTURE))

    def test_student_view_hides_answers_and_notes(self):
        v = sv.view_of(load(FIXTURE))
        text = json.dumps(v, ensure_ascii=False)
        for hidden in ('"answer"', 'annotations', 'explanation', 'tags', 'generation', 'verification', '"tier"'):
            self.assertNotIn(hidden, text)
        self.assertEqual(len(v['group']['questions']), 10)
        self.assertEqual(list(v['group']['options_bank']), list('ABCDEFGHIJ'))

    def test_full_chain_verified(self):
        p = self.bank_copy()
        code, out = run_quiet(rv.main, [str(p), '--blind-a', str(DATA / 'blind-a.json'),
                                        '--blind-b', str(DATA / 'blind-b.json'), '--audit', str(DATA / 'audit.json')])
        self.assertEqual(code, 0, out)
        d = load(p)
        self.assertEqual(d['status'], 'verified')
        self.assertEqual(d['annotations']['elimination']['perfect_matchings'], 1)
        self.assertEqual(d['annotations']['elimination']['feasible']['5'], ['A', 'E', 'I'])
        self.assertEqual(sorted(e['kind'] for e in d['verification']),
                         ['blind_solver', 'blind_solver', 'distractor_audit', 'program', 'unique_solution'])
        self.assertIsNotNone(d['metrics'])
        r, _ = vb.check_file(p)
        self.assertEqual(r.errors, [])
        # 重跑不會重複累積紀錄
        run_quiet(rv.main, [str(p), '--blind-a', str(DATA / 'blind-a.json')])
        self.assertEqual(len(load(p)['verification']), 5)

    def test_ambiguous_feasible_sets_are_rejected(self):
        p = self.bank_copy()
        b = load(DATA / 'blind-b.json')
        b['answers']['1']['feasible'] = ['A', 'E']
        b['answers']['8']['feasible'] = ['A', 'E']
        bp = self.write(b, 'blind-b.json')
        code, _ = run_quiet(rv.main, [str(p), '--blind-a', str(DATA / 'blind-a.json'), '--blind-b', str(bp),
                                      '--audit', str(DATA / 'audit.json')])
        self.assertEqual(code, 1)
        d = load(p)
        self.assertEqual(d['status'], 'rejected')
        self.assertIn('unique_solution', d['status_reason'])

    def test_wrong_blind_answer_and_acceptable_distractor_are_rejected(self):
        p = self.bank_copy()
        b = load(DATA / 'blind-a.json')
        b['answers']['3']['answer'] = 'G'
        b['answers']['3']['also_plausible'] = ['B']
        bp = self.write(b, 'blind-a.json')
        au = load(DATA / 'audit.json')
        au['items']['8']['E']['verdict'] = 'arguably_acceptable'
        ap = self.write(au, 'audit.json')
        code, _ = run_quiet(rv.main, [str(p), '--blind-a', str(bp), '--blind-b', str(DATA / 'blind-b.json'),
                                      '--audit', str(ap)])
        self.assertEqual(code, 1)
        reason = load(p)['status_reason']
        self.assertIn('blind_solver:A', reason)
        self.assertIn('distractor_audit', reason)

    def test_missing_inputs_keep_draft(self):
        p = self.bank_copy()
        code, out = run_quiet(rv.main, [str(p), '--blind-a', str(DATA / 'blind-a.json'), '--dry-run'])
        self.assertEqual(code, 3, out)
        self.assertEqual(load(p)['verification'], [])   # --dry-run 不寫檔

    def test_input_uid_mismatch_is_input_error(self):
        p = self.bank_copy()
        b = load(DATA / 'blind-a.json')
        b['uid'] = 'ai.wb.ffffff'
        code, _ = run_quiet(rv.main, [str(p), '--blind-a', str(self.write(b, 'x.json'))])
        self.assertEqual(code, 2)


if __name__ == '__main__':
    unittest.main()
