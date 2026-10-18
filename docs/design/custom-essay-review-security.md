# 英文作文自訂題目 AI 批改：設計審查（安全與濫用）

> 審查對象：`docs/design/custom-essay.md`（2026-10-18 第 1 版）。對照：`docs/analysis/custom-essay/api-map.md`、`web-map.md` 與實際程式碼。
> 基準：分支 `customessay`＝`origin/main` 的 `18e179a`。下文的「設計 :行」是設計文件的行號，其他是 repo 根目錄起算的 `檔案:行`。
> 角度：提示注入、題目欄被當成通用 AI、費用爆量、XSS、個資與刪除、D1 遷移風險、和現有 guard／filter／ledger 的一致性。
> 嚴重度：**blocker**＝不改就不能開工；**major**＝開工前要改設計（多半只動一兩段與幾個測試）；**minor**＝實作時一起處理，或列為後續。
> 本文只提意見，沒有改設計文件與程式。

---

## 0. 總評

沒有 blocker。整體方向在安全上是對的：

- 沿用 `essay_grade` 與同一句原子預扣（`apps/api/src/ai/guard.ts:84-100`），點數、篇數、同時任務、全站預算、每日退還上限全部自動適用。
- 自訂題用自己的系統提示，不再把學生的題目當成可信的 `<task>`（原本的說法在 `apps/api/src/ai/prompts/common.ts:20`）。
- 題目存新表、兩個外鍵都 CASCADE。遷移只增不改，部署順序是「先遷移再部署」（`.github/workflows/worker-deploy.yml:201-208`）。
- OCR 的提示不帶學生的題目。
- Worker 端有 D8 指紋比對，檔案壞掉時 fail closed。

主要缺口有五個（major）：

- 程式端的防代寫只管參考改寫，其他自由文字欄位沒有限制；
- 學生的題目放在 `items[0].stem`，漏改分支的呼叫點會把它送進受信任的區塊；
- D8 比對對「從 PDF 或講義複製」的格式不夠穩，英文長度門檻也放過短的佳作；
- 題目欄會帶進學校、老師姓名，和隱私權說明的現行文字衝突；
- 總開關的解析是 fail open。

| # | 嚴重度 | 主題 | 設計位置 |
|---|---|---|---|
| S1 | major | 防代寫的程式限制只管 `rewrite`；「沒有自由回答的欄位」不成立 | §0-8、§4.8、§5.1、§5.2、§5.8 |
| S2 | major | 學生的題目放在 `items[0].stem`：漏掉分支就進入受信任的 `<task>` | §3.5、§4.3、§4.9 |
| S3 | major | D8：漢字窗口不跨空白與換行、英文門檻 150 放過短佳作、空指紋集不會 fail closed | §2.4.1、§2.4.4、§2.4.5、§5.6 |
| S4 | major | 題目欄的個資和隱私權說明「不蒐集學校、年級、電話」衝突 | §3.6、§6.10、§9.2-6 |
| S5 | major | `AI_CUSTOM_ESSAY` 只要「不是 off」就開（fail open），而且關閉要重新部署 | §2.2、§5.3、§10-4 |
| S6 | minor | 建立與修改自訂題只要登入；被拒收的請求沒有速率限制 | §2.6、§5.4、§9.2-10 |
| S7 | minor | 送批改時檢查的題目，和 consumer 實際用的題目可能不同（TOCTOU） | §2.6、§3.4 |
| S8 | minor | 角色扮演題目大量觸發注入旗標 | §4.5 |
| S9 | minor | `neutralizeTags` 不中和 `< /tag>`；逐行中和讓第二道防線比第一道寬 | §4.3、§4.4 |
| S10 | minor | 看不見的變體選擇符（U+E0100–E01EF）與大量組合記號會通過 | §2.4.1、§2.4.3 |
| S11 | minor | `not_english` 只算漢字；token 預算的「最壞情況」是全 ASCII 作文 | §2.4.6、§4.10 |
| S12 | minor | 內容造成的退還更容易被誘發；沒有對應的觀察與告警 | §5.3、§10-3 |
| S13 | minor | 遷移的 `INSERT OR IGNORE` 會吞掉 CHECK 錯誤；佔位列沒有防止狀態被推進；兩個 `user_id` 沒有一致性約束 | §3.2、§3.3 |
| S14 | minor | 顯示與 XSS：缺 CSP、`<title>` 規格矛盾、測試案例不足 | §5.1、§5.7、§6.8、§7.5 |
| S15 | minor | 刪除提交後本機草稿仍留著題目；共用電腦上的草稿沒有期限 | §6.6、§3.6 |
| S16 | minor | `FILTER_VERSION` 沒有記錄在任何地方，遞增它無法追溯 | §4.4、§5.5 |
| S17 | minor | AI 輸出可能複述題目裡的「大考中心」 | §5.7、§4.2 |
| S18 | minor | 自訂題的分數可被題目操控，不可混進日後的能力估計 | §2.7、§9.1 |

---

## 1. Major

### S1　防代寫的程式限制只管 `rewrite`

- **嚴重度**：major
- **位置**：
  - §0 第 8 點（設計 :23-27）；
  - §4.8 參考改寫的長度上限（設計 :833-837，「目的：就算模型被題目誘導，也拿不到一篇比學生原文長很多的完整作文」）；
  - §5.1（設計 :880-881）、§5.2 第 4 點（設計 :906）；
  - §5.8 給 ARCHITECTURE 的 (4)（設計 :984）、R4（設計 :1599）。
