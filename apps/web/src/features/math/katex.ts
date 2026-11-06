/**
 * KaTeX 的延遲載入（docs/design/math.md §3.1）。
 *
 * KaTeX（JS 約 270 KB、CSS 23 KB、字型依需要下載）只有數學頁面用得到：用 import() 切成獨立的 chunk，
 * 只在第一次畫公式時下載，英文頁面與主程式完全不受影響（建置後的主程式大小與加入數學前相同，見 math.md P2 實作備註）。
 * CSS 跟著同一個動態匯入載入；字型由 CSS 的 @font-face 依需要下載。
 *
 * 回傳同一個 Promise（React 19 的 use() 需要穩定的 Promise）；載入失敗（例如網站剛更新、舊分頁的 chunk 不見了）時
 * 清掉快取，按「再試一次」重新掛載就會重新下載。
 */
import type { KatexOptions } from 'katex';

export interface KatexApi {
  render(tex: string, element: HTMLElement, options?: KatexOptions): void;
}

let pending: Promise<KatexApi> | null = null;

export function loadKatex(): Promise<KatexApi> {
  pending ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([mod]) => mod.default,
    (err: unknown) => {
      pending = null;
      throw err;
    },
  );
  return pending;
}

/** 題目公式的排版選項：排版失敗不丟例外（顯示紅字原文）；輸出 HTML＋MathML，螢幕報讀唸得出公式。 */
export const KATEX_OPTIONS: KatexOptions = { throwOnError: false, strict: 'ignore', output: 'htmlAndMathml', trust: false };
