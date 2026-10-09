# 登入＋AI 批改 MVP：契約與分工

> 2026-10-08。目標：站主填好金鑰（Cloudflare、Anthropic、Google OAuth）後，「Google 登入＋AI 批改中譯英與作文＋手寫作文拍照 OCR」可以用。
> 這份文件是 4 個平行 agent 的共同契約：型別以 `packages/shared/src/{account,writing,features}.ts` 為準，文件與程式不一致時以程式為準並回頭改文件。
> 上游設計：[SPEC](../SPEC.md) §6.8、§6.9、§8、§9；[ARCHITECTURE](../ARCHITECTURE.md) §3.4、§5、§6、§10、§11；[DB_SCHEMA](../DB_SCHEMA.md) §3.4、§3.6、§3.7。

## 0. 摘要

- 骨架已就位：共用型別、Worker 的 env／config／路由（全部 501）、Queue 綁定、前端路由 stub、`api()` 包裝與 `useFeatures()`／`useMe()`。
- 每個檔案只有一位負責人（§6）。要改別人的檔案，先在交接訊息裡說明，不要直接改。
- `@anthropic-ai/sdk@0.132.1` 支援 `output_config.effort`、`output_config.format`、`fallbacks: "default"` 與 beta 標頭 `server-side-fallback-2026-07-01`，**直接用 SDK，不需要改原生 fetch**（§7）。
- 和上游文件不同的決定列在 §9（重要：作文四項各 0–5；手寫作文 MVP 共 9 點；過渡期就開放 AI 與照片上傳）。

## 1. MVP 範圍

### 1.1 做

| 區塊 | 內容 |
|---|---|
| 登入 | ARCHITECTURE §5 全部：Google OAuth（`openid email profile`、`prompt=select_account`、拒絕未驗證信箱）、`__Host-gsat_sid` HMAC cookie（30 天，剩 7 天自動換新；換新沿用原 `iat`）、`session_ver` 撤銷、`__Host-gsat_oauth` nonce（10 分鐘、最多 3 個）、`safePath`、`ADMIN_EMAIL` bootstrap、首次登入同意條款＋年齡區間＋暱稱、條款改版重新同意 |
| 帳號 | `GET/PATCH /api/me`、`POST /api/me/consents`、`POST /auth/logout`、`POST /auth/logout-all`、`DELETE /api/me` 與 `GET /api/me/export`（10 分鐘內登入過） |
| AI | `POST /api/ai/apply`、`GET /api/ai/quota`、提交 CRUD（`/api/submissions`，kind ＝ translation｜essay）、`POST /api/ai/translation-grade`、`POST /api/ai/essay-grade`、`POST /api/ai/essay-ocr`、`GET /api/ai/ops/{id}`、`PUT /api/submissions/{id}/confirm`。全部走 Queue `ai-tasks`＋前端輪詢（ARCHITECTURE §3.4）。點數、每日篇數、同時任務數、全站美元預算用 DB_SCHEMA §3.7 的原子預扣；價格表 §6.5；呼叫規則 §6.2；兩位評分者＋差距過大加第三位 |
| 手寫照片 | 不用 R2。前端縮到長邊 ≤1600 px、JPEG、每張 ≤1.2 MB、最多 2 張，**一次上傳一張**；後端暫存在 D1（遷移 0002），OCR 完成或學生確認後立即刪除；最長 24 小時，每次上傳時與 housekeeping（/api 請求後、Queue consumer；§10「A2 第二輪審查修正」）順手清過期列 |
| 後台 | `/api/admin/health`（設定只回布林、遷移狀態、§6.3 啟動檢查）、`/api/admin/users`（列表、approve／reject／waitlist／suspend／unsuspend）、`/api/admin/ai/pause`、`/api/admin/usage`（簡單彙總）。名額 `AI_APPROVAL_CAP`（不設＝自動計算 49） |
| 功能開關 | 公開的 `GET /api/features` → `{ auth, ai, ocr, aiPaused }`（只回布林；已實作） |

### 1.2 延後（不在這次範圍）

- Phase 2 的作答紀錄與單字複習同步（`/api/sessions*`、`/api/srs/*`、`/api/review/*`、`/api/me/prefs`、通知）
- R2 照片（`PHOTOS` 綁定、`submission_photos` 表）與附照片的 `essay_grade_photo`
- Cron（`scheduled`：回收逾時預扣、DLQ 數量告警、保存期限清除）、每日對帳（GitHub Actions＋Admin API）
- 邀請碼、試用等級的發放、「分享給管理員」、修訂稿任務（`translation_revision`、`essay_revision`）、簡答判定（`short_answer_judge`）、家教追問、思考表達回饋
- 後台的審核、更正、回報、安全事件、稽核查詢等頁面
- 有時間就做：`ai_shared_cache`（中譯英同題同答案沿用結果、不扣點；快取鍵與學生身分無關）

## 2. 端點與型別對照

型別都從 `@gsat/shared` 匯入。JSON 欄位一律 snake_case（`/api/features` 例外，照需求用 `aiPaused`）。錯誤格式沿用 `{ error: { code, message } }`，新代碼已加進 `API_ERROR_CODES`。

| 方法 | 路徑 | 權限 | 請求 | 回應 | 負責 |
|---|---|---|---|---|---|
| GET | `/api/features` | 公 | — | `FeaturesResponse` | 已實作 |
| GET | `/auth/google/start?next=` | 公 | — | 302 到 Google | A1 |
| GET | `/auth/google/callback` | 公 | — | HTML 跳轉頁＋Set-Cookie；失敗跳 `/account?auth_error=<AuthErrorCode>` | A1 |
| POST | `/auth/logout`、`/auth/logout-all` | 登 | — | 204 | A1 |
| GET／POST | `/auth/probe`（`?set=1`、`?clear=1`、`?delay=N`） | 公（只在過渡期） | POST：任意本體 ≤3 MB | `{ probe: true, … }` | 整合（§10） |
| GET | `/api/me` | 公 | — | `MeResponse`（永遠 200） | A1 |
| PATCH | `/api/me` | 登（同意未完成也可） | `MePatchBody` | `MeResponseSignedIn` | A1 |
| POST | `/api/me/consents` | 登（同意未完成也可） | `ConsentsPostBody` | `MeResponseSignedIn` | A1 |
| GET | `/api/me/export` | 登＋10 分鐘 | — | `MeExport` | A1 |
| DELETE | `/api/me` | 登＋10 分鐘 | `DeleteMeBody` | 204 | A1 |
| POST | `/api/ai/apply` | 登 | `AiApplyBody` | `AiApplyResponse` | A1 |
| GET | `/api/ai/quota` | 登 | — | `AiQuotaResponse` | A2 |
| POST | `/api/submissions` | 登 | `CreateSubmissionBody` | 201 `SubmissionDetail` | A2 |
| GET | `/api/submissions?kind=&cursor=` | 登 | — | `SubmissionListResponse` | A2 |
| GET／PUT／DELETE | `/api/submissions/{id}` | 登 | PUT：`UpdateSubmissionBody` | `SubmissionDetail`／204 | A2 |
| POST | `/api/submissions/{id}/photos?ord=1\|2` | AI | multipart，欄位 `photo` | `PhotoUploadResponse` | A2 |
| DELETE | `/api/submissions/{id}/photos` | 登 | — | `PhotoUploadResponse` | A2 |
| PUT | `/api/submissions/{id}/confirm` | 登 | `ConfirmOcrBody` | `SubmissionDetail` | A2 |
| POST | `/api/ai/translation-grade`、`/essay-grade`、`/essay-ocr` | AI | `AiTaskRequest` | 202 `AiTaskAccepted` | A2 |
| GET | `/api/ai/ops/{id}` | 登 | — | `AiOpResponse` | A2 |
| GET | `/api/admin/health` | 管 | — | `AdminHealthResponse` | A1 |
| GET | `/api/admin/users?ai_status=&cursor=` | 管 | — | `AdminUsersResponse` | A1 |
| POST | `/api/admin/users/{public_id}/{action}` | 管＋12 小時 | — | `AdminUserActionResponse` | A1 |
| POST | `/api/admin/ai/pause` | 管＋12 小時 | `AdminAiPauseBody` | 204 | A2 |
| GET | `/api/admin/usage?from=&to=` | 管 | — | `AdminUsageResponse` | A2 |

權限中介層在 `apps/api/src/auth/session.ts`：`requireUser({ allowPendingConsent? })`、`requireAiApproved`、`requireAdmin`、`requireRecentLogin(minutes)`、`getSessionUser(c)`；簽發與清除 cookie 用 `issueSessionCookie(c, {id, sessionVer}, {iat?})`、`clearSessionCookie(c)`。其他模組**只**透過這些函式取得登入者，不自己解析 cookie。

### 2.1 主要型別

- 帳號：`PublicUser`、`UserRole`、`AccountStatus`、`AiStatus`（none／pending／waitlist／approved／rejected／suspended）、`AiTier`、`AgeBand`（under18／18plus）、`ConsentKind`、`ConsentVersions`、`MeResponse`（`MeResponseAnonymous | MeResponseSignedIn`）、`MePatchBody`、`ConsentsPostBody`、`AuthErrorCode`、`AiApplyBody`、`AdminUserRow`、`AdminHealthResponse`、`StartupCheck`、`AdminUsageResponse`。
- 寫作：`SubmissionKind`、`SubmissionStatus`（狀態機見 writing.ts 註解）、`CreateSubmissionBody`、`UpdateSubmissionBody`、`SubmissionDetail`、`TranslationBody`、`EssayBody`、`PhotoMeta`、`OcrResult`、`ConfirmOcrBody`。
- 批改：`TranslationGradingResult`（每句 0–4、0.5 為單位，一組滿分 8；`TranslationError` 含位置、原文片段、類別、`explanation_zh`、建議、`repeat_of`、`deducted`）、`EssayGradingResult`（四項各 0–5、總分 0–20、兩位評分者各自的 `EssayRaterResult` 與平均、各項 `explanation_zh`、`paragraph_advice`、`errors`、`deductions`、`band`）。
- AI：`AiTask`（translation_grade／essay_grade／essay_ocr）、`AI_TASK_POINTS`（3／7／2）、`AiTaskAccepted`、`AiOpResponse`、`AiRefundReason`、`AiQuotaResponse`、`AI_RESERVE_ERROR_CODES`（quota_day／quota_month／daily_limit／busy／ai_paused／site_budget）、`AI_GATE_ERROR_CODES`（另加 not_approved／not_configured／consent_required）、`AI_ERROR_MESSAGES`（中文文案）。
- 共用小工具：`writingGroupId(examId, sourceGroupId)` → `'gsat-115.s7g1@1'`、`essayBandOf(score)`、`isScoreOnStep(value, max, step)`。

### 2.2 錯誤碼與 HTTP 狀態

| 代碼 | 狀態 | 情境 |
|---|---|---|
| `unauthorized` | 401 | 未登入 |
| `reauth_required` | 401 | 需要近期登入（前端導向 `/auth/google/start?next=…`） |
| `consent_required` | 403 | 同意未完成或條款改版（前端導向 `/account/welcome`） |
| `account_suspended` | 403 | 帳號停權 |
| `not_approved` | 403 | AI 未核准 |
| `forbidden` | 403 | 非管理員 |
| `conflict` | 409 | 提交狀態不允許（例如批改中又 PUT）；核准超過名額 |
| `quota_day`、`quota_month`、`daily_limit`、`busy` | 429 | 原子預扣失敗（個人） |
| `ai_paused`、`site_budget` | 503 | 原子預扣失敗（全站） |
| `not_configured` | 503 | 相關機密未設定；前端也把「回應不是 JSON」當成這個 |
| `not_implemented` | 501 | 骨架期 |
| `payload_too_large` | 413 | 作文、譯文、照片超過上限 |

## 3. AI 任務流程（摘要，細節照 ARCHITECTURE §3.4）

