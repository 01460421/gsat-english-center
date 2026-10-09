/**
 * 混合題填充、簡答的計分（2／1／0 原則；設計文件 §6.6）。測資取自真題：
 *   115 學測 47（innovation）、48（blended）、50（one of a kind）；112 學測 47／48（taste、health，兩格可對調）。
 */
import { describe, expect, it } from 'vitest';
import type { Question } from '../../data/exams';
import {
  assessOpenAnswer,
  assessOpenGroup,
  editDistance,
  isOpenQuestion,
  normalizeOpenAnswer,
  officialAnswers,
  sameStem,
  sameWordFamily,
  type OpenQuestion,
} from './scoreOpen';

function open(label: string, mode: 'fill_in_blank' | 'short_answer', answer: string, accepted: string[] | null = null, stem: string | null = null): OpenQuestion {
  return { no: Number.parseInt(label, 10), label, mode, stem, options: null, answer, accepted_answers: accepted, points: 2, stats: null, tags: {} } as OpenQuestion;
}

const SUMMARY_115 = '請從文章中找出兩個單詞…\nTradition coexists with [[47]], and the features are [[48]].';
const Q115_47 = open('47', 'fill_in_blank', 'innovation', null, SUMMARY_115);
const Q115_48 = open('48', 'fill_in_blank', 'blended', null, SUMMARY_115);
const Q115_50 = open('50', 'short_answer', 'one of a kind');
const SUMMARY_112 = '47-48 請從文章中找出最適當的單詞（word）填入下列句子空格中…';
const Q112_47 = open('47', 'fill_in_blank', 'taste', ['health'], SUMMARY_112);
const Q112_48 = open('48', 'fill_in_blank', 'health', ['taste'], SUMMARY_112);

describe('normalizeOpenAnswer', () => {
  it('去頭尾空白、壓縮空白、大小寫不計、句尾句點不計', () => {
    expect(normalizeOpenAnswer('  One   of a\tKind. ')).toBe('one of a kind');
    expect(normalizeOpenAnswer('Asylum.')).toBe('asylum');
    expect(normalizeOpenAnswer('blended。')).toBe('blended');
  });

  it('彎引號換直引號、全形英數字換半形、❶–❼ 視同 1–7', () => {
    expect(normalizeOpenAnswer('don’t')).toBe("don't");
    expect(normalizeOpenAnswer('“yes”')).toBe('"yes"');
    expect(normalizeOpenAnswer('ｉｎｎｏｖａｔｉｏｎ')).toBe('innovation');
    expect(normalizeOpenAnswer('❸')).toBe('3');
    expect(normalizeOpenAnswer('❶❼')).toBe('17');
  });
});

