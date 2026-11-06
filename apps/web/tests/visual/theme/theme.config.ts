/**
 * 全站 CSS 改版（docs/design/css-overhaul.md）的前後對照截圖與版面量測：手機 390×844、桌機 1280×800，淺色與深色。
 *
 * 和上一層的工具分工：`../visual.config.ts` 證明「逐像素不變」，`../audit/` 是桌機改版的前後對照；這裡給 CSS 改版的每個 PR
 * 截「主要路由 × 兩種寬度 × 兩種主題」，同時量每頁的水平溢出、過小的字與點擊目標、CLS 與 axe 的對比問題（_meta/*.json）。
 * 不在 `npm run test:e2e`（只收 *.spec.ts）與 vitest 裡；`npm run typecheck` 會檢查。
 *
 * 環境變數：
 *   THEME_SHOTS_OUT     輸出資料夾；預設 repo 根目錄的 .shots/manual（.shots/ 已列在 .gitignore）
 *   THEME_SHOTS_DIST    要測的建置產物；預設 apps/web/dist
 *   THEME_SHOTS_PORT    vite preview 的連接埠；預設 4431
 *   THEME_SHOTS_THEMES  light、dark 或 light,dark；預設 light
 *   THEME_SHOTS_VIEWPORTS  360、390、430、1280 的任意組合（逗號分隔）；預設 390,1280
 *   THEME_SHOTS_AXE     axe-core 的 axe.min.js 路徑；有給才跑 axe（只檢查 color-contrast）
 *
 * 用法（在 apps/web）：
 *   THEME_SHOTS_OUT=../../.shots/before npx playwright test -c tests/visual/theme/theme.config.ts
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, defineConfig, type Project } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', '..');
const ROOT = path.resolve(WEB, '..', '..');
const PORT = Number(process.env['THEME_SHOTS_PORT'] ?? 4431);
const DIST = path.resolve(process.env['THEME_SHOTS_DIST'] ?? path.join(WEB, 'dist'));
const OUT = path.resolve(process.env['THEME_SHOTS_OUT'] ?? path.join(ROOT, '.shots', 'manual'));
process.env['THEME_SHOTS_OUT'] = OUT;

if (!existsSync(path.join(DIST, 'index.html'))) {
  throw new Error(`找不到建置產物 ${DIST}/index.html：先 npm run build，或用 THEME_SHOTS_DIST 指定資料夾`);
}

const THEMES = (process.env['THEME_SHOTS_THEMES'] ?? 'light')
  .split(',')
  .map((s) => s.trim())
  .filter((s): s is 'light' | 'dark' => s === 'light' || s === 'dark');

const ALL_VIEWPORTS = [
  { name: '360', width: 360, height: 780, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '430', width: 430, height: 932, mobile: true },
  { name: '1280', width: 1280, height: 800, mobile: false },
] as const;
const wanted = (process.env['THEME_SHOTS_VIEWPORTS'] ?? '390,1280').split(',').map((s) => s.trim());
const VIEWPORTS = ALL_VIEWPORTS.filter((v) => wanted.includes(v.name));

function chromiumExecutablePath(): string | undefined {
  const override = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  if (override) return override;
  if (existsSync(chromium.executablePath())) return undefined;
  const fallback = '/opt/pw-browsers/chromium';
  return existsSync(fallback) ? fallback : undefined;
}
const executablePath = chromiumExecutablePath();

const projects: Project[] = THEMES.flatMap((theme) =>
  VIEWPORTS.map((v) => ({
    name: `${v.name}-${theme}`,
    metadata: { theme },
    use: {
      browserName: 'chromium' as const,
      viewport: { width: v.width, height: v.height },
      deviceScaleFactor: 1,
      isMobile: v.mobile,
      hasTouch: v.mobile,
    },
  })),
);

export default defineConfig({
  testDir: HERE,
  testMatch: /\.theme\.ts$/,
  outputDir: path.join(OUT, '_playwright'),
  fullyParallel: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'off',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--disable-gpu', '--disable-lcd-text', '--force-color-profile=srgb'],
    },
  },
  projects,
  webServer: {
    command: `npx vite preview --outDir "${DIST}" --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
