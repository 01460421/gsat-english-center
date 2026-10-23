/**
 * 程式計分（SPEC §4.6、§6.8、§6.9；ARCHITECTURE §6.7 第 3 點）。負責：後端 AI A2。
 *
 * 模型只負責「錯在哪裡、屬於哪一類」；這裡把模型的判斷（已通過 zod 驗證）變成分數：
 *   中譯英：每句 4 部分各 1 分、每個錯誤扣 0.5、各部分扣完為止、相同的拼字或文法錯誤只扣一次（兩句之間也算）、
 *           整個部分漏譯為 0；句首未大寫、句尾標點不妥由程式判定，各扣 0.5（一句裡同一種只扣一次）。
 *   作文：四項各 0–5；離題時內容以外三項為 0；少於 100 個單詞或未分段扣總分 1（同時發生只扣 1）；四項加總。
 *   兩位評分者平均；差距超過門檻（作文 >5、中譯英 >2）才有第三位，取三者中最接近的兩個平均（設計值）。
 * 錯誤的位置一律由程式在原文中搜尋模型引用的片段得出（不採用模型自己算的位移）。
 * 英文作文自訂題目另有自由文字欄位的程式限制（CUSTOM_OUTPUT_LIMITS；docs/design/custom-essay.md §4.8，安全審查 S1）：
 * 就算模型被題目誘導，也拿不到一篇完整的作文。歷屆題與本站題（EssayContext.custom 不是 true）的行為完全不變。
 * 這裡全部是純函式，沒有 I/O，方便單元測試（test/ai.scoring.test.ts）。
 */
import {
  ESSAY_CRITERIA,
  ESSAY_CRITERION_MAX,
  ESSAY_EXPECTED_PARAGRAPHS,
  ESSAY_MAX_SCORE,
  ESSAY_RATER_GAP_THRESHOLD,
  ESSAY_SHORT_WORDS,
  TRANSLATION_DEDUCTION_STEP,
  TRANSLATION_GROUP_MAX,
  TRANSLATION_PARTS_PER_SENTENCE,
  TRANSLATION_POINTS_PER_PART,
  TRANSLATION_RATER_GAP_THRESHOLD,
  checkMechanics,
  countEnglishWords,
  essayBandOf,
  type EssayCriterion,
  type EssayCriterionResult,
  type EssayDeduction,
  type EssayError,
  type EssayGradingResult,
  type EssayParagraphAdvice,
  type EssayRaterResult,
  type OcrResult,
  type OcrUncertainSpan,
  type RaterRole,
  type TranslationError,
  type TranslationGradingResult,
  type TranslationRaterResult,
} from '@gsat/shared';
import { FILTERED_PLACEHOLDER, replaceExamBoard, type OutputFilter } from './filter';
import type { EssayAnalyticOutput, EssayHolisticOutput } from './prompts/essay';
import { OCR_UNCLEAR_MARK, type OcrModelOutput } from './prompts/ocr';
import type { TranslationModelOutput } from './prompts/translation';

// ───────────────────────── 共用 ─────────────────────────

/** 在 text 中找 excerpt：先從 from 之後找、再從頭找；先大小寫相符、再不分大小寫。找不到回 null。 */
export function locate(text: string, excerpt: string, from = 0): { start: number; end: number } | null {
  const q = excerpt.trim();
  if (q === '') return null;
  const tries: Array<[string, string]> = [
    [text, q],
    [text.toLowerCase(), q.toLowerCase()],
  ];
  for (const [hay, needle] of tries) {
    let i = hay.indexOf(needle, from);
    if (i < 0) i = hay.indexOf(needle);
    if (i >= 0) return { start: i, end: i + needle.length };
  }
  return null;
}

/** 兩位（或三位中最接近的兩位）評分者。回傳被採用的兩個角色。 */
export function pickRaterPair<T extends { role: RaterRole; total: number }>(raters: T[]): [T, T] {
  const [a, b, c] = raters;
  if (!a || !b) throw new Error('至少要有兩位評分者');
  if (!c) return [a, b];
  const pairs: Array<[T, T]> = [
    [a, b],
    [a, c],
    [b, c],
  ];
  let best = pairs[0]!;
  for (const p of pairs) if (Math.abs(p[0].total - p[1].total) < Math.abs(best[0].total - best[1].total)) best = p;
  return best;
}

/** 前兩位的差距是否超過門檻（要第三位）。 */
export function needsThirdRater(kind: 'translation' | 'essay', a: number, b: number): boolean {
  const gap = Math.abs(a - b);
  return kind === 'essay' ? gap > ESSAY_RATER_GAP_THRESHOLD : gap > TRANSLATION_RATER_GAP_THRESHOLD;
}

