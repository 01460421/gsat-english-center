// deploy-summary.mjs 的型別宣告（apps/api/test/deploy-summary.test.ts 匯入用；腳本本身是零依賴的 Node ESM）。
export interface DeploySummaryInput {
  features: {
    auth?: boolean;
    ai?: boolean;
    ocr?: boolean;
    aiPaused?: boolean;
    customEssay?: boolean;
    assistant?: boolean;
    assistantPhoto?: boolean;
    essayExemplars?: boolean;
    assistantSubjects?: Array<{ subject: string; photo: boolean }>;
  };
  secretNames: string[];
  proxy: string;
  vercelTarget: string;
  appUrl: string;
  workerUrl: string;
  workerName: string;
  subdomain: string;
  customEssayVar: string | null;
  /** wrangler.toml 的 AI_ASSISTANT、AI_ASSISTANT_PHOTO（沒有那一行或省略＝null，Worker 用預設值 off）。 */
  assistantVar?: string | null;
  assistantPhotoVar?: string | null;
  /** wrangler.toml 的 AI_ESSAY_EXEMPLARS（沒有那一行或省略＝null，Worker 用預設值 off）。 */
  exemplarsVar?: string | null;
  /** wrangler.toml 的 AI_ASSISTANT_SUBJECTS、AI_ASSISTANT_SUBJECTS_PHOTO（沒有那一行或省略＝null，Worker 用預設值 off）。 */
  subjectsVar?: string | null;
  subjectsPhotoVar?: string | null;
}

export type AssistantMode = 'off' | 'admin' | 'on';

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
export declare const ASSISTANT_DEFAULT: string;
export declare function assistantVarsFrom(wranglerToml: string): { assistant: string | null; photo: string | null };
export declare function assistantMode(value: string | null | undefined): AssistantMode;
export declare const EXEMPLARS_DEFAULT: string;
export declare function exemplarsVarFrom(wranglerToml: string): string | null;
export declare function exemplarsMode(value: string | null | undefined): AssistantMode;
export declare const SUBJECTS_DEFAULT: string;
export declare function subjectsVarsFrom(wranglerToml: string): { subjects: string | null; photo: string | null };
export declare function subjectsMode(value: string | null | undefined): AssistantMode;
export declare function buildDeploySummary(input: DeploySummaryInput): DeploySummary;
