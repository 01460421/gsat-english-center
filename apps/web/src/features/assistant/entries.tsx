/**
 * 各模組接上學習助手的小工具（docs/design/learning-assistant.md §1.4、§5.4）：題目回饋下方的入口按鈕（QuestionExtras）、
 * 交卷時寫本機作答紀錄（冪等）。各模組只多一行呼叫；開關關著時按鈕不出現、畫面不變（作答紀錄照樣寫，只存在這台裝置）。
 */
import type { AskRef } from '@gsat/shared';
import type { Question } from '../../data/exams';
import type { QuestionExtras } from '../exams/QuestionExtras';
import type { AnswerValue } from '../exams/scoring';
import { AskEntry, choiceState, officialOpenState } from './components/AskEntry';
import { getOutcomes, recordOutcomes, type OutcomeInput, type OutcomeSource } from './outcomes';

/** 歷屆試題、真題模考的題目回饋下方：選擇題與填充、簡答都有「問學習助手」／「這題有疑問？」。 */
export function officialAskExtras(
  askFor: (label: string) => AskRef,
  opts: { marked?: ReadonlySet<string>; selfScores?: Readonly<Record<string, number>> } = {},
): Pick<QuestionExtras, 'renderAfterFeedback' | 'renderAfterOpenFeedback'> {
  return {
    renderAfterFeedback: (q: Question, answer: AnswerValue | undefined) => (
      <AskEntry ask={askFor(q.label)} q={q} state={choiceState(q, answer)} marked={opts.marked?.has(q.label) ?? false} />
    ),
    renderAfterOpenFeedback: (q: Question, answer: AnswerValue | undefined) => (
      <AskEntry ask={askFor(q.label)} q={q} state={officialOpenState(q, answer, opts.selfScores?.[q.label])} marked={opts.marked?.has(q.label) ?? false} />
    ),
  };
}

/** 同一次作答（來源、代號、作答時間）已經寫過了沒（重新整理成績單、重新掛載都不重複寫）。 */
export function outcomesRecordedAt(source: OutcomeSource, ref: { r?: string; p?: string }, at: number): boolean {
  return getOutcomes().items.some((e) => e.s === source && e.at === at && (ref.r === undefined || e.r === ref.r) && (ref.p === undefined || e.p === ref.p));
}

/** 寫一次（同一次作答已經寫過就略過）。build 只在需要時才呼叫。 */
export function recordOutcomesOnce(source: OutcomeSource, ref: { r?: string; p?: string }, at: number, build: () => OutcomeInput[]): void {
  if (!Number.isFinite(at) || outcomesRecordedAt(source, ref, at)) return;
  try {
    recordOutcomes(build());
  } catch {
    // 作答紀錄只是學習助手的資料：任何錯誤都不能影響交卷與成績單。
  }
}
