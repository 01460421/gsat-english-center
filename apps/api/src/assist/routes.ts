/**
 * /api/assist/*：學習助手的案例、解析與追問（docs/design/learning-assistant.md §4.1、§4.4）。負責：WP-A2。
 * 照片與轉錄的端點是 WP-A3、報告的端點是 WP-C（reports.ts，掛在這個檔的最後）。
 *
 *   GET    /cases?cursor=&section=        案例列表（新到舊，每頁 20）＋各錯因的案例數                 登入
 *   POST   /cases                         建立案例（站內來源同步讀題目檔、判定對錯；打字直接 ready；拍照建立空案例）   AI 核准＋開關
 *   GET    /cases/{id}                    詳情（題目、全部 turn、進行中的任務；前端輪詢這支）           登入
 *   PATCH  /cases/{id}                    懂了嗎、這則有錯、筆記                                        登入
 *   DELETE /cases/{id}                    刪除（有進行中的 turn 回 409）                                 登入
 *   PUT    /cases/{id}/question           修改學生提供的題目（ocr_ready、ready、failed 才能改）         AI 核准＋開關
 *   POST   /cases/{id}/analyze            解析（6 點起；共用快取命中 0 點、回 200）→ 202                AI 核准＋開關
 *   POST   /cases/{id}/followups          追問（3 點）→ 202                                              AI 核准＋開關
 *   POST   /cases/{id}/photos?ord=1|2     題目照片（multipart，欄位 photo；只限拍照的題目、draft）        AI 核准＋拍照開關（WP-A3）
 *   DELETE /cases/{id}/photos             刪掉這一題的照片（轉錄進行中 409）                             登入（WP-A3）
 *   POST   /cases/{id}/ocr                轉錄（2 點）→ 202；照片在結算時刪除                             AI 核准＋拍照開關（WP-A3）
 *   GET    /reports、POST /reports、GET /reports/{id}、DELETE /reports/{id}   學習報告（WP-C，reports.ts）
 *
 * 拍照的題目（WP-A3，§1.6、§2.5）：建立空案例（draft）→ 上傳 1–2 張照片 → 轉錄（ocr_queued → ocr_ready）→ 學生確認
 * （PUT …/question：被隱藏的區塊不能送回、要問的題不能還有 [[?]]、其他區塊的 [[?]] 換成 [unclear]、轉錄的文字只留統計、
 * 照片再刪一次）→ 解析。轉錄退還時案例回到 draft（內容造成的退還照片已刪，要重拍）。
 *
 * 「AI 核准＋開關」的檢查順序（§4.4）：登入 → 開關（AI_ASSISTANT 是 on，或 admin 而這位是管理員；否則 503，公開端點不透露有預覽）
 * → AI 核准（未核准 403、待同意 403 consent_required）→ AI 已設定 → D8 指紋可用（壞掉 503）→ 讀本體 → 其餘。
 * 讀、改「懂了嗎」、刪除只要登入：被撤銷 AI 核准的人、開關關著的時候，學生仍然可以看與刪自己的案例。
 * 送出解析與追問：先預扣、再寫 turn（同作文「先預扣、再改提交狀態」）；寫不進去（競爭）就以 internal 退還；排入 Queue 失敗也退還。
 * 日誌只記 id、代碼與數字，不記題目、疑問、追問或解析（§4.16）。
 *
 * 出版社題（docs/design/weak-paper.md §9.6，publisher.ts）：授權已經結束的案例，列表帶 source_ended、詳情遮住題目與解析，
 * 解析與追問回 assist_source_unavailable（不扣點）。
 *
 * 科目（docs/design/assistant-subjects.md §2.3、§7）：拍照、貼上的建立案例多收 subject（白名單，沒帶＝英文；寫進 ref_json，
 * 英文的 ref_json 和以前一樣不寫）與國文的 related_case_id（「同一份題目問另一部分」：同一位使用者、同一科、已確認題目）。
 * 國文的寫入端點（建立、確認、解析、追問、照片、轉錄）另外檢查：AI_ASSISTANT_SUBJECTS 對這位使用者開放（拍照另外要
 * AI_ASSISTANT_SUBJECTS_PHOTO），否則 503 not_configured（同現行慣例，不透露預覽）；國文的 D8 指紋讀不到也是 503。兩者都在預扣之前。
 * 題數一律用 assistItemCount；解析的 turn 在 meta_json 存 {subject, kind, items}，consumer 用同一組算任務設定。
 * 列表多收 ?subject=，每列帶 subject；不帶 subject 時列表是全部科目，但 error_counts 只算英文（加強卷不吃國文案例，§7.3）。
 * PATCH 多收 choice_mode（國文已解析的單選改多選，0 點）。讀、評分、刪除只要登入：國文關閉時已有的國文案例照樣可以看與刪。
 */
