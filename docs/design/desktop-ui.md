# 桌機介面：設計

> 版本：2026-10-18 第 2 版（依設計審查的 42 項意見修訂，逐項回應見 §15）。第 1 版：盤點完成。
> 需求（站主）：「電腦版介面也要做」。硬性條件：**手機與平板（寬度 < 1024 px，也就是 Tailwind `lg` 以下）逐像素不變**；桌機的改動只放在 `lg:` 起的變體（含 `lg:@ws/main:` 這類 container query），或只在 ≥ lg 才掛載的元件裡。
> 相關文件：`docs/SPEC.md` §4.1（`OptionTray`：桌機是右側欄）、§6.6（閱讀：桌機左右並排）、§10（裝置）；`docs/design/mock-exam-pdf.md` §6.3、§6.9（模擬考工具列、題號面板、無障礙）；`docs/design/bank-writing.md`、`docs/design/custom-essay.md`（寫作頁）；ROADMAP 決策 D8（不顯示官方參考譯文、評分原則原文與佳作）。
> 基準：分支 desktop-ui＝origin/main **40c46d2**，資料版本 a746569c8866。以下檔名與行號都以 40c46d2 為準。
> 標記：「（實測）」＝在 40c46d2 的建置產物或 Chromium 141 上量到的數字；「（設計值）」＝實作後用截圖與實機校正；「（估計）」＝審查時從截圖估的數字，實作時要量。
> 盤點與截圖工具：目前在這次工作階段的 scratchpad；PR A 會把截圖工具搬進 repo，並附從任一 commit 重建基準的腳本（§11.1）。

