/**
 * 圖表題的圖（figure.chart，README §3.2）：純 SVG 自己畫，不用圖表套件（SPEC §4.1 FigureView）。
 * 支援 bar（類別長條；多個數列＝分組長條）、line（折線）、stacked_bar（堆疊長條，正負值分開往上、往下堆）、pie（圓餅）。
 *
 * 設計（dataviz 的規則）：
 *   - 顏色用 index.css 的 --chart-1…8（淺色、深色各自挑過、驗證過色盲辨識度），依數列順序取用；文字一律用 --fg／--muted，
 *     不用數列的顏色。折線的資料點另外用不同形狀（圓、方、三角、菱形），不只靠顏色分辨；
 *   - 長條 ≤ 24px、資料端 4px 圓角；相鄰的長條、堆疊的每一段之間留 2px 背景色的縫；折線 2px、資料點 8px 加 2px 背景色外圈；
 *   - 格線是 1px 的實線、和背景只差一階；數值標籤只在放得下時才標（放不下就交給點選後的讀數與資料表）。
 * SVG 依容器的實際寬度排版（字永遠是 12px，不會跟著縮小）；類別太多、手機太窄時，圖本身有最小寬度，
 * 容器可以左右捲動，頁面不會被撐寬。
 * 無障礙：SVG 是 role="img"，aria-label 是圖的完整文字描述（figure.description；沒有時用類型、標題與軸）；
 * 數字另外在可以展開的資料表（ChartDataTable）。點長條、資料點或扇形可以看數值（讀數顯示在圖的下方）。
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { ChartSpec } from '../../../data/bank';
import {
  chartHasData,
  displayNumber,
  niceScale,
  pointKey,
  textWidth,
  tickLabel,
  withUnit,
  wrapText,
  type Scale,
} from '../chart';

const FONT = 12;
const LINE_HEIGHT = 14;
const PLOT_HEIGHT = 200;
const BAR_MAX = 24;
const GAP = 2;

/** 第 i 個數列（圓餅是第 i 個類別）的顏色：固定順序取用。 */
export function seriesColor(i: number): string {
  return `var(--chart-${(i % 8) + 1})`;
}

type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond';
const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond'];

export function markerShape(i: number): MarkerShape {
  return SHAPES[i % SHAPES.length] ?? 'circle';
}

function Marker({ shape, x, y, r, fill, ring = 'var(--surface)', ringWidth = 2 }: { shape: MarkerShape; x: number; y: number; r: number; fill: string; ring?: string; ringWidth?: number }) {
  const style = { fill, stroke: ring, strokeWidth: ringWidth, paintOrder: 'stroke' } as const;
  switch (shape) {
    case 'circle':
      return <circle cx={x} cy={y} r={r} style={style} />;
    case 'square':
      return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} style={style} />;
    case 'triangle':
      return <path d={`M${x},${y - r * 1.15} L${x + r * 1.1},${y + r * 0.8} L${x - r * 1.1},${y + r * 0.8} Z`} style={style} />;
    case 'diamond':
      return <path d={`M${x},${y - r * 1.25} L${x + r * 1.1},${y} L${x},${y + r * 1.25} L${x - r * 1.1},${y} Z`} style={style} />;
  }
}

/** 圖例的小圖示：折線是短線＋資料點形狀，其他是方塊。 */
export function LegendKey({ index, line }: { index: number; line: boolean }) {
  const color = seriesColor(index);
  return (
    <svg aria-hidden="true" width={line ? 22 : 12} height={12} viewBox={line ? '0 0 22 12' : '0 0 12 12'} className="shrink-0">
      {line ? (
        <>
          <line x1={1} y1={6} x2={21} y2={6} style={{ stroke: color, strokeWidth: 2, strokeLinecap: 'round' }} />
          <Marker shape={markerShape(index)} x={11} y={6} r={3.5} fill={color} ringWidth={1.5} />
        </>
      ) : (
        <rect x={0} y={0} width={12} height={12} rx={2} style={{ fill: color }} />
      )}
    </svg>
  );
}

/** 容器寬度（ResizeObserver）；量不到（測試環境）時用 fallback。 */
function useContainerWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width ?? fallback] as const;
}

