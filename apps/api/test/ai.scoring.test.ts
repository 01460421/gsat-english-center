/**
 * 程式計分（src/ai/scoring.ts）：SPEC §4.6、§6.8、§6.9 的規則。模型只給判斷，分數全部由這裡算，
 * 寫錯就是學生看到錯的分數，所以每條規則都有案例。
 */
import { countEnglishWords, countParagraphs, customPromptEnglishWords, essayBandOf } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { OutputFilter } from '../src/ai/filter';
import type { TranslationModelOutput } from '../src/ai/prompts/translation';
import { combineGradingRows } from '../src/submissions/repo';
import {
  CUSTOM_OUTPUT_LIMITS,
  assembleOcr,
  checkMechanics,
  combineEssay,
  combineTranslation,
  essayDeductions,
  essayRaterTotal,
  essayScoresProblem,
  locate,
  needsThirdRater,
  outputEnglishWords,
  paragraphRanges,
  pickRaterPair,
  scoreEssayAnalytic,
  scoreEssayHolistic,
  scoreTranslationRater,
  translationOutputProblem,
  wordEditDistance,
} from '../src/ai/scoring';
import { STUDENT_ESSAY, STUDENT_TRANSLATION, essayAnalyticOutput, essayHolisticOutput, translationAnalyticOutput, translationHolisticOutput } from './helpers/ai';

function out(errors: TranslationModelOutput['errors'], missing: boolean[][] = [[], []]): TranslationModelOutput {
  return {
    sentences: [0, 1].map((i) => ({
      sentence_index: i,
      parts: [1, 2, 3, 4].map((p) => ({ part: p, source_zh: 'x', student_excerpt: 'y', missing: missing[i]?.[p - 1] ?? false })),
      corrected: 'C.',
      explanation_zh: '說明',
    })),
    errors,
  };
}

const CLEAN = ['The cat sat on the mat.', 'It was very happy.'];
const err = (sentence_index: number, part: number, category: TranslationModelOutput['errors'][number]['category'], excerpt: string, repeat_of: number | null = null) => ({
  sentence_index,
  part,
  category,
  excerpt,
  explanation_zh: 'x',
  suggestion: 'y',
  repeat_of,
});

describe('中譯英計分（每句 4 部分、每錯 0.5、扣完為止、同錯一次）', () => {
  it('沒有錯誤：每句 4 分、一組 8 分', () => {
    const r = scoreTranslationRater('primary', CLEAN, out([]), new OutputFilter());
    expect(r.result.score).toBe(8);
    expect(r.result.sentences.map((s) => s.part_scores)).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
  });

  it('每個錯誤扣 0.5，同一部分最多扣到 0（第三個錯不再扣）', () => {
    const r = scoreTranslationRater('primary', CLEAN, out([err(0, 1, 'grammar', 'The'), err(0, 1, 'word_choice', 'cat'), err(0, 1, 'meaning', 'sat')]), new OutputFilter());
    expect(r.result.sentences[0]!.part_scores).toEqual([0, 1, 1, 1]);
    expect(r.result.sentences[0]!.score).toBe(3);
    expect(r.errors.map((e) => e.deducted)).toEqual([0.5, 0.5, 0]);
  });

  it('各部分獨立：不同部分的錯誤各自扣', () => {
    const r = scoreTranslationRater('primary', CLEAN, out([err(0, 1, 'grammar', 'The'), err(0, 3, 'grammar', 'on'), err(1, 4, 'spelling', 'happy')]), new OutputFilter());
    expect(r.result.sentences.map((s) => s.score)).toEqual([3, 3.5]);
    expect(r.result.score).toBe(6.5);
  });

  it('相同的拼字錯誤只扣一次（兩句之間也算；模型沒標 repeat_of 時程式也認得同一個拼錯的字）', () => {
    const sentences = ['The recieve was late.', 'We recieve it now.'];
    const r = scoreTranslationRater('primary', sentences, out([err(0, 2, 'spelling', 'recieve'), err(1, 2, 'spelling', 'recieve')]), new OutputFilter());
    expect(r.errors[1]!.repeat_of).toBe(0);
    expect(r.errors[1]!.deducted).toBe(0);
    expect(r.result.score).toBe(7.5);
  });

  it('相同的文法錯誤以 repeat_of 標示只扣一次；指向不同類別或後面的錯誤不算', () => {
    const r = scoreTranslationRater(
      'primary',
      CLEAN,
      out([err(0, 2, 'grammar', 'cat sat'), err(1, 2, 'grammar', 'was', 0), err(1, 3, 'word_choice', 'very', 0), err(1, 4, 'grammar', 'happy', 3)]),
      new OutputFilter(),
    );
    expect(r.errors.map((e) => e.repeat_of)).toEqual([null, 0, null, null]);
    expect(r.errors.map((e) => e.deducted)).toEqual([0.5, 0, 0.5, 0.5]);
  });

  it('整個部分漏譯（missing）＝該部分 0 分，裡面的錯誤不再另外扣', () => {
    const r = scoreTranslationRater('primary', CLEAN, out([err(0, 4, 'omission', '')], [[false, false, false, true], []]), new OutputFilter());
    expect(r.result.sentences[0]!.part_scores).toEqual([1, 1, 1, 0]);
    expect(r.errors[0]!.deducted).toBe(0);
    expect(r.result.score).toBe(7);
  });

  it('句首未大寫、句尾標點各扣 0.5（程式判定），一句最多扣 1，扣到 0 為止', () => {
    const r = scoreTranslationRater('primary', ['the cat sat on the mat', 'It was very happy.'], out([]), new OutputFilter());
    expect(r.result.sentences[0]!.mechanics_deduction).toBe(1);
    expect(r.result.sentences[0]!.score).toBe(3);
    const mech = r.errors.filter((e) => e.part === null).map((e) => e.category);
    expect(mech).toEqual(['capitalization', 'punctuation']);
    // 全部漏譯時沒有分數可以扣。
    const zero = scoreTranslationRater('primary', ['the cat', 'It was very happy.'], out([], [[true, true, true, true], []]), new OutputFilter());
    expect(zero.result.sentences[0]!.score).toBe(0);
    expect(zero.result.sentences[0]!.mechanics_deduction).toBe(0);
  });

  it('句尾標點：中文標點算不妥；收尾引號或括號後面的句號可以', () => {
    expect(checkMechanics('He said, "Yes."').punctuation).toBeNull();
    expect(checkMechanics('Is it true?').punctuation).toBeNull();
    expect(checkMechanics('It is true。').punctuation).not.toBeNull();
    expect(checkMechanics('It is true').punctuation).not.toBeNull();
    expect(checkMechanics('"it is true."').capitalization).not.toBeNull();
  });

  it('錯誤位置由程式在原文裡找；找不到時 start＝end＝0（只列清單）', () => {
    const r = scoreTranslationRater('primary', STUDENT_TRANSLATION, out([err(0, 2, 'grammar', 'teacher has'), err(1, 4, 'grammar', '不存在的片段')]), new OutputFilter());
    expect(STUDENT_TRANSLATION[0]!.slice(r.errors[0]!.start, r.errors[0]!.end)).toBe('teacher has');
    expect([r.errors[1]!.start, r.errors[1]!.end]).toEqual([0, 0]);
  });

  it('測試用的兩位評分者：第一位 5.5、第二位 6，平均 5.75', () => {
    const a = scoreTranslationRater('primary', STUDENT_TRANSLATION, translationAnalyticOutput(), new OutputFilter());
    const b = scoreTranslationRater('second', STUDENT_TRANSLATION, translationHolisticOutput(), new OutputFilter());
    expect(a.result.score).toBe(5.5);
    expect(b.result.score).toBe(6);
    const final = combineTranslation([
      { role: 'primary', ...a },
      { role: 'second', ...b },
    ]);
    expect(final.final_score).toBe(5.75);
    expect(final.sentence_scores).toEqual([3.5, 2.25]);
    expect(final.third_rater_used).toBe(false);
    expect(final.max_score).toBe(8);
  });

  it('語意檢查：句數不對、部分編號不是 1–4 都算輸出無效', () => {
    const o = translationAnalyticOutput();
    expect(translationOutputProblem(o, 2)).toBeNull();
    expect(translationOutputProblem({ ...o, sentences: o.sentences.slice(0, 1) }, 2)).not.toBeNull();
    const bad = structuredClone(o);
    bad.sentences[0]!.parts.pop();
    expect(translationOutputProblem(bad, 2)).not.toBeNull();
  });
});

