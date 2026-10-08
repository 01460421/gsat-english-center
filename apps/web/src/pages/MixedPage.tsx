import { InfoSection, ModulePage } from '../components/ModulePage';
import { getPage } from '../modules';

export default function MixedPage() {
  return (
    <ModulePage page={getPage('/mixed')}>
      <InfoSection title="學測怎麼考">
        <p>
          第貳部分，第 47–50 題，一個題組共 10 分。同一篇文章搭配兩種以上的作答方式。112–115 學年度常見的配置是：47–48 填充（每格 2 分）、49 多選（4 分）、50 簡答（2 分）。
        </p>
        <p>
          填充題要從文章中找出單字並依句子結構做字形變化；完全正確得滿分，字形或拼字錯誤只得一半。多選題答錯的選項越多扣得越多。
        </p>
      </InfoSection>
      <InfoSection title="規劃中的功能">
        <ul>
          <li>選擇部分自動計分（多選題依官方公式計算部分分數）。</li>
          <li>填充與簡答由 AI 批改：檢查選字、字形變化、拼字，並說明扣分原因。</li>
          <li>練習「只填一個單詞」「寫名詞片語而不是整句」這類作答格式要求。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
