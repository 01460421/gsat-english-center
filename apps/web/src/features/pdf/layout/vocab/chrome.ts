/**
 * 單字講義的頁首與頁尾（docs/design/vocab-handout.md §3.2）。
 *
 *   - 頁首：左側印類型與標題（「單字講義・Level 4 第 201–300 字」），右側印「第 3 頁／共 12 頁」；第 1 頁有標題區，只印頁碼。
 *     答案頁左側印「答案・講義代號 7Q2MK」，頁碼另起（「答案　第 1 頁／共 2 頁」），拆下後不影響前面的頁碼。
 *   - 頁尾（每一頁）：第 1 行詞彙表的出處（credits.wordlist，照抄不改寫），第 2 行起是這份講義實際用到的其他來源摘要、
 *     非營利使用與講義代號（footerLines：放不下時在項目之間分行）。
 *   - 雙面列印補的空白頁：中間印「（本頁空白）」、照常有頁尾，不算頁碼。
 *
 * 頁碼的做法同題本（layout/chrome.ts）：pdfmake 每排一次版，先依頁序呼叫所有頁首、再呼叫所有頁尾（版本鎖定 0.3.11），
 * 所以頁首呼叫時記下「這一頁是哪一段的第幾頁」，到頁尾時每段的總頁數都已知道；「共 N 頁」由頁尾函式用 relativePosition 畫到頁首區。
 * 第 1 頁的頁首被呼叫時清空紀錄，重排幾次結果都一樣。
 */
import type { PdfContent, PdfDynamicContent } from '../../engine/docTypes';
import { estimateTextWidth } from '../../fontRuns';
import type { VocabHandoutPdfData } from '../../vocabTypes';
import { plainInline } from '../richInline';
import { COLOR, FOOTER_TOP, HEADER_TOP, PAGE_HEIGHT, VOCAB_CONTENT_WIDTH, VOCAB_MARGINS, VSIZE } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

/** 頁尾第 2 行起：來源摘要（strings.ts 的 footerParts）與講義代號，依版心寬度在項目之間分行。 */
export function footerLines(data: Pick<VocabHandoutPdfData, 'code' | 'credits'>): string[] {
  const parts = [...VOCAB_PDF_TEXT.footerParts(data.credits), VOCAB_PDF_TEXT.codeLabel(data.code)];
  const lines: string[] = [];
  for (const part of parts) {
    const last = lines.at(-1);
    const joined = last === undefined ? part : `${last}・${part}`;
    if (last !== undefined && estimateTextWidth(joined, VSIZE.footer) <= VOCAB_CONTENT_WIDTH - 6) lines[lines.length - 1] = joined;
    else lines.push(part);
  }
  return lines;
}

/** 段：講義本體（標題區、條目、練習、資料來源，連續編頁）與答案（另外編頁）。 */
export type VocabSegment = 'main' | 'key';

export class VocabPageChrome {
  private pages: Record<VocabSegment, number[]> = { main: [], key: [] };

  constructor(
    private readonly data: Pick<VocabHandoutPdfData, 'code' | 'headerTitle' | 'credits'>,
    private readonly blankPages: ReadonlySet<number> = new Set(),
  ) {}

  private record(segment: VocabSegment, page: number): number {
    if (page === 1) this.pages = { main: [], key: [] };
    if (this.blankPages.has(page)) return 0;
    const list = this.pages[segment];
    if (!list.includes(page)) list.push(page);
    return list.indexOf(page) + 1;
  }

  private local(segment: VocabSegment, page: number): { n: number; total: number } {
    const list = this.pages[segment];
    const index = list.indexOf(page);
    return { n: index < 0 ? list.length + 1 : index + 1, total: list.length };
  }

  header(segment: VocabSegment): PdfDynamicContent {
    return (page) => {
      const n = this.record(segment, page);
      if (this.blankPages.has(page) || (segment === 'main' && n === 1)) return null;
      const left = segment === 'key' ? `${VOCAB_PDF_TEXT.keyHeader(this.data.code)}${VOCAB_PDF_TEXT.wideSpace}${this.data.headerTitle}` : this.data.headerTitle;
      return {
        stack: [
          { text: plainInline(left), fontSize: VSIZE.header, color: COLOR.muted, margin: [0, 0, 120, 0] },
          { canvas: [{ type: 'line', x1: 0, y1: 3, x2: VOCAB_CONTENT_WIDTH, y2: 3, lineWidth: 0.5, lineColor: COLOR.rule }] },
        ],
        margin: [VOCAB_MARGINS[0], HEADER_TOP, VOCAB_MARGINS[2], 0],
      };
    };
  }

  /** 頁尾的出處：第 1 行詞彙表的出處；其他來源與講義代號依序用「・」接起來，放不下就在項目之間分行（不在字中間換行）。 */
  private sourcesLines(): PdfContent[] {
    const style = { fontSize: VSIZE.footer, color: COLOR.muted, alignment: 'center' as const, lineHeight: 1.15 };
    return [this.data.credits.wordlist, ...footerLines(this.data)].map((line) => ({ text: plainInline(line), ...style }));
  }

  footer(segment: VocabSegment): PdfDynamicContent {
    return (page) => {
      const margin: [number, number, number, number] = [VOCAB_MARGINS[0], FOOTER_TOP, VOCAB_MARGINS[2], 0];
      const rule: PdfContent = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: VOCAB_CONTENT_WIDTH, y2: 0, lineWidth: 0.4, lineColor: COLOR.rule }], margin: [0, 0, 0, 3] };
      const sources = this.sourcesLines();
      if (this.blankPages.has(page)) {
        const up = PAGE_HEIGHT / 2 - (PAGE_HEIGHT - VOCAB_MARGINS[3] + FOOTER_TOP);
        return {
          stack: [{ text: plainInline(VOCAB_PDF_TEXT.blankPage), fontSize: 10.5, color: COLOR.faint, alignment: 'center', relativePosition: { x: 0, y: up } }, rule, ...sources],
          margin,
        };
      }
      const { n, total } = this.local(segment, page);
      // 頁碼畫在頁首區的右側（頁尾區的起點往上移到頁首）。
      const up = HEADER_TOP - (PAGE_HEIGHT - VOCAB_MARGINS[3] + FOOTER_TOP);
      const pageText = segment === 'key' ? VOCAB_PDF_TEXT.keyPageOf(n, total) : VOCAB_PDF_TEXT.pageOf(n, total);
      return {
        stack: [{ text: plainInline(pageText), fontSize: VSIZE.header, alignment: 'right', color: COLOR.text, relativePosition: { x: 0, y: up } }, rule, ...sources],
        margin,
      };
    };
  }
}
