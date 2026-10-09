# PDF 字型（子集）

下載的考試格式 PDF 用這些字型排版，並把用到的字形嵌入 PDF（文字可選取、搜尋）。
字型只在按下「下載 PDF」時才下載；Vite 會把檔案複製到 `/assets/`（檔名帶內容雜湊、一年 immutable 快取）。
設計理由見 `docs/design/mock-exam-pdf.md` §3。

| 檔案 | 用途 | 原始字型 | 版本 | 字元數 | TTF | gzip |
|---|---|---|---|---|---|---|
| `NotoSerifTC-Regular.subset.ttf.gz` | 中文內文、全形標點 | Noto Serif TC Regular | 2.003-H1 | 5,003 | 2,252 KB | 1,379 KB |
| `NotoSerifTC-Bold.subset.ttf.gz` | 中文標題 | Noto Serif TC Bold | 2.003-H1 | 404 | 115 KB | 76 KB |
| `Tinos-Regular.subset.ttf.gz` | 英文內文（與 Times New Roman 等寬） | Tinos Regular | 1.340 | 363 | 25 KB | 16 KB |
| `Tinos-Bold.subset.ttf.gz` | 英文粗體（題目的 `<b>`、標題裡的數字） | Tinos Bold | 1.340 | 363 | 25 KB | 16 KB |
| `Tinos-Italic.subset.ttf.gz` | 英文斜體（保留給書名、外來語） | Tinos Italic | 1.340 | 363 | 26 KB | 17 KB |
| `NotoEmoji-Regular.subset.ttf.gz` | 單色表情符號（112 學測混合題） | Noto Emoji | 3.006 | 127 | 64 KB | 36 KB |
| `metrics.json` | 實際涵蓋的字元範圍、Tinos 字寬表、粗體中文字集、各檔雜湊 | — | — | — | — | — |

合計約 **1.50 MB（gzip）**，另有 PDF 引擎 pdfmake 約 0.36 MB（gzip）。

## 授權

三套字型都是 **SIL Open Font License 1.1**（全文與版權聲明見 `LICENSE-OFL.txt`）。OFL 允許修改（子集化、調整度量）與隨網站散布；
不得單獨販售字型。「關於」頁的資料來源與授權致謝已列出這三套字型與 pdfmake（MIT）。

## 來源（固定版本）

從 Google Fonts 取得（`https://fonts.googleapis.com/css2?family=…` 以非瀏覽器 User-Agent 請求時回應的 TTF 網址；2026-10-08 下載，
授權欄位依 `https://fonts.google.com/metadata/fonts/<family>` 皆為 `ofl`）。網址與 SHA-256 同時寫在 `apps/web/scripts/fonts/subset_fonts.py` 的 `SOURCES`：

| 字型 | 網址 | SHA-256 |
|---|---|---|
| Noto Serif TC Regular | https://fonts.gstatic.com/s/notoseriftc/v37/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX9aMOpD.ttf | `2aa67c20b8cc8b929cc2ace9c0896cee033abbdfe11fe65306a5caede1cdc6ac` |
| Noto Serif TC Bold | https://fonts.gstatic.com/s/notoseriftc/v37/XLYzIZb5bJNDGYxLBibeHZ0BnHwmuanx8cUaGX-9N-pD.ttf | `3e2b71256bf380d8aaf7b7fee13aa7690b3f20326dc8815a4e6beead3f1a23e1` |
| Tinos Regular | https://fonts.gstatic.com/s/tinos/v26/buE4poGnedXvwgX8.ttf | `e30f146a85623eff54453d733e5e5102fee69f07584d8ea074175a9732028be6` |
| Tinos Bold | https://fonts.gstatic.com/s/tinos/v26/buE1poGnedXvwj1AW0Fp.ttf | `6ce81af2cbe9244156ee0399ae1c2e029f99ed3e64d4a0d49f5d4c59a715d743` |
| Tinos Italic | https://fonts.gstatic.com/s/tinos/v26/buE2poGnedXvwjX-fmE.ttf | `129bc194acf669456c93f8fbd9786504b85bf7516cb683567e6f4396f75e2918` |
| Noto Emoji | https://fonts.gstatic.com/s/notoemoji/v65/bMrnmSyK7YY-MEu6aWjPDs-ar6uWaGWuob-r0jwv.ttf | `988621dc5c9a75eb6144f28faae30317a8e3421b68b28740747b3d739e2326b8` |

