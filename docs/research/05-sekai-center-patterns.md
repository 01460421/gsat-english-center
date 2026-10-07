# 05 Sekai Center 架構與慣例研究：新專案可以沿用、需要調整的地方

> 撰寫日期：2026-10-07。
> 研究對象：使用者既有專案 Project SEKAI 資源中心 [SEKAI]。本機唯讀副本在 `/home/user/project-sekai-center`，commit `2f3607a`，只是淺層副本，`git log` 只有這一筆。
> 標記方式：
> - 寫成 `worker/src/auth.js:52-57` 的是 Sekai repo 內的「檔案:行號」，以上面那個 commit 為準。
> - 方括號代號（例如 [CF-D1LIMIT]）是外部一手來源，網址列在第 6 節。
> - 標「本文件試算」的數字是用官方單價自己算出來的，不是官方數字。
> - 標「（未驗證）」的項目沒能用一手來源確認。
> - 標「建議」的段落是對新專案的提案，不是 Sekai 現況。

---

## 0. 重點摘要

1. **整體骨架可以直接搬。** Sekai 的分工是：
   - Vercel 只放靜態前端。
   - Cloudflare Worker 掛在子網域，負責登入、API、AI 代理和管理後台；資料存在 D1。
   - Cron 每分鐘跑背景任務。
   - GitHub Actions 定時建資料並提交回 main。

   這套分工符合新專案的需求，前後端只靠一顆具名 CORS 和一個 session cookie 串起來（`worker/src/api.js:1-8`、`js/app.js:2488-2505`）。
2. **最值得原樣沿用的是安全與成本控管的「做法」，不是程式碼本身。** 包括：
   - 無狀態 HMAC session 加上 `session_ver` 撤銷機制。
   - OAuth 的 state＋nonce cookie，用來防登入 CSRF。
   - 非 GET 請求一律檢查 Origin。
   - 前端不能指定模型。
   - 以「操作」為單位的每日 AI 額度，再加上全站總量上限。
   - 每次 AI 呼叫都記下 token 數與快取用量，並且換算成美元。
   - 把使用者輸入當成不可信資料，不讓它流進管理員 AI 的提示詞。
3. **資料管線的防護值得照抄。** 包括：
   - 守門檢查：資料筆數只增不減。
   - `tools/commit-data.sh` 先只提交資料，再 rebase 重試、重新蓋戳記。
   - 用 `concurrency` 讓同一條排程排隊，不互相取消。
   - 失敗的步驟用 `|| echo` 隔離，不拖垮其他步驟。
4. **前端不要照抄。** Sekai 沒有建置流程：React UMD 加上一支 880 KB、10,855 行的 `js/app.js`，再由 terser 壓縮、自製的 `stamp-assets.py` 蓋版本戳。新專案的互動很多，題型種類也多，建議改用 Vite＋TypeScript。Vite 會自動產生帶雜湊的檔名 [VITE-ASSET]，`stamp-assets` 和 `build-min` 這一整套可以拿掉。
5. **AI 用量模型完全不同。**
   - Sekai 是「通用助手」：前端送 `system`、`tools`、`messages`，Worker 只轉送；平均一次約 2.07 萬 input／1.4 千 output tokens（`worker/src/api.js:52-57`）。
   - 新專案可以分成兩類：
     - **全站共用的內容**（文章、挖空題、解析、範文）：離線批次生成一次，所有學生共用。適合用 Message Batches，費用打五折 [ANT-PRICE]。
     - **個人化批改**（作文、翻譯、手寫 OCR）：改成伺服器端寫死提示詞的「任務型端點」，依題型加權計算額度。
6. **AI 參數要跟著新模型更新。** 審核功能用的強制 `tool_choice`（`worker/src/review.js:184-191`），在 Claude Opus 5.5 會回 400 [ANT-O55]。另外 `pricing.js` 有兩個問題：
   - 快取寫入用的是 5 分鐘 TTL 的單價，但程式實際用 1 小時 TTL，所以帳面低估。
   - 前綴比對會把 `claude-opus-5-5` 算成 Opus 5 的價格，所以帳面高估。

   詳見第 3.4 節。
7. **網域規劃有一個硬性前提：前端和 API 必須在同一個可註冊網域底下。** `vercel.app` 和 `workers.dev` 都在 Public Suffix List 上 [PSL]，兩者之間是跨站。SameSite=Lax 的 cookie 不會跟著 `fetch()` 送出 [MDN-COOKIE]，Safari 也預設封鎖第三方 cookie [WEBKIT-3P]。所以在接上自訂網域之前，「Vercel 預設網址＋workers.dev」的組合登入不了。解法見第 1.3 節。
8. **用 Cloudflare Registrar 買網域，就一定要用 Cloudflare 的 nameserver** [CF-REG]。Vercel 建議不要把 Cloudflare 的反向代理疊在 Vercel 前面 [VC-CF]。所以主網域指向 Vercel 時，那筆 DNS 記錄要設成「DNS only」（灰雲）。API 子網域用 Worker Custom Domain，DNS 和憑證都會自動建立 [CF-CDOM]。
9. **使用者要自己準備的東西**（第 4 節有完整清單和設定順序）：
   - Cloudflare 帳號（建議 Workers Paid，每月 US$5）[CF-WPRICE] 和 API token。
   - Vercel 專案。Hobby 方案只限非商業用途 [VC-HOBBY]。
   - Google OAuth client。在「Testing」狀態下最多只能有 100 位測試使用者 [G-AUD]。
   - Anthropic API key 和儲值。
   - 網域，以及 GitHub repo secrets。

---

## 1. 架構總覽（文字版）

### 1.1 Sekai Center 現況

```
學生／玩家的瀏覽器（PWA：sw.js + manifest.webmanifest）
│
│  https://project-sekai-center.com（主網域；Vercel 靜態站）
│    vercel.json：legacy builds（@vercel/static）＋ routes
│    HTML：max-age=0, must-revalidate；js/ css/ data/ vendor/：一年 immutable＋?v= 內容雜湊戳記
│    app.html → js/app.min.js（核准後才動態載入 js/ai.min.js）
│
│  fetch(GAMES_API + path, { credentials: 'include' })     ← js/app.js:2336, 2491-2505
▼
https://games.project-sekai-center.com（Cloudflare Worker「pjsk-games」，custom_domain = true）
│  worker/src/index.js 的 fetch()：依路徑前綴分派（index.js:264-316）
│   ├─ /auth/*           accounts.js（帳密／QQ，回 JSON）→ auth.js（Google／Discord OAuth，回 HTML 跳轉頁）
│   ├─ /car/*            代理到菜根機器人（HMAC 簽章）
│   ├─ /proxy/hisekai/*  公開唯讀代理（白名單路徑、邊緣快取 30 秒）
│   ├─ /haruki/*, /cal/* 公開唯讀（備援排名、iCalendar）
│   ├─ /api/*            currentUser() → api.js（使用者 API、AI 代理 /api/chat、額度、點數、提問所…）
│   ├─ /admin*           currentUser() → admin.js（審核、用量、問 Claude、診斷、排程）→ dashboard.js（唯讀儀表板）
│   └─ 其他路徑          → Durable Object「GameTracker」（單例、SQLite backend；alarm 每 15 秒抓前百名）
│
│  scheduled()：Cron「* * * * *」（index.js:318-339）
│   ├─ DO 看門狗 /ensure（alarm 重試 6 次就斷，靠它補排）
│   ├─ runWatches（偵測訂閱）
│   ├─ runDueTasks（tasks 表：條件式 UPDATE 搶租約，action 白名單）
│   ├─ flushMail（有 RESEND_API_KEY 才跑）
│   └─ flushPush（有 VAPID 金鑰才跑）
│
├─ D1「pjsk-users」：users / prefs / watches / events / push_subs / admin_log / tasks / tool_log /
│                    chats / chat_messages / ai_credits / ai_orders / ai_ops / apply_ip / …（sql/schema.sql）
└─ 對外：api.anthropic.com/v1/messages（fetch 直呼）、Gemini（選用第二路）、Resend、HiSekai／Haruki API

GitHub Actions（.github/workflows/）
 ├─ ci.yml               PR 與 push main：node --check、單元測試、stamp-assets --check、Playwright 煙霧測試
 ├─ worker-deploy.yml    main 上 worker/** 有變動：測試 → npx wrangler deploy → curl 確認
 ├─ border-snapshot.yml  schedule */30：一次觸發連續取樣 55 分鐘 → 守門檢查 → commit-data.sh
 ├─ billing-refresh.yml  每日 19:17 UTC；ep-songs-refresh.yml 每日 19:40 UTC；og-refresh.yml（push 觸發）
 │      → tools/*.py 重建 data/*.js →（只增不減檢查）→ tools/commit-data.sh →（[skip ci]）push main → Vercel 自動部署
 ├─ worker-push-setup.yml 一鍵產 VAPID 金鑰、寫入 Worker secret
 └─ bot-deploy.yml       Discord 機器人（Workers 版＋GHCR 映像）

網域 project-sekai-center.com（在 Cloudflare 上的 zone）
 ├─ 主網域        → Vercel（repo 沒有記錄實際的 DNS 設定；從 SITE_BASE 和 README「push 到 main 由 Vercel 自動部署」推定）
 ├─ games.        → Worker Custom Domain（wrangler.toml:23-27）
 ├─ bot.          → Cloudflare 固定隧道（菜根機器人，wrangler.toml:80-82）
 └─ session cookie：Domain=.project-sekai-center.com（wrangler.toml:41；auth.js:52-57）
```

