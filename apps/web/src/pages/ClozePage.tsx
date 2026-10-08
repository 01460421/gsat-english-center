import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function ClozePage() {
  return (
    <ModulePage page={getPage('/cloze')}>
      <InfoSection title="學測怎麼考">
        <p>
          第 11–20 題，共 10 題、每題 1 分。兩篇短文各有 5 個空格，每個空格各自有四個選項。
          除了字義，也考虛詞、詞組、慣用語、轉折詞與文法，必須看懂上下文的發展才能選對。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>從英文文章自動出題，依大考中心的出題模式挖空，可選三種難度。</li>
          <li>作答後標示每個空格的考點（轉折詞、文法、搭配詞、上下文邏輯）。</li>
          <li>解析說明題目線索出現在文章的哪一句。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
