/**
 * 作文範文的輸出後處理（docs/design/model-essays.md §3.5）。consumer 在 callWithPolicy 的 onSuccess 裡呼叫（模型的 JSON 已經用
 * 完整的 zod schema 驗證過）；真模型評測工具用同一支。結果有 problem＝語意檢查不通過＝內容失敗（次數跨 Queue 投遞累計，§3.6）。
 *
 *   1 is_writing_task=false：自訂題標 notWritingTask（consumer 不重試、以 invalid_output 退還、meta.not_writing_task）；
 *     網站題目一定是寫作題，當成內容失敗。
 *   2 範文本文（三篇各自）：正規化（統一換行、去頭尾空白、空行合併；第一行看起來是標題就拿掉並記數）。
 *     硬性檢查用沒有截斷的原文：空字串、字數不在硬性範圍、正文段數和規定不同、三篇的正文段數不同、非 ASCII 字元超過 2%。
 *     過濾（長度上限依那一級的 hardMax × 8 字元）→ D8 → 照抄題目（只有自訂題：和學生題目相同的 7 字窗口 ≥ 2 個就隱藏；網站題目只記數）。
 *     三篇都被隱藏＝內容失敗。軟性（只記數）：字數在硬性範圍內、目標範圍外；三篇字數沒有遞增；轉承詞種類數。
 *     被隱藏的那一篇，四項說明與升級說明也不留（空字串；它們本來就要引用那一篇，§1.10「那一篇顯示固定說明」）。
 *   3 說明欄位（_zh，含亮點的 zh）：過濾、考試單位名稱換成「官方」、D8（命中換成固定說明）、照抄題目（只有自訂題：和學生題目相同的
 *     7 字窗口 ≥ 2 個，換成另一句固定說明）、截到 §2.5 的上限（尾端加「…」）。
 *   4 亮點：那一篇被隱藏就丟；text 要逐字出現在那一篇（前後不接英文字母，同前端 ModelTextView 的 locate）；找不到、超過 25 個單詞、
 *     重複的丟掉；每級最多 10 則。text 是沒被隱藏的那一篇的引文，那一篇和題目相同的窗口 < 2 個，所以不必再比對題目。
 *   5 常見的錯：wrong 與 right 不同（只忽略大小寫、空白與引號的寫法，§3.5）、各 ≤ 25 個單詞、wrong 不在任何一篇範文裡；過濾、D8
 *     （另外記數 typical_d8，評測的 D8 門檻要算）、照抄題目（只有自訂題，門檻同上）；最多 3 則。
 *   6 程式算的數字（shared 的 exemplarMetrics）。
 * tainted＝有任何欄位被過濾、被 D8 或照抄題目檢查隱藏：不寫共用快取（§4.3）。
 * 只回傳代碼與數字給 log 與 meta；範文與題目的文字只留在 view（寫進 exemplar_sets.output_json）。
 */
import {
  ESSAY_CRITERIA,
  EXEMPLAR_FIELD_LIMITS,
  EXEMPLAR_LEVELS,
  EXEMPLAR_LIMITS,
  EXEMPLAR_NOTE_HIDDEN_TEXT,
  EXEMPLAR_NOTE_TASK_COPY_TEXT,
  countEnglishWords,
  exemplarBodyParagraphs,
  exemplarMetrics,
  type ExemplarEssayView,
  type ExemplarHiddenReason,
  type ExemplarLevel,
  type ExemplarSetView,
  type ExemplarSource,
  type ExemplarWordTarget,
  type ModelTextNote,
} from '@gsat/shared';
import { d8EnglishWindows, d8Hash, d8Hit, type D8Fingerprints } from '../ai/d8';
import { FILTERED_PLACEHOLDER, replaceExamBoard, type OutputFilter } from '../ai/filter';
import type { ExemplarOutput } from './schema';

/** 非 ASCII 字元的上限比例（彎引號、破折號、刪節號不算）。 */
export const EXEMPLAR_NON_ASCII_MAX = 0.02;
/**
 * 照抄題目：和學生題目相同的 7 字窗口達到這個數就隱藏（連續 8 個單詞以上相同）。範文與說明欄位、常見的錯用同一個門檻：
 * 說明常引用沒被隱藏的那一篇，那一篇最多只和題目有 1 個相同的窗口，引用它不會被誤擋。
 */