describe('第三位評分者與最接近的兩位', () => {
  it('門檻：作文 >5、中譯英 >2（剛好等於門檻不需要）', () => {
    expect(needsThirdRater('translation', 6, 4)).toBe(false);
    expect(needsThirdRater('translation', 6.5, 4)).toBe(true);
    expect(needsThirdRater('essay', 15, 10)).toBe(false);
    expect(needsThirdRater('essay', 16, 10)).toBe(true);
  });

  it('三位時取差距最小的兩位', () => {
    const pick = pickRaterPair([
      { role: 'primary' as const, total: 5.5 },
      { role: 'second' as const, total: 1 },
      { role: 'third' as const, total: 5 },
    ]);
    expect(pick.map((p) => p.role)).toEqual(['primary', 'third']);
  });

  it('中譯英：第二位全部漏譯（1 分）→ 加第三位 → 最後取 5.5 與第三位的平均', () => {
    const a = scoreTranslationRater('primary', STUDENT_TRANSLATION, translationAnalyticOutput(), new OutputFilter());
    const b = scoreTranslationRater('second', STUDENT_TRANSLATION, translationHolisticOutput({ allMissing: true }), new OutputFilter());
    const c = scoreTranslationRater('third', STUDENT_TRANSLATION, translationHolisticOutput(), new OutputFilter());
    expect(b.result.score).toBe(1);
    expect(needsThirdRater('translation', a.result.score, b.result.score)).toBe(true);
    const final = combineTranslation([
      { role: 'third', ...c },
      { role: 'primary', ...a },
      { role: 'second', ...b },
    ]);
    expect(final.third_rater_used).toBe(true);
    expect(final.final_score).toBe(5.75);
    expect(final.raters.map((r) => r.role)).toEqual(['primary', 'second', 'third']);
  });
});

describe('被排除的評分者（審查發現 12）', () => {
  it('中譯英：第一位是離群值、被排除時，錯誤清單、修正版、說明改取第二位（說明和分數一致）', () => {
    const a = scoreTranslationRater('primary', STUDENT_TRANSLATION, translationHolisticOutput({ allMissing: true }), new OutputFilter());
    const bOut = translationHolisticOutput();
    bOut.sentences[0]!.explanation_zh = '第二位的說明';
    const b = scoreTranslationRater('second', STUDENT_TRANSLATION, bOut, new OutputFilter());
    const c = scoreTranslationRater('third', STUDENT_TRANSLATION, translationAnalyticOutput(), new OutputFilter());
    const final = combineTranslation([
      { role: 'primary', ...a },
      { role: 'second', ...b },
      { role: 'third', ...c },
    ]);
    expect(final.final_score).toBe(5.75); // 6 與 5.5
    expect(final.explanation_zh[0]).toBe('第二位的說明');
    expect(final.errors).toEqual(b.errors);
    // 第一位有被採用時照舊取第一位。
    const normal = combineTranslation([
      { role: 'primary', ...c },
      { role: 'second', ...b },
    ]);
    expect(normal.errors).toEqual(c.errors);
  });
});

