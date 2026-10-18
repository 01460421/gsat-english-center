# 英文作文自訂題目：設計審查（產品與一致性）

> 審查對象：`docs/design/custom-essay.md`（2026-10-18 第 1 版）。
> 角度：學生用起來順不順、和現有作文頁與結果頁一致、評分品質（沒有範例參考時能否穩定評分、切題判斷）、測試是否足夠、檔案清單是否漏、遷移與部署（Worker 部署 workflow、Vercel）。資安與 D8 比對的細節由其他審查負責，這裡只在影響學生體驗或評分結果時提到。
> 對照：`docs/analysis/custom-essay/api-map.md`、`web-map.md` 與分支 `customessay`（`18e179a`）的程式碼。程式行號以這個 commit 為準；「設計 :N」是設計文件的行號。
> P4 的誤擋例子：把設計 §2.4.4 的樣式照抄成正規式，用 Node 實際跑出來的。
> 本文只提意見，沒有改設計文件與程式。

## 1. 結論

- **沒有 blocker；major 8 項、minor 16 項。**
- 大方向和現有架構一致，值得保留：
  - 沿用 `essay_grade`，點數、額度、ledger 都不用動；
  - 題目放新表，隨提交與帳號 CASCADE；
  - 歷屆題與本站題的提示逐位元不變；
  - 前端另開一頁，不在歷屆作答頁加分支；
  - 第一版不做拍照辨識題目；
  - 部署時網站先到，也只會顯示「即將開放」。
- 開工前要改的集中在三類：
  1. **評分品質**：「和歷屆題一樣」沒有上線前的驗證（P1）。另外有兩處會讓同一篇作文在自訂題拿到和歷屆題不同的結果：段數「不指定」（P2）、字數要求（P3）。
  2. **學生流程**：
     - 輸入規則把原本「只記旗標」的注入樣式放寬，再改成硬拒收，實測會擋到常見的學校題目（P4）；
     - 結果頁遇到題目錯誤時，沒有修改題目的路（P5）。
  3. **一致性與維運**：
     - 隱私權說明改了字卻不升版，違反說明本身的承諾（P6）；
     - 新增的必填型別欄位會讓既有 e2e 的型別檢查失敗，檔案清單沒列（P7）；
     - 總開關的緊急關閉步驟寫錯（P8）。

## 2. 一覽

| # | 嚴重度 | 主題 | 設計位置 |
|---|---|---|---|
| P1 | major | 「品質一樣」沒有上線前的對照驗證 | §9.1 R1、§10 第 3 步、§7 |
| P2 | major | 段數「不指定」時，AI 被要求不依題目判斷分段 | §4.2 :726、§6.3 :1071 |
| P3 | major | 字數要求和「至少約 120 字」的前提、作答頁的 120 字提醒互相矛盾 | §4.2、§4.8 :831、§6.4 :1076-1079 |
| P4 | major | 內容規則誤擋真實題目；由旗標改成硬拒收；錯誤不指出位置 | §2.4.4 :351-367、§7.1 :1263-1269 |
| P5 | major | 結果頁遇到題目或作文規則錯誤時沒有改題目的路，手寫稿會卡住 | §2.6 :474、§6.7 :1157、§6.8 :1190、R11 :1606 |
| P6 | major | 隱私權說明改字但不升版，違反說明本身「修改時會更新版本日期」 | §6.10 :1235、§9.2 第 6 點 :1616 |
| P7 | major | `custom_title`、`custom_prompt` 設成必填：既有 e2e 型別檢查失敗，舊 Worker 期間型別不實 | §2.2 :172-182、§7.6 :1479、§8 |
| P8 | major | 總開關的緊急關閉步驟會被下一次部署蓋掉，切換又要走完整部署 | §5.3 :929-936、§10 第 4 步 :1642 |
| P9 | minor | `<task>` 的 Source 行斷言「不是官方試題」；貼歷屆題時品質較差 | §4.3 :750、§9.2 第 5 點 :1615 |
| P10 | minor | 離題後的補救要學生重寫作文；`?from=` 會清掉作文 | §4.6 :817、§6.6 :1148-1153 |
| P11 | minor | 離題補充句、改寫被丟掉的說明，和「EssayResult 不改」衝突 | §4.6 :817、§4.8 :833-837、§8.5 :1583 |
| P12 | minor | 手機上題目表單很長；唯讀預覽何時出現沒有定義 | §6.2 :1013-1046、§6.8 :1183 |
| P13 | minor | 拍照模式在扣辨識點數之後才檢查 30 單詞等規則 | §6.4 :1091 |
| P14 | minor | `/composition` 既有文案「上面兩種題目」沒改；新區塊插在兩份列表中間 | §6.1 :998、§6.10 :1220-1221 |
| P15 | minor | `/writing` 入口卡的位置不存在；文案不論權限都承諾 AI 批改 | §6.1 :999、§6.10 :1222 |
| P16 | minor | 寫作紀錄的草稿列連結和其他題目不一致 | §6.9 :1214 |
| P17 | minor | `<title>` 要不要放題目開頭，三處寫法互相矛盾 | §2.2 :232、§5.7 :974、§6.8 :1178 |
| P18 | minor | 「本站的評分規準」顯示的是模擬考自評用的摘要，不是 AI 用的規準 | §4.7 :824、§6.2 :1043、§6.10 :1231-1232 |
| P19 | minor | 缺的測試案例 | §7 |
| P20 | minor | local-e2e 的自訂題步驟是「選做」；PR 預覽連的是正式 Worker | §7.6 :1481、§7.7 :1492 |
| P21 | minor | 部署 workflow 的部署後確認與站主文件沒有涵蓋 `customEssay` | §8、§10 第 2 步 :1629-1636 |
| P22 | minor | 沒寫回滾時的行為（Vercel 回滾、Worker 回滾） | §9.1 R8 :1603、§10 |
| P23 | minor | 工作包「合併」的意思要寫清楚，避免半套功能進 main | §8 :1501、§10 :1626 |
| P24 | minor | `english_too_long` 把學生用英文寫的圖片描述也算進去 | §2.4.4 :361、§6.10 :1226 |

---

