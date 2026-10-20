/**
 * 頁首與頁尾（設計文件 §5.2）。
 *
 * PDF 分成四節（封面、題本、答題卷、答案；pdfmake 的 section），各節自己編頁碼：題本「第 1 頁／共 11 頁」
 * 不算封面也不算答題卷，和題本一樣。pdfmake 的頁首頁尾函式只拿得到整份 PDF 的頁碼，所以這裡記下每一頁屬於哪一節：
 *   - pdfmake 每排一次版（tryLayoutDocument）就依頁序呼叫「所有頁的頁首」，接著才呼叫「所有頁的頁尾」
 *     （node_modules/pdfmake/js/LayoutBuilder.js addHeadersAndFooters；版本鎖定 0.3.11）；
 *   - 所以頁首呼叫時記錄「這一頁是本節第幾頁」，到頁尾時整份文件每一節的頁數都已知道，總頁數印在頁尾。
 *   - 題本的「第 N 頁／共 M 頁」在頁首區，由頁尾函式用 relativePosition 往上畫（不佔頁尾的版面）。
 * 第 1 頁的頁首被呼叫時清空紀錄（每次重排都從第 1 頁開始），重排幾次結果都一樣。
 * 頁碼與節的對應有測試把關：buildDocDefinition.test.ts 模擬 pdfmake 的呼叫順序；scripts/pdf-render-check.mjs 產生 66 份 PDF
 * 後用 pdftotext 分出各節的頁數（題本、答題卷、答案頁數不對就失敗）。
 *
 * 本站自組卷（docs/design/bank-mock.md §7.2、§7.7）：
 *   - 多兩節：解析（explanations）、資料來源（sources）；教師卷沒有封面與題本，第 1 頁是答案。
 *   - 頁首頁尾的文字換成本站自組卷的寫法（SITE_PAPER_TEXT），不寫試題來源機構。
 *   - 雙面列印時，答題卷、答案、解析落在雙數頁就先補一張空白頁（blocks.ts 的 KeepRegistry.duplexStart）。
 *     空白頁照常有頁首與頁尾出處，中間印「（本頁空白）」，不算進那一節的頁碼。
 */
import type { Exam } from '../../../data/exams';
import type { PdfContent, PdfDynamicContent } from '../engine/docTypes';
import type { SitePaperPdfMeta } from '../types';
import { NON_OFFICIAL_NOTICE, siteAttribution, sourceLine } from './attribution';
import { estimateTextWidth } from '../fontRuns';
import { CONTENT_WIDTH, PAGE_HEIGHT, PAGE_MARGINS, SIZE } from './metrics';
import { plainInline } from './richInline';
import { PDF_TEXT, SITE_PAPER_TEXT } from './strings';

/** 節：封面、題本、答題卷、答案；本站自組卷另有解析、資料來源。 */
export type PdfSegment = 'cover' | 'booklet' | 'sheet' | 'key' | 'explanations' | 'sources';

const SEGMENTS: readonly PdfSegment[] = ['cover', 'booklet', 'sheet', 'key', 'explanations', 'sources'];

function emptyPages(): Record<PdfSegment, number[]> {
  return Object.fromEntries(SEGMENTS.map((s) => [s, []])) as unknown as Record<PdfSegment, number[]>;
}

export interface PageChromeOptions {
  /** 本站自組卷：頁首頁尾換成本站的文字。 */
  site?: SitePaperPdfMeta | undefined;
  /** 雙面列印補的空白頁（整份 PDF 的頁碼，blocks.ts 的 KeepRegistry.blankPages）。 */
  blankPages?: ReadonlySet<number> | undefined;
}

/** 頁首文字的頂端（題本 41.9）。 */
const HEADER_TOP = 40;
/** 頁尾內容與內文底端的距離。 */
const FOOTER_TOP = 8;
const SIDE_WIDTH = 130;
const HEADER_LINE_HEIGHT = 1.2;

/** 出處＋非官方聲明（每一頁的頁尾都有，含封面）。 */
export function attributionLine(exam: Pick<Exam, 'exam' | 'year' | 'session' | 'title'>): string {
  return `${sourceLine(exam)}${PDF_TEXT.attributionSeparator}${NON_OFFICIAL_NOTICE}`;
}

export class PageChrome {
  private pages: Record<PdfSegment, number[]> = emptyPages();
  private readonly site: SitePaperPdfMeta | undefined;
  private readonly blankPages: ReadonlySet<number>;

  constructor(
    private readonly exam: Exam,
    options: PageChromeOptions = {},
  ) {
    this.site = options.site;
    this.blankPages = options.blankPages ?? new Set();
  }

  /**
   * 記下這一頁屬於哪一節。每次排版都從第 1 頁的頁首開始呼叫，所以第 1 頁清空紀錄
   * （歷屆卷的第 1 頁一定是封面；自組卷的教師卷第 1 頁是答案）。雙面列印補的空白頁不算頁碼。
   */
  private record(segment: PdfSegment, page: number): number {
    if (page === 1) this.pages = emptyPages();
    if (this.blankPages.has(page)) return 0;
    const list = this.pages[segment];
    if (!list.includes(page)) list.push(page);
    return list.indexOf(page) + 1;
  }

  /** 答題卷、答案、解析、資料來源的頁首左側文字。 */
  private segmentTitle(segment: Exclude<PdfSegment, 'cover' | 'booklet'>): string {
    const site = this.site;
    if (site) {
      if (segment === 'sheet') return SITE_PAPER_TEXT.sheetHeader(site.tierLabel);
      if (segment === 'key') return SITE_PAPER_TEXT.keyHeader(site.tierLabel);
      if (segment === 'explanations') return SITE_PAPER_TEXT.explanationsHeader(site.tierLabel);
      return SITE_PAPER_TEXT.sourcesHeader(site.tierLabel);
    }
    return segment === 'sheet' ? PDF_TEXT.sheetHeader(this.exam) : PDF_TEXT.keyHeader(this.exam);
  }

