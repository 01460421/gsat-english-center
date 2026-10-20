/**
 * /mock 的「本站自組模擬考」區塊（docs/design/bank-mock.md §2.1）：pages/MockExamPage.tsx 在 bankMockVisible() 為真時，
 * 在 <MockPaperList />（region「卷別」與作答紀錄）之後 lazy 載入。獨立的 <section id="bank-mock">，不放進 region「卷別」
 * （e2e 與桌機的列式卡片都依賴那裡只有 6 張卡片）。
 *
 *   難度          三張選項卡（單選）：名稱、TIER_AUDIENCE 的對象、「還可以組約 N 份全新的卷子」；題庫連一份都湊不出來的標「出題中」並停用。
 *                 上次選的難度存在 localStorage（gsat-bankmock:v1:tier），網址的 ?tier=advanced 優先（成績單的「組一份新卷（同難度）」）。
 *   約 N 份       進到 /mock 時先下載組卷池（約 12 KB gzip），下載完才顯示；下載失敗只隱藏這一行，按鈕照常可以按（按下時會重新下載）。
 *   不夠一份      某個大題沒做過的題組不夠時，按鈕上方說明哪個大題只剩幾組（閱讀說明是哪一種篇章用完了）、會用到做過的題組；
 *                 程式不會自動改用其他難度。
 *   組一份新卷    按下 → 「組卷中…」並停用（aria-disabled，焦點留在按鈕上）→ 組卷、存快照、加進「我組過的卷子」→ navigate('/mock/{代號}')。
 *                 失敗時在按鈕下方顯示 role="alert"：網路錯誤「題目下載失敗…」；題組檔 404（網站剛更新，重抓組卷池一次後仍失敗）
 *                 「網站剛更新，請重新整理頁面後再試一次。」
 *   我組過的卷子  只讀 localStorage（gsat-bankmock:v1:papers、gsat-mock:v1:*），不下載資料。狀態文字沿用 MockPaperList 的寫法，
 *                 另外有「紙本做過」「下載過 PDF」與用到做過的題組的題號範圍。載入時順便處理逾期 24 小時還沒交卷的自組卷、清單上限
 *                 （myPapers.ts 的 maintainMyPapers）。最多先列 5 份，其他收進「更多」。
 *
 * 預覽模式的 ?bankmockseed=<n> 指定組卷的種子（只給 e2e 用，flags.ts）。桌機只有 lg: 起的差異。
 */
import { TIER_LABELS, TIERS, type BankSectionType, type Tier } from '@gsat/shared';
import { ChevronRight, CircleAlert, FileText, Shuffle } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DataLoadError } from '../../../data/client';
import { formatClock, formatDuration } from '../../exams/labels';
import { formatPoints } from '../../exams/scoring';
import { AI_GROUP_LABEL, TIER_AUDIENCE } from '../../practice/labels';
import { MOCK_STORAGE_PREFIX, canUseStorage, notifyMockChanged, type MockAttemptRecord } from '../storage';
import { isExpired, remainingSec } from '../timer';
import { useNow } from '../useNow';
import { insufficientSection, remainingEstimate, type RemainingEstimate } from './assemble';
import { bankHistoryEntry } from './bankScore';
import { SELECTION_ORDER, slotRange } from './blueprint';
import { decodePaperId } from './code';
import { bankMockSeed, bankPdfVisible } from './flags';
import { MY_PAPERS_KEY, listMyPapers, maintainMyPapers, type MyPaperRow } from './myPapers';
import { loadMockPool, type MockPool } from './pool';
import { rangeText } from './rangeText';
import { assembleNewPaper } from './resolve';
import { getSnapshotStore } from './snapshots';
import { loadUsedGroups } from './used';

export const TIER_KEY = 'gsat-bankmock:v1:tier';
/** 「我組過的卷子」先列幾份，其他收進「更多」。 */
export const MY_PAPERS_SHOWN = 5;

/** 大題的名稱（不夠一份時的說明用）。 */
const SECTION_NAMES: Record<BankSectionType, string> = {
  vocabulary: '詞彙題',
  cloze: '綜合測驗',
  word_bank: '文意選填',
  structure: '篇章結構',
  reading: '閱讀',
  mixed: '混合題',
  translation: '中譯英',
  composition: '英文作文',
};

const isTier = (v: string | null | undefined): v is Tier => (TIERS as readonly string[]).includes(v ?? '');

