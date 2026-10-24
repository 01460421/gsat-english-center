/**
 * 組卷演算法（docs/design/bank-mock.md §4.1–§4.5）：從一種難度的組卷池挑出 11 個題組。純函式，不讀 localStorage、不發請求。
 *
 * 確定性：同樣的 (pool, seed, used, avoid) 一定得到同一個結果。候選先依 uid 排序，亂數只用種子化的 sfc32（random.ts）。
 * 重現卷子靠的是代號，不是種子：used 每個人不同，pool 每次建置也可能不同。
 *
 * 步驟（§4.2）：
 *   1. 候選是同難度、同大題、沒有排除原因（ex）的題組；沒做過的代價 0，做過的代價 1，做過的依最後使用時間由舊到新。
 *   2. 沒做過的候選不夠一份的大題，從一開始就可以用代價 1 的那一層；其他大題只用代價 0。
 *      閱讀照組卷規則拆開算（每份 1 篇圖表或表格、2 篇其他文章、至少 1 篇連續文本），同 remainingEstimate()。
 *   3. 限制最多的大題先選：閱讀 → 混合題 → 作文 → 篇章結構 → 文意選填 → 綜合測驗（2 組）→ 中譯英 → 詞彙。
 *   4. 每個位置在允許的最低代價層裡、依種子洗牌後的順序挑第一個符合條件的：不重複、主題鍵和已選的沒有交集
 *      （詞彙題不比對）、閱讀三篇恰好一篇圖表或表格、多文本最多一篇。
 *   5. 某一步選不到就用 seed + 0x9e3779b9 × 輪次 從頭重來，最多 50 輪，記下是哪個大題選不到。
 *   6. 還是不行就依序放寬，每放寬一次再試 50 輪：(b) 主題衝突改成越少越好 → (c) 圖表篇數改成越接近一篇越好
 *      （多文本最多一篇也一起放寬）→ (a) 只對失敗次數最多的大題開放代價 1，還是不行再開放下一個大題。
 *      所以只有不夠的大題會用到做過的題組；主題或圖表造成的失敗先用 (b)、(c) 解決。
 *   7. 某個大題的候選數（含做過的）比需要的少：回傳 insufficient，畫面把那個難度標成「出題中」。
 *   8. 閱讀的圖表或表格那一篇固定放第一篇（第 35–38 題）；其他兩篇與綜合測驗兩組的前後由種子決定（就是挑選的順序）。
 *
 * avoid 只在換題時用（§4.7 第 (4) 部分）：固定其他位置的題組，只替空著的位置挑題；固定的題組照樣參加主題與圖表的比對，
 * 位置不重新排序。
 *
 * options（docs/design/weak-paper.md §6.4，加強卷的模考格式卷與中性卷用；自組模擬考不傳，輸出逐位元不變，bk1Golden.test.ts）：
 *   priority    在「沒做過」那一層裡先依優先序分 4 段（最高分的 ¾ 以上、½–¾、¼–½、其餘），同一段維持種子洗牌的順序；
 *               負數＝「盡量避開」（排在沒做過那一層的最後）。做過的那一層不受影響，所以「只有不夠的大題才用做過的」不變。
 *   selectable  取代 isSelectable（加強卷傳 isSelectableBk2：收請求的來源裡的出版社題組）。
 *   filter      額外的篩選（例如來源）。
 */
import type { BankSectionType } from '@gsat/shared';
import { BLUEPRINT_SLOTS, READING_SLOTS, SECTION_GROUP_COUNTS, SELECTION_ORDER, SLOT_COUNT } from './blueprint';
import { isSelectable, type MockPoolEntry, type MockPoolReadingEntry, type MockPoolTier } from './pool';
import { rngFromSeed, shuffled, type Rng } from './random';

/** uid → 最後使用時間（毫秒）；拿不到時間的是 0（當成很久以前做的）。 */
export type UsedMap = ReadonlyMap<string, number>;

/** 選中的一個題組。sw 是閱讀的可交換設定（其他題型是空陣列），快照與組成 Exam 時用（§5.3）。 */
export interface SlotPick {
  section: BankSectionType;
  uid: string;
  v: number;
  sw: [number, number][];
}