- **問題**：設計多處寫「輸出只有批改 JSON，沒有自由回答的欄位」，並把「參考改寫由程式限長」當作防代寫的程式保證。但 analytic 的 schema 還有很多自由文字欄位，程式只對 `rewrite` 加了上限。模型被題目誘導時，一篇範文可以拆開放在以下欄位，程式都不會攔：
  - `errors[].suggestion`：英文，每則 ≤600 字元、最多 30 則；
  - 在原文找不到的 `excerpt`：程式照樣保留模型寫的字，每則 ≤300 字元；
  - `paragraph_advice`、四項的 `explanation_zh`、`top_improvements`、`comment_zh`。

  單次 analytic 能顯示的自由文字粗估超過 5 萬字元（實際受 `maxTokens` 12,000 限制）。所以 §4.8 寫的目的，靠現在的設計達不到。
- **證據**：
  - schema：`apps/api/src/ai/prompts/essay.ts:37-54`；
  - 程式對各欄位的處理（`apps/api/src/ai/scoring.ts`）：
    - `:316` errors 最多 30 則；
    - `:325` 找不到原文位置時，excerpt 改用模型的字串（≤300）；
    - `:326-327` 說明與建議各 ≤600；
    - `:331` 總評 ≤1,000；`:333` 四項說明各 ≤1,000；
    - `:336` 優先改進各 ≤400；`:341` 逐段建議各 ≤800；
    - `:343` 改寫 ≤5,000；
  - 「建議用英文寫」：`apps/api/src/ai/prompts/common.ts:36`。
- **建議修改**：
  1. 把「輸出只有批改 JSON，沒有自由回答的欄位」改成「輸出是固定 schema 的批改 JSON；自由文字欄位有長度上限，自訂題另有英文字數上限」。§5.8 的 (4) 一起改。
  2. 自訂題（`EssayContext.rewriteMaxWords` 有值時），`scoreEssayAnalytic` 多三條程式規則：
     - (a) 在學生原文找不到 excerpt 的 error 整則丟掉，或保留說明、清空 suggestion；
     - (b) 每則 suggestion 的英文字數有上限，例如 `max(25, excerpt 字數 × 2 + 10)`，超過就清空那則 suggestion；
     - (c) 所有 `_zh` 欄位與 `top_improvements` 裡的英文字數合計有上限，例如 60（中文說明只需要引用少量英文），超過就把該欄清成空字串。

     被丟掉或清空的都記在 `judgments.meta`（例如 `errors_dropped_unlocated`、`suggestions_truncated`），上線後看有沒有誤傷。
  3. §7.4 的 `ai.scoring.test.ts` 加案例：
     - 造一份「suggestion 與 paragraph_advice 塞進一整段範文」的模型輸出，確認會被清掉；
     - `rewriteMaxWords` 是 null 時，行為和現在完全相同。
  4. §9.2 第 4 點（作文規則要不要擴大）加上這三條：之後也適用到歷屆題與本站題。

### S2　學生的題目放在 `items[0].stem`：漏掉分支就進入受信任的 `<task>`

- **嚴重度**：major
- **位置**：
  - §3.5 的 `customWritingGroup`（設計 :652-663，特別是 :657 `stem: p.prompt_text`）；
  - §4.3 的實作說明（設計 :774-775）；
  - §4.9（設計 :852）；
  - §2.7 的改法表。
- **問題**：現有程式的分派都是「不是 `bank` 就當歷屆題」：
  - `essayTemplateVersion` 對任何非 `bank` 的 origin 都回 `essay-user@1`；
  - `essayUserContent` 把 `items[0].stem` 寫成 `<task>` 裡的 `Prompt:` 行；
  - `ocrUserText` 把 `items[0].stem` 寫進 OCR 提示；
  - `essayCallInput` 分別呼叫 `essaySystemText` 與 `essayUserContent`，系統提示和 user 訊息各自分支，可能互相不一致。

  設計讓 `customWritingGroup` 把學生題目放進 `items[0].stem`，等於「預設不安全」。只要有一個呼叫點忘了判斷 `origin === 'custom'`（現有的，或以後新增的任務，例如修訂稿批改），學生題目就會：
  - 出現在受信任的 `<task>` 裡，並套用 `SYSTEM_PREAMBLE` 的「Treat it as the assignment」；
  - 或回到 §4.9 刻意拿掉的 OCR 提示。
- **證據**：
  - `apps/api/src/ai/prompts/essay.ts:25-27`（範本版本的二選一）、`:171`（`Prompt: ${item.stem}`）；
  - `apps/api/src/ai/prompts/ocr.ts:62`；
  - `apps/api/src/ai/requests.ts:36-45`（系統提示與 user 訊息分開取）；
  - `apps/api/src/ai/prompts/common.ts:20`。
