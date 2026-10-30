/**
 * 國文任務在 Queue consumer 的分支（docs/design/assistant-subjects.md §2.3、§2.5、§7.3）：assist/consumer.ts 搶到租約、讀到 turn 與
 * 案例之後，國文案例交給這裡（英文的 runAnalyze、runFollowup、runAssistOcr 一個字都不改）。
 *
 *   runZhAnalyze   組請求（subjects/chinese/requests.ts；<student_patterns> 只帶國文的錯因次數，「同一份題目問另一部分」帶前一個
 *                  案例的摘要）→ callWithPolicy → 後處理（output.ts）→ 結算：turn 改 done、寫 output_json 與 meta（含 checks 計數）；
 *                  案例改 analyzed、analyses＋1、技能與錯因，**另外寫回 section（模型的題型）、verdict、wrong_count**（§7.3）。
 *                  模型判定科目不符（detected_subject 是英文、數學、社會、自然）→ turn 的 meta_json 記 detected_subject、
 *                  寫 assist_subject_mismatch，以 invalid_output 退還（算進每日退還上限）。
 *                  簡體字太多（standards.ts）→ 當成內容不合格，這次投遞再付費重寫一次（callWithPolicy 的內容重試）。
 *   runZhFollowup  上下文用 digest.ts 的摘要（≤ 1,000 字）、題目截到 3,000 字、先前問答 ≤ 1,200 字（不加快取標記）。
 *   runZhOcr       國文轉錄（assist-zh-ocr 提示＋ocr.ts 的組裝）：status other_subject → meta_json 記 detected_subject，以 invalid_output
 *                  退還（refund.ts 同時刪照片，同英文 not_english_question 的規則）；成功時同英文的結算（ocr_ready、刪照片）。
 *   runZhExemplar  國寫範文（國寫範文設計 §2、§5、§5.6）：最新一次國寫指導的摘要＋題目全部區塊（不送學生的段落）→ callWithPolicy
 *                  → 後處理（exemplar.ts）。重寫只有三種（比賽指紋、超過硬限制、簡體字），一個操作跨投遞最多付費產生 2 次
 *                  （ai_calls 的內容失敗＋turn 的 meta_json.content_failures）。結算：turn 改 done、寫 output_json 與 meta（task 仍是
 *                  zh_exemplar）；案例只更新 updated_at／expires_at、d8_hidden、safety_flag（不動 followups、analyses、狀態）。
 *                  讀不到比賽語料指紋或國寫指導 → 退還 internal；內容失敗（離題、隱藏太多、超過上限太多）→ 退還 invalid_output。
 * ops 事件的 detail 都帶 subject；日誌只記 op id、任務、狀態與數字，不記題目、學生文字或解析內容。
 */
import {
  ASSIST_LIMITS,
  zhExemplarLimits,
  guessZhSection,
  isZhCaseKind,
  isZhErrorCode,
  type AssistDetectedSubject,
  type AssistQuestionView,
  type PhotoMime,
  type ZhAnalysisView,
  type ZhCaseKind,
  type ZhFollowupView,
} from '@gsat/shared';
import { actionForFailures, callWithPolicy, log, recordFiltered, type Action, type CallContext } from '../../../ai/callPolicy';
import type { D8Fingerprints } from '../../../ai/d8';
import { FILTER_VERSION, OutputFilter } from '../../../ai/filter';
import { settleOp } from '../../../ai/guard';
import { blobToBytes } from '../../../submissions/images';
import { parseJson } from '../../../submissions/repo';
import { nowSeconds } from '../../../time';
import { codeList, mergeCodes, type CaseRow, type TurnRow } from '../../repo';
import { requestCaseOf } from '../../requests';
import { chineseSubject } from '../index';
import type { ZhAnalysisPostprocessed, ZhFollowupPostprocessed, ZhOcrAssembled } from '../types';
import { zhAnalysisDigest, zhRelatedDigest } from './digest';
import type { ZhFingerprints } from './d8';
import { postprocessZhExemplar, zhExemplarSectionOf, type ZhExemplarPostprocessed } from './exemplar';
import { assembleZhOcr } from './ocr';
import { postprocessZhAnalysis, postprocessZhFollowup, zhSubjectMismatch } from './output';
import { ZH_EXEMPLAR_DIGEST_CHARS, zhExemplarCallInput, zhFollowupCallInput, zhStudentPatternsText, type ZhFollowupRound } from './requests';
import type { ZhAnalysisOutput, ZhExemplarOutput, ZhFollowupOutput, ZhOcrOutput } from './schemas';
import { zhSettlement } from './settle';