1. 前端 `POST /api/submissions` 建草稿 → `PUT` 更新內容 →（照片模式：`POST …/photos?ord=1`、`?ord=2` → `POST /api/ai/essay-ocr` → 輪詢到 `ocr_ready` → `PUT …/confirm`）→ `POST /api/ai/{translation-grade|essay-grade}`。
2. Worker 驗證輸入上限（譯文每句 ≤500 字元；作文 ≤600 字且 ≤4,000 字元；照片每張 ≤1.2 MB、最多 2 張）→ 一句 SQL 原子預扣 → `submissions.status` 改 `queued`（OCR 是 `ocr_queued`）→ `AI_QUEUE.send({ op_id })` → 202。
3. consumer（`apps/api/src/ai/consumer.ts`，`max_batch_size 1`、`max_concurrency 5`、`max_retries 3`、DLQ `ai-tasks-dlq`）依 §3.4 第 5–12 步處理；差距過大（作文 >5、中譯英 >2）時把同一 `{op_id}` 再送一次補第三位。
4. 前端輪詢 `GET /api/submissions/{id}`：每 2 秒、3 分鐘後每 15 秒（`POLL_*` 常數）。

## 4. 手寫照片暫存（遷移 0002，A2 撰寫）

- 0001 已定案、不可改。照片暫存表由 A2 在 `apps/api/migrations/0002_*.sql` 新增，建議欄位：`id`、`submission_id`（FK CASCADE）、`user_id`（FK CASCADE）、`ord`（1–2，與 submission_id 唯一）、`mime`（只收 image/jpeg）、`bytes`（CHECK ≤1,200,000）、`width`、`height`、`sha256`、`data BLOB NOT NULL`、`created_at`、`expires_at`（＝created_at＋24 小時）。
- D1 單列上限約 2 MB，所以一張一列、每張 ≤1.2 MB；migrations/README 的「照片不要放進 D1」原則在 MVP 以「用完即丟、最長 24 小時」處理，R2 上線後改回 `submission_photos`。
- 刪除時機：OCR 成功或失敗結算時、學生 `PUT …/confirm` 時、學生 `DELETE …/photos` 時、刪提交或刪帳號時（CASCADE）、每次上傳前 `DELETE … WHERE expires_at < now`（同時刪掉同一人其他提交〔不在辨識中〕的照片）、housekeeping（§10「A2 第二輪審查修正」）。
- 照片不匯出、管理員看不到、不寫進日誌。
- **題組外鍵**：`submissions.group_id` 參照 `item_groups(id)`（D1 預設強制外鍵），而 MVP 的題目來自靜態 `data/exams/parsed/*.json`、D1 還沒有題組。0002 也要補上中譯英（section type `translation`）與作文（`composition`）題組的最小列（`id = writingGroupId(paper, group)`、`origin='ceec'`、`status='published'`，以及 `licenses` 對應的一列），建議用 `tools/` 下的小腳本從 JSON 產生 SQL。Worker 組提示詞需要的題目文字與評分參考，A2 可選擇從 D1 讀或打包一份由同一支腳本產生的 JSON；契約（前端送 `group_id`）不受影響。

## 5. 設定與部署（D）

- `apps/api/wrangler.toml` 已加：`[[queues.producers]]`（`AI_QUEUE` → `ai-tasks`）、兩個 `[[queues.consumers]]`、`[observability] enabled = true`、`APP_ORIGIN`、條款版本、AI 預設值（§6.3「正式開放」的值；校準月份要改的三個數字寫在註解）。`ALLOWED_ORIGINS = "https://gsat-english-center.vercel.app"`。
- 程式預設值集中在 `apps/api/src/config.ts`（`CONFIG_DEFAULTS`），`test/skeleton.test.ts` 檢查與 wrangler.toml 一致。
- 部署（D 負責，全部由 `.github/workflows/worker-deploy.yml` 做，站主的步驟見 [SETUP-KEYS.md](../SETUP-KEYS.md)）：確認 workers.dev 子網域 → D1（`database_id` 只在 runner 上填）→ `queues create ai-tasks-dlq`、`ai-tasks`（已存在就略過）→ `d1 migrations apply --remote` → `deploy` → 同步機密（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、ADMIN_EMAIL、ANTHROPIC_API_KEY 從 GitHub secrets 同步；SESSION_SECRET、LEDGER_SALT 沒有才產生）→ `/api/health`、`/api/features` 確認。之後手動：根目錄 `vercel.json` 的 `REPLACE_WITH_SUBDOMAIN` 換成實際的 workers.dev 子網域；Google Console 的 redirect URI 加 `https://gsat-english-center.vercel.app/auth/google/callback`。
- `vercel.json`：`/auth/:path*` 已轉給 Worker、SPA 的 catch-all 排除 `auth/`，所以 `/auth/google/callback` 不會被 SPA 吞掉。前端路由不可以用 `/auth` 開頭（帳號頁是 `/account`）。
- 前端 `api()` 的 credentials：沒設 `VITE_API_BASE`（同源）用 `'same-origin'`；買網域後設了 `VITE_API_BASE=https://api.<網域>` 自動改 `'include'`。

## 6. 檔案與負責 agent

A1＝後端登入／帳號／後台；A2＝後端 AI（提交、額度、Queue consumer、OCR）；W1＝前端帳號與後台；W2＝前端寫作；D＝部署設定。「共用」檔案由本骨架建立，之後要改請先協調（只加不改的小幅新增可以直接做，並在交接時說明）。

| 檔案 | 負責 | 說明 |
|---|---|---|
| `packages/shared/src/account.ts`（＋`.test.ts`） | A1（W1 只讀） | 帳號、同意、申請、後台型別 |
| `packages/shared/src/writing.ts`（＋`.test.ts`） | A2（W2 只讀） | 寫作、批改結果、AI 任務與額度型別 |
| `packages/shared/src/features.ts`、`api.ts`、`index.ts` | 共用 | 新增錯誤碼要加在 `api.ts` 的 `API_ERROR_CODES` |
| `apps/api/src/env.ts`、`config.ts`、`time.ts`、`errors.ts`、`app.ts`、`index.ts`、`features.ts` | 共用 | 新環境變數：env.ts＋config.ts＋wrangler.toml 三處一起改 |
| `apps/api/src/auth/session.ts`、`auth/routes.ts`，新增 `auth/oauth.ts`（safePath、state、Google 呼叫）、`auth/cookie.ts` 等 | A1 | |
| `apps/api/src/account/routes.ts`、`account/apply.ts`，新增 `account/*.ts` | A1 | `/api/me*`、`/api/ai/apply` |
| `apps/api/src/admin/routes.ts`，新增 `admin/*.ts`（ai.ts 除外） | A1 | health、users |
| `apps/api/src/admin/ai.ts` | A2 | `/api/admin/ai/pause`、`/api/admin/usage` |
| `apps/api/src/submissions/routes.ts`，新增 `submissions/*.ts` | A2 | 提交 CRUD、照片、確認 |
| `apps/api/src/ai/routes.ts`、`ai/consumer.ts`，新增 `ai/tasks.ts`、`ai/pricing.ts`、`ai/reserve.ts`、`ai/claude.ts`、`ai/prompts/*` 等 | A2 | |
| `apps/api/migrations/0002_*.sql`（＋產生 seed 的 `tools/` 腳本） | A2 | 照片暫存、題組最小列 |
| `apps/api/test/auth*.test.ts`、`account*.test.ts`、`admin*.test.ts` | A1 | |
| `apps/api/test/ai*.test.ts`、`submissions*.test.ts` | A2 | |
| `apps/api/test/skeleton.test.ts` | 共用 | 實作端點後，把該端點從「回 501」清單移除 |
| `apps/api/wrangler.toml`、`.dev.vars.example`、`vercel.json`、`.github/workflows/*` | D | A1／A2 需要新變數時告知 D |
| `apps/web/src/lib/api.ts` | 共用（W1 維護 SessionProvider） | `api()`、`useFeatures()`、`useMe()`、`loginHref()` |
| `apps/web/src/features/account/*`（AccountPage、WelcomePage、AiApplyPage、LoginButton） | W1 | `/account`、`/account/welcome`、`/ai/apply` |
| `apps/web/src/features/admin/*` | W1 | `/admin` |
| `apps/web/src/features/writing/*`（WritingHomePage、TranslationListPage、TranslationAttemptPage、EssayListPage、EssayAttemptPage、SubmissionResultPage） | W2 | `/writing*` |
| `apps/web/src/App.tsx`、`modules.ts`、`main.tsx`、`components/Layout.tsx`、`components/icons.tsx`、`tests/*.spec.ts` | 共用 | 路由已全部註冊；新增頁面時才需要改 |

另一條工作線同時在 `/home/user/gsat-english-center` 改 `apps/web`：共用的前端檔案（App.tsx、modules.ts、Layout.tsx）這次只做了最小的新增，合併時以加法解衝突。

## 7. Anthropic SDK 支援結論

已安裝 `@anthropic-ai/sdk@0.132.1`、`zod@4.6.5`（`apps/api` 的 dependencies）。檢查 `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts`：

| 需求（ARCHITECTURE §6.2） | SDK 型別 | 結論 |
|---|---|---|
| `output_config.effort`（第 3 條） | `BetaOutputConfig.effort?: 'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'` | 支援 |
| `output_config.format`（第 5 條） | `BetaOutputConfig.format?: BetaJSONOutputFormat`；`betaZodOutputFormat(zodSchema)`（`@anthropic-ai/sdk/helpers/beta/zod`，用 `zod/v4`）＋`client.beta.messages.parse()` 會自動解析到 `parsed_output`（`ExtractParsedContentFromBetaParams` 同時認 `output_config.format`） | 支援 |
| `fallbacks: "default"`＋beta `server-side-fallback-2026-07-01`（第 7 條） | `fallbacks?: BetaFallbacksParam`（`Array<BetaFallbackParam> \| 'default'`）；`AnthropicBeta` 列舉含 `'server-side-fallback-2026-07-01'` | 支援 |
| 串流取 `finalMessage()`（第 16 條） | `client.beta.messages.stream(...)` → `BetaMessageStream.finalMessage()` | 支援 |
| `stop_details.category`、`usage.iterations`、`usage.cache_creation.ephemeral_1h_input_tokens`（第 8、9 條） | `BetaMessage.stop_details: BetaRefusalStopDetails \| null`、`BetaUsage.iterations: BetaIterationsUsage \| null`、`ephemeral_1h_input_tokens` | 支援 |
| 逾時、重試、測試端點 | `new Anthropic({ apiKey, baseURL, timeout, maxRetries, fetch })`；`baseURL` 接 `config.ai.baseUrl`（`ANTHROPIC_BASE_URL`） | 支援 |
| Cloudflare Workers | README 列為支援的執行環境（用全域 fetch）；不需要 `nodejs_compat` | 支援（已用 `wrangler dev`＋本機假 Anthropic 實測：串流、429 自動重試、拒答、`AbortSignal` 總期限都正常，見 §10「整合」） |

**結論：用 SDK 的 `client.beta.messages`，不需要改原生 fetch。** 注意：

- 第 5 條要求「剝除不支援的約束」：`betaZodOutputFormat` 產生 JSON schema 時會處理；回應仍要用完整 zod schema 再驗一次（數量、長度、範圍由程式檢查）。schema 欄位名稱不可含 `reasoning`、`chain_of_thought`、`thinking` 等字樣（第 6 條），說明欄位叫 `explanation_zh`。
- 不送 `thinking`、`temperature`、`top_p`、`top_k`、強制 `tool_choice`、assistant 預填（第 2、3 條；Opus 5.5 會 400）。effort 一律明確設定（Opus 5.5 預設是 medium）。
- `429 enforced_spend_limit_reached` 不重試、立即全站暫停（第 16 條）。錯誤用 `Anthropic.RateLimitError`、`Anthropic.APIError` 等類別由具體到一般判斷。

## 8. 測試策略

