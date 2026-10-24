/**
 * 作文範文的 Queue consumer（docs/design/model-essays.md §7.4 第 2 點、§3.5、§3.6）。src/ai/consumer.ts 的 handleMessage 讀到操作、
 * 確認還是 reserved 之後，作文範文的任務（essay_exemplars）交給這裡，不走提交。
 *
 * 步驟（同學習助手 assist/consumer.ts，對象換成 exemplar_sets 的一列）：
 *   1. 讀列（id＝ref_id、user_id、op_id）；讀不到（帳號刪除的 CASCADE）→ 以 internal 退還、ack。
 *   2. 條件式搶租約（操作必須仍是 reserved：回收卡住的預扣時已退還的搶不到）；搶到後 lease.held 設成 exemplar_sets，
 *      預期外的錯誤由外層放掉租約。搶不到就延後重送或 ack（同寫作批改）。
 *   3. 全站暫停而且還沒有任何 ai_calls → 退還 paused。
 *   4. D8 指紋讀不到 → 退還 internal。
 *   5. 組請求（requests.ts；網站題目讀題目庫，讀不到或不在白名單就退還 internal；自訂題讀 prompt_json）。
 *   6. 這個操作已有的內容失敗次數（attempts.ts，跨 Queue 投遞累計）：還能付費產生 0 次就直接退還；1 次就傳 contentAttempts: 1
 *      （這次的內容失敗直接退還）。一個操作最多付費產生 2 次內容失敗的結果（§3.6）。
 *   7. callWithPolicy → onSuccess：後處理（output.ts）與組列（repo.ts 的 exemplarDoneRow，先檢查遷移 0005 的 CHECK）；
 *      語意檢查不通過時先把 content_failures 加 1 再回傳字串（截斷與格式不符記在 ai_calls，不必另外加）。
 *      自訂題不是寫作題：不重試，以 invalid_output 退還、meta_json.not_writing_task＝true。
 *      身心安全旗標（safety_flag 不是 none）在 onSuccess 當下就記，不等結算（§1.11）：列的 safety_flag 改成這個操作看過最嚴重的
 *      類別、寫一筆 wellbeing_flag 安全事件（同一個操作、同一個類別只寫一次）。所以不管後來是結算、不是寫作題的退還、內容失敗
 *      用完的退還，還是回收與死信，學生都看得到求助資源（詳情的 safety_flag），監控表也有事件。
 *   8. 結算：settleOp 的附帶語句都以 settle_token 為條件（同一則訊息送兩次只結算一次）：列改 done、寫 output_json、prompt_version、
 *      served_model、meta_json、d8_hidden、safety_flag、放掉租約、保存期限重算；exemplar_d8_output、exemplar_task_copy 在同一個
 *      batch。過濾擋下的類別寫安全事件（output_filtered）。
 *   9. 共用快取（cache.ts）：只有網站題目、不是重新產生、不是 tainted、這個操作的每一次產生 safety_flag 都是 none、實際服務的模型＝請求的模型；
 *      真的寫入或取代（changes = 1）才把 cache_key、cache_gen 記到這一列。不在交易裡：失敗只記 log。
 *  10. 失敗：可重試的交給 Queue 重送（最多 4 次投遞）；不可重試或用完 → refundWithExemplarSet（列改 failed、寫退還原因、放掉租約）。
 *      內容造成的退還（拒答、格式不符、截斷）同一人 7 天內第 3 次起寫 ops 事件 exemplar_content_refunds。
 * 日誌只記 op id、任務、狀態、代碼與數字，不記題目或範文。
 */
