# 本站仿真中譯英與英文作文：設計

> 版本：2026-10-09 第 2 版（依審查意見修訂，交給實作；每一項審查意見的處理見 §12）。
> 需求：AI 題庫裡已驗證的中譯英（translation）與作文（composition）題組，要在 /writing 依難度選題作答。沒有登入的人寫完以後，可以對照本站的參考譯文、評分規準與範文自我檢核；登入且 AI 已核准的人，可以送 AI 批改，流程和歷屆題完全相同。這些題目要清楚標示是 AI 出題（沿用題庫練習的「AI 出題・已通過自動驗證・人工審核中」），不是大考中心的試題。
> 相關文件：`docs/SPEC.md` §6.8、§6.9、§8.4；`docs/ARCHITECTURE.md` §6、§7、§9.4；`docs/DB_SCHEMA.md` §3.3（`takedowns`）、§5.3；`data/bank/README.md` §2、§3.5–3.7、§6；`docs/design/ai-auth-mvp.md`（寫作與 AI 批改的既有設計）；ROADMAP 決策 D8（不公開官方參考譯文、評分原則原文與範文）、D9（代理畫的 SVG 示意圖）。
> 基準：bankwriting 分支原本停在 54530bb，比 origin/main 落後一個 commit；修訂這份設計時已快轉到 **origin/main 8028596**，以下的檔案內容與行號都以 8028596 為準。8028596 只改 apps/web 的頁面與測試，`data/` 和 54530bb 相同。
> 標記：「（實測）」＝在 8028596 上量到的數字（資料相關的數字已扣掉 §4.2 的 4 個下架版本）；「（設計值）」＝上線後依實際資料或用量校正。

