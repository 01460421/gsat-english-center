/**
 * 中譯英題型頁：頁首下面直接列出題目（和 /writing/translation 同一份列表，features/writing/TranslationListPage.tsx 的
 * TranslationPromptList；那裡加了新的題組，這裡也會跟著出現），點一組就到作答頁；下面是作答與批改方式、學測怎麼考。
 * 說明要對得上 features/writing 的實際功能：自我檢核清單（lib/checklists.ts）、本站標註的句型提示（TranslationAttemptPage）、
 * AI 批改的結果（components/TranslationResult.tsx：每句 0–4 分、錯誤標示與類別、說明、建議改法、保留原意的修正版；不提供官方譯文）。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { Link } from 'react-router';
import { InfoSection, ModulePage } from '../components/ModulePage';
import { TranslationPromptList } from '../features/writing/TranslationListPage';
import { ListOrigin } from '../features/writing/lib/listOrigin';
import { useFeatures } from '../lib/api';
import { getPage } from '../modules';

const linkCls = 'font-medium text-primary underline underline-offset-2';

export default function TranslationPage() {
  // 後端沒部署（或登入、AI 沒開）時沒有登入入口，不能叫學生「登入並通過申請」。
  const features = useFeatures();
  const aiOpen = features.auth && features.ai;
  return (
    <ModulePage page={getPage('/translation')}>
      {/* 從這裡點進作答頁，返回連結回到這一頁（不是 /writing/translation）。 */}
      <ListOrigin value="/translation">
        <TranslationPromptList />
      </ListOrigin>
      <InfoSection title="作答與批改方式">
        <p>上面每一組都可以線上作答（現制是兩句一組、每句 4 分），草稿自動存在這台裝置：</p>
        <ul>
          <li>自我檢核：不用登入、不花點數，依本站的檢核清單（時態、主詞動詞一致、冠詞與單複數、詞性、拼字與大小寫、標點、漏譯）逐項檢查，再替自己打分數。</li>
          <li>每一句都附本站標註的句型提示（例如現在完成式、not only … but also），想不出句型時可以打開看。</li>
          <li>
            {aiOpen
              ? 'AI 批改：登入並通過申請後，由兩位 AI 評分者依大考評分原則逐句給分（每句 4 分），在你的譯文上標出錯誤的位置與類型（用字、文法、拼字、大小寫、標點、漏譯等），附說明、建議改法，以及保留你原意的修正版。'
              : 'AI 逐句批改即將開放。'}
          </li>
        </ul>
        {aiOpen && (
          <p className="text-sm text-muted">
            AI 批改每組扣 {AI_TASK_POINTS.translation_grade} 點，失敗全額退還；少數舊制計分的題組只能自我檢核。AI 的分數僅供參考，不是大考中心的正式評分；大考中心的官方參考譯文受著作權保護，本站不提供。
          </p>
        )}
        {aiOpen && (
          <p>
            AI 批改的申請、剩餘點數與你的寫作紀錄在
            <Link to="/writing" className={`mx-0.5 ${linkCls}`}>
              寫作練習
            </Link>
            。
          </p>
        )}
      </InfoSection>
      <InfoSection title="學測怎麼考">
        <p>
          第參部分非選擇題，共 2 題、每題 4 分。把中文句子翻成正確、通順、達意的英文，以高中基本句型與 Level 1–4 的詞彙為主。評分原則上每個錯誤扣 0.5 分，相同的錯誤只扣一次。
        </p>
      </InfoSection>
      <InfoSection title="陸續加入">
        <ul>
          <li>本站自撰的仿真中譯英題組（依常考句型與詞彙命題）。</li>
        </ul>
      </InfoSection>
    </ModulePage>
  );
}
