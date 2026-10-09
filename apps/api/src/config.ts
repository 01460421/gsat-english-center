/**
 * 設定的唯一讀取點：所有預設值集中在這裡（ARCHITECTURE §11 最後一段；避免 Sekai「wrangler.toml 與程式預設值不一致」）。
 *
 * 路由與業務邏輯一律呼叫 loadConfig(c.env)，不直接讀 c.env 的設定值。
 * 預設值與 wrangler.toml 的 [vars] 相同（§6.3「正式開放」的值）；wrangler.toml 是給站主看的「實際部署值」，
 * 這裡的預設值是 [vars] 漏設時的保險。兩邊一致由 test/config.test.ts 檢查。
 *
 * 機密只回「有沒有設」與值本身（給需要的模組用），**絕不放進任何回應**；/api/features、/api/admin/health 只回布林。
 */
import type { Env } from './env';

/** effort 等級（ARCHITECTURE §6.2 第 3 條：每個任務明確設定，不靠模型預設）。 */
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

/** 預設值（字串形式與 wrangler.toml 的 [vars] 對照）。 */
export const CONFIG_DEFAULTS = {
  PRIVACY_POLICY_VERSION: '2026-10-08',
  TERMS_VERSION: '2026-10-08',
  AI_CONSENT_VERSION: '2026-10-08',
  AI_MODEL_DEFAULT: 'claude-opus-5-5',
  AI_MODEL_SECOND_RATER: 'claude-opus-5-5',
  AI_EFFORT_GRADE: 'medium',
  AI_EFFORT_OCR: 'low',
  AI_POINTS_USER_DAY: 30,
  AI_POINTS_USER_MONTH: 300,
  AI_POINTS_TRIAL_DAY: 10,
  AI_ESSAY_USER_DAY: 3,
  AI_CONCURRENT_USER: 2,
  AI_BUDGET_SITE_USD_DAY: 20,
  AI_BUDGET_SITE_USD_MONTH: 400,
  ANTHROPIC_ONLINE_SPEND_LIMIT_USD: 450,
  ANTHROPIC_PIPELINE_SPEND_LIMIT_USD: 0,
  ANTHROPIC_DEV_SPEND_LIMIT_USD: 50,
  ANTHROPIC_TIER_LIMIT_USD: 500,
} as const;

/** 官方端點（測試可用 env 覆寫）。 */
export const DEFAULT_ENDPOINTS = {
  googleAuthUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  googleTokenUrl: 'https://oauth2.googleapis.com/token',
  googleUserinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  anthropicBaseUrl: 'https://api.anthropic.com',
} as const;

/**
 * 每點成本的最壞值（美元）：各任務「估計平均成本 ÷ 點數」的最大值，essay_grade 0.19 ÷ 7（ARCHITECTURE §6.1、§6.6）。
 * 換模型或調 effort 後依實測重算，改這裡。
 */
export const WORST_USD_PER_POINT = 0.19 / 7;

/**
 * 核准名額自動計算（ARCHITECTURE §6.6）：⌊站內月預算 ÷（每人每月點數上限 × 每點最壞美元）⌋。
 * 預設 ⌊400 ÷ (300 × 0.0271…)⌋ ＝ 49。分母為 0 或非正數時回 0（不核准任何人，fail closed）。
 */
export function autoApprovalCap(siteMonthUsd: number, pointsPerUserMonth: number, worstUsdPerPoint = WORST_USD_PER_POINT): number {
  const perUser = pointsPerUserMonth * worstUsdPerPoint;
  if (!(siteMonthUsd > 0) || !(perUser > 0)) return 0;
  return Math.floor(siteMonthUsd / perUser);
}

export interface AppConfig {
  urls: {
    /** 前端網址；未設定時為 null（登入流程視為 not_configured）。 */
    appOrigin: string | null;
    /** OAuth 回呼與 cookie 的基準；未設定時同 appOrigin。 */
    publicApiOrigin: string | null;
  };
  auth: {
    /** GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、SESSION_SECRET、APP_ORIGIN 都有設。 */
    configured: boolean;
    googleClientId: string | null;
    googleClientSecret: string | null;
    sessionSecret: string | null;
    /** 小寫、去空白。 */
    adminEmail: string | null;
    ledgerSalt: string | null;
    endpoints: { googleAuthUrl: string; googleTokenUrl: string; googleUserinfoUrl: string };
  };
  consentVersions: { privacy: string; terms: string; ai: string };
  ai: {
    /** auth.configured 且 ANTHROPIC_API_KEY、AI_QUEUE 都有。 */
    configured: boolean;
    apiKey: string | null;
    baseUrl: string;
    models: { default: string; secondRater: string };
    effort: { grade: AiEffort; ocr: AiEffort };
    limits: {
      pointsUserDay: number;
      pointsUserMonth: number;
      pointsTrialDay: number;
      essayUserDay: number;
      concurrentUser: number;
    };
    budget: {
      siteUsdDay: number;
      siteUsdMonth: number;
      onlineSpendLimitUsd: number;
      pipelineSpendLimitUsd: number;
      devSpendLimitUsd: number;
      tierLimitUsd: number;
    };
    /** AI_APPROVAL_CAP 有設就用它，否則 autoApprovalCap()。 */
    approvalCap: number;
    approvalCapIsAuto: boolean;
  };
}

