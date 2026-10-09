/**
 * /writing/translation/:examId：中譯英作答。負責：前端寫作 W2。
 *
 *   - 每句一個作答框（≤500 字元、即時字數），程式即時提醒句首大寫、句尾標點、全形標點；
 *   - 草稿自動存在這台裝置（localStorage，失敗不影響作答）；
 *   - 兩種送出：
 *       (a) AI 批改（features.ai、已登入、AI 已核准）：POST /api/submissions（或 PUT 沿用草稿）→ POST /api/ai/translation-grade
 *           → 導到 /writing/submissions/:id 輪詢；
 *       (b) 自我檢核（任何人）：本站的檢核清單與自評分，不顯示任何官方答案（D8）。
 *   - 題組 id 用 @gsat/shared 的 writingGroupId（data.ts 的 groupIdOf），小題 id 是 '{group_id}#{label}'。
 * AI 批改只支援現制的兩句一組、每句 4 分（data.ts 的 isAiGradableTranslation）；83–85 學測一組 5 句、93 學測每句 5 分，只能自我檢核。
 */
import {
  TRANSLATION_SENTENCE_MAX,
  TRANSLATION_SENTENCE_MAX_CHARS,
  type SelfAssessment,
  type TranslationBody,
} from '@gsat/shared';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { dataErrorMessage } from '../../data/client';
import { APP_NAME } from '../../modules';
import { RichText } from '../exams/components/RichText';
import { AiAccessNotice, QuotaSummary, taskPoints } from './components/AiAccessPanel';
import { PromptNotFound, SourceNote } from './components/SourceNote';
import { TranslationSelfCheck, selfScoreOf } from './components/TranslationSelfCheck';
import { AiNotice, BackLink, ConfirmButton, DataError, ErrorMessage, Loading, Notice, card, englishInputProps, primaryButton, secondaryButton, textInput } from './components/ui';
import { findTranslationSet, groupIdOf, isAiGradableTranslation, loadTranslationIndex, translationItemId, type TranslationSet } from './data';
import { useAiAccess } from './lib/access';
import { clearDraft, draftKey, isTranslationDraft, loadDraft, type TranslationDraft } from './lib/drafts';
import { isQuotaError, type ErrorView } from './lib/errors';
import { examRefLabel } from './lib/format';
import { useAutosave, useQuota, useRevealOnOpen, useStaticData } from './lib/hooks';
import { listOriginBack } from './lib/listOrigin';
import { AlreadySubmittedError, saveSelfAssessment, startTask, upsertSubmission } from './lib/submit';
import { checkTranslationSentence, mechanicsMessages } from './lib/text';
import { useErrorView } from './lib/useErrorView';

export default function TranslationAttemptPage() {
  const { examId = '' } = useParams();
  const data = useStaticData(loadTranslationIndex);
  const set = data.status === 'ready' ? findTranslationSet(data.value, examId) : undefined;
  // 從中譯英題型頁（/translation）的列表點進來的，返回那一頁。
  const back = listOriginBack(useLocation().state, { to: '/writing/translation', label: '中譯英題目' });
  return (
    <article>
      <BackLink to={back.to}>{back.label}</BackLink>
      {data.status === 'loading' && (
        <>
          <title>{`中譯英作答｜${APP_NAME}`}</title>
          <h1 className="sr-only">中譯英作答</h1>
          <Loading>題目載入中…</Loading>
        </>
      )}
      {data.status === 'error' && (
        <>
          <title>{`中譯英作答｜${APP_NAME}`}</title>
          <h1 className="mb-4 text-2xl font-bold">中譯英作答</h1>
          <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />
        </>
      )}
      {data.status === 'ready' && !set && (
        <>
          <title>{`找不到這個題目｜${APP_NAME}`}</title>
          <PromptNotFound backTo={back.to} backLabel={`回到${back.label}`} />
        </>
      )}
      {set && <TranslationAttempt key={set.exam_id} set={set} />}
    </article>
  );
}

function emptyDraft(set: TranslationSet): TranslationDraft {
  return { texts: set.items.map(() => ''), submissionId: null, checked: [], errorCounts: set.items.map(() => 0), updatedAt: 0 };
}

/** 讀出的草稿句數和題目不同（資料更新過）時補齊或截斷。 */
function fitDraft(draft: TranslationDraft, set: TranslationSet): TranslationDraft {
  const n = set.items.length;
  return {
    ...draft,
    texts: Array.from({ length: n }, (_, i) => draft.texts[i] ?? ''),
    errorCounts: Array.from({ length: n }, (_, i) => draft.errorCounts[i] ?? 0),
  };
}

