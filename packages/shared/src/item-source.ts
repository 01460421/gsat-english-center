/**
 * 題目來源契約的共用常數與型別（docs/design/weak-paper.md §8.2、§8.3）。
 *
 *   命名空間  ai（本站題庫，ai.{題型}.{6 位十六進位}，現狀不變）、pb（出版社模考，pb.{題型}.{6 位十六進位}）
 *   來源登記  data/sources.json（建置端）→ 公開的 bank/sources.json（只有公開欄位，含到期日 ends_on）
 *
 * 本站 AI 題庫的檔案仍然只用 BANK_UID_PATTERN（bank.ts）；要同時收兩種命名空間的地方一律用這裡的常數。
 * 這裡只放前端、Worker 與建置共用的格式與判斷：命名空間、來源登記的公開型別與守衛、到期判斷（fail closed）、
 * 出處文字（出處句的預設格式、原卷位置、每組的出處列、學習助手案例的出處）。來源登記檔的讀取與檢查在網站建置
 * （apps/web/scripts/lib/item-sources.mjs），出版社正規化檔的選題在 packages/shared/scripts/bank-select.mjs 的 selectPublisherGroups。
 */
import type { BankSectionType } from './tiers';

export const ITEM_NAMESPACES = ['ai', 'pb'] as const;
export type ItemNamespace = (typeof ITEM_NAMESPACES)[number];

/** 任何來源的題組 uid（題庫練習的六種題型）。本站題庫仍然只用 BANK_UID_PATTERN。 */
export const PRACTICE_ITEM_UID_PATTERN = /^(ai|pb)\.(vo|cz|wb|st|rd|mx)\.[0-9a-f]{6}$/;
/** 任何來源的題組版本代號（uid@版本）。 */
export const ITEM_GROUP_KEY_PATTERN = /^((?:ai|pb)\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)$/;

/** uid 的命名空間；不是 ai.／pb. 開頭的回傳 null。 */
export function namespaceOf(uid: string): ItemNamespace | null {
  const ns = uid.slice(0, 3);
  return ns === 'ai.' ? 'ai' : ns === 'pb.' ? 'pb' : null;
}

/** 本站題庫在來源登記檔裡的 id（組卷池的條目沒有 src 時就是它）。 */
export const AI_BANK_SOURCE_ID = 'ai-bank';

/** 授權範圍（§8.3）：web 網站顯示、pdf 學生下載的 PDF、ai_assist 送給學習助手解析、explanations 公開出版社詳解。 */
export const ITEM_SOURCE_SCOPES = ['web', 'pdf', 'ai_assist', 'explanations'] as const;
export type ItemSourceScope = (typeof ITEM_SOURCE_SCOPES)[number];

/** 公開的來源登記（bank/sources.json 的一筆；合約編號等內部欄位不公開）。 */
export interface ItemSourcePublic {
  id: string;
  ns: ItemNamespace;
  kind: 'ai_bank' | 'publisher';
  /** 畫面上的短名（「本站題庫」「○○出版」）。 */
  label_zh: string;
  publisher_zh: string | null;
  product_zh: string | null;
  /** 逐字的出處句（站主提供）。 */
  attribution_zh: string;
  scope: ItemSourceScope[];
  active: boolean;
  retired_on: string | null;
  /** 授權的最後一天（YYYY-MM-DD，台灣時間）；沒有期限是 null。前端與 Worker 每次讀到都自己比對日期（§7.6）。 */
  ends_on: string | null;
}

export interface SourceRegistry {
  version: string;
  sources: ItemSourcePublic[];
}

/** 本站題庫那一筆（還沒有讀到 bank/sources.json 時的預設；出處句同 practice/labels.ts 的 AI_GROUP_LABEL）。 */
export const AI_BANK_SOURCE: ItemSourcePublic = {
  id: AI_BANK_SOURCE_ID,
  ns: 'ai',
  kind: 'ai_bank',
  label_zh: '本站題庫',
  publisher_zh: null,
  product_zh: null,
  attribution_zh: 'AI 出題・已通過自動驗證・人工審核中',
  scope: ['web', 'pdf', 'ai_assist', 'explanations'],
  active: true,
  retired_on: null,
  ends_on: null,
};

/** 只有本站題庫的來源登記（沒有出版社題時、或 bank/sources.json 讀不到時用）。 */
export const DEFAULT_SOURCE_REGISTRY: SourceRegistry = { version: 'default', sources: [AI_BANK_SOURCE] };

/**
 * 來源現在能不能用（fail closed）：active、今天（台灣時間 YYYY-MM-DD）還沒過 ends_on、授權範圍包含 scopes 的每一項。
 * 日期字串格式固定，直接比較字串即可。
 */
