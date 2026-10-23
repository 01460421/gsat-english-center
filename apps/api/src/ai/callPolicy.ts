/**
 * Queue consumer 共用的呼叫政策（docs/design/learning-assistant.md §4.8）：寫作批改（consumer.ts）與學習助手
 * （assist/consumer.ts）呼叫 Claude 的方式相同，所以從 consumer.ts 抽出來，行為不變（test/ai.consumer.test.ts 不改、全過）。
 *
 *   callWithPolicy     一次呼叫：stop_reason='max_tokens' 與輸出格式不符各重試一次（時間夠才在這次重試，否則交給 Queue），
 *                      每一次呼叫都寫 ai_calls；成功時交給 onSuccess（回傳字串＝語意檢查不通過，當成格式不符）
 *   actionForFailures  失敗結果 → 處理動作（任何一位不可重試就退還，否則讓 Queue 重送）
 *   recordFiltered     輸出過濾擋下的類別寫進安全事件
 *   LeaseHeld          這次投遞搶到的租約在哪一張表（提交、學習助手的 turn、報告）；預期外的錯誤由外層依表別放掉
 *   contentRefundAlert 內容造成的退還（拒答、格式不符、截斷）同一人 7 天內第 3 次起寫 ops_events 告警（自訂作文題目、學習助手）
 *
 * CallContext 只有呼叫需要的東西（不含提交與題目）；寫作批改的 Ctx 是 CallContext＋提交與題組。
 * 日誌只記 op id、任務、角色、狀態與微美元，不記任何學生文字（ARCHITECTURE §7「紀錄外洩」）。
 */
import type { AiTask } from '@gsat/shared';
import { loadConfig } from '../config';
import type { Env } from '../env';
import { nowSeconds, taiwanDay } from '../time';
import { buildClaudeRequest, callDeadlineMs, createAnthropicClient, executeClaudeCall, ModelNotAllowedError, type ClaudeCallInput } from './client';
import type { OutputFilter } from './filter';
import { opsEvent, recordCall, safetyEventStatement, userRefFor } from './ledger';
import type { CallRole, TaskConfig } from './tasks';

/**
 * 一次 consumer 呼叫的牆鐘預算（Queue consumer 上限 15 分鐘，留 1 分鐘給 D1 與結算）。截斷或格式不符時，
 * 剩下的時間不夠再跑一次完整呼叫，就不在這次裡重試，改讓 Queue 重送（重送時只補這一位）。
 */
export const CONSUMER_WALL_BUDGET_MS = 14 * 60_000;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 測試注入：假的 Anthropic 回應與時間。 */
export interface ConsumerDeps {
  fetch?: FetchLike;
  now?: () => number;
}

/** ai_ops 的一列（consumer 讀到的操作）。 */
export interface OpRow {
  id: string;
  user_id: number | null;
  task: string;
  ref_id: string | null;
  status: 'reserved' | 'settled' | 'refunded';
}

/** 租約所在的表：寫作批改是提交；學習助手的轉錄、解析、追問是 turn，報告是報告。 */
export type LeaseTable = 'submissions' | 'assist_turns' | 'assist_reports';

/** 這次投遞搶到的租約（預期外錯誤時由外層依表別放掉）。 */
export interface LeaseHeld {
  held: { table: LeaseTable; id: string; userId: number; opId: string } | null;
}

/** 三句固定的 SQL（不拼表名）：只放掉還指向這個操作的那一列的租約。 */
const RELEASE_LEASE_SQL: Record<LeaseTable, string> = {
  submissions: 'UPDATE submissions SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3',
  assist_turns: 'UPDATE assist_turns SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3',
  assist_reports: 'UPDATE assist_reports SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3',
};

/** 放掉這次投遞搶到的租約（重送時才不會被自己的租約擋住、白白用掉投遞次數）。 */
export function releaseLeaseStatement(db: D1Database, held: NonNullable<LeaseHeld['held']>): D1PreparedStatement {
  return db.prepare(RELEASE_LEASE_SQL[held.table]).bind(held.id, held.userId, held.opId);
}

/** 一位評分者（或 OCR、學習助手的一次呼叫）的呼叫結果。 */
export type CallResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string; spendLimit?: boolean; configProblem?: boolean; detail?: string | null };

/** 一則訊息處理完要做什麼。 */
export type Action =
  | { kind: 'done' }
  | { kind: 'requeue' }
  | { kind: 'retry'; reason: string; detail?: string | null }
  | { kind: 'refund'; reason: string; spendLimit?: boolean; configProblem?: boolean; detail?: string | null };

/** 呼叫 Claude 需要的東西（不含提交、題目或學習助手的案例）。 */
export interface CallContext {
  env: Env;
  db: D1Database;
  deps: ConsumerDeps;
  now: () => number;
  op: OpRow & { user_id: number; task: AiTask };
  /** 這次投遞開始處理的時間（毫秒）。 */
  startedAt: number;
  tc: TaskConfig;
  userRef: string | null;
  callInput: (role: CallRole) => ClaudeCallInput;
}

export function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/**
 * 呼叫一位評分者（或 OCR）：stop_reason='max_tokens' 與輸出格式不符各重試一次（§6.2 第 4 條、SPEC §8.3）；
 * 每一次呼叫都寫 ai_calls。成功時交給 onSuccess 處理（計分、寫 gradings）；onSuccess 回傳字串＝語意檢查不通過。
 */
