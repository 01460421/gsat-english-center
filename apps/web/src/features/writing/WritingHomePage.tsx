/**
 * /writing：寫作練習首頁。負責：前端寫作 W2。
 *
 *   - 兩個入口：中譯英（/writing/translation）、英文作文（/writing/essay）；下面另有「本站仿真題（AI 出題）」兩個入口
 *     （/writing/translation/ai、/writing/essay/ai），再下面是「自己的題目」：自訂作文題目的入口卡（/writing/essay/custom；
 *     docs/design/custom-essay.md §6.1，不匯入 custom-essay 的規則）。說明文字寫死在這裡：不載入題庫資料、不匯入 practice 模組，
 *     首頁的程式不會變大。自訂題目的卡片只在 features.customEssay 是 true 時說「送 AI 批改」（評分對照達標之前是關的）；
 *   - 說明兩種模式：AI 批改（登入＋核准，扣點數）與自我檢核（任何人、不用 AI）；
 *   - 未登入或未核准時告訴學生怎麼開通（登入 → /ai/apply）；後端沒部署時只顯示「即將開放」；
 *   - 已登入：剩餘點數與我的寫作紀錄（GET /api/submissions?kind=）。
 *   - 作文範文（docs/design/model-essays.md §1.4）：開關對這位使用者開放時，「自己的題目」多一張「作文範文」卡片
 *     （ExemplarsEntryCard；關著時 render null，畫面和沒有作文範文時完全相同）。
 * 後端沒部署（features 全關）時這一頁不打任何 API。
 *
 * 桌機（≥ lg，docs/design/desktop-ui.md §5.5）：整頁放寬（bleed），main ≥ ws（58.5rem）時兩欄（container query，一棵樹）：
 * 左欄是入口與「我的寫作紀錄」（表格），右欄（不 sticky）是 AI 點數量表（或開通說明）與收起來的「兩種批改方式」。
 * 入口的三組標題（region「自己的題目」等）照舊，只是排得比較緊。手機是下面原本的 JSX。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { Bot, ChevronRight, FilePen, FileText, Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/ModulePage';
import { useFeatures } from '../../lib/api';
import { getPage } from '../../modules';
import { useIsDesktop } from '../../lib/media';
import { AiAccessNotice, QuotaMeters, QuotaSummary } from './components/AiAccessPanel';
import { SubmissionHistory } from './components/SubmissionHistory';
import { AiBadge, card } from './components/ui';
import { useAiAccess, useSignedIn } from './lib/access';
import { useQuota } from './lib/hooks';
import { ExemplarsEntryCard } from './exemplars/components/ExemplarsButton';
import { useExemplarsEnabled } from './exemplars/lib/useExemplarsEnabled';

function EntryCard({ to, icon, title, children }: { to: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Link to={to} className="group flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary lg:p-5">
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted">{children}</span>
      </span>
      <ChevronRight aria-hidden="true" className="mt-1.5 size-4 shrink-0 text-muted group-hover:text-primary" />
    </Link>
  );
}

/** 「兩種批改方式」的內容（手機是一張卡片；桌機右欄收在 <details> 裡）。 */
function ModesList() {
  return (
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-surface-2 p-4">
        <dt className="flex flex-wrap items-center gap-2 font-semibold">
          AI 批改 <AiBadge />
        </dt>
        <dd className="mt-1 space-y-1 text-[0.95rem]">
          <p>由兩位 AI 評分者依大考的評分方式獨立評分、程式計分，差距太大再加第三位；標出錯誤位置、類型、說明與建議改法。</p>
          <p className="text-sm text-muted">
            需要登入並通過申請。每次扣點數：中譯英 {AI_TASK_POINTS.translation_grade} 點、打字作文 {AI_TASK_POINTS.essay_grade} 點、手寫作文辨識另加{' '}
            {AI_TASK_POINTS.essay_ocr} 點；失敗全額退還。AI 分數僅供參考，不是大考中心的正式評分。
          </p>
        </dd>
      </div>
      <div className="rounded-xl bg-surface-2 p-4">
        <dt className="font-semibold">自我檢核</dt>
        <dd className="mt-1 space-y-1 text-[0.95rem]">
          <p>不用登入、不花點數：依本站整理的檢核清單（時態、主詞動詞一致、冠詞與單複數、詞性、拼字與大小寫、標點、漏譯）逐項檢查，再替自己打分數。</p>
          <p className="text-sm text-muted">
            本站不提供大考中心的官方參考譯文與範文；需要時請看各題附的官方檔案連結。本站仿真題附本站撰寫的參考譯文、評分規準與範文，寫完才顯示。
          </p>
        </dd>
      </div>
    </dl>
  );
}