const ROLE_ORDER: Record<RaterRole, number> = { primary: 0, second: 1, third: 2 };
function byRole<T extends { role: RaterRole }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => ROLE_ORDER[x.role] - ROLE_ORDER[y.role]);
}

/** 四捨五入到 1e-6，避免 0.1＋0.2 這類浮點誤差出現在回應裡。 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ───────────────────────── 中譯英 ─────────────────────────

/**
 * 句首大寫與句尾標點（程式判定，SPEC §4.6）：搬到 @gsat/shared，前端的本站題自評用同一支（docs/design/bank-writing.md §2.3）。
 * 這裡轉匯出，test/ai.scoring.test.ts 與其他呼叫端不用改。
 */
export { checkMechanics, type MechanicsCheck } from '@gsat/shared';

/** 模型輸出的語意檢查（zod 只管型別）：句數、句序、每句剛好 4 個部分。不通過＝輸出無效（重試一次）。 */
export function translationOutputProblem(output: TranslationModelOutput, sentenceCount: number): string | null {
  if (output.sentences.length !== sentenceCount) return `句數 ${output.sentences.length} ≠ ${sentenceCount}`;
  const seen = new Set<number>();
  for (const s of output.sentences) {
    if (s.sentence_index < 0 || s.sentence_index >= sentenceCount || seen.has(s.sentence_index)) return `sentence_index ${s.sentence_index} 不合法`;
    seen.add(s.sentence_index);
    const parts = s.parts.map((p) => p.part).sort();
    if (parts.length !== TRANSLATION_PARTS_PER_SENTENCE || parts.some((p, i) => p !== i + 1)) return `第 ${s.sentence_index} 句的部分編號不是 1–4`;
  }
  return null;
}

/** 一位評分者的中譯英紀錄（存進 gradings：judgments_json＝result＋errors；feedback_json＝corrected＋explanation_zh）。 */
export interface TranslationRaterRecord {
  result: TranslationRaterResult;
  errors: TranslationError[];
  corrected: string[];
  explanation_zh: string[];
}

const REPEATABLE = new Set(['spelling', 'grammar']);

/** 依模型的判斷計分（每錯 0.5、各部分扣完為止、同錯只扣一次、漏譯整部分 0、大小寫與標點由程式判定）。 */
export function scoreTranslationRater(role: RaterRole, sentences: string[], output: TranslationModelOutput, filter: OutputFilter): TranslationRaterRecord {
  const n = sentences.length;
  const byIndex = new Map(output.sentences.map((s) => [s.sentence_index, s]));
  // 每句每部分剩下的分數（漏譯的部分直接 0）。
  const remaining: number[][] = sentences.map((_, i) => {
    const s = byIndex.get(i);
    return [1, 2, 3, 4].map((p) => (s?.parts.find((x) => x.part === p)?.missing ? 0 : TRANSLATION_POINTS_PER_PART));
  });

  const errors: TranslationError[] = [];
  const originalToNew = new Map<number, number>();
  const cursor = sentences.map(() => 0);
  output.errors.slice(0, 60).forEach((e, originalIndex) => {
    if (e.sentence_index < 0 || e.sentence_index >= n) return; // 指到不存在的句子：丟掉
    const part = Math.min(TRANSLATION_PARTS_PER_SENTENCE, Math.max(1, e.part));
    const text = sentences[e.sentence_index] ?? '';
    const loc = e.category === 'omission' ? null : locate(text, e.excerpt, cursor[e.sentence_index]);
    if (loc) cursor[e.sentence_index] = loc.end;
    // 重複：模型標的 repeat_of（只認拼字、文法，且指向前面同類的錯誤），或同一個拼錯的字。
    let repeatOf: number | null = null;
    if (REPEATABLE.has(e.category)) {
      const target = e.repeat_of !== null && e.repeat_of < originalIndex ? originalToNew.get(e.repeat_of) : undefined;
      if (target !== undefined && errors[target]?.category === e.category) repeatOf = target;
      if (repeatOf === null && e.category === 'spelling') {
        const key = e.excerpt.trim().toLowerCase();
        const same = errors.findIndex((x) => x.category === 'spelling' && x.excerpt.trim().toLowerCase() === key && key !== '');
        if (same >= 0) repeatOf = same;
      }
    }
    let deducted = 0;
    if (repeatOf === null) {
      const row = remaining[e.sentence_index]!;
      deducted = Math.min(TRANSLATION_DEDUCTION_STEP, row[part - 1]!);
      row[part - 1] = round6(row[part - 1]! - deducted);
    }
    originalToNew.set(originalIndex, errors.length);
    errors.push({
      sentence_index: e.sentence_index,
      part,
      category: e.category,
      start: loc?.start ?? 0,
      end: loc?.end ?? 0,
      excerpt: loc ? text.slice(loc.start, loc.end) : filter.text(e.excerpt, 300),
      explanation_zh: filter.text(e.explanation_zh, 600),
      suggestion: filter.text(e.suggestion, 600),
      repeat_of: repeatOf,
      deducted,
    });
  });

  const sentenceScores = sentences.map((text, i) => {
    const parts = remaining[i]!;
    const partsTotal = parts.reduce((a, b) => a + b, 0);
    const m = checkMechanics(text);
    let budget = partsTotal;
    for (const [category, span] of [
      ['capitalization', m.capitalization],
      ['punctuation', m.punctuation],
    ] as const) {
      if (!span) continue;
      const deducted = Math.min(TRANSLATION_DEDUCTION_STEP, budget);
      budget = round6(budget - deducted);
      errors.push({
        sentence_index: i,
        part: null,
        category,
        start: span.start,
        end: span.end,
        excerpt: text.slice(span.start, span.end),
        explanation_zh: category === 'capitalization' ? '句首第一個字母要大寫。' : '句尾要用英文的句號、問號或驚嘆號，句中也不要用中文標點。',
        suggestion: category === 'capitalization' ? text.slice(span.start, span.end).toUpperCase() : '.',
        repeat_of: null,
        deducted,
      });
    }
    return { sentence_index: i, score: round6(budget), part_scores: parts, mechanics_deduction: round6(partsTotal - budget) };
  });

  const corrected = sentences.map((_, i) => filter.text(byIndex.get(i)?.corrected, 1_000));
  const explanation = sentences.map((_, i) => filter.text(byIndex.get(i)?.explanation_zh, 1_000));
  const total = round6(sentenceScores.reduce((a, s) => a + s.score, 0));
  return { result: { role, score: total, sentences: sentenceScores }, errors, corrected, explanation_zh: explanation };
}

