/**
 * 每日學習（間隔重複）：今日進度、學習設定與翻卡複習。
 *
 * 流程：開始 → 依 buildStudyQueue 排好「先複習到期的字、再學新字」→ 每張卡先看英文（正面），
 * 想好意思再翻到背面（釋義與例句）→ 用四個鈕評分（重來／困難／良好／簡單），ts-fsrs 決定下次出現的時間。
 * 每評一次分就寫回 localStorage，中途關掉頁面也不會丟掉已評分的進度。
 *
 * 鍵盤：空白鍵或 Enter 翻卡、1–4 評分（只有這個分頁顯示中、而且焦點不在輸入框時才生效）。
 */
import { Flame, Undo2 } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Rating, type Grade } from 'ts-fsrs';
import { forgetFailedLoads } from '../../../data/client';
import { levelFromEntryId, VOCAB_TIERS, type VocabEntry, type VocabLevel } from '../../../data/vocab';
import { buildFormMap } from '../lib/forms';
import { feedbackExample } from '../lib/quiz';
import {
  advanceQueue,
  buildStudyQueue,
  DAILY_NEW_CHOICES,
  formatInterval,
  previewDue,
  rateCard,
  SRS_GRADES,
  studySummary,
  updateSettings,
  type SrsCandidate,
} from '../lib/srs';
import { formatCount, posText, zhSenseLabel } from '../lib/text';
import { entriesById, fetchIndex, fetchLevels, peekIndex } from '../lib/vocabData';
import { getSrsStore, useSrs } from '../state';
import { EmptyState, ErrorBlock, LevelBadge, LoadingBlock, SpeakButton, StorageNotice, WordLink } from '../ui/common';
import { ExampleSentence } from '../ui/ExampleSentence';
import { LevelPicker } from '../ui/LevelPicker';
import { btnPrimary, btnText, cardCls, fieldCls, labelCls, sectionTitleCls } from '../ui/styles';
import { useLoad } from '../ui/useLoad';

type Session =
  | { phase: 'loading' }
  | { phase: 'error'; error: unknown }
  | { phase: 'running'; queue: string[]; entries: Map<string, VocabEntry>; done: number; revealed: boolean }
  | { phase: 'finished'; done: number };