  private local(segment: PdfSegment, page: number): { n: number; total: number } {
    const list = this.pages[segment];
    const index = list.indexOf(page);
    return { n: index < 0 ? list.length + 1 : index + 1, total: list.length };
  }

  header(segment: PdfSegment): PdfDynamicContent {
    return (page) => {
      const n = this.record(segment, page);
      if (segment === 'cover') return null;
      if (segment === 'booklet') return this.bookletHeader(Math.max(n, 1));
      return {
        columns: [
          { width: '*', text: plainInline(this.segmentTitle(segment)), fontSize: SIZE.header },
          { width: SIDE_WIDTH, text: plainInline(PDF_TEXT.subject), fontSize: SIZE.header, alignment: 'right' },
        ],
        margin: [PAGE_MARGINS[0], HEADER_TOP, PAGE_MARGINS[2], 0],
      };
    };
  }

  /** 題本頁首：一側是卷別（「115年學測／英文考科」），中間是「重新排版・非官方」；頁碼在另一側，由頁尾畫。 */
  private bookletHeader(n: number): PdfContent {
    const odd = n % 2 === 1;
    const [line1, line2] = this.site ? SITE_PAPER_TEXT.examShort(this.site.tierLabel) : PDF_TEXT.examShort(this.exam);
    const examBlock = {
      width: SIDE_WIDTH,
      stack: [{ text: plainInline(line1) }, { text: plainInline(line2) }],
      fontSize: SIZE.header,
      lineHeight: HEADER_LINE_HEIGHT,
      alignment: odd ? ('right' as const) : ('left' as const),
    };
    const empty = { width: SIDE_WIDTH, text: '' };
    return {
      columns: [
        odd ? empty : examBlock,
        { width: '*', text: plainInline(this.site ? SITE_PAPER_TEXT.headerCenter : PDF_TEXT.headerCenter), fontSize: SIZE.headerCenter, alignment: 'center', color: '#333333', margin: [0, 3, 0, 0] },
        odd ? examBlock : empty,
      ],
      margin: [PAGE_MARGINS[0], HEADER_TOP, PAGE_MARGINS[2], 0],
    };
  }

  /**
   * 頁尾的出處＋非官方聲明：一行放得下就一行（「出處｜聲明」）；參考試卷的出處較長，放不下就分兩行，
   * 免得 pdfmake 在字中間換行（「非官方文／件」）。
   */
  private attribution(): PdfContent {
    const style = { fontSize: SIZE.attribution, color: '#444444', alignment: 'center' as const, lineHeight: 1.15 };
    const { source, notice } = this.site ? siteAttribution(this.site) : { source: sourceLine(this.exam), notice: NON_OFFICIAL_NOTICE };
    const line = `${source}${PDF_TEXT.attributionSeparator}${notice}`;
    if (estimateTextWidth(line, SIZE.attribution) <= CONTENT_WIDTH - 8) return { text: plainInline(line), ...style, margin: [0, 3, 0, 0] };
    return {
      stack: [{ text: plainInline(source) }, { text: plainInline(notice) }],
      ...style,
      margin: [0, 2, 0, 0],
    };
  }

  /** 雙面列印補的空白頁：頁面中間印「（本頁空白）」（從頁尾區往上畫，不佔版面），下面照常印出處。 */
  private blankFooter(attribution: PdfContent, margin: [number, number, number, number]): PdfContent {
    const up = PAGE_HEIGHT / 2 - (PAGE_HEIGHT - PAGE_MARGINS[3] + FOOTER_TOP);
    return {
      stack: [{ text: plainInline(SITE_PAPER_TEXT.blankPage), fontSize: 10.5, color: '#777777', alignment: 'center', relativePosition: { x: 0, y: up } }, attribution],
      margin,
    };
  }

  footer(segment: PdfSegment): PdfDynamicContent {
    return (page) => {
      const attribution = this.attribution();
      const margin: [number, number, number, number] = [PAGE_MARGINS[0], FOOTER_TOP, PAGE_MARGINS[2], 0];
      if (segment === 'cover') return { stack: [attribution], margin };
      if (this.blankPages.has(page)) return this.blankFooter(attribution, margin);
      const { n, total } = this.local(segment, page);
      if (segment === 'booklet') {
        const odd = n % 2 === 1;
        const [first, second] = PDF_TEXT.pageOf(n, total);
        // 頁尾區的起點（內文底端＋FOOTER_TOP）往上移到頁首區。
        const up = HEADER_TOP - (PAGE_HEIGHT - PAGE_MARGINS[3] + FOOTER_TOP);
        return {
          stack: [
            {
              stack: [{ text: plainInline(first) }, { text: plainInline(second) }],
              fontSize: SIZE.header,
              lineHeight: HEADER_LINE_HEIGHT,
              alignment: odd ? 'left' : 'right',
              relativePosition: { x: 0, y: up },
            },
            { text: `- ${n} -`, fontSize: 10.5, alignment: odd ? 'left' : 'right' },
            attribution,
          ],
          margin,
        };
      }
      return {
        stack: [{ text: plainInline(PDF_TEXT.pageOfShort(n, total)), fontSize: 9.5, alignment: 'center' }, attribution],
        margin,
      };
    };
  }
}
