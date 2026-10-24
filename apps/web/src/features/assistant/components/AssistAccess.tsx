/**
 * 學習助手各頁的外框：頁首（h1、AI 聲明）、暫停時的畫面、怎麼開通（docs/design/learning-assistant.md §1.10、§1.11）。
 *
 *   開關 off，或 admin 而目前不是管理員（2026-10-23 上線後，這就是緊急關閉）：
 *     - 首頁、案例頁、學習報告頁（AssistGate readOnly）：已登入時照常顯示之前的題目與報告，可以看、改「懂了嗎」、刪除，
 *       送出解析、追問、拍照、產生報告都不顯示（useAssistAccess 回 closed）；寫入的端點本來就看開關，讀、改、刪除不看。
 *     - 其他頁（錯題清單、確認頁、貼上或拍照）與沒登入：「學習助手暫停使用中」（不打學習助手的 API）。
 *   沒登入：LoginPrompt；登入但 AI 未核准、未同意新版：說明怎麼申請、去同意（AI 批改同一套流程）。
 *   全站暫停：動作停用，顯示暫停的原因。
 * 這裡的文案寫「AI」而不是「AI 批改」：學習助手不打分數。
 */
import { AI_ERROR_MESSAGES } from '@gsat/shared';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { loginHref, useMe } from '../../../lib/api';
import { APP_NAME } from '../../../modules';
import { welcomeHref } from '../../account/ui';
import { AiNotice, Notice } from '../../writing/components/ui';
import { useAiAccess, useSignedIn, type AiAccess } from '../../writing/lib/access';
import { AI_PAUSED_MESSAGE } from '../../writing/lib/errors';
import { useAssistantEnabled } from '../lib/useAssistantEnabled';
import { weakPaperVisible } from '../papers/flags';

const linkCls = 'font-medium text-primary underline underline-offset-2';

/** 頁首：h1＋說明＋AI 聲明（每個學習助手頁面頂端固定）。 */
export function AssistHeader({ title, docTitle, children, aiNotice = true }: { title: string; docTitle?: string; children?: ReactNode; aiNotice?: boolean }) {
  return (
    <header className="space-y-2">
      <title>{`${docTitle ?? title}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      {children}
      {aiNotice && <AiNotice variant="assistant" />}
    </header>
  );
}

/**
 * 學習助手對這位使用者能不能送出新的 AI 任務：AiAccess 再加一種 closed（開關關著、頁面是唯讀模式）。
 * 學習助手的頁面一律用 useAssistAccess，不直接用 useAiAccess。
 */
export type AssistAccess = AiAccess | { state: 'closed' };

/** AssistGate 的唯讀模式（開關關著，但已登入的學生仍然可以看與刪除之前的紀錄）。 */
const AssistReadOnlyContext = createContext(false);

export function useAssistReadOnly(): boolean {
  return useContext(AssistReadOnlyContext);
}

export function useAssistAccess(): AssistAccess {
  const readOnly = useAssistReadOnly();
  const access = useAiAccess();
  return readOnly ? { state: 'closed' } : access;
}

/** 加強卷不用 AI（docs/design/weak-paper.md §9.3）：學習助手暫停時照常能用，暫停的畫面另外指過去。 */
function PapersStillOpen() {
  const [visible] = useState(weakPaperVisible);
  if (!visible) return null;
  return (
    <p className="text-sm text-muted">
      加強卷不用 AI，照常可以組卷：
      <Link to="/assistant/papers" className={`ml-1 ${linkCls}`}>
        加強卷
      </Link>
    </p>
  );
}

/** 開關關著（不是唯讀的頁面，或沒登入）：「學習助手暫停使用中」。登入的人另外指到首頁看之前的紀錄。 */
export function AssistantClosed({ title = '學習助手' }: { title?: string }) {
  const signedIn = useSignedIn();
  return (
    <section className="space-y-3 py-2">
      <title>{`${title}｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      <p className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">
        學習助手暫停使用中，暫時不能送出新的題目、追問或產生學習報告。
        {signedIn && '你之前問過的題目與學習報告仍然可以看與刪除。'}
      </p>
      {signedIn ? (
        <Link to="/assistant" className={linkCls}>
          看之前的題目與學習報告
        </Link>
      ) : (
        <Link to="/" className={linkCls}>
          回到首頁
        </Link>
      )}
      <PapersStillOpen />
    </section>
  );
}

/**
 * 每個學習助手頁面的門：登入狀態讀完之前只顯示載入中（不要先閃「暫停使用中」），開關打開時 render 頁面本身。
 * 開關關著時：readOnly 的頁面（首頁、案例、學習報告）對已登入的人以唯讀模式 render（useAssistAccess 回 closed），
 * 其他情況顯示「暫停使用中」、不打學習助手的 API。
 */
export function AssistGate({ children, readOnly = false }: { children: ReactNode; readOnly?: boolean }) {
  const enabled = useAssistantEnabled();
  const signedIn = useSignedIn();
  const { loading } = useMe();
  if (loading) {
    return (
      <section className="py-10 text-center">
        <title>{`學習助手｜${APP_NAME}`}</title>
        <h1 className="sr-only">學習助手</h1>
        <p role="status" className="text-muted">
          載入中…
        </p>
      </section>
    );
  }
  if (enabled) return children;
  if (readOnly && signedIn) return <AssistReadOnlyContext.Provider value={true}>{children}</AssistReadOnlyContext.Provider>;
  return <AssistantClosed />;
}

/** 不能送出 AI 任務時，告訴學生怎麼開通；ready、loading 回 null。 */
export function AssistAccessNotice({ access }: { access: AssistAccess }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  switch (access.state) {
    case 'loading':
    case 'ready':
      return null;
    case 'closed':
      return (
        <Notice tone="warn">
          <p>學習助手暫停使用中，暫時不能送出新的解析、追問或產生學習報告；你之前的題目與學習報告仍然可以看與刪除。</p>
        </Notice>
      );
    case 'off':
      return (
        <Notice>
          <p>AI 功能暫時沒有開放，可以先看錯題清單與本站解析。</p>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice>
          <p>
            請學習助手解析要先登入並申請使用 AI。
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
          <p>你的帳號已停權，暫時不能使用學習助手。</p>
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
              ? '你的 AI 使用申請審核中，核准後就能請學習助手解析。'
              : access.aiStatus === 'waitlist'
                ? '目前名額已滿，你在候補名單上；有名額時會通知你。'
                : access.aiStatus === 'suspended'
                  ? '你的 AI 使用權限已停用；之前的解析仍然可以看與刪除。'
                  : '請學習助手解析要先申請使用 AI。'}
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
            AI 資料處理說明已經更新，重新同意後才能繼續使用學習助手。
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
