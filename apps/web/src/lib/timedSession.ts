/**
 * 計時中的作答（模擬考作答中、歷屆試題考試模式作答中）：點側邊欄、頁尾或帳號選單裡的站內連結時，先問要不要離開
 * （docs/design/desktop-polish.md §4.7「計時中離開」）。
 *
 * 站上用的是 <BrowserRouter>，react-router 的 useBlocker 只在 data router 下可用，所以不攔「換頁」本身：作答頁在計時中
 * 用 useTimedSession() 登記一個讀剩餘時間的函式，Layout 在 ≥ lg 攔截殼層裡站內連結的點擊（onClickCapture），有登記時先開確認。
 * 瀏覽器的上一頁、關閉分頁、頁面裡自己的連結（返回列表）不攔：作答與時間都存在這台裝置，beforeunload 的提示在重新整理時
 * 也會跳出來，反而干擾。
 */
import { createContext, use, useEffect, useRef } from 'react';

export interface TimedSessionInfo {
  /** 剩餘秒數（已經沒有時間限制時回傳 null，就不再攔）。 */
  remainingSec: () => number | null;
  /** 確認框裡「離開之後計時會怎樣」的一句話（模擬考照樣倒數；歷屆試題的考試模式會暫停）。 */
  leaveNote: string;
}

export interface TimedSessionRegistry {
  /** 登記目前的計時作答；回傳取消登記的函式。同一時間只會有一份（後登記的覆蓋前一份）。 */
  register: (info: TimedSessionInfo) => () => void;
}

/** Layout 提供；沒有 Layout 的地方（單元測試直接 render 頁面）是 null，useTimedSession 什麼都不做。 */
export const TimedSessionContext = createContext<TimedSessionRegistry | null>(null);

/** Layout 用：一個可變的槽，放目前登記的計時作答。 */
export function createTimedSessionRegistry(): TimedSessionRegistry & { current: () => TimedSessionInfo | null } {
  let current: TimedSessionInfo | null = null;
  return {
    current: () => current,
    register: (info) => {
      current = info;
      return () => {
        if (current === info) current = null;
      };
    },
  };
}

/**
 * 作答頁用：active 為 true 時（計時中、還沒交卷）登記。remainingSec 每次都讀最新的（存在 ref 裡，不必是穩定的函式）。
 * 只登記資訊，不決定要不要攔：Layout 只在 ≥ lg 攔（手機的底部導覽、「更多」面板照舊直接換頁）。
 */
export function useTimedSession(active: boolean, remainingSec: () => number | null, leaveNote: string): void {
  const registry = use(TimedSessionContext);
  const read = useRef(remainingSec);
  read.current = remainingSec;
  useEffect(() => {
    if (!active || !registry) return;
    return registry.register({ remainingSec: () => read.current(), leaveNote });
  }, [active, registry, leaveNote]);
}
