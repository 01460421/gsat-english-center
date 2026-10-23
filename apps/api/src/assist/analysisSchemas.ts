/**
 * 學習助手的模型輸出 schema（zod；docs/design/learning-assistant.md §2.1、§2.6–§2.8）：item（選擇題、填充簡答、學生提供的題目；
 * 單題與題組共用）、writing（已批改的中譯英與作文）、vocab（1–8 個字）、followup（追問一輪）。
 *
 * 規則（ARCHITECTURE §6.2 第 5、6 條；test/ai.rules.test.ts 掃描送出的 JSON schema）：
 *   - 結構化輸出要求每一欄都 required，「沒有」用空字串或空陣列。不用 nullable、不用聯集。
 *   - 欄位名稱不含 reasoning、thought、rationale 一類的字。
 *   - SDK 送出前會剝掉 maxLength、maxItems，所以字數與項數的上限寫進 .describe()（英文，同 ASSIST_FIELD_LIMITS 的寫法），
 *     zod 這裡只驗結構與列舉，不驗長度：超過上限由 output.ts 截斷，不因為多寫幾個字就整則退還重試（§4.11）。
 *   - 技能、錯因、陷阱代碼用字串（封閉清單在系統提示裡），不在清單的由程式丟掉；清單有一百多個代碼，放進 enum 會讓
 *     schema 變大，丟掉不合的代碼也不必重試。
 * 種類由程式依來源決定（assistCaseKindOf），不用 schema 層的聯集。
 */
import {
  ASSIST_KNOWLEDGE_KINDS,
  ASSIST_SAFETY_FLAGS,
  ASSIST_SECTIONS,
  assistFieldLimit,
  assistLimitText,
  type AssistOutputKind,
} from '@gsat/shared';
import * as z from 'zod/v4';

/** 某一欄的上限說明（＋補充說明）。沒有上限的欄位只回補充說明。 */
function lim(kind: AssistOutputKind, path: string, note?: string): string {
  const limit = assistFieldLimit(kind, path);
  const text = limit ? assistLimitText(limit) : '';
  return [note, text].filter((s): s is string => typeof s === 'string' && s !== '').join('; ');
}

const SAFETY = z.enum(ASSIST_SAFETY_FLAGS).describe('none unless something the student wrote suggests risk of self-harm or discloses abuse');
const OFF_TOPIC = z.boolean().describe('true only if the request is not about learning English or preparing for the GSAT');
const CHIPS = (kind: AssistOutputKind) =>
  z.array(z.string()).describe(lim(kind, 'followup_chips_zh', "short follow-up questions the student might want to ask next, written from the student's point of view"));

function knowledgeSchema(kind: 'item' | 'writing') {
  return z
    .array(
      z.object({
        kind: z.enum(ASSIST_KNOWLEDGE_KINDS),
        title_zh: z.string().describe(lim(kind, 'knowledge[].title_zh')),
        explain_zh: z.string().describe(lim(kind, 'knowledge[].explain_zh', 'the rule or usage, with the condition under which it applies and a common exception if there is one')),
        examples: z
          .array(
            z.object({
              en: z.string().describe(lim(kind, 'knowledge[].examples[].en', 'one short original English example sentence')),
              zh: z.string().describe(lim(kind, 'knowledge[].examples[].zh', 'its Traditional Chinese meaning')),
            }),
          )
          .describe(lim(kind, 'knowledge[].examples')),
      }),
    )
    .describe(lim(kind, 'knowledge', 'the language knowledge behind the answer, most important first'));
}

function doubtRepliesSchema(kind: 'item' | 'writing') {
  return z
    .array(
      z.object({
        doubt_zh: z.string().describe(lim(kind, 'doubt_replies[].doubt_zh', 'the doubt, restated briefly')),
        reply_zh: z.string().describe(lim(kind, 'doubt_replies[].reply_zh', 'a direct answer to that doubt')),
      }),
    )
    .describe(lim(kind, 'doubt_replies', 'one entry per doubt the student selected or wrote; empty when there is none'));
}

