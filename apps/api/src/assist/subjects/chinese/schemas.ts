/**
 * 學習助手國文的模型輸出 schema（zod；docs/design/assistant-subjects.md §3.1–§3.5）：三種解析（zh_choice、zh_short、zh_writing）、
 * 追問與拍照轉錄。英文的 analysisSchemas.ts、prompts/assist-ocr.ts 一個字都不改（§2.4）。
 *
 * 規則（同英文，ARCHITECTURE §6.2 第 5、6 條）：
 *   - 每一欄都 required，「沒有」用空字串或空陣列；不用 nullable、不用聯集、沒有 $ref（共用的片段每次都用函式重新建，
 *     送出前另外由 inlinesSchemaRefs 攤開）。
 *   - 字數與項數的上限寫進 .describe()（ZH_FIELD_LIMITS，同英文 assistLimitText 的寫法），程式另外截斷。
 *   - **大小預算**（§3.1，subjects/index.ts 的 ASSIST_SCHEMA_BUDGET；test/assist.zh.rules.test.ts 釘住確切數字）：
 *       zh_choice  37 葉、全部陣列 12、物件陣列 6、深度 3、根欄位 14
 *       zh_short   31 葉、全部陣列 10、物件陣列 5、深度 3、根欄位 14
 *       zh_writing 32 葉、全部陣列 14、物件陣列 6、深度 2、根欄位 19
 *       追問        9 葉、全部陣列 3、物件陣列 1、深度 2、根欄位 8
 *       轉錄        8 葉、全部陣列 4、物件陣列 2、深度 3、根欄位 5
 *       國寫範文   15 葉、全部陣列 5、物件陣列 3、深度 2、根欄位 8（國寫範文設計 §3.1）
 *     加欄位時那個測試會先失敗：改的人要同時更新數字與設計文件 §3.1 的表。
 *   - 小列舉（判定、確定程度、覆蓋程度、片段檢核狀態、追問模式、科目、卡片種類）一律是字串，由程式正規化（§3.1、§5.1 第 2 步）：
 *     列舉的值 SDK 會搬進說明、不受 grammar 約束，寫錯一個值就要付費重試。只有 safety_flag 與轉錄的 status、區塊種類、
 *     omitted 照英文用 enum（每個 ≤ 6 個值）。代碼清單（題型、錯因、瑕疵、技能）也是字串，不在清單的由程式丟掉。
 *   - 欄位名稱不含 reasoning 一類的字；說明欄位一律以 _zh 結尾（例句欄叫 example，不叫 example_en）。
 */
import { ASSIST_BLOCK_KINDS, ASSIST_OCR_OMITTED, ASSIST_SAFETY_FLAGS, assistLimitText, zhFieldLimit, type ZhCaseKind, type ZhOutputKind } from '@gsat/shared';
import * as z from 'zod/v4';

/** 某一欄的上限說明（＋補充說明）。沒有上限的欄位只回補充說明。 */
function lim(kind: ZhOutputKind, path: string, note?: string): string {
  const limit = zhFieldLimit(kind, path);
  const text = limit ? assistLimitText(limit) : '';
  return [note, text].filter((s): s is string => typeof s === 'string' && s !== '').join('; ');
}

const safety = () => z.enum(ASSIST_SAFETY_FLAGS).describe('none unless something the student wrote suggests risk of self-harm or discloses abuse');
const offTopic = () => z.boolean().describe('true only if the request is not about learning Chinese (國文) or preparing for the GSAT');
const detectedSubject = () =>
  z.string().describe('chinese for a Chinese (國文) question; otherwise the likely subject (english, math, social, science or other) and leave every other field empty');
const skillCodes = (kind: ZhCaseKind) => z.array(z.string()).describe(lim(kind, 'skill_codes', 'zs: skill codes from the closed list'));
const chips = (kind: ZhOutputKind) => z.array(z.string()).describe(lim(kind, 'followup_chips_zh', "short follow-up questions from the student's point of view"));

function doubtReplies(kind: ZhCaseKind) {
  return z
    .array(
      z.object({
        doubt_zh: z.string().describe(lim(kind, 'doubt_replies[].doubt_zh')),
        reply_zh: z.string().describe(lim(kind, 'doubt_replies[].reply_zh')),
      }),
    )
    .describe(lim(kind, 'doubt_replies', 'one per doubt the student selected or wrote; empty when there is none'));
}

