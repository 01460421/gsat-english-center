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
| `ANTHROPIC_PARITY_API_KEY` | 打開自訂題目批改前要 | §8.2 | 只給真模型評測用（自訂作文題目評分對照、學習助手國文評測 §8.4 等；dev workspace 的金鑰），不會同步到 Worker |

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
2. Name 照 §0 表格的名稱（全大寫、一字不差），Secret 貼值（不要加引號、前後不要有空白或換行），Add secret。上線要用的六個都照做（`ANTHROPIC_PARITY_API_KEY` 等到 §8.2 再加）。
3. 之後要換值：同一頁點名稱 → Update secret。

**不想把機密放 GitHub 也可以**：`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`ADMIN_EMAIL`、`ANTHROPIC_API_KEY` 可以改在 Cloudflare 儀表板 → Workers & Pages → `gsat-english-api` → Settings → Variables and Secrets → Add 手動設定，**Type 一定要選 Secret**（選 Text 的會在下一次部署時被刪掉）。Worker 要先部署過一次才會出現在列表裡。GitHub 沒設的名稱，workflow 不會刪除或覆蓋 Cloudflare 上的同名機密；兩邊都有時，每次部署以 GitHub 的值為準。

## 5. 觸發部署

1. 這個 workflow 要先在 main 分支上（含這份文件的變更合併進 main 之後），Actions 頁才會出現手動執行的按鈕。
2. GitHub repo → **Actions** → 左側「部署後端（Cloudflare Worker）」→ 右側 **Run workflow** → Branch 選 `main` → Run workflow。
3. 之後 main 上 `apps/api`、`packages/shared`、`data/exams/parsed`、`data/bank/v1/translation`、`data/bank/v1/composition`、`data/unpublish.jsonl`、`package-lock.json` 或 workflow 本身有變動時，會自動部署（Worker 會打包歷屆與本站仿真的中譯英、作文題目文字，所以題庫的寫作題上架或下架也會重新部署）。

workflow 會依序：型別檢查與測試 → 檢查 token 與 workers.dev 子網域 → 建立（或找到）D1 `gsat-english` → 建立（或找到）Queue `ai-tasks-dlq`、`ai-tasks` → 套用資料庫遷移 → 部署 → 同步機密（第一次會產生 `SESSION_SECRET`、`LEDGER_SALT`）→ 部署後確認。整支可以重跑，已經存在的東西不會重建，已經有的 `SESSION_SECRET` 不會被換掉（換掉的話所有人都會被登出）。大約 3–5 分鐘。

## 6. 確認成功

1. **Actions 的執行結果**：每一步都是綠勾。點進這次執行，頁面下方的 **Summary** 有一張表：
   - Worker 網址（`https://gsat-english-api.<子網域>.workers.dev`）與 workers.dev 子網域
   - 登入（auth）、AI 批改（ai）、拍照 OCR（ocr）是否啟用、AI 是否暫停
   - 自訂題目批改（customEssay）是否啟用，以及 `apps/api/wrangler.toml` 的 `AI_CUSTOM_ESSAY` 寫的是什麼。兩者對不起來時有一則「注意」（新版本可能還沒傳到所有節點，幾分鐘後打開 `/api/features` 再確認）；AI 已啟用、自訂題目批改未啟用時有一則「提醒」（評分對照達標、打開之前，或只關自訂題時，這是正常的；§8.1、§8.2）
   - 學習助手（assistant）與學習助手拍照（assistantPhoto）是否啟用，以及 `wrangler.toml` 的 `AI_ASSISTANT`、`AI_ASSISTANT_PHOTO` 寫的是什麼（目前兩個都是 `"on"`，兩列都應該是「啟用」；§8.3）
   - Worker 上有哪些機密（只列名稱）
   - 經 Vercel 代理是否已接上，以及「下一步」
2. **直接打開 Worker**：
   - `https://gsat-english-api.<子網域>.workers.dev/api/health` → `{"ok":true,"service":"gsat-english-api",…}`
   - `https://gsat-english-api.<子網域>.workers.dev/api/features` → 六個金鑰都填了的話是 `{"auth":true,"ai":true,"ocr":true,"aiPaused":false,"customEssay":true,"assistant":true,"assistantPhoto":true}`（`wrangler.toml` 的 `AI_CUSTOM_ESSAY` 是 `"off"` 時 `customEssay` 是 false，§8.1；學習助手關掉或只留給管理員時沒有 `assistant`、`assistantPhoto`，§8.3）
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

### 8.1 只關閉自訂題目批改

