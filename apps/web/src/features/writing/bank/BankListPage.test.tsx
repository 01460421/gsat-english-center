/** 本站仿真題的列表頁（依難度；docs/design/bank-writing.md §2.2、§7.3）。 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { clearDataCache } from '../../../data/client';
import { AI_GROUP_LABEL } from '../../practice/labels';
import { draftKey } from '../lib/drafts';
import { BANK_CP_GROUP, BANK_TR_GROUP, FEATURES_OFF, FEATURES_ON, baseRoutes } from '../testing/fixtures';
import { renderPage } from '../testing/render';
import { BankEssayListPage, BankTranslationListPage } from './BankListPage';

afterEach(() => {
  clearDataCache();
  window.localStorage.clear();
});

const pages = { '/writing/translation/ai': <BankTranslationListPage />, '/writing/essay/ai': <BankEssayListPage /> };

describe('本站仿真中譯英列表', () => {
  it('難度 radio 與題數；預設選第一個有題的難度；卡片連到作答頁；有 AI 出題標示', async () => {
    const { fetch } = renderPage('/writing/translation/ai', baseRoutes(FEATURES_OFF), pages);
    expect(screen.getByRole('heading', { level: 1, name: '本站仿真中譯英' })).toBeInTheDocument();
    expect(screen.getByText(AI_GROUP_LABEL)).toBeInTheDocument();
    const picker = await screen.findByRole('group', { name: '難度' });
    expect(within(picker).getByRole('radio', { name: /^穩定基礎\s*1 組$/ })).toBeChecked();
    // 還沒有題組的難度顯示「出題中」（和題型頁的題庫練習同一個說法），不是 0。
    expect(within(picker).getByRole('radio', { name: /^進階練習\s*出題中$/ })).not.toBeChecked();
    const card = await screen.findByRole('link', { name: /自備水壺上學/ });
    expect(card).toHaveAttribute('href', '/writing/translation/ai/0b1c2d');
    expect(card).toHaveTextContent('近年來，許多學生已經開始自己帶水壺到學校。');
    // 只下載選中的那個難度的列表；作答前的檔案都不會先下載。
    const dataCalls = fetch.calls.filter((c) => c.path.startsWith('/data/writing/bank/')).map((c) => c.path);
    expect(dataCalls).toEqual(['/data/writing/bank/index.json', '/data/writing/bank/list/translation-basic.json']);
    // 「歷屆試題｜本站仿真」：目前在本站仿真。
    const tabs = screen.getByRole('navigation', { name: '題目來源' });
    expect(within(tabs).getByRole('link', { name: '本站仿真' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs).getByRole('link', { name: '歷屆試題' })).toHaveAttribute('href', '/writing/translation');
    // 頁尾：不是大考中心的試題；後端沒部署時不叫學生登入申請。
    expect(screen.getByText(/不是大考中心的試題。參考譯文、評分規準與範文都是本站撰寫/)).toBeInTheDocument();
    expect(screen.queryByText(/登入並通過申請/)).not.toBeInTheDocument();
  });

  it('切到沒有題組的難度：顯示「出題中」與其他有題的難度；?tier= 記在網址', async () => {
    const user = userEvent.setup();
    renderPage('/writing/translation/ai', baseRoutes(FEATURES_ON), pages);
    await user.click(await screen.findByRole('radio', { name: /進階練習/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/writing/translation/ai?tier=advanced');
    const status = (await screen.findByText(/這個難度還在出題中/)).closest('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(within(status).getByRole('link', { name: '穩定基礎（1）' })).toHaveAttribute('href', '/writing/translation/ai?tier=basic');
    expect(screen.getByText(/較長的句子|一句兩個句構/)).toBeInTheDocument();
  });

  it('網址的 ?tier= 會保留（重新整理、返回）', async () => {
    renderPage('/writing/translation/ai?tier=top', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('radio', { name: /超越頂標/ })).toBeChecked();
    expect(await screen.findByText('這個難度還在出題中：題目要通過自動驗證才會上架。')).toBeInTheDocument();
  });

  it('卡片的進度：只有 aiSubmittedAt 也是「已完成」；只有文字是「草稿」', async () => {
    window.localStorage.setItem(draftKey('translation', BANK_TR_GROUP), JSON.stringify({ texts: ['', ''], revealedAt: null, aiSubmittedAt: 1_790_000_000_000 }));
    const { unmount } = renderPage('/writing/translation/ai', baseRoutes(FEATURES_OFF), pages);
    expect(await screen.findByRole('link', { name: /自備水壺上學/ })).toHaveTextContent('已完成');
    unmount();
    clearDataCache();
    window.localStorage.setItem(draftKey('translation', BANK_TR_GROUP), JSON.stringify({ texts: ['Some text.', ''], revealedAt: null, aiSubmittedAt: null }));
    renderPage('/writing/translation/ai', baseRoutes(FEATURES_OFF), pages);
    const card = await screen.findByRole('link', { name: /自備水壺上學/ });
    expect(card).toHaveTextContent('草稿');
    expect(card).not.toHaveTextContent('已完成');
  });

  it('index 載入失敗：就地顯示「再試一次」', async () => {
    renderPage('/writing/translation/ai', { ...baseRoutes(FEATURES_OFF), 'GET /data/writing/bank/index.json': () => new Response('x', { status: 500 }) }, pages);
    expect(await screen.findByRole('button', { name: '再試一次' })).toBeInTheDocument();
  });
});

describe('本站仿真作文列表', () => {
  it('卡片：主題、題型、提示摘要、附圖數；已對照顯示「已完成」', async () => {
    window.localStorage.setItem(draftKey('essay', BANK_CP_GROUP), JSON.stringify({ text: 'x', revealedAt: 1, aiSubmittedAt: null }));
    renderPage('/writing/essay/ai', baseRoutes(FEATURES_ON), pages);
    expect(screen.getByRole('heading', { level: 1, name: '本站仿真作文' })).toBeInTheDocument();
    const card = await screen.findByRole('link', { name: /打掃時間的分工/ });
    expect(card).toHaveAttribute('href', '/writing/essay/ai/0e1f2a');
    expect(card).toHaveTextContent('看圖寫作');
    expect(card).toHaveTextContent('附圖 1 張');
    expect(card).toHaveTextContent('已完成');
    expect(card.textContent).not.toMatch(/^提示：/);
  });
});
