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
 *   ocr      手寫照片轉錄（只有一位；學習助手的拍照轉錄也是）
 *   tutor    學習助手的解析、追問、報告（docs/design/learning-assistant.md §4.7.1）
 *   writer   作文範文：一次呼叫寫三個層級的範文與說明（docs/design/model-essays.md §3.1）；學習助手的國寫範文也是（一篇整篇示範）
 */
import {
  AI_TASK_POINTS,
  ASSIST_LIMITS,
  assistAnalyzePoints,
  assistPoints,
  ESSAY_FAMILY_TASKS,
  isZhCaseKind,
  type AiTask,
  type AssistCaseKind,
  type AssistSubject,
  type RaterRole,
  type ZhCaseKind,
} from '@gsat/shared';
import type { AiEffort, AppConfig } from '../config';
import { isPricedModel, worstCaseMicros } from './pricing';

export type CallRole = RaterRole | 'ocr' | 'tutor' | 'writer';

/** 提示詞框架：第一位的完整批改、第二／三位的「先整體再分項」、OCR、學習助手、作文範文。 */
export type PromptFramework = 'analytic' | 'holistic' | 'ocr' | 'assist' | 'exemplar';

export interface CallSpec {
  role: CallRole;
  model: string;
  effort: AiEffort;
  /** 含思考的空間（§6.2 第 4 條）。 */
  maxTokens: number;
  framework: PromptFramework;
  /**
   * 系統提示的快取時間：沒設＝5 分鐘（既有任務的請求逐位元不變）。學習助手的系統提示所有學生共用、流量斷斷續續，
   * 用 1 小時（client.ts 依它在 cache_control 加 ttl；1 小時的在前、5 分鐘的上下文 block 在後）。
   */
  systemCacheTtl?: '1h';
}

/**
 * 操作的對象（ai_ops.ref_id 指向哪一張表）：寫作批改是提交；學習助手的轉錄、解析、追問是 assist_turns 的一列，
 * 報告是 assist_reports 的一列；作文範文是 exemplar_sets 的一列（consumer 分流、housekeeping 回收、退還都依它）。
 */
export type TaskTarget =
  | { kind: 'submission'; submissionKind: 'translation' | 'essay' }
  | { kind: 'assist_turn' }
  | { kind: 'assist_report' }
  | { kind: 'exemplar_set' };

/** 任務家族每日上限的鍵（UserLimits.familyCaps；guard.ts）。 */
export const FAMILY_CAP_KEYS = ['essay', 'assist_report', 'assist_ocr', 'assist_zh_exemplar'] as const;
export type FamilyCapKey = (typeof FAMILY_CAP_KEYS)[number];

/** 計入同一個每日上限的任務（RESERVE_SQL 的家族任務清單 ?13）與上限的鍵。 */
export interface TaskFamily {
  tasks: readonly AiTask[];
  capKey: FamilyCapKey;
}

export const ESSAY_FAMILY: TaskFamily = { tasks: ESSAY_FAMILY_TASKS, capKey: 'essay' };
export const ASSIST_REPORT_FAMILY: TaskFamily = { tasks: ['assist_report'], capKey: 'assist_report' };
export const ASSIST_OCR_FAMILY: TaskFamily = { tasks: ['assist_ocr'], capKey: 'assist_ocr' };
/** 國寫範文：每人每天 3 篇（國寫範文設計 §6；失敗退還的不算）。 */
export const ASSIST_ZH_EXEMPLAR_FAMILY: TaskFamily = { tasks: ['assist_zh_exemplar'], capKey: 'assist_zh_exemplar' };

export interface TaskConfig {
  task: AiTask;
  points: number;
  target: TaskTarget;
  /** SDK 單次請求逾時（毫秒，§6.2 第 16 條）。 */
  timeoutMs: number;
  /** SDK 自動重試次數（§6.2 第 16 條：2，所以最壞牆鐘 ＝ 逾時 × 3）。 */
  maxRetries: number;
  /** 每一次呼叫的輸入估計 tokens（系統提示＋評分基準＋題目＋學生文字或照片；預扣用）。 */
  inputTokensEstimate: number;
  /** 這個任務可能呼叫的所有評分者（含可能的第三位），預扣以全部加總計算最壞情況。 */
  calls: CallSpec[];
  /** 計入「每日篇數」的任務家族（null＝不限篇數）。 */
  family: TaskFamily | null;
}

/**
 * 逾時（毫秒）：OCR 90 秒、中譯英 120 秒、作文 240 秒（§6.2 第 16 條）；學習助手的轉錄與追問 90 秒、解析 180 秒
 * （題組 2 題以上 240 秒，見 taskConfig）、報告 240 秒（docs/design/learning-assistant.md §4.7.1）；作文範文與國寫範文 240 秒
 * （docs/design/model-essays.md §3.1；國寫範文設計 §6）。
 */
