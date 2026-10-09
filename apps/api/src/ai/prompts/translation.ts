/**
 * 中譯英批改的提示詞、評分基準與輸出 schema（SPEC §4.6、§6.8；ARCHITECTURE §6.2）。負責：後端 AI A2。
 *
 * 分工：模型只負責「把每句切成 4 個語意單位、找出錯誤並分類、標出重複的錯誤、寫說明」；
 * 扣分（每錯 0.5、各部分扣完為止、同錯只扣一次）、句首大寫與句尾標點、總分全部由 src/ai/scoring.ts 計算。
 * 評分基準是本站自己的話（D8），不引用大考中心評分原則原文，也不提供任何官方參考譯文。
 *
 * 兩種框架（§6.1：第二位評分者換框架、互相獨立）：
 *   analytic  第一位：先逐部分找錯，最後寫整體說明（欄位順序：parts → corrected → explanation_zh）
 *   holistic  第二、三位：先寫整體判斷，再逐部分找錯（欄位順序：explanation_zh → parts → corrected）
 * 兩者解析後的形狀相同，程式用同一套計分。
 */
import * as z from 'zod/v4';
import type { WritingGroup } from '../bank';
import type { PromptFramework } from '../tasks';
import { SYSTEM_CHILD_SAFETY, SYSTEM_OUTPUT_RULES, SYSTEM_PREAMBLE, studentTextBlock, taskBlock } from './common';

export const TRANSLATION_RUBRIC_VERSION = 'translation-4part@1';
/** 使用者訊息範本的版本（改了 translationUserContent 的格式就遞增，會反映在 prompt_version）。 */
export const TRANSLATION_TEMPLATE_VERSION = 'translation-user@1';

/** 模型可以用的錯誤類別（capitalization、punctuation 由程式判定，不讓模型輸出）。 */
export const TRANSLATION_MODEL_CATEGORIES = ['spelling', 'grammar', 'word_choice', 'omission', 'meaning', 'other'] as const;

const partSchema = z.object({
  part: z.number().int().describe('1, 2, 3 or 4, in order'),
  source_zh: z.string().describe('the Chinese words of this meaning unit, copied from the source sentence'),
  student_excerpt: z.string().describe('the part of the student translation that corresponds to this unit, copied exactly; empty if nothing corresponds'),
  missing: z.boolean().describe('true only if the meaning of this whole unit is absent or completely lost'),
});

const errorSchema = z.object({
  sentence_index: z.number().int(),
  part: z.number().int().describe('which meaning unit (1-4) the error belongs to'),
  category: z.enum(TRANSLATION_MODEL_CATEGORIES),
  excerpt: z.string().describe('the exact erroneous words from the student text; empty for an omission'),
  explanation_zh: z.string(),
  suggestion: z.string().describe('the corrected English for this spot'),
  repeat_of: z.number().int().nullable().describe('index in this errors array of an earlier identical spelling or grammar mistake, otherwise null'),
});

const analyticSentence = z.object({
  sentence_index: z.number().int(),
  parts: z.array(partSchema),
  corrected: z.string().describe("the student's translation with only the necessary corrections, keeping their wording and meaning"),
  explanation_zh: z.string().describe('one to three sentences summarizing the main problems and strengths'),
});

const holisticSentence = z.object({
  sentence_index: z.number().int(),
  explanation_zh: z.string().describe('overall impression first: is the meaning conveyed faithfully and naturally?'),
  parts: z.array(partSchema),
  corrected: z.string(),
});

export const translationAnalyticSchema = z.object({ sentences: z.array(analyticSentence), errors: z.array(errorSchema) });
export const translationHolisticSchema = z.object({ sentences: z.array(holisticSentence), errors: z.array(errorSchema) });

export type TranslationModelOutput = z.infer<typeof translationAnalyticSchema>;

export function translationSchema(framework: PromptFramework) {
  return framework === 'holistic' ? translationHolisticSchema : translationAnalyticSchema;
}

