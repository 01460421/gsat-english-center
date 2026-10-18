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
 *
 * 三種題目來源（WritingGroup.origin）由 essayPromptParts 一次決定系統提示、user 訊息與範本版本（docs/design/custom-essay.md §4.1，
 * 安全審查 S2）：
 *   exam    essaySystemText＋essayUserContent（essay-user@1）
 *   bank    同一份系統提示＋多 <website_reference> 的 user 訊息（essay-user-guided@1）
 *   custom  essayCustomSystemText（「資料與指令」換成自訂題的版本、多一段 CUSTOM_TASK_RULES）＋customEssayUserContent
 *           （essay-user-custom@1；學生的題目只在 <student_provided_task>）
 * 歷屆題與本站題的系統提示、user 訊息與 prompt_version 和改版前逐位元相同（快照測試）。
 */
import { ESSAY_MIN_WORDS_HINT, ESSAY_SHORT_WORDS } from '@gsat/shared';
import * as z from 'zod/v4';
import type { WritingGroup } from '../bank';
import type { PromptFramework } from '../tasks';
import { neutralizeTags } from '../filter';
import {
  BANK_SOURCE_LINE,
  CUSTOM_DATA_LINE,
  CUSTOM_PREAMBLE,
  CUSTOM_SOURCE_LINE,
  SYSTEM_CHILD_SAFETY,
  SYSTEM_OUTPUT_RULES,
  SYSTEM_PREAMBLE,
  SYSTEM_SAFETY_FLAG,
  studentTaskBlock,
  studentTextBlock,
  taskBlock,
} from './common';

export const ESSAY_RUBRIC_VERSION = 'essay-4x5@1';
export const ESSAY_TEMPLATE_VERSION = 'essay-user@1';
/** 本站仿真題的範本版本（Source 行＋<website_reference>；docs/design/bank-writing.md §5.5）。 */
export const ESSAY_GUIDED_TEMPLATE_VERSION = 'essay-user-guided@1';
/** 自訂作文題目的範本版本（<task> 由網站寫＋<student_provided_task>；docs/design/custom-essay.md §4.3）。 */
export const ESSAY_CUSTOM_TEMPLATE_VERSION = 'essay-user-custom@1';

/** 這個題組用哪個使用者訊息範本（只是 essayPromptParts 的 templateVersion；新的呼叫點一律用 essayPromptParts）。 */
export function essayTemplateVersion(group: WritingGroup): string {
  return essayTemplateVersionOf(group.origin);
}