- **建議修改**：
  1. `customWritingGroup` 的 `items[0].stem` 與 `instructions` 都放空字串，學生題目只放在 `custom.prompt_text`（型別改成 `custom: { prompt_text: string; figure_text: string | null }`）。
     - 漏掉分支的舊路徑最多送出「沒有題目」的 `<task>`，不會把不可信的文字放進受信任的區塊；
     - `ocrUserText` 不用改程式，就自動不帶題目（`item?.stem` 是空字串時那一行不輸出）。
  2. 系統提示、user 訊息、範本版本由同一支函式依 origin 一次決定，例如 `essayPromptParts(group, framework)` 回傳三者；`essayCallInput`、`ocrCallInput` 只呼叫它。origin 用 `switch` 加 `never` 窮舉，TypeScript 會擋下漏寫的分支。
  3. §7.3 加測試：
     - 自訂題的每一種呼叫輸入（analytic、holistic、OCR）裡，題目的獨特字串只出現在 `<student_provided_task>` 內，而且只出現一次；
     - `system` 不等於 `essaySystemText(fw)`。

### S3　D8：比對對複製來的文字不夠穩，長度門檻也偏寬

- **嚴重度**：major
- **位置**：
  - §2.4.1 正規化（設計 :318-327）；
  - §2.4.4 的 `english_too_long`（設計 :361）；
  - §2.4.5 指紋比對（設計 :369-393，fail closed 在 :385）；
  - §5.6（設計 :956-968）；
  - §7.3 的 D8 測試（設計 :1364-1371）。
- **問題**：
  1. **漢字窗口不跨空白與換行。**
     - `hanWindows` 只取連續的 `[㐀-鿿]+`。§2.4.1 的正規化只把行內連續空白合併成一個，不會移除漢字之間的空白或換行。
     - 從 PDF 複製的評分原則常在每一行行尾斷行，有些 PDF 甚至每個字之間都有空白（「評 分 原 則」）。
     - 後者一個 8 字窗口都產生不出來，D8 比對完全失效；前者會少掉跨行的窗口。
     - §2.4.5 的實測（48 份各取開頭 200 字元，全部命中）用的是乾淨的 parsed 文字，量不到這種情況。而設計寫明這道防線針對的正是「好意貼上整份講義」（設計 :392）。
  2. **英文門檻 150 個單詞，放過短的佳作。**
     - 設計自己寫「整篇佳作通常 120–250 個單詞」（設計 :962），所以 120–150 個單詞的佳作整篇貼上會通過。佳作原文又不在指紋裡，這是唯一能擋整篇佳作的規則。
     - 我在本 worktree 用產生好的 `apps/api/src/generated/writing-prompts.json` 實測：96 題作文的「說明＋選文＋題目＋圖片描述」，英文單詞最多 36 個（`gsat-84.s6g1@1`），其次 25、24、23。門檻 150 是真實題目最大值的 4 倍。
  3. **空的指紋集合不會 fail closed。**
     - 設計只在「檔案壞掉、解不開」時回 503。
     - 如果產生器的輸入路徑或 `officialCorpus` 被改壞，產出 0 筆（或少很多）的合法檔案，所有題目都會通過 D8，沒有任何告警。
     - 每個請求都寫一筆 `d8_fingerprints_invalid` 的 `ops_events` 也會灌爆告警表。
  4. **「不顯示」沒有重查。**
     - 指紋檔更新後，舊題目在送批改時會被重查（設計 :474）；
     - 但結果頁與寫作紀錄仍照常顯示存下來的題目。
- **證據**：
  - `packages/shared/scripts/bank-select.mjs:622`（`HAN_RUN = /[㐀-鿿]+/g`）、`:639-645`（`hanWindows`）；
  - 設計 :322-326、:361、:385、:962；
  - 上面第 2 點的實測（Python 掃 `writing-prompts.json`，英文單詞用與 §2.4.4 相同的 `[A-Za-z]+(?:['’][A-Za-z]+)?`）。
- **建議修改**：
  1. 定義一個產生器與 Worker 共用的「D8 比對用正規形式」：
     - NFKC 之後移除所有空白（含換行與 U+3000），再切漢字窗口；
     - 英文部分把行尾的斷字連字號（`-\n`）接回。

     產生器「排除公開文字的窗口」也要用同一個形式，改完再跑一次 310 組的誤判測試。
  2. §7.3 加兩個案例，都要命中：
     - 評分原則每 20 個字插一個換行；
     - 評分原則每個字之間插一個空白。
  3. `englishWordsMax` 降到 100，或依實測最大值（36）的約 3 倍訂定。題目欄說明與 `english_too_long` 的文案跟著改。§5.6 第 3 道寫明它的目的是擋整篇佳作。
  4. 指紋檔加筆數下限：
     - 產生器：`han` 或 `en` 的筆數低於下限（例如 han ≥ 4,000、en ≥ 5,000，或不少於上一版的 80%）時 exit 1；
     - Worker：解碼後筆數是 0，或和檔頭的 `count` 不符時，當成壞檔（503）；
     - `d8_fingerprints_invalid` 的 `ops_events` 每個 isolate 只寫一次。
  5. （可選）`toDetail` 讀自訂題時也跑一次 `officialMaterialHits`。命中時把題目換成「這份題目含有官方評分說明的文字，已隱藏」，和送批改時的重查一致。

### S4　題目欄的個資和隱私權說明衝突

- **嚴重度**：major
- **位置**：
  - §3.6「境外處理」（設計 :680）；
  - §6.10 的個資提醒與隱私權說明（設計 :1225、:1235）；
  - §9.2 第 6 點（設計 :1616，預設不升版）、R6（設計 :1601）。
