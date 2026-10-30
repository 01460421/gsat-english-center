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
  AssistAnalysisView,
  AssistCaseDetail,
  AssistCaseKind,
  AssistCaseListResponse,
  AssistCaseSummary,
  AssistDetectedSubject,
  AssistFollowupMode,
  AssistFollowupView,
  AssistOcrView,
  AssistQuestionTarget,
  AssistQuestionView,
  AssistReportAccepted,
  AssistReportDetail,
  AssistReportListResponse,
  AssistReportSummary,
  AssistSection,
  AssistTaskAccepted,
  AssistTurnView,
  AssistVerdict,
  CreateAssistCaseBody,
  CreateAssistFollowupBody,
  CreateAssistReportBody,
  CreateExemplarSetBody,
  ExemplarSetDetail,
  ExemplarSetSummary,
  FeaturesResponse,
  MeResponse,
  MeResponseSignedIn,
  PatchAssistCaseBody,
  PublicUser,
  UpdateAssistQuestionBody,
  ZhAnalysisView,
} from '@gsat/shared';
import { AI_TASK_POINTS, ASSIST_LIMITS, assistCaseKindOf, assistPoints, isZhSection, zhShortPartLabels, type AiRefundReason } from '@gsat/shared';
import { reportDetail as reportDetailFixture } from '../../src/features/assistant/testing/report';
import {
  zhClassicalAnalysis,
  zhEmotionExemplar,
  zhFollowupReply,
  zhFormAnalysis,
  zhJudgeAnalysis,
  zhReasonExemplar,
  zhShortAnalysis,
  zhWordAnalysis,
  zhWritingAnalysis,
} from '../../src/features/assistant/testing/zh';
import { setView as exemplarSetViewFixture } from '../../src/features/writing/exemplars/testing/fixtures';

/** 現行條款版本：要和 src/features/account/policy.ts（以及後端 wrangler.toml）一致，歡迎頁才允許送出。 */
export const VERSIONS = { privacy: '2026-10-30', terms: '2026-10-30', ai: '2026-10-30' } as const;

/**
 * 假後端的預設：登入、AI、OCR 都開；自訂題目批改關閉（AI_CUSTOM_ESSAY 的程式預設 off，也是只關自訂題時的狀態，
 * docs/SETUP-KEYS.md §8.1）。要測自訂題目送 AI 批改的流程（正式站目前的狀態）用 FEATURES_CUSTOM_ON。
 */
export const FEATURES_ON: FeaturesResponse = { auth: true, ai: true, ocr: true, aiPaused: false, customEssay: false };

/** 自訂題目批改也打開（AI_CUSTOM_ESSAY=on）。 */
export const FEATURES_CUSTOM_ON: FeaturesResponse = { ...FEATURES_ON, customEssay: true };

/** 學習助手打開（AI_ASSISTANT=on；docs/design/learning-assistant.md §4.14）：拍照仍然關著。 */
export const FEATURES_ASSISTANT_ON: FeaturesResponse = { ...FEATURES_ON, assistant: true };

/** 學習助手與拍照都打開（AI_ASSISTANT_PHOTO=on；WP-A3）。 */
export const FEATURES_ASSISTANT_PHOTO_ON: FeaturesResponse = { ...FEATURES_ASSISTANT_ON, assistantPhoto: true };

/** 學習助手的國文也打開（AI_ASSISTANT_SUBJECTS=on；docs/design/assistant-subjects.md §7.5）：國文拍照關著。 */
export const FEATURES_SUBJECTS_ON: FeaturesResponse = { ...FEATURES_ASSISTANT_ON, assistantSubjects: [{ subject: 'chinese', photo: false }] };

/** 國文的國寫範文也打開（AI_ZH_EXEMPLAR=on；國寫範文設計 §7）：國文那一筆多 exemplar: true。 */
export const FEATURES_ZH_EXEMPLAR_ON: FeaturesResponse = { ...FEATURES_ASSISTANT_ON, assistantSubjects: [{ subject: 'chinese', photo: false, exemplar: true }] };

/** 國文與國文拍照都打開（AI_ASSISTANT_PHOTO、AI_ASSISTANT_SUBJECTS_PHOTO 都是 on）。 */
export const FEATURES_SUBJECTS_PHOTO_ON: FeaturesResponse = { ...FEATURES_ASSISTANT_PHOTO_ON, assistantSubjects: [{ subject: 'chinese', photo: true }] };

/** 作文範文打開（AI_ESSAY_EXEMPLARS=on；docs/design/model-essays.md §7.5）。 */
export const FEATURES_EXEMPLARS_ON: FeaturesResponse = { ...FEATURES_ON, essayExemplars: true };

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

/**
 * 學習助手開關是 admin 時，管理員的 /api/me（多 assistant_preview；公開的 /api/features 沒有 assistant 欄位）。
 * 一般學生在 admin 模式下的 /api/me 沒有這個欄位，畫面和開關關著時一樣。
 */
export const ME_ASSISTANT_PREVIEW: MeResponseSignedIn = signedInMe({ role: 'admin', ai_status: 'approved' }, { assistant_preview: { photo: false } });

/** 作文範文開關是 admin 時，管理員的 /api/me（多 exemplars_preview；公開的 /api/features 沒有 essayExemplars）。 */
export const ME_EXEMPLARS_PREVIEW: MeResponseSignedIn = signedInMe({ role: 'admin', ai_status: 'approved' }, { exemplars_preview: true });

export const QUOTA: AiQuotaResponse = {
  ai_status: 'approved',
  tier: 'standard',
  points: { day_used: 10, day_limit: 30, month_used: 40, month_limit: 300 },
  essays: { day_used: 1, day_limit: 3 },
  concurrent: { active: 0, limit: 2 },
  site: { paused: false, budget_available: true },
  approval: { cap: 49, approved: 12, full: false },
  resets_at: { day: '2026-10-09T16:00:00Z', month: '2026-10-31T16:00:00Z' },
  task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 2, assist_ocr: 2, assist_analyze: 6, assist_followup: 3, assist_report: 10, essay_exemplars: 8, assist_zh_exemplar: 8 },
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
  /** 路徑裡 :name 的值（登記成「GET /api/assist/cases/:id」時有 id）。 */
  params: Record<string, string>;
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
  /** 目前的功能開關；測試可以改它（例如學習助手緊急關閉），之後的 GET /api/features 就回新的值。 */
  features: FeaturesResponse | 'not-deployed';
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
   * 登記「方法 路徑」的處理函式（路徑不含查詢字串；一段寫成 :name 時比對任何值，放進 call.params）。
   * 後登記的優先，所以測試可以覆寫上面的預設值。值不是函式時當成固定的 200 JSON。
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
        const call: ApiCall = { method, path: url.pathname, params: {}, query: url.searchParams, json, request };
        this.calls.push(call);
        if (this.features === 'not-deployed') {
          await route.fulfill(fulfillOptions(NOT_DEPLOYED));
          return;
        }
        let reply: Reply = apiError(404, 'not_found');
        for (const r of this.routes) {
          const params = matchKey(r.key, method, url.pathname);
          if (!params) continue;
          call.params = params;
          reply = await r.handler(call);
          break;
        }
        await route.fulfill(fulfillOptions(reply));
      },
    );
  }
}

