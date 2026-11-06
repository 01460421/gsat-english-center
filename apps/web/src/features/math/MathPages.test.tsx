/**
 * 數學頁面的整合測試（迷你卷子 testFixtures.ts）：入口的數A／數B 分頁、練習模式看答案與詳解、選填作答、
 * 交卷後到成績頁（分數、逐題結果、答對率、詳解準備中、非選擇題自評）、續作與找不到卷子。
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import { loadMathAttempt, mathAttemptPersistence } from './attempt';
import { AttemptStore, createAttempt } from '../exams/attempt';
import MathLandingPage from './MathLandingPage';
import MathPaperPage from './MathPaperPage';
import MathResultsPage from './MathResultsPage';
import { MINI_MATH, MINI_MATH_INDEX, MINI_SOLUTIONS, jsonResponse } from './testFixtures';
import { prepareMathDom } from './testSetup';

async function renderAt(path: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/math" element={<MathLandingPage />} />
          <Route path="/math/:paperId" element={<MathPaperPage />} />
          <Route path="/math/:paperId/results" element={<MathResultsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function card(label: string): HTMLElement {
  const el = document.getElementById(`mq-${label}`);
  if (!el) throw new Error(`找不到第 ${label} 題`);
  return el;
}

let solutionsRequested = 0;

beforeAll(prepareMathDom);

beforeEach(() => {
  solutionsRequested = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/math/index.json')) return jsonResponse(MINI_MATH_INDEX);
      if (url.endsWith('/math/gsat-matha-115.json')) return jsonResponse(MINI_MATH);
      if (url.endsWith('/math/solutions/gsat-matha-115.json')) {
        solutionsRequested += 1;
        return jsonResponse(MINI_SOLUTIONS);
      }
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => clearDataCache());

describe('/math 入口', () => {
  it('預設數學A；切到數學B 寫進網址；沒有舊課綱卷子時不出現「舊課綱」分頁', async () => {
    const user = userEvent.setup();
    await renderAt('/math');
    expect(await screen.findByRole('heading', { level: 1, name: '學測數學' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /數學A/ })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /舊課綱/ })).toBeNull();
    const link = screen.getByRole('link', { name: /115 學年度/ });
    expect(link).toHaveAttribute('href', '/math/gsat-matha-115');
    expect(within(link).getByText('108課綱')).toBeInTheDocument();
    expect(within(link).getByText('本站詳解 1／5 題')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /數學B/ }));
    expect(screen.getByRole('link', { name: /115 學年度/ })).toHaveAttribute('href', '/math/gsat-mathb-115');
    expect(screen.getByText('詳解準備中')).toBeInTheDocument();
  });
});

describe('作答頁', () => {
  async function startPractice() {
    const user = userEvent.setup();
    await renderAt('/math/gsat-matha-115');
    expect(await screen.findByRole('heading', { level: 1, name: MINI_MATH.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '開始作答' }));
    return user;
  }

  it('練習模式：作答後看答案與詳解（看了才下載詳解），顯示得分、答對率與本站詳解', async () => {
    const user = await startPractice();
    expect(solutionsRequested).toBe(0);
    const q1 = card('1');
    await user.click(within(q1).getByRole('radio', { name: /\(1\)/ }));
    await user.click(within(q1).getByRole('button', { name: '看答案與詳解' }));
    expect(within(q1).getByText('答錯')).toBeInTheDocument();
    expect(within(q1).getByText('全國答對率 81%（官方統計）')).toBeInTheDocument();
    expect(await within(q1).findByText('關鍵')).toBeInTheDocument();
    expect(within(q1).getByText('AI 撰寫・已獨立驗算')).toBeInTheDocument();
    expect(solutionsRequested).toBe(1);
    for (const r of within(q1).getAllByRole('radio')) expect(r).toBeDisabled();
  });

  it('多選部分得分、選填逐格作答；非選擇題有紙上作答說明與拍照批改預告（不是可按的按鈕）', async () => {
    const user = await startPractice();
    const q2 = card('2');
    await user.click(within(q2).getByRole('checkbox', { name: /\(2\)/ }));
    await user.click(within(q2).getByRole('checkbox', { name: /\(3\)/ }));
    await user.click(within(q2).getByRole('button', { name: '看答案與詳解' }));
    expect(within(q2).getByText('部分得分')).toBeInTheDocument();
    expect(within(q2).getByText('得分 3／5')).toBeInTheDocument();
    expect(await within(q2).findByText('詳解準備中')).toBeInTheDocument();

    const q3 = card('3');
    expect(within(q3).getByRole('table')).toBeInTheDocument();
    await user.click(within(within(q3).getByRole('group', { name: /3-1 格/ })).getByRole('radio', { name: '1' }));
    await user.click(within(within(q3).getByRole('group', { name: /3-2 格/ })).getByRole('radio', { name: '2' }));
    expect(loadMathAttempt('gsat-matha-115')?.answers['3']).toEqual(['1', '2']);

    const q5 = card('5');
    expect(within(q5).getByText(/請在紙上作答/)).toBeInTheDocument();
    expect(within(q5).getByText('拍照 AI 批改即將推出')).toBeInTheDocument();
    expect(within(q5).queryByRole('button', { name: /拍照/ })).toBeNull();
  });

  it('交卷後到成績頁：自動批改分數、逐題結果、詳解、非選擇題自評', async () => {
    const user = await startPractice();
    await user.click(within(card('1')).getByRole('radio', { name: /\(2\)/ }));
    await user.click(within(card('4')).getByRole('radio', { name: /\(2\)/ }));
    await user.click(screen.getByRole('button', { name: '交卷' }));
    const confirm = screen.getByRole('group', { name: '確認交卷' });
    expect(within(confirm).getByText(/還有 2 題選擇（填）題沒有作答/)).toBeInTheDocument();
    await act(async () => {
      await user.click(within(confirm).getByRole('button', { name: '確定交卷' }));
    });
    expect(await screen.findByRole('heading', { name: '交卷結果' })).toBeInTheDocument();
    const summary = screen.getByRole('heading', { name: '交卷結果' }).closest('section')!;
    expect(within(summary).getByText('8')).toBeInTheDocument();
    expect(within(summary).getByText('／18')).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: '逐題結果' })).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(within(rows[1]!).getByText('答對')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('81%')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('未答')).toBeInTheDocument();
    expect(await within(card('1')).findByText('關鍵')).toBeInTheDocument();
    await user.selectOptions(within(card('5')).getByRole('combobox', { name: '自評分數' }), '6');
    expect(within(summary).getByText(/合計（含自評）/)).toHaveTextContent('合計（含自評）：14／26 分');
    expect(JSON.parse(window.localStorage.getItem('gsat-math-self:v1:gsat-matha-115') ?? '{}')).toEqual({ '5': 6 });
  });

  it('有作答紀錄時直接續作；考試模式不顯示看答案', async () => {
    const store = new AttemptStore(createAttempt('gsat-matha-115', 'exam', 6000), true, mathAttemptPersistence);
    mathAttemptPersistence.save(store.getState());
    store.setAnswer('2', ['1']);
    await renderAt('/math/gsat-matha-115');
    expect(await screen.findByText(/已接續上次的作答進度（考試模式，已答 1 題）/)).toBeInTheDocument();
    expect(within(card('2')).getByRole('checkbox', { name: /\(1\)/ })).toBeChecked();
    expect(screen.queryByRole('button', { name: '看答案與詳解' })).toBeNull();
    expect(screen.getByRole('timer')).toHaveAccessibleName(/剩餘時間/);
  });

  it('沒交卷就打開成績頁：提示還沒有交卷', async () => {
    await renderAt('/math/gsat-matha-115/results');
    expect(await screen.findByRole('heading', { name: '還沒有交卷' })).toBeInTheDocument();
  });

  it('卷子代號不對：找不到這份卷子（不發請求）', async () => {
    await renderAt('/math/gsat-matha-1x5');
    expect(await screen.findByRole('heading', { name: '找不到這份卷子' })).toBeInTheDocument();
  });
});
