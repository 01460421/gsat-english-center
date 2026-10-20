/**
 * 模擬考列表頁（/mock，SPEC §6.11、設計文件 §6.1）：111–115 學測與 115 參考試卷，每份顯示作答狀態與動作、
 * 這台裝置的作答紀錄、考前節奏建議、現行配分與聲明。
 * 作答頁在 features/mock/MockSessionPage.tsx（/mock/:paperId），成績單在 features/mock/MockReportPage.tsx。
 *
 * 桌機（≥ lg，docs/design/desktop-ui.md §5.8）：整頁放寬（bleed），卷別是列式卡片（MockPaperList.tsx）；
 * main ≥ 80rem（wide）時考前節奏建議與配分表移到右欄（不 sticky），不到時排在下面、限寬 48rem。
 * 桌機只有一棵樹、靠 container query 換排法（卷別卡片裡有「下載 PDF」的展開狀態，寬度改變時不能重新掛載，R4）。
 * 例外是右欄裡的配分：20rem 放不下三欄的表格（「第壹部分 選擇題」會斷成三行），wide 時依 useMainTier 換成一部分一段的
 * 清單（名稱＋配分一行、內容下一行）。這一小塊沒有輸入元件，換樹沒有焦點問題（R4）。
 *
 * 本站自組模擬考（docs/design/bank-mock.md §2.1）：bankMockVisible() 為真時，在 <MockPaperList /> 之後 lazy 載入
 * 「本站自組模擬考」區塊（手機、桌機兩棵樹都在「考前節奏建議」之前），Intro 加一句「級分與五標只適用於歷屆卷。」與跳到 #bank-mock 的連結，
 * 頁尾聲明加一行。為假時這一頁和原本完全相同。
 */
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { InfoSection, ModulePage, PageHeader } from '../components/ModulePage';
import { MockPaperList } from '../features/mock/MockPaperList';
import { bankMockVisible } from '../features/mock/bank/flags';
import { pdfDownloadVisible } from '../features/pdf/index';
import { useIsDesktop, useMainTier } from '../lib/media';
import { getPage } from '../modules';

const PARTS = [
  ['第壹部分 選擇題', '62 分', '詞彙 10、綜合測驗 10、文意選填 10、篇章結構 8、閱讀測驗 24'],
  ['第貳部分 混合題', '10 分', '一個題組，填充、多選、簡答'],
  ['第參部分 非選擇題', '28 分', '中譯英 8、英文作文 20'],
] as const;

/** 本站自組模擬考的區塊（組卷程式只在這個區塊用到，lazy 載入）。 */
const BankMockSection = lazy(() => import('../features/mock/bank/BankMockSection'));

function Intro({ className, bank = false }: { className?: string; bank?: boolean }) {
  return (
    <p className={className ? `text-[0.95rem] ${className}` : 'text-[0.95rem]'}>
      用大考中心公布的真題整份計時作答：100 分鐘倒數、一次一個大題、不確定的題目可以標記；交卷後看原得總分、各大題得分與用時、
      <strong>級分（非官方）</strong>與五標位置。考試中不提供答案與提示。作答與成績只存在這台裝置的瀏覽器。
      {bank && (
        <>
          級分與五標只適用於歷屆卷。
          <a href="#bank-mock" className="mt-1 block font-medium text-primary underline underline-offset-2">
            也可以從本站題庫依難度組一份新卷 ↓
          </a>
        </>
      )}
    </p>
  );
}

function BankSection() {
  return (
    <Suspense fallback={null}>
      <BankMockSection />
    </Suspense>
  );
}