佐證：
- 路由分派：`worker/src/index.js:264-316`。
- 排程：`worker/src/index.js:318-339`、`worker/wrangler.toml:18-21`。
- Durable Object：`worker/wrangler.toml:8-16`、`worker/src/index.js:65-243`。
- D1：`worker/wrangler.toml:29-33`、`worker/sql/schema.sql`。
- Vercel 設定：`vercel.json:2-64`（builds）、`vercel.json:65-335`（routes）。
- Durable Object alarm 只重試 6 次，這點 Cloudflare 文件有寫 [CF-ALARM]，Sekai 的說明在 `worker/README.md:60-64`。

### 1.2 新專案（建議）

```
學生的瀏覽器（PWA；Vite＋TypeScript 建置產物，路由分割、題型模組按需載入）
│  https://<網域>、https://www.<網域>   → Vercel（Vite preset；SPA rewrite；DNS only）
│  fetch('https://api.<網域>/…', { credentials: 'include' })
▼
https://api.<網域>（Cloudflare Worker，TypeScript，Custom Domain）
│   ├─ /auth/*    Google OAuth（主要）、Discord（選用）；HMAC session cookie（host-only）
│   ├─ /api/*     使用者 API：作答紀錄、單字複習排程、題庫查詢、設定同步
│   ├─ /api/ai/*  任務型 AI 端點：作文批改（含手寫 OCR）、中譯英批改、單題解析……
│   │             提示詞、評分基準、輸出 JSON schema 全部寫在伺服器端
│   └─ /admin/*   審核、AI 用量與成本、題庫審核（人工把關 AI 生成題）、健康檢查
│  scheduled()：Cron（每日或每小時）：收取 Message Batches 結果、清理過期資料、任務佇列
├─ D1：users / 作答紀錄 / 單字複習 / 題庫（歷屆題＋AI 生成題）/ AI 稽核與用量 / tasks
├─ R2（選用）：手寫作文照片（不要塞進 D1）
└─ api.anthropic.com：官方 TypeScript SDK（支援 Cloudflare Workers runtime [ANT-TS]）

GitHub Actions
 ├─ ci.yml：tsc／lint、Worker 單元與安全測試（node:sqlite 模擬 D1）、Vite build、Playwright 煙霧測試
 ├─ worker-deploy.yml：wrangler d1 migrations apply --remote → wrangler deploy → 部署後確認
 └─ data-*.yml：題本解析、詞頻統計、AI 批次出題（Message Batches）→ 守門檢查 → 匯入 D1 或提交 JSON
```

### 1.3 自訂網域規劃（建議）

| 主機名稱 | 指向 | 設定方式 | 依據 |
|---|---|---|---|
| `<網域>`（主網域） | Vercel | Cloudflare DNS 加一筆 A 記錄，值用 Vercel 網域卡片上顯示的那一個；**Proxy 關閉（DNS only）** | Vercel：主網域用 A 記錄、子網域用 CNAME [VC-DOMAIN]；不建議在 Vercel 前面加反向代理 [VC-CF] |
| `www.<網域>` | Vercel | CNAME，值用 Vercel 給的；DNS only；在 Vercel 設定 www 轉址到主網域（或反過來） | [VC-DOMAIN] |
| `api.<網域>` | Cloudflare Worker | `wrangler.toml` 的 `[[routes]] pattern = "api.<網域>"`、`custom_domain = true`，DNS 記錄和憑證都會自動建立 | [CF-CDOM]；Sekai 範例在 `worker/wrangler.toml:23-27` |

注意事項：

- **網域一定要在 Cloudflare 的 nameserver 上。** 在 Cloudflare Registrar 買的網域不能改用第三方 nameserver [CF-REG]。Worker Custom Domain 也要求 zone 在 Cloudflare 上是 active，而且主機名稱上不能已經有 CNAME 記錄 [CF-CDOM]。
- **cookie 建議用 host-only。**
  - Sekai 把 session cookie 設成 `Domain=.project-sekai-center.com`（`worker/wrangler.toml:41`、`worker/src/auth.js:52-57`），所以主網域的 Vercel 和 `bot.` 也都會收到這個 cookie。
  - 新專案如果只有 `api.` 需要讀 session，可以不設 `Domain`。這樣 cookie 只會送回發出它的主機 [MDN-COOKIE]，曝露範圍比較小。
  - `<網域>` 對 `api.<網域>` 屬於同站，SameSite=Lax 的 cookie 在 `fetch()` 時仍然會送出 [MDN-COOKIE]。
  - 注意：同站子網域照樣可以發出帶 cookie 的 POST，Sekai 也特別提到這點（`worker/src/api.js:250-253`）。所以 Origin 檢查還是要保留。
- **網域名稱不能用 `ceec` 或「大考中心」。** 理由見 `04-data-sources-licensing.md` 第 0 節第 2 點（大考中心商標聲明）。
- **買網域之前的開發期：**
  - `*.vercel.app` 和 `*.workers.dev` 都在 Public Suffix List 上 [PSL]，彼此是跨站，cookie 登入行不通（見第 0 節第 7 點）。
  - 本機開發可以用 Vite 的 `server.proxy` [VITE-PROXY]，把 `/api`、`/auth` 轉到 `wrangler dev`，讓瀏覽器看起來是同源。
  - 線上預覽可以用 Vercel rewrites 反向代理到 Worker（Vercel 原生支援 [VC-CF]）。不過 Set-Cookie 能不能原樣傳回，以及長時間 AI 請求會不會逾時，都要實測（未驗證）。
  - 最簡單的做法是**先買網域**，讓 `api.<網域>` 一開始就上線。

---

## 2. 可以直接沿用的模式

每一項都列出 Sekai 的位置、它在做什麼，以及新專案怎麼用。

### 2.1 OAuth 登入（Google／Discord）與 session cookie

| 做法 | Sekai 位置 | 說明 | 新專案 |
|---|---|---|---|
| 無狀態 session | `worker/src/auth.js:1-9`、`38-50`、`52-57`、`79-85` | cookie 內容是 `base64url(payload).HMAC-SHA256`，payload 為 `{u, v, e}`，有效 30 天，`HttpOnly; Secure; SameSite=Lax`。驗簽時用定時比較（`safeEq`，`auth.js:30-36`） | 原樣沿用 |
| 撤銷機制 | `worker/src/auth.js:65-77`、`worker/sql/017_session_ver.sql`、`worker/src/db.js:37-44` | 每次請求都比對 `users.session_ver`。改密碼或解綁時把版本 +1，舊 cookie 全部失效 | 沿用，改成「登出所有裝置」功能 |
| 登入 CSRF 防護 | `worker/src/auth.js:87-97`、`222-234`、`245-250` | state 簽章裡放一個 nonce，同一個 nonce 也種進只屬於這個瀏覽器的 `oauth_n` cookie（Path=/auth/，10 分鐘），回呼時兩者要對得上；最多保留 3 個 nonce，可以同時開多個分頁登入 | 原樣沿用（SETUP 也有說明：`worker/SETUP.md:178-179`） |
| 回跳安全 | `worker/src/auth.js:174-209` | `safePath` 只接受單一斜線開頭、白名單字元的相對路徑，擋掉開放轉址；回跳頁用嚴格 CSP（`default-src 'none'`），所有插值都會跳脫；用 HTML 頁而不是 302，是為了在同一個回應裡種 cookie | 原樣沿用 |
| Google 交換 | `worker/src/auth.js:101-128`、`257` | scope 為 `openid email profile`，帶 `prompt=select_account`；信箱沒驗證就拒絕 | 沿用。學生常有學校帳號和個人帳號，`select_account` 很重要 |
| Discord | `worker/src/auth.js:132-159`、`215-235`、`263-281` | 沒登入時直接用 Discord 建帳號；已登入時改為綁定，被別的帳號綁走就拒絕，不會把對方清成孤兒帳號 | 選用。scope 建議只要 `identify`，不需要 Sekai 的 `guilds`（`auth.js:137`） |
| 供應商錯誤不回顯 | `worker/src/auth.js:240-242`、`282-286` | 供應商回傳的 error 只比對代碼後顯示自己的文案；例外細節只寫進 log | 原樣沿用 |
| 管理員 bootstrap | `worker/src/db.js:14-33` | `ADMIN_EMAIL` 指定的信箱登入時自動成為管理員並直接核准，不然第一個人會卡在「沒人能核准他」。以 Google `sub` 當識別鍵，不用 email | 原樣沿用 |
| 前端呼叫 | `js/app.js:2488-2505` | 統一用 `api()`：`credentials: 'include'`；錯誤時拋出 `code + message`；`/api/me` 永遠回 200（未登入時是 `{user:null}`，見 `worker/src/api.js:260`、`376-388`） | 沿用，在 TS 裡包成有型別的 client |

