/**
 * 每個字元用哪個字型。PDF 引擎（pdfmake）沒有「缺字就換下一個字型」的機制，一段文字只能指定一個字型，
 * 所以排版前先把文字切成「同一字型的連續片段」：
 *   - 英文、數字、半形標點、彎引號與破折號（metrics.json 的 latinRanges，也就是 Tinos 實際有字形的字元）→ Tinos
 *   - 表情符號（emojiRanges）→ Noto Emoji
 *   - 其餘（中文、全形標點）→ Noto Serif TC
 * 粗體的中文只有標題用得到，Noto Serif TC Bold 只收了標題會出現的字（boldCjk）；不在裡面的字改用一般粗細，不會變成方框。
 *
 * 規則與 scripts/font-coverage.mjs（建置時的缺字檢查）相同，兩邊都讀 fonts/metrics.json，不要各自寫一份範圍。
 */
import metrics from './fonts/metrics.json';

export type PdfFontFamily = 'Tinos' | 'NotoSerifTC' | 'NotoEmoji';

type Range = readonly [number, number];
/** metrics.json 的範圍是 [起, 迄] 兩個數字（JSON 推不出 tuple 型別，在這裡轉一次）。 */
function ranges(list: readonly (readonly number[])[]): Range[] {
  return list.map(([a = 0, b = a]) => [a, b] as const);
}
const LATIN = ranges(metrics.latinRanges);
const EMOJI = ranges(metrics.emojiRanges);
const BOLD_CJK = new Set(Array.from(metrics.boldCjk, (ch) => ch.codePointAt(0) ?? 0));
const ADVANCE = metrics.tinosAdvance as Readonly<Record<string, number>>;

function inRanges(cp: number, list: readonly Range[]): boolean {
  for (const [a, b] of list) if (cp >= a && cp <= b) return true;
  return false;
}

export function fontForCodePoint(cp: number): PdfFontFamily {
  if (inRanges(cp, LATIN)) return 'Tinos';
  if (inRanges(cp, EMOJI)) return 'NotoEmoji';
  return 'NotoSerifTC';
}

/** 這個字元有沒有粗體字形（Tinos 全部有；中文看 boldCjk；表情符號沒有粗體）。 */
export function hasBoldGlyph(cp: number): boolean {
  const font = fontForCodePoint(cp);
  if (font === 'Tinos') return true;
  if (font === 'NotoEmoji') return false;
  return BOLD_CJK.has(cp);
}

export interface FontRun {
  text: string;
  font: PdfFontFamily;
  bold: boolean;
}

/**
 * 把一段文字切成同字型、同粗細的片段。bold 是「想要粗體」：沒有粗體字形的字自動用一般粗細。
 * 換行字元原樣保留在片段裡（pdfmake 會處理）。
 *
 * 半形空白一律用 Tinos（和其他字元一樣依 metrics.json 的範圍）：中文子集沒有 U+0020 的字形，
 * 「第 1 頁」的空白如果跟著前面的「第」用中文字型，PDF 上會變成方框。
 * 只有換行這類控制字元（不畫字形）跟著前一段，避免為了它多切一段。
 */
export function splitFontRuns(text: string, bold = false): FontRun[] {
  const runs: FontRun[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const prev = runs.at(-1);
    const control = cp < 0x20 && prev !== undefined;
    const font = control ? prev.font : fontForCodePoint(cp);
    const runBold = bold && (control ? prev.bold : hasBoldGlyph(cp));
    if (prev && prev.font === font && prev.bold === runBold) prev.text += ch;
    else runs.push({ text: ch, font, bold: runBold });
  }
  return runs;
}

/**
 * 估計文字在一般粗細下的寬度（pt）：Tinos 用實際字寬表，中文與表情符號以 1 em 計。
 * 用途是決定選項要排成一列四個、兩個還是一個一行（設計文件 §5.5），不必精確到小數，但要和實際排版一致地偏保守。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let perMille = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (fontForCodePoint(cp) === 'Tinos') perMille += ADVANCE[String(cp)] ?? 500;
    else perMille += 1000;
  }
  return (perMille / 1000) * fontSize;
}

/** 行高的字型比例（所有子集都已調成相同的上下緣，見 fonts/README.md）。 */
export const FONT_LINE_METRICS = metrics.lineMetrics;