GitHub 上的原始發行檔（Adobe 的 OTF）在開發環境的網路代理下無法下載，所以用 Google Fonts 的 TrueType 版；字形相同。

## 子集內容

- **Noto Serif TC Regular**：`apps/web/public/data/exams/*.json`（build-data 的輸出，也就是 PDF 實際排版的資料）裡的每個字元
  ＋ `apps/web/src/**/*.ts(x)` 的所有字元（介面文字）＋教育部「常用國字標準字體表」4,808 字（`scripts/fonts/moe-common-4808.txt`）
  ＋常用全形標點、圈號數字、全形英數。拉丁字母與表情符號不放（交給 Tinos、Noto Emoji）。
- **Noto Serif TC Bold**：所有考卷的大題／部分標題、`scripts/fonts/bold-extra.txt`（封面、答題卷、答案頁的標題用字）、
  PDF 固定文字檔 `src/features/pdf/layout/strings.ts` 與 `attribution.ts` 裡的中文。缺字時 PDF 改用一般粗細的同一個字（`fontRuns.ts` 的 `hasBoldGlyph`），不會變成方框。
- **Tinos**：ASCII、Latin-1、Latin Extended-A、常用標點（連字號、破折號、彎引號、刪節號、‰、′″）、€、™、箭頭 ←↑→↓↔、減號。
- **Noto Emoji**：Emoticons 區塊（U+1F600–1F64F）與 U+1F910–1F92F、U+1F970–1F97A、❤、👍👎、🎉。

## 對原始字型的修改

1. 子集化（fontTools 4.66.1）：只留上述字元；去掉 hinting、`vhea`／`vmtx`／`BASE`／`STAT`／`DSIG` 表；OpenType 功能只留 `kern`、`palt`（中文）或 `kern`、`liga`（英文）。
2. **統一行高度量**：每個字型的 `hhea` 與 `OS/2` typo 上緣改為 0.891 em、下緣 0.216 em、行距 0（Times New Roman／Tinos 的比例）。
   PDF 引擎用字型的上下緣算行高；不改的話含中文的行（Noto 原本 1.437 em）會比純英文的行（1.107 em）高，同一段落的行距忽大忽小。
3. 版本字串（name ID 5）加上「; subset for gsat-english-center PDF」。字型名稱不變。

## 為什麼是 TrueType＋gzip，不是 WOFF2

PDF 引擎 pdfmake 透過 pdfkit／fontkit 嵌入字型，需要原始的 `glyf`／`loca` 表：

- WOFF2：嵌入時直接出錯（fontkit 的 WOFF2 字型沒有 `loca`）。
- WOFF1：可以用，但 fontkit 每取一個字形就重新解壓整個 `glyf` 表，gsat-115 整份要 122 秒（TTF 是 0.7 秒）。

所以存 TTF，再用 gzip（`compresslevel=9`、`mtime=0`，輸出可重現）壓縮傳輸；瀏覽器用內建的 `DecompressionStream('gzip')`
解開（Safari 16.4、Chrome 80、Firefox 113 起支援）。`fonts.ts` 會先看前兩個位元組是不是 gzip 標記，主機若已經用
`Content-Encoding` 解過壓也能直接用。gzip 後的大小（1.50 MB）比 WOFF2（約 1.1 MB）大約三成，換來不必多帶一個 WOFF2 解碼器。

## 什麼時候要重新產生、怎麼做

`npm run build`（`build:data`）會檢查試題資料的每個字元都有字形（`apps/web/scripts/font-coverage.mjs`），缺字就讓建置失敗並列出缺的字。
通常是新的試題資料用到 4,808 常用字以外的罕用字，或 `src/features/pdf/layout/strings.ts`（PDF 固定文字）、
`src/features/mock/papers.ts` 的字串（模擬考 PDF 封面的卷別與提醒）新增了常用字以外的字。修法（只在開發機上做，Vercel 建置不需要 Python）：

```sh
pip install fonttools==4.66.1
npm run build:data -w @gsat/web
python3 -I apps/web/scripts/fonts/subset_fonts.py --src /tmp/gsat-font-src --download
npm run check:fonts -w @gsat/web
```

`--download` 會下載上表固定版本的原始字型（雜湊不符就停止）；`--src` 請放在 repo 外，原始字型（每個約 10 MB）不進版控。
重跑後 `metrics.json` 與 `.ttf.gz` 會一起更新，連同 PR 提交即可。換字型或版本時，更新 `SOURCES`、本文件與 `LICENSE-OFL.txt`。
