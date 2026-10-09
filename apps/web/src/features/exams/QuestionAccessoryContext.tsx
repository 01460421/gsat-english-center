/**
 * 題號旁的附加元件（擴充點）。歷屆試題不提供（null，什麼都不畫）；模擬考提供「標記這題」按鈕
 * （features/mock/），不必修改題目元件本身。
 *
 * labels：這個題目區塊包含的題號（混合題的摘要句填充一個區塊有兩題，例如 ['47', '48']）。
 * 文意選填、篇章結構的空格在選文裡、沒有題號標題，模擬考改用大題導覽裡的題號面板標記。
 */
import { createContext, use, type ReactNode } from 'react';

export type QuestionAccessory = (labels: readonly string[]) => ReactNode;

export const QuestionAccessoryContext = createContext<QuestionAccessory | null>(null);

export function QuestionAccessorySlot({ labels }: { labels: readonly string[] | undefined }) {
  const render = use(QuestionAccessoryContext);
  if (!render || !labels || labels.length === 0) return null;
  return <>{render(labels)}</>;
}
