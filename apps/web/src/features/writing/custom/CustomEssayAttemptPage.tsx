/**
 * /writing/essay/custom：英文作文自訂題目（docs/design/custom-essay.md §6）。
 *
 *   1. 題目：學生貼上或輸入題目（老師、補習班、其他考卷），可以加圖片的文字描述、段數與字數要求。即時檢查用 @gsat/shared 的
 *      checkCustomPrompt（和 Worker 同一支規則）；題目通過後按「題目設定好了」收成一行預覽（手機上寫作時仍看得到題目）。
 *   2. 作答：打字或拍照上傳手寫稿，字數與段數提醒依學生設定的要求（lengthHints.ts），自評與檢核清單同歷屆題。
 *   3. AI 批改（AI 已核准、features.customEssay）：POST /api/submissions（custom_prompt、不帶 group_id；或 PUT 沿用草稿）
 *      →（自評）→ POST /api/ai/essay-grade → 結果頁。送出前：題目沒有拒收級的問題、題目提到的段數與字數已處理、
 *      作文符合 essayGradableProblem（至少 30 個英文單詞、用英文寫、不是照抄題目）。
 *   4. ?from={submission_id}：從某一份自訂題提交帶回題目；草稿或失敗的打字作答連作文一起帶回（沿用那一份）；
 *      &reuse=essay 連作文一起帶回、另建一份（「修改題目後重新批改這篇」）。那一份的題目被隱藏（D8 重查命中）時
 *      只不帶題目，作文照常帶回，請學生重新輸入題目；目前的草稿已經有別的作文或還沒送出的題目時先問。
 *      讀不到時依原因說明：404 才說可能已刪除；登入過期、要重新同意給連結；連線或伺服器錯誤給「再試一次」（參數先留著）。
 *   5. AI 開著、自訂題目的 AI 批改沒開（features.customEssay 不是 true；評分對照達標之前的上線狀態）：不管登入與核准狀態，
 *      一律說「即將開放」、只能自我檢核，不叫學生登入或申請（申請、核准之後才發現不能送，等於白跑一趟）；開頭的說明也不提送 AI。
 * 草稿（題目、作文、自評）存在這台裝置（custom/drafts.ts）；照片不存。歷屆與本站作答頁一行都沒改。
 * 畫面與 <title> 都不含「大考中心」，<title> 也不含題目文字（安全審查 S14、產品審查 P17）。
 */
import {
  CUSTOM_ESSAY_MIN_WORDS_FOR_AI,
  CUSTOM_PROMPT_PROBLEM_MESSAGES,
  CUSTOM_PROMPT_UNAVAILABLE_TEXT,
  PHOTO_MAX_COUNT,
  checkCustomPrompt,
  essayGradableProblem,
  isCustomEssayGroupId,
  type CustomEssayPrompt,
  type CustomPromptCheck,
  type EssayBody,
  type SelfAssessment,
  type SubmissionDetail,
} from '@gsat/shared';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ApiRequestError, loginHref, useFeatures, useMe } from '../../../lib/api';
import { APP_NAME } from '../../../modules';
import { AiAccessNotice, QuotaSummary, taskPoints } from '../components/AiAccessPanel';
import { EssaySelfAssess } from '../components/EssaySelfAssess';
import { PhotoPicker, type PickedPhoto } from '../components/PhotoPicker';
import { SourceTabs } from '../components/SourceTabs';
import { SubmitConfirm, customSubmitWarnings, useSubmitGuard } from '../components/SubmitGuard';
import { AiNotice, BackLink, ConfirmButton, ErrorMessage, Notice, card, englishInputProps, primaryButton, secondaryButton, textInput } from '../components/ui';
import { useAiAccess } from '../lib/access';
import { completeEssayScores, saveDraft } from '../lib/drafts';
import { describeError, isQuotaError, type ErrorView } from '../lib/errors';
import { useAutosave, useQuota, useRevealOnOpen } from '../lib/hooks';
import { listOriginBack } from '../lib/listOrigin';
import { photoQualityIssue } from '../lib/photo';
import { COMPOSITION_CRITERIA } from '../lib/rubric';
import { AlreadySubmittedError, saveSelfAssessment, startTask, upsertSubmission } from '../lib/submit';
import { checkEssayLength } from '../lib/text';
import { useErrorView } from '../lib/useErrorView';
import { deletePhotos, getSubmission, uploadPhoto } from '../lib/writingApi';
import { CustomPromptForm, PROMPT_FIELD_INPUT } from './CustomPromptForm';
import { CustomPromptView, type CustomPromptViewValue } from './CustomPromptView';
import { CustomSourceNote } from './CustomSourceNote';
import {
  CUSTOM_DRAFT_KEY,
  OLD_DRAFT_DAYS,
  customTaskText,
  draftAgeDays,
  emptyCustomEssayDraft,
  emptyCustomPromptDraft,
  loadCustomEssayDraft,
  parseWordsInput,
  promptDraftEmpty,
  promptDraftFrom,
  samePrompt,
  toCustomPromptInput,
  type CustomEssayDraft,
  type CustomPromptDraft,
} from './drafts';
import { customErrorView, gradableMessage, isCustomTaskConflict, withSnapshot, type PromptFieldError } from './errors';
import { customLengthHints } from './lengthHints';
import { hasPending, pendingRequirements, type PendingRequirements, type WordsSuggestion } from './requirements';

