/**
 * 題庫練習首頁（/practice）：三種難度給誰（SPEC §3.1）、題型 × 難度的選單（每格幾組、做過幾組；沒有題組顯示「出題中」），
 * 以及 AI 題目怎麼來的（SPEC §5）。題庫索引載入失敗時只有選單區顯示錯誤與「再試一次」，說明照常顯示。
 */
import { ChevronRight } from 'lucide-react';
import { Suspense, use, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { InfoSection, ModulePage } from '../../components/ModulePage';
import { PRACTICE_SECTION_TYPES, loadBankIndex, type BankIndex } from '../../data/bank';
import { forgetFailedLoads } from '../../data/client';
import { getPage } from '../../modules';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { usePracticeHistory } from './history';
import { PRACTICE_SECTION_HINTS, PRACTICE_SECTION_LABELS, TIER_AUDIENCE, TIER_LABELS, TIERS, practicePath } from './labels';
import { cellProgress } from './pick';

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

function PracticeMenu({ indexPromise }: { indexPromise: Promise<BankIndex> }) {
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
    </section>
  );
}

export default function PracticeHome() {
  const [retry, setRetry] = useState(0);
  const indexPromise = useMemo(() => loadBankIndex(), [retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  return (
    <ModulePage page={getPage('/practice')}>
      <TierGuide />
      <DataErrorBoundary key={retry} onRetry={handleRetry}>
        <Suspense
          fallback={
            <p role="status" className="py-6 text-center text-muted">
              題庫載入中…
            </p>
          }
        >
          <PracticeMenu indexPromise={indexPromise} />
        </Suspense>
      </DataErrorBoundary>
      <InfoSection title="AI 題目怎麼來的">
        <ol>
          <li>依 108 課綱與三種難度的規格（文章長度、單字級別、句長、考點）由 AI 出題，文章是 AI 參考事實資料撰寫的原創文章，不是轉載。</li>
          <li>程式檢查格式、單字級別與文章指標；兩位 AI 在看不到答案的情況下各自作答，都答對、而且每一題只有唯一正解才算通過，另有 AI 逐一檢查每個錯誤選項確實是錯的。</li>
          <li>通過自動驗證的題組才會上架，標示「AI 出題・已通過自動驗證・人工審核中」；人工審核會陸續完成。</li>
        </ol>
        <p className="text-sm text-muted">AI 撰寫的文章與解析仍可能有錯；發現問題的回報功能之後會加上。</p>
      </InfoSection>
    </ModulePage>
  );
}
