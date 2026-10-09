/**
 * 抽題：從某個題型 × 難度的題組裡挑一組給學生做。
 *
 *   1. 這一格有「做到一半（或剛交卷還沒換下一組）」的題組 → 接著做同一組（resume）；
 *   2. 有沒做過的 → 隨機挑一組（new）；
 *   3. 全部做過了 → 挑最早做的那組再練一次（repeat），畫面上說明「這一格都做過了」。
 * 隨機而不是照順序：同一班同學用同一個題庫，照順序的話大家做的都一樣，討論時容易互相洩題。
 */
import { groupKey, type BankIndexEntry, type PracticeSectionType, type Tier } from '../../data/bank';
import { cellKey, type PracticeHistory } from './history';
import { TIERS } from './labels';

export type PickReason = 'resume' | 'new' | 'repeat';

export interface Pick {
  entry: BankIndexEntry;
  reason: PickReason;
}

export function cellEntries(entries: readonly BankIndexEntry[], section: PracticeSectionType, tier: Tier): BankIndexEntry[] {
  return entries.filter((e) => e.section_type === section && e.tier === tier);
}

/**
 * @param exclude 「再一組」：剛交卷的那一組（uid@version），不接續、也排在重練順序的最後。
 * @param random 0–1 的亂數（測試時傳固定值）。
 */
export function pickGroup(
  candidates: readonly BankIndexEntry[],
  history: PracticeHistory,
  section: PracticeSectionType,
  tier: Tier,
  { exclude = null, random = Math.random }: { exclude?: string | null; random?: () => number } = {},
): Pick | null {
  if (candidates.length === 0) return null;
  const currentKey = history.current[cellKey(section, tier)];
  if (currentKey !== undefined && currentKey !== exclude) {
    const current = candidates.find((e) => groupKey(e) === currentKey);
    if (current) return { entry: current, reason: 'resume' };
  }
  const fresh = candidates.filter((e) => history.done[e.uid] === undefined && groupKey(e) !== exclude);
  if (fresh.length > 0) {
    const i = Math.min(fresh.length - 1, Math.floor(random() * fresh.length));
    const entry = fresh[i];
    if (entry) return { entry, reason: 'new' };
  }
  // 全部做過：最早做的先重練；剛交卷的這組排到最後（這一格只有一組時才會再抽到它）。
  const sorted = [...candidates].sort((a, b) => {
    const lastA = groupKey(a) === exclude ? 1 : 0;
    const lastB = groupKey(b) === exclude ? 1 : 0;
    return lastA - lastB || (history.done[a.uid]?.at ?? '').localeCompare(history.done[b.uid]?.at ?? '');
  });
  const entry = sorted[0];
  return entry ? { entry, reason: 'repeat' } : null;
}

/**
 * 題型頁（/cloze 等）網址沒有指定難度時練哪一個：
 *   1. 這個題型最近練過的難度——交卷時間（done 的 at），或每一格正在做的那一組最後一次作答的時間（activity）；
 *      只是打開過、一題都沒作答的不算（抽題時就會記下 current，不能拿來判斷）；
 *   2. 沒練過：穩定基礎；穩定基礎還沒有題組時，改用第一個有題組的難度（都沒有就還是穩定基礎，畫面顯示「出題中」）。
 * @param activity 題組（uid@version）的作答紀錄最後一次作答的時間（ISO 8601）；沒作答過回傳 null。
 */
export function defaultTier(
  entries: readonly BankIndexEntry[],
  history: PracticeHistory,
  section: PracticeSectionType,
  activity: (key: string) => string | null,
): Tier {
  let best: Tier | null = null;
  let bestAt = '';
  for (const rec of Object.values(history.done)) {
    if (rec.section !== section || !TIERS.includes(rec.tier) || rec.at <= bestAt) continue;
    best = rec.tier;
    bestAt = rec.at;
  }
  for (const tier of TIERS) {
    const key = history.current[cellKey(section, tier)];
    const at = key === undefined ? null : activity(key);
    if (at === null || at <= bestAt) continue;
    best = tier;
    bestAt = at;
  }
  if (best) return best;
  return TIERS.find((t) => cellEntries(entries, section, t).length > 0) ?? 'basic';
}

/** 選單上每一格顯示的數字：共幾組、做過幾組。 */
export function cellProgress(
  entries: readonly BankIndexEntry[],
  history: PracticeHistory,
  section: PracticeSectionType,
  tier: Tier,
): { total: number; done: number } {
  const list = cellEntries(entries, section, tier);
  return { total: list.length, done: list.filter((e) => history.done[e.uid] !== undefined).length };
}
