/**
 * /ai/apply：申請 AI 批改。負責：前端帳號 W1。
 *
 *   - 說明 AI 批改是什麼、點數規則（AI_TASK_POINTS：中譯英 3、作文 7、照片辨識 2）與上限
 *     （登入後讀 GET /api/ai/quota；讀不到就顯示 wrangler.toml 的預設值）。
 *   - 使用須知（SPEC §8.4「AI 功能使用說明」：能做什麼、不能做什麼、不要放個資、遇到不當內容怎麼辦）。
 *   - 目前狀態（none／pending／waitlist／approved／rejected／suspended）的中文說明；已核准時顯示今日剩餘點數與用量
 *     （管理員的「不限」上限顯示成文字，不印出 10 億）；名額已滿（approval.full）時申請表先說明會排入候補。
 *   - 申請表：用途說明（≤300 字）、單獨同意「AI 處理說明」、未滿 18 歲勾選「已告知法定代理人」；
 *     送 POST /api/ai/apply（AiApplyBody）→ AiApplyResponse。
 *   - features.ai 為 false（後端未部署或 ANTHROPIC_API_KEY 沒設）→ 只有說明＋「即將開放」，不出現申請表與錯誤畫面。
 *   - 版面順序：已登入時「目前狀態」放最上面（從寫作頁「申請 AI 批改」點過來最想知道的就是它，手機上不能埋在
 *     兩個螢幕以下），接著是 AI 批改的說明，最後是申請表；未登入時先說明、再登入提示。使用須知收在 <details>。
 */
import {
  AI_APPLY_COOLDOWN_SECONDS,
  AI_APPLY_MAX_COUNT,
  AI_APPLY_NOTE_MAX,
  AI_STATUSES,
  AI_TASK_POINTS,
  type AiApplyBody,
  type AiQuotaResponse,
  type AiStatus,
  type AiTask,
  type ConsentKind,
  type ConsentsPostBody,
  type MeResponseSignedIn,
  isMeResponse,
} from '@gsat/shared';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { apiPost, needsOnboarding, signedIn, useFeatures, useMe } from '../../lib/api';
import { errorMessage } from '../../lib/apiErrors';
import { APP_NAME } from '../../modules';
import { AI_STATUS_DESCRIPTIONS, AI_TIER_LABELS } from './labels';
import { AI_CONSENT_VERSION, AI_PROCESSING_NOTICE } from './policy';
import { PolicyView } from './PolicyView';
import { RequireAccount } from './RequireAccount';
import { btnPrimary, btnSecondary, cardCls, checkboxCls, fieldCls, labelCls, pageTitleCls, sectionTitleCls } from './styles';
import { AI_NOTICE, AiNoticeBadge, AiStatusBadge, ComingSoon, LoadingBlock, Notice } from './ui';
import { isNum, isObject, useApiData } from './useApiData';

/**
 * 上限的後備值：和 apps/api/wrangler.toml 的 [vars]（AI_POINTS_USER_DAY 等）相同。
 * 只在 GET /api/ai/quota 讀不到時顯示（未登入、還沒部署）；實際上限一律以後端回應為準。
 */
export const DEFAULT_AI_LIMITS = {
  pointsDay: 30,
  pointsMonth: 300,
  pointsTrialDay: 10,
  essaysDay: 3,
  concurrent: 2,
} as const;

export function isAiQuotaResponse(value: unknown): value is AiQuotaResponse {
  if (!isObject(value)) return false;
  const { points, essays, concurrent } = value;
  return (
    isObject(points) &&
    isNum(points['day_used']) &&
    isNum(points['day_limit']) &&
    isNum(points['month_used']) &&
    isNum(points['month_limit']) &&
    isObject(essays) &&
    isNum(essays['day_used']) &&
    isNum(essays['day_limit']) &&
    isObject(concurrent) &&
    isNum(concurrent['limit'])
  );
}

function isAiApplyResponse(value: unknown): value is { ai_status: AiStatus } {
  return isObject(value) && (AI_STATUSES as readonly unknown[]).includes(value['ai_status']);
}

