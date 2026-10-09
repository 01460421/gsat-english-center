/**
 * /api/ai/*：任務型 AI 端點（ARCHITECTURE §3.4、§6、§10.4）。負責：後端 AI A2。
 * （POST /api/ai/apply 例外，在 src/account/apply.ts，由 A1 負責。）
 *
 * 全部走 Queue＋輪詢：驗證輸入上限 → 淨化學生文字並寫回 → 回收卡住的預扣（housekeeping.ts）→ 一句 SQL 原子預扣
 * （DB_SCHEMA §3.7）→ submissions.status 改 queued／ocr_queued（條件式，防止同一份提交同時送兩次；注入事件寫在
 * 同一個 batch）→ AI_QUEUE.send({op_id}) → 202。預扣之後任何一步失敗都退還並把提交改回原狀態，預扣不會卡住。
 * 預扣失敗回 429（個人額度）或 503（全站）＋AI_RESERVE_ERROR_CODES 之一，message 是 AI_ERROR_MESSAGES 的中文；
 * 每日退還上限（guard.ts 的 AI_REFUNDS_PER_DAY）回 429 rate_limited，第一次擋下時寫 ops_events。
 * 提示詞、評分基準、schema、模型、effort 都在伺服器端（tasks.ts、prompts/）；前端只送 submission_id。
 *
 *   GET  /api/ai/quota                AiQuotaResponse（requireUser）
 *   POST /api/ai/translation-grade    AiTaskRequest → 202 AiTaskAccepted（requireAiApproved；3 點）
 *   POST /api/ai/essay-grade          AiTaskRequest → 202（打字，或已確認的 OCR 文字；7 點）
 *   POST /api/ai/essay-ocr            AiTaskRequest → 202（需已上傳照片；2 點）
 *   GET  /api/ai/ops/:id              AiOpResponse（requireUser；只看得到自己的，別人的 404）
 */
