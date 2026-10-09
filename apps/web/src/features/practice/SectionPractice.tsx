/**
 * 題型說明頁（/vocabulary、/cloze、/word-bank、/structure、/reading、/mixed）的「現在就能練習」：
 * 三種難度的題庫練習入口、歷屆試題入口，以及題庫練習現在實際提供的東西。
 *
 * 六個題型頁共用這一份，說明文字才不會各自過時。每一項都要對得上實際功能：
 *   - 每組標示 AI_GROUP_LABEL（components/AiNotice.tsx 的 AiGroupBadge）；有參考資料（閱讀全部、混合題一部分）時
 *     選文下方列出參考資料（AiSourceNote）；
 *   - 閱讀的圖表（只有長條圖、折線圖，本站自己畫，可展開資料表）、表格、多文本分頁（components/PracticeFigure.tsx、
 *     exams/components/Passage.tsx）；混合題每組都是多文本（兩篇或多則短文），題目是填充、多選、簡答；
 *   - 作答時逐層看提示，每題最多 3 層，用了照樣計分（components/HintLadder.tsx）；
 *   - 交卷後四段式解析卡（components/ExplanationCard.tsx；閱讀另標誘答類型，READING_OPTION_CODE_LABELS）、
 *     混合題的多選算式與每個選項的判斷、填充與簡答的自動判分（components/MixedCards.tsx、scoring.ts：
 *     依 exams/scoring.ts 的 scoreOpenAnswer 規則判分，不是 AI 批改）；
 *   - 證據句（evidence.ts：選文裡找得到的加底線，「在文中標出」捲過去；閱讀的圖表在圖上加粗框，表格與圖表資料表的那一列
 *     加底色並標「（解析引用）」，見 PracticeFigure.tsx）、
 *     全文中譯（AiNotice.tsx 的 TranslationDetails）；
 *   - 文意選填、篇章結構另有排除法表（components/EliminationTable.tsx，只有選項庫題型才有）；
 *   - 詞彙題答錯的正解字收進單字錯題本（mistakes.ts；對不到詞彙表條目的字收不進去）；
 *   - 做過哪些題組記在這台裝置（history.ts），抽題規則見 pick.ts。
 * 功能改了這裡要一起改。
 */
import { ChevronRight } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { PracticeSectionType } from '../../data/bank';
import { AI_GROUP_LABEL, PRACTICE_SECTION_LABELS, TIER_AUDIENCE, TIER_LABELS, TIERS, practicePath } from './labels';

const linkCls = 'font-medium text-primary underline underline-offset-2';

/** 每組頂端的 AI 標示＋這個題型的內容由誰寫、有沒有參考資料。 */
function aiNote(section: PracticeSectionType): ReactNode {
  const label = <>每一組都標示「{AI_GROUP_LABEL}」：</>;
  switch (section) {
    case 'vocabulary':
      return <>{label}題目由 AI 撰寫，不是轉載。</>;
    case 'reading':
      return <>{label}文章由 AI 參考事實資料撰寫，不是轉載，選文下方列出參考資料。</>;
    case 'mixed':
      return <>{label}文章由 AI 撰寫，不是轉載；部分題組參考事實資料撰寫，這些題組的選文下方列出參考資料。</>;
    default:
      return <>{label}文章與題目由 AI 撰寫，不是轉載。</>;
  }
}

