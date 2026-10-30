/**
 * /assistant/new：拍照或貼上題目（docs/design/learning-assistant.md §1.6）。拍照開關（AI_ASSISTANT_PHOTO）關著時只有「貼上文字」，
 * 畫面和沒有拍照時完全相同；打開時頁首下面多一列「拍照｜貼上文字」（?mode=photo|paste，預設拍照）。
 *
 * 貼上文字（§1.6 第 4–5 步）：
 *   - 題目全文（必填，20–6,000 字元）、圖表或圖片的文字描述（選填）、要問的題號（題目裡有好幾題時）、你的答案、卡在哪裡；
 *     「先給提示就好」：沒填答案時預設勾起來（同一次解析，按「看完整解析」才展開，不另外扣點）。
 *   - 送出前在瀏覽器跑同一套檢查（checkAssistQuestion，前後端共用）；Worker 另外比對 D8 指紋。被拒時畫面加亮命中的位置，
 *     學生刪掉那一段再送。「參考答案」「答案：B」只提醒、不擋。
 *   - 送出：POST /api/assist/cases（source: typed，直接 ready）→ POST …/analyze → 轉到案例頁。
 *
 * 拍照（§1.6 第 2–3 步、§2.5；WP-A3）：
 *   1. 拍照或從相簿選（最多 2 張）→ 每張先框選（PhotoCrop：拖曳或四個滑桿、「使用整張」）→ 前端縮圖（長邊 ≤ 1600 px、JPEG、
 *      ≤ 1.2 MB、去 EXIF）。原始照片不會離開這台裝置。
 *   2. 「上傳並轉錄」：POST /api/assist/cases（source: photo，空案例）→ 逐張 POST …/photos?ord=1|2 → POST …/ocr（2 點）；
 *      網址換成 ?mode=photo&case={id}（重新整理或從題目頁回來都接得上）→ 輪詢到 ocr_ready。
 *   3. 確認（OcrBlocksConfirm）→ PUT …/question → POST …/analyze → 轉到案例頁。
 *   轉錄退還時案例回到 draft：看不出是英文題目（照片已刪）要重拍；系統原因（照片還在）可以「用剛才的照片再轉錄一次」。
 *   沒確認的轉錄文字在照片 24 小時到期時清掉：畫面說明並請學生重拍。
 * 學生提供的題目是不可信的資料：畫面一律用純文字節點顯示，不解析任何標記。
 *
 * 多科目（docs/design/assistant-subjects.md §1.2–§1.4、§8.1）：國文對這位使用者開放時，頁首多一列科目 chip（「科目：［英文］［國文］」，
 * ?subject=、其次是上次選的科目）；國文的貼上是 ZhPasteForm，拍照多一行點數確認（轉錄＋解析＝總點數），確認畫面換成國文的欄位。
 * ?from={caseId}：預填前一個案例的題目（國文「用同一份題目問另一部分」、科目不符退還後的「改用英文重新建立」）。
 * 只有英文開放時，畫面和沒有多科目時完全相同。
 */
