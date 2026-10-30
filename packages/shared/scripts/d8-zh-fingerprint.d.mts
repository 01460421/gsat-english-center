// d8-zh-fingerprint.mjs 的型別宣告（給 TypeScript 測試與 Worker 匯入用；腳本本身是零依賴的 Node ESM、以 checkJs 檢查）。
export declare const ZH_D8_WINDOW_DOMAIN: 'zh8';
export declare const ZH_D8_SHORT_DOMAIN: 'zs3';
export declare const ZH_D8_SHORT_GRAM: 3;
export declare const ZH_D8_SHORT_MIN_GRAMS: 5;
export declare const ZH_D8_SHORT_THRESHOLD: 0.6;
export declare const ZH_D8_OFFICIAL_KIND: 'zh-official';
export declare const ZH_D8_SHORT_KIND: 'zh-short';
export declare const ZH_D8_OFFICIAL_FILE: 'data/d8/zh-official.fp.json';
export declare const ZH_D8_SHORT_FILE: 'data/d8/zh-short.fp.json';
export declare const ZH_D8_BOILERPLATE_FILE: 'data/d8/zh-boilerplate.txt';
export declare const ZH_D8_CLASSICS_FILE: 'data/d8/zh-public-classics.txt';
export declare const ZH_D8_MIN_COUNTS: { windows: number; shortSets: number };

/** item 是子題（例「34(1)」「32(2)①」）；alt 是同一子題的第幾種寫法（0＝主要答案）。只在產生器的記憶體裡用。 */
export interface ZhShortAnswer {
  item: string;
  alt: number;
  text: string;
}

export interface ZhOfficialFile {
  format: 'gsat-d8-fp/v2';
  kind: 'zh-official';
  hash: string;
  han_window: 8;
  count: number;
  version: string;
  sources: Array<{ doc: string; year: string; kind: string; sha256: string; windows: number; in_public: number }>;
  excluded: { public_windows: number; classics_windows: number; boilerplate_terms: number };
  fp: string;
}

export interface ZhShortFile {
  format: 'gsat-d8-fp/v2';
  kind: 'zh-short';
  hash: string;
  gram: 3;
  min_grams: 5;
  threshold: 0.6;
  count: number;
  dropped_short: number;
  version: string;
  sets: Array<{ year: string; item: string; alt: number; grams: number; fp: string }>;
}

export type ZhFingerprintRead =
  | { kind: 'zh-official'; version: string; set: Set<number> }
  | { kind: 'zh-short'; version: string; sets: Array<{ year: string; item: string; alt: number; set: Set<number> }> };

export declare function zhD8WindowHash(window: string): number;
export declare function zhD8GramHash(gram: string): number;
export declare function zhD8Windows(text: string): string[];
export declare function zhD8Grams(text: string): string[];
export declare function parseBoilerplate(fileText: string): string[];
export declare function maskBoilerplate(text: string, terms: readonly string[]): string;
export declare function parseClassics(fileText: string): Array<{ title: string; author: string; text: string }>;
export declare function htmlArticleText(html: string): string;
export declare function splitShortAnswer(item: string, chunk: string): ZhShortAnswer[];
export declare function extractGzScoreAnswers(text: string): ZhShortAnswer[];
export declare function extractRefScoreAnswers(text: string): ZhShortAnswer[];
export declare function zhMixedSectionText(paperText: string): string;
export declare function buildZhOfficial(input: {
  protectedDocs: Array<{ doc: string; year: string; kind: string; sha256: string; text: string }>;
  publicTexts: readonly string[];
  classicsText: string;
  boilerplate: readonly string[];
}): ZhOfficialFile;
export declare function buildZhShort(
  papers: Array<{ year: string; answers: ZhShortAnswer[]; paperText: string }>,
  boilerplate: readonly string[],
): ZhShortFile;
export declare function zhD8OfficialHitCount(text: string, set: Set<number>, boilerplate?: readonly string[]): number;
export declare function zhShortContainment(text: string, gramSet: Set<number>): number;
export declare function readZhFingerprintFile(json: unknown): ZhFingerprintRead;
export declare function generateZhFingerprints(
  sourceDir: string,
  repoRoot?: string,
): { official: ZhOfficialFile; short: ZhShortFile; answerCounts: Array<{ year: string; answers: number }> };
