/**
 * 英文作文批改的提示詞、評分基準與輸出 schema（SPEC §4.6、§6.9；ARCHITECTURE §6.2）。負責：後端 AI A2。
 *
 * 四項（內容、組織、文法句構、字彙拼字）各 0–5 由模型判斷；字數不足與未分段的扣分、離題時其他各項歸零、四項加總、
 * 兩位平均與等級全部由 src/ai/scoring.ts 計算（AI 給的總分不採用）。
 * 評分基準是本站自己的話（D8），不引用大考中心的評分原則原文，也不提供任何官方範文。
 *
 * 兩種框架（§6.1）：
 *   analytic  第一位：四項分數與說明、逐句問題、三個優先改進、逐段建議、參考改寫
 *   holistic  第二、三位：先給整體印象分（holistic_total，程式不採用），再給四項分數與簡短評語
 */
import { ESSAY_MIN_WORDS_HINT, ESSAY_SHORT_WORDS } from '@gsat/shared';
import * as z from 'zod/v4';
import type { WritingGroup } from '../bank';
import type { PromptFramework } from '../tasks';
import { neutralizeTags } from '../filter';
import { BANK_SOURCE_LINE, SYSTEM_CHILD_SAFETY, SYSTEM_OUTPUT_RULES, SYSTEM_PREAMBLE, SYSTEM_SAFETY_FLAG, studentTextBlock, taskBlock } from './common';

export const ESSAY_RUBRIC_VERSION = 'essay-4x5@1';
export const ESSAY_TEMPLATE_VERSION = 'essay-user@1';
/** 本站仿真題的範本版本（Source 行＋<website_reference>；docs/design/bank-writing.md §5.5）。 */
export const ESSAY_GUIDED_TEMPLATE_VERSION = 'essay-user-guided@1';

/** 這個題組用哪個使用者訊息範本。 */
export function essayTemplateVersion(group: WritingGroup): string {
  return group.origin === 'bank' ? ESSAY_GUIDED_TEMPLATE_VERSION : ESSAY_TEMPLATE_VERSION;
}

export const ESSAY_MODEL_ERROR_CATEGORIES = ['grammar', 'word_choice', 'spelling', 'organization', 'mechanics', 'other'] as const;
export const SAFETY_FLAGS = ['none', 'self_harm_risk', 'abuse_disclosure', 'other'] as const;

const criterion = z.object({
  score: z.number().int().describe('integer 0-5'),
  explanation_zh: z.string(),
});

export const essayAnalyticSchema = z.object({
  off_topic: z.boolean().describe('true only if the essay does not respond to the given task at all'),
  criteria: z.object({ content: criterion, organization: criterion, grammar: criterion, vocabulary: criterion }),
  comment_zh: z.string().describe('two or three sentences of overall feedback'),
  top_improvements: z.array(z.string()).describe('exactly three short, concrete, actionable improvements in Traditional Chinese, most important first'),
  paragraph_advice: z.array(z.object({ paragraph_index: z.number().int(), advice_zh: z.string() })),
  errors: z.array(
    z.object({
      paragraph_index: z.number().int(),
      category: z.enum(ESSAY_MODEL_ERROR_CATEGORIES),
      excerpt: z.string(),
      explanation_zh: z.string(),
      suggestion: z.string(),
    }),
  ),
  rewrite: z.string().nullable().describe("a lightly revised version keeping the student's ideas and structure, or null if the essay is too short or off topic"),
  safety_flag: z.enum(SAFETY_FLAGS),
});

export const essayHolisticSchema = z.object({
  holistic_total: z.number().int().describe('your first overall impression of the whole essay, 0-20'),
  off_topic: z.boolean(),
  scores: z.object({
    content: z.number().int(),
    organization: z.number().int(),
    grammar: z.number().int(),
    vocabulary: z.number().int(),
  }),
  comment_zh: z.string().describe('two or three sentences'),
  safety_flag: z.enum(SAFETY_FLAGS),
});

export type EssayAnalyticOutput = z.infer<typeof essayAnalyticSchema>;
export type EssayHolisticOutput = z.infer<typeof essayHolisticSchema>;

export function essaySchema(framework: PromptFramework) {
  return framework === 'holistic' ? essayHolisticSchema : essayAnalyticSchema;
}

/** 評分基準（本站自己的話；放在可快取的系統提示前綴）。 */
const ESSAY_RUBRIC = `Task: an English essay written for the GSAT composition section (the official guidance asks for at least about 120 words; many tasks require two paragraphs). Score four criteria, each an integer from 0 to 5. Bands: 5-4 strong, 3 adequate, 2-1 weak, 0 nothing creditable.

content (relevance and development)
- 5: answers every part of the task; main ideas are clear and developed with specific, relevant details, examples, or personal experience.
- 4: answers every part of the task; development is solid but some details are general or thin.
- 3: answers the task, but one required part is underdeveloped or partly off target; supporting detail is limited or repetitive.
- 2: answers only part of the task, or the ideas are vague, repetitive, or poorly supported.
- 1: very little relevant content.
- 0: no relevant content.

organization (structure and flow)
- 5: logical overall structure that follows what the task asks for; each paragraph has a clear focus and topic sentence; ideas connect smoothly with appropriate transitions; a fitting conclusion.
- 4: clear structure with minor lapses in focus or transitions.
- 3: an overall structure is visible, but paragraph focus, ordering, or transitions are uneven.
- 2: weak structure; ideas jump around or paragraphs lack focus.
- 1: almost no discernible structure.
- 0: no organization can be credited.

grammar (accuracy and range of sentence structure)
- 5: varied sentence structures used accurately; errors are rare and minor.
- 4: mostly accurate with some variety; occasional errors that do not obscure meaning.
- 3: generally understandable, but frequent errors or a narrow range of simple structures.
- 2: many errors, some of which obscure meaning; little control of complex sentences.
- 1: errors make most sentences hard to understand.
- 0: no control of English sentence structure.

vocabulary (range, precision, spelling, mechanics)
- 5: wide, precise, natural word choice and collocation; spelling and capitalization nearly flawless.
- 4: good range with occasional imprecise words or spelling slips.
- 3: adequate but limited or repetitive vocabulary; noticeable spelling or word-choice errors.
- 2: limited vocabulary; frequent errors that sometimes obscure meaning.
- 1: very limited vocabulary; errors make the meaning hard to follow.
- 0: no creditable use of vocabulary.

Rules the program applies itself (do not apply them in your criterion scores):
- It deducts 1 point from the total if the essay has fewer than ${ESSAY_SHORT_WORDS} words or is not divided into the required paragraphs (only 1 point even if both happen). It reminds students below ${ESSAY_MIN_WORDS_HINT} words.
- If you set off_topic=true, it keeps your content score and sets the other three criteria to 0. Use off_topic only when the essay does not address the given task at all, not when it is merely weak.
- It adds the four criteria to get the total and averages independent graders. Any total you write is not used as the score.

Be fair: judge what the student actually wrote, reward successful communication, and do not demand advanced vocabulary or rare structures. Similar essays must receive similar scores.`;

