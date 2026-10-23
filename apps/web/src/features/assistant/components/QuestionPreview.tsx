/**
 * 題目預覽（docs/design/learning-assistant.md §5.2）：確認頁與案例頁左欄共用。
 *
 *   - 站內題：選文、題幹、選項用 RichText（[[n]] 空格、<u>／<b>），證據句可以加亮（highlights，題組選文座標）；
 *   - 學生提供的題目：純文字節點（不解析任何標記），區塊依序列出；
 *   - 每一題列「你的答案 (C)／正確答案 (B)」與對錯（圖示＋文字）；題組逐題列。英文都包 lang="en"。
 * collapsed：手機案例頁預設收合，只顯示題幹與答案，選文收在「看完整題目」裡。
 */
import { ASSIST_SECTION_LABELS, TIER_LABELS } from '@gsat/shared';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { RichText } from '../../exams/components/RichText';
import type { TextHighlight } from '../../exams/richText';
import type { PreviewItem, PreviewModel } from '../sources/types';
import { AnswerText, VerdictBadge } from './parts';

const BLOCK_KIND_LABELS: Record<string, string> = {
  instructions: '說明',
  passage: '文章',
  question: '題目',
  options: '選項',
  student_mark: '學生作答',
  figure: '圖表描述',
};

function itemTitle(item: PreviewItem, model: PreviewModel): string {
  if (model.section === 'vocab_word') return item.display;
  return /^\d/.test(item.display) ? `第 ${item.display} 題` : item.display;
}

function OptionsList({ options, rich }: { options: Record<string, string>; rich: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-1 text-[0.95rem]">
      {Object.keys(options)
        .sort()
        .map((letter) => (
          <li key={letter} className="flex gap-1.5">
            <span className="shrink-0 font-semibold">({letter})</span>
            <span lang="en" className="min-w-0 break-words">
              {rich ? <RichText text={options[letter] ?? ''} variant="inline" className="inline" /> : options[letter]}
            </span>
          </li>
        ))}
    </ul>
  );
}

function ItemCard({ item, model, headingLevel }: { item: PreviewItem; model: PreviewModel; headingLevel: 3 | 4 }) {
  const H = headingLevel === 3 ? 'h3' : 'h4';
  const rich = model.trust === 'site';
  const reasons = [item.marked ? '作答時標記過' : null, item.hints ? `用了 ${item.hints} 層提示` : null, item.revealed ? '先看了答案' : null].filter(Boolean);
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <H className="font-semibold">{itemTitle(item, model)}</H>
        {item.status !== 'unknown' && <VerdictBadge status={item.status} basis={item.clientJudged ? 'client' : undefined} />}
      </div>
      {item.stem && (
        <p lang={model.section === 'vocab_word' ? undefined : 'en'} className="mt-1 break-words">
          {rich ? <RichText text={item.stem} variant="inline" className="inline" /> : item.stem}
        </p>
      )}
      {item.options && Object.keys(item.options).length > 0 && (
        <div className="mt-2">
          <OptionsList options={item.options} rich={rich} />
        </div>
      )}
      {(item.studentAnswer !== null || item.correct) && (
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-muted">你的答案</dt>
          <dd>
            <AnswerText value={item.studentAnswer} />
          </dd>
          {item.correct && item.correct.length > 0 && (
            <>
              <dt className="text-muted">正確答案</dt>
              <dd>
                <AnswerText value={item.mode === 'single_choice' || item.mode === 'bank_choice' ? item.correct.slice(0, 1) : item.correct} />
                {(item.mode === 'single_choice' || item.mode === 'bank_choice') && item.correct.length > 1 && (
                  <span className="text-muted">（官方也接受 {item.correct.slice(1).map((l) => `(${l})`).join('、')}）</span>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
      {reasons.length > 0 && <p className="mt-1 text-xs text-muted">{reasons.join('・')}</p>}
    </li>
  );
}

export function QuestionPreview({
  model,
  highlights,
  collapsible = false,
  headingLevel = 3,
  itemsFilter,
  extra,
  expand = false,
}: {
  model: PreviewModel;
  highlights?: readonly TextHighlight[];
  /** 手機案例頁：選文收合（預設收合）。 */
  collapsible?: boolean;
  headingLevel?: 3 | 4;
  /** 只列這幾題（案例頁：這次問的題）。 */
  itemsFilter?: readonly string[];
  /** 題目下方另外放的東西（例如歷屆題的說明）。 */
  extra?: ReactNode;
  /** 變成 true 時把收合的題目展開（解析的「在題目中標出這句」）。 */
  expand?: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  useEffect(() => {
    if (expand) setOpen(true);
  }, [expand]);
  const bodyId = useId();
  const items = itemsFilter ? model.items.filter((i) => itemsFilter.includes(i.label)) : model.items;
  const meta = [model.section ? ASSIST_SECTION_LABELS[model.section] : null, model.tier ? TIER_LABELS[model.tier] : null].filter(Boolean).join('・');
  const hasBody = Boolean(model.passage || model.figureText || model.sharedOptions || model.instructions || (model.blocks && model.blocks.length > 0));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {model.originLabel}
        {meta ? `・${meta}` : ''}
      </p>
      {hasBody && collapsible && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2"
        >
          {open ? '收起題目全文' : '看完整題目'}
        </button>
      )}
      {hasBody && (
        <div id={bodyId} hidden={!open} className="space-y-3">
          {model.instructions && <p className="text-sm text-muted">{model.instructions}</p>}
          {model.passage &&
            (model.trust === 'site' ? (
              <div lang="en" className="space-y-2 rounded-xl border border-line bg-surface p-3 leading-relaxed break-words" data-assist-passage="">
                <RichText text={model.passage} highlights={highlights ?? []} />
              </div>
            ) : (
              <p lang="en" className="rounded-xl border border-line bg-surface p-3 whitespace-pre-wrap break-words">
                {model.passage}
              </p>
            ))}
          {model.figureText && (
            <div className="rounded-xl border border-dashed border-line bg-surface-2 p-3 text-sm">
              <p className="font-semibold">圖表的文字描述</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{model.figureText}</p>
            </div>
          )}
          {model.sharedOptions && (
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="mb-1 text-sm font-semibold">選項</p>
              <OptionsList options={model.sharedOptions} rich={model.trust === 'site'} />
            </div>
          )}
          {model.blocks && model.blocks.length > 0 && (
            <ol className="space-y-2">
              {model.blocks.map((b, i) => (
                <li key={i} className="rounded-xl border border-line bg-surface p-3" data-block-index={i}>
                  <p className="text-xs font-semibold text-muted">
                    {BLOCK_KIND_LABELS[b.kind] ?? b.kind}
                    {b.label ? `・${b.label}` : ''}
                  </p>
                  <p lang="en" className="mt-1 whitespace-pre-wrap break-words">
                    {b.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {items.length > 0 && (
        <ul className="space-y-2" aria-label="題目與作答">
          {items.map((item) => (
            <ItemCard key={item.label} item={item} model={model} headingLevel={headingLevel} />
          ))}
        </ul>
      )}
      {extra}
    </div>
  );
}