describe('輔助判斷', () => {
  it('編輯距離', () => {
    expect(editDistance('innovation', 'innovation')).toBe(0);
    expect(editDistance('inovation', 'innovation')).toBe(1);
    expect(editDistance('blendde', 'blended')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('同字根、同一個字的不同字形', () => {
    expect(sameStem('innovative', 'innovation')).toBe(true);
    expect(sameStem('blending', 'blended')).toBe(true);
    expect(sameStem('stopped', 'stop')).toBe(true);
    expect(sameStem('taste', 'health')).toBe(false);
    expect(sameStem('one of', 'one')).toBe(false);
    expect(sameWordFamily('adapt', 'adapting')).toBe(true);
    expect(sameWordFamily('cat', 'dog')).toBe(false);
  });

  it('只處理混合題的填充與簡答；官方答案＋可接受答案', () => {
    expect(isOpenQuestion(Q115_47)).toBe(true);
    expect(isOpenQuestion({ ...Q115_47, mode: 'single_choice' } as unknown as Question)).toBe(false);
    expect(officialAnswers(Q112_47)).toEqual(['taste', 'health']);
  });
});

describe('assessOpenAnswer：能確定的自動給分，其他給建議分數（2／1／0）', () => {
  it('空白 → 0 分（自動）', () => {
    expect(assessOpenAnswer(Q115_47, undefined)).toEqual({ kind: 'auto', score: 0, reason: 'blank' });
    expect(assessOpenAnswer(Q115_47, '   ')).toEqual({ kind: 'auto', score: 0, reason: 'blank' });
  });

  it('與官方答案相同（句點、頭尾空白不計）→ 滿分（自動）；簡答題不計大小寫', () => {
    expect(assessOpenAnswer(Q115_47, 'innovation.')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(assessOpenAnswer(Q115_48, 'blended')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(assessOpenAnswer(Q115_50, ' One of a kind ')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(assessOpenAnswer(Q112_47, 'health')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    // 114 學測 50 題：句首大寫、句尾句點是官方可接受答案。
    expect(assessOpenAnswer(open('50', 'short_answer', 'fostering empathy', ['Fostering empathy.']), 'Fostering empathy.')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
  });

  it('填充題只差大小寫（115 學測 48 題寫 Blended：句中大寫是字形錯誤、扣一半）→ 自評，預選 1 分', () => {
    expect(assessOpenAnswer(Q115_48, 'Blended')).toEqual({ kind: 'self', suggested: 1, reason: 'capitalization' });
    expect(assessOpenAnswer(Q115_48, 'BLENDED')).toEqual({ kind: 'self', suggested: 1, reason: 'capitalization' });
    expect(assessOpenAnswer(Q115_47, 'Innovation.')).toEqual({ kind: 'self', suggested: 1, reason: 'capitalization' });
    // 可接受答案也一樣要大小寫相同。
    expect(assessOpenAnswer(Q112_47, 'Health')).toEqual({ kind: 'self', suggested: 1, reason: 'capitalization' });
  });

  it('115 學測測資：innovative、blending → 建議 1 分；is one of a kind → 建議 0 分', () => {
    expect(assessOpenAnswer(Q115_47, 'innovative')).toEqual({ kind: 'self', suggested: 1, reason: 'word_form' });
    expect(assessOpenAnswer(Q115_48, 'blending')).toEqual({ kind: 'self', suggested: 1, reason: 'word_form' });
    expect(assessOpenAnswer(Q115_50, 'is one of a kind')).toEqual({ kind: 'self', suggested: 0, reason: 'extra_words' });
  });

  it('拼字錯誤（長度 ≥ 5、編輯距離 ≤ 2）→ 建議 1 分；太短或差太多 → 0 分', () => {
    expect(assessOpenAnswer(Q115_47, 'inovation')).toEqual({ kind: 'self', suggested: 1, reason: 'spelling' });
    expect(assessOpenAnswer(Q115_48, 'blendid')).toEqual({ kind: 'self', suggested: 1, reason: 'spelling' });
    expect(assessOpenAnswer(Q112_47, 'test')).toEqual({ kind: 'self', suggested: 0, reason: 'different' });
    // 少一個字母但字根相同（tast／taste）算字形或拼字有誤，建議 1 分。
    expect(assessOpenAnswer(Q112_47, 'tast')).toEqual({ kind: 'self', suggested: 1, reason: 'word_form' });
    expect(assessOpenAnswer(Q115_47, 'tradition')).toEqual({ kind: 'self', suggested: 0, reason: 'different' });
  });

  it('填充題寫了兩個以上的單詞 → 0 分（自動）；簡答題不受這條限制', () => {
    expect(assessOpenAnswer(Q115_47, 'new innovation')).toEqual({ kind: 'auto', score: 0, reason: 'multi_word' });
    expect(assessOpenAnswer(Q115_50, 'one of a kind store').kind).toBe('self');
  });

  it('沒有官方答案的題目一律自評', () => {
    expect(assessOpenAnswer(open('50', 'short_answer', ''), 'anything')).toEqual({ kind: 'self', suggested: 0, reason: 'no_official' });
  });

  it('配分不是 2 分時，半對的建議分數是配分的一半', () => {
    expect(assessOpenAnswer({ ...Q115_47, points: 4 }, 'innovative')).toEqual({ kind: 'self', suggested: 2, reason: 'word_form' });
  });
});

describe('assessOpenGroup：同一個摘要句裡答案可以對調，但同一個答案不能拿兩次分', () => {
  it('112 學測 47／48：taste、health 對調也給分', () => {
    const result = assessOpenGroup([Q112_47, Q112_48], { '47': 'health', '48': 'taste' });
    expect(result.get('47')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(result.get('48')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
  });

  it('兩格都寫 health：第二格不重複給分', () => {
    const result = assessOpenGroup([Q112_47, Q112_48], { '47': 'health', '48': 'Health' });
    expect(result.get('47')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(result.get('48')).toEqual({ kind: 'auto', score: 0, reason: 'duplicate' });
  });

  it('不同題幹（不同句子）的答案互不影響；選擇題略過', () => {
    const other = open('50', 'short_answer', 'health');
    const choice = { no: 49, label: '49', mode: 'multi_select', stem: null, options: { A: 'a' }, answer: ['A'], accepted_answers: null, points: 4, stats: null, tags: {} } as Question;
    const result = assessOpenGroup([Q112_47, choice, other], { '47': 'health', '50': 'health' });
    expect(result.get('50')).toEqual({ kind: 'auto', score: 2, reason: 'match' });
    expect(result.has('49')).toBe(false);
  });
});
