/**
 * 學測數學歷屆試題（gsat-math-exam/v1，格式見 docs/math-exam-json-schema.md）：型別、常數與共用純函式。
 *
 * 前端（apps/web 的 /math）與之後可能紀錄成績的 Worker 用同一份批改程式（docs/design/math.md §5）：
 *   - 單選：答案相同得全分，否則 0（含未答）。
 *   - 多選：n 個選項逐一判定；全未作答得 0；答錯 k 個（該選未選、不該選卻選都算錯）得 points × (n − 2k)/n，低於 0 以 0 計。
 *     舊課綱（100–110）的「全對 5、錯 1 個 3、錯 2 個 1、其餘 0」在 5 分題、5 個選項時與這條公式結果相同。
 *   - 選填：每一格都和 answer_cells 相同才得全分；否則 0，不倒扣。
 *   - 非選擇題（constructed）：不自動給分，只列配分（學生看本站詳解自評；之後再接拍照批改）。
 *
 * 作答值（MathAnswer）的形狀：
 *   single       "3"（選項代號）
 *   multi        ["2","4"]（遞增排序、不重複）
 *   fill         ["1","","-"]：和 fill.cells 等長，依格子順序，空字串＝這一格沒劃記
 *   constructed  不存作答（請學生在紙上寫）
 *
 * 只描述資料裡會讀到的欄位；前端拿到的檔案（build-data.mjs 的輸出）去掉了 sources、extraction，另外多了 era、official_files，
 * 各函式的參數只要求用得到的欄位，原始檔與前端檔都能直接傳進來。
 */

export const MATH_EXAM_SCHEMA_ID = 'gsat-math-exam/v1';

/** math_a＝數學A、math_b＝數學B（108 課綱，111 起）；math＝舊課綱學測數學（100–110）。 */
export const MATH_SUBJECTS = ['math_a', 'math_b', 'math'] as const;
export type MathSubject = (typeof MATH_SUBJECTS)[number];

export const MATH_SUBJECT_LABELS: Record<MathSubject, string> = {
  math_a: '數學A',
  math_b: '數學B',
  math: '學測數學',
};

/** 課綱。舊課綱（100–110）的卷子標「舊課綱」，不混進數A／數B。 */
export const MATH_ERAS = ['108課綱', '舊課綱'] as const;
export type MathEra = (typeof MATH_ERAS)[number];

/** 卷子屬於哪個課綱：資料有 era 就用（資料都有寫），否則依考科判斷（math_a／math_b＝108 課綱，math＝舊課綱）。 */
export function mathEraOf(paper: { subject: string; era?: unknown }): MathEra {
  if (typeof paper.era === 'string' && (MATH_ERAS as readonly string[]).includes(paper.era)) return paper.era as MathEra;
  return paper.subject === 'math' ? '舊課綱' : '108課綱';
}

export const MATH_SECTION_TYPES = ['single', 'multi', 'fill', 'mixed'] as const;
export type MathSectionType = (typeof MATH_SECTION_TYPES)[number];

export const MATH_ITEM_TYPES = ['single', 'multi', 'fill', 'constructed'] as const;
export type MathItemType = (typeof MATH_ITEM_TYPES)[number];

export const MATH_ITEM_TYPE_LABELS: Record<MathItemType, string> = {
  single: '單選題',
  multi: '多選題',
  fill: '選填題',
  constructed: '非選擇題',
};

export const MATH_SECTION_TYPE_LABELS: Record<MathSectionType, string> = {
  single: '單選題',
  multi: '多選題',
  fill: '選填題',
  mixed: '混合題組',
};

/**
 * 選填題每一格可以劃的值（答題卷的劃記列）。順序就是畫面上的順序（1–9、0、−、±，同答題卷）。
 * 資料裡負號寫成 ASCII 的 "-"；畫面上顯示成 U+2212「−」（fillCellDisplay）。
 */
export const FILL_CELL_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '±'] as const;
export type FillCellValue = (typeof FILL_CELL_VALUES)[number];

export function isFillCellValue(v: unknown): v is FillCellValue {
  return typeof v === 'string' && (FILL_CELL_VALUES as readonly string[]).includes(v);
}

