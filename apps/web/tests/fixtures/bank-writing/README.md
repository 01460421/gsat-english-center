# 本站仿真寫作題的範例題庫

`v1/` 是 `tools/tests/data/ai.tr.0b1c2d@1.json` 與 `ai.cp.0e1f2a@1.json` 的副本，只把 `status` 改成 `verified`
（docs/design/bank-writing.md §7.2）。`scripts/lib/writing-bank.test.ts` 用它產生 `../bank-writing-public/writing/bank/` 的 golden，
元件測試與 Playwright（`tests/writing-bank.spec.ts`）都讀那份 golden。和題庫練習的 `../bank/` 分開，兩邊的測試互不影響。

更新 golden：`UPDATE_WRITING_BANK_GOLDEN=1 npx vitest run scripts/lib/writing-bank.test.ts`（在 apps/web 執行）。
