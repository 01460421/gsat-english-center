/**
 * 歷屆試題列表頁。考卷清單（/data/exams/index.json）用 use() 載入；頁首不放在 Suspense 裡，
 * 資料還在下載或下載失敗時，標題與說明照樣顯示。
 * 作答頁在 features/exams/ExamPaperPage.tsx（/exams/:examId）。
 *
 * 桌機（≥ lg，docs/design/desktop-ui.md §5.7）預設是資料表（設定頁可以改回卡片）：整頁放寬（bleed），
 * 說明文字限寬（不超過 48rem）；手機與選了卡片的桌機是下面原本的 JSX。
 */
import { Suspense, useMemo, useState } from 'react';
import { PageHeader } from '../components/ModulePage';
import { ExamList } from '../features/exams/ExamList';
import { DataErrorBoundary } from '../features/exams/components/DataErrorBoundary';
import { forgetFailedLoads } from '../data/client';
import { loadExamIndex } from '../data/exams';
import { useDesktopPref, type ListViewPref } from '../lib/desktopPrefs';
import { useIsDesktop } from '../lib/media';
import { getPage } from '../modules';

export default function ExamsPage() {
  const page = getPage('/exams');
  const [retry, setRetry] = useState(0);
  const isDesktop = useIsDesktop();
  const [listView] = useDesktopPref<ListViewPref>('list-view:exams', 'table');
  const table = isDesktop && listView !== 'cards';
  // 失敗的請求留在快取裡，「再試一次」要先 forgetFailedLoads() 才會重新下載（理由見 data/client.ts 檔頭）。
  const indexPromise = useMemo(() => loadExamIndex(), [retry]);
  const handleRetry = () => {
    forgetFailedLoads();
    setRetry((n) => n + 1);
  };
  const list = (
    <DataErrorBoundary key={retry} onRetry={handleRetry}>
      <Suspense
        fallback={
          <p role="status" className="py-10 text-center text-muted">
            考卷清單載入中…
          </p>
        }
      >
        <ExamList indexPromise={indexPromise} view={table ? 'table' : 'cards'} />
      </Suspense>
    </DataErrorBoundary>
  );
  if (table) {
    return (
      <article className="bleed">
        <PageHeader page={page} className="[&>p]:max-w-3xl" />
        <div className="grid grid-cols-1 gap-4">
          <p className="max-w-3xl text-[0.95rem]">
            點選考卷開始作答：<strong>練習模式</strong>每題寫完就能看答案（有公布統計的試卷另附全國答對率）；<strong>考試模式</strong>依考卷時間倒數計時，交卷後計分。進度會自動存在這台裝置。
          </p>
          {list}
          <footer className="max-w-3xl rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
            試題來源：大學入學考試中心 83–115 學年度學科能力測驗、91–110 學年度指定科目考試英文考科，以及各學年度參考試卷。
            題目、選項與答案依官方公告的試題與答案整理；每份考卷頁都附有官方 PDF 連結，內容如有出入以官方檔案為準。
          </footer>
        </div>
      </article>
    );
  }
  // 桌機選了卡片：/exams 是放寬的列表頁（頁尾放寬，§16.7），卡片維持 944px 但靠左對齊放寬的欄，和頁尾同一條左緣。
  return (
    <article className="lg:bleed lg:[&>*]:max-w-[59rem]">
      <PageHeader page={page} />
      <div className="grid grid-cols-1 gap-4">
        <p className="text-[0.95rem]">
          點選考卷開始作答：<strong>練習模式</strong>每題寫完就能看答案（有公布統計的試卷另附全國答對率）；<strong>考試模式</strong>依考卷時間倒數計時，交卷後計分。進度會自動存在這台裝置。
        </p>
        {list}
        <footer className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
          試題來源：大學入學考試中心 83–115 學年度學科能力測驗、91–110 學年度指定科目考試英文考科，以及各學年度參考試卷。
          題目、選項與答案依官方公告的試題與答案整理；每份考卷頁都附有官方 PDF 連結，內容如有出入以官方檔案為準。
        </footer>
      </div>
    </article>
  );
}
