# 學測英文秘笈（講義原始檔備份）

500 頁的學測英文全科參考書原始檔。這裡只是備份，網站不會讀這個資料夾。

- `parts/單元代號.body.html`、`.ans.html`：各單元的本文與解答（HTML 片段）。
- `book-spec.md`、`book-units.md`、`review-brief.md`、`v3-brief.md`：撰寫規格、單元指派、審稿規格。
- `gen.py`：產生 V3（歷屆詞彙題字彙總表）與 V4（熟字僻義 300）。
- `bank.py`、`bank-plan.json`：從 `data/bank/v1`（只取 verified）挑題，排成各大題練習（VP、GP、CP、RP、MP、TP、WP）與兩回模擬試題（X1、X2）。
- `build.mjs`：把 `parts/` 排成 PDF（封面、目錄、本文、解答篇）。需要 Playwright Chromium、`pdfunite`、`pdftotext` 與 Fontsource 字型；程式裡的路徑是當時的暫存目錄，重建前要改。
- `check_part.py`：單元格式檢查；`d8check.mjs`：與官方文字的重疊檢查。

翻譯篇（T2a–T2c、T3）、作文篇（W1–W3）與附錄 A 沿用「翻譯與作文高分練習講義」的單元。
