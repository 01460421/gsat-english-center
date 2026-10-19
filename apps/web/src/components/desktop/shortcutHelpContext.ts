/**
 * 從頁面打開鍵盤快捷鍵說明（設定頁的「查看全部快捷鍵」）：說明對話框由 Layout 掛載與管理（components/desktop/ShortcutHelp.tsx），
 * 頁面只拿到「打開」這個動作。不在 Layout 裡（元件測試）時是 null，呼叫端不顯示按鈕。
 */
import { createContext, useContext } from 'react';

export const OpenShortcutHelpContext = createContext<(() => void) | null>(null);

export function useOpenShortcutHelp(): (() => void) | null {
  return useContext(OpenShortcutHelpContext);
}
