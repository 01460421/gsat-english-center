/**
 * 學習助手的拍照轉錄（docs/design/learning-assistant.md §2.5、§4.8）。負責：WP-A3。
 *
 *   assistOcrCallInput   照片在前（依 ord）、固定的 <task> 在後；沒有任何學生文字（prompts/assist-ocr.ts）。
 *   assembleAssistOcr    模型輸出 → 顯示給學生確認的 AssistOcrView（§2.5「程式處理」，依序）：
 *                          1. 逐區塊只截長度（OutputFilter.quote），候選字過 OutputFilter.text；
 *                          2. 正規化並遮個資（normalizeAssistText：NFKC、不可見字元、信箱、電話、身分證字號、「姓名／座號／學號／班級／學校：」）；
 *                          3. 逐區塊比對 D8 指紋：命中整塊隱藏（d8）；
 *                          4. 佳作與評分說明樣式（officialLikeHits）：命中整塊隱藏（official_like）；
 *                          5. 有作文或中譯英的說明（writingTaskHits）時，英文 ≥ 100 個單詞的 passage 整塊隱藏（writing_english）；
 *                             其他區塊超過 100 個單詞的，確認時由 checkAssistQuestion 要求刪減（writing_english_too_long）；
 *                          6. 看得到的文字合計 ≤ 6,000 字元：超過的區塊從後面截掉並說明；
 *                          7. omitted、遮過個資、截掉的說明（notices）；
 *                          8. status 不是 ok，或沒有任何可用區塊 → ok=false（consumer 以 invalid_output 退還、刪照片）。
 *                        被隱藏的區塊 text 換成固定說明、不能編輯；原文不存、不顯示、不送出。
 *   runAssistOcr         consumer 的轉錄分支（assist/consumer.ts 分流過來）：讀照片 → 呼叫 → 後處理 → 結算
 *                        （turn 改 done、寫 output_json；案例改 ocr_ready；照片刪除；ops 事件 assist_d8_input、assist_official_like）。
 *   confirmedOcrView     學生確認題目（PUT …/question）之後，轉錄 turn 只留統計（區塊數、[[?]] 數、改了幾塊、[unclear] 幾處）。
 * 照片 24 小時到期時，沒確認的轉錄文字由 housekeeping 清掉、只留統計（ai/housekeeping.ts 的 CLEAR_UNCONFIRMED_OCR_SQL；
 * 用的是結算時記在 meta_json 的 photos_expire_at 與 ocr_stats；§4.8、§4.17）。
 *
 * 日誌與事件只記 op id、區塊數與計數，不記任何轉錄文字。
 */
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  ASSIST_INPUT_WARNING_MESSAGES,
  ASSIST_LIMITS,
  ASSIST_OCR_OMITTED,
  ASSIST_TARGET_BLOCK_KINDS,
  customPromptEnglishWords,
  normalizeAssistText,
  officialLikeHits,
  writingTaskHits,
  type AssistBlockKind,
  type AssistOcrOmitted,
  type AssistOcrView,
  type AssistStudentQuestion,
  type PhotoMime,
} from '@gsat/shared';
import { actionForFailures, callWithPolicy, log, recordFiltered, type Action, type CallContext } from '../ai/callPolicy';
import type { ClaudeCallInput } from '../ai/client';
import { d8Ranges, type D8Fingerprints } from '../ai/d8';
import { FILTER_VERSION, OutputFilter } from '../ai/filter';
import { settleOp } from '../ai/guard';
import { ASSIST_OCR_TEMPLATE_VERSION, assistOcrSchema, assistOcrSystemText, assistOcrUserText, type AssistOcrModelOutput } from '../ai/prompts/assist-ocr';
import { callSpec, type TaskConfig } from '../ai/tasks';
import { blobToBytes, toBase64 } from '../submissions/images';
import { parseJson } from '../submissions/repo';
import { nowSeconds } from '../time';
import type { CaseRow, TurnRow } from './repo';

/** 看不清的標記（模型與確認畫面用的）。確認時，非目標區塊剩下的標記換成 UNCLEAR_TOKEN。 */
export const OCR_UNCLEAR_MARK = '[[?]]';
export const UNCLEAR_TOKEN = '[unclear]';