英文作文的「自訂題目」（學生自己貼題目送 AI 批改）有自己的總開關 `AI_CUSTOM_ESSAY`（`apps/api/wrangler.toml` 的 `[vars]`；只有 `"on"` 才開，其他任何值都當成關）。程式預設是 `"off"`；2026-10-18 站主決定上線就打開（`wrangler.toml` 寫 `"on"`），同一天照 §8.2 補跑評分對照，結論是「達標」。下面是打開之後，自訂題出問題（例如大量拒答、有人用題目欄做奇怪的事）時的做法：

1. **立即止血**：網站 `/admin` 按「AI 全站暫停」。存在 D1、立刻生效，但歷屆題與本站題的 AI 批改也會一起停；暫停只記在當天，台灣時間隔天 00:00 自動恢復。
2. **只關自訂題**：把 `apps/api/wrangler.toml` 的 `AI_CUSTOM_ESSAY = "on"` 改成 `"off"`，推到 main，等「部署後端（Cloudflare Worker）」跑完（幾分鐘）。
   - 打開這次執行的 **Summary**，確認「自訂題目批改（customEssay）」是**未啟用**、`AI_CUSTOM_ESSAY` 是 `"off"`，而且「注意」裡沒有「對不起來」；也可以直接打開 `/api/features` 看 `"customEssay":false`；
   - 確認之後，再到 `/admin` 解除全站暫停（歷屆題與本站題恢復，自訂題的作答頁只剩自我檢核）；
   - 已經在排隊的自訂題會照常批改完（點數已經預扣）。
3. **不要**在 Cloudflare 儀表板的 Variables and Secrets 改 `AI_CUSTOM_ESSAY`：下一次部署（題庫資料更新也會觸發）會被 `wrangler.toml` 的 `[vars]` 蓋回去。

要重新開啟：改回 `"on"` 推到 main，Summary 應該是「啟用」、沒有「提醒」。關掉之後如果改過提示或計分（`apps/api/src/ai/`），要先照 §8.2 重跑一次評分對照，達標再打開。

### 8.2 打開自訂題目批改（先跑評分對照）

原本的設計是先用真模型跑一次評分對照（同一篇作文分別當成題庫題與自訂題批改，比較兩邊的分數，設計見 [design/custom-essay.md](design/custom-essay.md) §7.8），**結論是「達標」才打開**。2026-10-18 站主決定上線就打開（`wrangler.toml` 已經是 `"on"`），評分對照改成之後補跑的檢查：照下面第 1、2 步跑；**達標**就把結果記進附錄 A，開關不用動；**不達標**就照 §8.1 把開關改回 `"off"`，交給開發者調整提示後重跑。之後改了提示或計分，也照這一節重跑。評分對照在 GitHub Actions 上跑，不用在自己的電腦裝任何東西。

1. **建 dev workspace 和金鑰**（只需一次）：
   - Claude Console → Settings → Workspaces → Create workspace，名稱例如 `dev`（評分對照與開發專用，不要和 Worker 的 `online` 混用）。
   - 進入 `dev` workspace → Limits → **每月花費上限設 US$50**（等於 `apps/api/wrangler.toml` 的 `ANTHROPIC_DEV_SPEND_LIMIT_USD`；評分對照預設最多花 US$45，Console 的上限是最後一道防線）。
   - `dev` workspace → API keys → Create key → 名稱例如 `gsat-parity` → 複製（只顯示一次）→ **直接**貼到 GitHub repo 的 Settings → Secrets and variables → Actions → New repository secret，Name 填 `ANTHROPIC_PARITY_API_KEY`。和其他金鑰一樣，不要貼到聊天、issue、PR 或任何文件裡（§0）。這把金鑰只給評分對照用，部署 workflow 不會把它同步到 Worker。
2. **執行**：GitHub repo → **Actions** → 左側「自訂作文題目評分對照（真模型）」（`.github/workflows/custom-essay-parity.yml` 合併進 main 之後才會出現）→ 右側 **Run workflow** → Branch 選 `main`，三個選項通常不用改：
   - `budget_usd`：累計花費上限（美元，預設 45，最多 100）。「累計」包含之前中斷的那幾次；
   - `allow_online_key`：保持不勾（見下面「沒有 dev workspace 時」）；
   - `resume`：保持勾選，中斷後再按一次會接著跑，已經完成的不會重新花錢。連線錯誤或逾時的那幾篇會重跑；模型拒答、格式不符、截斷的不重跑（它們要算進失敗率，重跑到成功就看不出自訂題比較容易被拒答）。
   - 約 150 次批改，可能要好幾個小時；一次執行最多約 4.5 小時就會停下來存檔（GitHub 的上限是 6 小時），結論會是「還沒跑完」，再按一次 Run workflow 即可。
