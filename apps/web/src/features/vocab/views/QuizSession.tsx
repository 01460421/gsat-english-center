/**
 * 測驗的執行：載入資料並出題（useQuizLauncher）、逐題作答與立即回饋、結束時的成績與錯題清單（QuizSession）。
 * 「測驗」分頁與「錯題本」分頁共用。
 *
 * 每答一題就寫入錯題本（不是等整份做完），中途離開也不會漏記答錯的字。
 * 鍵盤：選擇題按 1–4 作答；答完後焦點移到「下一題」，按 Enter 繼續。
 */
import { CircleCheck, CircleX, RotateCcw } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { dataErrorMessage, forgetFailedLoads } from '../../../data/client';
import { levelFromEntryId, type VocabLevel } from '../../../data/vocab';
import { recordAnswer } from '../lib/mistakes';
import { buildFormMap } from '../lib/forms';
import {
  buildQuiz,
  correctAnswerText,
  createQuizPool,
  gradeSpelling,
  isChoiceCorrect,
  quizModeLabel,
  type ChoiceQuestion,
  type ClozeQuestion,
  type QuizMode,
  type QuizQuestion,
  type SpellingQuestion,
} from '../lib/quiz';
import { createRng, randomSeed } from '../lib/random';
import { SPELLING_MAX_LEVEL } from '../lib/spelling';
import { posLabel, posText } from '../lib/text';
import { entriesById, fetchLevels } from '../lib/vocabData';
import { getMistakeStore } from '../state';
import { SpeakButton, WordLink } from '../ui/common';
import { ExampleAttribution, ExampleSentence, HighlightedSentence } from '../ui/ExampleSentence';
import { btnPrimary, btnSecondary, btnText, cardCls, fieldCls, labelCls, sectionTitleCls } from '../ui/styles';

// ---------------------------------------------------------------------------
// 出題
// ---------------------------------------------------------------------------

export interface QuizConfig {
  mode: QuizMode;
  /** 出題範圍（targets 有給時不用）。 */
  levels: readonly VocabLevel[];
  /** 指定要考的字（錯題練習），依序出題。 */
  targets?: readonly string[];
  /** 錯題本練習：答對的字移出錯題本。 */
  practice: boolean;
}

export type LaunchState =
  | { phase: 'idle' }
  | { phase: 'loading'; config: QuizConfig }
  | { phase: 'error'; config: QuizConfig; error: unknown }
  | { phase: 'empty'; config: QuizConfig; reason: string }
  | { phase: 'running'; config: QuizConfig; questions: QuizQuestion[]; runId: number };

function quizLevels(config: QuizConfig): VocabLevel[] {
  if (config.targets) {
    return [...new Set(config.targets.map(levelFromEntryId).filter((l): l is VocabLevel => l !== null))];
  }
  return config.mode === 'spelling' ? config.levels.filter((l) => l <= SPELLING_MAX_LEVEL) : [...config.levels];
}

function emptyReason(config: QuizConfig): string {
  if (config.targets) {
    return config.mode === 'spelling'
      ? '這些字沒有可以出拼字題的（拼字只出 Level 1–4 的一般單字），換個題型試試。'
      : '這些字目前沒辦法出這種題型（例如沒有可挖空的例句），換個題型試試。';
  }
  if (config.mode === 'spelling') return '拼字題只出 Level 1–4，請在出題範圍勾選 L1–L4 其中至少一級。';
  return '請至少選一個級別。';
}

