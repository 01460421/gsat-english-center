/**
 * 學習助手端點共用的登入與「AI 核准＋開關」檢查（docs/design/learning-assistant.md §4.1、§4.4；從 routes.ts 抽出，報告的端點
 * reports.ts 共用）。檢查順序：登入 → 開關（AI_ASSISTANT 是 on，或 admin 而這位是管理員；否則 503，公開端點不透露有預覽）
 * → AI 核准（未核准 403、待同意 403 consent_required）→ AI 已設定 → D8 指紋可用（壞掉 503）。
 */
import { AI_ERROR_MESSAGES } from '@gsat/shared';
import type { Context } from 'hono';
import { requireD8Fingerprints, type D8Fingerprints } from '../ai/d8';
import { assertAiApproved, getSessionUser, type SessionUser } from '../auth/session';
import { loadConfig, type AppConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { assistantAccess } from '../features';

export async function sessionUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  return user;
}

/** 寫入類端點的開關、核准、設定與 D8 檢查（順序見檔頭）。 */
export async function writeGate(c: Context<AppEnv>): Promise<{ user: SessionUser; config: AppConfig; fp: D8Fingerprints }> {
  const user = await sessionUser(c);
  const config = loadConfig(c.env);
  if (!assistantAccess(config, user.role).enabled) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  assertAiApproved(user);
  if (!config.ai.configured || !c.env.AI_QUEUE) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  const fp = await requireD8Fingerprints(c.env.DB);
  if (!fp) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  return { user, config, fp };
}
