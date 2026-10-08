/**
 * 作答頁的整合測試：用迷你考卷（testFixtures.ts）走過練習模式、綜合測驗與文意選填的空格操作、
 * 重新開啟後續作、考試模式交卷計分，以及考卷不存在的畫面。
 */
import { act, render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import ExamsPage from '../../pages/ExamsPage';
import { AttemptStore, createAttempt, loadAttempt } from './attempt';
import ExamPaperPage from './ExamPaperPage';
import { MINI_EXAM, MINI_INDEX, jsonResponse } from './testFixtures';

/**
 * 頁面用 use() 讀資料：React 19 在測試環境（act）裡，Suspense 等到的 Promise 只在「被 await 的 act」中處理，
 * 所以 render 要包在 await act(async …) 裡，否則畫面會一直停在「載入中」。
 */
async function renderAt(path: string): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/exams" element={<ExamsPage />} />
          <Route path="/exams/:examId" element={<ExamPaperPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  if (!result) throw new Error('render 沒有完成');
  return result;
}

function questionCard(label: string): HTMLElement {
  const el = document.getElementById(`q-${label}`);
  if (!el) throw new Error(`找不到第 ${label} 題`);
  return el;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/exams/index.json')) return jsonResponse(MINI_INDEX);
      if (url.endsWith('/exams/gsat-115.json')) return jsonResponse(MINI_EXAM);
      return new Response('not found', { status: 404 });
    }),
  );
});

afterEach(() => {
  clearDataCache();
});

async function startPractice() {
  const user = userEvent.setup();
  await renderAt('/exams/gsat-115');
  expect(await screen.findByRole('heading', { level: 1, name: MINI_EXAM.title })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /練習模式/ })).toBeChecked();
  await user.click(screen.getByRole('button', { name: '開始作答' }));
  return user;
}

