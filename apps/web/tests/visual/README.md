# 版面截圖工具

桌機介面改版（`docs/design/desktop-ui.md`）的硬性條件是**手機與平板（寬度 < 1024 px）逐像素不變**。這個工具負責證明這件事：

1. 把全站每個路由（含帶參數的子頁）在幾種有意義的狀態下各截一張整頁圖，12 種視窗各一套；
2. 改版前從某個 commit 截一套**基準**，改版後再截一套，用 `compare.mjs` 逐像素比對 320／375／768 三種視窗，**0 個像素不同**才算通過（設計文件 §11.1）；
3. 1024 以上的九種視窗給設計審查做改版前後的對照（§11.2）。

截圖與建置產物一律放在 repo 外（預設 `${TMPDIR:-/tmp}/gsat-visual/`），一套約 1,000 張 PNG、數百 MB，不進 git。

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `scripts/visual-run.sh` | 建置目前的工作目錄（或用現成的建置產物）→ 截圖 → 寫 `manifest.json`。改版後的截圖都用它 |
| `scripts/visual-baseline.sh` | 從任一個 commit 重建基準：`git worktree` 檢出到暫存資料夾 → 安裝套件 → 建置（保留建置產物）→ 移除 worktree → 截圖 |
| `tests/visual/visual.config.ts` | Playwright 設定：每種視窗一個 project、`vite preview --outDir <建置產物>` 當伺服器、確定性用的 Chromium 參數 |
| `tests/visual/capture.shots.ts` | 截圖腳本本體：路由、狀態、假後端（`tests/support/backend.ts` 的 FakeBackend）、確定性處理 |
| `tests/visual/compare.mjs` | 逐像素比對兩套截圖（不需要 npm 套件）；全部相同 exit 0 |
| `tests/visual/manifest.mjs` | 把每張圖的網址、標題、console error、頁面尺寸彙整成 `<輸出資料夾>/manifest.json`；建置時記下建置產物的來源 |

（`scripts/` 指 `apps/web/scripts/`，`tests/` 指 `apps/web/tests/`。）

**不在一般的測試裡**：截圖腳本的檔名是 `*.shots.ts`、用自己的設定檔，`npm run test:e2e`（只收 `*.spec.ts`）不會跑到；`npm test`（vitest 只收 `src/`、`scripts/` 的 `*.test.ts`）也不會。`npm run typecheck` 照樣檢查這個資料夾（`tsconfig.node.json` 包含 `tests/`）。

## 事前準備

- 在 repo 根目錄 `npm ci` 過。
- Chromium：和 `playwright.config.ts` 一樣，Playwright 預期的版本不在時改用 `/opt/pw-browsers/chromium`（或用 `PLAYWRIGHT_CHROMIUM_PATH` 指定）。本機開發環境**不要執行 `playwright install`**。
- 基準與對照一定要在**同一台機器、同一個 Chromium** 上截：不同機器的字型與點陣化結果不同，比不起來。

## 指令（照抄即可）

以下都在 repo 根目錄執行，`OUT` 是放截圖的資料夾：

```bash
OUT=${TMPDIR:-/tmp}/gsat-visual
```

（這也是兩支腳本省略輸出資料夾時的預設根目錄，可以用環境變數 `VISUAL_OUT` 改。輸出資料夾與建置產物放在 repo 裡時腳本會拒絕執行。）

### 1. 截基準（改版前，一次）

從一個 commit 重建（例如 main 上改版前的那一個）：

```bash
apps/web/scripts/visual-baseline.sh <commit>
# → $OUT/baseline-<commit 前 7 碼>/        截圖（12 種視窗）與 manifest.json
# → $OUT/baseline-<commit 前 7 碼>.dist/   建置產物（含當時的 data/），保留下來給「--data-from」與補截用
```

- 只建置 commit 裡的內容（工作目錄沒 commit 的改動不算）。
- 那個 commit 的 `package-lock.json` 和目前工作目錄相同時，直接借用目前的 `node_modules`（工作區套件 `@gsat/*` 仍指向檢出的原始碼）；不同時在暫存資料夾跑 `npm ci`。加 `--npm-ci` 一律跑 `npm ci`。
- 建置產物已經存在時直接沿用、不再建置（加 `--rebuild` 重建）；截圖資料夾與建置產物的位置可以用 `--out`、`--dist-out` 指定。

