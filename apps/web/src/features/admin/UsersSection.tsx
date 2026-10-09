/**
 * 後台：使用者與 AI 申請（GET /api/admin/users?ai_status=&cursor=、POST /api/admin/users/{public_id}/{action}）。
 *
 * 動作都是 AI 狀態的變更（suspend＝停用 AI、unsuspend＝恢復）；自己那一列不給「停用 AI」（後端也會回 409）。
 * 只顯示暱稱、email 與申請資料，不顯示學習內容（SPEC §9）；申請說明是使用者填的，標示「未經查證」，
 * 以純文字顯示（React 會跳脫 HTML）。手機上用卡片排列，不用寬表格。
 * 操作成功後先就地更新那一列，再重新讀第一頁（名額數字會變，已不符合篩選條件的人會離開列表）。
 */
import { AI_STATUSES, type AdminUserAction, type AdminUserRow, type AdminUsersResponse, type AiStatus } from '@gsat/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiGet, apiPost, ApiRequestError, type ApiPath } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/apiErrors';
import {
  ADMIN_ACTION_DONE,
  ADMIN_ACTION_LABELS,
  ADMIN_ACTIONS_FOR_STATUS,
  AGE_BAND_LABELS,
  AI_STATUS_LABELS,
  AI_TIER_LABELS,
  ROLE_LABELS,
} from '../account/labels';
import { btnPrimary, btnSecondary, fieldCls, labelCls } from '../account/styles';
import { AiStatusBadge, LoadingBlock, Notice } from '../account/ui';
import { AdminSection, ReloadButton, SectionError, formatUnixTime } from './adminUi';
import { isAdminUserActionResponse, isAdminUsersResponse } from './guards';

type Filter = AiStatus | 'all';

const FILTER_OPTIONS: readonly Filter[] = ['pending', 'waitlist', 'approved', 'rejected', 'suspended', 'none', 'all'];

function filterLabel(f: Filter): string {
  return f === 'all' ? '全部' : AI_STATUS_LABELS[f];
}

function usersPath(filter: Filter, cursor: string | null): ApiPath {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('ai_status', filter);
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return `/api/admin/users${qs ? `?${qs}` : ''}`;
}

const ACTION_ERRORS = {
  conflict: '沒有執行：核准人數已達名額上限，或這位使用者的狀態已經改變。請重新整理列表。',
  reauth_required: '後台操作需要在 12 小時內登入過，請重新登入後再試。',
  not_found: '找不到這位使用者（可能已刪除帳號）。',
  forbidden: '你沒有權限執行這個動作。',
} as const;

interface ListState {
  users: AdminUserRow[];
  nextCursor: string | null;
  approval: AdminUsersResponse['approval'] | null;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
}

const EMPTY: ListState = { users: [], nextCursor: null, approval: null, loading: true, loadingMore: false, error: null };

async function fetchUsers(filter: Filter, cursor: string | null, signal?: AbortSignal): Promise<AdminUsersResponse> {
  const body = await apiGet(usersPath(filter, cursor), signal ? { signal } : {});
  if (!isAdminUsersResponse(body)) throw new ApiRequestError(200, 'not_implemented', '使用者列表回應格式不符');
  return body;
}