**目錄**：[0. 決策摘要](#0-決策摘要)｜[1. 範圍與限制](#1-範圍與限制)｜[2. 原則與斷點](#2-原則與斷點)｜[3. 殼層](#3-殼層)｜[4. 共用元件與工具](#4-共用元件與工具)｜[5. 首頁、列表與其他頁](#5-首頁列表與其他頁)｜[6. 寫作工作區](#6-寫作工作區)｜[7. 作答頁](#7-作答頁)｜[8. 鍵盤快捷鍵](#8-鍵盤快捷鍵)｜[9. 不做與延後](#9-不做與延後)｜[10. 實作計畫](#10-實作計畫)｜[11. 測試與驗證](#11-測試與驗證)｜[12. 上線步驟](#12-上線步驟)｜[13. 風險](#13-風險)｜[14. 待站主決定](#14-待站主決定)｜[15. 審查回應](#15-審查回應)

---

## 0. 決策摘要

1. **手機與平板一個像素都不動，用截圖比對證明。** 新樣式一律帶 `lg:` 起的前綴（hover 也寫成 `lg:hover:`）；行為上的差異用 `useMediaQuery`／`useMainTier()`，不符合時一律走現在的程式路徑。驗收標準是 320、375、768 三種寬度的截圖和基準 **0 個像素不同**；基準在開工前補截「這次要重構的元件」的展開與互動狀態（§11.1），截圖工具搬進 repo、可以從 40c46d2 重建基準。
2. **高度以視窗 600 px 為下限。** 看的是視窗內高，不是螢幕解析度：螢幕高 − 工作列 − 瀏覽器介面。1366×768 筆電約 607–635、1920×1080 開 150% 約 559–587（§1.1）。所有「第一個畫面看得到」的設計值用 **1280×600** 與 **1366×640** 計算，截圖與 e2e 都在這兩種尺寸量。
3. **分欄看 main 的實際寬度，不看視窗寬度。** lg（1024）只分手機與桌機。寫作分欄、首頁儀表板、列表右欄在 main ≥ 60rem（「ws 寬度」，內容約 880–896 px）才啟用，CSS 用 container query `@ws/main`、JS 用 `useMainTier()`，兩邊量同一個寬度。1366 放大 110%、Edge 側邊欄開著、收合側邊欄的 1024 都能分欄。作答頁的選文並排一律從 lg 開始（綜合測驗與閱讀、文意選填對齊）。工作區路由在寬度不夠、使用者也沒自己設定過時，自動收合側邊欄。
4. **內容預設維持現在的寬度（`max-w-5xl`）**；只有改版的區塊用 `bleed` 工具類放寬（首頁與列表上限 82rem，作答與寫作的工作面不設上限）。沒改到的區塊與之後新增的區塊不會默默變超寬。
5. **殼層**：側邊欄改三段（品牌｜可捲動的導覽｜底部一列：帳號或登入、主題、快捷鍵、設定、關於），改密後已登入在 1366×640 不用捲動，放不下時有淡出遮罩。收合成 4rem 圖示欄時，滑鼠移入或鍵盤聚焦都看得到文字提示；觸控為主的裝置不提供收合。頁尾貼底。**不加全站頂端列**。≥ lg 時 `html` 設 `scroll-padding-top`（工具列＋篩選列高度），Tab 的焦點不會停在 sticky 列底下（Chromium 實測）。
6. **新的共用元件與工具**（只在 ≥ lg 生效）：`lib/media.ts`（`useMediaQuery`、`useMainTier`、跨斷點的焦點保存）、`lib/desktopLayout.ts`、`lib/desktopPrefs.ts`、`lib/hotkeys.ts`、`components/desktop/` 的 `Workspace`／`Pane`、`PaneTabs`、`StickyBar`、`DataTable`、`ShortcutHelp`（原生 `<dialog>`）、`Kbd`、捲動工具。不加任何 npm 套件。
7. **寫作（ws 寬度起）**：整個工作區剛好一個畫面高——一行頁首，下面兩個各自捲動的面板；作答框填滿剩下的高度，下面一行狀態列、一行動作列（送出按鈕含點數）。1280×600 時作答框約 10 行，頂端與送出按鈕同時在視窗內（設計值）。自我檢核一律放在**沒有作答框的那一欄**：作文是左欄分頁（上面固定一條「任務＋要求」摘要），中譯英是右欄。自訂題目在題目設定好之前不分欄。批改結果頁作文在左、錯誤清單在右，點任一邊另一邊跟著捲到並標出；「參考改寫」分頁逐段和原文交錯。**Ctrl／⌘＋Enter 只打開送出確認，焦點停在「取消」，按住或連按都不會扣點。**
8. **作答頁**：工具列第二列「題號列」**固定一行**，整條工具列 ≤ 100 px（第一列 49／53 px 實測）：大題膠囊（編號＋進度條，目前大題才顯示名稱）、本大題題號格（放不下時水平捲動，太窄就收進「全部題號」）、「第 N 題」、全部題號、? 按鈕；按鍵提示不放在列上。綜合測驗從 lg 起左右分割；詞彙題維持一欄、短選項一列四個。
9. **鍵盤**：單鍵快捷鍵只在 ≥ lg、焦點不在文字欄位時作用，並且**只對畫面上看得到的目前題作答**：目前題捲出畫面後按字母，只會把目前題改成畫面上第一題並提示，不改任何答案。每次用按鍵作答或標記都有看得到、也聽得到的回饋。N／P 把焦點放在題目標題（不放在沒勾的選項上）。忽略按住不放的重複按鍵。**不把中文輸入法當成防誤觸的保護**（行為待實機測，§8）。設定頁可以關掉單鍵快捷鍵（WCAG 2.1.4）。
10. **首頁在 ws 寬度變成儀表板**：繼續學習、13 個模組的分組地圖、右欄的學習進度／AI 點數／最近寫作紀錄。儀表板另外 lazy 載入，主程式不變大。
11. **列表**：/exams 在 lg 起改成資料表（拿掉「滿分」與「動作」欄、時間放進分組標題、每列只有一個連結、篩選條件帶進作答頁）；/mock 改成欄位對齊的「列式卡片」（仍是 6 個 article）；/practice 改成「題型 × 難度」矩陣（可存取名稱一字不改）；「我的寫作紀錄」改成表格。列表頁的右欄不 sticky。
12. **這一版不做**：指令面板（Ctrl／⌘K）與全站搜尋、g＋字母跳頁、作答頁的右側常駐欄、交卷後的主從式檢討、/admin 表格化等（§9）。
13. **三個依序合併的 PR**：A 殼層＋共用元件＋首頁與列表（太大時再拆 A1 基礎建設＋殼層、A2 列表頁）；B 寫作；C 作答、模擬考、單字。每個 PR 各自通過 0 差異比對、各自讓站主試用、各自可以 revert。現有 e2e 會被影響的斷言逐條列在 §10.5。

## 1. 範圍與限制

| 項目 | 決定 |
|---|---|
| 不能變的 | < 1024 px 的畫面（320–1023 px，含平板直向 768）與操作；`modules.ts` 的 `PAGES`／`NAV_GROUPS`／`BOTTOM_NAV_PATHS`；`TopBar`、`BottomNav`、`MoreMenu`（都是 `lg:hidden`）；路由、資料、API、儲存格式 |
| 會變的 | ≥ 1024 px 的所有頁面 |
| 目標螢幕 | 1366×768 學校筆電、1920×1080（100%、125%、150% 縮放）、1440×900 MacBook、1024×768 舊筆電與 iPad 橫向。**設計高度以視窗內高 600 為下限**，換算見 §1.1 |
| 瀏覽器 | 桌機 Chrome／Edge／Firefox／Safari 近兩年（SPEC §10）。會用到 container query（Chrome 105、Safari 16、Firefox 110）、`inert`（Chrome 102、Safari 15.5、Firefox 112）、`dvh`（已在用）、`:has()`（Chrome 105、Safari 15.4、Firefox 121）；`field-sizing: content`、`hidden="until-found"` 只有 Chromium 完整支援，當成加分項，不支援時就是現在的樣子 |
| 文案 | 繁體中文、台灣用語。**新的介面文字不能出現「大考中心」或 CEEC**；既有文字（首頁標語、/words 說明、`AiNotice` 的完整版）不在這次範圍 |
| 受保護內容 | D8：不顯示官方中譯英參考譯文、評分原則原文、佳作。新的「對照」介面只用 AI 參考改寫或本站撰寫的範文 |
| 套件 | 不新增任何 npm 套件（含 axe，§11.5） |
| 不做 | 見 §9 |

### 1.1 視窗高度怎麼算

設計與驗收看的是 `window.innerHeight`（CSS px），不是螢幕解析度。視窗內高 ≈ 螢幕的 CSS 高 − 工作列（Windows 11 約 48）− 瀏覽器的分頁列＋網址列（Chrome／Edge 約 85，開書籤列再多約 28）。Windows 的顯示縮放會把三者一起放大，所以全部用 CSS px 算即可。

| 裝置 | CSS 螢幕 | 視窗內高（估計） | 驗收用的視窗 |
|---|---|---|---|
| 1366×768 筆電（100%） | 1366×768 | 607–635 | **1366×640** |
| 1920×1080 筆電（150%） | 1280×720 | 559–587 | **1280×600** |
| 1920×1080（125%） | 1536×864 | 703–731 | 1440×800 |
| 1440×900 MacBook | 1440×900 | 725–795（選單列、Dock、瀏覽器） | 1440×800 |
| 1920×1080 桌機（100%） | 1920×1080 | 919–947 | 1920×960 |
| 1024×768 舊筆電、iPad 橫向 | 1024×768 | 約 600–700 | 1024×600 |

- 「第一個畫面看得到」的設計值一律用 1280×600 與 1366×640 計算；更矮的時候（瀏覽器放大、開 DevTools）可以捲動，但不能有切掉、捲不到的內容。
- 盤點基準只有 1024×768、1280×800、1440×900、1920×1080 四種桌機視窗。PR A 開工前在基準產物上補截上表右欄的五種尺寸（§11.1），改版前後才能對照。

## 2. 原則與斷點

### 2.1 手機與平板逐像素不變的寫法

| # | 規則 | 理由 |
|---|---|---|
| R1 | 新的 class 一律帶 `lg:` 起的前綴；改既有元素只能**加**帶前綴的 class（或改既有的 `lg:` 部分），不能改沒有前綴的部分 | < lg 的 CSS 完全相同 |
| R2 | hover 寫成 `lg:hover:…` | Tailwind v4 的 `hover:` 已經包在 `@media (hover: hover)` 裡，但用滑鼠的窄視窗桌機也算 hover 裝置 |
| R3 | 只在桌機出現的 DOM：小而無狀態的用 `hidden lg:block`；有 id、狀態、焦點或量大的（列表、表格、對話框）用 `useMediaQuery` 為真才 render，**不要兩份同時存在** | 兩份會有重複的 id 與可存取名稱；3,006 筆單字不能畫兩次 |
| R4 | 不要在 < lg 會出現的地方加包裹元素；真的要重組版面，在 lg 用 `useMediaQuery` 二選一，手機分支保留原本的 JSX。**有輸入元件的區塊，桌機分支只有一棵樹**：lg 以上不同寬度的排法（分欄或堆疊）只靠 CSS（container query、grid 放置）切換。只有沒有輸入元件的區塊（首頁儀表板）可以在 ws 寬度用 `useMainTier()` 換樹 | 包一層會改變 `space-y-*` 的間距與 sticky 的作用範圍；桌機內換樹會讓作答框重新掛載，焦點、游標、復原紀錄都會消失（§4.1） |
| R5 | `container-type` 只能寫成 `lg:@container`（卡片）或 `lg:@container/main`（Layout 的 `main`）。`main` 裡不放 `position: fixed` 的元素（固定定位的東西放在 Layout 的 `main` 外面或用 top layer 的 `<dialog>`） | container query 會改變元素的尺寸計算。Chromium 141 實測：`container-type: inline-size` 的元素裡，fixed 子元素仍以視窗定位、sticky 照常作用；Safari、Firefox 依規格相同，§11.2 實機確認 |
| R6 | 新屬性（`id`、`data-*`、`aria-*`）可以全寬度加，但對應的樣式要帶前綴（例如 `data-current` 全寬度設、`lg:data-current:outline-2` 才有外框） | 屬性不影響像素；樣式才影響 |
| R7 | 行為（快捷鍵、預設展開、攔截錨點、對話框偵測）的啟用條件一定包含 `useIsDesktop()` | < lg 的操作也不變 |
| R8 | 單元測試：happy-dom 預設視窗是 1024×768，`matchMedia('(min-width: 64rem)')` 會回傳 true（實測）。`vite.config.ts` 的 `test.environmentOptions.happyDOM` 設成 375×667，`src/test/setup.ts` 每個測試後再用 `window.happyDOM.setViewport` 設回 375×667；桌機測試用 `src/test/viewport.ts` 的 helper 改寬（`setViewport` 之後 `matchMedia` 的結果與 change 事件都會跟著變（實測））。改完先跑一次全部單元測試，確認沒有測試依賴 1024 的寬度 | 否則現有的元件測試會悄悄走桌機路徑 |
| R9 | 例外：目前沒有預定的例外。若有無法避免的手機差異，PR 要附差異圖並由站主同意（例如 §14 第 1 點） | 0 差異是驗收標準 |
| R10 | 新的 sticky 元素（工具列、篩選列）一定把自己的高度寫進 CSS 變數，納入 `html` 的 `scroll-padding-top`（§3.4）；捲動容器裡不放 sticky 元素 | 焦點不能被遮住（WCAG 2.4.11） |
| R11 | 浮在內容上的元件（下拉面板、選單、提示泡泡、對話框）一律 `border border-line bg-surface shadow-lg`；狀態（目前題、選中、已答）不能只靠 box-shadow 或底色表示，要用 outline、框線或圖示 | 深色模式的陰影幾乎看不見；Windows 高對比模式會拿掉 box-shadow、換掉底色（§4.11） |

上面用到的 Tailwind 寫法都在本 repo 的 tailwindcss 4.3 編譯確認過（實測）：`lg:@container`、`lg:@container/main`、`lg:@md:grid-cols-2`（輸出為 `@media (width >= 64rem) { @container (width >= 28rem) {…} }`）、`@theme { --container-ws: 60rem }` 之後的 `lg:@ws/main:grid-cols-2`（輸出為 `@container main (width >= 60rem)`）、`lg:@max-ws/main:hidden`（`width < 60rem`）、`lg:@wide/main:grid-cols-3`、`lg:@2xl:data-short:grid-cols-4`、`lg:@max-[16rem]/qgrid:hidden`、`lg:grid-rows-[repeat(4,auto)_1fr]`、`lg:[&_:focus-visible]:-outline-offset-2`、`lg:hover:`、`max-lg:hidden`、`lg:data-current:outline-2`（`[data-current]` 屬性選擇器，所以屬性要在「不是目前題」時整個拿掉，不是設成 false）、`lg:[--page-px:2.5rem]`、`lg:px-(--page-px)`、`lg:-mx-(--page-px)`、`lg:scroll-pt-[…]`、`lg:[scrollbar-gutter:stable]`、`forced-colors:…`、自訂的 `@utility bleed`（§2.3）。

### 2.2 斷點與實際寬度

斷點只剩兩種用途：

- **lg（視窗 64rem＝1024）**：分手機與桌機。殼層、側邊欄、作答工具列的題號列、快捷鍵、資料表、作答頁的選文並排都從 lg 開始。
- **main 的寬度**：`main` 設 `lg:@container/main`，`index.css` 的 `@theme` 加兩個 container 尺寸：
  - **ws**（`--container-ws: 60rem`，main ≥ 960 px）：寫作分欄、首頁儀表板、列表右欄、單字庫的篩選欄、作答頁較寬的選文欄比例。
  - **wide**（`--container-wide: 80rem`，main ≥ 1280 px）：三欄網格、第三欄（P2）。
  - JS 端用 `useMainTier()`（§4.1）取得同樣的判斷；CSS 與 JS 量的是同一個元素的內容寬，不會出現 CSS 已經分欄、JS 卻以為沒分的情況。
- xl／2xl 這兩個**視窗**斷點不再拿來決定版面（只剩少數純裝飾的地方）。

側邊欄展開 16rem（256 px）、收合 4rem（64 px）。下表不含 Windows 傳統捲軸（約 15–17 px；≥ lg 設 `scrollbar-gutter: stable`，所以這個差額固定不變）：

| 視窗寬 | main（展開／收合） | 預設內容 | 放寬的區塊（`bleed`，上限 82rem） | 工作面（`--page-px` 2rem） | ws？（展開／收合） |
|---|---|---|---|---|---|
| 1024 | 768／960 | 688／880 | 688／880 | 704／896 | 否／是 |
| 1216 | 960／1152 | 880／944 | 880／1072 | 896／1088 | 是／是 |
| 1280 | 1024／1216 | 944 | 944／1136 | 960／1152 | 是 |
| 1366 | 1110／1302 | 944 | 1030／1222 | 1046／1238 | 是 |
| 1440 | 1184／1376 | 944 | 1104／1296 | 1120／1312 | 是 |
| 1536 | 1280／1472 | 944 | 1200／1312 | 1216／1408 | 是（wide 也成立） |
| 1920 | 1664／1856 | 944 | 1312 | 1600／1792 | 是 |

- 1216 這一列是側邊欄展開時的 ws 門檻。1366 放大 110%（1242）、1280 開著 Edge 側邊欄（約 1232）都在門檻附近：後者扣掉捲軸只剩 959，所以工作區路由靠自動收合（§3.2）保證分欄。
- 以前的設計在 1200 寬、側邊欄收合（內容 1,056）時仍是單欄，1280 寬、側邊欄展開（內容 960）卻是雙欄；改成看 main 的寬度之後，這兩種情況都分欄。

### 2.3 內容寬度：預設維持原寬，改版的區塊才放寬

`desktopWidthMode(pathname)` 回傳下列之一，Layout 把對應的 class 加在內容容器上：

| 模式 | ≥ lg 的 class（基底仍是 `max-w-5xl px-4`） | 路由 |
|---|---|---|
| 窄版 `narrow` | `lg:max-w-4xl` | `/privacy`、`/terms`、`/about`、`/settings`、`/account`、`/account/welcome`、`/ai/apply` |
| 一般 `default` | （不加，寬度維持 `max-w-5xl`） | 對照表裡沒列為其他兩種的所有路徑：首頁、所有列表頁、`/words`、`/admin`、`/mock/report/:attemptId`、404，以及之後新增卻忘了登記的路由 |
| 工作區 `workspace` | `lg:[--page-px:2rem] lg:py-4`（寬度不變）；工作區路由的自動收合（§3.2） | 六個題型頁（`/vocabulary`…`/mixed`）、`/practice/:section/:tier`、`/exams/:examId`、`/mock/:paperId`、`/writing/translation/:examId`、`/writing/translation/ai/:code`、`/writing/essay/:examId`、`/writing/essay/ai/:code`、`/writing/essay/custom`、`/writing/submissions/:id` |

**放寬用 `bleed` 工具類**（`index.css` 的 `@utility bleed`）：

```css
@utility bleed {
  width: min(100cqw - 2 * var(--page-px, 0px), var(--bleed-max, 82rem));
  margin-inline: calc((100% - min(100cqw - 2 * var(--page-px, 0px), var(--bleed-max, 82rem))) / 2);
}
```

- `100cqw` 是 `main` 的內容寬（`main` 的 `lg:pl-64` 不算在內），所以放寬的區塊永遠置中在內容區、不會碰到側邊欄。Chromium 141 實測（`--page-px` 2.5rem）：1280 時 944（和內容同寬）、1440 時 1,104、1920 時 1,312；`--bleed-max` 設成很大時 1920 是 1,584；都沒有水平捲動。
- 用法：`lg:bleed` 加在改版的區塊上（可以是桌機分支裡的新元素，也可以是既有元素，R1）。首頁儀表板、列表頁的頁首＋`StickyBar`＋表格或網格、單字庫、成績單用預設上限 82rem；作答頁與寫作的工作面（題型頁的頁首與作答區、試卷與工具列、`Workspace`）另加 `lg:[--bleed-max:100cqw]`，不設上限。
- **沒加的區塊自動維持 944 px**：`InfoSection`、說明段落、開考前畫面、交卷摘要、PDF 下載區塊，以及其他工作線之後新增的任何區塊。第 1 版「寬版模式拿掉上限，沒改的區塊自己加回 `xl:max-w-5xl`」的寫法作廢。
- 使用條件：`bleed` 元素到內容容器之間的祖先不能有左右 padding 或 margin（置中會偏），也不能隔著另一個 container（`100cqw` 會改指那個 container）。`desktop-shell.spec` 會檢查非工作區路由上任何 `p`、`li` 的寬度都不超過 60rem（§11.3）。
- 判斷依 pathname，不依頁面狀態；頁面不能自己改模式（不提供 context 讓頁面切換），避免 lazy 載入完成後才變寬、畫面跳動。

### 2.4 行長與閱讀順序

- **英文閱讀行長 65–75 字元**：選文面板、作文作答框、批改結果的作文都以這個為目標（中文說明用 `max-w-prose`，約 36–40 個中文字）。現況：作文作答框 902 px 約 117 字元一行、批改結果約 121、綜合測驗選文 96–99、閱讀面板 45–52（1024 時 32–36）（實測）。分欄後的欄寬見 §6、§7；作答框與作文另外限 `max-w-[72ch]`，實作後用盤點時的量法（`x-line-length`）再量一次（設計值）。
- 工作區可以更寬（作答區、題目面板、錯誤清單並排），但單一段英文的寬度要受上面的限制。
- **DOM 順序＝螢幕閱讀器與 Tab 的順序，不因為改成多欄而改變**：先題目後作答、先選文後題目、先主要內容後右欄。視覺上的左右只用 grid 的欄位放置，不用 `order` 把後面的內容搬到前面（WCAG 1.3.2、2.4.3）。右欄用 `<aside aria-label="…">`。
- 會自己捲動的面板：`role="region"`＋`aria-label`＋`tabIndex={0}`（沿用 `Paper.tsx:78–82` 的做法），只在它真的會捲動時（分欄後）才加 `tabIndex`，手機的 Tab 順序不多一站。

## 3. 殼層

### 3.1 內容容器與頁尾（`components/Layout.tsx`）

現況：內容容器 `mx-auto max-w-5xl px-4 py-6 lg:px-10 lg:py-10`；頁尾是 `main` 裡的一般區塊，短頁（404 內容只有 254 px、設定頁）的頁尾浮在畫面中間；頁尾的上框線寬 1,024，內容卡片寬 944，左右各凸出 40 px（實測）。

```tsx
const mode = desktopWidthMode(location.pathname);           // 'narrow' | 'default' | 'workspace'
const sidebar = useSidebarState(location.pathname);         // 'expanded' | 'collapsed'（含工作區的自動收合，§3.2）
<main id="main" ref={mainRef}
  className={`pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 ${sidebar === 'collapsed' ? 'lg:pl-16' : 'lg:pl-64'} lg:@container/main lg:flex lg:min-h-dvh lg:flex-col`}>
  <MainWidthProvider mainRef={mainRef} sidebar={sidebar}>   {/* useMainTier() 的來源，§4.1 */}
    <div className={`mx-auto max-w-5xl px-4 py-6 lg:w-full lg:flex-1 lg:[--page-px:2.5rem] lg:px-(--page-px) lg:py-10 ${MODE_CLASSES[mode]}`}>
      …
    </div>
    <SiteFooter mode={mode} />
  </MainWidthProvider>
</main>
<BackToTop />   {/* fixed 定位，放在 main 外面（R5） */}
```

- `lg:w-full` 一定要加：flex 直排容器裡，左右 `margin: auto` 的子元素不會被拉伸，會縮成內容寬度（容易漏掉的坑）。
- `--page-px` 是內容的左右內距。作答工具列（`ExamToolbar.tsx:129`、`MockToolbar.tsx:122`）與 `StickyBar` 用 `lg:-mx-(--page-px) lg:px-(--page-px)` 撐滿內容區，取代寫死的 `lg:-mx-10 lg:px-10`；工作區模式把它改成 2rem 時，工具列自動跟著改。
- 頁尾：加和內容相同的寬度 class；框線從 `footer` 移到裡面的 `nav`（`lg:border-t-0` ＋ nav `lg:border-t lg:border-line`），左右和內容卡片對齊。另外加只在 ≥ lg 顯示的「鍵盤快捷鍵」連結（開 `ShortcutHelp`）。「關於」留在側邊欄底部（§3.2），頁尾不另外加。
- 換頁捲回頂端（`Layout.tsx:255–257`）不變。

### 3.2 側邊欄

現況：導覽內容要 898 px，900 px 高的螢幕只看得到 764（未登入）／771（已登入），「其他」群組（設定、關於）被切掉，也沒有捲動提示；未登入時最醒目的是整條實心主色的「使用 Google 登入」；主題切換是品牌列右邊一顆圖示（實測）。

改成三段（`Sidebar` 只在 ≥ lg 顯示，可以自由改；`modules.ts` 不動）。`<nav aria-label="主要導覽">` 包住中段與下段，頁面上仍只有一個同名的導覽地標（`smoke.spec.ts:94–99` 要求只有一個，而且裡面看得到「關於」連結）：

1. **上：品牌列**（`h-12`）：`Brand`＋收合按鈕（`aria-label="收合側邊欄"`／「展開側邊欄」、`aria-expanded`、提示 `[`；只在 `(pointer: fine)` 時出現，見下方「收合」）。
2. **中：導覽清單**（`flex-1 overflow-y-auto`，左右留 6 px 內距，焦點框不會被裁掉，§4.11）：
   - 每項 `py-0.5 leading-6`（28 px 高，仍 ≥ 24 px，WCAG 2.5.8）、群組標題 `text-xs leading-4`（16 px）、群組上方 `mt-1`、清單上下 `py-2`：14 項＋4 個群組標題約 488 px（設計值）。
   - 「其他」群組（設定、關於）不列在清單裡，改成底部一列的圖示連結。手機的「更多」面板照舊。
   - 放不下時在底部加淡出遮罩當捲動提示：清單最後放一個 1 px 的哨兵元素，`IntersectionObserver`（root 是清單本身）看不到它時設 `data-overflow`，樣式 `lg:data-overflow:[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]`；捲到底、哨兵出現時就拿掉。不掛 scroll 事件。
   - **目前位置**：`/writing/translation*` 標「中譯英」、`/writing/essay*` 標「英文作文」、其他 `/writing*` 標「寫作」（`sidebarActivePath(pathname)`；同一時間只有一項 `aria-current="page"`）。目前項除了底色另加左側 3 px 的色條（框線，高對比模式下仍看得到）。現在從「中譯英」點進題目列表，側邊欄卻亮「寫作」。
   - 首次設定期間（`/account/welcome`）：清單加 `inert` 與 `lg:opacity-50`，上方一行「完成設定後就能使用其他功能」。現在可以點，點了又被 `OnboardingRedirect` 拉回來。
3. **下：工具列**（`shrink-0 border-t`）：
   - 已登入：一列＝帳號按鈕（頭像＋暱稱＋AI 狀態，`flex-1 truncate`，暱稱全文放 `title`）＋四顆圖示：主題（沿用 `ThemeToggle`）、快捷鍵（開 `ShortcutHelp`）、設定（連到 `/settings`）、關於（連到 `/about`）；設定與關於是連結，目前頁時 `aria-current="page"`。帳號選單**往上**開（`LoginButton.tsx:145` 的 `inset-x-0 top-full mt-1` 改成 sidebar 專用的 `bottom-full mb-1`）。
   - 未登入：第一列外框樣式的「使用 Google 登入」（`border border-line`，不用實心主色；可存取名稱不變，`account.spec.ts:32` 照樣找得到），提示「學校帳號不能用時請改用個人 Gmail」放在按鈕下一行；第二列是四顆圖示。
   - 高度（設計值）：品牌 48＋清單 488＋已登入工具列約 49＝約 585；未登入工具列約 108，合計約 645。**目標：1366×640 已登入與未登入都不用捲**（未登入差的幾 px 在實作時調群組間距或把提示句改成按鈕的 `aria-describedby`＋滑鼠提示）；1280×600 已登入不用捲，未登入允許捲動，但淡出遮罩一定要出現（e2e 驗，§11.3）。

**收合**：寬 4rem，只剩圖示；每項的文字改成 `sr-only`（可存取名稱不變）；群組標題換成細分隔線；底部工具列改成直排（頭像、主題、快捷鍵、設定、關於）。

- **文字提示**：滑鼠移入或鍵盤聚焦（`:focus-visible`）任一項時，在側邊欄右側顯示一個提示泡泡，內容就是該項的文字。整個側邊欄共用一個 `aria-hidden` 的泡泡元素（`position: fixed`，位置用該項的 `getBoundingClientRect()` 算；清單是捲動容器，放在項目裡的 absolute 提示會被裁掉）。不用 `title`：`title` 在鍵盤聚焦時不會出現，觸控也看不到。
- **只在 `(pointer: fine)` 時提供收合**：觸控為主的裝置（iPad 橫向是 1024，也會進到桌機版）沒有 hover，收合後只剩看不懂的圖示，所以不顯示收合按鈕、`[` 不作用、已存的「收合」也不套用。
- **切換與記憶**：收合按鈕或 `[` 鍵，存在 localStorage（§4.3）。
- **工作區路由的自動收合**（§14 第 2 點的新預設）：在工作區路由上，如果使用者從沒自己設定過、`(pointer: fine)`，而且側邊欄展開時 main 會小於 60rem（視窗約 < 1216 px），就先收合（不寫進 localStorage）；離開工作區路由後恢復展開。使用者自己按過收合或展開之後，一律照他的設定。結果：1024–1215 寬的作答與寫作頁內容從 704 變 896 px，寫作可以分欄（§6）。判斷在 Layout render 時同步算出（`document.documentElement.clientWidth`），換頁時不會先展開再收起。

### 3.3 不加全站頂端列

桌機的長列表頁捲動後看不到頁名與篩選（/composition 9,140 px、/writing/essay 6,947、/translation 6,822、/exams 6,745，1440 寬）（實測），但不用全站頂端列解決：

- `ExamToolbar`、`MockToolbar` 與題型頁的工具列都是 `lg:top-0`，`MockSessionPage.tsx:84` 的 `stickyToolbarBottom()` 依賴這個位置；加頂端列要全部改，還會吃掉作答頁 56 px 的高度（在 600 高的視窗是 9%）。
- 改成**頁內 sticky 篩選列**（`StickyBar`，§4.7）：列表頁把篩選膠囊、頁內跳轉、筆數放進去；超過 3 個視窗高的頁面另外加「回到頂端」按鈕（`hidden lg:flex fixed bottom-6 right-6`，放在 `main` 外面，R5）。
- 子頁的返回連結（「‹ 寫作練習」等）維持在頁首；列表頁的返回連結移進 `StickyBar`，捲動時也看得到。

### 3.4 跳到主要內容與焦點

- 「跳到主要內容」（`Layout.tsx:268–273`）不變。
- 寫作工作區的頁首（只在 ≥ lg 的桌機樹裡 render）有兩個跳轉連結（`sr-only focus:not-sr-only`）：「跳到題目」「跳到作答區」，目標是兩個 Pane。兩個 Pane 在分欄與堆疊兩種排法都存在，連結不會指向不存在的元素。作答頁不加（工具列就在最上面）。
- **焦點不被 sticky 元素蓋住**（WCAG 2.4.11）：`index.css` 在 `@media (width >= 64rem)` 裡設 `html { scroll-padding-top: calc(var(--session-bar-h, 0px) + var(--sticky-bar-h, 0px) + 1rem); scrollbar-gutter: stable; }`。Tab／Shift+Tab、錨點跳轉、`scrollIntoView` 都會留出工具列與篩選列的高度。Chromium 141 實測：100 px 高的 sticky 列，從頁面底部連按 30 次 Shift+Tab，沒有 scroll-padding 時 7 次焦點落在列底下，設了之後 0 次。
  - 原本為手機頂端列設的 `scroll-mt-*`（`Questions.tsx:27` 的題目卡 `scroll-mt-32`、`Paper.tsx:115` 的大題標題、`ListSection.tsx:16` 的 `lg:scroll-mt-4`）在 lg 改成 `lg:scroll-mt-2`，不和 scroll-padding 重複計算。
  - `DataTable` 的列連結另加表頭高度的 `lg:scroll-mt-11`（sticky 表頭約 44 px）。
  - 面板裡不放 sticky 元素（分頁列在捲動容器外面，§4.6），所以面板不需要自己的 scroll-padding。
- 對話框：`ShortcutHelp` 用原生 `<dialog>` 的 `showModal()`——背景自動 inert、Esc 原生關閉，關閉後焦點回到觸發按鈕；開著時 `html:has(dialog:modal)` 設 `overflow: hidden`，因為 `html` 在 ≥ lg 一律 `scrollbar-gutter: stable`，捲軸消失時版面不會左右跳。「全部題號」下拉與送出確認列不是 modal：Esc 關閉、焦點回原處。
- 程式移動焦點一律「先捲、後聚焦」：`scrollAndFocus(el)`（§4.10）＝ `scrollIntoPane` ＋ `focus({ preventScroll: true })`。只有使用者明確選了某個項目（點錯誤編號、按 N／P）才移動焦點。
- `prefers-reduced-motion: reduce` 時不用平滑捲動、不做閃爍提示（回饋改成靜態外框）。

### 3.5 桌機專用設定

設定頁加一個只在 ≥ lg 顯示的「電腦版介面」區塊（`hidden lg:block`，§5.10）：側邊欄（自動／一律展開／一律收合）、單鍵快捷鍵開關、歷屆試題列表用表格或卡片。都存在這台裝置的 localStorage。

## 4. 共用元件與工具

全部只在 ≥ lg 生效；手機分支不 import 也不 render 它們（純 CSS 常數除外）。

### 4.1 `lib/media.ts`

```ts
export const MQ = { lg: '(min-width: 64rem)', pointerFine: '(pointer: fine)' } as const;
export const MAIN_TIER_PX = { ws: 960, wide: 1280 } as const;     // ＝ CSS 的 --container-ws／--container-wide
export function useMediaQuery(query: string): boolean;            // useSyncExternalStore＋matchMedia 的 change 事件；getServerSnapshot 回傳 false
export const useIsDesktop = () => useMediaQuery(MQ.lg);
export function MainWidthProvider(props: { mainRef: RefObject<HTMLElement | null>; sidebar: 'expanded' | 'collapsed'; children: ReactNode }): ReactNode;
export function useMainTier(): { width: number; ws: boolean; wide: boolean };   // < lg 一律 { width: 0, ws: false, wide: false }
export function DesktopOnly({ children }: { children: ReactNode }): ReactNode;
```

- 用 `min-width` 寫法，和 Tailwind 的 rem 斷點一致。沒有 SSR，第一次 render 就拿到正確的值，不會閃。沒有 `matchMedia` 的環境回傳 false（走手機路徑）。
- `useMainTier`：`ResizeObserver` 量 `main` 的內容寬（和 `@container/main` 量的是同一個寬度）。第一次 render 前還沒量到時，用 `document.documentElement.clientWidth − 側邊欄寬` 同步算（`clientWidth` 已扣掉捲軸，所以結果相同）。
- **跨斷點時保存焦點**（lib/media.ts 內部）：lg 的 change 事件與 `useMainTier` 的層級改變時，在通知 React 之前先記下 `document.activeElement` 的 `id`、`selectionStart／selectionEnd`、`scrollTop`；新的樹 commit 後（`useLayoutEffect`）用同一個 `id` 找回元素，`focus({ preventScroll: true })` 並還原游標。兩棵樹裡的輸入框用相同的 `id`（R3 保證同時只有一份）。找不回來（焦點落在 `body`）時，單鍵快捷鍵暫停到下一次 `pointerdown` 或 `focusin`（§4.4），避免焦點掉到 `body` 的那段時間按的字母去作答。
- 什麼時候會換樹：只有跨過 lg（例如 1366 的筆電用 Win＋← 半螢幕約 683、iPad 旋轉）。lg 以上不同寬度靠 CSS 換排法（R4），作答框不會重新掛載。仍會遺失的只有瀏覽器的復原紀錄（Ctrl＋Z）與正在組字的注音（§13 R5）。

### 4.2 `lib/desktopLayout.ts`

```ts
export type WidthMode = 'narrow' | 'default' | 'workspace';
export const MODE_CLASSES: Record<WidthMode, string>;              // §2.3
export function desktopWidthMode(pathname: string): WidthMode;      // 依 §2.3 的對照表；沒列出的路徑 → 'default'
export function isWorkspaceRoute(pathname: string): boolean;        // 自動收合側邊欄用
export function sidebarActivePath(pathname: string): string | null; // §3.2 的目前位置規則
```

對照表用路由樣式（`/writing/translation/ai/:code` 這種）寫，用 react-router 的 `matchPath` 比對，順序與 `App.tsx` 相同（靜態段 `ai`、`custom` 先於 `:examId`）。Layout 不知道 `<Routes>` 命中哪一條，所以只看 pathname；對照表沒有的路徑給 `default`，新路由忘了登記時也是最安全的寬度。

### 4.3 `lib/desktopPrefs.ts`

```ts
// 鍵：gsat-ui:v1:sidebar（'expanded' | 'collapsed'；沒有＝自動）、gsat-ui:v1:single-key（'on' | 'off'）、gsat-ui:v1:list-view:{page}（'table' | 'cards'）
export function useDesktopPref<T extends string>(key: DesktopPrefKey, fallback: T | null): [T | null, (v: T | null) => void];
```

`useSyncExternalStore` 讀 localStorage（每次讀寫包 try/catch，讀不到用預設值），監聽 `storage` 事件讓多個分頁同步。

### 4.4 `lib/hotkeys.ts`

```ts
export function isTextEntryTarget(t: EventTarget | null): boolean;   // 文字類 input、textarea、select、contenteditable（radio、checkbox、button 不算）
export function isFormControlTarget(t: EventTarget | null): boolean; // 所有 input、textarea、select、contenteditable（＝現在 StudyView.tsx:45、QuizSession.tsx:134 的 isTypingTarget，兩份搬過來合成一份，行為不變）
export function isModalOpen(): boolean;                              // document.querySelector('dialog:modal, [aria-modal="true"]') !== null
export function hotkeyChar(e: KeyboardEvent): string | null;         // 見下方「按鍵比對」
export function suspendSingleKeys(): void;                           // §4.1 焦點找不回來時呼叫；下一次 pointerdown／focusin 自動解除

export interface HotkeyDef {
  keys: string[];                   // 'n'、'?'、'mod+enter'（mod＝Ctrl，Mac 上是 ⌘）、'mod+s'
  description: string;              // 給 ShortcutHelp 顯示
  group: '全站' | '這一頁';
  allowInTextEntry?: boolean;       // 只有帶 mod 的組合可以設 true（作文框裡的 Ctrl+Enter）
  when?: () => boolean;
  run: (e: KeyboardEvent) => void;  // 處理了就 preventDefault
}
export function useHotkeys(defs: HotkeyDef[], options: { enabled: boolean }): void;
export function useActiveHotkeys(): readonly HotkeyDef[];   // ShortcutHelp 用
```

- document 上只掛一個 keydown 監聽，各元件註冊到同一份表；後註冊（頁面）的先比對，比全站的優先。
- **一律略過**：`e.repeat`（按住不放的自動重複，所有快捷鍵都一樣）；`e.defaultPrevented`；有 Alt；`isModalOpen()`（對話框自己處理按鍵；模擬考的 `SubmitDialog` 是原生 `<dialog>`，也偵測得到）；單鍵（沒有 mod）時按著 Ctrl／⌘；單鍵且焦點在文字輸入欄位；單鍵且設定關掉單鍵快捷鍵；單鍵且在暫停中（§4.1）；單鍵且 `e.key === 'Process'` 或 `keyCode === 229`（輸入法正在處理這個鍵）。
- 帶 mod 的組合在文字輸入欄位裡（`allowInTextEntry`）：`e.isComposing` 時略過——組字中按 Ctrl＋Enter 是在選字，不是送出。**這是唯一靠輸入法狀態做的保護**；單鍵快捷鍵不依賴輸入法（§8 輸入法）。
- **Enter、空白鍵、方向鍵不註冊成任何快捷鍵**（包括送出確認列）：焦點在按鈕或 radio 上時它們有原生作用（ArrowDown 會把 radio 的答案從 (A) 改成 (B)（實測）；practice e2e 會對提示按鈕按 Enter）。
- **按鍵比對**（`hotkeyChar`）：`e.key` 是單一個 ASCII 字母或數字時用它（不分大小寫；Dvorak 等配置照字面）；不是的話（例如某些輸入法送出「ㄅ」這類非 ASCII 字）改用 `e.code`（`KeyA`–`KeyZ`、`Digit1`–`Digit9`、`Numpad1`–`Numpad9`）；`?` 用 `e.key === '?'`。
- `enabled` 的條件一定包含 `useIsDesktop()`（R7）。
- 舊的監聽（`StudyView.tsx:301–320`、`QuizSession.tsx:520–532` 的 document keydown）不搬進註冊表（行為不變），但在 ≥ lg 時加上 `isModalOpen()` 的檢查：在 /words 打開 `ShortcutHelp` 之後按 1–4 或 Enter，背後的單字卡不會被評分或作答。手機沒有 `ShortcutHelp`，檢查也包在 `useIsDesktop()` 裡（R7）。

### 4.5 `Workspace` 與 `Pane`（`components/desktop/Workspace.tsx`）

```tsx
<Workspace
  layout="prompt-editor" | "sentences-rail" | "result"   // 欄寬見下表
  split="auto" | "off"            // off：一律堆疊（自訂題目還沒設定好或正在修改題目，§6.2）
  header={<WorkspaceHeader back={…} title={…} badges={…} />}   // 一行：返回連結、題名、標章、跳轉連結
  left={<Pane id="ws-prompt" label="題目">…</Pane>}
  right={<Pane id="ws-editor" label="作答區" fill>…</Pane>}
  rail={…}                        // 選填：wide 寬度才出現的第三欄（P2）
/>
```

- **桌機分支的唯一一棵樹**：寫作頁在 ≥ lg 一律 render `Workspace`，在 < lg 走原本的 JSX（R4）。分欄或堆疊只靠 CSS 切換：`split="auto"` 且 main ≥ 60rem（`lg:@ws/main:`）時分欄，否則堆疊。所以 1366 放大到 110% 或把視窗從 1366 拖到 1200，作答框都不會重新掛載。
- **分欄時整個工作區剛好一個視窗高**：
  - 頁首壓成一行（`WorkspaceHeader`：返回連結、題名、補考標章同一列，跳轉連結 `sr-only`），用 `useStickyHeightVar` 把高度寫到工作區元素自己的 `--ws-head-h`（不寫在根元素）。
  - 兩欄的 grid 高度 `calc(100dvh - var(--ws-head-h, 2.75rem) - 2.75rem)`（內容上下 `py-4` 共 2rem，加頁首下方 0.75rem），`min-h-[26rem]`。1280×600 時約 512 px、1366×640 時約 552 px（設計值）。
  - 每個 Pane 是 `min-h-0 overflow-y-auto` 的捲動容器，**不用 sticky、不用 `overscroll-contain`**：面板捲到底之後滾輪會帶動整頁，頁面本身只多出頁尾的高度。這樣兩欄一開始就從頁首下方開始、底部在視窗內，不會有第 1 版「一開始面板底部在畫面外一個頁首高」的問題。
  - `Pane fill`：直排 flex，子元素裡標了 `flex-1 min-h-0` 的（作答框）填滿剩下的高度；內容放不下時 Pane 自己捲。
  - 視窗矮到 grid 碰到 `min-h` 時（約 < 500 px），頁面照常捲動。
- **堆疊時**：Pane 跟著頁面排在一般流裡，不設高度、不自己捲、不加 region 的 `tabIndex`；順序和手機相同（題目在上、作答在下）。
- `usePaneA11y(label)`：分欄時回傳 `{ role: 'region', 'aria-label', tabIndex: 0, 'data-pane-scroll': '' }`，堆疊與 < lg 回傳空物件。作答頁的選文欄（§7.2）也用它。

| layout | ws（main ≥ 60rem） | wide（main ≥ 80rem） |
|---|---|---|
| `prompt-editor`（作文） | `grid-cols-2 gap-6`（1:1）；作答框 `max-w-[72ch]`、題目文字 `max-w-prose` | 有 rail 時 `[minmax(0,1fr)_minmax(0,1fr)_20rem]`（P2） |
| `sentences-rail`（中譯英） | `[minmax(0,1fr)_22rem] gap-6` | 同左 |
| `result`（批改結果） | `[minmax(0,7fr)_minmax(0,5fr)] gap-6`；作文 ≤ 72ch | 同左 |

- 作文改成 1:1（第 1 版是 5fr／7fr）：5fr 在 1280 只剩約 390 px，歷屆題目在這個寬度會超過 1,200 px 高。1:1 時左欄 436（ws 門檻）、468（1280）、511（1366）、548（1440）px，作答框（扣掉面板內距）1440 時約 60 字元一行（設計值，§6.1）。
- 欄寬固定比例，不做拖曳調整（§9）。

### 4.6 `PaneTabs`（`components/desktop/PaneTabs.tsx`）

左欄的分頁（題目／自我檢核與自評／評分規準…）。

- 真正的 `tablist`：左右方向鍵、Home／End、roving tabindex。props：`tabs: { id; label; badge?; panel: ReactNode }[]`、`value`、`onChange`、`label`；另外提供 `select(id)` 給「在作文中標出」、同名的「自我檢核與自評（不用 AI）」按鈕這類程式切換。
- **分頁列在捲動容器外面**：Pane 的結構是「固定的摘要（選填）→ 分頁列 → 面板」，分欄時每個 `tabpanel` 自己是捲動容器（`flex-1 min-h-0 overflow-y-auto`，`tabIndex={0}`，`aria-labelledby` 對應的分頁），分頁列永遠看得到，也不需要 sticky。
- **每個分頁各自記住捲動位置**：面板保持掛載（勾選、輸入不會消失），切走時記下該面板的 `scrollTop`、切回來時還原（隱藏的捲動容器可能被瀏覽器重設捲動位置，所以不依賴瀏覽器）。第 1 版「切換分頁時捲回頂端」的說法刪除。
- **Ctrl＋F 找得到隱藏分頁裡的字**：隱藏的面板用 `hidden="until-found"`，監聽 `beforematch` 事件，瀏覽器找到其中的字時自動切到那個分頁（React 19 的 `hidden` 屬性接受字串；不行就用 ref 設屬性，`beforematch` 一律用 `addEventListener`）。不支援的瀏覽器退回一般的 `hidden`（＝現在的行為）。
- 堆疊時沿用同一個分頁列，面板不自己捲。

### 4.7 `StickyBar`（`components/desktop/StickyBar.tsx`）

列表頁的 sticky 篩選列：`lg:sticky lg:top-0 lg:z-10 lg:-mx-(--page-px) lg:px-(--page-px) lg:py-2 lg:border-b lg:border-line lg:bg-bg/95 lg:backdrop-blur`。用 `ResizeObserver` 把自己的高度寫到 `--sticky-bar-h`（document 根元素，卸載時移除），給：

- `html` 的 `scroll-padding-top`（§3.4）：Tab、錨點跳轉時內容不會被篩選列蓋住；`ListSection` 的 `lg:scroll-mt-4` 改成 `lg:scroll-mt-2`；
- `DataTable` 的表頭 `top`；
- /words 篩選欄的 `top` 與 `max-h`（§5.9）。

可以用在原本就存在的篩選容器上（只加 class，CSS-only），也可以是新的桌機專用元素（`DesktopOnly`）。

### 4.8 `DataTable`（`components/desktop/DataTable.tsx`）

```ts
interface Column<T> {
  id: string; header: ReactNode;
  cell: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;   // 有才可排序
  align?: 'start' | 'end'; className?: string; srOnlyHeader?: boolean;
}
interface DataTableProps<T> {
  caption: string;                 // 表格名稱（可以 sr-only）
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string;
  primaryLink?: (row: T) => { to: To; label: ReactNode; state?: unknown };  // 每列唯一可聚焦的主要連結，放在第一欄
  initialSort?: { id: string; dir: 'asc' | 'desc' };
  groupBy?: (row: T) => string; groupLabel?: (key: string) => ReactNode;   // 分組列（<tbody> 一組一個，加標題列）；整組相同的值（例如考試時間）放在這裡
  stickyHeader?: boolean; empty?: ReactNode;
}
```

- 真的 `<table>`：`<caption>`、`<th scope="col">`、可排序的表頭是 `<button>` 放在 `<th aria-sort>` 裡；數字欄 `tabular-nums` 靠右。
- **整列可點**：第一欄放真正的 `<Link to state>`（鍵盤、螢幕閱讀器、中鍵與 Ctrl＋點擊都靠它；`state` 讓列表把篩選條件帶進下一頁，§5.7）；`<tr>` 的 `onClick` 只是滑鼠的方便——點到列上非互動元素、且沒有選取文字時，觸發該列的 Link。不用 `role="link"` 的 `<tr>`，也不用絕對定位的覆蓋層（`<tr>` 的 `position: relative` 各瀏覽器表現不一）。
- **每列只有一個 Tab 停留點**：目的地和主要連結相同的「動作」一律不做成第二個連結（改成不可聚焦的標章或文字）；只有目的地不同時（例如 /mock 的「看成績單」）才放第二個連結。66 列就是 66 個停留點，不是 132 個，螢幕閱讀器的連結清單也不會重複。
- 列 `lg:hover:bg-surface-2`、`cursor-pointer`；被截斷的文字（`truncate`、`line-clamp`）加 `title` 放全文。列連結 `lg:scroll-mt-11`，Tab 時不會停在 sticky 表頭底下（§3.4）。
- **sticky 表頭的限制**：表格的任何祖先都不能有 `overflow: auto/hidden`，否則 sticky 失效。所以表格在 lg 以上不包水平捲動容器；欄位設計成 688 px（1024 展開）放得下，放不下的欄在 main 不夠寬時用 container query 隱藏（`lg:@max-ws/main:hidden`）。
- 只在 ≥ lg render（用 `useMediaQuery` 二選一，R3），< lg 維持各頁現有的卡片。**每列的可存取名稱沿用卡片的寫法**（例如「115 學測」），e2e 的 `getByRole('link', { name })` 不用改（§10.5）。

### 4.9 `ShortcutHelp` 與 `Kbd`

- `ShortcutHelp`（`components/desktop/ShortcutHelp.tsx`，`React.lazy`，第一次開啟才下載）：原生 `<dialog>`＋`showModal()`，標題「鍵盤快捷鍵」，分「全站」「這一頁」兩組，從 `useActiveHotkeys()` 讀；最下面是單鍵快捷鍵開關、說明「焦點在文字欄位時，單鍵快捷鍵不會作用；不需要可以在這裡關掉」，以及連到設定頁的連結。**不寫任何關於中文輸入法的說法**，等 §8 的實機測試結果出來再決定要不要補。
- 開啟方式：? 鍵、側邊欄底部的快捷鍵按鈕、作答頁題號列的 ? 按鈕、頁尾的「鍵盤快捷鍵」。
- 背景 inert、Esc 關閉、焦點還原、鎖捲動見 §3.4。
- `Kbd`：`<kbd>` 的樣式（`rounded border border-line bg-surface-2 px-1.5 font-mono text-xs`）。Mac 顯示 ⌘，其他顯示 Ctrl（依 `navigator.userAgentData?.platform ?? navigator.platform`）。
- 控制項旁的按鍵提示一律 `hidden lg:inline`，而且只放在空間夠的地方（寫作的送出按鈕、?說明對話框）；作答頁的題號列不放提示文字（§7.1）。有快捷鍵的按鈕加 `aria-keyshortcuts`。

### 4.10 捲動與 sticky 工具（`components/desktop/scroll.ts`）

```ts
export function scrollIntoPane(el: Element, opts?: { block?: 'nearest' | 'center' | 'start' }): void;
export function scrollAndFocus(el: HTMLElement, opts?: { block?: 'nearest' | 'center' | 'start' }): void;   // scrollIntoPane ＋ focus({ preventScroll: true })
export function useStickyHeightVar(ref: RefObject<HTMLElement | null>, name: '--session-bar-h' | '--sticky-bar-h' | '--ws-head-h', opts: { enabled: boolean; target?: 'root' | 'parent' }): void;
```

- `scrollIntoPane`：只捲 `el` 所在的 `[data-pane-scroll]` 面板（用 `pane.scrollTo`），不像 `scrollIntoView` 連整頁一起捲；不在面板裡時才捲 window，並扣掉 `--session-bar-h`／`--sticky-bar-h`。
- **所有在捲動之後的程式焦點移動都用 `scrollAndFocus`**：一般的 `.focus()` 會立刻再捲一次 window 與祖先容器，打斷剛開始的平滑捲動，停的位置也和 `scrollIntoPane` 算的不同。現有的 `focusQuestion` 已經用 `preventScroll`，新程式照做。
- `useStickyHeightVar`：`ResizeObserver` 量高度，只有改變時才寫 CSS 變數（不在捲動事件裡讀寫版面）；ResizeObserver 的回呼在繪製前執行，第一個畫面不會跳動；卸載時移除。

### 4.11 浮層、焦點框與高對比

- **浮層**（「全部題號」下拉、帳號選單、提示泡泡、`ShortcutHelp`、送出確認列）：`border border-line bg-surface shadow-lg`，深色模式靠框線和底下的卡片分開（R11）。
- **焦點框不被裁掉**：全站的 `:focus-visible { outline: 2px; outline-offset: 2px }`（`index.css:142–145`）會被 `overflow` 容器裁掉。會捲動的 Pane、分頁面板、選文面板、側邊欄清單一律留 ≥ 4–6 px 的內距（`lg:p-1.5` 這類），讓貼邊的分頁、checkbox、導覽連結的焦點框完整；真的不能留內距的地方，在該容器內用 `lg:[&_:focus-visible]:-outline-offset-2`。
- **高對比（forced-colors）**：box-shadow 會被拿掉、底色會被換掉，全站目前沒有任何 `forced-colors` 處理（grep 結果為 0）。這次新增的狀態一律用 outline 或框線：目前題 `lg:data-current:outline-2 lg:data-current:outline-offset-2 lg:data-current:outline-primary`（第 1 版的 `ring-2` 是 box-shadow，作廢）、選中的錯誤卡片同樣用 outline、側邊欄目前頁加左側色條（框線）、題號格「已答」除了底色另有勾號（✓，`aria-hidden`）。§11.2 加一組 `page.emulateMedia({ forcedColors: 'active' })` 的桌機截圖。

## 5. 首頁、列表與其他頁

### 5.0 路由總表

盤點涵蓋的 37 條路由（含帶參數的子頁）都在下表。「放寬」＝哪些區塊加 `lg:bleed`（§2.3），沒列的區塊維持 944 px。P1＝這一版必做；P2＝可以拆到之後的 PR（§9）。

| 路由 | 模式 | 放寬 | 章節 | PR |
|---|---|---|---|---|
| `/` | 一般 | 儀表板（ws 寬度起） | §5.1 | A |
| `/words`（單字庫、每日學習、測驗、錯題本、`?word=`） | 一般 | 分頁列＋單字庫 | §5.9 | C |
| `/practice` | 一般 | 頁首＋矩陣＋右欄 | §5.2 | A |
| `/vocabulary`、`/cloze`、`/word-bank`、`/structure`、`/reading`、`/mixed` | 工作區 | 頁首＋作答區（不設上限） | §5.3、§7 | A（頁首）、C（作答區） |
| `/translation`、`/composition` | 一般 | `StickyBar`＋卡片網格 | §5.4 | A |
| `/writing` | 一般 | 入口網格＋紀錄表格＋右欄 | §5.5 | A |
| `/writing/translation`、`/writing/essay`、`/writing/translation/ai`、`/writing/essay/ai` | 一般 | `StickyBar`＋卡片網格 | §5.6 | A |
| `/writing/translation/:examId`、`/writing/translation/ai/:code` | 工作區 | `Workspace` | §6.3 | B |
| `/writing/essay/:examId`、`/writing/essay/ai/:code`、`/writing/essay/custom` | 工作區 | `Workspace` | §6.2 | B |
| `/writing/submissions/:id`（批改完成、排隊與批改中、待確認辨識文字、已確認待送出） | 工作區 | `Workspace` | §6.6、§6.7 | B |
| `/exams` | 一般 | 頁首＋`StickyBar`＋表格 | §5.7 | A |
| `/exams/:examId` | 工作區 | 工具列＋試卷（開考前與交卷摘要不放寬） | §7.5 | C |
| `/mock` | 一般 | 列式卡片＋右欄 | §5.8 | A |
| `/mock/:paperId` | 工作區 | 工具列＋試卷（開考前不放寬） | §7.6 | C |
| `/mock/report/:attemptId` | 一般 | 成績單兩欄 | §7.6 | C |
| `/practice/:section/:tier` | 工作區 | 工具列＋題組 | §7 | C |
| `/settings` | 窄版 | — | §5.10 | A |
| `/about`、`/privacy`、`/terms` | 窄版 | — | §5.11 | A |
| `/account`、`/account/welcome`、`/ai/apply` | 窄版 | — | §5.12 | A |
| `/admin` | 一般 | P2 的表格 | §5.13 | A |
| `*`（404） | 一般 | — | §5.14 | A |

### 5.1 首頁 `/`（`pages/HomePage.tsx`）

現況：1440×900 的第一個畫面只看得到標題、後端狀態、空的學習進度和一張「單字」卡，13 個模組要往下捲 1,763 px；「單字」群組只有一張卡，xl 三欄時右邊兩格空著；`xl:grid-cols-3` 時說明只剩約 190 px 寬，題庫練習的說明換成 6 行；登入後和未登入一模一樣（實測）。

ws 寬度起（P1）：

- `HomePage` 用 `useMainTier().ws` 二選一（首頁沒有輸入框，換樹沒有焦點問題）：否則原本的 JSX 一字不改；是的話走新的組合（`lg:bleed`），版面 `grid grid-cols-[minmax(0,1fr)_20rem] gap-8`。左欄主要內容，右欄 `<aside aria-label="我的學習">`，**不 sticky**（跟著頁面捲，右欄比視窗高時也不會有看不到的下半部）。DOM 順序：頁首 → 左欄 → 右欄。
- **頁首**：登入後加問候（「小明，今天練什麼？」，暱稱來自 `/api/me`）；後端狀態（`BackendStatus`）改成右欄底部的小圓點＋文字，**「後端未連線」與「重新檢查」按鈕的文字不變**（`smoke.spec.ts:137–141`）。
- **左欄第一區「繼續學習」**（最多 4 張，依最後更新時間排序；沒有就不顯示這一區）：作答中的歷屆試題（`attemptProgress`；標題用 `examIdLabel`，不必下載考卷索引）、進行中的模擬考（`gsat-mock:v1:active:*`，剩餘時間）、題庫練習目前的題組（`usePracticeHistory` 的 current）、寫作草稿（歷屆、本站仿真、自訂題目的 drafts）、今天要複習的單字數（只讀 localStorage；若算到期數需要載入詞彙資料，就只放「每日學習」入口）。全部只讀這台裝置的資料，**不打 API、不下載 `/data/`**（`overview.spec.ts:159–168` 斷言首頁沒有 `/data/` 請求）。
- **左欄第二區「全部功能」**：依群組排的精簡列表（32 px 圖示＋標題＋`line-clamp-1` 的說明，完整說明放 `title`；連結的可存取名稱和現在的卡片相同）。用 CSS 多欄（`columns-2`，群組 `break-inside-avoid`），照 DOM 順序自然分成「單字＋選擇題型」（1＋6 項）與「混合題與非選擇題＋實戰」（4＋2 項）兩欄；wide 寬度改成 `grid-cols-4`，一個群組一欄。高度（設計值）：1366×640 看得到「繼續學習」與「全部功能」的前兩組，1440×800 以上整區看得到（沒有「繼續學習」時 1366×640 也看得到全部 13 個）。
- **右欄**：學習進度（`ProgressStats` 加 `variant="rail"`：三格改直排；**沿用同一個 region 名稱、三個 `data-testid="progress-stat"`、相同的連結與文字**，`overview.spec.ts:171–200`、`:229–235` 不用改；左欄不再放進度卡）；已登入且 AI 已核准時，AI 點數小量表（`QuotaMeters`，§5.5）與最近 3 筆寫作紀錄（`listSubmissions`）；後端狀態。
- **lazy**：「繼續學習」與右欄放在 `features/home/DesktopDashboard.tsx`，用 `React.lazy` 且只在 ws 寬度 render；載入前的骨架先佔好高度，載入後不推動版面。`HomePage` 打包在主程式裡（`App.tsx:14`），不能讓它把寫作、模擬考、練習的模組拉進主程式（§11.6 會量）；「全部功能」只用 `PAGES`，留在 `HomePage`。
- 不到 ws 寬度：維持現在的卡片，只受殼層修正影響。

### 5.2 題庫練習 `/practice`（`features/practice/PracticeHome.tsx`）

現況：6 個題型 × 3 種難度用兩欄卡片疊成 3 列，每格只寫「10 組」，看不到做過幾組、答對率；「三種難度給誰」三張說明卡在操作前面佔 280 px（實測）。

lg 起（P1）：

- **矩陣表格**（`useMediaQuery` 二選一，R3）：列是 6 種題型，欄是穩定基礎／進階練習／超越頂標；每格一個連結按鈕，畫面上寫「25 組・已做 3・答對 72%」（`usePracticeHistory`）。**可存取名稱一字不改**，沿用現在的格式「詞彙題・穩定基礎：25 組，已做 3 組」（`practice.spec.ts:130–137`、`overview.spec.ts:306` 用的是這個格式）；答對率放在 `aria-describedby`。沒有題組的格仍是 `role="group"`、名稱「…：出題中」。
- **「三種難度給誰」不收起來**：ws 寬度時三張說明改成右欄的精簡清單（標題「三種難度給誰」與「頂標到 15 級分的學生」這些文字照樣看得到，`practice.spec.ts:127–128`）；不到 ws 寬度時留在原來的位置。表頭的難度名稱旁不再另寫說明，避免同一段話出現兩次。
- ws：`grid-cols-[minmax(0,1fr)_20rem]`，右欄（不 sticky）放「三種難度給誰」、「AI 題目怎麼來的」與本站仿真中譯英、作文的連結。
- 矩陣的鍵盤操作沿用一般 Tab 順序（不做方向鍵網格，§9）。

### 5.3 題型頁的頁首 `/vocabulary`…`/mixed`（`features/practice/SectionPractice.tsx`、`components/ModulePage.tsx`）

現況：第一題之前的頁首佔 360–450 px；1920×1080 時第一題從 y≈456 開始；難度分頁只佔左半、沒有 hover 樣式（實測）。

lg 起（P1）：

- 頁首壓成兩列：第一列左邊 H1＋說明（`lg:line-clamp-1`，全文放 `title`），右邊難度分頁（`lg:flex lg:items-end lg:justify-between`）；第二列是題組標題・主題・題數・AI 標章。頁首元素數固定時用 CSS grid 放置（R1），否則用 `useMediaQuery` 重組（R4）。預計省下 150–200 px（設計值），在 600 高的視窗這是三分之一個畫面。
- 難度分頁加 `lg:hover:border-primary lg:hover:bg-primary-soft/60`。
- 頁首與作答區加 `lg:bleed lg:[--bleed-max:100cqw]`；「學測怎麼考」「題庫練習有什麼」這些 `InfoSection` 不加，自動維持 944 px（§2.3）。wide 寬度起移到右欄（`grid-cols-[minmax(0,1fr)_18rem]`）是 P2。
- 作答區見 §7。

### 5.4 中譯英、英文作文 `/translation`、`/composition`（`pages/TranslationPage.tsx`、`pages/CompositionPage.tsx`）

現況：/translation 6,822 px、/composition 9,140 px；跳到歷屆試題以後篩選與小節標題就被捲走；`KindFilter` 沒有 hover（實測）。

- P1：`StickyBar`：頁內跳轉（本站仿真題、自訂題目〔只有 /composition〕、歷屆試題）＋學測／指考／參考試卷篩選＋筆數。原本標題列右邊的跳轉連結在 lg 以上 `lg:hidden`（同一組連結不出現兩份）。
- P1：頁首、`StickyBar` 與卡片網格加 `lg:bleed`；網格維持 `sm:grid-cols-2`，wide 寬度加 `lg:@wide/main:grid-cols-3`；`InfoSection` 不加 `bleed`。
- P1：`KindFilter` 加 `lg:hover:border-primary lg:hover:bg-surface-2`。
- P2：歷屆部分在 lg 以上改成表格（中譯英：學年度＋考試、第 1 句、第 2 句、我的狀態；作文：學年度＋考試、題型、題目摘要、字數、段數、圖數、我的狀態），和 §5.6 共用 `WritingPromptTable`。

### 5.5 寫作 `/writing`（`features/writing/WritingHomePage.tsx`）

現況：「自訂題目」區的 `EntryCard` 用了 `h-full`，所在的 `section` 又是會被拉伸的 grid 項目，卡片高度等於整個 section，超出底部約 40 px、蓋到「兩種批改方式」卡片；**375 px 也重現**（實測）。寫作紀錄是 944 px 寬的列，題目在左、分數在最右，相距約 850 px（實測）。

ws 寬度起（P1）：

- `lg:bleed`＋`grid-cols-[minmax(0,1fr)_20rem]`。左欄：五個入口合成一個網格（`grid-cols-2`，wide 寬度 `grid-cols-3`），每張卡加小眉標（歷屆／本站仿真／自己的題目），取代三個小標題；下面是「我的寫作紀錄」表格。右欄（不 sticky）：AI 點數量表、「兩種批改方式」（`<details>`，預設收起）；未登入時放 `AiAccessNotice`。
- 這個新版面不再把卡片放進會被拉伸的 section，所以 ≥ lg 不會重疊。**手機上的重疊要不要一起修，見 §14 第 1 點**（修了 /writing 在 375 的截圖會變）。
- **寫作紀錄表格**（lg 起，`SubmissionHistory` 用 `useMediaQuery` 二選一）：題目（群組＋種類＋題目開頭；自訂題目第二行是自訂標題）、方式（打字／手寫）、狀態、更新時間、分數（`AiBadge compact`＋分數）。主要連結的內容與可存取名稱和現在的列相同（「自訂題目 英文作文」＋題目開頭，`writing-custom.spec.ts:327–331`）；外層仍是 `region「我的寫作紀錄」`，種類切換按鈕照舊。需要動作的列（待確認辨識文字、已確認未送出）在狀態欄放動作標章（不是第二個連結，目的地就是同一列）。「載入更多」改成表格底下的「再載入 20 筆」。種類切換維持現在兩個（不新增需要 API 支援的「全部」）。
- **`QuotaMeters`**（`AiAccessPanel.tsx` 新增，給首頁右欄、/writing 右欄、/ai/apply 用）：今日、本月、今日作文三個量表。資訊本體是文字（「今日 20／30 點」），旁邊的細條只是裝飾（`aria-hidden`，`<meter>` 各瀏覽器樣式不一、深色模式不好上色）；附重置時間。

### 5.6 寫作題目列表（`features/writing/TranslationListPage.tsx`、`EssayListPage.tsx`、`bank/BankListPage.tsx`）

現況：/writing/essay 6,947 px、/writing/translation 5,406 px；捲動後來源分頁、篩選與返回連結都不見；本站仿真列表的頁首佔約 440 px，第一個畫面只看得到 4 張卡（實測）。

- P1：返回連結、H1、`SourceTabs`、`KindFilter`（或難度分頁）在 lg 以上收成一列放進 `StickyBar`。
- P1：本站仿真列表的頁首在 lg 以上壓成兩列（左 H1＋來源分頁，右難度分頁）；AI 標章和說明併成一行。
- P1：頁首、`StickyBar`、網格加 `lg:bleed`；卡片 `lg:@wide/main:grid-cols-3`；本站仿真卡片右上角加只在 lg 顯示的狀態小點（未作答／草稿／已對照，資料來自 `bank/drafts.ts`；顏色之外加 `sr-only` 文字）。
- P2：歷屆列表改 `WritingPromptTable`（同 §5.4）。

### 5.7 歷屆試題 `/exams`（`pages/ExamsPage.tsx`、`features/exams/ExamList.tsx`）

現況：66 份考卷兩欄卡片，每張約 170 px，整頁 6,745 px；每張都重複「100 分鐘・53 題・滿分 100・附全國答對率」和 8 個大題標籤；作答進度是卡片裡的小字；篩選捲動後就不見（實測）。資料：66 份的滿分都是 100；時間只由考試種類決定（學測與學測參考試卷 100 分鐘、指考與指考參考試卷 80 分鐘）；題數在 53–66 之間（`public/data/exams/index.json` 實測）。

lg 起（P1）：

- `StickyBar`：考試膠囊（`KIND_FILTERS`）、學年度、「只看作答中」切換。篩選仍放在網址（`?kind=&year=`，新增 `?progress=active`）。
- **`DataTable`**（頁首、`StickyBar`、表格 `lg:bleed`）：考卷（「115 學測」＋新制、補考標章；可存取名稱和現在的卡片相同）、題數、全國答對率（有／無）、題型結構（精簡，例如「詞10 綜10 文10 篇4 閱12 混4 譯2 作1」，全文放 `title`）、我的進度（作答中 30／53 的進度條＋文字、已交卷 78／100）。**沒有「滿分」欄**（66 列都是 100）、**沒有「時間」欄**（放進分組標題，例如「學測・100 分鐘」）、**沒有「動作」欄**（「開始」和第一欄連到同一頁，每列只留一個連結；`exams.spec.ts:49–50` 要求 /指考/ 的連結只有 1 個）。依學測／指考／補考／參考試卷分組；學年度、題數與進度可排序。
- **篩選條件帶進作答頁**：`primaryLink` 回傳 `{ to: '/exams/:id', label, state: { listSearch: location.search } }`，和現在 `ExamCard` 的 `<Link state={{ listSearch }}>`（`ExamList.tsx:64`）相同；作答頁的「‹ 歷屆試題列表」（`ExamPaperPage.tsx:23–25、210`）照樣回到篩選過的列表。e2e 補一個「篩選 → 進入考卷 → 返回 → 篩選仍在」（§11.3）。
- 長副標（115學年度學科能力測驗英文考科）只放在列的 `title`，不重複顯示。
- 設定頁可以把列表改回卡片（§3.5）；預設表格。
- < lg 維持卡片。

### 5.8 模擬考 `/mock`（`pages/MockExamPage.tsx`、`features/mock/MockPaperList.tsx`）

現況：6 份卷別是兩欄大卡片，主要內容只有「未作答」和一顆大「開始」；看不到歷次成績；「考前節奏建議」與配分表排在卷別下面（實測）。

- P1：**列式卡片，不改成 `<table>`**。只有 6 份卷別，表格的好處不大，而 `mock.spec.ts:52–54、131` 依賴 `region「卷別」` 裡的 6 個 `article` 與 h3。lg 起每個 `article` 排成一列（`lg:grid lg:grid-cols-[minmax(0,12rem)_8rem_minmax(0,1fr)_minmax(0,10rem)_auto] lg:items-center`，每列同一個欄寬，看起來就是對齊的表格）：卷別（h3）＋級分對照年度、狀態（未作答／作答中 剩 mm:ss／已交卷 N 次，**沿用現在「已完成 1 次，最近一次 3 分、1 級分」的文字**）、最佳原始總分＋級分、最近一次日期、動作（開始或繼續、看成績單 `/mock/report/:attemptId`；兩個目的地不同，所以可以是兩個連結；「開始：115 學測模擬考」的名稱照舊，`mock.spec.ts:57`）。每個欄位的值都自帶短標籤（「最佳 78 分・12 級分」），不另外做表頭列。資料來自 `features/mock/storage.ts` 的 history 與 active 鍵。ref-115 的沿用題提醒改成狀態欄的小標章，全文放 `title`（`mock.spec.ts:55` 要找得到「沿用題提醒」的文字）。
- P1：ws 寬度 `lg:bleed`＋`grid-cols-[minmax(0,1fr)_20rem]`；右欄（不 sticky）：考前節奏建議（精簡）＋現行配分表。
- P2：wide 寬度加「我的級分趨勢」小折線圖（SVG，色票 `--chart-1`）。
- < lg 維持卡片。

### 5.9 單字 `/words`（`pages/WordsPage.tsx` → `features/vocab/VocabModule.tsx`）

現況：單字庫 944 px 兩欄卡片，每列約 84 px，一個畫面約 8 個字；篩選面板 290 px 高、捲動後不見；開單字卡（`?word=`）會換掉整個列表；四個分頁每段 230 px 寬（實測）。每日學習的單字卡在寬版下會變得更寬，一定要限寬。

- P1：四個分頁（`nav aria-label="單字功能"`）在 lg 以上 `lg:sticky lg:top-0 lg:z-10`（加 `StickyBar` 的背景樣式，並寫入 `--sticky-bar-h`）；單字庫的搜尋框跟著分頁一起 sticky。分頁列與單字庫加 `lg:bleed`。
- P1：單字庫在 ws 寬度 `grid-cols-[16rem_minmax(0,1fr)]`：左欄是直排的篩選（級別、詞性、CEFR、歷屆出現），右欄是結果。`LibraryView.tsx:185` 的根元素有多個子元素，所以在 lg 用 `useMediaQuery` 換成桌機樹（R4），桌機樹裡的分欄與否只靠 CSS；搜尋框在兩種排法共用同一個位置，不會因為寬度改變而重新掛載。
  - **篩選欄的 sticky 位置與高度**：`lg:@ws/main:sticky top-[calc(var(--sticky-bar-h,0px)+1rem)] max-h-[calc(100dvh-var(--sticky-bar-h,0px)-2rem)] overflow-y-auto`，加 `usePaneA11y('篩選')`。比視窗高時篩選欄自己捲，底部不會被切掉。
  - **「排序」移到結果上方的結果數那一列**（「共 3,006 筆・排序 ▾」），篩選欄約 450 px 放得下（設計值，在 1366×640 截圖確認）。下拉選單的可存取名稱不變。
  - 結果卡片 ws 寬度兩欄、wide 寬度三欄。
- P1：`WordChunk`（`LibraryView.tsx:124`）的 `contain-intrinsic-size` 加兩欄與三欄的估值（三欄約 `auto_700px`）；現在 1440 整頁圖最後一列和「顯示更多」之間有約 500 px 空白（實測）。
- P1：每日學習、測驗、錯題本與單字卡頁的主要卡片不加 `bleed`（維持 944），單字卡另加 `lg:mx-auto lg:max-w-4xl`、每日學習與測驗 `lg:max-w-3xl`；每日學習的設定說明加 `max-w-prose`。
- P1：`StudyView`、`QuizSession` 的 `isTypingTarget` 改用 `lib/hotkeys.ts` 的 `isFormControlTarget`（行為不變），並在 ≥ lg 加 `isModalOpen()` 檢查（§4.4）。
- P2：結果改成可切換的表格（單字、詞性、中文、級別、CEFR、歷屆次數；點表頭排序），偏好存 `gsat-ui:v1:list-view:words`。
- P2：wide 寬度時 `?word=` 的單字卡顯示在右側窄欄（`w-[28rem]`、sticky、自己捲動，top 與 max-h 同篩選欄），列表不換掉；Esc 關閉、焦點回到該列。
- P2：/ 聚焦搜尋、N／P 移動目前列、Enter 開卡、S 發音（§8）。

### 5.10 設定 `/settings`（`pages/SettingsPage.tsx`）

- P1：窄版寬度＋頁尾貼底（§3.1）。
- P1：只在 lg 以上顯示的「電腦版介面」區塊（`hidden lg:block`）：側邊欄（自動〔作答與寫作頁寬度不夠時收合〕／一律展開／一律收合；觸控為主的裝置不顯示收合選項）、單鍵快捷鍵（開／關，附說明「使用螢幕閱讀器或語音輸入時建議關閉」）、歷屆試題列表（表格／卡片）、「查看全部快捷鍵」按鈕。說明「只影響這台裝置的這個瀏覽器」。

### 5.11 關於、隱私權說明、服務條款（`pages/AboutPage.tsx`、`features/account/PolicyPage.tsx`、`PolicyView.tsx`）

現況：段落 900 px 寬，中文約 56–60 字一行；/about 的 11 個資料來源是 2,152 px 的單欄清單；/privacy 2,951 px、條文沒有目錄，h3 也沒有 id（實測）。

- P1：窄版寬度；內文 `max-w-prose`。
- P1：`PolicyView` 的 h3 加 id（`s-1`、`s-2`…，全寬度加，不影響像素，R6），可以直接連到某一條。
- P2：ws 寬度起 `grid-cols-[minmax(0,1fr)_14rem]`，右欄是 sticky 的頁內目錄（`top-4`、`max-h-[calc(100dvh-2rem)] overflow-y-auto`；`IntersectionObserver` 標出目前段落，`aria-current="location"`）。

### 5.12 帳號 `/account`、`/account/welcome`、`/ai/apply`（`features/account/*`）

- P1：窄版寬度；`styles.ts` 的 `fieldCls`（`w-full`）加 `lg:max-w-md`（暱稱欄位現在 894 px 寬）；年齡區間 radio 加 `lg:max-w-md lg:grid-cols-2`。
- P2：`/account` 在 lg 起 `lg:grid-cols-[12rem_minmax(0,1fr)]`，左欄 sticky 的頁內導覽（帳號資料、AI 批改、登入裝置、匯出資料、刪除帳號）。
- P2：`/account/welcome` 在 ws 寬度起左欄兩份政策摘要、右欄 sticky 的表單卡（年齡、暱稱、兩個同意、送出；`max-h` 加自己捲動），「同意並繼續」一直看得到（現在要捲到 1,461 px 的底部（實測））；側邊欄導覽 `inert` 見 §3.2（P1）。
- P2：`/ai/apply` 在 lg 起 `lg:grid-cols-2`：左邊目前狀態＋`QuotaMeters`，右邊說明＋點數規則（表格 `lg:max-w-md`）。

### 5.13 後台 `/admin`（`features/admin/*`）

P2（只有站主用；不影響學生）：使用者改 `DataTable`（暱稱＋email、年齡區間、額度等級、申請次數、申請時間、最後活動、申請說明〔`line-clamp-2`，仍標「使用者填寫，未經查證」〕、核准／候補／拒絕）；設定檢查的機密列表改 `lg:grid-cols-2` 的 dl；分頁膠囊放進 `StickyBar`。P1 只有 `lg:hover`（寬度維持 944）。

### 5.14 404（`pages/NotFoundPage.tsx`）

- P1：頁尾貼底（一般寬度，§2.3）。
- P2：lg 以上加常用頁面連結（單字、題庫練習、歷屆試題、模擬考、寫作練習）。

## 6. 寫作工作區

### 6.1 共通

現況（實測）：所有寫作頁都是一欄、上限 `max-w-5xl`。1280 以上作文作答框 902 px、約 117 個英文字元一行；作答框頂端在 y=881（1280–1920）／933（1024），本站仿真作文 1,470、自訂題目 1,421，**每種桌機尺寸都在第一個畫面以下**；開始打字後題目、圖與分段要求就被捲走。作答框固定 16 行（453 px）。打開自我檢核後頁面從 1,893 長到 2,939 px（1440），檢核清單和作文永遠不會同時出現。作答框以外的東西（作答方式切換、標籤、字數、隱私與草稿說明、送出按鈕、`AiNotice`、點數、清除重寫）在 900 px 寬時約 410 px 高（估計），所以第 1 版「作答框 `calc(100dvh-20rem)`、整頁只有作答框在捲」不成立，本版改掉。

≥ lg 的共同結構（每個作答頁都是 `isDesktop ? <Workspace …/> : 原本的 JSX`，R4；ws 寬度分欄、不到就堆疊，§4.5）：

```
頁首（一行）：‹ 寫作練習　115 學測 英文作文［補考］　　（跳到題目／跳到作答區：sr-only）
┌ 左 Pane「題目」───────────────────┐┌ 右 Pane「作答區」（fill）──────────────────────┐
│ 任務＋要求摘要（固定，§6.2）         ││ [打字｜拍照]                                    │
│ [題目｜自我檢核與自評｜…] 分頁列     ││ ┌ 作答框（flex-1，填滿剩下的高度）──────────┐ │
│ ┌ 分頁面板（各自捲動、各自記位置）┐ ││ │                                              │ │
│ │                                  │ ││ └──────────────────────────────────────────────┘ │
│ └──────────────────────────────────┘ ││ 124 個單詞（至少 120）▇▇▇・2／2 段・已自動儲存 10:42 │
│                                      ││ [自我檢核與自評（不用 AI）]   [送出 AI 批改（7 點）] │
│                                      ││ [AI] AI 評分僅供參考，不是正式考試的評分。・今日剩 20 點・[⋯] │
└──────────────────────────────────────┘└──────────────────────────────────────────────────┘
（頁面本身只多出頁尾的高度）
```

- **高度預算（設計值）**：工作區 grid 在 1280×600 約 512 px、1366×640 約 552 px（§4.5）。右欄內距 2×16，作答方式切換 36、狀態列 28、動作列 44、提醒列 20，加上間距約 152 px；作答框約 328 px（1280×600，約 10 行）、368 px（1366×640，約 11 行），`min-h-[10rem]`。**作答框頂端與送出按鈕在 1280×600 同時在視窗內**（e2e 驗，§11.3）。錯誤訊息出現時作答框跟著縮；再放不下時右欄自己捲。
- **作答框**：`flex-1 min-h-[10rem] resize-none`、`text-[1.0625rem] leading-8`、`max-w-[72ch]`；ws 門檻時約 404 px 寬（約 47 字元），1366 約 479、1440 約 516（約 55–60 字元）（設計值）。堆疊時（lg、不到 ws）維持單欄，加 `min-h-[28rem]` 與支援時的 `field-sizing: content`。
- **作答框以外壓成三行**：狀態列（§6.5）；動作列（自我檢核按鈕、送出按鈕，按鈕上寫點數）；提醒列（`text-xs text-muted`）：`AiNotice` 的單行版、剩餘點數、「⋯」次要動作（展開按鈕＋清單，不用 `role="menu"`；裡面是「清除重寫」與「立刻儲存（Ctrl＋S）」）。隱私與草稿說明併進狀態列的「已自動儲存在這台裝置」，完整說明放在「⋯」裡。ws 門檻的寬度下提醒列可能折成兩行（+16 px）。
- **`AiNotice` 單行版**：沿用既有的 `generic` 文字「你正在和 AI 互動：AI 評分僅供參考，不是正式考試的評分。」（已存在的字串，不是新文案，也不含「大考中心」），樣式改成 `compact`（不加框、`text-xs`）。e2e 找的「你正在和 AI 互動」照樣找得到。
- **自我檢核的位置規則**（作文與中譯英一致）：**一律放在沒有作答框的那一欄**，讓檢核和自己的作答同時看得到。作文的那一欄同時是題目欄，所以上方固定一條「任務＋要求」摘要，切到自我檢核分頁時仍看得到題目要求；中譯英的題目和作答在同一欄，檢核在右欄。
- **送出確認**見 §6.5。
- **D8**：任何「對照」只用 AI 參考改寫或本站撰寫的範文、參考譯文；不出現官方參考譯文、評分原則原文、佳作。新的桌機文字不提「大考中心」。

### 6.2 作文作答頁

| 頁面 | 左欄：固定摘要＋分頁 | 右欄 | wide 寬度 |
|---|---|---|---|
| 歷屆 `/writing/essay/:examId`（`EssayAttemptPage.tsx`） | 摘要：字數要求、段數、分段要求（一段一句，`line-clamp-2`，按一下展開全文）。分頁：題目（`EssayPromptView`：說明、圖片描述、分段要求、字數要求）｜自我檢核與自評（`EssaySelfAssess` 的 `compact` 版） | 作答方式、作答框或拍照區、狀態列、動作列（含「自我檢核與自評（不用 AI）」按鈕）、提醒列 | P2：第三欄 20rem 常駐自我檢核 |
| 本站仿真 `/writing/essay/ai/:code`（`bank/BankEssayAttemptPage.tsx`） | 摘要：「題目要你寫什麼」＋字數與段數。分頁：題目（`BankFigure`＋說明）｜鷹架（`BankScaffold`）｜提示（`BankHints`）；按「寫好了，看評分規準與範文」後多一個「評分規準與範文」分頁並自動切過去（`EssayReveal`＋自評） | 同左；對照後作答框唯讀 | P2：範文與自己的作文兩欄並排 |
| 自訂題目 `/writing/essay/custom`（`custom/CustomEssayAttemptPage.tsx`） | 題目設定好之後：摘要用學生設定的字數與段數。分頁：題目（**永遠顯示完整的 `CustomPromptView`**，不管 `draft.promptCollapsed`，那是手機用的收合）｜自我檢核與自評｜評分規準摘要（本站撰寫） | 同左；目標字數、段數用學生設定的值 | — |

- **三種作文頁的摘要格式相同**（第 1 版只有本站仿真釘住「題目要你寫什麼」，另外兩頁沒有）。摘要不重複整段題目，只放檢核時最常要對照的要求。
- **動作列的「自我檢核與自評（不用 AI）」按鈕**沿用手機版同名按鈕的名稱與行為：切到左欄的「自我檢核與自評」分頁，把焦點移到該分頁的標題（分頁面板沿用 `id="custom-essay-self"`／`id="essay-self"`）。分頁列上也點得到同一個分頁。`writing-custom.spec.ts:140–142、183–184` 不用改（§10.5）。
- **自訂題目在題目還沒設定好、或按了「修改題目」時不分欄**（`split="off"`）：以單欄顯示 `CustomPromptForm`（`max-w-3xl` 置中，1,000 字元的題目框、圖片描述框、段數膠囊、字數欄位都有足夠的寬度），下面的內容順序和手機相同。按「題目設定好了」之後才切成「題目在左、作答在右」。這是同一棵樹的 CSS 切換，作答框不會重新掛載，寫到一半的作文與游標都還在。
- 狀態列依目前游標所在的段落，標出摘要裡對應的分段要求（P2）。
- 本站仿真的圖：左欄在 1366 約 511 px，圖原本的 `max-w-[32rem]` 放得下；放大改用對話框（P2），不用現在 200% 寬的水平捲動。
- 自訂題目：題目提到「分兩段」而要求沒設時（`pendingRequirements`），在左欄頂端立刻提示「題目提到分 2 段，要設成 2 段嗎？［設成 2 段］［題目沒有規定］」（P2）；手機維持送出時才確認。
- `focusOn(id)`＋`scrollIntoView({ block: 'center' })`（自訂題目的欄位錯誤）改用 `scrollAndFocus`，確認焦點能跨到左欄的欄位。

### 6.3 中譯英作答頁（`TranslationAttemptPage.tsx`、`bank/BankTranslationAttemptPage.tsx`）

中譯英的題目是一句一句的，題目短：`Workspace layout="sentences-rail"`。

- **主欄 Pane「題目與作答」**：每一句由上而下是中文題目（`text-lg`，一到兩行）→ 英文作答框（主欄全寬；支援 `field-sizing: content` 時最少 3 行、最多 8 行，超過才在框內捲動；不支援時維持現在的列數並可拉高）→ 大寫與標點提醒、字元數（97／500）→ 本站仿真的提示（`BankHints`）。第 1 版的「中文在左、英文在右」作廢：英文框只剩 340 px、最多 3 行，常見的 120–200 字元答案看不完整。
- **右欄 Pane（22rem）**：
  - 上方可捲動區：「自我檢核（不用 AI）」按鈕（沿用手機版的名稱與行為：展開右欄的檢核、焦點移到「自我檢核」標題；容器沿用 `id="t-self-check"`，`writing.spec.ts:143–147`、`account.spec.ts:40` 不用改）→ 精簡版檢核（程式幫你找到的問題、檢核清單**每項只列標題與勾選框，說明與例句收進每項的展開區**、每句錯誤數加減鈕、即時自評分）。
  - 底部固定：`AttemptActions` 精簡版（送出按鈕含點數、一行 AI 提醒、剩餘點數、「⋯」）。檢核清單再長，送出按鈕都在視窗內。
- 1366×640：兩句的作答框（各 3 行）與送出按鈕同時在視窗內（設計值，e2e 驗）。
- 本站仿真按「寫好了，對照參考譯文」後，本站參考譯文顯示在該句、學生作答下方（本站撰寫，不是官方譯文）；`TranslationReveal` 的 4 部分評分規準放在右欄的捲動區。
- 堆疊時（不到 ws）：右欄排在主欄下面，順序同手機。

### 6.4 拍照上傳

- P1：照片隱私說明「照片先在你的手機上縮小…」在 lg 以上改用 `hidden lg:inline` 的另一句「照片先在這台裝置上縮小…」（手機文字與像素不變）。
- P1：分欄時拍照區在右欄（取代作答框的 `flex-1` 位置，內容多時右欄自己捲），題目留在左欄，送出辨識（扣點）前可以對照題目檢查手寫稿。
- P2：`PhotoDropZone`（lg 起取代「拍照」「從相簿選擇」兩顆按鈕，`lg:hidden` 舊按鈕）：虛線框「把手寫稿照片拖到這裡，或按一下選擇檔案（最多 2 張）」，`role="button"`、可用鍵盤啟動，也接受 Ctrl／⌘＋V 貼上圖片；都送進 `PhotoPicker` 現有的 `addFiles()`。桌機上「拍照」（`capture=environment`）和「從相簿選擇」開的是同一個檔案對話框（實測）。
- P2：縮圖上的「往前／往後」按鈕取代單一「對調順序」。

### 6.5 `EditorStatusBar` 與 `AttemptActions`

`features/writing/components/EditorStatusBar.tsx`（≥ lg 取代作答框下方的 `#essay-count`；兩者不同時存在，避免兩個 `aria-live`）：

```ts
interface EditorStatusBarProps {
  text: string;
  target: { minWords: number; maxWords: number; maxChars: number; paragraphs: number | null };
  saveState: { kind: 'saved'; at: number } | { kind: 'unavailable' };
}
```

- 顯示：單詞數放在自己的 `<span>`（「124 個單詞」，`writing-custom.spec.ts:136` 的 `/^\d+ 個單詞$/` 照樣找得到）＋另一個 span「（至少 120）」＋細進度條（`aria-hidden`）、「2／2 段」、各段字數（第 1 段 52・第 2 段 72；右欄夠寬時才顯示，`lg:@md:inline`）、「已自動儲存在這台裝置 10:42」或「無法儲存（可能是無痕模式）」。計算沿用 `features/writing/lib/text.ts` 的 `checkEssayLength`，規則不變。
- **顏色用既有 token，文字一定說清楚**：未滿 100 個單詞 `text-muted`＋「還差 N 個」；100–119 `text-badge-fg`（接近）；120–600 `text-ok`；超過 600 單詞或 4,000 字元 `text-bad`＋「超過上限」。兩種主題下文字對比都要 ≥ 4.5:1（§11.5 驗）。
- `aria-live="polite"` 只播報段數改變、跨過門檻與無法儲存，不逐字播報。
- 儲存時間：草稿格式不改；存檔成功時在元件狀態記下時間。
- 不 sticky：它在右欄的固定區，本來就一直看得到。

`features/writing/components/AttemptActions.tsx`：五個作答頁與「已確認待送出」狀態共用的送出區，只在桌機樹裡用（手機分支保留原本的 JSX，R4）。內容：主要按鈕「送出 AI 批改（n 點）」（`aria-keyshortcuts="Control+Enter"`，空間夠時旁邊顯示 `Kbd`）、`AiNotice` 單行版、剩餘點數（`QuotaSummary compact`，一行；未取得權限時換成 `AiAccessNotice` 的精簡版，「AI 批改即將開放。」等文字照舊）、錯誤訊息、「⋯」裡的「清除重寫」。

**送出確認**：

- Ctrl／⌘＋Enter 把動作列換成確認列：「送出 AI 批改（7 點）？［取消］［確定送出］」，`role="group"`、`aria-labelledby` 指向問句。**初始焦點在「取消」**。
- **按住或連按都不會送出**：所有快捷鍵忽略 `e.repeat`（§4.4）；確認列開著時再按 Ctrl＋Enter 不做任何事。就算按住 Ctrl＋Enter，自動重複的按鍵也只會落在「取消」上。
- **不註冊任何自訂的 Enter 處理**：Enter 和空白鍵只靠按鈕原生的行為——焦點在「取消」按 Enter 就是取消，Tab 到「確定送出」再按才送出。第 1 版「焦點移到確定送出、Enter＝確認」作廢（和 §4.4「Enter 不註冊」矛盾，按住 Ctrl＋Enter 也會直接扣點）。
- Esc 或「取消」：收起確認列，焦點還給作答框。
- 用滑鼠或 Tab 到主要按鈕再按，行為和現在一樣（直接送出，按鈕上已寫明點數）；多一步確認只針對快捷鍵，因為在作答框裡順手按到的機會比點按鈕大得多。

### 6.6 批改結果 `/writing/submissions/:id`（`SubmissionResultPage.tsx`、`components/EssayResult.tsx`、`HighlightedText.tsx`、`TranslationResult.tsx`）

現況（實測）：學生的作文預設看不到——`HighlightedText` 在最底下收合的「標出的錯誤（8）」裡，展開後在 y≈1,790（1440）；點錯誤上標（`<a href="#e-err-n">`）整頁跳到錯誤卡片，卡片沒有標示、作文被捲走、卡片也連不回原文；作文與 AI 參考改寫上下排列，無法並排對照。

**作文（含自訂題目）ws 寬度起 `ResultWorkspace`（P1）**：

- 左欄（`Workspace layout="result"`，約 7fr，region「你的作文」）：PaneTabs：你的作文｜參考改寫（AI）｜題目（自訂題目在這裡放「你提供的題目」）。
  - 「你的作文」：`HighlightedText` 直接展開（不放在 `<details>` 裡；< lg 照舊），≤ 72ch、`text-[1.0625rem] leading-8`。
  - 「參考改寫（AI）」：**逐段和原文交錯**——第 1 段原文（`text-muted`、不加錯誤標記）、第 1 段改寫、第 2 段原文、第 2 段改寫……，段落依 `HighlightedText` 的分段。兩邊段數不同時改成先列原文全文、再列改寫全文，並寫明「改寫的段落和原文不一一對應」。不需要第三欄，1280–1535 也能對照。
  - P2：逐段建議放在對應段落下方的提示框；wide 寬度的「對照」分頁兩欄並排原文與 AI 參考改寫。
- 右欄（約 5fr，自己捲動）：總分卡（總分、級距、四項分數與自評差距；自訂題目的離題提醒放在這裡）、先改這三個就好、錯誤清單（篩選膠囊）、各項說明、評分者表（精簡）、本次扣點與剩餘點數、再練一次／修改題目後重新批改／刪除。`AiBadge` 依 SPEC §8.4 照樣出現，右欄用 `compact` 版。
- **雙向連動**（`features/writing/lib/useSelectedError.ts`）：
  - 點左欄的錯誤標記或上標數字：ws 寬度起攔截錨點（`preventDefault`；不到 ws 與 < lg 保留原本的 `#e-err-n` 跳轉）→ 選取第 n 個錯誤 → 右欄卡片 `aria-current="true"`＋outline（§4.11）→ `scrollAndFocus` 到卡片（`tabIndex={-1}`）。
  - 點右欄卡片裡的「在作文中標出」：**左欄不在「你的作文」分頁時先切回去**（標記在隱藏的面板裡時捲動與外框都看不到），再用 `scrollIntoPane` 捲到那個標記並加外框（`prefers-reduced-motion` 時不閃爍）。
  - 焦點在錯誤清單時，N／P 上下一個錯誤（§8）。
  - P2：滑鼠移到卡片時標出原文；篩選膠囊改成「淡化」其他標記而不是拿掉。

**中譯英結果（P2）**：每句一個兩欄區塊——左邊中文題目＋你的譯文（標記）＋AI 修正版對齊在正下方，右邊該句的錯誤卡片（同樣的雙向連動）；頂端的總分、評分者表、扣點改成 2–3 欄。只顯示 AI 修正版，不顯示官方參考譯文（D8）。保留 `region「第 1 句」` 等名稱（`writing.spec.ts:225–238`）。

### 6.7 其他結果狀態

- 批改中／排隊中（`Pending`）：P1 只受頁尾貼底影響（1920×1080 時內容在 y≈400 結束，頁尾浮在中間（實測））；P2 在 ws 寬度起用 `ResultWorkspace` 的骨架：左欄唯讀顯示送出的作文（`body.text`），右欄進度卡＋分數骨架。
- 待確認辨識文字（`OcrConfirm.tsx`，P2）：ws 寬度起左欄是精簡的逐行編輯（行號、單行輸入框、看不清楚的行上色並在行尾放候選字、空行畫成「段落分隔」），右欄的即時預覽（看不清楚的地方可點，跳到那一行）＋計數（單詞、段數對要求、還有幾個看不清楚＋「下一個看不清楚的地方」）＋說明＋確認／還原。現在每一行約 110 px，150 字的作文約 2,800 px（實測）。在單行輸入框按 Enter 跳下一行（輸入框自己的行為，不是全域快捷鍵）。
- 已確認待送出（P2）：ws 寬度起左欄唯讀的作文、右欄精簡的自我檢核＋`AttemptActions`。

## 7. 作答頁

適用：題庫練習 `/practice/:section/:tier`、六個題型頁的作答區（同一個 `GroupSession`）、歷屆 `/exams/:examId`、模擬考 `/mock/:paperId`、成績單的檢討試卷。

現況（實測）：內容固定 944 px；閱讀、混合題已經 `lg:grid-cols-2` 並排，但每欄只有 460 px（1024 時 332 px）；綜合測驗選文 902 px 寬、五張題目卡在下面，空格到題目卡的距離 454–1,234 px（交卷後最遠 4,434）；選文面板 `lg:top-24`，題組結束時頂端滑到工具列底下；只有工具列是 sticky（歷屆 49 px、模擬考 53 px 高），歷屆的大題導覽、模擬考的大題導覽與題號面板都會捲走，題號面板展開會把試卷往下推約 600 px；歷屆整份 53–66 題一頁，16,000–18,300 px；作答頁沒有任何快捷鍵。考卷有 5–8 個大題，最大的大題有 12–20 題（`index.json` 實測）。

### 7.1 工具列第二列：題號列（固定一行）

`ExamToolbar` 與 `MockToolbar` 加一個 `desktopRow?: ReactNode`，呼叫端只在 `useIsDesktop()` 時傳入；工具列裡 `{desktopRow && <div className="mt-2 flex h-9 flex-nowrap items-center gap-3">…</div>}`——手機沒有傳，DOM 完全相同。新元件 `features/exams/components/SessionNavRow.tsx`：

```
[1▁ 2▁ (3 文意選填)▁ 4▁ 5▁ 6▁ 7▁ 8▁]  [本大題：21✓ 22✓ 23 24⚑ 25 …（放不下時水平捲動）]  第 23 題  [全部題號 ▾]  [?]
```

**寬度預算**（設計值；工具列內寬：1024 展開 704、1024 收合或 ws 門檻 896、1280 展開 960、1366 展開 1046、1440 展開 1120、1536 展開 1216）：

| 項目 | 寬度 | 說明 |
|---|---|---|
| 大題膠囊（8 個大題） | 約 350 | 非目前大題 32 px（編號＋下方 3 px 進度條）；目前大題約 96 px（編號＋名稱） |
| 本大題題號格 | 剩下的寬度（`min-w-0 flex-1`） | 28 px 方格、間距 4；放不下時水平捲動 |
| 「第 23 題」 | 約 64 | 目前題 |
| 全部題號 ▾ | 約 96 | |
| ? 按鈕 | 32 | 可存取名稱「鍵盤快捷鍵」 |
| 間距 | 約 48 | |

- 固定的部分合計約 590 px，題號格在 1024 展開時沒有空間（自動隱藏，只剩「全部題號」）、ws 門檻約 9 格、1280 約 11 格、1366 約 14 格、1440 約 16 格、1536 約 19 格。整條工具列＝第一列 49／53（實測）＋8＋36，**約 93–97 px，任何寬度都 ≤ 100**（e2e 在 1024×600、1280×600、1366×640 驗，§11.3）。第 1 版「約 95 px、只有 1024 才兩行」的估計不對：完整的大題名稱、題號格、提示文字合計約 1,400–1,600 px，到 1536 都會折成兩行。
- **大題膠囊**：`<nav aria-label="大題導覽">`，按鈕的可存取名稱用 `aria-label` 沿用現在 `SectionNavigator` 的完整名稱（「3. 文意選填，已答 0／10 題」「…，標記 1 題」），目前大題 `aria-current="step"`；看得到的文字（「3」或「3 文意選填」）是名稱的開頭，語音輸入說「按 3」也點得到。完整名稱與進度在滑鼠移入或聚焦時用提示泡泡顯示（同 §3.2）。`mock.spec.ts:84、95–98、105、146、152` 不用改。模擬考切換大題（沿用 `goSection`）；歷屆試題捲到該大題，目前大題由 `IntersectionObserver` 看大題標題決定（scroll-spy）。
- **本大題題號格**：`QuestionGrid` 的精簡版。外層 `lg:@container/qgrid min-w-0 flex-1 overflow-x-auto`（`scroll-snap-type: x`），寬度不到 16rem 時整個隱藏（`lg:@max-[16rem]/qgrid:hidden`，題號改由「全部題號」提供）；目前題改變時用水平的 `scrollIntoPane` 讓它留在看得到的範圍。可存取名稱「第 3 題，已作答，已標記」；已答＝底色＋勾號、未答＝空心框、標記＝旗子圖示（§4.11）；交卷後加「答對／答錯／未作答」（顏色＋圖示＋文字）；目前題 `aria-current="true"`。點了捲到那一題並設成目前題。
- **「第 23 題」**：純文字，顯示目前題；目前題是 null 時顯示「—」。播報另由 live region 負責（§7.3）。
- **全部題號**：按鈕展開下拉面板（`absolute`，不推動試卷；`max-h-[min(60dvh,28rem)]` 自己捲動；`border border-line bg-surface shadow-lg`；Esc 關閉、焦點回按鈕）。模擬考的內容就是現在 `QuestionPalette` 的面板（含「前往／標記」切換）；歷屆試題是全部題號。
- **列上不放按鍵提示文字**（第 1 版的「N／P 換題・A–D 作答・? 全部快捷鍵」約 230 px）：改由 ? 按鈕與 `ShortcutHelp` 說明。
- 題庫練習與題型頁只有一個題組（4–10 題）：題號列只有題號格、「第 N 題」與 ? 按鈕。
- 舊的 `SectionNavigator`、`QuestionPalette`（模擬考）與 `SectionNav`（歷屆）在 ≥ lg 加 `lg:hidden`：display:none 不在無障礙樹裡，同名的導覽只會有一份。
- **`QuestionGrid`**（`features/exams/components/QuestionGrid.tsx`）從 `mock/components/SectionNavigator.tsx:59–146` 抽出，不再依賴 `MockSessionContext`：props `sections`、`isAnswered(label)`、`isFlagged?(label)`、`resultOf?(label)`、`currentSectionId?`、`currentLabel?`、`onSelect(label)`、`size: 'palette' | 'compact'`。`QuestionPalette` 改用它時 class 一字不改（手機的題號面板要逐像素相同；基準要先補截題號面板展開的兩種模式，§11.1）。`paperIndex` 從 `features/mock/` 移到 `features/exams/`（模擬考改從新位置匯入）。
- 工具列高度用 `useStickyHeightVar(ref, '--session-bar-h')` 寫進 CSS 變數，給選文面板的 `top`／`max-h` 與 `html` 的 scroll-padding；模擬考的 `stickyToolbarBottom()` 量的是整個工具列，含第二列，邏輯不用改，只搬到 `features/exams/navigation.ts` 和歷屆共用。
- 題目卡（`Questions.tsx:27` 的 `cardClass`）與大題標題（`Paper.tsx:115`）的 `scroll-mt-32` 在 lg 改成 `lg:scroll-mt-2`，由 `html` 的 scroll-padding 扣掉工具列（§3.4）；用錨點、焦點或 `scrollIntoView` 捲到的題目不會被工具列蓋住。

### 7.2 分割作答

| 題組（`groupLayout`） | 現在（lg） | lg（main < 60rem） | ws（main ≥ 60rem） | wide（main ≥ 80rem） |
|---|---|---|---|---|
| standard（閱讀、混合、簡答） | `lg:grid-cols-2` | 不變 | `[minmax(0,1.1fr)_minmax(0,1fr)]`：ws 門檻約 457／415、1280 約 490／446、1366 約 535／487、1440 約 574／522 px（設計值） | `[minmax(0,42rem)_minmax(0,40rem)] justify-center` |
| cloze（綜合測驗） | 選文在上、題目卡在下 | **左右分割**，和閱讀同一個門檻（lg）：`grid-cols-2` | 同 standard | 同 standard |
| bank（文意選填、篇章結構） | `lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]` | 不變 | 選項欄 `24rem`（篇章結構 `26rem`，每句兩行內） | 選文欄上限 42rem |
| 沒有選文（詞彙題） | 一欄 | 一欄 | 一欄，題目卡 `max-w-3xl`；短選項一列四個 | 同 ws |

- **同一份考卷不混用兩種排法**：第 1 版綜合測驗到 xl 才分割、閱讀在 lg 就並排，1024–1279 會看到同一份考卷有的並排、有的上下疊。本版所有有選文的題組都從 lg 並排，欄寬比例再依 main 的寬度放大。
- **選文面板的位置**改依工具列實際高度：`lg:top-[calc(var(--session-bar-h,3.5rem)+1rem)] lg:max-h-[calc(100dvh-var(--session-bar-h,3.5rem)-2rem)]`，取代 `lg:top-24 lg:max-h-[calc(100dvh-7rem)]`（`Paper.tsx:82`、`BlankGroups.tsx:546`）。黏住時不會滑到工具列底下；題組結束時跟著題組捲走是 sticky 的正常行為。1366×640 時選文面板約 510 px 高（設計值）。
- **綜合測驗的分割用 CSS grid 放置，不依賴子元素的數量或順序**：`ClozeGroup` 的右側子元素在不同模式下是 3 或 4 個（`RevealButton` 在考試模式、模擬考與交卷後回傳 null，`Questions.tsx:70–75`）。根元素加 `lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0 lg:grid-rows-[repeat(4,auto)_1fr]`（`space-y-4` 的 margin 在 grid 裡會疊到列距上，所以歸零）；選文 `lg:col-start-1 lg:row-start-1 lg:row-span-5 lg:self-start`＋sticky 與 `usePaneA11y`；右側每個子元素各自 `lg:col-start-2`，少一個時多出來的是空列。練習、考試、交卷後三種狀態都要截桌機圖。
- **空格的行內選項面板（`ClozePanel`、`BankPanel`）這一版保留**：它是 `role="group" aria-label="第 N 題的選項"`，`exams.spec.ts:72–77`、`mock.spec.ts:80–86`、`practice.spec.ts:115` 在 1280 都靠它作答。不開行內面板、改用右欄作答的設計延後（§9）。
- **選項排列改依卡片寬度**（`Questions.tsx:143`）：`grid-cols-1 sm:grid-cols-2` 改成 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 lg:@md:grid-cols-2`，卡片加 `lg:@container`（R5）。1024 時 332 px 的題目欄不再硬切兩欄（現在「(A) 6 percent.」會折成兩行（實測））。
- **詞彙題維持一欄**（第 1 版的 `xl:grid-cols-2` 作廢：DOM 順序 1、2、3 會變成 Z 字形，和紙本、電腦化測驗由上往下的順序不同，卡片高度不同時還會有空白）：題目卡限 `lg:max-w-3xl`；選項都很短時（每個 ≤ 24 個字元，元件算出後在選項格加 `data-short`）用 `lg:@2xl:data-short:grid-cols-4` 一列四個，每題高度減少（P1，第 1 版是 P2）。
- 翻譯與作文大題（歷屆、模擬考裡的 `CompositionBlock`、`TextAnswerBlock multiline`）：P2，ws 寬度起題目與圖在左、作答框在右（同 §6 的 `prompt-editor`）。

### 7.3 目前題與連動

新增 `features/exams/CurrentQuestion.ts`：外部 store（和 `useAttemptSelector` 同一種做法），由 `GroupSession`、`ExamPaper`、`MockSessionPage` 建立。

```ts
interface CurrentQuestionStore { get(): string | null; set(label: string | null, source: 'focus' | 'pointer' | 'grid' | 'key' | 'auto'): void; subscribe(fn: () => void): () => void; }
export function useIsCurrent(label: string): boolean;     // 只有新、舊兩張目前題會重繪
export function useCurrentLabel(): string | null;        // 題號列的「第 N 題」用
export function useVisibleCards(): { isVisible(label: string): boolean; firstVisible(): string | null };
```

- **設成目前題**：焦點進入題目卡（卡片加 `onFocusCapture`）、**在卡片上按下滑鼠或觸控**（`onPointerDownCapture`；macOS 的 Safari 與 Firefox 點按鈕、radio、checkbox 時不會給焦點，只靠 focus 會漏掉）、點空格（`ClozeSlot`／`BankSlot`）、點題號列、N／P。
- **看得到才算數**：一個 `IntersectionObserver` 觀察所有題目卡（root 是視窗，上緣扣掉 `--session-bar-h`；工具列高度改變時重建 observer），記下目前在可見範圍內的卡片。目前題的卡片完全離開可見範圍時，把目前題設回 null（題號列顯示「—」，卡片外框消失）。不在捲動時自動把目前題換成別題，避免捲動中外框一直跳。
- **樣式**：題目卡與空格都設 `data-current`（只有目前題才有這個屬性），樣式 `lg:data-current:outline-2 lg:data-current:outline-offset-2 lg:data-current:outline-primary`（R6、§4.11）；綜合測驗原本的 `highlighted` 外框（全寬度）不變。
- **回饋**：每次用按鍵作答或標記後，題號格閃一下（`prefers-reduced-motion` 時改成靜態外框），並用一個 `aria-live="polite"` 的 `sr-only` 元素播報「第 35 題選 (C)」「第 35 題已標記」「第 35 題取消標記」。目前題因為按鍵而改變時播報「目前題：第 36 題」。
- 綜合測驗：點空格 N → 右欄的第 N 題捲到看得見（window 捲動，scroll-padding 已扣掉工具列）；題目卡 N 取得焦點 → 左欄選文用 `scrollIntoPane` 捲到空格 N。
- 文意選填、篇章結構：目前空格就是 `BankGroup` 現有的作用中空格；鍵盤 A–J 填入作用中空格後自動跳下一格（沿用 `pickFromBank` 的行為）。
- 效能：歷屆考卷是 53–66 張題目卡加選文的單頁；store 讓目前題改變時只重繪兩張卡，不是整份試卷（§11.6 量連按 N 十次的長任務）。
- P2：`RichText.tsx:62` 的 `refers_to` 標記加 `data-refers-label`（證據標記已有 `data-evidence-label`），目前題改變時在選文裡標出它問的片語並捲過去；選文面板頂端加「文章｜圖表｜表格」（多文本「文本 A／B」）的段落膠囊，題幹提到圖表或 `figure.question_no` 相符時自動捲到圖（現在圖表在面板裡約 1,005 px 深處，問「According to the chart…」時看不到圖（實測））；混合題的「全部／A–H」分頁放在面板的捲動區外面。

### 7.4 鍵盤（作答頁）

`features/exams/useSessionHotkeys.ts`，在 `GroupSession`、`ExamPaperPage` 的作答中、`MockSessionPage` 註冊；交卷後只保留 N／P。細節見 §8。

- **字母與數字作答的條件**：目前題不是 null、目前題的卡片在可見範圍內、而且目前題有這個選項字母（例如文意選填的 H、J 是選項，詞彙題的 H 是提示）。M（標記）也要目前題看得到。
- **目前題看不到（或是 null）時按字母或數字**：不改任何答案；把目前題設成可見範圍裡的第一張卡片、加外框並播報「目前題：第 36 題，再按一次 C 作答」。典型情境：點 (B) 作答第 35 題 → 用滾輪捲到第 36 題（第 35 題已捲出畫面）→ 按 C：第 35 題仍是 (B)，第 36 題變成目前題；再按一次 C 才作答第 36 題。這樣答案永遠只會改在看得到、有外框的那一題。
- **N／P 把焦點放在題目卡的標題**（題號＋題幹的 `legend` 或標題元素，`tabIndex={-1}`），**不放在選項上**：現在 `MockSessionPage.tsx:62–78` 的 `focusQuestion` 會把焦點放在第一個沒停用的 input，也就是 (A) 的 radio，即使已經選了 (C)；焦點落在沒勾的 radio 上之後，學生習慣按空白鍵往下捲，就會勾成 (A)，按 ArrowDown 也會改答案。從標題按 Tab 時，瀏覽器會把焦點放在已勾選的那個 radio（radio 群組的原生行為）。題號列與「全部題號」的「前往」在桌機也改用同一個 `focusQuestionHeading`；手機的題號面板沿用原本的 `focusQuestion`（行為不變，R7）。
- 目前題是 null 時按 N 或 P：設成可見範圍裡的第一張卡片（沒有可見卡片時是第 1 題）。

### 7.5 歷屆作答頁 `/exams/:examId`（`features/exams/ExamPaperPage.tsx`）

- P1：題號列（§7.1）；分割作答（§7.2）；目前題與鍵盤（§7.3、§7.4）。
- P1：工具列與試卷加 `lg:bleed lg:[--bleed-max:100cqw]`；開考前的設定畫面、交卷結果摘要、PDF 下載區塊不加，自動維持 944 px（§2.3）。
- P2：交卷後的題號格可以只看答錯的題（「只看答錯」切換）。

### 7.6 模擬考 `/mock/:paperId`、`/mock/report/:attemptId`

- 作答中（P1）：題號列取代 `SectionNavigator`＋`QuestionPalette` 的桌機位置；M 標記目前題（和題號旁的「標記」按鈕同一個 `toggleMarks`，條件見 §7.4）；交卷確認對話框（`SubmitDialog`）不變。工具列與試卷 `lg:bleed lg:[--bleed-max:100cqw]`。
- 開考前（`StartScreen.tsx`，P1）：不加 `bleed`，維持 944 px。
- 成績單（`MockReportPage.tsx`，一般模式，P1）：lg 起用 `useMediaQuery` 換成桌機樹（R4，`lg:bleed`），ws 寬度用 CSS grid 排成兩欄——左欄原得總分、級分與五標、贏過多少比例；右欄各大題得分與用時表；下面全寬是非選擇題自評、聲明、檢討試卷與資料來源。非選擇題自評有輸入元件，所以 ws 門檻上下只換排法、不換樹。成績單現在 3,528 px（1440，實測）。
- 檢討試卷（P2）：`ReviewPaper` 展開整份 37,000 px 的試卷（實測），加題號格（答對／答錯）與「只看答錯」。

### 7.7 交卷後

P1：題號列的方格顯示對錯並可跳轉；解析卡（`ExplanationCard`）照現在的位置。P2：主從式檢討——左邊題目列表（✓／✗／用過提示），右邊選中題目的解析；「在文中標出證據句」只捲左欄選文。現在練習交卷後頁面長到 6,500–13,400 px（實測）。

## 8. 鍵盤快捷鍵

共同條件（`lib/hotkeys.ts`，§4.4）：只在 ≥ lg；忽略按住不放的重複按鍵（`e.repeat`）；單鍵快捷鍵在焦點位於文字輸入欄位時、按著 Ctrl／⌘／Alt 時、設定關閉時、有 modal 對話框時、跨斷點後的暫停期間、輸入法正在處理按鍵（`Process`／229）時不作用；Enter、空白鍵、方向鍵不做任何綁定。

| 按鍵 | 作用 | 範圍 | 在文字輸入欄位裡 | 備註 |
|---|---|---|---|---|
| `?` | 開啟快捷鍵說明 | 全站 | 不作用 | |
| `[` | 收合／展開側邊欄 | 全站，`(pointer: fine)` | 不作用 | |
| `Esc` | 關閉對話框、下拉面板、送出確認、單字卡（P2） | 各元件自己處理 | 作用 | 不經全域表 |
| `1`–`4` | 選目前題的 (A)–(D) | 作答頁，單選且選項 ≤ 4 個 | 不作用 | 目前題要看得到（§7.4）；radio／checkbox 有焦點時仍作用（它們不是文字輸入） |
| `A`–`J` | 選目前題（或作用中空格）的同字母選項；多選題是切換 | 作答頁 | 不作用 | 目前題要看得到、而且有這個字母；不分大小寫 |
| `N`／`P` | 下一題／上一題（捲到並設為目前題，焦點移到該題標題） | 作答頁、批改結果的錯誤清單（下一個／上一個錯誤） | 不作用 | N、P 不是任何題型的選項字母（最多到 J） |
| `M` | 標記／取消標記目前題 | 模擬考 | 不作用 | 目前題要看得到；按著 ⌘ 時略過（macOS ⌘M 是縮小視窗） |
| `H` | 打開目前題的下一層提示 | 題庫練習（有 `HintLadder` 的題目） | 不作用 | 目前題有 (H) 選項時讓給選項 |
| `Ctrl／⌘`＋`Enter` | 開啟送出確認（顯示扣幾點），焦點在「取消」；確認列開著時再按不做事 | 五個寫作作答頁、已確認待送出 | **作用**（組字中略過） | 絕不直接送出；確定只能按「確定送出」按鈕（§6.5） |
| `Ctrl／⌘`＋`S` | 立刻存草稿並顯示「已儲存在這台裝置」 | 寫作作答頁 | 作用（組字中略過） | `preventDefault`，不跳出瀏覽器的另存網頁 |
| 空白鍵／Enter、`1`–`4` | 翻卡、評分、測驗作答 | 單字每日學習、測驗 | 不作用 | **既有**，不改；≥ lg 時有對話框開著就不作用（§4.4） |
| `/` | 聚焦本頁搜尋框（P2） | 單字庫 | 不作用 | 只在頁面有搜尋框時 `preventDefault`（Firefox 的 `/` 是快速搜尋） |
| `S` | 發音（P2） | 單字卡 | 不作用 | |

**可被發現**：? 對話框列出全站與這一頁目前有效的快捷鍵；作答頁題號列的 ? 按鈕、側邊欄底部與頁尾都有入口；寫作的送出按鈕旁顯示 `Kbd`（空間夠時）。有快捷鍵的按鈕加 `aria-keyshortcuts`。

**衝突檢查**：

- 瀏覽器：Ctrl＋S 只在寫作作答頁攔截；Ctrl＋Enter 瀏覽器沒有預設作用；不用 Alt 組合（Alt＋← 是上一頁）；不用 Ctrl＋K（Chrome、Firefox 是聚焦搜尋列，指令面板延後也是這個原因之一）。
- 螢幕閱讀器：瀏覽模式下 NVDA／JAWS 會先攔下字母鍵（H、N…），網頁收不到，不衝突；焦點模式下才會送到網頁。WCAG 2.1.4 要求單鍵快捷鍵能關閉：設定頁與 ? 對話框都有開關。
- **輸入法（未實測，不當成保護）**：Windows 的 Chrome／Edge 在焦點不在可編輯元素上時通常不啟動輸入法組字，macOS 的輸入法這時送出的也多半是 ASCII 字母；如果是這樣，注音開著時字母快捷鍵照樣會作答。台灣學生幾乎都常駐注音，所以：
  - 防止誤觸只靠「目前題要看得到」「有外框與播報」「文字欄位裡不作用」「可以關掉」這幾條（§7.4），**不靠輸入法**；
  - 第 1 版說明對話框的「中文輸入法開著時，字母快捷鍵不會作用／切到英數模式才能用」這段文字刪除（§4.9）；
  - 某些平台若送出非 ASCII 的 `e.key`（例如「ㄅ」），用 `e.code` 比對（§4.4）；送出 `Process`／229 時略過；
  - `isComposing` 只保護文字欄位裡的 Ctrl＋Enter、Ctrl＋S；
  - **實機測試**（PR C 的預覽網址上做，結果記在本節並標「實測」）：Windows 11 的 Microsoft 注音（Chrome、Edge）與 macOS 注音（Safari、Chrome），中文模式下點一題的 (A)、焦點在 radio 上與點空白處讓焦點在 body 上，各按一次 b，記錄答案有沒有變、keydown 的 `e.key`、`e.code`、`e.isComposing`、`keyCode`。依結果決定說明對話框要不要補一句。

## 9. 不做與延後

| 項目 | 理由／之後怎麼做 |
|---|---|
| 指令面板（Ctrl／⌘K）與全站搜尋（6,012 字、66 份考卷、121 題寫作題目、各頁面） | 要另外設計排序、combobox 的無障礙與資料下載（詞彙索引 838 KB）；版面改好之前不是瓶頸。盤點已有資料來源規劃，之後的 PR 再做 |
| `g`＋字母跳頁 | 依賴指令面板的同一套註冊表，一起延後 |
| 作答頁右側常駐欄（計時、交卷、題號） | 1280–1535 放不下三欄而不壓縮選文；這一版用一行的題號列。看過 1920 的截圖再評估 wide 寬度的右欄 |
| 綜合測驗不開行內選項面板、改在右欄作答 | 要改三個 e2e 與 `第 N 題的選項` 的結構；先做連動 |
| 交卷後的主從式檢討、只看答錯 | P2（§7.7） |
| 寫作題目列表、/admin、/words 的表格模式 | P2（§5.4、§5.6、§5.9、§5.13） |
| 模擬考級分趨勢圖 | P2（§5.8） |
| 可拖曳調整的面板寬度 | 固定比例已涵蓋 1024–1920；拖曳要處理鍵盤操作與儲存 |
| 照片拖曳排序、貼上圖片 | P2（§6.4） |
| 首頁「今天要做什麼」（SPEC §2.3 的規則推薦） | 屬於功能而不是版面；儀表板先放「繼續學習」 |
| 列表返回時恢復捲動位置 | 現在全站換頁都回到頂端（`Layout.tsx:255`），另案處理；/exams 至少先帶回篩選條件（§5.7） |
| 修改既有文字中的「大考中心」 | 不在這次範圍 |
| 手機上的版面錯誤（`/writing` 自訂題目卡片重疊） | 會改到手機像素，見 §14 第 1 點 |
| 自訂斷點、觸控筆電的特別處理 | ≥ lg 一律當桌機；觸控為主的裝置不提供側邊欄收合（§3.2），點擊目標維持 ≥ 24 px |
| 截圖比對放進 CI | 一次約 3 分鐘＋兩次建置；先在 PR 說明附結果與重跑指令（§11.1），之後可加 `workflow_dispatch` |
| 列印樣式 | 不做 |

## 10. 實作計畫

**三個依序合併的 PR**（B、C 都依賴 A 的元件與殼層）。每個 PR 結束時的檢查：`npm run typecheck`、`npm test`、`npm run test:e2e`（§11.3 的所有 project）、§11.1 的手機截圖比對（0 差異）、桌機與深色模式截圖、鍵盤走查。每個 PR 各自請站主在預覽網址試用、各自合併、出問題時各自 revert。PR A 若超過約 40 個檔案，拆成 A1（基礎建設＋殼層：`lib/*`、`components/desktop/*`、Layout、index.css、截圖工具、playwright 設定）與 A2（首頁與列表頁）。

**每個 PR 開工的第一步**：(1) 在基準產物上補截自己要改的共用元件在手機上的每一種狀態（§11.1 的必備情境），沒有基準圖就不開始改那個元件；(2) 在 `desktop` project 跑一次現有 e2e，確認 §10.5 列的斷言與實際失敗清單一致，有新的就補進 §10.5。

### 10.1 PR A：殼層、共用元件、首頁與列表

| 檔案 | 改動 | 優先 |
|---|---|---|
| `apps/web/vite.config.ts`（`test.environmentOptions`）、`src/test/setup.ts`、`src/test/viewport.ts`（新） | 單元測試的預設視窗 375×667、每個測試後設回（R8）；`setDesktopViewport(width = 1366, height = 640)` helper | P1 |
| `src/index.css` | `@theme` 加 `--container-ws: 60rem`、`--container-wide: 80rem`；`@utility bleed`（§2.3）；`@media (width >= 64rem)` 裡的 `html` scroll-padding-top、`scrollbar-gutter: stable`、`html:has(dialog:modal) { overflow: hidden }`（§3.4） | P1 |
| `src/lib/media.ts`（新）＋測試 | §4.1；測試：`useMainTier` 的門檻、第一次 render 的同步估算、跨斷點的焦點保存與還原（含 selection）、找不回焦點時呼叫 `suspendSingleKeys` | P1 |
| `src/lib/desktopLayout.ts`（新）＋測試 | §4.2；測試：`PAGES` 的每個路徑與 `App.tsx` 裡每個 `path="…"`（讀原始碼比對）都在對照表或確定落到 default、`/writing/translation/ai` 是 default 而 `/writing/translation/ai/1d423d` 是工作區、`isWorkspaceRoute`、`sidebarActivePath` | P1 |
| `src/lib/desktopPrefs.ts`（新）＋測試 | §4.3；localStorage 丟例外時用預設值；側邊欄沒有設定時是「自動」 | P1 |
| `src/lib/hotkeys.ts`（新）＋測試 | §4.4；測試：`e.repeat` 略過、組字中只略過文字欄位裡的組合鍵、`Process`／229 略過、`e.code` 退路、文字欄位略過但 radio 不略過、mod 組合、設定關閉、`dialog:modal` 與 `[aria-modal]` 偵測、暫停與解除、頁面優先於全站 | P1 |
| `src/components/desktop/{Workspace,PaneTabs,StickyBar,DataTable,ShortcutHelp,Kbd,Tooltip}.tsx`、`scroll.ts`（新）＋測試 | §4.5–§4.11；測試：`DataTable` 排序與 `aria-sort`、列點擊觸發 Link、文字選取時不觸發、`state` 傳遞、每列只有一個連結；`PaneTabs` 方向鍵與 Home／End、各分頁記住 scrollTop、`select()`、`beforematch` 切換；`ShortcutHelp` 焦點進出、Esc；`scrollAndFocus` 用 `preventScroll` | P1 |
| `src/components/Layout.tsx` | 寬度模式、`--page-px`、`main` 的 container＋flex＋頁尾貼底、`MainWidthProvider`、`SiteFooter` 對齊與桌機連結、側邊欄三段＋收合（僅 pointer fine）＋提示泡泡＋自動收合＋淡出遮罩＋目前位置＋首次設定時 `inert`、掛載全站快捷鍵（? 與 `[`）與 lazy 的 `ShortcutHelp`、`BackToTop`（main 外） | P1 |
| `src/features/account/LoginButton.tsx` | `placement="sidebar"`：外框樣式、選單往上開（浮層樣式 R11）、收合時只顯示頭像 | P1 |
| `src/components/ThemeToggle.tsx` | 可存取名稱說明目前是哪一種（跟隨系統時也說）；接受 `className` | P1 |
| `src/components/ListSection.tsx` | `lg:scroll-mt-4` 改 `lg:scroll-mt-2`（scroll-padding 已扣掉篩選列） | P1 |
| `src/components/ModulePage.tsx` | `PageHeader` 加 `actions` 插槽與 lg 的兩列式 | P1 |
| `src/pages/HomePage.tsx`、`src/features/home/DesktopDashboard.tsx`（新，lazy）、`src/features/progress/ProgressStats.tsx`、`BackendStatus` | §5.1（`variant="rail"` 保留 region 名稱、testid 與文字） | P1 |
| `src/features/practice/PracticeHome.tsx` | §5.2 矩陣（名稱格式不變）、右欄 | P1 |
| `src/features/practice/SectionPractice.tsx` | §5.3 頁首、hover、`bleed`（作答區在 C） | P1 |
| `src/pages/TranslationPage.tsx`、`CompositionPage.tsx`、`src/features/writing/components/KindFilter.tsx` | §5.4 | P1（表格 P2） |
| `src/features/writing/WritingHomePage.tsx`、`components/SubmissionHistory.tsx`、`components/AiAccessPanel.tsx`（`QuotaMeters`） | §5.5 | P1 |
| `src/features/writing/TranslationListPage.tsx`、`EssayListPage.tsx`、`bank/BankListPage.tsx` | §5.6 | P1（表格 P2） |
| `src/pages/ExamsPage.tsx`、`src/features/exams/ExamList.tsx` | §5.7（沒有滿分、時間、動作欄；`state` 帶篩選） | P1 |
| `src/pages/MockExamPage.tsx`、`src/features/mock/MockPaperList.tsx` | §5.8 列式卡片 | P1（趨勢圖 P2） |
| `src/pages/SettingsPage.tsx` | §5.10 | P1 |
| `src/pages/AboutPage.tsx`、`src/features/account/PolicyView.tsx`、`PolicyPage.tsx` | §5.11 | P1（目錄 P2） |
| `src/features/account/styles.ts`、`AccountPage.tsx`、`WelcomePage.tsx`、`AiApplyPage.tsx` | §5.12 | P1 欄位寬度；其餘 P2 |
| `src/features/admin/*` | §5.13 | P2 |
| `src/pages/NotFoundPage.tsx` | §5.14 | P1 頁尾；連結 P2 |
| `apps/web/playwright.config.ts` | §11.3 的 project 調整（`testIgnore`、`desktop-ui`、`desktop-lg`、`mobile-guard`） | P1 |
| `apps/web/tests/visual/`（新：`visual.config.ts`、`capture.shots.ts`、`compare.mjs`、`manifest.mjs`、`README.md`）、`apps/web/scripts/visual-baseline.sh`、`visual-run.sh`（新） | 截圖工具搬進 repo（§11.1） | P1 |
| `tests/desktop-shell.spec.ts`、`tests/mobile-guard.spec.ts`（新） | §11.3 | P1 |
| 既有 spec | 依 §10.5 處理；手機 project 的斷言一律不放寬 | 視需要 |

### 10.2 PR B：寫作

| 檔案 | 改動 | 優先 |
|---|---|---|
| `src/features/writing/components/EditorStatusBar.tsx`（新）＋測試 | §6.5；測試：單詞數獨立的 span、顏色 token 與文字、只播報門檻 | P1 |
| `src/features/writing/components/AttemptActions.tsx`（新）＋測試 | §6.5 送出區、單行提醒、「⋯」、送出確認；測試：初始焦點在「取消」、確認列開著時 mod+Enter 無作用、取消後焦點回作答框 | P1 |
| `src/features/writing/lib/useWritingHotkeys.ts`（新）＋測試 | Ctrl／⌘＋Enter 開確認、Ctrl／⌘＋S 立即存檔；`e.repeat` 與組字中略過；**不註冊 Enter** | P1 |
| `src/features/writing/components/WorkspaceHeader.tsx`、`TaskSummary.tsx`（新） | 一行頁首與跳轉連結；作文的「任務＋要求」摘要 | P1 |
| `src/features/writing/EssayAttemptPage.tsx`、`components/EssayPromptView.tsx`、`components/EssaySelfAssess.tsx`（`compact`）、`components/ui.tsx`（作答框的字級與行高、`AiNotice` 的 `compact`） | §6.1、§6.2 | P1 |
| `src/features/writing/bank/BankEssayAttemptPage.tsx`、`bank/components/EssayReveal.tsx` | §6.2；圖放大對話框（`BankFigure.tsx`）P2 | P1 |
| `src/features/writing/custom/CustomEssayAttemptPage.tsx`、`custom/CustomPromptView.tsx` | §6.2（`split="off"` 的表單狀態）；需求不一致的即時提示 P2 | P1 |
| `src/features/writing/TranslationAttemptPage.tsx`、`bank/BankTranslationAttemptPage.tsx`、`components/TranslationSelfCheck.tsx`（右欄精簡版）、`bank/components/TranslationReveal.tsx` | §6.3 | P1 |
| `src/features/writing/components/PhotoPicker.tsx`、`PhotoDropZone.tsx`（新） | §6.4：桌機隱私文字 P1；拖放與貼上 P2 | P1／P2 |
| `src/features/writing/SubmissionResultPage.tsx`、`components/ResultWorkspace.tsx`（新）、`lib/useSelectedError.ts`（新）、`components/EssayResult.tsx`、`components/HighlightedText.tsx`（分段給交錯對照用） | §6.6 作文結果、交錯對照、雙向連動 | P1 |
| `src/features/writing/components/TranslationResult.tsx` | §6.6 中譯英結果 | P2 |
| `src/features/writing/components/OcrConfirm.tsx`；`SubmissionResultPage.tsx` 的 Pending 與已確認分支 | §6.7 | P2 |
| `tests/desktop-writing.spec.ts`（新） | §11.3 | P1 |

### 10.3 PR C：作答頁、模擬考、單字

| 檔案 | 改動 | 優先 |
|---|---|---|
| `src/features/exams/navigation.ts`（新） | 從 `MockSessionPage.tsx:62–105` 搬出 `focusQuestion`、`focusSection`、`stickyToolbarBottom`，歷屆共用；新增桌機用的 `focusQuestionHeading` | P1 |
| `src/features/exams/paperIndex.ts`（從 `features/mock/` 搬來） | 模擬考改匯入路徑 | P1 |
| `src/features/exams/components/QuestionGrid.tsx`（新）、`SessionNavRow.tsx`（新）；`src/features/mock/components/SectionNavigator.tsx` | §7.1；`QuestionPalette` 改用 `QuestionGrid`，class 一字不改；兩個舊元件加 `lg:hidden` | P1 |
| `src/features/exams/components/ExamToolbar.tsx`、`src/features/mock/components/MockToolbar.tsx` | `desktopRow` 插槽、`--page-px`、`useStickyHeightVar` | P1 |
| `src/features/exams/CurrentQuestion.ts`（新）、`useSessionHotkeys.ts`（新）＋測試 | §7.3、§7.4；測試：pointerdown 設目前題、看不到時不作答只換目前題、null 時第一次按鍵、播報文字、只有兩張卡重繪 | P1 |
| `src/features/exams/components/Paper.tsx`、`BlankGroups.tsx`、`Questions.tsx` | §7.2 欄寬、綜合測驗的 grid 放置、sticky 位置、container query、短選項一列四個、`data-current`、`lg:scroll-mt-2`、空格與題目卡連動 | P1 |
| `src/features/exams/components/RichText.tsx`、`Passage.tsx` | `data-refers-label`、面板內分頁、圖表膠囊 | P2 |
| `src/features/exams/ExamPaperPage.tsx` | §7.5 | P1 |
| `src/features/mock/MockSessionPage.tsx`、`components/StartScreen.tsx`、`MockReportPage.tsx` | §7.6 | P1（檢討試卷 P2） |
| `src/features/practice/PracticeSession.tsx`、`BankPractice.tsx` | 題號列、快捷鍵、`lg:scroll-mt-4` 改 `lg:scroll-mt-2`；主從式檢討 P2 | P1 |
| `src/features/vocab/VocabModule.tsx`、`views/LibraryView.tsx`、`views/StudyView.tsx`、`views/QuizSession.tsx`、`views/WordDetailView.tsx`、`views/MistakesView.tsx` | §5.9 | P1（表格、側欄單字卡、快捷鍵 P2） |
| `tests/desktop-session.spec.ts`（新） | §11.3 | P1 |

### 10.4 共用檔案與衝突

`Layout.tsx`、`Questions.tsx`、`BlankGroups.tsx`、`Paper.tsx`、`SubmissionResultPage.tsx` 也是其他工作線常改的檔案：每次改動只加帶前綴的 class 或桌機分支，不搬動手機分支的 JSX；合併 main 之後先跑 §11.1 的比對（題庫資料變了要加 `--data-from`）。拆成三個 PR 之後，每個分支開的時間短，合併 main 的次數與重跑比對的成本都比一個大 PR 小。

### 10.5 現有 e2e 受影響的斷言

現有的 `desktop` project 是 1280×900（＝ws 寬度），以下斷言會碰到這次的改動。原則：**優先保留同名控制項與相同字串**；真的要依 project 分開斷言時，手機 project 的斷言一律不放寬。

| spec：行 | 斷言 | 會被什麼影響 | 處理 | PR |
|---|---|---|---|---|
| `smoke.spec.ts:94–99` | `navigation「主要導覽」`只有 1 個，桌機裡看得到「關於」連結 | 「其他」群組移出清單 | 「關於」改成底部工具列的圖示連結，仍在同一個 `<nav aria-label="主要導覽">` 裡 | A |
| `smoke.spec.ts:137–141` | 首頁看得到「後端未連線」與「重新檢查」 | 後端狀態移到右欄 | 文字與按鈕名稱不變 | A |
| `overview.spec.ts:159–168` | 首頁不下載 `/data/` | 儀表板「繼續學習」 | 只讀 localStorage，不下載資料 | A |
| `overview.spec.ts:171–200`、`:229–235` | 學習進度 region 的三個 `progress-stat`、連結與文字 | `ProgressStats variant="rail"` | region 名稱、testid、href、文字都不變 | A |
| `practice.spec.ts:127–128` | 「三種難度給誰」標題與「頂標到 15 級分的學生」可見 | 第 1 版收進 `<details>` | 不收：ws 寬度移到右欄、照樣可見 | A |
| `practice.spec.ts:130–137`、`overview.spec.ts:306` | 連結「…：1 組，已做 0 組」、`/組，已做/` 共 6 個、group「…：出題中」共 12 個 | 矩陣格 | 名稱格式一字不改，答對率放 `aria-describedby`；沒有題組的格仍是 group | A |
| `exams.spec.ts:49–50` | main 裡 /指考/ 的連結只有 1 個 | 第 1 版的「開始」動作欄 | 拿掉動作欄，每列只有一個連結 | A |
| `mock.spec.ts:52–55、131` | `region「卷別」`裡 6 個 `article`、h3 順序、「沿用題提醒」、第一張含「已完成 1 次，最近一次 3 分、1 級分」 | 第 1 版改 `<table>` | 不改表格，改列式卡片（§5.8），結構與文字不變 | A |
| `mock.spec.ts:57` | 連結「開始：115 學測模擬考」 | — | 沿用 | A |
| `writing-custom.spec.ts:327–331` | `region「我的寫作紀錄」`、按鈕「英文作文」、連結 /自訂題目 英文作文/ 含題目開頭與 href | 寫作紀錄改表格 | 主要連結的內容與名稱照舊；region 與切換按鈕照舊 | A |
| `writing.spec.ts:143–147`、`account.spec.ts:40` | 按鈕「自我檢核（不用 AI）」，`#t-self-check` 的標題在視窗內且有焦點 | 第 1 版右欄常駐自我檢核 | 右欄保留同名按鈕與 id（§6.3） | B |
| `writing-custom.spec.ts:136` | `/^\d+ 個單詞$/` 可見 | 狀態列 | 單詞數放在自己的 span（§6.5） | B |
| `writing-custom.spec.ts:140–142、183–184` | 按鈕「自我檢核與自評（不用 AI）」，`#custom-essay-self` 的標題在視窗內 | 第 1 版改成分頁 | 動作列保留同名按鈕，切分頁並聚焦標題；分頁面板沿用 id（§6.2） | B |
| `writing-custom.spec.ts:137`、`:173` 等 | 「AI 批改即將開放。」「你正在和 AI 互動」可見 | `AttemptActions` 精簡版 | 文字不變 | B |
| `writing.spec.ts:225–238` | 中譯英結果 `region「第 1 句」`等 | 中譯英結果（P2） | P2 才動；動時保留 region 名稱 | B（P2） |
| `mock.spec.ts:84、95–98、105、146、152` | `navigation「大題導覽」`裡的按鈕名稱、「已答 1／10 題，標記 1 題」、`aria-current="step"` | 精簡的大題膠囊 | `aria-label` 沿用完整名稱、`aria-current="step"`；舊導覽 `lg:hidden`，只有一份 | C |
| `mock.spec.ts:150–160` | 切大題後大題標題在工具列下方 | 工具列多一列 | `stickyToolbarBottom()` 量整個工具列，不變 | C |
| `exams.spec.ts:72–77`、`mock.spec.ts:80–86`、`practice.spec.ts:115` | `group「第 N 題的選項」`（行內選項面板） | — | 保留行內面板（§7.2） | C |

## 11. 測試與驗證

### 11.1 手機與平板截圖比對（驗收標準：0 個像素不同）

**截圖工具搬進 repo**（PR A）：目前在這次工作階段的 scratchpad（`H=/tmp/claude-0/-home-user/2d144e17-026c-5789-bf1d-ea76d9e0f78e/scratchpad/desktop-ui`），CI、站主、審查者和之後的工作階段都沒辦法重跑。PR A 把它放進 repo：

- `apps/web/tests/visual/`：`visual.config.ts`（自己的 config 與 `testMatch: /\.shots\.ts$/`，預設的 `npm run test:e2e` 不會跑到）、`capture.shots.ts`（路由、狀態、FakeBackend、確定性處理）、`compare.mjs`（不需要 npm 套件的逐像素比對，exit 0＝相同）、`manifest.mjs`、`README.md`。放在 `tests/` 底下，`@playwright/test`、`../support/backend` 都解析得到，不必再複製進去又刪掉。
- `apps/web/scripts/visual-baseline.sh <commit>`：用 `git worktree add` 把指定 commit（預設 40c46d2）檢出到 repo 外的暫存資料夾，`npm ci`、建置，保留建置產物（含當時的 `data/`），截基準圖，最後 `git worktree remove`。
- `apps/web/scripts/visual-run.sh <輸出資料夾> [--data-from <基準產物>] [--viewports …]`：建置目前的工作目錄並截圖。
- 截圖與建置產物一律輸出到 repo 外（預設 `${TMPDIR}/gsat-visual/`），640 張 PNG 不進 git；PR 說明附 `compare` 的結果、`manifest.json` 與重跑指令。

現有基準（scratchpad，PR A 之後可以用 `visual-baseline.sh 40c46d2` 重建）：7 種視窗（320×640、375×812、768×1024 各 92 張；1024×768、1280×800、1440×900、1920×1080 各 91 張），0 個 console error、0 張不穩定；涵蓋 §5.0 全部路由與狀態：未登入、學生（AI 已核准）、未申請 AI、管理員、首次設定；深色模式；「更多」面板；帳號選單；作答中途與交卷後；模擬考 8 個大題、交卷對話框、成績單；寫作的填寫中、自我檢核、對照、拍照、批改結果與排隊中。確定性：固定時鐘 2026-10-18 10:00（台北）、`Math.random` 固定 0.5、`crypto.randomUUID` 遞增、關閉動畫、滑鼠停在 (0,0)、連續兩次截圖相同才保留、Chromium CPU 光柵化。重跑一次 640 張與基準完全相同（實測）。

**開工前要補截的基準情境**（在 40c46d2 的建置產物上截，三種手機與平板寬度都要；第 1 版的基準缺了這些，0 差異證明不了重構的元件 class 一字未改）：

| 重構的元件 | 必備情境 | PR |
|---|---|---|
| `QuestionPalette`（抽出 `QuestionGrid`） | 模擬考題號面板展開：「前往」模式、「標記」模式（含已答、已標記的格） | C |
| `ExamToolbar`、`MockToolbar` | 交卷確認狀態；工具列在手機上換成兩行的狀態 | C |
| `ClozePanel`、`BankPanel` | 點空格後行內選項面板展開（練習與考試模式） | C |
| `Questions.tsx` 的選項格、`ClozeGroup` | 練習、考試、交卷後三種模式各一張（`RevealButton` 有無） | C |
| `EssaySelfAssess`（加 `compact`） | 歷屆作文、本站仿真、自訂題目三頁的「自我檢核與自評」展開 | B |
| `HighlightedText`、`EssayResult` | 批改結果的「標出的錯誤」展開；點上標跳到錯誤卡片後 | B |
| `TranslationSelfCheck` | 中譯英自我檢核展開（已有）＋檢核項目的說明展開 | B |
| `LoginButton`、`ThemeToggle` | 帳號選單展開（已有）；主題切換按下後 | A |
| `ProgressStats`、`SubmissionHistory`、`ExamList`、`MockPaperList`、`PracticeHome` | 有紀錄與沒有紀錄各一張；寫作紀錄「載入更多」之後 | A |
| 任何會加 `lg:` class 的互動元件 | 鍵盤聚焦（`focus-visible`）各一張：題目卡的 radio、難度分頁、篩選膠囊、送出按鈕 | 各 PR |

每個 PR 結束時（必做；`OUT=${TMPDIR:-/tmp}/gsat-visual`，`$OUT/baseline/` 與 `$OUT/baseline-40c46d2.dist/` 由 `visual-baseline.sh 40c46d2` 產生）：

```bash
apps/web/scripts/visual-run.sh $OUT/after --data-from $OUT/baseline-40c46d2.dist --viewports 320x640,375x812,768x1024
node apps/web/tests/visual/compare.mjs $OUT/baseline $OUT/after --diff-dir $OUT/after-diff     # exit 0 才算通過
git -C /home/user/gsat-desktop status --short                                                 # 確認沒有多出檔案
```

有差異時：看 `after-diff/` 的紅色像素，找出沒帶前綴的 class、多出的包裹元素或在 < lg 走了桌機分支的 hook。注意全頁截圖裡固定定位的元素只畫在第一個畫面高度內（手機底部導覽在 375 時 y≈760），兩次截圖一致，不影響比對。

### 11.2 桌機截圖（給站主與設計審查）

視窗：**1024×600、1280×600、1366×640、1440×800、1920×960**（§1.1；PR A 開工前在基準上補截，改版前後才能對照），另外保留原本的 1024×768、1280×800、1440×900、1920×1080 和舊基準逐張對照。

```bash
apps/web/scripts/visual-run.sh $OUT/after-desktop --data-from $OUT/baseline-40c46d2.dist --viewports 1024x600,1280x600,1366x640,1440x800,1920x960
node apps/web/tests/visual/compare.mjs $OUT/baseline $OUT/after-desktop --viewports 1024x600,1280x600,1366x640,1440x800,1920x960 --diff-dir $OUT/after-desktop-diff
```

審查重點（每個 PR 挑 10–15 張前後對照給站主）：

- **A**：首頁（未登入、學生）、/exams（含 hover 與篩選後）、/practice、/mock、/writing（學生）、隱私權說明；側邊欄在 1366×640 與 1280×600（未登入時淡出遮罩真的出現）、收合後的提示泡泡；`ShortcutHelp`。
- **B**：作文作答頁填寫中（量作答框頂端與送出按鈕的位置）、自我檢核分頁、自訂題目設定前與設定後、中譯英作答與右欄檢核、送出確認列、批改結果（含交錯對照與選中的錯誤）。
- **C**：閱讀與綜合測驗作答中（量工具列總高與選文面板高度）、「全部題號」下拉、模擬考作答中與成績單、詞彙題一列四個、單字庫（篩選欄在 1366×640 的底部）。
- **每個 PR 都要深色模式**：工具列加題號列、全部題號下拉、`ShortcutHelp`、`DataTable` 的 hover 與目前列、`PaneTabs`、`EditorStatusBar` 的三種狀態（未達、達標、超過）、提示泡泡、帳號選單。
- **每個 PR 都要高對比**：`page.emulateMedia({ forcedColors: 'active' })` 截 1366×640 的目前題、選中的錯誤卡片、題號格、側邊欄目前頁（收合與展開）。
- 量 §2.4 的行長、作答框與選文面板的頂端位置與高度，和盤點的數字對照（盤點的量測 JSON 在 scratchpad 的 `survey/*/`，PR A 之後一起移到 `${TMPDIR}/gsat-visual/survey/`）。
- Safari 與 Firefox 實機各看一次：`main` 是 container 時 fixed／sticky 正常（R5）、`bleed` 寬度、`hidden="until-found"` 的退路。

### 11.3 e2e

**Project 調整**（`playwright.config.ts`）：

| project | 視窗 | 跑哪些 spec |
|---|---|---|
| `desktop`（既有） | 1280×900 | 既有 spec；`testIgnore: [/desktop-/, /mobile-guard/]` |
| `mobile`（既有） | 375×667 | 既有 spec＋`mobile-guard.spec.ts`；`testIgnore: /desktop-/` |
| `desktop-ui`（新） | 1366×640 | `testMatch: /desktop-.*\.spec\.ts/`；個別測試用 `setViewportSize` 切到 1280×600、1440×800、1920×960 |
| `desktop-lg`（新） | 1024×600 | `smoke.spec.ts`＋`desktop-shell.spec.ts`（lg 但不到 ws 的分支：DataTable 隱藏欄、題號格隱藏、單欄作答、堆疊的寫作頁） |

第 1 版的 `desktop-wide`（1920×1080）取消：desktop-* spec 本來就自己指定視窗，再在 1920 跑一輪只是重複。

**新增的 spec**：

- `desktop-shell.spec.ts`：
  - 1366×640 已登入與未登入：側邊欄清單沒有溢出（`scrollHeight ≤ clientHeight`）；1280×600 未登入：沒有溢出，或 `data-overflow` 出現、捲到底後最後一項看得到且 `data-overflow` 消失。
  - `/settings` 與 404 的頁尾貼在視窗底部；`[` 收合後重新整理仍是收合；收合時用 Tab 聚焦一項，提示泡泡看得到該項的文字；觸控模擬（`hasTouch`、`pointer: coarse`）時沒有收合按鈕。
  - 工作區路由的自動收合：1100×640、沒有設定過 → 進 `/writing/essay/gsat-115` 時收合、回 `/` 時展開；自己按過展開之後不再自動收合。
  - ? 開說明、Esc 關閉、焦點回到原處；在輸入框裡按 ? 不開；在 /words 每日學習打開說明後按 1，背後的單字卡沒有被評分。
  - 寬度：`/privacy` 內文寬 ≤ 65ch；`/exams` 在 1440 的表格寬 > 944，`InfoSection` 這類沒放寬的區塊仍是 944；非工作區路由上任何 `p`、`li` 寬度 ≤ 60rem；每條路由在 1024、1366、1920 沒有水平捲動（沿用 `overview.spec.ts` 的檢查）。
  - /exams：「115 學測」連結；篩選學測＋112 → 進入考卷 → 按「‹ 歷屆試題列表」→ 網址與篩選仍在；每列只有一個連結。
  - 從 `/writing/translation/gsat-115` 側邊欄的 `aria-current` 在「中譯英」。
  - **焦點不被遮住**：在 /exams 捲到表格底部，從最後一列往上 Shift+Tab 二十次，每一步焦點元素的 top ≥ `StickyBar`＋表頭的 bottom。
- `desktop-writing.spec.ts`（1366×640 與 1280×600）：
  - 作文頁：作答框頂端與送出按鈕同時在視窗內；題目面板與作答框同時可見；游標停在左欄、用滾輪捲到底時左欄最後一個元素看得到、送出按鈕仍在視窗內。
  - 狀態列顯示「N 個單詞」「（至少 120）」與段數；三種顏色狀態的文字。
  - Ctrl＋Enter 出現確認列、焦點在「取消」，FakeBackend 沒有收到送出請求；**連續送出帶 `repeat: true` 的 Ctrl＋Enter keydown**（模擬按住）後仍沒有 POST；確認列開著時再按 Ctrl＋Enter 沒有變化；焦點在「取消」按 Enter 只會取消、焦點回作答框；Tab 到「確定送出」按 Enter 只送出一次。
  - 「自我檢核與自評（不用 AI）」按鈕切到左欄分頁並聚焦標題；分頁之間來回切換，各自的捲動位置還在。
  - 自訂題目：設定前不分欄、表單寬度 ≥ 600 px；按「題目設定好了」後分欄。
  - **跨寬度不重新掛載**：在作答框打字到一半，把視窗從 1366 改成 1200（仍 ≥ lg）→ 焦點與游標位置都還在、內容沒變；從 1366 改成 1000（跨過 lg）→ 焦點與游標由 §4.1 還原。
  - 中譯英（1366×640）：兩句的作答框與送出按鈕同時在視窗內；「自我檢核（不用 AI）」展開後標題在視窗內且有焦點。
  - 批改結果：點第 3 個錯誤 → 右欄第 3 張卡片 `aria-current` 且在視窗內、作文面板仍可見；左欄切到「參考改寫」後按卡片的「在作文中標出」→ 左欄切回「你的作文」且標記在面板可見範圍內；交錯對照的段落順序。
  - 畫面文字沒有官方參考譯文（沿用既有的 D8 檢查）。
- `desktop-session.spec.ts`（1280×600、1366×640；`desktop-lg` 另跑 1024×600 的工具列高度）：
  - 工具列總高 ≤ 100 px、題號列只有一行；「大題導覽」只有一份。
  - 閱讀選文面板寬與每行字元數在範圍內、面板頂端在工具列下方。
  - 綜合測驗點空格 11 後空格與第 11 題卡片都在視窗內；練習、考試兩種模式的右欄排列正確。
  - 按 `b` 選目前題的 (B)、`n` 換題、`m` 標記（模擬考），每次都有 live region 的播報文字。
  - **點選 → 捲走 → 按字母**：點第 35 題的 (B)，用 `mouse.wheel` 捲到第 35 題完全離開視窗，按 `c` → 第 35 題仍是 (B)、第 36 題變成目前題且有外框；再按 `c` → 第 36 題選 (C)。
  - 第 1 題選 (C)，按 `n` 再按 `p`，接著按空白鍵 → 答案仍是 (C)，焦點在題目標題上。
  - 按住 `b`（帶 `repeat: true` 的 keydown）只作答一次。
  - radio 有焦點時按 ArrowDown 仍是原生行為（答案照舊改變，我們沒有攔）。
  - 從試卷底部往上 Shift+Tab 走過選項二十次，每一步焦點元素的 top ≥ 工具列 bottom。
  - 組字中（作答框裡 `keydown` 帶 `isComposing: true` 的 Ctrl＋Enter）不開確認；這只驗證文字欄位裡的組合鍵，單鍵與輸入法的關係靠 §8 的實機測試。
- `mobile-guard.spec.ts`（只在 mobile）：題號列、`ShortcutHelp` 按鈕、資料表、提示泡泡都不存在；按字母鍵不改變答案；作文框裡按 Ctrl＋Enter 沒有任何反應；/mock 仍是原本的卡片。

### 11.4 單元測試

§10 各表的「＋測試」；元件測試用 `setDesktopViewport()` 切到桌機，預設維持 375（R8）。另加 `desktop-copy.test.ts`：掃 `src/components/desktop/**`、`src/features/home/**` 與本次新增的檔案，字串裡不得出現「大考中心」或「CEEC」。

### 11.5 無障礙

- axe（`axe-core`、`@axe-core/playwright`）不在 node_modules（已查）；這個 PR 不加套件。改用 Playwright 內建的 `toMatchAriaSnapshot` 檢查桌機頁面的地標與結構：側邊欄 `navigation "主要導覽"`、`main`、兩個面板的 `region` 名稱、`tablist`、資料表的 `table` 與欄標題。
- 每個 PR 做一次純鍵盤走查並記在 PR：Tab 順序跟 DOM 一致；面板可以聚焦後用方向鍵捲動；**面板與側邊欄邊緣的元素焦點框完整、沒有被裁掉**；**焦點不會停在工具列或篩選列底下**；對話框焦點進出、背景不能操作；換分頁、換大題、跨寬度後焦點不會掉到 `body`；送出確認可以只用鍵盤完成與取消。
- 顏色只用既有的 token（`bg`、`surface`、`surface-2`、`line`、`primary`、`primary-soft`、`muted`、`ok`、`bad`、`badge-*`、`--chart-*`），深色模式自動對應；新的文字顏色（狀態列的 `muted`、`badge-fg`、`ok`、`bad`）在兩種主題下都量一次對比（≥ 4.5:1）。狀態一律有文字或圖示，不只靠顏色；高對比模式見 §4.11。
- 單鍵快捷鍵可關閉（WCAG 2.1.4）；點擊目標 ≥ 24 px（WCAG 2.5.8，側邊欄項目 28 px）；焦點不被遮蔽（WCAG 2.4.11，§3.4）；看得到的標籤是可存取名稱的開頭（WCAG 2.5.3，大題膠囊）。

### 11.6 效能

- 不加 npm 套件。
- 主程式 chunk 的 gzip 大小在 PR 說明列前後對照（`vite build` 的輸出），預算 +2 KB 以內（設計值）；首頁儀表板、`ShortcutHelp` 是 lazy chunk，手機不會下載。
- 不掛 `scroll` 事件：sticky 高度與 main 寬度用 `ResizeObserver`、目前大題、目錄與可見題目卡用 `IntersectionObserver`；寫 CSS 變數前先比較數值，不在同一個 frame 先寫後讀版面。
- 目前題用外部 store，目前題改變時只重繪新、舊兩張題目卡（§7.3）。
- 單字庫維持每段 `content-visibility: auto` 與分批顯示；表格模式（P2）也照這個方式分段。
- 驗收時在 1366×640 的 /words 與 /exams/gsat-115 用 `PerformanceObserver('longtask')` 記錄長任務（/exams/gsat-115 另外量連按 N 十次），和改版前比較不能變多（設計值）。

## 12. 上線步驟

1. **PR A**（必要時 A1、A2）：完成 §10.1 與 §11 的檢查，手機截圖比對 exit 0；說明附桌機前後截圖（含深色與高對比）、手機比對結果與重跑指令、主程式大小對照、鍵盤走查紀錄。Vercel 預覽網址請站主在自己的電腦試用：1366×768 筆電（或 1920×1080 開 150%）與 1920×1080 各一次，走過首頁、/exams 篩選後進入考卷再返回、/practice、側邊欄收合。站主同意後合併。
2. **PR B**：同樣的檢查與說明；試用：寫一篇作文到送出確認（按 Ctrl＋Enter、試著按住）、切自我檢核分頁、自訂題目從設定到作答、看一份批改結果並點錯誤。
3. **PR C**：同樣的檢查與說明；試用：一份閱讀題組、綜合測驗、模擬考作答中切換大題與標記、用字母鍵作答後捲走再按字母。**同時做 §8 的輸入法實機測試**（Windows 注音＋Chrome／Edge，有 Mac 的話也測），把結果寫回 §8 並決定說明對話框的文字。
4. 每個 PR 都是純前端改動，沒有資料、API 或部署設定的變更；出問題時只 revert 那一個 PR。單鍵快捷鍵若有反映誤觸，可先把預設改成關閉（一行常數）。
5. 三個 PR 都合併後更新 `docs/SPEC.md` §10 的裝置要求：「桌機 1280×900 之外，1024×600、1280×600、1366×640、1440×800、1920×960 也要沒有錯誤、沒有水平捲動」，並在本文件最後補「實作備註」（實際行長、側邊欄高度、工具列高度、作答框高度、主程式大小、輸入法實測結果）。

## 13. 風險

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | 共用元件（`QuestionPalette` 抽出 `QuestionGrid`、`EntryCard`、`ExamToolbar`）重構時不小心改到手機的 class 或 DOM | 手機畫面改變 | §11.1 每個 PR 必跑、0 差異才算通過；**開工前補截重構元件的展開與互動狀態**；抽元件時 class 一字不改；手機分支保留原 JSX |
| R2 | happy-dom 預設 1024×768，`useMediaQuery(lg)` 在既有測試裡是 true | 既有測試悄悄改測桌機路徑 | `setup.ts` 預設 375×667（R8）；桌機測試明確呼叫 helper |
| R3 | e2e 的 desktop project 是 1280（＝ws 寬度），改動會碰到既有選擇器 | e2e 失敗、或為了過測試改掉可存取名稱 | §10.5 逐條列出與處理方式；可存取名稱與同名控制項沿用；舊元件用 `lg:hidden` 讓同名元素只有一份；每個 PR 一開始就跑 e2e |
| R4 | sticky 失效：祖先有 `overflow`、flex 直排容器裡的 `mx-auto` 不拉伸 | 表頭、面板不黏，或內容縮成一條 | 表格不包捲動容器；內容容器加 `lg:w-full`；寫作工作區不靠 sticky（固定高度的面板）；e2e 檢查捲動後面板仍在視窗內 |
| R5 | 跨斷點時元件重新掛載 | 作答框的焦點、游標、復原紀錄、未送出的注音組字消失；焦點掉到 `body` 後按的字母觸發快捷鍵 | lg 以上只有一棵樹、靠 CSS 換排法（R4），拖動視窗、放大縮小都不會重新掛載；跨過 lg 時保存並還原焦點與游標，還原不了就暫停單鍵快捷鍵（§4.1）；仍會遺失的復原紀錄與組字在 §4.1 寫明。第 1 版「拖動視窗很少見」的判斷不對：Ctrl＋放大、Win＋←／→、開 DevTools、iPad 旋轉都會跨斷點 |
| R6 | 單鍵快捷鍵誤觸（以為焦點在輸入框，或答案改到畫面外的題目） | 答案被悄悄改掉 | 只對看得到、有外框的目前題作答；看不到時按鍵只換目前題、不改答案；每次作答有閃爍與播報；忽略重複按鍵；文字欄位裡不作用；設定可關閉；**不把輸入法當成保護**（§8） |
| R7 | 螢幕閱讀器焦點模式下字母鍵被網頁接走 | 讀屏使用者操作受干擾 | 可關閉（WCAG 2.1.4）；設定頁的說明建議讀屏使用者關閉 |
| R8 | 實際視窗高度只有 560–640（1366×768、1920×1080 開 150%） | 側邊欄、工具列、作答框擠不下 | 以視窗 600 設計（§1.1）；側邊欄改密並有淡出遮罩；題號列固定一行、工具列 ≤ 100；寫作工作區剛好一個畫面高；截圖與 e2e 都在 1280×600 與 1366×640 量 |
| R9 | 放寬後沒改版的區塊被拉寬 | 1920 時一行太長 | 預設維持 944，只有加了 `bleed` 的區塊放寬（§2.3）；e2e 檢查 `p`、`li` ≤ 60rem |
| R10 | 其他工作線同時改寫作、練習頁 | 合併衝突、手機像素意外改變 | 拆成三個 PR、分支開的時間短；改動以加 class 與桌機分支為主；合併 main 後用 `--data-from` 重跑比對；新增的區塊預設不會變寬 |
| R11 | `field-sizing`、container query、`hidden="until-found"` 在舊版瀏覽器不支援 | 版面退回固定行數或兩欄、Ctrl＋F 找不到隱藏分頁 | 都是加分項，退回的樣子就是現在的樣子 |
| R12 | 範圍太大 | 拖延、一次審不完 | 三個 PR 依序合併；每節標了 P1／P2，P2 全部可以拆到之後的 PR |
| R13 | `main` 設成 container 之後，Safari 或 Firefox 的 fixed／sticky 行為和 Chromium 不同 | 浮動元素位置錯 | `main` 裡不放 fixed 元素（R5）；§11.2 實機確認；有問題時退回把 container 設在內容容器上（只影響 `bleed` 的算法） |
| R14 | 輸入法與單鍵快捷鍵的實際行為未知 | 說明文字錯誤、學生誤觸 | 設計不依賴輸入法；PR C 預覽實機測試後才寫相關文字（§8） |

## 14. 待站主決定

不影響開工，括號內是預設值：

1. **`/writing` 自訂題目卡片的重疊錯誤，手機要不要一起修？** 375 px 也看得到；修了 `/writing` 在 320／375／768 的截圖會改變，是唯一一個「改手機像素」的例外。（預設：這個 PR 只修 ≥ lg，手機另開一個小 PR。）
2. **作答與寫作頁寬度不夠時要不要自動收合側邊欄？** 1024–1215 收合後內容從 704 變 896 px，寫作才能分欄、閱讀兩欄比較不擠；只在使用者沒自己設定過、用滑鼠或觸控板的裝置上才自動收合，不寫進設定。（預設：**自動收合**；第 1 版的預設是不自動收合，依審查改。）
3. **單鍵快捷鍵預設開還是關？** 有了「只對看得到的目前題作答」「看不到時不改答案」「每次作答有回饋」「忽略重複按鍵」這些保護後，預設開。（預設：桌機預設開，設定頁與 ? 對話框可以關；PR C 的輸入法實測或試用時若發現誤觸，改成預設關。）
4. **輸入法實機測試由誰做？** 需要一台 Windows 11（Microsoft 注音＋Chrome／Edge），有 Mac 更好；這個開發環境是 Linux 無頭瀏覽器，做不到。（預設：站主在 PR C 的預覽網址上照 §8 的步驟測。）

## 15. 審查回應

第 1 版審查共 42 項意見（ux 15、可行性 8、無障礙 14、測試 4、效能 1）。「採用」＝照建議改；「調整後採用」＝問題成立、改法不同；本次沒有不採用的項目。

| 意見 | 處理 | 說明（改在哪裡） |
|---|---|---|
| ux-1 | 採用 | 設計下限改成視窗內高 600，寫明換算並列出各裝置的實際高度（§1.1）；第一個畫面的設計值用 1280×600、1366×640 重算（§3.2、§6.1、§7.1）；截圖與 e2e 加這兩種尺寸（§11.2、§11.3）。 |
| ux-2 | 採用 | 作答框改成右欄 flex 直排的 `flex-1`，作答框以外壓成三行，`AiNotice` 單行、點數放按鈕旁、清除重寫收進「⋯」，頁首壓成一行（§4.5、§6.1、§6.5）；e2e 在 1280×600 與 1366×640 驗作答框頂端與送出按鈕同時可見。 |
| ux-3 | 調整後採用 | 題號列訂寬度預算並固定一行：大題改成編號膠囊（用阿拉伯數字，讓看得到的文字是可存取名稱的開頭）、題號格水平捲動並在太窄時收進「全部題號」、拿掉提示文字（§7.1）；e2e 斷言工具列 ≤ 100 px。 |
| ux-4 | 調整後採用 | 目前題捲出畫面就設回 null，看不到時按鍵只把目前題換成畫面上第一題並播報、不改答案；作答與標記都有閃爍與播報；補「點選→捲走→按字母」的 e2e（§7.3、§7.4、§11.3）。沒有改成捲動時自動換目前題，避免外框一直跳。 |
| ux-5 | 採用 | 分欄改看 main 的寬度（`@ws/main`、`useMainTier`，§2.2、§4.1）；工作區路由在寬度不夠時自動收合側邊欄，成為 §14 第 2 點的新預設（§3.2）；綜合測驗與閱讀同樣從 lg 並排（§7.2）。 |
| ux-6 | 採用 | 中譯英改成每句中文在上、英文在下，作答框用主欄全寬並 3–8 行自動長高；右欄自己捲動、送出區固定在底部、檢核清單只列標題（§6.3）；e2e 在 1366×640 驗兩句與送出按鈕同時可見。 |
| ux-7 | 採用 | 三種作文頁都有固定的「任務＋要求」摘要（§6.2）；作文欄改成 1:1（§4.5）；PaneTabs 各分頁記住捲動位置、刪掉「捲回頂端」（§4.6）；自我檢核統一放在沒有作答框的那一欄（§6.1）。 |
| ux-8 | 採用 | 自訂題目在設定前與修改題目時用 `split="off"`，表單以 `max-w-3xl` 單欄顯示，設定好才分欄（§6.2）。 |
| ux-9 | 採用 | 詞彙題維持一欄、`max-w-3xl`，短選項一列四個並提前為 P1（§7.2）。 |
| ux-10 | 採用 | 拿掉「滿分」與「動作」欄，時間放進分組標題；題數 53–66 會變，所以保留（§5.7）。 |
| ux-11 | 採用 | `primaryLink` 加 `state`，/exams 照現在的做法傳 `listSearch`；補「篩選→進入→返回」的 e2e（§4.8、§5.7、§11.3）。 |
| ux-12 | 採用 | 輸入法的說法改成「未實測、不當成保護」，說明對話框不寫輸入法；PR C 預覽做實機測試（§4.9、§8、§12、§14 第 4 點）。 |
| ux-13 | 採用 | 點錯誤卡片時左欄先切回「你的作文」；「參考改寫」分頁逐段和原文交錯，P1 就做（§6.6）。 |
| ux-14 | 採用 | 篩選欄寫明 `top`、`max-h`、`overflow-y-auto`，並把「排序」移到結果數那一列（§5.9）。 |
| ux-15 | 採用 | 每個 PR 加深色模式截圖清單（§11.2）；浮層一律加框線與陰影（R11、§4.11）；狀態列寫明用哪個 token 並驗對比（§6.5、§11.5）。 |
| feas-1 | 採用 | 同 ux-1；截圖工具與 e2e 加 1024×600、1280×600、1366×640（§11.2、§11.3），側邊欄、作答框、工具列的高度預算重算。 |
| feas-2 | 採用 | 題號列固定一行並依實際排版量高度（§7.1）；題目卡與大題標題在 lg 改 `lg:scroll-mt-2`，由 `html` 的 scroll-padding 扣掉工具列（§3.4）；e2e 量每種寬度的工具列高度。 |
| feas-3 | 採用 | 頁首高度用 `useStickyHeightVar` 量，工作區 grid 高度＝視窗 − 頁首，兩欄都是固定高度的捲動容器、不 sticky、拿掉 `overscroll-contain`（§4.5）；e2e 在 1280×600 驗滾輪捲到左欄底部且送出按鈕仍可見。 |
| feas-4 | 採用 | 改成「預設維持原寬、改版的區塊才放寬」：`@utility bleed`（Chromium 實測寬度正確），沒加的區塊自動 944；e2e 檢查 `p`、`li` ≤ 60rem（§2.3、§11.3）。 |
| feas-5 | 採用 | 拆成三個依序合併的 PR，A 可再拆 A1／A2，各自比對、試用、revert（§0 第 13 點、§10、§12）。 |
| feas-6 | 採用 | 桌機只有一棵樹，lg 以上靠 CSS 換排法，不會重新掛載（R4、§4.5）；跨過 lg 時保存並還原焦點與游標，還原不了就暫停單鍵快捷鍵（§4.1）；補「打字途中改視窗寬度」的 e2e。 |
| feas-7 | 採用 | 綜合測驗的右側子元素各自 `lg:col-start-2`，選文跨 5 列、`self-start`，根元素 `lg:space-y-0 lg:gap-4`；三種模式都截圖（§7.2）。 |
| feas-8 | 採用 | `ShortcutHelp` 用原生 `<dialog>`，`html` 在 ≥ lg 設 `scrollbar-gutter: stable`，鎖捲動時版面不跳（§3.4、§4.9）。 |
| a11y-1 | 採用 | ≥ lg 給 `html` 設 scroll-padding-top（Chromium 實測有效，§3.4），面板內不放 sticky 元素、狀態列不再 sticky；補 Shift+Tab 走查的 e2e（§11.3）。 |
| a11y-2 | 採用 | 目前題同時用 `onPointerDownCapture` 設定；看不到時不作答；題號列常駐「第 N 題」，作答後用 polite live region 播報；補「第 3 題作答後捲到第 7 題按 b」這類情境的 e2e（§7.1、§7.3、§7.4、§11.3）。 |
| a11y-3 | 調整後採用 | 所有快捷鍵忽略 `e.repeat`；確認列開著時 mod+Enter 不做事；不註冊任何自訂 Enter；初始焦點放在「取消」（沒有採用「keyup 後才能按確定」，焦點在取消已經擋住重複按鍵）；補兩個 e2e（§4.4、§6.5、§11.3）。 |
| a11y-4 | 採用 | 刪掉輸入法的說法；`e.key` 不是 ASCII 時用 `e.code`、`Process`／229 時略過；寫明 `isComposing` 只保護文字欄位裡的組合鍵；實機測試排在 PR C（§4.4、§8）。 |
| a11y-5 | 採用 | N／P 與桌機的題號跳轉把焦點放在題目標題（`tabIndex={-1}`），不放在選項上；補「選 (C)→N→P→空白鍵」的 e2e（§7.4、§11.3）。 |
| a11y-6 | 採用 | 目前題、選中卡片改用 outline，題號格加勾號、側邊欄目前頁加色條；加高對比截圖（§4.11、§11.2）。 |
| a11y-7 | 調整後採用 | 列表頁與首頁的右欄一律不 sticky，從根本避免比視窗高的 sticky 欄；仍 sticky 的 /words 篩選欄與 P2 目錄都加 `max-h` 與自己捲動（§5.1、§5.2、§5.5、§5.8、§5.9、§5.11）。 |
| a11y-8 | 調整後採用 | 跳轉連結只在桌機樹的寫作頁首 render，目標的兩個 Pane 在分欄與堆疊時都存在，所以不必再限 xl（§3.4）。 |
| a11y-9 | 採用 | `isModalOpen()` 用 DOM 偵測 `dialog:modal` 與 `[aria-modal]`；`ShortcutHelp` 改原生 `<dialog>`，背景自動 inert；`StudyView`、`QuizSession` 的舊監聽在 ≥ lg 加同樣的檢查（§4.4、§4.9）。 |
| a11y-10 | 採用 | `scroll.ts` 提供 `scrollAndFocus`，捲動後的程式焦點一律 `preventScroll`（§3.4、§4.10）。 |
| a11y-11 | 採用 | 面板用 `hidden="until-found"`＋`beforematch`；「在作文中標出」先切回分頁；分頁列移到捲動容器外面（比 sticky 簡單）；各分頁記住 scrollTop、刪掉矛盾的句子（§4.6、§6.6）。 |
| a11y-12 | 採用 | 捲動容器留 4–6 px 內距，不能留時在容器內用負的 outline-offset；鍵盤走查加這一項（§4.11、§11.5）。 |
| a11y-13 | 採用 | 收合時滑鼠移入與鍵盤聚焦都顯示提示泡泡（不用 `title`）；`(pointer: coarse)` 的裝置不提供收合；e2e 檢查聚焦時看得到文字（§3.2、§11.3）。 |
| a11y-14 | 採用 | /exams 每列只留第一欄的連結；/mock 的「看成績單」去處不同，保留並沿用「開始：115 學測模擬考」的名稱（§4.8、§5.7、§5.8）。 |
| test-1 | 採用 | §10.5 逐條列出受影響的斷言與處理方式，優先保留同名控制項與字串（矩陣名稱格式、`aria-current="step"`、獨立的單詞數 span、同名的自我檢核按鈕、列式卡片），並補上審查沒列到的 `smoke.spec.ts:94–99` 與首頁的斷言；手機斷言不放寬。 |
| test-2 | 採用 | §11.1 列出每個重構元件必備的基準情境（展開、互動、聚焦），每個 PR 開工前在 40c46d2 的產物上補截（§10 開頭）。 |
| test-3 | 採用 | 截圖工具搬進 `apps/web/tests/visual/`，另附用 `git worktree` 從指定 commit 重建基準的腳本；PNG 不進 git，PR 附比對結果、manifest 與重跑指令（§11.1）。 |
| test-4 | 採用 | desktop、mobile 加 `testIgnore`；手機守門改成獨立的 `mobile-guard.spec.ts`；新增 `desktop-ui`（1366×640）與 `desktop-lg`（1024×600），取消 `desktop-wide`（§11.3）。 |
| perf-1 | 採用 | 目前題改用外部 store 與 `useIsCurrent(label)`，只重繪兩張卡；§11.6 量連按 N 十次的長任務（§7.3）。 |