export function useQuizLauncher() {
  const [state, setState] = useState<LaunchState>({ phase: 'idle' });
  // 連按兩次「開始」或在載入中換題型時，只採用最後一次的結果。
  const launchId = useRef(0);

  const launch = async (config: QuizConfig) => {
    const id = ++launchId.current;
    const levels = quizLevels(config);
    if (levels.length === 0) {
      setState({ phase: 'empty', config, reason: emptyReason(config) });
      return;
    }
    setState({ phase: 'loading', config });
    // 每次開始都是使用者按的（開始、再試一次、再來一輪），之前失敗的下載要重新抓，不沿用快取裡的失敗結果。
    forgetFailedLoads();
    try {
      const entries = await fetchLevels(levels);
      if (id !== launchId.current) return;
      const byId = entriesById(entries);
      const targets = config.targets?.flatMap((t) => {
        const e = byId.get(t);
        return e ? [e] : [];
      });
      const questions = buildQuiz({
        mode: config.mode,
        pool: createQuizPool(entries),
        rng: createRng(randomSeed()),
        ...(targets ? { targets } : {}),
      });
      setState(
        questions.length > 0
          ? { phase: 'running', config, questions, runId: id }
          : { phase: 'empty', config, reason: emptyReason(config) },
      );
    } catch (error) {
      if (id === launchId.current) setState({ phase: 'error', config, error });
    }
  };

  const reset = () => {
    launchId.current += 1;
    setState({ phase: 'idle' });
  };

  return { state, launch, reset };
}

// ---------------------------------------------------------------------------
// 作答
// ---------------------------------------------------------------------------

