/**
 * 題型頁：頁首下面直接是這個題型的題庫練習（難度切換＋抽到的題組，features/practice/SectionPractice.tsx），
 * 下面是學測怎麼考與收合的「題庫練習有什麼」。
 */
import { InfoSection, ModulePage } from '../components/ModulePage';
import { PracticeOffers, SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function StructurePage() {
  return (
    <ModulePage page={getPage('/structure')}>
      <SectionPractice section="structure" />
      <InfoSection title="學測怎麼考">
        <p>
          第 31–34 題，共 4 題、每題 2 分。一篇短文挖掉 4 個句子，要把選項中的句子放回正確位置。115 學年度起改為 4 個空格搭配 5 個選項（多 1 個干擾句）；111–114 學年度的試卷是 4 個選項。
        </p>
      </InfoSection>
      <PracticeOffers section="structure" />
    </ModulePage>
  );
}
