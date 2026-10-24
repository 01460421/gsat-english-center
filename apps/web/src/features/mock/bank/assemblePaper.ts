/**
 * 加強卷的組卷（docs/design/weak-paper.md §4、§6）。純函式：不讀 localStorage、不發請求。
 *
 *   w  弱點加強卷：兩層選題（§6.3）。先依弱點權重把時間分給各大題（單一大題最多六成），再在大題內依「邊際收益」挑題組。
 *      沒有明顯弱點時可以組「均衡加強卷」（request.balanced：每個選擇題大題輪流放，§3.4）。
 *   f  模考格式卷：自組模擬考的演算法（assembleSelection）加「優先序」：每個大題在沒做過的那一層裡，先挑考到弱點的題組（§6.4）。
 *   m  中性模考格式卷：冷啟動的診斷卷（優先序＝這組有幾種不同的技能）、組卷頁「沒有明顯弱點」時的模考格式卷（fromPapers），
 *      或 /mock 選了出版社來源時（只看種子，同 bk1）。
 *   r  隨機抽題卷：學生選的大題、組數、難度與來源，依種子洗牌依序挑（§6.5）。
 *
 * 確定性（§6.7）：同樣的（組卷池、技能分布、來源登記、弱點、請求、做過、盡量避開、種子、現在的日期）一定得到同一組題組：
 * 候選先依 uid 排序，亂數只用 random.ts 的 sfc32。重現卷子靠代號（明列每一組），不靠種子。
 *
 * 候選（§6.2）：isSelectableBk2（請求的來源裡、有效而且授權包含網站與 PDF 的來源；出版社題組的 ex: 'ns' 照收，其他排除原因不收；
 * 版本 ≤ 31）。做過＝used（題庫練習、自組卷、加強卷與本機作答紀錄）；盡量避開＝avoid（「我的加強卷」裡還沒開考的卷子、
 * 被「換一份」取代的那一份）。一份卷子裡 uid 不重複、主題鍵不交集（詞彙題不比對；挑不到時才放寬）。
 *
 * 命中（§6.3）：每一題的代碼先依別名表正規化（paperSkills.questionSkills），**每一題只算給它命中的目標裡權重最高的那一個**，
 * 同一題不會讓兩個弱點同時計分；陷阱目標的命中是「有這類錯誤選項的題數」（題目層級，和技能一起比）。
 */
import { BANK_UID_CODES, TIERS, namespaceOf, taiwanToday, usablePaperSources, type BankSectionType, type ItemNamespace, type SourceRegistry, type Tier } from '@gsat/shared';
import { assembleSelection, type AssembleOptions, type Relaxation, type UsedMap } from './assemble';
import { BK2_MAX_GROUPS, BK2_MAX_QUESTIONS, BK2_MAX_RANDOM_MINUTES, BK2_QUESTIONS_PER_GROUP, BK2_SECTION_ORDER, type Bk2Kind, type Bk2Slot } from './code2';
import { GROUP_MINUTES, paperMinutes } from './layout';
import { questionSkills, trapCompositionOf, type PaperSkills } from './paperSkills';
import { isSelectableBk2, type MockPool, type MockPoolEntry, type MockPoolReadingEntry } from './pool';
import { rngFromSeed, shuffled, type Rng } from './random';

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type PaperLength = 20 | 40 | 60;
/** 做過的題組：avoid＝盡量不用（不夠才用）、retest＝也重做 7 天以上前錯過的（w）、allow＝和沒做過的一樣（r）。 */
export type ReuseRule = 'avoid' | 'retest' | 'allow';

/** 組卷的請求（存進「我的加強卷」，不含種子；§6.1）。 */
export interface PaperRequest {
  kind: Bk2Kind;
  /** w、f、m：一個（基準難度）；r：1–3 個。 */
  tiers: Tier[];
  /** w：空陣列＝依弱點自動選，有值＝學生自己勾的大題；f、m：忽略（照藍圖）；r：勾的大題。 */
  sections: BankSectionType[];
  /** r：每個大題幾組。 */
  counts?: Partial<Record<BankSectionType, number>>;
  /** w：約幾分鐘。 */
  minutes?: PaperLength;
  /** 來源 id（shared 的 AI_BANK_SOURCE_ID 與出版社來源）。 */
  sources: string[];
  reuse: ReuseRule;
  /** 報告推薦、要直接放進來的 uid（≤ 2，w）。 */
  pins?: string[];
  /** m：冷啟動的診斷卷（優先序依技能數，§6.4）。 */
  diagnostic?: boolean;
  /** w：沒有明顯弱點時的均衡加強卷（§3.4）。 */
  balanced?: boolean;
  /** m：組卷頁「沒有明顯弱點」時的「（換高一級）組一份模考格式卷」：中性、照常給難度建議，列在「我的加強卷」。 */
  fromPapers?: boolean;
}

/** 組卷用到的弱點目標（weakness.ts 的 WeakTarget 是它的超集）。 */
export interface AssembleTarget {
  key: string;
  kind: 'section' | 'skill' | 'trap' | 'error';
  section: BankSectionType;
  /** 主代碼、陷阱代碼或錯因代碼；大題是 null。 */
  code: string | null;
  /** 選題時算命中的代碼：技能是 [code]，錯因群組是對到的主代碼（也可以有陷阱代碼），其他是 []。陷阱目標看 code。 */
  codes: readonly string[];
  weight: number;
}

export interface AssembleProfile {
  /** ≤ 6 項，依權重。 */
  targets: readonly AssembleTarget[];
  /** 保持手感的大題（§5.6）。 */
  maintenance: { section: BankSectionType } | null;
}