/** 評分基準（本站自己的話；≥512 tokens，放在可快取的系統提示前綴）。 */
const TRANSLATION_RUBRIC = `Task: Chinese-to-English translation. Each Chinese sentence is worth 4 points. The website scores it with these rules, applied by its program to the judgments you return:
- The Chinese sentence is divided into 4 consecutive meaning units ("parts"), each worth 1 point. You decide the division. The 4 parts must cover the whole sentence in order and should be roughly balanced in meaning, for example: time or setting / subject and main verb / object or complement / remaining modifiers.
- Every error inside a part costs 0.5 point, and a part can never go below 0. A part whose meaning is entirely absent or lost scores 0; mark it with missing=true instead of listing many errors.
- The same spelling mistake (the same word misspelled the same way) or the same grammar mistake (the same rule broken with the same word or structure) is charged only once for the whole question, even if it appears again in the other sentence. List the repetition, but set repeat_of to the index of the first occurrence in the errors array.
- Capital letters at the start of a sentence and the punctuation at the end of a sentence are checked by the program. Do not report them.

What counts as an error (one entry per error, in the order they appear):
- spelling: a misspelled English word.
- grammar: tense, subject-verb agreement, articles, singular or plural, word form or part of speech, prepositions required by grammar, word order, sentence structure, run-on sentences or fragments.
- word_choice: a word or collocation that is wrong or clearly unnatural for the meaning, including wrong prepositions in fixed expressions.
- omission: meaning from the Chinese that the translation leaves out (excerpt is empty).
- meaning: the English says something different from the Chinese (mistranslation, added meaning, reversed logic).
- other: anything else that a careful teacher would deduct for.

Be fair and accurate:
- Accept every correct and natural translation. There is no single answer key; do not penalize a different but correct wording, word order, or sentence structure. Do not mark style preferences as errors.
- Most target vocabulary comes from levels 1-4 of the official high school word list, but any correct word is acceptable.
- Every error must point to a real problem in the student's English. Do not invent errors, and do not split one mistake into several entries.
- The corrected sentence should change as little as possible: keep the student's choices wherever they are acceptable.`;

const ANALYTIC_METHOD = `Method (first grader): for each sentence, divide the Chinese into 4 parts, match each part to the student's English, go through the parts one by one listing every error, then write the corrected sentence and a short overall explanation.`;

const HOLISTIC_METHOD = `Method (independent second grader): for each sentence, first read the whole translation and write your overall judgment of how faithfully and naturally it conveys the Chinese (explanation_zh), then divide the Chinese into 4 parts, match them to the student's English, and list every error part by part. Work independently; another grader evaluates the same answer separately.`;

export function translationSystemText(framework: PromptFramework): string {
  return [SYSTEM_PREAMBLE, TRANSLATION_RUBRIC, framework === 'holistic' ? HOLISTIC_METHOD : ANALYTIC_METHOD, SYSTEM_CHILD_SAFETY, SYSTEM_OUTPUT_RULES].join('\n\n');
}

/** 使用者訊息：題目（伺服器端）＋每句的中文與學生譯文（包在 <student_text>）。 */
export function translationUserContent(group: WritingGroup, sentences: string[]): string {
  const blocks = group.items.map((item, i) =>
    [`<sentence index="${i}">`, `<source_zh>${item.stem}</source_zh>`, studentTextBlock(sentences[i] ?? '', { sentence: i }), `</sentence>`].join('\n'),
  );
  return [
    taskBlock([
      group.exam_title ? `Exam: ${group.exam_title}` : null,
      `Section instructions: ${group.instructions}`,
      group.context ? `Context passage (the parts to translate are marked with 【】):\n${group.context}` : null,
    ]),
    ...blocks,
    `Return one entry in "sentences" for each sentence above (sentence_index ${group.items.map((_, i) => i).join(', ')}), each with exactly 4 parts numbered 1-4, and list all errors in "errors".`,
  ].join('\n\n');
}
