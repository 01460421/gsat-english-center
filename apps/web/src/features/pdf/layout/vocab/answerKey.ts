/**
 * 答案（docs/design/vocab-handout.md §3.7）：另起一段、頁碼另計，可以整疊拆下。
 *
 *   1. 標題「答案」＋講義標題與講義代號（拆下後還能對回題目）＋通則（拼法、斟酌給分）。
 *   2. 答案速查表：每部分一張，5 欄網格「1 adults　2 postponed　…」，老師批改、學生對答案都先看這張。
 *   3. 句意填空詳解（預設附，可關）：每題三行——整句（答案粗體）＋（原形 adult・複數）短釋義＋→ 講義 #12；中文翻譯；
 *      英文與中文的 Tatoeba 標示（有連結）。也算對的寫法接在答案後面（「（亦可：color）」）。
 *   4. 中翻英拼字、英選中：答案＋短釋義的清單。
 *   5. 未出題的字：依部分與原因列出（沒有合適的例句、功能詞不出題、超過題數上限…）。
 */
import type { PdfContent, PdfInline, PdfNode } from '../../engine/docTypes';
import type { ChoiceItem, ClozeItem, HandoutSkipped, SpellingItem, VocabHandoutPdfData } from '../../vocabTypes';
import { maybeUnbreakable, type Block } from '../blocks';
import { estimateTextHeight } from '../estimate';
import { plainInline } from '../richInline';
import { sectionHeadingBlock } from './cloze';
import { KEEP_SPACES, attributionInlines, breakableGap, nbsp, unitInlines } from './inlines';
import { COLOR, VOCAB_CONTENT_WIDTH, VSIZE } from './metrics';
import { VOCAB_PDF_BOLD, VOCAB_PDF_TEXT } from './strings';

const GRID_COLUMNS = 5;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const DETAIL_NO_WIDTH = 26;
/** 未出題的字每一類最多列幾個（600 字的測驗卷「超過題數上限」可能有五百個字）。 */
const MAX_SKIPPED_WORDS = 80;

function gridTable(cells: { no: number; answer: string }[]): PdfNode {
  const rows: PdfContent[][] = [];
  for (let i = 0; i < cells.length; i += GRID_COLUMNS) {
    const row: PdfContent[] = cells.slice(i, i + GRID_COLUMNS).map((c) => ({
      text: [{ text: `${c.no}\u00A0\u00A0`, font: 'Tinos', color: COLOR.muted, fontSize: VSIZE.keySmall, ...KEEP_SPACES }, ...plainInline(c.answer, { bold: true })],
      fontSize: VSIZE.keyText,
    }));
    while (row.length < GRID_COLUMNS) row.push('');
    rows.push(row);
  }
  return {
    table: { widths: Array.from({ length: GRID_COLUMNS }, () => '*'), body: rows, dontBreakRows: true },
    layout: {
      hLineWidth: () => 0.35,
      vLineWidth: () => 0.35,
      hLineColor: () => COLOR.hairline,
      vLineColor: () => COLOR.hairline,
      paddingLeft: () => 4,
      paddingRight: () => 3,
      paddingTop: () => 2,
      paddingBottom: () => 2,
    },
    margin: [0, 0, 0, 8],
  };
}

function subheading(text: string): PdfNode {
  return { text: plainInline(text, { bold: true }), fontSize: 11, margin: [0, 4, 0, 3] };
}

function choiceLetter(item: ChoiceItem): string {
  return LETTERS[item.answerIndex] ?? '?';
}