/** 題庫練習現在提供的東西，依題型列出（詞彙題沒有選文、只有選項庫題型有排除法表、混合題有自動判分）。 */
export function practiceOffers(section: PracticeSectionType): ReactNode[] {
  const items: ReactNode[] = [aiNote(section)];
  if (section === 'reading') {
    items.push('文章形式：一般長文、圖表（本站自己畫的長條圖、折線圖，可以展開資料表）、表格，以及用分頁切換的多文本。');
  }
  if (section === 'mixed') {
    items.push('每組是兩篇或多則短文（用分頁切換），題目有填充（摘要填空）、多選與簡答。');
  }
  items.push('作答時可以逐層打開提示（每題最多 3 層，由淺到深）；用了提示照樣計分。');
  if (section === 'mixed') {
    items.push(
      '交卷後自動計分：多選依學測公式（n 個選項錯 k 個，得 (n − 2k)/n 的配分）並列出算式；填充、簡答依本站的判分規則比對可接受答案（不是 AI 批改），選字對但字形錯、拼字小錯等情況給部分分數。',
    );
    items.push('四段式解析：多選逐一說明每個選項該不該選與判斷依據；填充、簡答列出可接受答案、只拿部分分數的原因與字形變化（例如「要改成名詞」）。');
  } else if (section === 'reading') {
    items.push('交卷後每題都有四段式解析：正解依據、錯誤選項為什麼錯（標出誘答類型，例如以偏概全、與原文相反、圖表讀錯）、解題策略、提示。');
  } else {
    items.push('交卷後每題都有四段式解析：正解依據、錯誤選項為什麼錯、解題策略、提示。');
  }
  if (section === 'vocabulary') {
    items.push('解析卡列出證據句，另附全文中譯（AI 翻譯）。');
  } else if (section === 'reading') {
    items.push(
      '標出證據句：選文裡找得到的加上底線，從解析卡可以直接捲過去；圖表裡引用到的資料點會加粗框，表格與圖表資料表裡引用到的那一列會加底色並標「解析引用」；另附全文中譯（AI 翻譯）。',
    );
  } else {
    items.push('標出證據句：選文裡找得到的加上底線，從解析卡可以直接捲過去；另附全文中譯（AI 翻譯）。');
  }
  if (section === 'word_bank') {
    items.push('排除法表：每一格有哪些選項放得進去、哪個是正解，看懂怎麼用刪去法縮小範圍。');
  }
  if (section === 'structure') {
    items.push('排除法表：每一格有哪些句子放得進去、哪個是正解，以及多出來的那一句要怎麼刪掉。');
  }
  if (section === 'vocabulary') {
    items.push(
      <>
        答錯的正解字（詞彙表查得到的）會自動收進
        <Link to="/words?tab=mistakes" className={`mx-0.5 ${linkCls}`}>
          單字錯題本
        </Link>
        ，可以再練。
      </>,
    );
  }
  items.push('做過哪些題組記在這台裝置的瀏覽器：做到一半的會接著做，否則先抽你還沒做過的。');
  return items;
}

export function SectionPractice({ section }: { section: PracticeSectionType }) {
  const titleId = useId();
  const offersId = useId();
  const label = PRACTICE_SECTION_LABELS[section];
  return (
    <section aria-labelledby={titleId} className="rounded-2xl border border-line bg-surface p-5 lg:p-6">
      <h2 id={titleId} className="text-lg font-semibold">
        現在就能練習
      </h2>
      <p className="mt-2 text-[0.95rem]">{label}的 AI 題庫分三種難度，選一種開始，每次抽一個題組：</p>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TIERS.map((tier) => (
          <li key={tier} className="min-w-0">
            <Link
              to={practicePath(section, tier)}
              className="group flex h-full items-start gap-2 rounded-xl border border-primary/50 bg-primary-soft p-3 hover:border-primary"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-primary">{TIER_LABELS[tier]}</span>
                <span className="mt-0.5 block text-sm">適合{TIER_AUDIENCE[tier].who}</span>
              </span>
              <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[0.95rem]">
        想做真正的考題：
        <Link to="/exams" className={`mx-0.5 ${linkCls}`}>
          歷屆試題
        </Link>
        有學測、指考英文考科可以整份作答，練習模式每題作答後就能看答案；有公布統計的試卷另附全國答對率。
      </p>
      <h3 id={offersId} className="mt-4 font-semibold">
        題庫練習有什麼
      </h3>
      <ul aria-labelledby={offersId} className="mt-2 space-y-1 text-[0.95rem]">
        {practiceOffers(section).map((item, i) => (
          <li key={i} className="ml-5 list-disc">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
