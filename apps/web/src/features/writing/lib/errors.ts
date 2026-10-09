/**
 * 把 API 錯誤轉成學生看得懂的中文（不顯示後端的英文 message，只依錯誤代碼）。
 * AI 額度與擋下原因用 @gsat/shared 的 AI_ERROR_MESSAGES；額度不足改用下次重置的時間（GET /api/ai/quota 的 resets_at）組成一句。
 * 閘道回的非 JSON 5xx（Vercel 502／504、Cloudflare 1101／1102）是暫時性的伺服器問題，不顯示成「AI 功能尚未開放」。
 */
import { AI_ERROR_MESSAGES, AI_REFUND_REASONS, type AiGateErrorCode, type AiQuotaResponse, type AiRefundReason, type MeResponse } from '@gsat/shared';
import { ApiRequestError, isGatewayError, needsOnboarding } from '../../../lib/api';
import { welcomeHref } from '../../account/ui';

export interface ErrorAction {
  label: string;
  /** 站內路由（用 <Link>）。 */
  to?: string;
  /** 整頁跳轉（登入要跳到 Worker）。 */
  href?: string;
}

export interface ErrorView {
  message: string;
  action?: ErrorAction;
}

const AI_GATE_CODES = Object.keys(AI_ERROR_MESSAGES) as AiGateErrorCode[];

function isAiGateCode(code: string | null): code is AiGateErrorCode {
  return code !== null && (AI_GATE_CODES as string[]).includes(code);
}

