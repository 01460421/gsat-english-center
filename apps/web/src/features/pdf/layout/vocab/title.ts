/**
 * 標題區（第 1 頁上方，不另印封面頁，docs/design/vocab-handout.md §3.2）：
 *   第一行「學測英文中心　單字講義」→ 標題「Level 4　第 201–300 字」→ 說明行（字數、題數、製作日期、講義代號）→
 *   班級、座號、姓名欄（測驗卷另加得分，可以關掉）→ 使用方式一行（句意填空從第幾頁起，用 pdfmake 的 pageReference 填頁碼）。
 */
import type { PdfContent, PdfInline } from '../../engine/docTypes';
import type { VocabHandoutPdfData } from '../../vocabTypes';
import { fieldRow } from '../nodes';
import { plainInline, spacedInline } from '../richInline';
import { COLOR, VOCAB_CONTENT_WIDTH, VSIZE } from './metrics';
import { VOCAB_PDF_TEXT } from './strings';

/** 練習段第一個節點的 id（使用方式那一行用 pageReference 指到這裡；雙面列印時改用 duplex 的 id，頁碼不寫）。 */
export const EXERCISE_ANCHOR = 'vocab-exercise-start';

export function titleContent(data: VocabHandoutPdfData, options: { exerciseAnchor: string | null }): PdfContent[] {
  const out: PdfContent[] = [
    { text: spacedInline(data.kicker, { spacing: 2 }), fontSize: VSIZE.kicker, color: COLOR.muted, margin: [0, 0, 0, 2] },
    { text: plainInline(data.title, { bold: true }), fontSize: VSIZE.title, lineHeight: 1.1, margin: [0, 0, 0, 3] },
    { text: plainInline(`${data.meta}・${VOCAB_PDF_TEXT.codeLabel(data.code)}`), fontSize: VSIZE.meta, color: COLOR.muted, margin: [0, 0, 0, 8] },
  ];
  if (data.options.nameFields) {
    const labels = data.kind === 'quiz' ? [...VOCAB_PDF_TEXT.nameFields, VOCAB_PDF_TEXT.scoreField] : [...VOCAB_PDF_TEXT.nameFields];
    out.push(fieldRow(labels, VSIZE.fields, { width: VOCAB_CONTENT_WIDTH, gap: 14, margin: [0, 0, 0, 8] }));
  }
  // 測驗卷實際印出的部分數：句意填空一定有，拼字、英選中沒有題目時不印那一部分。
  const parts = 1 + (data.spelling.length > 0 ? 1 : 0) + (data.choice.length > 0 ? 1 : 0);
  const howTo = { text: plainInline(VOCAB_PDF_TEXT.howTo(data.kind, data.options.answerKey, data.options.examples && data.options.columns === 1, parts)), fontSize: VSIZE.howTo, lineHeight: 1.3 };
  // 「句意填空起始頁：N」放在右邊自己一格：pdfmake 只替換文字節點第一行裡的 pageReference（0.3.11 的 LayoutBuilder），
  // 和使用方式寫在同一段時，換到第二行就會印出佔位的 00000。寬度用 auto，頁碼在最後（佔位字比頁碼寬，後面留白不影響）。
  const row: PdfContent[] = [howTo];
  if (options.exerciseAnchor) {
    const page: PdfInline[] = [...plainInline(VOCAB_PDF_TEXT.exercisePage), { text: '00', pageReference: options.exerciseAnchor, font: 'Tinos', bold: true }];
    row.push({ text: page, fontSize: VSIZE.howTo, lineHeight: 1.3, noWrap: true });
  }
  out.push({
    table: { widths: options.exerciseAnchor ? ['*', 'auto'] : ['*'], body: [row] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i) => (i === 0 ? 2 : 0),
      vLineColor: () => COLOR.rule,
      paddingLeft: () => 8,
      paddingRight: () => 6,
      paddingTop: () => 3,
      paddingBottom: () => 3,
      fillColor: () => COLOR.boxFill,
    },
    margin: [0, 0, 0, 6],
  });
  out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: VOCAB_CONTENT_WIDTH, y2: 0, lineWidth: 1, lineColor: COLOR.text }], margin: [0, 2, 0, 10] });
  return out;
}
