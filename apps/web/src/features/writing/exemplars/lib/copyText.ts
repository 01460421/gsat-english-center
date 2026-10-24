/**
 * 作文範文的純文字（複製與列印共用；docs/design/model-essays.md §1.11）。
 *
 *   - 「複製這一篇」：開頭標層級，接著範文本文，結尾一行 AI 聲明；**不含**常見的錯（學生最常整篇貼走的就是這一段，
 *     不能混進錯句）。
 *   - 「複製全部」：題目理解、構想、三篇（各附四項說明與升級建議）、常見的錯，開頭與結尾都有 AI 聲明。常見的錯每一則寫成
 *     三行「錯誤示範：…」「正確：…」「規則：…」，前面加小標「這個等級常見的錯（範文裡沒有）」，純文字也看得出哪一句是錯的。
 *   - 「你的作文」欄不進任何純文字（只在畫面上，§1.8 第 6 點）。
 * 純函式，元件把結果放進剪貼簿。
 */
import { ESSAY_CRITERIA, ESSAY_CRITERION_LABELS, EXEMPLAR_LEVELS, type ExemplarEssayView, type ExemplarLevel, type ExemplarSetView } from '@gsat/shared';
import { EXEMPLAR_COPY_DISCLAIMER, HIDDEN_TEXT, NEXT_TITLES, TYPICAL_ERRORS_PLAIN_TITLE, levelTitle } from '../labels';

/** 範文本文（段落之間空一行，貼到文書軟體比較好讀）。 */
function essayBody(e: ExemplarEssayView): string {
  if (e.text === null) return e.hidden ? HIDDEN_TEXT[e.hidden] : HIDDEN_TEXT.filtered;
  return e.text
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .join('\n\n');
}

/** 「複製這一篇」：層級＋本文＋AI 聲明（不含常見的錯）。 */
export function essayPlainText(view: ExemplarSetView, level: ExemplarLevel, title: string): string {
  const e = view.essays[EXEMPLAR_LEVELS.indexOf(level)]!;
  return [`${levelTitle(level)}（AI 範文）`, `題目：${title}`, '', essayBody(e), '', EXEMPLAR_COPY_DISCLAIMER].join('\n');
}

/** 常見的錯：小標＋每一則三行（純文字也標成錯誤示範）。沒有就是空陣列。 */
export function typicalErrorsPlainLines(view: ExemplarSetView): string[] {
  if (view.typical_errors.length === 0) return [];
  const out = [`【${TYPICAL_ERRORS_PLAIN_TITLE}】`];
  view.typical_errors.forEach((t, i) => {
    if (i > 0) out.push('');
    out.push(`錯誤示範：${t.wrong}`, `正確：${t.right}`, `規則：${t.zh}`);
  });
  return out;
}

/** 「複製全部」：開頭結尾都有 AI 聲明；常見的錯放在基礎版後面。 */
export function allPlainText(view: ExemplarSetView, title: string): string {
  const out: string[] = [EXEMPLAR_COPY_DISCLAIMER.replace(/^— /, ''), '', `作文範文：${title}`];
  if (view.task_reading_zh) out.push('', '【AI 怎麼理解這一題】', view.task_reading_zh);
  if (view.plan_zh) out.push('', '【三篇共用的構想】', view.plan_zh);
  view.essays.forEach((e) => {
    out.push('', `【${levelTitle(e.level)}】`, essayBody(e));
    if (e.text !== null) {
      out.push('', '四項為什麼是這個分數：');
      for (const c of ESSAY_CRITERIA) {
        if (e.criteria[c]) out.push(`- ${ESSAY_CRITERION_LABELS[c]}：${e.criteria[c]}`);
      }
      if (e.next_zh) out.push('', `${NEXT_TITLES[e.level]}：${e.next_zh}`);
    }
    if (e.level === 'basic') {
      const errors = typicalErrorsPlainLines(view);
      if (errors.length > 0) out.push('', ...errors);
    }
  });
  out.push('', EXEMPLAR_COPY_DISCLAIMER);
  return out.join('\n');
}
