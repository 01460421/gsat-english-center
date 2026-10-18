# 自訂題目作文批改：前端盤點（web-map）

> 需求：學生自己輸入作文題目（或貼上老師、補習班、其他考卷的題目），寫完英文作文後送 AI 批改，品質和歷屆題、本站仿真作文題一樣。
> 這份文件只盤點 **apps/web** 現有的作文作答與批改介面，標出新功能要接在哪裡、哪些可以直接沿用、哪些一定要改。不改任何程式。
> 基準：分支 `customessay`＝`origin/main`（18e179a）。相關文件：`docs/design/ai-auth-mvp.md`（寫作與 AI 批改的契約）、`docs/design/bank-writing.md`（本站仿真題）、`docs/SPEC.md` §6.9、§8.4。
> 行號是寫這份文件時的行號，之後改程式可能位移。

**目錄**：[0. 摘要](#0-摘要)｜[1. 路由與頁面](#1-路由與頁面)｜[2. 資料載入](#2-資料載入)｜[3. 送出批改、輪詢、結果、草稿](#3-送出批改輪詢結果草稿)｜[4. 拍照 OCR 流程](#4-拍照-ocr-流程)｜[5. 測試](#5-測試)｜[6. 設計慣例](#6-設計慣例)｜[7. 自訂題目的接點與待決事項](#7-自訂題目的接點與待決事項)

---

## 0. 摘要

1. **批改這一半幾乎可以整段沿用。** 送出（`lib/submit.ts`）、輪詢（`lib/polling.ts`）、結果頁（`SubmissionResultPage`）、結果元件（`EssayResult`、`HighlightedText`）、自評（`EssaySelfAssess`）、拍照與辨識確認（`PhotoPicker`、`OcrConfirm`）、AI 權限與點數（`AiAccessPanel`、`lib/access.ts`）都只認「一份 `kind: 'essay'` 的提交」，不在意題目從哪裡來。
2. **題目這一半是寫死的。** 前端只認兩種題組 id：歷屆 `gsat-115.s8g1@1`（`features/writing/data.ts` 的 `parseGroupId`）與本站仿真 `ai.cp.0e1f2a@1`（`@gsat/shared` 的 `parseBankGroupId`）。題目文字一律來自建置時產生的靜態檔（`/data/writing/essay.json`、`/data/writing/bank/prompts/*`），結果頁也是用 group_id 回頭去靜態檔找題目。自訂題目不在任何靜態檔裡。
3. **最大的卡點在契約。** `POST /api/submissions` 只收 Worker 題目庫裡有的 group_id，其他一律回 400「沒有這個題組」（`apps/api/src/submissions/routes.ts:115-117`，`WRITING_UNKNOWN_GROUP_MESSAGE`）。`CreateSubmissionBody`、`EssayBody`、`SubmissionDetail`（`packages/shared/src/writing.ts:140-209`）也沒有放題目文字的欄位。前端要能送出自訂題目、結果頁要能顯示題目，`@gsat/shared` 的型別與 Worker 都要先改。
4. **一定要改的前端小工具**：`groupLabel`、`attemptPathOf`（`lib/format.ts:57-75`，決定結果頁標題、寫作紀錄的名稱、「回到題目再練一次」）、結果頁的 `usePromptFor`／`useBankPromptFor`（找題目、段數要求）、草稿鍵與型別（`lib/drafts.ts`）、路由（`App.tsx`）與入口（`/composition`、`/writing`、`SourceTabs`）。
5. **D8 與用語**：自訂題目框是學生貼上的任意文字，學生可能貼進大考中心的評分原則或佳作。前端拿不到官方文字（比對資料不能放進瀏覽器），只能提醒；真正的比對要在 Worker 做（共用 `packages/shared/scripts/bank-select.mjs` 的 `d8HitsInStrings`）。另外，現有寫作畫面的聲明文字裡有「大考中心」（例如 `AiNotice`「不是大考中心的正式評分」），和需求寫的「介面不出現大考中心」有落差，要站主決定（§6.3）。
6. **測試基礎都在**：單元測試用 `features/writing/testing/render.tsx` 的 `renderPage`＋`testing/fixtures.ts` 的假 fetch；e2e 用 `tests/support/backend.ts` 的 `FakeBackend`（沒登記的 `/api/*` 一律 404，會讓測試失敗），新端點都要登記。

---

## 1. 路由與頁面

### 1.1 路由表（`apps/web/src/App.tsx`）

所有頁面都是 `React.lazy` 按需載入，掛在 `Layout` 底下。題型頁（`/composition`）在 `modules.ts` 的 `PAGES` 裡（會出現在導覽列），寫作子頁不在（`App.tsx:44-68`）。

| 路徑 | 元件 | 檔案 | 說明 |
|---|---|---|---|
| `/composition` | `CompositionPage` | `pages/CompositionPage.tsx` | 英文作文題型頁：本站仿真題列表＋歷屆試題列表＋說明（`App.tsx:27`） |
| `/writing` | `WritingHomePage` | `features/writing/WritingHomePage.tsx` | 寫作練習首頁：入口卡、兩種批改方式、開通說明、點數、我的寫作紀錄 |
| `/writing/essay` | `EssayListPage` | `features/writing/EssayListPage.tsx` | 歷屆作文題目列表（`App.tsx:95`） |
| `/writing/essay/ai` | `BankEssayListPage` | `features/writing/bank/BankListPage.tsx` | 本站仿真作文列表（依難度，`App.tsx:96`） |
| `/writing/essay/ai/:code` | `BankEssayAttemptPage` | `features/writing/bank/BankEssayAttemptPage.tsx` | 本站仿真作文作答（`:code`＝uid 的 6 碼，`App.tsx:97`） |
| `/writing/essay/:examId` | `EssayAttemptPage` | `features/writing/EssayAttemptPage.tsx` | 歷屆作文作答（`App.tsx:98`） |
| `/writing/submissions/:id` | `SubmissionResultPage` | `features/writing/SubmissionResultPage.tsx` | 一份提交的進度與結果（中譯英、作文共用，`App.tsx:99`） |

- 靜態段（`ai`）比動態段（`:examId`）優先，註解特別說明歷屆考卷 id 不可能是 `ai`（`App.tsx:61-64`）。自訂題目若用 `/writing/essay/custom` 之類的靜態段，同樣不會撞到歷屆作答頁。
- 前端路由**不能用 `/auth` 開頭**（Vercel 把 `/auth/*` 轉給 Worker，`App.tsx:44-48`）。
- `modules.ts` 的 `PAGES` 與 `App.tsx` 的 `PAGE_COMPONENTS: Record<PagePath, …>` 對照，新增導覽列頁面時 tsc 會檢查（`App.tsx:8`、`16-33`）。子頁不必登記。

### 1.2 `/composition`（`pages/CompositionPage.tsx`）

`ModulePage` 頁首下面依序是：

1. `ListSection id="bank-questions"`「本站仿真題」（`:43-52`）：`AiGroupBadge`、一句說明、`BankPromptList section="composition" headingLevel={3} limit={6}`；標題旁 `JumpLink`「跳到歷屆試題」。
2. `ListSection id="exam-questions"`「歷屆試題」（`:53-56`）：`EssayPromptList headingLevel={3}`。
3. 兩個列表都包在 `<ListOrigin value="/composition">`（`:42`）：從這裡點進作答頁，返回連結回到 `/composition`（`lib/listOrigin.ts`）。
4. `InfoSection`「作答與批改方式」（`:58-85`）、「學測怎麼考」（`:86-90`）、「拍照上傳手寫作文」（`:91-116`）。文字依 `useFeatures()` 的 `auth && ai`（`aiOpen`）與 `ocr`（`photoOpen`）切換，後端沒開時說「即將開放」、不叫學生登入。點數用 `AI_TASK_POINTS.essay_grade`／`essay_ocr`。

自訂題目的入口最自然是在這裡加第三個 `ListSection`（或在本站仿真題上方放一張入口卡），並在「作答與批改方式」補一條說明。`tests/overview.spec.ts:335-353` 與 `src/features/writing/pages.test.tsx:119-458` 會檢查這一頁的區塊與文字，改版時要一起改。

### 1.3 `/writing/essay`（`EssayListPage.tsx`）與 `SourceTabs`

- 頁首 `BackLink`（回 `/writing`）、h1「英文作文題目」、`SourceTabs kind="essay" current="exam"`、說明、`EssayPromptList`（`:41-54`）。
- `EssayPromptList`（`:60-73`）：`useStaticData(loadEssayIndex)` → 載入中／錯誤（就地「再試一次」）／`EssayLists`；`KindFilter`（學測／指考／參考試卷，記在網址 `?kind=`，`components/KindFilter.tsx`）；每份考卷一個 `<section aria-labelledby>`，標題層級可傳 2 或 3；頁尾聲明（`:68-70`）。
- `PromptCard`（`:20-39`）：連到 `/writing/essay/{exam_id}`，帶 `state={useListOriginState()}`；顯示題型標籤（`ESSAY_TYPE_LABELS`）、補考、提示前三行、字數要求與圖數。

`SourceTabs`（`components/SourceTabs.tsx`）：「歷屆試題｜本站仿真」兩個 `<Link>`（換頁，不是 tab 元件），目前那一邊 `aria-current="page"`，外框 `nav aria-label="題目來源"`。`kind` 只有 `'translation' | 'essay'`、`current` 只有 `'exam' | 'bank'`（`:7`）；要加「自訂題目」這一格，型別與 `tabs` 陣列都要擴充，中譯英的列表頁也會一起受影響（中譯英沒有自訂題目時要能隱藏第三格）。

### 1.4 `EssayAttemptPage`（`/writing/essay/:examId`）

外層（`:36-68`）：`useStaticData(loadEssayIndex)` → `findEssayPrompt(index, examId)`；載入中、錯誤、找不到（`PromptNotFound`）各有自己的 `<title>` 與 h1；找到才掛 `<EssayAttempt key={exam_id}>`。返回連結用 `listOriginBack(location.state, { to: '/writing/essay', label: '英文作文題目' })`。

`EssayAttempt`（`:74-351`）由上而下：

| 區塊 | 行 | 內容 |
|---|---|---|
| header | `:167-174` | `<title>{題名} 英文作文｜寫作練習｜學測英文中心</title>`、題本標題、補考標籤、h1 |
| 題目 | `:176` | `<EssayPromptView prompt={prompt} />`（§1.5） |
| 作答方式切換 | `:179-191` | `role="group" aria-label="作答方式"`，兩顆 `aria-pressed` 按鈕「打字作答／拍照上傳手寫稿」，選擇記在草稿 `mode` |
| 打字作答 | `:193-274` | `<section aria-label="打字作答">`：textarea（16 行、`englishInputProps`）、即時字數與段數（`aria-live="polite"`）、少於 120 字、未分段、超過上限三種提醒、個資提醒、草稿是否存得進去、「自我檢核與自評（不用 AI）」切換鈕、「送出 AI 批改（7 點）」（只有 `access.state === 'ready'` 才出現）、`AiNotice`＋`QuotaSummary` 或 `AiAccessNotice compact`、錯誤、`ConfirmButton`「清除重寫」 |
| 拍照上傳 | `:276-333` | 三種情況：可用（`AiNotice`、`PhotoPicker`、照片隱私、流程與點數、照片品質風險勾選、「上傳並辨識（2 點）」）；已核准但 `features.ocr` 關（「拍照上傳即將開放」）；沒有權限（說明＋`AiAccessNotice compact`） |
| 自評面板 | `:336-346` | 打開後用 `useRevealOnOpen` 捲過去並把焦點移到標題；`EssaySelfAssess`（含檢核清單） |
| 頁尾 | `:348` | `SourceNote`（「題目來源：大學入學考試中心 …」＋官方題本、答題卷、評分原則的**連結**） |

送出與錯誤處理見 §3.2。自訂題目的作答頁大致可以照這個版型，差別：題目區換成「題目輸入框＋（選填）段數與字數要求」；頁尾不能用 `SourceNote`（那是歷屆題的出處）；`checkEssayLength` 的段數參數要另外決定（§3.8）。

### 1.5 `EssayPromptView`（`components/EssayPromptView.tsx`）

`<section aria-label="題目" class=card>`：`instructions`（`whitespace-pre-line`）→ `passage`（`RichText`）→ `stem`（`RichText`）→ 圖（`FigureView`：figcaption、`sr-only`「圖片的文字描述：」＋描述；有 `rows` 時畫成 `<table>`，外框 `role="region" tabIndex={0} overflow-x-auto`）→「要求：至少 120 個單詞・2 段」（`essayRequirement`）。看圖題附「原圖請看官方題本 PDF」連結（`:66-74`）。

- 只吃 `EssayPrompt` 型別（`data.ts:81-93`），帶 `exam_id`、`paper_url` 等歷屆專用欄位；自訂題目不能直接傳進來。
- `RichText`（`features/exams/components/RichText.tsx`）會把 `[[11]]` 解析成空格、`<u>`／`<b>` 畫成底線粗體。**學生貼上的題目不該經過 `RichText`**：用一般文字節點加 `whitespace-pre-line` 就好（本站仿真作文的題目就是這樣，`BankEssayAttemptPage.tsx:90`）。

### 1.6 `AiAccessPanel`（`components/AiAccessPanel.tsx`）與 `lib/access.ts`

`aiAccessOf(features, me, loading)`（`lib/access.ts:29-40`）的判斷順序與畫面：

| state | 條件 | `AiAccessNotice` 顯示 |
|---|---|---|
| `loading` | `/api/me` 還沒回來 | 不顯示 |
| `off` | `features.auth` 或 `features.ai` 為 false | 「AI 批改即將開放。」（`compact` 時只接一句自我檢核） |
| `signed_out` | 未登入 | 「用 Google 登入」（`loginHref(目前路徑)`）＋「申請 AI 批改」 |
| `account_suspended` | 帳號停權 | 警告 |
| `consent` | 首次同意未完成或條款改版 | 「前往同意」（`welcomeHref(目前路徑)`，同意完回到原頁） |
| `apply` | `ai_status !== 'approved'` | 依 `none／pending／waitlist／rejected／suspended` 各一段（`:87-131`） |
| `ai_consent` | 已核准但 AI 資料處理說明改版 | 「前往重新同意」→ `/ai/apply` |
| `paused` | 全站暫停 | `AI_PAUSED_MESSAGE` |
| `ready` | 可用（附 `ocr: features.ocr`） | 不顯示（呼叫端顯示送出按鈕） |

- 前端只負責「顯不顯示按鈕」。真正的權限在 Worker：AI 端點掛 `requireAiApproved`，額度走 ledger／pricing／guard 的原子預扣，擋下時回 `not_approved`、`quota_day` 等代碼，前端用 `describeError` 轉成中文（§3.7）。
- `QuotaSummary`（`:141-162`）：「AI 點數：今天剩 N／M 點・本月剩…・今天已批改作文 k／3 篇・{重置時間} 重置」，`data-testid="quota-summary"`；管理員的超大上限顯示「不限」（`isUnlimited`，門檻 1 億）。
- `taskPoints(quota, task)`（`:165-167`）：按鈕上的點數，優先用後端 `quota.task_points`，沒有時用 `AI_TASK_POINTS`（`essay_grade` 7、`essay_ocr` 2）。
- `useQuota(enabled)`（`lib/hooks.ts:46-69`）：`GET /api/ai/quota`，失敗就當沒有資料（只是資訊）；`refresh()` 給額度錯誤時重抓重置時間。

自訂題目若沿用 `essay_grade` 任務，這一整組不用改。若後端另開任務（例如自訂題目多一步「審題」），`AiTaskPath`（`lib/writingApi.ts:102`）、`AI_TASKS`／`AI_TASK_POINTS`（`packages/shared/src/writing.ts:521-528`）、`taskPoints` 的鍵、說明文字的點數都要跟著加。

### 1.7 `OcrConfirm`（`components/OcrConfirm.tsx`）

只在結果頁、提交狀態是 `ocr_ready` 時出現（`SubmissionResultPage.tsx:405-413`）。詳細流程見 §4。版面重點：

- `<section aria-labelledby>` 標題「確認辨識文字」＋`AiBadge`；四點說明（只修正辨識錯、**自己寫錯的拼字與文法要保留**、黃色是看不清楚的 `[[?]]`、照片已刪除）。
- 編輯方式切換 `role="group" aria-label="編輯方式"`：「逐行確認」（每行一個 textarea＋`<label>第 N 行…</label>`，看不清楚的行加底色、`MarkedLine` 標位置、候選字按鈕）／「整篇一起編輯」。
- 下方即時字數與段數（`aria-live`）、未處理數（紅字）、段數扣分提醒（只有 `requiredParagraphs ≥ 2` 才說）、超過上限；「確認文字」在有 `[[?]]`、空白或太長時停用；`ConfirmButton`「還原成辨識結果」。
- props：`submission`、`ocr`、`onConfirmed`、`requiredParagraphs`（題目要求的段數，null＝不檢查）、`errorContext`。

自訂題目可以原樣沿用；`requiredParagraphs` 改由自訂題目的設定提供（§3.8）。

### 1.8 `EssayResult`（`components/EssayResult.tsx`）

props 只有 `grading: EssayGradingResult`、`text`、`selfAssess`（`:62-70`），和題目無關，可以原樣沿用。由上而下：

1. `SafetyCare`（`safety_flag` 不是 null／none 時）：關懷訊息與 1925、1995、1980、113 專線（`:30-56`）。
2. 「總分」卡（`<section aria-labelledby="e-total">`）：`final_score ／ 20`、等級（`bandLabel`）、自評總分、離題提醒（`:107-109`，「AI 判斷這篇作文離題（沒有回應題目的要求）…」）、四項分數 `<dl>`、字數與扣分（`DEDUCTION_TEXT`）。
3. 「先改這三個就好」（`top_improvements`）。
4. 「各項說明」：四項 `explanation_zh`，有自評時附「（自評 N）」；第一位評分者被排除時說明省略（`explanations_from_excluded_rater`）。
5. 「評分者」：每位評分者四項與總分的表格（`<th scope>`、外框 `role="region" tabIndex={0}`）＋評語。
6. `<details>`「逐段建議（N）」。
7. `<details>`「標出的錯誤（N）」：依類型篩選（`aria-pressed` 按鈕）、`HighlightedText`、錯誤清單（`id="e-err-{n}"`，原文刪除線 → 建議，`sr-only`「建議改成」）。
8. `<details>`「保留原意的參考改寫」。

每個 AI 產生的區塊旁都有 `AiBadge`「AI 批改，僅供參考」。自訂題目最常見的情況是離題判斷（題目由學生自己輸入、AI 讀得懂才判得準），`off_topic` 的文字可以沿用。

### 1.9 `EssaySelfAssess`（`components/EssaySelfAssess.tsx`）

- 不用 AI 的自我檢核＋四項自評（各 0–5，radio 包在 `<label>` 裡畫成圓鈕，`has-[:checked]` 上色，`has-[:focus-visible]` 外框）。四項都評完才算一份自評（`completeEssayScores`，`lib/drafts.ts:61-70`），送 AI 時附在 `PUT …{ self_assess }`，結果頁對照。
- 兩種用法：歷屆題傳 `onToggle` 顯示 `ESSAY_CHECKLIST`（`lib/checklists.ts:61-68`，本站撰寫）；本站仿真題傳 `criteria`（本題的 `focus_zh`）取代通用提示、不顯示檢核清單（`:22-39`）。
- 每項旁的通用提示 `CRITERION_HINTS`（`:15-20`）是「官方四項的白話說明（本站整理，不是評分原則原文）」。
- 標題層級可傳 2 或 3（放在本站題「評分規準與範文」h2 底下時是 3）。

自訂題目可以沿用通用版（`onToggle`＋檢核清單）。如果要給學生看「本站自己寫的評分規準」，現成的有 `features/mock/selfAssess.ts:53-98` 的 `COMPOSITION_CRITERIA`（四項、優 5–4／可 3／差 2–1／劣 0 的本站描述，模擬考自評用），可以搬到共用位置再引用，不要另寫一份。

### 1.10 `SourceTabs`

見 §1.3。

### 1.11 `HighlightedText`（`components/HighlightedText.tsx`）＋`lib/highlight.ts`

- 在學生原文（`<p lang="en" whitespace-pre-wrap>`）上用 `<mark>` 標出錯誤：波浪底線＋類別底色，**不只靠顏色**；每個錯誤最後一段後面接上標編號 `<a href="#{idPrefix}-{n}">`，用 `::before` 把點擊範圍放大到約 24 px；`sr-only`「（錯誤 n：類別）」。
- `placeErrors` → `locateSpan`：位移對得上 `excerpt` 就用；對不上就在附近找 `excerpt`；找不到就只列在清單、不在原文上標（`lib/highlight.ts:17-25`）。`segmentText` 處理重疊。
- 類別文字 `ERROR_CATEGORY_LABELS`、底色 `CATEGORY_CLASS`（中譯英與作文共用）。

### 1.12 `SubmissionResultPage`（`/writing/submissions/:id`）

外層閘門（`:50-94`）：載入中 → `features.auth` 關（顯示「即將開放」，**不打 API**）→ 未登入（「用 Google 登入」）→ 還沒同意（`<Navigate>` 到歡迎頁）→ `SubmissionView`。

`SubmissionView`（`:228-541`）組合的資料：

| hook | 行 | 做什麼 |
|---|---|---|
| `useSubmissionPoller(id)` | `:230` | 輪詢 `GET /api/submissions/{id}`（§3.4） |
| `useAiAccess`、`useQuota` | `:232-233` | 權限與點數；graded／failed 時重抓點數（`:249-252`） |
| `usePromptFor(detail)` | `:148-175` | 歷屆題：`parseGroupId` → 下載 `/data/writing/essay.json` 找題目（失敗就不顯示） |
| `useBankPromptFor(group_id)` | `:116-145` | 本站題：`parseBankGroupId` → 先讀 index 確認版本 → 版本相同才讀 prompts 檔；分 current／outdated／removed／unavailable |
| `useChargedPoints(op_id, graded)` | `:178-192` | `GET /api/ai/ops/{op_id}` 拿實扣點數 |
| `selfDraftKey(id)`＋`useAutosave` | `:241-244` | 手寫作文「已確認」那一步的自評暫存 |

畫面依 `detail.status` 分支（`:383-530`）：

| status | 畫面 |
|---|---|
| `draft` | 「這份作答還沒有送出批改」；照片模式已上傳照片就給「送出辨識（2 點）」，否則「回到作答頁」 |
| `ocr_queued` | `Pending`「AI 正在辨識你的手寫字…」 |
| `ocr_ready` | `OcrConfirm` |
| `confirmed` | 「已確認的作文」＋`EssaySelfAssess`＋「送出 AI 批改（7 點）」 |
| `queued`／`grading` | `Pending`「排隊等待批改…」／「AI 批改中…」 |
| `failed` | 原因（`refundReasonMessage`）＋「點數已全額退還」；辨識失敗回作答頁重拍，批改失敗給「重新送出批改」 |
| `graded` | 扣點說明＋`QuotaSummary`＋`EssayResult`（或 `TranslationResult`）＋`ReportAiContent`＋本站題的 `BankAnswersPanel`＋「回到題目再練一次」 |
| `self_graded` | 「這份作答是自評，沒有使用 AI 批改」 |

其他：標題 `heading = groupLabel(group_id) + KIND_LABELS[kind] (+ 主題)`（`:318`）；`isAiPage` 時頂端放 `AiNotice`（`:346`）；題目以 `<details>`「題目」收合顯示 `essayStem`（`:362-367`）；不在辨識或批改中時可以「刪除這份紀錄」（`:534-538`）。

**自訂題目在這一頁會遇到的問題**（以現在的程式推演）：
- `groupLabel(group_id)`：兩種格式都不符時原樣顯示 group_id（`lib/format.ts:58-62`），標題會變成一串代碼。若自訂 id 剛好符合 `parseGroupId` 的正規式（`^[a-z0-9-]+\.[A-Za-z0-9_]+@\d+$`，例如 `custom.x1@1`），會被當成歷屆題、去下載 `essay.json` 找考卷、`examIdLabel` 原樣回傳 `custom`、「回到題目」連到 `/writing/essay/custom`。**自訂 id 的格式要刻意避開這兩個正規式，或在兩個函式最前面先判斷自訂格式。**
- `essayStem`、`requiredParagraphs` 只從靜態檔來（`:321-322`）：自訂題目沒有，題目不會顯示，`OcrConfirm` 也不會提醒段數。需要後端在 `SubmissionDetail` 回傳題目文字（與段數要求）。
- `attemptPathOf` 回 null 時「回到作答頁」「回到題目再練一次」都不顯示（`:391-395`、`:510-516`）。自訂題目可以回到自訂題目的作答頁，並把原題目帶回去（例如用 `?from={submission_id}` 或草稿）。

### 1.13 本站仿真作文作答頁（對照用，`bank/BankEssayAttemptPage.tsx`）

和歷屆作答頁共用 `lib/submit.ts`、`lib/writingApi.ts`、`PhotoPicker`、`AiAccessPanel`，差異：題目區自己畫（`EssayPromptSection`，`:83-110`，題目用純文字＋`BankFigure` 的 `<img>`）、鷹架與三層提示、「寫好了，看評分規準與範文」對照（之後作答唯讀、才下載 answers 檔）、草稿多了 `revealedAt`／`aiSubmittedAt`／`lastSubmissionId`（「看上次的批改結果」連結，`:343-350`）、Worker 不認得題組時的特殊錯誤（`bank/errors.ts`）。檔頭寫明「歷屆的 EssayAttemptPage 一行都沒改」（`:9`）：自訂題目也建議照這個做法，**另開一頁**，不要在 `EssayAttemptPage` 裡加分支。

---

## 2. 資料載入

### 2.1 載入層（`src/data/client.ts`）

- `fetchDataFile(path, guard)`：抓 `${BASE_URL}data/{path}`，404 或拿到 HTML（SPA fallback）→ `DataLoadError('not_found')`；其他 HTTP 錯 → `'http'`；解析或守衛失敗 → `'format'`；連不上 → `'network'`（`:75-96`）。錯誤訊息是可以直接顯示的中文（`dataErrorMessage`）。
- `memoizeAsync`：同一個 key 永遠回同一個 Promise（成功或失敗都快取），失敗的要等使用者按「再試一次」呼叫 `forgetFailedLoads()` 才重抓（`:105-132`；理由見檔頭：避免 Suspense 重繪時無限重打 404）。
- 寫作頁不用 `use()`＋Suspense，而是 `useStaticData(load)`（`features/writing/lib/hooks.ts:15-40`）：回 `{status: loading|ready|error, retry}`，錯誤只出現在資料那一塊、頁首照常。
- 資料檔在 `public/data/`，由 `scripts/build-data.mjs` 在 `predev`／`prebuild` 產生，不進版控（`public/` 現在只有圖示與 manifest）。

### 2.2 歷屆作文：`/data/writing/essay.json`

- 產生：`build-data.mjs` 的 `buildWriting`（`:879-956`）從已刪除受保護欄位的考卷內容逐欄挑出（`:935-950`）：說明、題組選文、提示、圖的文字描述（`kind／label／caption／description／rows`，**不含原圖**）、題型、段數、字數要求、官方題本／答題卷／評分原則的 **URL**；輸出在 `:999`。
- 型別：`EssayIndex { version, count, prompts: EssayPrompt[] }`（`features/writing/data.ts:72-99`）。型別刻意沒有答案類欄位（`:7-9`），`scripts/check-data-contract.mjs` 用這些型別檢查實際 JSON。
- 載入：`loadEssayIndex()`（`:118-120`，memoize）；`findEssayPrompt(index, examId)`；送後端的 id 用 `groupIdOf(prompt)`＝`writingGroupId(exam_id, group_id)` → `'gsat-115.s8g1@1'`（`:132-134`）。
- 使用者：`EssayPromptList`、`EssayAttemptPage`、`SubmissionResultPage.usePromptFor`。

### 2.3 本站仿真題：`/data/writing/bank/`

由 `scripts/lib/writing-bank.mjs` 在建置時產生（`build-data.mjs:972`、`:1000-1006`），輸出前跑 D8 第 4 道檢查（`:1008-1009`）。檔案（`bank/data.ts:4-8`）：

| 檔案 | 什麼時候下載 | 內容 |
|---|---|---|
| `index.json` | 列表頁、作答頁、結果頁一開始 | 每組 `{ uid, version, section_type, tier, topic }` |
| `list/composition-{basic\|advanced\|top}.json` | 列表切到那個難度時 | 卡片（主題、題型、提示前 60 字、圖數） |
| `prompts/{uid}@{v}.json` | 進作答頁 | 本站的作答說明、提示、清理過的 SVG 圖與文字描述、`moves`、鷹架、提示 |
| `answers/{uid}@{v}.json` | **按下「對照」之後**（或結果頁展開參考內容） | 本站撰寫的四項評分重點與分數帶、扣分說明、兩篇範文 |

- 載入順序：`useBankItem(section, code)`（`bank/useBankItem.ts:21-32`）先用 `uidOfCode` 驗證網址代碼 → 讀 index 找版本 → 讀 prompts。組網址前先驗證參數，路由參數不可能變成別的路徑（`bank/data.ts:11-12`、`245-259`）。
- group_id＝`'{uid}@{version}'`，例如 `ai.cp.0e1f2a@1`（`parseBankGroupId`，`packages/shared/src/bank.ts:54`）。
- 「對照前不下載 answers」由單元測試與 e2e 檢查（§5）。

### 2.4 結果頁怎麼找回題目

見 §1.12 的 `usePromptFor` 與 `useBankPromptFor`：**都是用 group_id 回頭去靜態檔找**，提交本身（`SubmissionDetail`）不帶題目文字。

### 2.5 對自訂題目的影響

- 自訂題目不會、也不該進靜態檔（內容是使用者的）。題目要存在提交裡（D1），由 API 回傳；前端結果頁、寫作紀錄改從 API 讀。
- `SubmissionSummary`（寫作紀錄的一列）也沒有題目欄位；紀錄列表要顯示「自訂題目：{題目前幾個字}」的話，`GET /api/submissions` 也要回一小段題目摘要，否則只能顯示「自訂題目 英文作文」。
- 不需要動 `build-data.mjs` 與資料契約檢查。

---

## 3. 送出批改、輪詢、結果、草稿

### 3.1 API 薄包裝（`features/writing/lib/writingApi.ts`）

全部走 `lib/api.ts` 的 `api()`：同源相對路徑 `/api/...`（Vite proxy／Vercel rewrites 轉給 Worker）、`credentials`、JSON 或 `FormData`、回應不是 JSON → `ApiRequestError(status, 'not_configured', …, { nonJson: true })`、錯誤本體 `{ error: { code, message } }` → `ApiRequestError(status, code, message)`（`lib/api.ts:71-95`）。每支只做最上層形狀檢查（`expect(body, guard)`）。

| 函式 | 端點 | 用在 |
|---|---|---|
| `createSubmission` | `POST /api/submissions`（`CreateSubmissionBody`）→ 201 `SubmissionDetail` | `upsertSubmission` |
| `updateSubmission` | `PUT /api/submissions/{id}`（`UpdateSubmissionBody`） | 沿用草稿、附自評 |
| `getSubmission` | `GET /api/submissions/{id}` | 輪詢 |
| `deleteSubmission` | `DELETE /api/submissions/{id}` | 結果頁刪除 |
| `listSubmissions` | `GET /api/submissions?kind=&cursor=` | `SubmissionHistory` |
| `uploadPhoto` | `POST /api/submissions/{id}/photos?ord=1\|2`（multipart 欄位 `photo`，檔名 `essay-{ord}.jpg`） | 拍照 |
| `deletePhotos` | `DELETE /api/submissions/{id}/photos` | 重送時清掉多的照片 |
| `confirmOcr` | `PUT /api/submissions/{id}/confirm`（`{ text }`） | `OcrConfirm` |
| `startAiTask` | `POST /api/ai/{translation-grade\|essay-grade\|essay-ocr}`（`{ submission_id }`）→ 202 | `startTask` |
| `getQuota` | `GET /api/ai/quota` | `useQuota` |
| `getAiOp` | `GET /api/ai/ops/{op_id}` | 結果頁實扣點數 |

### 3.2 打字作文的送出流程（`EssayAttemptPage.tsx:116-130`）

```
submitTyped:
  body = { text: draft.text.trim() }
  submission = upsertSubmission(draft.submissionId,
                 { kind: 'essay', group_id, input_mode: 'typed', body },   // POST 用
                 { body })                                                  // PUT 用
  草稿記下 submissionId（失敗重送時沿用，不在後端留一堆草稿）
  saveSelfAssessment(id, selfAssess)   // 四項都評了才 PUT { self_assess }；失敗不擋
  startTask('essay-grade', id)         // 409（已在排隊）不算失敗
  草稿的 submissionId 清掉（文字留著），navigate('/writing/submissions/{id}')
```

- `upsertSubmission`（`lib/submit.ts:54-83`）：有舊 id 先 PUT；PUT 回 409 時**先 GET 那一份的狀態**，已經送出（`ocr_queued／ocr_ready／confirmed／queued／grading`）或已批改且內容相同 → 丟 `AlreadySubmittedError`，頁面直接導到那一份（避免回應遺失時重複扣點）；404 或內容改過 → 建新的。
- 失敗處理 `fail(err)`（`EssayAttemptPage.tsx:103-114`）：`AlreadySubmittedError` → 導過去；額度錯誤先 `refreshQuota()` 拿重置時間；其他用 `useErrorView()` 轉成 `ErrorView`（帶登入網址、`me`、`returnTo`，`submitting: true` 時補「作答已保留…不會重複扣點」）。本站題另外先過 `bankErrorView`（400「沒有這個題組」→「這題的 AI 批改還在準備中」；409「找不到這份提交的題目」→「這題已經更新成新版本」）。
- 按鈕狀態：`busy` 字串直接當按鈕文字（「送出中…」「上傳第 1／2 張照片…」「送出辨識…」），送出中停用。

### 3.3 後端對題組的要求（卡點）

- `POST /api/submissions` 用 `getWritingGroup(group_id)` 查 Worker 打包的題目庫，查不到回 400 `WRITING_UNKNOWN_GROUP_MESSAGE`（`apps/api/src/submissions/routes.ts:114-117`）；題組種類要和 `kind` 一致（`:118`）；照片模式建立時 `text` 必須是空的（`:132`）。
- `CreateSubmissionBody`（`packages/shared/src/writing.ts:151-163`）只有 `kind／group_id／input_mode／body`；`EssayBody` 只有 `text` 與選填 `plan`（`:140-143`，`plan` 註明「只存不送模型」）。
- 所以前端**沒有任何管道**把自訂題目送給 Worker。要先決定契約（例如 `CreateSubmissionBody` 加一個 `kind: 'essay'` 的自訂變體帶 `custom_prompt: { text, paragraphs?, word_min? }`，或另開端點），`SubmissionDetail` 回傳題目，再改前端。這部分屬於 api 與 shared 的設計，前端只列需求。

### 3.4 狀態輪詢（`lib/polling.ts`＋`lib/hooks.ts:72-96`）

- `SubmissionPoller`：不依賴 React 的狀態機，計時器可注入（單元測試用假計時器）。`start()` 立刻問一次；狀態在 `SUBMISSION_PENDING_STATUSES`（`ocr_queued／queued／grading`）就照節奏再問，其他狀態停在 `idle`。
- 節奏：開始後 3 分鐘內每 2 秒（`POLL_FAST_*`），之後每 15 秒（`POLL_SLOW_INTERVAL_MS`），`speed: 'slow'` 時畫面提示「比平常久一些，可以先離開，完成後回來看」（`SubmissionResultPage.tsx:217-223`）。
- 錯誤：第一次就失敗 → `phase: 'error'`；已有資料後的暫時錯誤（網路、5xx、閘道的 HTML 502／504）→ 保留資料、記下錯誤、照節奏重試，畫面顯示「連線不穩，正在重試…」；401／403／404／JSON 的 `not_configured` → 停止（`isFatalPollError`，`:45-49`），畫面顯示原因與「再試一次」，`Pending` 改說「自動更新已停止」。
- `restart(detail?)`：送出新任務或手動重試後重設 3 分鐘快速期；`accept(detail)`：直接套用 `PUT confirm` 的回應。
- `consent_required`：`useRefreshMeOnConsentError` 重新讀 `/api/me`，需要同意時頁面自己導到歡迎頁（`lib/useErrorView.ts:54-59`）。

自訂題目完全沿用，不用改。

### 3.5 結果顯示

見 §1.8 與 §1.12。graded 時另有「這次批改扣 N 點（照片辨識另計 2 點）」（`:485-497`）與 `ReportAiContent`（「回報不當內容・即將開放」，`components/ui.tsx:48-65`）。

### 3.6 草稿保存（localStorage）

`lib/drafts.ts`：所有讀寫包 try/catch，失敗只回 false，畫面改說「這個瀏覽器無法儲存草稿（可能是無痕模式）」；**照片不存**（太大、也是個資）。

| 鍵 | 寫入者 | 內容 |
|---|---|---|
| `gsat-writing-draft:v1:essay:{group_id}` | 歷屆作答頁 | `EssayDraft { text, mode, submissionId, selfScores, checked, updatedAt }`（`:72-80`，守衛 `isEssayDraft` 很嚴格，多一個欄位型別不對就整份丟掉） |
| 同上（group_id 是 `ai.cp.xxxxxx@v`） | 本站作答頁 | `BankEssayDraft`（多 `hintLevel／revealedAt／aiSubmittedAt／lastSubmissionId`；`toBankEssayDraft` 寬鬆補預設值，文字不會因其他欄位壞掉而丟失，`bank/drafts.ts:97-110`） |
| `gsat-writing-ocr:v1:{submission_id}` | `OcrConfirm` | 確認到一半的修改 `{ mode, lines, full }` |
| `gsat-writing-self:v1:{submission_id}` | 結果頁 confirmed 步驟 | `SelfDraft { scores, checked }` |

- `useAutosave(key, value)`（`lib/hooks.ts:128-182`）：值改變後 600 ms 寫入；`pagehide`、`visibilitychange → hidden`、元件卸載時立刻寫入；`discard()` 丟掉還沒寫的變更（送出或清除後不要又寫回去）；回傳 `ok` 給畫面提示。第一次繪製不寫回。
- `clearLocalWritingData()`（`:31-43`）：依前綴清掉所有寫作暫存，登出、刪帳號、清除資料時呼叫（`features/account/LoginButton.tsx:138`、`AccountPage.tsx:307`、`DataSections.tsx:104`）。
- 「清除重寫」用 `ConfirmButton` 先確認，再 `clearDraft(key)`。

### 3.7 錯誤訊息（`lib/errors.ts`）

`describeError(err, ctx)`（`:101-140`）只依錯誤代碼給中文，不顯示後端英文：連線失敗、閘道 5xx、`quota_day／quota_month／daily_limit`（組成「今日點數已用完，10/10（週六）00:00（台灣時間）重置」）、`ai_paused`、`not_approved`（附「申請 AI 批改」）、`consent_required`（依 `me` 判斷去歡迎頁或 `/ai/apply`）、其他 AI 閘門代碼（`AI_ERROR_MESSAGES`）、`unauthorized／reauth_required`（附「重新登入」）、`conflict`、`payload_too_large`、`not_found`、`rate_limited`、`bad_request`（「送出的內容格式不正確，請重新整理頁面再試一次。」）、`forbidden`。失敗原因 `REFUND_REASON_MESSAGES`（`:148-157`）。

自訂題目新增的驗證錯誤（題目空白、太長、疑似貼了評分原則或範文）如果只回 `bad_request`，學生會看到「請重新整理頁面」，不對。要嘛後端用新的錯誤代碼並加進 `API_ERROR_CODES`，要嘛像 `bankErrorView` 一樣比對共用的訊息常數（`WRITING_UNKNOWN_GROUP_MESSAGE` 的做法）。

### 3.8 對自訂題目的影響

| 項目 | 現況 | 自訂題目要做的 |
|---|---|---|
| 字數段數檢查 | `checkEssayLength(text, expectedParagraphs)`（`lib/text.ts:53-78`）；第二個參數**省略時預設 2**（`ESSAY_EXPECTED_PARAGRAPHS`），傳 `null` 才不檢查段數 | 明確傳入學生設定的段數或 `null`，不要省略；和 Worker 的未分段扣分規則一致 |
| 字數上限 | 600 單詞、4,000 字元（`packages/shared/src/writing.ts:88-89`） | 沿用；題目文字另訂上限（前端 textarea 的 `maxLength`＋後端 413） |
| 送出流程 | `upsertSubmission`＋`saveSelfAssessment`＋`startTask('essay-grade')` | 沿用；`create` 參數改成自訂變體 |
| 草稿 | 鍵依 group_id、`EssayDraft` 守衛嚴格 | 自訂題目在送出前沒有 group_id：草稿鍵用固定值（例如 `…:essay:custom`，一次一份）或前端產生的 id；型別仿 `BankEssayDraft` 寬鬆補值，多存 `prompt` 與段數設定；沿用 `gsat-writing-draft:v1:` 前綴，登出時才會一起清掉（題目可能含學校、老師名字） |
| 再寫一次 | `attemptPathOf` 指回作答頁 | 指回自訂作答頁並帶回原題目 |

---

## 4. 拍照 OCR 流程

流程（打字以外的另一條路，只有作文有）：

1. **選照片**（`components/PhotoPicker.tsx`）：兩個隱藏的 `<input type=file>`：「拍照」（`capture="environment"`）與「從相簿選擇」（`multiple`），最多 `PHOTO_MAX_COUNT`＝2 張，多選的不加入並提示；兩張時可「對調順序」；每張有預覽 `<img alt="第 N 張作文照片預覽">`、尺寸與大小、「移除」。
2. **前端縮圖**（`lib/photo.ts`）：`createImageBitmap`（依 EXIF 轉正）或 `<img>` 解碼 → canvas（先鋪白底）→ 長邊 ≤1600 px、JPEG、品質 0.9 起逐步降到 ≤1.2 MB，還太大就再縮尺寸，長邊小於 800 仍太大就放棄（`compressToLimit`，純函式可單元測試）。重新編碼順便去掉 EXIF。原圖不離開裝置。
3. **品質提醒**：縮圖後短邊 <600 px 或長寬比 >3 → 「照片太小／太窄長，AI 很可能辨識不出來」，學生要勾「仍要送出辨識」才能上傳（`EssayAttemptPage.tsx:300-310`；避免白扣點數）。
4. **上傳並辨識**（`EssayAttemptPage.tsx:132-152`）：`upsertSubmission(photoSubmissionId, { …, input_mode: 'photo', body: { text: '' } })`（不沿用打字草稿的 id）→ 伺服器上的照片比這次多就先 `deletePhotos` → 逐張 `uploadPhoto(id, ord, blob)` → `startTask('essay-ocr')` → 導到結果頁。照片只在記憶體（`PickedPhoto.blob`），離開頁面時釋放預覽 URL（`:97`）。
5. **辨識中**：結果頁輪詢，`ocr_queued` 顯示「AI 正在辨識你的手寫字…」。
6. **確認文字**（`OcrConfirm`，`ocr_ready`）：OCR 只轉錄、保留錯字，看不清楚處標 `[[?]]`，`OcrResult.uncertain` 給位置與候選字。逐行模式每行可改、點候選字只換那一處（`replaceMarkAt`）；切到「整篇一起編輯」增刪行後，候選字仍跟著原本那一處（`lib/ocr.ts` 的 `matchMarks` 用詞層級 LCS 對齊）。修改存在 `gsat-writing-ocr:v1:{id}`。全部 `[[?]]` 處理完、非空、不超長才能「確認文字」→ `PUT …/confirm`（伺服器記錄差異、立即刪除照片）→ `accept(detail)`。照片辨識的文字段落**只認空白行**（`checkEssayLength(text, requiredParagraphs, true)`）。
7. **自評＋送批改**（`confirmed`）：顯示已確認的作文與字數段數、`EssaySelfAssess`（暫存在 `gsat-writing-self:v1:{id}`）、「送出 AI 批改（7 點）」→ `saveSelfAssessment` → `startTask('essay-grade')` → 清掉自評暫存 → `restart()` 輪詢（`SubmissionResultPage.tsx:286-296`）。
8. **失敗**：辨識失敗（照片模式、文字仍空）→「照片已刪除，請回到作答頁重新拍照上傳」；批改失敗 → 「重新送出批改」；點數一律全額退還。

照片隱私文字在作答頁（`EssayAttemptPage.tsx:288-295`）、題型頁（`CompositionPage.tsx:91-116`）與 `features/account/policy.ts` 第五點，三處要一致（`CompositionPage.tsx:16` 的註解有寫）。

**對自訂題目的影響**：整條流程靠 submission id 串起來，自訂題目只要能建立 `input_mode: 'photo'` 的提交就能沿用。需要補的只有：結果頁的 `requiredParagraphs` 改從提交讀（§1.12）、「回到作答頁」重拍時要帶回自訂題目。**現有 OCR 只辨識作文，不辨識題目**；如果站主想讓學生拍題目照片，是另一個 AI 任務（另外的點數、另外的 D8 問題），建議第一版不做，題目只能打字或貼上。

---

## 5. 測試

### 5.1 Vitest 設定

- `vite.config.ts:43-49`：`environment: 'happy-dom'`、`include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts']`、`setupFiles: ['./src/test/setup.ts']`、`css: false`。沒開 globals。
- `src/test/setup.ts`：jest-dom 斷言；每個測試後 `cleanup()`、`vi.unstubAllGlobals()`、`vi.restoreAllMocks()`、`localStorage.clear()`。
- 執行：`npm test -w @gsat/web`（`vitest run`）、`npm run typecheck -w @gsat/web`。

### 5.2 寫作頁的測試工具（API 怎麼 mock）

- `features/writing/testing/fixtures.ts`
  - `createFetchMock(routes)`：依「方法＋路徑（含或不含查詢字串）」找處理函式，沒有對應的一律回 404 `{ error: { code: 'not_found' } }`；每次呼叫記在 `calls`（`method`、`path`、解析後的 `body`，`FormData` 原樣保留）（`:289-308`）。
  - `baseRoutes(features, me)`：`/data/writing/translation.json`、`/data/writing/essay.json`、本站題全部靜態檔（`bankRoutes()`，直接匯入 `tests/fixtures/bank-writing-public` 的建置範例輸出）、`/api/features`、`/api/me`、`/api/ai/quota`（`:311-320`）。
  - 假資料：`FEATURES_ON／OFF`、`meWith(aiStatus)`、`QUOTA`、`PROMPT_115`（115 學測作文題）、`ESSAY_INDEX`、`ESSAY_TEXT`、`ESSAY_GRADING`、`essaySubmission(patch)`、`translationSubmission(patch)`、`BANK_*`。
  - 工具：`jsonResponse(body, status)`、`apiError(status, code)`。
- `features/writing/testing/render.tsx`
  - `renderPage(path, routes, pages)`：`vi.stubGlobal('fetch', …)`＋`MemoryRouter`＋`SessionProvider`（真的去打假的 `/api/features`、`/api/me`）＋指定的 `<Route>`＋`LocationProbe`（`data-testid="location"`，檢查送出後導到哪裡）。
  - `apiCallsExceptSession(mock)`：除了功能開關與登入狀態以外打了哪些 API（「後端沒開時不打寫作 API」這類斷言）。
- 照片縮圖要 canvas，happy-dom 沒有：作答頁測試用 `vi.mock('./lib/photo', …)` 只換掉 `resizePhotoFile`，檔名含 `tiny` 模擬太小的照片（`attempt.test.tsx:12-28`；`bank/BankEssayAttemptPage.test.tsx:15` 同樣做法）。純函式另有 `lib/photo.test.ts`。
- 每個檔案 `afterEach(clearDataCache)`，避免 `memoizeAsync` 的快取跨測試。

### 5.3 現有單元測試（作文相關）

| 檔案 | 涵蓋 |
|---|---|
| `features/writing/attempt.test.tsx` | `EssayAttemptPage`：題目與圖的文字描述、官方題本連結、字數提醒；超過 600 不能送；打字送 AI 附自評、導到結果頁；分段提醒和後端一致；作答方式是 `aria-pressed` 按鈕不是 tab；照片太小要勾選；後端未開放；拍照上傳全流程（POST 順序、`FormData` 的 `photo` 欄位） |
| `features/writing/SubmissionResultPage.test.tsx` | 功能關閉不打 API、未登入、未同意；中譯英已批改；輪詢到完成；手寫作文確認文字 → confirm → 自評 → 批改；失敗退點與重送；額度不足；閘道 502 繼續輪詢；401 停止輪詢；候選字分組、增刪行；還原要確認；確認時登入過期；自評暫存；`consent_required`；404；本站題（版本、下架、prompts 404） |
| `features/writing/components/results.test.tsx` | `EssayResult`：總分、等級、四項、自評、扣分、評分者、錯誤篩選、身心安全、排除的評分者、離題；`QuotaSummary` |
| `features/writing/pages.test.tsx` | `WritingHomePage`（各開通狀態、紀錄）、`/composition` 與 `/translation` 題型頁（列表、返回連結、本站題難度、說明文字）、`EssayListPage` |
| `features/writing/bank/BankEssayAttemptPage.test.tsx` | 本站作文：讀題、SVG 只用 `<img>`、鷹架與提示、對照前不下載 answers、少於 100 字確認、拍照、打字送 AI、代碼不對 |
| `features/writing/lib/*.test.ts` | `helpers.test.ts`（加亮、OCR 對齊、`describeError`、`aiAccessOf`、草稿、group id、`listOriginBack`）、`polling.test.ts`、`submit.test.ts`、`text.test.ts`、`photo.test.ts` |

### 5.4 e2e（`apps/web/tests`，Playwright）

- `playwright.config.ts`：測**建置後**的產物（`vite preview`，預設埠 4173，`E2E_PORT` 可換）；`desktop` 1280×900 與 `mobile` 375×667 各跑一次；`locale: 'zh-TW'`、`timezoneId: 'Asia/Taipei'`。根目錄 `npm run test:e2e` 會先建置。
- 假後端 `tests/support/backend.ts`：
  - `FakeBackend` 用 `page.route` 攔截所有 `/api/*`、`/auth/*`（`:192-217`），預設登記 `/api/features`、`/api/health`、`/api/me`、`/api/ai/quota`、`GET /api/submissions`、假的 Google 登入頁；`on('POST /api/submissions', handler)` 後登記的優先，可覆寫；處理函式可以有狀態（例如依序回 queued → graded）。
  - **沒登記的路徑回統一格式的 404，瀏覽器會印 console error，`collectErrors` 抓到就讓測試失敗**（`:1-9`）——新頁面多打一支沒假造的 API，測試會直接失敗。
  - `features: 'not-deployed'`：所有 `/api`、`/auth` 回 HTML 404（Worker 沒部署時的樣子）。
  - `callsTo(method, path)` 檢查前端送了什麼（`json`、`query`、`request.postDataBuffer()`）。
  - `collectErrors(page, expectedFailures)`、`expectNoHorizontalOverflow(page, isMobile)`（手機另縮到 320 px 檢查，WCAG 1.4.10）。
- 靜態資料：`writing.spec.ts` 用**真的建置資料**（`/data/writing/*.json` 不攔截）；`writing-bank.spec.ts` 用 `mockWritingBank(page, patch?)` 把 `/data/writing/bank/**` 換成 `tests/fixtures/bank-writing-public`（`:45-53`），並用 `trackBankRequests` 檢查下載過哪些檔。
- 作文相關流程：
  - `writing.spec.ts:380-504`「手寫作文拍照」：在瀏覽器裡用 canvas 畫一張 2000×1500 的 PNG → 上傳 → 檢查 multipart 是 JPEG、1600×1200、≤1.2 MB、`ord=1` → 辨識中 → 點候選字 → 確認 → 送批改 → 四項分數、扣點文字、不水平捲動、沒有 console error。
  - `writing.spec.ts:508-540`「額度不足」（以中譯英為例）：429 `quota_day` → 中文原因與重置時間 → 重送用 PUT 沿用同一份。
  - `writing-bank.spec.ts`：功能全關的對照流程、SVG 安全、深色模式、AI 批改、Worker 不認得題組、題型頁返回連結、正式建置資料沒有官方參考譯文（`:487-506`）。
  - `smoke.spec.ts`（每個 `PAGES` 路由：h1、`<title>`、導覽、`/composition` 有連到 `/writing/essay/` 的連結，`:71`、`:109`）、`overview.spec.ts:335-353`（`/composition` 功能全開時的說明）。
- D8 檢查：`writing.spec.ts:26-43` 讀 `data/exams/parsed/gsat-115.json` 的官方參考譯文，畫面不能出現；`writing-bank.spec.ts:66-85` 掃全部考卷，並檢查畫面沒有「題目來源：大學入學考試中心」。

### 5.5 其他守門測試

- `apps/web/scripts/source-scan.test.ts`：`src/**` 不准出現 `dangerouslySetInnerHTML`、`.innerHTML =`、`insertAdjacentHTML`、`new DOMParser`、`createContextualFragment`。自訂題目文字一律用 React 文字節點顯示，這支會自動把關。
- `scripts/check-data-contract.mjs`、`scripts/lib/*.test.ts`：靜態資料與型別一致（自訂題目不走靜態資料，不受影響）。
- `App.tsx` 的 `Record<PagePath, …>`：新增導覽頁時 tsc 檢查。

### 5.6 自訂題目的測試建議（照現有慣例）

- 單元：新作答頁（題目輸入與上限、字數段數提醒依自訂設定、草稿含題目並在登出時被清、送出的 `CreateSubmissionBody`、後端未開放不打 API、未核准顯示開通說明、題目驗證錯誤的中文訊息）；結果頁（從 `SubmissionDetail` 顯示自訂題目、`groupLabel`／`attemptPathOf` 對自訂 id、`OcrConfirm` 的段數提醒）；`SubmissionHistory` 的名稱。
- `fixtures.ts` 加 `customEssaySubmission(patch)`；`baseRoutes` 不用改（自訂題目沒有靜態檔）。
- e2e：在 `FakeBackend` 登記新端點；打字與拍照各一條「自訂題目 → 送出 → 輪詢 → 結果」；`expectNoHorizontalOverflow`（貼上很長、沒有空白的題目也不能撐破版面，記得 `break-words`）；畫面上不出現「大考中心」（若站主採嚴格解讀，§6.3）。
- D8：前端拿不到官方文字，不能做真正的比對；e2e 只能驗證「後端回 D8 錯誤時前端怎麼顯示」，比對本身的測試放在 api／shared。

---

## 6. 設計慣例

### 6.1 元件風格

- **Tailwind v4＋CSS 變數**：顏色只用 `src/index.css` 的語意 token（`bg／surface／surface-2／fg／muted／line／primary／primary-soft／on-primary／badge-bg／badge-fg／ok／bad`），深色模式由 `prefers-color-scheme` 與 `<html data-theme>` 兩組定義（`:46-96`）。不寫死色碼（唯一例外是 SVG 圖框的白底）。
- **共用 class 常數**（`features/writing/components/ui.tsx:7-22`）：`primaryButton`（實心圓角膠囊、`min-h-11`）、`secondaryButton`（外框膠囊）、`textInput`、`card`（`rounded-2xl border border-line bg-surface p-4 lg:p-5`）、`englishInputProps`（英文作答框關掉拼字檢查、自動大寫、自動完成，`lang="en"`）。
- **共用小元件**（同檔）：`AiBadge`（完整版／`compact`）、`AiNotice`、`Notice`（`info／warn／error／ok` 四種色調）、`ErrorMessage`（`role="alert"`＋下一步連結）、`BackLink`、`ExternalA`（新分頁＋`sr-only`「（另開新分頁）」）、`Loading`（`role="status"`）、`ConfirmButton`、`DataError`（就地「再試一次」）、`ReportAiContent`。
- 版面：頁面是 `<article>`，區塊之間 `space-y-4`；每個區塊一張 `card`；切換按鈕與標籤用 `rounded-full`；數字用 `tabular-nums`；圖示用 `lucide-react` 並一律 `aria-hidden`。
- 頁面標題用 React 19 的 `<title>` 元素寫在元件裡：`{頁名}｜寫作練習｜學測英文中心`（`APP_NAME` 來自 `modules.ts:10`）。
- 新頁面一律 `React.lazy` 按需載入；寫作首頁刻意不匯入題庫資料與 practice 模組，避免 chunk 變大（`WritingHomePage.tsx:4-6`、`lib/format.ts:67`）。自訂題目的作答頁也應該是獨立 chunk。

### 6.2 無障礙

- 互斥切換用 `role="group"`＋`aria-pressed` 的按鈕，**不用 `role="tab"`**（沒有方向鍵操作的 tab 會誤導讀屏；`EssayAttemptPage.tsx:178`，測試 `attempt.test.tsx:359-370` 會檢查）。單選清單（難度、考試、自評分數）用 `fieldset`＋`legend`＋視覺隱藏的 radio，樣式靠 `has-[:checked]`、`has-[:focus-visible]`。
- 即時資訊用 `aria-live="polite"`（字數、自評總分、輪詢中）；狀態用 `role="status"`，錯誤用 `role="alert"`。
- 展開面板：按鈕有 `aria-expanded`／`aria-controls`，打開後 `useRevealOnOpen` 捲過去並把焦點移到面板標題（手機上面板常落在底部導覽列後面）。
- `ConfirmButton`：按下後焦點移到「確定」，取消或確定後回到原按鈕，`doneMessage` 用 `role="status"` 唸出結果。
- 文字欄位都有 `<label htmlFor>`；字數說明用 `aria-describedby`；唯讀的作答框用 `readOnly` 不用 `disabled`（讀屏才讀得到）。
- 英文內容標 `lang="en"`（作答框、原文加亮、改寫、候選字），中文介面裡夾英文時讀屏才會換發音。學生貼上的題目可能是中文、英文或混合，不要整塊標 `lang="en"`。
- 區塊用 `<section aria-labelledby>` 或 `aria-label` 命名（e2e 用 `getByRole('region', { name })` 找區塊）；標題階層：h1 頁名、h2 區塊、h3 子項。
- 表格：`<th scope>`，寬表格外包 `role="region" tabIndex={0} overflow-x-auto`，只在框內捲動。
- 錯誤標示不只靠顏色（波浪底線＋編號）；上標連結用 `::before` 放大點擊範圍；觸控目標至少 `min-h-11`（44 px），次要的 `min-h-9`。
- 動畫 `motion-reduce:animate-none`；手機 375 px 與 320 px 都不能水平捲動（e2e 會檢查）。

### 6.3 文字用語

- 全部繁體中文、台灣用語：「單詞」（英文 word，字數）與「字元」（長度上限）分開用；「點」是 AI 點數；「送出 AI 批改（7 點）」按鈕上直接寫點數；「草稿會自動存在這台裝置」；「打字作答／拍照上傳手寫稿」；「自我檢核與自評（不用 AI）」；「本站仿真」「本站撰寫」；「即將開放」（後端沒開）；「出題中」（題庫還沒題）。
- AI 標示（SPEC §8.4）：每則 AI 產生的內容旁 `AiBadge`「AI 批改，僅供參考」；AI 頁頂端 `AiNotice`「你正在和 AI 互動：AI 評分僅供參考，不是大考中心的正式評分。」；範文「AI 生成範文，僅供參考」。
- 錯誤訊息只依代碼給中文、附下一步，不顯示後端英文（§3.7）。
- **「大考中心」的現況與落差**：`modules.ts:9-10` 規定 App 名稱不能含「大考中心」「CEEC」，SPEC 的禁止清單也只限「網域、App 名稱、Logo」（`docs/SPEC.md:355`），`docs/design/bank-writing.md` §6「商標」寫的是「只在聲明裡寫『不是大考中心的試題』『不是大考中心的正式評分』」。所以現有寫作畫面的**聲明與出處**裡有這幾個字，例如：
  - `components/ui.tsx:72` `AiNotice`（所有 AI 頁共用）；
  - `components/SourceNote.tsx:9`「題目來源：大學入學考試中心 …」（歷屆作答頁頁尾）；
  - `EssayListPage.tsx:69`、`WritingHomePage.tsx:63,92,101`、`pages/CompositionPage.tsx:48,73`、`bank/labels.ts:39`、`bank/components/EssayReveal.tsx:87`、`bank/BankListPage.tsx:319-320`。

  需求寫的是「網站名稱、介面不出現『大考中心』或 CEEC」，若照字面解讀，比現行做法嚴。建議：自訂題目新寫的文案一律不提（說「本站的評分規準」「不是正式考試的評分」即可）；自訂頁沿用 `AiNotice` 就會帶進一句，要嘛站主確認聲明句不算，要嘛給 `AiNotice` 加一個不提名稱的版本（改共用元件會影響所有 AI 頁與既有測試的文字斷言）。**這是待決事項。**

### 6.4 D8 在前端的防線（現況）

- 型別刻意沒有答案、評分原則欄位（`data.ts:7-9`），建置時再比對一次（`build-data.mjs:1008-1009`）。
- 歷屆題只放官方檔案**連結**（`SourceNote`、`EssayPromptView` 的官方題本），不轉載內容。
- 自評提示、檢核清單、模擬考的作文規準都標明「本站整理／本站自己的描述」（`EssaySelfAssess.tsx:14`、`lib/checklists.ts:1-4`、`features/mock/selfAssess.ts:52`）。
- 本站仿真題的評分規準與範文是本站撰寫，作答前不下載。
- e2e 比對畫面與公開資料檔沒有官方參考譯文（§5.4）。

自訂題目多出一個新的入口：**學生自己貼進來的文字**。前端能做的只有：題目框旁說明「只貼題目，不要貼評分原則、參考答案或範文」、限制長度、送出後顯示後端的 D8 錯誤。比對官方文字必須在 Worker 做：官方評分原則與佳作不能放進前端 bundle 或公開資料（放了本身就違反 D8），可以共用 `packages/shared/scripts/bank-select.mjs` 的 `d8HitsInStrings`（`:817`）。另外，結果頁會把題目顯示回去（只給本人看），一樣要等後端確認不違反 D8 才存。

---

## 7. 自訂題目的接點與待決事項

### 7.1 可以原樣沿用

| 檔案 | 用途 |
|---|---|
| `lib/submit.ts`、`lib/writingApi.ts`、`lib/polling.ts`、`lib/hooks.ts` | 送出、重送防重複扣點、輪詢、點數、自動存檔（`create` 參數換成自訂變體即可） |
| `components/EssayResult.tsx`、`HighlightedText.tsx`、`lib/highlight.ts` | 結果顯示 |
| `components/EssaySelfAssess.tsx`、`lib/checklists.ts` | 自評與檢核清單（通用版） |
| `components/PhotoPicker.tsx`、`lib/photo.ts`、`components/OcrConfirm.tsx`、`lib/ocr.ts` | 拍照、縮圖、辨識確認 |
| `components/AiAccessPanel.tsx`、`lib/access.ts`、`lib/errors.ts`、`lib/useErrorView.ts` | 權限、點數、錯誤訊息（新錯誤代碼要補） |
| `components/ui.tsx` | 樣式與小元件（`AiNotice` 的用語見 §6.3） |

### 7.2 要改或新增

| 檔案 | 要做的 |
|---|---|
| `packages/shared/src/writing.ts` | 自訂題目的建立參數、`SubmissionDetail`／`SubmissionSummary` 回傳題目（或摘要）、自訂 group id 的格式與判斷函式（前後端共用） |
| `App.tsx` | 新路由（例如 `/writing/essay/custom`，靜態段優先於 `:examId`）；lazy 載入 |
| 新檔：自訂作答頁（例如 `features/writing/custom/CustomEssayAttemptPage.tsx`） | 題目輸入（純文字顯示、不經 `RichText`、`break-words`）、選填段數與字數要求、打字與拍照兩種作答、自評、送出；版型照 `EssayAttemptPage`，不在原頁加分支 |
| 新檔：自訂草稿（仿 `bank/drafts.ts`） | 寬鬆的型別守衛、沿用 `gsat-writing-draft:v1:` 前綴 |
| `lib/format.ts` | `groupLabel`（「自訂題目」）、`attemptPathOf`（回自訂作答頁）；先判斷自訂格式，避免被 `parseGroupId` 誤認 |
| `SubmissionResultPage.tsx` | 題目、段數要求改從 `detail` 讀（自訂題目時）；標題；「回到題目再練一次」帶回原題 |
| `components/SubmissionHistory.tsx` | 自訂題目那一列的名稱（`groupLabel`），可加題目摘要 |
| `pages/CompositionPage.tsx`、`WritingHomePage.tsx`、`components/SourceTabs.tsx`、`EssayListPage.tsx` | 入口與說明文字；`SourceTabs` 型別擴充或改放入口卡 |
| `lib/errors.ts`（或仿 `bank/errors.ts`） | 題目驗證、D8 命中的中文訊息 |
| 測試 | `testing/fixtures.ts`、新頁的單元測試、`tests/` 新 e2e、`overview.spec.ts`／`pages.test.tsx` 的文字斷言 |

### 7.3 待決事項（要站主或 api 設計一起定）

1. **契約**：自訂題目怎麼送（擴充 `POST /api/submissions` 或新端點）、題目上限（字元數）、要不要同時收段數與字數要求、group_id 格式（要避開 `parseGroupId`／`parseBankGroupId` 的正規式，`item_groups` 外鍵怎麼處理）。
2. **段數扣分規則**：自訂題目沒有官方段數要求時，`no_paragraphs` 扣分要不要套用；前端 `checkEssayLength` 與 `OcrConfirm` 要跟 Worker 用同一個值。
3. **看圖寫作**：學生的題目可能寫「如圖」，但沒有圖。第一版建議只收文字，畫面提醒「題目有圖的話，請用文字描述圖片內容」。
4. **D8**：Worker 端比對學生貼上的題目（評分原則、佳作原文），命中時拒收並回明確代碼；前端只顯示訊息。題目要不要存、存多久（和 `essay_retention` 一起）。
5. **「大考中心」字樣**：§6.3 的嚴格或現行解讀；`AiNotice` 是否需要不提名稱的版本。
6. **點數**：沿用 `essay_grade` 7 點與每天 3 篇的作文篇數上限，或另訂（影響 `AI_TASK_POINTS`、`ESSAY_FAMILY_TASKS`、說明文字）。
7. **入口位置**：`/composition` 第三區、`/writing` 入口卡、`SourceTabs` 第三格，三者擇一或並存。
8. **拍題目照片**：第一版不做（另一個 AI 任務與 D8 風險）。
