/**
 * 題型頁：頁首下面直接是這個題型的題庫練習（難度切換＋抽到的題組，features/practice/SectionPractice.tsx），
 * 下面是學測怎麼考與收合的「題庫練習有什麼」。
 */
import { InfoSection, ModulePage } from '../components/ModulePage';
import { PracticeOffers, SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function ReadingPage() {
  return (
    <ModulePage page={getPage('/reading')}>
      <SectionPractice section="reading" />
      <InfoSection title="學測怎麼考">
        <p>
          第 35–46 題，共 12 題、每題 2 分。三篇選文各 4 題，選文長度約 180–400 字，以連續文本為主，也會搭配圖片、表格等資料。常見題型有主旨、細節、推論、上下文猜字義、指涉、圖表判讀與排序。
        </p>
      </InfoSection>
      <PracticeOffers section="reading" />
    </ModulePage>
  );
}
