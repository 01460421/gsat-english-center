/**
 * 英文作文自訂題目的測試資料與小工具（docs/design/custom-essay.md §7.2–§7.4）。題目與作文都是本站自己寫的句子。
 *
 * 假指紋：fakeFingerprintFile 用 packages/shared/scripts/d8-fingerprint.mjs（產生器用的同一套正規形式與雜湊），
 * 從測試自己編的「評分說明」造出 d8-fingerprints.json 的同格式物件，給 vi.mock 換掉打包的真指紋檔。
 */
import { CUSTOM_ESSAY_GROUP_ID, type CustomEssayPromptInput } from '@gsat/shared';
import { D8_ENGLISH_RUN, D8_FP_FORMAT, D8_HAN_WINDOW, d8EnglishWindows, d8Hash, d8HanWindows, packFingerprints } from '../../../../packages/shared/scripts/d8-fingerprint.mjs';
import type { SessionUser } from '../../src/auth/session';
import type { Env } from '../../src/env';
import { call, makeEnv, type TestEnv } from './ai';
import type { TestD1 } from './d1';

/**
 * 自訂題目打開的 env：makeEnv＋明確設定 AI_CUSTOM_ESSAY=on。
 * 正式環境的預設是 off（評分對照通過之前，src/config.ts 的 CONFIG_DEFAULTS 與 wrangler.toml），所以要建立自訂題、
 * 送批改或跑 consumer 的測試都要用這個；測「沒設時是關的」改用 makeEnv。
 */
export function customEnv(overrides: Partial<Env> = {}, db?: TestD1): TestEnv {
  return makeEnv({ AI_CUSTOM_ESSAY: 'on', ...overrides }, db);
}

/** 學生貼上的題目（中文說明，兩段、至少 120 字）。 */
export const CUSTOM_TASK =
  '提示：你的學校即將舉辦「無手機日」，當天所有同學都不能使用手機。請寫一篇英文作文，文分兩段，第一段說明你對這個活動的看法，第二段描述你那天會怎麼安排時間。';

export const CUSTOM_PROMPT_INPUT: CustomEssayPromptInput = { text: CUSTOM_TASK, figure_text: null, paragraphs: 2, min_words: 120, max_words: null };

/** 自訂題的作文：兩段、約 130 個單詞（本站自己寫的練習作文）。 */
export const CUSTOM_ESSAY = [
  'I think No-Phone Day is a good idea for our school. Many students check their phones during every break, and they seldom talk to the people around them. Without phones for one day, we can pay more attention to our classes and our friends. It may feel strange at first, but it will remind us that life is more than a small screen.',
  'On that day, I will arrive at school early and play basketball with my classmates before the first class. During lunch, I will read a novel in the library instead of watching videos. After school, I plan to walk home with my best friend and talk about our plans for the summer. I believe it will be a relaxing and meaningful day.',
].join('\n\n');

/** 測試自己編的「官方評分說明」（漢字）與「官方參考譯文」（英文）：只用來造假指紋，不是任何真實的官方文字。 */
export const FAKE_OFFICIAL_ZH = '這是一段只給自動測試使用的假官方文字內容絕對不會出現在正常題目裡';
export const FAKE_OFFICIAL_EN = 'this invented sentence only exists inside the automated test suite for fingerprints';

export interface FingerprintFile {
  format: string;
  han_window: number;
  english_run: number;
  count: { han: number; en: number };
  version: string;
  han: string;
  en: string;
}

/** 和產生器輸出同格式的假指紋檔。 */
export function fakeFingerprintFile(zh: string[] = [FAKE_OFFICIAL_ZH], en: string[] = [FAKE_OFFICIAL_EN]): FingerprintFile {
  const han = new Set(zh.flatMap((t) => d8HanWindows(t).map((w) => d8Hash('han', w.window))));
  const eng = new Set(en.flatMap((t) => d8EnglishWindows(t).map((w) => d8Hash('en', w.window))));
  return {
    format: D8_FP_FORMAT,
    han_window: D8_HAN_WINDOW,
    english_run: D8_ENGLISH_RUN,
    count: { han: han.size, en: eng.size },
    version: 'test-fp-0001',
    han: packFingerprints(han),
    en: packFingerprints(eng),
  };
}

/** POST 一份自訂題。 */
export function createCustom(
  env: TestEnv,
  user: SessionUser,
  prompt: unknown = CUSTOM_PROMPT_INPUT,
  extra: Record<string, unknown> = { input_mode: 'typed', body: { text: CUSTOM_ESSAY } },
) {
  return call(env, user, 'POST', '/api/submissions', { kind: 'essay', custom_prompt: prompt, ...extra });
}

/** 某份提交的題目列（直接查 D1）。 */
export function promptRow(db: TestD1, submissionId: string): Record<string, unknown> | undefined {
  return db.sqlite.prepare('SELECT * FROM submission_custom_prompts WHERE submission_id = ?').get(submissionId) as Record<string, unknown> | undefined;
}

/** 列數（submissions 與題目表），確認「被擋下的請求沒有寫入任何一列」。 */
export function rowCounts(db: TestD1): { submissions: number; prompts: number } {
  const n = (sql: string) => (db.sqlite.prepare(sql).get() as { n: number }).n;
  return { submissions: n('SELECT COUNT(*) AS n FROM submissions'), prompts: n('SELECT COUNT(*) AS n FROM submission_custom_prompts') };
}

/** 直接用 SQL 建一份自訂題（不經 API：測遷移的 CHECK 與 trigger、匯出與刪帳號用）。 */
export function seedCustomSubmission(db: TestD1, userId: number, id: string, prompt = CUSTOM_TASK, status = 'draft'): void {
  db.sqlite
    .prepare(`INSERT INTO submissions (id, user_id, kind, group_id, input_mode, body_json, status) VALUES (?, ?, 'essay', ?, 'typed', ?, ?)`)
    .run(id, userId, CUSTOM_ESSAY_GROUP_ID, JSON.stringify({ text: CUSTOM_ESSAY, plan: null }), status);
  db.sqlite
    .prepare(`INSERT INTO submission_custom_prompts (submission_id, user_id, prompt_text, figure_text, paragraphs, min_words, max_words) VALUES (?, ?, ?, NULL, 2, 120, NULL)`)
    .run(id, userId, prompt);
}
