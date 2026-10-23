/**
 * 學習助手案例與 turn 的資料存取、回應組裝（docs/design/learning-assistant.md §4.1、§4.2、§4.6）。
 *
 * 防 IDOR：每一句都帶 `AND user_id = ?`；查得到但不是本人的一律和不存在一樣回 404。SQL 一律是完整的靜態字串。
 * 回應裡的解析與追問直接讀 turn 的 output_json（已經過濾後的顯示內容）；cache_hit 由 turn 帶，不存在共用快取的內容裡。
 * 不回內部欄位：cache_key、dedupe_key、meta_json、租約、op 的預扣細節。
 */
import {
  AI_REFUND_REASONS,
  ASSIST_DOUBT_KINDS,
  isAssistErrorCode,
  type AiRefundReason,
  type AssistAnalysisView,
  type AssistCaseDetail,
  type AssistCaseKind,
  type AssistCaseStatus,
  type AssistCaseSummary,
  type AssistDoubtKind,
  type AssistFollowupMode,
  type AssistFollowupView,
  type AssistHistoryLine,
  type AssistQuestionView,
  type AssistRating,
  type AssistSection,
  type AssistSource,
  type AssistTurnKind,
  type AssistTurnView,
  type AssistUnderstood,
  type AssistVerdict,
  type AssistVocabView,
  type AssistWritingView,
  type OptionLetter,
} from '@gsat/shared';
import { ApiError } from '../errors';
import { parseJson } from '../submissions/repo';
import { ASSIST_RETENTION_SECONDS } from './refund';

