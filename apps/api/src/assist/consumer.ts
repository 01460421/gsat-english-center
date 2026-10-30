/**
 * 學習助手任務的 Queue consumer（docs/design/learning-assistant.md §4.8）。src/ai/consumer.ts 的 handleMessage 讀到操作、
 * 確認還是 reserved 之後，學習助手的任務（assist_*）交給這裡，不走提交。
 *
 * 步驟（同 ARCHITECTURE §3.4 第 5–12 步，對象換成 turn 或報告）：
 *   1. 讀 turn 或報告（id = ref_id AND user_id AND op_id）。讀不到（只會發生在刪除帳號的 CASCADE；進行中的案例與報告不能刪）
 *      或種類對不上 → 以 internal 退還、ack。
 *   2. 條件式搶租約（操作必須仍是 reserved：回收卡住的預扣時已退還的搶不到）；搶到後把 lease.held 設成這張表，
 *      之後遇到預期外的錯誤，外層依表別放掉租約，下一次投遞可以立刻處理。搶不到就照寫作批改的邏輯延後重送或 ack。
 *   3. 全站暫停而且還沒有任何 ai_calls → 退還 paused。
 *   4. D8 指紋讀不到 → 退還 internal（requireD8Fingerprints 寫 d8_fingerprints_invalid，每個 isolate 一次）。
 *   5. 依任務組請求（requests.ts；解析和路由用同一支，所以快取鍵一致）→ callWithPolicy（截斷或格式不符時，時間夠就在這次重試一次）
 *      → 每次呼叫 recordCall。
 *   6. 後處理（output.ts）→ 結算：settleOp 的附帶語句都以 settle_token 為條件（同一則訊息送兩次只結算一次）：
 *        解析  turn 改 done、寫 output_json；案例改 analyzed、analyses = MIN(analyses + 1, 2)、技能與錯因、safety、d8_hidden、cache_key。
 *        追問  turn 改 done；案例 followups = MIN(followups + 1, 8)、併進追問發現的錯因。
 *      安全事件（wellbeing_flag）與 ops 事件（assist_d8_output、assist_key_concern）也在同一個 batch。
 *      共用快取的寫入不在交易裡：失敗只記 log。
 *   7. 失敗：可重試的交給 Queue 重送（最多 4 次投遞）；不可重試或用完 → refundWithAssistRef（turn 改 failed、放掉租約；
 *      解析失敗時案例沒有成功的解析就改 failed，否則維持 analyzed）。
 *   8. 內容退還（拒答、格式不符、截斷）同一人 7 天內第 3 次起寫 ops 事件 assist_content_refunds（callPolicy.ts 的 contentRefundAlert）。
 * 轉錄（WP-A3）的第 5–7 步在 ocr.ts 的 runAssistOcr（讀照片 → 呼叫 → 後處理 → 結算：turn 改 done、案例改 ocr_ready、刪照片）；
 * 照片過期退還 expired，看不出是英文題目或全部被隱藏退還 invalid_output（refund.ts 同時刪照片）。
 * 報告（WP-C）的第 5–7 步在 reportConsumer.ts 的 runAssistReport（讀 input_json → 呼叫 → 後處理與逐週份量 → 結算：報告改 done、
 * 寫 report_json、刪掉超過 10 版的舊版）；租約在 assist_reports。
 * 日誌只記 op id、任務、狀態與數字，不記題目、學生文字或解析內容。
 *
 * 科目（docs/design/assistant-subjects.md §2.3）：讀到 turn 與案例之後依案例的科目（ref_json.subject，沒有就是英文）分派。
 * 英文走這個檔原本的 runAnalyze、runFollowup 與 ocr.ts 的 runAssistOcr（一個字都不改）；國文走 subjects/chinese/run.ts
 * （另外要國文的 D8 指紋，讀不到以 internal 退還）。任務設定一律用 turn 的 meta_json 存的 {subject, kind, items}
 * （routes 預扣時用的同一組；沒有 subject＝英文，舊的 turn 沒有這幾個鍵時照題目重算，和現行相同）。
 * 國寫範文（assist_zh_exemplar；國寫範文設計 §7）：turn 的 kind 是 followup、meta_json.task 是 zh_exemplar，只有國文的國寫案例；
 * 走 subjects/chinese/run.ts 的 runZhExemplar。任務和 turn 對不上（範文的 turn 給了追問的任務，或反過來）一律以 internal 退還。
 */
