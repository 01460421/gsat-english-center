/**
 * /api/submissions*：中譯英與作文的提交（ARCHITECTURE §10.4；DB_SCHEMA §3.6）。負責：後端 AI A2。
 * 型別在 @gsat/shared 的 writing.ts。所有查詢都帶 `AND user_id = ?`（防 IDOR）：別人的提交一律 404。
 *
 *   POST   /api/submissions                 CreateSubmissionBody → 201 SubmissionDetail（requireUser）
 *   GET    /api/submissions?kind=&cursor=   SubmissionListResponse
 *   GET    /api/submissions/:id             SubmissionDetail（前端輪詢這支）
 *   PUT    /api/submissions/:id             UpdateSubmissionBody → SubmissionDetail（只在 draft／ocr_ready／confirmed／failed）
 *   DELETE /api/submissions/:id             204（連同暫存照片與批改；批改進行中 409）
 *   POST   /api/submissions/:id/photos?ord=1|2  multipart，一次一張，欄位 `photo`（JPEG／PNG／WebP、≤1.2 MB、長邊 ≤1600 px）
 *                                           → PhotoUploadResponse（存檔前剝除 EXIF 等中繼資料；結構不認得或讀不到寬高就拒絕）
 *                                           （requireAiApproved；每次上傳先刪掉所有超過 24 小時的暫存照片，以及同一人
 *                                           其他提交〔不在辨識中〕的暫存照片；每人最多暫存 PHOTO_TEMP_MAX_PER_USER 張）
 *   DELETE /api/submissions/:id/photos      PhotoUploadResponse（學生自己刪全部照片）
 *   PUT    /api/submissions/:id/confirm     ConfirmOcrBody → SubmissionDetail（ocr_ready → confirmed；記差異量、立即刪照片）
 *
 * 照片上傳是「寫入類 API 只收 JSON」的唯一例外（multipart），同樣經過 Origin 檢查與登入（ARCHITECTURE §7）。
 * 其他寫入一律 Content-Type: application/json，本體邊讀邊數（A1 的 readJsonBody／readBodyBytes），超過上限 413，
 * 不會把超大本體整個讀進記憶體。
 */
