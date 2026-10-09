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
import { AI_GROUP_LABEL, AI_ITEMS_NOTICE, AI_PASSAGE_NOTICE, AI_REFERENCES_NOTICE } from './labels';
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
    // 6 題型 × 3 難度，範例有 6 組，其他 12 格都是「出題中」。
    expect(screen.getAllByRole('group', { name: /：出題中$/ })).toHaveLength(12);
    expect(screen.getAllByRole('link', { name: /組，已做/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: '閱讀測驗・穩定基礎：1 組，已做 0 組' })).toHaveAttribute('href', '/practice/reading/basic');
    expect(screen.getByRole('link', { name: '混合題・穩定基礎：1 組，已做 0 組' })).toHaveAttribute('href', '/practice/mixed/basic');
    expect(screen.getByRole('group', { name: '混合題・超越頂標：出題中' })).toHaveTextContent('出題中');
  });

  it('做過的組數來自練習紀錄', async () => {
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({ v: 1, done: { 'ai.wb.0a1b2c': { version: 1, section: 'word_bank', tier: 'advanced', at: '2026-10-08T00:00:00Z', correct: 8, total: 10, hinted: 0 } }, current: {}, hints: {} }),
    );
    await renderAt('/practice');
    expect(await screen.findByRole('link', { name: '文意選填・進階練習：1 組，已做 1 組' })).toHaveTextContent('已做 1');
  });

  it('還沒有任何題組：說明出題中，18 格都是「出題中」', async () => {
    bankIndex = EMPTY_BANK_INDEX;
    await renderAt('/practice');
    expect(await screen.findByText(/AI 題庫正在出題與驗證中/)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /：出題中$/ })).toHaveLength(18);
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
    // 主題是英文短語（舊題組）：不顯示（只顯示含中文的主題）。
    expect(screen.queryByText(/history of the umbrella/)).not.toBeInTheDocument();
    expect(screen.queryByText(/主題：/)).not.toBeInTheDocument();
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

describe('閱讀測驗（圖表，/practice/reading/basic）', () => {
  it('圖表、參考資料與聲明；作答、交卷：計分、解析卡（誘答類型、圖表證據）、資料點標示', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/reading/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '閱讀測驗・穩定基礎' })).toBeInTheDocument();
    // 英文主題不顯示；SDG 用文字標示。
    expect(screen.queryByText(/falling child death rates/)).not.toBeInTheDocument();
    expect(screen.getByText(/4 題・SDG 3/)).toBeInTheDocument();

    // 圖表：SVG（role=img＋完整描述）、圖例、資料來源；交卷前沒有標出任何資料點。
    const chart = screen.getByRole('img', { name: /^折線圖：Children who die before age 5/ });
    expect(chart).toHaveAttribute('data-chart-type', 'line');
    expect(screen.getByTestId('chart-source')).toHaveTextContent('資料來源：World Bank（另開新分頁）（CC BY 4.0（授權條款，另開新分頁））');
    expect(screen.queryByText(/粗框標出的是解析引用的數據/)).not.toBeInTheDocument();

    // 參考資料與聲明。
    expect(screen.getByText(AI_REFERENCES_NOTICE)).toBeInTheDocument();
    const refs = screen.getByTestId('references');
    expect(within(refs).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      'https://data.worldbank.org/indicator/SH.DYN.MORT',
      'https://creativecommons.org/licenses/by/4.0/', // 資料集來源標授權
      'https://sdgs.un.org/goals/goal3',
      'https://sdgs.un.org/goals',
    ]);
    expect(within(refs).getByTestId('reference-license')).toHaveTextContent('（授權：CC BY 4.0（授權條款，另開新分頁））');

    await user.click(screen.getByRole('radio', { name: /How the death rate of young children has changed since 1990/ }));
    await user.click(screen.getByRole('radio', { name: /Sub-Saharan Africa\./ }));
    await user.click(screen.getByRole('radio', { name: /Its rate in 1990 was the highest in the chart\./ }));
    await user.click(screen.getByRole('radio', { name: /Possible to achieve soon\./ }));
    const result = await submit(user);
    const panel = result.closest('section') as HTMLElement;
    expect(panel).toHaveTextContent('3／4 題');
    expect(panel).toHaveTextContent('6／8 分');
    expect(panel).toHaveTextContent('圖表、表格裡用粗框或底色標出解析引用的數據');
    expect(storedHistory().done['ai.rd.0c1d2e']).toMatchObject({ correct: 3, total: 4 });

    expect(screen.getAllByTestId('explanation-card')).toHaveLength(4);
    const card3 = screen.getByRole('region', { name: /第 3 題解析/ });
    expect(card3).toHaveTextContent('你選的為什麼錯');
    expect(card3).toHaveTextContent('1990 年最高的是 Sub-Saharan Africa 的 178.5。');
    expect(card3).toHaveTextContent('誘答類型：細節錯置（拼湊原文字詞）');
    // 第 2 題的證據有一句引用圖表（標「圖表」），圖上與資料表都標出那個資料點。
    const card2 = screen.getByRole('region', { name: /第 2 題解析/ });
    expect(within(card2).getByText('圖表')).toBeInTheDocument();
    expect(screen.getByText(/粗框標出的是解析引用的數據/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^2020/ })).toHaveTextContent('（解析引用）');
  });
});

