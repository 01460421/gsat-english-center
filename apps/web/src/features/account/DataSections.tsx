/**
 * 匯出資料與刪除帳號兩個區塊（/account 使用；條款改版時 /account/welcome 也提供，讓不同意新版的人仍能取回或刪除資料）。
 *   - 匯出：GET /api/me/export（MeExport）→ 在瀏覽器存成 JSON 檔
 *   - 刪除：DELETE /api/me（DeleteMeBody，要輸入 DELETE_ACCOUNT_CONFIRM）
 * 兩者都要求 10 分鐘內登入過；後端回 401 reauth_required 時顯示「重新登入」，登入後回到 reauthNext。
 */
import { DELETE_ACCOUNT_CONFIRM, RECENT_LOGIN_MINUTES_SENSITIVE, type DeleteMeBody } from '@gsat/shared';
import { Download, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, useMe } from '../../lib/api';
import { clearLocalWritingData } from '../writing/lib/drafts';
import { errorCode, errorMessage } from '../../lib/apiErrors';
import { btnDanger, btnSecondary, cardCls, fieldCls, labelCls, sectionTitleCls } from './styles';
import { Notice, ReauthPrompt } from './ui';

/** 台灣日期 'YYYY-MM-DD'（匯出檔名用）。 */
export function taiwanDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 把匯出資料存成檔案（不經伺服器的 Content-Disposition：用 fetch 拿 JSON，錯誤才能就地顯示）。 */
function saveJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const SENSITIVE_HINT = `為了保護你的資料，這個操作需要在 ${RECENT_LOGIN_MINUTES_SENSITIVE} 分鐘內登入過；太久沒登入時會請你重新登入。`;

export function ExportSection({ reauthNext = '/account' }: { reauthNext?: string }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: 'done' } | { kind: 'reauth' } | { kind: 'error'; message: string } | null>(null);

  async function onExport() {
    setBusy(true);
    setState(null);
    try {
      const data = await apiGet('/api/me/export');
      saveJson(data, `gsat-export-${taiwanDate()}.json`);
      setState({ kind: 'done' });
    } catch (err) {
      setState(errorCode(err) === 'reauth_required' ? { kind: 'reauth' } : { kind: 'error', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionTitleCls}>匯出我的資料</h2>
      <p className="mt-2 text-[0.95rem]">
        下載一份 JSON 檔，包含帳號資料、同意紀錄、寫作與批改紀錄。手寫照片在辨識後就已刪除，不在其中。
      </p>
      <p className="mt-1 text-sm text-muted">{SENSITIVE_HINT}</p>
      <button type="button" onClick={onExport} disabled={busy} className={`${btnSecondary} mt-3`}>
        <Download aria-hidden="true" className="size-4" />
        {busy ? '準備中…' : '匯出我的資料'}
      </button>
      {state && (
        <div className="mt-3">
          {state.kind === 'done' && <Notice tone="success">已下載匯出檔。</Notice>}
          {state.kind === 'reauth' && (
            <ReauthPrompt next={reauthNext}>
              <p>匯出資料需要在 {RECENT_LOGIN_MINUTES_SENSITIVE} 分鐘內登入過。請重新登入，回到這一頁後再按一次「匯出我的資料」。</p>
            </ReauthPrompt>
          )}
          {state.kind === 'error' && <Notice tone="error">{state.message}</Notice>}
        </div>
      )}
    </section>
  );
}

export function DeleteSection({ onDeleted, reauthNext = '/account' }: { onDeleted: (message: string) => void; reauthNext?: string }) {
  const { applyMe, refresh } = useMe();
  const inputId = useId();
  const hintId = useId();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: 'reauth' } | { kind: 'error'; message: string } | null>(null);
  const matches = confirm.trim() === DELETE_ACCOUNT_CONFIRM;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setState(null);
    const body: DeleteMeBody = { confirm: confirm.trim() };
    try {
      await apiDelete('/api/me', body);
    } catch (err) {
      setBusy(false);
      setState(errorCode(err) === 'reauth_required' ? { kind: 'reauth' } : { kind: 'error', message: errorMessage(err) });
      return;
    }
    // 這台裝置上的寫作草稿（作文全文、辨識文字的修改、自評）也一起清掉。
    clearLocalWritingData();
    onDeleted('你的帳號與資料已刪除，所有裝置都已登出，這台裝置上的寫作草稿也已清除。謝謝你使用本站。');
    applyMe({ user: null });
    void refresh();
  }

  return (
    <section className="rounded-2xl border border-bad/40 bg-surface p-4 sm:p-5 lg:p-6">
      <h2 className={sectionTitleCls}>刪除帳號</h2>
      <p className="mt-2 text-[0.95rem]">
        刪除後，你的帳號、寫作與批改紀錄都會刪除，而且無法復原；所有裝置會立即登出，這台裝置上的寫作草稿也會清除。需要的話，請先匯出資料。
      </p>
      <p className="mt-1 text-sm text-muted">{SENSITIVE_HINT}</p>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <div>
          <label htmlFor={inputId} className={labelCls}>
            請輸入「{DELETE_ACCOUNT_CONFIRM}」確認
          </label>
          <input
            id={inputId}
            type="text"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby={hintId}
            autoComplete="off"
            className={fieldCls}
          />
          <p id={hintId} className="mt-1 text-sm text-muted">
            輸入完全相同的文字後，刪除按鈕才會啟用。
          </p>
        </div>
        <button type="submit" disabled={!matches || busy} className={btnDanger}>
          <Trash2 aria-hidden="true" className="size-4" />
          {busy ? '刪除中…' : '永久刪除我的帳號'}
        </button>
      </form>
      {state && (
        <div className="mt-3">
          {state.kind === 'reauth' && (
            <ReauthPrompt next={reauthNext}>
              <p>刪除帳號需要在 {RECENT_LOGIN_MINUTES_SENSITIVE} 分鐘內登入過。請重新登入，回到這一頁後再刪除一次。</p>
            </ReauthPrompt>
          )}
          {state.kind === 'error' && <Notice tone="error">{state.message}</Notice>}
        </div>
      )}
    </section>
  );
}