/**
 * 合成中譯英的最後結果（兩位平均；有第三位時取最接近的兩位）。錯誤清單、修正版、說明取「被採用的兩位」裡
 * 排序最前的那位（通常是第一位；第一位是離群值、被排除時改用第二位）：每一位評分者的輸出格式相同，
 * 說明才會和最後分數一致。
 */
export function combineTranslation(records: Array<TranslationRaterRecord & { role: RaterRole }>): TranslationGradingResult {
  const sorted = byRole(records);
  const [x, y] = pickRaterPair(sorted.map((r) => ({ ...r, total: r.result.score })));
  const primary = ROLE_ORDER[x.role] <= ROLE_ORDER[y.role] ? x : y;
  const sentenceCount = primary.result.sentences.length;
  const sentenceScores = Array.from({ length: sentenceCount }, (_, i) =>
    round6(((x.result.sentences[i]?.score ?? 0) + (y.result.sentences[i]?.score ?? 0)) / 2),
  );
  return {
    kind: 'translation',
    final_score: round6((x.result.score + y.result.score) / 2),
    max_score: TRANSLATION_GROUP_MAX,
    sentence_scores: sentenceScores,
    raters: sorted.map((r) => r.result),
    third_rater_used: sorted.some((r) => r.role === 'third'),
    errors: primary.errors,
    corrected: primary.corrected,
    explanation_zh: primary.explanation_zh,
  };
}

// ───────────────────────── 作文 ─────────────────────────