/**
 * 一格在畫面上的名稱：舊課綱用題本的列號圈號（⑭），108 課綱用「題號-格號」（13-1）。
 * 圈號只有到 50（㊿）；超過或資料不一致時退回 cells 的寫法。
 */
export function fillCellLabel(fill: Pick<MathFill, 'cells' | 'official_cells'>, id: string): string {
  const i = fill.cells.indexOf(id);
  const row = i >= 0 ? fill.official_cells?.[i] : undefined;
  const n = row !== undefined && /^\d+$/.test(row) ? Number(row) : NaN;
  return circledNumber(n) ?? id;
}

/** 1–50 的圈號（①…⑳ U+2460、㉑…㉟ U+3251、㊱…㊿ U+32B1）。 */
export function circledNumber(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 50) return null;
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  return String.fromCodePoint(0x32b1 + n - 36);
}

/** 畫面上顯示的格值：負號用數學的「−」。 */
export function fillCellDisplay(v: string): string {
  return v === '-' ? '−' : v;
}

/** 單元標籤（封閉集合，docs/math-exam-json-schema.md「tags.units」）。 */
export const MATH_UNITS = [
  'real_numbers',
  'polynomial',
  'exp_log',
  'sequence',
  'counting',
  'probability',
  'statistics',
  'trigonometry',
  'coordinate_line',
  'circle',
  'conics',
  'vector_plane',
  'vector_space',
  'space_line_plane',
  'matrix',
  'linear_system',
  'inequality_lp',
  'geometry',
  'functions',
  'logic_set',
  'data_modeling',
] as const;
export type MathUnit = (typeof MATH_UNITS)[number];

export const MATH_UNIT_LABELS: Record<MathUnit, string> = {
  real_numbers: '實數與指數',
  polynomial: '多項式',
  exp_log: '指數與對數',
  sequence: '數列與級數',
  counting: '排列組合',
  probability: '機率',
  statistics: '數據分析',
  trigonometry: '三角',
  coordinate_line: '直線與坐標',
  circle: '圓',
  conics: '圓錐曲線',
  vector_plane: '平面向量',
  vector_space: '空間向量',
  space_line_plane: '空間中的平面與直線',
  matrix: '矩陣',
  linear_system: '線性方程組',
  inequality_lp: '不等式與線性規劃',
  geometry: '幾何',
  functions: '函數',
  logic_set: '邏輯與集合',
  data_modeling: '數學建模',
};

export function mathUnitLabel(unit: string): string {
  return (MATH_UNIT_LABELS as Record<string, string>)[unit] ?? unit;
}

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export interface MathFigure {
  id: string;
  kind: string;
  /** 完整的文字描述（螢幕報讀用）。 */
  alt: string;
  width: number;
  height: number;
  /** 原始檔：repo 內路徑（data/exams/figures-math/…）；前端檔：相對 /data/ 的網址路徑（math/figures/…）。 */
  file: string;
}

export interface MathTable {
  caption: string | null;
  rows: string[][];
  note?: string | null;
}

export interface MathFill {
  cells: string[];
  /**
   * 舊課綱（100–110）才有：每一格在題本與答案卡上的列號（⑭⑮… → ["14","15"]），與 cells 一一對應。
   * 畫面上用圈號標格子（fillCellLabel），和題本一致。
   */
  official_cells?: string[];
  /** LaTeX，格子寫成 [[題號-格號]]。 */
  template: string;
  answer_cells: Record<string, string>;
  answer_latex: string;
}

/**
 * 官方試題統計（tools/merge_math_stats.py 從官方「答對率及鑑別度表」「選擇題選項分析」併入；格式文件 §stats）。
 * 比率都是 0–1，原表空白為 null。108 課綱的非選擇題沒有 stats。
 */
export interface MathItemStats {
  /** 全體到考考生答對率；多選題是得分率。 */
  P: number | null;
  /** 高分組／低分組答對率（多選題為得分率）。 */
  Ph?: number | null;
  Pl?: number | null;
  /** 鑑別度 Ph − Pl。 */
  D?: number | null;
  /** 多選題全對率（只有多選題有）。 */
  T?: number | null;
  /** 單選／多選：全體考生畫記各選項的比例。 */
  options?: Record<string, number | null>;
  /** 單選／多選：未作答比例。 */
  omit?: number | null;
}

