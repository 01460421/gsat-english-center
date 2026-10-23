/**
 * /api/submissions*：中譯英與作文的提交（ARCHITECTURE §10.4；DB_SCHEMA §3.6）。負責：後端 AI A2。
 * 型別在 @gsat/shared 的 writing.ts。所有查詢都帶 `AND user_id = ?`（防 IDOR）：別人的提交一律 404。
 *
 *   POST   /api/submissions                 CreateSubmissionBody → 201 SubmissionDetail（requireUser；自訂作文題目另外要 AI 已核准）
 *   GET    /api/submissions?kind=&cursor=   SubmissionListResponse（自訂題每一列多 custom_title）
 *   GET    /api/submissions/:id             SubmissionDetail（前端輪詢這支；自訂題多 custom_prompt）
 *   PUT    /api/submissions/:id             UpdateSubmissionBody → SubmissionDetail（只在 draft／ocr_ready／confirmed／failed；
 *                                           帶 custom_prompt 時只限自訂題、要 AI 已核准，題目列的 rev 加 1）
 *   DELETE /api/submissions/:id             204（連同暫存照片與批改；批改進行中 409）
 *   POST   /api/submissions/:id/photos?ord=1|2  multipart，一次一張，欄位 `photo`（JPEG／PNG／WebP、≤1.2 MB、長邊 ≤1600 px）
 *                                           → PhotoUploadResponse（存檔前剝除 EXIF 等中繼資料；結構不認得或讀不到寬高就拒絕；
 *                                           讀取與檢查在 photoUpload.ts，學習助手的題目照片共用）
 *                                           （requireAiApproved；每次上傳先刪掉所有超過 24 小時的暫存照片，以及同一人
 *                                           其他提交〔不在辨識中〕的暫存照片；每人最多暫存 PHOTO_TEMP_MAX_PER_USER 張）
 *   DELETE /api/submissions/:id/photos      PhotoUploadResponse（學生自己刪全部照片）
 *   PUT    /api/submissions/:id/confirm     ConfirmOcrBody → SubmissionDetail（ocr_ready → confirmed；記差異量、立即刪照片）
 *
 * 英文作文自訂題目（docs/design/custom-essay.md §2.6）：POST 的本體帶 custom_prompt、不帶 group_id，伺服器一律寫
 * CUSTOM_ESSAY_GROUP_ID；題目存在 submission_custom_prompts（custom.ts）。建立與修改題目要 AI 已核准（安全審查 S6），
 * 只改作文、自評或刪除維持只要登入（被撤銷核准的人仍然要能管理自己的資料）。
 *
 * 照片上傳是「寫入類 API 只收 JSON」的唯一例外（multipart），同樣經過 Origin 檢查與登入（ARCHITECTURE §7）。
 * 其他寫入一律 Content-Type: application/json，本體邊讀邊數（A1 的 readJsonBody／readBodyBytes），超過上限 413，
 * 不會把超大本體整個讀進記憶體。
 */
