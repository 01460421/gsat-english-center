/**
 * 單字資料的載入（包一層 src/data/vocab.ts）。
 *
 * 多這一層是為了「同步讀取已經載入的資料」：src/data 的載入函式只回傳 Promise，
 * 就算檔案早已下載，元件第一次繪製時也只能先顯示「載入中」，下一個 microtask 才換成內容。
 * 在單字卡之間點同義詞跳來跳去時，這會造成一閃一閃的載入畫面。這裡把已完成的結果記下來，
 * 元件可以先同步查（peek），查不到才走非同步載入。
 * 下載、快取與錯誤處理仍完全交給 src/data（同一檔案只下載一次、失敗可重試）。
 */
import type { VocabEntry, VocabIndex, VocabLevel, VocabLevelFile } from '../../../data/vocab';
import { levelFromEntryId, loadVocabIndex, loadVocabLevel } from '../../../data/vocab';

let indexValue: VocabIndex | undefined;
const levelFiles = new Map<VocabLevel, VocabLevelFile>();
const entryMaps = new WeakMap<VocabLevelFile, Map<string, VocabEntry>>();

export function peekIndex(): VocabIndex | undefined {
  return indexValue;
}

export async function fetchIndex(): Promise<VocabIndex> {
  const index = await loadVocabIndex();
  indexValue = index;
  return index;
}

export async function fetchLevel(level: VocabLevel): Promise<VocabLevelFile> {
  const file = await loadVocabLevel(level);
  levelFiles.set(level, file);
  return file;
}

function entryMap(file: VocabLevelFile): Map<string, VocabEntry> {
  let map = entryMaps.get(file);
  if (!map) {
    map = new Map(file.entries.map((e) => [e.id, e]));
    entryMaps.set(file, map);
  }
  return map;
}

/** 已載入的級別檔案裡的所有條目；有任何一級還沒載入就回傳 undefined。 */
export function peekLevels(levels: readonly VocabLevel[]): VocabEntry[] | undefined {
  const out: VocabEntry[] = [];
  for (const level of levels) {
    const file = levelFiles.get(level);
    if (!file) return undefined;
    out.push(...file.entries);
  }
  return out;
}

/** 載入多個級別（平行下載），回傳所有條目。 */
export async function fetchLevels(levels: readonly VocabLevel[]): Promise<VocabEntry[]> {
  const files = await Promise.all(levels.map(fetchLevel));
  return files.flatMap((f) => f.entries);
}

/**
 * 同步查一筆條目：undefined 表示該級還沒載入（要呼叫 fetchEntry），null 表示確定找不到（id 格式錯或不存在）。
 */
export function peekEntry(id: string): VocabEntry | null | undefined {
  const level = levelFromEntryId(id);
  if (level === null) return null;
  const file = levelFiles.get(level);
  if (!file) return undefined;
  return entryMap(file).get(id) ?? null;
}

export async function fetchEntry(id: string): Promise<VocabEntry | null> {
  const level = levelFromEntryId(id);
  if (level === null) return null;
  return entryMap(await fetchLevel(level)).get(id) ?? null;
}

/** 依 id 從已載入的條目中取多筆（找不到的略過）。 */
export function entriesById(entries: readonly VocabEntry[]): Map<string, VocabEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

/** 測試用：清掉同步快取（src/data 的 Promise 快取另外用 clearDataCache() 清）。 */
export function resetVocabDataForTests(): void {
  indexValue = undefined;
  levelFiles.clear();
}
