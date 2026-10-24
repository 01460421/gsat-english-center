/**
 * 唯讀檢視交卷過的題組（/practice/:section/:tier?review=uid@v）：學習助手錯題清單的「本站解析（免費）」
 * （docs/design/learning-assistant.md §5.9）。
 *
 * 按「再一組」之後逐題作答已經清掉，所以作答從本機作答紀錄（outcomes）還原；還沒按「再一組」時用作答紀錄本身。
 * 畫面和交卷後一樣（解析卡、證據句、排除法表、全文中譯），但不能作答，也不寫練習紀錄（current、做過）與作答紀錄，
 * 這一格正在做的題組不受影響。
 */
import { Suspense, use, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { GROUP_KEY_PATTERN } from '@gsat/shared';
import { DataLoadError, forgetFailedLoads } from '../../data/client';
import { groupKey, loadPracticeGroup, type PracticeGroupFile, type PracticeSectionType, type Tier } from '../../data/bank';
import { APP_NAME } from '../../modules';
import { bankAnswersFor, type BankAnswers } from '../assistant/sources/bank';
import { DataErrorBoundary } from '../exams/components/DataErrorBoundary';
import { PRACTICE_SECTION_LABELS, TIER_LABELS, practicePath } from './labels';
import { SourceGate } from './components/GroupSource';
import { GroupSession } from './PracticeSession';

const noop = () => {};

function Notice({ title, text, again }: { title: string; text: string; again: string }) {
  return (
    <section className="space-y-3 py-2">
      <title>{`${title}｜題庫練習｜${APP_NAME}`}</title>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted">{text}</p>
      <Link to={again} className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary">
        做這一組
      </Link>
    </section>
  );
}

function ReviewLoader({ promise, record, again }: { promise: Promise<PracticeGroupFile>; record: BankAnswers; again: string }) {
  const file = use(promise);
  // 出版社題組的授權結束時不顯示題目與解析（SourceGate，docs/design/weak-paper.md §7.6）。
  return (
    <SourceGate file={file}>
      <GroupSession
        key={groupKey(file)}
        file={file}
        notice={null}
        repeatNotice={null}
        onNext={noop}
        review={{ answers: record.answers, submittedAt: record.submittedAt, again }}
      />
    </SourceGate>
  );
}

export function PracticeReview({ reviewKey, section, tier }: { reviewKey: string; section: PracticeSectionType; tier: Tier }) {
  const m = GROUP_KEY_PATTERN.exec(reviewKey);
  const uid = m?.[1] ?? '';
  const version = Number(m?.[2] ?? 0);
  const [retry, setRetry] = useState(0);
  const record = useMemo(() => (uid ? bankAnswersFor(reviewKey) : null), [uid, reviewKey]);
  const promise = useMemo(() => (uid && record ? loadPracticeGroup(uid, version) : null), [uid, version, record, retry]);
  const again = uid ? `${practicePath(section, tier)}?group=${encodeURIComponent(uid)}` : practicePath(section, tier);
  const title = `${PRACTICE_SECTION_LABELS[section]}・${TIER_LABELS[tier]}`;
  if (!record || !promise) {
    return <Notice title={title} text="這台裝置沒有這一組的作答紀錄（作答紀錄只存在作答的那台裝置與瀏覽器）。" again={again} />;
  }
  return (
    <DataErrorBoundary
      key={retry}
      onRetry={() => {
        forgetFailedLoads();
        setRetry((n) => n + 1);
      }}
      renderError={(error) =>
        error instanceof DataLoadError && error.kind === 'not_found' ? (
          <Notice title={title} text="這一組已經改版，舊版的解析看不到了。可以做一次新版本。" again={again} />
        ) : null
      }
    >
      <Suspense
        fallback={
          <p role="status" className="py-10 text-center text-muted">
            題組載入中…
          </p>
        }
      >
        <ReviewLoader promise={promise} record={record} again={again} />
      </Suspense>
    </DataErrorBoundary>
  );
}