export const TASK_TIMEOUT_MS = {
  essay_ocr: 90_000,
  translation_grade: 120_000,
  essay_grade: 240_000,
  assist_ocr: 90_000,
  assist_analyze: 180_000,
  assist_followup: 90_000,
  assist_report: 240_000,
  essay_exemplars: 240_000,
  assist_zh_exemplar: 240_000,
} as const satisfies Record<AiTask, number>;
/** 學習助手的題組解析（2 題以上）的逾時。 */
export const ASSIST_ANALYZE_GROUP_TIMEOUT_MS = 240_000;
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

/**
 * 學習助手任務的大小（docs/design/assistant-subjects.md §2.3、§9.3）：科目、解析種類與計點單位數（assistItemCount）。
 * routes 預扣與 consumer 呼叫用同一組（存在 turn 的 meta_json），所以預扣與實際呼叫一致。沒有 subject＝英文；
 * 英文只看 items（kind 不影響英文的數字，和現行完全相同）。photos 只給轉錄用（國文 1 張 3 點、2 張 4 點）。
 */
export interface AssistTaskSize {
  items?: number;
  subject?: AssistSubject;
  kind?: AssistCaseKind;
  photos?: number;
}

/**
 * 國文的任務設定（docs/design/assistant-subjects.md §9.3，設計值）：max_tokens 由「每欄寫滿」fixture 的 tokens ÷ 0.6 推出
 * （留 40% 給思考），輸入估計用最長合法輸入實算；S3 用 count_tokens 與真模型評測實測後寫回這裡（改了 test/assist.zh.rules.test.ts 跟著改）。
 *   轉錄           8,000、輸入 7,000、90 秒（1 張 3 點、2 張 4 點）
 *   選擇 n 題      16,000＋7,500(n−1)、輸入 16,000、180 秒（n ≥ 2 是 240 秒）
 *   簡答 s 個小題  13,000＋2,900(s−1)、輸入 16,000、180 秒（s ≥ 2 是 240 秒）（設計值是＋2,600；6 個小題「每欄寫滿」的估計
 *                  超過 max_tokens 的 60%，依同一條規則調高，S3 實測後再定）
 *   國寫           16,000、輸入 13,500、240 秒
 *   追問           5,000、輸入 12,000、90 秒（上下文不加 5 分鐘快取標記，§3.5）
 *   國寫範文       20,000、輸入 13,500、240 秒、effort AI_EFFORT_ZH_EXEMPLAR（high）。2026-10-31 由 14,000、AI_EFFORT_ASSIST 改來
 *                  （範文品質：提示要模型先構思再寫，high 的思考比 medium 長）：「每欄寫滿」約 5.2k tokens，占 26%，其餘留給思考。
 *                  成本（估計，同國寫範文設計 §6 的算法）：冷快取一篇＝系統約 3.3k × 1 小時寫入＋題目約 1.3–2k × 輸入＋可見約 3k 與
 *                  思考約 7k（medium 的估計是 4k）× 輸出 ≈ US$0.23，重寫 10–15% 後約 0.26–0.27。8 點時每點 0.033–0.034，超過
 *                  WORST_USD_PER_POINT（0.0271）；10 點時 0.026–0.027，所以點數改 10（試用帳號每天 10 點仍然看得了一篇）。
 * 點數一律由 shared 的 assistPoints 算（前端顯示、預扣同一份常數）；國寫範文是 AI_TASK_POINTS.assist_zh_exemplar（10 點）。
 */
export const ZH_TASK_SIZES = {
  ocr: { maxTokens: 8_000, input: 7_000, timeoutMs: 90_000 },
  zh_choice: { maxTokens: 16_000, perExtra: 7_500, input: 16_000 },
  zh_short: { maxTokens: 13_000, perExtra: 2_900, input: 16_000 },
  zh_writing: { maxTokens: 16_000, perExtra: 0, input: 13_500 },
  followup: { maxTokens: 5_000, input: 12_000, timeoutMs: 90_000 },
  exemplar: { maxTokens: 20_000, input: 13_500, timeoutMs: 240_000 },
} as const;

