/**
 * /api/exemplars：作文範文（docs/design/model-essays.md §5.5、§7.1）。
 *
 *   GET    /                         我的範文（新到舊，每頁 20）：{ sets, next_cursor }                         登入
 *   POST   /                         建立：200 ExemplarSetDetail（共用快取命中、或自己之前產生過）／202 { id, op_id, status }   AI
 *   GET    /site-status?group_id=    { group_id, title, cached, points }（確認畫面用；不讀不寫任何個人資料）     登入
 *   GET    /:id                      詳情（前端輪詢這支）；別人的 404                                            登入
 *   PATCH  /:id                      { rating: 'helpful' | 'wrong' | null }；wrong 觸發共用快取的停用計數          登入
 *   DELETE /:id                      刪除；產生中 409                                                            登入
 * 「AI」＝登入、開關對這位使用者開放（exemplarsAccess；否則 503，公開端點不透露有預覽）、AI 核准（未核准 403、待同意 403
 * consent_required）、AI 已設定、D8 指紋可用（壞掉 503）。讀、評分、刪除不看開關與核准（開關關著或被撤銷核准時，學生仍然可以
 * 看與刪除自己的資料，同學習助手）。所有 SQL 帶 user_id；查得到但不是你的一律 404。
 *
 * POST 的檢查順序（§5.5）：上面的權限 → 本體（≤ 8 KB、JSON、zod）→
 *   網站題目：題目庫沒有這一題 409（Worker 還不認得）；不在白名單 409 exemplar_unavailable。
 *   自訂題：checkCustomPrompt（訊息換成範文模式的版本）→ 範文模式的字數範圍 → D8 指紋 → 網站題目比對（沒帶 allow_custom 時 409
 *   exemplar_site_match，回網站的題組 id 與標題）。
 * → 去重（同一題進行中的回那一組；完成、沒過期、不是重新產生的回那一組）→ 網站題目、不是重新產生：查共用快取，命中就以條件式
 * INSERT 寫一列 done（每日建立數、保留數）→ 200（0 點、不建立 ai_ops）→ 回收卡住的預扣 → 預扣 → 條件式 INSERT 一列 queued
 * （每日建立數、保留數；同一個 batch 寫建立紀錄與注入事件；寫不進去以 internal 退還並回 429 exemplar_limit；唯一索引衝突退還並回
 * 那一組）→ 排入 Queue（失敗退還、列改 failed、回 500）→ 202。
 * 日誌只記 id、代碼與數字，不記題目或範文。
 */
import {
  AI_ERROR_MESSAGES,
  AI_TASK_POINTS,
  CUSTOM_PROMPT_LIMITS,
  CUSTOM_PROMPT_RULES_VERSION,
  EXEMPLAR_LEVELS_VERSION,
  EXEMPLAR_LIMITS,
  EXEMPLAR_PROMPT_PROBLEM_MESSAGES,
  WRITING_UNKNOWN_GROUP_MESSAGE,
  checkCustomPrompt,
  customPromptFlagCodes,
  exemplarCustomWordProblem,
  type CustomPromptField,
  type ExemplarSetListResponse,
  type ExemplarSiteStatus,
  type ExemplarSource,
} from '@gsat/shared';
import { Hono, type Context } from 'hono';
import * as z from 'zod/v4';
import { readJsonBody } from '../account/validate';
import { buildClaudeRequest } from '../ai/client';
import { d8Fingerprints, mergeRanges, officialMaterialHits, requireD8Fingerprints, type D8Fingerprints } from '../ai/d8';
import { FILTER_VERSION } from '../ai/filter';
import { reserveOp, siteLimitsMicros, userLimits } from '../ai/guard';
import { reclaimStaleOps } from '../ai/housekeeping';
import { opsEvent, userRefFor } from '../ai/ledger';
import { EXEMPLAR_CUSTOM_TEMPLATE_VERSION, EXEMPLAR_SITE_TEMPLATE_VERSION } from '../ai/prompts/exemplars';
import { reserveFailure } from '../ai/reserveErrors';
import { reserveMicros, taskConfig, taskModelsPriced } from '../ai/tasks';
import { taiwanDayStart } from '../assist/repo';
import { assertAiApproved, getSessionUser, requireUser, type SessionUser } from '../auth/session';
import { loadConfig, type AppConfig } from '../config';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { exemplarsAccess } from '../features';
import { nowSeconds } from '../time';
import { exemplarCacheKey, flagExemplarCacheIfDisputed, lookupExemplarCache } from './cache';
import { refundWithExemplarSet, EXEMPLAR_RETENTION_SECONDS } from './refund';
import {
  buildExemplarMeta,
  createdMarkStatement,
  customDedupeKey,
  customTitle,
  decodeCursor,
  encodeCursor,
  EXEMPLAR_COLUMNS,
  EXEMPLAR_PAGE_SIZE,
  exemplarSetsToday,
  listExemplarSets,
  promptJsonOf,
  requireExemplarSet,
  setsTodaySql,
  siteDedupeKey,
  toDetail,
  toSummary,
  type ExemplarSetRow,
} from './repo';
import { exemplarCallInput, type ExemplarCustomPrompt, type ExemplarRequest } from './requests';
import { exemplarSiteGroup, siteSourceOf, siteTitle } from './siteGroups';
import { matchSiteGroup } from './siteMatch';

