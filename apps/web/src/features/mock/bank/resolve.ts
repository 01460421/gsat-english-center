/**
 * 自組卷的載入與組卷（docs/design/bank-mock.md §4.7 第 (3)–(6) 部分、§2.1、§2.6）。
 *
 *   hasLocalUse(paperId)            這台裝置有沒有這份卷子的使用紀錄：作答中、作答歷史，或清單裡有開考、下載 PDF、紙本做過
 *   loadBankPaperStrict(paperId)    有使用紀錄的卷子：只接受快照、完全相同的版本，或答案完全相同（same-key）的新版本；
 *                                   拿不到就明說（{ ok: false, reason: 'changed' }），不換題、不改代號、不重新計分
 *   resolveBankPaper(paperId, …)    沒有使用紀錄的卷子（分享的連結、換了裝置、第一次掃 QR code）：已更新的題組換成新版本、
 *                                   已下架的換成同難度的另一組並改代號；換題只由舊代號與目前的題庫決定
 *   assembleNewPaper(tier)          按下「組一份新卷」：組卷、下載 13 個檔案、存快照、加進「我組過的卷子」
 *
 * 為什麼要分開兩支載入函式：只有一支會換題的載入函式時，沒有快照的作答中卷子會被換題並導向新代號，舊的作答紀錄變成孤兒；
 * 成績單每次打開都重算，換過題就會拿新題目對舊答案重新計分。嚴格載入保證：有紀錄的卷子，要不是同一份題目
 * （或答案完全相同的新版本），就是明說拿不到。
 *
 * 同一個代號在同一個頁面只解析一次（memoizeAsync，同 data/client.ts），use() 拿到的 Promise 是穩定的；
 * 網路錯誤等失敗要等「再試一次」（forgetFailedLoads）才重來。
 * 題組檔回 404（網站剛更新，開著的分頁還拿著舊的組卷池）時，清掉組卷池快取、重抓一次再來一次；還是 404 就丟出
 * DataLoadError 的 not_found（文案是「網站剛更新，請重新整理」），不說是網路問題。
 *
 * 加強卷（bk2，docs/design/weak-paper.md §7.6）走同樣的兩支載入函式，依代號格式分派：
 *   - 每一組用代號裡自己的大題與難度找組卷池（status.ts 的 layoutStatuses）；出版社來源停用或授權到期的題組當成下架（fail closed）。
 *   - 換題：同大題、同難度、優先同命名空間的中性選題（used 空、種子是舊代號的 FNV-1a、避開卷內其他題組與主題；
 *     候選判斷用 isSelectableBk2，來源取原本那一組的來源與本站題庫）。替代題組一定和原題組同形狀，版面只由代號決定，
 *     換題後卷面題號不變。答案改了而版本超過 31、或新版本的形狀不同（ex: 'shape'）時當成下架。
 *   - 清單與快照用加強卷自己的（weakPapers.ts、gsat-weakpaper）。
 */
import { AI_BANK_SOURCE_ID, namespaceOf, type BankSectionType, type Tier } from '@gsat/shared';
import { loadPracticeGroup } from '../../../data/bank';
import { DataLoadError, forgetFailedLoads, memoizeAsync } from '../../../data/client';
import { loadBankAnswers, loadBankPrompt } from '../../writing/bank/data';
import { loadActiveId, loadHistory } from '../storage';
import { assembleSelection, type Relaxation, type SlotPick } from './assemble';
import { BLUEPRINT_SLOTS, slotRange } from './blueprint';
import { buildBankPaper, type BankPaper, type BankPaperNotices, type SlotFile } from './buildExam';
import { MAX_SLOT_VERSION, decodePaperId, encodePaperId, type DecodedPaperId, type PaperSlot } from './code';
import { BK2_MAX_VERSION, decodeAnyPaperId, encodeBk2, normalizeAnyPaperId, type Bk2Slot, type DecodedBk2 } from './code2';
import { layoutForBk2, type PaperLayout } from './layout';
import { addMyPaper, findMyPaper, hasPaperUse, prunePapers, recordPrinted, replaceMyPaperId, type PrintedInfo } from './myPapers';
import { findPoolEntry, isSelectableBk2, loadMockPool, reloadMockPool, type MockPool, type MockPoolEntry, type MockPoolReadingEntry } from './pool';
import { fnv1a, randomSeed, rngFromSeed, shuffled } from './random';
import { getSnapshotStore, getWeakSnapshotStore, paperFromSnapshot, snapshotOf, type BankSnapshot, type SnapshotStore } from './snapshots';
import { maskEndedSourceFiles } from './sourceMask';
import { loadSourceRegistry, sourceActiveFn } from './sources';
import { isStrictlyUsable, layoutStatuses, paperStatuses, type SlotStatus } from './status';
import { loadUsedGroups } from './used';
import { weakPaperList } from './weakPapers';