/** 段落的位置（和 shared 的 countParagraphs 同一個切法）。 */
export function paragraphRanges(text: string, photoMode = false): Array<{ start: number; end: number }> {
  const hasBlankLine = /\n[ \t]*\n/.test(text.trim());
  const sep = hasBlankLine || photoMode ? /\n[ \t]*\n+/g : /\n/g;
  const ranges: Array<{ start: number; end: number }> = [];
  let last = 0;
  for (const m of text.matchAll(sep)) {
    ranges.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  ranges.push({ start: last, end: text.length });
  return ranges.filter((r) => text.slice(r.start, r.end).trim() !== '');
}

/** 字數不足與未分段的扣分（同時發生只扣 1；兩項都列出來讓結果頁說明，第二項記 0 分）。 */
export function essayDeductions(wordCount: number, paragraphs: number, requiredParagraphs: number | null): EssayDeduction[] {
  const out: EssayDeduction[] = [];
  const tooShort = wordCount < ESSAY_SHORT_WORDS;
  const noParagraphs = requiredParagraphs !== null && requiredParagraphs >= ESSAY_EXPECTED_PARAGRAPHS && paragraphs < ESSAY_EXPECTED_PARAGRAPHS;
  if (tooShort) out.push({ code: 'too_short', points: 1 });
  if (noParagraphs) out.push({ code: 'no_paragraphs', points: tooShort ? 0 : 1 });
  return out;
}

/** 一位評分者的總分：離題時內容以外三項為 0；四項加總扣掉扣分，最低 0。回傳實際計分用的四項分數。 */
export function essayRaterTotal(raw: Record<EssayCriterion, number>, offTopic: boolean, deductionPoints: number): { scores: Record<EssayCriterion, number>; total: number } {
  const scores = { ...raw };
  if (offTopic) {
    scores.organization = 0;
    scores.grammar = 0;
    scores.vocabulary = 0;
  }
  const sum = ESSAY_CRITERIA.reduce((a, c) => a + scores[c], 0);
  return { scores, total: Math.max(0, Math.min(ESSAY_MAX_SCORE, sum - deductionPoints)) };
}

/** 四項分數都在 0–5 的整數範圍內（zod 只保證是整數）。 */
export function essayScoresProblem(scores: Record<EssayCriterion, number>): string | null {
  for (const c of ESSAY_CRITERIA) {
    const v = scores[c];
    if (!Number.isInteger(v) || v < 0 || v > ESSAY_CRITERION_MAX[c]) return `${c}=${v} 不在 0–${ESSAY_CRITERION_MAX[c]}`;
  }
  return null;
}

/** 一位評分者的作文紀錄。 */
export interface EssayRaterRecord {
  result: EssayRaterResult;
  deductions: EssayDeduction[];
  /** 以下只有第一位評分者有內容。 */
  criteria_explanations: Record<EssayCriterion, string> | null;
  top_improvements: string[];
  paragraph_advice: EssayParagraphAdvice[];
  errors: EssayError[];
  rewrite: string | null;
  safety_flag: string | null;
  /** 自訂題的參考改寫超過長度上限、或和原文差太多被丟掉（存進 feedback_json，結果頁據此說明；沒有＝沒被丟掉）。 */
  rewrite_omitted?: RewriteOmitted;
  /** 自訂題的程式限制處理了多少（consumer 寫進 judgments.meta，上線後看有沒有誤傷；R14）。歷屆題與本站題沒有這個欄位。 */
  output_limits?: CustomOutputCounts;
}

export interface EssayContext {
  text: string;
  wordCount: number;
  paragraphs: number;
  requiredParagraphs: number | null;
  photoMode: boolean;
  /** 英文作文自訂題目：套用 CUSTOM_OUTPUT_LIMITS。沒有這個欄位＝false（歷屆題與本站題）。 */
  custom?: boolean;
}

/**
 * 自訂作文題目的自由文字欄位上限（docs/design/custom-essay.md §4.8，S1；門檻是設計值，§7.8 的評分對照驗證正常作文幾乎不觸發）：
 *   rewrite                參考改寫的英文單詞 ≤ ceil(n × 1.3) + 10（n＝學生作文的單詞數）；超過就整篇不給（too_long）；
 *                          和原文的單詞編輯距離 > ceil(n × 0.5) 也整篇不給（too_different：那是另寫一篇，不是修改）
 *   errors[] 找不到位置     整則丟掉（找不到位置的 excerpt 是模型自己寫的字，可以塞進任意文字）
 *   errors[] 同一個位置     第二則起丟掉（30 則都引用同一個 "the"，就能把一篇範文拆進 30 則說明）
 *   errors[].suggestion    每則英文單詞 ≤ max(25, excerpt 的單詞數 × 2 + 10)；所有建議合計 ≤ min(max(60, n + 30), 120)
 *                          （超過的清成空字串；合計超過時從最後一則往前清；合計上限不隨作文長度一直放大）
 *   _zh 欄位與 top_improvements  每欄英文單詞 ≤ 40（中文說明裡的英文只能是短引用）；errors[].explanation_zh 每則 ≤ 20；
 *                          第二、三位的簡短評語 ≤ 20；超過的清成空字串
 *   _zh 欄位合計            第一位所有中文說明（評語、四項說明、三個優先改進、逐段建議、錯誤說明）的英文單詞合計 ≤ 120，
 *                          超過時從最後一欄往前清（逐欄上限擋不住「拆成 30 則、每則 26 個單詞」）
 *   _zh 欄位                「大學入學考試中心」「大考中心」「CEEC」換成「官方」（S17）
 * suggestion 與 _zh 欄位的英文單詞用 outputEnglishWords 算：NFKC 之後，拉丁、西里爾、希臘字母都算（模型被誘導改用全形、
 * 數學粗體或形近字母寫英文時，上限照樣算得到）。
 * 門檻放在這裡，調整時不用改提示。
 */
export const CUSTOM_OUTPUT_LIMITS = {
  rewriteWordsRatio: 1.3,
  rewriteExtraWords: 10,
  rewriteMaxEditRatio: 0.5,
  suggestionMinWords: 25,
  suggestionWordsPerExcerptWord: 2,
  suggestionExtraWords: 10,
  suggestionsTotalMinWords: 60,
  suggestionsTotalExtraWords: 30,
  suggestionsTotalMaxWords: 120,
  zhEnglishWordsMax: 40,
  errorExplanationEnglishWordsMax: 20,
  holisticCommentEnglishWordsMax: 20,
  zhEnglishWordsTotalMax: 120,
} as const;

/** 參考改寫被丟掉的原因。 */
export type RewriteOmitted = 'too_long' | 'too_different';

/** 比對參考改寫用的單詞（小寫、去標點）。 */
function comparableWords(text: string): string[] {
  return text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

/** 兩串單詞的編輯距離（只用兩列，600 × 790 個單詞約 47 萬格）。 */
function tokenEditDistance(x: string[], y: string[]): number {
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length]!;
}

/** 輸出限制用的「英文單詞」：拉丁、西里爾、希臘字母（形近字母）連續的一串，中間可以有一個撇號。 */
const OUTPUT_WORD_RE = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]+(?:['’][\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]+)?/gu;

/**
 * 自訂題輸出限制的英文單詞數。先 NFKC（全形 Ｍｙ、數學粗體 𝐈、圈起來的字母變回 ASCII），再把西里爾、希臘的形近字母也算進去：
 * 只算 [A-Za-z] 的話，模型被題目誘導改用這些字母寫英文時每個上限都算到 0 個單詞（ASCII 英文的結果和 @gsat/shared 的
 * customPromptEnglishWords 相同）。
 */
export function outputEnglishWords(text: string): number {
  return text.normalize('NFKC').match(OUTPUT_WORD_RE)?.length ?? 0;
}


/** 自訂題的程式限制處理的數量（寫進 judgments.meta）。 */
export interface CustomOutputCounts {
  rewrite_dropped?: RewriteOmitted;
  errors_dropped_unlocated: number;
  /** 和前面某一則引用同一個位置的錯誤（丟掉）。 */
  errors_dropped_duplicate: number;
  suggestions_cleared: number;
  /** 單一欄位的英文超過上限而清空。 */
  zh_fields_cleared: number;
  /** 中文說明的英文合計超過上限、從最後一欄往前清空的欄數。 */
  zh_total_cleared: number;
  exam_board_replaced: number;
}

/** 收集自訂題限制的處理數量；_zh 欄位都經過 zh()。 */
class CustomLimiter {
  readonly counts: CustomOutputCounts = {
    errors_dropped_unlocated: 0,
    errors_dropped_duplicate: 0,
    suggestions_cleared: 0,
    zh_fields_cleared: 0,
    zh_total_cleared: 0,
    exam_board_replaced: 0,
  };

  /** 中文說明：考試單位名稱換成「官方」，英文超過 max（預設 40）個單詞就清空。 */
  zh(text: string, max: number = CUSTOM_OUTPUT_LIMITS.zhEnglishWordsMax): string {
    if (text === '') return text;
    const board = replaceExamBoard(text);
    this.counts.exam_board_replaced += board.replaced;
    const replaced = board.text;
    if (outputEnglishWords(replaced) > max) {
      this.counts.zh_fields_cleared += 1;
      return '';
    }
    return replaced;
  }

  /**
   * 所有中文說明欄位的英文單詞合計上限：fields 依畫面順序排好（評語、四項說明、優先改進、逐段建議、錯誤說明），
   * 超過時從最後一欄往前清空，回傳處理後的值（順序不變）。
   */
  zhTotal(fields: string[]): string[] {
    const out = [...fields];
    let total = out.reduce((a, t) => a + outputEnglishWords(t), 0);
    for (let i = out.length - 1; i >= 0 && total > CUSTOM_OUTPUT_LIMITS.zhEnglishWordsTotalMax; i -= 1) {
      const n = outputEnglishWords(out[i]!);
      if (n === 0) continue;
      total -= n;
      out[i] = '';
      this.counts.zh_total_cleared += 1;
    }
    return out;
  }

  /** 每則建議與合計的英文單詞上限（n＝學生作文的單詞數）。 */
  suggestions(errors: EssayError[], n: number): EssayError[] {
    const L = CUSTOM_OUTPUT_LIMITS;
    const out = errors.map((e) => {
      const cap = Math.max(L.suggestionMinWords, outputEnglishWords(e.excerpt) * L.suggestionWordsPerExcerptWord + L.suggestionExtraWords);
      if (e.suggestion !== '' && outputEnglishWords(e.suggestion) > cap) {
        this.counts.suggestions_cleared += 1;
        return { ...e, suggestion: '' };
      }
      return e;
    });
    const totalCap = Math.min(L.suggestionsTotalMaxWords, Math.max(L.suggestionsTotalMinWords, n + L.suggestionsTotalExtraWords));
    let total = out.reduce((a, e) => a + outputEnglishWords(e.suggestion), 0);
    for (let i = out.length - 1; i >= 0 && total > totalCap; i -= 1) {
      const e = out[i]!;
      if (e.suggestion === '') continue;
      total -= outputEnglishWords(e.suggestion);
      out[i] = { ...e, suggestion: '' };
      this.counts.suggestions_cleared += 1;
    }
    return out;
  }

  /**
   * 參考改寫：英文單詞 ≤ ceil(n × 1.3) + 10，而且和學生原文的單詞編輯距離 ≤ ceil(n × 0.5)（提示要求的是「保留原本想法、
   * 順序、段落的輕度修改」；差太多就是另寫一篇）。不符合回 null 並記下原因。
   */
  rewrite(rewrite: string | null, original: string, n: number): string | null {
    if (rewrite === null || rewrite === '') return rewrite;
    const L = CUSTOM_OUTPUT_LIMITS;
    if (countEnglishWords(rewrite) > Math.ceil(n * L.rewriteWordsRatio) + L.rewriteExtraWords) {
      this.counts.rewrite_dropped = 'too_long';
      return null;
    }
    if (tokenEditDistance(comparableWords(original), comparableWords(rewrite)) > Math.ceil(n * L.rewriteMaxEditRatio)) {
      this.counts.rewrite_dropped = 'too_different';
      return null;
    }
    return rewrite;
  }
}

function safetyOf(flag: string): string | null {
  return flag === 'none' ? null : flag;
}

/** 第一位（完整批改）。自訂題（ctx.custom）在既有的輸出過濾之後再套用 CUSTOM_OUTPUT_LIMITS，處理數量放在 output_limits。 */
export function scoreEssayAnalytic(role: RaterRole, ctx: EssayContext, output: EssayAnalyticOutput, filter: OutputFilter): EssayRaterRecord {
  const deductions = essayDeductions(ctx.wordCount, ctx.paragraphs, ctx.requiredParagraphs);
  const deductionPoints = deductions.reduce((a, d) => a + d.points, 0);
  const raw = Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, output.criteria[c].score])) as Record<EssayCriterion, number>;
  const { scores, total } = essayRaterTotal(raw, output.off_topic, deductionPoints);
  const ranges = paragraphRanges(ctx.text, ctx.photoMode);
  const limiter = ctx.custom === true ? new CustomLimiter() : null;
  let cursor = 0;
  const errors: EssayError[] = [];
  const usedSpans = new Set<string>();
  for (const e of output.errors.slice(0, 30)) {
    const loc = locate(ctx.text, e.excerpt, cursor);
    if (!loc && limiter) {
      // 自訂題：在原文找不到位置的錯誤整則丟掉。
      limiter.counts.errors_dropped_unlocated += 1;
      continue;
    }
    if (loc && limiter) {
      // 自訂題：和前面某一則引用同一個位置的錯誤丟掉（locate 從頭找回同一個字時）。
      const span = `${loc.start}:${loc.end}`;
      if (usedSpans.has(span)) {
        limiter.counts.errors_dropped_duplicate += 1;
        continue;
      }
      usedSpans.add(span);
    }
    if (loc) cursor = loc.end;
    const para = loc ? ranges.findIndex((r) => loc.start >= r.start && loc.start <= r.end) : -1;
    errors.push({
      paragraph_index: para >= 0 ? para : Math.max(0, Math.min(ranges.length - 1, e.paragraph_index)),
      category: e.category,
      start: loc?.start ?? 0,
      end: loc?.end ?? 0,
      excerpt: loc ? ctx.text.slice(loc.start, loc.end) : filter.text(e.excerpt, 300),
      explanation_zh: filter.text(e.explanation_zh, 600),
      suggestion: filter.text(e.suggestion, 600),
    });
  }
  const record: EssayRaterRecord = {
    result: { role, scores, off_topic: output.off_topic, total, comment_zh: filter.text(output.comment_zh, 1_000) },
    deductions,
    criteria_explanations: Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, filter.text(output.criteria[c].explanation_zh, 1_000)])) as Record<EssayCriterion, string>,
    top_improvements: output.top_improvements
      .slice(0, 3)
      .map((t) => filter.text(t, 400))
      .filter((t) => t !== ''),
    paragraph_advice: output.paragraph_advice
      .filter((p) => p.paragraph_index >= 0 && p.paragraph_index < Math.max(1, ranges.length))
      .slice(0, 10)
      .map((p) => ({ paragraph_index: p.paragraph_index, advice_zh: filter.text(p.advice_zh, 800) })),
    errors,
    rewrite: output.rewrite ? filter.text(output.rewrite, 5_000) : null,
    safety_flag: safetyOf(output.safety_flag),
  };
  if (!limiter) return record;
  const zh = (t: string) => limiter.zh(t);
  const rewrite = limiter.rewrite(record.rewrite, ctx.text, ctx.wordCount);
  // 先套每欄的上限，再套全部中文說明的合計上限（依畫面順序；從最後一欄往前清）。
  const comment = zh(record.result.comment_zh);
  const criteria = ESSAY_CRITERIA.map((c) => zh(record.criteria_explanations?.[c] ?? ''));
  const top = record.top_improvements.map(zh);
  const advice = record.paragraph_advice.map((p) => zh(p.advice_zh));
  const explanations = record.errors.map((e) => limiter.zh(e.explanation_zh, CUSTOM_OUTPUT_LIMITS.errorExplanationEnglishWordsMax));
  const limited = limiter.zhTotal([comment, ...criteria, ...top, ...advice, ...explanations]);
  let at = 0;
  const take = (n: number) => {
    const part = limited.slice(at, at + n);
    at += n;
    return part;
  };
  const [commentOut] = take(1);
  const criteriaOut = take(criteria.length);
  const topOut = take(top.length);
  const adviceOut = take(advice.length);
  const explanationsOut = take(explanations.length);
  return {
    ...record,
    result: { ...record.result, comment_zh: commentOut ?? '' },
    criteria_explanations: Object.fromEntries(ESSAY_CRITERIA.map((c, i) => [c, criteriaOut[i] ?? ''])) as Record<EssayCriterion, string>,
    top_improvements: topOut.filter((t) => t !== ''),
    paragraph_advice: record.paragraph_advice.map((p, i) => ({ ...p, advice_zh: adviceOut[i] ?? '' })).filter((p) => p.advice_zh !== ''),
    errors: limiter.suggestions(
      record.errors.map((e, i) => ({ ...e, explanation_zh: explanationsOut[i] ?? '' })),
      ctx.wordCount,
    ),
    rewrite,
    ...(limiter.counts.rewrite_dropped ? { rewrite_omitted: limiter.counts.rewrite_dropped } : {}),
    output_limits: limiter.counts,
  };
}

