/**
 * 歷屆試題的計分。
 *
 * 規則依 docs/research/02-gsat-english-spec.md §4.1（115 學測「選擇題計分方式」，111–114 同）：
 *   - 單選：答對得該題分數；答錯、未作答得 0 分。文意選填、篇章結構、句子配合（bank_choice）同單選。
 *   - 多選：n 個選項各自獨立判定，全對得滿分；答錯 k 個選項得 (n − 2k)/n 題分；低於 0 或全部未作答得 0 分。
 *   - 舊指考 91–99 原有倒扣，02 文件 §6.1 建議一律以現制計分，所以這裡沒有倒扣。
 * 填充、簡答、表格、中譯英、作文要人工（之後是 AI）批改，不自動計分，只列出配分。
 *
 * 計分例外（scoring_exception，schema 文件）：
 *   - all_credit：送分，不論作答內容（含未作答）都給滿分；
 *   - multiple_correct：官方公告的其他答案（accepted_answers）也給分；
 *   - other：照正常規則計分，畫面上顯示官方說明。
 * accepted_answers 在選擇題出現時（例如 gsat-84 第 45 題）即使還沒標 scoring_exception 也當成可接受答案：
 * 欄位的定義就是「評分原則列出的其他可接受答案」，資料補標之前先照官方答案給分，學生才不會被誤判。
 */
import type { Exam, ExamSection, Question } from '../../data/exams';

/** 作答內容：單選、選項庫是字母；多選是字母陣列；表格填寫是每個待填格依序的字串；其他是文字。 */
export type AnswerValue = string | readonly string[];

export type AutoStatus = 'correct' | 'partial' | 'wrong' | 'unanswered' | 'all_credit';

export interface AutoOutcome {
  kind: 'auto';
  max: number;
  earned: number;
  status: AutoStatus;
  /** 多選題答錯的選項數 k；單選是 null。 */
  wrongOptions: number | null;
}

export interface ManualOutcome {
  kind: 'manual';
  max: number;
  answered: boolean;
}

export type QuestionOutcome = AutoOutcome | ManualOutcome;

/** 選擇題（會自動計分）的小題。 */
export type AutoScoredQuestion = Extract<Question, { mode: 'single_choice' | 'bank_choice' | 'multi_select' }>;

export function isAutoScored(q: Question): q is AutoScoredQuestion {
  return q.mode === 'single_choice' || q.mode === 'bank_choice' || q.mode === 'multi_select';
}

const LETTER = /^[A-O]$/;

/** 單選題可得分的選項：官方答案，加上 accepted_answers 裡的其他選項代號。 */
export function acceptedLetters(q: Extract<Question, { mode: 'single_choice' | 'bank_choice' }>): string[] {
  const extra = (q.accepted_answers ?? []).map((a) => a.trim().toUpperCase()).filter((a) => LETTER.test(a));
  return Array.from(new Set([q.answer, ...extra]));
}

/**
 * 多選題得分比例。n：選項數；correct：正確選項；chosen：考生選的選項。
 * 每個選項獨立判定：該選沒選、不該選卻選了，都算答錯一個（k）。
 */
export function multiSelectFraction(
  n: number,
  correct: readonly string[],
  chosen: readonly string[],
): { fraction: number; wrong: number } {
  const want = new Set(correct);
  const got = new Set(chosen);
  let wrong = 0;
  for (const letter of want) if (!got.has(letter)) wrong += 1;
  for (const letter of got) if (!want.has(letter)) wrong += 1;
  if (got.size === 0 || n <= 0) return { fraction: 0, wrong };
  return { fraction: Math.max(0, (n - 2 * wrong) / n), wrong };
}

/** 作答內容是否「有寫」：空字串、空陣列、表格全空都算沒作答。 */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return value.some((v) => v.trim() !== '');
}

