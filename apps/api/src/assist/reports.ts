/**
 * /api/assist/reports*：學習報告（docs/design/learning-assistant.md §3、§4.1、§4.4）。負責：WP-C。
 * routes.ts 在最後呼叫 mountReportRoutes(assistRoutes)，所以登入的中介層、錯誤格式都和其他學習助手端點相同。
 *
 *   GET    /reports        版本列表（新到舊；只有中繼資料）                                     登入
 *   POST   /reports        產生新版本（10 點）→ 202                                              AI 核准＋開關
 *   GET    /reports/{id}   一個版本：設定、facts、AI 的報告＋程式排好的逐週計畫（前端輪詢這支）   登入
 *   DELETE /reports/{id}   刪除一個版本；進行中回 409                                            登入
 *
 * POST 的順序（§4.4「其他寫入端點的順序相同」）：開關、核准、AI 設定、D8 → 讀本體（≤ 32 KB；本機摘要 ≤ 16 KB，超過 413）→
 * 回饋的文字規則 → 考試日（已過 400）→ 上一版（based_on，預設最新一版完成的）→ 案例彙整、寫作批改、推薦候選（依 ref 重建）→
 * facts 與骨架 → 先預扣（每天 2 份是家族上限、同時只有一份進行中是部分唯一索引）→ 寫報告列（插不進去以 internal 退還、409）→
 * 排入 Queue（失敗退還、503）→ 202。所有輸入算好存進 input_json，consumer 只從它組請求。
 * 被撤銷 AI 核准的人仍然可以看、刪自己的報告。日誌只記 id、代碼與數字，不記回饋、摘要或報告內容。
 */
import {
  AI_ERROR_MESSAGES,
  AI_REFUND_REASONS,
  ASSIST_LIMITS,
  ASSIST_REPORT_STATUSES,
  GSAT_116_ENGLISH_DATE,
  assistDefaultTier,
  assistTargetLevel,
  checkAssistText,
  planSkeleton,
  taiwanToday,
  type AiRefundReason,
  type AssistReportAccepted,
  type AssistReportBody,
  type AssistReportDetail,
  type AssistReportFacts,
  type AssistReportSettings,
  type AssistReportStatus,
  type AssistReportSummary,
} from '@gsat/shared';
import type { Hono } from 'hono';
import { readJsonBody } from '../account/validate';
import { detectInjection } from '../ai/filter';
import { reserveOp, siteLimitsMicros, userLimits } from '../ai/guard';
import { reclaimStaleOps } from '../ai/housekeeping';
import { opsEvent, userRefFor } from '../ai/ledger';
import { reserveFailure } from '../ai/reserveErrors';
import { reserveMicros, taskConfig, taskModelsPriced } from '../ai/tasks';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { parseJson } from '../submissions/repo';
import { nowSeconds } from '../time';
import { rebuildCandidates } from './candidates';
import { loadCaseDigests, loadWritingStats } from './digests';
import { computeFacts } from './facts';
import { sessionUser, writeGate } from './gate';
import { refundWithAssistRef } from './refund';
import { previousDigest, type ReportInput } from './reportRequests';
import { createReportSchema, REPORT_BODY_MAX } from './reportSchemas';