/** 第二、三位（只有分數與簡短評語）。自訂題的 comment_zh 套用 _zh 規則（簡短評語的英文上限是 20 個單詞）。 */
export function scoreEssayHolistic(role: RaterRole, ctx: EssayContext, output: EssayHolisticOutput, filter: OutputFilter): EssayRaterRecord {
  const deductions = essayDeductions(ctx.wordCount, ctx.paragraphs, ctx.requiredParagraphs);
  const deductionPoints = deductions.reduce((a, d) => a + d.points, 0);
  const { scores, total } = essayRaterTotal(output.scores, output.off_topic, deductionPoints);
  const limiter = ctx.custom === true ? new CustomLimiter() : null;
  const comment = filter.text(output.comment_zh, 1_000);
  return {
    result: { role, scores, off_topic: output.off_topic, total, comment_zh: limiter ? limiter.zh(comment, CUSTOM_OUTPUT_LIMITS.holisticCommentEnglishWordsMax) : comment },
    deductions,
    criteria_explanations: null,
    top_improvements: [],
    paragraph_advice: [],
    errors: [],
    rewrite: null,
    safety_flag: safetyOf(output.safety_flag),
    ...(limiter ? { output_limits: limiter.counts } : {}),
  };
}

/**
 * 合成作文的最後結果。詳細回饋只有第一位（analytic）有：第一位被「取最接近的兩位」排除時，它解釋分數的
 * 各項說明、三個優先改進與逐段建議會和最後的分數互相矛盾，所以改成空的、標記 explanations_from_excluded_rater；
 * 錯誤清單（文字本身的拼字、文法問題）與改寫範例和分數無關，照樣保留；被採用的兩位的簡短評語在 raters[].comment_zh。
 */
