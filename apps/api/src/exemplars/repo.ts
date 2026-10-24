/**
 * 作文範文的資料存取（docs/design/model-essays.md §6、§7.1）：exemplar_sets 的列、列表與詳情的形狀、去重鍵、游標，
 * 以及寫進 D1 的值（exemplarDoneRow／buildExemplarMeta：consumer 與真模型評測工具共用同一支）。
 *
 * 所有 SQL 都帶 user_id（IDOR：查得到但不是你的一律 404）。顯示時重查 D8（visible.ts）：自訂題的題目命中就隱藏，
 * 範文在指紋版本換過時逐欄重查；列表標題是自訂題時也重查。
 *
 * exemplarDoneRow 先檢查遷移 0005 的每一個 CHECK（output_json、meta_json 是合法 JSON 而且在長度上限內、title ≤ 60）：
 * CHECK 失敗會讓結算的 batch 丟錯 → 外層 msg.retry → 重新付費呼叫模型，假模型測不出來，所以 smoke test 也用同一支檢查真輸出。
 * meta_json 由 buildExemplarMeta 組：超過上限時依序丟掉低優先的鍵（明細 → 計數 → 版本以外的欄位），不用 .slice 切字串
 * （切斷的 JSON 會讓 json_valid 的 CHECK 失敗）；版本欄位（層級、過濾、D8、自訂題規則、範本）永遠保留。
 */
import {
  CUSTOM_TITLE_HIDDEN,
  CUSTOM_TITLE_UNAVAILABLE,
  customPromptTitle,
  type AiRefundReason,
  type ExemplarSetDetail,
  type ExemplarSetStatus,
  type ExemplarSetSummary,
  type ExemplarSetView,
  type ExemplarSource,
} from '@gsat/shared';
import { d8Fingerprints, officialMaterialHits } from '../ai/d8';
import { sha256Text } from '../assist/hash';
import { ApiError } from '../errors';
import type { ExemplarCustomPrompt } from './requests';
import { EXEMPLAR_TITLE_MAX } from './siteGroups';
import { visibleExemplarPrompt, visibleExemplarView } from './visible';

/** 遷移 0005 的 CHECK 上限。 */
export const EXEMPLAR_OUTPUT_JSON_MAX = 32_768;
export const EXEMPLAR_META_JSON_MAX = 2_048;
export const EXEMPLAR_PROMPT_JSON_MAX = 4_096;
/** 列表每頁幾組。 */
export const EXEMPLAR_PAGE_SIZE = 20;

