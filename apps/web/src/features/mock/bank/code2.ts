/**
 * 加強卷的卷子代號 bk2（docs/design/weak-paper.md §7.1）。
 *
 *   paperId = "bk2-" + 卷別 + "-" + 題組 × n
 *     卷別  w（弱點加強卷）｜f（模考格式卷，偏重弱點）｜r（隨機抽題卷）｜m（中性模考格式卷：冷啟動的診斷卷、/mock 選了出版社來源時）
 *     題組  7 個 Crockford base32 小寫字元 ＝ 35 位元（高位到低位）：
 *             命名空間 1 位元   0 ＝ ai（本站題庫）、1 ＝ pb（出版社模考）
 *             題型     3 位元   0–7 依序 vo cz wb st rd mx tr cp（藍圖的大題順序）
 *             難度     2 位元   0 穩定基礎、1 進階練習、2 超越頂標（3 保留，解碼時無效）
 *             uid      24 位元  uid 的 6 位十六進位
 *             版本     5 位元   1–31
 *     n     w、r：1–12；f、m：11
 *     順序  卷面順序：大題依藍圖順序（不能倒退），同大題內照選題結果
 *   長度 6 + 7n：f、m 是 83 個字元；w、r 最長 90 個字元。
 *
 * 每組自帶題型與難度：bk1 靠位置推題型、一份卷子一個難度；bk2 的卷子長度不固定、可以跨難度，換題時也要知道下架題組原本的
 * 大題與難度。版面（題號、配分、作答時間）只由代號決定（layout.ts）。
 *
 * 檢查（decodeBk2，格式不對就是「找不到這份試卷」，不發任何請求）：字元與長度；每組的命名空間、難度、版本有效；
 * 完整 uid（含命名空間與題型）不重複；大題順序不能倒退（一個代號只有一種版面）；f、m 恰好 11 組、大題依序是藍圖的 11 個位置、
 * 難度全部相同；w、r 中譯英最多 1 組、作文最多 1 篇；選擇與混合題最多 80 題（§4.4）。出版社題只收六種選擇與混合題型（§8.5）。
 *
 * 這個檔案不匯入 blueprint.ts（藍圖會匯入 papers.ts，作答紀錄的卷名要認得 bk2）；f、m 的 11 個位置另外寫一份常數，
 * code2.test.ts 檢查它和 BLUEPRINT_SLOTS 一致。decodeAnyPaperId 依格式分給 bk1（code.ts）或 bk2。
 */
import { BANK_UID_CODES, TIERS, type BankSectionType, type ItemNamespace, type Tier } from '@gsat/shared';
import { decodePaperId, type DecodedPaperId } from './code';
import { PAPER_ALPHABET as ALPHABET, normalizeBk2PaperId, type Bk2Kind } from './paperId';

export { BK2_ID_PATTERN, BK2_KINDS, bk2KindOf, kindOfPaperId, normalizeAnyPaperId, normalizeBk2PaperId, type Bk2Kind } from './paperId';

export const BK2_FORMAT = 'bk2';
/** 每個題組的字元數。 */
export const BK2_GROUP_CHARS = 7;
/** 一份最多幾組（QR code 的密度，§7.1）。 */
export const BK2_MAX_GROUPS = 12;
/** 版本上限：5 位元（目前題庫最大版本 3）。 */
export const BK2_MAX_VERSION = 31;
/** 選擇與混合題最多幾題（題號兩位數、Worker 的卷面題號檢查與答題卷版面，§4.4）。 */
export const BK2_MAX_QUESTIONS = 80;
/** 隨機抽題卷最長幾分鐘（§4.4；不比一份完整的學測長）。 */
export const BK2_MAX_RANDOM_MINUTES = 100;
/** PDF 上 QR code 的網址前綴（同 bk1，bank-mock §7.2）。 */
export const PAPER_URL_PREFIX = 'https://gsat-english-center.vercel.app/mock/';
/** QR code 每格 2 pt 時（version 8、M 級、byte 模式）最多幾個字元（§7.1）。 */
export const QR_MAX_URL_CHARS = 152;

