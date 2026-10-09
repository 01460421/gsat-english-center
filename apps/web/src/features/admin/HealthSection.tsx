/**
 * 後台：設定與啟動檢查（GET /api/admin/health），以及全站 AI 暫停開關（POST /api/admin/ai/pause）。
 * 設定只顯示「已設定／未設定」，後端本來就只回布林（絕不回值）。
 */
import type { AdminAiPauseBody, AdminHealthResponse, StartupCheck } from '@gsat/shared';
import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { apiPost, useMe } from '../../lib/api';
import { errorCode, errorMessage } from '../../lib/apiErrors';
import { isNum, isObject, type ApiData } from '../account/useApiData';
import { STARTUP_CHECK_LABELS } from '../account/labels';
import { btnPrimary, btnSecondary } from '../account/styles';
import { LoadingBlock, Notice } from '../account/ui';
import { AdminSection, ReloadButton, SectionError, StatusLight, type LightState } from './adminUi';
import { HEALTH_CONFIG_KEYS } from './guards';

const CONFIG_LABELS: Record<(typeof HEALTH_CONFIG_KEYS)[number], string> = {
  google_client_id: 'Google 登入用戶端 ID（GOOGLE_CLIENT_ID）',
  google_client_secret: 'Google 登入用戶端密鑰（GOOGLE_CLIENT_SECRET）',
  session_secret: '登入簽章金鑰（SESSION_SECRET）',
  admin_email: '管理員信箱（ADMIN_EMAIL）',
  ledger_salt: '帳本假名鹽（LEDGER_SALT）',
  anthropic_api_key: 'Anthropic API 金鑰（ANTHROPIC_API_KEY）',
  ai_queue: 'AI 任務佇列（AI_QUEUE）',
};

function checkState(check: StartupCheck): LightState {
  if (check.ok) return 'ok';
  return check.severity === 'warn' ? 'warn' : 'error';
}

const CHECK_TEXT: Record<LightState, string> = { ok: '通過', warn: '提醒', error: '未通過' };

function checkLabel(id: string): string {
  return id in STARTUP_CHECK_LABELS ? STARTUP_CHECK_LABELS[id as StartupCheck['id']] : id;
}

export function HealthSection({ health }: { health: ApiData<AdminHealthResponse> }) {
  const { data, error, loading, reload } = health;
  return (
    <AdminSection id="admin-health" title="設定與啟動檢查" actions={<ReloadButton onClick={reload} busy={loading} label="重新檢查" />}>
      {data ? <HealthBody data={data} /> : error ? <SectionError error={error} onRetry={reload} /> : <LoadingBlock />}
      {data && error !== null && (
        <div className="mt-3">
          <Notice tone="error">重新檢查失敗：{errorMessage(error)}</Notice>
        </div>
      )}
    </AdminSection>
  );
}

/** 未確認的維運事件數（後端新版才有；舊回應沒有這欄就不顯示）。 */
function opsEventsOf(data: AdminHealthResponse): { open: number; open_errors: number } | null {
  const v: unknown = data.ops_events;
  return isObject(v) && isNum(v['open']) && isNum(v['open_errors']) ? { open: v['open'], open_errors: v['open_errors'] } : null;
}

