/**
 * 首頁：學習進度從這台裝置的瀏覽器紀錄算（沒有紀錄、有紀錄、localStorage 不能用三種情況），
 * 以及模組卡片的「開發中」標記只掛在還沒完成的模組上。
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGES, isDevPage } from '../modules';
import { PRACTICE_HISTORY_KEY, resetPracticeHistoryForTests } from '../features/practice/history';
import { MISTAKES_STORAGE_KEY, MISTAKES_SCHEMA, MISTAKES_VERSION } from '../features/vocab/lib/mistakes';
import { SRS_SCHEMA, SRS_STORAGE_KEY, SRS_VERSION, dayKey } from '../features/vocab/lib/srs';
import { resetVocabStoresForTests } from '../features/vocab/state';
import HomePage from './HomePage';

const DAY = 86_400_000;

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

async function progressRegion() {
  const region = screen.getByRole('region', { name: '學習進度' });
  // 內容按需載入：等載入中的提示消失。
  await within(region).findByText(/今日待複習單字|還沒有紀錄/, {}, { timeout: 5000 });
  return region;
}

function reviewCard(due: number) {
  return {
    due,
    stability: 3,
    difficulty: 5,
    elapsed_days: 3,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: due - 3 * DAY,
    added_at: due - 10 * DAY,
    updated_at: due - 3 * DAY,
  };
}

function storeRecords() {
  const now = Date.now();
  localStorage.setItem(
    SRS_STORAGE_KEY,
    JSON.stringify({
      schema: SRS_SCHEMA,
      version: SRS_VERSION,
      settings: { daily_new: 10, levels: [3, 4, 5] },
      cards: {
        'apple|n.|3': reviewCard(now - 2 * DAY),
        'bridge|n.|3': reviewCard(now - DAY),
        'candle|n.|4': reviewCard(now + 5 * DAY),
      },
      today: { day: dayKey(now), new_count: 0, review_count: 0 },
      streak: { current: 2, longest: 2, last_day: dayKey(now - DAY) },
      updated_at: now,
    }),
  );
  localStorage.setItem(
    PRACTICE_HISTORY_KEY,
    JSON.stringify({
      v: 1,
      done: {
        'ai.vo.aaa': { version: 1, section: 'vocabulary', tier: 'basic', at: '2026-10-08T02:00:00.000Z', correct: 8, total: 10, hinted: 0 },
        'ai.wb.bbb': { version: 1, section: 'word_bank', tier: 'advanced', at: '2026-10-09T02:00:00.000Z', correct: 4, total: 10, hinted: 2 },
      },
      current: {},
      hints: {},
    }),
  );
  localStorage.setItem(
    MISTAKES_STORAGE_KEY,
    JSON.stringify({
      schema: MISTAKES_SCHEMA,
      version: MISTAKES_VERSION,
      items: { 'desert|n.|5': { entry_id: 'desert|n.|5', word: 'desert', wrong_count: 1, last_wrong_at: now, last_mode: 'cloze', last_source: 'bank_practice' } },
      updated_at: now,
    }),
  );
}

beforeEach(() => {
  // BackendStatus 會打 /api/health；這裡不關心結果，給一個永遠不回應的 fetch。
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  resetVocabStoresForTests();
  resetPracticeHistoryForTests();
});

describe('首頁學習進度', () => {
  it('沒有任何紀錄：顯示從哪裡開始的提示，不是一排 0，也沒有「開發中」', async () => {
    renderHome();
    const region = await progressRegion();
    expect(within(region).getByText('還沒有紀錄，從單字或題庫練習開始吧')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: '開始每日學習' })).toHaveAttribute('href', '/words?tab=study');
    expect(within(region).getByRole('link', { name: '題庫練習' })).toHaveAttribute('href', '/practice');
    expect(within(region).queryByText('開發中')).not.toBeInTheDocument();
    expect(within(region).queryByTestId('progress-stat')).not.toBeInTheDocument();
  });

  it('有紀錄：待複習單字、做完的題組與答對率、錯題本字數，各自連到對應的頁面', async () => {
    storeRecords();
    renderHome();
    const region = await progressRegion();
    const tiles = within(region).getAllByTestId('progress-stat');
    expect(tiles).toHaveLength(3);
    const [vocab, practice, mistakes] = tiles;
    if (!vocab || !practice || !mistakes) throw new Error('少了統計格');

    expect(vocab).toHaveAttribute('href', '/words?tab=study');
    expect(vocab).toHaveTextContent('今日待複習單字');
    expect(vocab).toHaveTextContent(/^今日待複習單字2個/);
    expect(vocab).toHaveTextContent('已學過 3 個字・連續 2 天');

    expect(practice).toHaveAttribute('href', '/practice');
    expect(practice).toHaveTextContent(/^題庫練習2組已完成的題組・/);
    expect(practice).toHaveTextContent('答對率 60%（12／20 題）');

    expect(mistakes).toHaveAttribute('href', '/words?tab=mistakes');
    expect(mistakes).toHaveTextContent(/^單字錯題本1個字/);

    expect(within(region).queryByText('還沒有紀錄，從單字或題庫練習開始吧')).not.toBeInTheDocument();
    expect(within(region).queryByRole('status')).not.toBeInTheDocument();
  });

  it('localStorage 不能用（無痕模式、封鎖網站資料）：不會壞掉，說明紀錄存不了', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    renderHome();
    const region = await progressRegion();
    expect(within(region).getByRole('status')).toHaveTextContent('這個瀏覽器無法儲存學習紀錄');
    expect(within(region).getByText('還沒有紀錄，從單字或題庫練習開始吧')).toBeInTheDocument();
  });

  it('存檔壞掉（不是 JSON、格式不對）：當成沒有紀錄', async () => {
    localStorage.setItem(SRS_STORAGE_KEY, '{oops');
    localStorage.setItem(PRACTICE_HISTORY_KEY, '"nope"');
    localStorage.setItem(MISTAKES_STORAGE_KEY, JSON.stringify({ schema: 'other' }));
    renderHome();
    const region = await progressRegion();
    expect(within(region).getByText('還沒有紀錄，從單字或題庫練習開始吧')).toBeInTheDocument();
  });
});

describe('首頁模組卡片', () => {
  it('「開發中」只掛在 status 為 dev 的模組卡片上', async () => {
    renderHome();
    await progressRegion();
    for (const page of PAGES.filter((p) => p.isStudyModule)) {
      const link = screen.getAllByRole('link').find((a) => a.getAttribute('href') === page.path && a.textContent?.includes(page.summary));
      if (!link) throw new Error(`找不到 ${page.path} 的卡片`);
      if (isDevPage(page)) expect(within(link).getByText('開發中')).toBeInTheDocument();
      else expect(within(link).queryByText('開發中')).not.toBeInTheDocument();
    }
  });
});
