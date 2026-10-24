/**
 * 按下「組卷」（docs/design/weak-paper.md §3.2）：組卷 → 下載題組檔 → 組成卷子 → 存快照、加進「我的加強卷」。
 * 畫面（組卷頁）之後 navigate('/mock/{代號}')。和 resolve.ts 的 assembleNewPaper 同樣的流程，清單與快照用加強卷自己的。
 *
 * 組卷本身是純函式（assemblePaper.ts）；這裡負責讀這台裝置的資料（做過、盡量避開）、下載組卷池、技能分布與來源登記，
 * 以及存檔。題組檔回 404（網站剛更新）時重抓組卷池、整份重組一次（同 assembleNewPaper）。
 * 「換一份」：replacing 是被取代那一份的代號：它的題組列為盡量避開，組好之後從清單刪掉、快照也刪掉。
 */
import { forgetFailedLoads } from '../../../data/client';
import { assemblePaper, bk2SlotsOf, type AssembleFailure, type AssembleProfile, type PaperRequest, type SlotNote, type WrongGroups } from './assemblePaper';
import { buildBankPaper, type BankPaper } from './buildExam';
import { decodeBk2, encodeBk2 } from './code2';
import { layoutForBk2 } from './layout';
import { EMPTY_PAPER_SKILLS, loadPaperSkills } from './paperSkills';
import { randomSeed } from './random';
import { loadFiles, rangeOf, withPoolRetry, writeSnapshot } from './resolve';
import { getWeakSnapshotStore } from './snapshots';
import { loadSourceRegistry } from './sources';
import { loadUsedGroups } from './used';
import { avoidUids, isStoredTargetSource, saveLastRequest, weakPaperList, type StoredTarget } from './weakPapers';
import type { Relaxation } from './assemble';

export interface CreateWeakPaperInput {
  request: PaperRequest;
  /** w、f 的弱點（weakness.ts 的 WeakTarget 可以直接傳進來）；r、m 是 null。 */
  profile: AssembleProfile | null;
  /** 存進清單的目標（標籤與組卷時的數字由畫面算好）；不給時由 profile 產生（標籤是 null）。 */
  targets?: StoredTarget[];
  /** 錯過的題組（retest 用）。 */
  wrong?: WrongGroups;
  /** 不給就用 crypto 取一個（預覽模式的 ?paperseed= 由畫面傳進來）。 */
  seed?: number;
  now?: Date;
  /** 「換一份」：被取代那一份的代號。 */
  replacing?: string;
}

export type CreateWeakPaperResult = { ok: true; paper: BankPaper; notes: SlotNote[]; relaxed: Relaxation[] } | AssembleFailure;

function storedTargets(profile: AssembleProfile | null): StoredTarget[] {
  return (profile?.targets ?? []).map((t) => {
    const extra = t as { evidence?: { n?: unknown; rate?: unknown }; from?: unknown; focusOnly?: unknown };
    const n = typeof extra.evidence?.n === 'number' ? extra.evidence.n : null;
    const rate = typeof extra.evidence?.rate === 'number' ? extra.evidence.rate : null;
    const out: StoredTarget = { key: t.key, kind: t.kind, section: t.section, code: t.code, codes: [...t.codes], weight: t.weight, label: null, n, rate };
    if (Array.isArray(extra.from)) out.from = [...new Set(extra.from.filter(isStoredTargetSource))];
    if (extra.focusOnly === true) out.focusOnly = true;
    return out;
  });
}

/** 組一份加強卷並存起來。題庫湊不出來時回傳 AssembleFailure（畫面說明哪個大題、哪種難度不夠）；網路錯誤照樣丟出。 */
export async function createWeakPaper(input: CreateWeakPaperInput): Promise<CreateWeakPaperResult> {
  forgetFailedLoads();
  const seed = input.seed ?? randomSeed();
  const now = input.now ?? new Date();
  const used = loadUsedGroups();
  const replacedUids = input.replacing ? (decodeBk2(input.replacing)?.slots.map((s) => s.uid) ?? []) : [];
  const avoid = avoidUids(
    weakPaperList.load().filter((e) => e.id !== input.replacing),
    replacedUids,
  );
  // 技能分布：弱點加強卷與偏重弱點的模考格式卷一定要有（讀不到就是網路錯誤）；隨機抽題卷與中性卷用不到命中，讀不到時用空的。
  const needsSkills = input.request.kind === 'w' || input.request.kind === 'f' || input.request.diagnostic === true;
  const [skills, sources] = await Promise.all([needsSkills ? loadPaperSkills() : loadPaperSkills().catch(() => EMPTY_PAPER_SKILLS), loadSourceRegistry()]);

  const result = await withPoolRetry(async (pool): Promise<CreateWeakPaperResult> => {
    const assembled = assemblePaper({
      pool,
      skills,
      sources,
      profile: input.profile,
      request: input.request,
      used,
      avoid,
      wrong: input.wrong ?? new Map(),
      seed,
      now: now.getTime(),
    });
    if (!assembled.ok) return assembled;
    const slots = bk2SlotsOf(assembled.slots);
    const paperId = encodeBk2(assembled.kind, slots);
    const layout = layoutForBk2({ kind: assembled.kind, slots });
    const files = await loadFiles(assembled.slots);
    const paper = buildBankPaper({
      paperId,
      tier: layout.tier,
      dataVersion: pool.version,
      slots: assembled.slots.map((s) => ({ key: `${s.uid}@${s.v}`, swap: s.sw })),
      files,
      layout,
      notices: {
        reused: assembled.notes.flatMap((n, i) => (n.flags.includes('reused') && layout.slots[i] ? [rangeOf(layout.slots[i])] : [])),
      },
    });
    return { ok: true, paper, notes: assembled.notes, relaxed: assembled.relaxed };
  });
  if (!result.ok) return result;

  const { paper } = result;
  const store = getWeakSnapshotStore();
  await writeSnapshot(store, paper, now);
  const existing = weakPaperList.find(paper.id);
  weakPaperList.add(
    existing ?? {
      id: paper.id,
      kind: input.request.kind,
      createdAt: now.toISOString(),
      poolVersion: paper.dataVersion,
      request: input.request,
      targets: input.targets ?? storedTargets(input.profile),
      notes: result.notes,
    },
  );
  if (input.replacing && input.replacing !== paper.id) {
    const old = weakPaperList.find(input.replacing);
    if (old && !old.startedAt && !old.pdfAt && !old.paperDoneAt) {
      weakPaperList.save(weakPaperList.load().filter((e) => e.id !== input.replacing));
      await store.delete(input.replacing).catch(() => undefined);
    }
  }
  await weakPaperList.prune().catch(() => []);
  saveLastRequest(input.request);
  return result;
}