/** 換題用：長度 11、依代號的順序；固定的位置放那個題組在池子裡的條目，要挑的位置放 null。 */
export interface AvoidSpec {
  fixed: readonly (MockPoolEntry | null)[];
}

export type Relaxation = 'theme' | 'figure';

/** 加強卷用的選填參數（見檔頭）。 */
export interface AssembleOptions {
  priority?: (entry: MockPoolEntry, section: BankSectionType) => number;
  selectable?: (entry: MockPoolEntry) => boolean;
  filter?: (entry: MockPoolEntry, section: BankSectionType) => boolean;
}

export type AssembleSelectionResult =
  | {
      ok: true;
      /** 11 個題組，依代號的順序（§4.6）。 */
      slots: SlotPick[];
      /** 用到做過的題組的位置（slot 索引）。 */
      reused: number[];
      /** 放寬過的條件；只給測試與除錯看，不顯示給學生。 */
      relaxed: Relaxation[];
    }
  | { ok: false; reason: 'insufficient'; section: BankSectionType };

/** 每一階段最多試幾輪。 */
export const MAX_ROUNDS = 50;
/** 下一輪的種子：seed + ROUND_STEP × 輪次（mod 2^32）。 */
const ROUND_STEP = 0x9e3779b9;

type AnyEntry = MockPoolEntry & Partial<Pick<MockPoolReadingEntry, 'fig' | 'form' | 'sw'>>;

const hasFigure = (e: AnyEntry): boolean => e.fig != null;
const isMultiText = (e: AnyEntry): boolean => e.form === 'multi_text';
/** 連續文本：沒有圖表或表格、也不是多文本（閱讀的非圖表篇章只有這兩種形式）。 */
const isContinuous = (e: AnyEntry): boolean => !hasFigure(e) && !isMultiText(e);

const byUid = (a: AnyEntry, b: AnyEntry): number => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);

function sectionEntries(pool: MockPoolTier, section: BankSectionType, options?: AssembleOptions): AnyEntry[] {
  const selectable = options?.selectable ?? isSelectable;
  const filter = options?.filter;
  return (pool[section] as readonly AnyEntry[]).filter((e) => selectable(e) && (!filter || filter(e, section))).sort(byUid);
}

/**
 * 這些題組不重複地可以組幾份（只看數量，不考慮主題衝突）：一般大題是 ⌊題組數 ÷ 每份要幾組⌋；
 * 閱讀是 min（圖表與表格篇數，⌊其他篇數 ÷ 2⌋，連續文本篇數）（§2.1）。
 */
function capacity(section: BankSectionType, entries: readonly AnyEntry[]): number {
  if (section !== 'reading') return Math.floor(entries.length / SECTION_GROUP_COUNTS[section]);
  const figures = entries.filter(hasFigure).length;
  const others = entries.filter((e) => !hasFigure(e)).length;
  const continuous = entries.filter(isContinuous).length;
  return Math.min(figures, Math.floor(others / 2), continuous);
}

export interface RemainingEstimate {
  /** 還可以組約幾份全新的卷子（各大題的最小值）。 */
  papers: number;
  /** 每個大題：沒做過的題組數，以及只看這個大題能組幾份。 */
  sections: Record<BankSectionType, { unused: number; papers: number }>;
  /** 閱讀沒做過的篇數依組卷規則拆開（capacity 的三個上限）：圖表或表格、其他、其中的連續文本。不夠一份時說明是哪一種用完了。 */
  reading: { figure: number; other: number; continuous: number };
}

/**
 * 「還可以組約 N 份全新的卷子」（§2.1）：每個大題算沒做過的題組能組幾份，取最小值。
 * 不考慮主題衝突，所以畫面寫「約」；真實題庫測試比對這個數字和實際連續組卷的份數（§10.2）。
 */