export function isSourceUsable(source: Pick<ItemSourcePublic, 'active' | 'ends_on' | 'scope'>, today: string, scopes: readonly ItemSourceScope[] = ['web']): boolean {
  if (!source.active) return false;
  if (source.ends_on !== null && today > source.ends_on) return false;
  return scopes.every((s) => source.scope.includes(s));
}

/**
 * 卷子可以用的來源 id（§6.2：授權包含網站顯示與 PDF、有效、沒過期），只取 requested 裡有的。
 * 找不到登記的來源一律不能用（本站題庫例外：登記檔讀不到時仍可用預設那一筆）。
 */
export function usablePaperSources(registry: SourceRegistry | null, requested: readonly string[], today: string): Set<string> {
  const sources = registry?.sources ?? DEFAULT_SOURCE_REGISTRY.sources;
  const byId = new Map(sources.map((s) => [s.id, s]));
  if (!byId.has(AI_BANK_SOURCE_ID)) byId.set(AI_BANK_SOURCE_ID, AI_BANK_SOURCE);
  return new Set(requested.filter((id) => {
    const s = byId.get(id);
    return s !== undefined && isSourceUsable(s, today, ['web', 'pdf']);
  }));
}

/** 六種題型（能進卷子的出版社題型同題庫練習，§8.5）。 */
export const PUBLISHER_SECTION_TYPES = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed'] as const satisfies readonly BankSectionType[];

// ───────────────────────── P1：來源契約的格式、出處文字與判斷 ─────────────────────────

/** 來源 id（data/sources.json 的 id，也是出版社正規化檔的目錄名 data/publisher/{id}/）：小寫英數與連字號。 */
export const ITEM_SOURCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 出版社正規化檔的格式代號（§8.4）。 */
export const PUBLISHER_SCHEMA = 'gsat-pub/v1';
/** 出版社正規化檔的檔名：pb.{題型}.{6 位十六進位}@{版本}.json。 */
export const PUBLISHER_FILENAME_PATTERN = /^(pb\.(?:vo|cz|wb|st|rd|mx)\.[0-9a-f]{6})@([1-9]\d*)\.json$/;

/**
 * 新文案、出處句與來源名稱不能出現的字（weak-paper.md §1、§8.3）。比對前先轉大寫，所以 ceec、Ceec 也算。
 * 只用在本站自己寫的文字與站主提供的出處句；題目本身出現時由匯入檢查列進人工檢查表（§8.8）。
 */
export const FORBIDDEN_SOURCE_TERMS = ['大考中心', 'CEEC'] as const;

/** 文字裡的禁字（沒有回傳空陣列）。 */
export function forbiddenSourceTerms(text: string): string[] {
  const upper = text.toUpperCase();
  return FORBIDDEN_SOURCE_TERMS.filter((t) => upper.includes(t));
}

/**
 * 出處句的預設格式（站主 2026-10-23）：「本題出自{出版社}《{書名}》，經授權使用」。
 * {出版社} 用畫面短名 label_zh（同 §8.3 的範例），{書名} 用 product_zh。站主另外提供逐字的出處句時以那一句為準。
 */
export function defaultAttribution(publisher: string, product: string): string {
  return `本題出自${publisher}《${product}》，經授權使用`;
}

/** 題號清單 → 「41–44」「41–43、45」（數字的連續段用 –，其他依原順序用、分隔）。 */
export function labelRangeText(labels: readonly string[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < labels.length) {
    const start = labels[i]!;
    const n = /^\d+$/.test(start) ? Number(start) : null;
    let j = i;
    if (n !== null) {
      while (j + 1 < labels.length && /^\d+$/.test(labels[j + 1]!) && Number(labels[j + 1]) === Number(labels[j]) + 1) j += 1;
    }
    parts.push(j > i ? `${start}–${labels[j]}` : start);
    i = j + 1;
  }
  return parts.join('、');
}

/**
 * 原卷位置（正規化檔的 source_ref，§8.4）→ 畫面文字「原卷第 41–44 題」；有回次（paper）時「原卷（第一回）第 41–44 題」。
 * 沒有題號時回傳 null。
 */
export function sourceRefText(ref: { paper?: string | null; labels: readonly string[] } | null | undefined): string | null {
  if (!ref || ref.labels.length === 0) return null;
  const paper = typeof ref.paper === 'string' && ref.paper.trim() !== '' ? `（${ref.paper.trim()}）` : '';
  return `原卷${paper}第 ${labelRangeText(ref.labels)} 題`;
}

/**
 * 公開題組檔的出處（bank/groups/{uid}@{v}.json 的 source，§8.9）：只有出版社題組有。
 * 文字在建置時由來源登記檔與正規化檔的 source_ref 算好，前端、PDF 與 Worker 直接用，不必另外下載來源登記檔。
 * 授權有沒有到期仍要另外查 bank/sources.json（題組檔不會因為到期而改變，§7.6）。
 */
