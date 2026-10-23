/**
 * 講義頁數的估計（docs/design/vocab-handout.md §8.1）：講義頁的摘要「約 16 頁」與進度「排版中（約 16 頁）…」用。
 * 係數是用 scripts/pdf-render-check.mjs --ids vocab 實際產生的 PDF 校正過的值（見設計文件的實作備註，誤差多在 ±1 頁）；
 * 只求量級正確，不必準到一頁。PDF 模組在 lazy chunk 裡，所以這裡不能用版面程式的高度估計。
 */
import type { VocabHandoutPdfData } from '../../pdf/vocabTypes';

/** 每頁大約排得下的數量（實測校正）。 */
export const PER_PAGE = {
  /** 講義版一欄、有例句的字（含標題區的第 1 頁按 0.75 頁算）。 */
  notesWithExamples: 8,
  /** 講義版一欄、沒有例句的字（不附例句，或找不到可用的例句）。 */
  notesPlain: 14,
  /** 講義版兩欄。 */
  notesTwoColumns: 30,
  recite: 32,
  cloze: 22,
  clozeWithZh: 16,
  spelling: 32,
  choice: 15,
  /** 答案速查表（每格一題）。 */
  keyGrid: 160,
  /** 句意填空詳解。 */
  keyDetails: 16,
  /** 拼字、英選中的答案列（兩欄）。 */
  keyRows: 70,
} as const;

export interface PageEstimate {
  /** 標題區＋條目（或對折表）＋練習＋資料來源。 */
  main: number;
  /** 答案（另外編頁）。 */
  key: number;
  total: number;
}

export function estimatePages(data: Pick<VocabHandoutPdfData, 'kind' | 'groups' | 'cloze' | 'spelling' | 'choice' | 'options' | 'credits'>): PageEstimate {
  const words = data.groups.reduce((sum, g) => sum + g.words.length, 0);
  const o = data.options;
  let body = 0;
  if (data.kind === 'notes') {
    const load =
      o.columns === 2
        ? words / PER_PAGE.notesTwoColumns
        : data.groups.reduce((sum, g) => sum + g.words.reduce((n, w) => n + 1 / (w.example ? PER_PAGE.notesWithExamples : PER_PAGE.notesPlain), 0), 0);
    body = Math.max(1, Math.ceil(load + 0.25));
  } else if (data.kind === 'recite') {
    body = Math.max(1, Math.ceil(words / PER_PAGE.recite + 0.2));
  }
  const clozePer = o.clozeZh ? PER_PAGE.clozeWithZh : PER_PAGE.cloze;
  // 句意填空卷與測驗卷的練習接在標題區後面（第 1 頁少排約四分之一）。
  const exerciseLoad = data.cloze.length / clozePer + data.spelling.length / PER_PAGE.spelling + data.choice.length / PER_PAGE.choice + (body === 0 ? 0.25 : 0);
  const exercise = Math.max(1, Math.ceil(exerciseLoad));
  // 用到 Open English WordNet 時多印 Princeton WordNet 的授權聲明全文（約多一頁）。
  const sources = data.credits.wordnet || data.credits.wordnetIpa.length > 0 ? 2 : 1;
  let key = 0;
  if (o.answerKey) {
    const items = data.cloze.length + data.spelling.length + data.choice.length;
    key = Math.ceil(items / PER_PAGE.keyGrid + (o.keyDetails ? data.cloze.length / PER_PAGE.keyDetails : 0) + (data.spelling.length + data.choice.length) / PER_PAGE.keyRows + 0.1);
    key = Math.max(1, key);
  }
  const main = body + exercise + sources;
  const blanks = o.duplex ? 1.5 : 0;
  return { main, key, total: Math.round(main + key + blanks) };
}
