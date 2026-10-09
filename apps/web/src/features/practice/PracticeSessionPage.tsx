/**
 * 題庫練習的作答頁（/practice/:section/:tier）：題組標題是頁面的 <h1> 與 <title>，上方有回到題庫練習的連結。
 * 抽題、載入、作答、「再一組」都在 BankPractice.tsx（題型頁 /cloze 等內嵌的練習也用同一份、同一份練習紀錄）。
 */
import { ChevronLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { APP_NAME } from '../../modules';
import { SectionBankPractice } from './BankPractice';
import { sectionFromSlug, tierFromParam } from './labels';

function BackLink() {
  return (
    <Link to="/practice" className="mb-1 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-primary">
      <ChevronLeft aria-hidden="true" className="size-4" />
      題庫練習
    </Link>
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

export default function PracticeSessionPage() {
  const params = useParams();
  const section = sectionFromSlug(params['section']);
  const tier = tierFromParam(params['tier']);
  return (
    <article>
      <BackLink />
      {section && tier ? <SectionBankPractice section={section} tier={tier} /> : <NotFound />}
    </article>
  );
}
