import { InfoSection, ModulePage } from '../components/ModulePage';
import { SectionPractice } from '../features/practice/SectionPractice';
import { getPage } from '../modules';

export default function WordBankPage() {
  return (
    <ModulePage page={getPage('/word-bank')}>
      <SectionPractice section="word_bank" />
      <InfoSection title="學測怎麼考">
        <p>
          第 21–30 題，共 10 題、每題 1 分。一篇短文有 10 個空格，搭配 A–J 共 10 個選項，每個選項只能用一次。主要評量依文意選出適當實詞（含慣用語與轉折詞）的能力。
        </p>
      </InfoSection>
    </ModulePage>
  );
}