import {
  AI_ERROR_MESSAGES,
  ASSIST_LIMITS,
  ASSIST_SECTIONS,
  assistGroupVerdict,
  assistItemCount,
  checkAssistText,
  isAssistSubject,
  isZhSection,
  type AssistAnalysisView,
  type AssistInputProblem,
  type AssistQuestionView,
  type AssistSubject,
  type AssistTaskAccepted,
  type AssistTurnKind,
  type AssistVocabView,
  type AssistWritingView,
  type PhotoUploadResponse,
  type ZhAnalysisView,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import { readJsonBody } from '../account/validate';
import { buildClaudeRequest } from '../ai/client';
import { detectInjection } from '../ai/filter';
import { reserveOp, siteLimitsMicros, userLimits } from '../ai/guard';
import { reclaimStaleOps } from '../ai/housekeeping';
import { opsEvent, userRefFor } from '../ai/ledger';
import { reserveFailure } from '../ai/reserveErrors';
import { reserveMicros, taskConfig, taskModelsPriced, type TaskConfig } from '../ai/tasks';
import { requireUser, type SessionUser } from '../auth/session';
import type { AppConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { assistantSubjectAccess } from '../features';
import { photoOrd, readPhotoFile } from '../submissions/photoUpload';
import { parseJson } from '../submissions/repo';
import { nowSeconds } from '../time';
import { assistCacheKey, flagCacheIfDisputed, insertCacheHitTurn, lookupCache, mergeCaseCodes } from './cache';
import { confirmedOcrView, containsHiddenPlaceholder, latestOcr } from './ocr';
import { deleteCasePhotos, listCasePhotos, storeCasePhoto } from './photos';
import { assertCaseAssistable, endedPublisherCaseIds, withPublisherMask } from './publisher';
import { refundWithAssistRef } from './refund';
import {
  caseSubject,
  codeList,
  decodeCursor,
  encodeCursor,
  errorCounts,
  expiresFrom,
  findCase,
  listCases,
  requireCase,
  taiwanDayStart,
  toDetail,
  toSummary,
  CASE_PAGE_SIZE,
  type CaseRow,
} from './repo';
import { analyzeCallInput, requestCaseOf } from './requests';
import { requireZhFingerprints, type ZhFingerprints } from './subjects/chinese/d8';
import { zhContainsHiddenPlaceholder } from './subjects/chinese/ocr';
import { checkZhText, zhPhotoCase, zhQuestionTitle, zhStudentQuestion, zhTypedCase } from './subjects/chinese/question';
import { zhChoiceItemVerdict } from './subjects/chinese/settle';
import { workerSubject } from './subjects/index';
import { ASSIST_BODY_MAX, analyzeSchema, createCaseSchema, followupSchema, patchCaseSchema, updateQuestionSchema } from './schemas';
import { buildCase, problemMessage, studentQuestion, studentQuestionTitle, type BuiltCase } from './sources';
import { sessionUser, writeGate } from './gate';
import { mountReportRoutes } from './reports';

export const assistRoutes = new Hono<AppEnv>();

/** question_json 的上限（assist_cases 的 CHECK）。 */
const QUESTION_JSON_MAX_CHARS = 65_536;
/** ref_json 的上限（assist_cases 的 CHECK）。 */
const REF_JSON_MAX_CHARS = 4_096;

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}


/** 學生文字的規則不合 → 400 assist_input_invalid（只回第一個問題，附位置）。 */
function textProblem(problem: { code: AssistInputProblem; start?: number; end?: number }, field: string): ApiError {
  return new ApiError(400, 'assist_input_invalid', problemMessage(problem.code), {
    reason: problem.code,
    field,
    ...(problem.start !== undefined && problem.end !== undefined ? { ranges: [[problem.start, problem.end]] } : {}),
  });
}

/**
 * 選填的學生文字（疑問、筆記）：null 或空白＝沒填；其他依 checkAssistText（正規化、遮個資、長度、字元與標籤）。
 * 國文的案例改用 checkZhText（國文路徑的正規化不用 NFKC；docs/design/assistant-subjects.md §4.1）。
 */
function optionalStudentText(raw: string | null | undefined, max: number, field: string, subject: AssistSubject = 'english'): { text: string | null; masked: boolean } {
  if (raw === undefined || raw === null || raw.trim() === '') return { text: null, masked: false };
  const r = subject === 'chinese' ? checkZhText(raw, max) : checkAssistText(raw, max);
  if (!r.ok) throw textProblem(r.problems[0]!, field);
  return { text: r.value, masked: r.warnings.some((w) => w.code === 'personal_masked') };
}

/** 503 not_configured（學習助手或這一科對這位使用者沒開：公開端點不透露有預覽）。 */
function notConfigured(): ApiError {
  return new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
}

/**
 * 建立案例的科目：只有拍照、貼上收前端的 subject（白名單；沒帶＝英文，舊前端照舊）。站內題的科目由 Worker 依題目代號推出
 * （第一版的站內題都是英文），前端帶了也不採用。
 */
function requestedSubject(source: Record<string, unknown>): AssistSubject {
  if (source['source'] !== 'photo' && source['source'] !== 'typed') return 'english';
  const raw = source['subject'];
  if (raw === undefined || raw === null) return 'english';
  if (!isAssistSubject(raw)) throw new ApiError(400, 'bad_request', '科目不對');
  return raw;
}

/**
 * 英文以外的科目的寫入端點（docs/design/assistant-subjects.md §7.5）：這一科對這位使用者開放（拍照另外要它的拍照開關），
 * 國文的 D8 指紋讀得到。都在預扣之前；不符合回 503 not_configured。英文回 null（英文照 writeGate 的規則，不另外檢查）。
 */
async function subjectGate(db: D1Database, config: AppConfig, user: SessionUser, subject: AssistSubject, opts: { photo?: boolean } = {}): Promise<ZhFingerprints | null> {
  if (subject === 'english') return null;
  const access = assistantSubjectAccess(config, user.role, subject);
  if (!access.enabled || (opts.photo && !access.photo)) throw notConfigured();
  const zh = await requireZhFingerprints(db);
  if (!zh) throw notConfigured();
  return zh;
}

/** torn_with：要問的題的選項字母，而且不是學生自己的答案；沒勾 torn_between 時忽略。 */
function checkTornWith(raw: string | null | undefined, doubtKinds: readonly string[], question: AssistQuestionView | null): string | null {
  if (!doubtKinds.includes('torn_between') || !raw) return null;
  const targets = question?.targets ?? [];
  if (question?.trust === 'student') return raw;
  const ok = targets.some((t) => {
    const letters = Object.keys(t.options ?? question?.shared_options ?? {});
    return letters.includes(raw) && t.student_answer !== raw;
  });
  if (!ok) throw new ApiError(400, 'bad_request', '猶豫的選項不是這一題的選項，或和你的答案相同');
  return raw;
}

/** 注入樣式命中：寫一筆安全事件（只有代碼，不含內容；案例的 injection_flag 由呼叫端寫）。 */
async function injectionEvent(db: D1Database, codes: readonly string[], ref: string | null, opId: string | null = null): Promise<void> {
  if (codes.length === 0) return;
  try {
    await db.prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) VALUES (?1, 'injection_flag', ?2, ?3)`).bind(opId, codes.join(',').slice(0, 200), ref).run();
  } catch (err) {
    console.error('寫入注入旗標的安全事件失敗', err);
  }
}

/**
 * 拒收時另外寫 ops 事件的原因：D8 指紋（官方參考譯文、評分原則）與佳作、範文、評分原則的樣式（§4.16）；國文的科目不符
 * （docs/design/assistant-subjects.md §7.7：只記計數、階段與科目，不記題目文字）。
 */
const REJECTION_EVENTS: Readonly<Record<string, string>> = {
  official_material: 'assist_d8_input',
  official_like: 'assist_official_like',
  subject_mismatch: 'assist_subject_mismatch',
};

/**
 * 學生提供的題目或文字被拒收（400 assist_input_invalid）：日誌記 assist_input_rejected {reason}（§4.16）；D8 指紋與佳作樣式
 * 另外寫 ops 事件（只有假名、來源與欄位，沒有學生文字；同一人同一種 1 小時內只寫一筆，不讓重送洗版）。其他錯誤不處理。
 * 失敗只記 log，不改變回應。
 */
async function inputRejected(
  db: D1Database,
  err: unknown,
  where: 'typed' | 'confirm' | 'site',
  refOf: () => Promise<string | null>,
  now: number,
  subject: AssistSubject = 'english',
): Promise<void> {
  if (!(err instanceof ApiError) || err.code !== 'assist_input_invalid') return;
  const reason = err.detail.reason ?? 'unknown';
  log('assist_input_rejected', { reason, where });
  const kind = REJECTION_EVENTS[reason];
  if (!kind) return;
  try {
    const ref = await refOf();
    if (!ref) return;
    await db
      .prepare(
        `INSERT INTO ops_events (kind, severity, detail_json, created_at) SELECT ?1, 'warn', ?2, ?3
          WHERE NOT EXISTS (SELECT 1 FROM ops_events WHERE kind = ?1 AND created_at > ?3 - 3600 AND json_extract(detail_json, '$.user_ref') = ?4)`,
      )
      .bind(
        kind,
        JSON.stringify({
          user_ref: ref,
          where,
          field: err.detail.field ?? null,
          rejected: true,
          // 英文的事件和以前逐字相同；英文以外的科目多帶 subject（科目不符另外帶階段）。
          ...(subject !== 'english' ? { subject } : {}),
          ...(kind === 'assist_subject_mismatch' ? { stage: 'input' } : {}),
        }),
        now,
        ref,
      )
      .run();
  } catch (e) {
    console.error('寫入拒收事件失敗', e);
  }
}

// ───────────────────────── 讀取 ─────────────────────────

assistRoutes.use('*', requireUser());

assistRoutes.get('/cases', async (c) => {
  const user = await sessionUser(c);
  const now = nowSeconds();
  const section = c.req.query('section') ?? null;
  if (section !== null && !(ASSIST_SECTIONS as readonly string[]).includes(section) && !isZhSection(section)) throw new ApiError(400, 'bad_request', '大題代號不對');
  // 科目篩選：不帶＝全部科目（錯因次數只算英文）；帶了就只列那一科、錯因次數也算那一科（docs/design/assistant-subjects.md §7.2、§7.3）。
  const subjectRaw = c.req.query('subject') ?? null;
  if (subjectRaw !== null && !isAssistSubject(subjectRaw)) throw new ApiError(400, 'bad_request', '科目不對');
  const subject = subjectRaw as AssistSubject | null;
  const cursor = decodeCursor(c.req.query('cursor'));
  const [rows, counts] = await Promise.all([listCases(c.env.DB, user.id, now, { section, cursor, subject }), errorCounts(c.env.DB, user.id, now, subject ?? 'english')]);
  const page = rows.slice(0, CASE_PAGE_SIZE);
  const last = page[page.length - 1];
  // 出版社題的授權已經結束的案例帶 source_ended（列表本來就沒有題目文字；docs/design/weak-paper.md §9.6）。
  const ended = await endedPublisherCaseIds(c.var.siteData, page);
  const cases = page.map((r) => (ended.has(r.id) ? { ...toSummary(r), source_ended: true as const } : toSummary(r)));
  return c.json({ cases, next_cursor: rows.length > CASE_PAGE_SIZE && last ? encodeCursor(last) : null, error_counts: counts });
});

/** 回傳案例詳情：出版社題的授權已經結束時遮住題目與解析（publisher.ts；本站題不讀任何檔案）。 */
async function detailOf(c: Context<AppEnv>, row: CaseRow, now: number, extra: Parameters<typeof toDetail>[3] = {}) {
  return withPublisherMask(c.var.siteData, row, await toDetail(c.env.DB, row, now, extra));
}

assistRoutes.get('/cases/:id', async (c) => {
  const user = await sessionUser(c);
  const now = nowSeconds();
  const row = await requireCase(c.env.DB, user.id, c.req.param('id'), now);
  return c.json(await detailOf(c, row, now));
});

// ───────────────────────── 建立 ─────────────────────────

/** 先找同一組、同樣的題號與答案（180 天內）的案例：有就直接回那一筆。 */
async function existingCase(db: D1Database, userId: number, dedupeKey: string, now: number): Promise<CaseRow | null> {
  const found = await db.prepare(`SELECT id FROM assist_cases WHERE user_id = ?1 AND dedupe_key = ?2 AND expires_at > ?3`).bind(userId, dedupeKey, now).first<{ id: string }>();
  return found ? requireCase(db, userId, found.id, now) : null;
}

/**
 * 同一個去重鍵、已經過期但 housekeeping 還沒清的案例（清理是有流量時才跑、每次 200 筆）：唯一索引 idx_assist_cases_dedupe 仍然
 * 涵蓋它，不先刪掉的話這次建立會撞到。有進行中任務的不刪（排隊時都會延長期限，實際上不會發生）。
 */
async function deleteExpiredDuplicate(db: D1Database, userId: number, dedupeKey: string, now: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM assist_cases WHERE user_id = ?1 AND dedupe_key = ?2 AND expires_at <= ?3
          AND NOT EXISTS (SELECT 1 FROM assist_turns t WHERE t.case_id = assist_cases.id AND t.status IN ('queued', 'running'))`,
    )
    .bind(userId, dedupeKey, now)
    .run();
}

