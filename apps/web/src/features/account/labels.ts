/**
 * 帳號、AI 申請與後台共用的中文標籤。列舉值來自 @gsat/shared（account.ts、writing.ts），
 * 用 Record<列舉, string> 對照：共用型別新增值時 tsc 會要求這裡補上文案。
 */
import type { AdminUserAction, AgeBand, AiStatus, AiTask, AiTier, AuthErrorCode, StartupCheck, UserRole } from '@gsat/shared';

export const AI_STATUS_LABELS: Record<AiStatus, string> = {
  none: '尚未申請',
  pending: '審核中',
  waitlist: '候補中',
  approved: '已核准',
  rejected: '未通過',
  suspended: '已停用',
};

/** 申請頁與帳號頁的狀態說明（SPEC §8.2）。 */
export const AI_STATUS_DESCRIPTIONS: Record<AiStatus, string> = {
  none: '你還沒有申請 AI 批改。申請通過後，就能讓 AI 批改中譯英與英文作文。',
  pending: '已收到你的申請，正在等站主審核。核准後重新整理這一頁就能開始使用。',
  waitlist: '本月的 AI 批改名額已滿，你已排入候補。有名額時會依申請順序核准。',
  approved: '你的 AI 批改已核准，可以在「寫作練習」使用中譯英與英文作文的 AI 批改。',
  rejected: '這次的申請沒有通過。你可以補充用途說明後再申請一次。',
  suspended: '你的 AI 批改目前已停用，帳號的其他功能不受影響。如有疑問請聯絡站主。',
};

/** 狀態徽章的配色（只用語意化顏色；文字本身就說明狀態，顏色不是唯一的資訊來源）。 */
export const AI_STATUS_BADGE: Record<AiStatus, string> = {
  none: 'bg-surface-2 text-muted',
  pending: 'bg-badge-bg text-badge-fg',
  waitlist: 'bg-badge-bg text-badge-fg',
  approved: 'bg-primary-soft text-primary',
  rejected: 'bg-surface-2 text-bad',
  suspended: 'bg-surface-2 text-bad',
};

export const AI_TIER_LABELS: Record<AiTier, string> = {
  trial: '試用',
  standard: '一般',
  unlimited: '不限點數（管理員）',
};

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  under18: '未滿 18 歲',
  '18plus': '18 歲以上',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  student: '學生',
  admin: '管理員',
};

export const AI_TASK_LABELS: Record<AiTask, string> = {
  translation_grade: '中譯英批改',
  essay_grade: '英文作文批改',
  essay_ocr: '手寫作文照片辨識',
};

/** /auth/google/callback 失敗時帶回 /account?auth_error=<代碼>。 */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  state: '登入連結已失效或逾時（可能是重複點了登入，或同時開了太多分頁）。請再登入一次。',
  denied: '你在 Google 畫面取消了登入。',
  unverified: '這個 Google 帳號的電子郵件還沒有驗證，請改用已驗證的帳號。',
  suspended: '這個帳號已停權，無法登入。',
  google: 'Google 登入暫時發生問題，請稍後再試。',
  not_configured: '登入功能尚未開放。',
};

/**
 * 後台動作（ADMIN_USER_ACTIONS 的註解）：全部是 AI 狀態的變更。suspend＝停用 AI（帳號照常登入），unsuspend＝恢復成已核准
 * （和核准一樣檢查名額與啟動檢查）。帳號層級的停權 MVP 沒有後台按鈕。
 */
export const ADMIN_ACTION_LABELS: Record<AdminUserAction, string> = {
  approve: '核准',
  reject: '拒絕',
  waitlist: '排入候補',
  suspend: '停用 AI',
  unsuspend: '恢復 AI',
};

/** 操作成功後的提示（「已核准：小明」）。 */
export const ADMIN_ACTION_DONE: Record<AdminUserAction, string> = {
  approve: '已核准',
  reject: '已拒絕',
  waitlist: '已排入候補',
  suspend: '已停用 AI',
  unsuspend: '已恢復 AI',
};

/**
 * 各 AI 狀態下可以按的動作（最後是否允許仍由後端判斷）。從未申請（none）的人後端允許直接核准，
 * 但要等他本人同意 AI 處理說明才能真的用（pending_ai_consents）；reject／waitlist 對 none 回 409，所以不給按鈕。
 */
export const ADMIN_ACTIONS_FOR_STATUS: Record<AiStatus, readonly AdminUserAction[]> = {
  none: ['approve'],
  pending: ['approve', 'waitlist', 'reject'],
  waitlist: ['approve', 'reject'],
  approved: ['suspend'],
  rejected: ['approve', 'waitlist'],
  suspended: ['unsuspend'],
};

/** §6.3 啟動檢查的名稱（detail 由後端給，含實際數字）。 */
export const STARTUP_CHECK_LABELS: Record<StartupCheck['id'], string> = {
  site_vs_online: '站內月預算＋日預算 ≤ Anthropic online 上限',
  workspaces_vs_tier: '各 workspace 上限總和 ≤ 用量級距上限',
  daily_vs_monthly: '日預算 × 31 ≥ 月預算的一半（提醒）',
};
