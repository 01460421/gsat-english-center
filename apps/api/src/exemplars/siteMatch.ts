/**
 * 網站題目比對（docs/design/model-essays.md §5.3）：學生貼的題目就是網站上的題目時，建議改用網站題目（共用快取、可能 0 點，
 * 題目文字也比較完整）。
 *
 * 作法：第一次用到時，把題目庫裡白名單的作文題（siteGroups.ts）的「說明＋背景＋提示」切成 D8 同樣的窗口（漢字 8 字、英文 7 字，
 * d8HanWindows／d8EnglishWindows），建一張「窗口雜湊 → 題組」的表（模組層快取）。學生的題目與圖片描述也切窗口，算每一題的
 * 覆蓋率（命中窗口數 ÷ 那一題的窗口數）。覆蓋率 ≥ 60% 而且命中 ≥ 5 個窗口 → 回那一題（覆蓋率最高的）。
 *
 * 和設計不同的兩處（§12）：
 *   - 很多題目共用的說明句（「請依提示寫一篇英文作文」「文長至少 120 個單詞」）出現在 COMMON_WINDOW_GROUPS 題以上的窗口不算
 *     （分子分母都不算）：否則只貼了說明句的自訂題會被誤認成某一題，題目本身的內容才是比對的依據。
 *   - 提示只有一行標題的題目（例如「請以 An Unforgettable Class 為題」）沒有夠多的特有窗口：學生的題目整段包含那一題的提示
 *     （去掉空白與標點、轉小寫後，至少 STEM_CONTAINS_MIN_CHARS 個字元）也算相同。
 * 幾題的提示一字不差（參考試卷沿用歷屆題）：同分時取全部窗口（含共用的）重疊比例最高的那一題。
 * 門檻是設計值；test/exemplars.siteMatch.test.ts 用 111 題各自的題目文字（都要命中自己或提示相同的那一題）與自訂題語料
 * （都不能命中）定案。
 */
import { d8EnglishWindows, d8HanWindows, d8Hash } from '../ai/d8';
import type { WritingGroup } from '../ai/bank';
import { exemplarSiteGroups, siteTitle } from './siteGroups';

/** 比對門檻（設計值）。 */
export const SITE_MATCH = { coverage: 0.6, minHits: 5 } as const;
/** 出現在這麼多題以上的窗口當成共用的說明句，不算。 */
export const COMMON_WINDOW_GROUPS = 5;

/** 「整段包含提示」的最短長度（去掉空白與標點後的字元數）。 */
export const STEM_CONTAINS_MIN_CHARS = 20;

interface MatchIndex {
  /** 窗口雜湊 → 含有它的題組（只留不是共用說明句的窗口）。 */
  byWindow: Map<number, string[]>;
  /** 題組 → 它的（非共用）窗口數。 */
  sizes: Map<string, number>;
  /** 題組 → 全部窗口（含共用的；同分時比較用）。 */
  all: Map<string, Set<number>>;
  /** 題組 → 正規化後的提示（整段包含的比對用；太短的不放）。 */
  stems: Map<string, string>;
  groups: Map<string, WritingGroup>;
}

/** 比對用的正規形式：NFKC、去掉空白與標點符號、轉小寫。 */
export function compactText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** 一段文字的窗口雜湊集合（漢字與英文分開雜湊，同 D8）。 */
export function windowHashes(texts: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const t of texts) {
    for (const w of d8HanWindows(t)) out.add(d8Hash('han', w.window));
    for (const w of d8EnglishWindows(t)) out.add(d8Hash('en', w.window));
  }
  return out;
}

/** 題組要比對的文字：說明、背景、提示（圖片描述是本站寫的，學生貼不出來，不算）。 */
export function groupMatchTexts(g: WritingGroup): string[] {
  return [g.instructions, g.context ?? '', g.items[0]?.stem ?? ''].filter((t) => t.trim() !== '');
}

let cached: MatchIndex | null = null;

function index(): MatchIndex {
  if (cached) return cached;
  const all = new Map<number, string[]>();
  const groups = new Map<string, WritingGroup>();
  const sets = new Map<string, Set<number>>();
  const stems = new Map<string, string>();
  for (const g of exemplarSiteGroups()) {
    groups.set(g.group_id, g);
    const hashes = windowHashes(groupMatchTexts(g));
    sets.set(g.group_id, hashes);
    const stem = compactText((g.items[0]?.stem ?? '').replace(/^\s*提示\s*[:：︰]/, ''));
    if (stem.length >= STEM_CONTAINS_MIN_CHARS) stems.set(g.group_id, stem);
    for (const h of hashes) {
      const list = all.get(h);
      if (list) list.push(g.group_id);
      else all.set(h, [g.group_id]);
    }
  }
  const byWindow = new Map<number, string[]>();
  const sizes = new Map<string, number>();
  for (const [h, ids] of all) {
    if (ids.length >= COMMON_WINDOW_GROUPS) continue;
    byWindow.set(h, ids);
    for (const id of ids) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  }
  cached = { byWindow, sizes, all: sets, stems, groups };
  return cached;
}

export interface SiteMatch {
  group_id: string;
  title: string;
  coverage: number;
  hits: number;
}

/** 學生的題目（正規化後的題目與圖片描述）和哪一題網站題目相同；沒有回 null。 */
export function matchSiteGroup(texts: readonly string[]): SiteMatch | null {
  const idx = index();
  const mine = windowHashes(texts);
  const hits = new Map<string, number>();
  for (const h of mine) {
    for (const id of idx.byWindow.get(h) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
  }
  const candidates: Array<{ id: string; coverage: number; hits: number }> = [];
  for (const [id, n] of hits) {
    const size = idx.sizes.get(id) ?? 0;
    if (size === 0 || n < SITE_MATCH.minHits) continue;
    const coverage = n / size;
    if (coverage >= SITE_MATCH.coverage) candidates.push({ id, coverage, hits: n });
  }
  const compact = compactText(texts.join('\n'));
  for (const [id, stem] of idx.stems) {
    if (compact.includes(stem) && !candidates.some((c) => c.id === id)) candidates.push({ id, coverage: 1, hits: hits.get(id) ?? 0 });
  }
  if (candidates.length === 0) return null;
  /** 全部窗口（含共用的說明句）的重疊比例：提示相同的幾題靠它分出學生貼的是哪一題。 */
  const overlap = (id: string) => {
    const set = idx.all.get(id)!;
    let n = 0;
    for (const h of mine) if (set.has(h)) n++;
    return n / (set.size + mine.size - n || 1);
  };
  const scored = candidates.map((c) => ({ ...c, overlap: overlap(c.id) }));
  scored.sort((a, b) => b.coverage - a.coverage || b.overlap - a.overlap || b.hits - a.hits || a.id.localeCompare(b.id));
  const best = scored[0]!;
  return { group_id: best.id, title: siteTitle(idx.groups.get(best.id)!), coverage: best.coverage, hits: best.hits };
}
