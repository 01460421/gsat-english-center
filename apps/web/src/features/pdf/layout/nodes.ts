/**
 * 題本共用的節點：標題、說明框、題組標示、選文段落、圖片描述框、表格（設計文件 §5.1、§5.3、§5.7、§5.8）。
 * 每個函式回傳 Block（節點＋估計高度＋分頁旗標），由 blocks.ts 的 flowBlocks() 排成內容。
 */
import type { Figure } from '../../../data/exams';
import { figureKindLabel } from '../../exams/labels';
import type { PdfContent, PdfInline, PdfNode, PdfTableLayout } from '../engine/docTypes';
import { maybeUnbreakable, type Block } from './blocks';
import { estimateLineCount, estimateTextHeight, textWidth } from './estimate';
import { CONTENT_WIDTH, GAP, LINE, PARAGRAPH_INDENT, SIZE, lineHeightPt } from './metrics';
import { plainInline, richInline, richParagraphs, spacedInline, type RichOptions } from './richInline';
import { PDF_TEXT } from './strings';

/** 細框線（說明框、選項框、多文本的部分框）。 */
export function boxLayout(lineWidth = 0.8, padding: { x: number; y: number } = { x: 4, y: 2 }): PdfTableLayout {
  return {
    hLineWidth: () => lineWidth,
    vLineWidth: () => lineWidth,
    paddingLeft: () => padding.x,
    paddingRight: () => padding.x,
    paddingTop: () => padding.y,
    paddingBottom: () => padding.y,
  };
}

/** 單格表格當外框。 */
export function boxed(content: PdfContent, layout: PdfTableLayout, margin: [number, number, number, number] = [0, 0, 0, 0]): PdfNode {
  return { table: { widths: ['*'], body: [[content]] }, layout, margin };
}

/** 部分標題「第壹部分、選擇題（占62分）」與大題標題「一、詞彙題（占10分）」：14 pt 粗體，中文字距加寬。 */
export function headingBlock(text: string, options: { breakBefore?: boolean; marginTop?: number } = {}): Block {
  const marginTop = options.marginTop ?? 4;
  const marginBottom = 4;
  const lines = estimateLineCount(text, CONTENT_WIDTH - text.length * 3, SIZE.heading);
  return {
    node: { text: spacedInline(text, { bold: true }), fontSize: SIZE.heading, lineHeight: LINE.heading, margin: [0, marginTop, 0, marginBottom] },
    height: lines * lineHeightPt(SIZE.heading, LINE.heading) + marginTop + marginBottom,
    keepWithNext: true,
    ...(options.breakBefore ? { breakBefore: true } : {}),
  };
}

/** 「說明：」開頭的文字拆成標籤與內文，換行時對齊內文（題本的懸掛縮排）。 */
export function splitLeadLabel(text: string): { label: string; body: string } | null {
  const m = /^(說明|提示|題目)\s*([：︰:])\s*/u.exec(text);
  if (!m) return null;
  const colon = m[2] === ':' || m[2] === undefined ? PDF_TEXT.colon : m[2];
  return { label: `${m[1] ?? ''}${colon}`, body: text.slice(m[0].length) };
}

/** 懸掛縮排：標籤一欄、內文一欄（內文換行時從內文起點對齊）。 */
function hanging(label: string, body: PdfInline[] | PdfContent, labelWidth: number, style: { fontSize: number; lineHeight: number }): PdfNode {
  return {
    columns: [
      { width: labelWidth, text: plainInline(label), ...style },
      Array.isArray(body) ? { width: '*', text: body as PdfInline[], ...style } : { width: '*', stack: [body], ...style },
    ],
    columnGap: 0,
  };
}

/**
 * 說明框：題本原文逐字，12 pt，細框滿版（設計文件 §5.1）。
 * 「說明：」懸掛縮排；說明有好幾段、每段都以「說明：」開頭（85 學年度詞彙題）時，每段各自懸掛。
 */
