/**
 * 題庫練習的計分（scoring.ts）：用混合題、閱讀的範例題組（build-data 的輸出）測
 *   - 多選部分給分 (n − 2k)/n 與實際算式；
 *   - 填充：完整的可接受答案清單、部分給分寫法、拼字錯誤、可互換的兩格；
 *   - 簡答；
 *   - 整組的得分、答對題數。
 */
import { describe, expect, it } from 'vitest';
import type { PracticeGroupFile } from '../../data/bank';
import { multiSelectFormula } from './components/MixedCards';
import { freezeGrades, groupWords, needsWordIndex, openAnswerKey, scorePractice, wordLookup } from './scoring';
import { MINI_VOCAB_INDEX, group } from './testFixtures';

const mx = group('ai.mx.0f1a2b@1');
const rd = group('ai.rd.0c1d2e@1');

describe('混合題', () => {
  it('全對：4 題 10 分', () => {
    const s = scorePractice(mx, { '1': 'turns', '2': 'filling', '3': ['A', 'D'], '4': 'weigh' });
    expect(s).toMatchObject({ earned: 10, max: 10, correct: 4, total: 4, swapped: [] });
  });

  it('多選部分給分：6 個選項錯 1 個得 4 × 4/6、錯 2 個得 4 × 2/6、錯 3 個以上 0 分', () => {
    const one = scorePractice(mx, { '3': ['A'] }).outcomes['3'];
    expect(one).toMatchObject({ kind: 'auto', status: 'partial', wrongOptions: 1 });
    expect(one?.earned).toBeCloseTo(8 / 3);
    expect(scorePractice(mx, { '3': ['A', 'C', 'D'] }).outcomes['3']?.earned).toBeCloseTo(8 / 3);
    expect(scorePractice(mx, { '3': ['B', 'D'] }).outcomes['3']?.earned).toBeCloseTo(4 / 3);
    expect(scorePractice(mx, { '3': ['B', 'C', 'D'] }).outcomes['3']).toMatchObject({ earned: 0, status: 'wrong' });
    expect(scorePractice(mx, {}).outcomes['3']).toMatchObject({ earned: 0, status: 'unanswered' });
  });

  it('多選的實際算式', () => {
    expect(multiSelectFormula(4, 6, ['A', 'D'], ['A'])).toBe('本題 6 個選項，你錯了 1 個 → 4 × (6 − 2 × 1) ÷ 6 ＝ 2.67 分。');
    expect(multiSelectFormula(4, 6, ['A', 'D'], ['A', 'D'])).toBe('本題 6 個選項，你錯了 0 個 → 4 × (6 − 2 × 0) ÷ 6 ＝ 4 分。');
    expect(multiSelectFormula(4, 6, ['A', 'D'], ['B', 'C', 'E'])).toBe('本題 6 個選項，你錯了 5 個 → 4 × (6 − 2 × 5) ÷ 6 ≤ 0，以 0 分計。');
    expect(multiSelectFormula(4, 6, ['A', 'D'], [])).toBe('本題 6 個選項；全部未作答，0 分。');
  });

  it('填充：可接受答案清單裡的每一個都得全分（makes 也對）', () => {
    expect(scorePractice(mx, { '1': 'Makes' }).outcomes['1']).toMatchObject({ kind: 'open', earned: 2, status: 'correct', matched: 'makes' });
  });

  it('填充：選字正確、字形錯誤 1 分；拼錯 1 分；別的字 0 分；兩個字 0 分', () => {
    const s = scorePractice(mx, { '1': 'turned', '2': 'fillling', '4': 'measure' });
    expect(s.outcomes['1']).toMatchObject({ earned: 1, status: 'form' });
    expect(s.outcomes['2']).toMatchObject({ earned: 1, status: 'spelling', matched: 'filling' });
    expect(s.outcomes['4']).toMatchObject({ earned: 0, status: 'wrong' });
    expect(scorePractice(mx, { '2': 'filling up' }).outcomes['2']).toMatchObject({ earned: 0, status: 'too_many_words' });
  });

  it('拼字錯誤要排除「另一個真的字」：題組裡出現過、或單字索引查得到（含規則變化）', () => {
    const lookup = wordLookup(mx, MINI_VOCAB_INDEX);
    const known = lookup.isKnownWord;
    // fits 是 fit 的規則變化（單字索引有 fit）：是真的字。
    expect(known('fits')).toBe(true);
    expect(known('fillling')).toBe(false);
    // 題組裡出現過的字（Kevin 的短文有 trash、Mia 的有 fridge）。
    expect(groupWords(mx).has('trash')).toBe(true);
    expect(known('fridge')).toBe(true);
    expect(scorePractice(mx, { '1': 'trash' }, lookup).outcomes['1']).toMatchObject({ earned: 0, status: 'wrong' });
    // 和正解只差一兩個字母、但是真的字（filing）：不算拼錯，0 分；不知道是不是真的字時算拼錯。
    expect(scorePractice(mx, { '2': 'fillinf' }, lookup).outcomes['2']).toMatchObject({ earned: 1, status: 'spelling' });
    expect(scorePractice(mx, { '2': 'filing' }, { isKnownWord: (w) => w === 'filing' }).outcomes['2']).toMatchObject({ earned: 0, status: 'wrong' });
    expect(scorePractice(mx, { '2': 'filing' }).outcomes['2']).toMatchObject({ earned: 1, status: 'spelling' });
  });

  it('填充：解析沒列的字形，單字索引查得到是同一個條目也給 1 分（SPEC §4.6 ②）', () => {
    const items = mx.annotations.explanations.items;
    const noPartial: PracticeGroupFile = {
      ...mx,
      annotations: {
        ...mx.annotations,
        explanations: { items: { ...items, '2': { ...(items['2'] ?? { explanation_zh: '', evidence: [] }), partial_credit_forms: [] } } },
      },
    };
    const index = {
      ...MINI_VOCAB_INDEX,
      entries: [...MINI_VOCAB_INDEX.entries, { id: 'fill|v.|1', word: 'fill', level: 1 as const, pos: ['v.' as const], zh: '裝滿', cefr: null, exam_total: 0, exam_answer: 0 }],
    };
    const lookup = wordLookup(noPartial, index);
    expect(lookup.sameEntry('filling', 'filled')).toBe(true);
    expect(lookup.sameEntry('filling', 'fits')).toBe(false);
    expect(scorePractice(noPartial, { '2': 'Filled' }, lookup).outcomes['2']).toMatchObject({ earned: 1, status: 'form', matched: 'filling' });
    // 單字索引還沒下載好：只看 partial_credit_forms（清單是空的），filled 是題組裡沒出現的字 → 和 filling 差 3 個字母，0 分。
    expect(scorePractice(noPartial, { '2': 'filled' }, wordLookup(noPartial, null)).outcomes['2']).toMatchObject({ earned: 0, status: 'wrong' });
  });

  it('簡答：可接受答案全分、字形錯 1 分、多寫一兩個字 1 分', () => {
    expect(scorePractice(mx, { '4': ' Weigh. ' }).outcomes['4']).toMatchObject({ earned: 2, status: 'correct' });
    expect(scorePractice(mx, { '4': 'weighed' }).outcomes['4']).toMatchObject({ earned: 1, status: 'form' });
    expect(scorePractice(mx, { '4': 'to weigh' }).outcomes['4']).toMatchObject({ earned: 1, status: 'extra_words' });
  });

  it('判分依據：答案＋可接受答案（去重）、解析的部分給分寫法；選擇題沒有', () => {
    const [q1, , q3] = mx.group.questions;
    expect(q1 && openAnswerKey(mx, q1)).toEqual({ mode: 'fill_in_blank', max: 2, accepted: ['turns', 'makes'], partial: ['turn', 'turned', 'turning', 'make', 'made', 'making'] });
    expect(q3 && openAnswerKey(mx, q3)).toBeNull();
  });

  it('可以互換的兩格（interchangeable_with）：答案對調放才對時照對調後計分', () => {
    const items = mx.annotations.explanations.items;
    const swappable: PracticeGroupFile = {
      ...mx,
      annotations: {
        ...mx.annotations,
        explanations: {
          items: {
            ...items,
            '1': { ...(items['1'] ?? { explanation_zh: '', evidence: [] }), interchangeable_with: 2 },
            '2': { ...(items['2'] ?? { explanation_zh: '', evidence: [] }), interchangeable_with: 1 },
          },
        },
      },
    };
    const s = scorePractice(swappable, { '1': 'filling', '2': 'turns' });
    expect(s.swapped).toEqual([['1', '2']]);
    expect(s.outcomes['1']).toMatchObject({ earned: 2, status: 'correct' });
    expect(s.outcomes['2']).toMatchObject({ earned: 2, status: 'correct' });
    // 沒有標 interchangeable_with 的題組不對調。
    expect(scorePractice(mx, { '1': 'filling', '2': 'turns' }).earned).toBe(0);
    // 照原本的位置比較高分時不對調。
    expect(scorePractice(swappable, { '1': 'turns', '2': 'filling' }).swapped).toEqual([]);
  });

  it('固定下來的判分（frozen）：同一份答案不論單字索引有沒有下載好，分數都一樣', () => {
    const answers = { '1': 'turns', '2': 'fillinf', '3': ['A'], '4': 'weigh' };
    // 交卷當下索引已經下載好：fillinf 不是真的字 → 拼字錯誤 1 分。
    const first = scorePractice(mx, answers, wordLookup(mx, MINI_VOCAB_INDEX));
    const frozen = freezeGrades(first);
    expect(frozen.open['2']).toEqual({ earned: 1, status: 'spelling', matched: 'filling' });
    expect(Object.keys(frozen.open).sort()).toEqual(['1', '2', '4']);
    // 之後就算 lookup 說它是真的字（例如重新整理後換了索引），也沿用固定下來的判分；選擇題照常計分。
    const again = scorePractice(mx, answers, { isKnownWord: () => true }, frozen);
    expect(again.outcomes['2']).toEqual({ kind: 'open', max: 2, earned: 1, status: 'spelling', matched: 'filling' });
    expect(again.earned).toBeCloseTo(first.earned);
    expect(again.outcomes['3']).toEqual(first.outcomes['3']);
    // 沒有 frozen 時同一個 lookup 會判成 0 分（對照組）。
    expect(scorePractice(mx, answers, { isKnownWord: () => true }).outcomes['2']).toMatchObject({ earned: 0, status: 'wrong' });
    // frozen 少了任何一題填充、簡答（例如舊的紀錄）：整組重新判分。
    const partialFrozen = { open: { '1': frozen.open['1'] ?? { earned: 0, status: 'wrong' as const, matched: null } }, swapped: [] };
    expect(scorePractice(mx, answers, { isKnownWord: () => true }, partialFrozen).outcomes['2']).toMatchObject({ earned: 0, status: 'wrong' });
  });

  it('判分要不要等單字索引：有填充題才要', () => {
    expect(needsWordIndex(mx)).toBe(true);
    expect(needsWordIndex(rd)).toBe(false);
  });
});

describe('閱讀', () => {
  it('單選：答對得配分，答錯、未作答 0 分', () => {
    const s = scorePractice(rd, { '1': 'B', '2': 'C', '3': 'D' });
    expect(s).toMatchObject({ earned: 4, max: 8, correct: 2, total: 4 });
    expect(s.outcomes['3']).toMatchObject({ status: 'wrong' });
    expect(s.outcomes['4']).toMatchObject({ status: 'unanswered' });
  });
});
