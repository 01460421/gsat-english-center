/**
 * 六個題型頁（詞彙題、綜合測驗、文意選填、篇章結構、閱讀測驗、混合題）：頁首下面直接是這個題型的題庫練習
 * （假的 /data/bank/* 用 build-data 的範例輸出，見 testFixtures.ts）。
 *   - 難度切換：三個難度的組數、做過幾組、出題中；目前的難度標 aria-current；選的難度在網址 ?tier=；
 *   - 網址沒指定難度：最近練過的難度，沒練過就是穩定基礎（穩定基礎還沒有題組時用第一個有題組的），並寫回網址；
 *   - 內嵌的題組：作答、交卷、解析、再一組；題組標題是 <h2>，頁面的 <h1> 與分頁標題維持題型名稱；
 *     說明用難度名稱（不說「這一格」）、結果面板沒有「回到題庫練習」、第一次作答才開始計時；題組載入失敗可以就地再試；
 *   - 切換難度不會弄丟做到一半的作答，和 /practice/:section/:tier 共用同一份練習紀錄；
 *   - 學測怎麼考在練習區下面；「題庫練習有什麼」收合，只列出該題型真的有的功能
 *     （排除法表只有選項庫題型、錯題本只有詞彙題、圖表與誘答類型只有閱讀、自動判分只有混合題）。
 */
import { act, render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankIndex, PracticeSectionType, Tier } from '../../data/bank';
import { clearDataCache } from '../../data/client';
import { attemptStorageKey } from '../exams/attempt';
import ClozePage from '../../pages/ClozePage';
import MixedPage from '../../pages/MixedPage';
import ReadingPage from '../../pages/ReadingPage';
import StructurePage from '../../pages/StructurePage';
import VocabularyPage from '../../pages/VocabularyPage';
import WordBankPage from '../../pages/WordBankPage';
import { jsonResponse } from '../exams/testFixtures';
import { resetVocabStoresForTests } from '../vocab/state';
import { PRACTICE_HISTORY_KEY, resetPracticeHistoryForTests } from './history';
import { AI_GROUP_LABEL, TIER_AUDIENCE, TIER_LABELS, TIERS } from './labels';
import PracticeSessionPage from './PracticeSessionPage';
import { BANK_INDEX, GROUPS, MINI_VOCAB_INDEX } from './testFixtures';

/** 題型、頁面、標題、網址，以及範例題庫裡這個題型唯一有題組的難度。 */
const CASES: [PracticeSectionType, ComponentType, string, string, Tier][] = [
  ['vocabulary', VocabularyPage, '詞彙題', '/vocabulary', 'basic'],
  ['cloze', ClozePage, '綜合測驗', '/cloze', 'advanced'],
  ['word_bank', WordBankPage, '文意選填', '/word-bank', 'advanced'],
  ['structure', StructurePage, '篇章結構', '/structure', 'top'],
  ['reading', ReadingPage, '閱讀測驗', '/reading', 'basic'],
  ['mixed', MixedPage, '混合題', '/mixed', 'basic'],
];

let bankIndex: BankIndex = BANK_INDEX;
let indexStatus = 200;

beforeEach(() => {
  bankIndex = BANK_INDEX;
  indexStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/data/bank/index.json')) return indexStatus === 200 ? jsonResponse(bankIndex) : new Response('x', { status: indexStatus });
      const m = /\/data\/bank\/groups\/(.+)\.json$/.exec(url);
      if (m?.[1] && GROUPS[m[1]]) return jsonResponse(GROUPS[m[1]]);
      if (url.endsWith('/data/vocab/index.json')) return jsonResponse(MINI_VOCAB_INDEX);
      return new Response('not found', { status: 404 });
    }),
  );
  resetPracticeHistoryForTests();
  resetVocabStoresForTests();
});

