// assistant-subjects-eval-plan.mjs 的型別宣告（apps/api/test/assist-subjects.parity-summary.test.ts 與 parity 工具匯入用；腳本本身是零依賴的 Node ESM）。
export type EvalMode = 'full' | 'probe' | 'none';

export interface EvalParams {
  budget: number;
  resume: boolean;
  allowOnlineKey: boolean;
  /** 題目 id 或組別（A、B、BS、BP、C、D、E、F、G、H、J）；空陣列＝全部。 */
  cases: string[];
}

export interface EvalPlan extends EvalParams {
  mode: EvalMode;
}

export type Parsed<T> = { ok: true; params: T } | { ok: false; error: string };

export declare const RUN_FILE: string;
export declare const PROBE_PATHS: readonly string[];
export declare const RUN_KEYS: readonly string[];
export declare const BUDGET_MAX_USD: number;
export declare const DEFAULT_BUDGET_USD: number;
export declare const PROBE_BUDGET_USD: number;
export declare const GROUP_SELECTORS: readonly string[];
export declare function globToRegExp(glob: string): RegExp;
export declare function matchesProbePath(file: string): boolean;
export declare function parseBudget(raw: unknown): number | null;
export declare function parseBool(raw: unknown, fallback: boolean): boolean | null;
export declare function parseCases(raw: unknown): string[] | null;
export declare function parseRunFile(text: string): Parsed<EvalParams>;
export declare function paramsFrom(values: Record<string, string | undefined>): Parsed<EvalParams>;
export declare function decideMode(input: { event: string | undefined; ref: string | undefined; changed: readonly string[] }): EvalMode;
export declare function planEval(input: {
  event: string | undefined;
  ref: string | undefined;
  changed: readonly string[];
  inputs?: Record<string, string | undefined>;
  runFileText?: string | null;
}): { ok: true; plan: EvalPlan } | { ok: false; error: string };
export declare function planOutputLines(plan: EvalPlan): string[];
