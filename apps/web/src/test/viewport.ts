/**
 * 元件測試切換視窗大小（docs/design/desktop-ui.md §2.1 R8）。
 *
 * 預設是手機 375×667（vite.config.ts 的 test.environmentOptions，每個測試結束後 setup.ts 會設回來）。
 * happy-dom 的 setViewport 之後，matchMedia 的結果與 change 事件都會跟著變，useMediaQuery／useIsDesktop 會重繪。
 */
export const MOBILE_VIEWPORT = { width: 375, height: 667 } as const;

interface HappyDomWindow {
  happyDOM?: { setViewport(viewport: { width?: number; height?: number }): void };
}

/** 目前是不是 happy-dom 環境（檔頭標了 @vitest-environment node 的測試沒有 window）。 */
export function isHappyDom(): boolean {
  return typeof window !== 'undefined' && (window as unknown as HappyDomWindow).happyDOM !== undefined;
}

function setViewport(width: number, height: number) {
  const happyDOM = typeof window === 'undefined' ? undefined : (window as unknown as HappyDomWindow).happyDOM;
  if (!happyDOM) throw new Error('setViewport 只能在 happy-dom 環境使用');
  happyDOM.setViewport({ width, height });
}

/** 桌機視窗；預設 1366×640（學校筆電，設計文件 §1.1 的驗收尺寸）。 */
export function setDesktopViewport(width = 1366, height = 640) {
  setViewport(width, height);
}

/** 手機視窗（預設值）。 */
export function setMobileViewport(width: number = MOBILE_VIEWPORT.width, height: number = MOBILE_VIEWPORT.height) {
  setViewport(width, height);
}
