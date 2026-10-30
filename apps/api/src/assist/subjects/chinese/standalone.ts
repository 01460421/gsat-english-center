/**
 * 國寫範文的獨立頁（docs/design/assistant-subjects.md「國寫範文」的「獨立頁」小節）：不必先建學習助手的國寫案例、看國寫指導，
 * 直接選一題歷屆國寫或貼上自己的國寫題目就能看一篇 AI 示範。資料仍存在學習助手（一個國文的國寫案例＋範文的 turn），保存、刪除、
 * 匯出與隱私權說明都照學習助手，不加遷移。
 *
 *   歷屆題目   打包的 src/generated/zh-writing-prompts.json（build-writing-prompts.mjs 由 data/zh-writing/prompts.json 複製）；
 *              前端只送代號，題目文字由伺服器端決定。讀檔時用 shared 的 isZhWritingPromptFile 再檢查一次，不對就當成沒有（503）。
 *   建立案例   歷屆題目與貼上的題目都走國文貼上的同一套檢查（question.ts 的 zhStudentQuestion：國文官方 D8 的窗口、答案區、注入、
 *              長度）；案例是 source 'typed'、trust 'student'、kind 'zh_writing'、status 'ready'（沒有國寫指導，學生之後也可以在
 *              學習助手對它要國寫指導），section 是學生選（或歷屆題目）的題型。ref_json 記 origin 'zh_exemplar'、via（past／paste）、
 *              歷屆題目的代號、題型與學生填的字數規定（範文的 consumer 從這裡讀，不靠國寫指導）。
 *   去重       同一位使用者、同一題（歷屆題目的代號，或貼上的題目正規化後的區塊與題型）在 180 天內只有一個案例：再送一次就在那個
 *              案例上再加一篇（每案例最多 2 篇）；那個案例有一篇正在產生時回那一篇（不另外扣點）。
 *   列表       「我的國寫範文」：這個頁面建立的案例，加上學習助手裡已經有範文的國寫案例（新到舊，游標同案例列表）。
 */
import {
  AI_REFUND_REASONS,
  ASSIST_LIMITS,
  isZhExemplarSection,
  isZhWritingPromptFile,
  zhPasteLimitsProblem,
  zhPasteQuestion,
  zhWritingPromptLabel,
  zhWritingPromptQuestion,
  type AiRefundReason,
  type AssistQuestionView,
  type ZhExemplarListItem,
  type ZhExemplarOrigin,
  type ZhExemplarPasteInput,
  type ZhExemplarPasteLimits,
  type ZhExemplarSection,
  type ZhWritingPrompt,
} from '@gsat/shared';
import type { D8Fingerprints } from '../../../ai/d8';
import { ApiError } from '../../../errors';
import { parseJson } from '../../../submissions/repo';
import promptsJson from '../../../generated/zh-writing-prompts.json';
import { sha256Text } from '../../hash';
import { problemMessage, studentQuestionTitle } from '../../sources';
import type { ZhFingerprints } from './d8';
import { zhStudentQuestion } from './question';

/** 這個頁面建立的案例在 ref_json 的 origin。 */
export const ZH_STANDALONE_ORIGIN = 'zh_exemplar';

// ───────────────────────── 歷屆題目 ─────────────────────────

let promptCache: ReadonlyMap<string, ZhWritingPrompt> | null | undefined;

/** 打包的歷屆題目（代號 → 題目）；檔案不合格式時是 null（端點回 503，不猜）。 */
export function zhWritingPrompts(): ReadonlyMap<string, ZhWritingPrompt> | null {
  if (promptCache !== undefined) return promptCache;
  const raw: unknown = promptsJson;
  if (isZhWritingPromptFile(raw)) {
    promptCache = new Map(raw.prompts.map((p) => [p.id, p]));
  } else {
    console.error('歷屆國寫題目檔的格式不對（src/generated/zh-writing-prompts.json）');
    promptCache = null;
  }
  return promptCache;
}

/** 測試用：清掉快取（換掉打包的檔案之後）。 */
export function resetZhWritingPromptsForTests(): void {
  promptCache = undefined;
}

// ───────────────────────── 案例的 ref_json ─────────────────────────

/** 這個頁面建立的案例的 ref_json（source 仍是 typed：題目是送進國文貼上檢查的文字）。 */
export interface ZhStandaloneRef {
  source: 'typed';
  subject: 'chinese';
  origin: typeof ZH_STANDALONE_ORIGIN;
  via: 'past' | 'paste';
  section: ZhExemplarSection;
  prompt_id?: string;
  limits?: ZhExemplarPasteLimits;
}

/** 讀 ref_json：這個頁面建立的案例回它的設定，其他（學習助手的案例、格式不對）回 null。 */
export function zhStandaloneRef(refJson: string | null): ZhStandaloneRef | null {
  const ref = parseJson<Record<string, unknown>>(refJson);
  if (!ref || ref['origin'] !== ZH_STANDALONE_ORIGIN || (ref['via'] !== 'past' && ref['via'] !== 'paste') || !isZhExemplarSection(ref['section'])) return null;
  const limits = ref['limits'];
  const promptId = ref['prompt_id'];
  return {
    source: 'typed',
    subject: 'chinese',
    origin: ZH_STANDALONE_ORIGIN,
    via: ref['via'],
    section: ref['section'],
    ...(typeof promptId === 'string' ? { prompt_id: promptId } : {}),
    ...(typeof limits === 'object' && limits !== null && !Array.isArray(limits) ? { limits: pickLimits(limits as ZhExemplarPasteLimits) } : {}),
  };
}