也可以直接截「目前的工作目錄」當基準（例如改版分支開工前，原始碼還沒動）：

```bash
apps/web/scripts/visual-run.sh $OUT/baseline --build-to $OUT/baseline.dist
```

### 2. 改版後：手機與平板 0 差異（每個 PR 必做）

```bash
apps/web/scripts/visual-run.sh $OUT/after --data-from $OUT/baseline-<commit>.dist --viewports narrow
node apps/web/tests/visual/compare.mjs $OUT/baseline-<commit> $OUT/after --diff-dir $OUT/after-diff   # exit 0 才算通過
git status --short                                                                                    # 確認沒有多出檔案
```

- `--viewports narrow` 就是 `320x640,375x812,768x1024`；`compare.mjs` 不指定 `--viewports` 時也是比這三種。
- `--data-from`：建置完把 `$OUT/after.dist/data/` 換成基準那份，題庫、考卷、單字資料兩邊完全一樣，比對只反映介面改動。合併了 main 上的新題庫之後一定要加，否則列表、抽到的題組都會不同。
- `--diff-dir`：每張有差異的圖輸出一張差異圖（淡灰的基準圖上，變動的像素標紅）。
- 有差異時：看紅色像素的位置，找出沒帶 `lg:` 前綴的 class、多出的包裹元素，或在 < lg 走了桌機分支的 hook（設計文件 §2.1 的 R1–R11）。

### 3. 改版後：桌機前後對照（給設計審查）

```bash
apps/web/scripts/visual-run.sh $OUT/after-desktop --data-from $OUT/baseline-<commit>.dist --viewports desktop
node apps/web/tests/visual/compare.mjs $OUT/baseline-<commit> $OUT/after-desktop --viewports desktop --diff-dir $OUT/after-desktop-diff
```

- `--viewports desktop` 是九種桌機視窗；只要設計文件 §1.1 的驗收視窗時用 `--viewports 1024x600,1280x600,1366x640,1440x800,1920x960`。
- 桌機的比對結果會列出幾乎每一張（改版本來就會改），用來挑前後對照的圖；exit 1 是預期的。

### 4. 增加截圖情境之後補截基準

在 `capture.shots.ts` 加了新的情境之後，用保留下來的基準建置產物補截，不必重新建置：

```bash
apps/web/scripts/visual-run.sh $OUT/baseline-<commit> --dist $OUT/baseline-<commit>.dist --grep '<新情境的測試名稱>'
```

（`visual-baseline.sh <commit>` 也會沿用已經存在的建置產物。）同一個資料夾裡已有的圖會被同名的新圖覆蓋，其他的不動。

### 5. 其他用法

- 只截幾張：`--grep '01-home|13-exams'`（Playwright 的 `--grep`，比對測試名稱；流程測試一次截好幾張，名稱見下表）。
- 同時跑兩份截圖：用 `--port` 錯開連接埠（預設 4417；被佔用時直接失敗，不會截到別人的伺服器）。
- 4 核心的機器上還有別的工作時用 `--workers 2`（預設 3）。
- 不經腳本、直接執行：

  ```bash
  cd apps/web
  SHOTS_OUT=$OUT/manual SHOTS_DIST=$OUT/baseline-<commit>.dist SHOTS_PORT=4417 SHOTS_VIEWPORTS=375x812 \
    npx playwright test -c tests/visual/visual.config.ts --workers 3
  node tests/visual/manifest.mjs $OUT/manual $OUT/baseline-<commit>.dist ../..
  ```

  環境變數：`SHOTS_OUT`（預設 `${TMPDIR:-/tmp}/gsat-visual/manual`）、`SHOTS_DIST`（預設 `apps/web/dist`）、`SHOTS_PORT`（預設 4417）、
  `SHOTS_VIEWPORTS`（預設 all）、`SHOTS_DSF`（deviceScaleFactor，預設 1；基準和對照要一樣）。

## compare.mjs

```text
node apps/web/tests/visual/compare.mjs <基準資料夾> <對照資料夾> [--viewports narrow|desktop|all|320x640,…] [--tolerance 0]
                                       [--diff-dir <資料夾>] [--json <檔案>]
```

- 依同名檔案比對；兩邊檔案位元組相同就直接跳過，不同才解碼逐像素比。
- 每張有差異的圖列出：變動像素百分比、狀態（像素不同／尺寸不同／對照少了這張／基準沒有這張）、兩邊尺寸、變動像素數與**最大色差**。
  尺寸不同時以兩張圖的聯集為分母，只在一張圖裡有的像素都算變動。