import {
  AI_ERROR_MESSAGES,
  AI_TASK_POINTS,
  ESSAY_FAMILY_TASKS,
  ESSAY_MAX_CHARS,
  ESSAY_MAX_WORDS,
  TRANSLATION_SENTENCE_MAX_CHARS,
  countEnglishWords,
  countParagraphs,
  type AiOpResponse,
  type AiQuotaResponse,
  type AiReserveErrorCode,
  type AiTask,
  type AiTaskAccepted,
  type EssayBody,
  type SubmissionStatus,
  type TranslationBody,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import * as z from 'zod/v4';
import { approvalSummary } from '../account/approval';
import { readJsonBody } from '../account/validate';
import { getSessionUser, requireAiApproved, requireUser, type SessionUser } from '../auth/session';
import { loadConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { findSubmission, parseJson, requireSubmission, type SubmissionRow } from '../submissions/repo';
import { nowSeconds } from '../time';
import { getWritingGroup, type WritingGroup } from './bank';
import { detectInjection, sanitizeStudentText } from './filter';
import { AI_REFUNDS_PER_DAY, refundOp, reserveOp, siteLimitsMicros, UNLIMITED, usageSnapshot, userLimits, type ReserveFailureCode } from './guard';
import { reclaimStaleOps } from './housekeeping';
import { opsEvent, userRefFor } from './ledger';
import { reserveMicros, taskConfig, taskModelsPriced } from './tasks';

export const aiRoutes = new Hono<AppEnv>();

/** 預扣失敗代碼 → HTTP 狀態（個人 429、全站 503；設計文件 §2.2）。 */
const RESERVE_STATUS: Record<AiReserveErrorCode, 429 | 503> = {
  quota_day: 429,
  quota_month: 429,
  daily_limit: 429,
  busy: 429,
  ai_paused: 503,
  site_budget: 503,
};

/** AI 任務請求本體的上限（只有 submission_id）。 */
const TASK_REQUEST_MAX_BYTES = 4 * 1024;
const taskRequestSchema = z.object({ submission_id: z.string().min(1).max(64) });

const REFUND_LIMIT_MESSAGE = `今天 AI 無法完成的次數太多了（照片看不出是作文、AI 無法批改等，每天最多 ${AI_REFUNDS_PER_DAY} 次），請明天再試`;

async function sessionUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  return user;
}

/** 讀 { submission_id }（只收 application/json、最多 4 KB；邊讀邊數，不會把超大本體整個讀進記憶體）。 */
async function readSubmissionId(c: Context<AppEnv>): Promise<string> {
  return (await readJsonBody(c, taskRequestSchema, TASK_REQUEST_MAX_BYTES)).submission_id;
}

/** 預扣失敗 → 錯誤回應。每日退還上限第一次擋下時寫 ops_events（同一人同一天只寫一次）。 */
async function reserveFailure(db: D1Database, code: ReserveFailureCode, ref: string | null, task: AiTask, nowMs: number): Promise<ApiError> {
  if (code !== 'refund_limit') return new ApiError(RESERVE_STATUS[code], code, AI_ERROR_MESSAGES[code]);
  const since = nowSeconds(nowMs) - 86_400;
  const seen = ref
    ? await db
        .prepare(`SELECT 1 AS x FROM ops_events WHERE kind = 'ai_refund_limit' AND created_at > ?1 AND json_extract(detail_json, '$.user_ref') = ?2 LIMIT 1`)
        .bind(since, ref)
        .first<{ x: number }>()
        .catch(() => null)
    : null;
  if (!seen) await opsEvent(db, 'ai_refund_limit', 'warn', { user_ref: ref, task, limit: AI_REFUNDS_PER_DAY });
  return new ApiError(429, 'rate_limited', REFUND_LIMIT_MESSAGE);
}

/** 下次重置時間（台灣 00:00，ISO 8601 帶 +08:00）。 */
function resetsAt(nowMs: number): { day: string; month: string } {
  const tw = new Date(nowMs + 8 * 3600_000);
  const y = tw.getUTCFullYear();
  const m = tw.getUTCMonth();
  const d = tw.getUTCDate();
  const fmt = (dt: Date) => `${dt.toISOString().slice(0, 10)}T00:00:00+08:00`;
  return { day: fmt(new Date(Date.UTC(y, m, d + 1))), month: fmt(new Date(Date.UTC(y, m + 1, 1))) };
}

/** 這次批改要寫回提交的內容（淨化後的文字、程式算的字數與段數）。 */
interface Prepared {
  newStatus: SubmissionStatus;
  bodyJson: string | null;
  wordCount: number | null;
  paragraphs: number | null;
  injection: string[];
  invisibleRemoved: number;
}

/** 各任務的狀態與內容檢查；不符合回 409 conflict 或 400。 */
async function prepare(c: Context<AppEnv>, task: AiTask, sub: SubmissionRow, group: WritingGroup): Promise<Prepared> {
  if (task === 'translation_grade') {
    if (sub.kind !== 'translation') throw new ApiError(409, 'conflict', '這份提交不是中譯英');
    if (!group.ai_gradable) throw new ApiError(409, 'conflict', '這個題組的格式（不是 2 句、每句 4 分）不支援 AI 批改');
    if (sub.status !== 'draft' && sub.status !== 'failed') throw new ApiError(409, 'conflict', '這份提交目前不能送出批改');
    const body = parseJson<TranslationBody>(sub.body_json);
    let removed = 0;
    const items = group.items.map((item) => {
      const raw = body?.items.find((i) => i.item_id === item.item_id)?.text ?? '';
      const s = sanitizeStudentText(raw);
      removed += s.invisibleRemoved;
      return { item_id: item.item_id, text: s.text };
    });
    if (items.some((i) => i.text.trim() === '')) throw new ApiError(400, 'bad_request', '每一句都要作答才能送出批改');
    if (items.some((i) => i.text.length > TRANSLATION_SENTENCE_MAX_CHARS)) {
      throw new ApiError(413, 'payload_too_large', `每句譯文最多 ${TRANSLATION_SENTENCE_MAX_CHARS} 字元`);
    }
    return {
      newStatus: 'queued',
      bodyJson: JSON.stringify({ items }),
      wordCount: null,
      paragraphs: null,
      injection: detectInjection(items.map((i) => i.text).join('\n')),
      invisibleRemoved: removed,
    };
  }
  if (sub.kind !== 'essay') throw new ApiError(409, 'conflict', '這份提交不是作文');
  if (task === 'essay_ocr') {
    if (sub.input_mode !== 'photo') throw new ApiError(409, 'conflict', '打字作文不需要辨識照片');
    if (sub.status !== 'draft' && sub.status !== 'failed') throw new ApiError(409, 'conflict', '這份提交目前不能辨識照片');
    // 過期（超過 24 小時、還沒被清掉）的照片不算。
    const photos = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM submission_photo_temp WHERE submission_id = ?1 AND user_id = ?2 AND expires_at >= ?3')
      .bind(sub.id, sub.user_id, nowSeconds())
      .first<{ n: number }>();
    if ((photos?.n ?? 0) === 0) throw new ApiError(409, 'conflict', '請先上傳照片');
    return { newStatus: 'ocr_queued', bodyJson: null, wordCount: null, paragraphs: null, injection: [], invisibleRemoved: 0 };
  }
  // essay_grade：打字（draft、failed），或照片模式已確認文字（confirmed，或確認後批改失敗的 failed）。
  const confirmed = sub.ocr_diff_json !== null;
  const allowed = sub.input_mode === 'typed' ? sub.status === 'draft' || sub.status === 'failed' : sub.status === 'confirmed' || (sub.status === 'failed' && confirmed);
  if (!allowed) throw new ApiError(409, 'conflict', sub.input_mode === 'photo' ? '請先完成照片辨識並確認文字' : '這份提交目前不能送出批改');
  const body = parseJson<EssayBody>(sub.body_json);
  const s = sanitizeStudentText(body?.text ?? '');
  if (s.text.trim() === '') throw new ApiError(400, 'bad_request', '作文是空的');
  const words = countEnglishWords(s.text);
  if (s.text.length > ESSAY_MAX_CHARS || words > ESSAY_MAX_WORDS) throw new ApiError(413, 'payload_too_large', `作文最多 ${ESSAY_MAX_WORDS} 個英文單字且 ${ESSAY_MAX_CHARS} 字元`);
  return {
    newStatus: 'queued',
    bodyJson: JSON.stringify({ text: s.text, plan: body?.plan ?? null }),
    wordCount: words,
    paragraphs: countParagraphs(s.text, sub.input_mode === 'photo'),
    injection: detectInjection(s.text),
    invisibleRemoved: s.invisibleRemoved,
  };
}

function taskHandler(task: AiTask) {
  return async (c: Context<AppEnv>) => {
    const config = loadConfig(c.env);
    if (!config.ai.configured || !c.env.AI_QUEUE) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
    const user = await sessionUser(c);
    const db = c.env.DB;
    const sub = await requireSubmission(db, user.id, await readSubmissionId(c));
    const group = getWritingGroup(sub.group_id);
    if (!group) throw new ApiError(409, 'conflict', '找不到這份提交的題目');
    const tc = taskConfig(task, config);
    if (!taskModelsPriced(tc)) {
      // §6.2 第 1 條：模型不在價格表就不預扣、不呼叫（fail closed），並告警。
      await opsEvent(db, 'ai_model_not_priced', 'error', { task, models: tc.calls.map((x) => x.model) });
      throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
    }
    const prepared = await prepare(c, task, sub, group);
    const ref = await userRefFor(config.auth.ledgerSalt, user.id);

    // 卡住的預扣（排入 Queue 前 isolate 被終止等）先回收，才不會佔住同時任務名額與全站預算（housekeeping.ts）。
    const nowMs = Date.now();
    try {
      await reclaimStaleOps(db, nowMs);
    } catch (err) {
      console.error('回收卡住的預扣失敗（不影響這次請求）', err);
    }

    // 第 3 步：原子預扣點數與最壞情況美元。
    const opId = crypto.randomUUID();
    const reserved = await reserveOp(db, {
      opId,
      userId: user.id,
      task,
      refId: sub.id,
      points: tc.points,
      usdMicros: reserveMicros(tc),
      family: tc.family,
      limits: userLimits(config, user),
      site: siteLimitsMicros(config),
      nowMs,
    });
    if (!reserved.ok) throw await reserveFailure(db, reserved.code, ref, task, nowMs);

    /** 預扣之後的步驟失敗：退還、提交改回原狀態（只改還指向這個操作的提交），回 500。退還本身失敗只記 log。 */
    const undo = async (err: unknown): Promise<never> => {
      console.error('送出 AI 任務失敗，退還點數', opId, err);
      try {
        await refundOp(db, {
          opId,
          reason: 'internal',
          nowMs: Date.now(),
          extra: (token) => [
            db
              .prepare(
                `UPDATE submissions SET status = ?1, lease_until = NULL WHERE id = ?2 AND user_id = ?3 AND op_id = ?4 AND status = ?5
                   AND EXISTS (SELECT 1 FROM ai_ops WHERE id = ?4 AND settle_token = ?6)`,
              )
              .bind(sub.status, sub.id, user.id, opId, prepared.newStatus, token),
          ],
        });
      } catch (refundErr) {
        // 退還也失敗：30 分鐘後由 housekeeping 回收（提交會變成 failed、refund_reason=expired）。
        console.error('退還失敗，交給 housekeeping 回收', opId, refundErr);
      }
      throw new ApiError(500, 'internal_error', '送出失敗，點數已退還，請稍後再試');
    };

    // 第 4 步：條件式更新提交（狀態沒被別的請求改掉才成功），同時清掉上一次失敗留下的評分紀錄；
    // 注入事件寫在同一個 batch（交易），只有提交真的改成這個操作時才寫。
    const now = nowSeconds(nowMs);
    let update: D1Result | undefined;
    try {
      [update] = await db.batch([
        db
          .prepare(
            `UPDATE submissions SET status = ?1, op_id = ?2, lease_until = NULL, tries = 0,
                    body_json = COALESCE(?3, body_json), word_count = COALESCE(?4, word_count), paragraphs = COALESCE(?5, paragraphs),
                    injection_flag = CASE WHEN ?6 = 1 THEN 1 ELSE injection_flag END, updated_at = ?7
              WHERE id = ?8 AND user_id = ?9 AND status = ?10`,
          )
          .bind(prepared.newStatus, opId, prepared.bodyJson, prepared.wordCount, prepared.paragraphs, prepared.injection.length > 0 ? 1 : 0, now, sub.id, user.id, sub.status),
        db
          .prepare(
            `DELETE FROM gradings WHERE submission_id = ?1 AND user_id = ?2 AND role <> 'self'
               AND EXISTS (SELECT 1 FROM submissions WHERE id = ?1 AND user_id = ?2 AND op_id = ?3)`,
          )
          .bind(sub.id, user.id, opId),
        ...(prepared.injection.length > 0
          ? [
              db
                .prepare(
                  `INSERT INTO ai_safety_events (op_id, kind, category, user_ref)
                   SELECT ?1, 'injection_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM submissions WHERE id = ?4 AND user_id = ?5 AND op_id = ?1)`,
                )
                .bind(opId, prepared.injection.join(',').slice(0, 200), ref, sub.id, user.id),
            ]
          : []),
      ]);
    } catch (err) {
      return undo(err);
    }
    if (update?.meta.changes !== 1) {
      await refundOp(db, { opId, reason: 'internal', nowMs });
      throw new ApiError(409, 'conflict', '這份提交的狀態剛剛改變了，請重新整理');
    }
    // 只記數量，不記內容（§6.2 第 12 條）。
    console.log(JSON.stringify({ event: 'ai_task_queued', op_id: opId, task, invisible_removed: prepared.invisibleRemoved, injection: prepared.injection.length > 0 }));

    try {
      await c.env.AI_QUEUE.send({ op_id: opId });
    } catch (err) {
      return undo(err);
    }
    const body: AiTaskAccepted = { op_id: opId, submission_id: sub.id, status: prepared.newStatus };
    return c.json(body, 202);
  };
}

aiRoutes.get('/quota', requireUser(), async (c) => {
  const config = loadConfig(c.env);
  const user = await sessionUser(c);
  const nowMs = Date.now();
  const limits = userLimits(config, user);
  // 名額的算法只有一份（A1 的 approvalSummary：只算學生、刪除中的不算）。
  const [snap, approval] = await Promise.all([usageSnapshot(c.env.DB, user.id, ESSAY_FAMILY_TASKS, nowMs), approvalSummary(c.env, config)]);
  const site = siteLimitsMicros(config);
  const body: AiQuotaResponse = {
    ai_status: user.aiStatus,
    tier: user.aiTier,
    points: { day_used: snap.dayPoints, day_limit: limits.capDay, month_used: snap.monthPoints, month_limit: limits.capMonth },
    essays: { day_used: snap.familyToday, day_limit: limits.familyCap === 0 ? UNLIMITED : limits.familyCap },
    concurrent: { active: snap.active, limit: limits.capConc },
    site: {
      paused: snap.paused,
      budget_available: snap.siteDaySettled + snap.siteReserved < site.day && snap.siteMonthSettled + snap.siteReserved < site.month,
    },
    approval,
    resets_at: resetsAt(nowMs),
    task_points: { ...AI_TASK_POINTS },
  };
  return c.json(body);
});

aiRoutes.post('/translation-grade', requireAiApproved, taskHandler('translation_grade'));
aiRoutes.post('/essay-grade', requireAiApproved, taskHandler('essay_grade'));
aiRoutes.post('/essay-ocr', requireAiApproved, taskHandler('essay_ocr'));

aiRoutes.get('/ops/:id', requireUser(), async (c) => {
  const user = await sessionUser(c);
  const op = await c.env.DB.prepare(
    `SELECT id, task, status, ref_id, points_reserved, points_charged, refund_reason, created_at, settled_at
       FROM ai_ops WHERE id = ?1 AND user_id = ?2`,
  )
    .bind(c.req.param('id'), user.id)
    .first<{
      id: string;
      task: AiTask;
      status: AiOpResponse['status'];
      ref_id: string | null;
      points_reserved: number;
      points_charged: number | null;
      refund_reason: AiOpResponse['refund_reason'];
      created_at: number;
      settled_at: number | null;
    }>();
  if (!op) throw new ApiError(404, 'not_found', '找不到這個 AI 任務');
  const sub = op.ref_id ? await findSubmission(c.env.DB, user.id, op.ref_id) : null;
  const body: AiOpResponse = {
    op_id: op.id,
    task: op.task,
    status: op.status,
    submission_id: sub ? sub.id : null,
    submission_status: sub ? sub.status : null,
    points_reserved: op.points_reserved,
    points_charged: op.points_charged,
    refund_reason: op.refund_reason,
    created_at: op.created_at,
    settled_at: op.settled_at,
  };
  return c.json(body);
});
