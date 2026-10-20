/**
 * 卷子代號的格式判斷與卷號（docs/design/bank-mock.md §4.6）：不需要藍圖的那一半，從 code.ts 拆出來。
 *
 * 為什麼拆：features/mock/papers.ts 的 mockPaperLabel()、MockSessionPage 與 MockReportPage 的分派都要認得代號，
 * 但 code.ts 匯入 blueprint.ts，blueprint.ts 又匯入 papers.ts 的 SUGGESTED_MINUTES；papers.ts 直接匯入 code.ts 會變成
 * 循環匯入（先載入 papers.ts 時，blueprint.ts 會在 SUGGESTED_MINUTES 還沒初始化時就讀它）。
 * 這個檔案只依賴 random.ts 的 FNV-1a，歷屆卷的頁面匯入它也不會把組卷程式帶進同一個 chunk。
 * code.ts 原樣轉匯出這裡的函式，組卷程式的匯入不用改。
 */
import type { Tier } from '@gsat/shared';
import { fnv1a } from './random';

export const PAPER_FORMAT = 'bk1';

/** Crockford base32（小寫）：0-9、a-z 去掉 i、l、o、u。 */
export const PAPER_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export const TIER_CODES: Readonly<Record<Tier, 'b' | 'a' | 't'>> = { basic: 'b', advanced: 'a', top: 't' };
export const TIER_OF_CODE: Readonly<Record<string, Tier>> = { b: 'basic', a: 'advanced', t: 'top' };

/** PDF 上的網址結尾（§4.6）。 */
export const PDF_SUFFIX = '.p';

/** 標準寫法（小寫、沒有 .p）。 */
export const PAPER_ID_PATTERN = /^bk1-[bat]-[0-9a-hjkmnp-tv-z]{66}$/;

/**
 * 看起來是不是本站自組卷的代號（`bk` 加數字開頭，不分大小寫）：路由與成績單用它分派到自組卷的元件，
 * 格式細節交給 decodePaperId——格式不對的代號也要進到自組卷頁，才能顯示「找不到這份試卷」。
 * 歷屆卷的 id（gsat-115、ref-115）不會符合；EXAM_ID_PATTERN 也不會比對到 bk1-。
 */
export function isBankPaperId(paperId: string): boolean {
  return /^bk[1-9]\d*-/i.test(paperId);
}

/** 網址上的代號 → 標準寫法與「從 PDF 來」；字元或長度不對回傳 null。不檢查版本與 uid 重複（見 code.ts 的 decodePaperId）。 */
export function normalizePaperId(raw: string): { id: string; fromPdf: boolean } | null {
  let id = raw.trim().toLowerCase();
  let fromPdf = false;
  if (id.endsWith(PDF_SUFFIX)) {
    id = id.slice(0, -PDF_SUFFIX.length);
    fromPdf = true;
  }
  return PAPER_ID_PATTERN.test(id) ? { id, fromPdf } : null;
}

/** 卷號：「B-7Q2MK」。輸入可以是任何寫法的代號，一律先轉成標準寫法再雜湊；格式不對時用原字串（只供顯示）。 */
export function paperNumber(paperId: string): string {
  const id = normalizePaperId(paperId)?.id ?? paperId.toLowerCase();
  const tierLetter = (id.charAt(4) || '?').toUpperCase();
  // 32 位元雜湊取最高的 25 位元，切成 5 個 base32 字元。
  let value = fnv1a(id) >>> 7;
  let out = '';
  for (let i = 0; i < 5; i += 1) {
    out = (PAPER_ALPHABET[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return `${tierLetter}-${out.toUpperCase()}`;
}

/** 代號的難度；格式不對回傳 null（不必完整解碼，例如作答紀錄列表）。 */
export function tierOfPaperId(paperId: string): Tier | null {
  const normalized = normalizePaperId(paperId);
  return normalized ? (TIER_OF_CODE[normalized.id.charAt(4)] ?? null) : null;
}
