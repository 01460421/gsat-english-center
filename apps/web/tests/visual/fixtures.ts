/**
 * 截圖工具共用的固定資料：時間、帳號狀態、寫作的假提交與寫作紀錄。
 *
 * 版面截圖（capture.shots.ts）與桌機改版的前後對照截圖（audit/desktop.audit.ts）共用同一份，兩套截圖的寫作紀錄、批改結果才會一樣。
 * 假資料的錯誤標註與修正版都是本站自己寫的；沒有任何官方參考譯文、評分原則全文或佳作（D8）。
 */
import type {
  CustomEssayPrompt,
  EssayGradingResult,
  MeResponse,
  SubmissionDetail,
  SubmissionSummary,
  TranslationGradingResult,
} from '@gsat/shared';
import { QUOTA, signedInMe } from '../support/backend';

// ───────────────────────── 固定的時間與帳號狀態 ─────────────────────────

const FIXED_NOW = new Date('2026-10-18T10:00:00+08:00');
const NOW_S = Math.floor(FIXED_NOW.getTime() / 1000);
const QUOTA_NOW = { ...QUOTA, resets_at: { day: '2026-10-18T16:00:00Z', month: '2026-10-31T16:00:00Z' } };

/**
 * 帳號狀態：
 *   anon         沒登入（登入、AI、自訂題目批改都開著：正式站的設定），版面上看得到登入按鈕；
 *   student      已登入、AI 已核准（features 含 customEssay: true），有寫作紀錄；
 *   student-none 已登入、還沒申請 AI；
 *   admin        站主（後台）；
 *   welcome      第一次登入、還沒同意條款（會被導到 /account/welcome）。
 */
type Who = 'anon' | 'student' | 'student-none' | 'admin' | 'welcome';

function meFor(who: Who): MeResponse {
  const rest = { login_at: NOW_S - 3600 };
  switch (who) {
    case 'anon':
      return { user: null };
    case 'student':
      return signedInMe({ ai_status: 'approved' }, rest);
    case 'student-none':
      return signedInMe({ ai_status: 'none' }, rest);
    case 'admin':
      return signedInMe({ id: 'u-admin', display_name: '站主', role: 'admin', ai_status: 'approved', ai_tier: 'unlimited' }, rest);
    case 'welcome':
      return signedInMe({ display_name: 'Wang Xiao-Ming', age_band: null }, { ...rest, pending_consents: ['privacy', 'terms'], onboarded: false });
  }
}

// ───────────────────────── 寫作的假資料（批改結果頁、寫作紀錄） ─────────────────────────

const EXAM_TR_GROUP = 'gsat-115.s7g1@1';
const EXAM_ES_GROUP = 'gsat-115.s8g1@1';
const BANK_TR_CODE = '1d423d';
const BANK_TR_GROUP = `ai.tr.${BANK_TR_CODE}@1`;
const BANK_CP_CODE = '0e89ae';
const BANK_CP_GROUP = `ai.cp.${BANK_CP_CODE}@1`;
const CUSTOM_GROUP = 'custom:essay@1';

const T1 = 'More and more high school English teacher have increase the percentage of using English in class.';
const T2 = 'they divide students into different groups.';
const B1 = 'Since last year, I have been learn to play the guitar at home by myself.';
const B2 = 'to learn new songs, I often watch guitar teaching video on the Internet.';

const EXAM_ESSAY = [
  'In recent years, more and more people treat their pets like children. In the pictures, we can see a man carry his dog in a baby carrier, ' +
    'and a woman buying expensive clothes for her cat. Some people even hold birthday parties for their pets and spend a lot of money on special food.',
  'I think there are two reason for this. First, many young couples decide not to have children, so pets become important members of their families. ' +
    'Second, pets give us comfort when we feel lonely or stressed. However, we should remember that pets are animals, not toys, and we must take care of them responsibly.',
].join('\n\n');

/**
 * 字數與段數都不足的作文（107 個單詞、只有 1 段）：作答頁的「少於 120 個單詞」「未分段」兩個提醒，
 * 以及桌機送出 AI 批改前的確認列（docs/design/desktop-polish.md §3.12）。
 */
