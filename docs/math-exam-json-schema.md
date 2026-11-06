# 學測數學歷屆試題 JSON 格式（`gsat-math-exam/v1`）

108 課綱學測**數學A、數學B**（111 學年度起）每份考卷一個檔案：`data/exams/parsed-math/{id}.json`。圖檔在 `data/exams/figures-math/{id}/`。格式沿用英文題庫 [`gsat-exam/v1.1`](exam-json-schema.md) 的慣例（id、sources、parts／sections／groups、extraction），但題型、答案與公式的寫法依數學需要重新設計。

| 工具 | 用途 |
|---|---|
| `python3 tools/fetch_ceec_math.py discover｜fetch｜verify` | 下載官方檔案，清單在 `data/exams/math-manifest.json` |
| `python3 -I tools/docx_math_draft.py <paper.docx>` | Word 版題本 → 草稿（MathType 公式轉 LaTeX，見 `tools/mathtype_latex.py`） |
| `python3 -I tools/build_math_exam.py --subject a --year 115` | 草稿＋答案 PDF → JSON 骨架（不覆寫已校對檔，除非 `--force`） |
| `python3 -I tools/crop_math_figures.py --all` | 依 JSON 裡每張圖的頁碼與 bbox 從 PDF 裁圖 |
| `python3 tools/validate_math_exam.py --all [--katex <node_modules/katex>]` | 檢查格式；`--katex` 另以 KaTeX 實際排版每一段公式。有 error 以 1 結束 |
| `data/exams/parsed-math-todo.json` | 看過原卷後仍待決的事項 |

**不收錄的東西**：大考中心的非選擇題**參考答案**、**評分原則**、**試題解析**都受著作權保護（見 [`docs/research/10-math-gsat.md`](research/10-math-gsat.md) §6）。JSON 只記錄非選擇題「是什麼題型、幾分、有沒有作圖」，不存官方答案；validator 看到 `scoring_notes`、`reference_answer`、`rubric` 等欄位就報 error。

## 檔名與 id

| 考科 | id | 例 |
|---|---|---|
| 數學A | `gsat-matha-{學年度}` | `gsat-matha-115` |
| 數學B | `gsat-mathb-{學年度}` | `gsat-mathb-115` |

（舊課綱「學測數學」100–110 只下載、尚未結構化；之後若要做，id 用 `gsat-math-{學年度}`。）

## 頂層

```jsonc
{
  "schema": "gsat-math-exam/v1",
  "id": "gsat-matha-115",
  "exam": "gsat",
  "subject": "math_a",               // math_a | math_b
  "year": 115,
  "session": "regular",
  "title": "115學年度學科能力測驗數學A考科",
  "time_minutes": 100,
  "full_score": 100,
  "sources": {
    "paper": "data/raw/ceec/gsat-matha/115/paper-1.pdf",
    "paper_word": ["data/raw/ceec/gsat-matha/115/paper-2.docx"],
    "answer": ["data/raw/ceec/gsat-matha/115/answer.pdf"],      // 選擇（填）題答案
    "answer_sheet": ["data/raw/ceec/gsat-matha/115/other.pdf"],  // 答題卷（混合題作答區）
    "stats": ["data/raw/ceec/gsat-matha/115/stats-1.xls", "..."],
    "scoring_not_stored": ["data/raw/ceec/gsat-matha/115/scoring.pdf"]  // 只記路徑，內容不收錄
  },
  "scoring_rules": { "single": "…", "multi": "…", "fill": "…" },  // 題本封面的計分方式，逐字
  "parts": [ { "title": "第壹部分、選擇（填）題（占85分）", "points": 85, "instructions": null, "sections": ["s1","s2","s3"] }, … ],
  "sections": [ … ],
  "reference_formulas": [ "1. 首項為$a$，公差為$d$的等差數列前$n$項之和為$S=\\frac{n(2a+(n-1)d)}{2}$", … ],
  "extraction": {
    "method": "…",
    "corrections": [ "第5題 stem：Word 版「…」→ 依 PDF 改為「…」（原因）" ],
    "issues": [],
    "verified_by": "visual-check"
  }
}
```

`sources` 的路徑都在 `data/raw/`（不進版控），要對得上 `data/exams/math-manifest.json`。`extraction.corrections` 記錄「Word 版與 PDF 不同、依 PDF 改」的每一處；`verified_by: "visual-check"` 表示每一頁都以 pdftoppm 算圖逐題看過。

## section（大題）

| 欄位 | 說明 |
|---|---|
| `id` | `s1`、`s2`… |
| `type` | `single`（單選）、`multi`（多選）、`fill`（選填）、`mixed`（第貳部分「混合題或非選擇題」） |
| `title`、`instructions` | 題本原文 |
| `points_total` | 大題配分；validator 檢查等於小題配分合計 |
| `groups` | 題組；單題也包成一個 group |

## group（題組）

