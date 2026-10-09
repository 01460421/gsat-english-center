/**
 * GET /api/features：公開的功能開關。前端依它決定要不要顯示登入按鈕與 AI 按鈕。
 *
 * 只回布林，不回任何設定值或金鑰片段：這支端點不用登入，任何人都讀得到。
 * 判斷規則（apps/api/src/features.ts）：
 *   auth     GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET 都有設
 *   ai       auth 為 true 且 ANTHROPIC_API_KEY 有設（暫停中仍為 true，暫停另看 aiPaused）
 *   ocr      ai 為 true（MVP 的照片暫存在 D1，不需要另外的 R2 綁定）
 *   aiPaused 後台的全站暫停開關（今天的 ai_budget_daily.paused）
 *
 * Worker 還沒部署時，Vercel 代理會回 HTML 或 404：前端 api() 包裝把它當成 not_configured，
 * 改用 FEATURES_OFF，整站照常運作，只是不顯示登入與 AI。
 */
export interface FeaturesResponse {
  auth: boolean;
  ai: boolean;
  ocr: boolean;
  aiPaused: boolean;
}

/** 後端連不上或未設定時的預設值：全部關閉。 */
export const FEATURES_OFF: FeaturesResponse = Object.freeze({ auth: false, ai: false, ocr: false, aiPaused: false });

/** 型別守衛：四個欄位都必須是布林（代理回的 HTML、舊版回應都不算）。 */
export function isFeaturesResponse(value: unknown): value is FeaturesResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['auth'] === 'boolean' &&
    typeof v['ai'] === 'boolean' &&
    typeof v['ocr'] === 'boolean' &&
    typeof v['aiPaused'] === 'boolean'
  );
}