/** 「方法 路徑」比對請求；路徑的 :name 段比對任何一段（值解碼後放進 params）。不符回 null。 */
function matchKey(key: string, method: string, pathname: string): Record<string, string> | null {
  const space = key.indexOf(' ');
  if (key.slice(0, space) !== method) return null;
  const pattern = key.slice(space + 1);
  if (!pattern.includes('/:')) return pattern === pathname ? {} : null;
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i] as string;
    const g = got[i] as string;
    if (w.startsWith(':')) {
      if (g === '') return null;
      params[w.slice(1)] = decodeURIComponent(g);
    } else if (w !== g) {
      return null;
    }
  }
  return params;
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

// ───────────────────────── 學習助手（/api/assist/*） ─────────────────────────

export interface FakeAssistOptions {
  /** 解析的回應：'queued'（預設：202，輪詢幾次之後完成）或 'cache_hit'（共用快取命中：200、0 點、立刻完成）。 */
  analyze?: 'queued' | 'cache_hit';
  /** 進行中的任務被 GET 幾次之後完成（預設 1：第一次看到進行中，下一次完成）。 */
  pendingPolls?: number;
  /** 題號 → 正確答案（假後端不讀題目檔；沒有給的題目，有作答就判錯）。 */
  keys?: Record<string, string>;
  /** 拍照轉錄的結果（WP-A3）：預設 FAKE_OCR；'not_english' 時退還 invalid_output、案例回到 draft。 */
  ocr?: AssistOcrView | 'not_english';
  /** 國文解析時判定是別科（docs/design/assistant-subjects.md §2.5）：退還 invalid_output，turn 帶 detected_subject。 */
  zhMismatch?: AssistDetectedSubject;
  /** 國文單選的解析多一個「可能是多選題」提醒（multi_suspect；§5.3）。 */
  zhMultiSuspect?: boolean;
  /** 國文的拍照轉錄：預設 FAKE_ZH_OCR；'other_subject' 時退還、刪照片、turn 帶 detected_subject: english（§6.5）。 */
  zhOcr?: AssistOcrView | 'other_subject';
  /** 國寫範文的結果（國寫範文設計 §8）：預設依題型回本站自寫的示範；給退還原因時那一篇失敗（點數退還、案例狀態不動）。 */
  zhExemplarFailure?: AiRefundReason;
}

/** 假的國文拍照轉錄（本站自寫的字形題）：一題四個選項，另有一段被隱藏的答案與詳解。 */
export const FAKE_ZH_OCR: AssistOcrView = {
  status: 'ok',
  blocks: [
    { kind: 'question', label: '1', text: '下列文句，何者完全沒有錯別字？', unclear: [], hidden: null },
    {
      kind: 'options',
      label: '1',
      text: '(A) 這家店裝潢普通，價格卻不斐\n(B) 他做事總是按步就班，從不馬虎\n(C) 兩人素昧平生，卻一見如故\n(D) 放假前夕，大家迫不急待地收拾行李',
      unclear: [],
      hidden: null,
    },
    { kind: 'passage', label: null, text: '這段像答案或詳解，已隱藏。', unclear: [], hidden: 'answer_section' },
  ],
  student_answer_seen: '',
  omitted: ['answer_key'],
  notices: [],
};

/**
 * 假的拍照轉錄（本站為測試自己寫的句子）：說明、文章、兩題；第 15 題的題幹有一處看不清（候選 children／chicken），
 * 文章也有一處看不清（不是要問的題就不必處理）；一段被隱藏的佳作樣式。
 */
export const FAKE_OCR: AssistOcrView = {
  status: 'ok',
  blocks: [
    { kind: 'instructions', label: null, text: 'Read the passage and choose the best answer.', unclear: [], hidden: null },
    { kind: 'passage', label: null, text: 'Every spring, the town holds a paper boat race. Children fold [[?]] from old newspapers.', unclear: [{ candidates: ['boats', 'coats'] }], hidden: null },
    { kind: 'question', label: '14', text: 'What is the passage mainly about?', unclear: [], hidden: null },
    { kind: 'options', label: '14', text: '(A) A town event\n(B) Candles\n(C) Newspapers\n(D) A job', unclear: [], hidden: null },
    { kind: 'question', label: '15', text: 'Why do the [[?]] use newspapers?', unclear: [{ candidates: ['children', 'chicken'] }], hidden: null },
    { kind: 'options', label: '15', text: '(A) They are free\n(B) They float\n(C) They are colorful\n(D) They are heavy', unclear: [], hidden: null },
    { kind: 'passage', label: null, text: '這段看起來是評分說明、範文或佳作，已隱藏。', unclear: [], hidden: 'official_like' },
  ],
  student_answer_seen: '15: B',
  omitted: ['answer_key'],
  notices: ['照片裡的解答區沒有轉錄。'],
};

const SECTION_OF_PREFIX: Record<string, AssistSection> = {
  vo: 'vocabulary',
  cz: 'cloze',
  wb: 'word_bank',
  st: 'structure',
  rd: 'reading',
  mx: 'mixed',
};

const SECTION_NAMES: Partial<Record<AssistSection, string>> = { vocabulary: '詞彙題', cloze: '綜合測驗', word_bank: '文意選填', structure: '篇章結構', reading: '閱讀測驗', mixed: '混合題' };

/** 解析點數（同 shared 的 assistAnalyzePoints：1 題 6 點，每多一題加 2，上限 14；單字、寫作固定 6）。 */
function analyzePoints(kind: AssistCaseKind, items: number): number {
  return kind === 'item' ? Math.min(14, 6 + 2 * (Math.max(1, items) - 1)) : 6;
}

function summaryOf(c: AssistCaseDetail): AssistCaseSummary {
  const { id, source, kind, title, section, status, verdict, item_count, wrong_count, understood, error_codes, skill_codes, followups, created_at, updated_at, expires_at } = c;
  const base = { id, source, kind, title, section, status, verdict, item_count, wrong_count, understood, error_codes, skill_codes, followups, created_at, updated_at, expires_at };
  return c.subject ? { ...base, subject: c.subject } : base;
}