```jsonc
{
  "id": "s4g1",
  "group_label": "18-20題為題組",   // 題本印的題組標示；單題為 null
  "stem": "坐標空間中有一平行六面體$PQRS-ABCD$，如圖所示。…",  // 題組共用文字；單題為 null
  "figures": [ /* figure */ ],
  "tables": [ /* table */ ],
  "items": [ /* item */ ]
}
```

## item（小題）

```jsonc
{
  "no": 13, "label": "13",
  "type": "fill",                 // single | multi | fill | constructed
  "stem": "…則該教師有碩士學位的條件機率為[[FILL]]。（化為最簡分數）",
  "options": null,                // single／multi：{"1": "…", …, "5": "…"}；其他 null
  "answer": null,                 // single："2"；multi：["3","4"]（遞增）；fill／constructed：null
  "points": 5,
  "fill": {                       // 只有 fill
    "cells": ["13-1", "13-2", "13-3"],
    "template": "\\frac{[[13-1]]}{[[13-2]][[13-3]]}",
    "answer_cells": {"13-1": "9", "13-2": "1", "13-3": "0"},
    "answer_latex": "\\frac{9}{10}"
  },
  "constructed": { "official_answer_stored": false, "has_drawing": false },  // 只有 constructed
  "figures": [], "tables": [],
  "options_figures": { },         // 選擇題的選項是圖時：{"1": figure, …}，對應選項文字為 ""
  "tags": { "units": ["probability"] }
}
```

### 題型

| type | 題本名稱 | 答案 | 計分（題本封面，111 起） |
|---|---|---|---|
| `single` | 單選題 | 選項代號字串 | 答對得全分，其餘 0 分 |
| `multi` | 多選題 | 選項代號陣列，遞增 | n 個選項各自判定，答錯 k 個得 $\frac{n-2k}{n}$ 倍分數，低於 0 或全未作答以 0 計 |
| `fill` | 選填題 | 見 `fill` | 每格都對才給分，答錯不倒扣 |
| `constructed` | 非選擇題 | 不存（官方參考答案受著作權保護） | 依評分原則給分；本專案不收錄 |

混合題（`section.type = "mixed"`）裡的小題各自用上面四種 type；例如 112 數B 第 18 題是 3 分的選填題，111 數B 第 18 題是 5 分的單選題。題幹結尾的「（單選題，3分）」照錄。

### 選填題 `fill`

- 答題卷每一格可劃 `0`–`9`、`-`、`±`；`answer_cells` 就是官方答案檔每一格的值（validator 只接受這 12 種）。
- `template` 是答案的版面：LaTeX，格子寫成 `[[題號-格號]]`。例如帶分數 `[[16-1]]\sqrt{[[16-2]]}`、小數 `[[13-1]].[[13-2]]`、比 `[[13-1]]:[[13-2]]:[[13-3]]`、整條方程式 `x+[[16-1]][[16-2]]y+[[16-3]][[16-4]]z=[[16-5]]`、兩個答案 `a=[[14-1]],\ b=\frac{[[14-2]]}{[[14-3]]}`。template 是看題本影像後人工寫的。
- `answer_latex` = 把 `answer_cells` 代入 template 的結果（validator 檢查一致）。負號格直接代入，所以可能出現 `+-6` 這種寫法——這是劃記內容的忠實呈現，顯示給學生時可再化簡。
- 題幹用 `[[FILL]]` 標出作答格在句中的位置（恰好一個）。

### 非選擇題 `constructed`

只存題幹、配分與 `has_drawing`（題目要求在答題卷作圖區作圖時為 true）。`official_answer_stored` 固定是 `false`。P2 的詳解由本專案另外撰寫並獨立驗算（見 `docs/design/math.md`）。

## 文字與公式

1. **公式一律是 LaTeX，包在 `$…$` 裡**（行內）。中文、全形標點放在公式外；公式裡必要的中文用 `\text{}`。
2. **以 KaTeX 為準**：所有 `$…$`、`fill.template`（格子換成 `\boxed{}`）、`fill.answer_latex` 都要能被 KaTeX 0.16 以 `throwOnError` 排版（`validate_math_exam.py --katex`）。
3. 常用寫法：向量 `\overrightarrow{AB}`、線段長 `\overline{AB}`、三角形 `\Delta ABC`（題本以 Δ 排版）、矩陣 `\begin{bmatrix}…\end{bmatrix}`、行列式 `\begin{vmatrix}…\end{vmatrix}`、聯立 `\begin{cases}…\end{cases}`、增廣矩陣 `\left[\begin{array}{ccc|c}…\end{array}\right]`、數列 `\langle a_{n}\rangle`、組合 `C_{12}^{24}`（上標為 n）。
4. **逐字**：中文照題本；Word 版與 PDF 不同時以 PDF 為準，並記在 `extraction.corrections`。純排版差異（例如某些單字母變數在 Word 版是一般文字）不改，列在 todo。
5. **位置標記**：題幹中只允許 `[[FILL]]`（選填作答格）與 `[[TABLE:k]]`（第 k 個表格出現的位置）。其他 `[[…]]` 是草稿殘留，validator 報 error。
6. 文字不可有 Tab、不換行空白（U+00A0）、零寬字元等；前後不留空白。