function TranslationAttempt({ set }: { set: TranslationSet }) {
  const navigate = useNavigate();
  const groupId = groupIdOf(set);
  const key = draftKey('translation', groupId);
  const [draft, setDraft] = useState<TranslationDraft>(() => {
    const saved = loadDraft(key, isTranslationDraft);
    return saved ? fitDraft(saved, set) : emptyDraft(set);
  });
  const { ok: saved } = useAutosave(key, draft);
  const access = useAiAccess();
  const errorView = useErrorView();
  const { quota, refresh: refreshQuota } = useQuota(access.state === 'ready');
  const [selfOpen, setSelfOpen] = useState(false);
  const selfPanel = useRevealOnOpen(selfOpen);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const checks = draft.texts.map(checkTranslationSentence);
  const allFilled = checks.every((c) => !c.empty);
  const anyTooLong = checks.some((c) => c.tooLong);
  const aiSupported = isAiGradableTranslation(set);
  const title = `${examRefLabel(set)} 中譯英`;

  const update = (patch: Partial<TranslationDraft>) => setDraft((d) => ({ ...d, ...patch, updatedAt: Date.now() }));
  const setText = (i: number, text: string) => setDraft((d) => ({ ...d, texts: d.texts.map((t, j) => (j === i ? text : t)), updatedAt: Date.now() }));

  const submitAi = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body: TranslationBody = {
        items: set.items.map((item, i) => ({ item_id: translationItemId(set, item), text: (draft.texts[i] ?? '').trim() })),
      };
      // 有做自我檢核（勾過清單或記了錯誤數）才附上自評；沒做就不送，結果頁不會出現假的「自評 8 分」。
      const selfAssessed = draft.checked.length > 0 || draft.errorCounts.some((n) => n > 0);
      const selfAssess: SelfAssessment | null = selfAssessed ? { kind: 'translation', sentence_scores: draft.errorCounts.map(selfScoreOf) } : null;
      const submission = await upsertSubmission(draft.submissionId, { kind: 'translation', group_id: groupId, input_mode: 'typed', body }, { body });
      // 先記下 id：下一步失敗（額度不足、網路）時重送沿用同一份。
      setDraft((d) => ({ ...d, submissionId: submission.id }));
      // 自評（看分數前）：失敗不影響批改。
      await saveSelfAssessment(submission.id, selfAssess).catch(() => undefined);
      await startTask('translation-grade', submission.id);
      // 送出後草稿保留文字（想修改再練一次），但下次要建立新的提交。
      setDraft((d) => ({ ...d, submissionId: null }));
      navigate(`/writing/submissions/${encodeURIComponent(submission.id)}`);
    } catch (err) {
      if (err instanceof AlreadySubmittedError) {
        // 上一次其實已經送出（回應遺失）：直接看那一份的進度，不再送一次、不再扣點。
        setDraft((d) => ({ ...d, submissionId: null }));
        navigate(`/writing/submissions/${encodeURIComponent(err.submission.id)}`);
        return;
      }
      const q = isQuotaError(err) ? await refreshQuota() : quota;
      setError(await errorView(err, { quota: q, submitting: true }));
      setSubmitting(false);
    }
  };

  const clearAll = () => {
    clearDraft(key);
    setDraft(emptyDraft(set));
    setError(null);
  };

  return (
    <div className="space-y-4">
      <header>
        <title>{`${title}｜寫作練習｜${APP_NAME}`}</title>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{set.title}</span>
          {set.session === 'makeup' && <span className="rounded-full bg-badge-bg px-2 py-0.5 text-xs font-semibold text-badge-fg">補考</span>}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
        {set.instructions && <p className="mt-2 whitespace-pre-line text-[0.95rem]">{set.instructions}</p>}
      </header>

      {set.passage && (
        <section aria-label="題組短文" className={`${card} text-[0.95rem]`}>
          <RichText text={set.passage} />
        </section>
      )}

      {set.items.map((item, i) => {
        const text = draft.texts[i] ?? '';
        const check = checks[i];
        const id = `t-input-${i}`;
        const hints = check && !check.empty ? mechanicsMessages(check.mechanics) : [];
        return (
          <section key={item.label} aria-labelledby={`${id}-label`} className={card}>
            <h2 id={`${id}-label`} className="flex flex-wrap items-baseline gap-2 font-semibold">
              第 {i + 1} 句{item.points !== null && <span className="text-sm font-normal text-muted">（{item.points} 分）</span>}
            </h2>
            <p className="mt-1 text-lg">{item.stem}</p>
            <label htmlFor={id} className="mt-3 block text-sm text-muted">
              {/* 讀屏在作答框之間移動時要聽得出是第幾句 */}
              <span className="sr-only">第 {i + 1} 句</span>英文譯文
            </label>
            <textarea
              id={id}
              rows={3}
              maxLength={TRANSLATION_SENTENCE_MAX_CHARS}
              value={text}
              onChange={(e) => setText(i, e.currentTarget.value)}
              aria-describedby={`${id}-count`}
              className={`mt-1 ${textInput}`}
              {...englishInputProps}
            />
            <p id={`${id}-count`} className="mt-1 flex flex-wrap justify-between gap-x-3 text-sm text-muted">
              <span className={hints.length > 0 ? 'text-bad' : ''}>{hints.length > 0 ? `提醒：${hints.join('；')}` : ''}</span>
              <span className={`tabular-nums ${text.length >= TRANSLATION_SENTENCE_MAX_CHARS ? 'text-bad' : ''}`}>
                {text.length}／{TRANSLATION_SENTENCE_MAX_CHARS} 字元
              </span>
            </p>
            {item.patterns.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer py-3 text-primary">提示：這句可能用到的句型（本站標註）</summary>
                <ul className="mt-1 list-disc pl-5 text-muted">
                  {item.patterns.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}

      <p className="text-sm text-muted" role="status">
        {saved ? '草稿會自動存在這台裝置。' : '這個瀏覽器無法儲存草稿（可能是無痕模式），離開頁面後內容會遺失。'}
      </p>

      <section aria-label="送出" className={`space-y-3 ${card}`}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryButton} aria-expanded={selfOpen} aria-controls="t-self-check" onClick={() => setSelfOpen((v) => !v)}>
            {selfOpen ? '收起自我檢核' : '自我檢核（不用 AI）'}
          </button>
          {access.state === 'ready' && aiSupported && (
            <button type="button" className={primaryButton} disabled={submitting || !allFilled || anyTooLong} onClick={submitAi}>
              {submitting ? '送出中…' : `送出 AI 批改（${taskPoints(quota, 'translation_grade')} 點）`}
            </button>
          )}
        </div>
        {access.state === 'ready' && aiSupported && (
          <>
            <AiNotice />
            <QuotaSummary quota={quota} />
            {!allFilled && <p className="text-sm text-muted">每一句都寫完才能送出 AI 批改。</p>}
          </>
        )}
        {access.state === 'ready' && !aiSupported && (
          <Notice>
            <p>
              這組是舊制（{set.items.length} 句、每句 {set.items[0]?.points ?? '—'} 分）。AI 批改只支援現制的兩句一組、每句 4 分，這組請用自我檢核練習。
            </p>
          </Notice>
        )}
        {access.state !== 'ready' && <AiAccessNotice access={access} compact />}
        {error && <ErrorMessage view={error} />}
        <div className="flex justify-end">
          <ConfirmButton
            label="清除重寫"
            question="確定要清除這組的作答與自評嗎？"
            confirmLabel="確定清除"
            onConfirm={clearAll}
            disabled={submitting}
            doneMessage="已清除這組的作答與自評。"
          />
        </div>
      </section>

      {selfOpen && (
        // 打開後捲到面板並把焦點移過去：手機上面板在送出卡片下方，常常落在底部導覽列後面，看起來像沒反應。
        <div id="t-self-check" ref={selfPanel} tabIndex={-1} className="scroll-mt-20 focus:outline-none">
          <TranslationSelfCheck
            texts={draft.texts}
            checked={draft.checked}
            errorCounts={draft.errorCounts}
            maxPoints={set.items.map((item) => item.points ?? TRANSLATION_SENTENCE_MAX)}
            onToggle={(id) => update({ checked: draft.checked.includes(id) ? draft.checked.filter((x) => x !== id) : [...draft.checked, id] })}
            onErrorCount={(i, n) => update({ errorCounts: draft.errorCounts.map((c, j) => (j === i ? n : c)) })}
          />
        </div>
      )}

      <SourceNote exam={set} extra="（中譯英只整理中文題目）" />
    </div>
  );
}
