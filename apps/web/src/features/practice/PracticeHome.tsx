/**
 * 題庫練習首頁（/practice）：三種難度給誰（SPEC §3.1）、題型 × 難度的選單（每格幾組、做過幾組；沒有題組顯示「出題中」），
 * 以及 AI 題目怎麼來的（SPEC §5）。題庫索引載入失敗時只有選單區顯示錯誤與「再試一次」，說明照常顯示。
 *
 * 桌機（docs/design/desktop-ui.md §5.2）：
 *   - lg 起選單改成「題型 × 難度」矩陣表格（useMediaQuery 二選一，R3），每格兩行：「25 組」「已做 3・72%」；
 *     連結的可存取名稱一字不改（「詞彙題・穩定基礎：25 組，已做 3 組」，答對率放 aria-describedby），沒有題組的格仍是
 *     role="group"、名稱「…：出題中」（tests/practice.spec.ts、overview.spec.ts 用這些名稱）；
 *   - main ≥ ws（58.5rem）放寬（bleed）成兩欄：左邊矩陣，右欄（不 sticky）是精簡的「三種難度給誰」、「AI 題目怎麼來的」與
 *     本站仿真中譯英、作文的連結。不到 ws 時三種難度的說明留在原來的位置。這一頁沒有輸入框，依 useMainTier 換樹沒有焦點問題（R4）。
 */