/** 官方答對率（多選題是得分率）；沒有統計時 null。 */
export function mathCorrectRate(item: { stats?: MathItemStats | null }): number | null {
  const p = item.stats?.P;
  return typeof p === 'number' && Number.isFinite(p) ? p : null;
}

export interface MathItem {
  no: number;
  label: string;
  type: MathItemType;
  stem: string;
  options: Record<string, string> | null;
  answer: string | string[] | null;
  points: number;
  fill?: MathFill;
  constructed?: { official_answer_stored: false; has_drawing: boolean };
  figures: MathFigure[];
  tables: MathTable[];
  options_figures?: Record<string, MathFigure>;
  tags: { units: string[] };
  stats?: MathItemStats | null;
}

export interface MathGroup {
  id: string;
  group_label: string | null;
  stem: string | null;
  figures: MathFigure[];
  tables: MathTable[];
  items: MathItem[];
}

export interface MathSection {
  id: string;
  type: MathSectionType;
  title: string;
  instructions: string | null;
  points_total: number;
  groups: MathGroup[];
}

export interface MathPart {
  title: string;
  points: number;
  instructions: string | null;
  sections: string[];
}

/** 一份數學考卷（原始檔與前端檔共同的欄位）。 */
export interface MathPaperBase {
  id: string;
  exam: string;
  subject: MathSubject;
  year: number;
  session: string;
  title: string;
  time_minutes: number;
  full_score: number;
  era?: MathEra;
  scoring_rules?: Record<string, string> | null;
  parts: MathPart[];
  sections: MathSection[];
  reference_formulas?: string[];
}

// ---------------------------------------------------------------------------
// 走訪
// ---------------------------------------------------------------------------

export interface MathItemRef<I extends MathItem = MathItem> {
  item: I;
  group: MathGroup;
  section: MathSection;
}

/** 依題本順序走訪每一題。 */
export function* iterateMathItems(paper: Pick<MathPaperBase, 'sections'>): Generator<MathItemRef> {
  for (const section of paper.sections) {
    for (const group of section.groups) {
      for (const item of group.items) yield { item, group, section };
    }
  }
}

export function mathItems(paper: Pick<MathPaperBase, 'sections'>): MathItem[] {
  return [...iterateMathItems(paper)].map((r) => r.item);
}

// ---------------------------------------------------------------------------
// 文字：題幹的位置標記與選填 template
// ---------------------------------------------------------------------------

export type StemToken = { kind: 'text'; text: string } | { kind: 'fill' } | { kind: 'table'; index: number };

/** 把題幹切成文字、[[FILL]]（選填作答格的位置）與 [[TABLE:k]]（第 k 個表格，從 1 起）。 */
export function splitMathStem(stem: string): StemToken[] {
  const tokens: StemToken[] = [];
  const re = /\[\[(FILL|TABLE:(\d+))\]\]/g;
  let last = 0;
  for (const m of stem.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) tokens.push({ kind: 'text', text: stem.slice(last, at) });
    if (m[1] === 'FILL') tokens.push({ kind: 'fill' });
    else tokens.push({ kind: 'table', index: Number(m[2]) });
    last = at + m[0].length;
  }
  if (last < stem.length) tokens.push({ kind: 'text', text: stem.slice(last) });
  return tokens;
}

/** 題幹裡用 [[TABLE:k]] 標了位置的表格序號（從 1 起）。沒有標的表格畫在題幹後面。 */
export function referencedTables(stem: string): Set<number> {
  return new Set(splitMathStem(stem).flatMap((t) => (t.kind === 'table' ? [t.index] : [])));
}

export type TemplateToken = { kind: 'tex'; tex: string } | { kind: 'cell'; id: string };

/** 把 fill.template 切成 LaTeX 片段與格子（[[13-1]]）。 */
export function parseFillTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  const re = /\[\[([0-9A-Za-z]+-\d+)\]\]/g;
  let last = 0;
  for (const m of template.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) tokens.push({ kind: 'tex', tex: template.slice(last, at) });
    tokens.push({ kind: 'cell', id: m[1] ?? '' });
    last = at + m[0].length;
  }
  if (last < template.length) tokens.push({ kind: 'tex', tex: template.slice(last) });
  return tokens;
}