- **外部服務一律 mock**：Anthropic 與 Google 的呼叫在單元測試裡用 `vi.stubGlobal('fetch', …)` 或注入 SDK 的 `fetch` 選項攔截；測試絕不打真的 API、絕不需要真金鑰。
- **端點覆寫**：`ANTHROPIC_BASE_URL`、`GOOGLE_OAUTH_AUTH_URL`、`GOOGLE_TOKEN_URL`、`GOOGLE_USERINFO_URL`（env.ts）讓整合測試（`wrangler dev`＋本機假伺服器）不必改程式。正式環境不設＝官方網址（`DEFAULT_ENDPOINTS`）。
- **D1**：Worker 測試沿用 `app.request(path, init, env)`；需要資料庫時依 05 文件 §2.9 用 `node:sqlite` 套用 `migrations/*.sql` 做假 D1（A1、A2 各自需要時建立 `test/helpers/d1.ts`，先建立的人負責，另一位沿用）。原子預扣 SQL 要有「並行送 N 個請求不會超扣」的測試。
- **呼叫規則**（ARCHITECTURE §6.2）：每一條都寫成單元測試，掃描請求建構函式的輸出（模型 ID 白名單、沒有 temperature、有 effort、有 fallbacks＋beta 標頭、學生文字包在 `<student_text>`、不含 email／暱稱／帳號 id）。
- **前端**：元件測試用 vitest＋testing-library，fetch 一律 stub；沒有 `SessionProvider` 時 `useFeatures()`／`useMe()` 回「全部關閉、未登入」，頁面可以單獨 render。e2e 測試（`tests/smoke.spec.ts`、`exams.spec.ts`、`vocab.spec.ts` 的 `mockBackend`）用 `page.route` 假造 `/api/features`（全部 false）；新頁面若會在載入時打其他 API，要在 `mockBackend` 補假回應，否則 404 會變成 console error。
- **本機端對端**：`npm run test:local-e2e -w @gsat/api`（`apps/api/scripts/local-e2e.mjs`）：wrangler dev（本機 D1＋Queue）＋本機假 Google＋假 Anthropic，從登入跑到 AI 批改、後台核准、額度用完、刪帳號；不需要金鑰、不連外網，約 20 秒。改到登入、AI 任務、consumer、遷移時跑一次（細節見 §10「整合」）。
- **檢查指令**：`npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e -w @gsat/web`（Chromium 在 `/opt/pw-browsers/chromium`，playwright.config.ts 會自動找）。

## 9. 和上游文件不同的決定（站主可以推翻）

| 項目 | 上游 | 這次的決定 | 理由 |
|---|---|---|---|
| 作文四項分數 | 任務說明寫「文法句構 0–4、字彙拼字 0–4」 | **四項各 0–5，加總 20**（`ESSAY_CRITERION_MAX`） | SPEC §4.6 與 02 §4.4：106 學年度起的現制四項各 5 分；0–4 是 95–105 的舊制（另有體例 2 分）。0–5／0–5／0–4／0–4 加總只有 18，和總分 20 矛盾 |
| 手寫作文點數 | SPEC §8.3：OCR 2＋批改 8（附照片的 `essay_grade_photo`） | OCR 2＋`essay_grade` 7＝9 點 | MVP 照片在 OCR 完成或確認後立即刪除，批改時沒有照片可附；`essay_grade_photo` 等 R2 |
| 過渡期開放 AI 與照片 | ARCHITECTURE §4.1、§4.2：AI 與照片上傳只在自訂網域開放（站主決定事項 D1） | 這次在 Vercel 代理上直接開放 | 站主要求 2 小時內可用；照片改成一次一張（每個請求約 1.2 MB）降低代理本體大小的風險，§4.3 的實測項目仍要補做 |
| 照片大小 | SPEC §6.9：長邊 ≤2576 px；ARCHITECTURE：每張 ≤2 MB、存 R2 | 長邊 ≤1600 px、每張 ≤1.2 MB、暫存 D1 最長 24 小時 | D1 單列約 2 MB 上限；手寫英文在 1600 px 仍清楚（上線後依 OCR 品質調整） |
| `/api/ai/apply` 的位置 | ARCHITECTURE §10.4 列在 AI 端點 | 程式放 `src/account/apply.ts`（A1），掛在 `/api/ai/apply` | 寫入的是帳號與核准狀態；讓 A1、A2 不改同一個檔案 |
| 前端 credentials | 既有 `apiGet` 一律 `'include'` | 同源用 `'same-origin'`，設了 `VITE_API_BASE` 才 `'include'` | 照這次的需求；買網域後的跨子網域仍可用 |

## 10. 契約變更紀錄

各 agent 改了共用契約（`packages/shared/src/*`、共用的後端檔案）或做了和上面不同的決定時，在這裡各自加一小節。

### A1（後端登入、帳號、後台）

**型別與匯出（只加不改名）**

- `packages/shared/src/account.ts`（A1 的檔）：新增 `AI_CONSENT_KINDS`、`safePath()`／`SAFE_PATH_MAX_LENGTH`（後端驗 `next`，前端也可以先用）、`isAuthErrorCode()`；`MeResponseSignedIn` 加選填欄位 `pending_ai_consents`、`AdminHealthResponse` 加選填欄位 `ops_events: { open, open_errors }`（後端一定會帶；宣告成選填只是讓舊的測試假資料不必改）。註解釐清：`pending_consents` 只會有 privacy／terms；`ADMIN_USER_ACTIONS` 每個動作的規則；`MeExport.submissions` 的形狀。
- `apps/api/src/auth/session.ts`：`SessionUser` 加選填欄位 `createdAt`、`pendingConsents`、`pendingAiConsents`；新匯出 `UserRow`、`USER_COLUMNS`、`toSessionUser`、`loadUserWithConsents`、`reloadSessionUser`、`encodeSessionCookie`／`decodeSessionCookie`。`requireAiApproved` 多一條：`pendingAiConsents` 非空 → 403 `consent_required`。
- 其他給 A2 用的：`src/account/approval.ts` 的 `approvalSummary(env, config)`（`AiQuotaResponse.approval` 直接用，名額算法只有一份）；`src/auth/crypto.ts` 的 `userRef(salt, users.id)`＝hex(HMAC-SHA256(LEDGER_SALT, String(id)))，`ai_calls.user_ref` 請用同一支，才能和 `deletion_log` 對上。
- 共用檔案 `env.ts`、`config.ts`、`errors.ts`、`app.ts`、`index.ts`、`api.ts` **沒有改**；不需要新環境變數，也沒有新增遷移（只用 0001 的表）。
- 測試：`test/helpers/d1.ts`（node:sqlite 假 D1，套用 `migrations/*.sql` 並照 wrangler 寫 `d1_migrations`）由 A1 先建立；`test/helpers/auth.ts` 有 `authEnv()`、`insertUser()`（預設帶現行版本的 privacy＋terms 同意，AI 狀態是 pending／waitlist／approved 時一併帶 ai_processing）、`cookieFor()`、`call()`，A2 可以沿用。`test/skeleton.test.ts` 的 501 清單已移除 A1 的端點。

**和上面的契約或上游文件不同的決定**

| 項目 | 契約／上游 | 實作 | 理由 |
|---|---|---|---|
| `POST /auth/logout` 權限 | 登 | 沒登入也回 204、清 cookie | 登出應該冪等；`/auth/logout-all` 仍要登入 |
| 匯出、刪帳號、登出所有裝置 | requireUser | `requireUser({ allowPendingConsent: true })` | 不同意新版條款的人仍然要能取回、刪除自己的資料與登出 |
| `DELETE /api/me` | ARCHITECTURE §8.4：`deleting` → Cron 分批刪 | 同步刪除：一個 `db.batch()` 裡 `status='deleting'`＋`session_ver+1` → 寫 `deletion_log`（假名＋各表列數）→ `admin_audit` 只記「刪了一個帳號」→ `DELETE users`（CASCADE；`ai_ops`、`item_reports` 設 NULL） | MVP 沒有 Cron（§1.2），一個帳號的資料量很小；之後改回 Cron 只要把最後一步搬走 |
| ADMIN_EMAIL bootstrap | 第一次登入 | 信箱相符**而且站上還沒有任何管理員**時才升級（寫 `admin_audit`，actor_kind='system'） | bootstrap 只會發生一次、之後以 sub 為準；站主在設 ADMIN_EMAIL 之前先登入過也能補上 |
| AI 同意改版 | 只有登入同意有改版流程 | `AI_CONSENT_VERSION` 改版（或撤回、或改報未滿 18 歲沒有 guardian_ack）時，已申請／已核准的學生 `pending_ai_consents` 非空、AI 端點回 403 `consent_required`；重新同意可以送 `POST /api/me/consents`（帶 ai_processing、guardian_ack）或再送一次 `POST /api/ai/apply`（已核准者不改狀態、不算次數）。管理員免 | 送出前要有現行版本的同意（ARCHITECTURE §8.2）；不影響一般功能，所以不放進 `pending_consents` |
| 後台 `suspend`／`unsuspend` | 任務說明「不能停權自己」 | 照 account.ts 原本的「AI 狀態的動作」：`ai_status` approved ⇄ suspended（帳號照常登入、不能自己再申請）；`unsuspend` 和 `approve` 一樣檢查名額與 §6.3；不能停用自己 | 和 W1 的後台畫面（「停用 AI」）一致。帳號層級停權（`users.status`）MVP 沒有按鈕，需要時站主直接改 DB 並把 `session_ver` 加 1；那種帳號登入回 `auth_error=suspended` |
| `approve` 對從未申請（none）的人 | — | 允許，但他沒有 ai_processing 同意：`pending_ai_consents=['ai_processing']`，學生本人同意前 AI 端點回 403 `consent_required`。`reject`／`waitlist` 對 none 回 409 | 同意一定由學生本人做；後台可以先核准 |
| 名額計算 | ARCHITECTURE §6.6 | 只算 `role='student'`、`ai_status='approved'`、未刪除；管理員不佔名額、不受名額限制 | §6.6「管理員不受點數限制、站主自己的用量另外扣」 |
| `/api/ai/apply` 擋下的代碼 | — | 冷卻 60 秒、10 次上限 → 429 `rate_limited`；年齡區間沒填 → 403 `consent_required`；`ai_consent_version` 不是現行版本、未滿 18 歲沒勾 guardian_ack、說明 >300 字 → 400；AI 被停用 → 409 | |
| id_token 檢查 | iss、aud、exp、email_verified | 另外檢查 `nonce`（授權網址帶 `nonce`＝state 裡的 nonce，OIDC Core 3.1.3.7） | 多一層重放防護，Google 一定會帶回 |
| redirect_uri | APP_ORIGIN＋`/auth/google/callback` | `PUBLIC_API_ORIGIN`（沒設＝APP_ORIGIN）＋`/auth/google/callback` | 過渡期兩者相同；買網域後回呼要落在 `api.<網域>`（ARCHITECTURE §4.1） |
| 登入後跳轉 | — | 一律 APP_ORIGIN＋next（不合格或沒帶 → `/`），不另外導向 `/account/welcome`；失敗 302 到 `/account?auth_error=` | 首次設定由前端依 `pending_consents`／`onboarded` 導向 |
| 健康檢查的 ops_events | §6.3 第 4 條 | error 級啟動檢查不成立時寫 `ops_events(kind='startup_check_failed', severity='error')`，24 小時內還有未確認的就不重寫；`ops_events` 欄位回未確認數。遷移清單寫在 `src/admin/migrations.ts` 的 `EXPECTED_MIGRATIONS`，**新增遷移檔要把檔名加進去**（`test/admin.test.ts` 會檢查） | Worker 讀不到 migrations/ 目錄 |
| 後台列表分頁 | `cursor` | 每頁 50 筆、依建立順序由新到舊；`next_cursor` 是上一頁最後一位的 public_id（不外露內部 id） | |

### W1（前端帳號、AI 申請、後台）

**契約**：沒有改 `packages/shared`。前端需要的都已在契約裡（對過 A1 的 `pending_ai_consents`、`ops_events`、`safePath()`、`isAuthErrorCode()`，以及 A2 的 `/api/ai/quota` 用 `requireUser`、`/api/admin/usage` 收 `YYYY-MM-DD`）。前端需要：條款版本三處一致——`apps/web/src/features/account/policy.ts` 的 `PRIVACY_POLICY_VERSION`／`TERMS_VERSION`／`AI_CONSENT_VERSION` 要等於 `wrangler.toml` 與 `config.ts`（`policy.test.ts` 會比對）；改版時三處一起改，差異寫在 `policy.ts` 各份的 `changes`（條款改版時歡迎頁會列出）。

**共用檔案的小幅新增（只加不改）**

