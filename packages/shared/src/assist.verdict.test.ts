/**
 * 學習助手的對錯判定（assist.ts 的 assistVerdict；docs/design/learning-assistant.md §4.5.3、§6.1）：包一層網站的計分，
 * 學生在網站上看到的判定和學習助手一致。
 */
import { describe, expect, it } from 'vitest';
import { assistGroupVerdict, assistVerdict, type VerdictQuestion } from './assist';
import type { SingleChoiceScorable } from './exam-scoring';

const single = (answer = 'B', extra: Partial<SingleChoiceScorable> = {}): VerdictQuestion => ({
  answer,
  options: { A: 'a', B: 'b', C: 'c', D: 'd' },
  accepted_answers: null,
  points: 2,
  ...extra,
  mode: 'single_choice',
});

const multi = (answer: string[]): VerdictQuestion => ({
  mode: 'multi_select',
  answer,
  options: { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' },
  points: 4,
});

describe('選擇題（scoreQuestion）', () => {
  it('單選：對、錯、未作答', () => {
    expect(assistVerdict(single(), 'B')).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(single(), 'C')).toEqual({ verdict: 'wrong', basis: 'program' });
    expect(assistVerdict(single(), null)).toEqual({ verdict: 'unanswered', basis: 'program' });
    expect(assistVerdict(single(), undefined)).toEqual({ verdict: 'unanswered', basis: 'program' });
    expect(assistVerdict(single(), '')).toEqual({ verdict: 'unanswered', basis: 'program' });
  });

  it('選項庫（文意選填、篇章結構）同單選', () => {
    const q: VerdictQuestion = { mode: 'bank_choice', answer: 'H', points: 1 };
    expect(assistVerdict(q, 'H').verdict).toBe('correct');
    expect(assistVerdict(q, 'F').verdict).toBe('wrong');
  });

  it('accepted_answers 的單選（gsat-84 第 45 題）判 correct；沒標 scoring_exception 也一樣', () => {
    expect(assistVerdict(single('B', { accepted_answers: ['C'] }), 'C')).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(single('B', { accepted_answers: ['C'], scoring_exception: { type: 'multiple_correct' } }), 'C').verdict).toBe('correct');
    expect(assistVerdict(single('B', { accepted_answers: ['C'] }), 'D').verdict).toBe('wrong');
  });

  it('全對送分（all_credit）：不論作答都是 correct', () => {
    const q = single('B', { scoring_exception: { type: 'all_credit' } });
    for (const a of ['A', 'B', null]) expect(assistVerdict(q, a).verdict).toBe('correct');
  });

  it('多選（n＝5）：k＝0 correct、k＝1 partial（3/5 分）、k＝2 partial（1/5 分）、k＝3 wrong；沒選是 unanswered', () => {
    const q = multi(['A', 'C']);
    expect(assistVerdict(q, ['A', 'C']).verdict).toBe('correct');
    expect(assistVerdict(q, ['A']).verdict).toBe('partial'); // k = 1：(5 − 2) / 5
    expect(assistVerdict(q, ['A', 'B', 'C', 'D']).verdict).toBe('partial'); // k = 2：(5 − 4) / 5
    expect(assistVerdict(q, ['B', 'C', 'D']).verdict).toBe('wrong'); // k = 3：(5 − 6) / 5 → 0
    expect(assistVerdict(q, []).verdict).toBe('unanswered');
    expect(assistVerdict(q, ['A', 'C']).basis).toBe('program');
  });

  it('client_status 只對填充簡答採用：選擇題的判定不受影響', () => {
    expect(assistVerdict(single(), 'B', { clientStatus: 'wrong' })).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(single(), 'A', { clientStatus: 'partial' })).toEqual({ verdict: 'wrong', basis: 'program' });
  });
});