- `--tolerance N`：每個色版容許差 N（0–255），預設 0（完全相同）。驗收一律用 0；只在調查差異時用 `--tolerance 2` 看看是不是點陣化雜訊。
- 結束碼：全部相同 0；有差異（或一張都沒比到）1；用法錯誤 2。
- node_modules 裡沒有 pngjs／pixelmatch，也不為此加套件，所以 PNG 解碼與比對是自己寫的（只用 Node 內建的 `zlib`）。

## 視窗

| 名稱 | 尺寸 | 模擬 | 用途 |
| --- | --- | --- | --- |
| `320x640` | 320 × 640 | 手機（isMobile、觸控） | **基準，不能變** |
| `375x812` | 375 × 812 | 手機（isMobile、觸控） | **基準，不能變** |
| `768x1024` | 768 × 1024 | 平板（isMobile、觸控） | **基準，不能變** |
| `1024x600` | 1024 × 600 | 桌機 | 驗收（1024×768 舊筆電、iPad 橫向） |
| `1024x768` | 1024 × 768 | 桌機 | 盤點時的視窗，前後對照 |
| `1280x600` | 1280 × 600 | 桌機 | 驗收（1920×1080 筆電開 150%） |
| `1280x800` | 1280 × 800 | 桌機 | 盤點時的視窗，前後對照 |
| `1366x640` | 1366 × 640 | 桌機 | 驗收（1366×768 學校筆電） |
| `1440x800` | 1440 × 800 | 桌機 | 驗收（1440×900 MacBook、1920×1080 開 125%） |
| `1440x900` | 1440 × 900 | 桌機 | 盤點時的視窗，前後對照 |
| `1920x960` | 1920 × 960 | 桌機 | 驗收（1920×1080 桌機） |
| `1920x1080` | 1920 × 1080 | 桌機 | 盤點時的視窗，前後對照 |

全部 deviceScaleFactor 1、`zh-TW`、`Asia/Taipei`、淺色（另有幾張深色）、`prefers-reduced-motion: reduce`。
「驗收」視窗是設計文件 §1.1 的視窗內高（以 600 為下限）；`--viewports` 可以用 `narrow`、`desktop`、`all` 或逗號分隔的名稱。

## 帳號狀態（假後端）

後端一律是 `tests/support/backend.ts` 的 FakeBackend（不連任何真的 API）；`/data/*` 用建置產物裡的真資料。

| 代號 | 狀態 |
| --- | --- |
| `anon` | 沒登入；features 是正式站的設定（登入、AI、OCR、自訂題目批改 `customEssay` 全開），版面上有登入按鈕 |
| `student` | 已登入、AI 已核准；額度今天剩 20／30 點；寫作紀錄有中譯英 4 筆、作文 3 筆 |
| `student-none` | 已登入、還沒申請 AI |
| `admin` | 站主：後台有 3 位待審核、健康檢查全綠、用量摘要 |
| `welcome` | 第一次登入、還沒同意條款（任何頁都會被導到 /account/welcome） |

批改結果頁的假提交：`sub-t1`（115 學測中譯英，已批改 5.75／8）、`sub-b1`（本站仿真中譯英「學吉他」，6.5／8）、
`sub-e1`（115 學測作文，打字，12.5／20）、`sub-c1`（自訂題目作文，15／20，含題目）、`sub-q1`（中譯英排隊中）。
畫面上沒有任何官方參考譯文、評分原則全文或佳作（D8）；假資料的錯誤標註與修正版都是自己寫的。

## 路由與狀態（每種視窗一套，檔名就是圖名）

檔名：`<序號>-<路由>__<狀態>.png`，放在 `<輸出資料夾>/<視窗>/`。序號照導覽順序，方便並排瀏覽。帶參數的子頁用建置資料裡真的 id：
歷屆 `gsat-115`、本站仿真中譯英 `1d423d`（學吉他）、本站仿真作文 `0e89ae`（午餐時間的學生餐廳，附圖）、
題庫練習 6 種題型各一個難度、模擬考 `gsat-115`。