/**
 * 把格子代入 template，得到一段 LaTeX。cell(id) 回傳那一格要放的 LaTeX（例如格值、或 \boxed{\phantom{0}} 佔位）。
 * 格值前後加空白，數字格緊接在 \sqrt 這類指令後面時才不會黏成一個指令名稱。
 */
export function fillTemplateLatex(template: string, cell: (id: string) => string): string {
  return parseFillTemplate(template)
    .map((t) => (t.kind === 'tex' ? t.tex : `{${cell(t.id)}}`))
    .join('');
}

/** 格值的 LaTeX（負號、±）。 */
export function fillCellLatex(v: string): string {
  if (v === '-') return '-';
  if (v === '±') return '\\pm';
  return v;
}

// ---------------------------------------------------------------------------
// 批改
// ---------------------------------------------------------------------------

export type MathAnswer = string | readonly string[];

export type MathAutoStatus = 'correct' | 'partial' | 'wrong' | 'unanswered';

export interface MathAutoOutcome {
  kind: 'auto';
  max: number;
  earned: number;
  status: MathAutoStatus;
  /** 多選題答錯的選項數 k；選填題答錯的格數；單選是 null。 */
  wrong: number | null;
}

export interface MathManualOutcome {
  kind: 'manual';
  max: number;
}

export type MathOutcome = MathAutoOutcome | MathManualOutcome;

function asList(answer: MathAnswer | undefined): string[] {
  if (answer === undefined) return [];
  return typeof answer === 'string' ? (answer === '' ? [] : [answer]) : [...answer];
}

/** 單選：答案相同得全分，否則 0（含未答、劃記多於一個）。 */
export function gradeSingle(item: Pick<MathItem, 'answer' | 'points'>, answer: MathAnswer | undefined): MathAutoOutcome {
  const chosen = asList(answer).filter((v) => v !== '');
  if (chosen.length === 0) return { kind: 'auto', max: item.points, earned: 0, status: 'unanswered', wrong: null };
  const ok = chosen.length === 1 && typeof item.answer === 'string' && chosen[0] === item.answer;
  return { kind: 'auto', max: item.points, earned: ok ? item.points : 0, status: ok ? 'correct' : 'wrong', wrong: null };
}

/**
 * 多選：n 個選項逐一判定，答錯 k 個得 points × (n − 2k)/n，低於 0 以 0 計；全未作答得 0。
 * 分數四捨五入到小數點後兩位（n＝5 時都是整數；之後若有 n＝4 的題目，避免 0.30000000000000004 這種顯示）。
 */
export function gradeMulti(item: Pick<MathItem, 'answer' | 'points' | 'options'>, answer: MathAnswer | undefined): MathAutoOutcome {
  const options = Object.keys(item.options ?? {});
  const n = options.length;
  const chosen = new Set(asList(answer).filter((v) => options.includes(v)));
  if (chosen.size === 0 || n === 0) return { kind: 'auto', max: item.points, earned: 0, status: 'unanswered', wrong: null };
  const correct = new Set(Array.isArray(item.answer) ? item.answer : typeof item.answer === 'string' ? [item.answer] : []);
  let k = 0;
  for (const o of options) if (chosen.has(o) !== correct.has(o)) k += 1;
  const earned = Math.max(0, Math.round(((item.points * (n - 2 * k)) / n) * 100) / 100);
  const status: MathAutoStatus = k === 0 ? 'correct' : earned > 0 ? 'partial' : 'wrong';
  return { kind: 'auto', max: item.points, earned, status, wrong: k };
}

/** 選填：每一格都和 answer_cells 相同才得全分，否則 0（不倒扣）；每一格都沒劃記算未作答。 */
export function gradeFill(item: Pick<MathItem, 'fill' | 'points'>, answer: MathAnswer | undefined): MathAutoOutcome {
  const cells = item.fill?.cells ?? [];
  const values = asList(answer);
  if (cells.length === 0 || values.every((v) => v === '')) {
    return { kind: 'auto', max: item.points, earned: 0, status: 'unanswered', wrong: null };
  }
  let wrong = 0;
  cells.forEach((id, i) => {
    if ((values[i] ?? '') !== item.fill?.answer_cells[id]) wrong += 1;
  });
  const ok = wrong === 0;
  return { kind: 'auto', max: item.points, earned: ok ? item.points : 0, status: ok ? 'correct' : 'wrong', wrong };
}