/** 題型卡（選擇與簡答共用一個形狀；11 種卡的欄名在系統提示裡）。 */
function cards(kind: 'zh_choice' | 'zh_short') {
  return z
    .array(
      z.object({
        for_label: z.string().describe(lim(kind, 'cards[].for_label', 'the question number this card belongs to; empty string for a card shared by the whole group')),
        kind: z.string().describe('the card kind from the closed list'),
        title_zh: z.string().describe(lim(kind, 'cards[].title_zh')),
        rows: z
          .array(
            z.object({
              head: z.string().describe(lim(kind, 'cards[].rows[].head')),
              a: z.string().describe(lim(kind, 'cards[].rows[].a')),
              b: z.string().describe(lim(kind, 'cards[].rows[].b')),
              note: z.string().describe(lim(kind, 'cards[].rows[].note')),
            }),
          )
          .describe(lim(kind, 'cards[].rows', 'columns depend on the card kind; leave a cell empty rather than invent it')),
      }),
    )
    .describe(lim(kind, 'cards', 'question-type cards'));
}

function method(kind: 'zh_choice' | 'zh_short') {
  return z
    .object({
      title_zh: z.string().describe(lim(kind, 'method.title_zh')),
      steps_zh: z.array(z.string()).describe(lim(kind, 'method.steps_zh', 'steps for the main question type, applied to this question')),
    })
    .describe('the method for the main question type of this case');
}

function headFields(kind: 'zh_choice' | 'zh_short') {
  return {
    section: z.string().describe('the main question type of the whole case, from the closed list'),
    detected_subject: detectedSubject(),
    skill_codes: skillCodes(kind),
    tested_zh: z.string().describe(lim(kind, 'tested_zh', 'what this question or group tests')),
    passage_zh: z.string().describe(lim(kind, 'passage_zh', 'gist of the passage, who is who and how several texts relate; empty when there is no passage')),
    cards: cards(kind),
  };
}

function tailFields(kind: 'zh_choice' | 'zh_short') {
  return {
    method: method(kind),
    score_tips_zh: z.array(z.string()).describe(lim(kind, 'score_tips_zh')),
    doubt_replies: doubtReplies(kind),
    followup_chips_zh: chips(kind),
    key_concern_zh: z.string().describe(lim(kind, 'key_concern_zh', 'only if you believe the answer key in <task> is wrong; otherwise empty')),
    off_topic: offTopic(),
    safety_flag: safety(),
  };
}

// ───────────────────────── zh_choice（單選、多選、研判、排序；§3.2） ─────────────────────────

export const zhChoiceSchema = z.object({
  ...headFields('zh_choice'),
  items: z
    .array(
      z.object({
        label: z.string().describe('the question number exactly as written in <task>'),
        item_type: z.string().describe('the question type of this question, from the closed list'),
        answer: z.object({
          text: z.string().describe(lim('zh_choice', 'items[].answer.text', 'your answer letters (for example B or ACE); the website uses the answer key instead when <task> gives one')),
          certainty: z.string().describe('sure, likely or unsure'),
        }),
        diagnosis: z.object({
          error_codes: z.array(z.string()).describe(lim('zh_choice', 'items[].diagnosis.error_codes', "error codes for the student's mistake; empty when correct or unanswered")),
          summary_zh: z.string().describe(lim('zh_choice', 'items[].diagnosis.summary_zh')),
          detail_zh: z.string().describe(lim('zh_choice', 'items[].diagnosis.detail_zh')),
        }),
        hints_zh: z.array(z.string()).describe(lim('zh_choice', 'items[].hints_zh', 'from light to strong; hints 1 and 2 never name the correct option')),
        solution_steps: z
          .array(
            z.object({
              text_zh: z.string().describe(lim('zh_choice', 'items[].solution_steps[].text_zh')),
              quote: z.string().describe(lim('zh_choice', 'items[].solution_steps[].quote', 'words copied exactly from the question; empty when none')),
            }),
          )
          .describe(lim('zh_choice', 'items[].solution_steps')),
        options: z
          .array(
            z.object({
              option: z.string().describe('A to E, or ① to ⑤ for numbered statements'),
              verdict: z.string().describe('yes, no or cannot_tell'),
              key_zh: z.string().describe(lim('zh_choice', 'items[].options[].key_zh', 'the decisive fact, written as the question type requires')),
              reason_zh: z.string().describe(lim('zh_choice', 'items[].options[].reason_zh')),
              quote: z.string().describe(lim('zh_choice', 'items[].options[].quote', 'words copied exactly from the question; empty when none')),
              flaw: z.string().describe('a flaw code for a wrong option, otherwise empty'),
            }),
          )
          .describe(lim('zh_choice', 'items[].options', 'every option, or every numbered statement')),
      }),
    )
    .describe(lim('zh_choice', 'items', 'one per question in <task>, in the same order')),
  ...tailFields('zh_choice'),
});
export type ZhChoiceOutput = z.infer<typeof zhChoiceSchema>;