export function remainingEstimate(pool: MockPoolTier, used: UsedMap): RemainingEstimate {
  const sections = {} as Record<BankSectionType, { unused: number; papers: number }>;
  const reading = { figure: 0, other: 0, continuous: 0 };
  let papers = Infinity;
  for (const section of SELECTION_ORDER) {
    const unused = sectionEntries(pool, section).filter((e) => !used.has(e.uid));
    const n = capacity(section, unused);
    sections[section] = { unused: unused.length, papers: n };
    papers = Math.min(papers, n);
    if (section === 'reading') {
      reading.figure = unused.filter(hasFigure).length;
      reading.other = unused.length - reading.figure;
      reading.continuous = unused.filter(isContinuous).length;
    }
  }
  return { papers: Number.isFinite(papers) ? papers : 0, sections, reading };
}

/** 題庫本身（含做過的）湊不出一份的大題；都夠是 null（§4.2 第 7 步、§2.8「出題中」）。只看數量。 */
export function insufficientSection(pool: MockPoolTier): BankSectionType | null {
  for (const section of SELECTION_ORDER) {
    if (sectionEntries(pool, section).length < SECTION_GROUP_COUNTS[section]) return section;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 組卷
// ---------------------------------------------------------------------------

interface Candidate {
  entry: AnyEntry;
  used: boolean;
}

interface Context {
  fixed: readonly (AnyEntry | null)[];
  /** 每個大題要挑的位置（固定的位置不算），依代號的順序。 */
  openSlots: Record<BankSectionType, number[]>;
  /** 每個大題的候選（依 uid 排序，不含固定的題組）。 */
  candidates: Record<BankSectionType, AnyEntry[]>;
  used: UsedMap;
  /** 沒做過的候選不夠的大題（§4.2 第 2 步）。 */
  short: ReadonlySet<BankSectionType>;
  /** 優先序（加強卷；沒有就是 bk1 的原始規則）。 */
  priority?: AssembleOptions['priority'];
}

interface Relax {
  theme: boolean;
  figure: boolean;
  openUsed: ReadonlySet<BankSectionType>;
}

type RoundResult = { ok: true; picks: AnyEntry[]; usedFlags: boolean[] } | { ok: false; section: BankSectionType };

/** 優先序的段（0 最先）：最高分的 ¾ 以上、½–¾、¼–½、其餘；負數（盡量避開）排最後；最高分 ≤ 0 時不分段。 */
function priorityBand(p: number, max: number): number {
  if (p < 0) return 4;
  if (max <= 0) return 0;
  if (p >= 0.75 * max) return 0;
  if (p >= 0.5 * max) return 1;
  if (p >= 0.25 * max) return 2;
  return 3;
}

/**
 * 洗牌後的候選，排成「沒做過（洗牌順序）→ 做過（最後使用時間由舊到新，同時間照洗牌順序）」。
 * 有優先序時，沒做過的那一層先依段排（穩定排序，同一段維持洗牌順序）；亂數的用法和沒有優先序時相同。
 */
function rankCandidates(entries: readonly AnyEntry[], used: UsedMap, rng: Rng, section: BankSectionType, priority?: AssembleOptions['priority']): Candidate[] {
  const order = shuffled(entries, rng);
  let freshEntries = order.filter((e) => !used.has(e.uid));
  if (priority) {
    const scored = freshEntries.map((entry, i) => ({ entry, i, p: priority(entry, section) }));
    const max = Math.max(0, ...scored.map((x) => x.p));
    freshEntries = scored
      .map((x) => ({ ...x, band: priorityBand(x.p, max) }))
      .sort((a, b) => a.band - b.band || a.i - b.i)
      .map((x) => x.entry);
  }
  const fresh = freshEntries.map((entry) => ({ entry, used: false }));
  const old = order
    .map((entry, i) => ({ entry, i, at: used.get(entry.uid) }))
    .filter((x) => x.at !== undefined)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.i - b.i)
    .map(({ entry }) => ({ entry, used: true }));
  return [...fresh, ...old];
}

function themeConflicts(theme: readonly string[], chosen: readonly (readonly string[])[]): number {
  if (theme.length === 0) return 0;
  const keys = new Set(theme);
  return chosen.filter((t) => t.some((k) => keys.has(k))).length;
}

/** 閱讀的形式扣分：這一篇放進去之後，離「恰好一篇圖表或表格、多文本最多一篇」差多少（0＝符合）。 */
function readingPenalty(entry: AnyEntry, picks: readonly (AnyEntry | null)[]): number {
  let figures = 0;
  let multi = 0;
  for (const i of READING_SLOTS) {
    const p = picks[i];
    if (!p) continue;
    if (hasFigure(p)) figures += 1;
    if (isMultiText(p)) multi += 1;
  }
  const figurePenalty = figures === 0 ? (hasFigure(entry) ? 0 : 1) : hasFigure(entry) ? 1 : 0;
  return figurePenalty + (isMultiText(entry) && multi >= 1 ? 1 : 0);
}

/**
 * 替一個位置挑題：硬性條件（不重複；沒放寬時主題不衝突、閱讀形式符合）過濾後，依
 * （閱讀形式扣分、代價、主題衝突數、洗牌順序）取最小。沒放寬時前三項都是 0，等於「第一個符合條件的」。
 */
function choose(
  section: BankSectionType,
  ranked: readonly Candidate[],
  picks: readonly (AnyEntry | null)[],
  themes: readonly (readonly string[])[],
  relax: Relax,
): Candidate | null {
  const taken = new Set(picks.filter((p): p is AnyEntry => p !== null).map((p) => p.uid));
  let best: { c: Candidate; score: number[] } | null = null;
  for (let i = 0; i < ranked.length; i += 1) {
    const c = ranked[i];
    if (!c || taken.has(c.entry.uid)) continue;
    const conflicts = section === 'vocabulary' ? 0 : themeConflicts(c.entry.theme, themes);
    if (!relax.theme && conflicts > 0) continue;
    const penalty = section === 'reading' ? readingPenalty(c.entry, picks) : 0;
    if (!relax.figure && penalty > 0) continue;
    const score = [penalty, c.used ? 1 : 0, conflicts, i];
    if (penalty === 0 && !c.used && conflicts === 0) return c;
    if (!best || compareScores(score, best.score) < 0) best = { c, score };
  }
  return best?.c ?? null;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function runRound(ctx: Context, rng: Rng, relax: Relax): RoundResult {
  const picks: (AnyEntry | null)[] = [...ctx.fixed];
  const usedFlags: boolean[] = picks.map(() => false);
  const themes: (readonly string[])[] = [];
  ctx.fixed.forEach((entry, i) => {
    if (entry && BLUEPRINT_SLOTS[i]?.section !== 'vocabulary') themes.push(entry.theme);
  });
  for (const section of SELECTION_ORDER) {
    const slots = ctx.openSlots[section];
    if (slots.length === 0) continue;
    const allowUsed = ctx.short.has(section) || relax.openUsed.has(section);
    const ranked = rankCandidates(ctx.candidates[section], ctx.used, rng, section, ctx.priority).filter((c) => allowUsed || !c.used);
    for (const slot of slots) {
      const chosen = choose(section, ranked, picks, themes, relax);
      if (!chosen) return { ok: false, section };
      picks[slot] = chosen.entry;
      usedFlags[slot] = chosen.used;
      if (section !== 'vocabulary') themes.push(chosen.entry.theme);
    }
  }
  return { ok: true, picks: picks as AnyEntry[], usedFlags };
}

/** 從一種難度的組卷池挑一份卷子的 11 個題組（§4.1）。options 見檔頭（自組模擬考不傳）。 */
export function assembleSelection(pool: MockPoolTier, seed: number, used: UsedMap, avoid?: AvoidSpec, options?: AssembleOptions): AssembleSelectionResult {
  const fixed: (AnyEntry | null)[] = avoid ? [...avoid.fixed] : Array.from({ length: SLOT_COUNT }, () => null);
  if (fixed.length !== SLOT_COUNT) throw new Error(`avoid.fixed 要有 ${SLOT_COUNT} 個位置`);
  const fixedUids = new Set(fixed.filter((e): e is AnyEntry => e !== null).map((e) => e.uid));

  const openSlots = {} as Record<BankSectionType, number[]>;
  const candidates = {} as Record<BankSectionType, AnyEntry[]>;
  const short = new Set<BankSectionType>();
  for (const section of SELECTION_ORDER) {
    openSlots[section] = BLUEPRINT_SLOTS.filter((s) => s.section === section && fixed[s.index] === null).map((s) => s.index);
    candidates[section] = sectionEntries(pool, section, options).filter((e) => !fixedUids.has(e.uid));
    const need = openSlots[section].length;
    if (need === 0) continue;
    // 第 7 步：題庫本身不夠。
    if (candidates[section].length < need) return { ok: false, reason: 'insufficient', section };
    // 第 2 步：沒做過的不夠。整份重組時閱讀照組卷規則拆開算；換題時只看數量。
    const unused = candidates[section].filter((e) => !used.has(e.uid));
    const enough = need === SECTION_GROUP_COUNTS[section] ? capacity(section, unused) >= 1 : unused.length >= need;
    if (!enough) short.add(section);
  }
  const ctx: Context = { fixed, openSlots, candidates, used, short, ...(options?.priority ? { priority: options.priority } : {}) };

  let round = 0;
  const failures = new Map<BankSectionType, number>();
  const tryPhase = (relax: Relax): (RoundResult & { ok: true }) | null => {
    for (let i = 0; i < MAX_ROUNDS; i += 1) {
      const roundSeed = (seed + Math.imul(ROUND_STEP, round)) >>> 0;
      round += 1;
      const res = runRound(ctx, rngFromSeed(roundSeed), relax);
      if (res.ok) return res;
      failures.set(res.section, (failures.get(res.section) ?? 0) + 1);
    }
    return null;
  };

  const opened = new Set<BankSectionType>();
  let relaxed: Relaxation[] = [];
  let result = tryPhase({ theme: false, figure: false, openUsed: opened });
  if (!result) {
    relaxed = ['theme'];
    result = tryPhase({ theme: true, figure: false, openUsed: opened });
  }
  if (!result) {
    relaxed = ['theme', 'figure'];
    result = tryPhase({ theme: true, figure: true, openUsed: opened });
  }
  const needy = SELECTION_ORDER.filter((s) => openSlots[s].length > 0 && !short.has(s));
  while (!result && opened.size < needy.length) {
    // (a)：失敗次數最多的大題先開放做過的題組；同樣多時照選擇順序。
    const next = needy.filter((s) => !opened.has(s)).sort((a, b) => (failures.get(b) ?? 0) - (failures.get(a) ?? 0) || SELECTION_ORDER.indexOf(a) - SELECTION_ORDER.indexOf(b))[0];
    if (!next) break;
    opened.add(next);
    result = tryPhase({ theme: true, figure: true, openUsed: opened });
  }
  if (!result) {
    // 所有條件都放寬後，候選數夠就一定選得到；走到這裡表示資料有問題，當成那個大題不夠。
    const worst = [...failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'reading';
    return { ok: false, reason: 'insufficient', section: worst };
  }

  let picks = result.picks.map((entry, i) => ({ entry, used: result.usedFlags[i] ?? false }));
  if (!avoid) {
    // 第 8 步：圖表或表格那一篇放閱讀第一篇（放寬圖表條件時可能不在第一個位置），其他照挑選的順序。
    const reading = READING_SLOTS.map((i) => picks[i]).filter((p): p is (typeof picks)[number] => p !== undefined);
    const sorted = [...reading.filter((p) => hasFigure(p.entry)), ...reading.filter((p) => !hasFigure(p.entry))];
    picks = picks.map((p, i) => {
      const at = READING_SLOTS.indexOf(i);
      return at >= 0 ? (sorted[at] ?? p) : p;
    });
  }
  return {
    ok: true,
    slots: picks.map(({ entry }, i) => ({
      section: BLUEPRINT_SLOTS[i]?.section ?? 'vocabulary',
      uid: entry.uid,
      v: entry.v,
      sw: entry.sw ? entry.sw.map(([q, r]) => [q, r] as [number, number]) : [],
    })),
    reused: picks.flatMap((p, i) => (p.used ? [i] : [])),
    relaxed,
  };
}
