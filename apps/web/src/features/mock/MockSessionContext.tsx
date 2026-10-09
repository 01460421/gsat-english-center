/**
 * 作答中的模擬考（MockSession）交給工具列、大題導覽、題號面板與「標記」按鈕。
 * 和 AttemptContext 一樣用 useSyncExternalStore：選擇器只能回傳原始值或 session 裡既有的物件參照，
 * 不能每次都建立新陣列或新物件（否則會一直重繪）。
 */
import { createContext, use, useSyncExternalStore } from 'react';
import type { MockConflict, MockMeta, MockSession } from './session';

export const MockSessionContext = createContext<MockSession | null>(null);

export function useMockSession(): MockSession {
  const session = use(MockSessionContext);
  if (!session) throw new Error('useMockSession 必須在 MockSessionContext 裡使用');
  return session;
}

export function useMockMeta<T>(selector: (meta: MockMeta) => T): T {
  const session = useMockSession();
  return useSyncExternalStore(session.subscribe, () => selector(session.getMeta()));
}

export function useMockConflict(): MockConflict | null {
  const session = useMockSession();
  return useSyncExternalStore(session.subscribe, session.getConflict);
}
