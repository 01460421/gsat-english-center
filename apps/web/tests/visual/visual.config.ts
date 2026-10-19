/**
 * 版面截圖工具的 Playwright 設定（docs/design/desktop-ui.md §11.1、§11.2；用法見同資料夾的 README.md）。
 *
 * 用自己的設定檔與 testMatch（*.shots.ts）：`npm run test:e2e`（playwright.config.ts，只跑 *.spec.ts）不會跑到這裡，
 * vitest 只收 src/、scripts/ 的 *.test.ts，也不會碰到。平常用 scripts/visual-run.sh、visual-baseline.sh 執行。
 *
 * 環境變數（腳本會設好）：
 *   SHOTS_OUT        截圖輸出資料夾；每個視窗一個子資料夾（例如 375x812/）。預設 ${TMPDIR:-/tmp}/gsat-visual/manual
 *   SHOTS_DIST       要測的建置產物（vite build 的 outDir）；預設 apps/web/dist
 *   SHOTS_PORT       vite preview 的連接埠；預設 4417（不和 e2e 的 4173 搶）
 *   SHOTS_VIEWPORTS  只跑哪些視窗：逗號分隔的名稱或寬度（例如 320x640,375x812,768x1024），
 *                    或 narrow（三種手機與平板）、desktop（九種桌機）、all；預設 all
 *   SHOTS_DSF        deviceScaleFactor；預設 1（基準與對照要用同一個值）
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, defineConfig, type Project } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..');
const PORT = Number(process.env['SHOTS_PORT'] ?? 4417);
const DIST = path.resolve(process.env['SHOTS_DIST'] ?? path.join(WEB, 'dist'));
const DSF = Number(process.env['SHOTS_DSF'] ?? 1);
const OUT = path.resolve(process.env['SHOTS_OUT'] ?? path.join(os.tmpdir(), 'gsat-visual', 'manual'));
// capture.shots.ts 讀同一個值（worker 繼承這個行程的環境變數）。
process.env['SHOTS_OUT'] = OUT;

if (!existsSync(path.join(DIST, 'index.html'))) {
  throw new Error(`找不到建置產物 ${DIST}/index.html：先 vite build，或用 SHOTS_DIST 指定資料夾`);
}

/**
 * 320、375、768 是手機與平板的基準（改版後必須逐像素相同，narrow: true）；其餘是桌機。
 * 桌機的 1024×600、1280×600、1366×640、1440×800、1920×960 是設計文件 §1.1 的驗收視窗（視窗內高以 600 為下限），
 * 1024×768、1280×800、1440×900、1920×1080 是盤點時的四種，留著和舊截圖逐張對照。
 */
export const VIEWPORTS = [
  { name: '320x640', width: 320, height: 640, narrow: true },
  { name: '375x812', width: 375, height: 812, narrow: true },
  { name: '768x1024', width: 768, height: 1024, narrow: true },
  { name: '1024x600', width: 1024, height: 600, narrow: false },
  { name: '1024x768', width: 1024, height: 768, narrow: false },
  { name: '1280x600', width: 1280, height: 600, narrow: false },
  { name: '1280x800', width: 1280, height: 800, narrow: false },
  { name: '1366x640', width: 1366, height: 640, narrow: false },
  { name: '1440x800', width: 1440, height: 800, narrow: false },
  { name: '1440x900', width: 1440, height: 900, narrow: false },
  { name: '1920x960', width: 1920, height: 960, narrow: false },
  { name: '1920x1080', width: 1920, height: 1080, narrow: false },
] as const;

/** SHOTS_VIEWPORTS 的值 → 要跑的視窗。寬度（例如 1280）會對到所有同寬的視窗。 */
function selectViewports(spec: string) {
  const items = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0 || items.includes('all')) return [...VIEWPORTS];
  return VIEWPORTS.filter(
    (v) => items.includes(v.name) || items.includes(String(v.width)) || (v.narrow ? items.includes('narrow') : items.includes('desktop')),
  );
}
const selected = selectViewports(process.env['SHOTS_VIEWPORTS'] ?? '');
if (selected.length === 0) {
  throw new Error(`SHOTS_VIEWPORTS=${process.env['SHOTS_VIEWPORTS']} 沒有對到任何視窗（可用：narrow、desktop、all、${VIEWPORTS.map((v) => v.name).join('、')}）`);
}

/** 同 apps/web/playwright.config.ts：Playwright 預期的 Chromium 不在時，改用 /opt/pw-browsers/chromium。 */
function chromiumExecutablePath(): string | undefined {
  const override = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  if (override) return override;
  if (existsSync(chromium.executablePath())) return undefined;
  const fallback = '/opt/pw-browsers/chromium';
  return existsSync(fallback) ? fallback : undefined;
}
const executablePath = chromiumExecutablePath();

const projects: Project[] = selected.map((v) => ({
  name: v.name,
  use: {
    browserName: 'chromium',
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: DSF,
    // 手機與平板：觸控＋行動版視窗（meta viewport 生效、內容太寬時版面視窗會被撐開，和真機一樣）。
    isMobile: v.narrow,
    hasTouch: v.narrow,
  },
}));

export default defineConfig({
  testDir: HERE,
  testMatch: /\.shots\.ts$/,
  // Playwright 自己的輸出（每次執行前清空）放在截圖資料夾裡，不寫進 repo。
  outputDir: path.join(OUT, '_playwright'),
  fullyParallel: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      // 減少點陣化的雜訊（陰影、模糊、反鋸齒在不同次執行之間差 1 個色階）：全部走 CPU 點陣化、固定 sRGB、關掉 LCD 次像素文字。
      args: [
        '--disable-gpu',
        '--disable-gpu-rasterization',
        '--disable-partial-raster',
        '--disable-skia-runtime-opts',
        '--disable-lcd-text',
        '--force-color-profile=srgb',
      ],
    },
  },
  projects,
  webServer: {
    // 直接服務指定的 outDir（不經 npm run preview：不用 apps/web/dist，避免測到別的工作階段剛建置的版本）。
    command: `npx vite preview --outDir "${DIST}" --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    url: `http://127.0.0.1:${PORT}`,
    // 連接埠被別的伺服器佔用時直接失敗，不沿用（沿用的話可能截到別的工作目錄的畫面）。
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