afterEach(() => {
  clearDataCache();
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

async function renderAt(path: string): Promise<RenderResult> {
  let result: RenderResult | undefined;
  // 練習程式按需載入（lazy）、題庫索引與題組用 use() 等待：在 await 的 act 裡 render，React 才會處理等到的 Promise。
  await act(async () => {
    result = render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {CASES.map(([section, Page, , pagePath]) => (
            <Route key={section} path={pagePath} element={<Page />} />
          ))}
          <Route path="/practice/:section/:tier" element={<PracticeSessionPage />} />
          <Route path="*" element={<p>其他頁面</p>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  if (!result) throw new Error('render 沒有完成');
  return result;
}

const location = () => screen.getByTestId('location').textContent;

function tierNav(title: string) {
  return screen.getByRole('navigation', { name: `${title}的難度` });
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '交卷' }));
  await user.click(screen.getByRole('button', { name: '確定交卷' }));
  return screen.findByRole('heading', { level: 2, name: '交卷結果' });
}

describe.each(CASES)('%s 題型頁', (section, _Page, title, path, fixtureTier) => {
  it('頁首下面就是練習：難度切換（組數、出題中、目前的難度）與抽到的題組；網址寫回預設的難度', async () => {
    await renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    const heading = await screen.findByRole('heading', { level: 2, name: `${title}・${TIER_LABELS[fixtureTier]}` });
    // 只有一個 <h1>（題組標題是 <h2>），分頁標題也維持題型名稱。
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(Array.from(document.querySelectorAll('title')).map((t) => t.textContent)).toEqual([`${title}｜學測英文中心`]);

    // 範例題庫每個題型只有一個難度有題組：穩定基礎沒有時預設用那一個。
    expect(location()).toBe(`${path}?tier=${fixtureTier}`);
    const nav = tierNav(title);
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(TIERS.map((t) => `${path}?tier=${t}`));
    for (const t of TIERS) {
      const link = within(nav).getByRole('link', { name: t === fixtureTier ? `${TIER_LABELS[t]}：1 組，已做 0 組` : `${TIER_LABELS[t]}：出題中` });
      if (t === fixtureTier) expect(link).toHaveAttribute('aria-current', 'page');
      else expect(link).not.toHaveAttribute('aria-current');
    }
    expect(nav).toHaveTextContent(`適合${TIER_AUDIENCE[fixtureTier].who}`);

    // 題組就在頁面上：AI 標示、交卷按鈕。
    const region = screen.getByRole('region', { name: `${title}題庫練習` });
    expect(within(region).getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: '交卷' })).toBeInTheDocument();
    expect(region).toContainElement(heading);
    // 全部題型與歷屆試題各一個連結。
    expect(within(region).getByRole('link', { name: '題庫練習' })).toHaveAttribute('href', '/practice');
    expect(within(region).getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '/exams');
    expect(storedHistory().current).toEqual({ [`${section}/${fixtureTier}`]: expect.stringMatching(/^ai\./) as unknown });
  });

  it('沒有「開發中」；學測怎麼考與收合的「題庫練習有什麼」在練習區下面', async () => {
    await renderAt(path);
    await screen.findByRole('heading', { level: 2, name: `${title}・${TIER_LABELS[fixtureTier]}` });
    expect(screen.queryByText('開發中')).not.toBeInTheDocument();
    expect(screen.queryByText(/這個模組還在開發中/)).not.toBeInTheDocument();
    expect(screen.queryByText(/規劃/)).not.toBeInTheDocument();
    expect(screen.queryByText(/即將/)).not.toBeInTheDocument();
    const region = screen.getByRole('region', { name: `${title}題庫練習` });
    const exam = screen.getByRole('region', { name: '學測怎麼考' });
    const offers = screen.getByRole('list', { name: '題庫練習有什麼' });
    const details = offers.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    // 文件順序：練習區 → 學測怎麼考 → 題庫練習有什麼。
    expect(region.compareDocumentPosition(exam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(exam.compareDocumentPosition(details as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('「題庫練習有什麼」只列出這個題型真的有的功能', async () => {
    await renderAt(path);
    const offers = screen.getByRole('list', { name: '題庫練習有什麼' });
    expect(offers).toHaveTextContent(AI_GROUP_LABEL);
    expect(offers).toHaveTextContent('逐層打開提示');
    expect(offers).toHaveTextContent('四段式解析');
    expect(offers).toHaveTextContent('全文中譯');

    const bank = section === 'word_bank' || section === 'structure';
    if (bank) expect(offers).toHaveTextContent('排除法表');
    else expect(offers).not.toHaveTextContent('排除法表');

    const mistakesLink = within(offers).queryByRole('link', { name: '單字錯題本' });
    if (section === 'vocabulary') {
      expect(mistakesLink).toHaveAttribute('href', '/words?tab=mistakes');
      expect(offers).not.toHaveTextContent('選文');
    } else {
      expect(mistakesLink).not.toBeInTheDocument();
    }

    // 參考資料：閱讀每組都有，混合題只有參考事實資料寫成的才有，其他題型沒有。
    if (section === 'reading' || section === 'mixed') expect(offers).toHaveTextContent('參考資料');
    else expect(offers).not.toHaveTextContent('參考資料');
    if (section === 'mixed') expect(offers).toHaveTextContent('部分題組參考事實資料撰寫');

    // 圖表、表格、誘答類型只有閱讀。
    if (section === 'reading') {
      expect(offers).toHaveTextContent('長條圖、折線圖');
      expect(offers).toHaveTextContent('表格');
      expect(offers).toHaveTextContent('多文本');
      expect(offers).toHaveTextContent('誘答類型');
      // 只有圖上加粗框；表格與資料表是那一列加底色、標「解析引用」。
      expect(offers).toHaveTextContent('圖表裡引用到的資料點會加粗框');
      expect(offers).toHaveTextContent('加底色並標「解析引用」');
    } else {
      expect(offers).not.toHaveTextContent('長條圖');
      expect(offers).not.toHaveTextContent('誘答類型');
    }

    // 混合題：填充、多選、簡答，交卷後依規則自動判分（不是 AI 批改）。
    if (section === 'mixed') {
      expect(offers).toHaveTextContent('填充（摘要填空）、多選與簡答');
      expect(offers).toHaveTextContent('(n − 2k)/n');
      expect(offers).toHaveTextContent('不是 AI 批改');
      expect(offers).toHaveTextContent('部分分數');
    } else {
      expect(offers).not.toHaveTextContent('自動計分');
    }
    await screen.findByRole('heading', { level: 2, name: `${title}・${TIER_LABELS[fixtureTier]}` });
  });
});

function storedHistory(): { done: Record<string, { correct: number; total: number; tier: string }>; current: Record<string, string> } {
  return JSON.parse(window.localStorage.getItem(PRACTICE_HISTORY_KEY) ?? '{}') as never;
}

describe('文意選填頁（/word-bank）的練習', () => {
  it('?tier=advanced：作答、交卷、解析、再一組；難度切換的「已做」跟著更新', async () => {
    const user = userEvent.setup();
    await renderAt('/word-bank?tier=advanced');
    await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' });
    await user.click(screen.getByRole('button', { name: '第 1 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 1 題的選項' })).getByRole('button', { name: /^\(E\) colorful/ }));

    const result = await submit(user);
    const panel = result.closest('section') as HTMLElement;
    expect(panel).toHaveTextContent('1／10 題');
    // 題型頁沒有「題型 × 難度」的表格，說明用難度名稱，不說「這一格」（綜合測驗、文意選填、篇章結構的「格」是空格）。
    expect(panel).toHaveTextContent('進階練習目前只有這一組；「再一組」會讓你重做一次');
    // 學生不是從題庫練習進來的：結果面板不放「回到題庫練習」，練習區下面那一行連結就夠了。
    expect(within(panel).queryByRole('link', { name: '回到題庫練習' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '文意選填題庫練習' })).getAllByRole('link', { name: /題庫練習/ })).toHaveLength(1);
    expect(screen.getAllByTestId('explanation-card')).toHaveLength(10);
    expect(screen.getByRole('heading', { level: 2, name: '排除法表' })).toBeInTheDocument();
    expect(within(tierNav('文意選填')).getByRole('link', { name: '進階練習：1 組，已做 1 組' })).toHaveAttribute('aria-current', 'page');
    expect(storedHistory().done['ai.wb.0a1b2c']).toMatchObject({ correct: 1, total: 10, tier: 'advanced' });
    // 交卷後仍然只有題型頁的分頁標題。
    expect(Array.from(document.querySelectorAll('title')).map((t) => t.textContent)).toEqual(['文意選填｜學測英文中心']);

    await user.click(screen.getAllByRole('button', { name: '再一組' })[0] as HTMLElement);
    expect(await screen.findByRole('button', { name: '第 1 題空格，未作答' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '交卷結果' })).not.toBeInTheDocument();
    expect(screen.getByText('進階練習的 1 組你都做過了，這是比較早做的一組，再練一次。')).toBeInTheDocument();
    expect(screen.queryByText(/這一格/)).not.toBeInTheDocument();
    expect(location()).toBe('/word-bank?tier=advanced');
  });

  it('切換難度不會弄丟做到一半的作答；/practice/word-bank/advanced 接著做同一組', async () => {
    const user = userEvent.setup();
    const first = await renderAt('/word-bank?tier=advanced');
    await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' });
    await user.click(screen.getByRole('button', { name: '第 4 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 4 題的選項' })).getByRole('button', { name: /^\(D\) endure/ }));

    // 切到還沒有題組的超越頂標：作答區說明出題中，難度切換照常。
    await user.click(within(tierNav('文意選填')).getByRole('link', { name: '超越頂標：出題中' }));
    expect(location()).toBe('/word-bank?tier=top');
    expect(await screen.findByText('出題中', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/^這個難度的 AI 題組還在出題與驗證中/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '文意選填・超越頂標' })).toBeInTheDocument();
    expect(screen.getByText('進階練習已經有題組，可以在上方切換難度先練。')).toBeInTheDocument();
    expect(within(tierNav('文意選填')).getByRole('link', { name: '超越頂標：出題中' })).toHaveAttribute('aria-current', 'page');

    // 切回進階練習：同一組、答案還在（說明用難度名稱）。
    await user.click(within(tierNav('文意選填')).getByRole('link', { name: /^進階練習/ }));
    expect(await screen.findByRole('button', { name: /^第 4 題空格，已填 \(D\)/ })).toBeInTheDocument();
    expect(screen.getByText('已接續上次在進階練習做的題組。')).toBeInTheDocument();

    // 從題庫練習的作答頁進去：接著做同一組（同一份練習紀錄與作答紀錄）。
    first.unmount();
    clearDataCache();
    resetPracticeHistoryForTests();
    await renderAt('/practice/word-bank/advanced');
    expect(await screen.findByRole('heading', { level: 1, name: '文意選填・進階練習' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^第 4 題空格，已填 \(D\)/ })).toBeInTheDocument();
    expect(screen.getByText('已接續上次在這一格做的題組。')).toBeInTheDocument();
  });

  it('網址沒有難度：選這個題型最近練過的難度並寫回網址（那一格沒有題組就顯示出題中）', async () => {
    window.localStorage.setItem(
      PRACTICE_HISTORY_KEY,
      JSON.stringify({
        v: 1,
        done: {
          'ai.wb.0a1b2c': { version: 1, section: 'word_bank', tier: 'advanced', at: '2026-10-01T00:00:00.000Z', correct: 8, total: 10, hinted: 0 },
          'ai.wb.999999': { version: 1, section: 'word_bank', tier: 'top', at: '2026-10-05T00:00:00.000Z', correct: 6, total: 10, hinted: 0 },
          'ai.cz.999999': { version: 1, section: 'cloze', tier: 'basic', at: '2026-10-08T00:00:00.000Z', correct: 3, total: 5, hinted: 0 },
        },
        current: {},
        hints: {},
      }),
    );
    await renderAt('/word-bank');
    expect(await screen.findByRole('heading', { level: 2, name: '文意選填・超越頂標' })).toBeInTheDocument();
    expect(location()).toBe('/word-bank?tier=top');
    const nav = tierNav('文意選填');
    expect(within(nav).getByRole('link', { name: '超越頂標：出題中' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '進階練習：1 組，已做 1 組' })).not.toHaveAttribute('aria-current');
  });

  it('?tier= 寫錯：當成沒指定，用預設的難度', async () => {
    await renderAt('/word-bank?tier=expert');
    expect(await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' })).toBeInTheDocument();
    expect(location()).toBe('/word-bank?tier=advanced');
  });

  it('題庫索引載入失敗：練習區顯示錯誤與「再試一次」，頁首與考試說明照常', async () => {
    indexStatus = 500;
    // 錯誤邊界接住資料錯誤時 React 會在 console 印一次，這是預期中的，不要讓它洗版。
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderAt('/word-bank');
    const region = screen.getByRole('region', { name: '文意選填題庫練習' });
    expect(await within(region).findByRole('alert')).toHaveTextContent('資料載入失敗');
    expect(screen.getByRole('heading', { level: 1, name: '文意選填' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '學測怎麼考' })).toBeInTheDocument();
    indexStatus = 200;
    await act(async () => {
      within(region).getByRole('button', { name: '再試一次' }).click();
    });
    expect(await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' })).toBeInTheDocument();
  });

  it('題組載入失敗：作答區顯示錯誤，「再試一次」重新下載那一組（網址、難度不變）', async () => {
    const fetchMock = vi.mocked(fetch);
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    let groupStatus = 500;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return url.includes('/bank/groups/ai.wb.') && groupStatus !== 200 ? new Response('x', { status: groupStatus }) : base(url);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderAt('/word-bank?tier=advanced');
    const region = screen.getByRole('region', { name: '文意選填題庫練習' });
    expect(await within(region).findByRole('alert')).toHaveTextContent('資料載入失敗');
    // 只有作答區壞掉：難度切換還在。
    expect(within(tierNav('文意選填')).getByRole('link', { name: /^進階練習/ })).toHaveAttribute('aria-current', 'page');
    groupStatus = 200;
    // 重新下載時會再 suspend 一次：要在 await 的 act 裡點（理由見 renderAt）。
    await act(async () => {
      within(region).getByRole('button', { name: '再試一次' }).click();
    });
    expect(await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 1 題空格，未作答' })).toBeInTheDocument();
    expect(location()).toBe('/word-bank?tier=advanced');
  });

  it('打開頁面、沒有作答：不計時、不寫作答紀錄；第一次作答才開始計時', async () => {
    const user = userEvent.setup();
    const key = attemptStorageKey('practice:ai.wb.0a1b2c@1');
    await renderAt('/word-bank?tier=advanced');
    await screen.findByRole('heading', { level: 2, name: '文意選填・進階練習' });
    expect(screen.getByRole('timer')).toHaveAccessibleName('已用時間 0 秒，作答後開始計時');
    // 等過一次計時器的週期（1 秒）：還是 0:00，也沒有作答紀錄（只是來看說明不算練習）。
    await act(() => new Promise((resolve) => setTimeout(resolve, 1500)));
    expect(screen.getByRole('timer')).toHaveTextContent('0:00');
    expect(window.localStorage.getItem(key)).toBeNull();

    await user.click(screen.getByRole('button', { name: '第 1 題空格，未作答' }));
    await user.click(within(screen.getByRole('group', { name: '第 1 題的選項' })).getByRole('button', { name: /^\(E\) colorful/ }));
    expect(screen.getByRole('timer')).toHaveAccessibleName(/^已用時間 \d+ 秒$/);
    // 開始計時就好：負載重時計時器的週期可能晚到，跳過 0:01 直接顯示 0:02，不比對確切的秒數。
    await waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent(/^0:(0[1-9]|[1-5]\d)$/), { timeout: 3000 });
    expect((JSON.parse(window.localStorage.getItem(key) ?? '{}') as { elapsedSec?: number }).elapsedSec).toBeGreaterThanOrEqual(1);
  });

  it('題組載入失敗：只有作答區顯示錯誤，難度切換照常可以用', async () => {
    const fetchMock = vi.mocked(fetch);
    const base = fetchMock.getMockImplementation() as (url: string) => Promise<Response>;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      return url.includes('/bank/groups/ai.wb.') ? new Response('x', { status: 500 }) : base(url);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    await renderAt('/word-bank?tier=advanced');
    expect(await screen.findByRole('alert')).toHaveTextContent('資料載入失敗');
    await user.click(within(tierNav('文意選填')).getByRole('link', { name: '超越頂標：出題中' }));
    expect(await screen.findByRole('heading', { level: 2, name: '文意選填・超越頂標' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