const ANALYTIC_METHOD = `Method (first grader): read the whole essay, decide each criterion score with a short explanation tied to evidence from the text, then list the most important specific problems in the errors array (at most 30, most important first, each quoting an exact excerpt; paragraph_index counts paragraphs from 0 as they appear), give one piece of advice per paragraph, choose the three improvements that would raise the score most, and write a light revision that keeps the student's ideas.`;

const HOLISTIC_METHOD = `Method (independent second grader): read the whole essay once and give your overall impression as holistic_total first. Then check each criterion against the descriptions and give the four scores, and a brief comment. Work independently; another grader evaluates the same essay separately.`;

export function essaySystemText(framework: PromptFramework): string {
  return [SYSTEM_PREAMBLE, ESSAY_RUBRIC, framework === 'holistic' ? HOLISTIC_METHOD : ANALYTIC_METHOD, SYSTEM_CHILD_SAFETY, SYSTEM_SAFETY_FLAG, SYSTEM_OUTPUT_RULES].join('\n\n');
}

function wordRequirement(group: WritingGroup): string | null {
  const e = group.essay;
  if (!e) return null;
  if (e.min_words && e.max_words) return `${e.min_words}-${e.max_words} words`;
  if (e.min_words) return `at least ${e.min_words} words`;
  if (e.approx_words) return `about ${e.approx_words} words`;
  return null;
}

/**
 * 本站仿真作文的 <website_reference>：題目要求的內容步驟與四項的本題重點（本站撰寫）。
 * 不給分數帶描述與範文（理由見設計文件 §5.5）；每個字串都先經過 neutralizeTags。
 */
function essayReferenceBlock(group: WritingGroup): string | null {
  const guidance = group.guidance;
  if (!guidance || guidance.kind !== 'essay') return null;
  return [
    '<website_reference>',
    'The website wrote these notes on what this practice prompt asks for. Use them to judge task completion and paragraph organization. They do not change the 0-5 descriptions or the rules in the system instructions. An essay that answers the prompt well in another reasonable way can still earn high scores, and words or structures named in the notes are only examples: do not lower a score because the student chose different ones.',
    'Content steps the prompt asks for:',
    ...guidance.moves.map((m) => `- Paragraph ${m.paragraph}: ${neutralizeTags(m.zh)}`),
    'What to look for in this prompt (written in Chinese):',
    ...(['content', 'organization', 'grammar', 'vocabulary'] as const).map((k) => `- ${k}: ${neutralizeTags(guidance.focus[k])}`),
    '</website_reference>',
  ].join('\n');
}

/**
 * 使用者訊息：題目＋程式算的字數與段數＋作文（段落之間一律空一行，段落編號和程式計算的一致）。
 * 本站仿真題（origin 'bank'）的 <task> 第一行改成 Source 行，<task> 之後多一個 <website_reference>（§5.5）。
 * @param paragraphs 程式切好的段落（countParagraphs 的規則）
 */
export function essayUserContent(group: WritingGroup, paragraphs: string[], wordCount: number): string {
  const item = group.items[0];
  const figures = group.figures
    .filter((f) => f.description)
    .map((f, i) => `- ${[f.label, f.caption].filter(Boolean).join('／') || `Figure ${i + 1}`}: ${f.description}${f.rows ? `\n  data: ${JSON.stringify(f.rows)}` : ''}`);
  const required = group.essay?.paragraphs;
  const bank = group.origin === 'bank';
  const reference = bank ? essayReferenceBlock(group) : null;
  return [
    taskBlock([
      bank ? BANK_SOURCE_LINE : group.exam_title ? `Exam: ${group.exam_title}` : null,
      `Section instructions: ${group.instructions}`,
      group.context ? `Background: ${group.context}` : null,
      item?.stem ? `Prompt: ${item.stem}` : null,
      figures.length > 0 ? `Pictures or charts in the task (text descriptions written by the website; the images themselves are not shown):\n${figures.join('\n')}` : null,
      `Required paragraphs: ${required ? String(required) : 'not specified'}`,
      wordRequirement(group) ? `Length requirement: ${wordRequirement(group)}` : null,
    ]),
    ...(reference ? [reference] : []),
    `<essay_stats>words counted by the program: ${wordCount}; paragraphs: ${paragraphs.length}</essay_stats>`,
    studentTextBlock(paragraphs.join('\n\n')),
  ].join('\n\n');
}