3. **看結果**：點進這次執行，頁面下方的 **Summary** 第一段就是結論，下面是每一項指標（「達標」欄）與 E 組的評語；完整結果也在頁面最下方的 artifact `custom-essay-parity`（保留 30 天）。
   - **達標**（執行結果是綠勾）：
     1. E 組的評語看一下：不應該以「120 字」為標準（題目要求的字數不同）。
     2. 把 Summary 的彙總交給開發者記進 [design/custom-essay.md](design/custom-essay.md) 的附錄 A（日期、版本、花費、各組結果）。
     3. 開一個 PR 到 main，**只改一行**：`apps/api/wrangler.toml` 的 `AI_CUSTOM_ESSAY = "off"` 改成 `"on"`（`src/config.ts` 不用跟著改）。合併後等「部署後端（Cloudflare Worker）」跑完。
     4. 確認：這次部署的 Summary 寫「自訂題目批改（customEssay）：啟用」、沒有「提醒」；打開 `https://gsat-english-center.vercel.app/api/features` 看到 `"customEssay":true`。之後照 design/custom-essay.md §10 的「部署後確認」用自己的帳號送一篇自訂題試試。
   - **不達標**（紅叉，結論寫「不達標」）：`AI_CUSTOM_ESSAY` 維持 `"off"`，網站照常（自訂題目只能自我檢核）。把 Summary 交給開發者，由開發者調整提示後再重跑（改過提示後 resume 不會沿用舊結果）。
   - **還沒跑完**（紅叉，結論寫「還沒跑完」）：照結論那一段的說明處理——到時間上限、或結論說有幾篇「暫時失敗」，就直接再按一次 Run workflow；到 `budget_usd` 上限就調高一點再按（不要超過 dev workspace 的每月上限）；Console 的上限或餘額不足就先調整 Console；金鑰錯誤就重建金鑰、Update secret。
   - 第一步就失敗、說沒有金鑰：照第 1 步設好 `ANTHROPIC_PARITY_API_KEY` 再按一次。沒有金鑰時 workflow 一定是紅的，不會被當成通過。
   - 「準備題目庫、確認達標判定」那一步失敗（還沒花錢）：通常是本站仿真作文被下架太多（少於 20 題），或某一題被自訂題目的輸入規則拒收；把那一步的訊息交給開發者。
4. **沒有 dev workspace 時**（不建議）：Run workflow 時勾選 `allow_online_key`，會改用正式站的 `ANTHROPIC_API_KEY`（只有沒設 `ANTHROPIC_PARITY_API_KEY` 時才會用）。這筆花費（最多 `budget_usd`）算進 `online` workspace 的每月上限（US$450），但站內預算（月 US$400＋日 US$20）看不到它：同一個月學生用量大時，可能先碰到 Console 的上限，學生的 AI 批改會失敗、全站自動暫停。真的要用，挑月初或用量低的時候，或先把 `budget_usd` 調低。
5. **公開的紀錄**：這個 repo 是公開的，Actions 的 log、Summary 與 artifact 任何人都看得到。結果只有分數、旗標、計數、花費與本站範文的 AI 評語（作文全是本站自己寫的範文），沒有金鑰、學生資料，也沒有官方的參考譯文、評分原則或佳作；金鑰不會出現在 log 裡（GitHub 也會自動遮罩）。
6. 跑完之後 `ANTHROPIC_PARITY_API_KEY` 可以留著（之後改提示要重跑），或在 Console 停用那把金鑰、再刪掉 GitHub secret。

### 8.3 學習助手的開關（已上線；緊急關閉、只留給管理員）

學習助手（設計見 [design/learning-assistant.md](design/learning-assistant.md) §4.14）有兩個開關，都在 `apps/api/wrangler.toml` 的 `[vars]`：`AI_ASSISTANT`（學習助手本身）與 `AI_ASSISTANT_PHOTO`（拍照轉錄題目；學習助手本身也要開放才有用）。值只認三種（去掉頭尾空白、不分大小寫）：

| 值 | 誰能用 | `/api/features` |
|---|---|---|
| `"off"` | 沒有人 | 沒有 `assistant` |
| `"admin"` | 只有管理員（`ADMIN_EMAIL` 的帳號）；緊急時先不讓學生用、管理員在正式站查問題 | 沒有 `assistant`（公開端點不透露）；管理員登入後 `/api/me` 多 `assistant_preview` |
| `"on"` | 所有已核准使用 AI 的學生 | `"assistant":true`（拍照也是 `"on"` 時多 `"assistantPhoto":true`） |

