/**
 * /writing/essay/ai/:code：本站仿真作文作答（docs/design/bank-writing.md §2.4、§2.5）。
 *
 *   1. 讀題：提示、圖（清理過的 SVG 用 <img> 顯示，加上文字描述；圖表題另有資料表）、題目要你寫什麼（moves）、字數與段數。
 *   2. 鷹架（收合）：穩定基礎是構思圖、兩段大綱與句型開頭；進階是兩段大綱；頂標是規劃檢核表。另有三層提示，一次開一層。
 *   3. 作答：打字作答，字數與段數即時檢查（和歷屆題相同）；手寫拍照只在 AI 批改的路徑提供，流程同歷屆題。
 *   4. 對照：有寫內容就能按「寫好了，看評分規準與範文」（少於 100 字先確認）。按下後作答鎖定，這時才下載 answers 檔，
 *      顯示本題的評分重點與分數帶、自評四項，範文收在下方展開（標「AI 生成範文，僅供參考」）。
 * AI 批改直接呼叫 lib/submit.ts、lib/writingApi.ts；歷屆的 EssayAttemptPage 一行都沒改。
 */
import { ESSAY_SHORT_WORDS, PHOTO_MAX_COUNT, TIER_LABELS, type EssayBody, type SelfAssessment } from '@gsat/shared';
import { ChevronRight, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { dataErrorMessage } from '../../../data/client';
import { APP_NAME } from '../../../modules';
import { AiGroupBadge } from '../../practice/components/AiGroupBadge';
import { displayTopic } from '../../practice/labels';
import { AiAccessNotice, QuotaSummary, taskPoints } from '../components/AiAccessPanel';
import { PhotoPicker, type PickedPhoto } from '../components/PhotoPicker';
import { AiNotice, BackLink, ConfirmButton, DataError, ErrorMessage, Loading, Notice, card, englishInputProps, primaryButton, secondaryButton, textInput } from '../components/ui';
import { useAiAccess } from '../lib/access';
import { completeEssayScores, draftKey, saveDraft } from '../lib/drafts';
import { isQuotaError, type ErrorView } from '../lib/errors';
import { essayRequirement } from '../lib/format';
import { useAutosave, useQuota, useRevealOnOpen, useStaticData } from '../lib/hooks';
import { listOriginBack, listOriginState } from '../lib/listOrigin';
import { photoQualityIssue } from '../lib/photo';
import { AlreadySubmittedError, saveSelfAssessment, startTask, upsertSubmission } from '../lib/submit';
import { checkEssayLength } from '../lib/text';
import { useErrorView } from '../lib/useErrorView';
import { deletePhotos, uploadPhoto } from '../lib/writingApi';
import { BankFigure } from './components/BankFigure';
import { BankHints } from './components/BankHints';
import { BankNotFound } from './components/BankNotFound';
import { BankScaffold } from './components/BankScaffold';
import { BankSourceNote } from './components/BankSourceNote';
import { EssayReveal } from './components/EssayReveal';
import { bankAttemptPath, bankListPath, loadBankAnswers, type BankEssayPromptFile, type WritingBankEntry, type WritingBankIndex } from './data';
import { emptyBankEssayDraft, loadRawDraft, toBankEssayDraft, type BankEssayDraft } from './drafts';
import { bankErrorView } from './errors';
import { nextEntry, useBankItem } from './useBankItem';

export default function BankEssayAttemptPage() {
  const { code } = useParams();
  return <BankEssayLoader key={code ?? ''} code={code} />;
}

function BankEssayLoader({ code }: { code: string | undefined }) {
  const data = useBankItem<BankEssayPromptFile>('composition', code);
  const ready = data.status === 'ready' && data.value.found ? data.value : null;
  const tier = ready?.entry.tier;
  // 從題型頁（/composition）的本站仿真題列表點進來的，返回那一頁、停在同一個難度；否則回到本站仿真題的列表頁。
  const back = listOriginBack(
    useLocation().state,
    { to: bankListPath('composition', tier), label: `本站仿真作文${tier ? `（${TIER_LABELS[tier]}）` : ''}` },
    tier ? `?tier=${tier}` : '',
  );
  return (
    <article>
      <BackLink to={back.to}>{back.label}</BackLink>
      {data.status === 'loading' && (
        <>
          <title>{`本站仿真作文｜${APP_NAME}`}</title>
          <h1 className="sr-only">本站仿真作文</h1>
          <Loading>題目載入中…</Loading>
        </>
      )}
      {data.status === 'error' && (
        <>
          <title>{`本站仿真作文｜${APP_NAME}`}</title>
          <h1 className="mb-4 text-2xl font-bold">本站仿真作文</h1>
          <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />
        </>
      )}
      {data.status === 'ready' && !data.value.found && <BankNotFound section="composition" back={back} />}
      {ready && <BankEssayAttempt entry={ready.entry} index={ready.index} prompt={ready.prompt} />}
    </article>
  );
}

/** 題目：提示、圖、題目要你寫什麼、字數與段數。 */
function EssayPromptSection({ prompt }: { prompt: BankEssayPromptFile }) {
  const requirement = essayRequirement(prompt);
  return (
    <section aria-labelledby="bank-prompt-h" className={`space-y-3 ${card}`}>
      <h2 id="bank-prompt-h" className="font-semibold">
        題目
      </h2>
      <p className="whitespace-pre-line text-[1.02rem]">{prompt.stem}</p>
      {prompt.figures.map((f, i) => (
        <BankFigure key={i} figure={f} index={i} />
      ))}
      {prompt.moves.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">題目要你寫什麼</h3>
          <ul className="mt-1 space-y-1 text-[0.95rem]">
            {prompt.moves.map((m) => (
              <li key={`${m.paragraph}-${m.zh}`} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full bg-primary-soft px-2 text-sm font-semibold text-primary">第 {m.paragraph} 段</span>
                <span className="min-w-0">{m.zh}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {requirement && <p className="text-sm font-medium">要求：{requirement}</p>}
    </section>
  );
}

function BankEssayAttempt({ entry, index, prompt }: { entry: WritingBankEntry; index: WritingBankIndex; prompt: BankEssayPromptFile }) {
  const navigate = useNavigate();
  const groupId = prompt.group_id;
  const key = draftKey('essay', groupId);
  const [draft, setDraft] = useState<BankEssayDraft>(() => toBankEssayDraft(loadRawDraft(key)) ?? emptyBankEssayDraft());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { ok: saved, discard } = useAutosave(key, draft);
  const access = useAiAccess();
  const errorView = useErrorView();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoSubmissionId, setPhotoSubmissionId] = useState<string | null>(null);
  const [photoRiskAccepted, setPhotoRiskAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);
  const revealed = draft.revealedAt !== null;
  const panel = useRevealOnOpen<HTMLElement>(revealed);
  const length = checkEssayLength(draft.text, prompt.paragraphs);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const topic = displayTopic(prompt.topic);
  const title = topic ? `作文：${topic}` : '英文作文';
  const next = nextEntry(index, entry);
  // 「下一題」照樣帶著從哪一頁的列表點進來（題型頁），返回連結才一路回得去。
  const origin = listOriginState(useLocation().state);

  // 離開頁面時釋放預覽圖的記憶體。
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const update = (patch: Partial<BankEssayDraft>) => setDraft((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  /** 立刻寫進這台裝置（對照、送出之後馬上換頁或重新整理，狀態也不會掉）。 */
  const persistNow = (patch: Partial<BankEssayDraft>) => {
    const nextDraft = { ...draftRef.current, ...patch, updatedAt: Date.now() };
    draftRef.current = nextDraft;
    discard();
    saveDraft(key, nextDraft);
    setDraft(nextDraft);
  };
  const completeSelf = completeEssayScores(draft.selfScores);
  const selfAssess: SelfAssessment | null = completeSelf ? { kind: 'essay', scores: completeSelf } : null;

  const reveal = () => {
    if (!revealed) persistNow({ revealedAt: Date.now() });
    else panel.current?.querySelector<HTMLElement>('h2')?.focus();
  };

  const fail = async (err: unknown) => {
    if (err instanceof AlreadySubmittedError) {
      persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: err.submission.id });
      setPhotoSubmissionId(null);
      navigate(`/writing/submissions/${encodeURIComponent(err.submission.id)}`);
      return;
    }
    const special = bankErrorView(err);
    const q = !special && isQuotaError(err) ? await refreshQuota() : quota;
    setError(special ?? (await errorView(err, { quota: q, submitting: true })));
    setBusy(null);
  };

  const submitTyped = async () => {
    setBusy('送出中…');
    setError(null);
    try {
      const body: EssayBody = { text: draft.text.trim() };
      const submission = await upsertSubmission(draft.submissionId, { kind: 'essay', group_id: groupId, input_mode: 'typed', body }, { body });
      persistNow({ submissionId: submission.id });
      await saveSelfAssessment(submission.id, selfAssess).catch(() => undefined);
      await startTask('essay-grade', submission.id);
      persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: submission.id });
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      await fail(err);
    }
  };

  const submitPhotos = async () => {
    if (photos.length === 0) return;
    setBusy('建立作答…');
    setError(null);
    try {
      const body: EssayBody = { text: '' };
      // 照片模式不沿用打字的草稿 id（input_mode 不同）；上傳中途失敗重送時沿用這次建立的那一份。
      const submission = await upsertSubmission(photoSubmissionId, { kind: 'essay', group_id: groupId, input_mode: 'photo', body }, { body });
      setPhotoSubmissionId(submission.id);
      if (submission.photos.length > photos.length) await deletePhotos(submission.id);
      for (const [i, photo] of photos.entries()) {
        setBusy(`上傳第 ${i + 1}／${photos.length} 張照片…`);
        await uploadPhoto(submission.id, i + 1, photo.blob);
      }
      setBusy('送出辨識…');
      await startTask('essay-ocr', submission.id);
      // 辨識送出就算送了 AI（之後的確認與批改在結果頁完成）。
      persistNow({ aiSubmittedAt: Date.now(), lastSubmissionId: submission.id });
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      await fail(err);
    }
  };

  const clearAll = () => {
    persistNow({ ...emptyBankEssayDraft(), mode: draftRef.current.mode, aiSubmittedAt: draftRef.current.aiSubmittedAt, lastSubmissionId: draftRef.current.lastSubmissionId });
    setError(null);
  };

  const photoAvailable = access.state === 'ready' && access.ocr;
  const photoRisky = photos.some((p) => photoQualityIssue(p) !== null);
  const ocrPoints = taskPoints(quota, 'essay_ocr');
  const gradePoints = taskPoints(quota, 'essay_grade');
  const revealLabel = '寫好了，看評分規準與範文';
  const revealButtonClass = revealed ? secondaryButton : primaryButton;

  return (
    <div className="space-y-4">
      <header>
        <title>{`本站仿真${title}｜寫作練習｜${APP_NAME}`}</title>
        <p className="text-sm text-muted">本站仿真・{TIER_LABELS[entry.tier]}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
        <div className="mt-2">
          <AiGroupBadge />
        </div>
        <p className="mt-2 text-[0.95rem]">{prompt.instructions}</p>
      </header>

      <EssayPromptSection prompt={prompt} />

      {prompt.scaffold && <BankScaffold scaffold={prompt.scaffold} />}
      {prompt.hints.length > 0 && (
        <section aria-labelledby="bank-hints-h" className={card}>
          <h2 id="bank-hints-h" className="font-semibold">
            審題提示
          </h2>
          <BankHints hints={prompt.hints} level={draft.hintLevel} label="這一題的提示" onLevel={(hintLevel) => update({ hintLevel })} />
        </section>
      )}

      <div role="group" aria-label="作答方式" className="flex flex-wrap gap-2">
        {(['typed', 'photo'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={draft.mode === m}
            onClick={() => update({ mode: m })}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${draft.mode === m ? 'border-primary bg-primary text-on-primary' : 'border-line'}`}
          >
            {m === 'typed' ? '打字作答' : '拍照上傳手寫稿'}
          </button>
        ))}
      </div>

      {draft.mode === 'typed' ? (
        <section aria-label="打字作答" className={`space-y-3 ${card}`}>
          <label htmlFor="bank-essay-text" className="block text-sm text-muted">
            你的作文（段落之間換行）{revealed && <span>（已對照，作答已鎖定）</span>}
          </label>
          <textarea
            id="bank-essay-text"
            rows={16}
            value={draft.text}
            readOnly={revealed}
            onChange={(e) => update({ text: e.currentTarget.value })}
            aria-describedby="bank-essay-count"
            className={`${textInput} ${revealed ? 'bg-surface-2' : ''}`}
            {...englishInputProps}
          />
          <p id="bank-essay-count" className="text-sm tabular-nums text-muted" aria-live="polite">
            <span className={length.belowHint || length.overWords ? 'font-semibold text-bad' : ''}>{length.words} 個單詞</span>・
            <span className={length.paragraphDeduction ? 'font-semibold text-bad' : ''}>{length.paragraphs} 段</span>
            {length.chars > 3000 && <span className={length.overChars ? 'font-semibold text-bad' : ''}>・{length.chars.toLocaleString('zh-TW')}／4,000 字元</span>}
          </p>
          {!revealed && length.belowHint && !length.empty && (
            <Notice tone="warn">
              <p>
                題目要求至少 120 個單詞，目前只有 {length.words} 個{length.veryShort ? '；少於 100 個單詞會扣總分 1 分' : ''}。
              </p>
            </Notice>
          )}
          {!revealed && length.paragraphDeduction && prompt.paragraphs ? (
            <Notice tone="warn">
              <p>題目要求文分 {prompt.paragraphs} 段，目前只有 {length.paragraphs} 段（未分段會扣 1 分）。段落之間換行就算分段。</p>
            </Notice>
          ) : null}
          {length.tooLong && (
            <Notice tone="error">
              <p>超過上限（600 個單詞或 4,000 字元），不能送 AI 批改，請刪減。</p>
            </Notice>
          )}
          <p className="flex items-start gap-1.5 text-sm text-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            作文裡不要寫真實姓名、學校、地址或電話。
          </p>
          <p className="text-sm text-muted" role="status">
            {saved ? '草稿會自動存在這台裝置。' : '這個瀏覽器無法儲存草稿（可能是無痕模式），離開頁面後內容會遺失。'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {!revealed && !length.empty && length.words < ESSAY_SHORT_WORDS ? (
              <ConfirmButton
                label={revealLabel}
                question={`你的作文只有 ${length.words} 個單詞（少於 ${ESSAY_SHORT_WORDS} 個會扣分）。對照後作答會鎖定，確定要看評分規準與範文嗎？`}
                confirmLabel="確定對照"
                onConfirm={reveal}
                triggerClassName={revealButtonClass}
              />
            ) : (
              <button type="button" className={revealButtonClass} disabled={!revealed && length.empty} aria-expanded={revealed} aria-controls="bank-reveal" onClick={reveal}>
                {revealed ? (
                  <>
                    <Lock aria-hidden="true" className="size-4" />
                    看評分規準與範文
                  </>
                ) : (
                  revealLabel
                )}
              </button>
            )}
            {access.state === 'ready' && (
              <button type="button" className={revealed ? primaryButton : secondaryButton} disabled={busy !== null || length.empty || length.tooLong} onClick={submitTyped}>
                {busy ?? `送出 AI 批改（${gradePoints} 點）`}
              </button>
            )}
          </div>
          {!revealed && length.empty && <p className="text-sm text-muted">寫了內容才能看評分規準與範文（對照後作答會鎖定，不能再修改）。</p>}
          {access.state === 'ready' ? (
            <>
              <AiNotice />
              <QuotaSummary quota={quota} />
            </>
          ) : (
            <AiAccessNotice access={access} compact />
          )}
          {draft.lastSubmissionId && (
            <p>
              <Link to={`/writing/submissions/${encodeURIComponent(draft.lastSubmissionId)}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2">
                看上次的批改結果
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </p>
          )}
          {error && <ErrorMessage view={error} />}
          <div className="flex justify-end">
            <ConfirmButton
              label="清除重寫"
              question="確定要清除這篇作文、對照與自評嗎？"
              confirmLabel="確定清除"
              onConfirm={clearAll}
              disabled={busy !== null}
              doneMessage="已清除這篇作文、對照與自評。"
            />
          </div>
        </section>
      ) : (
        <section aria-label="拍照上傳手寫稿" className={`space-y-3 ${card}`}>
          {photoAvailable ? (
            <>
              <AiNotice />
              <PhotoPicker
                photos={photos}
                onChange={(nextPhotos) => {
                  setPhotos(nextPhotos);
                  setPhotoRiskAccepted(false);
                }}
                disabled={busy !== null}
              />
              <Notice>
                <p className="font-medium">照片隱私</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li>照片先在你的手機上縮小並去除拍攝資訊（EXIF，例如拍攝地點），才上傳。</li>
                  <li>照片只用來辨識文字，辨識完成後立即刪除，最長保留 24 小時；不會給管理員看，也不會匯出。</li>
                  <li>拍照前請遮住或不要入鏡姓名、學校等個人資料。</li>
                </ul>
              </Notice>
              <p className="text-sm text-muted">
                流程：上傳照片 → AI 辨識文字（{ocrPoints} 點）→ 你逐行確認、修正辨識錯誤 → AI 批改（{gradePoints} 點）。最多 {PHOTO_MAX_COUNT} 張。
              </p>
              <QuotaSummary quota={quota} />
              {photoRisky && (
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="checkbox" checked={photoRiskAccepted} onChange={(e) => setPhotoRiskAccepted(e.currentTarget.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
                  <span>照片可能看不清楚（見上方提醒）。我了解辨識不出來仍會扣 {ocrPoints} 點，仍要送出辨識。</span>
                </label>
              )}
              <button type="button" className={primaryButton} disabled={busy !== null || photos.length === 0 || (photoRisky && !photoRiskAccepted)} onClick={submitPhotos}>
                {busy ?? `上傳並辨識（${ocrPoints} 點）`}
              </button>
              {error && <ErrorMessage view={error} />}
            </>
          ) : access.state === 'ready' ? (
            <Notice>
              <p>
                <strong>拍照上傳即將開放。</strong>現在可以先用打字作答。
              </p>
            </Notice>
          ) : (
            <>
              <p className="text-[0.95rem]">拍照上傳手寫稿需要 AI 批改的權限：AI 先辨識你的字跡，你確認文字後再批改。不用 AI 的話，請用打字作答並對照評分規準與範文。</p>
              <AiAccessNotice access={access} compact />
            </>
          )}
        </section>
      )}

      {revealed && (
        <section id="bank-reveal" ref={panel} aria-labelledby="bank-reveal-h" tabIndex={-1} className="scroll-mt-20 space-y-3 focus:outline-none">
          <h2 id="bank-reveal-h" className="text-xl font-bold">
            評分規準與範文
          </h2>
          <EssayAnswers prompt={prompt} selfScores={draft.selfScores} onScores={(selfScores) => update({ selfScores })} />
        </section>
      )}

      {next && (
        <p className="flex justify-end">
          <Link to={bankAttemptPath(next.uid) ?? '#'} state={origin} className={secondaryButton}>
            下一題
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </p>
      )}

      <BankSourceNote />
    </div>
  );
}

/** 交出作答後才下載 answers 檔（這個元件只在對照之後才掛上）。 */
function EssayAnswers({
  prompt,
  selfScores,
  onScores,
}: {
  prompt: BankEssayPromptFile;
  selfScores: BankEssayDraft['selfScores'];
  onScores: (s: BankEssayDraft['selfScores']) => void;
}) {
  const data = useStaticData(() => loadBankAnswers(prompt.uid, prompt.version));
  if (data.status === 'loading') return <Loading>評分規準載入中…</Loading>;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;
  if (data.value.section_type !== 'composition') return <DataError message="參考內容的格式不正確，請重新整理頁面。" onRetry={data.retry} />;
  return <EssayReveal answers={data.value} selfScores={selfScores} onScores={onScores} />;
}