describe('練習模式', () => {
  it('作答後看答案：顯示對錯、正確答案、全國答對率與選項分布', async () => {
    const user = await startPractice();
    const card = questionCard('1');
    await user.click(within(card).getByRole('radio', { name: /\(A\) hasty/ }));
    await user.click(within(card).getByRole('button', { name: '看答案' }));

    const feedback = within(card).getByTestId('question-feedback');
    expect(within(feedback).getByText('答錯')).toBeInTheDocument();
    expect(within(feedback).getByText('全國答對率')).toBeInTheDocument();
    expect(within(feedback).getByText('0.54')).toBeInTheDocument();
    expect(within(feedback).getByRole('list', { name: '全國考生各選項選答比例' })).toHaveTextContent('57%');
    // 看過答案就鎖住，不能再改。
    expect(within(card).getByRole('radio', { name: /\(B\) tight/ })).toBeDisabled();
  });

  it('送分題看答案時顯示送分', async () => {
    const user = await startPractice();
    const card = questionCard('2');
    await user.click(within(card).getByRole('button', { name: '看答案' }));
    expect(within(card).getByText(/送分 \+1 分/)).toBeInTheDocument();
    expect(within(card).getByText(/測試用送分題/)).toBeInTheDocument();
  });

  it('綜合測驗：點選文中的空格，在段落下方選答案，下方逐題選項同步', async () => {
    const user = await startPractice();
    await user.click(screen.getByRole('button', { name: '第 11 題空格，未作答' }));
    const panel = screen.getByRole('group', { name: '第 11 題的選項' });
    await user.click(within(panel).getByRole('button', { name: /it turns out/ }));
    expect(screen.queryByRole('group', { name: '第 11 題的選項' })).not.toBeInTheDocument();
    const slot = screen.getByRole('button', { name: /第 11 題空格，已填 \(B\) it turns out/ });
    expect(slot).toHaveFocus();
    expect(within(questionCard('11')).getByRole('radio', { name: /\(B\) it turns out/ })).toBeChecked();
  });

  it('文意選填：點空格再點晶片填入；用過的晶片再點會搬到目前的空格', async () => {
    const user = await startPractice();
    await user.click(screen.getByRole('button', { name: '第 21 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 21 題的選項' })).getByRole('button', { name: /\(E\) lazy/ }));
    expect(screen.getByRole('button', { name: /第 21 題空格，已填 \(E\) lazy/ })).toBeInTheDocument();

    // 點第 22 題空格後收起面板，改用右邊（手機是下方）的選項庫填。
    await user.click(screen.getByRole('button', { name: '第 22 題空格，未作答' }));
    await user.keyboard('{Escape}');
    expect(screen.getByText('目前空格：第 22 題')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^\(A\) retain/ }));
    expect(screen.getByRole('button', { name: /第 22 題空格，已填 \(A\) retain/ })).toBeInTheDocument();
    // 填完自動移到下一個空格（第 23 題）。
    expect(screen.getByText('目前空格：第 23 題')).toBeInTheDocument();

    // (E) 已用在第 21 題：晶片標示出來，再點會搬到第 23 題，第 21 題清空。
    const used = screen.getByRole('button', { name: /^\(E\) lazy\s*（已用於第 21 題）/ });
    await user.click(used);
    expect(screen.getByRole('button', { name: /第 23 題空格，已填 \(E\) lazy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 21 題空格，未作答' })).toBeInTheDocument();
  });

  it('混合題：題幹中的 [[47]] 是輸入框，看參考答案時比對文字但不計分', async () => {
    const user = await startPractice();
    await user.type(screen.getByRole('textbox', { name: '第 47 題作答' }), 'Innovation.');
    const card = questionCard('47');
    await user.click(within(card).getByRole('button', { name: '看參考答案' }));
    expect(within(card).getByText(/和參考答案相同/)).toBeInTheDocument();
    expect(within(card).getAllByText(/參考答案出處：大學入學考試中心/).length).toBeGreaterThan(0);
    expect(within(card).getAllByRole('link', { name: /官方評分原則/ })[0]).toHaveAttribute('href', 'https://www.ceec.edu.tw/scoring.pdf');
  });

  it('中譯英看說明：不顯示官方參考譯文，只附官方評分原則連結（D8）', async () => {
    const user = await startPractice();
    const card = questionCard('中譯英1');
    await user.type(within(card).getByRole('textbox', { name: '英文譯文' }), 'More and more teachers use English.');
    expect(within(card).queryByRole('button', { name: '看參考答案' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '看說明' }));
    const feedback = within(card).getByTestId('question-feedback');
    expect(feedback).toHaveTextContent('本題官方參考譯文請見大考中心');
    expect(within(feedback).getByRole('link', { name: /非選擇題評分原則/ })).toHaveAttribute('href', 'https://www.ceec.edu.tw/scoring.pdf');
    expect(feedback).toHaveTextContent('More and more teachers use English.');
    expect(feedback).not.toHaveTextContent('官方參考答案');
    expect(feedback).not.toHaveTextContent('其他可接受');
  });

  it('refers_to 指到的字在選文中高亮，<u> 標記保留底線', async () => {
    await startPractice();
    const mark = screen.getByTitle('第 40 題所指的字詞');
    expect(mark.tagName).toBe('MARK');
    expect(mark).toHaveTextContent('them');
    expect(screen.getByText('stairs', { selector: 'u' })).toBeInTheDocument();
  });

  it('頁尾標示試題來源與官方檔案連結', async () => {
    await startPractice();
    expect(screen.getByText(/試題來源：大學入學考試中心 115學年度學科能力測驗英文考科（115 學年度）/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /試題（PDF）/ })).toHaveAttribute('href', 'https://www.ceec.edu.tw/paper.pdf');
  });
});

