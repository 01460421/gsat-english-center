/**
 * 試題文字（[[題號]] 空格、<u>／<b> 標記、換行）→ pdfmake 的行內片段。
 *
 * 解析沿用作答畫面的 parseRichText（features/exams/richText.ts），規則完全相同：只認 <u>、<b>，其他角括號都是文字。
 * 每個片段再依字元切成 Tinos／Noto Serif TC／Noto Emoji（fontRuns.ts）。
 *
 * 英文片段再切成「單字＋後面的空白」，每個單字設 noWrap：pdfmake 左右對齊時把多出來的寬度平均加在「每兩個行內片段之間」，
 * 而它自己切片段時連連字號、破折號後面都算斷點，結果「well-qualified」會被撐成「well- qualified」。
 * 先依空白切好、不讓 pdfmake 再切，多出來的寬度就只會加在單字之間（和題本一樣），也不會在連字號處換行。
 * 中文片段不設 noWrap（中文每個字之間都可以換行）。
 */
import { parseRichText, type RichNode } from '../../exams/richText';
import { splitFontRuns, type FontRun } from '../fontRuns';
import type { PdfInline } from '../engine/docTypes';

const NBSP = ' ';

/** 題本的空格：底線上置中印題號（「__11__」）。用不換行空白撐開，換行時也不會被截掉。 */
export function blankInline(label: string): PdfInline {
  return {
    text: `${NBSP}${NBSP}${label}${NBSP}${NBSP}`,
    font: 'Tinos',
    decoration: 'underline',
    preserveLeadingSpaces: true,
    preserveTrailingSpaces: true,
  };
}

export interface RichOptions {
  bold?: boolean;
  /**
   * 空格記號 → 印出的題號。預設照記號原文；呼叫端可以換成題目的 label
   * （gsat-87 的選文寫 [[51]]，題本題號卻是 61，答案卡用的也是 61）。
   */
  blankLabel?: (token: string) => string;
}

interface MarkState {
  bold: boolean;
  underline: boolean;
}

/** 英文片段 → 單字（含後面的空白）；換行單獨一段（noWrap 的片段裡 pdfmake 不處理換行）。 */
export function latinWords(text: string): string[] {
  return text.match(/\n|[^ \n]+ *| +/g) ?? [];
}

/** 一個字型片段 → 行內片段（英文切成 noWrap 的單字）。 */
export function runInlines(run: FontRun, extra: Partial<PdfInline> = {}): PdfInline[] {
  const base = { font: run.font, ...(run.bold ? { bold: true } : {}), ...extra };
  if (run.font !== 'Tinos') return [{ text: run.text, ...base }];
  return latinWords(run.text).map((word) => (word === '\n' ? { text: word, ...base } : { text: word, ...base, noWrap: true }));
}

function nodesToInlines(nodes: readonly RichNode[], state: MarkState, options: RichOptions, out: PdfInline[]): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      for (const run of splitFontRuns(node.text, state.bold)) {
        out.push(...runInlines(run, state.underline ? { decoration: 'underline' } : {}));
      }
    } else if (node.kind === 'blank') {
      out.push(blankInline(options.blankLabel?.(node.label) ?? node.label));
    } else {
      nodesToInlines(node.children, { bold: state.bold || node.tag === 'b', underline: state.underline || node.tag === 'u' }, options, out);
    }
  }
}

/** 一段文字 → 每一行（段落）一個片段陣列。空行（詩的分節）回傳空陣列。 */
export function richParagraphs(text: string, options: RichOptions = {}): PdfInline[][] {
  return parseRichText(text).map((p) => {
    const out: PdfInline[] = [];
    if (!p.empty) nodesToInlines(p.nodes, { bold: options.bold ?? false, underline: false }, options, out);
    return out;
  });
}

/** 不需要分段的短文字（選項、標題）：整段串成一列片段，換行以空白代替。 */
export function richInline(text: string, options: RichOptions = {}): PdfInline[] {
  const lines = richParagraphs(text.replace(/\n+/g, ' '), options);
  return lines.flat();
}

/** 純文字（沒有標記）→ 片段。 */
export function plainInline(text: string, options: { bold?: boolean } = {}): PdfInline[] {
  return splitFontRuns(text, options.bold ?? false).flatMap((run) => runInlines(run));
}

/**
 * 標題用：題本的部分／大題標題字距加寬，但只加在中文上——數字也加的話「62」會變成「6 2」（設計文件 §5.1）。
 */
export function spacedInline(text: string, options: { bold?: boolean; spacing?: number } = {}): PdfInline[] {
  const spacing = options.spacing ?? 3;
  return plainInline(text, options).map((run) => (run.font === 'NotoSerifTC' ? { ...run, characterSpacing: spacing } : run));
}

/**
 * 網址：大考中心的檔案網址很長（百分比編碼的中文檔名，150 字元以上、中間沒有可以換行的地方），
 * 直接放進欄位會把欄寬撐開。這裡在「/」之後或每 maxChars 個字元處換行，整段仍是同一個連結。
 */
export function urlInline(url: string, maxChars = 64): PdfInline {
  const pieces = url.match(/[^/]*\/|[^/]+$/g) ?? [url];
  const lines: string[] = [];
  let line = '';
  for (const piece of pieces) {
    let rest = piece;
    while (rest !== '') {
      const room = maxChars - line.length;
      if (rest.length <= room) {
        line += rest;
        rest = '';
      } else if (line !== '' && rest.length <= maxChars) {
        lines.push(line);
        line = '';
      } else {
        line += rest.slice(0, room);
        rest = rest.slice(room);
        lines.push(line);
        line = '';
      }
    }
  }
  if (line !== '') lines.push(line);
  return { text: lines.join('\n'), font: 'Tinos', link: url };
}