import {
  AI_ERROR_MESSAGES,
  CUSTOM_ESSAY_GROUP_ID,
  CUSTOM_PROMPT_LIMITS,
  CUSTOM_PROMPT_NOT_FOUND_MESSAGE,
  CUSTOM_PROMPT_PROBLEM_MESSAGES,
  PHOTO_MAX_AGE_HOURS,
  SUBMISSION_KINDS,
  WRITING_UNKNOWN_GROUP_MESSAGE,
  countEnglishWords,
  countParagraphs,
  isCustomEssayGroupId,
  type CustomPromptValue,
  type EssayBody,
  type PhotoUploadResponse,
  type SubmissionKind,
  type SubmissionListResponse,
  type TranslationBody,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import * as z from 'zod/v4';
import { readJsonBody } from '../account/validate';
import { getWritingGroup, ensureItemGroupStatement, type WritingGroup } from '../ai/bank';
import { sanitizeStudentText } from '../ai/filter';
import { userRefFor } from '../ai/ledger';
import { wordEditDistance } from '../ai/scoring';
import { assertAiApproved, getSessionUser, requireAiApproved, requireUser, type SessionUser } from '../auth/session';
import { base64UrlDecodeText, base64UrlEncode } from '../auth/crypto';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { nowSeconds } from '../time';
import { groupForSubmission, insertCustomPromptStatement, requireCustomEssayAvailable, updateCustomPromptStatement, validateCustomPrompt } from './custom';
import { photoBlob, photoOrd, readPhotoFile } from './photoUpload';
import { LIST_SUBMISSIONS, listPhotoMeta, parseJson, requireSubmission, toDetail, toSummary, type SubmissionRow } from './repo';
import { bodyJson, normalizeEssayBody, normalizeSelfAssess, normalizeTranslationBody } from './validate';

export const submissionRoutes = new Hono<AppEnv>();

/** 每人 24 小時內最多建立幾份提交（擋程式化灌資料；正常使用遠低於此）。 */
export const SUBMISSIONS_PER_DAY = 100;
/** 可以修改內容的狀態（writing.ts 的狀態機註解）。 */
const EDITABLE = new Set(['draft', 'ocr_ready', 'confirmed', 'failed']);
/** 批改或辨識進行中：不能刪除、不能動照片。 */
const PENDING = new Set(['ocr_queued', 'queued', 'grading']);
const PAGE_SIZE = 20;
/**
 * 提交類 JSON 本體的上限（位元組）：body_json 最多 16,384 字元，中文一字 3 位元組，加上自評與 JSON 本身的
 * 符號，64 KB 綽綽有餘。
 */
export const SUBMISSION_JSON_MAX_BYTES = 64 * 1024;
/**
 * 每人同時暫存的照片上限：一份正在辨識的（同時任務最多 2 個，各 2 張）以外，其他提交的照片在上傳新照片時
 * 就會被刪掉，所以正常情況最多 4 張（4.8 MB）。
 */
export const PHOTO_TEMP_MAX_PER_USER = 4;
const jsonObjectSchema = z.record(z.string(), z.unknown());

async function sessionUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  return user;
}

/** 讀 JSON 物件本體（只收 application/json、最多 SUBMISSION_JSON_MAX_BYTES）。 */
async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  return readJsonBody(c, jsonObjectSchema, SUBMISSION_JSON_MAX_BYTES);
}

/** 作文保存期限（user_prefs.essay_retention；沒有偏好列時用預設 1 年）。NULL＝直到自己刪除。 */
async function expiresAt(db: D1Database, userId: number, now: number): Promise<number | null> {
  const pref = await db.prepare('SELECT essay_retention FROM user_prefs WHERE user_id = ?1').bind(userId).first<{ essay_retention: string }>();
  switch (pref?.essay_retention ?? '1y') {
    case 'forever':
      return null;
    case '30d':
      return now + 30 * 86_400;
    default:
      return now + 365 * 86_400;
  }
}

function essayStats(text: string, photoMode: boolean): { wordCount: number; paragraphs: number } {
  return { wordCount: countEnglishWords(text), paragraphs: countParagraphs(text, photoMode) };
}

function normalizeBody(group: WritingGroup, value: unknown): TranslationBody | EssayBody {
  return group.kind === 'translation' ? normalizeTranslationBody(group, value) : normalizeEssayBody(value);
}

/** 每人 24 小時最多建立 SUBMISSIONS_PER_DAY 份（題庫題與自訂題共用）。 */
async function assertCreateRate(db: D1Database, userId: number, now: number): Promise<void> {
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?1 AND created_at > ?2').bind(userId, now - 86_400).first<{ n: number }>();
  if ((recent?.n ?? 0) >= SUBMISSIONS_PER_DAY) throw new ApiError(429, 'rate_limited', '今天建立的作答太多了，請明天再試');
}

/**
 * custom_prompt 欄位的型別（只擋程式錯誤，回 400 bad_request）：必須是物件，圖片描述是字串、null 或省略。
 * 原文超過 textRawMaxChars／figureRawMaxChars 時在這裡就回 400 custom_prompt_invalid（text_too_long／figure_too_long），
 * 不等到核准與每日上限之後（安全審查 security-1；checkCustomPrompt 本身也會先看原文長度）。
 * 其他內容規則交給 validateCustomPrompt（400 custom_prompt_invalid）。
 */
function customPromptObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, 'bad_request', 'custom_prompt 必須是物件');
  const record = value as Record<string, unknown>;
  const text = record['text'];
  const figure = record['figure_text'];
  if (figure !== undefined && figure !== null && typeof figure !== 'string') throw new ApiError(400, 'bad_request', 'custom_prompt.figure_text 必須是字串或 null');
  const L = CUSTOM_PROMPT_LIMITS;
  if (typeof text === 'string' && text.length > L.textRawMaxChars) {
    throw new ApiError(400, 'custom_prompt_invalid', CUSTOM_PROMPT_PROBLEM_MESSAGES.text_too_long, { reason: 'text_too_long', field: 'text' });
  }
  if (typeof figure === 'string' && figure.length > L.figureRawMaxChars) {
    throw new ApiError(400, 'custom_prompt_invalid', CUSTOM_PROMPT_PROBLEM_MESSAGES.figure_too_long, { reason: 'figure_too_long', field: 'figure_text' });
  }
  return record;
}

/**
 * POST 的自訂作文題目變體（§2.6 的檢查順序）：種類與 group_id → AI 核准 → 總開關與指紋檔 → 輸入方式 → 每日上限 →
 * 題目規則與 D8 → 作文內容 → 同一個 batch 寫提交與題目列（rev 1）。被擋下的請求不寫任何一列。
 */
async function createCustomSubmission(c: Context<AppEnv>, user: SessionUser, input: Record<string, unknown>) {
  const db = c.env.DB;
  if (input['kind'] !== 'essay') throw new ApiError(400, 'bad_request', '自訂題目只能用在英文作文');
  if (input['group_id'] !== undefined) throw new ApiError(400, 'bad_request', '自訂題目不能同時指定 group_id');
  const promptInput = customPromptObject(input['custom_prompt']);
  assertAiApproved(user);
  const config = loadConfig(c.env);
  const fp = await requireCustomEssayAvailable(db, config);
  const inputMode = input['input_mode'] ?? 'typed';
  if (inputMode !== 'typed' && inputMode !== 'photo') throw new ApiError(400, 'bad_request', 'input_mode 必須是 typed 或 photo');
  const now = nowSeconds();
  await assertCreateRate(db, user.id, now);
  const value = validateCustomPrompt(fp, promptInput, await userRefFor(config.auth.ledgerSalt, user.id), 'create');
  const body: EssayBody = input['body'] === undefined ? { text: '', plan: null } : normalizeEssayBody(input['body']);
  if (inputMode === 'photo' && body.text !== '') throw new ApiError(400, 'bad_request', '照片模式的文字由辨識結果產生，建立時請留空');
  const { wordCount, paragraphs } = essayStats(body.text, inputMode === 'photo');
  const id = crypto.randomUUID();
  // 佔位題組 custom:essay@1 由遷移 0003 建好（凍結），不呼叫 ensureItemGroupStatement。
  await db.batch([
    db
      .prepare(
        `INSERT INTO submissions (id, user_id, kind, group_id, input_mode, body_json, word_count, paragraphs, status, created_at, updated_at, expires_at)
         VALUES (?1, ?2, 'essay', ?3, ?4, ?5, ?6, ?7, 'draft', ?8, ?8, ?9)`,
      )
      .bind(id, user.id, CUSTOM_ESSAY_GROUP_ID, inputMode, bodyJson(body), wordCount, paragraphs, now, await expiresAt(db, user.id, now)),
    insertCustomPromptStatement(db, id, user.id, value, now),
  ]);
  return c.json(await toDetail(db, await requireSubmission(db, user.id, id)), 201);
}

