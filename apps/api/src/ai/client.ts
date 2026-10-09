/**
 * Claude 呼叫：請求建構（§6.2 呼叫規則的唯一出口）、串流取 finalMessage、stop_reason 與 usage 的解讀、錯誤分類。
 * 負責：後端 AI A2。
 *
 * ARCHITECTURE §6.2 對應（test/ai.rules.test.ts 逐條掃描 buildClaudeRequest 的輸出）：
 *   1  模型 ID 必須明列在價格表（完全比對），否則拒絕呼叫（fail closed）
 *   2  不送 temperature／top_p／top_k、強制 tool_choice、assistant 預填（messages 只有一則 user）
 *   3  不送 thinking（Opus 5.5 一律 adaptive）；每個任務明確設定 output_config.effort
 *   4  max_tokens 含思考空間；stop_reason='max_tokens' 由呼叫端重試一次
 *   5  output_config.format＝SDK 的 betaZodOutputFormat 產生的 JSON schema（剝除不支援的約束）；
 *      只送 { type, schema }、不帶 SDK 的自動解析：先檢查 stop_reason 再用完整的 zod schema 驗證，
 *      拒答或截斷時才不會在 SDK 裡丟出解析錯誤、拿不到 usage
 *   6  schema 欄位名稱不含 reasoning 類字樣（說明欄位叫 explanation_zh）
 *   7  fallbacks: 'default' ＋ beta 標頭 server-side-fallback-2026-07-01（模型支援時；走 client.beta.messages）
 *   8  每次回應檢查 stop_reason；拒答記 stop_details.category；served_model＝實際服務的模型
 *   9  成本依 usage.iterations 逐次加總，5 分鐘與 1 小時快取寫入分開計價（pricing.ts）
 *   12 學生文字包在 <student_text>、系統提示寫明標籤內是資料（prompts/common.ts）
 *   13 只送題目、評分基準、學生文字（OCR 另加照片）；不送 metadata.user_id 或任何身分資訊
 *   14 可快取的系統提示放最前面（cache_control）；prompt_version＝內容 sha256 前 12 碼
 *   16 逾時依任務、maxRetries 2；串流另設總期限＝逾時 ×（重試＋1）（SDK 的 timeout 只管到回應標頭）；
 *      429 enforced_spend_limit_reached 不重試（fetch 包裝加上 x-should-retry: false）。
 *      SDK 的 maxRetries 只管收到回應標頭之前的錯誤：串流中途的 SSE error 事件（overloaded_error 等）與讀到一半斷線
 *      由 classifyError 判成可重試，交給 Queue 重送（§3.4 第 12 步）。
 * 呼叫失敗也記帳：串流已經開始（收到 message_start）時，用它的 usage 加上已收到的文字估計輸出，照實記成本
 * （§6.2 第 9、10 條；Anthropic 已經處理了輸入）。還沒收到回應的 HTTP 錯誤不收費，記 0。
 */
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AiRefundReason, AiTask } from '@gsat/shared';
import type * as z from 'zod/v4';
import { promptVersionOf } from './prompts/common';
import { costOfUsage, PRICING_VERSION, pricingOf, type UsageEntry } from './pricing';
import type { CallSpec } from './tasks';

/** server-side fallback 的 beta 標頭（§6.2 第 7 條；搭配 fallbacks: 'default'）。 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** schema 欄位名稱禁用字（§6.2 第 6 條）。 */
export const FORBIDDEN_SCHEMA_WORDS = ['reasoning', 'chain_of_thought', 'chainofthought', 'step_by_step', 'thinking', 'thought', 'rationale'];

export interface ClaudeCallInput {
  task: AiTask;
  spec: CallSpec;
  timeoutMs: number;
  maxRetries: number;
  /** 固定的系統提示（評分基準在內；放可快取前綴）。 */
  system: string;
  /** 完整的 zod schema：送出時轉成 JSON schema，回應再用它完整驗證。 */
  schema: z.ZodType;
  /** user 訊息內容（題目＋<student_text>；OCR 是照片＋文字）。 */
  content: string | BetaContentBlockParam[];
  /** 使用者訊息範本版本（算 prompt_version 用）。 */
  templateVersion: string;
}

