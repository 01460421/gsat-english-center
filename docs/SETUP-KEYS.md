# 金鑰設定與後端上線（站主用）

> 2026-10-09。對象：站主。照著做完，「Google 登入＋AI 批改中譯英與作文＋手寫作文拍照 OCR」就會上線。
> 部署流程：[`.github/workflows/worker-deploy.yml`](../.github/workflows/worker-deploy.yml)（檔頭有流程摘要）；設計：[design/ai-auth-mvp.md](design/ai-auth-mvp.md) §5；架構：[ARCHITECTURE](ARCHITECTURE.md) §4、§11。

## 0. 先看這裡

**安全規則**：金鑰只貼在兩種地方——GitHub repo 的 secrets 頁，或 Cloudflare／Google／Anthropic 自己的設定頁。**不要**貼到任何聊天（包括 AI 助理）、issue、PR、commit、截圖或文件裡。GitHub secrets 存進去之後誰都看不到值（只能覆寫），workflow 的 log 也會自動遮罩。

要準備的東西（全部填在 GitHub repo → Settings → Secrets and variables → Actions → Repository secrets）：

| 名稱 | 必填 | 去哪裡拿 | 用途 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 必填 | §1.4 | 部署 Worker、建立 D1 與 Queue、同步機密 |
| `CLOUDFLARE_ACCOUNT_ID` | 必填 | §1.3 | 同上 |
| `GOOGLE_CLIENT_ID` | 登入要 | §2.3 | Google 登入 |
| `GOOGLE_CLIENT_SECRET` | 登入要 | §2.3 | Google 登入 |
| `ADMIN_EMAIL` | 建議 | §2.5（你自己的 Gmail） | 第一次登入時自動成為管理員 |
| `ANTHROPIC_API_KEY` | AI 要 | §3.3 | AI 批改與 OCR |

不需要自己準備的：`SESSION_SECRET`（簽登入 cookie）與 `LEDGER_SALT`（帳本假名）由部署 workflow 第一次執行時自動產生、存在 Cloudflare，之後不會再改。

建議順序（約 30–60 分鐘）：Cloudflare（§1）→ Google（§2）→ Anthropic（§3）→ 填進 GitHub（§4）→ 觸發部署（§5）→ 確認（§6）。

## 1. Cloudflare

### 1.1 方案：建議升級 Workers Paid（每月 US$5）

到 Cloudflare 儀表板 → Workers & Pages（側欄可能叫「Compute (Workers)」）→ Plans。免費方案的 Queue 可以用，但每次呼叫只有 10 ms CPU，AI 批改在解析 Claude 的長回應時可能超過（ARCHITECTURE §1）。只想先測登入可以暫時不升級；AI 開放給學生前請升級。

### 1.2 workers.dev 子網域（只需一次）

Worker 的網址會是 `https://gsat-english-api.<子網域>.workers.dev`，買網域之前 Vercel 會把 `/api`、`/auth` 轉到這裡。

1. 打開 Cloudflare 儀表板 → Workers & Pages。帳號第一次進來時會要求設定子網域；之後可以在概觀頁右側的「Subdomain」看到或修改（直接網址：<https://dash.cloudflare.com/?to=/:account/workers/onboarding>）。
2. 子網域是公開的、會出現在網址裡，不要用真實姓名或電話之類的個資。

沒設定就部署時，workflow 會在「檢查 Cloudflare 帳號與 workers.dev 子網域」這一步停下來並提示。

### 1.3 Account ID（`CLOUDFLARE_ACCOUNT_ID`）

Workers & Pages 概觀頁右側的「Account ID」（或帳號首頁帳號名稱旁的選單 → Copy account ID）。32 個英數字。

### 1.4 API token（`CLOUDFLARE_API_TOKEN`）

1. 右上角頭像 → My Profile → API Tokens → **Create Token**。
2. 範本選 **Edit Cloudflare Workers** → Use template。
3. Permissions 再加兩列（Add more）：
   - `Account` ｜ `D1` ｜ `Edit`（第一次部署要建立資料庫、之後每次套用遷移）
   - `Account` ｜ `Queues` ｜ `Edit`（建立 `ai-tasks`、`ai-tasks-dlq` 兩個佇列，部署時掛上 consumer）
4. Account Resources：Include → 你的帳號（要和 §1.3 的 Account ID 是同一個）。Zone Resources 照範本預設即可（目前沒有用到網域）。
5. Client IP Address Filtering **不要設**（GitHub Actions 的 IP 每次不同）。TTL 可以不設；有設的話到期前要換新。
6. Continue to summary → Create Token → **複製 token**（只顯示這一次），直接貼到 GitHub secret（§4）。