const SHORT_ESSAY =
  'In recent years, more and more people treat their pets like children. In the pictures, we can see a man carry his dog in a baby carrier, ' +
  'and a woman buying expensive clothes for her cat. Some people even hold birthday parties for their pets and spend a lot of money on special food. ' +
  'I think there are two reason for this. First, many young couples decide not to have children, so pets become important members of their families. ' +
  'Second, pets give us comfort when we feel lonely or stressed. However, we should remember that pets are animals, not toys, and we must take care of them.';

const CUSTOM_ESSAY = [
  'No-Phone Day is a good idea for our school. Many students check their phones during every break, and some of them even use their phones in class. ' +
    'If we put our phones away for one day, we can talk to our friends face to face and pay more attention to our teachers.',
  'On that day, I will arrive at school early and read a novel in the library. During lunch, I will play basketball with my classmates instead of watching videos. ' +
    'After school, I will write a short diary about how I felt without my phone. I think it will be a challenging but meaningful experience for everyone.',
].join('\n\n');
const CUSTOM_PROMPT_TEXT =
  '提示：你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。請寫一篇英文作文，文分兩段，第一段說明你對這個活動的看法，第二段描述你那天會怎麼安排時間。';

const span = (text: string, word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length, excerpt: word });

const EXAM_TR_GRADING: TranslationGradingResult = {
  kind: 'translation',
  final_score: 5.75,
  max_score: 8,
  sentence_scores: [3, 2.75],
  third_rater_used: false,
  raters: [
    {
      role: 'primary',
      score: 5.5,
      sentences: [
        { sentence_index: 0, score: 3, part_scores: [1, 0.5, 0.5, 1], mechanics_deduction: 0 },
        { sentence_index: 1, score: 2.5, part_scores: [1, 1, 0.5, 0.5], mechanics_deduction: 0.5 },
      ],
    },
    {
      role: 'second',
      score: 6,
      sentences: [
        { sentence_index: 0, score: 3, part_scores: null, mechanics_deduction: 0 },
        { sentence_index: 1, score: 3, part_scores: null, mechanics_deduction: 0 },
      ],
    },
  ],
  errors: [
    { sentence_index: 0, ...span(T1, 'teacher'), part: 1, category: 'grammar', explanation_zh: 'more and more 後面接複數名詞。', suggestion: 'teachers', repeat_of: null, deducted: 0.5 },
    { sentence_index: 0, ...span(T1, 'increase'), part: 2, category: 'grammar', explanation_zh: '完成式要用過去分詞。', suggestion: 'increased', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(T2, 'they'), part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'They', repeat_of: null, deducted: 0.5 },
  ],
  corrected: ['More and more high school English teachers have increased the percentage of English used in class.', 'They divide students into different groups.'],
  explanation_zh: ['注意單複數與完成式。', '句首要大寫。'],
};

const BANK_TR_GRADING: TranslationGradingResult = {
  ...EXAM_TR_GRADING,
  final_score: 6.5,
  sentence_scores: [3.5, 3],
  errors: [
    { sentence_index: 0, ...span(B1, 'learn'), part: 2, category: 'grammar', explanation_zh: '現在完成進行式是 have been + V-ing。', suggestion: 'learning', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(B2, 'to'), part: null, category: 'capitalization', explanation_zh: '句首要大寫。', suggestion: 'To', repeat_of: null, deducted: 0.5 },
    { sentence_index: 1, ...span(B2, 'video'), part: 4, category: 'grammar', explanation_zh: '泛指時用複數。', suggestion: 'videos', repeat_of: null, deducted: 0.5 },
  ],
  corrected: ['Since last year, I have been learning to play the guitar at home by myself.', 'To learn new songs, I often watch guitar tutorial videos on the Internet.'],
  explanation_zh: ['完成進行式的動詞形式。', '句首大寫、名詞單複數。'],
};