/** 字數規定只留三個整數欄位（null／沒填的不寫）。 */
function pickLimits(l: ZhExemplarPasteLimits): ZhExemplarPasteLimits {
  const out: ZhExemplarPasteLimits = {};
  for (const k of ['q1_chars', 'body_chars', 'body_lines'] as const) {
    const v = l[k];
    if (typeof v === 'number' && Number.isInteger(v)) out[k] = v;
  }
  return out;
}

// ───────────────────────── 建立案例 ─────────────────────────

/** 建立案例需要的欄位（routes.ts 寫進 assist_cases）。 */
export interface ZhStandaloneCase {
  via: 'past' | 'paste';
  section: ZhExemplarSection;
  title: string;
  refJson: string;
  dedupeKey: string;
  view: AssistQuestionView;
  masked: number;
  injection: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(rec[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 列表與標題用的短標：「國寫範文・111 學測知性：樂齡活動」。 */
function pastTitle(p: ZhWritingPrompt): string {
  return `國寫範文・${p.year} 學測${p.section === 'zh_writing_reason' ? '知性' : '情意'}：${p.topic}`.slice(0, 120);
}

/**
 * 歷屆題目 → 案例：題目文字走國文貼上的同一套檢查（打包的題本文字本來就通過，測試釘住；這裡再跑一次，指紋更新後也一樣）。
 * 代號不在打包的檔案裡 → 400；檔案讀不到 → 503。
 */
export async function zhPastCase(promptId: string, fp: D8Fingerprints, zh: ZhFingerprints): Promise<ZhStandaloneCase> {
  const prompts = zhWritingPrompts();
  if (!prompts) throw new ApiError(503, 'not_configured', '歷屆國寫題目暫時讀不到，請稍後再試');
  const p = prompts.get(promptId);
  if (!p) throw new ApiError(400, 'bad_request', '找不到這一題歷屆國寫');
  const s = zhStudentQuestion(zhWritingPromptQuestion(p), fp, zh);
  const ref: ZhStandaloneRef = { source: 'typed', subject: 'chinese', origin: ZH_STANDALONE_ORIGIN, via: 'past', section: p.section, prompt_id: p.id };
  return {
    via: 'past',
    section: p.section,
    title: pastTitle(p),
    refJson: JSON.stringify(ref),
    dedupeKey: await sha256Text(canonical({ src: 'zh_exemplar', via: 'past', prompt_id: p.id })),
    view: { ...s.view, origin_label: zhWritingPromptLabel(p) },
    masked: s.masked,
    injection: s.injection,
  };
}

/** 題目區塊 → 貼上表單的欄位（被拒時把 blocks[i].text 換成學生看得懂的欄位：字數規定、素材、題目）。 */
const PASTE_FIELD_OF_KIND: Readonly<Record<string, string>> = { instructions: 'limits', passage: 'material', question: 'prompt' };

/**
 * 貼上的題目 → 案例：題目不能空白、字數規定的範圍（shared 的 zhPasteLimitsProblem）→ 組成題目區塊（zhPasteQuestion）→ 國文貼上的
 * 檢查（D8 窗口、答案區、注入、長度；被拒時 400 assist_input_invalid，同學習助手的貼上；field 換成 prompt／material／limits，
 * ranges 是那一欄正規化後的位置）。去重鍵是正規化後的區塊與題型。
 */
export async function zhPasteCase(input: ZhExemplarPasteInput, fp: D8Fingerprints, zh: ZhFingerprints): Promise<ZhStandaloneCase> {
  if (input.prompt.trim() === '') throw new ApiError(400, 'assist_input_invalid', problemMessage('text_missing'), { reason: 'text_missing', field: 'prompt' });
  const problem = zhPasteLimitsProblem(input.section, input.limits);
  if (problem) throw new ApiError(400, 'bad_request', problem, { field: 'limits' });
  const pasted = zhPasteQuestion(input);
  let s: ReturnType<typeof zhStudentQuestion>;
  try {
    s = zhStudentQuestion(pasted, fp, zh);
  } catch (err) {
    const m = err instanceof ApiError && typeof err.detail.field === 'string' ? /^blocks\[(\d+)\]\.text$/.exec(err.detail.field) : null;
    const kind = m ? pasted.blocks[Number(m[1])]?.kind : undefined;
    if (err instanceof ApiError && kind && PASTE_FIELD_OF_KIND[kind]) throw new ApiError(err.status, err.code, err.message, { ...err.detail, field: PASTE_FIELD_OF_KIND[kind] });
    throw err;
  }
  if (s.kind !== 'zh_writing') throw new ApiError(400, 'bad_request', '這不是國寫的題目');
  const limits = input.limits ? pickLimits(input.limits) : {};
  const ref: ZhStandaloneRef = {
    source: 'typed',
    subject: 'chinese',
    origin: ZH_STANDALONE_ORIGIN,
    via: 'paste',
    section: input.section,
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  };
  const blocks = s.question.blocks.map((b) => [b.kind, b.text]);
  return {
    via: 'paste',
    section: input.section,
    title: `國寫範文・${studentQuestionTitle(s.question)}`.slice(0, 120),
    refJson: JSON.stringify(ref),
    dedupeKey: await sha256Text(canonical({ src: 'zh_exemplar', via: 'paste', section: input.section, blocks })),
    view: s.view,
    masked: s.masked,
    injection: s.injection,
  };
}

// ───────────────────────── 列表 ─────────────────────────

/** 範文的 turn（資料庫是 followup、meta_json.task＝'zh_exemplar'）；t 是 assist_turns 的別名、c 是案例。 */
const EXEMPLAR_TURN = `t.case_id = c.id AND t.user_id = c.user_id AND t.kind = 'followup' AND json_extract(t.meta_json, '$.task') = 'zh_exemplar'`;
const LATEST = (col: string) => `(SELECT ${col} FROM assist_turns t WHERE ${EXEMPLAR_TURN} ORDER BY t.seq DESC LIMIT 1)`;

/**
 * 「我的國寫範文」：國文的國寫案例，而且是這個頁面建立的（ref_json.origin）或已經有範文的 turn（學習助手裡要過的）。
 * 新到舊（更新時間＋id 的游標，同案例列表）；?1 user ?2 now ?3 ?4 游標 ?5 筆數。
 */
const LIST_ZH_EXEMPLAR_CASES = `SELECT c.id, c.title, c.section, c.ref_json, c.created_at, c.updated_at, c.expires_at,
    (SELECT COUNT(*) FROM assist_turns t WHERE ${EXEMPLAR_TURN} AND t.status = 'done') AS done_count,
    (SELECT COUNT(*) FROM assist_turns t WHERE ${EXEMPLAR_TURN} AND t.status IN ('queued', 'running')) AS inflight_count,
    ${LATEST('t.id')} AS latest_id, ${LATEST('t.status')} AS latest_status, ${LATEST('t.failure')} AS latest_failure,
    ${LATEST('t.created_at')} AS latest_created_at
  FROM assist_cases c
  WHERE c.user_id = ?1 AND c.expires_at > ?2 AND c.kind = 'zh_writing'
    AND COALESCE(json_extract(c.ref_json, '$.subject'), 'english') = 'chinese'
    AND (json_extract(c.ref_json, '$.origin') = '${ZH_STANDALONE_ORIGIN}' OR EXISTS (SELECT 1 FROM assist_turns t WHERE ${EXEMPLAR_TURN}))
    AND (?3 IS NULL OR c.updated_at < ?3 OR (c.updated_at = ?3 AND c.id < ?4))
  ORDER BY c.updated_at DESC, c.id DESC
  LIMIT ?5`;

export interface ZhExemplarCaseRow {
  id: string;
  title: string;
  section: string | null;
  ref_json: string;
  created_at: number;
  updated_at: number;
  expires_at: number;
  done_count: number;
  inflight_count: number;
  latest_id: string | null;
  latest_status: string | null;
  latest_failure: string | null;
  latest_created_at: number | null;
}

export async function listZhExemplarCases(db: D1Database, userId: number, now: number, cursor: { at: number; id: string } | null, limit: number): Promise<ZhExemplarCaseRow[]> {
  const res = await db
    .prepare(LIST_ZH_EXEMPLAR_CASES)
    .bind(userId, now, cursor?.at ?? null, cursor?.id ?? null, limit)
    .all<ZhExemplarCaseRow>();
  return res.results;
}

const TURN_STATUSES = ['queued', 'running', 'done', 'failed'] as const;

export function toZhExemplarListItem(row: ZhExemplarCaseRow): ZhExemplarListItem {
  const ref = zhStandaloneRef(row.ref_json);
  const origin: ZhExemplarOrigin = ref ? ref.via : 'assistant';
  const section = ref?.section ?? (isZhExemplarSection(row.section) ? row.section : null);
  const status = (TURN_STATUSES as readonly string[]).includes(row.latest_status ?? '') ? (row.latest_status as (typeof TURN_STATUSES)[number]) : null;
  const failure: AiRefundReason | null =
    status === 'failed' ? ((AI_REFUND_REASONS as readonly string[]).includes(row.latest_failure ?? '') ? (row.latest_failure as AiRefundReason) : 'internal') : null;
  return {
    case_id: row.id,
    title: row.title,
    origin,
    prompt_id: ref?.prompt_id ?? null,
    section,
    exemplars: row.done_count,
    remaining: Math.max(0, ASSIST_LIMITS.zhExemplarsPerCase - row.done_count - row.inflight_count),
    latest: row.latest_id && status && row.latest_created_at !== null ? { turn_id: row.latest_id, status, failure, created_at: row.latest_created_at } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}