import { CUSTOM_PROMPT_RULES_VERSION, EXEMPLAR_LEVELS_VERSION, isExemplarTask, type AiTask } from '@gsat/shared';
import type { AiQueueMessage, Env } from '../env';
import {
  actionForFailures,
  callWithPolicy,
  CONTENT_REFUND_REASONS,
  contentRefundAlert,
  log,
  recordFiltered,
  type Action,
  type CallContext,
  type ConsumerDeps,
  type LeaseHeld,
  type OpRow,
} from '../ai/callPolicy';
import { requireD8Fingerprints } from '../ai/d8';
import { FILTER_VERSION, OutputFilter } from '../ai/filter';
import { settleOp, setPausedStatement } from '../ai/guard';
import { opsEvent, opsEventStatement, userRefFor } from '../ai/ledger';
import { EXEMPLAR_CUSTOM_TEMPLATE_VERSION, EXEMPLAR_SITE_TEMPLATE_VERSION } from '../ai/prompts/exemplars';
import { LEASE_SECONDS, QUEUE_MAX_DELIVERIES, taskConfig } from '../ai/tasks';
import { loadConfig } from '../config';
import { nowSeconds, taiwanDay } from '../time';
import { bumpContentFailureStatement, exemplarContentFailures, remainingContentAttempts } from './attempts';
import { exemplarCacheKey, EXEMPLAR_CACHE_MAX_CHARS, writeExemplarCache } from './cache';
import { postprocessExemplars, type ExemplarPostprocessed } from './output';
import { refundWithExemplarSet, EXEMPLAR_RETENTION_SECONDS } from './refund';
import { buildExemplarMeta, EXEMPLAR_COLUMNS, exemplarDoneRow, type ExemplarMetaInput, type ExemplarSetRow } from './repo';
import { exemplarCallInput, requestParagraphs, requestTargets, requestTaskTexts, type ExemplarCustomPrompt, type ExemplarRequest } from './requests';
import type { ExemplarOutput } from './schema';
import { exemplarSiteGroup, siteSourceOf } from './siteGroups';

/** 作文範文內容退還的計數與告警（ops_events 的 kind）。 */
export const EXEMPLAR_CONTENT_REFUND_MARK = 'exemplar_content_refund';
export const EXEMPLAR_CONTENT_REFUND_ALERT = 'exemplar_content_refunds';

const LEASE_SQL = `UPDATE exemplar_sets SET lease_until = ?1, tries = MIN(tries + 1, 5), status = 'running', updated_at = ?2
                    WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'running')
                      AND (lease_until IS NULL OR lease_until <= ?2)
                      AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND status = 'reserved')`;

/** 列 → 這次的題目（網站題目讀題目庫、自訂題讀 prompt_json）；讀不到、不在白名單或壞掉時 null。 */
export function requestOfRow(row: Pick<ExemplarSetRow, 'source' | 'group_id' | 'prompt_json'>): ExemplarRequest | null {
  if (row.source === 'custom') {
    try {
      const p = JSON.parse(row.prompt_json ?? 'null') as Partial<ExemplarCustomPrompt> | null;
      if (!p || typeof p.text !== 'string' || p.text.trim() === '') return null;
      const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
      return {
        source: 'custom',
        prompt: { text: p.text, figure_text: typeof p.figure_text === 'string' ? p.figure_text : null, paragraphs: int(p.paragraphs), min_words: int(p.min_words), max_words: int(p.max_words) },
      };
    } catch {
      return null;
    }
  }
  if (row.group_id === null) return null;
  const g = exemplarSiteGroup(row.group_id);
  if (typeof g === 'string') return null;
  const source = siteSourceOf(g);
  return source === row.source ? { source, group: g } : null;
}

/** meta_json 的版本欄位。 */
export function exemplarVersions(req: ExemplarRequest, d8Version: string): ExemplarMetaInput['versions'] {
  const custom = req.source === 'custom';
  return {
    levels: EXEMPLAR_LEVELS_VERSION,
    filter_version: FILTER_VERSION,
    d8_fp: d8Version,
    template: custom ? EXEMPLAR_CUSTOM_TEMPLATE_VERSION : EXEMPLAR_SITE_TEMPLATE_VERSION,
    ...(custom ? { custom_rules: CUSTOM_PROMPT_RULES_VERSION } : {}),
  };
}

/** 後處理結果 → meta（版本、計數、明細）。 */
export function exemplarMetaOf(req: ExemplarRequest, d8Version: string, post: ExemplarPostprocessed, fields: Record<string, unknown> = {}): ExemplarMetaInput {
  return {
    versions: exemplarVersions(req, d8Version),
    fields,
    counts: { ...post.counts },
    details: { ...post.details, hidden: Object.fromEntries(post.hidden.map((h) => [h.level, h.reason])) },
  };
}

type SafetyFlag = ExemplarOutput['safety_flag'];

/** 身心安全旗標的嚴重程度：同一個操作看到好幾個（第二次產生、跨投遞）時留最嚴重的。 */
const SAFETY_RANK: Record<SafetyFlag, number> = { none: 0, other: 1, abuse_disclosure: 2, self_harm_risk: 3 };

export function worseSafety(a: SafetyFlag, b: SafetyFlag): SafetyFlag {
  return SAFETY_RANK[b] > SAFETY_RANK[a] ? b : a;
}