export type StrictLoadResult =
  | { ok: true; paper: BankPaper; source: 'snapshot' | 'network' }
  /** invalid＝代號格式不對；changed＝題目已經更新或下架，無法接著作答／檢討。 */
  | { ok: false; reason: 'invalid' | 'changed' };

export type ResolveResult =
  | {
      ok: true;
      paper: BankPaper;
      source: 'snapshot' | 'network';
      /** 解析途中發現另一個分頁已經開考，改走了嚴格載入。 */
      strict: boolean;
      /** 換過題或改版、代號改變時是舊代號（畫面 navigate(replace) 到 paper.id，並帶著 paper.notices）。 */
      redirectedFrom: string | null;
      /** 從 PDF 進來、題組和紙本不同時記下的資訊（也寫進「我組過的卷子」）。 */
      printed: PrintedInfo | null;
    }
  /** invalid＝代號格式不對；changed＝（改走嚴格載入時）題目已經更新；removed＝題組已下架，同難度湊不出替代。 */
  | { ok: false; reason: 'invalid' | 'changed' | 'removed' };

export type AssembleNewResult =
  | { ok: true; paper: BankPaper; relaxed: Relaxation[] }
  | { ok: false; reason: 'insufficient'; section: BankSectionType };

/** 這台裝置有沒有這份卷子的使用紀錄（§4.7 第 (3) 部分的表）。加強卷查「我的加強卷」清單。 */
export function hasLocalUse(paperId: string): boolean {
  const normalized = normalizeAnyPaperId(paperId);
  const id = normalized?.id ?? paperId;
  if (loadActiveId(id) !== null) return true;
  if (loadHistory().some((h) => h.paperId === id)) return true;
  const entry = normalized?.format === 'bk2' ? weakPaperList.find(id) : findMyPaper(id);
  return entry !== null && hasPaperUse(entry);
}

// ---------------------------------------------------------------------------
// 共用
// ---------------------------------------------------------------------------

function isNotFound(error: unknown): boolean {
  return error instanceof DataLoadError && error.kind === 'not_found';
}

/** 下載一個位置的題組檔：題庫練習的題組檔，或寫作題的題目檔＋答案檔（答案和題目一起下載，§5.1）。 */
async function loadSlotFile(section: BankSectionType, uid: string, v: number): Promise<SlotFile> {
  if (section === 'translation' || section === 'composition') {
    const [prompt, answers] = await Promise.all([loadBankPrompt(uid, v), loadBankAnswers(uid, v)]);
    return { prompt, answers };
  }
  return loadPracticeGroup(uid, v);
}

export async function loadFiles(slots: readonly { section: BankSectionType; uid: string; v: number }[]): Promise<Record<string, SlotFile>> {
  const loaded = await Promise.all(slots.map(async (s) => [`${s.uid}@${s.v}`, await loadSlotFile(s.section, s.uid, s.v)] as const));
  return Object.fromEntries(loaded);
}

/** 用組卷池做一件事；題組檔 404 時清掉組卷池快取、重抓一次再做一次（最多一次，§4.7 第 (6) 部分）。加強卷的組卷也用它。 */
export async function withPoolRetry<T>(run: (pool: MockPool) => Promise<T>, first?: MockPool): Promise<T> {
  const pool = first ?? (await loadMockPool());
  try {
    return await run(pool);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // 失敗的題組檔請求也留在快取裡（client.ts），重試前一起清掉。
    forgetFailedLoads();
    return run(await reloadMockPool());
  }
}

async function readSnapshot(store: SnapshotStore, paperId: string): Promise<BankSnapshot | null> {
  try {
    return await store.get(paperId);
  } catch {
    return null;
  }
}

