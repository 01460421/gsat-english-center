/**
 * /account/welcome：首次登入（或條款改版）時的隱私權說明與服務條款同意、年齡區間、暱稱。負責：前端帳號 W1。
 *
 * MeResponseSignedIn.pending_consents 非空（或 onboarded 為 false）時，OnboardingRedirect／RequireAccount 會導到這裡，
 * 網址帶 ?next=<原本要去的站內路徑>。送出：
 *   - 有要同意的種類 → POST /api/me/consents（ConsentsPostBody；版本原樣帶回 consent_versions，首次設定一併帶 age_band、暱稱）
 *   - 只差年齡區間 → PATCH /api/me（MePatchBody）
 * 兩者都回 MeResponseSignedIn，直接套用到全站登入狀態後回到 next。
 *
 * 本頁顯示的條款版本（policy.ts）和後端的現行版本不一致時停用送出：不能讓人同意自己沒看過的版本。
 */
import {
  AGE_BANDS,
  CONSENT_VERSION_SOURCE,
  DISPLAY_NAME_MAX,
  isMeResponse,
  type AgeBand,
  type ConsentItem,
  type ConsentKind,
  type ConsentsPostBody,
  type MePatchBody,
  type MeResponseSignedIn,
} from '@gsat/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { apiPatch, apiPost, signedIn, useFeatures, useMe, needsOnboarding } from '../../lib/api';
import { errorMessage } from '../../lib/apiErrors';
import { APP_NAME } from '../../modules';
import { DeleteSection, ExportSection } from './DataSections';
import { AGE_BAND_LABELS } from './labels';
import { PolicyView } from './PolicyView';
import { AI_PROCESSING_NOTICE, PRIVACY_POLICY, TERMS_OF_SERVICE, type PolicyDoc } from './policy';
import { btnPrimary, btnSecondary, cardCls, checkboxCls, fieldCls, labelCls, pageTitleCls, sectionTitleCls } from './styles';
import { ComingSoon, LoadingBlock, LoginPrompt, Notice, safeNext } from './ui';

/** 本頁處理的同意種類與它們的勾選文字。improve_grading 是選填。 */
const CONSENT_ORDER: readonly ConsentKind[] = ['privacy', 'terms', 'ai_processing', 'guardian_ack', 'improve_grading'];

function consentLabel(kind: ConsentKind, version: string): string {
  switch (kind) {
    case 'privacy':
      return `我已閱讀並同意隱私權說明（${version} 版）`;
    case 'terms':
      return `我已閱讀並同意服務條款（${version} 版）`;
    case 'ai_processing':
      return `我同意 AI 處理說明（${version} 版）：作答內容會傳給 Anthropic 的 API 處理，處理地點可能在台灣境外`;
    case 'guardian_ack':
      return '我已告知法定代理人（父母或監護人）並取得同意';
    case 'improve_grading':
      return '（選填）同意以去識別的方式用於改善批改品質，可以隨時撤回';
  }
}

/** 每個種類對應的條款內文（guardian_ack、improve_grading 沒有獨立內文，跟著 AI 處理說明）。 */
function docFor(kind: ConsentKind): PolicyDoc | null {
  if (kind === 'privacy') return PRIVACY_POLICY;
  if (kind === 'terms') return TERMS_OF_SERVICE;
  if (kind === 'ai_processing') return AI_PROCESSING_NOTICE;
  return null;
}