/** 每建立一個案例寫一筆的 ops 事件（每日上限的計數；§4.15）。 */
const CASE_CREATED_MARK = 'assist_case_created';

/**
 * 今天建立的案例數（每天 30 個，§4.15）的 SQL 運算式：學生刪掉的案例也要算（否則刪了再建就能無限建立，每個新案例又有自己的
 * 解析與追問次數），所以取「還在的案例數」與「建立紀錄數」（ops_events，學生刪不掉；只有假名）較大的那個。參數是佔位符的名字。
 */
function casesTodaySql(userParam: string, dayStartParam: string, refParam: string): string {
  return `MAX((SELECT COUNT(*) FROM assist_cases WHERE user_id = ${userParam} AND created_at >= ${dayStartParam}),
              (SELECT COUNT(*) FROM ops_events WHERE kind = '${CASE_CREATED_MARK}' AND created_at >= ${dayStartParam}
                  AND json_extract(detail_json, '$.user_ref') = ${refParam}))`;
}

/** question_json 太大（長篇閱讀＋解析）：先丟排除法表與沒問的題的題幹；還是太大就不支援。 */
function questionJsonOf(view: AssistQuestionView | null): string | null {
  if (!view) return null;
  let json = JSON.stringify(view);
  if (json.length <= QUESTION_JSON_MAX_CHARS) return json;
  json = JSON.stringify({ ...view, elimination: null, siblings: view.siblings.map((s) => ({ ...s, stem: null })) });
  if (json.length <= QUESTION_JSON_MAX_CHARS) return json;
  throw new ApiError(400, 'assist_source_unavailable', '這一題太長，學習助手暫時無法處理', { reason: 'unsupported' });
}