export function combineEssay(records: Array<EssayRaterRecord & { role: RaterRole }>, ctx: { wordCount: number; paragraphs: number }): EssayGradingResult {
  const sorted = byRole(records);
  const primary = sorted.find((r) => r.role === 'primary') ?? sorted[0]!;
  const [x, y] = pickRaterPair(sorted.map((r) => ({ ...r, total: r.result.total })));
  const primaryExcluded = x.role !== primary.role && y.role !== primary.role;
  const finalScore = round6((x.result.total + y.result.total) / 2);
  const criteria = Object.fromEntries(
    ESSAY_CRITERIA.map((c): [EssayCriterion, EssayCriterionResult] => [
      c,
      { score: round6((x.result.scores[c] + y.result.scores[c]) / 2), explanation_zh: primaryExcluded ? '' : (primary.criteria_explanations?.[c] ?? '') },
    ]),
  ) as Record<EssayCriterion, EssayCriterionResult>;
  return {
    kind: 'essay',
    final_score: finalScore,
    max_score: ESSAY_MAX_SCORE,
    band: essayBandOf(finalScore),
    criteria,
    raters: sorted.map((r) => r.result),
    third_rater_used: sorted.some((r) => r.role === 'third'),
    off_topic: x.result.off_topic && y.result.off_topic,
    deductions: primary.deductions,
    word_count: ctx.wordCount,
    paragraphs: ctx.paragraphs,
    top_improvements: primaryExcluded ? [] : primary.top_improvements,
    paragraph_advice: primaryExcluded ? [] : primary.paragraph_advice,
    errors: primary.errors,
    rewrite: primary.rewrite,
    safety_flag: sorted.map((r) => r.safety_flag).find((f) => f !== null) ?? null,
    ...(primaryExcluded ? { explanations_from_excluded_rater: true } : {}),
    // 自訂題的參考改寫被程式限制丟掉時讓結果頁知道（沒有這個欄位＝沒被丟掉；題庫題的回應逐字不變）。
    ...(primary.rewrite_omitted ? { rewrite_omitted: primary.rewrite_omitted } : {}),
  };
}