其他任何值（打錯字、`true`、`yes`）都當成 `"off"`，Worker 日誌另外寫一行警告；沒有這一行時程式預設也是 `"off"`。

**目前兩個都是 `"on"`（已上線）**：2026-10-23 站主決定學習助手與拍照都直接開放給已核准的學生，不經管理員預覽，也不先跑真模型評測（設計文件 §6.5）；拍照的殘餘風險（佳作沒有指紋，只靠關鍵字與長度擋，設計文件 §8 第 1 點）站主已經接受。真模型評測與用量檢查改成上線後的監控（設計文件 §6.6 第 7 點）：上線後兩週每天到 `/admin` 看用量頁（依任務分組的點數與費用，每點實際美元＝費用 ÷ 點數，這是平均；第 14 天的中位數要由開發者從 `ai_ops` 逐筆算）與健康檢查的「未確認事件」數（學習助手的 `assist_key_concern`〔AI 對題目答案有疑問〕、`assist_official_like`〔擋下疑似佳作或範文〕等事件也算在裡面），拒答率與截斷率交給開發者從帳本查。每次部署的 **Summary** 都有「學習助手（assistant）」「學習助手拍照（assistantPhoto）」兩列，寫出 `wrangler.toml` 的值，應該都是「啟用」；和 `/api/features` 對不起來時「注意」裡會有一則警告，`admin` 模式會多一則「提醒」。

上線時三份說明（隱私權說明、服務條款、AI 處理說明）同一天改版（2026-10-23）：所有人下次登入要重新同意隱私權說明與服務條款，已核准的學生下次使用 AI 前要重新同意 AI 處理說明（這段期間 AI 批改與學習助手都回「請先同意」，同意流程在 `/ai/apply`）。2026-10-30 學習助手國文與作文範文一起上線，三份說明再升一次版（只升這一次，兩個功能共用；流程相同，見 §8.4、§8.5）。

1. **確認開放**：沒登入打開 `https://gsat-english-center.vercel.app/api/features`，應該有 `"assistant":true` 與 `"assistantPhoto":true`；網站首頁「實戰」群組與側欄出現「學習助手」。
2. **緊急關閉**（大量拒答、費用異常、有人用學習助手做奇怪的事、疑似官方受保護內容外流）：
   1. 立即止血：網站 `/admin` 按「AI 全站暫停」（存在 D1、立刻生效，但作文與中譯英的 AI 批改也會一起停；台灣時間隔天 00:00 自動恢復）。
   2. 只關學習助手：把 `apps/api/wrangler.toml` 的 `AI_ASSISTANT = "on"` 改成 `"off"`，推到 main，等「部署後端（Cloudflare Worker）」跑完（幾分鐘）。只關拍照（貼上題目照常）：把 `AI_ASSISTANT_PHOTO` 改成 `"off"`。想先讓學生用不到、管理員自己在正式站查問題：改成 `"admin"`。部署前的測試不擋這三種值，只改這一行就好；`src/config.ts` 不用跟著改。
   3. 確認：Summary 的那一列是「未啟用」（`admin` 時是「只有管理員能用（admin）」）、「注意」裡沒有「對不起來」；`/api/features` 沒有 `"assistant"`（只關拍照時仍有 `"assistant":true`，但沒有 `"assistantPhoto"`，Summary 是「學習助手拍照（assistantPhoto）」那一列「未啟用」）。確認之後再到 `/admin` 解除全站暫停（作文與中譯英的 AI 批改恢復）。
   4. 已經在排隊的照常完成（點數已經預扣）。學生仍然可以看與刪除自己的案例與報告：導覽與首頁的「學習助手」會消失，但已登入的人打開 `/assistant`（「我的帳號」也有連結）會看到「暫停使用中」的說明與之前的題目，案例頁與學習報告頁可以看、改「懂了嗎」、刪除，送出解析、追問、拍照、產生報告都不會出現；錯題清單與貼上題目的頁面只顯示暫停。
   5. **不要**在 Cloudflare 儀表板的 Variables and Secrets 改這兩個值：下一次部署會被 `wrangler.toml` 的 `[vars]` 蓋回去（同 §8.1 第 3 點）。
3. **重新開放**：問題處理完，把那一行改回 `"on"` 推到 main，Summary 應該是「啟用」、沒有「提醒」，`/api/features` 有 `"assistant":true`。如果改過學習助手的提示（`apps/api/src/ai/prompts/assist-*.ts`），重新開放前最好先在 Actions 跑一次「學習助手真模型評測」（`.github/workflows/assistant-eval.yml`，金鑰同 §8.2 第 1 步的 `ANTHROPIC_PARITY_API_KEY`）。