export default function AiApplyPage() {
  const features = useFeatures();
  const { me, loading } = useMe();
  const user = signedIn(me);
  // 只有登入、完成首次設定、AI 開啟時才讀額度；其他情況顯示預設上限，不打 API。
  const quotaPath = features.ai && user && !needsOnboarding(user) ? '/api/ai/quota' : null;
  const quota = useApiData(quotaPath, isAiQuotaResponse);

  const about = <AboutAi quota={quota.data} />;
  // 已登入、完成首次設定、AI 開著：ApplySection 自己把說明放在「目前狀態」與申請表之間。
  const statusFirst = !loading && features.ai && features.auth && user !== null && !needsOnboarding(user);
  let body;
  if (loading) body = <LoadingBlock />;
  else if (!features.ai)
    body = (
      <ComingSoon title="AI 批改即將開放">
        <p>AI 批改還在準備中，開放後就可以在這裡申請。在那之前，寫作練習、單字與歷屆試題都可以照常使用。</p>
      </ComingSoon>
    );
  else
    body = (
      <RequireAccount
        soonTitle="AI 批改即將開放"
        loginMessage={<p>申請 AI 批改需要先登入。</p>}
      >
        {(signedInMe) => <ApplySection me={signedInMe} quota={quota.data} about={about} />}
      </RequireAccount>
    );

  return (
    <article>
      <title>{`申請 AI 批改｜${APP_NAME}`}</title>
      <h1 className={pageTitleCls}>申請 AI 批改</h1>
      <div className="mt-6 grid grid-cols-1 gap-4">
        {!statusFirst && about}
        {body}
      </div>
    </article>
  );
}

/** 各任務點數：以後端回的 task_points 為準，缺欄位時用共用常數。 */
function taskPoints(quota: AiQuotaResponse | null): Record<AiTask, number> {
  const fromServer: unknown = quota?.task_points;
  const pick = (task: AiTask) => {
    const v = isObject(fromServer) ? fromServer[task] : undefined;
    return isNum(v) ? v : AI_TASK_POINTS[task];
  };
  return { translation_grade: pick('translation_grade'), essay_grade: pick('essay_grade'), essay_ocr: pick('essay_ocr') };
}

function AboutAi({ quota }: { quota: AiQuotaResponse | null }) {
  const points = taskPoints(quota);
  // 管理員（不限點數）的額度不代表一般規則，改顯示預設值。
  const personal = quota !== null && !isUnlimited(quota.points.day_limit) ? quota : null;
  return (
    <section className={cardCls}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={sectionTitleCls}>AI 批改是什麼</h2>
        <AiNoticeBadge />
      </div>
      <div className="mt-2 space-y-2 text-[0.95rem]">
        <p>
          AI 依學測的評分方式批改你的中譯英與英文作文：中譯英逐句標出錯誤、說明扣分原因，並給你保留原意的修正版；
          英文作文給內容、組織、文法句構、字彙拼字四項分數、三個優先改進與逐段建議。手寫作文可以拍照，由 AI 辨識文字，你確認後再批改。
        </p>
        <p className="text-muted">你正在和 AI 互動：{AI_NOTICE}，不是大考中心的正式評分，也可能有錯誤。</p>
      </div>

      <h3 className="mt-4 font-semibold">點數規則</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[16rem] text-left text-[0.95rem]">
          <thead className="text-sm text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                項目
              </th>
              <th scope="col" className="whitespace-nowrap py-1 text-right font-medium">
                點數
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="py-1.5 pr-3">中譯英批改（2 句一組）</td>
              <td className="whitespace-nowrap py-1.5 text-right">{points.translation_grade} 點</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">英文作文批改</td>
              <td className="whitespace-nowrap py-1.5 text-right">{points.essay_grade} 點</td>
            </tr>
            <tr>
              <td className="py-1.5 pr-3">手寫作文照片辨識＊</td>
              <td className="whitespace-nowrap py-1.5 text-right">{points.essay_ocr} 點</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-muted">＊確認辨識文字後送批改，另計作文批改的 {points.essay_grade} 點。</p>
      <ul className="mt-3 space-y-1 text-[0.95rem]">
        <li className="ml-5 list-disc">
          每天 {personal?.points.day_limit ?? DEFAULT_AI_LIMITS.pointsDay} 點、每月{' '}
          {personal?.points.month_limit ?? DEFAULT_AI_LIMITS.pointsMonth} 點
          {personal ? '' : `（試用等級每天 ${DEFAULT_AI_LIMITS.pointsTrialDay} 點）`}。
        </li>
        <li className="ml-5 list-disc">
          每天最多批改{' '}
          {personal && !isUnlimited(personal.essays.day_limit) ? personal.essays.day_limit : DEFAULT_AI_LIMITS.essaysDay} 篇作文。
        </li>
        <li className="ml-5 list-disc">同時進行中的批改最多 {quota?.concurrent.limit ?? DEFAULT_AI_LIMITS.concurrent} 個。</li>
        <li className="ml-5 list-disc">台灣時間 00:00 重置；批改失敗會全額退還點數。</li>
      </ul>
      <p className="mt-2 text-sm text-muted">做題、看解析、單字與自評都不花點數。</p>

      <details className="mt-4">
        <summary className="cursor-pointer py-2.5 font-semibold">使用須知（能做什麼、不能做什麼、遇到不當內容怎麼辦）</summary>
        <ul className="mt-2 space-y-1 text-[0.95rem]">
          <li className="ml-5 list-disc">AI 能做的：依學測的評分方式指出錯誤、說明原因、給分數與修改建議。</li>
          <li className="ml-5 list-disc">
            AI 不能做的：保證分數準確、代替老師或大考中心評分、替你寫作文。分數和真正的考試可能有落差。
          </li>
          <li className="ml-5 list-disc">不要在作答裡寫真實姓名、學校、地址或電話；需要人名時用虛構的名字。</li>
          <li className="ml-5 list-disc">
            AI 的回饋會先經過過濾才顯示。如果仍看到不恰當或讓你不舒服的內容，請不要理會它，可以刪除那份紀錄，並告訴你信任的老師或家人（線上回報即將開放）。
          </li>
        </ul>
      </details>
    </section>
  );
}