// ───────────────────────── zh_short（非選擇題、簡答；§3.3） ─────────────────────────

export const zhShortSchema = z.object({
  ...headFields('zh_short'),
  parts: z
    .array(
      z.object({
        label: z.string().describe('the part number exactly as written in <task>, for example 34(1)'),
        task_zh: z.string().describe(lim('zh_short', 'parts[].task_zh', 'how many things are asked, the character limit and the copying rule')),
        key_points: z
          .array(
            z.object({
              point_zh: z.string().describe(lim('zh_short', 'parts[].key_points[].point_zh')),
              quote: z.string().describe(lim('zh_short', 'parts[].key_points[].quote', 'evidence copied exactly from the question; empty when none')),
            }),
          )
          .describe(lim('zh_short', 'parts[].key_points', 'the required elements')),
        frame_zh: z.string().describe(lim('zh_short', 'parts[].frame_zh', 'a sentence frame')),
        demo_zh: z.string().describe(lim('zh_short', 'parts[].demo_zh', 'your own sample answer within the character limit; empty for a translation question')),
        hints_zh: z.array(z.string()).describe(lim('zh_short', 'parts[].hints_zh')),
        check: z.object({
          coverage: z.string().describe("full, partial, none, or unanswered when the student gave no answer"),
          missing_zh: z.string().describe(lim('zh_short', 'parts[].check.missing_zh', 'which required element is missing')),
          wording_zh: z.string().describe(lim('zh_short', 'parts[].check.wording_zh', 'subject, key words and wrong characters')),
        }),
      }),
    )
    .describe(lim('zh_short', 'parts', 'one per part in <task>, in the same order')),
  ...tailFields('zh_short'),
});
export type ZhShortOutput = z.infer<typeof zhShortSchema>;

// ───────────────────────── zh_writing（國寫指導；§3.4） ─────────────────────────

