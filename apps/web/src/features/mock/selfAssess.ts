/**
 * 中譯英與英文作文的自評計分（設計文件 §6.6）。後端與 AI 批改上線前，非選擇題只有自評。
 *
 * 規準一律用本站自己的話寫，不轉載官方評分原則或評分指標表（04 文件 §4.3）；也不顯示官方參考譯文（D8）。
 */
import { countParagraphs, countWords } from '../exams/labels';
import type { CompositionSelfDetail, TranslationSelfDetail } from './storage';

// ---------------------------------------------------------------------------
// 中譯英（每題 4 分）
// ---------------------------------------------------------------------------

/** 每處錯誤扣的分數。 */
export const TRANSLATION_ERROR_DEDUCTION = 0.5;

/** 檢核項目（學生對照自己的譯文數錯誤處數用）。 */
export const TRANSLATION_CHECKLIST: readonly { title: string; hint: string }[] = [
  { title: '時態', hint: '動詞時態與句意的時間一致（例如「已經」用完成式）。' },
  { title: '主詞動詞一致', hint: '單數主詞配單數動詞；主詞是動名詞或不定詞片語時用單數。' },
  { title: '冠詞', hint: 'a／an／the 該有就有、不該有就不要加。' },
  { title: '單複數', hint: '可數名詞的單複數、複數字尾拼法。' },
  { title: '用字', hint: '字義、搭配詞與詞性正確，拼字正確。' },
  { title: '漏譯', hint: '中文句子的每個意思都有譯出來，沒有自行增減內容。' },
];

/**
 * 程式先判斷的「句首大寫、句尾標點」：句首第一個英文字母要大寫，句尾要有 . ? ! 其中之一（可接引號或括號）。
 * 回傳 true 代表有問題（要扣 0.5，只扣一次）。學生可以改。
 */
export function translationMechanicsIssue(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  const firstLetter = /[A-Za-z]/.exec(trimmed)?.[0];
  const capitalized = firstLetter !== undefined && firstLetter === firstLetter.toUpperCase();
  const punctuated = /[.?!]["'”’)\]]*$/.test(trimmed);
  return !capitalized || !punctuated;
}

/** 中譯英一題的自評分數：滿分 − 0.5 × 錯誤處數 − （句首大寫或句尾標點有問題時）0.5，最低 0。 */
export function translationScore(max: number, detail: Pick<TranslationSelfDetail, 'errors' | 'mechanics'>): number {
  const errors = Math.max(0, Math.floor(detail.errors));
  const raw = max - TRANSLATION_ERROR_DEDUCTION * errors - (detail.mechanics ? TRANSLATION_ERROR_DEDUCTION : 0);
  return Math.max(0, Math.round(raw * 100) / 100);
}

// ---------------------------------------------------------------------------
// 英文作文（20 分）
// ---------------------------------------------------------------------------

export type CompositionCriterion = 'content' | 'organization' | 'grammar' | 'vocabulary';

/** 四項各 0–5 分；描述是本站自己的話（優 5–4、可 3、差 2–1、劣 0）。 */
export const COMPOSITION_CRITERIA: readonly {
  key: CompositionCriterion;
  title: string;
  levels: { range: string; text: string }[];
}[] = [
  {
    key: 'content',
    title: '內容',
    levels: [
      { range: '5–4', text: '完整回應提示的每個要求，論點清楚，有具體的例子或細節支持。' },
      { range: '3', text: '回應了主要要求，但細節較少或不夠具體。' },
      { range: '2–1', text: '漏掉部分要求，或內容空泛、重複。' },
      { range: '0', text: '幾乎沒有內容，或完全沒有回應提示。' },
    ],
  },
  {
    key: 'organization',
    title: '組織',
    levels: [
      { range: '5–4', text: '依要求分段，每段有主題句，前後連貫，轉承語使用自然。' },
      { range: '3', text: '有分段、大致有條理，但段落間銜接較弱。' },
      { range: '2–1', text: '分段或順序混亂，讀者不容易跟上。' },
      { range: '0', text: '沒有組織可言。' },
    ],
  },
  {
    key: 'grammar',
    title: '文法句構',
    levels: [
      { range: '5–4', text: '句型有變化（例如子句、分詞構句），錯誤很少且不影響理解。' },
      { range: '3', text: '多為簡單句，有一些錯誤，但意思大致清楚。' },
      { range: '2–1', text: '錯誤多，常影響理解。' },
      { range: '0', text: '錯誤多到無法理解。' },
    ],
  },
  {
    key: 'vocabulary',
    title: '字彙拼字',
    levels: [
      { range: '5–4', text: '用字精確、有變化，搭配詞恰當，幾乎沒有拼字錯誤。' },
      { range: '3', text: '用字普通、偶有重複，有少數拼字或用字錯誤。' },
      { range: '2–1', text: '字彙有限，拼字或用字錯誤多。' },
      { range: '0', text: '字彙不足以表達。' },
    ],
  },
];

/** 字數下限：少於這個字數扣 1 分。 */
export const COMPOSITION_MIN_WORDS_DEDUCT = 100;
/** 字數提醒：少於這個字數提醒（題目通常要求至少 120 個單詞）。 */
export const COMPOSITION_MIN_WORDS_WARN = 120;

export interface CompositionChecks {
  words: number;
  paragraphs: number;
  /** 少於 100 字。 */
  tooShort: boolean;
  /** 段數少於題目要求。 */
  notParagraphed: boolean;
  /** 少於 120 字（只提醒，不扣分）。 */
  belowRecommended: boolean;
  /** 形式扣分：字數不足或未分段扣 1，兩者都有也只扣 1。 */
  deduction: number;
}

export function compositionChecks(text: string, requiredParagraphs: number | undefined, recommendedWords = COMPOSITION_MIN_WORDS_WARN): CompositionChecks {
  const words = countWords(text);
  const paragraphs = countParagraphs(text);
  const tooShort = words < COMPOSITION_MIN_WORDS_DEDUCT;
  const notParagraphed = requiredParagraphs !== undefined && requiredParagraphs > 1 && paragraphs < requiredParagraphs;
  return {
    words,
    paragraphs,
    tooShort,
    notParagraphed,
    belowRecommended: words < recommendedWords,
    deduction: tooShort || notParagraphed ? 1 : 0,
  };
}

/** 四項都選了才算完成自評。 */
export function compositionComplete(detail: CompositionSelfDetail): boolean {
  return detail.offTopic || COMPOSITION_CRITERIA.every((c) => detail[c.key] !== null);
}

/** 作文自評總分：四項相加 − 形式扣分，最低 0；勾「離題」則其他各項都算 0。還沒完成自評是 null。 */
export function compositionScore(detail: CompositionSelfDetail, checks: Pick<CompositionChecks, 'deduction'>, max = 20): number | null {
  if (detail.offTopic) return 0;
  if (!compositionComplete(detail)) return null;
  const sum = COMPOSITION_CRITERIA.reduce((acc, c) => acc + (detail[c.key] ?? 0), 0);
  return Math.min(max, Math.max(0, sum - checks.deduction));
}

export function emptyCompositionDetail(): CompositionSelfDetail {
  return { kind: 'composition', content: null, organization: null, grammar: null, vocabulary: null, offTopic: false };
}
