/**
 * AI 任務設定表（ARCHITECTURE §6.1）。負責：後端 AI A2。
 *
 * 前端只能指定任務代號；模型、effort、max_tokens、評分者、逾時、點數、預扣美元全部在這裡決定（§7「把 Worker 當成
 * 通用 Claude 代理」）。模型與 effort 的值來自 config.ts（wrangler.toml 的 AI_MODEL_*、AI_EFFORT_*），其餘寫死。
 *
 * 評分者（§3.4 第 9–10 步）：
 *   primary  第一位：完整的錯誤清單與回饋
 *   second   第二位：換評分框架（先整體再分項），和第一位平行、互相獨立
 *   third    第三位：只有前兩位差距超過門檻（作文 >5、中譯英 >2）才呼叫，框架同第二位
 *   ocr      手寫照片轉錄（只有一位）
 */
import { AI_TASK_POINTS, ESSAY_FAMILY_TASKS, type AiTask, type RaterRole } from '@gsat/shared';
import type { AiEffort, AppConfig } from '../config';
import { isPricedModel, worstCaseMicros } from './pricing';

export type CallRole = RaterRole | 'ocr';

/** 提示詞框架：第一位的完整批改、第二／三位的「先整體再分項」、OCR。 */
export type PromptFramework = 'analytic' | 'holistic' | 'ocr';

export interface CallSpec {
  role: CallRole;
  model: string;
  effort: AiEffort;
  /** 含思考的空間（§6.2 第 4 條）。 */
  maxTokens: number;
  framework: PromptFramework;
}

export interface TaskConfig {
  task: AiTask;
  points: number;
  submissionKind: 'translation' | 'essay';
  /** SDK 單次請求逾時（毫秒，§6.2 第 16 條）。 */
  timeoutMs: number;
  /** SDK 自動重試次數（§6.2 第 16 條：2，所以最壞牆鐘 ＝ 逾時 × 3）。 */
  maxRetries: number;
  /** 每一次呼叫的輸入估計 tokens（系統提示＋評分基準＋題目＋學生文字或照片；預扣用）。 */
  inputTokensEstimate: number;
  /** 這個任務可能呼叫的所有評分者（含可能的第三位），預扣以全部加總計算最壞情況。 */
  calls: CallSpec[];
  /** 計入「每日篇數」的任務家族（null＝不限篇數）。 */
  family: readonly AiTask[] | null;
}

/** 逾時（毫秒）：OCR 90 秒、中譯英 120 秒、作文 240 秒（§6.2 第 16 條）。 */
export const TASK_TIMEOUT_MS = { essay_ocr: 90_000, translation_grade: 120_000, essay_grade: 240_000 } as const satisfies Record<AiTask, number>;
export const SDK_MAX_RETRIES = 2;

/**
 * Queue 的最多投遞次數＝1＋wrangler.toml 的 max_retries（3）。最後一次仍失敗就直接退還，
 * 不必等死信佇列（DLQ 的 consumer 仍會兜底退還）。
 */
export const QUEUE_MAX_DELIVERIES = 4;

/**
 * 租約長度（秒）。ARCHITECTURE §6.8 寫 10 分鐘，但一次 consumer 呼叫最長可以跑到 CONSUMER_WALL_BUDGET_MS（14 分鐘；
 * 作文每位評分者的總期限就有 240 秒 × 3＝12 分鐘）：租約比它短的話，重複投遞的同一則訊息會在處理途中搶到租約、
 * 再付一次錢。所以取 15 分鐘＝牆鐘預算＋1 分鐘（test/ai.hardening.test.ts 檢查）。
 */
export const LEASE_SECONDS = 900;

export function taskConfig(task: AiTask, config: AppConfig): TaskConfig {
  const { models, effort } = config.ai;
  switch (task) {
    case 'translation_grade':
      return {
        task,
        points: AI_TASK_POINTS[task],
        submissionKind: 'translation',
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 3,500：本站仿真題的 user 訊息多了本站參考（guidance 上限 2,600 bytes），最壞情況約 3.0k tokens
        // （docs/design/bank-writing.md §5.5；test/ai.bank-writing.test.ts 檢查）。這是預扣上限，結算照實際用量。
        inputTokensEstimate: 3_500,
        calls: [
          { role: 'primary', model: models.default, effort: effort.grade, maxTokens: 6_000, framework: 'analytic' },
          { role: 'second', model: models.secondRater, effort: effort.grade, maxTokens: 3_000, framework: 'holistic' },
          { role: 'third', model: models.default, effort: effort.grade, maxTokens: 3_000, framework: 'holistic' },
        ],
        family: null,
      };
    case 'essay_grade':
      return {
        task,
        points: AI_TASK_POINTS[task],
        submissionKind: 'essay',
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        inputTokensEstimate: 6_000,
        calls: [
          { role: 'primary', model: models.default, effort: effort.grade, maxTokens: 12_000, framework: 'analytic' },
          { role: 'second', model: models.secondRater, effort: effort.grade, maxTokens: 4_000, framework: 'holistic' },
          { role: 'third', model: models.default, effort: effort.grade, maxTokens: 4_000, framework: 'holistic' },
        ],
        family: ESSAY_FAMILY_TASKS,
      };
    case 'essay_ocr':
      return {
        task,
        points: AI_TASK_POINTS[task],
        submissionKind: 'essay',
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 兩張長邊 1600 px 的照片各約 2,500 tokens，加上提示詞。
        inputTokensEstimate: 6_000,
        calls: [{ role: 'ocr', model: models.default, effort: effort.ocr, maxTokens: 3_000, framework: 'ocr' }],
        family: null,
      };
  }
}

/** 取得某個角色的呼叫設定。 */
export function callSpec(tc: TaskConfig, role: CallRole): CallSpec {
  const spec = tc.calls.find((c) => c.role === role);
  if (!spec) throw new Error(`任務 ${tc.task} 沒有評分者 ${role}`);
  return spec;
}

/** 任務用到的模型都在價格表裡（§6.2 第 1 條；不在就不預扣、不呼叫）。 */
export function taskModelsPriced(tc: TaskConfig): boolean {
  return tc.calls.every((c) => isPricedModel(c.model));
}

/** 預扣的美元（微美元）：所有可能的評分者（含第三位）最壞情況加總（§6.4）。 */
export function reserveMicros(tc: TaskConfig): number {
  return tc.calls.reduce((sum, c) => sum + worstCaseMicros(c.model, tc.inputTokensEstimate, c.maxTokens), 0);
}
