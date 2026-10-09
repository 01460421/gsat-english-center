# 模擬考與考試格式 PDF：設計

> 版本：2026-10-08（設計與前置工作完成，交給兩位開發者並行實作）。
> 需求（站主）：「模擬考也要能下載成考試格式的 pdf」；歷屆試題也提供同樣的下載。另依 SPEC §6.11 做模擬考模組，但**後端還沒部署**，所有功能都要以靜態前端完成。
> 相關文件：`docs/SPEC.md` §6.10、§6.11；`docs/ROADMAP.md` Phase 2 驗收第 7 項；`docs/research/02-gsat-english-spec.md`（格式、計分、級分）；`docs/research/04-data-sources-licensing.md`（授權）；`data/exams/gsat-spec.json`（級距、五標、級分人數）。
> 2026-10-09 合併 main（登入＋AI 批改、題庫練習）後的調整：後端已部署，但模擬考的非選擇題仍是自評，成績單在登入與 AI 開放時指向寫作練習的同一份考卷送 AI 批改（分數不帶回）；題號旁的「標記」改用 `features/exams/QuestionExtras.ts` 的 `renderHeadingAccessory`（和題庫練習共用同一個擴充點，原本的 `QuestionAccessoryContext` 已刪除）；級分對照的轉換與檢查移到 `apps/web/scripts/lib/score-scales.mjs`，型別契約併入 `scripts/lib/data-contract.mjs` 的 exams 部分；頁面判斷要不要顯示 PDF 下載一律用 `pdfDownloadVisible()`。
> 標記：「（實測）」＝本文件的 spike 在這個開發環境量到的數字；「（設計值）」＝上線後用資料或實機測試校正。

