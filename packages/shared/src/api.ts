/**
 * 前端與 Worker 之間的 API 回應格式。放在共用套件，是為了讓兩邊改格式時 tsc 會一起報錯，
 * 而不是等到線上才發現前端讀不到欄位。
 */

/** GET /api/health 的回應。 */
export interface HealthResponse {
  ok: true;
  /** 服務名稱，與 wrangler.toml 的 name 相同。 */
  service: string;
  /** Worker 的版本（apps/api/package.json 的 version）。 */
  version: string;
  /** 伺服器時間（ISO 8601，UTC）。 */
  time: string;
}

/**
 * 判斷一個未知的 JSON 值是不是健康檢查回應。
 * 前端不能只靠型別斷言：買網域前 /api 經過 Vercel rewrites 轉送，設定錯誤時可能拿到 SPA 的
 * index.html 或代理的錯誤頁，形狀不對就要當成「後端未連線」，而不是在畫面上印出 undefined。
 */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['ok'] === true && typeof v['service'] === 'string' && typeof v['version'] === 'string' && typeof v['time'] === 'string';
}

/**
 * 錯誤代碼。前端依代碼決定要顯示什麼文案，不直接顯示 message（message 只給開發者看）。
 * 之後加新的錯誤情境時，在這裡補代碼，前端的對照表就會被 tsc 要求補齊。
 */
export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'bad_origin',
  'not_found',
  'method_not_allowed',
  'payload_too_large',
  'rate_limited',
  'internal_error',
  // ── 帳號與登入（account.ts；ARCHITECTURE §5）──
  /** 功能所需的機密或設定沒填（例如還沒設 GOOGLE_CLIENT_ID）；前端也把「回應不是 JSON」當成這個代碼。 */
  'not_configured',
  /** 骨架階段尚未實作的端點（501）。 */
  'not_implemented',
  /** 還沒完成首次同意，或條款改版後尚未重新同意（403）。 */
  'consent_required',
  /** 敏感操作（刪帳號、匯出、後台寫入）要求近期登入，session 的 iat 太舊（401）。 */
  'reauth_required',
  /** 帳號已停權或刪除中（403）。 */
  'account_suspended',
  /** 狀態不允許這個動作，例如提交已在批改中又要修改（409）。 */
  'conflict',
  // ── AI 額度與狀態（writing.ts 的 AI_RESERVE_ERROR_CODES；ARCHITECTURE §6.4）──
  /** 今日點數不足（429）。 */
  'quota_day',
  /** 本月點數不足（429）。 */
  'quota_month',
  /** 任務家族的每日篇數已滿，例如作文每天 3 篇（429）。 */
  'daily_limit',
  /** 同時進行中的 AI 任務已達上限（429）。 */
  'busy',
  /** 後台全站暫停中（503）。 */
  'ai_paused',
  /** 全站今日或本月美元預算用完（503）。 */
  'site_budget',
  /** AI 功能尚未核准（403）。 */
  'not_approved',
  // ── 自訂作文題目（custom-essay.ts；docs/design/custom-essay.md §2.5）──
  /** 自訂作文題目不符合規則（400）；error.reason 是 CustomPromptProblem，error.field 是欄位，內容規則另附 error.ranges。 */
  'custom_prompt_invalid',
  /** 自訂題的作文還不能送 AI 批改（400）；error.reason 是 EssayNotGradableReason，error.field 是 'essay'。 */
  'essay_not_gradable',
  // ── 學習助手（assist.ts；docs/design/learning-assistant.md §4.2）──
  /** 學習助手的輸入不符合規則（400）；error.reason 是 AssistInputProblem，error.field 是欄位，D8 與 official_like 命中另附 error.ranges。 */
  'assist_input_invalid',
  /**
   * 讀不到這一題（409 版本已更新或下架、502 題目檔暫時讀不到、400 這種題目不支援）；error.reason 是 'gone' | 'unreachable' | 'unsupported'，
   * 出版社題另有 'source_no_ai'（400，授權不含 AI 解析）與 'source_ended'（409，授權已經結束；docs/design/weak-paper.md §9.6）。
   */
  'assist_source_unavailable',
  /** 學習助手的數量上限（429）；error.reason 是 'cases_per_day' | 'cases_live' | 'analyses_per_case' | 'followups_per_case' | 'photos'。 */
  'assist_limit',
  // ── 作文範文（exemplars.ts；docs/design/model-essays.md §7.2）──
  /** 學生貼的題目和網站上的題目相同（409）；error.group_id、error.title 是網站題目的代號與標題。帶 allow_custom 就不再比對。 */
  'exemplar_site_match',
  /** 這一題目前不提供範文（409；白名單以外的題組）。 */
  'exemplar_unavailable',
  /** 作文範文的數量上限（429）；error.reason 是 'sets_per_day' | 'sets_stored'。 */
  'exemplar_limit',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 所有錯誤回應的統一格式：`{ "error": { "code": "...", "message": "..." } }`。 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** 選填：更細的原因代碼（custom_prompt_invalid、essay_not_gradable、學習助手的三個代碼、daily_limit 會帶）。 */
    reason?: string;
    /** 選填：出問題的欄位（CustomPromptField、'essay'，或學習助手的欄位，例如 'blocks[0].text'）。 */
    field?: string;
    /**
     * 選填：命中處在學生自己文字裡的位置（正規化後的 UTF-16 索引，[start, end)，最多 5 段）。
     * 只是位置，不含任何受保護文字（D8）。
     */
    ranges?: Array<[number, number]>;
    /** 選填：exemplar_site_match 時相同的網站題目（題組代號與標題；docs/design/model-essays.md §5.3）。 */
    group_id?: string;
    title?: string;
  };
}

/**
 * 判斷一個未知的 JSON 值是不是統一格式的錯誤回應。
 * code 必須是 API_ERROR_CODES 裡的值，不能只檢查是字串：型別守衛宣稱 code 是 ApiErrorCode，
 * 前端會拿它去查文案對照表；收到不認得的代碼（例如後端先部署了新代碼）就當成「不是統一格式」，
 * 由呼叫端退回用 HTTP 狀態碼處理，而不是查表查到 undefined。
 */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err: unknown = value.error;
  if (typeof err !== 'object' || err === null || !('code' in err) || !('message' in err)) return false;
  return (API_ERROR_CODES as readonly unknown[]).includes(err.code) && typeof err.message === 'string';
}