/** input_json 的上限（assist_reports 的 CHECK）。 */
const INPUT_JSON_MAX_CHARS = 65_536;
const RETENTION_SECONDS = ASSIST_LIMITS.retentionDays * 86_400;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReportRow {
  id: string;
  user_id: number;
  version: number;
  based_on: string | null;
  status: AssistReportStatus;
  op_id: string | null;
  target_json: string;
  exam_date: string;
  feedback_text: string | null;
  input_json: string;
  report_json: string | null;
  failure: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

const REPORT_COLUMNS = `id, user_id, version, based_on, status, op_id, target_json, exam_date, feedback_text, input_json, report_json, failure,
  created_at, updated_at, expires_at`;

/** 每產生一版寫一筆的 ops 事件（版次的紀錄；只有假名與版次，建立時就標成已確認）。 */
const REPORT_VERSION_MARK = 'assist_report_version';

/**
 * 下一版的版次（§3.4：依使用者遞增 1、2、3…）的 SQL 運算式：取「還在的報告」與「版次紀錄」（ops_events，學生刪不掉）兩者
 * 最大的版次 + 1，所以刪掉最新一版之後不會重用它的版次。參數是佔位符的名字。
 */
function nextVersionSql(userParam: string, refParam: string): string {
  return `(MAX(COALESCE((SELECT MAX(version) FROM assist_reports WHERE user_id = ${userParam}), 0),
               COALESCE((SELECT MAX(CAST(json_extract(detail_json, '$.version') AS INTEGER)) FROM ops_events
                          WHERE kind = '${REPORT_VERSION_MARK}' AND json_extract(detail_json, '$.user_ref') = ${refParam}), 0)) + 1)`;
}

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** target_json → 設定（讀不懂的欄位用預設值；舊資料或測試資料也不讓頁面壞掉）。 */
function settingsOf(row: Pick<ReportRow, 'target_json' | 'exam_date'>): AssistReportSettings | null {
  const raw = parseJson<Record<string, unknown>>(row.target_json);
  if (!raw) return null;
  const t = (raw['target'] ?? raw) as Record<string, unknown>;
  const standard = t['standard'];
  const target: AssistReportSettings['target'] | null =
    standard === 'top' || standard === 'front' || standard === 'mean'
      ? { standard }
      : typeof t['level'] === 'number' && t['level'] >= 1 && t['level'] <= 15
        ? { level: t['level'] }
        : null;
  const weekly = raw['weekly'];
  if (!target || (weekly !== 'le2' && weekly !== '2to4' && weekly !== '4to6' && weekly !== '6plus')) return null;
  const tier = raw['practice_tier'];
  const dates = raw['school_exam_dates'];
  return {
    target,
    practice_tier: tier === 'basic' || tier === 'advanced' || tier === 'top' ? tier : null,
    weekly,
    school_exam_dates: Array.isArray(dates) ? dates.filter((d): d is string => typeof d === 'string') : [],
    exam_date: row.exam_date,
  };
}

function failureOf(value: string | null): AiRefundReason | null {
  if (value === null) return null;
  return (AI_REFUND_REASONS as readonly string[]).includes(value) ? (value as AiRefundReason) : 'internal';
}

function toSummary(row: ReportRow): AssistReportSummary {
  const settings = settingsOf(row);
  return {
    id: row.id,
    version: row.version,
    based_on: row.based_on,
    status: (ASSIST_REPORT_STATUSES as readonly string[]).includes(row.status) ? row.status : 'failed',
    failure: row.status === 'failed' ? failureOf(row.failure) : null,
    created_at: row.created_at,
    exam_date: row.exam_date,
    target_level: settings ? assistTargetLevel(settings.target) : null,
  };
}

/** 報告內容：完成的才回，而且要有逐週計畫（形狀不對回 null，畫面顯示「這一版的內容讀不到」）。 */
function reportOf(row: ReportRow): AssistReportBody | null {
  if (row.status !== 'done') return null;
  const body = parseJson<AssistReportBody>(row.report_json);
  return body && typeof body.overview_zh === 'string' && Array.isArray(body.plan?.weeks) ? body : null;
}

function factsOf(row: ReportRow): AssistReportFacts | null {
  const input = parseJson<{ facts?: AssistReportFacts }>(row.input_json);
  const facts = input?.facts;
  return facts && Array.isArray(facts.sections) ? facts : null;
}

function toDetail(row: ReportRow): AssistReportDetail {
  return {
    ...toSummary(row),
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    settings: settingsOf(row),
    feedback: row.feedback_text,
    facts: factsOf(row),
    report: reportOf(row),
  };
}

async function findReport(db: D1Database, userId: number, id: string, now: number): Promise<ReportRow | null> {
  if (!UUID_RE.test(id)) return null;
  return db.prepare(`SELECT ${REPORT_COLUMNS} FROM assist_reports WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3`).bind(id, userId, now).first<ReportRow>();
}

/** 上一版：指定的 based_on（必須是自己的、完成的），否則最新一版完成的。 */
async function previousReport(db: D1Database, userId: number, basedOn: string | null | undefined, now: number): Promise<ReportRow | null> {
  if (basedOn) {
    const row = await findReport(db, userId, basedOn, now);
    if (!row) throw new ApiError(404, 'not_found', '找不到要依據的那一版報告');
    if (row.status !== 'done') throw new ApiError(409, 'conflict', '那一版報告還沒有完成');
    return row;
  }
  return db
    .prepare(`SELECT ${REPORT_COLUMNS} FROM assist_reports WHERE user_id = ?1 AND status = 'done' AND expires_at > ?2 ORDER BY version DESC LIMIT 1`)
    .bind(userId, now)
    .first<ReportRow>();
}

/** input_json 太大時先省略本機摘要（facts 已經包含要用的數字），再縮短代表案例的摘要；還是太大就拒收。 */
function inputJsonOf(input: ReportInput): string {
  let json = JSON.stringify(input);
  if (json.length <= INPUT_JSON_MAX_CHARS) return json;
  const { summary: _summary, ...rest } = input;
  json = JSON.stringify(rest);
  if (json.length <= INPUT_JSON_MAX_CHARS) return json;
  json = JSON.stringify({ ...rest, digests: rest.digests.map((d) => ({ ...d, summary: '' })) });
  if (json.length <= INPUT_JSON_MAX_CHARS) return json;
  throw new ApiError(413, 'payload_too_large', '送出的資料太多，請稍後再試');
}

export function mountReportRoutes(app: Hono<AppEnv>): void {
  app.get('/reports', async (c) => {
    const user = await sessionUser(c);
    const res = await c.env.DB.prepare(`SELECT ${REPORT_COLUMNS} FROM assist_reports WHERE user_id = ?1 AND expires_at > ?2 ORDER BY version DESC LIMIT 50`)
      .bind(user.id, nowSeconds())
      .all<ReportRow>();
    return c.json({ reports: res.results.map(toSummary) });
  });

  app.get('/reports/:id', async (c) => {
    const user = await sessionUser(c);
    const row = await findReport(c.env.DB, user.id, c.req.param('id'), nowSeconds());
    if (!row) throw new ApiError(404, 'not_found', '找不到這一版報告');
    return c.json(toDetail(row));
  });

  app.delete('/reports/:id', async (c) => {
    const user = await sessionUser(c);
    const id = c.req.param('id');
    const db = c.env.DB;
    if (!UUID_RE.test(id)) throw new ApiError(404, 'not_found', '找不到這一版報告');
    const res = await db.prepare(`DELETE FROM assist_reports WHERE id = ?1 AND user_id = ?2 AND status NOT IN ('queued', 'running')`).bind(id, user.id).run();
    if ((res.meta.changes ?? 0) === 1) return c.body(null, 204);
    const exists = await db.prepare('SELECT 1 AS x FROM assist_reports WHERE id = ?1 AND user_id = ?2').bind(id, user.id).first<{ x: number }>();
    if (!exists) throw new ApiError(404, 'not_found', '找不到這一版報告');
    throw new ApiError(409, 'conflict', '報告產生中，完成後再刪');
  });

  app.post('/reports', async (c) => {
    const { user, config } = await writeGate(c);
    const body = await readJsonBody(c, createReportSchema, REPORT_BODY_MAX);
    if (new TextEncoder().encode(JSON.stringify(body.summary)).byteLength > ASSIST_LIMITS.summaryMaxBytes) {
      throw new ApiError(413, 'payload_too_large', '作答紀錄的摘要太大');
    }
    const db = c.env.DB;
    const nowMs = Date.now();
    const now = nowSeconds(nowMs);
    const today = taiwanToday(nowMs);

    // 回饋（選填）：學生文字的共同處理（正規化、遮個資、長度、字元與標籤）。
    let feedback: string | null = null;
    if (typeof body.feedback === 'string' && body.feedback.trim() !== '') {
      const r = checkAssistText(body.feedback, ASSIST_LIMITS.feedbackMaxChars);
      if (!r.ok) {
        const p = r.problems[0]!;
        throw new ApiError(400, 'assist_input_invalid', '回饋的內容不符合規則', { reason: p.code, field: 'feedback' });
      }
      feedback = r.value;
    }
    const examDate = body.exam_date ?? GSAT_116_ENGLISH_DATE;
    const schoolDates = [...new Set(body.school_exam_dates ?? [])].sort();
    const skeleton = planSkeleton(today, examDate, { weekly: body.weekly, school_exam_dates: schoolDates });
    if (!skeleton) throw new ApiError(400, 'bad_request', '考試日已經過了，請改成之後的日期');

    const tc = taskConfig('assist_report', config);
    if (!taskModelsPriced(tc)) {
      await opsEvent(db, 'ai_model_not_priced', 'error', { task: tc.task, models: tc.calls.map((x) => x.model) });
      throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
    }

    const prev = await previousReport(db, user.id, body.based_on, now);
    const prevBody = prev ? parseJson<AssistReportBody>(prev.report_json) : null;
    const prevFacts = prev ? factsOf(prev) : null;
    const level = assistTargetLevel(body.target);
    const tier = body.practice_tier ?? assistDefaultTier(level);
    const cases = await loadCaseDigests(db, user.id, now, prev?.created_at ?? null);
    const writing = await loadWritingStats(db, user.id, cases.writingSkills);
    const facts0Writing = { translation: writing.stats.translation.length === 0, essay: writing.stats.essay.length === 0 };
    const candidates = await rebuildCandidates(c.var.siteData, body.candidates, {
      weakWritingCodes: writing.stats.weakCodes,
      submittedWriting: writing.submitted,
      tier,
      // 寫作候選一律加（沒有寫作資料時更需要先寫一篇）；兩種都加。
      wantTranslation: true,
      wantEssay: true,
    });
    const facts = computeFacts({
      summary: body.summary,
      target: body.target,
      today,
      examDate,
      cases: cases.stats,
      writing: writing.stats,
      previous: prev
        ? {
            id: prev.id,
            version: prev.version,
            createdAt: prev.created_at,
            facts: prevFacts,
            recommendations: (prevBody?.recommendations ?? []).map((r) => ({ ref: r.ref, title: r.candidate?.title ?? '' })),
          }
        : null,
    });
    const injection = [...new Set([...cases.injection, ...(feedback ? detectInjection(feedback) : [])])];
    const settings: AssistReportSettings = { target: body.target, practice_tier: body.practice_tier ?? null, weekly: body.weekly, school_exam_dates: schoolDates, exam_date: examDate };
    const ref = await userRefFor(config.auth.ledgerSalt, user.id);
    const versionRow = await db.prepare(`SELECT ${nextVersionSql('?1', '?2')} AS v`).bind(user.id, ref).first<{ v: number }>();
    const version = versionRow?.v ?? 1;
    const input: ReportInput = {
      v: 1,
      version,
      settings,
      facts,
      skeleton,
      case_skills: cases.skills,
      digests: cases.digests,
      candidates,
      previous: prev ? { id: prev.id, version: prev.version, digest: previousDigest(prevBody) } : null,
      injection,
      summary: body.summary,
    };
    const inputJson = inputJsonOf(input);
    const targetJson = JSON.stringify({ target: body.target, practice_tier: body.practice_tier ?? null, weekly: body.weekly, school_exam_dates: schoolDates });

    // 先預扣，再寫報告列（同作文「先預扣、再改提交狀態」）。
    try {
      await reclaimStaleOps(db, nowMs);
    } catch (err) {
      console.error('回收卡住的預扣失敗（不影響這次請求）', err);
    }
    const reportId = crypto.randomUUID();
    const opId = crypto.randomUUID();
    const reserved = await reserveOp(db, {
      opId,
      userId: user.id,
      task: tc.task,
      refId: reportId,
      points: tc.points,
      usdMicros: reserveMicros(tc),
      family: tc.family,
      limits: userLimits(config, user),
      site: siteLimitsMicros(config),
      nowMs,
    });
    if (!reserved.ok) throw await reserveFailure(db, reserved.code, ref, tc.task, nowMs);
    const op = { id: opId, user_id: user.id, task: tc.task, ref_id: reportId };
    let inserted = false;
    try {
      const statements = [
        db
          .prepare(
            `INSERT INTO assist_reports (id, user_id, version, based_on, status, op_id, target_json, exam_date, feedback_text, input_json, meta_json, created_at, updated_at, expires_at)
             SELECT ?1, ?2, ${nextVersionSql('?2', '?12')}, ?3, 'queued', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11
              WHERE NOT EXISTS (SELECT 1 FROM assist_reports WHERE user_id = ?2 AND status IN ('queued', 'running'))`,
          )
          .bind(reportId, user.id, prev?.id ?? null, opId, targetJson, examDate, feedback, inputJson, JSON.stringify({ injection: injection.length > 0, no_writing: facts0Writing }), now, now + RETENTION_SECONDS, ref),
      ];
      // 版次的紀錄（學生刪不掉；只有假名與版次）：之後就算刪掉這一版，下一版也不會重用它的版次。
      if (ref) {
        statements.push(
          db
            .prepare(
              `INSERT INTO ops_events (kind, severity, detail_json, created_at, acked_at)
               SELECT ?1, 'info', json_object('user_ref', ?2, 'version', version), ?3, ?3 FROM assist_reports WHERE id = ?4 AND user_id = ?5`,
            )
            .bind(REPORT_VERSION_MARK, ref, now, reportId, user.id),
        );
      }
      const res = await db.batch(statements);
      inserted = res[0]?.meta.changes === 1;
    } catch (err) {
      console.error('寫入報告失敗，退還點數', opId, err);
    }
    if (!inserted) {
      // 用 refundWithAssistRef：寫入其實成功、只是回應丟了時，報告改 failed（否則這一列永遠 queued，之後不能再產生、也不能刪）；
      // 沒寫進去時它的附帶語句什麼都不改。
      await refundWithAssistRef(db, op, 'internal', Date.now()).catch((err) => console.error('退還失敗，交給 housekeeping 回收', opId, err));
      throw new ApiError(409, 'conflict', '已經有一份報告正在產生，完成後再試');
    }
    if (injection.length > 0) {
      try {
        await db.prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) VALUES (?1, 'injection_flag', ?2, ?3)`).bind(opId, injection.join(',').slice(0, 200), ref).run();
      } catch (err) {
        console.error('寫入注入旗標的安全事件失敗', err);
      }
    }
    log('ai_task_queued', { op_id: opId, task: tc.task, report_id: reportId, version });
    try {
      await c.env.AI_QUEUE!.send({ op_id: opId });
    } catch (err) {
      console.error('排入 Queue 失敗，退還點數', opId, err);
      await refundWithAssistRef(db, op, 'internal', Date.now()).catch((e) => console.error('退還失敗，交給 housekeeping 回收', opId, e));
      throw new ApiError(503, 'not_configured', '送出失敗，點數已退還，請稍後再試');
    }
    const stored = await db.prepare('SELECT version FROM assist_reports WHERE id = ?1 AND user_id = ?2').bind(reportId, user.id).first<{ version: number }>();
    const accepted: AssistReportAccepted = { op_id: opId, report_id: reportId, version: stored?.version ?? version, status: 'queued', points: tc.points };
    return c.json(accepted, 202);
  });
}
