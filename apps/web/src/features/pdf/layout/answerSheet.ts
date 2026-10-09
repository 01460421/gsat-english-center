/**
 * 答題卷（設計文件 §5.10，includeAnswerSheet）：本站設計的 A4 簡化格式，接在題本後面、從新的一頁開始。
 * 不仿製機讀卡（沒有定位黑塊、條碼、考生號碼欄、紅色框）。
 *
 *   1. 選擇題答案卡：自動計分的題目（單選、選項庫、多選）依題號分欄，每列「題號＋選項框」，選項數依該題資料；
 *   2. 混合題作答區（有混合題時）：填充、簡答一條書寫線，選擇題印選項框；
 *   3. 其他非選擇題（舊制簡答、短詩問答、表格填寫）：每題兩條線；
 *   4. 中譯英：每題三條線；
 *   5. 英文作文：從新的一頁開始，兩頁格線，左側每 5 行印行號，第 12 行右側提示約 120 個單詞。
 */
import type { Exam, ExamSection, OptionLetter, Question, QuestionGroup } from '../../../data/exams';
import { isAutoScored } from '../../exams/scoring';
import type { PdfCanvasElement, PdfContent, PdfNode, PdfTableLayout } from '../engine/docTypes';
import { textWidth } from './estimate';
import { CONTENT_HEIGHT, CONTENT_WIDTH } from './metrics';
import { fieldRow } from './nodes';
import { optionCells } from './options';
import { questionNumberText } from './questions';
import { plainInline, spacedInline } from './richInline';
import { PDF_TEXT } from './strings';

export interface CardItem {
  label: string;
  letters: OptionLetter[];
}

/** 選項框：寬 13、高 9 pt 的圓角矩形，字母（Tinos 7 pt）印在框內。 */
export const CARD = { box: 13, height: 9, slot: 16, row: 13.5, labelSize: 9, letterSize: 7, columnGap: 16 } as const;

/** 題目可選的選項代號：本題自己的選項，或題組共用的選項庫。 */
export function choiceLetters(q: Question, group: Pick<QuestionGroup, 'options_bank'>): OptionLetter[] {
  const map = q.options ?? group.options_bank;
  return map ? optionCells(map).map((c) => c.letter) : [];
}

/** 答案卡要印的題目：混合題以外的自動計分題（混合題的選擇題印在混合題作答區，和題本的答題卷一樣）。 */
export function choiceCardItems(exam: Pick<Exam, 'sections'>): CardItem[] {
  const items: CardItem[] = [];
  for (const section of exam.sections) {
    if (section.type === 'mixed') continue;
    for (const group of section.groups) {
      for (const q of group.questions) {
        if (!isAutoScored(q)) continue;
        const letters = choiceLetters(q, group);
        if (letters.length > 0) items.push({ label: q.label, letters });
      }
    }
  }
  return items;
}

/** 一列：題號（靠右）＋選項框（字母在框內）。 */
export function cardRow(item: Pick<CardItem, 'label' | 'letters'>, labelWidth: number, marginBottom = 4.5): PdfNode {
  const { box, height, slot, letterSize, labelSize } = CARD;
  const inset = (slot - box) / 2;
  const width = item.letters.length * slot;
  const rects: PdfCanvasElement[] = item.letters.map((_, i) => ({ type: 'rect', x: i * slot + inset, y: 0, w: box, h: height, r: 2, lineWidth: 0.6 }));
  return {
    columns: [
      { width: labelWidth, text: plainInline(item.label), fontSize: labelSize, lineHeight: 1, alignment: 'right', margin: [0, 0, 5, 0] },
      {
        width,
        stack: [
          // 字母先畫、不佔版面（relativePosition），框再畫在同一個位置。
          {
            columns: item.letters.map((letter) => ({ width: slot, text: letter, font: 'Tinos' as const, fontSize: letterSize, lineHeight: 1, alignment: 'center' as const })),
            columnGap: 0,
            relativePosition: { x: 0, y: 0.9 },
          },
          { canvas: rects },
        ],
      },
    ],
    columnGap: 0,
    margin: [0, 0, 0, marginBottom],
  };
}

function labelColumnWidth(items: readonly CardItem[]): number {
  return Math.max(18, ...items.map((i) => Math.ceil(textWidth(i.label, CARD.labelSize)) + 7));
}

/**
 * 答案卡分欄：題數平均分成 3 欄、每欄是 5 的倍數，
 * 太寬（例如 83 學年度的選項庫到 O）就改成 2 欄、1 欄。
 */
export function cardColumns(items: readonly CardItem[]): CardItem[][] {
  for (const k of [3, 2, 1]) {
    // 每欄的題數取 5 的倍數（115 學測 46 題：1–20、21–40、41–46，同設計文件 §5.10）。
    const perColumn = k === 1 ? items.length : Math.max(10, Math.ceil(items.length / k / 5) * 5);
    const columns: CardItem[][] = [];
    for (let i = 0; i < items.length; i += perColumn) columns.push(items.slice(i, i + perColumn));
    const width = columns.reduce((sum, col) => sum + labelColumnWidth(col) + Math.max(0, ...col.map((c) => c.letters.length)) * CARD.slot, 0) + CARD.columnGap * (columns.length - 1);
    if (width <= CONTENT_WIDTH || k === 1) return columns;
  }
  return [items.slice()];
}