/** 被隱藏的區塊顯示的固定說明（不能編輯；確認時也不能送回）。 */
export const OCR_HIDDEN_TEXT = {
  d8: '這段和官方受保護的資料（評分原則或參考譯文）相同，已隱藏。',
  official_like: '這段看起來是評分說明、範文或佳作，已隱藏。',
  writing_english: '這段英文太長，看起來是範文或佳作，已隱藏。',
} as const;
export type OcrHiddenKind = keyof typeof OCR_HIDDEN_TEXT;

/** 轉錄的說明（固定文字；不含任何轉錄內容）。 */
export const OCR_NOTICES = {
  truncated: '後面的內容太長沒有轉錄，請只框要問的題目。',
  answer_key: '照片裡的解答區沒有轉錄。',
  scoring: '照片裡有評分說明或範文，沒有轉錄。',
  personal: '照片裡的姓名、學號沒有轉錄；請再檢查一次有沒有個資。',
  masked: ASSIST_INPUT_WARNING_MESSAGES.personal_masked,
} as const;

/** 每一塊的長度上限（字元；schema 的說明寫 3,000）。 */
const BLOCK_MAX_CHARS = 3_000;
/** 候選字：每處最多 3 個、每個最多 40 字元。 */
const CANDIDATES_MAX = 3;
const CANDIDATE_MAX_CHARS = 40;

/** 轉錄的統計（meta_json.ocr_stats；確認或到期清掉文字之後留下的就是它）。 */
export interface OcrStats {
  blocks: number;
  unresolved: number;
}

export interface AssembledOcr {
  /** false：看不出是英文題目、看不清、沒有任何可用區塊（退還 invalid_output）。 */
  ok: boolean;
  view: AssistOcrView;
  stats: OcrStats;
  /** 計數（meta_json；不含內容）。 */
  counts: { d8: number; official_like: number; writing_english: number; masked: number; truncated: number; candidates_filtered: number };
  /** 被隱藏的區塊序號（meta_json；確認時一起擋）。 */
  hidden: number[];
}

function countMarks(text: string): number {
  return text.split(OCR_UNCLEAR_MARK).length - 1;
}

/** 題號：只留英數、最多 8 字元（「(14)」「14.」→「14」）；說明、文章、圖表沒有題號。 */
export function normalizeOcrLabel(kind: AssistBlockKind, raw: string): string | null {
  if (!(ASSIST_TARGET_BLOCK_KINDS as readonly string[]).includes(kind)) return null;
  const label = raw.normalize('NFKC').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return label === '' ? null : label;
}

