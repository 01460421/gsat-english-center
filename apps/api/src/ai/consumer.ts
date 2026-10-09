/**
 * Queue consumer：同時處理 ai-tasks 與 ai-tasks-dlq（wrangler.toml 的兩個 [[queues.consumers]]）。負責：後端 AI A2。
 *
 * ai-tasks（max_batch_size 1、max_concurrency 5、max_retries 3）照 ARCHITECTURE §3.4 第 5–12 步：
 *   5  讀 ai_ops：已結算或退還 → 直接 ack（重送冪等）
 *   6  條件式 UPDATE 搶 submissions.lease_until（LEASE_SECONDS＝15 分鐘，涵蓋一次 consumer 呼叫的牆鐘預算；
 *      操作必須仍是 reserved——回收卡住的預扣時已退還的不會被搶到）；被別人持有就延後重送，不重複呼叫
 *   7  組提示（src/ai/requests.ts）：伺服器端的系統提示＋評分基準（可快取前綴）＋題目＋<student_text>
 *   8  先查 gradings：已完成的評分者不再呼叫（重送時只補缺的，不會重複付費）
 *   9  第一、第二位平行呼叫 → 每次呼叫寫一列 ai_calls → zod 完整驗證 → 程式計分 → 輸出過濾 → 寫 gradings（UNIQUE(submission_id, role)）
 *   10 差距超過門檻（作文 >5、中譯英 >2）：把同一個 {op_id} 再送進 Queue、ack 目前這則，下一次只補第三位
 *   11 db.batch：結算 ai_ops（settle_token）＋累加 ai_budget_daily＋submissions.status='graded'（OCR 是 'ocr_ready' 並刪照片）
 *   12 可重試的錯誤（429、5xx、逾時）讓 Queue 重送；最後一次仍失敗或不可重試（拒答、截斷重試後仍截斷、輸出格式不符、
 *      設定錯誤）→ 退還點數、成本照記、status='failed'
 * 429 enforced_spend_limit_reached：不重試、立即全站暫停（今天的 ai_budget_daily.paused）並寫 ops_events。
 * 全站暫停時還沒開始的任務（沒有任何 ai_calls）直接退還（SPEC §8.3）；已經開始的讓它完成。
 *
 * ai-tasks-dlq：重試用完的訊息 → 對應操作退還點數、status='failed'、寫 ops_events(severity='error')。
 *   逐則處理：其中一則失敗只重送那一則（不讓整批重試、用完次數後整批丟掉）；真的丟掉了由 housekeeping 6 小時後回收。
 * 每一批訊息處理完之後跑 housekeeping（清過期照片、回收卡住的預扣；src/ai/housekeeping.ts）。
 *
 * 日誌只記 op id、任務、角色、狀態與微美元，不記任何學生文字（ARCHITECTURE §7「紀錄外洩」）。
 * 這支函式由 src/index.ts 的 default export 掛成 queue 入口；不要在 index.ts 加其他具名匯出。
 */
import { AI_TASKS, countEnglishWords, type AiTask, type EssayBody, type PhotoMime, type RaterRole, type TranslationBody } from '@gsat/shared';
import { loadConfig } from '../config';
import type { AiQueueMessage, Env } from '../env';
import { combineGradingRows, findSubmission, loadGradingRows, parseJson, type SubmissionRow } from '../submissions/repo';
import { blobToBytes } from '../submissions/images';
import { nowSeconds, taiwanDay } from '../time';
import { getWritingGroup, type WritingGroup } from './bank';
import { buildClaudeRequest, callDeadlineMs, createAnthropicClient, executeClaudeCall, ModelNotAllowedError, type ClaudeCallInput } from './client';
import { OutputFilter, sanitizeStudentText } from './filter';
import { refundWithSubmission, settleOp, setPausedStatement } from './guard';
import { runHousekeeping } from './housekeeping';
import { opsEvent, opsEventStatement, recordCall, safetyEventStatement, userRefFor } from './ledger';
import { ESSAY_RUBRIC_VERSION, type EssayAnalyticOutput, type EssayHolisticOutput } from './prompts/essay';
import type { OcrModelOutput } from './prompts/ocr';
import { TRANSLATION_RUBRIC_VERSION, type TranslationModelOutput } from './prompts/translation';
import { essayCallInput, ocrCallInput, translationCallInput } from './requests';
import {
  assembleOcr,
  essayScoresProblem,
  needsThirdRater,
  paragraphRanges,
  scoreEssayAnalytic,
  scoreEssayHolistic,
  scoreTranslationRater,
  translationOutputProblem,
  type EssayContext,
} from './scoring';
import { LEASE_SECONDS, QUEUE_MAX_DELIVERIES, taskConfig, type CallRole, type TaskConfig } from './tasks';