export function instructionsBlock(text: string): Block {
  const style = { fontSize: SIZE.cjk, lineHeight: LINE.instructions };
  const innerWidth = CONTENT_WIDTH - 8 - 1.6;
  // 依「說明：」切段；不是以標籤開頭的行接在前一段後面（換行保留）。
  const paragraphs: { label: string | null; body: string }[] = [];
  for (const line of text.split('\n')) {
    const lead = splitLeadLabel(line);
    const prev = paragraphs.at(-1);
    if (lead) paragraphs.push({ label: lead.label, body: lead.body });
    else if (prev) prev.body += `\n${line}`;
    else paragraphs.push({ label: null, body: line });
  }
  let height = 4 + 1.6 + 6;
  const rows: PdfNode[] = paragraphs.map((p) => {
    const labelWidth = p.label ? p.label.length * SIZE.cjk : 0;
    height += estimateTextHeight(p.body, innerWidth - labelWidth, SIZE.cjk, LINE.instructions);
    return p.label ? hanging(p.label, plainInline(p.body), labelWidth, style) : { text: plainInline(p.body), ...style };
  });
  const content: PdfNode = rows.length === 1 && rows[0] ? rows[0] : { stack: rows };
  return { node: boxed(content, boxLayout(0.8, { x: 4, y: 2 }), [0, 0, 0, 6]), height, keepWithNext: true };
}

/** 題組標示「第 11 至 15 題為題組」：11 pt 加底線（題本如此）。 */
export function groupLabelBlock(text: string): Block {
  return {
    node: { text: plainInline(text).map((run) => ({ ...run, decoration: 'underline' as const })), fontSize: SIZE.groupLabel, lineHeight: LINE.passage, margin: [0, 2, 0, 2] },
    height: lineHeightPt(SIZE.groupLabel, LINE.passage) + 4,
    keepWithNext: true,
  };
}

export interface ParagraphOptions extends RichOptions {
  /** 首行縮排；多文本的部分框內文不縮排。 */
  indent?: number;
  fontSize?: number;
  lineHeight?: number;
  width?: number;
  alignment?: 'justify' | 'left';
}

/** 選文：每一行一個段落，左右對齊、首行縮排、段距 4 pt。空行（詩的分節）變成半行空白。 */
export function paragraphBlocks(text: string, options: ParagraphOptions = {}): Block[] {
  const fontSize = options.fontSize ?? SIZE.body;
  const lineHeight = options.lineHeight ?? LINE.passage;
  const indent = options.indent ?? PARAGRAPH_INDENT;
  const width = options.width ?? CONTENT_WIDTH;
  const lines = text.split('\n');
  return richParagraphs(text, options).map((inlines, i) => {
    if (inlines.length === 0) {
      return { node: { text: '', margin: [0, 0, 0, lineHeightPt(fontSize, lineHeight) / 2] }, height: lineHeightPt(fontSize, lineHeight) / 2 };
    }
    const node: PdfNode = {
      text: inlines,
      fontSize,
      lineHeight,
      alignment: options.alignment ?? 'justify',
      ...(indent > 0 ? { leadingIndent: indent } : {}),
      margin: [0, 0, 0, GAP.paragraph],
    };
    return { node, height: estimateTextHeight(lines[i] ?? '', width, fontSize, lineHeight, indent) + GAP.paragraph };
  });
}

/**
 * 圖片描述框的標題列：「［圖］地圖：第38題選項…」「［表格］…」。
 * marker（「［圖］」「［表格］」）印粗體；其餘來自試題資料，粗體子集不一定有這些字（只收標題用字），
 * 整串印粗體會有的字粗、有的字細，所以印一般粗細。
 */
export function figureTitle(fig: Figure): { marker: string; text: string } {
  const isTable = fig.kind === 'table';
  const kind = fig.label?.trim() || figureKindLabel(fig.kind);
  const caption = fig.caption?.trim() ?? '';
  if (isTable) return { marker: PDF_TEXT.tableLabel, text: caption || kind };
  return { marker: PDF_TEXT.figureLabel, text: `${kind}${caption ? `${PDF_TEXT.figureSeparator}${caption}` : ''}` };
}

const DASHED: PdfTableLayout = {
  ...boxLayout(0.8, { x: 5, y: 3 }),
  hLineStyle: () => ({ dash: { length: 3, space: 2 } }),
  vLineStyle: () => ({ dash: { length: 3, space: 2 } }),
};

