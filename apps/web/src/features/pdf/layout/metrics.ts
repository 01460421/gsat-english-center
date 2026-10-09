/**
 * 版面尺寸（pt）。數字量自 115 學測題本（data/raw/ceec/gsat/115/paper-1.pdf，`pdftotext -bbox-layout`），
 * 並對照 111 學測、110 指考題本：
 *   - A4；內文左緣 63.8、右緣 531.8（寬 468）；內文頂端約 85、底端約 783；頁首兩行在 42–71、頁碼「- N -」在 787。
 *   - 英文是 Times New Roman **11 pt**（量字寬：「campfire」39.1 pt＝11 pt；設計文件 §5.1 寫的 12 pt 是筆誤），
 *     選文行距 16.4 pt、段距約 4 pt；題目與選項行距 18 pt、題與題之間約 3 pt。
 *   - 說明框與中譯英題目的中文約 12 pt；部分／大題標題約 14 pt 粗體、字距加寬。
 *   - 選項的定位點（自內文左緣起）：18.5、138、252、366（一列四個）；兩欄時 18.5、252。
 * Tinos 與 Times New Roman 字寬相同，所以用同樣的字級與版心寬度時，英文的換行位置幾乎和題本一致。
 */
import { FONT_LINE_METRICS } from '../fontRuns';

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** pdfmake 的 pageMargins：[左, 上, 右, 下]。下邊界留給兩行頁尾（頁碼＋出處）。 */
export const PAGE_MARGINS: [number, number, number, number] = [64, 84, 63, 64];
export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGINS[0] - PAGE_MARGINS[2];
export const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_MARGINS[1] - PAGE_MARGINS[3];
/** 內文底端（pt，自頁面上緣起算）。 */
export const CONTENT_BOTTOM = PAGE_HEIGHT - PAGE_MARGINS[3];

/** 所有子集的上下緣都統一成 0.891／0.216 em（fonts/README.md），一行的字框高度＝字級 × 1.107。 */
export const EM_BOX = FONT_LINE_METRICS.ascent + FONT_LINE_METRICS.descent;

export const SIZE = {
  /** 英文內文、題目、選項。 */
  body: 11,
  /** 說明框、中譯英題目、作文提示（中文為主的段落）。 */
  cjk: 12,
  /** 部分與大題標題。 */
  heading: 14,
  /** 題組標示「第 11 至 15 題為題組」。 */
  groupLabel: 11,
  /** 頁首。 */
  header: 11,
  /** 頁首中間的「重新排版・非官方」。 */
  headerCenter: 9.5,
  /** 頁尾的出處與非官方聲明。 */
  attribution: 7.5,
  /** 圖片描述框。 */
  figureTitle: 10.5,
  figureBody: 10,
  figureNote: 8,
} as const;

/** 行高倍數（pdfmake 的 lineHeight，乘在字框高度上）。 */
export const LINE = {
  /** 選文：11 × 1.107 × 1.35 ≈ 16.4 pt。 */
  passage: 1.35,
  /** 題目與選項：11 × 1.107 × 1.48 ≈ 18.0 pt。 */
  question: 1.48,
  /** 說明框：12 × 1.107 × 1.2 ≈ 15.9 pt。 */
  instructions: 1.2,
  figure: 1.25,
  heading: 1.15,
} as const;

/** 選文段落之間、題與題之間、題組之間的距離。 */
export const GAP = {
  paragraph: 4,
  question: 3,
  group: 6,
  section: 10,
} as const;

/** 首行縮排（題本約兩個字寬，24 pt）。 */
export const PARAGRAPH_INDENT = 24;

/** 題號欄寬：題幹與選項都從這裡開始（題本 81.8 − 63.8 ≈ 18）。 */
export const NUMBER_COLUMN = 18;

/** 題號欄右邊的選項區寬度。 */
export const OPTION_AREA_WIDTH = CONTENT_WIDTH - NUMBER_COLUMN;

/**
 * 選項的欄寬（自題號欄右緣起）。一列四個時定位點落在內文左緣 18、138、252、366（同題本），
 * 兩欄時第二欄從 252 開始。
 */
export const OPTION_COLUMNS = {
  4: [120, 114, 114, OPTION_AREA_WIDTH - 348],
  2: [234, OPTION_AREA_WIDTH - 234],
} as const;

/** 選項文字和下一欄之間至少要留的空白（估計寬度有誤差，寧可保守）。 */
export const OPTION_GAP = 6;

/** 一行的高度（pt）。 */
export function lineHeightPt(fontSize: number, lineHeight: number): number {
  return fontSize * EM_BOX * lineHeight;
}
