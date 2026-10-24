/**
 * 開考前的「本卷資訊」（docs/design/bank-mock.md §2.2）：插在 StartScreen 的標題下面（MockPaper.bank.startIntro）。
 *
 *   - 卷號、難度、組卷日期、資料版本，以及「AI 出題・已通過自動驗證・人工審核中」
 *   - 「複製這份卷子的連結」：有 navigator.share 就用分享，沒有就複製；註明卷號只供核對，要用網址或 QR code 才能打開卷子
 *   - 「我已經在紙本做過這份」：11 個題組記為做過（paperDoneAt），之後組卷會避開；可以取消
 *   - 用到做過的題組、題組換過或改過、從 PDF 進來時和紙本不同的題號
 *   - 作答中的自組卷已經有 3 份時：列出那幾份，可以接著作答或放棄其中一份後再開始（§2.8）
 *   - 「組一份新卷（同難度）」
 *
 * 只讀寫 localStorage（myPapers）與快照（按「紙本做過」時確認快照已寫入），不下載資料。
 *
 * 加強卷（bk2，docs/design/weak-paper.md §3.5）：清單是「我的加強卷」（paperLists.ts）；另外有作答時間、難度（混難度時列出）、
 * 「本卷針對」（PaperTargets，只在組卷的裝置）、診斷卷與均衡加強卷的說明、還沒開考時的「換一份（同設定）」，
 * 出版社授權已經結束的題組（題目已遮住）列出題號並說明不計分；「組一份新的加強卷」連到組卷頁。
 */
import { TIER_LABELS, TIERS } from '@gsat/shared';
import { Bot, CircleAlert, Link2, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DataLoadError } from '../../../data/client';
import { loadSourceRegistry, sourceActiveFn } from '../../../data/sources';
import { getOutcomes } from '../../assistant/outcomes';
import { weakPaperSeed } from '../../assistant/papers/flags';
import { wrongGroupsFrom } from '../../assistant/papers/weakness';
import { formatClock } from '../../exams/labels';
import { formatDateTime } from '../format';
import { mockPaperLabel } from '../papers';
import { clearActiveId, removeRecord } from '../storage';
import { remainingSec } from '../timer';
import { useNow } from '../useNow';
import { AI_GROUP_LABEL } from '../../practice/labels';
import { paperLayout, type BankPaper } from './buildExam';
import { paperNumber } from './code';
import { bk2KindOf } from './paperId';
import { createWeakPaper } from './createWeakPaper';
import { hasPaperUse, type ActiveBankAttempt, type PrintedInfo } from './myPapers';
import { findPaperEntry, findWeakEntry, paperListFor } from './paperLists';
import { PUBLISHER_LICENSE_NOTICE, paperSourceRanges } from './paperSources';
import { PaperTargets } from './PaperTargets';
import { rangeOf } from './resolve';
import type { WeakPaperEntry } from './weakPapers';
import { labelsText, rangeText } from './rangeText';
import { ensureSnapshot } from './snapshots';

/** 開考前檢查失敗時，焦點移到這一塊（bankMockPaper 的 canStart）。 */
export const ACTIVE_LIMIT_ID = 'bank-active-limit';

/** 「組一份新卷（同難度）」的網址：/mock 的區塊（§2.1 的 ?tier=）。 */
export function newPaperPath(tier: BankPaper['tier']): string {
  return `/mock?tier=${tier}#bank-mock`;
}

/** 這份卷子在這台裝置的網址（分享用）。 */
export function paperUrl(paperId: string): string {
  return `${window.location.origin}/mock/${paperId}`;
}

