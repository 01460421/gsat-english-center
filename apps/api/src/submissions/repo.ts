/**
 * 提交的資料存取與回應組裝（DB_SCHEMA §3.6）。負責：後端 AI A2。
 *
 * 防 IDOR：所有讀寫都帶 `AND user_id = ?`；查得到但不是你的，一律和「不存在」一樣回 404（ARCHITECTURE §7）。
 * 批改結果不另存一份：GET 時從 gradings 的各評分者紀錄用 src/ai/scoring.ts 重新合成（程式計分是決定性的）。
 */
import {
  type AiRefundReason,
  AI_REFUND_REASONS,
  type EssayBand,
  type EssayBody,
  type EssayGradingResult,
  type OcrResult,
  type PhotoMeta,
  type RaterRole,
  RATER_ROLES,
  type SelfAssessment,
  type SubmissionDetail,
  type SubmissionKind,
  type SubmissionStatus,
  type SubmissionSummary,
  type TranslationBody,
  type TranslationGradingResult,
} from '@gsat/shared';
import { combineEssay, combineTranslation, type EssayRaterRecord, type TranslationRaterRecord } from '../ai/scoring';
import { ApiError } from '../errors';

export interface SubmissionRow {
  id: string;
  user_id: number;
  kind: SubmissionKind;
  group_id: string;
  input_mode: 'typed' | 'photo';
  body_json: string | null;
  self_assess_json: string | null;
  ocr_text: string | null;
  ocr_uncertain_json: string | null;
  ocr_diff_json: string | null;
  word_count: number | null;
  paragraphs: number | null;
  status: SubmissionStatus;
  lease_until: number | null;
  tries: number;
  op_id: string | null;
  final_score: number | null;
  final_band: string | null;
  injection_flag: number;
  safety_flag: string | null;
  created_at: number;
  updated_at: number;
  graded_at: number | null;
  expires_at: number | null;
}

/** 提交的欄位（所有查詢都帶 user_id）。SQL 一律是完整的靜態字串，不用字串相加組 SQL（ARCHITECTURE §7）。 */
const SELECT_SUBMISSION = `SELECT id, user_id, kind, group_id, input_mode, body_json, self_assess_json, ocr_text, ocr_uncertain_json, ocr_diff_json,
  word_count, paragraphs, status, lease_until, tries, op_id, final_score, final_band, injection_flag, safety_flag,
  created_at, updated_at, graded_at, expires_at
  FROM submissions WHERE id = ?1 AND user_id = ?2`;

/** 列表（新到舊；kind、游標可為 NULL）。 */
export const LIST_SUBMISSIONS = `SELECT id, user_id, kind, group_id, input_mode, NULL AS body_json, NULL AS self_assess_json, NULL AS ocr_text,
  NULL AS ocr_uncertain_json, NULL AS ocr_diff_json, word_count, paragraphs, status, lease_until, tries, op_id, final_score, final_band,
  injection_flag, safety_flag, created_at, updated_at, graded_at, expires_at
  FROM submissions
  WHERE user_id = ?1 AND (?2 IS NULL OR kind = ?2)
    AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
  ORDER BY created_at DESC, id DESC
  LIMIT ?5`;

/** 取自己的提交；不存在或不是自己的回 null。 */
export async function findSubmission(db: D1Database, userId: number, id: string): Promise<SubmissionRow | null> {
  return db.prepare(SELECT_SUBMISSION).bind(id, userId).first<SubmissionRow>();
}

/** 同上，找不到直接丟 404。 */
export async function requireSubmission(db: D1Database, userId: number, id: string): Promise<SubmissionRow> {
  const row = await findSubmission(db, userId, id);
  if (!row) throw new ApiError(404, 'not_found', '找不到這份提交');
  return row;
}

export function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function toSummary(row: SubmissionRow): SubmissionSummary {
  return {
    id: row.id,
    kind: row.kind,
    group_id: row.group_id,
    input_mode: row.input_mode,
    status: row.status,
    final_score: row.final_score,
    final_band: (row.final_band as EssayBand | null) ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    graded_at: row.graded_at,
  };
}

export async function listPhotoMeta(db: D1Database, userId: number, submissionId: string): Promise<PhotoMeta[]> {
  const res = await db
    .prepare('SELECT id, ord, bytes, width, height, created_at FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2 ORDER BY ord')
    .bind(submissionId, userId)
    .all<PhotoMeta>();
  return res.results.map((p) => ({ id: p.id, ord: p.ord, bytes: p.bytes, width: p.width ?? null, height: p.height ?? null, created_at: p.created_at }));
}

export interface GradingRow {
  role: string;
  judgments_json: string;
  feedback_json: string | null;
  deductions_json: string | null;
}

