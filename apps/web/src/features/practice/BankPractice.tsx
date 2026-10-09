/**
 * 一格（題型 × 難度）的題庫練習：載入題庫索引 → 從這一格抽一組（pick.ts）→ 載入題組 → 作答（PracticeSession.tsx）。
 * 兩個入口共用這一份，練習紀錄（history.ts 的 current、done）也是同一份，從哪裡進來都接著做同一組：
 *   - 作答頁 /practice/:section/:tier（PracticeSessionPage.tsx）：題組標題是頁面的 <h1> 與 <title>；
 *   - 題型頁 /vocabulary、/cloze…（SectionPractice.tsx，按需載入這個檔案）：上方多一列難度切換（網址 ?tier=），
 *     題組標題是 <h2>，頁面標題維持題型名稱。
 *
 * 抽到哪一組記在練習紀錄的 current：重新整理或離開再回來，接著做同一組；交卷後按「再一組」才換。
 * 切換難度只是換一格：每一格各自記著正在做的那一組與作答紀錄（exams/attempt.ts），切回來就接著做。
 *
 * 載入失敗分兩層：題庫索引失敗時整個練習區顯示錯誤與「再試一次」；某一組題組載入失敗時只有作答區顯示錯誤，
 * 難度切換照常可以用。
 */
import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, type To } from 'react-router';
import { forgetFailedLoads } from '../../data/client';
import {
  groupKey,
  loadBankIndex,
  loadPracticeGroup,
  type BankIndex,
  type PracticeGroupFile,
  type PracticeSectionType,
  type Tier,
} from '../../data/bank';
import { APP_NAME } from '../../modules';
import { clearAttempt, loadAttempt } from '../exams/attempt';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { cellKey, clearGroupRecords, getPracticeHistory, setCurrent, updatePracticeHistory, usePracticeHistory } from './history';
import { PRACTICE_SECTION_LABELS, TIER_AUDIENCE, TIER_LABELS, TIERS, practicePath } from './labels';
import { cellEntries, cellProgress, defaultTier, pickGroup, type Pick } from './pick';
import { GroupSession } from './PracticeSession';
import { practiceAttemptId, practiceAttemptIdForKey } from './practiceExam';

/** 題型頁內嵌時才有：難度切換的連結，以及網址沒指定難度時把選定的預設難度寫回網址。 */
export interface PracticeEmbed {
  /** 某個難度的連結（題型頁是 ?tier=…）。 */
  tierLink: (tier: Tier) => To;
  /** 網址沒有 ?tier= 時，defaultTier 選出的難度（題型頁用 replace 寫回網址，重新整理、分享、返回都對得上）。要是穩定的函式。 */
  onDefaultTier: (tier: Tier) => void;
}

function Loading({ text, embedded }: { text: string; embedded: boolean }) {
  if (embedded) {
    return (
      <p role="status" className="rounded-2xl border border-line bg-surface py-10 text-center text-muted">
        {text}
      </p>
    );
  }
  return (
    <div className="py-10 text-center">
      <title>{`題庫練習｜${APP_NAME}`}</title>
      <h1 className="sr-only">題庫練習</h1>
      <p role="status" className="text-muted">
        {text}
      </p>
    </div>
  );
}

/**
 * 說明文字裡怎麼稱呼正在練的這個題型 × 難度：作答頁是題庫練習選單（題型 × 難度的表格）裡的「這一格」；
 * 題型頁沒有表格，而且綜合測驗、文意選填、篇章結構的「格」指的是空格（排除法表、解析都這樣用），改用難度名稱。
 */
function scopeLabel(tier: Tier, embedded: boolean): string {
  return embedded ? TIER_LABELS[tier] : '這一格';
}

