/**
 * /writing/translation/ai、/writing/essay/ai：本站仿真中譯英與作文的列表（依難度；docs/design/bank-writing.md §2.2）。
 *
 *   1. 先讀 index.json 算出每個難度有幾組；網址沒有 ?tier= 時選第一個有題的難度（都沒有就 basic，顯示「出題中」）。
 *   2. 難度切換用 radio，選擇記在網址的 ?tier=；切換時只下載那個難度的 list/{section}-{tier}.json。
 *   3. 卡片右上角讀這台裝置的草稿：已對照或已送 AI 批改＝「已完成」；有文字＝「草稿」。
 * 題目是 AI 出的：頁首標「AI 出題・已通過自動驗證・人工審核中」，頁尾寫「不是大考中心的試題」。
 *
 * 列表本體（BankPromptList：難度切換、卡片、出題中、頁尾聲明）也內嵌在中譯英、英文作文題型頁（pages/TranslationPage.tsx、
 * pages/CompositionPage.tsx）。在那裡包著 ListOrigin（lib/listOrigin.ts）：卡片帶著題型頁的 state，作答頁的返回連結回到題型頁；
 * 難度的連結一律是「目前這一頁＋?tier=」，不會把人帶離題型頁。題型頁下面還有歷屆試題，所以只先列 limit 張卡片
 * （這台裝置還沒完成的排前面），按「顯示全部」才在原地展開其餘的。
 */
import { TIER_LABELS, TIERS, type Tier } from '@gsat/shared';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { dataErrorMessage } from '../../../data/client';
import { useFeatures } from '../../../lib/api';
import { APP_NAME } from '../../../modules';
import { AiGroupBadge } from '../../practice/components/AiGroupBadge';
import { displayTopic } from '../../practice/labels';
import { SourceTabs } from '../components/SourceTabs';
import { BackLink, DataError, Loading, secondaryButton } from '../components/ui';
import type { BankProgress } from './drafts';
import { ESSAY_TYPE_LABELS } from '../lib/format';
import { useStaticData } from '../lib/hooks';
import { useListOriginState } from '../lib/listOrigin';
import { BankSourceNote } from './components/BankSourceNote';
import {
  bankAttemptPath,
  loadBankTierList,
  loadWritingBankIndex,
  type BankEssayCard,
  type BankTranslationCard,
  type BankWritingSection,
  type WritingBankIndex,
} from './data';
import { BANK_SECTION_TITLES, WRITING_TIER_HINTS } from './labels';
import { progressOf } from './useBankItem';

function tierFromParam(value: string | null): Tier | null {
  return (TIERS as readonly string[]).includes(value ?? '') ? (value as Tier) : null;
}

function countsOf(index: WritingBankIndex, section: BankWritingSection): Record<Tier, number> {
  return Object.fromEntries(TIERS.map((t) => [t, index.groups.filter((g) => g.section_type === section && g.tier === t).length])) as Record<Tier, number>;
}

/** 每個難度在這台裝置「已完成」幾組（已對照或已送 AI 批改；同卡片右上角的標示）。 */
function doneCountsOf(index: WritingBankIndex, section: BankWritingSection): Record<Tier, number> {
  return Object.fromEntries(
    TIERS.map((t) => [t, index.groups.filter((g) => g.section_type === section && g.tier === t && progressOf(g) === 'done').length]),
  ) as Record<Tier, number>;
}

function ProgressBadge({ progress }: { progress: BankProgress }) {
  // 字用本文色（綠字在淺綠底上只有約 4.4:1，不到 AA 的 4.5:1）；綠色留給底色與勾勾圖示。
  if (progress === 'done')
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-xs font-semibold text-fg">
        <CircleCheck aria-hidden="true" className="size-3.5 text-ok" />
        已完成
      </span>
    );
  if (progress === 'draft') return <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">草稿</span>;
  return null;
}

function TranslationCard({ card, linkRef }: { card: BankTranslationCard; linkRef?: Ref<HTMLAnchorElement> }) {
  const topic = displayTopic(card.topic) ?? '中譯英';
  const progress = progressOf({ uid: card.uid, version: card.version, section_type: 'translation' });
  const origin = useListOriginState();
  return (
    <Link ref={linkRef} to={bankAttemptPath(card.uid) ?? '#'} state={origin} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-primary">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-lg font-semibold">{topic}</span>
        <ProgressBadge progress={progress} />
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      <ol className="list-decimal space-y-1 pl-5 text-[0.95rem]">
        {card.stems.map((s) => (
          <li key={s} className="break-words">
            {s}
          </li>
        ))}
      </ol>
    </Link>
  );
}