/** turn 的 output_json 上限（assist_turns 的 CHECK）。 */
const OUTPUT_JSON_MAX_CHARS = 98_304;

/** 國文的處理脈絡：共用的呼叫脈絡＋turn、案例、英文與國文的指紋（解析與追問另外有題目）。 */
export type ZhCtx = CallContext & { turn: TurnRow; caseRow: CaseRow; fp: D8Fingerprints; zh: ZhFingerprints };

/** ops 事件（只在這次結算成功時寫：以 settle_token 為條件）。 */
function opsEventIfSettled(db: D1Database, opId: string, token: string, kind: string, detail: Record<string, unknown>): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT ?1, 'warn', ?2 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`)
    .bind(kind, JSON.stringify(detail).slice(0, 4000), opId, token);
}

/** 安全事件（同上）。 */
function safetyIfSettled(db: D1Database, opId: string, token: string, category: string, ref: string | null): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'wellbeing_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?1 AND settle_token = ?4)`)
    .bind(opId, category, ref, token);
}

/** 共同的附帶事件：身心安全、D8 隱藏、答案疑慮（detail 都帶 subject；只有 id、代碼與計數）。 */
function sideEvents(ctx: ZhCtx, token: string, post: ZhAnalysisPostprocessed | ZhFollowupPostprocessed, labels: string[]): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const { db, op } = ctx;
  if (post.safety !== 'none') out.push(safetyIfSettled(db, op.id, token, post.safety, ctx.userRef));
  if (post.meta.d8_hidden > 0) out.push(opsEventIfSettled(db, op.id, token, 'assist_d8_output', { op_id: op.id, subject: 'chinese', fields: post.meta.d8_hidden }));
  if (post.keyConcern) out.push(opsEventIfSettled(db, op.id, token, 'assist_key_concern', { op_id: op.id, subject: 'chinese', labels }));
  return out;
}

/**
 * 科目不符（解析或轉錄）：turn 的 meta_json 記 detected_subject（畫面依它請學生換科目），寫 assist_subject_mismatch
 * （只有 op id、階段與科目），然後由呼叫端以 invalid_output 退還。都以「操作還沒結算或退還」為條件：重送不會重寫。
 */
async function markMismatch(ctx: ZhCtx, stage: 'analyze' | 'ocr', detected: AssistDetectedSubject): Promise<void> {
  const { db, op, turn } = ctx;
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE assist_turns SET meta_json = json_set(meta_json, '$.detected_subject', ?1)
            WHERE id = ?2 AND user_id = ?3 AND op_id = ?4 AND status IN ('queued', 'running') AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?4 AND status = 'reserved')`,
        )
        .bind(detected, turn.id, op.user_id, op.id),
      db
        .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT 'assist_subject_mismatch', 'info', ?1 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?2 AND status = 'reserved')`)
        .bind(JSON.stringify({ op_id: op.id, subject: 'chinese', stage, detected_subject: detected }), op.id),
    ]);
  } catch (err) {
    console.error('寫入科目不符的紀錄失敗（不影響退還）', op.id, err);
  }
  log('assist_subject_mismatch', { op_id: op.id, stage, detected_subject: detected });
}

/** <student_patterns>：這位學生其他國文案例的錯因次數（同一科；§7.3）。讀不到就不帶。 */
async function zhStudentPatterns(db: D1Database, userId: number, caseId: string, now: number): Promise<string | null> {
  try {
    const counts = await db
      .prepare(
        `SELECT j.value AS code, COUNT(DISTINCT c.id) AS n FROM assist_cases c, json_each(c.errors_json) j
          WHERE c.user_id = ?1 AND c.id <> ?2 AND c.expires_at > ?3 AND COALESCE(json_extract(c.ref_json, '$.subject'), 'english') = 'chinese'
          GROUP BY j.value ORDER BY n DESC, j.value LIMIT 10`,
      )
      .bind(userId, caseId, now)
      .all<{ code: unknown; n: number }>();
    return zhStudentPatternsText(counts.results.filter((r): r is { code: string; n: number } => isZhErrorCode(r.code)));
  } catch (err) {
    console.error('讀學生的國文錯因歷史失敗（不帶 student_patterns）', err);
    return null;
  }
}