- `apps/web/src/lib/api.ts`：`SessionState` 加 `applyMe(me)`（PATCH /api/me、POST /api/me/consents 的回應直接套用，省一次 GET）；新匯出 `signedIn(me)`、`needsOnboarding(me)`（`pending_consents` 非空或 `onboarded` 為 false）。
- 新檔 `apps/web/src/lib/apiErrors.ts`：`API_ERROR_MESSAGES`（`Record<ApiErrorCode, string>`，AI 代碼沿用 `AI_ERROR_MESSAGES`）、`errorMessage(err, overrides?)`、`errorCode(err)`。W2 可以直接用。
- `apps/web/src/components/Layout.tsx`：側邊欄的登入按鈕改成品牌下方獨立一列（`<LoginButton placement="sidebar" />`，側邊欄 256px 塞不下暱稱）；版面最外層加 `<OnboardingRedirect />`。

**給 W2 與整合者**

- `features/account/RequireAccount.tsx` 的 `<RequireAccount>{(me) => …}</RequireAccount>`：auth 關閉 →「即將開放」、未登入 → 登入提示（含 Gmail 提示）、需要同意 → 導到 `/account/welcome?next=<目前路徑>`。寫作頁需要登入的部分可以直接包。
- 自動導向：登入後整頁載入的第一次（不論在哪一頁）導到歡迎頁；之後同一次載入內瀏覽不需登入的頁面不再強制，需要登入的頁面每次由 `RequireAccount` 把關。
- AI 端點回 403 `consent_required` 時，若 `me.pending_consents` 為空，原因是 `pending_ai_consents`（AI 處理說明改版或後台直接核准了沒申請過的人）：請把學生帶到 `/ai/apply`，那裡有重新同意的表單（送 `POST /api/me/consents`）。
- 後台 `suspend`／`unsuspend` 依 A1 最後的語意顯示成「停用 AI／恢復 AI」；自己那一列不顯示「停用 AI」。從未申請的人只給「核准」，並提示要等本人同意。
- 匯出資料用 fetch 拿 JSON 再在瀏覽器存檔（不靠 Content-Disposition），錯誤（如 `reauth_required`）才能就地顯示。
- 條款改版時歡迎頁另外提供「匯出資料／刪除帳號」（A1 對這兩支允許同意未完成）。
- 隱私權說明寫了「撤回 AI 同意或其他請求請聯絡站主」：站主需要在「關於」頁公布一個聯絡方式（目前站上沒有）。
- `/settings` 的「帳號」區塊仍是「開發中」說明（不是 W1 的檔），整合時可以改成連到 `/account`。
- e2e 留給整合者：auth 開啟時 `/account`、`/ai/apply`、`/admin` 會打 `/api/me`、`/api/ai/quota`、`/api/admin/*`，`mockBackend` 要補假回應，否則 404 會變成 console error。
- 撤回 AI 處理同意（`/account` 的 AI 區塊，只對 pending／waitlist／approved 顯示）：送 `POST /api/me/consents` `{ items: [{ kind: 'ai_processing', version: consent_versions.ai, granted: false }] }`，依賴 A1 的語意——之後 `pending_ai_consents` 含 `ai_processing`、AI 端點回 403 `consent_required`、核准狀態不變；學生到 `/ai/apply` 重新同意。隱私權說明與 AI 處理說明據此寫「可以隨時在『我的帳號』撤回」。
- `/api/ai/quota` 對管理員／unlimited 回的上限是 10 億（A2 的 `UNLIMITED`）：前端把 ≥1 億的上限顯示成「不限」，`/ai/apply` 的規則說明改用一般預設值，不會印出 10 億。
- `/ai/apply` 另有「使用須知」（SPEC §8.4 的 AI 功能使用說明：能做、不能做、不要放個資、遇到不當內容怎麼辦）；`approval.full` 為 true 時申請表先說明「本月名額已滿、會排入候補」；已核准時顯示今日剩餘點數。
- 桌機版沒有頂端列：登入按鈕與帳號選單放在側邊欄品牌下方（手機在頂端列右上角）。
- 我自己用 scratch 的 Playwright 設定（不在 repo）驗過：auth 關閉／開啟（管理員）時 `/account`、`/account/welcome`、`/ai/apply`、`/admin` 在 1280、375、320 寬都沒有水平捲動與 console error；整合者把它寫進 `tests/*.spec.ts` 時可以照這個組合。

### W2（前端寫作練習）

**契約**：沒有改 `packages/shared`，也沒有改共用的前端檔案（`App.tsx`、`modules.ts`、`Layout.tsx`、`lib/api.ts`；只用 W1 新增的 `needsOnboarding()`）。用到的共用匯出：`writingGroupId`／`writingItemId`（題組 id `gsat-115.s7g1@1`、小題 id `gsat-115.s7g1@1#中譯英1`）、`countEnglishWords`／`countParagraphs`（作文即時字數與段數直接用，和 Worker 計分同一支；照片辨識的文字用 `photoMode`）、`AI_ERROR_MESSAGES`、`POLL_*`、`PHOTO_*`、各長度上限與計分常數。

**靜態資料**（W2 擁有的建置腳本部分）：`apps/web/scripts/build-data.mjs` 的 `buildWriting()` 另外輸出 `public/data/writing/translation.json`（55 組中譯英：只有中文題目、配分與本站句型標註）與 `writing/essay.json`（66 題作文：說明、提示、圖的文字描述、字數段數要求、官方題本／答題卷／評分原則 PDF 連結），從已刪除受保護欄位的考卷內容逐欄挑選；`assertNoOfficialTranslations()` 也掃 `writing/`（任何一份考卷的官方譯文都不能出現、題目物件不能有受保護欄位）。型別在 `src/features/writing/data.ts`，`scripts/check-data-contract.mjs` 一起比對。不直接讀 `/data/exams/{id}.json`：列表要列全部考卷，下載 66 份完整考卷太重。

**實作上的決定**

| 項目 | 做法 |
|---|---|
| 哪些中譯英能送 AI | 只有現制「兩句一組、每句 4 分」（`data.ts` 的 `isAiGradableTranslation`，和 A2 `build-writing-prompts.mjs` 的 `ai_gradable` 同條件）。83–85 學測一組 5 句、93 學測每句 5 分：只能自我檢核，列表標「舊制」 |
| 送出流程 | 草稿的提交 id 存在 localStorage：重送（額度不足、斷線）先 `PUT` 沿用；`404` 才 `POST` 新的。`409` 時先 `GET` 那一份：已送出（`ocr_queued`／`ocr_ready`／`confirmed`／`queued`／`grading`）或已批改且內容相同 → 直接導到它的結果頁（回應遺失時不重複扣點），其他才 `POST` 新的（審查修正）；`POST /api/ai/*` 回 `409` 視為已在排隊，照樣導到結果頁 |
| 自評 | `POST /api/submissions` 不帶自評，另外 `PUT { self_assess }`（失敗不擋批改）。中譯英只有勾過檢核清單或記了錯誤數才送；作文四項都評完才送（評到一半存在草稿，不把沒評的項目當 0 分） |
| 照片 | canvas 縮到長邊 ≤1600、`image/jpeg`（重新編碼＝去 EXIF），品質 0.9→0.5 逐步降，最低品質仍 >1.2 MB 就長邊 ×0.85 重來（<800 px 放棄並請學生重拍）。逐張 `POST …/photos?ord=1|2`；伺服器上的照片比這次多時先 `DELETE …/photos`。送出辨識後導到 `/writing/submissions/:id`：`ocr_ready` 的逐行確認、自評、送 `essay-grade` 都在結果頁，離開再回來可以接續；確認到一半的修改存在 localStorage |
| OCR 確認 | 逐行可改，`[[?]]` 加亮並列 `uncertain[].candidates` 當候選字；全部 `[[?]]` 處理完才能 `PUT …/confirm`。可切換「整篇一起編輯」（用來補段落之間的空行） |
| 扣點顯示 | `SubmissionDetail` 沒有點數欄位：`graded` 後打 `GET /api/ai/ops/{op_id}` 取 `points_charged`；剩餘點數用 `GET /api/ai/quota`（`≥1 億` 的上限顯示「不限」，同 W1） |
| `consent_required` | `me.pending_consents` 為空且 `onboarded` 時，原因是 AI 同意改版（`pending_ai_consents`）→ 帶到 `/ai/apply`；否則 `/account/welcome`。`pending_ai_consents` 非空時寫作頁直接顯示「前往重新同意」，不顯示送出按鈕 |
| 輪詢 | `lib/polling.ts` 的 `SubmissionPoller`：2 秒 × 3 分鐘 → 15 秒並提示「可以先離開，完成後回來看」；`401`／`403`／`404`／`not_configured` 停止（已有資料時畫面顯示原因與「再試一次」，不再說「會自動更新」），其他錯誤（含閘道的非 JSON 5xx）保留畫面上的資料照節奏重試 |
| 後端沒部署 | `features.auth`／`ai` 為 false：寫作頁不打 `/api/features`、`/api/me` 以外的 API，AI 按鈕隱藏、顯示「即將開放」，自我檢核照常 |

**前端需要（非必要，有空再做）**

- 前端需要：`SubmissionDetail` 帶這份提交累計實扣的點數（或各次 op 的 `{ task, points_charged }`）。手寫作文有 OCR 與批改兩筆 op，`op_id` 只指向最近一次，結果頁目前只能顯示「這次批改扣 N 點（照片辨識另計 2 點）」，OCR 那筆的實扣是用 `task_points` 推的。

**給整合者**

- e2e：`features` 全關時 `/writing*` 只打 `/api/features`、`/api/me`（smoke 已涵蓋 `/writing`）。`auth`＋`ai` 開啟時：`/writing` 打 `GET /api/ai/quota`、`GET /api/submissions?kind=translation`；作答頁打 `GET /api/ai/quota`；結果頁打 `GET /api/submissions/{id}`、`GET /api/ai/quota`、`GET /api/ai/ops/{op_id}`。`mockBackend` 要補這些，否則 404 會變成 console error。
- 單元測試的假資料與假 fetch 在 `src/features/writing/testing/`（`fixtures.ts` 照契約手寫的提交、批改結果、額度），e2e 可以沿用同一份資料。
- 我用 scratch 的 Playwright 腳本（不在 repo）看過 12 個寫作頁（列表、作答、舊制 5 句、找不到題目、四種結果頁狀態）：features 開／關 × 320 px 深色／1280 px 淺色，都沒有水平捲動與 console error。
- 字數規則已統一用 shared 的 `countEnglishWords`：和歷屆試題頁（`features/exams/labels.ts` 的 `countWords`，撇號／連字號規則）在「word,word」「e.g.」這類沒有空白的寫法會差 1，寫作頁以後端計分為準。

### A2（後端 AI 批改：提交、額度、Queue consumer、OCR）

**檔案**（§6 表格裡的 `ai/reserve.ts`、`ai/claude.ts` 實際叫 `guard.ts`、`client.ts`；產生題目庫的腳本放在 `apps/api/scripts/`，不在 `tools/`）

| 檔案 | 內容 |
|---|---|
| `apps/api/src/submissions/routes.ts`、`repo.ts`、`validate.ts`、`images.ts` | 提交 CRUD、照片暫存、確認；回應組裝（批改結果每次 GET 時從 `gradings` 以同一套計分重新合成）；長度檢查；照片魔術位元組、寬高、剝除中繼資料 |
| `apps/api/src/ai/routes.ts` | `/api/ai/quota`、三個任務端點、`/api/ai/ops/:id` |
| `apps/api/src/ai/consumer.ts` | `ai-tasks` 與 `ai-tasks-dlq` 的 consumer（ARCHITECTURE §3.4 第 5–12 步） |
| `apps/api/src/ai/tasks.ts`、`pricing.ts` | 任務設定表（§6.1）、價格表與成本計算（§6.5，整數；單價以奈美元／token 存，加總後無條件進位成微美元） |
| `apps/api/src/ai/guard.ts`、`ledger.ts` | 原子預扣（DB_SCHEMA §3.7 原文 SQL）、失敗原因判斷、結算／退還（`settle_token`）；`ai_calls`、`ops_events`、`ai_safety_events` |
| `apps/api/src/ai/client.ts`、`requests.ts` | §6.2 呼叫規則的唯一出口（`buildClaudeRequest`）、串流取 `finalMessage()`、`stop_reason`／`usage.iterations` 解讀、錯誤分類 |
| `apps/api/src/ai/prompts/{common,translation,essay,ocr}.ts` | 系統提示、本站自己寫的評分規準（D8）、zod 輸出 schema |
| `apps/api/src/ai/scoring.ts`、`filter.ts`、`bank.ts` | 程式計分；學生文字淨化、提示注入偵測、AI 輸出過濾；題目庫 |
| `apps/api/src/admin/ai.ts` | `/api/admin/ai/pause`、`/api/admin/usage` |
| `apps/api/migrations/0002_ai_photo_temp.sql` | 照片暫存表 `submission_photo_temp`（BLOB、`CHECK bytes ≤ 1,200,000`、`UNIQUE(submission_id, ord)`、`expires_at`＝上傳後 24 小時、外鍵 CASCADE） |
| `apps/api/scripts/build-writing-prompts.mjs`（＋`.d.mts`）、`apps/api/.gitignore` | 從 `data/exams/parsed/*.json` 的 translation／composition 大題產生 `src/generated/writing-prompts.json`（不進版控）；`prebuild`／`pretypecheck`／`pretest`／`predev`／`predeploy` 自動執行，CI 不用額外步驟 |

