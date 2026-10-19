/**
 * 寫作工作區（docs/design/desktop-ui.md §4.5）：寫作頁在 ≥ lg 一律 render 這一棵樹（< lg 走原本的 JSX，R4）。
 *
 * - 分欄或堆疊只靠 CSS 切換：split="auto" 且 main ≥ ws（58.5rem，lg:@ws/main:）時分欄，否則堆疊。所以放大縮小、
 *   把視窗從 1366 拖到 1200，作答框都不會重新掛載（焦點、游標、復原紀錄都還在）。
 * - 分欄時整個工作區剛好一個視窗高：一行頁首（高度由 useStickyHeightVar 寫進工作區自己的 --ws-head-h），
 *   下面兩欄的 grid 高度＝100dvh − 頁首 − 2.75rem（內容上下 py-4 共 2rem，加頁首下方 0.75rem），最少 26rem。
 *   每個 Pane 是 min-h-0 overflow-y-auto 的捲動容器，不用 sticky、不用 overscroll-contain：面板捲到底之後滾輪帶動整頁，
 *   頁面本身只多出頁尾的高度。
 * - 堆疊時 Pane 跟著頁面排在一般流裡，不設高度、不自己捲、不加 region 的 tabIndex；順序和手機相同（題目在上、作答在下）。
 * - usePaneA11y：分欄時面板是 role="region"＋名稱＋tabIndex 0（可以聚焦後用方向鍵捲動）＋data-pane-scroll（scrollIntoPane 用），
 *   堆疊與 < lg 時是空物件，Tab 順序不多一站。
 */
import { createContext, useContext, useRef, type ReactNode } from 'react';
import { useMainTier } from '../../lib/media';
import { useStickyHeightVar } from './scroll';

export type WorkspaceLayout = 'prompt-editor' | 'sentences-rail' | 'result';

/** 各 layout 分欄時的欄寬（§4.5 的表）。 */
const SPLIT_COLUMNS: Record<WorkspaceLayout, string> = {
  'prompt-editor': 'lg:@ws/main:grid-cols-2',
  'sentences-rail': 'lg:@ws/main:grid-cols-[minmax(0,1fr)_22rem]',
  result: 'lg:@ws/main:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]',
};

/** 有第三欄（rail）時，wide 寬度的欄寬（P2）。 */
const RAIL_COLUMNS: Record<WorkspaceLayout, string> = {
  'prompt-editor': 'lg:@wide/main:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]',
  'sentences-rail': '',
  result: '',
};

const SPLIT_HEIGHT = 'lg:@ws/main:h-[calc(100dvh-var(--ws-head-h,2.75rem)-2.75rem)] lg:@ws/main:min-h-[26rem]';

/** 工作區目前是不是可以分欄（split="auto"）；Pane 與 usePaneA11y 讀。 */
const WorkspaceSplitContext = createContext(false);

export function Workspace({
  layout,
  split = 'auto',
  header,
  left,
  right,
  rail,
}: {
  layout: WorkspaceLayout;
  /** off：一律堆疊（自訂題目還沒設定好或正在修改題目，§6.2）。 */
  split?: 'auto' | 'off';
  header: ReactNode;
  left: ReactNode;
  right: ReactNode;
  /** wide 寬度才出現的第三欄（P2）。 */
  rail?: ReactNode;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  useStickyHeightVar(headRef, '--ws-head-h', { enabled: true, target: 'parent' });
  const splitOn = split === 'auto';
  const gridCls = splitOn ? `${SPLIT_COLUMNS[layout]} ${rail ? RAIL_COLUMNS[layout] : ''} ${SPLIT_HEIGHT}` : '';
  return (
    <WorkspaceSplitContext value={splitOn}>
      <div data-workspace={layout} data-split={split} className="lg:bleed lg:[--bleed-max:100cqw]">
        <div ref={headRef} className="pb-3">
          {header}
        </div>
        <div className={`grid grid-cols-1 gap-6 ${gridCls}`}>
          {left}
          {right}
          {rail && <div className="hidden min-h-0 overflow-y-auto lg:@wide/main:block">{rail}</div>}
        </div>
      </div>
    </WorkspaceSplitContext>
  );
}

/** 分欄時面板的無障礙屬性（§2.4）；堆疊與 < lg 時是空物件。作答頁的選文欄（§7.2）也用它。 */
export function usePaneA11y(label: string): Record<string, string | number> {
  const split = useContext(WorkspaceSplitContext);
  const { ws } = useMainTier();
  return split && ws ? { role: 'region', 'aria-label': label, tabIndex: 0, 'data-pane-scroll': '' } : {};
}

/**
 * 工作區的一欄。fill：直排 flex，子元素裡標了 flex-1 min-h-0 的（作答框）填滿剩下的高度；內容放不下時 Pane 自己捲。
 * id 給頁首的跳轉連結（「跳到題目」「跳到作答區」）用，分欄與堆疊都存在。
 */
export function Pane({ id, label, fill = false, children }: { id: string; label: string; fill?: boolean; children: ReactNode }) {
  const split = useContext(WorkspaceSplitContext);
  const a11y = usePaneA11y(label);
  const splitCls = split
    ? `lg:@ws/main:min-h-0 lg:@ws/main:overflow-y-auto lg:@ws/main:p-1.5 ${fill ? 'lg:@ws/main:flex lg:@ws/main:flex-col' : ''}`
    : '';
  return (
    <div id={id} data-pane="" className={`min-w-0 ${splitCls}`} {...a11y}>
      {children}
    </div>
  );
}
