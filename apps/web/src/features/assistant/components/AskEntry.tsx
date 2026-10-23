/**
 * 題目回饋下方的學習助手入口（docs/design/learning-assistant.md §1.4）：依這題的對錯決定主要或次要樣式。
 * 各模組用 QuestionExtras 的 renderAfterFeedback／renderAfterOpenFeedback（或解析卡下方）插進來；開關關著時 render null。
 */
import type { AskRef } from '@gsat/shared';
import type { Question } from '../../../data/exams';
import { isAnswered, scoreQuestion, type AnswerValue } from '../../exams/scoring';
import { assessOpenAnswer } from '../../mock/scoreOpen';
import { okFromRatio } from '../outcomes';
import { isAssistableQuestion } from '../outcomeBuilders';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';
import { AskAssistantButton, askVariantFor } from './AskAssistantButton';

export interface EntryState {
  ok: 1 | 0.5 | 0 | null;
  answered: boolean;
}

/** 選擇題（同網站的 scoreQuestion；送分算對）。 */
export function choiceState(q: Question, answer: AnswerValue | undefined): EntryState {
  if (q.mode !== 'single_choice' && q.mode !== 'bank_choice' && q.mode !== 'multi_select') return { ok: null, answered: false };
  const outcome = scoreQuestion(q, answer);
  const answered = answer !== undefined && isAnswered(answer);
  if (outcome.kind !== 'auto') return { ok: null, answered };
  const ok = outcome.status === 'correct' || outcome.status === 'all_credit' ? 1 : outcome.status === 'partial' ? 0.5 : 0;
  return { ok, answered };
}

/** 歷屆題的填充、簡答（assessOpenAnswer 的自動判分或建議分數；selfScore 是模考的自評）。 */
export function officialOpenState(q: Question, answer: AnswerValue | undefined, selfScore?: number): EntryState {
  if (q.mode !== 'fill_in_blank' && q.mode !== 'short_answer') return { ok: null, answered: false };
  const answered = answer !== undefined && isAnswered(answer);
  const a = assessOpenAnswer(q, answer);
  const score = selfScore ?? (a.kind === 'auto' ? a.score : a.suggested);
  return { ok: okFromRatio(score, q.points ?? 0), answered };
}

/** 題目回饋下方的一列按鈕（不是學習助手處理的題型時 render null）。 */
export function AskEntry({ ask, q, state, marked = false }: { ask: AskRef; q: Pick<Question, 'label' | 'mode'>; state: EntryState; marked?: boolean }) {
  // 開關關著時連外框都不畫（空的 div 也會多出間距，§1.9 手機 0 像素差異）。
  const enabled = useAssistantEnabled();
  if (!enabled || !isAssistableQuestion(q as Question)) return null;
  const variant = askVariantFor({ ok: state.ok, answered: state.answered, marked });
  if (!variant) return null;
  return (
    <div className="mt-3">
      <AskAssistantButton ask={ask} variant={variant} target={/^\d/.test(q.label) ? `第 ${q.label} 題` : q.label} />
    </div>
  );
}
