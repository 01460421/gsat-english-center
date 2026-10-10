/**
 * /writing/submissions/:id：一份寫作提交的進度與結果。負責：前端寫作 W2。
 *
 * 輪詢 GET /api/submissions/{id}（每 2 秒、最多 3 分鐘；之後每 15 秒並提示「可以先離開，完成後回來看」，lib/polling.ts），
 * 依狀態顯示：
 *   draft        還沒送出（照片已上傳就可以在這裡送出辨識）
 *   ocr_queued   AI 辨識中
 *   ocr_ready    逐行確認辨識文字（OcrConfirm）→ PUT /api/submissions/{id}/confirm
 *   confirmed    自評（不用 AI）→ POST /api/ai/essay-grade
 *   queued／grading  批改中
 *   graded       結果（TranslationResult／EssayResult），扣了幾點與剩餘點數
 *   failed       失敗原因（點數已全額退還）與重送
 * 所有 AI 產生的內容都標「AI 批改，僅供參考」。後端未開放（features.auth 為 false）時不打 API，只顯示說明；
 * 登入了但還沒完成首次同意（或條款改版）時先導到 /account/welcome，同意後回到這一頁。
 *
 * 本站仿真題（group_id 'ai.tr.xxxxxx@v'；docs/design/bank-writing.md §2.6）：標題是「本站仿真 中譯英」加主題，頂端放 AI 出題標示；
 * 題目先看 index.json 的版本：和提交相同才讀 prompts 檔（中文題目、段數要求），graded 後另有「本站參考」收合區（展開才讀 answers 檔）；
 * 新版已上架或已下架時不請求舊版的檔案（已經不存在），顯示說明，批改結果照常顯示。
 */
import { parseBankGroupId, type EssayBody, type SubmissionDetail, type TranslationBody } from '@gsat/shared';
import { CirclePause, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { DataLoadError } from '../../data/client';
import { loginHref, needsOnboarding, useFeatures, useMe } from '../../lib/api';
import { welcomeHref } from '../account/ui';
import { APP_NAME } from '../../modules';
import { AiGroupBadge } from '../practice/components/AiGroupBadge';
import { displayTopic } from '../practice/labels';
import { BankAnswersPanel } from './bank/components/BankAnswersPanel';
import { bankVersionStatus, findBankEntry, loadBankPrompt, loadWritingBankIndex, type BankPromptFile, type WritingBankEntry } from './bank/data';
import { AiAccessNotice, QuotaSummary, taskPoints } from './components/AiAccessPanel';
import { EssayResult } from './components/EssayResult';
import { EssaySelfAssess } from './components/EssaySelfAssess';
import { OcrConfirm } from './components/OcrConfirm';
import { TranslationResult } from './components/TranslationResult';
import { AiNotice, BackLink, ConfirmButton, ErrorMessage, Loading, Notice, ReportAiContent, card, primaryButton, secondaryButton } from './components/ui';
import { findEssayPrompt, findTranslationSet, loadEssayIndex, loadTranslationIndex, parseGroupId, type EssayPrompt, type TranslationSet } from './data';
import { useAiAccess } from './lib/access';
import { clearDraft, completeEssayScores, isSelfDraft, loadDraft, ocrDraftKey, selfDraftKey, type SelfDraft } from './lib/drafts';
import { describeError, isQuotaError, refundReasonMessage, type ErrorView } from './lib/errors';
import { KIND_LABELS, STATUS_LABELS, attemptPathOf, formatUnixTime, groupLabel } from './lib/format';
import { useAutosave, useQuota, useSubmissionPoller } from './lib/hooks';
import { isPendingStatus } from './lib/polling';
import { saveSelfAssessment, startTask } from './lib/submit';
import { countEnglishWords, countParagraphs } from './lib/text';
import { useDescribeContext, useErrorView, useRefreshMeOnConsentError } from './lib/useErrorView';
import { deleteSubmission, getAiOp, type AiTaskPath } from './lib/writingApi';

export default function SubmissionResultPage() {
  const { id = '' } = useParams();
  const features = useFeatures();
  const { me, loading } = useMe();
  const location = useLocation();
  return (
    <article>
      <title>{`批改結果｜${APP_NAME}`}</title>
      <BackLink to="/writing">寫作練習</BackLink>
      {loading ? (
        <>
          <h1 className="sr-only">批改結果</h1>
          <Loading />
        </>
      ) : !features.auth ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">批改結果</h1>
          <div className="mt-4">
            <AiAccessNotice access={{ state: 'off' }} />
          </div>
        </>
      ) : !me.user ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">批改結果</h1>
          <div className="mt-4">
            <Notice>
              <p>
                批改紀錄只有本人看得到，請先
                <a href={loginHref(location.pathname)} className="mx-1 font-medium text-primary underline underline-offset-2">
                  用 Google 登入
                </a>
                。
              </p>
            </Notice>
          </div>
        </>
      ) : needsOnboarding(me) ? (
        // 還沒同意（或條款改版）：後端會回 403 consent_required，先去同意，完成後回到這一頁。
        <Navigate to={welcomeHref(location.pathname)} replace />
      ) : (
        <SubmissionView key={id} id={id} />
      )}
    </article>
  );
}