assistRoutes.post('/cases', async (c) => {
  const { user, config, fp } = await writeGate(c);
  const body = await readJsonBody(c, createCaseSchema, ASSIST_BODY_MAX.create);
  const source = body.source as Record<string, unknown> & { source: (typeof body.source)['source'] };
  const subject = requestedSubject(source);
  // 拍照另外要拍照開關（「貼上文字」照常）；國文另外要國文的開關（拍照再加國文拍照的開關）與國文指紋。都在建立之前。
  if (source.source === 'photo' && !assistantSubjectAccess(config, user.role, subject).photo) throw notConfigured();
  const db = c.env.DB;
  const zh = await subjectGate(db, config, user, subject, { photo: source.source === 'photo' });
  const nowMs = Date.now();
  const now = nowSeconds(nowMs);
  // 「同一份題目問另一部分」（只有國文的貼上）：前一個案例必須是同一位使用者、同一科、已確認題目。
  const relatedRaw = source['related_case_id'];
  let relatedId: string | null = null;
  if (relatedRaw !== undefined && relatedRaw !== null) {
    if (subject !== 'chinese' || source.source !== 'typed' || typeof relatedRaw !== 'string' || !/^[0-9a-f-]{36}$/i.test(relatedRaw)) {
      throw new ApiError(400, 'bad_request', '只有國文貼上的題目可以接著問同一份題目');
    }
    const related = await findCase(db, user.id, relatedRaw, now);
    if (!related || caseSubject(related) !== subject || related.question_json === null) throw new ApiError(400, 'bad_request', '找不到要接著問的那一題，或不是同一科');
    relatedId = related.id;
  }
  let doubt: ReturnType<typeof optionalStudentText>;
  let built: BuiltCase;
  try {
    doubt = optionalStudentText(body.doubt, ASSIST_LIMITS.doubtMaxChars, 'doubt', subject);
    if (zh) built = source.source === 'photo' ? zhPhotoCase() : zhTypedCase(source['question'], fp, zh, relatedId);
    else built = await buildCase(body.source as Parameters<typeof buildCase>[0], { db, userId: user.id, siteData: c.var.siteData, fp });
  } catch (err) {
    await inputRejected(db, err, body.source.source === 'typed' ? 'typed' : 'site', () => userRefFor(config.auth.ledgerSalt, user.id), now, subject);
    throw err;
  }
  const ref = await userRefFor(config.auth.ledgerSalt, user.id);
  const doubtKinds = [...new Set(body.doubt_kinds ?? [])];
  const tornWith = checkTornWith(body.torn_with, doubtKinds, built.question);
  if (built.refJson.length > REF_JSON_MAX_CHARS) throw new ApiError(400, 'bad_request', '作答的內容太長');
  const masked = doubt.masked || built.masked > 0;

  if (built.dedupeKey) {
    const existing = await existingCase(db, user.id, built.dedupeKey, now);
    if (existing) return c.json(await detailOf(c, existing, now, { existing: true, ...(masked ? { masked } : {}) }), 200);
  }
  const questionJson = questionJsonOf(built.question);
  const injection = [...built.injection, ...(doubt.text ? detectInjection(doubt.text) : [])];
  const id = crypto.randomUUID();
  const status = built.source === 'photo' ? 'draft' : 'ready';
  const dayStart = taiwanDayStart(nowMs);
  // 同一個去重鍵已經過期、還沒被 housekeeping 清掉的舊案例（existingCase 只認沒過期的）：先刪掉，唯一索引才不會擋下這次建立。
  if (built.dedupeKey) await deleteExpiredDuplicate(db, user.id, built.dedupeKey, now);
  const insert = db
    .prepare(
      `INSERT INTO assist_cases (id, user_id, source, kind, ref_json, dedupe_key, trust, section, title, item_count, wrong_count, question_json,
                                 doubt_kinds_json, torn_with, doubt_text, hint_first, signals_json, status, verdict, skills_json, injection_flag,
                                 created_at, updated_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?22, ?23
        WHERE ${casesTodaySql('?2', '?24', '?27')} < ?25
          AND (SELECT COUNT(*) FROM assist_cases WHERE user_id = ?2) < ?26`,
    )
    .bind(
      id,
      user.id,
      built.source,
      built.kind,
      built.refJson,
      built.dedupeKey,
      built.trust,
      built.section,
      built.title,
      Math.max(1, Math.min(8, built.itemCount)),
      Math.min(8, built.wrongCount),
      questionJson,
      JSON.stringify(doubtKinds),
      tornWith,
      doubt.text,
      body.hint_first ? 1 : 0,
      JSON.stringify(body.signals ?? {}),
      status,
      built.verdict,
      JSON.stringify(built.skills).length <= 1_024 ? JSON.stringify(built.skills) : '[]',
      injection.length > 0 ? 1 : 0,
      now,
      expiresFrom(now),
      dayStart,
      ASSIST_LIMITS.casesPerDay,
      ASSIST_LIMITS.casesLive,
      ref,
    );
  // 建立紀錄（每日上限的計數；學生刪不掉，只有假名、沒有內容；建立時就標成已確認，不算進後台的「未處理」）。
  const mark = ref
    ? db
        .prepare(`INSERT INTO ops_events (kind, severity, detail_json, created_at, acked_at) SELECT ?1, 'info', ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM assist_cases WHERE id = ?4 AND user_id = ?5)`)
        .bind(CASE_CREATED_MARK, JSON.stringify({ user_ref: ref }), now, id, user.id)
    : null;
  let changes = 0;
  try {
    changes = (await db.batch(mark ? [insert, mark] : [insert]))[0]?.meta.changes ?? 0;
  } catch (err) {
    // 同一個去重鍵剛好同時建立（唯一索引）：回那一筆。
    if (built.dedupeKey && /UNIQUE/i.test(String(err))) {
      const existing = await existingCase(db, user.id, built.dedupeKey, now);
      if (existing) return c.json(await detailOf(c, existing, now, { existing: true }), 200);
      // 撞到的是過期、但剛好有進行中任務而刪不掉的舊案例：不回 500。
      throw new ApiError(409, 'conflict', '這一題的舊紀錄正在處理中，請稍後再試');
    }
    throw err;
  }
  if (changes !== 1) {
    const today = await db.prepare(`SELECT ${casesTodaySql('?1', '?2', '?3')} AS n`).bind(user.id, dayStart, ref).first<{ n: number }>();
    if ((today?.n ?? 0) >= ASSIST_LIMITS.casesPerDay) {
      throw new ApiError(429, 'assist_limit', `今天已經送出 ${ASSIST_LIMITS.casesPerDay} 題，明天再繼續`, { reason: 'cases_per_day' });
    }
    throw new ApiError(429, 'assist_limit', `學習助手裡的題目已經有 ${ASSIST_LIMITS.casesLive} 題，請先刪掉一些舊的`, { reason: 'cases_live' });
  }
  await injectionEvent(db, injection, ref);
  log('assist_case_created', { case_id: id, source: built.source, subject, items: built.itemCount });
  const row = await requireCase(db, user.id, id, now);
  return c.json(await detailOf(c, row, now, masked ? { masked } : {}), 201);
});

// ───────────────────────── 修改、刪除 ─────────────────────────

/**
 * 國文已解析的單選題改成多選（PATCH 的 choice_mode；0 點、不呼叫 AI；docs/design/assistant-subjects.md §5.3）：題目裡單選的題
 * 改成多選，案例的判定與答錯題數依已存的逐選項判定重算（多選計分）；畫面的計分與逐選項表由前端用 shared 的 zhMultiScore 重算。
 * 只接受 multi，而且只限國文的選擇題、已經有解析、還有單選的題；否則 400／409。
 */
