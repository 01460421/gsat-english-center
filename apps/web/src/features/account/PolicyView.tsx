/**
 * 條款內文的顯示元件（歡迎頁與 AI 申請頁用）。和 ui.tsx 分開：policy.ts 的全文只該打包進這兩頁的 chunk，
 * 不要因為 Layout 用到 ui.tsx 就跟著進主程式。
 */
import { useId } from 'react';
import { formatVersionDate, type PolicyDoc } from './policy';
import { cardCls, sectionTitleCls } from './styles';

/** 條款：白話重點直接顯示，全文收合在 <details>。 */
export function PolicyView({ doc }: { doc: PolicyDoc }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cardCls}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className={sectionTitleCls}>
          {doc.title}
        </h2>
        <p className="text-sm text-muted">
          版本 {doc.version}（{formatVersionDate(doc.version)}起適用）
        </p>
      </div>
      <ul className="mt-3 space-y-1.5 text-[0.95rem]">
        {doc.summary.map((line) => (
          <li key={line} className="ml-5 list-disc">
            {line}
          </li>
        ))}
      </ul>
      {doc.sections.length > 0 && (
        <details className="mt-3 rounded-xl border border-line bg-surface-2 px-4 py-2">
          <summary className="min-h-11 cursor-pointer content-center font-medium text-primary">閱讀{doc.title}全文</summary>
          <div className="space-y-4 pt-2 pb-2 text-[0.95rem]">
            {doc.sections.map((s) => (
              <div key={s.heading}>
                <h3 className="font-semibold">{s.heading}</h3>
                {s.paragraphs?.map((p) => (
                  <p key={p} className="mt-1">
                    {p}
                  </p>
                ))}
                {s.bullets && (
                  <ul className="mt-1 space-y-1">
                    {s.bullets.map((b) => (
                      <li key={b} className="ml-5 list-disc">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