export const CUSTOM_INTRO = '把作文題目貼在下面（老師、補習班或其他考卷的題目都可以），寫完可以自我檢核，或送 AI 依本站的學測作文評分規準批改。';
/** 自訂題目的 AI 批改沒開（features.customEssay 不是 true）時的開頭說明：不提送 AI。 */
export const CUSTOM_INTRO_SELF_ONLY = '把作文題目貼在下面（老師、補習班或其他考卷的題目都可以），寫完可以用檢核清單自我檢核。';
export const CUSTOM_NOT_OPEN = '自訂題目的 AI 批改即將開放，現在可以先用檢核清單自我檢核。';
/** 拍照模式下 customEssay 沒開：檢核清單只在打字作答，要說切過去（審查 ux-14）。 */
export const CUSTOM_NOT_OPEN_PHOTO = '自訂題目的 AI 批改即將開放。現在可以切到「打字作答」，用檢核清單自我檢核。';
/** 拍照上傳前的提醒（辨識的點數不會因為作文規則不符而退還；P13）。 */
export function customPhotoRule(ocrPoints: number): string {
  return `自訂題目的作文至少要 ${CUSTOM_ESSAY_MIN_WORDS_FOR_AI} 個英文單詞、用英文寫，才能送 AI 批改；辨識的 ${ocrPoints} 點不會因為這個原因退還。`;
}

const FROM_SIGNED_OUT = '要先登入，才能帶回之前作答的題目。';
const FROM_UNREADABLE = '讀不到那一份作答的題目（可能已經刪除），請直接輸入題目。';
const FROM_HIDDEN = '那一份作答的題目含有和官方評分說明相同的文字，已隱藏，不能帶回；請重新輸入題目。';
const FROM_HIDDEN_ESSAY = '那一份作答的題目含有和官方評分說明相同的文字，已隱藏，不能帶回；作文已帶回，請在上方重新輸入題目。';
const FROM_UNAVAILABLE = '那一份作答的題目暫時無法顯示，請稍後重新整理再試。';
const FROM_RETRY = '暫時讀不到那一份作答（連線或伺服器問題），請再試一次。';
/** 送出前確認的標題（出現時焦點移過去，讀屏會念出來；審查 ux-3）。 */
const REQ_CONFIRM_HEADING = 'custom-req-confirm-h';

const ESSAY_INPUT = 'custom-essay-text';

export default function CustomEssayAttemptPage() {
  // 從英文作文題型頁（/composition）的「自訂題目」區塊點進來的，返回那一頁；否則回到英文作文題目列表。
  const back = listOriginBack(useLocation().state, { to: '/writing/essay', label: '英文作文題目' });
  return (
    <article>
      <BackLink to={back.to}>{back.label}</BackLink>
      <CustomEssayAttempt />
    </article>
  );
}

/** 題目不能送出時的第一個原因（按鈕下方的說明）。 */
function firstProblem(check: CustomPromptCheck): string | null {
  return check.ok ? null : CUSTOM_PROMPT_PROBLEM_MESSAGES[check.problems[0]?.code ?? 'text_missing'];
}

/** ?from= 帶回來的內容。essay 是 null＝只帶回題目；hidden＝那一份的題目被隱藏，prompt 是空白（請學生重新輸入）。 */
interface FromPlan {
  prompt: CustomPromptDraft;
  essay: string | null;
  submissionId: string | null;
  reuse: boolean;
  hidden: boolean;
}

type FromState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'note'; message: string }
  | { status: 'error'; view: ErrorView; retry: boolean }
  | { status: 'ask'; plan: FromPlan; hasEssay: boolean };

type FromChoice = 'replace' | 'prompt_clear' | 'prompt_keep';

