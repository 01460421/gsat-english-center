/**
 * 句意填空的題目（docs/design/vocab-handout.md §4.4）：
 *   「12. Only a__________ may watch that film.　Tatoeba #49532 by CK」
 * 題號懸掛；英文 11 pt、行高較寬（留寫字的空間）；Tatoeba 標示 7 pt 灰色接在句尾（放不下就整個換到下一行，不從中間斷開），題目上不加連結。
 * 中文提示（選用）在下一行，附中文句的標示。每題不跨頁。
 *
 * 空格（§4.4 的四種提示）：
 *   首字母              a__________   首字母＋固定長度底線（約 2.8 cm，不透露字數）
 *   首字母＋字母數      a _ _ _ _ _   每個字母一格；連字號、撇號照印
 *   只有字母數          _ _ _ _ _ _
 *   都沒有              ____________
 * 空格用不換行空白組成（同 blankInline 的做法），換行時不會被切開。
 */
import type { PdfContent, PdfInline } from '../../engine/docTypes';
import { estimateTextWidth } from '../../fontRuns';
import type { ClozeBlank, ClozeItem, VocabHandoutLayoutOptions } from '../../vocabTypes';
import { maybeUnbreakable, type Block } from '../blocks';
import { estimateTextHeight } from '../estimate';
import { plainInline } from '../richInline';
import { attributionInlines, breakableGap, rule } from './inlines';
import { CLOZE_NO_WIDTH, COLOR, VLINE, VOCAB_CONTENT_WIDTH, VSIZE, lineHeightPt } from './metrics';

const NBSP = ' ';
/** 固定長度空格的寬度（pt，約 2.8 cm）。 */
export const BLANK_WIDTH = 80;
const TEXT_WIDTH = VOCAB_CONTENT_WIDTH - CLOZE_NO_WIDTH;

/** 空格的行內片段。 */
export function blankInlines(blank: ClozeBlank, fontSize: number = VSIZE.clozeBlank): PdfInline[] {
  const base = { font: 'Tinos' as const, fontSize, preserveLeadingSpaces: true, preserveTrailingSpaces: true, noWrap: true };
  if (blank.cells === null) {
    const leadWidth = blank.lead ? estimateTextWidth(blank.lead, fontSize) : 0;
    const count = Math.max(8, Math.round((BLANK_WIDTH - leadWidth) / estimateTextWidth(NBSP, fontSize)));
    return [{ text: `${NBSP}${blank.lead}${NBSP.repeat(count)}`, ...base, decoration: 'underline' }];
  }
  const cells = blank.cells.map((c) => (c === '_' ? '_' : c)).join(NBSP);
  return [{ text: `${NBSP}${blank.lead}${blank.lead ? NBSP : ''}${cells}${NBSP}`, ...base, characterSpacing: 0.6 }];
}

/** 空格的估計寬度（估高度用）。 */
function blankWidthText(blank: ClozeBlank): string {
  return blank.cells === null ? 'x'.repeat(16) : `${blank.lead} ${blank.cells.join(' ')}`;
}

/** 段落標題（「句意填空」「一、句意填空」「資料來源與授權」）：粗體＋粗線；不能落在頁底（keepWithNext）。 */
export function sectionHeadingBlock(text: string, options: { id?: string | undefined; marginTop?: number } = {}): Block {
  const top = options.marginTop ?? 0;
  return {
    node: {
      // id 放在文字節點上：pdfmake 的 pageReference 只認得有位置紀錄的文字節點（stack 沒有）。
      stack: [{ text: plainInline(text, { bold: true }), fontSize: VSIZE.sectionTitle, lineHeight: 1.1, ...(options.id ? { id: options.id } : {}) }, rule([0, 3, 0, 6])],
      margin: [0, top, 0, 0],
    },
    height: top + lineHeightPt(VSIZE.sectionTitle, 1.1) + 10,
    keepWithNext: true,
  };
}