## 2. Google OAuth（登入）

在 Google Cloud Console（<https://console.cloud.google.com>）操作。新版介面叫 **Google Auth Platform**，左側有 Branding、Audience、Clients、Data Access。

### 2.1 建立專案

上方專案選單 → New Project → 名稱例如 `gsat-english-center` → Create，並切換到這個專案。

### 2.2 Branding 與 Audience（同意畫面）

1. Google Auth Platform → Branding（第一次會看到 Get started）：
   - App name：學測英文中心（使用者登入時會看到）
   - User support email：你的信箱
   - Audience：**External**
   - Contact information：你的信箱 → 同意政策 → Create
2. App domain 的首頁、隱私權政策連結可以先不填；「Authorized domains」若被要求填，填 `gsat-english-center.vercel.app`（不被接受就留空：只用基本範圍、不送品牌驗證時不需要）。
3. Data Access：可以不加任何 scope。登入只用 `openid`、`email`、`profile` 三個基本範圍，屬於非敏感範圍，不需要 Google 審查。

### 2.3 建立用戶端（`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`）

1. Google Auth Platform → Clients → **Create client**。
2. Application type：**Web application**；Name：例如 `gsat-english-center production`。
3. **Authorized JavaScript origins**：`https://gsat-english-center.vercel.app`
4. **Authorized redirect URIs**：`https://gsat-english-center.vercel.app/auth/google/callback`
   （一字不差：`https`、沒有結尾斜線。登入流程經 Vercel 轉到 Worker，所以網址是 Vercel 的，不是 workers.dev 的。）
5. Create。畫面會顯示 Client ID 與 Client secret：
   - Client ID（以 `.apps.googleusercontent.com` 結尾）→ GitHub secret `GOOGLE_CLIENT_ID`
   - Client secret（通常以 `GOCSPX-` 開頭）→ GitHub secret `GOOGLE_CLIENT_SECRET`
   - **Client secret 只在建立當下完整顯示一次**，之後只看得到最後 4 碼。忘了複製就在這個用戶端的詳細頁按「Add secret」產生新的，再把舊的停用、刪除。
6. 網址設定改了之後，Google 端可能要幾分鐘才生效。

本機開發（`wrangler dev`）建議另建一個用戶端，origin 用 `http://localhost:5173`、redirect URI 用 `http://localhost:5173/auth/google/callback`，值放 `apps/api/.dev.vars`，不要和正式的混用。

### 2.4 發布（Publish app）

Google Auth Platform → Audience → Publishing status 是「Testing」時只有測試使用者能登入 → 按 **Publish app** → 確認，狀態變成「In production」。只用基本範圍，所以不需要送審，使用者也不會看到「未經驗證的應用程式」警告。

### 2.5 `ADMIN_EMAIL`

填你自己要用來登入的 Google 信箱（例如個人 Gmail）。站上還沒有任何管理員時，這個信箱第一次登入就會自動成為管理員並核准 AI；之後以 Google 帳號 id 為準，改 `ADMIN_EMAIL` 不會讓別人變成管理員。

## 3. Anthropic（AI 批改）

在 Claude Console（<https://platform.claude.com>）操作。

### 3.1 儲值

Settings → Billing：先儲值（API 是預付制，餘額不足時 AI 批改會失敗）。帳號的用量級距決定每月總上限，在 Settings → Limits 看得到。

### 3.2 建 `online` workspace 並設每月上限（建議一定要設）

1. Settings → Workspaces → Create workspace，名稱 `online`（Worker 專用；之後的批次與開發各用自己的 workspace，見 ARCHITECTURE §6.3）。
2. 進入 `online` workspace → Limits：
   - **每月花費上限（spend limit）**：建議 **US$450**，等於 `apps/api/wrangler.toml` 的 `ANTHROPIC_ONLINE_SPEND_LIMIT_USD`。站內自己的預算是月 US$400＋日 US$20，Console 的上限是最後一道防線。
   - 提醒門檻（notification）：例如 US$200、US$350，會寄信給你。
   - 想先用更小的額度試跑：Console 可以設低一點（例如 US$50），碰到上限時 AI 會失敗、全站自動暫停，不會多扣錢。要正式調小，請開發者照 `wrangler.toml` 註解裡「校準月份」的三個數字一起改。
3. Default Workspace 不能設上限，所以金鑰不要建在 Default Workspace。

### 3.3 建 API key（`ANTHROPIC_API_KEY`）

