/**
 * 表格（docs/design/css-overhaul.md §4.8、desktop-polish §2.9）：
 *   - tableCls、thCls、tdCls、numCls、groupRowCls：表頭 surface-2＋14px 600 muted，儲存格 py-2.5 px-3、列分隔 line-subtle，
 *     數字欄靠右、等寬數字。DataTable（桌機資料表）用同一組。
 *   - ScrollRegion：會水平捲動的表格一律包它（overflow-x-auto＋tabIndex=0＋role="region"＋必填的 aria-label），
 *     鍵盤也捲得到（WCAG 2.1.1）；手機上 4 欄以內的表格直接放，更寬的包它，第一欄可以用 stickyFirstColCls 固定。
 *     不在手機上把表格拆成卡片：資料表的重點是列與列的比較。
 */
import type { ReactNode } from 'react';

export const tableCls = 'w-full border-collapse text-left text-body';
export const thCls = 'border-b border-line bg-surface-2 px-3 py-2.5 text-meta font-semibold whitespace-nowrap text-muted';
export const tdCls = 'border-b border-line-subtle px-3 py-2.5 align-top';
export const numCls = 'text-right tabular-nums whitespace-nowrap';
export const groupRowCls = 'bg-surface-2 text-meta font-semibold';
/** 寬表格在手機上固定第一欄（要配合 ScrollRegion）。 */
export const stickyFirstColCls = 'sticky left-0 z-[1] bg-surface';
/** 放在卡片外面的表格外框。 */
export const tableFrameCls = 'rounded-card border border-line';

export interface ScrollRegionProps {
  /** 必填：讀屏聽到「區域，各大題得分」。 */
  label: string;
  className?: string;
  children: ReactNode;
}

export function ScrollRegion({ label, className, children }: ScrollRegionProps) {
  return (
    // tabIndex：沒有可聚焦內容的捲動區，鍵盤也要能聚焦後用方向鍵捲（axe scrollable-region-focusable）。
    <div role="region" aria-label={label} tabIndex={0} className={`overflow-x-auto overscroll-x-contain${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