| 圖名 | 網址 | 狀態 |
| --- | --- | --- |
| `01-home__anon` / `__student` / `__anon-dark` | `/` | 沒登入（學習進度沒有紀錄）／已核准學生／深色 |
| `01-home__records` | `/` | 學習進度有紀錄（每日學習 1 張、題庫練習 1 組；`records__flow`） |
| `01-home__theme-toggled` | `/` | 按了主題切換（淺色 → 深色） |
| `01-home__more-sheet` | `/` | 手機「更多」面板打開（只有窄視窗；視窗截圖） |
| `01-home__account-menu` | `/` | 帳號選單打開（手機在頂端列、桌機在側邊欄；視窗截圖） |
| `02-words__library` / `__study` / `__quiz` / `__mistakes` | `/words?tab=…` | 單字四個分頁 |
| `02-words__word-card` | `/words?word=abandon\|v.\|4` | 單字卡 |
| `02-words__study-card` | `/words?tab=study` | 開始每日學習、翻開答案 |
| `02-words__quiz-question` | `/words?tab=quiz` | 開始測驗、第 1 題作答後的回饋 |
| `03-practice__menu` | `/practice` | 題型 × 難度選單（沒有紀錄） |
| `03-practice__menu-records` | `/practice` | 有紀錄（詞彙題穩定基礎已做 1 組；`records__flow`） |
| `04-vocabulary__section` … `09-mixed__section` | `/vocabulary`、`/cloze`、`/word-bank`、`/structure`、`/reading`、`/mixed` | 題型頁（頁首下面就是練習） |
| `04-vocabulary__focus-tier` | `/vocabulary` | 鍵盤聚焦在沒選中的難度切換上 |
| `08-reading__section-dark` | `/reading` | 深色（圖表配色） |
| `10-translation__anon` / `__student` | `/translation` | 中譯英題型頁 |
| `11-composition__anon` / `__student` | `/composition` | 英文作文題型頁 |
| `12-writing__anon` / `__student` | `/writing` | 寫作練習（學生的寫作紀錄：中譯英 4 筆） |
| `12-writing__student-history-empty` | `/writing` | 寫作紀錄沒有紀錄 |
| `12-writing__student-history-essay` | `/writing` | 寫作紀錄切到英文作文（含自訂題目的列） |
| `12-writing__student-history-more` | `/writing` | 寫作紀錄按「載入更多」之後（4 筆，還有下一頁） |
| `13-exams__list` | `/exams` | 歷屆試題列表（沒有紀錄） |
| `13-exams__list-records` | `/exams` | 有紀錄（115 學測已交卷、114 學測作答中；`records__flow`） |
| `13-exams__focus-filter` | `/exams` | 鍵盤聚焦在篩選膠囊「全部」上 |
| `14-mock__list` / `__list-completed` | `/mock` | 模擬考列表（沒有紀錄）／交卷後（已完成、作答紀錄） |
| `15-settings__anon` / `__student` | `/settings` | 設定 |
| `16-about`、`17-privacy`、`18-terms` | `/about`、`/privacy`、`/terms` | 靜態頁 |
| `19-account__anon` / `__student` | `/account` | 我的帳號 |
| `20-account-welcome__first-login` | `/account/welcome` | 首次登入的同意頁 |
| `21-ai-apply__not-applied` / `__approved` | `/ai/apply` | AI 申請表單／已核准 |
| `22-admin__admin` | `/admin` | 管理後台 |
| `23-writing-translation__list` | `/writing/translation` | 歷屆中譯英題目列表 |
| `24-writing-translation-ai__list` | `/writing/translation/ai` | 本站仿真中譯英列表 |
| `25-writing-translation-ai-code__anon` / `__student` / `__anon-revealed` | `/writing/translation/ai/1d423d` | 作答頁／已核准／看了 1 層提示、作答後對照參考譯文與自評 |
| `26-writing-translation-exam__anon` / `__student` | `/writing/translation/gsat-115` | 歷屆中譯英作答頁 |
| `26-writing-translation-exam__anon-self-check` | 同上 | 作答後打開自我檢核 |
| `26-writing-translation-exam__student-filled` | 同上 | 已核准、填好兩句（送出按鈕、額度） |
| `27-writing-essay__list` | `/writing/essay` | 歷屆作文題目列表 |
| `28-writing-essay-ai__list` | `/writing/essay/ai` | 本站仿真作文列表 |
| `29-writing-essay-ai-code__anon` / `__student` / `__anon-revealed` | `/writing/essay/ai/0e89ae` | 作答頁／已核准／寫完後對照評分規準與範文 |
| `30-writing-essay-custom__anon` / `__student` | `/writing/essay/custom` | 自訂題目作文 |
| `30-writing-essay-custom__student-prompt-filled` / `__student-writing` | 同上 | 填好題目（設成 2 段）／題目設定好、寫好作文 |
| `31-writing-essay-exam__anon` / `__student` | `/writing/essay/gsat-115` | 歷屆作文作答頁 |
| `31-writing-essay-exam__student-filled` / `__student-photo` | 同上 | 寫好作文／切到拍照上傳 |
| `31-writing-essay-exam__focus-submit` | 同上 | 寫好作文、鍵盤聚焦在「送出 AI 批改」 |
| `32-writing-submission__translation-graded` | `/writing/submissions/sub-t1` | 中譯英批改結果（錯誤加亮、修正版） |
| `32-writing-submission__bank-translation-graded` | `/writing/submissions/sub-b1` | 本站仿真中譯英批改結果 |
| `32-writing-submission__essay-graded` | `/writing/submissions/sub-e1` | 作文批改結果（四項分數） |
| `32-writing-submission__custom-essay-graded` | `/writing/submissions/sub-c1` | 自訂題目作文批改結果 |
| `32-writing-submission__translation-queued` | `/writing/submissions/sub-q1` | 排隊等待批改 |
| `33-exam-paper__start` | `/exams/gsat-115` | 開始作答前（模式選擇） |
| `33-exam-paper__practice-answered` | 同上 | 練習模式：第 1 題作答、第 35 題看答案（全國答對率） |
| `33-exam-paper__exam-midway` / `__exam-submitted` | 同上 | 考試模式：作答 3 題（含綜合測驗、文意選填空格）／交卷後 |
| `34-mock-session__start-screen` | `/mock/gsat-115` | 開考前（預估分數、實考模式） |
| `34-mock-session__in-progress` | 同上 | 作答 2 題、標記 1 題 |
| `34-mock-session__word-bank-section` / `__reading-section` | 同上 | 切到文意選填（填 1 格）／閱讀大題 |
| `34-mock-session__submit-dialog` | 同上 | 交卷確認對話框（視窗截圖） |
| `34-mock-report__report` / `__review` | `/mock/report/<id>` | 成績單（級分、五標）／展開檢討試卷 |
| `35-practice-session__<題型>-<難度>` | `/practice/{vocabulary/basic, cloze/advanced, word-bank/advanced, structure/top, reading/basic, mixed/basic}` | 剛進來 |
| `35-practice-session__reading-basic-midway` / `-submitted` | `/practice/reading/basic` | 作答 2 題／交卷後（解析卡） |
| `35-practice-session__vocabulary-basic-midway` | `/practice/vocabulary/basic` | 作答 4 題 |
| `35-practice-session__word-bank-advanced-midway` / `-submitted` | `/practice/word-bank/advanced` | 填 3 格＋第 4 格選項面板打開／交卷後 |
| `35-practice-session__structure-top-midway` | `/practice/structure/top` | 填 2 格 |
| `35-practice-session__mixed-basic-submitted` | `/practice/mixed/basic` | 交卷後 |
| `36-not-found` | `/no-such-page` | 找不到頁面 |

