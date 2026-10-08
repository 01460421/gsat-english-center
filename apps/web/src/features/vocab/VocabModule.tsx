/**
 * 單字模組：單字庫、每日學習、測驗、錯題本四個分頁，加上可從任何分頁打開的單字卡。
 *
 * 分頁與單字卡的狀態都在網址查詢參數（navigation.ts），路由表不用動。
 *
 * 去過的分頁保持掛載、只用 hidden 藏起來：
 *   - 測驗做到一半去查單字，回來時題目和作答還在；
 *   - 單字庫的篩選條件與已展開的筆數保留，關掉單字卡後回到原本的捲動位置。
 * 鍵盤快捷鍵只在分頁顯示中才啟用（active），藏起來的分頁不會搶按鍵。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/ModulePage';
import { VOCAB_CREDITS } from '../../data/vocab';
import { getPage } from '../../modules';
import { useVocabLocation, VOCAB_TABS, vocabSearch, type VocabTab } from './navigation';
import { LibraryView } from './views/LibraryView';
import { MistakesView } from './views/MistakesView';
import { QuizView } from './views/QuizView';
import { StudyView } from './views/StudyView';
import { WordDetailView } from './views/WordDetailView';

function TabNav({ current, wordOpen }: { current: VocabTab; wordOpen: boolean }) {
  return (
    <nav aria-label="單字功能" className="mb-5">
      <ul className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-surface p-1">
        {VOCAB_TABS.map((t) => {
          const selected = t.id === current;
          const Icon = t.icon;
          return (
            <li key={t.id} className="min-w-0">
              <Link
                to={{ search: vocabSearch(t.id) }}
                aria-current={selected && !wordOpen ? 'page' : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-xs sm:flex-row sm:gap-2 sm:text-sm ${
                  selected ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                <span className="max-w-full truncate">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TabPanel({ tab, active }: { tab: VocabTab; active: boolean }) {
  switch (tab) {
    case 'library':
      return <LibraryView active={active} />;
    case 'study':
      return <StudyView active={active} />;
    case 'quiz':
      return <QuizView active={active} />;
    case 'mistakes':
      return <MistakesView active={active} />;
  }
}

function Credits() {
  return (
    <footer className="mt-10 space-y-1 border-t border-line pt-4 text-xs text-muted">
      <p>{VOCAB_CREDITS.wordlist}</p>
      <p>{VOCAB_CREDITS.ecdict}</p>
      <p>{VOCAB_CREDITS.wordnet}</p>
      <p>{VOCAB_CREDITS.cefr}</p>
      <p>例句：Tatoeba（CC BY 2.0 FR），每句旁標示句子編號與作者並連到原句。發音使用瀏覽器內建語音。</p>
      <p>
        <Link to="/about" className="underline underline-offset-2 hover:text-primary">
          完整的資料來源與授權聲明
        </Link>
      </p>
    </footer>
  );
}

export function VocabModule() {
  const { tab, wordId } = useVocabLocation();
  // 去過的分頁（保持掛載）。依網址「在繪製時」補進來，不用 effect：第一次切到某分頁就要馬上畫出來。
  const [visited, setVisited] = useState<ReadonlySet<VocabTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

  // 捲動位置：單字卡打開時捲到頂端，關閉時回到打開前的位置。
  // listScroll 一直記錄「沒開單字卡時」的位置；打開的瞬間把它存進 restoreTo，
  // 之後就算 scroll 事件晚一步把 listScroll 改成 0，也不影響要還原的值。
  const listScroll = useRef(0);
  const restoreTo = useRef(0);
  const lastFocus = useRef<HTMLElement | null>(null);
  const prevWord = useRef<string | null>(wordId);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const prev = prevWord.current;
    prevWord.current = wordId;
    if (prev === wordId) return;
    if (wordId && !prev) restoreTo.current = listScroll.current;
    if (wordId) {
      window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, restoreTo.current);
      // 焦點回到打開單字卡的那個連結，鍵盤使用者可以接著往下瀏覽。
      if (lastFocus.current?.isConnected) lastFocus.current.focus({ preventScroll: true });
    }
  }, [wordId]);

  useEffect(() => {
    if (wordId) return;
    const onScroll = () => {
      listScroll.current = window.scrollY;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    // 記下最後拿到焦點的元素（通常是單字連結）；單字卡打開後原元素被藏起來，焦點會跑到 body。
    const root = rootRef.current;
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof HTMLElement) lastFocus.current = e.target;
    };
    root?.addEventListener('focusin', onFocus);
    return () => {
      window.removeEventListener('scroll', onScroll);
      root?.removeEventListener('focusin', onFocus);
    };
  }, [wordId]);

  return (
    <article>
      <PageHeader page={getPage('/words')} />
      <TabNav current={tab} wordOpen={wordId !== null} />
      {wordId && <WordDetailView key="detail" id={wordId} />}
      <div ref={rootRef}>
        {VOCAB_TABS.filter((t) => visited.has(t.id)).map((t) => {
          const shown = t.id === tab && wordId === null;
          return (
            <div key={t.id} hidden={!shown}>
              <TabPanel tab={t.id} active={shown} />
            </div>
          );
        })}
      </div>
      <Credits />
    </article>
  );
}
