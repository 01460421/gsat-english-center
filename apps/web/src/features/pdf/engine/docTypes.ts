/**
 * pdfmake 文件定義（document definition）的型別：本專案用到的子集。
 * 欄位意義見 pdfmake 文件（https://pdfmake.github.io/docs/0.3/）；要用新的屬性就在這裡補上，不要改成 any。
 */
import type { PdfFontFamily } from '../fontRuns';

export type PdfAlignment = 'left' | 'right' | 'center' | 'justify';
/** [左, 上, 右, 下] 或 [水平, 垂直] 或單一數字（pt）。 */
export type PdfMargin = number | [number, number] | [number, number, number, number];

export interface PdfTextStyle {
  font?: PdfFontFamily;
  fontSize?: number;
  bold?: boolean;
  italics?: boolean;
  /** 行高倍數（乘在字型的上下緣高度上；所有子集都是 1.107 em）。 */
  lineHeight?: number;
  alignment?: PdfAlignment;
  characterSpacing?: number;
  color?: string;
  background?: string;
  decoration?: 'underline' | 'lineThrough' | 'overline';
  decorationStyle?: 'dashed' | 'dotted' | 'double' | 'wavy';
  decorationThickness?: number;
  /** 段落第一行縮排（pt）。 */
  leadingIndent?: number;
  preserveLeadingSpaces?: boolean;
  preserveTrailingSpaces?: boolean;
  noWrap?: boolean;
  sup?: boolean;
  sub?: boolean;
}

/** 行內片段：一段文字（同一個字型）或巢狀片段。 */
export interface PdfInline extends PdfTextStyle {
  text: string | PdfInline[];
  link?: string;
}

interface PdfNodeBase extends PdfTextStyle {
  margin?: PdfMargin;
  /** 整塊不跨頁（題幹＋選項、短文＋第一題）。 */
  unbreakable?: boolean;
  pageBreak?: 'before' | 'after';
  /** pageBreakBefore 回呼用來辨識節點（例如「標題不能是頁面最後一行」）。 */
  headlineLevel?: number;
  id?: string;
  style?: string | string[];
  /** 在 columns 裡的欄寬；在表格儲存格裡沒有作用。 */
  width?: number | string;
  /** 相對目前位置偏移、不佔版面（頁尾把頁碼畫到頁首區用）。 */
  relativePosition?: { x: number; y: number };
  absolutePosition?: { x: number; y: number };
  link?: string;
  /** 表格儲存格：底色、跨欄、各邊框線。 */
  fillColor?: string;
  colSpan?: number;
  rowSpan?: number;
  border?: [boolean, boolean, boolean, boolean];
}

export interface PdfTableNodeRef {
  table: { body: unknown[][]; widths?: unknown[] };
}

export interface PdfTableLayout {
  hLineWidth?: (i: number, node: PdfTableNodeRef) => number;
  vLineWidth?: (i: number, node: PdfTableNodeRef) => number;
  hLineColor?: (i: number, node: PdfTableNodeRef) => string;
  vLineColor?: (i: number, node: PdfTableNodeRef) => string;
  hLineStyle?: (i: number, node: PdfTableNodeRef) => { dash: { length: number; space?: number } } | null;
  vLineStyle?: (i: number, node: PdfTableNodeRef) => { dash: { length: number; space?: number } } | null;
  paddingLeft?: (i: number, node: PdfTableNodeRef) => number;
  paddingRight?: (i: number, node: PdfTableNodeRef) => number;
  paddingTop?: (i: number, node: PdfTableNodeRef) => number;
  paddingBottom?: (i: number, node: PdfTableNodeRef) => number;
  fillColor?: (rowIndex: number, node: PdfTableNodeRef) => string | null;
}

export type PdfCanvasElement =
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; lineWidth?: number; lineColor?: string; dash?: { length: number; space?: number } }
  | { type: 'rect'; x: number; y: number; w: number; h: number; r?: number; lineWidth?: number; lineColor?: string; color?: string }
  | { type: 'ellipse'; x: number; y: number; r1: number; r2: number; lineWidth?: number; lineColor?: string; color?: string };

export type PdfNode =
  | (PdfNodeBase & { text: string | (string | PdfInline)[] })
  | (PdfNodeBase & { stack: PdfContent[] })
  | (PdfNodeBase & { columns: PdfContent[]; columnGap?: number })
  | (PdfNodeBase & {
      table: {
        body: PdfContent[][];
        widths?: (number | string)[];
        heights?: number | number[] | ((row: number) => number);
        headerRows?: number;
        dontBreakRows?: boolean;
        keepWithHeaderRows?: number;
      };
      layout?: PdfTableLayout | 'noBorders' | 'headerLineOnly' | 'lightHorizontalLines';
    })
  | (PdfNodeBase & { canvas: PdfCanvasElement[] })
  | (PdfNodeBase & { ul: PdfContent[] })
  | (PdfNodeBase & { ol: PdfContent[] })
  | (PdfNodeBase & { qr: string; fit?: number; eccLevel?: 'L' | 'M' | 'Q' | 'H' });

export type PdfContent = string | PdfNode | PdfContent[];

/** 頁首、頁尾：pdfmake 每一頁呼叫一次（頁碼從 1 起、整份 PDF 的總頁數、頁面尺寸）。 */
export type PdfDynamicContent = (currentPage: number, pageCount: number, pageSize: { width: number; height: number }) => PdfContent | null;

/**
 * 分節（pdfmake 0.3 的 section）：一定從新的一頁開始，可以有自己的頁首頁尾。
 * 封面、題本、答題卷、答案各是一節，頁碼才能分開算（題本「第 1 頁／共 11 頁」不含封面與答題卷）。
 * 只能放在 content 的最上層。
 */
export interface PdfSection {
  section: PdfContent[];
  header?: PdfDynamicContent | null;
  footer?: PdfDynamicContent | null;
}

/** pageBreakBefore 回呼拿到的節點資訊（pdfmake 的 nodeInfo，只列用得到的欄位）。 */
export interface PdfNodeInfo {
  id?: string;
  headlineLevel?: number;
  pageNumbers: number[];
  pages: number;
  startPosition: { pageNumber: number; top: number; left: number; verticalRatio: number };
  stack?: boolean;
}

export interface PdfDocDefinition {
  pageSize: 'A4';
  pageMargins: [number, number, number, number];
  info?: { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; producer?: string };
  defaultStyle?: PdfTextStyle;
  styles?: Record<string, PdfTextStyle & { margin?: PdfMargin }>;
  header?: PdfDynamicContent;
  footer?: PdfDynamicContent;
  pageBreakBefore?: (
    current: PdfNodeInfo,
    helpers: { getFollowingNodesOnPage(): PdfNodeInfo[]; getNodesOnNextPage(): PdfNodeInfo[]; getPreviousNodesOnPage(): PdfNodeInfo[] },
  ) => boolean;
  content: (PdfContent | PdfSection)[];
  /** PDF 版本；1.3 是 pdfmake 預設。 */
  version?: '1.3' | '1.4' | '1.5' | '1.6' | '1.7';
  language?: string;
}
