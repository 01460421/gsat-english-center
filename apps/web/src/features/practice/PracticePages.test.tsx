/**
 * 題庫練習頁的整合測試（假的 /data/bank/* 用 build-data 的範例輸出，見 testFixtures.ts）：
 *   - 選單：每格幾組、出題中、做過幾組；沒有任何題組時頁面正常；索引載入失敗可以重試；
 *   - 文意選填：作答、逐層看提示、交卷計分、四段式解析卡、證據句加亮、全文中譯、排除法表、「再一組」；
 *   - 詞彙題：卡片內的提示、你選的為什麼錯、答錯的正解字收進單字錯題本；
 *   - 重新開啟後接續同一組、空的格子、網址不對。
 */
import { act, render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankIndex } from '../../data/bank';
import { clearDataCache } from '../../data/client';
import { attemptStorageKey } from '../exams/attempt';
import { jsonResponse } from '../exams/testFixtures';
import { MISTAKES_STORAGE_KEY } from '../vocab/lib/mistakes';
import { resetVocabStoresForTests } from '../vocab/state';
import { PRACTICE_HISTORY_KEY, resetPracticeHistoryForTests } from './history';
import { AI_GROUP_LABEL, AI_ITEMS_NOTICE, AI_PASSAGE_NOTICE } from './labels';
import PracticeHome from './PracticeHome';
import PracticeSessionPage from './PracticeSessionPage';
import { BANK_INDEX, EMPTY_BANK_INDEX, GROUPS, MINI_VOCAB_INDEX } from './testFixtures';

let bankIndex: BankIndex = BANK_INDEX;
let indexStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  bankIndex = BANK_INDEX;
  indexStatus = 200;
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/data/bank/index.json')) return indexStatus === 200 ? jsonResponse(bankIndex) : new Response('x', { status: indexStatus });
    const m = /\/data\/bank\/groups\/(.+)\.json$/.exec(url);
    if (m?.[1] && GROUPS[m[1]]) return jsonResponse(GROUPS[m[1]]);
    if (url.endsWith('/data/vocab/index.json')) return jsonResponse(MINI_VOCAB_INDEX);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  resetPracticeHistoryForTests();
  resetVocabStoresForTests();
});

afterEach(() => {
  clearDataCache();
});

async function renderAt(path: string): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/practice" element={<PracticeHome />} />
          <Route path="/practice/:section/:tier" element={<PracticeSessionPage />} />
          <Route path="/words" element={<p>單字頁</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  if (!result) throw new Error('render 沒有完成');
  return result;
}

function storedHistory(): { done: Record<string, { correct: number; total: number; hinted: number }>; current: Record<string, string> } {
  return JSON.parse(window.localStorage.getItem(PRACTICE_HISTORY_KEY) ?? '{}') as never;
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '交卷' }));
  await user.click(screen.getByRole('button', { name: '確定交卷' }));
  return screen.findByRole('heading', { level: 2, name: '交卷結果' });
}

describe('選單（/practice）', () => {
  it('題型 × 難度：有題組的格子是連結並顯示組數，沒有的顯示「出題中」；說明三種難度給誰', async () => {
    await renderAt('/practice');
    expect(screen.getByRole('heading', { level: 1, name: '題庫練習' })).toBeInTheDocument();
    expect(screen.getByText('均標（8 級分）到前標（11 級分）的學生')).toBeInTheDocument();
    expect(screen.getByText('頂標到 15 級分的學生')).toBeInTheDocument();

    const wb = await screen.findByRole('link', { name: '文意選填・進階練習：1 組，已做 0 組' });
    expect(wb).toHaveAttribute('href', '/practice/word-bank/advanced');
    expect(screen.getByRole('link', { name: /^詞彙題・穩定基礎：1 組/ })).toHaveAttribute('href', '/practice/vocabulary/basic');
    expect(screen.getByRole('group', { name: '文意選填・超越頂標：出題中' })).toHaveTextContent('出題中');
    // 4 題型 × 3 難度，範例有 4 組，其他 8 格都是「出題中」。
    expect(screen.getAllByRole('group', { name: /：出題中$/ })).toHaveLength(8);
    expect(screen.getAllByRole('link', { name: /組，已做/ })).toHaveLength(4);
  });

  it('做過的組數來自練習紀錄', async () => {
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({ v: 1, done: { 'ai.wb.0a1b2c': { version: 1, section: 'word_bank', tier: 'advanced', at: '2026-10-08T00:00:00Z', correct: 8, total: 10, hinted: 0 } }, current: {}, hints: {} }),
    );
    await renderAt('/practice');
    expect(await screen.findByRole('link', { name: '文意選填・進階練習：1 組，已做 1 組' })).toHaveTextContent('已做 1');
  });

  it('還沒有任何題組：說明出題中，12 格都是「出題中」', async () => {
    bankIndex = EMPTY_BANK_INDEX;
    await renderAt('/practice');
    expect(await screen.findByText(/AI 題庫正在出題與驗證中/)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /：出題中$/ })).toHaveLength(12);
    expect(screen.queryByRole('link', { name: /組，已做/ })).not.toBeInTheDocument();
  });

  it('索引載入失敗：顯示錯誤，按「再試一次」重新下載', async () => {
    indexStatus = 500;
    // 錯誤邊界接住資料錯誤時 React 會在 console 印一次，這是預期中的，不要讓它洗版。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderAt('/practice');
    expect(await screen.findByRole('alert')).toHaveTextContent('資料載入失敗');
    indexStatus = 200;
    // 重新下載時會再 suspend 一次：要在 await 的 act 裡點，React 才會處理等到的 Promise（理由見 renderAt）。
    await act(async () => {
      screen.getByRole('button', { name: '再試一次' }).click();
    });
    expect(await screen.findByRole('link', { name: /文意選填・進階練習/ })).toBeInTheDocument();
  });
});

