/**
 * 桌機改版的前後對照截圖（docs/design/desktop-polish.md §5.0「截圖工具」、附錄 B；用法見同資料夾的 README.md）。
 *
 * 和 ../visual.config.ts（手機與平板的逐像素比對）分開：這裡截的是給人看的桌機畫面——三種桌機視窗＋1440×900 深色，
 * 每個狀態一張「打開時的第一個畫面」，頁面會捲動時另一張整頁圖（__full）。
 * 用自己的設定檔與 testMatch（*.audit.ts）：`npm run test:e2e`（只收 *.spec.ts）與 vitest 都不會跑到這裡。
 *
 * 環境變數：
 *   AUDIT_DIST      要截的建置產物（vite build 的 outDir）；預設 apps/web/dist。前後對照時用凍結的一份（附錄 B 的 dist-<pr>）
 *   AUDIT_OUT       截圖輸出資料夾（必須在 repo 外）；預設 ${TMPDIR:-/tmp}/gsat-visual/audit
 *   AUDIT_META      每張圖的紀錄（給 make-index.mjs）；預設 <AUDIT_OUT>/_meta
 *   AUDIT_PORT      vite preview 的連接埠；預設 E2E_PORT，再沒有就 4681
 *   AUDIT_PROJECTS  只跑哪些視窗（逗號分隔）：1366x768、1440x900、1920x1080、1440x900-dark；
 *                   另有 375x812（手機），只截標了 mobile 的狀態（改到手機的修正，給站主看差異），要明確指定才會跑
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, defineConfig, type Project } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', '..', '..');
const REPO = path.resolve(WEB, '..', '..');
const PORT = Number(process.env['AUDIT_PORT'] ?? process.env['E2E_PORT'] ?? 4681);
const DIST = path.resolve(process.env['AUDIT_DIST'] ?? path.join(WEB, 'dist'));
const OUT = path.resolve(process.env['AUDIT_OUT'] ?? path.join(os.tmpdir(), 'gsat-visual', 'audit'));
const META = path.resolve(process.env['AUDIT_META'] ?? path.join(OUT, '_meta'));

for (const [name, dir] of [
  ['AUDIT_OUT', OUT],
  ['AUDIT_META', META],
] as const) {
  if (`${dir}${path.sep}`.startsWith(`${REPO}${path.sep}`)) throw new Error(`${name}（${dir}）在 repo 裡：截圖一律放在 repo 外`);
}
if (!existsSync(path.join(DIST, 'index.html'))) throw new Error(`找不到建置產物 ${DIST}/index.html：先 vite build，或用 AUDIT_DIST 指定資料夾`);
// desktop.audit.ts 讀同樣的值（worker 繼承這個行程的環境變數）。
process.env['AUDIT_OUT'] = OUT;
process.env['AUDIT_META'] = META;

/** 同 apps/web/playwright.config.ts：Playwright 預期的 Chromium 不在時，改用 /opt/pw-browsers/chromium。 */
function chromiumExecutablePath(): string | undefined {
  const override = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
  if (override) return override;
  if (existsSync(chromium.executablePath())) return undefined;
  const fallback = '/opt/pw-browsers/chromium';
  return existsSync(fallback) ? fallback : undefined;
}
const executablePath = chromiumExecutablePath();

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768, dark: false, mobile: false },
  { name: '1440x900', width: 1440, height: 900, dark: false, mobile: false },
  { name: '1920x1080', width: 1920, height: 1080, dark: false, mobile: false },
  { name: '1440x900-dark', width: 1440, height: 900, dark: true, mobile: false },
  { name: '375x812', width: 375, height: 812, dark: false, mobile: true },
] as const;
const only = (process.env['AUDIT_PROJECTS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const selected = VIEWPORTS.filter((v) => (only.length === 0 ? !v.mobile : only.includes(v.name)));
if (selected.length === 0) throw new Error(`AUDIT_PROJECTS=${process.env['AUDIT_PROJECTS']} 沒有對到任何視窗（可用：${VIEWPORTS.map((v) => v.name).join('、')}）`);

const projects: Project[] = selected.map((v) => ({
  name: v.name,
  use: {
    browserName: 'chromium',
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 1,
    colorScheme: v.dark ? 'dark' : 'light',
    isMobile: v.mobile,
    hasTouch: v.mobile,
  },
}));

export default defineConfig({
  testDir: HERE,
  testMatch: /\.audit\.ts$/,
  outputDir: path.join(OUT, '_playwright'),
  fullyParallel: true,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['line']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--disable-gpu', '--disable-gpu-rasterization', '--disable-partial-raster', '--disable-lcd-text', '--force-color-profile=srgb'],
    },
  },
  projects,
  webServer: {
    // 直接服務指定的建置產物；連接埠被佔用時直接失敗，不會截到別的工作目錄的伺服器。
    command: `npx vite preview --outDir "${DIST}" --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: WEB,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