function isTranslationBody(body: SubmissionDetail['body']): body is TranslationBody {
  return body !== null && 'items' in body && Array.isArray(body.items);
}

function isEssayBody(body: SubmissionDetail['body']): body is EssayBody {
  return body !== null && 'text' in body && typeof body.text === 'string';
}

/**
 * 本站仿真題的題目狀態：current＝版本是最新的（有 prompts 檔）；outdated＝新版已上架（或檔案剛好不存在：網站在這幾秒內更新）；
 * removed＝已下架；unavailable＝其他載入錯誤（不顯示題目，照常顯示結果）。
 */
type BankPromptState =
  | { status: 'loading' }
  | { status: 'current'; prompt: BankPromptFile; entry: WritingBankEntry }
  | { status: 'outdated'; entry: WritingBankEntry | null }
  | { status: 'removed' }
  | { status: 'unavailable' };

/** 本站仿真題：先讀 index 確認版本，版本相同才讀 prompts 檔（新版上架後舊版的檔案已不存在，請求只會得到 404）。 */
function useBankPromptFor(groupId: string | null): BankPromptState | null {
  const bank = groupId ? parseBankGroupId(groupId) : null;
  const key = bank ? `${bank.uid}@${bank.version}` : null;
  const [state, setState] = useState<{ key: string; value: BankPromptState } | null>(null);
  useEffect(() => {
    if (!key || !bank) return;
    let disposed = false;
    const done = (value: BankPromptState) => {
      if (!disposed) setState({ key, value });
    };
    const fail = (err: unknown, entry: WritingBankEntry | null) =>
      done(err instanceof DataLoadError && err.kind === 'not_found' ? { status: 'outdated', entry } : { status: 'unavailable' });
    loadWritingBankIndex().then((index) => {
      const status = bankVersionStatus(index, bank.uid, bank.version);
      const entry = findBankEntry(index, bank.uid);
      if (status === 'removed') return done({ status: 'removed' });
      if (status === 'outdated' || !entry) return done({ status: 'outdated', entry });
      return loadBankPrompt(bank.uid, bank.version).then(
        (prompt) => done({ status: 'current', prompt, entry }),
        (err: unknown) => fail(err, entry),
      );
    }, (err: unknown) => fail(err, null));
    return () => {
      disposed = true;
    };
    // bank 由 key 決定（同一個 key 就是同一個 uid＠version），所以只依 key 重跑。
  }, [key]);
  if (!key) return null;
  return state && state.key === key ? state.value : { status: 'loading' };
}

