// build-writing-prompts.mjs 的型別宣告（給 test/ 與 packages/shared 的資料測試匯入用；腳本本身是零依賴的 Node ESM）。
import type { OfficialCorpus } from '../../../packages/shared/scripts/bank-select.mjs';

type Json = Record<string, any>;

export declare const EXAMS_DIR: string;
export declare const BANK_DIR: string;
export declare const UNPUBLISH_FILE: string;
export declare const OUT_FILE: string;
export declare const D8_OUT_FILE: string;
export declare const D8_MIN_COUNTS: { han: number; en: number };
export declare const D8_PUBLIC_HEADER_TERMS: readonly string[];
export declare function maskPublicHeaderTerms(text: string): string;
export declare const CUSTOM_GROUP_PREFIX: 'custom:';
export declare const BANK_FORMAT: 'gsat-writing-prompts/v2';
export declare const GUIDANCE_LIMITS: { translation: number; essay: number };
export declare function extractGroups(exam: Json, warnings: string[]): Json[];
export declare function extractBankGroup(raw: Json, warnings: string[]): Json | null;
export declare function translationGuidance(raw: Json, groupId: string, warnings: string[]): Json | null;
export declare function essayGuidance(raw: Json, groupId: string, warnings: string[]): Json | null;
export declare function restrictedFragments(exam: Json): { fragments: string[]; publicTexts: string[] };
export declare function findLeaks(output: string, fragments: string[]): string[];
export declare function buildBank(
  exams: Json[],
  bankRaws?: Json[],
  options?: { corpus?: OfficialCorpus },
): { bank: Json; warnings: string[]; leaks: string[]; bankHits: { group_id: string; path: string; kind: string; length: number }[] };
export interface D8FingerprintFile {
  format: 'gsat-d8-fp/v2';
  han_window: 8;
  english_run: 7;
  count: { han: number; en: number };
  version: string;
  han: string;
  en: string;
}
export declare function buildD8Fingerprints(exams: Json[], bank: Json, options?: { corpus?: OfficialCorpus }): D8FingerprintFile;

// 學習助手國文（docs/design/assistant-subjects.md §5.2、§5.7）。
export declare const ZH_CLASSICS_OUT_FILE: string;
export declare const D8_ZH_FORMAT: 'gsat-d8-zh/v1';
export declare const ZH_CLASSICS_MAX_BYTES: number;
export declare const ZH_CLASSICS_MIN_WORKS: number;
export interface ZhD8Bundle {
  zh: {
    format: 'gsat-d8-zh/v1';
    han_window: 8;
    gram: 3;
    threshold: number;
    official: { version: string; count: number; fp: string };
    short: { version: string; count: number; sets: Array<{ year: string; item: string; alt: number; grams: number; fp: string }> };
    boilerplate: string[];
    /** 比賽語料的 12 字窗口（國寫範文 §5.3；只有雜湊）。 */
    contest: { version: string; count: number; fp: string };
  };
  zh_version: string;
}
export declare function buildZhD8Bundle(repoRoot?: string): ZhD8Bundle;
export declare function buildZhClassics(repoRoot?: string): { format: 'zh-classics/v1'; version: string; works: Array<{ title: string; author: string; text: string }> };