describe('文意選填（/practice/word-bank/advanced）', () => {
  it('作答、看提示、交卷：計分、解析卡、證據句、全文中譯、排除法表', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/word-bank/advanced');
    expect(await screen.findByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeInTheDocument();
    expect(screen.getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    expect(screen.getByText(AI_PASSAGE_NOTICE)).toBeInTheDocument();
    expect(screen.getByText('history of the umbrella')).toBeInTheDocument();
    // 交卷前沒有全文中譯，也沒有「看答案」。
    expect(screen.queryByText('全文中譯')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /看答案|核對/ })).not.toBeInTheDocument();

    // 第 1 格填 E（正解）、第 2 格填 A（錯）。
    await user.click(screen.getByRole('button', { name: '第 1 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 1 題的選項' })).getByRole('button', { name: /^\(E\) colorful/ }));
    await user.click(screen.getByRole('button', { name: '第 2 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 2 題的選項' })).getByRole('button', { name: /^\(A\) practical/ }));

    // 提示：第 1 題打開兩層。
    await user.click(screen.getByText('需要提示嗎？'));
    const hints = screen.getByRole('group', { name: /第 1 題提示/ });
    await user.click(within(hints).getByRole('button', { name: '看第 1 層提示' }));
    expect(within(hints).getByText('先看空格前後的字，判斷需要的詞性。')).toBeInTheDocument();
    await user.click(within(hints).getByRole('button', { name: '看第 2 層提示' }));
    expect(within(hints).getByText('找前後句裡和空格意思有關的字。')).toBeInTheDocument();
    expect(within(hints).getByText(/2／3 層/)).toBeInTheDocument();
    // 前兩層按完焦點留在按鈕上（按鈕還在，文字換成下一層）。
    expect(document.activeElement).toBe(within(hints).getByRole('button', { name: '看第 3 層提示' }));

    // 第 2 題（2 層提示）打開到最後一層：按鈕消失，焦點移到剛打開的最後一層，不會掉回 body。
    const hints2 = screen.getByRole('group', { name: /第 2 題提示/ });
    for (const n of [1, 2]) await user.click(within(hints2).getByRole('button', { name: `看第 ${n} 層提示` }));
    expect(within(hints2).queryByRole('button')).not.toBeInTheDocument();
    const items2 = within(hints2).getAllByRole('listitem');
    expect(items2).toHaveLength(2);
    expect(document.activeElement).toBe(items2[1]);
    expect(document.activeElement).not.toBe(document.body);

    const result = await submit(user);
    const panel = result.closest('section');
    if (!panel) throw new Error('找不到交卷結果');
    expect(panel).toHaveTextContent('1／10 題');
    expect(panel).toHaveTextContent('1／10 分');
    expect(panel).toHaveTextContent('用了提示：第 1、2 題');
    expect(panel).toHaveTextContent('選文裡加底線的是證據句。');

    // 每題一張解析卡；第 2 題選錯，顯示「你選的為什麼錯」。
    const cards = screen.getAllByTestId('explanation-card');
    expect(cards).toHaveLength(10);
    const card2 = screen.getByRole('region', { name: /第 2 題解析/ });
    expect(card2).toHaveTextContent('你選的為什麼錯');
    expect(card2).toHaveTextContent('practical 放進這一格語意或詞性不通。');
    expect(card2).toHaveTextContent('provide protection from 是固定搭配');
    expect(card2).toHaveTextContent('from the scorching sun');
    const card1 = screen.getByRole('region', { name: /第 1 題解析/ });
    expect(card1).toHaveTextContent('其他選項為什麼錯');
    expect(card1).toHaveTextContent('feminine「女性化的」');
    expect(card1).toHaveTextContent('作答時用了 2 層提示');
    expect(within(card1).getByRole('heading', { name: '提示階梯' })).toBeInTheDocument();
    expect(card1).toHaveTextContent('刪去 A、I：它們和 history 搭配不起來。');

    // 證據句在選文中加亮；按「在文中標出」加深那一題。
    const marks = document.querySelectorAll('mark[data-evidence-label]');
    expect(marks.length).toBeGreaterThanOrEqual(10);
    await user.click(within(card2).getByRole('button', { name: '在文中標出證據句' }));
    const active = document.querySelector('mark[data-evidence-label="2"]');
    expect(active).toHaveTextContent('from the scorching sun');
    expect(active).toHaveAttribute('data-active', 'true');
    // 焦點也移到證據句（鍵盤與螢幕閱讀器使用者被帶到選文裡）；它不在 Tab 順序裡。
    expect(document.activeElement).toBe(active);
    expect(active).toHaveAttribute('tabindex', '-1');
    // 證據句的每一段都不加左右內距：被空格或另一題的證據切開時，標點前不會多出空隙。
    for (const m of document.querySelectorAll('mark[data-evidence-label]')) expect(m.className).not.toMatch(/\bpx-/);

    // 全文中譯可以展開；排除法表標出正解、可行與你的答案。
    expect(screen.getByText('全文中譯')).toBeInTheDocument();
    expect(screen.getByText(/今天雨傘隨處可見/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /每一格（列）放得進去的選項/ });
    const row5 = within(table).getByRole('row', { name: /^5/ });
    expect(row5).toHaveTextContent('I：正解');
    expect(row5).toHaveTextContent('A：也放得進去');
    expect(row5).toHaveTextContent('B：放不進去');
    expect(within(table).getByRole('row', { name: /^2/ })).toHaveTextContent('A：放不進去，你的答案');

    // 練習紀錄：做過、提示數。
    expect(storedHistory().done['ai.wb.0a1b2c']).toMatchObject({ correct: 1, total: 10, hinted: 2 });
  });

  it('「再一組」：清掉作答重新開始（這一格只有一組時重做同一組並說明）', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/word-bank/advanced');
    await screen.findByRole('heading', { level: 1, name: '文意選填・進階練習' });
    await user.click(screen.getByRole('button', { name: '第 3 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 3 題的選項' })).getByRole('button', { name: /^\(B\) symbol/ }));
    await submit(user);
    expect(screen.getAllByText(/這一格目前只有這一組/).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole('button', { name: '再一組' })[0] as HTMLElement);
    expect(await screen.findByRole('button', { name: '第 3 題空格，未作答' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '交卷結果' })).not.toBeInTheDocument();
    expect(screen.getByText(/這一格的 1 組你都做過了/)).toBeInTheDocument();
    expect(window.localStorage.getItem(attemptStorageKey('practice:ai.wb.0a1b2c@1'))).toBeNull();
  });

  it('重新開啟頁面：接續同一組與已填的答案', async () => {
    const user = userEvent.setup();
    const first = await renderAt('/practice/word-bank/advanced');
    await screen.findByRole('heading', { level: 1, name: '文意選填・進階練習' });
    await user.click(screen.getByRole('button', { name: '第 4 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 4 題的選項' })).getByRole('button', { name: /^\(D\) endure/ }));
    first.unmount();
    clearDataCache();
    resetPracticeHistoryForTests();

    await renderAt('/practice/word-bank/advanced');
    expect(await screen.findByRole('button', { name: /^第 4 題空格，已填 \(D\)/ })).toBeInTheDocument();
    expect(screen.getByText('已接續上次在這一格做的題組。')).toBeInTheDocument();
    expect(storedHistory().current).toEqual({ 'word_bank/advanced': 'ai.wb.0a1b2c@1' });
  });
});

