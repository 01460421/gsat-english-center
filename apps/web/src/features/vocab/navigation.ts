/**
 * 單字模組內的分頁與單字卡網址。
 *
 * 路由表（App.tsx）只有 /words 一個路徑；模組內的狀態放在查詢參數：
 *   ?tab=library|study|quiz|mistakes  目前的分頁（預設單字庫）
 *   &word=<條目 id>                    開啟中的單字卡（任何分頁都可以開，關掉後回到原分頁）
 *   &handout=1                         做成講義的頁面（docs/design/vocab-handout.md §5.2）：和單字卡一樣蓋過分頁內容
 * 放在網址裡，瀏覽器的上一頁、重新整理、分享連結都會停在同一個畫面。
 * 講義的來源（單字庫的篩選、錯題本、每日學習）放在 history state 的 vocabHandoutSource：重新整理後還在，
 * 但不寫進網址（篩選條件很長，錯題本與每日學習每天會變）。
 */
import { GraduationCap, Library, ListChecks, NotebookText, type LucideIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

export const VOCAB_TABS = [
  { id: 'library', label: '單字庫', icon: Library },
  { id: 'study', label: '每日學習', icon: GraduationCap },
  { id: 'quiz', label: '測驗', icon: ListChecks },
  { id: 'mistakes', label: '錯題本', icon: NotebookText },
] as const satisfies readonly { id: string; label: string; icon: LucideIcon }[];

export type VocabTab = (typeof VOCAB_TABS)[number]['id'];

export const DEFAULT_TAB: VocabTab = 'library';

export function parseTab(value: string | null): VocabTab {
  return VOCAB_TABS.find((t) => t.id === value)?.id ?? DEFAULT_TAB;
}

/** 組查詢字串。條目 id 含「|」與「/」，交給 URLSearchParams 編碼。 */
export function vocabSearch(tab: VocabTab, word?: string | null, options: { handout?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_TAB || word || options.handout) params.set('tab', tab);
  if (word) params.set('word', word);
  if (options.handout) params.set('handout', '1');
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * 從模組內的連結開啟單字卡時，在 history state 留這個記號：「返回」就可以直接回上一頁（保留原本的捲動位置與篩選）。
 * 直接從外部連結進來的單字卡沒有記號，「返回」改成關閉單字卡、回到該分頁，而不是離開網站。
 */
export const INTERNAL_NAV_STATE = { vocabInternal: true } as const;

function isInternalState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'vocabInternal' in state;
}

export function useVocabLocation(): { tab: VocabTab; wordId: string | null; handout: boolean } {
  const [params] = useSearchParams();
  return { tab: parseTab(params.get('tab')), wordId: params.get('word') || null, handout: params.get('handout') === '1' };
}

export function useCloseWord(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const { tab } = useVocabLocation();
  return useCallback(() => {
    if (isInternalState(location.state)) navigate(-1);
    else navigate({ search: vocabSearch(tab) }, { replace: true });
  }, [location.state, navigate, tab]);
}

/** 講義頁的關閉（規則同 useCloseWord：從模組內進來就回上一頁，從外部連結進來就換成原分頁的網址）。 */
export function useCloseHandout(): () => void {
  return useCloseWord();
}

/** 開啟講義頁時放進 history state 的來源（handout/selection.ts 的 HandoutSource，這裡不檢查形狀，由講義頁驗證）。 */
export function handoutNavState(source: unknown): { vocabInternal: true; vocabHandoutSource: unknown } {
  return { vocabInternal: true, vocabHandoutSource: source };
}

/** 從 history state 取出講義的來源（沒有就是 null）。 */
export function handoutSourceFromState(state: unknown): unknown {
  return typeof state === 'object' && state !== null && 'vocabHandoutSource' in state ? (state as { vocabHandoutSource: unknown }).vocabHandoutSource : null;
}

/** 開啟講義頁的連結目標（to 與 state）。 */
export function handoutLink(tab: VocabTab, source: unknown): { to: { search: string }; state: { vocabInternal: true; vocabHandoutSource: unknown } } {
  return { to: { search: vocabSearch(tab, null, { handout: true }) }, state: handoutNavState(source) };
}
