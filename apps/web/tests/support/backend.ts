/**
 * 登入＋AI 批改的 e2e 共用工具：用 page.route 假造整個 Worker（/api/*、/auth/*），照 @gsat/shared 的契約回應。
 *
 * 和 smoke／exams／vocab 的 mockBackend 一樣不依賴 wrangler 或線上 API；差別是這裡的假後端有狀態
 * （同意之後 /api/me 跟著變、提交依序 queued → graded），而且記錄每一個請求，測試可以檢查前端送了什麼。
 *
 * 沒有登記的 /api、/auth 一律回統一格式的 404：瀏覽器會為它印一行 console error，collectErrors 就會抓到，
 * 新頁面多打了一支沒假造的 API 時測試會直接失敗，而不是默默通過。
 */
import { expect, type Page, type Request } from '@playwright/test';
import type {
  AdminHealthResponse,
  AdminUsageResponse,
  AdminUserRow,
  AiQuotaResponse,
  FeaturesResponse,
  MeResponse,
  MeResponseSignedIn,
  PublicUser,
} from '@gsat/shared';

/** 現行條款版本：要和 src/features/account/policy.ts（以及後端 wrangler.toml）一致，歡迎頁才允許送出。 */
export const VERSIONS = { privacy: '2026-10-08', terms: '2026-10-08', ai: '2026-10-08' } as const;

export const FEATURES_ON: FeaturesResponse = { auth: true, ai: true, ocr: true, aiPaused: false };

/** 已登入的 /api/me（預設：完成首次設定、尚未申請 AI 的學生）。 */
export function signedInMe(
  user: Partial<PublicUser> = {},
  rest: Partial<Omit<MeResponseSignedIn, 'user'>> = {},
): MeResponseSignedIn {
  return {
    user: {
      id: 'u-self',
      display_name: '小明',
      role: 'student',
      status: 'active',
      age_band: '18plus',
      ai_status: 'none',
      ai_tier: 'standard',
      created_at: 1_790_000_000,
      ...user,
    },
    pending_consents: [],
    onboarded: true,
    consent_versions: { ...VERSIONS },
    login_at: Math.floor(Date.now() / 1000),
    pending_ai_consents: [],
    ...rest,
  };
}

export const QUOTA: AiQuotaResponse = {
  ai_status: 'approved',
  tier: 'standard',
  points: { day_used: 10, day_limit: 30, month_used: 40, month_limit: 300 },
  essays: { day_used: 1, day_limit: 3 },
  concurrent: { active: 0, limit: 2 },
  site: { paused: false, budget_available: true },
  approval: { cap: 49, approved: 12, full: false },
  resets_at: { day: '2026-10-09T16:00:00Z', month: '2026-10-31T16:00:00Z' },
  task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 2 },
};

export const ADMIN_HEALTH: AdminHealthResponse = {
  config: {
    google_client_id: true,
    google_client_secret: true,
    session_secret: true,
    admin_email: true,
    ledger_salt: true,
    anthropic_api_key: true,
    ai_queue: true,
  },
  migrations: { applied: ['0001_init.sql', '0002_ai_photo_temp.sql'], expected: ['0001_init.sql', '0002_ai_photo_temp.sql'], ok: true },
  startup_checks: [
    { id: 'site_vs_online', ok: true, detail: '400＋20 ≤ 450', severity: 'error' },
    { id: 'workspaces_vs_tier', ok: true, detail: '450 ≤ 500', severity: 'error' },
    { id: 'daily_vs_monthly', ok: true, detail: '20 × 31 ≥ 200', severity: 'warn' },
  ],
  approvals_allowed: true,
  ai: { paused: false, approval_cap: 49, approved: 12 },
  ops_events: { open: 0, open_errors: 0 },
};

export function adminUserRow(id: string, displayName: string, patch: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id,
    display_name: displayName,
    role: 'student',
    status: 'active',
    age_band: '18plus',
    ai_status: 'pending',
    ai_tier: 'standard',
    created_at: 1_790_000_000,
    email: `${id}@gmail.example.com`,
    ai_apply_note: '準備學測，想每週練兩篇作文。',
    ai_apply_count: 1,
    ai_applied_at: 1_791_400_000,
    ai_reviewed_at: null,
    last_active_day: '2026-10-08',
    ...patch,
  };
}

export const ADMIN_USAGE: Omit<AdminUsageResponse, 'from' | 'to'> = {
  totals: { ops: 4, points: 20, usd_micros: 1_234_567, refunded_ops: 0 },
  by_day: [{ tw_day: '2026-10-08', ops: 4, points: 20, usd_micros: 1_234_567 }],
  by_task: [{ task: 'essay_grade', ops: 2, points: 14, usd_micros: 1_000_000 }],
  budget: { site_day_usd: 20, site_month_usd: 400, today_usd_micros: 1_234_567, month_usd_micros: 9_000_000 },
};

// ───────────────────────── 假後端 ─────────────────────────

export interface ApiCall {
  method: string;
  /** pathname（不含查詢字串）。 */
  path: string;
  query: URLSearchParams;
  /** JSON 本體（解析失敗或 multipart 時是 undefined；原始內容看 request）。 */
  json: unknown;
  request: Request;
}

export interface Reply {
  status?: number;
  json?: unknown;
  /** 非 JSON 的本體（代理的 HTML 錯誤頁）。 */
  body?: string;
  contentType?: string;
}

export type Handler = (call: ApiCall) => Reply | Promise<Reply>;