**型別與匯出（`packages/shared/src/writing.ts`，只加不改名）**

- 新增 `writingItemId(groupId, label)`（＝`'{group_id}#{label}'`；後端也接受只送 label 或題號字串，存檔一律轉成完整格式）、`countEnglishWords(text)`、`countParagraphs(text, photoMode?)`（前端即時字數與 Worker 扣分用同一支）、`PHOTO_MIMES`／`PhotoMime`、`isAiGradableTranslation(questions)`。
- 註解釐清（語意不變或補足）：`TextSpan` 的位置由 Worker 在原文裡搜尋模型引用的片段得出，找不到時 `start === end === 0`（只列清單、不畫底線）；中譯英的位移以該句為準、作文以整篇為準。`TranslationSentenceScore.mechanics_deduction` 是 0、0.5 或 1（句首大寫、句尾標點各 0.5，各在一句裡只扣一次，不屬於任何部分、從該句總分扣）。`TranslationError.repeat_of` 兩句之間也算。
- 共用的後端檔案 `env.ts`、`config.ts`、`errors.ts`、`app.ts`、`index.ts` 與 `api.ts` **沒有改**；不需要新環境變數。`/api/ai/quota` 的名額直接用 A1 的 `approvalSummary()`；`ai_calls.user_ref` 用 A1 的 `userRef()`。

**題組外鍵的決定（§4 最後一點）**：不在 0002 放種子資料，改成 `POST /api/submissions` 時在同一個 `db.batch()` 裡 `INSERT OR IGNORE` 該題組的最小 `item_groups` 列（`id = writingGroupId(...)`、`origin='ceec'`、`status='draft'`、`license='CEEC-exam'`〔0001 已有這一列 `licenses`，不必新增〕、`derivation='verbatim'`、`content_hash`／`face_hash`＝題目庫產生時算的雜湊、`answer_hash='none'`、`extra_json={"placeholder":"ai-writing-mvp"}`）。理由：題目文字本來就由 Worker 打包的題目庫決定，新增考卷不必再寫遷移；`draft` 不會出現在學生端檢視表、抽題與審核清單。之後正式匯入歷屆題時，匯入工具遇到這些 draft 列要「更新內容後再推進狀態」（draft 不受只增不減的 trigger 限制）。只有題目庫裡有的題組能建立提交（其他 400）。

**成本與點數設定**（`tasks.ts`；模型與 effort 來自 `AI_MODEL_*`、`AI_EFFORT_*`）

| 任務 | 點數 | 評分者（max_tokens） | effort | 輸入估計 | 預扣（最壞，含第三位） | 逾時／SDK 重試 |
|---|---|---|---|---|---|---|
| `translation_grade` | 3 | primary 6,000、second 3,000、third 3,000 | medium | 3,000 tokens／次 | 312,000 微美元（US$0.312） | 120 秒／2 |
| `essay_grade` | 7 | primary 12,000、second 4,000、third 4,000 | medium | 6,000 | 544,000（US$0.544） | 240 秒／2 |
| `essay_ocr` | 2 | ocr 3,000 | low | 6,000（兩張 1600 px） | 108,000（US$0.108） | 90 秒／2 |

預扣＝Σ［輸入估計 × max(輸入, 1 小時快取寫入單價) ＋ max_tokens × 輸出單價］。Queue 最多投遞 4 次（max_retries 3），租約 900 秒（第二輪審查由 600 改）；作文家族（每日篇數）只有 `essay_grade`。

**和上面的契約或上游文件不同的決定**

| 項目 | 契約／上游 | 實作 | 理由 |
|---|---|---|---|
| 照片格式 | §4「mime 只收 image/jpeg」 | 收 JPEG、PNG、WebP（檢查魔術位元組，宣告與內容不符 400）；存檔前剝除中繼資料（JPEG APP1、PNG eXIf／tEXt／zTXt／iTXt／tIME、WebP EXIF／XMP）；**長邊 >1600 px 回 400**；解析不出寬高、中繼資料結構不認得也 400（第二輪審查改，原本不擋） | 任務說明要求三種格式；尺寸上限與前端縮圖、OCR 預扣的 token 估計一致 |
| 照片上傳的狀態 | — | 只在 `draft`、`failed` 可以上傳；`essay-ocr` 需要至少一張照片；`ocr_queued` 時不能刪照片（409） | 辨識進行中不能換照片 |
| 照片模式改文字 | — | 確認之前（`draft`、`ocr_ready`）`PUT` 改 `body.text` 回 409，文字只能經 `PUT …/confirm` 寫入；確認時文字不能還有 `[[?]]`（400）；`ocr_diff_json` 記 `{ confirmed_at, ocr_words, confirmed_words, word_edits（單字編輯距離）, uncertain_marks }` | 才記得到和 OCR 原文的差異量 |
| 中譯英哪些題組能送 AI | — | 只有「2 句、每句 4 分」（`isAiGradableTranslation`）；83–85 學測（5 句）、93 學測（每句 5 分）送出回 409 conflict，仍可建立提交、作答、自評 | 計分規則（每句 4 部分）只適用現制 |
| 中譯英第三位門檻 | 「差 >2 分」 | 以整組 0–8 分比較兩位的總分 | 契約的 `translation_grade` 是 2 句一組一次批改；逐句比較留給校準時再評估（設計值） |
| 大小寫與標點 | SPEC §4.6「各扣 0.5、只扣一次」 | 每一題（＝每一句）裡句首未大寫、句尾標點不妥各扣一次，所以一句最多扣 1，從該句總分扣到 0 為止；中文標點出現在句中也算標點不妥 | 學測每題就是一句 |
| 作文未分段 | SPEC §4.6 | 只有題目要求 ≥2 段（題目庫的 `essay.paragraphs`）才判「未分段」；舊題沒寫段數的不扣 | 舊制題目沒有分段要求 |
| 離題 | SPEC §4.6「其他各項為 0」 | 保留內容分數，組織、文法句構、字彙拼字為 0；最後結果的 `off_topic` 要兩位（被採用的）評分者都判離題才是 true | 照字面 |
| 模型輸出的重試 | §6.2 第 4 條（max_tokens 重試一次） | `max_tokens` 與「輸出不符 schema／語意檢查（句數、部分編號 1–4、四項 0–5）」都在同一次 consumer 呼叫裡重試一次，兩次都記帳；仍失敗就退還（`max_tokens`／`invalid_output`）。剩下的牆鐘不夠時改由 Queue 重送（見下面「牆鐘控制」） | SPEC §8.3「輸出格式不符且重試仍失敗」退點 |
| server-side fallback 的回應 | — | 依序嘗試「全部 text 區塊接起來」（中途拒答時接手模型從片段續寫）與「最後一個 fallback 區塊之後的文字」（從頭重寫），先通過完整 zod 驗證的採用；`served_model` 取回應的 `model`，`gradings.model` 也記實際服務的模型 | 兩種情況都可能出現 |
| 全站暫停 | ARCHITECTURE §6.3 | 管理員暫停與 `429 enforced_spend_limit_reached` 都寫**今天**（台灣日期）的 `ai_budget_daily.paused`（DB_SCHEMA 的設計：一天一列），**隔天 00:00 自動恢復**；暫停時已排隊但還沒呼叫過 Claude 的任務退還（`paused`），已開始的讓它完成 | 用量級距月上限期間，每天第一個任務會再碰到一次 429（不收費）並再次暫停；要整月停用請把 `ANTHROPIC_API_KEY` 移除或每天暫停 |
| 預扣失敗以外的擋下 | §2.2 | 每人 24 小時最多建立 100 份提交（429 `rate_limited`）；每人每天「內容造成的退還」最多 5 次（429 `rate_limited`，第二輪審查新增）；預扣之後任何一步（更新提交、寫注入事件、排入 Queue）失敗 → 退還點數、提交回原狀態、500 `internal_error`；同一份提交已在排隊又送 → 409（不預扣；兩個請求同時送到時，後到的那個預扣會立刻退還） | 防程式化灌資料；不讓預扣卡住 |
| 重新送出 | — | `failed` 的提交可以再送同一個任務（新的 op；上一輪的 `gradings` 在同一個 batch 刪掉）；`graded` 不能再送 | 修訂稿任務延後（§1.2） |
| 提交列表 | `cursor` | 每頁 20 筆、新到舊；`next_cursor` 是 base64url 的 `"{created_at}:{id}"` | |
| 保存期限 | DB_SCHEMA `submissions.expires_at` | 依 `user_prefs.essay_retention`（沒有偏好列＝1 年；`30d`；`forever`＝NULL）；MVP 沒有 Cron，不會真的刪 | |
| 安全 | ARCHITECTURE §7、§8.5 | 學生文字 NFKC＋移除不可見字元後寫回提交（模型看到的＝學生畫面上的）；注入樣式命中只設 `injection_flag`、寫 `ai_safety_events(kind='injection_flag', category=樣式代號)`，照常批改；AI 輸出逐段過濾（剝 HTML、網址、遮信箱與電話；不當內容整段換成「這段回饋暫時無法顯示，已通報管理員」並寫 `output_filtered`；OCR 的候選字也過濾，轉錄本文只剝 HTML 標籤，見第二輪審查修正）；作文的 `safety_flag` 只存類別並寫 `wellbeing_flag` 事件 | |

**給前端（W2）與整合者**

- 中譯英的「AI 批改」按鈕用 `isAiGradableTranslation(group.questions)` 決定顯示與否；題組 id 用 `writingGroupId(exam.id, group.id)`，小題 id 用 `writingItemId(groupId, question.label)`（送 label 或題號也可以）。
- 照片：前端照現在的 `lib/photo.ts`（長邊 ≤1600、JPEG、≤1.2 MB）即可；伺服器對長邊 >1600 回 400 `bad_request`。上傳只在 `draft`／`failed`。
- `GET /api/submissions/{id}` 的 `grading.errors`：`start === end === 0` 表示找不到位置（只列清單）；`part === null` 的是程式判定的大小寫與標點。中譯英最後分數可能是 0.25 的倍數（兩位平均）。
- `status === 'failed'` 時 `failure` 是退還原因（點數已全退）；可以直接再送一次。管理員暫停在台灣時間隔天 00:00 自動恢復。
- `safety_flag` 非 null 時結果頁先顯示關懷與求助資訊（SPEC §6.9）。

**給部署（D）**

- 不需要新的機密或變數；遷移 0002 要在 `deploy` 前套用（workflow 已是如此），`src/admin/migrations.ts` 的 `EXPECTED_MIGRATIONS` 已含 `0002_ai_photo_temp.sql`。
- 題目庫是打包進 Worker 的：`worker-deploy.yml` 的 `paths` 要含 `data/exams/parsed/**`，部署前要先跑 `scripts/build-writing-prompts.mjs`（D 這一輪的 workflow 已經兩項都做了；`npm run typecheck／test／build -w @gsat/api` 也會自動先產生）。
- 已確認 `wrangler d1 migrations apply gsat-english --local` 能依序套用 0001、0002；`npm run build -w @gsat/api`（dry-run）約 1.9 MB／gzip 358 KB。

