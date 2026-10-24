/**
 * 確認畫面（同一頁的面板，不換路由；docs/design/model-essays.md §1.5 第 2–4 步、§1.6 第 3–4 步、§8.2）：
 *
 *   1. 題目預覽：網站題目從前端靜態檔顯示（和作答頁同一份）；自訂題顯示正規化後的題目（email、電話已遮）。
 *   2. 本站仿真題的鎖：這台裝置上這一題還沒對照、也沒送 AI 批改過，而且不是從批改結果頁（?sub=）來時，先請學生去作答頁寫；
 *      選「我已經寫過了，直接看」只換成點數的畫面（不寫任何東西）。鎖（作答頁同一支寫入，revealedAt）在按「產生三個層級的範文」
 *      送出之前才寫：沒登入、未核准、點數不夠、這一題不提供範文時，學生拿不到範文，草稿也不會被鎖住（§12.5）。
 *      寫不進去（無痕模式）時不送出；伺服器明確拒絕（JSON 的 4xx、503）時把剛寫的鎖收回。
 *   3. 點數：GET /api/exemplars/site-status（網站題目；要登入）與 GET /api/ai/quota（AI 已核准）：0 點、8 點＋今日剩餘、
 *      點數不足時停用、產生後不夠批改一篇作文的提醒（points.ts）。沒核准而這一題已經有共用範文時多一行「申請後 0 點就能看」。
 *      三篇的字數目標（shared 的 exemplarWordTargets，和 Worker 同一支；wordTargets.ts）在點數上面，誰都看得到。
 *   4. 「產生三個層級的範文」→ POST /api/exemplars：200（共用範文或之前產生過）／202 → 呼叫端換到結果頁。
 *      自訂題 400 custom_prompt_invalid → 回到表單標出位置；409 exemplar_site_match → 二選一的對話框。
 */
import { parseBankGroupId, type CreateExemplarSetBody, type CustomEssayPromptInput, type ExemplarSetDetail } from '@gsat/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiRequestError } from '../../../../lib/api';
import { dataErrorMessage } from '../../../../data/client';
import { DataError, ErrorMessage, Loading, Notice, primaryButton, secondaryButton } from '../../components/ui';
import { bankProgressOf, markBankEssayRevealed, unmarkBankEssayRevealed } from '../../bank/drafts';
import { CustomPromptView } from '../../custom/CustomPromptView';
import type { PromptFieldError } from '../../custom/errors';
import { isQuotaError, type ErrorView } from '../../lib/errors';
import { attemptPathOf } from '../../lib/format';
import { useQuota, useStaticData } from '../../lib/hooks';
import { useSignedIn } from '../../lib/access';
import {
  BANK_LOCK_GO,
  BANK_LOCK_ON_SUBMIT,
  BANK_LOCK_SKIP,
  BANK_LOCK_STORAGE_ERROR,
  BANK_LOCK_TEXT,
  BANK_MODEL_NOTE,
  CACHED_NEEDS_APPROVAL,
} from '../labels';
import { EXEMPLAR_NOT_READY, EXEMPLAR_UNAVAILABLE, useExemplarErrorView } from '../lib/errors';
import { createExemplarSet, getExemplarSiteStatus } from '../lib/exemplarsApi';
import { exemplarPointsInfo } from '../lib/points';
import { loadSitePrompt } from '../lib/sitePrompts';
import { customWordTargets, siteWordTargets, wordTargetLines } from '../lib/wordTargets';
import { ExemplarAccessNotice, useExemplarAccess } from './ExemplarAccess';
import { ExemplarSiteMatchDialog } from './ExemplarSiteMatchDialog';
import { SitePromptPreview } from './SitePromptPreview';

export type ConfirmTarget = { kind: 'site'; groupId: string } | { kind: 'custom'; prompt: CustomEssayPromptInput & { figure_text: string | null } };

type SiteStatusState = { state: 'idle' | 'loading' } | { state: 'ready'; cached: boolean } | { state: 'blocked'; message: string };

/**
 * 伺服器明確拒絕、沒有建立任何一組範文：JSON 的 4xx（點數、同意、未核准、不提供、題目不合格）或 503（全站暫停、功能沒開）。
 * 連線中斷、閘道的非 JSON 回應、500 不確定伺服器有沒有建立，鎖照樣留著。
 */
function rejectedBeforeCreate(err: unknown): boolean {
  return err instanceof ApiRequestError && !err.nonJson && ((err.status >= 400 && err.status < 500) || err.status === 503);
}