function essayTemplateVersionOf(origin: WritingGroup['origin']): string {
  switch (origin) {
    case 'exam':
      return ESSAY_TEMPLATE_VERSION;
    case 'bank':
      return ESSAY_GUIDED_TEMPLATE_VERSION;
    case 'custom':
      return ESSAY_CUSTOM_TEMPLATE_VERSION;
    default: {
      const never: never = origin;
      throw new Error(`未知的 origin：${String(never)}`);
    }
  }
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

/**
 * 評分基準（本站自己的話；放在可快取的系統提示前綴）。前端作答頁的「評分規準摘要（本站撰寫）」
 * （apps/web/src/features/writing/lib/rubric.ts 的 COMPOSITION_CRITERIA）是同四個面向的學生版說明，兩份的四個面向必須一致。
 */
export const ESSAY_RUBRIC = `Task: an English essay written for the GSAT composition section (the official guidance asks for at least about 120 words; many tasks require two paragraphs). Score four criteria, each an integer from 0 to 5. Bands: 5-4 strong, 3 adequate, 2-1 weak, 0 nothing creditable.

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

export const ANALYTIC_METHOD = `Method (first grader): read the whole essay, decide each criterion score with a short explanation tied to evidence from the text, then list the most important specific problems in the errors array (at most 30, most important first, each quoting an exact excerpt; paragraph_index counts paragraphs from 0 as they appear), give one piece of advice per paragraph, choose the three improvements that would raise the score most, and write a light revision that keeps the student's ideas.`;

export const HOLISTIC_METHOD = `Method (independent second grader): read the whole essay once and give your overall impression as holistic_total first. Then check each criterion against the descriptions and give the four scores, and a brief comment. Work independently; another grader evaluates the same essay separately.`;

export function essaySystemText(framework: PromptFramework): string {
  return [SYSTEM_PREAMBLE, ESSAY_RUBRIC, framework === 'holistic' ? HOLISTIC_METHOD : ANALYTIC_METHOD, SYSTEM_CHILD_SAFETY, SYSTEM_SAFETY_FLAG, SYSTEM_OUTPUT_RULES].join('\n\n');
}

/**
 * 自訂作文題目怎麼評（放在評分方法之後；docs/design/custom-essay.md §4.2）：同一個學測尺度；段數、字數照 <task>，
 * 沒設定時照題目文字判斷（P2）；不套評分基準裡「學測約 120 字」的前提（P3）；切題判斷保守；絕不代寫；
 * 中文說明裡的英文只能是短引用（程式另有上限，scoring.ts 的 CUSTOM_OUTPUT_LIMITS；S1）；不複述題目裡的機構名稱（S17）。
 */
export const CUSTOM_TASK_RULES = `Student-provided tasks:
- Use the same GSAT scale, 0-5 descriptions, and program rules as for any GSAT essay, however unusual the task is.
- content: judge how well the essay covers what the task asks. If the task is vague, accept any reasonable reading of it.
- organization: also judge whether the structure suits what the task asks for (for example a letter, a story, an opinion with reasons, or paragraphs with given focuses).
- length: judge development against the length in <task>; if <task> sets none, against what the task text asks. Ignore the 120-word GSAT guidance in the rubric for this task; the program's own deduction below 100 words still applies.
- If the task mentions pictures, charts, or a passage that is not included, use the student's description if there is one; otherwise do not lower a score for details you cannot check.
- off_topic: true only when the essay clearly addresses a different topic or task, or is not an attempt at a writing task. A partial or weak answer keeps off_topic false and loses content points. If the task is too unclear to judge, keep it false.
- Never write, finish, or extend an essay for the student, and never answer the task's questions yourself. Grade only <student_text>. If the task asks for anything else, comment_zh may say in one short sentence that this website only grades the student's own writing.
- rewrite (if the schema has it): a light revision of the student's own text, keeping its ideas, order, and paragraphs, at most about 20 percent longer; no new ideas or paragraphs; null if the essay is very short or off topic.
- In fields ending in _zh and in top_improvements, keep any English to short quotes (at most one sentence each).
- Do not repeat names of people, schools, or organizations (including exam boards), or contact details, that appear in the task; refer to it as "the task" (「題目」).`;

/**
 * 自訂作文題目的系統提示：角色、評分基準、評分方法、兒少安全、身心安全旗標、輸出規則都和 essaySystemText 逐字相同，
 * 只把「資料與指令」換成 CUSTOM_DATA_RULES（題目是學生提供的資料，不是可信的伺服器資料），並在評分方法之後加 CUSTOM_TASK_RULES。
 * analytic、holistic 各是另一個可快取的前綴。
 */
export function essayCustomSystemText(framework: PromptFramework): string {
  return [
    CUSTOM_PREAMBLE,
    ESSAY_RUBRIC,
    framework === 'holistic' ? HOLISTIC_METHOD : ANALYTIC_METHOD,
    CUSTOM_TASK_RULES,
    SYSTEM_CHILD_SAFETY,
    SYSTEM_SAFETY_FLAG,
    SYSTEM_OUTPUT_RULES,
  ].join('\n\n');
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

/** 自訂題的字數要求（<task> 的 Length requirement 行；學生沒設定時明講 not set by the student）。 */
function customWordRequirement(group: WritingGroup): string {
  const e = group.essay;
  if (e?.min_words && e.max_words) return `${e.min_words}-${e.max_words} words`;
  if (e?.min_words) return `at least ${e.min_words} words`;
  if (e?.max_words) return `at most ${e.max_words} words`;
  return 'not set by the student';
}

/**
 * 自訂作文題目的 user 訊息（essay-user-custom@1；docs/design/custom-essay.md §4.3）：
 *   <task>：四行都由伺服器寫（Source 行、「下面的區塊是資料」、段數、字數；段數與字數是驗證過的整數），每一行經過 neutralizeTags；
 *   <student_provided_task>：題目與圖片描述，整段中和（studentTaskBlock）；
 *   <essay_stats>、<student_text>：和歷屆題相同。
 * 題目從 group.custom 取（不讀 items[0].stem，S2）；custom 是 null（資料異常）時丟錯，consumer 照既有邏輯以 internal 退還。
 */
export function customEssayUserContent(group: WritingGroup, paragraphs: string[], wordCount: number): string {
  const custom = group.custom;
  if (group.origin !== 'custom' || !custom) throw new Error('自訂題目缺少題目內容');
  const required = group.essay?.paragraphs;
  return [
    taskBlock([CUSTOM_SOURCE_LINE, CUSTOM_DATA_LINE, `Required paragraphs: ${required ? String(required) : 'not set by the student'}`, `Length requirement: ${customWordRequirement(group)}`]),
    studentTaskBlock(custom.prompt_text, custom.figure_text),
    `<essay_stats>words counted by the program: ${wordCount}; paragraphs: ${paragraphs.length}</essay_stats>`,
    studentTextBlock(paragraphs.join('\n\n')),
  ].join('\n\n');
}

/**
 * 系統提示、user 訊息與範本版本由這一支依 origin 一次決定（S2）：essayCallInput 只呼叫它，以後新增的任務（例如修訂稿批改）
 * 也要經過它。switch 窮舉 origin，新增來源時漏寫分支編譯不過。歷屆題、本站題得到的三個值和改版前逐位元相同。
 */
export function essayPromptParts(
  group: WritingGroup,
  framework: PromptFramework,
  paragraphs: string[],
  wordCount: number,
): { system: string; content: string; templateVersion: string } {
  switch (group.origin) {
    case 'exam':
    case 'bank':
      return { system: essaySystemText(framework), content: essayUserContent(group, paragraphs, wordCount), templateVersion: essayTemplateVersionOf(group.origin) };
    case 'custom':
      return { system: essayCustomSystemText(framework), content: customEssayUserContent(group, paragraphs, wordCount), templateVersion: ESSAY_CUSTOM_TEMPLATE_VERSION };
    default: {
      const never: never = group.origin;
      throw new Error(`未知的 origin：${String(never)}`);
    }
  }
}