- **問題**：
  - 情境 1、2 的來源（學校段考、補習班講義）通常有表頭：學校名稱、年級班級、座號、姓名欄、老師姓名、補習班名稱與電話。
  - 設計的處理只有介面提醒，加上系統提示「不要複述」。這些資料仍會存進 D1、出現在匯出、送到 Anthropic。
  - 隱私權說明現在寫「我們不蒐集學校、年級、電話、地址、生日與頭像」。§6.10 只補了「寫作與批改紀錄」與 AI 那一節的兩處字，沒有改這一句，上線後這句就不正確了。
  - AI 處理說明寫「傳送的內容只有作答、題目與評分參考」。使用者同意時，「題目」指的是本站的題目；現在變成使用者自己貼的任意文字，可能含第三人（老師）的個資。設計預設不升版。
- **證據**：
  - `apps/web/src/features/account/policy.ts:69`（不蒐集學校、年級、電話）；
  - `policy.ts:85`、`:243`（「連同題目與評分參考」「傳送的內容只有作答、題目與評分參考」）；
  - 設計 :1225、:1235、:1616。
- **建議修改**：
  1. **技術上先減量。**
     - 存檔與送出前，題目與圖片描述套用 `apps/api/src/ai/filter.ts:69-70` 的 `EMAIL_RE`、`PHONE_RE`，換成「［已隱藏］」（或拒收並請學生刪掉）。
     - 前端偵測表頭樣式（「姓名：」「班級」「座號」「學號」「老師：」「○○高中」「補習班」、電話）時，顯示提醒與「刪掉這幾行」按鈕。不擋送出，避免誤擋。
  2. **改隱私權說明的文字。**
     - `policy.ts:69` 改成「我們不主動蒐集學校、年級……；你自己在作答或自訂題目裡輸入的內容除外，請先刪除」。
     - AI 處理說明的「題目」改成「題目（含你自己輸入的作文題目）」。
  3. **§9.2 第 6 點的預設改成「升版」**：隱私權說明有一句實質內容改變了。至少要列為上線前必須由站主決定的事項，而不是預設不升版。
  4. **測試**：題目含 email 或手機號碼時，存下來的是遮罩後的文字，送給假 Anthropic 的 HTTP 本體裡也沒有原值。擴充 `ai.rules.test.ts` 的「HTTP 本體不含個資」案例。

### S5　總開關的解析是 fail open，而且關閉要重新部署

- **嚴重度**：major
- **位置**：
  - §2.2 的 `features.ts`（設計 :261，「`ai` 為 true 且 `AI_CUSTOM_ESSAY` 不是 `off`」）；
  - §5.3 總開關（設計 :929-936）；
  - §10 第 4 點（設計 :1642）。
- **問題**：
  - 規格寫「不是 `off` 就開」。事件處理中把值打成 `Off`、`OFF`、`false`、`0` 或 `"off "`，功能都還開著。
  - 如果照 `config.ts` 現有 `num()`／`effort()` 的慣例（不合法就用預設值），預設 `on` 也一樣是 fail open。
  - 這是濫用或品質事件時唯一能「只關自訂題」的開關，而且要重新部署才生效。
- **證據**：
  - `apps/api/src/config.ts:116-131`（不合法的值改用預設值並 `console.warn`）；
  - 後台已有不用部署的全站暫停：`apps/api/src/admin/ai.ts:28-39`（`POST /api/admin/ai/pause`）。
- **建議修改**：
  1. 解析規則改成 fail closed：
     - 去掉頭尾空白、轉小寫後等於 `on` 才開；
     - 沒設定時用預設值；
     - 其他任何值一律當成 `off`，並 `console.warn`。

     `skeleton.test.ts` 加 `Off`、`false`、`0`、空字串的案例。
  2. §10 第 4 點補上緊急程序：
     1. 先用後台的「AI 全站暫停」止血（立即生效，不用部署）；
     2. 再把 `AI_CUSTOM_ESSAY` 改成 `off` 並部署；
     3. 解除全站暫停。
  3. （可選）之後若要不部署就能只關自訂題，再考慮放在 D1 的功能旗標。第一版不必。

---

## 2. Minor

### S6　建立與修改只要登入；被拒收的請求沒有速率限制

- **嚴重度**：minor
- **位置**：§2.6（設計 :445、:457）、§5.4（設計 :943、:945）、§9.2 第 10 點。
- **問題**：
  - 沒有通過 AI 核准的帳號（任何 Google 帳號）也能建立自訂題的提交，存下題目（可能含個資）。
  - POST 被拒收時不寫列，所以不算進每日 100 份（`apps/api/src/submissions/routes.ts:124-125` 只數已建立的列）；PUT 也不限次數。結果是可以無限次試探內容規則與 D8 指紋（命中與否等於一個「這段文字在不在官方評分原則裡」的查詢介面）。
  - 實際影響不大：評分原則本來就公開在官方網站，內容規則也打包在前端。但和「自訂題目只為 AI 批改存在」的定位不一致，也多存了沒必要的資料。
- **證據**：`submissions/routes.ts:108`（POST 掛 `requireUser()`）、`:180`（PUT 同）、`:124-125`。
- **建議修改**：
  - POST 的自訂變體、帶 `custom_prompt` 的 PUT 改成 `requireAiApproved`。前端本來就只在送 AI 時才建立提交（設計 :457），照片上傳也已經要求核准，所以對使用者沒有影響。
  - 只改作文或自評的 PUT、以及 DELETE，維持 `requireUser`：被撤銷核准的人仍然要能管理自己的資料。
  - 這樣能試探的只剩人工核准過、人數有上限的帳號，§9.2 第 10 點可以維持只記 log。

