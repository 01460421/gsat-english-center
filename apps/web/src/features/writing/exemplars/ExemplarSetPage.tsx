/**
 * /writing/essay/exemplars/:id：一組範文（docs/design/model-essays.md §1.7–§1.11、§8.1–§8.5）。
 *
 *   等待     輪詢 GET /api/exemplars/:id（Poller<T>，每 2 秒、3 分鐘後每 15 秒，分頁看不到時暫停）：AI 聲明、三個骨架、
 *            aria-live 的「排隊中」→「範文產生中，大約需要 1–3 分鐘…」。完成時不搶焦點：只有焦點還在 body 上才移到 h1。
 *   失敗     依退還原因說明（點數已退還）；自訂題不是英文作文題目時另外說明（aria-live 播報同一句），附「修改題目再試」。
 *   結果     頁首（題目標題、來源、日期、AI 聲明）→ 題目（收合）→ AI 怎麼理解這一題、三篇共用的構想 → 三篇範文（檢視切換 ?view=：
 *            逐篇＝手機分頁／main ≥ 58.5rem 三欄，逐段對照；亮點標示的開關）→ 三版對照（?sub= 而且題目相符時多「你的作文」欄，
 *            預設打開比你高一級的那一篇）→ 動作（複製全部、列印、這組範文有問題、重新產生、回到題目寫一篇、刪除）→ 回報 → 頁尾。
 *   列印     beforeprint 時換成列印版（三篇照逐篇的順序全部印出、基礎版後面印常見的錯、頁首頁尾印 AI 聲明、不印「你的作文」），
 *            收合的「題目」打開、印完收回；index.css 的 @media print 隱藏導覽與按鈕。
 *   唯讀     開關關著（ExemplarsGate）：照常顯示與刪除、可以按「這組範文有問題」；重新產生、再試一次都不顯示。
 * 快捷鍵（桌機，R7）：1／2／3 切到基礎版／穩健版／頂標版，H 開關亮點標示；文字欄位裡不作用。
 */
import { EXEMPLAR_LEVELS, type CreateExemplarSetBody, type ExemplarLevel, type ExemplarSetDetail, type ExemplarSetView } from '@gsat/shared';
import { Copy, Flag, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiRequestError } from '../../../lib/api';
import { useHotkeys, type HotkeyDef } from '../../../lib/hotkeys';
import { useIsDesktop, useMainTier } from '../../../lib/media';
import { APP_NAME } from '../../../modules';
import { AssistSafetyCare } from '../../assistant/components/parts';
import { BackLink, ConfirmButton, ErrorMessage, Notice, ReportAiContent, card, primaryButton, secondaryButton } from '../components/ui';
import { CustomPromptView } from '../custom/CustomPromptView';
import type { ErrorView } from '../lib/errors';
import { attemptPathOf, formatUnixTime } from '../lib/format';
import { useStaticData } from '../lib/hooks';
import { useRefreshMeOnConsentError } from '../lib/useErrorView';
import { ExemplarsGate, ExemplarsHeader, useExemplarAccess } from './components/ExemplarAccess';
import { ExemplarCompareTable } from './components/ExemplarCompareTable';
import { ExemplarColumns, ExemplarParagraphCompare, ExemplarPrintEssays, ExemplarTabsView, type HighlightState } from './components/ExemplarEssays';
import { ExemplarTypicalErrors } from './components/ExemplarTypicalErrors';
import { ALL_NOTE_KINDS, ExemplarViewSwitch, HighlightControls, type ExemplarViewMode } from './components/ExemplarViewSwitch';
import { SitePromptPreview } from './components/SitePromptPreview';
import {
  EXEMPLARS_PATH,
  EXEMPLARS_TITLE,
  EXEMPLAR_COPY_DISCLAIMER,
  EXEMPLAR_FOOTER,
  NOT_WRITING_TEXT,
  QUEUED_TEXT,
  RUNNING_TEXT,
  SLOW_TEXT,
  SOURCE_LABELS,
  VIEW_UNAVAILABLE_TEXT,
  levelLabel,
} from './labels';
import { allPlainText, essayPlainText } from './lib/copyText';
import { exemplarRefundMessage, useExemplarErrorView } from './lib/errors';
import { createExemplarSet, deleteExemplarSet, rateExemplarSet } from './lib/exemplarsApi';
import { writeAttemptHandoff, writeExemplarHandoff } from './lib/handoff';
import { isExemplarSetPending, useExemplarPoller, type ExemplarPoller } from './lib/poller';
import { loadSitePrompt } from './lib/sitePrompts';
import { defaultLevelFor, useYourEssay } from './lib/yourEssay';