export interface BuiltRequest {
  params: BetaMessageStreamParams;
  options: { timeout: number; maxRetries: number };
  promptVersion: string;
  images: number;
}

/** 模型不在價格表：拒絕呼叫（不可重試；任務退還並告警）。 */
export class ModelNotAllowedError extends Error {
  constructor(readonly model: string) {
    super(`模型 ${model} 不在價格表，拒絕呼叫`);
  }
}

/** 送出的 JSON schema（SDK 的轉換結果）。 */
export function outgoingJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return betaZodOutputFormat(schema).schema as Record<string, unknown>;
}

/** 建構請求（純函式，除了 prompt_version 的雜湊）。所有 Claude 呼叫都必須經過這裡。 */
export async function buildClaudeRequest(input: ClaudeCallInput): Promise<BuiltRequest> {
  const { spec } = input;
  const pricing = pricingOf(spec.model);
  if (!pricing) throw new ModelNotAllowedError(spec.model);
  const jsonSchema = outgoingJsonSchema(input.schema);
  const promptVersion = await promptVersionOf([input.system, JSON.stringify(jsonSchema), input.templateVersion, spec.framework]);
  const images = Array.isArray(input.content) ? input.content.filter((b) => b.type === 'image').length : 0;
  const params: BetaMessageStreamParams = {
    model: spec.model,
    max_tokens: spec.maxTokens,
    // 可快取前綴：系統提示＋評分基準（內容固定，變動的題目與學生文字都在 user 訊息）。
    system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: input.content }],
    output_config: { effort: spec.effort, format: { type: 'json_schema', schema: jsonSchema } },
    ...(pricing.serverFallback ? { fallbacks: 'default' as const, betas: [FALLBACK_BETA] } : {}),
  };
  return { params, options: { timeout: input.timeoutMs, maxRetries: input.maxRetries }, promptVersion, images };
}

/** ai_calls 一列（只有數字與代碼，不含提示詞與回應內容，§6.5）。 */
export interface CallRecord {
  task: AiTask;
  role: string;
  model: string;
  servedModel: string | null;
  effort: string;
  promptVersion: string;
  pricingVersion: string;
  requestId: string | null;
  stopReason: string | null;
  refusalCategory: string | null;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  images: number;
  costMicros: number;
  pricePending: boolean;
  latencyMs: number;
  errorCode: string | null;
}

export type CallOutcome =
  | { kind: 'ok'; data: unknown; record: CallRecord }
  | { kind: 'refusal'; category: string | null; record: CallRecord }
  | { kind: 'max_tokens'; record: CallRecord }
  | { kind: 'invalid'; issue: string; record: CallRecord }
  | { kind: 'error'; retryable: boolean; reason: AiRefundReason; spendLimit: boolean; configProblem: boolean; record: CallRecord };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * 包一層 fetch：Anthropic 回 429 且是級距月上限（enforced_spend_limit_reached）時加上 x-should-retry: false，
 * SDK 就不會自動重試（§6.2 第 16 條；下個月 1 日前都會失敗，重試只是浪費時間）。
 */
export function spendLimitAwareFetch(base: FetchLike): FetchLike {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 429) return res;
    const body = await res.clone().text();
    if (!body.includes('enforced_spend_limit_reached')) return res;
    const headers = new Headers(res.headers);
    headers.set('x-should-retry', 'false');
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  };
}

/** 建立 SDK client。fetchImpl 只給測試注入假回應；正式環境用全域 fetch。 */
export function createAnthropicClient(options: { apiKey: string; baseURL: string; fetchImpl?: FetchLike }): Anthropic {
  const base: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  return new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    fetch: spendLimitAwareFetch(base) as unknown as ClientOptions['fetch'],
    // 逾時與重試由每個請求的 options 決定（buildClaudeRequest）。
    maxRetries: 2,
  });
}

