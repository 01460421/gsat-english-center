/**
 * 公開的 /privacy（隱私權說明）與 /terms（服務條款）：不必登入就能看全文。
 * Google OAuth 同意畫面的「品牌」設定要求首頁與隱私權政策網址公開可讀；內文和歡迎頁同意的是同一份（policy.ts），
 * 改版時只改 policy.ts。隱私權頁同時附上 AI 處理說明，申請 AI 批改前就能先看資料會怎麼被處理。
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { APP_NAME } from '../../modules';
import { AI_PROCESSING_NOTICE, PRIVACY_POLICY, TERMS_OF_SERVICE, formatVersionDate, type PolicyDoc } from './policy';
import { PolicyFullText } from './PolicyView';
import { cardCls, pageTitleCls, sectionTitleCls } from './styles';

function Summary({ doc, title }: { doc: PolicyDoc; title: string }) {
  return (
    <section aria-label={title} className={cardCls}>
      <h2 className={sectionTitleCls}>{title}</h2>
      <ul className="mt-3 space-y-1.5 text-[0.95rem]">
        {doc.summary.map((line) => (
          <li key={line} className="ml-5 list-disc">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

function VersionLine({ doc }: { doc: PolicyDoc }) {
  return (
    <p className="text-sm text-muted">
      版本 {doc.version}（{formatVersionDate(doc.version)}起適用）
    </p>
  );
}

function PolicyPage({ doc, children, related }: { doc: PolicyDoc; children?: ReactNode; related: { to: string; label: string } }) {
  return (
    <article className="grid grid-cols-1 gap-4">
      <title>{`${doc.title}｜${APP_NAME}`}</title>
      <header>
        <h1 className={pageTitleCls}>{doc.title}</h1>
        <div className="mt-1">
          <VersionLine doc={doc} />
        </div>
      </header>
      <Summary doc={doc} title="重點摘要" />
      <section aria-label="全文" className={cardCls}>
        <h2 className={sectionTitleCls}>全文</h2>
        <PolicyFullText doc={doc} className="mt-3" />
      </section>
      {children}
      <p className="text-sm text-muted">
        另見：
        <Link to={related.to} className="text-primary underline underline-offset-2">
          {related.label}
        </Link>
        、
        <Link to="/about" className="text-primary underline underline-offset-2">
          關於本站
        </Link>
      </p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <PolicyPage doc={PRIVACY_POLICY} related={{ to: '/terms', label: TERMS_OF_SERVICE.title }}>
      <section aria-label={AI_PROCESSING_NOTICE.title} className={cardCls}>
        <h2 className={sectionTitleCls}>{AI_PROCESSING_NOTICE.title}</h2>
        <div className="mt-1">
          <VersionLine doc={AI_PROCESSING_NOTICE} />
        </div>
        <p className="mt-2 text-[0.95rem]">申請 AI 批改時另外同意；沒有申請就不會把你的作答送給 AI。</p>
        <ul className="mt-3 space-y-1.5 text-[0.95rem]">
          {AI_PROCESSING_NOTICE.summary.map((line) => (
            <li key={line} className="ml-5 list-disc">
              {line}
            </li>
          ))}
        </ul>
      </section>
    </PolicyPage>
  );
}

export function TermsPage() {
  return <PolicyPage doc={TERMS_OF_SERVICE} related={{ to: '/privacy', label: PRIVACY_POLICY.title }} />;
}
