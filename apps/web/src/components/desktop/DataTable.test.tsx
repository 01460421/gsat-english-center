/**
 * 桌機的資料表（components/desktop/DataTable.tsx，設計文件 §4.8）：排序與 aria-sort、每列只有一個連結、
 * 點列上非互動的地方觸發該列的連結（等一下才換頁；選取文字、雙擊選字時不觸發）、連結帶 state、分組、sticky 表頭的高度。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, ROW_CLICK_DELAY_MS, sortRows, type Column } from './DataTable';

interface Exam {
  id: string;
  label: string;
  kind: string;
  questions: number;
}

const ROWS: Exam[] = [
  { id: 'gsat-114', label: '114 學測', kind: '學測', questions: 59 },
  { id: 'ast-110', label: '110 指考', kind: '指考', questions: 53 },
  { id: 'gsat-115', label: '115 學測', kind: '學測', questions: 66 },
];

const COLUMNS: Column<Exam>[] = [
  { id: 'exam', header: '考卷', cell: () => null, sortValue: (r) => r.label },
  { id: 'questions', header: '題數', cell: (r) => `${r.questions} 題`, sortValue: (r) => r.questions, align: 'end' },
  { id: 'note', header: '備註', cell: (r) => <span>備註 {r.id}</span> },
];

function Destination() {
  const location = useLocation();
  return <p>{`到了 ${location.pathname}，帶著 ${JSON.stringify(location.state)}`}</p>;
}

function renderTable(props: Partial<Parameters<typeof DataTable<Exam>>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={['/exams?kind=gsat']}>
      <Routes>
        <Route
          path="/exams"
          element={
            <DataTable<Exam>
              caption="歷屆試題"
              columns={COLUMNS}
              rows={ROWS}
              rowKey={(r) => r.id}
              primaryLink={(r) => ({ to: `/exams/${r.id}`, label: r.label, state: { listSearch: '?kind=gsat' } })}
              {...props}
            />
          }
        />
        <Route path="/exams/:id" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

const rowLabels = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent);

describe('DataTable', () => {
  it('真的表格：caption、欄標題；每列只有一個連結（可存取名稱就是卡片的名稱）', () => {
    renderTable();
    expect(screen.getByRole('table', { name: '歷屆試題' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['考卷', '題數', '備註']);
    for (const row of screen.getAllByRole('row').slice(1)) expect(within(row).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '115 學測' })).toHaveAttribute('href', '/exams/gsat-115');
  });

  it('點表頭排序：aria-sort 只在目前排序的那一欄，再點一次反向', async () => {
    const user = userEvent.setup();
    renderTable({ initialSort: { id: 'questions', dir: 'asc' } });
    expect(rowLabels()).toEqual(['110 指考', '114 學測', '115 學測']);
    const questions = screen.getByRole('columnheader', { name: /題數/ });
    expect(questions).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: /考卷/ })).not.toHaveAttribute('aria-sort');
    expect(screen.getByRole('columnheader', { name: '備註' })).not.toHaveAttribute('aria-sort');
    await user.click(within(questions).getByRole('button'));
    expect(questions).toHaveAttribute('aria-sort', 'descending');
    expect(rowLabels()).toEqual(['115 學測', '114 學測', '110 指考']);
    await user.click(screen.getByRole('button', { name: /考卷/ }));
    expect(screen.getByRole('columnheader', { name: /考卷/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(questions).not.toHaveAttribute('aria-sort');
  });

  it('點列上非互動的地方觸發該列的連結（等一下才換頁），並帶著 state', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByText('備註 ast-110'));
    expect(await screen.findByText('到了 /exams/ast-110，帶著 {"listSearch":"?kind=gsat"}')).toBeInTheDocument();
  });

  it('正在選取文字時點列不換頁', async () => {
    const user = userEvent.setup();
    renderTable();
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '110 指考' } as Selection);
    await user.click(screen.getByText('備註 ast-110'));
    await act(() => new Promise((r) => setTimeout(r, ROW_CLICK_DELAY_MS + 50)));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('雙擊選字：第一下 click 不立刻換頁，第二下（detail 2）取消；等待期間選了文字也不換頁', () => {
    vi.useFakeTimers();
    try {
      renderTable();
      const cell = screen.getByText('備註 ast-110');
      fireEvent.click(cell, { detail: 1 });
      expect(screen.getByRole('table')).toBeInTheDocument();
      fireEvent.click(cell, { detail: 2 });
      act(() => vi.advanceTimersByTime(ROW_CLICK_DELAY_MS * 2));
      expect(screen.getByRole('table')).toBeInTheDocument();

      // 拖曳選字：mouseup 之後的 click 當下還沒有選取，換頁之前才看得到。
      fireEvent.click(cell, { detail: 1 });
      vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'ast-110' } as Selection);
      act(() => vi.advanceTimersByTime(ROW_CLICK_DELAY_MS * 2));
      expect(screen.getByRole('table')).toBeInTheDocument();

      // 單擊：時間到了才換頁。
      vi.restoreAllMocks();
      fireEvent.click(cell, { detail: 1 });
      act(() => vi.advanceTimersByTime(ROW_CLICK_DELAY_MS - 10));
      expect(screen.getByRole('table')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByText(/^到了 \/exams\/ast-110/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sticky 表頭：高度寫進 <html> 的 --table-head-h（scroll-padding-top 用），卸載時移除', () => {
    const view = renderTable({ stickyHeader: true });
    expect(document.documentElement.style.getPropertyValue('--table-head-h')).toMatch(/^\d+px$/);
    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--table-head-h')).toBe('');
    renderTable();
    expect(document.documentElement.style.getPropertyValue('--table-head-h')).toBe('');
  });

  it('分組：一組一個 tbody，組標題是 rowgroup 標題；組內依排序', () => {
    renderTable({ groupBy: (r) => r.kind, groupLabel: (k) => `${k}・100 分鐘`, initialSort: { id: 'questions', dir: 'desc' } });
    const groups = screen.getAllByRole('rowgroup').slice(1);
    expect(groups.map((g) => within(g).getAllByRole('rowheader')[0]?.textContent)).toEqual(['學測・100 分鐘', '指考・100 分鐘']);
    expect(within(groups[0] as HTMLElement).getAllByRole('link').map((a) => a.textContent)).toEqual(['115 學測', '114 學測']);
  });

  it('沒有資料時顯示 empty', () => {
    renderTable({ rows: [], empty: '沒有符合的考卷' });
    expect(screen.getByText('沒有符合的考卷')).toBeInTheDocument();
  });
});

describe('sortRows', () => {
  it('穩定排序：值相同時保持原本的順序；中文用數字感知的比較', () => {
    const rows = [
      { id: 'a', n: 2, s: '第 10 題' },
      { id: 'b', n: 1, s: '第 9 題' },
      { id: 'c', n: 2, s: '第 1 題' },
    ];
    const cols: Column<(typeof rows)[number]>[] = [
      { id: 'n', header: 'n', cell: () => null, sortValue: (r) => r.n },
      { id: 's', header: 's', cell: () => null, sortValue: (r) => r.s },
    ];
    expect(sortRows(rows, cols, { id: 'n', dir: 'asc' }).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, cols, { id: 's', dir: 'asc' }).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, cols, null)).toBe(rows);
  });
});
