/**
 * 自訂題目的段數與字數要求：顯示用的文字、從題目文字猜出的建議、送出前要確認的項目（docs/design/custom-essay.md §6.3）。
 *
 * 建議值來自 @gsat/shared 的 suggestRequirements（「文分兩段」「at least 120 words」…）。伺服器不採用建議值，也不檢查學生
 * 有沒有確認；這裡只是讓學生在送出前知道「題目有寫、欄位卻是不指定」：
 *   - 欄位旁邊顯示「題目文字提到…，要把段數要求設成 2 段嗎？」＋「設成 2 段」；
 *   - 送出 AI 批改（或上傳辨識）前還沒處理，就先問一次：「設成 2 段」或「題目沒有規定段數」。
 *     選了「題目沒有規定」記在草稿的 requirementsConfirmed（依建議值記；題目文字改了、建議值也變了時重新問）。
 */
import { suggestRequirements, type CustomEssayPrompt } from '@gsat/shared';
import type { CustomPromptDraft, RequirementsConfirmed } from './drafts';

/** 「至少 120 個單詞」「120–150 個單詞」「最多 150 個單詞」；都沒有回 null。 */
export function wordsRequirementLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? `${min} 個單詞` : `${min}–${max} 個單詞`;
  if (min !== null) return `至少 ${min} 個單詞`;
  if (max !== null) return `最多 ${max} 個單詞`;
  return null;
}

/** 題目要求的一行說明：「2 段・至少 120 個單詞」；沒有設定回 null。 */
export function requirementLabel(p: Pick<CustomEssayPrompt, 'paragraphs' | 'min_words' | 'max_words'>): string | null {
  const parts = [p.paragraphs ? `${p.paragraphs} 段` : null, wordsRequirementLabel(p.min_words, p.max_words)].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join('・') : null;
}

/** 字數建議的比對鍵（記在 requirementsConfirmed.words）。 */
export function requirementWordsKey(min: number | null, max: number | null): string {
  return `${min ?? ''}-${max ?? ''}`;
}

export interface WordsSuggestion {
  min: number | null;
  max: number | null;
  key: string;
  label: string;
}

/** 還沒處理的建議：段數或字數欄位是「不指定」、題目文字卻有寫，而且學生沒有確認過「題目沒有規定」這個值。 */
export interface PendingRequirements {
  paragraphs?: number;
  words?: WordsSuggestion;
}

export function pendingRequirements(prompt: CustomPromptDraft, confirmed: RequirementsConfirmed | null): PendingRequirements {
  const s = suggestRequirements(prompt.text);
  const out: PendingRequirements = {};
  if (s.paragraphs !== undefined && prompt.paragraphs === null && confirmed?.paragraphs !== s.paragraphs) out.paragraphs = s.paragraphs;
  const min = s.min_words ?? null;
  const max = s.max_words ?? null;
  const label = wordsRequirementLabel(min, max);
  const key = requirementWordsKey(min, max);
  if (label !== null && prompt.minWords.trim() === '' && prompt.maxWords.trim() === '' && confirmed?.words !== key) out.words = { min, max, key, label };
  return out;
}

export function hasPending(p: PendingRequirements): boolean {
  return p.paragraphs !== undefined || p.words !== undefined;
}
