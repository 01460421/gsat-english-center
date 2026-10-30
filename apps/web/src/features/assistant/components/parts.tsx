/**
 * 學習助手頁面共用的小元件：解析區塊（section＋h2＋AI 標章）、對錯標章（圖示＋文字，不只靠顏色）、作答文字、
 * 程式後處理的說明、身心安全的關懷訊息、按鈕樣式。
 */
import { ZH_NOTICE_TEXT, type AnswerValue, type AssistNotice, type AssistVerdict, type ZhNotice } from '@gsat/shared';
import { CircleCheck, CircleHelp, CircleMinus, CircleX } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { AiBadge } from '../../writing/components/ui';
import type { ItemStatus } from '../sources/types';

export const primaryBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryBtn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-5 py-2 font-medium lg:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
export const cardCls = 'rounded-2xl border border-line bg-surface p-4 lg:p-5';
export const inputCls = 'w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg placeholder:text-muted focus:border-primary disabled:opacity-70';

/** 解析或報告的一個區塊：<section>＋h2（＋AI 標章）。 */
export function AnalysisSection({
  title,
  ai = true,
  children,
  id,
  className = '',
}: {
  title: string;
  ai?: boolean;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const auto = useId();
  const headingId = `${id ?? auto}-h`;
  return (
    <section id={id} aria-labelledby={headingId} className={`scroll-mt-20 space-y-2 ${className}`}>
      <h2 id={headingId} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-lg font-semibold outline-none">
        <span>{title}</span>
        {ai && <AiBadge compact variant="assistant" />}
      </h2>
      {children}
    </section>
  );
}

const STATUS_TEXT: Record<ItemStatus | AssistVerdict, string> = {
  wrong: '答錯',
  partial: '部分給分',
  unanswered: '未作答',
  doubt: '答對（有疑問）',
  correct: '答對',
  unknown: '判不出對錯',
};

/** 對錯：圖示＋文字（§1.11：不只靠顏色）。 */
export function VerdictBadge({ status, basis }: { status: ItemStatus | AssistVerdict; basis?: 'program' | 'client' | 'none' }) {
  const tone =
    status === 'correct' || status === 'doubt'
      ? 'bg-ok/10 text-ok'
      : status === 'wrong'
        ? 'bg-bad/10 text-bad'
        : status === 'partial'
          ? 'bg-primary-soft text-primary'
          : 'bg-surface-2 text-muted';
  const Icon = status === 'correct' || status === 'doubt' ? CircleCheck : status === 'wrong' ? CircleX : status === 'unknown' ? CircleHelp : CircleMinus;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold ${tone}`}>
      <Icon aria-hidden="true" className="size-4" />
      {STATUS_TEXT[status]}
      {basis === 'client' && <span className="font-normal">（依你裝置上的判分）</span>}
    </span>
  );
}

/** 學生或正確的答案：選擇題「(C)」、多選「(A)、(C)」、文字原樣（英文包 lang="en"；國文的文字 lang 傳 null，不包）。 */
export function AnswerText({ value, empty = '未作答', lang = 'en' }: { value: AnswerValue | readonly string[] | null | undefined; empty?: string; lang?: 'en' | null }) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-muted">{empty}</span>;
  }
  const list = typeof value === 'string' ? [value] : [...value];
  const letters = list.every((v) => /^[A-Z]$/.test(v));
  if (letters) return <span className="font-semibold">{list.map((l) => `(${l})`).join('、')}</span>;
  return (
    <span lang={lang ?? undefined} className="break-words">
      {list.join('／')}
    </span>
  );
}

const NOTICE_TEXT: Record<AssistNotice['kind'], string> = {
  filtered: '有一段內容不適合顯示，已經過濾掉。',
  d8_hidden: '有一段內容和官方受保護的資料太接近，已隱藏。',
  english_trimmed: '有些例句太長，已省略。',
  answer_cleared: '翻譯與寫作題不提供完整答案，請照解法自己寫，再送 AI 批改。',
  truncated: '有些內容太長，已截短。',
  prediction_removed: '有些預測分數的句子已拿掉（分數以本站計算的數字為準）。',
  off_topic: '學習助手只回答英文學習與學測相關的問題。',
  missing_item: '有一題沒有產生解析。',
};

/** 國文另有的說明（示範、短答、等第規則；docs/design/assistant-subjects.md §5.5、§5.7）。 */
const ALL_NOTICE_TEXT: Record<ZhNotice['kind'], string> = { ...NOTICE_TEXT, ...ZH_NOTICE_TEXT };

/** 程式後處理的說明（同一種只說一次）。 */
export function ProcessingNotices({ notices }: { notices: readonly (AssistNotice | ZhNotice)[] }) {
  const kinds = [...new Set(notices.map((n) => n.kind))].filter((k) => k !== 'off_topic' && ALL_NOTICE_TEXT[k] !== undefined);
  if (kinds.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-muted">
      {kinds.map((k) => (
        <li key={k}>{ALL_NOTICE_TEXT[k]}</li>
      ))}
    </ul>
  );
}

/**
 * 身心安全旗標：先顯示關懷訊息與求助資源（§1.11），內容照常。
 * note：最後一行（作文範文頁換成「下面的範文照常提供。」，docs/design/model-essays.md §1.11）；沒給時輸出不變。
 * null＝不寫最後一行（作文範文退還、下面沒有內容時）。
 */
export function AssistSafetyCare({ note = '下面的解析照常提供。' }: { note?: string | null } = {}) {
  const id = useId();
  return (
    <section role="note" aria-labelledby={id} className="rounded-2xl border border-primary/40 bg-primary-soft p-4 lg:p-5">
      <h2 id={id} className="text-lg font-semibold">
        想找人聊聊嗎？
      </h2>
      <p className="mt-2 text-[0.95rem]">
        你寫的內容提到了一些可能讓你很辛苦的事。如果你正覺得難過、害怕，或有人傷害你，你不必一個人承受，可以找信任的家人、老師或輔導老師，也可以撥打免付費專線：
      </p>
      <ul className="mt-2 grid gap-1 text-[0.95rem] sm:grid-cols-2">
        <li>
          衛福部安心專線 <a href="tel:1925" className="font-semibold text-primary underline">1925</a>（24 小時）
        </li>
        <li>
          生命線 <a href="tel:1995" className="font-semibold text-primary underline">1995</a>
        </li>
        <li>
          張老師專線 <a href="tel:1980" className="font-semibold text-primary underline">1980</a>
        </li>
        <li>
          保護專線 <a href="tel:113" className="font-semibold text-primary underline">113</a>
        </li>
      </ul>
      {note !== null && <p className="mt-2 text-sm text-muted">{note}</p>}
    </section>
  );
}

/** 英文內容（例句、證據句、選項）：lang="en" 讓讀屏用英文唸。 */
export function En({ children }: { children: ReactNode }) {
  return (
    <span lang="en" className="break-words">
      {children}
    </span>
  );
}
