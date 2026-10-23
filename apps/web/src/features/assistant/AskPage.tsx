/**
 * /assistant/ask：確認頁（docs/design/learning-assistant.md §1.5、§5.1）。按入口按鈕不會直接扣點：先到這裡，
 * 在瀏覽器裡組出這一題（或這一組）的預覽（不打 API），學生勾選要問的題、寫下卡在哪裡，看到要用幾點，再送出。
 *
 *   1. 網址（parseAskParams）→ 轉接器（sources/）→ 預覽、同組可以勾的題與預設勾選；這台裝置沒有作答紀錄時改提供「貼上題目」。
 *   2. 送出：POST /api/assist/cases（同一組同樣的作答已經有案例時回那一筆，已經解析過就直接打開、不再扣點）
 *      → POST …/analyze（202 排入佇列；共用快取命中時 200、0 點）→ 轉到案例頁輪詢。
 *      回來的是既有的案例、而這次寫的疑問和它不同時（去重不看疑問）：不送出解析（解析看不到新的疑問），
 *      把這次的疑問放進案例頁的追問框，由學生決定要不要追問。
 *   3. 沒登入、AI 未核准、未同意新版：預覽照樣看得到，送出按鈕換成開通說明。
 */
import {
  ASSIST_DOUBT_LABELS,
  ASSIST_LIMITS,
  assistAnalyzePoints,
  parseAskParams,
  type AskRef,
  type AssistCaseDetail,
  type AssistDoubtKind,
  type OptionLetter,
} from '@gsat/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DataLoadError } from '../../data/client';
import { BackLink, ErrorMessage } from '../writing/components/ui';
import { useAiAccess, useSignedIn } from '../writing/lib/access';
import type { ErrorView } from '../writing/lib/errors';
import { useQuota } from '../writing/lib/hooks';
import { AssistAccessNotice, AssistGate, AssistHeader } from './components/AssistAccess';
import { DoubtPicker, EMPTY_DOUBT, type DoubtValue } from './components/DoubtPicker';
import { ErrorCountsLine } from './components/HistoryLine';
import { LabelPicker } from './components/LabelPicker';
import { primaryBtn } from './components/parts';
import { QuestionPreview } from './components/QuestionPreview';
import { createAssistCase, listAssistCases, startAssistAnalyze } from './lib/assistApi';
import { markAsked } from './lib/asked';
import { loadAssistDraft, saveAssistDraft } from './lib/drafts';
import { useAssistErrorView } from './lib/pollers';
import { practicePath } from '../practice/labels';
import { isPracticeSectionType } from '../../data/bank';
import { getOutcomes } from './outcomes';
import { BankPaperChangedError } from './sources/bankMock';
import { compareLabels } from './sources/common';
import { resolveAsk, type ResolvedAsk } from './sources';

type LoadState = { status: 'loading' } | { status: 'ready'; resolved: ResolvedAsk } | { status: 'none' } | { status: 'error'; error: unknown };

function useResolved(ask: AskRef | null, attempt: number): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const key = ask ? JSON.stringify(ask) : null;
  useEffect(() => {
    if (!ask) return;
    let alive = true;
    setState({ status: 'loading' });
    resolveAsk(ask).then(
      (resolved) => alive && setState(resolved ? { status: 'ready', resolved } : { status: 'none' }),
      (error: unknown) => alive && setState({ status: 'error', error }),
    );
    return () => {
      alive = false;
    };
    // ask 由 key 代表（每次 render 都是新物件）。
  }, [key, attempt]);
  return state;
}

/** 這次寫的疑問和既有案例上的一樣（去重不看疑問；伺服器存的文字做過 NFKC 與個資遮罩，比對前一樣正規化）。 */
function sameDoubt(detail: AssistCaseDetail, kinds: readonly AssistDoubtKind[], tornWith: OptionLetter | null, text: string): boolean {
  const norm = (t: string | null) => (t ?? '').normalize('NFKC').trim();
  const a = [...detail.doubt_kinds].sort().join(',');
  const b = [...kinds].sort().join(',');
  return a === b && (detail.torn_with ?? null) === tornWith && norm(detail.doubt) === norm(text);
}

