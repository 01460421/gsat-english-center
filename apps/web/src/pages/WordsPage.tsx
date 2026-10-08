import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function WordsPage() {
  return (
    <ModulePage page={getPage('/words')}>
      <InfoSection title="詞表範圍">
        <p>
          以大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》為主表，共 6,012 筆，Level 1–6 各約 1,000 筆。
          學測以高中常用 4,500 字詞（Level 1–5）為命題範圍，本站以 Level 3–5 為練習主力，Level 1–2 當作基礎複習，Level 6
          當作進階挑戰。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>間隔重複複習：依記憶曲線安排每天該複習的單字，答錯的字會更快再出現。</li>
          <li>多元測驗：看英選中、看中拼英、聽音辨字、例句填空。</li>
          <li>詞彙網絡：同義詞、多義詞、常見搭配詞、片語與例句。</li>
          <li>重要度：依歷屆學測、指考出現次數排序，先背最常考的字。</li>
          <li>發音：使用瀏覽器內建語音朗讀單字與例句。</li>
          <li>一鍵查 Cambridge 英漢辭典（另開新分頁）。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
