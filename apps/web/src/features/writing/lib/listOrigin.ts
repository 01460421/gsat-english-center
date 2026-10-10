/**
 * 題目列表的卡片連到作答頁時，記下列表在哪一頁（react-router 的 location.state），作答頁的返回連結才回得去原本那一頁：
 * 中譯英、英文作文題型頁（/translation、/composition）內嵌和 /writing/translation、/writing/essay 同一份歷屆列表
 * （TranslationPromptList、EssayPromptList），也內嵌和 /writing/translation/ai、/writing/essay/ai 同一份本站仿真題列表
 * （bank/BankListPage.tsx 的 BankPromptList）。從題型頁點進作答頁，返回要回到題型頁，不是寫作練習底下的列表。
 *
 * 題型頁用 <ListOrigin value="/translation"> 包住列表；卡片用 useListOriginState() 取得要帶的 state；
 * 作答頁用 listOriginBack(location.state, 預設) 決定返回連結，本站仿真題的「下一組」用 listOriginState(location.state)
 * 把同一份 state 帶下去。state 只認得下面列出的頁面，其他值一律用預設。
 */
import { createContext, use } from 'react';

const ORIGIN_LABELS = {
  '/translation': '中譯英',
  '/composition': '英文作文',
} as const;

export type ListOriginPath = keyof typeof ORIGIN_LABELS;

/** 列表所在的題型頁；/writing/... 自己的列表頁不包，值是 null（作答頁回到預設的列表）。 */
export const ListOrigin = createContext<ListOriginPath | null>(null);

/** 卡片連結要帶的 state（不在題型頁時是 undefined）。 */
export function useListOriginState(): { from: ListOriginPath } | undefined {
  const from = use(ListOrigin);
  return from ? { from } : undefined;
}

/** location.state 裡認得的題型頁；沒有或不認得（不會把任意網址當成返回連結）回傳 null。 */
function listOriginOf(state: unknown): ListOriginPath | null {
  const from = typeof state === 'object' && state !== null ? (state as { from?: unknown }).from : undefined;
  return typeof from === 'string' && Object.hasOwn(ORIGIN_LABELS, from) ? (from as ListOriginPath) : null;
}

/** 作答頁再連到同一份列表的下一題（本站仿真題的「下一組」）時，照樣帶著的 state。 */
export function listOriginState(state: unknown): { from: ListOriginPath } | undefined {
  const from = listOriginOf(state);
  return from ? { from } : undefined;
}

/**
 * 作答頁的返回連結：從題型頁點進來的回到題型頁，否則用 fallback。
 * search 只接在題型頁後面（例如本站仿真題的 '?tier=basic'，回去時停在同一個難度）；fallback 自己帶好網址。
 */
export function listOriginBack(state: unknown, fallback: { to: string; label: string }, search = ''): { to: string; label: string } {
  const from = listOriginOf(state);
  return from ? { to: `${from}${search}`, label: ORIGIN_LABELS[from] } : fallback;
}