describe('填充、簡答', () => {
  const examFill: VerdictQuestion = { mode: 'fill_in_blank', answer: 'blended', accepted_answers: ['mixed'], points: 2 };
  const bankFill: VerdictQuestion = { mode: 'fill_in_blank', answer: 'turns', accepted_answers: ['makes'], points: 2 };
  const examShort: VerdictQuestion = { mode: 'short_answer', answer: 'come up with', accepted_answers: null, points: 2 };

  it('空白是 unanswered', () => {
    expect(assistVerdict(examFill, '   ')).toEqual({ verdict: 'unanswered', basis: 'program' });
    expect(assistVerdict(examFill, null)).toEqual({ verdict: 'unanswered', basis: 'program' });
  });

  it('等於任何一個可接受答案（正規化後）是 correct', () => {
    expect(assistVerdict(examFill, 'blended.')).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(examFill, ' mixed ')).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(examShort, 'Come up with')).toEqual({ verdict: 'correct', basis: 'program' });
  });

  it('歷屆填充題要連大小寫都一樣（只差大小寫算字形錯誤，交給裝置判分）；簡答不看大小寫', () => {
    expect(assistVerdict(examFill, 'Blended')).toEqual({ verdict: 'unknown', basis: 'none' });
    expect(assistVerdict(examFill, 'Blended', { clientStatus: 'partial' })).toEqual({ verdict: 'partial', basis: 'client' });
    expect(assistVerdict(examShort, 'COME UP WITH').verdict).toBe('correct');
  });

  it('題庫題：用題庫的比對規則（去掉引號與結尾標點、不看大小寫）', () => {
    const opts = { openKey: 'complete' as const };
    expect(assistVerdict(bankFill, '"Turns,"', opts)).toEqual({ verdict: 'correct', basis: 'program' });
    expect(assistVerdict(bankFill, 'Makes!', opts).verdict).toBe('correct');
  });

  it('題庫題：等於部分給分寫法是 partial；其他有裝置判分就用它，沒有是 wrong（可接受答案是完整清單）', () => {
    const opts = { openKey: 'complete' as const, partialForms: ['turn', 'turned'] };
    expect(assistVerdict(bankFill, 'turned', opts)).toEqual({ verdict: 'partial', basis: 'program' });
    expect(assistVerdict(bankFill, 'tunrs', { ...opts, clientStatus: 'partial' })).toEqual({ verdict: 'partial', basis: 'client' });
    expect(assistVerdict(bankFill, 'goes', opts)).toEqual({ verdict: 'wrong', basis: 'program' });
  });

  it('歷屆題：判不出來的，有裝置判分就用它（partial、wrong），沒有是 unknown（官方只公布部分可接受答案）', () => {
    expect(assistVerdict(examFill, 'blending', { clientStatus: 'partial' })).toEqual({ verdict: 'partial', basis: 'client' });
    expect(assistVerdict(examFill, 'combined', { clientStatus: 'wrong' })).toEqual({ verdict: 'wrong', basis: 'client' });
    expect(assistVerdict(examFill, 'combined')).toEqual({ verdict: 'unknown', basis: 'none' });
    // 部分給分寫法只對題庫題有意義。
    expect(assistVerdict(examFill, 'blend', { partialForms: ['blend'] })).toEqual({ verdict: 'unknown', basis: 'none' });
  });

  it('官方沒公布答案（answer 是 null）：只能看裝置判分', () => {
    const q: VerdictQuestion = { mode: 'short_answer', answer: null, accepted_answers: null };
    expect(assistVerdict(q, 'anything')).toEqual({ verdict: 'unknown', basis: 'none' });
    expect(assistVerdict(q, 'anything', { clientStatus: 'wrong' })).toEqual({ verdict: 'wrong', basis: 'client' });
  });
});

describe('不判對錯的題型與整組判定', () => {
  it('表格、中譯英、作文：unknown', () => {
    expect(assistVerdict({ mode: 'translation' }, 'text')).toEqual({ verdict: 'unknown', basis: 'none' });
    expect(assistVerdict({ mode: 'composition' }, 'text')).toEqual({ verdict: 'unknown', basis: 'none' });
    expect(assistVerdict({ mode: 'table_completion' }, ['a'])).toEqual({ verdict: 'unknown', basis: 'none' });
  });

  it('整組：有錯就是 wrong，其次 partial、unanswered，全對才是 correct；有判不出的題是 unknown；空的是 null', () => {
    expect(assistGroupVerdict(['correct', 'wrong', 'partial'])).toBe('wrong');
    expect(assistGroupVerdict(['correct', 'partial', 'unanswered'])).toBe('partial');
    expect(assistGroupVerdict(['correct', 'unanswered'])).toBe('unanswered');
    expect(assistGroupVerdict(['correct', 'correct'])).toBe('correct');
    expect(assistGroupVerdict(['correct', 'unknown'])).toBe('unknown');
    expect(assistGroupVerdict([])).toBeNull();
  });
});
