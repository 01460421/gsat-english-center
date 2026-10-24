/** 寫作頁共用的小元件：AI 標示、提示框、錯誤訊息、返回連結與按鈕樣式。 */
import { ChevronLeft, ExternalLink, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ErrorView } from '../lib/errors';

export const primaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 font-medium text-on-primary disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line px-5 py-2 font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50';
export const textInput =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-fg placeholder:text-muted focus:border-primary disabled:opacity-70';
export const card = 'rounded-2xl border border-line bg-surface p-4 lg:p-5';

/** 英文作答框：關掉拼字檢查、自動大寫、自動完成（拼字錯誤要學生自己發現，也不能讓手機偷偷改字）。 */
export const englishInputProps = {
  spellCheck: false,
  autoCapitalize: 'none',
  autoCorrect: 'off',
  autoComplete: 'off',
  lang: 'en',
} as const;

/** AI 標示的變體：assistant＝學習助手、exemplar＝作文範文（docs/design/model-essays.md §1.11）；沒有 variant＝AI 批改。 */
export type AiVariant = 'assistant' | 'exemplar';

/** 作文範文的 AI 標章（每一篇範文旁邊）。 */
export const EXEMPLAR_AI_BADGE = 'AI 範文，僅供參考';

/**
 * 「AI 批改，僅供參考」：每一則 AI 產生的內容旁邊都要有（SPEC §8.4、ARCHITECTURE §8.5）。
 * variant="assistant"：學習助手不打分數，改寫「AI 產生，僅供參考」（docs/design/learning-assistant.md §1.11）；
 * variant="exemplar"：作文範文，「AI 範文，僅供參考」。沒有 variant 時輸出不變。
 */
export function AiBadge({ compact = false, variant }: { compact?: boolean; variant?: AiVariant }) {
  const text = variant === 'assistant' ? 'AI 產生，僅供參考' : variant === 'exemplar' ? EXEMPLAR_AI_BADGE : 'AI 批改，僅供參考';
  if (compact) {
    // 列表裡空間小：只顯示「AI」，完整說明給讀屏與滑鼠提示。
    return (
      <span title={text} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-badge-bg px-1.5 py-0.5 text-[0.7rem] font-semibold text-badge-fg">
        <Sparkles aria-hidden="true" className="size-3" />
        <span aria-hidden="true">AI</span>
        <span className="sr-only">{text}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">
      <Sparkles aria-hidden="true" className="size-3.5" />
      {text}
    </span>
  );
}

/**
 * 「回報不當內容」（SPEC §8.4：每則 AI 回饋旁都要有）。回報端點（ARCHITECTURE §10.4 的 POST /api/ai/feedback-report）
 * 不在這次 MVP 的契約裡、後端還沒有，所以先照站內慣例顯示「即將開放」，並告訴學生現在可以怎麼做（設計文件 §10「前端需要」）。
 */
export function ReportAiContent({ variant }: { variant?: AiVariant }) {
  // 學習助手版（docs/design/learning-assistant.md §1.11、§5.2）：不提分數，刪除的是「這一題」。沒有 variant 時輸出不變。
  // 作文範文版（docs/design/model-essays.md §1.8 第 8 點）：可以按「這組範文有問題」，或刪除這一組。
  const assistant = variant === 'assistant';
  const exemplar = variant === 'exemplar';
  return (
    <details className="text-sm">
      <summary className="cursor-pointer py-3 text-muted hover:text-primary">
        回報不當內容
        <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 text-xs">即將開放</span>
      </summary>
      <div className="mt-1 space-y-1 rounded-xl border border-line bg-surface-2 px-4 py-3">
        <p>
          {assistant
            ? '線上回報即將開放。在那之前，如果 AI 的解析內容不恰當、讓你不舒服，或明顯有錯：'
            : exemplar
              ? '線上回報即將開放。在那之前，如果 AI 的範文或說明內容不恰當、讓你不舒服，或明顯有錯：'
              : '線上回報即將開放。在那之前，如果 AI 的回饋內容不恰當、讓你不舒服，或分數明顯不合理：'}
        </p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>請不要理會它，AI 的說明只是參考；</li>
          <li>
            {assistant
              ? '可以按「這則解析有錯」，或把這一題刪除（頁面最下方的「刪除這一題」）；'
              : exemplar
                ? '可以按「這組範文有問題」，或把這一組刪除（頁面最下方的「刪除這一組」）；'
                : '可以把這份紀錄刪除（頁面最下方的「刪除這份紀錄」）；'}
          </li>
          <li>需要的話，告訴你信任的老師或家人。</li>
        </ul>
      </div>
    </details>
  );
}

/** 學習助手各頁頂端與追問串的 AI 聲明（docs/design/learning-assistant.md §1.11；assistant-copy.test.ts 檢查這段文字）。 */
export const ASSISTANT_AI_NOTICE = '你正在和 AI 互動：解析與建議由 AI 產生，可能有錯；答案以題目頁或官方公布為準。';

/** 作文範文各頁頂端的 AI 聲明（docs/design/model-essays.md §1.11）。 */
export const EXEMPLAR_AI_NOTICE =
  '你正在和 AI 互動：範文由 AI 產生，僅供學習參考，可能有錯；分數帶是本站設定的目標，不是評分結果。請不要把範文當成自己的作品繳交。';

/**
 * AI 頁面頂端固定的告知：正在和 AI 互動、分數不是大考中心的正式評分。
 * generic：不提考試機構名稱的版本（自訂題目的作答頁與結果頁用；docs/design/custom-essay.md §6.10）。預設輸出不變。
 * variant="assistant"：學習助手（不打分數，docs/design/learning-assistant.md §1.11），優先於 generic。
 * variant="exemplar"：作文範文（docs/design/model-essays.md §1.11），優先於 generic。
 */
export function AiNotice({ children, generic = false, variant }: { children?: ReactNode; generic?: boolean; variant?: AiVariant }) {
  const assistant = variant === 'assistant';
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm">
      {assistant ? <AiBadge variant="assistant" /> : variant === 'exemplar' ? <AiBadge variant="exemplar" /> : <AiBadge />}
      <span>
        {assistant
          ? ASSISTANT_AI_NOTICE
          : variant === 'exemplar'
            ? EXEMPLAR_AI_NOTICE
            : generic
            ? '你正在和 AI 互動：AI 評分僅供參考，不是正式考試的評分。'
            : '你正在和 AI 互動：AI 評分僅供參考，不是大考中心的正式評分。'}
        {children}
      </span>
    </p>
  );
}

