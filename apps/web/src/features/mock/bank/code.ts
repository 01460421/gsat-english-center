/**
 * 卷子代號與卷號（docs/design/bank-mock.md §4.6）。
 *
 *   paperId = "bk1-" + 難度 + "-" + 位置 × 11
 *     難度  b（穩定基礎）｜a（進階練習）｜t（超越頂標）
 *     位置  base32(uid 的 24 位元 × 64 + 版本)，固定 6 個字元（Crockford base32 小寫：0-9、a-z 去掉 i l o u），版本 1–63
 *     順序  詞彙、綜合 1、綜合 2、文意選填、篇章結構、閱讀 1（圖表或表格）、閱讀 2、閱讀 3、混合題、中譯英、作文
 *   長度 6 + 66 = 72 個字元。
 *
 * 代號本身就是題組清單：任何裝置打開同一個代號，都組出同一份卷子。解碼不分大小寫，標準寫法是小寫；
 * PDF 上的 QR code 與網址在代號後面多一個 `.p`（代表從 PDF 進來）。
 * 每個位置的題型由位置決定，和十六進位拼成完整 uid（ai.rd.0a1b2c）；不同題型可以有相同的十六進位，
 * 所以唯一性檢查用完整 uid。格式不對就是「找不到這份試卷」，不發任何請求。
 *
 * 卷號（例如「B-7Q2MK」）給人看、也印在 PDF 上：難度字母大寫＋連字號＋代號的 FNV-1a 雜湊取 5 個 base32 字元。
 * 只用來顯示與核對，不能拿來找卷子。
 *
 * `bk1` 是代號格式的版本，也包含 §5.3 的答案位置調整規則；之後藍圖、編碼或調整規則改了就用 `bk2`，舊網址照樣能解。
 */
import type { Tier } from '@gsat/shared';
import { BLUEPRINT_SLOTS, SLOT_COUNT } from './blueprint';
import { fnv1a } from './random';

export const PAPER_FORMAT = 'bk1';

/** Crockford base32（小寫）：0-9、a-z 去掉 i、l、o、u。 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SLOT_CHARS = 6;
/** 版本上限：6 位元。 */
export const MAX_SLOT_VERSION = 63;

export const TIER_CODES: Readonly<Record<Tier, 'b' | 'a' | 't'>> = { basic: 'b', advanced: 'a', top: 't' };
const TIER_OF_CODE: Readonly<Record<string, Tier>> = { b: 'basic', a: 'advanced', t: 'top' };

/** PDF 上的網址結尾（§4.6）。 */
export const PDF_SUFFIX = '.p';

/** 標準寫法（小寫、沒有 .p）。 */
export const PAPER_ID_PATTERN = /^bk1-[bat]-[0-9a-hjkmnp-tv-z]{66}$/;

/** 代號裡的一個題組。 */
export interface PaperSlot {
  uid: string;
  v: number;
}

export interface DecodedPaperId {
  /** 標準寫法的代號。 */
  id: string;
  tier: Tier;
  /** 11 個位置，依代號的順序。 */
  slots: PaperSlot[];
  /** 網址結尾有 `.p`（從 PDF 進來）。 */
  fromPdf: boolean;
}

/**
 * 看起來是不是本站自組卷的代號（`bk` 加數字開頭，不分大小寫）：路由與成績單用它分派到自組卷的元件，
 * 格式細節交給 decodePaperId——格式不對的代號也要進到自組卷頁，才能顯示「找不到這份試卷」。
 * 歷屆卷的 id（gsat-115、ref-115）不會符合；EXAM_ID_PATTERN 也不會比對到 bk1-。
 */
export function isBankPaperId(paperId: string): boolean {
  return /^bk[1-9]\d*-/i.test(paperId);
}

/** 網址上的代號 → 標準寫法與「從 PDF 來」；字元或長度不對回傳 null。不檢查版本與 uid 重複（見 decodePaperId）。 */
export function normalizePaperId(raw: string): { id: string; fromPdf: boolean } | null {
  let id = raw.trim().toLowerCase();
  let fromPdf = false;
  if (id.endsWith(PDF_SUFFIX)) {
    id = id.slice(0, -PDF_SUFFIX.length);
    fromPdf = true;
  }
  return PAPER_ID_PATTERN.test(id) ? { id, fromPdf } : null;
}