submissionRoutes.post('/', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const input = await readJson(c);
  const kind = input['kind'];
  if (typeof kind !== 'string' || !(SUBMISSION_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'bad_request', 'kind 必須是 translation 或 essay');
  if (input['custom_prompt'] !== undefined) return createCustomSubmission(c, user, input);
  // 直接用 custom:essay@1 建立（不帶題目）時，題目庫查不到 → 400「沒有這個題組」。
  const groupId = input['group_id'];
  const group = typeof groupId === 'string' ? getWritingGroup(groupId) : null;
  // 訊息是共用常數（前端據此顯示「這題的 AI 批改還在準備中」）；內容和改版前相同。
  if (!group) throw new ApiError(400, 'bad_request', WRITING_UNKNOWN_GROUP_MESSAGE);
  if (group.kind !== kind) throw new ApiError(400, 'bad_request', '題組和提交種類不符');
  const inputMode = input['input_mode'] ?? 'typed';
  if (inputMode !== 'typed' && inputMode !== 'photo') throw new ApiError(400, 'bad_request', 'input_mode 必須是 typed 或 photo');
  if (kind === 'translation' && inputMode !== 'typed') throw new ApiError(400, 'bad_request', '中譯英只能打字作答');

  const now = nowSeconds();
  await assertCreateRate(db, user.id, now);

  const body = input['body'] === undefined ? (kind === 'translation' ? { items: [] } : { text: '', plan: null }) : normalizeBody(group, input['body']);
  let wordCount: number | null = null;
  let paragraphs: number | null = null;
  if (kind === 'essay') {
    const text = (body as EssayBody).text;
    if (inputMode === 'photo' && text !== '') throw new ApiError(400, 'bad_request', '照片模式的文字由辨識結果產生，建立時請留空');
    ({ wordCount, paragraphs } = essayStats(text, inputMode === 'photo'));
  }
  const id = crypto.randomUUID();
  await db.batch([
    ensureItemGroupStatement(db, group),
    db
      .prepare(
        `INSERT INTO submissions (id, user_id, kind, group_id, input_mode, body_json, word_count, paragraphs, status, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'draft', ?9, ?9, ?10)`,
      )
      .bind(id, user.id, kind, group.group_id, inputMode, bodyJson(body), wordCount, paragraphs, now, await expiresAt(db, user.id, now)),
  ]);
  return c.json(await toDetail(db, await requireSubmission(db, user.id, id)), 201);
});

submissionRoutes.get('/', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const kindParam = c.req.query('kind');
  if (kindParam !== undefined && kindParam !== '' && !(SUBMISSION_KINDS as readonly string[]).includes(kindParam)) {
    throw new ApiError(400, 'bad_request', 'kind 必須是 translation 或 essay');
  }
  const kind = (kindParam || null) as SubmissionKind | null;
  let cursorAt: number | null = null;
  let cursorId: string | null = null;
  const cursor = c.req.query('cursor');
  if (cursor) {
    const decoded = base64UrlDecodeText(cursor);
    const m = decoded?.match(/^(\d+):([0-9a-f-]{36})$/);
    if (!m) throw new ApiError(400, 'bad_request', 'cursor 格式不對');
    cursorAt = Number(m[1]);
    cursorId = m[2]!;
  }
  const res = await c.env.DB.prepare(LIST_SUBMISSIONS).bind(user.id, kind, cursorAt, cursorId, PAGE_SIZE + 1).all<SubmissionRow>();
  const rows = res.results.slice(0, PAGE_SIZE);
  const last = rows[rows.length - 1];
  const body: SubmissionListResponse = {
    submissions: rows.map(toSummary),
    next_cursor: res.results.length > PAGE_SIZE && last ? base64UrlEncode(`${last.created_at}:${last.id}`) : null,
  };
  return c.json(body);
});

submissionRoutes.get('/:id', requireUser(), async (c) => {
  const user = await sessionUser(c);
  return c.json(await toDetail(c.env.DB, await requireSubmission(c.env.DB, user.id, c.req.param('id'))));
});

