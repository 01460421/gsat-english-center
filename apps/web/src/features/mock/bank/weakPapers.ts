/**
 * 「我的加強卷」（docs/design/weak-paper.md §7.4）：加強卷（bk2）在這台裝置的清單、上次的設定與證據規則要的資料。
 *
 *   gsat-weakpaper:v1:papers（localStorage）
 *     [{ id, kind, createdAt, startedAt?, pdfAt?, paperDoneAt?, printed?, poolVersion, request, targets, notes }]，新的在前
 *       request  組卷的請求（PaperRequest，不含種子）；不是在這台裝置組的（開考分享來的卷子）是 null
 *       targets  組卷時的弱點（鍵、種類、大題、主代碼、命中用的代碼 codes、權重、標籤、組卷時的作答數與答對率；≤ 6 項）
 *       notes    每一組的 SlotNote（命中、做過、相鄰難度、保持手感…；卷子頁的「本卷針對」）
 *   gsat-weakpaper:v1:last（localStorage）  上次的請求（組卷頁預填）
 *   IndexedDB gsat-weakpaper / papers      快照（snapshots.ts 的 getWeakSnapshotStore）
 *
 * 為什麼不和自組卷共用 gsat-bankmock:v1:papers 與同一個 IndexedDB：舊版程式的分頁在改寫清單時會把解析不了的 bk2 項目丟掉、
 * 打開成績單時清理孤兒快照會刪掉它不認得的代號；用新的鍵與資料庫，舊程式碰不到。作答紀錄（gsat-mock:v1:*）照舊共用。
 * 清單的操作（上限 30 份、受保護的不刪、作答中最多 3 份、逾期處理）由 myPapers.ts 的 createPaperList 產生，只處理 bk2- 的代號。
 * 「本卷針對」只存在這台裝置（隱私，也讓同一個代號在任何裝置都是同一份卷子）。
 */
import { AI_SECTION_TYPES, TIERS, type BankSectionType, type Tier } from '@gsat/shared';
import type { PaperLength, PaperRequest, ReuseRule, SlotFlag, SlotNote } from './assemblePaper';
import { decodeBk2 } from './code2';
import { createPaperList, hasPaperUse, parseListBase, type PaperList, type PaperListEntryBase } from './myPapers';
import { loadActiveRecord, loadHistory, type MockAttemptRecord, type MockHistoryEntry } from '../storage';
import { BK2_KINDS, normalizeBk2PaperId, paperNumber, type Bk2Kind } from './paperId';
import { getWeakSnapshotStore } from './snapshots';

export const WEAK_PAPERS_KEY = 'gsat-weakpaper:v1:papers';
export const WEAK_LAST_REQUEST_KEY = 'gsat-weakpaper:v1:last';

/** 組卷時的一個弱點（存進清單；證據規則讀 codes，§5.2）。 */
export interface StoredTarget {
  key: string;
  kind: 'section' | 'skill' | 'trap' | 'error';
  section: BankSectionType;
  code: string | null;
  /** 命中用的主代碼（證據規則：題目的技能代碼和它們沒有交集才算進大題）。 */
  codes: string[];
  weight: number;
  /** 畫面上的名稱（組卷時算好；之後別名表或標籤改了也照舊顯示）。 */
  label: string | null;
  /** 組卷時的作答數與答對率（只有報告的訊號時是 null）。 */
  n: number | null;
  rate: number | null;
  /**
   * 這個弱點的依據（weakness.ts 的 WeakTarget.from：本機、學習報告、解析案例、入口的焦點）。成績單的下一步與「組卷時」那一格要分：
   * 本機的弱點依重算的本機模型決定要不要先放；報告、案例、焦點的弱點本機重算看不到，依本卷的答對率決定。舊的清單沒有這個欄位。
   */
  from?: StoredTargetSource[];
  /** 焦點裡的項目、沒有過一般門檻（入口帶來的）。 */
  focusOnly?: boolean;
}

export type StoredTargetSource = 'local' | 'report' | 'cases' | 'focus';
const TARGET_SOURCES: readonly string[] = ['local', 'report', 'cases', 'focus'];
export const isStoredTargetSource = (v: unknown): v is StoredTargetSource => typeof v === 'string' && TARGET_SOURCES.includes(v);

export interface WeakPaperEntry extends PaperListEntryBase {
  kind: Bk2Kind;
  request: PaperRequest | null;
  targets: StoredTarget[];
  notes: SlotNote[];
}

