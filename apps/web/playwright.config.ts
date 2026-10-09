/**
 * Playwright 煙霧測試設定（tests/smoke.spec.ts）。
 *
 * 測的是「建置後」的產物：webServer 跑 `vite preview` 提供 dist/，所以執行前要先 `npm run build`
 * （CI 的順序是 build → 煙霧測試；本機用根目錄的 `npm run test:e2e` 會自動先建置）。
 * 測建置產物而不是 dev server，是因為按需載入的 chunk、資產路徑這類問題只會在建置後出現。
 *
 * 桌機 1280×900、手機 375×667 各跑一次，判斷標準沿用 Sekai Center 的煙霧測試
 * （docs/research/05-sekai-center-patterns.md §2.9）。手機寬度比 Sekai 的 390 窄：375 是 iPhone SE 與
 * 舊款 iPhone 的寬度，學生手上仍很常見；在 375 不溢出，390 以上自然也不會。高度用 667 是為了讓
 * 「更多」面板在矮螢幕上也要能捲動到最後一項。
 */
import { existsSync } from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

/**
 * 預覽伺服器的連接埠。同一台機器上有其他工作目錄（git worktree）也在跑 e2e 時，4173 可能已經被它們的 vite preview 佔用，
 * 本機的 reuseExistingServer 會直接沿用那個伺服器、測到別的目錄的 dist/；這時用 E2E_PORT 換一個連接埠。
 */
const PORT = Number(process.env['E2E_PORT'] ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * 瀏覽器執行檔：CI 用 `npx playwright install --with-deps chromium` 裝與 Playwright 版本相符的 Chromium。
 * 本機開發環境若預先裝在 /opt/pw-browsers（PLAYWRIGHT_BROWSERS_PATH）但版本與 Playwright 不符，
 * Playwright 找不到它預期的那一版就會啟動失敗；這時改用該目錄下現成的 chromium，不必重新下載。
 * 也可以用環境變數 PLAYWRIGHT_CHROMIUM_PATH 明確指定。
 */
function chromiumExecutablePath(): string | undefined {
  const override = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  if (override) return override;
  if (existsSync(chromium.executablePath())) return undefined;
  const fallback = '/opt/pw-browsers/chromium';
  return existsSync(fallback) ? fallback : undefined;
}

const executablePath = chromiumExecutablePath();
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});