submissionRoutes.put('/:id', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (!EDITABLE.has(sub.status)) throw new ApiError(409, 'conflict', '批改進行中或已完成的作答不能修改');
  const group = await groupForSubmission(db, sub);
  if (!group) throw new ApiError(409, 'conflict', CUSTOM_PROMPT_NOT_FOUND_MESSAGE);
  const input = await readJson(c);

  // 修改自訂題目（整份取代）：只限自訂題、要 AI 已核准、開關與指紋檔、題目規則與 D8 都重跑一次（§2.6）。
  let customValue: CustomPromptValue | null = null;
  if (input['custom_prompt'] !== undefined) {
    if (!isCustomEssayGroupId(sub.group_id)) throw new ApiError(400, 'bad_request', '只有自訂題目可以修改題目');
    const promptInput = customPromptObject(input['custom_prompt']);
    assertAiApproved(user);
    const config = loadConfig(c.env);
    const fp = await requireCustomEssayAvailable(db, config);
    customValue = validateCustomPrompt(fp, promptInput, await userRefFor(config.auth.ledgerSalt, user.id), 'update');
  }

  let newBody: string | null = null;
  let wordCount: number | null = null;
  let paragraphs: number | null = null;
  if (input['body'] !== undefined) {
    const body = normalizeBody(group, input['body']);
    if (sub.kind === 'essay') {
      const text = (body as EssayBody).text;
      if (sub.input_mode === 'photo') {
        // 照片模式：確認辨識結果之前，文字只能經由 PUT …/confirm 寫入（才記得到差異）。
        const current = parseJson<EssayBody>(sub.body_json)?.text ?? '';
        if ((sub.status === 'draft' || sub.status === 'ocr_ready') && text !== current) {
          throw new ApiError(409, 'conflict', '照片模式請先確認辨識結果（PUT /api/submissions/{id}/confirm）');
        }
      }
      ({ wordCount, paragraphs } = essayStats(text, sub.input_mode === 'photo'));
    }
    newBody = bodyJson(body);
  }
  const hasSelf = input['self_assess'] !== undefined;
  const selfJson = hasSelf ? JSON.stringify(normalizeSelfAssess(sub.kind, group, input['self_assess'])) : null;

  const now = nowSeconds();
  // 題目列與提交在同一個 batch、同樣以「狀態沒被別的請求改掉」為條件：兩句一起生效或一起不生效。
  const results = await db.batch([
    ...(customValue ? [updateCustomPromptStatement(db, sub.id, user.id, customValue, now, sub.status)] : []),
    db
      .prepare(
        `UPDATE submissions SET body_json = COALESCE(?1, body_json), word_count = COALESCE(?2, word_count), paragraphs = COALESCE(?3, paragraphs),
                self_assess_json = CASE WHEN ?4 = 1 THEN ?5 ELSE self_assess_json END, updated_at = ?6
          WHERE id = ?7 AND user_id = ?8 AND status = ?9`,
      )
      .bind(newBody, wordCount, paragraphs, hasSelf ? 1 : 0, selfJson === 'null' ? null : selfJson, now, sub.id, user.id, sub.status),
  ]);
  if (results.some((r) => r.meta.changes !== 1)) throw new ApiError(409, 'conflict', '這份提交的狀態剛剛改變了，請重新整理');
  return c.json(await toDetail(db, await requireSubmission(db, user.id, sub.id)));
});

submissionRoutes.delete('/:id', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (PENDING.has(sub.status)) throw new ApiError(409, 'conflict', '批改進行中，完成後才能刪除');
  // 照片暫存與批改紀錄隨外鍵 CASCADE 一起刪除。
  await db.prepare(`DELETE FROM submissions WHERE id = ?1 AND user_id = ?2 AND status NOT IN ('ocr_queued', 'queued', 'grading')`).bind(sub.id, user.id).run();
  return c.body(null, 204);
});