/** 管理員與 unlimited 等級的上限是很大的數字（後端傳 10 億），畫面顯示「不限」。 */
const UNLIMITED_THRESHOLD = 100_000_000;

export function isUnlimited(limit: number): boolean {
  return limit >= UNLIMITED_THRESHOLD;
}

/** 今天還能用的點數：今日與本月剩餘取小者；不限點數時為 null。 */
export function remainingToday(quota: AiQuotaResponse): number | null {
  if (isUnlimited(quota.points.day_limit) && isUnlimited(quota.points.month_limit)) return null;
  const day = quota.points.day_limit - quota.points.day_used;
  const month = quota.points.month_limit - quota.points.month_used;
  return Math.max(0, Math.min(day, month));
}

function usedOf(used: number, limit: number, unit: string, verb = '已用'): string {
  return isUnlimited(limit) ? `${verb} ${used} ${unit}（不限）` : `${verb} ${used}／${limit} ${unit}`;
}

/** 已核准時的今日／本月用量。 */
function QuotaUsage({ quota }: { quota: AiQuotaResponse }) {
  const remaining = remainingToday(quota);
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.95rem]">
      <dt className="text-muted">今日剩餘</dt>
      <dd>
        {remaining === null ? (
          '不限點數'
        ) : (
          <>
            <strong>{remaining}</strong> 點（台灣時間 00:00 重置）
          </>
        )}
      </dd>
      <dt className="text-muted">今日點數</dt>
      <dd>{usedOf(quota.points.day_used, quota.points.day_limit, '點')}</dd>
      <dt className="text-muted">本月點數</dt>
      <dd>{usedOf(quota.points.month_used, quota.points.month_limit, '點')}</dd>
      <dt className="text-muted">今日作文</dt>
      <dd>{usedOf(quota.essays.day_used, quota.essays.day_limit, '篇', '已批改')}</dd>
    </dl>
  );
}