const EXAM_ES_GRADING: EssayGradingResult = {
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
  deductions: [],
  word_count: 118,
  paragraphs: 2,
  top_improvements: ['加一個具體經驗。', '注意感官動詞。', '第二段的理由再多一點說明。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '第二段要說明影響。' }],
  errors: [
    { paragraph_index: 0, start: 0, end: 0, excerpt: 'carry', category: 'grammar', explanation_zh: 'see + 受詞 + V-ing。', suggestion: 'carrying' },
    { paragraph_index: 1, start: 0, end: 0, excerpt: 'reason', category: 'grammar', explanation_zh: 'two 後面接複數。', suggestion: 'reasons' },
  ],
  rewrite: null,
  safety_flag: null,
};

const CUSTOM_GRADING: EssayGradingResult = {
  ...EXAM_ES_GRADING,
  final_score: 15,
  band: 'good',
  criteria: {
    content: { score: 4, explanation_zh: '兩段都回應了題目的要求，例子具體。' },
    organization: { score: 4, explanation_zh: '依題目分成兩段，段落之間銜接自然。' },
    grammar: { score: 3.5, explanation_zh: '句型大多正確，可以多用複合句。' },
    vocabulary: { score: 3.5, explanation_zh: '用字恰當，可以再多一些變化。' },
  },
  raters: [
    { role: 'primary', scores: { content: 4, organization: 4, grammar: 4, vocabulary: 4 }, off_topic: false, total: 16, comment_zh: '內容完整、分段清楚。' },
    { role: 'second', scores: { content: 4, organization: 4, grammar: 3, vocabulary: 3 }, off_topic: false, total: 14, comment_zh: '用字可以更精確。' },
  ],
  word_count: 112,
  top_improvements: ['第一段多一個具體的理由。', '多用連接詞串起句子。', '注意 challenging 的拼法。'],
  paragraph_advice: [{ paragraph_index: 1, advice_zh: '結尾可以呼應第一段的看法。' }],
  errors: [{ paragraph_index: 0, start: 0, end: 0, excerpt: 'Many students', category: 'grammar', explanation_zh: '可以加上 In fact 讓語氣更自然。', suggestion: 'In fact, many students' }],
};

const CUSTOM_PROMPT: CustomEssayPrompt = {
  text: CUSTOM_PROMPT_TEXT,
  figure_text: '一張學生把手機放進教室門口收納箱的照片。',
  paragraphs: 2,
  min_words: 120,
  max_words: null,
  updated_at: NOW_S - 7200,
};
const CUSTOM_TITLE = '你的學校即將舉辦「無手機日」，當天所有人都不能使用手機。…';

function detail(patch: Partial<SubmissionDetail> & Pick<SubmissionDetail, 'id' | 'kind' | 'group_id' | 'status'>): SubmissionDetail {
  return {
    input_mode: 'typed',
    final_score: null,
    final_band: null,
    created_at: NOW_S - 7200,
    updated_at: NOW_S - 7100,
    graded_at: null,
    body: null,
    self_assess: null,
    word_count: null,
    paragraphs: null,
    op_id: null,
    ocr: null,
    photos: [],
    grading: null,
    failure: null,
    custom_title: null,
    custom_prompt: null,
    ...patch,
  };
}

const SUBMISSIONS: Record<string, SubmissionDetail> = {
  'sub-t1': detail({
    id: 'sub-t1',
    kind: 'translation',
    group_id: EXAM_TR_GROUP,
    status: 'graded',
    op_id: 'op-t1',
    final_score: 5.75,
    graded_at: NOW_S - 7000,
    body: { items: [{ item_id: `${EXAM_TR_GROUP}#中譯英1`, text: T1 }, { item_id: `${EXAM_TR_GROUP}#中譯英2`, text: T2 }] },
    grading: EXAM_TR_GRADING,
  }),
  'sub-b1': detail({
    id: 'sub-b1',
    kind: 'translation',
    group_id: BANK_TR_GROUP,
    status: 'graded',
    op_id: 'op-b1',
    final_score: 6.5,
    graded_at: NOW_S - 6000,
    body: { items: [{ item_id: `${BANK_TR_GROUP}#1`, text: B1 }, { item_id: `${BANK_TR_GROUP}#2`, text: B2 }] },
    grading: BANK_TR_GRADING,
  }),
  'sub-e1': detail({
    id: 'sub-e1',
    kind: 'essay',
    group_id: EXAM_ES_GROUP,
    status: 'graded',
    op_id: 'op-e1',
    final_score: 12.5,
    final_band: 'fair',
    graded_at: NOW_S - 5000,
    word_count: 118,
    paragraphs: 2,
    body: { text: EXAM_ESSAY },
    grading: EXAM_ES_GRADING,
  }),
  'sub-c1': detail({
    id: 'sub-c1',
    kind: 'essay',
    group_id: CUSTOM_GROUP,
    status: 'graded',
    op_id: 'op-c1',
    final_score: 15,
    final_band: 'good',
    graded_at: NOW_S - 4000,
    word_count: 112,
    paragraphs: 2,
    body: { text: CUSTOM_ESSAY },
    grading: CUSTOM_GRADING,
    custom_title: CUSTOM_TITLE,
    custom_prompt: CUSTOM_PROMPT,
  }),
  'sub-q1': detail({
    id: 'sub-q1',
    kind: 'translation',
    group_id: EXAM_TR_GROUP,
    status: 'queued',
    op_id: 'op-q1',
    body: { items: [{ item_id: `${EXAM_TR_GROUP}#中譯英1`, text: T1 }, { item_id: `${EXAM_TR_GROUP}#中譯英2`, text: T2 }] },
  }),
};

const OPS: Record<string, { task: string; points: number; status: 'settled' | 'queued' }> = {
  'op-t1': { task: 'translation_grade', points: 3, status: 'settled' },
  'op-b1': { task: 'translation_grade', points: 3, status: 'settled' },
  'op-e1': { task: 'essay_grade', points: 7, status: 'settled' },
  'op-c1': { task: 'essay_grade', points: 7, status: 'settled' },
  'op-q1': { task: 'translation_grade', points: 3, status: 'queued' },
};

function summary(d: SubmissionDetail): SubmissionSummary {
  return {
    id: d.id,
    kind: d.kind,
    group_id: d.group_id,
    input_mode: d.input_mode,
    status: d.status,
    final_score: d.final_score,
    final_band: d.final_band,
    created_at: d.created_at,
    updated_at: d.updated_at,
    graded_at: d.graded_at,
    custom_title: d.custom_title ?? null,
  };
}

/** 寫作紀錄：中譯英 4 筆（含 1 筆草稿、1 筆排隊中）、作文 3 筆（歷屆、自訂、本站仿真草稿）。 */
function historyRows(kind: string | null): SubmissionSummary[] {
  const draftTr = summary(detail({ id: 'sub-d1', kind: 'translation', group_id: 'gsat-114.s7g1@1', status: 'draft', created_at: NOW_S - 86_400 * 3, updated_at: NOW_S - 86_400 * 3 }));
  const draftEs = summary(detail({ id: 'sub-d2', kind: 'essay', group_id: BANK_CP_GROUP, status: 'draft', created_at: NOW_S - 86_400 * 2, updated_at: NOW_S - 86_400 * 2 }));
  const s = SUBMISSIONS;
  const tr = [s['sub-q1'], s['sub-b1'], s['sub-t1']].filter((d): d is SubmissionDetail => d !== undefined).map(summary);
  const es = [s['sub-c1'], s['sub-e1']].filter((d): d is SubmissionDetail => d !== undefined).map(summary);
  if (kind === 'essay') return [...es, draftEs];
  if (kind === 'translation') return [...tr, draftTr];
  return [...tr, draftTr, ...es, draftEs];
}

export {
  B1,
  B2,
  BANK_CP_CODE,
  BANK_TR_CODE,
  CUSTOM_ESSAY,
  CUSTOM_PROMPT_TEXT,
  EXAM_ESSAY,
  FIXED_NOW,
  NOW_S,
  OPS,
  QUOTA_NOW,
  SHORT_ESSAY,
  SUBMISSIONS,
  T1,
  T2,
  detail,
  historyRows,
  meFor,
  summary,
};
export type { Who };
