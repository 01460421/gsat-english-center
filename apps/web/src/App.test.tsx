/**
 * 路由與版面：每個 modules.ts 列出的頁面都要能載入（按需載入的 chunk 對得上），標題要正確，
 * 未知路徑要顯示 404 頁而不是空白。完整的瀏覽器檢查（console error、手機溢出）在 tests/smoke.spec.ts。
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { APP_NAME, NAV_GROUPS, PAGES, documentTitle, isDevPage } from './modules';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // 首頁會打 /api/health；路由測試不關心結果，給一個永遠不回應的 fetch，避免測試結束後才更新狀態。
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

describe('路由', () => {
  for (const page of PAGES) {
    it(`${page.path} 顯示「${page.title}」`, async () => {
      renderAt(page.path);
      // 逾時放寬到 5 秒：完成的模組（/words 約百 KB）第一次按需載入要先轉譯一大串模組，
      // 整套平行跑時偶爾超過預設的 1 秒，變成和程式無關的偶發失敗。
      const h1 = await screen.findByRole('heading', { level: 1, name: page.title }, { timeout: 5000 });
      expect(document.title).toBe(documentTitle(page));
      // 「開發中」標記與說明橫幅只出現在還沒完成的模組（status: 'dev'）。
      const titleRow = h1.parentElement;
      if (!titleRow) throw new Error('標題沒有外層元素');
      if (isDevPage(page)) {
        expect(within(titleRow).getByText('開發中')).toBeInTheDocument();
        expect(screen.getByText(/這個模組還在開發中/)).toBeInTheDocument();
      } else {
        expect(within(titleRow).queryByText('開發中')).not.toBeInTheDocument();
        expect(screen.queryByText(/這個模組還在開發中/)).not.toBeInTheDocument();
      }
    });
  }

  it('未知路徑顯示找不到頁面', async () => {
    renderAt('/no-such-page');
    expect(await screen.findByRole('heading', { level: 1, name: '找不到這個頁面' })).toBeInTheDocument();
  });
});

describe('版面', () => {
  it('側邊欄列出所有頁面，目前頁面標示為 current', async () => {
    renderAt('/cloze');
    await screen.findByRole('heading', { level: 1, name: '綜合測驗' });
    // 側邊欄與手機底部導覽都叫「主要導覽」（同時只會顯示一個，靠 CSS 切換）；第一個是側邊欄。
    const [sidebar] = screen.getAllByRole('navigation', { name: '主要導覽' });
    if (!sidebar) throw new Error('找不到側邊欄');
    for (const page of PAGES) {
      expect(within(sidebar).getByRole('link', { name: page.navLabel })).toHaveAttribute('href', page.path);
    }
    expect(within(sidebar).getByRole('link', { name: '綜合測驗' })).toHaveAttribute('aria-current', 'page');
  });

  it('首頁依分組列出各模組的入口卡片，「開發中」只標在還沒完成的模組', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
    let cards = 0;
    for (const group of NAV_GROUPS) {
      const pages = PAGES.filter((p) => p.group === group.id && p.isStudyModule);
      if (!group.label || pages.length === 0) continue;
      const region = screen.getByRole('region', { name: group.label });
      for (const page of pages) {
        const link = within(region).getByRole('link', { name: new RegExp(page.title) });
        expect(link).toHaveAttribute('href', page.path);
        if (isDevPage(page)) expect(within(link).getByText('開發中')).toBeInTheDocument();
        else expect(within(link).queryByText('開發中')).not.toBeInTheDocument();
        cards += 1;
      }
    }
    expect(cards).toBe(PAGES.filter((p) => p.isStudyModule).length);
  });

  it('手機的「更多」面板：開啟後列出全部頁面，Esc 關閉並把焦點還給按鈕', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { level: 1, name: APP_NAME });
    const moreButton = screen.getByRole('button', { name: '更多' });
    await user.click(moreButton);
    const dialog = screen.getByRole('dialog', { name: '全部功能' });
    expect(within(dialog).getByRole('link', { name: '關於' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
  });

  it('從「更多」面板選一頁會換頁並關閉面板', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { level: 1, name: APP_NAME });
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: '設定' }));
    expect(await screen.findByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