/** 題型代碼 0–7 的順序（藍圖的大題順序）。 */
export const BK2_SECTION_ORDER: readonly BankSectionType[] = ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition'];
/** f、m 的 11 個位置的大題（同 blueprint.ts 的 BLUEPRINT_SLOTS，code2.test.ts 檢查兩者一致）。 */
export const FULL_PAPER_SECTIONS: readonly BankSectionType[] = ['vocabulary', 'cloze', 'cloze', 'word_bank', 'structure', 'reading', 'reading', 'reading', 'mixed', 'translation', 'composition'];
/** 每組的題數（同 blueprint.ts 的 questionsPerGroup）。 */
export const BK2_QUESTIONS_PER_GROUP: Readonly<Record<BankSectionType, number>> = { vocabulary: 10, cloze: 5, word_bank: 10, structure: 4, reading: 4, mixed: 4, translation: 2, composition: 1 };
/** 出版社題能放進卷子的題型（第一版不收中譯英、作文，§8.5）。 */
const PUBLISHER_SECTIONS: ReadonlySet<BankSectionType> = new Set(['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed']);

/** 代號裡的一個題組。 */
export interface Bk2Slot {
  ns: ItemNamespace;
  section: BankSectionType;
  tier: Tier;
  uid: string;
  v: number;
}

export interface DecodedBk2 {
  format: 'bk2';
  /** 標準寫法的代號。 */
  id: string;
  kind: Bk2Kind;
  slots: Bk2Slot[];
  /** 網址結尾有 `.p`（從 PDF 進來）。 */
  fromPdf: boolean;
}

export type DecodedAnyPaperId = (DecodedPaperId & { format: 'bk1' }) | DecodedBk2;

const UID_PATTERN = /^(ai|pb)\.([a-z]{2})\.([0-9a-f]{6})$/;
const UID_SPACE = 0x1_00_00_00; // 2^24

/** 選擇與混合題的題數（中譯英、作文不算）。 */
export function choiceQuestionCount(slots: readonly Pick<Bk2Slot, 'section'>[]): number {
  return slots.reduce((n, s) => n + (s.section === 'translation' || s.section === 'composition' ? 0 : BK2_QUESTIONS_PER_GROUP[s.section]), 0);
}

/** 代號的規則（encode 與 decode 共用）；違反時回傳說明，符合回傳 null。 */
export function bk2RuleViolation(kind: Bk2Kind, slots: readonly Bk2Slot[]): string | null {
  if (slots.length < 1 || slots.length > BK2_MAX_GROUPS) return `題組數要 1–${BK2_MAX_GROUPS} 組，收到 ${slots.length} 組`;
  const uids = new Set<string>();
  let lastOrder = -1;
  for (const s of slots) {
    const m = UID_PATTERN.exec(s.uid);
    if (!m || m[1] !== s.ns || m[2] !== BANK_UID_CODES[s.section]) return `uid 和命名空間、題型不符：${s.uid}`;
    if (s.ns === 'pb' && !PUBLISHER_SECTIONS.has(s.section)) return `出版社題不能放這個題型：${s.uid}`;
    if (!(TIERS as readonly string[]).includes(s.tier)) return `難度不對：${s.uid}`;
    if (!Number.isInteger(s.v) || s.v < 1 || s.v > BK2_MAX_VERSION) return `版本超出範圍：${s.uid}@${s.v}`;
    if (uids.has(s.uid)) return `題組重複：${s.uid}`;
    uids.add(s.uid);
    const order = BK2_SECTION_ORDER.indexOf(s.section);
    if (order < lastOrder) return `大題順序倒退：${s.uid}`;
    lastOrder = order;
  }
  if (kind === 'f' || kind === 'm') {
    if (slots.length !== FULL_PAPER_SECTIONS.length || slots.some((s, i) => s.section !== FULL_PAPER_SECTIONS[i])) return '模考格式卷要照藍圖的 11 個位置';
    if (new Set(slots.map((s) => s.tier)).size !== 1) return '模考格式卷只能有一種難度';
  } else {
    if (slots.filter((s) => s.section === 'translation').length > 1) return '中譯英最多 1 組';
    if (slots.filter((s) => s.section === 'composition').length > 1) return '作文最多 1 篇';
  }
  if (choiceQuestionCount(slots) > BK2_MAX_QUESTIONS) return `選擇與混合題最多 ${BK2_MAX_QUESTIONS} 題`;
  return null;
}

