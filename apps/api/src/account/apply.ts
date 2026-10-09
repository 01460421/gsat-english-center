/**
 * POST /api/ai/apply：申請 AI 功能（SPEC §8.2、ARCHITECTURE §10.4）。負責：後端登入 A1。
 *
 * 路徑在 /api/ai 底下，但寫入的是 users.ai_status 與 consents（帳號與核准流程），所以放在 account 模組，
 * 由 app.ts 掛在 /api/ai/apply；其他 /api/ai/* 在 src/ai/routes.ts（A2）。兩個檔案分開，兩位 agent 不會改到同一個檔。
 *
 *   AiApplyBody → AiApplyResponse（requireUser）。
 *   - ai_consent_version 必須是現行 AI_CONSENT_VERSION（否則 400）；記 ai_processing 同意，未滿 18 歲必須 guardian_ack=true
 *     並另記 guardian_ack 同意。年齡區間還沒填 → 403 consent_required（先完成首次設定）。
 *   - none／rejected／pending／waitlist：算一次申請（冷卻 60 秒、每帳號最多 10 次，超過 429 rate_limited），
 *     名額（config.ai.approvalCap，預設自動計算 49）已滿 → waitlist，否則 → pending。名額判斷與狀態更新在同一句 SQL。
 *   - approved（或管理員）：不改狀態、不算次數，只補記同意（AI_CONSENT_VERSION 改版後的「重新同意」走這裡也可以）。
 *   - suspended（AI 被停用）：409 conflict。
 *   MVP 沒有自動核准（邀請碼延後）：invite_code 送了也忽略。§6.3 啟動檢查不通過也只影響管理員核准，申請照收。
 * 同意紀錄與狀態更新放在同一個 db.batch()（交易），條件不成立時三句都不生效。
 */
import { AI_APPLY_COOLDOWN_SECONDS, AI_APPLY_MAX_COUNT, AI_APPLY_NOTE_MAX, type AiApplyResponse } from '@gsat/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { nowSeconds } from '../time';
import { getSessionUser, reloadSessionUser, requireUser } from '../auth/session';
import { APPROVED_STUDENT_SQL } from './approval';
import { cleanMultiLine, codePointLength, readJsonBody } from './validate';

export const aiApplyRoutes = new Hono<AppEnv>();

const applySchema = z.object({
  note: z.string().max(3000),
  ai_consent_version: z.string().min(1).max(64),
  guardian_ack: z.boolean(),
  invite_code: z.string().max(200).optional(),
});

aiApplyRoutes.post('/', requireUser(), async (c) => {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  const body = await readJsonBody(c, applySchema);
  const config = loadConfig(c.env);

  if (body.ai_consent_version !== config.consentVersions.ai) {
    throw new ApiError(400, 'bad_request', 'AI 資料處理說明已更新，請重新整理頁面後再同意');
  }
  if (user.ageBand === null) throw new ApiError(403, 'consent_required', '請先完成首次設定（年齡區間）');
  const under18 = user.ageBand === 'under18';
  if (under18 && !body.guardian_ack) {
    throw new ApiError(400, 'bad_request', '未滿 18 歲需要先告知法定代理人並取得同意');
  }
  const note = cleanMultiLine(body.note);
  if (note !== null && codePointLength(note) > AI_APPLY_NOTE_MAX) {
    throw new ApiError(400, 'bad_request', `申請說明最多 ${AI_APPLY_NOTE_MAX} 個字`);
  }
  if (user.aiStatus === 'suspended') throw new ApiError(409, 'conflict', 'AI 功能已被停用，不能重新申請');

  const db = c.env.DB;
  const now = nowSeconds();
  const version = config.consentVersions.ai;
  const alreadyApproved = user.aiStatus === 'approved' || user.role === 'admin';

  // 條件（常數 SQL）：冷卻、狀態；一般申請另加次數上限。三句共用，batch 裡看到的是同一個狀態。
  const predicate = alreadyApproved
    ? "id = ? AND status = 'active' AND (ai_status = 'approved' OR role = 'admin') AND (ai_applied_at IS NULL OR ai_applied_at <= ?)"
    : `id = ? AND status = 'active' AND ai_status IN ('none','pending','waitlist','rejected')
       AND ai_apply_count < ${AI_APPLY_MAX_COUNT} AND (ai_applied_at IS NULL OR ai_applied_at <= ?)`;
  const predicateParams = [user.id, now - AI_APPLY_COOLDOWN_SECONDS];

  const consent = (kind: 'ai_processing' | 'guardian_ack') =>
    db
      .prepare(
        `INSERT INTO consents (user_id, kind, version, granted, created_at)
         SELECT id, ?, ?, 1, ? FROM users WHERE ${predicate}`,
      )
      .bind(kind, version, now, ...predicateParams);

  const update = alreadyApproved
    ? db
        .prepare(
          `UPDATE users SET ai_applied_at = ?,
             ai_status = 'approved',
             ai_tier = CASE WHEN role = 'admin' THEN 'unlimited' ELSE ai_tier END
           WHERE ${predicate}`,
        )
        .bind(now, ...predicateParams)
    : db
        .prepare(
          `UPDATE users SET
             ai_status = CASE WHEN (SELECT COUNT(*) FROM users WHERE ${APPROVED_STUDENT_SQL}) >= ? THEN 'waitlist' ELSE 'pending' END,
             ai_apply_count = ai_apply_count + 1,
             ai_applied_at = ?,
             ai_apply_note = ?
           WHERE ${predicate}`,
        )
        .bind(config.ai.approvalCap, now, note, ...predicateParams);

  const statements = [consent('ai_processing'), ...(under18 ? [consent('guardian_ack')] : []), update];
  const results = await db.batch(statements);
  const changed = results[results.length - 1]?.meta.changes ?? 0;

  if (changed !== 1) {
    // 沒更新到：找出是哪個條件擋下，回固定的錯誤碼。
    const row = await db
      .prepare('SELECT ai_status, ai_apply_count, ai_applied_at FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ ai_status: string; ai_apply_count: number; ai_applied_at: number | null }>();
    if (row && row.ai_applied_at !== null && row.ai_applied_at > now - AI_APPLY_COOLDOWN_SECONDS) {
      const wait = row.ai_applied_at + AI_APPLY_COOLDOWN_SECONDS - now;
      throw new ApiError(429, 'rate_limited', `請稍候 ${wait} 秒再申請`);
    }
    if (row && row.ai_apply_count >= AI_APPLY_MAX_COUNT && !alreadyApproved) {
      throw new ApiError(429, 'rate_limited', `申請次數已達上限（${AI_APPLY_MAX_COUNT} 次）`);
    }
    throw new ApiError(409, 'conflict', '目前的狀態不能申請，請重新整理頁面');
  }

  const fresh = await reloadSessionUser(c, user.id, user.loginAt);
  const response: AiApplyResponse = { ai_status: fresh?.aiStatus ?? user.aiStatus };
  return c.json(response);
});