另外一個相關設定 `SITE_DATA_ORIGIN`：Worker 讀公開題目檔（站內題目、單字）的來源，沒設定就是 `APP_ORIGIN`（正式站）。**正式站不要設**；只有本機的端對端測試會把它指到假的靜態檔伺服器。

### 8.4 學習助手國文的開關與真模型評測（已上線；緊急關閉、只關國文拍照、國寫範文、重產比賽語料指紋、改了提示要重跑評測）

學習助手的國文（設計見 [design/assistant-subjects.md](design/assistant-subjects.md) §7.5、§11 與「國寫範文」一節）有三個開關，都在 `apps/api/wrangler.toml` 的 `[vars]`，值和 §8.3 一樣只認 `"off"`／`"admin"`／`"on"`（其他任何值都當成 `"off"`）：

| 開關 | 控制什麼 | 還要什麼也開放 |
|---|---|---|
| `AI_ASSISTANT_SUBJECTS` | 國文的貼上、解析、追問（英文以外的科目；第一版只有國文） | `AI_ASSISTANT` |
| `AI_ASSISTANT_SUBJECTS_PHOTO` | 國文的拍照 | `AI_ASSISTANT`、`AI_ASSISTANT_PHOTO`、`AI_ASSISTANT_SUBJECTS` |
| `AI_ZH_EXEMPLAR` | 國寫範文：國寫案例看過國寫指導之後的「看一篇 AI 示範」，以及不必先看國寫指導的國寫範文獨立頁（選歷屆國寫或貼上題目；8 點、每天 3 篇、同一題 2 篇） | `AI_ASSISTANT`、`AI_ASSISTANT_SUBJECTS` |

- **目前兩個都是 `"on"`（2026-10-30 上線，和作文範文同一個 PR）**：國文的貼上、解析、追問與拍照都開放給已核准的學生。拍照的照片組（J 組）沒有全部達標，站主決定第一版就開拍照（「拍照也可」）；保護措施（確認畫面的字形題提醒、錯字少於題目暗示的數量時標「不確定」、轉錄看不出題目時退點）與之後要補的手機實拍見 [design/assistant-subjects.md](design/assistant-subjects.md) 的實作備註。`/api/features` 只在 `"on"` 時有 `"assistantSubjects":[{"subject":"chinese","photo":…}]`；`"admin"` 時公開端點不透露，管理員登入後 `/api/me` 的 `assistant_preview` 多一個 `subjects`。每次部署的 **Summary** 有「學習助手國文」「學習助手國文拍照」兩列，寫出 `wrangler.toml` 的值，應該都是「對所有人開放」。
- 上線時三份說明同一次升版（2026-10-30，和作文範文共用這一次；國文的點數不寫在說明裡，調點數不必再升版）：所有人下次登入要重新同意隱私權說明與服務條款，已申請（等核准、候補）或已核准的學生下次使用 AI 前要在 `/ai/apply` 重新同意 AI 處理說明（未滿 18 歲的也要再勾一次已告知父母或監護人）。
- **不需要設定任何金鑰**：國文的 D8 指紋（`data/d8/zh-official.fp.json`、`zh-short.fp.json`）只有雜湊、不帶金鑰，部署時跟著程式一起打包。國文沒有新的 Worker secret，也沒有新的 GitHub secret；評測用的金鑰就是 §8.2 第 1 步的 `ANTHROPIC_PARITY_API_KEY`（沒有時才用正式站的 `ANTHROPIC_API_KEY`）。
- 指紋讀不到（打包壞掉）時，國文的寫入端點在預扣之前一律回「暫停」，不扣點、不會漏放受保護的文字；英文不受影響。
- **國寫範文目前是 `"on"`（2026-10-30 開放）**：站主決定直接開放給已核准的學生、**不跑真模型評測**（評測題目的 K 組已經放進題目集，只能由站主在 Actions 頁面手動執行，見第 1 步）。`/api/features` 只在國文與國寫範文都是 `"on"` 時，國文那一筆多 `"exemplar":true`；`"admin"` 時公開端點不透露，管理員的 `/api/me` 的 `assistant_preview.subjects` 有。部署的 **Summary** 有「學習助手國寫範文（assistantSubjects.exemplar）」一列，應該是「對所有人開放」。條款不必升版（只送案例已存的題目與本站的國寫指導摘要，結果存在學習助手的案例裡；設計「國寫範文」§9.3）。比賽語料指紋（`data/d8/zh-contest.fp.json`）只有雜湊、不帶金鑰，沒有新的 secret；它是國文指紋的必填部分，缺了就整個國文指紋當成讀不到（上一點：寫入端點回「暫停」），萬一到了背景處理才發現，範文以系統錯誤退還點數、不呼叫 AI。部署後第一次請用管理員帳號在一個國寫案例看完國寫指導、按一次「看一篇 AI 示範」確認。上線後的監看看 ops 事件：`assist_zh_exemplar_sensitive`（情意範文寫到住院、過世、自傷、戀愛這類提示禁止的事件；只有操作代號與句數，看不到內容）、`assist_zh_exemplar_overlap`（和比賽作品有一長串相同、重寫後仍隱藏段落）常常出現時交給開發者判斷，嚴重時照第 5 步關閉。

