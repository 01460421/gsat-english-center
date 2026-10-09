/**
 * 在學生原文上加亮 AI 指出的錯誤片段，旁邊標上錯誤編號（對應下方清單）。
 * 顏色依類別區分，但不只靠顏色：每個片段都有波浪底線與編號，色弱與單色列印也看得出來。
 */
import type { EssayErrorCategory, TranslationErrorCategory } from '@gsat/shared';
import { Fragment } from 'react';
import { locateSpan, segmentText, type Span } from '../lib/highlight';

export type ErrorCategory = TranslationErrorCategory | EssayErrorCategory;

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  spelling: '拼字',
  grammar: '文法',
  word_choice: '用字',
  omission: '漏譯',
  meaning: '語意',
  capitalization: '大小寫',
  punctuation: '標點',
  organization: '組織',
  mechanics: '標點與大小寫',
  other: '其他',
};

const CATEGORY_CLASS: Record<ErrorCategory, string> = {
  spelling: 'bg-bad/15 decoration-bad',
  grammar: 'bg-primary-soft decoration-primary',
  word_choice: 'bg-badge-bg decoration-badge-fg',
  omission: 'bg-bad/10 decoration-bad',
  meaning: 'bg-bad/10 decoration-bad',
  capitalization: 'bg-surface-2 decoration-muted',
  punctuation: 'bg-surface-2 decoration-muted',
  organization: 'bg-primary-soft decoration-primary',
  mechanics: 'bg-surface-2 decoration-muted',
  other: 'bg-surface-2 decoration-muted',
};

export function categoryClass(category: ErrorCategory): string {
  return CATEGORY_CLASS[category] ?? CATEGORY_CLASS.other;
}

export interface MarkedError extends Span {
  /** 畫面上的編號（1 起算），對應錯誤清單的 id `${idPrefix}-${n}`。 */
  n: number;
  category: ErrorCategory;
}

/** 依原文找出每個錯誤實際的位置（找不到的不標，只留在清單）。 */
export function placeErrors<T extends MarkedError>(text: string, errors: readonly T[]): Array<T & { start: number; end: number }> {
  const placed: Array<T & { start: number; end: number }> = [];
  for (const e of errors) {
    const at = locateSpan(text, e);
    if (at) placed.push({ ...e, start: at.start, end: at.end });
  }
  return placed;
}

export function HighlightedText({
  text,
  errors,
  idPrefix,
  className = '',
}: {
  text: string;
  errors: readonly MarkedError[];
  idPrefix: string;
  className?: string;
}) {
  const segments = segmentText(text, placeErrors(text, errors));
  return (
    <p lang="en" className={`whitespace-pre-wrap break-words leading-8 ${className}`}>
      {segments.map((seg) => {
        if (seg.marks.length === 0) return <Fragment key={seg.start}>{seg.text}</Fragment>;
        const first = seg.marks[0];
        if (!first) return <Fragment key={seg.start}>{seg.text}</Fragment>;
        // 編號只標在每個錯誤的最後一段後面，重疊時不會重複出現。
        const endingHere = seg.marks.filter((m) => m.end === seg.start + seg.text.length);
        return (
          <Fragment key={seg.start}>
            <mark
              className={`rounded-sm px-0.5 text-fg underline decoration-wavy decoration-1 underline-offset-4 ${categoryClass(first.category)}`}
              title={seg.marks.map((m) => `${m.n}. ${ERROR_CATEGORY_LABELS[m.category]}`).join('、')}
            >
              {seg.text}
            </mark>
            {endingHere.map((m) => (
              // 上標編號字很小：用 ::before 往外擴大可點範圍（約 24 px），不影響行高與排版。
              <a
                key={m.n}
                href={`#${idPrefix}-${m.n}`}
                className="relative ml-0.5 inline-block px-0.5 align-super text-[0.7rem] font-semibold text-muted no-underline before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-['']"
              >
                {m.n}
                <span className="sr-only">（錯誤 {m.n}：{ERROR_CATEGORY_LABELS[m.category]}）</span>
              </a>
            ))}
          </Fragment>
        );
      })}
    </p>
  );
}
