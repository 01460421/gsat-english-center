/**
 * 學習助手的錯誤文案（docs/design/learning-assistant.md §5.7）：依錯誤代碼與 error.reason 細分，其他（登入、同意、額度、
 * 連線、閘道錯誤）沿用寫作頁的 describeError，說法和 AI 批改一致。畫面一律顯示這裡的中文，不顯示後端的英文 message。
 */
import { AI_REFUND_REASONS, ASSIST_INPUT_PROBLEM_MESSAGES, PUBLISHER_ASSIST_ENDED_TEXT, PUBLISHER_ASSIST_NO_SCOPE_TEXT, type AiRefundReason } from '@gsat/shared';
import { ApiRequestError, isGatewayError } from '../../../lib/api';
import { API_ERROR_MESSAGES } from '../../../lib/apiErrors';
import { describeError, messageFor, type DescribeContext, type ErrorView } from '../../writing/lib/errors';

/** assist_source_unavailable 的原因（§4.2）。 */
export const ASSIST_SOURCE_MESSAGES = {
  gone: '這一題已經改版，舊版無法解析。可以做一次新版本再來問。',
  unreachable: '暫時讀不到題目，請稍後再試（沒有扣點）。',
  unsupported: '中譯英與作文請先送 AI 批改，再從批改結果問學習助手。',
  // 出版社題（docs/design/weak-paper.md §9.6）：沒有扣點。
  source_no_ai: `${PUBLISHER_ASSIST_NO_SCOPE_TEXT}（沒有扣點）。`,
  source_ended: `${PUBLISHER_ASSIST_ENDED_TEXT}（沒有扣點）。`,
} as const;

/** assist_limit 的原因（§4.15）。 */
export const ASSIST_LIMIT_MESSAGES = {
  analyses_per_case: '這一題已經解析過 2 次。有疑問可以直接追問。',
  followups_per_case: '這一題已經追問 8 次，建議開新的一題，或把疑問寫進學習報告的回饋。',
  cases_per_day: '今天已經送出 30 題，明天再繼續。',
  cases_live: '學習助手裡的題目已經有 500 題，請先刪掉一些舊的。',
  photos: '照片已經到上限，請先刪掉舊的照片再上傳。',
} as const;

/** daily_limit 依任務（error.reason 是任務代號）。 */
export const ASSIST_DAILY_LIMIT_MESSAGES = {
  assist_report: '今天已經產生 2 份學習報告，明天再試。',
  assist_ocr: '今天的拍照轉錄已經 6 次，可以改用「貼上文字」。',
} as const;

/** 解析或追問失敗（turn 的 failure；點數一律全額退還）。 */
export const ASSIST_REFUND_MESSAGES: Record<AiRefundReason, string> = {
  refusal: 'AI 無法解析這份內容',
  invalid_output: 'AI 回傳的結果格式有問題',
  max_tokens: 'AI 回覆太長被截斷',
  api_error: 'AI 服務暫時發生錯誤',
  timeout: 'AI 回應逾時',
  paused: 'AI 功能暫停中，排隊中的解析已取消（最晚台灣時間明天 00:00 恢復）',
  expired: '排隊太久已取消',
  internal: '系統發生錯誤',
};

export function assistRefundMessage(reason: string | null | undefined): string {
  if (typeof reason === 'string' && (AI_REFUND_REASONS as readonly string[]).includes(reason)) return ASSIST_REFUND_MESSAGES[reason as AiRefundReason];
  return '解析沒有完成';
}

export interface AssistErrorContext extends DescribeContext {
  /** 刪除時的 409：「解析進行中，完成後再刪。」 */
  deleting?: boolean;
}

/**
 * 學習助手專用的文案；不屬於學習助手的代碼回 null（呼叫端改用 describeError）。
 * 純函式，給元件與測試共用。
 */
export function assistErrorMessage(err: unknown, opts: { deleting?: boolean } = {}): string | null {
  if (!(err instanceof ApiRequestError) || isGatewayError(err)) return null;
  switch (err.code) {
    case 'assist_input_invalid':
      return messageFor(ASSIST_INPUT_PROBLEM_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.assist_input_invalid;
    case 'assist_source_unavailable':
      return messageFor(ASSIST_SOURCE_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.assist_source_unavailable;
    case 'assist_limit':
      return messageFor(ASSIST_LIMIT_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.assist_limit;
    case 'daily_limit':
      return messageFor(ASSIST_DAILY_LIMIT_MESSAGES, err.reason);
    case 'conflict':
      return opts.deleting ? '解析進行中，完成後再刪。' : '這一題已經有一個進行中的 AI 任務，請等它完成再送。';
    case 'busy':
      return '請等前一個 AI 任務完成再送出。';
    case 'not_found':
      return '找不到這一題，可能已經刪除或超過保存期限。';
    case 'payload_too_large':
      return '內容超過長度上限（題目 6,000 字元、疑問與追問各 500 字），請縮短後再送出。';
    case 'not_configured':
      return '學習助手暫停使用中，暫時不能送出，請稍後再試。';
    case 'not_approved':
      return null;
    default:
      return null;
  }
}

/** 任何錯誤 → 中文說明＋（可能的）下一步。學習助手的代碼用 assistErrorMessage，其他交給寫作頁的 describeError。 */
export function describeAssistError(err: unknown, ctx: AssistErrorContext = {}): ErrorView {
  const own = assistErrorMessage(err, { deleting: ctx.deleting === true });
  if (own !== null) return { message: own };
  const view = describeError(err, ctx);
  // 寫作頁的文案寫的是「申請 AI 批改」：學習助手一樣是到 /ai/apply 申請。
  if (err instanceof ApiRequestError && err.code === 'not_approved') return { message: 'AI 功能需要先申請並通過核准。', action: { label: '申請使用 AI', to: '/ai/apply' } };
  return view;
}