/** 這台裝置錯過的題組（retest 用）：uid → 最後一次答錯的時間、每一題答錯的題的正規化技能代碼。 */
export type WrongGroups = ReadonlyMap<string, { at: number; questions: readonly (readonly string[])[] }>;

export interface AssembleInput {
  pool: MockPool;
  skills: PaperSkills;
  /** 來源登記（bank/sources.json）；讀不到時是 null（只有本站題庫可用）。 */
  sources: SourceRegistry | null;
  /** w、f 的弱點；r、m 是 null。 */
  profile: AssembleProfile | null;
  request: PaperRequest;
  used: UsedMap;
  avoid: ReadonlySet<string>;
  wrong: WrongGroups;
  seed: number;
  /** 現在（毫秒）：來源的到期日、「7 天以上前做過」。 */
  now: number;
}

export type SlotFlag = 'reused' | 'retest' | 'maintenance' | 'adjacent_tier' | 'pinned' | 'no_tags' | 'avoided_reuse' | 'balanced';

export interface SlotNote {
  /** 弱點鍵 → 這組命中幾題（每題只算給一個弱點；陷阱是有這類錯誤選項的題數）。 */
  hits: Record<string, number>;
  flags: SlotFlag[];
}

export interface SlotPick2 {
  section: BankSectionType;
  tier: Tier;
  ns: ItemNamespace;
  uid: string;
  v: number;
  /** 閱讀的可交換設定（出版社題與其他題型是空陣列）。 */
  sw: [number, number][];
}

export type AssembleFailure =
  /** w：沒有目標、不是均衡加強卷（畫面顯示「沒有明顯弱點」，§3.4）。 */
  | { ok: false; reason: 'no_weakness' }
  /** 有目標，但所有目標的大題在可用的難度與來源都沒有候選。 */
  | { ok: false; reason: 'no_targets' }
  /** 某個大題連做過的都不夠。 */
  | { ok: false; reason: 'insufficient'; section: BankSectionType; tier?: Tier }
  /** w：學生只勾了作文（或作文＋放不進的大題），但長度不到 40 分鐘（作文一篇 25 分鐘，§4.1）。 */
  | { ok: false; reason: 'composition_too_short' };

export type AssembleResult =
  | {
      ok: true;
      kind: Bk2Kind;
      /** 依卷面順序（大題依藍圖順序，同大題照選題結果）。 */
      slots: SlotPick2[];
      notes: SlotNote[];
      /** 卷子的作答時間（layout.ts 的 paperMinutes）。 */
      minutes: number;
      relaxed: Relaxation[];
    }
  | AssembleFailure;

// ---------------------------------------------------------------------------
// 常數（設計值）
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** 每組最多算幾題命中（§6.3）。 */
const HIT_CAP = 3;
/** 大題弱點的收益係數（0.1 × W_大題）。 */
const SECTION_GAIN = 0.1;
/** 單一大題最多占幾成時間（只選一個大題時例外）。 */
const SECTION_SHARE_CAP = 0.6;
/** 時間可以超出預算幾分鐘。 */
const BUDGET_SLACK = 2;
/** 學生手動勾、沒有弱點的大題的最小權重。 */
const MIN_SECTION_WEIGHT = 0.05;
/** 長度 ≥ 這個分鐘數才放保持手感與作文。 */
const LONG_PAPER = 40;
/** 重做：幾天以上前做過。 */
const RETEST_DAYS = 7;
/** 報告推薦最多直接放幾組。 */
const MAX_PINS = 2;
/** 相鄰難度：基準難度裡「沒做過、命中 ≥ 1 題」的題組少於幾組時，為那個弱點用相鄰一級。 */
const ADJACENT_MIN_SUPPLY = 2;

/** 選擇題大題（均衡加強卷、保持手感；混合題不算）。依均衡加強卷放的順序：閱讀、綜合測驗優先。 */
export const BALANCED_SECTIONS: readonly BankSectionType[] = ['reading', 'cloze', 'vocabulary', 'structure', 'word_bank'];
/** 同權重時的大題順序（沒有弱點排名可依時）。 */
const SECTION_PRIORITY: readonly BankSectionType[] = ['reading', 'cloze', 'vocabulary', 'structure', 'word_bank', 'mixed', 'translation', 'composition'];

/** 同權重時的大題順序：先依弱點的排名（大題第一次出現在 targets 的順序），其餘照 SECTION_PRIORITY。 */
export function sectionTieOrder(targets: readonly Pick<AssembleTarget, 'section'>[]): BankSectionType[] {
  const out: BankSectionType[] = [];
  for (const t of targets) if (!out.includes(t.section)) out.push(t.section);
  for (const s of SECTION_PRIORITY) if (!out.includes(s)) out.push(s);
  return out;
}
/** r 的選擇順序（限制多的先選，同 bk1）。 */
const RANDOM_ORDER: readonly BankSectionType[] = ['reading', 'mixed', 'composition', 'structure', 'word_bank', 'cloze', 'translation', 'vocabulary'];

type AnyEntry = MockPoolEntry & Partial<Pick<MockPoolReadingEntry, 'fig' | 'form' | 'sw'>>;

interface Candidate {
  entry: AnyEntry;
  section: BankSectionType;
  tier: Tier;
  /** 種子洗牌後的順序（同分時用）。 */
  rank: number;
}

const byUid = (a: { uid: string }, b: { uid: string }): number => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
const keyOf = (e: { uid: string; v: number }): string => `${e.uid}@${e.v}`;
const isWriting = (s: BankSectionType): boolean => s === 'translation' || s === 'composition';

function sectionOrder(s: BankSectionType): number {
  return BK2_SECTION_ORDER.indexOf(s);
}

