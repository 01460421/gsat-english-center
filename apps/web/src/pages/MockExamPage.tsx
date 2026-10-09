/**
 * 模擬考列表頁（/mock，SPEC §6.11、設計文件 §6.1）：111–115 學測與 115 參考試卷，每份顯示作答狀態與動作、
 * 這台裝置的作答紀錄、考前節奏建議、現行配分與聲明。
 * 作答頁在 features/mock/MockSessionPage.tsx（/mock/:paperId），成績單在 features/mock/MockReportPage.tsx。
 */
import { useState } from 'react';
import { InfoSection, ModulePage } from '../components/ModulePage';
import { MockPaperList } from '../features/mock/MockPaperList';
import { pdfDownloadVisible } from '../features/pdf/index';
import { getPage } from '../modules';

const PARTS = [
  ['第壹部分 選擇題', '62 分', '詞彙 10、綜合測驗 10、文意選填 10、篇章結構 8、閱讀測驗 24'],
  ['第貳部分 混合題', '10 分', '一個題組，填充、多選、簡答'],
  ['第參部分 非選擇題', '28 分', '中譯英 8、英文作文 20'],
] as const;

export default function MockExamPage() {
  const [pdfVisible] = useState(pdfDownloadVisible);
  return (
    <ModulePage page={getPage('/mock')}>
      <p className="text-[0.95rem]">
        用大考中心公布的真題整份計時作答：100 分鐘倒數、一次一個大題、不確定的題目可以標記；交卷後看原得總分、各大題得分與用時、
        <strong>級分（非官方）</strong>與五標位置。考試中不提供答案與提示。作答與成績只存在這台裝置的瀏覽器。
      </p>
      <MockPaperList />
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
      </InfoSection>
      <footer className="space-y-1 rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted">
        <p className="font-semibold text-fg">模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果。</p>
        <p>目前非選擇題（中譯英、英文作文）為自評分數；級分依各學年度大考中心公布的原得總分與級分對照表換算。</p>
        <p>試題來源：大學入學考試中心 111–115 學年度學科能力測驗英文考科、學科能力測驗參考試卷（115 學年度起適用）英文考科。</p>
      </footer>
    </ModulePage>
  );
}