import {
  ASSIST_LIMITS,
  assistItemCount,
  isAssistErrorCode,
  isAssistSubject,
  isAssistTask,
  isZhCaseKind,
  type AiTask,
  type AssistAnalysisView,
  type AssistCaseKind,
  type AssistFollowupMode,
  type AssistFollowupView,
  type AssistQuestionView,
  type AssistTask,
  type AssistVocabView,
  type AssistWritingView,
} from '@gsat/shared';
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
  type LeaseTable,
  type OpRow,
} from '../ai/callPolicy';
import { requireD8Fingerprints, type D8Fingerprints } from '../ai/d8';
import { FILTER_VERSION, OutputFilter } from '../ai/filter';
import { settleOp, setPausedStatement } from '../ai/guard';
import { opsEvent, opsEventStatement, userRefFor } from '../ai/ledger';
import { LEASE_SECONDS, QUEUE_MAX_DELIVERIES, taskConfig, type AssistTaskSize } from '../ai/tasks';
import { loadConfig } from '../config';
import { parseJson } from '../submissions/repo';
import { nowSeconds, taiwanDay } from '../time';
import type { AssistFollowupOutput, AssistItemOutput, AssistVocabOutput, AssistWritingOutput } from './analysisSchemas';
import { ASSIST_CACHE_MAX_CHARS, assistCacheKey, cacheRefId, writeCache } from './cache';
import { postprocessFollowup, postprocessItem, postprocessVocab, postprocessWriting, type Postprocessed } from './output';
import { refundWithAssistRef } from './refund';
import { runAssistReport } from './reportConsumer';
import { codeList, mergeCodes, type CaseRow, type TurnRow } from './repo';
import { runAssistOcr } from './ocr';
import { analyzeCallInput, followupCallInput, isCacheable, requestCaseOf, studentPatternsText, type FollowupRound } from './requests';
import { requireZhFingerprints } from './subjects/chinese/d8';
import { runZhAnalyze, runZhExemplar, runZhFollowup, runZhOcr } from './subjects/chinese/run';
import { subjectOfCase } from './subjects/index';

/** 學習助手的任務 → 操作對象所在的表與 turn 的種類（報告沒有 turn）。 */
const TASK_TARGETS: Record<AssistTask, { table: Extract<LeaseTable, 'assist_turns' | 'assist_reports'>; kind: 'ocr' | 'analyze' | 'followup' | null }> = {
  assist_ocr: { table: 'assist_turns', kind: 'ocr' },
  assist_analyze: { table: 'assist_turns', kind: 'analyze' },
  assist_followup: { table: 'assist_turns', kind: 'followup' },
  assist_report: { table: 'assist_reports', kind: null },
  // 國寫範文的 turn 在資料庫是 followup（meta_json.task＝'zh_exemplar'；國寫範文設計 §1）。
  assist_zh_exemplar: { table: 'assist_turns', kind: 'followup' },
};

/** 學習助手內容退還的計數與告警（ops_events 的 kind）。 */
export const ASSIST_CONTENT_REFUND_MARK = 'assist_content_refund';
export const ASSIST_CONTENT_REFUND_ALERT = 'assist_content_refunds';

/** turn 的 output_json 上限（assist_turns 的 CHECK）。 */
const OUTPUT_JSON_MAX_CHARS = 98_304;

interface TargetRow {
  status: string;
  kind: string | null;
  lease_until: number | null;
}

/** 讀 turn 或報告（只認同一個使用者、指向這個操作的那一列）。 */
async function loadTarget(db: D1Database, table: 'assist_turns' | 'assist_reports', op: OpRow & { user_id: number; ref_id: string }): Promise<TargetRow | null> {
  const sql =
    table === 'assist_turns'
      ? 'SELECT status, kind, lease_until FROM assist_turns WHERE id = ?1 AND user_id = ?2 AND op_id = ?3'
      : 'SELECT status, NULL AS kind, lease_until FROM assist_reports WHERE id = ?1 AND user_id = ?2 AND op_id = ?3';
  return db.prepare(sql).bind(op.ref_id, op.user_id, op.id).first<TargetRow>();
}