`online` workspace → API keys → Create key → 名稱例如 `gsat-worker` → 複製（以 `sk-ant-api` 開頭，只顯示一次）→ GitHub secret `ANTHROPIC_API_KEY`。

不要用 Admin key（`sk-ant-admin` 開頭）；那是之後對帳用的，只放 GitHub、不給 Worker。

## 4. 填進 GitHub

1. GitHub repo 頁面 → Settings → Secrets and variables → Actions → **New repository secret**。
2. Name 照 §0 表格的名稱（全大寫、一字不差），Secret 貼值（不要加引號、前後不要有空白或換行），Add secret。六個都照做。
3. 之後要換值：同一頁點名稱 → Update secret。

**不想把機密放 GitHub 也可以**：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`ADMIN_EMAIL`、`ANTHROPIC_API_KEY` 可以改在 Cloudflare 儀表板 → Workers & Pages → `gsat-english-api` → Settings → Variables and Secrets → Add 手動設定，**Type 一定要選 Secret**（選 Text 的會在下一次部署時被刪掉）。Worker 要先部署過一次才會出現在列表裡。GitHub 沒設的名稱，workflow 不會刪除或覆蓋 Cloudflare 上的同名機密；兩邊都有時，每次部署以 GitHub 的值為準。

## 5. 觸發部署

1. 這個 workflow 要先在 main 分支上（含這份文件的變更合併進 main 之後），Actions 頁才會出現手動執行的按鈕。
2. GitHub repo → **Actions** → 左側「部署後端（Cloudflare Worker）」→ 右側 **Run workflow** → Branch 選 `main` → Run workflow。
3. 之後 main 上 `apps/api`、`packages/shared`、`data/exams/parsed`、`package-lock.json` 或 workflow 本身有變動時，會自動部署。

workflow 會依序：型別檢查與測試 → 檢查 token 與 workers.dev 子網域 → 建立（或找到）D1 `gsat-english` → 建立（或找到）Queue `ai-tasks-dlq`、`ai-tasks` → 套用資料庫遷移 → 部署 → 同步機密（第一次會產生 `SESSION_SECRET`、`LEDGER_SALT`）→ 部署後確認。整支可以重跑，已經存在的東西不會重建，已經有的 `SESSION_SECRET` 不會被換掉（換掉的話所有人都會被登出）。大約 3–5 分鐘。

## 6. 確認成功

1. **Actions 的執行結果**：每一步都是綠勾。點進這次執行，頁面下方的 **Summary** 有一張表：
   - Worker 網址（`https://gsat-english-api.<子網域>.workers.dev`）與 workers.dev 子網域
   - 登入（auth）、AI 批改（ai）、拍照 OCR（ocr）是否啟用、AI 是否暫停
   - Worker 上有哪些機密（只列名稱）
   - 經 Vercel 代理是否已接上，以及「下一步」
2. **直接打開 Worker**：
   - `https://gsat-english-api.<子網域>.workers.dev/api/health` → `{"ok":true,"service":"gsat-english-api",…}`
   - `https://gsat-english-api.<子網域>.workers.dev/api/features` → 六個金鑰都填了的話是 `{"auth":true,"ai":true,"ocr":true,"aiPaused":false}`
3. **接上 Vercel**：根目錄 `vercel.json` 的兩個 `REPLACE_WITH_SUBDOMAIN` 要換成 §1.2 的子網域（Summary 的「下一步」會寫出完整網址；這一步由開發者改好推到 main，Vercel 會自動重新部署）。完成後：
   - `https://gsat-english-center.vercel.app/api/health` → 和上面一樣的 JSON
   - 網站側欄出現「登入」按鈕
   - **代理實測**（ARCHITECTURE §4.3；只有過渡期有這支，買網域、設了 `PUBLIC_API_ORIGIN` 之後自動關閉）：
     - 瀏覽器先開 `https://gsat-english-center.vercel.app/auth/probe?set=1`，再開 `https://gsat-english-center.vercel.app/auth/probe` → 要看到 `"cookies":{"a":true,"b":true}`（兩個都是 true＝多個 `Set-Cookie` 有原樣轉送，登入才會正常）
     - `…/auth/probe?delay=30`、`…/auth/probe?delay=60` → 分別約 30、60 秒後回 `{"probe":true,"delayed_seconds":…}`（出現錯誤頁就記下大約幾秒）
     - 照片大小：在終端機執行 `head -c 1250000 /dev/zero | curl -sS -X POST -H 'Origin: https://gsat-english-center.vercel.app' --data-binary @- https://gsat-english-center.vercel.app/auth/probe` → `{"probe":true,"bytes":1250000}`
     - 任何一項不通過：照 §9 第一點的對策處理
