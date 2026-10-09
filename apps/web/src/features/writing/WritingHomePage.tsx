/**
 * /writing：寫作練習首頁。負責：前端寫作 W2。
 *
 *   - 兩個入口：中譯英（/writing/translation）、英文作文（/writing/essay）；
 *   - 說明兩種模式：AI 批改（登入＋核准，扣點數）與自我檢核（任何人、不用 AI）；
 *   - 未登入或未核准時告訴學生怎麼開通（登入 → /ai/apply）；後端沒部署時只顯示「即將開放」；
 *   - 已登入：剩餘點數與我的寫作紀錄（GET /api/submissions?kind=）。
 * 後端沒部署（features 全關）時這一頁不打任何 API。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { ChevronRight, FileText, Languages } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/ModulePage';
import { getPage } from '../../modules';
import { AiAccessNotice, QuotaSummary } from './components/AiAccessPanel';
import { SubmissionHistory } from './components/SubmissionHistory';
import { AiBadge, card } from './components/ui';
import { useAiAccess, useSignedIn } from './lib/access';
import { useQuota } from './lib/hooks';

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

export default function WritingHomePage() {
  const page = getPage('/writing');
  const access = useAiAccess();
  const signedIn = useSignedIn();
  const { quota } = useQuota(access.state === 'ready');
  return (
    <article>
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <ul className="grid gap-3 sm:grid-cols-2">
          <li className="min-w-0">
            <EntryCard to="/writing/translation" icon={<Languages aria-hidden="true" className="size-6" />} title="中譯英">
              歷屆學測、指考與參考試卷的中譯英，兩句一組，每句 4 分。
            </EntryCard>
          </li>
          <li className="min-w-0">
            <EntryCard to="/writing/essay" icon={<FileText aria-hidden="true" className="size-6" />} title="英文作文">
              歷屆作文題目：看圖、圖表、信函與主題寫作；可以打字，也可以拍照上傳手寫稿。
            </EntryCard>
          </li>
        </ul>

        <section aria-labelledby="modes-heading" className={card}>
          <h2 id="modes-heading" className="text-lg font-semibold">
            兩種批改方式
          </h2>
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
                <p className="text-sm text-muted">本站不提供大考中心的官方參考譯文與範文；需要時請看各題附的官方檔案連結。</p>
              </dd>
            </div>
          </dl>
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