export async function callWithPolicy(
  ctx: CallContext,
  input: ClaudeCallInput,
  onSuccess: (data: unknown, callId: number | null, model: string, promptVersion: string) => Promise<string | null>,
): Promise<CallResult> {
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
      ...(outcome.kind === 'error' ? { error_code: outcome.record.errorCode, error_detail: outcome.detail } : {}),
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
        return { ok: false, retryable: outcome.retryable, reason: outcome.reason, spendLimit: outcome.spendLimit, configProblem: outcome.configProblem, detail: outcome.detail };
    }
  }
  return { ok: false, retryable: false, reason: 'internal' };
}

/** 失敗結果 → 處理動作（不可重試優先：任何一位不可重試就退還）。 */
export function actionForFailures(failures: Array<Extract<CallResult, { ok: false }>>): Action {
  const fatal = failures.find((f) => !f.retryable);
  if (fatal) {
    return {
      kind: 'refund',
      reason: fatal.reason,
      ...(fatal.spendLimit ? { spendLimit: true } : {}),
      ...(fatal.configProblem ? { configProblem: true } : {}),
      ...(fatal.detail ? { detail: fatal.detail } : {}),
    };
  }
  const first = failures[0];
  return { kind: 'retry', reason: first?.reason ?? 'api_error', ...(first?.detail ? { detail: first.detail } : {}) };
}

/** 輸出過濾擋下的類別寫進安全事件。 */
export async function recordFiltered(ctx: CallContext, filter: OutputFilter): Promise<void> {
  if (filter.blockedCategories.size === 0) return;
  await ctx.db.batch([...filter.blockedCategories].map((c) => safetyEventStatement(ctx.db, ctx.op.id, 'output_filtered', c, ctx.userRef)));
}

/** 內容造成的退還（拒答、輸出格式不符、截斷）：點數退還、成本照算；自訂題與學生提供的題目比較容易誘發（S12）。 */
export const CONTENT_REFUND_REASONS: ReadonlySet<string> = new Set(['refusal', 'invalid_output', 'max_tokens']);
/** 內容退還的告警（設計值，custom-essay.md §5.3；上線後依實際數字調整）：同一人 7 天內第幾次起告警。 */
export const CONTENT_REFUND_ALERT = { windowSeconds: 7 * 86_400, threshold: 3 } as const;

/**
 * 內容退還的告警（custom-essay.md §5.3 的 S12；learning-assistant.md §4.8 第 8 步沿用）：同一個使用者 7 天內以拒答、格式不符、
 * 截斷退還的次數 ≥3 時寫 ops_events(kind=alertKind, severity='warn', detail={ user_ref, count })；同一人 24 小時內只寫一次。
 * 計數不能依賴學生刪得掉的列（安全審查 security-3）：每次退還先寫一筆 ops_events（kind=mark、detail={ op_id }、acked_at 等於
 * 建立時間，不算進後台的「未處理」），計數時用 op_id 對回 ai_ops 的 user_id。只記假名與次數，不記內容；失敗只寫 log。
 * 從 consumer.ts 的自訂題版本抽出來（行為不變），學習助手用另一組 kind。
 */
export async function contentRefundAlert(
  db: D1Database,
  op: Pick<OpRow, 'id' | 'user_id'>,
  salt: string | null,
  nowMs: number,
  kinds: { mark: string; alertKind: string; label: string },
): Promise<void> {
  if (op.user_id === null) return;
  try {
    const now = nowSeconds(nowMs);
    await db
      .prepare(`INSERT INTO ops_events (kind, severity, detail_json, created_at, acked_at) VALUES (?1, 'info', ?2, ?3, ?3)`)
      .bind(kinds.mark, JSON.stringify({ op_id: op.id }), now)
      .run();
    const row = await db
      .prepare(
        `SELECT COUNT(DISTINCT o.id) AS n FROM ops_events e JOIN ai_ops o ON o.id = json_extract(e.detail_json, '$.op_id')
          WHERE e.kind = ?3 AND e.created_at > ?2 AND o.user_id = ?1 AND o.status = 'refunded'
            AND o.refund_reason IN ('refusal', 'invalid_output', 'max_tokens')`,
      )
      .bind(op.user_id, now - CONTENT_REFUND_ALERT.windowSeconds, kinds.mark)
      .first<{ n: number }>();
    const count = row?.n ?? 0;
    if (count < CONTENT_REFUND_ALERT.threshold) return;
    const ref = await userRefFor(salt, op.user_id);
    const seen = ref
      ? await db
          .prepare(`SELECT 1 AS x FROM ops_events WHERE kind = ?3 AND created_at > ?1 AND json_extract(detail_json, '$.user_ref') = ?2 LIMIT 1`)
          .bind(now - 86_400, ref, kinds.alertKind)
          .first<{ x: number }>()
      : null;
    if (!seen) await opsEvent(db, kinds.alertKind, 'warn', { user_ref: ref, count });
  } catch (err) {
    console.error(`${kinds.label}內容退還的告警失敗（不影響退還）`, op.id, err);
  }
}