/**
 * 一次 consumer 呼叫的牆鐘預算（Queue consumer 上限 15 分鐘，留 1 分鐘給 D1 與結算）。截斷或格式不符時，
 * 剩下的時間不夠再跑一次完整呼叫，就不在這次裡重試，改讓 Queue 重送（重送時只補這一位）。
 */
export const CONSUMER_WALL_BUDGET_MS = 14 * 60_000;

export const AI_TASKS_QUEUE = 'ai-tasks';
export const AI_TASKS_DLQ = 'ai-tasks-dlq';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 測試注入：假的 Anthropic 回應與時間。 */
export interface ConsumerDeps {
  fetch?: FetchLike;
  now?: () => number;
}

/** 這次投遞搶到的租約（預期外錯誤時由外層放掉）。 */
interface LeaseHeld {
  held: { submissionId: string; userId: number; opId: string } | null;
}

interface OpRow {
  id: string;
  user_id: number | null;
  task: string;
  ref_id: string | null;
  status: 'reserved' | 'settled' | 'refunded';
}

/** 一位評分者（或 OCR）的呼叫結果。 */
type CallResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string; spendLimit?: boolean; configProblem?: boolean };

/** 一則訊息處理完要做什麼。 */
type Action =
  | { kind: 'done' }
  | { kind: 'requeue' }
  | { kind: 'retry'; reason: string }
  | { kind: 'refund'; reason: string; spendLimit?: boolean; configProblem?: boolean };

