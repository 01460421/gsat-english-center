/**
 * 講義版的單字條目（docs/design/vocab-handout.md §3.3）。
 *
 * 一欄（預設）：每個字是一個不跨頁的區塊——
 *   #12  choose  /tʃuːz/  v.  L1                                   歷屆 40 次
 *        及物 選擇, 寧願, 欲；不及物 作出選擇, 願意
 *        衍生字 achievement /əˈtʃiːvmənt/ n. 成就, 完成
 *        不規則變化 chose（過去式）・chosen（過去分詞）　同詞族 creative L4・creation L4
 *        It took her a long time to choose a hat.（目標字粗體）
 *        她花了好長時間挑帽子。
 *        Tatoeba #315866 by CK · 中文 Tatoeba #2411906 by User5120
 * 兩欄（選用）：不印例句，兩個條目並排成一列，每列不跨頁。
 *
 * 分組：每一級前印「Level 4」，同一級依首字母加小標「A」。標題一律和後面第一個條目包成不跨頁的區塊（flowBlocks 的
 * keepWithNext 合併），不登記 pageBreakBefore（§8.3：pdfmake 每遇到一次換頁回呼就要重排整份文件）。
 */
import type { PdfContent, PdfInline, PdfNode } from '../../engine/docTypes';
import type { HandoutGroup, HandoutWord, VocabHandoutLayoutOptions } from '../../vocabTypes';
import { maybeUnbreakable, type Block } from '../blocks';
import { estimateLineCount, estimateTextHeight } from '../estimate';
import { plainInline } from '../richInline';
import { KEEP_SPACES, attributionInlines, breakableGap, exampleEnInlines, hairline, joinInlines, levelBox, levelTag, nbsp, rule, unitInlines } from './inlines';
import { COLOR, ENTRY_NO_WIDTH, VLINE, VOCAB_CONTENT_WIDTH, VSIZE, lineHeightPt } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

const BODY_WIDTH = VOCAB_CONTENT_WIDTH - ENTRY_NO_WIDTH;
/** 字頭行各部分（字、音標、詞類、級別）之間：一般空白，窄欄放不下時可以在這裡換行。 */
const GAP = '  ';
const COLUMN_GAP = 18;
const HALF_WIDTH = (VOCAB_CONTENT_WIDTH - COLUMN_GAP) / 2;

/** 「Level 4」：14 pt 粗體＋下方粗線。 */
export function levelHeadingBlock(text: string, first: boolean): Block {
  const top = first ? 0 : 8;
  return {
    node: { stack: [{ text: plainInline(text, { bold: true }), fontSize: VSIZE.levelHeading, lineHeight: 1.1 }, rule([0, 2, 0, 4])], margin: [0, top, 0, 0] },
    height: top + lineHeightPt(VSIZE.levelHeading, 1.1) + 7,
    keepWithNext: true,
  };
}

/** 首字母小標「A」：粗體字母＋右側細線。 */
export function letterHeadingBlock(letter: string): Block {
  return {
    node: {
      columns: [
        { width: 'auto', text: plainInline(letter, { bold: true }), fontSize: VSIZE.letterHeading },
        { width: '*', canvas: [{ type: 'line', x1: 6, y1: 8.5, x2: VOCAB_CONTENT_WIDTH - 20, y2: 8.5, lineWidth: 0.5, lineColor: COLOR.rule }] },
      ],
      columnGap: 0,
      margin: [0, 4, 0, 2],
    },
    height: lineHeightPt(VSIZE.letterHeading, 1) + 6,
    keepWithNext: true,
  };
}

/** 字頭行的片段：字、其他寫法、音標、詞類、級別。 */
function headInlines(w: HandoutWord, size: { word: number; small: number; tag?: boolean }): PdfInline[] {
  const out: PdfInline[] = plainInline(w.word, { bold: true }).map((r) => ({ ...r, fontSize: size.word }));
  if (w.variants.length > 0) out.push(...plainInline(` / ${w.variants.join(' / ')}`).map((r) => ({ ...r, fontSize: size.word - 2 })));
  if (w.ipa) out.push({ text: `${GAP}/${w.ipa}/`, font: 'Tinos', fontSize: size.small + 0.5, color: COLOR.muted });
  out.push({ text: `${GAP}${w.pos}`, font: 'Tinos', italics: true, fontSize: size.small, color: COLOR.muted });
  if (size.tag) out.push(breakableGap(2, { fontSize: size.small }), levelTag(w.level, size.small - 1.5));
  return out;
}

/** 小標＋不換行空白（「及物 」「同詞族 」）：小標不從中間斷開，也和後面第一個字黏在一起換行。 */
function labelUnit(text: string): PdfInline[] {
  return unitInlines(`${text} `).map((r) => ({ ...r, fontSize: VSIZE.senseLabel, color: COLOR.muted }));
}

function sensesInlines(w: HandoutWord, fontSize: number): PdfInline[] {
  return joinInlines(
    w.senses.map((s) => [...(s.label ? labelUnit(s.label) : []), ...plainInline(s.text).map((r) => ({ ...r, fontSize }))]),
    plainInline(VOCAB_PDF_TEXT.senseSeparator).map((r) => ({ ...r, fontSize })),
  );
}

