/**
 * 手寫作文 OCR 結果的逐行確認（SPEC §6.9「手寫作文」）。
 *
 * OCR 只轉錄、保留錯字；看不清楚的地方以 [[?]] 標記，OcrResult.uncertain 給位置（含標記本身）與候選字。
 * 確認畫面把全文切成行，每行可以修改；有看不清楚的行加亮並列出候選字，點候選字就取代那個標記。
 * 候選字跟著「標記」走、不跟著行號走（matchMarks）：同一行有好幾處時依處分組，點哪一處的候選字就換哪一處
 * （replaceMarkAt）；增刪行或改掉其他標記之後，剩下的標記仍然對得到原本的候選字。
 * 全部 [[?]] 處理完才能送出確認（PUT /api/submissions/{id}/confirm）。
 */
import type { OcrResult } from '@gsat/shared';

export const OCR_UNCERTAIN_MARK = '[[?]]';

export interface OcrUncertainInLine {
  /** 在這一行裡的位移。 */
  start: number;
  end: number;
  /** 原文片段（通常就是 [[?]]，也可能包含前後的字）。 */
  excerpt: string;
  candidates: string[];
}

export interface OcrLine {
  index: number;
  text: string;
  uncertain: OcrUncertainInLine[];
}

/** 全文 → 行（保留空行，段落之間的空行原樣送回）。uncertain 的位置換算成行內位移；跨行的片段截在該行內。 */
export function splitOcrLines(ocr: Pick<OcrResult, 'text' | 'uncertain'>): OcrLine[] {
  const rawLines = ocr.text.split('\n');
  const lines: OcrLine[] = [];
  let offset = 0;
  for (const [index, text] of rawLines.entries()) {
    const lineStart = offset;
    const lineEnd = offset + text.length;
    const uncertain: OcrUncertainInLine[] = [];
    for (const u of ocr.uncertain) {
      if (u.end <= lineStart || u.start >= lineEnd || u.end <= u.start) continue;
      const start = Math.max(u.start, lineStart) - lineStart;
      const end = Math.min(u.end, lineEnd) - lineStart;
      uncertain.push({ start, end, excerpt: text.slice(start, end), candidates: u.candidates.filter((c) => c.trim() !== '') });
    }
    // 後端沒給位置、但文字裡有 [[?]]：自己找出來（沒有候選字）。
    let from = 0;
    for (;;) {
      const at = text.indexOf(OCR_UNCERTAIN_MARK, from);
      if (at < 0) break;
      const end = at + OCR_UNCERTAIN_MARK.length;
      if (!uncertain.some((u) => u.start <= at && u.end >= end)) {
        uncertain.push({ start: at, end, excerpt: OCR_UNCERTAIN_MARK, candidates: [] });
      }
      from = end;
    }
    uncertain.sort((a, b) => a.start - b.start);
    lines.push({ index, text, uncertain });
    offset = lineEnd + 1;
  }
  return lines;
}

/** 還有幾個 [[?]] 沒處理。 */
export function countUnresolved(text: string): number {
  return text.split(OCR_UNCERTAIN_MARK).length - 1;
}

/** 文字裡每個 [[?]] 的位置（依序）。 */
export function markPositions(text: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(OCR_UNCERTAIN_MARK, from);
    if (at < 0) return out;
    out.push(at);
    from = at + OCR_UNCERTAIN_MARK.length;
  }
}

/** 把文字裡第 k 個（0 起算）[[?]] 換成 replacement；沒有第 k 個就原樣回傳。同一行有好幾處時，換的是學生點的那一處。 */
export function replaceMarkAt(text: string, k: number, replacement: string): string {
  const at = markPositions(text)[k];
  if (at === undefined) return text;
  return text.slice(0, at) + replacement + text.slice(at + OCR_UNCERTAIN_MARK.length);
}

/** 原始 OCR 文字裡的每一個 [[?]]（依位置），附上它的候選字（後端 uncertain[] 給位置；沒對到的沒有候選字）。 */
export function ocrMarks(ocr: Pick<OcrResult, 'text' | 'uncertain'>): Array<{ candidates: string[] }> {
  return markPositions(ocr.text).map((at) => {
    const end = at + OCR_UNCERTAIN_MARK.length;
    const span = ocr.uncertain.find((u) => u.start <= at && u.end >= end) ?? ocr.uncertain.find((u) => u.start < end && u.end > at);
    return { candidates: (span?.candidates ?? []).filter((c) => c.trim() !== '') };
  });
}

/** LCS 表格的上限（約 1,000 × 1,000 個詞）；作文上限 600 個單詞，正常不會超過。 */
const MAX_LCS_CELLS = 1_000_000;

/** 比對用的單位：[[?]] 標記本身，或其他連續的非空白字（遇到 [[?]] 就切開）。換行與空白不算，所以增刪行、段落不影響。 */
function compareTokens(text: string): string[] {
  return text.match(/\[\[\?\]\]|(?:(?!\[\[\?\]\])\S)+/g) ?? [];
}

/**
 * 目前文字裡的第 k 個 [[?]] 對應到原始 OCR 的第幾個 [[?]]（對不到＝學生自己打的，或附近改得面目全非，回 null）。
 *
 * 不能靠「第幾行」或「第幾個」對應：學生把前面某一處改掉、在「整篇一起編輯」增刪行之後，行號與順序都會位移，
 * 候選字就會跑到別的地方。這裡用詞層級的最長共同子序列（LCS）把目前的文字和原始 OCR 文字對齊，
 * 標記跟著前後的字走。開頭與結尾相同的部分先略過，一般只改一兩個字時要比對的範圍很小。
 */
export function matchMarks(original: string, current: string): Array<number | null> {
  const b = compareTokens(current);
  const markCount = b.filter((t) => t === OCR_UNCERTAIN_MARK).length;
  if (markCount === 0) return [];
  const a = compareTokens(original);
  const result: Array<number | null> = new Array<number | null>(markCount).fill(null);
  // a、b 中每個 token 是第幾個標記（不是標記為 -1）。
  const ordinals = (tokens: string[]) => {
    let n = 0;
    return tokens.map((t) => (t === OCR_UNCERTAIN_MARK ? n++ : -1));
  };
  const aMark = ordinals(a);
  const bMark = ordinals(b);
  const pair = (i: number, j: number) => {
    const am = aMark[i] ?? -1;
    const bm = bMark[j] ?? -1;
    if (am >= 0 && bm >= 0) result[bm] = am;
  };

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    pair(start, start);
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    pair(endA, endB);
  }

  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0 && n * m > MAX_LCS_CELLS) {
    // 太長（遠超過作文上限的辨識結果整篇大改）：中間這段的標記依順序對應，不做 LCS。
    const am = a.slice(start, endA).flatMap((t, i) => (t === OCR_UNCERTAIN_MARK ? [start + i] : []));
    const bm = b.slice(start, endB).flatMap((t, j) => (t === OCR_UNCERTAIN_MARK ? [start + j] : []));
    bm.forEach((j, k) => {
      const i = am[k];
      if (i !== undefined) pair(i, j);
    });
  } else if (n > 0 && m > 0) {
    // dp[i][j]＝a[start+i..endA) 與 b[start+j..endB) 的 LCS 長度（由後往前填，才能由前往後回溯）。
    const width = m + 1;
    const dp = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i * width + j] =
          a[start + i] === b[start + j] ? (dp[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        pair(start + i, start + j);
        i += 1;
        j += 1;
      } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0)) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  return result;
}