### 2.2 帳號申請／核准流程

| 做法 | Sekai 位置 | 說明 |
|---|---|---|
| 狀態機 | `worker/sql/002_approval.sql`、`worker/sql/schema.sql:18-47` | `status`：`pending`→`approved`／`rejected`；另有 `reviewed_by`、`reviewed_at` |
| 核准閘門 | `worker/src/api.js:405-406`、`569-571` | 沒登入回 401。沒核准就一律回 403 加固定錯誤碼 `pending_approval`，前端看到就切到「等待審核」畫面（註解在 `569-570`）。解綁身分、對話存檔、申請這幾支放在閘門之前 |
| 申請端點的防帳單措施 | `worker/src/api.js:441-509`、`44-50` | 冷卻 60 秒、每個帳號最多送 10 次、同一個 IP 一天最多 8 次（`014_apply_ip.sql`）；格式驗證通過才扣次數 |
| 自動核准＋試用額度 | `worker/wrangler.toml:84-96`、`worker/src/api.js:100-102` | `AUTO_APPROVE=1`：外部查證通過就當場核准，`reviewed_by='system:auto'`；這類帳號套用較低的 `AI_OPS_AUTO` 試用額度，等管理員覆核後才升到一般額度 |
| 背景審核 | `worker/src/api.js:502-506`、`worker/src/index.js:342-374`、`worker/src/review.js:342-` | 需要 AI 判斷的工作排進 `tasks`，由 Cron 跑；失敗看得見，也可以重試 |
| 通知管理員的格式 | `worker/src/review.js:228-305` | 先寫「程式碼產生的事實」，再寫「AI 意見（僅供參考）」，最後附「申請者原文（不可信）」；標題只用樣板產生，不讓申請者的字串流進管理員 AI 的快照（二階注入防護） |
| 對申請者只透露粗略狀態 | `worker/src/api.js:148-158`、`178-180` | 不告訴申請者是哪一條標記擋住他，免得他照著改寫 |
| 後台審核 | `worker/src/admin.js:462-480`、`503-514` | 依狀態列出使用者、核准或拒絕；不能取消自己的管理員權限，避免沒人能核准任何人 |

**新專案怎麼用：** 狀態機、閘門、試用額度、背景審核佇列和通知格式都可以原樣沿用。只有「核准依據」要換掉：Sekai 是查遊戲 ID 是否存在（`worker/src/review.js:104-126`），新專案沒有對等的外部資料。可選的做法：

- 邀請碼或班級碼。
- 教師帳號代為核准。
- 自動核准＋試用額度，等人工覆核後再升級。

非 AI 的練習功能（單字卡、歷屆題作答）可以不必登入，只把 AI 功能放在核准閘門後面。理由和 Sekai 一樣：AI 要花錢。

### 2.3 AI 呼叫方式

| 面向 | Sekai 位置 | 做法 |
|---|---|---|
| 金鑰只在後端 | `worker/src/admin.js:268-279`、`js/ai.js:1-4` | Worker 只負責代理 Claude API 和記帳。工具（function calling）在瀏覽器執行，因為計算引擎和資料都在前端 |
| 前端不能選模型 | `worker/src/admin.js:289-300`、`413-427` | 前端只能指定白名單裡的 `profile` 代號，模型和參數由伺服器決定。原註解：「讓前端直接送 model 等於把『要花多少錢』交給任何能打這支 API 的人」 |
| 模型由環境變數決定 | `worker/wrangler.toml:42-58`、`94`；`worker/src/admin.js:23-34` | `AI_MODEL`（助手）和 `AI_REVIEW_MODEL`（審核，Haiku 4.5）分開；換模型不必改程式 |
| Prompt caching | `worker/src/admin.js:309-344` | `tools` 的最後一個和 `system` 各下一個斷點，`ttl: '1h'`。註解記錄了實測依據：121 次呼叫裡有 9 次落在 5 分鐘到 1 小時之間 |
| thinking／effort | `worker/src/admin.js:325-336` | `thinking: {type:'adaptive'}` 搭配 `output_config.effort`，依任務用 profile 覆寫（vision 用 low） |
| 拒答與 fallback | `worker/src/admin.js:209-265`；`bot/src/core/ai.js:24-26`、`80`、`102` | 先檢查 `stop_reason === 'refusal'` 再讀 content；server-side fallback beta 回 400 時拿掉參數重送一次 |
| 錯誤翻成能直接處理的中文 | `worker/src/admin.js:352-368` | 403 分成 `billing_error`（去儲值）和 `permission_error`（金鑰權限不足）；429 和 401 也各有提示 |
| 連線診斷端點 | `worker/src/admin.js:642-749` | 用二分法排查 Workers 打 Anthropic 回 403 的原因；金鑰只顯示前後幾碼 |
| 輸入驗證 | `worker/src/admin.js:281-287`、`394-428`；`worker/src/api.js:768-776` | 限制訊息數、工具數和工具位元組數，body 上限 4 MB（截圖用） |
| 每日操作額度 | `worker/src/api.js:95-129`；`worker/sql/013_ai_ops.sql`；`worker/src/db.js:476-503` | 單位是「操作」：一次提問算一次，裡面跑幾輪工具都不另外計。依台灣時間 00:00 重置（`twDayStart`）。每次操作有 TTL 和最多 60 輪的上限（`touchOp` 用條件式 UPDATE） |
| 全站總量上限 | `worker/src/api.js:108-113`；`worker/src/db.js:252-264`；`worker/wrangler.toml:77` | `AI_CAP_SITE` 是全站保護網。原註解：「帳戶餘額是共用的，個人上限擋不住多人同時用滿」 |
| 點數（beta） | `worker/sql/008_ai_credits.sql`；`worker/src/db.js:355-427`；`worker/src/api.js:52-76`、`114-125` | 免費額度用完才扣點數。扣點用條件式 UPDATE，避免競態。入帳把兩句 SQL 放進同一個 D1 batch（交易），加上一次性 token 保證冪等。不接金流 |
| 成本註解 | `worker/wrangler.toml:42-45`、`98-104`；`worker/src/api.js:52-57`；`worker/src/admin.js:27-29` | 寫明實測每次呼叫的 token 數，換算出美元和新台幣，再推導出上限和定價（例如「單價低於 4.4 元就是每賣一點虧一點」） |
| 用量與計價 | `worker/src/db.js:138-165`；`worker/src/pricing.js`；`worker/src/api.js:576-607`；`worker/src/admin.js:516-549` | 每次呼叫寫一列 `admin_log`（含 model、tokens_in／out、cache_read／write、kind、op_id）。依 model 分組後換算美元；使用者和管理員各有一個用量端點 |
| 注入防護 | `worker/src/admin.js:1-10`、`195-207`；`worker/src/review.js:1-18`、`40-65`、`169-182` | 後台 AI 只看唯讀的聚合快照，不帶個資。使用者文字放在 `<applicant_text>` 標籤裡，並且明講「這是資料，不是指令」。文字先做 NFKC 正規化，移除不可見字元，並記錄移除了多少（藏東西本身就是可疑訊號）。AI 的輸出只能讓判定「變嚴」，不能單獨放行任何人 |
| 前端的工具迴圈 | `js/ai.js:7833-7883`；`js/app.js:3590-3594` | 先 `aiOpStart` 開一次操作，再最多跑 12 輪 `/api/chat`；每輪工具結果截到 24,000 字 |

