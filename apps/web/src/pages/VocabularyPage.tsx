import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function VocabularyPage() {
  return (
    <ModulePage page={getPage('/vocabulary')}>
      <InfoSection title="學測怎麼考">
        <p>
          現行學測（111 學年度起）第 1–10 題，共 10 題、每題 1 分。每題是一個英文句子留一個空格，從四個選項中選出最適合的字詞，評量常用實詞的構詞、語意與搭配詞（collocation）。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>依考點出題：詞義、搭配詞、片語、詞性與字形變化。</li>
          <li>三種難度：穩定基礎、進階練習、超越頂標。</li>
          <li>每題解析：說明正確答案的用法，以及其他選項為什麼不合適。</li>
          <li>歷屆詞彙題依年度或考點練習，錯題自動加入單字複習。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