export const ok = (json: unknown, status = 200): Reply => ({ status, json });
export const apiError = (status: number, code: string): Reply => ({ status, json: { error: { code, message: `e2e ${code}` } } });

/** Worker 還沒部署時代理回的東西：HTML 的 404 頁（不是 JSON）。 */
const NOT_DEPLOYED: Reply = {
  status: 404,
  body: '<!doctype html><html><head><title>404: NOT_FOUND</title></head><body>The page could not be found</body></html>',
  contentType: 'text/html; charset=utf-8',
};

export interface FakeBackendOptions {
  /** 'not-deployed'：所有 /api、/auth 都回 HTML 404（Vercel 代理在 Worker 沒部署時的樣子）。 */
  features?: FeaturesResponse | 'not-deployed';
  me?: MeResponse;
  quota?: AiQuotaResponse;
}

export class FakeBackend {
  readonly calls: ApiCall[] = [];
  /** 目前的登入狀態；測試可以在處理函式裡改它（例如同意之後），之後的 GET /api/me 就回新的值。 */
  me: MeResponse;
  quota: AiQuotaResponse;
  private readonly features: FeaturesResponse | 'not-deployed';
  private readonly routes: Array<{ key: string; handler: Handler }> = [];

  constructor(options: FakeBackendOptions = {}) {
    this.features = options.features ?? FEATURES_ON;
    this.me = options.me ?? { user: null };
    this.quota = options.quota ?? QUOTA;
    this.on('GET /api/features', () => ok(this.features));
    this.on('GET /api/health', () => ok({ ok: true, service: 'gsat-english-api', version: '0.0.0-e2e', time: new Date().toISOString() }));
    this.on('GET /api/me', () => ok(this.me));
    this.on('GET /api/ai/quota', () => ok(this.quota));
    this.on('GET /api/submissions', () => ok({ submissions: [], next_cursor: null }));
    // 登入是整頁跳到 Worker；這裡回一頁假的「Google 登入」，測試只檢查網址帶了正確的 next。
    this.on('GET /auth/google/start', () => ({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="zh-Hant"><head><title>Google 登入（測試替身）</title></head><body><h1>Google 登入（測試替身）</h1></body></html>',
    }));
  }

  /**
   * 登記「方法 路徑」的處理函式（路徑不含查詢字串）。後登記的優先，所以測試可以覆寫上面的預設值。
   * 值不是函式時當成固定的 200 JSON。
   */
  on(key: string, handler: Handler | object): this {
    const fn: Handler = typeof handler === 'function' ? (handler as Handler) : () => ok(handler);
    this.routes.unshift({ key, handler: fn });
    return this;
  }

  /** 某個「方法 路徑」收到的請求。 */
  callsTo(method: string, path: string): ApiCall[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  async install(page: Page): Promise<void> {
    await page.route(
      (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/'),
      async (route, request) => {
        const url = new URL(request.url());
        const method = request.method();
        let json: unknown;
        if ((request.headers()['content-type'] ?? '').includes('application/json')) {
          try {
            json = request.postDataJSON();
          } catch {
            json = undefined;
          }
        }
        const call: ApiCall = { method, path: url.pathname, query: url.searchParams, json, request };
        this.calls.push(call);
        if (this.features === 'not-deployed') {
          await route.fulfill(fulfillOptions(NOT_DEPLOYED));
          return;
        }
        const found = this.routes.find((r) => r.key === `${method} ${url.pathname}`);
        const reply = found ? await found.handler(call) : apiError(404, 'not_found');
        await route.fulfill(fulfillOptions(reply));
      },
    );
  }
}

function fulfillOptions(reply: Reply) {
  const status = reply.status ?? 200;
  if (reply.json !== undefined) return { status, json: reply.json };
  return { status, body: reply.body ?? '', contentType: reply.contentType ?? 'text/plain; charset=utf-8' };
}

/** 建好假後端並掛到頁面上（要在 page.goto 之前）。 */
export async function fakeBackend(page: Page, options: FakeBackendOptions = {}): Promise<FakeBackend> {
  const backend = new FakeBackend(options);
  await backend.install(page);
  return backend;
}

// ───────────────────────── 檢查工具 ─────────────────────────

/**
 * 收集 console error 與未捕捉的例外；在 goto 之前呼叫。
 *
 * expectedFailures：這個測試刻意讓它失敗的請求（例如後端沒部署時的 /api/features 404、額度不足的 429）。
 * 瀏覽器會為每個 4xx／5xx 的 fetch 印一行「Failed to load resource」，那是網路層的紀錄、不是程式錯誤，
 * 只有網址符合時才略過；程式自己的 console.error 與 pageerror 一律算錯誤。
 */
export function collectErrors(page: Page, expectedFailures: RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const { url } = msg.location();
    if (msg.text().startsWith('Failed to load resource') && expectedFailures.some((re) => re.test(url))) return;
    errors.push(`console.error: ${msg.text()}${url ? ` (${url})` : ''}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** 頁面沒有水平捲動；手機專案另外縮到 320px 再檢查一次（WCAG 1.4.10 重排的基準寬度）。 */
export async function expectNoHorizontalOverflow(page: Page, isMobile: boolean): Promise<void> {
  const widths = isMobile ? [null, 320] : [null];
  const original = page.viewportSize();
  for (const width of widths) {
    if (width !== null && original) await page.setViewportSize({ width, height: original.height });
    const { scrollWidth, viewport } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `頁面寬 ${scrollWidth}px 超出視窗 ${viewport}px`).toBeLessThanOrEqual(viewport);
  }
  if (original && isMobile) await page.setViewportSize(original);
}