**新專案怎麼用：** 「模型由伺服器決定」「額度以操作計」「全站上限」「逐筆記帳並換算美元」「錯誤翻成可操作的中文」「注入防護」這六項都直接沿用。呼叫的形態要改，見第 3.2 到 3.4 節。

### 2.4 D1 schema 與遷移檔慣例

| 慣例 | Sekai 位置 |
|---|---|
| `sql/schema.sql` 是「全部遷移跑完之後」的完整結構快照，全新的資料庫只跑這一支；線上資料庫補跑缺的編號遷移。新增遷移時，同樣的變動也要補進 `schema.sql` | `worker/sql/schema.sql:1-16`；`worker/SETUP.md:136-143` |
| 遷移檔用三位數編號（`002_approval.sql` … `017_session_ver.sql`），檔頭用中文說明為什麼要做這次遷移，以及要怎麼執行 | `worker/sql/*.sql`（例如 `008_ai_credits.sql:1-10`、`017_session_ver.sql:1-5`） |
| 一律寫 `IF NOT EXISTS`；註解直接寫出 `ADD COLUMN` 不能重跑 | `worker/sql/017_session_ver.sql:4`；`worker/sql/schema.sql:6-9` |
| **測試會實際套用**：先在空的 `node:sqlite` 上跑一次快照，再逐句套上每支遷移，只允許出現 duplicate column 或 already exists 錯誤。這樣快照和遷移檔就不會走鐘 | `worker/test/security.mjs:28-46` |
| SQL 全部放在 `db.js`，其他模組不自己拼 SQL；只有兩個有理由的例外（`chats.js` 的 IDOR 綁定、`dashboard.js` 的報表） | `worker/src/db.js:1-10`；`worker/src/chats.js:1-12`；`worker/src/dashboard.js:1-15` |
| 時間一律存「秒」（INTEGER），id 用 `crypto.randomUUID()` | `worker/src/db.js:1-6` |
| 每一句都帶 `AND user_id = ?`（防 IDOR）。查得到但不是你的，一律當作 not_found | `worker/src/chats.js:9-12` |
| 用條件式 UPDATE 當鎖（任務租約、扣點、操作輪數），再搭配租約過期回收 | `worker/src/db.js:183-202`、`358-365`、`490-503` |
| 每人上限（防止把 D1 當雲端硬碟） | `worker/src/api.js:37-44`；`worker/src/chats.js:16-25` |
| 健康檢查會回報「哪些設定已設、哪支遷移沒跑」，但只回有或沒有，不回值本身 | `worker/src/dashboard.js:455-479` |

### 2.5 CORS

`worker/src/cors.js` 全檔只有 56 行，可以直接移植。重點如下：

- `allowOrigin` 只放行 `SITE_BASE`、自動推導的 www／非 www 版本，以及本機開發用的 localhost（`cors.js:4-19`）。不允許的 Origin 連標頭都不發。
- 回應一定帶 `Vary: Origin`，避免 CDN 把 A 站的標頭快取給 B 站（`cors.js:21-30`）。
- preflight 回 204，`max-age` 為 86400（`cors.js:32-38`）。
- 帶 cookie 的回應不能用 `*`，所以統一由 `json()` 補上具名的 Allow-Origin，並加上 `no-store`（`worker/src/api.js:1-8`、`78-88`）。
- 會改變狀態的請求都要求 Origin 是本站、Worker 自己或本機。這是為了擋同站子網域發出的 CSRF（`worker/src/api.js:250-257`、`worker/src/admin.js:445-449`）。帳密等敏感端點用更嚴格的 `originIsSite`，預設不放行 localhost（`cors.js:40-56`）。
- 公開唯讀的路由（`/games` 等）才用 `*`，而且不帶 cookie（`worker/src/index.js:37-40`、`269-271`）。

### 2.6 管理後台

| 做法 | Sekai 位置 |
|---|---|
| 未登入和非管理員都回 403，差別寫在 body 的 `error` 欄位 | `worker/src/admin.js:441-444` |
| 「動作」（admin.js）和「唯讀儀表板」（dashboard.js）分成兩個檔案；儀表板的 SQL 會經過 `readOnly()` 強制檢查只能是 SELECT | `worker/src/admin.js:451-456`；`worker/src/dashboard.js:1-15`、`57-63` |
| 端點：使用者清單和審核、設定管理員、點數入帳、全站 AI 用量（每人一列、每日一列、四個時間窗）、問 Claude、診斷、排程任務、工具紀錄 | `worker/src/admin.js:462-793` |
| 排程任務的 action 用白名單，打錯字在建檔時就會被擋下 | `worker/src/admin.js:777-790` |
| 個資最小化：不送 `google_sub`；排行榜只帶名稱 | `worker/src/api.js:160-184`；`worker/src/dashboard.js:11-14` |

**新專案怎麼用：** 整套沿用，再加兩個功能：

- 題庫審核：AI 生成的題目要先經過人工確認才上架。
- 依題型的 AI 成本報表。

### 2.7 GitHub Actions 定時建資料並提交（含防止覆蓋的機制）

| 機制 | Sekai 位置 | 說明 |
|---|---|---|
| 只增不減的守門檢查 | `.github/workflows/border-snapshot.yml:49-80`；`.github/workflows/live-games.yml:52-72`；`README.md:33-48` | 提交前和 HEAD 比對每個檔案的樣本數，筆數變少或檔案消失就讓整個 job 失敗 |
| 腳本自我校驗 | `.github/workflows/ep-songs-refresh.yml:28-31` | 重建結果和舊檔對不上就中止、不寫檔；workflow 不吞這個錯誤 |
| 內容沒變就不寫檔 | `.github/workflows/billing-refresh.yml:3-4`、`30-31` | 大多數日子是空跑，不會產生提交 |
| 共用的提交腳本 | `tools/commit-data.sh:1-72` | 分兩段：先只提交資料檔（`[skip ci]`），rebase 到最新的 main 之後才重算戳記。推送失敗就丟掉戳記提交，重新 rebase，最多 5 次，間隔遞增。不存在的路徑會先剔除（`15-24`），沒有變化就不提交（`26-29`） |
| concurrency | `.github/workflows/border-snapshot.yml:15-17` 等 | `cancel-in-progress: false`，新的觸發會排隊，不會中斷正在跑的那一輪 |
| 權限最小化 | `.github/workflows/border-snapshot.yml:12-13` | 只開 `contents: write` |
| 失敗隔離 | `.github/workflows/billing-refresh.yml:27-67` | 次要步驟用 `\|\| echo "…本輪略過"`，主要步驟才讓它失敗 |
| 大型上游資料的快取 | `.github/workflows/billing-refresh.yml:47-57` | 用上游 HEAD commit 當 actions/cache 的 key，上游沒變的日子就不重抓 34 MB 的檔案 |
| 排程不可靠時的應對 | `.github/workflows/border-snapshot.yml:3-6` | 實測 `*/30` 的實際間隔是 1.5 到 3.5 小時，所以改成一次觸發後在 job 裡連續取樣 |
| 條款風險的註記 | `.github/workflows/live-games.yml:14-28`；`worker/README.md:7-11` | 不把 Actions 當常駐服務用，sub-minute 排程改用 Durable Object alarm |

GitHub 官方文件寫明：排程最短間隔 5 分鐘；高負載時（尤其整點）可能延遲，甚至被丟棄；**公開 repo 連續 60 天沒有活動，排程會自動停用** [GH-SCHED]。新專案的資料管線多半是每日或每週的批次工作，可以用 GitHub Actions；如果某件事時間上很關鍵，就改用 Cloudflare Cron [CF-CRON]。

### 2.8 stamp-assets 快取戳記（要保留的原則，不是工具）

Sekai 的做法：

- HTML 用 `max-age=0, must-revalidate`；`js/ css/ data/ vendor/` 用一年 `immutable`（`vercel.json:176-253`）。
- 用 `?v=<sha256 前 10 碼>` 讓檔案內容一改、網址就跟著變（`tools/stamp-assets.py:1-12`）。
- 程式碼檔裡的動態 import 只更新原本就有的戳記，因為有些網址是刻意不戳的（`stamp-assets.py:50-73`）。
- 壓縮檔的檔頭記著來源檔的雜湊，對不上就失敗（`stamp-assets.py:76-87`、`tools/build-min.py:46`）。
- 最後掃過所有戳記並驗證，`--check` 模式不改檔，只用在 CI（`stamp-assets.py:116-139`、`.github/workflows/ci.yml:20-21`）。
- 需要每天重新驗證的資料檔走 `must-revalidate`，不蓋戳記（`vercel.json:212-218`）。

