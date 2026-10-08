import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function StructurePage() {
  return (
    <ModulePage page={getPage('/structure')}>
      <InfoSection title="學測怎麼考">
        <p>
          第 31–34 題，共 4 題、每題 2 分。一篇短文挖掉 4 個句子，要把選項中的句子放回正確位置。
          115 學年度起改為 4 個空格搭配 5 個選項（多 1 個干擾句）；111–114 學年度的試卷是 4 個選項。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>線索標示：代名詞指涉、轉折詞、主題句、舉例、對比，作答後在文章中標出來。</li>
          <li>練習判斷干擾句：為什麼它看起來相關卻放不進任何一格。</li>
          <li>從英文文章自動出題，三種難度。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
