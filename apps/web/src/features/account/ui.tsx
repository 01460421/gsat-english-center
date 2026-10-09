/**
 * 帳號、AI 申請與後台頁的小型共用元件：提示框、狀態徽章、條款內文、登入提示、「即將開放」、重新登入提示。
 */
import { safePath, type AiStatus } from '@gsat/shared';
import { CircleAlert, CircleCheck, Info, LogIn, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { loginHref } from '../../lib/api';
import { AI_STATUS_BADGE, AI_STATUS_LABELS } from './labels';
import { btnPrimary, cardCls, sectionTitleCls } from './styles';

/** 學校的 Google Workspace 常限制第三方 App（ARCHITECTURE §5）。 */
export const GMAIL_HINT = '學校帳號不能用時請改用個人 Gmail';

/** AI 產生內容的固定標示（SPEC §8.4）。 */
export const AI_NOTICE = 'AI 批改，僅供參考';

type Tone = 'info' | 'warn' | 'error' | 'success';

const TONE_CLS: Record<Tone, string> = {
  info: 'border-line bg-surface-2',
  warn: 'border-badge-fg/40 bg-badge-bg text-badge-fg',
  error: 'border-bad/50 bg-surface text-fg',
  success: 'border-ok/50 bg-surface text-fg',
};

const TONE_ICON: Record<Tone, ReactNode> = {
  info: <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />,
  warn: <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />,
  error: <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-bad" />,
  success: <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ok" />,
};

/** 提示框。error 用 role="alert"（立即唸出），success 用 role="status"。 */
export function Notice({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const role = tone === 'error' ? 'alert' : tone === 'success' ? 'status' : undefined;
  return (
    <div role={role} className={`flex gap-3 rounded-xl border px-4 py-3 text-[0.95rem] ${TONE_CLS[tone]}`}>
      {TONE_ICON[tone]}
      <div className="min-w-0 flex-1 space-y-1 break-words">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function AiStatusBadge({ status }: { status: AiStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${AI_STATUS_BADGE[status]}`}>
      {AI_STATUS_LABELS[status]}
    </span>
  );
}

export function SoonBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">
      即將開放
    </span>
  );
}

export function AiNoticeBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
      {AI_NOTICE}
    </span>
  );
}

export function LoadingBlock({ label = '載入中…' }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-center text-muted">
      {label}
    </p>
  );
}

/** 「使用 Google 登入」：整頁跳到 Worker 的 /auth/google/start（不是 fetch，也不是 router 的 Link）。 */
export function GoogleLoginLink({ next, label = '使用 Google 帳號登入' }: { next: string; label?: string }) {
  return (
    <a href={loginHref(next)} className={btnPrimary}>
      <LogIn aria-hidden="true" className="size-5" />
      {label}
    </a>
  );
}

/** 需要登入的頁面在未登入時顯示（也是 /account 的登入頁）。 */
export function LoginPrompt({ next, title = '請先登入', children }: { next: string; title?: string; children?: ReactNode }) {
  return (
    <section className={cardCls}>
      <h2 className={sectionTitleCls}>{title}</h2>
      <div className="mt-2 space-y-2 text-[0.95rem]">{children}</div>
      <div className="mt-4">
        <GoogleLoginLink next={next} />
      </div>
      <p className="mt-3 text-sm text-muted">{GMAIL_HINT}。</p>
    </section>
  );
}

/** 後端還沒部署或登入／AI 機密沒設定：不是錯誤，只是「即將開放」。 */
export function ComingSoon({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={sectionTitleCls}>{title}</h2>
        <SoonBadge />
      </div>
      {children && <div className="mt-2 space-y-2 text-[0.95rem] text-muted">{children}</div>}
    </section>
  );
}

/** 敏感操作回 reauth_required 時：請使用者重新登入，登入後回到 next。 */
export function ReauthPrompt({ next, children }: { next: string; children?: ReactNode }) {
  return (
    <Notice tone="warn" title="需要重新登入">
      {children ?? <p>為了保護你的帳號，這個操作需要在最近登入過。請重新登入後再操作一次。</p>}
      <p className="pt-1">
        <a href={loginHref(next)} className="font-semibold underline underline-offset-2">
          重新登入
        </a>
      </p>
    </Notice>
  );
}

/**
 * 登入或同意完成後要回到的站內路徑：沿用後端同一支 safePath（單一斜線開頭、白名單字元、不收 //host 與 /auth），
 * 另外不回到 /account/welcome 本身（避免繞圈）；不合格就回首頁。
 */
export function safeNext(raw: string | null | undefined, fallback = '/'): string {
  const path = safePath(raw, fallback);
  if (path === '/account/welcome' || path.startsWith('/account/welcome?') || path.startsWith('/account/welcome/')) return fallback;
  return path;
}

/** /account/welcome?next=… */
export function welcomeHref(next: string): string {
  return `/account/welcome?next=${encodeURIComponent(safeNext(next))}`;
}
