# 熟字僻義 1000（講義原始檔備份）

紙本講義「熟字僻義 1000」的資料與排版程式。這裡只是備份，網站不會讀這個資料夾。

- `data/unit-XX.json`：25 個單元，每單元 40 張字卡（`entries`）與 10 題仿學測詞彙題（`quiz`）。
- `data-by-level/unit-XX.json`：依級別由低到高重新分的 25 個單元（正式版用這份），每個字多一個 `kk` 欄位。由 `regroup.py` 從 `data/` 產生。
- `build2.mjs`：正式版的排版程式（橫式字卡：標題列＋左欄搭配、右欄例句），讀 `data-by-level/`。
- `kk/`、`kkcheck.py`：KK 音標與交叉核對程式（對照 CMUdict）。
- `build.mjs`：第一版的雙欄排版，把 `data/` 排成 PDF（封面、使用說明、目錄、25 單元、解答、索引）。
  - 需要 Playwright Chromium、`pdfunite`、`pdftotext`，以及 Fontsource 的 Noto Sans TC、Noto Serif TC、Source Serif 4、Inter。
  - 程式裡的路徑寫的是當時的暫存目錄，重建前要改成實際位置。
  - 用法：`node build.mjs <輸出目錄> <data 目錄>`。
- `corpus.py`：從 `data/exams/parsed/gsat-*.json` 抽出學測題本句子（不含翻譯與作文）。
- `forms.py`、`merge.py`、`check_unit.py`、`xcheck.py`：字形比對、併入學測原句、單元檢查、全書交叉檢查。
- `briefs/`：選字、撰寫、審稿三份規格。

詞彙與級別取自《高中英文參考詞彙表（111 學年度起適用）》；學測原句取自歷屆學科能力測驗英文考科試題；其餘例句與詞彙題為本站自編。
