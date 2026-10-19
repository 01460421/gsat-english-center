/**
 * Vitest 的共用設定（vite.config.ts 的 test.setupFiles）。
 * - jest-dom：toBeInTheDocument() 這類 DOM 斷言。
 * - cleanup：沒開 vitest 的 globals，Testing Library 無法自動註冊清理，要自己在每個測試後卸載元件，
 *   否則上一個測試的畫面會留在 document 裡，讓下一個測試的查詢找到兩份。
 * - 視窗設回手機 375×667：測桌機的測試用 setDesktopViewport() 改寬，不能影響下一個測試（設計文件 §2.1 R8）。
 * - 換樹後還原焦點的重試計時器（lib/media.ts）停掉：不能在下一個測試裡移動焦點、暫停快捷鍵。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetFocusRestoreForTests } from '../lib/media';
import { isHappyDom, setMobileViewport } from './viewport';

afterEach(() => {
  cleanup();
  resetFocusRestoreForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // 檔頭標了 @vitest-environment node 的測試（資料管線）沒有 window。
  if (isHappyDom()) setMobileViewport();
  try {
    window.localStorage.clear();
  } catch {
    // 測試環境沒有 localStorage 時略過
  }
});