export async function writeSnapshot(store: SnapshotStore, paper: BankPaper, now = new Date()): Promise<boolean> {
  try {
    return await store.put(snapshotOf(paper, now));
  } catch {
    return false;
  }
}

/** 用到這台裝置「開考前」做過的題組的位置（題號範圍）。開考前＝清單記的組卷時間，沒有就是現在。 */
function reusedRanges(paperId: string, slots: readonly PaperSlot[]): string[] {
  const entry = findMyPaper(paperId);
  const before = entry ? Date.parse(entry.createdAt) : Date.now();
  const used = loadUsedGroups({ excludePaperId: paperId, before });
  return slots.flatMap((s, i) => (used.has(s.uid) ? [slotRange(i)] : []));
}

function sectionOf(index: number): BankSectionType {
  return BLUEPRINT_SLOTS[index]?.section ?? 'vocabulary';
}

function swapOf(entry: MockPoolEntry): [number, number][] {
  const sw = (entry as Partial<MockPoolReadingEntry>).sw;
  return sw ? sw.map(([q, r]) => [q, r] as [number, number]) : [];
}

/**
 * 池子裡較新的版本組不成卷子：有指向題組外的空格記號（ex: 'marker'，重新編號會丟出 RenumberError），
 * 或答案改了而版本超過代號上限（編不進新代號）。這種新版本和下架一樣處理：嚴格載入失敗、解析時換題。
 * 帶其他排除原因（例如題本缺字）的新版本照樣能組成卷子，照常使用。
 */
function isUnusableUpdate(s: SlotStatus): boolean {
  if (s.kind === 'same-key') return s.entry.ex === 'marker';
  if (s.kind === 'key-changed') return s.entry.ex === 'marker' || s.entry.v > MAX_SLOT_VERSION;
  return false;
}

// ---------------------------------------------------------------------------
// 嚴格載入
// ---------------------------------------------------------------------------

async function strictImpl(raw: string): Promise<StrictLoadResult> {
  const any = decodeAnyPaperId(raw);
  if (any?.format === 'bk2') return strictBk2(any);
  const decoded = decodePaperId(raw);
  if (!decoded) return { ok: false, reason: 'invalid' };
  const store = getSnapshotStore();
  const reused = reusedRanges(decoded.id, decoded.slots);
  const snapshot = await readSnapshot(store, decoded.id);
  if (snapshot) return { ok: true, paper: paperFromSnapshot(snapshot, { reused }), source: 'snapshot' };

  return withPoolRetry(async (pool) => {
    const statuses = paperStatuses(pool, decoded);
    const usable: (SlotStatus & { entry: MockPoolEntry })[] = [];
    for (const s of statuses) {
      if (!isStrictlyUsable(s) || s.kind === 'removed' || isUnusableUpdate(s)) return { ok: false, reason: 'changed' } as const;
      usable.push(s);
    }
    // current 用原版本，same-key 用新版本（答案、題數、題序都相同，代號不變）。
    const picks = usable.map((s, i) => ({ section: sectionOf(i), uid: s.entry.uid, v: s.entry.v, sw: swapOf(s.entry) }));
    const files = await loadFiles(picks);
    const paper = buildBankPaper({
      paperId: decoded.id,
      tier: decoded.tier,
      dataVersion: pool.version,
      slots: picks.map((p) => ({ key: `${p.uid}@${p.v}`, swap: p.sw })),
      files,
      notices: { reused, textChanged: statuses.flatMap((s, i) => (s.kind === 'same-key' ? [slotRange(i)] : [])) },
    });
    // 有使用紀錄卻沒有快照（寫入失敗或被清除）：補寫一份，之後題庫再更新也拿得到同一份。
    await writeSnapshot(store, paper);
    return { ok: true, paper, source: 'network' } as const;
  });
}

const strictLoader = memoizeAsync(strictImpl);

/** 嚴格載入（有使用紀錄的卷子用）。代號可以是任何寫法（大小寫、.p）。 */
export function loadBankPaperStrict(paperId: string): Promise<StrictLoadResult> {
  return strictLoader(normalizeAnyPaperId(paperId)?.id ?? paperId);
}

