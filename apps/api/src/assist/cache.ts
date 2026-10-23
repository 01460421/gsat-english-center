/**
 * 學習助手解析的共用快取（docs/design/learning-assistant.md §4.7.4）：0 點、不呼叫模型。
 *
 * 規則：凡是會進提示的輸入，不是在快取鍵裡，就是讓這個請求不能進快取。所以鍵直接取整個請求：
 *   cache_key = sha256('assist_analyze|v1|' + prompt_version + '|' + model + '|' + effort + '|' + FILTER_VERSION + '|' + d8.version
 *                      + '|' + sha256(實際組好的 user 訊息全文))
 *   prompt_version 涵蓋系統提示、schema、範本版本與框架；user 訊息涵蓋來源與題號（含自組卷的卷面題號與交換後的字母）、
 *   可接受答案、程式判定、學生答案與同組其他格、疑問種類、顯示模式、via。指紋檔或過濾規則換新之後舊的列自然不再命中。
 * 只有和學生身分無關的請求才讀寫（requests.ts 的 isCacheable：站內題、沒有自由輸入的疑問、不帶 <student_patterns>）。
 *
 *   命中：一句條件式 INSERT 寫一列 done、cache_hit=1 的 turn（沒有進行中的 turn、成功解析不到 2 次、案例狀態可以解析），
 *         插進去了才在同一個 batch 把案例改 analyzed、analyses = MIN(analyses + 1, 2)、寫技能與錯因、快取 hits + 1。
 *   寫入：解析成功而且沒有段落被過濾或被 D8 隱藏、key_concern 是空的、safety_flag 是 none、沒有注入旗標、顯示 JSON ≤ 32,768 字元。
 *         不在結算交易裡：失敗只記 log。
 *   停用：不同的兩位學生在命中同一個 cache_key 的案例按「這則解析有錯」→ status='flagged'，之後不再提供，寫 ops 事件。
 * ai_shared_cache 用既有的 kind='explain_template'（CHECK 已允許），不改這張表。
 */
import { ASSIST_LIMITS } from '@gsat/shared';
import { FILTER_VERSION } from '../ai/filter';
import { opsEvent } from '../ai/ledger';
import { sha256Text } from './hash';
import { mergeCodes } from './repo';

/** 快取鍵的格式版本（改了算法就換）。 */
export const ASSIST_CACHE_KEY_VERSION = 'v1';
/** 共用快取的 kind（0001 的 CHECK 允許的值）。 */
export const ASSIST_CACHE_KIND = 'explain_template';
/** result_json 的上限（ai_shared_cache 的 CHECK）。 */
export const ASSIST_CACHE_MAX_CHARS = 32_768;
/** 停用門檻：幾位不同的學生回報「這則有錯」。 */
export const ASSIST_CACHE_FLAG_USERS = 2;

export interface CacheKeyParts {
  promptVersion: string;
  model: string;
  effort: string;
  d8Version: string;
  userText: string;
}

export async function assistCacheKey(p: CacheKeyParts): Promise<string> {
  const inner = await sha256Text(p.userText);
  return sha256Text(['assist_analyze', ASSIST_CACHE_KEY_VERSION, p.promptVersion, p.model, p.effort, FILTER_VERSION, p.d8Version, inner].join('|'));
}

/** 快取列的 ref_id：「題組或考卷#排序後的題號」（停用與 ops 事件用，不含學生的任何資料）。 */
export function cacheRefId(refJson: string): string {
  try {
    const ref = JSON.parse(refJson) as { ref?: string; exam_id?: string; labels?: string[] };
    return `${ref.ref ?? ref.exam_id ?? 'unknown'}#${(ref.labels ?? []).join(',')}`.slice(0, 200);
  } catch {
    return 'unknown';
  }
}

/** 讀一筆還能用的快取（active、沒過期）。 */
export async function lookupCache(db: D1Database, key: string, now: number): Promise<{ result_json: string } | null> {
  return db.prepare(`SELECT result_json FROM ai_shared_cache WHERE cache_key = ?1 AND status = 'active' AND expires_at > ?2`).bind(key, now).first<{ result_json: string }>();
}

export interface CacheHitInput {
  turnId: string;
  caseId: string;
  userId: number;
  key: string;
  resultJson: string;
  /** 案例現有的技能、錯因與快取內容的合併結果（JSON 字串）。 */
  skillsJson: string;
  errorsJson: string;
  meta: Record<string, unknown>;
  now: number;
}

