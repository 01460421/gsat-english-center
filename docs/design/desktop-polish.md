# 桌機介面打磨：設計（美觀、人性化）

> 版本：2026-10-23 第 1 版。
> 需求（站主原文）：「電腦介面要更美觀，人性化」。
> 硬性條件（沿用 [desktop-ui.md](desktop-ui.md) §0、§2.1）：**手機與平板（< 1024 px）逐像素不變**；新樣式只放在 `lg:` 起的變體，或只在 ≥ lg 才掛載的元件；行為差異一律包在 `useIsDesktop()`。新的介面文字用繁體中文（台灣用語），不出現「大考中心」、CEEC 或模型名稱；D8（不顯示官方參考譯文、評分原則原文、佳作）。
> 基準：分支 desktop-polish＝origin/main **35ff807**（desktop-ui PR A 已上線，學習助手 #41、#42 已合併）。檔名與行號以 35ff807 為準。
> 依據：三份設計審查（視覺 31 項、使用流程 32 項、一致性 25 項，共 88 項；合併重複後 50 項，見[附錄 A](#附錄-a合併後的意見清單)）與 desktop-ui.md 延後的 §6–§8。
> 改版前截圖：scratchpad 的 `ui-audit/before/`（106 個頁面狀態、649 張，索引 `index.md`；1366×768、1440×900、1920×1080，主要頁面另有 1440×900 深色）。下文用檔名（不含 `.png`）引用，例如 `03-practice-menu-records__1440x900`。
> 和 desktop-ui.md 的關係：本文是它的續篇。§6–§8 照原設計做，本文只補充與修正；少數已上線的決定在本文改寫（§1.4 逐條列出）。兩份文件不一致時以本文為準。
> 標記：「（實測）」＝在 35ff807 的建置產物上量到；「（設計值）」＝實作後量、寫回本文；「（計算）」＝用 token 色碼算出的 WCAG 對比。

**目錄**：[0. 摘要](#0-摘要)｜[1. 目標與原則](#1-目標與原則)｜[2. 視覺規格](#2-視覺規格)｜[3. 逐頁改善](#3-逐頁改善)｜[4. 人性化](#4-人性化)｜[5. 工作包](#5-工作包)｜[6. 不採用或改做法的意見](#6-不採用或改做法的意見)｜[7. 待站主決定](#7-待站主決定)｜[8. 實作備註](#8-實作備註)｜[附錄 A](#附錄-a合併後的意見清單)｜[附錄 B](#附錄-b截圖重截指令)

---

## 0. 摘要

**一句話**：把桌機版從「每頁各自排得不錯」變成「一套系統」——標題永遠在同一個位置、一套字級與元件、看得出哪裡能點；再把作答、寫作、結果頁做成「知道自己在哪、知道下一步、不怕按錯」。

### 0.1 學生最看得到的十個改變

| # | 改變 | 現況（截圖） | PR |
|---|---|---|---|
| 1 | **標題不再跳**：每一頁的 H1 都從同一條左緣開始（1440 寬 x=296、1920 寬 x=424），上緣只分列表頁與工作區兩種（差 8 px），字級也只有兩種 | 換頁時 H1 在 x=288／296／361／369／433 五個位置、上下差 24 px（`17-assistant-home__1440x900`） | 2 |
| 2 | **作答頁的題號列＋鍵盤作答**：一直看得到「第幾題、哪幾題沒答、標記了哪幾題」，可以用 1–4／A–J 作答、N／P 換題、M 標記 | 往下捲之後只剩「已答 3／53」；作答頁沒有任何快捷鍵（`12-exam-paper-exam-midway-word-bank__1366x768`） | 3 |
| 3 | **選文一行 60–75 個字元**：閱讀與綜合測驗在 1920 寬不再左右各空 330 px，長文的行數約少 20–30%（估計） | 選文欄 466 px、約 55 字元一行（`04-section-reading__1920x1080`） | 3 |
| 4 | **看得出哪裡能打字、能選**：輸入框、選單、篩選膠囊的邊界對背景 ≥ 3:1；可以點的卡片有陰影 | 邊界 1.30:1，預估分數的輸入框像一塊灰色色塊（`14-mock-paper-start__1440x900`） | 2 |
| 5 | **一個畫面只有一個主角**：一套按鈕；「選中」改成淡底＋主色框，實心主色只留給該做的那一個動作；深色模式不再一排亮紫色塊 | 「歷屆試題」「全部 66」「交卷」都是實心亮紫（`08-writing-essay-list__1440x900__dark`） | 2 |
| 6 | **交卷後有下一步**：錯題題號格（點了跳到解析）、依答對率的一句建議、連到弱的題型與「批改這份的作文」 | 結果只有分數和「再一組」；歷屆交卷結果唯一的按鈕是「清除作答」（`12-exam-paper-exam-submitted__1366x768`） | 1、3 |
| 7 | **不怕按錯**：清除考卷要確認；交卷確認的焦點在「繼續作答」；模擬考交卷對話框的按鈕永遠看得到；字數不足時送出 AI 批改前先提醒；計時中點側邊欄會先問 | 都沒有（`14-mock-paper-submit-dialog__1366x768`、`09-essay-exam-student-focus-submit__1366x768`） | 1 |
| 8 | **寫作題目和作答框並排**：一個畫面看得到題目、作答框、字數、「已自動儲存 10:42」與送出按鈕；Ctrl／⌘＋S 存檔 | 作答框在第一個畫面以下，開始打字題目就被捲走（`09-essay-exam-student-filled__1366x768__full`） | 4 |
| 9 | **首頁回答「今天練什麼」**：待複習的單字、錯題本、作答中的考卷一鍵開始；沒有紀錄時是三步驟的新手引導 | 標題重複品牌名、待辦藏在右欄的統計數字裡、底部顯示「後端已連線 v0.0.0-audit」（`01-home-student-history__1440x900`） | 5 |
| 10 | **題庫練習矩陣看得出進度**：做過的格有進度條與答對率文字、標出「上次」、空白時標出建議起點 | 18 格一模一樣的淡藍色塊（`03-practice-menu-records__1440x900`） | 3 |

其他也會改的：批改結果頁的「AI 批改，僅供參考」從 4 個降到 1 個橫幅；所有 sticky 列撐滿主欄；說明不再被截成「…」；側邊欄在高螢幕上分組更清楚；帳號列看得到 AI 狀態；表格表頭不再一字一行；英文選文標上 `lang="en"`（讀屏用英文發音）。

### 0.2 五個 PR（依學生受益排序，依序合併）

| PR | 名稱 | 做什麼 | 規模（估計） | 依賴 |
|---|---|---|---|---|
| **1** | 防誤觸與語言標記 | 歷屆交卷後清除要確認、交卷確認的焦點、模擬考交卷對話框、字數不足送出提醒、計時中離開確認、英文內容 `lang="en"`；把截圖工具搬進 repo | 小：約 15 個檔 | 無 |
| **2** | 外觀基礎 | 版面框架與標題位置、字級與 token、側邊欄、頁首與返回連結、按鈕、表單、選擇控制項、表格、標章、卡片、sticky 列、深色層次 | 大：約 60 個檔，拆成 2a（版面與殼層）、2b（元件） | 1 |
| **3** | 作答頁 | desktop-ui §7–§8：題號列、分割作答、目前題、鍵盤；結果頁的下一步；練習矩陣；專心作答 | 大：約 35 個檔，可拆 3a（題號列與鍵盤）、3b（分割與結果） | 2 |
| **4** | 寫作工作區 | desktop-ui §6：題目與作答並排、狀態列、送出區、Ctrl＋S／Enter、批改結果工作區、排隊頁、題目列表的進度 | 大：約 30 個檔 | 2（與 3 互不依賴） |
| **5** | 首頁、列表、單字、學習助手 | 首頁「今天」、/exams 與 /mock 列表、/words 篩選欄與每日學習、學習助手各頁、歡迎與 AI 申請 | 中：約 30 個檔 | 2 |

PR 1 最小、風險最低、直接保護學生的作答與點數，先上。PR 2 是其他三個 PR 的地基（按鈕、膠囊、表格、框架），先做可以避免同一個元件改兩次。PR 3–5 在 PR 2 合併後可以平行開發，依完成順序合併。

### 0.3 改寫 desktop-ui.md 的決定（細節見 §1.4）

1. **一個版面框架**：所有寬度模式共用一個最寬 82rem、置中的框架，內容**靠框架左緣**；工作區（作答、寫作）也受 82rem 限制（原設計不設上限）。
2. **選中＝淡底＋主色框**（`bg-primary-soft text-primary border-primary`），不再用實心主色；實心主色只給每個區塊的主要動作。
3. **新 token 只新增、不改值**；深色模式的 `--line`、`--surface-2` 只在 ≥ lg 調深。**不用 Tailwind 的 `dark:`**（它只看系統設定，不看本站手動切換的 `data-theme`）。
4. 送出 AI 批改的確認，除了快捷鍵，**有字數或段數提醒時點按鈕也要確認**。
5. desktop-ui §9 延後的首頁「今天要做什麼」做**只讀本機資料的最小版**，不做推薦規則。

### 0.4 待站主決定（預設值已寫進設計，不影響開工；§7）

會改到手機行為或像素的小修正要不要一起做（歷屆清除確認、交卷確認焦點等）；首頁「今天」的範圍；計時中離開確認與自動收合；送出確認的條件；1920 寬工作區上限；主程式大小預算。

---

## 1. 目標與原則

### 1.1 「美觀」在這個網站的意思：七件量得到的事

| # | 目標 | 驗收方式 |
|---|---|---|
| A1 | **標題位置固定**：H1（子頁是返回連結）的左緣在所有頁面相同；非工作區頁的上緣相同，工作區頁只高 8 px | e2e 在 1440、1920 量 15 條路由的 H1 `getBoundingClientRect().left` 相等（±1 px）；頁尾導覽的左緣也相等 |
| A2 | **一套字級**：桌機只用 §2.2 的 8 個字級；改過的元件裡不再出現 `text-[0.95rem]` 與小於 12 px 的字；中文標題不再 `tracking-tight` | e2e 掃 main 裡所有可見文字，≥ lg 沒有 font-size < 12 px；H1 一律 28 px（工作區 24 px） |
| A3 | **看得出能點**：互動元件的邊界對背景 ≥ 3:1（WCAG 1.4.11）；可點的卡片淺色有陰影、深色有框線＋箭頭；靜態卡片沒有陰影 | 兩種主題下用 computed style 算輸入框、選單、膠囊的框線對背景的對比 |
| A4 | **一個區塊一個主角**：每個區塊最多一顆實心主色按鈕；選中狀態不用實心主色；同一列按鈕同一個尺寸 | 截圖審查；e2e 檢查結果卡、工具列、篩選列裡 `bg-primary` 的按鈕 ≤ 1 |
| A5 | **安靜**：同一個畫面最多一個完整的「AI 批改，僅供參考」；虛線只表示「空的或還沒有」；黃色只表示「注意」或「AI」 | 截圖審查：批改結果第一個畫面的 AI 標示 1 個橫幅＋小圖示 |
| A6 | **數字對齊**：表格的數字靠右、`tabular-nums`；同一列的統計同一種字級 | 截圖審查；單元測試檢查 `DataTable` 數字欄的 class |
| A7 | **深色有層次**：卡片邊界對背景 ≥ 1.5:1；一個畫面最多一塊亮紫色（主要按鈕） | 計算值見 §2.1；深色截圖審查 |

### 1.2 「人性化」在這個網站的意思：六件事

| # | 目標 | 例子 |
|---|---|---|
| H1 | **知道自己在哪** | 標題位置固定、返回連結一種樣式、側邊欄看得出層級、作答頁一直看得到「第 23 題」 |
| H2 | **知道下一步** | 每個結果頁、空白頁都有一個明確的主要按鈕；成績單列出最該練的 2–3 個題型 |
| H3 | **不怕按錯** | 會清除資料、會扣點、會結束考試的動作都要確認，**焦點預設在安全的那一邊**；誤按也能取消 |
| H4 | **看得到進度** | 題號格、矩陣的進度條、「已自動儲存 10:42」、批改排隊時可以先離開 |
| H5 | **少捲動、少找** | 題目和作答並排、篩選在旁邊、鍵盤可以作答、快捷鍵寫在按鈕上 |
| H6 | **說人話** | 不顯示「後端」「v0.0.0」；數字附單位（「已答 2／53 題」「選擇題 78／100 分」）；分數低時用中性的說法 |

### 1.3 不變的

| 項目 | 規則 |
|---|---|
| 手機與平板 | < 1024 px 逐像素不變（320、375、768 的截圖 0 差異），操作也不變。desktop-ui §2.1 的 R1–R11 全部沿用 |
| token 與主題 | 既有 token 的值在 < lg 不變；淺色、深色、跟隨系統三種狀態照舊；所有顏色用語意 token，不寫死色碼 |
| 文案 | 繁體中文、台灣用語；新文字不出現「大考中心」、CEEC、模型名稱；D8 |
| 無障礙 | 文字對比 ≥ 4.5:1、元件邊界 ≥ 3:1；全站焦點框不變（`outline 2px primary, offset 2px`）；鍵盤可操作；高對比模式下狀態仍看得出來（R11） |
| 其他 | 路由、資料、API、儲存格式不變；`modules.ts` 的 `PAGES`／`NAV_GROUPS`／`BOTTOM_NAV_PATHS` 不變；不加 npm 套件 |

**手機逐像素不變的做法**（補充 desktop-ui §2.1）：

- **M1 新 token 只新增**：`--line-strong`、`--shadow-card` 這類新變數放在 `:root`（三個主題區塊各自給值），只被 `lg:` 的 class 用到，手機的 CSS 結果完全相同。
- **M2 改既有 token 的值只在 ≥ lg**：深色的 `--line`、`--surface-2` 調深，寫在 `@media (width >= 64rem)` 裡，兩個深色區塊（`prefers-color-scheme` 與 `data-theme="dark"`）都要寫。手機的深色截圖（`01-home__anon-dark`、`08-reading__section-dark`）就是在驗這一點。
- **M3 不用 `dark:`**：在本 repo 的 Tailwind 4.3 編譯，`lg:dark:x` 輸出的是 `@media (prefers-color-scheme: dark)`（實測），使用者在設定頁手動切到深色時不會生效。深淺的差異一律寫成變數（例如 `--shadow-card` 在深色是 `none`）。
- **M4 共用樣式常數只加 `lg:` 的部分**：`primaryButton`、`fieldCls`、`textInput` 等常數的無前綴部分一字不改，桌機的統一樣式附加在後面。
- **M5 只加屬性的改動可以全寬度做**（R6）：`lang="en"`、`aria-labelledby`、`aria-describedby`、`ScrollRegion` 的 `tabIndex`／`role`。但 `lang` 可能影響字型挑選，所以照樣要跑手機截圖比對。
- **M6 行為差異包在 `useIsDesktop()`**（R7）。會改到手機行為的修正（例如歷屆清除確認）列在 §7，等站主決定。
- **M7 重截基準**：目前的手機基準是 a479469（desktop-ui §16.1），學習助手、單字講義等頁面是之後才加的，**開工前先用 `visual-baseline.sh 35ff807` 重截**，並補截本文要改的元件在手機上的狀態（§5.0）。

### 1.4 本文改寫 desktop-ui.md 的地方

| desktop-ui | 原本 | 改成 | 理由 |
|---|---|---|---|
| §2.3 內容寬度 | default 944 置中；list 整頁放寬置中；workspace 不設上限 | **一個框架**：寬 `min(main − 2×page-px, 82rem)`、置中；內容靠框架左緣。narrow 816、default 944、list 與 workspace 整個框架（§2.4） | H1 與返回連結在每一頁都從同一條左緣開始（A1）。現在 1440 寬有四個位置 |
| §2.3 `bleed` | 置中放寬 | 從框架左緣往右放寬到框架寬（寫法見 §2.4）；用法不變 | 同上；default 頁裡放寬的區塊和頁首同一條左緣 |
| §2.3 工作區 `--bleed-max:100cqw` | 1920 寬工作面 1,600 px | 一律 82rem（1920 寬 1,312 px） | 選文、作答框都有行長上限，多出的寬度只會變成空白；和列表頁同一條左緣 |
| §3.1 內容上下內距 | `lg:py-10`；工作區 `lg:py-4` | `lg:pt-8 lg:pb-12`；工作區 `lg:pt-6 lg:pb-6` | 兩種頁面的 H1 高度差從 24 px 降到 8 px；寫作工作區的高度公式改用變數（§3.12） |
| §3.2 側邊欄 | 一種密度；已登入帳號列一行 | 視窗內高 ≥ 800 px 時列高 36、分組間距加大；帳號列兩行（§3.1） | 1440×900、1920×1080 下方空著約 300 px；AI 狀態被截成「AI 批改…」 |
| §4.7 `StickyBar` | `bg-bg/95`、撐滿內容區 | `bg-surface/90`、撐滿 main（`bar-bleed`），和作答工具列同一種樣式（§2.13） | 兩種 sticky 列長得不一樣；1440 寬時是一條兩邊不靠的白帶 |
| §4.8 `DataTable` | 白色表頭、無 `nowrap` | §2.9 的表格規格（表頭 `whitespace-nowrap`、`bg-surface-2`） | 表頭「日／期」「配／分」一字一行 |
| §5.1 首頁 | 頁首 H1「學測英文中心」、繼續學習、全部功能 | 品牌名縮成眉標、問候當視覺標題；最上面一張「今天」卡；全部功能兩行說明（§3.2） | 首頁沒有回答「今天要做什麼」 |
| §5.3 題型頁頁首 | 說明 `lg:line-clamp-1`，全文放 `title` | 說明完整顯示，最多兩行（`max-w-[40rem]`），不靠 `title` | `title` 鍵盤與觸控看不到 |
| §6.5 送出確認 | 只有 Ctrl＋Enter 會先確認 | 另外，**有字數或段數提醒時**點按鈕也會先確認（§4.7） | 一天 20 點、作文一篇 7 點；字數不足還會被扣分 |
| §7.2 分割欄寬 | `[1.1fr_1fr]`；wide `[42rem_40rem]` | `[1.2fr_1fr]`，選文文字 `max-w-[62ch]`；wide 起選文 17 px（§3.5） | 82rem 框架下重新分配 |
| §7.2 行內選項面板 | 保留 | 有右側「選項」欄時，≥ lg 不開行內面板（P2，e2e 要跟著改，§3.5） | 同一個畫面兩組一模一樣的選項 |
| §9 首頁「今天要做什麼」 | 延後 | 做最小版：只讀本機的待複習數、錯題數、作答中的考卷；不做推薦規則 | 首頁最常被問的問題 |

---

## 2. 視覺規格

所有規格都只在 ≥ lg 生效（寫成 `lg:` 起的 class，或只在桌機樹裡用）。

### 2.1 token（`index.css`）

**新增**（`:root` 給淺色值，兩個深色區塊給深色值；`@theme inline` 映射成 Tailwind 顏色）：

| token | 淺色 | 深色 | 用途 | 對比（計算） |
|---|---|---|---|---|
| `--line-strong` | `#7d8794` | `#6b7686` | **只給互動元件的邊界**：輸入框、選單、文字框、未選中的篩選膠囊與難度、checkbox 卡片 | 淺：對 surface 3.64、bg 3.40、surface-2 3.22；深：對 surface 3.72、bg 4.05、新 surface-2 3.27 |
| `--line-subtle` | `#dde2e8` | `#2b3440` | 表格列分隔（深色保留舊的 `--line`，密集表格不會太重） | — |
| `--primary-hover` | `#283d8f` | `#b8c6ff` | 主要按鈕 hover | 按鈕字：淺 9.75、深 11.15 |
| `--shadow-card` | `0 1px 2px rgb(16 24 40 / .05), 0 1px 3px rgb(16 24 40 / .04)` | `none` | 可點的卡片 | — |
| `--shadow-card-hover` | `0 4px 12px rgb(16 24 40 / .08)` | `none` | 可點的卡片 hover | — |

**`@theme` 新增**（字級見 §2.2）：`--radius-card: 1rem`、`--radius-control: 0.625rem`、`--radius-nav: 0.5rem`（產生 `rounded-card` 等）；`--frame-max: 82rem` 放在 `:root`。

**只在 ≥ lg 調整的既有值**（M2）：

| token | 深色現值 | 深色 ≥ lg | 效果（計算） |
|---|---|---|---|
| `--line` | `#2b3440` | `#343e4b` | 卡片邊界對 surface 1.36 → 1.58、對 bg 1.48 → 1.72 |
| `--surface-2` | `#202731` | `#232b36` | 對 surface 1.14 → 1.20；muted 字在上面 5.79 |

淺色的 `--line`（1.30:1）不改：淺色的卡片分隔改靠陰影（只給可點的卡片）與 `--line-strong`（只給控制項）。

```css
/* index.css：新增在既有主題區塊之後 */
@media (width >= 64rem) {
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) { --line: #343e4b; --surface-2: #232b36; }
  }
  :root[data-theme='dark'] { --line: #343e4b; --surface-2: #232b36; }
}
```

### 2.2 字級

| token（`@theme --text-*`） | 大小／行高／字重 | 用在 | 取代的現況 |
|---|---|---|---|
| `text-title` | 1.75rem（28）／1.3／700 | 每一頁的 H1 | `lg:text-3xl`（30，23 處）、沒有 lg 覆寫的 `text-2xl`（24，17 處：`WritingListBar`、`CasePage`、`MockReportPage`、`ExamPaperPage`、404…） |
| `text-title-ws` | 1.5rem（24）／1.35／700 | 工作區頁的 H1（作答、寫作、案例、批改結果） | 同上 |
| `text-section` | 1.25rem（20）／1.45／600 | H2 區塊標題 | 18 px 600（43 處）、20 px 700（10 處）、16 px 600（8 處） |
| `text-card` | 1.0625rem（17）／1.5／600 | H3、卡片標題、右欄卡片標題 | 各自 |
| `text-body` | 1rem（16）／1.75 | 內文、中文題目、說明 | `text-[0.95rem]`（131 處，閱讀情境） |
| `text-passage` | 1rem／1.7；**wide 起** 1.0625rem（17）／1.8 | 英文選文、題幹、選項 | — |
| `text-meta` | 0.875rem（14）／1.6 | 次要資訊、表頭、欄位標籤、卡片 meta | `text-sm` 與 `text-[0.95rem]`（介面情境） |
| `text-xs` | 0.75rem（12）／1.5 | **下限**：標章、圖說、時間戳 | 0.65–0.7rem（7 處，10.4–11.2 px） |

- **不要用 `lg:text-base` 取代 `text-[0.95rem]`**：Tailwind 的 `text-base` 會一起把行高設成 1.5，現在的段落是繼承 `html` 的 1.7；用 `text-body`（自帶行高 1.75）。
- **中文標題 `lg:tracking-normal`**：`tracking-tight`（−0.025em）會把「115學年度學科能力測驗英文考科」「題庫練習」擠在一起；只有英文展示字（單字卡上的單字）保留。
- 字重：700 只給 H1 與統計數字；600 給 H2、H3、按鈕、選中狀態；其他 400。
- 數字一律 `tabular-nums`（分數、題數、時間、點數）。
- **不全面掃 131 處 `text-[0.95rem]` 與 181 處 `text-xs`**：只改共用元件（`InfoSection`、解析卡、表格、卡片常數）與這次碰到的元件，其他留到各自改版時順手改。

### 2.3 間距

以 4 px 為單位。

| 位置 | 非工作區（list、default、narrow） | 工作區 |
|---|---|---|
| 內容上緣／下緣 | `lg:pt-8`（32）／`lg:pb-12`（48） | `lg:pt-6`（24）／`lg:pb-6` |
| 頁首 → 第一個區塊 | 32（`lg:mb-8`） | 24 |
| 區塊之間 | 32（`lg:space-y-8`） | 24 |
| 主欄 ↔ 右欄 | 32（`lg:gap-8`），右欄 20rem（不變） | — |
| 分割的兩欄之間 | — | 32（閱讀）、24（寫作） |
| 卡片網格 | 16（`lg:gap-4`） | 16 |
| 卡片內距 | 區塊卡 24（`lg:p-6`）、列表卡 20（`lg:p-5`）、右欄卡 20 | 同左 |
| 卡片標題 → 內容 | 12（`lg:mt-3`） | 12 |
| 同一列的按鈕 | 8（`gap-2`） | 8 |
| 表單欄位之間 | 16（`lg:space-y-4`）；標籤 → 欄位 6 | 同左 |

### 2.4 版面框架與內容寬度

**框架**：寬 `min(main 內容寬 − 2 × --page-px, 82rem)`、在 main 裡置中。所有寬度模式的 `--page-px` 都是 2.5rem（工作區原本 2rem）。內容一律從框架左緣開始；各模式只決定內容的最大寬度。

```css
/* index.css */
@utility page-frame {            /* 內容容器（Layout）與頁尾都用 */
  --frame-w: min(100cqw - 2 * var(--page-px), var(--frame-max, 82rem));
  width: calc(var(--frame-w) + 2 * var(--page-px));
  margin-inline: calc((100cqw - var(--frame-w)) / 2 - var(--page-px)) auto;
}
@utility bleed {                 /* 改寫：靠左放寬到框架寬（原本置中） */
  width: min(100cqw - 2 * var(--page-px, 0px), var(--bleed-max, var(--frame-max, 82rem)));
  margin-inline-start: 0;
  margin-inline-end: calc(100% - min(100cqw - 2 * var(--page-px, 0px), var(--bleed-max, var(--frame-max, 82rem))));
}
@utility bar-bleed {             /* sticky 列：底色撐滿 main，內容對齊框架 */
  --frame-w: min(100cqw - 2 * var(--page-px), var(--frame-max, 82rem));
  width: 100cqw;
  margin-inline: calc((var(--frame-w) - 100cqw) / 2) 0;   /* 蓋過手機的 -mx-4 */
  padding-inline: calc((100cqw - var(--frame-w)) / 2);
}
```

這三個工具類在本 repo 的 Tailwind 4.3 編譯過，`lg:page-frame`、`lg:bar-bleed` 都輸出在 `@media (width >= 64rem)` 裡（實測）。`100cqw` 是 main（`@container/main`）的內容寬，和 desktop-ui §2.3 相同。

**內容容器的 class**（`lib/desktopLayout.ts` 的 `MODE_CLASSES`；基底 `mx-auto max-w-5xl px-4 py-6` 不動）：

| 模式 | ≥ lg | 內容最大寬 |
|---|---|---|
| narrow | `lg:[--page-px:2.5rem] lg:px-(--page-px) lg:page-frame lg:max-w-4xl lg:pt-8 lg:pb-12` | 51rem（816） |
| default | 同上，`lg:max-w-5xl` | 59rem（944） |
| list | 同上，`lg:max-w-none` | 框架寬 |
| workspace | 同上，`lg:max-w-none lg:pt-6 lg:pb-6` | 框架寬 |

- `page-frame` 自己設定寬度，現在內容容器上的 `lg:w-full` 拿掉（`lg:flex-1` 保留，頁尾照樣貼底）。
- 頁尾（`FOOTER_MODE_CLASSES`）用同一組 class，`nav` 的框線寬度等於該模式的內容寬，左緣和 H1 相同。
- 既有的 `bleed`（列表頁的桌機樹）照常運作：list 模式下它等於框架寬（不再需要），default 模式下從左緣放寬到框架寬。**拿掉** `Workspace.tsx:62` 的 `lg:[--bleed-max:100cqw]`。
- 現在的 `desktop-shell.spec`「`p`、`li` ≤ 60rem」照舊成立。

**路由模式的調整**：`/words`、`/assistant/report`、`/assistant/report/:version`、`/mock/report/:attemptId` 改成 `list`（都有兩欄或資料表）；`/assistant/ask` 從 `narrow` 改成 `workspace`（§3.14）。

**各寬度的實際尺寸**（側邊欄展開，捲軸槽 15 px，和截圖相同；Windows 傳統捲軸再少 2 px）：

| | 1366 | 1440 | 1920 |
|---|---|---|---|
| main 內容寬 | 1,095 | 1,169 | 1,649 |
| 框架（list、workspace 的內容寬） | 1,015 | 1,089 | 1,312 |
| **框架左緣＝H1 的 x** | **296** | **296** | **424** |
| narrow／default 內容寬 | 816／944 | 816／944 | 816／944 |
| sticky 列（撐滿 main） | 1,095 | 1,169 | 1,649 |
| 首頁、/practice、/writing：主欄＋右欄 | 663＋320 | 737＋320 | 960＋320 |
| 閱讀分割：選文／題目（§3.5） | 536／447 | 576／481 | 698（文字 ≤ 62ch）／582 |
| 寫作分割 1:1（§3.12） | 495／495 | 532／532 | 644／644 |

側邊欄收合時（4rem）1366 寬的框架是 1,207、左緣 x=104。

**行長上限**（不論容器多寬）：中文說明 `max-w-prose`（約 36–40 字）；頁首說明 `max-w-[40rem]`；英文選文 `max-w-[62ch]`（目標一行 60–75 個字元，實作後用盤點的量法再量）；作答框 `max-w-[72ch]`；中文題目與提示 `max-w-[40rem]`。

### 2.5 表面與卡片

| 表面 | 用途 |
|---|---|
| `bg` | 頁面底色 |
| `surface` | 卡片、sticky 列、對話框、**輸入框**（卡片上的輸入框也是 surface，不再是 `bg-bg` 的灰色） |
| `surface-2` | 表頭、可點列的 hover、分段控制的軌道、說明框（無框線）、骨架 |
| `primary-soft` | 選中、目前題、結果卡的頂端色帶 |

| 卡片 | ≥ lg 樣式 | 用在 |
|---|---|---|
| 可點卡片 | `rounded-card border border-line bg-surface shadow-(--shadow-card)`；hover `border-primary shadow-(--shadow-card-hover)`；右上角箭頭圖示 | 題目列表卡、繼續學習、矩陣格、入口卡、學習助手動作卡 |
| 區塊卡 | `rounded-card border border-line bg-surface p-6`，**沒有陰影** | `InfoSection`、表單、結果 |
| 右欄卡 | `rounded-card border border-line bg-surface p-5`；內容是列，`divide-y divide-line`；不放卡中卡 | 學習進度、AI 點數、最近寫作紀錄、三種難度給誰 |
| 說明框 | `rounded-control bg-surface-2 p-4`，無框線 | 現在的虛線說明框（`ModulePage.tsx` 的說明、`PracticeHome` 的註記） |
| 結果卡 | 區塊卡＋頂端 `bg-primary-soft/60` 色帶（標題列），1 px 框線 | 交卷結果、成績單總分、批改總分（取代 `border-2 border-primary`，6 處） |
| 空白 | 見 §2.14 | — |

- **陰影只給可點的東西**（淺色主題）：學生不用 hover 就知道哪些能點。深色主題陰影是 `none`，靠框線與箭頭。高對比模式會拿掉陰影，框線照樣在（R11）。
- **不做 hover 位移**（`-translate-y-px`）：位移會讓卡片裡的字在某些螢幕上抖動，陰影變化已經夠。
- **不放卡中卡**：右欄的「學習進度」現在是白卡裡三塊灰底小卡，各自有 hover 框；改成同一張卡裡的三列。真的要內層時，內層圓角＝外層圓角 − 內距，最少 6 px。
- 圓角：卡片 `rounded-card`（16）、控制項與選項卡 `rounded-control`（10）、側邊欄項目 `rounded-nav`（8）、按鈕與膠囊 `rounded-full`。只套在這次碰到的元件。

### 2.6 按鈕

新增 `components/ui/buttons.ts`，`btn(variant, size)` 回傳「原本手機的 class＋桌機的 class」。`writing/components/ui.tsx`、`vocab/ui/styles.ts`、`account/styles.ts`、`assistant/components/parts.tsx` 的按鈕常數改成從這裡 re-export，手機部分一字不改（M4），各處的 import 不用動。

| 尺寸 | ≥ lg | 用在 |
|---|---|---|
| `lg` | 高 44（`min-h-11`）、`px-5`、1rem／600 | 開始作答、空白頁唯一的動作、結果卡的主要動作 |
| `md`（預設） | 高 40（`min-h-10`）、`px-4`、0.9375rem／600 | 一般 |
| `sm` | 高 36（`h-9`）、`px-3.5`、0.875rem／600 | 工具列（交卷）、sticky 篩選列、表格列、右欄 |

| 樣式 | ≥ lg | 用在 |
|---|---|---|
| `primary` | `bg-primary text-on-primary`，hover `bg-(--primary-hover)` | 每個區塊**一個**主要動作 |
| `secondary` | `bg-surface border border-line-strong text-fg`，hover `border-primary text-primary` | 次要動作（問學習助手、下載 PDF、回到列表） |
| `ghost` | `text-primary`，hover `bg-primary-soft` | 第三順位、「看第 1 層提示」 |
| `danger` | `bg-bad text-on-primary`（字對比：淺 6.57、深 8.16） | 確認列裡的「確定清除」 |
| `danger-ghost` | `text-bad`，hover `bg-bad/10` | 觸發破壞性動作的按鈕（清除作答、刪除這一版） |

規則：
- 同一列按鈕**同一個尺寸**；主要動作在最前面（左邊），然後次要、第三順位；破壞性動作和其他按鈕分開（放到卡片底部右側或分隔線之後），用 `danger-ghost`。
- 停用時 `opacity-50 cursor-not-allowed`，並在旁邊寫原因（「超過上限，不能送 AI 批改」）。
- 處理中：按鈕文字換成「送出中…」、`aria-busy`，不換成只有轉圈。
- 有快捷鍵的按鈕：空間夠時旁邊顯示 `Kbd`，加 `aria-keyshortcuts`（desktop-ui §4.9）。
- 一律 `rounded-full`（沿用現況）。

### 2.7 表單控制項

新增 `components/ui/fields.ts`（`fieldCls`、`selectCls`、`textareaCls`、`labelCls`、`hintCls`、`fieldCompactCls`），五個既有常數改成從這裡 re-export：`writing/components/ui.tsx` 的 `textInput`、`vocab/ui/styles.ts` 的 `fieldCls`、`account/styles.ts` 的 `fieldCls`、`assistant/components/parts.tsx` 的 `inputCls`、`exams/components/Questions.tsx` 的 `textInputClass`。另外 `StartScreen.tsx:164` 的預估分數、`ExamList.tsx:184` 的學年度選單改用它們。

| 項目 | ≥ lg |
|---|---|
| 高度 | 一般 40（`min-h-10`）；sticky 篩選列裡的精簡版 36（`h-9`） |
| 外觀 | `rounded-control border border-line-strong bg-surface text-body`；選單和輸入框同一個形狀（學習報告的版本選單不再是膠囊） |
| 標籤 | 在欄位上方，`text-meta font-medium text-fg`，間距 6；sticky 篩選列裡可以是左邊的行內標籤（`text-meta text-muted`） |
| 說明 | `text-meta text-muted`，接在欄位下方，用 `aria-describedby` 連起來 |
| 錯誤 | 框線 `border-bad`＋`aria-invalid`；下方 `text-meta text-bad`＋`AlertCircle` 圖示的訊息 |
| 焦點 | 沿用全站焦點框；**外層卡片不再另外畫一圈**（現在作文框和它的卡片都會亮，看起來是兩層框） |
| 數字欄位 | `w-24 text-right tabular-nums` |
| checkbox／radio | 原生元件 18 px、`accent-color: var(--primary)`；做成卡片的時候框線 `line-strong`、選中 `border-primary bg-primary-soft`＋勾號 |

**作答選項卡（`Questions.tsx`）不換成 `line-strong`**：卡片裡有原生的 radio／checkbox，本身就有 ≥ 3:1 的邊界；每題 4–10 個選項都加深框線會讓試卷很吵（§6 第 1 點）。改成 hover `lg:hover:border-primary lg:hover:bg-primary-soft/40`、`cursor-pointer`。

### 2.8 選擇控制項：四種角色、四種樣式

現在至少有五種樣式（分段膠囊、篩選膠囊、兩行難度方塊、/words 卡片式分頁、底線分頁），而且「來源」和「篩選」在 `WritingListBar` 裡都是實心主色（`08-writing-essay-list__1440x900__dark`）。改成一個角色一種樣式：

| 角色 | 元件（新） | ≥ lg 樣式 | 語意 | 用在 |
|---|---|---|---|---|
| **換頁或換視圖** | `SubNav`；面板內的分頁沿用 `PaneTabs`，外觀相同 | 底線分頁：高 40、0.9375rem／600；目前：`text-primary`＋2 px 主色底框；其他：`text-muted`，hover `text-fg`；整列下方 1 px `border-line` | `<nav>`＋連結＋`aria-current="page"`；`PaneTabs` 是 `tablist` | `SourceTabs`（歷屆試題／本站仿真／自訂題目）、/words 分頁、/assistant/new（拍照／貼上）、案例頁（解析／追問） |
| **切換模式**（同一頁） | `Segmented` | 軌道 `bg-surface-2 p-1 rounded-full`；選中段 `bg-surface text-fg font-semibold shadow-sm border border-line-strong`；其他 `text-muted` | 沿用各元件現在的語意（`aria-pressed` 或 radio），不改 e2e | 打字作答／拍照上傳、寫作紀錄的中譯英／英文作文 |
| **篩選** | `ChoiceChip`（radio 或 checkbox） | 高 32、`px-3 rounded-full border border-line-strong bg-surface text-meta`；選中：`bg-primary-soft text-primary border-primary font-semibold`；**多選另加勾號圖示**（不只靠顏色） | 隱藏的 input＋label | /exams 考試別、`KindFilter`、`LevelPicker`、本站仿真列表、設定頁與帳號頁的 radio 卡、單字測驗與講義的選項 |
| **難度** | `TierPicker`（`size: 'tiles' \| 'compact'`） | 方塊：名稱＋組數＋已做幾組；未選 `bg-surface border-line-strong`；選中 `bg-primary-soft border-2 border-primary text-primary`＋勾號；出題中維持虛線 | 題型頁＝連結＋`aria-current`（換主要內容）；列表頁＝radio（篩選）；**沿用現在的語意** | 題型頁的難度切換、/translation 與 /composition 的本站仿真、`/writing/*/ai` |

- **實心主色只給主要按鈕**。深色主題下選中的膠囊與分頁是 `primary-soft` 底＋`primary` 字（對比 6.59），不再是一塊亮紫（A7）。
- **高對比模式**：選中一律 `forced-colors` 下的 `Highlight` 框（框線或底框），加上字重或勾號；膠囊沿用 desktop-ui §16.7 第 5 點的寫法（`Highlight` 底、`HighlightText` 字、`forced-color-adjust: none`、焦點框 `CanvasText`）。這也順便修好 §16.8 留下的「`SourceTabs` 與寫作紀錄的種類切換在高對比下看不出目前是哪一個」。
- 未選中的 hover：`lg:hover:border-primary lg:hover:text-primary`（只套在沒選中的，desktop-ui §16.6 第 10 點）。
- **難度控制不統一語意**：題型頁換難度是換整頁的主要內容（導覽），列表頁是篩選；兩種語意都正確，統一會改到 e2e 的選擇器（§6 第 12 點）。

### 2.9 表格

新增 `components/Table.tsx`：`ScrollRegion`（`overflow-x-auto`＋`tabIndex={0}`＋`role="region"`＋**必填**的 `aria-label`）與一組 class（`tableCls`、`thCls`、`tdCls`、`numCls`、`groupRowCls`）。`DataTable` 改用同一組 class。

| 項目 | 規格（≥ lg） |
|---|---|
| 表頭 | `bg-surface-2 text-meta font-semibold text-muted whitespace-nowrap py-2.5 px-3 border-b border-line`；`DataTable` 的 sticky 表頭同一個樣式（不透明） |
| 儲存格 | `py-2.5 px-3 border-b border-line-subtle text-body` |
| 第一欄 | 靠左；是主要連結時 `text-primary font-medium`，hover 底線 |
| 數字欄 | `text-right tabular-nums whitespace-nowrap`，固定寬（`w-20`／`w-24`） |
| 短文字欄（狀態、日期、來源） | `whitespace-nowrap`＋最小寬（`min-w-[6rem]`） |
| 長文字欄 | `line-clamp-2`，全文放在可聚焦的提示或展開，不只靠 `title` |
| 分組列 | `bg-surface-2 text-meta font-semibold` |
| 可點的列 | hover `bg-surface-2`；`DataTable` 每列一個主要連結的規則不變 |
| 外框 | 放在區塊卡裡，或 `rounded-card border border-line overflow-hidden` |
| 寬度 | 4 欄以內的簡單表格 `lg:max-w-[40rem]`（大題結構、中譯英分數表、配分表）；資料表撐滿 |
| 排序圖示 | `text-muted`（拿掉 `opacity-50`，現在約 2:1） |

會水平捲動的表格一律包 `ScrollRegion`。目前沒有包、鍵盤捲不到的五處（`SectionTargetsTable.tsx:15`、`ReportGeneratePanel.tsx:83`、`AiApplyPage.tsx:171`、`MockExamPage.tsx:130`、`UsageSection.tsx:118、148`）先改，這是只加屬性的改動（M5）。

### 2.10 標章與 AI 標示

新增 `components/Badge.tsx`（`tone`、`size: 'xs' | 'sm'`），14 個具名標章改成包它；兩個同名的 `ProgressBadge` 改名 `ExamProgressBadge`、`BankProgressBadge`。

| tone | 樣式 | 圖示 | 用在 |
|---|---|---|---|
| neutral | `bg-surface-2 text-muted` | — | 題數、類型 |
| primary | `bg-primary-soft text-primary` | — | 新制、本站仿真、上次、建議 |
| ok | `bg-ok/12 text-ok` | `CheckCircle2` | 已完成、答對 |
| bad | `bg-bad/10 text-bad` | `XCircle` | 答錯、失敗 |
| warn | `bg-badge-bg text-badge-fg` | `AlertTriangle` | 補考、沿用題提醒、注意 |
| ai | `bg-badge-bg text-badge-fg` | `Sparkles` | AI 出題、AI 批改、學習助手 |

- 尺寸：`xs` 高 20、`px-2`、`text-xs` 600；`sm` 高 24、`px-2.5`、`text-meta` 600。
- **狀態標章一定有文字或圖示**，不只靠顏色。
- **AI 標示**：`AiBadge`、`AiGroupBadge`、`AiNoticeBadge` 合成一個 `AiBadge`（`variant: 'grading' | 'assistant' | 'generated'`）。頁面已經有 `AiNotice` 橫幅時，區塊標題旁改用 `AiBadge compact`（圖示＋「AI」，完整文字在 `sr-only`），SPEC §8.4「每個 AI 輸出旁都有標示」照樣成立。

### 2.11 圖示

- 只用 Lucide。尺寸：16（和 `text-meta` 並排、`sm` 按鈕）、18（`md`／`lg` 按鈕）、20（側邊欄、列表列）、22（40 px 頁面圖示方塊裡）。
- 裝飾用的 `aria-hidden`；表示狀態的圖示一定搭配文字。
- 介面不用 emoji（審查意見裡的 💡 改用 `Lightbulb`）。
- 原生 `<details>` 的 ▶ 換成 `ChevronDown`（§2.12）。

### 2.12 揭露（`<details>`）

新增 `components/Disclosure.tsx`（兩種）：

- **區塊**：`summary` 在 ≥ lg 為 `list-none`、隱藏原生標記（`[&::-webkit-details-marker]:hidden`）、`flex items-center justify-between min-h-11 font-semibold cursor-pointer`；右邊 `ChevronDown`（16、`text-muted`），展開時轉 180°（`group-open:rotate-180`，`motion-safe` 才有轉場）。
- **行內「更多」**：`text-primary`，箭頭在左，收合時 −90°、展開時 0°。

全站 38 個 `<details>` 不一次改完：先改這次碰到的（批改結果的「題目」、/writing 右欄的「兩種批改方式」、單字卡的「其他詞性與專業領域的釋義」、學習助手的「點數怎麼算」、評分者表）。

### 2.13 sticky 列、工具列與浮層

- **同一種 sticky 列**：`StickyBar`、`ExamToolbar`、`MockToolbar` 在 ≥ lg 都是 `lg:bar-bleed lg:bg-surface/90 lg:backdrop-blur lg:border-b lg:border-line lg:py-2.5`，控制項高 36。底色撐滿 main（從側邊欄右緣到視窗右緣），內容對齊框架（§2.4）。高度寫進 `--sticky-bar-h`／`--session-bar-h` 的機制不變。現在的 `lg:-mx-(--page-px) lg:px-(--page-px)` 拿掉。
- **寫作題目列表的 sticky 列只放分頁與篩選**：返回連結、H1、說明移到列外面（§3.11），`collapseFirstLine` 不再需要。
- **對話框**：新增 `components/desktop/Dialog.tsx`（標題列＋右上角關閉按鈕〔`aria-label="關閉"`〕、可捲動的內容、**固定在底部的動作列**〔`border-t bg-surface`〕、`border border-line shadow-lg`、遮罩 `/40`），`ShortcutHelp`、模擬考的 `SubmitDialog`（桌機）、Layout 的說明載入失敗對話框共用。
- 下拉面板、選單、提示泡泡照 R11：`border border-line bg-surface shadow-lg`。

### 2.14 空白、載入、錯誤

| 狀態 | 規格（≥ lg） |
|---|---|
| **空白** | `rounded-card border border-dashed border-line p-8 text-center`：40 px 的 `surface-2` 圓形裡一個 24 px 圖示 → 一行標題（`text-card`）→ 一句說明這裡會出現什麼、怎麼產生（`text-meta text-muted`）→ **一個**按鈕（頁面上唯一的動作時用 `primary`，否則 `secondary`）。虛線**只用在這裡**和「出題中」 |
| **載入** | 骨架先佔好最終的高度（`bg-surface-2 rounded-control animate-pulse motion-reduce:animate-none`），載入完不推動版面；超過 1 秒才出現 `role="status"` 的「正在載入…」 |
| **錯誤** | `rounded-control border border-bad/30 bg-bad/8 p-4`＋`AlertCircle`：①發生什麼（白話）②什麼仍然可以用 ③「再試一次」（`secondary sm`）。不顯示錯誤碼、HTTP、「後端」 |
| **伺服器連不上**（首頁） | 「目前連不上網站伺服器：AI 批改與學習助手暫時不能用，單字、題庫練習、歷屆試題照常可以用。」＋「重新檢查」 |

### 2.15 動態

- 只有：hover 的顏色與陰影、揭露箭頭的旋轉、作答回饋的閃爍（desktop-ui §7.3），都在 150 ms 內。
- `prefers-reduced-motion: reduce` 時：不平滑捲動、不閃爍、不 pulse；所有程式捲動走 `components/desktop/scroll.ts`。現在繞過它的兩處（`PracticeSession.tsx:345`、`BankReview.tsx:115` 的 `behavior: 'smooth'`）在桌機改用 `scrollAndFocus`；`BackendStatus` 的 `animate-pulse` 在桌機加 `lg:motion-reduce:animate-none`（手機一起修見 §7）。

---

## 3. 逐頁改善

每一組：**現況**（截圖）→ **改成** → PR。只寫和 §2 通用規格不同、或這一頁特有的部分。

### 3.1 殼層：側邊欄、頁首、返回連結、頁尾（全站）

**現況**
- 1440 寬時 H1 左緣在五個位置：列表頁 x=296、工作區 361、/words 與 /assistant 與 /mock/report 369、/settings 與 /about 433、案例頁 288；上緣列表頁 y≈40、工作區 y≈16（`17-assistant-home__1440x900`、`17-assistant-case-analysis__1440x900`）。/assistant 的頁尾框線是 296–1385，內容卻是 369–1313。
- 頁首有四種寫法（`ModulePage` 的 `PageHeader`、學習助手的 `AssistHeader`、帳號的 `pageTitleCls`、各作答頁自己寫的眉標＋H1）；返回連結有六種寫法，文字沒有規則（「歷屆試題列表」「學習助手」「回到學習助手」「返回」）；返回連結到 H1 的距離 36 px（`/writing/essay/:id`）到 65 px（`/assistant/report`）。
- 側邊欄分組標題上下只有 4／2 px，看起來和上一組黏在一起；1440×900、1920×1080 下方空著約 300 px（`01-home-anon__1440x900`）。
- 已登入的帳號列在每種寬度都截成「AI 批改…」，暱稱只剩約 50 px（`00-shell-account-menu__1366x768`）。
- 收合的圖示欄每項約 24 px、品牌標誌不見了（`00-shell-sidebar-collapsed__1440x900`）。
- 分組標題是一般的 `<p>`，和下面的清單沒有關聯，讀屏聽到的是 14 個平鋪的連結。

**改成**
- **框架**（§2.4）：所有頁面 H1 的左緣相同；頁尾 `nav` 左緣和 H1 相同。
- **兩種頁首**（新 `components/PageHeader.tsx`，取代上面四種）：
  - **A 模組頁**（每個側邊欄目的地，含 /assistant、/account、/settings）：40 px 圖示方塊（`rounded-xl bg-primary-soft`、圖示 22）＋`text-title` H1＋說明（`text-body text-muted max-w-[40rem]`，不截斷）。下方 32 px 接第一個區塊。
  - **B 子頁**：返回連結 → 8 → 眉標（選填，`text-meta text-muted`，例如「115 學測・新制」）→ 4 → H1（工作區 `text-title-ws`）→ 4 → meta 一行（選填）。
  - 插槽：`back`、`eyebrow`、`title`、`icon`、`summary`、`meta`、`actions`（≥ lg 右側，desktop-ui §16.5 第 10 點的寫法）。
- **返回連結**（新 `components/BackLink.tsx`，`writing/components/ui.tsx` 的 `BackLink` re-export 它；另有 `as="button"` 給單字卡、講義這種要保留捲動位置的覆蓋頁）：`ChevronLeft` 16＋`text-meta text-muted`，hover `text-primary` 加底線；文字＝上一層的頁名（和側邊欄或列表的 H1 相同）：歷屆試題、模擬考、題庫練習、寫作練習、學習助手、單字庫。
- **側邊欄**（`components/Layout.tsx`）：
  - 視窗內高 ≥ 800 px（`[@media(min-height:50rem)]`）時：每項 36 px（`py-1.5`）、分組標題 `pt-3 pb-1`（第一組 `pt-1`）；矮視窗維持現在的密度，1366×640 不用捲的預算（desktop-ui §3.2）不變。設計值：清單 489 → 約 632 px，1440×800 未登入可用 648、已登入 661，都不用捲。
  - 分組標題加 `id`，清單 `aria-labelledby`（讀屏聽到「清單，選擇題型，7 項」）。
  - 層級：「選擇題型」裡六個題型縮排（`pl-9`＋左側 1 px 導引線）、字色 `text-muted`，看得出是「題庫練習」底下的入口；「混合題與非選擇題」裡把「寫作」排在「中譯英」「英文作文」前面、後兩者縮排。`modules.ts` 不動，只改桌機 `Sidebar` 的排法。
  - 目前項：保留 3 px 色條與底色，另加 `font-semibold`；圖示不換色。
  - **帳號列改成兩行**：第一行整列是帳號按鈕（高 44；頭像 28、暱稱 14 px／600、狀態＝色點＋短字「AI 已核准」「AI 審核中」「AI 未申請」，256 px 寬不截斷）；第二行四顆圖示（`justify-around`、36 px）。已登入的高度 51 → 約 91 px，1366×640 時清單仍有 501 ≥ 489 px（不用捲）。帳號按鈕的可存取名稱加上狀態（「小明，AI 已核准（帳號選單）」）。剩餘點數在帳號選單與首頁看，側邊欄不另外打 API。
  - 收合：≥ 800 px 高時每項 32 px（`py-1.5`）、分組分隔線 `my-2`、品牌列在展開鈕上方放 28 px 的標誌（連到首頁）；矮視窗不變。
- **頁尾**：`page-frame`，框線寬＝該模式的內容寬。
- 驗收見 §5.2（PR 2）。

### 3.2 首頁 `/`

**現況**
- H1「學測英文中心」和側邊欄的品牌名重複，真正有溫度的「小明，今天練什麼？」是一行小字（`01-home-student-history__1440x900`）。
- 頁首問「今天練什麼」，主欄卻沒有答案：待辦（今日待複習 1 個字、單字錯題本 2 個）藏在右欄的統計卡裡，看起來像數據不像任務。
- 「繼續學習」只有一張卡時佔半欄，旁邊空 360 px；「全部功能」14 項的說明都 `line-clamp-1`，1920 寬時約 10 個字就被截斷（「AI 出題、通過自動驗證…」），wide 時四欄「單字」只有 1 項、「選擇題型」7 項，留下一大塊 L 形空白（`01-home-student-history__1920x1080`）。
- 右欄是卡中卡（白卡裡三塊灰底小卡）；最底下對學生顯示「後端已連線（gsat-english-api v0.0.0-audit）」（`01-home-anon__1366x768`）。
- 沒有任何紀錄的新同學沒有「從哪裡開始」的引導（`01-home-student-fresh__1366x768`）。

**改成**（`pages/HomePage.tsx`、`features/home/DesktopDashboard.tsx`）
- **頁首**：H1 照樣是「學測英文中心」（e2e 依賴這個名稱），樣式改成 `text-meta text-muted` 的眉標；下面是問候「小明，今天練什麼？」（未登入：「今天練什麼？」），`text-title`、一般段落。DOM 順序就是 H1 在前，不需要 `flex-col-reverse`。頁首的說明句拿掉（和側邊欄、全部功能重複）。
- **主欄第一張卡「今天」**（只讀本機資料，不打 API、不下載 `/data/`，`overview.spec.ts:159–168`）：
  - 每一列：圖示＋一句話＋一顆按鈕。
  - 「複習 1 個單字（約 1 分鐘）」→［開始複習］`/words?tab=study`；做完時顯示「✓ 今天的單字複習做完了」（勾號是圖示）。
  - 「單字錯題本有 2 個字」→［去複習］`/words?tab=mistakes`（0 個時不顯示）。
  - 下方小標題「繼續學習」（保留這個標題）：作答中的考卷、模擬考、題組、寫作草稿，每項一列（標題、進度、更新時間、［繼續］），最多 4 列。一項的時候也是整列，不再是半欄的卡片。
  - 數字來源和右欄的「學習進度」相同（`ProgressStats` 已經在算），不重複計算。
- **沒有任何紀錄時**改成「從這裡開始」三步驟：①每日學習 10 個字 ②選一個題型做一組「穩定基礎」③週末做一份模擬考；每一步一顆按鈕，做過的步驟打勾（依本機有沒有單字進度、題庫練習紀錄、模擬考紀錄判斷）。
- **全部功能**：照樣列出 14 項、照樣在最後；說明改成桌機專用的短說明（新檔 `features/home/navSummaries.ts`，每項 ≤ 22 字、不含「大考中心」，例如「單句四選一，練詞義與搭配」「計時整份模考，換算級分（非官方）」；完整說明照樣是連結的描述），兩行內不截斷；wide 寬度改成 `columns-3`＋`break-inside-avoid`（「單字」和「實戰」同一欄），欄高平均。
- **右欄**：三張扁平的右欄卡（§2.5）。學習進度改成三列（左：標籤 15 px；右：數字 `text-[1.25rem]` 700 tabular；下：說明 `text-meta text-muted`；整列 hover `bg-surface-2`）；空白狀態一句話＋一顆 `sm secondary`。AI 點數的細條 8 px、軌道 `bg-line`，三個重置時間併成一行註腳。
- **伺服器狀態**：連線正常時**不顯示**；連不上時在主欄最上面顯示 §2.14 的錯誤框，保留「重新檢查」。`smoke.spec.ts:137–141` 的桌機斷言改成新文字（手機的 `BackendStatus` 不變，手機斷言不動）。
- PR 5。

### 3.3 題庫練習 `/practice`

**現況**（`03-practice-menu-records__1440x900`）
- 18 格都是淡藍底＋半透明主色框，這通常代表「選中」；做過的格（「已做 1・20%」）和沒做過的（「還沒做」）長得一樣；hover 反而變淡。
- 進度是 12 px 的灰字；題型欄的說明換行，列高 81／91 px 不齊。
- 沒有建議的起點，也沒有「上次做到哪」；答對率高低看起來一樣。

**改成**（`features/practice/PracticeHome.tsx`；可存取名稱「詞彙題・穩定基礎：25 組，已做 3 組」一字不改，新文字放 `aria-describedby`）
- 格子是可點卡片（§2.5）：`bg-surface border-line shadow-(--shadow-card)`，hover `border-primary bg-primary-soft/40`。
- 內容：第一行「15 組」（1.125rem／700、tabular）；第二行做過時是 4 px 進度條（軌道 `bg-line`、填色 `bg-primary`，已做／總組數）＋「已做 3・答對 72%」（`text-meta`），沒做過時「還沒做」（`text-muted`）。
- 做過的格左邊 4 px 主色框（`border-l-4 border-l-primary`，框線在高對比下看得到）。
- 答對率加文字等級：< 50%「再加強」、≥ 80%「可以挑戰進階」（超越頂標那欄是「穩了」），不只靠顏色。
- 上次練習的那一格加「上次」標章（primary）。
- 完全沒有紀錄時，「穩定基礎」欄的表頭加「建議從這裡開始」標章。
- 題型欄 `w-[15rem]`、說明 `lg:line-clamp-2`，每列固定 `lg:h-[5.5rem]`。
- 右欄「三種難度給誰」改成扁平右欄卡；「AI 題目怎麼來的」改成 `Disclosure`（預設收起），第一個畫面多出約 300 px。
- PR 3。

### 3.4 題型頁 `/vocabulary`、`/cloze`、`/word-bank`、`/structure`、`/reading`、`/mixed`（頁首）

**現況**：說明 `lg:line-clamp-1`，「長文、圖表、表格與多文本閱讀，每篇四題單選；題材多與聯合國永續…」被截斷，右邊還空著 300 多 px（`04-section-reading__1440x900`）；難度方塊未選中的也是淡藍底（`04-section-vocabulary__1440x900`）；虛線的說明框與提示框到處都是。

**改成**
- 頁首 grid：`lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-6`，左邊模組頁首（說明兩行內、`max-w-[40rem]`、不截斷），右邊 `TierPicker size="tiles"`。現在用絕對定位放難度切換、頁首右邊留 `lg:pr-[27.5rem]` 的寫法（desktop-ui §16.6 第 1 點）改掉；DOM 順序不變。
- 頁首與作答區照框架寬（不再需要 `bleed`）；`InfoSection` 維持 944（default 寬），靠左。
- 說明框改成 §2.5 的「說明框」（無虛線）。
- PR 2（頁首與難度方塊）、PR 3（作答區）。

### 3.5 作答頁：題庫練習、歷屆試卷、模擬考

**現況**
- 作答區 944–960 px 寬；1920 時閱讀頁左右各空 344／327 px，選文與題目各約 466 px，選文約 55 個字元一行，一篇長文要 3–4 個畫面（`04-section-reading__1920x1080`、`05-practice-session-reading-start__1920x1080`）。
- 沒有一直看得到的題號導覽：歷屆整份 53–66 題在一頁（16,694 px），大題膠囊不 sticky、不顯示每個大題答了幾題；模擬考的大題導覽與題號面板會捲走，展開時把試卷往下推（`12-exam-paper-exam-midway-word-bank__1366x768`、`14-mock-paper-midway__1366x768`）。
- 沒有鍵盤作答：在作答頁按 ? 只看到「這一頁沒有專用的快捷鍵」（`00-shell-shortcut-help__1366x768`）。
- 文意選填：有空格的行距 29 px、沒有的 26 px，選文看起來一跳一跳（`05-practice-session-word-bank-midway__1440x900`）；點空格後行內又開一組一模一樣的 10 個選項，和右側「選項」欄相距 560 px。
- 每一題下面都有一個 62 px 的虛線「提示 0／3 層」框，10 題就是 10 個虛線框（`04-section-vocabulary__1440x900`）。
- 題組最後一題答完，底部沒有交卷的動作，要回到右上角找（`05-practice-session-reading-midway__1366x768__full`）。
- 計時中側邊欄全開，15 個連結一點就離開，沒有任何提醒；模擬考的時間照走（`14-mock-paper-midway__1366x768`）。
- 選文、題幹、選項沒有 `lang="en"`，讀屏用中文語音念英文（`05-practice-session-reading-midway__1440x900`）。
- 工具列是 1440 寬時 x=329–1353 的一條白帶，兩邊不靠任何東西；深色時是一塊略亮、沒有邊的長方形（`05-practice-session-reading-midway__1440x900__dark`）。

**改成**（照 desktop-ui §7、§8 實作，以下是補充與修正）
- **題號列**（desktop-ui §7.1，`SessionNavRow`、`QuestionGrid`）：照原設計。歷屆與模擬考共用同一個大題膠囊（`features/exams/components/SectionNav.tsx`，`mode: 'scroll' | 'switch'`，顯示「已答／題數」與旗子）；`Paper.tsx` 的 `SectionNav` 與模擬考的 `SectionNavigator`、`QuestionPalette` 在 ≥ lg `lg:hidden`。
- **工具列**：§2.13 的 sticky 列樣式；「交卷」是 `sm primary`（36 px），和其他控制項同高。
- **分割作答**（取代 desktop-ui §7.2 的欄寬）：
  - 有選文的題組（閱讀、混合、綜合測驗）：lg 起 `grid-cols-2 gap-6`（不變）；ws 起 `lg:@ws/main:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:@ws/main:gap-8`。選文文字 `max-w-[62ch]`；wide 起 `text-passage`（17 px／1.8）。尺寸見 §2.4 的表；驗收：1366、1440、1920 三種寬度的選文每行 60–75 個字元（設計值）。
  - 選文面板 sticky 的寫法照 desktop-ui §7.2（`top` 依 `--session-bar-h`）；**題目欄不 sticky**（§6 第 6 點）。
  - 文意選填、篇章結構：ws 起選項欄 24rem（篇章 26rem）。
  - 詞彙題：一欄，題目卡 `max-w-3xl`，短選項一列四個（desktop-ui §7.2）。
- **文意選填的行距**：`BlankGroups.tsx` 的 `slotClass` 在 ≥ lg 加 `lg:py-0 lg:leading-[1.35] lg:align-[0.05em]`，空格約 22 px 高、放得進 26 px 的行；驗收：選文每一行的行距相同（±1 px）。
- **文意選填不再出現兩組選項**（P2，放在題號列與目前題之後做）：≥ lg 有右側「選項」欄時，點空格只設定「目前空格」並把焦點移到選項欄第一個沒用過的選項，**不開行內面板**；選項欄標題改成「目前空格：第 4 題」，`bg-primary-soft`。行內面板留給手機（`useIsDesktop()` 分支，R3／R7）。會影響 `exams.spec.ts:72–77`、`mock.spec.ts:80–86`、`practice.spec.ts:115` 在 desktop project 的作答方式，改成從選項欄作答（手機的斷言不動）。
- **提示**（`HintLadder.tsx`）：≥ lg 不是框，是選項下方的一行（`lg:border-0 lg:bg-transparent lg:p-0 lg:pt-1`）：`Lightbulb` 圖示＋`ghost sm`「看第 1 層提示」；打開的提示是 `bg-badge-bg/50 rounded-control px-3 py-2 border-l-2 border-badge-fg` 的提示框。
- **選項卡**：hover 樣式（§2.7）；目前題的外框照 desktop-ui §7.3。
- **最後一題下方的交卷列**（`PracticeSession.tsx`，題庫練習與題型頁）：全部答完時「全部答完了！」＋`md primary`「交卷看解析」；還有未答時「還有 2 題沒答，也可以先交卷」＋`md secondary`「交卷」。按下後走工具列同一個確認流程。
- **目前題與鍵盤**：desktop-ui §7.3、§7.4、§8 照原設計（`CurrentQuestion.ts`、`useSessionHotkeys.ts`；1–4／A–J 只作答看得到的目前題、N／P 焦點放在題目標題、M 標記、H 下一層提示、每次作答有閃爍與 `aria-live` 播報）。`ShortcutHelp` 的「這一頁」列出這些按鍵。
- **專心作答**（模擬考作答中、歷屆考試模式作答中）：使用者沒有自己設定過側邊欄時，自動收合成圖示欄（不寫進設定，交卷或離開後恢復）；工作區路由寬度不夠時的自動收合（desktop-ui §3.2）照舊。點側邊欄或頁尾的站內連結時先問（PR 1，§4.7）。
- **`lang="en"`**（PR 1）：選文、題幹、選項文字、文意選填的選項與空格加 `lang="en"`；裡面的中文（題號、「已用於第 N 題」）加 `lang="zh-Hant-TW"`；`RichText` 加 `lang` prop。
- PR 3（`lang`、離開確認在 PR 1）。

### 3.6 交卷後：題庫練習結果、歷屆交卷結果

**現況**
- 題庫練習交卷結果只有答對、得分、用時與「再一組」「回到題庫練習」；看不到哪幾題錯、哪幾題沒答、哪幾題用了提示，要往下捲過 7,992 px（閱讀）到 14,703 px（文意選填）一題一題找（`05-practice-session-word-bank-result__1366x768`）。0／10 時主要按鈕仍是同難度的「再一組」；下方另有一顆同樣實心的「問學習助手」在搶。
- 結果卡用 `border-2 border-primary`，是全站最重的框；答對 36 px、得分與用時 24 px，三種大小（`05-practice-session-reading-result__1440x900`）。
- 歷屆交卷結果裡唯一的按鈕是「清除作答，重新開始」，按一下就清掉交卷結果、逐題檢討和列表上的「已交卷」紀錄，沒有確認（`SessionPanels.tsx:219–222`、`ExamPaperPage.tsx:154、175–179`；`12-exam-paper-exam-submitted__1366x768`）。
- 非選擇題 34 分只有一句純文字「中譯英與作文可以到「寫作練習」請 AI 批改」，不是連結。

**改成**
- **`StatBlock`**（新，`features/practice/components/StatBlock.tsx`）：標籤 13 px `text-muted`、數值 2rem／700 tabular、單位 1rem `text-muted`；同一列的統計同一個大小，主角（得分）可以 2.5rem。題庫練習、歷屆交卷、模擬考成績單、自組卷成績單都用它。
- **結果卡**：§2.5 的結果卡（頂端 `primary-soft` 色帶，1 px 框）。
- **題號格**（桌機）：結果卡裡一列小方格，每題一格：答對 `Check`、答錯 `X`、未答 `Minus`、用過提示另加 `Lightbulb`；顏色＋圖示＋`sr-only` 文字。點了用 `scrollAndFocus` 捲到那一題的解析卡。旁邊「從第一題錯題開始看」。
- **一句建議＋一個主要按鈕**（只用本機的答對率）：
  - < 50%：「先看完解析，再試一組穩定基礎」；主要按鈕「從第一題錯題開始看」，次要「換穩定基礎再練一組」（已經是穩定基礎時是「再一組」）。
  - 50–79%：「再一組同難度鞏固」；主要「再一組」。
  - ≥ 80%：「可以挑戰下一個難度」；主要「挑戰進階練習」（超越頂標時是「再一組」）。
  - 動作列＝［主要］［問學習助手（`secondary`）］［回到題庫練習（`ghost`）］，同一個尺寸。原本卡片外面那顆實心的「問學習助手」（`AskGroupLink variant="primary"`）移進來。
- **歷屆交卷結果**（`SessionPanels.tsx`）：
  - 「清除作答，重新開始」改成卡片底部右側的 `danger-ghost` 文字按鈕，按下後就地確認：「確定要清除這份考卷的作答與成績嗎？清除後無法復原。」［取消］［確定清除］，**焦點在「取消」**（PR 1）。現在作答中的 `ClearControl` 把焦點放在「確定清除」，一起改。
  - 原本的位置換成正向的動作列：［從第一題錯題開始檢討（`primary`）］［把錯題交給學習助手（`secondary`，`/assistant/mistakes?source=exam`）］［回歷屆試題列表（`ghost`）］（PR 3）。
  - 非選擇題那段在桌機改成兩個連結：「批改這份的中譯英（3 點）」→ `/writing/translation/:examId`、「批改這份的英文作文（7 點）」→ `/writing/essay/:examId`，沿用模擬考的 `writingHandoff` 帶入作答；文字用 `hidden lg:inline` 的另一句（手機原句不變）。AI 未開放時維持原文字。
- PR 1（清除確認）、PR 3（其餘）。

### 3.7 模擬考：開考前、交卷確認、成績單

**現況**
- 開考前「你覺得這次會考幾分？」的輸入框是一塊灰色色塊，沒有看得到的邊（`14-mock-paper-start__1440x900`）；大題結構表的數字靠左、散在 920 px 寬裡。
- **交卷確認對話框**：未作答題號全部列成 44 px 方塊，還有 50 題沒答時，1366×768 的對話框整個被題號佔滿，「確定交卷」「繼續作答」在對話框捲動區的最下面看不到；焦點用 `preventScroll` 放在看不到的「繼續作答」上（WCAG 2.4.11）；沒有關閉按鈕；說明只寫「還有 50 題沒有作答」，沒提到標記與剩餘時間（`14-mock-paper-submit-dialog__1366x768`；`SubmitDialog.tsx:40–41、86、115–122`）。
- **成績單**：歷屆卷沒有「下一步建議」（本站自組卷有，`tierAdvice.ts`）；「再做一次／回模擬考列表」在 3,773 px 頁面的最底部；大題名稱不能點去練；分數低時整頁都是負面框架：「你預估 60 分，實得 2 分（−58）」、整欄「你 − 全國 −11.92」、「約贏過 0% 的到考考生」（`15-mock-report__1366x768__full`）。「2／100」與「1 級分」又是兩種數字樣式（`15-mock-report__1440x900`）。

**改成**
- 開考前：表單規格（§2.7）；大題結構表用 §2.9（數字靠右、`lg:max-w-[40rem]`）。PR 2。
- **交卷確認對話框**（PR 1，`SubmitDialog.tsx`，只加 `lg:` class 與桌機分支）：
  - 動作列固定在對話框底部：`lg:sticky lg:bottom-0 lg:-mx-5 lg:-mb-5 lg:mt-2 lg:border-t lg:border-line lg:bg-surface lg:px-5 lg:py-3`，打開時一定看得到焦點所在的「繼續作答」。
  - 右上角關閉按鈕；`lg:shadow-lg`（R11）。
  - 說明：「還有 50 題沒有作答、標記 1 題；剩餘時間 1:40:00。交卷後就不能再修改答案。」
  - 題號方塊 `lg:min-h-9 lg:min-w-9`；一個大題超過 10 題沒答時收成「詞彙題：第 3–10 題（8 題）」，可展開。
  - PR 2 之後改用共用的 `Dialog`（§2.13）。
- **成績單**（PR 3，`MockReportPage.tsx`、`SectionTable.tsx`、`LevelCard.tsx`）：
  - 頁首右邊放一份動作列（再做一次、回模擬考列表），頁尾的保留。
  - 總分卡下方加「下一步建議」：依各大題得分率排序，列出最弱的 2–3 個題型，各自連到 `/practice/:section/:tier`；難度依級分：< 11 級分「穩定基礎」、11–12「進階練習」、≥ 13「超越頂標」（三種難度的定義，`PracticeHome`）；中譯英、作文連到「批改這份的中譯英／作文」。句型沿用 `BankReport`。
  - 各大題表的大題名稱連到該題型頁；表格用 §2.9。
  - **中性說法**（桌機）：「比全國平均少 3.7 分」「比全國平均多 1.2 分」取代「−3.7」；「贏過」是 0% 時不顯示，改寫「先把詞彙與綜合測驗練起來，最快能拉分」；預估與實得的差距寫「比預估少 58 分」。手機的 `LevelCard` 文字不變（要一起改見 §7）。
  - 數字一律 `StatBlock`。
- PR 1（對話框）、PR 2（開考前表單與表格）、PR 3（成績單）。

### 3.8 歷屆試題列表 `/exams`

**現況**（`11-exams-list__1920x1080`、`11-exams-list-records__1366x768`）
- 「全國答對率」欄 66 列都寫「有」，佔 112 px。
- 「我的進度」是 48×6 px 的細條，軌道 `bg-surface-2` 對白底只有 1.13:1，「已交卷・1／66」只看得到一小截；文字混用兩種單位（「作答中・2／53」是題數、「已交卷・1／66」是選擇題得分），都沒寫單位；作答中的列沒有「繼續」提示。
- 1920 時表格 1,312 px、「考卷」欄約 400 px 只放 6 個字，眼睛要從「115 學測」移動約 1,100 px 才看到自己的進度。
- 學年度選單 34 px、灰底、圓角和膠囊不同。

**改成**（`features/exams/ExamTable.tsx`）
- 欄位順序：**考卷**（`w-[16rem]`）｜**我的進度**（`w-56`）｜題數（`w-20`，靠右）｜全國答對率（`w-24`，置中，16 px `Check` 圖示＋`sr-only`「有」；沒有時是「—」）｜題型結構（其餘寬度，main 不到 ws 時隱藏）。進度緊接在考卷名稱後面。
- 進度文字：「作答中・已答 2／53 題」「已交卷・選擇題 78／100 分」（可存取名稱同步）；細條 `h-1.5 w-16`、軌道 `bg-line`，有進度時至少 4 px；作答中的列加「繼續」標章（primary，不是第二個連結）。
- 列 hover `bg-surface-2`（§2.9）；sticky 篩選列：`ChoiceChip`＋精簡選單（36 px、行內標籤）＋「只看作答中」＋筆數靠右。
- 截圖工具 `capture.shots.ts` 的 `records__flow` 只截桌機時有這段文字，手機卡片文字不變。
- PR 5（表格）、PR 2（篩選列元件）。

### 3.9 模擬考列表 `/mock`

**現況**（`13-mock-list__1440x900`）
- 每張卷別卡兩列、160 px 高：第一列標題欄的說明換成兩行、「未作答」浮在中間、「開始」靠左，右邊空約 190 px；第二列只有一顆外框的「下載 PDF（考試格式）」。1440×900 只看得到 4 份。
- 6 份都是一樣醒目的實心「開始」，看不出先做哪一份；「本站自組模擬考」在 y≈1,296 才出現，頁首只有一個文字連結帶過去。
- 下面的說明卡 `max-w-3xl`（768），卡片 960，右緣不齊。

**改成**（`features/mock/MockPaperList.tsx`、`pages/MockExamPage.tsx`）
- 卡片寬 ≥ 48rem（`@3xl`）時排成一列：`grid-cols-[2rem_minmax(14rem,18rem)_minmax(0,1fr)_auto] items-center gap-x-5 py-3`：編號｜標題＋一行 meta（`whitespace-nowrap`）｜狀態｜動作（靠右：`ghost sm`「下載 PDF」＋`Download` 圖示、`md`「開始」）。PDF 面板展開在下面（`col-span-full`）。卡片約 76 px，6 份在 1440×900 一個畫面看得完（設計值）。結構仍是 6 個 `article`＋h3（`mock.spec.ts:52–55`）。
- **只有一份是實心的「開始」**：作答中的那份（「繼續」）；沒有的話，最新一年還沒做過的那份，旁邊加「建議」標章；其他是 `secondary`。都做過時全部 `secondary`。
- 頁首下方兩張選擇卡（可點卡片）：「歷屆真題（換算級分）」「依難度自組（穩定基礎／進階／頂標）」，各自捲到對應區塊並把焦點放在區塊標題。
- 所有區塊同寬：拿掉說明卡的 `max-w-3xl`；wide 起「考前節奏建議」與聲明移到右欄（desktop-ui §16.6 第 5 點的右欄）。
- PR 5。

### 3.10 單字 `/words`

**現況**
- 單字庫分頁：篩選卡 290 px 高（44 px 搜尋框、44 px 圓形級別 L1–L6、11 px 群組標籤、說明、四個 44 px 原生選單），1440×900 只看得到 3½ 列單字；單字卡的 meta 12 px、堆在右上角（`02-words-library__1440x900`）。
- 四個分頁是一整張卡片、選中是淡藍格（`02-words-study__1440x900`），和寫作頁的實心分段長得不一樣。
- 每日學習：評分按鈕上沒有按鍵數字，快捷鍵只寫在最底下一行小灰字；頁首與分頁佔約 225 px，1366×768 的評分按鈕在 y≈700–750，實機視窗更矮（`02-words-study-card__1366x768`）。
- 錯題本空白時沒有任何按鈕（`02-words-mistakes-empty__1366x768`）。
- 單字卡的返回是另一種樣式（`ArrowLeft`、主色、「返回」，放在分頁列下面）（`02-words-word-card__1440x900__dark`）。

**改成**（`features/vocab/*`；`/words` 改成 list 模式）
- 分頁列：≥ lg 改成 `SubNav` 底線分頁（只改外觀，`nav aria-label="單字功能"` 與連結不變），sticky（desktop-ui §5.9）。
- **單字庫**（desktop-ui §5.9 的 P1 照做）：ws 起 `grid-cols-[16rem_minmax(0,1fr)] gap-6`，左欄 sticky 的篩選（`top: calc(var(--sticky-bar-h) + 1rem)`、自己捲動）；級別改成 32 px 的分段格（`min-h-8 min-w-8 rounded-control`）、群組標籤 12 px；四個選單直排、36 px、`line-strong`；「排序」移到結果數那一列；結果 wide 起三欄。單字卡的級別標章與「歷屆 9 次」和詞性放在同一行（`flex items-baseline gap-2`）。
- **每日學習**：評分按鈕左上角 `Kbd` 1–4、「顯示答案」旁 `Kbd` 空白鍵（`hidden lg:inline`）；學習進行中（`phase=running`）頁首只留 H1 一行、隱藏說明句，1366×640 時單字卡與評分按鈕同時在視窗內（e2e 驗）。
- **錯題本空白**：§2.14 的空白狀態，兩顆桌機按鈕（`hidden lg:inline-flex`）：「做一次單字測驗」→ `?tab=quiz`、「練詞彙題」→ `/vocabulary`。文案補「題庫詞彙題答錯的字」會改到手機文字，見 §7。
- 單字卡、講義：`BackLink as="button"`，文字「單字庫」（保留現在的捲動還原）。
- PR 5。

### 3.11 寫作入口與題目列表：`/writing`、`/translation`、`/composition`、`/writing/translation`、`/writing/essay`、`/writing/*/ai`

**現況**
- `WritingListBar` 把返回連結、24 px 的 H1 和來源分頁放在 sticky 列裡，頁面說明在列的底框**下面**，像被切斷；返回連結緊貼 H1；1920 時列的框線 385–1777、卡片 425–1737 不齊（`08-writing-essay-list__1920x1080`）。
- 來源分頁（歷屆試題｜本站仿真｜自訂題目）和篩選膠囊（全部 66）都是實心主色，兩層選擇一樣重（`08-writing-essay-list__1440x900__dark`）。
- 歷屆作文（66 題）與歷屆中譯英卡片看不出寫過沒有（本站仿真的卡片有「已完成／草稿」）（`08-writing-essay-list__1366x768`）。
- 卡片是整張 `<Link>`，裡面有完整題目，讀屏把 150–250 字的題目當成連結名稱念出來，66 張卡都是。
- 1920 寬的三欄卡片在近白的底色上只剩淡淡的框，看不出能點（`08-writing-essay-list__1920x1080`）。
- /writing 右欄「兩種批改方式」用原生 ▶（`07-writing-home-student__1440x900`）。

**改成**
- **頁首**（PR 2，`WritingListBar.tsx`）：返回連結自己一行 → H1（`text-title`）→ 說明（`lg:mt-1 lg:max-w-[40rem]`），都在 sticky 列外面；sticky 列只放 `SubNav`（來源）＋篩選膠囊，一行。
- 來源是 `SubNav` 底線分頁、篩選是 `ChoiceChip`（§2.8），兩層一眼分得出來。
- 卡片是可點卡片（§2.5）。
- **進度標章**（PR 4，`EssayListPage.tsx`、`TranslationListPage.tsx`）：卡片右上角和本站仿真同一種標章：讀 `writing/lib/drafts.ts` 判斷「草稿」；已登入時列表頁取一次 `listSubmissions`，有批改紀錄的顯示「AI 12.5／20」（`ai` 標章）。sticky 列加「只看還沒寫的」切換。標章只在桌機顯示（手機要不要一起加見 §7）。
- **連結名稱精簡**（PR 4，只加屬性，M5）：整張卡仍可點，但連結用 `aria-labelledby` 指向標題（「115 學測 看圖寫作」）、`aria-describedby` 指向 meta（「至少 120 個單詞・2 段」），題目文字不算進名稱。抽成 `components/ListCard.tsx`，歷屆、本站仿真、題型頁的卡片共用。要先確認 e2e 沒有用題目文字找連結。
- /writing 右欄的「兩種批改方式」改成 `Disclosure`。
- PR 2、PR 4。

### 3.12 寫作作答頁：`/writing/essay/:examId`、`/writing/essay/ai/:code`、`/writing/essay/custom`、`/writing/translation/:examId`、`/writing/translation/ai/:code`

**現況**
- 一欄：作文作答框頂端約在 y=855，1366×768 的第一個畫面看不到；開始打字之後題目、三張圖的描述、段落要求都捲走；「自我檢核與自評」展開在作答框下方，和作文永遠不會同時出現（`09-essay-exam-student-filled__1366x768__full`）。`Workspace`／`PaneTabs` 已經做好、有單元測試，但沒有頁面使用。
- 作答框 902 px 寬（約 115 字元一行）、中文題目一行約 55 個字（`09-essay-exam-student-filled__1920x1080`）。
- 「打字作答｜拍照上傳手寫稿」是兩顆漂浮在卡片之間的膠囊；作答框與外層卡片都畫焦點，看起來是兩層框。
- 「送出 AI 批改（7 點）」按下去就送出、扣點；截圖裡作文只有 108 個單詞，字數已經標紅並有黃色警告，送出鈕仍是可按的實心主色（`09-essay-exam-student-focus-submit__1366x768`；`EssayAttemptPage.tsx:274–277`）。
- 自動存草稿只有一句固定的「草稿會自動存在這台裝置。」，看不到存檔時間（`EssayAttemptPage.tsx:266–268`）。
- 輸入框邊界淺色 1.30:1、深色更淡，中譯英的作答框像一塊灰色色塊（`09-translation-exam-student-filled__1440x900__dark`）。

**改成**（照 desktop-ui §6 實作，以下是補充與修正）
- **工作區**：desktop-ui §6.1–§6.3 照做（`Workspace layout="prompt-editor" | "sentences-rail"`、`TaskSummary`、`WorkspaceHeader`、`PaneTabs`、自我檢核放在沒有作答框的那一欄）。工作區的 grid 高度公式改用變數：`calc(100dvh - var(--ws-head-h) - var(--page-pt) - var(--page-pb) - 0.75rem)`（本文把工作區上下內距改成 24／24，§2.3）。
- **作答框**：`text-[1.0625rem] leading-[1.85] max-w-[72ch]`；欄寬見 §2.4（1366 約 495 px）。外層卡片不再畫焦點（§2.7）。
- **作答方式**：放在作答卡的標題列，`Segmented`（§2.8）。
- **題目文字** `max-w-[40rem]`。
- **狀態列 `EditorStatusBar`**（desktop-ui §6.5）：「124 個單詞（至少 120）・2／2 段・已自動儲存 10:42」；存檔失敗時紅字並說明原因（「這個瀏覽器無法儲存草稿（可能是無痕模式）」）；`aria-live="polite"` 只播報門檻與失敗。
- **送出區 `AttemptActions`**（desktop-ui §6.5，修正）：
  - 沒有任何提醒時，點「送出 AI 批改（7 點）」直接送出（和現在一樣）。
  - **有提醒時**（少於最低字數、少於 100 個單詞、題目要求分段卻只有 1 段、中譯英某一句空白），點按鈕先把動作列換成確認列：「送出 AI 批改會用 7 點，今天剩 20 點。・只有 108 個單詞，少於 120（少於 100 會扣 1 分）・只有 1 段（未分段會扣 1 分）」［再改一下］［確定送出］，**焦點在「再改一下」**；按「再改一下」或 Esc，焦點回作答框。PR 1 先做這一段（`SubmitGuard`），PR 4 併進 `AttemptActions`。
  - Ctrl／⌘＋Enter 一律只打開確認列（desktop-ui §6.5、§8），焦點在「取消」（沒有提醒時的文字是「取消」，有提醒時是「再改一下」）。
- **Ctrl／⌘＋S**：立刻存檔並在狀態列顯示「已儲存在這台裝置 10:42」（desktop-ui §8）。
- **拍照**：desktop-ui §6.4 的 P1（桌機的隱私說明、拍照區在右欄）；`PhotoDropZone`（拖放、Ctrl／⌘＋V 貼上）列為 P2，和 §3.14 的拍照問題目共用。
- 輸入框邊界與底色（§2.7）在 PR 2 就生效。
- PR 1（送出提醒）、PR 2（輸入框）、PR 4（其餘）。

### 3.13 批改結果與排隊：`/writing/submissions/:id`

**現況**
- 第一個畫面「AI 批改，僅供參考」出現 4 次（橫幅、總分、先改這三個就好、各項說明），`EssayResult` 共有 7 個 `AiBadge`（`10-submission-essay__1440x900`）。
- 「這次批改扣 7 點」的點數卡夾在標題和分數中間，把「12.5／20」推到 y≈455；「▶ 題目」是一整張 64 px 的卡片，用原生 ▶。
- 學生自己的作文和錯誤標示，藏在最下面預設收起的「標出的錯誤（2）」裡（`EssayResult.tsx:259`）；展開放在上面的反而是兩位評分者的分數表（`EssayResult.tsx:173–239`）（`10-submission-essay__1366x768__full`）。
- 四項分數是白卡裡的四塊灰底小卡。
- 排隊中只有一張「排隊等待批改…通常 20–60 秒完成，這一頁會自動更新」的小卡，下面一大片空白；看不到自己送出的內容；「可以先離開」要等變慢才出現；完成時分頁標題不變（`10-submission-queued__1366x768`；`SubmissionResultPage.tsx:244–258`）。

**改成**（`SubmissionResultPage.tsx`、`EssayResult.tsx`、`TranslationResult.tsx`、`HighlightedText.tsx`）
- ws 起照 desktop-ui §6.6 做 `ResultWorkspace`（左：你的作文／參考改寫（AI）／題目分頁；右：總分卡、先改這三個就好、錯誤清單、各項說明；雙向連動）。
- 順序（ws 以下的 lg 也一樣）：標題 → `AiNotice` 橫幅（全頁唯一的完整版）→ 總分卡（結果卡；四項分數改成同一張卡裡的一列 `StatBlock`，不是卡中卡）→ 先改這三個就好 → **你的作文與錯誤標示（桌機預設展開，`open={isDesktop}`）** → 各項說明 → 評分者（收進 `Disclosure`）→ 一行點數「扣 7 點・今天剩 20／30」（`text-meta text-muted`，放在頁尾的動作列旁）。
- 區塊標題旁的 AI 標示改 `AiBadge compact`（§2.10）。
- 「題目」改成總分卡上方的一行 `Disclosure`，不是一張卡。
- 中譯英結果：分數表用 §2.9（數字靠右、`lg:max-w-[40rem]`）；desktop-ui §6.6 的逐句兩欄維持 P2。
- **排隊與批改中**（桌機）：卡片一開始就寫「批改好會出現在「我的寫作紀錄」，可以先去背幾個單字」＋`secondary sm`「每日學習」；下面唯讀顯示這次送出的作文或譯文；完成時 `document.title` 前面加「✓ 批改完成｜」（離開這一頁時還原），並用既有的 live region 播報「批改完成」。
- PR 4。

### 3.14 學習助手：`/assistant`、`/assistant/mistakes`、`/assistant/ask`、`/assistant/new`、`/assistant/case/:id`、`/assistant/report*`

**現況**
- 首頁沒有圖示、說明跑到 945 px 寬，和其他模組頁長得不一樣；每個動作都要花點數，卻看不到「今天還剩幾點」，只有一段很長的點數規則（`17-assistant-home__1366x768`；`AssistantHomePage.tsx:175` 起）。
- 錯題與疑點：表頭「日期」「狀態」一字一行、「未作答 1」「看批改結果」折成兩行（`17-assistant-mistakes__1440x900`）；篩選列約 90 px 高，加上表頭佔 1366×640 視窗約 145 px（`17-assistant-mistakes__1366x768`）；動作欄沒有看得到的表頭，兩種連結樣式不同。
- 請學習助手解析：3,330 px 的單欄，要問哪幾格、卡在哪、送出在 y≈2,400 之後（`17-assistant-ask__1366x768__full`）。
- 案例頁：題目欄每一題一張 80 px 的卡（5 題 440 px）；切到「追問」時第一眼是 250 px 空白，輸入框與「送出追問（用 3 點）」在面板捲動區下面看不到（`17-assistant-case-analysis__1440x900`、`17-assistant-case-followups__1366x768`）。
- 拍照問題目：桌機預設「拍照」分頁、說明是手機用語（「iPhone 可以在照片上長按文字複製…」），沒有拖放或貼上（`17-assistant-new-photo__1366x768`）。
- 學習報告：沒有作答紀錄時仍引導花 10 點產生報告，只有一行灰字提醒；第一份報告就出現「回饋：上一版哪裡不準」；有報告時最醒目的實心按鈕是要花 10 點的「依這版產生新版本」，「刪除這一版」緊貼工具列；表頭「配／分」「目標（估／計）」一字一行；左側目錄約 230 px（`17-assistant-report-empty__1366x768__full`、`17-assistant-report__1440x900`）。

**改成**
- **首頁**（PR 2 頁首、PR 5 其餘）：模組頁首 A；三張動作卡（可點卡片）上方一列「今日剩 20／30 點・10/19 00:00 重置」（`QuotaMeters` 精簡版）；點數規則改成 4 列的精簡表（解析 6 點起／追問 3 點／學習報告 10 點／拍照轉錄 2 點），細節收進「點數怎麼算」`Disclosure`。
- **錯題與疑點**（PR 2 表格、PR 5 篩選列）：§2.9 的表格（來源、狀態、日期 `whitespace-nowrap` 與最小寬；動作欄有看得到的表頭「下一步」、連結同一種樣式；題目欄 `line-clamp-2`）；篩選列改用 `StickyBar` 的精簡選單（行內標籤、36 px），一行，筆數靠右。
- **請學習助手解析**（PR 5，`AskPage.tsx`；路由改 workspace 模式）：ws 起 `Workspace layout="result"`：左欄題目（選文、選項、你的答案；答案卡在桌機改成兩欄的精簡列），右欄表單（要問哪幾格、卡在哪裡、想問的話、點數、送出），一個視窗高，送出按鈕一直看得到。表單只有一份（R4）。
- **案例頁**（PR 5，`CasePage.tsx`）：頁首 B；題目欄的作答改成一張卡裡的精簡列（每題 40 px：題號｜結果標章｜你的答案｜正解〔公開後〕，`divide-y`）；分頁用 `PaneTabs`（§2.8 的底線樣式）；解析內文 `text-body`。**追問分頁改成聊天版面**：面板內 `flex-col`，對話串 `flex-1` 自己捲、切到這個分頁時捲到最新一則；`FollowupComposer` 在捲動區外、固定在面板底部（輸入框預設 3 行，「提示／詳解」與題號收成一行）；切到追問時焦點移到輸入框。
- **拍照或貼上題目**（PR 5，`NewQuestionPage.tsx`）：桌機維持「拍照」為預設分頁，但文案換成「上傳截圖或照片」；照片選擇區加拖放區（虛線框「把截圖拖到這裡，或按 Ctrl＋V 貼上」，`role="button"`、鍵盤可啟動），`onDrop`／`onPaste` 取 `image/*` 交給現有的 `PhotoCrop`；手機用的說明在 ≥ lg 隱藏。和寫作的 `PhotoDropZone` 共用。
- **學習報告**（PR 2 表格、PR 5 其餘）：路由改 list 模式、目錄 `lg:w-[12rem]`；`SectionTargetsTable` 用 §2.9（`whitespace-nowrap`、數字靠右）。作答紀錄少於 10 筆時，表單上方顯示「先累積一點紀錄，報告會準很多」＋三個連結（做一份模擬考／每個題型各做一組穩定基礎／每日學習），「產生報告」降成 `secondary`、旁邊註明「資料少，報告會比較籠統」。有報告時「依這版產生新版本（10 點）」改 `secondary`、「刪除這一版」移到頁尾的 `danger-ghost`。第一份報告不顯示「上一版」的回饋欄（標籤改字會改到手機，見 §7）。
- PR 2、PR 5。

### 3.15 設定、關於、條款、帳號、歡迎、AI 申請

**現況**：/settings、/about 的 H1 在 x=433（`18-settings-student__1440x900`、`19-about__1440x900`）；/account 沒有圖示、/settings 有；第一次登入的歡迎頁「同意並繼續」在約 1,461 px 的底部（`20-account-welcome__1366x768__full`）；AI 申請頁「目前狀態：尚未申請」的卡片沒有按鈕，申請表在約 1,500 px 以下（`20-ai-apply-not-applied__1366x768__full`）。

**改成**
- 框架與頁首 A（/account 也有圖示）。PR 2。
- 表單規格（§2.7）、radio 卡片用 `ChoiceChip` 的卡片版（§2.8）。PR 2。
- **AI 申請**：「目前狀態」卡加 `primary`「填寫申請（約 1 分鐘）」，按下捲到申請表並把焦點放在用途欄位。PR 5。
- **歡迎頁**（desktop-ui §5.12 的 P2 提前）：ws 起兩欄，左邊兩份政策摘要，右邊 sticky 的表單卡（年齡、暱稱、兩個同意、送出；比視窗高時自己捲），頂端一行「最後一步：確認資料就能開始」。PR 5。

### 3.16 404、後台

- 404：頁首 B 的樣式（H1 `text-title`）；P2 的常用頁面連結（單字、題庫練習、歷屆試題、模擬考、寫作練習）一起做，用可點卡片。PR 5。
- /admin：只有站主用，這一版只吃到 PR 2 的通用樣式；`adminUi.tsx:73` 的 `animate-spin` 在桌機加 `lg:motion-reduce:animate-none`。表格化維持 desktop-ui §5.13 的 P2。

---

## 4. 人性化

### 4.1 方向感：知道自己在哪

| 做法 | 在哪 | PR |
|---|---|---|
| 標題位置固定、兩種頁首、一種返回連結（文字＝上一層的頁名） | 全站（§3.1） | 2 |
| 側邊欄看得出層級：題型縮排在「題庫練習」底下、中譯英與英文作文縮排在「寫作」底下；分組有 `aria-labelledby` | 側邊欄（§3.1） | 1（屬性）、2 |
| 作答頁一直看得到大題、本大題題號格、「第 23 題」（desktop-ui §7.1） | 作答頁（§3.5） | 3 |
| 換頁或換視圖用底線分頁、篩選用膠囊、切換模式用分段，三種一眼分得出來 | 全站（§2.8） | 2 |
| 單字卡、講義的返回和其他頁同一種樣式 | /words（§3.10） | 5 |

### 4.2 下一步：每個終點都有出口

| 終點 | 下一步 | PR |
|---|---|---|
| 首頁 | 「今天」卡：待複習、錯題、作答中的考卷，一鍵開始；新同學的三步驟 | 5 |
| 題庫練習交卷 | 依答對率一句建議＋一個主要按鈕；錯題題號格 | 3 |
| 歷屆交卷 | 從第一題錯題開始檢討、把錯題交給學習助手、批改這份的中譯英／作文 | 3 |
| 模擬考成績單 | 最弱的 2–3 個題型（含難度）、批改這份的中譯英／作文；動作列也放在頁首 | 3 |
| 題組最後一題 | 「全部答完了！交卷看解析」 | 3 |
| 批改排隊 | 可以先離開、去每日學習；完成時分頁標題改變 | 4 |
| 錯題本空白 | 做一次單字測驗、練詞彙題 | 5 |
| 學習報告（資料不夠） | 先做模擬考、各題型一組穩定基礎、每日學習 | 5 |
| AI 申請 | 「填寫申請（約 1 分鐘）」直接帶到表單 | 5 |
| 模擬考列表 | 只有建議的那一份是實心「開始」；頁首兩張選擇卡 | 5 |

### 4.3 進度回饋：看得到自己走到哪

- 作答頁的題號格（已答＝底色＋勾、未答＝空框、標記＝旗子；交卷後對錯），desktop-ui §7.1。
- 題庫練習矩陣的進度條、答對率等級、「上次」（§3.3）。
- 歷屆列表的進度帶單位、作答中有「繼續」（§3.8）。
- 寫作狀態列的字數門檻與「已自動儲存 10:42」（§3.12）；題目列表的「草稿」「AI 12.5／20」（§3.11）。
- 批改完成的分頁標題與播報（§3.13）。
- 每次用按鍵作答都有閃爍與播報「第 35 題選 (C)」（desktop-ui §7.3）。

### 4.4 新手與空白狀態

- 首頁沒有紀錄時的三步驟（§3.2）；矩陣空白時的「建議從這裡開始」（§3.3）。
- 所有空白狀態用 §2.14 的同一個樣式：說明這裡會出現什麼、怎麼產生，加一個按鈕。學習助手首頁（`17-assistant-home-empty`）、錯題與疑點（`17-assistant-mistakes-empty`）、寫作紀錄、錯題本（§3.10）都套用。
- 歡迎頁與 AI 申請頁讓表單一直看得到（§3.15）。

### 4.5 作答的手感

照 desktop-ui §7.1–§7.4、§8 實作（PR 3），本文的修正：

- 欄寬依 82rem 框架重新分配（§3.5），驗收改成「選文每行 60–75 個字元」。
- 大題膠囊與模擬考的 `SectionNavigator` 共用同一個元件（§3.5）。
- 文意選填有選項欄時不開行內面板（P2，§3.5）。
- 提示不再是虛線框（§3.5）。
- 最後一題下方的交卷列（§3.5）。
- 專心作答：計時中自動收合側邊欄、點站內連結先問（§3.5、§4.7）。
- 每日學習的評分按鈕顯示 1–4、空白鍵（§3.10）。
- 輸入法實機測試仍由站主在 PR 3 的預覽網址照 desktop-ui §8 做；單鍵快捷鍵預設開（desktop-ui §16.4）。

### 4.6 結果頁

- 一種統計樣式（`StatBlock`）、一種結果卡（頂端色帶），不再用 2 px 主色框（§3.6）。
- 主角是分數，下一步只有一個實心按鈕（§3.6）。
- 錯在哪一眼看得到：題號格（練習、歷屆）、作文的錯誤標示預設展開（批改結果）。
- 分數低時用中性說法，不顯示「贏過 0%」（§3.7）。
- AI 標示一頁一個完整版（§2.10、§3.13）。

### 4.7 防誤觸總表

原則：**會清除資料、會扣點、會結束考試的動作要確認；確認時焦點在安全的那一邊；按住或連按不會觸發**。

| 動作 | 現況 | 改成（≥ lg） | PR |
|---|---|---|---|
| 歷屆交卷後「清除作答，重新開始」 | 按一下就清除，無法復原 | `danger-ghost`、就地確認、焦點在「取消」；作答中的 `ClearControl` 焦點也改到「取消」 | 1 |
| 歷屆與題庫練習的交卷確認列 | 焦點在「確定交卷」，連按兩次 Enter 就交卷（`ExamToolbar.tsx:119–121`） | 焦點在「繼續作答」，和模擬考一致；列出未作答的題號（`paperIndex` 的 `unansweredBySection`），點了回去作答；考試模式另顯示剩餘時間 | 1 |
| 模擬考交卷對話框 | 按鈕可能在對話框捲動區下面看不到 | 動作列固定在底部、關閉按鈕、說明含標記數與剩餘時間 | 1 |
| 送出 AI 批改 | 直接送出、扣點 | 有字數或段數提醒時先確認，焦點在「再改一下」；Ctrl／⌘＋Enter 一律只開確認 | 1、4 |
| 計時中離開（模擬考作答中、歷屆考試模式作答中） | 點側邊欄就離開，時間照走 | 點側邊欄或頁尾的站內連結時跳確認：「計時還在進行（剩 1:23:45），作答已存在這台裝置。確定離開？」［留下來作答］（預設焦點）［離開］；自動收合側邊欄 | 1、3 |
| 學習報告「依這版產生新版本（10 點）」 | 頁首最醒目的實心按鈕 | `secondary`；「刪除這一版」移到頁尾 | 5 |
| 單鍵快捷鍵 | — | desktop-ui §7.4、§8 的保護（只作答看得到的目前題、忽略重複按鍵、文字欄位裡不作用、可以關） | 3 |

**計時中離開的做法**：現在用的是 `<BrowserRouter>`（`main.tsx:18`），react-router 的 `useBlocker` 只在 data router 下可用，換路由器超出這次範圍。改成：頁面在計時中用一個小 context（新 `lib/timedSession.ts`）登記剩餘時間的讀取函式；Layout 在 ≥ lg 攔截側邊欄、頁尾、帳號選單裡站內連結的點擊（`onClickCapture`），計時中先開確認對話框（§2.13 的 `Dialog`）。瀏覽器的上一頁、關閉分頁不攔（作答與時間都存在這台裝置，`beforeunload` 的提示在重新整理時也會跳出來，反而干擾）。

---

## 5. 工作包

### 5.0 共通

**每個 PR 開工的第一步**（沿用 desktop-ui §10、§16.1）：

1. 基準：PR 1 開工前用 `apps/web/scripts/visual-baseline.sh 35ff807` 重截手機與桌機基準（目前的 a479469 已過時，M7）。之後每個 PR 用同一份基準；合併了 main 的新題庫就加 `--data-from`。
2. 補截基準：把自己要改的元件在手機上的每一種狀態先加進 `tests/visual/capture.shots.ts` 並補截（沒有基準圖就不改那個元件）。本文需要新增的：歷屆交卷後的結果卡、歷屆與題庫練習的交卷確認列、模擬考交卷對話框（未作答很多時）、寫作作答頁有字數提醒時、學習助手各頁（目前 `capture.shots.ts` 沒有任何學習助手頁面）、單字錯題本空白、每日學習翻卡後。
3. 在 `desktop`、`mobile`、`desktop-ui`、`desktop-lg` 四個 project 各跑一次現有 e2e，確認開工前沒有失敗。

**每個 PR 結束時**：

- `npm run typecheck`、`npm test`、`npm run build -w @gsat/web`、`npm run test:e2e -w @gsat/web`（四個 project；**`E2E_PORT=4681`**，先建置）。
- 手機與平板 0 差異：`visual-run.sh … --viewports narrow` → `compare.mjs` exit 0（含兩張手機深色截圖）。
- 桌機前後對照：附錄 B 的指令，重截該 PR 列出的截圖，挑 10–15 張前後對照放進 PR 說明（含深色）；高對比模式（`emulateMedia({ forcedColors: 'active' })`）截選中的膠囊、分頁、目前題、側邊欄目前頁。
- 鍵盤走查記在 PR：Tab 順序、焦點框完整、焦點不被 sticky 列蓋住、確認列與對話框只用鍵盤可以完成與取消。
- 主程式 gzip 大小前後對照（§7 第 6 點的預算）。
- `desktop-copy.test.ts` 掃新增的檔案：不得出現「大考中心」「CEEC」。
- 本文最後補「實作備註」（實測數字、和本文不同的做法）。

**截圖工具**：本文引用的改版前截圖由 scratchpad 的 `ui-audit/capture/`（`before.audit.ts`、`capture.config.ts`、`fixtures.ts`、`make-index.mjs`）產生，換工作階段就不在了。PR 1 把它搬進 `apps/web/tests/visual/audit/`（自己的 config，預設的 `npm run test:e2e` 不會跑到；輸出一律在 repo 外），之後每個 PR 用它重截同名的截圖。

### 5.1 PR 1：防誤觸與語言標記

**目標**：保護作答、點數與成績，不改任何版面；讀屏能用英文念英文。

| 檔案（`apps/web/src/` 下） | 改動 |
|---|---|
| `features/exams/components/SessionPanels.tsx`、`features/exams/ExamPaperPage.tsx` | 交卷結果的清除改成就地確認（桌機）；`ClearControl` 的焦點改到「取消」（桌機） |
| `features/exams/components/ExamToolbar.tsx` | 確認列焦點改「繼續作答」、未作答題號、剩餘時間（桌機） |
| `features/mock/components/SubmitDialog.tsx` | 固定的動作列、關閉按鈕、說明、題號收合（只加 `lg:` 與桌機分支） |
| `features/writing/components/SubmitGuard.tsx`（新）；`EssayAttemptPage.tsx`、`TranslationAttemptPage.tsx`、`bank/BankEssayAttemptPage.tsx`、`bank/BankTranslationAttemptPage.tsx`、`custom/CustomEssayAttemptPage.tsx` | 有提醒時的送出確認（桌機） |
| `lib/timedSession.ts`（新）；`components/Layout.tsx`；`features/mock/MockSessionPage.tsx`；`features/exams/ExamPaperPage.tsx` | 計時中點站內連結的確認（桌機） |
| `features/exams/components/{RichText,Passage,Paper,Questions,BlankGroups}.tsx`、`features/practice/PracticeSession.tsx` | `lang="en"`／`lang="zh-Hant-TW"`（全寬度，只加屬性） |
| `components/Layout.tsx` | 側邊欄分組 `aria-labelledby`（只在 ≥ lg render） |
| `tests/visual/audit/`（新）、`tests/visual/capture.shots.ts` | 搬進截圖工具；補截 §5.0 第 2 點的手機狀態 |
| `tests/desktop-safety.spec.ts`（新）、`tests/mobile-guard.spec.ts` | 見下方 |

**驗收**
- 1366×640：歷屆考試模式交卷後按「清除作答，重新開始」→ 出現確認、焦點在「取消」、按 Enter 不清除（`localStorage` 的作答還在）；按「確定清除」才清除。
- 歷屆與題庫練習按「交卷」→ 焦點在「繼續作答」；連按兩次 Enter 不會交卷；確認列的未作答題號點了會捲到該題。
- 模擬考還有 50 題沒答時開交卷對話框：「確定交卷」「繼續作答」的 bounding box 都在視窗內，焦點在「繼續作答」。
- 作文 108 個單詞時按送出：FakeBackend 沒有收到 POST、出現確認列、焦點在「再改一下」；130 個單詞、2 段時按送出：直接 POST（行為不變）。
- 模擬考作答中點側邊欄「首頁」：出現確認，「留下來作答」網址不變，「離開」才換頁；練習模式不出現。
- ARIA 快照：選文容器 `lang="en"`；側邊欄的每個清單有名稱。

**重截**：`12-exam-paper-exam-submitted`、`12-exam-paper-exam-midway`（另加「交卷確認列」狀態）、`14-mock-paper-submit-dialog`、`09-essay-exam-student-filled`（另加「送出確認」狀態）、`14-mock-paper-midway`（另加「離開確認」狀態）、`05-practice-session-reading-midway`。

**手機不變**：所有確認與攔截都在 `useIsDesktop()` 分支；`SubmitDialog` 只加 `lg:` class；`lang` 是屬性（M5），用 narrow 比對證明 0 差異。`mobile-guard.spec` 新增：手機上沒有桌機的確認列、沒有離開確認對話框、送出按鈕仍直接送出、歷屆清除仍是原本的按鈕（站主同意一起修之後再改這幾條）。

**依賴**：無。

### 5.2 PR 2：外觀基礎（拆 2a、2b）

**目標**：§2 的規格落地，所有頁面的標題位置、字級、控制項、表格、卡片一致。

**2a 版面與殼層**

| 檔案 | 改動 |
|---|---|
| `index.css` | §2.1 的 token、§2.2 的字級、圓角、`page-frame`、`bleed`（改寫）、`bar-bleed`、深色 ≥ lg 的覆寫 |
| `lib/desktopLayout.ts`（＋測試） | `MODE_CLASSES`、`FOOTER_MODE_CLASSES`（§2.4）；`/words`、`/assistant/report*`、`/mock/report/:attemptId` 改 list |
| `components/Layout.tsx` | 內容容器與頁尾、側邊欄（高視窗密度、層級縮排、帳號列兩行、收合的標誌與列高） |
| `features/account/LoginButton.tsx` | 側邊欄版的狀態短字、可存取名稱含狀態 |
| `components/PageHeader.tsx`（新，`ModulePage.tsx` 的 `PageHeader` 改用它）、`components/BackLink.tsx`（新） | §3.1 的兩種頁首、返回連結 |
| 用到頁首的頁面：`ModulePage.tsx`、`features/assistant/components/AssistAccess.tsx`、`features/account/styles.ts`（`pageTitleCls`）、`features/writing/components/WritingListBar.tsx`、`features/mock/MockSessionPage.tsx`、`features/mock/MockReportPage.tsx`、`features/exams/ExamPaperPage.tsx`、`features/practice/PracticeSessionPage.tsx`、`features/practice/SectionPractice.tsx`（頁首 grid）、`features/assistant/{CasePage,AssistantHomePage,ReportPage}.tsx`、寫作五個作答頁與 `SubmissionResultPage.tsx`（H1 class）、`pages/NotFoundPage.tsx` | H1 `lg:text-title`／`lg:text-title-ws`、`lg:tracking-normal`；返回連結換成 `BackLink` |
| `components/desktop/StickyBar.tsx`、`features/exams/components/ExamToolbar.tsx`、`features/mock/components/MockToolbar.tsx`、`components/desktop/Workspace.tsx` | `bar-bleed` 與同一種表面；拿掉 `--bleed-max:100cqw` |

**2b 元件**

| 檔案 | 改動 |
|---|---|
| `components/ui/buttons.ts`、`components/ui/fields.ts`（新）；四個樣式模組與 `Questions.tsx` 的常數改成 re-export | §2.6、§2.7 |
| `components/{SubNav,Segmented,ChoiceChip,TierPicker,Badge,Disclosure,Table,ListCard}.tsx`（新）、`components/desktop/Dialog.tsx`（新） | §2.8–§2.14 |
| 遷移：`features/exams/ExamList.tsx`、`features/writing/components/{SourceTabs,KindFilter}.tsx`、`features/writing/bank/BankListPage.tsx`、`features/vocab/ui/LevelPicker.tsx`、`features/vocab/VocabModule.tsx`（分頁外觀）、`features/practice/BankPractice.tsx`（難度）、`features/assistant/NewQuestionPage.tsx`（分頁外觀）、`components/desktop/PaneTabs.tsx`（外觀）、`pages/SettingsPage.tsx`、`features/account/AccountPage.tsx` | 選擇控制項 |
| `components/desktop/DataTable.tsx`、`features/assistant/components/{SectionTargetsTable,ReportGeneratePanel}.tsx`、`features/account/AiApplyPage.tsx`、`pages/MockExamPage.tsx`、`features/admin/UsageSection.tsx`、`features/mock/components/{SectionTable,StartScreen}.tsx`、`features/exams/components/SessionPanels.tsx`（表格部分）、`features/writing/components/{TranslationResult,SubmissionHistory}.tsx`、`features/assistant/MistakesPage.tsx`（表格欄位） | §2.9 |
| 可點卡片：`features/writing/{EssayListPage,TranslationListPage}.tsx`、`bank/BankListPage.tsx`、`features/home/DesktopDashboard.tsx`、`features/assistant/AssistantHomePage.tsx`（動作卡）、`features/mock/MockPaperList.tsx` | §2.5 的陰影與 hover |
| `components/ModulePage.tsx`（`InfoSection` 的字級、說明框無虛線）、`features/writing/components/ui.tsx`（`card`、`AiBadge` 合併）、`features/practice/components/AiGroupBadge.tsx`、`features/account/ui.tsx`、`features/exams/ExamList.tsx`（`ProgressBadge` 改名） | §2.5、§2.10 |
| `features/writing/WritingHomePage.tsx`、`features/writing/SubmissionResultPage.tsx`（「題目」）、`features/vocab/views/WordDetailView.tsx` | `Disclosure` |

**驗收**
- **標題位置**（`desktop-shell.spec`）：1440×900 與 1920×1080 下，`/`、`/practice`、`/exams`、`/mock`、`/writing`、`/writing/essay`、`/words`、`/assistant`、`/assistant/report`、`/settings`、`/about`、`/practice/reading/basic`、`/exams/gsat-115`、`/writing/essay/gsat-115`、404 的 H1（子頁是返回連結）左緣相等（±1 px），分別是 296 與 424；非工作區頁 H1 上緣相等，工作區頁比它高 8 px（±1）；頁尾 `nav` 左緣相等。
- sticky 列（列表頁的 `StickyBar`、作答工具列）的左緣＝側邊欄右緣、右緣＝main 右緣，背景色相同。
- ≥ lg 時 main 裡沒有 font-size < 12 px 的可見文字；H1 是 28 px（工作區 24 px）。
- 兩種主題下，輸入框、選單、未選中膠囊的框線對所在背景 ≥ 3:1（computed style 計算）。
- 高對比模式：選中的膠囊、底線分頁、難度方塊在像素上和未選中的不同（沿用 desktop-ui §16.7 第 5 點的量法）。
- 側邊欄：1366×640 已登入與未登入不用捲（既有測試）；1440×900 已登入不用捲、每項 36 px；帳號列看得到完整的「AI 已核准」。
- `/assistant/mistakes`、`/assistant/report` 的表頭沒有換行（每個 `th` 的高度＝單行高度）。
- 1024、1366、1920 沒有水平捲動；`p`、`li` ≤ 60rem（既有）。
- 主程式 gzip 增加 ≤ 3 KB（§7 第 6 點）。

**重截**：全部（ui-audit 的 106 個狀態，含深色）。這是第一次全站改樣式的 PR，站主審查時挑：`00-shell-*`、`01-home-student-history`、`03-practice-menu-records`、`04-section-reading`、`08-writing-essay-list`（含深色）、`11-exams-list`、`13-mock-list`、`14-mock-paper-start`、`17-assistant-home`、`17-assistant-mistakes`、`17-assistant-report`、`18-settings-student`、`09-translation-exam-student-filled__dark`。

**手機不變**：新 token 只新增；深色覆寫在 `@media (width >= 64rem)`；所有樣式常數只附加 `lg:` 部分；新元件在手機分支輸出原本的 class（或只在桌機樹裡用）；`PageHeader` 在手機輸出和現在一模一樣的 DOM（單元測試快照比對手機輸出）。`mobile-guard.spec` 新增：手機上的頁首、按鈕、膠囊的 computed style 和改版前相同（抽 5 個元素比 `font-size`、`border-color`、`background-color`）。

**依賴**：PR 1（Layout 有重疊，依序合併）。PR 3、4、5 都依賴它。

### 5.3 PR 3：作答頁（可拆 3a、3b）

**目標**：desktop-ui §7–§8，加上結果頁的下一步與練習矩陣。

| 檔案 | 改動 |
|---|---|
| **3a**：`features/exams/navigation.ts`（新）、`features/exams/paperIndex.ts`（從 `features/mock/` 搬來）、`features/exams/components/{QuestionGrid,SessionNavRow,SectionNav}.tsx`（新）、`features/mock/components/SectionNavigator.tsx`、`ExamToolbar.tsx`、`MockToolbar.tsx`、`features/exams/CurrentQuestion.ts`、`features/exams/useSessionHotkeys.ts`（新）、`components/desktop/ShortcutHelp.tsx`（這一頁的按鍵）、`components/Layout.tsx`＋`lib/timedSession.ts`（專心作答的自動收合） | desktop-ui §7.1、§7.3、§7.4、§8；§3.5 的大題膠囊共用、專心作答 |
| **3b**：`features/exams/components/{Paper,Passage,BlankGroups,Questions}.tsx`、`features/practice/{BankPractice,PracticeSession}.tsx`、`features/practice/components/{HintLadder,ResultPanel,StatBlock}.tsx`（`StatBlock` 新）、`features/exams/components/SessionPanels.tsx`、`features/mock/{MockReportPage}.tsx`、`features/mock/components/{SectionTable,LevelCard}.tsx`、`features/mock/bank/{BankReport,BankReview}.tsx`、`features/practice/PracticeHome.tsx`、`features/practice/history.ts` | §3.3、§3.5 的分割與細節、§3.6、§3.7 的成績單 |
| `tests/desktop-session.spec.ts`（新） | desktop-ui §11.3 列的項目＋下方 |

**驗收**
- desktop-ui §11.3 的 `desktop-session.spec` 全部項目（工具列 ≤ 100 px、大題導覽只有一份、按鍵作答、捲走後按字母只換目前題、N／P 焦點在題目標題、按住只作答一次、Shift+Tab 焦點不被工具列蓋住…）。
- 選文每行 60–75 個字元：1366×768、1440×900、1920×1080 的閱讀題組量第 1 段的前 5 行。
- 文意選填選文每一行的行距相同（±1 px）。
- 題庫練習交卷後：題號格的格數＝題數、點第一個答錯的格會捲到該題解析並聚焦；0／10 時主要按鈕是「從第一題錯題開始看」；結果卡裡實心主色按鈕只有 1 個。
- 歷屆交卷結果：有三個正向動作、清除是 `danger-ghost`；AI 開放時有「批改這份的英文作文（7 點）」連結到 `/writing/essay/gsat-115`。
- 模擬考成績單：「下一步建議」連到 `/practice/:section/:tier`、難度依級分；沒有「贏過 0%」字樣。
- /practice：做過的格有進度條與「已做 N・答對 M%」、上次的格有「上次」；沒有紀錄時「建議從這裡開始」；可存取名稱和現在相同（`practice.spec.ts:130–137`）。
- 模擬考作答中、使用者沒設定過：側邊欄收合；交卷後恢復。
- `prefers-reduced-motion` 時按「在文中標出」不平滑捲動。

**重截**：`04-section-*`、`05-practice-session-*`、`12-exam-paper-*`、`14-mock-paper-*`、`15-mock-report*`、`16-bank-mock-*`、`03-practice-menu*`、`00-shell-shortcut-help`（作答頁開啟），另加新狀態：「全部題號」下拉、按鍵作答後的目前題外框、題庫練習結果的題號格。

**手機不變**：`desktopRow` 只在 `useIsDesktop()` 時傳入（手機 DOM 相同）；`QuestionPalette` 改用 `QuestionGrid` 時 class 一字不改（desktop-ui §7.1，先補截題號面板的兩種模式）；舊的導覽元件只加 `lg:hidden`；結果頁的新區塊只在桌機 render；`LevelCard` 的中性文字只在桌機分支。`mobile-guard.spec` 新增：手機沒有題號列、結果題號格、交卷列；按字母鍵不改答案（既有）；文意選填點空格仍開行內面板。

**依賴**：PR 2（按鈕、膠囊、sticky 列、表格）；PR 1（`timedSession`）。和 PR 4 互不依賴。

### 5.4 PR 4：寫作工作區

**目標**：desktop-ui §6（原 PR B）加上本文的修正。

| 檔案 | 改動 |
|---|---|
| `features/writing/components/{EditorStatusBar,AttemptActions,WorkspaceHeader,TaskSummary,PhotoDropZone}.tsx`（新）、`features/writing/lib/useWritingHotkeys.ts`（新） | desktop-ui §6.5；`AttemptActions` 吸收 PR 1 的 `SubmitGuard` |
| `features/writing/{EssayAttemptPage,TranslationAttemptPage}.tsx`、`bank/{BankEssayAttemptPage,BankTranslationAttemptPage}.tsx`、`custom/{CustomEssayAttemptPage,CustomPromptView}.tsx`、`components/{EssayPromptView,EssaySelfAssess,TranslationSelfCheck,PhotoPicker}.tsx`、`bank/components/{EssayReveal,TranslationReveal}.tsx` | desktop-ui §6.1–§6.4；§3.12 |
| `features/writing/SubmissionResultPage.tsx`、`components/{ResultWorkspace}.tsx`（新）、`lib/useSelectedError.ts`（新）、`components/{EssayResult,HighlightedText,TranslationResult}.tsx` | desktop-ui §6.6；§3.13 |
| `features/writing/{EssayListPage,TranslationListPage}.tsx`、`lib/drafts.ts` | §3.11 的進度標章、「只看還沒寫的」、連結名稱 |
| `tests/desktop-writing.spec.ts`（新） | desktop-ui §11.3 列的項目＋下方 |

**驗收**
- desktop-ui §11.3 的 `desktop-writing.spec` 全部項目（1280×600 作答框頂端與送出按鈕同時在視窗內、Ctrl＋Enter 只開確認、按住不會送出、跨寬度不重新掛載、批改結果雙向連動…）。
- 狀態列顯示「已自動儲存 HH:MM」；Ctrl／⌘＋S 後時間更新、沒有跳出瀏覽器的另存網頁。
- 有字數提醒時點按鈕也要確認（PR 1 的測試沿用）。
- 批改結果 1366×768 第一個畫面：總分、先改這三個就好、你的作文（ws）都在；完整的「AI 批改，僅供參考」只有 1 個。
- 排隊頁：看得到送出的內容與「可以先離開」；完成時 `document.title` 以「✓ 批改完成」開頭。
- 歷屆作文列表：寫過草稿的卡有「草稿」標章；「只看還沒寫的」有作用；連結的可存取名稱不含題目內文。
- 畫面沒有官方參考譯文、評分原則原文、佳作（沿用 D8 檢查）。

**重截**：`07-writing-home-*`、`08-writing-*`、`09-*`、`10-submission-*`，另加：作答中的確認列、Ctrl＋S 之後、批改結果選中錯誤。

**手機不變**：作答頁 `isDesktop ? <Workspace …/> : 原本的 JSX`（R4）；列表標章只在桌機；`aria-labelledby` 是屬性（M5）。`mobile-guard.spec` 新增：手機作文框裡 Ctrl＋Enter／Ctrl＋S 沒有反應（Ctrl＋Enter 已有）、列表卡片沒有新標章。

**依賴**：PR 2；PR 1 的 `SubmitGuard`。

### 5.5 PR 5：首頁、列表、單字、學習助手

**目標**：§3.2、§3.8–§3.10、§3.14–§3.16 其餘的部分。

| 檔案 | 改動 |
|---|---|
| `pages/HomePage.tsx`、`features/home/{DesktopDashboard,continueItems,navSummaries}.ts(x)`（`navSummaries` 新）、`features/progress/{ProgressStats,localStats}.ts(x)`、`components/BackendStatus.tsx`、`features/writing/components/AiAccessPanel.tsx`（`QuotaMeters`） | §3.2 |
| `features/exams/ExamTable.tsx` | §3.8 |
| `features/mock/MockPaperList.tsx`、`pages/MockExamPage.tsx` | §3.9 |
| `features/vocab/{VocabModule}.tsx`、`views/{LibraryView,StudyView,MistakesView,WordDetailView,HandoutView}.tsx`、`ui/LevelPicker.tsx` | §3.10 |
| `features/assistant/{AssistantHomePage,MistakesPage,AskPage,CasePage,NewQuestionPage,ReportPage}.tsx`、`components/{FollowupComposer,FollowupThread,QuestionPreview,LabelPicker,DoubtPicker,PhotoCrop,ReportGeneratePanel}.tsx`、`lib/desktopLayout.ts`（`/assistant/ask` 改 workspace） | §3.14 |
| `features/account/{AiApplyPage,WelcomePage}.tsx` | §3.15 |
| `pages/NotFoundPage.tsx`、`features/admin/adminUi.tsx` | §3.16 |
| `tests/desktop-shell.spec.ts`（首頁、列表）、`tests/desktop-assistant.spec.ts`（新） | 見下方 |

**驗收**
- 首頁 1366×640：「今天」卡在第一個畫面；有紀錄時列出待複習與錯題（數字和右欄相同）；沒有紀錄時是三步驟；連線正常時沒有「後端」字樣；首頁不下載 `/data/`（既有）。`desktop-shell.spec` 原本的「『全部功能』在第一個畫面」改成「『今天』在第一個畫面」。
- 全部功能：每項說明不出現「…」、不含「大考中心」；wide 寬度三欄的高度差 ≤ 一項的高度。
- /exams：進度欄緊接考卷欄；文字帶單位；作答中的列有「繼續」。
- /mock：1440×900 一個畫面看得到 6 份卷別；實心「開始」最多 1 顆。
- /words：1366×640 單字庫第一個畫面至少 6 列單字（設計值）；每日學習翻卡後評分按鈕在視窗內、有 1–4 的 `Kbd`；錯題本空白有兩顆按鈕。
- 學習助手：首頁看得到今日剩餘點數；錯題表頭不換行；解析請求頁送出按鈕在 1366×640 的視窗內；案例頁切到追問時輸入框在視窗內且有焦點；拍照頁拖一張圖片進拖放區會進入框選；資料不足時報告頁的「產生報告」是 `secondary`。
- AI 申請：按「填寫申請」後焦點在用途欄位。

**重截**：`01-home-*`、`02-words-*`、`11-exams-list*`、`13-mock-list*`、`17-assistant-*`、`20-*`、`22-not-found`。

**手機不變**：首頁儀表板只在 ws 寬度 render（既有）；`navSummaries` 只在桌機用；列表、單字、學習助手的新區塊都在桌機分支或只加 `lg:` class；學習助手各頁先補截手機基準（§5.0 第 2 點）再改。`mobile-guard.spec` 新增：手機首頁沒有「今天」卡、`BackendStatus` 照舊；錯題本空白沒有新按鈕；學習助手各頁沒有工作區。

**依賴**：PR 2。

### 5.6 順序與平行

```
PR 1 ──► PR 2a ──► PR 2b ──┬──► PR 3a ──► PR 3b
                           ├──► PR 4
                           └──► PR 5
```

- PR 1、2 依序合併（都改 `Layout.tsx`）。
- PR 3、4、5 在 PR 2 合併後可以平行開分支；共用檔案（`Layout.tsx`、`index.css`、`SessionPanels.tsx`、`SubmissionResultPage.tsx`）只加東西不搬動，合併 main 後重跑手機比對。
- 每個 PR 各自請站主在預覽網址試用、各自合併、出問題各自 revert（desktop-ui §12 的流程）。

---

## 6. 不採用或改做法的意見

| # | 意見 | 決定 | 理由 |
|---|---|---|---|
| 1 | 作答選項卡的未選框線改成 `line-strong`（視覺、一致性） | **部分採用**：只給輸入框、選單、文字框、膠囊、checkbox 卡片；選項卡改加 hover | 選項卡裡有原生 radio，邊界已 ≥ 3:1；每題 4–10 個選項都加深會讓整份試卷很吵 |
| 2 | 單選篩選用實心主色（一致性） | 不採用；選中一律淡底＋主色框（視覺意見） | 實心主色留給主要動作；深色模式一排亮紫色塊是審查指出的問題 |
| 3 | 每次按「送出 AI 批改」都要兩段式確認（使用流程） | **改做法**：有字數或段數提醒時才確認；快捷鍵一律確認 | 按鈕上已寫點數；每次都確認會讓學生習慣性按「確定」，確認就失去作用 |
| 4 | 用 `useBlocker` 攔截離開、加 `beforeunload`（使用流程） | **改做法**：攔截側邊欄、頁尾、帳號選單的站內連結 | 站上用 `BrowserRouter`，`useBlocker` 要 data router；`beforeunload` 在重新整理時也會跳出來，而作答與時間本來就存在這台裝置 |
| 5 | 作答區 `--bleed-max:90rem`（視覺）、工作區不設上限（desktop-ui §2.3） | **改做法**：工作區也用 82rem 框架 | 選文、作答框都有行長上限，再寬只是空白；和其他頁同一條左緣 |
| 6 | 閱讀題目欄 sticky、或兩欄各自捲動（視覺） | 不採用；維持 desktop-ui §7.2（選文 sticky、題目跟著頁面捲） | 題目欄通常比視窗高，sticky 會切掉；各自捲動要處理焦點與鍵盤捲動，收益小 |
| 7 | 可點卡片 hover 往上位移 1 px（視覺） | 不採用；只換陰影與框線 | 位移會讓卡片裡的字在部分螢幕上抖動 |
| 8 | 用 `dark:` 在深色加工具列上緣細線（視覺） | 不採用 | `dark:` 不看本站的手動主題（M3）；工具列黏在頂端時上面沒有東西，不需要上緣線 |
| 9 | 桌機字級下限 13 px、全面替換 131 處 `text-[0.95rem]` 與 181 處 `text-xs`（視覺） | **改做法**：下限 12 px；只改共用元件與這次碰到的元件 | 全面替換的差異太大、審不完；標章、時間戳 12 px 可接受 |
| 10 | 拿掉「全國答對率」欄（視覺） | 不採用；改成勾號圖示、欄寬縮小 | 指考與部分參考試卷沒有答對率，欄位有區辨作用（設定頁可改回卡片的學生也要看得到） |
| 11 | /exams 表格限寬 72rem（視覺） | 不採用；改把「我的進度」移到考卷欄旁邊 | 限寬會讓表格和 sticky 列右緣不齊；問題是欄位距離，不是表格寬度 |
| 12 | `TierPicker` 統一成連結或 radio 其中一種語意（一致性） | 不採用；外觀統一、語意沿用 | 題型頁換難度是換主要內容（導覽），列表頁是篩選，兩種都正確；統一會改 e2e 的選擇器 |
| 13 | /assistant/mistakes 每列只能有一個 Tab 停留點（一致性） | 不採用；改表頭與連結樣式 | `DataTable` 的規則本來就允許「目的地不同」的第二個連結（desktop-ui §4.8），「本站解析（免費）」與「問學習助手」目的地不同 |
| 14 | 在 `modules.ts` 加 `navSummary` 欄位（視覺） | **改做法**：桌機專用的 `features/home/navSummaries.ts` | desktop-ui §1 把 `modules.ts` 列為不改的檔案 |
| 15 | 首頁 H1 用 `flex-col-reverse` 讓問候在上（視覺） | **改做法**：品牌 H1 在前、樣式縮成眉標，問候在後 | DOM 順序就是視覺順序，不需要反轉（WCAG 1.3.2） |
| 16 | 首頁「全部功能」可收合、移到最後（使用流程） | 部分採用：移到「今天」之後、不收合 | 新同學靠它認識 14 個功能；收合多一次點擊 |
| 17 | 首頁依規則推薦「今天該練什麼」（使用流程，SPEC §2.3） | 不採用；只列本機的待複習、錯題、作答中 | 推薦規則是功能設計，不是版面；desktop-ui §9 已延後 |
| 18 | 側邊欄顯示「AI 剩 20 點」（使用流程） | **改做法**：只顯示狀態短字；點數在帳號選單與首頁 | 側邊欄在每一頁都在，為了點數每頁打一次 API 不值得 |
| 19 | /assistant/new 桌機預設「貼上文字」（使用流程） | **改做法**：維持「拍照」預設，文案改成「上傳截圖或照片」並支援拖放與貼上 | 桌機上學生手邊多半是截圖，截圖走轉錄流程最省事 |
| 20 | 模擬考「下載 PDF」改成文字連結（使用流程）或 `secondary md`（視覺） | **改做法**：`ghost sm`＋下載圖示 | 兩份意見的折衷：比「開始」低一階，但仍是看得出來的按鈕 |
| 21 | narrow 模式改成 48rem（視覺） | 不採用；維持 51rem（816） | 現在的寬度沒有問題，內文已有 `max-w-prose`；改了只是多一組差異 |
| 22 | 交卷結果的「錯題交給學習助手」用新網址參數 `?source=exam` | 實作時確認 `/assistant/mistakes` 支援的參數，不支援就連到不帶參數的頁面 | 不為了這個連結改學習助手的路由 |
| 23 | 首頁「後端未連線」的 e2e 文字 | **改做法**：桌機改成白話文案、更新 desktop project 的斷言；手機不變 | 「後端」對學生沒有意義（H6） |

## 7. 待站主決定

不影響開工，括號裡是預設值：

1. **會改到手機的小修正要不要一起做？**（R9）
   - (a) 歷屆交卷後「清除作答，重新開始」要確認；(b) 歷屆與題庫練習交卷確認列的焦點改「繼續作答」；(c) 錯題本空白文案補「題庫詞彙題答錯的字」；(d) 學習報告第一份不顯示「上一版」回饋欄；(e) `BackendStatus`、`adminUi`、「在文中標出」的 reduced-motion；(f) 成績單的中性說法；(g) 歷屆作文、中譯英列表卡片的「草稿」「AI 分數」標章。
   - (a)(b) 是會讓學生失去作答的問題，建議手機也修。（預設：這次只做桌機；PR 1 合併後另開一個「手機小修正」PR，附手機差異圖給站主確認。）
2. **首頁「今天」卡的範圍**（desktop-ui §9 延後的項目）。（預設：最小版，只讀本機的待複習、錯題、作答中；不做推薦規則。）
3. **計時中離開確認與自動收合側邊欄**。（預設：都開，只在桌機、只在模擬考作答中與歷屆考試模式作答中。）
4. **送出 AI 批改的確認條件**。（預設：有字數或段數提醒時才確認；快捷鍵一律確認。要每次都確認也只要改一個條件。）
5. **1920 寬的工作區上限**。（預設：82rem，和列表頁同一條左緣；desktop-ui 原本不設上限。）
6. **主程式大小預算**：desktop-ui §16.8 已比 a479469 多 7.7 KB（gzip）。這次的新元件多數只被按需載入的頁面用到，但 `Layout`、`PageHeader`、`BackLink`、`Badge` 會進主程式。（預設：PR 2 增加 ≤ 3 KB；其他 PR ≤ 1 KB；超過就把側邊欄以外的桌機專用程式移到只在 ≥ lg 載入的 chunk，desktop-ui §16.5 第 13 點的方案。）
7. **單鍵快捷鍵與輸入法實測**：沿用 desktop-ui §14、§16.4（預設開；站主在 PR 3 的預覽網址照 §8 實測）。


## 8. 實作備註

開工後的實測與和前面各節不同的做法；兩者不一致時以這裡為準。

### 8.1 實作備註（PR 1）

**站主的決定（§7）**：第 1 點的 (a)「歷屆交卷後清除要確認」與 (b)「交卷確認列的焦點在『繼續作答』」手機與桌機一起改，其他照預設值（(c)–(g) 不動、計時中離開確認只在桌機、送出確認只在有提醒時）。手機的差異只出現在按下之後（確認列、焦點位置）；手機的按鈕外觀、文字與其他行為都不變（`mobile-guard.spec.ts` 的「PR 1 防誤觸：手機」）。§5.1 寫的「歷屆清除仍是原本的按鈕」改成驗證新的確認。

**和前面各節不同的做法**

1. **`lang` 標在文字元素上，不標在容器**（§3.5、§5.1 列了 `Paper.tsx`、`PracticeSession.tsx`）：`Paper.tsx` 的「選文」region、題組說明、原卷勘誤、圖表的文字描述、題庫練習的 AI 標示與全文中譯都是中文，標在容器上讀屏會用英文念「選文」。改成 `RichText` 的 `lang="en"` 依內容判斷（`richText.ts` 的 `isEnglishText`）：一行以英文字母為主才標；整段都是英文時根元素標 `lang="en"`，有中文行（混合題的中文說明、中譯英與作文的中文題目、看圖題的中文選項）時只標英文那幾行。**只加屬性、不拆文字**：英文行裡夾的中文（「（簡答題，2分）」）原本想另外包一層 `zh-Hant-TW`，但多一個元素會讓 Chrome 在那裡分段排版，320 寬時「（簡答題，2」整段位移不到 1 px（`tests/visual` 比對出 4 張、各 444 px；只標 `lang`、不拆就 0 差異，實測），所以不拆，整行標 `en`；讀屏念到這幾個中文字會用英文語音，題型與配分在題目標題旁另有一份。本來就是獨立元素的才標回 `zh-Hant-TW`：選文裡的空格按鈕、行內選項面板（名稱是中文）、預設空格記號的「＿＿＿」。`Paper.tsx`、`PracticeSession.tsx` 沒有自己畫的英文，不用改。沒有處理的：混合題的行內輸入框原本就是 `lang="en"`（`englishInputProps`），中文的 `aria-label`「第 47 題作答」仍用英文語音念，留給 PR 3（題號列與目前題會重整這些元件）。
2. **送出確認（`SubmitGuard`）只接作文三頁**（歷屆、本站仿真、自訂題目）：中譯英兩頁的送出按鈕本來就要每一句都寫了才能按，§3.12 的「中譯英某一句空白」不會發生，接上也不會觸發；PR 4 的 `AttemptActions`（Ctrl／⌘＋Enter 一律確認）再接中譯英。提醒的文字：少於 100 個單詞時是「只有 95 個單詞，少於 100 個會扣總分 1 分」，100–119 是「只有 108 個單詞，少於 120（少於 100 會扣 1 分）」，未分段是「只有 1 段（未分段會扣 1 分）」；自訂題目用 `customLengthHints` 裡 tone 為 warn 的三種（題目要求的最低字數、少於 100、未分段），確定之後照舊走題目要求的確認（`RequirementsConfirm`）。本站仿真作文對照過後作答鎖定、改不了，取消鈕寫「取消」，焦點回到送出按鈕。今天剩幾點讀 `/api/ai/quota`，還沒讀到或不限點數時只寫「會用 7 點」。確認列開著時把作文補到沒有提醒，確認列自己收起、換回原本的動作列（之後再刪字也不會自己跳出來，要再按一次送出）。
3. **計時中離開確認的文案依計時方式**（§4.7 只有一句）：模擬考「離開之後時間照樣倒數，時間到就以最後存檔的作答交卷」，歷屆考試模式「離開這一頁計時會暫停，回來可以接著寫」（歷屆的計時在離開頁面時暫停，開始畫面就是這樣說明的）。標題已經是「要離開作答頁嗎？」，說明不再重複「確定離開？」（1440 寬時最後一行只剩「嗎？」）。共用的 `Dialog`（§2.13）在 PR 2 才有，這一版是 `components/desktop/LeaveSessionDialog.tsx`（同樣的外觀：標題列＋右上角關閉、底部一列動作、框線＋陰影），PR 2 換成共用的。攔的是側邊欄（含品牌與帳號選單）與頁尾的站內連結；Ctrl／⌘／Shift＋點、中鍵（新分頁）不攔，頁面裡自己的返回連結也不攔（§4.7 的範圍）。同一頁（網址相同）不算離開，比的是路由的位置。
4. **未作答題號**：交卷確認列（`ExamToolbar`）與模擬考交卷對話框共用 `features/exams/components/UnansweredList.tsx`；一個大題沒答的超過 10 題時收成「閱讀測驗　第 35–46 題（12 題）［列出題號］」。確認列裡點題號：確認列收起、捲到那一題（置中，避開 sticky 工具列）、焦點在第一個作答元件；文意選填、篇章結構沒有題目卡，找名稱以「第 n 題」開頭的空格。模擬考交卷對話框在桌機放寬到 `lg:max-w-2xl`（42rem，原本 36rem）：§3.7 的題號方塊加上左邊固定寬的大題名稱之後，36rem 放不下一個大題的 10 題，「綜合測驗（10 題）」會折成兩行。§3.7 的動作列寫法（`lg:sticky lg:bottom-0 lg:-mb-5`）在對話框捲到一半時會浮在下緣上方 20 px、下面露出題號（sticky 的範圍是扣掉 `p-5` 的內容框，1024×600 實測），改成 `lg:-bottom-5`，三種位置（開著、捲到一半、捲到底）動作列的下緣都貼齊對話框。
5. **側邊欄的第一組**（只有「首頁」）沒有分組標題，清單名稱給「開始」；其他四組用 `aria-labelledby` 指向分組標題（收合時是 sr-only 的標題）。
6. **清除作答**：交卷後的確認是新的 `RestartControl`（手機與桌機；焦點在「取消」，Esc 或取消收起、焦點回到按鈕）。作答中的 `ClearControl` 只在桌機把焦點改到「取消」、Esc 收起、取消後焦點回到按鈕，手機維持原本（焦點在「確定清除」，§7 的預設）。
7. **截圖工具**：搬到 `apps/web/tests/visual/audit/`（`audit.config.ts`、`desktop.audit.ts`、`make-index.mjs`、`README.md`），寫作的假資料抽成 `tests/visual/fixtures.ts`，和 `capture.shots.ts` 共用一份。多了 375×812 的 project，只截標了 `mobile` 的狀態（站主同意的手機修正）；`make-index.mjs` 加 `--before`，每張圖旁邊連到改版前的同名圖。PR 1 新增的狀態：`05-practice-session-reading-confirm`、`12-exam-paper-exam-confirm`、`12-exam-paper-exam-clear-confirm`、`14-mock-paper-leave-confirm`、`09-essay-exam-student-submit-confirm`（確認列與交卷確認都用鍵盤打開，截得到焦點框）。
8. **手機基準補截**（§5.0 第 2 點）：歷屆交卷後的結果卡、模擬考交卷對話框（未作答 50 題）、單字錯題本空白、每日學習翻卡後原本就有；新增 `33-exam-paper__exam-confirm`、`35-practice-session__reading-basic-confirm`（交卷確認列）、`31-writing-essay-exam__student-short`（107 個單詞、1 段）與學習助手 8 張（首頁未登入／已登入、錯題與疑點、拍照、貼上、學習報告空白、解析請求、案例頁）。學習助手的假後端（FakeAssist、FakeReports）時間戳是測試行程的牆鐘時間，截圖時一律換成固定時間的前一分鐘，兩次截圖才會一樣。追問與有內容的學習報告沒有補（輪詢較多、版本靠時間排序），留給 PR 5 開工時補。

**檢查結果**（最後一版的程式；E2E_PORT=4681）

| 項目 | 結果 |
|---|---|
| `npm run typecheck` | 三個工作區 exit 0 |
| `npm test` | api 29 檔 912 項、web 154 檔 1,815 項、shared 17 檔 493 項，全部通過（web 新增 `RichText.test.tsx`、`UnansweredList.test.tsx` 與 `Layout`、`ExamPaperPage`、`MockPages`、`attempt`、`richText` 的案例） |
| `npm run build -w @gsat/web` | 通過；主程式 `index-*.js` gzip 108,208 → 109,182 B（+974 B，§7 第 6 點「其他 PR ≤ 1 KB」之內；多的是 `Layout` 的攔截、`LeaveSessionDialog`、`timedSession`） |
| e2e（`desktop`、`mobile`、`desktop-ui`、`desktop-lg` 四個 project） | 366 項：329 通過、37 略過（各 project 本來就不跑的）、0 失敗。其中 `desktop-safety.spec` 9 項、`mobile-guard.spec` 10 項、`desktop-shell.spec` 52 項（30 項略過）、`exams` 10、`mock` 6、`practice` 22、寫作三個 spec 44 |
| 手機與平板逐像素（`visual-baseline.sh 35ff807` 重截的基準 vs. 這一版，`--data-from` 基準的資料） | 320×640、375×812、768×1024 共 339 組：**0 差異**（`compare.mjs` exit 0）。交卷確認列（`33-exam-paper__exam-confirm`、`35-practice-session__reading-basic-confirm`）用滑鼠打開，焦點框不會畫出來，所以手機的焦點改到「繼續作答」在截圖上看不到差別，由 `mobile-guard.spec` 驗證 |
| 桌機（1024×600、1366×640、1920×960，336 組） | 14 張不同：12 張是這個 PR 要改的（交卷確認列 ×6、模擬考交卷對話框 ×3、歷屆交卷結果的紅字清除鈕 ×3）；另 2 張 `02-words__library` 是截圖工具本身不穩定（桌機整頁圖要把視窗拉高，單字庫邊捲邊載入，載到幾列看時機；同一份程式三次截出 5,117／7,217／7,973 px 三種高度），和這個 PR 無關 |
| 截圖的重試 | 最後一次 585 張全部截到；前一次有 2 張在負載下逾時（`02-words__quiz-question` 320×640、`29-writing-essay-ai-code__revealed` 1920×960），重跑一次就通過 |

---

## 附錄 A：合併後的意見清單

三份審查共 88 項（視覺 V1–V31、使用流程 U1–U32、一致性 C1–C25，依審查清單的順序編號），合併成 50 項。

| # | 主題 | 合併的意見 | 本文 | PR |
|---|---|---|---|---|
| 1 | 版面框架與頁尾對齊 | V1 頁面標題五個位置、C3（位置部分）、C19 頁尾框線 | §2.4、§3.1 | 2 |
| 2 | 頁首與返回連結 | V28 頁首樣式、C3（頁首部分）、C6 返回連結六種、V14 `WritingListBar` | §3.1、§3.11 | 2 |
| 3 | 字級 | V3 | §2.2 | 2 |
| 4 | 說明被截斷 | V4、C22、U21（全部功能兩行） | §3.2、§3.4 | 2、5 |
| 5 | sticky 列 | V5、C7 篩選列 | §2.13 | 2 |
| 6 | 表單控制項 | V6、C2、C14 | §2.1、§2.7 | 2 |
| 7 | 按鈕 | V8、C13 | §2.6 | 2 |
| 8 | 選擇控制項 | V9、C8、C9、C10 | §2.8 | 2 |
| 9 | 表格 | V16、C5、C12 | §2.9 | 2 |
| 10 | 標章 | C16 | §2.10 | 2 |
| 11 | 卡片表面、陰影、圓角、內距 | V26、V31、C20、V18 右欄卡 | §2.5 | 2、5 |
| 12 | 深色模式層次 | V25 | §2.1、§2.8 | 2 |
| 13 | 虛線與提示框 | V19 | §2.14、§3.5 | 2、3 |
| 14 | 揭露 | V20 | §2.12 | 2 |
| 15 | 側邊欄分組與層級 | V21、U21（入口重疊）、C23 | §3.1 | 1、2 |
| 16 | 帳號列 | V22、U30、C15 | §3.1 | 2 |
| 17 | 收合的圖示欄 | V27 | §3.1 | 2 |
| 18 | 首頁 | V17、U18、U29、C25 | §3.2 | 5 |
| 19 | 練習矩陣 | V7、U22 | §3.3 | 3 |
| 20 | 作答區寬度與分割 | V2 | §2.4、§3.5 | 3 |
| 21 | 題號導覽 | U2、C18 | §3.5 | 3 |
| 22 | 鍵盤 | U3、U26（每日學習） | §3.5、§3.10 | 3、5 |
| 23 | 文意選填的兩組選項 | V30、C24 | §3.5 | 3（P2） |
| 24 | 空格行距 | V12 | §3.5 | 3 |
| 25 | 英文的 `lang` | C4 | §3.5 | 1 |
| 26 | 最後一題的交卷 | U23 | §3.5 | 3 |
| 27 | 計時中離開 | U7 | §4.7 | 1、3 |
| 28 | 結果卡與統計樣式 | V10 | §3.6 | 3 |
| 29 | 題庫練習結果的下一步 | U4 | §3.6 | 3 |
| 30 | 歷屆交卷：清除確認與下一步 | U1、U10 | §3.6 | 1、3 |
| 31 | 交卷確認焦點 | U11 | §4.7 | 1 |
| 32 | 模擬考交卷對話框 | U8、C1 | §3.7 | 1 |
| 33 | 模擬考成績單 | U9 | §3.7 | 3 |
| 34 | 寫作分欄與行長 | V23、U6 | §3.12 | 4 |
| 35 | 送出 AI 批改確認 | U5 | §3.12、§4.7 | 1、4 |
| 36 | 自動儲存 | U27 | §3.12 | 4 |
| 37 | 批改結果的順序與 AI 標示 | V11、U12 | §3.13 | 4 |
| 38 | 排隊頁 | U13 | §3.13 | 4 |
| 39 | 寫作列表的進度與連結名稱 | U19、C17 | §3.11 | 4 |
| 40 | /exams 表格 | V15、U24 | §3.8 | 5 |
| 41 | /mock 列表 | V13、U31 | §3.9 | 5 |
| 42 | /words 單字庫篩選 | V24 | §3.10 | 5 |
| 43 | 錯題本空白 | U25 | §3.10 | 5 |
| 44 | 學習助手首頁點數 | U28 | §3.14 | 5 |
| 45 | 錯題與疑點表格 | U32、C11 | §3.14 | 2、5 |
| 46 | 請學習助手解析 | U14 | §3.14 | 5 |
| 47 | 案例頁 | V29、U15 | §3.14 | 5 |
| 48 | 桌機的拍照 | U16 | §3.14 | 5 |
| 49 | 學習報告 | U17 | §3.14 | 2、5 |
| 50 | 歡迎與 AI 申請 | U20 | §3.15 | 5 |
| — | 動態（C21） | 併入 §2.15，各 PR 碰到時修 | §2.15 | 2、3 |

## 附錄 B：截圖重截指令

```bash
cd /home/user/gsat-ui
A=/tmp/claude-0/-home-user/2d144e17-026c-5789-bf1d-ea76d9e0f78e/scratchpad/ui-audit   # PR 1 之後改用 apps/web/tests/visual/audit/
PR=pr1

# 1. 建置，複製一份凍結的產物，資料換成改版前那份（兩邊題庫相同，差異只反映介面）
npm run build -w @gsat/web
rm -rf $A/dist-$PR && cp -r apps/web/dist $A/dist-$PR && rm -rf $A/dist-$PR/data && cp -r $A/dist/data $A/dist-$PR/data

# 2. 重截這個 PR 列出的狀態（--grep 用狀態名稱的開頭；省略就是全部 106 個）
cd $A/capture
mkdir -p $A/after-$PR
AUDIT_DIST=$A/dist-$PR AUDIT_OUT=$A/after-$PR AUDIT_META=$A/after-$PR/_meta E2E_PORT=4681 \
  npx playwright test -c capture.config.ts --grep '12-exam-paper-exam|14-mock-flow|09-essay-exam-filled' 2>&1 | tee $A/after-$PR/run.log

# 3. 產生索引（用法：make-index.mjs <metaDir> <outDir> <runLog> <distDir>），和 before/ 逐張對照
node make-index.mjs $A/after-$PR/_meta $A/after-$PR $A/after-$PR/run.log $A/dist-$PR
```

- `--grep` 比對的是測試名稱：靜態頁面的測試名稱就是狀態名稱（例如 `03-practice-menu`），流程測試一次產生好幾個狀態（`12-exam-paper-exam-flow` 產生 `-midway`、`-midway-word-bank`、`-submitted`；`14-mock-flow` 產生作答中、交卷對話框與成績單）。各 PR 新增的狀態加在對應的流程測試裡。
- 只要某些視窗時加 `AUDIT_PROJECTS=1366x768,1440x900-dark`。
- 手機與平板的 0 差異比對用 repo 的 `visual-run.sh … --viewports narrow` 與 `compare.mjs`（desktop-ui §16.1），不是這套工具。
