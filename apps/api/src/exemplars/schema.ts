/**
 * 作文範文的輸出格式（docs/design/model-essays.md §3.3）：刻意小而扁平。
 *
 *   - 根物件 22 個純量欄位（字串、布林、enum）＋2 個陣列（各 4、3 個欄位）；葉節點 29、巢狀深度 2、沒有 nullable／anyOf。
 *   - 每一個欄位都直接寫在這裡（不共用 zod 實例），SDK 轉換時本來就不會產生 $defs；送出前 client.ts 依 shared 的
 *     inlinesSchemaRefs 再攤開一次 $ref（保險）。test/ai.rules.test.ts 的「schema 大小預算」釘住欄位數、陣列數、深度、
 *     沒有 $ref／$defs 與 JSON 長度；要加欄位，那個測試會先失敗。
 *   - 數量、長度、範圍都由程式驗證與截斷（output.ts；SDK 會剝掉 maxLength、maxItems 這類約束，陣列筆數不進 grammar）。
 *   - 欄位順序就是產生順序：先理解題目與構想，再寫三篇，最後寫說明。欄位名稱沒有 reasoning、thinking 這類字（client.ts 的
 *     FORBIDDEN_SCHEMA_WORDS）；plan_zh 是「構想」，不是推理過程。
 */
import { EXEMPLAR_LEVELS, MODEL_TEXT_NOTE_KINDS } from '@gsat/shared';
import * as z from 'zod/v4';
import { SAFETY_FLAGS } from '../ai/prompts/essay';

export const exemplarOutputSchema = z.object({
  is_writing_task: z.boolean().describe('false only if the task is not asking for English writing; then all strings empty, arrays empty'),
  task_reading_zh: z.string().describe('<=150 characters'),
  plan_zh: z.string().describe('<=250 characters: the plan shared by all three essays'),
  basic_text: z.string().describe('the basic essay in English; paragraphs separated by a single newline'),
  steady_text: z.string().describe('the steady essay in English; same format'),
  top_text: z.string().describe('the top essay in English; same format'),
  basic_content_zh: z.string().describe('<=90 characters'),
  basic_organization_zh: z.string().describe('<=90 characters'),
  basic_grammar_zh: z.string().describe('<=90 characters'),
  basic_vocabulary_zh: z.string().describe('<=90 characters'),
  steady_content_zh: z.string().describe('<=90 characters'),
  steady_organization_zh: z.string().describe('<=90 characters'),
  steady_grammar_zh: z.string().describe('<=90 characters'),
  steady_vocabulary_zh: z.string().describe('<=90 characters'),
  top_content_zh: z.string().describe('<=90 characters'),
  top_organization_zh: z.string().describe('<=90 characters'),
  top_grammar_zh: z.string().describe('<=90 characters'),
  top_vocabulary_zh: z.string().describe('<=90 characters'),
  basic_next_zh: z.string().describe('<=160 characters'),
  steady_next_zh: z.string().describe('<=160 characters'),
  top_next_zh: z.string().describe('<=160 characters'),
  highlights: z
    .array(
      z.object({
        level: z.enum(EXEMPLAR_LEVELS),
        kind: z.enum(MODEL_TEXT_NOTE_KINDS),
        text: z.string().describe('copied exactly from that essay; at most 25 words'),
        zh: z.string().describe('<=50 characters'),
      }),
    )
    .describe('at most 10 per level'),
  typical_errors: z
    .array(
      z.object({
        wrong: z.string().describe('a short sentence with one typical error; not in any essay'),
        right: z.string().describe('the corrected sentence'),
        zh: z.string().describe('<=50 characters: the rule'),
      }),
    )
    .describe('at most 3'),
  safety_flag: z.enum(SAFETY_FLAGS),
});

export type ExemplarOutput = z.infer<typeof exemplarOutputSchema>;

/** 每一級的四項說明欄位名稱（{level}_{criterion}_zh）。 */
export function criterionField(level: (typeof EXEMPLAR_LEVELS)[number], criterion: 'content' | 'organization' | 'grammar' | 'vocabulary'): keyof ExemplarOutput {
  return `${level}_${criterion}_zh` as keyof ExemplarOutput;
}

/** 設計的大小預算（§3.4；test/ai.rules.test.ts 用它斷言送出的 schema）。 */
export const EXEMPLAR_SCHEMA_BUDGET = { leavesMax: 32, arraysMax: 2, depthMax: 3, anyOf: 0, jsonBytesMax: 6_000 } as const;
