/**
 * 錯誤 → 畫面訊息時要帶的情境（登入網址、目前的 /api/me、同意後回到哪裡），寫作頁各處共用。
 *
 * consent_required 要依「最新的」/api/me 判斷原因：學生開著分頁時站主改了條款或 AI 處理說明版本，
 * SessionProvider 手上的 me 還是舊的（pending_consents 空的）。所以收到 consent_required 先重新讀一次 /api/me、
 * 套用到全站登入狀態（需要同意時版面與結果頁會自己導到歡迎頁），再決定帶學生去 /account/welcome 還是 /ai/apply。
 */
import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router';
import { ApiRequestError, fetchMe, loginHref, useMe } from '../../../lib/api';
import { describeError, type DescribeContext, type ErrorView } from './errors';

export function isConsentError(err: unknown): boolean {
  return err instanceof ApiRequestError && err.code === 'consent_required';
}

/** 重新讀 /api/me 並套用；讀不到（網路）就維持原狀，不要把學生變成未登入。 */
function useRefreshMe(): () => Promise<ReturnType<typeof useMe>['me'] | null> {
  const { applyMe } = useMe();
  return useCallback(async () => {
    const fresh = await fetchMe().catch(() => null);
    if (!fresh?.user) return null;
    applyMe(fresh);
    return fresh;
  }, [applyMe]);
}

/**
 * 回傳 async (err, extra) => ErrorView：自動帶入登入網址、me、returnTo（目前路徑）；
 * consent_required 時先重新讀 /api/me。
 */
export function useErrorView(): (err: unknown, extra?: Pick<DescribeContext, 'quota' | 'submitting'>) => Promise<ErrorView> {
  const location = useLocation();
  const { me } = useMe();
  const refreshMe = useRefreshMe();
  const path = location.pathname;
  return useCallback(
    async (err, extra = {}) => {
      const current = isConsentError(err) ? ((await refreshMe()) ?? me) : me;
      return describeError(err, { ...extra, loginHref: loginHref(path), me: current, returnTo: path });
    },
    [me, path, refreshMe],
  );
}

/** 同步版（render 時直接算）：情境同上，但不重新讀 /api/me（搭配 useRefreshMeOnConsentError）。 */
export function useDescribeContext(): Pick<DescribeContext, 'loginHref' | 'me' | 'returnTo'> {
  const location = useLocation();
  const { me } = useMe();
  return { loginHref: loginHref(location.pathname), me, returnTo: location.pathname };
}

/** 輪詢之類「錯誤放在 state 裡、render 時才轉成訊息」的地方：拿到 consent_required 就重新讀一次 /api/me。 */
export function useRefreshMeOnConsentError(error: unknown): void {
  const refreshMe = useRefreshMe();
  useEffect(() => {
    if (isConsentError(error)) void refreshMe();
  }, [error, refreshMe]);
}