// ---------------------------------------------------------------------------
// 解析（沒有使用紀錄的卷子）
// ---------------------------------------------------------------------------

async function viaStrict(paperId: string): Promise<ResolveResult> {
  const r = await loadBankPaperStrict(paperId);
  return r.ok ? { ok: true, paper: r.paper, source: r.source, strict: true, redirectedFrom: null, printed: null } : r;
}

/** 依目前的組卷池解析：current 照舊、same-key 用新版本（代號不變）、key-changed 換新版本並改代號、removed 換題並改代號。 */
async function resolveFromPool(decoded: DecodedPaperId, fromPdf: boolean, pool: MockPool, store: SnapshotStore, hadSnapshot: boolean): Promise<ResolveResult> {
  const { id, tier } = decoded;
  // 組不成卷子的新版本（指向題組外的空格記號、版本超過代號上限）和下架一樣換題（建置端已標排除原因）。
  const statuses = paperStatuses(pool, decoded).map((s): SlotStatus => (isUnusableUpdate(s) ? { kind: 'removed' } : s));
  const removed = statuses.flatMap((s, i) => (s.kind === 'removed' ? [i] : []));

  const replacements = new Map<number, SlotPick>();
  if (removed.length > 0) {
    // 換題只由舊代號與目前的題庫決定：used 是空的、種子是舊代號的雜湊、只避開卷內其他位置的題組與主題（§4.7 第 (4) 部分）。
    const fixed = statuses.map((s) => (s.kind === 'removed' ? null : s.entry));
    const selection = assembleSelection(pool.tiers[tier], fnv1a(id), new Map(), { fixed });
    if (!selection.ok) return { ok: false, reason: 'removed' };
    for (const i of removed) {
      const pick = selection.slots[i];
      if (pick) replacements.set(i, pick);
    }
  }

  const picks: SlotPick[] = statuses.map((s, i) => {
    if (s.kind === 'removed') {
      const r = replacements.get(i);
      if (!r) throw new Error(`第 ${i + 1} 個位置沒有替代題組`);
      return r;
    }
    return { section: sectionOf(i), uid: s.entry.uid, v: s.entry.v, sw: swapOf(s.entry) };
  });
  // 代號：current、same-key 不變；key-changed 換成新版本；removed 換成替代題組。
  const codeSlots: PaperSlot[] = decoded.slots.map((slot, i) => {
    const s = statuses[i];
    const p = picks[i];
    if (!s || !p || s.kind === 'current' || s.kind === 'same-key') return slot;
    return { uid: p.uid, v: p.v };
  });
  const newId = encodePaperId(tier, codeSlots);
  const changed = newId !== id;

  const files = await loadFiles(picks);

  // 決定改代號之前，同一個 tick 內重新確認仍然沒有使用紀錄：另一個分頁已經開考的話改走嚴格載入，不改代號。
  if (changed && hasLocalUse(id)) return viaStrict(id);

  const keyChanged = statuses.flatMap((s, i) => (s.kind === 'key-changed' ? s.changed.map((q) => BLUEPRINT_SLOTS[i]?.questions[q - 1]?.label ?? String(q)) : []));
  const notices: Partial<BankPaperNotices> = {
    reused: reusedRanges(newId, codeSlots),
    replaced: statuses.flatMap((s, i): BankPaperNotices['replaced'] =>
      s.kind === 'removed' ? [{ range: slotRange(i), kind: 'removed' }] : s.kind === 'key-changed' ? [{ range: slotRange(i), kind: 'updated' }] : [],
    ),
    textChanged: statuses.flatMap((s, i) => (s.kind === 'same-key' ? [slotRange(i)] : [])),
    keyChanged,
  };
  const paper = buildBankPaper({
    paperId: newId,
    tier,
    dataVersion: pool.version,
    slots: picks.map((p) => ({ key: `${p.uid}@${p.v}`, swap: p.sw })),
    files,
    notices,
  });

  let printed: PrintedInfo | null = null;
  if (changed) {
    // 清單裡沒有使用紀錄的舊代號換成新代號（先換，從 PDF 來的紀錄才會記在換過的那一筆上）；舊快照不再需要。
    if (replaceMyPaperId(id, newId) || hadSnapshot) {
      try {
        await store.delete(id);
      } catch {
        // 留下的孤兒快照之後由 cleanupOrphanSnapshots 清掉。
      }
    }
    if (fromPdf) {
      printed = { from: id, excluded: removed.map(slotRange), keyChanged };
      recordPrinted(newId, printed, pool.version);
    }
  }
  // 清單裡有這份（這台裝置組的、或從 PDF 記下的）就補寫快照。
  if (findMyPaper(newId) && !(await readSnapshot(store, newId))) await writeSnapshot(store, paper);
  return { ok: true, paper, source: 'network', strict: false, redirectedFrom: changed ? id : null, printed };
}