export const zhWritingSchema = z.object({
  section: z.string().describe('zh_writing_reason or zh_writing_emotion'),
  detected_subject: detectedSubject(),
  skill_codes: skillCodes('zh_writing'),
  tested_zh: z.string().describe(lim('zh_writing', 'tested_zh', 'what the task asks for')),
  material_zh: z.string().describe(lim('zh_writing', 'material_zh', 'what the material says, or the image and guiding questions')),
  requirements: z
    .array(
      z.object({
        point_zh: z.string().describe(lim('zh_writing', 'requirements[].point_zh')),
        quote: z.string().describe(lim('zh_writing', 'requirements[].quote', 'the words of the prompt, copied exactly')),
        how_zh: z.string().describe(lim('zh_writing', 'requirements[].how_zh', 'how to meet it, as a hint, not as finished prose')),
      }),
    )
    .describe(lim('zh_writing', 'requirements')),
  q1: z
    .object({
      points_zh: z.array(z.string()).describe(lim('zh_writing', 'q1.points_zh', 'the points for 問題（一）')),
      quotes: z.array(z.string()).describe(lim('zh_writing', 'q1.quotes', 'material quoted exactly, in the same order as points_zh')),
      frame_zh: z.string().describe(lim('zh_writing', 'q1.frame_zh')),
      demo_zh: z.string().describe(lim('zh_writing', 'q1.demo_zh')),
    })
    .describe('問題（一） of an analytical task; all empty for an emotional task'),
  stances_zh: z.array(z.string()).describe(lim('zh_writing', 'stances_zh')),
  angles_zh: z.array(z.string()).describe(lim('zh_writing', 'angles_zh', 'concrete, personal material')),
  outline: z
    .array(
      z.object({
        part_zh: z.string().describe(lim('zh_writing', 'outline[].part_zh')),
        hint_zh: z.string().describe(lim('zh_writing', 'outline[].hint_zh')),
      }),
    )
    .describe(lim('zh_writing', 'outline')),
  examples: z
    .array(
      z.object({
        use_zh: z.string().describe(lim('zh_writing', 'examples[].use_zh', 'where it goes, or 主體段示範')),
        text: z.string().describe(lim('zh_writing', 'examples[].text')),
      }),
    )
    .describe(lim('zh_writing', 'examples', 'up to three sentences of at most 50 characters, or one body paragraph of at most 150; 150 in total')),
  pitfalls_zh: z.array(z.string()).describe(lim('zh_writing', 'pitfalls_zh')),
  draft_checks: z
    .array(
      z.object({
        point_zh: z.string().describe(lim('zh_writing', 'draft_checks[].point_zh')),
        status: z.string().describe('met, partly or missing'),
        comment_zh: z.string().describe(lim('zh_writing', 'draft_checks[].comment_zh')),
        quote: z.string().describe(lim('zh_writing', 'draft_checks[].quote', "copied exactly from the student's paragraph")),
      }),
    )
    .describe(lim('zh_writing', 'draft_checks', 'only when the student attached a paragraph')),
  typos: z
    .array(
      z.object({
        wrong: z.string().describe(lim('zh_writing', 'typos[].wrong')),
        right: z.string().describe(lim('zh_writing', 'typos[].right')),
        quote: z.string().describe(lim('zh_writing', 'typos[].quote', "copied exactly from the student's paragraph")),
      }),
    )
    .describe(lim('zh_writing', 'typos', 'real wrong characters only')),
  checklist_zh: z.array(z.string()).describe(lim('zh_writing', 'checklist_zh')),
  doubt_replies: doubtReplies('zh_writing'),
  followup_chips_zh: chips('zh_writing'),
  off_topic: offTopic(),
  safety_flag: safety(),
});
export type ZhWritingOutput = z.infer<typeof zhWritingSchema>;

/** 解析的輸出 schema（依格式）。 */
export function zhAnalyzeSchema(kind: ZhCaseKind): z.ZodType {
  switch (kind) {
    case 'zh_choice':
      return zhChoiceSchema;
    case 'zh_short':
      return zhShortSchema;
    case 'zh_writing':
      return zhWritingSchema;
  }
}

export type ZhAnalysisOutput = ZhChoiceOutput | ZhShortOutput | ZhWritingOutput;

// ───────────────────────── 追問（§3.5） ─────────────────────────

export const zhFollowupSchema = z.object({
  reply_zh: z.string().describe(lim('zh_followup', 'reply_zh', "the direct answer to the student's new question")),
  points: z
    .array(
      z.object({
        text_zh: z.string().describe(lim('zh_followup', 'points[].text_zh')),
        example: z.string().describe(lim('zh_followup', 'points[].example', 'a short example, or an empty string')),
      }),
    )
    .describe(lim('zh_followup', 'points')),
  mode_used: z.string().describe('hint or explain, as given in <task>'),
  new_error_codes: z.array(z.string()).describe(lim('zh_followup', 'new_error_codes', 'error codes for a new misunderstanding')),
  understood_check_zh: z.string().describe(lim('zh_followup', 'understood_check_zh')),
  followup_chips_zh: chips('zh_followup'),
  off_topic: offTopic(),
  safety_flag: safety(),
});
export type ZhFollowupOutput = z.infer<typeof zhFollowupSchema>;

// ───────────────────────── 國寫範文（國寫範文設計 §3.1） ─────────────────────────

/**
 * 一篇完整的國寫示範：知性＝問題（一）答案＋問題（二）段落；情意＝全文的段落。每段帶段落作用、方法卡與技巧；另有「這篇怎麼寫」、
 * 要件對照與寫完自我檢查。沒有任何等第或分數欄位。方法卡、要件對照的段號由程式正規化與檢查（exemplar.ts）。
 */