export const exemplarRoutes = new Hono<AppEnv>();

function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}

const createSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('site'), group_id: z.string().min(1).max(120), fresh: z.boolean().optional() }).strict(),
  z
    .object({
      source: z.literal('custom'),
      prompt: z.record(z.string(), z.unknown()),
      allow_custom: z.boolean().optional(),
      fresh: z.boolean().optional(),
    })
    .strict(),
]);

const patchSchema = z.object({ rating: z.enum(['helpful', 'wrong']).nullable() }).strict();

async function sessionUser(c: Context<AppEnv>): Promise<SessionUser> {
  const user = await getSessionUser(c);
  if (!user) throw new ApiError(401, 'unauthorized', '請先登入');
  return user;
}

/** 寫入類端點的開關、核准、設定與 D8 檢查（順序見檔頭；同學習助手的 writeGate）。 */
async function writeGate(c: Context<AppEnv>): Promise<{ user: SessionUser; config: AppConfig; fp: D8Fingerprints }> {
  const user = await sessionUser(c);
  const config = loadConfig(c.env);
  if (!exemplarsAccess(config, user.role).enabled) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  assertAiApproved(user);
  if (!config.ai.configured || !c.env.AI_QUEUE) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  const fp = await requireD8Fingerprints(c.env.DB);
  if (!fp) throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  return { user, config, fp };
}

/** 題目規則不合 → 400 custom_prompt_invalid（訊息是範文模式的版本）；log 只記原因、欄位、假名與規則版本。 */
function rejected(reason: keyof typeof EXEMPLAR_PROMPT_PROBLEM_MESSAGES, field: CustomPromptField, ranges: Array<[number, number]> | undefined, ref: string | null): ApiError {
  log('exemplar_prompt_rejected', { reason, field, user_ref: ref, rules: CUSTOM_PROMPT_RULES_VERSION });
  return new ApiError(400, 'custom_prompt_invalid', EXEMPLAR_PROMPT_PROBLEM_MESSAGES[reason], { reason, field, ...(ranges && ranges.length > 0 ? { ranges } : {}) });
}

/**
 * 自訂題的檢查（§5.1）：型別（程式錯誤 400 bad_request）→ checkCustomPrompt（同自訂作文題目，規則一字不差）→ 範文模式的字數範圍
 * → D8 指紋。通過回正規化後的值（存的就是它）。真模型評測工具（test/parity/exemplars.parity.ts）用同一支檢查題目集。
 */
export function checkExemplarPrompt(raw: Record<string, unknown>, fp: D8Fingerprints, ref: string | null): ExemplarCustomPrompt {
  const figure = raw['figure_text'];
  if (figure !== undefined && figure !== null && typeof figure !== 'string') throw new ApiError(400, 'bad_request', 'prompt.figure_text 必須是字串或 null');
  const L = CUSTOM_PROMPT_LIMITS;
  if (typeof raw['text'] === 'string' && raw['text'].length > L.textRawMaxChars) throw rejected('text_too_long', 'text', undefined, ref);
  if (typeof figure === 'string' && figure.length > L.figureRawMaxChars) throw rejected('figure_too_long', 'figure_text', undefined, ref);
  const r = checkCustomPrompt(raw);
  if (!r.ok) {
    const first = r.problems[0]!;
    const ranges = r.problems
      .filter((p) => p.code === first.code && p.field === first.field && p.start !== undefined && p.end !== undefined)
      .map((p): [number, number] => [p.start!, p.end!]);
    throw rejected(first.code, first.field, ranges.length > 0 ? mergeRanges(ranges) : undefined, ref);
  }
  const words = exemplarCustomWordProblem(r.value);
  if (words) throw rejected(words.code, words.field, undefined, ref);
  const hit = officialMaterialHits(fp, r.value.text, r.value.figure_text);
  if (hit) throw rejected('official_material', hit.field, hit.ranges, ref);
  return r.value;
}