function swOf(e: AnyEntry): [number, number][] {
  return e.sw ? e.sw.map(([q, r]) => [q, r] as [number, number]) : [];
}

function pickOf(c: Candidate): SlotPick2 {
  return { section: c.section, tier: c.tier, ns: namespaceOf(c.entry.uid) ?? 'ai', uid: c.entry.uid, v: c.entry.v, sw: swOf(c.entry) };
}

function themeConflicts(theme: readonly string[], chosen: readonly (readonly string[])[]): number {
  if (theme.length === 0) return 0;
  const keys = new Set(theme);
  return chosen.filter((t) => t.some((k) => keys.has(k))).length;
}

/** 依卷面順序排：大題依藍圖順序；同大題照挑選的順序（r 先依難度）。 */
function sortPicks<T extends { pick: SlotPick2; order: number }>(items: T[], byTier = false): T[] {
  return [...items].sort(
    (a, b) =>
      sectionOrder(a.pick.section) - sectionOrder(b.pick.section) || (byTier ? TIERS.indexOf(a.pick.tier) - TIERS.indexOf(b.pick.tier) : 0) || a.order - b.order,
  );
}

// ---------------------------------------------------------------------------
// 命中
// ---------------------------------------------------------------------------

/**
 * 一組題組命中各目標的題數：每一題先找出它命中的目標，只算給權重最高的那一個（同權重依鍵排序）。
 * allowed 有給時只考慮這些目標（相鄰難度只為那個弱點）。
 */
export function groupHits(
  skills: PaperSkills,
  entry: { uid: string; v: number },
  section: BankSectionType,
  targets: readonly AssembleTarget[],
  allowed?: ReadonlySet<string>,
): Record<string, number> {
  const own = targets
    .filter((t) => t.section === section && t.kind !== 'section' && (!allowed || allowed.has(t.key)))
    .sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));
  const hits: Record<string, number> = {};
  if (own.length === 0) return hits;
  const key = keyOf(entry);
  const group = skills.groups[key];
  if (isWriting(section)) {
    // 中譯英：題組層級的寫作代碼（ts:、tt:）；命中算 1 組。作文沒有代碼。
    const codes = new Set(group?.w ?? []);
    const t = own.find((x) => x.codes.some((c) => codes.has(c)));
    if (t) hits[t.key] = 1;
    return hits;
  }
  for (const label of Object.keys(group?.q ?? {})) {
    const codes = new Set(questionSkills(skills, key, section, label));
    const traps = trapCompositionOf(skills, key, label);
    const matches = (code: string): boolean => (code.includes(':') ? codes.has(code) : (traps?.[code] ?? 0) > 0);
    const t = own.find((x) => (x.kind === 'trap' ? x.code !== null && matches(x.code) : x.codes.some(matches)));
    if (t) hits[t.key] = (hits[t.key] ?? 0) + 1;
  }
  return hits;
}

/** 題組有沒有任何技能標註（出版社題 tag_basis: none 時每一題都是空陣列）。 */
function hasTags(skills: PaperSkills, entry: { uid: string; v: number }, section: BankSectionType): boolean {
  if (isWriting(section)) return true;
  const q = skills.groups[keyOf(entry)]?.q;
  return q !== undefined && Object.values(q).some((codes) => codes.length > 0);
}

/** 不同技能代碼的數量（診斷卷的優先序：技能盡量分散）。 */
function distinctSkills(skills: PaperSkills, entry: { uid: string; v: number }, section: BankSectionType): number {
  const key = keyOf(entry);
  if (isWriting(section)) return new Set(skills.groups[key]?.w ?? []).size;
  const out = new Set<string>();
  for (const label of Object.keys(skills.groups[key]?.q ?? {})) for (const c of questionSkills(skills, key, section, label)) out.add(c);
  return out.size;
}

/** 優先序（§6.4）＝ Σ 這個大題的弱點 W × min(命中, 3)。 */
function weaknessPriority(skills: PaperSkills, targets: readonly AssembleTarget[], entry: { uid: string; v: number }, section: BankSectionType): number {
  const hits = groupHits(skills, entry, section, targets);
  return targets.reduce((sum, t) => sum + t.weight * Math.min(hits[t.key] ?? 0, HIT_CAP), 0);
}

// ---------------------------------------------------------------------------
// 進入點
// ---------------------------------------------------------------------------

/** 依請求組一份加強卷（§6）。 */
export function assemblePaper(input: AssembleInput): AssembleResult {
  const usable = usablePaperSources(input.sources, input.request.sources, taiwanToday(input.now));
  switch (input.request.kind) {
    case 'w':
      return assembleWeakness(input, usable);
    case 'r':
      return assembleRandom(input, usable);
    default:
      return assembleFull(input, usable);
  }
}

// ---------------------------------------------------------------------------
// 模考格式卷（f）與中性模考格式卷（m）：bk1 的演算法加優先序
// ---------------------------------------------------------------------------

