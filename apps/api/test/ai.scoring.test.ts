/**
 * 程式計分（src/ai/scoring.ts）：SPEC §4.6、§6.8、§6.9 的規則。模型只給判斷，分數全部由這裡算，
 * 寫錯就是學生看到錯的分數，所以每條規則都有案例。
 */
import { countEnglishWords, countParagraphs, essayBandOf } from '@gsat/shared';
import { describe, expect, it } from 'vitest';
import { OutputFilter } from '../src/ai/filter';
import type { TranslationModelOutput } from '../src/ai/prompts/translation';
import {
  assembleOcr,
  checkMechanics,
  combineEssay,
  combineTranslation,
  essayDeductions,
  essayRaterTotal,
  essayScoresProblem,
  locate,
  needsThirdRater,
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