/** 說明（灰色小字）。 */
export function instructionsBlock(lines: readonly string[]): Block {
  const text = lines.join('');
  return {
    node: { text: plainInline(text), fontSize: VSIZE.instructions, color: COLOR.muted, lineHeight: 1.35, margin: [0, 0, 0, 8] },
    height: estimateTextHeight(text, VOCAB_CONTENT_WIDTH, VSIZE.instructions, 1.35) + 8,
    keepWithNext: true,
  };
}

/** Tinos 的 ascender（em 的比例）：同一行有較大的字時，基線往下移 (大字 − 小字) × ascender。 */
const TINOS_ASCENDER = 0.891;

/** 題號欄＋內容（懸掛縮排）。top：題號往下移幾 pt（和第一行的基線對齊）。 */
export function numbered(no: string, body: PdfContent[], width = CLOZE_NO_WIDTH, fontSize: number = VSIZE.clozeNo, top = 0): PdfContent {
  return {
    columns: [
      { width, text: no, font: 'Tinos', fontSize, lineHeight: VLINE.cloze, ...(top > 0 ? { margin: [0, top, 0, 0] as [number, number, number, number] } : {}) },
      { width: '*', stack: body },
    ],
    columnGap: 0,
  };
}

export function clozeItemBlock(item: ClozeItem, options: Pick<VocabHandoutLayoutOptions, 'clozeZh'>): Block {
  const attr = attributionInlines({ en: item.enAttribution, enUrl: item.enUrl }, { link: false }).map((r) => ({ ...r, fontSize: VSIZE.attribution, color: COLOR.faint }));
  // 標示前面是可以換行的空白：句尾放不下時整個標示換到下一行（不黏著句子的最後一個字，也不超出右邊界）。
  const sentence: PdfInline[] = [...plainInline(item.before), ...blankInlines(item.blank), ...plainInline(item.after), breakableGap(3), ...attr];
  const body: PdfContent[] = [{ text: sentence, fontSize: VSIZE.clozeText, lineHeight: VLINE.cloze }];
  let height = estimateTextHeight(`${item.before}${blankWidthText(item.blank)}${item.after}   ${'x'.repeat(Math.ceil(item.enAttribution.length * 0.65))}`, TEXT_WIDTH, VSIZE.clozeText, VLINE.cloze);
  if (options.clozeZh) {
    const zhAttr = attributionInlines({ en: item.zhAttribution, enUrl: item.zhUrl, zhConverted: item.zhConverted }, { link: false }).map((r) => ({ ...r, fontSize: VSIZE.attribution, color: COLOR.faint }));
    body.push({ text: [...plainInline(item.zh).map((r) => ({ ...r, color: '#333333' })), breakableGap(2), ...zhAttr], fontSize: VSIZE.exampleZh, lineHeight: 1.3, margin: [0, 0, 0, 1] });
    height += estimateTextHeight(`${item.zh}  ${item.zhAttribution}`, TEXT_WIDTH, VSIZE.exampleZh, 1.3) + 1;
  }
  // 空格的字比句子大一號：空格在第一行時，第一行的基線比題號低一點，題號跟著往下移。
  const blankOnFirstLine = estimateTextWidth(`${item.before}${blankWidthText(item.blank)}`, VSIZE.clozeText) < TEXT_WIDTH;
  const shift = blankOnFirstLine ? (VSIZE.clozeBlank - VSIZE.clozeText) * TINOS_ASCENDER : 0;
  const node = { stack: [numbered(`${item.no}.`, body, CLOZE_NO_WIDTH, VSIZE.clozeNo, shift)], margin: [0, 0, 0, 5] as [number, number, number, number] };
  return { node: maybeUnbreakable(node, height + 5), height: height + 5 };
}

export function clozeBlocks(items: readonly ClozeItem[], options: Pick<VocabHandoutLayoutOptions, 'clozeZh'>): Block[] {
  return items.map((item) => clozeItemBlock(item, options));
}