async function switchToMulti(db: D1Database, row: CaseRow, mode: string): Promise<{ questionJson: string; verdict: string | null; wrongCount: number }> {
  if (mode !== 'multi') throw new ApiError(400, 'bad_request', '只能把單選題改成多選題');
  if (caseSubject(row) !== 'chinese' || row.kind !== 'zh_choice') throw new ApiError(400, 'bad_request', '只有國文的選擇題可以改成多選題');
  const question = parseJson<AssistQuestionView>(row.question_json);
  if (!question || row.analyses < 1 || row.status !== 'analyzed') throw new ApiError(409, 'conflict', '請先等這一題解析完成');
  if (!question.targets.some((t) => t.choice_mode === 'single')) throw new ApiError(409, 'conflict', '這一題已經是多選題');
  const updated: AssistQuestionView = {
    ...question,
    targets: question.targets.map((t) => (t.choice_mode === 'single' ? { ...t, choice_mode: 'multi' as const, mode: 'multi_select' as const } : t)),
  };
  const latest = await db
    .prepare(`SELECT output_json FROM assist_turns WHERE case_id = ?1 AND user_id = ?2 AND kind = 'analyze' AND status = 'done' ORDER BY seq DESC LIMIT 1`)
    .bind(row.id, row.user_id)
    .first<{ output_json: string | null }>();
  const view = parseJson<ZhAnalysisView>(latest?.output_json ?? null);
  if (!view || view.kind !== 'zh_choice') return { questionJson: JSON.stringify(updated), verdict: row.verdict, wrongCount: row.wrong_count };
  const verdicts = view.items.map(
    (it) => zhChoiceItemVerdict({ student_answer: it.student_answer, answer_key: it.answer_key, choice_mode: 'multi', option_count: it.options.filter((o) => /^[A-E]$/.test(o.option)).length || undefined }).verdict,
  );
  return { questionJson: JSON.stringify(updated), verdict: assistGroupVerdict(verdicts), wrongCount: verdicts.filter((v) => v === 'wrong' || v === 'partial').length };
}

assistRoutes.patch('/cases/:id', async (c) => {
  const user = await sessionUser(c);
  const body = await readJsonBody(c, patchCaseSchema, ASSIST_BODY_MAX.small);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  const note = body.note === undefined ? undefined : optionalStudentText(body.note, ASSIST_LIMITS.noteMaxChars, 'note', caseSubject(row)).text;
  if (body.choice_mode !== undefined) {
    const next = await switchToMulti(db, row, body.choice_mode);
    const res = await db
      .prepare(
        `UPDATE assist_cases SET question_json = ?1, verdict = ?2, wrong_count = ?3, updated_at = ?4, expires_at = ?5
          WHERE id = ?6 AND user_id = ?7 AND status = 'analyzed' AND question_json = ?8`,
      )
      .bind(next.questionJson, next.verdict, Math.min(8, next.wrongCount), now, expiresFrom(now), row.id, user.id, row.question_json)
      .run();
    if ((res.meta.changes ?? 0) !== 1) throw new ApiError(409, 'conflict', '這一題的狀態剛剛改變了，請重新整理');
  }
  await db
    .prepare(
      `UPDATE assist_cases SET
              understood = CASE WHEN ?1 = 1 THEN ?2 ELSE understood END,
              rating = CASE WHEN ?3 = 1 THEN ?4 ELSE rating END,
              note_text = CASE WHEN ?5 = 1 THEN ?6 ELSE note_text END,
              updated_at = ?7, expires_at = ?8
        WHERE id = ?9 AND user_id = ?10`,
    )
    .bind(
      body.understood !== undefined ? 1 : 0,
      body.understood ?? null,
      body.rating !== undefined ? 1 : 0,
      body.rating ?? null,
      note !== undefined ? 1 : 0,
      note ?? null,
      now,
      expiresFrom(now),
      row.id,
      user.id,
    )
    .run();
  // 「這則解析有錯」：命中或寫入過共用快取的案例，兩位不同的學生都回報就停用那一筆（§4.7.4）。
  if (body.rating === 'wrong' && row.cache_key) await flagCacheIfDisputed(db, row.cache_key);
  return c.json(await detailOf(c, await requireCase(db, user.id, row.id, now), now));
});

assistRoutes.delete('/cases/:id', async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const id = c.req.param('id');
  const res = await db
    .prepare(`DELETE FROM assist_cases WHERE id = ?1 AND user_id = ?2 AND NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?1 AND status IN ('queued', 'running'))`)
    .bind(id, user.id)
    .run();
  if ((res.meta.changes ?? 0) === 1) return c.body(null, 204);
  const exists = await db.prepare('SELECT 1 AS x FROM assist_cases WHERE id = ?1 AND user_id = ?2').bind(id, user.id).first<{ x: number }>();
  if (!exists) throw new ApiError(404, 'not_found', '找不到這一題');
  throw new ApiError(409, 'conflict', '解析進行中，完成後再刪');
});

assistRoutes.put('/cases/:id/question', async (c) => {
  const { user, config, fp } = await writeGate(c);
  const body = await readJsonBody(c, updateQuestionSchema, ASSIST_BODY_MAX.question);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  const subject = caseSubject(row);
  const zh = await subjectGate(db, config, user, subject);
  if (row.trust !== 'student' || (row.source !== 'typed' && row.source !== 'photo')) throw new ApiError(409, 'conflict', '只有你自己提供的題目可以修改');
  if (!['ocr_ready', 'ready', 'failed'].includes(row.status)) throw new ApiError(409, 'conflict', '這一題現在不能修改');
  // 拍照的題目（WP-A3）：被隱藏的區塊（D8、佳作樣式、長英文；國文另有答案段、長文）在確認畫面不能編輯、也不送回；送回了就擋下（§2.5）。
  // 其他規則和貼上的題目相同（重跑全部檢查，含 D8 指紋）；非目標區塊剩下的 [[?]] 換成 [unclear]。
  const photo = row.source === 'photo';
  if (photo) {
    const blocks = (body.question as { blocks?: unknown } | null)?.blocks;
    const hidden = (text: string) => containsHiddenPlaceholder(text) || (zh !== null && zhContainsHiddenPlaceholder(text));
    const index = Array.isArray(blocks) ? blocks.findIndex((b) => typeof (b as { text?: unknown })?.text === 'string' && hidden((b as { text: string }).text)) : -1;
    if (index >= 0) throw new ApiError(400, 'assist_input_invalid', problemMessage('blocks_invalid'), { reason: 'blocks_invalid', field: `blocks[${index}].text` });
  }
  let s: ReturnType<typeof studentQuestion> & { kind: CaseRow['kind']; title: string };
  let doubt: ReturnType<typeof optionalStudentText>;
  try {
    if (zh) {
      // 國文：格式在確認時可以改，kind 跟著改（題數依格式：選擇是題數、簡答是小題數、國寫是 1）。
      const zs = zhStudentQuestion(body.question, fp, zh, { origin: photo ? 'photo' : 'typed' });
      s = { ...zs, title: zhQuestionTitle(zs.question, photo ? 'photo' : 'typed') };
    } else {
      const es = studentQuestion(body.question, fp, { origin: photo ? 'photo' : 'typed' });
      s = { ...es, kind: row.kind, title: studentQuestionTitle(es.question, photo ? 'photo' : 'typed') };
    }
    doubt = optionalStudentText(body.doubt, ASSIST_LIMITS.doubtMaxChars, 'doubt', subject);
  } catch (err) {
    await inputRejected(db, err, 'confirm', () => userRefFor(config.auth.ledgerSalt, user.id), now, subject);
    throw err;
  }
  const doubtKinds = [...new Set(body.doubt_kinds ?? codeList(row.doubt_kinds_json))];
  const injection = [...s.injection, ...(doubt.text ? detectInjection(doubt.text) : [])];
  // 轉錄的原始輸出確認後只留統計（文字清掉）；照片在轉錄結算時已經刪了，這裡再保險一次。
  const ocr = photo ? await latestOcr(db, user.id, row.id) : null;
  const [res] = await db.batch([
    db
      .prepare(
        `UPDATE assist_cases SET question_json = ?1, title = ?2, item_count = ?3, doubt_kinds_json = ?4, doubt_text = ?5, hint_first = ?6,
                status = 'ready', injection_flag = CASE WHEN ?7 = 1 THEN 1 ELSE injection_flag END, updated_at = ?8, expires_at = ?9, kind = ?12
          WHERE id = ?10 AND user_id = ?11 AND status IN ('ocr_ready', 'ready', 'failed')
            AND NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?10 AND status IN ('queued', 'running'))`,
      )
      .bind(
        questionJsonOf(s.view),
        s.title,
        Math.max(1, Math.min(8, s.itemCount)),
        JSON.stringify(doubtKinds),
        doubt.text,
        (body.hint_first ?? row.hint_first === 1) ? 1 : 0,
        injection.length > 0 ? 1 : 0,
        now,
        expiresFrom(now),
        row.id,
        user.id,
        s.kind,
      ),
    ...(ocr && !ocr.view.stats
      ? [
          db
            .prepare(
              `UPDATE assist_turns SET output_json = ?1, updated_at = ?2
                WHERE id = ?3 AND user_id = ?4 AND kind = 'ocr'
                  AND EXISTS (SELECT 1 FROM assist_cases WHERE id = ?5 AND user_id = ?4 AND status = 'ready' AND updated_at = ?2)`,
            )
            .bind(JSON.stringify(confirmedOcrView(ocr.view, s.question, s.unclear)), now, ocr.id, user.id, row.id),
        ]
      : []),
    ...(photo
      ? [
          db
            .prepare(`DELETE FROM assist_photos WHERE case_id = ?1 AND user_id = ?2 AND EXISTS (SELECT 1 FROM assist_cases WHERE id = ?1 AND user_id = ?2 AND status = 'ready')`)
            .bind(row.id, user.id),
        ]
      : []),
  ]);
  if ((res?.meta.changes ?? 0) !== 1) throw new ApiError(409, 'conflict', '這一題的狀態剛剛改變了，請重新整理');
  await injectionEvent(db, injection, await userRefFor(config.auth.ledgerSalt, user.id));
  const updated = await requireCase(db, user.id, row.id, now);
  return c.json(await detailOf(c, updated, now, s.masked > 0 || doubt.masked ? { masked: true } : {}));
});