function assembleFull(input: AssembleInput, usable: ReadonlySet<string>): AssembleResult {
  const { request, skills, avoid } = input;
  const tier = request.tiers[0] ?? 'basic';
  const targets = request.kind === 'f' ? (input.profile?.targets ?? []) : [];
  const diagnostic = request.kind === 'm' && request.diagnostic === true;
  const usePriority = targets.length > 0 || diagnostic || avoid.size > 0;
  const options: AssembleOptions = {
    selectable: (e) => isSelectableBk2(e, usable),
    ...(usePriority
      ? {
          priority: (entry: MockPoolEntry, section: BankSectionType) => {
            if (avoid.has(entry.uid)) return -1;
            if (diagnostic) return distinctSkills(skills, entry, section);
            return targets.length > 0 ? weaknessPriority(skills, targets, entry, section) : 0;
          },
        }
      : {}),
  };
  const selection = assembleSelection(input.pool.tiers[tier], input.seed, input.used, undefined, options);
  if (!selection.ok) return { ok: false, reason: 'insufficient', section: selection.section, tier };
  const reused = new Set(selection.reused);
  const slots: SlotPick2[] = selection.slots.map((s) => ({ section: s.section, tier, ns: namespaceOf(s.uid) ?? 'ai', uid: s.uid, v: s.v, sw: s.sw }));
  const notes: SlotNote[] = slots.map((s, i) => {
    const flags: SlotFlag[] = [];
    if (reused.has(i)) flags.push('reused');
    else if (avoid.has(s.uid)) flags.push('avoided_reuse');
    if (targets.length > 0 && !hasTags(skills, s, s.section)) flags.push('no_tags');
    return { hits: targets.length > 0 ? groupHits(skills, s, s.section, targets) : {}, flags };
  });
  return { ok: true, kind: request.kind, slots, notes, minutes: paperMinutes(slots.map((s) => s.section)), relaxed: selection.relaxed };
}

// ---------------------------------------------------------------------------
// 隨機抽題卷（r）
// ---------------------------------------------------------------------------

