/**
 * /exams 的桌機資料表（docs/design/desktop-ui.md §5.7）：分組與分組標題的時間、題型結構的精簡寫法、每列只有一個連結、
 * 篩選條件帶進作答頁（state.listSearch）、「只看作答中」、依進度排序。
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { ExamIndex, ExamSummary } from '../../data/exams';
import { setDesktopViewport } from '../../test/viewport';
import { attemptStorageKey, createAttempt } from './attempt';
import { ExamList } from './ExamList';
import { examGroupKey, groupedExams, progressSortValue, sectionStructure } from './ExamTable';
import { MINI_INDEX } from './testFixtures';

const gsat115 = MINI_INDEX.exams[0] as ExamSummary;
const exam = (patch: Partial<ExamSummary>): ExamSummary => ({ ...gsat115, ...patch });

const INDEX: ExamIndex = {
  ...MINI_INDEX,
  exams: [
    gsat115,
    exam({ id: 'gsat-114', year: 114, title: '114學年度學科能力測驗英文考科' }),
    exam({ id: 'ast-110', exam: 'ast', year: 110, time_minutes: 80, title: '110學年度指定科目考試英文考科', question_count: 54 }),
    ...MINI_INDEX.exams.slice(1),
    exam({ id: 'ref-107-a', exam: 'reference', year: 107, time_minutes: 80, target: 'ast', title: '指定科目考試參考試卷（107學年度起適用）英文考科', has_stats: false }),
  ],
};

describe('ExamTable 的小工具', () => {
  it('題型結構：一字簡稱＋題數（title 用全名）', () => {
    expect(sectionStructure(gsat115, { vocabulary: '詞', mixed: '混' } as never, '')).toBe('詞10 混4');
  });

  it('分組：學測 → 指考 → 補考 → 參考試卷，同一組時間不同再分（時間長的在前）；組內維持原本的順序', () => {
    expect(groupedExams(INDEX.exams).map((e) => `${examGroupKey(e)} ${e.id}`)).toEqual([
      '學測・100 分鐘 gsat-115',
      '學測・100 分鐘 gsat-114',
      '指考・80 分鐘 ast-110',
      '補考・80 分鐘 ast-109-makeup',
      '參考試卷・100 分鐘 ref-111',
      '參考試卷・80 分鐘 ref-107-a',
    ]);
  });

  it('進度的排序值：沒做過 < 作答中（依已答比例）< 已交卷（依得分比例）', () => {
    expect(progressSortValue(null, 53)).toBe(0);
    expect(progressSortValue({ status: 'in_progress', mode: 'exam', answered: 0 }, 50)).toBe(1);
    expect(progressSortValue({ status: 'in_progress', mode: 'exam', answered: 25 }, 50)).toBe(1.5);
    expect(progressSortValue({ status: 'submitted', mode: 'exam', result: { earned: 30, autoMax: 60 } }, 50)).toBe(3.5);
    expect(progressSortValue({ status: 'submitted', mode: 'exam', result: null }, 50)).toBe(3);
  });
});

function PaperStub() {
  const location = useLocation();
  return <p>作答頁：{(location.state as { listSearch?: string } | null)?.listSearch ?? '（沒有 state）'}</p>;
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="search">{location.search}</p>;
}

async function renderList(path: string) {
  setDesktopViewport();
  const promise = Promise.resolve(INDEX);
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/exams"
            element={
              <>
                <ExamList indexPromise={promise} view="table" />
                <LocationProbe />
              </>
            }
          />
          <Route path="/exams/:examId" element={<PaperStub />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return screen.findByRole('table', { name: '歷屆試題' });
}

describe('ExamList view="table"', () => {
  it('分組標題寫考試與時間；欄位沒有滿分、時間、動作；每列只有一個連結，名稱以考卷名稱開頭、帶新制標章', async () => {
    const table = await renderList('/exams');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['考卷', '題數', '全國答對率', '題型結構', '我的進度']);
    expect(within(table).getAllByRole('rowheader').map((th) => th.textContent)).toEqual([
      '學測・100 分鐘',
      '指考・80 分鐘',
      '補考・80 分鐘',
      '參考試卷・100 分鐘',
      '參考試卷・80 分鐘',
    ]);
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(INDEX.exams.length);
    const rows = within(table)
      .getAllByRole('row')
      .filter((r) => within(r).queryAllByRole('cell').length > 0);
    for (const row of rows) expect(within(row).getAllByRole('link')).toHaveLength(1);
    const first = within(table).getByRole('link', { name: /^115 學測/ });
    expect(first).toHaveTextContent('115 學測新制');
    expect(first).toHaveAttribute('title', '115學年度學科能力測驗英文考科');
    expect(within(table).getByRole('link', { name: /^109 指考補考/ })).toHaveTextContent('補考');
  });

  it('篩選放在 sticky 篩選列；篩選條件（網址）帶進作答頁的 state', async () => {
    const user = userEvent.setup();
    const table = await renderList('/exams?kind=ast&year=110');
    expect(screen.getByRole('combobox', { name: '學年度' })).toHaveValue('110');
    expect(screen.getByRole('status')).toHaveTextContent('共 1 份考卷・54 題');
    const links = within(table).getAllByRole('link');
    expect(links).toHaveLength(1);
    await user.click(links[0] as HTMLElement);
    expect(await screen.findByText('作答頁：?kind=ast&year=110')).toBeInTheDocument();
  });

  it('點列上沒有連結的地方也會進入考卷（鍵盤與讀屏仍用第一欄的連結）', async () => {
    const user = userEvent.setup();
    const table = await renderList('/exams?kind=gsat');
    await user.click(within(table).getAllByRole('cell', { name: '53' })[0] as HTMLElement);
    expect(await screen.findByText('作答頁：?kind=gsat')).toBeInTheDocument();
  });

  it('只看作答中：網址記 ?progress=active，只列作答中的考卷；進度欄寫已答題數', async () => {
    const user = userEvent.setup();
    localStorage.setItem(attemptStorageKey('gsat-114'), JSON.stringify({ ...createAttempt('gsat-114', 'practice', null), answers: { '1': 'A', '2': 'B' } }));
    const table = await renderList('/exams');
    expect(within(table).getAllByRole('link')).toHaveLength(INDEX.exams.length);
    await user.click(screen.getByRole('checkbox', { name: '只看作答中' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?progress=active');
    const links = within(screen.getByRole('table', { name: '歷屆試題' })).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['114 學測新制']);
    const row = links[0]?.closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('作答中・2／53');
  });
});
