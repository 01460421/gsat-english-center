/**
 * /account：我的帳號。負責：前端帳號 W1。
 *
 *   - 未登入時就是登入頁（「使用 Google 帳號登入」＋「學校帳號不能用時請改用個人 Gmail」）；
 *     登入失敗時 Worker 把人導回 /account?auth_error=<AuthErrorCode>，這裡轉成中文。
 *   - 暱稱、年齡區間：PATCH /api/me（MePatchBody → MeResponseSignedIn）
 *   - AI 批改狀態（連到 /ai/apply）；已申請或已核准時可撤回 AI 處理同意（POST /api/me/consents，granted: false）
 *   - 登出：POST /auth/logout；登出所有裝置：POST /auth/logout-all（session_ver+1）
 *   - 匯出我的資料、刪除帳號：DataSections.tsx（10 分鐘內登入過；reauth_required 時請使用者重新登入後回到 /account）
 */
import {
  AGE_BANDS,
  DISPLAY_NAME_MAX,
  isAuthErrorCode,
  isMeResponse,
  type AgeBand,
  type AiStatus,
  type ConsentsPostBody,
  type MePatchBody,
  type MeResponseSignedIn,
} from '@gsat/shared';
import { LogOut } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { apiPatch, apiPost, useFeatures, useMe } from '../../lib/api';
import { errorMessage } from '../../lib/apiErrors';
import { clearLocalWritingData } from '../writing/lib/drafts';
import { APP_NAME } from '../../modules';
import { DeleteSection, ExportSection } from './DataSections';
import { AGE_BAND_LABELS, AI_STATUS_DESCRIPTIONS, AI_TIER_LABELS, AUTH_ERROR_MESSAGES, ROLE_LABELS } from './labels';
import { RequireAccount } from './RequireAccount';
import { btnPrimary, btnSecondary, cardCls, fieldCls, labelCls, pageTitleCls, sectionTitleCls } from './styles';
import { AiStatusBadge, GMAIL_HINT, Notice, SoonBadge } from './ui';

function formatUnixDate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(seconds * 1000),
  );
}

export default function AccountPage() {
  const [params] = useSearchParams();
  const authError = params.get('auth_error');
  /** 登出、登出所有裝置、刪除帳號之後的提示：這時已經沒有登入狀態，所以放在外層。 */
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <article>
      <title>{`我的帳號｜${APP_NAME}`}</title>
      <h1 className={pageTitleCls}>我的帳號</h1>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {authError !== null && (
          <Notice tone="error" title="登入沒有成功">
            <p>{isAuthErrorCode(authError) ? AUTH_ERROR_MESSAGES[authError] : '登入時發生問題，請再試一次。'}</p>
            {authError !== 'not_configured' && authError !== 'suspended' && <p className="text-sm">{GMAIL_HINT}。</p>}
          </Notice>
        )}
        {flash && <Notice tone="success">{flash}</Notice>}
        <RequireAccount
          loginTitle="登入學測英文中心"
          loginMessage={
            <>
              <p>不登入也能練習單字與歷屆試題。登入後可以：</p>
              <ul className="space-y-1">
                <li className="ml-5 list-disc">保存中譯英與英文作文的作答與批改紀錄</li>
                <li className="ml-5 list-disc">申請 AI 批改</li>
              </ul>
            </>
          }
        >
          {(me) => <AccountContent me={me} onSessionEnded={setFlash} />}
        </RequireAccount>
      </div>
    </article>
  );
}