function asLetter(value: AnswerValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asLetters(value: AnswerValue | undefined): string[] {
  if (value === undefined) return [];
  return (typeof value === 'string' ? [value] : [...value]).filter((v) => v !== '');
}

export function scoreQuestion(q: Question, value: AnswerValue | undefined): QuestionOutcome {
  const max = q.points ?? 0;
  if (!isAutoScored(q)) return { kind: 'manual', max, answered: isAnswered(value) };
  if (q.scoring_exception?.type === 'all_credit') {
    return { kind: 'auto', max, earned: max, status: 'all_credit', wrongOptions: null };
  }
  if (q.mode === 'multi_select') {
    const chosen = asLetters(value);
    const n = Object.keys(q.options ?? {}).length;
    const { fraction, wrong } = multiSelectFraction(n, q.answer, chosen);
    const status: AutoStatus = chosen.length === 0 ? 'unanswered' : fraction === 1 ? 'correct' : fraction > 0 ? 'partial' : 'wrong';
    return { kind: 'auto', max, earned: max * fraction, status, wrongOptions: wrong };
  }
  const chosen = asLetter(value);
  if (chosen === null) return { kind: 'auto', max, earned: 0, status: 'unanswered', wrongOptions: null };
  const ok = acceptedLetters(q).includes(chosen);
  return { kind: 'auto', max, earned: ok ? max : 0, status: ok ? 'correct' : 'wrong', wrongOptions: null };
}

export interface SectionScore {
  sectionId: string;
  type: ExamSection['type'];
  title: string;
  questionCount: number;
  answeredCount: number;
  /** 選擇題的部分。 */
  autoCount: number;
  autoMax: number;
  earned: number;
  /** 答對（含送分）的選擇題數；多選題要全對才算。 */
  correctCount: number;
  /** 不自動計分的配分（混合題的非選擇、翻譯、作文）。 */
  manualMax: number;
}

export interface ExamScore {
  earned: number;
  autoMax: number;
  manualMax: number;
  answeredCount: number;
  questionCount: number;
  sections: SectionScore[];
  /** 依題目 label。 */
  outcomes: Record<string, QuestionOutcome>;
}

/** 整份考卷計分。answers 以題目 label 為鍵（label 在整份考卷內不重複）。 */
export function scoreExam(exam: Pick<Exam, 'sections'>, answers: Readonly<Record<string, AnswerValue>>): ExamScore {
  const outcomes: Record<string, QuestionOutcome> = {};
  const sections: SectionScore[] = exam.sections.map((section) => {
    const s: SectionScore = {
      sectionId: section.id,
      type: section.type,
      title: section.title,
      questionCount: 0,
      answeredCount: 0,
      autoCount: 0,
      autoMax: 0,
      earned: 0,
      correctCount: 0,
      manualMax: 0,
    };
    for (const group of section.groups) {
      for (const q of group.questions) {
        const value = answers[q.label];
        const outcome = scoreQuestion(q, value);
        outcomes[q.label] = outcome;
        s.questionCount += 1;
        if (isAnswered(value)) s.answeredCount += 1;
        if (outcome.kind === 'manual') {
          s.manualMax += outcome.max;
          continue;
        }
        s.autoCount += 1;
        s.autoMax += outcome.max;
        s.earned += outcome.earned;
        if (outcome.status === 'correct' || outcome.status === 'all_credit') s.correctCount += 1;
      }
    }
    return s;
  });
  const sum = (pick: (s: SectionScore) => number) => sections.reduce((acc, s) => acc + pick(s), 0);
  return {
    earned: sum((s) => s.earned),
    autoMax: sum((s) => s.autoMax),
    manualMax: sum((s) => s.manualMax),
    answeredCount: sum((s) => s.answeredCount),
    questionCount: sum((s) => s.questionCount),
    sections,
    outcomes,
  };
}

/**
 * 分數的顯示：最多兩位小數、去掉多餘的 0（4、2.67、0.5）。
 * 先四捨五入到 0.01 再比較，避免 2.6666… 加總後出現 52.669999 這種浮點尾數。
 */
export function formatPoints(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '');
}

/** 0–1 的比例 → 「57%」。 */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
