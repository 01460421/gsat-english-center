/**
 * 題目來源登記 /data/bank/sources.json（docs/design/weak-paper.md §8.3、§7.6）的載入與「現在能不能用」。
 *
 * 公開檔由建置產生（scripts/lib/item-sources.mjs：每個來源的 id、短名、書名、出處句、授權範圍、active、ends_on…）。
 * 檔案還不存在、或讀不到時，一律退回只有本站題庫的 DEFAULT_SOURCE_REGISTRY：出版社題組因此全部當成停用（fail closed），
 * 本站題照常可用。到期日由前端自己比對（台灣時間的今天），就算到期後沒有人重建網站也會停用。
 *
 * 用到它的地方：加強卷的組卷與卷子的上架狀態（features/mock/bank）、題庫練習的出版社題組（停用就不顯示題目、
 * 授權沒有 ai_assist 就不顯示「問學習助手」）、錯題清單的出處文字（features/assistant/sources）。
 * 只有出現出版社題組時才需要下載（本站題不必查）。
 */
import {
  DEFAULT_SOURCE_REGISTRY,
  isSourceRegistry,
  isSourceUsable,
  sourceStatus,
  taiwanToday,
  type ItemSourceScope,
  type SourceRegistry,
} from '@gsat/shared';
import { fetchDataFile, memoizeAsync } from './client';

export type { ItemSourcePublic, SourceRegistry } from '@gsat/shared';
export { isSourceRegistry };

export const SOURCES_PATH = 'bank/sources.json';

const loader = memoizeAsync(async (_key: string): Promise<SourceRegistry> => {
  try {
    return await fetchDataFile(SOURCES_PATH, isSourceRegistry);
  } catch {
    // 檔案不存在（P1 之前的部署）或讀不到：只有本站題庫（出版社題組 fail closed）。
    return DEFAULT_SOURCE_REGISTRY;
  }
});

/** 來源登記（同一頁面只下載一次；讀不到時是只有本站題庫的預設）。 */
export function loadSourceRegistry(): Promise<SourceRegistry> {
  return loader('sources');
}

/** 某個來源現在能不能顯示（網站）；登記檔沒有這個來源也算不能（fail closed）。 */
export function sourceActiveFn(registry: SourceRegistry, now: number = Date.now()): (src: string) => boolean {
  const today = taiwanToday(now);
  const byId = new Map(registry.sources.map((s) => [s.id, s]));
  return (src) => {
    const s = byId.get(src);
    return s !== undefined && isSourceUsable(s, today, ['web']);
  };
}

/**
 * 出版社題組（或任何帶 source 的題組）現在的授權狀態：ok、ended（停用、過期、登記檔沒有）、no_scope（有效但不含 scopes）。
 * 本站題（沒有 source）一律 ok。
 */
export function groupSourceStatus(
  registry: SourceRegistry | null,
  file: { source?: { id: string } | undefined },
  scopes: readonly ItemSourceScope[] = ['web'],
  now: number = Date.now(),
): 'ok' | 'ended' | 'no_scope' {
  if (!file.source) return 'ok';
  return sourceStatus(registry, file.source.id, taiwanToday(now), scopes);
}
