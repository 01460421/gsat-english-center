import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function ExamsPage() {
  return (
    <ModulePage page={getPage('/exams')}>
      <InfoSection title="收錄範圍">
        <p>
          學科能力測驗英文考科 83–115 學年度，以及指定科目考試英文考科 91–110 學年度（含補考與參考試卷）。題目、選項與答案依大學入學考試中心公告的試題與答案整理成結構化資料，並標註考點與題型。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>依年度整份作答，或依題型（詞彙、綜合測驗、文意選填……）跨年度練習。</li>
          <li>顯示官方公布的答對率與鑑別度，知道哪些題目是多數人都會錯的。</li>
          <li>每題標註考點，錯題可以加入複習清單。</li>
          <li>每份試題都標示出處年度並連到大學入學考試中心的官方 PDF。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
