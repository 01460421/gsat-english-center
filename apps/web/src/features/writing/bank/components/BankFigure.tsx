/**
 * 本站仿真作文的圖（docs/design/bank-writing.md §3.4、§4.6）。
 *
 * SVG 是出題代理寫的資料：建置時已經依白名單清理、重新序列化（packages/shared/scripts/svg-sanitize.mjs），
 * 畫面上**只用 <img src="data:image/svg+xml;charset=utf-8,…">** 顯示：以 <img> 載入的 SVG 不執行腳本、不載入外部資源，
 * 就算清理出錯也只會是壞圖。絕不把 SVG 當成 HTML 插進畫面（scripts/source-scan.test.ts 檢查）。
 *
 * 替代文字：<img alt="">，圖的文字等價內容全部放在同一個 <figure> 的 <figcaption>（caption 一行、description，有 rows 時接表格），
 * 螢幕閱讀器只讀一次 caption，看不清楚圖的人也讀得到同一段文字。
 * SVG 自帶淺色背景與深色字：深色模式也維持白底外框、不反轉顏色。320 px 寬時字只剩約 8 px，所以有「放大檢視」：
 * 圖切成 2 倍寬，捲動只發生在圖框內，頁面本身不會水平捲動。放大按鈕不用 lucide 圖示：<figure> 裡不放任何 <svg> 元素
 * （e2e 以「figure svg 數量是 0」確認圖沒有被當成 DOM 插進來）。
 */
import { useId, useState } from 'react';
import type { BankFigure as BankFigureData } from '../data';

/** SVG → data: URL（UTF-8 文字要先編碼；在 <img> 裡顯示）。 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function BankFigure({ figure, index }: { figure: BankFigureData; index: number }) {
  const [zoomed, setZoomed] = useState(false);
  const frameId = useId();
  const [head, ...body] = figure.rows ?? [];
  const caption = figure.caption ?? figure.label;
  return (
    <figure className="space-y-2 rounded-xl bg-surface-2 p-3">
      {figure.svg && (
        <div className="space-y-1">
          <div id={frameId} className="max-w-[32rem] overflow-x-auto rounded-xl border border-line bg-white p-2" tabIndex={zoomed ? 0 : undefined}>
            <img
              src={svgDataUrl(figure.svg)}
              alt=""
              loading="lazy"
              decoding="async"
              className={`block h-auto ${zoomed ? 'w-[200%] max-w-none' : 'w-full'}`}
            />
          </div>
          <button
            type="button"
            onClick={() => setZoomed((z) => !z)}
            aria-pressed={zoomed}
            aria-controls={frameId}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline"
          >
            {zoomed ? `縮回第 ${index + 1} 張圖` : `放大檢視第 ${index + 1} 張圖`}
          </button>
        </div>
      )}
      <figcaption className="space-y-1">
        {caption && <p className="text-sm font-semibold">{caption}</p>}
        <p className="text-[0.95rem]">
          <span className="sr-only">圖的文字描述：</span>
          {figure.description}
        </p>
        {head && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface" role="region" aria-label={`${caption ?? '圖表'}的資料`} tabIndex={0}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} scope="col" className="border-b border-line px-3 py-1.5 text-left font-semibold">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, r) => (
                  <tr key={r} className="border-t border-line">
                    {row.map((cell, i) => (
                      <td key={i} className="px-3 py-1.5">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </figcaption>
    </figure>
  );
}
