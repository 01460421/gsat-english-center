/**
 * 作文範文各頁的外框（docs/design/model-essays.md §1.10、§1.11）：開關、唯讀模式、怎麼開通。寫法同學習助手的 AssistAccess。
 *
 *   開關 off，或 admin 而目前不是管理員（緊急關閉）：
 *     - 已登入：唯讀模式（ExemplarsGate readOnly）：說明暫停，之前的範文可以看與刪除；表單、選題、產生、重新產生都不顯示
 *       （useExemplarAccess 回 closed）。讀、評分、刪除的端點本來就不看開關。
 *     - 沒登入：只顯示「作文範文暫停使用中」，不打作文範文的 API。
 *   開關開著：沒登入、AI 未核准、待同意、全站暫停 → 確認畫面顯示怎麼開通（ExemplarAccessNotice）。
 * 文案寫「AI」而不是「AI 批改」：作文範文不打分數。
 */
import { AI_ERROR_MESSAGES } from '@gsat/shared';
import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { loginHref, useMe } from '../../../../lib/api';
import { APP_NAME } from '../../../../modules';
import { welcomeHref } from '../../../account/ui';
import { AiNotice, Notice } from '../../components/ui';
import { useAiAccess, useSignedIn, type AiAccess } from '../../lib/access';
import { AI_PAUSED_MESSAGE } from '../../lib/errors';
import { CLOSED_SIGNED_OUT_TEXT, CLOSED_TEXT, EXEMPLARS_PATH, EXEMPLARS_TITLE } from '../labels';
import { useExemplarsEnabled } from '../lib/useExemplarsEnabled';

const linkCls = 'font-medium text-primary underline underline-offset-2';

/** 能不能產生新的範文：AiAccess 再加一種 closed（開關關著、頁面是唯讀模式）。 */
export type ExemplarAccess = AiAccess | { state: 'closed' };

const ReadOnlyContext = createContext(false);

export function useExemplarsReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function useExemplarAccess(): ExemplarAccess {
  const readOnly = useExemplarsReadOnly();
  const access = useAiAccess();
  return readOnly ? { state: 'closed' } : access;
}

/** 頁首：h1＋說明＋AI 聲明。headingRef：完成時要把焦點移到 h1 的頁面（結果頁）傳進來，h1 會加 tabIndex=-1。 */
export function ExemplarsHeader({
  title,
  docTitle,
  headingRef,
  children,
}: {
  title: string;
  docTitle?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
}) {
  return (
    <header className="space-y-2">
      <title>{`${docTitle ?? title}｜寫作練習｜${APP_NAME}`}</title>
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-2xl font-bold tracking-tight break-words focus:outline-none lg:text-3xl">
        {title}
      </h1>
      {children}
      <AiNotice variant="exemplar" />
    </header>
  );
}

/** 開關關著、沒登入：暫停說明（不打作文範文的 API）。 */
export function ExemplarsClosed() {
  return (
    <section className="space-y-3 py-2">
      <title>{`${EXEMPLARS_TITLE}｜寫作練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{EXEMPLARS_TITLE}</h1>
      <p className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">{CLOSED_SIGNED_OUT_TEXT}</p>
      <Link to="/writing" className={linkCls}>
        回到寫作練習
      </Link>
    </section>
  );
}

/**
 * 每個作文範文頁面的門：登入狀態讀完之前只顯示載入中（不要先閃「暫停使用中」）；開關打開時 render 頁面本身；
 * 開關關著時已登入的人以唯讀模式 render，沒登入顯示暫停。
 */
export function ExemplarsGate({ children }: { children: ReactNode }) {
  const enabled = useExemplarsEnabled();
  const signedIn = useSignedIn();
  const { loading } = useMe();
  if (loading) {
    return (
      <section className="py-10 text-center">
        <title>{`${EXEMPLARS_TITLE}｜寫作練習｜${APP_NAME}`}</title>
        <h1 className="sr-only">{EXEMPLARS_TITLE}</h1>
        <p role="status" className="text-muted">
          載入中…
        </p>
      </section>
    );
  }
  if (enabled) return children;
  if (signedIn) return <ReadOnlyContext.Provider value={true}>{children}</ReadOnlyContext.Provider>;
  return <ExemplarsClosed />;
}

/** 不能產生新的範文時，告訴學生怎麼開通；ready、loading 回 null。 */
export function ExemplarAccessNotice({ access }: { access: ExemplarAccess }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  switch (access.state) {
    case 'loading':
    case 'ready':
      return null;
    case 'closed':
      return (
        <Notice tone="warn">
          <p>{CLOSED_TEXT}</p>
        </Notice>
      );
    case 'off':
      return (
        <Notice>
          <p>AI 功能暫時沒有開放。</p>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice>
          <p>
            產生範文要先登入並申請使用 AI。
            <a href={loginHref(here)} className={`ml-1 ${linkCls}`}>
              用 Google 登入
            </a>
            ，登入後到
            <Link to="/ai/apply" className={`mx-1 ${linkCls}`}>
              申請使用 AI
            </Link>
            ，站主核准後就能使用。
          </p>
        </Notice>
      );
    case 'account_suspended':
      return (
        <Notice tone="warn">
          <p>你的帳號已停權，暫時不能產生範文。</p>
        </Notice>
      );
    case 'consent':
      return (
        <Notice tone="warn">
          <p>
            {AI_ERROR_MESSAGES.consent_required}。
            <Link to={welcomeHref(here)} className={`ml-1 ${linkCls}`}>
              前往同意
            </Link>
          </p>
        </Notice>
      );
    case 'apply':
      return (
        <Notice>
          <p>
            {access.aiStatus === 'pending'
              ? '你的 AI 使用申請審核中，核准後就能產生範文。'
              : access.aiStatus === 'waitlist'
                ? '目前名額已滿，你在候補名單上；有名額時會通知你。'
                : access.aiStatus === 'suspended'
                  ? '你的 AI 使用權限已停用；之前的範文仍然可以看與刪除。'
                  : '產生範文要先申請使用 AI。'}
            {(access.aiStatus === 'none' || access.aiStatus === 'rejected') && (
              <Link to="/ai/apply" className={`ml-1 ${linkCls}`}>
                申請使用 AI
              </Link>
            )}
          </p>
        </Notice>
      );
    case 'ai_consent':
      return (
        <Notice tone="warn">
          <p>
            AI 資料處理說明已經更新，重新同意後才能產生範文。
            <Link to="/ai/apply" className={`ml-1 ${linkCls}`}>
              前往重新同意
            </Link>
          </p>
        </Notice>
      );
    case 'paused':
      return (
        <Notice tone="warn">
          <p>{AI_PAUSED_MESSAGE}。</p>
        </Notice>
      );
  }
}

/** 回到作文範文首頁的連結文字與網址。 */
export const BACK_TO_HOME = { to: EXEMPLARS_PATH, label: EXEMPLARS_TITLE } as const;