/** 送出前的確認：題目提到段數或字數、欄位卻是「不指定」（§6.3）。 */
function RequirementsConfirm({
  pending,
  onSetParagraphs,
  onNoParagraphs,
  onSetWords,
  onNoWords,
}: {
  pending: PendingRequirements;
  onSetParagraphs: (n: number) => void;
  onNoParagraphs: (n: number) => void;
  onSetWords: (w: WordsSuggestion) => void;
  onNoWords: (w: WordsSuggestion) => void;
}) {
  const p = pending.paragraphs;
  const w = pending.words;
  return (
    <div role="group" aria-labelledby={REQ_CONFIRM_HEADING} className="space-y-3 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-3 text-sm">
      <p id={REQ_CONFIRM_HEADING} tabIndex={-1} className="font-semibold focus:outline-none">
        送出前確認題目的要求
      </p>
      <p>處理完下面每一項，就會接著送出。</p>
      {p !== undefined && (
        <div className="space-y-1">
          <p>題目文字提到要分 {p} 段，你的段數要求是「不指定」。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => onSetParagraphs(p)}>
              設成 {p} 段
            </button>
            <button type="button" className={secondaryButton} onClick={() => onNoParagraphs(p)}>
              題目沒有規定段數
            </button>
          </div>
        </div>
      )}
      {w && (
        <div className="space-y-1">
          <p>題目文字提到{w.label}，你的字數要求是「不指定」。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => onSetWords(w)}>
              設成{w.label}
            </button>
            <button type="button" className={secondaryButton} onClick={() => onNoWords(w)}>
              題目沒有規定字數
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RubricSummary() {
  return (
    <details className={card}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">評分規準摘要（本站撰寫）</summary>
      <div className="mt-2 space-y-3 text-[0.95rem]">
        <p>AI 依同樣的四個面向評分，每項 0–5 分，用的是更細的分數描述。</p>
        {COMPOSITION_CRITERIA.map((c) => (
          <section key={c.key} aria-labelledby={`custom-rubric-${c.key}`}>
            <h3 id={`custom-rubric-${c.key}`} className="font-semibold">
              {c.title}
            </h3>
            <dl className="mt-1 space-y-1">
              {c.levels.map((l) => (
                <div key={l.range} className="flex gap-2">
                  <dt className="w-14 shrink-0 tabular-nums text-muted">{l.range} 分</dt>
                  <dd className="min-w-0">{l.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-sm text-muted">程式另外扣分：少於 100 個單詞扣總分 1 分；題目要求 2 段以上卻只寫 1 段扣 1 分（兩者同時發生只扣 1 分）。</p>
      </div>
    </details>
  );
}

function CustomEssayAttempt() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const features = useFeatures();
  const { me, loading: sessionLoading } = useMe();
  const access = useAiAccess();
  const errorView = useErrorView();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');

  const [draft, setDraft] = useState<CustomEssayDraft>(() => loadCustomEssayDraft() ?? emptyCustomEssayDraft());
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { ok: saved, discard } = useAutosave(CUSTOM_DRAFT_KEY, draft);
  /** 載入時草稿是幾天前存的（舊草稿提醒；之後打字不會讓提醒消失，按「清除題目與作文」才會）。 */
  const [oldDraftDays, setOldDraftDays] = useState(() => {
    const d = draftRef.current;
    return promptDraftEmpty(d.prompt) && d.text.trim() === '' ? 0 : draftAgeDays(d.updatedAt, Date.now());
  });

  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [photoSubmissionId, setPhotoSubmissionId] = useState<string | null>(null);
  const [photoRiskAccepted, setPhotoRiskAccepted] = useState(false);
  const [selfOpen, setSelfOpen] = useState(false);
  const selfPanel = useRevealOnOpen(selfOpen);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);
  /** 伺服器回的題目錯誤（D8 等，帶位置）；記下當時那一欄的內容，那一欄改過才不顯示（CustomPromptForm）。 */
  const [promptError, setPromptError] = useState<PromptFieldError | null>(null);
  /** 伺服器回的作文規則錯誤；改了作文就清掉。 */
  const [essayError, setEssayError] = useState<string | null>(null);
  const [showFullPrompt, setShowFullPrompt] = useState(false);
  /** 送出前確認題目的要求：是哪一個送出按鈕叫出來的（處理完就接著送那一個）。 */
  const [confirmingReq, setConfirmingReq] = useState<'typed' | 'photo' | null>(null);
  /** 送出前確認收起來時的說明（role=status）。 */
  const [reqStatus, setReqStatus] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<{ id: string; n: number } | null>(null);
  /** 學生按過「修改題目」（或從結果頁帶回來修改）：之後不再自動收合。 */
  const userEditedPrompt = useRef(false);
  const autoCollapsed = useRef(false);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  // 離開頁面時釋放預覽圖的記憶體。
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  // 要求移動焦點（題目欄、作文欄、題目標題）：等這一次畫面更新完再做（收合的表單要先展開）。
  useEffect(() => {
    if (!focusTarget) return;
    const el = document.getElementById(focusTarget.id);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [focusTarget]);
  const focusOn = (id: string) => setFocusTarget((f) => ({ id, n: (f?.n ?? 0) + 1 }));

  const update = (patch: Partial<CustomEssayDraft>) => setDraft((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  /** 立刻寫進這台裝置（送出、清除、帶回題目之後馬上換頁或重新整理，狀態也不會掉）。 */
  const persistNow = (patch: Partial<CustomEssayDraft>) => {
    const next = { ...draftRef.current, ...patch, updatedAt: Date.now() };
    draftRef.current = next;
    discard();
    saveDraft(CUSTOM_DRAFT_KEY, next);
    setDraft(next);
  };
  const setPrompt = (prompt: CustomPromptDraft) => update({ prompt });

  // 題目檢查（和 Worker 同一支）。很便宜（線性時間；原文超過上限時直接拒收、不做比對），每次輸入都即時算，按鈕狀態不會落後畫面。
  const promptInput = useMemo(() => toCustomPromptInput(draft.prompt), [draft.prompt]);
  const check = useMemo(() => checkCustomPrompt(promptInput), [promptInput]);
  const pending = pendingRequirements(draft.prompt, draft.requirementsConfirmed);
  const pendingAny = hasPending(pending);
  const collapsed = draft.promptCollapsed && check.ok;

  const length = checkEssayLength(draft.text, draft.prompt.paragraphs);
  const validWords = (n: number | null) => (n !== null && Number.isInteger(n) ? n : null);
  const minWords = validWords(parseWordsInput(draft.prompt.minWords));
  const hints = customLengthHints(length, {
    paragraphs: draft.prompt.paragraphs,
    minWords,
    maxWords: validWords(parseWordsInput(draft.prompt.maxWords)),
  });
  const essayProblem = length.empty ? null : essayGradableProblem(draft.text, customTaskText(draft.prompt.text, draft.prompt.figure));
  const customOpen = features.customEssay === true;
  /** AI 開著、只有自訂題目沒開：和登入、核准狀態無關，一律說「即將開放」（不叫學生先登入、申請）。 */
  const customOff = features.auth && features.ai && !customOpen;

  // 作文開始有字、題目已經通過：自動收合一次（學生按過「修改題目」後不再自動收合；§6.2）。
  // 題目有講義表頭的提醒（姓名、班級、學校…）時不收：收起來就看不到提醒和「刪掉這幾行」（審查 ux-6）。
  // 收合後上方少了一大塊，把作文欄捲回畫面裡（不支援 scroll anchoring 的瀏覽器會跳走）。
  const textEmpty = draft.text.trim() === '';
  const prevTextEmpty = useRef(textEmpty);
  const hasHeaderWarning = check.warnings.some((w) => w.code === 'personal_header');
  useEffect(() => {
    const wasEmpty = prevTextEmpty.current;
    prevTextEmpty.current = textEmpty;
    if (wasEmpty && !textEmpty && check.ok && !hasHeaderWarning && !draftRef.current.promptCollapsed && !userEditedPrompt.current && !autoCollapsed.current) {
      autoCollapsed.current = true;
      update({ promptCollapsed: true });
      requestAnimationFrame(() => {
        const box = document.getElementById(ESSAY_INPUT);
        if (box && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
      });
    }
    // 只看作文從空白變成有字的那一刻。
  }, [textEmpty]);

  // 段數、字數的建議在別處（題目表單）處理完了：收起送出前的確認，說明要再按一次送出（不搶焦點）。
  useEffect(() => {
    if (!pendingAny && confirmingReq !== null) {
      setConfirmingReq(null);
      setReqStatus('題目的要求已經設定好了，請再按一次送出。');
    }
  }, [pendingAny]);

  // ───────────── ?from={id}（&reuse=essay）：帶回之前作答的題目（§6.6） ─────────────
  const fromId = params.get('from');
  const reuse = params.get('reuse') === 'essay';
  const [fromState, setFromState] = useState<FromState>(() => (fromId ? { status: 'loading' } : { status: 'idle' }));
  const handledFrom = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const applyFrom = (plan: FromPlan, choice: FromChoice) => {
    const promptOk = checkCustomPrompt(toCustomPromptInput(plan.prompt)).ok;
    const base = { prompt: plan.prompt, requirementsConfirmed: null, promptCollapsed: plan.reuse ? false : promptOk };
    if (choice === 'replace' && plan.essay !== null) {
      persistNow({ ...base, text: plan.essay, mode: 'typed', submissionId: plan.submissionId, selfScores: null, checked: [] });
    } else if (choice === 'prompt_clear' || (choice === 'replace' && plan.essay === null)) {
      persistNow({ ...base, text: '', submissionId: null, selfScores: null, checked: [] });
    } else {
      persistNow(base);
    }
    setPromptError(null);
    setEssayError(null);
    setShowFullPrompt(false);
    if (plan.reuse) {
      userEditedPrompt.current = true;
      focusOn(PROMPT_FIELD_INPUT.text);
    }
    const withEssay = choice === 'replace' && plan.essay !== null;
    setFromState({ status: 'note', message: plan.hidden ? FROM_HIDDEN_ESSAY : withEssay ? '已帶回之前的題目與作文。' : '已帶回之前的題目。' });
  };

  /** 處理完 ?from= 之後要不要把網址參數拿掉（題目暫時無法顯示時留著，重新整理就會再試一次）。 */
  const decideFrom = (detail: SubmissionDetail, reuseEssay: boolean): 'clear' | 'keep' => {
    const loaded: CustomEssayPrompt | null | undefined = detail.custom_prompt;
    if (detail.kind !== 'essay' || !isCustomEssayGroupId(detail.group_id) || !loaded) {
      setFromState({ status: 'note', message: FROM_UNREADABLE });
      return 'clear';
    }
    // 指紋檔暫時壞掉（Worker 回 CUSTOM_PROMPT_UNAVAILABLE_TEXT）：不是題目違規，稍後再試（審查 ux-15）。
    if (loaded.hidden && loaded.text === CUSTOM_PROMPT_UNAVAILABLE_TEXT) {
      setFromState({ status: 'note', message: FROM_UNAVAILABLE });
      return 'keep';
    }
    const essayText = detail.body && 'text' in detail.body && typeof detail.body.text === 'string' ? detail.body.text : '';
    // 草稿或失敗的打字作答：連作文一起帶回、沿用那一份（重送是 PUT，不在後端留一堆草稿）。
    const resumable = !reuseEssay && detail.input_mode === 'typed' && (detail.status === 'draft' || detail.status === 'failed');
    const bringEssay = reuseEssay || resumable;
    // 題目被隱藏（D8 重查命中）：題目不帶回，作文照常帶回、題目欄空白讓學生重新輸入（審查 correctness-2）。
    if (loaded.hidden && !bringEssay) {
      setFromState({ status: 'note', message: FROM_HIDDEN });
      return 'clear';
    }
    const plan: FromPlan = {
      prompt: loaded.hidden ? emptyCustomPromptDraft() : promptDraftFrom(loaded),
      essay: bringEssay ? essayText : null,
      submissionId: resumable ? detail.id : null,
      reuse: reuseEssay || loaded.hidden === true,
      hidden: loaded.hidden === true,
    };
    const current = draftRef.current;
    const same = !plan.hidden && samePrompt(current.prompt, loaded);
    const hasEssay = current.text.trim() !== '';
    // 換掉目前的題目會不會丟掉東西：題目是空的、或就是要載入的這一題才不會（審查 ux-11）。
    const promptSafe = promptDraftEmpty(current.prompt) || same;
    if (plan.essay === null) {
      // 只帶回題目：同一題就不用動；目前沒有作文、也沒有別的題目才直接換；否則先問。
      if (same) {
        setFromState({ status: 'note', message: '這個題目已經在下面了。' });
        return 'clear';
      }
      if (!hasEssay && promptSafe) applyFrom(plan, 'replace');
      else setFromState({ status: 'ask', plan, hasEssay });
      return 'clear';
    }
    // 連作文一起帶回：不會丟掉別的作文或別的題目時直接載入；否則先問。
    const essaySafe = !hasEssay || current.text.trim() === plan.essay.trim();
    if (essaySafe && promptSafe) applyFrom(plan, 'replace');
    else setFromState({ status: 'ask', plan, hasEssay: hasEssay && !essaySafe });
    return 'clear';
  };

  /** 讀那一份作答失敗：只有 404 才說可能已刪除；登入過期、要重新同意給連結；其他（連線、5xx）給「再試一次」。 */
  const fromFailed = (err: unknown): 'clear' | 'keep' => {
    if (err instanceof ApiRequestError && !err.nonJson && err.status === 404) {
      setFromState({ status: 'note', message: FROM_UNREADABLE });
      return 'clear';
    }
    const here = `${location.pathname}${location.search}`;
    if (err instanceof ApiRequestError && !err.nonJson && err.status >= 400 && err.status < 500) {
      // 登入過期、要重新同意、停權…：沿用共用文案，登入與同意之後回到這個網址（?from 留著）。
      setFromState({ status: 'error', view: describeError(err, { loginHref: loginHref(here), me, returnTo: here }), retry: false });
      return 'keep';
    }
    setFromState({ status: 'error', view: { message: FROM_RETRY }, retry: true });
    return 'keep';
  };

  const [fromAttempt, setFromAttempt] = useState(0);
  useEffect(() => {
    if (!fromId || sessionLoading) return;
    const key = `${fromId}|${reuse ? 'essay' : ''}|${fromAttempt}`;
    if (handledFrom.current === key) return;
    handledFrom.current = key;
    // 處理完就把參數拿掉：重新整理不會再帶一次（返回連結要用的 state 照樣帶著）。暫時讀不到時留著，可以再試。
    const clearParams = () => navigate({ pathname: location.pathname, search: '' }, { replace: true, state: location.state });
    if (!features.auth || !me.user) {
      setFromState({ status: 'note', message: FROM_SIGNED_OUT });
      clearParams();
      return;
    }
    setFromState({ status: 'loading' });
    getSubmission(fromId).then(
      (detail) => {
        if (!mounted.current) return;
        if (decideFrom(detail, reuse) === 'clear') clearParams();
      },
      (err: unknown) => {
        if (!mounted.current) return;
        if (fromFailed(err) === 'clear') clearParams();
      },
    );
    // 只依網址參數、登入狀態與「再試一次」決定（其他值在處理當下從 ref 讀）。
  }, [fromId, reuse, sessionLoading, features.auth, me.user, fromAttempt]);

  // ───────────── 送出 ─────────────
  const completeSelf = completeEssayScores(draft.selfScores);
  const selfAssess: SelfAssessment | null = completeSelf ? { kind: 'essay', scores: completeSelf } : null;

  const fail = async (err: unknown) => {
    if (err instanceof AlreadySubmittedError) {
      // 上一次其實已經送出（回應遺失）：直接看那一份的進度，不再送一次、不再扣點。
      persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: err.submission.id });
      setPhotoSubmissionId(null);
      navigate(`/writing/submissions/${encodeURIComponent(err.submission.id)}`);
      return;
    }
    const custom = customErrorView(err, { place: 'attempt' });
    if (custom?.kind === 'prompt') {
      // 題目被伺服器擋下（例如 D8 指紋）：展開題目表單，在那一欄下方說明並標出位置，焦點移過去。
      // 記下送出時那一欄的內容：改了那一欄說明才消失，改別的欄位不會（審查 ux-8）。
      setPromptError(withSnapshot(custom.prompt, draftRef.current.prompt));
      userEditedPrompt.current = true;
      persistNow({ promptCollapsed: false });
      setError({ message: '題目要修改後才能送出，說明在上方題目欄下面。' });
      focusOn(PROMPT_FIELD_INPUT[custom.prompt.field]);
    } else if (custom?.kind === 'essay') {
      setEssayError(custom.view.message);
      setError(null);
      focusOn(ESSAY_INPUT);
    } else if (custom) {
      setError(custom.view);
    } else {
      const q = isQuotaError(err) ? await refreshQuota() : quota;
      setError(await errorView(err, { quota: q, submitting: true }));
    }
    setBusy(null);
  };

  /** 題目文字提到的段數、字數還有沒處理的（從 ref 算：確認區塊按完之後同一個事件裡就接著送出）。 */
  const pendingNow = () => hasPending(pendingRequirements(draftRef.current.prompt, draftRef.current.requirementsConfirmed));
  /** 先跳出送出前確認，焦點移到它的標題（按下的送出按鈕會被換掉，焦點不能掉到頁首；審查 ux-3）。 */
  const askRequirements = (which: 'typed' | 'photo') => {
    setConfirmingReq(which);
    setReqStatus(null);
    focusOn(REQ_CONFIRM_HEADING);
  };

  const submitTyped = async () => {
    if (pendingNow()) {
      askRequirements('typed');
      return;
    }
    setConfirmingReq(null);
    setReqStatus(null);
    setBusy('送出中…');
    setError(null);
    setEssayError(null);
    try {
      const custom_prompt = toCustomPromptInput(draftRef.current.prompt);
      const body: EssayBody = { text: draftRef.current.text.trim() };
      const submission = await upsertSubmission(draftRef.current.submissionId, { kind: 'essay', custom_prompt, input_mode: 'typed', body }, { body, custom_prompt });
      persistNow({ submissionId: submission.id });
      await saveSelfAssessment(submission.id, selfAssess).catch(() => undefined);
      // 題目剛被別的分頁改過（rev 不符）或題目讀不到的 409 是「沒有送出」：丟給 fail 說明，草稿照樣沿用這一份。
      await startTask('essay-grade', submission.id, { isFailure: isCustomTaskConflict });
      persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: submission.id });
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      await fail(err);
    }
  };

  const submitPhotos = async () => {
    if (photos.length === 0) return;
    if (pendingNow()) {
      askRequirements('photo');
      return;
    }
    setConfirmingReq(null);
    setReqStatus(null);
    setBusy('建立作答…');
    setError(null);
    try {
      const custom_prompt = toCustomPromptInput(draftRef.current.prompt);
      const body: EssayBody = { text: '' };
      // 照片模式不沿用打字的草稿 id（input_mode 不同）；上傳中途失敗重送時沿用這次建立的那一份。
      const submission = await upsertSubmission(photoSubmissionId, { kind: 'essay', custom_prompt, input_mode: 'photo', body }, { body, custom_prompt });
      setPhotoSubmissionId(submission.id);
      if (submission.photos.length > photos.length) await deletePhotos(submission.id);
      for (const [i, photo] of photos.entries()) {
        setBusy(`上傳第 ${i + 1}／${photos.length} 張照片…`);
        await uploadPhoto(submission.id, i + 1, photo.blob);
      }
      setBusy('送出辨識…');
      await startTask('essay-ocr', submission.id, { isFailure: isCustomTaskConflict });
      // 辨識送出就算送了 AI（之後的確認與批改在結果頁完成）。
      persistNow({ aiSubmittedAt: Date.now(), lastSubmissionId: submission.id });
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      await fail(err);
    }
  };

  // ───────────── 題目的收合、清除 ─────────────
  const collapsePrompt = () => {
    update({ promptCollapsed: true });
    setShowFullPrompt(false);
    focusOn('custom-prompt-h');
  };
  const editPrompt = () => {
    userEditedPrompt.current = true;
    update({ promptCollapsed: false });
    focusOn(PROMPT_FIELD_INPUT.text);
  };
  const clearPrompt = () => {
    persistNow({ prompt: emptyCustomPromptDraft(), requirementsConfirmed: null, promptCollapsed: false });
    setPromptError(null);
    setShowFullPrompt(false);
  };
  const clearEssay = () => {
    persistNow({ text: '', submissionId: null, selfScores: null, checked: [] });
    setError(null);
    setEssayError(null);
  };
  const clearAll = () => {
    const d = draftRef.current;
    persistNow({ ...emptyCustomEssayDraft(), mode: d.mode, aiSubmittedAt: d.aiSubmittedAt, lastSubmissionId: d.lastSubmissionId });
    setPromptError(null);
    setEssayError(null);
    setError(null);
    setOldDraftDays(0);
  };

  /**
   * 送出前確認的一個選擇：馬上寫進 ref（同一個事件裡就要用到）。全部處理完就接著送出原本按的那一個（審查 ux-3）；
   * 還有沒處理的，焦點回到確認區塊的標題（按下的那一列已經消失）。
   */
  const resolveRequirement = (patch: Partial<CustomEssayDraft>) => {
    const next = { ...draftRef.current, ...patch, updatedAt: Date.now() };
    draftRef.current = next;
    setDraft(next);
    if (!hasPending(pendingRequirements(next.prompt, next.requirementsConfirmed))) {
      const which = confirmingReq;
      setConfirmingReq(null);
      if (which === 'photo') void submitPhotos();
      else void submitTyped();
    } else {
      focusOn(REQ_CONFIRM_HEADING);
    }
  };
  const requirementsHandlers = {
    onSetParagraphs: (n: number) => resolveRequirement({ prompt: { ...draftRef.current.prompt, paragraphs: n } }),
    onNoParagraphs: (n: number) => resolveRequirement({ requirementsConfirmed: { ...(draftRef.current.requirementsConfirmed ?? {}), paragraphs: n } }),
    onSetWords: (w: WordsSuggestion) =>
      resolveRequirement({ prompt: { ...draftRef.current.prompt, minWords: w.min === null ? '' : String(w.min), maxWords: w.max === null ? '' : String(w.max) } }),
    onNoWords: (w: WordsSuggestion) => resolveRequirement({ requirementsConfirmed: { ...(draftRef.current.requirementsConfirmed ?? {}), words: w.key } }),
  };

  const photoAvailable = access.state === 'ready' && access.ocr && customOpen;
  const photoRisky = photos.some((p) => photoQualityIssue(p) !== null);
  const ocrPoints = taskPoints(quota, 'essay_ocr');
  const gradePoints = taskPoints(quota, 'essay_grade');
  const promptProblem = firstProblem(check);
  const canGrade = check.ok && !length.empty && !length.tooLong && essayProblem === null;
  // 收合後的預覽顯示學生自己打的字（只去掉頭尾空白）：正規化（NFKC）會把全形逗號變成半形，預覽不必跟著變。
  const viewValue: CustomPromptViewValue = {
    text: draft.prompt.text.trim(),
    figure_text: draft.prompt.figure.trim() === '' ? null : draft.prompt.figure.trim(),
    paragraphs: check.ok ? check.value.paragraphs : null,
    min_words: check.ok ? check.value.min_words : null,
    max_words: check.ok ? check.value.max_words : null,
  };
  const showConfirm = confirmingReq !== null && pendingAny;
  // 桌機：字數或段數有提醒時，送出前先確認（components/SubmitGuard.tsx）；確定之後照舊走題目要求的確認（submitTyped）。
  const warnings = customSubmitWarnings(length, hints, minWords);
  const guard = useSubmitGuard({ warnings, onSubmit: () => void submitTyped(), returnFocusId: ESSAY_INPUT });

  /** 送 AI 批改的按鈕為什麼不能按（只說一個最先要處理的）。 */
  const typedBlockedReason = !check.ok
    ? `題目還要修改：${promptProblem ?? ''}`
    : length.tooLong || length.empty
      ? null
      : essayProblem
        ? gradableMessage(essayProblem, length.words)
        : null;

  return (
    <div className="space-y-4">
      <header>
        <title>{`自訂題目作文｜寫作練習｜${APP_NAME}`}</title>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">自訂題目作文</h1>
        <SourceTabs kind="essay" current="custom" />
        <p className="mt-3 text-[0.95rem]">{customOpen ? CUSTOM_INTRO : CUSTOM_INTRO_SELF_ONLY}</p>
      </header>

      {oldDraftDays > OLD_DRAFT_DAYS && (
        <Notice>
          <p>這是 {oldDraftDays} 天前的草稿。</p>
          <div className="mt-1">
            <ConfirmButton
              label="清除題目與作文"
              question="確定要清除這份草稿的題目、作文與自評嗎？"
              confirmLabel="確定清除"
              onConfirm={clearAll}
              disabled={busy !== null}
              doneMessage="已清除題目與作文。"
            />
          </div>
        </Notice>
      )}

      {fromState.status === 'loading' && (
        <p role="status" className="text-sm text-muted">
          正在帶回之前作答的題目…
        </p>
      )}
      {fromState.status === 'note' && (
        <Notice role="status">
          <p>{fromState.message}</p>
        </Notice>
      )}
      {fromState.status === 'error' && (
        <div className="space-y-2">
          <ErrorMessage view={fromState.view} />
          {fromState.retry && (
            <button type="button" className={secondaryButton} onClick={() => setFromAttempt((n) => n + 1)}>
              再試一次
            </button>
          )}
        </div>
      )}
      {fromState.status === 'ask' && (
        <div role="group" aria-labelledby="custom-from-h" className="space-y-2 rounded-xl border border-badge-fg/30 bg-badge-bg/60 px-4 py-3 text-sm">
          <p id="custom-from-h" className="font-semibold">
            {fromState.plan.hidden ? '要載入之前作答的作文嗎？' : fromState.plan.essay === null ? '要載入之前作答的題目嗎？' : '要載入之前作答的題目與作文嗎？'}
          </p>
          <p>{fromState.hasEssay ? '這台裝置上的草稿已經有另一篇作文。' : '這台裝置上的草稿已經有另一個還沒送出的題目。'}</p>
          {fromState.plan.hidden && <p>那一份作答的題目已隱藏，不能帶回；載入後請重新輸入題目。</p>}
          <div className="flex flex-wrap gap-2">
            {fromState.plan.essay === null ? (
              fromState.hasEssay ? (
                <>
                  <button type="button" className={secondaryButton} onClick={() => applyFrom(fromState.plan, 'prompt_clear')}>
                    載入題目並清掉目前的作文
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => applyFrom(fromState.plan, 'prompt_keep')}>
                    只換題目、保留目前的作文
                  </button>
                </>
              ) : (
                <button type="button" className={secondaryButton} onClick={() => applyFrom(fromState.plan, 'replace')}>
                  載入題目（取代目前的題目）
                </button>
              )
            ) : (
              <button type="button" className={secondaryButton} onClick={() => applyFrom(fromState.plan, 'replace')}>
                {fromState.plan.hidden ? '載入作文（取代目前的草稿）' : '載入題目與作文（取代目前的草稿）'}
              </button>
            )}
            <button type="button" className={secondaryButton} onClick={() => setFromState({ status: 'idle' })}>
              保留目前的草稿
            </button>
          </div>
        </div>
      )}

      <section aria-labelledby="custom-prompt-h" className={`space-y-3 ${card}`}>
        <h2 id="custom-prompt-h" tabIndex={-1} className="text-lg font-semibold focus:outline-none">
          題目
        </h2>
        {collapsed ? (
          <>
            <CustomPromptView prompt={viewValue} compact={!showFullPrompt} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={secondaryButton} aria-expanded={showFullPrompt} onClick={() => setShowFullPrompt((v) => !v)}>
                {showFullPrompt ? '收起完整題目' : '看完整題目'}
              </button>
              <button type="button" className={secondaryButton} onClick={editPrompt}>
                修改題目
              </button>
            </div>
          </>
        ) : (
          <CustomPromptForm value={draft.prompt} onChange={setPrompt} check={check} serverError={promptError} confirmed={draft.requirementsConfirmed}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primaryButton} disabled={!check.ok} onClick={collapsePrompt}>
                題目設定好了
              </button>
              <ConfirmButton
                label="清除題目"
                question="確定要清除題目、圖片描述與要求嗎？"
                confirmLabel="確定清除"
                onConfirm={clearPrompt}
                disabled={busy !== null}
                doneMessage="已清除題目。"
              />
            </div>
            {!check.ok && draft.prompt.text.trim() !== '' && <p className="text-sm text-muted">題目還不能用：{promptProblem}</p>}
          </CustomPromptForm>
        )}
      </section>

      {/* 切換按鈕（aria-pressed），和歷屆作答頁同一種做法；不用 tab 角色。 */}
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
          <label htmlFor={ESSAY_INPUT} className="block text-sm text-muted">
            你的作文（段落之間換行）
          </label>
          <textarea
            id={ESSAY_INPUT}
            rows={16}
            value={draft.text}
            onChange={(e) => {
              setEssayError(null);
              update({ text: e.currentTarget.value });
            }}
            aria-invalid={essayError ? true : undefined}
            aria-describedby={`custom-essay-count${essayError ? ' custom-essay-error' : ''}`}
            className={textInput}
            {...englishInputProps}
          />
          <p id="custom-essay-count" className="text-sm tabular-nums text-muted" aria-live="polite">
            <span className={length.overWords ? 'font-semibold text-bad' : ''}>{length.words} 個單詞</span>・
            <span className={hints.some((h) => h.id === 'paragraph_deduction') ? 'font-semibold text-bad' : ''}>{length.paragraphs} 段</span>
            {length.chars > 3000 && <span className={length.overChars ? 'font-semibold text-bad' : ''}>・{length.chars.toLocaleString('zh-TW')}／4,000 字元</span>}
          </p>
          {essayError && (
            <p id="custom-essay-error" role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
              {essayError}
            </p>
          )}
          {hints.map((h) =>
            h.tone === 'warn' ? (
              <Notice key={h.id} tone="warn">
                <p>{h.text}</p>
              </Notice>
            ) : (
              <p key={h.id} className="text-sm text-muted">
                {h.text}
              </p>
            ),
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

          {guard.confirming ? (
            <SubmitConfirm guard={guard} warnings={warnings} points={gradePoints} quota={quota} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} aria-expanded={selfOpen} aria-controls="custom-essay-self" onClick={() => setSelfOpen((v) => !v)}>
                {selfOpen ? '收起自我檢核' : '自我檢核與自評（不用 AI）'}
              </button>
              {access.state === 'ready' && customOpen && !showConfirm && (
                <button id="custom-send-typed" type="button" className={primaryButton} disabled={busy !== null || !canGrade} onClick={guard.request}>
                  {busy ?? `送出 AI 批改（${gradePoints} 點）`}
                </button>
              )}
            </div>
          )}
          {access.state === 'ready' && customOpen && showConfirm && <RequirementsConfirm pending={pending} {...requirementsHandlers} />}
          {reqStatus && (
            <p role="status" className="text-sm">
              {reqStatus}
            </p>
          )}
          {access.state === 'ready' && customOpen && typedBlockedReason && <p className="text-sm text-muted">{typedBlockedReason}</p>}
          {customOff ? (
            <Notice>
              <p>{CUSTOM_NOT_OPEN}</p>
            </Notice>
          ) : access.state === 'ready' ? (
            <>
              <AiNotice generic />
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
              question="確定要清除這篇作文的草稿與自評嗎？（題目會保留）"
              confirmLabel="確定清除"
              onConfirm={clearEssay}
              disabled={busy !== null}
              doneMessage="已清除這篇作文的草稿與自評，題目保留。"
            />
          </div>
        </section>
      ) : (
        <section aria-label="拍照上傳手寫稿" className={`space-y-3 ${card}`}>
          {photoAvailable ? (
            <>
              <AiNotice generic />
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
              <p className="text-sm">{customPhotoRule(ocrPoints)}</p>
              {showConfirm ? (
                <RequirementsConfirm pending={pending} {...requirementsHandlers} />
              ) : (
                <button
                  id="custom-send-photo"
                  type="button"
                  className={primaryButton}
                  disabled={busy !== null || photos.length === 0 || !check.ok || (photoRisky && !photoRiskAccepted)}
                  onClick={() => void submitPhotos()}
                >
                  {busy ?? `上傳並辨識（${ocrPoints} 點）`}
                </button>
              )}
              {reqStatus && (
                <p role="status" className="text-sm">
                  {reqStatus}
                </p>
              )}
              {!check.ok && <p className="text-sm text-muted">題目還要修改：{promptProblem}</p>}
              {error && <ErrorMessage view={error} />}
            </>
          ) : customOff || access.state === 'ready' ? (
            <Notice>
              <p>{customOpen ? <><strong>拍照上傳即將開放。</strong>現在可以先用打字作答。</> : CUSTOM_NOT_OPEN_PHOTO}</p>
              {!customOpen && (
                <button type="button" className={`mt-2 ${secondaryButton}`} onClick={() => update({ mode: 'typed' })}>
                  切到打字作答
                </button>
              )}
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
        <div id="custom-essay-self" ref={selfPanel} tabIndex={-1} className="scroll-mt-20 focus:outline-none">
          <EssaySelfAssess
            scores={draft.selfScores}
            checked={draft.checked}
            onScores={(selfScores) => update({ selfScores })}
            onToggle={(id) => update({ checked: draft.checked.includes(id) ? draft.checked.filter((x) => x !== id) : [...draft.checked, id] })}
          />
        </div>
      )}

      <RubricSummary />
      <CustomSourceNote />
    </div>
  );
}
