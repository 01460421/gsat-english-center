/**
 * 題型頁：頁首下面直接是這個題型的題庫練習（難度切換＋抽到的題組，features/practice/SectionPractice.tsx），
 * 下面是學測怎麼考與收合的「題庫練習有什麼」。
 */
import { InfoSection, ModulePage } from '../components/ModulePage';
import { PracticeOffers, SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function VocabularyPage() {
  return (
    <ModulePage page={getPage('/vocabulary')}>
      <SectionPractice section="vocabulary" />
      <InfoSection title="學測怎麼考">
        <p>
          現行學測（111 學年度起）第 1–10 題，共 10 題、每題 1 分。每題是一個英文句子留一個空格，從四個選項中選出最適合的字詞，評量常用實詞的構詞、語意與搭配詞（collocation）。
        </p>
      </InfoSection>
      <PracticeOffers section="vocabulary" />
    </ModulePage>
  );
}