export interface ItemGroupSource {
  /** 來源登記檔的 id。 */
  id: string;
  /** 畫面上的短名（出版社名）。 */
  label_zh: string;
  /** 書名或產品名。 */
  product_zh: string | null;
  /** 逐字的出處句。 */
  attribution_zh: string;
  /** 原卷位置的畫面文字（sourceRefText）；沒有時是 null。 */
  ref_text: string | null;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const strOrNull = (v: unknown): boolean => v === null || typeof v === 'string';

/** 題組檔 source 欄位的守衛。 */
export function isItemGroupSource(v: unknown): v is ItemGroupSource {
  return (
    isPlainRecord(v) &&
    typeof v['id'] === 'string' &&
    ITEM_SOURCE_ID_PATTERN.test(v['id']) &&
    typeof v['label_zh'] === 'string' &&
    strOrNull(v['product_zh']) &&
    typeof v['attribution_zh'] === 'string' &&
    strOrNull(v['ref_text'])
  );
}

/** 「{label_zh}《{product_zh}》」（沒有書名時只有短名）。 */
export function sourceTitle(source: Pick<ItemGroupSource, 'label_zh' | 'product_zh'>): string {
  return source.product_zh ? `${source.label_zh}《${source.product_zh}》` : source.label_zh;
}

/**
 * 每個題組上方的出處列（線上作答、檢討、問學習助手確認頁，§8.7）：「{label_zh}《{product_zh}》原卷第 41–44 題・經授權使用」。
 */
export function groupSourceLine(source: ItemGroupSource): string {
  return `${sourceTitle(source)}${source.ref_text ?? ''}・經授權使用`;
}

/** 學習助手案例的出處（Worker 的 origin_label，§8.7）：「{label_zh}《{product_zh}》・{難度}・經授權使用」。 */
export function publisherOriginLabel(source: Pick<ItemGroupSource, 'label_zh' | 'product_zh'>, tierLabel: string): string {
  return `${sourceTitle(source)}・${tierLabel}・經授權使用`;
}

/** 學習助手拒收出版社題的說明（Worker 的錯誤訊息與前端的文案共用，§9.6）：授權不含 ai_assist。 */
export const PUBLISHER_ASSIST_NO_SCOPE_TEXT = '這一題的出版社授權不包含 AI 解析';
/** 同上：來源停用、過了到期日或已經下架；案例頁也用這句說明題目與解析為什麼不見了（§7.6）。 */
export const PUBLISHER_ASSIST_ENDED_TEXT = '這一題的出版社授權已經結束，題目與解析不再顯示';

const SCOPE_SET: ReadonlySet<string> = new Set(ITEM_SOURCE_SCOPES);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isSourcePublic(v: unknown): v is ItemSourcePublic {
  if (!isPlainRecord(v)) return false;
  const day = (k: string) => v[k] === null || (typeof v[k] === 'string' && ISO_DAY.test(v[k] as string));
  return (
    typeof v['id'] === 'string' &&
    ITEM_SOURCE_ID_PATTERN.test(v['id']) &&
    (v['ns'] === 'ai' || v['ns'] === 'pb') &&
    (v['kind'] === 'ai_bank' || v['kind'] === 'publisher') &&
    typeof v['label_zh'] === 'string' &&
    strOrNull(v['publisher_zh']) &&
    strOrNull(v['product_zh']) &&
    typeof v['attribution_zh'] === 'string' &&
    Array.isArray(v['scope']) &&
    v['scope'].every((s) => typeof s === 'string' && SCOPE_SET.has(s)) &&
    typeof v['active'] === 'boolean' &&
    day('retired_on') &&
    day('ends_on')
  );
}

/** 公開的來源登記（bank/sources.json）的守衛：前端與 Worker 共用。 */
export function isSourceRegistry(body: unknown): body is SourceRegistry {
  return isPlainRecord(body) && typeof body['version'] === 'string' && Array.isArray(body['sources']) && body['sources'].every(isSourcePublic);
}

/**
 * 某個來源現在的狀態（fail closed）：
 *   ok        有效、沒過到期日、授權範圍包含 scopes
 *   ended     停用（active false）、過了到期日，或登記檔裡沒有這個來源（登記檔讀不到時只認本站題庫）
 *   no_scope  有效，但授權範圍不包含 scopes 的某一項（例如沒有 ai_assist）
 */
export function sourceStatus(
  registry: SourceRegistry | null,
  id: string,
  today: string,
  scopes: readonly ItemSourceScope[] = ['web'],
): 'ok' | 'ended' | 'no_scope' {
  const sources = registry?.sources ?? DEFAULT_SOURCE_REGISTRY.sources;
  const source = sources.find((s) => s.id === id) ?? (id === AI_BANK_SOURCE_ID ? AI_BANK_SOURCE : undefined);
  if (!source || !isSourceUsable(source, today, [])) return 'ended';
  return isSourceUsable(source, today, scopes) ? 'ok' : 'no_scope';
}