describe('作文計分（四項各 0–5、總分 20、字數與分段扣分）', () => {
  const words = countEnglishWords(STUDENT_ESSAY);
  const ctx = { text: STUDENT_ESSAY, wordCount: words, paragraphs: countParagraphs(STUDENT_ESSAY), requiredParagraphs: 2, photoMode: false };

  it('測試作文：兩段、100 字以上', () => {
    expect(words).toBeGreaterThan(120);
    expect(ctx.paragraphs).toBe(2);
  });

  it('少於 100 字扣 1；未分段扣 1；兩者同時只扣 1（兩項都列出、第二項 0 分）', () => {
    expect(essayDeductions(99, 2, 2)).toEqual([{ code: 'too_short', points: 1 }]);
    expect(essayDeductions(100, 2, 2)).toEqual([]);
    expect(essayDeductions(130, 1, 2)).toEqual([{ code: 'no_paragraphs', points: 1 }]);
    expect(essayDeductions(80, 1, 2)).toEqual([
      { code: 'too_short', points: 1 },
      { code: 'no_paragraphs', points: 0 },
    ]);
    // 題目沒有規定段數就不做未分段扣分。
    expect(essayDeductions(130, 1, null)).toEqual([]);
  });

  it('離題：內容以外三項為 0；總分最低 0', () => {
    expect(essayRaterTotal({ content: 1, organization: 4, grammar: 4, vocabulary: 4 }, true, 0)).toEqual({
      scores: { content: 1, organization: 0, grammar: 0, vocabulary: 0 },
      total: 1,
    });
    expect(essayRaterTotal({ content: 0, organization: 0, grammar: 0, vocabulary: 0 }, false, 1).total).toBe(0);
  });

  it('總分由程式加總四項（不採用模型給的總分）', () => {
    const r = scoreEssayHolistic('second', ctx, { ...essayHolisticOutput([3, 3, 3, 3]), holistic_total: 20 }, new OutputFilter());
    expect(r.result.total).toBe(12);
  });

  it('分數範圍檢查：超過 5 或負數算輸出無效', () => {
    expect(essayScoresProblem({ content: 5, organization: 0, grammar: 3, vocabulary: 4 })).toBeNull();
    expect(essayScoresProblem({ content: 6, organization: 0, grammar: 3, vocabulary: 4 })).not.toBeNull();
    expect(essayScoresProblem({ content: -1, organization: 0, grammar: 3, vocabulary: 4 })).not.toBeNull();
  });

  it('兩位平均（14 與 12 → 13，等級「可」）；錯誤位置與段落由程式定位', () => {
    const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(), new OutputFilter());
    const b = scoreEssayHolistic('second', ctx, essayHolisticOutput(), new OutputFilter());
    expect(a.result.total).toBe(14);
    const final = combineEssay(
      [
        { role: 'primary', ...a },
        { role: 'second', ...b },
      ],
      { wordCount: words, paragraphs: 2 },
    );
    expect(final.final_score).toBe(13);
    expect(final.band).toBe('fair');
    expect(final.criteria.content.score).toBe(3.5);
    expect(final.top_improvements).toHaveLength(3);
    const e = final.errors[0]!;
    expect(STUDENT_ESSAY.slice(e.start, e.end)).toBe('feel lonely after work');
    expect(e.paragraph_index).toBe(1);
  });

  it('差距 >5 加第三位，取最接近的兩位（14、4、13 → 13.5）', () => {
    const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(), new OutputFilter());
    const b = scoreEssayHolistic('second', ctx, essayHolisticOutput([1, 1, 1, 1]), new OutputFilter());
    const c = scoreEssayHolistic('third', ctx, essayHolisticOutput([4, 3, 3, 3]), new OutputFilter());
    expect(needsThirdRater('essay', a.result.total, b.result.total)).toBe(true);
    const final = combineEssay(
      [
        { role: 'primary', ...a },
        { role: 'second', ...b },
        { role: 'third', ...c },
      ],
      { wordCount: words, paragraphs: 2 },
    );
    expect(final.final_score).toBe(13.5);
    expect(essayBandOf(final.final_score)).toBe('fair');
    expect(final.third_rater_used).toBe(true);
  });

  it('第一位是離群值、被排除時：各項說明、三個優先改進、逐段建議清空並標記；錯誤清單與改寫保留', () => {
    const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput([1, 1, 1, 1], { rewrite: 'A rewrite.' }), new OutputFilter());
    const b = scoreEssayHolistic('second', ctx, essayHolisticOutput([4, 3, 3, 3]), new OutputFilter());
    const c = scoreEssayHolistic('third', ctx, essayHolisticOutput([4, 4, 3, 3]), new OutputFilter());
    const final = combineEssay(
      [
        { role: 'primary', ...a },
        { role: 'second', ...b },
        { role: 'third', ...c },
      ],
      { wordCount: words, paragraphs: 2 },
    );
    expect(final.final_score).toBe(13.5);
    expect(final.explanations_from_excluded_rater).toBe(true);
    expect(Object.values(final.criteria).map((x) => x.explanation_zh)).toEqual(['', '', '', '']);
    expect(final.top_improvements).toEqual([]);
    expect(final.paragraph_advice).toEqual([]);
    expect(final.errors).toHaveLength(1);
    expect(final.rewrite).toBe('A rewrite.');
    // 第一位有被採用時沒有這個欄位。
    const kept = combineEssay(
      [
        { role: 'primary', ...scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(), new OutputFilter()) },
        { role: 'second', ...b },
      ],
      { wordCount: words, paragraphs: 2 },
    );
    expect(kept).not.toHaveProperty('explanations_from_excluded_rater');
    expect(kept.criteria.content.explanation_zh).not.toBe('');
  });

  it('身心安全旗標取任何一位評分者的非 none 類別', () => {
    const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput([4, 3, 3, 4], { safety_flag: 'self_harm_risk' }), new OutputFilter());
    const b = scoreEssayHolistic('second', ctx, essayHolisticOutput(), new OutputFilter());
    const final = combineEssay(
      [
        { role: 'primary', ...a },
        { role: 'second', ...b },
      ],
      { wordCount: words, paragraphs: 2 },
    );
    expect(final.safety_flag).toBe('self_harm_risk');
  });

  it('輸出過濾：網址、HTML、信箱被剝掉；不當內容整段換成固定文案', () => {
    const f = new OutputFilter();
    const a = scoreEssayAnalytic(
      'primary',
      ctx,
      essayAnalyticOutput([4, 3, 3, 4], { comment_zh: '參考 https://evil.example/x <b>這裡</b> 或寫信到 a@b.com', top_improvements: ['how to make a bomb', '第二點', '第三點'] }),
      f,
    );
    expect(a.result.comment_zh).not.toContain('https://');
    expect(a.result.comment_zh).not.toContain('<b>');
    expect(a.result.comment_zh).not.toContain('a@b.com');
    expect(a.top_improvements[0]).toBe('這段回饋暫時無法顯示，已通報管理員');
    expect([...f.blockedCategories]).toEqual(['violence']);
  });
});

