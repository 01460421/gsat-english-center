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
import { isAnswered, normalizeBankOpenAnswer, scoreQuestion, type AnswerValue, type QuestionOutcome } from '@gsat/shared';
import type { Exam, ExamSection, Question } from '../../data/exams';

// 計分本身（scoreQuestion、acceptedLetters、multiSelectFraction、isAnswered）搬到 @gsat/shared 的 exam-scoring.ts，
// 學習助手的 Worker 用同一支判定對錯（docs/design/learning-assistant.md §4.5.3）；這裡轉匯出，原本的匯入路徑不變。
export { acceptedLetters, isAnswered, multiSelectFraction, scoreQuestion } from '@gsat/shared';
export type { AnswerValue, AutoOutcome, AutoStatus, ManualOutcome, QuestionOutcome } from '@gsat/shared';

/** 選擇題（會自動計分）的小題。 */
export type AutoScoredQuestion = Extract<Question, { mode: 'single_choice' | 'bank_choice' | 'multi_select' }>;

export function isAutoScored(q: Question): q is AutoScoredQuestion {
  return q.mode === 'single_choice' || q.mode === 'bank_choice' || q.mode === 'multi_select';
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

// ---------------------------------------------------------------------------
// 填充、簡答的自動判分（SPEC §4.6）
//
// 歷屆試題的官方「可接受答案」只是評分原則列出的一部分，所以歷屆題頁面仍然不自動計分（OpenFeedback 只比對文字）。
// AI 題（題庫練習）的 accepted_answers 是完整的可接受答案清單、partial_credit_forms 是完整的「選字對、字形錯」清單
// （README §3.3，盲解驗證過），所以可以照下面的規則自動判分。規則都是純函式，之後歷屆題要自動判分也用同一套。
// ---------------------------------------------------------------------------

export type OpenStatus =
  /** 等於答案或可接受答案：全分。 */
  | 'correct'
  /** 選字正確、字形錯誤（partial_credit_forms）：1 分。 */
  | 'form'
  /** 拼字錯誤（長度 ≥5、和可接受答案的編輯距離 ≤2、不是另一個真實存在的字）：1 分。只用在填充。 */
  | 'spelling'
  /** 簡答：寫出了答案，但前後多了題目沒要的字（最多多 2 個字）：1 分。 */
  | 'extra_words'
  /** 簡答：答案在裡面，但抄了一大段（多 3 個字以上）：0 分。 */
  | 'copied'
  /** 填充：超過一個單詞：0 分。 */
  | 'too_many_words'
  | 'wrong'
  | 'unanswered';

export interface OpenOutcome {
  kind: 'open';
  max: number;
  earned: number;
  status: OpenStatus;
  /**
   * 判分依據：對上的可接受答案（correct、spelling、extra_words、copied）；form 是對上的部分給分寫法，
   * 或（不在部分給分清單、但詞彙表查得到是同一個條目時）它是哪一個可接受答案的其他字形。
   */
  matched: string | null;
}

/**
 * 判分要查的詞彙資料（都是選填；沒有時那一條規則就不套用）：
 *   - isKnownWord：是不是另一個真實存在的字（③ 拼字錯誤要排除真的字）；
 *   - sameEntry：兩個字是不是詞彙表同一個條目的不同字形（② 選字正確、字形錯誤；SPEC §4.6 的 vocab_forms 規則）。
 */
export interface WordLookup {
  isKnownWord?: (word: string) => boolean;
  sameEntry?: (a: string, b: string) => boolean;
}

/** 一題填充／簡答的判分依據。 */
export interface OpenAnswerKey {
  mode: 'fill_in_blank' | 'short_answer';
  max: number;
  /** 完整的可接受答案（含 answer 本身）。 */
  accepted: readonly string[];
  /** 選字正確、字形錯誤，給 1 分的寫法。 */
  partial: readonly string[];
}

/**
 * SPEC §4.6 的正規化（題庫練習的比對規則）：搬到 @gsat/shared 的 normalizeBankOpenAnswer（學習助手判定題庫題用同一支），
 * 這裡用原本的名稱轉匯出。
 */
export const normalizeOpenAnswer = normalizeBankOpenAnswer;

/** 編輯距離（相鄰兩字對調算 1 次，例如 tunrs → turns）。 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const prev = d[i - 1] as number[];
      let best = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, ((d[i - 2] as number[])[j - 2] ?? 0) + 1);
      row[j] = best;
    }
  }
  return (d[a.length] as number[])[b.length] ?? 0;
}

const words = (text: string): string[] => (text === '' ? [] : text.split(' '));

/** needle 的每個字依序、完整出現在 hay 裡（以字為單位，不是子字串）。 */
function containsWords(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    if (needle.every((w, k) => hay[i + k] === w)) return true;
  }
  return false;
}

