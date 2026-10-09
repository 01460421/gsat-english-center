/**
 * 版面上的登入按鈕與帳號選單（手機頂端列右上角、桌機側邊欄品牌下方）。負責：前端帳號 W1。
 *
 *   - features.auth 為 false（後端未部署或登入機密未設定）或還在載入：什麼都不顯示（不閃一下「登入」）。
 *   - 未登入：「登入」連結，整頁跳到 /auth/google/start?next=<目前站內路徑>（不是 fetch，cookie 由 Worker 種）。
 *     桌機側邊欄另外顯示「學校帳號不能用時請改用個人 Gmail」。
 *   - 已登入：暱稱按鈕，展開選單：我的帳號、AI 申請狀態、管理後台（只有 admin）、登出。
 *
 * Layout 同時放了頂端列與側邊欄兩份（用 CSS 切換顯示），所以 id 一律用 useId，不寫死。
 */
import type { MeResponseSignedIn } from '@gsat/shared';
import { ChevronDown, LogIn, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, type Location } from 'react-router';
import { apiPost, loginHref, signedIn, useFeatures, useMe } from '../../lib/api';
import { errorMessage } from '../../lib/apiErrors';
import { clearLocalWritingData } from '../writing/lib/drafts';
import { AI_STATUS_LABELS, ROLE_LABELS } from './labels';
import { AiStatusBadge, GMAIL_HINT, SoonBadge } from './ui';

export type LoginButtonPlacement = 'topbar' | 'sidebar';

/** 登入後要回到的路徑：目前頁面，但拿掉 /account 的 auth_error（登入成功回來後不要再顯示上次的錯誤）。 */
export function loginNext(location: Pick<Location, 'pathname' | 'search'>): string {
  const params = new URLSearchParams(location.search);
  params.delete('auth_error');
  const search = params.toString();
  return location.pathname + (search ? `?${search}` : '');
}

/** 暱稱（沒設時顯示「我的帳號」）。 */
export function displayNameOf(me: MeResponseSignedIn): string {
  return me.user.display_name?.trim() || '我的帳號';
}

function Avatar({ name, className = 'size-7 text-sm' }: { name: string; className?: string }) {
  const initial = Array.from(name)[0] ?? '我';
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary ${className}`}
    >
      {initial}
    </span>
  );
}

export function LoginButton({ placement = 'topbar' }: { placement?: LoginButtonPlacement }) {
  const features = useFeatures();
  const { me, loading } = useMe();
  const location = useLocation();
  if (!features.auth || loading) return null;
  const user = signedIn(me);
  const next = loginNext(location);

  if (!user) {
    if (placement === 'sidebar') {
      return (
        <div className="px-3 pb-2">
          <a
            href={loginHref(next)}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 font-medium text-on-primary hover:opacity-90"
          >
            <LogIn aria-hidden="true" className="size-4" />
            使用 Google 登入
          </a>
          <p className="mt-1 px-1 text-xs text-muted">{GMAIL_HINT}</p>
        </div>
      );
    }
    return (
      <a
        href={loginHref(next)}
        title={GMAIL_HINT}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium hover:bg-surface-2"
      >
        <LogIn aria-hidden="true" className="size-4" />
        登入
      </a>
    );
  }

  return placement === 'sidebar' ? (
    <div className="px-3 pb-2">
      <AccountMenu me={user} placement="sidebar" />
    </div>
  ) : (
    <AccountMenu me={user} placement="topbar" />
  );
}

const menuItemCls = 'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[0.95rem] hover:bg-surface-2';

function AccountMenu({ me, placement }: { me: MeResponseSignedIn; placement: LoginButtonPlacement }) {
  const features = useFeatures();
  const { refresh, applyMe } = useMe();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const name = displayNameOf(me);
  const isAdmin = me.user.role === 'admin';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/logout');
    } catch (err) {
      setBusy(false);
      setError(`登出失敗：${errorMessage(err)}`);
      return;
    }
    // 公用電腦：下一位使用者不該看到這台裝置上的作文草稿。
    clearLocalWritingData();
    setBusy(false);
    setOpen(false);
    applyMe({ user: null });
    void refresh();
  }

  const panelPosition = placement === 'sidebar' ? 'inset-x-0 top-full mt-1' : 'right-0 top-full mt-2 w-64 max-w-[calc(100vw-2rem)]';

  return (
    <div ref={rootRef} className="relative">
      {placement === 'sidebar' ? (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${name}（帳號選單）`}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-line px-3 py-1.5 text-left hover:bg-surface-2"
        >
          <Avatar name={name} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="block truncate text-xs text-muted">
              {isAdmin ? ROLE_LABELS.admin : `AI 批改：${AI_STATUS_LABELS[me.user.ai_status]}`}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${name}（帳號選單）`}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line py-0 pr-2.5 pl-1 text-sm font-medium hover:bg-surface-2"
        >
          <Avatar name={name} />
          <span className="max-w-[3.5rem] truncate sm:max-w-[8rem]">{name}</span>
        </button>
      )}

      {open && (
        <div id={panelId} className={`absolute z-30 rounded-2xl border border-line bg-surface p-2 shadow-lg ${panelPosition}`}>
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar name={name} className="size-9 text-base" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{name}</p>
              <p className="text-xs text-muted">{ROLE_LABELS[me.user.role]}</p>
            </div>
          </div>
          <ul className="border-t border-line pt-1">
            <li>
              <Link to="/account" onClick={close} className={menuItemCls}>
                我的帳號
              </Link>
            </li>
            <li>
              <Link to="/ai/apply" onClick={close} className={menuItemCls}>
                <span className="flex-1">AI 申請狀態</span>
                {features.ai ? <AiStatusBadge status={me.user.ai_status} /> : <SoonBadge />}
              </Link>
            </li>
            {isAdmin && (
              <li>
                <Link to="/admin" onClick={close} className={menuItemCls}>
                  管理後台
                </Link>
              </li>
            )}
            <li className="mt-1 border-t border-line pt-1">
              <button type="button" onClick={logout} disabled={busy} className={`${menuItemCls} disabled:opacity-50`}>
                <LogOut aria-hidden="true" className="size-4 text-muted" />
                {busy ? '登出中…' : '登出'}
              </button>
            </li>
          </ul>
          {error && (
            <p role="alert" className="px-3 pt-1 pb-2 text-sm text-bad">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