/** 最新一次完成的國文解析。 */
async function latestZhAnalysis(db: D1Database, userId: number, caseId: string, beforeSeq?: number): Promise<ZhAnalysisView | null> {
  const row = await db
    .prepare(`SELECT output_json FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 AND kind = 'analyze' AND status = 'done' AND seq < ?3 ORDER BY seq DESC LIMIT 1`)
    .bind(caseId, userId, beforeSeq ?? Number.MAX_SAFE_INTEGER)
    .first<{ output_json: string | null }>();
  const view = parseJson<ZhAnalysisView>(row?.output_json ?? null);
  return view && isZhCaseKind(view.kind) ? view : null;
}

/** 「同一份題目問另一部分」：前一個案例（同一位使用者、同一科）最新一次解析的摘要（≤ 600 字）；沒有就不帶。 */
async function relatedSummary(db: D1Database, userId: number, refJson: string, now: number): Promise<string | null> {
  const id = parseJson<{ related_case_id?: unknown }>(refJson)?.related_case_id;
  if (typeof id !== 'string') return null;
  const related = await db
    .prepare(`SELECT id FROM assist_cases WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3 AND COALESCE(json_extract(ref_json, '$.subject'), 'english') = 'chinese'`)
    .bind(id, userId, now)
    .first<{ id: string }>();
  if (!related) return null;
  const view = await latestZhAnalysis(db, userId, related.id);
  return view ? zhRelatedDigest(view) : null;
}

function kindOf(caseRow: CaseRow): ZhCaseKind {
  return isZhCaseKind(caseRow.kind) ? caseRow.kind : 'zh_choice';
}

// ───────────────────────── 解析 ─────────────────────────