import {
  AI_ERROR_MESSAGES,
  PHOTO_MAX_AGE_HOURS,
  PHOTO_MAX_BYTES,
  PHOTO_MIMES,
  SUBMISSION_KINDS,
  countEnglishWords,
  countParagraphs,
  type EssayBody,
  type PhotoMime,
  type PhotoUploadResponse,
  type SubmissionKind,
  type SubmissionListResponse,
  type TranslationBody,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import * as z from 'zod/v4';
import { readBodyBytes, readJsonBody } from '../account/validate';
import { getWritingGroup, ensureItemGroupStatement, type WritingGroup } from '../ai/bank';
import { sanitizeStudentText } from '../ai/filter';
import { wordEditDistance } from '../ai/scoring';
import { getSessionUser, requireAiApproved, requireUser, type SessionUser } from '../auth/session';
import { base64UrlDecodeText, base64UrlEncode } from '../auth/crypto';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { nowSeconds } from '../time';
import { imageDimensions, PHOTO_SERVER_MAX_EDGE_PX, processImageMetadata, sha256Hex, sniffImageType } from './images';
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
/** multipart 的邊界與標頭另外留的空間。 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
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

submissionRoutes.post('/', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const input = await readJson(c);
  const kind = input['kind'];
  if (typeof kind !== 'string' || !(SUBMISSION_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'bad_request', 'kind 必須是 translation 或 essay');
  const groupId = input['group_id'];
  const group = typeof groupId === 'string' ? getWritingGroup(groupId) : null;
  if (!group) throw new ApiError(400, 'bad_request', '沒有這個題組');
  if (group.kind !== kind) throw new ApiError(400, 'bad_request', '題組和提交種類不符');
  const inputMode = input['input_mode'] ?? 'typed';
  if (inputMode !== 'typed' && inputMode !== 'photo') throw new ApiError(400, 'bad_request', 'input_mode 必須是 typed 或 photo');
  if (kind === 'translation' && inputMode !== 'typed') throw new ApiError(400, 'bad_request', '中譯英只能打字作答');

  const now = nowSeconds();
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE user_id = ?1 AND created_at > ?2').bind(user.id, now - 86_400).first<{ n: number }>();
  if ((recent?.n ?? 0) >= SUBMISSIONS_PER_DAY) throw new ApiError(429, 'rate_limited', '今天建立的作答太多了，請明天再試');

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
  const group = getWritingGroup(sub.group_id);
  if (!group) throw new ApiError(409, 'conflict', '找不到這份提交的題目');
  const input = await readJson(c);

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

  const res = await db
    .prepare(
      `UPDATE submissions SET body_json = COALESCE(?1, body_json), word_count = COALESCE(?2, word_count), paragraphs = COALESCE(?3, paragraphs),
              self_assess_json = CASE WHEN ?4 = 1 THEN ?5 ELSE self_assess_json END, updated_at = ?6
        WHERE id = ?7 AND user_id = ?8 AND status = ?9`,
    )
    .bind(newBody, wordCount, paragraphs, hasSelf ? 1 : 0, selfJson === 'null' ? null : selfJson, nowSeconds(), sub.id, user.id, sub.status)
    .run();
  if (res.meta.changes !== 1) throw new ApiError(409, 'conflict', '這份提交的狀態剛剛改變了，請重新整理');
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
  const ord = Number(c.req.query('ord'));
  if (ord !== 1 && ord !== 2) throw new ApiError(400, 'bad_request', 'ord 必須是 1 或 2');
  // 本體大小先看 Content-Length（multipart 的邊界與標頭另外留 64 KB）；沒有 Content-Length 時下面邊讀邊數。
  const maxBody = PHOTO_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > maxBody) throw new ApiError(413, 'payload_too_large', '每張照片最多 1.2 MB');
  const sub = await requireSubmission(db, user.id, c.req.param('id'));
  if (sub.kind !== 'essay' || sub.input_mode !== 'photo') throw new ApiError(409, 'conflict', '只有手寫作文可以上傳照片');
  if (sub.status !== 'draft' && sub.status !== 'failed') throw new ApiError(409, 'conflict', '這份提交目前不能上傳照片');

  const contentType = c.req.header('Content-Type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new ApiError(400, 'bad_request', '請用 multipart/form-data 上傳，欄位名稱 photo');
  const raw = await readBodyBytes(c, maxBody, '每張照片最多 1.2 MB');
  let file: unknown;
  try {
    file = (await new Response(raw as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': contentType } }).formData()).get('photo');
  } catch {
    throw new ApiError(400, 'bad_request', '請用 multipart/form-data 上傳，欄位名稱 photo');
  }
  if (!(file instanceof Blob)) throw new ApiError(400, 'bad_request', '缺少欄位 photo');
  if (file.size > PHOTO_MAX_BYTES) throw new ApiError(413, 'payload_too_large', '每張照片最多 1.2 MB');
  if (file.size === 0) throw new ApiError(400, 'bad_request', '照片是空的');
  const declaredType = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(PHOTO_MIMES as readonly string[]).includes(declaredType)) throw new ApiError(400, 'bad_request', '只接受 JPEG、PNG、WebP 照片');
  const original = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImageType(original);
  if (sniffed !== declaredType) throw new ApiError(400, 'bad_request', '檔案內容和宣告的格式不符');
  const mime = sniffed as PhotoMime;
  // 中繼資料剝不掉（結構不認得）或讀不到寬高就拒絕（ARCHITECTURE §7「不合格就拒絕」）。
  const stripped = processImageMetadata(original, mime);
  if (!stripped.ok) throw new ApiError(400, 'bad_request', '無法處理這張照片的檔案格式，請重新拍照，或存成 JPEG 後再上傳');
  const bytes = stripped.bytes;
  const dims = imageDimensions(bytes, mime);
  if (!dims || dims.width <= 0 || dims.height <= 0) throw new ApiError(400, 'bad_request', '讀不到照片的寬高，請重新拍照，或存成 JPEG 後再上傳');
  if (Math.max(dims.width, dims.height) > PHOTO_SERVER_MAX_EDGE_PX) {
    throw new ApiError(400, 'bad_request', `照片尺寸太大（長邊最多 ${PHOTO_SERVER_MAX_EDGE_PX} 像素），請縮小後再上傳`);
  }
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
        mime,
        bytes.length,
        dims.width,
        dims.height,
        await sha256Hex(bytes),
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
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