interface AnswerState {
  correct: boolean;
  /** 學生的答案（選項文字或拼字輸入），錯題清單用。 */
  response: string;
  /** 選擇題選了第幾個。 */
  choice: number | null;
  nearMiss: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function posLabels(q: QuizQuestion): string {
  return q.pos.map(posLabel).join('、');
}

function ChoiceList({ q, answer, onChoose }: { q: ChoiceQuestion; answer: AnswerState | undefined; onChoose: (i: number) => void }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2" aria-label="選項">
      {q.options.map((o, i) => {
        const isAnswer = i === q.answerIndex;
        const isChosen = answer?.choice === i;
        const tone = !answer
          ? 'border-line hover:border-primary hover:bg-primary-soft'
          : isAnswer
            ? 'border-ok bg-ok/10'
            : isChosen
              ? 'border-bad bg-bad/10'
              : 'border-line text-muted';
        return (
          <li key={`${o.entryId}:${i}`} className="min-w-0">
            <button
              type="button"
              onClick={() => {
                if (!answer) onChoose(i);
              }}
              aria-disabled={answer ? true : undefined}
              aria-keyshortcuts={String(i + 1)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left ${tone} ${answer ? 'cursor-default' : ''}`}
            >
              <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold text-muted">
                {i + 1}
              </span>
              <span lang={q.mode === 'en2zh' ? undefined : 'en'} className="min-w-0 flex-1 break-words">
                {o.text}
              </span>
              {answer && isAnswer && (
                <>
                  <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-ok" />
                  <span className="sr-only">（正解）</span>
                </>
              )}
              {answer && isChosen && !isAnswer && (
                <>
                  <CircleX aria-hidden="true" className="size-5 shrink-0 text-bad" />
                  <span className="sr-only">（你的答案）</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ClozeSentence({ q, answered }: { q: ClozeQuestion; answered: boolean }) {
  if (answered) {
    return (
      <p lang="en" className="text-xl break-words">
        <HighlightedSentence parts={q.parts} />
      </p>
    );
  }
  return (
    <p lang="en" className="text-xl break-words">
      {q.parts.map((p, i) =>
        p.target ? (
          <span key={i}>
            <span aria-hidden="true" className="mx-1 inline-block w-20 border-b-2 border-fg align-baseline">
              {' '}
            </span>
            <span lang="zh-Hant-TW" className="sr-only">
              （空格）
            </span>
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

function Prompt({ q, answered }: { q: QuizQuestion; answered: boolean }) {
  switch (q.mode) {
    case 'en2zh':
      return (
        <div className="flex flex-col items-center gap-1 py-2 text-center">
          <p className="text-sm text-muted">選出正確的中文意思</p>
          <p lang="en" className="max-w-full text-4xl font-bold break-words">
            {q.word}
          </p>
          <p lang="en" className="text-muted">
            {posText(q.pos)}
          </p>
          <SpeakButton text={q.word} />
        </div>
      );
    case 'zh2en':
      return (
        <div className="py-2 text-center">
          <p className="text-sm text-muted">選出符合這個意思的英文單字</p>
          <p className="mt-1 text-2xl font-bold break-words">{q.gloss}</p>
          <p className="text-muted">{posLabels(q)}</p>
        </div>
      );
    case 'spelling':
      return (
        <div className="py-2 text-center">
          <p className="text-sm text-muted">拼出這個英文單字</p>
          <p className="mt-1 text-2xl font-bold break-words">{q.gloss}</p>
          <p className="text-muted">{posLabels(q)}</p>
          <p aria-hidden="true" lang="en" className="mt-3 font-mono text-2xl tracking-[0.25em] break-all">
            {q.hint.first}
            {'_'.repeat(Math.max(0, q.hint.length - 1))}
          </p>
          <p className="mt-1 text-sm text-muted">
            提示：開頭是「<span lang="en">{q.hint.first}</span>」，共 {q.hint.length} 個字母
          </p>
        </div>
      );
    case 'cloze':
      return (
        <div className="space-y-2 py-2">
          <p className="text-sm text-muted">選出最適合填入空格的字</p>
          <ClozeSentence q={q} answered={answered} />
          {q.blankIsInflected && !answered && <p className="text-sm text-muted">提示：空格裡的字有詞形變化，選項列的是原形。</p>}
          {answered && <p className="text-muted">{q.example.zh}</p>}
          {answered && <ExampleAttribution example={q.example} />}
        </div>
      );
  }
}

function SpellingInput({ q, answer, onSubmit }: { q: SpellingQuestion; answer: AnswerState | undefined; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, [q.key]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!answer && value.trim()) onSubmit(value);
      }}
      className="space-y-2"
    >
      <label htmlFor={inputId} className={labelCls}>
        你的答案
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          id={inputId}
          lang="en"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={Boolean(answer)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          className={`${fieldCls} flex-1 basis-48 scroll-mt-20 scroll-mb-24 text-lg ${answer ? (answer.correct ? 'border-ok' : 'border-bad') : ''}`}
        />
        {!answer && (
          <div className="flex gap-2">
            <button type="submit" disabled={!value.trim()} className={btnPrimary}>
              送出
            </button>
            <button type="button" onClick={() => onSubmit('')} className={btnSecondary}>
              不知道
            </button>
          </div>
        )}
      </div>
    </form>
  );
}

function Feedback({ q, answer }: { q: QuizQuestion; answer: AnswerState }) {
  const forms = useMemo(() => buildFormMap({ word: q.word, pos: q.pos, forms: q.forms }), [q]);
  const chosen = q.mode !== 'spelling' && answer.choice !== null && !answer.correct ? q.options[answer.choice] : undefined;
  return (
    <div className={`space-y-2 rounded-xl border-l-4 bg-surface-2 p-4 ${answer.correct ? 'border-ok' : 'border-bad'}`}>
      <p className={`font-semibold ${answer.correct ? 'text-ok' : 'text-bad'}`}>
        {answer.correct ? '答對了！' : answer.nearMiss ? '差一點！只差一個字母。' : '答錯了'}
      </p>
      <p className="break-words">
        正解：
        <strong lang="en" className="text-lg">
          {q.word}
        </strong>
        <span lang="en" className="mx-1 text-muted">
          {posText(q.pos)}
        </span>
        {q.gloss}
      </p>
      {q.mode === 'spelling' && !answer.correct && (
        <p className="break-words">
          你的答案：{answer.response ? <span lang="en">{answer.response}</span> : '（沒有作答）'}
        </p>
      )}
      {chosen && (
        <p className="break-words text-muted">
          {q.mode === 'en2zh' ? (
            <>
              你選的意思屬於 <strong lang="en">{chosen.word}</strong>。
            </>
          ) : (
            <>
              <strong lang="en">{chosen.word}</strong> 的意思是「{chosen.gloss}」。
            </>
          )}
        </p>
      )}
      {q.mode !== 'cloze' && q.example && (
        <div className="border-t border-line pt-2">
          <ExampleSentence example={q.example} forms={forms} />
        </div>
      )}
      <WordLink id={q.entryId} className={btnText}>
        查看單字卡
      </WordLink>
    </div>
  );
}

/** 給螢幕閱讀器的作答結果（aria-live）。帶題號：連續兩題都答對時，文字不同才會再唸一次。 */
function feedbackAnnouncement(n: number, q: QuizQuestion, answer: AnswerState): string {
  return answer.correct ? `第 ${n} 題答對了。` : `第 ${n} 題答錯了，正解是 ${correctAnswerText(q)}。`;
}

// ---------------------------------------------------------------------------
// 成績
// ---------------------------------------------------------------------------

function Results({
  config,
  questions,
  answers,
  onRestart,
  onRetryWrong,
  onExit,
  exitLabel,
}: {
  config: QuizConfig;
  questions: QuizQuestion[];
  answers: (AnswerState | undefined)[];
  onRestart: () => void;
  onRetryWrong: (ids: string[]) => void;
  onExit: () => void;
  exitLabel: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: false }), []);
  const score = answers.filter((a) => a?.correct).length;
  const wrong = questions.flatMap((q, i) => {
    const a = answers[i];
    return a && !a.correct ? [{ q, a }] : [];
  });
  const ratio = questions.length > 0 ? score / questions.length : 0;
  const message =
    ratio === 1 ? '全對，太厲害了！' : ratio >= 0.8 ? '很不錯！把錯的字再看一次就更穩了。' : ratio >= 0.5 ? '還可以，錯題再練一次會更熟。' : '這些字還不熟，先到每日學習多看幾次。';
  return (
    <section className={`${cardCls} space-y-4`} aria-labelledby="quiz-result-title">
      <div>
        <h2 id="quiz-result-title" ref={headingRef} tabIndex={-1} className={`${sectionTitleCls} focus:outline-none`}>
          測驗結果（{quizModeLabel(config.mode)}）
        </h2>
        <p className="mt-2 text-4xl font-bold">
          {score}
          <span className="text-xl text-muted">／{questions.length}</span>
        </p>
        <p className="mt-1">{message}</p>
      </div>
      {wrong.length > 0 && (
        <div>
          <h3 className="font-semibold">錯題{config.practice ? '' : '（已加入錯題本）'}</h3>
          <ul className="mt-2 divide-y divide-line">
            {wrong.map(({ q, a }) => (
              <li key={q.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <WordLink id={q.entryId} className="font-semibold text-primary underline-offset-2 hover:underline">
                  <span lang="en">{q.word}</span>
                </WordLink>
                <span className="min-w-0 break-words">{q.gloss}</span>
                <span className="text-sm break-words text-muted">
                  你的答案：
                  {a.response ? <span lang={q.mode === 'en2zh' ? undefined : 'en'}>{a.response}</span> : '（沒有作答）'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {config.practice && score > 0 && <p className="text-sm text-muted">答對的 {score} 個字已移出錯題本。</p>}
      <div className="flex flex-wrap gap-2">
        {wrong.length > 0 && (
          <button type="button" onClick={() => onRetryWrong(wrong.map((w) => w.q.entryId))} className={btnPrimary}>
            <RotateCcw aria-hidden="true" className="size-4" />
            再練一次錯題
          </button>
        )}
        <button type="button" onClick={onRestart} className={wrong.length > 0 ? btnSecondary : btnPrimary}>
          再來一輪
        </button>
        <button type="button" onClick={onExit} className={btnSecondary}>
          {exitLabel}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 主元件
// ---------------------------------------------------------------------------

export function QuizSession({
  config,
  questions,
  active,
  onRestart,
  onRetryWrong,
  onExit,
  exitLabel = '回到測驗設定',
}: {
  config: QuizConfig;
  questions: QuizQuestion[];
  /** 分頁顯示中才接收鍵盤快捷鍵。 */
  active: boolean;
  onRestart: () => void;
  onRetryWrong: (ids: string[]) => void;
  onExit: () => void;
  exitLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(AnswerState | undefined)[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const q = questions[index];
  const answer = answers[index];

  // 換題時把焦點移到題號（拼字題由輸入框自己拿焦點）；答完後移到「下一題」，Enter 就能繼續。
  // 手機上回饋與「下一題」常在畫面下方，要捲進畫面。不能只靠 focus() 順便捲動：按鈕只要有一部分在視窗內，
  // 瀏覽器就認為不必捲，結果按鈕被固定的底部導覽蓋住一半（拼字題實測如此）。改成明確 scrollIntoView，
  // 它會把 scroll-mb 算進去，捲到底部導覽之上。
  useEffect(() => {
    if (answer) {
      nextRef.current?.focus({ preventScroll: true });
      nextRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else if (q && q.mode !== 'spelling') {
      // 同樣的理由：題號可能卡在固定的頂端列底下，focus() 不會捲動；scroll-mt 讓它停在頂端列下方。
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [index, answer, q]);

  const submit = (a: AnswerState) => {
    if (!q || answers[index]) return;
    setAnswers((prev) => {
      const next = prev.slice();
      next[index] = a;
      return next;
    });
    getMistakeStore().update((book) =>
      recordAnswer(book, { entryId: q.entryId, word: q.word, mode: q.mode, correct: a.correct }, config.practice, Date.now()),
    );
  };

  const choose = (i: number) => {
    if (!q || q.mode === 'spelling') return;
    submit({ correct: isChoiceCorrect(q, i), response: q.options[i]?.text ?? '', choice: i, nearMiss: false });
  };

  const spell = (value: string) => {
    if (!q || q.mode !== 'spelling') return;
    const result = gradeSpelling(q, value);
    submit({ correct: result.correct, response: value.trim(), choice: null, nearMiss: result.nearMiss });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!q || q.mode === 'spelling' || answer || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      e.preventDefault();
      choose(n - 1);
    }
  });
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => onKey(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active]);

  if (!q) {
    return (
      <Results
        config={config}
        questions={questions}
        answers={answers}
        onRestart={onRestart}
        onRetryWrong={onRetryWrong}
        onExit={onExit}
        exitLabel={exitLabel}
      />
    );
  }

  const isLast = index === questions.length - 1;
  return (
    <section className={`${cardCls} space-y-4`} aria-labelledby="quiz-question-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="quiz-question-title" ref={headingRef} tabIndex={-1} className="scroll-mt-20 font-semibold focus:outline-none">
          第 {index + 1} 題<span className="text-muted">／共 {questions.length} 題</span>
        </h2>
        <span className="text-sm text-muted">{quizModeLabel(q.mode)}</span>
      </div>
      <div
        role="progressbar"
        aria-label="測驗進度"
        aria-valuemin={0}
        aria-valuemax={questions.length}
        aria-valuenow={answers.filter(Boolean).length}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full bg-primary transition-[width]" style={{ width: `${(answers.filter(Boolean).length / questions.length) * 100}%` }} />
      </div>
      <Prompt q={q} answered={Boolean(answer)} />
      {q.mode === 'spelling' ? (
        <SpellingInput key={q.key} q={q} answer={answer} onSubmit={spell} />
      ) : (
        <ChoiceList q={q} answer={answer} onChoose={choose} />
      )}
      <p aria-live="polite" className="sr-only">
        {answer ? feedbackAnnouncement(index + 1, q, answer) : ''}
      </p>
      {answer && <Feedback q={q} answer={answer} />}
      {answer && (
        <button
          ref={nextRef}
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          className={`${btnPrimary} w-full scroll-mb-24 sm:w-auto lg:scroll-mb-6`}
        >
          {isLast ? '看成績' : '下一題'}
        </button>
      )}
      {!answer && q.mode !== 'spelling' && <p className="hidden text-xs text-muted sm:block">快捷鍵：按 1–4 作答</p>}
    </section>
  );
}

/** 「開始」之後、題目出來之前的狀態（載入、錯誤、出不了題）。 */
export function LaunchStatus({ state, onRetry }: { state: LaunchState; onRetry: () => void }) {
  if (state.phase === 'loading') {
    return (
      <p role="status" className="text-muted">
        正在出題…（第一次測驗某個級別要先下載該級的單字資料）
      </p>
    );
  }
  if (state.phase === 'error') {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-bad">題目載入失敗：{dataErrorMessage(state.error)}</p>
        <button type="button" onClick={onRetry} className={btnSecondary}>
          <RotateCcw aria-hidden="true" className="size-4" />
          再試一次
        </button>
      </div>
    );
  }
  if (state.phase === 'empty') {
    return (
      <p role="alert" className="text-bad">
        {state.reason}
      </p>
    );
  }
  return null;
}
