import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function TranslationPage() {
  return (
    <ModulePage page={getPage('/translation')}>
      <InfoSection title="學測怎麼考">
        <p>
          第參部分非選擇題，共 2 題、每題 4 分。把中文句子翻成正確、通順、達意的英文，以高中基本句型與 Level 1–4 的詞彙為主。
          評分原則上每個錯誤扣 0.5 分，相同的錯誤只扣一次。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>歷屆中譯英題目彙整，可依核心句型（例如 not only … but also、so … that、分詞構句）練習。</li>
          <li>仿真命題：依常考句型與詞彙出新題。</li>
          <li>AI 逐句批改：標出錯誤位置與類型（用字、文法、拼字、大小寫與標點），估計得分並提供參考譯文。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