/** 鍵盤快捷鍵只在焦點不在輸入元件時生效，免得在別的欄位打字時誤觸。 */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3 sm:p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1 text-2xl font-bold">
        {icon}
        {value}
      </dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function StudySettings({ candidates }: { candidates: readonly SrsCandidate[] }) {
  const srs = useSrs();
  const settings = srs.value.settings;
  // 依目前設定算「還要幾天學完」：原本寫死「L3–5 共 3,006 個字，每天 10 個約需 301 天」，改了範圍或每日字數就對不上。
  const inRange = candidates.filter((c) => settings.levels.includes(c.level));
  const unlearned = inRange.filter((c) => !srs.value.cards[c.id]).length;
  const dailyId = useId();
  const [levelWarning, setLevelWarning] = useState(false);
  // 存檔裡的數字不在預設選項時（例如之後的版本開放自訂）也要列出來，下拉選單才不會顯示錯的值。
  const choices = [...new Set<number>([...DAILY_NEW_CHOICES, settings.daily_new])].sort((a, b) => a - b);
  return (
    <section className={cardCls} aria-labelledby={`${dailyId}-title`}>
      <h2 id={`${dailyId}-title`} className={sectionTitleCls}>
        學習設定
      </h2>
      <div className="mt-3 space-y-4">
        <div className="max-w-xs">
          <label htmlFor={dailyId} className={labelCls}>
            每日新字數
          </label>
          <select
            id={dailyId}
            value={settings.daily_new}
            onChange={(e) => getSrsStore().update((s) => updateSettings(s, { daily_new: Number(e.target.value) }, Date.now()))}
            className={fieldCls}
          >
            {choices.map((n) => (
              <option key={n} value={n}>
                {n} 個
              </option>
            ))}
          </select>
        </div>
        <LevelPicker
          legend="新字的學習範圍"
          value={settings.levels}
          onChange={(levels: VocabLevel[]) => {
            // 至少要留一個級別，不然每天都沒有新字可學。
            if (levels.length === 0) {
              setLevelWarning(true);
              return;
            }
            setLevelWarning(false);
            getSrsStore().update((s) => updateSettings(s, { levels }, Date.now()));
          }}
          hint={levelWarning ? '至少要選一個級別。' : undefined}
        />
        <ul className="space-y-1 text-sm text-muted">
          {VOCAB_TIERS.map((t) => (
            <li key={t.id}>
              <span className="font-medium text-fg">
                {t.label}（L{t.levels.join('、L')}）
              </span>
              ：{t.description}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          新字依歷屆學測、指考出現次數由多到少排入；到期的複習不受學習範圍影響。
          {inRange.length > 0 &&
            (unlearned > 0
              ? `目前範圍（L${settings.levels.join('、L')}）共 ${formatCount(inRange.length)} 個字，還沒學的 ${formatCount(unlearned)} 個，每天 ${settings.daily_new} 個約需 ${formatCount(Math.ceil(unlearned / settings.daily_new))} 天。`
              : `目前範圍（L${settings.levels.join('、L')}）的 ${formatCount(inRange.length)} 個字都學過了，可以再加入其他級別。`)}
        </p>
      </div>
    </section>
  );
}

function CardBack({ entry, answerRef }: { entry: VocabEntry; answerRef: RefObject<HTMLDivElement | null> }) {
  const forms = useMemo(() => buildFormMap(entry), [entry]);
  const example = feedbackExample(entry);
  const senses = entry.zh.filter((z) => z.match);
  return (
    <div ref={answerRef} tabIndex={-1} className="space-y-3 border-t border-line pt-4 focus:outline-none" aria-label="答案">
      {entry.ipa && <p className="text-center text-muted">/{entry.ipa}/</p>}
      <ul className="space-y-1">
        {(senses.length > 0 ? senses : entry.zh.slice(0, 1)).map((z, i) => {
          const label = zhSenseLabel(z);
          return (
            <li key={i} className="flex gap-2">
              {label && <span className="shrink-0 rounded bg-surface-2 px-1.5 text-sm leading-7 text-muted">{label}</span>}
              <span className="min-w-0 break-words">{z.text}</span>
            </li>
          );
        })}
      </ul>
      {example && <ExampleSentence example={example} forms={forms} />}
      <WordLink id={entry.id} className={btnText}>
        看完整單字卡
      </WordLink>
    </div>
  );
}

function StudyCard({
  entry,
  isNew,
  revealed,
  remaining,
  onReveal,
  onRate,
}: {
  entry: VocabEntry;
  isNew: boolean;
  revealed: boolean;
  remaining: number;
  onReveal: () => void;
  onRate: (grade: Grade) => void;
}) {
  const srs = useSrs();
  const revealRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const gradesRef = useRef<HTMLDivElement>(null);
  // 評分鈕上的「下次出現」：在翻開的那一刻算一次，按鈕不會隨時間跳動。
  const [now] = useState(() => new Date());
  const preview = useMemo(() => previewDue(srs.value.cards[entry.id], now), [srs.value.cards, entry.id, now]);

  // 焦點管理：翻開後移到答案區（螢幕閱讀器從答案開始唸），換新卡時回到「顯示答案」。
  // 手機上答案加例句比一個畫面長，翻開後把評分鈕捲進畫面，學生看完就能直接按，不用自己往下找。
  useEffect(() => {
    if (revealed) {
      answerRef.current?.focus({ preventScroll: true });
      gradesRef.current?.scrollIntoView?.({ block: 'nearest' });
    } else {
      revealRef.current?.focus();
    }
  }, [revealed, entry.id]);

  return (
    <article className={cardCls} aria-label="學習卡片">
      <div className="flex items-center justify-between gap-2 text-sm text-muted">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isNew ? 'bg-badge-bg text-badge-fg' : 'bg-primary-soft text-primary'}`}>
          {isNew ? '新字' : '複習'}
        </span>
        <span>還有 {remaining} 張</span>
      </div>
      <div className="flex flex-col items-center gap-1 py-6 text-center">
        <p lang="en" className="max-w-full text-4xl font-bold break-words">
          {entry.word}
        </p>
        <p className="flex items-center gap-2 text-muted">
          <span lang="en">{posText(entry.pos)}</span>
          <LevelBadge level={entry.level} />
        </p>
        <SpeakButton text={entry.word} />
      </div>
      {!revealed ? (
        <button ref={revealRef} type="button" onClick={onReveal} className={`${btnPrimary} w-full scroll-mt-20 scroll-mb-24 lg:scroll-mb-6`}>
          顯示答案
        </button>
      ) : (
        <>
          <CardBack entry={entry} answerRef={answerRef} />
          <div
            ref={gradesRef}
            role="group"
            aria-label="評分：這個字記得多熟？"
            className="mt-4 grid scroll-mb-24 grid-cols-2 gap-2 sm:grid-cols-4 lg:scroll-mb-6"
          >
            {SRS_GRADES.map((g) => (
              <button
                key={g.grade}
                type="button"
                onClick={() => onRate(g.grade)}
                aria-keyshortcuts={g.key}
                className={`flex min-h-14 flex-col items-center justify-center rounded-xl border px-2 py-1.5 font-medium hover:bg-surface-2 ${
                  g.grade === Rating.Again ? 'border-bad text-bad' : 'border-line'
                }`}
              >
                <span>{g.label}</span>
                <span className="text-xs font-normal text-muted">{formatInterval(preview[g.grade] - now.getTime())}後</span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="mt-3 hidden text-center text-xs text-muted sm:block">快捷鍵：空白鍵翻卡，1–4 評分</p>
    </article>
  );
}

export function StudyView({ active }: { active: boolean }) {
  const srs = useSrs();
  const index = useLoad('vocab-index', peekIndex, fetchIndex);
  const [session, setSession] = useState<Session | null>(null);
  // 進度數字依「現在」計算；每分鐘更新一次，學習中的卡片到期時「待複習」數會跟著變。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active, session?.phase]);

  const indexEntries = index.status === 'ready' ? index.value.entries : null;
  const candidates = useMemo<SrsCandidate[]>(
    () => (indexEntries ?? []).map((e) => ({ id: e.id, level: e.level, exam_total: e.exam_total })),
    [indexEntries],
  );
  const summary = studySummary(srs.value, candidates, now);
  const queueLength = summary.dueNow + summary.newToday;

  const start = async () => {
    const t = Date.now();
    const queue = buildStudyQueue(srs.value, candidates, t);
    if (queue.length === 0) return;
    const levels = [...new Set(queue.map(levelFromEntryId).filter((l): l is VocabLevel => l !== null))];
    setSession({ phase: 'loading' });
    // 使用者按「開始」或「再試一次」：之前失敗的下載要重新抓，不沿用快取裡的失敗結果。
    forgetFailedLoads();
    try {
      const entries = entriesById(await fetchLevels(levels));
      // 資料改版後對不到的 id（極少見）直接略過，不讓整輪學習卡住。
      const valid = queue.filter((id) => entries.has(id));
      setSession(valid.length > 0 ? { phase: 'running', queue: valid, entries, done: 0, revealed: false } : { phase: 'finished', done: 0 });
    } catch (error) {
      setSession({ phase: 'error', error });
    }
  };

  const reveal = () => setSession((s) => (s?.phase === 'running' ? { ...s, revealed: true } : s));

  const rate = (grade: Grade) => {
    if (session?.phase !== 'running') return;
    const id = session.queue[0];
    if (!id) return;
    const at = new Date();
    const store = getSrsStore();
    const next = rateCard(store.getSnapshot().value, id, grade, at);
    store.update(() => next);
    const queue = advanceQueue(session.queue, id, next, at.getTime());
    setSession(
      queue.length > 0
        ? { ...session, queue, done: session.done + 1, revealed: false }
        : { phase: 'finished', done: session.done + 1 },
    );
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (session?.phase !== 'running' || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
    if (!session.revealed && (e.key === ' ' || e.key === 'Enter')) {
      // 焦點在按鈕上時，空白鍵／Enter 本來就會按下按鈕，不要再翻一次。
      if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      e.preventDefault();
      reveal();
      return;
    }
    const grade = SRS_GRADES.find((g) => g.key === e.key);
    if (session.revealed && grade) {
      e.preventDefault();
      rate(grade.grade);
    }
  });
  useEffect(() => {
    if (!active || session?.phase !== 'running') return;
    const handler = (e: KeyboardEvent) => onKey(e);
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, session?.phase]);

  if (session?.phase === 'loading') return <LoadingBlock label="正在準備今天的單字…" />;
  if (session?.phase === 'error') {
    return <ErrorBlock error={session.error} onRetry={() => void start()} title="單字資料載入失敗" />;
  }
  if (session?.phase === 'running') {
    const id = session.queue[0];
    const entry = id ? session.entries.get(id) : undefined;
    if (!entry) return null;
    const card = srs.value.cards[entry.id];
    return (
      <div className="space-y-3">
        <StudyCard
          key={`${entry.id}:${session.done}`}
          entry={entry}
          isNew={!card || card.state === 0}
          revealed={session.revealed}
          remaining={session.queue.length}
          onReveal={reveal}
          onRate={rate}
        />
        <button type="button" onClick={() => setSession(null)} className={btnText}>
          <Undo2 aria-hidden="true" className="size-4" />
          先停在這裡（已評分的進度都已儲存）
        </button>
        <StorageNotice mode={srs.mode} saveFailed={srs.saveFailed} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {session?.phase === 'finished' && (
        <p role="status" className="rounded-xl bg-primary-soft px-4 py-3 text-primary">
          這一輪完成了！共評分 {session.done} 次。
        </p>
      )}
      <section className={cardCls} aria-labelledby="study-today">
        <h2 id="study-today" className={sectionTitleCls}>
          今日進度
        </h2>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="待複習" value={String(summary.dueToday)} hint={summary.dueToday > summary.dueNow ? `${summary.dueNow} 張已到期` : undefined} />
          <Stat label="新字" value={String(summary.newToday)} hint={`今天已學 ${summary.newDone} 個`} />
          <Stat
            label="連續學習"
            value={`${summary.streak} 天`}
            icon={<Flame aria-hidden="true" className={`size-5 ${summary.streak > 0 ? 'text-badge-fg' : 'text-muted'}`} />}
            hint={summary.longestStreak > summary.streak ? `最長 ${summary.longestStreak} 天` : undefined}
          />
        </dl>
        <p className="mt-3 text-sm text-muted">
          已學過 {summary.learned} 個字；今天複習了 {summary.reviewsDone} 次。
        </p>
        <div className="mt-4">
          {index.status === 'error' ? (
            <ErrorBlock error={index.error} onRetry={index.retry} title="單字表載入失敗" />
          ) : index.status === 'loading' ? (
            <LoadingBlock label="正在載入單字表…" />
          ) : queueLength > 0 ? (
            <button type="button" onClick={() => void start()} className={`${btnPrimary} w-full sm:w-auto`}>
              開始學習（{queueLength} 張）
            </button>
          ) : (
            <EmptyState title="今天的進度完成了！">
              <p>
                {summary.dueToday > 0
                  ? `還有 ${summary.dueToday} 張會在今天稍晚到期，到時候再回來。`
                  : '明天再來複習；想多練習可以到「測驗」分頁，或在單字卡按「加入每日學習」。'}
              </p>
            </EmptyState>
          )}
        </div>
      </section>
      <StorageNotice mode={srs.mode} saveFailed={srs.saveFailed} />
      <StudySettings candidates={candidates} />
    </div>
  );
}
