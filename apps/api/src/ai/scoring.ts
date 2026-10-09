/**
 * 程式計分（SPEC §4.6、§6.8、§6.9；ARCHITECTURE §6.7 第 3 點）。負責：後端 AI A2。
 *
 * 模型只負責「錯在哪裡、屬於哪一類」；這裡把模型的判斷（已通過 zod 驗證）變成分數：
 *   中譯英：每句 4 部分各 1 分、每個錯誤扣 0.5、各部分扣完為止、相同的拼字或文法錯誤只扣一次（兩句之間也算）、
 *           整個部分漏譯為 0；句首未大寫、句尾標點不妥由程式判定，各扣 0.5（一句裡同一種只扣一次）。
 *   作文：四項各 0–5；離題時內容以外三項為 0；少於 100 個單詞或未分段扣總分 1（同時發生只扣 1）；四項加總。
 *   兩位評分者平均；差距超過門檻（作文 >5、中譯英 >2）才有第三位，取三者中最接近的兩個平均（設計值）。
 * 錯誤的位置一律由程式在原文中搜尋模型引用的片段得出（不採用模型自己算的位移）。
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
import { FILTERED_PLACEHOLDER, type OutputFilter } from './filter';
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

/** 句首大寫與句尾標點（程式判定，SPEC §4.6）。 */
export interface MechanicsCheck {
  capitalization: { start: number; end: number } | null;
  punctuation: { start: number; end: number } | null;
}

const CJK_PUNCT = /[。、「」『』《》〈〉【】〔〕…‥]/;

export function checkMechanics(sentence: string): MechanicsCheck {
  const firstLetter = sentence.search(/[A-Za-z]/);
  const capitalization = firstLetter >= 0 && /[a-z]/.test(sentence[firstLetter]!) ? { start: firstLetter, end: firstLetter + 1 } : null;
  let punctuation: MechanicsCheck['punctuation'] = null;
  const cjk = sentence.search(CJK_PUNCT);
  const trimmedEnd = sentence.replace(/\s+$/, '').length;
  // 句尾可以有收尾的引號或括號：He said, "Yes."
  const core = sentence.slice(0, trimmedEnd).replace(/["'”’)\]]+$/, '');
  if (cjk >= 0) punctuation = { start: cjk, end: cjk + 1 };
  else if (trimmedEnd > 0 && !/[.!?]$/.test(core)) punctuation = { start: trimmedEnd - 1, end: trimmedEnd };
  return { capitalization, punctuation };
}

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
}

export interface EssayContext {
  text: string;
  wordCount: number;
  paragraphs: number;
  requiredParagraphs: number | null;
  photoMode: boolean;
}

function safetyOf(flag: string): string | null {
  return flag === 'none' ? null : flag;
}

/** 第一位（完整批改）。 */
export function scoreEssayAnalytic(role: RaterRole, ctx: EssayContext, output: EssayAnalyticOutput, filter: OutputFilter): EssayRaterRecord {
  const deductions = essayDeductions(ctx.wordCount, ctx.paragraphs, ctx.requiredParagraphs);
  const deductionPoints = deductions.reduce((a, d) => a + d.points, 0);
  const raw = Object.fromEntries(ESSAY_CRITERIA.map((c) => [c, output.criteria[c].score])) as Record<EssayCriterion, number>;
  const { scores, total } = essayRaterTotal(raw, output.off_topic, deductionPoints);
  const ranges = paragraphRanges(ctx.text, ctx.photoMode);
  let cursor = 0;
  const errors: EssayError[] = output.errors.slice(0, 30).map((e) => {
    const loc = locate(ctx.text, e.excerpt, cursor);
    if (loc) cursor = loc.end;
    const para = loc ? ranges.findIndex((r) => loc.start >= r.start && loc.start <= r.end) : -1;
    return {
      paragraph_index: para >= 0 ? para : Math.max(0, Math.min(ranges.length - 1, e.paragraph_index)),
      category: e.category,
      start: loc?.start ?? 0,
      end: loc?.end ?? 0,
      excerpt: loc ? ctx.text.slice(loc.start, loc.end) : filter.text(e.excerpt, 300),
      explanation_zh: filter.text(e.explanation_zh, 600),
      suggestion: filter.text(e.suggestion, 600),
    };
  });
  return {
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
}

/** 第二、三位（只有分數與簡短評語）。 */
export function scoreEssayHolistic(role: RaterRole, ctx: EssayContext, output: EssayHolisticOutput, filter: OutputFilter): EssayRaterRecord {
  const deductions = essayDeductions(ctx.wordCount, ctx.paragraphs, ctx.requiredParagraphs);
  const deductionPoints = deductions.reduce((a, d) => a + d.points, 0);
  const { scores, total } = essayRaterTotal(output.scores, output.off_topic, deductionPoints);
  return {
    result: { role, scores, off_topic: output.off_topic, total, comment_zh: filter.text(output.comment_zh, 1_000) },
    deductions,
    criteria_explanations: null,
    top_improvements: [],
    paragraph_advice: [],
    errors: [],
    rewrite: null,
    safety_flag: safetyOf(output.safety_flag),
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