function EssayCard({ card, linkRef }: { card: BankEssayCard; linkRef?: Ref<HTMLAnchorElement> }) {
  const topic = displayTopic(card.topic) ?? '英文作文';
  const progress = progressOf({ uid: card.uid, version: card.version, section_type: 'composition' });
  const origin = useListOriginState();
  return (
    <Link ref={linkRef} to={bankAttemptPath(card.uid) ?? '#'} state={origin} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-surface p-4 hover:border-primary">
      <span className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-lg font-semibold">{topic}</span>
          {card.essay_type && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{ESSAY_TYPE_LABELS[card.essay_type] ?? '其他'}</span>}
        </span>
        <ProgressBadge progress={progress} />
        <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
      </span>
      <span className="break-words text-[0.95rem]">{card.prompt_excerpt}</span>
      {card.figure_count > 0 && <span className="text-sm text-muted">附圖 {card.figure_count} 張</span>}
    </Link>
  );
}

/**
 * 只先列 limit 張時的順序：這台裝置還沒完成的排前面（同一類維持列表檔的順序），打開題型頁就看得到還沒做過的題目。
 * 沒有 limit（列表頁）照列表檔的順序全部列出。
 */
function shownCards<C extends { uid: string; version: number }>(cards: readonly C[], section: BankWritingSection, limit: number | undefined, expanded: boolean): C[] {
  if (limit === undefined) return [...cards];
  const done = (c: C) => progressOf({ uid: c.uid, version: c.version, section_type: section }) === 'done';
  const ordered = [...cards.filter((c) => !done(c)), ...cards.filter(done)];
  return expanded ? ordered : ordered.slice(0, limit);
}

function TierCards({ section, tier, limit }: { section: BankWritingSection; tier: Tier; limit: number | undefined }) {
  const data = useStaticData(() => loadBankTierList(section, tier));
  const [expanded, setExpanded] = useState(false);
  // 按「顯示全部」後按鈕消失，焦點移到第一張新出現的卡片（鍵盤與螢幕閱讀器接著往下看，不會掉回頁首）。
  const firstNewRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (expanded) firstNewRef.current?.focus();
  }, [expanded]);
  if (data.status === 'loading') return <Loading>題目載入中…</Loading>;
  if (data.status === 'error') return <DataError message={dataErrorMessage(data.error)} onRetry={data.retry} />;
  const list = data.value;
  const total = list.groups.length;
  const hidden = limit !== undefined && !expanded && total > limit;
  const refAt = (i: number) => (limit !== undefined && i === limit ? firstNewRef : undefined);
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        {list.section_type === 'translation'
          ? shownCards(list.groups, section, limit, expanded).map((c, i) => (
              <li key={c.uid} className="min-w-0">
                <TranslationCard card={c} linkRef={refAt(i)} />
              </li>
            ))
          : shownCards(list.groups, section, limit, expanded).map((c, i) => (
              <li key={c.uid} className="min-w-0">
                <EssayCard card={c} linkRef={refAt(i)} />
              </li>
            ))}
      </ul>
      {hidden && (
        <p className="mt-3">
          <button type="button" onClick={() => setExpanded(true)} className={secondaryButton}>
            顯示全部 {total} {section === 'translation' ? '組' : '題'}
          </button>
        </p>
      )}
    </>
  );
}

/**
 * 難度切換（radio，選擇記在網址 ?tier=）：每個難度顯示有幾組（題）、這台裝置已完成幾組；還沒有題目的難度顯示「出題中」，
 * 仍然可以選，下面說明出題中。外觀和題型頁題庫練習的難度切換（practice/BankPractice.tsx 的 TierSwitcher）一樣：
 * 三格並排，320px 手機上也排得下（數字太長時換成兩行）。
 */