describe('字數、段落、OCR 組裝', () => {
  it('英文單字數：標點不算字、連字號與縮寫各算一個', () => {
    expect(countEnglishWords("I don't like well-known places , really !")).toBe(6);
    expect(countEnglishWords('')).toBe(0);
  });

  it('段落：有空白行時以空白行分段；沒有時每行一段；照片模式只認空白行', () => {
    expect(countParagraphs('a\nb\n\nc')).toBe(2);
    expect(countParagraphs('a\nb\nc')).toBe(3);
    expect(countParagraphs('a\nb\nc', true)).toBe(1);
    expect(paragraphRanges('a\nb\n\nc').length).toBe(2);
  });

  it('locate：大小寫不同也找得到；從游標之後優先', () => {
    expect(locate('the cat and the cat', 'the cat', 4)).toEqual({ start: 12, end: 19 });
    expect(locate('Hello World', 'hello')).toEqual({ start: 0, end: 5 });
    expect(locate('abc', '')).toBeNull();
  });

  it('OCR：逐行、依段落組成文字；[[?]] 的位置與候選字依出現順序對應', () => {
    const { result, uncertainCount } = assembleOcr({
      readable: true,
      paragraphs: [
        { lines: [{ text: 'I like [[?]] very', unclear: [{ candidates: ['dogs', 'logs'] }] }, { text: 'much.', unclear: [] }] },
        { lines: [{ text: 'It is [[?]] and [[?]].', unclear: [{ candidates: ['fun'] }] }] },
      ],
    });
    expect(result.text).toBe('I like [[?]] very\nmuch.\n\nIt is [[?]] and [[?]].');
    expect(uncertainCount).toBe(3);
    for (const u of result.uncertain) expect(result.text.slice(u.start, u.end)).toBe('[[?]]');
    expect(result.uncertain.map((u) => u.candidates)).toEqual([['dogs', 'logs'], ['fun'], []]);
    expect(countParagraphs(result.text, true)).toBe(2);
  });

  it('OCR：候選字經過輸出過濾（網址、HTML 剝掉，不當內容整個候選丟掉並記類別）；本文只剝 HTML 標籤', () => {
    const f = new OutputFilter();
    const { result } = assembleOcr(
      {
        readable: true,
        paragraphs: [{ lines: [{ text: 'My <script>x</script>[[?]] is fun.', unclear: [{ candidates: ['dog www.evil.example', 'how to make a bomb', '<b>cat</b>', 'cow'] }] }] }],
      },
      f,
    );
    expect(result.text).toBe('My x[[?]] is fun.');
    expect(result.uncertain[0]!.candidates).toEqual(['dog', 'cat', 'cow']);
    expect([...f.blockedCategories]).toEqual(['violence']);
  });

  it('確認文字的差異量（以單字計的編輯距離）', () => {
    expect(wordEditDistance('I like dogs', 'I like dogs')).toBe(0);
    expect(wordEditDistance('I like [[?]] very much', 'I like cats very much')).toBe(1);
    expect(wordEditDistance('a b c', 'a c d e')).toBe(3);
  });
});