/** gradings 的一列存的內容（judgments_json）。 */
export interface StoredJudgments {
  v: 1;
  kind: SubmissionKind;
  result: unknown;
  errors: unknown[];
  meta?: Record<string, unknown>;
}

/** 這份提交的評分者紀錄（不含自評）。 */
export async function loadGradingRows(db: D1Database, userId: number, submissionId: string): Promise<Array<GradingRow & { role: RaterRole }>> {
  const res = await db
    .prepare(`SELECT role, judgments_json, feedback_json, deductions_json FROM gradings WHERE submission_id = ?1 AND user_id = ?2 AND role <> 'self'`)
    .bind(submissionId, userId)
    .all<GradingRow>();
  return res.results.filter((r): r is GradingRow & { role: RaterRole } => (RATER_ROLES as readonly string[]).includes(r.role));
}

/** 從評分者紀錄合成最後結果（至少兩位）；consumer 結算時與 GET 詳情共用，保證兩邊算出同一個分數。 */
export function combineGradingRows(
  kind: SubmissionKind,
  rows: Array<GradingRow & { role: RaterRole }>,
  ctx: { wordCount: number; paragraphs: number },
): TranslationGradingResult | EssayGradingResult {
  if (rows.length < 2) throw new Error('評分者不足兩位');
  if (kind === 'translation') {
    const records = rows.map((r) => {
      const j = JSON.parse(r.judgments_json) as StoredJudgments;
      const f = parseJson<{ corrected: string[]; explanation_zh: string[] }>(r.feedback_json) ?? { corrected: [], explanation_zh: [] };
      return { role: r.role, result: j.result, errors: j.errors, corrected: f.corrected, explanation_zh: f.explanation_zh } as TranslationRaterRecord & { role: RaterRole };
    });
    return combineTranslation(records);
  }
  const records = rows.map((r) => {
    const j = JSON.parse(r.judgments_json) as StoredJudgments;
    const f = parseJson<Partial<EssayRaterRecord>>(r.feedback_json);
    return {
      role: r.role,
      result: j.result,
      errors: j.errors,
      deductions: parseJson(r.deductions_json) ?? [],
      criteria_explanations: f?.criteria_explanations ?? null,
      top_improvements: f?.top_improvements ?? [],
      paragraph_advice: f?.paragraph_advice ?? [],
      rewrite: f?.rewrite ?? null,
      safety_flag: f?.safety_flag ?? null,
    } as EssayRaterRecord & { role: RaterRole };
  });
  return combineEssay(records, ctx);
}

/** 從 gradings 合成批改結果（graded 之後才有；資料壞掉時回 null 並寫 log）。 */
export async function loadGrading(db: D1Database, row: SubmissionRow): Promise<TranslationGradingResult | EssayGradingResult | null> {
  if (row.status !== 'graded') return null;
  const rows = await loadGradingRows(db, row.user_id, row.id);
  if (rows.length < 2) return null;
  try {
    return combineGradingRows(row.kind, rows, { wordCount: row.word_count ?? 0, paragraphs: row.paragraphs ?? 0 });
  } catch (err) {
    console.error('合成批改結果失敗', row.id, err);
    return null;
  }
}

function ocrOf(row: SubmissionRow): OcrResult | null {
  if (row.ocr_text === null) return null;
  const diff = parseJson<{ confirmed_at?: number }>(row.ocr_diff_json);
  return {
    text: row.ocr_text,
    uncertain: parseJson<OcrResult['uncertain']>(row.ocr_uncertain_json) ?? [],
    confirmed_at: typeof diff?.confirmed_at === 'number' ? diff.confirmed_at : null,
  };
}

async function failureOf(db: D1Database, row: SubmissionRow): Promise<AiRefundReason | null> {
  if (row.status !== 'failed' || !row.op_id) return null;
  const op = await db.prepare('SELECT refund_reason FROM ai_ops WHERE id = ?1 AND user_id = ?2').bind(row.op_id, row.user_id).first<{ refund_reason: string | null }>();
  const reason = op?.refund_reason ?? 'internal';
  return (AI_REFUND_REASONS as readonly string[]).includes(reason) ? (reason as AiRefundReason) : 'internal';
}

export async function toDetail(db: D1Database, row: SubmissionRow): Promise<SubmissionDetail> {
  const [photos, grading, failure] = await Promise.all([listPhotoMeta(db, row.user_id, row.id), loadGrading(db, row), failureOf(db, row)]);
  return {
    ...toSummary(row),
    body: parseJson<TranslationBody | EssayBody>(row.body_json),
    self_assess: parseJson<SelfAssessment>(row.self_assess_json),
    word_count: row.word_count,
    paragraphs: row.paragraphs,
    op_id: row.op_id,
    ocr: ocrOf(row),
    photos,
    grading,
    failure,
  };
}
