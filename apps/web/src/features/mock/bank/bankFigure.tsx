/**
 * 自組卷題目裡的圖（docs/design/bank-mock.md §6.2 的 renderFigure）：一定要傳給作答元件，不然現有的 FigureView 會把
 * 文字描述印成看得到的文字，而題庫的圖表描述常常直接說出答案（例如「1900 年最低的是巴西」就是那一篇第 4 題的答案）。
 *
 *   作文的圖（帶 svg 欄位）   寫作題庫的 BankFigure：<img src="data:image/svg+xml…">，安全規則同 bank-writing §4.6；
 *                              作文的描述只是情境說明，照常顯示
 *   閱讀的圖表（chart）       題庫練習的 ChartFigure 自己畫圖，文字描述只當 aria-label
 *   閱讀的表格（rows）        題庫練習的 TableFigure；拿掉文字描述（TableFigure 會把它放在「表格說明」裡）
 *
 * evidence：交卷後要在圖表、表格上標出的證據句（作答中傳空陣列，不提前標出答案）。
 */
import type { ReactNode } from 'react';
import type { PracticeFigure } from '../../../data/bank';
import type { Figure } from '../../../data/exams';
import { renderPracticeFigure } from '../../practice/components/PracticeFigure';
import { BankFigure } from '../../writing/bank/components/BankFigure';
import type { BankExamFigure } from './renumber';

export function renderBankFigure(figure: Figure, index: number, evidence: readonly string[]): ReactNode {
  const f = figure as BankExamFigure;
  if ('svg' in f) {
    return <BankFigure figure={{ kind: f.kind, label: f.label ?? null, caption: f.caption, description: f.description, rows: f.rows ?? null, svg: f.svg ?? null }} index={index} />;
  }
  if (f.chart) return renderPracticeFigure(f as PracticeFigure, evidence);
  if (f.rows && f.rows.length > 0) return renderPracticeFigure({ ...(f as PracticeFigure), description: '' }, evidence);
  return undefined;
}

/** QuestionExtras.renderFigure（作答中傳空陣列）。 */
export function bankFigureRenderer(evidence: readonly string[]): (figure: Figure, index: number) => ReactNode {
  return (figure, index) => renderBankFigure(figure, index, evidence);
}