### S7　送批改時檢查的題目，和 consumer 實際用的題目可能不同

- **嚴重度**：minor
- **位置**：§2.6 的 PUT（設計 :466）與 essay-grade（設計 :474-478）；§3.4 修改題目的 SQL（設計 :598-602）。
- **問題**：
  - essay-grade 在 `prepare()` 讀題目並檢查（D8、`essayGradableProblem`、題目的注入旗標），之後才用 `UPDATE submissions … WHERE status = ?10` 把狀態改成 queued。
  - 這段時間內，同一份提交的 PUT `custom_prompt` 仍會成功，因為狀態還是 draft。之後 consumer 從 D1 讀到的是新題目。
  - 新題目也經過了 PUT 的檢查，但 `copies_task` 與題目的注入旗標是對舊題目算的。
  - 作文本身沒有這個問題：送批改的 UPDATE 會把淨化後的作文一起寫回。
- **證據**：`apps/api/src/ai/routes.ts:248-251`（只比對 `status`）；`apps/api/src/ai/consumer.ts:203`（consumer 處理時才讀題目）。
- **建議修改**：
  - 送批改的條件式 UPDATE 多一個條件：題目沒被改過。例如：
    - 題目表加 `rev INTEGER NOT NULL DEFAULT 1`，PUT 時加 1；
    - 送批改時加上 `AND EXISTS (SELECT 1 FROM submission_custom_prompts WHERE submission_id = ?8 AND user_id = ?9 AND rev = ?11)`。
  - 不要用 `updated_at` 判斷：它以秒為單位，同一秒內的兩次 PUT 分不出來。
  - §7.2 加一個「送批改與修改題目交錯」的案例。

### S8　角色扮演題目大量觸發注入旗標

- **嚴重度**：minor
- **位置**：§4.5 第 4 層（設計 :798）、範例（設計 :807）、§7.2（設計 :1321）。
- **問題**：
  - 「假如你是老師…」「Suppose you are a teacher…」是很常見的作文題型，會命中 `role_override`、`zh_role`。設計讓它們設 `submissions.injection_flag = 1` 並寫 `ai_safety_events`。
  - 第 1 層已經在輸入時拒收了其他注入樣式，所以實際寫進安全事件的，絕大多數會是正常題目，真正的新注入寫法反而被淹沒。
  - `injection_flag` 一旦設了就不會清掉。ARCHITECTURE §7 寫的是命中後「在結果頁提醒」；之後若有人照著做，寫正常角色扮演題目的學生會看到「疑似提示注入」。
- **證據**：
  - `apps/api/src/ai/filter.ts:44`、`:50`；
  - `apps/api/src/ai/routes.ts:250`（旗標只設不清）；
  - `docs/ARCHITECTURE.md:383`。
- **建議修改**：
  - 題目只用「正常題目不會出現」的代號設旗標：`ignore_instructions`、`new_instructions`、`score_demand*`、`system_prompt`、`zh_ignore`、`zh_score`、`tag_breakout`。
  - `role_override`、`zh_role` 命中題目時只記 log 計數，不設 `injection_flag`、不寫 `ai_safety_events`。
  - §7.2 的案例改成「假如你是老師 → 202，`injection_flag` 仍是 0」。

### S9　結構標籤的中和比輸入規則寬

- **嚴重度**：minor
- **位置**：§4.3（設計 :758、:776）、§4.4（設計 :785-789）。
- **問題**：
  - `TAG_RE` 是 `<(\/?)\s*(tag)\b`，`<` 和 `/` 之間有空白的 `< /student_provided_task>` 不會被中和。
  - 設計又要求題目「每一行」分別中和，所以斷在兩行之間的 `<` 與標籤名稱也不會被中和。
  - 現在靠 §2.4.4 的 `markup` 規則（`<\s*\/?\s*[A-Za-z_]`，`\s` 含換行）在輸入端擋住。但 §4.4 第 4 點說中和是「萬一規則以後被放寬」時的第二道防線，實際上這道比第一道寬。
  - 題庫產生器對送進評分者的字串是「完全不准 `<` 或 `>`」；自訂題只擋 `<` 加字母，兩邊標準不同，設計沒有說明。
- **證據**：`apps/api/src/ai/filter.ts:30`；`packages/shared/scripts/bank-select.mjs:601`。
- **建議修改**：
  - `TAG_RE` 改成 `<\s*(\/?)\s*(…)\b`。歷屆題與本站題的文字沒有這種寫法，快照不變；同時遞增 `FILTER_VERSION`。
  - 自訂區塊整段中和，不要逐行。
  - §7.3 加 `< /student_provided_task>`、`<\n/task>` 的案例。
  - §2.4.4 註明為什麼自訂題允許 `x < y` 這類寫法。

### S10　看不見的變體選擇符與大量組合記號會通過

- **嚴重度**：minor
- **位置**：§2.4.1、§2.4.3（設計 :349）。
- **問題**：
  - `normalizeStudentText` 會移除 U+FE00–FE0F 與 `\p{Cf}`，但不會移除 U+E0100–U+E01EF（變體選擇符補充區，屬 `\p{Mn}`）。§2.4.3 又允許全部 `\p{M}`，所以這些字元會被存下、送出，畫面上卻看不到。
  - 它們可以把任意位元組藏在一個表情符號後面（variation selector smuggling），繞過所有內容規則，也違反「模型看到的＝學生看到的」原則。
  - 一個字元後面接一大串組合記號（Zalgo 字）也一樣，還會讓 token 數偏離 §4.10 的估計。