/** 這一格還沒有題組：說明「出題中」，並列出同題型其他有題組的難度。 */
function EmptyCell({ index, section, tier, embedded }: { index: BankIndex; section: PracticeSectionType; tier: Tier; embedded: boolean }) {
  const history = usePracticeHistory().value;
  const others = TIERS.filter((t) => t !== tier && cellEntries(index.groups, section, t).length > 0);
  const title = `${PRACTICE_SECTION_LABELS[section]}・${TIER_LABELS[tier]}`;
  const box = (
    <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">
      <p className="text-lg font-semibold">出題中</p>
      <p className="mt-1 text-muted">
        {embedded ? '這個難度' : '這一格'}的 AI 題組還在出題與驗證中；通過自動驗證（兩位 AI 盲解都答對、只有唯一正解）後就會出現在這裡。
      </p>
    </div>
  );
  if (embedded) {
    // 題型頁：上面的難度切換已經列出每個難度有幾組，這裡不再重複一排連結。
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {box}
        {others.length > 0 && <p className="text-[0.95rem]">{others.map((t) => TIER_LABELS[t]).join('、')}已經有題組，可以在上方切換難度先練。</p>}
      </section>
    );
  }
  return (
    <section className="space-y-4 py-2">
      <title>{`${title}｜題庫練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      {box}
      {others.length > 0 && (
        <div>
          <p className="font-medium">{PRACTICE_SECTION_LABELS[section]}的其他難度已經有題組：</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {others.map((t) => {
              const { total, done } = cellProgress(index.groups, history, section, t);
              return (
                <li key={t}>
                  <Link to={practicePath(section, t)} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 hover:border-primary">
                    {TIER_LABELS[t]}（{total} 組，已做 {done}）
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link to="/practice" className="inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
        回到題庫練習
      </Link>
    </section>
  );
}

function GroupLoader({
  promise,
  notice,
  repeatNotice,
  onNext,
  embedded,
  scrollToStart,
}: {
  promise: Promise<PracticeGroupFile>;
  notice: string | null;
  repeatNotice: string | null;
  onNext: () => void;
  embedded: boolean;
  scrollToStart: () => void;
}) {
  const file = use(promise);
  return (
    <GroupSession
      key={groupKey(file)}
      file={file}
      notice={notice}
      repeatNotice={repeatNotice}
      onNext={onNext}
      embedded={embedded}
      scrollToStart={scrollToStart}
    />
  );
}

/**
 * 題組（uid@version）的作答紀錄最後一次作答的時間；沒有紀錄、或只是打開過一題都沒作答，回傳 null。
 * （作答頁的計時器每秒把用時寫進作答紀錄，紀錄存在不代表練過；updatedAt 只在作答、交卷時更新。）
 */
export function attemptActivity(key: string): string | null {
  const state = loadAttempt(practiceAttemptIdForKey(key));
  if (!state) return null;
  return state.submittedAt !== null || Object.keys(state.answers).length > 0 ? state.updatedAt : null;
}

/** 題組開頭的說明；where 是 scopeLabel（作答頁「這一格」、題型頁難度名稱）。 */
function noticeFor(pick: Pick, total: number, resumedWork: boolean, where: string): string | null {
  if (pick.reason === 'repeat') return `${where}的 ${total} 組你都做過了，這是比較早做的一組，再練一次。`;
  // 接續的那一組還沒作答過（只是打開過）就不必說「接續」：看起來就和第一次打開一樣。
  if (pick.reason === 'resume' && resumedWork) return `已接續上次在${where}做的題組。`;
  return null;
}

/** 「再一組」會不會抽到做過的（同上，where 是 scopeLabel）。 */
function repeatNoticeFor(count: number, where: string): string {
  return count === 1
    ? `${where}目前只有這一組；「再一組」會讓你重做一次，新題組通過驗證後會自動加進來。`
    : `${where}的 ${count} 組你都做過了；「再一組」會從比較早做的那一組開始重練。`;
}

function CellSession({
  index,
  section,
  tier,
  embedded,
  scrollToStart,
}: {
  index: BankIndex;
  section: PracticeSectionType;
  tier: Tier;
  embedded: boolean;
  scrollToStart: () => void;
}) {
  const candidates = useMemo(() => cellEntries(index.groups, section, tier), [index, section, tier]);
  const cell = cellKey(section, tier);
  // 第一次抽題時順便判斷：接續的那一組有沒有作答過（之後作答了也不會突然冒出「已接續」）。
  const [initial] = useState(() => {
    const first = pickGroup(candidates, getPracticeHistory(), section, tier);
    return { pick: first, resumedWork: first?.reason === 'resume' && attemptActivity(groupKey(first.entry)) !== null };
  });
  const [pick, setPick] = useState<Pick | null>(initial.pick);
  // 第幾次抽題：「再一組」抽到同一組（這一格只有一組）時，也要整個重新掛載、從空白的作答開始。
  const [run, setRun] = useState(0);
  const history = usePracticeHistory().value;

  // 記住這一格正在做哪一組（重新整理後接著做）。
  useEffect(() => {
    updatePracticeHistory((h) => setCurrent(h, cell, pick ? groupKey(pick.entry) : null));
  }, [cell, pick]);

  const groupPromise = useMemo(() => (pick ? loadPracticeGroup(pick.entry.uid, pick.entry.version) : null), [pick]);

  if (!pick || !groupPromise) return <EmptyCell index={index} section={section} tier={tier} embedded={embedded} />;

  const finishedKey = groupKey(pick.entry);
  const where = scopeLabel(tier, embedded);
  // 「再一組」會不會抽到做過的：除了剛做完的這組，這一格其他的都做過了。
  const allDone = candidates.every((e) => history.done[e.uid] !== undefined || groupKey(e) === finishedKey);
  const repeatNotice = allDone ? repeatNoticeFor(candidates.length, where) : null;

  const next = () => {
    // 換下一組：清掉這一組的作答紀錄、提示紀錄與固定下來的判分（成績已經記在「做過」裡），再抽一組。
    clearAttempt(practiceAttemptId(pick.entry));
    updatePracticeHistory((h) => clearGroupRecords(setCurrent(h, cell, null), finishedKey));
    setPick(pickGroup(candidates, getPracticeHistory(), section, tier, { exclude: finishedKey }));
    setRun((n) => n + 1);
    scrollToStart();
  };

  return (
    <Suspense fallback={<Loading text="題組載入中…" embedded={embedded} />}>
      <GroupLoader
        key={run}
        promise={groupPromise}
        notice={noticeFor(pick, candidates.length, run === 0 && initial.resumedWork, where)}
        repeatNotice={repeatNotice}
        onNext={next}
        embedded={embedded}
        scrollToStart={scrollToStart}
      />
    </Suspense>
  );
}

/**
 * 題型頁的難度切換：三個連結（網址 ?tier=），目前的難度標 aria-current，每個難度顯示有幾組、這台裝置做過幾組；
 * 還沒有題組的顯示「出題中」（仍然可以點，作答區說明出題中）。
 */
function TierSwitcher({ index, section, active, tierLink }: { index: BankIndex; section: PracticeSectionType; active: Tier; tierLink: (tier: Tier) => To }) {
  const history = usePracticeHistory().value;
  return (
    <nav aria-label={`${PRACTICE_SECTION_LABELS[section]}的難度`} className="space-y-1.5">
      {/* 寬螢幕不撐滿整欄：三顆按鈕像一組切換鈕，不像三張大卡片。 */}
      <ul className="grid grid-cols-3 gap-2 sm:max-w-xl">
        {TIERS.map((t) => {
          const { total, done } = cellProgress(index.groups, history, section, t);
          const current = t === active;
          const tone = current
            ? 'border-primary bg-primary text-on-primary'
            : total > 0
              ? 'border-primary/50 bg-primary-soft hover:border-primary'
              : 'border-dashed border-line bg-surface-2 text-muted hover:border-primary';
          return (
            <li key={t} className="min-w-0">
              <Link
                to={tierLink(t)}
                aria-current={current ? 'page' : undefined}
                aria-label={total > 0 ? `${TIER_LABELS[t]}：${total} 組，已做 ${done} 組` : `${TIER_LABELS[t]}：出題中`}
                className={`flex h-full min-h-14 flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 text-center ${tone}`}
              >
                <span className={`text-sm font-semibold ${!current && total > 0 ? 'text-primary' : ''}`}>{TIER_LABELS[t]}</span>
                {/* 按鈕夠寬（約 92px 以上）時「20 組・已做 3」排一行；320px 手機上排成兩行，不留一個落單的「・」。 */}
                <span className="@container w-full text-xs tabular-nums">
                  {total > 0 ? (
                    <span className="flex flex-col items-center @min-[5.75rem]:flex-row @min-[5.75rem]:justify-center">
                      <span className="whitespace-nowrap">{total} 組</span>
                      <span className="whitespace-nowrap">
                        <span className="hidden @min-[5.75rem]:inline">・</span>已做 {done}
                      </span>
                    </span>
                  ) : (
                    '出題中'
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        {TIER_LABELS[active]}：適合{TIER_AUDIENCE[active].who}。
      </p>
    </nav>
  );
}

function IndexedPractice({
  indexPromise,
  section,
  tier,
  embed,
}: {
  indexPromise: Promise<BankIndex>;
  section: PracticeSectionType;
  tier: Tier | null;
  embed: PracticeEmbed | undefined;
}) {
  const index = use(indexPromise);
  const embedded = embed !== undefined;
  // 網址沒指定難度：在那一刻依練習紀錄選一個（之後作答不會讓畫面跳到別的難度）。
  const fallback = useMemo(
    () => (tier === null ? defaultTier(index.groups, getPracticeHistory(), section, attemptActivity) : null),
    [tier, index, section],
  );
  const active: Tier = tier ?? fallback ?? 'basic';
  const onDefaultTier = embed?.onDefaultTier;
  useEffect(() => {
    if (tier === null) onDefaultTier?.(active);
  }, [tier, active, onDefaultTier]);

  const [groupRetry, setGroupRetry] = useState(0);
  const retryGroup = () => {
    forgetFailedLoads();
    setGroupRetry((n) => n + 1);
  };
  const topRef = useRef<HTMLDivElement>(null);
  const scrollToStart = useCallback(() => {
    if (embedded) topRef.current?.scrollIntoView?.({ block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [embedded]);

  return (
    <div className="space-y-4">
      {embed && <TierSwitcher index={index} section={section} active={active} tierLink={embed.tierLink} />}
      {/* scroll-mt：手機頂端固定的站名列（h-14）不蓋住題組標題。 */}
      <div ref={topRef} className="scroll-mt-16 lg:scroll-mt-4">
        <DataErrorBoundary key={`${section}/${active}:${groupRetry}`} onRetry={retryGroup}>
          <CellSession key={`${section}/${active}`} index={index} section={section} tier={active} embedded={embedded} scrollToStart={scrollToStart} />
        </DataErrorBoundary>
      </div>
    </div>
  );
}

export interface SectionBankPracticeProps {
  section: PracticeSectionType;
  /** 作答頁一定有；題型頁網址沒有（或寫錯）?tier= 時是 null，由 defaultTier 選。 */
  tier: Tier | null;
  /** 題型頁內嵌時才給（見 PracticeEmbed）；作答頁不給。 */
  embed?: PracticeEmbed;
}

export function SectionBankPractice({ section, tier, embed }: SectionBankPracticeProps) {
  const [retry, setRetry] = useState(0);
  // 失敗的請求留在 data/client.ts 的快取裡；「再試一次」先 forgetFailedLoads() 再換 retry 才會重新下載。
  const indexPromise = useMemo(() => loadBankIndex(), [retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  return (
    <DataErrorBoundary key={retry} onRetry={handleRetry}>
      <Suspense fallback={<Loading text="題庫載入中…" embedded={embed !== undefined} />}>
        <IndexedPractice indexPromise={indexPromise} section={section} tier={tier} embed={embed} />
      </Suspense>
    </DataErrorBoundary>
  );
}