// ───────────────────────── 解析與追問 ─────────────────────────

/** 預扣、寫 turn、排入 Queue 共用的部分（解析與追問）。 */
async function enqueueTurn(
  c: Context<AppEnv>,
  args: {
    user: SessionUser;
    config: AppConfig;
    row: CaseRow;
    tc: TaskConfig;
    kind: AssistTurnKind;
    turnId: string;
    /** 條件式 INSERT turn＋其他附帶語句（op id 是 ?1 之外的參數由呼叫端綁定）；回傳 [insertTurn, ...others]。 */
    statements: (opId: string) => D1PreparedStatement[];
    /** turn 寫不進去時，回 409 還是 429。 */
    conflict: () => Promise<ApiError>;
  },
): Promise<Response> {
  const { user, config, row, tc, turnId } = args;
  const db = c.env.DB;
  const queue = c.env.AI_QUEUE!;
  const nowMs = Date.now();
  // 卡住的預扣先回收，才不會佔住同時任務名額與全站預算（同 /api/ai/*）。
  try {
    await reclaimStaleOps(db, nowMs);
  } catch (err) {
    console.error('回收卡住的預扣失敗（不影響這次請求）', err);
  }
  const ref = await userRefFor(config.auth.ledgerSalt, user.id);
  const opId = crypto.randomUUID();
  const reserved = await reserveOp(db, {
    opId,
    userId: user.id,
    task: tc.task,
    refId: turnId,
    points: tc.points,
    usdMicros: reserveMicros(tc),
    family: tc.family,
    limits: userLimits(config, user),
    site: siteLimitsMicros(config),
    nowMs,
  });
  if (!reserved.ok) throw await reserveFailure(db, reserved.code, ref, tc.task, nowMs);
  const op = { id: opId, user_id: user.id, task: tc.task, ref_id: turnId };
  let inserted = false;
  try {
    const results = await db.batch(args.statements(opId));
    inserted = results[0]?.meta.changes === 1;
  } catch (err) {
    console.error('寫入學習助手的 turn 失敗，退還點數', opId, err);
  }
  if (!inserted) {
    // 極少見的競爭（同時送出兩次、剛好用完次數）：立即以 internal 退還；沒有 ai_calls，成本 0（§4.7.3）。
    // 用 refundWithAssistRef：batch 其實已經寫進去、只是回應丟了（D1 偶爾會這樣）時，turn 改 failed、案例回到原本的狀態，
    // 不會留下一筆「操作已退還、turn 永遠 queued」的列（housekeeping 只回收 reserved 的操作，刪除與清理也都會被它擋住）。
    // 沒寫進去時，它的附帶語句以「turn 指向這個操作」為條件，什麼都不改。
    await refundWithAssistRef(db, op, 'internal', Date.now()).catch((err) => console.error('退還失敗，交給 housekeeping 回收', opId, err));
    throw await args.conflict();
  }
  log('ai_task_queued', { op_id: opId, task: tc.task, case_id: row.id });
  try {
    await queue.send({ op_id: opId });
  } catch (err) {
    console.error('排入 Queue 失敗，退還點數', opId, err);
    await refundWithAssistRef(db, op, 'internal', Date.now()).catch((e) => console.error('退還失敗，交給 housekeeping 回收', opId, e));
    throw new ApiError(503, 'not_configured', '送出失敗，點數已退還，請稍後再試');
  }
  const body: AssistTaskAccepted = { op_id: opId, case_id: row.id, turn_id: turnId, status: 'queued', points: tc.points };
  return c.json(body, 202);
}

/** 解析插不進 turn 的原因：有進行中的任務 409；已經解析過 2 次 429。 */
async function analyzeConflict(db: D1Database, row: CaseRow): Promise<ApiError> {
  const cur = await db
    .prepare(`SELECT analyses, (SELECT COUNT(*) FROM assist_turns WHERE case_id = ?1 AND status IN ('queued', 'running')) AS inflight FROM assist_cases WHERE id = ?1 AND user_id = ?2`)
    .bind(row.id, row.user_id)
    .first<{ analyses: number; inflight: number }>();
  if ((cur?.inflight ?? 0) > 0) return new ApiError(409, 'conflict', '這一題正在處理中，請稍候');
  if ((cur?.analyses ?? 0) >= ASSIST_LIMITS.analysesPerCase) {
    return new ApiError(429, 'assist_limit', `這一題已經解析過 ${ASSIST_LIMITS.analysesPerCase} 次，有疑問可以直接追問`, { reason: 'analyses_per_case' });
  }
  return new ApiError(409, 'conflict', '這一題的狀態剛剛改變了，請重新整理');
}

