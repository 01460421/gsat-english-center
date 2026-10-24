/**
 * 作文範文的共用快取（docs/design/model-essays.md §4.3）：只給白名單的網站題目（歷屆題、本站仿真題）。學生自己輸入的題目
 * 永遠不讀不寫（服務條款「你上傳的題目」：不公開、不分享；就算兩位學生貼了一樣的題目也不共用）。
 *
 * 沿用 ai_shared_cache（不改表）：kind='explain_template'（0001 的 CHECK 允許的值，同學習助手），ref_id＝'exemplar:{group_id}'。
 * 鍵＝整個請求的雜湊（會進提示的輸入，不是在鍵裡就是不能快取）：
 *   cache_key = sha256('essay_exemplars|v1|' + prompt_version + '|' + model + '|' + effort + '|' + FILTER_VERSION + '|' + d8.version
 *                      + '|' + sha256(實際組好的 user 訊息全文))
 * prompt_version 涵蓋系統提示（含層級規格與建議用時）、schema、範本版本；user 訊息涵蓋題目、圖片描述與字數目標。
 *
 *   命中   路由在預扣之前查（lookupExemplarCache）；讀到 created_at 一起記成學生那一列的 cache_gen（快取的「代」）。
 *   寫入   結算成功、不是 tainted、safety_flag 是 none、實際服務的模型＝請求的模型、JSON ≤ 32,768 字元、不是重新產生（consumer 判斷）。
 *          INSERT … ON CONFLICT DO UPDATE … WHERE 舊列被停用（或已經過期）：可用的列不動；被停用的列由新的結果取代（學習助手是
 *          DO NOTHING，範文題目只有 111 題，取代比較合理）。只有真的寫入或取代（changes = 1）才回傳這一代的 created_at，
 *          consumer 才記 cache_key 與 cache_gen；撞到別人剛寫好的列時兩欄留 NULL（他的回報不能算到別人的內容上）。
 *          不在結算交易裡：失敗只記 log。
 *   停用   「這組範文有問題」：同一個 cache_key、同一代（cache_gen）有兩位不同的學生回報 wrong，而且那一代就是目前的快取列，
 *          才把那一列改 flagged、寫 ops 事件 exemplar_cache_flagged（只有 ref_id 與人數）。
 */
import { EXEMPLAR_LIMITS } from '@gsat/shared';
import { FILTER_VERSION } from '../ai/filter';
import { opsEvent } from '../ai/ledger';
import { sha256Text } from '../assist/hash';

export const EXEMPLAR_CACHE_KEY_VERSION = 'v1';
/** 共用快取的 kind（0001 的 CHECK 允許的值）。 */
export const EXEMPLAR_CACHE_KIND = 'explain_template';
/** result_json 的上限（ai_shared_cache 的 CHECK）。 */
export const EXEMPLAR_CACHE_MAX_CHARS = 32_768;
/** 停用門檻：同一代有幾位不同的學生回報有問題。 */
export const EXEMPLAR_CACHE_FLAG_USERS = 2;

export function exemplarCacheRefId(groupId: string): string {
  return `exemplar:${groupId}`;
}

export interface ExemplarCacheKeyParts {
  promptVersion: string;
  model: string;
  effort: string;
  d8Version: string;
  userText: string;
}

export async function exemplarCacheKey(p: ExemplarCacheKeyParts): Promise<string> {
  const inner = await sha256Text(p.userText);
  return sha256Text(['essay_exemplars', EXEMPLAR_CACHE_KEY_VERSION, p.promptVersion, p.model, p.effort, FILTER_VERSION, p.d8Version, inner].join('|'));
}

/** 讀一筆還能用的快取（active、沒過期）與它的「代」（created_at）。 */
export async function lookupExemplarCache(db: D1Database, key: string, now: number): Promise<{ result_json: string; created_at: number } | null> {
  return db
    .prepare(`SELECT result_json, created_at FROM ai_shared_cache WHERE cache_key = ?1 AND status = 'active' AND expires_at > ?2`)
    .bind(key, now)
    .first<{ result_json: string; created_at: number }>();
}

/** 這個鍵目前（任何狀態）的那一代；沒有回 null。 */
export async function currentExemplarCacheGen(db: D1Database, key: string): Promise<number | null> {
  const row = await db.prepare('SELECT created_at FROM ai_shared_cache WHERE cache_key = ?1').bind(key).first<{ created_at: number }>();
  return row?.created_at ?? null;
}

/**
 * 寫入或取代共用快取（見檔頭）。回傳這次真的寫入或取代時的「代」（＝now），撞到可用的列或失敗時回 null。
 */
export async function writeExemplarCache(db: D1Database, w: { key: string; groupId: string; promptVersion: string; model: string; resultJson: string; now: number }): Promise<number | null> {
  if (w.resultJson.length > EXEMPLAR_CACHE_MAX_CHARS) return null;
  try {
    const res = await db
      .prepare(
        `INSERT INTO ai_shared_cache (cache_key, kind, ref_id, prompt_version, model, result_json, status, hits, created_at, last_hit_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 0, ?7, NULL, ?8)
         ON CONFLICT(cache_key) DO UPDATE SET
           ref_id = excluded.ref_id, prompt_version = excluded.prompt_version, model = excluded.model, result_json = excluded.result_json,
           status = 'active', hits = 0, created_at = excluded.created_at, last_hit_at = NULL, expires_at = excluded.expires_at
         WHERE ai_shared_cache.status = 'flagged' OR ai_shared_cache.expires_at <= excluded.created_at`,
      )
      .bind(w.key, EXEMPLAR_CACHE_KIND, exemplarCacheRefId(w.groupId), w.promptVersion, w.model, w.resultJson, w.now, w.now + EXEMPLAR_LIMITS.retentionDays * 86_400)
      .run();
    return (res.meta.changes ?? 0) === 1 ? w.now : null;
  } catch (err) {
    console.error('寫入作文範文的共用快取失敗（不影響這次產生）', err);
    return null;
  }
}

/**
 * 「這組範文有問題」之後：同一個 cache_key、同一代（cache_gen）的列有兩位不同的學生回報 wrong，而且那一代就是目前的快取列，
 * 才停用那一列並寫 ops 事件。看的是舊的一代（快取已經被取代）時只記這位學生自己的評分，不動快取。
 */
export async function flagExemplarCacheIfDisputed(db: D1Database, key: string, gen: number): Promise<boolean> {
  if ((await currentExemplarCacheGen(db, key)) !== gen) return false;
  const row = await db
    .prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM exemplar_sets WHERE cache_key = ?1 AND cache_gen = ?2 AND rating = 'wrong'`)
    .bind(key, gen)
    .first<{ n: number }>();
  const users = row?.n ?? 0;
  if (users < EXEMPLAR_CACHE_FLAG_USERS) return false;
  const res = await db.prepare(`UPDATE ai_shared_cache SET status = 'flagged' WHERE cache_key = ?1 AND created_at = ?2 AND status = 'active'`).bind(key, gen).run();
  if ((res.meta.changes ?? 0) === 0) return false;
  const ref = await db.prepare('SELECT ref_id FROM ai_shared_cache WHERE cache_key = ?1').bind(key).first<{ ref_id: string }>();
  await opsEvent(db, 'exemplar_cache_flagged', 'warn', { ref_id: ref?.ref_id ?? null, users });
  return true;
}
