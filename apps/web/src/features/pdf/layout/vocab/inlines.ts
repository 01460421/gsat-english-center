/**
 * 講義版面共用的小片段：不換行空白與不拆開的一段、級別標籤、例句（目標字粗體）、Tatoeba 標示、分隔線。
 * 所有含中文的片段都經過 plainInline（splitFontRuns），不直接寫 { text: '…' }（mock-exam-pdf §10 R4）。
 */
import type { PdfContent, PdfInline, PdfNode } from '../../engine/docTypes';
import type { HandoutExample } from '../../vocabTypes';
import { plainInline } from '../richInline';
import { COLOR, VOCAB_CONTENT_WIDTH } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

/** 不換行空白（U+00A0）。 */
export const NBSP = '\u00A0';

/**
 * 以不換行空白開頭或結尾的片段要加的屬性。pdfmake 0.3.11 把片段頭尾的空白（它用 \s 判斷，也含不換行空白）當成「行首行尾可以截掉」的寬度；
 * 量「黏在一起、中間不能換行」的幾個片段放不放得下時（Line.hasEnoughSpaceForInline），每一段的尾端空白都被扣掉，整串少算了這些寬度，
 * 放不下時就超出右邊界（實測最多 5.3 pt）。保留頭尾空白，寬度才算得對。
 */
export const KEEP_SPACES = { preserveLeadingSpaces: true, preserveTrailingSpaces: true } as const;

/** 只有不換行空白的片段（黏住前後兩段，例如「及物」和後面的釋義）。 */
export function nbsp(count = 1, extra: Partial<PdfInline> = {}): PdfInline {
  return { text: NBSP.repeat(count), font: 'Tinos', ...KEEP_SPACES, ...extra };
}

/**
 * 不拆開的一段（「Tatoeba #315866 by CK」「→ 講義 #12」「同義 」）：段內的空白換成不換行空白，每個片段都不在中間換行。
 * 前面接一般空白（可以換行），整段放不下時就整段換到下一行，不會從中間斷開，也不會超出右邊界（§4.4「放不下就換到下一行」）。
 */
export function unitInlines(text: string, options: { bold?: boolean } = {}): PdfInline[] {
  return plainInline(text.replace(/ /gu, NBSP), options).map((r) => ({ ...r, noWrap: true, ...KEEP_SPACES }));
}

/** 可以換行的間隔（一般空白）：放在「不拆開的一段」前面。 */
export function breakableGap(count = 2, extra: Partial<PdfInline> = {}): PdfInline {
  return { text: ' '.repeat(count), font: 'Tinos', ...extra };
}

/** 行內的級別標記「L4」：灰色小字（不用底色：pdfmake 的底色會塗滿整行高，看起來像一條灰槓）。 */
export function levelTag(level: number, fontSize = 7.5): PdfInline {
  return { text: VOCAB_PDF_TEXT.levelTag(level), font: 'Tinos', bold: true, fontSize, color: COLOR.muted };
}

/** 字頭行右側的級別標籤：細框小方塊（單格表格）。 */
export function levelBox(level: number): PdfNode {
  return {
    table: { body: [[{ text: VOCAB_PDF_TEXT.levelTag(level), font: 'Tinos', bold: true, fontSize: 7.5, lineHeight: 1 }]] },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => '#666666',
      vLineColor: () => '#666666',
      paddingLeft: () => 2.5,
      paddingRight: () => 2.5,
      paddingTop: () => 0.5,
      paddingBottom: () => 0,
    },
  };
}

/** 例句的英文：目標字（含變化形）粗體。 */
export function exampleEnInlines(example: Pick<HandoutExample, 'parts'>): PdfInline[] {
  return example.parts.flatMap((p) => plainInline(p.text, { bold: p.target }));
}

/**
 * Tatoeba 標示：「Tatoeba #315866 by CK · 中文 Tatoeba #2411906 by User5120 · 中文經轉換為台灣繁體」。
 * link：講義版與答案頁加連結；題目上不加（點了就看得到原句）。
 */
export function attributionInlines(
  attr: { en: string; enUrl: string; zh?: string | null; zhUrl?: string | null; zhConverted?: boolean },
  options: { link: boolean },
): PdfInline[] {
  // 每個標示是不拆開的一段（「Tatoeba #13789360 by frpzzd」不會斷成兩行）；標示之間的「 · 」可以換行。
  const out: PdfInline[] = unitInlines(attr.en).map((r) => (options.link ? { ...r, link: attr.enUrl } : r));
  if (attr.zh) {
    out.push(...plainInline(VOCAB_PDF_TEXT.attributionSeparator));
    out.push(...unitInlines(attr.zh).map((r) => (options.link && attr.zhUrl ? { ...r, link: attr.zhUrl } : r)));
  }
  if (attr.zhConverted) out.push(...plainInline(`${VOCAB_PDF_TEXT.attributionSeparator}${VOCAB_PDF_TEXT.zhConverted}`));
  return out;
}

/** 細分隔線（條目之間）。 */
export function hairline(margin: [number, number, number, number] = [0, 4, 0, 4], width = VOCAB_CONTENT_WIDTH): PdfNode {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 0.35, lineColor: COLOR.hairline }], margin };
}

/** 粗線（段落標題下方）。 */
export function rule(margin: [number, number, number, number] = [0, 2, 0, 6], width = VOCAB_CONTENT_WIDTH, lineWidth = 0.9): PdfNode {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: width, y2: 0, lineWidth, lineColor: COLOR.text }], margin };
}

/** 一組行內片段之間插入分隔片段。 */
export function joinInlines(groups: PdfInline[][], separator: PdfInline[]): PdfInline[] {
  const out: PdfInline[] = [];
  groups.forEach((g, i) => {
    if (i > 0) out.push(...separator.map((s) => ({ ...s })));
    out.push(...g);
  });
  return out;
}

export function isNode(c: PdfContent): c is PdfNode {
  return typeof c === 'object' && c !== null && !Array.isArray(c);
}
