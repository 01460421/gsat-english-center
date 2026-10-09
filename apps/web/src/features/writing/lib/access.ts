/**
 * 現在能不能用 AI 批改，以及不能用時要告訴學生怎麼開通（SPEC §8.1–8.2；設計文件 §1.1）。
 *
 * 判斷順序：
 *   1. 後端沒部署、登入或 AI 機密沒設（features.auth／ai 為 false）→ off：按鈕隱藏，顯示「即將開放」，其他功能照常。
 *   2. 未登入 → signed_out（連到 Google 登入，登入後回到原頁）。
 *   3. 帳號停權 → account_suspended。
 *   4. 首次同意未完成、年齡區間沒填或條款改版 → consent（連到 /account/welcome）。
 *   5. AI 未核准 → apply（依 ai_status 說明：未申請、審核中、候補、被拒、停用）。
 *   6. 已核准但 AI 資料處理說明改版、還沒重新同意（pending_ai_consents 非空）→ ai_consent（連到 /ai/apply 重新同意；
 *      這時 AI 端點會回 403 consent_required）。
 *   7. 已核准但全站暫停 → paused。
 *   8. ready。
 */
import type { AiStatus, FeaturesResponse, MeResponse } from '@gsat/shared';
import { needsOnboarding, useFeatures, useMe } from '../../../lib/api';

export type AiAccess =
  | { state: 'loading' }
  | { state: 'off' }
  | { state: 'signed_out' }
  | { state: 'account_suspended' }
  | { state: 'consent' }
  | { state: 'apply'; aiStatus: Exclude<AiStatus, 'approved'> }
  | { state: 'ai_consent' }
  | { state: 'paused' }
  | { state: 'ready'; ocr: boolean };

export function aiAccessOf(features: FeaturesResponse, me: MeResponse, loading: boolean): AiAccess {
  if (loading) return { state: 'loading' };
  if (!features.auth || !features.ai) return { state: 'off' };
  if (!me.user) return { state: 'signed_out' };
  if (me.user.status !== 'active') return { state: 'account_suspended' };
  if (needsOnboarding(me)) return { state: 'consent' };
  const aiStatus = me.user.ai_status;
  if (aiStatus !== 'approved') return { state: 'apply', aiStatus };
  if ((me.pending_ai_consents ?? []).length > 0) return { state: 'ai_consent' };
  if (features.aiPaused) return { state: 'paused' };
  return { state: 'ready', ocr: features.ocr };
}

export function useAiAccess(): AiAccess {
  const features = useFeatures();
  const { me, loading } = useMe();
  return aiAccessOf(features, me, loading);
}

/** 已登入（不論 AI 是否核准）：可以看「我的寫作紀錄」。 */
export function useSignedIn(): boolean {
  const features = useFeatures();
  const { me, loading } = useMe();
  return !loading && features.auth && me.user !== null && me.user.status === 'active' && !needsOnboarding(me);
}