function assembleRandom(input: AssembleInput, usable: ReadonlySet<string>): AssembleResult {
  const { request, pool, used, avoid } = input;
  const rng = rngFromSeed(input.seed);
  const tiers = TIERS.filter((t) => request.tiers.includes(t));
  if (tiers.length === 0) return { ok: false, reason: 'insufficient', section: request.sections[0] ?? 'reading' };
  const wanted = RANDOM_ORDER.filter((s) => request.sections.includes(s) && (request.counts?.[s] ?? 0) > 0);
  const picked: { pick: SlotPick2; order: number; note: SlotNote; theme: string[] }[] = [];
  const taken = new Set<string>();
  let relaxedTheme = false;
  let order = 0;
  for (const section of wanted) {
    const need = request.counts?.[section] ?? 0;
    // 超過上限（中譯英、作文各 1 組，其他 12 組）不默默截短：組數要完全等於設定，畫面請學生減少組數（同 capViolation）。
    if (need > (isWriting(section) ? 1 : BK2_MAX_GROUPS)) return { ok: false, reason: 'insufficient', section };
    const entries: Candidate[] = tiers
      .flatMap((tier) => (pool.tiers[tier][section] as readonly AnyEntry[]).filter((e) => isSelectableBk2(e, usable)).map((entry) => ({ entry, section, tier, rank: 0 })))
      .sort((a, b) => byUid(a.entry, b.entry) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
    if (entries.length < need) return { ok: false, reason: 'insufficient', section };
    const order0 = shuffled(entries, rng).map((c, i) => ({ ...c, rank: i }));
    // 做過的題組：allow 和沒做過的一樣；其他規則先用沒做過的（不在「盡量避開」的先），不夠時才用做過的（最早做的先用）。
    const layer = (c: Candidate): number => {
      if (request.reuse === 'allow') return 0;
      if (used.has(c.entry.uid)) return 2;
      return avoid.has(c.entry.uid) ? 1 : 0;
    };
    const ranked = [...order0].sort((a, b) => layer(a) - layer(b) || (layer(a) === 2 ? (used.get(a.entry.uid) ?? 0) - (used.get(b.entry.uid) ?? 0) : 0) || a.rank - b.rank);
    for (let n = 0; n < need; n += 1) {
      const themes = picked.map((p) => p.theme);
      const free = ranked.filter((c) => !taken.has(c.entry.uid));
      // 放寬的順序（§6.5）：主題 → 做過的。沒做過的（含盡量避開）主題不撞的先；沒有才放寬主題；再沒有才用做過的。
      const fresh = free.filter((c) => layer(c) < 2);
      const old = free.filter((c) => layer(c) === 2);
      const noConflict = (list: Candidate[]) => list.find((c) => section === 'vocabulary' || themeConflicts(c.entry.theme, themes) === 0);
      let chosen = noConflict(fresh);
      if (!chosen && fresh.length > 0) {
        chosen = fresh[0];
        relaxedTheme = true;
      }
      if (!chosen) chosen = noConflict(old) ?? old[0];
      if (!chosen) return { ok: false, reason: 'insufficient', section };
      if (section !== 'vocabulary' && themeConflicts(chosen.entry.theme, themes) > 0) relaxedTheme = true;
      taken.add(chosen.entry.uid);
      const flags: SlotFlag[] = [];
      if (used.has(chosen.entry.uid)) flags.push('reused');
      else if (avoid.has(chosen.entry.uid)) flags.push('avoided_reuse');
      picked.push({ pick: pickOf(chosen), order: (order += 1), note: { hits: {}, flags }, theme: section === 'vocabulary' ? [] : chosen.entry.theme });
    }
  }
  if (picked.length === 0) return { ok: false, reason: 'insufficient', section: request.sections[0] ?? 'reading' };
  const sorted = sortPicks(picked, true);
  const violation = capViolation(sorted.map((p) => p.pick));
  if (violation) return { ok: false, reason: 'insufficient', section: violation };
  const minutes = paperMinutes(sorted.map((p) => p.pick.section));
  // 最長 100 分鐘（§4.4）：同組數的上限，不默默截短，回傳最後一個大題（畫面請學生減少組數）。
  if (minutes > BK2_MAX_RANDOM_MINUTES) return { ok: false, reason: 'insufficient', section: sorted[sorted.length - 1]?.pick.section ?? 'reading' };
  return {
    ok: true,
    kind: 'r',
    slots: sorted.map((p) => p.pick),
    notes: sorted.map((p) => p.note),
    minutes,
    relaxed: relaxedTheme ? ['theme'] : [],
  };
}

/** 超過 12 組或 80 題時回傳最後一個大題（畫面請學生減少組數）。 */
function capViolation(slots: readonly SlotPick2[]): BankSectionType | null {
  const questions = slots.reduce((n, s) => n + (isWriting(s.section) ? 0 : BK2_QUESTIONS_PER_GROUP[s.section]), 0);
  if (slots.length > BK2_MAX_GROUPS || questions > BK2_MAX_QUESTIONS) return slots[slots.length - 1]?.section ?? 'reading';
  return null;
}

// ---------------------------------------------------------------------------
// 弱點加強卷（w）
// ---------------------------------------------------------------------------

/** 大題權重 ωₛ（§6.3 第 2 步）＝ 大題弱點的 W ＋ 技能與錯因群組 W 的合計 ＋ 0.5 × 陷阱 W 的合計。 */
export function sectionWeights(targets: readonly AssembleTarget[]): Map<BankSectionType, number> {
  const out = new Map<BankSectionType, number>();
  for (const t of targets) {
    const w = t.kind === 'trap' ? 0.5 * t.weight : t.weight;
    out.set(t.section, (out.get(t.section) ?? 0) + w);
  }
  return out;
}

/**
 * 時間分配（§6.3 第 3 步）：依 ω 由大到小每個大題先放一組（放得下才放），再重複把一組加給「目標占比 − 目前占比」最大的大題，
 * 條件：合計 ≤ B ＋ 2 分鐘、單一大題 ≤ 六成（只有一個大題時例外）、總題數 ≤ 80、總組數 ≤ 12、中譯英與作文各最多 1 組、
 * 那個大題還有題組可用（supply）。加不進任何一組時停止。同權重時依 tieOrder（弱點的排名，sectionTieOrder）。
 */
export function allocateGroups(
  weights: ReadonlyMap<BankSectionType, number>,
  budget: number,
  supply: ReadonlyMap<BankSectionType, number>,
  reserved: { groups: number; questions: number } = { groups: 0, questions: 0 },
  tieOrder: readonly BankSectionType[] = SECTION_PRIORITY,
): Map<BankSectionType, number> {
  const sections = [...weights.keys()].filter((s) => (weights.get(s) ?? 0) > 0);
  let order = [...sections].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0) || tieOrder.indexOf(a) - tieOrder.indexOf(b));
  let total = sections.reduce((sum, s) => sum + (weights.get(s) ?? 0), 0);
  const counts = new Map<BankSectionType, number>();
  let single = sections.length === 1;
  let time = 0;
  let groups = reserved.groups;
  let questions = reserved.questions;
  const canAdd = (s: BankSectionType): boolean => {
    const n = counts.get(s) ?? 0;
    if (isWriting(s) && n >= 1) return false;
    if (n + 1 > (supply.get(s) ?? 0)) return false;
    if (groups + 1 > BK2_MAX_GROUPS) return false;
    const q = isWriting(s) ? 0 : BK2_QUESTIONS_PER_GROUP[s];
    if (questions + q > BK2_MAX_QUESTIONS) return false;
    if (time + GROUP_MINUTES[s] > budget + BUDGET_SLACK + 1e-9) return false;
    // 六成的上限從第二組起算：一組 25 分鐘的作文在 40 分鐘的卷子裡（六成是 24 分鐘）也放得進去（§4.1）。
    if (!single && n >= 1 && (n + 1) * GROUP_MINUTES[s] > SECTION_SHARE_CAP * budget + 1e-9) return false;
    return true;
  };
  const add = (s: BankSectionType) => {
    counts.set(s, (counts.get(s) ?? 0) + 1);
    time += GROUP_MINUTES[s];
    groups += 1;
    questions += isWriting(s) ? 0 : BK2_QUESTIONS_PER_GROUP[s];
  };
  for (const s of order) if (canAdd(s)) add(s);
  // 第一輪放不進任何一組的大題之後也放不進（時間、組數、題數只會增加，供應不變）：拿掉，不再讓它壓低其他大題的六成上限與占比。
  const placeable = order.filter((s) => (counts.get(s) ?? 0) > 0);
  if (placeable.length < order.length) {
    order = placeable;
    single = placeable.length === 1;
    total = placeable.reduce((sum, s) => sum + (weights.get(s) ?? 0), 0);
  }
  for (;;) {
    const deficit = (s: BankSectionType) => (weights.get(s) ?? 0) / total - ((counts.get(s) ?? 0) * GROUP_MINUTES[s]) / Math.max(time, 1e-9);
    const next = [...order].sort((a, b) => deficit(b) - deficit(a) || order.indexOf(a) - order.indexOf(b)).find(canAdd);
    if (!next) break;
    add(next);
  }
  return counts;
}

/**
 * 弱點加強卷的大題權重（§6.3 第 2 步）：均衡加強卷是每個選擇題大題；學生自己勾大題時是勾的大題（沒有弱點的至少 0.05）；
 * 依弱點自動選時是 sectionWeights。作文：作文是前兩名弱點、或學生自己勾了作文，而且長度 ≥ 40 分鐘才放；中譯英：有弱點或學生自己勾（§4.1）。
 */