/** 依提交的題組載入題目（顯示中文題目用；失敗就不顯示，不影響結果）。 */
function usePromptFor(detail: SubmissionDetail | null): { translation: TranslationSet | null; essay: EssayPrompt | null } {
  const [state, setState] = useState<{ key: string; translation: TranslationSet | null; essay: EssayPrompt | null } | null>(null);
  const kind = detail?.kind ?? null;
  const examId = detail ? (parseGroupId(detail.group_id)?.examId ?? null) : null;
  const key = kind && examId ? `${kind}:${examId}` : null;
  useEffect(() => {
    if (!key || !kind || !examId) return;
    let disposed = false;
    const done = (translation: TranslationSet | null, essay: EssayPrompt | null) => {
      if (!disposed) setState({ key, translation, essay });
    };
    if (kind === 'translation') {
      loadTranslationIndex().then(
        (idx) => done(findTranslationSet(idx, examId) ?? null, null),
        () => done(null, null),
      );
    } else {
      loadEssayIndex().then(
        (idx) => done(null, findEssayPrompt(idx, examId) ?? null),
        () => done(null, null),
      );
    }
    return () => {
      disposed = true;
    };
  }, [key, kind, examId]);
  return state && state.key === key ? state : { translation: null, essay: null };
}

/** 結算後實扣的點數（GET /api/ai/ops/{op_id}）。 */
function useChargedPoints(opId: string | null, settled: boolean): number | null {
  const [points, setPoints] = useState<{ opId: string; value: number } | null>(null);
  useEffect(() => {
    if (!opId || !settled) return;
    const controller = new AbortController();
    getAiOp(opId, controller.signal).then(
      (op) => setPoints({ opId, value: op.points_charged ?? op.points_reserved }),
      () => {
        // 只是資訊，拿不到就不顯示
      },
    );
    return () => controller.abort();
  }, [opId, settled]);
  return points && points.opId === opId ? points.value : null;
}

/**
 * 辨識中／批改中。stopped：輪詢因為錯誤停下來了（登入過期、找不到…），不能再說「會自動更新」，
 * 錯誤訊息與「再試一次」顯示在上方。
 */
function Pending({ label, slow, stopped }: { label: string; slow: boolean; stopped: boolean }) {
  if (stopped) {
    return (
      <section className={`space-y-2 ${card}`}>
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CirclePause aria-hidden="true" className="size-5 text-muted" />
          {label}
        </p>
        <p className="text-sm text-muted">自動更新已停止（原因見上方）。按「再試一次」或重新整理頁面，就能看到最新進度。</p>
      </section>
    );
  }
  return (
    <section className={`space-y-2 ${card}`} aria-live="polite">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary motion-reduce:animate-none" />
        {label}
      </p>
      <p className="text-sm text-muted">通常 20–60 秒完成，這一頁會自動更新。</p>
      {slow && (
        <Notice>
          <p>
            <strong>比平常久一些，可以先離開，完成後回來看。</strong>這一頁改成每 15 秒更新一次；之後從「寫作練習」的「我的寫作紀錄」也能打開這份結果。
          </p>
        </Notice>
      )}
    </section>
  );
}