function TierPicker({
  section,
  value,
  counts,
  done,
  onChange,
}: {
  section: BankWritingSection;
  value: Tier;
  counts: Record<Tier, number>;
  done: Record<Tier, number>;
  onChange: (t: Tier) => void;
}) {
  const unit = section === 'translation' ? '組' : '題';
  return (
    <fieldset className="min-w-0">
      {/* 三格本身就寫著難度名稱，「難度」只給螢幕閱讀器（同題庫練習的難度切換），手機上題目才早一點出現。 */}
      <legend className="sr-only">難度</legend>
      {/* 寬螢幕不撐滿整欄：三格像一組切換鈕，不像三張大卡片。 */}
      <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
        {TIERS.map((t) => {
          const tone =
            counts[t] > 0
              ? 'border-primary/50 bg-primary-soft text-fg hover:border-primary'
              : 'border-dashed border-line bg-surface-2 text-muted hover:border-primary';
          return (
            <label
              key={t}
              className={`flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 text-center ${tone} has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary`}
            >
              <input type="radio" name={`bank-tier-${section}`} value={t} checked={value === t} onChange={() => onChange(t)} className="sr-only" />
              <span className="text-sm font-semibold">{TIER_LABELS[t]}</span>
              <span className="text-xs tabular-nums">
                {counts[t] > 0 ? (
                  <>
                    <span className="whitespace-nowrap">
                      {counts[t]} {unit}
                    </span>
                    {done[t] > 0 && <span className="whitespace-nowrap">・已完成 {done[t]}</span>}
                  </>
                ) : (
                  '出題中'
                )}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted">{WRITING_TIER_HINTS[section][value]}</p>
    </fieldset>
  );
}

function BankLists({ section, index, headingLevel, limit }: { section: BankWritingSection; index: WritingBankIndex; headingLevel: 2 | 3; limit: number | undefined }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const headingId = useId();
  const counts = countsOf(index, section);
  const done = doneCountsOf(index, section);
  const tier = tierFromParam(params.get('tier')) ?? TIERS.find((t) => counts[t] > 0) ?? 'basic';
  const setTier = (t: Tier) => {
    const p = new URLSearchParams(params);
    p.set('tier', t);
    setParams(p, { replace: true });
  };
  // 「出題中」裡其他難度的連結：留在目前這一頁（列表頁或題型頁），只換 ?tier=，其他參數（題型頁的 ?kind=）照留。
  const tierHref = (t: Tier) => {
    const p = new URLSearchParams(params);
    p.set('tier', t);
    return `${pathname}?${p.toString()}`;
  };
  const others = TIERS.filter((t) => t !== tier && counts[t] > 0);
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <>
      <TierPicker section={section} value={tier} counts={counts} done={done} onChange={setTier} />
      <section aria-labelledby={headingId}>
        <Heading id={headingId} className="mb-3 text-lg font-semibold">
          {TIER_LABELS[tier]}
          <span className="ml-2 text-sm font-normal text-muted">
            {counts[tier]} {section === 'translation' ? '組' : '題'}
          </span>
        </Heading>
        {counts[tier] > 0 ? (
          <TierCards key={tier} section={section} tier={tier} limit={limit} />
        ) : (
          <div role="status" className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-3 text-sm">
            <p>這個難度還在出題中：題目要通過自動驗證才會上架。</p>
            {others.length > 0 && (
              <p className="mt-1">
                現在有題目的難度：
                {others.map((t, i) => (
                  <span key={t}>
                    {i > 0 && '、'}
                    <Link to={tierHref(t)} className="font-medium text-primary underline underline-offset-2">
                      {TIER_LABELS[t]}（{counts[t]}）
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/**
 * 列表本體（難度切換、卡片、出題中、頁尾聲明）：/writing/{translation|essay}/ai 與中譯英、英文作文題型頁共用。
 * 難度標題預設是 <h2>；題型頁把列表放在「本站仿真題」<h2> 底下，傳 headingLevel={3}，並用 limit 只先列幾張卡片。
 */
export function BankPromptList({
  section,
  className = '',
  headingLevel = 2,
  limit,
}: {
  section: BankWritingSection;
  className?: string;
  headingLevel?: 2 | 3;
  /** 先列幾張卡片（其餘按「顯示全部」展開）；不給就全部列出。 */
  limit?: number;
}) {
  const index = useStaticData(loadWritingBankIndex);
  return (
    <div className={`space-y-6 ${className}`}>
      {index.status === 'loading' && <Loading>題目載入中…</Loading>}
      {index.status === 'error' && <DataError message={dataErrorMessage(index.error)} onRetry={index.retry} />}
      {index.status === 'ready' && <BankLists section={section} index={index.value} headingLevel={headingLevel} limit={limit} />}
      <BankSourceNote />
    </div>
  );
}

function BankListPage({ section }: { section: BankWritingSection }) {
  const title = BANK_SECTION_TITLES[section];
  // 後端沒部署（或登入、AI 沒開）時沒有登入入口，不能叫學生「登入並通過申請」。
  const features = useFeatures();
  const aiOpen = features.auth && features.ai;
  return (
    <article>
      <title>{`${title}｜${APP_NAME}`}</title>
      <BackLink to="/writing">寫作練習</BackLink>
      <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
      <SourceTabs kind={section === 'translation' ? 'translation' : 'essay'} current="bank" />
      <div className="mt-3">
        <AiGroupBadge />
      </div>
      <p className="mt-3 text-muted">
        {section === 'translation'
          ? `AI 依學測題型出的中譯英，不是大考中心的試題。兩句都寫完，可以對照本站撰寫的參考譯文與 4 部分評分規準自我檢核${aiOpen ? '；登入並通過申請後，也能送 AI 批改' : ''}。`
          : `AI 依學測題型出的看圖、圖表寫作，不是大考中心的試題。寫完可以對照本站的評分重點與兩篇範文自我檢核${aiOpen ? `；登入並通過申請後，也能送 AI 批改${features.ocr ? '或拍照上傳手寫稿' : ''}` : ''}。`}
      </p>
      <BankPromptList section={section} className="mt-6" />
    </article>
  );
}

/** 路由用（App.tsx 依路徑掛上對應的題型）。 */
export function BankTranslationListPage() {
  return <BankListPage section="translation" />;
}

export function BankEssayListPage() {
  return <BankListPage section="composition" />;
}
