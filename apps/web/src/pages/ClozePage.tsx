/**
 * 題型頁：頁首下面直接是這個題型的題庫練習（難度切換＋抽到的題組，features/practice/SectionPractice.tsx），
 * 下面是學測怎麼考與收合的「題庫練習有什麼」。
 */
import { InfoSection, ModulePage } from '../components/ModulePage';
import { PracticeOffers, SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function ClozePage() {
  return (
    <ModulePage page={getPage('/cloze')}>
      <SectionPractice section="cloze" />
      <InfoSection title="學測怎麼考">
        <p>
          第 11–20 題，共 10 題、每題 1 分。兩篇短文各有 5 個空格，每個空格各自有四個選項。除了字義，也考虛詞、詞組、慣用語、轉折詞與文法，必須看懂上下文的發展才能選對。
        </p>
      </InfoSection>
      <PracticeOffers section="cloze" />
    </ModulePage>
  );
}