## 3. 逐項意見

### P1（major）「品質一樣」沒有上線前的對照驗證

- **位置**：§9.1 R1（:1596）；§10 第 3 步（:1637-1641）；§7 的測試全部用假 Anthropic。
- **問題**：
  - 需求的核心是「批改品質和歷屆、本站仿真作文題一樣」，但自訂題和歷屆題的批改條件有三處不同：
    - 換了系統提示：資料規則改寫、多一段切題規則，analytic 由 5,811 字元變成 7,702 字元；
    - `<task>` 裡沒有 `Section instructions`，也沒有 `<website_reference>`；
    - 題目品質不受控。
  - 設計只在上線兩週後看第三位評分者比例與離題率。這有三個缺點：
    - 上線後的數字沒有對照組，分不出差異是因為學生貼的題目差，還是因為提示寫法偏了；
    - 等看到問題時，學生已經付了點數、看過可能不準的分數，而且分數會留在寫作紀錄；
    - §7 的測試只驗證請求的形狀，沒有一項驗證分數。
- **證據**：
  - 系統提示的差異：設計 §4.2（:720-744）。
  - repo 沒有任何評分對照或校準工具：`apps/api/scripts/` 只有 `build-writing-prompts.mjs` 和 `local-e2e.mjs`，後者用的是假 Anthropic。
  - 現成的對照素材：
    - `data/bank/v1/composition/**/ai.cp.*.json` 有 40 題，每題附穩健版、頂標版兩篇範文（`annotations.model_texts`），共 80 篇；
    - 題目與範文都是本站撰寫，不受 D8 限制；
    - 其中進 Worker 題目庫的 30 題，可以同時走「題庫題路徑」對照。
- **建議修改**：在 §7 加「上線前的評分對照」：用真模型跑，不進 CI。§10 第 1 步之前加一個關卡：結果達標才上線。
  1. **同題對照**：
     - 同一篇作文、同一個題目，分別走題庫題路徑與自訂題路徑；
     - 自訂題路徑的題目，是把那一題的說明、題目、圖片文字描述貼進來，段數與字數照題目設定；
     - 作文用 30 題的範文，另外把範文刪到約 60 個單詞、併成一段，做成降級版，涵蓋中低分；
     - 比較兩條路徑的總分差。
  2. **題目不完整**：同一篇作文，題目只給標題或只給一半，看 `off_topic` 會不會誤判。
  3. **錯配**：把 A 題的作文配上 B 題的題目，看 `off_topic` 判不判得出來。
  4. **先寫好通過標準**，數字由站主定。例如：
     - 同題對照的總分差，平均 ≤1 分、單篇 ≤3 分；
     - 題目不完整時，`off_topic` 誤判 0 篇；
     - 錯配時，至少 9 成判為離題。
  5. **放一支腳本** `apps/api/scripts/custom-essay-parity.mjs`：
     - 直接呼叫 `essayCallInput` 與 `buildClaudeRequest`，需要 `ANTHROPIC_API_KEY`，不進 CI；
     - 結果寫進設計文件附錄；
     - 費用：約 100 篇，每篇最多三次呼叫，以預扣上限計約 US$50 以內，實際會更低。
  6. 結果不達標時，先調 `CUSTOM_TASK_RULES` 與 `<task>` 的寫法（P2、P3、P9），再重跑。

### P2（major）段數「不指定」時，AI 被要求不依題目判斷分段

- **位置**：§4.2 `CUSTOM_DATA_RULES` 第 3 點（:726）；§4.3 `Required paragraphs`（:752）；§6.3 要求建議（:1064-1071）。
- **問題**：
  - 學生最常見的用法，是整段貼上「……文分兩段，第一段……第二段……」，但段數欄預設「不指定」。這時三方的行為是：
    - `<task>` 寫 `Required paragraphs: not specified`；
    - `CUSTOM_DATA_RULES` 規定：`<student_provided_task>` 的要求和 `<task>` 不同時，照 `<task>`、不要因差異扣分；
    - 程式也不扣未分段的分數。
  - 結果，同一篇只寫一段的作文：
    - 在歷屆作答頁（111–115 都要求兩段）會被扣 1 分，組織分也會反映；
    - 在自訂題頁貼同一個題目，卻不扣。
  - 設計自己也寫了「AI 看到 not specified 就不會依題目扣未分段分數」（:1071），但防範只有一行建議提醒，學生忽略就失效。這直接違反「品質一樣」，也讓學生可以靠「不設段數」拿高分。
  - `CUSTOM_TASK_RULES` 的 organization 那點，又要求「判斷結構是否符合題目要求的形式」（:736）。兩條規則互相矛盾，兩位評分者可能各依一條判斷，分數差距一大就會觸發第三位評分者。
- **證據**：
  - 程式扣分只看 `requiredParagraphs`：`apps/api/src/ai/scoring.ts:253-256`（`noParagraphs` 需要 `requiredParagraphs !== null`）。
  - consumer 從題組取段數：`apps/api/src/ai/consumer.ts:460`（`requiredParagraphs: group.essay?.paragraphs ?? null`）。
  - 作答頁的提醒也只看設定：`apps/web/src/features/writing/lib/text.ts:71-74`（`expectedParagraphs` 是 null 時不提醒）。
- **建議修改**：
  1. **前端**：
     - 欄位還是「不指定」，而 `suggestRequirements` 從題目裡找得到段數或字數時，送出前要學生二選一：「設成 2 段」或「題目沒有規定段數」（一鍵確認）；
     - 草稿記下「已確認不指定」，之後不再問；
     - 這樣，「不指定」就代表學生確認過。
  2. **提示**：
     - `<task>` 的 `not specified` 改成 `not set by the student`；
     - `CUSTOM_DATA_RULES` 第 3 點改成：「`<task>` 有段數或字數時，以 `<task>` 為準；`<task>` 沒有設定、但題目文字有寫時，組織與內容照題目文字判斷，只是程式不另外扣分。」
  3. **P1 的對照**加一組「題目寫了文分兩段、段數卻不設」的案例。

### P3（major）字數要求和「至少約 120 字」的前提互相矛盾