**新專案：** 原則保留（HTML 每次都重新驗證，帶雜湊的資產給長快取），工具換掉。Vite 建置會自動產生帶雜湊的檔名 [VITE-ASSET]，Vercel 文件也把「帶雜湊的 JS／CSS 用 `max-age=31536000, immutable`」列為標準做法 [VC-CACHE]。`stamp-assets.py`、`build-min.py`、`split-app.py`，以及 `commit-data.sh` 裡的 `restamp` 都不需要了。

### 2.9 CI（語法檢查＋Playwright 煙霧測試）

| 項目 | Sekai 位置 | 新專案 |
|---|---|---|
| 語法檢查 | `.github/workflows/ci.yml:13-15`（`node --check` 逐檔檢查） | 改成 `tsc --noEmit` 加 lint |
| 煙霧測試 | `tests/smoke.mjs:14-57`；`ci.yml:24-30` | 26 頁，桌機（1280×900）和手機（390×844）各開一次。條件是：沒有 `pageerror`、頁面出現關鍵字、手機不能橫向溢出；溢出時把肇事元素印出來（`smoke.mjs:34-50`）。**原樣沿用這套標準**，對每個題型頁和作答流程各跑一次 |
| 假後端 | `tests/smoke.mjs:130-225`；`README.md:75` | 用 `?carmock=` 切換模式，只在 localhost 生效，`tests/` 不會部署。新專案可以改用 Playwright 的 `page.route` 攔截 `/api`，讓煙霧測試不依賴線上 API |
| Worker 安全回歸測試 | `worker/test/security.mjs:1-10`、`47-60`、`70-95` | 在 Node 裡直接 import Worker 的 `fetch` handler；D1 用 `node:sqlite` 模擬（`prepare/bind/first/all/run/batch`）；外部服務用假的 fetch。不需要 wrangler 就能測 OAuth、CSRF、權限。**強烈建議沿用** |
| 部署前測試 | `.github/workflows/worker-deploy.yml:34-38` | 沿用 |

### 2.10 PWA（sw.js、manifest）

- `sw.js` 只有 55 行，策略寫在檔頭（`sw.js:1-4`）：
  - 頁面用網路優先，斷線時退回快取（`19-23`）。
  - 帶 `?v=` 的本站資產用快取優先（`24-26`）。
  - 跨網域請求和需要重新驗證的資料檔一律不碰（`7-8`、`18`）。
  - `install` 時呼叫 `skipWaiting`，`activate` 時清掉舊版快取（`10-13`）。
- Web Push 只送「叮一下」，service worker 收到後自己去 API 拿最新通知，所以推播內容不會經過推播服務（`sw.js:29-55`；`worker/SETUP.md:83-84`）。
- `manifest.webmanifest`：`lang: zh-TW`、`display: standalone`、含 maskable icon（`manifest.webmanifest:1-18`）。
- Vercel 端對 `sw.js` 設 `must-revalidate`，加上 `service-worker-allowed: /`；manifest 指定 `content-type`（`vercel.json:276-291`）。

**新專案：** 沿用，只把「快取優先」的判斷從 `?v=` 改成 Vite 輸出的 `/assets/` 路徑。另外可以加一個功能：把已下載的練習題組和單字卡存起來，供離線作答。作答紀錄先存在本機，連線後再同步。

### 2.11 文件與註解風格

- **註解用繁中，重點寫「為什麼」，也記錄被否決的方案和踩過的雷。** 例如：
  - 為什麼用 DO alarm，不用 Cron 或 GitHub Actions（`worker/src/index.js:1-17`）。
  - id_token 在 `atob` 之後要用 UTF-8 解碼，不然中文名字會亂碼（`worker/src/auth.js:16-24`）。
  - 為什麼快取 TTL 選 1 小時：附實測數據（`worker/src/admin.js:309-318`）。
- **設定檔的註解寫成本推導**，例如「400 次 ≈ $55／人／日」（`worker/wrangler.toml:42-45`）。
- **資料表和遷移檔的檔頭寫用法和陷阱**（`worker/sql/schema.sql:1-16`）。
- **SETUP.md 用勾選清單記錄「已完成／尚未設定」**，並寫明「沒設定時哪些功能會顯示未啟用、哪些不受影響」（`worker/SETUP.md:3-19`）。
- **README 用醒目標題標出「不能做的事」**（`README.md:33-48`）。workflow 檔頭寫明要哪些 secrets、到哪裡設（`.github/workflows/worker-deploy.yml:1-9`）。

---

## 3. 新專案不該照抄或需要調整的地方

### 3.1 前端：改用 Vite＋TypeScript

- **Sekai 現況：** 沒有建置流程。
  - 用 React UMD（`vendor/react*.production.min.js`）。
  - `js/app.js` 有 880 KB、10,855 行，`js/ai.js` 有 563 KB、7,916 行。
  - 載入靠自製的 `support.js` 啟動器（`README.md:71-72`）。
  - 改完程式碼要手動跑 `build-min.py && stamp-assets.py`（`README.md:71`）。
- **問題：** 新專案的互動比較複雜，包括克漏字拖放、文意選填詞性提示、篇章結構、閱讀測驗的圖表與多文本、作文上傳與批改結果標註。題型模組多，型別一致性也很重要（題目 JSON schema 要前後端共用）。
- **建議：**
  - 用 Vite＋TypeScript，按路由分割程式碼。
  - 前端和 Worker 共用一份題目型別定義（例如放在 `packages/shared`）。
  - Vercel 原生支援 Vite；SPA 的深層連結用 `rewrites` 導到 `/index.html` [VC-VITE]。
- **vercel.json：** Sekai 用的是 `builds` 加 `routes`（`vercel.json:2-335`），Vercel 文件說 `builds` 是 legacy 設定，建議改用新的設定項 [VC-JSON]。新專案用 `rewrites` 和 `headers` 就夠了。資安標頭可以照抄 Sekai 那一組（`vercel.json:176-186`：`nosniff`、`referrer-policy`、`permissions-policy`、`x-frame-options`），但要注意相機：
  - Sekai 設的是 `camera=()`。這會讓 `getUserMedia()` 被拒絕 [MDN-PP-CAM]。
  - 如果手寫作文要在網頁內直接開相機拍照，就要改成 `camera=(self)`。
  - 如果只用 `<input type="file" accept="image/*" capture>` 叫出系統相機，是否受這個標頭影響沒有查證（未驗證）。

### 3.2 AI 呼叫架構：從「通用代理」改成「任務型端點」

- **Sekai 現況：**
  - `/api/chat` 是通用代理：`system`（最多 8,000 字）、`tools`、`messages` 都由前端送來（`worker/src/admin.js:394-428`）。
  - 工具在瀏覽器執行，靠前端跑最多 12 輪的迴圈（`js/ai.js:7833-7883`）。
  - 這是為了「站內助手」設計的：計算引擎在前端。
- **新專案不適合這樣做，原因有三：**
  1. 作文批改、翻譯批改、出題，提示詞就是產品本身（評分基準、輸出格式、難度設定）。如果交給前端送，任何已核准的使用者都能把 Worker 當成通用的 Claude 代理。
  2. 批改不需要工具迴圈，一次請求加上結構化輸出就夠了。
  3. 評分結果要存進資料庫，給學習歷程用，所以伺服器必須能驗證輸出格式。
- **建議：**
  - 每個 AI 功能一支端點，例如 `POST /api/ai/essay-grade`、`/api/ai/translation-grade`、`/api/ai/explain-item`。
  - 系統提示詞、評分基準、JSON schema 都在 Worker 內，前端只送學生的作答內容和題目 id。
  - Sekai 的 profile 白名單概念（`worker/src/admin.js:289-300`）延伸成「任務設定表」：每個任務綁定 model、effort、max_tokens、輸出 schema 和額度權重。

### 3.3 AI 用量模型不同