export function weakSectionWeights(request: Pick<PaperRequest, 'sections' | 'minutes' | 'balanced'>, targets: readonly AssembleTarget[]): Map<BankSectionType, number> {
  if (request.balanced === true) return new Map(BALANCED_SECTIONS.map((s, i) => [s, 1 - i * 1e-6] as const));
  const minutes = request.minutes ?? LONG_PAPER;
  const manual = request.sections.length > 0;
  const fromTargets = sectionWeights(targets);
  const weights = manual ? new Map(request.sections.map((s) => [s, Math.max(fromTargets.get(s) ?? 0, MIN_SECTION_WEIGHT)] as const)) : fromTargets;
  const topTwo = new Set(targets.slice(0, 2).map((t) => t.section));
  if (weights.has('composition') && (minutes < LONG_PAPER || (!manual && !topTwo.has('composition')))) weights.delete('composition');
  return weights;
}

/**
 * 組卷前估計的組成與分鐘數（組卷頁的預覽與按鈕）：同 assembleWeakness 的大題權重、保持手感的預留與時間分配，題組供應當作充足
 * （實際組卷時題庫不夠會更短）。放不下任何一組時 minutes 是 0。
 */
export function estimateWeakPaper(
  request: Pick<PaperRequest, 'sections' | 'minutes' | 'balanced'>,
  targets: readonly AssembleTarget[],
  maintenance: BankSectionType | null,
): { sections: BankSectionType[]; minutes: number } {
  const minutes = request.minutes ?? LONG_PAPER;
  const weights = weakSectionWeights(request, targets);
  const supply = new Map([...weights.keys()].map((s) => [s, BK2_MAX_GROUPS] as const));
  const auto = request.sections.length === 0 && request.balanced !== true;
  const reserve = auto && minutes >= LONG_PAPER && maintenance !== null && !weights.has(maintenance) ? maintenance : null;
  const counts = allocateGroups(
    weights,
    minutes - (reserve ? GROUP_MINUTES[reserve] : 0),
    supply,
    reserve ? { groups: 1, questions: isWriting(reserve) ? 0 : BK2_QUESTIONS_PER_GROUP[reserve] } : undefined,
    sectionTieOrder(targets),
  );
  const list = [...counts].flatMap(([s, n]) => Array.from({ length: n }, () => s));
  if (list.length === 0) return { sections: [], minutes: 0 };
  if (reserve) list.push(reserve);
  return { sections: BK2_SECTION_ORDER.filter((s) => list.includes(s)), minutes: paperMinutes(list) };
}

interface WeakContext {
  input: AssembleInput;
  usable: ReadonlySet<string>;
  baseTier: Tier;
  targets: readonly AssembleTarget[];
  rng: Rng;
}

/** 某個難度、某個大題的候選（依 uid 排序）。 */
function poolCandidates(ctx: WeakContext, tier: Tier, section: BankSectionType): AnyEntry[] {
  return (ctx.input.pool.tiers[tier][section] as readonly AnyEntry[]).filter((e) => isSelectableBk2(e, ctx.usable)).sort(byUid);
}

/** 相鄰一級（基準難度是進階練習時兩邊都算，取 supply 多的；同數取較低的一級）。 */
function adjacentTiers(tier: Tier): Tier[] {
  const i = TIERS.indexOf(tier);
  return [TIERS[i - 1], TIERS[i + 1]].filter((t): t is Tier => t !== undefined);
}