// ---------------------------------------------------------------------------
// 檢查
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isSection = (v: unknown): v is BankSectionType => typeof v === 'string' && (AI_SECTION_TYPES as readonly string[]).includes(v);
const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v);
const LENGTHS: readonly number[] = [20, 40, 60];
const REUSE: readonly string[] = ['avoid', 'retest', 'allow'];
const TARGET_KINDS: readonly string[] = ['section', 'skill', 'trap', 'error'];
const SLOT_FLAGS: readonly string[] = ['reused', 'retest', 'maintenance', 'adjacent_tier', 'pinned', 'no_tags', 'avoided_reuse', 'balanced'];

/** 組卷的請求（不含種子）；形狀不對回傳 null。 */
export function parsePaperRequest(raw: unknown): PaperRequest | null {
  if (!isRecord(raw)) return null;
  const { kind, tiers, sections, counts, minutes, sources, reuse, pins, diagnostic, balanced, fromPapers } = raw;
  if (typeof kind !== 'string' || !(BK2_KINDS as readonly string[]).includes(kind)) return null;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 3 || !tiers.every(isTier)) return null;
  if (!Array.isArray(sections) || !sections.every(isSection)) return null;
  if (!isStringArray(sources) || typeof reuse !== 'string' || !REUSE.includes(reuse)) return null;
  const out: PaperRequest = { kind: kind as Bk2Kind, tiers: [...tiers], sections: [...sections], sources: [...sources], reuse: reuse as ReuseRule };
  if (counts !== undefined) {
    if (!isRecord(counts) || !Object.entries(counts).every(([k, n]) => isSection(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 12)) return null;
    out.counts = counts as Partial<Record<BankSectionType, number>>;
  }
  if (minutes !== undefined) {
    if (typeof minutes !== 'number' || !LENGTHS.includes(minutes)) return null;
    out.minutes = minutes as PaperLength;
  }
  if (pins !== undefined) {
    if (!isStringArray(pins) || pins.length > 2) return null;
    out.pins = [...pins];
  }
  if (diagnostic === true) out.diagnostic = true;
  if (balanced === true) out.balanced = true;
  if (fromPapers === true) out.fromPapers = true;
  return out;
}

function parseTarget(raw: unknown): StoredTarget | null {
  if (!isRecord(raw)) return null;
  const { key, kind, section, code, codes, weight, label, n, rate, from, focusOnly } = raw;
  if (typeof key !== 'string' || typeof kind !== 'string' || !TARGET_KINDS.includes(kind) || !isSection(section)) return null;
  if (code !== null && typeof code !== 'string') return null;
  if (!isStringArray(codes) || typeof weight !== 'number' || !Number.isFinite(weight)) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const out: StoredTarget = { key, kind: kind as StoredTarget['kind'], section, code, codes: [...codes], weight, label: typeof label === 'string' ? label : null, n: num(n), rate: num(rate) };
  if (isStringArray(from)) out.from = [...new Set(from.filter(isStoredTargetSource))];
  if (focusOnly === true) out.focusOnly = true;
  return out;
}

function parseNote(raw: unknown): SlotNote | null {
  if (!isRecord(raw) || !isRecord(raw['hits']) || !Array.isArray(raw['flags'])) return null;
  const hits: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw['hits'])) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return null;
    hits[k] = v;
  }
  if (!raw['flags'].every((f) => typeof f === 'string' && SLOT_FLAGS.includes(f))) return null;
  return { hits, flags: [...(raw['flags'] as SlotFlag[])] };
}

/** 檢查一筆；代號要是標準寫法、卷別要和代號一致。形狀不對回傳 null（那一筆略過）。 */
export function parseWeakPaper(raw: unknown): WeakPaperEntry | null {
  if (!isRecord(raw)) return null;
  const { id, kind, request, targets, notes } = raw;
  if (typeof id !== 'string' || normalizeBk2PaperId(id)?.id !== id) return null;
  if (typeof kind !== 'string' || id.charAt(4) !== kind) return null;
  const base = parseListBase(raw, id);
  if (!base) return null;
  const parsedRequest = request === null || request === undefined ? null : parsePaperRequest(request);
  if (request !== null && request !== undefined && !parsedRequest) return null;
  const parsedTargets = Array.isArray(targets) ? targets.map(parseTarget) : [];
  const parsedNotes = Array.isArray(notes) ? notes.map(parseNote) : [];
  if (parsedTargets.some((t) => t === null) || parsedNotes.some((n) => n === null)) return null;
  return {
    ...base,
    kind: kind as Bk2Kind,
    request: parsedRequest,
    targets: parsedTargets as StoredTarget[],
    notes: parsedNotes as SlotNote[],
  };
}

// ---------------------------------------------------------------------------
// 清單
// ---------------------------------------------------------------------------