/** 一開始選哪個難度：網址的 ?tier= → 上次選的 → 穩定基礎。 */
function initialTier(search: string): Tier {
  const fromUrl = new URLSearchParams(search).get('tier');
  if (isTier(fromUrl)) return fromUrl;
  try {
    const saved = window.localStorage.getItem(TIER_KEY);
    if (isTier(saved)) return saved;
  } catch {
    // localStorage 不能用：用預設值。
  }
  return 'basic';
}

function saveTier(tier: Tier): void {
  try {
    window.localStorage.setItem(TIER_KEY, tier);
  } catch {
    // 只是方便使用者，存不進去就算了。
  }
}

/**
 * 沒做過的題組不夠一份全新的卷子時，第一個不夠的大題（依選題順序）怎麼說，例如「穩定基礎沒做過的詞彙題題組只剩 1 組」。
 * 閱讀照組卷規則拆開算（每份 1 篇圖表或表格、2 篇其他、其中至少 1 篇連續文本，§2.1）：說明是哪一種用完了，
 * 不寫閱讀的總篇數（總數可能比一份要的多很多，例如只有附圖表的用完了）。
 */
export function shortageText(tier: Tier, estimate: RemainingEstimate): string | null {
  const name = TIER_LABELS[tier];
  for (const section of SELECTION_ORDER) {
    const s = estimate.sections[section];
    if (!s || s.papers > 0) continue;
    if (section === 'reading') {
      const r = estimate.reading;
      if (r.figure === 0) return `${name}附圖表或表格的閱讀題組你都做過了（每份要 1 篇）`;
      if (r.continuous === 0) return `${name}單篇文章（不是多文本）的閱讀題組你都做過了（每份至少要 1 篇）`;
      return `${name}沒做過、沒有附圖表的閱讀題組只剩 ${r.other} 篇（每份要 2 篇）`;
    }
    return s.unused > 0 ? `${name}沒做過的${SECTION_NAMES[section]}題組只剩 ${s.unused} 組` : `${name}的${SECTION_NAMES[section]}題組你都做過了`;
  }
  return null;
}

/** 「我組過的卷子」一列用到這台裝置在組卷前做過的題組（題號範圍）。 */
function reusedOf(row: MyPaperRow): string[] {
  const decoded = decodePaperId(row.entry.id);
  if (!decoded) return [];
  const used = loadUsedGroups({ excludePaperId: row.entry.id, before: Date.parse(row.entry.createdAt) });
  return decoded.slots.flatMap((s, i) => (used.has(s.uid) ? [slotRange(i)] : []));
}