type Tone = 'info' | 'warn' | 'error' | 'ok';

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-line bg-surface-2',
  warn: 'border-badge-fg/30 bg-badge-bg/60',
  error: 'border-bad/40 bg-bad/10 text-bad',
  ok: 'border-ok/30 bg-ok/10',
};

export function Notice({ tone = 'info', children, role }: { tone?: Tone; children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div role={role} className={`rounded-xl border px-4 py-3 text-sm ${TONE_CLASS[tone]}`}>
      {children}
    </div>
  );
}

/** 錯誤訊息＋下一步（登入、申請、同意）。 */
export function ErrorMessage({ view }: { view: ErrorView }) {
  return (
    <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
      <p className="text-bad">{view.message}</p>
      {view.action?.to && (
        <Link to={view.action.to} className="mt-2 inline-flex min-h-9 items-center font-medium text-primary underline underline-offset-2">
          {view.action.label}
        </Link>
      )}
      {view.action?.href && (
        <a href={view.action.href} className="mt-2 inline-flex min-h-9 items-center font-medium text-primary underline underline-offset-2">
          {view.action.label}
        </a>
      )}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
      <ChevronLeft aria-hidden="true" className="size-4" />
      {children}
    </Link>
  );
}

export function ExternalA({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-primary underline-offset-2 hover:underline">
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">（另開新分頁）</span>
    </a>
  );
}

export function Loading({ children = '載入中…' }: { children?: ReactNode }) {
  return (
    <p role="status" className="py-8 text-center text-muted">
      {children}
    </p>
  );
}

const linkButton = 'inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2 disabled:opacity-50';

/**
 * 需要先在原地確認一次的動作（清除草稿、刪除紀錄、捨棄修改），避免手滑。
 * 鍵盤與讀屏：按下後焦點移到「確定」；按「取消」或「確定」後焦點回到原本的按鈕（不會掉到頁首），
 * doneMessage 有給時另外用 role=status 唸出結果（例如「已清除」）。
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled,
  doneMessage,
  triggerClassName = linkButton,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  doneMessage?: string;
  triggerClassName?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (confirming || !restoreFocus.current) return;
    restoreFocus.current = false;
    triggerRef.current?.focus();
  }, [confirming]);
  const close = () => {
    restoreFocus.current = true;
    setConfirming(false);
  };
  if (!confirming) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
          className={triggerClassName}
        >
          {label}
        </button>
        {doneMessage && (
          <span role="status" className="text-sm text-muted">
            {done ? doneMessage : ''}
          </span>
        )}
      </span>
    );
  }
  return (
    <span role="group" aria-label={question} className="inline-flex flex-wrap items-center gap-2 text-sm">
      <span>{question}</span>
      <button
        type="button"
        autoFocus
        onClick={() => {
          close();
          setDone(true);
          onConfirm();
        }}
        className="inline-flex min-h-11 items-center rounded-full bg-bad px-4 font-semibold text-on-primary"
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={close} className="inline-flex min-h-11 items-center rounded-full border border-line px-4">
        取消
      </button>
    </span>
  );
}

/** 靜態資料載入失敗（離線、網站剛更新）。 */
export function DataError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={card}>
      <p className="font-semibold">資料載入失敗</p>
      <p className="mt-1 text-muted">{message}</p>
      <button type="button" onClick={onRetry} className={`mt-3 ${primaryButton}`}>
        再試一次
      </button>
    </div>
  );
}
