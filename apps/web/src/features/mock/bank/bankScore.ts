/**
 * 自組卷混合題的填充、簡答自動判分（docs/design/bank-mock.md §6.3）。
 *
 * 和題庫練習用同一套：practice/scoring.ts 的 scorePractice（scoreOpenAnswer、partial_credit_forms、interchangeable_with）。
 * 判分依據是重新編號後的題目（answer、完整的 accepted_answers）與 BankPaper.explanations（鍵已換成新題號）。
 * 「拼字錯成另一個真實存在的字」只用本卷這個題組裡出現過的字判斷，不等單字索引下載：題庫練習在索引下載失敗時也是這樣，
 * 所以同一份答案的分數不會因為下載的早晚而改變（交卷時寫進歷史的分數和成績單算的一樣）。
 */
import type { ExplanationItem, PracticeGroupFile } from '../../../data/bank';
import type { Exam, Question, QuestionGroup } from '../../../data/exams';
import type { AnswerValue, OpenOutcome } from '../../exams/scoring';
import { scorePractice, wordLookup } from '../../practice/scoring';
import { computeReport, historyEntryFor, type MockReport, type ReportOptions } from '../report';
import type { MockAttemptRecord } from '../storage';
import type { BankHistoryEntryFn } from './myPapers';

export interface BankOpenScores {
  /** 題號 → 判分結果（只有填充、簡答）。 */
  outcomes: ReadonlyMap<string, OpenOutcome>;
  /** 可以互換的兩格，學生的答案對調放才對（照對調後計分）。 */
  swapped: readonly (readonly [string, string])[];
}

const isOpen = (q: Question): boolean => q.mode === 'fill_in_blank' || q.mode === 'short_answer';

/** 一個題組包成 scorePractice 吃的形狀（只用到 group 與解析）。 */
function practiceView(group: QuestionGroup, explanations: Readonly<Record<string, ExplanationItem>>): Pick<PracticeGroupFile, 'group' | 'annotations'> {
  const items: Record<string, ExplanationItem> = {};
  for (const q of group.questions) {
    const item = explanations[q.label];
    if (item) items[q.label] = item;
  }
  return { group, annotations: { explanations: { items }, translation_zh: null, elimination: null } };
}

/** 整份卷子的填充、簡答判分。 */
export function bankOpenScores(exam: Exam, explanations: Readonly<Record<string, ExplanationItem>>, answers: Readonly<Record<string, AnswerValue>>): BankOpenScores {
  const outcomes = new Map<string, OpenOutcome>();
  const swapped: [string, string][] = [];
  for (const section of exam.sections) {
    for (const group of section.groups) {
      if (!group.questions.some(isOpen)) continue;
      const file = practiceView(group, explanations);
      const score = scorePractice(file, answers, wordLookup(file, null));
      for (const [label, outcome] of Object.entries(score.outcomes)) {
        if (outcome.kind === 'open') outcomes.set(label, outcome);
      }
      swapped.push(...score.swapped);
    }
  }
  return { outcomes, swapped };
}

/** computeReport 的 autoOpen（report.ts 的 ReportOptions）。 */
export function bankAutoOpen(scores: BankOpenScores): (q: Question) => OpenOutcome | null {
  return (q) => (isOpen(q) ? (scores.outcomes.get(q.label) ?? null) : null);
}

/**
 * 自組卷的成績單計算：computeReport 加上混合題的自動判分（客觀部分滿分 72，剛交卷、還沒自評時的原始分數上限也是 72）。
 * explanations 是 BankPaper.explanations；拿不到時（只有 Exam）照可接受答案判分，沒有部分給分寫法與可互換的格。
 */
export function bankReport(
  exam: Exam,
  explanations: Readonly<Record<string, ExplanationItem>>,
  record: MockAttemptRecord,
  options: Omit<ReportOptions, 'autoOpen'> = {},
): MockReport {
  return computeReport(exam, record, { ...options, autoOpen: bankAutoOpen(bankOpenScores(exam, explanations, record.attempt.answers)) });
}

/** 交卷寫入歷史（MockPaper.bank.historyEntry、逾期交卷）：原始分數含混合題自動判分，level 一律 null（不換算級分，§6.4）。 */
export const bankHistoryEntry: BankHistoryEntryFn = (record, exam, paper) => historyEntryFor(record, bankReport(exam, paper?.explanations ?? {}, record), null);