async function resolveImpl(key: string): Promise<ResolveResult> {
  const fromPdfFlag = key.startsWith('p:');
  const any = decodeAnyPaperId(key.slice(2));
  if (any?.format === 'bk2') return resolveBk2(any, fromPdfFlag || any.fromPdf);
  const decoded = decodePaperId(key.slice(2));
  if (!decoded) return { ok: false, reason: 'invalid' };
  const { id } = decoded;
  const fromPdf = fromPdfFlag || decoded.fromPdf;
  if (hasLocalUse(id)) return viaStrict(id);

  const store = getSnapshotStore();
  const snapshot = await readSnapshot(store, id);
  let pool: MockPool;
  try {
    pool = await loadMockPool();
  } catch (error) {
    // 組卷池抓不到（離線、部署中）：有快照就直接用快照開（§2.8）。
    if (snapshot) return { ok: true, paper: paperFromSnapshot(snapshot, { reused: reusedRanges(id, decoded.slots) }), source: 'snapshot', strict: false, redirectedFrom: null, printed: null };
    throw error;
  }
  // 只組了卷、還沒開考也沒下載的卷子：快照的版本都是 current 或 same-key 就用快照；不然照目前的題庫重新解析
  // （學生還沒看到題目，換成新版本比較好）。
  if (snapshot && paperStatuses(pool, decoded).every(isStrictlyUsable)) {
    return { ok: true, paper: paperFromSnapshot(snapshot, { reused: reusedRanges(id, decoded.slots) }), source: 'snapshot', strict: false, redirectedFrom: null, printed: null };
  }
  return withPoolRetry((p) => resolveFromPool(decoded, fromPdf, p, store, snapshot !== null), pool);
}

const resolveLoader = memoizeAsync(resolveImpl);

/** 解析一份沒有使用紀錄的卷子（有使用紀錄時自動改走嚴格載入）。代號可以是任何寫法；網址結尾的 .p 也算「從 PDF 來」。 */
export function resolveBankPaper(paperId: string, options: { fromPdf?: boolean } = {}): Promise<ResolveResult> {
  const normalized = normalizeAnyPaperId(paperId);
  const fromPdf = Boolean(options.fromPdf) || Boolean(normalized?.fromPdf);
  return resolveLoader(`${fromPdf ? 'p' : 'n'}:${normalized?.id ?? paperId}`);
}

// ---------------------------------------------------------------------------
// 組一份新卷
// ---------------------------------------------------------------------------

/**
 * 按下「組一份新卷」（§2.1）：組卷 → 下載 13 個檔案 → 組成卷子 → 存快照、加進「我組過的卷子」。
 * 題庫連一份都湊不出來時回傳 insufficient（那個難度標「出題中」）。網路錯誤照樣丟出 DataLoadError。
 * seed 不給就用 crypto 取一個（預覽模式的 ?bankmockseed= 由畫面傳進來）。
 * 每次按下都重新下載之前失敗的檔案（§2.1：進到 /mock 時組卷池下載失敗，按鈕照常可以按，按下時重新下載）。
 */