**目錄**：[0. 決策摘要](#0-決策摘要)｜[1. 範圍與限制](#1-範圍與限制)｜[2. PDF 技術選型](#2-pdf-技術選型spike)｜[3. 字型](#3-字型)｜[4. PDF 模組架構](#4-pdf-模組架構)｜[5. 版面規格](#5-版面規格對照-115-學測題本)｜[6. 模擬考模組](#6-模擬考模組)｜[7. 資料](#7-資料級分對照與建置檢查)｜[8. 檔案所有權](#8-檔案所有權兩位開發者不改同一個檔案)｜[9. 驗收清單](#9-驗收清單)｜[10. 風險與待決事項](#10-風險與待決事項)

---

## 0. 決策摘要

1. **真正的「下載 PDF」，在瀏覽器裡產生**（不是 `window.print()`）：用 **pdfmake 0.3.11**（MIT），在 Web Worker 裡排版，A4、文字可選取與搜尋、字型嵌入子集。只有按下按鈕才載入引擎與字型（gzip 約 0.35 MB＋1.5 MB），一般頁面的 JS 不變（實測）。
2. pdfmake 勝過 @react-pdf/renderer 與 pdf-lib：lazy chunk 最小（346 KB gzip）、整份 115 學測 14 頁在 Chromium 0.7 秒（4 倍 CPU 降速 3.3 秒）、66 份考卷全部排得出來、內建分頁控制（不跨頁區塊、標題不落單、頁首頁尾與總頁數）、文件定義是純資料可以單元測試。pdf-lib 子集化後中文字形消失（已知缺陷、套件 2022 年後沒有維護）；react-pdf 可行但大 25%（§2）。
3. **字型**：Noto Serif TC（細明體風格的中文）＋ Tinos（與 Times New Roman 等寬的英文，題本英文就是 Times）＋ Noto Emoji（112 學測混合題的表情符號），三者皆 OFL 1.1。中文子集＝試題資料出現的每個字＋介面文字＋教育部常用國字 4,808 字（4,989 字元）。**格式是 TrueType＋gzip**：pdfmake 嵌入字型需要原始 glyf 表，WOFF2 直接出錯、WOFF1 慢到 122 秒（實測）。
4. **防豆腐字**：`npm run build` 會檢查試題資料的每個字元都有字形，缺字就建置失敗（`apps/web/scripts/font-coverage.mjs`，零依賴，自己讀 cmap）。目前 66 份考卷 1,770 種字元全部涵蓋。
5. **版面照 115 學測題本的慣例重新排版**，不放大考中心的標誌與機構名稱標題；每頁頁尾印出處與「本 PDF 由學測英文中心依大考中心公開試題重新排版，非官方文件」。圖片只有文字描述，印成虛線框並指向官方 PDF。可選附「答題卷」（簡化的選擇題答案卡、混合題作答區、中譯英與作文格線）與「答案」頁（中譯英只印官方評分原則網址，作文不附範文）。
6. **模擬考**：111–115 學測＋115 參考試卷；100 分鐘以「期限」倒數（存在 localStorage，關掉分頁時間照走）、實考模式（60 分鐘內不能交卷）、一次顯示一個大題（順便分段計時）、題號面板與標記、未答提醒、每次作答立即存檔；交卷後成績單有原得總分、各大題得分與用時、級分（非官方，查當年官方對照表）、五標位置、贏過多少比例考生、全國期望得分、非選擇題自評。重用歷屆試題的題目元件，不另寫一套。
7. **前置工作已完成**（§8）：PDF 介面型別、字型與檢查、pdfmake＋Worker＋下載的整條管線（版面還是骨架，按鈕先藏起來）、級分資料 `/data/exams/score-scales.json`＋換算函式與 111–115 邊界測試、歷屆試題元件的三個擴充點、模擬考路由骨架。兩位開發者之後只改各自的目錄。

## 1. 範圍與限制

| 項目 | 決定 |
|---|---|
| 卷別 | PDF：66 份歷屆考卷都能下載（版面規則以現制 111–115 為主，舊制依資料形狀套用同一套規則）。模擬考：gsat-115、114、113、112、ref-115、gsat-111（依 SPEC，ref-115 排在 gsat-111 之前） |
| 後端 | 沒有。計時、作答、成績都存在瀏覽器（localStorage）；換裝置或清除網站資料就沒了，畫面要說清楚 |
| AI 批改 | 沒有。中譯英與作文只有自評（評分規準＋檢核） |
| 受保護內容 | 官方中譯英參考譯文、評分原則全文、作文佳作都不出現在 PDF 或畫面（D8、04 §4.3）；公開資料檔本來就沒有這些欄位，PDF 只用公開資料檔 |
| 商標 | 不用大考中心標誌；不把「財團法人大學入學考試中心基金會」當成封面標題；出處以說明性文字標示 |
| 裝置 | iOS Safari 16.4+、Android Chrome、桌機 Chrome／Edge／Firefox／Safari（SPEC §10「近兩年」）；手機 390 px 與 320 px 沒有水平捲動 |
| 不做 | OMR 機讀卡仿製、圖片重繪、伺服器端產生 PDF、紙本作答後拍照辨識 |

## 2. PDF 技術選型（spike）

### 2.1 方法

在 scratchpad 建了一個獨立專案，三個函式庫各做一份**同樣的樣本**：gsat-115 的部分標題與大題標題（中文）、詞彙題 1–3（一列四個選項）、文意選填整篇（行內帶題號的空格 `__21__`）與 (A)–(J) 選項框、閱讀 35–36（`<b>exacerbated the situation</b>`、2×2 選項）、ref-111 的 3×3 小表格。pdfmake 另外做了整份考卷的版本（封面、全部大題、圖片描述框、混合題、答案頁），並跑過 66 份考卷。量測：

- **bundle**：esbuild 0.25.10 `--minify` 後的 lazy chunk，再 `gzip -9`；pdfmake 另在本 repo 的 Vite 8 建置裡量一次。
- **產生時間**：Node 22.22（字型讀檔）與 headless Chromium 1194（字型以 gzip 下載後用 `DecompressionStream` 解壓），各量第一次與第二次；Chromium 另用 CDP 把 CPU 降速 4 倍模擬中階手機。
- **可選取文字**：`pdftotext` 取回 11 個探針字串（中文標題、`The mayor has such a ______ schedule`、`(J) point to`、空格題號、粗體片語、中譯英題目、非官方聲明…）。
- **字形涵蓋**：`pdffonts`（嵌入、子集、ToUnicode）、`pdftoppm` 轉圖目視檢查，以及對 66 份考卷逐字檢查 cmap。

### 2.2 結果（實測）

| | **pdfmake 0.3.11** | @react-pdf/renderer 4.9.0 | pdf-lib 1.17.1＋@pdf-lib/fontkit 1.1.1 |
|---|---|---|---|
| 發布 | 2026-06-12（0.3 系列 2026-01 起） | 2026-08-27 | 2022-05（之後無更新） |
| lazy chunk（min／gzip） | 1,029 KB／**363 KB**（Vite：971 KB／346 KB） | 1,249 KB／455 KB（含 React，在 App 內約少 50 KB） | 1,376 KB／550 KB |
| Node：整份 gsat-115（14 頁） | **690 ms**；66 份考卷各 186–607 ms，全部成功 | 樣本×4（12 頁）812 ms | 樣本 2 頁 729 ms |
| Chromium：整份 gsat-115 | 載入引擎 480 ms＋字型 118 ms＋第一次 **703 ms**（第二次 396 ms） | 樣本×4（12 頁）1,097 ms | 樣本 830 ms |
| Chromium，CPU 降速 4 倍 | 載入 1,858 ms＋字型 496 ms＋第一次 3,344 ms（第二次 2,115 ms） | — | — |
| Web Worker | 可（Worker 內 1.6 s 完成；主執行緒最長停頓 38 ms） | 需要 React reconciler，未測 | 可 |
| 中文子集嵌入 | 正常（CID TrueType、Identity-H、ToUnicode） | 正常（同一套 pdfkit） | **子集化後中文字形不顯示**（文字取得到、畫面空白）；不子集化則 2 頁 PDF 3.07 MB |
| pdftotext 回取 | 11/11 | 正常 | 文字正常、字形缺失 |
| 字型備援 | 沒有：要自己把文字依字元切成不同字型的片段（`fontRuns.ts`） | 有（`fontFamily` 陣列） | 沒有 |
| 版面能力 | 文字流、左右對齊、首行縮排、多欄、表格、不跨頁區塊、`pageBreakBefore` 回呼、頁首頁尾含總頁數、QR code | flexbox；首行縮排在測試中無效；`wrap={false}` | 全部要自己寫（斷行、中文斷字、對齊、分頁、表格） |
| PDF 大小 | gsat-115 全卷 240 KB | 12 頁 84 KB | 2 頁 120 KB |

字型格式另外測過：同一份 gsat-115 用 TTF 690 ms；**WOFF2 直接拋錯**（fontkit 的 WOFF2 字型沒有 `loca`，pdfkit 子集化時讀不到）；**WOFF1 要 121,887 ms**（fontkit 每取一個字形就重新解壓整個 glyf 表）。三個函式庫底層都用 fontkit，結論相同：**送進引擎的必須是 TTF**。

本 repo 內的整合驗證（實測）：Vite 建置＋`vite preview`＋Chromium，桌機與 Pixel 7 模擬各按一次「下載 PDF」，從點擊到下載完成 939 ms／968 ms，13 頁、四個字型都嵌入子集，主控台沒有錯誤、頁面沒有水平捲動。

### 2.3 決定與理由

選 **pdfmake**：

1. 最小的 lazy chunk，而且只在按下按鈕時載入；Worker 版另一個 chunk（Vite iife 格式，同樣只在使用時下載）。
2. 文件定義（document definition）是純資料：`buildExamDocDefinition(exam, options)` 是純函式，Vitest 可以直接檢查「第 38 題前面有圖片描述框」「答案頁沒有中譯英譯文」「每個中文字串都指定了中文字型」，不必真的產生 PDF。
3. 分頁控制剛好是題本需要的：`unbreakable`（題幹＋選項不拆）、`pageBreakBefore`（標題不落在頁尾）、`headlineLevel`、表格不拆列、頁首頁尾拿得到頁碼與總頁數。
4. 實測速度與穩定性：66 份考卷全部排得出來，沒有例外；整份考卷在中階手機等級約 3–6 秒（含第一次下載），可以接受。
5. 缺點與對策：沒有字型備援 → `fontRuns.ts` 依 `metrics.json` 的範圍把文字切段（已完成、有測試）；沒有官方 TypeScript 型別適合我們（`@types/pdfmake` 會把 Node 型別帶進瀏覽器程式碼）→ 自寫子集型別 `engine/docTypes.ts`。

不選 react-pdf：可行，但大 25%、要在 Worker 裡跑 React reconciler、首行縮排失效，而且 JSX 文件不如純資料好測。不選 pdf-lib：中文子集化壞掉，且所有排版都要自己寫。不採用 `window.print()`：站主要的是「下載成 PDF 檔」；iOS 的列印轉 PDF 步驟多、版面受瀏覽器影響、頁首頁尾無法控制。列印專用樣式（CSS `@page`）只作為 PDF 產生失敗時的退路，不另外維護。

## 3. 字型

### 3.1 選擇

| 用途 | 字型 | 理由 |
|---|---|---|
| 英文（題目、選項、選文） | **Tinos**（Regular、Bold、Italic） | 題本的英文是 Times New Roman；Tinos 與 Times New Roman 字寬相同（metric-compatible），換行位置接近原卷。Google Fonts 版本授權為 OFL 1.1 |
| 中文（標題、說明、中譯英題目、圖片描述） | **Noto Serif TC**（Regular、Bold） | 題本用細明體／新細明體（說明與標題是標楷體）；開源字型中最接近細明體、字集完整（教育部常用字全收）。OFL 1.1 |
| 表情符號 | **Noto Emoji**（單色） | 112 學測混合題的聊天室留言有 😄😠🤣😍。OFL 1.1 |

標楷體風格的標題字（例如 LXGW WenKai TC、全字庫正楷體）可以讓標題更像題本，但要多一套字型；先不放，列為之後的選項。

### 3.2 來源、版本、授權

全部從 Google Fonts 取得（GitHub 發行檔在開發環境的網路代理下載不到）：css2 API 以非瀏覽器 User-Agent 取得固定版本的 TTF 網址；授權依 `https://fonts.google.com/metadata/fonts/<family>` 皆為 `ofl`。網址、SHA-256、版本（Noto Serif TC 2.003-H1、Tinos 1.340、Noto Emoji 3.006）記在 `apps/web/src/features/pdf/fonts/README.md` 與 `apps/web/scripts/fonts/subset_fonts.py`；OFL 全文與版權聲明在同目錄的 `LICENSE-OFL.txt`；「關於」頁已列出三套字型與 pdfmake。

### 3.3 子集內容與大小

| 檔案 | 字元數 | TTF | gzip |
|---|---|---|---|
| NotoSerifTC-Regular | 4,989 | 2,251 KB | 1,379 KB |
| NotoSerifTC-Bold | 392 | 110 KB | 73 KB |
| Tinos-Regular／Bold／Italic | 各 363 | 各 25 KB | 各 16 KB |
| NotoEmoji-Regular | 127 | 64 KB | 36 KB |
| **合計** | | | **1.50 MB** |

- 中文 Regular：build-data 輸出的試題資料（66 份）每個字元 ∪ `apps/web/src/**/*.ts(x)` 的字元 ∪ 教育部常用國字 4,808 字（`scripts/fonts/moe-common-4808.txt`；字表取自 npm 套件 `chart-of-standard-forms-of-national-characters@0.0.0` 的 common.json（MIT），交叉檢查 4,808 字全部屬於 Big5 常用字區）∪ 常用全形標點與圈號數字。拉丁字母與表情符號交給 Tinos、Noto Emoji。
- 中文 Bold：只有標題用得到，收所有大題／部分標題的字、`scripts/fonts/bold-extra.txt`、PDF 固定文字檔（`layout/strings.ts`、`attribution.ts`）。粗體缺字時改用一般粗細的同一個字（`hasBoldGlyph`），不會變成方框；試題標題缺粗體字則建置失敗。
- 兩個粗細都收 4,808 字的話中文要 2.8 MB（gzip），粗體只收標題用字省下 1.3 MB。

### 3.4 對字型做的修改

子集化（fontTools 4.66.1；去 hinting、去 vhea／vmtx／BASE／STAT／DSIG、保留 kern／palt 或 kern／liga）；**所有字型的上下緣統一為 0.891／0.216 em、行距 0**（Times 的比例）。pdfmake 用字型的上下緣算行高，不統一的話含中文的行（Noto 原本 1.437 em）比純英文的行（1.107 em）高，同一段的行距忽大忽小；統一後 12 pt × 1.107 × 行高倍數 1.35 ＝ 17.9 pt，等於題本的 18 pt 行距。版本字串加上「subset for gsat-english-center PDF」，字型名稱不變。

### 3.5 傳輸：TTF＋gzip

字型放在 `src/features/pdf/fonts/*.subset.ttf.gz`，以 Vite 的 `?url` 匯入（建置後在 `/assets/`、檔名帶雜湊，沿用 vercel.json 的一年 immutable 快取），只有 `fonts.ts` 引用，而它只在產生 PDF 時才被動態載入。瀏覽器用 `DecompressionStream('gzip')` 解壓（Safari 16.4、Chrome 80、Firefox 113 起）；`fetchFontBytes` 先檢查 gzip 標記，主機若已用 `Content-Encoding` 解過壓也能直接用（Vercel 對 `.gz` 的處理要在 preview 部署再確認一次，§10）。不支援 `DecompressionStream` 的瀏覽器顯示「瀏覽器版本太舊」。gzip（1.50 MB）比 WOFF2（約 1.1 MB）大約三成，換來不必多帶 WOFF2 解碼器（§2.2 的實測）。

### 3.6 缺字檢查（建置時）

`apps/web/scripts/font-coverage.mjs`（Node 內建模組＋自寫 cmap format 4／12 解析，結果與 fontTools 一致）：

- build-data 每次產生資料後呼叫：試題資料的每個字串、每個字元，依 `metrics.json` 的範圍分到 Tinos／Noto Emoji／Noto Serif TC，該字型沒有字形就**建置失敗**，列出字元與考卷，並說明修法；大題／部分標題的中文還要在粗體子集裡；`layout/strings.ts`、`attribution.ts` 的中文要在中文子集裡（粗體缺字只警告）；`metrics.json` 的雜湊、範圍、粗體字集要和字型檔一致。
- 也可單獨執行：`npm run check:fonts -w @gsat/web`。
- 修法：`pip install fonttools==4.66.1` → `npm run build:data -w @gsat/web` → `python3 -I apps/web/scripts/fonts/subset_fonts.py --src /tmp/gsat-font-src --download`（下載固定版本並驗證雜湊）。只在開發機上跑；Vercel 建置不需要 Python。

## 4. PDF 模組架構

### 4.1 檔案

```
apps/web/src/features/pdf/
  types.ts               共用約定（兩位開發者都依賴；改動要同時通知）
  index.ts               輕量入口：PDF_DOWNLOAD_ENABLED、renderExamPdf（動態載入 engine）、pdfFileName、saveBlob
  ExamPdfDownload.tsx    「下載 PDF」區塊（勾選附答題卷／答案、進度、錯誤、取消）
  fontRuns.ts            字元 → 字型、文字切段、字寬估計（讀 fonts/metrics.json）
  fonts.ts               字型網址（?url）、下載＋gzip 解壓、pdfmake 字型表
  fonts/                 子集字型、metrics.json、LICENSE-OFL.txt、README.md
  engine/
    render.ts            主執行緒：建立／重用 Worker、傳遞進度、取消（終止 Worker）、無 Worker 時改在主執行緒產生
    pdf.worker.ts        Worker 入口
    generate.ts          載入 pdfmake＋字型 → buildExamDocDefinition → Blob
    pdfmakeApi.ts        pdfmake 載入與初始化（字型寫進 virtualfs、禁止 pdfmake 自行連網）
    pdfmake.d.ts         'pdfmake/build/pdfmake.js' 模組宣告
    docTypes.ts          文件定義的型別（本專案用到的子集）
    protocol.ts          Worker 訊息格式
  layout/
    buildDocDefinition.ts   考卷 → 文件定義（目前是骨架；PDF 開發者依 §5 重寫）
    richInline.ts           [[n]]／<u>／<b> → 行內片段（沿用 features/exams/richText.ts 的解析）
    attribution.ts          出處、非官方聲明、官方 PDF／評分原則網址
    strings.ts              PDF 上所有固定文字（字型檢查會掃描這個檔案）
```

### 4.2 共用約定（`types.ts`，已完成）

```ts
interface ExamPdfOptions {
  includeAnswerSheet: boolean;   // 附答題卷
  includeAnswerKey: boolean;     // 附答案頁
  mockMeta?: MockPdfMeta;        // 有值＝模擬考版封面
}
interface MockPdfMeta { title: string; paperLabel: string; durationMinutes: number; strict?: boolean; notices?: readonly string[] }
type RenderExamPdf = (exam: Exam, options: ExamPdfOptions & { onProgress?; signal? }) => Promise<Blob>;
class PdfError extends Error { kind: 'unsupported' | 'network' | 'render' | 'aborted' }
```

頁面只用 `ExamPdfDownload`（props：`exam`、`mockMeta?`、`defaultIncludeAnswerKey?`、`className?`）。只加選填欄位不算破壞相容；刪改欄位要兩邊一起改並更新本節。

### 4.3 產生流程

1. 按下「下載 PDF」→ `index.ts` 的 `renderExamPdf` 動態載入 `engine/render.ts`（約 1 KB）。
2. `render.ts` 建立模組 Worker（`new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' })`，Vite 建成獨立檔案），傳入考卷 JSON 與選項（函式與 AbortSignal 不傳）。
3. Worker：並行下載 pdfmake 與 6 個字型（進度：engine → fonts n/6 → layout）、寫進 pdfmake 的虛擬檔案系統（ArrayBuffer，不轉 base64）、`setUrlAccessPolicy(() => false)`、排版、回傳 Blob。
4. 主執行緒 `saveBlob(blob, pdfFileName(...))`：`<a download>`＋物件網址，60 秒後釋放。
5. Worker 保留（字型留在記憶體），同一頁第二次下載只要排版時間。取消＝終止 Worker（pdfmake 排版無法中斷），下次重建（字型有 HTTP 快取）。

### 4.4 下載與裝置

- `<a download>` 支援：桌機各瀏覽器、Android Chrome、iOS 13+ Safari（iOS 會先開預覽，所以物件網址延後釋放）。
- **iOS 加強（PDF 開發者實作）**：iOS 上若 `navigator.canShare({ files: [pdfFile] })` 為真，加一顆「分享／儲存到檔案」按鈕（Web Share API），比下載預覽更好找。
- **內嵌瀏覽器**（LINE、Instagram、Facebook）常擋下載：偵測 UA 時顯示「請點右上角，用 Safari／Chrome 開啟後再下載」；保留「在新分頁開啟 PDF」的退路（`window.open(blobUrl)`，要在使用者點擊時先開視窗）。
- 檔名：`學測英文中心_115學測英文_題本.pdf`、`學測英文中心_模擬考_115學測英文_含答案.pdf`。注意：POSIX 語系的無頭 Chromium 會把非 ASCII 檔名改成 `download`（實測，`LANG=C.UTF-8` 時正常；CI 的 ubuntu 預設是 UTF-8）。e2e 測試請在 UTF-8 語系下執行，或只檢查副檔名。

### 4.5 「下載 PDF」區塊的畫面（已有骨架，PDF 開發者完成）

- 標題「下載考試格式 PDF」、一句說明（A4 題本格式、可列印計時作答、重新排版非官方、圖片以文字描述代替）。
- 兩個勾選：「附答題卷」（預設勾）、「附答案（放在最後）」（歷屆試題開始前與模擬考開考前預設不勾；交卷後預設勾）。
- 按鈕「下載 PDF」；產生中變成「產生中…」並顯示進度文字（`role="status"`、`aria-live="polite"`）與「取消」；完成顯示「已下載。」；錯誤依 `PdfError.kind` 顯示中文說明與「再試一次」。
- 第一次下載提示「第一次需要下載約 2 MB 的字型與產生器」。觸控目標 ≥ 44 px；390 px 寬不換行溢出。
- 放置位置：歷屆試題作答頁的開始畫面（大題結構下方）與交卷結果下方（已接好）；模擬考的開考前畫面與成績單（模擬考開發者放）。
- `PDF_DOWNLOAD_ENABLED`（`index.ts`）目前是 `false`：§9 的 PDF 驗收全部通過後由 PDF 開發者改成 `true`。

### 4.6 測試策略

- 單元（Vitest）：`buildExamDocDefinition` 的結構（每種大題、圖片框位置、答案頁內容、沒有官方譯文欄位、每個含中文的片段都用 `NotoSerifTC`、粗體缺字退回一般）；選項排列規則（§5.5）的判斷函式；`fontRuns`、`richInline`（已有）。
- 整份產生（Node 腳本或 Vitest 的 node 環境）：66 份考卷都能產生、不拋錯；可選在 CI 外手動跑 `pdftotext` 抽查。
- e2e（`tests/pdf.spec.ts`，PDF 開發者新增）：`/exams/gsat-115` 按下載 → `waitForEvent('download')` → 檔案以 `%PDF-` 開頭、頁數 ≥ 12；手機專案也跑；按鈕區塊沒有水平捲動。

## 5. 版面規格（對照 115 學測題本）

依據：`data/raw/ceec/gsat/115/paper-1.pdf`（12 頁，A4）與答題卷 `other-1.pdf`（A3 兩頁），另對照 111 學測與 110 指考題本。題本量測值以 pt 表示（`pdftotext -bbox`）。

### 5.1 頁面與字級

| 項目 | 題本 | 本站 |
|---|---|---|
| 紙張 | A4 595.3 × 842.0 | A4 595.28 × 841.89 |
| 版心 | 左 63.8、右緣 532（右邊界 63.4）；內文頂端約 92 | 邊界 左 64、右 63、上 78（頁首在 36）、下 62 |
| 英文內文 | Times New Roman 12 pt，行距 18 pt | Tinos 12 pt，`lineHeight` 1.35（＝17.9 pt） |
| 中文 | 標題、說明：標楷體；封面：細明體 | Noto Serif TC（標題用 Bold） |
| 部分／大題標題 | 13 pt 粗體、字距加寬 | 13 pt Bold，**只有中文片段**加 `characterSpacing: 3`（數字不加，避免「6 2 分」） |
| 說明框 | 11 pt，細框滿版 | 11 pt，0.8 pt 框，內距 上下 2、左右 4 |
| 題組標示 | 「第 11 至 15 題為題組」11 pt 加底線 | 同 |
| 選文 | 左右對齊、首行縮排約 2 字、段距約 4 pt | `alignment: 'justify'`、`leadingIndent: 24`、段距 4 |
| 題號 | 「1.」懸掛，題幹自 81.8 起（縮排 18） | 題號欄寬 18 pt，題幹與選項皆從 18 pt 起 |

### 5.2 頁首、頁尾、封面

- **頁首**（封面以外每頁）：外側兩行「第 N 頁／共 M 頁」，另一側兩行「115年學測／英文考科」，奇偶頁對調（題本第 1 頁：頁碼在左；第 2 頁：頁碼在右）。中間原本是灰底的「請記得在答題卷簽名欄位以正楷簽全名」，本站改印「學測英文中心重新排版・非官方」（9.5 pt）。頁碼 N 從封面後一頁起算 1（同題本）。參考試卷顯示「115參考試卷」，指考顯示「110年指考」。
- **頁尾**：頁碼「- N -」（題本位置：奇數頁在左、偶數頁在右），同一列小字（7.5 pt）印 `sourceLine(exam)`＋「｜」＋`NON_OFFICIAL_NOTICE`（`layout/attribution.ts`），例如「試題來源：大學入學考試中心 115 學年度學科能力測驗｜本 PDF 由學測英文中心依大考中心公開試題重新排版，非官方文件」。
- **封面**（不編頁碼）：
  1. 第一行：「學測英文中心　重新排版試題」（模擬考版：「學測英文中心　模擬考」＋卷別 `mockMeta.paperLabel`）。
  2. 「115學年度學科能力測驗」（取自 `exam.title` 去掉「英文考科」）。
  3. 大字「英文考科」（26 pt Bold）。
  4. 細框「－作答注意事項－」：考試時間（`exam.time_minutes`，模擬考用 `mockMeta.durationMinutes`）；作答方式（`PDF_TEXT.how`，改寫成本站流程：選擇題劃記在卷末答案卡或題本、非選擇題寫在答題卷、可到網站輸入答案計分）；選擇題計分方式（照抄題本封面的單選、多選規則，多選題寫成 (n−2k)/n；舊制卷沒有多選題時只印單選）。
  5. 模擬考版另印：考生欄位「姓名＿＿＿　日期＿＿＿　開始時間＿＿＿　結束時間＿＿＿」、實考模式說明（`strict`）、`notices`（ref-115 的沿用題說明）。
  6. 封面底部：出處、非官方聲明、「圖片以文字描述代替，原圖請見官方試題 PDF」、官方試題 PDF 網址（純文字）＋可選的 QR code（pdfmake `qr`，60 pt）。
  不印「財團法人大學入學考試中心基金會」標題、不印「請於考試開始鈴響起，在答題卷簽名欄位以正楷簽全名」。

### 5.3 部分與大題

- 部分標題「第壹部分、選擇題（占62分）」：`exam.parts[i]` 有 `title` 就用；沒有（gsat-113、114 沒有 parts；115 的 title 是 null）就用 `PDF_TEXT.partNames[i]`＋「、」＋`section.part`＋`（占{points}分）`，points 取 `parts[i].points`，沒有 parts 時把連續同 `section.part` 的大題配分加總。部分的 `instructions`（第參部分有）印成說明框。
- 混合題的大題標題本身就是「第貳部分、混合題（占10分）」（`section.title` 以「第」開頭）：不再另印部分標題，避免重複。
- 大題標題照印 `section.title`（題本原文）；說明框印 `section.instructions`（題本原文，逐字）。
- **第貳、第參部分各從新的一頁開始**（題本如此）；第壹部分內的大題接續排，但大題標題不能是頁面最後一個元素（§5.11）。

### 5.4 題號與空格

- 題號用 `question.label`：數字題印「1.」；混合題摘要填充 47–48 共用題幹時印「47-48」（同題本，用 `features/exams/paper.ts` 的 `clusterQuestions` 判斷）；中譯英印「1.」「2.」（label「中譯英1」→ `question.no`）；作文不印題號。
- 選文與題幹裡的 `[[n]]`：底線上置中印題號（`blankInline`：前後各兩個不換行空白、加底線，約 6 字寬），同題本「__11__」。
- `<u>`、`<b>` 照標記（`richInline`）；`refers_to` 不另外標示（題本靠粗體或底線，資料已有標記）。
- 題幹裡的中文說明（例如 49 題「請選出商店名稱前的英文大寫字母…」）照印，字型自動切換。

### 5.5 選項排列

依「最寬的選項」決定（`estimateTextWidth`，以「(A) 選項文字」計，12 pt）：

| 條件（可用寬度 W＝468 − 18 縮排） | 排法 | 題本例子 |
|---|---|---|
| 剛好 4 個選項，且最寬 ≤ W/4 − 8 | 一列四個（欄位起點 0、¼、½、¾） | 115 第 1–10 題、第 11–15 題 |
| 最寬 ≤ W/2 − 8 | 兩欄（2×2；6 個選項 2×3） | 115 第 17、20、36、44 題 |
| 其他 | 一個一行 | 115 第 35、37、39 題 |

- 綜合測驗（`groupLayout` 為 `cloze`）：選文之後依題號列出「11. (A) … (B) …」，題號在左、選項接在同一列（兩欄排法時第二列不印題號，對齊第一列）。
- 選項文字以「［圖］」開頭（圖片選項，如 115 第 38 題）一律一個一行，並在該題前放圖片描述框（§5.8）。
- 多選題（混合題 49）選項照上表排；題幹後面的「（多選題，4分）」照資料印。

### 5.6 文意選填與篇章結構

- 文意選填：選文照 §5.1；選文後放選項區，**細框（0.6 pt）**、5 欄 × 2 列（選項長時改 4、3、2 欄：最寬 ≤ (W − 12)/欄數 − 12）。題本自 111 起沒有框，本站加框是因為重新排版後選文與選項的距離不同，用框分隔較清楚（刻意的差異）。
- 篇章結構：選文中的 `[[31]]` 依 §5.4；選項 (A)–(E) 是整句，放在細框內一個一行。
- 選項區與選文最後一段綁在一起不跨頁（§5.11）。
- 舊制「句子配合題」（`bankBlanksInPassage` 為 false）：題幹逐題列出，選項庫放在題組最前面的框內。

### 5.7 閱讀測驗

- 題組標示 → 選文 → 題目（題本沒有把選文和題目並排，PDF 也不並排）。
- 多文本（`passage_parts`，例如 115 混合題 A–F 商店）：每一部分一個細框，框內第一行粗體印「A. Oh Eco」（`label`＋`title`），內文不縮排；部分框之間可以跨頁，單一框不拆。

### 5.8 圖片（只有文字描述）

資料裡的圖都是 `figures[]` 的文字描述（`kind`、`label`、`caption`、`description`、`rows?`、`question_no?`），沒有圖檔：

- **一般圖**：虛線框（0.8 pt，dash 3）：第一行粗體「［圖］{label 或 figureKindLabel(kind)}：{caption}」（10.5 pt），接著 `description`（10 pt、行高 1.25），最後一行灰色小字 `PDF_TEXT.figureNote`（「原圖請見大考中心官方試題 PDF（網址印在封面）；本卷以文字描述代替圖片」）。不在每個框都印長網址。
- **表格**（`rows` 有值）：「［表格］{caption}」＋真的表格（第一列粗體、0.6 pt 格線、10.5 pt）；表格不是圖片，不加「原圖請見」。待填格（`______`，`isBlankCell`）印成空白格＋底線。
- **位置**：`question_no` 有值 → 放在該題之前，與該題綁在一起不跨頁；沒有 → 放在選文之後、第一題之前（作文的圖放在「提示」之後）。
- 圖片描述框不拆頁；超過半頁的描述（少見）允許在段落間斷開。

### 5.9 混合題與非選擇題題目

- 混合題：多文本照 §5.7；47–48 共用題幹一次印完（題號「47-48」，中文說明在前、摘要句在後，空格照 §5.4）；49 照 §5.5；50 的簡答在題本有一條作答線，PDF 題本中也印一條 0.5 pt 線（作答仍以答題卷為準）。
- 中譯英：說明框之後逐題「1. 中文句子」（中文 12 pt）。
- 英文作文：說明框之後印「提示：」與 `stem`（懸掛縮排），再放圖片描述框。題本的作文頁只有題目，作答在答題卷。

### 5.10 答題卷（`includeAnswerSheet`）與答案頁（`includeAnswerKey`）

答題卷接在題本之後、從新的一頁開始，標題「答題卷」，每頁照樣有頁首頁尾。**不仿製機讀卡**（沒有紅色框、定位黑塊、條碼、考生號碼欄）。

1. **選擇題答案卡**（`PDF_TEXT.choiceCardTitle`）：所有自動計分題（單選、選項庫、多選）依題號排三欄（1–20、21–40、41–）；每列「題號＋選項框」，選項框是寬 14、高 9 pt 的圓角矩形（0.6 pt），字母印在框內（Tinos 7 pt）；選項數依該題資料（詞彙／綜合／閱讀 A–D、文意選填 A–J、篇章 A–E、多選依 `options`）。下方小字 `choiceCardNote`。
2. **混合題作答區**：47、48（填充）各一格附一條書寫線；49 多選印選項框；50 簡答一條線；摘要填充題號照資料（111 是 47A、47B、48、49）。
3. **中譯英**：每題「1.」加 3 條書寫線（行距 28 pt）。
4. **英文作文**：從新的一頁開始，兩頁格線（每頁 24 行、行距 28 pt、0.4 pt 灰線），左側每 5 行印行號（5、10、15…），第 12 行右側印淡色提示「約 120 個單詞（每行約 10 字）」（`compositionGuide`）。
5. 舊制卷依資料調整：沒有混合題就不印第 2 項；翻譯題數依資料（例如 gsat-85 的 5 句短譯）；簡答、句子配合等其他非選擇題每題 2 條線。

答案頁（新的一頁，標題「答案」）：

- 選擇題：依大題分組，每列 10 題「1 B　2 C　…」；可選在每個答案下以 7 pt 印「全國答對率 57%」（有 `stats.correct_rate` 才印）。送分題印「送分」；官方公告多個答案皆給分的印全部（`acceptedLetters`）。下方小字 `answerKeyChoiceNote`。
- 混合題：「47. innovation」「49. ADE」「50. one of a kind」；有 `accepted_answers` 時加「（亦可：…）」；附 `answerKeyMixedNote`。
- 中譯英：「官方參考譯文見大考中心評分原則：」＋評分原則網址（`officialScoringUrl`）。**不印任何譯文**。
- 作文：`compositionAnswer`（不提供範文）。
- 答案頁也有頁尾出處。

### 5.11 分頁規則

| 規則 | pdfmake 做法 |
|---|---|
| 第貳、第參部分、答題卷、作文格線、答案頁從新頁開始 | `pageBreak: 'before'` |
| 部分／大題標題、說明框、題組標示不能是頁面最後一個元素；標題下方至少要放得下說明框＋第一段選文 3 行（或第一題） | 標題節點設 `headlineLevel`，`pageBreakBefore` 回呼：`headlineLevel` 節點後同頁沒有其他節點，或離頁底不足約 110 pt 時換頁 |
| 一題（題號＋題幹＋選項）不拆 | 該題 `stack` 設 `unbreakable` |
| 短選文（估計 ≤ 14 行，約 1,200 字元）連同題組標示與第一題不拆 | 三者包成一個 `unbreakable` 的 `stack`（總高度超過 3/4 頁時改用下一條） |
| 長選文可以跨頁，但題組標示＋第一段至少 3 行要在同一頁 | 題組標示與第一段包成 `unbreakable`；其餘段落各自一個節點（段落內 pdfmake 會自動斷行換頁） |
| 綜合測驗的選項列表（5 題）盡量不拆 | 估計 ≤ 10 行時整組 `unbreakable` |
| 文意選填／篇章結構的選項框與選文最後一段綁在一起 | `stack: [最後一段, 選項框]` 設 `unbreakable` |
| 圖片描述框不拆；有 `question_no` 時與該題綁在一起 | `unbreakable` |
| 多文本的每一個部分框不拆，部分之間可以斷 | 每個框 `unbreakable` |
| 作文：說明框＋提示＋圖片描述框盡量同頁 | 估計高度 ≤ 3/4 頁時包成 `unbreakable` |

注意：`unbreakable` 的內容高於一頁時 pdfmake 會硬切，所以包成不拆的區塊前要用估計高度設上限（估計法：字元數 ÷ 每行字元數（英文約 85、中文約 38）× 行高）。

### 5.12 與題本刻意不同之處（給站主確認）

1. 文意選填、篇章結構的選項加細框（§5.6）。
2. 圖片改成文字描述框（沒有圖檔；第三方圖片也可能有著作權）。
3. 封面不印大考中心機構名稱標題與簽名指示，改印本站名稱與「重新排版、非官方」。
4. 答題卷是 A4 簡化版，不是 A3 卷卡合一的機讀格式。
5. 斜體：題本把 dim sum、dakshina 等外來語排成斜體，資料沒有斜體標記，PDF 印正體。

## 6. 模擬考模組

### 6.1 路由與畫面

| 路由 | 檔案 | 內容 |
|---|---|---|
| `/mock` | `pages/MockExamPage.tsx` | 卷別列表（`MOCK_PAPERS` 順序）：每份顯示狀態（未作答／作答中，剩 mm:ss／已完成 N 次，最近一次 X 分、Y 級分）、「開始」或「繼續」、最近成績單連結；節奏建議（考前 8 週每 2 週一份、最後 2 週每週一份）；現行配分表（沿用現有內容）；聲明 |
| `/mock/:paperId` | `features/mock/MockSessionPage.tsx` | 開考前 → 作答中 → 交卷（完成後 `replace` 到成績單） |
| `/mock/report/:attemptId` | `features/mock/MockReportPage.tsx` | 成績單＋自評＋檢討試卷 |

路由與骨架頁已建立（`App.tsx`），`papers.ts` 已有卷別清單。完成後把 `modules.ts` 裡 `/mock` 的 `status` 改成 `'ready'`。

### 6.2 開考前

- 卷別資訊：題數、配分、作答時間 100 分鐘、大題結構與建議時間（§6.4）。
- **ref-115 警示**：`reuseNotice` 一律顯示；另外計算「本卷 N 題你在 gsat-111 做過」：讀本機紀錄（歷屆試題 `gsat-exam-attempt:v1:{examId}` 有作答或已交卷、模擬考歷史有該卷），依每題的 `reused_from.exam` 分組計數，例如「本卷有 30 題來自 111 學測，你在這台裝置做過 111 學測」。建議先做 ref-115 再做 gsat-111。
- **預估分數**：「你覺得這次會考幾分？（0–100）」整數輸入，必填但可按「略過」（記為 null）。存進紀錄，成績單對照。
- **實考模式**（預設關）：說明「開考後 60 分鐘內不能交卷，比照正式考試入場後 60 分鐘內不得離場」。
- 說明：計時以期限計算、關掉分頁時間照走；作答存在這台裝置；考試模式不提供答案與提示。
- 「下載 PDF」區塊（`ExamPdfDownload`，`mockMeta` 帶卷別、100 分鐘、實考模式、ref-115 提醒；附答案預設不勾），讓學生可以改做紙本。
- 「開始作答」→ 建立紀錄（§6.5）→ 進入作答。

### 6.3 作答中

- **工具列**（sticky，沿用 `ExamToolbar` 的版面但自己寫 `MockToolbar`）：剩餘時間（期限倒數；`role="timer"`、剩 10／5／1 分鐘時 `aria-live` 提醒；剩 5 分鐘變紅）、模式（考試／實考）、已答 n／53、已標記 m、「交卷」。實考模式前 60 分鐘交卷鈕停用並說明「開考 60 分鐘後才能交卷（還要 mm:ss）」。
- **一次顯示一個大題**：`<ExamPaper sectionIds={[current]} />`（已加的擴充點）。大題導覽列：八個大題按鈕，各顯示已答／題數與標記數；頁面底部「上一大題」「下一大題」。理由：對應翻題本的節奏，也讓「每個大題的用時」可以量（目前顯示的大題才計時）。
- **題號面板**（展開／收合）：所有題號的方格，已答實心、未答空心、標記加旗號，目前大題外框加粗；點題號 → 切到該大題並捲到 `#q-{label}`（文意選填、篇章結構的題號捲到題組）。
- **標記**：題號旁的「標記」切換按鈕（`QuestionExtras` 的 `renderHeadingAccessory`；`aria-pressed`）；文意選填、篇章結構的空格沒有題號標題，從題號面板標記。
- **練習輔助全關**：AttemptState 的 `mode` 用 `'exam'`，題目元件就不顯示「看答案」與全國統計；之後的點字查詞、提示也要看 `mode` 關閉（SPEC §4.1、§6.11）。
- **存檔**：`AttemptStore` 每次改答案就寫 localStorage（比 SPEC 要求的「每 30 秒」更即時）；另外每 30 秒、`visibilitychange`（hidden）與 `pagehide` 時寫入計時與目前大題。無法儲存時沿用歷屆試題頁的提示。
- **多分頁**：監聽 `storage` 事件，同一份紀錄在別的分頁被改時，這個分頁顯示「這份模擬考在另一個分頁作答中」並改成唯讀。接續作答與「改在這個分頁作答」時另外寫 `gsat-mock:v1:claim:{attemptId}`（分頁代號＋時間，每次都不同）：只重寫一模一樣的紀錄不會觸發別的分頁的 `storage` 事件，最後打開的分頁就不一定優先。交卷、放棄時刪除這個鍵。
- **存不進 localStorage**（無痕模式、空間滿）：開考前就提示；交卷時紀錄也放進路由的 `state`，成績單讀不到 localStorage 時用它顯示，並提醒離開這一頁就找不到、可以先下載含答案的 PDF 或截圖。
- **交卷確認**：列出未作答的題號（依大題）與已標記的題號，可以點題號回去；「確定交卷」「繼續作答」。時間到自動交卷（`submitReason: 'timeout'`）；開啟頁面時已超過期限 → 直接以存檔內容交卷（`'expired'`），成績單註明「已超過作答時間，以最後存檔的作答計分」。

### 6.4 計時

- `deadlineAt = startedAt + 100 分鐘`（牆鐘時間），剩餘＝`deadlineAt − Date.now()`。關閉分頁、手機休眠時間照走（SPEC：伺服器記期限；後端上線前由瀏覽器記）。改裝置時間可以作弊——練習用途可接受，畫面不宣稱「防作弊」。
- 各大題用時：頁面可見時每秒把 1 秒記到目前大題（`sectionTimeSec[sectionId]`）；離開頁面的時間另計為「離開頁面」。成績單對照建議時間（02 §6.2，設計值）：詞彙 7、綜合 9、文意選填 9、篇章 7、閱讀 25、混合題 10、中譯英 8、作文 25 分鐘。

### 6.5 儲存格式（localStorage，鍵前綴 `gsat-mock:v1:`）

```ts
// gsat-mock:v1:attempt:{attemptId}
interface MockAttemptRecord {
  v: 1;
  id: string;                    // crypto.randomUUID()
  paperId: string;               // examId，例如 'gsat-115'
  strict: boolean;               // 實考模式
  predictedScore: number | null;
  startedAt: string; deadlineAt: string; durationSec: 6000;
  status: 'in_progress' | 'submitted';
  submittedAt: string | null;
  submitReason: 'manual' | 'timeout' | 'expired' | null;
  activeSectionId: string;
  sectionTimeSec: Record<string, number>;
  awaySec: number;               // 離開頁面的秒數
  marked: string[];              // 題號
  selfScores: Record<string, number>;     // 混合題非選擇、中譯英、作文的自評分數（題號 → 分）
  selfDetail: Record<string, unknown>;    // 自評的勾選內容（作文四項、中譯英錯誤數…），格式由模擬考開發者定
  scaleYear: number;             // 成績單選的對照年度
  attempt: AttemptState;         // 沿用歷屆試題的作答狀態（answers、mode: 'exam'、timeLimitSec: 6000…）
}
// gsat-mock:v1:active:{paperId}  → 作答中的 attemptId
// gsat-mock:v1:history           → [{ id, paperId, submittedAt, raw, level, scaleYear, predictedScore }]（新到舊，最多 30 筆；超過時刪最舊的完整紀錄）
```

- 作答由 `AttemptStore` 管理，存放位置用新的 `AttemptPersistence` 參數換成模擬考的鍵（已加的擴充點：`new AttemptStore(state, persisted, persistence)`、`AttemptStore.start(examId, 'exam', 6000, persistence)`）；`persistence.save` 讀出紀錄、換掉 `attempt`、寫回。讀回時用 `parseAttempt(raw.attempt, examId)` 驗證。
- 同一份考卷在歷屆試題與模擬考的作答互不影響（不同的鍵）。
- 每筆約 5–15 KB（作文最多）；30 筆遠低於 localStorage 上限。寫入失敗（無痕、空間滿）照常作答，只提示無法續作。

### 6.6 計分

| 題型 | 規則 | 實作 |
|---|---|---|
| 單選、選項庫、多選 | 沿用 `scoreQuestion`（多選 (n−2k)/n） | `features/exams/scoring.ts` |
| 混合題填充、簡答 | 正規化（去頭尾空白、壓縮空白、彎引號換直引號、句尾句點不計、❶–❼ 視同 1–7；簡答不計大小寫，填充要大小寫相同——115 官方閱卷把句中的 Blended 算字形錯誤、扣一半，所以只差大小寫時交給自評、預選一半）後等於官方答案或 `accepted_answers` → 自動給滿分；空白 → 0；填充寫了兩個字以上 → 0（SPEC §4.6 設計值）；其他 → **自評**：顯示官方答案、可接受答案與 2／1／0 原則（自己的話：完全正確 2 分；選對字但字形或拼字有誤 1 分；錯誤或空白 0 分），長度 ≥ 5 且與答案編輯距離 ≤ 2 時預選 1 分並註明「可能是拼字錯誤」 | 模擬考開發者寫 `features/mock/scoreOpen.ts`＋測資（115 第 47–50 題：innovative、blending → 1；is one of a kind → 0） |
| 中譯英（每題 4 分） | 自評：不顯示官方譯文；列出檢核（時態、主詞動詞一致、冠詞、單複數、用字、漏譯），學生填「錯誤處數」，每處 −0.5；句首未大寫或標點不妥 −0.5、只扣一次（程式先判斷句首大寫與句尾標點，預先勾選）；最低 0。附官方評分原則網址 | `features/mock/` |
| 英文作文（20 分） | 自評四項（內容、組織、文法句構、字彙拼字）各 0–5，每項旁用本站自己的話描述優（5–4）、可（3）、差（2–1）、劣（0），**不轉載官方評分指標表全文**；程式判斷字數（`countWords`）與段數（`countParagraphs`）：少於 100 字或未分段扣 1，兩者都有只扣 1，少於 120 字提醒；勾「離題」則其他各項 0 | `features/mock/` |

- 原得總分＝自動計分＋已自評分數。還沒自評完時，成績單頂端提示「非選擇題尚未自評，總分與級分暫不含 N 分」，自評完成後即時更新並寫回歷史。
- **ref-115「扣掉做過的題」**：把 `reused_from.exam` 屬於本機做過的考卷的題目從得分與滿分扣掉，另列一行「扣掉做過的 N 題：X／Y 分」。

### 6.7 成績單

1. 標題列：卷別、日期、模式、用時（含離開頁面）、交卷原因。
2. **原得總分** X／100（自動計分 a＋自評 b），預估對照「你預估 70 分，實得 64 分（−6）」。
3. **級分（非官方）**：`rawToLevel(X, scaleForYear(scales, scaleYear))`；對照年度預設為該卷年度（ref-115 → 115），可切換 111–115（`<select>`）；顯示所用級距與那一列官方範圍（「115 學年度：60.97 < X ≤ 67.07 → 11 級分」）與下一級分門檻（上界＋0.01）。
4. **五標**：0–15 級分的水平刻度，標出頂／前／均／後／底標與「你」（顏色＋文字，不只靠顏色）；文字「達前標（11 級分），離頂標（13 級分）還差 X 分原始分」（`highestStandardReached`）。
5. **贏過多少比例**：`percentBelowLevel`，「約贏過 84% 的到考考生（115 學年度英文，級分比你低的人數比例）」。資料來源一律在頁尾列出（`score-scales.json` 的 `sources`）。
6. **各大題表**：大題、得分／配分、答對題數、用時 vs 建議、**全國期望得分**、你 − 全國。全國期望得分＝Σ（每題 `stats.correct_rate` × 配分）；中譯英、作文用該大題的 `stats.score_distribution`（缺考列排除）算平均；混合題的填充、簡答沒有逐題統計，顯示「—」並加註；ref-115 沒有全國統計，整欄省略並說明「參考試卷沒有全國答題統計」。
7. **非選擇題自評**（§6.6），完成後總分與級分即時更新。
8. **聲明**（SPEC §6.11）：「模擬分數與級分僅供參考，不是官方級分；AI 批改分數不等於正式閱卷結果」，加註「目前非選擇題為自評分數」。
9. 動作：「檢討試卷」（在成績單下方用 `<ExamPaper />` 顯示已交卷狀態，題目元件會顯示答案、全國答對率與選項分布）、「下載含答案的 PDF」（`ExamPdfDownload`，附答案預設勾）、「再做一次」、「回模擬考列表」。

### 6.8 重用與不重用

重用：`AttemptStore`／`AttemptContext`／`useAttemptSelector`、`ExamContext`、`ExamPaper`（`sectionIds`）、`QuestionExtras`（`renderHeadingAccessory`）、`scoreExam`／`scoreQuestion`／`isAnswered`／`formatPoints`／`formatPercent`、`labels.ts`（`formatClock`、`formatDuration`、`countWords`、`countParagraphs`、`wordCountLabel`、`examIdLabel`）、`SectionStructure`、`ExamSourceNote`、`DataErrorBoundary`、`loadExam`、`loadScoreScales` 與換算函式、`ExamPdfDownload`。
不重用（模擬考自己寫）：`ExamToolbar`（暫停式計時）、`SetupPanel`、`ResultSummary`、`SectionNav`。

### 6.9 無障礙與手機

- 只用鍵盤可以完成開考、作答、標記、切換大題、交卷、自評。對話框（交卷確認）焦點移入、Esc 關閉、關閉後焦點回到觸發按鈕。
- 計時器每秒更新只在 `MockToolbar` 內重繪（同 `ExamToolbar` 的做法）；`aria-live` 只播報 10／5／1 分鐘提醒，不每秒播報。
- 390 px、375 px、320 px 寬沒有水平捲動；工具列在手機上不超過兩行；題號面板方格 ≥ 44 px 或以間距補足觸控範圍。

### 6.10 測試

- 單元：紀錄的讀寫與驗證（壞資料不採用）、期限計時（`vi.useFakeTimers`）、實考模式交卷限制、過期自動交卷、`scoreOpen` 測資、中譯英與作文自評計算、全國期望得分、ref-115 扣題計算、成績單級分／五標／百分比（用固定的 score-scales 測資）。
- 元件：開考 → 作答 → 重新掛載（模擬重新整理）接續 → 交卷 → 成績單。
- e2e（`tests/mock.spec.ts`）：gsat-115 開考、答 3 題、`page.reload()` 後答案與剩餘時間還在（ROADMAP 驗收第 7 項前半）、交卷、成績單有級分與「非官方」；手機專案沒有水平捲動。

## 7. 資料：級分對照與建置檢查

### 7.1 `/data/exams/score-scales.json`（已完成）

build-data 由 `data/exams/gsat-spec.json` 的 `grading.english_by_year`（111 起）產生，約 3.4 KB gzip：

```ts
interface ScoreScales {
  version: string; subject: 'english'; exam: 'gsat';
  note: string;                 // 出處與「非官方」說明
  default_year: number;         // 115
  mean_level_step: number;      // 五年平均級距 6.1576（本站計算）
  years: YearScale[];           // 115 → 111
}
interface YearScale {
  year: number; exam_date: string | null; examinees: number; level_step: number;
  levels: { level: number; min_exclusive: number | null; max_inclusive: number }[];   // 15 → 0
  five_standards: { name: '頂標' | '前標' | '均標' | '後標' | '底標'; percentile: 88 | 75 | 50 | 25 | 12; level: number; pct_at_or_above: number }[];
  distribution: { level: number; count: number; pct: number; cum_count_at_or_above: number; cum_pct_at_or_above: number }[];
  sources: { label: string; url: string }[];   // 大考中心統計檔
}
```

建置時的檢查（任何一項不符就建置失敗）：16 個級分首尾相接；1–14 級分上界＝round2(k × 級距)（官方換算公式，五年全部吻合）；15 級分上界 100；各級分人數加總＝到考人數、累計人數與累計百分比一致；五標的百分比等於累計表同級分的百分比。`check:data` 也會用 TypeScript 型別檢查這個檔案。

### 7.2 換算函式（`src/data/scoreScales.ts`，已完成）

- `roundRawScore(raw)`：取到小數第二位、第三位四捨五入（多選題部分分數加總後先取位）。
- `rawToLevel(raw, scale)`：0 分 0 級分；其餘找「下界 < X ≤ 上界」的那一列（查官方表，不用 ceil(X/L) 重算）。
- `percentBelowLevel(level, scale)`：級分比你低的到考考生百分比（同級分不算，保守）。
- `highestStandardReached(level, scale)`：達到的最高五標。
- `loadScoreScales()`、`scaleForYear()`。
- 測試 `scoreScales.test.ts`：111–115 每年 13 個邊界值（0、0.01、100，以及 1／2、5／6、7／8、10／11、14／15 級分交界的兩側）全部與官方對照表一致，另驗證每年每一列＝round2(k × 級距)、取位規則、五標與百分比——**ROADMAP Phase 2 驗收第 7 項的後半已完成**。

### 7.3 build-data 的其他變更

- 輸入多了 `data/exams/gsat-spec.json`（也加進 `vercel.json` 的 `ignoreCommand`，規格資料改了會重新部署）。
- `exams/` 底下 `index.json`、`score-scales.json` 以外才是考卷（`isExamFile`），官方譯文檢查與大小統計都改用它。
- 呼叫 `checkFontCoverage()`（§3.6）。

## 8. 檔案所有權（兩位開發者不改同一個檔案）

### 8.1 PDF 開發者

| 可以改 | 說明 |
|---|---|
| `apps/web/src/features/pdf/**`（**除了 `types.ts`**） | `layout/` 依 §5 重寫（可增檔）；`ExamPdfDownload.tsx` 內部（props 不變）；`index.ts` 的 `PDF_DOWNLOAD_ENABLED`（驗收通過後改 true）；`engine/`、`fonts.ts`、`fontRuns.ts` 視需要調整 |
| `apps/web/src/features/pdf/fonts/**`、`apps/web/scripts/fonts/**` | 重跑子集化（例如 `strings.ts` 加了新字）；換字型要更新 README 與授權 |
| `apps/web/scripts/font-coverage.mjs` | 只做維護（規則與 `fontRuns.ts` 一致） |
| `apps/web/tests/pdf.spec.ts`（新增） | e2e |
| `apps/web/src/pages/AboutPage.tsx` 的 pdfmake／字型兩筆致謝 | 只限這兩筆 |
| `apps/web/package.json`／`package-lock.json` | 只有 PDF 需要新套件時（例如 QR 以外的功能）；先在 PR 說明 |

### 8.2 模擬考開發者

| 可以改 | 說明 |
|---|---|
| `apps/web/src/features/mock/**` | 已有 `papers.ts`、`MockSessionPage.tsx`、`MockReportPage.tsx` 骨架；其餘新增 |
| `apps/web/src/pages/MockExamPage.tsx` | 改成卷別列表 |
| `apps/web/src/data/scoreScales.ts`（＋測試） | 只能**新增**函式（現有函式與型別不改） |
| `apps/web/src/modules.ts` | 只改 `/mock` 的 `status`（完成時 `'dev'` → `'ready'`） |
| `apps/web/tests/mock.spec.ts`（新增） | e2e |

### 8.3 已完成、兩人都不改（要改先協調，並寫在 PR 說明）

`apps/web/src/features/pdf/types.ts`（共用約定）、`apps/web/src/App.tsx`、`apps/web/src/modules.ts`（`/mock` 的 status 以外）、`apps/web/vite.config.ts`、`apps/web/scripts/build-data.mjs`、`apps/web/scripts/check-data-contract.mjs`、`apps/web/src/data/exams.ts`、`apps/web/src/features/exams/**`（`attempt.ts` 的 `AttemptPersistence`、`Paper.tsx` 的 `sectionIds`、`QuestionExtras.ts` 的 `renderHeadingAccessory`、`Questions.tsx` 的 `labels`、`ExamPaperPage.tsx` 的 PDF 區塊都已接好；只修 bug）、`vercel.json`、`docs/SPEC.md`、本文件。`data/**`、`docs/research/**`、`tools/**`、`packages/shared/**`、`.github/**` 屬於其他工作線，不改。

如果模擬考真的需要歷屆試題元件的新擴充點（例如題目元件要讀新的 context），由模擬考開發者提出、在同一個 PR 裡只改 `features/exams/` 的那一處並加測試，PDF 開發者不碰 `features/exams/`。

## 9. 驗收清單

### 9.1 PDF（全部通過才把 `PDF_DOWNLOAD_ENABLED` 改成 true）

| # | 類別 | 標準 |
|---|---|---|
| P1 | 必要 | 66 份考卷都能產生 PDF、不拋錯（Node 或 Vitest 腳本）；gsat-111～115、ref-115 的頁數合理（題本 10–14 頁＋答題卷 4 頁＋答案 1–2 頁） |
| P2 | 必要 | PDF 不含任何中譯英官方參考譯文：對每份考卷的 PDF 文字（或文件定義的所有字串）做與 build-data 相同的比對，命中 0；答案頁的中譯英只有評分原則網址 |
| P3 | 必要 | 每頁頁尾有出處與「本 PDF 由學測英文中心依大考中心公開試題重新排版，非官方文件」；封面有官方試題 PDF 網址；沒有大考中心標誌或機構名稱標題 |
| P4 | 必要 | 文字可選取：`pdftotext` 取回中文標題、英文題幹、空格題號、中譯英題目；字型都是嵌入的子集（`pdffonts`），沒有方框（目視 111–115 每一頁） |
| P5 | 必要 | 一般頁面的 JS 沒有變大：主程式 chunk 不含 pdfmake、字型網址只出現在 lazy chunk；第一次按下前不下載任何字型（Playwright 檢查網路請求） |
| P6 | 必要 | 版面符合 §5：選項排列規則、空格題號、圖片描述框位置、選項框、分頁規則（抽查 115 每一頁與 ast-110、gsat-93、ref-111 各兩頁） |
| P7 | 必要 | e2e：桌機與手機專案都能下載（`download` 事件、`%PDF-` 開頭）；下載區塊在 320 px 寬沒有水平捲動 |
| P8 | 必要 | 實機：iPhone Safari（iOS 16.4 以上）與 Android Chrome 各下載一次並用內建檢視器打開，記錄時間（設計值：首次 ≤ 8 秒、之後 ≤ 4 秒） |
| P9 | 體驗 | 產生中顯示進度、可取消；錯誤有中文說明與再試一次；iOS 有「分享／儲存到檔案」；內嵌瀏覽器有提示 |

### 9.2 模擬考

| # | 類別 | 標準 |
|---|---|---|
| M1 | 必要 | gsat-115 整份作答中途重新整理後可以接著做（答案、目前大題、標記、剩餘時間都在）；關掉分頁超過期限再打開會自動交卷（ROADMAP 第 7 項前半） |
| M2 | 必要 | 級分換算在 111–115 每年至少 10 個邊界值與官方對照表一致（`scoreScales.test.ts`，已完成；成績單用同一個函式） |
| M3 | 必要 | 實考模式前 60 分鐘不能交卷；時間到自動交卷 |
| M4 | 必要 | 成績單：原得總分、各大題得分與用時 vs 建議、級分（非官方）、五標位置、贏過比例、全國期望得分（ref-115 註明沒有）、SPEC 聲明、資料來源 |
| M5 | 必要 | 不顯示官方中譯英譯文、不轉載官方評分指標表全文；所有分數標「非官方」或「自評」 |
| M6 | 必要 | 考試模式沒有「看答案」與全國統計；交卷後的檢討才有 |
| M7 | 必要 | 每條路由在 1280、375、320 px 沒有水平捲動；只用鍵盤可以完成整個流程 |
| M8 | 體驗 | ref-115 的「本卷 N 題你做過」與「扣掉做過的題」得分 |
| M9 | 體驗 | 預估分數 vs 實得；多分頁唯讀保護 |

## 10. 風險與待決事項

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | iOS Safari 的 Blob 下載行為只能在實機確認（本環境只有 Chromium） | 學生在 iPhone 按了沒反應 | P8 實機驗收；`navigator.share` 分享檔案、新分頁開啟兩種退路；驗收前按鈕不上線 |
| R2 | 低階手機記憶體：Worker 內同時有 2.3 MB 的中文 TTF、pdfmake 與排版資料 | 分頁被系統重載 | Worker 只存一份字型；整份考卷一次產生（約 240 KB PDF）；實機記錄記憶體峰值；必要時把答題卷改成另一個檔案 |
| R3 | 內嵌瀏覽器（LINE、IG、FB）擋下載 | 從社群連結進來的學生下載失敗 | UA 偵測提示改用 Safari／Chrome；新分頁開啟退路 |
| R4 | pdfmake 沒有字型備援：任何沒經過 `fontRuns` 的字串（例如直接寫 `{ text: '答案' }`）會用 Tinos 畫中文 → 方框 | 版面上出現方框 | 文件定義的單元測試走訪所有字串，含中文卻不是 `NotoSerifTC` 就失敗；`defaultStyle.font` 維持 Tinos 只為英文 |
| R5 | 新的試題資料用到常用字以外的罕用字 → 建置失敗 | 資料工作線的 PR 卡住 | 錯誤訊息直接寫修法；子集化只需 Python 與 6 秒；粗體缺字只退回一般粗細不擋建置 |
| R6 | Vercel 對 `.gz` 檔的回應標頭（Content-Type、是否加 Content-Encoding）未在正式環境驗證 | 字型解壓失敗 | `fetchFontBytes` 已同時處理兩種情形；第一個 preview 部署時用 curl 確認，並在 P8 實機測試涵蓋 |
| R7 | 版面估計（選項寬度、選文行數）與實際排版有落差 | 偶爾出現孤立的標題或過早換頁 | 估計偏保守；P6 逐頁目視；之後可改成兩階段排版（先量測再分頁） |
| R8 | 只在瀏覽器計時：改裝置時間、清除資料都能繞過 | 模擬考時間不可靠 | 練習用途可接受，畫面不宣稱防作弊；後端上線後改由伺服器記期限（SPEC 原設計） |
| R9 | localStorage 被清除、無痕模式、換裝置 | 作答與成績消失 | 明確提示；開考前與成績單都說明「只存在這台裝置」；之後登入版同步到伺服器 |
| R10 | 非選擇題自評偏寬，級分偏高 | 學生高估自己 | 自評未完成時提示；級分標「非官方」；作文描述用具體檢核而不是形容詞；AI 批改上線後替換 |
| R11 | ref-115 的「做過原題」只看得到這台裝置的紀錄 | 低估重複接觸 | 一律顯示沿用題說明；扣題得分只是參考 |
| R12 | 其他工作線（登入＋AI 批改、AI 題庫）同時在改 `App.tsx`、`modules.ts` 等共用檔 | 合併衝突 | 本次對共用檔的修改都很小且已完成；兩位開發者不再動共用檔 |
| R13 | pdfmake 0.3 是 2026 年才推出的新大版號（0.2 的文件與範例不一定適用） | 實作時踩到 API 差異 | 版本鎖定 0.3.11；本 repo 已實測可用的 API（virtualfs 寫入 ArrayBuffer、`setUrlAccessPolicy`、`getBlob`、Worker）寫在 `engine/pdfmakeApi.ts` |
| R14 | 非 ASCII 檔名在 POSIX 語系的無頭 Chromium 會變成 `download` | 本機 e2e 誤判 | e2e 在 UTF-8 語系執行或只檢查副檔名（CI 預設 UTF-8） |

待站主決定（不影響開工，預設值已寫進設計）：

1. §5.12 的五項刻意差異是否接受（特別是選項加框、封面文字）。
2. 答案頁要不要印全國答對率（預設印）。
3. 標題要不要改用標楷體風格的開源字型（多 0.1–0.3 MB；預設不改）。
4. 模擬考的預估分數要不要強制填（預設必填但可略過）。