4. **登入測試**：在網站按登入 → 選你的 Google 帳號（`ADMIN_EMAIL` 那個）→ 回到網站、填完首次設定（同意條款、年齡區間、暱稱）→ 打開 `https://gsat-english-center.vercel.app/admin`：健康檢查的設定項目、資料庫遷移、預算檢查都應該是正常（綠色）。
5. **AI 測試**：寫作 → 中譯英選一題 → 送出批改 → 頁面會每 2 秒更新，通常 1 分鐘內出結果。

## 7. 出錯時看哪裡

先看 GitHub Actions 這次執行裡失敗的那一步（紅叉），錯誤訊息大多會直接說原因。其他地方：

- **Worker 的執行日誌**：Cloudflare 儀表板 → Workers & Pages → `gsat-english-api` → Observability（Logs）。登入、AI 任務、Queue consumer 的錯誤都在這裡（日誌不含學生內容與 email）。
- **Queue**：Cloudflare 儀表板 → Storage & Databases（或 Workers & Pages）→ Queues → `ai-tasks`：看有沒有積壓、consumer 是不是 `gsat-english-api`；`ai-tasks-dlq` 有訊息代表有任務重試 3 次仍失敗。
- **資料庫**：Cloudflare 儀表板 → Storage & Databases → D1 → `gsat-english`。
- **Anthropic**：Claude Console → Usage／Logs、Billing（餘額）、workspace 的 Limits。
- **網站的後台**：`/admin` 的健康檢查與用量。

| 症狀 | 原因 | 怎麼處理 |
|---|---|---|
| Actions 綠燈，但寫「這次略過部署」 | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 都沒設（或名稱打錯） | §1.3、§1.4、§4 |
| 「只設了一個」 | 其中一個名稱打錯或漏填 | 檢查兩個 secret 的名稱 |
| 「頭尾多了空白或換行」 | 貼 secret 時多選到空白或換行 | 重新貼上那個 secret，只貼值本身 |
| 「CLOUDFLARE_ACCOUNT_ID 的格式不對」 | 貼成 email、帳號名稱或 token | §1.3，重新複製 Account ID |
| 「不是有效的 API token」 | 貼錯東西（token 名稱、Global API Key、curl 指令），或 token 被刪 | §1.4 重建 token，貼「只顯示一次」的那串 |
| 「token 有效，但……沒有 CLOUDFLARE_ACCOUNT_ID 這個帳號」 | Account ID 貼錯（例如 Zone ID），或 token 的 Account Resources 選了別的帳號 | §1.3 重新複製 Account ID；或編輯 token 改 Account Resources |
| 「token 有效、帳號也對，但讀不到 Workers 設定」 | token 少了 Workers 權限 | §1.4，用「Edit Cloudflare Workers」範本，加 `D1: Edit`、`Queues: Edit` |
| 「還沒有 workers.dev 子網域」 | 帳號沒註冊過 workers.dev | §1.2，設好後重跑 |
| 「找不到也建立不了 D1」 | token 少了 `D1: Edit` | §1.4 第 3 點，編輯 token 加權限後重跑 |
| 「讀不到 Queue 清單」「建立 Queue 失敗」 | token 少了 `Queues: Edit` | 同上 |
| 「部署前檢查」失敗 | 程式本身的型別或測試錯誤 | 交給開發者；這一步失敗時不會部署任何東西 |
| 「套用 D1 遷移」失敗 | 遷移檔的 SQL 有問題 | 交給開發者；失敗的遷移會自動回滾，舊資料不受影響 |
| 「讀不到 Worker 的機密清單」 | token 權限或暫時的 API 錯誤 | 重跑；這一步刻意不在不確定時產生新的 `SESSION_SECRET` |
| 「/api/health 2 分鐘內都沒有正常回應」 | 剛註冊的子網域 DNS 還沒生效，或 Worker 啟動失敗 | 等幾分鐘重跑；仍失敗就看 Worker 日誌 |
| 警告「登入未啟用：Worker 上缺 …」 | 列出的機密沒設 | §4 補上後重跑 |
| 警告「看起來不像…」「含有引號或空白」 | 貼錯欄位或多複製了東西 | 重新複製、Update secret、重跑 |
| `vercel.app/api/…` 回網頁或 404 | `vercel.json` 還沒指向 Worker，或 Vercel 還沒重新部署 | §6 第 3 點；Vercel 儀表板 → Deployments 看最新一次 |
| Google 畫面「Error 400: redirect_uri_mismatch」 | §2.3 的重新導向 URI 不完全相同 | 一字不差改好，等幾分鐘再試 |
| Google 畫面「存取遭到封鎖」或只有測試使用者能登入 | 還在 Testing | §2.4 Publish app |
| 學校帳號登不進去 | 學校的 Google Workspace 限制第三方應用程式 | 改用個人 Gmail（登入頁也有提示） |
| 登入後回到 `/account?auth_error=state` | 驗證逾時、開太多分頁、瀏覽器擋 cookie | 關掉多餘分頁重試 |
| `auth_error=google` | Google 換 token 失敗，多半是 `GOOGLE_CLIENT_SECRET` 錯或已停用 | 檢查 secret，看 Worker 日誌 |
| `auth_error=not_configured` | 登入相關機密沒設 | 看 Summary 的「Worker 上缺 …」 |
| `auth_error=unverified` | 該 Google 信箱未驗證 | 換帳號或先在 Google 驗證信箱 |
| 用 `ADMIN_EMAIL` 登入了但不是管理員 | 信箱不一致（大小寫不影響），或站上已經有管理員 | 改對 `ADMIN_EMAIL` 重跑 workflow，登出再登入 |
| 送出時出現「請求來源不被允許」（403 `bad_origin`） | 不是從 `https://gsat-english-center.vercel.app` 送的（例如 Vercel 預覽網址） | 預覽網址刻意不能寫入；要用正式網址 |
| AI 任務一直在排隊 | consumer 沒掛上，或每次呼叫都失敗在重試 | 看 Queue 頁與 Worker 日誌 |
| AI 回「AI 暫停」「全站預算」 | 今天的站內預算用完、管理員按了暫停，或碰到 Anthropic 上限 | `/admin` 看用量；Console 看 Limits 與餘額 |
| AI 失敗、日誌有「credit balance is too low」或「usage limits」 | Anthropic 餘額不足或碰到 workspace 上限 | §3.1、§3.2 |
| 日誌有「Exceeded CPU」 | 免費方案的 CPU 上限 | §1.1 升級 Workers Paid |