// ───────────────────────── OCR ─────────────────────────

/** 轉錄本文只剝 HTML 標籤（和 filter.ts 的 HTML_TAG_RE 相同的樣式）。 */
const OCR_HTML_TAG_RE = /<\/?[a-zA-Z][^<>]*>/g;

/**
 * OCR 輸出 → OcrResult：行內換行 '\n'、段落之間空一行；依 [[?]] 出現的順序配上候選字，算出位置
 * （每一行的 unclear 數量和標記數不同時，多的丟掉、少的給空候選）。
 * 候選字是模型自己產生的文字：經過輸出過濾（剝 HTML、網址、遮個資；不當內容整個候選丟掉，類別記在 filter）。
 * 轉錄本文是學生自己寫的字（和打字作文一樣不做類別過濾，否則會改掉要批改的內容），只剝掉 HTML 標籤
 * （設計文件 §10「A2 修正（第二輪審查）」）。
 */
export function assembleOcr(output: OcrModelOutput, filter?: OutputFilter): { result: OcrResult; uncertainCount: number } {
  // 先依閱讀順序把每一行的候選字對齊到該行的標記（多的丟掉、少的補空陣列），再在組好的全文裡依序找標記。
  const queue: string[][] = [];
  const cleanCandidate = (c: string): string => {
    if (!filter) return c.trim();
    const text = filter.text(c, 60);
    return text === FILTERED_PLACEHOLDER ? '' : text;
  };
  const paragraphs = output.paragraphs
    .filter((p) => p.lines.length > 0)
    .map((p) =>
      p.lines
        .map((line) => {
          const text = line.text.replace(/\r?\n/g, ' ').replace(OCR_HTML_TAG_RE, '').slice(0, 300);
          const marks = text.split(OCR_UNCLEAR_MARK).length - 1;
          for (let k = 0; k < marks; k++) {
            queue.push(
              (line.unclear[k]?.candidates ?? [])
                .filter((c): c is string => typeof c === 'string')
                .map(cleanCandidate)
                .filter((c) => c !== '')
                .slice(0, 3),
            );
          }
          return text;
        })
        .join('\n'),
    );
  const text = paragraphs.join('\n\n');
  const uncertain: OcrUncertainSpan[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(OCR_UNCLEAR_MARK, from);
    if (i < 0) break;
    uncertain.push({ start: i, end: i + OCR_UNCLEAR_MARK.length, candidates: queue[uncertain.length] ?? [] });
    from = i + OCR_UNCLEAR_MARK.length;
  }
  return { result: { text, uncertain, confirmed_at: null }, uncertainCount: uncertain.length };
}

/**
 * 學生確認文字和 OCR 原文的差異量（以單字計的編輯距離，ocr_diff_json 用；不存差異內容本身以外的東西）。
 * 600 字 × 600 字的動態規劃約 36 萬格，CPU 時間可以忽略。
 */
export function wordEditDistance(a: string, b: string): number {
  const x = a.split(/\s+/).filter(Boolean);
  const y = b.split(/\s+/).filter(Boolean);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}
