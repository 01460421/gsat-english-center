/**
 * AI 批改的開通說明與剩餘點數。後端沒部署或 AI 沒開時只顯示「即將開放」，不出現錯誤畫面。
 */
import { AI_ERROR_MESSAGES, AI_TASK_POINTS, type AiQuotaResponse } from '@gsat/shared';
import { Link, useLocation } from 'react-router';
import { loginHref } from '../../../lib/api';
import { welcomeHref } from '../../account/ui';
import type { AiAccess } from '../lib/access';
import { AI_PAUSED_MESSAGE, formatResetTime } from '../lib/errors';
import { Notice } from './ui';

const linkClass = 'font-medium text-primary underline underline-offset-2';

/** 依目前狀態告訴學生 AI 批改怎麼開通。ready 時回 null（由呼叫端顯示送出按鈕）。 */
export function AiAccessNotice({ access, compact = false }: { access: AiAccess; compact?: boolean }) {
  const location = useLocation();
  const here = location.pathname + location.search;
  switch (access.state) {
    case 'loading':
    case 'ready':
      return null;
    case 'off':
      return (
        <Notice>
          <p>
            <strong>AI 批改即將開放。</strong>
            {compact ? '現在可以先用自我檢核練習。' : '開放後，登入並通過申請就能請 AI 依大考評分原則批改；現在可以先用自我檢核練習。'}
          </p>
        </Notice>
      );
    case 'signed_out':
      return (
        <Notice>
          <p>
            AI 批改需要先登入並申請。
            <a href={loginHref(here)} className={`ml-1 ${linkClass}`}>
              用 Google 登入
            </a>
            ，登入後到
            <Link to="/ai/apply" className={`mx-1 ${linkClass}`}>
              申請 AI 批改
            </Link>
            填寫用途，站主核准後就能使用。
          </p>
        </Notice>
      );
    case 'account_suspended':
      return (
        <Notice tone="warn">
          <p>你的帳號已停權，暫時不能使用 AI 批改；自我檢核仍可使用。</p>
        </Notice>
      );
    case 'consent':
      // 同意完成後回到這一頁（welcomeHref 帶 next，WelcomePage 送出後導回）。
      return (
        <Notice tone="warn">
          <p>
            {AI_ERROR_MESSAGES.consent_required}。
            <Link to={welcomeHref(here)} className={`ml-1 ${linkClass}`}>
              前往同意
            </Link>
          </p>
        </Notice>
      );
    case 'apply':
      return <ApplyNotice aiStatus={access.aiStatus} />;
    case 'ai_consent':
      return (
        <Notice tone="warn">
          <p>
            AI 資料處理說明已經更新，重新同意後才能繼續使用 AI 批改；自我檢核仍可使用。
            <Link to="/ai/apply" className={`ml-1 ${linkClass}`}>
              前往重新同意
            </Link>
          </p>
        </Notice>
      );
    case 'paused':
      return (
        <Notice tone="warn">
          <p>{AI_PAUSED_MESSAGE}；自我檢核仍可使用。</p>
        </Notice>
      );
  }
}

function ApplyNotice({ aiStatus }: { aiStatus: Extract<AiAccess, { state: 'apply' }>['aiStatus'] }) {
  switch (aiStatus) {
    case 'none':
      return (
        <Notice>
          <p>
            AI 批改需要先申請。
            <Link to="/ai/apply" className={`ml-1 ${linkClass}`}>
              申請 AI 批改
            </Link>
            ：填一句用途並同意資料處理方式，站主核准後就能使用。
          </p>
        </Notice>
      );
    case 'pending':
      return (
        <Notice>
          <p>你的 AI 批改申請已送出，正在等站主核准；核准前可以先用自我檢核練習。</p>
        </Notice>
      );
    case 'waitlist':
      return (
        <Notice>
          <p>本月 AI 批改名額已滿，你已排入候補；有名額時站主會依序核准。</p>
        </Notice>
      );
    case 'rejected':
      return (
        <Notice tone="warn">
          <p>
            你的 AI 批改申請沒有通過，可以補充用途後再申請一次。
            <Link to="/ai/apply" className={`ml-1 ${linkClass}`}>
              重新申請
            </Link>
          </p>
        </Notice>
      );
    case 'suspended':
      return (
        <Notice tone="warn">
          <p>你的 AI 批改功能已暫停使用；自我檢核仍可使用。</p>
        </Notice>
      );
  }
}

/**
 * 管理員與 unlimited 等級的上限是很大的數字（後端 guard.ts 的 UNLIMITED＝10 億），畫面顯示「不限」
 * （和 features/account/AiApplyPage 的門檻相同）。
 */
const UNLIMITED_THRESHOLD = 100_000_000;
export const isUnlimited = (limit: number) => limit >= UNLIMITED_THRESHOLD;

/** 剩餘點數、今日作文篇數與重置時間（SPEC §8.3：畫面隨時顯示）。 */
export function QuotaSummary({ quota }: { quota: AiQuotaResponse | null }) {
  if (!quota) return null;
  const { points, essays } = quota;
  const reset = formatResetTime(quota.resets_at.day);
  if (isUnlimited(points.day_limit) && isUnlimited(points.month_limit)) {
    return (
      <p className="text-sm text-muted" data-testid="quota-summary">
        AI 點數：不限（今天已用 <span className="tabular-nums">{points.day_used}</span> 點・今天已批改作文 {essays.day_used} 篇）
      </p>
    );
  }
  const dayLeft = Math.max(0, points.day_limit - points.day_used);
  const monthLeft = Math.max(0, points.month_limit - points.month_used);
  return (
    <p className="text-sm text-muted" data-testid="quota-summary">
      AI 點數：今天剩 <strong className="text-fg tabular-nums">{dayLeft}</strong>／{points.day_limit} 點・本月剩{' '}
      <span className="tabular-nums">{monthLeft}</span>／{points.month_limit} 點・今天已批改作文 {essays.day_used}
      {isUnlimited(essays.day_limit) ? ' 篇' : `／${essays.day_limit} 篇`}
      {reset ? `・${reset} 重置` : ''}
    </p>
  );
}

/** 各任務的點數（送出按鈕旁顯示）；後端回的 task_points 優先。 */
export function taskPoints(quota: AiQuotaResponse | null, task: keyof typeof AI_TASK_POINTS): number {
  return quota?.task_points[task] ?? AI_TASK_POINTS[task];
}