/** 長條：資料端 4px 圓角、基線那端是直角（負值的資料端在下面）。 */
function barPath(x: number, yBase: number, yEnd: number, w: number, rounded = true): string {
  const h = Math.abs(yEnd - yBase);
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  if (yEnd <= yBase) {
    // 往上長（正值）。
    return `M${x},${yBase} V${yEnd + r} Q${x},${yEnd} ${x + r},${yEnd} H${x + w - r} Q${x + w},${yEnd} ${x + w},${yEnd + r} V${yBase} Z`;
  }
  return `M${x},${yBase} V${yEnd - r} Q${x},${yEnd} ${x + r},${yEnd} H${x + w - r} Q${x + w},${yEnd} ${x + w},${yEnd - r} V${yBase} Z`;
}

/** 目前點選（或滑過）的是哪個資料點：si 是 null 表示整個類別（折線的十字線）。 */
export interface ActivePoint {
  ci: number;
  si: number | null;
}

export interface ChartProps {
  chart: ChartSpec;
  /** SVG 的 aria-label（圖的完整文字描述）。 */
  label: string;
  /** 交卷後要標出來的資料點（解析的證據引用到的），pointKey 的集合。 */
  highlight?: ReadonlySet<string>;
}

/** 還沒點選時的說明：依圖的類型說要點哪裡。 */
const READOUT_HINTS: Record<ChartSpec['type'], string> = {
  bar: '點圖上的長條可以看數值；所有數字也列在下方的資料表。',
  stacked_bar: '點長條裡的每一段可以看數值；所有數字也列在下方的資料表。',
  line: '點圖上的資料點可以看這一點所有數列的數值；所有數字也列在下方的資料表。',
  pie: '點圖上的扇形可以看數值；所有數字也列在下方的資料表。',
};

/** 讀數：點選的資料點是多少。 */
function readout(chart: ChartSpec, active: ActivePoint | null): ReactNode {
  if (!active) return READOUT_HINTS[chart.type];
  const category = chart.categories[active.ci] ?? '';
  const unit = chart.y.unit;
  if (active.si === null) {
    const parts = chart.series.map((s) => `${s.name} ${displayNumber(s.values[active.ci] ?? 0)}`);
    return (
      <span lang="en">
        <strong>{category}</strong>：{parts.join('、')}
        {unit ? `（${unit}）` : ''}
      </span>
    );
  }
  const s = chart.series[active.si];
  if (!s) return null;
  const v = s.values[active.ci] ?? 0;
  const name = chart.series.length > 1 && chart.type !== 'pie' ? `${category}・${s.name}` : category;
  let share = '';
  if (chart.type === 'pie') {
    const total = s.values.filter((x) => x > 0).reduce((a, b) => a + b, 0);
    if (total > 0 && v > 0 && unit !== '%') share = `（占 ${Math.round((v / total) * 1000) / 10}%）`;
  }
  return (
    <span lang="en">
      {name}：<strong>{withUnit(displayNumber(v), unit)}</strong>
      {share}
    </span>
  );
}

/** 類別名稱最多換成幾行。 */
const MAX_LABEL_LINES = 3;

/**
 * 一個類別名稱至少要多寬的類別帶才放得下：最長的單字要放得下（單字不會再斷開），換行後也不超過 3 行
 * （超過會被截成「…」）。回傳的是類別帶的寬度：文字寬再加左右各 4px，讓相鄰的兩個標籤之間至少有空隙。
 * Bangladesh、Internationalization 這種長字放不進 40px 的帶時，以前會疊到隔壁的標籤上、最右邊的被 SVG 裁掉；
 * 現在改成整張圖變寬（容器可以左右捲動），不硬擠。
 */
export function categoryBandWidth(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  const full = textWidth(words.join(' '), FONT);
  let w = Math.max(0, ...words.map((word) => textWidth(word, FONT)));
  while (w < full && wrapText(text, w, FONT, Number.POSITIVE_INFINITY).length > MAX_LABEL_LINES) w += 6;
  return Math.ceil(w) + 8;
}