export const EXEMPLAR_TASK_COPY_WINDOWS = 2;
/** 範文本文的過濾長度上限：那一級的硬性字數上限 × 8 字元（題庫範文每個單詞約 5.6 字元）。 */
export const EXEMPLAR_CHARS_PER_WORD_MAX = 8;
/** 轉承詞種類數的軟性門檻（§2.6：只記數，不是門檻）。 */
export const EXEMPLAR_CONNECTIVE_SOFT = { steady: 5, top: 8 } as const;

/** 語意檢查不通過的代碼（log 與評測用；不含內容）。 */
export type ExemplarProblem = 'not_writing_task' | 'empty_essay' | 'word_count' | 'paragraphs' | 'paragraphs_differ' | 'not_english' | 'all_hidden' | 'output_too_large';

export interface ExemplarPostContext {
  source: ExemplarSource;
  targets: Record<ExemplarLevel, ExemplarWordTarget>;
  /** 題目或學生規定的段數；null＝沒有規定（三篇段數相同即可）。 */
  paragraphs: number | null;
  /** 照抄題目比對用的題目文字（自訂題：題目與圖片描述；網站題目：說明、背景、提示）。 */
  taskTexts: readonly string[];
  fp: Pick<D8Fingerprints, 'han' | 'en'>;
}

/** 處理數（寫進 meta_json.counts；評測與上線後監控用）。 */
export interface ExemplarCounts {
  title_removed: number;
  words_soft: number;
  words_not_increasing: number;
  connectives_soft: number;
  highlights_dropped: number;
  highlights_not_found: number;
  typical_dropped: number;
  typical_in_essay: number;
  /** 常見的錯因為 D8 被丟掉（也算在 typical_dropped 裡；評測的「輸出 D8 命中」要算）。 */
  typical_d8: number;
  truncated: number;
  exam_board_replaced: number;
  filtered: number;
  d8_notes: number;
  task_copy_windows: number;
  /** 自訂題：說明欄位、常見的錯照抄題目而被隱藏或丟掉的則數。 */
  task_copy_fields: number;
}

export interface ExemplarHidden {
  level: ExemplarLevel;
  reason: ExemplarHiddenReason;
  /** 照抄題目時相同的窗口數。 */
  windows?: number;
}

export interface ExemplarPostprocessed {
  view: ExemplarSetView;
  /** 語意檢查不通過（內容失敗）；null＝通過。 */
  problem: ExemplarProblem | null;
  /** 自訂題不是英文寫作題目（不重試、退還）。 */
  notWritingTask: boolean;
  tainted: boolean;
  safety: ExemplarOutput['safety_flag'];
  hidden: ExemplarHidden[];
  counts: ExemplarCounts;
  /** 每一級的字數、正文段數、轉承詞種類數（meta_json.details；縮減時最先丟掉）。 */
  details: { words: Record<ExemplarLevel, number>; paragraphs: Record<ExemplarLevel, number>; connective_kinds: Record<ExemplarLevel, number> };
}

function emptyCounts(): ExemplarCounts {
  return {
    title_removed: 0,
    words_soft: 0,
    words_not_increasing: 0,
    connectives_soft: 0,
    highlights_dropped: 0,
    highlights_not_found: 0,
    typical_dropped: 0,
    typical_in_essay: 0,
    typical_d8: 0,
    truncated: 0,
    exam_board_replaced: 0,
    filtered: 0,
    d8_notes: 0,
    task_copy_windows: 0,
    task_copy_fields: 0,
  };
}

const perLevel = <T>(f: (level: ExemplarLevel) => T): Record<ExemplarLevel, T> => ({ basic: f('basic'), steady: f('steady'), top: f('top') });

