/**
 * 寫作題目列表在桌機的頁首（docs/design/desktop-ui.md §5.6，只在 ≥ lg render）：返回連結、H1、來源分頁（歷屆／本站仿真／自訂）
 * 與篩選（學測／指考／參考試卷，或本站仿真題的難度）收成一列，放進 sticky 篩選列，捲動後仍看得到。
 * 篩選元件仍由列表本體 render（同一份，components/desktop/Slot.tsx 的 InSlot 搬進 slotRef 這一格），不會有兩份。
 * 寬度不夠、換成兩行時（1024 寬），第一行（返回連結、H1、來源分頁）跟著頁面捲走，只有篩選那一行黏住（StickyBar 的
 * collapseFirstLine）：兩行都黏住的話佔掉 600 高的視窗約五分之一。
 */
import { StickyBar } from '../../../components/desktop/StickyBar';
import { SourceTabs } from './SourceTabs';
import { BackLink } from './ui';

export function WritingListBar({
  title,
  kind,
  current,
  slotRef,
}: {
  title: string;
  kind: 'translation' | 'essay';
  current: 'exam' | 'bank';
  slotRef: (el: HTMLElement | null) => void;
}) {
  return (
    <StickyBar collapseFirstLine className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div data-bar-head="" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <BackLink to="/writing">寫作練習</BackLink>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <SourceTabs kind={kind} current={current} className="" />
      </div>
      <div ref={slotRef} className="ml-auto min-w-0" />
    </StickyBar>
  );
}
