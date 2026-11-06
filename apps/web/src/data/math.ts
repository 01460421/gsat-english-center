/**
 * 學測數學歷屆試題資料：型別與載入函式。
 *
 * 資料檔（scripts/build-data.mjs → scripts/lib/math-data.mjs 產生，來源是 data/exams/parsed-math/*.json）：
 *   /data/math/index.json            MathIndex      每份卷子的摘要（列表用）
 *   /data/math/{id}.json             MathPaper      一份卷子（gsat-math-exam/v1，去掉 sources、extraction；圖的 file 是相對 /data/ 的網址）
 *   /data/math/solutions/{id}.json   MathSolutions  本站詳解（沒有詳解的題目不在 items 裡，畫面顯示「詳解準備中」）
 *   /data/math/figures/{id}/*.png    圖檔
 *
 * 卷子內容的型別直接用 @gsat/shared 的 MathPaperBase（批改程式也在那裡），這裡只補前端檔多出來的欄位。
 */
import type { MathEra, MathPaperBase, MathSectionType, MathSolution, MathSubject } from '@gsat/shared';
import { DATA_BASE_URL, DataLoadError, fetchDataFile, isRecord, memoizeAsync } from './client';

/** 卷子 id：數A／數B gsat-matha-115、gsat-mathb-115；舊課綱 gsat-math-100…110。 */
export const MATH_PAPER_ID_PATTERN = /^gsat-math[ab]?-\d{2,3}$/;

export interface MathOfficialFile {
  subkind: string;
  label: string;
  format: string;
  url: string;
}

export interface MathPaper extends MathPaperBase {
  schema: 'gsat-math-exam/v1';
  era: MathEra;
  verified: boolean;
  official_files: MathOfficialFile[];
  scoring_rules: Record<string, string> | null;
  reference_formulas: string[];
}

export interface MathSectionSummary {
  id: string;
  type: MathSectionType;
  title: string;
  question_count: number;
  points_total: number;
}

export interface MathPaperSummary {
  id: string;
  subject: MathSubject;
  era: MathEra;
  year: number;
  session: string;
  title: string;
  time_minutes: number;
  full_score: number;
  question_count: number;
  /** 非選擇題題數（紙上作答，不算在「已答幾題」裡）。 */
  constructed_count: number;
  /** 自動批改（選擇＋選填）的滿分。 */
  auto_max: number;
  /** 非選擇題配分。 */
  manual_max: number;
  /** 有官方答對率。 */
  has_stats: boolean;
  /** 已有本站詳解的題數。 */
  solution_count: number;
  sections: MathSectionSummary[];
  units: Record<string, number>;
}

export interface MathIndex {
  version: string;
  count: number;
  papers: MathPaperSummary[];
}

export interface MathSolutions {
  version: string;
  id: string;
  count: number;
  /** 題號（字串）→ 詳解。 */
  items: Record<string, MathSolution>;
}

function isMathIndex(body: unknown): body is MathIndex {
  return isRecord(body) && typeof body.version === 'string' && Array.isArray(body.papers);
}

function isMathPaper(body: unknown, id: string): body is MathPaper {
  return isRecord(body) && body.schema === 'gsat-math-exam/v1' && body.id === id && Array.isArray(body.sections);
}

function isMathSolutions(body: unknown, id: string): body is MathSolutions {
  return isRecord(body) && body.id === id && isRecord(body.items);
}

const indexLoader = memoizeAsync((_key: 'index') => fetchDataFile('math/index.json', isMathIndex));

function rejectBadId(path: string): Promise<never> {
  return Promise.reject(new DataLoadError('not_found', `${DATA_BASE_URL}${path}`, null));
}

const paperLoader = memoizeAsync((id: string) => {
  // 格式檢查放在快取裡面（理由同 data/exams.ts 的 examLoader）：網址參數拼進路徑前先擋掉 ../ 之類的字串。
  if (!MATH_PAPER_ID_PATTERN.test(id)) return rejectBadId(`math/${encodeURIComponent(id)}.json`);
  return fetchDataFile(`math/${id}.json`, (body: unknown): body is MathPaper => isMathPaper(body, id));
});

const solutionsLoader = memoizeAsync((id: string) => {
  if (!MATH_PAPER_ID_PATTERN.test(id)) return rejectBadId(`math/solutions/${encodeURIComponent(id)}.json`);
  return fetchDataFile(`math/solutions/${id}.json`, (body: unknown): body is MathSolutions => isMathSolutions(body, id));
});

export function loadMathIndex(): Promise<MathIndex> {
  return indexLoader('index');
}

export function loadMathPaper(id: string): Promise<MathPaper> {
  return paperLoader(id);
}

/** 本站詳解：看答案或交卷後才下載（作答中不必先抓、也不會被開發者工具看到詳解）。 */
export function loadMathSolutions(id: string): Promise<MathSolutions> {
  return solutionsLoader(id);
}

/** 圖檔的網址（資料裡是相對 /data/ 的路徑）。 */
export function mathFigureUrl(file: string): string {
  return `${DATA_BASE_URL}${file}`;
}

/** 卷子的短名稱：「115 數A」「105 學測數學」。 */
export function mathShortName(p: Pick<MathPaperSummary, 'year' | 'subject'>): string {
  const subject = p.subject === 'math_a' ? '數A' : p.subject === 'math_b' ? '數B' : '學測數學';
  return `${p.year} ${subject}`;
}
