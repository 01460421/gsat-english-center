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
            {/* 桌機的右欄窄：連結文字整段一起換行，不拆成「用 Google 登／入」。 */}
            <a href={loginHref(here)} className={`ml-1 lg:whitespace-nowrap ${linkClass}`}>
              用 Google 登入
            </a>
            ，登入後到
            <Link to="/ai/apply" className={`mx-1 lg:whitespace-nowrap ${linkClass}`}>
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

/**
 * 點數量表（docs/design/desktop-ui.md §5.5；首頁與 /writing 在桌機的右欄用）：今日、本月、今日作文三列。
 * 資訊本體是文字（「今日剩 20／30 點」），旁邊的細條只是裝飾（aria-hidden）：<meter> 各瀏覽器的樣式不一、深色模式不好上色。
 * 條的長度是「剩下的」比例；不限的一列只寫「不限」、不畫條。
 */
export function QuotaMeters({ quota }: { quota: AiQuotaResponse }) {
  const { points, essays } = quota;
  const dayReset = formatResetTime(quota.resets_at.day);
  const monthReset = formatResetTime(quota.resets_at.month);
  const rows = [
    { key: 'day', label: '今日', used: points.day_used, limit: points.day_limit, unit: '點', reset: dayReset },
    { key: 'month', label: '本月', used: points.month_used, limit: points.month_limit, unit: '點', reset: monthReset },
    { key: 'essays', label: '今日作文', used: essays.day_used, limit: essays.day_limit, unit: '篇', reset: dayReset },
  ];
  return (
    <ul className="space-y-3" data-testid="quota-meters">
      {rows.map((r) => {
        const unlimited = isUnlimited(r.limit);
        const left = Math.max(0, r.limit - r.used);
        const ratio = r.limit > 0 ? left / r.limit : 0;
        return (
          <li key={r.key}>
            <p className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{r.label}</span>
              {unlimited ? (
                <span className="text-muted">
                  不限（已用 <span className="tabular-nums">{r.used}</span> {r.unit}）
                </span>
              ) : (
                <span>
                  剩 <strong className="tabular-nums">{left}</strong>
                  <span className="text-muted tabular-nums">
                    ／{r.limit} {r.unit}
                  </span>
                </span>
              )}
            </p>
            {!unlimited && (
              <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span className={`block h-full rounded-full ${left === 0 ? 'bg-bad' : 'bg-primary'}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
              </span>
            )}
            {r.key !== 'essays' && r.reset && <span className="mt-0.5 block text-xs text-muted">{r.reset} 重置</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** 各任務的點數（送出按鈕旁顯示）；後端回的 task_points 優先。 */
export function taskPoints(quota: AiQuotaResponse | null, task: keyof typeof AI_TASK_POINTS): number {
  return quota?.task_points[task] ?? AI_TASK_POINTS[task];
}