/** 依題組 id 取白名單的網站題目；題目庫沒有 409（Worker 還不認得）、不在白名單 409 exemplar_unavailable。 */
function requireSiteGroup(groupId: string) {
  const g = exemplarSiteGroup(groupId);
  if (g === 'missing') throw new ApiError(409, 'conflict', WRITING_UNKNOWN_GROUP_MESSAGE, { reason: 'unknown_group' });
  if (g === 'unavailable') throw new ApiError(409, 'exemplar_unavailable', '這一題目前不提供範文。');
  return g;
}

/** 條件式 INSERT 的建立數上限（每天建立的組數＜20、保留的組數＜300）。參數是佔位符的名字。 */
function capsSql(user: string, dayStart: string, ref: string, dayLimit: string, storedLimit: string): string {
  return `${setsTodaySql(user, dayStart, ref)} < ${dayLimit} AND (SELECT COUNT(*) FROM exemplar_sets WHERE user_id = ${user}) < ${storedLimit}`;
}

/** 建立數上限擋下時，判斷是哪一個（429 exemplar_limit）。 */
async function limitError(db: D1Database, userId: number, ref: string | null, dayStart: number): Promise<ApiError> {
  if ((await exemplarSetsToday(db, userId, ref, dayStart)) >= EXEMPLAR_LIMITS.setsPerDay) {
    return new ApiError(429, 'exemplar_limit', `今天已經產生 ${EXEMPLAR_LIMITS.setsPerDay} 組範文，明天再繼續`, { reason: 'sets_per_day' });
  }
  return new ApiError(429, 'exemplar_limit', `我的範文已經有 ${EXEMPLAR_LIMITS.setsStored} 組，請先刪掉一些舊的`, { reason: 'sets_stored' });
}