- **位置**：§4.2（`ESSAY_RUBRIC` 逐字沿用）；§4.8 `too_short`（:831）；§6.4 字數與段數提醒（:1076-1079）；§6.10 字數說明（:1229）。
- **問題**：學生會照老師的要求填字數。設計的情境 1、3 是「至少 120」「130–170」，實際上「80–100 字」「150 字以內」也很常見。但 AI 端和作答頁都沒有跟著這個設定走：
  - **AI 端**：
    - `ESSAY_RUBRIC` 第一句寫死「the official guidance asks for at least about 120 words」，規則段又寫「It reminds students below 120 words」；
    - `CUSTOM_TASK_RULES` 只說「用同一個學測尺度」，沒說字數要依 `<task>` 判斷；
    - 所以老師要求 80–100 字、學生寫 95 字時，評分者很可能以 120 字為準，把內容判成發展不足；反過來，要求 250 字、學生寫 130 字，可能被當成字數足夠。
  - **作答頁**：
    - 如果照 `EssayAttemptPage` 的寫法，少於 120 個單詞就顯示「題目要求至少 120 個單詞」，和學生自己填的要求矛盾；
    - `max_words` 超過時，沒有任何提醒；
    - §6.4 只規定段數提醒怎麼改，沒有規定字數提醒怎麼改。
- **證據**：
  - `apps/api/src/ai/prompts/essay.ts:77`（120 字前提）、`:111-112`（程式規則與 120 字提醒）。
  - `apps/web/src/features/writing/EssayAttemptPage.tsx:212-216`（「題目要求至少 120 個單詞，目前只有 N 個」）。
  - `apps/web/src/features/writing/lib/text.ts:33`、`:69`（`belowHint` 固定用 `ESSAY_MIN_WORDS_HINT`）。
- **建議修改**：
  1. **`CUSTOM_TASK_RULES` 加一點**：
     - 原文：「Judge development against the length in `<task>`; if `<task>` sets none, against what the task text asks. Ignore the GSAT 120-word guidance mentioned in the rubric for this task. The program's own deduction below 100 words still applies.」
     - 程式扣分仍然是 100 字，§9.2 第 3 點的預設不變。
  2. **作答頁的字數提醒改成依學生設定**：
     - 有「至少 N」：說「題目要求至少 N 個單詞」；
     - 有「最多 N」而且超過：說「超過題目要求的 N 個單詞（AI 會依題目判斷內容）」；
     - 兩個都沒設：不提 120，或寫「學測要求至少 120 個單詞，供參考」；
     - 「少於 100 個單詞扣總分 1 分」獨立成一行，不論設定都顯示。
  3. **§7.5 加單元測試**：設「最多 100」、寫 90 個單詞時，不出現「至少 120」。
  4. **P1 的對照**加「80–100 字的題目」「250 字的題目」各幾篇。

### P4（major）內容規則誤擋真實題目，由旗標改成硬拒收，錯誤也不指出位置

- **位置**：§2.4.4（:351-367）；§2.5 文案（:419-421）；§6.3 即時驗證（:1057-1062）；§7.1 內容規則測試（:1263-1269）。
- **問題**：
  1. **誤擋的測試範圍不對**：第一版的使用者貼的是學校與補習班的題目，但誤擋只用 96 題歷屆與本站題量過（:367）。把設計的樣式照抄成正規式來跑，下面這些很普通的題目都會被拒收：

     | 題目片段 | 命中 |
     |---|---|
     | 如果每天**給自己 30 分**鐘做一件喜歡的事 | `instruction_text`（`\d+\s*分` 吃到「分鐘」） |
     | 如果老師願意**給你 10 分**鐘自由發表 | `instruction_text` |
     | 請描述一次你**忘記**遵守**規則**而學到教訓的經驗 | `instruction_text`（中文「忽略…規則」那條；「規則」是受詞之一） |
     | 你參加英文作文比賽，作品獲得**佳作**，請寫信感謝老師 | `scoring_text` |
     | 學校即將展出本學期的**優秀作品** | `scoring_text` |
     | Have you ever decided to **ignore the rules** to help a friend? | `instruction_text`（英文 ignore…the…rules） |
     | Your class is making a booklet of **sample essays** for junior students | `scoring_text` |

  2. **誤擋的代價變大了**：
     - 這些樣式大多來自 `detectInjection`。它原本的定位是「命中只設旗標、照常批改」，而且刻意保守：寧可漏掉，也不要誤擋；
     - 設計把它放寬：`20 分` 改成 `\d+ 分`，對象多了「學生／他／她」，受詞多了「設定」；
     - 放寬之後又改成 400 硬拒收，誤擋的代價就從「多一個旗標」變成「學生送不出去」。
  3. **錯誤訊息不指出位置**：訊息只說「題目裡有要求 AI 改變評分方式的文字（例如「給滿分」「忽略規則」）」。學生貼的題目裡沒有這些字，不知道要刪哪裡，只能亂改題目，批改反而變差。
- **證據**：
  - 現有樣式與定位：
    - `apps/api/src/ai/filter.ts:6-7`：命中只設旗標；
    - `:10`：刻意保守；
    - `:49`：`zh_ignore`；
    - `:50`：`zh_score` 只認「滿分／高分／最高分／20 分」。
  - 設計放寬後的樣式：§2.4.4 :358、:360。
