/**
 * 代號裡某個 uid@版本 的上架狀態（docs/design/bank-mock.md §4.7 第 (1) 部分）。上架狀態以發布結果為準：
 * 組卷池收錄所有已發布的題組（含帶排除原因 ex 的），所以這裡只看池子裡有沒有這個 uid、是哪個版本。
 *
 *   current      池子裡就是這個版本（帶排除原因的照樣是 current：字型子集或建置檢查變嚴，不會讓舊卷子被當成下架）
 *   same-key     池子裡是較新的版本，但 prev[v] 的每一題指紋都和目前相同：題目文字可能改了，答案、題數與題序都沒變
 *   key-changed  池子裡是較新的版本，而且有題目的指紋不同；changed 是哪幾題（題數不同、或查不到舊版本的指紋時整組都算；
 *                閱讀的指紋含整篇的答案位置調整資料，任何一題的答案或可交換設定改了，整篇四題都會列進來）
 *   removed      池子裡沒有這個 uid（下架或撤回）
 *
 * 和 writing/bank/data.ts 的 bankVersionStatus 是同樣的分法，多了 same-key。
 * 組卷池抓不到時狀態是「未知」：由呼叫端處理（有快照照常打開、成績單不顯示下架註記），這裡不表示。
 */
import type { BankSectionType, Tier } from '@gsat/shared';
import { BLUEPRINT_SLOTS } from './blueprint';
import type { PaperSlot } from './code';
import { findPoolEntry, type MockPool, type MockPoolEntry } from './pool';

export type SlotStatus =
  | { kind: 'current'; entry: MockPoolEntry }
  | { kind: 'same-key'; entry: MockPoolEntry }
  | { kind: 'key-changed'; entry: MockPoolEntry; changed: number[] }
  | { kind: 'removed' };

export type SlotStatusKind = SlotStatus['kind'];

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * 一個 uid@v 對照池子裡的條目（同一個 uid；沒有是 null）。changed 是題組內的題目位置（從 1 起算），
 * 依新版本的題數列出。代號裡的版本比池子新（例如較新的版本被下架、退回舊版）時查不到指紋，整組都算改了。
 */
export function statusOfEntry(entry: MockPoolEntry | null, v: number): SlotStatus {
  if (!entry) return { kind: 'removed' };
  if (entry.v === v) return { kind: 'current', entry };
  const old = entry.v > v ? entry.prev?.[String(v)] : undefined;
  if (old && sameKeys(old, entry.k)) return { kind: 'same-key', entry };
  const all = entry.k.map((_, i) => i + 1);
  if (!old || old.length !== entry.k.length) return { kind: 'key-changed', entry, changed: all };
  return { kind: 'key-changed', entry, changed: all.filter((_, i) => old[i] !== entry.k[i]) };
}

/** 一個題組在某個難度、某個大題裡的狀態。只在同難度找：一份卷子不混難度。 */
export function slotStatus(pool: MockPool, tier: Tier, section: BankSectionType, slot: PaperSlot): SlotStatus {
  return statusOfEntry(findPoolEntry(pool, tier, section, slot.uid), slot.v);
}

/** 整份卷子 11 個位置的狀態（依代號的順序）。 */
export function paperStatuses(pool: MockPool, paper: { tier: Tier; slots: readonly PaperSlot[] }): SlotStatus[] {
  return paper.slots.map((slot, i) => {
    const spec = BLUEPRINT_SLOTS[i];
    return spec ? slotStatus(pool, paper.tier, spec.section, slot) : { kind: 'removed' };
  });
}

/** 嚴格載入（§4.7 第 (3) 部分）接受的狀態：current 或 same-key。 */
export function isStrictlyUsable(status: SlotStatus): boolean {
  return status.kind === 'current' || status.kind === 'same-key';
}
