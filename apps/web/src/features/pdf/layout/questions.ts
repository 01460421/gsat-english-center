/**
 * 一題（或共用題幹的一組填充題）的區塊：題號懸掛在左、題幹與選項從 18 pt 起排（設計文件 §5.4、§5.5、§5.9）。
 * 每題包成不跨頁（題號＋題幹＋選項不拆）。
 */
import type { Question } from '../../../data/exams';
import type { PdfContent, PdfNode } from '../engine/docTypes';
import { maybeUnbreakable, type Block } from './blocks';
import { estimateLineCount, textWidth } from './estimate';
import { CONTENT_WIDTH, GAP, LINE, NUMBER_COLUMN, SIZE, lineHeightPt } from './metrics';
import { splitLeadLabel } from './nodes';
import { chooseOptionLayout, optionCells, optionsBlock } from './options';
import { plainInline, richParagraphs, type RichOptions } from './richInline';
import { PDF_TEXT } from './strings';

/** 題本印的題號：數字題「11.」；中譯英、簡答等大題內編號的題目印「1.」；作文不印。 */
export function questionNumberText(q: Pick<Question, 'label' | 'no' | 'mode'>): string {
  if (q.mode === 'composition') return '';
  if (/^\d+[A-Z]?$/.test(q.label)) return `${q.label}.`;
  // 93 學年度指考的翻譯題印「(a)」「(b)」（label「英文翻譯(a)」）。
  const letter = /\(([a-z])\)$/.exec(q.label);
  if (letter) return `(${letter[1] ?? ''})`;
  return `${q.no}.`;
}

/**
 * 共用題幹的填充題組的題號：題號不同印「47-48」（同題本）；同一題的子題（111 學測 47A、47B）印「47.」。
 */
export function clusterNumberText(questions: readonly Pick<Question, 'label' | 'no'>[]): string {
  const first = questions[0];
  const last = questions.at(-1);
  if (!first || !last) return '';
  if (questions.every((q) => q.no === first.no)) return `${first.no}.`;
  return `${first.label}-${last.label}`;
}

/** 題幹以中文為主（中譯英、作文提示）時用 12 pt，和題本一樣。 */
function isCjkStem(q: Pick<Question, 'mode'>): boolean {
  return q.mode === 'translation' || q.mode === 'composition';
}

export interface QuestionBlockOptions {
  rich?: RichOptions;
  /** 綜合測驗的題目沒有題幹，只印「11. (A) … (B) …」。 */
  hideStem?: boolean;
  /** 覆寫題號文字（共用題幹的填充題組）。 */
  numberText?: string;
  /** 題幹後面加一條作答線（混合題的簡答，同題本）。 */
  answerLine?: boolean;
}

function numberColumnWidth(numberText: string, fontSize: number): number {
  return Math.max(NUMBER_COLUMN, Math.ceil(textWidth(numberText, fontSize)) + 5);
}

/** 題幹每一行一段；中文說明與英文句子混排照資料換行。 */
function stemNodes(stem: string, fontSize: number, lineHeight: number, rich: RichOptions, width: number): { nodes: PdfContent[]; lines: number } {
  const paragraphs = richParagraphs(stem, rich);
  const raw = stem.split('\n');
  const nodes: PdfContent[] = paragraphs.map((inlines) => (inlines.length === 0 ? { text: ' ', fontSize, lineHeight } : { text: inlines, fontSize, lineHeight, alignment: 'justify' as const }));
  const lines = raw.reduce((sum, line) => sum + (line.trim() === '' ? 1 : estimateLineCount(line, width, fontSize)), 0);
  return { nodes, lines };
}

function answerLineNode(width: number): PdfNode {
  return { canvas: [{ type: 'line', x1: 0, y1: 16, x2: width, y2: 16, lineWidth: 0.5 }], margin: [0, 0, 0, 4] };
}

/**
 * 題幹開頭已經寫了題號（112 學測的資料是「47-48 請從文章中…」）：拿掉，避免印成「47-48 47-48」。
 * 只在題號後面接著中文說明時才拿（英文題幹「5 students were…」的數字是題目內容）。
 */
export function withoutLeadingNumber(stem: string, numberText: string): string {
  const bare = numberText.replace(/\.$/u, '');
  if (bare === '' || !stem.startsWith(bare)) return stem;
  const rest = stem.slice(bare.length).replace(/^[\s.、]+/u, '');
  return /^[\u3400-\u9fff]/u.test(rest) ? rest : stem;
}

/** 一題的區塊。stem 可以由呼叫端換掉（共用題幹的填充題組）。 */
export function questionBlock(q: Question, options: QuestionBlockOptions = {}, stemOverride?: string): Block {
  const rich = options.rich ?? {};
  const cjk = isCjkStem(q);
  const fontSize = cjk ? SIZE.cjk : SIZE.body;
  const lineHeight = cjk ? LINE.instructions : LINE.question;
  const lh = lineHeightPt(fontSize, lineHeight);
  const numberText = options.numberText ?? questionNumberText(q);
  const numberWidth = numberText === '' ? 0 : numberColumnWidth(numberText, fontSize);
  const width = CONTENT_WIDTH - numberWidth;
  const right: PdfContent[] = [];
  let height = 0;

  const stem = options.hideStem ? '' : withoutLeadingNumber(stemOverride ?? q.stem ?? '', numberText);
  if (stem.trim() !== '') {
    const s = stemNodes(stem, fontSize, lineHeight, rich, width);
    right.push(...s.nodes);
    height += s.lines * lh;
  }
  if (q.options && (q.mode === 'single_choice' || q.mode === 'multi_select' || q.mode === 'bank_choice')) {
    const cells = optionCells(q.options);
    const block = optionsBlock(cells, chooseOptionLayout(cells), { rich, width });
    right.push(block.node);
    height += block.lines * lineHeightPt(SIZE.body, LINE.question);
  }
  if (options.answerLine) {
    right.push(answerLineNode(width));
    height += 20;
  }
  if (right.length === 0) right.push({ text: '' });
  height = Math.max(height, lh) + GAP.question;
  const node: PdfNode =
    numberText === ''
      ? { stack: right, margin: [0, 0, 0, GAP.question] }
      : {
          columns: [
            { width: numberWidth, text: plainInline(numberText), fontSize, lineHeight },
            { width: '*', stack: right },
          ],
          columnGap: 0,
          margin: [0, 0, 0, GAP.question],
        };
  return { node: maybeUnbreakable(node, height), height };
}

/** 作文：「提示：」懸掛縮排（題本如此）；資料的題幹已經以「提示︰」「題目：」開頭就照用。 */
export function compositionBlock(q: Question, rich: RichOptions = {}): Block {
  const stem = q.stem ?? '';
  const lead = splitLeadLabel(stem) ?? { label: PDF_TEXT.promptLabel, body: stem };
  const fontSize = SIZE.cjk;
  const lineHeight = LINE.instructions;
  const labelWidth = Math.ceil(textWidth(lead.label, fontSize));
  const s = stemNodes(lead.body, fontSize, lineHeight, rich, CONTENT_WIDTH - labelWidth);
  const height = s.lines * lineHeightPt(fontSize, lineHeight) + GAP.paragraph;
  return {
    node: {
      columns: [
        { width: labelWidth, text: plainInline(lead.label), fontSize, lineHeight },
        { width: '*', stack: s.nodes },
      ],
      columnGap: 0,
      margin: [0, 2, 0, GAP.paragraph],
    },
    height,
  };
}
