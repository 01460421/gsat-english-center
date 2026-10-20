/**
 * 自組卷成績單的分數拆解（設計文件 §6.4、§6.5、§10.1）：客觀部分（選擇題＋混合題，72 分，混合題的填充、簡答自動判分）、
 * 自評部分（中譯英＋作文，28 分），以及扣掉做過、已下架或不計分的題組後的得分；交卷寫入歷史的摘要不換算級分。
 */
import { describe, expect, it } from 'vitest';
import type { AnswerValue } from '../../exams/scoring';
import { computeReport } from '../report';
import { loadHistory, upsertHistory } from '../storage';
import { bankMockPaper } from './bankMockPaper';
import { bankOpenScores, bankReport } from './bankScore';
import { bankDeduction, objectiveScore, selfScoredPart } from './deduction';
import { bankRecord, correctAnswers, fakeBankPaper } from './uiTestFixtures';

describe('客觀部分與自評部分', () => {
  it('全部答對：客觀 72／72（填充、簡答自動判分，不進自評）；中譯英、作文空白是 0／28', () => {
    const paper = fakeBankPaper();
    const report = bankReport(paper.exam, paper.explanations, bankRecord(paper, correctAnswers(paper.exam)));
    expect(objectiveScore(report)).toEqual({ earned: 72, max: 72, pendingMax: 0 });
    expect(selfScoredPart(report)).toEqual({ earned: 0, max: 28, pendingMax: 0 });
    expect(report.raw).toBe(72);
    expect(report.openItems.filter((o) => o.kind === 'mixed').every((o) => o.source === 'auto' && o.autoOutcome?.status === 'correct')).toBe(true);
  });

  it('沒有 autoOpen 時照原本的規則：拼錯的填充交給自評（建議分數），有 autoOpen 時照題庫練習的規則自動給分', () => {
    const paper = fakeBankPaper();
    const answers: Record<string, AnswerValue> = { ...correctAnswers(paper.exam), 47: 'alphas' };
    const record = bankRecord(paper, answers);
    const plain = computeReport(paper.exam, record).openItems.find((o) => o.label === '47');
    expect(plain?.source).not.toBe('auto');
    // partial_credit_forms 有 alphas：選字對、字形錯，自動給 1 分。
    const auto = bankReport(paper.exam, paper.explanations, record).openItems.find((o) => o.label === '47');
    expect(auto).toMatchObject({ source: 'auto', score: 1 });
    expect(auto?.autoOutcome?.status).toBe('form');
  });

  it('可以互換的兩格對調放：照對調後計分', () => {
    const paper = fakeBankPaper();
    const answers: Record<string, AnswerValue> = { ...correctAnswers(paper.exam), 47: 'beta', 48: 'alpha' };
    const scores = bankOpenScores(paper.exam, paper.explanations, answers);
    expect(scores.swapped).toEqual([['47', '48']]);
    expect(scores.outcomes.get('47')?.earned).toBe(2);
  });
});

describe('bankDeduction', () => {
  it('沒有要扣的題組是 null', () => {
    const paper = fakeBankPaper();
    const report = bankReport(paper.exam, paper.explanations, bankRecord(paper, correctAnswers(paper.exam)));
    expect(bankDeduction(report, {})).toBeNull();
    expect(bankDeduction(report, { reused: [], removed: [], excluded: [] })).toBeNull();
  });

  it('做過、已下架、不計分的題組一起扣（重複的只扣一次）；中譯英只從總分扣，不影響客觀部分', () => {
    const paper = fakeBankPaper();
    const answers = correctAnswers(paper.exam);
    delete answers['36'];
    const report = bankReport(paper.exam, paper.explanations, bankRecord(paper, answers));
    const d = bankDeduction(report, { reused: ['35-38', '中譯英1-中譯英2'], removed: ['47-50'], excluded: ['35-38'] });
    expect(d).toEqual({
      ranges: ['35-38', '47-50', '中譯英1-中譯英2'],
      count: 4 + 4 + 2,
      // 原始 70（第 36 題沒答）扣掉 35–38 的 6 分、混合題 10 分。
      earned: 54,
      max: 100 - 8 - 10 - 8,
      objectiveEarned: 54,
      objectiveMax: 72 - 8 - 10,
    });
  });
});

describe('交卷寫入歷史', () => {
  it('level 一律是 null，原始分數含混合題填充與簡答的自動判分', () => {
    const paper = fakeBankPaper();
    const record = {
      ...bankRecord(paper, { 47: 'alpha', 48: 'beta', 50: 'gamma' }),
      status: 'submitted' as const,
      submittedAt: new Date().toISOString(),
      submitReason: 'manual' as const,
    };
    const mock = bankMockPaper(paper);
    const entry = mock.bank?.historyEntry(record, paper.exam);
    expect(entry).toMatchObject({ paperId: paper.id, level: null, raw: 6, pendingMax: 0 });
    if (entry) upsertHistory(entry);
    expect(loadHistory()[0]).toMatchObject({ level: null, raw: 6 });
  });
});