/**
 * 填充、簡答的判分（SPEC §4.6），依序：
 *   ① 正規化後等於答案或可接受答案 → 全分；
 *   ④ 填充超過一個單詞 → 0 分（官方只寫「會扣分」，本站先定 0 分，設計值）；
 *   ② 等於「選字正確、字形錯誤」的寫法（partial_credit_forms）→ 1 分；
 *      填充另外：不在清單裡、但和某個可接受答案是詞彙表同一個條目的不同字形（lookup.sameEntry）→ 同樣 1 分；
 *   ③ 填充：長度 ≥5、和可接受答案的編輯距離 ≤2、而且不是另一個真實存在的字（lookup.isKnownWord）→ 1 分「拼字錯誤」；
 *   簡答：答案完整出現、但多寫了字 → 多 1–2 個字 1 分（「依規則扣分」，設計值）、多 3 個字以上算抄整句 0 分；
 *   ⑤ 其他 → 0 分。AI 題的可接受答案清單是完整的，所以不需要「待判定」。
 * 部分給分不超過該題配分。
 */
export function scoreOpenAnswer(key: OpenAnswerKey, value: AnswerValue | undefined, lookup: WordLookup = {}): OpenOutcome {
  const isKnownWord = lookup.isKnownWord ?? (() => false);
  const { max } = key;
  const raw = typeof value === 'string' ? value : '';
  const mine = normalizeOpenAnswer(raw);
  const outcome = (status: OpenStatus, earned: number, matched: string | null): OpenOutcome => ({ kind: 'open', max, earned, status, matched });
  if (mine === '') return outcome('unanswered', 0, null);
  const partialPoints = Math.min(1, max);
  const accepted = key.accepted.map((a) => ({ text: a, norm: normalizeOpenAnswer(a) })).filter((a) => a.norm !== '');
  const exact = accepted.find((a) => a.norm === mine);
  if (exact) return outcome('correct', max, exact.text);
  const mineWords = words(mine);
  if (key.mode === 'fill_in_blank' && mineWords.length > 1) return outcome('too_many_words', 0, null);
  const form = key.partial.find((p) => normalizeOpenAnswer(p) === mine);
  if (form !== undefined) return outcome('form', partialPoints, form);
  if (key.mode === 'fill_in_blank') {
    const sameEntry = lookup.sameEntry;
    const sibling = sameEntry ? accepted.find((a) => sameEntry(a.norm, mine)) : undefined;
    if (sibling) return outcome('form', partialPoints, sibling.text);
    if (mine.length >= 5 && !isKnownWord(mine)) {
      const near = accepted.find((a) => editDistance(a.norm, mine) <= 2);
      if (near) return outcome('spelling', partialPoints, near.text);
    }
    return outcome('wrong', 0, null);
  }
  const inside = accepted.find((a) => containsWords(mineWords, words(a.norm)));
  if (inside) {
    const extra = mineWords.length - words(inside.norm).length;
    return extra <= 2 ? outcome('extra_words', partialPoints, inside.text) : outcome('copied', 0, inside.text);
  }
  return outcome('wrong', 0, null);
}