- **建議修改**：
  1. **分兩級處理**：
     - **硬拒收**只留明確的寫法：
       - `markup`；
       - `request_to_ai` 的「幫我寫／代寫／write … for me」；
       - `scoring_text` 的「評分標準／配分／內容 N 分／rubric」；
       - `official_material`。
     - `instruction_text` 改成**提醒＋確認**：
       - 畫面說明「這句看起來像在要求 AI 改分數，AI 會忽略它」，學生可以照樣送出；
       - 送批改時照 §4.5 第 4 層記 `prompt:` 旗標；
       - §4.5 的第 2–8 層本來就擋得住這類文字。
  2. **收緊樣式**：
     - 「分」改成 `分(?!鐘)`；
     - 中文「給／打」限定對象：我、這篇、本文、本篇、這篇作文；
     - 「忽略…規則」那條：「以上／上述／前面／系統／所有」改成必要，受詞只留「指示／指令／提示詞／設定」；
     - 英文 ignore 那條：要有 previous／prior／above／earlier／system，受詞要是 instructions／prompt；
     - 「佳作」只擋「佳作範例／佳作欣賞／考生佳作／佳作一、二」這類寫法；
     - 拿掉「優秀作品」；
     - `sample essays` 只擋「sample essay(s) for this task／prompt」，或交給英文長度規則處理。
  3. **錯誤要指出位置**：
     - 前端本來就在本機跑同一支規則，直接把命中的字串標出來，例如「找到『評分標準』，請刪掉這一行」；
     - `official_material` 由 Worker 回傳命中處在學生自己文字裡的位置（`start`、`end`），不回傳受保護的文字。
  4. **§7.1 加一組「學校與補習班題目」語料**：
     - 至少 40 題，含上表 7 句、英文題目、看圖題、書信題，全部必須通過；
     - 這份清單和 96 題那組分開維護。
  5. **上線後**：§10 第 3 步「拒收 reason 分布」，前兩週每天看，之後每週看。

### P5（major）結果頁遇到題目或作文規則錯誤時，沒有改題目的路

- **位置**：§2.6 送批改第 4 步（:474「擋下時回 400，學生回作答頁改題目」）；§6.7（:1157，`customErrorView` 只用在作答頁）；§6.8（:1190）；R11（:1606）。
- **問題**：
  - 自訂題有兩個地方是在**結果頁**送批改，不是在作答頁：
    - 手寫稿確認文字（`confirmed`）之後的「送出 AI 批改」；
    - 批改失敗之後的「重新送出批改」。
  - 這兩處可能遇到三種錯誤：
    - `custom_prompt_invalid`：規則或指紋檔更新後重新檢查，題目被擋（R11）；
    - `essay_not_gradable`：手寫辨識出來不到 30 個單詞、大部分照抄題目；
    - `503 not_configured`：只關了自訂題。
  - 結果頁用的是通用的 `describeError`：
    - 會顯示「題目不符合規則，請依畫面上的說明修改」，但結果頁上沒有題目表單可以改；
    - `not_configured` 會被說成整個 AI 都沒開。
  - 兩種狀態各自卡住的地方：
    - **打字的 `failed`**：現有結果頁在「不是辨識失敗」時只有「重新送出批改」，沒有「回到作答頁」（設計 :1190 以為有）。
    - **手寫的 `confirmed`**：
      - `?from=` 對 draft／failed 以外的提交只帶回題目，作文是空的（:1150-1151）；
      - 辨識好的文字留在舊提交裡，學生只能重拍（再付 2 點）或自己複製；
      - 其實 PUT 允許在 `confirmed` 狀態改題目（:116），只是沒有畫面可以改。
- **證據**：
  - `apps/web/src/features/writing/SubmissionResultPage.tsx:459-478`：failed 只有辨識失敗時才給「回到作答頁」，否則只有重送按鈕。
  - `apps/web/src/features/writing/SubmissionResultPage.tsx:420-457`：confirmed 只有送批改按鈕。
  - `apps/web/src/features/writing/lib/errors.ts` 的 `describeError`：`bad_request`、`not_configured` 都是通用文案。
- **建議修改**：
  1. 結果頁也先經過 `customErrorView`；自訂題的這兩種錯誤附上 `action`（`ErrorView.action` 已經支援 `to`）。
  2. 自訂題在可修改的狀態（`draft`、`ocr_ready`、`confirmed`、`failed`）時，結果頁「你提供的題目」收合區加「修改題目」：
     - 展開 `CustomPromptForm`，存檔走 `PUT { custom_prompt }`；
     - 不離開結果頁、不丟辨識文字；
     - 這樣 R11 的對策對手寫稿也成立。
  3. 自訂題的結果頁遇到 `not_configured`，顯示「自訂題目批改目前沒有開放」，不要說成整個 AI 沒開。
  4. §7.5 的 `SubmissionResultPage.test.tsx` 加案例：
     - `confirmed` 送批改回 400 `custom_prompt_invalid`：顯示文案與「修改題目」；
     - 修改後，PUT 本體有 `custom_prompt`；
     - `failed` 重送回 `essay_not_gradable`：顯示對應的文案。

### P6（major）隱私權說明改字但不升版

- **位置**：§6.10 隱私權說明那一列（:1235）；§3.6 境外處理（:680）；§9.2 第 6 點（:1616，預設不升版）。
- **問題**：
  - 設計要改隱私權說明裡的兩句話，但預設不升版。
  - 隱私權說明自己寫著：「修改時會更新版本日期；你下次使用需要登入的功能前，網站會顯示新版並請你重新同意。」改字不升版，等於違反對使用者的承諾。
  - 前端靠「頁面版本＝使用者同意的版本」判斷要不要請使用者重新同意。改字不升版後，使用者同意的是舊文字、畫面顯示的是新文字，版本號卻一樣，這個判斷就不準了。
- **證據**：
  - `apps/web/src/features/account/policy.ts:151`：修改時會更新版本日期；
  - `:4-9`：版本比對的用途；
  - `:85`：AI 那一節已經寫「連同題目與評分參考」；
  - `:243`：AI 處理說明寫「傳送的內容只有作答、題目與評分參考」。
- **建議修改**：二選一，寫進設計，不要留給實作者自己判斷：
  1. **（建議）第一版不改隱私權說明與 AI 處理說明的文字**：
     - 現有文字「作答、題目與評分參考」已經涵蓋學生輸入的題目；
     - 要說明的細節放在自訂題頁的個資提醒（§6.10 已有）與 `/composition` 的說明；
     - 改字留到下一次排定的條款改版，一起升版；
     - §8.3 的檔案清單拿掉 `policy.ts`、`policy.test.ts`。
  2. **若站主要現在改字**：
     - 照 `policy.ts` 的規則升版：三處版本號一起改，`changes` 寫出差異；
     - 並接受所有已登入的使用者下次都要重新同意。這會影響所有學生，不只用自訂題的人。

### P7（major）`custom_title`、`custom_prompt` 設成必填的連帶影響

