/**
 * 組卷池 /data/bank/mock-pool.json（docs/design/bank-mock.md §0 第 7 點、§4.7、§9.1）：型別與載入。
 *
 * 由 scripts/lib/bank-mock-pool.mjs 在建置時產生，和 bank/index.json、writing/bank/index.json 是同一次選題的結果
 * （packages/shared/scripts/bank-select.mjs），所以收錄的是**所有已發布**的題組，依 uid 排序：
 *
 *   {
 *     version,                      // 同 bank/index.json 的 version
 *     blueprint: 'gsat-115',
 *     tiers: {
 *       basic: {
 *         vocabulary:  [{ uid, v, theme: [], k: [], prev?: {}, ex? }],
 *         reading:     [{ uid, v, theme, fig: 'chart' | 'table' | null, form, k, sw, prev?, ex? }],
 *         …（cloze、word_bank、structure、mixed、translation、composition 同 vocabulary）
 *       },
 *       advanced: {…}, top: {…}
 *     }
 *   }
 *
 * 不能用來組新卷的題組也列在裡面，帶排除原因 ex（題本缺字、uid 無法編碼…）：它們仍然算「已發布」，
 * 舊卷子用到時狀態照樣是 current（status.ts），只是組新卷時不當候選（assemble.ts）。
 *
 * 載入用 memoizeAsync 快取，成功的結果在分頁存活期間不會更新。網站更新後舊的題組檔會從部署移除，
 * 照舊池子組卷就會拿到 404，所以另外提供 reloadMockPool()：丟掉成功的快取、重抓一次（§4.7 第 (6) 部分）。
 */
import { AI_SECTION_TYPES, TIERS, type BankSectionType, type Tier } from '@gsat/shared';
import { fetchDataFile, isRecord, memoizeAsync } from '../../../data/client';
import { BLUEPRINT_ID } from './blueprint';

export const MOCK_POOL_PATH = 'bank/mock-pool.json';

/**
 * 不能組新卷的原因：
 *   glyph    題本會印的字串有 PDF 字型沒有的字
 *   uid      uid 格式不符或題型代碼和 section_type 不一致（無法編進代號）
 *   version  版本大於 63（無法編進代號）
 *   marker   題組裡有指向題組外的 [[n]]
 * 建置端之後可能加新的原因，前端只看「有沒有」，所以型別保留 string。
 */
export type MockPoolExclusion = 'glyph' | 'uid' | 'version' | 'marker' | (string & {});

/**
 * 組卷池的一個題組（所有題型共用的欄位）。建置端的格式在 scripts/lib/bank-mock-pool.mjs；
 * npm run check:data 用這裡的 MockPool 比對實際輸出（scripts/lib/data-contract.mjs 的 MOCK_POOL_TYPE）。
 */
export interface MockPoolEntry {
  uid: string;
  /** 目前發布的版本。 */
  v: number;
  /** 主題鍵（c:概念、w:英文實詞、z:中文主題，§4.3）；詞彙題是空陣列。 */
  theme: string[];
  /**
   * 答案指紋：每一題一個 4 位十六進位字串，依題目順序（§4.7 第 (1) 部分）。選擇題、混合題涵蓋答案、可接受答案、
   * 部分給分寫法、配分、作答方式與選項數；閱讀另外涵蓋整篇的可交換設定與每一題的答案（答案位置調整以整篇為單位，
   * 任何一題的答案或 sw 改了，整篇四題的指紋都會不同）。中譯英、作文涵蓋題目文字。
   */
  k: string[];
  /** 這個 uid 較舊的 verified 版本的 k（鍵是版本號）；只有改過版的 uid 才有。 */
  prev?: Record<string, string[]>;
  /** 不能組新卷的原因；沒有這個欄位就是可以用。 */
  ex?: MockPoolExclusion;
}

/** 閱讀題組另外有圖表種類、文本形式與可交換的題目。 */
export interface MockPoolReadingEntry extends MockPoolEntry {
  /** 附圖表或表格；連續文本、多文本是 null。 */
  fig: 'chart' | 'table' | null;
  /** 文本形式（題組 tags.text_format：continuous、multi_text、mixed…）。 */
  form: string;
  /** 可以交換選項位置的題目組合 [q, r]（題組內的原始題號，§5.3）；沒有可以換的是空陣列。 */
  sw: [number, number][];
}