function AccountContent({ me, onSessionEnded }: { me: MeResponseSignedIn; onSessionEnded: (message: string) => void }) {
  const features = useFeatures();
  const isAdmin = me.user.role === 'admin';
  return (
    <>
      <section className={cardCls}>
        <h2 className={sectionTitleCls}>帳號資料</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.95rem]">
          <dt className="text-muted">身分</dt>
          <dd>{ROLE_LABELS[me.user.role]}</dd>
          <dt className="text-muted">加入日期</dt>
          <dd>{formatUnixDate(me.user.created_at)}</dd>
        </dl>
        <ProfileForm me={me} />
      </section>

      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={sectionTitleCls}>AI 批改</h2>
          {features.ai ? <AiStatusBadge status={me.user.ai_status} /> : <SoonBadge />}
        </div>
        {features.ai ? (
          <>
            <p className="mt-2 text-[0.95rem]">{AI_STATUS_DESCRIPTIONS[me.user.ai_status]}</p>
            {(me.pending_ai_consents ?? []).length > 0 && AI_CONSENT_STATUSES.includes(me.user.ai_status) && (
              <div className="mt-2">
                <Notice tone="warn">需要重新同意 AI 處理說明（說明已更新，或你撤回了同意），完成後才能使用 AI 批改。</Notice>
              </div>
            )}
            {me.user.ai_status === 'approved' && (
              <p className="mt-1 text-sm text-muted">額度等級：{AI_TIER_LABELS[me.user.ai_tier]}</p>
            )}
            <Link to="/ai/apply" className={`${btnSecondary} mt-3`}>
              {me.user.ai_status === 'none' ? '申請 AI 批改' : '查看申請狀態與點數'}
            </Link>
            <AiConsentControl me={me} />
          </>
        ) : (
          <p className="mt-2 text-[0.95rem] text-muted">AI 批改中譯英與英文作文的功能即將開放。</p>
        )}
      </section>

      {isAdmin && (
        <section className={cardCls}>
          <h2 className={sectionTitleCls}>管理後台</h2>
          <p className="mt-2 text-[0.95rem]">審核 AI 申請、查看設定檢查與用量。</p>
          <Link to="/admin" className={`${btnSecondary} mt-3`}>
            前往管理後台
          </Link>
        </section>
      )}

      <SessionSection onSessionEnded={onSessionEnded} />
      <ExportSection />
      <DeleteSection onDeleted={onSessionEnded} />
    </>
  );
}

/** 有 AI 處理同意、可以撤回的狀態（後端只對這三種狀態追蹤 pending_ai_consents）。 */
const AI_CONSENT_STATUSES: readonly AiStatus[] = ['pending', 'waitlist', 'approved'];

/**
 * 撤回 AI 處理同意：POST /api/me/consents（ai_processing、現行版本、granted: false）。
 * 撤回後後端的 pending_ai_consents 會列出 ai_processing，AI 端點回 403 consent_required；
 * 核准狀態不變，想再用時到 /ai/apply 重新同意即可。
 */
