// @ts-check
/**
 * 來源登記檔 data/sources.json → 公開的 bank/sources.json（docs/design/weak-paper.md §8.3、§7.6）。
 *
 * 來源登記檔是出版社授權的唯一依據：每個出版社目錄 data/publisher/{id}/ 都要先在這裡登記（bank-select.mjs 的
 * selectPublisherGroups 遇到沒登記的目錄會讓建置失敗）。格式（欄位一律白名單，打錯欄位名稱讓建置失敗）：
 *
 *   { "sources": [
 *       { "id": "ai-bank", "ns": "ai", "kind": "ai_bank", "label_zh": "本站題庫", "publisher_zh": null, "product_zh": null,
 *         "attribution_zh": "AI 出題・已通過自動驗證・人工審核中",
 *         "licence": { "code": "original-ai", "ref": null, "scope": ["web", "pdf", "ai_assist", "explanations"], "public_ok": true, "until": null },
 *         "active": true, "added": "2026-10-09" },
 *       { "id": "pub-xxxx-116-1", "ns": "pb", "kind": "publisher", "label_zh": "○○出版", "publisher_zh": "○○出版股份有限公司",
 *         "product_zh": "116 學測英文模擬試題（第一回）",
 *         "attribution_zh": null,                     // null＝預設格式「本題出自{label_zh}《{product_zh}》，經授權使用」；站主給的逐字句優先
 *         "tier_labels": { "易": "basic" },            // 選填：出版社自己的難度標示（匯入工具用）
 *         "licence": { "code": "publisher-licensed", "ref": "合約編號（不公開）", "scope": ["web", "pdf", "ai_assist"], "public_ok": true, "until": "2027-12-31" },
 *         "active": true, "added": "2026-11-01", "retired_on": null } ] }
 *
 * 檢查（不合就丟 ItemSourcesError，建置失敗）：id 格式與不重複；剛好一筆本站題庫（id ai-bank、出處句等於 AI_GROUP_LABEL）；
 * 出版社來源要有出版社名與書名、授權代碼 publisher-licensed；授權範圍只能是 web、pdf、ai_assist、explanations；日期格式；
 * 名稱與出處句不能有「大考中心」「CEEC」。
 *
 * 到期（fail closed）：licence.until 早於建置日期（台灣時間）的來源當成停用：不輸出任何題組，公開檔的 active 是 false；
 * until 在 30 天內時印警告（提醒站主續約或停用）。public_ok 不是 true 的來源也不發布。公開檔另外帶 ends_on（＝until，只有日期）：
 * 前端與 Worker 每次讀到都自己和今天比，就算到期後沒有人重建網站也會停用。合約編號（licence.ref）等內部欄位不公開。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 這個檔案的路徑：build-data.mjs 把它算進資料版本雜湊。 */
export const ITEM_SOURCES_SCRIPT = fileURLToPath(import.meta.url);

/** 輸出路徑（相對 public/data/）。 */
export const SOURCES_PATH = 'bank/sources.json';

/** 本站題庫那一筆的 id 與出處句（packages/shared/src/item-source.ts 的 AI_BANK_SOURCE；出處句同 practice/labels.ts 的 AI_GROUP_LABEL）。 */
export const AI_BANK_SOURCE_ID = 'ai-bank';
export const AI_BANK_ATTRIBUTION = 'AI 出題・已通過自動驗證・人工審核中';
/** 授權範圍（item-source.ts 的 ITEM_SOURCE_SCOPES）。 */
export const SOURCE_SCOPES = /** @type {const} */ (['web', 'pdf', 'ai_assist', 'explanations']);
/** 到期前幾天開始印警告。 */
export const EXPIRY_WARNING_DAYS = 30;
/** 新文案與出處句的禁字（item-source.ts 的 FORBIDDEN_SOURCE_TERMS）。 */
export const FORBIDDEN_TERMS = /** @type {const} */ (['大考中心', 'CEEC']);

