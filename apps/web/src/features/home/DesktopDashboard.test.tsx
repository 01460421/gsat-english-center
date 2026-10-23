/**
 * 首頁的桌機儀表板（docs/design/desktop-ui.md §5.1）：main ≥ ws（58.5rem）才換樹；繼續學習、全部功能（連結名稱和卡片相同）、
 * 右欄的學習進度（region 名稱與 data-testid 不變）、登入後的問候、AI 點數與最近的寫作紀錄、後端狀態的文字不變。
 */
import type { SubmissionSummary } from '@gsat/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_NAME, PAGES, isPageEnabled } from '../../modules';
import HomePage from '../../pages/HomePage';
import { setDesktopViewport } from '../../test/viewport';
import { attemptStorageKey, createAttempt } from '../exams/attempt';
import { resetPracticeHistoryForTests } from '../practice/history';
import { resetVocabStoresForTests } from '../vocab/state';
import { FEATURES_OFF, FEATURES_ON, baseRoutes, essaySubmission, jsonResponse, meWith, translationSubmission } from '../writing/testing/fixtures';
import { renderPage } from '../writing/testing/render';

beforeEach(() => {
  resetVocabStoresForTests();
  resetPracticeHistoryForTests();
});

function summary(detail: ReturnType<typeof translationSubmission>, updated_at: number): SubmissionSummary {
  const { id, kind, group_id, input_mode, status, final_score, final_band, created_at, graded_at } = detail;
  return { id, kind, group_id, input_mode, status, final_score, final_band, created_at, updated_at, graded_at, custom_title: null };
}