export function UsersSection({
  selfId,
  approvalsAllowed,
  onReauth,
}: {
  selfId: string;
  approvalsAllowed: boolean | null;
  onReauth: () => void;
}) {
  const filterId = useId();
  const [filter, setFilter] = useState<Filter>('pending');
  const [list, setList] = useState<ListState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setList((s) => ({ ...s, loading: true, error: null }));
    fetchUsers(filter, null, controller.signal).then(
      (res) => {
        if (controller.signal.aborted) return;
        setList({ users: res.users, nextCursor: res.next_cursor, approval: res.approval, loading: false, loadingMore: false, error: null });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setList((s) => ({ ...s, loading: false, error }));
      },
    );
    return () => controller.abort();
  }, [filter, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  async function loadMore() {
    if (!list.nextCursor) return;
    const controller = new AbortController();
    moreController.current = controller;
    setList((s) => ({ ...s, loadingMore: true }));
    try {
      const res = await fetchUsers(filter, list.nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      setList((s) => {
        const seen = new Set(s.users.map((u) => u.id));
        return {
          ...s,
          users: [...s.users, ...res.users.filter((u) => !seen.has(u.id))],
          nextCursor: res.next_cursor,
          approval: res.approval,
          loadingMore: false,
        };
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setList((s) => ({ ...s, loadingMore: false }));
      setMessage({ ok: false, text: `載入更多失敗：${errorMessage(err)}` });
    }
  }

  async function act(row: AdminUserRow, action: AdminUserAction) {
    setBusyRow(row.id);
    setMessage(null);
    const name = row.display_name?.trim() || row.email;
    try {
      const res = await apiPost(`/api/admin/users/${encodeURIComponent(row.id)}/${action}`);
      if (isAdminUserActionResponse(res)) {
        setList((s) => ({ ...s, users: s.users.map((u) => (u.id === row.id ? res.user : u)) }));
      }
      setMessage({ ok: true, text: `${ADMIN_ACTION_DONE[action]}：${name}` });
      reload();
    } catch (err) {
      if (errorCode(err) === 'reauth_required') onReauth();
      setMessage({ ok: false, text: `${ADMIN_ACTION_LABELS[action]}「${name}」失敗：${errorMessage(err, ACTION_ERRORS)}` });
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <AdminSection id="admin-users" title="使用者與 AI 申請" actions={<ReloadButton onClick={reload} busy={list.loading} />}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="w-full sm:w-56">
          <label htmlFor={filterId} className={labelCls}>
            依 AI 狀態篩選
          </label>
          <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className={fieldCls}>
            {FILTER_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {filterLabel(f)}
              </option>
            ))}
          </select>
        </div>
        {list.approval && (
          <p className="pb-2 text-[0.95rem]">
            已核准 <strong>{list.approval.approved}</strong>／名額 <strong>{list.approval.cap}</strong> 人
          </p>
        )}
      </div>

      {approvalsAllowed === false && (
        <div className="mt-3">
          <Notice tone="warn">啟動檢查未通過，後端會拒絕新的核准。請先到「設定與啟動檢查」修正。</Notice>
        </div>
      )}
      {message && (
        <div className="mt-3">
          <Notice tone={message.ok ? 'success' : 'error'}>{message.text}</Notice>
        </div>
      )}

      <div className="mt-4">
        {list.error !== null && list.users.length === 0 ? (
          <SectionError error={list.error} onRetry={reload} />
        ) : list.loading && list.users.length === 0 ? (
          <LoadingBlock />
        ) : list.users.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-6 text-center text-muted">
            沒有{filter === 'all' ? '' : `「${filterLabel(filter)}」的`}使用者。
          </p>
        ) : (
          <>
            {list.error !== null && (
              <div className="mb-3">
                <Notice tone="error">重新整理失敗：{errorMessage(list.error)}</Notice>
              </div>
            )}
            <ul className="space-y-3" aria-busy={list.loading}>
              {list.users.map((row) => (
                <UserCard
                  key={row.id}
                  row={row}
                  isSelf={row.id === selfId}
                  busy={busyRow === row.id}
                  disabled={busyRow !== null}
                  onAction={act}
                />
              ))}
            </ul>
            {list.nextCursor && (
              <button type="button" onClick={loadMore} disabled={list.loadingMore} className={`${btnSecondary} mt-3`}>
                {list.loadingMore ? '載入中…' : '載入更多'}
              </button>
            )}
          </>
        )}
      </div>
    </AdminSection>
  );
}

function UserCard({
  row,
  isSelf,
  busy,
  disabled,
  onAction,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  busy: boolean;
  disabled: boolean;
  onAction: (row: AdminUserRow, action: AdminUserAction) => void;
}) {
  const name = row.display_name?.trim() || '（未設定暱稱）';
  const allowed = (AI_STATUSES as readonly string[]).includes(row.ai_status) ? ADMIN_ACTIONS_FOR_STATUS[row.ai_status] : [];
  const actions = allowed.filter((a) => !(isSelf && a === 'suspend'));
  return (
    <li className="rounded-xl border border-line p-3 sm:p-4" aria-label={`${name}（${AI_STATUS_LABELS[row.ai_status]}）`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 font-semibold break-words">{name}</span>
        {isSelf && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">你</span>}
        {row.role === 'admin' && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{ROLE_LABELS.admin}</span>
        )}
        <AiStatusBadge status={row.ai_status} />
        {row.status !== 'active' && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-bad">
            {row.status === 'suspended' ? '帳號停權' : '刪除中'}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-sm break-all text-muted">{row.email}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted">年齡區間</dt>
        <dd>{row.age_band ? AGE_BAND_LABELS[row.age_band] : '未填'}</dd>
        <dt className="text-muted">額度等級</dt>
        <dd>{row.ai_tier in AI_TIER_LABELS ? AI_TIER_LABELS[row.ai_tier] : row.ai_tier}</dd>
        <dt className="text-muted">申請次數</dt>
        <dd>{row.ai_apply_count ?? 0}</dd>
        <dt className="text-muted">申請時間</dt>
        <dd>{formatUnixTime(row.ai_applied_at)}</dd>
        <dt className="text-muted">審核時間</dt>
        <dd>{formatUnixTime(row.ai_reviewed_at)}</dd>
        <dt className="text-muted">最後活動</dt>
        <dd>{row.last_active_day ?? '—'}</dd>
      </dl>
      {row.ai_apply_note && (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2">
          <p className="text-xs font-semibold text-muted">申請說明（使用者填寫，未經查證）</p>
          <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{row.ai_apply_note}</p>
        </div>
      )}
      {row.ai_status === 'none' && (
        <p className="mt-2 text-xs text-muted">尚未申請：直接核准後，仍要等他本人同意 AI 處理說明才能使用。</p>
      )}
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => onAction(row, action)}
              disabled={disabled}
              aria-label={`${ADMIN_ACTION_LABELS[action]}：${name}`}
              className={action === 'approve' || action === 'unsuspend' ? btnPrimary : btnSecondary}
            >
              {busy ? '處理中…' : ADMIN_ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
