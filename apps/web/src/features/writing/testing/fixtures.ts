/**
 * 寫作頁測試用的假資料與假 fetch。後端還沒完成，所有 API 回應都照 @gsat/shared 的契約手寫。
 */
import type {
  AiQuotaResponse,
  EssayGradingResult,
  FeaturesResponse,
  MeResponse,
  MeResponseSignedIn,
  SubmissionDetail,
  TranslationGradingResult,
} from '@gsat/shared';
import type { EssayIndex, EssayPrompt, TranslationIndex, TranslationSet } from '../data';

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (status: number, code: string) => jsonResponse({ error: { code, message: code } }, status);

export const FEATURES_ON: FeaturesResponse = { auth: true, ai: true, ocr: true, aiPaused: false };
export const FEATURES_OFF: FeaturesResponse = { auth: false, ai: false, ocr: false, aiPaused: false };

export function meWith(aiStatus: 'none' | 'pending' | 'approved' = 'approved'): MeResponseSignedIn {
  return {
    user: {
      id: 'u-1',
      display_name: '小明',
      role: 'student',
      status: 'active',
      age_band: 'under18',
      ai_status: aiStatus,
      ai_tier: 'standard',
      created_at: 1_790_000_000,
    },
    pending_consents: [],
    onboarded: true,
    consent_versions: { privacy: '2026-10-01', terms: '2026-10-01', ai: '2026-10-01' },
    login_at: 1_790_000_000,
  };
}

export const QUOTA: AiQuotaResponse = {
  ai_status: 'approved',
  tier: 'standard',
  points: { day_used: 10, day_limit: 30, month_used: 40, month_limit: 300 },
  essays: { day_used: 1, day_limit: 3 },
  concurrent: { active: 0, limit: 2 },
  site: { paused: false, budget_available: true },
  approval: { cap: 49, approved: 10, full: false },
  resets_at: { day: '2026-10-08T16:00:00Z', month: '2026-10-31T16:00:00Z' },
  task_points: { translation_grade: 3, essay_grade: 7, essay_ocr: 2 },
};

const REF = {
  exam: 'gsat' as const,
  session: 'regular' as const,
  target: null,
  paper_url: 'https://www.ceec.edu.tw/paper.pdf',
  scoring_url: 'https://www.ceec.edu.tw/scoring.pdf',
  section_id: 's7',
  points_total: 8,
  passage: null,
  topic: null,
};

export const SET_115: TranslationSet = {
  ...REF,
  exam_id: 'gsat-115',
  year: 115,
  title: '115學年度學科能力測驗英文考科',
  group_id: 's7g1',
  section_title: '一、中譯英（占8分）',
  instructions: '說明：依題號將以下中文句子譯成正確、通順、達意的英文。',
  items: [
    { no: 1, label: '中譯英1', stem: '現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。', points: 4, patterns: ['現在完成式'] },
    { no: 2, label: '中譯英2', stem: '他們將學生依英語能力分成不同組別，進行多樣的聽、說活動。', points: 4, patterns: [] },
  ],
};

export const SET_AST_110: TranslationSet = {
  ...REF,
  exam: 'ast',
  exam_id: 'ast-110',
  year: 110,
  title: '110學年度指定科目考試英文考科',
  group_id: 's6g1',
  section_title: '一、中譯英',
  instructions: '說明：…',
  items: [
    { no: 1, label: '中譯英1', stem: '指考第一句。', points: 4, patterns: [] },
    { no: 2, label: '中譯英2', stem: '指考第二句。', points: 4, patterns: [] },
  ],
};

export const SET_84: TranslationSet = {
  ...REF,
  exam_id: 'gsat-84',
  year: 84,
  title: '84學年度學科能力測驗英文考科',
  group_id: 's5g1',
  section_title: '一、中譯英',
  instructions: '說明：試將以下五個中文句子譯成英文。',
  points_total: 20,
  items: [1, 2, 3, 4, 5].map((n) => ({ no: n, label: `中譯英${n}`, stem: `第${n}句中文。`, points: 4, patterns: [] })),
};

