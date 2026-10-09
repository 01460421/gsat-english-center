/**
 * 需要登入的頁面共用的守門元件與首次設定的自動導向。負責：前端帳號 W1。
 *
 * RequireAccount：包住需要登入的內容（/account、/ai/apply、/admin；寫作頁也可以用）。
 *   - 功能開關還在載入 → 「載入中」
 *   - features.auth 為 false（後端未部署、登入機密沒設）→ 「即將開放」，不是錯誤畫面
 *   - 未登入 → 登入提示（含「學校帳號不能用時請改用個人 Gmail」）
 *   - 需要（重新）同意條款或首次設定沒完成 → 導到 /account/welcome?next=<目前路徑>
 *   - 其他 → children（render prop 拿到已登入的 MeResponseSignedIn）
 *
 * OnboardingRedirect：放在 Layout，登入後第一次載入頁面時（整頁載入一次）若還沒完成首次設定，
 * 從任何頁面導到 /account/welcome。之後在同一次載入內瀏覽不需要登入的頁面不再強制導向
 * （學生可以先不同意、繼續看題目），需要登入的頁面則由 RequireAccount 每次把關。
 */
import type { MeResponseSignedIn } from '@gsat/shared';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { needsOnboarding, signedIn, useFeatures, useMe } from '../../lib/api';
import { ComingSoon, LoadingBlock, LoginPrompt, welcomeHref } from './ui';

export function useCurrentPath(): string {
  const location = useLocation();
  return location.pathname + location.search;
}

export function RequireAccount({
  children,
  loginTitle,
  loginMessage,
  soonTitle = '帳號功能即將開放',
  soonMessage,
}: {
  children: (me: MeResponseSignedIn) => ReactNode;
  loginTitle?: string;
  loginMessage?: ReactNode;
  soonTitle?: string;
  soonMessage?: ReactNode;
}) {
  const features = useFeatures();
  const { me, loading } = useMe();
  const path = useCurrentPath();
  if (loading) return <LoadingBlock />;
  if (!features.auth) {
    return (
      <ComingSoon title={soonTitle}>
        {soonMessage ?? <p>登入功能還在準備中。不登入也可以使用單字、歷屆試題等練習功能。</p>}
      </ComingSoon>
    );
  }
  const user = signedIn(me);
  if (!user) {
    return (
      <LoginPrompt next={path} {...(loginTitle ? { title: loginTitle } : {})}>
        {loginMessage ?? <p>這個頁面需要登入才能使用。</p>}
      </LoginPrompt>
    );
  }
  if (needsOnboarding(user)) return <Navigate to={welcomeHref(path)} replace />;
  return <>{children(user)}</>;
}

/** 每次整頁載入只自動導向一次（記住是哪個帳號），避免使用者離開歡迎頁後又被拉回來。 */
let redirectedForUser: string | null = null;

/** 測試用：重設「本次載入已導向過」的紀錄。 */
export function resetOnboardingRedirectForTests() {
  redirectedForUser = null;
}

export function OnboardingRedirect() {
  const features = useFeatures();
  const { me, loading } = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const user = signedIn(me);
  const pending = !loading && features.auth && user !== null && needsOnboarding(user);
  const onWelcome = location.pathname === '/account/welcome';
  // 公開的條款頁不導走：還沒同意的人也要能先把全文看完。
  const onPolicyPage = location.pathname === '/privacy' || location.pathname === '/terms';
  const userId = user?.user.id ?? null;

  useEffect(() => {
    if (!pending || userId === null || redirectedForUser === userId || onPolicyPage) return;
    redirectedForUser = userId;
    // 已經在歡迎頁（例如登入時 next 就是它）只記下「導向過」，不必再導一次。
    if (!onWelcome) navigate(welcomeHref(location.pathname + location.search), { replace: true });
  }, [pending, onWelcome, onPolicyPage, userId, navigate, location.pathname, location.search]);

  return null;
}
