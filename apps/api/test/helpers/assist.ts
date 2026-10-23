/**
 * 學習助手的測試小工具（docs/design/learning-assistant.md §4.6）：直接在假 D1 建案例、turn、照片、報告與它們的預扣。
 * WP-A1 還沒有建立案例的端點，帳號匯出與刪除、housekeeping 的回收與清理、consumer 的分流都用這些列測。
 */
import type { TestD1 } from './d1';

const DAY = 86_400;
export const nowS = () => Math.floor(Date.now() / 1000);

export interface SeedCase {
  id?: string;
  status?: string;
  source?: string;
  kind?: string;
  analyses?: number;
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
  questionText?: string;
}

/** 建一個案例（預設：題庫題、已解析、180 天後到期）。 */
export function seedAssistCase(db: TestD1, userId: number, opts: SeedCase = {}): string {
  const id = opts.id ?? crypto.randomUUID();
  const created = opts.createdAt ?? nowS();
  db.sqlite
    .prepare(
      `INSERT INTO assist_cases (id, user_id, source, kind, ref_json, dedupe_key, trust, section, title, item_count, wrong_count, question_json,
                                 doubt_kinds_json, doubt_text, status, verdict, skills_json, errors_json, cache_key, analyses, injection_flag,
                                 created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'site', 'reading', '本站題庫・閱讀測驗：第 2 題', 1, 1, ?, '["why_not_mine"]', '為什麼不是 (C)', ?, 'wrong',
               '["it:inference"]', '["over_inference"]', 'cache-key-secret', ?, 1, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      opts.source ?? 'bank',
      opts.kind ?? 'item',
      JSON.stringify({ source: 'bank', ref: 'ai.rd.0a1b2c@1', labels: ['2'], answers: { '2': 'C' } }),
      `dedupe-${id}`,
      JSON.stringify({ kind: 'item', trust: 'site', origin_label: '本站題庫', passage: opts.questionText ?? 'A short passage.' }),
      opts.status ?? 'analyzed',
      opts.analyses ?? 1,
      created,
      opts.updatedAt ?? created,
      opts.expiresAt ?? created + 180 * DAY,
    );
  return id;
}

export interface SeedTurn {
  id?: string;
  seq?: number;
  kind?: 'ocr' | 'analyze' | 'followup';
  status?: 'queued' | 'running' | 'done' | 'failed';
  opId?: string | null;
  leaseUntil?: number | null;
  tries?: number;
}

/** 建一個 turn（預設：解析、已完成）。 */
export function seedAssistTurn(db: TestD1, userId: number, caseId: string, opts: SeedTurn = {}): string {
  const id = opts.id ?? crypto.randomUUID();
  db.sqlite
    .prepare(
      `INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, op_id, input_text, output_json, meta_json, lease_until, tries)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{"cache_key":"x"}', ?, ?)`,
    )
    .run(
      id,
      caseId,
      userId,
      opts.seq ?? 1,
      opts.kind ?? 'analyze',
      opts.status ?? 'done',
      opts.opId ?? null,
      opts.kind === 'followup' ? '那 (B) 呢？' : null,
      opts.status === 'done' || opts.status === undefined ? JSON.stringify({ kind: 'item', tested_zh: '推論題' }) : null,
      opts.leaseUntil ?? null,
      opts.tries ?? 0,
    );
  return id;
}

/** 建一張暫存照片（預設：剛上傳、24 小時後到期）。 */
export function seedAssistPhoto(db: TestD1, userId: number, caseId: string, opts: { ord?: number; createdAt?: number; expiresAt?: number } = {}): string {
  const id = crypto.randomUUID();
  const created = opts.createdAt ?? nowS();
  db.sqlite
    .prepare(
      `INSERT INTO assist_photos (id, case_id, user_id, ord, mime, bytes, sha256, data, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'image/jpeg', 3, 'abc', ?, ?, ?)`,
    )
    .run(id, caseId, userId, opts.ord ?? 1, new Uint8Array([1, 2, 3]), created, opts.expiresAt ?? created + DAY);
  return id;
}

export interface SeedReport {
  id?: string;
  version?: number;
  status?: 'queued' | 'running' | 'done' | 'failed';
  opId?: string | null;
  leaseUntil?: number | null;
  tries?: number;
  createdAt?: number;
  expiresAt?: number;
}

/** 建一份報告（預設：第 1 版、已完成）。 */
export function seedAssistReport(db: TestD1, userId: number, opts: SeedReport = {}): string {
  const id = opts.id ?? crypto.randomUUID();
  const created = opts.createdAt ?? nowS();
  db.sqlite
    .prepare(
      `INSERT INTO assist_reports (id, user_id, version, status, op_id, target_json, exam_date, feedback_text, input_json, report_json,
                                   meta_json, lease_until, tries, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, '{"standard":"front","weekly":"2to4"}', '2027-01-23', '最近閱讀比較穩', '{"facts":{"data_level":"some"}}', ?,
               '{"prompt":"secret-meta"}', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      opts.version ?? 1,
      opts.status ?? 'done',
      opts.opId ?? null,
      opts.status === 'done' || opts.status === undefined ? '{"overview_zh":"總覽"}' : null,
      opts.leaseUntil ?? null,
      opts.tries ?? 0,
      created,
      created,
      opts.expiresAt ?? created + 180 * DAY,
    );
  return id;
}

/** 建一筆學習助手的預扣（ai_ops，reserved；created_at 可以往前調模擬卡住）。 */
export function seedAssistOp(db: TestD1, userId: number, task: string, refId: string, opts: { id?: string; createdAt?: number; points?: number } = {}): string {
  const id = opts.id ?? crypto.randomUUID();
  const created = opts.createdAt ?? nowS();
  const d = new Date((created + 8 * 3600) * 1000).toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO ai_ops (id, user_id, task, ref_id, status, points_reserved, usd_reserved_micros, tw_day, tw_month, created_at)
       VALUES (?, ?, ?, ?, 'reserved', ?, 400000, ?, ?, ?)`,
    )
    .run(id, userId, task, refId, opts.points ?? 6, d.slice(0, 10), d.slice(0, 7), created);
  return id;
}