/** usage → 各次嘗試（有 iterations 就逐筆；沒有就用整體 usage 與實際服務的模型）。 */
export function usageEntries(message: BetaMessage, requestedModel: string): UsageEntry[] {
  const u = message.usage;
  const entries: UsageEntry[] = [];
  for (const it of u.iterations ?? []) {
    if (it.type !== 'message' && it.type !== 'fallback_message' && it.type !== 'advisor_message') continue;
    const cc = it.cache_creation;
    entries.push({
      model: it.model ?? requestedModel,
      inputTokens: it.input_tokens,
      outputTokens: it.output_tokens,
      cacheReadTokens: it.cache_read_input_tokens,
      cacheWrite5mTokens: cc ? cc.ephemeral_5m_input_tokens : it.cache_creation_input_tokens,
      cacheWrite1hTokens: cc ? cc.ephemeral_1h_input_tokens : 0,
    });
  }
  if (entries.length > 0) return entries;
  const cc = u.cache_creation;
  return [
    {
      model: message.model || requestedModel,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWrite5mTokens: cc ? cc.ephemeral_5m_input_tokens : (u.cache_creation_input_tokens ?? 0),
      cacheWrite1hTokens: cc ? cc.ephemeral_1h_input_tokens : 0,
    },
  ];
}

/**
 * 回應裡可能是結構化輸出的文字，依序嘗試（server-side fallback 中途接手時有兩種可能）：
 *   1. 全部 text 區塊依序接起來：中途拒答時，被拒答模型已輸出的文字是接手模型的續寫起點（continuation context），
 *      完整的 JSON ＝ 片段＋續寫；沒有 fallback 時也就是整段輸出。
 *   2. 最後一個 fallback 區塊之後的文字：接手模型從頭重寫的情況。
 * 沒有 fallback 區塊時兩者相同，只回一個。
 */
export function responseTexts(content: BetaContentBlock[]): string[] {
  const textOf = (blocks: BetaContentBlock[]) => blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let lastFallback = -1;
  content.forEach((b, i) => {
    if (b.type === 'fallback') lastFallback = i;
  });
  const all = textOf(content);
  if (lastFallback < 0) return [all];
  const tail = textOf(content.slice(lastFallback + 1));
  return tail === all ? [all] : [all, tail];
}

function baseRecord(input: ClaudeCallInput, built: BuiltRequest, latencyMs: number): CallRecord {
  return {
    task: input.task,
    role: input.spec.role,
    model: input.spec.model,
    servedModel: null,
    effort: input.spec.effort,
    promptVersion: built.promptVersion,
    pricingVersion: PRICING_VERSION,
    requestId: null,
    stopReason: null,
    refusalCategory: null,
    iterations: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    images: built.images,
    costMicros: 0,
    pricePending: false,
    latencyMs,
    errorCode: null,
  };
}

/**
 * 串流中途 SSE error 事件的錯誤類型：請求或設定本身有問題（重送也一樣）。其他類型（overloaded_error、api_error、
 * rate_limit_error、timeout_error，以及不認得的）都當成暫時性的，交給 Queue 重送。
 */
const CONFIG_STREAM_ERROR_TYPES = new Set(['invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error', 'billing_error', 'request_too_large']);

/** APIError 的錯誤類型（SDK 的 type，或回應本體的 error.type）。 */
function apiErrorType(err: InstanceType<typeof Anthropic.APIError>): string | null {
  if (err.type) return err.type;
  const body = err.error as { error?: { type?: unknown }; type?: unknown } | undefined;
  const nested = body?.error?.type;
  if (typeof nested === 'string') return nested;
  return null;
}