function HealthBody({ data }: { data: AdminHealthResponse }) {
  const missing = data.migrations.expected.filter((m) => !data.migrations.applied.includes(m));
  const opsEvents = opsEventsOf(data);
  return (
    <div className="space-y-5">
      <Notice tone={data.approvals_allowed ? 'success' : 'error'}>
        {data.approvals_allowed
          ? '啟動檢查全部通過，可以核准新的 AI 申請。'
          : '有啟動檢查未通過：後端會拒絕新的 AI 核准，請先修正設定。'}
      </Notice>

      <div>
        <h3 className="font-semibold">機密與綁定</h3>
        <ul className="mt-2 divide-y divide-line">
          {HEALTH_CONFIG_KEYS.map((key) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 break-words text-[0.95rem]">{CONFIG_LABELS[key]}</span>
              <StatusLight state={data.config[key] ? 'ok' : 'error'} text={data.config[key] ? '已設定' : '未設定'} />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="font-semibold">資料庫遷移</h3>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[0.95rem]">
            已套用 {data.migrations.applied.length}／應有 {data.migrations.expected.length} 個
          </span>
          <StatusLight state={data.migrations.ok ? 'ok' : 'error'} text={data.migrations.ok ? '正常' : '尚未套用完'} />
        </div>
        {missing.length > 0 && (
          <p className="mt-1 text-sm break-all text-muted">尚未套用：{missing.join('、')}</p>
        )}
      </div>

      <div>
        <h3 className="font-semibold">額度與預算的啟動檢查</h3>
        {data.startup_checks.length === 0 ? (
          <p className="mt-2 text-sm text-muted">沒有檢查項目。</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.startup_checks.map((check) => {
              const state = checkState(check);
              return (
                <li key={check.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-[0.95rem] font-medium">{checkLabel(check.id)}</span>
                    <StatusLight state={state} text={CHECK_TEXT[state]} />
                  </div>
                  <p className="mt-0.5 text-sm break-words text-muted">{check.detail}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <h3 className="font-semibold">AI 狀態</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.95rem]">
          <dt className="text-muted">全站 AI</dt>
          <dd>
            <StatusLight state={data.ai.paused ? 'warn' : 'ok'} text={data.ai.paused ? '暫停中' : '運作中'} />
          </dd>
          <dt className="text-muted">核准名額</dt>
          <dd>
            已核准 {data.ai.approved}／名額 {data.ai.approval_cap} 人
          </dd>
          {opsEvents && (
            <>
              <dt className="text-muted">未確認事件</dt>
              <dd>
                <StatusLight
                  state={opsEvents.open_errors > 0 ? 'error' : opsEvents.open > 0 ? 'warn' : 'ok'}
                  text={`${opsEvents.open} 件（錯誤 ${opsEvents.open_errors} 件）`}
                />
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

export function PauseSection({ health, onReauth }: { health: ApiData<AdminHealthResponse>; onReauth: () => void }) {
  const { refresh } = useMe();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const paused = health.data?.ai.paused ?? null;

  async function toggle() {
    if (paused === null) return;
    const body: AdminAiPauseBody = { paused: !paused };
    setBusy(true);
    setResult(null);
    try {
      await apiPost('/api/admin/ai/pause', body);
      health.setData((prev) => (prev ? { ...prev, ai: { ...prev.ai, paused: body.paused } } : prev));
      setResult({ ok: true, message: body.paused ? '已暫停全站 AI 批改。' : '已恢復全站 AI 批改。' });
      setConfirming(false);
      health.reload();
      void refresh();
    } catch (err) {
      if (errorCode(err) === 'reauth_required') onReauth();
      setResult({
        ok: false,
        message: errorMessage(err, { reauth_required: '後台操作需要在 12 小時內登入過，請重新登入後再試。' }),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminSection id="admin-pause" title="全站 AI 開關">
      {paused === null ? (
        <p className="text-[0.95rem] text-muted">讀到設定檢查的結果後才能切換。</p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-[0.95rem]">
            目前：
            <StatusLight state={paused ? 'warn' : 'ok'} text={paused ? '暫停中' : '運作中'} />
          </p>
          <p className="mt-1 text-sm text-muted">
            暫停後不接受新的 AI 批改，已在處理中的會完成；已排隊但還沒開始的會退還點數。
          </p>
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className={`${btnSecondary} mt-3`}>
              {paused ? <Play aria-hidden="true" className="size-4" /> : <Pause aria-hidden="true" className="size-4" />}
              {paused ? '恢復 AI 批改' : '暫停全站 AI 批改'}
            </button>
          ) : (
            <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[0.95rem]">{paused ? '確定要恢復全站 AI 批改嗎？' : '確定要暫停全站 AI 批改嗎？'}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={toggle} disabled={busy} className={btnPrimary}>
                  {busy ? '處理中…' : paused ? '確定恢復' : '確定暫停'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={btnSecondary}>
                  取消
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {result && (
        <div className="mt-3">
          <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>
        </div>
      )}
    </AdminSection>
  );
}