- **證據**：`packages/shared/src/writing-mechanics.ts:12-13`。
- **建議修改**：
  - `checkCustomPrompt` 遇到 U+E0100–U+E01EF 回 `bad_characters`（或在正規化時移除並計數）。
  - 同一個字元後面最多允許 3 個組合記號。
  - 之後再評估把同樣規則加進 `normalizeStudentText`（會改變作文的淨化結果，要遞增 `FILTER_VERSION`）。
  - §7.1 加測試。

### S11　`not_english` 只算漢字；token 預算的「最壞情況」是全 ASCII 作文

- **嚴重度**：minor
- **位置**：§2.4.6（設計 :402）、§4.10（設計 :857-870）、§7.3 的 token 預算測試（設計 :1355）。
- **問題**：
  - 比例只算 `\p{Script=Han}`。日文假名、韓文、泰文、西里爾字母、表情符號都不算，所以「用非英文跟 AI 對話」只要避開漢字就能通過。
  - §4.10 的最壞情況沿用測試裡的假作文 `'word '.repeat(400)`，是全 ASCII；4,000 字元的韓文或泰文作文，token 數會遠高於估計。所以「實測最壞情況在預扣估計內」這句要修正。
  - 費用影響不大：
    - 預扣把 6,000 個輸入 token 全部用 1 小時快取寫入價（每百萬 8 美元）估算；
    - user 訊息實際用一般輸入價（每百萬 4 美元）計費；
    - 扣掉系統提示的快取寫入成本後，user 訊息要超過約 6,800 個 token，才會超出預扣的輸入部分；
    - 輸出通常也遠低於 `maxTokens`。
- **證據**：`apps/api/test/ai.bank-writing.test.ts:449-457`；`apps/api/src/ai/pricing.ts`（`worstCaseMicros`，api-map §1.8）。
- **建議修改**：
  - `not_english` 改成計算「拉丁字母以外的字母（`\p{L}` 而且不是 `\p{Script=Latin}`）＋表情符號」所占的比例。
  - §4.10 寫明「作文是 ASCII」這個假設。token 預算測試多一組「4,000 字元的非拉丁文字」，結論改用美元比較，不用 token。

### S12　內容造成的退還更容易被誘發

- **嚴重度**：minor
- **位置**：§5.3（設計 :913-927）、§10 第 3 點（設計 :1637-1641）。
- **問題**：
  - 自訂題目給了學生一個「看起來像指令」的自由文字欄位，比較容易誘發拒答、格式不符或截斷。
  - 這三種會退還點數，只受每人每天 5 次的限制，但成本照算。截斷時還會重試一次，所以單篇的實際成本可能超過一次預扣。
  - 少數帳號就能讓全站每日預算提早用完，所有人的 AI 都被暫停。
  - 反覆送出違反 Anthropic 使用政策的內容，也會讓本站的 API 帳號承擔風險。
- **證據**：
  - `apps/api/src/ai/guard.ts:12-15`、`:25-32`（每日退還上限與它的成本估計）；
  - `guard.ts:84-100`（`RESERVE_SQL` 的退還上限條件）；
  - api-map §1.6（截斷與格式不符各重試一次）。
- **建議修改**：
  - §10 第 3 點的觀察項目加上：依 `prompt_version` 分開的 `refusal`、`invalid_output`、`max_tokens` 退還率。
  - 加一個告警：同一個 `user_ref` 在 7 天內的自訂題內容退還 ≥3 次時寫 `ops_events`，後台人工檢視後可以撤銷 AI 核准。
  - 預設值寫進設計，上線後再調。

### S13　D1 遷移：`INSERT OR IGNORE`、佔位列的狀態、兩個 `user_id` 的一致性

- **嚴重度**：minor
- **位置**：§3.2（設計 :536-562）、§3.3。
- **問題**：
  1. **`OR IGNORE` 會吞掉 CHECK 錯誤。**
     - SQLite 的 `OR IGNORE` 不只忽略主鍵衝突，也忽略 NOT NULL 與 CHECK 違反（只有外鍵不受影響）。
     - 佔位列或授權列的任何欄位值寫錯，遷移照樣成功，`d1_migrations` 也記為已套用。依 README，已套用的遷移檔不能再改。
     - 之後每一筆自訂題的建立都會因外鍵失敗回 500。測試會抓到（`helpers/d1.ts` 套用真的遷移），但線上一旦套用，就只能再寫一支遷移來修。
  2. **佔位列沒有防止狀態被推進。**
     - `bank.ts` 的檔頭註解寫，之後正式匯入題組時，匯入工具會把 draft 列「更新內容後再推進狀態」。
     - `custom:essay@1` 也是 draft，沒有任何東西擋它被推進到 published。推進之後，它會出現在 `v_groups_student` 與抽題裡。
  3. **兩個 `user_id` 沒有一致性約束。**
     - 沒有約束保證 `submission_custom_prompts.user_id` 和對應的 `submissions.user_id` 相同。
     - IDOR 防護完全靠每一句 SQL 自己帶 `user_id`。