/** 錯誤分類：由最具體的 SDK 錯誤類別開始判斷（§6.2 第 16 條）。 */
export function classifyError(err: unknown): { retryable: boolean; reason: AiRefundReason; spendLimit: boolean; configProblem: boolean; code: string } {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { retryable: true, reason: 'timeout', spendLimit: false, configProblem: false, code: 'timeout' };
  if (err instanceof Anthropic.APIUserAbortError) return { retryable: true, reason: 'timeout', spendLimit: false, configProblem: false, code: 'aborted' };
  if (err instanceof Anthropic.APIConnectionError) return { retryable: true, reason: 'api_error', spendLimit: false, configProblem: false, code: 'connection' };
  if (err instanceof Anthropic.RateLimitError) {
    const body = JSON.stringify(err.error ?? null);
    if (body.includes('enforced_spend_limit_reached') || err.message.includes('enforced_spend_limit_reached')) {
      return { retryable: false, reason: 'paused', spendLimit: true, configProblem: false, code: 'spend_limit' };
    }
    return { retryable: true, reason: 'api_error', spendLimit: false, configProblem: false, code: 'rate_limit' };
  }
  if (err instanceof Anthropic.InternalServerError) return { retryable: true, reason: 'api_error', spendLimit: false, configProblem: false, code: `http_${err.status}` };
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return { retryable: false, reason: 'api_error', spendLimit: false, configProblem: true, code: `http_${err.status}` };
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) {
    return { retryable: false, reason: 'api_error', spendLimit: false, configProblem: true, code: `http_${err.status}` };
  }
  if (err instanceof Anthropic.APIError) {
    if (typeof err.status !== 'number') {
      // 串流中途的 SSE error 事件（HTTP 已經是 200，SDK 丟出 status 為 undefined 的 APIError）：依錯誤類型判斷。
      const type = apiErrorType(err);
      const code = `stream_${type ?? 'error'}`.slice(0, 64);
      if (type === 'rate_limit_error' && (JSON.stringify(err.error ?? null).includes('enforced_spend_limit_reached') || err.message.includes('enforced_spend_limit_reached'))) {
        return { retryable: false, reason: 'paused', spendLimit: true, configProblem: false, code: 'spend_limit' };
      }
      if (type !== null && CONFIG_STREAM_ERROR_TYPES.has(type)) return { retryable: false, reason: 'api_error', spendLimit: false, configProblem: true, code };
      // 暫時性錯誤與不認得的類型都交給 Queue 重送（最多 4 次投遞，之後退還）。
      return { retryable: true, reason: 'api_error', spendLimit: false, configProblem: false, code };
    }
    const status = err.status;
    const retryable = status === 408 || status === 409 || status >= 500;
    return { retryable, reason: 'api_error', spendLimit: false, configProblem: false, code: `http_${status}` };
  }
  if (err instanceof ModelNotAllowedError) return { retryable: false, reason: 'internal', spendLimit: false, configProblem: true, code: 'model_not_allowed' };
  if (err instanceof Anthropic.AnthropicError) {
    // SDK 把串流途中的其他錯誤包成基底類別：讀到一半斷線（cause 是 workerd／undici 的 TypeError 等）、
    // 或串流沒有送完就結束。都是暫時性的，交給 Queue 重送。
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error || /stream ended|terminated|network|connection|socket/i.test(err.message)) {
      return { retryable: true, reason: 'api_error', spendLimit: false, configProblem: false, code: 'stream_interrupted' };
    }
  }
  return { retryable: false, reason: 'internal', spendLimit: false, configProblem: false, code: 'internal' };
}

/** 已收到的輸出文字（text 與 thinking 區塊）估計的輸出 tokens（英文約 4 字元一個 token，取保守的 3）。 */
function estimateOutputTokens(message: BetaMessage): number {
  let chars = 0;
  for (const block of message.content ?? []) {
    if (block.type === 'text') chars += block.text.length;
    else if (block.type === 'thinking') chars += block.thinking.length;
  }
  return Math.ceil(chars / 3);
}

/**
 * 串流中途失敗或被中止時的部分用量：message_start 帶有完整的輸入與快取 tokens；輸出只有 message_start 的占位值，
 * 所以取它和「已收到的文字估計」的較大者（思考過程沒有串流出來的部分估不到，由每日對帳補正）。
 * 還沒收到 message_start（HTTP 錯誤、連線失敗）就不收費，維持 0。
 */
export function applyPartialUsage(record: CallRecord, snapshot: BetaMessage | undefined, requestedModel: string): void {
  if (!snapshot?.usage) return;
  const partial: BetaMessage = {
    ...snapshot,
    usage: { ...snapshot.usage, output_tokens: Math.max(snapshot.usage.output_tokens ?? 0, estimateOutputTokens(snapshot)) },
  };
  const cost = costOfUsage(usageEntries(partial, requestedModel));
  record.servedModel = snapshot.model || null;
  record.iterations = cost.attempts;
  record.inputTokens = cost.totals.inputTokens;
  record.outputTokens = cost.totals.outputTokens;
  record.cacheReadTokens = cost.totals.cacheReadTokens;
  record.cacheWrite5mTokens = cost.totals.cacheWrite5mTokens;
  record.cacheWrite1hTokens = cost.totals.cacheWrite1hTokens;
  record.costMicros = cost.costMicros;
  record.pricePending = cost.pricePending;
}