submissionRoutes.post('/:id/photos', requireAiApproved, async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  if (!loadConfig(c.env).ai.configured) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  // ord 與 Content-Length 先檢查（不讀本體）；本體的讀取與檢查在 photoUpload.ts（學習助手的題目照片共用）。
  const ord = photoOrd(c);
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (sub.kind !== 'essay' || sub.input_mode !== 'photo') throw new ApiError(409, 'conflict', '只有手寫作文可以上傳照片');
  if (sub.status !== 'draft' && sub.status !== 'failed') throw new ApiError(409, 'conflict', '這份提交目前不能上傳照片');
  const photo = await readPhotoFile(c);
  // 同一個交易裡：
  //   1. 兜底清除所有超過 24 小時的暫存照片（不分使用者）；
  //   2. 刪掉同一人其他提交（不在辨識中）的暫存照片——MVP 一次只辨識一份，丟著不用的照片不必等 24 小時；
  //   3. 取代同一個 ord；
  //   4. 寫入新照片，條件是「這個人的暫存照片未滿上限」（同一句 SQL，並行上傳也不會超過）。
  const now = nowSeconds();
  const [, , , inserted] = await db.batch([
    db.prepare('DELETE FROM submission_photo_temp WHERE expires_at < ?1').bind(now),
    db
      .prepare(
        `DELETE FROM submission_photo_temp WHERE user_id = ?1 AND submission_id <> ?2
           AND submission_id NOT IN (SELECT id FROM submissions WHERE user_id = ?1 AND status = 'ocr_queued')`,
      )
      .bind(user.id, sub.id),
    db.prepare('DELETE FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2 AND ord = ?3').bind(sub.id, user.id, ord),
    db
      .prepare(
        `INSERT INTO submission_photo_temp (id, submission_id, user_id, ord, mime, bytes, width, height, sha256, data, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
          WHERE (SELECT COUNT(*) FROM submission_photo_temp WHERE user_id = ?3) < ?13`,
      )
      .bind(
        crypto.randomUUID(),
        sub.id,
        user.id,
        ord,
        photo.mime,
        photo.bytes.length,
        photo.width,
        photo.height,
        photo.sha256,
        photoBlob(photo.bytes),
        now,
        now + PHOTO_MAX_AGE_HOURS * 3600,
        PHOTO_TEMP_MAX_PER_USER,
      ),
  ]);
  if (inserted?.meta.changes !== 1) {
    throw new ApiError(409, 'conflict', `暫存的照片太多了（每人最多 ${PHOTO_TEMP_MAX_PER_USER} 張），請等辨識完成後再上傳`);
  }
  const body: PhotoUploadResponse = { photos: await listPhotoMeta(db, user.id, sub.id) };
  return c.json(body);
});

submissionRoutes.delete('/:id/photos', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (sub.status === 'ocr_queued') throw new ApiError(409, 'conflict', '辨識進行中，完成後照片會自動刪除');
  await db.prepare('DELETE FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2').bind(sub.id, user.id).run();
  const body: PhotoUploadResponse = { photos: [] };
  return c.json(body);
});

submissionRoutes.put('/:id/confirm', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (sub.status !== 'ocr_ready' || sub.ocr_text === null) throw new ApiError(409, 'conflict', '還沒有辨識結果可以確認');
  const input = await readJson(c);
  const essay = normalizeEssayBody({ text: input['text'], plan: parseJson<EssayBody>(sub.body_json)?.plan ?? null });
  const text = sanitizeStudentText(essay.text).text;
  if (text.trim() === '') throw new ApiError(400, 'bad_request', '確認的文字是空的');
  if (text.includes('[[?]]')) throw new ApiError(400, 'bad_request', '還有看不清楚的地方（[[?]]）沒有確認');
  const now = nowSeconds();
  const ocrPlain = sub.ocr_text.replace(/\[\[\?\]\]/g, ' ');
  const diff = {
    confirmed_at: now,
    ocr_words: countEnglishWords(ocrPlain),
    confirmed_words: countEnglishWords(text),
    word_edits: wordEditDistance(ocrPlain, text),
    uncertain_marks: (parseJson<unknown[]>(sub.ocr_uncertain_json) ?? []).length,
  };
  const { wordCount, paragraphs } = essayStats(text, true);
  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE submissions SET body_json = ?1, word_count = ?2, paragraphs = ?3, ocr_diff_json = ?4, status = 'confirmed', updated_at = ?5
          WHERE id = ?6 AND user_id = ?7 AND status = 'ocr_ready'`,
      )
      .bind(bodyJson({ text, plan: essay.plan ?? null }), wordCount, paragraphs, JSON.stringify(diff), now, sub.id, user.id),
    // 照片用完即丟（OCR 結算時應該已經刪了，這裡再保險一次）。
    db.prepare('DELETE FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2').bind(sub.id, user.id),
  ]);
  if (update?.meta.changes !== 1) throw new ApiError(409, 'conflict', '這份提交的狀態剛剛改變了，請重新整理');
  return c.json(await toDetail(db, await requireSubmission(db, user.id, sub.id)));
});
