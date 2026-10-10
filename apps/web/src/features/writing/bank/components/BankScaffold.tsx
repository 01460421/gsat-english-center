/**
 * 作文的鷹架（SPEC §3.5、§6.9；收合，學生自己打開）：
 *   穩定基礎  構思圖（5W1H）、兩段大綱、每段的句型開頭
 *   進階練習  兩段大綱
 *   超越頂標  規劃檢核表
 * 區塊標題是 h2「寫作鷹架」（和「題目」「審題提示」同一層），裡面的構思圖、兩段大綱、句型開頭是 h3。
 */
import type { CompositionOutlineParagraph, CompositionScaffold } from '@gsat/shared';
import { useId, useState } from 'react';
import { card, secondaryButton } from '../../components/ui';

function Outline({ outline }: { outline: readonly CompositionOutlineParagraph[] }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">兩段大綱</h3>
      <ol className="space-y-2">
        {outline.map((p) => (
          <li key={p.paragraph} className="rounded-xl border border-line p-3">
            <p className="font-medium">
              第 {p.paragraph} 段：{p.topic_sentence_zh}
            </p>
            {p.details_zh.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.95rem]">
                {p.details_zh.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            {p.closing_zh && <p className="mt-1 text-sm text-muted">結尾：{p.closing_zh}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function BankScaffold({ scaffold }: { scaffold: CompositionScaffold }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const title = scaffold.kind === 'checklist' ? '規劃檢核表' : scaffold.kind === 'outline' ? '兩段大綱' : '構思圖、大綱與句型開頭';
  return (
    <section aria-labelledby={`${panelId}-h`} className={`space-y-3 ${card}`}>
      <h2 id={`${panelId}-h`} className="font-semibold">
        寫作鷹架
      </h2>
      <button type="button" className={secondaryButton} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        {open ? `收起${title}` : `打開${title}`}
      </button>
      {open && (
        <div id={panelId} className="space-y-4">
          {scaffold.kind === 'outline+sentence_starters' && (
            <>
              <div className="space-y-2">
                <h3 className="font-semibold">構思圖：{scaffold.planning_map.center_zh}</h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {scaffold.planning_map.branches.map((b) => (
                    <div key={b.label_zh} className="rounded-xl bg-surface-2 px-3 py-2">
                      <dt className="text-sm font-semibold text-primary">{b.label_zh}</dt>
                      <dd className="text-[0.95rem]">{b.prompt_zh}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <Outline outline={scaffold.outline} />
              <div className="space-y-2">
                <h3 className="font-semibold">句型開頭</h3>
                {scaffold.sentence_starters.map((list, i) => (
                  <div key={i}>
                    <p className="text-sm text-muted">第 {i + 1} 段</p>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-5" lang="en">
                      {list.map((s) => (
                        <li key={s} className="break-words">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
          {scaffold.kind === 'outline' && <Outline outline={scaffold.outline} />}
          {scaffold.kind === 'checklist' && (
            <ul className="list-disc space-y-1 pl-5 text-[0.95rem]">
              {scaffold.checklist_zh.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