export async function runZhAnalyze(ctx: ZhCtx & { question: AssistQuestionView }): Promise<Action> {
  const { db, caseRow, question, fp, zh, tc, op } = ctx;
  const kind = kindOf(caseRow);
  const nowS = nowSeconds(ctx.now());
  const [patterns, related] = await Promise.all([zhStudentPatterns(db, op.user_id, caseRow.id, nowS), relatedSummary(db, op.user_id, caseRow.ref_json, nowS)]);
  const reqCase = requestCaseOf(caseRow, question);
  const input = chineseSubject.analyze.callInput(tc, reqCase, { patterns, fp: null, related });
  ctx.callInput = () => input;
  const state: { post: ZhAnalysisPostprocessed | null; mismatch: AssistDetectedSubject | null; filter: OutputFilter | null; model: string; promptVersion: string; json: string } = {
    post: null,
    mismatch: null,
    filter: null,
    model: input.spec.model,
    promptVersion: '',
    json: '',
  };
  let attempts = 0;
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    attempts += 1;
    const raw = data as ZhAnalysisOutput;
    const mismatch = zhSubjectMismatch(raw.detected_subject);
    if (mismatch) {
      Object.assign(state, { mismatch, post: null, model, promptVersion });
      return null;
    }
    const filter = new OutputFilter();
    const post = postprocessZhAnalysis(raw, { kind, question, filter, fp, zh, allowRetry: attempts === 1 });
    if (post.retry) return post.retry;
    const json = JSON.stringify(post.view);
    if (json.length > OUTPUT_JSON_MAX_CHARS) return 'output_too_large';
    Object.assign(state, { post, mismatch: null, filter, model, promptVersion, json });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  if (state.mismatch) {
    await markMismatch(ctx, 'analyze', state.mismatch);
    return { kind: 'refund', reason: 'invalid_output' };
  }
  const post = state.post!;
  const settlement = zhSettlement(post.view);
  const meta = {
    subject: 'chinese',
    kind,
    items: parseJson<{ items?: number }>(ctx.turn.meta_json)?.items ?? question.targets.length,
    filter_version: FILTER_VERSION,
    d8_fp: fp.version,
    zh_fp: zh.version,
    cacheable: false,
    patterns: patterns !== null,
    related: related !== null,
    counts: post.meta,
    checks: post.checks,
  };
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE assist_turns SET status = 'done', output_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, lease_until = NULL, updated_at = ?5
            WHERE id = ?6 AND user_id = ?7 AND op_id = ?8 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?8 AND settle_token = ?9)`,
        )
        .bind(state.json, state.promptVersion, state.model, JSON.stringify(meta).slice(0, 4096), now, ctx.turn.id, op.user_id, op.id, token),
      db
        .prepare(
          `UPDATE assist_cases SET status = 'analyzed', analyses = MIN(analyses + 1, ?1), skills_json = ?2, errors_json = ?3,
                  safety_flag = COALESCE(?4, safety_flag), d8_hidden = CASE WHEN ?5 = 1 THEN 1 ELSE d8_hidden END,
                  section = ?6, verdict = ?7, wrong_count = ?8, updated_at = ?9, expires_at = ?10
            WHERE id = ?11 AND user_id = ?12 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?13 AND settle_token = ?14)`,
        )
        .bind(
          ASSIST_LIMITS.analysesPerCase,
          mergeCodes(codeList(caseRow.skills_json), post.skillCodes),
          mergeCodes(codeList(caseRow.errors_json), post.errorCodes),
          post.safety === 'none' ? null : post.safety,
          post.meta.d8_hidden > 0 ? 1 : 0,
          settlement.section,
          settlement.verdict,
          Math.min(8, settlement.wrongCount),
          now,
          now + ASSIST_LIMITS.retentionDays * 86_400,
          caseRow.id,
          op.user_id,
          op.id,
          token,
        ),
      ...sideEvents(ctx, token, post, question.targets.map((t) => t.display_label)),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  log('ai_settled', { op_id: op.id, task: op.task, subject: 'chinese', settled, items: question.targets.length });
  return { kind: 'done' };
}

// ───────────────────────── 追問 ─────────────────────────

export async function runZhFollowup(ctx: ZhCtx & { question: AssistQuestionView }): Promise<Action> {
  const { db, caseRow, question, fp, zh, tc, op, turn } = ctx;
  const kind = kindOf(caseRow);
  const turns = await db
    .prepare(`SELECT kind, input_text, output_json, seq FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 AND seq < ?3 AND status = 'done' ORDER BY seq`)
    .bind(caseRow.id, op.user_id, turn.seq)
    .all<{ kind: string; input_text: string | null; output_json: string | null; seq: number }>();
  const analyses = turns.results.filter((t) => t.kind === 'analyze');
  const analysis = parseJson<ZhAnalysisView>(analyses[analyses.length - 1]?.output_json ?? null);
  if (!analysis || !isZhCaseKind(analysis.kind) || turn.input_text === null) return { kind: 'refund', reason: 'internal' };
  const rounds: ZhFollowupRound[] = turns.results
    .filter((t) => t.kind === 'followup' && t.input_text !== null)
    .map((t) => ({ question: t.input_text!, reply: parseJson<ZhFollowupView>(t.output_json) }));
  const mode: 'hint' | 'explain' = turn.mode === 'hint' ? 'hint' : 'explain';
  const input = zhFollowupCallInput(tc, { case: requestCaseOf(caseRow, question), digest: zhAnalysisDigest(analysis), rounds, question: turn.input_text, mode, label: turn.label });
  ctx.callInput = () => input;
  const answers: Record<string, string> =
    analysis.kind === 'zh_choice' ? Object.fromEntries(analysis.items.flatMap((it) => (it.answer_key ? [[it.label, it.answer_key.text]] : []))) : {};
  // 字音題（追問指定的那一題，沒指定時任一題）：提示模式不能出現注音。
  const askedItems = analysis.kind === 'zh_choice' ? analysis.items.filter((it) => !turn.label || it.label === turn.label) : [];
  const sound =
    analysis.kind === 'zh_choice' &&
    (analysis.section === 'zh_sound' ||
      askedItems.some((it) => it.item_type === 'zh_sound') ||
      question.targets.some((t) => (!turn.label || t.label === turn.label) && Boolean(t.stem) && guessZhSection(t.stem ?? '')?.section === 'zh_sound'));
  const state: { post: ZhFollowupPostprocessed | null; filter: OutputFilter | null; model: string; promptVersion: string } = { post: null, filter: null, model: input.spec.model, promptVersion: '' };
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    Object.assign(state, { post: postprocessZhFollowup(data as ZhFollowupOutput, { kind, question, mode, filter, fp, zh, answers, sound }), filter, model, promptVersion });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  const post = state.post!;
  const json = JSON.stringify(post.view);
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const meta = { subject: 'chinese', filter_version: FILTER_VERSION, d8_fp: fp.version, zh_fp: zh.version, rounds: rounds.length, counts: post.meta, checks: post.checks };
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE assist_turns SET status = 'done', output_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, lease_until = NULL, updated_at = ?5
            WHERE id = ?6 AND user_id = ?7 AND op_id = ?8 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?8 AND settle_token = ?9)`,
        )
        .bind(json, state.promptVersion, state.model, JSON.stringify(meta).slice(0, 4096), now, turn.id, op.user_id, op.id, token),
      db
        .prepare(
          `UPDATE assist_cases SET followups = MIN(followups + 1, ?1), errors_json = ?2, safety_flag = COALESCE(?3, safety_flag),
                  d8_hidden = CASE WHEN ?4 = 1 THEN 1 ELSE d8_hidden END, updated_at = ?5, expires_at = ?6
            WHERE id = ?7 AND user_id = ?8 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?9 AND settle_token = ?10)`,
        )
        .bind(
          ASSIST_LIMITS.followupsPerCase,
          mergeCodes(codeList(caseRow.errors_json), post.errorCodes),
          post.safety === 'none' ? null : post.safety,
          post.meta.d8_hidden > 0 ? 1 : 0,
          now,
          now + ASSIST_LIMITS.retentionDays * 86_400,
          caseRow.id,
          op.user_id,
          op.id,
          token,
        ),
      ...sideEvents(ctx, token, post, []),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  log('ai_settled', { op_id: op.id, task: op.task, subject: 'chinese', settled });
  return { kind: 'done' };
}