function assembleWeakness(input: AssembleInput, usable: ReadonlySet<string>): AssembleResult {
  const { request, skills, used, avoid } = input;
  const balanced = request.balanced === true;
  const targets = balanced ? [] : [...(input.profile?.targets ?? [])];
  if (!balanced && targets.length === 0) return { ok: false, reason: 'no_weakness' };
  const baseTier = request.tiers[0] ?? 'basic';
  const minutes = request.minutes ?? LONG_PAPER;
  const ctx: WeakContext = { input, usable, baseTier, targets, rng: rngFromSeed(input.seed) };
  const manual = request.sections.length > 0;

  // ── 大題權重 ──
  const weights = weakSectionWeights(request, targets);
  if (manual && weights.size === 0 && request.sections.includes('composition')) return { ok: false, reason: 'composition_too_short' };

  // ── 相鄰難度（§4.1、§6.2）：弱點在基準難度沒有可用題組（沒做過、命中 ≥ 1 題的題組少於 2 組）時，只為那個弱點用相鄰一級 ──
  const adjacent = new Map<string, Tier>();
  for (const t of targets) {
    if (t.kind !== 'skill' && t.kind !== 'error') continue;
    const only = new Set([t.key]);
    const supplyIn = (tier: Tier) => poolCandidates(ctx, tier, t.section).filter((e) => !used.has(e.uid) && (groupHits(skills, e, t.section, targets, only)[t.key] ?? 0) >= 1).length;
    if (supplyIn(baseTier) >= ADJACENT_MIN_SUPPLY) continue;
    const best = adjacentTiers(baseTier)
      .map((tier) => ({ tier, n: supplyIn(tier) }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))[0];
    if (best) adjacent.set(t.key, best.tier);
  }

  // ── 每個大題的候選（基準難度＋相鄰難度只限命中那個弱點的題組）──
  const candidatesOf = new Map<BankSectionType, Candidate[]>();
  for (const section of BK2_SECTION_ORDER) {
    if (!weights.has(section) && input.profile?.maintenance?.section !== section) continue;
    const list: Candidate[] = poolCandidates(ctx, baseTier, section).map((entry) => ({ entry, section, tier: baseTier, rank: 0 }));
    for (const [key, tier] of adjacent) {
      const t = targets.find((x) => x.key === key);
      if (!t || t.section !== section) continue;
      const only = new Set([key]);
      for (const entry of poolCandidates(ctx, tier, section)) {
        if ((groupHits(skills, entry, section, targets, only)[key] ?? 0) >= 1 && !list.some((c) => c.entry.uid === entry.uid)) list.push({ entry, section, tier, rank: 0 });
      }
    }
    const sorted = list.sort((a, b) => byUid(a.entry, b.entry) || TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
    candidatesOf.set(section, shuffled(sorted, ctx.rng).map((c, i) => ({ ...c, rank: i })));
  }

  // 有目標，但所有目標的大題在可用的難度與來源都沒有候選。
  if (!balanced && [...weights.keys()].every((s) => (candidatesOf.get(s)?.length ?? 0) === 0)) {
    return manual ? { ok: false, reason: 'insufficient', section: request.sections[0] ?? 'reading', tier: baseTier } : { ok: false, reason: 'no_targets' };
  }

  // ── 保持手感（§5.6）：長度 ≥ 40 分鐘、依弱點自動選大題時，放一組基準難度、沒做過、不在盡量避開的題組 ──
  const maintenanceSection = !balanced && !manual && minutes >= LONG_PAPER ? (input.profile?.maintenance?.section ?? null) : null;
  const maintenancePool =
    maintenanceSection && !weights.has(maintenanceSection)
      ? (candidatesOf.get(maintenanceSection) ?? []).filter((c) => c.tier === baseTier && !used.has(c.entry.uid) && !avoid.has(c.entry.uid))
      : [];
  const reserveMaintenance = maintenanceSection !== null && maintenancePool.length > 0;
  const budget = minutes - (reserveMaintenance && maintenanceSection ? GROUP_MINUTES[maintenanceSection] : 0);

  // ── 分配組數 ──
  const supply = new Map([...weights.keys()].map((s) => [s, candidatesOf.get(s)?.length ?? 0] as const));
  const reserved = reserveMaintenance && maintenanceSection ? { groups: 1, questions: isWriting(maintenanceSection) ? 0 : BK2_QUESTIONS_PER_GROUP[maintenanceSection] } : undefined;
  const tieOrder = sectionTieOrder(targets);
  const counts = allocateGroups(weights, budget, supply, reserved, tieOrder);
  if ([...counts.values()].every((n) => n === 0)) {
    const section = [...weights.keys()].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0))[0] ?? 'reading';
    return { ok: false, reason: 'insufficient', section, tier: baseTier };
  }

  // ── 大題內挑題 ──
  const picked: { pick: SlotPick2; order: number; note: SlotNote; theme: string[] }[] = [];
  const taken = new Set<string>();
  const covered = new Map<string, number>(); // Cₜ：卷子裡已經放進去、命中 t 的題數
  let relaxedTheme = false;
  let order = 0;
  const themes = () => picked.map((p) => p.theme);
  const place = (c: Candidate, flags: SlotFlag[], hits: Record<string, number>) => {
    taken.add(c.entry.uid);
    for (const [k, n] of Object.entries(hits)) covered.set(k, (covered.get(k) ?? 0) + n);
    if (c.section !== 'vocabulary' && themeConflicts(c.entry.theme, themes()) > 0) relaxedTheme = true;
    if (c.tier !== baseTier) flags.push('adjacent_tier');
    if (!balanced && !hasTags(skills, c.entry, c.section)) flags.push('no_tags');
    if (balanced) flags.push('balanced');
    picked.push({ pick: pickOf(c), order: (order += 1), note: { hits, flags }, theme: c.section === 'vocabulary' ? [] : c.entry.theme });
  };

  // 報告推薦（§6.3 第 5 步）：在對應大題先放，最多 2 組，要沒做過、符合基準難度與大題、那個大題有分到組數。
  const pinned = new Map<BankSectionType, number>();
  for (const uid of (request.pins ?? []).slice(0, MAX_PINS)) {
    for (const [section, list] of candidatesOf) {
      const c = list.find((x) => x.entry.uid === uid && x.tier === baseTier);
      if (!c || used.has(uid) || taken.has(uid) || (counts.get(section) ?? 0) <= (pinned.get(section) ?? 0)) continue;
      place(c, ['pinned'], hitsFor(ctx, c, adjacent));
      pinned.set(section, (pinned.get(section) ?? 0) + 1);
    }
  }

  const sections = [...counts.keys()].sort((a, b) => (weights.get(b) ?? 0) - (weights.get(a) ?? 0) || tieOrder.indexOf(a) - tieOrder.indexOf(b));
  for (const section of sections) {
    const need = (counts.get(section) ?? 0) - (pinned.get(section) ?? 0);
    const sectionWeight = targets.find((t) => t.kind === 'section' && t.section === section)?.weight ?? 0;
    for (let n = 0; n < need; n += 1) {
      const choice = chooseWeak(ctx, section, candidatesOf.get(section) ?? [], taken, covered, themes(), sectionWeight, adjacent);
      if (!choice) return { ok: false, reason: 'insufficient', section, tier: baseTier };
      place(choice.candidate, choice.flags, choice.hits);
    }
  }

  // 保持手感：種子洗牌的第一個主題不撞的（撞了才放寬）。
  if (reserveMaintenance && maintenanceSection) {
    const free = maintenancePool.filter((c) => !taken.has(c.entry.uid));
    const c = free.find((x) => maintenanceSection === 'vocabulary' || themeConflicts(x.entry.theme, themes()) === 0) ?? free[0];
    if (c) place(c, ['maintenance'], {});
  }

  const sorted = sortPicks(picked);
  return {
    ok: true,
    kind: 'w',
    slots: sorted.map((p) => p.pick),
    notes: sorted.map((p) => p.note),
    minutes: paperMinutes(sorted.map((p) => p.pick.section)),
    relaxed: relaxedTheme ? ['theme'] : [],
  };
}