function ApplySection({ me, quota, about }: { me: MeResponseSignedIn; quota: AiQuotaResponse | null; about: ReactNode }) {
  const features = useFeatures();
  const [applied, setApplied] = useState<AiStatus | null>(null);
  const status = applied ?? me.user.ai_status;
  const canApply = status === 'none' || status === 'rejected';

  return (
    <>
      <section className={cardCls} aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={sectionTitleCls}>目前狀態</h2>
          <AiStatusBadge status={status} />
        </div>
        <p className="mt-2 text-[0.95rem]">{AI_STATUS_DESCRIPTIONS[status]}</p>
        {status === 'approved' && (
          <>
            <p className="mt-1 text-sm text-muted">額度等級：{AI_TIER_LABELS[me.user.ai_tier]}</p>
            {quota && <QuotaUsage quota={quota} />}
            <Link to="/writing" className={`${btnSecondary} mt-3`}>
              前往寫作練習
            </Link>
          </>
        )}
        {(status === 'pending' || status === 'waitlist') && (
          <Link to="/writing" className={`${btnSecondary} mt-3`}>
            先用自我檢核練習寫作
          </Link>
        )}
        {status === 'rejected' && (
          <p className="mt-1 text-sm text-muted">
            每次申請至少間隔 {AI_APPLY_COOLDOWN_SECONDS} 秒，每個帳號最多申請 {AI_APPLY_MAX_COUNT} 次。
          </p>
        )}
        {features.aiPaused && (
          <div className="mt-3">
            <Notice tone="warn">AI 功能暫停中（最晚台灣時間明天 00:00 自動恢復），暫時無法送出批改；申請仍然可以送出。</Notice>
          </div>
        )}
      </section>
      {about}
      {canApply && <ApplyForm me={me} capFull={quota?.approval.full === true} onApplied={setApplied} />}
      {!canApply && pendingAiConsents(me, status).length > 0 && (
        <AiReconsentForm me={me} kinds={pendingAiConsents(me, status)} />
      )}
    </>
  );
}

/**
 * AI 處理說明改版（或撤回、或改報未滿 18 歲）後要重新確認的種類：只對已申請（pending／waitlist）或已核准的人有意義，
 * 後端在 MeResponseSignedIn.pending_ai_consents 列出；這時 AI 端點回 403 consent_required，一般功能不受影響。
 */
function pendingAiConsents(me: MeResponseSignedIn, status: AiStatus): ConsentKind[] {
  if (status !== 'pending' && status !== 'waitlist' && status !== 'approved') return [];
  return (me.pending_ai_consents ?? []).filter((k) => k === 'ai_processing' || k === 'guardian_ack');
}

function AiReconsentForm({ me, kinds }: { me: MeResponseSignedIn; kinds: ConsentKind[] }) {
  const { applyMe, refresh } = useMe();
  const [checked, setChecked] = useState<Partial<Record<ConsentKind, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versionStale = me.consent_versions.ai !== AI_CONSENT_VERSION;
  const canSubmit = kinds.every((k) => checked[k] === true) && !versionStale && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const body: ConsentsPostBody = { items: kinds.map((kind) => ({ kind, version: me.consent_versions.ai, granted: true })) };
    try {
      const res = await apiPost('/api/me/consents', body);
      setBusy(false);
      if (isMeResponse(res) && res.user) applyMe(res);
      else await refresh();
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err, { bad_request: '送出的資料不正確，或 AI 處理說明剛好更新了。請重新整理頁面後再試一次。' }));
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4">
      <Notice tone="warn" title="請重新確認 AI 處理說明">
        <p>AI 處理說明已更新、你撤回了同意，或你的年齡區間改了。重新同意後才能繼續使用 AI 批改；其他功能不受影響。</p>
      </Notice>
      {kinds.includes('ai_processing') && <PolicyView doc={AI_PROCESSING_NOTICE} />}
      <section className={cardCls}>
        {versionStale && (
          <div className="mb-3">
            <Notice tone="error" title="AI 處理說明剛剛更新了">
              <p>本頁顯示的不是最新版本。請重新整理頁面後再同意。</p>
            </Notice>
          </div>
        )}
        <div className="space-y-3">
          {kinds.map((kind) => (
            <label key={kind} className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={checked[kind] === true}
                onChange={(e) => setChecked((prev) => ({ ...prev, [kind]: e.target.checked }))}
                className={checkboxCls}
              />
              <span>
                {kind === 'ai_processing'
                  ? `我已閱讀並同意 AI 處理說明（${me.consent_versions.ai} 版）：我的翻譯、作文與手寫照片會傳給 Anthropic 的 API 處理，處理地點可能在台灣境外`
                  : '我未滿 18 歲，已告知法定代理人（父母或監護人）並取得同意'}
              </span>
            </label>
          ))}
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <button type="submit" disabled={!canSubmit} className={`${btnPrimary} mt-4`}>
          {busy ? '送出中…' : '同意並繼續使用'}
        </button>
      </section>
    </form>
  );
}