describe('首頁儀表板', () => {
  it('手機與不到 ws 寬度：原本的首頁，不載入儀表板', async () => {
    setDesktopViewport(1024, 768);
    renderPage('/', baseRoutes(FEATURES_OFF), { '/': <HomePage /> });
    await screen.findByRole('region', { name: '學習進度' });
    expect(screen.queryByRole('heading', { name: '全部功能' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '我的學習' })).not.toBeInTheDocument();
  });

  it('ws 寬度、沒登入：繼續學習、全部功能、右欄的學習進度與後端狀態；問候不帶暫稱、沒有 AI 區塊', async () => {
    setDesktopViewport();
    const attempt = { ...createAttempt('gsat-115', 'practice', null), answers: { '1': 'B' } };
    localStorage.setItem(attemptStorageKey('gsat-115'), JSON.stringify(attempt));
    renderPage('/', baseRoutes(FEATURES_OFF), { '/': <HomePage /> });
    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
    await screen.findByRole('heading', { name: '全部功能' }, { timeout: 5000 });

    const resume = screen.getByRole('region', { name: '繼續學習' });
    expect(within(resume).getByRole('link', { name: /115 學測/ })).toHaveAttribute('href', '/exams/gsat-115');
    expect(within(resume).getByRole('link', { name: /115 學測/ })).toHaveTextContent('練習模式・已答 1 題');

    const all = screen.getByRole('region', { name: '全部功能' });
    // 學習助手的開關關著：「全部功能」不列它（docs/design/learning-assistant.md §5.1）。
    expect(within(all).queryByRole('link', { name: /^學習助手/ })).not.toBeInTheDocument();
    for (const page of PAGES.filter((p) => p.isStudyModule && isPageEnabled(p, { assistant: false }))) {
      const link = within(all).getByRole('link', { name: new RegExp(`^${page.title}`) });
      expect(link).toHaveAttribute('href', page.path);
      // 可存取名稱和手機的卡片一樣含完整說明（畫面上只顯示一行，全文也放在 title）。
      expect(link).toHaveTextContent(page.summary);
      expect(link).toHaveAttribute('title', page.summary);
    }

    const rail = screen.getByRole('complementary', { name: '我的學習' });
    const progress = within(rail).getByRole('region', { name: '學習進度' });
    expect(await within(progress).findByText('還沒有紀錄，從單字或題庫練習開始吧')).toBeInTheDocument();
    expect(await within(rail).findByText('後端未連線')).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '重新檢查' })).toBeInTheDocument();
    // 問候那一行一律在（/api/me 回來之後換字，不多出一行把儀表板往下推）；沒登入時沒有暱稱。
    expect(screen.getByText('今天練什麼？')).toBeInTheDocument();
    expect(within(rail).queryByRole('region', { name: 'AI 點數' })).not.toBeInTheDocument();
  });

  it('沒有做到一半的東西：不顯示「繼續學習」', async () => {
    setDesktopViewport();
    renderPage('/', baseRoutes(FEATURES_OFF), { '/': <HomePage /> });
    await screen.findByRole('heading', { name: '全部功能' }, { timeout: 5000 });
    expect(screen.queryByRole('region', { name: '繼續學習' })).not.toBeInTheDocument();
  });

  it('已登入且 AI 已核准：問候、AI 點數量表、最近 3 筆寫作紀錄（中譯英與作文合併，新到舊）', async () => {
    setDesktopViewport();
    renderPage(
      '/',
      {
        ...baseRoutes(FEATURES_ON, meWith()),
        'GET /api/submissions?kind=translation': () =>
          jsonResponse({ submissions: [summary(translationSubmission({ id: 't-1' }), 100), summary(translationSubmission({ id: 't-2' }), 400)], next_cursor: null }),
        'GET /api/submissions?kind=essay': () =>
          jsonResponse({ submissions: [summary(essaySubmission({ id: 'e-1' }), 300), summary(essaySubmission({ id: 'e-2' }), 200)], next_cursor: null }),
      },
      { '/': <HomePage /> },
    );
    // /api/me 還沒回來（SessionProvider 一開始是 loading）：問候那一行已經在；回來之後是同一個元素換字，不是多插一行。
    const greeting = screen.getByText('今天練什麼？');
    expect(await screen.findByText('小明，今天練什麼？')).toBe(greeting);
    const rail = await screen.findByRole('complementary', { name: '我的學習' }, { timeout: 5000 });
    const quota = await within(rail).findByRole('region', { name: 'AI 點數' });
    expect(within(quota).getByTestId('quota-meters')).toHaveTextContent('今日剩');
    const recent = await within(rail).findByRole('region', { name: '最近的寫作紀錄' });
    await waitFor(() => expect(within(recent).getAllByRole('link')).toHaveLength(4));
    expect(within(recent).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/writing/submissions/t-2',
      '/writing/submissions/e-1',
      '/writing/submissions/e-2',
      '/writing',
    ]);
  });

  it('學習助手的開關打開（或管理員預覽）：「實戰」群組多一張學習助手的卡片；關著時沒有（docs/design/learning-assistant.md §5.1）', async () => {
    setDesktopViewport();
    renderPage('/', baseRoutes({ ...FEATURES_ON, assistant: true }), { '/': <HomePage /> });
    await screen.findByRole('heading', { name: '全部功能' }, { timeout: 5000 });
    const all = screen.getByRole('region', { name: '全部功能' });
    await waitFor(() => expect(within(all).getByRole('link', { name: /^學習助手/ })).toHaveAttribute('href', '/assistant'));
    const exam = within(all).getByRole('region', { name: '實戰' });
    expect(within(exam).getByRole('link', { name: /^學習助手/ })).toBeInTheDocument();
  });

  it('手機的首頁卡片：管理員預覽（/api/me 有 assistant_preview）時出現在「實戰」，一般學生沒有', async () => {
    const admin = { ...meWith('approved'), assistant_preview: { photo: false } };
    renderPage('/', baseRoutes(FEATURES_ON, { ...admin, user: { ...admin.user, role: 'admin' } }), { '/': <HomePage /> });
    const exam = await screen.findByRole('region', { name: '實戰' });
    await waitFor(() => expect(within(exam).getByRole('link', { name: /學習助手/ })).toHaveAttribute('href', '/assistant'));
  });
});
