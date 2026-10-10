// bank-select.mjs 的型別宣告（給 TypeScript 測試與其他套件匯入用；腳本本身是零依賴的 Node ESM、以 checkJs 檢查）。
type JsonObject = Record<string, unknown>;

export declare const BANK_SELECT_SCRIPT: string;
export declare const BANK_SCHEMA: 'gsat-bank/v1';
export declare const TIERS: readonly ['basic', 'advanced', 'top'];
export declare const WRITING_SECTION_TYPES: readonly ['translation', 'composition'];
export declare const BANK_TRANSLATION_INSTRUCTIONS: string;
export declare const BANK_ESSAY_INSTRUCTIONS: string;
export declare const BANK_FILENAME_PATTERN: RegExp;
export declare const OFFICIAL_RUN_WORDS: 7;
export declare const OFFICIAL_HAN_RUN: 8;
export declare const OFFICIAL_TRANSLATION_MIN_MATCH: 20;

export declare class BankSelectError extends Error {}

export type SkipReason =
  | 'not_verified'
  | 'checkpoint'
  | 'unsupported_section'
  | 'older_version'
  | 'withdrawn'
  | 'bad_filename'
  | 'other_schema'
  | 'unpublished'
  | 'license'
  | 'bad_shape'
  | 'd8_overlap';
export interface SkippedFile {
  file: string;
  reason: SkipReason;
}
export interface ChosenGroup {
  uid: string;
  version: number;
  file: string;
  raw: JsonObject;
}
export interface SelectResult {
  chosen: ChosenGroup[];
  skipped: SkippedFile[];
  warnings: string[];
  inputs: string[];
  scanned: number;
}
export interface UnpublishEntry {
  date: string;
  reason: string;
}
export interface NeedleIndex {
  prefix: Map<string, string[]>;
  size: number;
}
export interface OfficialCorpus {
  translationTexts: string[];
  englishRuns: Set<string>;
  hanRuns: Set<string>;
  leakFragments: string[];
  translationIndex: NeedleIndex;
  leakIndex: NeedleIndex;
}
export type D8Kind = 'translation_text' | 'english_run' | 'han_run' | 'leak_fragment';

export declare const WRITING_SKIP_REASON_LABELS: Readonly<Record<SkipReason, string>>;

export declare function listJsonFiles(dir: string): string[];
export declare function readUnpublish(file: string, options: { repoRoot: string }): Map<string, UnpublishEntry>;
export declare function selectBankGroups(
  bankDir: string,
  options: {
    sections: readonly string[];
    contentKey: (raw: JsonObject) => string | null;
    withdrawOnRejectedSameKey?: boolean;
    unpublished?: Map<string, UnpublishEntry>;
    repoRoot?: string;
    relative?: (file: string) => string;
    changeLabel?: string;
  },
): SelectResult;
export declare function writingContentKey(raw: JsonObject): string | null;
export declare function workerStrings(raw: JsonObject): { path: string; text: string }[];
export declare function writingShapeProblems(raw: JsonObject): string[];
export declare function englishWords(text: string): string[];
export declare function wordRuns(text: string, n?: number): string[];
export declare function hanWindows(text: string, n?: number): string[];
export declare function plainPassage(s: string): string;
export declare function restrictedFragments(exam: Record<string, any>): { fragments: string[]; publicTexts: string[] };
export declare function officialCorpus(exams: Record<string, any>[]): OfficialCorpus;
export declare function d8HitsInStrings(strings: string[], corpus: OfficialCorpus): { index: number; kind: D8Kind; length: number }[];
export declare function bankD8Hits(raw: JsonObject, corpus: OfficialCorpus): { path: string; kind: string; length: number }[];
export declare function selectWritingGroups(
  bankDir: string,
  options: {
    exams: Record<string, any>[];
    unpublishFile: string;
    repoRoot: string;
    relative?: (file: string) => string;
    unpublished?: Map<string, UnpublishEntry>;
  },
): SelectResult & { corpus: OfficialCorpus; unpublished: Map<string, UnpublishEntry> };
export declare function readExams(examsDir: string): { exams: Record<string, any>[]; files: string[]; warnings: string[] };
