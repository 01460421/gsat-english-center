/**
 * 快捷鍵說明的程式（lazy chunk）載入失敗（網站剛重新部署、舊分頁的 chunk 不見了，或離線）：Layout 的錯誤邊界只顯示一個請學生
 * 重新整理的小對話框，頁面其他部分照常；錯誤不能往上拋到沒有錯誤邊界的地方，把整個畫面卸載（白畫面）。
 * 另外一個檔案：vi.mock 對整個檔案生效，Layout.test.tsx 裡其他測試要能正常打開說明。
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetHotkeysForTests } from '../lib/hotkeys';
import { setDesktopViewport } from '../test/viewport';
import { Layout } from './Layout';

vi.mock('./desktop/ShortcutHelp', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/ShortcutHelp-old.js');
});

afterEach(() => resetHotkeysForTests());

describe('快捷鍵說明載入失敗', () => {
  it('按 ? 之後頁面內容還在，只顯示請重新整理的對話框；關閉後焦點回到原處，可以再按一次', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    setDesktopViewport();
    render(
      <MemoryRouter initialEntries={['/exams']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<h1>歷屆試題</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const footerButton = within(screen.getByRole('navigation', { name: '網站資訊' })).getByRole('button', { name: '鍵盤快捷鍵' });
    footerButton.focus();
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: '鍵盤快捷鍵' });
    expect(dialog).toHaveTextContent('說明暫時載入不了');
    expect(screen.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: '主要導覽' }).length).toBeGreaterThan(0);
    expect(consoleError).toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(footerButton).toHaveFocus();
    await user.click(footerButton);
    expect(await screen.findByRole('dialog', { name: '鍵盤快捷鍵' })).toHaveTextContent('說明暫時載入不了');
    expect(screen.getByRole('heading', { level: 1, name: '歷屆試題' })).toBeInTheDocument();
  });
});
