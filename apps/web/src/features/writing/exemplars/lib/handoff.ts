/**
 * 自訂題目在作文範文與寫作頁之間的交接（docs/design/model-essays.md §8.1）。題目只放在同一個分頁的 sessionStorage，
 * 讀完就刪；按「產生三個層級的範文」才上傳。
 *
 *   gsat-exemplars:v1:handoff     自訂題目作答頁、批改結果頁（自訂題）→ /writing/essay/exemplars?from=custom（範文頁讀進題目表單）
 *   gsat-exemplars:v1:to-attempt  範文結果頁的「回到題目寫一篇」（自訂題）→ /writing/essay/custom?prompt=exemplar（作答頁帶入題目）
 *
 * 值的形狀同 POST 的 custom_prompt（CustomEssayPromptInput）：{ text, figure_text, paragraphs, min_words, max_words }。
 * 這個檔案會跟著入口按鈕進到寫作各頁的程式，所以只依賴型別。
 */
import type { CustomEssayPromptInput } from '@gsat/shared';

export const EXEMPLAR_HANDOFF_KEY = 'gsat-exemplars:v1:handoff';
export const EXEMPLAR_TO_ATTEMPT_KEY = 'gsat-exemplars:v1:to-attempt';

export interface ExemplarPromptHandoff {
  text: string;
  figure_text: string | null;
  paragraphs: number | null;
  min_words: number | null;
  max_words: number | null;
}

const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** 讀出的值 → 交接的題目；形狀不對回 null。 */
export function toPromptHandoff(v: unknown): ExemplarPromptHandoff | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o['text'] !== 'string' || o['text'].trim() === '') return null;
  return {
    text: o['text'],
    figure_text: typeof o['figure_text'] === 'string' && o['figure_text'].trim() !== '' ? o['figure_text'] : null,
    paragraphs: intOrNull(o['paragraphs']),
    min_words: intOrNull(o['min_words']),
    max_words: intOrNull(o['max_words']),
  };
}

function write(key: string, prompt: CustomEssayPromptInput | ExemplarPromptHandoff): boolean {
  const value = toPromptHandoff(prompt);
  if (!value) return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function take(key: string): ExemplarPromptHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    window.sessionStorage.removeItem(key);
    return toPromptHandoff(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 自訂題目 → 範文頁（寫不進去時回 false：範文頁會請學生自己貼題目）。 */
export function writeExemplarHandoff(prompt: CustomEssayPromptInput | ExemplarPromptHandoff): boolean {
  return write(EXEMPLAR_HANDOFF_KEY, prompt);
}

/** 範文頁讀一次交接的題目（讀完就刪）。 */
export function takeExemplarHandoff(): ExemplarPromptHandoff | null {
  return take(EXEMPLAR_HANDOFF_KEY);
}

/** 範文結果頁 → 自訂題目作答頁（「回到題目寫一篇」）。 */
export function writeAttemptHandoff(prompt: ExemplarPromptHandoff): boolean {
  return write(EXEMPLAR_TO_ATTEMPT_KEY, prompt);
}

/** 自訂題目作答頁讀一次範文頁帶來的題目（讀完就刪）。 */
export function takeAttemptHandoff(): ExemplarPromptHandoff | null {
  return take(EXEMPLAR_TO_ATTEMPT_KEY);
}
