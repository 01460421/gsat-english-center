/**
 * 確認畫面的「三篇的字數目標」（docs/design/model-essays.md §2.4：shared 的 exemplarWordTargets 前端確認畫面、Worker 的
 * <task>、後處理三邊共用）。產生之前就讓學生知道三篇各寫多長，自訂的字數範圍會改變階梯（例如只填「最多 400」時基礎版是
 * 240–304 字）；三級的範圍很接近時（範圍很窄的自訂題）多一句「主要差在內容與寫法」。純函式（測試直接比文字）。
 *
 *   - 網站題目：題目的 word_count（歷屆與本站仿真的前端靜態檔，和 Worker 題目庫的 essay.min_words／max_words／approx_words
 *     出自同一個欄位）。
 *   - 自訂題：學生填的至少／最多。
 */
import { EXEMPLAR_LEVELS, exemplarWordTargets, type ExemplarLevel, type ExemplarSource, type ExemplarWordTarget, type WordCount } from '@gsat/shared';
import { levelLabel } from '../labels';

/** 三級從基礎版的下限到頂標版的上限不到這麼多字：字數差不多，主要差在內容與寫法。 */
export const CLOSE_TARGETS_SPREAD = 60;

export const CLOSE_TARGETS_NOTE = '三個層級的字數差不多，主要差在內容與寫法。';

/** 網站題目的字數要求 → exemplarWordTargets 的輸入。 */
export function siteWordTargets(origin: Exclude<ExemplarSource, 'custom'>, wc: WordCount | null | undefined): Record<ExemplarLevel, ExemplarWordTarget> {
  return exemplarWordTargets({ origin, min_words: wc?.min ?? null, max_words: wc?.max ?? null, approx_words: wc?.approx ?? null });
}

/** 自訂題的至少／最多 → exemplarWordTargets 的輸入。 */
export function customWordTargets(p: { min_words?: number | null; max_words?: number | null }): Record<ExemplarLevel, ExemplarWordTarget> {
  return exemplarWordTargets({ origin: 'custom', min_words: p.min_words ?? null, max_words: p.max_words ?? null, approx_words: null });
}

const range = (t: ExemplarWordTarget) => `${t.min}–${t.max}`;

/** 確認畫面的文字：一行目標，三級很接近時多一行說明。 */
export function wordTargetLines(targets: Record<ExemplarLevel, ExemplarWordTarget>): string[] {
  const [basic, , top] = EXEMPLAR_LEVELS.map((l) => targets[l]) as [ExemplarWordTarget, ExemplarWordTarget, ExemplarWordTarget];
  const same = EXEMPLAR_LEVELS.every((l) => targets[l].min === basic.min && targets[l].max === basic.max);
  if (same) return [`三篇的字數目標都是 ${range(basic)} 字，三個層級主要差在內容與寫法。`];
  const line = `三篇的字數目標：${EXEMPLAR_LEVELS.map((l) => `${levelLabel(l)} ${range(targets[l])}`).join('、')} 字。`;
  return top.max - basic.min < CLOSE_TARGETS_SPREAD ? [line, CLOSE_TARGETS_NOTE] : [line];
}
