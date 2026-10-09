/**
 * 閱讀、混合題選文裡的圖：圖表（figure.chart，自己畫的 SVG）與表格（kind: table＋rows，響應式表格）。
 * 其他的圖（看文選圖的配圖等，只有文字描述）沿用歷屆試題的 FigureView。
 *
 * 交卷後，解析的證據句引用到的資料點（圖表文字版的一行、資料表或表格的一列）會在圖上加粗框、在資料表裡加底色。
 */
import { ArrowLeftRight, ExternalLink } from 'lucide-react';
import { Fragment, useId, useMemo } from 'react';
import type { ChartSpec, PracticeFigure } from '../../../data/bank';
import { figureKindLabel } from '../../exams/labels';
import {
  CHART_TYPE_LABELS,
  chartSummary,
  chartTableRows,
  displayNumber,
  evidencePoints,
  evidenceRows,
  pointKey,
} from '../chart';
import { ChartView } from './Chart';
import { LicenseLink } from './LicenseLink';

function FigureHeading({ figure, kind }: { figure: PracticeFigure; kind: string }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{kind}</span>
      {figure.label && (
        <span lang="en" className="font-medium">
          {figure.label}
        </span>
      )}
      {figure.question_no != null && <span className="text-xs text-muted">第 {figure.question_no} 題用</span>}
    </span>
  );
}