export default function ExemplarSetPage() {
  const { id = '' } = useParams();
  return (
    <ExemplarsGate>
      <SetBody key={id} id={id} />
    </ExemplarsGate>
  );
}

/** 建立時已經拿到的那一組（共用快取命中、之前產生過）：首頁 navigate 時放在 state。 */
function initialFromState(state: unknown, id: string): ExemplarSetDetail | null {
  const d = (state as { detail?: unknown } | null)?.detail;
  return typeof d === 'object' && d !== null && (d as { id?: unknown }).id === id ? (d as ExemplarSetDetail) : null;
}

function SetBody({ id }: { id: string }) {
  const location = useLocation();
  const [initial] = useState(() => initialFromState(location.state, id));
  const poller = useExemplarPoller(id, initial);
  const { snapshot } = poller;
  useRefreshMeOnConsentError(snapshot.error);
  const detail = snapshot.detail;
  if (!detail) {
    if (snapshot.phase === 'error') {
      if (snapshot.error instanceof ApiRequestError && snapshot.error.status === 404) return <NotFound />;
      return <LoadError error={snapshot.error} onRetry={() => poller.restart()} />;
    }
    return (
      <section className="py-10 text-center">
        <title>{`${EXEMPLARS_TITLE}｜寫作練習｜${APP_NAME}`}</title>
        <h1 className="sr-only">{EXEMPLARS_TITLE}</h1>
        <p role="status" className="text-muted">
          讀取中…
        </p>
      </section>
    );
  }
  return <SetView detail={detail} poller={poller} />;
}

function useErrorViewOf(error: unknown): ErrorView | null {
  const errorView = useExemplarErrorView();
  const [view, setView] = useState<ErrorView | null>(null);
  useEffect(() => {
    let alive = true;
    void errorView(error).then((v) => alive && setView(v));
    return () => {
      alive = false;
    };
  }, [error, errorView]);
  return view;
}