export async function assembleNewPaper(tier: Tier, options: { seed?: number; now?: Date } = {}): Promise<AssembleNewResult> {
  // 使用者按下按鈕才會呼叫（不在繪製途中），清掉失敗的快取不會造成 Suspense 重複請求（data/client.ts 檔頭）。
  forgetFailedLoads();
  const seed = options.seed ?? randomSeed();
  const now = options.now ?? new Date();
  const used = loadUsedGroups();
  const result = await withPoolRetry(async (pool): Promise<AssembleNewResult> => {
    const selection = assembleSelection(pool.tiers[tier], seed, used);
    if (!selection.ok) return selection;
    const files = await loadFiles(selection.slots);
    const paperId = encodePaperId(tier, selection.slots);
    const paper = buildBankPaper({
      paperId,
      tier,
      dataVersion: pool.version,
      slots: selection.slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: s.sw })),
      files,
      notices: { reused: selection.reused.map(slotRange) },
    });
    return { ok: true, paper, relaxed: selection.relaxed };
  });
  if (!result.ok) return result;
  const { paper } = result;
  await writeSnapshot(getSnapshotStore(), paper, now);
  // 極少數情況會組出清單裡已經有的同一份（例如題庫剛好只夠一份）：保留原本的使用紀錄，只移到最前面。
  addMyPaper(findMyPaper(paper.id) ?? { id: paper.id, tier, createdAt: now.toISOString(), poolVersion: paper.dataVersion });
  await prunePapers().catch(() => []);
  return result;
}

// ---------------------------------------------------------------------------
// 加強卷（bk2）
// ---------------------------------------------------------------------------

export function rangeOf(slot: { first: string; last: string }): string {
  return slot.first === slot.last ? slot.first : `${slot.first}-${slot.last}`;
}

/** 用到這台裝置「開考前」做過的題組的位置（題號範圍；同 reusedRanges，清單是「我的加強卷」）。 */
function reusedRangesBk2(paperId: string, layout: PaperLayout, uids: readonly string[]): string[] {
  const entry = weakPaperList.find(paperId);
  const before = entry ? Date.parse(entry.createdAt) : Date.now();
  const used = loadUsedGroups({ excludePaperId: paperId, before });
  return uids.flatMap((uid, i) => {
    const slot = layout.slots[i];
    return used.has(uid) && slot ? [rangeOf(slot)] : [];
  });
}

/**
 * 池子裡較新的版本組不成加強卷（§7.6）：指向題組外的空格記號、形狀和學測格式不同（ex: 'shape'），或答案改了而版本超過 31
 * （編不進 bk2 代號）。和下架一樣處理。
 */
function isUnusableBk2Update(s: SlotStatus): boolean {
  if (s.kind === 'same-key') return s.entry.ex === 'marker' || s.entry.ex === 'shape';
  if (s.kind === 'key-changed') return s.entry.ex === 'marker' || s.entry.ex === 'shape' || s.entry.v > BK2_MAX_VERSION;
  return false;
}

/** 加強卷的快照：停用來源的出版社題組換成遮住的版本（快照本身不改）。 */
function maskedSnapshot(snapshot: BankSnapshot, active: (src: string) => boolean): BankSnapshot {
  const { files, masked } = maskEndedSourceFiles(snapshot.files, active);
  return masked.length > 0 ? { ...snapshot, files } : snapshot;
}

async function strictBk2(decoded: DecodedBk2): Promise<StrictLoadResult> {
  const layout = layoutForBk2(decoded);
  const store = getWeakSnapshotStore();
  const reused = reusedRangesBk2(decoded.id, layout, decoded.slots.map((s) => s.uid));
  const snapshot = await readSnapshot(store, decoded.id);
  const active = sourceActiveFn(await loadSourceRegistry());
  // 快照裡停用來源的出版社題組遮住題目文字（sourceMask.ts，docs/design/weak-paper.md §7.6）。
  if (snapshot) return { ok: true, paper: paperFromSnapshot(maskedSnapshot(snapshot, active), { reused }), source: 'snapshot' };

  return withPoolRetry(async (pool) => {
    const statuses = layoutStatuses(pool, decoded.slots, active);
    const usable: (SlotStatus & { entry: MockPoolEntry })[] = [];
    for (const s of statuses) {
      if (!isStrictlyUsable(s) || s.kind === 'removed' || isUnusableBk2Update(s)) return { ok: false, reason: 'changed' } as const;
      usable.push(s);
    }
    const picks = usable.map((s, i) => ({ section: decoded.slots[i]?.section ?? 'vocabulary', uid: s.entry.uid, v: s.entry.v, sw: swapOf(s.entry) }));
    const files = await loadFiles(picks);
    const paper = buildBankPaper({
      paperId: decoded.id,
      tier: layout.tier,
      dataVersion: pool.version,
      slots: picks.map((p) => ({ key: `${p.uid}@${p.v}`, swap: p.sw })),
      files,
      layout,
      notices: { reused, textChanged: statuses.flatMap((s, i) => (s.kind === 'same-key' && layout.slots[i] ? [rangeOf(layout.slots[i])] : [])) },
    });
    await writeSnapshot(store, paper);
    return { ok: true, paper, source: 'network' } as const;
  });
}

