/**
 * GET /api/features：公開的功能開關（@gsat/shared 的 FeaturesResponse）。前端依它決定要不要顯示登入與 AI 按鈕。
 *
 * 只回布林：這支不用登入，任何人都讀得到，所以絕不回設定值或金鑰片段。
 * customEssay＝ai 而且 AI_CUSTOM_ESSAY 是 on（D8 指紋檔壞掉時自訂題的端點另外回 503，這裡不查：公開端點不讀指紋檔）。
 * assistant＝ai 而且 AI_ASSISTANT 是 on；assistantPhoto＝assistant 有值而且 AI_ASSISTANT_PHOTO 也是 on。兩個欄位只在 on 時
 * 出現（值一定是 true）：admin 模式（只有管理員能用）不回任何欄位，公開端點不透露；管理員的使用資格在要登入的
 * /api/me（assistant_preview，src/account/routes.ts）。對某位使用者開不開一律問 assistantAccess（學習助手的端點也用它）。
 * aiPaused 讀今天（台灣日期）的 ai_budget_daily.paused；查詢失敗（例如遷移還沒套用）時當成暫停，
 * 寧可不顯示 AI 按鈕，也不要讓學生按了才收到錯誤。
 */
import { FEATURES_OFF, type FeaturesResponse, type UserRole } from '@gsat/shared';
import { Hono } from 'hono';
import { loadConfig, type AppConfig } from './config';
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
    // 英文作文自訂題目：AI 能用而且總開關 AI_CUSTOM_ESSAY 是 on（docs/design/custom-essay.md §5.3）。
    customEssay: ai && config.ai.customEssay,
    // 學習助手：只在對所有人開放（on）時出現；關著或只有管理員預覽（admin）時，回應和沒有這個功能時逐字相同。
    ...(ai && config.ai.assistant === 'on' ? { assistant: true, ...(config.ai.assistantPhoto === 'on' ? { assistantPhoto: true } : {}) } : {}),
  };
}

/**
 * 學習助手對這位使用者開不開（docs/design/learning-assistant.md §4.14）：AI 已設定，而且開關是 on，或是 admin 而這位是管理員。
 * photo 另外要拍照開關同樣成立（on，或 admin 而這位是管理員）。role 是 null＝沒登入（只看得到 on 的公開開放）。
 * 學習助手的寫入端點、/api/me 的預覽資格、/api/ai/quota 的 assist 都用這一支，開關的規則只寫一份。
 */
export function assistantAccess(config: AppConfig, role: UserRole | null): { enabled: boolean; photo: boolean } {
  const allows = (mode: AppConfig['ai']['assistant']) => mode === 'on' || (mode === 'admin' && role === 'admin');
  const enabled = config.ai.configured && allows(config.ai.assistant);
  return { enabled, photo: enabled && allows(config.ai.assistantPhoto) };
}

/**
 * /api/me 的 assistant_preview：學習助手（或它的拍照）是 admin 模式、這位是管理員、而且學習助手對他開放時才有。
 * 開關是 on 的部分前端看 /api/features，所以全部是 on 時沒有這個欄位（回應和沒有這個功能時相同）。
 */
export function assistantPreview(config: AppConfig, role: UserRole): { photo: boolean } | null {
  if (role !== 'admin') return null;
  if (config.ai.assistant !== 'admin' && config.ai.assistantPhoto !== 'admin') return null;
  const access = assistantAccess(config, role);
  return access.enabled ? { photo: access.photo } : null;
}

export const featureRoutes = new Hono<AppEnv>();

featureRoutes.get('/', async (c) => c.json(await computeFeatures(c.env)));