/** 模型輸出 → 確認畫面（見檔頭的 8 步）。 */
export function assembleAssistOcr(output: AssistOcrModelOutput, filter: OutputFilter, fp: Pick<D8Fingerprints, 'han' | 'en'>): AssembledOcr {
  const counts = { d8: 0, official_like: 0, writing_english: 0, masked: 0, truncated: 0, candidates_filtered: 0 };
  type Work = { kind: AssistBlockKind; label: string | null; text: string; unclear: Array<{ candidates: string[] }>; hidden: OcrHiddenKind | null };
  const raw = output.blocks.slice(0, ASSIST_LIMITS.questionBlocksMax);
  if (output.blocks.length > raw.length) counts.truncated += output.blocks.length - raw.length;

  // 第 1–4 步：長度、正規化與遮個資、候選字、D8、佳作樣式。
  const blocks: Work[] = raw.map((b) => {
    const n = normalizeAssistText(filter.quote(b.text, BLOCK_MAX_CHARS));
    counts.masked += n.masked;
    const text = n.text.trim();
    const marks = countMarks(text);
    const unclear = Array.from({ length: marks }, (_, i) => {
      const wanted = (b.unclear[i]?.candidates ?? []).slice(0, CANDIDATES_MAX);
      const candidates = wanted.map((c) => filter.text(c, CANDIDATE_MAX_CHARS)).filter((c) => c !== '' && !c.includes('［已隱藏］'));
      counts.candidates_filtered += wanted.length - candidates.length;
      return { candidates };
    });
    let hidden: OcrHiddenKind | null = null;
    if (text !== '' && d8Ranges(text, fp).length > 0) hidden = 'd8';
    else if (officialLikeHits(text).length > 0) hidden = 'official_like';
    return { kind: b.kind, label: normalizeOcrLabel(b.kind, b.label), text, unclear, hidden };
  });

  // 第 5 步：作文或中譯英的題目（任何一塊有說明字樣，含被隱藏的）：長英文的文章整塊隱藏。
  const writingTask = blocks.some((b) => writingTaskHits(b.text).length > 0);
  if (writingTask) {
    for (const b of blocks) {
      if (b.hidden === null && b.kind === 'passage' && customPromptEnglishWords(b.text) >= ASSIST_LIMITS.writingLikeEnglishWordsPerBlock) b.hidden = 'writing_english';
    }
  }
  for (const b of blocks) {
    if (b.hidden) {
      counts[b.hidden] += 1;
      b.text = OCR_HIDDEN_TEXT[b.hidden];
      b.unclear = [];
    }
  }

  // 第 6 步：看得到的文字合計 ≤ 6,000 字元；超過的區塊從後面截掉（第一塊本身就太長時截它的尾巴）。
  const kept: Work[] = [];
  let total = 0;
  for (const [i, b] of blocks.entries()) {
    if (b.hidden || b.text === '') {
      if (b.text !== '') kept.push(b);
      continue;
    }
    const room = ASSIST_LIMITS.questionMaxChars - total;
    if (b.text.length <= room) {
      kept.push(b);
      total += b.text.length;
      continue;
    }
    if (total === 0) {
      const text = b.text.slice(0, room).replace(/\[\[\?\]?$|\[\[$|\[$/, '').trimEnd();
      kept.push({ ...b, text, unclear: b.unclear.slice(0, countMarks(text)) });
      total += text.length;
      counts.truncated += blocks.length - i;
    } else {
      counts.truncated += blocks.length - i;
    }
    break;
  }

  // 學生的作答：同樣只截長度、遮個資；命中 D8 或佳作樣式就不顯示。
  const seen = normalizeAssistText(filter.quote(output.student_answer_seen, ASSIST_LIMITS.studentAnswerMaxChars)).text.trim();
  const studentAnswerSeen = seen !== '' && (d8Ranges(seen, fp).length > 0 || officialLikeHits(seen).length > 0) ? '' : seen;

  // 第 7 步：說明。
  const omitted = [...new Set(output.omitted)].filter((o): o is AssistOcrOmitted => (ASSIST_OCR_OMITTED as readonly string[]).includes(o));
  const notices: string[] = [];
  if (counts.truncated > 0) notices.push(OCR_NOTICES.truncated);
  if (omitted.includes('answer_key') || omitted.includes('explanation')) notices.push(OCR_NOTICES.answer_key);
  if (omitted.includes('scoring_notes') || omitted.includes('model_text') || omitted.includes('reference_translation')) notices.push(OCR_NOTICES.scoring);
  if (omitted.includes('personal_info')) notices.push(OCR_NOTICES.personal);
  if (counts.masked > 0) notices.push(OCR_NOTICES.masked);

  const view: AssistOcrView = {
    status: output.status,
    blocks: kept.map((b) => ({ kind: b.kind, label: b.label, text: b.text, unclear: b.unclear, hidden: b.hidden })),
    student_answer_seen: studentAnswerSeen,
    omitted,
    notices,
  };
  const visible = kept.filter((b) => b.hidden === null);
  const stats: OcrStats = { blocks: kept.length, unresolved: visible.reduce((n, b) => n + countMarks(b.text), 0) };
  // 第 8 步：沒有任何可用區塊（全部被隱藏、或模型說看不出題目）就退還。
  const ok = output.status === 'ok' && visible.some((b) => b.text.trim() !== '');
  if (!ok) view.blocks = [];
  return { ok, view, stats, counts, hidden: kept.flatMap((b, i) => (b.hidden ? [i] : [])) };
}

/** 呼叫輸入：照片在前（依 ord）、固定的文字在後（requests.ts 的寫作 OCR 同一個寫法）。 */
export function assistOcrCallInput(tc: TaskConfig, photos: Array<{ mime: PhotoMime; bytes: Uint8Array }>): ClaudeCallInput {
  const spec = callSpec(tc, 'ocr');
  const content: BetaContentBlockParam[] = [
    ...photos.map((p): BetaContentBlockParam => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: toBase64(p.bytes) } })),
    { type: 'text', text: assistOcrUserText(photos.length) },
  ];
  return {
    task: tc.task,
    spec,
    timeoutMs: tc.timeoutMs,
    maxRetries: tc.maxRetries,
    system: assistOcrSystemText(),
    schema: assistOcrSchema,
    content,
    templateVersion: ASSIST_OCR_TEMPLATE_VERSION,
  };
}

// ───────────────────────── 確認與到期清理 ─────────────────────────

/**
 * 學生確認題目之後，轉錄 turn 只留統計（§2.5「轉錄的原始輸出只留統計，文字清掉」）：
 * 原本的區塊數與 [[?]] 數、確認的區塊裡和轉錄不同的有幾塊（edited）、送出時換成 [unclear] 的有幾處（unclear_kept）。
 */
export function confirmedOcrView(ocr: AssistOcrView, confirmed: AssistStudentQuestion, unclearKept: number): AssistOcrView {
  const original = new Set(ocr.blocks.filter((b) => b.hidden === null).map((b) => b.text.trim()));
  // 送出時才換成 [unclear] 的標記不算學生改的。
  const edited = confirmed.blocks.filter((b) => !original.has(b.text.split(UNCLEAR_TOKEN).join(OCR_UNCLEAR_MARK).trim())).length;
  const stats = ocr.stats ?? {
    blocks: ocr.blocks.length,
    unresolved: ocr.blocks.filter((b) => b.hidden === null).reduce((n, b) => n + countMarks(b.text), 0),
  };
  return { status: ocr.status, blocks: [], student_answer_seen: '', omitted: ocr.omitted, notices: [], stats: { blocks: stats.blocks, unresolved: stats.unresolved, edited, unclear_kept: unclearKept } };
}

/** 確認送回的區塊裡有被隱藏區塊的固定說明（前端不能編輯、不送回；被改過的請求一律擋下）。 */
export function containsHiddenPlaceholder(text: string): boolean {
  return Object.values(OCR_HIDDEN_TEXT).some((t) => text.includes(t.replace(/。$/, '')));
}

// ───────────────────────── consumer 的轉錄分支 ─────────────────────────

/** 轉錄的處理脈絡：共用的呼叫脈絡＋turn、案例與指紋（題目還沒有）。 */
export type OcrCtx = CallContext & { turn: TurnRow; caseRow: CaseRow; fp: D8Fingerprints };

/** ops 事件（只在這次結算成功時寫：以 settle_token 為條件）。 */
function opsEventIfSettled(db: D1Database, opId: string, token: string, kind: string, detail: Record<string, unknown>): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT ?1, 'warn', ?2 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`)
    .bind(kind, JSON.stringify(detail), opId, token);
}

/**
 * 轉錄一次（§4.8 第 5–7 步）：
 *   - 照片已經到期或被刪：退還 expired（照片本來就沒了）。
 *   - 看不出是英文題目、看不清、全部被隱藏：退還 invalid_output（refund.ts 同時刪照片，要重拍；算進每日退還上限）；
 *     有區塊因 D8 或佳作樣式被隱藏時照樣寫 assist_d8_input、assist_official_like。
 *   - 成功：turn 改 done、寫 output_json 與 meta（隱藏區塊序號、計數、統計、照片的到期時間）；案例改 ocr_ready；刪照片；
 *     D8 隱藏寫 assist_d8_input、佳作樣式與長英文隱藏寫 assist_official_like（只有 op id 與區塊數）。
 */
export async function runAssistOcr(ctx: OcrCtx): Promise<Action> {
  const { db, caseRow, turn, op, tc, fp } = ctx;
  const nowS = nowSeconds(ctx.now());
  const photos = await db
    .prepare('SELECT ord, mime, data, expires_at FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND expires_at >= ?3 ORDER BY ord')
    .bind(caseRow.id, op.user_id, nowS)
    .all<{ ord: number; mime: PhotoMime; data: unknown; expires_at: number }>();
  if (photos.results.length === 0) return { kind: 'refund', reason: 'expired' };
  const input = assistOcrCallInput(
    tc,
    photos.results.map((p) => ({ mime: p.mime, bytes: blobToBytes(p.data) })),
  );
  ctx.callInput = () => input;
  const state: { assembled: AssembledOcr | null; filter: OutputFilter | null; model: string; promptVersion: string } = { assembled: null, filter: null, model: input.spec.model, promptVersion: '' };
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    // 看不出是英文題目、全部被隱藏：不算格式錯誤、不重試，下面退還（同作文 OCR 的 readable=false）。
    Object.assign(state, { assembled: assembleAssistOcr(data as AssistOcrModelOutput, filter, fp), filter, model, promptVersion });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  if (state.filter) await recordFiltered(ctx, state.filter);
  const assembled = state.assembled!;
  const hiddenOfficialCount = assembled.counts.official_like + assembled.counts.writing_english;
  if (!assembled.ok) {
    log('assist_ocr_unusable', { op_id: op.id, status: assembled.view.status, blocks: assembled.stats.blocks });
    // 全部被隱藏（整頁評分原則、佳作或長篇英文）也要留下紀錄（§4.16）：這條路徑退還、沒有結算，所以不能等結算的 batch；
    // 以「操作還沒結算或退還」為條件寫，退還之後的重送不會再寫。只有 op id 與區塊數。
    const events = [
      ...(assembled.counts.d8 > 0 ? [{ kind: 'assist_d8_input', detail: { op_id: op.id, blocks: assembled.counts.d8, refunded: true } }] : []),
      ...(hiddenOfficialCount > 0 ? [{ kind: 'assist_official_like', detail: { op_id: op.id, blocks: hiddenOfficialCount, where: 'ocr', refunded: true } }] : []),
    ];
    if (events.length > 0) {
      try {
        await db.batch(
          events.map((e) =>
            db
              .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT ?1, 'warn', ?2 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND status = 'reserved')`)
              .bind(e.kind, JSON.stringify(e.detail), op.id),
          ),
        );
      } catch (err) {
        console.error('寫入轉錄隱藏的事件失敗（不影響退還）', op.id, err);
      }
    }
    return { kind: 'refund', reason: 'invalid_output' };
  }
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const meta = {
    filter_version: FILTER_VERSION,
    d8_fp: fp.version,
    hidden: assembled.hidden,
    counts: assembled.counts,
    ocr_stats: assembled.stats,
    photos: photos.results.length,
    photos_expire_at: Math.min(...photos.results.map((p) => p.expires_at)),
  };
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE assist_turns SET status = 'done', output_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, lease_until = NULL, updated_at = ?5
            WHERE id = ?6 AND user_id = ?7 AND op_id = ?8 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?8 AND settle_token = ?9)`,
        )
        .bind(JSON.stringify(assembled.view), state.promptVersion, state.model, JSON.stringify(meta).slice(0, 4096), now, turn.id, op.user_id, op.id, token),
      db
        .prepare(
          `UPDATE assist_cases SET status = 'ocr_ready', d8_hidden = CASE WHEN ?1 = 1 THEN 1 ELSE d8_hidden END, updated_at = ?2, expires_at = ?3
            WHERE id = ?4 AND user_id = ?5 AND status = 'ocr_queued' AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?6 AND settle_token = ?7)`,
        )
        .bind(assembled.counts.d8 > 0 ? 1 : 0, now, now + ASSIST_LIMITS.retentionDays * 86_400, caseRow.id, op.user_id, op.id, token),
      // 照片用完即丟（§4.17：轉錄結算時刪除）。
      db
        .prepare(`DELETE FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`)
        .bind(caseRow.id, op.user_id, op.id, token),
      ...(assembled.counts.d8 > 0 ? [opsEventIfSettled(db, op.id, token, 'assist_d8_input', { op_id: op.id, blocks: assembled.counts.d8 })] : []),
      ...(hiddenOfficialCount > 0 ? [opsEventIfSettled(db, op.id, token, 'assist_official_like', { op_id: op.id, blocks: hiddenOfficialCount, where: 'ocr' })] : []),
    ],
  });
  log('ai_settled', { op_id: op.id, task: op.task, settled, blocks: assembled.stats.blocks });
  return { kind: 'done' };
}

/** 確認時讀最新一次完成的轉錄（沒有回 null）。 */
export async function latestOcr(db: D1Database, userId: number, caseId: string): Promise<{ id: string; view: AssistOcrView; meta: Record<string, unknown> } | null> {
  const row = await db
    .prepare(`SELECT id, output_json, meta_json FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 AND kind = 'ocr' AND status = 'done' ORDER BY seq DESC LIMIT 1`)
    .bind(caseId, userId)
    .first<{ id: string; output_json: string | null; meta_json: string }>();
  const view = parseJson<AssistOcrView>(row?.output_json ?? null);
  if (!row || !view) return null;
  return { id: row.id, view, meta: parseJson<Record<string, unknown>>(row.meta_json) ?? {} };
}
