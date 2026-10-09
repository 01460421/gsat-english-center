/**
 * /writing/essay/:examId：英文作文作答。負責：前端寫作 W2。
 *
 * 題目＋兩種作答方式：
 *   (a) 打字：即時字數（英文單詞）與段數；少於 120 提醒；超過 600 單詞或 4,000 字元不能送 AI。
 *       AI 批改：POST /api/submissions（或 PUT 沿用草稿）→（自評）→ POST /api/ai/essay-grade → /writing/submissions/:id。
 *   (b) 拍照（AI 已核准且 features.ocr）：最多 2 張，前端縮圖後預覽 → 逐張 POST /api/submissions/{id}/photos?ord=1|2
 *       → POST /api/ai/essay-ocr → 導到 /writing/submissions/:id（輪詢、確認辨識文字、送批改都在那一頁，離開再回來可以接續）。
 * 草稿（文字、自評、檢核清單）自動存在這台裝置；照片不存。送出前可以先自評（不用 AI）。
 */
import { PHOTO_MAX_COUNT, type EssayBody, type SelfAssessment } from '@gsat/shared';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { dataErrorMessage } from '../../data/client';
import { APP_NAME } from '../../modules';
import { AiAccessNotice, QuotaSummary, taskPoints } from './components/AiAccessPanel';
import { EssayPromptView } from './components/EssayPromptView';
import { EssaySelfAssess } from './components/EssaySelfAssess';
import { PhotoPicker, type PickedPhoto } from './components/PhotoPicker';
import { PromptNotFound, SourceNote } from './components/SourceNote';
import { AiNotice, BackLink, ConfirmButton, DataError, ErrorMessage, Loading, Notice, card, englishInputProps, primaryButton, secondaryButton, textInput } from './components/ui';
import { findEssayPrompt, groupIdOf, loadEssayIndex, type EssayPrompt } from './data';
import { useAiAccess } from './lib/access';
import { clearDraft, completeEssayScores, draftKey, isEssayDraft, loadDraft, type EssayDraft } from './lib/drafts';
import { isQuotaError, type ErrorView } from './lib/errors';
import { examRefLabel } from './lib/format';
import { useAutosave, useQuota, useRevealOnOpen, useStaticData } from './lib/hooks';
import { listOriginBack } from './lib/listOrigin';
import { photoQualityIssue } from './lib/photo';
import { AlreadySubmittedError, saveSelfAssessment, startTask, upsertSubmission } from './lib/submit';
import { checkEssayLength } from './lib/text';
import { useErrorView } from './lib/useErrorView';
import { deletePhotos, uploadPhoto } from './lib/writingApi';

export default function EssayAttemptPage() {
  const { examId = '' } = useParams();
  const data = useStaticData(loadEssayIndex);
  const prompt = data.status === 'ready' ? findEssayPrompt(data.value, examId) : undefined;
  // 從英文作文題型頁（/composition）的列表點進來的，返回那一頁。
  const back = listOriginBack(useLocation().state, { to: '/writing/essay', label: '英文作文題目' });
  return (
    <article>
      <BackLink to={back.to}>{back.label}</BackLink>
      {data.status === 'loading' && (
        <>
          <title>{`英文作文作答｜${APP_NAME}`}</title>
          <h1 className="sr-only">英文作文作答</h1>
          <Loading>題目載入中…</Loading>
        </>
      )}
      {data.status === 'error' && (
        <>
          <title>{`英文作文作答｜${APP_NAME}`}</title>
          <h1 className="mb-4 text-2xl font-bold">英文作文作答</h1>
          <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />
        </>
      )}
      {data.status === 'ready' && !prompt && (
        <>
          <title>{`找不到這個題目｜${APP_NAME}`}</title>
          <PromptNotFound backTo={back.to} backLabel={`回到${back.label}`} />
        </>
      )}
      {prompt && <EssayAttempt key={prompt.exam_id} prompt={prompt} />}
    </article>
  );
}