## 8. 之後的維護

- **換金鑰（外洩或定期輪替）**：
  - Anthropic：Console 建新 key → Update GitHub secret → 重跑 workflow → 確認正常後在 Console 刪掉舊 key。
  - Google client secret：用戶端詳細頁 Add secret → Update GitHub secret → 重跑 → 停用並刪除舊 secret（一個用戶端最多兩組）。
  - Cloudflare token：建新 token → Update GitHub secret → 刪掉舊 token。
  - `SESSION_SECRET`：Cloudflare 儀表板的 Variables and Secrets 刪掉它再重跑 workflow（會自動產生新的），或在本機 `npx wrangler secret put SESSION_SECRET`。**所有人都會被登出**。
  - `LEDGER_SALT`：**不要換**（換了之後帳本與刪除證明的假名就對不上）。
- **拿掉某個功能的金鑰**：先刪 GitHub secret（否則下次部署又會同步回去），再到 Cloudflare 的 Variables and Secrets 刪掉同名機密。
- **調整 AI 預算與名額**：改 `apps/api/wrangler.toml` 的 `[vars]`（和 `src/config.ts` 的預設值一起改，測試會檢查），推到 main 自動部署；Console 的 workspace 上限也要同步改。
- **買網域之後**：照 ARCHITECTURE §4.4 的步驟（`[[routes]]`、`ALLOWED_ORIGINS`、`PUBLIC_API_ORIGIN`、`APP_ORIGIN`、Google 的 redirect URI 加新網址）。

## 9. 已知限制

- 過渡期經 Vercel 代理開放登入與 AI（design/ai-auth-mvp.md §9 的決定），ARCHITECTURE §4.3 列的實測項目（多個 `Set-Cookie` 是否原樣轉送、POST 約 1.2 MB 照片能否通過、逾時上限）還沒在正式環境驗證（部署後用 §6 第 3 點的 `/auth/probe` 實測）。上線後第一次登入與第一次拍照上傳請特別留意；不通過時的對策是提早買網域、前端直連 `api.<網域>`。
- `vercel.json` 已讓 `/api`、`/auth` 的回應不經 Vercel CDN 快取（`x-vercel-enable-rewrite-caching: 0`，Worker 本身也一律回 `Cache-Control: no-store`）。ARCHITECTURE §7 的 Content-Security-Policy 還沒加。
- 部署後確認只看公開端點；登入流程、AI 任務、OCR 要照 §6 第 4、5 點手動試一次。
