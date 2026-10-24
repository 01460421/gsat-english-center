/**
 * 三版對照（docs/design/model-essays.md §1.8 第 6 點、§2.6、§8.5）：數字都由程式算（ExemplarEssayView.metrics；後處理用 shared 的
 * exemplarMetrics()），轉承詞是本站清單比對的次數與種類數，標「約略值」，不加好壞判斷；AI 標出的亮點個數不放進來。
 *
 * 從批改結果頁帶 ?sub= 進來而且題目相符時多一欄「你的作文」（同一支 exemplarMetrics() 在前端算）與一列「分數」
 * （你的最後分數對照三級的目標帶）。這一欄只在畫面上：不印（列印檢視不傳 your）、不複製、不送任何地方。
 * 真的 <table>：<caption>、欄頭 scope="col"、列頭 scope="row"；這一欄不存在時表格結構不變。窄螢幕可以左右捲動（有名稱與焦點）。
 */
import { ESSAY_MAX_SCORE, type ExemplarMetrics, type ExemplarSetView } from '@gsat/shared';
import type { ReactNode } from 'react';
import { formatScore } from '../../lib/format';
import { YOUR_ESSAY_LABEL, YOUR_ESSAY_NOTE, levelBand, levelLabel } from '../labels';
import type { YourEssay } from '../lib/yourEssay';

interface Row {
  label: string;
  cell: (m: ExemplarMetrics) => ReactNode;
}

const ROWS: Row[] = [
  { label: '字數', cell: (m) => m.words },
  { label: '段數', cell: (m) => m.paragraphs },
  { label: '句數', cell: (m) => m.sentences },
  { label: '平均句長（字）', cell: (m) => m.avg_sentence_words },
  { label: '最長句（字）', cell: (m) => m.longest_sentence_words },
  { label: '轉承詞（次／種）', cell: (m) => `${m.connectives}／${m.connective_kinds}` },
];

export function ExemplarCompareTable({ view, your = null, headingLevel = 2 }: { view: ExemplarSetView; your?: YourEssay | null; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby="exemplar-compare-h" className="space-y-2">
      <Heading id="exemplar-compare-h" className="text-lg font-semibold">
        三版對照
      </Heading>
      <div className="overflow-x-auto rounded-xl border border-line" role="region" aria-label="三版對照的表格" tabIndex={0}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">三版對照（本站計算）</caption>
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                項目
              </th>
              {view.essays.map((e) => (
                <th key={e.level} scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {levelLabel(e.level)}
                </th>
              ))}
              {your && (
                <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                  {YOUR_ESSAY_LABEL}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {your && (
              <tr className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  分數
                </th>
                {view.essays.map((e) => (
                  <td key={e.level} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    目標 {levelBand(e.level)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                  {your.score === null ? '—' : `你的分數 ${formatScore(your.score)}／${ESSAY_MAX_SCORE}`}
                </td>
              </tr>
            )}
            {ROWS.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">
                  {r.label}
                </th>
                {view.essays.map((e) => (
                  <td key={e.level} className="px-3 py-2 text-right tabular-nums">
                    {r.cell(e.metrics)}
                  </td>
                ))}
                {your && <td className="px-3 py-2 text-right tabular-nums">{r.cell(your.metrics)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">本站計算；轉承詞依本站轉承詞清單比對，是約略值。字數是英文單詞數，句數與句長只算正文段。</p>
      {your && <p className="text-sm text-muted">{YOUR_ESSAY_NOTE}</p>}
    </section>
  );
}