function emptyDraft(): EssayDraft {
  return { text: '', mode: 'typed', submissionId: null, selfScores: null, checked: [], updatedAt: 0 };
}

function EssayAttempt({ prompt }: { prompt: EssayPrompt }) {
  const navigate = useNavigate();
  const groupId = groupIdOf(prompt);
  const key = draftKey('essay', groupId);
  const [draft, setDraft] = useState<EssayDraft>(() => loadDraft(key, isEssayDraft) ?? emptyDraft());
  const { ok: saved } = useAutosave(key, draft);
  const access = useAiAccess();
  const errorView = useErrorView();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoSubmissionId, setPhotoSubmissionId] = useState<string | null>(null);
  /** 照片可能太小或太窄時，學生確認「仍要送出辨識」（避免白扣辨識點數）。 */
  const [photoRiskAccepted, setPhotoRiskAccepted] = useState(false);
  const [selfOpen, setSelfOpen] = useState(false);
  const selfPanel = useRevealOnOpen(selfOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);
  const title = `${examRefLabel(prompt)} 英文作文`;
  const length = checkEssayLength(draft.text, prompt.paragraphs);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  // 離開頁面時釋放預覽圖的記憶體。
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const update = (patch: Partial<EssayDraft>) => setDraft((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  const completeSelf = completeEssayScores(draft.selfScores);
  const selfAssess: SelfAssessment | null = completeSelf ? { kind: 'essay', scores: completeSelf } : null;

  const fail = async (err: unknown) => {
    if (err instanceof AlreadySubmittedError) {
      // 上一次其實已經送出（回應遺失）：直接看那一份的進度，不再送一次、不再扣點。
      setDraft((d) => ({ ...d, submissionId: null }));
      setPhotoSubmissionId(null);
      navigate(`/writing/submissions/${encodeURIComponent(err.submission.id)}`);
      return;
    }
    const q = isQuotaError(err) ? await refreshQuota() : quota;
    setError(await errorView(err, { quota: q, submitting: true }));
    setBusy(null);
  };

  const submitTyped = async () => {
    setBusy('送出中…');
    setError(null);
    try {
      const body: EssayBody = { text: draft.text.trim() };
      const submission = await upsertSubmission(draft.submissionId, { kind: 'essay', group_id: groupId, input_mode: 'typed', body }, { body });
      setDraft((d) => ({ ...d, submissionId: submission.id }));
      await saveSelfAssessment(submission.id, selfAssess).catch(() => undefined);
      await startTask('essay-grade', submission.id);
      setDraft((d) => ({ ...d, submissionId: null }));
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
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      await fail(err);
    }
  };

  const clearAll = () => {
    clearDraft(key);
    setDraft((d) => ({ ...emptyDraft(), mode: d.mode }));
    setError(null);
  };

  const photoAvailable = access.state === 'ready' && access.ocr;
  const photoRisky = photos.some((p) => photoQualityIssue(p) !== null);
  const ocrPoints = taskPoints(quota, 'essay_ocr');
  const gradePoints = taskPoints(quota, 'essay_grade');

  return (
    <div className="space-y-4">
      <header>
        <title>{`${title}｜寫作練習｜${APP_NAME}`}</title>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{prompt.title}</span>
          {prompt.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      </header>

      <EssayPromptView prompt={prompt} />

      {/* 切換按鈕（aria-pressed），和辨識確認的「逐行／整篇」同一種做法；不用 tab 角色（沒有方向鍵操作的分頁會誤導讀屏）。 */}
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
          <label htmlFor="essay-text" className="block text-sm text-muted">
            你的作文（段落之間換行）
          </label>
          <textarea
            id="essay-text"
            rows={16}
            value={draft.text}
            onChange={(e) => update({ text: e.currentTarget.value })}
            aria-describedby="essay-count"
            className={textInput}
            {...englishInputProps}
          />
          <p id="essay-count" className="text-sm tabular-nums text-muted" aria-live="polite">
            <span className={length.belowHint || length.overWords ? 'font-semibold text-bad' : ''}>{length.words} 個單詞</span>・
            <span className={length.paragraphDeduction ? 'font-semibold text-bad' : ''}>{length.paragraphs} 段</span>
            {length.chars > 3000 && <span className={length.overChars ? 'font-semibold text-bad' : ''}>・{length.chars.toLocaleString('zh-TW')}／4,000 字元</span>}
          </p>
          {length.belowHint && (
            <Notice tone="warn">
              <p>
                題目要求至少 120 個單詞，目前只有 {length.words} 個{length.veryShort ? '；少於 100 個單詞會扣總分 1 分' : ''}。
              </p>
            </Notice>
          )}
          {length.paragraphDeduction && prompt.paragraphs ? (
            // 和 Worker 計分同一條規則：題目要求 ≥2 段、而只有 1 段才扣「未分段」1 分。
            <Notice tone="warn">
              <p>題目要求文分 {prompt.paragraphs} 段，目前只有 {length.paragraphs} 段（未分段會扣 1 分）。段落之間換行就算分段。</p>
            </Notice>
          ) : (
            length.paragraphMismatch &&
            prompt.paragraphs && (
              <p className="text-sm text-muted">
                題目要求文分 {prompt.paragraphs} 段，目前是 {length.paragraphs} 段。
              </p>
            )
          )}
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

          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} aria-expanded={selfOpen} aria-controls="essay-self" onClick={() => setSelfOpen((v) => !v)}>
              {selfOpen ? '收起自我檢核' : '自我檢核與自評（不用 AI）'}
            </button>
            {access.state === 'ready' && (
              <button type="button" className={primaryButton} disabled={busy !== null || length.empty || length.tooLong} onClick={submitTyped}>
                {busy ?? `送出 AI 批改（${gradePoints} 點）`}
              </button>
            )}
          </div>
          {access.state === 'ready' ? (
            <>
              <AiNotice />
              <QuotaSummary quota={quota} />
            </>
          ) : (
            <AiAccessNotice access={access} compact />
          )}
          {error && <ErrorMessage view={error} />}
          <div className="flex justify-end">
            <ConfirmButton
              label="清除重寫"
              question="確定要清除這篇作文的草稿與自評嗎？"
              confirmLabel="確定清除"
              onConfirm={clearAll}
              disabled={busy !== null}
              doneMessage="已清除這篇作文的草稿與自評。"
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
                onChange={(next) => {
                  setPhotos(next);
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
                  <input
                    type="checkbox"
                    checked={photoRiskAccepted}
                    onChange={(e) => setPhotoRiskAccepted(e.currentTarget.checked)}
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                  />
                  <span>照片可能看不清楚（見上方提醒）。我了解辨識不出來仍會扣 {ocrPoints} 點，仍要送出辨識。</span>
                </label>
              )}
              <button
                type="button"
                className={primaryButton}
                disabled={busy !== null || photos.length === 0 || (photoRisky && !photoRiskAccepted)}
                onClick={submitPhotos}
              >
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
              <p className="text-[0.95rem]">拍照上傳手寫稿需要 AI 批改的權限：AI 先辨識你的字跡，你確認文字後再批改。</p>
              <AiAccessNotice access={access} compact />
            </>
          )}
        </section>
      )}

      {draft.mode === 'typed' && selfOpen && (
        // 打開後捲到面板並把焦點移到標題（手機上面板常常落在底部導覽列後面）。
        <div id="essay-self" ref={selfPanel} tabIndex={-1} className="scroll-mt-20 focus:outline-none">
          <EssaySelfAssess
            scores={draft.selfScores}
            checked={draft.checked}
            onScores={(selfScores) => update({ selfScores })}
            onToggle={(id) => update({ checked: draft.checked.includes(id) ? draft.checked.filter((x) => x !== id) : [...draft.checked, id] })}
          />
        </div>
      )}

      <SourceNote exam={prompt} extra="，圖片改以文字描述" />
    </div>
  );
}