export default function WelcomePage() {
  const features = useFeatures();
  const { me, loading } = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const user = signedIn(me);
  /** 在本頁刪除帳號之後的提示（這時已經沒有登入狀態）。 */
  const [flash, setFlash] = useState<string | null>(null);

  let body;
  if (loading) body = <LoadingBlock />;
  else if (!features.auth)
    body = (
      <ComingSoon title="帳號功能即將開放">
        <p>登入功能還在準備中。不登入也可以使用單字、歷屆試題等練習功能。</p>
      </ComingSoon>
    );
  else if (!user)
    body = (
      <LoginPrompt next={`/account/welcome?next=${encodeURIComponent(next)}`}>
        <p>登入後，請先閱讀並同意隱私權說明與服務條款。</p>
      </LoginPrompt>
    );
  else if (!needsOnboarding(user)) body = <AlreadyDone next={next} />;
  else body = <WelcomeForm me={user} next={next} onDeleted={setFlash} />;

  return (
    <article>
      <title>{`歡迎使用｜${APP_NAME}`}</title>
      <h1 className={pageTitleCls}>歡迎使用{APP_NAME}</h1>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {flash && <Notice tone="success">{flash}</Notice>}
        {body}
      </div>
    </article>
  );
}

function AlreadyDone({ next }: { next: string }) {
  return (
    <section className={cardCls}>
      <Notice tone="success" title="你已完成首次設定">
        <p>隱私權說明與服務條款都已同意最新版本。</p>
      </Notice>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={next} className={btnPrimary}>
          繼續
        </Link>
        <Link to="/account" className={btnSecondary}>
          我的帳號
        </Link>
      </div>
    </section>
  );
}