- **證據**：
  - `apps/api/migrations/0001_init.sql:29`（遷移包在交易裡）、`:1147-1155`（狀態機允許 draft → verifying／needs_review）；
  - `apps/api/src/ai/bank.ts:8-12`；
  - `apps/api/migrations/README.md`（已套用的檔不能修改）。
- **建議修改**：
  1. 兩句 INSERT 改成 `INSERT INTO … VALUES … ON CONFLICT(code) DO NOTHING`、`… ON CONFLICT(id) DO NOTHING`。這種寫法只免除主鍵衝突的錯誤，CHECK 或 NOT NULL 寫錯會讓遷移失敗；整支檔案仍然可以重跑。
  2. 加一個 trigger 凍結佔位列：`CREATE TRIGGER IF NOT EXISTS trg_groups_custom_frozen BEFORE UPDATE ON item_groups WHEN OLD.id LIKE 'custom:%' BEGIN SELECT RAISE(ABORT, 'custom placeholder group is frozen'); END;`，並在 DB_SCHEMA 記一筆。
  3. 在 `submission_custom_prompts` 加 BEFORE INSERT／UPDATE trigger，檢查兩件事：
     - `NEW.user_id` 等於那份提交的 `user_id`；
     - 那份提交的 `group_id` 是 `custom:essay@1`。

     trigger 都寫 `IF NOT EXISTS`，可以重跑。
  4. §7.2 的遷移測試加上對應的案例。

### S14　顯示與 XSS

- **嚴重度**：minor（題目只顯示給本人，整體風險低）
- **位置**：§5.1 的 XSS 列（設計 :888）、§5.7（設計 :974）、§6.8（設計 :1178）、§7.5（設計 :1426）。
- **問題**：
  1. **缺 CSP。**
     - ARCHITECTURE §7 要求在 `vercel.json` 加 CSP，但現在只有 nosniff、Referrer-Policy、X-Frame-Options 與 Permissions-Policy。
     - 網站與 API 經過 rewrites 是同一個來源，任何 XSS 都能帶著 cookie 呼叫 API。
     - 這次是第一個把「從外部貼上的任意文字」顯示在頁面上的功能。
  2. **`<title>` 的規格互相矛盾。**
     - §2.2（設計 :232）與 §5.7（設計 :974）說結果頁的 `<title>` 用 `customPromptTitle`；§6.8（設計 :1178）說是固定字串。
     - 題目開頭放進 `<title>`，會留在瀏覽器歷史、分頁標題、跨裝置同步與上課投影的分頁列，可能帶出學校或老師名稱。
  3. **顯示安全的測試案例不足**：§7.5 只測了 `[[11]]` 與 `<u>x</u>`。
- **證據**：
  - `docs/ARCHITECTURE.md:387`（CSP）；
  - `vercel.json` 的 `headers`；
  - `apps/web/scripts/source-scan.test.ts`（已經會擋直接插入 HTML 的寫法）。
- **建議修改**：
  - `<title>` 一律用固定字串；`customPromptTitle` 只用在寫作紀錄列表。
  - §7.5 加草稿案例：題目含 `<img src=x onerror=alert(1)>` 與 `javascript:` 字串時原樣顯示，不產生元素或連結。
  - CSP 依 ARCHITECTURE §7 另開 PR 補上（不擋本功能，列為後續）。
  - ARCHITECTURE §7 的「XSS」「濫用與帳單攻擊」兩列（`docs/ARCHITECTURE.md:386`、`:390`）也要補上自訂題的處理與輸入上限；§5.8 目前只改兩列。

### S15　刪除提交後本機草稿仍留著題目

- **嚴重度**：minor
- **位置**：§6.6（設計 :1116-1153）、§3.6 的保存期限（設計 :676）。
- **問題**：
  - 刪除某份提交後，本機草稿 `gsat-writing-draft:v1:essay:custom:essay@1` 仍保留題目。如果之後補上依 `expires_at` 的清除程式，伺服器端到期刪除後也是一樣。
  - 沒登入的使用者沒有「登出」這個時機，所以在學校電腦教室這類共用電腦上，草稿會無限期保留。題目可能有學校或老師的名字。
- **建議修改**：
  - 在寫作紀錄或結果頁刪除提交成功時，如果草稿的 `submissionId` 或 `lastSubmissionId` 指向它，就一併清掉題目。
  - 草稿的 `updatedAt` 超過 30 天，載入時就丟掉，或至少顯示「這是 N 天前的草稿」。
  - 作答頁的個資提醒加一句：「在共用電腦上寫完，請按『清除題目』。」
  - 同意 §9.2 第 7 點。新的資料類別可能含第三人的個資，建議提高優先順序。

### S16　`FILTER_VERSION` 沒有被記錄

- **嚴重度**：minor
- **位置**：§4.4 第 3 點（設計 :788）、§5.5（設計 :950）。
- **問題**：
  - 整個 repo 只有 `filter.ts` 宣告了 `FILTER_VERSION`，沒有寫進 `gradings`、`ai_calls` 或任何紀錄。所以遞增到 `f3`，對事後追查「這份批改用的是哪一版過濾與中和」沒有幫助。
  - 新增的指紋檔也沒有版本。