/** 把勾選的疑問與自由輸入組成一段追問的文字（放進案例頁的追問框，學生可以改）。 */
function doubtAsFollowup(kinds: readonly AssistDoubtKind[], torn: { question: string | null; mine: string | null; with: OptionLetter | null }, text: string): string {
  const parts = kinds.map((k) =>
    k === 'torn_between' && torn.mine && torn.with ? `${torn.question ? `${torn.question}：` : ''}我在 (${torn.mine}) 和 (${torn.with}) 之間猶豫` : ASSIST_DOUBT_LABELS[k],
  );
  if (text !== '') parts.push(text);
  return parts.join('。');
}

/** 單位：格子題型寫「格」，單字寫「個字」。 */
function unitOf(resolved: ResolvedAsk): string {
  if (resolved.kind === 'vocab') return '個字';
  const s = resolved.preview.section;
  return s === 'cloze' || s === 'word_bank' || s === 'structure' ? '格' : '題';
}

function NoRecord() {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-line bg-surface-2 p-5">
      <p className="font-semibold">這台裝置沒有這一題的作答紀錄</p>
      <p className="text-muted">作答紀錄只存在作答的那台裝置與瀏覽器。可以改用「貼上題目」，把題目與你的答案貼上來問。</p>
      <Link to="/assistant/new" className={primaryBtn}>
        貼上題目
      </Link>
    </div>
  );
}

