// zh-contest-fingerprint.mjs 的型別宣告（給 TypeScript 測試與 Worker 產生器匯入用；腳本本身是零依賴的 Node ESM、以 checkJs 檢查）。
export declare const ZH_CONTEST_KIND: 'zh-contest';
export declare const ZH_CONTEST_DOMAIN: 'ze12';
export declare const ZH_CONTEST_WINDOW: 12;
export declare const ZH_CONTEST_STRIDE: 4;
export declare const ZH_CONTEST_FILE: 'data/d8/zh-contest.fp.json';
export declare const ZH_CONTEST_MIN_WINDOWS: number;
export declare const ZH_CONTEST_TITLE_MAX: number;
export declare const ZH_CONTEST_FORM_MAP: Readonly<Record<string, string>>;

export interface ZhContestFile {
  format: 'gsat-d8-fp/v2';
  kind: 'zh-contest';
  hash: string;
  han_window: 12;
  stride: 4;
  count: number;
  version: string;
  sources: Array<{ year: string; essays: number; windows: number }>;
  excluded: { classics_windows: number };
  fp: string;
}

export declare function zhContestHanStream(text: string): string;
export declare function zhContestWindowHash(window: string): number;
export declare function zhContestWindows(stream: string, stride?: number): string[];
export declare function zhContestEssayBody(fileText: string): string;
export declare function zhContestClassicsWindows(classicsText: string): Set<string>;
export declare function buildZhContest(input: { essays: Array<{ year: string; text: string }>; classicsText: string }): ZhContestFile;
export declare function readZhContestFile(json: unknown): { version: string; set: Set<number> };
export declare function zhContestHitCount(text: string, set: Set<number>): { paragraphs: number; hitParagraphs: number; windows: number };
export declare function readZhContestSource(sourceDir: string): Array<{ year: string; file: string; text: string }>;
export declare function generateZhContest(sourceDir: string, repoRoot?: string): ZhContestFile;
