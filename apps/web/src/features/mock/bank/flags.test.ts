/**
 * 本站自組模擬考的開關（設計文件 §7.8、§4.1）：功能已上線、預覽開關記在 localStorage、固定種子只在預覽模式有效。
 * 自組卷的 PDF 沒有自己的開關（跟著 pdfDownloadVisible()），畫面上的 PDF 區塊在 BankPdf.test.tsx 測。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BANK_MOCK_ENABLED, bankMockPreviewEnabled, bankMockSeed, bankMockVisible } from './flags';

function visit(search: string) {
  window.history.replaceState(null, '', `/mock${search}`);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('flags', () => {
  it('功能已上線：沒開預覽也看得到', () => {
    visit('');
    expect(BANK_MOCK_ENABLED).toBe(true);
    expect(bankMockPreviewEnabled()).toBe(false);
    expect(bankMockVisible()).toBe(true);
  });

  it('?bankmock=preview 記在這個瀏覽器，換頁後仍然有效；?bankmock=off 關掉', () => {
    visit('?bankmock=preview');
    expect(bankMockPreviewEnabled()).toBe(true);
    expect(window.localStorage.getItem('gsat-bankmock-preview')).toBe('1');
    visit('');
    expect(bankMockPreviewEnabled()).toBe(true);
    visit('?bankmock=off');
    expect(bankMockPreviewEnabled()).toBe(false);
    expect(window.localStorage.getItem('gsat-bankmock-preview')).toBeNull();
  });

  it('bankmockseed 只在預覽模式有效；格式不對或超過 32 位元是 null', () => {
    visit('?bankmockseed=42');
    expect(bankMockSeed()).toBeNull();
    visit('?bankmock=preview&bankmockseed=42');
    expect(bankMockSeed()).toBe(42);
    visit('?bankmockseed=4294967295');
    expect(bankMockSeed()).toBe(4294967295);
    for (const bad of ['4294967296', '-1', '1.5', 'abc', '']) {
      visit(`?bankmockseed=${bad}`);
      expect(bankMockSeed(), bad).toBeNull();
    }
    visit('');
    expect(bankMockSeed()).toBeNull();
  });

  it('localStorage 不能用：預覽當作沒打開，功能照樣看得到', () => {
    visit('?bankmock=preview&bankmockseed=7');
    // 封鎖網站資料時，讀 window.localStorage 本身就會丟例外。
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      expect(bankMockPreviewEnabled()).toBe(false);
      expect(bankMockSeed()).toBeNull();
      expect(bankMockVisible()).toBe(true);
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else Reflect.deleteProperty(window, 'localStorage');
    }
  });
});