/** 國文解析的 max_tokens、輸入估計與逾時（n＝計點單位數，夾到 1 以上）。 */
export function zhAnalyzeSize(kind: ZhCaseKind, items: number): { maxTokens: number; input: number; timeoutMs: number } {
  const n = Math.max(1, Math.floor(items));
  const t = ZH_TASK_SIZES[kind];
  const timeoutMs = kind === 'zh_writing' || n >= 2 ? ASSIST_ANALYZE_GROUP_TIMEOUT_MS : TASK_TIMEOUT_MS.assist_analyze;
  return { maxTokens: t.maxTokens + t.perExtra * (n - 1), input: t.input, timeoutMs };
}

/** 國文的轉錄、解析與追問（英文以外的科目；第一版只有國文）。 */
function zhAssistConfig(task: 'assist_ocr' | 'assist_analyze' | 'assist_followup', config: AppConfig, size: AssistTaskSize): TaskConfig {
  const { models, effort } = config.ai;
  const base = { task, target: { kind: 'assist_turn' } as const, maxRetries: SDK_MAX_RETRIES };
  if (task === 'assist_ocr') {
    const photos = size.photos === 2 ? 2 : 1;
    const t = ZH_TASK_SIZES.ocr;
    return {
      ...base,
      points: assistPoints('chinese', 'assist_ocr', { photos }),
      timeoutMs: t.timeoutMs,
      inputTokensEstimate: t.input,
      calls: [{ role: 'ocr', model: models.default, effort: effort.ocr, maxTokens: t.maxTokens, framework: 'ocr', systemCacheTtl: '1h' }],
      family: ASSIST_OCR_FAMILY,
    };
  }
  if (task === 'assist_followup') {
    const t = ZH_TASK_SIZES.followup;
    return {
      ...base,
      points: assistPoints('chinese', 'assist_followup'),
      timeoutMs: t.timeoutMs,
      inputTokensEstimate: t.input,
      calls: [{ role: 'tutor', model: models.default, effort: effort.chat, maxTokens: t.maxTokens, framework: 'assist', systemCacheTtl: '1h' }],
      family: null,
    };
  }
  const kind: ZhCaseKind = size.kind !== undefined && isZhCaseKind(size.kind) ? size.kind : 'zh_choice';
  const items = Math.max(1, Math.floor(size.items ?? 1));
  const t = zhAnalyzeSize(kind, items);
  return {
    ...base,
    points: assistPoints('chinese', 'assist_analyze', { kind, items }),
    timeoutMs: t.timeoutMs,
    inputTokensEstimate: t.input,
    calls: [{ role: 'tutor', model: models.default, effort: effort.assist, maxTokens: t.maxTokens, framework: 'assist', systemCacheTtl: '1h' }],
    family: null,
  };
}

/**
 * 任務設定。size 只給學習助手用：英文的 assist_analyze 看 { items }（這次問了幾題）：點數、max_tokens、輸入估計與逾時依題數算
 * （單字案例固定用 1 題的值，呼叫端傳 items: 1）；英文的其他任務忽略 size。英文以外的科目（size.subject，第一版只有國文）
 * 的轉錄、解析、追問走 zhAssistConfig（docs/design/assistant-subjects.md §9.3）。其他任務忽略 size。
 * 學習助手的 max_tokens 與輸入估計是設計值（§4.7.1），WP-A2／WP-C 用 count_tokens 實測後定案、寫回這裡。
 */
