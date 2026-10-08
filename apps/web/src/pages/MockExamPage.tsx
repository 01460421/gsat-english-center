import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

const PARTS = [
  ['第壹部分 選擇題', '62 分', '詞彙 10、綜合測驗 10、文意選填 10、篇章結構 8、閱讀測驗 24'],
  ['第貳部分 混合題', '10 分', '一個題組，填充、多選、簡答'],
  ['第參部分 非選擇題', '28 分', '中譯英 8、英文作文 20'],
] as const;

export default function MockExamPage() {
  return (
    <ModulePage page={getPage('/mock')}>
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
      <InfoSection title="規劃中的功能">
        <ul>
          <li>依現行題型與配分組卷，題目來自歷屆試題與 AI 仿真題。</li>
          <li>100 分鐘計時作答，中途離開可以接著寫。</li>
          <li>選擇與混合題自動計分，翻譯與作文由 AI 批改，最後依當年度級距換算級分（僅供參考）。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
