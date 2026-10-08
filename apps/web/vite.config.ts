import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * 本機開發時 Worker 由 `wrangler dev` 跑在 127.0.0.1:8787（apps/api/wrangler.toml 的 [dev]）。
 * 前端一律用相對路徑呼叫 /api、/auth，由 Vite 轉送過去，瀏覽器看到的就是同源：
 *   - 不需要處理 CORS preflight；
 *   - 之後 session cookie 是 host-only，同源才會跟著請求送出。
 * 線上（買網域前）由 vercel.json 的 rewrites 做同樣的事，所以前端程式碼兩邊不用改。
 * 用 127.0.0.1 而不是 localhost：Node 會優先把 localhost 解析成 ::1，而 wrangler 只聽 IPv4。
 */
const API_TARGET = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // 關掉 Vite 自己的 CORS 中介層：它預設會替 localhost 來源直接回應 OPTIONS preflight，
    // 請求根本到不了 proxy，開發時看到的 CORS 標頭就不是 Worker 發的，和線上（Vercel 原樣轉送給 Worker）不一致。
    // 前端與 /api 同源，本來就不需要 Vite 發 CORS 標頭。
    cors: false,
    proxy: {
      // 不改 Host（changeOrigin: false），Worker 看到的請求網址與瀏覽器一致（http://localhost:5173/…），
      // 同源的 POST 會被 Origin 檢查當成「Worker 自己」放行，所以 wrangler.toml 的 ALLOWED_ORIGINS 不必列 localhost。
      '/api': { target: API_TARGET, changeOrigin: false },
      '/auth': { target: API_TARGET, changeOrigin: false },
    },
  },
  // `vite preview`（Playwright 煙霧測試用）預設沿用 server.proxy。
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    // 產物檔名帶內容雜湊，放在 /assets/ 下；vercel.json 對 /assets/* 設一年 immutable 快取。
    assetsDir: 'assets',
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