export default function MockExamPage() {
  const [pdfVisible] = useState(pdfDownloadVisible);
  const [bankVisible] = useState(bankMockVisible);
  const isDesktop = useIsDesktop();
  const { wide } = useMainTier();
  if (isDesktop) {
    const rhythm = <Rhythm pdfVisible={pdfVisible} partsAsList={wide} />;
    return (
      // text-pretty：列式卡片與右欄的欄寬窄，段落最後一行不要只剩一兩個字。
      <article className="bleed text-pretty">
        <PageHeader page={getPage('/mock')} className="[&>p]:max-w-3xl" />
        <div className="grid grid-cols-1 gap-4 @wide/main:grid-cols-[minmax(0,1fr)_20rem] @wide/main:items-start @wide/main:gap-8">
          <div className="grid min-w-0 grid-cols-1 gap-4">
            <Intro className="max-w-3xl" bank={bankVisible} />
            <MockPaperList />
            {bankVisible && <BankSection />}
            <Disclaimer className="max-w-3xl" bank={bankVisible} />
          </div>
          <aside aria-label="考前準備" className="grid max-w-3xl grid-cols-1 gap-4 @wide/main:max-w-none @wide/main:[&_section]:p-4 @wide/main:[&_section_h2]:text-base">
            {rhythm}
          </aside>
        </div>
      </article>
    );
  }
  return (
    <ModulePage page={getPage('/mock')}>
      <Intro bank={bankVisible} />
      <MockPaperList />
      {bankVisible && <BankSection />}
      <Rhythm pdfVisible={pdfVisible} />
      <Disclaimer bank={bankVisible} />
    </ModulePage>
  );
}

function Disclaimer({ className, bank = false }: { className?: string; bank?: boolean }) {
  return (
    <footer className={className ? `space-y-1 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted ${className}` : 'space-y-1 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted'}>
      <p className="font-semibold text-fg">模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果。</p>
      <p>目前非選擇題（中譯英、英文作文）為自評分數；級分依各學年度大考中心公布的原得總分與級分對照表換算。</p>
      <p>試題來源：大學入學考試中心 111–115 學年度學科能力測驗英文考科、學科能力測驗參考試卷（115 學年度起適用）英文考科。</p>
      {bank && <p>本站自組模擬考的題目由 AI 撰寫（參考資料列在各卷頁尾），只給原始分數，不換算級分；以上試題來源與級分說明只適用於歷屆卷。</p>}
    </footer>
  );
}

/** 考前節奏建議與現行配分（手機排在卷別下面；桌機 wide 寬度放右欄，配分改成清單：partsAsList）。 */
function Rhythm({ pdfVisible, partsAsList = false }: { pdfVisible: boolean; partsAsList?: boolean }): ReactNode {
  return (
    <>
      <InfoSection title="考前節奏建議">
        <ul>
          <li>考前 8 週起每 2 週做一份，最後 2 週每週做一份；其他時間用歷屆試題與題型練習補弱。</li>
          <li>建議順序就是上面的卷別順序：115 參考試卷有 49 題沿用歷屆試題（30 題來自 111 學測），先做參考試卷再做 111 學測，111 學測才是沒看過的卷子。</li>
          <li>想模擬正式考試，開考前勾選「實考模式」：開考後 60 分鐘內不能交卷，比照正式考試入場後 60 分鐘內不得離場。</li>
          {pdfVisible && <li>想寫紙本：每份卷子都能下載考試格式 PDF（附答題卷），列印後計時作答。</li>}
        </ul>
      </InfoSection>
      <InfoSection title="現行學測英文的配分">
        <p>考試時間 100 分鐘，滿分 100 分。</p>
        {partsAsList ? (
          <dl className="mt-2 divide-y divide-line text-sm">
            {PARTS.map(([part, points, detail]) => (
              <div key={part} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2">
                <dt className="font-medium">{part}</dt>
                <dd className="whitespace-nowrap">{points}</dd>
                <dd className="col-span-2 text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[18rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-3 font-semibold">
                    部分
                  </th>
                  <th scope="col" className="py-2 pr-3 font-semibold whitespace-nowrap">
                    配分
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    內容
                  </th>
                </tr>
              </thead>
              <tbody>
                {PARTS.map(([part, points, detail]) => (
                  <tr key={part} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {part}
                    </th>
                    <td className="py-2 pr-3 whitespace-nowrap">{points}</td>
                    <td className="py-2 text-muted">{detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </InfoSection>
    </>
  );
}