const SOURCE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = new Set(['basic', 'advanced', 'top']);
const SOURCE_KEYS = new Set(['id', 'ns', 'kind', 'label_zh', 'publisher_zh', 'product_zh', 'attribution_zh', 'tier_labels', 'licence', 'active', 'added', 'retired_on']);
const LICENCE_KEYS = new Set(['code', 'ref', 'scope', 'public_ok', 'until']);

export class ItemSourcesError extends Error {}

/**
 * @typedef {(typeof SOURCE_SCOPES)[number]} SourceScope
 * @typedef {{ code: string, ref: string | null, scope: SourceScope[], public_ok: boolean, until: string | null }} Licence
 * @typedef {{
 *   id: string, ns: 'ai' | 'pb', kind: 'ai_bank' | 'publisher', label_zh: string, publisher_zh: string | null, product_zh: string | null,
 *   attribution_zh: string, tier_labels: Record<string, string> | null, licence: Licence, active: boolean, added: string, retired_on: string | null,
 * }} SourceEntry  attribution_zh 已經套好預設格式
 * @typedef {{
 *   id: string, ns: 'ai' | 'pb', kind: 'ai_bank' | 'publisher', label_zh: string, publisher_zh: string | null, product_zh: string | null,
 *   attribution_zh: string, scope: SourceScope[], active: boolean, retired_on: string | null, ends_on: string | null,
 * }} PublicSource
 * @typedef {{ entry: SourceEntry, publishable: boolean, state: 'active' | 'inactive' | 'expired' | 'not_public' | 'no_web' }} EffectiveSource
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {v is string} */
function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function check(condition, message) {
  if (!condition) throw new ItemSourcesError(message);
}

/** 出處句的預設格式（站主 2026-10-23；item-source.ts 的 defaultAttribution）。 @param {string} publisher @param {string} product */
export function defaultAttribution(publisher, product) {
  return `本題出自${publisher}《${product}》，經授權使用`;
}

/** 題號清單 → 「41–44」「41–43、45」（item-source.ts 的 labelRangeText）。 @param {readonly string[]} labels */
export function labelRangeText(labels) {
  /** @type {string[]} */
  const parts = [];
  let i = 0;
  while (i < labels.length) {
    const start = /** @type {string} */ (labels[i]);
    let j = i;
    if (/^\d+$/.test(start)) {
      while (j + 1 < labels.length && /^\d+$/.test(/** @type {string} */ (labels[j + 1])) && Number(labels[j + 1]) === Number(labels[j]) + 1) j += 1;
    }
    parts.push(j > i ? `${start}–${labels[j]}` : start);
    i = j + 1;
  }
  return parts.join('、');
}

/**
 * 原卷位置 → 「原卷第 41–44 題」「原卷（第一回）第 41–44 題」（item-source.ts 的 sourceRefText；沒有題號是 null）。
 * @param {{ paper?: string | null, labels: readonly string[] } | null | undefined} ref
 */
export function sourceRefText(ref) {
  if (!ref || ref.labels.length === 0) return null;
  const paper = typeof ref.paper === 'string' && ref.paper.trim() !== '' ? `（${ref.paper.trim()}）` : '';
  return `原卷${paper}第 ${labelRangeText(ref.labels)} 題`;
}

/** @param {string} text */
function forbidden(text) {
  const upper = text.toUpperCase();
  return FORBIDDEN_TERMS.filter((t) => upper.includes(t));
}