1. **跑真模型評測**（會花 API，**只有站主手動按才會跑**；上線前四次完整評測的結果與 run 連結在 [design/assistant-subjects.md](design/assistant-subjects.md) 實作備註「上線（2026-10-30）」之後幾節；之後改了國文的提示、輸出格式或後處理，由站主決定要不要重跑；GitHub Actions 上跑，不用在自己的電腦裝任何東西）：
   - 站主在 GitHub 的 Actions 頁面選「學習助手國文真模型評測」（`.github/workflows/assistant-subjects-eval.yml`），按 **Run workflow**。輸入：`budget_usd`（累計上限，完整評測約 US$23，建議 25，最多 40）、`allow_online_key`、`resume`、`cases`（空白＝全部；只寫 `A`＝只確認六份輸出格式編譯得過，約 US$0.1；只寫 `K`＝國寫範文的 6 題，各含前置的國寫指導，約 US$2.5，`budget_usd` 填 5）。國寫範文上線時這一組**還沒有跑過**。
   - **不會自動跑**（站主 2026-10-30：不要再自動花 API）：推 `RUN` 檔、改國文的提示都不會觸發；`RUN` 檔只留著當參數說明。開發者（或代理）不能自己觸發評測。
   - 看結果：這次執行頁面下方的 **Summary**：第一行是結論（達標、不達標、還沒跑完），第二行是字音、字形「AI 判斷，請查教育部辭典」的上限要不要解除，第三行是國文拍照能不能開；下面是每一項門檻。完整結果在 artifact `assistant-subjects-eval`（保留 30 天）。結果只有計數、對錯、花費與延遲，不存 AI 寫的文字（這個 repo 是公開的）。
   - **還沒跑完**：到時間或預算上限時結論會寫「還沒跑完」；`resume` 保持勾選、再按一次 Run workflow，已經完成的題目不會重新花錢。
   - **不達標**（已上線，2026-10-30）：把 Summary 交給開發者調整提示、欄位上限或點數後重跑（改過提示後不會沿用舊結果）；情況嚴重時照第 3 步緊急關閉（或第 4 步只關國文拍照）。
2. **確認開放**（2026-10-30 的上線 PR 合併、「部署後端（Cloudflare Worker）」跑完之後）：Summary 的兩列是「對所有人開放」、「注意」裡沒有「對不起來」；沒登入打開 `/api/features` 有 `"assistantSubjects":[{"subject":"chinese","photo":true}]`；再用管理員帳號貼一題、拍一張試試（學習助手首頁有「問國文題」）。以後重新開放也照這一步（`src/config.ts` 不用跟著改）。
3. **緊急關閉國文**（大量拒答、費用異常、疑似官方受保護內容外流）：
   1. 立即止血：網站 `/admin` 按「AI 全站暫停」（同 §8.3；英文的 AI 功能也會一起停，台灣時間隔天 00:00 自動恢復）。
   2. 只關國文：把 `AI_ASSISTANT_SUBJECTS` 改成 `"off"`（或只留給管理員查問題的 `"admin"`），推到 main，等部署跑完。英文的學習助手照常；國文的科目選項與「問國文題」按鈕消失，已有的國文案例照樣可以看、評「懂了嗎」、刪除，新的國文解析與追問不會出現；已經在排隊的照常完成（點數已經預扣）。
   3. 確認：Summary 的「學習助手國文」是「關閉」（`admin` 時是「只有管理員能用」）、「注意」裡沒有「對不起來」；`/api/features` 沒有 `"assistantSubjects"`。確認之後再到 `/admin` 解除全站暫停。