function WelcomeForm({ me, next, onDeleted }: { me: MeResponseSignedIn; next: string; onDeleted: (message: string) => void }) {
  const navigate = useNavigate();
  const { applyMe, refresh } = useMe();
  const ageName = useId();
  const nicknameId = useId();
  const nicknameHintId = useId();

  const firstTime = me.user.age_band === null;
  const kinds = CONSENT_ORDER.filter((k) => me.pending_consents.includes(k));
  const docs = kinds.map(docFor).filter((d): d is PolicyDoc => d !== null);
  const versionOf = (kind: ConsentKind) => me.consent_versions[CONSENT_VERSION_SOURCE[kind]];
  const staleDocs = kinds.filter((k) => {
    const doc = docFor(k);
    return doc !== null && doc.version !== versionOf(k);
  });

  const [checked, setChecked] = useState<Partial<Record<ConsentKind, boolean>>>({});
  const [ageBand, setAgeBand] = useState<AgeBand | null>(me.user.age_band);
  const [nickname, setNickname] = useState(me.user.display_name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredKinds = kinds.filter((k) => k !== 'improve_grading');
  const allChecked = requiredKinds.every((k) => checked[k] === true);
  const canSubmit = allChecked && ageBand !== null && staleDocs.length === 0 && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || ageBand === null) return;
    setBusy(true);
    setError(null);
    const displayName = nickname.trim() === '' ? null : nickname.trim();
    try {
      let res: unknown;
      if (kinds.length > 0) {
        const items: ConsentItem[] = kinds.map((kind) => ({
          kind,
          version: versionOf(kind),
          granted: kind === 'improve_grading' ? checked[kind] === true : true,
        }));
        const body: ConsentsPostBody = { items, ...(firstTime ? { age_band: ageBand, display_name: displayName } : {}) };
        res = await apiPost('/api/me/consents', body);
      } else {
        const body: MePatchBody = { age_band: ageBand, ...(firstTime ? { display_name: displayName } : {}) };
        res = await apiPatch('/api/me', body);
      }
      if (isMeResponse(res) && res.user) applyMe(res);
      else await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setBusy(false);
      setError(
        errorMessage(err, {
          bad_request: '送出的資料不正確，或條款剛好更新了。請重新整理頁面後再試一次。',
        }),
      );
    }
  }

  async function declineAndLogout() {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/auth/logout');
    } catch (err) {
      setBusy(false);
      setError(`登出失敗：${errorMessage(err)}`);
      return;
    }
    applyMe({ user: null });
    navigate('/', { replace: true });
    void refresh();
  }

  const returning = !firstTime && kinds.length > 0;
  const changes = docs.flatMap((d) => d.changes.map((c) => `${d.title}：${c}`));

  return (
    <>
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4">
        {returning ? (
          <Notice tone="warn" title="隱私權說明或服務條款已更新">
            <p>請閱讀更新後的內容並重新同意，才能繼續使用需要登入的功能。</p>
            {changes.length > 0 && (
              <ul className="space-y-1 pt-1">
                {changes.map((c) => (
                  <li key={c} className="ml-5 list-disc">
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        ) : (
          <p className="text-[0.95rem]">
            {kinds.length > 0
              ? '開始使用前，請花一分鐘看看我們怎麼處理你的資料。本站非營利、不收費，也不放廣告。'
              : '再一步就完成了：請選擇你的年齡區間。'}
          </p>
        )}

        {staleDocs.length > 0 && (
          <Notice tone="error" title="條款剛剛更新了">
            <p>本頁顯示的不是最新版本。請重新整理頁面後再同意；若重新整理後仍看到這則提示，代表網站還在更新，請稍後再試。</p>
          </Notice>
        )}

        {docs.map((doc) => (
          <PolicyView key={doc.title} doc={doc} />
        ))}

        {firstTime && (
          <section className={cardCls}>
            <h2 className={sectionTitleCls}>基本設定</h2>
            <fieldset className="mt-3">
              <legend className={labelCls}>年齡區間（必填）</legend>
              <p className="mb-2 text-sm text-muted">只問區間，不問生日。未滿 18 歲的同學申請 AI 批改時，需要先告知父母或監護人。</p>
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
            <div className="mt-4">
              <label htmlFor={nicknameId} className={labelCls}>
                暱稱
              </label>
              <input
                id={nicknameId}
                type="text"
                value={nickname}
                maxLength={DISPLAY_NAME_MAX}
                onChange={(e) => setNickname(e.target.value)}
                aria-describedby={nicknameHintId}
                autoComplete="nickname"
                className={fieldCls}
              />
              <p id={nicknameHintId} className="mt-1 text-sm text-muted">
                預設是你的 Google 名稱，可以改成不是真名的暱稱（最多 {DISPLAY_NAME_MAX} 字）。之後也能在「我的帳號」修改。
              </p>
            </div>
          </section>
        )}

        {kinds.length > 0 && (
          <fieldset className={cardCls}>
            <legend className="sr-only">同意事項</legend>
            <div className="space-y-3">
              {kinds.map((kind) => (
                <label key={kind} className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked[kind] === true}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [kind]: e.target.checked }))}
                    className={checkboxCls}
                  />
                  <span>{consentLabel(kind, versionOf(kind))}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!canSubmit} className={btnPrimary}>
            {busy ? '送出中…' : kinds.length > 0 ? '同意並繼續' : '完成設定'}
          </button>
          <button type="button" onClick={declineAndLogout} disabled={busy} className={btnSecondary}>
            {kinds.length > 0 ? '暫不同意，登出' : '登出'}
          </button>
        </div>
        {!canSubmit && !busy && staleDocs.length === 0 && (
          <p className="text-sm text-muted">
            {kinds.length > 0 ? '勾選上面的同意事項' : ''}
            {kinds.length > 0 && ageBand === null ? '並' : ''}
            {ageBand === null ? '選擇年齡區間' : ''}
            後才能送出。
          </p>
        )}
      </form>
      {returning && (
        <details className="rounded-2xl border border-line bg-surface-2 px-4 py-2">
          <summary className="min-h-11 cursor-pointer content-center font-medium">不同意新版的內容？</summary>
          <div className="space-y-4 pt-1 pb-3">
            <p className="text-[0.95rem]">
              不同意也沒關係：可以按「暫不同意，登出」，不登入也能繼續練習單字與歷屆試題。需要的話，也可以先匯出資料或刪除帳號。
            </p>
            <ExportSection reauthNext={`/account/welcome?next=${encodeURIComponent(next)}`} />
            <DeleteSection onDeleted={onDeleted} reauthNext={`/account/welcome?next=${encodeURIComponent(next)}`} />
          </div>
        </details>
      )}
    </>
  );
}
