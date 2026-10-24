/**
 * 作文範文的錯誤文案（docs/design/model-essays.md §1.10、§7.3）：依錯誤代碼與 error.reason 細分，其他（登入、同意、額度、
 * 連線、閘道錯誤）沿用寫作頁的 describeError，說法和 AI 批改一致。畫面一律顯示這裡的中文，不顯示後端的英文 message。
 *
 *   400 custom_prompt_invalid  題目表單另外處理（標在那一欄；這裡只給後備的一句）
 *   409 exemplar_site_match    畫面另外問「改用網站題目／仍用我貼的題目」（這裡只給後備的一句）
 *   409 exemplar_unavailable   這一題目前不提供範文
 *   409 conflict               reason unknown_group＝Worker 還不認得這一題（網站先部署）；刪除時＝產生中；評分時＝還沒完成
 *   429 exemplar_limit         每天 20 組／保留 300 組
 *   503 not_configured（JSON） 作文範文暫停使用中
 */
import { AI_REFUND_REASONS, EXEMPLAR_LIMITS, EXEMPLAR_PROMPT_PROBLEM_MESSAGES, type AiRefundReason } from '@gsat/shared';
import { useCallback } from 'react';
import { ApiRequestError, isGatewayError } from '../../../../lib/api';
import { API_ERROR_MESSAGES } from '../../../../lib/apiErrors';
import { describeError, messageFor, type DescribeContext, type ErrorView } from '../../lib/errors';
import { useErrorView } from '../../lib/useErrorView';

/** exemplar_limit 的原因（§4.2）。 */
export const EXEMPLAR_LIMIT_MESSAGES = {
  sets_per_day: `今天已經產生 ${EXEMPLAR_LIMITS.setsPerDay} 組範文，明天再繼續。`,
  sets_stored: `我的範文已經有 ${EXEMPLAR_LIMITS.setsStored} 組，請先刪掉一些舊的。`,
} as const;

/** Worker 還不認得這一題（網站先部署、Worker 晚幾分鐘；同 BANK_AI_NOT_READY）。 */
export const EXEMPLAR_NOT_READY = '這一題的範文還在準備中（網站剛更新），幾分鐘後再試。';
export const EXEMPLAR_UNAVAILABLE = '這一題目前不提供範文。';
export const EXEMPLAR_CLOSED = '作文範文暫停使用中，暫時不能產生新的範文。';

/** 產生失敗（exemplar_sets.failure；點數一律全額退還）。 */
export const EXEMPLAR_REFUND_MESSAGES: Record<AiRefundReason, string> = {
  refusal: 'AI 無法為這個題目產生範文',
  invalid_output: 'AI 回傳的結果格式有問題',
  max_tokens: 'AI 回覆太長被截斷',
  api_error: 'AI 服務暫時發生錯誤',
  timeout: 'AI 回應逾時',
  paused: 'AI 功能暫停中，排隊中的範文已取消（最晚台灣時間明天 00:00 恢復）',
  expired: '排隊太久已取消',
  internal: '系統發生錯誤',
};

export function exemplarRefundMessage(reason: string | null | undefined): string {
  if (typeof reason === 'string' && (AI_REFUND_REASONS as readonly string[]).includes(reason)) return EXEMPLAR_REFUND_MESSAGES[reason as AiRefundReason];
  return '範文沒有產生完成';
}

export interface ExemplarErrorOptions {
  /** 刪除時的 409：「範文產生中，完成後再刪。」 */
  deleting?: boolean;
  /** 評分時的 409：「範文完成之後才能評分。」 */
  rating?: boolean;
}

/** 作文範文專用的文案；不屬於作文範文的代碼回 null（呼叫端改用 describeError）。純函式，元件與測試共用。 */
export function exemplarErrorMessage(err: unknown, opts: ExemplarErrorOptions = {}): string | null {
  if (!(err instanceof ApiRequestError) || isGatewayError(err)) return null;
  switch (err.code) {
    case 'custom_prompt_invalid':
      return messageFor(EXEMPLAR_PROMPT_PROBLEM_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.custom_prompt_invalid;
    case 'exemplar_site_match':
      return err.siteMatch ? `這一題和網站上的「${err.siteMatch.title}」相同。改用網站題目時，如果之前有同學產生過就不用點數。` : API_ERROR_MESSAGES.exemplar_site_match;
    case 'exemplar_unavailable':
      return EXEMPLAR_UNAVAILABLE;
    case 'exemplar_limit':
      return messageFor(EXEMPLAR_LIMIT_MESSAGES, err.reason) ?? API_ERROR_MESSAGES.exemplar_limit;
    case 'conflict':
      if (opts.deleting) return '範文產生中，完成後再刪。';
      if (opts.rating) return '範文完成之後才能評分。';
      if (err.reason === 'unknown_group') return EXEMPLAR_NOT_READY;
      return '這一題正在產生中，請稍後再試。';
    case 'not_found':
      return '找不到這一組範文，可能已經刪除或超過保存期限。';
    case 'payload_too_large':
      return '題目太長了，請縮短後再送出。';
    case 'not_configured':
      return err.nonJson ? null : EXEMPLAR_CLOSED;
    case 'busy':
      return '請等前一個 AI 任務完成再送出。';
    default:
      return null;
  }
}

/** 任何錯誤 → 中文說明＋（可能的）下一步。作文範文的代碼用 exemplarErrorMessage，其他交給寫作頁的 describeError。 */
export function describeExemplarError(err: unknown, ctx: DescribeContext & ExemplarErrorOptions = {}): ErrorView {
  const own = exemplarErrorMessage(err, ctx);
  if (own !== null) return { message: own };
  if (err instanceof ApiRequestError && err.code === 'not_approved') return { message: 'AI 功能需要先申請並通過核准。', action: { label: '申請使用 AI', to: '/ai/apply' } };
  return describeError(err, ctx);
}

/** 頁面用：async (err) => ErrorView（consent_required 先重新讀 /api/me，同寫作頁）。 */
export function useExemplarErrorView(): (err: unknown, extra?: Pick<DescribeContext, 'quota' | 'submitting'> & ExemplarErrorOptions) => Promise<ErrorView> {
  const errorView = useErrorView();
  return useCallback(
    async (err, extra = {}) => {
      const { deleting, rating, ...rest } = extra;
      const own = exemplarErrorMessage(err, { deleting: deleting === true, rating: rating === true });
      if (own !== null) return { message: own };
      const view = await errorView(err, rest);
      if (view.action?.to === '/ai/apply' && view.action.label === '申請 AI 批改') return { ...view, action: { label: '申請使用 AI', to: '/ai/apply' } };
      return view;
    },
    [errorView],
  );
}
