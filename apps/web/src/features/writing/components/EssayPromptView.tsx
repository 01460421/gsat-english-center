/**
 * 作文題目：說明、背景提示、提示、圖的文字描述（表格另外畫成表）、字數與段數要求。
 * 原圖不轉載（可能有第三方著作權），看圖作文附官方題本 PDF 連結。
 */
import { RichText } from '../../exams/components/RichText';
import type { EssayFigure, EssayPrompt } from '../data';
import { essayRequirement } from '../lib/format';
import { ExternalA, card } from './ui';

function FigureView({ figure, index }: { figure: EssayFigure; index: number }) {
  const [head, ...body] = figure.rows ?? [];
  return (
    <figure className="rounded-xl bg-surface-2 p-3">
      <figcaption className="text-sm font-semibold">{figure.caption ?? figure.label ?? `圖 ${index + 1}`}</figcaption>
      <p className="mt-1 text-[0.95rem]">
        <span className="sr-only">圖片的文字描述：</span>
        {figure.description}
      </p>
      {head && (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface" role="region" aria-label={`${figure.caption ?? '圖表'}的資料`} tabIndex={0}>
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
    </figure>
  );
}

export function EssayPromptView({ prompt }: { prompt: EssayPrompt }) {
  const requirement = essayRequirement(prompt);
  return (
    <section aria-label="題目" className={`space-y-3 ${card}`}>
      {prompt.instructions && <p className="whitespace-pre-line text-[0.95rem]">{prompt.instructions}</p>}
      {prompt.passage && (
        <div className="text-[0.95rem]">
          <RichText text={prompt.passage} />
        </div>
      )}
      {prompt.stem && (
        <div className="text-[1.02rem]">
          <RichText text={prompt.stem} />
        </div>
      )}
      {prompt.figures.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            圖片已改寫成文字描述
            {prompt.paper_url ? (
              <>
                ；原圖請看<ExternalA href={prompt.paper_url}>官方題本 PDF</ExternalA>
              </>
            ) : null}
            。
          </p>
          {prompt.figures.map((f, i) => (
            <FigureView key={i} figure={f} index={i} />
          ))}
        </div>
      )}
      {requirement && <p className="text-sm font-medium">要求：{requirement}</p>}
    </section>
  );
}
