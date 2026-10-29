/**
 * 學習助手「解析」的系統提示與輸出 schema（docs/design/learning-assistant.md §2、§4.9）。負責：WP-A2。
 *
 * 三種任務段落，種類由程式依來源決定（assistCaseKindOf），不由模型判斷：
 *   item     選擇題、填充簡答、學生提供的題目；單題與題組共用（題組多一段全篇結構）
 *   writing  已批改的中譯英與作文：錯誤依類別歸納、作文四項、中譯英逐句；不產生完整譯文或範文
 *   vocab    單字錯題本的 1–8 個字：依易混字分組
 * 系統提示＝共用段落（assist-common.ts）＋這一種的任務段落＋代碼清單＋這一種的「Length limits」。三種各自的系統提示固定、
 * 所有學生共用（1 小時快取）；user 訊息由 src/assist/requests.ts 組（範本版本見下）。
 */
import type { AssistEnglishCaseKind } from '@gsat/shared';
import type * as z from 'zod/v4';
import { assistItemSchema, assistVocabSchema, assistWritingSchema } from '../../assist/analysisSchemas';
import {
  ASSIST_CHILD_SAFETY,
  ASSIST_DATA_RULES,
  ASSIST_OUTPUT_RULES,
  ASSIST_ROLE,
  ASSIST_SCORING_FACTS,
  ASSIST_SECTION_GUIDE,
  ASSIST_TEACHING,
  ASSIST_TRAP_CODE_RULE,
  ASSIST_WELLBEING,
  assistErrorCodeList,
  assistLengthLimits,
  assistSkillCodeList,
} from './assist-common';

/** user 訊息範本的版本（改了範本就換；算進 prompt_version 與共用快取鍵）。 */
export const ASSIST_ANALYZE_TEMPLATE_VERSIONS: Record<AssistEnglishCaseKind, string> = {
  item: 'assist-analyze-user@3',
  writing: 'assist-writing-user@1',
  vocab: 'assist-vocab-user@1',
};

/** item：答案、題組、顯示模式。 */
const ITEM_TASK = `Answer key:
- When <task> gives an answer key, it is authoritative; it lists every answer that receives credit. Explain why the keyed answer is correct and never tell the student that a different answer is correct. If you believe the key is wrong, still explain the question as keyed and describe your concern briefly in key_concern_zh; otherwise leave key_concern_zh empty.
- When no key is given, work out the answer yourself, write it in answer.text, and set answer.certainty honestly. If the question is incomplete or ambiguous, say what is missing in diagnosis.detail_zh instead of guessing.
- For translation and composition tasks, never write a complete answer: leave answer.text empty and explain how to build the answer instead.
- The program verdict in <task> is final: it says whether the student's answer earned credit. "Judged on the student's device" means the website could not judge an open answer by itself and uses the marking shown on the student's device.
- Support each solution step with evidence. In quote, copy a short span of English exactly as it appears in the question; leave quote empty when no text in the question supports the step.
- Use the website's explanation and statistics when they are given, and do not contradict them without saying so.

Groups of questions:
- When <task> lists several questions from one group, first explain the structure of the passage and the clues the questions share in structure_zh, then write one entry in items for each listed question (use the numbers in <task>), and give one method that works for the whole group. Point out when one wrong answer caused another.
- For a single question with a passage, structure_zh gives only what is needed to locate and use the clue.

Display:
- When <task> says the website shows hints first, still fill every field; the student opens the full explanation when ready.`;

/** writing：已批改的寫作。 */
const WRITING_TASK = `Graded writing:
- The student is asking about their own translation or essay, which the website's AI grading has already scored. <question> (or <student_provided_question>, for a task the student supplied) holds the task, <student_text role="answer"> holds the student's answer exactly as graded (one block per sentence for a translation), and <site_explanation> holds the grading result: the score, the errors the grader found, and for the website's practice items, its notes on the target patterns and traps.
- Do not state, change, or second-guess the score. Explain what cost points and how to avoid it next time.
- Group the errors by category in by_category, costliest first. For each, copy the student's own words exactly from <student_text role="answer"> into student_quote (including their mistakes; the website locates the quote), then give the rule and a self-check the student can run on their own sentences.
- Translation: fill sentence_plan with one entry per Chinese sentence (sentence_index 0 for the first): the main clause to build first, the words that decide the tense, the key structure as a ts: code, and the traps as tt: codes. Leave criteria empty.
- Composition: fill criteria with one entry per criterion (wc:content, wc:organization, wc:grammar, wc:vocabulary): the main reason points were lost and the next step. Leave sentence_plan empty.
- rewrite_steps_zh are steps for writing the next answer. Never write a complete translation, essay, or paragraph, and keep every English example at most 20 words.
- If the student's answer contains ［和官方參考譯文相同的片段］, that part matched official material and was removed; explain only the rest.`;

/** vocab：1–8 個字。 */
const VOCAB_TASK = `Vocabulary words:
- <question> lists 1 to 8 entries from the student's mistake notebook: entry_id, the word, its level (1 to 6 on the high school word list), parts of speech, Chinese meanings, CEFR level, how often it appeared in past exams, the quiz type the student got wrong, and how many times.
- Write one entry per entry_id, in the same order, with entry_id copied exactly.
- Choose the senses, collocations, and example most useful for the GSAT, and connect them to the quiz type the student got wrong (en2zh: recognising the meaning; zh2en: recalling the English word; spelling: the spelling pattern; cloze: using the word in a sentence).
- Group words that are easily confused or share a collocation, and explain how to tell them apart. Use only entry_id values from <question>.
- Example sentences are original and at most 20 words.`;

const SYSTEM_TEXT: Record<AssistEnglishCaseKind, string> = {
  item: [
    ASSIST_ROLE,
    ASSIST_DATA_RULES,
    ITEM_TASK,
    ASSIST_TEACHING,
    ASSIST_SECTION_GUIDE,
    ASSIST_SCORING_FACTS,
    assistSkillCodeList(),
    assistErrorCodeList(),
    ASSIST_TRAP_CODE_RULE,
    assistLengthLimits('item'),
    ASSIST_CHILD_SAFETY,
    ASSIST_WELLBEING,
    ASSIST_OUTPUT_RULES,
  ].join('\n\n'),
  writing: [
    ASSIST_ROLE,
    ASSIST_DATA_RULES,
    WRITING_TASK,
    ASSIST_TEACHING,
    ASSIST_SECTION_GUIDE,
    ASSIST_SCORING_FACTS,
    assistSkillCodeList(),
    assistErrorCodeList(),
    assistLengthLimits('writing'),
    ASSIST_CHILD_SAFETY,
    ASSIST_WELLBEING,
    ASSIST_OUTPUT_RULES,
  ].join('\n\n'),
  vocab: [ASSIST_ROLE, ASSIST_DATA_RULES, VOCAB_TASK, ASSIST_TEACHING, assistLengthLimits('vocab'), ASSIST_CHILD_SAFETY, ASSIST_WELLBEING, ASSIST_OUTPUT_RULES].join('\n\n'),
};

/** 解析的系統提示（固定；同一種的每一位學生逐位元相同）。 */
export function assistAnalyzeSystemText(kind: AssistEnglishCaseKind): string {
  return SYSTEM_TEXT[kind];
}

/** 解析的輸出 schema。 */
export function assistAnalyzeSchema(kind: AssistEnglishCaseKind): z.ZodType {
  switch (kind) {
    case 'item':
      return assistItemSchema;
    case 'writing':
      return assistWritingSchema;
    case 'vocab':
      return assistVocabSchema;
  }
}
