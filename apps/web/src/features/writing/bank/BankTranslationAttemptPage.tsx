/**
 * /writing/translation/ai/:code：本站仿真中譯英作答（docs/design/bank-writing.md §2.3、§2.5）。
 *
 *   1. 讀題：兩句中文，同一個主題；作答說明是本站的固定文字（Worker 送給 AI 的是同一句）。
 *   2. 鷹架：每句的「看提示（1／3）」一次開一層（切成四段 → 標的詞彙 → 句型框架），開到第幾層記在草稿。
 *   3. 作答：和歷屆題相同（每句 ≤500 字元、即時提醒大寫與標點、600 ms 後自動存草稿）。
 *   4. 對照：兩句都寫了才能按「寫好了，對照參考譯文」。按下後作答鎖定成唯讀（看完答案不能再改，自評才不失真），
 *      這時才下載 answers 檔（作答頁的網路請求裡看不到答案），焦點移到「對照與自評」。
 *   5. 自評：每句 4 部分逐項記錯（../selfScore.ts，和 AI 批改同一套規則），合計 /8。
 *   6. AI 批改（登入且核准）：直接呼叫 lib/submit.ts，流程和歷屆題相同，只是 group id 換成 '{uid}@{v}'。
 * 歷屆的 TranslationAttemptPage 一行都沒改（送出流程抽成共用模組留給另一個 PR，設計文件 §11 第 4 點）。
 */
import { TIER_LABELS, TRANSLATION_SENTENCE_MAX_CHARS, isAiGradableTranslation, type SelfAssessment, type TranslationBody } from '@gsat/shared';
import { ChevronRight, Lock } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { dataErrorMessage } from '../../../data/client';
import { APP_NAME } from '../../../modules';
import { AiGroupBadge } from '../../practice/components/AiGroupBadge';
import { displayTopic } from '../../practice/labels';
import { AiAccessNotice, QuotaSummary, taskPoints } from '../components/AiAccessPanel';
import { AiNotice, BackLink, ConfirmButton, DataError, ErrorMessage, Loading, card, englishInputProps, primaryButton, secondaryButton, textInput } from '../components/ui';
import { useAiAccess } from '../lib/access';
import { draftKey, saveDraft } from '../lib/drafts';
import { isQuotaError, type ErrorView } from '../lib/errors';
import { useAutosave, useQuota, useRevealOnOpen, useStaticData } from '../lib/hooks';
import { listOriginBack, listOriginState } from '../lib/listOrigin';
import { AlreadySubmittedError, saveSelfAssessment, startTask, upsertSubmission } from '../lib/submit';
import { checkTranslationSentence, mechanicsMessages } from '../lib/text';
import { useErrorView } from '../lib/useErrorView';
import { BankHints } from './components/BankHints';
import { BankNotFound } from './components/BankNotFound';
import { BankSourceNote } from './components/BankSourceNote';
import { TranslationReveal } from './components/TranslationReveal';
import { bankAttemptPath, bankListPath, loadBankAnswers, type BankTranslationAnswersFile, type BankTranslationPromptFile, type WritingBankEntry, type WritingBankIndex } from './data';
import { emptyBankTranslationDraft, loadRawDraft, toBankTranslationDraft, type BankTranslationDraft } from './drafts';
import { bankErrorView } from './errors';
import { selfScoresOf } from './selfScore';
import { nextEntry, useBankItem } from './useBankItem';

export default function BankTranslationAttemptPage() {
  const { code } = useParams();
  return <BankTranslationLoader key={code ?? ''} code={code} />;
}

function BankTranslationLoader({ code }: { code: string | undefined }) {
  const data = useBankItem<BankTranslationPromptFile>('translation', code);
  const ready = data.status === 'ready' && data.value.found ? data.value : null;
  const tier = ready?.entry.tier;
  // 從題型頁（/translation）的本站仿真題列表點進來的，返回那一頁、停在同一個難度；否則回到本站仿真題的列表頁。
  const back = listOriginBack(
    useLocation().state,
    { to: bankListPath('translation', tier), label: `本站仿真中譯英${tier ? `（${TIER_LABELS[tier]}）` : ''}` },
    tier ? `?tier=${tier}` : '',
  );
  return (
    <article>
      <BackLink to={back.to}>{back.label}</BackLink>
      {data.status === 'loading' && (
        <>
          <title>{`本站仿真中譯英｜${APP_NAME}`}</title>
          <h1 className="sr-only">本站仿真中譯英</h1>
          <Loading>題目載入中…</Loading>
        </>
      )}
      {data.status === 'error' && (
        <>
          <title>{`本站仿真中譯英｜${APP_NAME}`}</title>
          <h1 className="mb-4 text-2xl font-bold">本站仿真中譯英</h1>
          <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />
        </>
      )}
      {data.status === 'ready' && !data.value.found && <BankNotFound section="translation" back={back} />}
      {ready && <BankTranslationAttempt entry={ready.entry} index={ready.index} prompt={ready.prompt} />}
    </article>
  );
}

