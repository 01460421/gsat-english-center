/**
 * 中譯英說明頁：學測怎麼考、現在能怎麼練（線上作答在 /writing/translation）。
 * 說明要對得上 features/writing 的實際功能：自我檢核清單（lib/checklists.ts）、本站標註的句型提示（TranslationAttemptPage）、
 * AI 批改的結果（components/TranslationResult.tsx：每句 0–4 分、錯誤標示與類別、說明、建議改法、保留原意的修正版；不提供官方譯文）。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { Link } from 'react-router';
import { InfoSection, ModulePage } from '../components/ModulePage';
import { useFeatures } from '../lib/api';
import { getPage } from '../modules';

const linkCls = 'font-medium text-primary underline underline-offset-2';

export default function TranslationPage() {
  // 後端沒部署（或登入、AI 沒開）時沒有登入入口，不能叫學生「登入並通過申請」。
  const features = useFeatures();
  const aiOpen = features.auth && features.ai;
  return (
    <ModulePage page={getPage('/translation')}>
      <InfoSection title="現在就能練習">
        <p>歷屆學測、指考（含參考試卷）的中譯英都可以線上作答（現制是兩句一組、每句 4 分），草稿自動存在這台裝置：</p>
        <ul>
          <li>自我檢核：不用登入、不花點數，依本站的檢核清單（時態、主詞動詞一致、冠詞與單複數、詞性、拼字與大小寫、標點、漏譯）逐項檢查，再替自己打分數。</li>
          <li>每一句都附本站標註的句型提示（例如現在完成式、not only … but also），想不出句型時可以打開看。</li>
          <li>
            {aiOpen
              ? 'AI 批改：登入並通過申請後，由兩位 AI 評分者依大考評分原則逐句給分（每句 4 分），在你的譯文上標出錯誤的位置與類型（用字、文法、拼字、大小寫、標點、漏譯等），附說明、建議改法，以及保留你原意的修正版。'
              : 'AI 逐句批改即將開放。'}
          </li>
        </ul>
        <p>
          <Link to="/writing/translation" className={linkCls}>
            前往中譯英練習
          </Link>
        </p>
        {aiOpen && (
          <p className="text-sm text-muted">
            AI 批改每組扣 {AI_TASK_POINTS.translation_grade} 點，失敗全額退還；少數舊制計分的題組只能自我檢核。AI 的分數僅供參考，不是大考中心的正式評分；大考中心的官方參考譯文受著作權保護，本站不提供。
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
