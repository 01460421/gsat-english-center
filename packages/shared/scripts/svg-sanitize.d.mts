// svg-sanitize.mjs 的型別宣告（給 TypeScript 測試與其他套件匯入用）。
export declare const SVG_MAX_CHARS: 30000;
export declare const NUMBER_SOURCE: string;
export declare function sanitizeSvg(input: unknown): { svg: string; problem?: undefined } | { svg: null; problem: string };
export declare function isSanitizedSvg(svg: unknown): boolean;
