// d8-fingerprint.mjs 的型別宣告（給 TypeScript 測試與其他套件匯入用；腳本本身是零依賴的 Node ESM、以 checkJs 檢查）。
export declare const D8_FP_FORMAT: 'gsat-d8-fp/v2';
export declare const D8_HAN_WINDOW: 8;
export declare const D8_ENGLISH_RUN: 7;
export declare const D8_FP_BYTES: 7;
export declare const D8_MAX_RANGES: 5;

export interface D8Window {
  window: string;
  start: number;
  end: number;
}

export declare function cyrb53(str: string, seed?: number): number;
export declare function d8Hash(kind: 'han' | 'en', window: string): number;
export declare function d8HanWindows(text: string, n?: number): D8Window[];
export declare function d8EnglishWindows(text: string, n?: number): D8Window[];
export declare function mergeRanges(ranges: Array<[number, number]>, limit?: number): Array<[number, number]>;
export declare function d8Ranges(text: string, sets: { han: Set<number>; en: Set<number> }): Array<[number, number]>;
export declare function packFingerprints(hashes: Iterable<number>): string;
export declare function unpackFingerprints(b64: string): number[];
