// build-writing-prompts.mjs 的型別宣告（給 test/ 匯入用；腳本本身是零依賴的 Node ESM）。
type Json = Record<string, any>;

export declare const EXAMS_DIR: string;
export declare const OUT_FILE: string;
export declare const BANK_FORMAT: 'gsat-writing-prompts/v1';
export declare function extractGroups(exam: Json, warnings: string[]): Json[];
export declare function restrictedFragments(exam: Json): { fragments: string[]; publicTexts: string[] };
export declare function findLeaks(output: string, fragments: string[]): string[];
export declare function buildBank(exams: Json[]): { bank: Json; warnings: string[]; leaks: string[] };
