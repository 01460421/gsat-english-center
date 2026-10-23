/**
 * 學習報告的 Queue consumer 分支（docs/design/learning-assistant.md §4.8 第 5–7 步、§3.4）。負責：WP-C。
 * consumer.ts 搶到 assist_reports 的租約、確認不是全站暫停、讀到 D8 指紋之後交給這裡。
 *
 *   1. 讀報告列（id、user_id；op_id 已由搶租約的 SQL 確認）與 input_json（路由建立時算好的 facts、骨架、代表案例、候選、
 *      上一版摘要）。形狀不對就以 internal 退還，不呼叫模型。
 *   2. 組請求（reportRequests.ts）→ callWithPolicy（截斷或格式不符時，時間夠就在這次重試一次）。
 *   3. 後處理（reportOutput.ts：代碼與對應、長度、過濾、品牌、英文字數、D8、預測句、逐週份量）。report_json ≤ 128 KB。
 *   4. 結算（settleOp 的附帶語句都以 settle_token 為條件）：報告改 done、寫 report_json、prompt_version、served_model、meta；
 *      同一個 batch 刪掉這位學生超過最近 10 版的舊版（不刪進行中的）；身心安全旗標寫安全事件、D8 隱藏寫 ops 事件。
 * 日誌只記 op id、任務與數字，不記報告內容。
 */
import { ASSIST_LIMITS, type AssistReportFacts } from '@gsat/shared';
import { actionForFailures, callWithPolicy, log, recordFiltered, type Action, type CallContext } from '../ai/callPolicy';
import type { D8Fingerprints } from '../ai/d8';
import { FILTER_VERSION, OutputFilter } from '../ai/filter';
import { settleOp } from '../ai/guard';
import { parseJson } from '../submissions/repo';
import { nowSeconds } from '../time';
import { postprocessReport, type ReportPostprocessed } from './reportOutput';
import { reportCallInput, type ReportInput } from './reportRequests';
import type { AssistReportOutput } from './reportSchemas';

/** report_json 的上限（assist_reports 的 CHECK）。 */
export const REPORT_JSON_MAX_CHARS = 131_072;

/** input_json 夠不夠組請求（舊資料或壞掉的 JSON 不呼叫模型）。 */
export function validReportInput(v: unknown): v is ReportInput {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Partial<ReportInput>;
  const facts = x.facts as AssistReportFacts | undefined;
  return (
    x.v === 1 &&
    typeof x.version === 'number' &&
    typeof facts === 'object' &&
    facts !== null &&
    Array.isArray(facts.sections) &&
    typeof x.skeleton === 'object' &&
    x.skeleton !== null &&
    Array.isArray(x.skeleton.weeks) &&
    Array.isArray(x.skeleton.phases) &&
    Array.isArray(x.digests) &&
    Array.isArray(x.candidates) &&
    typeof x.settings === 'object' &&
    x.settings !== null
  );
}

export async function runAssistReport(ctx: CallContext & { reportId: string; fp: D8Fingerprints }): Promise<Action> {
  const { db, op, tc, fp } = ctx;
  const row = await db
    .prepare('SELECT id, version, input_json, feedback_text FROM assist_reports WHERE id = ?1 AND user_id = ?2 AND op_id = ?3')
    .bind(ctx.reportId, op.user_id, op.id)
    .first<{ id: string; version: number; input_json: string; feedback_text: string | null }>();
  const input = row ? parseJson<unknown>(row.input_json) : null;
  if (!row || !validReportInput(input)) {
    log('assist_report_input_invalid', { op_id: op.id });
    return { kind: 'refund', reason: 'internal' };
  }
  const call = reportCallInput(tc, input, row.feedback_text);
  ctx.callInput = () => call;
  const state: { post: ReportPostprocessed | null; filter: OutputFilter | null; model: string; promptVersion: string; json: string } = {
    post: null,
    filter: null,
    model: call.spec.model,
    promptVersion: '',
    json: '',
  };
  const result = await callWithPolicy(ctx, call, async (data, _callId, model, promptVersion) => {
    const filter = new OutputFilter();
    const post = postprocessReport(data as AssistReportOutput, input, filter, fp);
    const json = JSON.stringify(post.body);
    if (json.length > REPORT_JSON_MAX_CHARS) return 'output_too_large';
    Object.assign(state, { post, filter, model, promptVersion, json });
    return null;
  });
  if (!result.ok) return actionForFailures([result]);
  const post = state.post!;
  const nowMs = ctx.now();
  const now = nowSeconds(nowMs);
  const meta = { filter_version: FILTER_VERSION, d8_fp: fp.version, counts: post.meta, candidates: input.candidates.length, cases: input.digests.length };
  const settled = await settleOp(db, {
    opId: op.id,
    nowMs,
    extra: (token) => [
      db
        .prepare(
          `UPDATE assist_reports SET status = 'done', report_json = ?1, prompt_version = ?2, served_model = ?3, meta_json = ?4, lease_until = NULL,
                  updated_at = ?5, expires_at = ?6
            WHERE id = ?7 AND user_id = ?8 AND op_id = ?9 AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?9 AND settle_token = ?10)`,
        )
        .bind(state.json, state.promptVersion, state.model, JSON.stringify(meta).slice(0, 2048), now, now + ASSIST_LIMITS.retentionDays * 86_400, row.id, op.user_id, op.id, token),
      // 每人保留最近 10 版（§3.4）：寫入第 11 版時刪最舊的；進行中的不刪。
      db
        .prepare(
          `DELETE FROM assist_reports
            WHERE user_id = ?1 AND status IN ('done', 'failed')
              AND id NOT IN (SELECT id FROM assist_reports WHERE user_id = ?1 ORDER BY version DESC LIMIT ?2)
              AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?3 AND settle_token = ?4)`,
        )
        .bind(op.user_id, ASSIST_LIMITS.reportsKept, op.id, token),
      ...(post.safety !== 'none'
        ? [
            db
              .prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'wellbeing_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?1 AND settle_token = ?4)`)
              .bind(op.id, post.safety, ctx.userRef, token),
          ]
        : []),
      ...(post.meta.d8_hidden > 0
        ? [
            db
              .prepare(`INSERT INTO ops_events (kind, severity, detail_json) SELECT 'assist_d8_output', 'warn', ?1 WHERE EXISTS (SELECT 1 FROM ai_ops WHERE id = ?2 AND settle_token = ?3)`)
              .bind(JSON.stringify({ op_id: op.id, fields: post.meta.d8_hidden }), op.id, token),
          ]
        : []),
    ],
  });
  if (state.filter) await recordFiltered(ctx, state.filter);
  log('ai_settled', { op_id: op.id, task: op.task, settled, version: row.version, predictions_removed: post.meta.predictions_removed });
  return { kind: 'done' };
}