export function ExemplarConfirm({
  target,
  sub,
  onBack,
  onCreated,
  onPromptRejected,
  onUseSite,
}: {
  target: ConfirmTarget;
  /** 從批改結果頁來（?sub=）：本站仿真題不再擋（那一題已經寫過、批改過）。 */
  sub: string | null;
  onBack: () => void;
  onCreated: (id: string, detail: ExemplarSetDetail | null) => void;
  /** 自訂題被 Worker 擋下（D8 指紋、規則更新過）：回到表單標出位置。 */
  onPromptRejected: (error: PromptFieldError) => void;
  onUseSite: (groupId: string) => void;
}) {
  const access = useExemplarAccess();
  const signedIn = useSignedIn();
  const ready = access.state === 'ready';
  const { quota, refresh: refreshQuota } = useQuota(ready);
  const errorView = useExemplarErrorView();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groupId = target.kind === 'site' ? target.groupId : null;
  const bank = groupId ? parseBankGroupId(groupId) : null;
  const site = useStaticData(() => (groupId ? loadSitePrompt(groupId) : Promise.resolve(null)));
  // 本站仿真題、還沒對照也沒送批改、不是從批改結果頁來：先請學生去寫（鎖的面板），產生時才寫鎖。
  const [lockOnSubmit] = useState(() => bank !== null && sub === null && bankProgressOf('essay', groupId!) !== 'done');
  // 「我已經寫過了，直接看」只是換畫面（不寫任何東西）。
  const [lockPassed, setLockPassed] = useState(!lockOnSubmit);
  const [lockError, setLockError] = useState(false);
  const [status, setStatus] = useState<SiteStatusState>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [match, setMatch] = useState<{ group_id: string; title: string } | null>(null);

  // 打開時把焦點移到標題（同一頁換了一塊內容，讀屏要知道現在在哪裡）。
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    if (typeof headingRef.current?.scrollIntoView === 'function') headingRef.current.scrollIntoView({ block: 'nearest' });
  }, []);

  // 網站題目有沒有共用的範文（要登入；不讀不寫任何個人資料）。
  useEffect(() => {
    if (!groupId || !signedIn) return;
    const controller = new AbortController();
    setStatus({ state: 'loading' });
    getExemplarSiteStatus(groupId, controller.signal).then(
      (s) => setStatus({ state: 'ready', cached: s.cached }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiRequestError && err.code === 'exemplar_unavailable') setStatus({ state: 'blocked', message: EXEMPLAR_UNAVAILABLE });
        else if (err instanceof ApiRequestError && err.code === 'conflict') setStatus({ state: 'blocked', message: EXEMPLAR_NOT_READY });
        // 其他（連線、伺服器）：當成不知道有沒有共用範文，照 8 點說明；送出時伺服器會再決定。
        else setStatus({ state: 'ready', cached: false });
      },
    );
    return () => controller.abort();
  }, [groupId, signedIn]);

  const cached = status.state === 'ready' && status.cached;
  const points = exemplarPointsInfo({ cached, quota });
  const statusLoading = groupId !== null && signedIn && (status.state === 'idle' || status.state === 'loading');
  const blockedMessage = status.state === 'blocked' ? status.message : null;
  const canSubmit = ready && !busy && !points.blocked && !statusLoading && blockedMessage === null;

  // 三篇的字數目標（§2.4）：網站題目取題目檔的字數要求，自訂題取學生填的至少／最多。
  const targets =
    target.kind === 'custom' ? customWordTargets(target.prompt) : site.status === 'ready' && site.value ? siteWordTargets(site.value.source, site.value.prompt.word_count) : null;

  const submit = async (allowCustom = false) => {
    setBusy(true);
    setError(null);
    setMatch(null);
    setLockError(false);
    // 本站仿真題的鎖：真的要產生範文時才寫（作答從此唯讀）。這一題在別的分頁已經對照或送批改過就不用再寫。
    let lockedAt: number | null = null;
    if (lockOnSubmit && groupId && bankProgressOf('essay', groupId) !== 'done') {
      const now = Date.now();
      const saved = markBankEssayRevealed(groupId, now);
      if (saved === null) {
        setBusy(false);
        setLockError(true);
        return;
      }
      if (saved.revealedAt === now) lockedAt = now;
    }
    const body: CreateExemplarSetBody =
      target.kind === 'site' ? { source: 'site', group_id: target.groupId } : { source: 'custom', prompt: target.prompt, ...(allowCustom ? { allow_custom: true } : {}) };
    try {
      const created = await createExemplarSet(body);
      onCreated(created.id, created.detail);
    } catch (err) {
      setBusy(false);
      // 沒有建立任何一組範文：剛寫的鎖收回，草稿照樣可以改。
      if (lockedAt !== null && groupId && rejectedBeforeCreate(err)) unmarkBankEssayRevealed(groupId, lockedAt);
      if (err instanceof ApiRequestError && err.code === 'exemplar_site_match' && err.siteMatch) {
        setMatch(err.siteMatch);
        return;
      }
      if (err instanceof ApiRequestError && err.code === 'custom_prompt_invalid' && target.kind === 'custom') {
        const view = await errorView(err);
        const field = (['text', 'figure_text', 'paragraphs', 'min_words', 'max_words'] as const).find((f) => f === err.field) ?? 'text';
        onPromptRejected({ field, reason: err.reason, message: view.message, ranges: (err.ranges ?? []).map(([s, e]) => [s, e] as [number, number]) });
        return;
      }
      const q = isQuotaError(err) ? await refreshQuota() : quota;
      setError(await errorView(err, { quota: q, submitting: true }));
    }
  };

  const skipLock = () => setLockPassed(true);

  const heading = (
    <h2 id="exemplar-confirm-h" ref={headingRef} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
      確認題目與點數
    </h2>
  );

  // 題目預覽。
  let preview: ReactNode = null;
  if (target.kind === 'custom') {
    preview = (
      <section aria-label="題目" className="rounded-2xl border border-line bg-surface p-4 lg:p-5">
        <CustomPromptView prompt={{ ...target.prompt, paragraphs: target.prompt.paragraphs ?? null, min_words: target.prompt.min_words ?? null, max_words: target.prompt.max_words ?? null }} />
      </section>
    );
  } else if (site.status === 'loading') {
    preview = <Loading>題目載入中…</Loading>;
  } else if (site.status === 'error') {
    preview = <DataError message={dataErrorMessage(site.error)} onRetry={site.retry} />;
  } else if (site.value === null) {
    return (
      <section aria-labelledby="exemplar-confirm-h" className="space-y-3">
        {heading}
        <Notice tone="warn">
          <p>{EXEMPLAR_UNAVAILABLE}可以從「選網站上的題目」換一題，或自己輸入題目。</p>
        </Notice>
        <button type="button" className={secondaryButton} onClick={onBack}>
          換一題
        </button>
      </section>
    );
  } else {
    preview = (
      <div className="space-y-1">
        <p className="font-semibold">{site.value.task.title}</p>
        <SitePromptPreview site={site.value} />
      </div>
    );
  }

  const attemptPath = groupId ? attemptPathOf('essay', groupId) : null;

  return (
    <section aria-labelledby="exemplar-confirm-h" className="space-y-4" id="exemplar-confirm">
      {heading}
      {preview}
      {bank && !lockPassed ? (
        <div className="space-y-3 rounded-2xl border border-badge-fg/30 bg-badge-bg/60 p-4">
          <p>{BANK_LOCK_TEXT}</p>
          <div className="flex flex-wrap gap-2">
            {attemptPath && (
              <Link to={attemptPath} className={primaryButton}>
                {BANK_LOCK_GO}
              </Link>
            )}
            <button type="button" className={secondaryButton} onClick={skipLock}>
              {BANK_LOCK_SKIP}
            </button>
          </div>
        </div>
      ) : (
        <>
          {bank && (
            <Notice>
              <p>{BANK_MODEL_NOTE}</p>
            </Notice>
          )}
          {targets && blockedMessage === null && (
            <div className="space-y-1 text-[0.95rem]" data-testid="exemplar-word-targets">
              {wordTargetLines(targets).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          {blockedMessage ? (
            <Notice tone="warn">
              <p>{blockedMessage}</p>
            </Notice>
          ) : ready ? (
            statusLoading ? (
              <p role="status" className="text-sm text-muted">
                讀取點數中…
              </p>
            ) : (
              <div role="status" className="space-y-1 text-[0.95rem]">
                {points.lines.map((line) => (
                  <p key={line} className={points.blocked ? 'font-semibold text-bad' : undefined}>
                    {line}
                  </p>
                ))}
              </div>
            )
          ) : (
            <>
              <ExemplarAccessNotice access={access} />
              {cached && access.state !== 'closed' && <p className="text-sm">{CACHED_NEEDS_APPROVAL}</p>}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {access.state !== 'closed' && (
              <button type="button" className={primaryButton} disabled={!canSubmit} onClick={() => void submit()}>
                {busy ? '送出中…' : '產生三個層級的範文'}
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={onBack} disabled={busy}>
              {target.kind === 'site' ? '換一題' : '修改題目'}
            </button>
          </div>
          {lockOnSubmit && canSubmit && <p className="text-sm text-muted">{BANK_LOCK_ON_SUBMIT}</p>}
          {lockError && (
            <p role="alert" className="text-sm text-bad">
              {BANK_LOCK_STORAGE_ERROR}
              {attemptPath && (
                <Link to={attemptPath} className="ml-1 font-medium text-primary underline underline-offset-2">
                  {BANK_LOCK_GO}
                </Link>
              )}
            </p>
          )}
          {error && <ErrorMessage view={error} />}
        </>
      )}
      <ExemplarSiteMatchDialog
        match={match}
        points={points.cost || exemplarPointsInfo({ cached: false, quota }).cost}
        onUseSite={(id) => {
          setMatch(null);
          onUseSite(id);
        }}
        onKeepCustom={() => void submit(true)}
        onClose={() => setMatch(null)}
      />
    </section>
  );
}