function NotFound() {
  return (
    <section className="space-y-3 py-2">
      <title>{`找不到這一組範文｜寫作練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這一組範文</h1>
      <p className="text-muted">這一組範文可能已經刪除，或超過保存期限（最後一次更新後 180 天）。</p>
      <BackLink to={EXEMPLARS_PATH}>{EXEMPLARS_TITLE}</BackLink>
    </section>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const view = useErrorViewOf(error);
  return (
    <section className="space-y-3 py-2">
      <title>{`${EXEMPLARS_TITLE}｜寫作練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">讀不到這一組範文</h1>
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={primaryButton}>
        再試一次
      </button>
    </section>
  );
}

/** 等待中：三個骨架卡片（aria-hidden；狀態在 live region）。 */
function Skeletons() {
  return (
    <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
      {EXEMPLAR_LEVELS.map((l) => (
        <div key={l} className="space-y-2 rounded-xl border border-line p-4">
          <p className="font-semibold text-muted">{levelLabel(l)}</p>
          <div className="h-3 w-full animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 退回失敗訊息
  }
  return false;
}

function SetView({ detail, poller }: { detail: ExemplarSetDetail; poller: ExemplarPoller }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const access = useExemplarAccess();
  const closed = access.state === 'closed';
  const ready = access.state === 'ready';
  const isDesktop = useIsDesktop();
  const { ws } = useMainTier();
  const errorView = useExemplarErrorView();
  const sub = params.get('sub');
  const viewMode: ExemplarViewMode = params.get('view') === 'paragraph' ? 'paragraph' : 'essay';
  const pending = isExemplarSetPending(detail);
  const view: ExemplarSetView | null = detail.status === 'done' ? detail.view : null;
  const your = useYourEssay(sub, view ? detail : null);
  const yourEssay = your.status === 'ready' ? your.essay : null;
  const [chosenLevel, setChosenLevel] = useState<ExemplarLevel | null>(null);
  const level = chosenLevel ?? (yourEssay ? defaultLevelFor(yourEssay.score) : 'basic');
  const [highlights, setHighlights] = useState<HighlightState>({ on: true, kinds: ALL_NOTE_KINDS });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<ErrorView | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [printing, setPrinting] = useState(false);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const existing = detail.existing === true || (location.state as { detail?: { existing?: boolean } } | null)?.detail?.existing === true;
  const site = useStaticData(() => (detail.source !== 'custom' && detail.group_id ? loadSitePrompt(detail.group_id) : Promise.resolve(null)));

  // ── 狀態播報與完成時的焦點 ──
  const [announcement, setAnnouncement] = useState(() => (pending ? (detail.status === 'queued' ? QUEUED_TEXT : RUNNING_TEXT) : ''));
  const wasPending = useRef(pending);
  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      setAnnouncement(detail.status === 'queued' ? QUEUED_TEXT : poller.snapshot.speed === 'slow' ? SLOW_TEXT : RUNNING_TEXT);
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    // 播報和畫面上的提示（role="alert"）說同一個原因：不是英文作文題目時用同一句 NOT_WRITING_TEXT。
    setAnnouncement(
      detail.status === 'done' ? '範文完成了。' : detail.not_writing_task ? NOT_WRITING_TEXT : `${exemplarRefundMessage(detail.failure)}，點數已經退還。`,
    );
    const active = document.activeElement;
    if (active === null || active === document.body) h1Ref.current?.focus({ preventScroll: true });
  }, [pending, detail.status, detail.failure, detail.not_writing_task, poller.snapshot.speed]);

  // ── 列印：beforeprint 時換成列印版（逐篇的順序、三篇全部） ──
  // 收合的「題目」在列印前打開（有些瀏覽器不支援 index.css 的 ::details-content，關著的 details 內容就不會印出；
  // 同學習報告頁的 useExpandForPrint），印完再收回去（學生原本打開的就不動）。
  const promptRef = useRef<HTMLDetailsElement>(null);
  const openedForPrint = useRef(false);
  const beforePrint = useRef(() => {
    const d = promptRef.current;
    if (d && !d.open) {
      d.open = true;
      openedForPrint.current = true;
    }
    flushSync(() => setPrinting(true));
  });
  useEffect(() => {
    const before = beforePrint.current;
    const after = () => {
      setPrinting(false);
      const d = promptRef.current;
      if (d && openedForPrint.current) d.open = false;
      openedForPrint.current = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const setView = (mode: ExemplarViewMode) => {
    const next = new URLSearchParams(params);
    if (mode === 'paragraph') next.set('view', 'paragraph');
    else next.delete('view');
    setParams(next, { replace: true, state: location.state });
  };

  const copyEssay = async (l: ExemplarLevel) => {
    if (!view) return;
    const ok = await copyToClipboard(essayPlainText(view, l, detail.title));
    setCopyStatus(ok ? `已複製${levelLabel(l)}` : '無法自動複製，請手動選取文字複製。');
  };
  const copyAll = async () => {
    if (!view) return;
    const ok = await copyToClipboard(allPlainText(view, detail.title));
    setCopyStatus(ok ? '已複製全部（含常見的錯）' : '無法自動複製，請手動選取文字複製。');
  };

  // ── 快捷鍵（桌機）：1／2／3、H ──
  const actions = useRef({ pick: (_l: ExemplarLevel) => {}, toggle: () => {} });
  actions.current = {
    pick: (l) => {
      flushSync(() => {
        setChosenLevel(l);
        if (viewMode !== 'essay') setView('essay');
      });
      document.querySelector<HTMLElement>(`[data-exemplar-level="${l}"] h3`)?.focus({ preventScroll: false });
    },
    toggle: () => setHighlights((h) => ({ ...h, on: !h.on })),
  };
  const hotkeys = useMemo<HotkeyDef[]>(
    () => [
      ...EXEMPLAR_LEVELS.map((l, i) => ({ keys: [String(i + 1)], description: `看${levelLabel(l)}`, group: '這一頁' as const, run: () => actions.current.pick(l) })),
      { keys: ['h'], description: '開關亮點標示', group: '這一頁' as const, run: () => actions.current.toggle() },
    ],
    [],
  );
  useHotkeys(hotkeys, { enabled: isDesktop && view !== null && !printing });

  const regenerate = async (fresh: boolean) => {
    setBusy(true);
    setActionError(null);
    let body: CreateExemplarSetBody | null = null;
    if (detail.source !== 'custom' && detail.group_id) body = { source: 'site', group_id: detail.group_id, ...(fresh ? { fresh: true } : {}) };
    else if (detail.prompt && !detail.prompt.hidden) {
      const { text, figure_text, paragraphs, min_words, max_words } = detail.prompt;
      body = { source: 'custom', prompt: { text, figure_text, paragraphs, min_words, max_words }, allow_custom: true, ...(fresh ? { fresh: true } : {}) };
    }
    if (!body) {
      setBusy(false);
      return;
    }
    try {
      const created = await createExemplarSet(body);
      const qs = sub ? `?sub=${encodeURIComponent(sub)}` : '';
      if (created.id === detail.id) poller.restart();
      else navigate(`${EXEMPLARS_PATH}/${encodeURIComponent(created.id)}${qs}`, { state: { detail: created.detail, started: created.detail === null } });
    } catch (err) {
      setActionError(await errorView(err, { submitting: true }));
    } finally {
      setBusy(false);
    }
  };

  const rate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      poller.accept(await rateExemplarSet(detail.id, detail.rating === 'wrong' ? null : 'wrong'));
    } catch (err) {
      setActionError(await errorView(err, { rating: true }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteExemplarSet(detail.id);
      navigate(EXEMPLARS_PATH, { replace: true });
    } catch (err) {
      setActionError(await errorView(err, { deleting: true }));
      setBusy(false);
    }
  };

  const editCustomPrompt = () => {
    if (detail.prompt && !detail.prompt.hidden) writeExemplarHandoff(detail.prompt);
    navigate(`${EXEMPLARS_PATH}?from=custom`);
  };

  const backToWrite = () => {
    if (!detail.prompt || detail.prompt.hidden) return;
    writeAttemptHandoff(detail.prompt);
    navigate('/writing/essay/custom?prompt=exemplar');
  };

  const attemptPath = detail.source !== 'custom' && detail.group_id ? attemptPathOf('essay', detail.group_id) : null;
  const canCreate = ready && !closed;
  const promptBlock =
    detail.source === 'custom' ? (
      detail.prompt ? (
        <CustomPromptView prompt={detail.prompt} />
      ) : (
        <p className="text-muted">讀不到這一題的題目。</p>
      )
    ) : site.status === 'ready' && site.value ? (
      <SitePromptPreview site={site.value} />
    ) : site.status === 'loading' ? (
      <p className="text-muted">題目載入中…</p>
    ) : (
      <p className="text-muted">這一題的題目暫時讀不到（可能已經改版），範文照常顯示。</p>
    );

  const header = (
    <div>
      <BackLink to={EXEMPLARS_PATH}>{EXEMPLARS_TITLE}</BackLink>
      <ExemplarsHeader title={detail.title} docTitle={`${detail.title}｜${EXEMPLARS_TITLE}`} headingRef={h1Ref}>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg">{SOURCE_LABELS[detail.source]}</span>
          <span>{formatUnixTime(detail.created_at)}</span>
          {detail.cache_hit && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-fg">0 點（共用）</span>}
        </p>
      </ExemplarsHeader>
    </div>
  );

  return (
    <article className="space-y-5" data-exemplar-print="">
      {header}
      <p className="exemplar-print-only text-sm">{EXEMPLAR_COPY_DISCLAIMER.replace(/^— /, '')}</p>
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {closed && (
        <Notice tone="warn">
          <p>作文範文暫停使用中；這一組仍然可以看與刪除。</p>
        </Notice>
      )}
      {existing && detail.status === 'done' && (
        <Notice>
          <p>你之前產生過這一題，這是那一組（沒有另外扣點）。</p>
        </Notice>
      )}

      {pending && (
        <section aria-label="產生中" className="space-y-3">
          <p className="text-[0.95rem]">{detail.status === 'queued' ? QUEUED_TEXT : poller.snapshot.speed === 'slow' ? SLOW_TEXT : RUNNING_TEXT}</p>
          {poller.snapshot.error !== null && poller.snapshot.phase !== 'error' && <p className="text-sm text-muted">連線不穩，正在重試…</p>}
          {poller.snapshot.phase === 'error' && <PollStopped error={poller.snapshot.error} onRetry={() => poller.restart()} />}
          <Skeletons />
        </section>
      )}

      {/* 退還的組沒有 view：身心安全旗標由詳情的 safety_flag 帶來（例如題目欄寫的不是作文題目，而是心裡的話）。 */}
      {detail.status === 'failed' && detail.safety_flag && <AssistSafetyCare note={null} />}

      {detail.status === 'failed' && (
        <section className={`space-y-3 ${card}`} aria-label="沒有產生完成">
          {detail.not_writing_task ? (
            <p role="alert" className="font-semibold text-bad">
              {NOT_WRITING_TEXT}
            </p>
          ) : (
            <p role="alert" className="font-semibold text-bad">
              範文沒有產生完成：{exemplarRefundMessage(detail.failure)}。點數已全額退還。
            </p>
          )}
          {canCreate && (
            <div className="flex flex-wrap gap-2">
              {detail.source === 'custom' ? (
                <button type="button" className={detail.not_writing_task ? primaryButton : secondaryButton} onClick={editCustomPrompt}>
                  修改題目再試
                </button>
              ) : null}
              {!detail.not_writing_task && (
                <button type="button" className={primaryButton} disabled={busy} onClick={() => void regenerate(false)}>
                  再產生一次
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {detail.status === 'done' && !view && (
        <Notice tone="warn">
          <p>{VIEW_UNAVAILABLE_TEXT}</p>
        </Notice>
      )}

      {view && (
        <>
          {(view.safety_flag ?? detail.safety_flag) && <AssistSafetyCare note="下面的範文照常提供。" />}
          <details ref={promptRef} className={`${card} exemplar-expand`}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
              <h2 className="inline text-lg">題目</h2>
            </summary>
            <div className="mt-2">{promptBlock}</div>
          </details>
          {(view.task_reading_zh || view.plan_zh) && (
            <div className="grid gap-3 lg:@ws/main:grid-cols-2">
              {view.task_reading_zh && (
                <section aria-labelledby="exemplar-reading-h" className={card}>
                  <h2 id="exemplar-reading-h" className="text-lg font-semibold">
                    AI 怎麼理解這一題
                  </h2>
                  <p className="mt-1 text-[0.95rem] break-words">{view.task_reading_zh}</p>
                </section>
              )}
              {view.plan_zh && (
                <section aria-labelledby="exemplar-plan-h" className={card}>
                  <h2 id="exemplar-plan-h" className="text-lg font-semibold">
                    三篇共用的構想
                  </h2>
                  <p className="mt-1 text-[0.95rem] break-words">{view.plan_zh}</p>
                </section>
              )}
            </div>
          )}

          <section aria-labelledby="exemplar-essays-h" className="space-y-4">
            <h2 id="exemplar-essays-h" className="text-xl font-bold">
              三篇範文
            </h2>
            {printing ? (
              <ExemplarPrintEssays view={view} />
            ) : (
              <>
                <div className="exemplar-screen-only flex flex-wrap items-start gap-x-6 gap-y-3">
                  <ExemplarViewSwitch value={viewMode} onChange={setView} />
                  <HighlightControls value={highlights} onChange={setHighlights} />
                </div>
                {viewMode === 'paragraph' ? (
                  <>
                    <ExemplarParagraphCompare view={view} highlights={highlights} />
                    <ExemplarTypicalErrors errors={view.typical_errors} headingLevel={3} />
                  </>
                ) : isDesktop && ws ? (
                  <ExemplarColumns view={view} highlights={highlights} onCopy={(l) => void copyEssay(l)} />
                ) : (
                  <ExemplarTabsView view={view} level={level} onLevel={setChosenLevel} highlights={highlights} onCopy={(l) => void copyEssay(l)} />
                )}
              </>
            )}
          </section>

          <ExemplarCompareTable view={view} your={printing ? null : yourEssay} />
        </>
      )}

      <p role="status" className="text-sm text-muted">
        {copyStatus}
      </p>

      <div className="exemplar-screen-only space-y-3">
        {view && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => void copyAll()}>
              <Copy aria-hidden="true" className="size-4" />
              複製全部
            </button>
            <button
              type="button"
              className={secondaryButton}
              onClick={() => {
                beforePrint.current();
                window.print();
              }}
            >
              <Printer aria-hidden="true" className="size-4" />
              列印／存成 PDF
            </button>
            <button type="button" className={secondaryButton} aria-pressed={detail.rating === 'wrong'} disabled={busy} onClick={() => void rate()}>
              <Flag aria-hidden="true" className="size-4" />
              這組範文有問題
            </button>
          </div>
        )}
        {detail.rating === 'wrong' && <p className="text-sm text-muted">已回報這組範文有問題；同一題有兩位同學回報，共用的範文就會停用。再按一次可以取消。</p>}
        <div className="flex flex-wrap gap-2">
          {view && canCreate && (
            <ConfirmButton
              label="重新產生（8 點）"
              question="重新產生會用 8 點、不讀共用的範文，結果只給你自己。確定嗎？"
              confirmLabel="確定重新產生"
              onConfirm={() => void regenerate(true)}
              disabled={busy}
              triggerClassName={secondaryButton}
            />
          )}
          {attemptPath ? (
            <Link to={attemptPath} className={secondaryButton}>
              回到題目寫一篇
            </Link>
          ) : detail.source === 'custom' && detail.prompt && !detail.prompt.hidden ? (
            <button type="button" className={secondaryButton} onClick={backToWrite}>
              回到題目寫一篇
            </button>
          ) : null}
        </div>
        {view && <ReportAiContent variant="exemplar" />}
        {actionError && <ErrorMessage view={actionError} />}
        <div className="flex justify-end">
          <ConfirmButton
            label="刪除這一組"
            question="確定要刪除這一組範文嗎？刪除後無法復原（共用的範文不受影響）。"
            confirmLabel="確定刪除"
            onConfirm={() => void remove()}
            disabled={busy || pending}
          />
        </div>
        {pending && <p className="text-right text-xs text-muted">範文產生中，完成後才能刪除。</p>}
      </div>

      <p className="text-sm text-muted">{EXEMPLAR_FOOTER}</p>
      <p className="exemplar-print-only text-sm">{EXEMPLAR_COPY_DISCLAIMER.replace(/^— /, '')}</p>
    </article>
  );
}

function PollStopped({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const view = useErrorViewOf(error);
  return (
    <div className="space-y-2">
      {view && <ErrorMessage view={view} />}
      <button type="button" onClick={onRetry} className={secondaryButton}>
        再試一次
      </button>
    </div>
  );
}
