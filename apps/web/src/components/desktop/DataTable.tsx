/**
 * 桌機的資料表（docs/design/desktop-ui.md §4.8）：/exams、寫作紀錄這類列表在 ≥ lg 改用它，< lg 維持各頁的卡片
 * （用 useMediaQuery 二選一，同時只有一份，R3）。
 *
 * - 真的 <table>：<caption>、<th scope="col">；可排序的欄，表頭是 <th aria-sort> 裡的 <button>；數字欄 tabular-nums 靠右。
 * - 每列只有一個 Tab 停留點：第一欄放真正的 <Link>（primaryLink；鍵盤、螢幕閱讀器、中鍵與 Ctrl＋點擊都靠它，
 *   state 讓列表把篩選條件帶進下一頁）。<tr> 的 onClick 只是滑鼠的方便：點到列上非互動的地方、而且沒有在選取文字時，
 *   觸發該列的連結。不用 role="link" 的 <tr>，也不用絕對定位的覆蓋層（<tr> 的 position: relative 各瀏覽器不一）。
 *   整列點擊等 ROW_CLICK_DELAY_MS 才換頁：雙擊選字的第一下 click 發生在選取範圍建立之前，當下看不出來；等的期間有第二下
 *   click（e.detail > 1）就取消，時間到了再確認一次沒有選取文字。直接點連結本身照常立刻換頁。
 * - 分組（groupBy）：一組一個 <tbody>，第一列是組標題（整組相同的值，例如考試時間，放在這裡）。
 * - sticky 表頭貼在 StickyBar 下方（top: --sticky-bar-h）。表格的任何祖先都不能有 overflow: auto/hidden，否則 sticky 失效，
 *   所以不包水平捲動容器；放不下的欄在 main 不夠寬時用 container query 隱藏（className 寫 lg:@max-ws/main:hidden）。
 * - sticky 表頭的高度寫進 <html> 的 --table-head-h，算進 scroll-padding-top（index.css）：Tab／Shift+Tab 時焦點不會停在
 *   表頭底下（§3.4、WCAG 2.4.11）。只靠列連結的 scroll-margin 不夠：焦點在 scroll-padding 以下時瀏覽器根本不捲，
 *   scroll-margin 沒機會作用，連結就整個壓在表頭底下（實測）。
 * 只在 ≥ lg render，所以樣式不必帶 lg: 前綴。
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { useStickyHeightVar } from './scroll';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** 有才可排序。 */
  sortValue?: (row: T) => string | number;
  align?: 'start' | 'end';
  /** 加在這一欄的 th 與 td 上（例如 lg:@max-ws/main:hidden）。 */
  className?: string;
  srOnlyHeader?: boolean;
}

export interface PrimaryLink {
  to: To;
  label: ReactNode;
  state?: unknown;
  /** 被截斷的文字放全文。 */
  title?: string;
}

export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  /** 表格名稱（captionSrOnly 時只給螢幕閱讀器）。 */
  caption: string;
  captionSrOnly?: boolean;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 每列唯一可聚焦的主要連結，放在第一欄（第一欄的 cell 接在連結後面，放標章這類非互動內容）。 */
  primaryLink?: (row: T) => PrimaryLink;
  initialSort?: SortState;
  groupBy?: (row: T) => string;
  groupLabel?: (key: string) => ReactNode;
  stickyHeader?: boolean;
  empty?: ReactNode;
  className?: string;
}

/** 點到這些元素時交給它自己處理，不觸發整列的連結。 */
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
}

/** 依 sort 排序（穩定：值相同時保持原本的順序）。 */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[] {
  const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
  if (!sort || !column?.sortValue) return rows;
  const value = column.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => sign * compare(a.key, b.key) || a.index - b.index)
    .map((r) => r.row);
}

/** 整列點擊等多久才換頁（ms）：比一般的雙擊間隔短，單擊的延遲不明顯。 */
export const ROW_CLICK_DELAY_MS = 250;

const hasSelection = () => (window.getSelection()?.toString() ?? '') !== '';

