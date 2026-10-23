/**
 * 測驗卷的另外兩部分（docs/design/vocab-handout.md §3.5）：
 *   二、中翻英拼字：「13. 成人, 成蟲（n.）　a _ _ _ _ _」；一列兩題，每列不跨頁。
 *   三、英選中：    「（　　）21. adult n.」下一行四個選項「(A) 成人, 成蟲　(B) …」；
 *                   選項依最寬的一個排成一列四個、兩欄或一個一行（同 options.ts 的判斷方式），每題不跨頁。
 * 題號接續句意填空，三部分連續編號（同學測）。
 */
import type { PdfContent, PdfInline, PdfNode } from '../../engine/docTypes';
import { estimateTextWidth } from '../../fontRuns';
import type { ChoiceItem, SpellingItem } from '../../vocabTypes';
import { maybeUnbreakable, type Block } from '../blocks';
import { estimateTextHeight } from '../estimate';
import { plainInline } from '../richInline';
import { blankInlines, numbered } from './cloze';
import { KEEP_SPACES, nbsp } from './inlines';
import { COLOR, VOCAB_CONTENT_WIDTH, VSIZE, lineHeightPt } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const COLUMN_GAP = 18;
const HALF = (VOCAB_CONTENT_WIDTH - COLUMN_GAP) / 2;
const PROMPT_SIZE = 10.5;
const SPELL_NO_WIDTH = 26;

function spellingCell(item: SpellingItem): { node: PdfContent; height: number } {
  const blank = blankInlines({ lead: item.first, cells: Array.from({ length: Math.max(0, item.letters - 1) }, () => '_') });
  const prompt: PdfInline[] = [...plainInline(item.prompt), ...plainInline(VOCAB_PDF_TEXT.paren(item.pos)).map((r) => ({ ...r, color: COLOR.muted }))];
  const width = HALF - SPELL_NO_WIDTH;
  const height = estimateTextHeight(`${item.prompt}${VOCAB_PDF_TEXT.paren(item.pos)}`, width, PROMPT_SIZE, 1.3) + lineHeightPt(VSIZE.clozeBlank, 1.6);
  return {
    node: numbered(`${item.no}.`, [{ text: prompt, fontSize: PROMPT_SIZE, lineHeight: 1.3 }, { text: blank, lineHeight: 1.6 }], SPELL_NO_WIDTH, VSIZE.clozeNo),
    height,
  };
}

export function spellingBlocks(items: readonly SpellingItem[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < items.length; i += 2) {
    const cells = items.slice(i, i + 2).map(spellingCell);
    const height = Math.max(...cells.map((c) => c.height)) + 6;
    const node: PdfNode = {
      columns: [
        { width: HALF, stack: [cells[0]?.node ?? ''] },
        { width: HALF, stack: [cells[1]?.node ?? ''] },
      ],
      columnGap: COLUMN_GAP,
      margin: [0, 0, 0, 6],
    };
    blocks.push({ node: maybeUnbreakable(node, height), height });
  }
  return blocks;
}

/** 選項排法：最寬的「(A) 選項」放得進四欄就一列四個，放得進兩欄就兩欄，否則一個一行。 */
export function choiceColumns(options: readonly string[], width: number, fontSize = PROMPT_SIZE): 4 | 2 | 1 {
  const widest = Math.max(0, ...options.map((o, i) => estimateTextWidth(`(${LETTERS[i] ?? ''}) ${o}`, fontSize)));
  if (options.length === 4 && widest <= width / 4 - 8) return 4;
  if (widest <= width / 2 - 8) return 2;
  return 1;
}

const CHOICE_NO_WIDTH = 30;

export function choiceBlock(item: ChoiceItem): Block {
  const width = VOCAB_CONTENT_WIDTH - CHOICE_NO_WIDTH;
  const cols = choiceColumns(item.options, width);
  const cells = item.options.map((o, i) => ({ text: [{ text: `(${LETTERS[i] ?? ''})\u00A0`, font: 'Tinos' as const, ...KEEP_SPACES }, ...plainInline(o)], fontSize: PROMPT_SIZE, lineHeight: 1.35 }));
  const rows: PdfContent[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const row = cells.slice(i, i + cols);
    rows.push(cols === 1 ? (row[0] ?? '') : { columns: row.map((c) => ({ ...c, width: width / cols })), columnGap: 0 });
  }
  const lines = cols === 1 ? item.options.reduce((sum, o) => sum + Math.max(1, Math.ceil(estimateTextWidth(`(A) ${o}`, PROMPT_SIZE) / width)), 0) : Math.ceil(item.options.length / cols);
  const height = lineHeightPt(12, 1.35) + lines * lineHeightPt(PROMPT_SIZE, 1.35) + 7;
  const head: PdfInline[] = [
    ...plainInline(VOCAB_PDF_TEXT.answerParen),
    nbsp(),
    ...plainInline(item.word, { bold: true }).map((r) => ({ ...r, fontSize: 12 })),
    { text: `  ${item.pos}`, font: 'Tinos', italics: true, fontSize: 10, color: COLOR.muted },
  ];
  const node: PdfNode = {
    columns: [
      { width: CHOICE_NO_WIDTH, text: `${item.no}.`, font: 'Tinos', fontSize: VSIZE.clozeNo, lineHeight: 1.35 },
      { width: '*', stack: [{ text: head, lineHeight: 1.35 }, ...rows] },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 7],
  };
  return { node: maybeUnbreakable(node, height), height };
}

export function choiceBlocks(items: readonly ChoiceItem[]): Block[] {
  return items.map(choiceBlock);
}