- **位置**：§2.2 `SubmissionSummary.custom_title`、`SubmissionDetail.custom_prompt`（:172-182）；§7.6「既有 spec 不改」（:1479）；§8 檔案清單。
- **問題**：
  1. **既有 e2e 的型別檢查會失敗**：
     - 這兩個欄位是必填型別；
     - `apps/web/tsconfig.node.json` 會型別檢查 `tests/`；
     - `tests/writing.spec.ts`、`tests/writing-bank.spec.ts` 各有一個回傳完整 `SubmissionDetail` 物件的 `detail()`，少了新欄位，`npm run typecheck` 就失敗；
     - 但設計說這兩支 spec 不改，§8 也沒有列。
  2. **舊 Worker 期間型別不實**：
     - 部署期間（R8，網站先到、Worker 晚到），舊 Worker 的回應沒有這兩個欄位，執行時是 `undefined`；
     - 型別卻宣告成 `string | null`、`CustomEssayPrompt | null`；
     - 設計裡的寫法剛好都用 `?.` 或 `&&`，暫時沒事；但之後有人寫 `=== null` 判斷就會出錯。
- **證據**：
  - `apps/web/tsconfig.node.json:12`：include 含 `tests`。
  - `apps/web/tests/writing.spec.ts:45-63`、`apps/web/tests/writing-bank.spec.ts:120-138`：`detail()` 回傳完整物件。
  - `apps/web/src/features/writing/testing/fixtures.ts:144`：`BASE`（§8.3 有列）。
  - `apps/web/src/features/writing/lib/writingApi.ts:27-36`：守衛不檢查這兩個欄位。
- **建議修改**：
  - **改成選填**：`custom_title?: string | null`、`custom_prompt?: CustomEssayPrompt | null`。
    - Worker 一律回傳，前端一律寫 `?? null`；
    - 這樣既有的 fixture 與 spec 真的不用改，舊 Worker 期間的型別也正確。
  - 若堅持必填：§8.3、§8.4 要列上這兩支 e2e spec，§7.6 的「不改」也要改寫。

### P8（major）總開關的緊急關閉步驟會被下一次部署蓋掉

- **位置**：§5.3 總開關（:929-936）；§10 第 4 步（:1642）。
- **問題**：
  1. **後台改的變數會被蓋掉**：
     - §10 第 4 步寫「或在 Cloudflare 後台改變數後重新部署」；
     - 但在 Cloudflare 後台改的 Text 變數，下一次 `wrangler deploy` 會被 `wrangler.toml` 的 `[vars]` 蓋回 `on`；
     - 部署 workflow 在 `apps/api`、`packages/shared`、`data/**` 有變動時都會跑，而題庫資料常常在更新；
     - 結果是：站主以為關掉了，下一次題庫更新就默默打開。
  2. **改設定檔要等很久**：
     - 改 `wrangler.toml` 再推 main，要等 workflow 跑完型別檢查、全部 Worker 測試、遷移與部署，需要好幾分鐘，而且要能 commit 才關得掉；
     - 現有的緊急手段是 `/admin` 的全站暫停：存在 D1、立即生效，但題庫題也會一起停。
- **證據**：
  - `apps/api/wrangler.toml:18`：選 Text 的變數會被下一次部署刪掉，`wrangler deploy` 以 `[vars]` 為準。
  - `docs/SETUP-KEYS.md:125`：同樣的說明；`:208`：調整 `[vars]` 要推到 main，由部署 workflow 自動部署。
  - `.github/workflows/worker-deploy.yml` 的 `on.push.paths`：資料變動也會觸發部署。
- **建議修改**：
  1. §10 第 4 步改寫成三種情況：
     - **立即止血**：用 `/admin` 的全站暫停（題庫題也會停）；
     - **只關自訂題**：把 `wrangler.toml` 的 `AI_CUSTOM_ESSAY` 改成 `"off"`，推到 main；
     - **不要**在 Cloudflare 後台改 Text 變數。
  2. **更好的做法**（可以列為第一版的選項）：
     - 開關放在 D1，例如 0003 多一張 `site_flags`，或沿用後台已有的設定表；
     - `/admin` 可以直接切換，立即生效，也不會被部署蓋掉；
     - `AI_CUSTOM_ESSAY` 只當成「這個環境有沒有這個功能」的預設值。
  3. `docs/SETUP-KEYS.md` 加一節「只關閉自訂題目批改」，§8 檔案清單補上這個檔案（見 P21）。

### P9（minor）`<task>` 的 Source 行斷言「不是官方試題」

- **位置**：§4.3（:750）；§9.2 第 5 點（:1615）。
- **問題**：
  - 情境 3 的「其他考卷」與補習班講義，常常就是歷屆學測、指考題。Source 行寫死「It is not an official exam question」，對這些題目是錯的。
  - 評分者可能因此把它當成「非學測題型」，放寬或改變標準，影響 P1 要做的同題對照。
  - 學生在自訂頁貼歷屆題，也拿不到歷屆頁有的圖片文字描述與段數要求，批改品質一定比在歷屆頁差。
- **建議修改**：
  1. Source 行改成：「The website cannot verify where this task comes from (it may be copied from a school, cram-school, or past exam handout).」
  2. 第一版就在題目欄的說明加一句：「如果是歷屆學測或指考的題目，請到『歷屆試題』作答，那裡附圖片的文字描述與段數要求，批改比較準。」連到 `/writing/essay`。自動比對（§9.2 第 5 點）可以留到第二版。

### P10（minor）離題後的補救要學生重寫作文

- **位置**：§4.6 畫面（:817「補上完整題目後，用同一個題目再寫一次」）；§6.6 `?from=`（:1148-1153）。
- **問題**：
  - 題目貼得不完整而被判離題時，學生需要的是「改題目，同一篇再批一次」。
  - 但現在的路徑做不到：
    - 「用同一個題目再寫一次」對已批改（`graded`）的提交只帶回題目，作文是空的；
    - 同一台裝置的草稿可能還留著原作文，但 `?from=` 會先問「載入這份題目會取代目前的草稿」，選「載入並取代」，作文就沒了；
    - 換一台裝置，作文要自己從結果頁複製。