/** 國文解析的結算（docs/design/assistant-subjects.md §7.3）：題型、判定、答錯題數、錯因。 */
function zhSettle(c: AssistCaseDetail, analysis: ZhAnalysisView): void {
  c.section = analysis.section;
  if (analysis.kind === 'zh_choice') {
    const verdicts = analysis.items.map((i) => i.verdict);
    c.verdict = verdicts.includes('wrong') ? 'wrong' : verdicts.includes('unanswered') ? 'unanswered' : verdicts.every((v) => v === 'correct') ? 'correct' : 'unknown';
    c.wrong_count = verdicts.filter((v) => v === 'wrong').length;
    c.error_codes = [...new Set(analysis.items.flatMap((i) => i.diagnosis.error_codes))];
  } else if (analysis.kind === 'zh_short') {
    const verdicts = analysis.parts.map((p) => p.verdict);
    c.verdict = verdicts.includes('wrong') ? 'wrong' : verdicts.includes('partial') ? 'partial' : verdicts.every((v) => v === 'correct') ? 'correct' : 'unanswered';
    c.wrong_count = verdicts.filter((v) => v === 'wrong' || v === 'partial').length;
    c.error_codes = c.verdict === 'partial' ? ['zh_partial'] : [];
  } else {
    c.verdict = 'unknown';
    c.wrong_count = 0;
  }
}

/** 國文的假解析：依格式、子模式與題目文字挑範例 A–F（docs/design/assistant-subjects.md §1.8）。 */
function zhAnalysisOf(c: AssistCaseDetail, multiSuspect: boolean): ZhAnalysisView {
  const first = c.question?.targets[0];
  const label = first?.label ?? '1';
  const answer = typeof first?.student_answer === 'string' && first.student_answer !== '' ? first.student_answer : null;
  if (c.kind === 'zh_short') return zhShortAnalysis({ label, studentAnswer: answer });
  if (c.kind === 'zh_writing') return zhWritingAnalysis({ draft: c.question?.draft?.text ?? null });
  const text = (c.question?.blocks ?? []).map((b) => b.text).join('\n');
  const mode = first?.choice_mode;
  if (mode === 'judge') return zhJudgeAnalysis({ label, studentAnswer: answer });
  if (mode === 'multi') return zhWordAnalysis({ label, studentAnswer: answer, key: first?.accepted?.join('') ?? null });
  if (/錯別字/.test(text)) return zhFormAnalysis({ label, studentAnswer: answer, multiSuspect });
  return zhClassicalAnalysis({ label, studentAnswer: answer });
}

/** 國文題目的題號清單（簡答展開成小題；沒有題號時是空字串，同 Worker）。 */
function zhTargetsOf(question: UpdateAssistQuestionBody['question'], kind: AssistCaseKind): AssistQuestionTarget[] {
  // 同 Worker（subjects/chinese/question.ts）：學生沒填題號、題目裡也沒有題號時，題號是空字串。
  const parts = kind === 'zh_short' ? zhShortPartLabels(question.blocks, question.target_labels) : [];
  const labels =
    kind === 'zh_short'
      ? parts.length > 0
        ? parts
        : ['']
      : question.target_labels.length > 0
        ? question.target_labels
        : [question.blocks.find((b) => b.label)?.label ?? ''];
  const single = labels.length === 1;
  return labels.map((label) => {
    const answer = question.answers?.[label] ?? (single ? (Object.values(question.answers ?? {})[0] ?? null) : null);
    const key = question.known_key?.[label] ?? (single ? (Object.values(question.known_key ?? {})[0] ?? null) : null);
    return {
      label,
      display_label: label,
      mode: 'unknown',
      stem: null,
      options: null,
      accepted: key ? [...key] : null,
      student_answer: answer,
      verdict: 'unknown',
      verdict_basis: 'none',
      explanation: null,
      stats: null,
      tags: null,
      ...(question.choice_mode ? { choice_mode: question.choice_mode } : {}),
      ...(key ? { key_source: 'student' as const } : {}),
    };
  });
}

/** 國文題目的畫面形狀（學生提供的區塊、題號、科目、國寫片段）。 */
function zhQuestionView(question: UpdateAssistQuestionBody['question'], kind: AssistCaseKind, origin: string): AssistQuestionView {
  return {
    kind,
    trust: 'student',
    origin_label: origin,
    section: null,
    instructions: null,
    passage: null,
    figure_text: null,
    targets: zhTargetsOf(question, kind),
    siblings: [],
    shared_options: null,
    group_answers: null,
    elimination: null,
    tier: null,
    blocks: question.blocks,
    subject: 'chinese',
    ...(question.draft ? { draft: { text: question.draft, target: question.draft_target ?? 'q2' } } : {}),
  };
}

/**
 * 有狀態的學習助手假後端（docs/design/learning-assistant.md §4.1–§4.3 的形狀）：建立案例、解析（排入佇列 → 輪詢完成，
 * 或共用快取命中）、追問、懂了嗎、刪除。題目內容不讀題目檔：題號、作答照前端送來的，對錯依 options.keys。
 * 測試要模擬錯誤時，在 fakeAssist 之後用 backend.on 覆寫同一個路由（後登記的優先）。
 */
export class FakeAssist {
  readonly cases = new Map<string, AssistCaseDetail>();
  /**
   * 登記到假後端的處理函式（鍵同 FakeBackend.on）。測試覆寫某個路由、又想在條件不成立時照常處理時呼叫它
   * （例如第一次送出解析回 quota_day，之後照常排入佇列）。
   */
  readonly handlers: Record<string, Handler>;
  private readonly pendingLeft = new Map<string, number>();
  private readonly bySource = new Map<string, string>();
  /** 拍照的題目：案例 → 暫存照片的 ord。 */
  readonly photos = new Map<string, number[]>();
  private seq = 0;