/**
 * 命中：條件式 INSERT turn（§4.4 第 9 步）＋同一個 batch 更新案例與快取的命中次數。回傳 turn 有沒有插進去
 * （false：有進行中的 turn、已經解析過 2 次，或案例狀態不能解析；呼叫端查是哪一個）。
 */
export async function insertCacheHitTurn(db: D1Database, h: CacheHitInput): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO assist_turns (id, case_id, user_id, seq, kind, status, op_id, output_json, cache_hit, meta_json, created_at, updated_at)
         SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(seq), 0) + 1 FROM assist_turns WHERE case_id = ?2), 'analyze', 'done', NULL, ?4, 1, ?5, ?6, ?6
          WHERE NOT EXISTS (SELECT 1 FROM assist_turns WHERE case_id = ?2 AND status IN ('queued', 'running'))
            AND (SELECT analyses FROM assist_cases WHERE id = ?2 AND user_id = ?3) < ?7
            AND (SELECT status FROM assist_cases WHERE id = ?2 AND user_id = ?3) IN ('ready', 'analyzed', 'failed')`,
      )
      .bind(h.turnId, h.caseId, h.userId, h.resultJson, JSON.stringify(h.meta), h.now, ASSIST_LIMITS.analysesPerCase),
    db
      .prepare(
        `UPDATE assist_cases SET status = 'analyzed', analyses = MIN(analyses + 1, ?1), skills_json = ?2, errors_json = ?3, cache_key = ?4,
                updated_at = ?5, expires_at = ?6
          WHERE id = ?7 AND user_id = ?8 AND EXISTS (SELECT 1 FROM assist_turns WHERE id = ?9 AND case_id = ?7)`,
      )
      .bind(ASSIST_LIMITS.analysesPerCase, h.skillsJson, h.errorsJson, h.key, h.now, h.now + ASSIST_LIMITS.retentionDays * 86_400, h.caseId, h.userId, h.turnId),
    db
      .prepare(`UPDATE ai_shared_cache SET hits = hits + 1, last_hit_at = ?1 WHERE cache_key = ?2 AND EXISTS (SELECT 1 FROM assist_turns WHERE id = ?3)`)
      .bind(h.now, h.key, h.turnId),
  ]);
  return results[0]?.meta.changes === 1;
}

/** 寫入共用快取（不在結算交易裡；失敗只記 log）。已經有同一個鍵（含停用的）就不動。 */
export async function writeCache(db: D1Database, w: { key: string; refId: string; promptVersion: string; model: string; resultJson: string; now: number }): Promise<void> {
  if (w.resultJson.length > ASSIST_CACHE_MAX_CHARS) return;
  try {
    await db
      .prepare(
        `INSERT INTO ai_shared_cache (cache_key, kind, ref_id, prompt_version, model, result_json, status, hits, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 0, ?7, ?8)
         ON CONFLICT(cache_key) DO NOTHING`,
      )
      .bind(w.key, ASSIST_CACHE_KIND, w.refId, w.promptVersion, w.model, w.resultJson, w.now, w.now + ASSIST_LIMITS.retentionDays * 86_400)
      .run();
  } catch (err) {
    console.error('寫入學習助手的共用快取失敗（不影響這次解析）', err);
  }
}

/**
 * 「這則解析有錯」之後：不同的兩位學生在命中同一個 cache_key 的案例回報有錯，就停用這筆快取並寫 ops 事件（第一位只記錄）。
 */
export async function flagCacheIfDisputed(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM assist_cases WHERE cache_key = ?1 AND rating = 'wrong'`).bind(key).first<{ n: number }>();
  const users = row?.n ?? 0;
  if (users < ASSIST_CACHE_FLAG_USERS) return false;
  const res = await db.prepare(`UPDATE ai_shared_cache SET status = 'flagged' WHERE cache_key = ?1 AND status = 'active'`).bind(key).run();
  if ((res.meta.changes ?? 0) === 0) return false;
  const ref = await db.prepare('SELECT ref_id FROM ai_shared_cache WHERE cache_key = ?1').bind(key).first<{ ref_id: string }>();
  await opsEvent(db, 'assist_cache_flagged', 'warn', { ref_id: ref?.ref_id ?? null, users });
  return true;
}

/** 案例的技能與錯因併進快取內容的代碼（命中時用）。 */
export function mergeCaseCodes(existing: { skills: readonly string[]; errors: readonly string[] }, added: { skills: readonly string[]; errors: readonly string[] }): { skillsJson: string; errorsJson: string } {
  return { skillsJson: mergeCodes(existing.skills, added.skills), errorsJson: mergeCodes(existing.errors, added.errors) };
}
