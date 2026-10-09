/**
 * 價格表與成本計算（ARCHITECTURE §6.5；§6.2 第 1、9 條）。負責：後端 AI A2。
 *
 * - 每個模型 ID 明列，**不用前綴比對**：不認得的模型拒絕呼叫（fail closed，§6.2 第 1 條；
 *   Sekai 的前綴比對會把 Opus 5.5 算成 Opus 5 的價格）。
 * - 金額一律整數：單價存「每個 token 幾奈美元」（＝每百萬 tokens 幾美元 × 1000），這樣 Haiku 的 0.125 美元／百萬
 *   也是整數；一次呼叫加總成奈美元後**無條件進位**成微美元（帳本寧可多記一點，不要少記）。
 * - 成本依 usage.iterations 逐次加總（server-side fallback 時每一次嘗試各用自己模型的單價）；
 *   5 分鐘與 1 小時快取寫入分開計價（§6.2 第 9 條）。
 * - 價格調整時新增一版 PRICING_VERSION，舊帳不重算（ai_calls.pricing_version）。
 */

/** 價格表版本（2026-10-08 版，06 §1.2）。改價格就改這個字串。 */
export const PRICING_VERSION = '2026-10-08';

/** 單價（奈美元／token）。 */
export interface ModelRates {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  batchInput: number;
  batchOutput: number;
}

export interface ModelPricing {
  /** 一般單價。 */
  base: ModelRates;
  /** 長提示詞的單價與門檻（Haiku 5.5：prompt >100K tokens 改用較高單價）。 */
  long?: { thresholdTokens: number; rates: ModelRates };
  /** 是否支援 server-side fallback（§6.2 第 7 條：Haiku 5.5 沒有，要自己重送）。 */
  serverFallback: boolean;
}

/** 每百萬 tokens 幾美元 → 每 token 幾奈美元。 */
function rates(input: number, output: number, w5m: number, w1h: number, read: number, bIn: number, bOut: number): ModelRates {
  const n = (usdPerMTok: number) => Math.round(usdPerMTok * 1000);
  return {
    input: n(input),
    output: n(output),
    cacheWrite5m: n(w5m),
    cacheWrite1h: n(w1h),
    cacheRead: n(read),
    batchInput: n(bIn),
    batchOutput: n(bOut),
  };
}

/**
 * 價格表（美元／百萬 tokens，ARCHITECTURE §6.5）。fallback 由伺服器依拒答類別選擇接手模型，
 * 所以要涵蓋所有可能接手的模型；仍查不到時記 price_pending（見 costOfUsage）。
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({
  'claude-opus-5-5': { base: rates(4, 20, 5, 8, 0.2, 2, 10), serverFallback: true },
  'claude-sonnet-5-5': { base: rates(2, 10, 2.5, 4, 0.1, 1, 5), serverFallback: true },
  'claude-haiku-5-5': {
    base: rates(0.1, 0.5, 0.125, 0.2, 0.01, 0.05, 0.25),
    long: { thresholdTokens: 100_000, rates: rates(0.5, 2.5, 0.625, 1, 0.05, 0.25, 1.25) },
    serverFallback: false,
  },
});

/** 模型 ID 是否明列在價格表（完全比對）。 */
export function isPricedModel(model: string): boolean {
  return Object.hasOwn(MODEL_PRICING, model);
}

/** 取價格；不認得回 null（呼叫端必須拒絕呼叫或記 price_pending）。 */
export function pricingOf(model: string): ModelPricing | null {
  return isPricedModel(model) ? (MODEL_PRICING[model] ?? null) : null;
}

/** 奈美元 → 微美元（無條件進位）。 */
export function nanoToMicros(nano: number): number {
  return Math.ceil(nano / 1000);
}

/** 一次嘗試的 token 用量（usage.iterations 的一筆，或沒有 iterations 時的整體 usage）。 */
export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

export interface UsageCost {
  costMicros: number;
  /** 有任何一筆嘗試的模型不在價格表：那一筆成本先記 0、整列標 price_pending，並告警。 */
  pricePending: boolean;
  totals: Omit<UsageEntry, 'model'>;
  attempts: number;
}

/** 依各次嘗試加總成本（線上通道）。 */
export function costOfUsage(entries: UsageEntry[]): UsageCost {
  let nano = 0;
  let pricePending = false;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
  for (const e of entries) {
    totals.inputTokens += e.inputTokens;
    totals.outputTokens += e.outputTokens;
    totals.cacheReadTokens += e.cacheReadTokens;
    totals.cacheWrite5mTokens += e.cacheWrite5mTokens;
    totals.cacheWrite1hTokens += e.cacheWrite1hTokens;
    const p = pricingOf(e.model);
    if (!p) {
      pricePending = true;
      continue;
    }
    const promptTokens = e.inputTokens + e.cacheReadTokens + e.cacheWrite5mTokens + e.cacheWrite1hTokens;
    const r = p.long && promptTokens > p.long.thresholdTokens ? p.long.rates : p.base;
    nano +=
      e.inputTokens * r.input +
      e.outputTokens * r.output +
      e.cacheReadTokens * r.cacheRead +
      e.cacheWrite5mTokens * r.cacheWrite5m +
      e.cacheWrite1hTokens * r.cacheWrite1h;
  }
  return { costMicros: nanoToMicros(nano), pricePending, totals, attempts: Math.max(1, entries.length) };
}

/**
 * 一次呼叫最壞情況的美元（微美元，§6.4）：輸入估計 × max(輸入單價, 1 小時快取寫入單價) ＋ max_tokens × 輸出單價。
 * 不認得的模型丟錯（預扣前就要擋下，fail closed）。
 */
export function worstCaseMicros(model: string, inputTokensEstimate: number, maxTokens: number): number {
  const p = pricingOf(model);
  if (!p) throw new Error(`模型 ${model} 不在價格表`);
  // 長提示詞的單價只在超過門檻時適用；最壞情況一律取兩者較高的一組。
  const r = p.long && inputTokensEstimate > p.long.thresholdTokens ? p.long.rates : p.base;
  return nanoToMicros(inputTokensEstimate * Math.max(r.input, r.cacheWrite1h) + maxTokens * r.output);
}