/** 一組的命中：基準難度的題組算這個大題的全部目標；相鄰難度的題組只算為它開放相鄰難度的那些目標。 */
function hitsFor(ctx: WeakContext, c: Candidate, adjacent: ReadonlyMap<string, Tier>): Record<string, number> {
  if (c.tier === ctx.baseTier) return groupHits(ctx.input.skills, c.entry, c.section, ctx.targets);
  const allowed = new Set([...adjacent].filter(([, tier]) => tier === c.tier).map(([key]) => key));
  return groupHits(ctx.input.skills, c.entry, c.section, ctx.targets, allowed);
}

/**
 * 大題內挑一組（§6.3 第 4 步）：收益(g) ＝ Σ Wₜ × min(hₜ, 3) ／ (1 ＋ Cₜ／2) ＋ 0.1 × W_大題（相鄰難度的題組沒有大題那一項）。
 * 候選分五層，依序找收益最大的：(1) 沒做過、不在盡量避開、收益 > 0；(2) retest 時 7 天以上前做過而且當時答錯過這個大題弱點的
 * （收益 ＋0.1 × 當時答錯的弱點題數）；(3) 沒做過、在盡量避開、收益 > 0；(4) 沒做過、收益 0；(5) 做過的（最早做的先用）。
 * 主題鍵不交集是硬性條件：沒做過的那幾層（1–4）都挑不到時才放寬主題，再挑不到才用做過的（同 bk1 的放寬順序）。
 * 同分時主題不撞的先、再依種子洗牌的順序。
 */
function chooseWeak(
  ctx: WeakContext,
  section: BankSectionType,
  candidates: readonly Candidate[],
  taken: ReadonlySet<string>,
  covered: ReadonlyMap<string, number>,
  themes: readonly (readonly string[])[],
  sectionWeight: number,
  adjacent: ReadonlyMap<string, Tier>,
): { candidate: Candidate; flags: SlotFlag[]; hits: Record<string, number> } | null {
  const { used, avoid, wrong, now, request } = ctx.input;
  const weightOf = new Map(ctx.targets.map((t) => [t.key, t.weight]));
  const sectionKeys = new Set(ctx.targets.filter((t) => t.section === section).flatMap((t) => (t.kind === 'trap' ? (t.code ? [t.code] : []) : [...t.codes])));
  const scored = candidates
    .filter((c) => !taken.has(c.entry.uid))
    .map((c) => {
      const hits = hitsFor(ctx, c, adjacent);
      let gain = Object.entries(hits).reduce((sum, [k, h]) => sum + ((weightOf.get(k) ?? 0) * Math.min(h, HIT_CAP)) / (1 + (covered.get(k) ?? 0) / 2), 0);
      if (c.tier === ctx.baseTier) gain += SECTION_GAIN * sectionWeight;
      const usedAt = used.get(c.entry.uid);
      const isUsed = usedAt !== undefined;
      let layer: number;
      const flags: SlotFlag[] = [];
      const w = wrong.get(c.entry.uid);
      const retestable = request.reuse === 'retest' && isUsed && (usedAt ?? 0) <= now - RETEST_DAYS * DAY_MS && w !== undefined;
      const wrongWeak = retestable ? (w?.questions.filter((codes) => codes.some((code) => sectionKeys.has(code))).length ?? 0) : 0;
      if (!isUsed && !avoid.has(c.entry.uid) && gain > 0) layer = 1;
      else if (retestable && wrongWeak > 0) {
        layer = 2;
        gain += SECTION_GAIN * wrongWeak;
        flags.push('retest');
      } else if (!isUsed && avoid.has(c.entry.uid) && gain > 0) {
        layer = 3;
        flags.push('avoided_reuse');
      } else if (!isUsed) {
        // 收益 0 的沒做過的題組：不在盡量避開的先。
        layer = avoid.has(c.entry.uid) ? 4.5 : 4;
        if (avoid.has(c.entry.uid)) flags.push('avoided_reuse');
      } else {
        layer = 5;
        flags.push('reused');
      }
      const conflicts = section === 'vocabulary' ? 0 : themeConflicts(c.entry.theme, themes);
      return { c, hits, gain, layer, flags, conflicts, usedAt: usedAt ?? 0 };
    });
  const best = (list: typeof scored) =>
    [...list].sort((a, b) => a.layer - b.layer || (a.layer === 5 ? a.usedAt - b.usedAt : 0) || b.gain - a.gain || a.conflicts - b.conflicts || a.c.rank - b.c.rank)[0];
  const fresh = scored.filter((x) => x.layer < 5);
  const old = scored.filter((x) => x.layer === 5);
  const pick = best(fresh.filter((x) => x.conflicts === 0)) ?? best(fresh) ?? best(old.filter((x) => x.conflicts === 0)) ?? best(old);
  return pick ? { candidate: pick.c, flags: pick.flags, hits: pick.hits } : null;
}

// ---------------------------------------------------------------------------
// 代號
// ---------------------------------------------------------------------------

/** 組卷結果 → 代號的題組（encodeBk2 的輸入）。 */
export function bk2SlotsOf(slots: readonly SlotPick2[]): Bk2Slot[] {
  return slots.map((s) => ({ ns: s.ns, section: s.section, tier: s.tier, uid: s.uid, v: s.v }));
}

/** 題型代碼（uid 的第二段）和大題是否一致（防呆：組卷池的條目放錯大題）。 */
export function uidMatchesSection(uid: string, section: BankSectionType): boolean {
  return uid.split('.')[1] === BANK_UID_CODES[section];
}