**牆鐘控制**：SDK 的 `timeout` 只管到回應標頭，所以每次呼叫另外用 `AbortSignal` 設總期限＝逾時 ×（重試＋1）（作文 720 秒、中譯英 360 秒、OCR 270 秒），到期當成可重試的逾時。截斷或格式不符要在同一次 consumer 呼叫裡重試時，若「已花的時間＋一次完整呼叫的期限」超過 14 分鐘（`CONSUMER_WALL_BUDGET_MS`），改讓 Queue 重送（重送時只補這一位，不重叫已完成的評分者）。

### D（部署設定）

**契約**：沒有改 `packages/shared` 與共用的後端檔案（`env.ts`、`config.ts`、`errors.ts`、`app.ts`、`index.ts`）；不需要新環境變數。

**改了的檔案**

| 檔案 | 內容 |
|---|---|
| `.github/workflows/worker-deploy.yml` | 加 `name`；`paths` 加 `data/exams/parsed/**`（題目庫打包進 Worker）與 `package-lock.json`；Cloudflare token 只交給需要的步驟（`npm ci` 的安裝腳本與測試看不到）；`defaults.run.shell: bash`（帶 `-o pipefail`，原本 `wrangler deploy \| tee` 失敗時不會讓步驟失敗）；新增「檢查 Cloudflare 帳號與 workers.dev 子網域」「準備 Queue」「同步 Worker 機密」「部署後確認」四步；部署前重產題目庫；`wrangler deploy --message` 帶 commit |
| `apps/api/wrangler.toml` | `workers_dev = true`（Vercel rewrites 依賴它，寫明）、`preview_urls = false`、`[observability] redact_query_string = true`；機密、D1、Queue 的註解改成新流程 |
| `vercel.json` | `/api/:path*`、`/auth/:path*` 加 `x-vercel-enable-rewrite-caching: 0`；rewrites 的 `REPLACE_WITH_SUBDOMAIN` 照舊（部署後由整合者填） |
| `apps/api/.dev.vars.example` | 只改註解（本機與正式機密分開、本機 OAuth 用戶端的 origin） |
| `docs/SETUP-KEYS.md` | 新檔：站主的逐步說明（各金鑰去哪裡拿、權限、觸發、確認、疑難排解、輪替） |

**和上游文件不同的決定**

| 項目 | 上游 | 做法 | 理由 |
|---|---|---|---|
| Worker 機密的來源 | ARCHITECTURE §7「一律 `wrangler secret put`」；本文件 §5 原本列六個 `secret put` | 四個（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、ADMIN_EMAIL、ANTHROPIC_API_KEY）可以放 GitHub secrets，每次部署後用 `wrangler secret bulk` 同步有值的（以 GitHub 為準）；也可以在 Cloudflare 儀表板手動設（類型 Secret）。GitHub 沒設的名稱不刪、不覆蓋 | 站主要求填在 GitHub 後一鍵上線；值只經過環境變數與 runner 暫存檔（umask 077、用完即刪），不上指令列、不進 log |
| SESSION_SECRET、LEDGER_SALT | 站主自己 `openssl rand` 後 `secret put` | workflow 在 `wrangler secret list` 沒有時才用 `openssl rand -base64 48／32` 產生；**讀不到清單就整步失敗、不產生** | 已有就覆蓋會讓所有人登出、帳本假名對不上 |
| 只設了一個 Cloudflare secret | 原本：視同沒設、略過 | 失敗 | 多半是名稱打錯，綠燈略過反而看不出來 |
| `/api/features` 與機密對不起來 | — | 依 Worker 上的機密名稱推算應有的 auth／ai（規則同 `config.ts`），不一致時每 5 秒重問、最多 1 分鐘，仍不一致只警告 | 新版本傳到各節點有延遲；站主可能故意不開 AI |
| 日誌的查詢字串 | ARCHITECTURE §9.1 | `redact_query_string = true` | `/auth/google/callback?code=…&state=…` 的授權碼不留在 Workers Logs |
| Vercel 是否快取代理的回應 | ARCHITECTURE §4.3 第 4 點列為待實測 | `/api`、`/auth` 明確關閉 rewrite caching | Vercel 2026-04-06 之後建立的專案預設會依上游 Cache-Control 快取外部 rewrites；Worker 已一律回 `no-store`，這是第二道保險（個人資料、輪詢） |
| CSP | ARCHITECTURE §7 | 這次沒加 | 要整個前端（含照片預覽的 blob:）一起驗，留給整合者 |

**給其他 agent 與整合者**

- 新增**機密**時，除了 `env.ts`＋`config.ts`＋`wrangler.toml` 註解，還要改 workflow「同步 Worker 機密」的 `NAMES` 與 `env:`、`docs/SETUP-KEYS.md` 的表格；`config.ts` 的 `auth.configured`／`ai.configured` 條件改了的話，workflow「部署後確認」的推算規則要一起改。
- 新增 Queue、R2 等綁定時，workflow 要加「準備」步驟（`wrangler deploy` 不會自動建立 Queue）。token 權限若要再加（例如 R2），寫進 SETUP-KEYS.md §1.4。
- `workflow_dispatch` 只對預設分支上的 workflow 有效：這批合併進 main 之後，站主才看得到「Run workflow」。
- 第一次部署後，workflow 的 Summary 會印出完整的 Worker 網址與子網域；`vercel.json` 兩處 `REPLACE_WITH_SUBDOMAIN` 照著換。
- 驗證方式（腳本在 scratch，沒有進 repo）：actionlint 1.7.7＋shellcheck 0.10.0 無警告；每個 `run` 片段 `bash -n`、`node -e` 片段 `node --check`；把每個 `run` 片段抽出來，用假的 `npx wrangler`／`curl`／`sleep` 跑 22 個情境（全新帳號、重跑不覆蓋 SESSION_SECRET、沒有子網域、token 或 Account ID 錯、secret list 失敗、Queue 分頁／名稱相近／清單漏列／表格帶色碼、workers.dev 延遲生效、features 延遲或對不起來、部署失敗不同步機密、值前後空白、格式警告、log 不含任何機密值）；另用真的 wrangler 4.148.0 對本機假 Cloudflare API（`CLOUDFLARE_API_BASE_URL`）跑 D1、Queue、機密同步三步，確認 `queues list` 表格與 `secret list` JSON 的實際格式和解析對得上。`wrangler deploy` 本身、真的 Cloudflare／Vercel／Google 環境沒有測（沒有金鑰）。

### 整合（前端：W1＋W2 接起來）

**契約**：沒有改 `packages/shared`，也沒有新的「前端需要」（W2 提的 `SubmissionDetail` 累計實扣點數仍是非必要）。

**接起來的地方**

| 項目 | 做法 |
|---|---|
| 導覽 | 帳號選單（W1）已有「我的帳號／AI 申請狀態／管理後台（只有 admin）」。另外：`/translation`、`/composition` 說明頁開頭加「現在就能練習」連到 `/writing/translation`、`/writing/essay`；`/settings` 的「帳號」區塊從「開發中」改成連到 `/account`、`/ai/apply`、`/writing`（未登入連到 `/account` 登入；`features.auth` 為 false 時顯示「即將開放」，不讀 `/api/me`） |
| 需要同意時的導向 | 一律帶 `next` 回到原頁：寫作頁的「前往同意」（`AiAccessNotice` 的 consent 狀態）、AI 端點回 `consent_required` 時的「前往同意」（`describeError` 新增選填的 `returnTo`）都改成 `welcomeHref(目前路徑)`；`/writing/submissions/:id` 登入了但還沒完成首次同意時直接導到 `/account/welcome?next=…`（原本會先打 API、拿到 403 才顯示錯誤）。AI 同意改版（`pending_ai_consents`）照 W1／W2 的約定帶到 `/ai/apply` |
| AI 未核准時的引導 | 寫作頁依 `ai_status` 說明並連到 `/ai/apply`（W2）；`/ai/apply` 在審核中／候補時加「先用自我檢核練習寫作」連回 `/writing`（已核准原本就有「前往寫作練習」） |
| e2e 的埠號 | `playwright.config.ts` 的 preview 埠可用 `E2E_PORT` 覆寫（預設仍是 4173）。同一台機器上別的 worktree 也在 4173 跑 `vite preview` 時，`reuseExistingServer` 會直接沿用、測到別人的建置產物 |

**e2e（`apps/web/tests/`，桌機與手機各跑一次）**

- `support/backend.ts`：有狀態的假 Worker。`page.route` 攔 `/api/*`、`/auth/*`，照契約回應並記錄每個請求（測試檢查前端送出的本體）；沒登記的路徑回統一格式的 404，瀏覽器會印 console error，測試就會失敗（新頁面多打了沒假造的 API 不會默默通過）。`features: 'not-deployed'` 讓所有 `/api`、`/auth` 回 HTML 404（Vercel 代理在 Worker 沒部署時的樣子）。
- `collectErrors(page, expectedFailures)`：Chromium 對每個 4xx／5xx 的 fetch 都會印一行「Failed to load resource」（網路層紀錄，程式擋不掉）；只有測試刻意讓它失敗、且網址符合的那幾支（後端沒部署時的 `/api/features`、首頁的 `/api/health`，額度不足的 `/api/ai/translation-grade`）略過，程式自己的 console.error 與 pageerror 一律算失敗。
- `account.spec.ts`：未登入（版面與寫作頁的登入連結都是 `/auth/google/start?next=<目前頁>`，點下去整頁跳轉）、首次登入（`pending_consents` → 自動導到 `/account/welcome?next=…` → 勾同意＋年齡區間＋暱稱 → `POST /api/me/consents` → 回原頁）、AI 申請（寫作頁 → `/ai/apply` → `POST /api/ai/apply` → 審核中 → 回寫作頁看到等待核准）、管理員（帳號選單 → `/admin` → 待審核列表 → 核准一位 → 列表與名額更新）、後端沒部署（`/account`、`/account/welcome`、`/ai/apply`、`/admin`、`/writing/submissions/:id` 都是「即將開放」、只打 `/api/features`）、只開登入沒開 AI（不打任何 `/api/ai/*`）。
- `writing.spec.ts`：後端沒部署（首頁「後端未連線」、寫作頁「AI 批改即將開放」、沒有登入連結、中譯英自我檢核算出自評分、只打 `/api/features` 與 `/api/health`）、中譯英 AI 批改（`POST /api/submissions` 的題組／小題 id → 202 → 輪詢 queued → graded → 總分、每句分數、原文加亮、扣分說明、AI 標示、實扣點數）、手寫作文拍照（測試裡用 canvas 畫一張 2000×1500 的 PNG → 前端縮成 1600×1200 的 JPEG（解析上傳的 multipart 確認格式、尺寸、≤1.2 MB、`ord=1`）→ 辨識中 → 逐行確認、點候選字解掉 `[[?]]` → `PUT …/confirm` → 送批改 → 四項分數與等級）、額度不足（429 `quota_day` → 「今日點數已用完，10/10（週六）00:00（台灣時間）重置」，作答保留，重送用 `PUT` 沿用同一份草稿）、輪詢遇到閘道 HTML 502 照常重試、批改中登入過期（停止輪詢、顯示重新登入與再試一次）。中譯英的兩個流程另外比對 `data/exams/parsed/gsat-115.json` 的官方參考譯文：畫面與 `/data/writing/translation.json` 都不能出現（D8）。
- 執行：`E2E_PORT=<沒人用的埠> npm run test:e2e -w @gsat/web -- --output=<暫存目錄>`（`--output` 避免和同一個 worktree 裡其他人跑的 Playwright 互相覆蓋 `test-results/`）。

**給站主與後端**

- 後端沒部署時，瀏覽器的 console 一定會有 `/api/features`（首頁另有 `/api/health`）的「Failed to load resource」：這是網路層紀錄、不是程式錯誤，畫面照常。要連這一行都沒有，只能讓代理在 Worker 沒部署時回 200 的 JSON。
- W1 提過的仍然成立：「關於」頁需要公布一個聯絡方式（隱私權說明寫了「其他請求請聯絡站主」）。

### 整合（後端整合者：A1＋A2＋D 合流）