/** 條件式搶租約（兩句固定的 SQL，不拼表名）：只搶還在進行中、沒有有效租約、操作仍是 reserved 的那一列。 */
const LEASE_SQL = {
  assist_turns: `UPDATE assist_turns SET lease_until = ?1, tries = MIN(tries + 1, 5), status = 'running', updated_at = ?2
                  WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'running')
                    AND (lease_until IS NULL OR lease_until <= ?2)
                    AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND status = 'reserved')`,
  assist_reports: `UPDATE assist_reports SET lease_until = ?1, tries = MIN(tries + 1, 5), status = 'running', updated_at = ?2
                    WHERE id = ?3 AND user_id = ?4 AND op_id = ?5 AND status IN ('queued', 'running')
                      AND (lease_until IS NULL OR lease_until <= ?2)
                      AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?5 AND status = 'reserved')`,
} as const;

/** 學習助手的處理脈絡：共用的呼叫脈絡＋turn、案例、題目與指紋。 */
type AssistCtx = CallContext & {
  turn: TurnRow;
  caseRow: CaseRow;
  question: AssistQuestionView;
  fp: D8Fingerprints;
};

export async function handleAssistMessage(env: Env, msg: Message<AiQueueMessage>, deps: ConsumerDeps, lease: LeaseHeld, op: OpRow): Promise<void> {
  const db = env.DB;
  const now = deps.now ?? Date.now;
  const config = loadConfig(env);
  const fail = async (reason: string) => {
    const refunded = await refundWithAssistRef(db, op, reason, now());
    log('ai_refund', { op_id: op.id, task: op.task, reason });
    if (refunded && CONTENT_REFUND_REASONS.has(reason)) {
      await contentRefundAlert(db, op, config.auth.ledgerSalt, now(), { mark: ASSIST_CONTENT_REFUND_MARK, alertKind: ASSIST_CONTENT_REFUND_ALERT, label: '學習助手' });
    }
    msg.ack();
  };
  if (!isAssistTask(op.task) || op.user_id === null || op.ref_id === null) return fail('internal');
  const task = op.task;
  const target = TASK_TARGETS[task];
  const opRef = { ...op, user_id: op.user_id, ref_id: op.ref_id, task };
  const startedAt = now();

  // 第 1 步：讀 turn 或報告。
  const row = await loadTarget(db, target.table, opRef);
  if (!row || (target.kind !== null && row.kind !== target.kind)) return fail('internal');

  // 第 2 步：條件式搶租約。
  const nowS = nowSeconds(now());
  const leased = await db.prepare(LEASE_SQL[target.table]).bind(nowS + LEASE_SECONDS, nowS, opRef.ref_id, opRef.user_id, op.id).run();
  if (leased.meta.changes !== 1) {
    const cur = await loadTarget(db, target.table, opRef);
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
  lease.held = { table: target.table, id: opRef.ref_id, userId: opRef.user_id, opId: op.id };

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

  const callBase = async (size: AssistTaskSize): Promise<CallContext> => ({
    env,
    db,
    deps,
    now,
    op: { ...op, user_id: opRef.user_id, task: task as AiTask },
    startedAt,
    tc: taskConfig(task, config, size),
    userRef: await userRefFor(config.auth.ledgerSalt, opRef.user_id),
    callInput: () => {
      throw new Error('callInput 尚未設定');
    },
  });

  /** 處理結果 → ack、交給 Queue 重送（先放掉租約）或退還。 */
  const finish = async (action: Action, releaseLease: () => Promise<unknown>): Promise<void> => {
    switch (action.kind) {
      case 'done':
        msg.ack();
        return;
      case 'requeue':
      case 'retry':
        if (msg.attempts < QUEUE_MAX_DELIVERIES) {
          await releaseLease();
          log('ai_retry', { op_id: op.id, task, reason: action.kind === 'retry' ? action.reason : 'requeue', attempts: msg.attempts, ...(action.kind === 'retry' && action.detail ? { detail: action.detail } : {}) });
          msg.retry({ delaySeconds: 30 * msg.attempts });
          return;
        }
        // 重送用完還是 Anthropic 的錯誤：留一筆事件（含錯誤說明），站主在健康檢查就看得到原因。
        if (action.kind === 'retry' && action.reason === 'api_error') await opsEvent(db, 'anthropic_error', 'error', { op_id: op.id, task, detail: action.detail ?? null });
        return fail(action.kind === 'retry' ? action.reason : 'internal');
      case 'refund':
        if (action.spendLimit) {
          await db.batch([
            setPausedStatement(db, true, now()),
            opsEventStatement(db, 'anthropic_spend_limit', 'error', { op_id: op.id, task, note: '429 enforced_spend_limit_reached：全站已暫停' }),
          ]);
        } else if (action.configProblem) {
          await opsEvent(db, 'anthropic_config', 'error', { op_id: op.id, task, reason: action.reason, detail: action.detail ?? null });
        }
        return fail(action.reason);
    }
  };

  // 學習報告（WP-C）：輸入在建立時已經算好存進 input_json（reportConsumer.ts）。
  if (task === 'assist_report') {
    const action = await runAssistReport({ ...(await callBase({ items: 1 })), reportId: opRef.ref_id, fp });
    return finish(action, () => db.prepare('UPDATE assist_reports SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(opRef.ref_id, opRef.user_id, op.id).run());
  }

  // turn、案例與題目（案例進行中不能刪；題目資料壞掉就退還，不呼叫模型）。
  const turn = await db
    .prepare(
      `SELECT id, case_id, user_id, seq, kind, status, op_id, input_text, label, mode, output_json, failure, cache_hit, prompt_version,
              served_model, meta_json, lease_until, tries, created_at FROM assist_turns WHERE id = ?1 AND user_id = ?2`,
    )
    .bind(opRef.ref_id, opRef.user_id)
    .first<TurnRow>();
  const caseRow = turn
    ? await db
        .prepare(
          `SELECT id, user_id, source, kind, ref_json, trust, section, title, item_count, wrong_count, question_json, doubt_kinds_json, torn_with,
                  doubt_text, hint_first, status, verdict, skills_json, errors_json, understood, rating, note_text, cache_key, analyses, followups,
                  d8_hidden, injection_flag, safety_flag, created_at, updated_at, expires_at FROM assist_cases WHERE id = ?1 AND user_id = ?2`,
        )
        .bind(turn.case_id, opRef.user_id)
        .first<CaseRow>()
    : null;
  const question = caseRow ? parseJson<AssistQuestionView>(caseRow.question_json) : null;

  // 科目：國文走 subjects/chinese/run.ts（另外要國文的 D8 指紋；讀不到就不處理）。任務設定用 turn 存的 {subject, kind, items}。
  const subject = caseRow ? subjectOfCase(caseRow) : 'english';
  const turnMeta = turn ? (parseJson<{ subject?: unknown; kind?: unknown; items?: unknown; photos?: unknown; task?: unknown }>(turn.meta_json) ?? {}) : {};
  const metaItems = typeof turnMeta.items === 'number' && Number.isFinite(turnMeta.items) ? turnMeta.items : null;
  // 國寫範文與追問共用 followup 的 turn：任務和 meta_json.task 要對得上，範文只有國文。
  if ((task === 'assist_zh_exemplar') !== (turnMeta.task === 'zh_exemplar') || (task === 'assist_zh_exemplar' && subject !== 'chinese')) {
    log('assist_question_invalid', { op_id: op.id, task, subject });
    return fail('internal');
  }
  if (subject === 'chinese') {
    if (!turn || !caseRow || (turnMeta.subject !== undefined && (!isAssistSubject(turnMeta.subject) || turnMeta.subject !== subject))) {
      log('assist_question_invalid', { op_id: op.id, task, subject });
      return fail('internal');
    }
    const zh = await requireZhFingerprints(db);
    if (!zh) return fail('internal');
    let action: Action;
    if (task === 'assist_ocr') {
      if (caseRow.source !== 'photo') return fail('internal');
      action = await runZhOcr({ ...(await callBase({ subject, photos: turnMeta.photos === 2 ? 2 : 1 })), turn, caseRow, fp, zh });
    } else {
      if (!question || !validZhQuestion(caseRow.kind, question)) {
        log('assist_question_invalid', { op_id: op.id, task, subject });
        return fail('internal');
      }
      const items = metaItems ?? assistItemCount(subject, caseRow.kind, question);
      const ctx = { ...(await callBase({ subject, kind: caseRow.kind, items })), turn, caseRow, question, fp, zh };
      action = task === 'assist_analyze' ? await runZhAnalyze(ctx) : task === 'assist_zh_exemplar' ? await runZhExemplar(ctx) : await runZhFollowup(ctx);
    }
    return finish(action, () => db.prepare('UPDATE assist_turns SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(turn.id, turn.user_id, op.id).run());
  }

  let action: Action;
  if (task === 'assist_ocr') {
    // 轉錄（WP-A3）：題目要等學生確認轉錄之後才有，這裡只要 turn 與案例（拍照的題目、轉錄排隊中）。
    if (!turn || !caseRow || caseRow.source !== 'photo') {
      log('assist_question_invalid', { op_id: op.id, task });
      return fail('internal');
    }
    action = await runAssistOcr({ ...(await callBase({ items: 1 })), turn, caseRow, fp });
  } else {
    if (!turn || !caseRow || !question || !validQuestion(caseRow.kind, question)) {
      log('assist_question_invalid', { op_id: op.id, task });
      return fail('internal');
    }
    const items = metaItems ?? (caseRow.kind === 'item' ? Math.max(1, question.targets.length) : 1);
    const ctx: AssistCtx = { ...(await callBase({ subject: 'english', kind: caseRow.kind, items })), turn, caseRow, question, fp };
    action = task === 'assist_analyze' ? await runAnalyze(ctx) : await runFollowup(ctx);
  }
  return finish(action, () => db.prepare('UPDATE assist_turns SET lease_until = NULL WHERE id = ?1 AND user_id = ?2 AND op_id = ?3').bind(turn.id, turn.user_id, op.id).run());
}

/** 國文的題目夠不夠組請求：學生提供的區塊、至少一題、種類是國文的。 */
function validZhQuestion(kind: AssistCaseKind, q: AssistQuestionView): boolean {
  return isZhCaseKind(kind) && Array.isArray(q.targets) && q.targets.length >= 1 && Array.isArray(q.blocks) && q.blocks.length >= 1;
}

/** 題目的形狀夠不夠組請求（舊資料或壞掉的 JSON 不呼叫模型）。 */
function validQuestion(kind: AssistCaseKind, q: AssistQuestionView): boolean {
  if (!Array.isArray(q.targets) || !Array.isArray(q.siblings)) return false;
  if (kind === 'item') return q.targets.length >= 1 && (q.trust === 'site' || Array.isArray(q.blocks));
  if (kind === 'writing') return typeof q.writing?.student_text === 'string' && typeof q.writing.prompt === 'string';
  return Array.isArray(q.vocab?.entries) && q.vocab.entries.length >= 1;
}

/**
 * <student_patterns>：這位學生其他案例的錯因次數（前 3 個）與最新一版報告的弱點 area（只有代碼與數字；§4.9）。
 * 報告還沒有上線時只有錯因；讀不到就不帶。只數英文的案例（國文和英文同名的通用錯因不混在一起，
 * docs/design/assistant-subjects.md §7.3；只有英文案例時和改版前完全相同）。
 */
async function studentPatterns(db: D1Database, userId: number, caseId: string, now: number): Promise<string | null> {
  try {
    const counts = await db
      .prepare(
        `SELECT j.value AS code, COUNT(DISTINCT c.id) AS n FROM assist_cases c, json_each(c.errors_json) j
          WHERE c.user_id = ?1 AND c.id <> ?2 AND c.expires_at > ?3 AND COALESCE(json_extract(c.ref_json, '$.subject'), 'english') = 'english'
          GROUP BY j.value ORDER BY n DESC, j.value LIMIT 10`,
      )
      .bind(userId, caseId, now)
      .all<{ code: unknown; n: number }>();
    const report = await db
      .prepare(`SELECT report_json FROM assist_reports WHERE user_id = ?1 AND status = 'done' ORDER BY version DESC LIMIT 1`)
      .bind(userId)
      .first<{ report_json: string | null }>();
    const weaknesses = parseJson<{ weaknesses?: Array<{ area?: unknown }> }>(report?.report_json ?? null)?.weaknesses ?? [];
    const areas = weaknesses.map((w) => w.area).filter((a): a is string => typeof a === 'string' && /^[a-z_]{2,24}(:[A-Za-z_]{2,40})?$/.test(a));
    const errors = counts.results.filter((r): r is { code: string; n: number } => isAssistErrorCode(r.code));
    return studentPatternsText(errors, areas);
  } catch (err) {
    console.error('讀學生的錯因歷史失敗（不帶 student_patterns）', err);
    return null;
  }
}

/** ops 事件（只在這次結算成功時寫：以 settle_token 為條件）。 */
function opsEventIfSettled(db: D1Database, opId: string, token: string, kind: string, severity: 'info' | 'warn' | 'error', detail: Record<string, unknown>): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?4 AND settle_token = ?5)`)
    .bind(kind, severity, JSON.stringify(detail).slice(0, 4000), opId, token);
}

/** 安全事件（同上，以 settle_token 為條件）。 */
function safetyIfSettled(db: D1Database, opId: string, token: string, kind: 'wellbeing_flag', category: string, ref: string | null): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?1 AND settle_token = ?5)`)
    .bind(opId, kind, category, ref, token);
}

/** 共同的附帶事件：身心安全、D8 隱藏、答案疑慮（只有 id、代碼與計數）。 */
function sideEvents(ctx: AssistCtx, token: string, post: Postprocessed<{ safety_flag: string; off_topic: boolean }>): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  const { db, op } = ctx;
  if (post.safety !== 'none') out.push(safetyIfSettled(db, op.id, token, 'wellbeing_flag', post.safety, ctx.userRef));
  if (post.meta.d8_hidden > 0) out.push(opsEventIfSettled(db, op.id, token, 'assist_d8_output', 'warn', { op_id: op.id, fields: post.meta.d8_hidden }));
  if (post.keyConcern) {
    out.push(opsEventIfSettled(db, op.id, token, 'assist_key_concern', 'warn', { op_id: op.id, ref: cacheRefId(ctx.caseRow.ref_json), labels: ctx.question.targets.map((t) => t.display_label) }));
  }
  return out;
}

// ───────────────────────── 解析 ─────────────────────────

async function runAnalyze(ctx: AssistCtx): Promise<Action> {
  const { db, caseRow, question, fp, tc, op } = ctx;
  const reqCase = requestCaseOf(caseRow, question);
  const cacheable = isCacheable(reqCase);
  const patterns = cacheable ? null : await studentPatterns(db, op.user_id, caseRow.id, nowSeconds(ctx.now()));
  const input = analyzeCallInput(tc, reqCase, { patterns, fp });
  ctx.callInput = () => input;
  const state: { post: Postprocessed<AssistAnalysisView | AssistWritingView | AssistVocabView> | null; filter: OutputFilter | null; model: string; promptVersion: string; json: string } = {
    post: null,
    filter: null,
    model: input.spec.model,
    promptVersion: '',
    json: '',
  };
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    let post: Postprocessed<AssistAnalysisView | AssistWritingView | AssistVocabView>;
    switch (caseRow.kind) {
      case 'item':
        post = postprocessItem(data as AssistItemOutput, question, filter, fp);
        break;
      case 'writing':
        post = postprocessWriting(data as AssistWritingOutput, question, filter, fp);
        break;
      case 'vocab':
        post = postprocessVocab(data as AssistVocabOutput, question, filter, fp);
        break;
      default:
        // 國文案例在 handleAssistMessage 就分派到 subjects/chinese/run.ts，不會走到這裡。
        throw new Error(`英文的解析不處理 ${caseRow.kind}`);
    }
    const json = JSON.stringify(post.view);
    if (json.length > OUTPUT_JSON_MAX_CHARS) return 'output_too_large';
    Object.assign(state, { post, filter, model, promptVersion, json });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  const post = state.post!;

  // 共用快取：站內題、沒有任何段落被過濾或被 D8 隱藏、沒有答案疑慮、沒有身心安全旗標、沒有注入旗標、不是離題、JSON 不太大，
  // 而且是請求的模型自己回的（server-side fallback 由接手模型回的不寫：快取鍵是請求的模型，§4.7.4）。
  const writable =
    cacheable &&
    !post.tainted &&
    !post.keyConcern &&
    post.safety === 'none' &&
    !post.offTopic &&
    caseRow.injection_flag === 0 &&
    state.model === input.spec.model &&
    state.json.length <= ASSIST_CACHE_MAX_CHARS;
  const cacheKey = cacheable
    ? await assistCacheKey({ promptVersion: state.promptVersion, model: input.spec.model, effort: input.spec.effort, d8Version: fp.version, userText: input.content as string })
    : null;
  const meta = {
    filter_version: FILTER_VERSION,
    d8_fp: fp.version,
    cacheable,
    patterns: patterns !== null,
    ...(cacheKey ? { cache_key: cacheKey } : {}),
    counts: post.meta,
  };
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const skills = mergeCodes(codeList(caseRow.skills_json), post.skillCodes);
  const errors = mergeCodes(codeList(caseRow.errors_json), post.errorCodes);
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
                  cache_key = COALESCE(?6, cache_key), updated_at = ?7, expires_at = ?8
            WHERE id = ?9 AND user_id = ?10 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?11 AND settle_token = ?12)`,
        )
        .bind(
          ASSIST_LIMITS.analysesPerCase,
          skills,
          errors,
          post.safety === 'none' ? null : post.safety,
          post.meta.d8_hidden > 0 ? 1 : 0,
          writable ? cacheKey : null,
          now,
          now + ASSIST_LIMITS.retentionDays * 86_400,
          caseRow.id,
          op.user_id,
          op.id,
          token,
        ),
      ...sideEvents(ctx, token, post),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  if (settled && writable && cacheKey) {
    await writeCache(db, { key: cacheKey, refId: cacheRefId(caseRow.ref_json), promptVersion: state.promptVersion, model: state.model, resultJson: state.json, now });
  }
  log('ai_settled', { op_id: op.id, task: op.task, settled, items: question.targets.length });
  return { kind: 'done' };
}

// ───────────────────────── 追問 ─────────────────────────

async function runFollowup(ctx: AssistCtx): Promise<Action> {
  const { db, caseRow, question, fp, tc, op, turn } = ctx;
  const turns = await db
    .prepare(`SELECT kind, status, input_text, output_json, seq FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 AND seq < ?3 AND status = 'done' ORDER BY seq`)
    .bind(caseRow.id, op.user_id, turn.seq)
    .all<{ kind: string; status: string; input_text: string | null; output_json: string | null; seq: number }>();
  const analyses = turns.results.filter((t) => t.kind === 'analyze');
  const analysis = parseJson<AssistAnalysisView | AssistWritingView | AssistVocabView>(analyses[analyses.length - 1]?.output_json ?? null);
  if (!analysis || turn.input_text === null) return { kind: 'refund', reason: 'internal' };
  const rounds: FollowupRound[] = turns.results
    .filter((t) => t.kind === 'followup' && t.input_text !== null)
    .map((t) => ({ question: t.input_text!, reply: parseJson<AssistFollowupView>(t.output_json) }));
  const mode: AssistFollowupMode = turn.mode === 'hint' ? 'hint' : 'explain';
  const input = followupCallInput(tc, { case: requestCaseOf(caseRow, question), analysis, rounds, question: turn.input_text, mode, label: turn.label, fp });
  ctx.callInput = () => input;
  // 例句的字數上限：站內的選擇題 25 個單詞，寫作、單字與學生提供的題目 20 個。
  const strict = caseRow.trust === 'student' || caseRow.kind !== 'item';
  const state: { post: Postprocessed<AssistFollowupView> | null; filter: OutputFilter | null; model: string; promptVersion: string } = { post: null, filter: null, model: input.spec.model, promptVersion: '' };
  const result = await callWithPolicy(ctx, input, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    Object.assign(state, { post: postprocessFollowup(data as AssistFollowupOutput, mode, strict, filter, fp), filter, model, promptVersion });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  const post = state.post!;
  const json = JSON.stringify(post.view);
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const meta = { filter_version: FILTER_VERSION, d8_fp: fp.version, rounds: rounds.length, counts: post.meta };
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
      ...sideEvents(ctx, token, post),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  log('ai_settled', { op_id: op.id, task: op.task, settled });
  return { kind: 'done' };
}