- **建議修改**：
  1. 已批改的自訂題，結果頁多一個動作「修改題目後重新批改這篇（7 點）」：帶回題目與作文（`detail.body.text`），建立新的提交。離題提醒的那句話改成指向這個動作。
  2. `?from=` 帶回的題目和目前草稿的題目相同（正規化後比對）時，不跳出取代的確認。
  3. 取代的確認文字寫清楚「會清掉作文」，另外提供「只換題目、保留作文」。

### P11（minor）離題補充句、改寫被丟掉的說明，和「EssayResult 不改」衝突

- **位置**：§4.6（:817）；§4.8 參考改寫上限（:833-837）；§8.5（:1583，`EssayResult.tsx` 不改）。
- **問題**：
  - §4.6 要在 `EssayResult` 的離題提醒「多一句」。但離題提醒在 `EssayResult` 的總分卡裡面，§8.5 又說這個元件不改。
  - §4.8 規定改寫超過上限時設成 null。這時 `EssayResult` 會直接不顯示「保留原意的參考改寫」，學生不知道這次為什麼沒有（歷屆題幾乎每次都有）。
- **證據**：
  - `apps/web/src/features/writing/components/EssayResult.tsx:107`：離題提醒在總分卡內。
  - `apps/web/src/features/writing/components/EssayResult.tsx:312`：`rewrite` 是 null 就不顯示。
- **建議修改**：
  - **離題補充句**，二選一寫清楚：
    - (a) `EssayResult` 加選填的 prop（例如 `offTopicHint`），預設輸出不變，並改寫 §8.5；
    - (b) 在結果頁 `EssayResult` 的上方另外放 `Notice`，`grading.off_topic` 為 true 時顯示。
  - **改寫被丟掉**：
    - 讓前端知道 `judgments.meta.rewrite_dropped`（目前 `EssayGradingResult` 沒有這個欄位），並顯示「這次的參考改寫超過長度上限，不顯示」；
    - 或者不要丟掉，改成截斷到上限並加上標示。

### P12（minor）手機上題目表單很長；唯讀預覽何時出現沒有定義

- **位置**：§6.2 手機版面（:1013-1046）；§6.8（:1183「作答頁的唯讀預覽也用它」）。
- **問題**：
  - 題目區有 6 行題目、3 行圖片描述、6 個段數選項、兩格字數、收合說明與個資提醒。在 375×667 的手機上，作文框大約要到第三個畫面才出現，寫作文時看不到題目。
  - §6.8 提到作答頁有唯讀預覽，但 §6.2、§6.3 都沒有寫什麼時候顯示。
- **建議修改**：
  - 題目檢查通過後，學生按「題目設定好了」（或作文開始有字）時，表單收成 `CustomPromptView`（題目＋要求一行），旁邊放「修改題目」按鈕；
  - 收合狀態存在草稿裡；寫作時可以展開看題目；
  - §7.5 加測試：收合後重新整理仍是收合；題目有錯誤時不能收合。

### P13（minor）拍照模式在扣辨識點數之後才檢查 30 單詞等規則

- **位置**：§6.4 拍照（:1091）；§2.4.6。
- **問題**：
  - 手寫稿要先付 2 點辨識，確認文字之後才知道有沒有違反三條規則：不到 30 個單詞、中文太多、大部分照抄題目。這時辨識的點數已經不能退。
  - 歷屆題沒有這三條規則，學生不會預期。
- **建議修改**：
  - 拍照模式的上傳按鈕上方加一句：「自訂題目的作文至少要 30 個英文單詞、用英文寫，才能送 AI 批改（辨識的 2 點不會退）。」
  - 自訂題的確認文字畫面（`OcrConfirm`），即時顯示 `essayGradableProblem` 的結果，學生在確認前就看得到。

### P14（minor）`/composition` 既有文案沒跟著改；新區塊的位置

- **位置**：§6.1（:998）；§6.10（:1220-1221）。
- **問題**：
  - 加了第三區之後，「作答與批改方式」裡這三句話會對不上：
    - 開頭是「上面兩種題目都可以線上作答」；
    - AI 那一條的結尾是「歷屆試題與本站仿真題都可以送」；
    - 新增的那一條又寫「作答與批改方式和上面兩種題目相同」。
  - 新區塊插在「本站仿真題」與「歷屆試題」兩份列表中間，把兩份題目列表拆開了；`section-practice.spec.ts` 開頭的說明（「先是本站仿真題，再是歷屆試題」）也要跟著改。
- **證據**：
  - `apps/web/src/pages/CompositionPage.tsx:59`、`:67`。
  - `apps/web/tests/section-practice.spec.ts:8-9`。
- **建議修改**：
  - 三句改成：「上面的題目都可以線上作答」；「歷屆試題、本站仿真題與自訂題目都可以送」；新增那一條寫「作答與批改方式和其他題目相同」。
  - 位置有兩種做法：
    - 維持在兩份列表中間（理由合理），但在設計裡寫明上述測試說明要改；
    - 或把入口改成「本站仿真題」標題列旁的一個連結（`JumpLink` 那一列），不另外佔一個區塊。

### P15（minor）`/writing` 入口卡的位置與文案

- **位置**：§6.1（:999）；§6.10（:1222）。
- **問題**：
  - 設計說「英文作文那一區加一張入口卡」，但 `/writing` 沒有「英文作文那一區」。現在的版面是：
    - 上面：「中譯英」「英文作文」兩張卡，兩欄排版；
    - 下面：「本站仿真題（AI 出題）」一區，兩張卡。
  - 兩個位置都不合適：
    - 加在上排會變三張卡，兩欄排版多出一格空位；
    - 加在本站仿真題區又不對，因為自訂題不是 AI 出題。
  - 文案「寫完送 AI 批改」不論學生有沒有權限都顯示；其他卡片只描述題目內容。
- **證據**：`apps/web/src/features/writing/WritingHomePage.tsx:45-56`、`:58-77`。
- **建議修改**：
  - 明定放法，例如：
    - 上排改成三張卡（`sm:grid-cols-3`，或讓第三張跨兩欄）；
    - 或在本站仿真題區下面另開「自己的題目」一小區。
  - 文案改成「貼上老師或補習班的作文題目，寫完可以自我檢核或送 AI 批改」。