/**
 * 加強卷的換題（§7.6）：每個下架的位置挑同大題、同難度的另一組，優先同命名空間；只由舊代號與目前的題庫決定
 * （used 空、種子是舊代號的 FNV-1a），所以全班打開同一個舊連結會換到同一份。避開卷內其他題組與主題（撞了才放寬）。
 * 候選判斷用 isSelectableBk2，來源是原本那一組的來源（仍有效時）與本站題庫。找不到替代的位置不放進結果。
 */
function replaceBk2(pool: MockPool, decoded: DecodedBk2, statuses: readonly SlotStatus[], active: (src: string) => boolean): Map<number, MockPoolEntry> {
  const rng = rngFromSeed(fnv1a(decoded.id));
  const taken = new Set(statuses.flatMap((s) => (s.kind === 'removed' ? [] : [s.entry.uid])));
  const themes: (readonly string[])[] = statuses.flatMap((s, i) => (s.kind === 'removed' || decoded.slots[i]?.section === 'vocabulary' ? [] : [s.entry.theme]));
  const conflicts = (theme: readonly string[]) => theme.length > 0 && themes.some((t) => t.some((k) => theme.includes(k)));
  const out = new Map<number, MockPoolEntry>();
  statuses.forEach((s, i) => {
    const slot = decoded.slots[i];
    if (s.kind !== 'removed' || !slot) return;
    const original = findPoolEntry(pool, slot.tier, slot.section, slot.uid);
    const sources = new Set<string>([AI_BANK_SOURCE_ID]);
    const all = pool.tiers[slot.tier][slot.section] as readonly MockPoolEntry[];
    if (original?.src && active(original.src)) sources.add(original.src);
    // 原本那一組已經不在池子裡（下架）時查不到它的來源：同命名空間的出版社題組都可以（仍然只收有效的來源）。
    else if (!original && slot.ns === 'pb') for (const e of all) if (e.src && active(e.src)) sources.add(e.src);
    const candidates = all
      .filter((e) => isSelectableBk2(e, sources) && !taken.has(e.uid) && (e.src == null || active(e.src)))
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    const order = shuffled(candidates, rng);
    const same = order.filter((e) => namespaceOf(e.uid) === slot.ns);
    const other = order.filter((e) => namespaceOf(e.uid) !== slot.ns);
    const vocab = slot.section === 'vocabulary';
    const pick = same.find((e) => vocab || !conflicts(e.theme)) ?? other.find((e) => vocab || !conflicts(e.theme)) ?? same[0] ?? other[0];
    if (!pick) return;
    taken.add(pick.uid);
    if (!vocab) themes.push(pick.theme);
    out.set(i, pick);
  });
  return out;
}