每種窄視窗 102 張、桌機 101 張（「更多」面板只有窄視窗），12 種視窗共 1,215 張（Playwright 顯示 1,080 個測試，
桌機的「更多」面板是略過；流程測試一次截好幾張）。

設計文件 §11.1 列的「開工前要補截的基準情境」中，PR A（殼層、首頁與列表）的部分都在上表：帳號選單、主題切換、
學習進度／寫作紀錄／歷屆試題列表／模擬考列表／題庫練習選單的有無紀錄、寫作紀錄「載入更多」之後、難度切換／篩選膠囊／送出按鈕的鍵盤聚焦。
PR B、PR C 開工前照同樣的方式在 `capture.shots.ts` 補上自己的情境，再用「4. 增加截圖情境之後補截基準」補截。

## 確定性

連跑兩次必須逐像素相同，基準才有意義。腳本做了這些事：

- **時間固定**在 2026-10-18 10:00（台灣時間），`page.clock.setFixedTime`（計時器照常跑）；假後端的時間戳也從這個時間推算。
- **Math.random 固定回傳 0.5**（不是固定種子的數列：react-router 每次換頁都會呼叫它，呼叫次數隨載入時序變動，用數列時同一個網址兩次
  抽到不同題組；改版後的程式多呼叫幾次也會讓抽題改變）。題庫練習抽第 `floor(0.5 × 組數)` 組，單字測驗的種子固定。
  `crypto.randomUUID` 回傳遞增的假 UUID（模擬考成績單網址固定為 `/mock/report/00000000-0000-4000-8000-000000000001`）。
