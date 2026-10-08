# 學測英文中心（GSAT English Center）

為台灣高中生打造的學測英文備考與能力提升網頁 App。

## 規劃中的模組

- **單字**：大考中心《高中英文參考詞彙表》Level 1–6（主力 3–5）、間隔重複複習、多元測驗、同義詞／多義詞／搭配詞／片語／例句、歷屆出現頻率與重要度、一鍵查 Cambridge 辭典
- **詞彙題、綜合測驗（克漏字）、文意選填、篇章結構**：從英文文章自動出題，三種難度（穩定基礎／進階練習／超越頂標），依大考中心出題模式設計
- **閱讀測驗與混合題**：以聯合國 SDGs 為主題，含圖表、表格、多文本與一般長文
- **中譯英與英文作文**：歷屆題目彙整、仿真命題、詳解與範文，手寫作文拍照後由 AI 辨識並依大考中心評分原則批改
- **歷屆試題庫**：學測 83–115 學年度、指考 91–110 學年度

## 架構

參考 [Project SEKAI 資源中心](https://github.com/01460421/project-sekai-center)：前端部署在 Vercel，後端使用 Cloudflare Worker 與 D1，GitHub Actions 負責資料管線；AI 使用 Claude API。

詳細規格與研究文件見 [`docs/`](docs/)。

## 開發

### 需求

- **Node.js 22**（版本寫在 `.nvmrc`；最低 22.22.0，這是 React Router 8 的要求）與隨附的 npm。
- **Python 3**：只有 `tools/` 的資料腳本需要（題庫檢查只用標準函式庫）。
- 本機開發**不需要 Cloudflare 帳號**：`wrangler dev` 會用 `apps/api/.wrangler/` 下的本機模擬 D1。

### 安裝

```bash
nvm use            # 或自行安裝 Node 22
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # 選用：之後接 AI、登入時才需要填值（.dev.vars 不會進版控）
```

### 本機開發

```bash
npm run dev        # 同時啟動前端 http://localhost:5173 與 Worker http://127.0.0.1:8787
npm run dev:web    # 只啟動前端（首頁會顯示「後端未連線」，其他頁面不受影響）
npm run dev:api    # 只啟動 Worker
```

前端一律用相對路徑呼叫 `/api/*`、`/auth/*`，由 Vite 的 `server.proxy` 轉到 `wrangler dev`。瀏覽器看到的是同源，不必處理 CORS，之後 host-only 的 session cookie 也才送得出去（理由見 `docs/research/05-sekai-center-patterns.md` §1.3）。

### 檢查與測試

| 指令 | 內容 |
|---|---|
| `npm run typecheck` | 所有 workspace 的 `tsc`（strict） |
| `npm run lint` | 目前等同 `typecheck` |
| `npm test` | Vitest：共用型別對 `data/` 實際資料的執行期檢查、Worker 的 CORS／Origin 檢查、前端元件與路由 |
| `npm run build` | Vite 建置前端；`wrangler deploy --dry-run` 打包 Worker（不會部署） |
| `npm run test:e2e` | 先建置前端，再用 Playwright 在桌機（1280×900）與手機（390×844）尺寸跑全部路由的煙霧測試：無 console error、標題正確、沒有水平捲動 |
| `npm run validate:exams` | 檢查 `data/exams/parsed/*.json` 是否符合 `gsat-exam/v1`（`docs/exam-json-schema.md`） |

- 第一次在自己的電腦跑煙霧測試前，先執行 `npx playwright install chromium`（CI 會自動安裝）。如果環境已預裝版本不同的 Chromium（例如 `/opt/pw-browsers`），`apps/web/playwright.config.ts` 會自動改用它，也可以用環境變數 `PLAYWRIGHT_CHROMIUM_PATH` 指定執行檔。
- 煙霧測試用 `page.route` 假造後端，不需要啟動 `wrangler dev`。
- CI（`.github/workflows/ci.yml`）在 push 到 main 與每個 PR 執行上面全部項目；題庫檢查是獨立的 job，資料有錯不會蓋掉程式碼的檢查結果。

### 套件版本

- 套件版本用 npm 上的最新穩定版，並提交 `package-lock.json`；CI 與 Vercel 都用 `npm ci` 照 lockfile 安裝。wrangler 鎖定確切版本（`apps/api/package.json`），因為 `compatibility_date` 的上限取決於它附帶的 workerd。
- 根目錄 `package.json` 的 `overrides`（JSON 不能寫註解，理由記在這裡）：上游套件把有漏洞的版本寫死，用 overrides 換成修補版。上游更新依賴後就可以拿掉，拿掉前先跑 `npm audit` 確認。
  - `sharp`：wrangler 依賴的 miniflare 固定用 0.35.4，有 librsvg 的高風險漏洞（GHSA-wq5f-xc86-pv6w），0.35.5 修正。
  - `shell-quote`：concurrently 固定用 1.9.0，有命令注入漏洞（GHSA-pqg4-j6r4-53mv，critical），1.12.0 修正。

### 目錄結構

```
apps/
  web/                 前端：Vite＋React＋TypeScript＋React Router＋Tailwind CSS v4
    src/modules.ts       全站頁面清單（導覽列、首頁卡片、路由表、煙霧測試共用同一份）
    src/pages/           各頁面（除首頁外都按需載入）
    src/components/      版面（側邊欄／底部導覽）、後端狀態、主題切換
    src/lib/             API 呼叫、主題設定
    public/              PWA manifest 與圖示（service worker 之後再做）
    tests/smoke.spec.ts  Playwright 煙霧測試
  api/                 後端：Cloudflare Worker（Hono）＋D1
    src/app.ts           路由與中介層（CORS、非 GET 的 Origin 檢查、統一錯誤格式）
    migrations/          D1 遷移檔（wrangler d1 migrations；命名規則見該目錄的 README）
    test/                Worker 測試（直接呼叫 app.request()，不需要 wrangler）
    wrangler.toml        Worker 設定（D1 綁定、ALLOWED_ORIGINS、自訂網域範例）
packages/
  shared/              前後端共用型別：題目 JSON（gsat-exam/v1）、詞彙表條目、API 回應格式
data/                  題庫與詞彙資料（data/raw/ 不進版控）
docs/                  研究與規格文件
tools/                 資料處理腳本（Python）
vercel.json            Vercel 部署設定（前端）
```

### 部署

前端部署到 **Vercel**，後端是 **Cloudflare Worker＋D1**。完整的帳號與設定清單見 `docs/research/05-sekai-center-patterns.md` §4。

**1. Worker（Cloudflare）**

```bash
npx wrangler login
npx wrangler d1 create gsat-english          # 把輸出的 database_id 填進 apps/api/wrangler.toml
npm run db:migrate:remote -w @gsat/api       # 套用遷移（目前還沒有遷移檔，可先略過）
npx wrangler secret put ANTHROPIC_API_KEY    # 機密一律用 secret put；接上 AI、登入功能時才需要
npm run deploy -w @gsat/api                  # 部署後網址是 https://gsat-english-api.<帳號子網域>.workers.dev
```

部署前把 `apps/api/wrangler.toml` 的 `ALLOWED_ORIGINS` 裡的 `REPLACE_WITH_VERCEL_PROJECT` 換成 Vercel 專案的網址。

**2. 前端（Vercel）**

1. 在 Vercel 匯入這個 GitHub repo，Root Directory 保持 repo 根目錄；安裝、建置指令與輸出目錄都寫在 `vercel.json`，不必在後台另外設定。
2. **把 `vercel.json` 裡兩處 `REPLACE_WITH_SUBDOMAIN` 換成你的 workers.dev 帳號子網域**（Cloudflare 儀表板 Workers & Pages 可以看到），否則 `/api`、`/auth` 會轉到不存在的網址，首頁會顯示「後端未連線」。

`vercel.json` 的設定與理由：

- **rewrites**：`/api/*`、`/auth/*` 反向代理到 Worker。買網域前 `*.vercel.app` 與 `*.workers.dev` 彼此跨站，cookie 登入行不通，代理後瀏覽器看起來是同源。其餘路徑 SPA fallback 到 `/index.html`，但**排除 `/assets/`**：重新部署後舊的 chunk 檔名已不存在，應該回 404，而不是回 HTML 讓瀏覽器當成 JavaScript 執行；前端的錯誤邊界會提示使用者重新整理。
- **headers**：`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options`、`Permissions-Policy`。其中 `camera=(self)` 是為了在網頁內直接開相機拍手寫作文（`camera=()` 會讓 `getUserMedia()` 被拒絕）；麥克風、定位、付款都關閉。`/assets/*` 的檔名帶內容雜湊，給一年 `immutable` 快取；HTML 每次重新驗證，部署後才會立刻拿到新版。
- 還沒實測的部分（05 文件 §1.3）：經 Vercel 代理時 `Set-Cookie` 能否原樣傳回、長時間的 AI 請求會不會逾時。
- Vercel 的預覽部署每次網址不同，不在 `ALLOWED_ORIGINS` 裡，預覽站送出的 POST 會被 Worker 的 Origin 檢查擋下（GET 不受影響）。

**3. 接上自訂網域之後**

1. 在 Cloudflare 購買網域（名稱不能含 `ceec` 或「大考中心」，見 `docs/research/04-data-sources-licensing.md` §0）。
2. 主網域與 `www` → Vercel：在 Vercel 加入網域，再到 Cloudflare DNS 加上 Vercel 指定的 A／CNAME 記錄，**Proxy 關閉（DNS only）**。
3. `api.<網域>` → Worker：取消 `apps/api/wrangler.toml` 中 `[[routes]]`（`custom_domain = true`）的註解後重新部署，DNS 記錄與憑證會自動建立。
4. `ALLOWED_ORIGINS` 加上 `https://<網域>` 與 `https://www.<網域>`。
5. 前端可以繼續走 `vercel.json` 的 rewrites（目的地改成 `https://api.<網域>`），或在 Vercel 設定建置環境變數 `VITE_API_BASE=https://api.<網域>` 改成直接呼叫；兩種做法前端程式碼都不用改。

## 資料與著作權

歷屆試題著作權屬大學入學考試中心，本專案僅供個人學習使用。原始 PDF 不納入版本控制（`data/raw/` 已排除），可用 `tools/fetch_ceec.py` 依清單重新下載。
