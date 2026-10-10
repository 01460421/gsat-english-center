/**
 * 中譯英題型頁：頁首下面直接是兩份可以作答的題目，各自一區、各有標題：
 *   1. 本站仿真題：難度切換（網址 ?tier=）與那個難度的題組，和 /writing/translation/ai 同一份列表
 *      （features/writing/bank/BankListPage.tsx 的 BankPromptList），標示「AI 出題・已通過自動驗證・人工審核中」，
 *      還沒有題組的難度顯示「出題中」；這裡只先列 BANK_PREVIEW 組（這台裝置還沒完成的排前面），其餘按「顯示全部」展開，
 *      標題旁的「跳到歷屆試題」直接捲到第二份列表；
 *   2. 歷屆試題：和 /writing/translation 同一份列表（features/writing/TranslationListPage.tsx 的 TranslationPromptList，
 *      網址 ?kind=）；那裡加了新的題組，這裡也會跟著出現。
 * 兩份列表都包在 ListOrigin 裡：點一組到作答頁，作答頁的返回連結回到這一頁。下面是作答與批改方式、學測怎麼考。
 * 說明要對得上 features/writing 的實際功能：自我檢核清單（lib/checklists.ts）、本站標註的句型提示（TranslationAttemptPage）、
 * 本站仿真題的三層提示與對照自評（bank/BankTranslationAttemptPage.tsx、bank/components/TranslationReveal.tsx）、
 * AI 批改的結果（components/TranslationResult.tsx：每句 0–4 分、錯誤標示與類別、說明、建議改法、保留原意的修正版；不提供官方譯文）。
 */
import { AI_TASK_POINTS } from '@gsat/shared';
import { Link } from 'react-router';
import { JumpLink, ListSection } from '../components/ListSection';
import { InfoSection, ModulePage } from '../components/ModulePage';
import { AiGroupBadge } from '../features/practice/components/AiGroupBadge';
import { BankPromptList } from '../features/writing/bank/BankListPage';
import { TranslationPromptList } from '../features/writing/TranslationListPage';
import { ListOrigin } from '../features/writing/lib/listOrigin';
import { useFeatures } from '../lib/api';
import { getPage } from '../modules';

const linkCls = 'font-medium text-primary underline underline-offset-2';

/** 本站仿真題先列幾組（手機上一組約 180px；下面還有歷屆試題）。 */
const BANK_PREVIEW = 6;

export default function TranslationPage() {
  // 後端沒部署（或登入、AI 沒開）時沒有登入入口，不能叫學生「登入並通過申請」。
  const features = useFeatures();
  const aiOpen = features.auth && features.ai;
  return (
    <ModulePage page={getPage('/translation')}>
      {/* 從這裡點進作答頁，返回連結回到這一頁（不是 /writing/translation 或 /writing/translation/ai）。 */}
      <ListOrigin value="/translation">
        <ListSection id="bank-questions" title="本站仿真題" aside={<JumpLink href="#exam-questions">跳到歷屆試題</JumpLink>}>
          <div>
            <AiGroupBadge />
          </div>
          <p className="text-[0.95rem] text-muted">
            AI 依學測題型出題，不是大考中心的試題；寫完可以對照本站撰寫的參考譯文自我檢核{aiOpen ? '，登入並通過申請後，也能送 AI 批改' : ''}。
          </p>
          <BankPromptList section="translation" headingLevel={3} limit={BANK_PREVIEW} />
        </ListSection>
        <ListSection id="exam-questions" title="歷屆試題">
          <p className="text-[0.95rem] text-muted">歷屆學測、指考與參考試卷的中譯英，依考試分開、新到舊排列。</p>
          <TranslationPromptList headingLevel={3} />
        </ListSection>
      </ListOrigin>
      <InfoSection title="作答與批改方式">
        <p>上面兩種題目都可以線上作答（現制是兩句一組、每句 4 分），草稿自動存在這台裝置：</p>
        <ul>
          <li>
            自我檢核：不用登入、不花點數。歷屆試題依本站的檢核清單（時態、主詞動詞一致、冠詞與單複數、詞性、拼字與大小寫、標點、漏譯）逐項檢查，再替自己打分數；本站仿真題兩句都寫完後，可以對照本站撰寫的參考譯文與每句
            4 部分的評分規準，逐部分記下錯誤、算出自評分數（對照後作答會鎖定，避免看完答案再改）。
          </li>
          <li>
            提示：歷屆試題每一句都附本站標註的句型提示（例如現在完成式、not only … but also），想不出句型時可以打開看；本站仿真題每句有三層提示（切成四段、標的詞彙、句型框架），一次打開一層。
          </li>
          <li>
            {aiOpen
              ? 'AI 批改：登入並通過申請後，由兩位 AI 評分者依大考評分原則逐句給分（每句 4 分），在你的譯文上標出錯誤的位置與類型（用字、文法、拼字、大小寫、標點、漏譯等），附說明、建議改法，以及保留你原意的修正版。歷屆試題與本站仿真題都可以送。'
              : 'AI 逐句批改即將開放。'}
          </li>
        </ul>
        {aiOpen && (
          <p className="text-sm text-muted">
            AI 批改每組扣 {AI_TASK_POINTS.translation_grade} 點，失敗全額退還；少數舊制計分的歷屆題組只能自我檢核。AI 的分數僅供參考，不是大考中心的正式評分；大考中心的官方參考譯文受著作權保護，本站不提供（本站仿真題附的參考譯文是本站撰寫的）。
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
    </ModulePage>
  );
}