function isBk2Id(paperId: string): boolean {
  return normalizeBk2PaperId(paperId)?.id === paperId;
}

/** 加強卷的清單（myPapers.ts 的 createPaperList；只處理 bk2- 的代號）。 */
export const weakPaperList: PaperList<WeakPaperEntry> = createPaperList<WeakPaperEntry>({
  key: WEAK_PAPERS_KEY,
  owns: isBk2Id,
  parse: parseWeakPaper,
  blank: (paperId, now) =>
    isBk2Id(paperId) ? { id: paperId, kind: paperId.charAt(4) as Bk2Kind, createdAt: now.toISOString(), poolVersion: null, request: null, targets: [], notes: [] } : null,
  store: () => getWeakSnapshotStore(),
});

/**
 * 證據規則（§5.2）要的資料：這台裝置組的加強卷 → 卷別、組卷時目標的命中代碼（依大題分開：同一個代碼可能出現在好幾個大題，
 * 只和同一個大題的目標比）、是不是診斷卷。開考分享來的卷子（request 是 null）不列。
 */
export interface WeakPaperEvidence {
  kind: Bk2Kind;
  targetCodes: Partial<Record<BankSectionType, string[]>>;
  diagnostic: boolean;
}

/** 目標 → 每個大題的命中代碼（沒有代碼的大題不列）。 */
export function targetCodesBySection(targets: readonly Pick<StoredTarget, 'section' | 'codes'>[]): Partial<Record<BankSectionType, string[]>> {
  const out: Partial<Record<BankSectionType, string[]>> = {};
  for (const t of targets) {
    if (t.codes.length === 0) continue;
    out[t.section] = [...new Set([...(out[t.section] ?? []), ...t.codes])];
  }
  return out;
}

export function weakPaperEvidence(list: readonly WeakPaperEntry[] = weakPaperList.load()): Map<string, WeakPaperEvidence> {
  const out = new Map<string, WeakPaperEvidence>();
  for (const e of list) {
    if (!e.request) continue;
    out.set(e.id, { kind: e.kind, targetCodes: targetCodesBySection(e.targets), diagnostic: e.request.diagnostic === true });
  }
  return out;
}

/**
 * 「盡量避開」的題組（§6.2）：清單裡還沒開考、也沒下載 PDF、沒有紙本做過的卷子的題組，加上 extra（被「換一份」取代的那一份）。
 * 只組了卷、還沒用過的卷子不算「做過」（used.ts），沒有這一層時連續組兩份還沒開考的加強卷會拿到同一批收益最高的題組。
 */
export function avoidUids(list: readonly WeakPaperEntry[] = weakPaperList.load(), extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>(extra);
  for (const e of list) {
    if (hasPaperUse(e)) continue;
    for (const s of decodeBk2(e.id)?.slots ?? []) out.add(s.uid);
  }
  return out;
}

/** 上次的請求（組卷頁預填；網址參數優先）。讀不到或形狀不對回傳 null。 */
export function loadLastRequest(): PaperRequest | null {
  try {
    const text = window.localStorage.getItem(WEAK_LAST_REQUEST_KEY);
    return text === null ? null : parsePaperRequest(JSON.parse(text));
  } catch {
    return null;
  }
}

export function saveLastRequest(request: PaperRequest): boolean {
  try {
    window.localStorage.setItem(WEAK_LAST_REQUEST_KEY, JSON.stringify(request));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 畫面用的列（組卷頁的「我的加強卷」）
// ---------------------------------------------------------------------------

/** 「我的加強卷」的一列：清單、作答中、交卷紀錄（只讀 localStorage）。 */
export interface WeakPaperRow {
  entry: WeakPaperEntry;
  code: string;
  active: MockAttemptRecord | null;
  submissions: MockHistoryEntry[];
}

/**
 * 組卷頁列出的加強卷（§7.4）：弱點加強卷、模考格式卷、隨機抽題卷、診斷卷與組卷頁組的中性模考格式卷（fromPapers）；
 * /mock 組的中性卷（m，不是診斷卷）列在 /mock。
 * 開考分享來的卷子（request 是 null）也列，方便接著作答。
 */
export function listWeakPapers(list: readonly WeakPaperEntry[] = weakPaperList.load()): WeakPaperRow[] {
  const history = loadHistory();
  return list
    .filter((e) => e.kind !== 'm' || e.request?.diagnostic === true || e.request?.fromPapers === true || e.request === null)
    .map((entry) => ({
      entry,
      code: paperNumber(entry.id),
      active: loadActiveRecord(entry.id),
      submissions: history.filter((h) => h.paperId === entry.id),
    }));
}
