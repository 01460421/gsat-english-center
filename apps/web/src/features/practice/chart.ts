/**
 * 圖表題（figure.chart，data/bank/README.md §3.2）的純函式：數字格式、刻度、文字版與資料表、證據引用的資料點。
 *
 * 文字版（chartTextLines）與資料表（chartTableRows）和 tools/student_view.py 的 chart_text_lines、chart_table 逐字相同：
 * 盲解者與解析的證據句引用圖表時，就是逐字引用其中一行（或資料表的一列，儲存格以 " | " 相接），
 * 所以交卷後可以從證據句反查是哪幾個資料點，在圖上與資料表裡標出來。
 */
import type { ChartSpec, ChartType } from '../../data/bank';

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: '長條圖',
  line: '折線圖',
  stacked_bar: '堆疊長條圖',
  pie: '圓餅圖',
};

/** 和 student_view.py 的 format_number 相同：整數不帶小數點，其他照 JSON 的寫法，不加千分位（證據比對用）。 */
export function plainNumber(v: number): string {
  // JSON 的 90.0 讀進來就是 90，String() 本來就不帶小數點；其他數字的寫法和 Python 的 str() 相同。
  return String(v);
}

const DISPLAY = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

/** 畫面上顯示的數字：加千分位（1,050），小數照原樣。 */
export function displayNumber(v: number): string {
  return DISPLAY.format(v);
}

/** 數值＋單位：% 直接接在數字後面，其他單位空一格（student_view.py 的 with_unit）。 */
export function withUnit(text: string, unit: string | null): string {
  if (!unit) return text;
  return unit === '%' ? `${text}%` : `${text} ${unit}`;
}

/** CC 授權代碼（CC-BY-4.0、CC-BY-SA-3.0、CC-BY-NC-SA-4.0）：[條款（BY-SA）, 版本（3.0）]。 */
const CC_LICENSE = /^CC-(BY(?:-NC)?(?:-SA|-ND)?)-(\d\.\d)$/;

/**
 * 授權代碼 → 畫面上的寫法（Creative Commons 自己的寫法）：CC-BY-4.0 → CC BY 4.0、CC-BY-SA-4.0 → CC BY-SA 4.0；
 * OGDL-Taiwan-1.0 → 政府資料開放授權條款第1版。其他照原樣（例如 UN terms of use）。
 */
export function licenseLabel(license: string): string {
  if (license === 'OGDL-Taiwan-1.0') return '政府資料開放授權條款第1版';
  const cc = CC_LICENSE.exec(license);
  if (cc) return `CC ${cc[1] ?? ''} ${cc[2] ?? ''}`;
  return license;
}

/** 授權條款的網址（CC BY 標示要附授權條款連結）；不認得的授權回傳 null（只顯示文字）。 */
export function licenseUrl(license: string): string | null {
  if (license === 'OGDL-Taiwan-1.0') return 'https://data.gov.tw/license';
  const cc = CC_LICENSE.exec(license);
  if (cc) return `https://creativecommons.org/licenses/${(cc[1] ?? '').toLowerCase()}/${cc[2] ?? ''}/`;
  return null;
}

/** chart 的文字版：類型與標題、軸、數列、每個資料點一行、附註、資料來源（student_view.py 的 chart_text_lines）。 */
export function chartTextLines(chart: ChartSpec): string[] {
  const { x, y, series, categories } = chart;
  const lines = [`${CHART_TYPE_LABELS[chart.type] ?? chart.type}：${chart.title}`];
  const axis = chart.type === 'pie' ? '類別' : '橫軸';
  lines.push(`${axis}：${x.label}${x.unit ? `（單位：${x.unit}）` : ''}`);
  lines.push(`數值：${y.label}${y.unit ? `（單位：${y.unit}）` : ''}`);
  if (series.length > 1) lines.push(`數列：${series.map((s) => s.name).join('、')}`);
  categories.forEach((_, i) => {
    for (const s of series) {
      const v = s.values[i];
      if (v === undefined) continue;
      lines.push(`${pointLabel(chart, i, s.name)}: ${withUnit(plainNumber(v), y.unit)}`);
    }
  });
  if (chart.note) lines.push(`附註：${chart.note}`);
  const src = chart.source;
  if (src.publisher) lines.push(`資料來源：${src.publisher}, ${src.title}（${src.license}）`);
  return lines;
}

/** 文字版裡一個資料點的名稱：只有一個數列時是類別，否則是「類別, 數列」。 */
function pointLabel(chart: ChartSpec, categoryIndex: number, seriesName: string): string {
  const c = chart.categories[categoryIndex] ?? '';
  return chart.series.length > 1 ? `${c}, ${seriesName}` : c;
}