- **證據**：`apps/api/src/ai/filter.ts:13`（唯一的出現處）。
- **建議修改**：
  - `judgments.meta` 寫入 `filter_version` 與 `d8_fp`（指紋檔的筆數或雜湊前 8 碼）。
  - 自訂題另外記題目檢查規則的版本（例如 `CUSTOM_PROMPT_RULES_VERSION`）。之後調整誤擋規則時，才分得出調整前後的批改。

### S17　AI 輸出可能複述「大考中心」

- **嚴重度**：minor
- **位置**：§5.7（設計 :970-975）、§4.2 的 `CUSTOM_TASK_RULES`（設計 :730-742）。
- **問題**：學生貼的題目常有「大考中心」「CEEC」字樣（例如題目出處）。模型可能在 `comment_zh`、`explanation_zh` 裡複述，而這些輸出會顯示在自訂題的結果頁上。設計只管站方自己的文案。
- **建議修改**：
  - `CUSTOM_TASK_RULES` 加一句：「Do not name exam boards or other organizations in your comments; refer to it as "the task".」
  - 自訂題的 `OutputFilter` 之後，把「大考中心」「CEEC」換成「官方」，或至少記在 meta 觀察出現頻率。

### S18　自訂題的分數不可混進日後的能力估計

- **嚴重度**：minor
- **位置**：§2.7（設計 :501）、§9.1 R1。
- **問題**：
  - 題目由學生提供：題目寫得越寬鬆，越不會被判離題，內容分也越容易拿高，所以分數可以被題目操控。
  - D1 已經有 `score_predictions`、`user_ability` 等表。之後若用作文分數做能力估計或分數預測，自訂題會污染結果。
- **證據**：`apps/api/src/account/delete.ts:22-40`（`CASCADE_TABLES` 列出這些表）。
- **建議修改**：
  - DB_SCHEMA 與 SPEC §6.9 寫明：「自訂題（`group_id = 'custom:essay@1'`）的分數不進入任何能力估計、預測或排行」。
  - 之後寫彙總查詢時，加上 `group_id <> 'custom:essay@1'`。

---

## 3. 對照程式碼確認沒有問題的部分

- **IDOR**：
  - 新的 SQL 全部帶 `user_id`；
  - 列表的 LEFT JOIN 也帶 `cp.user_id = s.user_id`；
  - `groupForSubmission` 用的是已經通過授權的提交列上的 `user_id`；
  - 前端的 `getSubmission` 會對 id 做 `encodeURIComponent`（`apps/web/src/features/writing/lib/writingApi.ts:63`），`?from=` 不會造成路徑穿越。
- **刪除與匯出**：
  - 兩個外鍵都 CASCADE；
  - `CASCADE_TABLES` 依 `user_id` 計數（`apps/api/src/account/delete.ts:52-63`），新表有 `user_id`，計數會成立；
  - 匯出多一句查詢即可（`apps/api/src/account/export.ts:26-44`）；
  - 殘留的表（`ai_ops`、`ai_calls`、`ai_safety_events`、`ops_events`）不會有題目本文。
- **額度與費用**：
  - 任務代號相同，`RESERVE_SQL` 的點數、作文家族每日篇數、同時任務、全站預算、退還上限全部適用（`apps/api/src/ai/guard.ts:84-100`）；
  - 預扣 544,000 微美元＝三位評分者最壞情況的加總（`apps/api/test/ai.rules.test.ts:244`）；
  - 所有自訂題的檢查都在預扣之前（`apps/api/src/ai/routes.ts:189` 的 `prepare` 在 `:202` 的 `reserveOp` 之前），被擋下的請求不扣點。
- **日誌**：
  - `ApiError` 的路徑不寫 log（`apps/api/src/errors.ts:51-60`）；
  - 拒收的 log 只有代碼與 HMAC 假名，和 `ledger.ts` 的慣例一致。
- **授權**：`/api/ai/essay-grade`、`/api/ai/essay-ocr` 已經掛 `requireAiApproved`（`apps/api/src/ai/routes.ts:316-318`），照片上傳也是（`submissions/routes.ts:232`）。
- **跨站請求偽造**：新本體走既有端點，`originGuard` 與「只收 `application/json`」照樣適用（`apps/api/src/app.ts:46-49`）。
- **遷移與部署**：
  - 0003 只有新增，舊版 Worker 搭配新的 schema 沒有問題；
  - 部署 workflow 先套用遷移、再部署 Worker，遷移失敗就不會部署（`.github/workflows/worker-deploy.yml:201-208`）。
- **管理端**：後台沒有任何查詢讀 `submissions` 或新表，題目不會進入管理員畫面或管理端的 AI（ARCHITECTURE §7「二階注入」）。

---

## 4. 對 §9.2 開放問題的意見（安全角度）

- **第 2 點（額度）**：從費用角度贊成預設「和題庫題合計每天 3 篇、同樣 7 點」。
- **第 4 點（作文規則擴大）**：S1 的程式限制，之後應該擴大到所有題型。
- **第 6 點（隱私權說明升版）**：建議升版，理由見 S4。
- **第 7 點（保存期限的清除程式）**：建議提高優先順序，理由見 S15。
- **第 8 點（D8 殘餘風險）**：接受殘餘風險的前提，是 S3 的第 1–4 點先做。否則從 PDF 複製的評分原則與 150 字以下的佳作都擋不住。
- **第 10 點（拒收次數上限）**：採用 S6（自訂題要求 AI 核准）的話，維持只記 log 即可；不採用的話，至少要在同一帳號每天拒收 50 次時回 429。
