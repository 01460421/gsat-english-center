# D1 遷移檔

這個目錄由 `wrangler d1 migrations` 管理（`wrangler.toml` 的 `migrations_dir = "migrations"`）。資料庫設計另案進行，目前還沒有任何資料表。

## 為什麼用 `wrangler d1 migrations`

Sekai Center 的遷移要人工執行 `wrangler d1 execute --file=…`，部署 workflow 也不會自動套用，很容易漏跑（`docs/research/05-sekai-center-patterns.md` §3.5 第 2 點）。`wrangler d1 migrations apply` 會在資料庫的 `d1_migrations` 表記錄哪些檔案已經套用過，只補跑缺的，所以可以放進部署流程自動執行。

## 命名規則

```
0001_init.sql
0002_vocab_review.sql
0003_add_essay_retention.sql
```

- 四位數流水號＋底線＋英文小寫蛇形命名的簡短說明，副檔名 `.sql`。
- 用指令產生下一個編號，不要手動猜：`npm run db:migrations:create -w @gsat/api -- <說明>`（等同 `wrangler d1 migrations create gsat-english <說明>`）。
- **已經套用到線上的遷移檔不能再修改**，要改結構就新增一支。wrangler 只看檔名判斷是否套用過，改舊檔不會重跑，線上和本機就會不一致。

## 檔案內容慣例（沿用 Sekai，見 05 文件 §2.4）

- 檔頭用繁體中文註解寫「為什麼要做這次遷移」與注意事項。
- 建表、建索引一律寫 `IF NOT EXISTS`。`ALTER TABLE … ADD COLUMN` 不能重跑，要在註解寫明。
- 時間一律存「秒」（INTEGER），id 用 `crypto.randomUUID()`。
- 使用者資料表的每一句查詢都要帶 `AND user_id = ?`（防 IDOR）；SQL 集中放在 Worker 的資料存取模組。
- 作文照片不要放進 D1（單列上限 2 MB），之後用 R2 或用完即丟。

## 常用指令

```bash
npm run db:migrate:local -w @gsat/api    # 套用到本機（.wrangler/ 下的模擬資料庫，wrangler dev 用這個）
npm run db:migrate:remote -w @gsat/api   # 套用到線上 D1（需要 database_id 與有 D1 權限的 API token）
npx wrangler d1 migrations list gsat-english --local   # 查看哪些還沒套用
```

部署順序是「先套用遷移，再部署 Worker」：新程式碼可能依賴新欄位，反過來會有一段時間報錯。