function SubmissionView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { snapshot, restart, accept } = useSubmissionPoller(id);
  const { detail, phase, speed, error } = snapshot;
  const access = useAiAccess();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');
  const prompt = usePromptFor(detail);
  const bankPrompt = useBankPromptFor(detail?.group_id ?? null);
  const charged = useChargedPoints(detail?.op_id ?? null, detail?.status === 'graded');
  const errorContext = useDescribeContext();
  const errorView = useErrorView();
  const [actionError, setActionError] = useState<ErrorView | null>(null);
  const [busy, setBusy] = useState(false);
  // 手寫作文「已確認」那一步的自評：存在這台裝置，切到別的 App 或重新整理回來還在；送出批改後清掉。
  const selfKey = selfDraftKey(id);
  const [self, setSelf] = useState<SelfDraft>(() => loadDraft(selfKey, isSelfDraft) ?? { scores: null, checked: [] });
  const { discard: discardSelf } = useAutosave(selfKey, self);
  // 輪詢拿到 consent_required：重新讀 /api/me（需要同意時這一頁會自己導到歡迎頁）。
  useRefreshMeOnConsentError(error);

  // 剛批改完：更新剩餘點數。
  const status = detail?.status;
  useEffect(() => {
    if (status === 'graded' || status === 'failed') void refreshQuota();
  }, [status, refreshQuota]);

  if (phase === 'loading' || (!detail && phase !== 'error')) return <Loading>讀取中…</Loading>;
  if (!detail) {
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">批改結果</h1>
        <div className="mt-4 space-y-3">
          <ErrorMessage view={describeError(error, errorContext)} />
          <button type="button" className={secondaryButton} onClick={() => restart()}>
            再試一次
          </button>
        </div>
      </>
    );
  }

  const runTask = async (task: AiTaskPath, before?: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      if (before) await before();
      await startTask(task, detail.id);
      after?.();
      restart();
    } catch (err) {
      const q = isQuotaError(err) ? await refreshQuota() : quota;
      setActionError(await errorView(err, { quota: q }));
    } finally {
      setBusy(false);
    }
  };

  /** 確認文字後送批改：自評四項都評了才附上（失敗不擋批改）；送出成功後清掉這台裝置上的自評暫存。 */
  const submitEssayGrade = () => {
    const scores = completeEssayScores(self.scores);
    void runTask(
      'essay-grade',
      () => saveSelfAssessment(detail.id, scores ? { kind: 'essay', scores } : null).catch(() => undefined),
      () => {
        discardSelf();
        clearDraft(selfKey);
      },
    );
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteSubmission(detail.id);
      discardSelf();
      clearDraft(selfKey);
      clearDraft(ocrDraftKey(detail.id));
      navigate('/writing', { replace: true });
    } catch (err) {
      setActionError(await errorView(err));
      setBusy(false);
    }
  };

  const essayText = isEssayBody(detail.body) ? detail.body.text : '';
  const isBank = bankPrompt !== null;
  // 已下架的本站題沒有作答頁可以回去。
  const attemptPath = bankPrompt?.status === 'removed' ? null : attemptPathOf(detail.kind, detail.group_id);
  const bankCurrent = bankPrompt?.status === 'current' ? bankPrompt.prompt : null;
  const bankTopic = displayTopic(bankPrompt?.status === 'current' || bankPrompt?.status === 'outdated' ? (bankPrompt.entry?.topic ?? null) : null);
  const heading = `${groupLabel(detail.group_id)} ${KIND_LABELS[detail.kind]}${bankTopic ? `：${bankTopic}` : ''}`;
  // 中文題目：歷屆題用寫作索引，本站題用 prompts 檔（版本是最新的才有）。
  const translationStems = prompt.translation ?? (bankCurrent?.section_type === 'translation' ? bankCurrent : null);
  const essayStem = prompt.essay?.stem ?? (bankCurrent?.section_type === 'composition' ? bankCurrent.stem : null);
  const requiredParagraphs = prompt.essay?.paragraphs ?? (bankCurrent?.section_type === 'composition' ? bankCurrent.paragraphs : null);
  const isAiPage = detail.status !== 'draft' && detail.status !== 'self_graded';
  const stopped = phase === 'error';
  // 辨識或批改進行中不能刪（後端回 409）；看提交本身的狀態，不看輪詢有沒有在跑（輪詢可能因錯誤停了）。
  const canDelete = !isPendingStatus(detail.status);
  const gradeTask: AiTaskPath = detail.kind === 'translation' ? 'translation-grade' : 'essay-grade';
  const gradePoints = taskPoints(quota, detail.kind === 'translation' ? 'translation_grade' : 'essay_grade');
  const ocrFailed = detail.status === 'failed' && detail.kind === 'essay' && detail.input_mode === 'photo' && essayText.trim() === '';

  return (
    <div className="space-y-4">
      <header>
        <title>{`${heading}｜批改結果｜${APP_NAME}`}</title>
        <p className="text-sm text-muted">
          {formatUnixTime(detail.created_at)}・{detail.input_mode === 'photo' ? '手寫拍照' : '打字'}・{STATUS_LABELS[detail.status]}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{heading}</h1>
        {isBank && (
          <div className="mt-2">
            <AiGroupBadge />
          </div>
        )}
      </header>

      {isAiPage && <AiNotice />}
      {bankPrompt?.status === 'outdated' && (
        <Notice>
          <p>這題已更新成新版本，參考內容改看新版。</p>
          {attemptPath && (
            <Link to={attemptPath} className="mt-1 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
              看新版題目
            </Link>
          )}
        </Notice>
      )}
      {bankPrompt?.status === 'removed' && (
        <Notice>
          <p>這題已下架，本站參考內容不再提供。</p>
        </Notice>
      )}
      {essayStem && (
        <details className={card}>
          <summary className="cursor-pointer font-semibold">題目</summary>
          <p className="mt-2 whitespace-pre-line text-[0.95rem]">{essayStem}</p>
        </details>
      )}
      {error !== null && phase === 'polling' && (
        <Notice tone="warn" role="status">
          <p>連線不穩，正在重試…</p>
        </Notice>
      )}
      {stopped && (
        // 輪詢停了（登入過期、找不到這份作答、後端回「尚未開放」…）：畫面上的內容可能不是最新的，要說出來並給下一步。
        <div className="space-y-2">
          <ErrorMessage view={describeError(error, errorContext)} />
          <button type="button" className={secondaryButton} onClick={() => restart()}>
            再試一次
          </button>
        </div>
      )}

      {detail.status === 'draft' && (
        <section className={`space-y-3 ${card}`}>
          <p>這份作答還沒有送出批改。</p>
          {detail.input_mode === 'photo' && detail.photos.length > 0 && access.state === 'ready' ? (
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void runTask('essay-ocr')}>
              送出辨識（{taskPoints(quota, 'essay_ocr')} 點）
            </button>
          ) : (
            attemptPath && (
              <Link to={attemptPath} className={primaryButton}>
                回到作答頁
              </Link>
            )
          )}
        </section>
      )}

      {detail.status === 'ocr_queued' && <Pending label="AI 正在辨識你的手寫字…" slow={speed === 'slow'} stopped={stopped} />}
      {(detail.status === 'queued' || detail.status === 'grading') && (
        <Pending label={detail.status === 'queued' ? '排隊等待批改…' : 'AI 批改中…'} slow={speed === 'slow'} stopped={stopped} />
      )}

      {detail.status === 'ocr_ready' && detail.ocr && (
        <OcrConfirm
          submission={detail}
          ocr={detail.ocr}
          onConfirmed={accept}
          requiredParagraphs={requiredParagraphs}
          errorContext={errorContext}
        />
      )}
      {detail.status === 'ocr_ready' && !detail.ocr && (
        <Notice tone="warn">
          <p>辨識結果讀取不到，請重新整理頁面。</p>
        </Notice>
      )}

      {detail.status === 'confirmed' && (
        <>
          <section aria-labelledby="confirmed-h" className={`space-y-2 ${card}`}>
            <h2 id="confirmed-h" className="text-lg font-semibold">
              已確認的作文
            </h2>
            <p lang="en" className="whitespace-pre-wrap break-words">
              {essayText}
            </p>
            <p className="text-sm tabular-nums text-muted">
              {detail.word_count ?? countEnglishWords(essayText)} 個單詞・{detail.paragraphs ?? countParagraphs(essayText, detail.input_mode === 'photo')} 段
            </p>
          </section>
          <EssaySelfAssess
            scores={self.scores}
            checked={self.checked}
            onScores={(scores) => setSelf((s) => ({ ...s, scores }))}
            onToggle={(cid) => setSelf((s) => ({ ...s, checked: s.checked.includes(cid) ? s.checked.filter((x) => x !== cid) : [...s.checked, cid] }))}
          />
          <section className={`space-y-3 ${card}`}>
            {access.state === 'ready' ? (
              <>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy}
                  onClick={submitEssayGrade}
                >
                  {busy ? '送出中…' : `送出 AI 批改（${gradePoints} 點）`}
                </button>
                <QuotaSummary quota={quota} />
              </>
            ) : (
              <AiAccessNotice access={access} compact />
            )}
          </section>
        </>
      )}

      {detail.status === 'failed' && (
        <section className={`space-y-3 ${card}`}>
          <p className="font-semibold text-bad">
            {ocrFailed ? '辨識沒有完成' : '批改沒有完成'}：{refundReasonMessage(detail.failure)}。點數已全額退還。
          </p>
          {ocrFailed ? (
            <>
              <p className="text-sm text-muted">照片已刪除，請回到作答頁重新拍照上傳（光線充足、字跡清楚會比較好辨識）。</p>
              {attemptPath && (
                <Link to={attemptPath} className={primaryButton}>
                  回到作答頁
                </Link>
              )}
            </>
          ) : access.state === 'ready' ? (
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void runTask(gradeTask)}>
              {busy ? '送出中…' : `重新送出批改（${gradePoints} 點）`}
            </button>
          ) : (
            <AiAccessNotice access={access} compact />
          )}
        </section>
      )}

      {detail.status === 'graded' && detail.grading && (
        <>
          <section className={`space-y-1 ${card}`}>
            <p className="text-sm">
              {charged !== null ? (
                <>
                  這次批改扣 <strong className="tabular-nums">{charged}</strong> 點
                  {detail.input_mode === 'photo' ? `（照片辨識另計 ${taskPoints(quota, 'essay_ocr')} 點）` : ''}。
                </>
              ) : (
                <>這次批改依點數規則扣點（中譯英 {taskPoints(quota, 'translation_grade')} 點、作文 {taskPoints(quota, 'essay_grade')} 點）。</>
              )}
            </p>
            <QuotaSummary quota={quota} />
          </section>
          {detail.grading.kind === 'translation' ? (
            <TranslationResult
              grading={detail.grading}
              body={isTranslationBody(detail.body) ? detail.body : null}
              set={translationStems}
              selfAssess={detail.self_assess}
            />
          ) : (
            <EssayResult grading={detail.grading} text={essayText} selfAssess={detail.self_assess} />
          )}
          <ReportAiContent />
          {bankCurrent && <BankAnswersPanel uid={bankCurrent.uid} version={bankCurrent.version} kind={detail.kind} />}
          <div className="flex flex-wrap gap-2">
            {attemptPath && (
              <Link to={attemptPath} className={secondaryButton}>
                回到題目再練一次
              </Link>
            )}
          </div>
        </>
      )}

      {detail.status === 'graded' && !detail.grading && (
        <Notice tone="warn">
          <p>批改結果讀取不到，請重新整理頁面。</p>
        </Notice>
      )}

      {detail.status === 'self_graded' && (
        <section className={card}>
          <p>這份作答是自評，沒有使用 AI 批改。</p>
        </section>
      )}

      {actionError && <ErrorMessage view={actionError} />}

      {canDelete && (
        <div className="flex justify-end">
          <ConfirmButton label="刪除這份紀錄" question="確定要刪除這份作答與批改結果嗎？刪除後無法復原。" confirmLabel="確定刪除" onConfirm={() => void remove()} disabled={busy} />
        </div>
      )}
    </div>
  );
}