export const TRANSLATION_INDEX: TranslationIndex = { version: 'test', count: 3, sets: [SET_115, SET_84, SET_AST_110] };

export const PROMPT_115: EssayPrompt = {
  ...REF,
  exam_id: 'gsat-115',
  year: 115,
  title: '115學年度學科能力測驗英文考科',
  section_id: 's8',
  group_id: 's8g1',
  section_title: '二、英文作文（占20分）',
  instructions: '說明︰依提示寫一篇英文作文，文長至少120個單詞（words）。',
  points_total: 20,
  label: '英文作文',
  stem: '提示︰近年來養寵物的風氣在臺灣日漸普遍。請寫一篇英文作文，文分兩段。',
  figures: [{ kind: 'photo', label: null, caption: '圖片1：公園步道', description: '公園步道上幾組人帶著狗散步。', rows: null }],
  essay_type: 'picture',
  paragraphs: 2,
  word_count: { min: 120, max: null, approx: null },
  answer_sheet_url: 'https://www.ceec.edu.tw/sheet.pdf',
};

export const ESSAY_INDEX: EssayIndex = { version: 'test', count: 1, prompts: [PROMPT_115] };

const BASE: Omit<SubmissionDetail, 'id' | 'kind' | 'group_id' | 'status' | 'body'> = {
  input_mode: 'typed',
  final_score: null,
  final_band: null,
  created_at: 1_791_400_000,
  updated_at: 1_791_400_100,
  graded_at: null,
  self_assess: null,
  word_count: null,
  paragraphs: null,
  op_id: 'op-1',
  ocr: null,
  photos: [],
  grading: null,
  failure: null,
};

export const T1 = 'More and more high school English teacher have increase the percentage of using English in class.';
export const T2 = 'they divide students into different groups.';

export const TRANSLATION_GRADING: TranslationGradingResult = {
  kind: 'translation',
  final_score: 5.75,
  max_score: 8,
  sentence_scores: [3, 2.75],
  third_rater_used: true,
  raters: [
    { role: 'second', score: 6, sentences: [{ sentence_index: 0, score: 3, part_scores: null, mechanics_deduction: 0 }, { sentence_index: 1, score: 3, part_scores: null, mechanics_deduction: 0 }] },
    { role: 'primary', score: 5.5, sentences: [{ sentence_index: 0, score: 3, part_scores: [1, 0.5, 0.5, 1], mechanics_deduction: 0 }, { sentence_index: 1, score: 2.5, part_scores: [1, 1, 0.5, 0.5], mechanics_deduction: 0.5 }] },
    { role: 'third', score: 2, sentences: [] },
  ],
  errors: [
    { sentence_index: 0, start: 34, end: 41, excerpt: 'teacher', part: 1, category: 'grammar', explanation_zh: 'more and more 後面接複數名詞。', suggestion: 'teachers', repeat_of: null, deducted: 0.5 },
    { sentence_index: 0, start: 47, end: 55, excerpt: 'increase', part: 2, category: 'grammar', explanation_zh: '完成式要用過去分詞。', suggestion: 'increased', repeat_of: null, deducted: 0.5 },
    // 位移故意錯開：前端要能依 excerpt 找回正確位置。
    { sentence_index: 1, start: 3, end: 7, excerpt: 'they', part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'They', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, start: 0, end: 4, excerpt: 'they', part: null, category: 'capitalization', explanation_zh: '重複的錯誤。', suggestion: 'They', repeat_of: 2, deducted: 0 },
  ],
  corrected: ['More and more high school English teachers have increased the percentage of English used in class.', 'They divide students into different groups.'],
  explanation_zh: ['注意單複數與完成式。', '句首要大寫。'],
};

