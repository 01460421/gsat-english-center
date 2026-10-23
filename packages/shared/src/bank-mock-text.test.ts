/**
 * 自組卷的題號重編與字母交換（bank-mock-text.ts；docs/design/learning-assistant.md §4.5.2、§6.1）：
 * replaceMarkers、replaceBlankRefs 搬家前後輸出逐位元相同（web renumber.test.ts 的黃金資料）；swapAnswerLetters 的單元測試
 * （和 web applyLetterSwap 的逐組對照在 apps/web/src/features/mock/bank/letters.test.ts）。
 */
import { describe, expect, it } from 'vitest';
import type { ExplanationItem } from './bank';
import { RenumberError, replaceBlankRefs, replaceMarkers, swapAnswerLetters } from './bank-mock-text';

describe('replaceMarkers／replaceBlankRefs（web renumber.test.ts 的案例）', () => {
  const numbers = new Map([
    [1, 21],
    [2, 22],
  ]);
  it('[[n]] 換成新題號；題組外的記號丟出錯誤', () => {
    expect(replaceMarkers('a [[1]] b [[2]]', numbers)).toBe('a [[21]] b [[22]]');
    expect(() => replaceMarkers('a [[3]]', numbers)).toThrow(RenumberError);
    expect(() => replaceMarkers('a [[3]]', numbers, 'ai.wb.000001 ')).toThrow('ai.wb.000001 有指向題組外的空格記號 [[3]]');
  });
  it('「第 n 格」換成新題號（全形數字也認得）；題組外的保留原文', () => {
    expect(replaceBlankRefs('第 1 格和第2格', numbers)).toBe('第 21 格和第22格');
    expect(replaceBlankRefs('第 １ 格', numbers)).toBe('第 21 格');
    expect(replaceBlankRefs('第 9 格', numbers)).toBe('第 9 格');
    expect(replaceBlankRefs('第 1 題', numbers)).toBe('第 1 題');
  });
  it('RenumberError 的名稱（web 的 resolve.ts 依它判斷「組不成卷子」）', () => {
    expect(new RenumberError('x').name).toBe('RenumberError');
    expect(new RenumberError('x')).toBeInstanceOf(Error);
  });
});

describe('swapAnswerLetters', () => {
  const q = {
    no: 3,
    label: '3',
    mode: 'single_choice' as const,
    options: { A: 'right answer', B: 'option b', C: 'option c', D: 'option d' },
    answer: 'A',
    accepted_answers: null,
  };
  const item: ExplanationItem = {
    explanation_zh: '依據在第一段。',
    evidence: ['first paragraph'],
    option_notes_zh: { B: 'B 不對', C: 'C 不對', D: 'D 不對' },
    option_codes: { B: 'NM', C: 'OP', D: 'TI' },
    option_evidence: { A: ['for A'], C: ['for C'] },
  };

  it('交換 x、y：兩個選項的位置、答案、解析裡以字母為鍵的三個欄位一起換；正確選項的文字不變；其他欄位不動', () => {
    const out = swapAnswerLetters(q, item, 'A', 'C');
    expect(out.question.answer).toBe('C');
    expect(out.question.options).toEqual({ A: 'option c', B: 'option b', C: 'right answer', D: 'option d' });
    expect(Object.keys(out.question.options ?? {})).toEqual(['A', 'B', 'C', 'D']);
    expect(out.question.options?.[out.question.answer as 'C']).toBe(q.options[q.answer as 'A']);
    expect(out.question.no).toBe(3);
    expect(out.explanation?.option_notes_zh).toEqual({ A: 'C 不對', B: 'B 不對', D: 'D 不對' });
    expect(out.explanation?.option_codes).toEqual({ A: 'OP', B: 'NM', D: 'TI' });
    expect(out.explanation?.option_evidence).toEqual({ A: ['for C'], C: ['for A'] });
    expect(out.explanation?.explanation_zh).toBe(item.explanation_zh);
    // 不改原物件。
    expect(q.answer).toBe('A');
    expect(item.option_notes_zh).toEqual({ B: 'B 不對', C: 'C 不對', D: 'D 不對' });
  });

  it('accepted_answers 的字母照換；沒有解析時解析是 undefined', () => {
    const out = swapAnswerLetters({ ...q, accepted_answers: ['A', 'D'] }, undefined, 'A', 'D');
    expect(out.question.answer).toBe('D');
    expect(out.question.accepted_answers).toEqual(['D', 'A']);
    expect(out.explanation).toBeUndefined();
  });

  it('x 等於 y、選項缺 x 或 y、沒有選項：原樣回傳（同一個物件）', () => {
    expect(swapAnswerLetters(q, item, 'A', 'A').question).toBe(q);
    expect(swapAnswerLetters(q, item, 'A', 'E').question).toBe(q);
    const noOptions = { ...q, options: null };
    expect(swapAnswerLetters(noOptions, item, 'A', 'B').question).toBe(noOptions);
    expect(swapAnswerLetters(q, item, 'A', 'E').explanation).toBe(item);
  });
});