/** 讀一列（不檢查到期；去重與 UNIQUE 衝突時用）。 */
async function rowById(db: D1Database, userId: number, id: string): Promise<ExemplarSetRow | null> {
  return db.prepare(`SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first<ExemplarSetRow>();
}

/** 去重：同一題進行中的那一組；allowDone 時另找完成、沒過期的最新一組。 */
async function existingSet(db: D1Database, userId: number, dedupeKey: string, now: number, allowDone: boolean): Promise<ExemplarSetRow | null> {
  const inflight = await db
    .prepare(`SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets WHERE user_id = ?1 AND dedupe_key = ?2 AND status IN ('queued', 'running') LIMIT 1`)
    .bind(userId, dedupeKey)
    .first<ExemplarSetRow>();
  if (inflight || !allowDone) return inflight;
  return db
    .prepare(
      `SELECT ${EXEMPLAR_COLUMNS} FROM exemplar_sets WHERE user_id = ?1 AND dedupe_key = ?2 AND status = 'done' AND expires_at > ?3
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(userId, dedupeKey, now)
    .first<ExemplarSetRow>();
}

/** 列的版本欄位（meta_json；結算時 consumer 換成完整的 meta）。 */
function baseMeta(source: ExemplarSource, fp: D8Fingerprints, extra: Record<string, unknown> = {}): string {
  return buildExemplarMeta({
    versions: {
      levels: EXEMPLAR_LEVELS_VERSION,
      filter_version: FILTER_VERSION,
      d8_fp: fp.version,
      template: source === 'custom' ? EXEMPLAR_CUSTOM_TEMPLATE_VERSION : EXEMPLAR_SITE_TEMPLATE_VERSION,
      ...(source === 'custom' ? { custom_rules: CUSTOM_PROMPT_RULES_VERSION } : {}),
    },
    fields: extra,
  });
}

/** 共用快取的鍵（實際會送出的整個請求；路由與 consumer 用同一套函式）。 */
async function cacheKeyFor(config: AppConfig, req: ExemplarRequest, fp: D8Fingerprints): Promise<{ key: string; promptVersion: string; model: string }> {
  const input = exemplarCallInput(taskConfig('essay_exemplars', config), req);
  const built = await buildClaudeRequest(input);
  const key = await exemplarCacheKey({ promptVersion: built.promptVersion, model: input.spec.model, effort: input.spec.effort, d8Version: fp.version, userText: input.content as string });
  return { key, promptVersion: built.promptVersion, model: input.spec.model };
}

// ───────────────────────── 讀取 ─────────────────────────

exemplarRoutes.use('*', requireUser());

exemplarRoutes.get('/', async (c) => {
  const user = await sessionUser(c);
  const now = nowSeconds();
  const cursor = decodeCursor(c.req.query('cursor'));
  const rows = await listExemplarSets(c.env.DB, user.id, now, cursor);
  const page = rows.slice(0, EXEMPLAR_PAGE_SIZE);
  const last = page[page.length - 1];
  const body: ExemplarSetListResponse = { sets: page.map(toSummary), next_cursor: rows.length > EXEMPLAR_PAGE_SIZE && last ? encodeCursor(last) : null };
  return c.json(body);
});

exemplarRoutes.get('/site-status', async (c) => {
  await sessionUser(c);
  const groupId = c.req.query('group_id') ?? '';
  if (groupId === '' || groupId.length > 120) throw new ApiError(400, 'bad_request', '請指定題組');
  const g = requireSiteGroup(groupId);
  const source = siteSourceOf(g)!;
  const config = loadConfig(c.env);
  const fp = d8Fingerprints();
  let cached = false;
  // 只查共用快取（不讀不寫任何個人資料）；模型不在價格表、指紋檔壞掉時當成沒有快取（產生時會另外回 503）。
  if (fp) {
    try {
      const { key } = await cacheKeyFor(config, { source, group: g }, fp);
      cached = (await lookupExemplarCache(c.env.DB, key, nowSeconds())) !== null;
    } catch {
      cached = false;
    }
  }
  const body: ExemplarSiteStatus = { group_id: g.group_id, title: siteTitle(g), cached, points: cached ? 0 : AI_TASK_POINTS.essay_exemplars };
  return c.json(body);
});

exemplarRoutes.get('/:id', async (c) => {
  const user = await sessionUser(c);
  const row = await requireExemplarSet(c.env.DB, user.id, c.req.param('id'), nowSeconds());
  return c.json(toDetail(row));
});

// ───────────────────────── 評分、刪除 ─────────────────────────

exemplarRoutes.patch('/:id', async (c) => {
  const user = await sessionUser(c);
  const body = await readJsonBody(c, patchSchema, 1_024);
  const db = c.env.DB;
  const now = nowSeconds();
  const row = await requireExemplarSet(db, user.id, c.req.param('id'), now);
  if (row.status !== 'done') throw new ApiError(409, 'conflict', '範文完成之後才能評分');
  await db
    .prepare(`UPDATE exemplar_sets SET rating = ?1, updated_at = ?2, expires_at = ?3 WHERE id = ?4 AND user_id = ?5`)
    .bind(body.rating, now, now + EXEMPLAR_RETENTION_SECONDS, row.id, user.id)
    .run();
  // 「這組範文有問題」：命中或真的寫入過共用快取的列（同一代）兩位不同的學生都回報，就停用那一筆（§4.3）。
  if (body.rating === 'wrong' && row.cache_key !== null && row.cache_gen !== null) await flagExemplarCacheIfDisputed(db, row.cache_key, row.cache_gen);
  return c.json(toDetail(await requireExemplarSet(db, user.id, row.id, now)));
});

exemplarRoutes.delete('/:id', async (c) => {
  const user = await sessionUser(c);
  const db = c.env.DB;
  const id = c.req.param('id');
  const res = await db.prepare(`DELETE FROM exemplar_sets WHERE id = ?1 AND user_id = ?2 AND status NOT IN ('queued', 'running')`).bind(id, user.id).run();
  if ((res.meta.changes ?? 0) === 1) return c.body(null, 204);
  const exists = await db.prepare('SELECT 1 AS x FROM exemplar_sets WHERE id = ?1 AND user_id = ?2').bind(id, user.id).first<{ x: number }>();
  if (!exists) throw new ApiError(404, 'not_found', '找不到這一組範文');
  throw new ApiError(409, 'conflict', '範文產生中，完成後再刪');
});

// ───────────────────────── 建立 ─────────────────────────

exemplarRoutes.post('/', async (c) => {
  const { user, config, fp } = await writeGate(c);
  const body = await readJsonBody(c, createSchema, EXEMPLAR_LIMITS.bodyMaxBytes);
  const db = c.env.DB;
  const nowMs = Date.now();
  const now = nowSeconds(nowMs);
  const ref = await userRefFor(config.auth.ledgerSalt, user.id);
  const fresh = body.fresh === true;

  // 題目：網站題目（白名單）或自訂題（規則、字數範圍、D8、網站題目比對）。
  let req: ExemplarRequest;
  let title: string;
  let dedupeKey: string;
  let groupId: string | null = null;
  let promptJson: string | null = null;
  let injection: string[] = [];
  if (body.source === 'site') {
    const g = requireSiteGroup(body.group_id);
    req = { source: siteSourceOf(g)!, group: g };
    title = siteTitle(g);
    groupId = g.group_id;
    dedupeKey = await siteDedupeKey(g.group_id);
  } else {
    const prompt = checkExemplarPrompt(body.prompt, fp, ref);
    if (body.allow_custom !== true) {
      const match = matchSiteGroup([prompt.text, ...(prompt.figure_text ? [prompt.figure_text] : [])]);
      if (match) {
        log('exemplar_site_match', { group_id: match.group_id, coverage: Math.round(match.coverage * 100) / 100 });
        throw new ApiError(409, 'exemplar_site_match', `這一題和網站上的「${match.title}」相同。改用網站題目時，如果之前有同學產生過就不用點數。`, {
          group_id: match.group_id,
          title: match.title,
        });
      }
    }
    req = { source: 'custom', prompt };
    title = customTitle(prompt);
    promptJson = promptJsonOf(prompt);
    dedupeKey = await customDedupeKey(prompt);
    injection = customPromptFlagCodes(prompt).map((code) => `prompt:${code}`);
  }

  // 去重：同一題進行中的回那一組；完成、沒過期、不是重新產生的回那一組（不扣點）。
  const existing = await existingSet(db, user.id, dedupeKey, now, !fresh);
  if (existing) return c.json(toDetail(existing, { existing: true }), 200);

  const tc = taskConfig('essay_exemplars', config);
  if (!taskModelsPriced(tc)) {
    await opsEvent(db, 'ai_model_not_priced', 'error', { task: tc.task, models: tc.calls.map((x) => x.model) });
    throw new ApiError(503, 'not_configured', AI_ERROR_MESSAGES.not_configured);
  }
  const dayStart = taiwanDayStart(nowMs);
  const id = crypto.randomUUID();
  const expires = now + EXEMPLAR_RETENTION_SECONDS;

  // 共用快取（只有網站題目、不是重新產生）：命中就寫一列 done（0 點、不建立 ai_ops）。
  if (req.source !== 'custom' && !fresh) {
    const { key, promptVersion, model } = await cacheKeyFor(config, req, fp);
    const hit = await lookupExemplarCache(db, key, now);
    if (hit) {
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO exemplar_sets (id, user_id, source, group_id, prompt_json, dedupe_key, title, status, op_id, fresh, cache_hit, cache_key, cache_gen,
                                        output_json, prompt_version, served_model, meta_json, created_at, updated_at, expires_at)
             SELECT ?1, ?2, ?3, ?4, NULL, ?5, ?6, 'done', NULL, 0, 1, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14
              WHERE ${capsSql('?2', '?15', '?16', '?17', '?18')}`,
          )
          .bind(id, user.id, req.source, groupId, dedupeKey, title, key, hit.created_at, hit.result_json, promptVersion, model, baseMeta(req.source, fp, { cache_hit: true }), now, expires, dayStart, ref, EXEMPLAR_LIMITS.setsPerDay, EXEMPLAR_LIMITS.setsStored),
        ...(ref ? [createdMarkStatement(db, ref, id, user.id, now)] : []),
        db.prepare(`UPDATE ai_shared_cache SET hits = hits + 1, last_hit_at = ?1 WHERE cache_key = ?2 AND EXISTS (SELECT 1 FROM exemplar_sets WHERE id = ?3)`).bind(now, key, id),
      ]);
      if ((results[0]?.meta.changes ?? 0) !== 1) throw await limitError(db, user.id, ref, dayStart);
      log('exemplar_cache_hit', { id, source: req.source });
      return c.json(toDetail((await rowById(db, user.id, id))!), 200);
    }
  }

  // 卡住的預扣先回收，才不會佔住同時任務名額與全站預算（同 /api/ai/*）。
  try {
    await reclaimStaleOps(db, nowMs);
  } catch (err) {
    console.error('回收卡住的預扣失敗（不影響這次請求）', err);
  }
  const opId = crypto.randomUUID();
  const reserved = await reserveOp(db, {
    opId,
    userId: user.id,
    task: tc.task,
    refId: id,
    points: tc.points,
    usdMicros: reserveMicros(tc),
    family: tc.family,
    limits: userLimits(config, user),
    site: siteLimitsMicros(config),
    nowMs,
  });
  if (!reserved.ok) throw await reserveFailure(db, reserved.code, ref, tc.task, nowMs);
  const op = { id: opId, user_id: user.id, task: tc.task, ref_id: id };

  let inserted = false;
  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO exemplar_sets (id, user_id, source, group_id, prompt_json, dedupe_key, title, status, op_id, fresh, injection_flag, meta_json,
                                      created_at, updated_at, expires_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9, ?10, ?11, ?12, ?12, ?13
            WHERE ${capsSql('?2', '?14', '?15', '?16', '?17')}`,
        )
        .bind(id, user.id, req.source, groupId, promptJson, dedupeKey, title, opId, fresh ? 1 : 0, injection.length > 0 ? 1 : 0, baseMeta(req.source, fp), now, expires, dayStart, ref, EXEMPLAR_LIMITS.setsPerDay, EXEMPLAR_LIMITS.setsStored),
      ...(ref ? [createdMarkStatement(db, ref, id, user.id, now)] : []),
      ...(injection.length > 0
        ? [
            db
              .prepare(`INSERT INTO ai_safety_events (op_id, kind, category, user_ref) SELECT ?1, 'injection_flag', ?2, ?3 WHERE EXISTS (SELECT 1 FROM exemplar_sets WHERE id = ?4 AND op_id = ?1)`)
              .bind(opId, injection.join(',').slice(0, 200), ref, id),
          ]
        : []),
    ]);
    inserted = results[0]?.meta.changes === 1;
  } catch (err) {
    // 同一題剛好同時建立（唯一索引 idx_exemplar_sets_inflight）：退還這次的預扣，回進行中的那一組。
    if (/UNIQUE/i.test(String(err))) {
      await refundWithExemplarSet(db, op, 'internal', Date.now()).catch((e) => console.error('退還失敗，交給 housekeeping 回收', opId, e));
      const again = await existingSet(db, user.id, dedupeKey, now, false);
      if (again) return c.json(toDetail(again, { existing: true }), 200);
      throw new ApiError(409, 'conflict', '這一題正在產生中，請稍後再試');
    }
    console.error('寫入作文範文失敗，退還點數', opId, err);
  }
  if (!inserted) {
    // 建立數上限（或寫入失敗）：立即以 internal 退還；沒有 ai_calls，成本 0。
    await refundWithExemplarSet(db, op, 'internal', Date.now()).catch((err) => console.error('退還失敗，交給 housekeeping 回收', opId, err));
    throw await limitError(db, user.id, ref, dayStart);
  }
  log('ai_task_queued', { op_id: opId, task: tc.task, id, source: req.source, fresh, injection: injection.length > 0 });
  try {
    await c.env.AI_QUEUE!.send({ op_id: opId });
  } catch (err) {
    console.error('排入 Queue 失敗，退還點數', opId, err);
    await refundWithExemplarSet(db, op, 'internal', Date.now()).catch((e) => console.error('退還失敗，交給 housekeeping 回收', opId, e));
    throw new ApiError(500, 'internal_error', '送出失敗，點數已退還，請稍後再試');
  }
  return c.json({ id, op_id: opId, status: 'queued' as const }, 202);
});