| | Sekai | 新專案（建議） |
|---|---|---|
| 主要用途 | 互動助手，多輪工具迴圈 | (a) 共用內容離線生成；(b) 個人化批改 |
| 每次規模 | 實測平均 in 約 20,700、out 約 1,400 tokens（`worker/src/api.js:52-57`） | 依任務而定，要實測。下面是試算 |
| 計費單位 | 每人每日 20 次「操作」（`worker/wrangler.toml:58`），每次扣 1 點 | 依任務加權。例如作文批改含 OCR 算 3 點、單題解析算 1 點；免費額度和點數都用「點」計 |
| 共用內容 | 無 | 文章、挖空題、文意選填、閱讀測驗、範文：**生成一次、全站共用**，不吃個人額度。用 Message Batches，**input 和 output 都打五折** [ANT-PRICE]，由 GitHub Actions 或 Cron 送出並收取結果，經人工審核後才上架 |
| 快取 | tools＋system，1 小時 TTL | 評分基準和範文庫這類穩定前綴放進 system 並設斷點。Opus 5.5 的最小可快取長度是 512 tokens [ANT-CACHE]，讀快取是 base input 的 0.05 倍 [ANT-PRICE] |
| 計數窗 | 個人：台灣時間的日曆日（`worker/src/db.js:476-483`）；全站：24 小時滾動（`worker/src/db.js:258-264`）；`/api/usage` 的註解卻寫「24 小時滾動窗」（`worker/src/api.js:576-577`），口徑不一 | 統一用台灣時間的日曆日 |

**試算（本文件試算，假設值要實測後替換）：**

- Sekai 一次助手呼叫（in 20,700／out 1,400）：
  - 用 Opus 5 的 $5／$25 per MTok 計算，約 US$0.1385。這和 Sekai 自己的註解一致（`worker/src/api.js:52-54`）。
  - 換成 Opus 5.5 的 $4／$20 [ANT-PRICE]，約 US$0.1108。
- 新專案一次手寫作文批改：
  - 假設 system 加評分基準 3,000 tokens、照片一張、輸出 2,500 tokens。
  - Claude 4.7 以後的模型每張圖最多 4,784 個 visual tokens [ANT-VISION]。
  - 用 Opus 5.5 計算：(3,000＋4,784)×$4 ＋ 2,500×$20，約為 **US$0.081／次**。
- 用 Batches 生成一組克漏字題：
  - 假設 in 3,000／out 4,000。
  - Opus 5.5 的 Batch 價是 $2／$10 [ANT-PRICE]，約為 **US$0.046／組**。
  - 這組題目之後可以給全站所有學生使用。

### 3.4 Claude API 參數與計價需要更新

| 項目 | Sekai 現況 | 為什麼要改 | 新專案 |
|---|---|---|---|
| 強制工具 | 審核用 `tool_choice: {type:'tool', name:'submit_review'}`（`worker/src/review.js:184-191`），模型是 Haiku 4.5，所以目前能用 | Claude Opus 5.5 收到 `tool_choice` 的 `any`／`tool` 會回 400 [ANT-O55] | 改用結構化輸出 `output_config.format`（JSON schema）[ANT-SO]，或 `tool_choice: auto` 搭配 strict tool |
| 關閉思考 | vision profile 用 `thinking: null`，也就是刪掉這個欄位（`worker/src/admin.js:298-299`、`332-335`） | Opus 5.5 的思考不能關閉，只能用 `effort` 控制；預設 effort 是 `medium` [ANT-O55] | 每個任務明確設定 `effort`；需要省錢的任務用 `low` |
| 計價表：快取寫入 | `pricing.js` 的第三欄是「快取寫入（5 分鐘）」單價（`worker/src/pricing.js:1-2`），但 `chatClaude` 用的是 `ttl:'1h'`（`worker/src/admin.js:323`、`342`） | 1 小時快取寫入是 base input 的 2 倍，5 分鐘是 1.25 倍 [ANT-PRICE]。結果帳面會**低估**快取寫入成本 | 依 `usage.cache_creation` 裡 5 分鐘和 1 小時的明細分開計價 |
| 計價表：新模型 | 用前綴比對（`worker/src/pricing.js:30-41`），表裡沒有 `claude-opus-5-5` | `claude-opus-5-5` 會比對到 `claude-opus-5` 的 $5／$25，但實際是 $4／$20，快取讀取 $0.20 [ANT-PRICE]。結果帳面會**高估** | 每個模型 id 都明確列出單價；認不得的 id 記 0 並發出警示（沿用 `pricing.js:38-40` 的理念） |
| 呼叫方式 | Worker 用 `fetch` 直接打 `/v1/messages`，標頭用 `x-api-key`（`worker/src/admin.js:212-238`） | `x-api-key` 仍然支援，但官方已改稱它是 `Authorization: Bearer` 的 legacy fallback [ANT-API]。官方 TypeScript SDK 支援 Cloudflare Workers runtime [ANT-TS]，型別、重試和串流都已經內建 | 用 `@anthropic-ai/sdk` |
| 串流 | 沒有，最多等 120 秒（`worker/src/admin.js:348`） | 作文詳解和範文的輸出比較長。Workers 付費方案不限制 duration，等待 fetch 的時間也不算 CPU 時間 [CF-WLIMIT]、[CF-WPRICE] | 長輸出用 SSE 串流給前端 |
| 雙供應商 | `gemini.js` 的 `runLanes` 雙路並行（`worker/src/api.js:795-797`） | 使用者指定 AI 一律用 Claude | 不搬 `gemini.js`、`runLanes`、`dual` 參數 |
| 控制台網址 | 錯誤提示寫 `console.anthropic.com`（`worker/src/admin.js:361-364`） | 官方文件現在把 Console 寫成 `platform.claude.com` [ANT-API] | 更新文案 |

### 3.5 程式碼層級：不要照抄的細節

1. **`admin.js` 的模組層級變數 `_req`／`_env`**（`worker/src/admin.js:44-52`、`437`）：一個 Workers isolate 可以同時處理很多請求 [CF-WLIMIT]。`await` 之後 `_req` 可能已經被別的請求覆寫，CORS 標頭就會用錯 Origin。改成把 `req`、`env` 明確傳進 `json()`，或者用 closure（`api.js:247` 的 `out` 就是正確寫法）。
2. **遷移要人工執行**：SETUP 要人工跑 `wrangler d1 execute … --file=sql/0xx.sql`（`worker/SETUP.md:145-161`），部署 workflow 不會自動套用（`.github/workflows/worker-deploy.yml:39-44`）。新專案改用 `wrangler d1 migrations apply`：它會在 `d1_migrations` 表記錄哪些遷移已經套用，目錄也可以自訂 [CF-D1MIG]。在部署 workflow 裡先跑遷移、再部署，token 要有 D1 權限（Sekai 也提到 token 可能沒有 D1 權限：`.github/workflows/worker-push-setup.yml:6-7`）。`schema.sql` 快照加上測試比對的做法照樣保留。
3. **執行期自己補建資料表**（`worker/src/push.js:18-24` 的 `ensurePushSchema`）：這是「token 沒有 D1 權限」時的權宜做法，新專案改由遷移統一處理。
4. **`.gitignore` 沒有排除 `worker/.dev.vars`**：Sekai 只排除了 `bot/.dev.vars`（`.gitignore`），但 SETUP 會叫人在 `.dev.vars` 裡設值（`worker/SETUP.md:166`）。Cloudflare 文件要求把 `.dev.vars*` 和 `.env*` 都加進 `.gitignore` [CF-SECRET]。
5. **wrangler 沒有鎖版本**：`worker/` 沒有 `package.json`，部署直接用 `npx --yes wrangler`（`.github/workflows/worker-deploy.yml:44`）。新專案把 wrangler 寫進 `package.json` 並提交 lockfile。
6. **安全測試沒有在 PR 上跑**：`security.mjs` 只在部署 workflow 裡跑（`worker-deploy.yml:38`），`ci.yml` 沒有。新專案要讓它在每個 PR 都跑。
7. **煙霧測試依賴線上資料**：劇場頁要等真實的逐局資料載入（`tests/smoke.mjs:82-104`），上游出問題時 CI 就會紅。新專案預設用假後端。
8. **登入方式太多**：Sekai 有 Google、Discord、帳密（PBKDF2 210,000 次，另有純 JS 備援，見 `worker/src/passwords.js:1-8`）、QQ 綁定，以及機器人橋接（`accounts.js`、`car.js`、`bridge.js`）。這些都是為了車隊社群做的，新專案先只做 Google（Discord 選用），不做密碼，攻擊面比較小。
9. **跟遊戲有關的模組不要搬**：Durable Object 逐局追蹤器、`/proxy/hisekai`、`/haruki`、`/cal`、`watch.js` 偵測訂閱、提問所。Cron 只留任務佇列；DO 等到真的需要（例如即時對戰或精準限流）再考慮。
10. **`prefs` 存 JSON KV**（`worker/src/db.js:61-77`；上限 256 KB／200 個鍵，見 `worker/src/api.js:40-44`）：適合存「設定」，不適合存「作答紀錄」。作答紀錄要拿來做錯題分析、間隔重複和弱點統計，所以要建正規化的資料表。
11. **AI 稽核表直接存原文**：`admin_log` 存 prompt（最多 4,000 字）和 reply（最多 8,000 字）（`worker/src/db.js:140-143`）。新專案的使用者多是未成年的高中生，作文和手寫照片屬於個人資料。建議：
    - 作文和批改結果放在專用的資料表，設定保存期限，讓使用者可以自己刪除。
    - 稽核表只存 token 數、任務種類和題目 id，不存全文，也不存圖片。
    - 照片放 R2 或者用完即丟，不要放進 D1。D1 單列上限是 2 MB [CF-D1LIMIT]。
    - 隱私權政策等法遵細節不在本文範圍，要另外處理（未驗證）。
