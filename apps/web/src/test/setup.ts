/**
 * Vitest 的共用設定（vite.config.ts 的 test.setupFiles）。
 * - jest-dom：toBeInTheDocument() 這類 DOM 斷言。
 * - cleanup：沒開 vitest 的 globals，Testing Library 無法自動註冊清理，要自己在每個測試後卸載元件，
 *   否則上一個測試的畫面會留在 document 裡，讓下一個測試的查詢找到兩份。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    // 測試環境沒有 localStorage 時略過
  }
});