### P16（minor）寫作紀錄的草稿列連結和其他題目不一致

- **位置**：§6.9（:1214）。
- **問題**：
  - 現在每一列都連到結果頁（草稿也一樣），結果頁的草稿狀態再給「回到作答頁」。
  - 設計只把自訂題的草稿改成直接連到作答頁，行為和其他題目不一致，`SubmissionHistory` 的 `Row` 也要多一個分支。
- **證據**：
  - `apps/web/src/features/writing/components/SubmissionHistory.tsx:30`。
  - `apps/web/src/features/writing/SubmissionResultPage.tsx:383` 起的 draft 區塊。
- **建議修改**：維持一律連到結果頁；結果頁的「回到作答頁」照 §6.8 指向 `?from=`。

### P17（minor）`<title>` 要不要放題目開頭，三處寫法互相矛盾

- **位置**：
  - §2.2 `customPromptTitle` 的註解（:232）：「寫作紀錄與結果頁 <title> 用的題目開頭」；
  - §5.7（:974）：「<title> 只用 customPromptTitle」；
  - §6.8（:1178）：`<title>` 是「自訂題目 英文作文｜批改結果｜學測英文中心」，不含題目。
- **問題**：
  - 三處的寫法互相矛盾。
  - 把題目放進 `<title>` 有個資風險：`<title>` 會進瀏覽器的歷史紀錄、同步到其他裝置，也會出現在分頁標籤與投影畫面上；而題目可能有老師、學校的名稱（§6.10 才請學生刪掉）。
- **建議修改**：
  - 採 §6.8 的版本，`<title>` 不放學生文字；改掉 §2.2 的註解與 §5.7 的句子。
  - §7.5 加斷言：`document.title` 不含題目文字。

### P18（minor）「本站的評分規準」顯示的不是 AI 用的規準

- **位置**：§4.7（:824）；§6.2（:1043）；§6.10（:1231-1232）。
- **問題**：
  - 作答頁要顯示 `COMPOSITION_CRITERIA`，標題是「本站的評分規準」，頁尾又說「AI 依本站自己寫的學測作文評分規準…批改」。
  - 但兩份內容不一樣：
    - AI 實際用的是 `ESSAY_RUBRIC`：英文、每項 0–5 分六個等級，還有程式負責的扣分規則；
    - `COMPOSITION_CRITERIA` 是模擬考自評用的摘要：優 5–4、可 3、差 2–1、劣 0，只有四級。
  - 學生會以為畫面上看到的就是 AI 用的規準。
- **證據**：
  - `apps/web/src/features/mock/selfAssess.ts:53-98`（`COMPOSITION_CRITERIA`）。
  - `apps/api/src/ai/prompts/essay.ts:77-116`（`ESSAY_RUBRIC`）。
- **建議修改**：二選一：
  - 收合區的標題改成「評分規準摘要（本站撰寫）」，第一句說明「AI 依同樣的四項、更細的分數描述評分」；
  - 或另外寫一份和 `ESSAY_RUBRIC` 對應的中文版，放在 shared，兩邊的註解互相指向，改一邊就要改另一邊。

### P19（minor）缺的測試案例

- **位置**：§7。
- **問題與建議**（依重要性排列）：
  1. P4 的「學校與補習班題目」語料，必須全部通過。
  2. P5 的結果頁錯誤處理與「修改題目」。
  3. **開關關閉時，排隊中的批改照常完成**：
     - §5.3 寫了這個行為（:935），但 §7.2、§7.4 都沒有對應的測試；
     - 加一個 consumer 案例：排入 Queue 後把開關關掉，結果仍然是 graded。
  4. **`failed` 後改題目再送批改**：先 PUT 新題目再送批改，consumer 用的要是新題目（`system`、`userText` 都含新題目）。
  5. **`SubmissionHistory` 的 `custom_title`**：
     - 加單元測試（目前只有 e2e 涵蓋）；
     - 寫作紀錄預設顯示「中譯英」（`SubmissionHistory.tsx:57`），§7.6 第 2 條的 e2e 要先切到「英文作文」。
  6. **P2、P3 的提示文字斷言**：`not set by the student`、字數依 `<task>` 的規則；以及作答頁的字數提醒。
  7. **D8 真實資料斷言的位置**：
     - §7.3 的斷言（310 組 0 命中、48 份全部命中）放在 `apps/api/test`；
     - CI 的慣例是把讀 `data/` 的斷言放在 shared 的 data 專案（`test:data`，在 exams job 執行），這樣題庫資料出錯不會擋住程式的檢查與 Worker 部署；
     - 建議搬到 `packages/shared/src/custom-essay.data.test.ts`，或另開一支 data 測試；
     - 證據：`.github/workflows/ci.yml:5-9`。

### P20（minor）local-e2e 的自訂題步驟是「選做」

- **位置**：§7.6（:1481）；§7.7（:1492）。
- **問題**：
  - §7.7 自己寫「改到遷移、consumer 時」要跑 local-e2e，這次兩個都改了；但 §7.6 把自訂題那一步列為選做。
  - 其他驗證方式都碰不到真正的流程：
    - Vercel 的 PR 預覽透過 `vercel.json` 的 rewrites 連到**正式** Worker，預覽上一定顯示「即將開放」；
    - Vitest 的假 D1 用的是 `node:sqlite`。
  - 能用真的 `wrangler dev`、本機 D1 與 Queue consumer 跑過自訂題的，只有 local-e2e。
- **證據**：
  - `vercel.json` 的 `rewrites`：指向 `gsat-english-api.gsat-english.workers.dev`。
  - `apps/api/test/helpers/d1.ts`（api-map §5.3）。
- **建議修改**：
  - local-e2e 的自訂題步驟改成必做：建立 → 送批改 → graded → 刪除提交後，題目列跟著消失；
  - 拿掉 §8.4 的「選做」；
  - PR 說明附上這一步的輸出。

### P21（minor）部署後確認與站主文件沒有涵蓋 `customEssay`