function sensesText(w: HandoutWord): string {
  return w.senses.map((s) => `${s.label ?? ''} ${s.text}`).join(VOCAB_PDF_TEXT.senseSeparator);
}

/** 不規則變化、同詞族、同義反義（一行，都沒有時回傳 null）。 */
function extraInlines(w: HandoutWord): { inlines: PdfInline[]; text: string } | null {
  const groups: PdfInline[][] = [];
  const texts: string[] = [];
  const sep = plainInline(VOCAB_PDF_TEXT.itemSeparator);
  if (w.irregular.length > 0) {
    groups.push([
      ...labelUnit(VOCAB_PDF_TEXT.irregularLabel),
      ...joinInlines(
        w.irregular.map((f) => [...plainInline(f.form, { bold: true }), ...plainInline(VOCAB_PDF_TEXT.paren(f.label)).map((r) => ({ ...r, color: COLOR.muted }))]),
        sep,
      ),
    ]);
    texts.push(`${VOCAB_PDF_TEXT.irregularLabel} ${w.irregular.map((f) => `${f.form}${VOCAB_PDF_TEXT.paren(f.label)}`).join(VOCAB_PDF_TEXT.itemSeparator)}`);
  }
  if (w.family.length > 0) {
    groups.push([...labelUnit(VOCAB_PDF_TEXT.familyLabel), ...joinInlines(w.family.map((f) => [...plainInline(f.word), nbsp(), levelTag(f.level, 7)]), sep)]);
    texts.push(`${VOCAB_PDF_TEXT.familyLabel} ${w.family.map((f) => `${f.word} L${f.level}`).join(VOCAB_PDF_TEXT.itemSeparator)}`);
  }
  if (w.related && w.related.synonyms.length > 0) {
    groups.push([...labelUnit(VOCAB_PDF_TEXT.synonymsLabel), ...plainInline(w.related.synonyms.join(', '))]);
    texts.push(`${VOCAB_PDF_TEXT.synonymsLabel} ${w.related.synonyms.join(', ')}`);
  }
  if (w.related && w.related.antonyms.length > 0) {
    groups.push([...labelUnit(VOCAB_PDF_TEXT.antonymsLabel), ...plainInline(w.related.antonyms.join(', '))]);
    texts.push(`${VOCAB_PDF_TEXT.antonymsLabel} ${w.related.antonyms.join(', ')}`);
  }
  if (groups.length === 0) return null;
  // 各組之間是可以換行的空白：放不下時整組（小標＋第一個字）換到下一行。
  return { inlines: joinInlines(groups, [breakableGap(3)]), text: texts.join(VOCAB_PDF_TEXT.wideSpace) };
}

/** 一欄的條目區塊。 */
export function entryBlock(w: HandoutWord, last: boolean): Block {
  const stack: PdfContent[] = [];
  let height = 0;
  const headLh = lineHeightPt(VSIZE.headword, 1.1);
  // 右側：歷屆次數＋級別細框標籤（每個條目都在同一個位置，掃一眼就看得到級別）。
  const side: PdfContent[] = [];
  if (w.examTotal > 0) side.push({ width: 'auto', text: plainInline(VOCAB_PDF_TEXT.examTotal(w.examTotal)), fontSize: VSIZE.examTotal, color: COLOR.muted, margin: [0, 1.5, 0, 0] });
  side.push({ width: 'auto', stack: [levelBox(w.level)] });
  stack.push({
    columns: [
      { width: ENTRY_NO_WIDTH, text: `#${w.no}`, font: 'Tinos', fontSize: VSIZE.entryNo, color: COLOR.muted, margin: [0, 4, 0, 0] },
      { width: '*', text: headInlines(w, { word: VSIZE.headword, small: VSIZE.pos }), lineHeight: 1.1 },
      { width: 'auto', columns: side, columnGap: 6, margin: [8, 3, 0, 0] },
    ],
    columnGap: 0,
  });
  height += headLh * estimateLineCount(`${w.word} / ${w.variants.join(' / ')} /${w.ipa ?? ''}/ ${w.pos} L1`, BODY_WIDTH - 60, VSIZE.headword);

  const body: PdfContent[] = [];
  const senseText = sensesText(w);
  body.push({ text: sensesInlines(w, VSIZE.sense), fontSize: VSIZE.sense, lineHeight: VLINE.entry, margin: [0, 1, 0, 0] });
  height += estimateTextHeight(senseText, BODY_WIDTH, VSIZE.sense, VLINE.entry) + 1;
  for (const d of w.derived) {
    const inl: PdfInline[] = [...labelUnit(VOCAB_PDF_TEXT.derivedLabel), ...plainInline(d.form, { bold: true })];
    if (d.ipa) inl.push({ text: ` /${d.ipa}/`, font: 'Tinos', color: COLOR.muted });
    inl.push(breakableGap(1), ...plainInline(d.zh));
    body.push({ text: inl, fontSize: VSIZE.derived, lineHeight: VLINE.entry });
    height += estimateTextHeight(`${VOCAB_PDF_TEXT.derivedLabel} ${d.form} /${d.ipa ?? ''}/ ${d.zh}`, BODY_WIDTH, VSIZE.derived, VLINE.entry);
  }
  const extra = extraInlines(w);
  if (extra) {
    body.push({ text: extra.inlines, fontSize: VSIZE.extra, lineHeight: VLINE.entry, margin: [0, 1, 0, 0] });
    height += estimateTextHeight(extra.text, BODY_WIDTH, VSIZE.extra, VLINE.entry) + 1;
  }
  if (w.example) {
    const ex = w.example;
    const en = ex.parts.map((p) => p.text).join('');
    const attr = attributionInlines({ en: ex.attribution, enUrl: ex.url, zh: ex.zhAttribution, zhUrl: ex.zhUrl, zhConverted: ex.zhConverted }, { link: true });
    body.push(
      { text: exampleEnInlines(ex), fontSize: VSIZE.exampleEn, lineHeight: VLINE.example, margin: [0, 3, 0, 0] },
      { text: plainInline(ex.zh), fontSize: VSIZE.exampleZh, lineHeight: VLINE.example, color: '#333333' },
      { text: attr, fontSize: VSIZE.attribution, color: COLOR.faint, lineHeight: 1.15 },
    );
    height += 3 + estimateTextHeight(en, BODY_WIDTH, VSIZE.exampleEn, VLINE.example) + estimateTextHeight(ex.zh, BODY_WIDTH, VSIZE.exampleZh, VLINE.example);
    height += estimateTextHeight(`${ex.attribution} · ${ex.zhAttribution}${ex.zhConverted ? ` · ${VOCAB_PDF_TEXT.zhConverted}` : ''}`, BODY_WIDTH, VSIZE.attribution, 1.15);
  }
  stack.push({ stack: body, margin: [ENTRY_NO_WIDTH, 0, 0, 0] });
  if (!last) {
    stack.push(hairline([0, 5, 0, 5]));
    height += 10.5;
  } else {
    height += 4;
  }
  return { node: maybeUnbreakable({ stack, unbreakable: true }, height), height };
}