assistRoutes.post('/cases/:id/analyze', async (c) => {
  const { user, config, fp } = await writeGate(c);
  await readJsonBody(c, analyzeSchema, ASSIST_BODY_MAX.small);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  // 國文：開關與國文指紋在預扣之前檢查（503，不扣點）。
  const subject = caseSubject(row);
  await subjectGate(db, config, user, subject);
  // 出版社題的授權已經結束或不含 AI 解析：在預扣之前拒收（不扣點；共用快取也不再提供）。
  await assertCaseAssistable(c.var.siteData, row);
  if (!['ready', 'analyzed', 'failed'].includes(row.status)) throw new ApiError(409, 'conflict', '這一題現在不能解析');
  if (row.analyses >= ASSIST_LIMITS.analysesPerCase) throw await analyzeConflict(db, row);
  const question = parseJson<AssistQuestionView>(row.question_json);
  if (!question) throw new ApiError(409, 'conflict', '這一題還沒有題目');
  // 題數（計點單位）：英文和以前相同（item 是題數、其他 1）；國文選擇是題數、簡答是小題數、國寫是 1。
  // turn 的 meta_json 存同一組 {subject, kind, items}，consumer 用它算任務設定（預扣與實際呼叫一致）。
  const items = assistItemCount(subject, row.kind, question);
  const tc = taskConfig('assist_analyze', config, { subject, kind: row.kind, items });
  if (!taskModelsPriced(tc)) {
    await opsEvent(db, 'ai_model_not_priced', 'error', { task: tc.task, models: tc.calls.map((x) => x.model) });
    throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  }
  const reqCase = requestCaseOf(row, question);
  const turnId = crypto.randomUUID();

  // 共用快取（§4.7.4）：鍵是實際會送出的整個請求；命中就 0 點、不呼叫。國文沒有站內題，一律不進快取。
  if (workerSubject(subject).cacheable(reqCase)) {
    const input = analyzeCallInput(tc, reqCase, { patterns: null, fp });
    const built = await buildClaudeRequest(input);
    const key = await assistCacheKey({ promptVersion: built.promptVersion, model: input.spec.model, effort: input.spec.effort, d8Version: fp.version, userText: input.content as string });
    const hit = await lookupCache(db, key, now);
    const cached = hit ? parseJson<AssistAnalysisView | AssistWritingView | AssistVocabView>(hit.result_json) : null;
    if (hit && cached) {
      const errors = cached.kind === 'item' ? [...new Set(cached.items.flatMap((it) => it.diagnosis.error_codes))] : [];
      const skills = cached.kind === 'item' ? cached.skill_codes : [];
      const merged = mergeCaseCodes({ skills: codeList(row.skills_json), errors: codeList(row.errors_json) }, { skills, errors });
      const inserted = await insertCacheHitTurn(db, {
        turnId,
        caseId: row.id,
        userId: user.id,
        key,
        resultJson: hit.result_json,
        ...merged,
        meta: { cache_key: key, prompt_version: built.promptVersion },
        now,
      });
      if (!inserted) throw await analyzeConflict(db, row);
      log('assist_cache_hit', { case_id: row.id });
      const body: AssistTaskAccepted = { op_id: null, case_id: row.id, turn_id: turnId, status: 'done', points: 0, cache_hit: true };
      return c.json(body, 200);
    }
  }

  return enqueueTurn(c, {
    user,
    config,
    row,
    tc,
    kind: 'analyze',
    turnId,
    statements: (opId) => [
      db
        .prepare(
          `INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, op_id, meta_json, created_at, updated_at)
           SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assist_turns WHERE case_id = ?2), 'analyze', 'queued', ?4, ?5, ?6, ?6
            WHERE NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?2 AND status IN ('queued', 'running'))
              AND (SELECT analyses FROM assist_cases WHERE id = ?2 AND user_id = ?3) < ?7
              AND (SELECT status FROM assist_cases WHERE id = ?2 AND user_id = ?3) IN ('ready', 'analyzed', 'failed')`,
        )
        .bind(turnId, row.id, user.id, opId, JSON.stringify({ subject, kind: row.kind, items }), now, ASSIST_LIMITS.analysesPerCase),
      db
        .prepare(
          `UPDATE assist_cases SET status = 'analyzing', updated_at = ?1, expires_at = ?2
            WHERE id = ?3 AND user_id = ?4 AND EXISTS (SELECT 1 FROM assist_turns WHERE id = ?5 AND op_id = ?6)`,
        )
        .bind(now, expiresFrom(now), row.id, user.id, turnId, opId),
    ],
    conflict: () => analyzeConflict(db, row),
  });
});

assistRoutes.post('/cases/:id/followups', async (c) => {
  const { user, config } = await writeGate(c);
  const body = await readJsonBody(c, followupSchema, ASSIST_BODY_MAX.small);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  const subject = caseSubject(row);
  await subjectGate(db, config, user, subject);
  await assertCaseAssistable(c.var.siteData, row);
  if (row.analyses < 1 || row.status === 'analyzing') throw new ApiError(409, 'conflict', '請先等這一題解析完成再追問');
  if (row.followups >= ASSIST_LIMITS.followupsPerCase) {
    throw new ApiError(429, 'assist_limit', `這一題已經追問 ${ASSIST_LIMITS.followupsPerCase} 次，建議開新的一題`, { reason: 'followups_per_case' });
  }
  const text = subject === 'chinese' ? checkZhText(body.text, ASSIST_LIMITS.followupMaxChars) : checkAssistText(body.text, ASSIST_LIMITS.followupMaxChars);
  if (!text.ok) throw textProblem(text.problems[0]!, 'text');
  const question = parseJson<AssistQuestionView>(row.question_json);
  const label = body.label ?? null;
  if (label !== null && !(question?.targets ?? []).some((t) => t.label === label)) throw new ApiError(400, 'bad_request', '追問的題號不在這一題裡');
  const injection = detectInjection(text.value);
  const tc = taskConfig('assist_followup', config, { subject });
  if (!taskModelsPriced(tc)) {
    await opsEvent(db, 'ai_model_not_priced', 'error', { task: tc.task, models: tc.calls.map((x) => x.model) });
    throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  }
  const turnId = crypto.randomUUID();
  const ref = await userRefFor(config.auth.ledgerSalt, user.id);
  const followupConflict = async (): Promise<ApiError> => {
    const cur = await db
      .prepare(`SELECT followups, (SELECT COUNT(*) FROM assist_turns WHERE case_id = ?1 AND status IN ('queued', 'running')) AS inflight FROM assist_cases WHERE id = ?1 AND user_id = ?2`)
      .bind(row.id, user.id)
      .first<{ followups: number; inflight: number }>();
    if ((cur?.inflight ?? 0) > 0) return new ApiError(409, 'conflict', '這一題正在處理中，請稍候');
    if ((cur?.followups ?? 0) >= ASSIST_LIMITS.followupsPerCase) {
      return new ApiError(429, 'assist_limit', `這一題已經追問 ${ASSIST_LIMITS.followupsPerCase} 次，建議開新的一題`, { reason: 'followups_per_case' });
    }
    return new ApiError(409, 'conflict', '這一題的狀態剛剛改變了，請重新整理');
  };
  return enqueueTurn(c, {
    user,
    config,
    row,
    tc,
    kind: 'followup',
    turnId,
    statements: (opId) => [
      db
        .prepare(
          `INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, op_id, input_text, label, mode, meta_json, created_at, updated_at)
           SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assist_turns WHERE case_id = ?2), 'followup', 'queued', ?4, ?5, ?6, ?7, ?10, ?8, ?8
            WHERE NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?2 AND status IN ('queued', 'running'))
              AND (SELECT followups FROM assist_cases WHERE id = ?2 AND user_id = ?3) < ?9
              AND (SELECT analyses FROM assist_cases WHERE id = ?2 AND user_id = ?3) >= 1`,
        )
        .bind(turnId, row.id, user.id, opId, text.value, label, body.mode, now, ASSIST_LIMITS.followupsPerCase, subject === 'english' ? '{}' : JSON.stringify({ subject })),
      db
        .prepare(
          `UPDATE assist_cases SET injection_flag = CASE WHEN ?1 = 1 THEN 1 ELSE injection_flag END, updated_at = ?2, expires_at = ?3
            WHERE id = ?4 AND user_id = ?5 AND EXISTS (SELECT 1 FROM assist_turns WHERE id = ?6 AND op_id = ?7)`,
        )
        .bind(injection.length > 0 ? 1 : 0, now, expiresFrom(now), row.id, user.id, turnId, opId),
      ...(injection.length > 0
        ? [
            db
              .prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'injection_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM assist_turns WHERE id = ?4 AND op_id = ?1)`)
              .bind(opId, injection.join(',').slice(0, 200), ref, turnId),
          ]
        : []),
    ],
    conflict: followupConflict,
  });
});