  constructor(
    backend: FakeBackend,
    private readonly options: FakeAssistOptions = {},
  ) {
    this.handlers = {
      // ?subject= 只列那一科、錯因次數也只算那一科；不帶時列全部，但錯因次數只算英文（docs/design/assistant-subjects.md §7.2）。
      'GET /api/assist/cases': (call) => {
        const subject = call.query.get('subject');
        const all = [...this.cases.values()].reverse();
        const cases = subject ? all.filter((c) => (c.subject ?? 'english') === subject) : all;
        const counted = all.filter((c) => (c.subject ?? 'english') === (subject ?? 'english'));
        const error_counts: Record<string, number> = {};
        for (const c of counted) for (const code of c.error_codes) error_counts[code] = (error_counts[code] ?? 0) + 1;
        return ok({ cases: cases.map(summaryOf), next_cursor: null, error_counts } satisfies AssistCaseListResponse);
      },
      'POST /api/assist/cases': (call) => this.create(call.json as CreateAssistCaseBody),
      'GET /api/assist/cases/:id': (call) =>
        this.withCase(call, (c) => {
          this.advance(c);
          return ok(c);
        }),
      'PATCH /api/assist/cases/:id': (call) =>
        this.withCase(call, (c) => {
          const body = (call.json ?? {}) as PatchAssistCaseBody;
          if (body.understood !== undefined) c.understood = body.understood;
          if (body.rating !== undefined) c.rating = body.rating;
          if (body.note !== undefined) c.note = body.note;
          // 國文已解析的單選改成多選（0 點；畫面依已存的判定重算）。
          if (body.choice_mode !== undefined && c.question) c.question.targets = c.question.targets.map((t) => ({ ...t, choice_mode: body.choice_mode }));
          c.updated_at = nowSec();
          return ok(c);
        }),
      'DELETE /api/assist/cases/:id': (call) =>
        this.withCase(call, (c) => {
          if (c.pending) return apiError(409, 'conflict');
          this.cases.delete(c.id);
          return { status: 204, body: '' };
        }),
      'PUT /api/assist/cases/:id/question': (call) =>
        this.withCase(call, (c) => {
          const body = call.json as UpdateAssistQuestionBody;
          if (c.pending) return apiError(409, 'conflict');
          if (c.source === 'photo') this.confirmPhoto(c, body);
          else if (c.question?.blocks) c.question.blocks = body.question.blocks;
          c.doubt_kinds = body.doubt_kinds ?? [];
          c.doubt = body.doubt ?? null;
          c.hint_first = body.hint_first ?? false;
          c.status = 'ready';
          return ok(c);
        }),
      'POST /api/assist/cases/:id/analyze': (call) => this.withCase(call, (c) => this.analyze(c)),
      'POST /api/assist/cases/:id/zh-exemplar': (call) => this.withCase(call, (c) => this.zhExemplar(c)),
      'POST /api/assist/cases/:id/followups': (call) => this.withCase(call, (c) => this.followup(c, call.json as CreateAssistFollowupBody)),
      // 拍照（WP-A3）：照片只記張數（不解析 multipart）；轉錄排入佇列 → 輪詢完成。
      'POST /api/assist/cases/:id/photos': (call) =>
        this.withCase(call, (c) => {
          if (c.source !== 'photo' || c.status !== 'draft') return apiError(409, 'conflict');
          const ord = Number(call.query.get('ord'));
          if (ord !== 1 && ord !== 2) return apiError(400, 'bad_request');
          const list = (this.photos.get(c.id) ?? []).filter((p) => p !== ord);
          this.photos.set(c.id, [...list, ord].sort());
          return ok({ photos: (this.photos.get(c.id) ?? []).map((o) => ({ id: `p-${o}`, ord: o, bytes: 1000, width: 1200, height: 1600, created_at: nowSec() })) });
        }),
      'DELETE /api/assist/cases/:id/photos': (call) =>
        this.withCase(call, (c) => {
          if (c.status === 'ocr_queued') return apiError(409, 'conflict');
          this.photos.delete(c.id);
          return ok({ photos: [] });
        }),
      'POST /api/assist/cases/:id/ocr': (call) => this.withCase(call, (c) => this.ocr(c)),
    };
    for (const [key, handler] of Object.entries(this.handlers)) backend.on(key, handler);
  }