describe('詞彙題（/practice/vocabulary/basic）', () => {
  it('卡片內逐層看提示；交卷後解析卡說明你選的為什麼錯，正解字收進單字錯題本', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/vocabulary/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '詞彙題・穩定基礎' })).toBeInTheDocument();
    expect(screen.getByText(AI_ITEMS_NOTICE)).toBeInTheDocument();
    const q1 = document.getElementById('q-1');
    if (!q1) throw new Error('找不到第 1 題');
    await user.click(within(q1).getByRole('button', { name: '看第 1 層提示' }));
    expect(within(q1).getByText('空格要一個形容詞，描述 Tom 的感覺。')).toBeInTheDocument();
    await user.click(within(q1).getByRole('radio', { name: /\(B\) honest/ }));
    const q2 = document.getElementById('q-2');
    if (!q2) throw new Error('找不到第 2 題');
    await user.click(within(q2).getByRole('radio', { name: /\(C\) quiet/ }));
    // 第 4、5 題答錯：正解是變化形 postponed、ingredients。
    const q4 = document.getElementById('q-4');
    const q5 = document.getElementById('q-5');
    if (!q4 || !q5) throw new Error('找不到第 4、5 題');
    await user.click(within(q4).getByRole('radio', { name: /\(B\) celebrated/ }));
    await user.click(within(q5).getByRole('radio', { name: /\(A\) customers/ }));

    const result = await submit(user);
    const panel = result.closest('section');
    if (!panel) throw new Error('找不到交卷結果');
    expect(panel).toHaveTextContent('1／5 題');
    // 正解字對到單字索引後收進錯題本（非同步：等索引下載）；變化形對到原形，畫面附上題目裡的字。
    expect(await within(panel).findByText('thirsty、postpone（postponed）')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: '單字錯題本' })).toHaveAttribute('href', '/words?tab=mistakes');
    // 對不到條目的字（測試用的小索引沒有 ingredient）不會默默丟掉，畫面上列出來。
    expect(panel).toHaveTextContent('這些正解字不在單字表裡（或是不規則變化），沒能收進單字錯題本：ingredients');
    const book = JSON.parse(window.localStorage.getItem(MISTAKES_STORAGE_KEY) ?? '{}') as { items: Record<string, { word: string; last_source?: string }> };
    expect(book.items['thirsty|adj.|2']).toMatchObject({ word: 'thirsty', last_source: 'bank_practice' });
    expect(book.items['postpone|v./(n.)|3']).toMatchObject({ word: 'postpone', last_source: 'bank_practice' });
    expect(Object.keys(book.items).sort()).toEqual(['postpone|v./(n.)|3', 'thirsty|adj.|2']);
    // 詞彙題沒有選文：不說「選文裡加底線」。
    expect(panel).toHaveTextContent('證據句列在每一題的解析卡裡。');
    expect(panel).not.toHaveTextContent('選文裡加底線');

    const card1 = within(q1).getByRole('region', { name: /第 1 題解析/ });
    expect(card1).toHaveTextContent('你選的 (B) honest：honest「誠實的」，和喝水沒有關係。');
    expect(card1).toHaveTextContent('polite「有禮貌的」');
    expect(card1).toHaveTextContent('找出空格前後的因果關係');
    expect(card1).toHaveTextContent('drank three bottles of water');
    // 詞彙題的證據在題幹，不是選文：只引用、沒有「在文中標出」。
    expect(within(card1).queryByRole('button', { name: '在文中標出證據句' })).not.toBeInTheDocument();
    // AI 題沒有大考中心統計，不顯示那段給歷屆題的說明。
    expect(screen.queryByText(/沒有大考中心公布的答對率統計/)).not.toBeInTheDocument();
  });
});

