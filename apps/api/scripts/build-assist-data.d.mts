// build-assist-data.mjs 的型別宣告（給 test/ 匯入用；腳本本身是零依賴的 Node ESM）。
type Json = Record<string, any>;

export declare const SPEC_FILE: string;
export declare const BANDS_FILE: string;
export declare const WRITING_SPEC_FILE: string;
export declare const EXAMS_DIR: string;
export declare const OUT_FILE: string;
export declare const TARGETS_FORMAT: 'gsat-assist-targets/v1';
export declare const YEARS: number[];
export declare const MC_SECTIONS: string[];
export declare const SECTION_POINTS: Record<string, number>;
export declare class AssistTargetsError extends Error {}
export declare function sectionNumbers(exams: Json[]): Record<number, Record<string, string[]>>;
export declare function buildAssistTargets(input: { spec: Json; bands: Json; writingSpec: Json; exams: Json[] }): AssistTargetsFile;
export declare function readInputs(): { spec: Json; bands: Json; writingSpec: Json; exams: Json[] };

export interface AssistTargetsFile {
  format: 'gsat-assist-targets/v1';
  note: string;
  years: number[];
  mc_quintiles: Record<string, number[]>;
  mc_national: Record<string, number>;
  level_top_pct: Record<string, number>;
  standards: { year: number; top: number; front: number; mean: number; back: number; floor: number };
  raw_lower: Record<string, Record<string, number>>;
  nonmc_bands: Record<'translation' | 'essay', { top12: number; top25: number; median: number; max: number }>;
  nonmc_national: { translation: number; essay: number };
  tier_weights: Record<string, Record<'basic' | 'advanced' | 'top', number>>;
  section_points: Record<string, number>;
}