/** 交出作答後才下載 answers 檔（這個元件只在對照之後才掛上）。 */
function TranslationAnswers({ prompt, render }: { prompt: BankTranslationPromptFile; render: (answers: BankTranslationAnswersFile) => ReactNode }) {
  const data = useStaticData(() => loadBankAnswers(prompt.uid, prompt.version));
  if (data.status === 'loading') return <Loading>參考譯文載入中…</Loading>;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;
  if (data.value.section_type !== 'translation') return <DataError message="參考內容的格式不正確，請重新整理頁面。" onRetry={data.retry} />;
  return <>{render(data.value)}</>;
}

function BankTranslationAttempt({ entry, index, prompt }: { entry: WritingBankEntry; index: WritingBankIndex; prompt: BankTranslationPromptFile }) {
  const navigate = useNavigate();
  const n = prompt.items.length;
  const groupId = prompt.group_id;
  const key = draftKey('translation', groupId);
  const [draft, setDraft] = useState<BankTranslationDraft>(() => toBankTranslationDraft(loadRawDraft(key), n) ?? emptyBankTranslationDraft(n));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const { ok: saved, discard } = useAutosave(key, draft);
  const access = useAiAccess();
  const errorView = useErrorView();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const revealed = draft.revealedAt !== null;
  const panel = useRevealOnOpen<HTMLElement>(revealed);

  const checks = draft.texts.map(checkTranslationSentence);
  const allFilled = checks.every((c) => !c.empty);
  const anyTooLong = checks.some((c) => c.tooLong);
  const aiSupported = isAiGradableTranslation(prompt.items);
  const topic = displayTopic(prompt.topic);
  const title = topic ? `中譯英：${topic}` : '中譯英';
  const next = nextEntry(index, entry);
  // 「下一組」照樣帶著從哪一頁的列表點進來（題型頁），返回連結才一路回得去。
  const origin = listOriginState(useLocation().state);

  const update = (patch: Partial<BankTranslationDraft>) => setDraft((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  /** 立刻寫進這台裝置（不等 600 ms）：對照、送出 AI 批改之後馬上換頁或重新整理，狀態也不會掉。 */
  const persistNow = (patch: Partial<BankTranslationDraft>) => {
    const nextDraft = { ...draftRef.current, ...patch, updatedAt: Date.now() };
    draftRef.current = nextDraft;
    discard();
    saveDraft(key, nextDraft);
    setDraft(nextDraft);
  };
  const setText = (i: number, text: string) => update({ texts: draft.texts.map((t, j) => (j === i ? text : t)) });
  const setCell = <T,>(grid: readonly (readonly T[])[], i: number, j: number, v: T): T[][] => grid.map((row, a) => row.map((c, b) => (a === i && b === j ? v : c)));

  const reveal = () => {
    if (!revealed) persistNow({ revealedAt: Date.now() });
    else panel.current?.querySelector<HTMLElement>('h2')?.focus();
  };

  const submitAi = async () => {
    setBusy(true);
    setError(null);
    const body: TranslationBody = { items: prompt.items.map((item, i) => ({ item_id: item.item_id, text: (draft.texts[i] ?? '').trim() })) };
    // 對照過才有自評（逐部分記錯）；沒對照就不送，結果頁不會出現假的自評分數。
    const selfAssess: SelfAssessment | null = revealed ? { kind: 'translation', sentence_scores: selfScoresOf(draft) } : null;
    try {
      const submission = await upsertSubmission(draft.submissionId, { kind: 'translation', group_id: groupId, input_mode: 'typed', body }, { body });
      // 先記下 id：下一步失敗（額度不足、網路）時重送沿用同一份。
      persistNow({ submissionId: submission.id });
      await saveSelfAssessment(submission.id, selfAssess).catch(() => undefined);
      await startTask('translation-grade', submission.id);
      persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: submission.id });
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      if (err instanceof AlreadySubmittedError) {
        // 上一次其實已經送出（回應遺失）：直接看那一份的進度，不再送一次、不再扣點。
        persistNow({ submissionId: null, aiSubmittedAt: Date.now(), lastSubmissionId: err.submission.id });
        navigate(`/writing/submissions/${encodeURIComponent(err.submission.id)}`);
        return;
      }
      const special = bankErrorView(err);
      const q = !special && isQuotaError(err) ? await refreshQuota() : quota;
      setError(special ?? (await errorView(err, { quota: q, submitting: true })));
      setBusy(false);
    }
  };

  const clearAll = () => {
    // 文字、對照狀態與自評清掉；送過 AI 批改的紀錄保留（列表卡片仍顯示「已完成」、仍有上次結果的連結）。
    persistNow({ ...emptyBankTranslationDraft(n), aiSubmittedAt: draftRef.current.aiSubmittedAt, lastSubmissionId: draftRef.current.lastSubmissionId });
    setError(null);
  };

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

      {prompt.items.map((item, i) => {
        const text = draft.texts[i] ?? '';
        const check = checks[i];
        const id = `bt-input-${i}`;
        const hints = !revealed && check && !check.empty ? mechanicsMessages(check.mechanics) : [];
        return (
          <section key={item.label} aria-labelledby={`${id}-label`} className={card}>
            <h2 id={`${id}-label`} className="flex flex-wrap items-baseline gap-2 font-semibold">
              第 {i + 1} 句<span className="text-sm font-normal text-muted">（{item.points} 分）</span>
            </h2>
            <p className="mt-1 text-lg">{item.stem}</p>
            <label htmlFor={id} className="mt-3 block text-sm text-muted">
              <span className="sr-only">第 {i + 1} 句</span>英文譯文
              {revealed && <span>（已對照，作答已鎖定）</span>}
            </label>
            <textarea
              id={id}
              rows={3}
              maxLength={TRANSLATION_SENTENCE_MAX_CHARS}
              value={text}
              readOnly={revealed}
              onChange={(e) => setText(i, e.currentTarget.value)}
              aria-describedby={`${id}-count`}
              className={`mt-1 ${textInput} ${revealed ? 'bg-surface-2' : ''}`}
              {...englishInputProps}
            />
            <p id={`${id}-count`} className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm text-muted">
              <span className={hints.length > 0 ? 'text-bad' : ''}>{hints.length > 0 ? `提醒：${hints.join('；')}` : ''}</span>
              <span className={`tabular-nums ${text.length >= TRANSLATION_SENTENCE_MAX_CHARS ? 'text-bad' : ''}`}>
                {text.length}／{TRANSLATION_SENTENCE_MAX_CHARS} 字元
              </span>
            </p>
            <BankHints
              hints={item.hints}
              level={draft.hintLevels[i] ?? 0}
              label={`第 ${i + 1} 句的提示`}
              onLevel={(level) => update({ hintLevels: draft.hintLevels.map((h, j) => (j === i ? level : h)) })}
            />
          </section>
        );
      })}

      <p className="text-sm text-muted" role="status">
        {saved ? '草稿會自動存在這台裝置。' : '這個瀏覽器無法儲存草稿（可能是無痕模式），離開頁面後內容會遺失。'}
      </p>

      <section aria-label="送出" className={`space-y-3 ${card}`}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={revealed ? secondaryButton : primaryButton}
            disabled={!revealed && (!allFilled || anyTooLong)}
            aria-expanded={revealed}
            aria-controls="bank-reveal"
            onClick={reveal}
          >
            {revealed ? (
              <>
                <Lock aria-hidden="true" className="size-4" />
                看對照與自評
              </>
            ) : (
              '寫好了，對照參考譯文'
            )}
          </button>
          {access.state === 'ready' && aiSupported && (
            <button type="button" className={revealed ? primaryButton : secondaryButton} disabled={busy || !allFilled || anyTooLong} onClick={submitAi}>
              {busy ? '送出中…' : `送出 AI 批改（${taskPoints(quota, 'translation_grade')} 點）`}
            </button>
          )}
        </div>
        {!revealed && !allFilled && <p className="text-sm text-muted">兩句都寫完才能對照參考譯文（對照後作答會鎖定，不能再修改）。</p>}
        {access.state === 'ready' && aiSupported ? (
          <>
            <AiNotice />
            <QuotaSummary quota={quota} />
          </>
        ) : (
          access.state !== 'ready' && <AiAccessNotice access={access} compact />
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
            question="確定要清除這組的作答、對照與自評嗎？"
            confirmLabel="確定清除"
            onConfirm={clearAll}
            disabled={busy}
            doneMessage="已清除這組的作答、對照與自評。"
          />
        </div>
      </section>

      {revealed && (
        <section id="bank-reveal" ref={panel} aria-labelledby="bank-reveal-h" tabIndex={-1} className="scroll-mt-20 space-y-3 focus:outline-none">
          <h2 id="bank-reveal-h" className="text-xl font-bold">
            對照與自評
          </h2>
          <TranslationAnswers
            prompt={prompt}
            render={(answers) => (
              <TranslationReveal
                answers={answers}
                items={prompt.items}
                texts={draft.texts}
                partErrors={draft.partErrors}
                partMissing={draft.partMissing}
                onPartErrors={(i, j, v) => update({ partErrors: setCell(draft.partErrors, i, j, v) })}
                onPartMissing={(i, j, v) => update({ partMissing: setCell(draft.partMissing, i, j, v) })}
              />
            )}
          />
        </section>
      )}

      {next && (
        <p className="flex justify-end">
          <Link to={bankAttemptPath(next.uid) ?? '#'} state={origin} className={secondaryButton}>
            下一組
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </p>
      )}

      <BankSourceNote />
    </div>
  );
}
