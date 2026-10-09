/**
 * GET /api/me/export 的內容（ARCHITECTURE §8.4、SPEC §8.5）。負責：後端登入 A1。
 *
 * 匯出：帳號（含 email）、同意紀錄、寫作提交與各評分者的批改。照片不匯出（暫存、用完即刪）；
 * 內部欄位（租約、重試次數、op_id、注入旗標）不匯出。所有查詢都帶 user_id = ?（防 IDOR）。
 * MVP 還沒有作答、複習、偏好等資料，Phase 2 加上對應的表時在這裡補。
 */
import type { ConsentKind, ConsentRecord, MeExport } from '@gsat/shared';
import { USER_COLUMNS, type UserRow } from '../auth/session';

/** *_json 欄位轉回物件；壞掉的 JSON 原樣保留成字串（匯出不能因為一列壞資料就整個失敗）。 */
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

interface SubmissionExportRow {
  id: string;
  [column: string]: unknown;
}

export async function buildExport(db: D1Database, userId: number): Promise<MeExport> {
  const [users, consents, submissions, gradings] = await db.batch([
    db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(userId),
    db.prepare('SELECT kind, version, granted, created_at FROM consents WHERE user_id = ? ORDER BY id').bind(userId),
    db
      .prepare(
        `SELECT id, kind, group_id, revision_of, input_mode, body_json, self_assess_json, ocr_text, ocr_uncertain_json,
                ocr_diff_json, word_count, paragraphs, status, final_score, final_band, prev_error_count, fixed_count,
                safety_flag, support_share_until, created_at, updated_at, graded_at, expires_at
         FROM submissions WHERE user_id = ? ORDER BY created_at, id`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT submission_id, role, model, rubric_version, judgments_json, program_score, deductions_json, feedback_json, created_at
         FROM gradings WHERE user_id = ? ORDER BY created_at, id`,
      )
      .bind(userId),
  ]);
  const row = users?.results[0] as UserRow | undefined;
  if (!row) throw new Error('匯出時找不到使用者');

  const gradingsBySubmission = new Map<string, unknown[]>();
  for (const g of (gradings?.results ?? []) as Record<string, unknown>[]) {
    const key = String(g['submission_id']);
    const list = gradingsBySubmission.get(key) ?? [];
    list.push({
      role: g['role'],
      model: g['model'],
      rubric_version: g['rubric_version'],
      judgments: parseJson(g['judgments_json']),
      program_score: g['program_score'],
      deductions: parseJson(g['deductions_json']),
      feedback: parseJson(g['feedback_json']),
      created_at: g['created_at'],
    });
    gradingsBySubmission.set(key, list);
  }

  const exportedSubmissions = ((submissions?.results ?? []) as SubmissionExportRow[]).map((s) => {
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(s)) {
      if (column.endsWith('_json')) out[column.slice(0, -'_json'.length)] = parseJson(value);
      else out[column] = value;
    }
    out['gradings'] = gradingsBySubmission.get(s.id) ?? [];
    return out;
  });

  return {
    format: 'gsat-export/v1',
    exported_at: new Date().toISOString(),
    user: {
      id: row.public_id,
      display_name: row.display_name,
      role: row.role,
      status: row.status,
      age_band: row.age_band,
      ai_status: row.ai_status,
      ai_tier: row.ai_tier,
      created_at: row.created_at,
      email: row.email,
    },
    consents: ((consents?.results ?? []) as Array<{ kind: ConsentKind; version: string; granted: number; created_at: number }>).map(
      (r): ConsentRecord => ({ kind: r.kind, version: r.version, granted: r.granted === 1, created_at: r.created_at }),
    ),
    submissions: exportedSubmissions,
  };
}