/** 兩欄用的精簡條目（不印例句）。 */
function compactEntry(w: HandoutWord): { node: PdfNode; height: number } {
  const width = HALF_WIDTH;
  const head: PdfInline[] = [{ text: `#${w.no}\u00A0`, font: 'Tinos', fontSize: VSIZE.entryNo, color: COLOR.muted, ...KEEP_SPACES }, ...headInlines(w, { word: 11.5, small: 9, tag: true })];
  const stack: PdfContent[] = [{ text: head, lineHeight: 1.1 }];
  let height = lineHeightPt(11.5, 1.1) * estimateLineCount(`#${w.no} ${w.word} /${w.ipa ?? ''}/ ${w.pos} L1`, width, 11.5);
  stack.push({ text: sensesInlines(w, 9.5), fontSize: 9.5, lineHeight: 1.2 });
  height += estimateTextHeight(sensesText(w), width, 9.5, 1.2);
  const extra = extraInlines(w);
  if (extra) {
    stack.push({ text: extra.inlines, fontSize: 8.5, lineHeight: 1.2 });
    height += estimateTextHeight(extra.text, width, 8.5, 1.2);
  }
  return { node: { stack }, height };
}

/** 講義版的所有條目區塊（含分組標題）。 */
export function wordBlocks(groups: readonly HandoutGroup[], options: Pick<VocabHandoutLayoutOptions, 'columns'>): Block[] {
  const blocks: Block[] = [];
  let level: string | null = null;
  groups.forEach((g, gi) => {
    if (g.heading !== level) {
      blocks.push(levelHeadingBlock(g.heading, level === null));
      level = g.heading;
    }
    if (g.sub) blocks.push(letterHeadingBlock(g.sub));
    const nextHeading = groups[gi + 1];
    const endOfLevel = !nextHeading || nextHeading.heading !== g.heading || nextHeading.sub !== null;
    if (options.columns === 2) {
      for (let i = 0; i < g.words.length; i += 2) {
        const pair = g.words.slice(i, i + 2).map(compactEntry);
        const height = Math.max(...pair.map((p) => p.height));
        const lastRow = i + 2 >= g.words.length;
        const row: PdfNode = {
          stack: [
            { columns: [{ width: HALF_WIDTH, stack: [pair[0]?.node ?? ''] }, { width: HALF_WIDTH, stack: [pair[1]?.node ?? ''] }], columnGap: COLUMN_GAP },
            ...(lastRow && endOfLevel ? [] : [hairline([0, 4, 0, 4])]),
          ],
          unbreakable: true,
        };
        blocks.push({ node: row, height: height + (lastRow && endOfLevel ? 2 : 8.5) });
      }
    } else {
      g.words.forEach((w, i) => blocks.push(entryBlock(w, i === g.words.length - 1 && endOfLevel)));
    }
  });
  return blocks;
}