/** YYYY-MM-DD 的日期差（b − a，天）。 @param {string} a @param {string} b */
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 台灣時間的今天（YYYY-MM-DD；同 shared 的 taiwanToday）。 @param {number} [nowMs] */
export function taiwanToday(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 解析並檢查來源登記（已經讀成物件；檔案的讀取見 readSourceRegistry）。
 * @param {unknown} raw @param {string} [at] 錯誤訊息裡的檔名
 * @returns {SourceEntry[]}
 */
export function parseSourceRegistry(raw, at = 'data/sources.json') {
  check(isObject(raw) && Object.keys(raw).every((k) => k === 'sources') && Array.isArray(raw.sources), `${at} 必須是 { "sources": [...] }`);
  /** @type {SourceEntry[]} */
  const out = [];
  const seen = new Set();
  for (const [i, s] of /** @type {unknown[]} */ (raw.sources).entries()) {
    const where = `${at} sources[${i}]`;
    check(isObject(s), `${where} 必須是物件`);
    const unknown = Object.keys(s).filter((k) => !SOURCE_KEYS.has(k));
    check(unknown.length === 0, `${where} 有不認得的欄位：${unknown.join('、')}`);
    const id = s.id;
    check(typeof id === 'string' && SOURCE_ID.test(id), `${where} 的 id 必須是小寫英數與連字號`);
    check(!seen.has(id), `${where} 的 id ${id} 重複`);
    seen.add(id);
    const ns = s.ns;
    check(ns === 'ai' || ns === 'pb', `${where}（${id}）的 ns 必須是 ai 或 pb`);
    check((ns === 'ai' && s.kind === 'ai_bank') || (ns === 'pb' && s.kind === 'publisher'), `${where}（${id}）的 kind 必須是 ai_bank（ns ai）或 publisher（ns pb）`);
    check(nonEmptyString(s.label_zh), `${where}（${id}）缺少 label_zh`);
    for (const k of ['publisher_zh', 'product_zh']) check(s[k] === null || s[k] === undefined || typeof s[k] === 'string', `${where}（${id}）的 ${k} 必須是字串或 null`);
    const label = /** @type {string} */ (s.label_zh).trim();
    const publisher = nonEmptyString(s.publisher_zh) ? s.publisher_zh.trim() : null;
    const product = nonEmptyString(s.product_zh) ? s.product_zh.trim() : null;
    if (ns === 'pb') check(publisher !== null && product !== null, `${where}（${id}）的出版社來源要有 publisher_zh 與 product_zh`);
    check(s.attribution_zh === null || s.attribution_zh === undefined || nonEmptyString(s.attribution_zh), `${where}（${id}）的 attribution_zh 必須是非空字串或 null（null＝預設格式）`);
    const attribution = nonEmptyString(s.attribution_zh) ? s.attribution_zh.trim() : ns === 'pb' ? defaultAttribution(label, /** @type {string} */ (product)) : null;
    check(attribution !== null, `${where}（${id}）缺少 attribution_zh`);
    if (ns === 'ai') {
      check(id === AI_BANK_SOURCE_ID, `${where}：本站題庫那一筆的 id 必須是 ${AI_BANK_SOURCE_ID}`);
      check(attribution === AI_BANK_ATTRIBUTION, `${where}：本站題庫的出處句必須是「${AI_BANK_ATTRIBUTION}」（同 practice/labels.ts 的 AI_GROUP_LABEL）`);
    }
    for (const text of [label, publisher, product, attribution]) {
      if (text === null) continue;
      const bad = forbidden(text);
      check(bad.length === 0, `${where}（${id}）的名稱或出處句不能有「${bad.join('」「')}」`);
    }
    const tl = s.tier_labels;
    check(
      tl === undefined || tl === null || (isObject(tl) && Object.entries(tl).every(([k, v]) => nonEmptyString(k) && typeof v === 'string' && TIERS.has(v))),
      `${where}（${id}）的 tier_labels 必須是 {出版社的標示: basic|advanced|top}`,
    );
    const lic = s.licence;
    check(isObject(lic), `${where}（${id}）缺少 licence`);
    const unknownLic = Object.keys(lic).filter((k) => !LICENCE_KEYS.has(k));
    check(unknownLic.length === 0, `${where}（${id}）的 licence 有不認得的欄位：${unknownLic.join('、')}`);
    check(nonEmptyString(lic.code), `${where}（${id}）缺少 licence.code`);
    check(ns === 'ai' ? lic.code === 'original-ai' : lic.code === 'publisher-licensed', `${where}（${id}）的 licence.code 必須是 ${ns === 'ai' ? 'original-ai' : 'publisher-licensed'}`);
    check(lic.ref === null || lic.ref === undefined || typeof lic.ref === 'string', `${where}（${id}）的 licence.ref 必須是字串或 null`);
    check(
      Array.isArray(lic.scope) && lic.scope.every((x) => SOURCE_SCOPES.includes(/** @type {never} */ (x))) && new Set(lic.scope).size === lic.scope.length,
      `${where}（${id}）的 licence.scope 只能是 ${SOURCE_SCOPES.join('、')}（不重複）`,
    );
    check(typeof lic.public_ok === 'boolean', `${where}（${id}）的 licence.public_ok 必須是 true 或 false`);
    check(lic.until === null || lic.until === undefined || (typeof lic.until === 'string' && ISO_DATE.test(lic.until)), `${where}（${id}）的 licence.until 必須是 YYYY-MM-DD 或 null`);
    check(typeof s.active === 'boolean', `${where}（${id}）的 active 必須是 true 或 false`);
    check(typeof s.added === 'string' && ISO_DATE.test(s.added), `${where}（${id}）的 added 必須是 YYYY-MM-DD`);
    check(s.retired_on === null || s.retired_on === undefined || (typeof s.retired_on === 'string' && ISO_DATE.test(s.retired_on)), `${where}（${id}）的 retired_on 必須是 YYYY-MM-DD 或 null`);
    out.push({
      id,
      ns,
      kind: /** @type {'ai_bank' | 'publisher'} */ (s.kind),
      label_zh: label,
      publisher_zh: publisher,
      product_zh: product,
      attribution_zh: attribution,
      tier_labels: isObject(tl) ? /** @type {Record<string, string>} */ (tl) : null,
      licence: {
        code: lic.code,
        ref: typeof lic.ref === 'string' ? lic.ref : null,
        scope: /** @type {SourceScope[]} */ (lic.scope),
        public_ok: lic.public_ok,
        until: typeof lic.until === 'string' ? lic.until : null,
      },
      active: s.active,
      added: s.added,
      retired_on: typeof s.retired_on === 'string' ? s.retired_on : null,
    });
  }
  check(out.filter((s) => s.ns === 'ai').length === 1, `${at} 必須剛好有一筆本站題庫（id ${AI_BANK_SOURCE_ID}）`);
  return out;
}

/**
 * 讀 data/sources.json。檔案不存在時是只有本站題庫的預設（出版社目錄一律不能發布）；格式錯丟 ItemSourcesError。
 * @param {string} file @param {string} [at]
 * @returns {{ sources: SourceEntry[], exists: boolean }}
 */
export function readSourceRegistry(file, at = 'data/sources.json') {
  if (!existsSync(file)) {
    return {
      exists: false,
      sources: parseSourceRegistry({
        sources: [
          {
            id: AI_BANK_SOURCE_ID,
            ns: 'ai',
            kind: 'ai_bank',
            label_zh: '本站題庫',
            publisher_zh: null,
            product_zh: null,
            attribution_zh: AI_BANK_ATTRIBUTION,
            licence: { code: 'original-ai', ref: null, scope: [...SOURCE_SCOPES], public_ok: true, until: null },
            active: true,
            added: '2026-10-09',
          },
        ],
      }),
    };
  }
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ItemSourcesError(`${at} 不是合法的 JSON（${err instanceof Error ? err.message : String(err)}）`);
  }
  return { exists: true, sources: parseSourceRegistry(raw, at) };
}