/** 資料表：第一列是表頭（類別軸、各數列＋單位），之後每個類別一列（student_view.py 的 chart_table）。 */
export function chartTableRows(chart: ChartSpec): string[][] {
  const { x, y } = chart;
  const unit = y.unit ? ` (${y.unit})` : '';
  const head = [`${x.label}${x.unit ? ` (${x.unit})` : ''}`, ...chart.series.map((s) => `${s.name}${unit}`)];
  return [head, ...chart.categories.map((c, i) => [c, ...chart.series.map((s) => (s.values[i] === undefined ? '' : plainNumber(s.values[i])))])];
}

/** 證據句比對用的正規化：彎引號、破折號、連續空白、頭尾空白與句點。 */
function normLine(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
}

/** 資料點的代號：`${類別序號}:${數列序號}`。 */
export function pointKey(categoryIndex: number, seriesIndex: number): string {
  return `${categoryIndex}:${seriesIndex}`;
}

/**
 * 證據句引用到的資料點：逐字等於文字版的某一行（一個點），或資料表的某一列（那個類別的所有點）。
 * 引用選文、題幹的證據句不會對上，回傳空集合。
 */
export function evidencePoints(chart: ChartSpec, evidence: readonly string[]): Set<string> {
  const wanted = new Set(evidence.map(normLine));
  const out = new Set<string>();
  const rows = chartTableRows(chart).slice(1);
  chart.categories.forEach((_, ci) => {
    const row = rows[ci];
    const rowHit = row !== undefined && wanted.has(normLine(row.join(' | ')));
    chart.series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === undefined) return;
      const line = `${pointLabel(chart, ci, s.name)}: ${withUnit(plainNumber(v), chart.y.unit)}`;
      if (rowHit || wanted.has(normLine(line))) out.add(pointKey(ci, si));
    });
  });
  return out;
}

/** 證據句是不是引用圖表（文字版的一行或資料表的一列）。 */
export function isChartEvidence(chart: ChartSpec, evidence: string): boolean {
  return evidencePoints(chart, [evidence]).size > 0;
}

/** 表格（kind: table）的證據：證據句等於某一列（儲存格以 " | " 相接）。回傳列的序號（不含表頭）。 */
export function evidenceRows(rows: readonly (readonly string[])[], evidence: readonly string[]): Set<number> {
  const wanted = new Set(evidence.map(normLine));
  const out = new Set<number>();
  rows.slice(1).forEach((row, i) => {
    if (wanted.has(normLine(row.join(' | ')))) out.add(i);
  });
  return out;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * 「好讀」的數值軸：刻度是 1、2、2.5、5 × 10ⁿ，一定包含 0（長條從 0 長出來；折線也從 0 起，避免把小差距放大）。
 * 全部是 0 或沒有資料時給 0–1。
 */
export function niceScale(values: readonly number[], targetTicks = 5): Scale {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...finite);
  let hi = Math.max(0, ...finite);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, targetTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Number(([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag).toPrecision(10));
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { min: lo, max: hi, step, ticks };
}

/** 刻度文字：依間距決定小數位數，加千分位。 */
export function tickLabel(v: number, step: number): string {
  // 小數位數和間距相同（間距 0.25 → 兩位、2.5 → 一位、50 → 不帶小數）。
  const stepText = String(Number(step.toPrecision(10)));
  const decimals = Math.min(6, stepText.includes('.') ? (stepText.split('.')[1] ?? '').length : 0);
  const fixed = Number(v.toFixed(decimals));
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(fixed === 0 ? 0 : fixed);
}

/** 估計文字寬度（px）：英數字約 0.6 em，中文 1 em。SVG 排版時用來決定標籤放不放得下。 */
export function textWidth(text: string, fontSize = 12): number {
  let w = 0;
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? fontSize : fontSize * 0.6;
  return w;
}

/** 把文字依寬度斷成最多 maxLines 行（以空白斷字；單字太長就留在同一行）。 */
export function wrapText(text: string, width: number, fontSize = 12, maxLines = 3): string[] {
  const wordsList = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of wordsList) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, fontSize) > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''}…`;
  return kept;
}

/** 圖表有沒有可以畫的資料（至少一個類別、一個數列）。 */
export function chartHasData(chart: Pick<ChartSpec, 'categories' | 'series'>): boolean {
  return chart.categories.length > 0 && chart.series.length > 0 && chart.series.some((s) => s.values.some((v) => Number.isFinite(v)));
}

/** 沒有圖的文字描述時，給螢幕閱讀器的摘要（類型、標題、軸、數列）。 */
export function chartSummary(chart: ChartSpec): string {
  return chartTextLines(chart).slice(0, chart.series.length > 1 ? 4 : 3).join('。');
}
