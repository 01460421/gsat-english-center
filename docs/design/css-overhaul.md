# 全站 CSS 改版：稽核與計畫（視覺質感、手機排版、載入速度、深色模式）

> 版本：2026-11-06 第 2 版（稽核＋計畫＋PR A、PR B 已實作）。
> 需求（站主）：「優化網站的css」，確認後範圍是四件事一起做：**視覺質感**（按鈕、欄位、卡片、標章、表格、間距、字級一致）、**手機版排版**（360–430 px：溢出、擠、字太小、點擊目標太小）、**載入速度**（CSS 大小、沒用到的樣式、版面位移、字型載入、關鍵 CSS）、**深色模式**（跟隨系統＋手動切換，記在這台裝置）。
> 基準：分支 css-polish＝origin/main **b217954**。檔名與行號以 b217954 為準。
> 相關文件：[desktop-ui.md](desktop-ui.md)（桌機殼層，已上線）、[desktop-polish.md](desktop-polish.md)（桌機打磨；PR 1 已上線，PR 2–5 未做）。**本文和 desktop-polish.md 的關係見 §1.3**：它的 §2 視覺規格改成全寬度適用，「手機逐像素不變」的硬性條件由本文取代。
> 截圖：repo 根目錄的 `.shots/`（不進 git，`.gitignore` 已列）。`before/` 是 b217954、`after-A/` 是 PR A、`after-B/` 是 PR B。子資料夾＝視窗寬度－主題（`390-light`、`1280-dark`…），量測數字在 `_meta/<視窗>/<頁面>.json`。下文用 `before/390-light/06-exams` 這種寫法引用（省略 `.png`）。工具與指令見[附錄](#附錄截圖與量測指令)。
> 標記：「（實測）」＝在 b217954 的建置產物＋Chromium 1243 上量到；「（計算）」＝用 token 色碼算出的 WCAG 對比；「（設計值）」＝實作時量、寫回本文。

**目錄**：[0. 摘要](#0-摘要)｜[1. 範圍與原則](#1-範圍與原則)｜[2. 稽核結果](#2-稽核結果)｜[3. 設計 token](#3-設計-token)｜[4. 元件規格](#4-元件規格)｜[5. 手機規則](#5-手機規則)｜[6. 深色模式](#6-深色模式)｜[7. 載入速度](#7-載入速度)｜[8. 分階段上線](#8-分階段上線)｜[9. PR A 實作備註](#9-pr-a-實作備註)｜[10. PR B 實作備註](#10-pr-b-實作備註)｜[附錄](#附錄截圖與量測指令)

---

## 0. 摘要

**一句話**：網站的底子不錯（顏色幾乎全是語意 token、深色模式已經有、沒有水平溢出、文字對比全部過關），問題在「同一種東西有很多版本」與「手機上的小地方」：按鈕、輸入框、卡片各有 9–35 種寫法；手機的導覽字 11.2 px、篩選膠囊 34 px 高；7 個頁面載入時版面跳動（CLS > 0.1，最高 0.5）；輸入框的框線對比只有 1.3:1。先把 token 定下來（PR A，已做），再收斂元件（PR B）、逐頁修手機（PR C）、處理版面跳動與效能預算（PR D）。

### 0.1 十個主要發現

| # | 發現 | 證據（實測） | 處理 |
|---|---|---|---|
| 1 | **載入時版面跳動**：頁面按需載入時頁尾先出現在「載入中…」下面，內容到了再被推走；題型頁的練習區塊、資料區塊載入後又推一次 | 390 寬 27 頁中 7 頁 CLS > 0.1：`/reading` 0.47、`/exams` 0.29、`/words` 0.25、`/writing/essay` 0.24；Lighthouse 行動版 `/reading` CLS 0.462、效能分數 62。位移來源 `footer.mx-auto.max-w-5xl`（每頁約 0.05–0.10）與 `section.rounded-2xl…`（`/reading` 0.41） | PR D §7.2 |
| 2 | **按鈕有 47 種寫法**：至少 9 個檔各自定義 `btnPrimary`／`primaryButton`／`primaryBtn`，字重（500／600）、左右內距（16／20）、hover（`opacity-90`／沒有）都不一樣 | `rounded-full bg-primary … text-on-primary` 的不同字串 47 種、分布在 59 個檔；`vocab/ui/styles.ts`、`account/styles.ts`、`assistant/components/parts.tsx`、`writing/components/ui.tsx`、`BankReport.tsx`、`BankPaperRoute.tsx`、`ProgressStats.tsx`、`PapersPage.tsx`… | PR B §4.1 |
| 3 | **輸入框看起來像灰色色塊**：框線 `--line` 對白底 1.30:1（WCAG 1.4.11 要 3:1）；有的欄位底色是 `bg-bg`、有的是 `bg-surface`，圓角 8 或 12 | 模擬考的預估分數欄（`before/390-light/09-mock-paper`）、中譯英作答框（`before/390-light/13-writing-translation-ai`）、學習助手貼上題目（`before/390-light/17-assistant-new`）；輸入框樣式 12 種 | PR A 已加 `--line-strong`（3.64:1），PR B 套用 |
| 4 | **手機導覽字 11.2 px**：底部導覽（每一頁都有）用 `text-[0.7rem]`；另有 5 處 0.65–0.7rem（模擬考題號面板、級分表、作文錯誤標號） | 390 寬每頁 5–7 個元素 < 12 px | PR C §5 |
| 5 | **手機點擊目標偏小**：篩選膠囊 34 px、學年度選單 33 px、作答頁「交卷」32 px、「看第 1 層提示」36 px、歷屆考卷的檔案連結 32 px、首頁「重新檢查」20 px 高 | `/exams`、`/writing/essay`、`/practice/cloze/advanced`、`/exams/gsat-115` 逐一量（§2.2） | PR B（元件尺寸）＋PR C |
| 6 | **卡片 35 種寫法**、圓角 7 種（`rounded-full` 289、`xl` 248、`2xl` 137、`lg` 67、`sm` 25…）、卡片內距 p-4／p-5／p-6 混用；可點的卡片和靜態卡片長得一樣 | `rounded-2xl border border-line bg-surface…` 的不同字串 35 種 | PR B §4.6 |
| 7 | **字級 14 種**，其中 5 種是任意值（`text-[0.95rem]` 155 處、`0.7rem`、`0.65rem`、`1.02rem`、`1.05rem`）；頁面標題 24／30 px、區塊標題 16／18／20 px 各自決定 | 390 寬實際畫出來的字級：11.2、12、14、15.2、16、16.32、18、20、24、30 px | PR A 定義 `text-title`…`text-meta`，PR B 起使用 |
| 8 | **停用的按鈕太淡**：主要按鈕停用時 `opacity-50`，淺色主題變成淡紫色、看不出是「不能按」還是「次要」，也沒寫原因 | 「寫好了，對照參考譯文」（`before/390-light/13-writing-translation-ai`）、帳號頁「儲存」（`before/390-light/20-account`） | PR B §4.1 |
| 9 | **深色模式已經有、而且大致正確**（跟隨系統＋手動、繪製前套用不閃爍、文字對比全部 ≥ 6:1），但**層次太平**：卡片對底色 1.09:1、框線 1.36:1，卡片和底色分不出來 | `before/390-dark/03-practice`、`before/1280-dark/06-exams` | PR A 已調 `--line`、`--surface-2`（§6.3） |
| 10 | **CSS 本身不是瓶頸**：一個 CSS 檔 69.6 KB（gzip 12.9 KB）、沒有網路字型、沒有阻擋渲染的字型；首次繪製慢是因為整站是 SPA，要等 113 KB（gzip）的主程式 | Lighthouse 行動版首頁 FCP 2.5 s、LCP 2.8 s、TBT 180 ms、unused-css 0、render-blocking 0 | PR D 只設預算與修位移，不拆 CSS（§7） |

其他：沒有任何頁面在 360／390／430 寬水平溢出（實測 27 頁 × 3 寬）；axe 的 color-contrast 在兩種主題、兩種寬度 0 違規（有 1–4 個「需要人工確認」，都是疊在半透明底上的字）。

### 0.2 四個 PR

| PR | 內容 | 畫面變化 | 狀態 |
|---|---|---|---|
| **A** | token（顏色角色淺色＋深色、字級、圓角、陰影、焦點框）與 Tailwind 對應；寫死的顏色換成 token；深色層次修正；token 守門測試；截圖與量測工具 | 淺色 0 變化（54 張中 52 張逐像素相同，2 張是 1 色階的反鋸齒雜訊）；深色只有框線與說明框變深 | **已做**（§9） |
| **B** | 共用元件：`Button`、`Field`、`Select`、`Check`、`Card`、`Badge`、`Table`、`Tabs`／`Segmented`／`ChoiceChip`、`Dialog`、`Toast`、`Alert`；各功能的樣式常數改成 re-export | 全站：輸入框邊界、按鈕一致、停用狀態、點擊目標 ≥ 44 | **已做**（§10） |
| **C** | 逐頁的手機修正（底部導覽字級、篩選列、作答工具列、題型頁難度切換、歷屆列表卡片、寫作與學習助手表單） | 手機 | 待做 |
| **D** | 版面位移（main 最小高度、骨架佔位）、長列表 `content-visibility`、CSS／JS 預算進 CI | 載入過程；最終畫面幾乎不變 | 待做 |

---

## 1. 範圍與原則

### 1.1 範圍

全站（`apps/web`）的樣式與共用元件：殼層（頂端列、底部導覽、側邊欄、頁尾）、所有路由頁、對話框。**不含** PDF 版面（`features/pdf/`，pdfmake 自己畫）、拍照裁切的遮罩（照片專用、兩種主題都是黑色半透明）、圖表的類別色（已經用 dataviz 驗證過）、數學模組（另一個分支在做，不碰 `math` 相關檔案）。

### 1.2 原則

1. **先 token、再元件、最後逐頁**。元件只用語意 token（`bg-surface`、`border-line-strong`、`text-meta`），不寫色碼、不寫 `bg-white`／`bg-black/40`、不寫任意字級。
2. **淺色主題的外觀是「修正」不是「改版」**：配色、品牌色、圓潤的膠囊按鈕都保留；改的是一致性、對比、尺寸。每個 PR 附前後截圖，非預期的差異要說得出原因。
3. **手機優先**：每個元件先定手機的尺寸（點擊目標 44、內文 16、介面字 14），桌機的差異用 `lg:` 加上去。
4. **不用 Tailwind 的 `dark:`**：它只看系統設定，不看本站手動切換的 `data-theme`（desktop-polish.md M3，實測）。深淺色的差異一律寫成變數。
5. **兩種主題一起驗**：每個 PR 的截圖、axe、token 測試都跑淺色與深色。

### 1.3 和 desktop-polish.md 的關係

desktop-polish.md 的 §2 視覺規格（token、字級、間距、按鈕、表單、選擇控制項、表格、標章、揭露、浮層、空白與載入）寫得很完整，**本文直接採用**，只改兩件事：

- **適用寬度**：它的 M1「手機與平板逐像素不變」、M2「改既有 token 只在 ≥ lg」是為了那次只改桌機；這次站主要求手機也要改，所以 §2 的規格改成**全寬度適用**，手機的尺寸依本文 §5 調整（例如按鈕 `md` 在手機也是 44 高，桌機才是 40）。
- **深色層次**：它在 ≥ lg 才調深的 `--line`、`--surface-2`，本文在 PR A 全寬度調深（§6.3）。

desktop-polish.md 的 PR 2（外觀基礎）＝本文的 PR B＋PR C 的桌機部分；PR 3–5（作答頁、寫作工作區、首頁與列表的版面與互動）不在本文範圍，之後照它的設計做時，樣式一律用本文的 token 與元件。

---

## 2. 稽核結果

方法：`tests/visual/theme/`（PR A 新增）在 27 個主要路由（首頁未登入／已登入、單字、單字測驗、題庫練習、題型頁、兩種作答頁、歷屆列表與一份考卷、模擬考列表與一份考卷、寫作入口、作文列表、作文作答、本站仿真中譯英與作文、批改結果、學習助手首頁、貼上題目、學習報告、帳號未登入與已登入、設定、後台、關於、國寫範文）各截一張整頁圖，並在頁面裡量字級、點擊目標、水平溢出、CLS 與 axe 的 color-contrast。後端一律是假的（`tests/support/backend.ts`），時間固定。視窗：390×844、1280×800（淺色＋深色），另外 360×780、430×932（淺色）。

### 2.1 視覺質感

**顏色**：程式裡幾乎沒有寫死的顏色（實測：Tailwind 顏色類別 3,057 處用 token，只有 17 處寫死：`bg-black/40`、`/45`、`/50`、`bg-white`、`fill-current`、`border-transparent`）。但 token 加透明度的組合有 30 種（`bg-bad/10`、`border-bad/40`、`border-badge-fg/30`、`bg-badge-bg/60`…），同一個意思（「錯誤的淡底」）有 `/5`、`/10`、`/15`、`/20` 四種濃度。

**字級**（實測，src 掃描）：14 種、1,679 處。`text-sm` 1,017、`text-xs` 234、`text-[0.95rem]` 155（大多是 `lg:`）、`text-lg` 123、`text-2xl` 63、`text-3xl` 34、`text-xl` 23、`text-base` 9、`text-4xl` 6、`text-5xl` 4，以及任意值 `0.7rem`×5、`0.65rem`×2、`1.02rem`×3、`1.05rem`×1。字重 4 種（`semibold` 621、`medium` 362、`bold` 91、`normal` 55），500 和 600 沒有規則地混用（按鈕兩種都有）。

**圓角** 7 種、**陰影** 2 種（`shadow-lg` 8 處給浮層，另 1 處裁切框）、**間距** 41 種值（大多是 1–6 的標準刻度，問題不大）。

**元件的版本數**（實測，同一種元件不同的 class 字串）：

| 元件 | 版本數 | 例子 |
|---|---|---|
| 主要按鈕 | 47（59 個檔） | `font-medium px-5 hover:opacity-90`（vocab、account）、`font-semibold px-5`、`font-medium px-4`（`ProgressStats`、`BankPaperRoute`）、`aria-disabled:opacity-60`（`PapersPage`） |
| 卡片 | 35 | `p-4`、`p-4 sm:p-5 lg:p-6`、`p-4 lg:p-5`、`p-5`；作答頁 `scroll-mt-32` |
| 輸入框 | 12 | `rounded-lg bg-bg focus:border-primary`（寫作、學習助手）、`rounded-xl bg-surface min-h-11`（單字、帳號） |
| `<details>` 揭露 | 47 處，原生 ▶ 與自訂箭頭混用 | 批改結果的「題目」（`before/390-light/15-writing-submission`） |
| 表格 | 33 個 `<table>`；`DataTable` 之外各自寫 | 大題結構（`before/390-light/09-mock-paper`）、評分者表 |
| 分頁／切換 | 底線分頁、分段膠囊、卡片式分頁、實心膠囊 4 種 | `/words` 卡片式分頁（`before/390-light/02-words`）、作文列表實心膠囊（`before/390-light/11-writing-essay-list`）、學習助手拍照／貼上（`before/390-light/17-assistant-new`） |

**看得到的問題**（截圖）：

- 一個畫面好幾個實心主色：作文列表的「歷屆試題」分頁與「全部 66」篩選都是實心（`before/390-light/11-writing-essay-list`），和「開始」按鈕一樣重。
- 輸入框邊界看不出來（#3）；模擬考預估分數欄是一塊灰底（`before/390-light/09-mock-paper`、`before/1280-light/09-mock-paper`）。
- 停用狀態是半透明（#8）。
- 主要按鈕的高度：`開始作答` 43 px、`開始` 44 px、`下載 PDF（考試格式）` 44 px，但字重與內距不同，並排時看得出來（`before/390-light/08-mock`）。

### 2.2 手機版（360–430）

**水平溢出**：27 頁 × 360／390／430 都沒有（`scrollWidth = clientWidth`）。360 寬的批改結果頁評分者表比容器寬 25 px，但在可水平捲動的容器裡（`min-w-[22rem]`），不算溢出；容器沒有 `tabIndex`、鍵盤捲不到（desktop-polish §2.9 已列）。

**小字**（實測，可見文字的元素）：

| 字級 | 390 寬總數（27 頁） | 在哪裡 |
|---|---|---|
| 11.2 px | 139（每頁 5–7） | 底部導覽的五個標籤（`Layout.tsx` `bottomItemClass` 的 `text-[0.7rem]`）；作文錯誤標號 |
| 12 px | 1,160 | 標章、歷屆列表卡片裡的題型膠囊（`/exams` 一頁 886 個）、`/words` 分頁標籤與級別、難度方塊的「61 組・已做 0」 |
| 14 px | 998 | 次要說明 |
| 15.2 px | 175 | `text-[0.95rem]` 沒有加 `lg:` 的地方 |

**點擊目標 < 44 px**（實測，390 寬；包在 `<label>` 裡的 radio／checkbox 以 label 計）：

| 頁面 | 元素 | 尺寸 |
|---|---|---|
| 每一頁 | 頂端列的主題切換鈕 | 40×40 |
| 首頁 | 後端狀態的「重新檢查」 | 90×20 |
| `/exams`、`/writing/essay` | 考試別篩選膠囊、學年度選單 | 高 34、33 |
| 作答頁（題庫、歷屆、模擬考） | 工具列的「交卷」 | 60×32 |
| 綜合測驗、文意選填 | 選文裡的空格按鈕 | 高 32（行內，WCAG 2.5.8 例外；但手指常點錯行） |
| 題庫作答 | 「看第 1 層提示」 | 110×36 |
| `/exams/gsat-115` | 官方檔案連結（試題 PDF、答案…） | 高 32 |

**擠、不好讀的地方**（截圖）：

- 題型頁的難度切換（`before/390-light/04-reading-section`）：三個方塊各 100 px 寬，兩行字（「穩定基礎」＋「61 組・已做 0」12 px）。
- 歷屆列表（`before/390-light/06-exams`）：66 張卡片、每張 8 個 12 px 的題型膠囊，整頁 14,256 px 高；手機上題型結構其實可以收成一行文字。
- 作文列表（`before/390-light/11-writing-essay-list`）13,160 px 高，篩選列不黏頂。
- 作答頁工具列（`before/390-light/05-practice-session-reading`）：「題庫練習」標章 12 px、計時、已答、交卷擠在一列。
- 底部導覽的「更多」選中時，上方的頁面標題沒有對應（學習助手、寫作都在「更多」裡）。

### 2.3 載入速度

| 項目 | 實測 |
|---|---|
| CSS | 1 個檔 `index-*.css`：69,575 B，gzip 12,716 B（-9）。Tailwind 只輸出用到的類別；`@layer utilities` 54.5 KB、`@layer base`（preflight）4.5 KB、主題變數 1.6 KB、列印樣式 1.5 KB、深色兩個區塊共 1 KB |
| 媒體查詢 | `lg`（64rem）13 段、`hover` 5、其他斷點 7、`forced-colors` 2、`print` 2；`lg:` 開頭的選擇器 162 個（約 21%） |
| JS | 主程式 `index-*.js` 352 KB（gzip 112.9 KB）；其餘 218 個按需載入的 chunk |
| 字型 | **沒有網路字型**：系統字型堆疊（`-apple-system`… `PingFang TC`、`Noto Sans TC`、`Microsoft JhengHei`）；國文文言用系統襯線字。沒有 FOIT／FOUT，也沒有字型造成的位移。PDF 的字型只在按「下載 PDF」時載入 |
| 主題 | `index.html` 的同步腳本在繪製前設 `data-theme`；CSS 是阻擋渲染的 `<link>`，第一次繪製就是正確的主題（深色不閃白，§6.4） |
| Lighthouse 行動版（模擬 4G、4× CPU） | 首頁：效能 90、FCP 2.5 s、LCP 2.8 s、TBT 180 ms、CLS 0。`/exams`：95、2.2／2.5 s、CLS 0。**`/reading`：62、LCP 4.5 s、CLS 0.462**。`/practice/reading/basic`：76、FCP 2.9 s、LCP 4.8 s、CLS 0.074。四頁的 unused-css、render-blocking 節省都是 0；無障礙分數 100 |
| CLS（Playwright 的 PerformanceObserver，載入到截圖） | 390 寬：7／27 頁 > 0.1（`/reading` 0.47、`/exams` 0.29、`/words` 0.25、`/writing/essay` 0.24、批改結果 0.16、學習報告 0.12、本站仿真作文 0.11）；360 寬 9／27；1280 寬 6／27（`/reading` 0.30、後台 0.26）。同一頁兩次執行會差 ±0.05（資料到達的時機） |

**位移的原因**（`_meta/*/*.json` 的 `clsSources`）：

1. **頁尾被推走**：`Layout` 的 `<main>` 在手機沒有最小高度，路由的 chunk 還沒到時只有一行「載入中…」，頁尾緊接在下面；內容到了把頁尾推到下面（每頁 0.04–0.10）。桌機有 `lg:min-h-dvh lg:flex-1`，所以 1280 寬少很多。
2. **資料區塊後到**：題型頁先畫難度切換，練習區塊（`section.rounded-2xl…p-5`）載入題組後才出現（`/reading` 0.41）；歷屆列表與作文列表的頁尾說明（`footer.rounded-2xl…p-4`）先出現、列表到了才被推下去（0.18–0.22）。
3. 後台的檢查結果區塊（0.45，只有管理員看得到）。

### 2.4 深色模式

**已經有**（b217954）：

- 三種偏好：跟隨系統（預設，`<html>` 沒有 `data-theme`，CSS 媒體查詢接手，不需要 JS）、淺色、深色（`data-theme`，存在 `localStorage['gsat-theme']`，每台裝置各自記）。
- 繪製前套用：`index.html` 的同步腳本（`lib/theme.ts` 有同樣的鍵名），不閃爍。網址列顏色（`theme-color`）由 `theme.ts` 載入時同步。
- 切換的位置：手機在頂端列右上角（月亮／太陽圖示，淺色 ↔ 深色）、桌機在側邊欄底部；設定頁「外觀主題」有三個選項（跟隨系統／淺色／深色）。快速鈕只在淺深之間切換是刻意的（三態循環從圖示看不出下一步，`ThemeToggle.tsx` 的註解），回到跟隨系統到設定頁。
- 全部顏色都是變數，`@theme inline` 對應成 Tailwind 顏色；圖表另有深色的類別色；列印一律淺色。

**對比**（計算，b217954 的值）：

| 組合 | 淺色 | 深色 |
|---|---|---|
| fg／bg、surface | 15.45、16.56 | 15.30、14.05 |
| muted／bg、surface、surface-2 | 5.87、6.29、5.55 | 7.55、6.93、6.09 |
| primary／surface、primary-soft | 7.93、6.66 | 8.22、6.59 |
| on-primary／primary | 7.93 | 8.95 |
| badge-fg／badge-bg | 6.89 | 9.30 |
| ok、bad／surface | 5.39、6.57 | 9.15、7.50 |
| **line／surface、bg**（輸入框、卡片框線） | **1.30、1.22** | **1.36、1.48** |
| **surface／bg**（卡片和底色） | 1.07 | **1.09** |
| surface-2／surface | 1.13 | 1.14 |

axe color-contrast（實測，27 頁 × 390／1280 × 淺色／深色）：0 違規。

**要修的**：

1. 卡片層次太平（深色 1.09、框線 1.36）→ PR A 調深框線與 `surface-2`（§6.3）。
2. 輸入框邊界兩種主題都不到 3:1 → PR A 加 `--line-strong`，PR B 套用。
3. 深色時實心主色是亮紫（`#9db0ff`），一頁好幾塊時很刺眼（`before/390-dark/12-writing-essay-exam` 的「打字作答」、`before/1280-dark/06-exams` 的「全部 66」）→ PR B 的選擇控制項改成淡底＋主色框（desktop-polish §2.8）。
4. 停用按鈕在深色更看不出來（`before/390-dark/13-writing-translation-ai`）→ PR B。

---

## 3. 設計 token

全部定義在 `apps/web/src/index.css`。顏色是 `:root` 上的 CSS 變數（淺色值），深色值寫在 `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }` 與 `:root[data-theme='dark'] {…}` 兩個區塊（內容相同，`lib/tokens.test.ts` 檢查）；`@theme inline` 把它們對應成 Tailwind 顏色（`bg-surface`、`border-line-strong`…，產生的 CSS 直接寫 `var(--surface)`，執行期換 `data-theme` 就生效）。字級、圓角寫在 `@theme`（產生 `text-title`、`rounded-card`…）。

### 3.1 顏色角色

| token（Tailwind 名稱） | 淺色 | 深色 | 用途 | 對比（計算） |
|---|---|---|---|---|
| `bg` | `#f6f7f9` | `#0f1318` | 頁面底色 | — |
| `surface` | `#ffffff` | `#171c23` | 卡片、sticky 列、對話框、**輸入框** | — |
| `surface-2` | `#eef1f5` | `#232b36`（原 `#202731`） | 表頭、說明框、分段控制的軌道、骨架 | 對 surface：淺 1.13、深 1.20 |
| `fg` | `#1a1f26` | `#e5e9ef` | 主要文字 | ≥ 14:1 |
| `muted` | `#566170` | `#9ba6b4` | 次要文字、標籤、說明 | 對 surface-2：淺 5.55、深 5.79 |
| `line` | `#dde2e8` | `#343e4b`（原 `#2b3440`） | 裝飾性框線：卡片、分隔線 | 深色對 surface 1.58 |
| `line-subtle` **新** | `#dde2e8` | `#2b3440` | 密集表格的列分隔 | — |
| `line-strong` **新** | `#7d8794` | `#6b7686` | **互動元件的邊界**：輸入框、選單、文字框、未選中的膠囊與 checkbox 卡片 | 對 bg／surface／surface-2：淺 3.40／3.64／3.22、深 4.05／3.72／3.27 |
| `primary` | `#3149a8` | `#9db0ff` | 主要按鈕、連結、選中的字與框 | 對 surface：淺 7.93、深 8.22 |
| `primary-hover` **新** | `#283d8f` | `#b8c6ff` | 主要按鈕 hover／按下 | on-primary 在上面：淺 9.75、深 11.15 |
| `primary-soft` | `#e6ebfb` | `#232c4a` | 選中的淡底、目前題 | primary 在上面：6.66、6.59 |
| `on-primary` | `#ffffff` | `#0f1318` | 主色上的字 | — |
| `ok`／`ok-soft` **新** | `#1b7a3d`／ok 10% | `#5ad48a`／ok 10% | 答對、完成；淡底 | ok 對 surface：5.39、9.15 |
| `bad`／`bad-soft` **新**／`bad-line` **新** | `#b42318`／10%／40% | `#ff8a80`／10%／40% | 答錯、錯誤；淡底；框線 | bad 對 surface：6.57、7.50 |
| `badge-bg`／`badge-fg`／`badge-line` **新** | `#fdf0c8`／`#7a4508`／fg 30% | `#3a2c0c`／`#f6d270`／fg 30% | 提醒、AI 標示（警示色） | 6.89、9.30 |
| `scrim`／`scrim-strong` **新** | 黑 40%／50% | 同左 | 對話框與抽屜的遮罩 | — |
| `paper` **新** | `#ffffff` | `#ffffff` | 插圖、題目圖片的底（黑線條的圖在深色也清楚） | — |
| `--focus-ring` **新** | ＝primary | ＝primary | 焦點框 | ≥ 3:1（對所有表面） |
| `--chart-1…8` | 不變 | 不變 | 圖表類別色（dataviz 驗證過） | — |

`-soft`、`-line` 用 `color-mix(in oklab, var(--x) N%, transparent)` 定義在 `:root`，跟著當下主題的 `--x` 換色；和原本 Tailwind 的 `bg-bad/10` 算法相同，替換後畫面不變。**新程式碼不要再寫 `bg-bad/15` 這類濃度**：需要新的濃度時加 token。

不做的：品牌色不換；不加第二個強調色；`info` 不另外做（用 `primary-soft`＋`primary`）。

### 3.2 字級

沿用 desktop-polish §2.2 的角色，PR A 已在 `@theme` 定義（自帶行高與字重）；手機與桌機同一個值，只有標題在手機小一級：

| 工具類別 | 手機 | 桌機（`lg:`） | 用在 |
|---|---|---|---|
| `text-title` | 1.5rem（24）／1.35／700，寫成 `text-title-ws lg:text-title` | 1.75rem（28）／1.3／700 | 每頁的 H1 |
| `text-title-ws` | 1.5rem／1.35／700 | 同 | 工作區頁的 H1（作答、寫作、批改結果） |
| `text-section` | 1.125rem（18）／1.45／600（寫成 `text-lg font-semibold lg:text-section`） | 1.25rem（20） | H2 區塊標題 |
| `text-card` | 1.0625rem（17）／1.5／600 | 同 | H3、卡片標題 |
| `text-body` | 1rem（16）／1.75 | 同 | 內文、題目、說明；**取代 `text-[0.95rem]`** |
| `text-meta` | 0.875rem（14）／1.6 | 同 | 次要資訊、標籤、表頭、卡片 meta |
| `text-xs`（Tailwind 內建） | 0.75rem（12）／1.5 | 同 | **下限**：標章、時間戳、圖說 |

- **字級下限**：內文 16、介面文字 14、標章與時間戳 12。0.65rem、0.7rem 全部拿掉（底部導覽改 12 px，§5）。
- 字重只用三種：700（H1、統計數字）、600（H2、H3、按鈕、選中）、400（其他）。`font-medium`（500）逐步換掉。
- 中文標題不用 `tracking-tight`；數字一律 `tabular-nums`。
- 英文選文另有 `text-passage`（desktop-polish §2.2，作答頁改版時加）。

### 3.3 間距

4 px 刻度，只用 `1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12`（4–48 px）。規則：

| 位置 | 手機 | 桌機 |
|---|---|---|
| 頁面左右 | 16（`px-4`） | `--page-px`（40；工作區 32） |
| 頁首 → 第一個區塊 | 24 | 32 |
| 區塊之間 | 24（`space-y-6`） | 32 |
| 卡片內距 | 16（`p-4`） | 區塊卡 24、列表卡 20 |
| 卡片標題 → 內容 | 12 | 12 |
| 同一列按鈕 | 8 | 8 |
| 表單欄位之間／標籤 → 欄位 | 16／6 | 同 |

### 3.4 圓角

`rounded-card`（16）卡片、對話框；`rounded-control`（10）輸入框、選單、選項卡、說明框；`rounded-nav`（8）側邊欄項目；`rounded-full` 按鈕、膠囊、標章。內層圓角＝外層 − 內距，最少 6。其餘（`rounded-lg`、`xl`、`2xl`、`sm`、`md`）在 PR B／C 碰到時換掉。

### 3.5 陰影與層次

| token | 淺色 | 深色 | 用途 |
|---|---|---|---|
| `--shadow-card` | `0 1px 2px rgb(16 24 40/.05), 0 1px 3px rgb(16 24 40/.04)` | `none` | **只給可點的卡片**（學生不用 hover 就知道哪裡能點） |
| `--shadow-card-hover` | `0 4px 12px rgb(16 24 40/.08)` | `none` | 可點卡片 hover |
| `--shadow-pop` | ＝Tailwind `shadow-lg` | `0 10px 30px rgb(0 0 0/.5)` | 對話框、選單、提示泡泡 |

用法：`shadow-(--shadow-card)`。深色主題的層次靠 `surface`／`surface-2` 與 `line`，不靠陰影。高對比模式（`forced-colors`）陰影會被拿掉，框線一定要在。

### 3.6 焦點框

全站 `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px }`（PR A 改成讀 token）。規則：不拿掉 outline、不用 `ring` 取代；輸入框聚焦時只有欄位本身的框，外層卡片不再另外亮（desktop-polish §2.7）；sticky 列下方用 `scroll-padding-top` 避免焦點被蓋住（已有）。

### 3.7 動態

只有顏色、陰影、揭露箭頭的轉場，≤ 150 ms；`prefers-reduced-motion` 時全部關掉（含 `animate-pulse`）。

---

## 4. 元件規格

PR B 新增 `apps/web/src/components/ui/`，各功能現有的樣式常數（`vocab/ui/styles.ts`、`account/styles.ts`、`assistant/components/parts.tsx`、`writing/components/ui.tsx`、`exams/components/Questions.tsx`…）改成從這裡 re-export，import 不用改；之後新程式碼只用這裡的東西。字串常數（`btn('primary','md')`）與 React 元件（`<Button>`）兩種都提供：大部分地方是 `<Link>`、`<button>`、`<label>` 加 class，用常數最省事。

尺寸的通則：**手機的互動元件至少 44 px 高**（WCAG 2.5.5 建議值）；桌機在密集的地方（工具列、表格、sticky 篩選列）可以到 36。

### 4.1 按鈕

| 尺寸 | 手機 | 桌機 | 用在 |
|---|---|---|---|
| `lg` | 高 48、`px-6`、16／600 | 高 44 | 頁面唯一的主要動作（開始作答、送出批改） |
| `md`（預設） | 高 44、`px-5`、16／600 | 高 40、`px-4`、15／600 | 一般 |
| `sm` | 高 44（觸控區），視覺 36：`min-h-11` 外加 `py` 內縮 | 高 36、`px-3.5`、14／600 | 工具列（交卷）、表格列、篩選列 |
| `icon` | 44×44 | 40×40 | 主題切換、關閉、側邊欄工具 |

| 樣式 | 外觀 | 用在 |
|---|---|---|
| `primary` | `bg-primary text-on-primary`；hover／按下 `bg-primary-hover` | 每個區塊**一個** |
| `secondary` | `bg-surface border border-line-strong text-fg`；hover `border-primary text-primary` | 次要動作（下載 PDF、問學習助手、回到列表） |
| `ghost` | `text-primary`；hover `bg-primary-soft` | 第三順位（看提示、展開） |
| `danger` | `bg-bad text-on-primary` | 確認列裡的「確定清除」 |
| `danger-ghost` | `text-bad`；hover `bg-bad-soft` | 觸發破壞性動作（清除作答、登出所有裝置） |

- **停用**：`bg-surface-2 text-muted border-transparent cursor-not-allowed`（不再用 `opacity-50`），旁邊寫原因（「兩句都寫完才能對照」）；`aria-disabled` 與 `disabled` 都吃同一組樣式。
- **處理中**：文字換成「送出中…」、`aria-busy="true"`、寬度不變（`min-w` 鎖住，不跳動）。
- 一律 `rounded-full`；圖示 18 px（`sm` 16）、和文字間距 8。
- 同一列同一個尺寸；主要動作在左（手機在上）；破壞性動作和其他按鈕分開。

### 4.2 輸入框（text、number、textarea）

| 項目 | 規格 |
|---|---|
| 外觀 | `rounded-control border border-line-strong bg-surface text-fg text-body px-3`；placeholder `text-muted` |
| 高度 | 手機 48、桌機 40（`min-h-12 lg:min-h-10`）；textarea 至少 4 行、`resize-y` |
| 標籤 | 在上方，`text-meta font-semibold text-fg`，間距 6；必填寫「（必填）」文字，不只靠星號 |
| 說明 | 下方 `text-meta text-muted`，`aria-describedby` |
| 錯誤 | `border-bad`＋`aria-invalid`；下方 `text-meta text-bad`＋`AlertCircle` 16 px |
| 停用 | `bg-surface-2 text-muted border-line` |
| 焦點 | 全站焦點框（§3.6），外層卡片不亮 |
| 數字 | `w-24 text-right tabular-nums`（模擬考預估分數） |
| 英文作答 | 沿用 `englishInputProps`（關拼字檢查、自動大寫） |

字級 16 px 也是為了 iOS Safari：輸入框字級 < 16 時聚焦會自動放大頁面。

### 4.3 選單（select）

和輸入框同一個外觀與高度；右側 `ChevronDown` 16 px（`appearance-none` 加背景圖示或包一層），留 `pr-9`。學習報告的版本選單不再是膠囊。

### 4.4 checkbox／radio

- 原生元件，`size-5`（20 px）、`accent-primary`；整個 `<label>` 是點擊範圍，最少 44 高（`min-h-11 flex items-center gap-3`）。
- 做成選項卡時（設定頁主題、單字測驗題型、帳號年齡）：`rounded-control border border-line-strong bg-surface p-3`；選中 `border-primary bg-primary-soft`；`has-[:checked]:` 寫在 label 上，不另外存狀態。
- **作答的選項卡**（`Questions.tsx`）不換 `line-strong`：一題 4–10 個選項加深框線會讓試卷很吵；原生 radio 本身就有 ≥ 3:1 的邊界（desktop-polish §2.7）。

### 4.5 選擇控制項（分頁、分段、篩選、難度）

採用 desktop-polish §2.8 的四種角色與外觀（底線分頁 `SubNav`／`PaneTabs`、`Segmented`、`ChoiceChip`、`TierPicker`），**全寬度適用**，手機的調整：

- `ChoiceChip`：手機高 40、觸控區用 `before:` 偽元素撐到 44（`relative before:absolute before:-inset-y-0.5 before:inset-x-0`）；一列放不下時橫向捲動（`overflow-x-auto snap-x`，左右留 16 px 漸層提示），不折成兩三行。
- `Segmented`：手機撐滿寬度（`grid grid-flow-col auto-cols-fr`），每段 44 高。
- `SubNav`：手機橫向捲動、目前那一個自動捲進畫面。
- **實心主色只給主要按鈕**；選中＝`primary-soft` 底＋`primary` 字與框，多選另加勾號。

### 4.6 卡片

| 種類 | 外觀 | 用在 |
|---|---|---|
| 區塊卡 | `rounded-card border border-line bg-surface p-4 lg:p-6`，沒有陰影 | 表單、說明、結果 |
| 可點卡片 | 區塊卡＋`shadow-(--shadow-card)`、右上 `ChevronRight`；hover `border-primary shadow-(--shadow-card-hover)`；整張是一個 `<a>` | 首頁入口、題目列表、學習助手動作 |
| 說明框 | `rounded-control bg-surface-2 p-4`，無框線 | 「三種難度給誰」、空白提示 |
| 結果卡 | 區塊卡＋頂端 `bg-primary-soft` 標題列 | 交卷結果、成績單、批改總分 |

不放卡中卡；虛線框只給空白狀態與「出題中」。

### 4.7 標章

`Badge`（`tone: neutral | primary | ok | bad | warn | ai`，`size: xs | sm`），採 desktop-polish §2.10：`xs` 高 20、`px-2`、12／600；`sm` 高 24、14／600。顏色：neutral `bg-surface-2 text-muted`、primary `bg-primary-soft text-primary`、ok `bg-ok-soft text-ok`、bad `bg-bad-soft text-bad`、warn／ai `bg-badge-bg text-badge-fg`（ai 加 `Sparkles`）。狀態一定有文字或圖示。歷屆列表卡片的 8 個題型膠囊在手機改成一行 `text-meta` 文字（「詞10・綜10・文10・篇4・閱12・混4・譯2・作1」），不再是 8 個標章（§5.3）。

### 4.8 表格

`Table`／`ScrollRegion`（desktop-polish §2.9）：表頭 `bg-surface-2 text-meta font-semibold text-muted`、儲存格 `py-2.5 px-3 border-b border-line-subtle text-body`、數字欄 `text-right tabular-nums`。**手機**：4 欄以內的表格直接放（大題結構）；更寬的包 `ScrollRegion`（`overflow-x-auto`＋`tabIndex=0`＋`role="region"`＋`aria-label`），第一欄 `sticky left-0 bg-surface`；不在手機上把表格拆成卡片（資料表的列比較才是重點）。

### 4.9 分頁（tabs）

`PaneTabs`（已有，`role="tablist"`）與 `SubNav`（換頁用 `<nav>`＋`aria-current`）同一個外觀：高 44（桌機 40）、`text-meta font-semibold`；目前 `text-primary`＋2 px 主色底線；其他 `text-muted`，hover `text-fg`；整列下方 1 px `border-line`。`/words` 的卡片式分頁（圖示在上、字在下）改成這個（字級從 12 到 14）。

### 4.10 對話框

共用 `Dialog`（原生 `<dialog>`＋`showModal`）：`rounded-card border border-line bg-surface shadow-(--shadow-pop)`、`backdrop:bg-scrim`（模擬考交卷 `bg-scrim-strong`）；標題列＋右上關閉（44×44、`aria-label="關閉"`）、可捲動的內容、**固定在底部的動作列**（`border-t border-line`）。手機：寬 `calc(100% - 2rem)`、最高 `85dvh`，動作列按鈕撐滿寬度、上下排列（主要在上）。焦點：打開時到第一個動作（破壞性的確認例外：到「取消」），關閉時回到觸發的按鈕；Esc 關閉。現有 5 個 `<dialog>`（`ShortcutHelp`、`LeaveSessionDialog`、Layout 的說明載入失敗、模擬考 `SubmitDialog`、`ExemplarSiteMatchDialog`）換成它。

### 4.11 Toast（短暫通知）

目前**沒有** toast（存檔、複製之類的回饋都寫在按鈕旁邊的 `role="status"`，99 處）。規則：**優先就地回饋**（按鈕旁的狀態文字）；只有「動作的結果不在畫面上」時才用 toast（例如登出所有裝置、背景同步失敗）。規格：固定在底部導覽上方（手機 `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]`）／桌機右下，`rounded-control bg-fg text-bg px-4 py-3 text-meta shadow-(--shadow-pop)`，一次一則、4 秒後消失（滑鼠移上或聚焦時暫停），容器是常駐的 `aria-live="polite"`；有動作（「復原」）時不自動消失。`prefers-reduced-motion` 不滑入。PR B 先做元件，不主動改現有的就地回饋。

### 4.12 Alert（頁面內提示）

| tone | 外觀 | 例子 |
|---|---|---|
| info | `rounded-control bg-surface-2 p-4`＋`Info` | 作答紀錄只存在這台裝置 |
| warn／ai | `rounded-control border border-badge-line bg-badge-bg text-badge-fg p-4`＋`AlertTriangle`／`Sparkles` | AI 批改僅供參考（`AiNotice`） |
| error | `rounded-control border border-bad-line bg-bad-soft p-4`＋`AlertCircle`；字用 `text-fg`、標題 `text-bad` | 送出失敗、連不上伺服器 |
| success | `rounded-control border border-ok/40 bg-ok-soft p-4`＋`CheckCircle2` | 已核准、檢查全部通過 |

錯誤一律寫：發生什麼（白話）、什麼仍然能用、下一步（「再試一次」`secondary sm`）；不寫錯誤碼、HTTP、「後端」。`role="alert"` 只給使用者動作後出現的錯誤，常駐的提示不要用（現有 38 處要逐一檢查）。

---

## 5. 手機規則

適用 < 1024 px（Tailwind 的 `lg` 以下），驗收在 360、390、430 三種寬度。

### 5.1 通則

1. **點擊目標 ≥ 44×44**：按鈕、連結列、篩選膠囊、選單、checkbox 的 label、工具列按鈕。視覺上要小的（工具列的「交卷」、行內的空格）用透明的觸控區撐大（`relative before:absolute before:-inset-2`），兩個目標的觸控區不能重疊；段落裡的行內連結例外（WCAG 2.5.8）。
2. **字級下限**：內文 16、介面文字 14、標章／時間戳／導覽標籤 12。不得出現 < 12 px 的字（量測工具的 `tiny12` 要是 0）。
3. **不水平溢出**：頁面寬度＝視窗寬度。長英文字、網址用 `break-words`／`overflow-wrap: anywhere`；寬表格包 `ScrollRegion`；圖片 `max-w-full h-auto`；固定寬度一律寫 `max-w-full` 或 `min(…, 100%)`。
4. **安全區**：底部導覽、固定在底部的動作列加 `env(safe-area-inset-bottom)`（已有 `viewport-fit=cover`）；頂端 sticky 列不被瀏海蓋住。
5. **一列放不下時**：篩選與分頁橫向捲動、不折行；按鈕列折成上下排列、撐滿寬度；「標籤：值」在 < 400 px 時上下排。
6. **sticky**：手機上最多一條 sticky 列（頂端列或作答工具列，不會兩條都黏）；高度 ≤ 56。
7. **不要只靠 hover**：hover 才出現的資訊在手機一定有別的入口。

### 5.2 殼層

- 底部導覽：標籤 12 px（`text-xs`，原 11.2）、圖示 22、每格至少 56 高（含安全區另加）；「更多」裡的頁面（寫作、學習助手、設定…）打開時「更多」顯示選中。
- 頂端列：主題切換、帳號鈕 44×44（原 40）。
- 頁尾：`<main>` 在手機也撐滿視窗高（§7.2），頁尾不再在內容載入前出現在畫面中間。

### 5.3 逐頁（PR C 的清單）

| 頁面 | 問題（截圖） | 改法 |
|---|---|---|
| `/exams` | 66 張卡片 × 8 個 12 px 標章，14,256 px 高；篩選膠囊 34 高、學年度選單 33 高（`before/390-light/06-exams`） | 題型結構改一行 `text-meta`；卡片只留年度、名稱、題數與進度；篩選列用 `ChoiceChip`（橫向捲動）＋`Select`，捲動時黏在頂端列下方 |
| `/writing/essay`、`/writing/translation` | 13,160 px 高；兩層實心主色（`before/390-light/11-writing-essay-list`） | `SubNav`＋`ChoiceChip`；卡片題目摘要 2 行 |
| 題型頁（`/reading` 等） | 難度方塊擠、12 px；練習區塊載入後推動版面（`before/390-light/04-reading-section`） | `TierPicker compact`（一行：名稱＋「61 組」）；練習區塊先佔高度 |
| 作答頁（題庫、歷屆、模擬考） | 工具列擠、「交卷」32 高（`before/390-light/05-practice-session-reading`） | 工具列兩區：左「已答 0／4・0:00」、右「交卷」`sm`（觸控區 44）；「題庫練習」標章拿掉（標題已經說了） |
| 綜合測驗、文意選填 | 選文裡的空格按鈕 32 高 | 行高 2（`leading-8`）讓兩行的空格不重疊，觸控區上下各撐 6 px |
| `/words` | 卡片式分頁 12 px；單字庫 7,051 px 高、CLS 0.25（`before/390-light/02-words`） | `SubNav`（14 px）；列表 `content-visibility`（§7.3） |
| `/exams/:id` | 官方檔案連結 32 高 | 連結列 `min-h-11`，一行一個 |
| 模擬考開考前 | 預估分數欄是灰色色塊（`before/390-light/09-mock-paper`） | `Field` 數字欄 |
| 中譯英、作文作答 | 作答框灰底、停用按鈕看不出來（`before/390-light/13-writing-translation-ai`） | `Field`／`Button` 停用樣式＋原因 |
| 批改結果 | 錯誤標號 11.2 px、9×32 的點擊目標；評分者表在 360 寬要橫捲（`before/360-light/15-writing-submission`） | 標號 12 px、觸控區 24×24 以上；表格 `ScrollRegion` |
| 首頁 | 「重新檢查」20 高 | `Button ghost sm` |
| 學習助手貼上題目、學習報告 | 輸入框 `bg-bg`、radio 膠囊大小不一（`before/390-light/17-assistant-new`、`18-assistant-report`） | `Field`、`ChoiceChip` |
| 設定、帳號 | radio 卡片框線淡 | `Check` 選項卡 |

---

## 6. 深色模式

### 6.1 做法（沿用現有架構）

- **CSS 變數**：淺色值在 `:root`；深色值寫兩次——`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {…} }`（跟隨系統，不需要 JS）與 `:root[data-theme='dark'] {…}`（手動）。不用 `light-dark()`（要 Safari 17.5）。兩個區塊相同由 `lib/tokens.test.ts` 保證。
- **Tailwind v4**：`@theme inline { --color-surface: var(--surface); … }`，產生的工具類別直接寫 `var(--surface)`，執行期換主題不用重新產生 CSS。**不用 `dark:` 變體**（§1.2 第 4 點）。
- **由 token 推出的色**（`-soft`、`-line`）用 `color-mix` 定義一次，跟著主題換。
- **陰影**也是變數，深色的卡片陰影是 `none`。
- **圖片**：插圖、題目圖片的底用 `paper`（兩種主題都是白）；照片不處理；SVG 圖示用 `currentColor`。
- **列印**：一律淺色（現有的 `@media print` 區塊）。

### 6.2 切換與儲存

| 項目 | 現況（保留） |
|---|---|
| 偏好 | 跟隨系統（預設）／淺色／深色，`localStorage['gsat-theme']`（跟隨系統時刪掉這個鍵），每台裝置各自記；讀寫包 try/catch，無痕模式照樣能用 |
| 快速切換 | 手機：頂端列右上（PR B 起 44×44）；桌機：側邊欄底部的工具列。淺色 ↔ 深色兩態，可存取名稱寫「切換為深色主題（目前跟隨系統：淺色）」 |
| 完整設定 | 設定頁「外觀主題」三個選項卡（跟隨系統／淺色／深色） |
| 系統改變 | 跟隨系統時，作業系統切換深淺色立刻生效（CSS 媒體查詢），切換鈕的圖示也跟著換（`matchMedia` 的 change） |
| 網址列 | `theme-color` 兩個 meta（依媒體查詢）；手動選定時兩個都改成同一色（`theme.ts`）。值＝`--surface`（`tokens.test.ts` 檢查） |

### 6.3 PR A 的深色修正

| token | 原值 | 新值 | 效果（計算） |
|---|---|---|---|
| `--line` | `#2b3440` | `#343e4b` | 卡片框線對 surface 1.36 → 1.58、對 bg 1.48 → 1.72 |
| `--surface-2` | `#202731` | `#232b36` | 說明框、表頭對 surface 1.14 → 1.20；muted 在上面 6.09 → 5.79（仍 ≥ 4.5） |
| `--line-subtle` | — | `#2b3440` | 資料表的列分隔維持原本的淡（`DataTable`） |

淺色的 `--line` 不改（卡片框線本來就是裝飾性的；控制項改用 `line-strong`）。

### 6.4 不閃爍（no flash）

1. `index.html` 的 `<head>` 裡，同步的行內腳本在任何樣式與模組之前讀 `localStorage` 設 `data-theme`（已有）。
2. CSS 是 `<head>` 裡阻擋渲染的 `<link>`，第一次繪製一定已經有變數；`body` 的底色來自 `--bg`。
3. `<meta name="color-scheme" content="light dark">` 讓 CSS 到之前的畫布顏色也跟著系統。
4. 跟隨系統不需要 JS。

實測（PR A 的建置產物，擋掉所有 JS 只留 HTML＋CSS＋繪製前腳本）：系統淺色＋本站深色 → `data-theme="dark"`、body `rgb(15, 19, 24)`；系統深色＋本站淺色 → `data-theme="light"`、`rgb(246, 247, 249)`；系統深色＋跟隨系統 → 沒有 `data-theme`、`rgb(15, 19, 24)`。也就是主程式還沒載入前，畫面已經是正確的主題。

驗收（每個 PR）：`tests/smoke.spec.ts` 的主題測試（重新整理後仍是深色、`theme-color` 正確）＋手動在「系統淺色、本站深色」下重新整理，錄影逐格看不到白底。之後加 CSP 時要把行內腳本的 sha256 加進 `script-src`。

---

## 7. 載入速度

### 7.1 結論

CSS 不是瓶頸（gzip 12.7 KB、一個檔、沒有網路字型），**不拆 CSS、不做關鍵 CSS 內嵌**：Tailwind 的輸出已經只有用到的類別，拆成每頁一個檔反而多一次請求；整站是 SPA，第一次繪製本來就要等主程式。要處理的是版面位移與「不要變胖」。

### 7.2 版面位移（PR D，目標每頁 CLS ≤ 0.05，量測工具 390／1280 兩種寬度）

1. **`<main>` 撐滿視窗**：手機也加 `flex min-h-dvh flex-col`、內容容器 `flex-1`（桌機已有），頁尾永遠在第一個畫面以下，路由載入前後不會被推。預估去掉每頁 0.04–0.10。
2. **路由的載入畫面佔位**：`PageLoading` 換成骨架（標題一條、兩張卡片的高度），`min-h-[60dvh]`。
3. **題型頁練習區塊、列表頁**先畫骨架並保留最終高度（desktop-polish §2.14 的骨架規格）；列表頁的頁尾說明放在列表之後才渲染，或資料到之前不渲染。
4. 圖片一律寫 `width`／`height`（或 `aspect-ratio`）；按需載入的圖示（lucide）在 chunk 裡，不影響版面。
5. 字型：維持系統字型，不加網路字型。之後若要加英文展示字，必須 `font-display: optional`＋`size-adjust` 的後備字型，且只給單字卡的單字。

### 7.3 長頁面

`/exams`（手機 14,256 px）、`/writing/essay`（13,160 px）、`/words`（7,051 px）的列表項目加 `content-visibility: auto; contain-intrinsic-size: auto 9rem`（`@utility cv-auto`），畫面外的卡片不排版、不繪製。驗收：Chrome Performance 的 Layout 時間減少、捲動不跳（`contain-intrinsic-size: auto` 會記住實際高度）。PR C 把列表卡片變矮之後再量一次，必要時才做。

### 7.4 預算（PR D 加進 CI：`apps/web/scripts/check-budget.mjs`，建置後跑）

| 項目 | 現況（PR A） | 預算 |
|---|---|---|
| CSS（gzip） | 13.07 KB | ≤ 15 KB；單一 PR 增加 ≤ 1 KB |
| 主程式 JS（gzip） | 112.9 KB | ≤ 120 KB（desktop-polish 的「每個 PR ≤ 1 KB」沿用） |
| 網路字型 | 0 | 0 |
| CLS（量測工具，27 頁 × 390／1280） | 最高 0.47 | 每頁 ≤ 0.05 |
| Lighthouse 行動版（首頁、`/exams`、`/reading`、作答頁） | 90／95／62／76 | ≥ 90 |

---

## 8. 分階段上線

每個 PR 都要附：前後截圖（`.shots/before` 對 `.shots/after-<PR>`，淺色＋深色、390＋1280，手機的 PR 另加 360、430）、量測摘要（溢出、小字、點擊目標、CLS、axe）、全部檢查（typecheck、vitest、test:data、build、Playwright 全套）。截圖與量測用 `tests/visual/theme/`（附錄）。

### PR A：token 與深色模式的基礎（已做，§9）

- `index.css`：§3 的 token（顏色角色兩種主題、字級、圓角、陰影、焦點框、遮罩、paper），`@theme inline` 對應。
- 寫死的顏色換成 token（機械式、畫面不變）。
- 深色層次修正（§6.3）。
- `lib/tokens.test.ts`（token 守門）、`tests/visual/theme/`（截圖與量測工具）。
- **驗收**：淺色截圖和改版前逐像素相同（反鋸齒雜訊 ≤ 1 色階除外）；深色只有框線與 `surface-2` 的差異；axe 兩種主題 0 違規；CSS gzip 增加 ≤ 0.5 KB。

### PR B：共用元件

- `components/ui/`：`buttons.ts`、`fields.ts`、`Check`、`Card`、`Badge`、`Table`／`ScrollRegion`、`SubNav`／`Segmented`／`ChoiceChip`／`TierPicker`、`Dialog`、`Toast`、`Alert`、`Disclosure`（§4）。
- 各功能的樣式常數改成 re-export；5 個 `<dialog>` 換成 `Dialog`；`<details>` 先改批改結果、/writing、單字卡、學習助手。
- **驗收**：截圖審查（每種元件挑 2 頁、兩種主題）；量測工具的 `targets.lt44` 在 390 寬每頁 ≤ 3（只剩段落裡的行內連結與品牌連結）；輸入框、選單的框線對比 ≥ 3:1（axe 不檢查非文字對比，用 `tokens.test.ts`＋computed style 抽查）；`npm test` 加元件的單元測試（尺寸 class、停用、`aria-*`）。
- 可拆 B1（按鈕、欄位、卡片、標章）與 B2（選擇控制項、表格、對話框、toast、alert）。

### PR C：逐頁的手機修正

- §5.2 殼層＋§5.3 的清單，一頁一個 commit。
- **驗收**：360／390／430 三種寬度 27 頁：`overflowX` 全部 false、`tiny12` 全部 0、`targets.lt44` ≤ 3；e2e 的 `mobile` project 全過（選擇器改動要同步）；前後截圖給站主看。

### PR D：載入速度

- §7.2 的位移修正、§7.3 的 `content-visibility`、§7.4 的預算檢查進 CI。
- **驗收**：量測工具 27 頁 × 390／1280 每頁 CLS ≤ 0.05；Lighthouse 行動版四頁 ≥ 90；預算腳本在 CI 失敗時擋 PR。

### 共同的驗收工具

| 檢查 | 怎麼做 |
|---|---|
| 視覺差異 | `tests/visual/theme/` 截前後兩套，`tests/visual/compare.mjs` 逐像素比對（附錄），差異圖標紅；PR 說明附 10–15 組前後對照 |
| 對比 | `lib/tokens.test.ts`（token 本身，兩種主題）＋截圖工具的 axe color-contrast（頁面，兩種主題）：0 違規 |
| 手機版面 | 截圖工具的 `overflowX`、`tiny12`、`targets` |
| 版面位移 | 截圖工具的 `cls`（每頁）＋Lighthouse 行動版 |
| 大小 | 建置輸出的 CSS／JS gzip（PR D 起由 CI 檢查） |
| 主題切換 | `smoke.spec.ts` 的主題測試；手動在「系統淺色／本站深色」與相反組合各重新整理一次 |

---

## 9. PR A 實作備註

### 9.1 改了什麼

| 檔案 | 改動 |
|---|---|
| `apps/web/src/index.css` | token 註解改寫成角色表；新增 `line-subtle`、`line-strong`、`primary-hover`、`ok-soft`、`bad-soft`、`bad-line`、`badge-line`、`scrim`、`scrim-strong`、`paper`、`--focus-ring`、`--shadow-card`、`--shadow-card-hover`、`--shadow-pop`；深色 `--line`、`--surface-2` 調深；`@theme inline` 加 9 個顏色；`@theme` 加字級角色（title、title-ws、section、card、body、meta）與圓角（card、control、nav）；`:focus-visible` 讀 `--focus-ring` |
| 68 個元件檔 | 機械式替換：`accent-[var(--primary)]` → `accent-primary`（48）、`bg-bad/10` → `bg-bad-soft`（41）、`bg-ok/10` → `bg-ok-soft`（20）、`border-bad/40` → `border-bad-line`（26）、`border-badge-fg/30` → `border-badge-line`（25）、`bg-black/40`／`/50` → `bg-scrim`／`bg-scrim-strong`（6）、`bg-white` → `bg-paper`（1） |
| `components/desktop/DataTable.tsx` | 列分隔 `border-line` → `border-line-subtle` |
| `lib/theme.ts` | `THEME_COLORS` 改成 export（給測試比對） |
| `lib/tokens.test.ts`（新） | 兩個深色區塊相同、每個 token 兩種主題都有值、`@theme inline` 對應齊全、文字 ≥ 4.5:1 與 `line-strong` ≥ 3:1（兩種主題）、`theme-color` 等於 `--surface`、繪製前腳本的鍵名 |
| `tests/visual/theme/`（新） | 截圖與量測工具（附錄） |
| `.gitignore` | `.shots/` |

**和計畫不同的地方**：

1. **主題切換沒有改**：三態（跟隨系統／淺色／深色）、每台裝置記住、繪製前套用不閃爍，在 b217954 已經完整（§2.4、§6.2）；PR A 只補了守門測試。快速鈕的尺寸（40 → 44）放到 PR B 的 `icon` 按鈕一起改。
2. **沒有替換的寫死顏色**：拍照裁切的遮罩 `bg-black/45` 與裁切框的白色外框（照片專用，兩種主題都要黑遮罩）；`bg-bad/15`、`bg-badge-bg/60` 等少量濃度（PR B 改元件時一起收斂成 token）；`html:has(dialog:modal)` 的捲軸槽底色（和遮罩疊在 `--bg` 上的顏色一致，原樣保留）。
3. **`--line-subtle`** 原本是 PR B 才要加，但深色 `--line` 調深之後資料表的列線太重，所以 PR A 就加，`DataTable` 先用。

### 9.2 結果（實測）

| 檢查 | 結果 |
|---|---|
| 淺色截圖（390＋1280，27 頁；`compare.mjs`） | 容許差 0：最後一版 54 張中 53 張逐像素相同，1 張是反鋸齒雜訊（`1280-light/01-home` 11 px、最大色差 1；前一次截圖則是 `390-light/19-account-anon`、`24-zh-writing` 各十幾 px，重截就消失）。容許差 2：**全部相同**（exit 0） |
| 深色截圖 | 54 張都有差異，全部是 `--line`（卡片框線、分隔線）與 `--surface-2`（說明框、表頭、膠囊底）的顏色；版面、尺寸不變。對照：`before/390-dark/03-practice` ↔ `after-A/390-dark/03-practice`、`before/1280-dark/06-exams` ↔ `after-A/1280-dark/06-exams` |
| axe color-contrast | 改版前、後兩種主題 × 390／1280 × 27 頁都是 0 違規（「需要人工確認」1–4 個，都是疊在半透明底上的字，前後相同） |
| CSS | 69,575 → 69,781 B；gzip（vite 報告）12.91 → 13.07 KB（+0.16 KB，主要是 token 定義；`bg-bad/10` 這類類別原本附帶的 `@supports` 後備規則少了）。主程式 JS 112.92 → 112.90 KB |
| `npm run typecheck`、`npm test`（api 1,451、web 2,353、shared 805）、`npm run test:data`、`npm run build` | 全部通過 |
| Playwright 全套（`E2E_PORT=4901`） | 見 §9.3 |

### 9.3 E2E

`E2E_PORT=4901 npx playwright test`（四個 project：desktop、mobile、desktop-ui、desktop-lg）：**412 通過、37 略過（各 project 本來就不跑的）、0 失敗**，12.1 分鐘。其中 `smoke.spec.ts` 的「選擇的主題在重新整理後仍然生效」、`writing-bank.spec.ts` 的題目插圖白底（改用 `bg-paper` 後仍是 `rgb(255, 255, 255)`）、`practice.spec.ts` 的深色圖表色都通過。

---

## 10. PR B 實作備註

### 10.1 改了什麼

新增 `apps/web/src/components/ui/`（每個檔都有單元測試，`*.test.tsx`）：

| 檔案 | 內容 | 套用到 |
|---|---|---|
| `buttons.ts`、`Button.tsx` | `btn(variant, size, extra)`：primary／secondary／ghost／danger／danger-ghost／link × sm／md／lg／icon；`iconBtnCls`；`Button` 的 `disabledReason`（旁邊一行原因＋`aria-describedby`）與 `busy`（`aria-busy`＋處理中文字） | 約 150 個按鈕字串；單字、帳號、寫作、學習助手的按鈕常數改成由 `btn()` 產生（import 不變）；主題切換與對話框的關閉鈕 `iconBtnCls`（手機 44×44） |
| `fields.ts`、`Field.tsx` | `fieldCls`／`fieldBaseCls`／`numberFieldCls`／`textareaCls`／`selectCls`／`selectCompactCls`、`labelCls`／`hintCls`／`errorTextCls`；`Field`（標籤、說明、錯誤連好）、`Input`、`Textarea`、`Select`（`appearance-none`＋`ChevronDown`） | 12 種輸入框寫法全部換掉；18 個原生 `<select>` 改用 `Select`；五個功能的欄位常數 re-export |
| `Check.tsx` | `checkInputCls`（20px）、`checkLabelCls`、`optionCardCls`／`optionCardTopCls`、`Check` | 55 個 checkbox／radio 改 20px；11 處選項卡（設定、帳號、單字測驗、模擬考開考前、組卷…） |
| `Card.tsx` | `cardCls`（區塊）、`cardCompactCls`（列表）、`cardLinkCls`（可點，有陰影）、`calloutCls`（說明框）、`resultCardCls`＋`resultCardHeadCls`（結果卡）、`insetBoxCls`、`cardFrameCls`；`Card`、`CardChevron` | 約 90 處卡片；頁尾的出處說明改說明框；交卷結果、總分改結果卡；`rounded-2xl` 全部改名 `rounded-card`（同為 16px） |
| `Badge.tsx` | `badgeCls(tone, size)`、`badgeShapeCls(size)`、`Badge` | 帳號狀態、即將開放、AI 標示、歷屆進度、新制／補考、作答對錯、自評分數、標記等 |
| `Alert.tsx` | `alertCls(tone)`、`Alert`（info／warn／ai／error／success） | 帳號 `Notice`、寫作 `Notice`／`ErrorMessage`、AI 聲明 `AiNotice`、各頁 `bg-badge-bg/60` 的提醒框 |
| `Table.tsx` | `tableCls`／`thCls`／`tdCls`／`numCls`／`groupRowCls`／`stickyFirstColCls`／`tableFrameCls`、`ScrollRegion` | `DataTable`（sticky 表頭改成不透明的 surface-2、排序圖示不再是 `opacity-50`）；五個鍵盤捲不到的寬表格加 region 名稱與 `tabIndex` |
| `Tabs.tsx` | `tabCls`／`tabListCls`／`SubNav`、`segmentCls`／`segmentedTrackCls`、`chipCls`／`ChoiceChip`／`chipRowCls`、`tierTileCls` | 底線分頁（/words、題目來源、拍照／貼上、範文、`PaneTabs`）；分段（作答方式、編輯方式、紀錄種類、後台期間）；篩選膠囊約 25 處；難度方塊兩處 |
| `Dialog.tsx` | 原生 `<dialog>` 的 `Dialog`（標題列＋關閉、捲動的內容、固定的動作列；焦點進出；Esc） | 五個 `<dialog>`：快捷鍵說明、說明載入失敗、計時中離開、模擬考交卷、範文「和網站題目相同」 |
| `Toast.tsx` | `ToastProvider`（Layout 掛常駐的 `aria-live="polite"`）、`useToast` | 只做元件，沒有改現有的就地回饋（§4.11） |
| `Disclosure.tsx` | `Disclosure`、`disclosureSummaryCls`／`disclosureInlineSummaryCls`、`DisclosureChevron` | 批改結果的題目、逐段建議、標出的錯誤、參考改寫；範文的題目；/writing 的兩種批改方式；單字卡的其他釋義；學習報告與方法卡的「更多」；回報不當內容 |

`index.css` 新增：`--text-control`（桌機 md 按鈕 15px）、`--ok-line`（成功提示的框線）、`@custom-variant tall`（視窗內高 ≥ 800，側邊欄用）。量測工具 `tests/visual/theme/routes.theme.ts` 另外記 < 44 的例子（`targets.examples44`）。

**側邊欄**（另一個分支的「數學」群組會多約 50 px）：矮視窗改密（項目 26、群組標題 18、品牌列 44、未登入的工具列 95），高視窗放寬（項目 32、標題 28）。1366×640 加了數學之後未登入 485／501、已登入功能全開 537／545，都不用捲；預算表與之後加群組的算法在 [desktop-polish.md §8.2](desktop-polish.md#82-側邊欄的高度預算css-改版-pr-b2026-11-06)。

### 10.2 和計畫不同的地方

1. **手機的 `sm` 按鈕與篩選膠囊是真的 44 高**（§4.1 寫「視覺 36、觸控區用 `before:` 撐到 44」、§4.5 寫膠囊 40＋偽元素）：偽元素撐出的觸控區不算在元素的 `getBoundingClientRect` 裡，量測工具（也是驗收標準）會把它們算成 < 44；所以手機上 `sm` 只把字（14px）與左右內距縮小，高度一樣 44。桌機照計畫：`sm` 36、膠囊 32。
2. **選擇控制項的選中狀態從語意讀**：膠囊、難度方塊用 `has-[:checked]`（label 包 radio）或 `aria-pressed`，分頁用 `aria-current`；元件沒有另外的 `selected` 狀態要同步。高對比模式選中一律 Highlight＋`forced-color-adjust: none`（`desktop-shell.spec` 的墨水像素測試照樣通過）。
3. **結果卡不重排 JSX**：§4.6 的「頂端 primary-soft 標題列」做成第一個子元素（h2 或「原得總分」）加 `resultCardHeadCls`（負外距貼齊卡片上緣），焦點目標（交卷後聚焦的 h2）不變。
4. **可點卡片的右上箭頭**：既有的列表卡大多已經有 `ChevronRight`；只加了陰影與 hover，沒有在每個元件補箭頭（`CardChevron` 給新程式用）。
5. **對話框**：模擬考交卷在手機仍沒有右上角的關閉鈕（原本的手機行為，`mobile-guard` 有測）；說明載入失敗只留右上角「關閉」（原本底部也有一顆同名的「關閉」，兩顆同名按鈕會讓讀屏與測試分不出來）。
6. **`ExternalA` 改成行內連結**：原本 `inline-flex min-h-8`，放在句子裡時句號會被擠到下一行；改成行內之後屬於 WCAG 2.5.8 的行內例外。清單裡的檔案連結（歷屆考卷、模擬考出處）另外改成手機 44 高。
7. **AI 聲明（`AiNotice`）的字是 badge-fg**（§4.12 的 warn／ai 外觀）：原本是 fg 字＋六成濃度的底；裡面的 AI 標章和底同色，靠 Sparkles 與粗體區分。
8. **沒有換成淡底的實心主色**：模擬考題號面板「已作答」的格子、級分對照表的目前級分：這兩個是狀態（已完成、你在這一級），不是選擇控制項；作答的選項卡（`Questions.tsx`）照 §4.4 不換。
9. **表格**：只有 `DataTable` 與學習助手的兩張表改用 `thCls`；其他 28 張表維持各自的樣式（有 `ScrollRegion` 的規則，外觀留給 PR C 逐頁時改）。

### 10.3 結果（實測，`.shots/after-B`，建置產物＋Chromium，390／1280 × 淺色／深色 × 27 頁）

| 檢查 | PR A（`after-A`） | PR B（`after-B`） |
|---|---|---|
| 390 寬每頁 < 44 的點擊目標（最多／超過 3 個的頁數） | 12／11 頁 | **6／1 頁**：剩下的是每頁的品牌連結（130×28），以及綜合測驗作答頁選文裡 5 個行內空格按鈕（32 高，§5.3 列給 PR C 的「leading-8＋觸控區上下各撐 6 px」）；批改結果還有 2 個錯誤標號（PR C） |
| axe color-contrast（兩種主題 × 兩種寬度） | 0 | **0**（中途抓到篩選膠囊的題數 `opacity-80` 在選中的淡主色底上 4.29:1，已改成實色） |
| 水平溢出（390） | 0 | 0 |
| 控制項框線 | `line` 1.22–1.30:1 | `line-strong`：淺色對 bg／surface／surface-2 3.40／3.64／3.22、深色 4.05／3.72／3.27（`tokens.test.ts`）；輸入框、選單、外框按鈕、未選中的膠囊、選項卡的 class 都檢查是 `border-line-strong`（`fields.test.tsx`、`tabs.test.tsx`） |
| 停用 | `opacity-50`／`60`／`70`（38 處） | 0 處；surface-2 底＋muted 字，兩個看不出原因的停用按鈕補上原因 |
| 元件寫法（不同的 class 字串） | 主要按鈕 39、次要 61、危險 4、輸入框 10、卡片 52、膠囊 21 | 0、6、0、1、0、3（剩下的是標記、身心關懷、行內填空框、作答選項卡這類刻意不同的） |
| CSS（vite 報告） | 71.64 kB、gzip 13.32 kB | 73.93 kB、gzip 13.96 kB（+0.64 KB，§7.4 單一 PR ≤ 1 KB） |
| JS | 主程式（首次載入的全部 chunk）gzip 115.9 KB；全部 chunk 4,247,683 B | 首次載入 119.4 KB（+3.6 KB，見 §10.4 第 3 點）；全部 chunk 4,222,975 B（−24.7 KB：按鈕、卡片字串收成共用常數） |

淺色截圖：54 張都有差異，看過的對照（`after-A` ↔ `after-B`）都是這個 PR 要的改變：按鈕字重與高度、輸入框的框線與白底、停用狀態、選擇控制項從實心改淡底、可點卡片的陰影、說明框、結果卡的標題列、AI 聲明的底色、/words 的分頁、桌機側邊欄的間距（800 高以上放寬）。沒有找到非預期的差異（中途發現的兩個已修：句子裡的連結把句號擠到下一行、/exams 1280 寬的篩選列折成兩行）。

檢查：`npm run typecheck`、`npm test`（api 1,451、web 2,388、shared 805）、`npm run test:data`（web 66、shared 228）、`npm run build` 全部通過。Playwright 全套（`E2E_PORT=4902`，desktop、mobile、desktop-ui、desktop-lg）：412 通過、38 略過（各 project 本來就不跑的）、1 失敗＝`desktop-safety.spec`「選文、題幹、選項標 lang」在全套的負載下逾時一次，單獨重跑通過（前一次全套也通過；和這個 PR 的改動無關）。刻意改動而更新的測試：`section-practice.spec`（深色的目前難度改成淡主色底）、`desktop-shell.spec`（側邊欄的高度預算，見 desktop-polish §8.2）、`MockPages.test`（交卷對話框的動作列）、`ModelTextView.test`（舊版副本的膠囊與 checkbox）。

### 10.4 留給 PR C／D 的

1. **綜合測驗、文意選填的行內空格**（32 高，5–10 個）：PR C 照 §5.3 做；做完 390 寬每一頁就只剩品牌連結。品牌連結（28 高）也可以在 PR C 的頂端列一起撐到 44。
2. **字級下限**：底部導覽 0.7rem（每頁 5 個 < 12 px）、批改結果的錯誤標號、模擬考題號面板與級分表的 0.65rem 都還在（PR C §5.2、§5.3）；共用元件裡已經沒有 < 12px 的字。
3. **首次載入的 JS 多了 3.6 KB（gzip）**：共用元件（`Alert` 的五個圖示、`Dialog`、`Toast`、`Badge`）因為 Layout 與帳號選單用到而進了首次載入；rolldown 也把 react-router 與共用模組拆成另一個 chunk（首次載入 7 → 12 個檔）。PR D 加預算檢查時：`Alert` 的圖示改成依 tone 動態載入，或 Layout 的對話框（離開確認、說明載入失敗）改 lazy。
4. **其他 `<details>`**（約 30 個）、**其他表格**（28 張）、**頁首與返回連結**的寫法還沒統一（desktop-polish §3.1 的 `PageHeader`、`BackLink`）。
5. **少量濃度寫法**：`bg-bad/15`、`bg-bad/5`、`border-primary/40`、`bg-primary-soft/60`、`bg-badge-bg/70`（標示與螢光筆、身心關懷框）還在；改元件時收成 token。
6. **Toast** 還沒有任何地方用；PR C 的「登出所有裝置」、背景同步失敗可以接上。
7. **側邊欄**：加了數學之後 1366×640 未登入只剩 16 px，再加一項就要捲（desktop-polish §8.2 有之後的省法）；數學分支合併時，它把 `desktop-shell.spec` 改成「有淡出遮罩」的兩項要改回「不用捲」。

---

## 附錄：截圖與量測指令

在 `apps/web` 執行（要先 `npm run build`）：

```bash
# 改版前／後各截一套：390、1280 × 淺色、深色；量測數字在 <OUT>/_meta/
THEME_SHOTS_OUT=../../.shots/after-B THEME_SHOTS_THEMES=light,dark \
  THEME_SHOTS_AXE=<axe-core 的 axe.min.js> \
  npx playwright test -c tests/visual/theme/theme.config.ts --workers=6

# 手機三種寬度（淺色）
THEME_SHOTS_OUT=../../.shots/after-C THEME_SHOTS_VIEWPORTS=360,390,430 \
  npx playwright test -c tests/visual/theme/theme.config.ts
```

- `THEME_SHOTS_PORT`（預設 4431）：同時有 e2e 在跑時換一個；連接埠被佔用時直接失敗，不會截到別的伺服器。
- `THEME_SHOTS_DIST`：測別的建置產物（例如改版前的 `dist` 複本）。
- axe-core 不在專案的相依套件裡（不需要為了這個工具加套件）：`npm pack axe-core@4.10.3` 解開到 repo 外，指向 `package/axe.min.js`；不給就不跑 axe。
- 每頁的 JSON：`overflowX`、`overflowing`（超出右緣的元素）、`fontSizes`（字級 → 元素數）、`tiny12`、`tiny12to14`、`targets`（`total`、`lt24`、`lt44`、例子）、`cls`、`clsSources`、`axe`（`violations`、`nodes`、`incomplete`）。
- 逐像素比對：沿用 `tests/visual/compare.mjs`（不需要套件），子資料夾名稱直接當視窗名稱：

  ```bash
  # 在 repo 根目錄；淺色要 0 差異（--tolerance 2 排除反鋸齒雜訊），深色看差異圖
  node apps/web/tests/visual/compare.mjs .shots/before .shots/after-A --viewports 390-light,1280-light --tolerance 2
  node apps/web/tests/visual/compare.mjs .shots/before .shots/after-A --viewports 390-dark,1280-dark --diff-dir .shots/diff-A
  ```
- Lighthouse：`npx lighthouse@12 http://127.0.0.1:<port>/reading --only-categories=performance,accessibility --chrome-flags="--headless=new"`（預設就是行動版模擬）。
