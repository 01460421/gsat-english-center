/**
 * 預扣失敗 → 錯誤回應（寫作批改的 /api/ai/* 與學習助手的 /api/assist/* 共用；docs/design/learning-assistant.md §4.4 第 11 步）。
 * 從 routes.ts 搬來，寫作批改的回應一個字都不變。
 *
 *   - 個人額度（點數、篇數、同時任務）429、全站（暫停、預算）503；message 是 AI_ERROR_MESSAGES 的中文。
 *   - 學習助手的家族上限（每天 2 份報告、6 次拍照轉錄、3 篇國寫範文）同樣是 daily_limit，另外帶 error.reason（任務代號），
 *     前端依它改字（「今天已經產生 2 份學習報告」）。作文的 daily_limit 不帶 reason（回應不變）。
 *   - 每日退還上限（guard.ts 的 AI_REFUNDS_PER_DAY）回 429 rate_limited，第一次擋下時寫 ops_events（同一人同一天只寫一次）。
 */
import { AI_ERROR_MESSAGES, ASSIST_LIMITS, type AiReserveErrorCode, type AiTask } from '@gsat/shared';
import { ApiError } from '../errors';
import { nowSeconds } from '../time';
import { AI_REFUNDS_PER_DAY, type ReserveFailureCode } from './guard';
import { opsEvent } from './ledger';

/** 預扣失敗代碼 → HTTP 狀態（個人 429、全站 503；設計文件 §2.2）。 */
export const RESERVE_STATUS: Record<AiReserveErrorCode, 429 | 503> = {
  quota_day: 429,
  quota_month: 429,
  daily_limit: 429,
  busy: 429,
  ai_paused: 503,
  site_budget: 503,
};

export const REFUND_LIMIT_MESSAGE = `今天 AI 無法完成的次數太多了（照片看不出是作文、AI 無法批改等，每天最多 ${AI_REFUNDS_PER_DAY} 次），請明天再試`;

/** 學習助手家族上限的訊息（前端依 error.reason 顯示自己的文案，這裡給開發者看）。 */
const ASSIST_DAILY_LIMIT_MESSAGES: Partial<Record<AiTask, string>> = {
  assist_report: `今天已經產生 ${ASSIST_LIMITS.reportsPerDay} 份學習報告，明天再試`,
  assist_ocr: `今天的拍照轉錄已經 ${ASSIST_LIMITS.ocrPerDay} 次，可以改用「貼上文字」`,
  assist_zh_exemplar: `今天已經產生 ${ASSIST_LIMITS.zhExemplarsPerDay} 篇國寫範文，明天再試`,
};

/** 預扣失敗 → 錯誤回應。每日退還上限第一次擋下時寫 ops_events（同一人同一天只寫一次）。 */
export async function reserveFailure(db: D1Database, code: ReserveFailureCode, ref: string | null, task: AiTask, nowMs: number): Promise<ApiError> {
  if (code === 'daily_limit') {
    const assistMessage = ASSIST_DAILY_LIMIT_MESSAGES[task];
    if (assistMessage) return new ApiError(429, 'daily_limit', assistMessage, { reason: task });
  }
  if (code !== 'refund_limit') return new ApiError(RESERVE_STATUS[code], code, AI_ERROR_MESSAGES[code]);
  const since = nowSeconds(nowMs) - 86_400;
  const seen = ref
    ? await db
        .prepare(`SELECT 1 AS x FROM ops_events WHERE kind = 'ai_refund_limit' AND created_at > ?1 AND json_extract(detail_json, '$.user_ref') = ?2 LIMIT 1`)
        .bind(since, ref)
        .first<{ x: number }>()
        .catch(() => null)
    : null;
  if (!seen) await opsEvent(db, 'ai_refund_limit', 'warn', { user_ref: ref, task, limit: AI_REFUNDS_PER_DAY });
  return new ApiError(429, 'rate_limited', REFUND_LIMIT_MESSAGE);
}
