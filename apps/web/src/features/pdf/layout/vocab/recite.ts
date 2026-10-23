/**
 * 背誦版的對折表（docs/design/vocab-handout.md §3.4）。
 *
 *   遮中文（預設）：□｜No.｜英文＋詞類＋音標｜對折虛線｜中文（短釋義）
 *   遮英文：        □｜No.｜中文＋詞類　　　｜對折虛線｜英文
 * 對折線是第 4 欄的左框線（0.6 pt 虛線）；表格上方一行說明。
 *
 * 分組（每一級或每個首字母）各是一張表：第一列是粗體的分組列，設成表頭（headerRows: 1）並 keepWithHeaderRows: 1——
 * 分組列不會單獨落在頁底，換頁時新的一頁也會重印分組列；每一列都 dontBreakRows，不在列中間切開。
 * 不用 pageBreakBefore（§8.3）。
 */
import type { PdfContent, PdfInline, PdfNode, PdfTableLayout } from '../../engine/docTypes';
import type { HandoutGroup, VocabHandoutLayoutOptions } from '../../vocabTypes';
import { plainInline } from '../richInline';
import { COLOR, VLINE, VSIZE } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

/** 欄寬：□、No.、左半、右半（左右兩半平分剩下的寬度，對折線落在紙的中間附近）。 */
const CHECK_WIDTH = 10;
const NO_WIDTH = 22;
const FOLD_INDEX = 3;

function tableLayout(): PdfTableLayout {
  return {
    hLineWidth: (i) => (i === 0 ? 0 : 0.35),
    hLineColor: () => COLOR.hairline,
    vLineWidth: (i) => (i === FOLD_INDEX ? 0.6 : 0),
    vLineColor: () => '#666666',
    vLineStyle: (i) => (i === FOLD_INDEX ? { dash: { length: 3, space: 2 } } : null),
    paddingLeft: (i) => (i === FOLD_INDEX ? 8 : 3),
    paddingRight: () => 3,
    paddingTop: () => 2.5,
    paddingBottom: () => 2.5,
  };
}

function checkbox(): PdfNode {
  return { canvas: [{ type: 'rect', x: 0, y: 3, w: 8, h: 8, lineWidth: 0.6, lineColor: '#444444' }] };
}

/** 表格上方的說明與欄名。 */
export function reciteIntro(hide: VocabHandoutLayoutOptions['hide']): PdfContent[] {
  const left = hide === 'zh' ? VOCAB_PDF_TEXT.reciteHeader.en : VOCAB_PDF_TEXT.reciteHeader.zh;
  const right = hide === 'zh' ? VOCAB_PDF_TEXT.reciteHeader.zh : VOCAB_PDF_TEXT.reciteHeader.en;
  return [
    { text: plainInline(VOCAB_PDF_TEXT.reciteHowTo(hide)), fontSize: VSIZE.instructions, color: COLOR.muted, lineHeight: 1.3, margin: [0, 0, 0, 4] },
    {
      table: {
        widths: [CHECK_WIDTH, NO_WIDTH, '*', '*'],
        body: [['', { text: VOCAB_PDF_TEXT.reciteHeader.no, font: 'Tinos', fontSize: VSIZE.reciteSmall, color: COLOR.muted }, { text: plainInline(left), fontSize: VSIZE.reciteSmall, color: COLOR.muted }, { text: plainInline(right), fontSize: VSIZE.reciteSmall, color: COLOR.muted }]],
      },
      layout: { ...tableLayout(), hLineWidth: (i) => (i === 1 ? 0.8 : 0), hLineColor: () => COLOR.text },
      margin: [0, 0, 0, 2],
    },
  ];
}

function englishCell(w: HandoutGroup['words'][number], withIpa: boolean): PdfInline[] {
  const out: PdfInline[] = plainInline(w.word, { bold: true }).map((r) => ({ ...r, fontSize: VSIZE.reciteEn }));
  if (w.variants.length > 0) out.push(...plainInline(` / ${w.variants.join(' / ')}`).map((r) => ({ ...r, fontSize: VSIZE.reciteEn - 1 })));
  // 字、詞類、音標之間是一般空白：窄欄放不下時可以換行，不會超出欄寬。
  out.push({ text: `  ${w.pos}`, font: 'Tinos', italics: true, fontSize: VSIZE.reciteSmall, color: COLOR.muted });
  if (withIpa && w.ipa) out.push({ text: `  /${w.ipa}/`, font: 'Tinos', fontSize: VSIZE.reciteSmall + 0.5, color: COLOR.muted });
  return out;
}

function chineseCell(w: HandoutGroup['words'][number], withPos: boolean): PdfInline[] {
  const out: PdfInline[] = plainInline(w.gloss).map((r) => ({ ...r, fontSize: VSIZE.reciteZh }));
  if (withPos) out.push({ text: `  ${w.pos}`, font: 'Tinos', italics: true, fontSize: VSIZE.reciteSmall, color: COLOR.muted });
  return out;
}

/** 一個分組一張表。 */
export function reciteTables(groups: readonly HandoutGroup[], options: Pick<VocabHandoutLayoutOptions, 'hide' | 'ipa'>): PdfNode[] {
  return groups.map((g) => {
    const label: PdfInline[] = [...plainInline(g.heading, { bold: true }), ...(g.sub ? plainInline(`  ${g.sub}`, { bold: true }) : [])];
    const head: PdfContent[] = [{ text: label, fontSize: 10.5, colSpan: 4, fillColor: COLOR.tagFill, margin: [2, 0, 0, 0] }, '', '', ''];
    const rows: PdfContent[][] = g.words.map((w) => {
      const en: PdfNode = { text: englishCell(w, options.ipa), lineHeight: VLINE.recite };
      const zh: PdfNode = { text: chineseCell(w, options.hide === 'en'), lineHeight: VLINE.recite };
      return [checkbox(), { text: String(w.no), font: 'Tinos', fontSize: VSIZE.reciteSmall, color: COLOR.muted, margin: [0, 2, 0, 0] }, options.hide === 'zh' ? en : zh, options.hide === 'zh' ? zh : en];
    });
    return {
      table: { widths: [CHECK_WIDTH, NO_WIDTH, '*', '*'], headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, body: [head, ...rows] },
      layout: tableLayout(),
      margin: [0, 4, 0, 4],
    };
  });
}