4. **只關國文拍照**（例如轉錄把字形題的錯字改正了）：把 `AI_ASSISTANT_SUBJECTS_PHOTO` 改成 `"off"` 推到 main。國文貼上照常，英文的拍照也不受影響，不用改程式；`/api/features` 的國文那一筆變成 `"photo":false`。
5. **緊急關閉國寫範文**（範文和已發表的作品太像、出現不適合的內容、費用異常、學生拿來交作業的回報）：
   1. 立即止血同第 3 步的 1（「AI 全站暫停」會一起停掉英文與國文的所有 AI 功能）。
   2. 只關範文：把 `AI_ZH_EXEMPLAR` 改成 `"off"`，推到 main，等部署跑完。「看一篇 AI 示範」的按鈕與國寫範文的獨立頁的送出都消失、`POST …/zh-exemplar` 與 `POST /api/assist/zh-exemplars` 回「暫停」（503，不扣點）；導覽、首頁與學習助手首頁的「國寫範文」入口也不見；直接打開 `/zh-writing` 時已登入是唯讀模式（「我的國寫範文」與之前的示範照常可以看與刪除），沒登入只顯示暫停；國寫指導、其他國文功能與英文都照常；**已經產生的範文照常可以看、跟著案例刪除**；已經在排隊的照常完成（點數已經預扣，失敗照樣退還）。
   3. **只留給管理員**查問題：改成 `"admin"`。學生的按鈕消失，管理員登入後照樣看得到、可以產生。
   4. 確認：Summary 的「學習助手國寫範文」是「關閉」（`admin` 時是「只有管理員能用」）、「注意」裡沒有「對不起來」；`/api/features` 的國文那一筆沒有 `"exemplar"`。`src/config.ts` 的程式預設固定是 `off`，不用改。
6. **重產比賽語料指紋**（國寫範文用的 `data/d8/zh-contest.fp.json`；只有站主取得新一年的語文競賽作品集、放進自己電腦上的私人語料目錄時才做；語料是未成年人的作品，**永遠不放進 repo**，repo 裡只有雜湊）：
   1. 在 repo 根目錄跑 `node packages/shared/scripts/zh-contest-fingerprint.mjs --source <語料目錄>`（或先設環境變數 `ZH_CONTEST_SOURCE_DIR` 再跑，不加參數）。腳本只讀年度資料夾裡的 `rank-*.txt`（丟掉第一行的題目），印出的只有每年的篇數與窗口數；筆數低於 25,000 會失敗（代表目錄不完整或讀錯了檔）。
   2. 自我檢查：`node packages/shared/scripts/zh-contest-fingerprint.mjs --check <語料目錄>`，每一篇都要命中（只印每個檔案的命中段數，不印文字）。
   3. `npm run typecheck`、`npm test`、`npm run test:data`、`npm run build`（打包時把指紋併進 Worker；`apps/api/test/assist.zh.exemplar.test.ts` 確認系統提示與真指紋 0 命中）。
   4. **只提交** `data/d8/zh-contest.fp.json`（`git status` 確認沒有任何語料檔被加進來），推到 main 部署。指紋的 `version` 會跟著變，國文的指紋版本（`zh_version`）也會變；英文不受影響。
7. **不要**在 Cloudflare 儀表板的 Variables and Secrets 改這三個值：下一次部署會被 `wrangler.toml` 的 `[vars]` 蓋回去（同 §8.1 第 3 點）。改回 `"on"` 之前，如果改過國文的提示或後處理，先照第 1 步重跑一次評測（國寫範文是 K 組）。

### 8.5 作文範文的開關與真模型評測（目前只開給管理員；緊急關閉、改了提示要重跑評測）

作文範文（輸入或選一個英文作文題目，AI 寫出基礎版、穩健版、頂標版三篇範文；設計見 [design/model-essays.md](design/model-essays.md) §7.5、§9.6）有一個開關 `AI_ESSAY_EXEMPLARS`，在 `apps/api/wrangler.toml` 的 `[vars]`，值和 §8.3 一樣只認 `"off"`／`"admin"`／`"on"`（其他任何值都當成 `"off"`，程式預設也是 `"off"`）。

- **目前是 `"admin"`（2026-10-30）**：上線前的完整評測沒有達標（三個層級的分數帶與層級差、輸出長度，見 [design/model-essays.md](design/model-essays.md) §12.7），範文先只開給管理員，學生看不到入口。`/api/features` 只在 `"on"` 時有 `"essayExemplars":true`；`"admin"` 時公開端點不透露，管理員登入後 `/api/me` 多 `"exemplars_preview":true`。每次部署的 **Summary** 有「作文範文（essayExemplars）」一列，寫出 `wrangler.toml` 的值，現在應該是「只有管理員能用」。說明與條款已經在 2026-10-30 那一次升版寫進作文範文，修好之後改成 `"on"` 不必再升版。
- 不需要新的金鑰：範文用 Worker 既有的 `ANTHROPIC_API_KEY`；評測用 §8.2 第 1 步的 `ANTHROPIC_PARITY_API_KEY`（沒有時才用正式站的金鑰）。
- 上線時三份說明同一次升版（2026-10-30，和學習助手國文共用這一次；作文範文的點數不寫在說明裡）。