/** 第一行看起來是標題：≤ 8 個單詞、沒有句末標點、不是書信的稱呼。 */
function looksLikeTitle(line: string): boolean {
  return countEnglishWords(line) <= 8 && !/[.!?:;,"”’)]$/.test(line) && !/^dear\b/i.test(line);
}

/** 範文本文的正規化：統一換行、每行去頭尾空白、空行合併（段落之間一個換行）；第一行像標題就拿掉。 */
export function normalizeEssayText(raw: string): { text: string; titleRemoved: boolean } {
  let lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  let titleRemoved = false;
  if (lines.length >= 2 && looksLikeTitle(lines[0]!)) {
    lines = lines.slice(1);
    titleRemoved = true;
  }
  return { text: lines.join('\n'), titleRemoved };
}

/** 非 ASCII 字元的比例（空白不算；彎引號、破折號、刪節號不算）。 */
export function nonAsciiRatio(text: string): number {
  const chars = [...text.replace(/\s/g, '')];
  if (chars.length === 0) return 0;
  const bad = chars.filter((c) => c.charCodeAt(0) > 0x7e && !'‘’“”–—…'.includes(c)).length;
  return bad / chars.length;
}

/** 題目文字的英文 7 字窗口（雜湊）。 */
function taskWindowSet(taskTexts: readonly string[]): Set<number> {
  const task = new Set<number>();
  for (const t of taskTexts) for (const w of d8EnglishWindows(t)) task.add(d8Hash('en', w.window));
  return task;
}

/** text 裡和題目相同的窗口數（不重複計算同一個窗口）。 */
function sharedWindows(text: string, task: ReadonlySet<number>): number {
  if (task.size === 0) return 0;
  const seen = new Set<number>();
  for (const w of d8EnglishWindows(text)) {
    const h = d8Hash('en', w.window);
    if (task.has(h)) seen.add(h);
  }
  return seen.size;
}

/** 照抄題目：範文（或任何一個欄位）裡和題目相同的 7 字窗口數（不重複計算同一個窗口）。 */
export function taskCopyWindows(essay: string, taskTexts: readonly string[]): number {
  return sharedWindows(essay, taskWindowSet(taskTexts));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 亮點引文在範文裡找不找得到（前後不能接英文字母，同前端 ModelTextView 的 locate）。 */
export function quoteFound(essay: string, quote: string): boolean {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(quote)}(?![A-Za-z])`).test(essay);
}

/**
 * 常見的錯的 wrong 與 right 算不算同一句（§3.5「比較時忽略大小寫與空白」）：小寫、空白縮成一個、彎引號換直引號（引號的寫法
 * 不是錯誤）。標點不忽略：「Where do you live.」→「Where do you live?」是不同的兩句。只差大小寫的會被丟掉，所以系統提示要求
 * 每一則都要改到字或詞形。
 */
export function sameSentence(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/** 找「錯句出現在範文裡」用的正規形式：小寫、彎引號換直引號、空白縮成一個、去掉句末標點（錯句在範文裡可能接在句中）。 */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?"']+$/, '')
    .trim();
}

/** 截到上限（字元，以 code point 計），尾端加「…」。 */
function clip(text: string, limit: number): { text: string; clipped: boolean } {
  const chars = [...text];
  if (chars.length <= limit) return { text, clipped: false };
  return { text: `${chars.slice(0, limit - 1).join('')}…`, clipped: true };
}

function emptyEssay(level: ExemplarLevel, target: ExemplarWordTarget, paragraphs: number | null): ExemplarEssayView {
  return {
    level,
    text: null,
    hidden: null,
    targets: { words: [target.min, target.max], paragraphs },
    metrics: exemplarMetrics(''),
    criteria: { content: '', organization: '', grammar: '', vocabulary: '' },
    highlights: [],
    next_zh: '',
  };
}

/** 失敗或不是寫作題時的空白顯示形狀（不會寫進 D1；評測與 log 只看 problem）。 */
function emptyView(ctx: ExemplarPostContext): ExemplarSetView {
  return {
    task_reading_zh: '',
    plan_zh: '',
    essays: [emptyEssay('basic', ctx.targets.basic, ctx.paragraphs), emptyEssay('steady', ctx.targets.steady, ctx.paragraphs), emptyEssay('top', ctx.targets.top, ctx.paragraphs)],
    typical_errors: [],
    safety_flag: null,
  };
}

const TEXT_FIELD = { basic: 'basic_text', steady: 'steady_text', top: 'top_text' } as const satisfies Record<ExemplarLevel, keyof ExemplarOutput>;
const NEXT_FIELD = { basic: 'basic_next_zh', steady: 'steady_next_zh', top: 'top_next_zh' } as const satisfies Record<ExemplarLevel, keyof ExemplarOutput>;

/** 後處理（見檔頭）。filter 收集被擋下的類別（consumer 寫安全事件）。 */
export function postprocessExemplars(out: ExemplarOutput, ctx: ExemplarPostContext, filter: OutputFilter): ExemplarPostprocessed {
  const counts = emptyCounts();
  const zeros = () => perLevel(() => 0);
  const details = { words: zeros(), paragraphs: zeros(), connective_kinds: zeros() };
  const base = { notWritingTask: false, tainted: false, safety: out.safety_flag, hidden: [] as ExemplarHidden[], counts, details };
  const fail = (problem: ExemplarProblem): ExemplarPostprocessed => ({ ...base, view: emptyView(ctx), problem });

  // 1. 不是寫作題。
  if (!out.is_writing_task) {
    if (ctx.source === 'custom') return { ...base, view: emptyView(ctx), problem: null, notWritingTask: true };
    return fail('not_writing_task');
  }

  // 2. 範文本文：正規化與硬性檢查（沒有截斷的原文）。
  const raw = perLevel((level) => {
    const n = normalizeEssayText(out[TEXT_FIELD[level]]);
    if (n.titleRemoved) counts.title_removed += 1;
    return n.text;
  });
  for (const level of EXEMPLAR_LEVELS) {
    const text = raw[level];
    const t = ctx.targets[level];
    const words = countEnglishWords(text);
    const body = exemplarBodyParagraphs(text).length;
    details.words[level] = words;
    details.paragraphs[level] = body;
    if (text === '') return fail('empty_essay');
    if (words < t.hardMin || words > t.hardMax) return fail('word_count');
    if (ctx.paragraphs !== null && body !== ctx.paragraphs) return fail('paragraphs');
    if (nonAsciiRatio(text) > EXEMPLAR_NON_ASCII_MAX) return fail('not_english');
    if (words < t.min || words > t.max) counts.words_soft += 1;
  }
  if (new Set(EXEMPLAR_LEVELS.map((l) => details.paragraphs[l])).size !== 1) return fail('paragraphs_differ');
  if (!(details.words.basic < details.words.steady && details.words.steady < details.words.top)) counts.words_not_increasing = 1;

  // 過濾 → D8 → 照抄題目。
  const hidden: ExemplarHidden[] = [];
  const shown = perLevel((level): string | null => {
    const text = filter.text(raw[level], ctx.targets[level].hardMax * EXEMPLAR_CHARS_PER_WORD_MAX);
    if (text === FILTERED_PLACEHOLDER || text === '') {
      hidden.push({ level, reason: 'filtered' });
      return null;
    }
    if (d8Hit(text, ctx.fp)) {
      hidden.push({ level, reason: 'd8' });
      return null;
    }
    const windows = taskCopyWindows(text, ctx.taskTexts);
    if (ctx.source === 'custom') {
      if (windows >= EXEMPLAR_TASK_COPY_WINDOWS) {
        hidden.push({ level, reason: 'task_copy', windows });
        return null;
      }
    } else {
      counts.task_copy_windows += windows;
    }
    return text;
  });
  if (hidden.length === EXEMPLAR_LEVELS.length) return { ...fail('all_hidden'), hidden };

  // 3. 說明欄位。
  const taskWindows = ctx.source === 'custom' ? taskWindowSet(ctx.taskTexts) : new Set<number>();
  /** 自訂題：這段文字照抄了學生的題目（相同的窗口 ≥ 門檻）。網站題目的題目是公開的，不檢查（同範文本文）。 */
  const copiesTask = (text: string) => taskWindows.size > 0 && sharedWindows(text, taskWindows) >= EXEMPLAR_TASK_COPY_WINDOWS;
  let noteTainted = false;
  const note = (input: string, limit: number): string => {
    const filtered = filter.text(input, 2_000);
    if (filtered === FILTERED_PLACEHOLDER) {
      counts.filtered += 1;
      noteTainted = true;
      return filtered;
    }
    const board = replaceExamBoard(filtered);
    counts.exam_board_replaced += board.replaced;
    if (d8Hit(board.text, ctx.fp)) {
      counts.d8_notes += 1;
      noteTainted = true;
      return EXEMPLAR_NOTE_HIDDEN_TEXT;
    }
    if (copiesTask(board.text)) {
      counts.task_copy_fields += 1;
      noteTainted = true;
      return EXEMPLAR_NOTE_TASK_COPY_TEXT;
    }
    const c = clip(board.text, limit);
    if (c.clipped) counts.truncated += 1;
    return c.text;
  };

  // 4. 亮點。
  const highlights = perLevel((): ModelTextNote[] => []);
  const seen = new Set<string>();
  for (const h of out.highlights) {
    const essay = shown[h.level];
    const text = h.text.trim();
    if (essay === null || text === '' || countEnglishWords(text) > EXEMPLAR_FIELD_LIMITS.quoteWords || highlights[h.level].length >= EXEMPLAR_LIMITS.highlightsPerLevel) {
      counts.highlights_dropped += 1;
      continue;
    }
    const key = `${h.level}\u0000${text}`;
    if (seen.has(key)) {
      counts.highlights_dropped += 1;
      continue;
    }
    if (!quoteFound(essay, text)) {
      counts.highlights_not_found += 1;
      continue;
    }
    seen.add(key);
    highlights[h.level].push({ kind: h.kind, text, zh: note(h.zh, EXEMPLAR_FIELD_LIMITS.noteZh) });
  }

  // 5. 常見的錯。
  const essaysComparable = EXEMPLAR_LEVELS.map((l) => comparable(raw[l]));
  const typical: ExemplarSetView['typical_errors'] = [];
  let typicalTainted = false;
  for (const t of out.typical_errors) {
    const wrong = t.wrong.replace(/\s+/g, ' ').trim();
    const right = t.right.replace(/\s+/g, ' ').trim();
    if (
      typical.length >= EXEMPLAR_LIMITS.typicalErrors ||
      wrong === '' ||
      right === '' ||
      sameSentence(wrong, right) ||
      countEnglishWords(wrong) > EXEMPLAR_FIELD_LIMITS.quoteWords ||
      countEnglishWords(right) > EXEMPLAR_FIELD_LIMITS.quoteWords
    ) {
      counts.typical_dropped += 1;
      continue;
    }
    const probe = comparable(wrong);
    if (probe !== '' && essaysComparable.some((e) => e.includes(probe))) {
      counts.typical_in_essay += 1;
      continue;
    }
    const fw = filter.text(wrong, 500);
    const fr = filter.text(right, 500);
    if (fw === FILTERED_PLACEHOLDER || fr === FILTERED_PLACEHOLDER) {
      counts.typical_dropped += 1;
      typicalTainted = true;
      continue;
    }
    if (d8Hit(fw, ctx.fp) || d8Hit(fr, ctx.fp)) {
      counts.typical_dropped += 1;
      counts.typical_d8 += 1;
      typicalTainted = true;
      continue;
    }
    if (copiesTask(fw) || copiesTask(fr)) {
      counts.typical_dropped += 1;
      counts.task_copy_fields += 1;
      typicalTainted = true;
      continue;
    }
    typical.push({ wrong: fw, right: fr, zh: note(t.zh, EXEMPLAR_FIELD_LIMITS.noteZh) });
  }

  // 6. 組成顯示形狀（程式算的數字）。
  const essays = EXEMPLAR_LEVELS.map((level): ExemplarEssayView => {
    const text = shown[level];
    const why = hidden.find((h) => h.level === level)?.reason ?? null;
    const metrics = exemplarMetrics(text ?? raw[level]);
    details.connective_kinds[level] = metrics.connective_kinds;
    if (level !== 'basic' && text !== null && metrics.connective_kinds < EXEMPLAR_CONNECTIVE_SOFT[level]) counts.connectives_soft += 1;
    // 被隱藏的那一篇：說明本來就要引用那一篇，整段不留（不跑過濾與 D8，也不算進計數）。
    const blank = text === null;
    return {
      level,
      text,
      hidden: why,
      targets: { words: [ctx.targets[level].min, ctx.targets[level].max], paragraphs: ctx.paragraphs },
      metrics,
      criteria: Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, blank ? '' : note(out[`${level}_${c}_zh`], EXEMPLAR_FIELD_LIMITS.criterionZh)])) as ExemplarEssayView['criteria'],
      highlights: highlights[level],
      next_zh: blank ? '' : note(out[NEXT_FIELD[level]], EXEMPLAR_FIELD_LIMITS.nextZh),
    };
  }) as ExemplarSetView['essays'];
  const view: ExemplarSetView = {
    task_reading_zh: note(out.task_reading_zh, EXEMPLAR_FIELD_LIMITS.taskReadingZh),
    plan_zh: note(out.plan_zh, EXEMPLAR_FIELD_LIMITS.planZh),
    essays,
    typical_errors: typical,
    safety_flag: out.safety_flag === 'none' ? null : out.safety_flag,
  };
  return {
    ...base,
    view,
    problem: null,
    hidden,
    tainted: hidden.length > 0 || noteTainted || typicalTainted || filter.blockedCategories.size > 0,
  };
}