export const zhExemplarSchema = z.object({
  title_zh: z.string().describe(lim('zh_exemplar', 'title_zh', 'the title: the given one when <task> gives a title, your own when <task> asks for one, otherwise empty')),
  q1: z
    .object({
      answer_zh: z.string().describe(lim('zh_exemplar', 'q1.answer_zh', 'the answer to 問題（一） within the limit in <task>, from the material only')),
      material_quotes: z.array(z.string()).describe(lim('zh_exemplar', 'q1.material_quotes', 'short phrases the answer copies exactly from the material')),
    })
    .describe('問題（一） of an analytical task; all empty when <task> says 問題（一） does not apply'),
  paragraphs: z
    .array(
      z.object({
        text: z.string().describe('the paragraph as it would be written on the answer sheet, without the two leading empty cells'),
        role_zh: z.string().describe(lim('zh_exemplar', 'paragraphs[].role_zh', 'what this paragraph does')),
        card: z.string().describe('the id of the main method card this paragraph shows: task, thesis, material, structure or style'),
        technique_zh: z.string().describe(lim('zh_exemplar', 'paragraphs[].technique_zh', 'how this paragraph uses that card, quoting at most 12 characters of it in 「」')),
      }),
    )
    .describe(lim('zh_exemplar', 'paragraphs', '問題（二） of an analytical task, or the whole emotional essay, in order')),
  notes: z
    .array(
      z.object({
        card: z.string().describe('a method card id'),
        text_zh: z.string().describe(lim('zh_exemplar', 'notes[].text_zh', 'how the answer was built, so the student can reuse the method with their own material')),
      }),
    )
    .describe(lim('zh_exemplar', 'notes')),
  coverage: z
    .array(
      z.object({
        point_zh: z.string().describe(lim('zh_exemplar', 'coverage[].point_zh', 'a requirement from <analysis_digest>')),
        paragraph: z.number().int().describe('the paragraph that answers it: 1 for the first paragraph, 0 for 問題（一）'),
        quote: z.string().describe(lim('zh_exemplar', 'coverage[].quote', 'words copied exactly from that paragraph')),
      }),
    )
    .describe(lim('zh_exemplar', 'coverage', 'one row per requirement')),
  self_check_zh: z.array(z.string()).describe(lim('zh_exemplar', 'self_check_zh', 'questions the student can ask of their own essay')),
  off_topic: offTopic(),
  safety_flag: safety(),
});
export type ZhExemplarOutput = z.infer<typeof zhExemplarSchema>;

// ───────────────────────── 拍照轉錄（§3.5、§6.2） ─────────────────────────

/** 國文轉錄的狀態（只有這一欄是轉錄的狀態，維持 enum）。 */
export const ZH_OCR_STATUSES = ['ok', 'unclear', 'other_subject', 'no_question'] as const;

export const zhOcrSchema = z.object({
  status: z
    .enum(ZH_OCR_STATUSES)
    .describe('ok if Chinese exam questions could be transcribed; unclear if the main content cannot be read; other_subject if the photos show a question of another subject; no_question if there is no question'),
  detected_subject: z.string().describe('for other_subject: english, math, social, science or other; otherwise an empty string'),
  blocks: z
    .array(
      z.object({
        kind: z.enum(ASSIST_BLOCK_KINDS).describe('instructions, passage (also notes and side boxes), question, options, student_mark or figure'),
        label: z.string().describe(lim('zh_ocr', 'blocks[].label', 'the printed question number, or 注釋, 右框, 乙注; empty when none')),
        text: z.string().describe(lim('zh_ocr', 'blocks[].text', 'copied exactly, keeping wrong characters; [[?]] for an unreadable spot')),
        unclear: z
          .array(z.object({ candidates: z.array(z.string()).describe(lim('zh_ocr', 'blocks[].unclear[].candidates')) }))
          .describe('one per [[?]] in text, in order'),
      }),
    )
    .describe(lim('zh_ocr', 'blocks', 'in reading order')),
  student_answer_seen: z.string().describe(lim('zh_ocr', 'student_answer_seen', "the student's answers visible in the photos")),
  omitted: z.array(z.enum(ASSIST_OCR_OMITTED)).describe('kinds of content you saw but did not transcribe'),
});
export type ZhOcrOutput = z.infer<typeof zhOcrSchema>;
