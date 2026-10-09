/**
 * 題型頁（/vocabulary、/cloze、/word-bank、/structure、/reading、/mixed）的題庫練習：
 *   - SectionPractice：頁首下面直接就是這個題型的練習——難度切換（網址 ?tier=basic|advanced|top）與抽到的題組，
 *     實際的練習程式（BankPractice.tsx，連同作答、圖表、解析卡）按需載入，題型頁本身維持輕量；
 *     下面一行連到題庫練習（全部題型）與歷屆試題；
 *   - PracticeOffers：收合的「題庫練習有什麼」，列出題庫練習現在實際提供的東西。
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
import { Component, lazy, Suspense, useId, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { PracticeSectionType } from '../../data/bank';
import type { PracticeEmbed } from './BankPractice';
import { AI_GROUP_LABEL, PRACTICE_SECTION_LABELS, tierFromParam } from './labels';

/** 練習程式（作答、圖表、解析卡）按需載入：題型頁的外殼（標題、考試說明）先出來，不必等這一大包。 */
const SectionBankPractice = lazy(() => import('./BankPractice').then((m) => ({ default: m.SectionBankPractice })));

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

/**
 * 練習程式載入失敗（多半是網站剛更新、舊分頁要的 chunk 已經不在，或網路斷了）：只有練習區顯示錯誤，
 * 頁首與考試說明照常；React.lazy 會記住失敗的載入，所以請學生重新整理。題庫資料載入失敗由 BankPractice 自己處理（可以就地再試）。
 */
class PracticeChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('題庫練習載入失敗', error, info.componentStack);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl border border-line bg-surface p-5">
        <p className="font-semibold">題庫練習載入失敗</p>
        <p className="mt-1 text-muted">可能是網站剛更新或網路不穩。請重新整理頁面再試一次。</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary">
          重新整理
        </button>
      </div>
    );
  }
}

/**
 * 題型頁的練習區：難度切換＋這一格抽到的題組（作答、提示、交卷、解析、再一組）。
 * 選的難度放在網址 ?tier=，重新整理、返回、分享都對得上；網址沒有（或寫錯）時由 BankPractice 依練習紀錄選一個並寫回網址。
 * 練習紀錄和 /practice/:section/:tier 是同一份：在這裡做到一半，從題庫練習進去會接著做同一組，反之亦然。
 */
export function SectionPractice({ section }: { section: PracticeSectionType }) {
  const [params, setParams] = useSearchParams();
  const tier = tierFromParam(params.get('tier') ?? undefined);
  const embed = useMemo<PracticeEmbed>(
    () => ({
      tierLink: (t) => ({ search: `?tier=${t}` }),
      onDefaultTier: (t) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('tier', t);
            return next;
          },
          { replace: true },
        ),
    }),
    [setParams],
  );
  return (
    <section aria-label={`${PRACTICE_SECTION_LABELS[section]}題庫練習`} className="min-w-0 space-y-4">
      <PracticeChunkBoundary>
        <Suspense
          fallback={
            <p role="status" className="rounded-2xl border border-line bg-surface py-10 text-center text-muted">
              題庫練習載入中…
            </p>
          }
        >
          <SectionBankPractice section={section} tier={tier} embed={embed} />
        </Suspense>
      </PracticeChunkBoundary>
      <p className="border-t border-line pt-4 text-[0.95rem]">
        六種題型、三種難度一覽：
        <Link to="/practice" className={`mx-0.5 ${linkCls}`}>
          題庫練習
        </Link>
        。想做真正的考題：
        <Link to="/exams" className={`mx-0.5 ${linkCls}`}>
          歷屆試題
        </Link>
        有學測、指考英文考科可以整份作答，練習模式每題作答後就能看答案；有公布統計的試卷另附全國答對率。
      </p>
    </section>
  );
}

/** 收合的「題庫練習有什麼」：放在練習區與考試說明下面，題目才是打開頁面第一眼看到的東西。 */
export function PracticeOffers({ section }: { section: PracticeSectionType }) {
  const summaryId = useId();
  return (
    <details className="rounded-2xl border border-line bg-surface">
      <summary id={summaryId} className="cursor-pointer px-5 py-4 text-lg font-semibold lg:px-6">
        題庫練習有什麼
      </summary>
      <ul aria-labelledby={summaryId} className="space-y-1 px-5 pb-5 text-[0.95rem] lg:px-6 lg:pb-6">
        {practiceOffers(section).map((item, i) => (
          <li key={i} className="ml-5 list-disc">
            {item}
          </li>
        ))}
      </ul>
    </details>
  );
}