function practiceFocusSchema(kind: 'item' | 'writing') {
  return z
    .object({
      section: z.enum(ASSIST_SECTIONS),
      skill_codes: z.array(z.string()).describe(lim(kind, 'practice_focus.skill_codes', 'skill codes the student should practise next, from the closed list')),
    })
    .describe('what the website should recommend for practice; it chooses the practice items itself');
}

// ───────────────────────── item ─────────────────────────

export const assistItemSchema = z.object({
  section: z.enum(ASSIST_SECTIONS).describe('the section of the question; for website questions the program already knows it, so use the section named in <task>'),
  skill_codes: z.array(z.string()).describe(lim('item', 'skill_codes', 'skill codes from the closed list that this question tests')),
  tested_zh: z.string().describe(lim('item', 'tested_zh', 'what this question (or group) tests, in one or two sentences')),
  structure_zh: z
    .string()
    .describe(lim('item', 'structure_zh', 'for a group, or a question with a passage: paragraph gist, turns, reference chains and how the asked questions relate; empty string otherwise')),
  items: z
    .array(
      z.object({
        label: z.string().describe('the question number exactly as written in <task>'),
        answer: z
          .object({
            text: z.string().describe(lim('item', 'items[].answer.text', 'the correct answer, only when <task> gives no answer key; empty string for translation or composition tasks')),
            certainty: z.enum(['sure', 'likely', 'unsure']),
          })
          .describe('your own answer; the website ignores it whenever an answer key is given'),
        diagnosis: z.object({
          error_codes: z.array(z.string()).describe(lim('item', 'items[].diagnosis.error_codes', "error codes from the closed list for this student's mistake; empty when the answer is correct")),
          summary_zh: z.string().describe(lim('item', 'items[].diagnosis.summary_zh', 'one sentence: where this answer went wrong, or why it is right and what made it hard')),
          detail_zh: z.string().describe(lim('item', 'items[].diagnosis.detail_zh', "compare the student's answer with the correct one and name the exact clue that was missed or misread")),
        }),
        option_contrast_zh: z
          .string()
          .describe(lim('item', 'items[].option_contrast_zh', 'when the student was torn between two options: the decisive difference between them; empty string otherwise')),
        hints_zh: z.array(z.string()).describe(lim('item', 'items[].hints_zh', 'a hint ladder from light to strong that never states the answer or which option is correct')),
        solution_steps: z
          .array(
            z.object({
              text_zh: z.string().describe(lim('item', 'items[].solution_steps[].text_zh', 'one step of reaching the answer')),
              quote: z
                .string()
                .describe(lim('item', 'items[].solution_steps[].quote', 'a short span of English copied exactly from the question that supports this step; empty string when no text supports it')),
            }),
          )
          .describe(lim('item', 'items[].solution_steps', 'the steps to the correct answer, in the order a student would take them')),
        traps: z
          .array(
            z.object({
              option: z.string().describe('the option letter this trap belongs to, or an empty string'),
              trap_code: z.string().describe('a trap code given in <site_explanation>; empty string when none is given'),
              explain_zh: z.string().describe(lim('item', 'items[].traps[].explain_zh', 'why this option is tempting and why it fails')),
              spot_zh: z.string().describe(lim('item', 'items[].traps[].spot_zh', 'how to recognise this trap next time')),
            }),
          )
          .describe(lim('item', 'items[].traps', "the most tempting wrong options, starting with the student's own wrong choice")),
      }),
    )
    .describe(lim('item', 'items', 'one entry per question listed in <task>, in the same order')),
  knowledge: knowledgeSchema('item'),
  method: z
    .object({
      title_zh: z.string().describe(lim('item', 'method.title_zh')),
      steps_zh: z.array(z.string()).describe(lim('item', 'method.steps_zh', 'a reusable procedure for this question type that works on other questions too')),
    })
    .describe('the method for this type of question; for a group, one method that works for the whole group'),
  score_tips_zh: z.array(z.string()).describe(lim('item', 'score_tips_zh', "concrete actions that raise the student's score on this section")),
  doubt_replies: doubtRepliesSchema('item'),
  practice_focus: practiceFocusSchema('item'),
  followup_chips_zh: CHIPS('item'),
  key_concern_zh: z.string().describe(lim('item', 'key_concern_zh', 'only if you believe the given answer key is wrong: your concern; otherwise an empty string')),
  off_topic: OFF_TOPIC,
  safety_flag: SAFETY,
});
export type AssistItemOutput = z.infer<typeof assistItemSchema>;

