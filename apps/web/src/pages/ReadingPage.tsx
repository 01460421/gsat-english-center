import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function ReadingPage() {
  return (
    <ModulePage page={getPage('/reading')}>
      <InfoSection title="學測怎麼考">
        <p>
          第 35–46 題，共 12 題、每題 2 分。三篇選文各 4 題，選文長度約 180–400 字，以連續文本為主，也會搭配圖片、表格等資料。常見題型有主旨、細節、推論、上下文猜字義、指涉、圖表判讀與排序。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>以聯合國永續發展目標（SDGs）為主題：氣候、海洋、健康、教育、平等……</li>
          <li>文章形式多元：一般長文、圖表題、表格題、多文本（例如兩篇觀點對照）。</li>
          <li>文章由 AI 依多個來源的事實撰寫成原創內容，並列出參考資料；不轉載受著作權保護的原文。</li>
          <li>依大考詞彙表級數分布控制難度，分成穩定基礎、進階練習、超越頂標三種。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
