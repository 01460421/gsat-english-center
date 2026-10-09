/**
 * 版面估計：文字寬度、換行後的行數、區塊高度。
 *
 * pdfmake 要排完才知道真正的位置，但有些決定要在產生文件定義時就做：
 *   - 選項排成一列四個、兩欄還是一個一行（設計文件 §5.5）；
 *   - 哪些內容包成「不跨頁」的區塊（§5.11）：包得太大，超過一頁時 pdfmake 會硬切，所以先估高度再決定。
 * 寬度用 Tinos 的實際字寬表（fonts/metrics.json），中文與表情符號以 1 em 計；換行用和 pdfmake 相同的貪婪法
 * （英文以空白斷詞、中文每個字都可以斷），所以估計的行數和實際排版通常一致，差異只在少數斷字規則。
 */
import { estimateTextWidth } from '../fontRuns';
import { lineHeightPt } from './metrics';

const NBSP = ' ';
/** 空格記號在 PDF 上的寬度和 blankInline() 一樣：前後各兩個不換行空白。 */
const BLANK = /\[\[([0-9]+[A-Z]?)\]\]/g;
const MARK = /<\/?[ub]>/g;
/** 可以在任一字前後換行的字元（中日韓文字、全形標點）。 */
const CJK_CHAR = /[⺀-鿿豈-﫿︰-﹏＀-￯　-〿]/u;

/** 試題文字 → 估計用的純文字（去掉 <u>／<b>，空格記號換成實際印出的寬度）。 */
export function plainForEstimate(text: string): string {
  return text.replace(MARK, '').replace(BLANK, (_m, label: string) => `${NBSP}${NBSP}${label}${NBSP}${NBSP}`);
}

/** 估計單行文字寬度（pt）。 */
export function textWidth(text: string, fontSize: number): number {
  return estimateTextWidth(plainForEstimate(text), fontSize);
}

/** 把一行（不含換行字元）切成可斷行的單位：英文單字（含後面的空白）、單一中文字。 */
function breakUnits(line: string): { text: string; space: string }[] {
  const units: { text: string; space: string }[] = [];
  let word = '';
  const flush = (space: string) => {
    if (word !== '' || space !== '') units.push({ text: word, space });
    word = '';
  };
  for (const ch of line) {
    if (ch === ' ') {
      flush(' ');
    } else if (CJK_CHAR.test(ch)) {
      flush('');
      units.push({ text: ch, space: '' });
    } else {
      word += ch;
    }
  }
  flush('');
  return units;
}

/**
 * 一段文字排在 width 寬的欄位裡會有幾行。text 可以含 "\n"（每一行各自換行）與試題標記。
 * firstLineIndent：首行縮排（選文的 leadingIndent）。
 */
export function estimateLineCount(text: string, width: number, fontSize: number, firstLineIndent = 0): number {
  let lines = 0;
  for (const raw of plainForEstimate(text).split('\n')) {
    let used = firstLineIndent;
    let count = 1;
    for (const unit of breakUnits(raw)) {
      const w = estimateTextWidth(unit.text, fontSize);
      const space = unit.space === '' ? 0 : estimateTextWidth(unit.space, fontSize);
      if (used > 0 && used + w > width) {
        count += 1;
        used = 0;
      }
      used += w + space;
    }
    lines += count;
  }
  return lines;
}

/** 一段文字的估計高度（pt）。 */
export function estimateTextHeight(text: string, width: number, fontSize: number, lineHeight: number, firstLineIndent = 0): number {
  return estimateLineCount(text, width, fontSize, firstLineIndent) * lineHeightPt(fontSize, lineHeight);
}