export function taskConfig(task: AiTask, config: AppConfig, size?: AssistTaskSize): TaskConfig {
  const { models, effort } = config.ai;
  if (size?.subject !== undefined && size.subject !== 'english' && (task === 'assist_ocr' || task === 'assist_analyze' || task === 'assist_followup')) {
    return zhAssistConfig(task, config, size);
  }
  switch (task) {
    case 'translation_grade':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'submission', submissionKind: 'translation' },
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
        target: { kind: 'submission', submissionKind: 'essay' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        inputTokensEstimate: 6_000,
        calls: [
          { role: 'primary', model: models.default, effort: effort.grade, maxTokens: 12_000, framework: 'analytic' },
          { role: 'second', model: models.secondRater, effort: effort.grade, maxTokens: 4_000, framework: 'holistic' },
          { role: 'third', model: models.default, effort: effort.grade, maxTokens: 4_000, framework: 'holistic' },
        ],
        family: ESSAY_FAMILY,
      };
    case 'essay_ocr':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'submission', submissionKind: 'essay' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 兩張長邊 1600 px 的照片各約 2,500 tokens，加上提示詞。
        inputTokensEstimate: 6_000,
        calls: [{ role: 'ocr', model: models.default, effort: effort.ocr, maxTokens: 3_000, framework: 'ocr' }],
        family: null,
      };
    // ── 學習助手（docs/design/learning-assistant.md §4.7.1）。模型一律 AI_MODEL_DEFAULT；系統提示用 1 小時快取。──
    case 'assist_ocr':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'assist_turn' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 1–2 張照片（各約 2,500 tokens）加上轉錄的系統提示。
        inputTokensEstimate: 6_500,
        calls: [{ role: 'ocr', model: models.default, effort: effort.ocr, maxTokens: 6_000, framework: 'ocr', systemCacheTtl: '1h' }],
        family: ASSIST_OCR_FAMILY,
      };
    case 'assist_analyze': {
      // 題組每多一題：點數 +2（最多 14）、max_tokens +4,000、輸入 +1,000；2 題以上逾時 240 秒。
      const n = Math.max(1, Math.floor(size?.items ?? 1));
      return {
        task,
        points: assistAnalyzePoints('item', n),
        target: { kind: 'assist_turn' },
        timeoutMs: n >= 2 ? ASSIST_ANALYZE_GROUP_TIMEOUT_MS : TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        inputTokensEstimate: 10_000 + 1_000 * (n - 1),
        calls: [{ role: 'tutor', model: models.default, effort: effort.assist, maxTokens: 16_000 + 4_000 * (n - 1), framework: 'assist', systemCacheTtl: '1h' }],
        family: null,
      };
    }
    case 'assist_followup':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'assist_turn' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 系統提示＋上下文 block（題目、解析摘要）＋對話（≤ 3,000 字元）＋這一輪的問題。
        inputTokensEstimate: 14_000,
        calls: [{ role: 'tutor', model: models.default, effort: effort.chat, maxTokens: 5_000, framework: 'assist', systemCacheTtl: '1h' }],
        family: null,
      };
    case 'assist_report':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'assist_report' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        inputTokensEstimate: 17_000,
        calls: [{ role: 'tutor', model: models.default, effort: effort.assist, maxTokens: 22_000, framework: 'assist', systemCacheTtl: '1h' }],
        family: ASSIST_REPORT_FAMILY,
      };
    // ── 作文範文（docs/design/model-essays.md §3.1）：一次呼叫寫三篇。模型一律 AI_MODEL_DEFAULT；系統提示用 1 小時快取。──
    case 'essay_exemplars':
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'exemplar_set' },
        timeoutMs: TASK_TIMEOUT_MS[task],
        maxRetries: SDK_MAX_RETRIES,
        // 系統提示約 2.4k（估計）＋題目與目標最多約 1.5k（自訂題 1,200 字元）＋餘裕。設計值：E2 用 count_tokens 量最長的合法輸入後定案。
        inputTokensEstimate: 5_000,
        // 16,000（含思考）：可見輸出全部欄位寫滿約 6.9k（估計），其餘留給思考。設計值：smoke test 量到思考的 p99 後定案。
        // 預扣＝5,000 × 1 小時快取寫入單價＋16,000 × 輸出單價（一次產生；內容失敗最多付費產生 2 次，callPolicy.ts 的 contentAttempts）。
        calls: [{ role: 'writer', model: models.default, effort: effort.exemplars, maxTokens: 16_000, framework: 'exemplar', systemCacheTtl: '1h' }],
        // 點數已經限制每天的組數；另有每天建立 20 組的上限（docs/design/model-essays.md §4.2）。
        family: null,
      };
    // ── 學習助手的國寫範文（國寫範文設計 §6）：一次呼叫寫一篇整篇示範與標注。對象是 assist_turns 的一列（kind 是 followup）。──
    case 'assist_zh_exemplar': {
      const t = ZH_TASK_SIZES.exemplar;
      return {
        task,
        points: AI_TASK_POINTS[task],
        target: { kind: 'assist_turn' },
        timeoutMs: t.timeoutMs,
        maxRetries: SDK_MAX_RETRIES,
        // 系統提示約 3.3k＋題目（最長 6,000 字約 7.8k）＋國寫指導摘要 ≤ 1.3k＋<task>（預扣＝13,500 × 1 小時快取寫入單價＋20,000 × 輸出單價）。
        inputTokensEstimate: t.input,
        calls: [{ role: 'writer', model: models.default, effort: effort.zhExemplar, maxTokens: t.maxTokens, framework: 'exemplar', systemCacheTtl: '1h' }],
        family: ASSIST_ZH_EXEMPLAR_FAMILY,
      };
    }
  }
}

/** 學習助手家族的每日上限（UserLimits.familyCaps；設計值在 ASSIST_LIMITS）。 */
export const ASSIST_FAMILY_DAY_CAPS = {
  assist_report: ASSIST_LIMITS.reportsPerDay,
  assist_ocr: ASSIST_LIMITS.ocrPerDay,
  assist_zh_exemplar: ASSIST_LIMITS.zhExemplarsPerDay,
} as const;

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