**結論**：A1 與 A2 的介面一次就接得起來，沒有需要修的後端程式。session 中介層（A2 全部經 `requireUser()`／`requireAiApproved`／`getSessionUser()`，不自己解析 cookie）、AI 核准狀態（`requireAiApproved` 含 `pending_ai_consents` → `consent_required`；`/api/ai/quota` 的名額用 A1 的 `approvalSummary()`）、帳本假名（`ai_calls.user_ref` 用 A1 的 `userRef()`）、刪帳號（A1 的 `CASCADE_TABLES` 已含 A2 的 `submission_photo_temp`；`ai_ops` 去識別保留）、錯誤碼（全部在 `API_ERROR_CODES`，tsc 保證）、契約型別都一致；前端（W1、W2）呼叫的每一條路徑後端都有。§2 契約裡的端點全部已實作（`test/skeleton.test.ts` 已沒有 501）。

**改了的檔案（都不是共用檔）**

| 檔案 | 內容 |
|---|---|
| `apps/api/scripts/local-e2e.mjs`（新） | 本機端對端測試，見下 |
| `apps/api/package.json` | 新增 npm script `test:local-e2e`（只加不改） |
| `apps/api/src/auth/probe.ts`（新）、`src/auth/routes.ts`（A1 的檔，加一行 `authRoutes.route('/probe', probeRoutes)` 與檔頭一行註解） | 補上 ARCHITECTURE §4.3、§10.2 的 `/auth/probe`（原本沒有任何 agent 負責，D 與 SETUP-KEYS §9 都列為「代理行為還沒驗證」） |
| `apps/api/test/probe.test.ts`（新） | `/auth/probe` 的 4 個測試 |
| `docs/SETUP-KEYS.md`（D 的檔） | §6 第 3 點加「代理實測」三個步驟、§9 第一點指向它 |
| 本文件 | §2 表格加 `/auth/probe`、§7 的 Workers 實測結論、§8 加本機端對端、本節 |

共用檔案（`env.ts`、`config.ts`、`errors.ts`、`app.ts`、`index.ts`、`security.ts`、`packages/shared/src/*`）**沒有改**；沒有新環境變數、沒有新遷移。

**`/auth/probe`（過渡期的代理探針）**

- 只在 `PUBLIC_API_ORIGIN`（沒設＝`APP_ORIGIN`）等於 `APP_ORIGIN` 時開啟，也就是瀏覽器經 Vercel 同源代理的過渡期；買網域後 `PUBLIC_API_ORIGIN` 改成 `api.<網域>`，自動回 404（§10.2「正式期關閉」），不需要另外的開關或環境變數。
- `GET ?set=1` 種兩個 `__Host-gsat_probe_a／b`（HttpOnly、Secure、SameSite=Lax、10 分鐘）→ 下一個 `GET` 回 `{ cookies: { a, b } }`（§4.3 第 1 點：多個 Set-Cookie 是否原樣轉送）；`?clear=1` 清掉；`?delay=N`（1–60）等 N 秒才回（第 2 點）；`POST` 邊讀邊數、只回 `{ bytes }`、上限 3 MB、照常過 Origin 檢查（第 3 點）。第 4 點（快取）不測：`vercel.json` 已關 rewrite caching、Worker 一律 `no-store`。
- 不碰 D1、不讀 session、不記內容。站主的操作步驟寫在 SETUP-KEYS §6 第 3 點。

**本機端對端測試（`npm run test:local-e2e -w @gsat/api`）**

- 架構：同一支 Node 腳本啟動兩個本機 HTTP 伺服器——假 Google（`/auth` 帶授權碼跳回、`/token` 回 id_token，並檢查 client_id／secret、一次性授權碼、redirect_uri 一致）與假 Anthropic（`/v1/messages` 依系統提示判斷任務與評分框架、從 `<student_text>` 取學生文字，回 SSE 串流的結構化輸出；可以排「下一個某任務的請求」回 429 或拒答）——再 `wrangler d1 migrations apply --local` 到暫存目錄、啟動 `wrangler dev --local`（本機 D1＋Queue＋consumer）。
- 機密：每次產生新的隨機假值，寫進權限 600 的暫存 env 檔用 `--env-file` 傳入（wrangler 有 `--env-file` 時**不讀** `apps/api/.dev.vars`，站主本機的真金鑰不會被用到），Worker 起來後立刻刪檔；端點與允許來源（`APP_ORIGIN`、`ALLOWED_ORIGINS`、`GOOGLE_*_URL`、`ANTHROPIC_BASE_URL`）用 `--var`。wrangler 的環境拿掉 `CLOUDFLARE_API_TOKEN` 等帳號變數。
- 清理：wrangler 開在獨立的行程群組，結束時整組 SIGTERM（10 秒後 SIGKILL），workerd 一起收；成功、失敗、Ctrl-C 都會關掉兩個假伺服器並刪暫存目錄（含 D1 狀態）。已實測：中途 Ctrl-C → exit 130、失敗 → exit 1，兩種情況都沒有殘留行程與暫存目錄。`E2E_VERBOSE=1` 會同步印出 wrangler 的輸出。
- 流程與檢查（34 步，約 20 秒）：功能開關 → `/auth/probe`（兩個 Set-Cookie、1.25 MB、delay）→ 管理員 Google 登入（nonce cookie、回呼頁 CSP、回呼重送回 `auth_error=state`）→ `/api/me` 要求同意、需要登入的 API 403 `consent_required` → 同意 → ADMIN_EMAIL 自動成為 admin＋approved＋unlimited、`/api/admin/health` 全綠 → 中譯英（假 Anthropic 先回一次 429，SDK 自動重試）→ graded，兩位 5.5／6 → 5.75、各句 3.5／2.25、程式判定的大小寫與標點、錯誤位置 → 打字作文（第一次拒答 → failed、`refund_reason=refusal`、0 點；再送一次 → 14／12 → 13、fair，第二位故意給 `holistic_total=20` 不被採用）→ 手寫作文：上傳兩張帶 EXIF 的 JPEG（存檔前剝除、送給 Claude 的照片也沒有 EXIF）→ essay-ocr → `ocr_ready`（照片已刪、`[[?]]` 位置與候選字）→ 確認前 PUT 改字 409、帶 `[[?]]` 確認 400 → confirm → essay-grade → 13 → quota：19 點、作文 2 篇（退還的不算）→ 後台全站暫停：`aiPaused` true、送批改 503 `ai_paused`、恢復 → 學生登入與同意 → 未核准 403 `not_approved`、讀別人的提交 404 → apply → pending、學生打後台 403 → 管理員核准 → 學生送批改，第二位判全部漏譯（差距 >2）→ consumer 經 Queue 重送補第三位 → 5.5／0／6 取最近兩位 → 5.75 → 再 9 次用完 30 點 → 第 11 次 429 `quota_day`、提交仍是草稿 → `/api/admin/usage`：15 個任務、49 點、1 次退還 → logout-all 後舊 cookie 的 `/api/me` 是 `{user:null}`、需要登入的 API 401，管理員不受影響 → 學生重新登入（同一帳號）→ 匯出（11 份提交、10 份有批改、沒有內部欄位）→ 刪帳號 → 帳本仍有 15 個任務 → 管理員登出 → 假 Anthropic 沒有發現任何 §6.2 違規（model、`stream`、沒有 temperature 等、effort、json_schema、`fallbacks`＋beta 標頭、只有一則 user、cache_control、`<student_text>`、請求裡沒有任何 email／暱稱／public_id）→ Worker 日誌沒有預期外錯誤、沒有機密值、email、暱稱或學生文字，且有第三位的重送紀錄 → 關掉 wrangler → 用 `wrangler d1 execute --local` 事後查：照片暫存 0 列、`ai_calls.user_ref` 全是 64 碼假名、1 筆 refusal 安全事件、沒有殘留的全站暫停、學生的 10 筆 `ai_ops` 去識別保留、1 筆 `deletion_log`、學生的提交已刪。
- 預期分數由腳本自己依 SPEC §4.6 的規則寫死（不引用 Worker 的計分程式），所以計分規則被改壞時這支會失敗（已用「把預期改錯」驗證過會失敗並正常清理）。學生作答、作文、手寫轉錄都是本站自己寫的句子（D8）。
- 限制：只測本機（workerd＋miniflare 的 D1／Queue）；Vercel 代理、真的 Google 與 Anthropic 仍要部署後照 SETUP-KEYS §6 試一次。跨過台灣午夜執行時，額度相關的檢查可能因為換日而失敗（重跑即可）。

### 審查修正（前端：W1＋W2，兩位審查者的 23 項）

**契約**：沒有改 `packages/shared`。

**共用前端檔案的小幅新增（只加不改）**

- `apps/web/src/lib/api.ts`：`ApiRequestError` 加唯讀欄位 `nonJson`（建構子第 4 個參數 `{ nonJson? }`，選填，舊的呼叫不用改）；`api()` 遇到非 JSON 回應時設為 true。新匯出 `isGatewayError(err)`＝`nonJson && status >= 500`（Vercel 502／504、Cloudflare 1101／1102 的 HTML 錯誤頁）。理由：原本任何非 JSON 回應都是 `not_configured`，閘道的暫時性錯誤會被顯示成「AI 功能尚未開放」、輪詢也會永久停止。HTML 404（後端沒部署）與後端回 JSON 的 503 `not_configured` 行為不變。
- `apps/web/src/lib/apiErrors.ts`：`errorMessage()` 遇到 `isGatewayError` 顯示「伺服器暫時發生問題」。

**行為調整**

| 項目 | 做法 |
|---|---|
| 輪詢 | 閘道的非 JSON 5xx 不算致命錯誤（照節奏重試、顯示「連線不穩，正在重試…」）；停止時（401／403／404／`not_configured`）若已有資料，結果頁顯示錯誤原因（登入過期附「重新登入」）與「再試一次」，進行中的狀態改說「自動更新已停止」；「刪除這份紀錄」改看提交本身的狀態（進行中不顯示），不看輪詢有沒有在跑 |
| 錯誤訊息 | 閘道錯誤 →「伺服器暫時有問題，請稍後再試。」；送出作答時的連線或伺服器錯誤補一句「作答已保留；如果其實已經送出，再按一次會直接帶你到批改進度，不會重複扣點」。額度訊息改成只用 `resets_at` 組一句（「今日點數已用完，10/10（週六）00:00（台灣時間）重置」），`daily_limit` 也附重置時間；全站暫停說「最晚台灣時間明天 00:00 自動恢復」（A2 的語意）。所有寫作頁的錯誤（含辨識確認、刪除紀錄、我的寫作紀錄）都帶登入網址與回到哪裡 |
| `consent_required` | 先重新讀 `/api/me` 並套用到全站登入狀態，再決定：登入同意沒完成 → `/account/welcome?next=…`；`pending_ai_consents` 非空 → `/ai/apply`；看不出原因 → 歡迎頁（原本「已完成首次設定」就一律帶到 `/ai/apply`，條款在分頁開著時改版會帶到沒事可做的頁面） |
| 辨識確認 | 候選字跟著標記走（`lib/ocr.ts` 的 `matchMarks`：詞層級 LCS 對齊目前文字與 OCR 原文，換行不算），同一行多處時分成「第 1 處、第 2 處」，點哪一處換哪一處（`replaceMarkAt`）；「還原成辨識結果」要先確認；「未分段會扣 1 分」只在題目要求 ≥2 段時說 |
| 分段提醒 | 和 Worker 的 `essayDeductions` 同一條規則：要求 ≥2 段而不到 2 段才說會扣 1 分（`checkEssayLength().paragraphDeduction`）；段數多於要求只提醒段數 |
| 本機暫存 | 草稿在 `pagehide`、`visibilitychange → hidden` 時立刻寫入（不只元件卸載）；手寫作文「已確認」那一步的自評存在 `gsat-writing-self:v1:<提交 id>`，送出批改後清掉；登出（帳號選單、我的帳號、登出所有裝置）與刪除帳號時清掉這台裝置上所有 `gsat-writing-draft:v1:`、`gsat-writing-ocr:v1:`、`gsat-writing-self:v1:` 開頭的資料（文案已註明） |
| 照片 | 縮圖後短邊 <600 px 或長寬比 >3 時在預覽旁提醒，學生勾選「仍要送出辨識」才能上傳（`lib/photo.ts` 的 `photoQualityIssue`） |
| 無障礙與手機 | 「打字作答／拍照上傳」與「我的寫作紀錄」的種類改成 `aria-pressed` 切換按鈕（原本是沒有方向鍵操作的 tab）；`ConfirmButton` 取消或確定後焦點回到原按鈕、可選 `role=status` 的完成訊息，按鈕 ≥44 px；自我檢核展開後捲到面板並把焦點移到標題；中譯英作答框的名稱帶「第 N 句」；句型提示的 summary、錯誤編號上標加大可點範圍 |
| AI 標示 | 「我的寫作紀錄」的分數旁加小型 AI 標示（讀屏唸「AI 批改，僅供參考」）；中譯英每句卡片標題旁加 `AiBadge` |
| `/ai/apply` | 已登入時「目前狀態」排最前面，接著說明、最後申請表；使用須知收進 `<details>`；點數欄不斷行，照片辨識的說明改成表格下的註腳 |
| `/translation`、`/composition` | 依 `useFeatures()`：登入或 AI 沒開時說「AI 批改即將開放」，不叫學生「登入並通過申請」 |