- **位置**：§8 檔案清單；§10 第 2 步（:1629-1636）。
- **問題**：
  - §10 第 2 步的第一項，要人工看 `/api/features` 有沒有 `customEssay`；
  - 但部署 workflow 的部署後確認，只比對與列出 `auth`、`ai`、`ocr`、`aiPaused`；
  - 站主的操作文件也沒有提到這個開關。
- **證據**：
  - `.github/workflows/worker-deploy.yml:367-373`：比對的欄位；`:404-412`：Summary 列出的欄位。
  - `docs/SETUP-KEYS.md:139`：部署後確認的說明。
- **建議修改**：§8 補上兩個檔案：
  - `.github/workflows/worker-deploy.yml`：
    - Summary 多一列「自訂題目批改（customEssay）」；
    - `ai` 啟用而 `customEssay` 是 false 時印 notice，不讓部署失敗；
    - 注意：改這個檔案本身也會觸發 Worker 部署（它在 `on.push.paths` 裡），和這次 PR 一起合併即可。
  - `docs/SETUP-KEYS.md`：開關的說明，以及 P8 的關閉步驟。

### P22（minor）沒寫回滾時的行為

- **位置**：§9.1 R8（:1603）；§10。
- **問題**：設計只談「網站先到、Worker 晚到」。另外兩種回滾也可能發生，要先寫好結果，站主才知道能不能回滾：
  - **網站回滾**（在 Vercel 一鍵回到上一版）：舊前端的寫作紀錄與結果頁，會把 `custom:essay@1` 原樣當成標題（`groupLabel` 遇到格式不對的 id 就原樣顯示），沒有題目，也沒有「再寫一次」。
  - **Worker 回滾**（`wrangler rollback`）：
    - 遷移不會倒回，但沒有害處；
    - 新建立自訂題的 POST 回 400「沒有這個題組」，PUT 與送批改回 409「找不到這份提交的題目」；
    - 排隊中的自訂題，由 consumer 以 `internal` 退還點數；
    - 舊 Worker 的 `/api/features` 沒有 `customEssay`，新前端會顯示「即將開放」。
- **證據**：
  - `apps/web/src/features/writing/lib/format.ts:58-62`。
  - `apps/api/src/submissions/routes.ts:114-117`（POST 查不到題組時回 `WRITING_UNKNOWN_GROUP_MESSAGE`）、`:185-186`（PUT 回 409）。
  - api-map §1.6：consumer 查不到題目就以 `internal` 退還。
- **建議修改**：
  - §10 加一小節「回滾」，寫上面的結果；
  - 註明出問題時優先用總開關（P8），不要回滾 Worker；
  - 網站回滾只影響顯示，可以接受。

### P23（minor）工作包「合併」的意思要寫清楚

- **位置**：§8（:1501「A 先做；B、C 在 A 的型別合併後並行」）；§10 第 1 步（:1626「同一個 PR 合併」）。
- **問題**：
  - 「合併」可以讀成「A 先合併進 main」。A 包含遷移、建立提交的 API，以及預設 `on` 的 `AI_CUSTOM_ESSAY`。
  - 如果 A 先進 main：
    - Worker 會自動部署，`/api/features.customEssay` 變成 true；
    - 但送批改的程式（B）還沒進來。
  - 如果 C 比 B 先進 main：學生按送出後，會在送批改那一步拿到 409。
- **建議修改**：
  - 明寫「工作包合併進 `customessay` 分支，最後一個 PR 才進 main」；
  - 若一定要分批進 main：`wrangler.toml` 的 `AI_CUSTOM_ESSAY` 先設成 `off`，最後一個 PR 才改成 `on`（`skeleton.test.ts` 會檢查兩處一致）。

### P24（minor）`english_too_long` 把學生用英文寫的圖片描述也算進去

- **位置**：§2.4.4（:361）；§6.10 圖片描述欄的說明（:1226）。
- **問題**：
  - 題目加上圖片描述，英文合計超過 150 個單詞就拒收。
  - 英文題目約 60–100 個單詞，學生再用英文描述圖表（800 字元約 130 個單詞），很容易就超過。
  - 圖片描述是學生自己寫的，不是範文；錯誤文案「不要貼範文或閱讀文章」也對不上。
- **建議修改**：
  - 英文長度只算題目欄，圖片描述靠 800 字元的上限就夠；
  - 或在文案與欄位說明都寫明「圖片描述請盡量用中文」。

---

## 4. 確認沒有問題的地方（供實作參考）

- **路由**：`/writing/essay/custom` 是靜態段，優先於 `:examId`。`App.tsx:96-97` 已經有 `writing/essay/ai` 的先例；路徑也不以 `/auth` 開頭。
- **結果頁不會誤抓題目**：
  - `parseGroupId('custom:essay@1')` 與 `parseBankGroupId` 都回 null，結果頁不會去下載 `essay.json` 或本站題的檔案；
  - `groupLabel`、`attemptPathOf` 只要把自訂題的判斷放在最前面即可。
- **舊 Worker 的錯誤文案對得上**：舊 Worker 收到沒有 `group_id` 的 POST，會回 400 `WRITING_UNKNOWN_GROUP_MESSAGE`（`apps/api/src/submissions/routes.ts:114-117`），§6.7 的對應文案成立。
- **遷移與部署順序**：
  - `worker-deploy.yml` 先執行 `d1 migrations apply --remote`，再部署 Worker；
  - 0003 只有 `INSERT OR IGNORE` 與 `IF NOT EXISTS`，遷移套用後、新 Worker 部署前的空窗裡，舊 Worker 不受影響；
  - 部署步驟會再跑一次產生器，指紋檔會跟著打包。
- **網站會一起部署**：`vercel.json` 的 `ignoreCommand` 含 `packages` 與 `apps/web`，同一個 PR 會觸發網站重新建置。
- **遷移清單有測試提醒**：`EXPECTED_MIGRATIONS` 漏加時，`apps/api/test/admin.test.ts:114-115` 會失敗。
- **新欄位不會被當成格式錯誤**：前端的守衛（`writingApi.ts` 的 `isSubmissionDetail`、`isSubmissionList`）不檢查新欄位，舊 Worker 的回應也不會被判成格式錯誤。