function encodeGroup(slot: Bk2Slot): string {
  const m = UID_PATTERN.exec(slot.uid);
  const type = BK2_SECTION_ORDER.indexOf(slot.section);
  const tier = TIERS.indexOf(slot.tier);
  if (!m || type < 0 || tier < 0) throw new Error(`題組不能編碼：${slot.uid}`);
  const head = ((slot.ns === 'pb' ? 1 : 0) * 8 + type) * 4 + tier;
  // 35 位元超過 32 位元整數運算的範圍，用一般的乘法（2^35 < 2^53，不會失去精度）。
  let value = (head * UID_SPACE + Number.parseInt(m[3] ?? '', 16)) * 32 + slot.v;
  let out = '';
  for (let i = 0; i < BK2_GROUP_CHARS; i += 1) {
    out = (ALPHABET[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function decodeGroup(chars: string): Bk2Slot | null {
  let value = 0;
  for (const ch of chars) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    value = value * 32 + digit;
  }
  const v = value % 32;
  value = Math.floor(value / 32);
  const hex = (value % UID_SPACE).toString(16).padStart(6, '0');
  const head = Math.floor(value / UID_SPACE);
  const tier = TIERS[head % 4];
  const section = BK2_SECTION_ORDER[Math.floor(head / 4) % 8];
  const ns: ItemNamespace = Math.floor(head / 32) === 1 ? 'pb' : 'ai';
  if (v < 1 || !tier || !section) return null;
  return { ns, section, tier, uid: `${ns}.${BANK_UID_CODES[section]}.${hex}`, v };
}

/** 依卷面順序把題組編成代號。違反代號規則時丟出錯誤（組卷程式已經照規則挑題，正常不會發生）。 */
export function encodeBk2(kind: Bk2Kind, slots: readonly Bk2Slot[]): string {
  const violation = bk2RuleViolation(kind, slots);
  if (violation) throw new Error(`加強卷代號不能編碼：${violation}`);
  return `${BK2_FORMAT}-${kind}-${slots.map(encodeGroup).join('')}`;
}

/** 解碼（不分大小寫、可以帶 .p）。格式或規則不對回傳 null。回傳的 uid 都可以直接拼成題組檔的網址。 */
export function decodeBk2(raw: string): DecodedBk2 | null {
  const normalized = normalizeBk2PaperId(raw);
  if (!normalized) return null;
  const { id, fromPdf } = normalized;
  const kind = id.charAt(4) as Bk2Kind;
  const body = id.slice(6);
  const slots: Bk2Slot[] = [];
  for (let i = 0; i < body.length; i += BK2_GROUP_CHARS) {
    const slot = decodeGroup(body.slice(i, i + BK2_GROUP_CHARS));
    if (!slot) return null;
    slots.push(slot);
  }
  if (bk2RuleViolation(kind, slots)) return null;
  return { format: 'bk2', id, kind, slots, fromPdf };
}

/** 任何格式的代號：bk1 的結果和 decodePaperId 相同（多一個 format），bk2 是 decodeBk2。格式不對回傳 null。 */
export function decodeAnyPaperId(raw: string): DecodedAnyPaperId | null {
  const bk1 = decodePaperId(raw);
  if (bk1) return { ...bk1, format: 'bk1' };
  return decodeBk2(raw);
}

/** 卷子的網址（QR code 用：結尾 .p）。 */
export function paperUrl(paperId: string, fromPdf = true): string {
  return `${PAPER_URL_PREFIX}${paperId}${fromPdf ? '.p' : ''}`;
}