import {
  AI_TASK_POINTS,
  ASSIST_INPUT_PROBLEM_MESSAGES,
  ASSIST_INPUT_WARNING_MESSAGES,
  ASSIST_LIMITS,
  PHOTO_MAX_COUNT,
  assistAnalyzePoints,
  checkAssistQuestion,
  normalizeAssistText,
  type AssistCaseDetail,
  type AssistInputProblem,
  type AssistOcrView,
  type AssistQuestionBlock,
  type AssistStudentQuestion,
  type AssistSubject,
  type UpdateAssistQuestionBody,
  assistPoints,
  assistSubjectMismatchText,
} from '@gsat/shared';
import { ArrowDownUp, Camera, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiRequestError } from '../../lib/api';
import { BackLink, ErrorMessage, Notice } from '../writing/components/ui';
import { useAiAccess } from '../writing/lib/access';
import type { ErrorView } from '../writing/lib/errors';
import { useQuota } from '../writing/lib/hooks';
import { formatBytes, type ResizedPhoto } from '../writing/lib/photo';
import { AssistAccessNotice, AssistGate, AssistHeader } from './components/AssistAccess';
import { AssistStatus } from './components/AssistStatus';
import { DoubtPicker, EMPTY_DOUBT, type DoubtValue } from './components/DoubtPicker';
import { OcrBlocksConfirm } from './components/OcrBlocksConfirm';
import { inputCls, primaryBtn, secondaryBtn } from './components/parts';
import { PhotoCrop } from './components/PhotoCrop';
import { createAssistCase, deleteAssistPhotos, putAssistQuestion, startAssistAnalyze, startAssistOcr, uploadAssistPhoto } from './lib/assistApi';
import { loadAssistDraft, saveAssistDraft } from './lib/drafts';
import { assistRefundMessage } from './lib/errors';
import { useAssistCasePoller, useAssistErrorView } from './lib/pollers';
import { caseSubject } from './subjects';
import { ZH_COPY } from './subjects/chinese/copy';
import { PhotoBudgetLine } from './subjects/chinese/components/PhotoBudgetLine';
import { ZhPasteForm } from './subjects/chinese/ZhPasteForm';
import { SubjectChips } from './subjects/SubjectChips';
import { loadLastSubject, pickSubject, saveLastSubject, useAssistSubjects } from './subjects/useAssistSubjects';
import { useFromCase } from './subjects/useFromCase';

const LABEL_RE = /^[A-Za-z0-9]{1,8}$/;

/** 表單 → 學生提供的題目（一個 question 區塊；有填題號時區塊帶那個題號、也是要問的題）。 */
export function typedQuestion(form: { text: string; figure: string; label: string; answer: string }): AssistStudentQuestion {
  const label = form.label.trim();
  const blocks: AssistQuestionBlock[] = [{ kind: 'question', label: label === '' ? null : label, text: form.text }];
  if (form.figure.trim() !== '') blocks.push({ kind: 'figure', label: null, text: form.figure });
  return { blocks, target_labels: label === '' ? [] : [label], student_answer: form.answer.trim() === '' ? null : form.answer };
}