## figure（圖）

```jsonc
{
  "id": "f18",                    // 卷內唯一；檔名就是 {id}.png
  "kind": "diagram",              // diagram | graph | chart | table_image | photo | illustration | other
  "alt": "平行六面體 PQRS−ABCD 示意圖：…",   // 完整的文字描述（給螢幕報讀與 AI 解題用），至少 8 字
  "source": { "page": 7, "bbox_pt": [380, 425, 535, 512] },  // PDF 頁碼（從 1 起，含封面）與 PDF 點座標，原點左上
  "file": "data/exams/figures-math/gsat-matha-115/f18.png",
  "width": 309, "height": 166
}
```

- 圖一律從**官方 PDF** 裁切（不是 Word 檔裡的圖片），200 dpi、裁掉四周空白、16 階灰階 PNG。重跑 `crop_math_figures.py` 會得到位元組相同的檔案。
- 題目中的標籤（A、B、P、θ…）在 PDF 裡常是另外的文字物件，bbox 要把它們包進去。
- 圖放在所屬題組（`group.figures`，題組共用）或小題（`item.figures`）；選項是圖時放 `item.options_figures`。

## table（表）

```jsonc
{ "caption": null, "rows": [["", "藍", "綠"], ["1號", "2", "4"], ["2號", "3", "$k$"]], "note": "…" }
```

第一列通常是表頭；空格是 `""`。合併儲存格、斜線格（不適用）寫在 `note`。表格裡的公式同樣用 `$…$`。

## tags.units（單元，封閉集合）

依 108 課綱數學領綱 10 年級必修與 11 年級 A／B 類（考試說明附件一）歸納，一題可有多個：

| 值 | 範圍（領綱條目） |
|---|---|
| `real_numbers` | 實數、絕對值、指數根式、科學記號與誤差、邏輯（N-10-1～5、N-10-7） |
| `polynomial` | 式的運算、除法原理、一次至三次函數、多項式不等式（A-10-1～2、F-10-1～3） |
| `exp_log` | 常用對數、指數與對數律、指對數函數與成長模型（N-10-4、A-11A-4、F-11A-4、F-11B-2） |
| `sequence` | 數列、級數、遞迴（N-10-6） |
| `counting` | 有系統的計數、排列組合（D-10-3） |
| `probability` | 古典機率、期望值、條件機率、貝氏定理、獨立事件（D-10-4、D-11A-1～3、D-11B-1～2） |
| `statistics` | 一維／二維數據分析、迴歸、標準化（D-10-2） |
| `trigonometry` | 廣義角、三角比、正餘弦定理、和差角、三角函數圖形與疊合、週期模型、弧度（G-10-5～7、G-11A-5、F-11A-1～2、F-11B-1、N-11A-1、N-11B-1） |
| `coordinate_line` | 坐標平面、直線方程式、對稱（G-10-1～2、G-10-4） |
| `circle` | 圓方程式、圓與直線（G-10-3～4） |
| `conics` | 圓錐截痕、圓錐曲線（S-11B-2） |
| `vector_plane` | 平面向量、內積、面積與行列式（G-11A-1、G-11A-4、G-11A-6、G-11B-1～2） |
| `vector_space` | 空間坐標、空間向量、外積、三階行列式（G-11A-2～3、G-11A-7～8、G-11B-4） |
| `space_line_plane` | 空間概念、平面方程式、空間直線（S-11A-1、G-11A-9～10） |
| `matrix` | 矩陣運算、反方陣、平面線性變換（A-11A-3、F-11A-3、A-11B-1） |
| `linear_system` | 線性方程組、高斯消去、矩陣表達（A-11A-1～2） |
| `inequality_lp` | 二元一次不等式與區域（G-10-2） |
| `geometry` | 平面／立體幾何推理、比例（G-11B-3、S-11B-1） |
| `functions` | 函數圖形的一般性質、平移伸縮 |
| `logic_set` | 集合、文氏圖、列聯表（D-10-1、D-11B-2） |
| `data_modeling` | 以情境建立數學模型（單點透視、成長率、週期現象等跨單元應用） |

單元標籤是本專案標註，不是官方資料；P4（AI 題庫）用來做「單元 × 難度」的抽題。

## 校對流程（每一份考卷）

1. `fetch_ceec_math.py fetch` 下載；`build_math_exam.py` 產生骨架。
2. `pdftoppm -r 90` 算出每一頁，逐題對照骨架的題幹、選項、公式（矩陣、上下標、負號、根號範圍要特別看），選填格式框寫成 `template`。可疑的公式放大到 250 dpi 再看。
3. 圖：用 pdfplumber 列出頁面上的影像與向量物件決定 bbox，裁切後再看一次裁圖。
4. `validate_math_exam.py --all --katex …` 沒有 error 才算完成。
5. 無法依 PDF 決定的事寫進 `data/exams/parsed-math-todo.json`，不要猜。