/**
 * 這次建置每個來源的實際狀態（fail closed）：
 *   active      有效：出版社題組照常發布
 *   inactive    站主手動停用（active: false）
 *   expired     licence.until 早於今天（台灣時間；到期日當天仍有效）
 *   not_public  licence.public_ok 不是 true（授權不允許公開）
 *   no_web      授權範圍沒有 web（網站上不能顯示）
 * 另外回傳警告：30 天內到期、停用卻沒有寫 retired_on。
 * @param {readonly SourceEntry[]} sources @param {string} today
 * @returns {{ effective: EffectiveSource[], warnings: string[] }}
 */
export function effectiveSources(sources, today) {
  /** @type {string[]} */
  const warnings = [];
  const effective = sources.map((entry) => {
    /** @type {EffectiveSource['state']} */
    let state = 'active';
    if (!entry.active) state = 'inactive';
    else if (entry.licence.until !== null && today > entry.licence.until) state = 'expired';
    else if (!entry.licence.public_ok) state = 'not_public';
    else if (!entry.licence.scope.includes('web')) state = 'no_web';
    if (state === 'active' && entry.licence.until !== null) {
      const left = daysBetween(today, entry.licence.until);
      if (left <= EXPIRY_WARNING_DAYS) warnings.push(`來源 ${entry.id} 的授權 ${entry.licence.until} 到期（還有 ${left} 天）：請續約，或停用（active: false、retired_on）`);
    }
    if (state === 'expired') warnings.push(`來源 ${entry.id} 的授權已在 ${entry.licence.until} 到期：這次建置自動停用，不輸出它的題組（記得跑 apps/api/scripts/retire-publisher-source.mjs）`);
    if (state === 'not_public') warnings.push(`來源 ${entry.id} 的 licence.public_ok 不是 true：不輸出它的題組`);
    if (state === 'no_web') warnings.push(`來源 ${entry.id} 的授權範圍沒有 web：不輸出它的題組`);
    if (state === 'inactive' && entry.retired_on === null) warnings.push(`來源 ${entry.id} 已停用，建議寫上 retired_on`);
    return { entry, publishable: entry.ns === 'pb' && state === 'active', state };
  });
  return { effective, warnings };
}