function LoadError({ error, ask, onRetry }: { error: unknown; ask: AskRef; onRetry: () => void }) {
  if (error instanceof BankPaperChangedError) {
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <p className="font-semibold">這份卷子的題目已經更新</p>
        <p className="text-muted">這個瀏覽器沒有保存原本的題目，為了不拿新題目對舊答案，這份卷子的題目不能送出解析。</p>
      </div>
    );
  }
  if (error instanceof DataLoadError && error.kind === 'not_found') {
    const m = ask.src === 'bank' ? /^ai\.(vo|cz|wb|st|rd|mx)\./.exec(ask.ref) : null;
    const section = m ? ({ vo: 'vocabulary', cz: 'cloze', wb: 'word_bank', st: 'structure', rd: 'reading', mx: 'mixed' } as const)[m[1] as 'vo'] : null;
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <p className="font-semibold">這一題已經改版，舊版無法解析</p>
        <p className="text-muted">可以做一次新版本（同一組的新版本）再來問。</p>
        {section && isPracticeSectionType(section) && ask.src === 'bank' && (
          <Link
            to={`${practicePath(section, getOutcomes().items.find((e) => e.s === 'bank' && e.r === ask.ref)?.t ?? 'basic')}?group=${encodeURIComponent(ask.ref.split('@')[0] ?? '')}`}
            className="font-medium text-primary underline underline-offset-2"
          >
            做新版本
          </Link>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-2xl border border-line bg-surface p-5">
      <p className="font-semibold">暫時讀不到題目，請稍後再試</p>
      <p className="text-muted">{error instanceof DataLoadError ? error.message : '題目資料載入失敗。'}（沒有扣點）</p>
      <button type="button" onClick={onRetry} className={primaryBtn}>
        再試一次
      </button>
    </div>
  );
}

function AskForm({ ask, resolved }: { ask: AskRef; resolved: ResolvedAsk }) {
  const navigate = useNavigate();
  const access = useAiAccess();
  const signedIn = useSignedIn();
  const ready = access.state === 'ready';
  const { quota } = useQuota(ready);
  const errorView = useAssistErrorView();
  const [labels, setLabels] = useState<string[]>(() => resolved.group.defaults);
  const draftKey = `doubt:${JSON.stringify(ask)}`;
  const [doubt, setDoubt] = useState<DoubtValue>(() => ({ ...EMPTY_DOUBT, text: loadAssistDraft(draftKey) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ view: ErrorView; caseId: string | null } | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => saveAssistDraft(draftKey, doubt.text), 400);
    return () => clearTimeout(timer);
  }, [draftKey, doubt.text]);

  // 之前問過的題目裡最常見的錯因（登入才有；失敗就不顯示）。
  useEffect(() => {
    if (!signedIn) return;
    const controller = new AbortController();
    listAssistCases({ signal: controller.signal }).then(
      (r) => setCounts(r.error_counts),
      () => {},
    );
    return () => controller.abort();
  }, [signedIn]);

  const items = resolved.preview.items;
  const unit = unitOf(resolved);
  // 「猶豫」指的是勾選的第一題（依題號；Worker 把題號排序後用第一題的答案），不一定是學生按的那一題。
  const chosen = items.filter((i) => labels.includes(i.label)).sort((a, b) => compareLabels(a.label, b.label));
  const first = chosen[0];
  const isChoice = (i: (typeof items)[number] | undefined) => i !== undefined && (i.mode === 'single_choice' || i.mode === 'bank_choice');
  const tornOptions = useMemo(() => {
    if (!first || resolved.kind !== 'item') return [];
    const opts = first.options ?? resolved.preview.sharedOptions;
    if (!opts || !isChoice(first)) return [];
    const mine = typeof first.studentAnswer === 'string' ? first.studentAnswer : null;
    return Object.keys(opts)
      .sort()
      .filter((l) => l !== mine);
  }, [first, resolved]);
  const mine = first && typeof first.studentAnswer === 'string' ? first.studentAnswer : null;
  const tornQuestion = first && chosen.length > 1 ? `第 ${resolved.displayOf(first.label)} ${unit}` : null;
  // 換了勾選的第一題之後，原本選的第二個選項可能不再是那一題的選項：當成還沒選。
  const tornWith = doubt.tornWith !== null && tornOptions.includes(doubt.tornWith) ? doubt.tornWith : null;
  // 學生按的是同組的另一題（「這題有疑問？：第 37 題」）：說明猶豫指的是第一題，提供「只問第 37 題」。
  const requested = 'labels' in ask && ask.labels.length === 1 ? (resolved.group.defaults[0] ?? null) : null;
  const requestedItem = requested !== null && requested !== first?.label && labels.includes(requested) ? items.find((i) => i.label === requested) : undefined;
  const tornNote =
    requestedItem && isChoice(requestedItem) && resolved.kind === 'item' ? (
      <p>
        猶豫的選項只能針對勾選的第一題（{tornQuestion}）。要問第 {resolved.displayOf(requestedItem.label)} {unit}在哪兩個選項之間猶豫，
        <button
          type="button"
          onClick={() => setLabels([requestedItem.label])}
          className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2"
        >
          只問第 {resolved.displayOf(requestedItem.label)} {unit}
        </button>
        ，或寫在「想問的話」。
      </p>
    ) : null;
  const points = assistAnalyzePoints(resolved.kind, Math.max(1, labels.length));
  const remaining = quota ? Math.max(0, quota.points.day_limit - quota.points.day_used) : null;
  const doubtLength = [...doubt.text].length;
  const canSubmit = ready && labels.length > 0 && doubtLength <= ASSIST_LIMITS.doubtMaxChars && !busy && (!doubt.kinds.includes('torn_between') || tornWith !== null || tornOptions.length === 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    let caseId: string | null = null;
    try {
      const text = doubt.text.trim();
      const kinds = doubt.kinds.filter((k) => k !== 'torn_between' || tornWith !== null);
      const torn = kinds.includes('torn_between') ? tornWith : null;
      const detail: AssistCaseDetail = await createAssistCase({
        source: resolved.sourceFor(labels),
        doubt_kinds: kinds,
        torn_with: torn,
        doubt: text === '' ? null : text,
        hint_first: false,
        signals: resolved.signalsFor(labels),
      });
      caseId = detail.id;
      markAsked(ask, ask.src === 'vocab' ? labels : labels.map(resolved.displayOf));
      saveAssistDraft(draftKey, '');
      const caseHref = `/assistant/case/${encodeURIComponent(detail.id)}`;
      // 既有的案例（同一組同樣的作答）上的疑問和這次寫的不同：解析看不到這次的疑問，不送出解析；
      // 這次的疑問放進案例頁的追問框（那裡原本有草稿就不蓋掉），由學生決定要不要追問。
      if (detail.existing && (kinds.length > 0 || text !== '') && !sameDoubt(detail, kinds, torn, text)) {
        const followupKey = `followup:${detail.id}`;
        if (loadAssistDraft(followupKey).trim() === '') saveAssistDraft(followupKey, doubtAsFollowup(kinds, { question: tornQuestion, mine, with: torn }, text));
        navigate(caseHref, { state: { carriedDoubt: true } });
        return;
      }
      // 同一組同樣的作答已經有案例：已經解析過（或正在解析）就直接打開，不再扣點。
      const analyzed = detail.turns.some((t) => t.kind === 'analyze' && t.status === 'done');
      if (!(detail.existing && (analyzed || detail.pending))) await startAssistAnalyze(detail.id);
      navigate(caseHref, { state: { started: true } });
    } catch (err) {
      setError({ view: await errorView(err, { quota, submitting: true }), caseId });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="ask-question" className="space-y-2">
        <h2 id="ask-question" className="text-lg font-semibold">
          {resolved.title}
        </h2>
        <QuestionPreview model={resolved.preview} />
      </section>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        {(items.length > 1 || resolved.group.single === false) && resolved.kind !== 'writing' && (
          <LabelPicker items={items} pick={resolved.group} value={labels} onChange={setLabels} unit={unit} displayOf={resolved.displayOf} />
        )}
        <DoubtPicker
          value={{ ...doubt, tornWith }}
          onChange={setDoubt}
          tornOptions={tornOptions}
          mine={mine}
          showFreeNote={resolved.maybeFree}
          kinds={resolved.kind === 'item' ? undefined : []}
          tornQuestion={tornQuestion}
          tornNote={tornNote}
        />
        <ErrorCountsLine counts={counts} />
        <div className="space-y-1 rounded-xl bg-surface-2 px-4 py-3 text-sm">
          {labels.length === 0 ? (
            <p>至少勾一{unit}才能送出解析。</p>
          ) : (
            <p>
              解析 {labels.length} {unit}會用 <strong className="tabular-nums">{points}</strong> 點
              {remaining !== null && <>；今天還剩 {remaining} 點</>}。
            </p>
          )}
          {labels.length > 0 && resolved.maybeFree && doubt.text.trim() === '' && <p className="text-muted">之前有同學問過同一題同樣的答案時，0 點。</p>}
        </div>
        <AssistAccessNotice access={access} />
        {ready && (
          <button type="submit" disabled={!canSubmit} className={primaryBtn}>
            {busy ? '送出中…' : '送出解析'}
          </button>
        )}
        {error && (
          <div className="space-y-2">
            <ErrorMessage view={error.view} />
            {error.caseId && (
              <Link to={`/assistant/case/${encodeURIComponent(error.caseId)}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-2">
                到這一題（可以稍後再送出解析）
              </Link>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

function Body() {
  const location = useLocation();
  const ask = useMemo(() => parseAskParams(location.search), [location.search]);
  const [attempt, setAttempt] = useState(0);
  const state = useResolved(ask, attempt);
  return (
    <article className="space-y-5">
      <BackLink to="/assistant/mistakes">錯題與疑點</BackLink>
      <AssistHeader title="請學習助手解析" docTitle="請學習助手解析｜學習助手" />
      {!ask ? (
        <p role="alert" className="rounded-xl border border-line bg-surface p-4">
          網址的格式不對，找不到要問的題目。請從題目旁的「問學習助手」按鈕再進來一次。
        </p>
      ) : state.status === 'loading' ? (
        <p role="status" className="text-muted">
          讀取題目與你的作答…
        </p>
      ) : state.status === 'none' ? (
        <NoRecord />
      ) : state.status === 'error' ? (
        <LoadError error={state.error} ask={ask} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <AskForm key={JSON.stringify(ask)} ask={ask} resolved={state.resolved} />
      )}
    </article>
  );
}

export default function AskPage() {
  return (
    <AssistGate>
      <Body />
    </AssistGate>
  );
}