async function resolveBk2FromPool(
  decoded: DecodedBk2,
  fromPdf: boolean,
  pool: MockPool,
  store: SnapshotStore,
  hadSnapshot: boolean,
  active: (src: string) => boolean,
): Promise<ResolveResult> {
  const { id } = decoded;
  const statuses = layoutStatuses(pool, decoded.slots, active).map((s): SlotStatus => (isUnusableBk2Update(s) ? { kind: 'removed' } : s));
  const removed = statuses.flatMap((s, i) => (s.kind === 'removed' ? [i] : []));
  const replacements = removed.length > 0 ? replaceBk2(pool, decoded, statuses, active) : new Map<number, MockPoolEntry>();
  // 找不到同形狀的替代題組（同大題、同難度都沒有可用的）：這份卷子無法在線上重組。
  if (removed.some((i) => !replacements.has(i))) return { ok: false, reason: 'removed' };

  const picks = statuses.map((s, i) => {
    const slot = decoded.slots[i] as Bk2Slot;
    const entry = s.kind === 'removed' ? (replacements.get(i) as MockPoolEntry) : s.entry;
    return { section: slot.section, tier: slot.tier, uid: entry.uid, v: entry.v, sw: swapOf(entry) };
  });
  // 代號：current、same-key 不變；key-changed 換成新版本；removed 換成替代題組（大題與難度不變，所以版面不變）。
  const codeSlots: Bk2Slot[] = decoded.slots.map((slot, i) => {
    const s = statuses[i];
    const p = picks[i];
    if (!s || !p || s.kind === 'current' || s.kind === 'same-key') return slot;
    return { ns: namespaceOf(p.uid) ?? 'ai', section: slot.section, tier: slot.tier, uid: p.uid, v: p.v };
  });
  const newId = encodeBk2(decoded.kind, codeSlots);
  const changed = newId !== id;
  // 版面只看大題與難度（換題不變）；每一組的命名空間跟著新代號（換成本站題庫時是 ai）。
  const layout = layoutForBk2({ kind: decoded.kind, slots: codeSlots });

  const files = await loadFiles(picks);
  if (changed && hasLocalUse(id)) return viaStrict(id);

  const range = (i: number) => (layout.slots[i] ? rangeOf(layout.slots[i]) : '');
  const keyChanged = statuses.flatMap((s, i) => (s.kind === 'key-changed' ? s.changed.map((q) => layout.slots[i]?.questions[q - 1]?.label ?? String(q)) : []));
  const notices: Partial<BankPaperNotices> = {
    reused: reusedRangesBk2(newId, layout, codeSlots.map((s) => s.uid)),
    replaced: statuses.flatMap((s, i): BankPaperNotices['replaced'] =>
      s.kind === 'removed' ? [{ range: range(i), kind: 'removed' }] : s.kind === 'key-changed' ? [{ range: range(i), kind: 'updated' }] : [],
    ),
    textChanged: statuses.flatMap((s, i) => (s.kind === 'same-key' ? [range(i)] : [])),
    keyChanged,
  };
  const paper = buildBankPaper({
    paperId: newId,
    tier: layout.tier,
    dataVersion: pool.version,
    slots: picks.map((p) => ({ key: `${p.uid}@${p.v}`, swap: p.sw })),
    files,
    layout,
    notices,
  });

  let printed: PrintedInfo | null = null;
  if (changed) {
    if (weakPaperList.replaceId(id, newId) || hadSnapshot) {
      try {
        await store.delete(id);
      } catch {
        // 留下的孤兒快照之後由 cleanupOrphanSnapshots 清掉。
      }
    }
    if (fromPdf) {
      printed = { from: id, excluded: removed.map(range), keyChanged };
      weakPaperList.recordPrinted(newId, printed, pool.version);
    }
  }
  if (weakPaperList.find(newId) && !(await readSnapshot(store, newId))) await writeSnapshot(store, paper);
  return { ok: true, paper, source: 'network', strict: false, redirectedFrom: changed ? id : null, printed };
}

async function resolveBk2(decoded: DecodedBk2, fromPdf: boolean): Promise<ResolveResult> {
  const { id } = decoded;
  if (hasLocalUse(id)) return viaStrict(id);
  const store = getWeakSnapshotStore();
  const snapshot = await readSnapshot(store, id);
  const layout = layoutForBk2(decoded);
  const active = sourceActiveFn(await loadSourceRegistry());
  // 快照裡停用來源的出版社題組遮住題目文字（sourceMask.ts，docs/design/weak-paper.md §7.6）。
  const snapshotPaper = (s: BankSnapshot) => paperFromSnapshot(maskedSnapshot(s, active), { reused: reusedRangesBk2(id, layout, decoded.slots.map((x) => x.uid)) });
  let pool: MockPool;
  try {
    pool = await loadMockPool();
  } catch (error) {
    if (snapshot) return { ok: true, paper: snapshotPaper(snapshot), source: 'snapshot', strict: false, redirectedFrom: null, printed: null };
    throw error;
  }
  if (snapshot && layoutStatuses(pool, decoded.slots, active).every(isStrictlyUsable)) {
    return { ok: true, paper: snapshotPaper(snapshot), source: 'snapshot', strict: false, redirectedFrom: null, printed: null };
  }
  return withPoolRetry((p) => resolveBk2FromPool(decoded, fromPdf, p, store, snapshot !== null, active), pool);
}