export function translationSubmission(patch: Partial<SubmissionDetail> = {}): SubmissionDetail {
  return {
    ...BASE,
    id: 'sub-t',
    kind: 'translation',
    group_id: 'gsat-115.s7g1@1',
    status: 'graded',
    final_score: 5.75,
    body: { items: [{ item_id: 'gsat-115.s7g1@1#中譯英1', text: T1 }, { item_id: 'gsat-115.s7g1@1#中譯英2', text: T2 }] },
    grading: TRANSLATION_GRADING,
    ...patch,
  };
}

export const ESSAY_TEXT =
  'In recent years, more and more people treat pets like children. In the pictures, we can see a man carry his dog.\n\nI think there are two reason for this.';

export const ESSAY_GRADING: EssayGradingResult = {
  kind: 'essay',
  final_score: 12.5,
  max_score: 20,
  band: 'fair',
  third_rater_used: false,
  off_topic: false,
  criteria: {
    content: { score: 3.5, explanation_zh: '內容切題但細節不足。' },
    organization: { score: 3.5, explanation_zh: '分兩段、有轉折。' },
    grammar: { score: 3, explanation_zh: '感官動詞後的動詞形式錯誤。' },
    vocabulary: { score: 2.5, explanation_zh: '用字重複。' },
  },
  raters: [
    { role: 'primary', scores: { content: 4, organization: 4, grammar: 3, vocabulary: 3 }, off_topic: false, total: 13, comment_zh: '第一位的評語。' },
    { role: 'second', scores: { content: 3, organization: 3, grammar: 3, vocabulary: 2 }, off_topic: false, total: 12, comment_zh: '第二位的評語。' },
  ],
  deductions: [{ code: 'too_short', points: 1 }],
  word_count: 30,
  paragraphs: 2,
  top_improvements: ['加一個具體經驗。', '注意感官動詞。', '寫到 120 個單詞。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '第二段要說明影響。' }],
  errors: [
    { paragraph_index: 0, start: 98, end: 103, excerpt: 'carry', category: 'grammar', explanation_zh: 'see + 受詞 + V-ing。', suggestion: 'carrying' },
    { paragraph_index: 1, start: 136, end: 142, excerpt: 'reason', category: 'spelling', explanation_zh: 'two 後面接複數。', suggestion: 'reasons' },
  ],
  rewrite: 'In recent years, more and more people have started treating their pets like children.',
  safety_flag: null,
};

export function essaySubmission(patch: Partial<SubmissionDetail> = {}): SubmissionDetail {
  return {
    ...BASE,
    id: 'sub-e',
    kind: 'essay',
    group_id: 'gsat-115.s8g1@1',
    status: 'graded',
    final_score: 12.5,
    final_band: 'fair',
    body: { text: ESSAY_TEXT, plan: null },
    self_assess: { kind: 'essay', scores: { content: 4, organization: 4, grammar: 4, vocabulary: 4 } },
    grading: ESSAY_GRADING,
    ...patch,
  };
}

/** 依「方法＋路徑」回應的假 fetch；沒有對應的一律 404（統一錯誤格式）。呼叫紀錄在 calls。 */
export type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

export interface FetchMock {
  calls: Array<{ method: string; path: string; body: unknown }>;
  fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export function createFetchMock(routes: Record<string, Handler>): FetchMock {
  const calls: FetchMock['calls'] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // 原樣保留
      }
    }
    calls.push({ method, path: url.pathname + url.search, body });
    const handler = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    if (handler) return handler(init, url);
    return apiError(404, 'not_found');
  };
  return { calls, fn };
}

/** 靜態資料（/data/writing/*.json）與功能開關、登入狀態的基本路由。 */
export function baseRoutes(features: FeaturesResponse, me: MeResponse = { user: null }): Record<string, Handler> {
  return {
    'GET /data/writing/translation.json': () => jsonResponse(TRANSLATION_INDEX),
    'GET /data/writing/essay.json': () => jsonResponse(ESSAY_INDEX),
    'GET /api/features': () => jsonResponse(features),
    'GET /api/me': () => jsonResponse(me),
    'GET /api/ai/quota': () => jsonResponse(QUOTA),
  };
}
