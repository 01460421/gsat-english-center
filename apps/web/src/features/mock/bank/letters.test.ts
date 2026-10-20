/**
 * 閱讀的答案位置調整（設計文件 §5.3、§10.1）：交換時一起改的欄位、正確選項的文字不變、確定性、
 * 不是 ABCD 排列或 sw 是空的篇章不動，以及寫死結果的黃金測試（規則一改就失敗，要換成 bk2）。
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceQuestion, OptionLetter } from '../../../data/exams';
import { adjustReadingLetters, applyLetterSwap, isAbcdPermutation, letterSwapFor } from './letters';
import { fakeGroupFile } from './testFixtures';

/** 所有 12 個 (q, r) 組合都可以交換。 */
const ALL_PAIRS: [number, number][] = [1, 2, 3, 4].flatMap((q) => [1, 2, 3, 4].filter((r) => r !== q).map((r) => [q, r] as [number, number]));

function answers(file: ReturnType<typeof fakeGroupFile>): string {
  return file.group.questions.map((q) => (q.mode === 'single_choice' ? q.answer : '?')).join('');
}

function question(file: ReturnType<typeof fakeGroupFile>, no: number): ChoiceQuestion {
  const q = file.group.questions.find((x) => x.no === no);
  if (!q || q.mode !== 'single_choice') throw new Error('不是單選');
  return q;
}

describe('applyLetterSwap', () => {
  it('交換 (q, r)：q 的答案變成 r 的字母；兩個選項、option_notes_zh、option_codes、option_evidence 的鍵一起換；正確選項的文字不變', () => {
    const file = fakeGroupFile('reading', 'ai.rd.000111');
    // 答案 B、C、A、D：交換 (3, 2) → 第 3 題的答案 A 變成 C。
    const before = question(file, 3);
    const correctText = before.options?.[before.answer];
    const out = applyLetterSwap(file, [3, 2]);
    const after = question(out, 3);
    expect(after.answer).toBe('C');
    expect(after.options?.C).toBe(correctText);
    expect(after.options?.A).toBe(before.options?.C);
    expect(after.options?.B).toBe(before.options?.B);
    expect(Object.keys(after.options ?? {})).toEqual(['A', 'B', 'C', 'D']);
    const itemBefore = file.annotations.explanations.items['3'];
    const itemAfter = out.annotations.explanations.items['3'];
    // 錯誤選項 C 的說明搬到 A（原本 A 是正解、沒有說明）。
    expect(itemAfter?.option_notes_zh?.A).toBe(itemBefore?.option_notes_zh?.C);
    expect(itemAfter?.option_notes_zh?.C).toBeUndefined();
    expect(itemAfter?.option_codes?.A).toBe(itemBefore?.option_codes?.C);
    expect(itemAfter?.option_evidence?.C).toEqual(itemBefore?.option_evidence?.A);
    expect(itemAfter?.option_evidence?.A).toEqual(itemBefore?.option_evidence?.C);
    // 中文解析的文字不動；其他題不動；原物件不變。
    expect(itemAfter?.explanation_zh).toBe(itemBefore?.explanation_zh);
    expect(question(out, 2)).toEqual(question(file, 2));
    expect(answers(file)).toBe('BCAD');
    expect(answers(out)).toBe('BCCD');
  });

  it('不能交換的組合原樣回傳：同一題、答案相同、題號不存在', () => {
    const file = fakeGroupFile('reading', 'ai.rd.000111', 1, { answers: ['A', 'A', 'B', 'C'] });
    expect(applyLetterSwap(file, [1, 1])).toBe(file);
    expect(applyLetterSwap(file, [1, 2])).toBe(file);
    expect(applyLetterSwap(file, [1, 9])).toBe(file);
  });
});

describe('letterSwapFor／adjustReadingLetters', () => {
  it('同一個 uid 與位置結果固定；ABCD 排列以外的篇章、sw 是空的篇章都不動', () => {
    const file = fakeGroupFile('reading', 'ai.rd.0c1d2e');
    expect(letterSwapFor(file.uid, 5, file.group.questions, ALL_PAIRS)).toEqual(letterSwapFor(file.uid, 5, file.group.questions, ALL_PAIRS));
    expect(adjustReadingLetters(file, 5, []).swap).toBeNull();
    const notPerm = fakeGroupFile('reading', 'ai.rd.0c1d2e', 1, { answers: ['A', 'A', 'B', 'C'] as OptionLetter[] });
    expect(isAbcdPermutation(notPerm.group.questions)).toBe(false);
    const r = adjustReadingLetters(notPerm, 5, ALL_PAIRS);
    expect(r.swap).toBeNull();
    expect(r.file).toBe(notPerm);
  });

  it('約 15 分之 2 的篇章不換', () => {
    let kept = 0;
    const total = 600;
    for (let i = 0; i < total; i += 1) {
      const uid = `ai.rd.${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(-6)}`;
      const file = fakeGroupFile('reading', uid);
      if (letterSwapFor(uid, 5 + (i % 3), file.group.questions, ALL_PAIRS) === null) kept += 1;
    }
    expect(kept / total).toBeGreaterThan(0.07);
    expect(kept / total).toBeLessThan(0.2);
  });

  it('sw 裡不合法的組合（答案相同）不套用', () => {
    const file = fakeGroupFile('reading', 'ai.rd.0c1d2e');
    // ai.rd.0c1d2e 在第 5 個位置會挑 sw 的第 (⌊h/15⌋ mod n) 組；只放一組不合法的，結果一定是不換。
    expect(letterSwapFor(file.uid, 5, file.group.questions, [[2, 2]])).toBeNull();
  });
});

describe('黃金測試（bk1 的規則；改了就要換成 bk2）', () => {
  // 每一篇的答案都是 B、C、A、D，sw 是全部 12 組。
  const cases: { uid: string; slot: number; swap: [number, number] | null; answers: string }[] = [
    { uid: 'ai.rd.0c1d2e', slot: 5, swap: [3, 2], answers: 'BCCD' },
    { uid: 'ai.rd.02e929', slot: 6, swap: [1, 3], answers: 'ACAD' },
    { uid: 'ai.rd.0c1d2e', slot: 7, swap: null, answers: 'BCAD' },
    { uid: 'ai.rd.123456', slot: 7, swap: [4, 2], answers: 'BCAC' },
  ];
  for (const c of cases) {
    it(`${c.uid} 在第 ${c.slot} 個位置：${c.swap ? `交換 ${c.swap.join('、')}` : '不換'}`, () => {
      const r = adjustReadingLetters(fakeGroupFile('reading', c.uid), c.slot, ALL_PAIRS);
      expect(r.swap).toEqual(c.swap);
      expect(answers(r.file)).toBe(c.answers);
    });
  }
});