// ───────────────────────── 拍照與轉錄（WP-A3） ─────────────────────────

/**
 * 拍照另外要拍照開關（AI_ASSISTANT_PHOTO；admin＝只有管理員）；關著時和學習助手關著一樣回 503。
 * 國文的案例另外要國文拍照的開關（AI_ASSISTANT_SUBJECTS_PHOTO；assistantSubjectAccess）。
 */
function assertPhotoAccess(config: AppConfig, user: SessionUser, subject: AssistSubject = 'english'): void {
  if (!assistantSubjectAccess(config, user.role, subject).photo) throw notConfigured();
}

assistRoutes.post('/cases/:id/photos', async (c) => {
  const { user, config } = await writeGate(c);
  assertPhotoAccess(config, user);
  // ord 與 Content-Length 先檢查（不讀本體），本體的讀取與檢查和作文照片共用（submissions/photoUpload.ts）。
  const ord = photoOrd(c);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  assertPhotoAccess(config, user, caseSubject(row));
  if (row.source !== 'photo') throw new ApiError(409, 'conflict', '只有拍照的題目可以上傳照片');
  if (row.status !== 'draft') throw new ApiError(409, 'conflict', '這一題目前不能上傳照片');
  const photo = await readPhotoFile(c);
  if (!(await storeCasePhoto(db, { userId: user.id, caseId: row.id, ord, photo, now }))) {
    const cur = await requireCase(db, user.id, row.id, now);
    if (cur.status !== 'draft') throw new ApiError(409, 'conflict', '這一題目前不能上傳照片');
    throw new ApiError(429, 'assist_limit', `暫存的照片太多了（每人最多 ${ASSIST_LIMITS.photosTempPerUser} 張），請等轉錄完成後再上傳`, { reason: 'photos' });
  }
  const body: PhotoUploadResponse = { photos: await listCasePhotos(db, user.id, row.id, now) };
  return c.json(body);
});

assistRoutes.delete('/cases/:id/photos', async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const row = await requireCase(db, user.id, c.req.param('id'), nowSeconds());
  if (row.status === 'ocr_queued') throw new ApiError(409, 'conflict', '轉錄進行中，完成後照片會自動刪除');
  await deleteCasePhotos(db, user.id, row.id);
  const body: PhotoUploadResponse = { photos: [] };
  return c.json(body);
});

assistRoutes.post('/cases/:id/ocr', async (c) => {
  const { user, config } = await writeGate(c);
  assertPhotoAccess(config, user);
  await readJsonBody(c, analyzeSchema, ASSIST_BODY_MAX.small);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireCase(db, user.id, c.req.param('id'), now);
  // 國文：國文拍照的開關與國文指紋在預扣之前檢查；點數依照片張數（1 張 3 點、2 張 4 點），張數存在 turn 的 meta_json。
  const subject = caseSubject(row);
  await subjectGate(db, config, user, subject, { photo: true });
  if (row.source !== 'photo') throw new ApiError(409, 'conflict', '只有拍照的題目可以轉錄');
  if (row.status !== 'draft') throw new ApiError(409, 'conflict', '這一題現在不能轉錄');
  const photoCount = (await listCasePhotos(db, user.id, row.id, now)).length;
  if (photoCount === 0) throw new ApiError(409, 'conflict', '請先上傳照片（照片超過 24 小時會自動刪除）');
  const tc = subject === 'english' ? taskConfig('assist_ocr', config) : taskConfig('assist_ocr', config, { subject, photos: photoCount });
  if (!taskModelsPriced(tc)) {
    await opsEvent(db, 'ai_model_not_priced', 'error', { task: tc.task, models: tc.calls.map((x) => x.model) });
    throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  }
  const turnId = crypto.randomUUID();
  return enqueueTurn(c, {
    user,
    config,
    row,
    tc,
    kind: 'ocr',
    turnId,
    statements: (opId) => [
      db
        .prepare(
          `INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, op_id, meta_json, created_at, updated_at)
           SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assist_turns WHERE case_id = ?2), 'ocr', 'queued', ?4, ?6, ?5, ?5
            WHERE NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?2 AND status IN ('queued', 'running'))
              AND (SELECT status FROM assist_cases WHERE id = ?2 AND user_id = ?3) = 'draft'
              AND EXISTS (SELECT 1 FROM assist_photos WHERE case_id = ?2 AND user_id = ?3 AND expires_at >= ?5)`,
        )
        .bind(turnId, row.id, user.id, opId, now, subject === 'english' ? '{}' : JSON.stringify({ subject, photos: Math.min(2, photoCount) })),
      db
        .prepare(
          `UPDATE assist_cases SET status = 'ocr_queued', updated_at = ?1, expires_at = ?2
            WHERE id = ?3 AND user_id = ?4 AND EXISTS (SELECT 1 FROM assist_turns WHERE id = ?5 AND op_id = ?6)`,
        )
        .bind(now, expiresFrom(now), row.id, user.id, turnId, opId),
    ],
    conflict: async () => {
      const inflight = await db.prepare(`SELECT 1 AS x FROM assist_turns WHERE case_id = ?1 AND status IN ('queued', 'running')`).bind(row.id).first<{ x: number }>();
      return new ApiError(409, 'conflict', inflight ? '這一題正在處理中，請稍候' : '這一題的狀態剛剛改變了，請重新整理');
    },
  });
});

// ───────────────────────── 學習報告（WP-C） ─────────────────────────

mountReportRoutes(assistRoutes);
