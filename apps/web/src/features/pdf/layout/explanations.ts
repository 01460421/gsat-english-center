/**
 * 解析頁（本站自組卷的「教師卷」與「題本＋答案＋解析」，docs/design/bank-mock.md §7.4）：接在答案頁之後、從新的一頁開始。
 *
 *   - 依大題、題號印出每題的中文解析（題庫練習的 explanation_zh，題號已經換成本卷的題號）；中譯英印本站的解析；
 *   - 作文印本題的解析（有的話），再印一篇 AI 範文，標「AI 生成範文，僅供參考」。
 *
 * 解析是本站撰寫的內容，不受 D8 限制。PDF 字型是子集：解析含字型沒有的字時，先套用替代表（≠ 改成「不等於」…）；
 * 替代之後仍有缺字，那一題改印「（這一題的解析含 PDF 無法顯示的字，請到線上檢討試卷查看）」，不會印出方框。
 * 建置時 scripts/font-coverage.mjs 也會列出這些題組（只警告，不排除）。
 */
import type { Exam, Question } from '../../../data/exams';
import { missingGlyphs } from '../fontRuns';
import type { PdfContent, PdfNode } from '../engine/docTypes';
import type { SitePaperPdfMeta } from '../types';
import { LINE, PARAGRAPH_INDENT, SIZE } from './metrics';
import { questionNumberText } from './questions';
import { plainInline, richParagraphs, spacedInline } from './richInline';
import { SITE_PAPER_TEXT, substituteGlyphs } from './strings';

const BODY = 10;
const BODY_LINE = 1.35;
const NUMBER_WIDTH = 40;

/**
 * 答案頁、解析頁要印的本站文字（bank-mock §7.4、§7.6）：套用替代表（≠ → 不等於…）；替代之後仍有 PDF 字型沒有的字時
 * 回傳 null，由呼叫端改印替代說明（不印出方框）。答案頁的答案、參考譯文、評分重點與解析頁的範文都經過這裡。
 */
export function printableSiteText(text: string): string | null {
  const out = substituteGlyphs(text);
  return missingGlyphs(out).length > 0 ? null : out;
}

/**
 * 要印的解析文字：套用替代表；仍有字型沒有的字、或沒有解析（null、空白）時回傳「請到線上檢討試卷查看」的說明。
 * 第二個回傳值表示是不是改印了說明（測試與 pdf-render-check 用）。
 */
export function printableExplanation(text: string | null | undefined): { text: string; replaced: boolean } {
  const raw = (text ?? '').trim();
  const out = raw === '' ? null : printableSiteText(raw);
  return out === null ? { text: SITE_PAPER_TEXT.explanationMissing, replaced: true } : { text: out, replaced: false };
}

function heading(text: string): PdfNode {
  return { text: spacedInline(text, { bold: true, spacing: 1 }), fontSize: 11.5, lineHeight: 1.2, margin: [0, 8, 0, 4] };
}

/** 一題的解析：題號懸掛在左。 */
function explanationRow(q: Question, text: string | null | undefined): PdfNode {
  const number = questionNumberText(q) || `${q.label}.`;
  return {
    columns: [
      { width: NUMBER_WIDTH, text: plainInline(number), fontSize: BODY, lineHeight: BODY_LINE },
      { width: '*', text: plainInline(printableExplanation(text).text), fontSize: BODY, lineHeight: BODY_LINE, alignment: 'justify' },
    ],
    columnGap: 0,
    margin: [0, 0, 0, 4],
    unbreakable: true,
  };
}

/**
 * AI 範文：標題、「AI 生成範文，僅供參考」，英文段落照選文的排法（首行縮排、左右對齊）。
 * 範文替代之後仍有 PDF 字型沒有的字時，整篇改印替代說明（同解析，§7.4）。
 */
function modelTextBlock(modelText: string): PdfContent[] {
  const printable = printableSiteText(modelText.trim());
  const paragraphs = printable === null ? [plainInline(SITE_PAPER_TEXT.modelTextMissing)] : richParagraphs(printable).filter((p) => p.length > 0);
  return [
    {
      stack: [
        { text: spacedInline(SITE_PAPER_TEXT.modelTextTitle, { bold: true, spacing: 1 }), fontSize: 11.5, lineHeight: 1.2, margin: [0, 10, 0, 2] },
        { text: plainInline(SITE_PAPER_TEXT.modelTextNote), fontSize: 8.5, color: '#555555', margin: [0, 0, 0, 4] },
        ...paragraphs.slice(0, 1).map((inlines) => ({ text: inlines, fontSize: SIZE.body, lineHeight: LINE.passage, alignment: 'justify' as const, leadingIndent: PARAGRAPH_INDENT, margin: [0, 0, 0, 4] as [number, number, number, number] })),
      ],
      unbreakable: true,
    },
    ...paragraphs.slice(1).map((inlines) => ({ text: inlines, fontSize: SIZE.body, lineHeight: LINE.passage, alignment: 'justify' as const, leadingIndent: PARAGRAPH_INDENT, margin: [0, 0, 0, 4] as [number, number, number, number] })),
  ];
}

/** 解析頁的內容（新的一節）。 */
export function explanationsContent(exam: Exam, site: SitePaperPdfMeta): PdfContent[] {
  const content: PdfContent[] = [
    { text: spacedInline(SITE_PAPER_TEXT.explanationsTitle, { bold: true, spacing: 6 }), fontSize: 18, alignment: 'center', margin: [0, 0, 0, 8] },
  ];
  const explanations = site.answers.explanations;
  for (const section of exam.sections) {
    const questions = section.groups.flatMap((g) => g.questions);
    if (questions.length === 0) continue;
    if (questions.every((q) => q.mode === 'composition')) {
      // 作文沒有題號；有解析就印一段，再接範文。
      const block: PdfContent[] = [heading(section.title)];
      const text = questions.map((q) => explanations[q.label]).find((t) => (t ?? '').trim() !== '');
      if (text) block.push({ text: plainInline(printableExplanation(text).text), fontSize: BODY, lineHeight: BODY_LINE, alignment: 'justify', margin: [0, 0, 0, 4] });
      content.push({ stack: block, unbreakable: true });
      if (site.answers.composition.modelText) content.push(...modelTextBlock(site.answers.composition.modelText));
      continue;
    }
    const [first, ...rest] = questions.map((q) => explanationRow(q, explanations[q.label]));
    // 標題和第一題綁在一起，標題不會落在頁底。
    content.push({ stack: [heading(section.title), ...(first ? [first] : [])], unbreakable: true }, ...rest);
  }
  return content;
}
