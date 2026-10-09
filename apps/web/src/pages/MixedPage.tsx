/**
 * 題型頁：頁首下面直接是這個題型的題庫練習（難度切換＋抽到的題組，features/practice/SectionPractice.tsx），
 * 下面是學測怎麼考與收合的「題庫練習有什麼」。
 */
import { InfoSection, ModulePage } from '../components/ModulePage';
import { PracticeOffers, SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function MixedPage() {
  return (
    <ModulePage page={getPage('/mixed')}>
      <SectionPractice section="mixed" />
      <InfoSection title="學測怎麼考">
        <p>
          第貳部分，第 47–50 題，一個題組共 10 分。同一篇文章搭配兩種以上的作答方式。112–115 學年度常見的配置是：47–48 填充（每格 2 分）、49 多選（4 分）、50 簡答（2 分）。
        </p>
        <p>
          填充題要從文章中找出單字並依句子結構做字形變化；完全正確得滿分，字形或拼字錯誤只得一半。多選題答錯的選項越多扣得越多。
        </p>
      </InfoSection>
      <PracticeOffers section="mixed" />
    </ModulePage>
  );
}