**前端需要**

- 前端需要：回報 AI 不當內容的端點（ARCHITECTURE §10.4 的 `POST /api/ai/feedback-report`，SPEC §8.4「每則 AI 回饋旁有『回報不當內容』」）。MVP 契約沒有、後端也還沒做，結果頁先放「回報不當內容（即將開放）」的說明（不理會、可以刪除紀錄、告訴信任的老師或家人）；端點做好後改成表單。站上仍沒有聯絡方式（W1、整合者已提過），所以沒有放 mailto。

### A2 第二輪審查修正（後端 AI：兩位審查者的 14 項）——契約變更紀錄

**共用檔案與別人的檔案（只加不改名）**

| 檔案 | 改了什麼 |
|---|---|
| `packages/shared/src/writing.ts`（A2） | `EssayGradingResult` 加選填欄位 `explanations_from_excluded_rater?: boolean`（第一位評分者被「取最接近的兩位」排除時為 true，見下表）；`criteria` 的註解補充。沒有新錯誤碼、沒有新的退還原因 |
| `apps/api/src/app.ts`（共用） | `/api/*` 加一個中介層 `housekeeping`（`src/ai/housekeeping.ts`）：回應之後用 `waitUntil` 清過期照片、回收卡住的預扣；每個 isolate 每分鐘最多一次；沒有 ExecutionContext（單元測試的 `app.request`）或沒有 DB 綁定時什麼都不做 |
| `apps/api/src/account/validate.ts`（A1） | 新匯出 `readBodyBytes(c, maxBytes, message?)`：不論有沒有 Content-Length 都邊讀邊數，超過上限停止讀取、413；`readJsonBody` 改用它，多一個選填參數 `maxBytes`（預設仍是 16 KB）。行為差異只有一點：上限改以位元組計（原本是 `text.length`），A1 的欄位都很短，不受影響（A1 的測試全部照舊通過） |

`env.ts`、`config.ts`、`errors.ts`、`index.ts`、`security.ts`、`features.ts`、`api.ts` 沒有改；沒有新環境變數、沒有新遷移（0002 不動）。新檔：`src/ai/housekeeping.ts`、`test/ai.hardening.test.ts`。

**逐項處理**

| 審查發現 | 處理 |
|---|---|
| 照片「看不出是作文」一律退點，可以零成本無限呼叫 | 已修。仍然退還（`invalid_output`），但「內容造成的退還」（`refusal`、`invalid_output`、`max_tokens`）每人每天最多 5 次（guard.ts 的 `AI_REFUNDS_PER_DAY`；`RESERVE_SQL` 在 DB_SCHEMA §3.7 原文之外多一個條件，同一句 SQL 所以並行也不會超過），超過回 429 `rate_limited`，同一人同一天第一次擋下時寫 `ops_events(kind='ai_refund_limit', severity='warn')`。API 錯誤、逾時、暫停、排隊太久、內部錯誤的退還不算；管理員與 unlimited 不限。每次的成本最多一次預扣，一個帳號一天最多讓全站多花約 US$2.7 |
| 送批改時注入事件的寫入沒有保護；預扣之後的步驟失敗會留下永遠 reserved 的預扣（兩位審查者各報一次） | 已修。注入事件併進「更新提交」的同一個 batch（`INSERT … SELECT … WHERE` 提交真的改成這個操作）；batch 或 `AI_QUEUE.send` 失敗都退還、提交改回原狀態、500。另外補不靠 Cron 的回收（`housekeeping.ts`，ARCHITECTURE §3.6）：建立超過 30 分鐘仍 reserved，而且「提交不存在／指向別的操作／已不在進行中／從沒被 consumer 處理過（`tries = 0`）且沒有租約」，或建立超過 6 小時且沒有有效租約 → 退還 `expired`（前端顯示「排隊太久已取消」）、提交改 failed、寫 `ops_events(kind='ai_reserve_reclaimed')`。觸發點：送出 AI 任務前（同步，卡住的預扣不會讓這次 busy）、每個 /api 請求後、consumer 每批訊息處理完。回收的退還要求提交沒有有效租約、consumer 搶租約要求操作仍是 reserved，兩邊互斥。死信佇列改成逐則 try/catch，失敗的那則 `retry`、其他照常 ack |
| 寫入端點不檢查 Content-Type、不限本體大小（兩位審查者各報一次） | 已修。提交（POST／PUT／confirm）、AI 任務、後台暫停一律走 `readJsonBody`：只收 `application/json`（否則 400，不預扣）、邊讀邊數，上限提交 64 KB、AI 任務 4 KB、暫停 4 KB，超過 413。照片上傳：Content-Type 必須是 multipart；沒有 Content-Length 時邊讀邊數到 1.2 MB＋64 KB，超過 413，讀完才交給 multipart 解析 |
| 照片暫存沒有每人上限 | 已修。上傳時同一個交易裡：清過期照片 → 刪掉同一人其他提交（狀態不是 `ocr_queued`）的暫存照片 → 取代同一個 ord → 寫入，條件是這個人暫存未滿 4 張（`PHOTO_TEMP_MAX_PER_USER`），否則 409。每人最多 4.8 MB |
| OCR 系統提示沒有兒少安全段落、候選字沒有過濾（兩位審查者各報一次） | 已修。OCR 系統提示加 `OCR_CHILD_SAFETY`（轉錄版：只輸出轉錄、不加自己的內容與評語、候選字只能是筆跡的可能讀法；批改任務的 `SYSTEM_CHILD_SAFETY` 是評語用的，不適合轉錄）；規則測試涵蓋三種任務。候選字經過 `OutputFilter`（剝 HTML、網址、遮個資；不當內容整個候選丟掉並寫 `output_filtered`）。**例外（ARCHITECTURE §8.5）：轉錄本文是學生自己寫的字，和打字作文一樣不做類別過濾，只剝 HTML 標籤**——過濾會改掉要批改的內容 |
| 串流中途的錯誤一律判成不可重試 | 已修。SSE `error` 事件（SDK 丟 status 為 undefined 的 APIError）依錯誤類型判斷：`invalid_request_error`、`authentication_error`、`permission_error`、`not_found_error`、`billing_error`、`request_too_large` 不可重試（設定問題），其餘（`overloaded_error`、`api_error`、`rate_limit_error`、`timeout_error` 與不認得的）可重試，`error_code` 記 `stream_<類型>`；SDK 包成基底 `AnthropicError` 的斷線（`cause` 是 Error）與「stream ended」可重試（`stream_interrupted`）。都交給 Queue 重送（最多 4 次投遞後退還） |
| 呼叫被中止或串流中途出錯時成本記 0 | 已修。串流已經開始（收到 message_start）時，用 `currentMessage` 的 usage（輸入、快取 tokens 準確）加上「已收到的 text／thinking 文字 ÷ 3」估計的輸出記帳，`served_model` 一併記；還沒收到回應的 HTTP 錯誤不收費，仍記 0（不用 `inputTokensEstimate` 硬估，否則 529 這類沒有收費的錯誤會被多算）。沒串流出來的思考 tokens 估不到，由每日對帳補正 |
| 租約 600 秒比一次呼叫的期限短 | 已修。`LEASE_SECONDS` 改 900（≥ 牆鐘預算 14 分鐘＋60 秒；測試檢查這個關係）；等待租約的重送延遲上限跟著變 |
| 第一位評分者被排除時，說明仍取第一位 | 已修。中譯英：錯誤清單、修正版、說明取「被採用的兩位」裡排序最前的那位（每位的輸出格式相同）。作文：第二、三位只有分數與簡短評語，所以第一位被排除時各項說明、三個優先改進、逐段建議清空，`explanations_from_excluded_rater: true`；錯誤清單（文字本身的拼字、文法）與改寫範例和分數無關，照樣保留 |
| 照片中繼資料剝不掉或讀不到寬高時照樣收下 | 已修。`processImageMetadata` 回三種結果（剝掉了、本來就沒有、結構不認得），結構不認得 400；讀不到寬高（或寬高為 0）400；JPEG 標記前的 0xFF 填充位元組照規格跳過；另外剝 JPEG 的 APP13（IPTC）與 COM 註解、PNG 的 IEND 之後與 WebP 的 RIFF 長度之後的資料。舊的 `strip*` 函式保留（結構不認得時原樣回傳），上傳端點不再用 |
| 照片最長 24 小時要靠下一次上傳才清得掉 | 已修（盡量）。housekeeping 在每個 /api 請求後（每個 isolate 每分鐘最多一次）與 consumer 每批處理完都清；`essay-ocr` 的「有沒有照片」與 consumer 讀照片都不算已過期的。仍不是絕對保證：整站完全沒有流量時要等到下一個請求，真正的保證要 Cron（§1.2 延後） |

**和上游文件不同的決定（新增）**

| 項目 | 上游 | 這次的決定 | 理由 |
|---|---|---|---|
| 照片「看不出是作文」 | SPEC §8.3 的退點條件沒有這一項 | 退還，並受每日退還上限約束 | 照扣點的話提交是 failed，前端照契約顯示「點數已全額退還」（`REFUND_REASON_MESSAGES` 是 `Record<AiRefundReason>`，加新原因會讓前端型別檢查失敗）；拍糊的學生也不該被扣點。濫用由上限擋 |
| 每日退還上限 | DB_SCHEMA §3.7 的預扣 SQL 沒有 | 多一個條件（5 次） | 退還的任務不算點數，沒有上限就能零成本循環 |
| 租約 | ARCHITECTURE §6.8：10 分鐘 | 15 分鐘 | 要涵蓋一次 consumer 呼叫的牆鐘預算 |
| 預扣回收 | ARCHITECTURE §3.6：Worker Cron 每 5 分鐘 | 請求與 consumer 順手做（30 分鐘、6 小時兩種門檻） | MVP 沒有 Cron |

**給前端（W2）**

- `/api/ai/*` 回 429 `rate_limited` 也可能是「今天內容造成的退還次數已滿」（後端 message：「今天 AI 無法完成的次數太多了（照片看不出是作文、AI 無法批改等，每天最多 5 次），請明天再試」）。前端目前顯示「操作太頻繁，請稍等一下再試」，建議 AI 端點的 `rate_limited` 改說「請明天再試」。
- 照片：上傳到另一份提交時，同一人其他草稿（不在辨識中）的照片會被刪掉，回到那份草稿時 `photos` 是空的、要重新上傳；每人最多暫存 4 張，超過 409；照片結構不認得或讀不到寬高 400（前端重新編碼成 JPEG 的照片不會遇到）。
- `EssayGradingResult.explanations_from_excluded_rater` 為 true 時：各項說明是空字串、沒有三個優先改進與逐段建議。建議提示「詳細說明來自分數沒有被採用的評分者，已省略；請參考評分者的評語」。
- 寫入類請求一定要帶 `Content-Type: application/json`（`api()` 已經如此）。

**測試**：`test/ai.hardening.test.ts`（新，22 個情境；每一項先寫成失敗測試、確認在舊程式上失敗，再修）；`ai.rules`（三種任務的兒少安全段落、串流錯誤分類）、`ai.scoring`（被排除的評分者、OCR 候選字過濾）、`submissions`（JPEG 填充位元組、APP13／COM、結構不認得與讀不到寬高 400、PNG 尾端資料）各加案例。`npm run test:local-e2e -w @gsat/api` 34／34 通過。
