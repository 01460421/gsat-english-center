/**
 * GET /api/features：公開的功能開關（@gsat/shared 的 FeaturesResponse）。前端依它決定要不要顯示登入與 AI 按鈕。
 *
 * 只回布林：這支不用登入，任何人都讀得到，所以絕不回設定值或金鑰片段。
 * aiPaused 讀今天（台灣日期）的 ai_budget_daily.paused；查詢失敗（例如遷移還沒套用）時當成暫停，
 * 寧可不顯示 AI 按鈕，也不要讓學生按了才收到錯誤。
 */
import { FEATURES_OFF, type FeaturesResponse } from '@gsat/shared';
import { Hono } from 'hono';
import { loadConfig } from './config';
import type { AppEnv, Env } from './env';
import { taiwanDay } from './time';

/** 讀全站暫停開關。AI 沒設定時不查 DB（也就不需要資料表存在）。 */
export async function isAiPaused(env: Env, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT paused FROM ai_budget_daily WHERE tw_day = ?')
      .bind(taiwanDay(nowMs))
      .first<{ paused: number }>();
    return row?.paused === 1;
  } catch (err) {
    console.error('讀取 ai_budget_daily.paused 失敗，視為暫停', err);
    return true;
  }
}

export async function computeFeatures(env: Env): Promise<FeaturesResponse> {
  const config = loadConfig(env);
  if (!config.auth.configured) return { ...FEATURES_OFF };
  const ai = config.ai.configured;
  return {
    auth: true,
    ai,
    // MVP 的照片暫存在 D1，不需要另外的綁定：AI 能用，OCR 就能用。
    ocr: ai,
    aiPaused: ai ? await isAiPaused(env) : false,
  };
}

export const featureRoutes = new Hono<AppEnv>();

featureRoutes.get('/', async (c) => c.json(await computeFeatures(c.env)));