/** 長條、折線、堆疊長條的版面。 */
function cartesianLayout(chart: ChartSpec, containerWidth: number) {
  const n = chart.categories.length;
  const ns = chart.series.length;
  const stacked = chart.type === 'stacked_bar';
  const domain: number[] = [];
  if (stacked) {
    chart.categories.forEach((_, ci) => {
      let pos = 0;
      let neg = 0;
      for (const s of chart.series) {
        const v = s.values[ci] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      domain.push(pos, neg);
    });
  } else {
    for (const s of chart.series) domain.push(...s.values);
  }
  const scale = niceScale(domain);
  const tickWidth = Math.max(...scale.ticks.map((t) => textWidth(tickLabel(t, scale.step), FONT)));
  const left = Math.max(28, Math.ceil(tickWidth) + 10);
  // 折線的最後一個點右邊放數值標籤。
  const endLabelWidth =
    chart.type === 'line' ? Math.max(...chart.series.map((s) => textWidth(displayNumber(s.values[n - 1] ?? 0), FONT))) + 12 : 0;
  const right = Math.max(12, Math.ceil(endLabelWidth));
  const markBand = chart.type === 'bar' ? Math.max(40, ns * 10 + (ns - 1) * GAP + 16) : chart.type === 'line' ? 36 : 40;
  // 類別帶也要放得下類別名稱（categoryBandWidth）：每個類別一樣寬，所以取最寬的那個。
  const minBand = Math.max(markBand, ...chart.categories.map(categoryBandWidth));
  const minWidth = left + right + n * minBand;
  const width = Math.max(containerWidth, minWidth, 240);
  const band = (width - left - right) / n;
  const xLines = chart.categories.map((c) => wrapText(c, band - 8, FONT, MAX_LABEL_LINES));
  const xLineCount = Math.max(1, ...xLines.map((l) => l.length));
  const top = 14;
  const plotHeight = PLOT_HEIGHT;
  const bottom = 8 + xLineCount * LINE_HEIGHT;
  const height = top + plotHeight + bottom;
  const y = (v: number) => top + (plotHeight * (scale.max - v)) / (scale.max - scale.min);
  return { n, ns, scale, left, right, top, width, minWidth, height, band, xLines, y, plotHeight };
}

function Axes({ layout }: { layout: ReturnType<typeof cartesianLayout> & { scale: Scale } }) {
  const { scale, left, right, width, y, band, xLines, top, plotHeight } = layout;
  const plotBottom = top + plotHeight;
  return (
    <g aria-hidden="true">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line
            x1={left}
            x2={width - right}
            y1={y(t)}
            y2={y(t)}
            style={{ stroke: t === 0 ? 'var(--muted)' : 'var(--line)', strokeWidth: 1 }}
            shapeRendering="crispEdges"
          />
          <text x={left - 6} y={y(t) + 4} textAnchor="end" style={{ fill: 'var(--muted)', fontSize: FONT }} className="tabular-nums">
            {tickLabel(t, scale.step)}
          </text>
        </g>
      ))}
      {xLines.map((lines, ci) => (
        <text key={ci} x={left + band * ci + band / 2} y={plotBottom + 4 + LINE_HEIGHT - 2} textAnchor="middle" style={{ fill: 'var(--muted)', fontSize: FONT }}>
          {lines.map((line, li) => (
            <tspan key={li} x={left + band * ci + band / 2} dy={li === 0 ? 0 : LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
        </text>
      ))}
    </g>
  );
}

function CartesianChart({ chart, label, highlight, containerWidth, active, setActive }: ChartProps & { containerWidth: number; active: ActivePoint | null; setActive: (a: ActivePoint) => void }) {
  const layout = useMemo(() => cartesianLayout(chart, containerWidth), [chart, containerWidth]);
  const { n, ns, left, right, top, width, height, band, y, plotHeight } = layout;
  const zero = y(Math.max(layout.scale.min, Math.min(0, layout.scale.max)));
  const hl = highlight ?? new Set<string>();
  const marks: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const hits: ReactNode[] = [];
  const outline = (key: string, d: string) => <path key={`hl-${key}`} d={d} style={{ fill: 'none', stroke: 'var(--fg)', strokeWidth: 2 }} />;
  const highlightMarks: ReactNode[] = [];

  if (chart.type === 'bar') {
    const slot = Math.max(4, Math.min(BAR_MAX, (band * 0.8 - (ns - 1) * GAP) / ns));
    const groupWidth = ns * slot + (ns - 1) * GAP;
    const valueTexts = chart.series.map((s) => s.values.map((v) => displayNumber(v)));
    const showValues = valueTexts.every((list) =>
      list.every((t) => (ns === 1 ? textWidth(t, 11) <= band - 4 : textWidth(t, 11) <= slot + GAP)),
    );
    chart.categories.forEach((_, ci) => {
      const x0 = left + band * ci + (band - groupWidth) / 2;
      chart.series.forEach((s, si) => {
        const v = s.values[ci] ?? 0;
        const x = x0 + si * (slot + GAP);
        const yEnd = y(v);
        const d = barPath(x, zero, yEnd === zero ? zero - 0.5 : yEnd, slot);
        const isActive = active?.ci === ci && active.si === si;
        marks.push(<path key={`b-${ci}-${si}`} d={d} style={{ fill: seriesColor(si), opacity: active && !isActive ? 0.55 : 1 }} />);
        if (hl.has(pointKey(ci, si))) highlightMarks.push(outline(`${ci}-${si}`, barPath(x - 2, zero, v >= 0 ? yEnd - 2 : yEnd + 2, slot + 4, false)));
        if (showValues) {
          labels.push(
            <text
              key={`v-${ci}-${si}`}
              x={x + slot / 2}
              y={v >= 0 ? yEnd - 4 : yEnd + 12}
              textAnchor="middle"
              style={{ fill: 'var(--fg)', fontSize: 11 }}
              className="tabular-nums"
            >
              {valueTexts[si]?.[ci]}
            </text>,
          );
        }
        hits.push(
          <rect
            key={`h-${ci}-${si}`}
            x={x - GAP / 2}
            y={top}
            width={slot + GAP}
            height={plotHeight}
            style={{ fill: 'transparent', cursor: 'pointer' }}
            onPointerEnter={() => setActive({ ci, si })}
            onClick={() => setActive({ ci, si })}
          />,
        );
      });
    });
  } else if (chart.type === 'stacked_bar') {
    const barWidth = Math.max(8, Math.min(32, band * 0.6));
    const totals: ReactNode[] = [];
    chart.categories.forEach((_, ci) => {
      const x = left + band * ci + (band - barWidth) / 2;
      let pos = 0;
      let neg = 0;
      const posLast = chart.series.map((s) => s.values[ci] ?? 0).reduce((last, v, si) => (v > 0 ? si : last), -1);
      const negLast = chart.series.map((s) => s.values[ci] ?? 0).reduce((last, v, si) => (v < 0 ? si : last), -1);
      chart.series.forEach((s, si) => {
        const v = s.values[ci] ?? 0;
        if (v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        const yFrom = y(from);
        const yTo = y(to);
        // 每一段在資料端那一側留 2px 的背景色縫。
        const gapped = v > 0 ? Math.min(yFrom, yTo + GAP) : Math.max(yFrom, yTo - GAP);
        const outer = si === (v > 0 ? posLast : negLast);
        const d = barPath(x, yFrom, outer ? yTo : gapped, barWidth, outer);
        const isActive = active?.ci === ci && active.si === si;
        marks.push(<path key={`s-${ci}-${si}`} d={d} style={{ fill: seriesColor(si), opacity: active && !isActive ? 0.55 : 1 }} />);
        if (hl.has(pointKey(ci, si))) highlightMarks.push(outline(`${ci}-${si}`, barPath(x - 2, yFrom, yTo, barWidth + 4, false)));
        hits.push(
          <rect
            key={`h-${ci}-${si}`}
            x={x - 4}
            y={Math.min(yFrom, yTo)}
            width={barWidth + 8}
            height={Math.max(6, Math.abs(yTo - yFrom))}
            style={{ fill: 'transparent', cursor: 'pointer' }}
            onPointerEnter={() => setActive({ ci, si })}
            onClick={() => setActive({ ci, si })}
          />,
        );
      });
      const total = chart.series.reduce((acc, s) => acc + (s.values[ci] ?? 0), 0);
      const text = displayNumber(Math.round(total * 1e6) / 1e6);
      if (textWidth(text, 11) <= band - 4) {
        totals.push(
          <text key={`t-${ci}`} x={x + barWidth / 2} y={y(pos) - 4} textAnchor="middle" style={{ fill: 'var(--fg)', fontSize: 11 }} className="tabular-nums">
            {text}
          </text>,
        );
      }
    });
    labels.push(...totals);
  } else {
    // 折線：x 是類別帶的中心。
    const cx = (ci: number) => left + band * ci + band / 2;
    chart.series.forEach((s, si) => {
      const d = s.values.map((v, ci) => `${ci === 0 ? 'M' : 'L'}${cx(ci)},${y(v)}`).join(' ');
      marks.push(
        <path key={`l-${si}`} d={d} style={{ fill: 'none', stroke: seriesColor(si), strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }} />,
      );
    });
    chart.series.forEach((s, si) => {
      s.values.forEach((v, ci) => {
        const isActive = active?.ci === ci && (active.si === null || active.si === si);
        marks.push(<Marker key={`m-${si}-${ci}`} shape={markerShape(si)} x={cx(ci)} y={y(v)} r={isActive ? 5.5 : 4} fill={seriesColor(si)} />);
        if (hl.has(pointKey(ci, si))) {
          highlightMarks.push(<circle key={`hl-${si}-${ci}`} cx={cx(ci)} cy={y(v)} r={9} style={{ fill: 'none', stroke: 'var(--fg)', strokeWidth: 2 }} />);
        }
      });
    });
    // 最後一個點的數值：上下至少差 14px 才標，靠太近的交給讀數與資料表（不硬擠）。
    const ends = chart.series
      .map((s, si) => ({ si, v: s.values[n - 1] ?? 0, yy: y(s.values[n - 1] ?? 0) }))
      .sort((a, b) => a.yy - b.yy);
    let lastY = -Infinity;
    for (const e of ends) {
      if (e.yy - lastY < LINE_HEIGHT) continue;
      lastY = e.yy;
      labels.push(
        <text key={`e-${e.si}`} x={cx(n - 1) + 9} y={e.yy + 4} style={{ fill: 'var(--fg)', fontSize: FONT }} className="tabular-nums">
          {displayNumber(e.v)}
        </text>,
      );
    }
    const onMove = (e: PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const ci = Math.max(0, Math.min(n - 1, Math.floor((px - left) / band)));
      if (active?.ci !== ci || active.si !== null) setActive({ ci, si: null });
    };
    hits.push(
      <rect
        key="crosshair-hit"
        x={left}
        y={top}
        width={width - left - right}
        height={plotHeight}
        style={{ fill: 'transparent', cursor: 'crosshair' }}
        onPointerMove={onMove}
        onPointerDown={onMove}
      />,
    );
    if (active && active.si === null) {
      marks.unshift(
        <line key="crosshair" x1={cx(active.ci)} x2={cx(active.ci)} y1={top} y2={top + plotHeight} style={{ stroke: 'var(--muted)', strokeWidth: 1 }} />,
      );
    }
  }

  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block max-w-none select-none" data-chart-type={chart.type}>
      <Axes layout={layout} />
      <g aria-hidden="true">{marks}</g>
      <g aria-hidden="true">{highlightMarks}</g>
      <g aria-hidden="true">{labels}</g>
      <g aria-hidden="true">{hits}</g>
    </svg>
  );
}

function PieChart({ chart, label, highlight, containerWidth, active, setActive }: ChartProps & { containerWidth: number; active: ActivePoint | null; setActive: (a: ActivePoint) => void }) {
  const series = chart.series[0];
  const size = Math.max(200, Math.min(containerWidth, 320));
  const r = size / 2 - 10;
  const c = size / 2;
  const values = series?.values ?? [];
  const total = values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const percentUnit = chart.y.unit === '%';
  const hl = highlight ?? new Set<string>();
  const slices: ReactNode[] = [];
  const labels: ReactNode[] = [];
  let angle = -Math.PI / 2;
  values.forEach((v, ci) => {
    if (!(v > 0) || total <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const isActive = active?.ci === ci;
    const rr = isActive ? r + 4 : r;
    const p0 = [c + rr * Math.cos(a0), c + rr * Math.sin(a0)];
    const p1 = [c + rr * Math.cos(a1), c + rr * Math.sin(a1)];
    const large = sweep > Math.PI ? 1 : 0;
    const d =
      sweep >= Math.PI * 2 - 1e-9
        ? `M${c},${c - rr} A${rr},${rr} 0 1 1 ${c - 0.01},${c - rr} Z`
        : `M${c},${c} L${p0[0]},${p0[1]} A${rr},${rr} 0 ${large} 1 ${p1[0]},${p1[1]} Z`;
    slices.push(
      <path
        key={`p-${ci}`}
        d={d}
        style={{
          fill: seriesColor(ci),
          stroke: hl.has(pointKey(ci, 0)) ? 'var(--fg)' : 'var(--surface)',
          strokeWidth: 2,
          strokeLinejoin: 'round',
          cursor: 'pointer',
          opacity: active && !isActive ? 0.6 : 1,
        }}
        onPointerEnter={() => setActive({ ci, si: 0 })}
        onClick={() => setActive({ ci, si: 0 })}
      />,
    );
    // 扇形夠大才在裡面標數字；字加背景色的外框，放在任何顏色上都看得清楚。
    // 單位本來就是 % 時標原始數值（12.5%），和圖例、讀數、資料表、題目引用的數字一致：
    // 加總不一定剛好是 100（README §3.2 只列 warning），重新算占比會變成另一組數字。其他單位才標重新算的占比。
    const text = percentUnit ? withUnit(displayNumber(v), '%') : `${Math.round((v / total) * 100)}%`;
    const labelRadius = r * 0.62;
    // 標籤放在扇形中線上、半徑 0.62r 的地方：那裡的弦長要放得下字（小數比較長，扇形要大一點才標）。
    const room = sweep >= Math.PI ? Infinity : 2 * labelRadius * Math.sin(sweep / 2);
    if (sweep >= 0.45 && r >= 60 && textWidth(text, FONT) <= room + 8) {
      const mid = a0 + sweep / 2;
      labels.push(
        <text
          key={`t-${ci}`}
          x={c + labelRadius * Math.cos(mid)}
          y={c + labelRadius * Math.sin(mid) + 4}
          textAnchor="middle"
          style={{ fill: 'var(--fg)', fontSize: FONT, fontWeight: 600, stroke: 'var(--surface)', strokeWidth: 3, paintOrder: 'stroke' }}
          className="tabular-nums"
        >
          {text}
        </text>,
      );
    }
  });
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block max-w-none select-none" data-chart-type="pie">
      <g>{slices}</g>
      <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
        {labels}
      </g>
    </svg>
  );
}

/** 圖例：每個數列（圓餅是每個類別）一項；折線的圖示帶資料點形狀。 */
export function ChartLegend({ chart }: { chart: ChartSpec }) {
  const pie = chart.type === 'pie';
  const items = pie ? chart.categories.map((name, i) => ({ name, i, value: chart.series[0]?.values[i] })) : chart.series.map((s, i) => ({ name: s.name, i, value: undefined }));
  return (
    <ul aria-label="圖例" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((item) => (
        <li key={item.i} className="flex min-w-0 items-center gap-1.5">
          <LegendKey index={item.i} line={chart.type === 'line'} />
          <span lang="en" className="min-w-0 break-words">
            {item.name}
            {pie && item.value !== undefined && <span className="text-muted tabular-nums">：{withUnit(displayNumber(item.value), chart.y.unit)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 圖本身＋圖例＋讀數。沒有資料（類別或數列是空的）時顯示一句說明，不畫空的座標軸。
 */
export function ChartView({ chart, label, highlight }: ChartProps) {
  const [ref, containerWidth] = useContainerWidth(640);
  const [active, setActive] = useState<ActivePoint | null>(null);
  const pie = chart.type === 'pie';
  const pieValues = chart.series[0]?.values ?? [];
  // 圓餅圖只畫正值；全部是 0 或負數就沒有東西可以畫。
  const hasData = chartHasData(chart) && (!pie || pieValues.some((v) => v > 0));
  const skipped = pie ? pieValues.filter((v) => !(v > 0)).length : 0;
  const neededWidth = hasData && !pie ? cartesianLayout(chart, 0).minWidth : 0;
  const scrolls = neededWidth > containerWidth;

  if (!hasData) {
    return (
      <p role="note" className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
        這張圖沒有資料可以畫。
      </p>
    );
  }
  const axisText = (axis: ChartSpec['x']) => `${axis.label}${axis.unit ? ` (${axis.unit})` : ''}`;
  return (
    <div className="space-y-2">
      <ChartLegend chart={chart} />
      <p className="text-xs text-muted">
        {pie ? '數值' : '縱軸'}：<span lang="en">{axisText(chart.y)}</span>
      </p>
      <div
        ref={ref}
        className="overflow-x-auto overscroll-x-contain rounded-lg bg-surface"
        {...(scrolls ? { tabIndex: 0, role: 'group', 'aria-label': '圖表（可以左右捲動）' } : {})}
        data-testid="chart-scroll"
      >
        {pie ? (
          <PieChart chart={chart} label={label} highlight={highlight} containerWidth={containerWidth} active={active} setActive={setActive} />
        ) : (
          <CartesianChart chart={chart} label={label} highlight={highlight} containerWidth={containerWidth} active={active} setActive={setActive} />
        )}
      </div>
      {!pie && (
        <p className="text-center text-xs text-muted">
          橫軸：<span lang="en">{axisText(chart.x)}</span>
        </p>
      )}
      {scrolls && <p className="text-xs text-muted">圖比畫面寬，可以左右滑動。</p>}
      {skipped > 0 && <p className="text-xs text-muted">有 {skipped} 個類別的數值是 0 或負數，圓餅圖畫不出來，請看資料表。</p>}
      <p className="min-h-6 text-sm" data-testid="chart-readout">
        {readout(chart, active)}
      </p>
    </div>
  );
}