/** 一題句意填空的詳解。 */
function clozeDetail(item: ClozeItem): Block {
  const answer: PdfInline[] = plainInline(item.answer, { bold: true });
  // 答案就是原形時不寫「原形 …」。
  const isBase = item.answer.toLowerCase() === item.base.toLowerCase();
  const notes = [...(isBase ? [] : [VOCAB_PDF_TEXT.baseForm(item.base)]), ...(item.formLabel ? [item.formLabel] : [])].join(VOCAB_PDF_TEXT.itemSeparator);
  const line1: PdfInline[] = [
    ...plainInline(item.before),
    ...answer,
    ...plainInline(item.after),
    ...(item.alsoAccepted.length > 0 ? plainInline(VOCAB_PDF_TEXT.alsoAccepted(item.alsoAccepted)).map((r) => ({ ...r, color: COLOR.muted })) : []),
    breakableGap(2),
    ...plainInline(`${notes ? VOCAB_PDF_TEXT.paren(notes) : ''}${item.gloss}`).map((r) => ({ ...r, fontSize: 9, color: '#333333' })),
    // 「→ 講義 #12」不拆開：前面的空白可以換行，放不下時整段換到下一行。
    ...(item.wordNo !== null ? [breakableGap(2), ...unitInlines(VOCAB_PDF_TEXT.backToEntry(item.wordNo)).map((r) => ({ ...r, fontSize: 9, color: COLOR.muted }))] : []),
  ];
  const attr = attributionInlines({ en: item.enAttribution, enUrl: item.enUrl, zh: item.zhAttribution, zhUrl: item.zhUrl, zhConverted: item.zhConverted }, { link: true });
  const width = VOCAB_CONTENT_WIDTH - DETAIL_NO_WIDTH;
  const height =
    estimateTextHeight(`${item.before}${item.answer}${item.after} ${notes}${item.gloss} ${item.wordNo ?? ''}`, width, VSIZE.keyText, 1.3) +
    estimateTextHeight(item.zh, width, 9, 1.25) +
    estimateTextHeight(`${item.enAttribution} · ${item.zhAttribution}`, width, VSIZE.attribution, 1.15) +
    5;
  const node: PdfNode = {
    columns: [
      { width: DETAIL_NO_WIDTH, text: `${item.no}.`, font: 'Tinos', fontSize: VSIZE.keyText, lineHeight: 1.3 },
      {
        width: '*',
        stack: [
          { text: line1, fontSize: VSIZE.keyText, lineHeight: 1.3 },
          { text: plainInline(item.zh), fontSize: 9, color: '#333333', lineHeight: 1.25 },
          { text: attr, fontSize: VSIZE.attribution, color: COLOR.faint, lineHeight: 1.15 },
        ],
      },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 5],
  };
  return { node: maybeUnbreakable(node, height), height };
}

/** 拼字、英選中：「13. adult（亦可：…）　成人, 成蟲」，兩欄。 */
function answerList(lines: { no: number; answer: PdfInline[]; gloss: string }[]): PdfNode[] {
  const out: PdfNode[] = [];
  const half = (VOCAB_CONTENT_WIDTH - 16) / 2;
  for (let i = 0; i < lines.length; i += 2) {
    const cell = (l: (typeof lines)[number] | undefined): PdfContent =>
      l
        ? { text: [{ text: `${l.no}.\u00A0`, font: 'Tinos', color: COLOR.muted, ...KEEP_SPACES }, ...l.answer, breakableGap(2), ...plainInline(l.gloss).map((r) => ({ ...r, fontSize: 9, color: '#333333' }))], fontSize: VSIZE.keyText, lineHeight: 1.3 }
        : '';
    out.push({ columns: [{ width: half, stack: [cell(lines[i])] }, { width: half, stack: [cell(lines[i + 1])] }], columnGap: 16, unbreakable: true });
  }
  return out;
}

function spellingLines(items: readonly SpellingItem[]) {
  return items.map((s) => ({
    no: s.no,
    answer: [...plainInline(s.answer, { bold: true }), ...(s.alsoAccepted.length > 0 ? plainInline(VOCAB_PDF_TEXT.alsoAccepted(s.alsoAccepted)).map((r) => ({ ...r, color: COLOR.muted })) : [])],
    gloss: s.prompt,
  }));
}

function choiceLines(items: readonly ChoiceItem[]) {
  return items.map((c) => ({ no: c.no, answer: [{ text: choiceLetter(c), font: 'Tinos' as const, bold: true }, nbsp(2), ...plainInline(c.word)], gloss: c.options[c.answerIndex] ?? '' }));
}

/** 未出題的字：依部分與原因分組。 */
function skippedContent(skipped: readonly HandoutSkipped[]): PdfContent[] {
  if (skipped.length === 0) return [];
  const out: PdfContent[] = [subheading(VOCAB_PDF_BOLD.keySkipped)];
  const sections = ['cloze', 'spelling', 'choice'] as const;
  for (const section of sections) {
    const inSection = skipped.filter((s) => s.section === section);
    const reasons = [...new Set(inSection.map((s) => s.reason))];
    for (const reason of reasons) {
      const words = inSection.filter((s) => s.reason === reason).map((s) => s.word);
      const label = `${VOCAB_PDF_TEXT.skippedSection[section]}・${VOCAB_PDF_TEXT.skippedReasons[reason]}${VOCAB_PDF_TEXT.skippedCount(words.length)}`;
      const shown = words.length > MAX_SKIPPED_WORDS ? `${words.slice(0, MAX_SKIPPED_WORDS).join(', ')}${VOCAB_PDF_TEXT.andMore(words.length)}` : words.join(', ');
      const list: PdfInline[] = [...plainInline(VOCAB_PDF_TEXT.colon), ...plainInline(shown)];
      out.push({ text: [...plainInline(label, { bold: false }).map((r) => ({ ...r, color: '#333333' })), ...list], fontSize: 8.5, lineHeight: 1.3, margin: [0, 0, 0, 3] });
    }
  }
  return out;
}

