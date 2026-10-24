/**
 * 題庫練習的作答頁（/practice/:section/:tier）：題組標題是頁面的 <h1> 與 <title>，上方有回到題庫練習的連結。
 * 抽題、載入、作答、「再一組」都在 BankPractice.tsx（題型頁 /cloze 等內嵌的練習也用同一份、同一份練習紀錄）。
 * ?review=uid@v 是唯讀檢視交卷過的那一組（PracticeReview.tsx）。
 */
import { GROUP_KEY_PATTERN, PRACTICE_ITEM_UID_PATTERN } from '@gsat/shared';
import { ChevronLeft } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { APP_NAME } from '../../modules';
import { SectionBankPractice } from './BankPractice';
import { sectionFromSlug, tierFromParam } from './labels';
import { PracticeReview } from './PracticeReview';

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

/**
 * ?group=：指定題組的 uid（學習助手的推薦練習、確認頁的「做新版本」；docs/design/learning-assistant.md §2.4）。
 * 本站題庫（ai.）與出版社題組（pb.，docs/design/weak-paper.md §8.2）都收。
 */
const UID_RE = PRACTICE_ITEM_UID_PATTERN;

export default function PracticeSessionPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const section = sectionFromSlug(params['section']);
  const tier = tierFromParam(params['tier']);
  const group = search.get('group');
  const preferUid = group && UID_RE.test(group) ? group : null;
  // ?review=uid@v：唯讀檢視交卷過的那一組（錯題清單的「本站解析（免費）」，§5.9）。
  const review = search.get('review');
  const reviewKey = review && GROUP_KEY_PATTERN.test(review) ? review : null;
  return (
    <article>
      <BackLink />
      {!section || !tier ? (
        <NotFound />
      ) : reviewKey ? (
        <PracticeReview key={reviewKey} reviewKey={reviewKey} section={section} tier={tier} />
      ) : (
        <SectionBankPractice key={preferUid ?? ''} section={section} tier={tier} preferUid={preferUid} />
      )}
    </article>
  );
}