/**
 * selectPublisherGroups 用的來源清單（bank-select.mjs 的 PublishableSourceLike）：active 換成這次建置的實際狀態。
 * @param {readonly EffectiveSource[]} effective
 */
export function selectableSources(effective) {
  return effective.map(({ entry, state }) => ({ id: entry.id, ns: entry.ns, active: state === 'active', ends_on: entry.licence.until, scope: entry.licence.scope }));
}

/**
 * 公開的來源登記（bank/sources.json）：只有公開欄位；active 是這次建置的實際狀態（到期、不公開、沒有 web 都是 false），
 * ends_on 是授權的最後一天。本站題庫排第一，其他依 id。
 * @param {readonly EffectiveSource[]} effective @param {string} version
 * @returns {{ version: string, sources: PublicSource[] }}
 */
export function publicSourceRegistry(effective, version) {
  const sorted = [...effective].sort((a, b) => (a.entry.ns === b.entry.ns ? a.entry.id.localeCompare(b.entry.id) : a.entry.ns === 'ai' ? -1 : 1));
  return {
    version,
    sources: sorted.map(({ entry, state }) => ({
      id: entry.id,
      ns: entry.ns,
      kind: entry.kind,
      label_zh: entry.label_zh,
      publisher_zh: entry.publisher_zh,
      product_zh: entry.product_zh,
      attribution_zh: entry.attribution_zh,
      scope: [...entry.licence.scope],
      active: state === 'active',
      retired_on: entry.retired_on,
      ends_on: entry.licence.until,
    })),
  };
}

/** 建置紀錄：每個來源一行（出版社來源附發布的題組數）。 @param {readonly EffectiveSource[]} effective @param {Record<string, number>} bySource */
export function sourceLogLines(effective, bySource) {
  const STATE_LABELS = { active: '有效', inactive: '停用', expired: '授權到期', not_public: '授權不允許公開', no_web: '授權範圍沒有 web' };
  return effective.map(({ entry, state }) => {
    const groups = entry.ns === 'pb' ? `，發布 ${bySource[entry.id] ?? 0} 組` : '';
    const until = entry.licence.until ? `，授權到 ${entry.licence.until}` : '';
    return `來源 ${entry.id}（${entry.label_zh}）：${STATE_LABELS[state]}${until}${groups}`;
  });
}