/** 列上已經記下的旗標（之前的投遞記的）；沒有或認不得時 none。 */
function rowSafety(v: string | null): SafetyFlag {
  return v !== null && Object.hasOwn(SAFETY_RANK, v) ? (v as SafetyFlag) : 'none';
}

/** ops 事件（只在這次結算成功時寫：以 settle_token 為條件）。 */
function opsEventIfSettled(db: D1Database, opId: string, token: string, kind: string, detail: Record<string, unknown>): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT ?1, 'warn', ?2 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`)
    .bind(kind, JSON.stringify(detail).slice(0, 4000), opId, token);
}

export async function handleExemplarMessage(env: Env, msg: Message<AiQueueMessage>, deps: ConsumerDeps, lease: LeaseHeld, op: OpRow): Promise<void> {
  const db = env.DB;
  const now = deps.now ?? Date.now;
  const config = loadConfig(env);
  const fail = async (reason: string, metaJson?: string) => {
    const refunded = await refundWithExemplarSet(db, op, reason, now(), metaJson ? { metaJson } : {});
    log('ai_refund', { op_id: op.id, task: op.task, reason });
    if (refunded && CONTENT_REFUND_REASONS.has(reason)) {
      await contentRefundAlert(db, op, config.auth.ledgerSalt, now(), { mark: EXEMPLAR_CONTENT_REFUND_MARK, alertKind: EXEMPLAR_CONTENT_REFUND_ALERT, label: '作文範文' });
    }
    msg.ack();
  };
  if (!isExemplarTask(op.task) || op.user_id === null || op.ref_id === null) return fail('internal');
  const userId = op.user_id;
  const setId = op.ref_id;
  const startedAt = now();

  // 第 1 步：讀列。
  const row = await db.prepare(`SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets WHERE id = ?1 AND user_id = ?2 AND op_id = ?3`).bind(setId, userId, op.id).first<ExemplarSetRow>();
  if (!row) return fail('internal');

  // 第 2 步：條件式搶租約。
  const nowS = nowSeconds(now());
  const leased = await db.prepare(LEASE_SQL).bind(nowS + LEASE_SECONDS, nowS, setId, userId, op.id).run();
  if (leased.meta.changes !== 1) {
    const cur = await db.prepare('SELECT status, lease_until FROM exemplar_sets WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(setId, userId, op.id).first<{ status: string; lease_until: number | null }>();
    if (!cur || (cur.status !== 'queued' && cur.status !== 'running')) return fail('internal');
    const latest = await db.prepare('SELECT status FROM ai_ops WHERE id = ?1').bind(op.id).first<{ status: string }>();
    if (!latest || latest.status !== 'reserved') {
      // 剛剛被回收（housekeeping 退還）了：不處理。
      msg.ack();
      return;
    }
    // 另一個 consumer 正在處理：等租約到期再看（不重複呼叫模型）。
    const wait = Math.min(LEASE_SECONDS, Math.max(30, (cur.lease_until ?? nowS) - nowS + 5));
    msg.retry({ delaySeconds: wait });
    return;
  }
  lease.held = { table: 'exemplar_sets', id: setId, userId, opId: op.id };
  const releaseLease = () => db.prepare('UPDATE exemplar_sets SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(setId, userId, op.id).run();

  if (!config.ai.apiKey) {
    await opsEvent(db, 'ai_not_configured', 'error', { op_id: op.id });
    return fail('internal');
  }

  // 第 3 步：全站暫停時，還沒開始（沒有任何 ai_calls）的任務直接退還。
  const started = await db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE op_id = ?1').bind(op.id).first<{ n: number }>();
  if ((started?.n ?? 0) === 0) {
    const paused = await db.prepare('SELECT paused FROM ai_budget_daily WHERE tw_day = ?1').bind(taiwanDay(now())).first<{ paused: number }>();
    if (paused?.paused === 1) return fail('paused');
  }

  // 第 4 步：D8 指紋（輸出比對要用；壞掉就不處理）。
  const fp = await requireD8Fingerprints(db);
  if (!fp) return fail('internal');

  // 第 5 步：題目（網站題目讀題目庫：Worker 回滾等讀不到時退還 internal）。
  const req = requestOfRow(row);
  if (!req) {
    log('exemplar_task_unavailable', { op_id: op.id, source: row.source });
    return fail('internal');
  }

  // 第 6 步：這個操作已有的內容失敗次數（跨投遞）。
  const ref = { opId: op.id, setId, userId };
  const remaining = remainingContentAttempts(await exemplarContentFailures(db, ref));
  if (remaining === 0) return fail('invalid_output');

  const tc = taskConfig('essay_exemplars', config);
  const input = exemplarCallInput(tc, req);
  const ctx: CallContext = {
    env,
    db,
    deps,
    now,
    op: { ...op, user_id: userId, task: op.task as AiTask },
    startedAt,
    tc,
    userRef: await userRefFor(config.auth.ledgerSalt, userId),
    callInput: () => input,
  };
  const postCtx = { source: req.source, targets: requestTargets(req), paragraphs: requestParagraphs(req), taskTexts: requestTaskTexts(req), fp };
  const state: {
    post: ExemplarPostprocessed | null;
    filter: OutputFilter | null;
    model: string;
    promptVersion: string;
    outputJson: string;
    metaJson: string;
    notWriting: boolean;
    lastProblem: string | null;
    /** 這個操作看過最嚴重的身心安全旗標（含之前的投遞記在列上的）。 */
    safety: SafetyFlag;
  } = { post: null, filter: null, model: input.spec.model, promptVersion: '', outputJson: '', metaJson: '', notWriting: false, lastProblem: null, safety: rowSafety(row.safety_flag) };

  /** 身心安全旗標當下就記（見檔頭第 7 步）：列的 safety_flag（最嚴重的）＋同一個操作、同一個類別只寫一次的 wellbeing_flag 事件。 */
  const recordSafety = (category: Exclude<SafetyFlag, 'none'>) =>
    db.batch([
      db
        .prepare(`UPDATE exemplar_sets SET safety_flag = ?1 WHERE id = ?2 AND user_id = ?3 AND op_id = ?4 AND status IN ('queued', 'running')`)
        .bind(state.safety, setId, userId, op.id),
      db
        .prepare(
          `INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'wellbeing_flag', ?2, ?3
            WHERE NOT EXISTS (SELECT 1 FROM ai_safety_events WHERE op_id = ?1 AND kind = 'wellbeing_flag' AND category = ?2)`,
        )
        .bind(op.id, category, ctx.userRef),
    ]);

  // 第 7 步：呼叫與後處理。
  const result = await callWithPolicy(
    ctx,
    input,
    async (data, _callId, model, promptVersion) => {
      const filter = new OutputFilter();
      const post = postprocessExemplars(data as ExemplarOutput, postCtx, filter);
      // 身心安全旗標在任何提早結束之前就記（不是寫作題、語意檢查不通過也要留下）。
      if (post.safety !== 'none') {
        state.safety = worseSafety(state.safety, post.safety);
        await recordSafety(post.safety);
      }
      if (post.notWritingTask) {
        state.notWriting = true;
        return null;
      }
      let problem: string | null = post.problem;
      if (problem === null) {
        // 顯示的旗標用這個操作看過最嚴重的（第一次產生標了、第二次沒標，關懷訊息照樣出現）。
        const view = state.safety === 'none' ? post.view : { ...post.view, safety_flag: state.safety };
        const done = exemplarDoneRow({ view, meta: exemplarMetaOf(req, fp.version, post, model === input.spec.model ? {} : { served_fallback: true }) });
        if (done.ok) Object.assign(state, { post, filter, model, promptVersion, outputJson: done.outputJson, metaJson: done.metaJson });
        else problem = done.problem;
      }
      if (problem === null) return null;
      // 語意檢查不通過：先記下（跨投遞的內容失敗次數），再回傳字串讓 callWithPolicy 決定重試或退還。
      state.lastProblem = problem;
      log('exemplar_invalid_output', { op_id: op.id, problem });
      await bumpContentFailureStatement(db, ref).run();
      return problem;
    },
    { contentAttempts: remaining },
  );

  const failMeta = (fields: Record<string, unknown>) => buildExemplarMeta({ versions: exemplarVersions(req, fp.version), fields });

  /** 處理結果 → ack、交給 Queue 重送（先放掉租約）或退還。 */
  const finish = async (action: Action): Promise<void> => {
    const meta = state.lastProblem ? failMeta({ last_problem: state.lastProblem }) : undefined;
    switch (action.kind) {
      case 'done':
        msg.ack();
        return;
      case 'requeue':
      case 'retry':
        if (msg.attempts < QUEUE_MAX_DELIVERIES) {
          await releaseLease();
          log('ai_retry', { op_id: op.id, task: op.task, reason: action.kind === 'retry' ? action.reason : 'requeue', attempts: msg.attempts, ...(action.kind === 'retry' && action.detail ? { detail: action.detail } : {}) });
          msg.retry({ delaySeconds: 30 * msg.attempts });
          return;
        }
        if (action.kind === 'retry' && action.reason === 'api_error') await opsEvent(db, 'anthropic_error', 'error', { op_id: op.id, task: op.task, detail: action.detail ?? null });
        return fail(action.kind === 'retry' ? action.reason : 'internal', meta);
      case 'refund':
        if (action.spendLimit) {
          await db.batch([
            setPausedStatement(db, true, now()),
            opsEventStatement(db, 'anthropic_spend_limit', 'error', { op_id: op.id, task: op.task, note: '429 enforced_spend_limit_reached：全站已暫停' }),
          ]);
        } else if (action.configProblem) {
          await opsEvent(db, 'anthropic_config', 'error', { op_id: op.id, task: op.task, reason: action.reason, detail: action.detail ?? null });
        }
        return fail(action.reason, meta);
    }
  };

  if (!result.ok) return finish(actionForFailures([result]));
  if (state.notWriting) {
    // 自訂題不是英文寫作題目：不重試，退還（算進每日內容退還的上限，防止用它免費試探）。
    log('exemplar_not_writing_task', { op_id: op.id });
    return fail('invalid_output', failMeta({ not_writing_task: true }));
  }
  const post = state.post;
  if (!post) return finish({ kind: 'refund', reason: 'internal' });

  // 第 8 步：結算。
  const nowMs = now();
  const settledAt = nowSeconds(nowMs);
  const d8Levels = post.hidden.filter((h) => h.reason === 'd8').map((h) => h.level);
  const copied = post.hidden.filter((h) => h.reason === 'task_copy');
  const d8Hidden = d8Levels.length > 0 || post.counts.d8_notes > 0;
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE exemplar_sets SET status = 'done', output_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, d8_hidden = ?5,
                  safety_flag = ?6, failure = NULL, lease_until = NULL, updated_at = ?7, expires_at = ?8
            WHERE id = ?9 AND user_id = ?10 AND op_id = ?11 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?11 AND settle_token = ?12)`,
        )
        .bind(state.outputJson, state.promptVersion, state.model, state.metaJson, d8Hidden ? 1 : 0, state.safety === 'none' ? null : state.safety, settledAt, settledAt + EXEMPLAR_RETENTION_SECONDS, setId, userId, op.id, token),
      ...(d8Levels.length > 0 ? [opsEventIfSettled(db, op.id, token, 'exemplar_d8_output', { op_id: op.id, levels: d8Levels })] : []),
      ...copied.map((h) => opsEventIfSettled(db, op.id, token, 'exemplar_task_copy', { op_id: op.id, level: h.level, windows: h.windows ?? 0 })),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);

  // 第 9 步：共用快取（只有網站題目、不是重新產生；寫入條件見 cache.ts）。
  let cache: 'written' | 'conflict' | 'skipped' = 'skipped';
  const writable =
    settled &&
    row.fresh === 0 &&
    !post.tainted &&
    state.safety === 'none' &&
    state.model === input.spec.model &&
    state.outputJson.length <= EXEMPLAR_CACHE_MAX_CHARS;
  if (writable && req.source !== 'custom') {
    const key = await exemplarCacheKey({ promptVersion: state.promptVersion, model: input.spec.model, effort: input.spec.effort, d8Version: fp.version, userText: input.content as string });
    const gen = await writeExemplarCache(db, { key, groupId: req.group.group_id, promptVersion: state.promptVersion, model: state.model, resultJson: state.outputJson, now: settledAt });
    cache = gen === null ? 'conflict' : 'written';
    if (gen !== null) {
      await db
        .prepare(`UPDATE exemplar_sets SET cache_key = ?1, cache_gen = ?2 WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status = 'done'`)
        .bind(key, gen, setId, userId, op.id)
        .run()
        .catch((err: unknown) => console.error('記下共用快取的代失敗（不影響這次產生）', op.id, err));
    }
  }
  log('ai_settled', { op_id: op.id, task: op.task, settled, hidden: post.hidden.length, tainted: post.tainted, cache });
  msg.ack();
}