**目錄**：[0. 決策摘要](#0-決策摘要)｜[1. 範圍與限制](#1-範圍與限制)｜[2. 使用者流程](#2-使用者流程)｜[3. 路由與畫面](#3-路由與畫面)｜[4. 公開資料與建置](#4-公開資料與建置)｜[5. API](#5-api)｜[6. D8 防線](#6-d8-防線)｜[7. 測試](#7-測試)｜[8. 檔案清單與分工](#8-檔案清單與分工)｜[9. 上線步驟](#9-上線步驟)｜[10. 風險](#10-風險)｜[11. 待決事項](#11-待決事項)｜[12. 決策紀錄](#12-決策紀錄)

---

## 0. 決策摘要

1. **選題規則只寫一份程式。** 新增零依賴的 `packages/shared/scripts/bank-select.mjs`，網站建置（`apps/web/scripts/build-data.mjs`）與 Worker 的題目庫產生器（`apps/api/scripts/build-writing-prompts.mjs`）都呼叫它的 `selectWritingGroups()`。發布條件如下：
   - `status: verified`、`schema: gsat-bank/v1`、`pool: practice`，授權是 `original-ai`／`original`；
   - 每個 uid 只取最大的 verified 版本；
   - 更新的版本還沒通過、但改了題目或參考內容時，撤下舊版。這條和選擇題「改了答案就撤下」是同一條規則，只是比對的鍵換成寫作題的內容；
   - 更新的版本是 `rejected`、內容和舊版相同時，也撤下舊版。這是題庫工作線記錄「最終判定」的寫法：已經併入 main 的 verified 版本後來被人工審核退回時，那邊不原地改檔，而是新增一個內容不變、status 為 rejected 的 `@{version+1}`（§4.1 規則表）；
   - 登記在 `data/unpublish.jsonl`（人工審核下架清單，§4.2）的版本不發布；
   - 形狀檢查不通過的不發布，其中包括「送進 Worker 的字串含 `<` 或 `>`」（§5.5）；
   - D8 比對有命中的題組不發布。比對用的函式和網站、Worker 輸出前的最後檢查是同一支（§6），所以資料問題只會讓那一組被略過，最後檢查只會因為程式錯誤失敗。

   網站和 Worker 用同一份程式選題，看到的題組集合一定相同。題庫練習（`bank-data.mjs`）的選題迴圈也搬進這個模組，行為不變。
2. **網站新增四條路由。** 列表頁是 `/writing/translation/ai`、`/writing/essay/ai`（依難度列出）。作答頁是 `/writing/translation/ai/:code`、`/writing/essay/ai/:code`，`:code` 是 uid 的 6 位十六進位。歷屆題的路由、頁面與資料檔都不變；歷屆列表頁上方多一組「歷屆試題｜本站仿真」切換。
3. **公開資料分四層，全部放在 `/data/writing/bank/`。**
   - `index.json`：每個題組的 uid、版本、題型、難度與主題；
   - `list/{translation|composition}-{tier}.json`：列表卡片；
   - `prompts/{uid}@{v}.json`：作答時才下載，含中文題目、提示、圖與鷹架；
   - `answers/{uid}@{v}.json`：交出作答後才下載，含本站參考譯文、4 部分評分規準、誤譯陷阱、解析、作文評分規準與兩篇範文。

   作答頁的網路請求裡看不到答案。
4. **不用 AI 的對照流程。**
   - 中譯英兩句都寫了、或作文寫了內容以後，按「寫好了，對照參考譯文」或「寫好了，看評分規準與範文」。
   - 按下後作答鎖定成唯讀，避免看完答案再改、讓自評失真，接著顯示本站內容與自評。
   - 中譯英依每句 4 部分逐項記錯，計分規則和 AI 批改相同：每部分 1 分、每錯扣 0.5、扣完為止；句首大寫、句尾標點各扣 0.5。大寫與標點用的是 Worker 同一支 `checkMechanics`（搬到 `@gsat/shared`，§2.3）。
   - 作文先看本題的評分重點、自評四項，範文收在下方展開，標「AI 生成範文，僅供參考」。
5. **AI 批改沿用歷屆題的整條流程。** Worker 的題目庫加入同一批題組：group id 例如 `ai.tr.1b2c4e@1`，小題 id 例如 `ai.tr.1b2c4e@1#1`。API、任務、點數、輪詢與結果頁都不改。學生仍然只送 group id，題目文字與評分參考都在伺服器端（ARCHITECTURE §7）。本站作答頁直接呼叫既有的 `lib/submit.ts`，歷屆作答頁一行都不改（§2.5）。
6. **本站的評分參考會給 AI 評分者。**
   - 中譯英給本站參考譯文，以及每句的 4 部分（中文＋部分可接受寫法）；作文給題目要求的內容步驟與四項評分重點。
   - 這些內容放在 user 訊息的 `<website_reference>` 區塊，寫明「是範例，不是標準答案」。
   - 系統提示與可快取的前綴一個字都不改，所以歷屆題的請求與 `prompt_version` 不變；本站題改用新的範本版本 `translation-user-guided@1`、`essay-user-guided@1`。
   - 不給誤譯陷阱、常見錯誤、加分寫法、分數帶描述與範文（理由見 §5.5）。
   - 題庫文字是代理寫的資料：含 `<`、`>` 的題組在選題時就略過；範本用到的每個結構標籤（`task`、`source_zh`、`sentence`、`sentence_reference`、`website_reference`、`student_text`、`essay_stats`）一律由 `neutralizeTags` 中和，不只 `student_text`。
7. **D1 不需要遷移。** 本站題的最小 `item_groups` 列用 `origin 'agent'`、`license 'original-ai'`、`derivation 'original'`、`tier`，以及檔案裡的 `format_version`，全部符合 0001 的 CHECK 與外鍵。歷屆題的列寫法一個值都不變，連 `content_hash` 也不變（§5.2）。
8. **SVG 只走安全的路徑。**
   - 建置時依嚴格白名單把 SVG 解析後重新序列化，不是從原字串裡過濾。數值一律照同一套數字文法（允許小數與指數，§4.6）。不合格的 SVG 不發布，那張圖只保留文字描述。
   - 畫面一律用 `<img src="data:image/svg+xml;charset=utf-8,…" alt="">` 顯示，圖說與完整的文字描述放在 `<figcaption>`。
   - 程式裡沒有、也不准出現 `dangerouslySetInnerHTML` 等直接插入 HTML 的寫法，有測試檢查。
   - SVG 不送進 Worker。
9. **D8 的防線（§6）**：
   - 題庫驗證（CI，8 字）；
   - 選題時的比對 `bankD8Hits`：網站與 Worker 共用，包含 7 字、整句、8 漢字，以及 Worker `findLeaks` 的片段比對；命中就不發布；
   - 輸出白名單；
   - 輸出前的最後檢查（網站與 Worker 各一道），呼叫和選題同一支 `d8HitsInStrings`，再加上既有的整份檔案比對；
   - e2e 檢查畫面文字。

   任何一道不通過，那一組就不發布，或整個建置失敗。7 字的門檻比題庫驗證的 8 字嚴，`npm run test:data` 是 7 字的關卡（§6、§11）。
10. **人工審核退回的 4 個版本先下架。** gsat-bank 工作樹的人工審核把 origin/main 上 4 個 verified 的版本改判為 rejected（13:22 UTC 比對時是原地改 `status`；13:39 再看，已經改成各新增一個內容不變、status 為 rejected 的 `@2`，`@1` 恢復成和 main 相同。兩種寫法都還沒合併進 main）：
    - `ai.cp.baef56@1`（下課十分鐘）：題目與評分規準不一致；
    - `ai.cp.4e3501@1`（科學實驗課）：圖、圖說與範文不一致；
    - `ai.tr.784b04@1`（搬家）：4 部分切分不公平，同一個時態錯誤會在兩個部分各扣一次；
    - `ai.tr.433349@1`（自助洗衣店）：第 1 句第 3 部分的可接受寫法太窄。

    它們登記在新的 **`data/unpublish.jsonl`**。這是只管「不發布」的新清單，和 `data/takedowns.jsonl`（授權撤回、刪檔）分開（§4.2）。main 現在只有 `@1`，所以要靠這份清單擋住；gsat-bank 的 `@2` 合併之後，第 1 點的「較新的 rejected、內容相同就撤下」也會擋住，兩者結果相同。設計時（origin/main 55dbe42）只有中譯英穩定基礎 10 組、作文穩定基礎 6 題；合併 origin/main 0571750（#16–#18 的題組都寫明「寫作題庫介面完成後才上架」）後實測會發布中譯英 129 組（穩定基礎 48、進階練習 44、超越頂標 37）、作文 30 題（三種難度各 10），三種難度都有題；某個難度沒有題時才顯示「出題中」。gsat-bank 的人工審核還在進行，所以每次上線前都要比對一次兩邊會發布的題組（§9 第 1 步）。
11. **部署設定跟著改。**
    - `worker-deploy.yml` 的觸發路徑加入 `data/bank/v1/translation/**`、`data/bank/v1/composition/**`、`data/unpublish.jsonl`；
    - `vercel.json` 的 ignoreCommand 加入 `data/unpublish.jsonl`。

    網站先上線、Worker 晚幾分鐘部署的空窗裡，送 AI 批改會看到「這題的 AI 批改還在準備中」，畫面引導改用自我檢核。

## 1. 範圍與限制

| 項目 | 決定 |
|---|---|
| 題目 | AI 題庫（gsat-bank/v1）的 translation 與 composition，三種難度。合併 origin/main 0571750 後三種難度都有題：中譯英 129 組（48／44／37）、作文 30 題（10／10／10）（§0 第 10 點） |
| 發布條件 | 同時符合：verified、練習池、最新版、授權 original-ai／original、沒有登記在 `data/unpublish.jsonl`、形狀檢查通過、D8 通過。draft、rejected、checkpoint 與被撤下的版本，網站和 Worker 都拿不到 |
| 不用 AI | 任何人都能作答、使用鷹架提示，寫完後對照本站參考內容並自評。草稿只存在這台裝置（localStorage） |
| AI 批改 | 需要登入、同意條款且 AI 已核准（`aiAccessOf(...).state === 'ready'`）；照片模式另外要 `access.ocr`。點數、額度、每日上限都和歷屆題相同（`AI_TASK_POINTS`） |
| 受保護內容 | 不公開大考中心的官方參考譯文、評分原則原文、官方範文或佳作。本站題的參考譯文、評分規準與範文都是本站撰寫（README §3.7） |
| 標示 | 每個本站題頁面的頂端放 `AiGroupBadge`；頁尾寫「本題由 AI 出題…不是大考中心的試題」。不用大考中心的標誌，也不用它的名稱當標題 |
| 裝置 | 同既有頁面：320–390 px 寬沒有水平捲動、支援深色模式、只用鍵盤可以完成整個流程 |
| 不做 | 「改一改再送」重批（SPEC §6.8 步驟 7）、作文計時、轉承詞挑選器、伺服器端的做題紀錄與隨機抽題、句型卡、修改圖片內容、把歷屆作答頁的送出流程抽成共用模組（§11 第 4 點） |

## 2. 使用者流程

### 2.1 入口

以下都以 8028596 的內容為準。

- **/writing（`WritingHomePage`）**：原本兩張卡（中譯英、英文作文，連到歷屆題）不變，下面加一個「本站仿真題（AI 出題）」區塊，放兩張卡連到 `/writing/translation/ai` 與 `/writing/essay/ai`。說明文字寫死在程式裡，不載入題庫資料，也不匯入 practice 模組，這一頁的 chunk 不會變大。「自我檢核」的說明在「本站不提供大考中心的官方參考譯文與範文；需要時請看各題附的官方檔案連結。」後面補一句：「本站仿真題附本站撰寫的參考譯文、評分規準與範文，寫完才顯示。」
- **歷屆列表頁（`/writing/translation`、`/writing/essay`）**：標題下加 `SourceTabs`，內容是「歷屆試題｜本站仿真」兩個連結，用 `aria-current="page"` 標出目前所在的一邊。本站列表頁也放同一組。
- **資訊頁（`/translation`、`/composition`）**：8028596 在兩頁最後有一個「陸續加入」區塊，列的正是「本站自撰的仿真中譯英題組」「本站自撰的仿真作文題與範文」。上線後這句話就不對了，所以**整個「陸續加入」區塊換成「本站仿真題」區塊**（`InfoSection title="本站仿真題"`）：
  - `/translation`：「AI 依學測題型出的中譯英題組，分穩定基礎、進階練習、超越頂標三種難度，標示『AI 出題・已通過自動驗證・人工審核中』。寫完可以對照本站撰寫的參考譯文與 4 部分評分規準自我檢核；登入並通過申請後，也能送 AI 批改。」加上連結「前往本站仿真中譯英」→ `/writing/translation/ai`。
  - `/composition`：「AI 依學測題型出的看圖寫作題，穩定基礎附構思圖、大綱與句型開頭。寫完可以對照本站的評分重點與兩篇範文（穩健版、頂標版）；登入並通過申請後，也能送 AI 批改或拍照上傳手寫稿。」加上連結「前往本站仿真作文」→ `/writing/essay/ai`。
  - 「現在就能練習」原本寫的是歷屆題，維持不變。
  - 「AI 批改」那一句的 `aiOpen` 分支照舊；本站仿真題區塊不提點數，點數說明已經在「現在就能練習」裡。

  > **合併 origin/main 55dbe42（PR #15「各題型頁直接載入題庫作答；中譯英、作文頁直接列出題目」）之後，上面這一段改成下面的版面，以這裡為準。** PR #15 把兩頁改成「頁首下面直接是可以作答的題目」（歷屆列表 `TranslationPromptList`／`EssayPromptList` 包在 `ListOrigin` 裡，作答頁的返回連結回到題型頁），其他六個題型頁則是頁首下面直接是 AI 題庫的難度切換與題組。兩邊合起來：
  >
  > 1. **本站仿真題**（`ListSection`，`<h2>`，`id="bank-questions"`）：`AiGroupBadge`、一句說明（AI 出題、不是大考中心的試題；寫完可以對照本站的參考譯文／評分重點與兩篇範文；`aiOpen` 時加「登入並通過申請後，也能送 AI 批改」），下面是和 `/writing/{translation|essay}/ai` 同一份列表本體 `BankPromptList`（`headingLevel={3}`、`limit={6}`）：三格難度切換（radio，網址 `?tier=`，每格顯示「N 組（題）・已完成 M」，沒有題組的顯示「出題中」，外觀同題庫練習的 `TierSwitcher`）、那個難度的卡片。題型頁下面還有歷屆列表，所以只先列 6 張（這台裝置還沒完成的排前面），「顯示全部 N 組」在原地展開、焦點移到第一張新卡片；標題旁有「跳到歷屆試題」頁內連結。「出題中」裡其他難度的連結留在目前這一頁（`/translation?tier=basic`），不會把人帶到 `/writing/.../ai`。
  > 2. **歷屆試題**（`ListSection`，`<h2>`，`id="exam-questions"`）：PR #15 的列表，各考試的標題降成 `<h3>`（`headingLevel={3}`），`?kind=` 篩選照舊；`?tier=` 與 `?kind=` 各記各的。
  > 3. 兩份列表都包在 `ListOrigin` 裡。本站作答頁用 `listOriginBack(state, 預設, '?tier=…')`：從題型頁點進來的返回「中譯英」→ `/translation?tier=basic`（停在同一個難度），否則照舊回 `/writing/.../ai?tier=…`；「下一組」用 `listOriginState` 把同一份 state 帶下去；找不到題目時的按鈕也回到題型頁。
  > 4. 下面的「作答與批改方式」改寫成兩種題目都對得上：歷屆題用檢核清單、本站仿真題對照本站參考譯文（中譯英逐部分記錯，作文對照評分重點與範文，對照後作答鎖定）、本站仿真題的三層提示與作文鷹架、兩種都能送 AI 批改；「學測怎麼考」不變。原本放在最後的「本站仿真題」說明區塊與「前往本站仿真中譯英／作文」連結拿掉（列表已經在頁首）。
  > 5. 手機（375×667）上，第一個畫面看得到難度切換、那個難度的標題與第一張卡片的開頭（e2e `section-practice.spec.ts`），為此難度切換的「難度」只給螢幕閱讀器（`sr-only` 的 `legend`），列表頁 `/writing/.../ai` 也一樣。
- **`modules.ts` 的說明（`summary`）要改三個**。8028596 的 `/translation` 是「歷屆學測、指考的翻譯題線上作答：…」，不是舊版的「歷屆與仿真翻譯題」，所以一定要改：
  - `/translation`：「歷屆學測、指考與本站仿真的翻譯題線上作答：用檢核清單或本站參考譯文自我檢核，或由 AI 依大考評分原則逐句批改、標出錯誤並附修正版。」
  - `/composition`：「歷屆的看圖、信函與主題寫作，加上附範文的本站仿真題；可拍照上傳手寫作文，由 AI 辨識並批改。」
  - `/writing`：「翻譯與作文的線上作答，含歷屆題與本站仿真題；登入並通過申請後，可由 AI 依大考評分原則批改。」
  - `modules.test.ts` 規定每個學習模組的說明不能含其他學習模組的標題（例如「中譯英」「英文作文」「歷屆試題」「題庫練習」「單字」）。上面三句都已經對過；實作時改字要再跑一次這個測試。`HomePage.test.tsx` 用 `page.summary` 比對首頁卡片，不用改。
- **/practice（`PracticeHome`）**：題型選單下加一行「中譯英、英文作文的仿真題在寫作練習」與兩個連結。

### 2.2 列表（依難度）

1. 進入 `/writing/translation/ai`。頁面先讀 `index.json`，算出每個難度有幾組。網址沒有 `?tier=` 時，選第一個有題的難度；三個都沒有題時選 basic 並顯示「出題中」。
2. 難度切換用 radio，選擇記在網址的 `?tier=`（重新整理與返回時保留）。切換時只下載那個難度的 `list/{section}-{tier}.json`。
3. 卡片內容：
   - 中譯英：主題，加上兩句中文題目；
   - 作文：主題、題型（看圖寫作或圖表寫作）、提示的前 60 個字、「附圖 N 張」。
4. 卡片右上角讀這台裝置的草稿（§2.5 的 `BankTranslationDraft`／`BankEssayDraft`）：
   - 「已完成」：`revealedAt !== null`（已對照）或 `aiSubmittedAt !== null`（已成功送出 AI 批改）；
   - 「草稿」：有文字但兩者都是 null；
   - 都沒有就不顯示。
5. 沒有題組的難度顯示「這個難度還在出題中」，並列出其他有題的難度。

### 2.3 中譯英：作答 → 對照

1. **讀題。** 兩句中文，同一個主題；作答說明用本站的固定文字（§4.1 的 `BANK_TRANSLATION_INSTRUCTIONS`，和 Worker 送給 AI 的是同一句）。
2. **鷹架。** 每句有一個「看提示（1／3）」按鈕，一次打開一層，內容來自 `explanations.items[n].hints`：① 切成四段 ② 標的詞彙 ③ 句型框架。開到第幾層記在草稿的 `hintLevels`（SPEC §6.8 步驟 2「逐層開，記錄使用」）。
3. **作答。** 作答框和歷屆題相同：每句最多 500 字元、即時提醒句首大寫與句尾標點（`lib/text.ts` 的 `checkTranslationSentence`，這是打字時的提醒，規則不動）、600 ms 後自動存草稿。
4. **對照。** 兩句都寫了才能按「寫好了，對照參考譯文」。按下後：
   - 草稿記下 `revealedAt`，作答框改成唯讀；
   - 下載 answers 檔，焦點移到「對照與自評」面板。每句依序顯示：
     - 你的譯文；
     - 本站參考譯文（2 種以上，標的詞彙與句型加粗，註明「AI 撰寫、不是唯一答案」）；
     - 4 部分評分規準：每部分列出中文、可接受寫法、常見錯誤（收合），加上錯誤數按鈕（−／＋，0–2）與「這部分整個漏譯」勾選；
     - 誤譯陷阱、加分寫法、改寫句構說明、解析，都放在收合區。
5. **自評分**（`bankTranslationSelfScore`）：
   - 每部分 = max(0, 1 − 0.5 × 錯誤數)，勾了漏譯就是 0；
   - 句首沒大寫、句尾標點不對各再扣 0.5，整句最低 0。這兩項由程式判斷，用的是 **`@gsat/shared` 的 `checkMechanics(normalizeStudentText(text))`**：
     - `checkMechanics` 從 `apps/api/src/ai/scoring.ts` 原樣搬到 `packages/shared/src/writing-mechanics.ts`（由 `index.ts` 直接轉匯出，**不經** `writing.ts`：首頁會用到 `writing.ts` 的常數，由它轉匯出會讓 rolldown 把首頁的主程式拆成 6 個一開始就要載入的小檔，多約 3 kB gzip）；
     - `normalizeStudentText` 是 `apps/api/src/ai/filter.ts` 的 `sanitizeStudentText`（NFKC、換行統一、去不可見字元）原樣搬過去後的名字。Worker 是對淨化後的文字做 `checkMechanics`：NFKC 會把全形的 `？！，；：（）` 變成半形，所以「Is it？」在 Worker 不扣標點。前端不先做同樣的正規化，同一句就會得到不同的扣分；
     - `scoring.ts` 與 `filter.ts` 改成從 shared 匯入並轉匯出（`export { checkMechanics } from '@gsat/shared'`、`export { normalizeStudentText as sanitizeStudentText } …`），Worker 的呼叫端與 `ai.scoring.test.ts`、`ai.rules.test.ts` 都不用改；
     - 打字時的提醒（第 3 步）仍用 `checkTranslationSentence`，它會多提醒全形標點；那是輸入提醒，不是計分；
   - 合計 /8，用 `role="status"` 播報。

   這和 `apps/api/src/ai/scoring.ts` 的 `scoreTranslationRater` 是同一套規則，只差「同一個錯誤只扣一次」交給學生自己判斷。`packages/shared/src/writing.test.ts` 加一組對照測試，確認同一批句子在兩邊得到相同的扣分（§7.1）。
6. **再練一次。** 「清除重寫」（`ConfirmButton`）清掉文字、對照狀態與自評（`aiSubmittedAt` 與 `lastSubmissionId` 保留，卡片仍顯示「已完成」）。「下一組」連到同一難度的下一組，優先選這台裝置沒做過的。

### 2.4 作文：作答 → 對照

1. **讀題**：
   - 提示（`stem`）；
   - 圖：SVG 加文字描述；圖表題另有資料表；
   - 「題目要你寫什麼」：`moves` 依段落列出；
   - 字數與段數要求。
2. **鷹架**（收合，學生自己打開）：
   - basic：構思圖（5W1H）、兩段大綱、每段的句型開頭；
   - advanced：兩段大綱；
   - top：規劃檢核表；
   - 三個難度都有三層提示（`hints`），和中譯英一樣一次開一層。
3. **作答。** 打字作答，字數與段數即時檢查，和歷屆題相同（`checkEssayLength`）。
4. **對照。** 有寫內容就能按「寫好了，看評分規準與範文」；少於 100 字時先跳確認。按下後：
   - 作答鎖定；
   - 顯示評分規準：四項各自的本題重點（`focus_zh`）與分數帶，加上扣分說明；
   - 自評四項（`EssaySelfAssess`，傳入本題的 criteria，取代通用提示）；
   - 下方「看範文」收合區放兩篇：穩健版、頂標版。每篇有段落功能、可切換的註解（轉承詞、細節句、個人經驗句、好用句型、片語）和本站標的分數。範文依單一 `\n` 分段（README §3.6）。
5. **手寫拍照**只在 AI 批改的路徑提供，流程同歷屆題。

### 2.5 AI 批改（登入且核准）

- **打字作答**：和歷屆題完全相同，只是 group id 換成本站題的。
  1. `upsertSubmission(draft.submissionId, { kind, group_id: 'ai.tr.1b2c4e@1', input_mode: 'typed', body }, { body })`；中譯英的 `body.items[].item_id` 是 `'ai.tr.1b2c4e@1#1'`、`'…#2'`。成功後先把 `submissionId` 記進草稿（下一步失敗時重送沿用同一份）。
  2. 有自評才送 `saveSelfAssessment`（失敗不影響批改）。
  3. `startTask('translation-grade' | 'essay-grade')`。成功後：`aiSubmittedAt = Date.now()`、`lastSubmissionId = submission.id`、`submissionId = null`。
  4. 導到 `/writing/submissions/:id`。
  5. `AlreadySubmittedError`（上一次其實送出了、回應遺失）：同第 3 步記下 `aiSubmittedAt` 與 `lastSubmissionId = err.submission.id`，導到那一份。
- **作文拍照**：`PhotoPicker` → `upsertSubmission(…, input_mode: 'photo')` → `uploadPhoto` → `startTask('essay-ocr')` → 導到結果頁確認文字 → `essay-grade`，和歷屆題相同。`startTask('essay-ocr')` 成功時記 `aiSubmittedAt`（之後的確認與批改在結果頁完成）。
- 送 AI 前不需要先對照。已經對照（鎖定）的作答也可以送，送出的是鎖定的文字。
- **程式的放法：本站的兩個作答頁直接呼叫既有的 `lib/submit.ts`（`upsertSubmission`、`saveSelfAssessment`、`startTask`、`AlreadySubmittedError`）與 `lib/writingApi.ts`（`uploadPhoto`、`deletePhotos`）、`lib/useErrorView.ts`。** 歷屆的 `TranslationAttemptPage.tsx`、`EssayAttemptPage.tsx` 一行都不改。代價是兩個本站頁各有一段約 25–40 行、和歷屆頁相似的送出流程；抽成共用模組留給另一個 PR（§11 第 4 點），那個 PR 要附上同時跑兩種頁面的送出測試。
- **草稿型別**（`lib/drafts.ts`，鍵沿用 `draftKey(kind, groupId)`，所以含版本）：

```ts
export interface BankTranslationDraft {
  texts: string[];
  hintLevels: number[];             // 每句開到第幾層提示（0–3）
  revealedAt: number | null;        // 按下「對照」的時間；非 null＝作答唯讀
  partErrors: number[][];           // [句][部分] 自評錯誤數 0–2
  partMissing: boolean[][];         // [句][部分] 整個漏譯
  submissionId: string | null;      // 已建立、還沒成功送出批改的提交（重送沿用，同歷屆題）
  aiSubmittedAt: number | null;     // 最近一次成功送出 AI 批改的時間（startTask 成功，或遇到 AlreadySubmittedError）
  lastSubmissionId: string | null;  // 那一次的提交 id：作答頁顯示「看上次的批改結果」連結
  updatedAt: number;
}
export interface BankEssayDraft {
  text: string;
  mode: 'typed' | 'photo';
  hintLevel: number;
  revealedAt: number | null;
  selfScores: PartialEssayScores | null;
  submissionId: string | null;
  aiSubmittedAt: number | null;
  lastSubmissionId: string | null;
  updatedAt: number;
}
```

  型別守衛 `isBankTranslationDraft`／`isBankEssayDraft` 遇到缺欄位的舊資料時補預設值，不丟掉文字。

### 2.6 結果頁與寫作紀錄

- `parseBankGroupId('ai.tr.1b2c4e@1')` 會得到 `{ uid, version, section_type }`。`groupLabel` 回傳「本站仿真」，所以標題是「本站仿真 中譯英」，載入題目後加上主題。`attemptPathOf` 回傳 `/writing/translation/ai/1b2c4e`（只看 uid，永遠指向目前的版本）。
- `usePromptFor` 遇到本站題時，**先讀 `index.json` 確認版本**，再決定要不要讀 `prompts/{uid}@{v}.json`：
  - index 的版本和提交的版本相同：讀 prompts 檔，供兩個地方使用：
    - `TranslationResult` 的中文題目。它的 prop 型別放寬成 `{ items: ReadonlyArray<{ stem: string }> }`，歷屆題照舊傳 `TranslationSet`；
    - `OcrConfirm` 的段數要求（2）。
  - index 有這個 uid、但版本不同（新版已上架）：**不請求** `prompts/…@1`、`answers/…@1`（只發布最新版，這兩個檔已經不存在，請求只會得到 404 與瀏覽器的 console 錯誤）。頁面頂端顯示「這題已更新成新版本，參考內容改看新版」，附連結「看新版題目」→ `attemptPathOf`。批改結果照常顯示（GET 從 `gradings` 重建，不需要題目），只是沒有中文題目；
  - index 沒有這個 uid（已下架）：同上，文案是「這題已下架，本站參考內容不再提供」，沒有連結；
  - 讀 index 或 prompts 時遇到 `DataLoadError` 的 `not_found`（網站剛好在這幾秒內更新）：當成「已更新」處理，顯示同一句話；其他錯誤照現在的做法不顯示題目。
- 本站題在結果頁頂端也放 `AiGroupBadge`。graded 之後多一個收合區，標題是「本站參考譯文與評分規準」或「本站評分規準與範文」，展開時才下載 answers 檔；版本不是最新時不顯示這個收合區，改成上面的說明。
- 寫作紀錄（`SubmissionHistory`）的那一列顯示「本站仿真 中譯英」。

### 2.7 邊界情況

| 情況 | 行為 |
|---|---|
| `:code` 格式不對、不在 index（打錯或已下架） | 顯示「找不到這個題目」，說明「可能打錯網址，或這題已更新、下架」，並放回列表的按鈕 |
| 新版 @2 上架 | index 指向 @2，作答頁就用 @2。草稿鍵含版本（`gsat-writing-draft:v1:translation:ai.tr.1b2c4e@2`），所以是新的草稿；@1 的舊草稿留在這台裝置，登出時 `clearLocalWritingData` 會一起清掉 |
| 已批改的 @1 提交，之後 @2 上架 | 結果頁照常顯示批改結果；不請求 @1 的 prompts／answers，顯示「這題已更新成新版本，參考內容改看新版」與新版連結（§2.6） |
| 已批改的提交，之後那一題下架 | 結果頁照常顯示批改結果，顯示「這題已下架，本站參考內容不再提供」 |
| 網站已部署、Worker 還不認得這題 | POST /api/submissions 回 400「沒有這個題組」。畫面顯示「這題的 AI 批改還在準備中（網站剛更新），請先用自我檢核，幾分鐘後再試」。訊息字串移到 `@gsat/shared` 的常數 `WRITING_UNKNOWN_GROUP_MESSAGE`，前後端共用，回應的內容一個字都不變 |
| Worker 改版後，舊版的草稿或失敗提交 | PUT 或重送回 409「找不到這份提交的題目」。畫面顯示「這題已經更新成新版本，請回到題目重新作答」 |
| answers 檔載入失敗 | 作答仍保持鎖定；對照區顯示 `DataError` 和「再試一次」 |
| localStorage 不能用（無痕模式） | 照常作答與對照，提示「離開頁面後內容會遺失」，同歷屆題 |
| 後端沒部署（features 全關） | 不打任何 API，只能自我檢核，同歷屆題 |

## 3. 路由與畫面

### 3.1 路由（`App.tsx`）

| 路由 | 元件（各自是一個 lazy chunk） | 說明 |
|---|---|---|
| `/writing/translation/ai` | `features/writing/bank/BankListPage`（`section="translation"`） | `?tier=basic\|advanced\|top` |
| `/writing/essay/ai` | 同上（`section="composition"`） | |
| `/writing/translation/ai/:code` | `features/writing/bank/BankTranslationAttemptPage` | `:code` 必須符合 `^[0-9a-f]{6}$`，uid = `ai.tr.{code}` |
| `/writing/essay/ai/:code` | `features/writing/bank/BankEssayAttemptPage` | uid = `ai.cp.{code}` |

- React Router 的排序會讓靜態段 `ai` 優先於 `:examId`，而歷屆考卷的 id 不可能是 `ai`，所以不會撞到歷屆的作答頁。
- 這些都是子頁，不放進 `modules.ts` 的 `PAGES`。
- 兩個 kind 的命名規則不同：路由和提交的 kind 是 `essay`，資料檔與題庫的 section_type 是 `composition`，沿用既有慣例。

### 3.2 版面（手機寬度）

```
列表 /writing/translation/ai?tier=basic          作答 /writing/translation/ai/1b2c4e
┌────────────────────────────────┐   ┌────────────────────────────────┐
│ ← 寫作練習                      │   │ ← 本站仿真中譯英（穩定基礎）      │
│ 本站仿真中譯英              (h1) │   │ 本站仿真・穩定基礎               │
│ [歷屆試題][本站仿真●]            │   │ 中譯英：社團招生            (h1) │
│ (AI 出題・已通過自動驗證・人工審核中)│  │ (AI 出題・已通過自動驗證・人工審核中)│
│ AI 依學測題型出題，不是大考中心的  │   │ 請把下面兩句中文翻成正確、通順的英文… │
│ 試題；寫完可以對照本站參考譯文。   │   │ ┌ 第 1 句（4 分）        (h2) ┐ │
│ 難度 (●穩定基礎 10)(進階 0)(頂標 0)│   │ │ 開學第一週是各個社團忙著…     │ │
│ 一句一個句構、L1–4 單字…         │   │ │ [英文譯文 textarea]           │ │
│ ┌────────────────────────────┐ │   │ │ 提醒：…        12／500 字元   │ │
│ │ 社團招生           已完成 ›  │ │   │ │ [看提示（1／3）]              │ │
│ │ 1. 開學第一週是各個社團…      │ │   │ └──────────────────────────┘ │
│ │ 2. …                        │ │   │ ┌ 第 2 句 … ┐                 │
│ └────────────────────────────┘ │   │ ┌ 送出 ─────────────────────┐ │
│ …                               │   │ │ [寫好了，對照參考譯文]          │ │
│ 頁尾：本題由 AI 出題…            │   │ │ [送出 AI 批改（N 點）]         │ │
└────────────────────────────────┘   │ │ AiNotice／點數／開通說明  [清除重寫]│ │
                                     │ │ （送過時）看上次的批改結果 ›      │ │
                                     │ └──────────────────────────┘ │
                                     │ ┌ 對照與自評（對照後）    (h2) ┐ │
                                     │ │ 第 1 句  你的譯文：…    (h3) │ │
                                     │ │ 本站參考譯文（AI 撰寫，不是唯一答案）│
                                     │ │ ① 開學第一週  可接受：…       │ │
                                     │ │   常見錯誤 ▸  錯誤數 [−]0[＋] □漏譯 │
                                     │ │ …   這句自評 3.5／4           │ │
                                     │ │ ▸誤譯陷阱 ▸加分寫法 ▸解析     │ │
                                     │ │ 合計自評 7／8（role=status）  │ │
                                     │ └──────────────────────────┘ │
                                     │ [下一組 →]                     │
                                     │ 頁尾：本題由 AI 出題…           │
                                     └────────────────────────────────┘
```

作文作答頁的順序是：

1. 題目：提示、圖、題目要你寫什麼、字數與段數；
2. 鷹架（收合）；
3. 作答區：打字或拍照，同歷屆題的切換；
4. 送出卡；
5. 對照區：評分規準、自評、範文（收合）；
6. 頁尾。

### 3.3 標示與文案

- **頁首**：`AiGroupBadge`（`features/practice/components/AiGroupBadge.tsx`，沒有 props；`AiNotice.tsx` 轉匯出。寫作頁直接從 `AiGroupBadge.tsx` 匯入，才不會把 `AiNotice.tsx` 的選文標示、授權連結與 `practice/chart.ts` 帶進列表與作答頁），旁邊放難度標籤（`TIER_LABELS`）。
- **頁尾 `BankSourceNote`**（新元件）：「本題由 AI 依學測題型出題，已通過本站自動驗證，人工審核中；不是大考中心的試題。參考譯文、評分規準與範文都是本站撰寫，僅供參考，不是唯一答案。」本站題不使用 `SourceNote`，因為它寫的是「題目來源：大學入學考試中心」。
- **範文**標「AI 生成範文，僅供參考」（SPEC §6.9）。
- **AI 批改按鈕旁**沿用 `features/writing/components/ui.tsx` 的 `AiNotice`（「AI 評分僅供參考，不是大考中心的正式評分」）。注意 practice 也有一個叫 `AiNotice.tsx` 的檔案（轉匯出 `AiGroupBadge`），兩個是不同的東西。
- **難度說明**：寫作頁用新的常數 `WRITING_TIER_HINTS`（`features/writing/bank/labels.ts`），依 README §3.5–3.6 撰寫，不用 `TIER_AUDIENCE`，因為那是選擇題「七成答對」的說法：
  - basic：「一句一個句構、以 L1–4 單字為主；作文看圖描述再寫個人經驗，附構思圖、大綱與句型開頭」
  - advanced：「一句兩個句構，常要調整語序；作文看圖談看法、原因或影響，附兩段大綱」
  - top：「較長的句子與指定句型；作文是圖表或多張圖的比較，只附規劃檢核表」
- **主題**用 `displayTopic`（只顯示含中文的主題）。
- 全部是繁體中文、台灣用語。

### 3.4 手機、深色模式、無障礙

- **圖的外框**：`rounded-xl border border-line bg-white p-2`。深色模式也維持淺底、不反轉顏色（SVG 自帶 `#f6f3ea` 背景與深色字）。
- **圖的大小**：`<img class="block h-auto w-full">`，最寬 32 rem。
- **放大檢視**：按「放大檢視」後，圖切成 2 倍寬，放在 `overflow-x-auto` 的容器裡。捲動只發生在圖框內，頁面本身不會水平捲動；這是因為 320 px 寬時 SVG 的 10 號字只剩約 8 px。按鈕的名稱是「放大檢視第 N 張圖」。
- **評分規準**在手機上用一部分一張的卡片（`<dl>`），不用寬表格。
- **標題階層**：h1 是頁名；h2 是每一句、每個區塊（題目、寫作鷹架、提示、評分規準與範文；結果頁的「本站參考譯文與評分規準」「本站評分規準與範文」收合區也有自己的 h2）；h3 是每一部分、每一項評分、「自評四項」與「範文」；h4 是自評分數與每一篇範文（穩健版、頂標版）。
- **操作與焦點**：
  - 難度切換用 `fieldset`＋`legend`＋radio，樣式同 `KindFilter`；
  - 提示、對照、範文的按鈕都有 `aria-expanded` 與 `aria-controls`；
  - 對照打開後用 `useRevealOnOpen` 把焦點移到面板。
- **錯誤數按鈕**的 `aria-label` 寫成「第 1 句第 2 部分的錯誤數」。唯讀的作答框用 `readOnly`，不用 `disabled`，螢幕閱讀器才讀得到內容。
- **圖的替代文字**：`<img alt="">`，圖的文字等價內容全部放在同一個 `<figure>` 的 `<figcaption>`：先是 caption（粗體一行），再是 description，有 `rows` 時再接表格。`<figure>` 的名稱由 figcaption 提供。這樣螢幕閱讀器只讀一次 caption（不會 `alt` 讀一次、figcaption 又讀一次），看不清楚圖的人也讀得到同一段文字。沒有 caption 時只放 description。

## 4. 公開資料與建置

### 4.1 選題：`packages/shared/scripts/bank-select.mjs`

這個模組是零依賴的 Node ESM，寫成 `// @ts-check` 加 JSDoc，旁邊放一份 `bank-select.d.mts` 給 TypeScript 測試匯入（和 `apps/api/scripts/build-writing-prompts.d.mts` 同樣的做法）。新增 `packages/shared/tsconfig.scripts.json`（`allowJs`、`checkJs`、`types: ["node"]`、`include: ["scripts/*.mjs", "scripts/*.d.mts", "scripts/*.test.ts"]`），shared 的 `typecheck` 改成 `tsc -p tsconfig.json && tsc -p tsconfig.scripts.json`。`tsconfig.json` 只含 `src`，所以 `scripts/*.test.ts` 一定要列在 scripts 的設定裡，否則沒有任何 tsc 檢查它們。

為什麼放在 `packages/shared/scripts/`：兩條部署路徑本來就會因為它改動而觸發（Vercel 看 `packages`，Worker 看 `packages/shared/**`），而且它不屬於 web 或 api 任何一邊。

```js
export const WRITING_SECTION_TYPES = ['translation', 'composition'];
/** 作答說明（本站文字）：網站的作答頁與 Worker 送給 AI 的 <task> 用同一句。 */
export const BANK_TRANSLATION_INSTRUCTIONS = '請把下面兩句中文翻成正確、通順的英文。兩句是同一個主題，每句 4 分。';
export const BANK_ESSAY_INSTRUCTIONS = '請依提示寫一篇英文作文，文分兩段，至少 120 個單詞。';

/**
 * data/unpublish.jsonl → Map<repo 相對路徑, { date, reason }>；檔案不存在回空 Map。
 * 下架是安全機制，一律 fail closed（丟錯；網站建置與 Worker 產生器都會失敗）：
 *   任何一行不是 JSON、欄位不是剛好 path／date／reason、path 不在 data/bank/v1/ 底下或檔名不符 {uid}@{v}.json、
 *   path 指到不存在的檔案（打錯字會讓題目照常上架）、同一個 path 登記兩次。
 */
export function readUnpublish(file, { repoRoot }) {}

/**
 * 通用選題（題庫練習與寫作共用；現在 bank-data.mjs buildBankData 裡那段迴圈原樣搬過來）：
 * 檔名、JSON 解析、verified、schema、pool、題型、下架、每個 uid 的最新 verified 版本、較新的未通過版本改了 contentKey 就撤下。
 * withdrawOnRejectedSameKey 為 true 時（寫作題），較新的版本是 rejected、contentKey 和目前版本相同，也撤下（reason 'withdrawn'，
 * 警告寫「@2 判定退回同一份內容」）。題庫練習傳 false，行為和現在完全相同（§11 第 2 點）。
 * 回傳 { chosen: [{ uid, version, file, raw }], skipped: [{ file, reason }], warnings, inputs, scanned }。
 * reason 多兩種：'unpublished'（unpublish.jsonl 有登記；也算「較新的未通過版本」參與撤下判斷）、'license'（寫作用）。
 */
export function selectBankGroups(bankDir, { sections, contentKey, withdrawOnRejectedSameKey, unpublished, relative }) {}

/** 寫作題的內容鍵：中譯英＝兩句中文＋參考譯文（排序）＋各部分可接受寫法（排序）；作文＝提示＋每張圖的 caption／description／rows／svg＋moves＋兩篇範文的 text。 */
export function writingContentKey(raw) {}

/**
 * 受保護片段：apps/api/scripts/build-writing-prompts.mjs 的 restrictedFragments 原樣搬來
 * （官方答案整句 ≥12 字元；答案與 scoring_notes 依 \n。．!?；; 切開後 ≥30 字元的片段；另回傳公開試題文字）。
 * 產生器改成從這裡匯入並轉匯出，ai.routes.test.ts 的匯入不用改。
 */
export function restrictedFragments(exam) {}   // → { fragments: string[], publicTexts: string[] }

/** 官方受保護文字的比對資料（傳入已解析的 data/exams/parsed 考卷；不讀檔）。 */
export function officialCorpus(exams) {}
// → {
//   translationTexts: string[],   // 官方譯文 answer／accepted_answers／answer_variants，≥20 字元（＝build-data 的 officialTranslationTexts）
//   englishRuns: Set<string>,     // translationTexts 的連續 7 字
//   hanRuns: Set<string>,         // scoring_notes 的連續 8 漢字，不跨標點，排除也出現在公開試題文字裡的
//   leakFragments: string[],      // 所有考卷 restrictedFragments 的聯集，排除出現在公開試題文字裡的（＝產生器 findLeaks 用的同一份）
// }
export const OFFICIAL_RUN_WORDS = 7;        // 和 build-data.mjs 現在的 OFFICIAL_TRANSLATION_RUN_WORDS 相同
export const OFFICIAL_HAN_RUN = 8;          // 和 validate_bank.py 的 OFFICIAL_HAN_RUN 相同
export function englishWords(text) {}       // build-data.mjs 的 englishWords／wordRuns 搬到這裡，build-data 改成匯入
export function wordRuns(text, n) {}

/**
 * 一串字串和官方文字的重疊，四種（不回傳官方文字本身，建置紀錄不能印出受保護內容）：
 *   translation_text：含任何一句 translationTexts（＝assertNoOfficialTranslations 第 2 項）
 *   english_run：和 englishRuns 有交集（＝assertNoOfficialTranslations 第 3 項）
 *   han_run：和 hanRuns 有交集
 *   leak_fragment：含任何一個 leakFragments（＝產生器的 findLeaks）
 * 「含」的比對方式和最後檢查相同：兩邊都先 JSON 跳脫再 includes。
 * @returns {{ index: number, kind: string, length: number }[]}
 */
export function d8HitsInStrings(strings, corpus) {}

/** 一個題組所有可能發布的字串（group＋annotations，不含 generation、verification、metrics；figures[].svg 用 sanitizeSvg 清理後要發布的字串）→ d8HitsInStrings，結果附欄位路徑。 */
export function bankD8Hits(raw, corpus) {}

/**
 * 寫作題的形狀檢查（網站與 Worker 都依賴的欄位）：回傳問題清單，空陣列＝可以發布。
 * 另外：WORKER_STRING_PATHS（送進 Worker 的字串：題目 stem、topic、figures 的 label／caption／description／rows、
 * rubric.moves、rubric.criteria.*.focus_zh、rubric.items.*.references、rubric.items.*.parts[].zh／accepted）
 * 只要有一個含 `<` 或 `>`，就回報問題（§5.5）。
 */
export function writingShapeProblems(raw) {}

/**
 * 寫作題選題＝selectBankGroups（WRITING_SECTION_TYPES、writingContentKey、readUnpublish 的結果）
 *  ＋授權（provenance.license === 'original-ai' 且 derivation === 'original'，否則 'license'）
 *  ＋形狀（writingShapeProblems 有問題 → 'bad_shape'）
 *  ＋D8（bankD8Hits 有命中 → 'd8_overlap'）。被略過的都會寫進 warnings，附上 uid 與原因。
 */
export function selectWritingGroups(bankDir, { exams, unpublishFile, repoRoot, relative }) {}
```

另外新增一支發布前的檢查工具 `packages/shared/scripts/bank-status-diff.mjs`（零依賴，不在 CI 跑，因為 CI 看不到另一個工作樹）：

```
node packages/shared/scripts/bank-status-diff.mjs --against /home/user/gsat-bank
```

- 比的是「兩邊各自會發布哪些題組」，不是逐檔比 status：對本 repo（帶本 repo 的 `unpublish.jsonl`）與另一個工作樹（不帶下架清單）各跑一次 `selectWritingGroups`，D8 比對資料都用本 repo 的 `data/exams/parsed`。這樣題庫工作線不論是原地改 status，還是新增內容不變的 rejected `@{version+1}`，都比得出來；
- 列出本 repo 會發布、另一邊不會發布的 `uid@v`，附上另一邊的原因（略過原因，以及造成撤下的那個檔案的 status 與 `status_reason` 前 80 字）；還沒登記在 `data/unpublish.jsonl` 的，印出建議加入的 JSON 行，並以 exit code 1 結束；
- 另外列出同一路徑在兩邊 status 不同的檔案（原地修改，違反 README §2），只警告；
- 反方向（另一邊會發布、本 repo 不會）只列出，不影響 exit code：那是還沒合併的新題；
- 用途見 §9 第 1 步。

規則與理由：

| 規則 | 決定 | 理由 |
|---|---|---|
| verified、最新版 | 同題庫練習 | 需求明訂。draft 還沒驗證完；rejected 已被淘汰 |
| 撤下 | (1) 有更新但未通過的版本（draft、rejected、無法解析），`writingContentKey` 和目前版本不同時，撤下舊版。(2) 有更新的 **rejected** 版本、`writingContentKey` 和目前版本**相同**時，也撤下舊版。更新的 draft 內容相同時照舊發布 | (1) 出新版多半是舊版有錯（SPEC §4.7），作文的 `answer` 是 null，選擇題用的 `answerKey` 看不出差別。新版只修解析的錯字時照舊發布。(2) 題庫工作線 2026-10-09 起用這種寫法記錄「已併入 main 的版本被人工審核退回」：新增的 `@2` 內容不變、status rejected，`status_reason` 開頭寫「@1 是判定流程中途的快照，當時誤記為 verified 併入 main；本版本記錄最終判定，沒有改動題目內容」。同一份內容已被判退回，就不能再發布。代價是「只改解析、驗證沒過」的 rejected 新版也會讓舊版下架；那只會少一題，不會發布有問題的內容 |
| 授權 | 只收 `original-ai`／`original` | README §3.7 規定寫作題一律如此。其他值代表檔案有誤，不要讓可能有出處義務的內容沒有標示就上架 |
| 形狀不符、D8 命中 | **略過並印警告，不讓建置失敗** | 網站和 Worker 都用同一個函式，結果一定一致。題庫練習的「契約違反就建置失敗」放在寫作題會造成不一致：網站建置失敗、停在舊版，Worker 卻照常部署。最後檢查（§6 第 4、4' 道）呼叫同一支 `d8HitsInStrings`，所以選題通過的資料一定也通過最後檢查；最後檢查失敗只代表程式錯了（例如投影時拼出新字串）。真實資料的形狀與 7 字門檻另外由 `npm run test:data`（§7.1）在 CI 擋下 |
| 下架清單格式錯、路徑不存在 | **建置失敗**（網站與 Worker 都是） | 下架是安全機制，打錯路徑時題目會照常上架，所以 fail closed。兩邊用同一支 `readUnpublish`，一定一起失敗；PR 的 CI（app job 的 `pretest` 會跑產生器、`npm run build` 會跑網站建置）在合併前就會擋下 |
| 題庫練習 | `bank-data.mjs` 的 `buildBankData` 改呼叫 `selectBankGroups`（`sections: PRACTICE_SECTION_TYPES`、`contentKey: answerKey`），行為與訊息不變 | 兩條管線不會各自改出不同的規則。`bank-data.test.ts` 與 golden 不改，必須照樣通過；中譯英對題庫練習仍然是 `unsupported_section` |

### 4.2 人工審核下架清單 `data/unpublish.jsonl`

**為什麼不用 `data/takedowns.jsonl`。** repo 已經替 `takedowns.jsonl` 定義了另一種用途：DB_SCHEMA §3.3 的 `takedowns` 表、§5.3、§5.6 與 ARCHITECTURE §9.4、§11 寫的是**授權撤回或權利人來信**的流程——題組改 `withdrawn` 並墓碑化、git 端登記並**刪除檔案**，`tools/only_add_guard.py` 只對登記過的路徑放行刪改。人工審核退回是品質問題：檔案要保留（README §2：rejected 也要保留），也不該因此取得刪改豁免。共用同一個檔案會讓「下架」順便變成「可以刪改」，也會讓 DB_SCHEMA／ARCHITECTURE 的定義和實際用法對不上。所以另開一個檔案，`takedowns.jsonl` 的定義與流程完全不動，選題程式也不讀它（授權撤回時檔案會在同一個 commit 刪掉，選題自然看不到）。

**為什麼放在 `data/` 而不是 `data/bank/`。** DB_SCHEMA §5.3 寫 only_add_guard 檢查的是 `data/bank/**` 的刪改；這份清單要能加行、刪行，放在 `data/bank/` 底下會被守門擋住。

**格式**：一行一筆 JSON，欄位剛好是 `path`、`date`、`reason`。

```jsonc
{"path":"data/bank/v1/composition/basic/ai.cp.baef56@1.json","date":"2026-10-09","reason":"人工審核退回：題目第二段只要求習慣與原因，評分規準卻要求一次具體經驗；圖中時鐘約五點，與圖說 10:05 不符"}
{"path":"data/bank/v1/composition/basic/ai.cp.4e3501@1.json","date":"2026-10-09","reason":"人工審核退回：SVG 只有三個學生，圖說與兩篇範文寫四個；護目鏡、老師手勢與圖不符"}
{"path":"data/bank/v1/translation/basic/ai.tr.784b04@1.json","date":"2026-10-09","reason":"人工審核退回：第 1 句 4 部分切分不公平，同一個時態錯誤（If we will pack）同時列在第 1、2 部分的常見錯誤，會扣兩次；第 1、3 部分幾乎不可能寫錯"}
{"path":"data/bank/v1/translation/basic/ai.tr.433349@1.json","date":"2026-10-09","reason":"人工審核退回：第 1 句第 3 部分（會到自助洗衣店）的可接受寫法只收單數加冠詞，主詞是 many students 時最自然的 go to laundromats 等複數寫法沒有收"}
```

- 這 4 筆是 2026-10-09 比對 gsat-bank 工作樹的結果：origin/main 上 verified、gsat-bank 判定退回的寫作題剛好這 4 個。13:22（UTC）時那邊是原地把 `@1` 改成 rejected；13:39 再看，`@1` 已恢復成和 main 相同，改成各新增一個內容不變、status rejected 的 `@2`（§4.1 規則表的撤下規則 (2)）。784b04 的切分問題不只影響學生自評，也會經由 guidance 的「Suggested parts」影響 AI 評分（§5.5），所以一定要下架。gsat-bank 的人工審核還在進行，實作與上線前要用 `bank-status-diff.mjs` 重新比對（§9 第 1 步）。
- gsat-bank 的 `@2` 合併進 main 以後，這 4 個 `@1` 會因撤下規則 (2) 而不發布，這 4 行就變成重複的保護。可以在那個 PR 一起刪掉，也可以留著；兩種做法發布結果相同。
- 效果：網站與 Worker 都不發布這個版本，選題時把它當成 status 是 `unpublished`。如果它是某個 uid 的最新版，又改了內容鍵，較舊的 verified 版本也一起撤下。
- 規則套用到所有題型，包括題庫練習（`bank-data.mjs` 的 `SkipReason` 加 `unpublished`：「人工審核後下架（data/unpublish.jsonl）」）。
- 格式不對或路徑不存在：網站建置與 Worker 產生器都失敗（§4.1 的 `readUnpublish`）；`test:data` 另外檢查每一行的路徑都存在（§7.1），在題庫那條 CI 更早發現。
- 上線後要下架某一題，只要加一行並 merge，網站與 Worker 都會重新部署（§5.7）。
- 撤銷下架：刪掉那一行。題目檔本身從頭到尾不動，`v1/` 照舊只增不減；要修正就出 `@{version+1}`。

### 4.3 輸出檔（`apps/web/public/data/writing/bank/`）

| 路徑 | 內容 | 誰載入、何時 | 大小 |
|---|---|---|---|
| `index.json` | `WritingBankIndex`：每個發布的題組 `{ uid, version, section_type, tier, topic }` | 列表頁（難度與題數）、作答頁（uid → 版本、難度、下一組）、結果頁（主題、版本是否最新） | 設計時 16 組 1.7 KB／gzip 0.5 KB；合併 0571750 後 159 組 16.4 KB／gzip 3.3 KB（實測，去掉 4 個下架版本，以下同）；README §7.1 的目標 180 組約 19 KB／gzip 約 4 KB（設計值） |
| `list/{translation\|composition}-{basic\|advanced\|top}.json`（固定 6 個檔，沒題組也輸出空陣列） | 列表卡片 | 列表頁切到那個難度時 | 中譯英每個難度 37–48 組約 10–11 KB／gzip 4.5–5.2 KB；作文每個難度 10 題約 3.1 KB／gzip 1.1–1.4 KB（實測）；滿 50 組約 11 KB／gzip 約 5 KB |
| `prompts/{uid}@{v}.json` | 作答需要的內容（§4.4） | 作答頁、結果頁 | 中譯英中位數約 0.9 KB／gzip 0.5 KB；作文約 10 KB／gzip 2.6 KB（主要是 SVG） |
| `answers/{uid}@{v}.json` | 交出作答後才需要的內容（§4.4） | 按下「對照」或結果頁的收合區時 | 中譯英約 7 KB／gzip 2.1 KB；作文約 13 KB／gzip 4.7 KB |

- 每個 uid 只輸出最新版的 prompts 與 answers 檔；舊版的檔案在新版上架時消失，結果頁靠 index 判斷，不去請求它們（§2.6）。
- 路徑刻意放在 `writing/bank/`，不放 `bank/`：`tests/practice.spec.ts` 的 `**/data/bank/**` 假資料攔截不會碰到它，前端型別也不會和 `PracticeSectionType` 綁在一起。

### 4.4 欄位：作答前、交出後、不輸出

| | 中譯英 | 作文 |
|---|---|---|
| `prompts/`（作答前） | `items[]`：`no`、`label`、`item_id`（`{uid}@{v}#{label}`）、`stem`、`points`、`patterns`（`question.tags.patterns`，中文句型名稱）、`hints`（三層鷹架）；另有 `topic`、`instructions`、`group_id`、`tier`、`format_version`、`provenance` | `item_id`、`label`、`stem`、`points`、`essay_type`、`paragraphs`、`word_count`、`figures[]`（`kind`、`label`、`caption`、`description`、`rows`、`svg`：清理過的或 null）、`moves`、`scaffold`、`hints`；另有 `topic`、`instructions`、`group_id`、`tier`、`format_version`、`provenance` |
| `answers/`（交出後） | `items[]`：`label`、`references`、`target_words`、`patterns`（TranslationPattern）、`parts`（`zh`、`accepted`、`targets`、`common_errors`）、`traps`、`bonus`、`restructuring_zh`、`explanation_zh`、`evidence`、`strategy_zh` | `criteria`（四項的 `focus_zh`、`bands`）、`deductions_zh`、`model_texts`（兩篇的 `label`、`text`、`paragraphs`、`notes`、`self_assessment`）、`explanation`（`explanation_zh`、`evidence`、`strategy_zh`） |
| 不輸出 | `question.answer`、`accepted_answers`、`answer_segments`、`scoring_notes`、`stats`、`generation`、`verification`（盲譯者另外寫的英文譯文沒有做過 D8 比對）、`metrics`、`status`、`status_reason`、`pool`、`curriculum`、`question.tags.topic` | 同左，另加 `prompt_type`、`word_requirement_raw`、`figure.question_no` |

- 參考譯文在 answers 檔裡的鍵名是 `references`，不是 `answer`／`accepted_answers`。這樣「寫作檔不能有 answer 鍵」的檢查（§6 第 4 道）可以繼續用在所有寫作檔。
- `focus_zh` 會點名本題的標的詞彙，所以放在交出後。
- `moves` 只是把題目要求分段重述，放在作答前。

### 4.5 型別（`apps/web/src/features/writing/bank/data.ts`）

```ts
import type {
  CompositionCriterion, CompositionMove, CompositionScaffold, ModelText, ModelTextCriterion, Tier,
  TranslationBonus, TranslationPattern, TranslationRubricPart, TranslationTargetWord, TranslationTrap,
} from '@gsat/shared';
import type { EssayType, WordCount } from '../../../data/exams';

export const WRITING_BANK_SCHEMA = 'gsat-bank-writing/v1';
export type BankWritingSection = 'translation' | 'composition';

export interface WritingBankEntry { uid: string; version: number; section_type: BankWritingSection; tier: Tier; topic: string | null }
export interface WritingBankIndex { version: string; count: number; groups: WritingBankEntry[] }

export interface BankTranslationCard { uid: string; version: number; topic: string | null; stems: string[] }
export interface BankEssayCard { uid: string; version: number; topic: string | null; essay_type: EssayType | null; prompt_excerpt: string; figure_count: number }
export interface BankTranslationTierList { version: string; section_type: 'translation'; tier: Tier; count: number; groups: BankTranslationCard[] }
export interface BankEssayTierList { version: string; section_type: 'composition'; tier: Tier; count: number; groups: BankEssayCard[] }

interface BankFileBase {
  schema: typeof WRITING_BANK_SCHEMA;
  uid: string;
  version: number;
  tier: Tier;
  /** '{uid}@{version}'＝submissions.group_id＝Worker 題目庫的鍵。 */
  group_id: string;
}
interface BankPromptBase extends BankFileBase {
  part: 'prompt';
  format_version: string;
  topic: string | null;
  /** 本站的作答說明（bank-select.mjs 的 BANK_*_INSTRUCTIONS）。 */
  instructions: string;
  auto_verified: true;
  provenance: { license: 'original-ai'; derivation: 'original' };
}
export interface BankTranslationPromptFile extends BankPromptBase {
  section_type: 'translation';
  items: { no: number; label: string; item_id: string; stem: string; points: number; patterns: string[]; hints: string[] }[];
}
export interface BankFigure { kind: string; label: string | null; caption: string | null; description: string; rows: string[][] | null; svg: string | null }
export interface BankEssayPromptFile extends BankPromptBase {
  section_type: 'composition';
  item_id: string; label: string; stem: string; points: number;
  essay_type: EssayType | null; paragraphs: number | null; word_count: WordCount | null;
  figures: BankFigure[]; moves: CompositionMove[]; scaffold: CompositionScaffold | null; hints: string[];
}
export interface BankTranslationAnswersFile extends BankFileBase {
  part: 'answers'; section_type: 'translation';
  items: {
    label: string; references: string[]; target_words: TranslationTargetWord[]; patterns: TranslationPattern[];
    parts: TranslationRubricPart[]; traps: TranslationTrap[]; bonus: TranslationBonus[]; restructuring_zh: string | null;
    explanation_zh: string; evidence: string[]; strategy_zh: string | null;
  }[];
}
export interface BankEssayAnswersFile extends BankFileBase {
  part: 'answers'; section_type: 'composition';
  criteria: Record<ModelTextCriterion, CompositionCriterion>; deductions_zh: string; model_texts: ModelText[];
  explanation: { explanation_zh: string; evidence: string[]; strategy_zh: string | null } | null;
}
```

**載入函式**（`memoizeAsync` 加 `fetchDataFile`，同 `src/data/bank.ts` 的做法）：

- `loadWritingBankIndex()`
- `loadBankTierList(section, tier)`
- `loadBankPrompt(uid, version)`
- `loadBankAnswers(uid, version)`
- `bankVersionStatus(index, uid, version)` → `'current' | 'outdated' | 'removed'`（結果頁用，§2.6）

組網址之前先驗證參數：uid 必須符合 `^ai\.(tr|cp)\.[0-9a-f]{6}$`、version 是正整數、tier 在 `TIERS` 裡。路由參數因此不可能變成別的路徑。

**shared 新增**：

- `packages/shared/src/bank.ts`：`BANK_WRITING_GROUP_ID_PATTERN = /^(ai\.(tr|cp)\.[0-9a-f]{6})@([1-9]\d*)$/`、`parseBankGroupId(groupId)`（回傳 `{ uid, version, section_type } | null`）。前端的 `parseGroupId`（歷屆題）不改。
- `packages/shared/src/writing.ts`：`WRITING_UNKNOWN_GROUP_MESSAGE`。`packages/shared/src/writing-mechanics.ts`（由 `index.ts` 轉匯出）：從 api 搬來的 `checkMechanics`、`MechanicsCheck` 與 `normalizeStudentText`（原 `sanitizeStudentText`，§2.3）。這兩支都是純函式，沒有執行環境的依賴。

### 4.6 SVG 安全

**威脅。** 題庫的 SVG 是代理寫的資料，validate_bank.py 的 `svg_problems` 是黑名單。已確認以下寫法都能通過它：

- `<g/onclick=…>`
- `<animate attributeName="href" to="&#106;avascript:…">`
- `<set attributeName="onmouseover">`
- 沒加引號的外部 `href`

**清理（`packages/shared/scripts/svg-sanitize.mjs`，零依賴）。** `sanitizeSvg(svg)` 回傳 `{ svg: string } | { svg: null, problem: string }`。做法是自己寫一個小 tokenizer 把字串解析成「開始標籤、結束標籤、文字」，全部通過白名單後**用解析結果重新組字串**：屬性值與文字重新跳脫，原字串不會原樣流出去。

**數字文法**（所有數值屬性共用）：

```
NUMBER = -?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?        例：10、-3、100.9、102.267、.5、1e-3
LIST   = NUMBER ((\s*,\s*|\s+) NUMBER)*              前後可有空白
```

現有的圖大量用到小數（`r="4.4"`、`stroke-width="2.55"`、`x="100.9"` 等），只收整數的實作會讓圖整張消失。

| 項目 | 規則 |
|---|---|
| 元素 | `svg`（只能是根、只能一個）、`g`、`rect`、`circle`、`ellipse`、`line`、`polyline`、`polygon`、`path`、`text`、`tspan`。現有 54 張圖（本 repo 12 張、gsat-bank 42 張，各種 status）只用到其中 9 種：svg、rect、circle、ellipse、line、polyline、polygon、path、text。上線時會發布的 7 張只用到 svg、rect、circle、line、path、text（實測） |
| 屬性與值 | `xmlns`（必須等於 `http://www.w3.org/2000/svg`）；`viewBox`（LIST，剛好 4 個 NUMBER）；`role`（只能是 `img`）；`aria-label`（純文字）；`x`、`y`、`width`、`height`、`cx`、`cy`、`r`、`rx`、`ry`、`x1`、`y1`、`x2`、`y2`、`stroke-width`（NUMBER）；`font-size`（NUMBER，可接 `px`）；`opacity`、`fill-opacity`、`stroke-opacity`（NUMBER，0–1）；`fill`、`stroke`（`#` 加 3、4、6 或 8 位十六進位、`none`，或一小份 CSS 色名白名單）；`stroke-linecap`（butt／round／square）、`stroke-linejoin`（miter／round／bevel）、`text-anchor`（start／middle／end）、`font-weight`（normal／bold／100–900）；`stroke-dasharray`、`points`（LIST）；`d`（只能由路徑指令字母 `MmLlHhVvCcSsQqTtAaZz`、NUMBER、逗號與空白組成） |
| 一律拒絕 | 白名單以外的元素或屬性（包括 `on*`、`href`、`xlink:*`、`style`、`class`、`id`、`transform`、`<script>`、`<style>`、`<foreignObject>`、`<image>`、`<use>`、`<a>`、`<animate>`、`<set>`）；註解、CDATA、`<!DOCTYPE`、`<?…?>`；`&` 後面不是 `&amp;`、`&lt;`、`&gt;`、`&quot;`、`&#39;`（數字實體一律拒絕）；沒加引號的屬性值；大小寫不同的元素名；超過 30,000 字元（README §3.6） |
| 結果 | 任何一項不符，整張 SVG 就不發布（`svg: null`，保留 caption、description、rows），並印出警告，寫明 uid、第幾張圖與原因。清理是冪等的：`sanitizeSvg(輸出).svg === 輸出` |

修訂設計時用 Python 照這張表寫了一份原型，跑過兩個工作樹全部 54 張 SVG：0 張被拒（實測）。實作時 `svg-sanitize.test.ts` 與 `bank-writing.data.test.ts` 要重現這個結果（§7.1）。

**顯示（`features/writing/bank/components/BankFigure.tsx`）。**

- 圖片：`<img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)} alt="" loading="lazy" decoding="async">`。以 `<img>` 載入的 SVG 不會執行腳本、不會載入外部資源，就算清理出錯也只會顯示壞圖。
- 文字：`<figcaption>` 永遠顯示 caption（一次）與 description；有 `rows` 時另外畫成表格（第一列是表頭，`<th scope="col">`）。替代文字的理由見 §3.4。
- 沒有 SVG 時，只顯示文字描述與表格。

**不准直接插入 HTML。** 新增 `apps/web/scripts/source-scan.test.ts`（檔頭 `// @vitest-environment node`，和 scripts 底下其他測試相同；放在 `scripts/` 是因為 `tsconfig.node.json` 有 node 型別，`src/` 的設定沒有，在 `src/` 裡用 `node:fs` 會讓 typecheck 失敗）。它讀取 `apps/web/src/**/*.{ts,tsx}`，檢查以下樣式都沒有出現：

- `dangerouslySetInnerHTML`
- `/\.(inner|outer)HTML\s*=/`
- `/insertAdjacentHTML\s*\(/`
- `/new\s+DOMParser\b/`
- `/createContextualFragment\s*\(/`

測試檔本身不在 `src/`，不會掃到自己。`features/exams/richText.ts` 與 `data/exams.ts` 的註解裡有「innerHTML」這個字，但不符合上面這些寫程式的樣式，不會誤報（實測）。

**CSP。** `vercel.json` 現在沒有 CSP。之後加上時，`img-src` 要包含 `data:`，寫在 `vercel.json` 旁的說明裡。

### 4.7 建置與資料契約的變更

1. **新模組 `apps/web/scripts/lib/writing-bank.mjs`**：`buildWritingBank({ bankDir, exams, unpublishFile, repoRoot, relative })` 呼叫 `selectWritingGroups`，再依 §4.4 的白名單投影，回傳 `{ index, lists, prompts, answers, inputs, skipped, warnings }`。另外匯出路徑小工具 `writingBankPromptPath(g)`、`writingBankAnswersPath(g)`、`writingBankListPath(section, tier)`，以及 `assertWritingBankOutputs(files, corpus)`（§6 第 4 道）。

   清理過的 SVG 寫進 prompts 檔。list 卡片的 `prompt_excerpt` 是去掉「提示：」後的前 60 個字，加上「…」。
2. **`build-data.mjs` 的修改**：
   - `main()` 呼叫 `buildWritingBank`，輸出 §4.3 的檔案；
   - `contentVersion` 加入 `WRITING_BANK_SCRIPT`、`bank-select.mjs`、`svg-sanitize.mjs`、`data/unpublish.jsonl` 與選中的題組檔；
   - `meta.json` 的 counts 加 `writing_bank_groups`，檔案大小表加 index 與 6 個 list 檔；
   - 新增 `logWritingBank()`，格式同 `logBank`；
   - 刪掉自己的 `englishWords`、`wordRuns`，改從 shared 匯入；
   - 在 `assertNoOfficialTranslations` 之後執行 `assertWritingBankOutputs`。
3. **`bank-data.mjs`**：改用 `selectBankGroups`；`SkipReason` 與 `SKIP_REASON_LABELS` 加 `unpublished`：「人工審核後下架（data/unpublish.jsonl）」。
4. **`scripts/lib/data-contract.mjs` 的 `writing` 部分**：加上 `writing/bank/index.json`、6 個 list 檔、每個 `prompts/*` 與 `answers/*`。型別從 `features/writing/bank/data.ts` 匯入；沒有檔案時不匯入，避免 `noUnusedLocals` 報錯（同 bank 的做法）。`check:data` 因此會用 tsc 檢查每一個新檔。
5. **`vercel.json` 的 `ignoreCommand`** 加 `data/unpublish.jsonl`；`data/bank/v1` 與 `packages` 原本就有。
6. **`data/bank/README.md`**：
   - §2「只增不減」補一條：已經 merge 的題目被人工審核退回時，不要原地改 `status`。題庫這邊新增內容不變、status rejected 的 `@{version+1}`（寫作題選題會因此撤下舊版）；要在那個版本合併前就讓網站與 Worker 生效，在 `data/unpublish.jsonl` 加一行（檔案保留，只是不發布）。`takedowns.jsonl` 只用於授權撤回。gsat-bank 同時也在改這份 README，實作時以合併當下的版本為準、只加這兩段；
   - §3.7 補一段：網站與 Worker 發布寫作題時另有 7 字的官方譯文比對（比 validate_bank 的 8 字嚴），由 `npm run test:data` 把關；送進 Worker 的字串不能含 `<`、`>`；
   - 新增一節「發布到網站與 Worker（中譯英、作文）」，內容是 §4.1–4.4 與 §5 的摘要。

## 5. API

### 5.1 題目庫產生器（`apps/api/scripts/build-writing-prompts.mjs`）

- **輸入**：原本的 `data/exams/parsed`，加上 `data/bank/v1` 與 `data/unpublish.jsonl`。新增常數 `BANK_DIR`、`UNPUBLISH_FILE`。
- **`buildBank(exams, bankRaws = [])`**：第二個參數是 `selectWritingGroups(...).chosen` 的 raw。既有的測試只傳一個參數，照樣能用。
- **`extractBankGroup(raw)`**：用白名單產生 §5.2 的形狀。`figures` 只留 `kind`、`label`、`caption`、`description`、`rows`，**沒有 svg**。`items` 的 `item_id` 是 `{uid}@{v}#{label}`。`ai_gradable` 用同一條規則（2 句、每句 4 分）。
- **`restrictedFragments`** 改成從 `bank-select.mjs` 匯入並轉匯出（內容不變）。它仍然只跑考卷，**絕不跑題庫檔**：題庫檔的 `answer`／`accepted_answers` 是本站譯文，跑了會被當成外洩。
- **最後檢查（§6 第 4' 道）**：
  - 既有的 `findLeaks` 照舊比對整份輸出（官方答案整句與 30 字元片段），抓的是跨欄位或程式拼出來的意外；
  - 本站題的每個字串（含 guidance）再跑一次 `d8HitsInStrings`。選題已經用同一支函式把命中的題組略過，所以這一步只會因程式錯誤失敗（fail closed：exit 1）。
- **`BANK_FORMAT`** 改成 `gsat-writing-prompts/v2`：形狀變了，版本跟著變。
- 選題的略過與警告照現在的方式印 `[writing-prompts] …`。資料問題不會讓產生器失敗；會失敗的只有 `unpublish.jsonl` 格式錯或路徑不存在，以及最後檢查命中（程式錯誤）。

### 5.2 `WritingGroup`（`apps/api/src/ai/bank.ts`）

```ts
export interface WritingGroup {
  group_id: string; uid: string; version: number;
  origin: 'exam' | 'bank';                       // 新增
  exam_id: string | null;                        // 本站題是 null（只有型別用到）
  exam_title: string | null; source_group: string;
  kind: 'translation' | 'essay'; section_type: 'translation' | 'composition';
  tier: 'basic' | 'advanced' | 'top' | null;     // 新增；歷屆題 null
  ai_gradable: boolean; instructions: string; context: string | null;
  figures: WritingFigure[]; items: WritingItem[];
  essay: { essay_type: string | null; paragraphs: number | null; min_words: number | null; max_words: number | null; approx_words: number | null } | null;
  /** 新增：D1 最小列要寫的來源與授權（§5.4）。 */
  item_group: { origin: 'ceec' | 'agent' | 'batch' | 'human'; license: 'CEEC-exam' | 'original-ai'; derivation: 'verbatim' | 'original'; format_version: string };
  /** 新增：本站題給評分者的參考（§5.5）；歷屆題 null。 */
  guidance: TranslationGuidance | EssayGuidance | null;
  content_hash: string;
}
export interface TranslationGuidance { kind: 'translation'; sentences: { label: string; references: string[]; parts: { zh: string; accepted: string[] }[] }[] }
export interface EssayGuidance { kind: 'essay'; moves: { paragraph: 1 | 2; zh: string }[]; focus: Record<'content' | 'organization' | 'grammar' | 'vocabulary', string> }
```

本站題的值：

- `exam_title`、`context` 是 null；`source_group` 是題組的 `group.id`（`g1`）；
- `instructions` 是 `BANK_TRANSLATION_INSTRUCTIONS` 或 `BANK_ESSAY_INSTRUCTIONS`；
- `item_group.origin` 取 `generation.channel`（`agent`／`batch`／`human`），沒有就用 `agent`；
- `format_version` 取檔案裡的值（`translation-2`、`composition-1`）。

歷屆題的 `item_group` 固定是 `{ origin: 'ceec', license: 'CEEC-exam', derivation: 'verbatim', format_version: 'translation-{n}' | 'composition-1' }`，和現在寫死在 SQL 的值相同。

**`content_hash`。** 現在的 `buildBank` 是 `groups[g.group_id] = { ...g, content_hash: sha256(g) }`（第 237 行），雜湊的是整個題組物件。如果先加上 `origin`、`tier`、`item_group`、`guidance` 再算，每個歷屆題組的 `content_hash`（也寫進 D1 的 `face_hash`）都會變。所以：

- 歷屆題：先用 `extractGroups` 回傳的物件（也就是現有的欄位集合）算 `sha256(g)`，再補上新欄位。雜湊與現在逐位元相同；
- 本站題：對整個條目（含 guidance）算雜湊。

`ai.routes.test.ts` 加一個釘住值的測試：`gsat-115.s7g1@1` 的 `content_hash` 等於改動前產生器算出的值（目前開頭是 `9e5682483923f301`，實測；測試裡寫完整的 64 位）。

### 5.3 題組與小題 id

| | 歷屆題（不變） | 本站題 |
|---|---|---|
| group id（`submissions.group_id`＝`item_groups.id`） | `gsat-115.s7g1@1` | `ai.tr.1b2c4e@1`、`ai.cp.1f94f0@1`（就是 `{uid}@{version}`，DB_SCHEMA §3.3 的 AI 題 uid） |
| 小題 id | `gsat-115.s7g1@1#中譯英1` | `ai.tr.1b2c4e@1#1`、`#2`；作文 `ai.cp.1f94f0@1#1` |
| `resolveItemId` | 接受完整 id、label 或題號 | 同左（label 與題號都是 `'1'`、`'2'`） |
| 前端作答頁網址 | `/writing/translation/gsat-115` | `/writing/translation/ai/1b2c4e` |

### 5.4 D1 的 `item_groups` 最小列

`ensureItemGroupStatement` 改成從 `group.item_group` 與 `group.tier` 取值：

```sql
INSERT OR IGNORE INTO item_groups
  (id, uid, version, section_type, origin, pool, source_key, format_version, figures_json, extra_json,
   pick_order, license, derivation, share_alike, commercial_ok, status, content_hash, face_hash, answer_hash, tier)
VALUES (?1, ?2, ?3, ?4, ?5, 'practice', ?6, ?7, '[]', ?8, 0, ?9, ?10, 0, 1, 'draft', ?11, ?11, 'none', ?12)
```

- 本站題寫入 `origin 'agent'`、`license 'original-ai'`、`derivation 'original'`、`tier 'basic'`、`format_version 'translation-2'`、`source_key 'g1'`、`status 'draft'`。
- 這些值對應 0001 的約束：
  - `origin`、`derivation`、`tier`、`status` 的 CHECK 都在允許值內；
  - `license` 參照 `licenses(code)`，`original-ai` 已有種子資料（0001_init.sql 第 51 行）；
  - `share_alike 0`、`commercial_ok 1` 和 `original-ai` 的授權資料一致；
  - `UNIQUE(uid, version)` 不會衝突，因為 id 就是 uid@version。
- `gen_run_id` 維持 NULL：題庫檔的 `run_id` 不是 `gen_runs` 的資料列，填了會違反外鍵。
- 歷屆題寫入的值和現在完全相同：`tier` 是 NULL（和沒寫這一欄一樣），`content_hash`／`face_hash` 因為 §5.2 的雜湊規則而不變。`submissions.test.ts` 第 37–38 行不用改。
- `status 'draft'` 的列不會出現在 `v_groups_student`（只顯示 published），所以不會被抽題或審核清單撿到。
- 0002 已記錄「Worker 補 draft 最小列」的決定，本站題沿用。之後正式匯入題庫時，要「更新 draft 列的內容再推進狀態」，不能 INSERT，同 CEEC 列的註記。**不需要遷移。**

### 5.5 給評分者的本站參考（guidance）

**決定：給，但只放在 user 訊息裡，而且只給能讓評分更一致的部分。**

| 給 | 不給 | 理由 |
|---|---|---|
| 中譯英：每句的本站參考譯文（全部 2–3 種）、4 部分的 `zh` 與 `accepted` | 誤譯陷阱、常見錯誤、加分寫法、標的詞彙與句型、解析 | 4 部分的切法讓兩位評分者對「哪一段算一部分」一致，正好對應 `translationOutputProblem` 要求的剛好 4 部分，可以減少評分者之間的差距。常見錯誤與陷阱會引導模型「找到」不存在的錯誤。切法本身有問題的題組（例如 784b04）會讓 AI 和自評都多扣分，所以靠人工審核與下架清單擋下（§4.2） |
| 作文：`moves`（每段要寫什麼）、四項的 `focus_zh` | 分數帶描述（和系統提示的評分基準重複、分組方式不同）、範文（評分者會被範文定錨、參考改寫可能照抄範文、每篇多 700–900 tokens）、`deductions_zh`（扣分由程式處理） | 讓評分者知道本題的內容要求，判斷切題與段落安排 |

**格式。** 系統提示與 `SYSTEM_PREAMBLE` 不改，可快取前綴的位元組完全相同（理由見 §12 第 3 項）。本站題的 user 訊息在 `<task>` 之後、學生作答之前，多一個區塊：

```
<task>
Source: a practice item written by this website in the style of the GSAT. It is not an official exam question.
Section instructions: 請把下面兩句中文翻成正確、通順的英文。兩句是同一個主題，每句 4 分。
</task>

<website_reference>
The website wrote this reference material for this practice item. Use it as guidance only.
- Sample translations show acceptable ways to translate each sentence. They are not an answer key: any other correct and natural translation earns full credit, and differences from the samples are never errors by themselves.
- Suggested parts are the website's division of each Chinese sentence into the 4 scored meaning units. Use this division when it fits the student's translation; if it does not fit, divide the sentence yourself as the scoring rules describe.
- Accepted examples under each part are a few acceptable wordings, not a complete list.
<sentence_reference index="0">
Sample translations:
- …
Suggested parts:
1. 開學第一週 | accepted examples: … ; …
2. …
</sentence_reference>
<sentence_reference index="1">…</sentence_reference>
</website_reference>

<sentence index="0"> …（和現在相同）
```

作文的區塊：

```
<website_reference>
The website wrote these notes on what this practice prompt asks for. Use them to judge task completion and paragraph organization. They do not change the 0-5 descriptions or the rules in the system instructions. An essay that answers the prompt well in another reasonable way can still earn high scores, and words or structures named in the notes are only examples: do not lower a score because the student chose different ones.
Content steps the prompt asks for:
- Paragraph 1: …
- Paragraph 2: …
What to look for in this prompt (written in Chinese):
- content: …
- organization: …
- grammar: …
- vocabulary: …
</website_reference>
```

**題庫文字進入提示的兩道保護。** 題庫的題目、圖的文字描述與 guidance 都是代理寫的，要當成可能弄壞結構的資料處理：

1. **選題時 fail closed**：`writingShapeProblems` 對送進 Worker 的每個字串（§4.1 的 `WORKER_STRING_PATHS`）檢查 `<` 與 `>`，有就整組略過（`bad_shape`），網站與 Worker 都不發布。現有資料在兩個工作樹都沒有這種字串（實測 0 筆），所以不會少題。
2. **中和所有結構標籤**：`filter.ts` 的 `neutralizeTags` 從只處理 `student_text`，改成處理範本用到的每一個標籤：

   ```ts
   const STRUCTURAL_TAGS = ['task', 'source_zh', 'sentence', 'sentence_reference', 'website_reference', 'student_text', 'essay_stats'];
   const TAG_RE = new RegExp(`<(\\/?)\\s*(${STRUCTURAL_TAGS.join('|')})\\b`, 'gi');
   export function neutralizeTags(text: string): string {
     return text.replace(TAG_RE, '[$1$2');
   }
   ```

   - 學生文字照舊在 `studentTextBlock` 裡中和；`<student_text` 的輸出和現在逐字相同（`ai.rules.test.ts` 第 252 行的斷言不用改）；
   - `taskBlock` 的每一行、`<source_zh>` 的題目、`<website_reference>` 的每個字串，也都先經過 `neutralizeTags`。歷屆題的文字裡沒有這些標籤，中和不會改變任何字元，所以歷屆題的 user 訊息逐位元不變（有快照測試，§7.4）；
   - `detectInjection` 的 `tag_breakout` 樣式改成同一份標籤清單（只設旗標、照常批改）。改了樣式，依 `filter.ts` 的規則把 `FILTER_VERSION` 遞增成 `f2`。

**版本與快取。**

- `translationUserContent(group, sentences)`、`essayUserContent(group, paragraphs, wordCount)` 的參數不變，內部看 `group.guidance` 分支。
- `requests.ts` 改呼叫 `translationTemplateVersion(group)`：歷屆題是 `translation-user@1`，本站題是 `translation-user-guided@1`；作文同理。
- 結果：本站題的 `prompt_version` 和歷屆題分開，校準資料不會混在一起；歷屆題的請求、`prompt_version` 與快取前綴都不變。

**大小上限（產生器檢查）。**

| | 實測（上線時會發布的題組） | 上限 |
|---|---|---|
| 中譯英 guidance | 中位數 2.2 KB、最大 2.6 KB（129 組；`ai.tr.aa5b80@1` 縮減後仍超過上限，不附參考） | 2,600 bytes |
| 作文 guidance | 中位數 1.1 KB、最大 1.3 KB（30 題） | 1,600 bytes |

- 超過上限時依序縮減：每部分的 `accepted` 只留前 4 個 → 參考譯文只留前 3 個。
- 還是超過，就把 guidance 設成 null 並印警告。這一題照樣可以批改，只是沒有參考。

**輸入 token 的預估（`tasks.ts` 的 `inputTokensEstimate`）。** 實測：中譯英系統提示 4,623 字元（analytic）／4,762 字元（holistic），幾乎全是英文；最大的真實 guidance 加上題目與兩句一般長度的作答，user 訊息約 3,050 字元。用「英文字元 ÷ 3，非英文字元 × 1.3」的保守算法，holistic 的系統提示約 1.6k tokens，最大 guidance 配上兩句各 500 字元（上限）的作答約 1.4k，合計約 3.0k，已經碰到現在的 3,000；guidance 長到上限 2,600 bytes 時會超過。所以：

- 中譯英的 `inputTokensEstimate` 從 3,000 提高到 **3,500**；`ai.rules.test.ts` 第 241 行 `translation_grade` 的預扣金額跟著重算（歷屆題的預扣也會略增，這是預扣上限，結算照實際用量）；
- 作文維持 6,000：系統提示 5,811 字元（約 1.9k），guidance 上限 1,600 bytes、題目與圖的描述、作文 4,000 字元上限合計仍在 4.5k 左右；
- 新增測試（§7.4）：用上面的算法估「holistic 系統提示＋最大 guidance（真實資料中最大的一組，和一份長到上限的人造 guidance）＋兩句 500 字元作答」，必須 ≤ `inputTokensEstimate`；作文同理。之後若改用 `count_tokens` 錄下的固定值，就換掉這個算法。

**OCR** 的提示只用 `stem` 與段數，本站題直接適用，不改。

### 5.6 錯誤與改版

- **建立提交時找不到題組**：仍回 400 `bad_request`「沒有這個題組」。字串改成 `@gsat/shared` 的 `WRITING_UNKNOWN_GROUP_MESSAGE`，Worker 與前端共用，前端據此顯示 §2.7 的說明。回應的內容一個字都不變，不算改 API 契約。
- **改版**：
  - 新版通過後，Worker 只留新版，同「每個 uid 只發布最新版」的規則；
  - 舊版的 draft、failed 提交，PUT 或重新批改會回 409；
  - 佇列裡正在處理的工作，consumer 找不到題組時照現有邏輯退點（reason `internal`）；
  - 已批改的舊版提交，結果頁照常顯示，並說明題目已更新（§2.6）；
  - 這些情況都在 §2.7 有對應的畫面說明。
- **不做「舊版只留給批改用」**：那會讓 Worker 收著學生在網站上看不到的版本，違反「只用最新的 verified」。

### 5.7 部署路徑

`.github/workflows/worker-deploy.yml` 的 `on.push.paths` 加三行：

```yaml
      - 'data/bank/v1/translation/**'
      - 'data/bank/v1/composition/**'
      - 'data/unpublish.jsonl'
```

- `packages/shared/**`（`bank-select.mjs`、`writing.ts`）與 `data/exams/parsed/**`（D8 比對資料）原本就在清單裡。
- `ci.yml` 沒有路徑篩選，app job 的 `pretypecheck`／`pretest` 會跑產生器，所以每個 PR 都會驗證題庫能不能產生題目庫。
- Vercel 那邊見 §4.7 第 5 點。

## 6. D8 防線

| # | 防線 | 在哪裡 | 檢查什麼 | 不通過時 |
|---|---|---|---|---|
| 1 | 題庫驗證 | `tools/validate_bank.py`（CI 的 exams job） | 參考譯文、可接受寫法、加分寫法和官方譯文有 8 字以上相同字串；範文和官方英文有 8 字以上相同字串；評分規準的中文和官方評分原則有連續 8 個漢字相同 | 不能成為 verified |
| 2 | 選題比對（網站與 Worker 共用） | `bank-select.mjs` 的 `bankD8Hits` → `d8HitsInStrings` | group 與 annotations 的所有字串（不含 generation、verification、metrics；`figures[].svg` 比對清理後要發布的字串，和第 4 道掃到的相同，清理不通過的 SVG 不發布就不比對），四種情形：(a) 含有 20 字元以上的官方譯文整句；(b) 和官方譯文有連續 7 個英文字相同，比第 1 道的 8 字嚴；(c) 和官方 `scoring_notes` 有連續 8 個漢字相同，不跨標點，排除也出現在公開試題文字（題幹、說明、選文）裡的片段；(d) 含有產生器 `findLeaks` 的任何一個片段（官方答案整句 ≥12 字元、答案與評分原則 ≥30 字元的片段，片段可以含逗號；同樣排除公開試題文字）。比對時兩邊都先 JSON 跳脫，和最後檢查一致 | 這一組不發布、不進 Worker。建置紀錄只印 uid、欄位路徑、種類與長度，不印官方文字 |
| 3 | 輸出白名單 | `writing-bank.mjs`、`build-writing-prompts.mjs` | 只輸出 §4.4 與 §5.2 列出的欄位；`verification`（盲譯者另外寫的譯文沒有比對過）一律不輸出 | — |
| 4 | 網站輸出前的最後檢查 | `build-data.mjs`：`assertNoOfficialTranslations`（既有，自動涵蓋 `writing/bank/**`）加上新的 `assertWritingBankOutputs` | 既有：整句比對與 7 字比對。新增：`writing/bank/**` 每個檔案的所有字串跑 `d8HitsInStrings`（和第 2 道同一支函式，所以 (a)–(d) 都涵蓋）；所有寫作檔都不能有 `answer`、`accepted_answers`、`answer_segments`、`answer_variants`、`scoring_notes`、`generation`、`verification`、`metrics`、`status_reason` 鍵；`prompts/`、`list/`、`index.json` 不能有 `references`、`parts`、`model_texts`、`criteria` 鍵（防止答案提前外流）；每個 svg 都必須已經是清理後的格式（再清理一次結果相同） | 建置失敗 |
| 4' | Worker 輸出前檢查 | `build-writing-prompts.mjs` | 既有的 `findLeaks`（整句與 30 字元片段）跑整份輸出；本站題的每個字串（含 guidance）跑 `d8HitsInStrings`；`data/exams/parsed` 任何一份不是合法的 JSON（比對資料不完整，第 2、4' 道會一起變鬆）也失敗，同網站 `build-data.mjs` 的 `readJson` | exit 1，不部署 |
| 5 | 畫面 | e2e（§7.5） | 本站題頁面的文字不含 gsat-115 的官方譯文，也不含「題目來源：大學入學考試中心」 | 測試失敗 |

補充說明：

- **為什麼第 2 道和第 4、4' 道一定一致**：第 4、4' 道檢查的字串都是題組字串的子集合或前綴（投影只挑欄位、截短卡片摘要、縮減 guidance），而且用同一支 `d8HitsInStrings`、同一份 `officialCorpus`。選題通過的題組不會在最後檢查命中；最後檢查命中，代表投影或拼字串的程式出錯（例如截斷剛好拼出一個新的英文字），那時讓建置失敗才是對的。修訂前的設計只在第 2 道做 (a)–(c)，而 Worker 的 `findLeaks` 片段可以含逗號、短的漢字串與 12–19 字元的官方短句，可能出現「選題通過、產生器卻失敗、Worker 不部署、網站照常部署」的不一致，這正是第 2 道要避免的情況。
- **範文**：repo 裡沒有大考中心的官方範文或佳作（D8 規定不收），所以不可能從 repo 外流。剩下的風險是出題模型憑記憶寫出已出版的佳作，這一點程式比對不到，靠人工審核（標示「人工審核中」）。
- **兩道防線的門檻不同（7 字與 8 字）**：第 2 道（7 字）比第 1 道（8 字，`tools/validate_bank.py` 的 `OFFICIAL_NGRAM`）嚴，所以題庫流程判 verified 的題目仍可能在發布時被略過。略過本身只會少一題；但 `npm run test:data`（§7.1）把 `d8_overlap` 當成失敗，所以這種題目會讓 main 的 exams job 失敗。這是刻意的：**`test:data` 就是 7 字的關卡**，題庫工作線在合併前跑一次 `npm run test:data` 就會知道。這件事寫進 `data/bank/README.md` §3.7；是否把 validate_bank 也降到 7 字（至少發 warning），由題庫工作線決定（§11 第 3 點）。修訂時用兩種門檻模擬過 origin/main 與 gsat-bank 全部 verified 的寫作題：0 筆命中。
- **商標**：本站題頁面不使用大考中心的標誌或名稱作為標題；只在聲明裡寫「不是大考中心的試題」「不是大考中心的正式評分」。

## 7. 測試

### 7.1 共用模組與資料（`packages/shared`）

- **`scripts/bank-select.test.ts`**（unit；shared 的 vitest `unit` 專案的 `include` 加入 `scripts/**/*.test.ts`；型別由 `tsconfig.scripts.json` 檢查）。在暫存目錄裡造題庫，涵蓋：
  - 只收 verified；多個版本取最新；
  - 較新的 draft 改了內容鍵就撤下，只改解析就不撤；
  - 較新的 rejected 內容鍵相同（題庫工作線的「最終判定」寫法）：寫作題撤下；`withdrawOnRejectedSameKey: false`（題庫練習）照舊發布；
  - 下架清單：登記的版本當成未通過；壞掉的 `unpublish.jsonl`（不是 JSON、少欄位、多欄位、重複 path）會丟錯；**path 指到不存在的檔案會丟錯**；
  - 授權不是 original-ai 時略過；
  - 無法解析的 JSON 只印警告；
  - 送進 Worker 的字串含 `<` 或 `>`（例如 stem 含 `</task>`、description 含 `</website_reference>`、references 含 `<student_text>`）→ `bad_shape`；只出現在不送 Worker 的欄位（例如 `explanation_zh`）時不略過；
  - 用假的官方資料造四種 D8 命中：整句、7 字、8 漢字、`findLeaks` 片段（一句 12–19 字元的官方短句、一段含逗號的 30 字元評分原則片段），以及「出現在公開試題文字就不算」；
  - `d8HitsInStrings` 和產生器的 `findLeaks`、build-data 的整句與 7 字比對對同一批輸入給出相同的判斷（對照測試）；
  - 警告不含官方文字。
- **`scripts/svg-sanitize.test.ts`**（unit）：
  - 允許的範例：README 的範例圖，以及 `scripts/fixtures/svg/` 下從兩個工作樹複製來的代表圖（涵蓋小數座標與半徑、`ellipse`、`polyline`、`polygon`、`stroke-dasharray`、`font-weight="bold"`），清理後內容相同（冪等）；
  - 數字文法：`100.9`、`102.267`、`-3`、`.5`、`1e-3` 通過；`1..2`、`1e`、`--3`、`10px`（`font-size` 以外）不通過；
  - 每一種繞過都要被拒絕：`<g/onclick>`、`<animate>`、`<set>`、`<a href>`、沒加引號的 href、`&#106;`、`<SCRIPT>`、`<script>`、`<style>`、`style=`、`url(`、`<foreignObject>`、`<image>`、`<use>`、`xlink:href`、註解、CDATA、DOCTYPE 實體、`javascript:`、巢狀 `<svg>`、文字裡的 `<`、超過長度上限。
- **`src/writing.test.ts`**（增補）：`checkMechanics` 與 `normalizeStudentText` 搬過來後的行為（沿用 `ai.scoring.test.ts` 第 114–117 行的案例），再加一組對照表：`'Is it？'`、`'It is true。'`、`'He said, "Yes."'`、`'He said, "Yes."”'`、`'It is true]'`、`'it is true.'`、`'  It is true.  '`、含零寬字元的句子，逐句斷言「`bankTranslationSelfScore` 的大寫／標點扣分」等於「`checkMechanics(normalizeStudentText(s))` 的結果」。
- **`src/bank-writing.data.test.ts`**（data，`npm run test:data`，在 CI 的 exams job 跑）。這個檔案會匯入 `apps/web/scripts/lib/writing-bank.mjs` 與 `apps/api/scripts/build-writing-prompts.mjs`（只有測試這樣跨套件匯入，exams job 本來就跑 `npm ci`）。shared 的 `tsconfig.json` 沒有 `allowJs`，所以兩支 `.mjs` 旁都要有 `.d.mts`：產生器本來就有，`writing-bank.mjs` 要新增 `writing-bank.d.mts`（同樣的做法）。檢查項目：
  - `data/bank/v1` 每個 verified 的寫作檔，若沒有被選中，原因必須是 `older_version`、`withdrawn` 或 `unpublished`；`bad_shape`、`license`、`d8_overlap` 一律失敗（這就是 §6 說的 7 字關卡）；
  - `data/exams/parsed` 每一份都讀得到（`readExams` 的 warnings 是空的）：考卷是 D8 比對資料，少一份上面那道關卡就悄悄變鬆；
  - `data/unpublish.jsonl` 每一行的 path 都存在，而且是寫作題或練習題的題組檔；
  - **網站與 Worker 的集合相同**：對真實資料跑一次 `selectWritingGroups`，把結果分別交給 `buildWritingBank` 與 `buildBank(exams, chosen)`，網站 `index.json` 的 `{uid}@{v}` 集合必須等於 Worker 題目庫裡 `origin === 'bank'` 的 group id 集合（兩邊的投影是分開寫的，`extractBankGroup` 與 `writing-bank.mjs`）；
  - **Worker 題目庫不含不該發布的版本**：用和選題無關的獨立判斷——直接讀每個 bank group id 對應的檔案——確認 status 是 verified、是那個 uid 最大的 verified 版本、沒有登記在 `unpublish.jsonl`、也沒有任何較新的 rejected 版本（撤下規則 (1)(2) 合起來，較新的 rejected 一定會撤下舊版）；並確認 `data/bank/v1` 裡每個 draft、rejected 與登記下架的寫作檔都不在題目庫與網站 index 裡；
  - `data/bank/v1` 每一張 SVG（所有 status）都通過 `sanitizeSvg`，而且冪等。

  資料壞掉時只會讓題庫那條 CI 失敗，不會擋住程式的 CI（同 shared 現有的 unit／data 分組原則）。
- **`src/bank.test.ts`**：`parseBankGroupId`、`BANK_WRITING_GROUP_ID_PATTERN`。

### 7.2 網站建置（`apps/web/scripts/lib/*.test.ts`）

- **`writing-bank.test.ts`**：
  - 範例題庫放在 `tests/fixtures/bank-writing/v1/`：`tools/tests/data/ai.tr.0b1c2d@1.json` 與 `ai.cp.0e1f2a@1.json` 原樣複製，只把 status 改成 verified。另開目錄，不和 `tests/fixtures/bank` 混用，題庫練習的測試因此不受影響；
  - 預期輸出（golden）放在 `tests/fixtures/bank-writing-public/writing/bank/`，更新方式：`UPDATE_WRITING_BANK_GOLDEN=1 npx vitest run scripts/lib/writing-bank.test.ts`；
  - 欄位檢查：prompts 檔沒有 `references`、`parts`、`answer` 等鍵；answers 檔有；`group_id`、`item_id` 的格式正確；
  - 6 個 list 檔都存在，沒題組時是空陣列；
  - SVG 不合格時那張圖的 svg 是 null，並印警告；
  - 登記在暫存 `unpublish.jsonl` 的版本不輸出。
- **`assertWritingBankOutputs`**（同一個檔案）：5 個失敗案例——含 `answer` 鍵、prompts 含 `references`、8 漢字命中、`findLeaks` 片段命中、未清理的 svg。
- **`bank-data.test.ts`**：既有案例不改，必須照樣通過，證明搬移選題迴圈沒有改變行為。另加一個下架（`unpublished`）的測試。
- **`source-scan.test.ts`**（新增，§4.6）：掃 `src/**` 的直接插入 HTML 寫法。另外放一個會命中的假字串給比對函式，確認樣式本身有效。

### 7.3 網站元件（Vitest＋Testing Library）

測試共用的 `testing/fixtures.ts` 的 `baseRoutes` 加上 `writing/bank/*` 的 golden 回應。

| 測試 | 檢查 |
|---|---|
| `bank/BankListPage.test.tsx` | 難度 radio 與題數；沒題組的難度顯示「出題中」；卡片連到 `/writing/translation/ai/0b1c2d`；顯示 `AI_GROUP_LABEL`；`?tier=` 會保留；草稿狀態：只有 `aiSubmittedAt` 也顯示「已完成」，只有文字顯示「草稿」 |
| `bank/BankTranslationAttemptPage.test.tsx` | 提示一次開一層；兩句都寫了才能按對照；**按下對照之前沒有請求 answers 檔**；對照後作答框唯讀、參考譯文出現、自評分數依 `bankTranslationSelfScore` 計算；重新掛載後保持已對照；`access.state !== 'ready'` 時沒有 AI 按鈕；ready 時送出的 group_id 是 `ai.tr.0b1c2d@1`、item_id 是 `#1`、`#2`；`startTask` 成功後草稿有 `aiSubmittedAt` 與 `lastSubmissionId`、`submissionId` 是 null；`startTask` 失敗時 `aiSubmittedAt` 仍是 null、`submissionId` 保留；`AlreadySubmittedError` 也記下 `aiSubmittedAt`；400「沒有這個題組」顯示對應說明 |
| `bank/BankEssayAttemptPage.test.tsx` | 圖是 `<img>`、`alt` 是空字串，src 開頭是 `data:image/svg+xml`；`figure` 裡沒有 `svg` 元素（lucide 圖示不在 figure 內）；caption 在畫面上只出現一次、description 看得到；`getByRole('figure', { name: caption … })` 找得到；鷹架依難度顯示；對照後範文依 `\n` 分成兩段、註解可以切換、標示「AI 生成範文，僅供參考」；照片模式只在 `access.ocr` 時出現；`startTask('essay-ocr')` 成功後記下 `aiSubmittedAt` |
| `bank/selfScore.test.ts` | 每部分 0、1、2 錯；漏譯；大小寫與標點各扣 0.5（呼叫 shared 的 `checkMechanics`）；最低 0 |
| `lib/helpers.test.ts`（增補） | `groupLabel`、`attemptPathOf` 處理本站題 id；歷屆 id 的結果不變 |
| `SubmissionResultPage.test.tsx`（增補） | 本站題的標題、徽章、「回到題目」連結、中文題目；graded 後的收合區會載入 answers；**index 是 @2、提交是 @1 時：不請求 `prompts/…@1` 與 `answers/…@1`，顯示「這題已更新成新版本，參考內容改看新版」與連到新版的連結，批改結果照常顯示**；index 沒有這個 uid 時顯示「這題已下架」；prompts 回 404（`not_found`）時顯示同一句「已更新」說明 |
| `pages.test.tsx` | 第 125 行「陸續加入」的斷言改成：`region` 名稱「本站仿真題」含連到 `/writing/translation/ai` 的連結，而且頁面上沒有「陸續加入」；作文頁同理；`WritingHomePage` 多出的區塊與文案。其餘斷言不改 |
| `modules.test.ts` | 不改；三個 summary 改字後必須照樣通過（說明不能含其他學習模組的標題） |
| `attempt.test.tsx` | 不改，必須照樣通過（歷屆作答頁沒有動） |

### 7.4 API（`apps/api/test`）

- **`ai.routes.test.ts`**：
  - 「只有白名單欄位」的鍵集合更新，加入 `origin`、`tier`、`item_group`、`guidance`；
  - 歷屆題的 `origin` 是 `'exam'`、`guidance` 是 null、`item_group` 和舊的寫死值相同；
  - **`gsat-115.s7g1@1` 的 `content_hash` 等於改動前的值**（§5.2）；
  - `writingGroupCount() > 100` 不變；
  - 既有的 `restrictedFragments`／`findLeaks` 測試照樣通過（函式改成從 shared 轉匯出）。
- **`ai.bank-writing.test.ts`**（新增）。
  - 產生器部分：把 `tools/tests/data` 的兩個範例複製到暫存目錄並改成 verified，跑 `selectWritingGroups` 加 `buildBank([fakeExam], chosen)`，檢查：
    - 本站題的形狀；沒有 `svg`、`answer`、`accepted_answers` 鍵；
    - guidance 的內容與大小上限、超過上限時的縮減；
    - draft、rejected 與登記在 `unpublish.jsonl` 的版本不會出現；
    - 題目或 guidance 含 `</website_reference>`、`</task>` 的題組被略過（`bad_shape`），不進題目庫；
    - guidance 含官方 7 字片段或 `findLeaks` 片段時，選題就略過；把選題的檢查關掉、直接塞進 `buildBank` 時，產生器的最後檢查會失敗（證明 4' 道仍然有效）。
  - 提示範本部分（不經產生器，直接造 `WritingGroup`）：
    - stem、figure description 與 guidance 字串含 `</website_reference>`、`</task>`、`<sentence index="9">`、`</student_text>` 時，`translationUserContent`／`essayUserContent` 的輸出裡這些標籤都被改成 `[`，`<website_reference>`、`<task>` 等結構標籤各只出現一次；
    - **歷屆題的快照**：對 `gsat-115.s7g1@1` 與 `gsat-115.s8g1@1`，`translationUserContent`／`essayUserContent` 的輸出和改動前錄下的快照逐位元相同（快照檔在改程式之前先產生並提交）。
  - 路由部分：`vi.mock('../src/generated/writing-prompts.json', …)` 換成上面產生的題目庫，然後：
    - POST /api/submissions（本站中譯英）回 201，D1 的 `item_groups` 列是 `origin 'agent'`、`license 'original-ai'`、`derivation 'original'`、`tier 'basic'`、`format_version 'translation-2'`、`status 'draft'`。`test/helpers/d1.ts` 套用真的遷移，所以 CHECK 與外鍵都實際檢查到；
    - translation-grade 的 Claude 請求：user 訊息含 `<website_reference>`，`templateVersion` 是 `translation-user-guided@1`，系統提示和歷屆題完全相同；
    - 同一個測試裡的歷屆題請求不含 `<website_reference>`，`templateVersion` 是 `translation-user@1`，`content` 和改動前的快照相同；
    - 作文同理；
    - `ai.rules.test.ts` 的「請求不含個資」掃描加一個本站題的案例；
    - 未知 id 回 400 `WRITING_UNKNOWN_GROUP_MESSAGE`。
  - **token 預估**：照 §5.5 的算法，「holistic 系統提示＋最大 guidance（真實資料最大的一組，以及一份剛好長到 2,600 bytes 的人造 guidance）＋兩句 500 字元作答」≤ `taskConfig('translation_grade').inputTokensEstimate`；作文用 1,600 bytes 的 guidance 與 4,000 字元的作文，≤ 6,000。真實資料那一份由 `selectWritingGroups` 讀 `data/bank/v1` 取得。
- **`ai.rules.test.ts`**：`translation_grade` 的預扣金額改成 `inputTokensEstimate` 3,500 算出的值（第 241 行）；`neutralizeTags` 的既有斷言不改，另加其他標籤的案例；`tag_breakout` 對 `</website_reference>` 也會命中。
- **`ai.scoring.test.ts`**：不改（`checkMechanics` 由 `scoring.ts` 轉匯出）。
- **`submissions.test.ts`**：不改，歷屆題的列不變。

### 7.5 e2e（`apps/web/tests/writing-bank.spec.ts`）

`page.route('**/data/writing/bank/**')` 回 `tests/fixtures/bank-writing-public`，不存在的檔回 404（同 practice.spec 的做法）。後端用 `tests/support/backend.ts`。

1. **未登入（features 全關）**：
   - 從 /writing 點「本站仿真中譯英」，進入列表：basic 有一張卡，advanced 顯示「出題中」；
   - 進入作答頁，開提示兩層，寫兩句；
   - 確認在按對照之前沒有請求 `answers/`（`page.on('request')`）；
   - 按對照：參考譯文出現、作答框唯讀，調整錯誤數後總分改變；
   - `page.reload()` 後仍是已對照的狀態；
   - 頁面不含 gsat-115 官方譯文（`expectNoOfficialTranslation`），也不含「題目來源：大學入學考試中心」。
2. **作文**：
   - 圖是 `img`，`alt` 是空字串，`src` 是 data URL，`figure svg` 數量是 0；
   - 寬度 320 px（`page.setViewportSize`）與 mobile 專案（375 px）下，列表、作答、放大圖、對照區都沒有水平捲動；
   - `page.emulateMedia({ colorScheme: 'dark' })` 下沒有 console error，圖框是淺色底。
3. **AI 批改（FEATURES_ON、已核准）**：
   - 送出，POST /api/submissions 的 body 有 `group_id: 'ai.tr.0b1c2d@1'`，items 的 id 是 `#1`、`#2`；接著 `translation-grade`；
   - 結果頁輪詢到 graded，顯示中文題目、`AI_GROUP_LABEL`，「回到題目再練一次」連到 `/writing/translation/ai/0b1c2d`；
   - 收合區載入 answers；
   - 回到列表，那張卡顯示「已完成」。
4. **Worker 還不認得**：POST 回 400「沒有這個題組」，畫面顯示準備中的說明。這個 400 在瀏覽器留下的 console 紀錄，照 `writing.spec.ts` 的做法用 `collectErrors(page, [/\/api\/submissions$/])` 排除；除此之外不能有任何 console error。
5. **資訊頁**：`/translation`、`/composition` 的「本站仿真題」區塊連到本站列表頁（加在 `writing-bank.spec.ts`）。合併 PR #15 後改成：題型頁頁首下面就是本站仿真題列表（難度切換、出題中、卡片），點進作答頁、返回連結回到題型頁並停在同一個難度（`writing-bank.spec.ts`）；`section-practice.spec.ts` 另外檢查手機第一個畫面看得到難度切換與第一張卡片、「跳到歷屆試題」、兩種題目的返回連結。`overview.spec.ts` 第 284–313 行不用改，但它限制了新文案：頁面上不能出現「即將開放」「規劃中」，`getByRole('link', { name: '前往中譯英練習' })` 是子字串比對，所以新連結的名稱不能含「前往中譯英練習」（§2.1 的「前往本站仿真中譯英」符合）。
6. **歷屆題的寫作 e2e（`writing.spec.ts`）不改**，必須照樣通過。

### 7.6 必須全部通過的檢查

```
npm run typecheck
npm test
npm run build
npm run test:data
npm run check:data -w @gsat/web
python3 tools/validate_bank.py --all
python3 -m unittest discover tools/tests
E2E_PORT=<port> npm run test:e2e -w @gsat/web -- --output <scratchpad>/<dir>
```

`npm test` 與 `npm run typecheck` 已包含 api 的 pretest／pretypecheck，會用真實的 `data/bank/v1` 與 `data/unpublish.jsonl` 跑一次產生器。

## 8. 檔案清單與分工

**開工前**：bankwriting 分支已經快轉到 origin/main 8028596（修訂這份設計時完成）。開工時若 origin/main 又前進了，先再快轉一次，重看 §2.1 提到的四個檔案（`TranslationPage.tsx`、`CompositionPage.tsx`、`WritingHomePage.tsx`、`modules.ts`）與 `pages.test.tsx`。

三個工作包。§4.1 的模組介面、§4.5 的型別與 §5.2 的 `WritingGroup` 是三方的約定，要改得先協調。A 先做（B、C 都依賴它的輸出與範例資料），B 與 C 可以並行。

### 8.1 A：選題、資料與網站建置

| 檔案 | 變更 |
|---|---|
| `packages/shared/scripts/bank-select.mjs`、`bank-select.d.mts`、`bank-select.test.ts` | 新增（§4.1）；`restrictedFragments` 從產生器搬來 |
| `packages/shared/scripts/svg-sanitize.mjs`、`svg-sanitize.d.mts`、`svg-sanitize.test.ts`、`fixtures/svg/*.svg` | 新增（§4.6） |
| `packages/shared/scripts/bank-status-diff.mjs` | 新增：發布前比對題庫狀態（§4.1、§9） |
| `packages/shared/tsconfig.scripts.json`、`package.json`（typecheck）、`vitest.config.ts`（unit 的 include） | 讓 scripts 的 `.mjs`、`.d.mts`、`.test.ts` 都做型別檢查與測試 |
| `packages/shared/src/bank.ts`、`bank.test.ts`、`bank-writing.data.test.ts` | `parseBankGroupId`；資料測試（§7.1） |
| `packages/shared/src/writing.ts`、`writing-mechanics.ts`、`index.ts`、`writing.test.ts` | `WRITING_UNKNOWN_GROUP_MESSAGE`；從 api 搬來的 `checkMechanics`、`normalizeStudentText`（`writing-mechanics.ts`，由 `index.ts` 轉匯出）與對照測試 |
| `data/unpublish.jsonl` | 新增四行（§4.2） |
| `data/bank/README.md` | §2、§3.7 補充；新增「發布到網站與 Worker」一節（§4.7 第 6 點） |
| `apps/web/scripts/lib/bank-data.mjs` | 改用 `selectBankGroups`，加 `unpublished` |
| `apps/web/scripts/lib/writing-bank.mjs`、`writing-bank.d.mts`、`writing-bank.test.ts` | 新增（§4.7）；`.d.mts` 給 shared 的資料測試匯入（§7.1） |
| `apps/web/scripts/build-data.mjs` | 輸出、D8 第 4 道、版本雜湊、meta、紀錄 |
| `apps/web/scripts/lib/data-contract.mjs` | 寫作題庫的契約 |
| `apps/web/scripts/source-scan.test.ts` | 新增（§4.6） |
| `apps/web/tests/fixtures/bank-writing/**`、`bank-writing-public/**` | 範例輸入與 golden |
| `vercel.json` | ignoreCommand |

### 8.2 B：Worker

| 檔案 | 變更 |
|---|---|
| `apps/api/scripts/build-writing-prompts.mjs`、`.d.mts` | §5.1；歷屆題的 `content_hash` 用原欄位集合算（§5.2） |
| `apps/api/src/ai/bank.ts` | §5.2、§5.4 |
| `apps/api/src/ai/prompts/common.ts`、`translation.ts`、`essay.ts`、`requests.ts` | §5.5（系統提示不改；`taskBlock` 與題目字串經過 `neutralizeTags`） |
| `apps/api/src/ai/filter.ts` | `neutralizeTags` 與 `tag_breakout` 改成全部結構標籤、`FILTER_VERSION` → `f2`；`sanitizeStudentText` 改成轉匯出 shared 的 `normalizeStudentText` |
| `apps/api/src/ai/scoring.ts` | `checkMechanics` 改成轉匯出 shared |
| `apps/api/src/ai/tasks.ts` | 中譯英 `inputTokensEstimate` 3,000 → 3,500 |
| `apps/api/src/submissions/routes.ts` | 未知題組的訊息改用共用常數（內容不變） |
| `apps/api/test/ai.routes.test.ts`、`ai.rules.test.ts`、新增 `ai.bank-writing.test.ts` 與歷屆題提示快照 | §7.4 |
| `.github/workflows/worker-deploy.yml` | §5.7 |

### 8.3 C：前端畫面

| 檔案 | 變更 |
|---|---|
| `apps/web/src/App.tsx` | 4 條路由（§3.1） |
| `apps/web/src/features/writing/bank/data.ts`、`labels.ts`、`selfScore.ts`、`BankListPage.tsx`、`BankTranslationAttemptPage.tsx`、`BankEssayAttemptPage.tsx`、`components/{BankFigure,BankHints,BankScaffold,TranslationReveal,EssayReveal,ModelTextView,BankSourceNote,BankAnswersPanel}.tsx` 與測試 | 新增；兩個作答頁直接呼叫 `lib/submit.ts`、`lib/writingApi.ts`（§2.5） |
| `apps/web/src/features/writing/lib/format.ts`、`lib/drafts.ts` | 本站題 id；`BankTranslationDraft`、`BankEssayDraft`（§2.5，含 `aiSubmittedAt`、`lastSubmissionId`）與型別守衛；鍵沿用 `draftKey` |
| `apps/web/src/features/writing/SubmissionResultPage.tsx`、`components/{TranslationResult,EssaySelfAssess,SubmissionHistory}.tsx` | §2.6（含版本檢查與說明）；`EssaySelfAssess` 加選用的 `criteria` prop |
| `apps/web/src/features/writing/components/SourceTabs.tsx`、`TranslationListPage.tsx`、`EssayListPage.tsx`、`WritingHomePage.tsx` | 入口與切換（§2.1） |
| `apps/web/src/features/writing/testing/fixtures.ts` | 本站題的假資料路由 |
| `apps/web/src/pages/TranslationPage.tsx`、`CompositionPage.tsx` | 「陸續加入」換成「本站仿真題」區塊（§2.1）；合併 PR #15 後改成頁首的「本站仿真題」列表＋「歷屆試題」列表（§2.1 的合併說明） |
| `apps/web/src/modules.ts` | `/translation`、`/composition`、`/writing` 三個 summary（§2.1）。新路由是子頁，不進 `PAGES` |
| `apps/web/src/features/practice/PracticeHome.tsx` | 文案與連結 |
| `apps/web/src/features/writing/pages.test.tsx` | §7.3 |
| `apps/web/tests/writing-bank.spec.ts`（新增） | §7.5（`overview.spec.ts` 不改，但新文案要符合它的限制） |

**不改**：`apps/web/src/features/writing/TranslationAttemptPage.tsx`、`EssayAttemptPage.tsx`、`lib/submit.ts`、`attempt.test.tsx`。

## 9. 上線步驟

1. **合併前：比對兩邊會發布的題組。** gsat-bank 工作樹的人工審核會推翻已經在 main 上的 verified 判定，而那邊的結果要等合併才會進 main（寫法可能是原地改 `status`，也可能是新增內容不變的 rejected `@{version+1}`）。每次準備合併或部署寫作題相關的變更前：
   - 執行 `node packages/shared/scripts/bank-status-diff.mjs --against /home/user/gsat-bank`；
   - 本 repo 會發布、那邊不會發布的 `uid@v`，照輸出的建議行加進 `data/unpublish.jsonl`，原因照那邊的 `status_reason` 摘要；
   - 同一路徑 status 不同（原地修改）只記下來，交給題庫工作線處理（§11 第 2 點）；本 repo 是 rejected、那邊改成 verified 的，本 repo 照舊不發布。
   - 2026-10-09 的比對結果：13:22（UTC）時，本 repo verified、那邊原地改成 rejected 的剛好是 §4.2 的 4 個，另有 3 個反方向的原地修改（`ai.tr.a3233b@1`、`ai.tr.fe2ddd@1`、`ai.tr.7c6750@1`，rejected → verified）；13:39 再看，原地修改全部還原，改成 4 個內容不變的 rejected `@2`，「本 repo 會發布、那邊不會」的仍是同樣 4 個。
2. **同一個 PR 合併。** 網站、Worker 與共用模組放在同一個 PR，合併到 main 後兩邊同時觸發部署：Vercel 看 `packages`、`data/bank/v1`、`data/unpublish.jsonl`；Worker 看 §5.7 的路徑。Worker 通常晚幾分鐘完成，這段時間 AI 批改會顯示「還在準備中」（§2.7）。
3. **部署後確認：**
   - `/data/writing/bank/index.json` 的組數和建置紀錄的「本站仿真寫作題：中譯英 N 組、作文 M 題」相同（合併 0571750 時是中譯英 129、作文 30），4 個下架的版本都不在裡面；
   - `/data/writing/bank/prompts/*.json` 用 `grep` 找不到 `references`；
   - Worker 部署紀錄的 `[writing-prompts] 已產生 … 個題組，其中本站仿真題 N 組` 的 N 和網站 index 的組數相同（合併 0571750 時是 121＋159＝280；以當時的資料與下架清單為準）；
   - 用核准帳號送一組本站中譯英，D1 執行 `SELECT id, origin, license, derivation, tier, status FROM item_groups WHERE id LIKE 'ai.%'`，應該是 `agent / original-ai / original / basic / draft`。
4. **D1 不需要遷移。**
5. **上線兩週後觀察：**
   - 本站題和歷屆題的第三位評分者比例、失敗率，用 `prompt_version` 區分；
   - 預扣金額和實際用量的差距，特別是中譯英提高到 3,500 之後；
   - 學生按「對照」與送 AI 的比例。

   第三位評分者比例明顯偏高時，先把 guidance 縮成只有參考譯文（改產生器、遞增範本版本）。
6. **之後的資料。**
   - gsat-bank 的新題合併後會自動上架，網站與 Worker 同步。
   - 人工審核退回已經合併的題目：題庫這邊新增內容不變的 rejected `@{version+1}`，合併後自動撤下；等不及合併的，在 `data/unpublish.jsonl` 加一行。不要原地改題目檔。每次發布前照第 1 步比對。
   - 修正版用 `@{version+1}` 上架。
7. **內容小問題（不擋上線）**：`ai.tr.37f01a`（畢業旅行）與 `ai.tr.93a19b`（墾丁海邊）都有「墾丁」「海水…一樣藍」，在列表上會排在附近。交給題庫工作線決定要不要出新版。

## 10. 風險

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | 網站先部署、Worker 晚到（或 Worker 部署失敗） | 送 AI 批改得到 400 | 友善說明，並引導自我檢核（§2.7）；Worker 部署失敗時照 worker-deploy 的通知處理；兩邊的選題規則與 D8 檢查是同一份程式，資料問題不會只讓一邊失敗 |
| R2 | 評分參考讓評分者以範例當標準答案，或兩位評分者不再那麼獨立 | 合理的不同寫法被扣分；第三位評分者比例改變 | 區塊裡寫明「不是答案、不同寫法不算錯」；不給常見錯誤與陷阱；用不同的範本版本分開觀察（§9 第 5 點）；必要時縮減 guidance |
| R3 | 題目、圖、評分規準或 4 部分切分彼此不一致（像下架的 4 個版本） | 學生照題目寫卻被規準扣分；切分不公平時，自評與 AI 都會因同一個錯誤扣兩次 | 已知的 4 個下架；人工審核退回的題目一律登記在 `unpublish.jsonl`；頁面標示「人工審核中」 |
| R4 | SVG 清理有漏洞 | 理論上可以注入內容 | 只用 `<img>` 顯示（瀏覽器不執行 SVG 裡的腳本、不載入外部資源）；白名單加重新序列化；繞過寫法都有測試；有原始碼掃描測試 |
| R5 | 320 px 寬時圖裡的中文字太小 | 看不清楚 | 文字描述一直都顯示；圖框內可放大；題目資訊不只靠圖 |
| R6 | 公開檔任何人都下載得到（answers 檔） | 學生可以先看答案 | 這是學習上的設計，不是安全問題；作答前的請求不含答案，畫面要學生先寫完才給看 |
| R7 | 7 字門檻（比題庫驗證的 8 字嚴）讓題庫流程判 verified 的題目在發布時被略過 | 少一題；main 的 exams job 因 `test:data` 失敗 | 建置紀錄印出 uid 與欄位；README §3.7 寫明 `test:data` 是 7 字關卡；請題庫工作線評估在 validate_bank 加 7 字 warning（§11 第 3 點） |
| R8 | 題庫練習的選題迴圈搬進共用模組時改壞了 | 練習題上架的結果改變 | `bank-data.test.ts` 與 golden 不改、必須照樣通過；這是行為不變的最好證據 |
| R9 | 新版上架後，舊版的提交無法重送、看不到舊版題目 | 少數學生要重寫；結果頁少了中文題目 | 結果頁說明原因並連到新版；已批改的結果不受影響 |
| R10 | Worker 題目庫變大 | 打包與啟動時間增加 | 歷屆 121 組 156 KB（實測，UTF-8）；合併 0571750 後 280 組（本站 159 組）647 KB（實測；中譯英每組約 3 KB、作文每題約 4 KB，主要是 guidance 與圖的文字描述）；gzip 後約 150 KB，仍遠低於 Cloudflare Worker 的大小限制（壓縮後 3 MB／付費 10 MB）。README §7.1 的目標（180 組、guidance 精簡、不含 svg）原估約 0.5 MB raw，現在已經超過這個估計，題組再成長一倍時要重新評估（例如 guidance 改放 D1） |
| R11 | gsat-bank 工作線同時在改 `tools/validate_bank.py` 與題庫檔 | 合併衝突 | 本設計不改 `tools/`，也不改任何 `data/bank/v1` 的檔案，只新增 `data/unpublish.jsonl` 與 README 的補充 |
| R12 | gsat-bank 的人工審核結果要等合併才進 main | 已被退回的題目在網站與 Worker 上架 | §9 第 1 步的比對工具在每次發布前跑（比的是兩邊會發布的集合，不管那邊用哪種寫法）；`@{version+1}` 的 rejected 判定合併後由撤下規則 (2) 自動生效 |
| R14 | 題庫練習還不認「內容相同的 rejected 新版」 | 選擇題若也用這種寫法記錄退回，題庫練習會繼續發布舊版 | 本設計不改題庫練習的行為（R8）；§11 第 2 點請負責題庫練習的人決定是否一起採用 |
| R13 | 中譯英預扣金額不足（guidance 讓輸入變長） | 每日費用上限的預扣略低於實際 | `inputTokensEstimate` 提高到 3,500，並有測試確保最壞情況不超過；上線兩週後用 `gradings` 的實際用量校正 |

## 11. 待決事項

以下都不影響開工，預設值已經寫進設計：

1. **`data/unpublish.jsonl` 的格式與用途（跨工作線）。** 本設計定義格式（`path`、`date`、`reason`）與用途（人工審核下架，只隱藏、不刪檔、沒有 only_add_guard 豁免）。`takedowns.jsonl`、DB_SCHEMA §3.3／§5.3、ARCHITECTURE §9.4 的授權撤回流程都不變。之後寫 `tools/only_add_guard.py` 的人要知道：`data/unpublish.jsonl` 在 `data/bank/` 之外，可以增刪行；它不是刪檔的豁免清單。如果題庫工作線需要別的欄位（例如審核人），兩邊一起改 `readUnpublish` 與 README。
2. **「內容相同的 rejected 新版」這個寫法（跨工作線）。** 2026-10-09 13:22（UTC）時，gsat-bank 把已經在 main 上的 7 個檔案原地改了 status（4 個 verified → rejected、3 個 rejected → verified），違反 README §2；13:39 再看，那邊已全部還原，改成替 4 個被退回的版本各新增內容不變、status rejected 的 `@2`。本設計的寫作題選題支援這個寫法（§4.1 撤下規則 (2)），`unpublish.jsonl` 在 `@2` 合併前擋住同樣 4 個。待確認：
   - 請題庫工作線把這個寫法寫進 `data/bank/README.md` §2（目前只存在於 `@2` 檔案的 `status_reason`），並寫明它和 `data/unpublish.jsonl` 的分工：還沒合併的判定用 `@{version+1}`，需要立刻在網站與 Worker 生效的用 `unpublish.jsonl`；
   - 題庫練習（`bank-data.mjs`）目前遇到「較新的 rejected、答案相同」會照舊發布舊版。本設計維持這個行為（R8：搬移選題迴圈不改行為），由題庫練習的負責人決定要不要也打開 `withdrawOnRejectedSameKey`。現在 main 沒有任何 `@2` 檔案，打開也不會改變今天的輸出。
3. **validate_bank 的 D8 門檻（跨工作線）。** 網站與 Worker 用 7 字、validate_bank 用 8 字。預設是 `test:data` 當 7 字關卡（§6）；建議題庫工作線在 validate_bank 對寫作題加一個 7 字的 warning，讓出題工具也看得到。改不改由那邊決定，本設計不改 `tools/`。
4. **歷屆作答頁的送出流程抽成共用模組。** 這次不做（§2.5）。另開 PR 時要附上同時對歷屆頁與本站頁跑的送出流程測試（建立、自評、啟動任務、`AlreadySubmittedError`、照片上傳與 OCR）。

## 12. 決策紀錄

第 2 版依審查意見修訂。每一項都先對照程式碼與資料確認，結果如下。

| # | 審查意見 | 嚴重度 | 處理 |
|---|---|---|---|
| 1 | 下架清單漏了 `ai.tr.784b04@1` | blocker | **接受，並擴大。** 確認 gsat-bank 把 784b04 改判 rejected（4 部分切分不公平）、main 仍是 verified。修訂時重跑比對，又多了一個：`ai.tr.433349@1` 在 13:16（UTC）被 gsat-bank 的人工審核改判 rejected（審查當時還沒改）。所以下架清單是 4 筆，上線數量是中譯英 10、作文 6，Worker 紀錄是 121＋16＝137（不是審查建議的 11／6／138）。另外新增 `bank-status-diff.mjs` 與上線前的比對步驟（§4.1、§9 第 1 步）。修訂期間（13:39）gsat-bank 又把原地修改還原、改用內容不變的 rejected `@2` 記錄判定，所以比對工具改成比「兩邊會發布的集合」，不是逐檔比 status，寫作題選題也加上撤下規則 (2)（§4.1） |
| 2 | `data/takedowns.jsonl` 已有別的定義（授權撤回、放行刪檔） | major | **接受，採選項 (a)。** 另開 `data/unpublish.jsonl`，只隱藏、不放行刪檔；DB_SCHEMA／ARCHITECTURE 不用改。放在 `data/` 而不是建議的 `data/bank/`，因為 only_add_guard 的範圍是 `data/bank/**`（DB_SCHEMA §5.3），清單本身要能增刪行（§4.2） |
| 3 | 題庫文字進入提示的注入防護不足 | major | **接受。** `writingShapeProblems` 對送進 Worker 的字串 fail closed（含 `<`／`>` 就略過，現有資料 0 筆）；`neutralizeTags` 擴大到範本用到的 7 個標籤，並套用到題目與 guidance；歷屆題快照逐位元不變的測試（§5.5、§7.4）。**不採納**「在系統提示裡說明 `<website_reference>`」：改 `SYSTEM_PREAMBLE` 會改變所有歷屆題的 `prompt_version` 與快取前綴、打斷校準資料；`<website_reference>` 是伺服器端的本站資料、不是學生可控的輸入，加上 fail closed 與中和後已經不能提早結束區塊，信任程度在區塊開頭寫明即可 |
| 4 | 設計寫在舊的基準上（落後 origin/main 一個 commit） | major | **接受。** 分支已快轉到 8028596；§2.1 改成把「陸續加入」換成「本站仿真題」區塊，`modules.ts` 三個 summary 要改（並對過 `modules.test.ts` 的標題限制），§8.3 修正。8028596 沒有動 `data/`，資料的實測數字只因下架清單改變，已重新量過 |
| 5 | 自評與 Worker 的大寫、標點規則不同 | minor | **接受，並補充。** `checkMechanics` 搬到 `@gsat/shared`，兩邊共用並有對照測試。審查沒提到的一點：Worker 是對 NFKC 淨化後的文字判斷（全形 `？` 會變成 `?`），所以 `sanitizeStudentText` 也一起搬過去（改名 `normalizeStudentText`），自評先做同樣的正規化（§2.3） |
| 6 | 選題的 D8 比對和 Worker `findLeaks` 的判斷可能不同 | minor | **接受，並補充。** `bankD8Hits` 加上 (d) `findLeaks` 片段，片段清單與公開文字排除都來自同一支 `restrictedFragments`；網站與 Worker 的最後檢查都呼叫同一支 `d8HitsInStrings`。另外發現 (a) 的 20 字元門檻和 `findLeaks` 的 12 字元整句不同，(d) 一併涵蓋（§4.1、§6） |
| 7 | 選題用 7 字、validate_bank 用 8 字 | minor | **接受，採「文件化」。** `test:data` 是 7 字關卡，寫進 README §3.7；請題庫工作線評估加 7 字 warning（§11 第 3 點）。不改 `tools/`，避免和題庫工作線衝突（R11）。修訂時用兩種門檻模擬：0 筆命中 |
| 8 | 新版上架後，舊提交的 prompts／answers 檔 404 | minor | **接受。** 結果頁先看 index 的版本，不是最新版就不請求舊檔（避免 404 與 console 錯誤），顯示「這題已更新成新版本，參考內容改看新版」與新版連結；下架與 `not_found` 也有對應說明與單元測試（§2.6、§7.3） |
| 9 | 下架路徑打錯只警告；草稿沒有記錄已送 AI | minor | **接受。** `readUnpublish` 遇到不存在的路徑就丟錯（網站建置與 Worker 產生器都失敗），`test:data` 也檢查；草稿加 `aiSubmittedAt` 與 `lastSubmissionId`，寫明在哪些時點設定（§2.5、§4.2） |
| 10 | 「歷屆題寫入的值完全相同」不成立（`content_hash` 會變） | minor | **接受，採「用原欄位集合算雜湊」。** 歷屆題的 `content_hash` 逐位元不變，並用 `gsat-115.s7g1@1` 的值釘住（§5.2、§7.4） |
| 11 | SVG 白名單沒定義數字格式；`alt` 與 figcaption 重複 | minor | **接受。** 定義數字與清單文法（含小數與指數），`d`、`points`、`viewBox` 都用它；用原型跑過兩個工作樹 54 張圖 0 張被拒。gsat-bank 的代表圖複製成單元測試的 fixture（CI 讀不到另一個工作樹），repo 內全部 SVG 由 data 測試檢查。替代文字改成 `alt=""`、caption 只在 figcaption 出現一次（§3.4、§4.6） |
| 12 | 輸入 token 預算偏緊、沒有量 | minor | **接受。** 實測系統提示與最大的 guidance，保守估算已碰到 3,000，所以中譯英提高到 3,500，`ai.rules.test.ts` 的預扣跟著改，並加最壞情況的測試（§5.5、§7.4） |
| 13 | 缺少幾個測試；`security.test.ts` 會掃到自己；scripts 的測試沒有型別檢查 | minor | **接受，(c) 換做法。** (a)(b) 加進 `bank-writing.data.test.ts`，(b) 用獨立讀檔判斷，不靠選題函式；(d) `tsconfig.scripts.json` 納入 `scripts/*.test.ts` 與 `.d.mts`。(c) 不在 `src/` 放測試再排除自己：`src/` 的 tsconfig 沒有 node 型別，用 `node:fs` 會讓 typecheck 失敗；改放 `apps/web/scripts/source-scan.test.ts`（node 環境、node 型別、本來就不在被掃的 `src/` 裡），樣式也改成只抓程式寫法，註解裡的「innerHTML」不會誤報（§4.6、§7） |
| 14 | 抽出 `lib/submitFlow.ts` 會改到能用的歷屆送出流程 | minor | **接受。** 本站頁直接呼叫 `lib/submit.ts` 與 `lib/writingApi.ts`，歷屆作答頁不改；抽共用模組另開 PR，並附兩種頁面都跑的測試（§2.5、§11 第 4 點） |