interface Ctx {
  env: Env;
  db: D1Database;
  deps: ConsumerDeps;
  now: () => number;
  op: OpRow & { user_id: number; task: AiTask };
  /** 這次投遞開始處理的時間（毫秒）。 */
  startedAt: number;
  sub: SubmissionRow;
  group: WritingGroup;
  tc: TaskConfig;
  userRef: string | null;
  callInput: (role: CallRole) => ClaudeCallInput;
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

export function createQueueHandler(deps: ConsumerDeps = {}) {
  async function processBatch(batch: MessageBatch<AiQueueMessage>, env: Env): Promise<void> {
    if (batch.queue === AI_TASKS_DLQ) {
      for (const msg of batch.messages) {
        try {
          await handleDeadLetter(env, msg, deps);
        } catch (err) {
          // 只重送這一則（同一批的其他訊息照常 ack）；重試用完被丟掉的，由 housekeeping 6 小時後回收。
          console.error('死信佇列處理失敗，稍後重送', msg.body?.op_id, err);
          msg.retry({ delaySeconds: 60 });
        }
      }
      return;
    }
    for (const msg of batch.messages) {
      const lease: LeaseHeld = { held: null };
      try {
        await handleMessage(env, msg, deps, lease);
      } catch (err) {
        // 預期外的錯誤（例如 D1 暫時失敗）：讓 Queue 重送；用完次數後進死信佇列，由 DLQ 退還。
        // 這次搶到的租約先放掉，重送時才不會被自己的租約擋住、白白用掉投遞次數。
        console.error('AI 任務處理失敗（預期外）', msg.body?.op_id, err);
        if (lease.held) {
          const h = lease.held;
          await env.DB.prepare('UPDATE submissions SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3')
            .bind(h.submissionId, h.userId, h.opId)
            .run()
            .catch(() => undefined);
        }
        msg.retry({ delaySeconds: 30 });
      }
    }
  }

  return async function queueHandler(batch: MessageBatch<AiQueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    void ctx;
    await processBatch(batch, env);
    // 處理完這一批之後順手清過期照片、回收卡住的預扣（不在處理之前跑：還來得及處理的任務不要先被回收）。
    // runHousekeeping 自己吞掉錯誤，不影響這一批的 ack／retry。
    await runHousekeeping(env.DB, (deps.now ?? Date.now)());
  };
}

export const handleQueue = createQueueHandler();

async function loadOp(db: D1Database, opId: string): Promise<OpRow | null> {
  return db.prepare('SELECT id, user_id, task, ref_id, status FROM ai_ops WHERE id = ?1').bind(opId).first<OpRow>();
}

async function handleDeadLetter(env: Env, msg: Message<AiQueueMessage>, deps: ConsumerDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const opId = msg.body?.op_id;
  if (typeof opId === 'string') {
    const op = await loadOp(env.DB, opId);
    if (op && op.status === 'reserved') {
      const refunded = await refundWithSubmission(env.DB, op, 'api_error', now());
      if (refunded) {
        await opsEvent(env.DB, 'ai_dlq', 'error', { op_id: op.id, task: op.task, attempts: msg.attempts });
        log('ai_dlq_refund', { op_id: op.id, task: op.task });
      }
    }
  }
  msg.ack();
}

async function handleMessage(env: Env, msg: Message<AiQueueMessage>, deps: ConsumerDeps, lease: LeaseHeld): Promise<void> {
  const db = env.DB;
  const now = deps.now ?? Date.now;
  const opId = msg.body?.op_id;
  if (typeof opId !== 'string') {
    msg.ack();
    return;
  }
  const startedAt = now();
  const op = await loadOp(db, opId);
  // 第 5 步：已結算或退還（或根本沒有這筆）→ ack。
  if (!op || op.status !== 'reserved') {
    msg.ack();
    return;
  }
  const config = loadConfig(env);
  const fail = async (reason: string) => {
    await refundWithSubmission(db, op, reason, now());
    log('ai_refund', { op_id: op.id, task: op.task, reason });
    msg.ack();
  };
  if (op.user_id === null || op.ref_id === null || !(AI_TASKS as readonly string[]).includes(op.task)) return fail('internal');
  const sub = await findSubmission(db, op.user_id, op.ref_id);
  const group = sub ? getWritingGroup(sub.group_id) : null;
  if (!sub || sub.op_id !== op.id || !group) return fail('internal');
  if (!config.ai.apiKey) {
    await opsEvent(db, 'ai_not_configured', 'error', { op_id: op.id });
    return fail('internal');
  }

  // 第 6 步：條件式搶租約。
  const nowS = nowSeconds(now());
  const leased = await db
    .prepare(
      `UPDATE submissions SET lease_until = ?1, tries = MIN(tries + 1, 5), updated_at = ?2,
              status = CASE WHEN status = 'queued' THEN 'grading' ELSE status END
        WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'grading', 'ocr_queued')
          AND (lease_until IS NULL OR lease_until <= ?2)
          AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND status = 'reserved')`,
    )
    .bind(nowS + LEASE_SECONDS, nowS, sub.id, sub.user_id, op.id)
    .run();
  if (leased.meta.changes !== 1) {
    const cur = await db.prepare('SELECT status, lease_until FROM submissions WHERE id = ?1 AND user_id = ?2').bind(sub.id, sub.user_id).first<{ status: string; lease_until: number | null }>();
    if (!cur || !['queued', 'grading', 'ocr_queued'].includes(cur.status)) {
      // 操作還沒結算、提交卻已不在進行中（被刪除或狀態不一致）：退還，不讓預扣卡住。
      return fail('internal');
    }
    const latest = await loadOp(db, op.id);
    if (!latest || latest.status !== 'reserved') {
      // 剛剛被回收（housekeeping 退還）了：不處理。
      msg.ack();
      return;
    }
    // 另一個 consumer 正在處理：等租約到期再看（不重複呼叫 Claude）。
    const wait = Math.min(LEASE_SECONDS, Math.max(30, (cur.lease_until ?? nowS) - nowS + 5));
    msg.retry({ delaySeconds: wait });
    return;
  }
  lease.held = { submissionId: sub.id, userId: sub.user_id, opId: op.id };

  // 全站暫停：還沒開始（沒有任何 ai_calls）的任務直接退還。
  const started = await db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?1').bind(op.id).first<{ n: number }>();
  if ((started?.n ?? 0) === 0) {
    const paused = await db.prepare('SELECT paused FROM ai_budget_daily WHERE tw_day = ?1').bind(taiwanDay(now())).first<{ paused: number }>();
    if (paused?.paused === 1) return fail('paused');
  }

  const task = op.task as AiTask;
  const tc = taskConfig(task, config);
  const ctx: Ctx = {
    env,
    db,
    deps,
    now,
    op: { ...op, user_id: op.user_id, task },
    startedAt,
    sub,
    group,
    tc,
    userRef: await userRefFor(config.auth.ledgerSalt, op.user_id),
    callInput: () => {
      throw new Error('callInput 尚未設定');
    },
  };

  let action: Action;
  if (task === 'essay_ocr') action = await runOcr(ctx);
  else action = await runGrading(ctx);

  const releaseLease = () =>
    db.prepare('UPDATE submissions SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(sub.id, sub.user_id, op.id).run();

  switch (action.kind) {
    case 'done':
      msg.ack();
      return;
    case 'requeue':
      // 第 10 步：同一個 op 再送一次，下一次呼叫只補第三位。
      await releaseLease();
      if (!env.AI_QUEUE) {
        // 沒有 producer 綁定（不應發生）：改用這則訊息本身重送，下一次一樣只補第三位。
        msg.retry({ delaySeconds: 0 });
        return;
      }
      try {
        await env.AI_QUEUE.send({ op_id: op.id });
        log('ai_requeue_third', { op_id: op.id, task });
        msg.ack();
      } catch (err) {
        console.error('第三位評分者重新排入 Queue 失敗，稍後重送', op.id, err);
        msg.retry({ delaySeconds: 30 });
      }
      return;
    case 'retry':
      if (msg.attempts < QUEUE_MAX_DELIVERIES) {
        await releaseLease();
        log('ai_retry', { op_id: op.id, task, reason: action.reason, attempts: msg.attempts });
        msg.retry({ delaySeconds: 30 * msg.attempts });
        return;
      }
      return fail(action.reason);
    case 'refund':
      if (action.spendLimit) {
        await db.batch([
          setPausedStatement(db, true, now()),
          opsEventStatement(db, 'anthropic_spend_limit', 'error', { op_id: op.id, task, note: '429 enforced_spend_limit_reached：全站已暫停' }),
        ]);
      } else if (action.configProblem) {
        await opsEvent(db, 'anthropic_config', 'error', { op_id: op.id, task, reason: action.reason });
      }
      return fail(action.reason);
  }
}

/**
 * 呼叫一位評分者（或 OCR）：stop_reason='max_tokens' 與輸出格式不符各重試一次（§6.2 第 4 條、SPEC §8.3）；
 * 每一次呼叫都寫 ai_calls。成功時交給 onSuccess 處理（計分、寫 gradings）；onSuccess 回傳字串＝語意檢查不通過。
 */
async function callWithPolicy(ctx: Ctx, input: ClaudeCallInput, onSuccess: (data: unknown, callId: number | null, model: string, promptVersion: string) => Promise<string | null>): Promise<CallResult> {
  let built;
  try {
    built = await buildClaudeRequest(input);
  } catch (err) {
    if (err instanceof ModelNotAllowedError) return { ok: false, retryable: false, reason: 'internal', configProblem: true };
    throw err;
  }
  const config = loadConfig(ctx.env);
  const client = createAnthropicClient({ apiKey: config.ai.apiKey ?? '', baseURL: config.ai.baseUrl, ...(ctx.deps.fetch ? { fetchImpl: ctx.deps.fetch } : {}) });
  const day = taiwanDay(ctx.now());
  /** 同一次呼叫裡還來得及再跑一次完整呼叫嗎（否則交給 Queue 重送）。 */
  const canRetryHere = () => ctx.now() - ctx.startedAt + callDeadlineMs(input) <= CONSUMER_WALL_BUDGET_MS;
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await executeClaudeCall(client, input, built, ctx.now);
    const callId = await recordCall(ctx.db, ctx.op.id, outcome.record, ctx.userRef, day);
    log('ai_call', {
      op_id: ctx.op.id,
      task: ctx.op.task,
      role: input.spec.role,
      outcome: outcome.kind,
      stop_reason: outcome.record.stopReason,
      cost_micros: outcome.record.costMicros,
      latency_ms: outcome.record.latencyMs,
    });
    if (outcome.record.pricePending) {
      await opsEvent(ctx.db, 'price_pending', 'warn', { op_id: ctx.op.id, served_model: outcome.record.servedModel });
    }
    switch (outcome.kind) {
      case 'ok': {
        const problem = await onSuccess(outcome.data, callId, outcome.record.servedModel ?? input.spec.model, built.promptVersion);
        if (problem === null) return { ok: true };
        log('ai_invalid_output', { op_id: ctx.op.id, role: input.spec.role, attempt });
        if (attempt === 0) {
          if (canRetryHere()) continue;
          return { ok: false, retryable: true, reason: 'invalid_output' };
        }
        return { ok: false, retryable: false, reason: 'invalid_output' };
      }
      case 'invalid':
        log('ai_invalid_output', { op_id: ctx.op.id, role: input.spec.role, attempt });
        if (attempt === 0) {
          if (canRetryHere()) continue;
          return { ok: false, retryable: true, reason: 'invalid_output' };
        }
        return { ok: false, retryable: false, reason: 'invalid_output' };
      case 'max_tokens':
        if (attempt === 0) {
          if (canRetryHere()) continue;
          return { ok: false, retryable: true, reason: 'max_tokens' };
        }
        return { ok: false, retryable: false, reason: 'max_tokens' };
      case 'refusal':
        await safetyEventStatement(ctx.db, ctx.op.id, 'refusal', outcome.category, ctx.userRef).run();
        return { ok: false, retryable: false, reason: 'refusal' };
      case 'error':
        return { ok: false, retryable: outcome.retryable, reason: outcome.reason, spendLimit: outcome.spendLimit, configProblem: outcome.configProblem };
    }
  }
  return { ok: false, retryable: false, reason: 'internal' };
}

/** 失敗結果 → 處理動作（不可重試優先：任何一位不可重試就退還）。 */
function actionForFailures(failures: Array<Extract<CallResult, { ok: false }>>): Action {
  const fatal = failures.find((f) => !f.retryable);
  if (fatal) return { kind: 'refund', reason: fatal.reason, ...(fatal.spendLimit ? { spendLimit: true } : {}), ...(fatal.configProblem ? { configProblem: true } : {}) };
  return { kind: 'retry', reason: failures[0]?.reason ?? 'api_error' };
}

/** 輸出過濾擋下的類別寫進安全事件。 */
async function recordFiltered(ctx: Ctx, filter: OutputFilter): Promise<void> {
  if (filter.blockedCategories.size === 0) return;
  await ctx.db.batch([...filter.blockedCategories].map((c) => safetyEventStatement(ctx.db, ctx.op.id, 'output_filtered', c, ctx.userRef)));
}

async function writeGrading(
  ctx: Ctx,
  role: RaterRole,
  fields: { model: string; promptVersion: string; rubric: string; judgments: unknown; score: number; deductions: unknown; feedback: unknown; callId: number | null },
): Promise<void> {
  await ctx.db
    .prepare(
      `INSERT OR IGNORE INTO gradings
         (id, submission_id, user_id, role, model, prompt_version, rubric_version, judgments_json, program_score, deductions_json, feedback_json, call_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      crypto.randomUUID(),
      ctx.sub.id,
      ctx.sub.user_id,
      role,
      fields.model,
      fields.promptVersion,
      fields.rubric,
      JSON.stringify(fields.judgments),
      fields.score,
      fields.deductions === null ? null : JSON.stringify(fields.deductions),
      JSON.stringify(fields.feedback),
      fields.callId,
    )
    .run();
}

// ───────────────────────── 批改（中譯英、作文） ─────────────────────────

async function runGrading(ctx: Ctx): Promise<Action> {
  const { sub, group, tc } = ctx;
  const kind = sub.kind === 'translation' ? 'translation' : 'essay';
  const meta: Record<string, unknown> = {};

  // 再淨化一次（DB 裡的文字在送出批改時已經淨化過，這裡是第二道保險）。
  let rater: (role: RaterRole, data: unknown, filter: OutputFilter) => { judgments: unknown; score: number; deductions: unknown; feedback: unknown } | string;
  if (kind === 'translation') {
    const body = parseJson<TranslationBody>(sub.body_json);
    const sentences = group.items.map((item) => sanitizeStudentText(body?.items.find((i) => i.item_id === item.item_id)?.text ?? '').text);
    if (sentences.some((s) => s.trim() === '')) return { kind: 'refund', reason: 'internal' };
    ctx.callInput = (role) => translationCallInput(tc, role, group, sentences);
    rater = (role, data, filter) => {
      const output = data as TranslationModelOutput;
      const problem = translationOutputProblem(output, sentences.length);
      if (problem) return problem;
      const r = scoreTranslationRater(role, sentences, output, filter);
      return {
        judgments: { v: 1, kind, result: r.result, errors: r.errors, meta },
        score: r.result.score,
        deductions: r.result.sentences.map((s) => ({ sentence_index: s.sentence_index, mechanics: s.mechanics_deduction })),
        feedback: { corrected: r.corrected, explanation_zh: r.explanation_zh },
      };
    };
  } else {
    const body = parseJson<EssayBody>(sub.body_json);
    const sanitized = sanitizeStudentText(body?.text ?? '');
    meta['invisible_removed'] = sanitized.invisibleRemoved;
    const text = sanitized.text;
    if (text.trim() === '') return { kind: 'refund', reason: 'internal' };
    const photoMode = sub.input_mode === 'photo';
    const ranges = paragraphRanges(text, photoMode);
    const essayCtx: EssayContext = {
      text,
      wordCount: countEnglishWords(text),
      paragraphs: ranges.length,
      requiredParagraphs: group.essay?.paragraphs ?? null,
      photoMode,
    };
    const paragraphs = ranges.map((r) => text.slice(r.start, r.end).trim());
    ctx.callInput = (role) => essayCallInput(tc, role, group, paragraphs, essayCtx.wordCount);
    rater = (role, data, filter) => {
      const framework = tc.calls.find((c) => c.role === role)?.framework ?? 'analytic';
      const record =
        framework === 'analytic'
          ? (() => {
              const o = data as EssayAnalyticOutput;
              const scores = { content: o.criteria.content.score, organization: o.criteria.organization.score, grammar: o.criteria.grammar.score, vocabulary: o.criteria.vocabulary.score };
              const problem = essayScoresProblem(scores);
              return problem ?? scoreEssayAnalytic(role, essayCtx, o, filter);
            })()
          : (() => {
              const o = data as EssayHolisticOutput;
              const problem = essayScoresProblem(o.scores);
              return problem ?? scoreEssayHolistic(role, essayCtx, o, filter);
            })();
      if (typeof record === 'string') return record;
      return {
        judgments: { v: 1, kind, result: record.result, errors: record.errors, meta },
        score: record.result.total,
        deductions: record.deductions,
        feedback: {
          criteria_explanations: record.criteria_explanations,
          top_improvements: record.top_improvements,
          paragraph_advice: record.paragraph_advice,
          rewrite: record.rewrite,
          safety_flag: record.safety_flag,
        },
      };
    };
  }

  const runRater = (role: RaterRole) =>
    callWithPolicy(ctx, ctx.callInput(role), async (data, callId, model, promptVersion) => {
      const filter = new OutputFilter();
      const r = rater(role, data, filter);
      if (typeof r === 'string') return r;
      await writeGrading(ctx, role, { ...r, model, promptVersion, rubric: kind === 'translation' ? TRANSLATION_RUBRIC_VERSION : ESSAY_RUBRIC_VERSION, callId });
      await recordFiltered(ctx, filter);
      return null;
    });

  // 第 8 步：已完成的評分者不再呼叫。
  const scoresOf = async () => {
    const rows = await ctx.db
      .prepare(`SELECT role, program_score FROM gradings WHERE submission_id = ?1 AND user_id = ?2 AND role IN ('primary','second','third')`)
      .bind(sub.id, sub.user_id)
      .all<{ role: RaterRole; program_score: number }>();
    return new Map(rows.results.map((r) => [r.role, r.program_score]));
  };
  let have = await scoresOf();
  const missing = (['primary', 'second'] as const).filter((r) => !have.has(r));
  if (missing.length > 0) {
    // 第 9 步：第一、第二位平行呼叫。
    const results = await Promise.all(missing.map((r) => runRater(r)));
    const failures = results.filter((r): r is Extract<CallResult, { ok: false }> => !r.ok);
    if (failures.length > 0) return actionForFailures(failures);
    have = await scoresOf();
    const a = have.get('primary');
    const b = have.get('second');
    if (a === undefined || b === undefined) return { kind: 'retry', reason: 'internal' };
    // 第 10 步：差距過大 → 下一次呼叫補第三位。
    if (needsThirdRater(kind, a, b) && !have.has('third')) return { kind: 'requeue' };
  } else {
    const a = have.get('primary')!;
    const b = have.get('second')!;
    if (needsThirdRater(kind, a, b) && !have.has('third')) {
      const third = await runRater('third');
      if (!third.ok) return actionForFailures([third]);
    }
  }
  return finalizeGrading(ctx, kind);
}

async function finalizeGrading(ctx: Ctx, kind: 'translation' | 'essay'): Promise<Action> {
  const { db, sub, op } = ctx;
  const rows = await loadGradingRows(db, sub.user_id, sub.id);
  const body = kind === 'essay' ? parseJson<EssayBody>(sub.body_json) : null;
  const text = body ? sanitizeStudentText(body.text).text : '';
  const wordCount = kind === 'essay' ? countEnglishWords(text) : 0;
  const paragraphs = kind === 'essay' ? paragraphRanges(text, sub.input_mode === 'photo').length : 0;
  const result = combineGradingRows(kind, rows, { wordCount, paragraphs });
  const finalBand = result.kind === 'essay' ? result.band : null;
  const safetyFlag = result.kind === 'essay' ? result.safety_flag : null;
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => {
      const statements = [
        db
          .prepare(
            `UPDATE submissions SET status = 'graded', final_score = ?1, final_band = ?2, graded_at = ?3, lease_until = NULL,
                    safety_flag = COALESCE(?4, safety_flag), updated_at = ?3
              WHERE id = ?5 AND user_id = ?6 AND op_id = ?7 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?7 AND settle_token = ?8)`,
          )
          .bind(result.final_score, finalBand, now, safetyFlag, sub.id, sub.user_id, op.id, token),
      ];
      if (safetyFlag) {
        statements.push(
          db
            .prepare(
              `INSERT INTO ai_safety_events (op_id, kind, category, user_ref)
               SELECT ?1, 'wellbeing_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?1 AND settle_token = ?4)`,
            )
            .bind(op.id, safetyFlag, ctx.userRef, token),
        );
      }
      return statements;
    },
  });
  log('ai_settled', { op_id: op.id, task: op.task, settled, third: result.third_rater_used });
  return { kind: 'done' };
}