/** exemplar_sets 的一列（詳情、列表、consumer 共用的欄位）。 */
export interface ExemplarSetRow {
  id: string;
  user_id: number;
  source: ExemplarSource;
  group_id: string | null;
  prompt_json: string | null;
  dedupe_key: string;
  title: string;
  status: ExemplarSetStatus;
  op_id: string | null;
  fresh: number;
  cache_hit: number;
  cache_key: string | null;
  cache_gen: number | null;
  output_json: string | null;
  failure: string | null;
  rating: 'helpful' | 'wrong' | null;
  injection_flag: number;
  safety_flag: string | null;
  d8_hidden: number;
  prompt_version: string | null;
  served_model: string | null;
  meta_json: string;
  lease_until: number | null;
  tries: number;
  content_failures: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export const EXEMPLAR_COLUMNS = `id, user_id, source, group_id, prompt_json, dedupe_key, title, status, op_id, fresh, cache_hit, cache_key, cache_gen,
  output_json, failure, rating, injection_flag, safety_flag, d8_hidden, prompt_version, served_model, meta_json, lease_until, tries,
  content_failures, created_at, updated_at, expires_at`;

/** 讀自己的一組（沒過期）；沒有回 null。 */
export async function findExemplarSet(db: D1Database, userId: number, id: string, now: number): Promise<ExemplarSetRow | null> {
  return db.prepare(`SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3`).bind(id, userId, now).first<ExemplarSetRow>();
}

/** 讀自己的一組；沒有（或不是你的、過期了）404。 */
export async function requireExemplarSet(db: D1Database, userId: number, id: string, now: number): Promise<ExemplarSetRow> {
  const row = await findExemplarSet(db, userId, id, now);
  if (!row) throw new ApiError(404, 'not_found', '找不到這一組範文');
  return row;
}

/** 去重鍵：網站題目 sha256(site|group_id)；自訂題 sha256(custom|正規化題目|圖片描述|段數|字數)。 */
export function siteDedupeKey(groupId: string): Promise<string> {
  return sha256Text(`site|${groupId}`);
}

export function customDedupeKey(p: ExemplarCustomPrompt): Promise<string> {
  return sha256Text(['custom', p.text, p.figure_text ?? '', p.paragraphs ?? '', p.min_words ?? '', p.max_words ?? ''].join('\u0000'));
}

/** 自訂題存進 prompt_json 的值（≤ 4,096 字元；題目最多 1,200 字元，不會超過）。 */
export function promptJsonOf(p: ExemplarCustomPrompt): string {
  return JSON.stringify({ text: p.text, figure_text: p.figure_text, paragraphs: p.paragraphs, min_words: p.min_words, max_words: p.max_words });
}

/** 自訂題的列表標題（題目開頭 30 字）。 */
export function customTitle(p: ExemplarCustomPrompt): string {
  return [...customPromptTitle(p.text)].slice(0, EXEMPLAR_TITLE_MAX).join('');
}

/** 列表標題：自訂題重查 D8（命中「（題目已隱藏）」、指紋檔壞掉「（題目暫時無法顯示）」）；網站題目原樣。列表、詳情與匯出共用。 */
export function visibleTitle(row: Pick<ExemplarSetRow, 'source' | 'title'>): string {
  if (row.source !== 'custom') return row.title;
  const fp = d8Fingerprints();
  if (!fp) return CUSTOM_TITLE_UNAVAILABLE;
  return officialMaterialHits(fp, row.title, null) ? CUSTOM_TITLE_HIDDEN : row.title;
}

export function toSummary(row: ExemplarSetRow): ExemplarSetSummary {
  return {
    id: row.id,
    source: row.source,
    group_id: row.group_id,
    title: visibleTitle(row),
    status: row.status,
    cache_hit: row.cache_hit === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function metaFlag(metaJson: string, key: string): boolean {
  try {
    const m = JSON.parse(metaJson) as Record<string, unknown>;
    return m[key] === true;
  } catch {
    return false;
  }
}

/**
 * 詳情（GET /api/exemplars/:id、POST 回 200 時）：題目與範文顯示時重查 D8；指紋檔壞掉時範文暫時不顯示。
 * safety_flag：列上記下的身心安全旗標（consumer 在模型標了的當下就記；退還的組沒有 view，前端靠它顯示求助資源）。
 */
export function toDetail(row: ExemplarSetRow, extra: { existing?: boolean } = {}): ExemplarSetDetail {
  const output = row.status === 'done' ? visibleExemplarView(row.output_json, row.meta_json) : { view: null, unavailable: false };
  const notWriting = row.status === 'failed' && metaFlag(row.meta_json, 'not_writing_task');
  return {
    ...toSummary(row),
    prompt: row.source === 'custom' ? visibleExemplarPrompt(row.prompt_json, row.updated_at) : null,
    view: output.view,
    failure: (row.failure as AiRefundReason | null) ?? null,
    ...(notWriting ? { not_writing_task: true } : {}),
    ...(row.safety_flag ? { safety_flag: row.safety_flag } : {}),
    rating: row.rating,
    ...(extra.existing ? { existing: true } : {}),
    expires_at: row.expires_at,
  };
}

/** 游標：「建立時間.id」（新到舊）。 */
export function encodeCursor(row: Pick<ExemplarSetRow, 'created_at' | 'id'>): string {
  return `${row.created_at}.${row.id}`;
}

export function decodeCursor(raw: string | undefined): { at: number; id: string } | null {
  if (!raw) return null;
  const m = /^(\d{1,12})\.([0-9a-f-]{36})$/i.exec(raw);
  if (!m) throw new ApiError(400, 'bad_request', '游標格式不對');
  return { at: Number(m[1]), id: m[2]! };
}

/** 我的範文（新到舊，多取一筆判斷有沒有下一頁）。 */
export async function listExemplarSets(db: D1Database, userId: number, now: number, cursor: { at: number; id: string } | null): Promise<ExemplarSetRow[]> {
  const res = await db
    .prepare(
      `SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets
        WHERE user_id = ?1 AND expires_at > ?2
          AND (?3 IS NULL OR created_at < ?3 OR (created_at = ?3 AND id < ?4))
        ORDER BY created_at DESC, id DESC LIMIT ?5`,
    )
    .bind(userId, now, cursor?.at ?? null, cursor?.id ?? null, EXEMPLAR_PAGE_SIZE + 1)
    .all<ExemplarSetRow>();
  return res.results;
}

// ───────────────────────── 寫進 D1 的值 ─────────────────────────

/** meta_json 的內容（版本欄位永遠保留；其他依優先序縮減）。 */
export interface ExemplarMetaInput {
  /** 版本：層級（EXEMPLAR_LEVELS_VERSION）、過濾、D8 指紋、範本；自訂題另有題目規則版本。 */
  versions: { levels: string; filter_version: string; d8_fp: string; template?: string; custom_rules?: string };
  /** 版本以外的欄位（not_writing_task、快取寫入、server-side fallback…）；縮減時最後才丟。 */
  fields?: Record<string, unknown>;
  /** 處理數（output.ts 的 ExemplarCounts）。 */
  counts?: Record<string, number>;
  /** 每一級的明細（字數、段數、轉承詞種類、被隱藏的原因）；縮減時最先丟。 */
  details?: Record<string, unknown>;
}

/** 組 meta_json：超過 2,048 字元時依序丟掉 details → counts → fields（結構化縮減，結果一定是合法 JSON）。 */
export function buildExemplarMeta(input: ExemplarMetaInput, max = EXEMPLAR_META_JSON_MAX): string {
  const attempts: Array<Record<string, unknown>> = [
    { ...input.versions, ...(input.fields ?? {}), ...(input.counts ? { counts: input.counts } : {}), ...(input.details ? { details: input.details } : {}) },
    { ...input.versions, ...(input.fields ?? {}), ...(input.counts ? { counts: input.counts } : {}), reduced: 'details' },
    { ...input.versions, ...(input.fields ?? {}), reduced: 'counts' },
    { ...input.versions, reduced: 'fields' },
  ];
  for (const a of attempts) {
    const json = JSON.stringify(a);
    if (json.length <= max) return json;
  }
  return JSON.stringify({ ...input.versions, reduced: 'all' });
}

export type ExemplarRowProblem = 'output_too_large' | 'meta_too_large' | 'title_too_long' | 'invalid_json';

export type ExemplarDoneRow =
  | { ok: true; outputJson: string; metaJson: string; outputChars: number; metaChars: number }
  | { ok: false; problem: ExemplarRowProblem; outputChars: number; metaChars: number };

function validJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/**
 * 結算時寫進 exemplar_sets 的值（consumer 與真模型評測工具共用）：先檢查遷移 0005 的每一個 CHECK。
 * output_json 超過上限＝內容失敗（合法輸出不會發生，評測記下實際的最大值）。JS 的字串長度以 UTF-16 計，
 * 不小於 SQLite 的 length()（以字元計），所以這裡通過，CHECK 一定通過。
 */
export function exemplarDoneRow(input: { view: ExemplarSetView; meta: ExemplarMetaInput; title?: string }): ExemplarDoneRow {
  const outputJson = JSON.stringify(input.view);
  const metaJson = buildExemplarMeta(input.meta);
  const sizes = { outputChars: outputJson.length, metaChars: metaJson.length };
  if (!validJson(outputJson) || !validJson(metaJson)) return { ok: false, problem: 'invalid_json', ...sizes };
  if (outputJson.length > EXEMPLAR_OUTPUT_JSON_MAX) return { ok: false, problem: 'output_too_large', ...sizes };
  if (metaJson.length > EXEMPLAR_META_JSON_MAX) return { ok: false, problem: 'meta_too_large', ...sizes };
  if (input.title !== undefined && [...input.title].length > EXEMPLAR_TITLE_MAX) return { ok: false, problem: 'title_too_long', ...sizes };
  return { ok: true, outputJson, metaJson, ...sizes };
}

// ───────────────────────── 每天建立的組數與保留的組數（§4.2） ─────────────────────────

/** 每建立一組寫一筆的 ops 事件（每日上限的計數；學生刪不掉，只有假名、沒有內容）。 */
export const EXEMPLAR_CREATED_MARK = 'exemplar_created';

/**
 * 今天建立的組數的 SQL 運算式（含共用快取命中）：學生刪掉的組也要算（否則刪了再建就能無限複製快取的列），所以取「還在的組數」與
 * 「建立紀錄數」（ops_events，學生刪不掉；只有假名）較大的那個。參數是佔位符的名字。同學習助手的 casesTodaySql。
 */
export function setsTodaySql(userParam: string, dayStartParam: string, refParam: string): string {
  return `MAX((SELECT COUNT(*) FROM exemplar_sets WHERE user_id = ${userParam} AND created_at >= ${dayStartParam}),
              (SELECT COUNT(*) FROM ops_events WHERE kind = '${EXEMPLAR_CREATED_MARK}' AND created_at >= ${dayStartParam}
                  AND json_extract(detail_json, '$.user_ref') = ${refParam}))`;
}

/** 今天建立的組數（/api/ai/quota 的 exemplars.day_used、429 的原因判斷）。 */
export async function exemplarSetsToday(db: D1Database, userId: number, ref: string | null, dayStart: number): Promise<number> {
  const row = await db.prepare(`SELECT ${setsTodaySql('?1', '?2', '?3')} AS n`).bind(userId, dayStart, ref).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** 建立紀錄（和 INSERT 同一個 batch；那一列真的插進去了才寫；建立時就標成已確認，不算進後台的「未處理」）。 */
export function createdMarkStatement(db: D1Database, ref: string, setId: string, userId: number, now: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ops_events (kind, severity, detail_json, created_at, acked_at) SELECT ?1, 'info', ?2, ?3, ?3
        WHERE EXISTS (SELECT 1 FROM exemplar_sets WHERE id = ?4 AND user_id = ?5)`,
    )
    .bind(EXEMPLAR_CREATED_MARK, JSON.stringify({ user_ref: ref }), now, setId, userId);
}
