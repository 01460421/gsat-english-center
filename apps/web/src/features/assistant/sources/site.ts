/**
 * 站內題（題庫練習、自組卷、歷屆試題、真題模考）共用的預覽工具：一題的公開答案、從作答算狀態、題組的預覽模型。
 * 題目文字只在瀏覽器裡預覽，不送給 API（Worker 自己讀公開題目檔，§0 第 5 點）。
 */
import type { AnswerValue, AssistSection, Tier } from '@gsat/shared';
import type { Question, QuestionGroup } from '../../../data/exams';
import { acceptedLetters, isAnswered } from '../../exams/scoring';
import { isAssistableQuestion } from '../outcomeBuilders';
import type { ItemStatus, PreviewItem, PreviewModel } from './types';

/** 一題的公開答案（選擇題：可得分的字母；填充簡答：官方答案＋其他可接受答案）。 */
export function correctOf(q: Question): string[] | null {
  switch (q.mode) {
    case 'single_choice':
    case 'bank_choice':
      return acceptedLetters(q);
    case 'multi_select':
      return [...q.answer];
    case 'fill_in_blank':
    case 'short_answer':
      return [q.answer, ...(q.accepted_answers ?? [])].filter((a): a is string => typeof a === 'string' && a.trim() !== '');
    default:
      return null;
  }
}

export function answerOrNull(value: AnswerValue | undefined): AnswerValue | null {
  return value !== undefined && isAnswered(value) ? value : null;
}

export interface ItemSignals {
  status: ItemStatus;
  marked?: boolean;
  hints?: number;
  revealed?: boolean;
  clientJudged?: boolean;
}

/** 一題的預覽。display 是畫面上的題號（自組卷是卷面題號）；label 是送給 API 的題號。 */
export function previewItem(q: Question, label: string, display: string, value: AnswerValue | undefined, signals: ItemSignals): PreviewItem {
  const item: PreviewItem = {
    label,
    display,
    mode: q.mode,
    stem: q.stem,
    options: q.options ? { ...q.options } : null,
    studentAnswer: answerOrNull(value),
    correct: correctOf(q),
    status: signals.status,
  };
  if (signals.marked) item.marked = true;
  if (signals.hints) item.hints = signals.hints;
  if (signals.revealed) item.revealed = true;
  if (signals.clientJudged) item.clientJudged = true;
  return item;
}

/** 題組的預覽模型。items 只放學習助手處理的題目（選擇題與填充、簡答）。 */
export function groupPreview(opts: {
  originLabel: string;
  section: AssistSection;
  tier: Tier | null;
  instructions: string | null;
  group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'options_bank' | 'figures'>;
  items: PreviewItem[];
}): PreviewModel {
  const { group } = opts;
  const parts = (group.passage_parts ?? []).map((p) => p.text);
  const passage = [group.passage, ...parts].filter((t): t is string => typeof t === 'string' && t !== '').join('\n') || null;
  const figureText = group.figures.map((f) => f.description).filter((d): d is string => typeof d === 'string' && d !== '').join('\n') || null;
  return {
    trust: 'site',
    originLabel: opts.originLabel,
    section: opts.section,
    tier: opts.tier,
    instructions: opts.instructions,
    passage,
    figureText,
    sharedOptions: group.options_bank ? { ...group.options_bank } : null,
    items: opts.items,
  };
}

/** 題組裡學習助手處理的題目。 */
export function assistableQuestions(group: Pick<QuestionGroup, 'questions'>): Question[] {
  return group.questions.filter(isAssistableQuestion);
}
