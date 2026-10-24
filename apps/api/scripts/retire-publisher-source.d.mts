// retire-publisher-source.mjs 的型別宣告（給 test/ 匯入用；腳本本身是零依賴的 Node ESM）。
export declare const DEFAULT_PUBLISHER_DIR: string;
export declare const SOURCE_ID_PATTERN: RegExp;
export declare const PUBLISHER_FILE_PATTERN: RegExp;
export declare const UIDS_PER_STATEMENT: number;
export declare class RetireError extends Error {}
export declare function publisherUids(dir: string): string[];
export declare function retireSql(sourceId: string, uids: readonly string[], options?: { perStatement?: number }): string;
