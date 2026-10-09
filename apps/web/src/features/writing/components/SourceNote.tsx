/** 題目出處與大考中心官方檔案連結（只放連結，不轉載評分原則或參考答案內容）。 */
import { Link } from 'react-router';
import type { WritingExamRef } from '../data';
import { ExternalA, primaryButton } from './ui';

export function SourceNote({ exam, extra }: { exam: WritingExamRef & { answer_sheet_url?: string | null }; extra?: string }) {
  return (
    <footer className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
      <p className="font-medium text-fg">題目來源：大學入學考試中心 {exam.title}</p>
      <p>
        本站依官方題本整理題目文字{extra ?? ''}；不轉載官方參考答案、評分原則原文或範文。內容如有出入，以官方檔案為準。
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {exam.paper_url && (
          <li>
            <ExternalA href={exam.paper_url}>官方題本（PDF）</ExternalA>
          </li>
        )}
        {exam.answer_sheet_url && (
          <li>
            <ExternalA href={exam.answer_sheet_url}>官方答題卷（PDF，可印出來手寫練習）</ExternalA>
          </li>
        )}
        {exam.scoring_url && (
          <li>
            <ExternalA href={exam.scoring_url}>官方非選擇題評分原則（PDF）</ExternalA>
          </li>
        )}
      </ul>
    </footer>
  );
}

export function PromptNotFound({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  return (
    <section className="py-6">
      <h1 className="text-2xl font-bold">找不到這個題目</h1>
      <p className="mt-2 text-muted">網址裡的考卷代號可能打錯了，或是這份考卷沒有這種題目。</p>
      <Link to={backTo} className={`mt-4 ${primaryButton}`}>
        {backLabel}
      </Link>
    </section>
  );
}