12. **收費與 Vercel 方案**：Sekai 有點數 beta，用人工對帳，不接金流（`worker/sql/008_ai_credits.sql:3-7`）。如果新專案要收費，Vercel Hobby 只限非商業、個人使用，任何商業用途都要 Pro 以上 [VC-HOBBY]、[VC-FAIR]。

### 3.6 題庫資料量較大：資料放在哪裡

- **Sekai 現況：** 資料建成 `data/*.js`，提交進 git，由 Vercel 當靜態檔供應；每次提交都會觸發 Vercel 重新部署（`README.md:52`）。
- **新專案的資料量：**
  - 原始 PDF 已經排除在版控之外（`data/raw/`）。
  - 歷屆題的結構化 JSON：學測 83–115、指考 91–110。
  - AI 生成題會持續成長。
  - 還有每個學生的作答紀錄。
- **建議分三層：**
  1. **公開、穩定、比較小的參考資料**（詞彙表 Level 1–6 的索引、歷屆題結構化 JSON 的摘要）：建置時打包，或放成靜態 JSON，享有 immutable 快取。
  2. **題庫本體與 AI 生成題**：放進 D1。限制如下 [CF-D1LIMIT]：
     - 單一資料庫最大 10 GB（付費）或 500 MB（免費）。
     - 單列最大 2 MB。
     - 單一 SQL 敘述最長 100 KB。
     - 每次查詢最多 100 個綁定參數。
     - 每次 Worker 呼叫最多 1,000 次查詢（付費）或 50 次（免費）。

     所以批次匯入要分段處理。
  3. **使用者資料**：D1；照片放 R2。
- **AI 生成題的保護：** Sekai 保護「時間過了就補不回來」的資料。新專案對應的是「重新生成要花錢」的 AI 題目和經過人工審核的成果。沿用「只增不減」的守門思路：題目只能新增版本或標成下架，不直接覆寫，而且每筆都記錄 model、prompt 版本和審核人。
- **頻繁部署的問題：** 如果資料管線改成寫進 D1，就不會因為提交資料而觸發 Vercel 重新部署。Sekai 用的 `[skip ci]` 能不能阻止 Vercel 部署，這裡沒有查證（未驗證）。

---

## 4. 部署時使用者需要自己準備的東西（對照 Sekai 的 SETUP）

### 4.1 清單

| # | 項目 | 用途 | Sekai 對照 | 新專案怎麼設定 | 備註 |
|---|---|---|---|---|---|
| 1 | **Cloudflare 帳號** | Worker、D1、網域、DNS | `worker/README.md:16-35` | 建議開 **Workers Paid**（每個帳號每月最低 US$5）[CF-WPRICE] | 免費方案每次呼叫只有 10 ms CPU，付費方案預設 30 秒、最高 5 分鐘 [CF-WLIMIT]。D1 免費上限 500 MB，付費 10 GB [CF-D1LIMIT]。Sekai 也是因為 CPU 不夠才升級付費（`worker/README.md:25-27`） |
| 2 | **網域** | 正式網址 | `project-sekai-center.com` | Cloudflare Registrar 購買後一定使用 Cloudflare nameserver [CF-REG] | 名稱不能含 `ceec` 或「大考中心」（見 04 文件） |
| 3 | **Cloudflare API token＋Account ID** | GitHub Actions 部署 Worker、套用 D1 遷移 | `.github/workflows/worker-deploy.yml:5-9` | 用「Edit Cloudflare Workers」範本建立 token [CF-TOKEN]，Account 選自己的帳戶、Zone 選新網域；**另外加 D1 編輯權限**（因為部署時要跑遷移）。存成 repo secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | Account ID 在儀表板 Workers & Pages 的右側欄（`worker-deploy.yml:8`） |
| 4 | **D1 資料庫** | 使用者、作答、題庫 | `worker/wrangler.toml:29-33` | `npx wrangler d1 create <名稱>` [CF-WRD1]，把 `database_id` 填進 `wrangler.toml` | Sekai 把 `database_id` 直接提交在 `wrangler.toml` 裡（`worker/wrangler.toml:33`） |
| 5 | **Worker secrets** | 機密設定 | `worker/wrangler.toml:35-37`；`worker/SETUP.md:7-11` | 用 `wrangler secret put` 設定：`SESSION_SECRET`（長隨機字串）、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`ANTHROPIC_API_KEY`、`ADMIN_EMAIL`；選用的有 `DISCORD_CLIENT_ID`／`DISCORD_CLIENT_SECRET`、`RESEND_API_KEY`、`VAPID_*` | 非機密的放 `[vars]`：`SITE_BASE`、`OAUTH_BASE`、AI 模型和額度（見 `wrangler.toml:38-106`）。本機開發的值放 `.dev.vars`，不能提交 [CF-SECRET]。Sekai 的 `[vars]` 裡沒有 `GOOGLE_CLIENT_ID` 和 `ADMIN_EMAIL`，推定是用 secret 或儀表板設定的 |
| 6 | **Vercel 專案** | 前端 | `README.md:50-52` | 匯入 GitHub repo，Framework preset 選 Vite [VC-VITE]，在 Domains 加上主網域和 www [VC-DOMAIN] | **Hobby 只限非商業、個人使用**，要收費就要 Pro [VC-HOBBY]、[VC-FAIR] |
| 7 | **DNS 記錄** | 網域指向 | （repo 沒有記錄） | 主網域 A 記錄和 www CNAME 指向 Vercel，**DNS only**；`api.` 由 Worker Custom Domain 自動建立 | [VC-DOMAIN]、[VC-CF]、[CF-CDOM] |
| 8 | **Google OAuth client** | 登入 | `worker/SETUP.md:10` | Google Cloud Console：建立專案 → 設定 OAuth 同意畫面（Audience）→ Clients → Create Client → 選 **Web application** → Authorized redirect URI 填 `https://api.<網域>/auth/google/callback` [G-WEB] | 「Testing」狀態最多 100 位測試使用者；按下「Publish app」才是 In production [G-AUD]。學生的學校 Google Workspace 帳號可能被管理者限制使用第三方 App [G-AUD] |
| 9 | **Discord OAuth**（選用） | 登入或綁定 | `worker/SETUP.md:40-49` | Discord Developer Portal 建立 application → OAuth2 → Redirects 加上 `https://api.<網域>/auth/discord/callback` | scope 只要 `identify` |
| 10 | **Anthropic API** | 所有 AI 功能 | `worker/SETUP.md:11`；`worker/src/admin.js:359-364` | Console（`platform.claude.com`）建立帳號 → Billing 儲值或設定付款 → 建立 API key → 存成 Worker secret `ANTHROPIC_API_KEY`。如果批次出題在 GitHub Actions 跑，也存一份到 repo secret | 403 `billing_error` 代表沒有餘額（`admin.js:359-361`）。Console 提供 workspace [ANT-API]；用量上限和告警的具體設定方式未查證（未驗證）。站內再用 `AI_CAP_SITE` 做第二道保護 |
| 11 | **Resend**（選用） | Email 通知 | `worker/SETUP.md:23-35`；`worker/src/mail.js:1-17` | 註冊後加入網域並完成 DKIM、SPF、MX 驗證 → `RESEND_API_KEY`；`MAIL_FROM` 要和驗證過的網域一致 | 免費方案每月 3,000 封、每日 100 封 [RESEND] |
| 12 | **Web Push**（選用） | 複習提醒 | `worker/SETUP.md:53-84`；`.github/workflows/worker-push-setup.yml` | 可以照抄 Sekai 的一鍵 workflow | |
| 13 | **GitHub repo 設定** | CI 與資料管線 | 各 workflow 檔頭 | Secrets 照上面填；資料提交的 workflow 要有 `permissions: contents: write` | 公開 repo 連續 60 天沒有活動，排程會停用 [GH-SCHED] |