  private withCase(call: ApiCall, fn: (c: AssistCaseDetail) => Reply): Reply {
    const c = this.cases.get(call.params['id'] ?? '');
    return c ? fn(c) : apiError(404, 'not_found');
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private verdictOf(label: string, answer: unknown): AssistVerdict {
    if (answer === undefined || answer === null || answer === '') return 'unanswered';
    const key = this.options.keys?.[label];
    return key !== undefined && answer === key ? 'correct' : 'wrong';
  }

  private create(body: CreateAssistCaseBody): Reply {
    const src = body.source;
    // 同一組同樣的題號與作答已經有案例：回 200 與那一筆（§4.1）。
    const dedupe = src.source === 'typed' || src.source === 'photo' ? null : JSON.stringify(src);
    const existingId = dedupe ? this.bySource.get(dedupe) : undefined;
    const existing = existingId ? this.cases.get(existingId) : undefined;
    if (existing) return ok({ ...existing, existing: true });

    const now = nowSec();
    const id = this.nextId('case');
    const zh = (src.source === 'typed' || src.source === 'photo') && src.subject === 'chinese';
    const kind: AssistCaseKind = zh
      ? assistCaseKindOf(src.source, 'chinese', src.source === 'typed' ? src.question.format : null)
      : src.source === 'writing'
        ? 'writing'
        : src.source === 'vocab'
          ? 'vocab'
          : 'item';
    let section: AssistSection | null = null;
    let title = '學習助手的題目';
    let targets: AssistQuestionTarget[] = [];
    let question: AssistQuestionView | null = null;
    if (src.source === 'bank' || src.source === 'bank_mock' || src.source === 'exam') {
      const prefix = /^ai\.([a-z]{2})\./.exec('ref' in src ? src.ref : '')?.[1];
      section = src.source === 'exam' ? null : (SECTION_OF_PREFIX[prefix ?? ''] ?? null);
      const display = (l: string) => (src.source === 'bank_mock' ? (src.label_map[l] ?? l) : l);
      const unit = section === 'cloze' || section === 'word_bank' || section === 'structure' ? '格' : '題';
      targets = src.labels.map((l) => {
        const answer = src.answers[l] ?? null;
        return {
          label: l,
          display_label: display(l),
          mode: section === 'word_bank' || section === 'structure' ? 'bank_choice' : 'single_choice',
          stem: null,
          options: null,
          accepted: this.options.keys?.[l] ? [this.options.keys[l] as string] : null,
          student_answer: answer,
          verdict: this.verdictOf(l, answer),
          verdict_basis: 'program',
          explanation: null,
          stats: null,
          tags: null,
        };
      });
      const origin = src.source === 'exam' ? src.exam_id.replace(/^gsat-(\d+)$/, '$1 學測') : '本站題庫';
      title = `${origin}・${section ? (SECTION_NAMES[section] ?? '題目') : '題目'}：第 ${targets.map((t) => t.display_label).join('、')} ${unit}`;
      question = {
        kind,
        trust: 'site',
        origin_label: origin,
        section,
        instructions: null,
        passage: section === 'word_bank' ? 'Umbrellas are everywhere today. Long ago, people used them to provide protection from the scorching sun.' : null,
        figure_text: null,
        targets,
        siblings: [],
        shared_options: null,
        group_answers: null,
        elimination: null,
        tier: null,
      };
    } else if (src.source === 'typed' && zh) {
      question = zhQuestionView(src.question, kind, '你貼的題目');
      targets = question.targets;
      title = `國文・你貼的題目：${(src.question.blocks.find((b) => b.kind === 'question')?.text ?? src.question.blocks[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 30)}`;
    } else if (src.source === 'typed') {
      const block = src.question.blocks[0];
      const label = src.question.target_labels[0] ?? block?.label ?? '1';
      targets = [
        {
          label,
          display_label: label,
          mode: 'unknown',
          stem: null,
          options: null,
          accepted: null,
          student_answer: src.question.student_answer ?? null,
          verdict: 'unknown',
          verdict_basis: 'none',
          explanation: null,
          stats: null,
          tags: null,
        },
      ];
      title = `你貼的題目：${(block?.text ?? '').slice(0, 30)}`;
      question = {
        kind,
        trust: 'student',
        origin_label: '你貼的題目',
        section: null,
        instructions: null,
        passage: null,
        figure_text: null,
        targets,
        siblings: [],
        shared_options: null,
        group_answers: null,
        elimination: null,
        tier: null,
        blocks: src.question.blocks,
      };
    } else if (src.source === 'photo') {
      title = '你拍的題目';
    }
    const verdicts = targets.map((t) => t.verdict);
    const detail: AssistCaseDetail = {
      id,
      source: src.source,
      kind,
      title,
      section,
      status: src.source === 'photo' ? 'draft' : 'ready',
      verdict: zh ? null : verdicts.includes('wrong') ? 'wrong' : verdicts.length > 0 && verdicts.every((v) => v === 'correct') ? 'correct' : verdicts.length > 0 ? 'unknown' : null,
      item_count: Math.max(1, targets.length),
      wrong_count: verdicts.filter((v) => v === 'wrong').length,
      understood: null,
      error_codes: [],
      skill_codes: [],
      followups: 0,
      created_at: now,
      updated_at: now,
      expires_at: now + 180 * 86_400,
      trust: src.source === 'typed' || src.source === 'photo' ? 'student' : 'site',
      question,
      doubt_kinds: body.doubt_kinds ?? [],
      torn_with: body.torn_with ?? null,
      doubt: body.doubt ?? null,
      hint_first: body.hint_first ?? false,
      note: null,
      rating: null,
      turns: [],
      pending: null,
      history_line: null,
      flags: { d8_hidden: false, injection: false, safety: null },
      ...(zh ? { subject: 'chinese' as const } : {}),
    };
    this.cases.set(id, detail);
    if (dedupe) this.bySource.set(dedupe, id);
    return ok(detail, 201);
  }

  private analyze(c: AssistCaseDetail): Reply {
    if (c.pending) return apiError(409, 'conflict');
    const turn: AssistTurnView = { id: this.nextId('turn'), seq: c.turns.length + 1, kind: 'analyze', status: 'queued', created_at: nowSec() };
    c.turns.push(turn);
    if (this.options.analyze === 'cache_hit') {
      this.finish(c, turn, true);
      return ok({ op_id: null, case_id: c.id, turn_id: turn.id, status: 'done', points: 0, cache_hit: true } satisfies AssistTaskAccepted);
    }
    const opId = this.nextId('op');
    c.pending = { turn_id: turn.id, kind: 'analyze', op_id: opId, status: 'queued' };
    c.status = 'analyzing';
    this.pendingLeft.set(c.id, this.options.pendingPolls ?? 1);
    const points = c.subject === 'chinese' ? assistPoints('chinese', 'assist_analyze', { kind: c.kind, items: c.item_count }) : analyzePoints(c.kind, c.item_count);
    return ok({ op_id: opId, case_id: c.id, turn_id: turn.id, status: 'queued', points } satisfies AssistTaskAccepted, 202);
  }

  /**
   * 國寫範文（8 點；國寫範文設計 §7）：國文的國寫案例、國寫指導完成後；每一題最多 2 篇（完成＋進行中，429 assist_limit）。
   * turn 的種類是 zh_exemplar（Worker 的資料庫是 followup，詳情回 zh_exemplar），排入佇列 → 輪詢完成。
   */
  private zhExemplar(c: AssistCaseDetail): Reply {
    if (c.subject !== 'chinese' || c.kind !== 'zh_writing') return apiError(400, 'bad_request');
    if (c.pending || c.status !== 'analyzed') return apiError(409, 'conflict');
    const counted = c.turns.filter((t) => t.kind === 'zh_exemplar' && t.status !== 'failed').length;
    if (counted >= ASSIST_LIMITS.zhExemplarsPerCase) {
      return { status: 429, json: { error: { code: 'assist_limit', message: 'e2e assist_limit', reason: 'zh_exemplars_per_case' } } };
    }
    const turn: AssistTurnView = { id: this.nextId('turn'), seq: c.turns.length + 1, kind: 'zh_exemplar', status: 'queued', created_at: nowSec() };
    c.turns.push(turn);
    const opId = this.nextId('op');
    c.pending = { turn_id: turn.id, kind: 'zh_exemplar', op_id: opId, status: 'queued' };
    this.pendingLeft.set(c.id, this.options.pendingPolls ?? 1);
    return ok({ op_id: opId, case_id: c.id, turn_id: turn.id, status: 'queued', points: AI_TASK_POINTS.assist_zh_exemplar } satisfies AssistTaskAccepted, 202);
  }

  /** 轉錄（2 點）：要有照片、狀態 draft；排入佇列，輪詢幾次之後完成（或退還）。 */
  private ocr(c: AssistCaseDetail): Reply {
    if (c.pending || c.source !== 'photo' || c.status !== 'draft') return apiError(409, 'conflict');
    if ((this.photos.get(c.id) ?? []).length === 0) return apiError(409, 'conflict');
    const turn: AssistTurnView = { id: this.nextId('turn'), seq: c.turns.length + 1, kind: 'ocr', status: 'queued', created_at: nowSec() };
    c.turns.push(turn);
    const opId = this.nextId('op');
    c.pending = { turn_id: turn.id, kind: 'ocr', op_id: opId, status: 'queued' };
    c.status = 'ocr_queued';
    this.pendingLeft.set(c.id, this.options.pendingPolls ?? 1);
    const photos = (this.photos.get(c.id) ?? []).length === 2 ? 2 : 1;
    const points = c.subject === 'chinese' ? assistPoints('chinese', 'assist_ocr', { photos }) : 2;
    return ok({ op_id: opId, case_id: c.id, turn_id: turn.id, status: 'queued', points } satisfies AssistTaskAccepted, 202);
  }

  /** 確認轉錄：題目換成學生確認的區塊（非目標區塊的 [[?]] 換成 [unclear]），轉錄只留統計。 */
  private confirmPhoto(c: AssistCaseDetail, body: UpdateAssistQuestionBody): void {
    if (c.subject === 'chinese') {
      // 國文：格式決定 kind（確認時可以改），題號、作答、答案鍵照送來的。
      c.kind = assistCaseKindOf('photo', 'chinese', body.question.format);
      c.question = zhQuestionView(body.question, c.kind, '你拍的題目');
      c.item_count = Math.max(1, c.question.targets.length);
      c.title = `國文・你拍的題目：${(body.question.blocks.find((b) => b.kind === 'question')?.text ?? '').slice(0, 30)}`;
      for (const t of c.turns) {
        if (t.kind === 'ocr' && t.ocr && t.ocr.blocks.length > 0) t.ocr = { ...t.ocr, blocks: [], student_answer_seen: '', notices: [], stats: { blocks: t.ocr.blocks.length, unresolved: 0, edited: 0, unclear_kept: 0 } };
      }
      this.photos.delete(c.id);
      return;
    }
    const blocks = body.question.blocks.map((b) => ({ ...b, text: b.text.split('[[?]]').join('[unclear]') }));
    const labels = body.question.target_labels.length > 0 ? body.question.target_labels : [blocks.find((b) => b.label)?.label ?? ''];
    const targets: AssistQuestionTarget[] = labels.map((label) => ({
      label,
      display_label: label,
      mode: 'unknown',
      stem: blocks.find((b) => b.kind === 'question' && b.label === label)?.text ?? null,
      options: null,
      accepted: null,
      student_answer: body.question.student_answer ?? null,
      verdict: 'unknown',
      verdict_basis: 'none',
      explanation: null,
      stats: null,
      tags: null,
    }));
    const first = targets[0]?.stem ?? blocks[0]?.text ?? '';
    c.title = `你拍的題目：${first.slice(0, 40)}`;
    c.item_count = Math.max(1, targets.length);
    c.verdict = 'unknown';
    c.question = {
      kind: 'item',
      trust: 'student',
      origin_label: '你拍的題目',
      section: null,
      instructions: null,
      passage: null,
      figure_text: null,
      targets,
      siblings: [],
      shared_options: null,
      group_answers: null,
      elimination: null,
      tier: null,
      blocks,
    };
    for (const t of c.turns) {
      if (t.kind === 'ocr' && t.ocr && t.ocr.blocks.length > 0) {
        t.ocr = { ...t.ocr, blocks: [], student_answer_seen: '', notices: [], stats: { blocks: t.ocr.blocks.length, unresolved: 1, edited: 1, unclear_kept: 1 } };
      }
    }
    this.photos.delete(c.id);
  }

  private followup(c: AssistCaseDetail, body: CreateAssistFollowupBody): Reply {
    if (c.pending) return apiError(409, 'conflict');
    const turn: AssistTurnView = {
      id: this.nextId('turn'),
      seq: c.turns.length + 1,
      kind: 'followup',
      status: 'queued',
      question: body.text,
      label: body.label ?? null,
      mode: body.mode,
      created_at: nowSec(),
    };
    c.turns.push(turn);
    const opId = this.nextId('op');
    c.pending = { turn_id: turn.id, kind: 'followup', op_id: opId, status: 'queued' };
    this.pendingLeft.set(c.id, this.options.pendingPolls ?? 1);
    return ok({ op_id: opId, case_id: c.id, turn_id: turn.id, status: 'queued', points: 3 } satisfies AssistTaskAccepted, 202);
  }

  /** GET 一次：進行中的任務往前推一步（先 running，次數到了就完成）。 */
  private advance(c: AssistCaseDetail): void {
    if (!c.pending) return;
    const turn = c.turns.find((t) => t.id === c.pending?.turn_id);
    if (!turn) return;
    const left = this.pendingLeft.get(c.id) ?? 0;
    if (left > 0) {
      this.pendingLeft.set(c.id, left - 1);
      c.pending = { ...c.pending, status: 'running' };
      turn.status = 'running';
      return;
    }
    this.finish(c, turn, false);
  }

  private finish(c: AssistCaseDetail, turn: AssistTurnView, cacheHit: boolean): void {
    turn.status = 'done';
    if (turn.kind === 'ocr' && c.subject === 'chinese') {
      const result = this.options.zhOcr ?? FAKE_ZH_OCR;
      if (result === 'other_subject') {
        // 不是國文題目：照英文的規則退還、刪照片、案例回到 draft，turn 帶模型判斷的科目（§6.5）。
        turn.status = 'failed';
        turn.failure = 'invalid_output';
        turn.detected_subject = 'english';
        c.status = 'draft';
      } else {
        turn.ocr = result;
        c.status = 'ocr_ready';
      }
      this.photos.delete(c.id);
    } else if (turn.kind === 'analyze' && c.subject === 'chinese') {
      if (this.options.zhMismatch) {
        // 解析時判定是別科：以 invalid_output 退還（§2.5）。
        turn.status = 'failed';
        turn.failure = 'invalid_output';
        turn.detected_subject = this.options.zhMismatch;
        c.status = 'failed';
      } else {
        const analysis = zhAnalysisOf(c, this.options.zhMultiSuspect === true);
        turn.analysis = analysis;
        c.status = 'analyzed';
        zhSettle(c, analysis);
      }
    } else if (turn.kind === 'zh_exemplar') {
      // 國寫範文：只動 turn（案例的狀態、追問次數都不變）；失敗時退還。
      if (this.options.zhExemplarFailure) {
        turn.status = 'failed';
        turn.failure = this.options.zhExemplarFailure;
      } else {
        turn.exemplar = c.section === 'zh_writing_reason' ? zhReasonExemplar() : zhEmotionExemplar();
      }
    } else if (turn.kind === 'followup' && c.subject === 'chinese') {
      turn.reply = zhFollowupReply(turn.mode ?? 'explain');
      c.followups += 1;
    } else if (turn.kind === 'ocr') {
      const result = this.options.ocr ?? FAKE_OCR;
      if (result === 'not_english') {
        // 看不出是英文題目：退還 invalid_output、照片刪掉、案例回到 draft（要重拍）。
        turn.status = 'failed';
        turn.failure = 'invalid_output';
        c.status = 'draft';
      } else {
        turn.ocr = result;
        c.status = 'ocr_ready';
      }
      this.photos.delete(c.id);
    } else if (turn.kind === 'analyze') {
      turn.analysis = itemAnalysis(c, cacheHit);
      if (cacheHit) turn.cache_hit = true;
      c.status = 'analyzed';
      c.error_codes = c.wrong_count > 0 ? ['word_meaning'] : [];
    } else {
      turn.reply = followupReply(turn.mode ?? 'explain');
      c.followups += 1;
    }
    c.pending = null;
    c.updated_at = nowSec();
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 固定的解析內容（item）：題組有全篇結構，逐題各一塊；勾了「在兩個選項之間猶豫」時回覆那個疑問。 */
function itemAnalysis(c: AssistCaseDetail, cacheHit: boolean): AssistAnalysisView {
  const targets = c.question?.targets ?? [];
  const group = targets.length > 1;
  const first = targets[0];
  const mine = typeof first?.student_answer === 'string' ? first.student_answer : null;
  return {
    kind: 'item',
    // 英文案例的 section 一定是英文的大題（國文的題型只出現在國文案例）。
    section: isZhSection(c.section) ? null : c.section,
    skill_codes: [],
    tested_zh: group ? '依上下文判斷每一格需要的詞性與語意，再用排除法縮小範圍。' : '依上下文判斷作者的意思。',
    structure_zh: group ? '第一段介紹雨傘的起源，第二段說明材質的演變；這兩格的線索都在前後句。' : '',
    items: targets.map((t) => ({
      label: t.label,
      display_label: t.display_label,
      verdict: t.verdict,
      verdict_basis: t.verdict_basis,
      answer_key: t.accepted ? { from: 'site', accepted: t.accepted } : { from: 'ai', text: 'B', certainty: 'likely' },
      student_answer: t.student_answer,
      stats: null,
      diagnosis: {
        error_codes: t.verdict === 'wrong' ? ['word_meaning'] : [],
        summary_zh: t.verdict === 'correct' ? '這題選對了，判斷的依據是前一句的語意。' : `第 ${t.display_label} 格：詞性對了，但語意和前後文接不起來。`,
        detail_zh: '空格前後在講「保護、遮擋」，要選能接 from 的字。',
      },
      option_contrast_zh: '',
      hints_zh: ['先看空格前後的字，判斷需要的詞性。', '再看整句在講什麼。'],
      solution_steps: [
        { text_zh: '找出空格前後的關鍵字。', quote: 'provide protection from the scorching sun', range: null },
        { text_zh: '把候選字放回句子裡檢查語意與搭配。', quote: '', range: null },
      ],
      traps: [],
    })),
    knowledge: [
      {
        kind: 'collocation',
        title_zh: 'provide protection from',
        explain_zh: '「提供保護、免於…」的固定搭配。',
        examples: [{ en: 'Trees provide protection from the wind.', zh: '樹木可以擋風。' }],
      },
    ],
    method: { title_zh: '先詞性、再語意', steps_zh: ['先判斷每一格需要的詞性。', '再用語意與搭配縮小範圍。'] },
    score_tips_zh: ['先做有把握的格子，再用排除法。', '最後把整段讀一次確認。'],
    doubt_replies:
      c.doubt_kinds.includes('torn_between') && c.torn_with
        ? [{ doubt_zh: `在 (${mine ?? '?'}) 和 (${c.torn_with}) 之間猶豫`, reply_zh: `(${c.torn_with}) 只符合前半句；後半句的語氣只有 (${mine ?? '?'}) 接得上。` }]
        : [],
    practice_focus: null,
    followup_chips_zh: ['可以再舉一個例句嗎？'],
    key_concern_zh: '',
    off_topic: false,
    safety_flag: 'none',
    notices: [],
    cache_hit: cacheHit,
  };
}

function followupReply(mode: AssistFollowupMode): AssistFollowupView {
  return {
    reply_zh: 'retain 是「保留、維持」，後面直接接受詞，不接 from。',
    points: [{ text_zh: 'retain＋受詞', example_en: 'Please retain your ticket.' }],
    mode_used: mode,
    new_error_codes: [],
    understood_check_zh: '用 retain 造一個句子看看。',
    followup_chips_zh: [],
    off_topic: false,
    safety_flag: 'none',
    notices: [],
  };
}

/** 在假後端上登記學習助手的路由（要在 page.goto 之前；回傳的物件可以檢查案例的狀態）。 */
export function fakeAssist(backend: FakeBackend, options: FakeAssistOptions = {}): FakeAssist {
  return new FakeAssist(backend, options);
}

// ───────────────────────── 學習報告（/api/assist/reports；WP-C） ─────────────────────────

/**
 * 有狀態的學習報告假後端（docs/design/learning-assistant.md §4.1 的四個端點）：POST 排入佇列（10 點）、
 * GET 詳情第一次看到排隊中、下一次完成（內容用 src/features/assistant/testing/report.ts 的範例，版本與 id 換成這一份的）、
 * 列表新到舊、DELETE。送出的本體記在 bodies，測試檢查前端送了什麼。
 */
export class FakeReports {
  readonly reports: AssistReportDetail[] = [];
  readonly bodies: CreateAssistReportBody[] = [];
  private readonly pendingLeft = new Map<string, number>();

  constructor(backend: FakeBackend) {
    backend.on('GET /api/assist/reports', () => ok({ reports: [...this.reports].reverse().map(reportSummaryOf) } satisfies AssistReportListResponse));
    backend.on('POST /api/assist/reports', (call) => this.create(call.json as CreateAssistReportBody));
    backend.on('GET /api/assist/reports/:id', (call) => {
      const r = this.reports.find((x) => x.id === call.params['id']);
      if (!r) return apiError(404, 'not_found');
      this.advance(r);
      return ok(r);
    });
    backend.on('DELETE /api/assist/reports/:id', (call) => {
      const i = this.reports.findIndex((x) => x.id === call.params['id']);
      if (i < 0) return apiError(404, 'not_found');
      if (this.reports[i]!.status === 'queued' || this.reports[i]!.status === 'running') return apiError(409, 'conflict');
      this.reports.splice(i, 1);
      return { status: 204, body: '' };
    });
  }

  private create(body: CreateAssistReportBody): Reply {
    this.bodies.push(body);
    const version = (this.reports.at(-1)?.version ?? 0) + 1;
    const id = `00000000-0000-4000-8000-${String(version).padStart(12, '0')}`;
    const now = nowSec();
    const detail: AssistReportDetail = {
      ...reportDetailFixture(),
      id,
      version,
      based_on: body.based_on ?? null,
      status: 'queued',
      created_at: now,
      updated_at: now,
      settings: { target: body.target, practice_tier: body.practice_tier ?? null, weekly: body.weekly, school_exam_dates: body.school_exam_dates ?? [], exam_date: body.exam_date ?? '2027-01-23' },
      feedback: body.feedback ?? null,
      facts: null,
      report: null,
    };
    this.reports.push(detail);
    this.pendingLeft.set(id, 1);
    return ok({ op_id: `op-report-${version}`, report_id: id, version, status: 'queued', points: 10 } satisfies AssistReportAccepted, 202);
  }

  /** 排隊中的報告被 GET 過一次之後完成。 */
  private advance(r: AssistReportDetail): void {
    if (r.status !== 'queued' && r.status !== 'running') return;
    const left = this.pendingLeft.get(r.id) ?? 0;
    if (left > 0) {
      this.pendingLeft.set(r.id, left - 1);
      return;
    }
    const done = reportDetailFixture();
    r.status = 'done';
    r.facts = done.facts;
    r.report = r.version > 1 ? { ...done.report!, changes_zh: ['上一版的閱讀題組做了一部分，這一版份量改小一點。'] } : done.report;
    r.updated_at = nowSec();
  }
}

function reportSummaryOf(r: AssistReportDetail): AssistReportSummary {
  const { id, version, based_on, status, failure, created_at, exam_date, target_level } = r;
  return { id, version, based_on, status, failure, created_at, exam_date, target_level };
}

/** 在假後端上登記學習報告的路由（要在 page.goto 之前）。 */
export function fakeReports(backend: FakeBackend): FakeReports {
  return new FakeReports(backend);
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

// ───────────────────────── 作文範文（/api/exemplars/*） ─────────────────────────

export interface FakeExemplarsOptions {
  /** 這些網站題目已經有共用的範文（site-status 回 cached、建立時直接 200 cache_hit）。 */
  cachedGroups?: string[];
  /** 進行中的組被 GET 幾次之後完成（預設 1：第一次看到排隊中，下一次完成）。 */
  pendingPolls?: number;
  /** 自訂題的題目文字包含這些字時回 409 exemplar_site_match（沒帶 allow_custom）。 */
  siteMatch?: { includes: string; group_id: string; title: string };
}

/**
 * 有狀態的作文範文假後端（docs/design/model-essays.md §7.1–§7.3 的形狀）：建立（排入佇列 → 輪詢完成；網站題目已有共用範文時
 * 200 cache_hit）、列表、site-status、評分、刪除。三篇範文用 src/features/writing/exemplars/testing/fixtures.ts（本站自己寫的短文）。
 * 同一個網站題目第二次建立（第一組完成後）：共用快取命中（cachedGroups 自動加入）。
 */
export class FakeExemplars {
  readonly sets = new Map<string, ExemplarSetDetail>();
  readonly cached: Set<string>;
  private readonly pendingLeft = new Map<string, number>();
  private seq = 0;

  constructor(
    backend: FakeBackend,
    private readonly options: FakeExemplarsOptions = {},
  ) {
    this.cached = new Set(options.cachedGroups ?? []);
    backend.on('GET /api/exemplars', () => ok({ sets: [...this.sets.values()].reverse().map((d) => this.summaryOf(d)), next_cursor: null }));
    backend.on('POST /api/exemplars', (call) => this.create(call.json as CreateExemplarSetBody));
    backend.on('GET /api/exemplars/:id', (call) => {
      const d = this.sets.get(call.params['id'] ?? '');
      if (!d) return apiError(404, 'not_found');
      this.advance(d);
      return ok(d);
    });
    // 後登記的優先：site-status 要在 :id 之後登記，才不會被當成一組範文的 id。
    backend.on('GET /api/exemplars/site-status', (call) => {
      const groupId = call.query.get('group_id') ?? '';
      const cached = this.cached.has(groupId);
      return ok({ group_id: groupId, title: siteTitleOf(groupId), cached, points: cached ? 0 : 8 });
    });
    backend.on('PATCH /api/exemplars/:id', (call) => {
      const d = this.sets.get(call.params['id'] ?? '');
      if (!d) return apiError(404, 'not_found');
      d.rating = (call.json as { rating: 'helpful' | 'wrong' | null }).rating;
      return ok(d);
    });
    backend.on('DELETE /api/exemplars/:id', (call) => {
      const d = this.sets.get(call.params['id'] ?? '');
      if (!d) return apiError(404, 'not_found');
      if (d.status === 'queued' || d.status === 'running') return apiError(409, 'conflict');
      this.sets.delete(d.id);
      return { status: 204, body: '' };
    });
  }

  private summaryOf(d: ExemplarSetDetail): ExemplarSetSummary {
    const { id, source, group_id, title, status, cache_hit, created_at, updated_at } = d;
    return { id, source, group_id, title, status, cache_hit, created_at, updated_at };
  }

  private create(body: CreateExemplarSetBody): Reply {
    const now = nowSec();
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
    if (body.source === 'site') {
      const cacheHit = this.cached.has(body.group_id) && body.fresh !== true;
      const d: ExemplarSetDetail = {
        id,
        source: body.group_id.startsWith('ai.') ? 'bank' : 'exam',
        group_id: body.group_id,
        title: siteTitleOf(body.group_id),
        status: cacheHit ? 'done' : 'queued',
        cache_hit: cacheHit,
        created_at: now,
        updated_at: now,
        prompt: null,
        view: cacheHit ? exemplarSetViewFixture() : null,
        failure: null,
        rating: null,
        expires_at: now + 180 * 86_400,
      };
      this.sets.set(id, d);
      if (cacheHit) return ok(d);
      this.pendingLeft.set(id, this.options.pendingPolls ?? 1);
      return ok({ id, op_id: `op-${id}`, status: 'queued' }, 202);
    }
    const match = this.options.siteMatch;
    if (match && body.allow_custom !== true && body.prompt.text.includes(match.includes)) {
      return { status: 409, json: { error: { code: 'exemplar_site_match', message: 'e2e exemplar_site_match', group_id: match.group_id, title: match.title } } };
    }
    const p = body.prompt;
    const d: ExemplarSetDetail = {
      id,
      source: 'custom',
      group_id: null,
      title: [...p.text].slice(0, 30).join(''),
      status: 'queued',
      cache_hit: false,
      created_at: now,
      updated_at: now,
      prompt: { text: p.text, figure_text: p.figure_text ?? null, paragraphs: p.paragraphs ?? null, min_words: p.min_words ?? null, max_words: p.max_words ?? null, updated_at: now },
      view: null,
      failure: null,
      rating: null,
      expires_at: now + 180 * 86_400,
    };
    this.sets.set(id, d);
    this.pendingLeft.set(id, this.options.pendingPolls ?? 1);
    return ok({ id, op_id: `op-${id}`, status: 'queued' }, 202);
  }

  /** 每次 GET：進行中的倒數，歸零時完成（網站題目完成後就有共用的範文）。 */
  private advance(d: ExemplarSetDetail) {
    if (d.status !== 'queued' && d.status !== 'running') return;
    const left = this.pendingLeft.get(d.id) ?? 0;
    if (left > 0) {
      this.pendingLeft.set(d.id, left - 1);
      return;
    }
    d.status = 'done';
    d.view = exemplarSetViewFixture();
    d.updated_at = nowSec();
    if (d.group_id) this.cached.add(d.group_id);
  }
}

/** 假後端的網站題目標題（真的 Worker 由題目庫產生；這裡只認得 e2e 用到的格式）。 */
function siteTitleOf(groupId: string): string {
  const exam = /^gsat-(\d+)\./.exec(groupId);
  if (exam) return `${exam[1]} 學測 英文作文`;
  return groupId.startsWith('ai.') ? '本站仿真作文' : groupId;
}

export function fakeExemplars(backend: FakeBackend, options: FakeExemplarsOptions = {}): FakeExemplars {
  return new FakeExemplars(backend, options);
}