// ───────────────────────── writing ─────────────────────────

export const WRITING_CRITERIA = ['wc:content', 'wc:organization', 'wc:grammar', 'wc:vocabulary'] as const;

export const assistWritingSchema = z.object({
  overview_zh: z.string().describe(lim('writing', 'overview_zh', 'the overall picture of this answer; do not state a score')),
  by_category: z
    .array(
      z.object({
        category: z.string().describe('the error category used by the grading result in <site_explanation>'),
        error_code: z.string().describe('one error code from the closed list'),
        trap_code: z.string().describe('a tt: skill code for a translation trap, or an empty string'),
        student_quote: z.string().describe(lim('writing', 'by_category[].student_quote', 'a short span copied exactly from <student_text> that shows the problem')),
        rule_zh: z.string().describe(lim('writing', 'by_category[].rule_zh', 'the rule the student needs')),
        self_check_zh: z.string().describe(lim('writing', 'by_category[].self_check_zh', 'a quick check the student can run on their own sentences')),
      }),
    )
    .describe(lim('writing', 'by_category', 'errors grouped by category, the costliest first')),
  criteria: z
    .array(
      z.object({
        criterion: z.enum(WRITING_CRITERIA),
        issue_zh: z.string().describe(lim('writing', 'criteria[].issue_zh', 'the main reason points were lost on this criterion')),
        next_step_zh: z.string().describe(lim('writing', 'criteria[].next_step_zh', 'what to do differently in the next essay')),
      }),
    )
    .describe(lim('writing', 'criteria', 'essays only: one entry per criterion; empty for translation')),
  sentence_plan: z
    .array(
      z.object({
        sentence_index: z.number().int().describe('0 for the first sentence, 1 for the second'),
        main_clause_zh: z.string().describe(lim('writing', 'sentence_plan[].main_clause_zh', 'the main clause to build first')),
        tense_trigger_zh: z.string().describe(lim('writing', 'sentence_plan[].tense_trigger_zh', 'the words in the Chinese that decide the tense, and the tense they call for')),
        structure: z.string().describe('one ts: skill code for the key structure, or an empty string'),
        trap_codes: z.array(z.string()).describe(lim('writing', 'sentence_plan[].trap_codes', 'tt: skill codes for the traps in this sentence')),
      }),
    )
    .describe(lim('writing', 'sentence_plan', 'translation only: one entry per sentence; empty for essays')),
  rewrite_steps_zh: z.array(z.string()).describe(lim('writing', 'rewrite_steps_zh', 'how to write the next answer, as steps; never a full answer')),
  knowledge: knowledgeSchema('writing'),
  score_tips_zh: z.array(z.string()).describe(lim('writing', 'score_tips_zh', 'concrete actions aimed at the criteria or parts that lost the most points')),
  doubt_replies: doubtRepliesSchema('writing'),
  skill_codes: z.array(z.string()).describe(lim('writing', 'skill_codes', 'ts:, tt:, wc: or gp: skill codes from the closed list')),
  practice_focus: practiceFocusSchema('writing'),
  followup_chips_zh: CHIPS('writing'),
  off_topic: OFF_TOPIC,
  safety_flag: SAFETY,
});
export type AssistWritingOutput = z.infer<typeof assistWritingSchema>;