/** 空字串、只有空白都視為沒設（wrangler secret 刪不乾淨或 .dev.vars 留空行時常見）。 */
function str(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** 解析非負數；格式不對就用預設值並寫 log（不讓一個打錯的變數把整支 Worker 弄壞）。 */
function num(name: string, value: string | undefined, fallback: number): number {
  const v = str(value);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`設定 ${name}=${JSON.stringify(v)} 不是非負數，改用預設值 ${fallback}`);
    return fallback;
  }
  return n;
}

function effort(name: string, value: string | undefined, fallback: AiEffort): AiEffort {
  const v = str(value);
  if (v === null) return fallback;
  if ((AI_EFFORTS as readonly string[]).includes(v)) return v as AiEffort;
  console.warn(`設定 ${name}=${JSON.stringify(v)} 不是合法的 effort，改用預設值 ${fallback}`);
  return fallback;
}

function origin(value: string | undefined): string | null {
  const v = str(value);
  return v ? v.replace(/\/+$/, '') : null;
}

/** 讀取設定。純函式、成本很低，每個請求呼叫一次即可（不做跨請求快取，env 在測試中會換）。 */
export function loadConfig(env: Env): AppConfig {
  const D = CONFIG_DEFAULTS;
  const appOrigin = origin(env.APP_ORIGIN);
  const publicApiOrigin = origin(env.PUBLIC_API_ORIGIN) ?? appOrigin;
  const googleClientId = str(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = str(env.GOOGLE_CLIENT_SECRET);
  const sessionSecret = str(env.SESSION_SECRET);
  const authConfigured = Boolean(googleClientId && googleClientSecret && sessionSecret && appOrigin);
  const apiKey = str(env.ANTHROPIC_API_KEY);

  const pointsUserMonth = num('AI_POINTS_USER_MONTH', env.AI_POINTS_USER_MONTH, D.AI_POINTS_USER_MONTH);
  const siteUsdMonth = num('AI_BUDGET_SITE_USD_MONTH', env.AI_BUDGET_SITE_USD_MONTH, D.AI_BUDGET_SITE_USD_MONTH);
  const capOverride = str(env.AI_APPROVAL_CAP);
  const approvalCap = capOverride === null ? autoApprovalCap(siteUsdMonth, pointsUserMonth) : Math.floor(num('AI_APPROVAL_CAP', capOverride, 0));

  return {
    urls: { appOrigin, publicApiOrigin },
    auth: {
      configured: authConfigured,
      googleClientId,
      googleClientSecret,
      sessionSecret,
      adminEmail: str(env.ADMIN_EMAIL)?.toLowerCase() ?? null,
      ledgerSalt: str(env.LEDGER_SALT),
      endpoints: {
        googleAuthUrl: str(env.GOOGLE_OAUTH_AUTH_URL) ?? DEFAULT_ENDPOINTS.googleAuthUrl,
        googleTokenUrl: str(env.GOOGLE_TOKEN_URL) ?? DEFAULT_ENDPOINTS.googleTokenUrl,
        googleUserinfoUrl: str(env.GOOGLE_USERINFO_URL) ?? DEFAULT_ENDPOINTS.googleUserinfoUrl,
      },
    },
    consentVersions: {
      privacy: str(env.PRIVACY_POLICY_VERSION) ?? D.PRIVACY_POLICY_VERSION,
      terms: str(env.TERMS_VERSION) ?? D.TERMS_VERSION,
      ai: str(env.AI_CONSENT_VERSION) ?? D.AI_CONSENT_VERSION,
    },
    ai: {
      configured: authConfigured && apiKey !== null && env.AI_QUEUE !== undefined,
      apiKey,
      baseUrl: str(env.ANTHROPIC_BASE_URL) ?? DEFAULT_ENDPOINTS.anthropicBaseUrl,
      models: {
        default: str(env.AI_MODEL_DEFAULT) ?? D.AI_MODEL_DEFAULT,
        secondRater: str(env.AI_MODEL_SECOND_RATER) ?? D.AI_MODEL_SECOND_RATER,
      },
      effort: {
        grade: effort('AI_EFFORT_GRADE', env.AI_EFFORT_GRADE, D.AI_EFFORT_GRADE),
        ocr: effort('AI_EFFORT_OCR', env.AI_EFFORT_OCR, D.AI_EFFORT_OCR),
      },
      limits: {
        pointsUserDay: num('AI_POINTS_USER_DAY', env.AI_POINTS_USER_DAY, D.AI_POINTS_USER_DAY),
        pointsUserMonth,
        pointsTrialDay: num('AI_POINTS_TRIAL_DAY', env.AI_POINTS_TRIAL_DAY, D.AI_POINTS_TRIAL_DAY),
        essayUserDay: num('AI_ESSAY_USER_DAY', env.AI_ESSAY_USER_DAY, D.AI_ESSAY_USER_DAY),
        concurrentUser: num('AI_CONCURRENT_USER', env.AI_CONCURRENT_USER, D.AI_CONCURRENT_USER),
      },
      budget: {
        siteUsdDay: num('AI_BUDGET_SITE_USD_DAY', env.AI_BUDGET_SITE_USD_DAY, D.AI_BUDGET_SITE_USD_DAY),
        siteUsdMonth,
        onlineSpendLimitUsd: num('ANTHROPIC_ONLINE_SPEND_LIMIT_USD', env.ANTHROPIC_ONLINE_SPEND_LIMIT_USD, D.ANTHROPIC_ONLINE_SPEND_LIMIT_USD),
        pipelineSpendLimitUsd: num('ANTHROPIC_PIPELINE_SPEND_LIMIT_USD', env.ANTHROPIC_PIPELINE_SPEND_LIMIT_USD, D.ANTHROPIC_PIPELINE_SPEND_LIMIT_USD),
        devSpendLimitUsd: num('ANTHROPIC_DEV_SPEND_LIMIT_USD', env.ANTHROPIC_DEV_SPEND_LIMIT_USD, D.ANTHROPIC_DEV_SPEND_LIMIT_USD),
        tierLimitUsd: num('ANTHROPIC_TIER_LIMIT_USD', env.ANTHROPIC_TIER_LIMIT_USD, D.ANTHROPIC_TIER_LIMIT_USD),
      },
      approvalCap,
      approvalCapIsAuto: capOverride === null,
    },
  };
}

/** §6.3 啟動檢查的一條（型別與 @gsat/shared 的 StartupCheck 相同）。 */
export interface StartupCheckResult {
  id: 'site_vs_online' | 'workspaces_vs_tier' | 'daily_vs_monthly';
  ok: boolean;
  detail: string;
  severity: 'error' | 'warn';
}

/**
 * ARCHITECTURE §6.3 的三層大小關係（/api/admin/health 每次呼叫時算；error 級不成立時拒絕新的 AI 核准）：
 *   1. 站內月預算＋日預算 ≤ online workspace 上限（台灣月與 UTC 月的時差多一天日預算）
 *   2. online＋pipeline＋dev workspace 上限 ≤ 用量級距上限
 *   3. 日預算 × 31 ≥ 月預算 × 0.5（只是提醒）
 */
export function startupChecks(config: AppConfig): StartupCheckResult[] {
  const b = config.ai.budget;
  const c1 = b.siteUsdMonth + b.siteUsdDay;
  const c2 = b.onlineSpendLimitUsd + b.pipelineSpendLimitUsd + b.devSpendLimitUsd;
  return [
    {
      id: 'site_vs_online',
      ok: c1 <= b.onlineSpendLimitUsd,
      detail: `站內月預算 ${b.siteUsdMonth}＋日預算 ${b.siteUsdDay}＝${c1} ≤ online 上限 ${b.onlineSpendLimitUsd}`,
      severity: 'error',
    },
    {
      id: 'workspaces_vs_tier',
      ok: c2 <= b.tierLimitUsd,
      detail: `online ${b.onlineSpendLimitUsd}＋pipeline ${b.pipelineSpendLimitUsd}＋dev ${b.devSpendLimitUsd}＝${c2} ≤ 級距上限 ${b.tierLimitUsd}`,
      severity: 'error',
    },
    {
      id: 'daily_vs_monthly',
      ok: b.siteUsdDay * 31 >= b.siteUsdMonth * 0.5,
      detail: `日預算 ${b.siteUsdDay} × 31 ≥ 月預算 ${b.siteUsdMonth} × 0.5`,
      severity: 'warn',
    },
  ];
}