/** <tr> 的 onClick（滑鼠的方便）：見檔頭。卸載時取消還沒換的頁。 */
function useRowClick() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(INTERACTIVE)) return;
    // 第二下（雙擊、三擊選字）：取消第一下排好的換頁。
    cancel();
    if (e.detail > 1 || hasSelection()) return;
    const row = e.currentTarget;
    timer.current = setTimeout(() => {
      timer.current = null;
      // 拖曳選字、雙擊選字：這時選取範圍已經建立。
      if (!row.isConnected || hasSelection()) return;
      row.querySelector<HTMLAnchorElement>('a[data-row-link]')?.click();
    }, ROW_CLICK_DELAY_MS);
  };
}

export function DataTable<T>({
  caption,
  captionSrOnly = false,
  columns,
  rows,
  rowKey,
  primaryLink,
  initialSort,
  groupBy,
  groupLabel,
  stickyHeader = false,
  empty,
  className = '',
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const onRowClick = useRowClick();
  const headRef = useRef<HTMLTableSectionElement>(null);
  useStickyHeightVar(headRef, '--table-head-h', { enabled: stickyHeader });
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);
  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', rows: sorted }];
    const map = new Map<string, T[]>();
    // 組的順序照原始資料第一次出現的順序，組內才依排序。
    for (const row of rows) if (!map.has(groupBy(row))) map.set(groupBy(row), []);
    for (const row of sorted) map.get(groupBy(row))?.push(row);
    return [...map].map(([key, groupRows]) => ({ key, rows: groupRows }));
  }, [rows, sorted, groupBy]);

  const toggleSort = (id: string) =>
    setSort((s) => (s?.id === id ? { id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'asc' }));

  const thSticky = stickyHeader ? 'sticky top-[var(--sticky-bar-h,0px)] z-[1]' : '';
  const alignCls = (c: Column<T>) => (c.align === 'end' ? 'text-right tabular-nums' : 'text-left');

  return (
    <table className={`w-full border-separate border-spacing-0 text-[0.95rem] ${className}`}>
      <caption className={captionSrOnly ? 'sr-only' : 'pb-2 text-left font-semibold'}>{caption}</caption>
      <thead ref={headRef}>
        <tr>
          {columns.map((c) => {
            const sorting = c.sortValue && sort?.id === c.id ? sort.dir : null;
            // aria-sort 只放在目前排序的那一欄（WAI-ARIA：同一時間只有一個表頭帶 aria-sort）。
            const ariaSort = sorting === 'asc' ? 'ascending' : sorting === 'desc' ? 'descending' : undefined;
            const SortIcon = sorting === 'asc' ? ArrowUp : sorting === 'desc' ? ArrowDown : ArrowUpDown;
            return (
              <th
                key={c.id}
                scope="col"
                aria-sort={ariaSort}
                className={`${thSticky} border-b border-line bg-surface px-3 py-2.5 text-sm font-semibold text-muted ${alignCls(c)} ${c.className ?? ''}`}
              >
                {c.sortValue ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(c.id)}
                    className={`inline-flex items-center gap-1 rounded hover:text-fg ${c.srOnlyHeader ? 'sr-only' : ''}`}
                  >
                    {c.header}
                    <SortIcon aria-hidden="true" className={`size-3.5 ${sorting ? 'text-fg' : 'opacity-50'}`} />
                  </button>
                ) : (
                  <span className={c.srOnlyHeader ? 'sr-only' : ''}>{c.header}</span>
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      {rows.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={columns.length} className="px-3 py-6 text-center text-muted">
              {empty ?? '沒有資料'}
            </td>
          </tr>
        </tbody>
      ) : (
        groups.map((group) => (
          <tbody key={group.key || 'all'}>
            {groupBy && (
              <tr>
                <th scope="rowgroup" colSpan={columns.length} className="border-b border-line bg-surface-2 px-3 py-1.5 text-left text-sm font-semibold">
                  {groupLabel ? groupLabel(group.key) : group.key}
                </th>
              </tr>
            )}
            {group.rows.map((row) => {
              const link = primaryLink?.(row);
              return (
                <tr key={rowKey(row)} onClick={link ? onRowClick : undefined} className={link ? 'cursor-pointer hover:bg-surface-2' : ''}>
                  {columns.map((c, i) => (
                    <td key={c.id} className={`border-b border-line px-3 py-2 align-middle ${alignCls(c)} ${c.className ?? ''}`}>
                      {i === 0 && link ? (
                        <>
                          <Link
                            to={link.to}
                            state={link.state}
                            title={link.title}
                            data-row-link=""
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            {link.label}
                          </Link>
                          {c.cell(row)}
                        </>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))
      )}
    </table>
  );
}