describe('續作與清除', () => {
  it('關掉頁面再回來：接續原本的模式與答案（含作文），可以清除重來', async () => {
    const user = userEvent.setup();
    const first = await renderAt('/exams/gsat-115');
    await user.click(await screen.findByRole('radio', { name: /考試模式/ }));
    await user.click(screen.getByRole('button', { name: '開始作答' }));
    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    await user.type(screen.getByRole('textbox', { name: /你的作文/ }), 'Pets are family.');
    first.unmount();

    await renderAt('/exams/gsat-115');
    expect(await screen.findByText(/已接續上次的作答進度（考試模式，已答 2 題）/)).toBeInTheDocument();
    expect(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ })).toBeChecked();
    expect(screen.getByRole('textbox', { name: /你的作文/ })).toHaveValue('Pets are family.');
    expect(screen.getByRole('textbox', { name: /你的作文/ })).toHaveAccessibleDescription(/3 個單詞\s*・1 段/);

    await user.click(screen.getByRole('button', { name: '清除重來' }));
    await user.click(screen.getByRole('button', { name: '確定清除' }));
    expect(screen.getByRole('button', { name: '開始作答' })).toBeInTheDocument();
    expect(loadAttempt('gsat-115')).toBeNull();
  });
});

describe('考試模式', () => {
  it('交卷前不能看答案；交卷後顯示總分、各大題得分與每題回饋', async () => {
    const user = userEvent.setup();
    await renderAt('/exams/gsat-115');
    await user.click(await screen.findByRole('radio', { name: /考試模式/ }));
    expect(screen.getByRole('spinbutton', { name: '作答時間（分鐘）' })).toHaveValue(100);
    await user.click(screen.getByRole('button', { name: '開始作答' }));

    expect(screen.queryByRole('button', { name: '看答案' })).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveAccessibleName(/剩餘時間 100 分鐘/);

    await user.click(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ }));
    const multi = questionCard('49');
    await user.click(within(multi).getByRole('checkbox', { name: /\(A\) Oh Eco/ }));
    await user.click(within(multi).getByRole('checkbox', { name: /\(D\) Something Different/ }));

    await user.click(screen.getByRole('button', { name: '交卷' }));
    expect(screen.getByText(/還有 11 題沒有作答/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確定交卷' }));

    const result = screen.getByRole('region', { name: '交卷結果' });
    expect(within(result).getByRole('heading', { name: '交卷結果' })).toHaveFocus();
    // 第 1 題 1 分＋第 2 題送分 1 分＋第 49 題錯 1 個選項 4 × 4/6。
    expect(within(result).getByText('4.67')).toBeInTheDocument();
    expect(within(result).getByText('／13')).toBeInTheDocument();
    const table = within(result).getByRole('table');
    expect(within(table).getByRole('row', { name: /混合題.*2.67／4.*另 4 分非選擇題未計/ })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /英文作文.*不自動計分/ })).toBeInTheDocument();

    expect(within(multi).getByText(/部分給分 2.67／4 分（錯 1 個選項）/)).toBeInTheDocument();
    expect(within(questionCard('1')).getByRole('radio', { name: /\(B\) tight/ })).toBeDisabled();
    expect(loadAttempt('gsat-115')?.result).toEqual({ earned: 2 + (4 * 4) / 6, autoMax: 13 });
  });
});

describe('列表與找不到考卷', () => {
  it('考卷不存在時顯示說明與回列表的連結', async () => {
    await renderAt('/exams/gsat-999');
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這份考卷' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到歷屆試題列表' })).toHaveAttribute('href', '/exams');
  });

  it('列表：新制與補考標記、依考試篩選、顯示作答進度', async () => {
    const user = userEvent.setup();
    new AttemptStore(createAttempt('gsat-115', 'practice', null)).setAnswer('1', 'B');
    await renderAt('/exams');
    const gsat = await screen.findByRole('link', { name: /115 學測/ });
    expect(gsat).toHaveTextContent('新制');
    expect(gsat).toHaveTextContent('作答中・1／53');
    expect(gsat).toHaveTextContent('詞彙題 10 題');
    expect(gsat).toHaveAttribute('href', '/exams/gsat-115');
    expect(screen.getByRole('link', { name: /111 參考試卷（學測）/ })).toHaveTextContent('新制');
    expect(screen.getByRole('link', { name: /109 指考補考/ })).not.toHaveTextContent('新制');

    await user.click(screen.getByRole('radio', { name: /補考/ }));
    expect(screen.getAllByRole('link', { name: /學測|指考|參考試卷/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /109 指考補考/ })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^指考/ }));
    expect(screen.getByText('沒有符合條件的考卷。')).toBeInTheDocument();
  });
});