describe('其他題型與邊界情況', () => {
  it('篇章結構：交卷後有排除法表與每題解析', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/structure/top');
    expect(await screen.findByRole('heading', { level: 1, name: '篇章結構・超越頂標' })).toBeInTheDocument();
    await submit(user);
    expect(screen.getByRole('heading', { level: 2, name: '排除法表' })).toBeInTheDocument();
    expect(screen.getByText(/多出來的那一句 \(C\) 在每一格都放不進去。/)).toBeInTheDocument();
    expect(screen.getByText('4 格裡有 3 格只有正解放得進去；其他 1 格要先刪去法再比語意。')).toBeInTheDocument();
    expect(screen.getAllByTestId('explanation-card')).toHaveLength(4);
  });

  it('綜合測驗：題目卡片裡有提示，交卷後有解析與全文中譯', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/cloze/advanced');
    expect(await screen.findByRole('heading', { level: 1, name: '綜合測驗・進階練習' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '看第 1 層提示' })).toHaveLength(3);
    await submit(user);
    expect(screen.getAllByTestId('explanation-card')).toHaveLength(3);
    expect(screen.getByText('全文中譯')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '排除法表' })).not.toBeInTheDocument();
  });

  it('沒有題組的格子：顯示出題中，並列出同題型其他有題組的難度', async () => {
    await renderAt('/practice/word-bank/top');
    expect(await screen.findByRole('heading', { level: 1, name: '文意選填・超越頂標' })).toBeInTheDocument();
    expect(screen.getByText('出題中')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '進階練習（1 組，已做 0）' })).toHaveAttribute('href', '/practice/word-bank/advanced');
  });

  it('網址的題型或難度不對：找不到這個練習（不發請求）', async () => {
    await renderAt('/practice/reading/basic');
    expect(screen.getByRole('heading', { level: 1, name: '找不到這個練習' })).toBeInTheDocument();
    await renderAt('/practice/word-bank/expert');
    expect(screen.getAllByRole('heading', { level: 1, name: '找不到這個練習' })).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/bank/groups/'), expect.anything());
  });
});