// ───────────────────────── 國寫範文 ─────────────────────────

/** 一個國寫範文的操作最多付費產生幾次（國寫範文設計 §5.6；同英文作文範文）。 */
export const ZH_EXEMPLAR_CONTENT_ATTEMPTS = 2;

/**
 * 這個操作已有的內容失敗次數（跨 Queue 投遞累計；同 exemplars/attempts.ts）：ai_calls 裡截斷或格式不符的呼叫，加上語意檢查要求重寫時
 * 記在 turn 的 meta_json.content_failures（只認還指向這個操作的那一列）。?1 op_id ?2 turn id ?3 user_id。
 */
export const ZH_EXEMPLAR_FAILURES_SQL = `SELECT
    (SELECT COUNT(*) FROM ai_calls WHERE op_id = ?1
       AND (stop_reason = 'max_tokens' OR error_code IN ('schema_mismatch', 'invalid_json', 'unexpected_stop')))
  + COALESCE((SELECT json_extract(meta_json, '$.content_failures') FROM assist_turns WHERE id = ?2 AND user_id = ?3 AND op_id = ?1), 0) AS n`;

export async function zhExemplarContentFailures(db: D1Database, ref: { opId: string; turnId: string; userId: number }): Promise<number> {
  const row = await db.prepare(ZH_EXEMPLAR_FAILURES_SQL).bind(ref.opId, ref.turnId, ref.userId).first<{ n: number }>();
  return Math.max(0, Math.floor(Number(row?.n ?? 0)));
}