/** 複製到剪貼簿：Clipboard API 不能用（非安全來源、權限）時退回隱藏的 textarea。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 改用下面的備案。
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 「複製這份卷子的連結」與「我已經在紙本做過這份」：兩個按鈕共用一行狀態（role="status"）。 */
function PaperActions({ paper }: { paper: BankPaper }) {
  const hintId = useId();
  const [status, setStatus] = useState('');
  const [done, setDone] = useState(() => Boolean(findPaperEntry(paper.id)?.paperDoneAt));

  const share = async () => {
    const url = paperUrl(paper.id);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${paper.kind ? '學習助手加強卷' : '本站自組模擬考'} ${paper.code}`, url });
        setStatus('已分享連結');
        return;
      } catch (err) {
        // 使用者關掉分享面板：不必提示；其他錯誤（不支援）改用複製。
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    setStatus((await copyText(url)) ? '已複製連結' : `無法自動複製，請手動複製網址：${url}`);
  };

  const toggleDone = () => {
    const next = !done;
    if (!paperListFor(paper.id).setDone(paper.id, next)) {
      setStatus('這個瀏覽器無法儲存資料，沒有記錄下來。');
      return;
    }
    // 記為做過之後題庫再更新，也要拿得到同一份題目：確認快照已寫入（§4.7 第 (2) 部分）。
    if (next) void ensureSnapshot(paper).catch(() => false);
    setDone(next);
    setStatus(next ? '已記錄，之後組卷會避開這些題組' : '已取消紙本做過的紀錄');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void share()}
          aria-describedby={hintId}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary px-4 text-sm font-medium text-primary hover:bg-primary-soft"
        >
          <Link2 aria-hidden="true" className="size-4" />
          複製這份卷子的連結
        </button>
        <button
          type="button"
          aria-pressed={done}
          onClick={toggleDone}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary-soft"
        >
          {done ? '已標記紙本做過（按一下取消）' : '我已經在紙本做過這份'}
        </button>
      </div>
      <p id={hintId} className="mt-1 text-xs text-muted">
        同學打開同一個網址，就是同一份卷子。卷號只供核對，要用網址或 QR code 才能打開卷子。
      </p>
      <p role="status" className="mt-1 min-h-5 text-sm break-all text-primary">
        {status}
      </p>
    </div>
  );
}

function ActiveRow({ attempt, onAbandon }: { attempt: ActiveBankAttempt; onAbandon: () => void }) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const left = remainingSec(attempt.record, now);
  const label = mockPaperLabel(attempt.paperId);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="ml-2 text-sm text-muted">
          {left > 0 ? (
            <>
              剩 <span className="tabular-nums">{formatClock(left)}</span>
            </>
          ) : (
            '已超過作答時間'
          )}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Link to={`/mock/${attempt.paperId}`} className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-on-primary">
          接著作答
          <span className="sr-only">：{label}</span>
        </Link>
        {confirming ? (
          <span role="group" aria-label={`確認放棄${label}`} className="inline-flex flex-wrap items-center gap-2 text-sm">
            <span>確定放棄？這次的作答會刪除。</span>
            <button type="button" onClick={onAbandon} className="min-h-9 rounded-full bg-bad px-3 font-semibold text-on-primary">
              確定放棄
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-9 rounded-full border border-line px-3">
              取消
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-11 items-center text-sm text-muted underline underline-offset-2 hover:text-primary">
            放棄這次作答
            <span className="sr-only">：{label}</span>
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * 作答中的自組卷已經有 3 份：列出來，接著作答或放棄其中一份（§2.8）。別的分頁交卷、放棄時跟著更新。
 * 放棄後那一列（連同焦點所在的「確定放棄」）會卸載：焦點移到還在的地方，不掉到 body。還是超過上限就移到這一塊；
 * 不到上限了，這一塊換成「已放棄…可以開始」的說明並把焦點移過去（讀屏會念出來）。
 */
function ActiveLimitNotice({ paperId }: { paperId: string }) {
  const sectionRef = useRef<HTMLElement>(null);
  const clearedRef = useRef<HTMLParagraphElement>(null);
  const list = paperListFor(paperId);
  const kindName = bk2KindOf(paperId) ? '加強卷' : '自組卷';
  const [check, setCheck] = useState(() => list.checkActiveLimit(paperId));
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    const onStorage = () => setCheck(list.checkActiveLimit(paperId));
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [paperId]);
  useEffect(() => {
    if (cleared) clearedRef.current?.focus();
  }, [cleared]);
  if (check.ok) {
    if (!cleared) return null;
    return (
      <p ref={clearedRef} tabIndex={-1} className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm">
        已放棄那次作答，現在可以開始這一份。
      </p>
    );
  }
  return (
    <section ref={sectionRef} id={ACTIVE_LIMIT_ID} tabIndex={-1} aria-label={`作答中的${kindName}`} className="rounded-2xl border border-bad/40 bg-bad/10 p-4 text-sm">
      <p className="flex gap-2 font-semibold text-bad">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        你有 {check.active.length} 份{kindName}還在作答中。
      </p>
      <p className="mt-1">接著作答其中一份，或放棄其中一份之後，才能開始這一份。</p>
      <ul className="mt-2 divide-y divide-line">
        {check.active.map((a) => (
          <ActiveRow
            key={a.record.id}
            attempt={a}
            onAbandon={() => {
              removeRecord(a.record.id);
              clearActiveId(a.paperId, a.record.id);
              const next = list.checkActiveLimit(paperId);
              setCheck(next);
              if (next.ok) setCleared(true);
              else sectionRef.current?.focus();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/** 題組換過、改過或和紙本不同的提示（§2.2）。 */
function ChangeNotices({ paper, redirectedFrom, printed }: { paper: BankPaper; redirectedFrom: string | null; printed: PrintedInfo | null }) {
  const { replaced, textChanged, keyChanged, reused } = paper.notices;
  const items: string[] = [];
  if (reused.length > 0) {
    items.push(`本卷有 ${reused.length} 個題組你在這台裝置做過（${rangeText(reused)}）；成績單會另外算扣掉這幾題的得分。`);
  }
  if (printed && (printed.excluded.length > 0 || printed.keyChanged.length > 0)) {
    const parts: string[] = [];
    if (printed.excluded.length > 0) parts.push(`${rangeText(printed.excluded)}的題組已下架，線上換成另一組，這幾題不計分`);
    if (printed.keyChanged.length > 0) parts.push(`${labelsText(printed.keyChanged)}的答案已更正，以線上為準`);
    items.push(`紙本卷號 ${paperNumber(printed.from)}：${parts.join('；')}。`);
  } else if (replaced.length > 0) {
    const kinds = new Set(replaced.map((r) => r.kind));
    const how = kinds.size === 2 ? '新版本或同難度的另一組' : kinds.has('updated') ? '新版本' : '同難度的另一組';
    const codes = redirectedFrom ? `原本的卷號 ${paperNumber(redirectedFrom)}，現在是 ${paper.code}。` : '';
    items.push(`這份卷子有 ${replaced.length} 個題組已由本站更新或下架，已換成${how}（${rangeText(replaced.map((r) => r.range))}）。${codes}`);
    if (keyChanged.length > 0) items.push(`答案有修改的題目：${labelsText(keyChanged)}。`);
  }
  if (textChanged.length > 0) items.push(`${rangeText(textChanged)}的文章文字有修改，答案不變；紙本作答照常計分。`);
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-3 text-sm text-badge-fg" aria-label="本卷提醒">
      {items.map((t) => (
        <li key={t} className="flex gap-2">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 題目來源（docs/design/weak-paper.md §8.7）：卷子裡有出版社題組時，依題號範圍列出「本站題庫（AI 出題）」或出版社的出處句。
 * 只用本站題的卷子（自組模擬考）不顯示這一塊。
 */
function PaperSources({ paper }: { paper: BankPaper }) {
  const ranges = paperSourceRanges(paper.groups);
  if (!ranges) return null;
  return (
    <div className="space-y-1 text-sm" data-testid="paper-sources">
      <p className="font-medium">題目來源</p>
      <ul className="space-y-0.5">
        {ranges.map((r) => (
          <li key={`${r.range}${r.text}`} className="break-words">
            <span className="text-muted">{r.range}：</span>
            {r.text}
          </li>
        ))}
      </ul>
      <p className="text-muted">{PUBLISHER_LICENSE_NOTICE}</p>
    </div>
  );
}

/** 卷子用到的難度（加強卷可以混難度）：「進階練習」或「進階練習、超越頂標」。 */
function tiersText(paper: BankPaper): string {
  const used = new Set(paperLayout(paper).slots.map((s) => s.tier));
  return TIERS.filter((t) => used.has(t))
    .map((t) => TIER_LABELS[t])
    .join('、');
}

/** 加強卷的說明（依卷別）。 */
function weakPaperNote(paper: BankPaper, entry: WeakPaperEntry | null): string {
  if (entry?.request?.diagnostic) {
    return '這份是診斷卷：各大題的題型與技能盡量分散，交卷後可以看出哪個大題比較需要加強；技能層級的弱點通常要再累積一兩份練習。';
  }
  if (entry?.request?.balanced) {
    return '這份是均衡加強卷：這次不是針對弱點，各選擇題大題各練一組；題型與配分同學測，不換算級分。';
  }
  switch (paper.kind) {
    case 'w':
      return '題目刻意挑你的弱點，題型與配分同學測，只放需要加強的大題，所以不換算級分、成績單也不給難度建議。';
    case 'f':
      return '整份學測格式，每個大題優先挑考到你弱點的題組；得分率會比一般自組卷低，不換算級分。';
    case 'r':
      return '依你選的大題、難度與來源隨機抽題；題型與配分同學測，不換算級分。';
    default:
      return '題型與配分同學測；難度依你選的等級，不是正式考卷的難易混合，所以不換算級分。';
  }
}

/**
 * 出版社授權已經結束的題組（快照裡的題目已經遮住，sourceMask.ts）：列出題號、說明不計分（docs/design/weak-paper.md §7.6）。
 * 卷子沒有出版社題組時不下載來源登記、不顯示。
 */
export function useEndedSourceRanges(paper: BankPaper): string[] {
  const [ranges, setRanges] = useState<string[]>([]);
  useEffect(() => {
    if (!paper.groups.some((g) => g.source)) return;
    let alive = true;
    loadSourceRegistry()
      .then((registry) => {
        if (!alive) return;
        const active = sourceActiveFn(registry);
        setRanges(paper.groups.flatMap((g) => (g.source && !active(g.source.id) ? [rangeOf(g)] : [])));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [paper]);
  return ranges;
}

/**
 * 「換一份（同設定）」（§3.5、§6.7）：還沒開考、沒下載 PDF、沒有紙本做過的加強卷，用新種子重組；被取代那一份的題組列為盡量避開，
 * 清單裡的這一份換成新的（舊的快照刪掉）。弱點用組卷時存下的目標（不重算），保持手感的大題照原本那一組。
 */
function ReplaceButton({ paper, entry }: { paper: BankPaper; entry: WeakPaperEntry }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = entry.request;
  if (!request) return null;
  const replace = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const layout = paperLayout(paper);
      const maintenanceIndex = entry.notes.findIndex((n) => n.flags.includes('maintenance'));
      const maintenance = maintenanceIndex >= 0 && layout.slots[maintenanceIndex] ? { section: layout.slots[maintenanceIndex].section } : null;
      const weak = request.kind === 'w' || request.kind === 'f';
      const seed = weakPaperSeed();
      const result = await createWeakPaper({
        request,
        profile: weak ? { targets: entry.targets, maintenance } : null,
        targets: entry.targets,
        // 「也重做錯過的」要這台裝置錯過的題組（同組卷頁），否則第 2 層（重做）永遠不會出現（§6.3 第 4 步）。
        wrong: wrongGroupsFrom(getOutcomes().items),
        replacing: paper.id,
        ...(seed === null ? {} : { seed: seed + 1 }),
      });
      if (!result.ok) {
        setError('題庫裡同樣設定的題組不夠再組一份，可以回組卷頁改設定。');
        setBusy(false);
        return;
      }
      navigate(`/mock/${result.paper.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof DataLoadError && err.kind === 'not_found' ? '網站剛更新，請重新整理頁面後再試一次。' : '題目下載失敗，請確認網路連線後再試一次。');
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void replace()}
        aria-disabled={busy || undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm lg:hover:border-primary aria-disabled:opacity-60"
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        {busy ? '組卷中…' : '換一份（同設定）'}
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function PaperInfo({ paper, redirectedFrom = null }: { paper: BankPaper; redirectedFrom?: string | null }) {
  const id = useId();
  const [entry] = useState(() => findPaperEntry(paper.id));
  const [weakEntry] = useState(() => findWeakEntry(paper.id));
  const printed = entry?.printed ?? null;
  const weak = paper.kind !== undefined;
  const ended = useEndedSourceRanges(paper);
  // 全部是出版社題組的卷子不標「AI 出題」（出處在下面的題目來源）。
  const hasAiGroups = paper.groups.some((g) => g.source === undefined);
  const canReplace = weakEntry !== null && weakEntry.request !== null && !hasPaperUse(weakEntry) && paperListFor(paper.id).activeAttempts().every((a) => a.paperId !== paper.id);
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-2xl border border-line bg-surface p-5 lg:p-6" data-testid="paper-info">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          本卷資訊
        </h2>
        {hasAiGroups && (
          <span className="inline-flex items-center gap-1 rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">
            <Bot aria-hidden="true" className="size-3.5" />
            {AI_GROUP_LABEL}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        <dt className="text-muted">卷號</dt>
        <dd className="font-semibold tabular-nums">{paper.code}</dd>
        <dt className="text-muted">難度</dt>
        <dd>{weak ? tiersText(paper) : TIER_LABELS[paper.tier]}</dd>
        {weak && (
          <>
            <dt className="text-muted">作答時間</dt>
            <dd className="tabular-nums">{paperLayout(paper).minutes} 分鐘</dd>
          </>
        )}
        {entry && (
          <>
            <dt className="text-muted">組卷日期</dt>
            <dd>{formatDateTime(entry.createdAt)}</dd>
          </>
        )}
        <dt className="text-muted">資料版本</dt>
        <dd className="break-all tabular-nums">{paper.dataVersion}</dd>
      </dl>
      <p className="text-sm text-muted">{weak ? weakPaperNote(paper, weakEntry) : '題型與配分同學測；難度依你選的等級，不是正式考卷的難易混合，所以不換算級分。'}</p>
      {weakEntry?.request && (weakEntry.request.kind === 'w' || weakEntry.request.kind === 'f') && <PaperTargets paper={paper} entry={weakEntry} />}
      {weak && !weakEntry?.request && <p className="text-xs text-muted">這份卷子不是在這台裝置組的：題目、題號與答案位置都相同，但「本卷針對」只在組卷的裝置顯示。</p>}
      <PaperSources paper={paper} />
      {ended.length > 0 && (
        <p className="flex gap-2 rounded-xl border border-badge-fg/30 bg-badge-bg px-4 py-3 text-sm text-badge-fg">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{rangeText(ended)}的出版社授權已經結束，題目不再顯示，這幾題不計分。</span>
        </p>
      )}
      <ChangeNotices paper={paper} redirectedFrom={redirectedFrom} printed={printed} />
      <ActiveLimitNotice paperId={paper.id} />
      <PaperActions paper={paper} />
      {canReplace && weakEntry && <ReplaceButton paper={paper} entry={weakEntry} />}
      {weak ? (
        <Link to="/assistant/papers" className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
          組一份新的加強卷
        </Link>
      ) : (
        <Link to={newPaperPath(paper.tier)} className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2">
          組一份新卷（{TIER_LABELS[paper.tier]}）
        </Link>
      )}
    </section>
  );
}
