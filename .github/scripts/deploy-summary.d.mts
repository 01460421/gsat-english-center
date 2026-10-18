// deploy-summary.mjs 的型別宣告（apps/api/test/deploy-summary.test.ts 匯入用；腳本本身是零依賴的 Node ESM）。
export interface DeploySummaryInput {
  features: { auth?: boolean; ai?: boolean; ocr?: boolean; aiPaused?: boolean; customEssay?: boolean };
  secretNames: string[];
  proxy: string;
  vercelTarget: string;
  appUrl: string;
  workerUrl: string;
  workerName: string;
  subdomain: string;
  customEssayVar: string | null;
}

export interface DeploySummary {
  rows: Array<[string, string]>;
  warnings: string[];
  notices: string[];
  next: string[];
  markdown: string;
}

export declare const CUSTOM_ESSAY_DEFAULT: string;
export declare function customEssayVarFrom(wranglerToml: string): string | null;
export declare function customEssayExpected(value: string | null): boolean;
export declare function buildDeploySummary(input: DeploySummaryInput): DeploySummary;
