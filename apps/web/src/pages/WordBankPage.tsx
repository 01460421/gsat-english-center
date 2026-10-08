import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function WordBankPage() {
  return (
    <ModulePage page={getPage('/word-bank')}>
      <InfoSection title="學測怎麼考">
        <p>
          第 21–30 題，共 10 題、每題 1 分。一篇短文有 10 個空格，搭配 A–J 共 10 個選項，每個選項只能用一次。
          主要評量依文意選出適當實詞（含慣用語與轉折詞）的能力。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>詞性提示：先判斷每個空格需要名詞、動詞、形容詞還是副詞，再縮小選項範圍。</li>
          <li>拖放或點選作答，已使用的選項會標示出來，方便用刪去法。</li>
          <li>從英文文章自動出題，三種難度。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
