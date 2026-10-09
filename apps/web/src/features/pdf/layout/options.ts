/**
 * 選項的排法（設計文件 §5.5、§5.6）。
 *
 * 題本依「最寬的選項」決定：四個選項都放得進四欄定位點（18、138、252、366 pt）就一列四個；
 * 放得進兩欄（18、252）就兩欄；否則一個一行。選項文字以「［圖］」開頭的圖片選項一律一個一行。
 * 文意選填的選項庫放在細框裡，5 欄 × 2 列，選項長時改 4、3、2 欄；篇章結構與句子配合題的選項是整句，一個一行。
 */
import type { OptionLetter, OptionMap } from '../../../data/exams';
import type { PdfContent, PdfInline, PdfNode } from '../engine/docTypes';
import { estimateLineCount, textWidth } from './estimate';
import { CONTENT_WIDTH, LINE, OPTION_AREA_WIDTH, OPTION_COLUMNS, OPTION_GAP, SIZE, lineHeightPt } from './metrics';
import { boxLayout, boxed } from './nodes';
import { plainInline, richInline, type RichOptions } from './richInline';
import { PDF_TEXT } from './strings';

const LETTERS: readonly OptionLetter[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
const NBSP = ' ';

export interface OptionCell {
  letter: OptionLetter;
  text: string;
}

export type OptionLayout = 4 | 2 | 1;

/** 選項依字母順序排好（資料是物件，順序不保證）。 */
export function optionCells(options: OptionMap): OptionCell[] {
  return LETTERS.flatMap((letter) => {
    const text = options[letter];
    return text === undefined ? [] : [{ letter, text }];
  });
}

/** 圖片選項（115 第 38 題）：選項文字是圖片的文字描述，以「［圖］」開頭。 */
export function isPictureOption(text: string): boolean {
  return text.trimStart().startsWith(PDF_TEXT.figureLabel);
}

/** 「(A) 選項文字」的估計寬度。 */
export function optionWidth(cell: OptionCell, fontSize: number = SIZE.body): number {
  return textWidth(`(${cell.letter}) ${cell.text}`, fontSize);
}

/** 依最寬的選項決定排法（設計文件 §5.5）。最後一欄貼著右邊界，不必再留間距。 */
export function chooseOptionLayout(cells: readonly OptionCell[], fontSize: number = SIZE.body): OptionLayout {
  if (cells.length === 0 || cells.some((c) => isPictureOption(c.text) || c.text.includes('\n'))) return 1;
  const widths = cells.map((c) => optionWidth(c, fontSize));
  const fits = (columns: readonly number[]) =>
    widths.every((w, i) => {
      const col = i % columns.length;
      const room = (columns[col] ?? 0) - (col === columns.length - 1 ? 0 : OPTION_GAP);
      return w <= room;
    });
  if (cells.length === 4 && fits(OPTION_COLUMNS[4])) return 4;
  if (cells.length >= 2 && fits(OPTION_COLUMNS[2])) return 2;
  return 1;
}

function cellInlines(cell: OptionCell, rich: RichOptions): PdfInline[] {
  return [...plainInline(`(${cell.letter})${NBSP}`), ...richInline(cell.text, rich)];
}

/** 一個一行時的代號欄寬：最寬的「(X) 」。 */
function letterColumnWidth(cells: readonly OptionCell[], fontSize: number): number {
  return Math.ceil(Math.max(...cells.map((c) => textWidth(`(${c.letter})${NBSP}`, fontSize)))) + 1;
}

export interface OptionsBlock {
  node: PdfNode;
  /** 估計行數（乘上行高就是高度）。 */
  lines: number;
}

/**
 * 選項區（放在題號欄右邊，寬 OPTION_AREA_WIDTH）。
 * 一個一行時用懸掛縮排：長選項換行後對齊選項文字，不會鑽到代號底下。
 */
export function optionsBlock(
  cells: readonly OptionCell[],
  layout: OptionLayout,
  options: { fontSize?: number; lineHeight?: number; rich?: RichOptions; width?: number } = {},
): OptionsBlock {
  const fontSize = options.fontSize ?? SIZE.body;
  const lineHeight = options.lineHeight ?? LINE.question;
  const rich = options.rich ?? {};
  const style = { fontSize, lineHeight };
  if (layout === 1) {
    const labelWidth = letterColumnWidth(cells, fontSize);
    const textArea = (options.width ?? OPTION_AREA_WIDTH) - labelWidth;
    const rows: PdfContent[] = cells.map((cell) => ({
      columns: [
        { width: labelWidth, text: plainInline(`(${cell.letter})`), ...style },
        { width: '*', text: richInline(cell.text, rich), ...style },
      ],
      columnGap: 0,
    }));
    const lines = cells.reduce((sum, c) => sum + estimateLineCount(c.text, textArea, fontSize), 0);
    return { node: { stack: rows }, lines };
  }
  const widths = OPTION_COLUMNS[layout];
  const rows: PdfContent[] = [];
  for (let i = 0; i < cells.length; i += layout) {
    const row = cells.slice(i, i + layout);
    rows.push({
      columns: widths.map((w, c) => {
        const cell = row[c];
        return cell ? { width: w, text: cellInlines(cell, rich), ...style } : { width: w, text: '' };
      }),
      columnGap: 0,
    });
  }
  return { node: { stack: rows }, lines: rows.length };
}

/** 文意選填選項庫的欄數：最寬的選項放得進 (W − 12) ÷ 欄數 − 12 就用那個欄數（設計文件 §5.6）。 */
export function chooseBankColumns(cells: readonly OptionCell[], width: number = CONTENT_WIDTH, fontSize: number = SIZE.body): number {
  const widest = Math.max(0, ...cells.map((c) => optionWidth(c, fontSize)));
  for (const cols of [5, 4, 3, 2]) if (widest <= (width - 12) / cols - 12) return cols;
  return 1;
}

/**
 * 選項庫的細框（0.6 pt）：單字型（文意選填）排成多欄；句子型（篇章結構、句子配合題）一個一行。
 * 回傳節點與估計高度。
 */
export function bankBox(bank: OptionMap, kind: 'words' | 'sentences', rich: RichOptions = {}): { node: PdfNode; height: number } {
  const cells = optionCells(bank);
  const fontSize = SIZE.body;
  const lh = lineHeightPt(fontSize, LINE.question);
  const pad = { x: 6, y: 3 };
  const inner = CONTENT_WIDTH - pad.x * 2 - 1.2;
  const cols = kind === 'words' ? chooseBankColumns(cells) : 1;
  if (cols === 1) {
    const block = optionsBlock(cells, 1, { width: inner, rich });
    return { node: boxed(block.node, boxLayout(0.6, pad), [0, 4, 0, 6]), height: block.lines * lh + pad.y * 2 + 12 };
  }
  const rowCount = Math.ceil(cells.length / cols);
  const columns: PdfContent[] = Array.from({ length: cols }, (_, c) => ({
    width: '*',
    stack: Array.from({ length: rowCount }, (_, r) => {
      const cell = cells[r * cols + c];
      return cell ? { text: cellInlines(cell, rich), fontSize, lineHeight: LINE.question } : { text: NBSP, fontSize, lineHeight: LINE.question };
    }),
  }));
  return { node: boxed({ columns, columnGap: 12 }, boxLayout(0.6, pad), [0, 4, 0, 6]), height: rowCount * lh + pad.y * 2 + 12 };
}
