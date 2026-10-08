/**
 * 單字模組的整合測試：用假資料（testing/fixtures.ts）走過學生實際會做的事——
 * 查字、看單字卡、做測驗、每日學習、錯題本，以及載入失敗與 localStorage 不能用的情況。
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from '../../data/client';
import { MISTAKES_STORAGE_KEY, MISTAKES_SCHEMA } from './lib/mistakes';
import { SRS_STORAGE_KEY } from './lib/srs';
import { shortGloss } from './lib/text';
import { resetVocabDataForTests } from './lib/vocabData';
import { resetVocabStoresForTests } from './state';
import { ACHIEVE, fixtureFetch, fixtureLevels } from './testing/fixtures';
import { VocabModule } from './VocabModule';

function renderAt(path = '/words') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/words" element={<VocabModule />} />
      </Routes>
    </MemoryRouter>,
  );
}

const wordPath = (id: string, tab?: string) => `/words?${new URLSearchParams({ ...(tab ? { tab } : {}), word: id })}`;

function readJson(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(fixtureFetch()));
});

afterEach(() => {
  clearDataCache();
  resetVocabDataForTests();
  resetVocabStoresForTests();
});

describe('單字庫', () => {
  it('預設顯示 L3–5；英文前綴與中文關鍵字搜尋', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: '單字' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /^achieve/ })).toHaveAttribute('href', expect.stringContaining('word='));
    expect(screen.getByRole('link', { name: /^accomplish/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^about/ })).not.toBeInTheDocument(); // L1

    const search = screen.getByRole('searchbox', { name: '搜尋單字' });
    await user.type(search, 'acc');
    await waitFor(() => expect(screen.queryByRole('link', { name: /^achieve/ })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: /^accomplish/ })).toBeInTheDocument();
    expect(screen.getByText('共 1 筆')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '完成');
    await waitFor(() => expect(screen.getByText('共 3 筆')).toBeInTheDocument()); // achieve、accomplish、complete

    await user.click(screen.getByRole('button', { name: '清除搜尋與篩選' }));
    expect(search).toHaveValue('');
  });

  it('搜尋不到時提示其他級別還有結果，可一鍵搜尋全部級別', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('link', { name: /^achieve/ });
    await user.type(screen.getByRole('searchbox', { name: '搜尋單字' }), 'about');
    expect(await screen.findByText('沒有符合條件的單字')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '搜尋全部級別' }));
    expect(await screen.findByRole('link', { name: /^about/ })).toBeInTheDocument();
  });

  it('資料載入失敗：顯示可讀的錯誤，按「再試一次」重新載入', async () => {
    const user = userEvent.setup();
    const ok = fixtureFetch();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls += 1;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return ok(input);
      }),
    );
    renderAt();
    expect(await screen.findByText('單字表載入失敗')).toBeInTheDocument();
    expect(screen.getByText('無法連線，請檢查網路後再試一次。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '再試一次' }));
    expect(await screen.findByRole('link', { name: /^achieve/ })).toBeInTheDocument();
  });
});

describe('單字卡', () => {
  it('釋義、例句（逐句授權標示）、CEFR、歷屆出現次數、Cambridge 外連', async () => {
    renderAt(wordPath(ACHIEVE.id));
    expect(await screen.findByRole('heading', { level: 2, name: 'achieve' })).toBeInTheDocument();
    // 單字庫分頁也掛著（藏起來），文字查詢限定在單字卡裡。
    const card = within(screen.getByRole('region', { name: '單字卡' }));
    expect(card.getByText('完成, 達到')).toBeInTheDocument();
    expect(card.getByText('約 CEFR A2')).toBeInTheDocument();

    const en = screen.getByRole('link', { name: /Tatoeba #11263531 by author11263531/ });
    expect(en).toHaveAttribute('href', 'https://tatoeba.org/en/sentences/show/11263531');
    expect(en).toHaveAttribute('target', '_blank');
    expect(en.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: /中文 Tatoeba #11263532 by zhauthor11263531/ })).toHaveAttribute(
      'href',
      'https://tatoeba.org/en/sentences/show/11263532',
    );

    const cambridge = screen.getByRole('link', { name: /在 Cambridge 辭典查看/ });
    expect(cambridge).toHaveAttribute('href', ACHIEVE.cambridge_url);
    expect(cambridge).toHaveAttribute('target', '_blank');
    expect(cambridge.getAttribute('rel')).toContain('noopener');

    const stats = card.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('正解 1 次、選項 5 次、選文 24 次'));
    expect(stats).toBeInTheDocument();
    // 例句中的變化形要標出來
    expect(card.getByText('achieved', { selector: 'strong' })).toBeInTheDocument();
  });

  it('點同義詞換到該字；「返回」依序回到上一個字、再回到單字庫', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('link', { name: /^achieve/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'achieve' })).toHaveFocus();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); // 單字庫藏起來了（不在無障礙樹裡）

    await user.click(screen.getByRole('link', { name: /^accomplish/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'accomplish' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'achieve' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'achieve' })).not.toBeInTheDocument());
    expect(screen.getByRole('searchbox', { name: '搜尋單字' })).toBeInTheDocument();
    // 焦點回到原本點的那個單字連結
    expect(screen.getByRole('link', { name: /^achieve/ })).toHaveFocus();
  });

  it('直接開啟不存在的單字：顯示找不到', async () => {
    renderAt(wordPath('nothing|n.|3'));
    expect(await screen.findByText('找不到這個單字')).toBeInTheDocument();
  });

  it('加入每日學習：寫入 localStorage，按鈕變成已加入', async () => {
    const user = userEvent.setup();
    renderAt(wordPath(ACHIEVE.id));
    await user.click(await screen.findByRole('button', { name: /加入每日學習/ }));
    expect(screen.getByRole('button', { name: /已加入每日學習/ })).toHaveAttribute('aria-pressed', 'true');
    expect(readJson(SRS_STORAGE_KEY)).toMatchObject({ cards: { [ACHIEVE.id]: { state: 0 } } });
  });
});

describe('測驗', () => {
  it('英選中：作答後立即回饋，10 題後顯示成績；答錯的字進錯題本，可以再練一次錯題', async () => {
    const user = userEvent.setup();
    renderAt('/words?tab=quiz');
    await user.click(screen.getByRole('button', { name: /開始測驗/ }));
    let wrong = 0;
    for (let i = 1; i <= 10; i += 1) {
      const title = await screen.findByRole('heading', { name: new RegExp(`第 ${i} 題`) });
      expect(title).toHaveFocus();
      const options = within(screen.getByRole('list', { name: '選項' })).getAllByRole('button');
      expect(options).toHaveLength(4);
      // 第 1 題用鍵盤作答，其餘用點的
      const option = options[i % 4];
      if (!option) throw new Error('找不到選項');
      if (i === 1) await user.keyboard('2');
      else await user.click(option);
      const verdict = await screen.findByText(/^(答對了！|答錯了)$/);
      if (verdict.textContent === '答錯了') wrong += 1;
      await user.click(screen.getByRole('button', { name: i === 10 ? '看成績' : '下一題' }));
    }
    expect(await screen.findByRole('heading', { name: '測驗結果（英選中）' })).toBeInTheDocument();
    expect(screen.getByText(`${10 - wrong}`)).toBeInTheDocument();
    const book = readJson(MISTAKES_STORAGE_KEY);
    expect(Object.keys((book as { items?: object } | null)?.items ?? {})).toHaveLength(wrong);
    if (wrong > 0) {
      await user.click(screen.getByRole('button', { name: '再練一次錯題' }));
      expect(await screen.findByRole('heading', { name: new RegExp(`第 1 題\\s*／共 ${wrong} 題`) })).toBeInTheDocument();
    }
  });

  it('拼字：大小寫不分；提示首字母與字數', async () => {
    const user = userEvent.setup();
    // 從題目的中文找回答案（測試資料每個字的短釋義都不同）。
    const byGloss = new Map(Object.values(fixtureLevels()).flat().map((e) => [shortGloss(e), e.word]));
    renderAt('/words?tab=quiz');
    await user.click(screen.getByRole('radio', { name: /拼字/ }));
    await user.click(screen.getByRole('button', { name: /開始測驗/ }));
    const input = await screen.findByRole('textbox', { name: '你的答案' });
    expect(input).toHaveFocus();
    const prompt = screen.getByText('拼出這個英文單字').nextElementSibling?.textContent ?? '';
    const answer = byGloss.get(prompt);
    expect(answer).toBeDefined();
    expect(screen.getByText(new RegExp(`共 ${answer?.length} 個字母`))).toBeInTheDocument();
    await user.type(input, `${(answer ?? '').toUpperCase()}{Enter}`);
    expect(await screen.findByText('答對了！')).toBeInTheDocument();
  });
});

describe('每日學習', () => {
  it('開始 → 翻卡 → 評分：進度寫入 localStorage，連續學習 1 天', async () => {
    const user = userEvent.setup();
    renderAt('/words?tab=study');
    expect(screen.getByRole('heading', { name: '今日進度' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '開始學習（10 張）' }));
    await user.click(await screen.findByRole('button', { name: '顯示答案' }));
    const grades = screen.getByRole('group', { name: /評分/ });
    expect(within(grades).getAllByRole('button').map((b) => b.textContent?.slice(0, 2))).toEqual(['重來', '困難', '良好', '簡單']);
    await user.click(within(grades).getByRole('button', { name: /^良好/ }));
    // 新字第一次按「良好」還在短期學習步驟（10 分鐘後），會排回這一輪的最後，所以還是 10 張。
    expect(screen.getByText('還有 10 張')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '顯示答案' })).toHaveFocus();
    expect(readJson(SRS_STORAGE_KEY)).toMatchObject({ today: { new_count: 1 }, streak: { current: 1 } });

    // 鍵盤：空白鍵翻卡、3 評「良好」
    await user.keyboard(' ');
    await screen.findByRole('group', { name: /評分/ });
    await user.keyboard('3');
    expect(readJson(SRS_STORAGE_KEY)).toMatchObject({ today: { new_count: 2 } });

    await user.click(screen.getByRole('button', { name: /先停在這裡/ }));
    expect(await screen.findByText('1 天')).toBeInTheDocument();
    expect(screen.getByText('今天已學 2 個')).toBeInTheDocument();
  });

  it('localStorage 不能用：顯示提示，功能照常', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderAt('/words?tab=study');
    expect(await screen.findByText(/這個瀏覽器不允許網站儲存資料/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /開始學習/ }));
    await user.click(await screen.findByRole('button', { name: '顯示答案' }));
    await user.click(screen.getByRole('button', { name: /^良好/ }));
    expect(screen.getByRole('button', { name: '顯示答案' })).toBeInTheDocument(); // 換到下一張
  });
});

describe('錯題本', () => {
  it('空的時候顯示說明；有錯題時列出、可以移除', async () => {
    window.localStorage.setItem(
      MISTAKES_STORAGE_KEY,
      JSON.stringify({
        schema: MISTAKES_SCHEMA,
        version: 1,
        updated_at: 1,
        items: { [ACHIEVE.id]: { word: 'achieve', wrong_count: 2, last_wrong_at: Date.now(), last_mode: 'cloze' } },
      }),
    );
    const user = userEvent.setup();
    renderAt('/words?tab=mistakes');
    expect(screen.getByRole('link', { name: 'achieve' })).toBeInTheDocument();
    expect(screen.getByText(/錯 2 次/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '從錯題本移除 achieve' }));
    expect(screen.getByText('錯題本是空的')).toBeInTheDocument();
    expect(readJson(MISTAKES_STORAGE_KEY)).toMatchObject({ items: {} });
  });

  it('錯題練習答對會移出錯題本', async () => {
    window.localStorage.setItem(
      MISTAKES_STORAGE_KEY,
      JSON.stringify({
        schema: MISTAKES_SCHEMA,
        version: 1,
        updated_at: 1,
        items: { [ACHIEVE.id]: { word: 'achieve', wrong_count: 1, last_wrong_at: 1, last_mode: 'en2zh' } },
      }),
    );
    const user = userEvent.setup();
    renderAt('/words?tab=mistakes');
    await user.click(screen.getByRole('button', { name: '開始練習' }));
    await screen.findByRole('heading', { name: /第 1 題\s*／共 1 題/ });
    await user.click(screen.getByRole('button', { name: /完成, 達到/ }));
    expect(await screen.findByText('答對了！')).toBeInTheDocument();
    expect(readJson(MISTAKES_STORAGE_KEY)).toMatchObject({ items: {} });
  });
});