function figureTable(rows: readonly (readonly string[])[], width: number): { node: PdfNode; height: number } {
  const cols = Math.max(...rows.map((r) => r.length));
  const colWidth = (width - cols * 6) / cols;
  // 第一列（表頭）用淺灰底，不用粗體：表格文字來自試題資料，粗體子集不一定有這些字。
  const body = rows.map((row, r) =>
    Array.from({ length: cols }, (_, c) => ({ text: richInline(row[c] ?? ''), fontSize: SIZE.figureTitle, lineHeight: 1.2, ...(r === 0 ? { fillColor: '#eeeeee' } : {}) })),
  );
  const lh = lineHeightPt(SIZE.figureTitle, 1.2);
  const height = rows.reduce((sum, row) => sum + Math.max(1, ...row.map((cell) => estimateLineCount(cell, colWidth, SIZE.figureTitle))) * lh + 4, 0);
  return {
    node: { table: { widths: Array.from({ length: cols }, () => '*'), body, dontBreakRows: true }, layout: boxLayout(0.6, { x: 3, y: 1.5 }), margin: [0, 3, 0, 3] },
    height: height + 6,
  };
}

/**
 * 圖片描述框（設計文件 §5.8）：虛線框，第一行粗體標題，接著文字描述、表格（有 rows 時），最後一行灰色小字指向官方 PDF。
 * kind 為 table 的是真的表格：只印標題與表格，不加「原圖請見」。
 */
export function figureBlock(fig: Figure): Block {
  const inner = CONTENT_WIDTH - 10 - 1.6;
  const isTable = fig.kind === 'table';
  const rows = fig.rows && fig.rows.length > 0 ? fig.rows : null;
  const title = figureTitle(fig);
  const stack: PdfContent[] = [{ text: [...plainInline(title.marker, { bold: true }), ...plainInline(title.text)], fontSize: SIZE.figureTitle, lineHeight: LINE.figure }];
  let height = estimateTextHeight(`${title.marker}${title.text}`, inner, SIZE.figureTitle, LINE.figure);
  const description = fig.description.trim();
  if (description !== '' && !(isTable && rows)) {
    stack.push({ text: richInline(description), fontSize: SIZE.figureBody, lineHeight: LINE.figure });
    height += estimateTextHeight(description, inner, SIZE.figureBody, LINE.figure);
  }
  if (rows) {
    const table = figureTable(rows, inner);
    stack.push(table.node);
    height += table.height;
  }
  if (!isTable) {
    stack.push({ text: plainInline(PDF_TEXT.figureNote), fontSize: SIZE.figureNote, color: '#555555', lineHeight: LINE.figure, margin: [0, 2, 0, 0] });
    height += lineHeightPt(SIZE.figureNote, LINE.figure) * 2 + 2;
  }
  height += 6 + 1.6 + 8;
  const node = boxed({ stack }, isTable ? boxLayout(0.6, { x: 5, y: 3 }) : DASHED, [0, 3, 0, 5]);
  return { node: maybeUnbreakable(node, height), height };
}

/**
 * 填寫欄：「姓名：＿＿＿　日期：＿＿＿」平均分配在一列，底線長度依欄寬與標籤寬計算（canvas 不會自己縮放）。
 */
export function fieldRow(labels: readonly string[], fontSize: number, options: { gap?: number; margin?: [number, number, number, number] } = {}): PdfNode {
  const gap = options.gap ?? 10;
  const fieldWidth = (CONTENT_WIDTH - gap * (labels.length - 1)) / labels.length;
  return {
    columns: labels.map((label) => {
      const text = `${label}${PDF_TEXT.colon}`;
      const labelWidth = Math.ceil(textWidth(text, fontSize)) + 1;
      const line = Math.max(10, fieldWidth - labelWidth);
      return {
        width: fieldWidth,
        columns: [
          { width: labelWidth, text: plainInline(text), fontSize },
          { width: line, canvas: [{ type: 'line', x1: 0, y1: fontSize * 1.2, x2: line, y2: fontSize * 1.2, lineWidth: 0.6 }] },
        ],
        columnGap: 0,
      };
    }),
    columnGap: gap,
    margin: options.margin ?? [0, 0, 0, 10],
  };
}
