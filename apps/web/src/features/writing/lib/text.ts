/**
 * 寫作的字數、長度與「程式就能判斷」的機械性檢查（不用 AI）。
 *
 * 單詞數與段落數直接用 @gsat/shared 的 countEnglishWords／countParagraphs：Worker 計分（字數不足、未分段扣分）
 * 用的是同一支函式，畫面上的數字才會和批改結果的扣分一致。規則：以空白切開、含英文字母或數字的片段算一個單詞
 * （it's、well-known 各算一個，單獨的標點不算）；有空白行時以空白行分段，否則每一行算一段；
 * 照片辨識的文字（photoMode）只認空白行（手寫稿一行對應紙上的一行，不是一段）。
 */
import {
  ESSAY_EXPECTED_PARAGRAPHS,
  ESSAY_MAX_CHARS,
  ESSAY_MAX_WORDS,
  ESSAY_MIN_WORDS_HINT,
  ESSAY_SHORT_WORDS,
  TRANSLATION_SENTENCE_MAX_CHARS,
  countEnglishWords,
  countParagraphs,
} from '@gsat/shared';

export { countEnglishWords, countParagraphs };

/** 字元數（UTF-16 code units，和後端的 JavaScript length、textarea 的 maxLength 一致）。 */
export function countChars(text: string): number {
  return text.length;
}

export interface EssayLengthCheck {
  words: number;
  chars: number;
  paragraphs: number;
  empty: boolean;
  /** 少於 120 個單詞：一律提醒（官方「至少 120 個單詞」），但可以送出。 */
  belowHint: boolean;
  /** 少於 100 個單詞：批改會扣總分 1（SPEC §4.6）。 */
  veryShort: boolean;
  /** 段數和題目要求不同（只是提醒「題目要求 N 段」）。 */
  paragraphMismatch: boolean;
  /**
   * 會被扣「未分段」1 分：題目要求 ≥2 段、而目前不到 2 段（和 Worker 的 essayDeductions 同一條規則；
   * 寫得比要求的段數多不扣，題目沒有段數要求的舊題也不扣）。
   */
  paragraphDeduction: boolean;
  overWords: boolean;
  overChars: boolean;
  /** 超過 600 個單詞或 4,000 字元：不能送 AI 批改（後端也會回 413）。 */
  tooLong: boolean;
}

/**
 * 作文長度檢查。expectedParagraphs 是題目要求的段數（null＝不檢查）；photoMode 為 true 時段落只認空白行
 * （照片辨識的文字，和後端計分一致）。
 */
export function checkEssayLength(
  text: string,
  expectedParagraphs: number | null = ESSAY_EXPECTED_PARAGRAPHS,
  photoMode = false,
): EssayLengthCheck {
  const words = countEnglishWords(text);
  const chars = countChars(text);
  const paragraphs = countParagraphs(text, photoMode);
  const overWords = words > ESSAY_MAX_WORDS;
  const overChars = chars > ESSAY_MAX_CHARS;
  const empty = text.trim() === '';
  return {
    words,
    chars,
    paragraphs,
    empty,
    belowHint: !empty && words < ESSAY_MIN_WORDS_HINT,
    veryShort: !empty && words < ESSAY_SHORT_WORDS,
    paragraphMismatch: !empty && expectedParagraphs !== null && paragraphs !== expectedParagraphs,
    paragraphDeduction:
      !empty && expectedParagraphs !== null && expectedParagraphs >= ESSAY_EXPECTED_PARAGRAPHS && paragraphs < ESSAY_EXPECTED_PARAGRAPHS,
    overWords,
    overChars,
    tooLong: overWords || overChars,
  };
}

/** 程式即時標出的機械性問題（SPEC §6.8 步驟 3：句首未大寫、句尾沒標點；另加中文標點與多餘空白）。 */
export interface SentenceMechanics {
  /** 第一個英文字母是小寫。 */
  lowercaseStart: boolean;
  /** 句尾不是 . ! ? 或引號。 */
  missingEndPunctuation: boolean;
  /** 混進全形標點（，。！？；：、「」）。 */
  fullWidthPunctuation: boolean;
  /** 連續兩個以上空白。 */
  doubleSpace: boolean;
  /** 打了中文字（漏譯或忘了切換輸入法）。 */
  hasChinese: boolean;
}

export interface TranslationSentenceCheck {
  chars: number;
  empty: boolean;
  tooLong: boolean;
  mechanics: SentenceMechanics;
}

export function checkTranslationSentence(text: string): TranslationSentenceCheck {
  const trimmed = text.trim();
  const firstLetter = /[A-Za-z]/.exec(trimmed)?.[0] ?? '';
  const empty = trimmed === '';
  return {
    chars: countChars(text),
    empty,
    tooLong: countChars(text) > TRANSLATION_SENTENCE_MAX_CHARS,
    mechanics: {
      lowercaseStart: !empty && firstLetter !== '' && firstLetter === firstLetter.toLowerCase(),
      missingEndPunctuation: !empty && !/[.!?]["'’”)]?$/.test(trimmed),
      fullWidthPunctuation: /[，。！？；：、「」『』（）]/.test(text),
      doubleSpace: / {2,}/.test(trimmed),
      hasChinese: /[㐀-鿿]/.test(text),
    },
  };
}

/** 機械性問題的中文說明（只列出有問題的）。 */
export function mechanicsMessages(m: SentenceMechanics): string[] {
  const out: string[] = [];
  if (m.lowercaseStart) out.push('句首要大寫');
  if (m.missingEndPunctuation) out.push('句尾要有句點、問號或驚嘆號');
  if (m.fullWidthPunctuation) out.push('有全形（中文）標點，請改成半形');
  if (m.doubleSpace) out.push('有連續的空白');
  if (m.hasChinese) out.push('還有中文字沒有翻譯');
  return out;
}
