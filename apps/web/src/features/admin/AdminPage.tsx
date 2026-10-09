/**
 * /admin：管理後台（只有管理員）。負責：前端後台 W1。
 *
 *   - 設定與啟動檢查：GET /api/admin/health（設定只顯示有／沒有、遷移、§6.3 啟動檢查，紅綠燈）
 *   - 全站 AI 開關：POST /api/admin/ai/pause（AdminAiPauseBody）
 *   - 使用者與 AI 申請：GET /api/admin/users、POST /api/admin/users/{public_id}/{action}
 *   - AI 用量摘要：GET /api/admin/usage
 * 非管理員顯示「沒有權限」，不打任何後台 API。後台寫入要求 12 小時內登入過：回 reauth_required 時頁首顯示「重新登入」。
 */
import { useCallback, useState } from 'react';
import { APP_NAME } from '../../modules';
import { RequireAccount } from '../account/RequireAccount';
import { cardCls, pageTitleCls, sectionTitleCls } from '../account/styles';
import { ReauthPrompt } from '../account/ui';
import { useApiData } from '../account/useApiData';
import { isAdminHealthResponse } from './guards';
import { HealthSection, PauseSection } from './HealthSection';
import { UsageSection } from './UsageSection';
import { UsersSection } from './UsersSection';

export default function AdminPage() {
  return (
    <article>
      <title>{`管理後台｜${APP_NAME}`}</title>
      <h1 className={pageTitleCls}>管理後台</h1>
      <div className="mt-6 grid grid-cols-1 gap-4">
        <RequireAccount
          soonTitle="管理後台即將開放"
          soonMessage={<p>後端部署並設定登入後，站主就能在這裡審核 AI 申請與查看用量。</p>}
          loginMessage={<p>管理後台只有站主（管理員）可以使用，請先登入。</p>}
        >
          {(me) => (me.user.role === 'admin' ? <AdminDashboard selfId={me.user.id} /> : <NoPermission />)}
        </RequireAccount>
      </div>
    </article>
  );
}

function NoPermission() {
  return (
    <section className={cardCls}>
      <h2 className={sectionTitleCls}>沒有權限</h2>
      <p className="mt-2 text-[0.95rem]">你沒有管理後台的權限。管理後台只有站主（管理員）可以使用。</p>
    </section>
  );
}

const SECTIONS = [
  { id: 'admin-health', label: '設定檢查' },
  { id: 'admin-pause', label: 'AI 開關' },
  { id: 'admin-users', label: '使用者' },
  { id: 'admin-usage', label: '用量' },
] as const;

function AdminDashboard({ selfId }: { selfId: string }) {
  const health = useApiData('/api/admin/health', isAdminHealthResponse);
  const [needReauth, setNeedReauth] = useState(false);
  const onReauth = useCallback(() => setNeedReauth(true), []);

  return (
    <>
      <nav aria-label="後台區塊" className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
            {s.label}
          </a>
        ))}
      </nav>
      {needReauth && (
        <ReauthPrompt next="/admin">
          <p>後台的寫入操作需要在 12 小時內登入過。請重新登入後再操作一次。</p>
        </ReauthPrompt>
      )}
      <HealthSection health={health} />
      <PauseSection health={health} onReauth={onReauth} />
      <UsersSection selfId={selfId} approvalsAllowed={health.data?.approvals_allowed ?? null} onReauth={onReauth} />
      <UsageSection />
    </>
  );
}