/** ISO 時間 → 「10/18」（台灣時間）。 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
}

function Remaining({ record }: { record: MockAttemptRecord }) {
  const now = useNow();
  if (isExpired(record, now)) return <>已超過作答時間，打開後會以最後存檔的作答交卷</>;
  const left = remainingSec(record, now);
  return (
    <>
      作答中，剩 <span className="tabular-nums">{formatClock(left)}</span>
      <span className="sr-only">（{formatDuration(left)}）</span>
    </>
  );
}

function PaperRow({ row }: { row: MyPaperRow }) {
  const { entry, code, active, submissions } = row;
  const latest = submissions[0];
  const name = `${TIER_LABELS[entry.tier]} ${code}`;
  const reused = useMemo(() => reusedOf(row), [row]);
  const tags = [entry.paperDoneAt ? '紙本做過' : null, entry.pdfAt ? '下載過 PDF' : null].filter((t): t is string => t !== null);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
      <span className="min-w-0">
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-sm text-muted">{shortDate(entry.createdAt)} 組卷</span>
        <span className="block text-sm">
          {active ? (
            <span className="font-semibold text-primary">
              <Remaining record={active} />
            </span>
          ) : latest ? (
            <span>
              已交卷 {submissions.length} 次，最近 <strong className="tabular-nums">{formatPoints(latest.raw)}</strong> 分
              {latest.pendingMax > 0 && <span className="text-muted">（中譯英與作文還沒自評）</span>}
            </span>
          ) : tags.length === 0 ? (
            <span className="text-muted">未作答</span>
          ) : null}
          {tags.length > 0 && (
            <span className="text-muted">
              {active || latest ? '・' : ''}
              {tags.join('・')}
            </span>
          )}
        </span>
        {reused.length > 0 && <span className="block text-xs text-muted">用到你做過的題組：{rangeText(reused)}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Link to={`/mock/${entry.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm hover:border-primary">
          {active ? '繼續作答' : '打開'}
          <span className="sr-only">：{name}</span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
        {latest && (
          <Link to={`/mock/report/${latest.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line px-4 text-sm hover:border-primary">
            <FileText aria-hidden="true" className="size-4" />
            成績單
            <span className="sr-only">：{name}</span>
          </Link>
        )}
      </span>
    </li>
  );
}

function MyPapers({ rows, persistent, storageOk }: { rows: readonly MyPaperRow[]; persistent: boolean; storageOk: boolean }) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  if (!storageOk) {
    return <p className="text-sm text-muted">這個瀏覽器無法儲存資料（可能是無痕模式或停用了網站資料）：「我組過的卷子」不會保存，組卷時也不會避開做過的題組。</p>;
  }
  if (rows.length === 0) return null;
  const shown = showAll ? rows : rows.slice(0, MY_PAPERS_SHOWN);
  const more = rows.length - MY_PAPERS_SHOWN;
  return (
    <section aria-labelledby={`${id}-title`} className="border-t border-line pt-4">
      <h3 id={`${id}-title`} className="font-semibold">
        我組過的卷子（這台裝置）
      </h3>
      {!persistent && <p className="mt-1 text-sm text-bad">這個瀏覽器不能保存卷子內容，題庫更新後舊卷子可能無法接著作答或檢討。</p>}
      <ol id={`${id}-list`} className="mt-2 divide-y divide-line">
        {shown.map((row) => (
          <PaperRow key={row.entry.id} row={row} />
        ))}
      </ol>
      {more > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={`${id}-list`}
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-2"
        >
          {showAll ? '收起' : `更多（還有 ${more} 份）`}
        </button>
      )}
    </section>
  );
}

export default function BankMockSection() {
  const id = useId();
  const location = useLocation();
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [tier, setTier] = useState<Tier>(() => initialTier(location.search));
  const [pool, setPool] = useState<MockPool | null>(null);
  const [used, setUsed] = useState<ReadonlyMap<string, number>>(() => loadUsedGroups());
  const [rows, setRows] = useState<MyPaperRow[]>(() => listMyPapers());
  const [persistent, setPersistent] = useState(true);
  const [storageOk] = useState(canUseStorage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setRows(listMyPapers());
    setUsed(loadUsedGroups());
  }, []);

  // 組卷池：下載完才顯示「約 N 份」；失敗只隱藏那一行。
  useEffect(() => {
    let alive = true;
    loadMockPool()
      .then((p) => {
        if (alive) setPool(p);
      })
      .catch(() => {
        // 按下「組一份新卷」時會重新下載。
      });
    return () => {
      alive = false;
    };
  }, []);

  // 逾期作答與清單上限（只動 localStorage 與快照），處理完再讀一次清單；快照存不存得住（IndexedDB）。
  useEffect(() => {
    let alive = true;
    maintainMyPapers({ historyEntry: bankHistoryEntry })
      .then((expired) => {
        // 逾期的作答交卷或丟棄了：同一頁上面的作答紀錄（MockPaperList）也要重新讀，storage 事件只會在別的分頁觸發。
        if (expired.submitted.length > 0 || expired.discarded.length > 0) notifyMockChanged();
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) refresh();
      });
    getSnapshotStore()
      .persistent()
      .then((p) => {
        if (alive) setPersistent(p);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [refresh]);

  // 別的分頁開考、交卷、組卷時跟著更新。
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MY_PAPERS_KEY || e.key.startsWith(MOCK_STORAGE_PREFIX)) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  // 從頁首的連結、成績單或本卷資訊（/mock?tier=…#bank-mock）進來：區塊是 lazy 載入的，畫好之後才捲過來。
  // 等到下一個畫面才捲：從別頁點連結進來、程式已經載入過時，區塊和 Layout 在同一次繪製裡掛上，Layout 換頁回到頂端的
  // effect（window.scrollTo(0, 0)）比這裡晚執行，會把捲動蓋掉。焦點移到區塊標題，鍵盤與讀屏使用者才知道到了哪裡。
  useEffect(() => {
    if (location.hash !== '#bank-mock') return;
    const frame = window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ block: 'start' });
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash, location.key]);

  const tiers = useMemo(
    () =>
      TIERS.map((t) => {
        const tierPool = pool?.tiers[t] ?? null;
        return {
          tier: t,
          // 題庫本身（含做過的）湊不出一份：「出題中」。
          unavailable: tierPool ? insufficientSection(tierPool) !== null : false,
          estimate: tierPool ? remainingEstimate(tierPool, used) : null,
        };
      }),
    [pool, used],
  );
  const current = tiers.find((t) => t.tier === tier);
  const short = current?.estimate && !current.unavailable ? shortageText(tier, current.estimate) : null;

  const choose = (t: Tier) => {
    setTier(t);
    setError(null);
    saveTier(t);
  };

  const assemble = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const seed = bankMockSeed();
      const result = await assembleNewPaper(tier, seed === null ? {} : { seed });
      if (!result.ok) {
        setError(`${TIER_LABELS[tier]}的題目還在準備中（出題中），請改選其他難度。`);
        setBusy(false);
        return;
      }
      navigate(`/mock/${result.paper.id}`);
    } catch (err) {
      setError(err instanceof DataLoadError && err.kind === 'not_found' ? '網站剛更新，請重新整理頁面後再試一次。' : '題目下載失敗，請確認網路連線後再試一次。');
      setBusy(false);
      // 組卷池這時可能已經重新下載成功：補上「約 N 份」。
      loadMockPool()
        .then(setPool)
        .catch(() => undefined);
    }
  };

  return (
    <section
      ref={sectionRef}
      id="bank-mock"
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 space-y-4 rounded-2xl border border-line bg-surface p-5 lg:max-w-[60rem] lg:p-6"
    >
      <div className="space-y-1">
        <h2 ref={headingRef} id={`${id}-title`} tabIndex={-1} className="text-lg font-semibold">
          本站自組模擬考
        </h2>
        <p className="text-[0.95rem]">
          從本站題庫依現行學測英文的題型與配分組成一整份試卷：選擇題 46 題、混合題 4 題、中譯英 2 題、英文作文 1 題，100 分鐘、滿分 100 分。
          {bankPdfVisible() ? '可以線上計時作答，也可以下載 PDF 印出來寫。' : '線上計時作答，交卷後看本站的答案與解析。'}
        </p>
        <p className="text-sm text-muted">題型與配分同學測；難度依你選的等級，不是正式考卷的難易混合，所以不換算級分。</p>
        <p className="inline-flex rounded-full bg-badge-bg px-2.5 py-0.5 text-xs font-semibold text-badge-fg">{AI_GROUP_LABEL}</p>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 font-medium">難度</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {tiers.map(({ tier: t, unavailable, estimate }) => (
            <label
              key={t}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft ${unavailable ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name={`${id}-tier`}
                value={t}
                checked={tier === t}
                disabled={unavailable || busy}
                onChange={() => choose(t)}
                className="mt-1.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{TIER_LABELS[t]}</span>
                <span className="block text-sm text-muted">{TIER_AUDIENCE[t].who}</span>
                {unavailable ? (
                  <span className="block text-sm font-medium text-bad">出題中</span>
                ) : estimate ? (
                  <span className="block text-sm">
                    {estimate.papers > 0 ? (
                      <>
                        還可以組約 <strong className="tabular-nums">{estimate.papers}</strong> 份全新的卷子
                      </>
                    ) : (
                      '沒做過的題組不夠一份全新的卷子'
                    )}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {short && (
        <p className="flex gap-2 rounded-xl bg-badge-bg px-3 py-2 text-sm text-badge-fg">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{short}，這份卷子會用到你做過的題組（開考前會標出是哪幾題，成績單會另外算扣掉這幾題的得分）。也可以改組其他難度。</span>
        </p>
      )}

      <div className="space-y-1">
        {/* 組卷中用 aria-disabled、不用 disabled：停用的按鈕會失去焦點，組卷失敗時鍵盤使用者得從頁首重新找回這個按鈕。 */}
        <button
          type="button"
          onClick={() => void assemble()}
          disabled={Boolean(current?.unavailable)}
          aria-disabled={busy || undefined}
          aria-describedby={`${id}-hint`}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 font-semibold text-on-primary disabled:opacity-60 aria-disabled:opacity-60"
        >
          <Shuffle aria-hidden="true" className="size-4" />
          {busy ? '組卷中…' : `組一份新卷：${TIER_LABELS[tier]}`}
        </button>
        <p id={`${id}-hint`} className="text-sm text-muted">
          避開你在這台裝置做過的題組；同一份卷子可以把網址傳給同學一起做。
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium text-bad">
            {error}
          </p>
        )}
      </div>

      <MyPapers rows={rows} persistent={persistent} storageOk={storageOk} />
    </section>
  );
}