1. **跑真模型評測**（會花 API，**只有站主手動按才會跑**；上線前那一次的結果與 run 連結在 [design/model-essays.md](design/model-essays.md) §12.7；修好範文之後、改成 `"on"` 之前由站主決定重跑；不達標時把 Summary 交給開發者）：
   - 站主在 GitHub 的 Actions 頁面選「作文範文真模型評測」（`.github/workflows/exemplars-eval.yml`），按 **Run workflow**。輸入：`budget_usd`（累計上限，完整評測約 US$11，最多 100）、`allow_online_key`、`resume`、`effort_sweep`、`cases`（空白＝B–F 全部；只跑一部分時結論是「部分」，不能當上線門檻）。
   - **不會自動跑**（站主 2026-10-30：不要再自動花 API）：推 `RUN` 檔、改範文的提示都不會觸發；`RUN` 檔只留著當參數說明。
   - 看結果：這次執行頁面下方的 **Summary** 第一行是結論，下面是每一項門檻；完整結果在 artifact（保留 30 天）。結果只有代碼、計數、字數、分數、花費與延遲，不存 AI 寫的文字（這個 repo 是公開的）。
2. **確認開放**（修好、評測達標、把 `wrangler.toml` 改成 `"on"` 推到 main、「部署後端（Cloudflare Worker）」跑完之後）：Summary 的那一列是「對所有人開放」、「注意」裡沒有「對不起來」；`/api/features` 有 `"essayExemplars":true`。上線當天站主用管理員帳號產生 111–115 學測作文 5 題的範文（約 US$1，估計），逐篇讀一次，特別是每一則「這個等級常見的錯」（錯句真的錯、改正句正確、規則正確）；這 5 題之後 0 點。有問題 → 照第 3 步改成 `"admin"`（只留給自己查）或 `"off"`。
3. **緊急關閉**（大量拒答、費用異常、範文看起來像某篇公開佳作、常見的錯寫錯）：
   1. 立即止血：網站 `/admin` 按「AI 全站暫停」（同 §8.3；作文、中譯英的批改與學習助手也會一起停，台灣時間隔天 00:00 自動恢復）。
   2. 只關作文範文：把 `AI_ESSAY_EXEMPLARS` 改成 `"off"`（或只留給管理員查問題的 `"admin"`），推到 main，等部署跑完。已經在排隊的照常完成（點數已經預扣）；學生仍然可以看、回報「這組範文有問題」與刪除之前的範文（範文首頁只剩「我的範文」），寫作各頁的入口消失。英文作文自訂題目的拒收訊息（`custom-essay.ts` 的 `request_to_ai`）是固定文字，關閉期間仍會寫「想看範文請用「作文範文」」；關得久時請開發者把那一句拿掉（只改文字，`CUSTOM_PROMPT_RULES_VERSION` 不變，`writing-custom.spec.ts` 一起改）。
   3. 確認：Summary 的「作文範文」是「關閉」（`admin` 時是「只有管理員能用」，多一則提醒）、「注意」裡沒有「對不起來」；`/api/features` 沒有 `"essayExemplars"`。確認之後再到 `/admin` 解除全站暫停。
4. **不要**在 Cloudflare 儀表板的 Variables and Secrets 改這個值：下一次部署會被 `wrangler.toml` 的 `[vars]` 蓋回去（同 §8.1 第 3 點）。改回 `"on"` 之前，如果改過範文的提示或後處理，先照第 1 步重跑一次評測。

## 9. 已知限制

- 過渡期經 Vercel 代理開放登入與 AI（design/ai-auth-mvp.md §9 的決定），ARCHITECTURE §4.3 列的實測項目（多個 `Set-Cookie` 是否原樣轉送、POST 約 1.2 MB 照片能否通過、逾時上限）還沒在正式環境驗證（部署後用 §6 第 3 點的 `/auth/probe` 實測）。上線後第一次登入與第一次拍照上傳請特別留意；不通過時的對策是提早買網域、前端直連 `api.<網域>`。
- `vercel.json` 已讓 `/api`、`/auth` 的回應不經 Vercel CDN 快取（`x-vercel-enable-rewrite-caching: 0`，Worker 本身也一律回 `Cache-Control: no-store`）。ARCHITECTURE §7 的 Content-Security-Policy 還沒加。
- 部署後確認只看公開端點；登入流程、AI 任務、OCR 要照 §6 第 4、5 點手動試一次。
