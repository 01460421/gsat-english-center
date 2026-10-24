-- 0005_essay_exemplars.sql：作文範文（docs/design/model-essays.md §6）。
--
-- 為什麼要這次遷移：作文範文（輸入或選一個作文題目，AI 依同一個構想寫出基礎版、穩健版、頂標版三篇範文與說明）的每一組
-- 都是使用者資料，要能匯出、隨帳號刪除、到期清理，所以新增一張表，不改任何既有表與 CHECK：
--   exemplar_sets：一次產生一列，也是 ai_ops.ref_id 指向的對象（consumer 的租約與嘗試次數在這裡，不假設 ref_id 是提交）。
--     網站題目只存題組 id（group_id）；自訂題存正規化、遮過聯絡方式的題目（prompt_json）。output_json 是程式後處理、過濾後的
--     顯示內容（ExemplarSetView）。content_failures 是語意檢查不通過的次數（跨 Queue 投遞累計；加上 ai_calls 的截斷與格式
--     不符，一個操作最多付費產生 2 次，§3.6）。cache_key／cache_gen 是命中或真的寫入成功的共用快取與它當下的 created_at
--     （「這組範文有問題」的停用計數只算同一代，§4.3）。
--   同一個使用者、同一題（dedupe_key）同時只能有一個進行中（idx_exemplar_sets_inflight）。
-- user_id ON DELETE CASCADE；每一句查詢都帶 user_id（IDOR）。內容不進日誌、ai_calls、ops_events 與後台。
-- 會增加的列舉（source）不設 CHECK；JSON 欄位 json_valid 加長度上限；時間是 Unix 秒。
-- 保存：最後一次更新後 180 天（expires_at）；清理接在 housekeeping（沒有 Cron）；進行中的不刪。
-- 和既有表的關係：ai_ops.ref_id 是沒有外鍵的 TEXT，直接放 exemplar_sets.id（UUID，不會和提交、turn、報告的 id 撞）；
-- ai_ops.task 沒有 CHECK，新任務代號 essay_exemplars 不必遷移；共用快取用 ai_shared_cache 既有的 kind='explain_template'
-- （ref_id 'exemplar:{group_id}'），不改那張表。
-- 注意：建表、建索引一律 IF NOT EXISTS，整支檔案可以重跑（沒有 ALTER TABLE）；不寫 PRAGMA 與 BEGIN／COMMIT（同 0001 的慣例）。
-- 12/18–1/23 凍結期不跑結構遷移：這一版的欄位涵蓋第一版的全部需要，之後的工作包都不改結構。

CREATE TABLE IF NOT EXISTS exemplar_sets (
  id               TEXT PRIMARY KEY,  -- UUID（＝ai_ops.ref_id）
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  source           TEXT NOT NULL,  -- exam|bank|custom（會增加，不設 CHECK）
  group_id         TEXT,  -- 網站題目的題組 id（gsat-115.s8g1@1、ai.cp.0e89ae@1）；自訂題 NULL
  prompt_json      TEXT CHECK (prompt_json IS NULL OR (json_valid(prompt_json) AND length(prompt_json) <= 4096)),  -- 自訂題：題目、圖片描述、段數、字數
  dedupe_key       TEXT NOT NULL,  -- sha256(site|group_id) 或 sha256(custom|正規化題目|圖片描述|段數|字數)
  title            TEXT NOT NULL CHECK (length(title) <= 60),  -- 列表標題（程式產生）
  status           TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),  -- 狀態
  op_id            TEXT,  -- ai_ops.id（共用快取命中時 NULL）
  fresh            INTEGER NOT NULL DEFAULT 0 CHECK (fresh IN (0,1)),  -- 重新產生（不讀快取）
  cache_hit        INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),  -- 共用快取命中（0 點）
  cache_key        TEXT,  -- 命中或真的寫入／取代成功的 ai_shared_cache.cache_key（網站題目；寫入衝突沒寫進去時 NULL）
  cache_gen        INTEGER,  -- 那一筆快取當下的 created_at（快取的「代」；停用計數只算同一代）
  output_json      TEXT CHECK (output_json IS NULL OR (json_valid(output_json) AND length(output_json) <= 32768)),  -- ExemplarSetView
  failure          TEXT,  -- 退還原因（AiRefundReason）
  rating           TEXT CHECK (rating IS NULL OR rating IN ('helpful','wrong')),  -- 學生的評分
  injection_flag   INTEGER NOT NULL DEFAULT 0 CHECK (injection_flag IN (0,1)),  -- 題目有注入樣式
  safety_flag      TEXT,  -- 只存類別
  d8_hidden        INTEGER NOT NULL DEFAULT 0 CHECK (d8_hidden IN (0,1)),  -- 有內容因 D8 被隱藏
  prompt_version   TEXT,  -- 提示詞版本
  served_model     TEXT,  -- 實際服務的模型
  meta_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json) AND length(meta_json) <= 2048),  -- 規則／過濾／D8／層級版本、處理數、not_writing_task（結構化縮減，不切字串）
  lease_until      INTEGER,  -- consumer 的租約到期時間
  tries            INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),  -- consumer 處理過幾次
  content_failures INTEGER NOT NULL DEFAULT 0 CHECK (content_failures BETWEEN 0 AND 4),  -- 語意檢查不通過的次數（跨投遞）
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),  -- 最後更新時間
  expires_at       INTEGER NOT NULL,  -- updated_at + 180 天
  CHECK (expires_at > created_at),
  CHECK (group_id IS NOT NULL OR prompt_json IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_exemplar_sets_user ON exemplar_sets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exemplar_sets_expire ON exemplar_sets(expires_at);
CREATE INDEX IF NOT EXISTS idx_exemplar_sets_work ON exemplar_sets(status, lease_until) WHERE status IN ('queued','running');
-- 「這組範文有問題」的跨學生計數（同一代）。
CREATE INDEX IF NOT EXISTS idx_exemplar_sets_cache ON exemplar_sets(cache_key, cache_gen) WHERE cache_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_exemplar_sets_inflight ON exemplar_sets(user_id, dedupe_key) WHERE status IN ('queued','running');