// ───────────────────────── OCR ─────────────────────────

async function runOcr(ctx: Ctx): Promise<Action> {
  const { db, sub, group, tc, op } = ctx;
  const photos = await db
    .prepare('SELECT ord, mime, data FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2 AND expires_at >= ?3 ORDER BY ord')
    .bind(sub.id, sub.user_id, nowSeconds(ctx.now()))
    .all<{ ord: number; mime: PhotoMime; data: unknown }>();
  // 照片已經過期（最長 24 小時；還沒被清掉的也不用）：沒辦法辨識，退還。
  if (photos.results.length === 0) return { kind: 'refund', reason: 'expired' };
  const input = ocrCallInput(
    tc,
    group,
    photos.results.map((p) => ({ mime: p.mime, bytes: blobToBytes(p.data) })),
  );
  const state: { assembled: ReturnType<typeof assembleOcr> | null; filter: OutputFilter | null } = { assembled: null, filter: null };
  const result = await callWithPolicy(ctx, input, async (data) => {
    const output = data as OcrModelOutput;
    // 候選字經過輸出過濾（ARCHITECTURE §8.5）；轉錄本文是學生自己的文字，只剝 HTML 標籤（設計文件 §10）。
    const filter = new OutputFilter();
    const a = assembleOcr(output, filter);
    state.filter = filter;
    // 看不出是手寫英文作文（readable=false 或沒有任何文字）：不算格式錯誤、不重試，下面退還
    // （算進每日退還上限，guard.ts 的 AI_REFUNDS_PER_DAY；設計文件 §10「A2 修正（第二輪審查）」）。
    if (output.readable && a.result.text.trim() !== '') state.assembled = a;
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  if (!state.assembled) return { kind: 'refund', reason: 'invalid_output' };
  const ocr = state.assembled.result;
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE submissions SET status = 'ocr_ready', ocr_text = ?1, ocr_uncertain_json = ?2, ocr_diff_json = NULL,
                  lease_until = NULL, updated_at = ?3
            WHERE id = ?4 AND user_id = ?5 AND op_id = ?6 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?6 AND settle_token = ?7)`,
        )
        .bind(ocr.text.slice(0, 12_000), JSON.stringify(ocr.uncertain.filter((u) => u.end <= 12_000)), now, sub.id, sub.user_id, op.id, token),
      // 照片用完即丟（設計文件 §4）。
      db
        .prepare(
          `DELETE FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2
             AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`,
        )
        .bind(sub.id, sub.user_id, op.id, token),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  log('ai_settled', { op_id: op.id, task: op.task });
  return { kind: 'done' };
}
