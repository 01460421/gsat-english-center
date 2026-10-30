/**
 * 國文解析的判定與結算寫回（docs/design/assistant-subjects.md §7.3）：consumer 結算的同一個 batch 把模型的主要題型、
 * 整組的判定與答錯題數寫回 assist_cases 的 section、verdict、wrong_count，列表才有「國文｜字形・答錯」。英文的結算不變。
 *
 *   選擇  有答案鍵（學生提供）用答案鍵；沒有就用 AI 的答案（verdict_basis: ai_answer）。學生沒作答 → unanswered；
 *         沒有答案鍵而 AI 的確定程度是 unsure → unknown（畫面「AI 不確定」）。多選依 zhMultiScore：全對 correct、
 *         有得分 partial、0 分 wrong；其他子模式字母相同才 correct。
 *   簡答  check.coverage：full → correct、partial → partial、none → wrong；學生沒作答 → unanswered。
 *   國寫  unknown（不給等第或分數）。
 * 題組取最差（assistGroupVerdict），wrong_count 是答錯（wrong、partial）的題數。後處理（output.ts）與結算用同一組函式。
 * 後處理有好幾步會把 AI 答案的確定程度降成 unsure（逐項不一致、單選判出多個「該選」、字形題錯字數、讀音前後不一致），所以判定一律
 * 在後處理的最後依當時的答案鍵重算（zhRefreshChoiceItem），結算也不信任存下的 verdict，依同一組欄位再算一次。
 */
import {
  assistGroupVerdict,
  normalizeZhChoiceLetters,
  zhMultiScore,
  type AssistVerdict,
  type ZhAnalysisView,
  type ZhAnswerKey,
  type ZhChoiceItemView,
  type ZhChoiceMode,
  type ZhCoverage,
  type ZhSection,
  type ZhVerdictBasis,
} from '@gsat/shared';

/** 一題選擇題的判定與依據。 */
export function zhChoiceItemVerdict(item: { student_answer: string | null; answer_key: ZhAnswerKey; choice_mode: ZhChoiceMode; option_count?: number }): {
  verdict: AssistVerdict;
  basis: ZhVerdictBasis;
} {
  const key = item.answer_key;
  if (key === null) return { verdict: item.student_answer ? 'unknown' : 'unanswered', basis: 'none' };
  const basis: ZhVerdictBasis = key.from === 'student' ? 'student_key' : 'ai_answer';
  const chosen = normalizeZhChoiceLetters(item.student_answer ?? '') ?? '';
  if (chosen === '') return { verdict: 'unanswered', basis };
  if (key.from === 'ai' && key.certainty === 'unsure') return { verdict: 'unknown', basis };
  const answer = normalizeZhChoiceLetters(key.text) ?? '';
  if (answer === '') return { verdict: 'unknown', basis };
  if (chosen === answer) return { verdict: 'correct', basis };
  if (item.choice_mode === 'multi') {
    const score = zhMultiScore({ chosen, key: answer, n: item.option_count ?? 5, basis });
    return { verdict: score.fraction > 0 ? 'partial' : 'wrong', basis };
  }
  return { verdict: 'wrong', basis };
}

/** 逐選項表裡的選項數（A–E；沒有時 undefined，多選以 5 計）。 */
function letterCount(it: Pick<ZhChoiceItemView, 'options'>): number | undefined {
  return it.options.filter((o) => /^[A-E]$/.test(o.option)).length || undefined;
}

/**
 * 依目前的答案鍵與確定程度重算一題的判定、依據與多選計分（直接改 it）。AI 的答案降成 unsure 而沒有答案鍵時，判定是 unknown
 * （畫面「AI 不確定」），也不顯示多選的試算分數。optionCount 是題目的選項數（沒給用逐選項表的 A–E 個數）。
 */
export function zhRefreshChoiceItem(it: ZhChoiceItemView, optionCount?: number): void {
  const n = optionCount || letterCount(it);
  const v = zhChoiceItemVerdict({ student_answer: it.student_answer, answer_key: it.answer_key, choice_mode: it.choice_mode, option_count: n });
  it.verdict = v.verdict;
  it.verdict_basis = v.basis;
  it.multi_score =
    it.choice_mode === 'multi' && it.answer_key && it.student_answer !== null && v.verdict !== 'unknown'
      ? zhMultiScore({ chosen: it.student_answer, key: it.answer_key.text, n: n ?? 5, basis: v.basis === 'none' ? 'ai_answer' : v.basis })
      : null;
}

/** 一個簡答小題的判定。 */
export function zhShortPartVerdict(coverage: ZhCoverage, studentAnswer: string | null): AssistVerdict {
  if (studentAnswer === null || studentAnswer.trim() === '' || coverage === 'unanswered') return 'unanswered';
  if (coverage === 'full') return 'correct';
  if (coverage === 'partial') return 'partial';
  return 'wrong';
}

/** 結算寫回 assist_cases 的三個欄位。 */
export interface ZhSettlement {
  section: ZhSection;
  verdict: AssistVerdict | null;
  wrongCount: number;
}

/** 國文解析的結算（離題時判定是 unknown、答錯 0 題）。 */
export function zhSettlement(view: ZhAnalysisView): ZhSettlement {
  if (view.off_topic || view.kind === 'zh_writing') return { section: view.section, verdict: 'unknown', wrongCount: 0 };
  const verdicts =
    view.kind === 'zh_choice'
      ? view.items.map((it) => zhChoiceItemVerdict({ student_answer: it.student_answer, answer_key: it.answer_key, choice_mode: it.choice_mode, option_count: letterCount(it) }).verdict)
      : view.parts.map((p) => p.verdict);
  return {
    section: view.section,
    verdict: assistGroupVerdict(verdicts),
    wrongCount: verdicts.filter((v) => v === 'wrong' || v === 'partial').length,
  };
}