import { ChevronRight } from 'lucide-react';
import { Suspense, use, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { InfoSection, ModulePage, PageHeader } from '../../components/ModulePage';
import { PRACTICE_SECTION_TYPES, loadPracticeIndex, type BankIndex, type PracticeSectionType, type Tier } from '../../data/bank';
import { forgetFailedLoads } from '../../data/client';
import { useIsDesktop, useMainTier } from '../../lib/media';
import { getPage } from '../../modules';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { formatPercent } from '../exams/scoring';
import { usePracticeHistory, type PracticeHistory } from './history';
import { PRACTICE_SECTION_HINTS, PRACTICE_SECTION_LABELS, TIER_AUDIENCE, TIER_LABELS, TIERS, practicePath } from './labels';
import { cellAccuracy, cellProgress } from './pick';

/** 右欄的精簡版「三種難度給誰」（ws 寬度）：同樣的標題與文字，一難度一行。 */
function TierGuideCompact() {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-line bg-surface p-4">
      <h2 id={titleId} className="font-semibold">
        三種難度給誰
      </h2>
      <dl className="mt-2 space-y-2 text-sm">
        {TIERS.map((tier) => (
          <div key={tier}>
            <dt className="font-semibold text-primary">{TIER_LABELS[tier]}</dt>
            <dd>{TIER_AUDIENCE[tier].who}</dd>
            <dd className="text-muted">題目難度：{TIER_AUDIENCE[tier].level}。</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">
        練習時答對率約七成最有效率：常常全對就往上一級，錯一半以上就往下一級。級分是本站依 111–115 學年度級分人數換算的非官方對照。
      </p>
    </section>
  );
}

function TierGuide() {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={titleId} className="text-lg font-semibold">
        三種難度給誰
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {TIERS.map((tier) => (
          <li key={tier} className="rounded-xl bg-surface-2 p-4">
            <p className="font-semibold text-primary">{TIER_LABELS[tier]}</p>
            <p className="mt-1 text-[0.95rem]">{TIER_AUDIENCE[tier].who}</p>
            <p className="mt-1 text-sm text-muted">題目難度：{TIER_AUDIENCE[tier].level}。</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        練習時答對率約七成最有效率：常常全對就往上一級，錯一半以上就往下一級。級分是本站依 111–115 學年度級分人數換算的非官方對照。
      </p>
    </section>
  );
}

/**
 * 桌機的矩陣（lg 起）：真的 <table>，列是題型、欄是難度。每格一個連結（Tab 順序就是列由上到下、格由左到右），
 * 名稱沿用卡片的格式；答對率是看得到的文字，另外用 aria-describedby 讀出來。
 */
function PracticeMatrix({ index, history }: { index: BankIndex; history: PracticeHistory }) {
  const idBase = useId();
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-2xl border border-line bg-surface text-[0.95rem] text-pretty">
      <caption className="sr-only">題型 × 難度</caption>
      <colgroup>
        <col className="w-[28%]" />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="border-b border-line px-4 py-2.5 text-left text-sm font-semibold text-muted">
            題型
          </th>
          {TIERS.map((tier) => (
            <th key={tier} scope="col" className="border-b border-line px-2 py-2.5 text-left text-sm font-semibold text-muted">
              {TIER_LABELS[tier]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PRACTICE_SECTION_TYPES.map((section, row) => (
          <tr key={section}>
            <th scope="row" className={`px-4 py-3 text-left align-top font-normal ${row > 0 ? 'border-t border-line' : ''}`}>
              <span className="block font-semibold">{PRACTICE_SECTION_LABELS[section]}</span>
              <span className="block text-sm text-muted">{PRACTICE_SECTION_HINTS[section]}</span>
            </th>
            {TIERS.map((tier) => (
              <td key={tier} className={`px-1.5 py-2 align-middle ${row > 0 ? 'border-t border-line' : ''}`}>
                <MatrixCell index={index} history={history} section={section} tier={tier} describedById={`${idBase}-${section}-${tier}`} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 矩陣的一格：固定兩行，所有格一樣高（min-h-16）：第 1 行「25 組」＋箭頭，第 2 行「已做 3・72%」或「還沒做」（text-xs、不換行）。
 * 格子在 1242 寬時只剩約 100px，一整段「25 組・已做 3・答對 72%」會斷成三、四行，而且把「已做」和數字拆開。
 * 畫面上省掉「答對」兩個字，讀屏從 aria-describedby 聽到「答對 72%」（sr-only），連結名稱照舊。
 */
function MatrixCell({
  index,
  history,
  section,
  tier,
  describedById,
}: {
  index: BankIndex;
  history: PracticeHistory;
  section: PracticeSectionType;
  tier: Tier;
  describedById: string;
}) {
  const { total, done } = cellProgress(index.groups, history, section, tier);
  const accuracy = cellAccuracy(index.groups, history, section, tier);
  const name = `${PRACTICE_SECTION_LABELS[section]}・${TIER_LABELS[tier]}`;
  if (total === 0) {
    return (
      <div role="group" aria-label={`${name}：出題中`} className="flex min-h-16 items-center rounded-xl border border-dashed border-line bg-surface-2 px-2.5 py-2 text-sm text-muted">
        出題中
      </div>
    );
  }
  return (
    <Link
      to={practicePath(section, tier)}
      aria-label={`${name}：${total} 組，已做 ${done} 組`}
      aria-describedby={accuracy ? describedById : undefined}
      className="group flex min-h-16 flex-col justify-center rounded-xl border border-primary/50 bg-primary-soft px-2.5 py-2 hover:border-primary hover:bg-primary-soft/60"
    >
      <span className="flex items-center justify-between gap-1 text-sm tabular-nums">
        <span className="whitespace-nowrap">
          <strong className="text-base">{total}</strong> 組
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
      </span>
      <span className="block h-4 text-xs leading-4 whitespace-nowrap text-muted tabular-nums">
        {done === 0 && '還沒做'}
        {done > 0 && `已做 ${done}`}
        {done > 0 && accuracy && '・'}
        {accuracy && (
          <span id={describedById}>
            <span className="sr-only">答對 </span>
            {formatPercent(accuracy.correct / accuracy.total)}
          </span>
        )}
      </span>
    </Link>
  );
}

/** 本站仿真中譯英、作文的連結（題庫練習只有選擇與混合題；寫作題在寫作練習）。 */
function WritingBankLinks({ className = '' }: { className?: string }) {
  return (
    <p className={className ? `text-sm text-muted ${className}` : 'text-sm text-muted'}>
      中譯英、英文作文的仿真題在寫作練習：
      <Link to="/writing/translation/ai" className="mx-1 font-medium text-primary underline underline-offset-2">
        本站仿真中譯英
      </Link>
      、
      <Link to="/writing/essay/ai" className="mx-1 font-medium text-primary underline underline-offset-2">
        本站仿真作文
      </Link>
    </p>
  );
}

function PracticeMenu({ indexPromise, layout = 'cards' }: { indexPromise: Promise<BankIndex>; layout?: 'cards' | 'matrix' | 'matrix-rail' }) {
  const index = use(indexPromise);
  const history = usePracticeHistory().value;
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="text-lg font-semibold">
        選題型與難度
      </h2>
      {index.groups.length === 0 ? (
        <p role="status" className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm">
          AI 題庫正在出題與驗證中：題組要通過自動驗證才會上架，第一批通過後就會出現在下面的格子裡。
        </p>
      ) : (
        <p className="text-sm text-muted">
          共 {index.groups.length} 組。每次從選的那一格抽一組你還沒做過的；做過的紀錄只存在這台裝置的瀏覽器。
        </p>
      )}
      {layout !== 'cards' ? (
        <PracticeMatrix index={index} history={history} />
      ) : (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PRACTICE_SECTION_TYPES.map((section) => (
          <li key={section} className="min-w-0 rounded-2xl border border-line bg-surface p-4">
            <h3 className="font-semibold">{PRACTICE_SECTION_LABELS[section]}</h3>
            <p className="text-sm text-muted">{PRACTICE_SECTION_HINTS[section]}</p>
            <ul className="mt-3 grid grid-cols-3 gap-2">
              {TIERS.map((tier) => {
                const { total, done } = cellProgress(index.groups, history, section, tier);
                const name = `${PRACTICE_SECTION_LABELS[section]}・${TIER_LABELS[tier]}`;
                return (
                  <li key={tier} className="min-w-0">
                    {total > 0 ? (
                      <Link
                        to={practicePath(section, tier)}
                        aria-label={`${name}：${total} 組，已做 ${done} 組`}
                        className="group flex h-full min-h-20 flex-col justify-between rounded-xl border border-primary/50 bg-primary-soft px-2.5 py-2 hover:border-primary"
                      >
                        <span className="text-sm font-semibold text-primary">{TIER_LABELS[tier]}</span>
                        <span className="flex items-end justify-between gap-1">
                          <span className="text-xs tabular-nums">
                            <span className="text-base font-bold">{total}</span> 組
                            {done > 0 && <span className="block text-muted">已做 {done}</span>}
                          </span>
                          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        </span>
                      </Link>
                    ) : (
                      <div
                        aria-label={`${name}：出題中`}
                        role="group"
                        className="flex h-full min-h-20 flex-col justify-between rounded-xl border border-dashed border-line bg-surface-2 px-2.5 py-2 text-muted"
                      >
                        <span className="text-sm font-semibold">{TIER_LABELS[tier]}</span>
                        <span className="text-xs">出題中</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      )}
      {layout !== 'matrix-rail' && <WritingBankLinks />}
    </section>
  );
}

function AiOrigin() {
  return (
    <InfoSection title="AI 題目怎麼來的">
      <ol>
        <li>依 108 課綱與三種難度的規格（文章長度、單字級別、句長、考點）由 AI 出題，文章是 AI 參考事實資料撰寫的原創文章，不是轉載。</li>
        <li>程式檢查格式、單字級別與文章指標；兩位 AI 在看不到答案的情況下各自作答，都答對、而且每一題只有唯一正解才算通過，另有 AI 逐一檢查每個錯誤選項確實是錯的。</li>
        <li>通過自動驗證的題組才會上架，標示「AI 出題・已通過自動驗證・人工審核中」；人工審核會陸續完成。</li>
      </ol>
      <p className="text-sm text-muted">AI 撰寫的文章與解析仍可能有錯；發現問題的回報功能之後會加上。</p>
    </InfoSection>
  );
}

export default function PracticeHome() {
  const [retry, setRetry] = useState(0);
  const indexPromise = useMemo(() => loadPracticeIndex(), [retry]);
  const isDesktop = useIsDesktop();
  const { ws } = useMainTier();
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  const menu = (layout: 'cards' | 'matrix' | 'matrix-rail') => (
    <DataErrorBoundary key={retry} onRetry={handleRetry}>
      <Suspense
        fallback={
          <p role="status" className="py-6 text-center text-muted">
            題庫載入中…
          </p>
        }
      >
        <PracticeMenu indexPromise={indexPromise} layout={layout} />
      </Suspense>
    </DataErrorBoundary>
  );
  if (ws) {
    // 桌機 ws 寬度：放寬成兩欄，DOM 順序是頁首 → 矩陣 → 右欄。
    return (
      <article className="bleed">
        <PageHeader page={getPage('/practice')} className="[&>p]:max-w-3xl" />
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-8">
          <div className="min-w-0">{menu('matrix-rail')}</div>
          <aside aria-label="難度與題目說明" className="space-y-4 [&_section]:p-4 [&_section_h2]:text-base">
            <TierGuideCompact />
            <AiOrigin />
            <WritingBankLinks className="px-1" />
          </aside>
        </div>
      </article>
    );
  }
  return (
    <ModulePage page={getPage('/practice')}>
      <TierGuide />
      {menu(isDesktop ? 'matrix' : 'cards')}
      <AiOrigin />
    </ModulePage>
  );
}
