/**
 * 國寫範文獨立頁的外框（寫法同學習助手的 AssistAccess、作文範文的 ExemplarAccess）：開關、唯讀模式、怎麼開通。
 *
 *   開：國文的國寫範文對這位使用者開放（/api/features 的 assistantSubjects 國文那一筆 exemplar: true，或管理員預覽；
 *       useZhExemplarEnabled）。學習助手或國文關著時一定是關。
 *   關（AI_ZH_EXEMPLAR 緊急關閉，或學習助手、國文關著）：
 *     - 已登入：唯讀模式（ZhWritingGate）：說明暫停，「我的國寫範文」與之前的示範照常可以看與刪除；選題、貼上、送出都不顯示。
 *       讀與刪除的端點（GET /api/assist/zh-exemplars、GET／DELETE /api/assist/cases/{id}）本來就不看開關。
 *     - 沒登入：只顯示暫停，不打學習助手的 API。
 *   開著但不能送出（沒登入、AI 沒核准、待同意、全站暫停）：選題與貼上都不顯示，只說明怎麼開通（ZhWritingAccessNotice）。
 * 文案寫「AI 示範」：國寫範文不打分數。
 */
import { AI_ERROR_MESSAGES } from '@gsat/shared';
import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { Link, useLocation } from 'react-router';
import { loginHref, useMe } from '../../../../lib/api';
import { APP_NAME } from '../../../../modules';
import { welcomeHref } from '../../../account/ui';
import { AiNotice, Notice } from '../../../writing/components/ui';
import { useAiAccess, useSignedIn, type AiAccess } from '../../../writing/lib/access';
import { AI_PAUSED_MESSAGE } from '../../../writing/lib/errors';
import { useZhExemplarEnabled } from '../../lib/useAssistantEnabled';
import { ZH_WRITING_COPY, ZH_WRITING_TITLE } from '../labels';

const linkCls = 'font-medium text-primary underline underline-offset-2';

/** 能不能送出新的範文：AiAccess 再加一種 closed（開關關著、頁面是唯讀模式）。 */
export type ZhWritingAccess = AiAccess | { state: 'closed' };

const ReadOnlyContext = createContext(false);

export function useZhWritingReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

export function useZhWritingAccess(): ZhWritingAccess {
  const readOnly = useZhWritingReadOnly();
  const access = useAiAccess();
  return readOnly ? { state: 'closed' } : access;
}

/** 頁首：h1＋說明＋AI 聲明。headingRef：要把焦點移到 h1 的頁面（結果頁）傳進來，h1 會加 tabIndex=-1。 */
export function ZhWritingHeader({
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
      <title>{`${docTitle ?? title}｜${APP_NAME}`}</title>
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="text-2xl font-bold tracking-tight break-words focus:outline-none lg:text-3xl">
        {title}
      </h1>
      {children}
      <AiNotice variant="assistant" />
    </header>
  );
}

/** 開關關著、沒登入：暫停說明（不打學習助手的 API）。 */
export function ZhWritingClosed() {
  return (
    <section className="space-y-3 py-2">
      <title>{`${ZH_WRITING_TITLE}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{ZH_WRITING_TITLE}</h1>
      <p className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">{ZH_WRITING_COPY.closedSignedOut}</p>
      <Link to="/" className={linkCls}>
        回到首頁
      </Link>
    </section>
  );
}

/**
 * 每個國寫範文頁面的門：登入狀態讀完之前只顯示載入中（不要先閃「暫停使用中」）；開關打開時 render 頁面本身；
 * 開關關著時已登入的人以唯讀模式 render，沒登入顯示暫停。
 */
export function ZhWritingGate({ children }: { children: ReactNode }) {
  const enabled = useZhExemplarEnabled();
  const signedIn = useSignedIn();
  const { loading } = useMe();
  if (loading) {
    return (
      <section className="py-10 text-center">
        <title>{`${ZH_WRITING_TITLE}｜${APP_NAME}`}</title>
        <h1 className="sr-only">{ZH_WRITING_TITLE}</h1>
        <p role="status" className="text-muted">
          載入中…
        </p>
      </section>
    );
  }
  if (enabled) return children;
  if (signedIn) return <ReadOnlyContext.Provider value={true}>{children}</ReadOnlyContext.Provider>;
  return <ZhWritingClosed />;
}

/** 不能送出新的範文時，告訴學生怎麼開通；ready、loading 回 null。 */
export function ZhWritingAccessNotice({ access }: { access: ZhWritingAccess }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  switch (access.state) {
    case 'loading':
    case 'ready':
      return null;
    case 'closed':
      return (
        <Notice tone="warn">
          <p>{ZH_WRITING_COPY.closed}</p>
        </Notice>
      );
    case 'off':
      return (
        <Notice>
          <p>{ZH_WRITING_COPY.off}</p>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice>
          <p>
            {ZH_WRITING_COPY.signedOut}
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
          <p>{ZH_WRITING_COPY.suspended}</p>
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
              ? ZH_WRITING_COPY.applyPending
              : access.aiStatus === 'waitlist'
                ? ZH_WRITING_COPY.applyWaitlist
                : access.aiStatus === 'suspended'
                  ? ZH_WRITING_COPY.applySuspended
                  : ZH_WRITING_COPY.applyNone}
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
            {ZH_WRITING_COPY.aiConsent}
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
