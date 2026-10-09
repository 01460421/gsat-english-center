/**
 * 題庫練習的作答頁（/practice/:section/:tier）：載入題庫索引 → 從這一格抽一組（pick.ts）→ 載入題組 → 作答。
 * 抽到哪一組記在練習紀錄（history.ts 的 current）：重新整理或離開再回來，接著做同一組；交卷後按「再一組」才換。
 */
import { ChevronLeft } from 'lucide-react';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
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
import { clearAttempt } from '../exams/attempt';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { cellKey, clearHints, getPracticeHistory, setCurrent, updatePracticeHistory, usePracticeHistory } from './history';
import { PRACTICE_SECTION_LABELS, TIER_LABELS, TIERS, practicePath, sectionFromSlug, tierFromParam } from './labels';
import { cellEntries, cellProgress, pickGroup, type Pick } from './pick';
import { GroupSession } from './PracticeSession';
import { practiceAttemptId } from './practiceExam';

function BackLink() {
  return (
    <Link to="/practice" className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
      <ChevronLeft aria-hidden="true" className="size-4" />
      題庫練習
    </Link>
  );
}

function Loading({ text }: { text: string }) {
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

function NotFound() {
  return (
    <section className="py-6">
      <title>{`找不到這個練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold">找不到這個練習</h1>
      <p className="mt-2 text-muted">網址裡的題型或難度可能打錯了。</p>
      <Link to="/practice" className="mt-4 inline-block rounded-full bg-primary px-4 py-2 font-medium text-on-primary">
        回到題庫練習
      </Link>
    </section>
  );
}

/** 這一格還沒有題組：說明「出題中」，並列出同題型其他有題組的難度。 */
function EmptyCell({ index, section, tier }: { index: BankIndex; section: PracticeSectionType; tier: Tier }) {
  const history = usePracticeHistory().value;
  const others = TIERS.filter((t) => t !== tier && cellEntries(index.groups, section, t).length > 0);
  const title = `${PRACTICE_SECTION_LABELS[section]}・${TIER_LABELS[tier]}`;
  return (
    <section className="space-y-4 py-2">
      <title>{`${title}｜題庫練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5">
        <p className="text-lg font-semibold">出題中</p>
        <p className="mt-1 text-muted">這一格的 AI 題組還在出題與驗證中；通過自動驗證（兩位 AI 盲解都答對、只有唯一正解）後就會出現在這裡。</p>
      </div>
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
}: {
  promise: Promise<PracticeGroupFile>;
  notice: string | null;
  repeatNotice: string | null;
  onNext: () => void;
}) {
  const file = use(promise);
  return <GroupSession key={groupKey(file)} file={file} notice={notice} repeatNotice={repeatNotice} onNext={onNext} />;
}

function noticeFor(pick: Pick, total: number): string | null {
  if (pick.reason === 'repeat') return `這一格的 ${total} 組你都做過了，這是比較早做的一組，再練一次。`;
  if (pick.reason === 'resume') return '已接續上次在這一格做的題組。';
  return null;
}

function CellSession({ indexPromise, section, tier }: { indexPromise: Promise<BankIndex>; section: PracticeSectionType; tier: Tier }) {
  const index = use(indexPromise);
  const candidates = useMemo(() => cellEntries(index.groups, section, tier), [index, section, tier]);
  const cell = cellKey(section, tier);
  const [pick, setPick] = useState<Pick | null>(() => pickGroup(candidates, getPracticeHistory(), section, tier));
  // 第幾次抽題：「再一組」抽到同一組（這一格只有一組）時，也要整個重新掛載、從空白的作答開始。
  const [run, setRun] = useState(0);
  const history = usePracticeHistory().value;

  // 記住這一格正在做哪一組（重新整理後接著做）。
  useEffect(() => {
    updatePracticeHistory((h) => setCurrent(h, cell, pick ? groupKey(pick.entry) : null));
  }, [cell, pick]);

  const groupPromise = useMemo(() => (pick ? loadPracticeGroup(pick.entry.uid, pick.entry.version) : null), [pick]);

  if (!pick || !groupPromise) return <EmptyCell index={index} section={section} tier={tier} />;

  const finishedKey = groupKey(pick.entry);
  // 「再一組」會不會抽到做過的：除了剛做完的這組，這一格其他的都做過了。
  const allDone = candidates.every((e) => history.done[e.uid] !== undefined || groupKey(e) === finishedKey);
  const repeatNotice = allDone
    ? candidates.length === 1
      ? '這一格目前只有這一組；「再一組」會讓你重做一次，新題組通過驗證後會自動加進來。'
      : `這一格的 ${candidates.length} 組你都做過了；「再一組」會從比較早做的那一組開始重練。`
    : null;

  const next = () => {
    // 換下一組：清掉這一組的作答紀錄與提示紀錄（成績已經記在「做過」裡），再抽一組。
    clearAttempt(practiceAttemptId(pick.entry));
    updatePracticeHistory((h) => clearHints(setCurrent(h, cell, null), finishedKey));
    setPick(pickGroup(candidates, getPracticeHistory(), section, tier, { exclude: finishedKey }));
    setRun((n) => n + 1);
    window.scrollTo({ top: 0 });
  };

  return (
    <Suspense fallback={<Loading text="題組載入中…" />}>
      <GroupLoader key={run} promise={groupPromise} notice={noticeFor(pick, candidates.length)} repeatNotice={repeatNotice} onNext={next} />
    </Suspense>
  );
}

export default function PracticeSessionPage() {
  const params = useParams();
  const section = sectionFromSlug(params['section']);
  const tier = tierFromParam(params['tier']);
  const [retry, setRetry] = useState(0);
  // 失敗的請求留在 data/client.ts 的快取裡；「再試一次」先 forgetFailedLoads() 再換 retry 才會重新下載。
  const indexPromise = useMemo(() => loadBankIndex(), [retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  if (!section || !tier) {
    return (
      <article>
        <BackLink />
        <NotFound />
      </article>
    );
  }
  return (
    <article>
      <BackLink />
      <DataErrorBoundary key={`${section}/${tier}:${retry}`} onRetry={handleRetry}>
        <Suspense fallback={<Loading text="題庫載入中…" />}>
          <CellSession key={`${section}/${tier}`} indexPromise={indexPromise} section={section} tier={tier} />
        </Suspense>
      </DataErrorBoundary>
    </article>
  );
}