/** 一次呼叫（含 SDK 自動重試）最長可以花多久：逾時 ×（重試＋1）（§6.2 第 16 條）。 */
export function callDeadlineMs(input: Pick<ClaudeCallInput, 'timeoutMs' | 'maxRetries'>): number {
  return input.timeoutMs * (input.maxRetries + 1);
}

/**
 * 呼叫一次 Claude（串流取 finalMessage），回傳結果與 ai_calls 用的紀錄。不丟錯：所有情況都轉成 CallOutcome，
 * 呼叫端依 kind 決定重試、退還或寫入批改。
 */
export async function executeClaudeCall(client: Anthropic, input: ClaudeCallInput, built: BuiltRequest, now: () => number = Date.now): Promise<CallOutcome> {
  const started = now();
  let message: BetaMessage;
  let requestId: string | null = null;
  // SDK 的 timeout 只管到回應標頭（串流本身卡住不會逾時），所以另外設一個總期限：
  // 逾時 ×（重試＋1），也就是 §6.2 第 16 條算的最壞牆鐘。到期中止 → APIUserAbortError → 當成可重試的逾時。
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), callDeadlineMs(input));
  let stream: ReturnType<typeof client.beta.messages.stream> | null = null;
  try {
    stream = client.beta.messages.stream(built.params, { ...built.options, signal: controller.signal });
    message = await stream.finalMessage();
    requestId = stream.request_id ?? null;
  } catch (err) {
    const c = classifyError(err);
    const record: CallRecord = { ...baseRecord(input, built, now() - started), errorCode: c.code };
    if (err instanceof Anthropic.APIError) record.requestId = err.requestID ?? null;
    record.requestId ??= stream?.request_id ?? null;
    applyPartialUsage(record, stream?.currentMessage, input.spec.model);
    return { kind: 'error', retryable: c.retryable, reason: c.reason, spendLimit: c.spendLimit, configProblem: c.configProblem, record };
  } finally {
    clearTimeout(deadline);
  }

  const entries = usageEntries(message, input.spec.model);
  const cost = costOfUsage(entries);
  const record: CallRecord = {
    ...baseRecord(input, built, now() - started),
    servedModel: message.model || null,
    requestId,
    stopReason: message.stop_reason,
    refusalCategory: message.stop_reason === 'refusal' ? (message.stop_details?.category ?? 'unknown') : null,
    iterations: cost.attempts,
    inputTokens: cost.totals.inputTokens,
    outputTokens: cost.totals.outputTokens,
    cacheReadTokens: cost.totals.cacheReadTokens,
    cacheWrite5mTokens: cost.totals.cacheWrite5mTokens,
    cacheWrite1hTokens: cost.totals.cacheWrite1hTokens,
    costMicros: cost.costMicros,
    pricePending: cost.pricePending,
  };

  if (message.stop_reason === 'refusal') return { kind: 'refusal', category: record.refusalCategory, record };
  if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens', record };
  if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') {
    return { kind: 'invalid', issue: `stop_reason=${String(message.stop_reason)}`, record: { ...record, errorCode: 'unexpected_stop' } };
  }
  let schemaIssue: string | null = null;
  for (const text of responseTexts(message.content)) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const parsed = input.schema.safeParse(json);
    if (parsed.success) return { kind: 'ok', data: parsed.data, record };
    schemaIssue ??= parsed.error.message.slice(0, 500);
  }
  if (schemaIssue !== null) return { kind: 'invalid', issue: schemaIssue, record: { ...record, errorCode: 'schema_mismatch' } };
  return { kind: 'invalid', issue: '回應不是合法的 JSON', record: { ...record, errorCode: 'invalid_json' } };
}
