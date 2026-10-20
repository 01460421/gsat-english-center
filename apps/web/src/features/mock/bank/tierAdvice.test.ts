/**
 * 依難度的下一步建議（設計文件 §6.4、§10.1）：只看客觀部分（選擇題＋混合題）的得分率；
 * 中譯英與作文還沒自評、或自評分數高低，都不影響建議；扣除後的客觀滿分低於 36 分不給換難度的建議。
 */
import { describe, expect, it } from 'vitest';
import type { AnswerValue } from '../../exams/scoring';
import { bankReport } from './bankScore';
import { bankDeduction, objectiveScore } from './deduction';
import { ADVICE_MIN_OBJECTIVE_MAX, tierAdvice, weakestSections } from './tierAdvice';
import { bankRecord, correctAnswers, fakeBankPaper } from './uiTestFixtures';

describe('tierAdvice', () => {
  it('門檻：≥ 70% 往上一級、40%–70% 維持、< 40% 往下一級；三種難度的文字與連結', () => {
    expect(tierAdvice('basic', 50.4, 72)).toMatchObject({ kind: 'up', nextTiers: ['advanced'], practice: false });
    expect(tierAdvice('basic', 50.3, 72).kind).toBe('stay');
    expect(tierAdvice('basic', 28.8, 72)).toMatchObject({ kind: 'stay', practice: true, nextTiers: ['basic'] });
    expect(tierAdvice('basic', 28.7, 72)).toMatchObject({ kind: 'down', nextTiers: [], practice: true });
    expect(tierAdvice('advanced', 60, 72)).toMatchObject({ kind: 'up', nextTiers: ['top'], text: '可以挑戰超越頂標卷。' });
    expect(tierAdvice('advanced', 10, 72)).toMatchObject({ kind: 'down', nextTiers: ['basic'], text: '回到穩定基礎卷確認基本功。' });
    expect(tierAdvice('top', 72, 72).text).toBe('維持手感；考前用 111–115 學測模擬考確認級分。');
    expect(tierAdvice('top', 40, 72)).toMatchObject({ kind: 'stay', nextTiers: ['advanced', 'top'] });
    expect(tierAdvice('top', 0, 72)).toMatchObject({ kind: 'down', nextTiers: ['advanced'] });
    expect(tierAdvice('advanced', 36, 72).rate).toBeCloseTo(0.5);
  });

  it('扣除後的客觀滿分低於 36 分：不給換難度的建議，只建議組一份新卷', () => {
    expect(tierAdvice('advanced', 34, ADVICE_MIN_OBJECTIVE_MAX - 2)).toMatchObject({
      kind: 'too_few',
      text: '這份卷子多數題組你做過，建議組一份新卷再判斷。',
      nextTiers: ['advanced'],
    });
    expect(tierAdvice('advanced', 30, ADVICE_MIN_OBJECTIVE_MAX).kind).toBe('up');
    expect(tierAdvice('basic', 0, 0)).toMatchObject({ kind: 'too_few', rate: null });
  });

  it('只看客觀部分：中譯英與作文待評時，客觀 70/72 的學生看到「改做下一級」；自評高低不影響', () => {
    const paper = fakeBankPaper();
    const answers: Record<string, AnswerValue> = { ...correctAnswers(paper.exam), 中譯英1: 'My parents grow vegetables.', 英文作文: 'Some essay text.' };
    // 第 35 題（2 分）答錯：客觀部分 70/72。
    const q35 = paper.exam.sections.flatMap((s) => s.groups.flatMap((g) => g.questions)).find((q) => q.label === '35');
    answers['35'] = q35 && 'answer' in q35 && q35.answer === 'A' ? 'B' : 'A';
    const pending = bankReport(paper.exam, paper.explanations, bankRecord(paper, answers));
    expect(pending.pendingMax).toBeGreaterThan(0);
    expect(pending.raw).toBe(70);
    const objective = objectiveScore(pending);
    expect(objective).toMatchObject({ earned: 70, max: 72 });
    expect(tierAdvice('basic', objective.earned, objective.max)).toMatchObject({ kind: 'up', text: '可以改做進階練習卷。' });

    // 自評分數改變總分，但不改變客觀部分與建議。
    for (const self of [0, 4]) {
      const record = { ...bankRecord(paper, answers), selfScores: { 中譯英1: self, 英文作文: self * 5 } };
      const report = bankReport(paper.exam, paper.explanations, record);
      expect(objectiveScore(report)).toMatchObject({ earned: 70, max: 72 });
      expect(tierAdvice('basic', objectiveScore(report).earned, 72).kind).toBe('up');
    }
  });

  it('用到做過的題組：用扣除後的得分率', () => {
    const paper = fakeBankPaper('a0', { reused: ['1-10', '11-15', '16-20', '21-30', '35-38', '39-42', '43-46'] });
    const answers = correctAnswers(paper.exam);
    // 沒做過的題組（篇章結構、混合題）全錯：扣除前 54/72（75%）會建議往上，扣除後 0/18 不給換難度的建議。
    for (const label of ['31', '32', '33', '34', '47', '48', '49', '50']) delete answers[label];
    const report = bankReport(paper.exam, paper.explanations, bankRecord(paper, answers));
    const objective = objectiveScore(report);
    expect(objective.earned / objective.max).toBeCloseTo(54 / 72);
    const deduction = bankDeduction(report, { reused: paper.notices.reused });
    expect(deduction).toMatchObject({ objectiveEarned: 0, objectiveMax: 18 });
    expect(tierAdvice('basic', deduction?.objectiveEarned ?? 0, deduction?.objectiveMax ?? 0).kind).toBe('too_few');
  });

  it('weakestSections：客觀部分得分率最低的兩個大題（同分照卷子順序），都是題型練習有的題型', () => {
    const paper = fakeBankPaper();
    const answers = correctAnswers(paper.exam);
    for (const label of ['31', '32', '33', '34', '1']) delete answers[label];
    const report = bankReport(paper.exam, paper.explanations, bankRecord(paper, answers));
    expect(weakestSections(report)).toEqual(['structure', 'vocabulary']);
    const none = bankReport(paper.exam, paper.explanations, bankRecord(paper, {}));
    expect(weakestSections(none)).toEqual(['vocabulary', 'cloze']);
  });
});