- **關掉動畫與轉場**（注入 CSS＋`animations: 'disabled'`），隱藏游標，滑鼠移到 (0, 0)。
- 截圖前等：`networkidle`、「載入中…」消失、`document.fonts.ready`、所有圖片載入（lazy 圖片改成 eager）、兩個 animation frame；
  整頁截圖前捲回頂端。
- **連續兩次截到一模一樣才存檔**（最多試 5 次，`_meta` 的 `stable` 欄位記錄有沒有穩定）。
- 作答步驟都確認真的記下來了（工具列的「已答 n／總題數」、空格變成「已填」）才截圖：太早作答會被之後的初始化蓋掉（實測發生過）。
- 鍵盤聚焦的圖先用程式聚焦、再按 Shift+Tab、Tab 回到目標，並確認 `:focus-visible` 成立（只呼叫 `focus()` 時要不要畫焦點框取決於之前的互動）。
- Chromium 加 `--disable-gpu --disable-gpu-rasterization --disable-partial-raster --disable-skia-runtime-opts --disable-lcd-text
  --force-color-profile=srgb`：不加的話陰影、反鋸齒在兩次執行之間會差 1 個色階。
- 伺服器是 `vite preview --outDir <指定的建置產物>`，`reuseExistingServer: false`、`--strictPort`：連接埠被佔用就失敗，
  不會截到別的工作目錄的伺服器。

## 整頁截圖的注意事項

- Chromium 的整頁截圖裡，`position: fixed` 的元素只畫在**第一個視窗高度**內：手機的底部導覽列出現在第 1 屏底部（例如 375x812 的
  y≈760），不在整張圖的最底下；桌機的側邊欄只畫到第 1 屏的高度，下面是空白。這是截圖方式造成的，不是版面錯誤；
  兩次截圖都一樣，不影響比對。整張圖最上面一個視窗高度的部分，就是使用者打開頁面時看到的畫面。
- **桌機（≥ 1024 寬）的整頁圖不用 Playwright 的 `fullPage`**：Chromium 截超出視窗的範圍時會暫時把視窗縮成 1×1，
  `(min-width: 64rem)` 先變 false 再變 true，頁面換到手機的樹再換回來，切到的分頁、展開的狀態都被重設、API 重打一次
  （實測：寫作紀錄切到「英文作文」，截出來卻是「中譯英」）。改成先把側邊欄固定成原本的視窗高、把視窗拉高到整頁的高度、
  截一般的視窗圖，再改回原本的大小（寬度不變，媒體查詢與 main 的寬度層級都不動）。畫面和整頁截圖相同：側邊欄只到第 1 屏的高度。
  手機與平板照舊用 `fullPage`（基準就是這樣截的）。
- 「更多」面板、帳號選單、交卷確認對話框截的是**視窗**（不是整頁）。
- 很長的頁面（歷屆試卷交卷後、模擬考檢討）在 320 寬會超過 6 萬像素高，PNG 一張 5–10 MB。

## manifest.json

每次截圖後寫在輸出資料夾：截圖時間、建置產物與它的來源（`dist_source`：從哪個 commit 建置、當時工作目錄有哪些改動、
`data/` 換成了哪一份）、資料版本（`data/meta.json`）、截圖工具所在 repo 的狀態、每個視窗幾張、截圖時頁面的 console error
（應該是 0 筆）。PR 說明附上 `compare.mjs` 的輸出、`manifest.json` 與重跑的指令。

## 增加截圖情境

在 `capture.shots.ts` 的 `STATIC` 表加一行（進頁面就截），或仿照檔案後面的流程測試寫一個 `test()`（先作答、打開面板再截）。
`setup()` 回傳的 `c.backend` 可以再用 `backend.on()` 覆寫假後端的回應（後登記的優先）。加完之後照「4. 增加截圖情境之後補截基準」補截基準，
再截改版後的版本比對。