### 4.2 建議的設定順序

1. 買網域（Cloudflare Registrar），確認 zone 是 active。
2. 升級 Workers Paid，建立 D1，把 `database_id` 寫進 `wrangler.toml`。
3. 建 Cloudflare API token（Workers 加 D1 權限），連同 Account ID 存成 GitHub secrets。
4. 建 Google OAuth client，redirect URI 填 `https://api.<網域>/auth/google/callback`。
5. 設定 Worker secrets：`SESSION_SECRET`、`GOOGLE_*`、`ADMIN_EMAIL`、`ANTHROPIC_API_KEY`。
6. 推上 main，觸發 `worker-deploy`：先套用遷移，再部署，最後用 `curl https://api.<網域>/api/me` 確認回 `{"user":null}`。
7. 建 Vercel 專案並加上自訂網域；在 Cloudflare DNS 加 A 和 CNAME 記錄，都設成 DNS only。
8. 用 `ADMIN_EMAIL` 那個帳號登入，確認自動成為管理員並已核准（Sekai 的驗證方式：`worker/SETUP.md:10`、`132`）。
9. 打開後台健康檢查（仿照 `worker/src/dashboard.js:455-479`），確認各項設定都已啟用。
10. 選用：Discord、Resend、Web Push。

部署後要注意：Worker 部署完有 1 到 2 分鐘的傳播時間（`worker/SETUP.md:126`）；新增或修改 Cron 最多要 15 分鐘才會生效 [CF-CRON]。

常用檢查指令（照抄 `worker/SETUP.md:128-134`）：

```bash
npx wrangler secret list
npx wrangler d1 execute <DB 名稱> --remote --command "SELECT name,status,is_admin FROM users"
npx wrangler tail
```

---

## 5. 沿用對照表（新專案的骨架建議）

| Sekai 檔案 | 新專案對應 | 處理方式 |
|---|---|---|
| `worker/src/auth.js` | `worker/src/auth.ts` | 移植成 TS；拿掉 Discord 的 `guilds` scope；cookie 改成 host-only |
| `worker/src/cors.js` | `worker/src/cors.ts` | 幾乎原樣移植 |
| `worker/src/db.js` | `worker/src/db/*.ts` | 沿用「SQL 集中、IDOR 綁 `user_id`、時間存秒、條件式 UPDATE 當鎖」 |
| `worker/src/api.js` 的 `startOp`、`readJson`、`json`、Origin 檢查 | `worker/src/api/*.ts` | 沿用；額度改成加權點數 |
| `worker/src/admin.js` 的 `chatClaude`、`validateChat` | `worker/src/ai/*.ts` | **重寫**成任務型端點，改用 SDK、結構化輸出和串流 |
| `worker/src/pricing.js` | `worker/src/ai/pricing.ts` | 沿用架構；更新單價；區分 5 分鐘和 1 小時的快取寫入 |
| `worker/src/review.js` | `worker/src/review.ts` | 沿用「程式決定、AI 只讀自由文字、注入防護」；換掉核准依據 |
| `worker/src/dashboard.js` | `worker/src/admin/dashboard.ts` | 沿用 `readOnly` 和健康檢查 |
| `worker/sql/schema.sql`＋`0xx_*.sql` | `worker/migrations/0001_init.sql`…＋`schema.sql` 快照 | 改用 `wrangler d1 migrations` |
| `worker/test/security.mjs` | `worker/test/*.test.ts` | 沿用 `node:sqlite` 模擬 D1 的做法 |
| `tests/smoke.mjs` | `web/tests/smoke.spec.ts` | 沿用判斷標準（JS 錯誤、關鍵字、手機溢出） |
| `tools/commit-data.sh` | `tools/commit-data.sh` | 拿掉 `restamp`，其餘沿用 |
| `tools/stamp-assets.py`、`build-min.py`、`split-app.py` | （不需要） | 由 Vite 取代 |
| `sw.js`、`manifest.webmanifest` | `web/public/sw.js`、`web/public/manifest.webmanifest` | 沿用策略，改成判斷 `/assets/` 路徑 |
| `worker/src/index.js` 的 DO、`haruki.js`、`car.js`、`watch.js`、`gemini.js`…… | （不搬） | 和新專案無關 |

---

## 6. 參考來源

**使用者既有專案**

- [SEKAI] Project SEKAI 資源中心：https://github.com/01460421/project-sekai-center（本機副本 `/home/user/project-sekai-center`，commit `2f3607a`；文中的「檔案:行號」都以這個副本為準）

**Cloudflare**

- [CF-WPRICE] Workers Pricing：https://developers.cloudflare.com/workers/platform/pricing/
- [CF-WLIMIT] Workers Limits：https://developers.cloudflare.com/workers/platform/limits/
- [CF-D1LIMIT] D1 Limits：https://developers.cloudflare.com/d1/platform/limits/
- [CF-D1MIG] D1 Migrations：https://developers.cloudflare.com/d1/reference/migrations/
- [CF-WRD1] Wrangler D1 commands（`d1 create`、`d1 migrations apply`）：https://developers.cloudflare.com/workers/wrangler/commands/d1/
- [CF-CRON] Cron Triggers：https://developers.cloudflare.com/workers/configuration/cron-triggers/
- [CF-CDOM] Custom Domains：https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- [CF-ALARM] Durable Objects Alarms：https://developers.cloudflare.com/durable-objects/api/alarms/
- [CF-SECRET] Workers Secrets：https://developers.cloudflare.com/workers/configuration/secrets/
- [CF-TOKEN] Create API token：https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- [CF-REG] Cloudflare Registrar FAQ：https://developers.cloudflare.com/registrar/faq/

**GitHub**

- [GH-SCHED] Events that trigger workflows：https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

**Vercel**

- [VC-HOBBY] Vercel Hobby Plan：https://vercel.com/docs/plans/hobby
- [VC-FAIR] Fair use guidelines：https://vercel.com/docs/limits/fair-use-guidelines
- [VC-DOMAIN] Adding a domain：https://vercel.com/docs/domains/working-with-domains/add-a-domain
- [VC-CF] Using Cloudflare with Vercel：https://vercel.com/guides/using-cloudflare-with-vercel
- [VC-VITE] Vite on Vercel：https://vercel.com/docs/frameworks/frontend/vite
- [VC-JSON] vercel.json：https://vercel.com/docs/project-configuration/vercel-json
- [VC-CACHE] Cache-Control headers：https://vercel.com/docs/caching/cache-control-headers

**Vite**

- [VITE-ASSET] Static Asset Handling：https://vite.dev/guide/assets（原始檔 https://github.com/vitejs/vite/blob/main/docs/guide/assets.md）
- [VITE-PROXY] server.proxy：https://vite.dev/config/server-options#server-proxy

**Anthropic**

- [ANT-PRICE] Claude Pricing：https://platform.claude.com/docs/en/about-claude/pricing
- [ANT-O55] Migrating to Claude Opus 5.5：https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
- [ANT-SO] Structured outputs：https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- [ANT-CACHE] Prompt caching：https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- [ANT-VISION] Vision：https://platform.claude.com/docs/en/build-with-claude/vision
- [ANT-API] API overview：https://platform.claude.com/docs/en/api/overview
- [ANT-TS] Anthropic TypeScript SDK：https://github.com/anthropics/anthropic-sdk-typescript

**瀏覽器與網域標準**

- [MDN-COOKIE] Set-Cookie（MDN）：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
- [MDN-PP-CAM] Permissions-Policy: camera（MDN）：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/camera
- [WEBKIT-3P] Full Third-Party Cookie Blocking：https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- [PSL] Public Suffix List：https://publicsuffix.org/list/public_suffix_list.dat

**Google 與 Resend**

- [G-WEB] Google OAuth 2.0 for Web Server Applications：https://developers.google.com/identity/protocols/oauth2/web-server
- [G-AUD] Google Cloud：Manage App Audience：https://support.google.com/cloud/answer/15549945
- [RESEND] Resend Pricing：https://resend.com/pricing
