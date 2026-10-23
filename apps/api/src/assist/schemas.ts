/**
 * 學習助手請求本體的 zod schema（docs/design/learning-assistant.md §4.2、§4.4）。只驗形狀與粗略的長度（擋超大或型別不對的本體），
 * 各來源的細節（題號、作答、label_map、swap、單字條目）在 sources.ts 驗證；學生文字的規則在 shared 的 checkAssistText／
 * checkAssistQuestion。請求大小（位元組）依 §4.15 的表：建立案例與 PUT …/question 32 KB，其他 4 KB。
 */
import { ASSIST_DOUBT_KINDS, ASSIST_FOLLOWUP_MODES, ASSIST_RATINGS, ASSIST_SOURCES, ASSIST_UNDERSTOOD } from '@gsat/shared';
import * as z from 'zod/v4';

/** 請求本體的上限（位元組；readJsonBody 邊讀邊數）。 */
export const ASSIST_BODY_MAX = {
  create: 32 * 1024,
  question: 32 * 1024,
  small: 4 * 1024,
} as const;

/** 學生文字的粗略上限（字元；正規化、遮個資與精確的上限在 checkAssistText）。 */
const TEXT_RAW_MAX = 2_000;

const doubtKinds = z.array(z.enum(ASSIST_DOUBT_KINDS)).max(ASSIST_DOUBT_KINDS.length);
const optionalText = z.string().max(TEXT_RAW_MAX).nullable().optional();

export const createCaseSchema = z.object({
  // 各來源的欄位在 sources.ts 驗證（這裡只確認是物件、來源合法）。
  source: z.looseObject({ source: z.enum(ASSIST_SOURCES) }),
  doubt_kinds: doubtKinds.optional(),
  torn_with: z.string().regex(/^[A-O]$/).nullable().optional(),
  doubt: optionalText,
  hint_first: z.boolean().optional(),
  signals: z
    .object({
      time_sec: z.number().int().min(0).max(86_400).optional(),
      hints_used: z.number().int().min(0).max(20).optional(),
      marked: z.boolean().optional(),
      revealed: z.boolean().optional(),
    })
    .strict()
    .optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const updateQuestionSchema = z
  .object({
    question: z.unknown(),
    doubt_kinds: doubtKinds.optional(),
    doubt: optionalText,
    hint_first: z.boolean().optional(),
  })
  .strict();

export const patchCaseSchema = z
  .object({
    understood: z.enum(ASSIST_UNDERSTOOD).nullable().optional(),
    rating: z.enum(ASSIST_RATINGS).nullable().optional(),
    note: optionalText,
  })
  .strict();

export const analyzeSchema = z.object({}).strict();

export const followupSchema = z
  .object({
    text: z.string().max(TEXT_RAW_MAX),
    mode: z.enum(ASSIST_FOLLOWUP_MODES),
    label: z.string().max(8).nullable().optional(),
  })
  .strict();
