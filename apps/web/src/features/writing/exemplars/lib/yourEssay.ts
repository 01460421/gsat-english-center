/**
 * 結果頁的「你的作文」欄（docs/design/model-essays.md §1.8 第 6 點、§8.1）：從批改結果頁帶 ?sub= 進來時，用既有的
 * GET /api/submissions/:id（學生自己的資料）取作文本文與分數，題目相符才用 shared 的 exemplarMetrics() 算同樣的數字
 * （拍照作答的辨識文字傳 photoMode：只認空白行分段，和批改結果頁的段數一致）。
 *
 *   - 相符：網站題目要 submission.group_id 等於這一組的題組 id；自訂題要正規化後的題目全文相同（兩邊都是伺服器存的正規化題目）。
 *   - 不符、讀不到、不是作文、題目被隱藏：不顯示這一欄（不報錯）。
 *   - 只在前端計算與顯示：不寫任何儲存、不送任何 API、不印、不複製。
 * defaultLevelFor：預設打開「比你高一級」的那一篇（< 11 → 基礎版、< 15 → 穩健版、其他 → 頂標版）。
 */
import {
  exemplarMetrics,
  isCustomEssayGroupId,
  normalizeCustomPromptText,
  type ExemplarLevel,
  type ExemplarMetrics,
  type ExemplarSetDetail,
  type SubmissionDetail,
} from '@gsat/shared';
import { useEffect, useState } from 'react';
import { getSubmission } from '../../lib/writingApi';

export interface YourEssay {
  metrics: ExemplarMetrics;
  /** 最後分數（還沒批改完是 null）。 */
  score: number | null;
}

/** 比你高一級的那一篇（§1.8 第 4 點）；沒有分數時打開基礎版。 */
export function defaultLevelFor(score: number | null | undefined): ExemplarLevel {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'basic';
  if (score < 11) return 'basic';
  if (score < 15) return 'steady';
  return 'top';
}

function essayTextOf(sub: SubmissionDetail): string | null {
  const body = sub.body as unknown;
  if (typeof body !== 'object' || body === null || !('text' in body)) return null;
  const text = (body as { text: unknown }).text;
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** 這份作答和這一組範文是不是同一題（見檔頭）。 */
export function submissionMatchesSet(sub: SubmissionDetail, set: Pick<ExemplarSetDetail, 'source' | 'group_id' | 'prompt'>): boolean {
  if (sub.kind !== 'essay') return false;
  if (set.source !== 'custom') return set.group_id !== null && sub.group_id === set.group_id;
  if (!isCustomEssayGroupId(sub.group_id)) return false;
  const mine = sub.custom_prompt;
  const theirs = set.prompt;
  if (!mine || !theirs || mine.hidden || theirs.hidden) return false;
  return normalizeCustomPromptText(mine.text).text === normalizeCustomPromptText(theirs.text).text;
}

/** 作答 → 「你的作文」欄的數字；不相符或沒有作文時 null。 */
export function yourEssayOf(sub: SubmissionDetail, set: Pick<ExemplarSetDetail, 'source' | 'group_id' | 'prompt'>): YourEssay | null {
  if (!submissionMatchesSet(sub, set)) return null;
  const text = essayTextOf(sub);
  if (text === null) return null;
  // 照片辨識的文字一行對應紙上的一行：只認空白行分段（同批改結果頁的 countParagraphs(text, true)）。
  return {
    metrics: exemplarMetrics(text, { photoMode: sub.input_mode === 'photo' }),
    score: sub.status === 'graded' && typeof sub.final_score === 'number' ? sub.final_score : null,
  };
}

/**
 * ?sub= 的作答（只在這一組完成時讀一次）：state 'none'＝沒有這一欄（沒帶 sub、讀不到、不相符）；'loading'；'ready'。
 * set 換了（重新產生）不用重讀作答，只重新比對。
 */
export function useYourEssay(subId: string | null, set: Pick<ExemplarSetDetail, 'source' | 'group_id' | 'prompt'> | null): { status: 'none' | 'loading' } | { status: 'ready'; essay: YourEssay } {
  const [sub, setSub] = useState<{ id: string; detail: SubmissionDetail | null } | null>(null);
  useEffect(() => {
    if (!subId || !set) return;
    if (sub?.id === subId) return;
    const controller = new AbortController();
    getSubmission(subId, controller.signal).then(
      (detail) => setSub({ id: subId, detail }),
      () => {
        if (!controller.signal.aborted) setSub({ id: subId, detail: null });
      },
    );
    return () => controller.abort();
    // set 只決定「要不要讀」（有了才讀）；比對在下面每次 render 做。
  }, [subId, set !== null]);
  if (!subId || !set) return { status: 'none' };
  if (!sub || sub.id !== subId) return { status: 'loading' };
  const essay = sub.detail ? yourEssayOf(sub.detail, set) : null;
  return essay ? { status: 'ready', essay } : { status: 'none' };
}