function encodeSlot(slot: PaperSlot, index: number): string {
  const spec = BLUEPRINT_SLOTS[index];
  const m = /^ai\.([a-z]{2})\.([0-9a-f]{6})$/.exec(slot.uid);
  if (!spec || !m || m[1] !== spec.uidCode) throw new Error(`第 ${index + 1} 個位置的 uid 不能編碼：${slot.uid}`);
  if (!Number.isInteger(slot.v) || slot.v < 1 || slot.v > MAX_SLOT_VERSION) throw new Error(`版本超出範圍：${slot.uid}@${slot.v}`);
  let value = Number.parseInt(m[2] ?? '', 16) * 64 + slot.v;
  let out = '';
  for (let i = 0; i < SLOT_CHARS; i += 1) {
    out = (ALPHABET[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function decodeSlot(chars: string, index: number): PaperSlot | null {
  const spec = BLUEPRINT_SLOTS[index];
  if (!spec) return null;
  let value = 0;
  for (const ch of chars) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    value = value * 32 + digit;
  }
  const v = value % 64;
  if (v < 1) return null;
  const hex = Math.floor(value / 64)
    .toString(16)
    .padStart(6, '0');
  return { uid: `ai.${spec.uidCode}.${hex}`, v };
}

/**
 * 依藍圖的位置順序把 11 個題組編成代號。uid 的題型和位置不符、版本不在 1–63、完整 uid 重複時丟出錯誤
 * （組卷池已經排除這些題組，正常情況不會發生）。
 */
export function encodePaperId(tier: Tier, slots: readonly PaperSlot[]): string {
  if (slots.length !== SLOT_COUNT) throw new Error(`代號要有 ${SLOT_COUNT} 個題組，收到 ${slots.length} 個`);
  if (new Set(slots.map((s) => s.uid)).size !== slots.length) throw new Error('代號裡的題組重複');
  return `${PAPER_FORMAT}-${TIER_CODES[tier]}-${slots.map(encodeSlot).join('')}`;
}

/**
 * 解碼（不分大小寫、可以帶 `.p`）。格式不對、版本是 0、完整 uid 重複都回傳 null；
 * 回傳的 uid 都符合 ai.{題型}.{6 位十六進位}，可以直接拼成題組檔的網址。
 */
export function decodePaperId(raw: string): DecodedPaperId | null {
  const normalized = normalizePaperId(raw);
  if (!normalized) return null;
  const { id, fromPdf } = normalized;
  const tier = TIER_OF_CODE[id.charAt(4)];
  if (!tier) return null;
  const body = id.slice(6);
  const slots: PaperSlot[] = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    const slot = decodeSlot(body.slice(i * SLOT_CHARS, (i + 1) * SLOT_CHARS), i);
    if (!slot) return null;
    slots.push(slot);
  }
  if (new Set(slots.map((s) => s.uid)).size !== slots.length) return null;
  return { id, tier, slots, fromPdf };
}

/** 卷號：「B-7Q2MK」。輸入可以是任何寫法的代號，一律先轉成標準寫法再雜湊；格式不對時用原字串（只供顯示）。 */
export function paperNumber(paperId: string): string {
  const id = normalizePaperId(paperId)?.id ?? paperId.toLowerCase();
  const tierLetter = (id.charAt(4) || '?').toUpperCase();
  // 32 位元雜湊取最高的 25 位元，切成 5 個 base32 字元。
  let value = fnv1a(id) >>> 7;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out = (ALPHABET[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return `${tierLetter}-${out.toUpperCase()}`;
}

/** 代號的難度；格式不對回傳 null（不必完整解碼，例如作答紀錄列表）。 */
export function tierOfPaperId(paperId: string): Tier | null {
  const normalized = normalizePaperId(paperId);
  return normalized ? (TIER_OF_CODE[normalized.id.charAt(4)] ?? null) : null;
}
