/**
 * 卡片（docs/design/css-overhaul.md §4.6）：
 *   區塊卡  cardCls          rounded-card、line 框、surface 底、p-4（桌機 p-6），沒有陰影：表單、說明、結果
 *   列表卡  cardCompactCls   同上，桌機 p-5：列表裡的一項、寫作與學習助手的區塊
 *   可點卡  cardLinkCls      列表卡＋陰影（只有能點的卡片有，學生不用 hover 就知道哪裡能點）、hover 主色框＋較深的陰影；整張是一個 <a>
 *   說明框  calloutCls       rounded-control、surface-2 底、無框線：「三種難度給誰」、頁尾的出處說明、空白提示
 *   結果卡  resultCardCls    區塊卡＋頂端 primary-soft 標題列（第一個子元素加 resultCardHeadCls）：交卷結果、成績單、批改總分
 * cardFrameCls 只有外框（圓角、框線、底色），內距由呼叫端決定：作答頁的題目卡這類版面固定的地方。
 * 深色主題的卡片陰影是 none（--shadow-card），層次靠 surface／line。不放卡中卡；卡片裡的小框用 rounded-control。
 */
import { ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

export const cardFrameCls = 'rounded-card border border-line bg-surface';
export const cardCls = `${cardFrameCls} p-4 lg:p-6`;
export const cardCompactCls = `${cardFrameCls} p-4 lg:p-5`;
export const cardLinkCls = `${cardFrameCls} p-4 shadow-(--shadow-card) transition-[border-color,box-shadow] duration-150 hover:border-primary hover:shadow-(--shadow-card-hover) motion-reduce:transition-none lg:p-5`;
export const calloutCls = 'rounded-control bg-surface-2 p-4';
/** 結果卡的標題列放在卡片的第一個子元素（h2 或「原得總分」那一行）上：負外距貼齊卡片上緣與左右，primary-soft 底。 */
export const resultCardCls = cardCls;
export const resultCardHeadCls =
  '-mx-4 -mt-4 mb-4 rounded-t-[calc(var(--radius-card)-1px)] border-b border-line bg-primary-soft px-4 py-3 lg:-mx-6 lg:-mt-6 lg:mb-5 lg:px-6';
/** 卡片裡的小框（引文、題目預覽、表格的一列卡片）：內層圓角 10、line 框。 */
export const insetBoxCls = 'rounded-control border border-line bg-surface p-3';

export type CardVariant = 'block' | 'compact' | 'callout';

const VARIANT_CLS: Record<CardVariant, string> = { block: cardCls, compact: cardCompactCls, callout: calloutCls };

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
  variant?: CardVariant;
  children?: ReactNode;
}

/** 靜態的卡片（不能點）。 */
export function Card({ as: Tag = 'div', variant = 'block', className, children, ...rest }: CardProps) {
  return (
    <Tag {...rest} className={`${VARIANT_CLS[variant]}${className ? ` ${className}` : ''}`}>
      {children}
    </Tag>
  );
}

/** 可點卡片右上角的箭頭（裝飾；可存取名稱由卡片的連結文字決定）。 */
export function CardChevron({ className = '' }: { className?: string }) {
  return <ChevronRight aria-hidden="true" className={`size-5 shrink-0 text-muted transition-colors group-hover:text-primary ${className}`} />;
}
