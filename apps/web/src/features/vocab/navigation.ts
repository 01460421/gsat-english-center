/**
 * 單字模組內的分頁與單字卡網址。
 *
 * 路由表（App.tsx）只有 /words 一個路徑；模組內的狀態放在查詢參數：
 *   ?tab=library|study|quiz|mistakes  目前的分頁（預設單字庫）
 *   &word=<條目 id>                    開啟中的單字卡（任何分頁都可以開，關掉後回到原分頁）
 * 放在網址裡，瀏覽器的上一頁、重新整理、分享連結都會停在同一個畫面。
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
export function vocabSearch(tab: VocabTab, word?: string | null): string {
  const params = new URLSearchParams();
  if (tab !== DEFAULT_TAB || word) params.set('tab', tab);
  if (word) params.set('word', word);
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

export function useVocabLocation(): { tab: VocabTab; wordId: string | null } {
  const [params] = useSearchParams();
  return { tab: parseTab(params.get('tab')), wordId: params.get('word') || null };
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