describe('混合題（/practice/mixed/basic）', () => {
  it('多文本 A／B、摘要填空、多選、簡答：自動判分、每個選項的判斷與證據、可接受答案與字形變化', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/mixed/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeInTheDocument();
    // 多文本分頁標示 A／B。
    expect(screen.getByRole('tab', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^A　Mia: Clean the Fridge Night/ })).toBeInTheDocument();
    expect(screen.getByText(AI_REFERENCES_NOTICE)).toBeInTheDocument();
    expect(within(screen.getByTestId('references')).getAllByRole('link')).toHaveLength(2);

    // 填充：兩個字時即時提示「每格只能填一個單詞」。
    const blank1 = screen.getByRole('textbox', { name: '第 1 題作答' });
    await user.type(blank1, 'turned into');
    expect(screen.getByText(/每格只能填一個單詞/)).toBeInTheDocument();
    expect(blank1).toHaveAttribute('aria-invalid', 'true');
    await user.clear(blank1);
    await user.type(blank1, 'Turned');
    expect(screen.queryByText(/每格只能填一個單詞/)).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '第 2 題作答' }), 'filling');
    await user.click(screen.getByRole('checkbox', { name: /They keep track of the food they throw away/ }));
    await user.click(screen.getByRole('checkbox', { name: /They now spend less money on food/ }));
    await user.click(screen.getByRole('checkbox', { name: /They now cook or serve smaller amounts of food/ }));
    await user.type(screen.getByRole('textbox', { name: '你的答案' }), 'weigh');

    const result = await submit(user);
    const panel = result.closest('section') as HTMLElement;
    // 1 分（字形錯）＋2＋2.67（6 選項錯 1 個）＋2。
    expect(panel).toHaveTextContent('2／4 題');
    expect(panel).toHaveTextContent('7.67／10 分');
    expect(panel).toHaveTextContent('另有 2 題部分給分');
    expect(storedHistory().done['ai.mx.0f1a2b']).toMatchObject({ correct: 2, total: 4 });

    // 多選：實際算式、每個選項的判斷（多選了 C）與證據。
    expect(screen.getByTestId('multi-select-formula')).toHaveTextContent('本題 6 個選項，你錯了 1 個 → 4 × (6 − 2 × 1) ÷ 6 ＝ 2.67 分。');
    expect(screen.getByTestId('option-verdict-C')).toHaveTextContent('不應選，你多選了');
    expect(screen.getByTestId('option-verdict-C')).toHaveTextContent('只符合其中一方');
    expect(screen.getByTestId('option-verdict-C')).toHaveTextContent('Our list is much shorter now, and we spend less money on food, too.');
    expect(screen.getByTestId('option-verdict-A')).toHaveTextContent('應選，你選了');
    expect(screen.getByTestId('option-verdict-A')).toHaveTextContent('文中明寫');
    expect(screen.getByTestId('option-verdict-B')).toHaveTextContent('不應選，你沒選');

    // 填充：部分給分的原因、可接受答案、原文依據與字形變化。
    const feedbacks = screen.getAllByTestId('question-feedback');
    const fb1 = feedbacks.find((el) => within(el).queryByText(/選字正確，但字形錯誤/));
    expect(fb1).toBeDefined();
    expect(fb1).toHaveTextContent('部分給分 1／2 分');
    expect(fb1).toHaveTextContent('同一個字要做字形變化');
    expect(within(fb1 as HTMLElement).getByTestId('accepted-answers')).toHaveTextContent('turns、makes');
    expect(within(fb1 as HTMLElement).getByTestId('transform-note')).toHaveTextContent('turn → turns');
    // 簡答答對。
    expect(screen.getAllByText('答對 +2 分').length).toBeGreaterThanOrEqual(2);
    // 4 張解析卡：多選 1 張＋填充、簡答各 1 張。
    expect(screen.getAllByTestId('explanation-card')).toHaveLength(4);
  });

  it('多文本切到單篇時按「在文中標出證據句」：自動切到有證據句的分頁（分散在兩篇就切到「全部」），並移焦點', async () => {
    const user = userEvent.setup();
    await renderAt('/practice/mixed/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeInTheDocument();
    await submit(user);
    const card = (label: string) => screen.getByRole('region', { name: new RegExp(`第 ${label} 題解析`) });
    const locate = (label: string) => user.click(within(card(label)).getByRole('button', { name: '在文中標出證據句' }));
    const tab = (name: string) => screen.getByRole('tab', { name });

    // 第 1 題的證據在 A（Mia）：在 B 按 → 切到 A。
    await user.click(tab('B'));
    expect(screen.queryByRole('region', { name: /^A　Mia/ })).not.toBeInTheDocument();
    await locate('1');
    expect(tab('A')).toHaveAttribute('aria-selected', 'true');
    const mark1 = document.querySelector<HTMLElement>('mark[data-evidence-label="1"]');
    expect(mark1).toHaveTextContent('Third, we turn food that is getting old into something new.');
    expect(mark1).toHaveFocus();

    // 第 4 題的證據在 B（Kevin）：在 A 按 → 切到 B。
    await locate('4');
    expect(tab('B')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('mark[data-evidence-label="4"]')).toHaveFocus();

    // 第 3 題（多選）的證據分散在 A、B：切到「全部」，兩篇都看得到。
    await locate('3');
    expect(tab('全部')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /^A　Mia/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^B　Kevin/ })).toBeInTheDocument();
    expect(document.querySelector('mark[data-evidence-label="3"]')).toHaveFocus();

    // 已經在「全部」：不切分頁。再切回 B，同一題再按一次也會切（請求帶計數）。
    await locate('1');
    expect(tab('全部')).toHaveAttribute('aria-selected', 'true');
    await user.click(tab('B'));
    await locate('1');
    expect(tab('A')).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('mark[data-evidence-label="1"]')).toHaveFocus();
  });

  it('交卷時單字索引還在下載：先顯示「判分中」，下載好才判分；判分固定下來，重新整理後索引下載失敗分數也不變', async () => {
    // filing 和正解 filling 只差一個字母：單字索引查得到它是真的字 → 0 分；查不到（還沒下載、下載失敗）→ 拼字錯誤 1 分。
    const index = { ...MINI_VOCAB_INDEX, entries: [...MINI_VOCAB_INDEX.entries, { id: 'filing|n.|4', word: 'filing', level: 4 as const, pos: ['n.' as const], zh: '歸檔', cefr: null, exam_total: 0, exam_answer: 0 }] };
    let release: (() => void) | undefined;
    const indexArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.endsWith('/data/vocab/index.json')) return base(url);
      await indexArrived;
      return jsonResponse(index);
    });
    const user = userEvent.setup();
    const first = await renderAt('/practice/mixed/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '第 1 題作答' }), 'turns');
    await user.type(screen.getByRole('textbox', { name: '第 2 題作答' }), 'filing');
    await user.type(screen.getByRole('textbox', { name: '你的答案' }), 'weigh');
    await submit(user);
    const grading = screen.getByTestId('grading-panel');
    expect(grading).toHaveTextContent('判分中');
    expect(screen.queryByText(/／10 分/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '交卷結果' })).toHaveFocus();

    await act(async () => {
      release?.();
      await indexArrived;
    });
    expect(await screen.findByText('4／10 分')).toBeInTheDocument();
    expect(screen.queryByTestId('grading-panel')).not.toBeInTheDocument();
    // 判分完換成正式的結果面板，焦點跟著移到新的「交卷結果」標題（不會掉到 body）。
    expect(screen.getByRole('heading', { level: 2, name: '交卷結果' })).toHaveFocus();
    const fb2 = screen.getAllByTestId('question-feedback').find((el) => within(el).queryByText('filing'));
    expect(fb2).toHaveTextContent('和可接受答案都不同，也不是同一個字的其他字形，0 分。');
    const stored = JSON.parse(window.localStorage.getItem(PRACTICE_HISTORY_KEY) ?? '{}') as { graded?: Record<string, { open: Record<string, { status: string }> }> };
    expect(stored.graded?.['ai.mx.0f1a2b@1']?.open['2']?.status).toBe('wrong');

    // 重新整理，這次單字索引下載失敗：沿用固定下來的判分（不會變成拼字錯誤 1 分、5／10 分）。
    first.unmount();
    clearDataCache();
    resetPracticeHistoryForTests();
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/data/vocab/index.json') ? new Response('x', { status: 500 }) : base(url)));
    await renderAt('/practice/mixed/basic');
    expect(await screen.findByText('4／10 分')).toBeInTheDocument();
    expect(screen.queryByTestId('grading-panel')).not.toBeInTheDocument();
  });

  it('單字索引下載失敗、還沒有固定的判分：不會一直停在「判分中」，改用題組裡的字判分', async () => {
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/data/vocab/index.json') ? new Response('x', { status: 500 }) : base(url)));
    const user = userEvent.setup();
    await renderAt('/practice/mixed/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: '第 2 題作答' }), 'filing');
    await submit(user);
    // filing 不在題組裡、也查不到索引：拼字錯誤 1 分。
    expect(await screen.findByText('1／10 分')).toBeInTheDocument();
    expect(screen.queryByTestId('grading-panel')).not.toBeInTheDocument();
  });

  it('只用常識寫的原創文章（沒有參考資料）：標一般的 AI 聲明、不列參考資料；中文主題照常顯示', async () => {
    const mx = GROUPS['ai.mx.0f1a2b@1'];
    if (!mx) throw new Error('缺少混合題範例');
    const plain = {
      ...mx,
      group: { ...mx.group, tags: { ...mx.group.tags, topic: '清冰箱與減少剩食' } },
      provenance: { ...mx.provenance, derivation: 'original' as const, attribution_text: '本文由 AI 撰寫', references: [] },
    };
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/bank/groups/ai.mx.0f1a2b@1.json') ? jsonResponse(plain) : base(url)));
    await renderAt('/practice/mixed/basic');
    expect(await screen.findByRole('heading', { level: 1, name: '混合題・穩定基礎' })).toBeInTheDocument();
    expect(screen.getByText(/主題：清冰箱與減少剩食・4 題/)).toBeInTheDocument();
    expect(screen.getByText(AI_PASSAGE_NOTICE)).toBeInTheDocument();
    expect(screen.queryByText(AI_REFERENCES_NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('references')).not.toBeInTheDocument();
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
    await renderAt('/practice/translation/basic');
    expect(screen.getByRole('heading', { level: 1, name: '找不到這個練習' })).toBeInTheDocument();
    await renderAt('/practice/word-bank/expert');
    expect(screen.getAllByRole('heading', { level: 1, name: '找不到這個練習' })).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/bank/groups/'), expect.anything());
  });
});