const TW_DATE_TIME = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** ISO 時間 → 「10/9（週五）00:00」（台灣時間）；格式不對回 null。 */
export function formatResetTime(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const parts = Object.fromEntries(TW_DATE_TIME.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const hour = parts['hour'] === '24' ? '00' : parts['hour'];
  return `${parts['month']}/${parts['day']}（${parts['weekday']}）${hour}:${parts['minute']}`;
}

export interface DescribeContext {
  /** 額度不足時用來顯示重置時間。 */
  quota?: AiQuotaResponse | null;
  /** 登入後要回到哪個站內路徑。 */
  loginHref?: string;
  /**
   * 目前的 /api/me：AI 端點回 consent_required 時用來判斷缺的是登入同意（→ /account/welcome）
   * 還是 AI 資料處理同意改版（pending_ai_consents，→ /ai/apply 重新同意；設計文件 §10 W1）。
   */
  me?: MeResponse;
  /** 目前的站內路徑：同意完成後要回到哪裡（/account/welcome?next=…）。 */
  returnTo?: string;
  /**
   * 送出作答（建立提交、上傳照片、送 AI 任務）時失敗：連線或伺服器錯誤要補一句「作答已保留」。
   * 回應在網路上遺失時任務可能其實已經送出；重送時 upsertSubmission 會先看那一份的狀態，直接帶到批改進度，不會重複扣點。
   */
  submitting?: boolean;
}

/** AI 全站暫停（管理員或 Anthropic 用量上限）在台灣時間隔天 00:00 自動恢復（設計文件 §10 A2「全站暫停」）。 */
export const AI_PAUSED_MESSAGE = `${AI_ERROR_MESSAGES.ai_paused}，最晚台灣時間明天 00:00 自動恢復`;

const RESUBMIT_HINT = '作答已保留；如果其實已經送出，再按一次會直接帶你到批改進度，不會重複扣點。';

/**
 * consent_required 時要把學生帶去哪裡（me 要是最新的：呼叫端先重新讀 /api/me，見 useErrorView.ts）。
 *   - 登入同意沒完成（pending_consents 非空、或首次設定沒完成）→ /account/welcome?next=<目前路徑>
 *   - AI 處理說明要重新同意（pending_ai_consents 非空）→ /ai/apply（那裡有重新同意的表單）
 *   - 看不出原因（me 還沒更新）→ 歡迎頁：它會依最新狀態顯示要同意的內容，或直接給「回到原頁」。
 */
function consentView(me: MeResponse | undefined, returnTo: string | undefined): ErrorView {
  if (me?.user && !needsOnboarding(me) && (me.pending_ai_consents ?? []).length > 0) {
    return {
      message: 'AI 資料處理說明已經更新，請重新同意後再使用 AI 批改。',
      action: { label: '前往重新同意', to: '/ai/apply' },
    };
  }
  return {
    message: AI_ERROR_MESSAGES.consent_required,
    action: { label: '前往同意', to: returnTo ? welcomeHref(returnTo) : '/account/welcome' },
  };
}

/** 額度用完：「今日點數已用完，10/10（週六）00:00（台灣時間）重置」；拿不到 resets_at 時用共用文案。 */
function quotaMessage(code: 'quota_day' | 'quota_month' | 'daily_limit', quota: AiQuotaResponse | null | undefined): string {
  const iso = quota ? (code === 'quota_month' ? quota.resets_at.month : quota.resets_at.day) : null;
  const when = iso ? formatResetTime(iso) : null;
  if (!when) return code === 'daily_limit' ? `${AI_ERROR_MESSAGES.daily_limit}，台灣時間 00:00 重置` : AI_ERROR_MESSAGES[code];
  const what = code === 'quota_day' ? '今日點數已用完' : code === 'quota_month' ? '本月點數已用完' : AI_ERROR_MESSAGES.daily_limit;
  return `${what}，${when}（台灣時間）重置`;
}

/** 任何錯誤 → 中文說明＋（可能的）下一步。 */
export function describeError(error: unknown, ctx: DescribeContext = {}): ErrorView {
  const hint = ctx.submitting ? RESUBMIT_HINT : '';
  if (!(error instanceof ApiRequestError)) {
    // fetch 本身丟的 TypeError：離線、DNS、連線被中斷。
    return { message: `連線失敗，請檢查網路後再試一次。${hint}` };
  }
  // 閘道的 HTML 錯誤頁：伺服器暫時有問題（功能本身是開著的）。
  if (isGatewayError(error)) return { message: `伺服器暫時有問題，請稍後再試。${hint}` };
  const code = error.code;
  if (code === 'quota_day' || code === 'quota_month' || code === 'daily_limit') return { message: quotaMessage(code, ctx.quota) };
  if (code === 'ai_paused') return { message: `${AI_PAUSED_MESSAGE}。` };
  if (code === 'not_approved') return { message: AI_ERROR_MESSAGES.not_approved, action: { label: '申請 AI 批改', to: '/ai/apply' } };
  if (code === 'consent_required') return consentView(ctx.me, ctx.returnTo);
  if (isAiGateCode(code)) return { message: AI_ERROR_MESSAGES[code] };
  switch (code) {
    case 'unauthorized':
    case 'reauth_required':
      return { message: '登入已過期，請重新登入。', ...(ctx.loginHref ? { action: { label: '重新登入', href: ctx.loginHref } } : {}) };
    case 'account_suspended':
      return { message: '你的帳號已停權，暫時不能使用這個功能。' };
    case 'conflict':
      return { message: '這份作答目前不能修改（可能已經在批改中），請重新整理頁面看最新狀態。' };
    case 'payload_too_large':
      return { message: '內容超過長度上限（每句 500 字元；作文 600 個單詞、4,000 字元；照片每張 1.2 MB）。' };
    case 'not_found':
      return { message: '找不到這份作答，可能已經刪除。' };
    case 'not_implemented':
      return { message: 'AI 批改即將開放，現在可以先用自我檢核練習。' };
    case 'rate_limited':
      // 後端的 429 rate_limited 有兩種：短時間內送太多次，或今天的次數已用完（每天建立作答的上限、
      // 「辨識失敗或拒答而退點」每天最多 5 次）。回應沒有區分，所以兩種都講。
      return { message: '操作太頻繁，或今天的次數已達上限。請稍等一下再試；如果還是不行，請明天再試。' };
    case 'bad_request':
      return { message: '送出的內容格式不正確，請重新整理頁面再試一次。' };
    case 'forbidden':
      return { message: '你沒有權限使用這個功能。' };
    default:
      return { message: error.status >= 500 ? `伺服器暫時有問題，請稍後再試。${hint}` : '發生錯誤，請稍後再試。' };
  }
}

/** 是不是「額度不足、要看重置時間」的錯誤（呼叫端可以先去拿 quota 再顯示）。 */
export function isQuotaError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.code === 'quota_day' || error.code === 'quota_month');
}

/** 批改失敗（status='failed'）的原因；點數一律全額退還。 */
export const REFUND_REASON_MESSAGES: Record<AiRefundReason, string> = {
  refusal: 'AI 無法批改這份內容',
  invalid_output: 'AI 回傳的結果格式有問題',
  max_tokens: 'AI 回覆太長被截斷',
  api_error: 'AI 服務暫時發生錯誤',
  timeout: 'AI 回應逾時',
  paused: 'AI 功能暫停中，排隊中的批改已取消（最晚台灣時間明天 00:00 恢復）',
  expired: '排隊太久已取消',
  internal: '系統發生錯誤',
};

export function refundReasonMessage(reason: string | null): string {
  if (reason !== null && (AI_REFUND_REASONS as readonly string[]).includes(reason)) {
    return REFUND_REASON_MESSAGES[reason as AiRefundReason];
  }
  return '批改沒有完成';
}