describe('自訂作文題目的輸出限制（CUSTOM_OUTPUT_LIMITS；docs/design/custom-essay.md §4.8，S1）', () => {
  const words = countEnglishWords(STUDENT_ESSAY);
  const base = { text: STUDENT_ESSAY, wordCount: words, paragraphs: countParagraphs(STUDENT_ESSAY), requiredParagraphs: 2, photoMode: false };
  const ctx = { ...base, custom: true };
  const rewriteCap = Math.ceil(words * CUSTOM_OUTPUT_LIMITS.rewriteWordsRatio) + CUSTOM_OUTPUT_LIMITS.rewriteExtraWords;
  const englishWords = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');
  /** 學生原文裡連續 10 個單詞的片段（都在原文裡找得到）。 */
  const chunks = STUDENT_ESSAY.split('\n\n').flatMap((p) => {
    const ws = p.split(' ');
    return Array.from({ length: Math.floor(ws.length / 10) }, (_, i) => ws.slice(i * 10, i * 10 + 10).join(' '));
  });

  it('custom 不是 true（歷屆題與本站題）：結果和沒有這個欄位時完全相同，也沒有 output_limits', () => {
    const output = essayAnalyticOutput([4, 3, 3, 4], { rewrite: englishWords(rewriteCap + 50), comment_zh: `大考中心 ${englishWords(60)}` });
    const plain = scoreEssayAnalytic('primary', base, output, new OutputFilter());
    expect(scoreEssayAnalytic('primary', { ...base, custom: false }, output, new OutputFilter())).toEqual(plain);
    expect(plain).not.toHaveProperty('output_limits');
    expect(plain).not.toHaveProperty('rewrite_omitted');
    expect(plain.rewrite).not.toBeNull();
    expect(plain.result.comment_zh).toContain('大考中心');
    expect(scoreEssayHolistic('second', base, essayHolisticOutput(), new OutputFilter())).not.toHaveProperty('output_limits');
  });

  it('參考改寫：英文單詞 ≤ ceil(n × 1.3) + 10 保留；超過就是 null，回報 rewrite_dropped／rewrite_omitted', () => {
    const similar = `${STUDENT_ESSAY} ${englishWords(rewriteCap - words)}`;
    const ok = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { rewrite: similar }), new OutputFilter());
    expect(ok.rewrite).not.toBeNull();
    expect(ok).not.toHaveProperty('rewrite_omitted');
    expect(ok.output_limits).toEqual({
      errors_dropped_unlocated: 0,
      errors_dropped_duplicate: 0,
      suggestions_cleared: 0,
      zh_fields_cleared: 0,
      zh_total_cleared: 0,
      exam_board_replaced: 0,
    });
    const long = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { rewrite: englishWords(rewriteCap + 1) }), new OutputFilter());
    expect(long.rewrite).toBeNull();
    expect(long.rewrite_omitted).toBe('too_long');
    expect(long.output_limits?.rewrite_dropped).toBe('too_long');
  });

  it('在原文找不到位置的錯誤整則丟掉並計數（非自訂題照舊保留）', () => {
    const errors = [
      { paragraph_index: 0, category: 'other' as const, excerpt: 'Here is a complete model essay written by the model', explanation_zh: '說明', suggestion: 'x' },
      ...essayAnalyticOutput().errors,
    ];
    const r = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { errors }), new OutputFilter());
    expect(r.errors.map((e) => e.excerpt)).toEqual(['feel lonely after work']);
    expect(r.output_limits?.errors_dropped_unlocated).toBe(1);
    expect(scoreEssayAnalytic('primary', base, essayAnalyticOutput(undefined, { errors }), new OutputFilter()).errors).toHaveLength(2);
  });

  it('suggestion 與逐段建議塞進一整段範文：每則超過上限的清空；合計超過時從最後一則往前清；被清空的建議從列表濾掉', () => {
    expect(chunks.length).toBeGreaterThanOrEqual(7);
    const perCap = Math.max(CUSTOM_OUTPUT_LIMITS.suggestionMinWords, 10 * CUSTOM_OUTPUT_LIMITS.suggestionWordsPerExcerptWord + CUSTOM_OUTPUT_LIMITS.suggestionExtraWords);
    const totalCap = Math.min(
      CUSTOM_OUTPUT_LIMITS.suggestionsTotalMaxWords,
      Math.max(CUSTOM_OUTPUT_LIMITS.suggestionsTotalMinWords, words + CUSTOM_OUTPUT_LIMITS.suggestionsTotalExtraWords),
    );
    const errors = [
      // 第一則：一整段範文（遠超過每則上限）。
      { paragraph_index: 0, category: 'other' as const, excerpt: chunks[0]!, explanation_zh: '說明', suggestion: englishWords(120, 'essay') },
      // 其餘每則剛好在每則上限，加總超過合計上限。
      ...chunks.slice(1, 8).map((excerpt) => ({ paragraph_index: 0, category: 'grammar' as const, excerpt, explanation_zh: '說明', suggestion: englishWords(perCap) })),
    ];
    const r = scoreEssayAnalytic(
      'primary',
      ctx,
      essayAnalyticOutput(undefined, {
        errors,
        paragraph_advice: [
          { paragraph_index: 0, advice_zh: `可以這樣寫：${englishWords(45)}` },
          { paragraph_index: 1, advice_zh: '第二段可以多一個例子。' },
        ],
      }),
      new OutputFilter(),
    );
    const sizes = r.errors.map((e) => (e.suggestion === '' ? 0 : e.suggestion.split(' ').length));
    expect(sizes[0]).toBe(0);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(totalCap);
    // 從最後一則往前清：留下的是前面的。
    const kept = sizes.slice(1).map((n) => n > 0);
    expect(kept).toEqual([...kept].sort((a, b) => Number(b) - Number(a)));
    expect(kept.some((k) => !k)).toBe(true);
    expect(r.output_limits?.suggestions_cleared).toBe(1 + kept.filter((k) => !k).length);
    expect(r.paragraph_advice).toEqual([{ paragraph_index: 1, advice_zh: '第二段可以多一個例子。' }]);
    expect(r.output_limits?.zh_fields_cleared).toBe(1);
  });

  it('_zh 欄位：英文 41 個單詞清空、39 個保留（top_improvements 也算，清空的濾掉）', () => {
    const r41 = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { comment_zh: `整體不錯：${englishWords(41)}` }), new OutputFilter());
    expect(r41.result.comment_zh).toBe('');
    expect(r41.output_limits?.zh_fields_cleared).toBe(1);
    const r39 = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { comment_zh: `整體不錯：${englishWords(39)}` }), new OutputFilter());
    expect(r39.result.comment_zh).toContain('整體不錯');
    const top = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { top_improvements: ['加例子', englishWords(50), '注意冠詞'] }), new OutputFilter());
    expect(top.top_improvements).toEqual(['加例子', '注意冠詞']);
    const h = scoreEssayHolistic('second', ctx, { ...essayHolisticOutput(), comment_zh: englishWords(41) }, new OutputFilter());
    expect(h.result.comment_zh).toBe('');
    expect(h.output_limits?.zh_fields_cleared).toBe(1);
  });

  describe('security-2：把一篇範文拆進很多欄位也拿不到（跨欄位的合計上限、同一個位置只用一次、參考改寫要像原文）', () => {
    /** 結果裡所有自由文字欄位（學生看得到的）的英文單詞數。 */
    const visibleEnglish = (r: ReturnType<typeof scoreEssayAnalytic>) => {
      const zh = [
        r.result.comment_zh,
        ...Object.values(r.criteria_explanations ?? {}),
        ...r.top_improvements,
        ...r.paragraph_advice.map((p) => p.advice_zh),
        ...r.errors.map((e) => e.explanation_zh),
      ];
      return { zh: zh.reduce((a, t) => a + countEnglishWords(t.replace(/[^A-Za-z' ]/g, ' ')), 0), suggestions: r.errors.reduce((a, e) => a + countEnglishWords(e.suggestion), 0) };
    };
    const model = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => `model${i + offset}`).join(' ');

    it('30 則錯誤都引用同一個 "the"、每則說明放 26 個英文單詞：重複位置的丟掉，中文說明的英文合計 ≤ 120', () => {
      const errors = Array.from({ length: 30 }, (_, i) => ({ paragraph_index: 0, category: 'grammar' as const, excerpt: 'the', explanation_zh: `說明：${model(26, i * 26)}`, suggestion: 'a' }));
      const r = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { errors }), new OutputFilter());
      // locate 找的是子字串（they、their、other 裡的 the 也算），所以最多保留原文裡 the 出現的次數。
      const thes = STUDENT_ESSAY.toLowerCase().match(/the/g)!.length;
      expect(r.errors.length).toBeLessThanOrEqual(thes);
      expect(r.output_limits?.errors_dropped_duplicate).toBe(30 - r.errors.length);
      expect(new Set(r.errors.map((e) => e.start)).size).toBe(r.errors.length);
      expect(visibleEnglish(r).zh).toBeLessThanOrEqual(CUSTOM_OUTPUT_LIMITS.zhEnglishWordsTotalMax);
    });

    it('每則錯誤引用不同的字（位置都找得到）、說明各 19 個單詞，加上每個中文欄位各 26 個單詞：合計 ≤ 120，從最後一欄往前清', () => {
      const distinct = [...new Set(STUDENT_ESSAY.split(/[^A-Za-z]+/).filter((w) => w.length > 3))].slice(0, 30);
      expect(distinct.length).toBe(30);
      const errors = distinct.map((excerpt, i) => ({ paragraph_index: 0, category: 'grammar' as const, excerpt, explanation_zh: `說明：${model(19, i * 19)}`, suggestion: '' }));
      const fill = (i: number) => `說明：${model(26, 1_000 + i * 26)}`;
      const output = essayAnalyticOutput(undefined, {
        errors,
        comment_zh: fill(0),
        top_improvements: [fill(1), fill(2), fill(3)],
        paragraph_advice: [
          { paragraph_index: 0, advice_zh: fill(4) },
          { paragraph_index: 1, advice_zh: fill(5) },
        ],
      });
      for (const [i, c] of (['content', 'organization', 'grammar', 'vocabulary'] as const).entries()) output.criteria[c].explanation_zh = fill(6 + i);
      const r = scoreEssayAnalytic('primary', ctx, output, new OutputFilter());
      expect(r.errors).toHaveLength(30);
      expect(visibleEnglish(r).zh).toBeLessThanOrEqual(CUSTOM_OUTPUT_LIMITS.zhEnglishWordsTotalMax);
      // 前面的欄位保留、後面的清空：評語還在，最後一則錯誤的說明清掉了。
      expect(r.result.comment_zh).toContain('model1000');
      expect(r.errors.at(-1)!.explanation_zh).toBe('');
      expect(r.output_limits?.zh_total_cleared).toBeGreaterThan(0);
      // 每則錯誤說明的英文上限是 20：21 個單詞清空。
      const one = scoreEssayAnalytic(
        'primary',
        ctx,
        essayAnalyticOutput(undefined, { errors: [{ ...errors[0]!, explanation_zh: `說明：${model(CUSTOM_OUTPUT_LIMITS.errorExplanationEnglishWordsMax + 1)}` }] }),
        new OutputFilter(),
      );
      expect(one.errors[0]!.explanation_zh).toBe('');
    });

    it('正常的批改（每個欄位引用幾個英文字）不受合計上限影響', () => {
      const r = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { comment_zh: '「feel lonely」用得好。', top_improvements: ['把 "raising a child" 換成 "bringing up a child"', '多用轉承詞', '注意冠詞 the'] }), new OutputFilter());
      expect(r.output_limits).toMatchObject({ zh_fields_cleared: 0, zh_total_cleared: 0, errors_dropped_duplicate: 0 });
      expect(r.top_improvements).toHaveLength(3);
    });

    it('填充作文配上內容完全不同、長度在上限內的參考改寫：too_different 丟掉；輕度修改保留', () => {
      const filler = Array.from({ length: 120 }, (_, i) => `filler${i % 7}`).join(' ');
      const fctx = { ...ctx, text: filler, wordCount: countEnglishWords(filler), paragraphs: 1 };
      const cap = Math.ceil(fctx.wordCount * CUSTOM_OUTPUT_LIMITS.rewriteWordsRatio) + CUSTOM_OUTPUT_LIMITS.rewriteExtraWords;
      const r = scoreEssayAnalytic('primary', fctx, essayAnalyticOutput(undefined, { errors: [], rewrite: model(cap) }), new OutputFilter());
      expect(r.rewrite).toBeNull();
      expect(r.rewrite_omitted).toBe('too_different');
      expect(r.output_limits?.rewrite_dropped).toBe('too_different');
      // 改了十幾個字、加幾句的修改照常保留。
      const light = STUDENT_ESSAY.replace('feel lonely after work', 'often feel lonely after work').replace('a lot of money', 'much money').replace(/pictures/g, 'photos');
      const kept = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { rewrite: `${light} In short, pets are good friends.` }), new OutputFilter());
      expect(kept.rewrite).not.toBeNull();
      expect(kept).not.toHaveProperty('rewrite_omitted');
    });

    it('建議的合計上限不隨作文長度一直放大：600 個單詞的作文，建議合計仍 ≤ suggestionsTotalMaxWords', () => {
      const long = Array.from({ length: 60 }, (_, i) => `Sentence number word${i} is here for the long essay test.`).join(' ');
      const lctx = { ...ctx, text: long, wordCount: countEnglishWords(long), paragraphs: 1 };
      const errors = Array.from({ length: 30 }, (_, i) => ({ paragraph_index: 0, category: 'grammar' as const, excerpt: `word${i}`, explanation_zh: '說明', suggestion: model(20, i * 20) }));
      const r = scoreEssayAnalytic('primary', lctx, essayAnalyticOutput(undefined, { errors }), new OutputFilter());
      expect(lctx.wordCount + CUSTOM_OUTPUT_LIMITS.suggestionsTotalExtraWords).toBeGreaterThan(CUSTOM_OUTPUT_LIMITS.suggestionsTotalMaxWords);
      expect(visibleEnglish(r).suggestions).toBeLessThanOrEqual(CUSTOM_OUTPUT_LIMITS.suggestionsTotalMaxWords);
    });

    it('第二、三位的簡短評語：英文 21 個單詞清空、20 個保留', () => {
      const max = CUSTOM_OUTPUT_LIMITS.holisticCommentEnglishWordsMax;
      expect(scoreEssayHolistic('second', ctx, { ...essayHolisticOutput(), comment_zh: `評語：${model(max + 1)}` }, new OutputFilter()).result.comment_zh).toBe('');
      expect(scoreEssayHolistic('second', ctx, { ...essayHolisticOutput(), comment_zh: `評語：${model(max)}` }, new OutputFilter()).result.comment_zh).toContain('評語');
    });

    it('combineGradingRows：too_different 也帶到結果', () => {
      const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(), new OutputFilter());
      const b = scoreEssayHolistic('second', ctx, essayHolisticOutput(), new OutputFilter());
      const row = (role: 'primary' | 'second', rec: typeof a, feedback: Record<string, unknown>) => ({
        role,
        judgments_json: JSON.stringify({ v: 1, kind: 'essay', result: rec.result, errors: rec.errors }),
        deductions_json: JSON.stringify(rec.deductions),
        feedback_json: JSON.stringify(feedback),
      });
      expect(combineGradingRows('essay', [row('primary', a, { rewrite: null, rewrite_omitted: 'too_different' }), row('second', b, {})], { wordCount: words, paragraphs: 2 })).toMatchObject({
        rewrite_omitted: 'too_different',
      });
    });
  });

  describe('全形、數學粗體、形近字母寫的英文也算進上限（模型被誘導改用這些字母時，上限不能算成 0 個單詞）', () => {
    const plain = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => `essay${String.fromCharCode(97 + ((i + offset) % 26))}`).join(' ');
    /** ASCII → 全形（字母、數字、標點），空白換成全形空白。 */
    const fullwidth = (s: string) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');
    /** 小寫字母 → 數學粗體（𝐚 U+1D41A 起）。 */
    const mathBold = (s: string) => s.replace(/[a-z]/g, (c) => String.fromCodePoint(0x1d41a + c.charCodeAt(0) - 97));
    /** 部分拉丁字母換成長得一樣的西里爾字母（а е о р с у х）。 */
    const cyrillic = (s: string) => s.replace(/[aeopcyx]/g, (c) => ({ a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', y: 'у', x: 'х' })[c]!);

    it('outputEnglishWords：ASCII 英文和 customPromptEnglishWords 相同；全形、數學粗體、西里爾形近字母都算得到', () => {
      for (const s of ['', '中文說明，沒有英文。', "It's a good idea, but don't forget the 2nd point.", '把 "raising a child" 換成 "bringing up a child"', 'COVID-19 和 e-mail']) {
        expect(outputEnglishWords(s), s).toBe(customPromptEnglishWords(s));
      }
      const sentence = 'my hometown is a quiet place by the sea';
      expect(customPromptEnglishWords(fullwidth(sentence))).toBe(0);
      expect(customPromptEnglishWords(mathBold(sentence))).toBe(0);
      for (const s of [fullwidth(sentence), mathBold(sentence), cyrillic(sentence)]) expect(outputEnglishWords(s), s).toBe(9);
    });

    it('全形的評語、數學粗體的四項說明、西里爾字母的優先改進、全形的建議：超過上限一樣清空並計數', () => {
      const output = essayAnalyticOutput(undefined, {
        comment_zh: `整體不錯：${fullwidth(plain(41))}`,
        top_improvements: ['加例子', cyrillic(plain(50)), '注意冠詞'],
        errors: [{ paragraph_index: 0, category: 'other' as const, excerpt: chunks[0]!, explanation_zh: '說明', suggestion: fullwidth(plain(120)) }],
      });
      output.criteria.content.explanation_zh = `說明：${mathBold(plain(41))}`;
      const r = scoreEssayAnalytic('primary', ctx, output, new OutputFilter());
      expect(r.result.comment_zh).toBe('');
      expect(r.criteria_explanations?.content).toBe('');
      expect(r.top_improvements).toEqual(['加例子', '注意冠詞']);
      expect(r.errors[0]!.suggestion).toBe('');
      expect(r.output_limits).toMatchObject({ zh_fields_cleared: 3, suggestions_cleared: 1 });
      const h = scoreEssayHolistic('second', ctx, { ...essayHolisticOutput(), comment_zh: fullwidth(plain(CUSTOM_OUTPUT_LIMITS.holisticCommentEnglishWordsMax + 1)) }, new OutputFilter());
      expect(h.result.comment_zh).toBe('');
    });

    it('拆進很多欄位（每欄在上限內）的全形英文：中文說明的合計上限照樣算得到', () => {
      const distinct = [...new Set(STUDENT_ESSAY.split(/[^A-Za-z]+/).filter((w) => w.length > 3))].slice(0, 30);
      const errors = distinct.map((excerpt, i) => ({ paragraph_index: 0, category: 'grammar' as const, excerpt, explanation_zh: `說明：${fullwidth(plain(19, i))}`, suggestion: '' }));
      const r = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { errors }), new OutputFilter());
      const total = r.errors.reduce((a, e) => a + outputEnglishWords(e.explanation_zh), 0);
      expect(total).toBeLessThanOrEqual(CUSTOM_OUTPUT_LIMITS.zhEnglishWordsTotalMax);
      expect(r.output_limits?.zh_total_cleared).toBeGreaterThan(0);
    });
  });

  it('_zh 欄位裡的「大學入學考試中心」「大考中心」「CEEC」換成「官方」並計數（S17）', () => {
    const output = essayAnalyticOutput(undefined, { comment_zh: '這篇符合大考中心的要求，也符合 CEEC 的格式。' });
    output.criteria.content.explanation_zh = '大學入學考試中心的題目要求兩段。';
    const r = scoreEssayAnalytic('primary', ctx, output, new OutputFilter());
    expect(r.result.comment_zh).toBe('這篇符合官方的要求，也符合 官方 的格式。');
    expect(r.criteria_explanations?.content).toBe('官方的題目要求兩段。');
    expect(r.output_limits?.exam_board_replaced).toBe(3);
    const h = scoreEssayHolistic('third', ctx, { ...essayHolisticOutput(), comment_zh: '依大考中心標準' }, new OutputFilter());
    expect(h.result.comment_zh).toBe('依官方標準');
  });

  it('combineEssay／combineGradingRows：第一位的 rewrite_omitted 帶到結果；沒有時結果不含這個欄位（題庫題的回應逐字不變）', () => {
    const a = scoreEssayAnalytic('primary', ctx, essayAnalyticOutput(undefined, { rewrite: englishWords(rewriteCap + 5) }), new OutputFilter());
    const b = scoreEssayHolistic('second', ctx, essayHolisticOutput(), new OutputFilter());
    expect(combineEssay([{ role: 'primary', ...a }, { role: 'second', ...b }], { wordCount: words, paragraphs: 2 }).rewrite_omitted).toBe('too_long');
    const plain = scoreEssayAnalytic('primary', base, essayAnalyticOutput(), new OutputFilter());
    expect(combineEssay([{ role: 'primary', ...plain }, { role: 'second', ...b }], { wordCount: words, paragraphs: 2 })).not.toHaveProperty('rewrite_omitted');
    const row = (role: 'primary' | 'second', rec: typeof a, feedback: Record<string, unknown>) => ({
      role,
      judgments_json: JSON.stringify({ v: 1, kind: 'essay', result: rec.result, errors: rec.errors }),
      deductions_json: JSON.stringify(rec.deductions),
      feedback_json: JSON.stringify(feedback),
    });
    const withOmitted = combineGradingRows('essay', [row('primary', a, { rewrite: null, rewrite_omitted: 'too_long' }), row('second', b, {})], { wordCount: words, paragraphs: 2 });
    expect(withOmitted).toMatchObject({ kind: 'essay', rewrite: null, rewrite_omitted: 'too_long' });
    const without = combineGradingRows('essay', [row('primary', plain, { rewrite: null }), row('second', b, {})], { wordCount: words, paragraphs: 2 });
    expect(without).not.toHaveProperty('rewrite_omitted');
  });
});