/** 一種難度的組卷池：每個大題的題組（依 uid 排序）。 */
export type MockPoolTier = { [S in BankSectionType]: S extends 'reading' ? MockPoolReadingEntry[] : MockPoolEntry[] };

export interface MockPool {
  /** 資料版本（同 bank/index.json 的 version）。 */
  version: string;
  blueprint: typeof BLUEPRINT_ID;
  tiers: Record<Tier, MockPoolTier>;
}

// ---------------------------------------------------------------------------
// 形狀檢查
// ---------------------------------------------------------------------------

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function isSwapPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && (x as number) >= 1);
}

function isEntry(v: unknown, reading: boolean): boolean {
  if (!isRecord(v)) return false;
  if (typeof v['uid'] !== 'string' || !Number.isInteger(v['v']) || (v['v'] as number) < 1) return false;
  if (!isStringArray(v['theme']) || !isStringArray(v['k'])) return false;
  // prev、ex 沒有時省略；寫成 null 也當成沒有。
  const prev = v['prev'];
  if (prev != null && !(isRecord(prev) && Object.values(prev).every(isStringArray))) return false;
  const ex = v['ex'];
  if (ex != null && typeof ex !== 'string') return false;
  if (!reading) return true;
  const fig = v['fig'];
  if (fig !== null && fig !== 'chart' && fig !== 'table') return false;
  return typeof v['form'] === 'string' && Array.isArray(v['sw']) && v['sw'].every(isSwapPair);
}

/**
 * 組卷池的形狀檢查：版本、藍圖、三種難度 × 八個大題的陣列，以及每個條目的欄位型別。
 * 條目共約 540 筆，逐筆檢查的成本很小，換來的是組卷程式不必處處防範奇怪的值（舊版快取、被截斷的檔案）。
 */
export function isMockPool(body: unknown): body is MockPool {
  if (!isRecord(body) || typeof body['version'] !== 'string' || body['blueprint'] !== BLUEPRINT_ID) return false;
  const tiers = body['tiers'];
  if (!isRecord(tiers)) return false;
  return TIERS.every((tier) => {
    const t = tiers[tier];
    return (
      isRecord(t) &&
      AI_SECTION_TYPES.every((section) => {
        const list = t[section];
        return Array.isArray(list) && list.every((e) => isEntry(e, section === 'reading'));
      })
    );
  });
}

// ---------------------------------------------------------------------------
// 載入
// ---------------------------------------------------------------------------

/** 快取的鍵是「第幾次載入」：reloadMockPool() 換一個鍵，就等於丟掉成功的快取（client.ts 的快取沒有單筆清除）。 */
const poolLoader = memoizeAsync((_generation: number) => fetchDataFile(MOCK_POOL_PATH, isMockPool));
let generation = 0;

/** 載入組卷池（同一頁面內只下載一次；失敗的要等「再試一次」的 forgetFailedLoads() 才重抓）。 */
export function loadMockPool(): Promise<MockPool> {
  return poolLoader(generation);
}

/**
 * 丟掉組卷池的快取並重抓一次：組卷或解析時題組檔回 404（網站剛更新）才呼叫，最多一次（§4.7 第 (6) 部分）。
 * 之後的 loadMockPool() 都拿到新的這一份。
 */
export function reloadMockPool(): Promise<MockPool> {
  generation += 1;
  return poolLoader(generation);
}

/** 某個難度、某個大題的題組；沒有就是空陣列。 */
export function poolEntries<S extends BankSectionType>(pool: MockPool, tier: Tier, section: S): MockPoolTier[S] {
  return pool.tiers[tier][section];
}

/** 在某個難度、某個大題裡找 uid。 */
export function findPoolEntry(pool: MockPool, tier: Tier, section: BankSectionType, uid: string): MockPoolEntry | MockPoolReadingEntry | null {
  return (pool.tiers[tier][section] as readonly MockPoolEntry[]).find((e) => e.uid === uid) ?? null;
}

/** 可以組新卷的題組（沒有排除原因）。 */
export function isSelectable(entry: MockPoolEntry): boolean {
  return entry.ex == null;
}