export function gradeMathItem(item: MathItem, answer: MathAnswer | undefined): MathOutcome {
  switch (item.type) {
    case 'single':
      return gradeSingle(item, answer);
    case 'multi':
      return gradeMulti(item, answer);
    case 'fill':
      return gradeFill(item, answer);
    case 'constructed':
      return { kind: 'manual', max: item.points };
  }
}

/** 有沒有作答（單選選了、多選勾了至少一個、選填劃了至少一格）。非選擇題沒有線上作答，一律 false。 */
export function isMathAnswered(item: Pick<MathItem, 'type'>, answer: MathAnswer | undefined): boolean {
  if (item.type === 'constructed') return false;
  return asList(answer).some((v) => v !== '');
}

/** 正確答案的顯示文字：單選 "(3)"、多選 "(2)(4)"；選填與非選擇題回傳 null（選填另外用 answer_latex 排版）。 */
export function choiceAnswerText(item: Pick<MathItem, 'type' | 'answer'>): string | null {
  if (item.type === 'single' && typeof item.answer === 'string') return `(${item.answer})`;
  if (item.type === 'multi' && Array.isArray(item.answer)) return item.answer.map((a) => `(${a})`).join('');
  return null;
}

export interface MathSectionScore {
  sectionId: string;
  type: MathSectionType;
  title: string;
  earned: number;
  autoMax: number;
  manualMax: number;
  correctCount: number;
  autoCount: number;
}

export interface MathPaperScore {
  earned: number;
  /** 自動批改的滿分（選擇＋選填）。 */
  autoMax: number;
  /** 非選擇題配分（不自動給分）。 */
  manualMax: number;
  correctCount: number;
  autoCount: number;
  answeredCount: number;
  sections: MathSectionScore[];
  items: Record<string, MathOutcome>;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 整份卷子的自動批改結果（依 item.label 取作答）。 */
export function scoreMathPaper(paper: Pick<MathPaperBase, 'sections'>, answers: Readonly<Record<string, MathAnswer>>): MathPaperScore {
  const items: Record<string, MathOutcome> = {};
  let answeredCount = 0;
  const sections = paper.sections.map((section) => {
    const s: MathSectionScore = { sectionId: section.id, type: section.type, title: section.title, earned: 0, autoMax: 0, manualMax: 0, correctCount: 0, autoCount: 0 };
    for (const group of section.groups) {
      for (const item of group.items) {
        const answer = answers[item.label];
        const outcome = gradeMathItem(item, answer);
        items[item.label] = outcome;
        if (isMathAnswered(item, answer)) answeredCount += 1;
        if (outcome.kind === 'manual') {
          s.manualMax += outcome.max;
          continue;
        }
        s.autoCount += 1;
        s.autoMax += outcome.max;
        s.earned += outcome.earned;
        if (outcome.status === 'correct') s.correctCount += 1;
      }
    }
    s.earned = round2(s.earned);
    return s;
  });
  const sum = (pick: (s: MathSectionScore) => number) => round2(sections.reduce((acc, s) => acc + pick(s), 0));
  return {
    earned: sum((s) => s.earned),
    autoMax: sum((s) => s.autoMax),
    manualMax: sum((s) => s.manualMax),
    correctCount: sections.reduce((acc, s) => acc + s.correctCount, 0),
    autoCount: sections.reduce((acc, s) => acc + s.autoCount, 0),
    answeredCount,
    sections,
    items,
  };
}

// ---------------------------------------------------------------------------
// 本站詳解（data/exams/math-solutions/{paper-id}.json；另一條流程產生，可能還不存在）
// ---------------------------------------------------------------------------

/** 前端拿到的一題詳解（build-data.mjs 從詳解檔挑出公開的欄位）。 */
export interface MathSolution {
  no: number;
  /** 本站單元名稱（中文，例如「機率（條件機率）」；舊格式可能是 tags.units 的代號）。 */
  unit: string | null;
  /** 難度分級（穩定基礎／進階練習／超越頂標）。 */
  difficulty: string | null;
  /** Markdown＋$…$ 公式。 */
  solution_md: string;
  /** 最終答案的顯示文字（可含 $…$）。 */
  answer_display: string | null;
  /** 是否通過獨立驗算（詳解檔的 check）。 */
  checked: boolean;
}