function choiceCard(items: readonly CardItem[]): PdfContent[] {
  if (items.length === 0) return [];
  const columns = cardColumns(items);
  return [
    sheetHeading(PDF_TEXT.choiceCardTitle),
    {
      columns: columns.map((col) => {
        const labelWidth = labelColumnWidth(col);
        const width = labelWidth + Math.max(0, ...col.map((c) => c.letters.length)) * CARD.slot;
        // 每 5 題空一點，方便對題號（同機讀卡）：題號是 5 的倍數就空（83 學年度第二部分「選填1」這類照順序）。
        return {
          width,
          stack: col.map((item, i) => {
            const n = /^\d+$/.test(item.label) ? Number(item.label) : i + 1;
            return cardRow(item, labelWidth, n % 5 === 0 ? 9 : 4.5);
          }),
        };
      }),
      columnGap: CARD.columnGap,
      margin: [0, 2, 0, 2],
    },
    { text: plainInline(PDF_TEXT.choiceCardNote), fontSize: 8.5, color: '#444444', margin: [0, 2, 0, 10] },
  ];
}

function sheetHeading(text: string, margin: [number, number, number, number] = [0, 4, 0, 6]): PdfNode {
  return { text: spacedInline(text, { bold: true, spacing: 1 }), fontSize: 12, lineHeight: 1.2, margin };
}

/** 書寫線（canvas）：count 條，行距 gap，第一條在 first。 */
function writingLines(width: number, count: number, gap = 28, first = 24): PdfNode {
  const lines: PdfCanvasElement[] = Array.from({ length: count }, (_, i) => ({ type: 'line', x1: 0, y1: first + i * gap, x2: width, y2: first + i * gap, lineWidth: 0.5, lineColor: '#777777' }));
  return { canvas: lines, margin: [0, 0, 0, 6] };
}

const TABLE: PdfTableLayout = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

/** 作答區表格：「題號｜作答區」，每題一列。 */
function answerTable(rows: { label: string; body: PdfContent }[]): PdfNode {
  const labelWidth = Math.max(30, ...rows.map((r) => Math.ceil(textWidth(r.label, 10)) + 12));
  const header = [
    { text: plainInline(PDF_TEXT.labelHeader), fontSize: 9, alignment: 'center' as const, fillColor: '#eeeeee' },
    { text: plainInline(PDF_TEXT.answerAreaHeader), fontSize: 9, alignment: 'center' as const, fillColor: '#eeeeee' },
  ];
  return {
    table: {
      widths: [labelWidth, '*'],
      headerRows: 1,
      dontBreakRows: true,
      body: [header, ...rows.map((r) => [{ text: plainInline(r.label), fontSize: 10, alignment: 'center' as const, margin: [0, 6, 0, 0] as [number, number, number, number] }, r.body])],
    },
    layout: TABLE,
    margin: [0, 0, 0, 10],
  };
}

/** 作答區的題號：數字題「47」，大題內編號的題目「1」（同題本的題號）。 */
function areaLabel(q: Question): string {
  return questionNumberText(q).replace(/\.$/u, '') || q.label;
}

function openRows(section: ExamSection, linesPerQuestion: number, areaWidth: number): { label: string; body: PdfContent }[] {
  const rows: { label: string; body: PdfContent }[] = [];
  for (const group of section.groups) {
    for (const q of group.questions) {
      if (q.mode === 'composition') continue;
      if (isAutoScored(q)) {
        const letters = choiceLetters(q, group);
        rows.push({ label: areaLabel(q), body: { stack: [cardRow({ label: '', letters }, 0, 0)], margin: [0, 7, 0, 5] } });
        continue;
      }
      rows.push({ label: areaLabel(q), body: writingLines(areaWidth, linesPerQuestion, 26, 22) });
    }
  }
  return rows;
}

function hasQuestions(section: ExamSection, predicate: (q: Question) => boolean): boolean {
  return section.groups.some((g) => g.questions.some(predicate));
}

/** 中譯英：每題「1.」加三條書寫線。 */
function translationArea(section: ExamSection): PdfNode {
  const rows: PdfContent[] = [sheetHeading(section.title)];
  for (const group of section.groups) {
    for (const q of group.questions) {
      const number = questionNumberText(q);
      rows.push({
        columns: [
          { width: 20, text: plainInline(number), fontSize: 11, margin: [0, 10, 0, 0] },
          { width: '*', ...writingLines(CONTENT_WIDTH - 20, 3) },
        ],
        columnGap: 0,
        unbreakable: true,
      });
    }
  }
  // 題數少（現制 2 題）就整塊不拆，標題不會落在頁底；舊制 5 題允許在題與題之間換頁。
  return { stack: rows, ...(rows.length <= 3 ? { unbreakable: true } : {}) };
}