export interface CaseRow {
  id: string;
  user_id: number;
  source: AssistSource;
  kind: AssistCaseKind;
  ref_json: string;
  trust: 'site' | 'student';
  section: AssistSection | null;
  title: string;
  item_count: number;
  wrong_count: number;
  question_json: string | null;
  doubt_kinds_json: string;
  torn_with: string | null;
  doubt_text: string | null;
  hint_first: number;
  status: AssistCaseStatus;
  verdict: AssistVerdict | null;
  skills_json: string;
  errors_json: string;
  understood: AssistUnderstood | null;
  rating: AssistRating | null;
  note_text: string | null;
  cache_key: string | null;
  analyses: number;
  followups: number;
  d8_hidden: number;
  injection_flag: number;
  safety_flag: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export interface TurnRow {
  id: string;
  case_id: string;
  user_id: number;
  seq: number;
  kind: AssistTurnKind;
  status: 'queued' | 'running' | 'done' | 'failed';
  op_id: string | null;
  input_text: string | null;
  label: string | null;
  mode: AssistFollowupMode | null;
  output_json: string | null;
  failure: string | null;
  cache_hit: number;
  prompt_version: string | null;
  served_model: string | null;
  meta_json: string;
  lease_until: number | null;
  tries: number;
  created_at: number;
}

const CASE_COLUMNS = `id, user_id, source, kind, ref_json, trust, section, title, item_count, wrong_count, question_json, doubt_kinds_json,
  torn_with, doubt_text, hint_first, status, verdict, skills_json, errors_json, understood, rating, note_text, cache_key, analyses, followups,
  d8_hidden, injection_flag, safety_flag, created_at, updated_at, expires_at`;

const SELECT_CASE = `SELECT ${CASE_COLUMNS} FROM assist_cases WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3`;

/** 列表（新到舊，更新時間＋id 的游標；section 可為 NULL）。 */
const LIST_CASES = `SELECT ${CASE_COLUMNS} FROM assist_cases
  WHERE user_id = ?1 AND expires_at > ?2 AND (?3 IS NULL OR section = ?3)
    AND (?4 IS NULL OR updated_at < ?4 OR (updated_at = ?4 AND id < ?5))
  ORDER BY updated_at DESC, id DESC
  LIMIT ?6`;

const TURN_COLUMNS = `id, case_id, user_id, seq, kind, status, op_id, input_text, label, mode, output_json, failure, cache_hit, prompt_version,
  served_model, meta_json, lease_until, tries, created_at`;

/** 列表一頁的筆數。 */
export const CASE_PAGE_SIZE = 20;

/** 取自己的案例（過期的當成不存在）；不存在或不是自己的回 null。 */
export async function findCase(db: D1Database, userId: number, id: string, now: number): Promise<CaseRow | null> {
  return db.prepare(SELECT_CASE).bind(id, userId, now).first<CaseRow>();
}

/** 同上，找不到直接丟 404。 */
export async function requireCase(db: D1Database, userId: number, id: string, now: number): Promise<CaseRow> {
  const row = await findCase(db, userId, id, now);
  if (!row) throw new ApiError(404, 'not_found', '找不到這一題');
  return row;
}

export async function loadTurns(db: D1Database, userId: number, caseId: string): Promise<TurnRow[]> {
  const res = await db.prepare(`SELECT ${TURN_COLUMNS} FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 ORDER BY seq`).bind(caseId, userId).all<TurnRow>();
  return res.results;
}

/** JSON 陣列欄位（技能、錯因、疑問種類）：壞掉或不是字串陣列時回空陣列。 */
export function codeList(json: string | null): string[] {
  const v = parseJson<unknown>(json);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** 合併代碼（保留先後、去重），JSON 不超過 1,024 字元（assist_cases 的 CHECK）。 */
export function mergeCodes(existing: readonly string[], added: readonly string[], maxChars = 1_024): string {
  const out: string[] = [];
  for (const c of [...existing, ...added]) {
    if (out.includes(c)) continue;
    if (JSON.stringify([...out, c]).length > maxChars) break;
    out.push(c);
  }
  return JSON.stringify(out);
}

export function toSummary(row: CaseRow): AssistCaseSummary {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    title: row.title,
    section: row.section,
    status: row.status,
    verdict: row.verdict,
    item_count: row.item_count,
    wrong_count: row.wrong_count,
    understood: row.understood,
    error_codes: codeList(row.errors_json),
    skill_codes: codeList(row.skills_json),
    followups: row.followups,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

function failureOf(value: string | null): AiRefundReason | null {
  if (value === null) return null;
  return (AI_REFUND_REASONS as readonly string[]).includes(value) ? (value as AiRefundReason) : 'internal';
}

/** 一個 turn 的畫面形狀（解析的 cache_hit 由 turn 帶；追問帶學生的問題、題號與模式）。 */
export function toTurnView(row: TurnRow): AssistTurnView {
  const view: AssistTurnView = { id: row.id, seq: row.seq, kind: row.kind, status: row.status, created_at: row.created_at };
  if (row.status === 'failed') view.failure = failureOf(row.failure);
  if (row.kind === 'analyze') {
    view.cache_hit = row.cache_hit === 1;
    const analysis = parseJson<AssistAnalysisView | AssistWritingView | AssistVocabView>(row.output_json);
    if (analysis && row.status === 'done') view.analysis = { ...analysis, cache_hit: row.cache_hit === 1 };
  } else if (row.kind === 'followup') {
    if (row.input_text !== null) view.question = row.input_text;
    view.label = row.label;
    if (row.mode) view.mode = row.mode;
    const reply = parseJson<AssistFollowupView>(row.output_json);
    if (reply && row.status === 'done') view.reply = reply;
  } else if (row.kind === 'ocr') {
    const ocr = parseJson<AssistTurnView['ocr']>(row.output_json);
    if (ocr) view.ocr = ocr;
  }
  return view;
}

/**
 * 錯因歷史一行（§2.1）：這個案例的第一個錯因，這位學生有幾個（未過期的）案例也標了它，附最近的其他 3 題。
 * 只有 2 題以上才顯示（第 1 題沒有「歷史」）。
 */
export async function historyLine(db: D1Database, row: CaseRow, now: number): Promise<AssistHistoryLine | null> {
  const code = codeList(row.errors_json).find(isAssistErrorCode);
  if (!code) return null;
  const res = await db
    .prepare(
      `SELECT c.id FROM assist_cases c, json_each(c.errors_json) j
        WHERE c.user_id = ?1 AND c.expires_at > ?2 AND j.value = ?3
        ORDER BY c.updated_at DESC, c.id DESC LIMIT 200`,
    )
    .bind(row.user_id, now, code)
    .all<{ id: string }>();
  const ids = res.results.map((r) => r.id);
  if (ids.length < 2) return null;
  return { code, count: ids.length, case_ids: ids.filter((id) => id !== row.id).slice(0, 3) };
}

/** 這位學生各錯因的案例數（列表與確認頁的歷史一行用）。 */
export async function errorCounts(db: D1Database, userId: number, now: number): Promise<Record<string, number>> {
  const res = await db
    .prepare(
      `SELECT j.value AS code, COUNT(DISTINCT c.id) AS n FROM assist_cases c, json_each(c.errors_json) j
        WHERE c.user_id = ?1 AND c.expires_at > ?2 GROUP BY j.value ORDER BY n DESC, j.value`,
    )
    .bind(userId, now)
    .all<{ code: unknown; n: number }>();
  const out: Record<string, number> = {};
  for (const r of res.results) if (isAssistErrorCode(r.code)) out[r.code] = r.n;
  return out;
}

/** 列表的游標：「更新時間.id」。 */
export function encodeCursor(row: Pick<CaseRow, 'updated_at' | 'id'>): string {
  return `${row.updated_at}.${row.id}`;
}

export function decodeCursor(raw: string | undefined): { at: number; id: string } | null {
  if (!raw) return null;
  const m = /^(\d{1,12})\.([0-9a-f-]{36})$/i.exec(raw);
  if (!m) throw new ApiError(400, 'bad_request', '游標格式不對');
  return { at: Number(m[1]), id: m[2]! };
}

export async function listCases(db: D1Database, userId: number, now: number, opts: { section: string | null; cursor: { at: number; id: string } | null }): Promise<CaseRow[]> {
  const res = await db
    .prepare(LIST_CASES)
    .bind(userId, now, opts.section, opts.cursor?.at ?? null, opts.cursor?.id ?? null, CASE_PAGE_SIZE + 1)
    .all<CaseRow>();
  return res.results;
}

/** 詳情（前端輪詢這支）：題目、全部 turn、進行中的任務、錯因歷史、旗標。 */
export async function toDetail(db: D1Database, row: CaseRow, now: number, extra: { masked?: boolean; existing?: boolean } = {}): Promise<AssistCaseDetail> {
  const [turns, history] = await Promise.all([loadTurns(db, row.user_id, row.id), historyLine(db, row, now)]);
  const inflight = turns.find((t) => t.status === 'queued' || t.status === 'running');
  const doubtKinds = codeList(row.doubt_kinds_json).filter((d): d is AssistDoubtKind => (ASSIST_DOUBT_KINDS as readonly string[]).includes(d));
  return {
    ...toSummary(row),
    trust: row.trust,
    question: parseJson<AssistQuestionView>(row.question_json),
    doubt_kinds: doubtKinds,
    torn_with: (row.torn_with as OptionLetter | null) ?? null,
    doubt: row.doubt_text,
    hint_first: row.hint_first === 1,
    note: row.note_text,
    rating: row.rating,
    turns: turns.map(toTurnView),
    pending: inflight ? { turn_id: inflight.id, kind: inflight.kind, op_id: inflight.op_id, status: inflight.status as 'queued' | 'running' } : null,
    history_line: history,
    flags: { d8_hidden: row.d8_hidden === 1, injection: row.injection_flag === 1, safety: row.safety_flag },
    ...(extra.masked ? { masked: true } : {}),
    ...(extra.existing ? { existing: true } : {}),
  };
}

/** 新的到期時間：最後一次更新後 180 天。 */
export function expiresFrom(now: number): number {
  return now + ASSIST_RETENTION_SECONDS;
}

/** 台灣今天 00:00 的 Unix 秒（每天建立案例數的起點）。 */
export function taiwanDayStart(nowMs: number): number {
  const tw = new Date(nowMs + 8 * 3600_000);
  return Math.floor(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()) / 1000) - 8 * 3600;
}