/** 五個入口（三組，各有標題）；手機與桌機共用。 */
function Entries({ customEssay, compact }: { customEssay: boolean; compact?: boolean }) {
  // 作文範文的卡片只在開關打開時出現；關著時「自己的題目」的外層與原本一模一樣（手機 0 像素差異）。
  const exemplars = useExemplarsEnabled();
  return (
    <>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li className="min-w-0">
          <EntryCard to="/writing/translation" icon={<Languages aria-hidden="true" className="size-6" />} title="中譯英">
            歷屆學測、指考與參考試卷的中譯英；現制是兩句一組，每句 4 分。
          </EntryCard>
        </li>
        <li className="min-w-0">
          <EntryCard to="/writing/essay" icon={<FileText aria-hidden="true" className="size-6" />} title="英文作文">
            歷屆作文題目：看圖、圖表、信函與主題寫作；可以打字，也可以拍照上傳手寫稿。
          </EntryCard>
        </li>
      </ul>

      <section aria-labelledby="bank-heading" className="space-y-3">
        <h2 id="bank-heading" className="text-lg font-semibold">
          本站仿真題（AI 出題）
        </h2>
        <p className={compact ? 'max-w-3xl text-sm text-muted' : 'text-sm text-muted'}>
          AI 依學測題型出題，已通過本站自動驗證、人工審核中，不是大考中心的試題。分穩定基礎、進階練習、超越頂標三種難度，寫完可以對照本站撰寫的參考內容。
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="min-w-0">
            <EntryCard to="/writing/translation/ai" icon={<Bot aria-hidden="true" className="size-6" />} title="本站仿真中譯英">
              兩句一組、同一主題；寫完對照本站參考譯文與 4 部分評分規準。
            </EntryCard>
          </li>
          <li className="min-w-0">
            <EntryCard to="/writing/essay/ai" icon={<Bot aria-hidden="true" className="size-6" />} title="本站仿真作文">
              看圖、圖表寫作，依難度附構思圖、大綱或規劃檢核表；寫完對照評分重點與兩篇範文。
            </EntryCard>
          </li>
        </ul>
      </section>

      <section aria-labelledby="custom-heading" className="space-y-3">
        <h2 id="custom-heading" className="text-lg font-semibold">
          自己的題目
        </h2>
        {/* 包一層：EntryCard 是 h-full，直接放在這個 section（外層 grid 的項目，高度確定）裡會撐到整個 section 高，
            蓋到下面的「兩種批改方式」。其他入口卡在 li 裡，h-full 是為了同列等高。 */}
        <div className={compact ? 'grid gap-3 sm:grid-cols-2' : exemplars ? 'grid gap-3' : undefined}>
          <EntryCard to="/writing/essay/custom" icon={<FilePen aria-hidden="true" className="size-6" />} title="自訂題目">
            {customEssay ? '貼上老師或補習班的作文題目，寫完可以自我檢核或送 AI 批改。' : '貼上老師或補習班的作文題目，寫完可以用檢核清單自我檢核。'}
          </EntryCard>
          <ExemplarsEntryCard />
        </div>
      </section>
    </>
  );
}

export default function WritingHomePage() {
  const page = getPage('/writing');
  const features = useFeatures();
  const access = useAiAccess();
  const signedIn = useSignedIn();
  const { quota } = useQuota(access.state === 'ready');
  const isDesktop = useIsDesktop();
  if (isDesktop) {
    return (
      // text-pretty：入口卡與右欄都窄，段落最後一行不要只剩一兩個字（「批／改。」）。
      <article className="bleed text-pretty">
        <PageHeader page={page} className="[&>p]:max-w-3xl" />
        <div className="grid grid-cols-1 gap-6 @ws/main:grid-cols-[minmax(0,1fr)_20rem] @ws/main:items-start @ws/main:gap-8">
          <div className="grid min-w-0 grid-cols-1 gap-6">
            <Entries customEssay={features.customEssay === true} compact />
            {signedIn && <SubmissionHistory />}
          </div>
          <aside aria-label="AI 批改" className="grid grid-cols-1 gap-4">
            <AiAccessNotice access={access} />
            {access.state === 'ready' && quota && (
              <section aria-labelledby="quota-heading" className={card}>
                <h2 id="quota-heading" className="mb-2 font-semibold">
                  AI 點數
                </h2>
                <QuotaMeters quota={quota} />
              </section>
            )}
            <section aria-labelledby="modes-heading" className={card}>
              <details>
                <summary className="cursor-pointer">
                  <h2 id="modes-heading" className="inline font-semibold">
                    兩種批改方式
                  </h2>
                </summary>
                <div className="[&_dl]:grid-cols-1">
                  <ModesList />
                </div>
              </details>
            </section>
          </aside>
        </div>
      </article>
    );
  }
  return (
    <article>
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <Entries customEssay={features.customEssay === true} />

        <section aria-labelledby="modes-heading" className={card}>
          <h2 id="modes-heading" className="text-lg font-semibold">
            兩種批改方式
          </h2>
          <ModesList />
        </section>

        <AiAccessNotice access={access} />
        {access.state === 'ready' && quota && (
          <div className={card}>
            <QuotaSummary quota={quota} />
          </div>
        )}

        {signedIn && <SubmissionHistory />}
      </div>
    </article>
  );
}