const COMPOSITION_LINE = 28;
/** 一列的實際高度：pdfmake 把橫線的粗細也算進列高。 */
const COMPOSITION_ROW = COMPOSITION_LINE + 0.8;
const NUMBER_WIDTH = 18;

function compositionTable(startLine: number, count: number, hintAt: number | null): PdfNode {
  const body: PdfContent[][] = Array.from({ length: count }, (_, i) => {
    const n = startLine + i;
    return [
      { text: n % 5 === 0 ? String(n) : '', font: 'Tinos', fontSize: 7, color: '#888888', alignment: 'right', margin: [0, 15, 2, 0] },
      n === hintAt
        ? { text: plainInline(PDF_TEXT.compositionLineHint), fontSize: 7.5, color: '#999999', alignment: 'right', margin: [0, 15, 0, 0] }
        : { text: '' },
    ];
  });
  return {
    table: { widths: [NUMBER_WIDTH, '*'], heights: COMPOSITION_LINE, body, dontBreakRows: true },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: (i, node) => (i === 0 || i === (node.table.widths?.length ?? 2) ? 0.8 : 0),
      hLineColor: (i, node) => (i === 0 || i === node.table.body.length ? '#000000' : '#999999'),
      paddingLeft: () => 0,
      paddingRight: () => 4,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };
}

/** 英文作文：新的一頁，兩頁格線。 */
function compositionArea(section: ExamSection): PdfContent[] {
  const headingHeight = 12 * 1.107 * 1.2 + 2 + 8 * 1.107 * 1.35 + 4;
  const continuedHeight = 9 * 1.107 * 1.35 + 6;
  const firstPage = Math.floor((CONTENT_HEIGHT - headingHeight - 4) / COMPOSITION_ROW);
  const secondPage = Math.floor((CONTENT_HEIGHT - continuedHeight - 4) / COMPOSITION_ROW);
  return [
    { ...sheetHeading(section.title, [0, 0, 0, 2]), pageBreak: 'before' },
    { text: plainInline(PDF_TEXT.compositionGuide), fontSize: 8, color: '#555555', margin: [0, 0, 0, 4] },
    compositionTable(1, firstPage, 12),
    { text: plainInline(PDF_TEXT.compositionContinued), fontSize: 9, color: '#555555', pageBreak: 'before', margin: [0, 0, 0, 6] },
    compositionTable(firstPage + 1, secondPage, null),
  ];
}

/** 非選擇題作答區（混合題、簡答、中譯英）的估計高度，決定能不能整區不拆。 */
function estimateAreas(exam: Pick<Exam, 'sections'>): number {
  let height = 0;
  for (const section of exam.sections) {
    const questions = section.groups.flatMap((g) => g.questions);
    if (section.type === 'mixed') height += 50 + questions.length * 38;
    else if (questions.some((q) => q.mode === 'translation')) height += 30 + questions.length * 86;
    else if (questions.some((q) => !isAutoScored(q) && q.mode !== 'composition')) height += 50 + questions.filter((q) => !isAutoScored(q)).length * 64;
  }
  return height;
}

export function answerSheetContent(exam: Exam): PdfContent[] {
  const content: PdfContent[] = [
    { text: spacedInline(PDF_TEXT.answerSheetTitle, { bold: true, spacing: 6 }), fontSize: 18, alignment: 'center', margin: [0, 0, 0, 4] },
    { text: plainInline(PDF_TEXT.answerSheetNote), fontSize: 8.5, color: '#444444', alignment: 'center', margin: [0, 0, 0, 8] },
    fieldRow(PDF_TEXT.sheetFields, 10, { gap: 20, margin: [0, 0, 0, 12] }),
    ...choiceCard(choiceCardItems(exam)),
  ];

  // 混合題、其他非選擇題、中譯英依大題順序排；同一頁放不下就整區移到下一頁（同題本答題卷：第 1 頁答案卡，第 2 頁非選擇題）。
  const areaWidth = CONTENT_WIDTH - 60;
  const areas: PdfContent[] = [];
  for (const section of exam.sections) {
    if (section.type === 'mixed') {
      areas.push({ stack: [sheetHeading(section.title.startsWith('第') ? section.title : PDF_TEXT.mixedArea), answerTable(openRows(section, 1, areaWidth))], unbreakable: true });
    } else if (hasQuestions(section, (q) => q.mode === 'translation')) {
      areas.push(translationArea(section));
    } else if (hasQuestions(section, (q) => !isAutoScored(q) && q.mode !== 'composition')) {
      areas.push({ stack: [sheetHeading(section.title), answerTable(openRows(section, 2, areaWidth))], unbreakable: true });
    }
  }
  if (areas.length > 0) content.push(areas.length === 1 ? (areas[0] as PdfContent) : { stack: areas, ...(estimateAreas(exam) <= CONTENT_HEIGHT * 0.9 ? { unbreakable: true } : {}) });
  for (const section of exam.sections) {
    if (hasQuestions(section, (q) => q.mode === 'composition')) content.push(...compositionArea(section));
  }
  return content;
}