function AiConsentControl({ me }: { me: MeResponseSignedIn }) {
  const { applyMe, refresh } = useMe();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const canWithdraw =
    AI_CONSENT_STATUSES.includes(me.user.ai_status) && !(me.pending_ai_consents ?? []).includes('ai_processing');

  async function withdraw() {
    setBusy(true);
    setResult(null);
    const body: ConsentsPostBody = { items: [{ kind: 'ai_processing', version: me.consent_versions.ai, granted: false }] };
    try {
      const res = await apiPost('/api/me/consents', body);
      if (isMeResponse(res) && res.user) applyMe(res);
      else await refresh();
      setConfirming(false);
      setResult({ ok: true, message: '已撤回 AI 處理同意，本站不會再把你的作答送給 AI。想再使用時，到申請頁重新同意即可。' });
    } catch (err) {
      setResult({
        ok: false,
        message: errorMessage(err, { bad_request: '送出的資料不正確，或 AI 處理說明剛好更新了。請重新整理頁面後再試一次。' }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canWithdraw && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="font-semibold">撤回 AI 處理同意</h3>
          <p className="mt-1 text-sm text-muted">
            撤回後就不能使用 AI 批改，已有的批改紀錄會保留；核准狀態不變，想再使用時重新同意即可。
          </p>
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className={`${btnSecondary} mt-3`}>
              撤回同意
            </button>
          ) : (
            <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[0.95rem]">確定要撤回 AI 處理同意嗎？</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={withdraw} disabled={busy} className={btnPrimary}>
                  {busy ? '處理中…' : '確定撤回'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={btnSecondary}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="mt-3">
          <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>
        </div>
      )}
    </>
  );
}

function ProfileForm({ me }: { me: MeResponseSignedIn }) {
  const { applyMe, refresh } = useMe();
  const nicknameId = useId();
  const ageName = useId();
  const [nickname, setNickname] = useState(me.user.display_name ?? '');
  const [ageBand, setAgeBand] = useState<AgeBand | null>(me.user.age_band);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const trimmed = nickname.trim();
  const nameChanged = (trimmed === '' ? null : trimmed) !== (me.user.display_name ?? null);
  const ageChanged = ageBand !== null && ageBand !== me.user.age_band;
  const changed = nameChanged || ageChanged;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!changed || busy) return;
    const body: MePatchBody = {};
    if (nameChanged) body.display_name = trimmed === '' ? null : trimmed;
    if (ageChanged && ageBand !== null) body.age_band = ageBand;
    setBusy(true);
    setResult(null);
    try {
      const res = await apiPatch('/api/me', body);
      if (isMeResponse(res) && res.user) applyMe(res);
      else await refresh();
      setResult({ ok: true, message: '已儲存。' });
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4 border-t border-line pt-4">
      <div>
        <label htmlFor={nicknameId} className={labelCls}>
          暱稱
        </label>
        <input
          id={nicknameId}
          type="text"
          value={nickname}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setNickname(e.target.value)}
          autoComplete="nickname"
          className={fieldCls}
        />
        <p className="mt-1 text-sm text-muted">可以用不是真名的暱稱（最多 {DISPLAY_NAME_MAX} 字）。</p>
      </div>
      <fieldset>
        <legend className={labelCls}>年齡區間</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AGE_BANDS.map((band) => (
            <label
              key={band}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name={ageName}
                value={band}
                checked={ageBand === band}
                onChange={() => setAgeBand(band)}
                className="accent-[var(--primary)]"
              />
              <span>{AGE_BAND_LABELS[band]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
      <button type="submit" disabled={!changed || busy} className={btnPrimary}>
        {busy ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}

function SessionSection({ onSessionEnded }: { onSessionEnded: (message: string) => void }) {
  const { applyMe, refresh } = useMe();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: '/auth/logout' | '/auth/logout-all', done: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(path);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
      return;
    }
    // 公用電腦：下一位使用者不該看到這台裝置上的作文草稿。
    clearLocalWritingData();
    onSessionEnded(done);
    applyMe({ user: null });
    void refresh();
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionTitleCls}>登入裝置</h2>
      <p className="mt-2 text-[0.95rem]">
        登入狀態會保留 30 天。在公用電腦用完請登出（登出時也會清除這台裝置上的寫作草稿）；手機或電腦遺失時，可以一次登出所有裝置。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => run('/auth/logout', '已登出。')} disabled={busy} className={btnSecondary}>
          <LogOut aria-hidden="true" className="size-4" />
          登出
        </button>
        {!confirmAll && (
          <button type="button" onClick={() => setConfirmAll(true)} disabled={busy} className={btnSecondary}>
            登出所有裝置
          </button>
        )}
      </div>
      {confirmAll && (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-[0.95rem]">確定要登出所有裝置嗎？包括這台在內，所有裝置都要重新登入。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run('/auth/logout-all', '已登出所有裝置。')}
              disabled={busy}
              className={btnPrimary}
            >
              確定登出所有裝置
            </button>
            <button type="button" onClick={() => setConfirmAll(false)} disabled={busy} className={btnSecondary}>
              取消
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </section>
  );
}