/** 「⇄ 資料表」：圖表的數字（第一列表頭）；交卷後證據引用到的列加底色。 */
export function ChartDataTable({ chart, highlight }: { chart: ChartSpec; highlight: ReadonlySet<string> }) {
  const [head = [], ...body] = chartTableRows(chart);
  const pie = chart.type === 'pie';
  const values = chart.series[0]?.values ?? [];
  const total = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const showShare = pie && chart.y.unit !== '%' && total > 0;
  return (
    <details className="text-sm" data-testid="chart-data-table">
      <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 font-medium text-primary">
        <ArrowLeftRight aria-hidden="true" className="size-4" />
        資料表
        <span className="text-xs font-normal text-muted">（{body.length} 列，可給螢幕閱讀器讀）</span>
      </summary>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label="資料表內容">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {CHART_TYPE_LABELS[chart.type]}「{chart.title}」的資料
          </caption>
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} scope="col" lang="en" className={`border-b border-line px-3 py-2 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {cell}
                </th>
              ))}
              {showShare && (
                <th scope="col" className="border-b border-line px-3 py-2 text-right font-semibold">
                  占比
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {chart.categories.map((category, ci) => {
              const hit = chart.series.some((_, si) => highlight.has(pointKey(ci, si)));
              return (
                <tr key={ci} className={`border-b border-line last:border-0 ${hit ? 'bg-badge-bg text-badge-fg' : ''}`}>
                  <th scope="row" lang="en" className="px-3 py-2 text-left font-medium">
                    {category}
                    {hit && <span className="ml-1 text-xs font-semibold">（解析引用）</span>}
                  </th>
                  {chart.series.map((s, si) => (
                    <td key={si} className="px-3 py-2 text-right tabular-nums">
                      {s.values[ci] === undefined ? '' : displayNumber(s.values[ci])}
                    </td>
                  ))}
                  {showShare && (
                    <td className="px-3 py-2 text-right tabular-nums">
                      {(values[ci] ?? 0) > 0 ? `${Math.round(((values[ci] ?? 0) / total) * 1000) / 10}%` : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** 圖表題的圖：標題、圖例、SVG、讀數、附註、資料來源與資料表。 */
export function ChartFigure({ figure, chart, evidence }: { figure: PracticeFigure; chart: ChartSpec; evidence: readonly string[] }) {
  const titleId = useId();
  const highlight = useMemo(() => evidencePoints(chart, evidence), [chart, evidence]);
  const label = `${CHART_TYPE_LABELS[chart.type]}：${chart.title}。${figure.description.trim() || chartSummary(chart)}`;
  const caption = figure.caption && figure.caption.trim() !== chart.title.trim() ? figure.caption : null;
  const src = chart.source;
  return (
    <figure aria-labelledby={titleId} className="space-y-2 rounded-xl border border-line bg-surface-2 p-3 text-[0.95rem]" data-testid="chart-figure">
      <figcaption className="space-y-1">
        <FigureHeading figure={figure} kind={`圖表・${CHART_TYPE_LABELS[chart.type]}`} />
        <span id={titleId} lang="en" className="block font-semibold break-words">
          {chart.title}
        </span>
        {caption && (
          <span lang="en" className="block text-sm text-muted break-words">
            {caption}
          </span>
        )}
      </figcaption>
      <ChartView chart={chart} label={label} highlight={highlight} />
      {highlight.size > 0 && <p className="text-xs text-muted">粗框標出的是解析引用的數據（資料表裡同一列加了底色）。</p>}
      {chart.note && (
        <p className="text-xs text-muted">
          附註：<span lang="en">{chart.note}</span>
        </p>
      )}
      <p className="text-xs text-muted break-words" data-testid="chart-source">
        資料來源：
        <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.title} className="inline-flex items-center gap-0.5 text-primary underline">
          <span lang="en">{src.publisher}</span>
          <ExternalLink aria-hidden="true" className="size-3" />
          <span className="sr-only">（另開新分頁）</span>
        </a>
        {/* 括號和授權名稱一起換行（窄螢幕上不會剩一個「）」在下一行；整段比一行還長時才在裡面換行）。 */}
        <span className="inline-block max-w-full">
          （<LicenseLink license={src.license} />）
        </span>
        <span lang="en" className="block">
          {src.title}
        </span>
      </p>
      <ChartDataTable chart={chart} highlight={highlight} />
    </figure>
  );
}

/**
 * 表格（kind: table）：桌機是一般的表格（太寬就在框內左右捲動）；手機每一列變成一張卡片（第一欄當標題、其他欄「表頭：內容」），
 * 不必左右捲動也讀得完。兩種寫法只有一種顯示（display: none），螢幕閱讀器不會讀兩次。
 */
export function TableFigure({ figure, rows, evidence }: { figure: PracticeFigure; rows: string[][]; evidence: readonly string[] }) {
  const [head = [], ...body] = rows;
  const hits = useMemo(() => evidenceRows(rows, evidence), [rows, evidence]);
  const kind = figureKindLabel(figure.kind);
  return (
    <figure className="space-y-2 rounded-xl border border-line bg-surface-2 p-3 text-[0.95rem]" data-testid="table-figure">
      <figcaption className="space-y-1">
        <FigureHeading figure={figure} kind={kind} />
        {figure.caption && (
          <span lang="en" className="block font-semibold break-words">
            {figure.caption}
          </span>
        )}
      </figcaption>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface sm:block" tabIndex={0} role="region" aria-label={`${kind}內容`}>
        <table className="w-full border-collapse text-sm" lang="en">
          <thead>
            <tr>
              {head.map((cell, i) => (
                <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className={`border-b border-line last:border-0 ${hits.has(r) ? 'bg-badge-bg text-badge-fg' : ''}`}>
                {row.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row" className="px-3 py-2 text-left align-top font-medium">
                      {cell}
                      {hits.has(r) && (
                        <span lang="zh-Hant" className="ml-1 text-xs font-semibold">
                          （解析引用）
                        </span>
                      )}
                    </th>
                  ) : (
                    <td key={c} className="px-3 py-2 align-top">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 sm:hidden" aria-label={`${kind}內容（每一列一張卡片）`}>
        {body.map((row, r) => (
          <li key={r} className={`rounded-lg border border-line p-2.5 ${hits.has(r) ? 'bg-badge-bg text-badge-fg' : 'bg-surface'}`}>
            <p lang="en" className="font-semibold break-words">
              {head[0] && <span className="mr-1.5 text-xs font-normal text-muted">{head[0]}</span>}
              {row[0]}
              {hits.has(r) && (
                <span lang="zh-Hant" className="ml-1 text-xs">
                  （解析引用）
                </span>
              )}
            </p>
            {/*
              表頭欄是 auto（最多撐到表頭的長度），內容欄至少 8rem（卡片太窄時是卡片寬的 60%）：
              內容欄的下限是 0 的話，只要有一個表頭很長（Number of bicycles sold worldwide each year），
              表頭欄就會撐到接近整張卡片寬，每一列的內容都被擠成一兩個字一行；現在改成長表頭自己換行。
            */}
            <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(min(8rem,60%),1fr)] gap-x-3 gap-y-0.5 text-sm" lang="en" data-testid="table-card-fields">
              {row.slice(1).map((cell, c) => (
                <Fragment key={c}>
                  <dt className="break-words text-muted">{head[c + 1] ?? ''}</dt>
                  <dd className="break-words">{cell}</dd>
                </Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {figure.description && (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">表格說明</summary>
          <p className="mt-1">{figure.description}</p>
        </details>
      )}
    </figure>
  );
}

/**
 * 練習頁的 renderFigure：圖表與表格自己畫，其他回傳 undefined（交給歷屆試題的 FigureView）。
 * evidence：交卷後所有題目的證據句（作答中傳空陣列，不提前標出答案）。
 */
export function renderPracticeFigure(figure: PracticeFigure, evidence: readonly string[]) {
  if (figure.chart) return <ChartFigure figure={figure} chart={figure.chart} evidence={evidence} />;
  if (figure.rows && figure.rows.length > 0) return <TableFigure figure={figure} rows={figure.rows} evidence={evidence} />;
  return undefined;
}