/** 語意檢查要求重寫時加 1（回傳重寫原因之前執行；上限 4）。只改還指向這個操作、還在進行中的那一列。 */
function bumpExemplarFailure(db: D1Database, ref: { opId: string; turnId: string; userId: number }): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE assist_turns SET meta_json = json_set(meta_json, '$.content_failures', MIN(COALESCE(json_extract(meta_json, '$.content_failures'), 0) + 1, 4))
        WHERE id = ?1 AND user_id = ?2 AND op_id = ?3 AND status IN ('queued', 'running')`,
    )
    .bind(ref.turnId, ref.userId, ref.opId);
}

export async function runZhExemplar(ctx: ZhCtx & { question: AssistQuestionView }): Promise<Action> {
  const { db, caseRow, question, fp, zh, tc, op, turn } = ctx;
  // 比賽語料指紋是必填（打包的真檔一定有；讀不到就不呼叫模型）。
  if (!zh.contest || zh.contest.size === 0 || caseRow.kind !== 'zh_writing') return { kind: 'refund', reason: 'internal' };
  const analysis = await latestZhAnalysis(db, op.user_id, caseRow.id, turn.seq);
  if (!analysis || analysis.kind !== 'zh_writing' || analysis.off_topic) return { kind: 'refund', reason: 'internal' };
  const section = zhExemplarSectionOf(analysis, question);
  const limits = zhExemplarLimits(question, section);
  const hasQ1 = section === 'zh_writing_reason' && analysis.q1 !== null;
  const input = zhExemplarCallInput(tc, { question, section, digest: zhAnalysisDigest(analysis, ZH_EXEMPLAR_DIGEST_CHARS), hasQ1, limits });
  ctx.callInput = () => input;
  const ref = { opId: op.id, turnId: turn.id, userId: op.user_id };
  const failures = await zhExemplarContentFailures(db, ref);
  const remaining = ZH_EXEMPLAR_CONTENT_ATTEMPTS - failures;
  if (remaining <= 0) return { kind: 'refund', reason: 'invalid_output' };
  const state: { post: ZhExemplarPostprocessed | null; filter: OutputFilter | null; model: string; promptVersion: string; json: string; attempts: number; retries: number } = {
    post: null,
    filter: null,
    model: input.spec.model,
    promptVersion: '',
    json: '',
    attempts: 0,
    retries: 0,
  };
  const result = await callWithPolicy(
    ctx,
    input,
    async (data, _callId, model, promptVersion) => {
      state.attempts += 1;
      const filter = new OutputFilter();
      const post = postprocessZhExemplar(data as ZhExemplarOutput, { question, section, limits, hasQ1, filter, fp, zh, allowRetry: failures + state.attempts < ZH_EXEMPLAR_CONTENT_ATTEMPTS });
      if (post.retry) {
        // 語意檢查要求重寫：先記下（跨投遞的內容失敗次數），再回傳原因讓 callWithPolicy 決定在這次重寫或交回 Queue。
        state.retries += 1;
        log('assist_zh_exemplar_retry', { op_id: op.id, reason: post.retry });
        await bumpExemplarFailure(db, ref).run();
        return post.retry;
      }
      if (post.view) {
        const json = JSON.stringify(post.view);
        if (json.length > OUTPUT_JSON_MAX_CHARS) return 'output_too_large';
        state.json = json;
      }
      Object.assign(state, { post, filter, model, promptVersion });
      return null;
    },
    { contentAttempts: remaining },
  );
  if (!result.ok) return actionForFailures([result]);
  const post = state.post!;
  if (state.filter) await recordFiltered(ctx, state.filter);
  if (post.safety !== 'none') {
    // 內容失敗也要留下身心安全旗標（退還之前就記；同一個操作同一個類別只寫一次）。
    await db
      .prepare(
        `INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'wellbeing_flag', ?2, ?3
          WHERE NOT EXISTS (SELECT 1 FROM ai_safety_events WHERE op_id = ?1 AND kind = 'wellbeing_flag' AND category = ?2)`,
      )
      .bind(op.id, post.safety, ctx.userRef)
      .run();
  }
  if (post.failure || !post.view) {
    log('assist_zh_exemplar_unusable', { op_id: op.id, reason: post.failure, checks: Object.keys(post.checks).length });
    return { kind: 'refund', reason: 'invalid_output' };
  }
  const meta = {
    subject: 'chinese',
    task: 'zh_exemplar',
    section,
    filter_version: FILTER_VERSION,
    d8_fp: fp.version,
    zh_fp: zh.version,
    counts: post.meta,
    checks: post.checks,
    content_failures: failures + state.retries,
  };
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE assist_turns SET status = 'done', output_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, lease_until = NULL, updated_at = ?5
            WHERE id = ?6 AND user_id = ?7 AND op_id = ?8 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?8 AND settle_token = ?9)`,
        )
        .bind(state.json, state.promptVersion, state.model, JSON.stringify(meta).slice(0, 4096), now, turn.id, op.user_id, op.id, token),
      db
        .prepare(
          `UPDATE assist_cases SET safety_flag = COALESCE(?1, safety_flag), d8_hidden = CASE WHEN ?2 = 1 THEN 1 ELSE d8_hidden END, updated_at = ?3, expires_at = ?4
            WHERE id = ?5 AND user_id = ?6 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?7 AND settle_token = ?8)`,
        )
        .bind(post.safety === 'none' ? null : post.safety, post.meta.d8_hidden > 0 ? 1 : 0, now, now + ASSIST_LIMITS.retentionDays * 86_400, caseRow.id, op.user_id, op.id, token),
      ...(post.meta.d8_hidden > 0 ? [opsEventIfSettled(db, op.id, token, 'assist_d8_output', { op_id: op.id, subject: 'chinese', fields: post.meta.d8_hidden })] : []),
      ...(post.meta.contest_hidden > 0
        ? [opsEventIfSettled(db, op.id, token, 'assist_zh_exemplar_overlap', { op_id: op.id, paragraphs: post.meta.contest_hidden, attempt: failures + state.attempts })]
        : []),
    ],
  });
  log('ai_settled', { op_id: op.id, task: op.task, subject: 'chinese', settled });
  return { kind: 'done' };
}

