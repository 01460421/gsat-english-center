/**
 * 題組的選文區：passage、多文本 passage_parts（分頁）、圖表 figures。
 *
 * 題本的圖一律已轉成文字描述（沒有圖檔，見 04 文件 §4.3「圖片類題目優先改用文字描述」），表格另外有 rows，畫成真正的表格。
 * 多文本用分頁（tabs）：115 學測混合題有 6 家店、112 有 8 則聊天訊息，分欄會窄到讀不下去；
 * 第一個分頁「全部」把各篇依序列出，想逐篇對照時再切到單篇。
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Figure, PassagePart, QuestionGroup } from '../../../data/exams';
import { figureKindLabel } from '../labels';
import { groupTextOffsets, type TextHighlight } from '../richText';
import { RichText } from './RichText';

export function FigureView({ figure }: { figure: Figure }) {
  const rows = figure.rows ?? null;
  const [head, ...body] = rows ?? [];
  const kind = figureKindLabel(figure.kind);
  const titleParts = [figure.caption, figure.label].filter((t): t is string => Boolean(t));
  return (
    <figure className="rounded-xl border border-line bg-surface-2 p-3 text-[0.95rem]">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted">{kind}</span>
        {figure.question_no != null && <span className="text-xs text-muted">第 {figure.question_no} 題用</span>}
        {titleParts.length > 0 && <span className="font-medium">{titleParts.join('｜')}</span>}
      </figcaption>
      {head ? (
        <>
          {/* 寬表格在手機上橫向捲動，不能把整頁撐寬；可捲動的區域要能用鍵盤聚焦（WCAG 2.1.1）。 */}
          <div className="overflow-x-auto rounded-lg border border-line bg-surface" tabIndex={0} role="region" aria-label={`${kind}內容`}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {head.map((cell, i) => (
                    <th key={i} scope="col" className="border-b border-line px-3 py-2 text-left font-semibold">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, r) => (
                  <tr key={r} className="border-b border-line last:border-0">
                    {row.map((cell, c) => (
                      <td key={c} className="px-3 py-2 align-top">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-2 text-sm text-muted">
            <summary className="cursor-pointer">表格說明</summary>
            <p className="mt-1">{figure.description}</p>
          </details>
        </>
      ) : (
        <p className="text-muted">
          <span className="sr-only">{kind}的文字描述：</span>
          {figure.description}
        </p>
      )}
    </figure>
  );
}

function partHeading(part: PassagePart, index: number): string {
  const label = part.label ?? String(index + 1);
  return part.title ? `${label}　${part.title}` : `文本 ${label}`;
}

/**
 * 多文本分頁（WAI-ARIA tabs）：左右鍵切換分頁、Home／End 跳到頭尾；分頁按鈕換行排列，不會在手機上溢出。
 */
function PassageParts({
  parts,
  offsets,
  highlights,
  poem,
  renderBlank,
}: {
  parts: readonly PassagePart[];
  offsets: readonly (number | null)[];
  highlights: readonly TextHighlight[];
  poem: boolean;
  renderBlank?: (label: string) => ReactNode;
}) {
  const baseId = useId();
  const [selected, setSelected] = useState(-1); // -1：全部
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = [{ key: -1, label: '全部' }, ...parts.map((p, i) => ({ key: i, label: p.label ?? String(i + 1) }))];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const pos = tabs.findIndex((t) => t.key === selected);
    let next = pos;
    if (e.key === 'ArrowRight') next = (pos + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (pos - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    setSelected(tab.key);
    tabRefs.current[next]?.focus();
  };

  const renderPart = (part: PassagePart, i: number) => (
    <section key={i} aria-label={partHeading(part, i)} className="rounded-xl border border-line bg-surface p-3">
      <h4 className="mb-1 text-sm font-semibold text-primary">{partHeading(part, i)}</h4>
      <RichText
        text={part.text}
        offset={offsets[i] ?? 0}
        highlights={highlights}
        variant={poem ? 'poem' : 'prose'}
        renderBlank={renderBlank}
      />
    </section>
  );

  return (
    <div>
      <div role="tablist" aria-label="多文本" className="mb-2 flex flex-wrap gap-1.5" onKeyDown={onKeyDown}>
        {tabs.map((tab, pos) => {
          const active = tab.key === selected;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[pos] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${pos}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(tab.key)}
              className={`min-w-10 rounded-full border px-3 py-1 text-sm ${
                active ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface hover:border-primary'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${tabs.findIndex((t) => t.key === selected)}`}
        className="space-y-3"
      >
        {selected === -1 ? parts.map(renderPart) : parts[selected] ? renderPart(parts[selected], selected) : null}
      </div>
    </div>
  );
}

/** 題組的選文是否有任何要顯示的東西（選文、多文本、圖表）。 */
export function groupHasStimulus(group: Pick<QuestionGroup, 'passage' | 'passage_parts' | 'figures'>): boolean {
  return Boolean(group.passage) || (group.passage_parts?.length ?? 0) > 0 || group.figures.length > 0;
}

export function PassageView({
  group,
  highlights,
  renderBlank,
}: {
  group: QuestionGroup;
  highlights: readonly TextHighlight[];
  renderBlank?: (label: string) => ReactNode;
}) {
  const offsets = groupTextOffsets(group);
  const poem = group.tags?.genre === 'poem';
  const parts = group.passage_parts ?? [];
  return (
    <div className="space-y-3 leading-relaxed">
      {group.group_label && <p className="text-sm text-muted">{group.group_label}</p>}
      {group.passage && (
        <RichText
          text={group.passage}
          offset={offsets.passage ?? 0}
          highlights={highlights}
          variant={poem ? 'poem' : 'prose'}
          renderBlank={renderBlank}
        />
      )}
      {parts.length > 0 && (
        <PassageParts
          parts={parts}
          offsets={offsets.parts}
          highlights={highlights}
          poem={poem}
          renderBlank={renderBlank}
        />
      )}
      {group.figures.map((figure, i) => (
        <FigureView key={i} figure={figure} />
      ))}
    </div>
  );
}