// ───────────────────────── vocab ─────────────────────────

export const assistVocabSchema = z.object({
  groups: z
    .array(
      z.object({
        theme_zh: z.string().describe(lim('vocab', 'groups[].theme_zh', 'what ties these words together')),
        entry_ids: z.array(z.string()).describe('entry_id values from <question>'),
        contrast_zh: z.string().describe(lim('vocab', 'groups[].contrast_zh', 'how to tell these words apart')),
      }),
    )
    .describe(lim('vocab', 'groups', 'groups of easily confused words or shared collocations; empty when the words are unrelated')),
  entries: z
    .array(
      z.object({
        entry_id: z.string().describe('the entry_id exactly as given in <question>'),
        senses: z
          .array(
            z.object({
              pos: z.string().describe('part of speech, for example n., v., adj.'),
              zh: z.string().describe(lim('vocab', 'entries[].senses[].zh')),
              note_zh: z.string().describe(lim('vocab', 'entries[].senses[].note_zh', 'usage note, or an empty string')),
            }),
          )
          .describe(lim('vocab', 'entries[].senses', 'the senses most likely to appear on the GSAT')),
        collocations: z
          .array(
            z.object({
              en: z.string().describe(lim('vocab', 'entries[].collocations[].en')),
              zh: z.string().describe(lim('vocab', 'entries[].collocations[].zh')),
            }),
          )
          .describe(lim('vocab', 'entries[].collocations')),
        confusables: z
          .array(
            z.object({
              word: z.string().describe(lim('vocab', 'entries[].confusables[].word')),
              diff_zh: z.string().describe(lim('vocab', 'entries[].confusables[].diff_zh')),
            }),
          )
          .describe(lim('vocab', 'entries[].confusables')),
        word_family: z
          .array(z.object({ word: z.string().describe(lim('vocab', 'entries[].word_family[].word')), pos: z.string() }))
          .describe(lim('vocab', 'entries[].word_family')),
        memory_tip_zh: z.string().describe(lim('vocab', 'entries[].memory_tip_zh')),
        example: z.object({
          en: z.string().describe(lim('vocab', 'entries[].example.en', 'one short original sentence, at most 20 words')),
          zh: z.string().describe(lim('vocab', 'entries[].example.zh')),
        }),
      }),
    )
    .describe(lim('vocab', 'entries', 'one entry per word in <question>, in the same order')),
  review_plan_zh: z.string().describe(lim('vocab', 'review_plan_zh', 'how to review these words over the next days')),
  followup_chips_zh: CHIPS('vocab'),
  off_topic: OFF_TOPIC,
  safety_flag: SAFETY,
});
export type AssistVocabOutput = z.infer<typeof assistVocabSchema>;

// ───────────────────────── followup ─────────────────────────

export const assistFollowupSchema = z.object({
  reply_zh: z.string().describe(lim('followup', 'reply_zh', "the direct answer to the student's new question")),
  points: z
    .array(
      z.object({
        text_zh: z.string().describe(lim('followup', 'points[].text_zh')),
        example_en: z.string().describe(lim('followup', 'points[].example_en', 'a short original example sentence, or an empty string')),
      }),
    )
    .describe(lim('followup', 'points', 'key points that support the reply')),
  mode_used: z.enum(['hint', 'explain']).describe('the mode given in <task>'),
  new_error_codes: z.array(z.string()).describe(lim('followup', 'new_error_codes', 'error codes from the closed list for any new misunderstanding this question reveals')),
  understood_check_zh: z.string().describe(lim('followup', 'understood_check_zh', 'one short question the student can answer to check their understanding')),
  followup_chips_zh: CHIPS('followup'),
  off_topic: OFF_TOPIC,
  safety_flag: SAFETY,
});
export type AssistFollowupOutput = z.infer<typeof assistFollowupSchema>;