// ───────────────────────── 轉錄 ─────────────────────────

export async function runZhOcr(ctx: ZhCtx): Promise<Action> {
  const { db, caseRow, turn, op, tc, fp, zh } = ctx;
  const nowS = nowSeconds(ctx.now());
  const photos = await db
    .prepare('SELECT ord, mime, data, expires_at FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND expires_at >= ?3 ORDER BY ord')
    .bind(caseRow.id, op.user_id, nowS)
    .all<{ ord: number; mime: PhotoMime; data: unknown; expires_at: number }>();
  if (photos.results.length === 0) return { kind: 'refund', reason: 'expired' };
  const input = chineseSubject.ocr.callInput(
    tc,
    photos.results.map((p) => ({ mime: p.mime, bytes: blobToBytes(p.data) })),
  );
  ctx.callInput = () => input;
  const state: { assembled: ZhOcrAssembled | null; filter: OutputFilter | null; model: string; promptVersion: string } = { assembled: null, filter: null, model: input.spec.model, promptVersion: '' };
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    // 不是國文題目、看不清、全部被隱藏：不算格式錯誤、不重試，下面退還（同英文）。
    Object.assign(state, { assembled: assembleZhOcr(data as ZhOcrOutput, { filter, fp, zh }), filter, model, promptVersion });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  if (state.filter) await recordFiltered(ctx, state.filter);
  const assembled = state.assembled!;
  const hiddenOfficial = assembled.counts.official_like + assembled.counts.answer_section + assembled.counts.long_passage;
  if (!assembled.ok) {
    log('assist_ocr_unusable', { op_id: op.id, subject: 'chinese', status: assembled.view.status, blocks: assembled.stats.blocks });
    if (assembled.detected) await markMismatch(ctx, 'ocr', assembled.detected);
    const events = [
      ...(assembled.counts.d8 > 0 ? [{ kind: 'assist_d8_input', detail: { op_id: op.id, subject: 'chinese', blocks: assembled.counts.d8, refunded: true } }] : []),
      ...(hiddenOfficial > 0 ? [{ kind: 'assist_official_like', detail: { op_id: op.id, subject: 'chinese', blocks: hiddenOfficial, where: 'ocr', refunded: true } }] : []),
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
    subject: 'chinese',
    filter_version: FILTER_VERSION,
    d8_fp: fp.version,
    zh_fp: zh.version,
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
      // 照片用完即丟（同英文：轉錄結算時刪除）。
      db
        .prepare(`DELETE FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`)
        .bind(caseRow.id, op.user_id, op.id, token),
      ...(assembled.counts.d8 > 0 ? [opsEventIfSettled(db, op.id, token, 'assist_d8_input', { op_id: op.id, subject: 'chinese', blocks: assembled.counts.d8 })] : []),
      ...(hiddenOfficial > 0 ? [opsEventIfSettled(db, op.id, token, 'assist_official_like', { op_id: op.id, subject: 'chinese', blocks: hiddenOfficial, where: 'ocr' })] : []),
    ],
  });
  log('ai_settled', { op_id: op.id, task: op.task, subject: 'chinese', settled, blocks: assembled.stats.blocks });
  return { kind: 'done' };
}