function ApplyForm({
  me,
  capFull,
  onApplied,
}: {
  me: MeResponseSignedIn;
  /** 核准名額已滿（GET /api/ai/quota 的 approval.full）：送出後會排入候補。 */
  capFull: boolean;
  onApplied: (status: AiStatus) => void;
}) {
  const { refresh } = useMe();
  const noteId = useId();
  const noteHintId = useId();
  const [note, setNote] = useState('');
  const [agreeAi, setAgreeAi] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const under18 = me.user.age_band === 'under18';
  const versionStale = me.consent_versions.ai !== AI_CONSENT_VERSION;
  const noteOk = note.trim().length > 0 && note.length <= AI_APPLY_NOTE_MAX;
  const canSubmit = noteOk && agreeAi && (!under18 || guardian) && !versionStale && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const body: AiApplyBody = { note: note.trim(), ai_consent_version: me.consent_versions.ai, guardian_ack: under18 && guardian };
    try {
      const res = await apiPost('/api/ai/apply', body);
      setBusy(false);
      if (isAiApplyResponse(res)) onApplied(res.ai_status);
      void refresh();
    } catch (err) {
      setBusy(false);
      setError(
        errorMessage(err, {
          rate_limited: `申請太頻繁，或已達申請次數上限（每次至少間隔 ${AI_APPLY_COOLDOWN_SECONDS} 秒、每個帳號最多 ${AI_APPLY_MAX_COUNT} 次）。`,
          conflict: '目前的狀態不能申請（例如 AI 功能已被停用）。請重新整理頁面看看最新狀態。',
          consent_required: '請先到「我的帳號」填寫年齡區間，並同意最新版的隱私權說明與服務條款。',
          bad_request: '送出的資料不正確，或 AI 處理說明剛好更新了。請重新整理頁面後再試一次。',
        }),
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4">
      <PolicyView doc={AI_PROCESSING_NOTICE} />
      <section className={cardCls}>
        <h2 className={sectionTitleCls}>申請表</h2>
        {capFull && (
          <div className="mt-3">
            <Notice tone="warn" title="本月名額已滿">
              <p>現在送出申請會先排入候補，有名額時依申請順序核准。</p>
            </Notice>
          </div>
        )}
        {versionStale && (
          <div className="mt-3">
            <Notice tone="error" title="AI 處理說明剛剛更新了">
              <p>本頁顯示的不是最新版本。請重新整理頁面後再申請；若仍看到這則提示，代表網站還在更新，請稍後再試。</p>
            </Notice>
          </div>
        )}
        <div className="mt-3">
          <label htmlFor={noteId} className={labelCls}>
            想用 AI 批改做什麼？（必填，最多 {AI_APPLY_NOTE_MAX} 字）
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={AI_APPLY_NOTE_MAX}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            aria-describedby={noteHintId}
            placeholder="例如：準備學測，想每週練兩篇作文並看看哪裡要加強。"
            className={`${fieldCls} resize-y`}
          />
          <p id={noteHintId} className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm text-muted">
            <span>站主審核時會看到這段說明。請不要寫真實姓名、學校或聯絡方式。</span>
            <span>
              {note.length}／{AI_APPLY_NOTE_MAX}
            </span>
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={agreeAi} onChange={(e) => setAgreeAi(e.target.checked)} className={checkboxCls} />
            <span>
              我已閱讀並同意 AI 處理說明（{me.consent_versions.ai} 版）：我的翻譯、作文與手寫照片會傳給 Anthropic 的 API
              處理，處理地點可能在台灣境外
            </span>
          </label>
          {under18 && (
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={guardian} onChange={(e) => setGuardian(e.target.checked)} className={checkboxCls} />
              <span>我未滿 18 歲，已告知法定代理人（父母或監護人）並取得同意</span>
            </label>
          )}
        </div>
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <button type="submit" disabled={!canSubmit} className={`${btnPrimary} mt-4`}>
          {busy ? '送出中…' : '送出申請'}
        </button>
        {!canSubmit && !busy && !versionStale && (
          <p className="mt-2 text-sm text-muted">
            填寫用途說明並勾選同意{under18 ? '（含法定代理人）' : ''}後才能送出。
          </p>
        )}
      </section>
    </form>
  );
}
