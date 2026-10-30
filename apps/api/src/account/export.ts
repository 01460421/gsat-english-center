/**
 * GET /api/me/export 的內容（ARCHITECTURE §8.4、SPEC §8.5）。負責：後端登入 A1。
 *
 * 匯出：帳號（含 email）、同意紀錄、寫作提交與各評分者的批改、自訂作文題目（每份提交的 custom_prompt：自訂題是物件、
 * 顯示時重查 D8 命中就隱藏；其他題目是 null；docs/design/custom-essay.md §3.6）。照片不匯出（暫存、用完即刪）；
 * 內部欄位（租約、重試次數、op_id、注入旗標）不匯出。所有查詢都帶 user_id = ?（防 IDOR）。
 * 學習助手（docs/design/learning-assistant.md §4.17）：assist.cases 是每個案例的題目、疑問、筆記、全部解析與追問（turns），
 * assist.reports 是每一版報告（facts、逐週計畫與內容）。照片不匯出；租約、重試次數、op_id、快取鍵、去重鍵、注入旗標、
 * 提示版本與 meta 不匯出。沒有任何學習助手資料時不帶 assist（回應和學習助手上線前相同）。國寫範文的 turn 在資料庫是 followup，
 * 匯出時 kind 寫成 zh_exemplar（和詳情相同；output_json 照常匯出；國寫範文設計 §9.2）。
 * 作文範文（docs/design/model-essays.md §6.2）：exemplars 是每一組的 id、來源、題組 id、自訂題的題目、標題、狀態、output、評分、
 * 建立與更新時間；題目、標題（自訂題是題目開頭）與 output 顯示時重查 D8（exemplars/visible.ts、repo.ts 的 visibleTitle，和列表、
 * 詳情同一支）。快取鍵與代、去重鍵、op_id、租約、內容失敗次數、meta、
 * 提示版本、注入旗標不匯出。沒有任何範文時不帶 exemplars。
 * MVP 還沒有作答、複習、偏好等資料，Phase 2 加上對應的表時在這裡補。
 */
import { assistSubjectFromRef, type ConsentKind, type ConsentRecord, type ExemplarSource, type MeExport } from '@gsat/shared';
import { USER_COLUMNS, type UserRow } from '../auth/session';
import { visibleTitle } from '../exemplars/repo';
import { visibleExemplarPrompt, visibleExemplarView } from '../exemplars/visible';
import { visibleCustomPrompt, type CustomPromptRow } from '../submissions/custom';

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
  const [users, consents, submissions, gradings, customPrompts, assistCases, assistTurns, assistReports, exemplarSets] = await db.batch([
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
    db
      .prepare(
        `SELECT submission_id, prompt_text, figure_text, paragraphs, min_words, max_words, rev, created_at, updated_at
         FROM submission_custom_prompts WHERE user_id = ? ORDER BY created_at, submission_id`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT id, source, kind, ref_json, trust, section, title, item_count, wrong_count, question_json, doubt_kinds_json, torn_with,
                doubt_text, hint_first, signals_json, status, verdict, skills_json, errors_json, understood, rating, note_text,
                analyses, followups, d8_hidden, safety_flag, created_at, updated_at, expires_at
         FROM assist_cases WHERE user_id = ? ORDER BY created_at, id`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT case_id, id, seq, CASE WHEN json_extract(meta_json, '$.task') = 'zh_exemplar' THEN 'zh_exemplar' ELSE kind END AS kind,
                status, input_text, label, mode, output_json, failure, cache_hit, created_at, updated_at
         FROM assist_turns WHERE user_id = ? ORDER BY case_id, seq`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT id, version, based_on, status, target_json, exam_date, feedback_text, input_json, report_json, failure,
                created_at, updated_at, expires_at
         FROM assist_reports WHERE user_id = ? ORDER BY version`,
      )
      .bind(userId),
    db
      .prepare(
        `SELECT id, source, group_id, prompt_json, title, status, output_json, meta_json, rating, created_at, updated_at
         FROM exemplar_sets WHERE user_id = ? ORDER BY created_at, id`,
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

  // 自訂作文題目：依 submission_id 併到每份提交（rev 是內部欄位，不匯出）。
  const promptBySubmission = new Map<string, Record<string, unknown>>();
  for (const p of (customPrompts?.results ?? []) as Array<CustomPromptRow & { submission_id: string }>) {
    const { updated_at: _updated, ...visible } = visibleCustomPrompt(p);
    promptBySubmission.set(p.submission_id, { ...visible, created_at: p.created_at, updated_at: p.updated_at });
  }

  const exportedSubmissions = ((submissions?.results ?? []) as SubmissionExportRow[]).map((s) => {
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(s)) {
      if (column.endsWith('_json')) out[column.slice(0, -'_json'.length)] = parseJson(value);
      else out[column] = value;
    }
    out['gradings'] = gradingsBySubmission.get(s.id) ?? [];
    out['custom_prompt'] = promptBySubmission.get(s.id) ?? null;
    return out;
  });

  // 學習助手：turn 依案例併進去（case_id 是內部的對應，不重複匯出）；*_json 一樣轉回物件。
  const jsonColumns = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(row)) {
      if (column.endsWith('_json')) out[column.slice(0, -'_json'.length)] = parseJson(value);
      else out[column] = value;
    }
    return out;
  };
  const turnsByCase = new Map<string, unknown[]>();
  for (const t of (assistTurns?.results ?? []) as Array<Record<string, unknown>>) {
    const { case_id: caseId, ...turn } = t;
    const list = turnsByCase.get(String(caseId)) ?? [];
    list.push(jsonColumns(turn));
    turnsByCase.set(String(caseId), list);
  }
  // 每個案例多一個 subject（由 ref_json 算出；沒有就是英文，docs/design/assistant-subjects.md §7.6）。ref_json 本來就會匯出。
  const cases = ((assistCases?.results ?? []) as Array<Record<string, unknown>>).map((c) => ({
    ...jsonColumns(c),
    subject: assistSubjectFromRef(c['ref_json']),
    turns: turnsByCase.get(String(c['id'])) ?? [],
  }));
  const reports = ((assistReports?.results ?? []) as Array<Record<string, unknown>>).map(jsonColumns);

  // 作文範文：題目、標題與範文都重查 D8（meta_json 只用來判斷要不要重查，不匯出）。
  type ExemplarExportRow = {
    id: string;
    source: string;
    group_id: string | null;
    prompt_json: string | null;
    title: string;
    status: string;
    output_json: string | null;
    meta_json: string | null;
    rating: string | null;
    created_at: number;
    updated_at: number;
  };
  const exemplars = ((exemplarSets?.results ?? []) as ExemplarExportRow[]).map((e) => {
    const output = visibleExemplarView(e.output_json, e.meta_json);
    return {
      id: e.id,
      source: e.source,
      group_id: e.group_id,
      prompt: visibleExemplarPrompt(e.prompt_json, e.updated_at),
      title: visibleTitle({ source: e.source as ExemplarSource, title: e.title }),
      status: e.status,
      output: output.view,
      ...(output.unavailable ? { output_unavailable: true } : {}),
      rating: e.rating,
      created_at: e.created_at,
      updated_at: e.updated_at,
    };
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
    ...(cases.length > 0 || reports.length > 0 ? { assist: { cases, reports } } : {}),
    ...(exemplars.length > 0 ? { exemplars } : {}),
  };
}
