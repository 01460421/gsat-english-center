// writing-bank.mjs 的型別宣告（給 packages/shared 的資料測試匯入用；shared 的 tsconfig 沒有 allowJs）。
import type { OfficialCorpus, SkippedFile, SkipReason } from '../../../../packages/shared/scripts/bank-select.mjs';

type JsonObject = Record<string, unknown>;
type Section = 'translation' | 'composition';

export declare const WRITING_BANK_SCRIPT: string;
export declare const WRITING_BANK_SCHEMA: 'gsat-bank-writing/v1';
export declare const PROMPT_EXCERPT_CHARS: number;
export declare const WRITING_BANNED_KEYS: string[];
export declare const WRITING_PRE_ANSWER_BANNED_KEYS: string[];
export declare const WRITING_BANK_INDEX_PATH: 'writing/bank/index.json';
export declare const WRITING_BANK_LISTS: ReadonlyArray<readonly [Section, 'basic' | 'advanced' | 'top']>;
export declare const WRITING_SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>>;
export declare class WritingBankError extends Error {}

export interface WritingBankIndexEntry {
  uid: string;
  version: number;
  section_type: Section;
  tier: string;
  topic: string | null;
}
export type WritingBankFile = { uid: string; version: number; section_type: Section } & JsonObject;

export declare function promptExcerpt(stem: string): string;
export declare function buildWritingBank(options: {
  bankDir: string;
  exams: Record<string, any>[];
  unpublishFile: string;
  repoRoot: string;
  relative?: (file: string) => string;
}): {
  index: WritingBankIndexEntry[];
  lists: Record<Section, Record<string, JsonObject[]>>;
  prompts: WritingBankFile[];
  answers: WritingBankFile[];
  inputs: string[];
  skipped: SkippedFile[];
  warnings: string[];
  scanned: number;
  corpus: OfficialCorpus;
};
export declare function writingBankPromptPath(g: { uid: string; version: number }): string;
export declare function writingBankAnswersPath(g: { uid: string; version: number }): string;
export declare function writingBankListPath(section: string, tier: string): string;
export declare function assertWritingBankOutputs(files: Map<string, string>, corpus: OfficialCorpus): void;