/** 答案這一段的區塊（交給 flowBlocks）。 */
export function answerKeyBlocks(data: VocabHandoutPdfData): Block[] {
  const blocks: Block[] = [];
  const raw = (node: PdfContent, height = 20): Block => ({ node: node as PdfNode, height });
  blocks.push(sectionHeadingBlock(VOCAB_PDF_BOLD.keyTitle));
  blocks.push(raw({ text: plainInline(`${data.headerTitle}・${VOCAB_PDF_TEXT.codeLabel(data.code)}`), fontSize: 9.5, color: COLOR.muted, margin: [0, 0, 0, 3] }));
  blocks.push(raw({ ul: VOCAB_PDF_TEXT.keyNotes.map((n) => ({ text: plainInline(n), fontSize: 8.5, color: '#333333' })), margin: [0, 0, 0, 8] }, 28));

  const quiz = data.kind === 'quiz';
  const parts: { title: string; cells: { no: number; answer: string }[] }[] = [];
  if (data.cloze.length > 0) parts.push({ title: quiz ? VOCAB_PDF_TEXT.partTitle(0, VOCAB_PDF_BOLD.clozeTitle) : VOCAB_PDF_BOLD.clozeTitle, cells: data.cloze.map((c) => ({ no: c.no, answer: c.answer })) });
  if (data.spelling.length > 0) parts.push({ title: VOCAB_PDF_TEXT.partTitle(1, VOCAB_PDF_BOLD.spellingTitle), cells: data.spelling.map((s) => ({ no: s.no, answer: s.answer })) });
  if (data.choice.length > 0) parts.push({ title: VOCAB_PDF_TEXT.partTitle(quiz && data.spelling.length > 0 ? 2 : 1, VOCAB_PDF_BOLD.choiceTitle), cells: data.choice.map((c) => ({ no: c.no, answer: choiceLetter(c) })) });
  blocks.push({ node: subheading(VOCAB_PDF_BOLD.keyQuick), height: 18, keepWithNext: true });
  for (const part of parts) {
    const grid = gridTable(part.cells);
    const height = Math.ceil(part.cells.length / GRID_COLUMNS) * 17 + 8;
    if (parts.length > 1) blocks.push({ node: { text: plainInline(part.title), fontSize: 9.5, color: COLOR.muted, margin: [0, 0, 0, 2] }, height: 14, keepWithNext: true });
    blocks.push({ node: maybeUnbreakable(grid, height), height });
  }

  if (data.options.keyDetails && data.cloze.length > 0) {
    blocks.push({ ...sectionHeadingBlock(VOCAB_PDF_BOLD.keyDetails, { marginTop: 8 }) });
    for (const item of data.cloze) blocks.push(clozeDetail(item));
  }
  if (data.spelling.length > 0) {
    blocks.push({ node: subheading(VOCAB_PDF_TEXT.partTitle(1, VOCAB_PDF_BOLD.spellingTitle)), height: 18, keepWithNext: true });
    for (const row of answerList(spellingLines(data.spelling))) blocks.push({ node: row, height: 15 });
  }
  if (data.choice.length > 0) {
    blocks.push({ node: subheading(VOCAB_PDF_TEXT.partTitle(data.spelling.length > 0 ? 2 : 1, VOCAB_PDF_BOLD.choiceTitle)), height: 18, keepWithNext: true });
    for (const row of answerList(choiceLines(data.choice))) blocks.push({ node: row, height: 15 });
  }
  const skipped = skippedContent(data.skipped);
  if (skipped.length > 0) {
    blocks.push({ node: { stack: [skipped[0] as PdfContent], margin: [0, 6, 0, 0] }, height: 22, keepWithNext: true });
    for (const node of skipped.slice(1)) blocks.push({ node: node as PdfNode, height: 24 });
  }
  return blocks;
}
