/**
 * 桌機介面新增的文字不能出現「大考中心」或 CEEC（docs/design/desktop-ui.md §1、§11.4；註冊商標，
 * docs/research/04-data-sources-licensing.md §0 第 2 點）。既有的文字（首頁標語、/words 說明、AiNotice 的完整版）不在範圍內。
 * 掃這次新增或改寫的桌機檔案的原始碼（Vite 的 ?raw 匯入；src/ 的 tsconfig 沒有 node 型別）。之後的 PR 新增桌機檔案時加進來。
 */
import { describe, expect, it } from 'vitest';

const FILES = {
  ...import.meta.glob<string>(['./components/desktop/*.{ts,tsx}', '!./components/desktop/*.test.{ts,tsx}'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>(
    ['./lib/media.ts', './lib/desktopLayout.ts', './lib/desktopPrefs.ts', './lib/hotkeys.ts', './components/Layout.tsx', './components/ThemeToggle.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
  // PR A2（首頁與列表頁）新增的檔案。
  ...import.meta.glob<string>(
    [
      './features/home/*.{ts,tsx}',
      '!./features/home/*.test.{ts,tsx}',
      './features/exams/ExamTable.tsx',
      './features/writing/components/WritingListBar.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
  // docs/design/desktop-polish.md PR 1（防誤觸與語言標記）新增的檔案。
  ...import.meta.glob<string>(
    ['./lib/timedSession.ts', './features/writing/components/SubmitGuard.tsx', './features/exams/components/UnansweredList.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ),
};

describe('桌機介面的文案', () => {
  it('掃到這次新增的檔案', () => {
    expect(Object.keys(FILES)).toEqual(
      expect.arrayContaining([
        './components/desktop/ShortcutHelp.tsx',
        './components/desktop/DataTable.tsx',
        './components/desktop/Slot.tsx',
        './components/Layout.tsx',
        './lib/hotkeys.ts',
        './features/home/DesktopDashboard.tsx',
        './features/home/continueItems.ts',
        './features/exams/ExamTable.tsx',
        './components/desktop/LeaveSessionDialog.tsx',
        './lib/timedSession.ts',
        './features/writing/components/SubmitGuard.tsx',
        './features/exams/components/UnansweredList.tsx',
      ]),
    );
  });

  it('不出現「大考中心」或 CEEC', () => {
    const hits = Object.entries(FILES).filter(([, source]) => /大考中心|CEEC/i.test(source));
    expect(hits.map(([file]) => file)).toEqual([]);
  });
});
