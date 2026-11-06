/**
 * 圖與表（docs/design/math.md §3.2）。
 *
 * 圖：從官方題本裁切的灰階 PNG；alt 是完整的文字描述（給螢幕報讀）。寬度不超過容器，點圖可以放大（新分頁開原圖）。
 * 深色模式下圖的白底很刺眼，加一層淡色外框與圓角，不反轉顏色（反轉會讓灰階圖的虛線、陰影意思改變）。
 * 表：HTML table，儲存格也可能有公式；第一列當表頭；表格太寬時橫向捲動（容器可以用鍵盤聚焦）。
 */
import type { MathFigure as Figure, MathTable } from '@gsat/shared';
import { mathFigureUrl } from '../../../data/math';
import { MathText } from './MathText';

export function MathFigureView({ figure, compact = false }: { figure: Figure; compact?: boolean }) {
  const src = mathFigureUrl(figure.file);
  // 原圖是 200 dpi 裁切：直接以像素寬顯示太大，縮成約一半（約等於題本上的大小），手機上不超過容器寬。
  const cssWidth = Math.round(figure.width / (compact ? 2.2 : 1.6));
  return (
    <figure className="my-2 max-w-full">
      <a href={src} target="_blank" rel="noopener noreferrer" className="inline-block max-w-full rounded-lg bg-white p-1 ring-1 ring-line" title="開新分頁看原圖">
        <img
          src={src}
          alt={figure.alt}
          width={figure.width}
          height={figure.height}
          loading="lazy"
          decoding="async"
          style={{ width: `${cssWidth}px` }}
          className="h-auto max-w-full"
        />
        <span className="sr-only">（開新分頁看原圖）</span>
      </a>
    </figure>
  );
}

export function MathTableView({ table, index }: { table: MathTable; index: number }) {
  const [head, ...body] = table.rows;
  return (
    <div className="my-3">
      <div className="max-w-full overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label={table.caption ?? `表 ${index}`}>
        <table className="w-full border-collapse text-sm">
          {table.caption && <caption className="px-2 py-1 text-left text-xs text-muted">{table.caption}</caption>}
          {head && (
            <thead>
              <tr className="bg-surface-2">
                {head.map((cell, i) => (
                  <th key={i} scope="col" className="border border-line px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                    <MathText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row" className="border border-line bg-surface-2 px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                      <MathText text={cell} />
                    </th>
                  ) : (
                    <td key={c} className="border border-line px-2 py-1.5 text-center whitespace-nowrap">
                      <MathText text={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.note && <p className="mt-1 text-xs text-muted">註：{table.note}</p>}
    </div>
  );
}