/** 命中的位置加亮（正規化後的文字；只是位置，不含任何受保護文字）。 */
function Highlighted({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  [...ranges]
    .sort((a, b) => a[0] - b[0])
    .forEach(([s, e], i) => {
      if (s < pos) return;
      if (s > pos) parts.push(text.slice(pos, s));
      parts.push(
        <mark key={i} className="rounded-sm bg-bad/20 text-fg underline decoration-bad decoration-2 underline-offset-4">
          {text.slice(s, e)}
        </mark>,
      );
      pos = e;
    });
  parts.push(text.slice(pos));
  return (
    <p lang="en" className="max-h-64 overflow-y-auto rounded-xl border border-bad/40 bg-surface p-3 whitespace-pre-wrap break-words">
      {parts}
    </p>
  );
}

/** prefill：?from= 的前一個案例的題目文字（科目不符退還後改用英文重新建立）；沒有時用草稿。 */
function PasteForm({ prefill = null }: { prefill?: string | null }) {
  const id = useId();
  const navigate = useNavigate();
  const access = useAiAccess();
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const errorView = useAssistErrorView();
  const [text, setText] = useState(() => prefill ?? loadAssistDraft('typed:text'));
  const [figure, setFigure] = useState('');
  const [label, setLabel] = useState('');
  const [answer, setAnswer] = useState('');
  const [hintFirst, setHintFirst] = useState<boolean | null>(null);
  const [doubt, setDoubt] = useState<DoubtValue>(EMPTY_DOUBT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [serverHit, setServerHit] = useState<{ field: string; ranges: ReadonlyArray<readonly [number, number]> } | null>(null);
  const [touched, setTouched] = useState(false);
  // 建立了案例、但送出解析失敗（額度不足、網路）：重送時沿用同一個案例（題目改過就先 PUT …/question），不重複建立。
  const [created, setCreated] = useState<string | null>(null);

  const question = useMemo(() => typedQuestion({ text, figure, label, answer }), [text, figure, label, answer]);
  const check = useMemo(() => checkAssistQuestion(question), [question]);
  const firstProblem = !check.ok ? check.problems[0] : undefined;
  const warnings = [...new Set(check.warnings.map((w) => w.code))];
  const labelBad = label.trim() !== '' && !LABEL_RE.test(label.trim());
  const effectiveHint = hintFirst ?? answer.trim() === '';
  const points = assistAnalyzePoints('item', 1);
  const remaining = quota ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  const doubtTooLong = [...doubt.text].length > ASSIST_LIMITS.doubtMaxChars;
  const length = [...text].length;

  // 命中位置：瀏覽器的檢查（同一套規則）或 Worker 回的 ranges（D8 指紋只有 Worker 會回）。
  const localRanges =
    firstProblem && firstProblem.field === 'blocks[0].text' && firstProblem.start !== undefined && firstProblem.end !== undefined
      ? [[firstProblem.start, firstProblem.end] as const]
      : null;
  const hitRanges = serverHit?.field === 'blocks[0].text' ? serverHit.ranges : localRanges;
  const normalized = useMemo(() => normalizeAssistText(text).text, [text]);

  const submit = async () => {
    setTouched(true);
    if (!check.ok || labelBad || doubtTooLong) return;
    setBusy(true);
    setError(null);
    setServerHit(null);
    try {
      const t = doubt.text.trim();
      const body = { doubt_kinds: doubt.kinds, doubt: t === '' ? null : t, hint_first: effectiveHint };
      let caseId = created;
      if (caseId) {
        await putAssistQuestion(caseId, { question: check.value, ...body });
      } else {
        const detail = await createAssistCase({ source: { source: 'typed', question: check.value }, ...body });
        caseId = detail.id;
        setCreated(caseId);
      }
      saveAssistDraft('typed:text', '');
      await startAssistAnalyze(caseId);
      navigate(`/assistant/case/${encodeURIComponent(caseId)}`, { state: { started: true } });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'assist_input_invalid' && err.ranges && err.field) setServerHit({ field: err.field, ranges: err.ranges });
      setError(await errorView(err, { quota, submitting: true }));
      setBusy(false);
    }
  };

  const problemText = firstProblem ? ASSIST_INPUT_PROBLEM_MESSAGES[firstProblem.code as AssistInputProblem] : null;
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <label htmlFor={`${id}-text`} className="font-semibold">
          題目全文（必填）
        </label>
        <textarea
          id={`${id}-text`}
          rows={10}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setServerHit(null);
            saveAssistDraft('typed:text', e.currentTarget.value);
          }}
          aria-describedby={`${id}-text-count ${id}-text-problem`}
          aria-invalid={(touched && firstProblem !== undefined) || undefined}
          className={`mt-1 ${inputCls}`}
          placeholder="例：The city council decided to ___ the meeting until next week. (A) postpone (B) …"
          lang="en"
        />
        <p id={`${id}-text-count`} className={`text-xs tabular-nums ${length > ASSIST_LIMITS.questionMaxChars ? 'font-semibold text-bad' : 'text-muted'}`}>
          {length}／{ASSIST_LIMITS.questionMaxChars.toLocaleString('en-US')} 字元
        </p>
        <p id={`${id}-text-problem`} role={touched && problemText ? 'alert' : undefined} className={touched && problemText ? 'text-sm font-medium text-bad' : 'sr-only'}>
          {touched && problemText ? problemText : ''}
        </p>
        {hitRanges && hitRanges.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-sm">命中的位置（刪掉這一段再送出）：</p>
            <Highlighted text={normalized} ranges={hitRanges} />
          </div>
        )}
      </div>
      <div>
        <label htmlFor={`${id}-figure`} className="font-semibold">
          圖表或圖片的文字描述（選填）
        </label>
        <textarea id={`${id}-figure`} rows={3} value={figure} onChange={(e) => setFigure(e.currentTarget.value)} className={`mt-1 ${inputCls}`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-label`} className="font-semibold">
            要問的題號（選填）
          </label>
          <input
            id={`${id}-label`}
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            aria-describedby={`${id}-label-hint`}
            aria-invalid={labelBad || undefined}
            className={`mt-1 min-h-11 ${inputCls}`}
            inputMode="text"
            autoComplete="off"
          />
          <p id={`${id}-label-hint`} className={`text-xs ${labelBad ? 'font-semibold text-bad' : 'text-muted'}`}>
            題目裡有好幾題時填一個題號（英文字母或數字，最多 8 個字元）。
          </p>
        </div>
        <div>
          <label htmlFor={`${id}-answer`} className="font-semibold">
            你的答案（選填）
          </label>
          <input id={`${id}-answer`} value={answer} onChange={(e) => setAnswer(e.currentTarget.value)} className={`mt-1 min-h-11 ${inputCls}`} lang="en" autoComplete="off" />
        </div>
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={effectiveHint} onChange={(e) => setHintFirst(e.currentTarget.checked)} className="size-4 accent-[var(--primary)]" />
        先給提示就好（完整解析先收起來，按「看完整解析」才展開，不另外扣點）
      </label>
      <DoubtPicker value={doubt} onChange={setDoubt} tornOptions={[]} mine={null} showFreeNote={false} kinds={['sentence_unclear', 'unknown_word', 'faster_method', 'guessed']} />
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-2 text-sm">
          {warnings.map((w) => (
            <li key={w}>{ASSIST_INPUT_WARNING_MESSAGES[w]}</li>
          ))}
        </ul>
      )}
      <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
        解析這一題會用 <strong className="tabular-nums">{points}</strong> 點{remaining !== null && <>；今天還剩 {remaining} 點</>}。
        你貼的題目只用來解析這一題，不會給其他同學看。
      </p>
      <AssistAccessNotice access={access} />
      {ready && (
        <button type="submit" disabled={busy || labelBad || doubtTooLong} className={primaryBtn}>
          {busy ? '送出中…' : '送出解析'}
        </button>
      )}
      {error && <ErrorMessage view={error} />}
    </form>
  );
}

// ───────────────────────── 拍照（WP-A3） ─────────────────────────

/** 框選、縮圖好的一張照片（只在這台裝置；上傳的是縮過、去掉 EXIF 的 JPEG）。 */
interface PickedPhoto extends ResizedPhoto {
  key: string;
}

let photoSeq = 0;
/** 網址的 ?case=（案例 id 是 UUID；只收英數與連字號，放進路徑前再編碼）。 */
const CASE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
/** 內容造成的退還：照片已經刪掉，要重拍。 */
const CONTENT_FAILURES = new Set(['invalid_output', 'refusal', 'max_tokens']);

/** 最近一次轉錄（turn 由舊到新）。 */
function latestOcrTurn(detail: AssistCaseDetail) {
  return [...detail.turns].reverse().find((t) => t.kind === 'ocr') ?? null;
}

/** 拍照、框選（還沒上傳）。 */
function PhotoPicker({ photos, onChange, disabled }: { photos: PickedPhoto[]; onChange: (photos: PickedPhoto[]) => void; disabled: boolean }) {
  const id = useId();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<File[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const remaining = PHOTO_MAX_COUNT - photos.length - queue.length;

  const add = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, Math.max(0, remaining));
    setNote(files.length > picked.length ? `最多 ${PHOTO_MAX_COUNT} 張，多選的照片沒有加入。` : null);
    setQueue((q) => [...q, ...picked]);
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  };
  const remove = (key: string) => {
    const target = photos.find((p) => p.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(photos.filter((p) => p.key !== key));
  };
  const current = queue[0];

  return (
    <div className="space-y-3">
      <input ref={cameraRef} id={`${id}-camera`} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={(e) => add(e.currentTarget.files)} />
      <input ref={galleryRef} id={`${id}-gallery`} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={(e) => add(e.currentTarget.files)} />
      {!current && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryBtn} disabled={disabled || remaining <= 0} onClick={() => cameraRef.current?.click()}>
            <Camera aria-hidden="true" className="size-5" />
            拍照
          </button>
          <button type="button" className={secondaryBtn} disabled={disabled || remaining <= 0} onClick={() => galleryRef.current?.click()}>
            <ImagePlus aria-hidden="true" className="size-5" />
            從相簿選擇
          </button>
          {photos.length === 2 && (
            <button type="button" className={secondaryBtn} disabled={disabled} onClick={() => onChange([...photos].reverse())}>
              <ArrowDownUp aria-hidden="true" className="size-5" />
              對調順序
            </button>
          )}
        </div>
      )}
      <p className="text-sm text-muted">最多 {PHOTO_MAX_COUNT} 張（題目跨頁時拍第 2 張），依順序轉錄。光線充足、紙張平放，避免陰影與反光。</p>
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}
      {current && (
        <PhotoCrop
          key={`${photos.length}-${current.name}-${current.size}-${current.lastModified}`}
          file={current}
          index={photos.length + 1}
          onDone={(photo) => {
            photoSeq += 1;
            onChange([...photos, { ...photo, key: `q${photoSeq}` }]);
            setQueue((q) => q.slice(1));
          }}
          onCancel={() => setQueue((q) => q.slice(1))}
        />
      )}
      {photos.length > 0 && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {photos.map((p, i) => (
            <li key={p.key} className="min-w-0 rounded-xl border border-line p-2">
              <img src={p.previewUrl} alt={`第 ${i + 1} 張題目照片（框選後）`} className="max-h-72 w-full rounded-lg bg-surface-2 object-contain" />
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums text-muted">
                  第 {i + 1} 張・{p.width}×{p.height}・{formatBytes(p.blob.size)}
                </span>
                <button type="button" onClick={() => remove(p.key)} disabled={disabled} className="inline-flex min-h-11 items-center gap-1 text-bad disabled:opacity-50">
                  <Trash2 aria-hidden="true" className="size-4" />
                  移除
                </button>
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * 拍照的整個流程：拍照、框選 → 上傳並轉錄 → 確認 → 解析（見檔頭）。caseId 來自網址 ?case=。
 * subject 是表單選的科目；接續既有的案例時以案例的科目為準。
 */
function PhotoFlow({ caseId, subject, open }: { caseId: string | null; subject: AssistSubject; open: readonly AssistSubject[] }) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const access = useAiAccess();
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const errorView = useAssistErrorView();
  const poller = useAssistCasePoller(caseId);
  const snapshot = poller.snapshot;
  const detail = caseId ? snapshot.detail : null;
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [serverField, setServerField] = useState<string | null>(null);
  const flowSubject = detail ? caseSubject(detail) : subject;
  const zh = flowSubject === 'chinese';
  // 上傳了幾張（轉錄退還後「用剛才的照片再轉錄一次」的點數用；國文 1 張 3 點、2 張 4 點）。
  const uploadedRef = useRef<1 | 2>(1);
  // 建立了空案例、但上傳或轉錄失敗（額度、網路）：重送時沿用同一個案例，不重複建立。
  const draftRef = useRef<string | null>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const remaining = quota ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  const ocrPoints = zh ? assistPoints('chinese', 'assist_ocr', { photos: photos.length === 2 ? 2 : photos.length === 0 ? uploadedRef.current : 1 }) : AI_TASK_POINTS.assist_ocr;

  /** 上傳照片並送出轉錄。 */
  const upload = async () => {
    setBusy(true);
    setError(null);
    try {
      let id = detail?.status === 'draft' ? detail.id : draftRef.current;
      if (id) {
        // 換照片：先清掉這一題在伺服器上的舊照片（上一次系統原因失敗時還留著）。
        await deleteAssistPhotos(id);
      } else {
        // 英文的請求和沒有多科目時逐位元相同（不帶 subject）。
        id = (await createAssistCase({ source: zh ? { source: 'photo', subject: 'chinese' } : { source: 'photo' }, hint_first: true })).id;
        draftRef.current = id;
      }
      uploadedRef.current = photos.length === 2 ? 2 : 1;
      for (const [i, p] of photos.entries()) await uploadAssistPhoto(id, i + 1, p.blob);
      await startAssistOcr(id);
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPhotos([]);
      if (id === caseId) poller.restart();
      // 國文的網址帶著科目（重新整理時頁首與 chip 仍是國文）；英文的網址和原本相同。
      else setParams(zh ? { subject: 'chinese', mode: 'photo', case: id } : { mode: 'photo', case: id }, { replace: true });
    } catch (err) {
      setError(await errorView(err, { quota, submitting: true }));
    } finally {
      setBusy(false);
    }
  };

  /** 系統原因退還（照片還在）：直接再轉錄一次。 */
  const retryOcr = async () => {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    try {
      await startAssistOcr(caseId);
      poller.restart();
    } catch (err) {
      const view = await errorView(err, { quota, submitting: true });
      setError(err instanceof ApiRequestError && err.code === 'conflict' ? { message: '照片已經不在了（超過 24 小時或已刪除），請重新拍照。' } : view);
    } finally {
      setBusy(false);
    }
  };

  /** 確認轉錄 → 解析。 */
  const confirm = async (body: UpdateAssistQuestionBody) => {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    setServerField(null);
    let updated: AssistCaseDetail;
    try {
      updated = await putAssistQuestion(caseId, body);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'assist_input_invalid' && err.field) setServerField(err.field);
      setError(await errorView(err, { quota, submitting: true }));
      setBusy(false);
      return;
    }
    try {
      await startAssistAnalyze(caseId);
      navigate(`/assistant/case/${encodeURIComponent(caseId)}`, { state: { started: true } });
    } catch (err) {
      // 題目已經確認（ready）：留在這裡說明原因，並連到題目頁再送。
      setError(await errorView(err, { quota, submitting: true }));
      poller.accept(updated);
      setBusy(false);
    }
  };

  const startOver = () => setParams(zh ? { subject: 'chinese', mode: 'photo' } : { mode: 'photo' }, { replace: true });

  if (caseId && !detail) {
    if (snapshot.error instanceof ApiRequestError && snapshot.error.status === 404) {
      return (
        <Notice tone="warn">
          <p>找不到這一題，可能已經刪除或超過保存期限。</p>
          <button type="button" onClick={startOver} className="mt-2 font-medium text-primary underline underline-offset-2">
            重新拍照
          </button>
        </Notice>
      );
    }
    return (
      <p role="status" className="text-muted">
        {snapshot.error ? '暫時讀不到這一題，正在重試…' : '載入中…'}
      </p>
    );
  }

  if (detail && detail.source !== 'photo') {
    return (
      <Notice>
        <p>
          這一題不是拍照的題目。
          <Link to={`/assistant/case/${encodeURIComponent(detail.id)}`} className="ml-1 font-medium text-primary underline underline-offset-2">
            到題目頁
          </Link>
        </p>
      </Notice>
    );
  }

  if (detail && detail.status === 'ocr_queued') {
    return (
      <section className="space-y-3" aria-label="轉錄中">
        <AssistStatus pending={detail.pending} speed={snapshot.speed} connectionError={snapshot.error !== null} />
        <p className="text-sm text-muted">轉錄完成後，照片會立即刪除。</p>
      </section>
    );
  }

  if (detail && detail.status === 'ocr_ready') {
    const ocr: AssistOcrView | undefined = latestOcrTurn(detail)?.ocr;
    if (!ocr || ocr.blocks.length === 0) {
      return (
        <Notice tone="warn">
          <p>這一題的轉錄結果已經超過 24 小時，文字已經清掉（沒確認的轉錄最多保留 24 小時）。請重新拍照，或改用「貼上文字」。</p>
          <button type="button" onClick={startOver} className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2">
            重新拍照
          </button>
        </Notice>
      );
    }
    return (
      <>
        <OcrBlocksConfirm
          key={latestOcrTurn(detail)?.id}
          ocr={ocr}
          busy={busy}
          ready={ready}
          error={error}
          serverField={serverField}
          remaining={remaining}
          onSubmit={(body) => void confirm(body)}
          subject={flowSubject}
        />
        <AssistAccessNotice access={access} />
      </>
    );
  }

  if (detail && detail.status !== 'draft') {
    return (
      <div className="space-y-3">
        {error && <ErrorMessage view={error} />}
        <Notice>
          <p>
            這一題的轉錄已經確認了。
            <Link to={`/assistant/case/${encodeURIComponent(detail.id)}`} className="ml-1 font-medium text-primary underline underline-offset-2">
              到題目頁看解析
            </Link>
          </p>
        </Notice>
      </div>
    );
  }

  // 還沒上傳（新的一題，或轉錄退還後回到 draft）。
  const lastOcr = detail ? latestOcrTurn(detail) : null;
  const failure = lastOcr?.status === 'failed' ? (lastOcr.failure ?? 'internal') : null;
  const keptPhotos = failure !== null && !CONTENT_FAILURES.has(failure) && failure !== 'expired';
  // 國文轉錄判定是別科（other_subject）：照英文的規則退點、刪照片，請學生換科目再拍（第一版不做跨科重轉；§6.5）。
  const otherSubject = zh && failure !== null && lastOcr?.detected_subject !== undefined && lastOcr.detected_subject !== 'chinese' ? lastOcr.detected_subject : null;
  return (
    <section className="space-y-4" aria-label="拍照">
      {failure !== null && (
        <div role="alert" className="space-y-2 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
          <p className="text-bad">
            {otherSubject !== null
              ? `${assistSubjectMismatchText(otherSubject, 'ocr', open)}點數已經退還，照片也已經刪除。`
              : CONTENT_FAILURES.has(failure)
                ? zh
                  ? 'AI 看不出照片裡的國文題目，或照片看不清楚；點數已經退還。請重新拍照（光線充足、只框題目），或改用「貼上文字」。'
                  : 'AI 看不出照片裡的英文題目，或照片看不清楚；點數已經退還。請重新拍照（光線充足、只框題目），或改用「貼上文字」。'
                : `轉錄沒有完成（${assistRefundMessage(failure)}），點數已經退還。`}
          </p>
          {keptPhotos && ready && (
            <button type="button" onClick={() => void retryOcr()} disabled={busy} className={secondaryBtn}>
              用剛才的照片再轉錄一次（{ocrPoints} 點）
            </button>
          )}
        </div>
      )}
      <PhotoPicker photos={photos} onChange={setPhotos} disabled={busy} />
      {zh ? (
        <PhotoBudgetLine photos={photos.length === 2 ? 2 : 1} remaining={remaining} />
      ) : (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm">
          轉錄會用 <strong className="tabular-nums">{ocrPoints}</strong> 點{remaining !== null && <>；今天還剩 {remaining} 點</>}；確認轉錄的文字之後，解析一題 {assistAnalyzePoints('item', 1)} 點起。
          照片在轉錄完成後立即刪除；沒確認的轉錄文字最多保留 24 小時。
        </p>
      )}
      <AssistAccessNotice access={access} />
      {ready && (
        <button type="button" disabled={busy || photos.length === 0} onClick={() => void upload()} className={primaryBtn}>
          {busy ? '上傳中…' : `上傳並轉錄（${ocrPoints} 點）`}
        </button>
      )}
      {error && <ErrorMessage view={error} />}
    </section>
  );
}

// ───────────────────────── 頁面 ─────────────────────────

/** subject：兩科以上開放時連結帶著目前的科目（只有英文時網址和原本相同）。 */
function ModeSwitch({ mode, subject }: { mode: 'photo' | 'paste'; subject: AssistSubject | null }) {
  const tabs = [
    { key: 'photo' as const, label: '拍照' },
    { key: 'paste' as const, label: '貼上文字' },
  ];
  return (
    <nav aria-label="題目來源">
      <ul className="inline-flex max-w-full flex-wrap rounded-full border border-line p-1">
        {tabs.map((t) => (
          <li key={t.key}>
            <Link
              to={subject ? `/assistant/new?subject=${subject}&mode=${t.key}` : `/assistant/new?mode=${t.key}`}
              replace
              aria-current={t.key === mode ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${t.key === mode ? 'bg-primary text-on-primary' : 'text-fg lg:hover:bg-surface-2'}`}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Body() {
  const subjects = useAssistSubjects();
  const [params, setParams] = useSearchParams();
  const subject = pickSubject(params.get('subject'), loadLastSubject(), subjects.open);
  const multi = subjects.open.length >= 2;
  const zh = subject === 'chinese';
  const photoEnabled = subjects.photo(subject);
  const rawCase = params.get('case');
  const caseId = rawCase !== null && CASE_ID_RE.test(rawCase) ? rawCase : null;
  const from = useFromCase(params.get('from'));
  const fromId = params.get('from');
  const mode: 'photo' | 'paste' = photoEnabled && (params.get('mode') !== 'paste' || caseId !== null) && fromId === null ? 'photo' : 'paste';
  const switchSubject = (next: AssistSubject) => {
    saveLastSubject(next);
    // 換科目：照片的案例與預填都是原本那一科的，不帶過去。
    setParams({ subject: next, mode }, { replace: true });
  };
  const fromDetail = from.state === 'ready' ? from.detail : null;
  const pasteForm =
    from.state === 'loading' ? (
      <p role="status" className="text-muted">
        載入題目中…
      </p>
    ) : zh ? (
      <ZhPasteForm key={fromDetail?.id ?? 'new'} related={fromDetail && caseSubject(fromDetail) === 'chinese' ? fromDetail : null} open={subjects.open} onSwitchSubject={switchSubject} />
    ) : (
      <PasteForm key={fromDetail?.id ?? 'new'} prefill={fromDetail?.question?.blocks?.map((b) => b.text).join('\n\n') ?? null} />
    );
  return (
    <article className="space-y-5">
      <BackLink to="/assistant">學習助手</BackLink>
      {mode === 'photo' ? (
        zh ? (
          <AssistHeader title={ZH_COPY.photoTitle} docTitle={`${ZH_COPY.photoTitle}｜學習助手`}>
            <p className="text-muted">{ZH_COPY.photoIntro}AI 先轉錄，你確認轉錄的文字之後再解析。</p>
            <p className="text-sm text-muted">{ZH_COPY.photoNote}</p>
          </AssistHeader>
        ) : (
          <AssistHeader title="拍照問題目" docTitle="拍照問題目｜學習助手">
            <p className="text-muted">拍下講義、段考的英文題目：AI 先轉錄（{AI_TASK_POINTS.assist_ocr} 點），你確認轉錄的文字之後再解析。</p>
            <p className="text-sm text-muted">只框要問的題目與它的文章，不要拍到解答、詳解、評分說明、範文，也不要拍到姓名、學號或學校。</p>
          </AssistHeader>
        )
      ) : zh ? (
        <AssistHeader title={ZH_COPY.pasteTitle} docTitle={`${ZH_COPY.pasteTitle}｜學習助手`}>
          <p className="text-muted">{ZH_COPY.pasteIntro}</p>
        </AssistHeader>
      ) : (
        <AssistHeader title="貼上題目" docTitle="貼上題目｜學習助手">
          <p className="text-muted">把講義、段考的英文題目貼上來（不用轉錄點數）。只貼要問的題目與它的文章，不要貼整份講義、詳解、評分說明或範文。</p>
          <p className="text-sm text-muted">iPhone 可以在照片上長按文字複製（原況文字），Android 用 Google 智慧鏡頭。</p>
        </AssistHeader>
      )}
      <SubjectChips open={subjects.open} value={subject} onChange={switchSubject} />
      {photoEnabled && <ModeSwitch mode={mode} subject={multi ? subject : null} />}
      {mode === 'photo' ? <PhotoFlow key={caseId ?? `new-${subject}`} caseId={caseId} subject={subject} open={subjects.open} /> : pasteForm}
    </article>
  );
}

export default function NewQuestionPage() {
  return (
    <AssistGate>
      <Body />
    </AssistGate>
  );
}
