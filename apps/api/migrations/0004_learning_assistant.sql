-- 0004_learning_assistant.sql：學習助手（docs/design/learning-assistant.md §4.6）。
--
-- 為什麼要這次遷移：學習助手（拍照或貼上題目、站內錯題解析、追問、學習報告）的案例、每一次 AI 呼叫、題目照片暫存與報告
-- 都是使用者資料，要能匯出、隨帳號刪除、到期清理。既有的 chat_threads／chat_messages 不合用（外鍵指向空的 items、
-- turns 的 CHECK 與 7 天的設計都不同），所以另開四張表，不改任何既有表與 CHECK：
--   1. assist_cases：一個案例＝一題或同一個題組的幾題、一個寫作批改、或 1–8 個單字；題目（AssistQuestionView）存在
--      question_json，前端只送「哪一題、學生答什麼」（ref_json）；站內來源以 dedupe_key 去重。
--   2. assist_turns：一次 AI 呼叫一列（轉錄、解析、追問），自己的租約與嘗試次數（consumer 不再假設 ai_ops.ref_id 是提交）；
--      同一個案例同時只能有一個進行中（idx_assist_turns_inflight）。
--   3. assist_photos：題目照片暫存（同 0002 的規則：轉錄結算、內容退還、學生刪除、刪案例、24 小時到期時刪除）。
--   4. assist_reports：學習報告一版一列；同一人同時只能有一份進行中（idx_assist_reports_inflight）。
-- 四張表都以 user_id ON DELETE CASCADE；每一句查詢都帶 user_id（IDOR）。內容不進日誌、ai_calls、ops_events 與後台。
-- 會增加的列舉（source、section、kind）不設 CHECK；JSON 欄位 json_valid 加長度上限；時間是 Unix 秒。
-- 保存：assist_cases／assist_reports 最後一次更新後 180 天（expires_at），照片最長 24 小時；沒確認的轉錄文字隨照片到期清掉；
-- 清理接在 housekeeping（沒有 Cron）。這一版的欄位涵蓋題組、單字批次、計畫與報告的全部需要：之後的工作包都不改結構
-- （12/18 凍結期不跑結構遷移）。
-- 和既有表的關係：ai_ops.ref_id 是沒有外鍵的 TEXT，直接放 turn id 或 report id（UUID，不會和提交 id 撞）；ai_ops.task 沒有
-- CHECK，新任務代號不必遷移；共用快取用 ai_shared_cache 既有的 kind='explain_template'；D8 命中與答案疑慮寫 ops_events。
-- 注意：建表、建索引一律 IF NOT EXISTS，整支檔案可以重跑（沒有 ALTER TABLE）；不寫 PRAGMA 與 BEGIN／COMMIT（同 0001 的慣例）。

CREATE TABLE IF NOT EXISTS assist_cases (
  id               TEXT PRIMARY KEY,  -- UUID
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  source           TEXT NOT NULL,  -- bank|bank_mock|exam|vocab|writing|photo|typed（會增加，不設 CHECK）
  kind             TEXT NOT NULL,  -- item|writing|vocab（輸出 schema；會增加，不設 CHECK）
  ref_json         TEXT NOT NULL CHECK (json_valid(ref_json) AND length(ref_json) <= 4096),  -- 來源 id、題號、作答（不含題目文字）
  dedupe_key       TEXT,  -- 站內來源：sha256(source|ref|排序後的題號|作答)；同一組同樣的作答只建一個案例
  trust            TEXT NOT NULL CHECK (trust IN ('site','student')),  -- 題目是網站的或學生提供的
  section          TEXT,  -- AssistSection
  title            TEXT NOT NULL CHECK (length(title) <= 120),  -- 列表標題（程式產生；學生題目取開頭並遮個資）
  item_count       INTEGER NOT NULL DEFAULT 1 CHECK (item_count BETWEEN 1 AND 8),  -- 問了幾題（單字是幾個字）
  wrong_count      INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count BETWEEN 0 AND 8),  -- 其中答錯幾題
  question_json    TEXT CHECK (question_json IS NULL OR (json_valid(question_json) AND length(question_json) <= 65536)),  -- AssistQuestionView
  doubt_kinds_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(doubt_kinds_json) AND length(doubt_kinds_json) <= 256),  -- 勾選的疑問種類
  torn_with        TEXT CHECK (torn_with IS NULL OR length(torn_with) = 1),  -- torn_between 的第二個選項
  doubt_text       TEXT CHECK (doubt_text IS NULL OR length(doubt_text) <= 500),  -- 學生的疑問（遮過個資）
  hint_first       INTEGER NOT NULL DEFAULT 0 CHECK (hint_first IN (0,1)),  -- 先顯示提示
  signals_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(signals_json) AND length(signals_json) <= 1024),  -- 作答當下的行為訊號（不進提示）
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ocr_queued','ocr_ready','ready','analyzing','analyzed','failed')),  -- 狀態
  verdict          TEXT,  -- correct|wrong|partial|unanswered|unknown（程式判定；題組取最差）
  skills_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills_json) AND length(skills_json) <= 1024),  -- 技能代碼
  errors_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(errors_json) AND length(errors_json) <= 1024),  -- 錯因代碼（解析與追問發現的）
  understood       TEXT CHECK (understood IS NULL OR understood IN ('yes','partly','no')),  -- 懂了嗎
  rating           TEXT CHECK (rating IS NULL OR rating IN ('helpful','wrong','unclear')),  -- 這則解析有錯等評分
  note_text        TEXT CHECK (note_text IS NULL OR length(note_text) <= 200),  -- 學生的筆記（遮過個資）
  cache_key        TEXT,  -- 命中或寫入的 ai_shared_cache.cache_key
  analyses         INTEGER NOT NULL DEFAULT 0 CHECK (analyses BETWEEN 0 AND 2),  -- 成功的解析次數（結算用 MIN(analyses + 1, 2)）
  followups        INTEGER NOT NULL DEFAULT 0 CHECK (followups BETWEEN 0 AND 8),  -- 成功的追問次數（結算用 MIN(followups + 1, 8)）
  d8_hidden        INTEGER NOT NULL DEFAULT 0 CHECK (d8_hidden IN (0,1)),  -- 有內容因 D8 被隱藏
  injection_flag   INTEGER NOT NULL DEFAULT 0 CHECK (injection_flag IN (0,1)),  -- 學生文字有注入樣式
  safety_flag      TEXT,  -- 只存類別
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),  -- 最後更新時間
  expires_at       INTEGER NOT NULL,  -- updated_at + 180 天
  CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assist_cases_user    ON assist_cases(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assist_cases_created ON assist_cases(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assist_cases_expire  ON assist_cases(expires_at);
CREATE INDEX IF NOT EXISTS idx_assist_cases_cache   ON assist_cases(cache_key) WHERE cache_key IS NOT NULL;  -- 「這則有錯」的跨學生計數
CREATE UNIQUE INDEX IF NOT EXISTS idx_assist_cases_dedupe ON assist_cases(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 一次 AI 呼叫一列（轉錄、解析、追問）：自己的租約與嘗試次數（consumer 不再假設 ref_id 是提交）。
CREATE TABLE IF NOT EXISTS assist_turns (
  id             TEXT PRIMARY KEY,  -- UUID（＝ai_ops.ref_id）
  case_id        TEXT NOT NULL REFERENCES assist_cases(id) ON DELETE CASCADE,  -- 案例
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  seq            INTEGER NOT NULL CHECK (seq >= 1),  -- 案例裡的第幾次
  kind           TEXT NOT NULL CHECK (kind IN ('ocr','analyze','followup')),  -- 轉錄、解析、追問
  status         TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),  -- 狀態
  op_id          TEXT,  -- ai_ops.id（共用快取命中時為 NULL）
  input_text     TEXT CHECK (input_text IS NULL OR length(input_text) <= 500),  -- 追問內容（遮過個資）
  label          TEXT CHECK (label IS NULL OR length(label) <= 8),  -- 追問針對的題號（NULL＝整組）
  mode           TEXT CHECK (mode IS NULL OR mode IN ('hint','explain')),  -- 追問的提示／詳解模式
  output_json    TEXT CHECK (output_json IS NULL OR (json_valid(output_json) AND length(output_json) <= 98304)),  -- 過濾後的顯示內容
  failure        TEXT,  -- 退還原因（AiRefundReason）
  cache_hit      INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0,1)),  -- 共用快取命中（0 點）
  prompt_version TEXT,  -- 提示詞版本
  served_model   TEXT,  -- 實際服務的模型
  meta_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json) AND length(meta_json) <= 4096),  -- filter／D8 版本、cache_key、隱藏區塊序號、上限處理數
  lease_until    INTEGER,  -- consumer 的租約到期時間
  tries          INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),  -- consumer 處理過幾次
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 最後更新時間
  UNIQUE (case_id, seq)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assist_turns_inflight ON assist_turns(case_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_assist_turns_work ON assist_turns(status, lease_until) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_assist_turns_user ON assist_turns(user_id, created_at);

-- 題目照片暫存（同 0002 的規則：轉錄結算、內容退還、學生刪除、刪案例、24 小時到期時刪除；不匯出、管理員看不到）。
CREATE TABLE IF NOT EXISTS assist_photos (
  id         TEXT PRIMARY KEY,  -- UUID
  case_id    TEXT NOT NULL REFERENCES assist_cases(id) ON DELETE CASCADE,  -- 案例（只有 source='photo'）
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  ord        INTEGER NOT NULL CHECK (ord BETWEEN 1 AND 2),  -- 第幾張（同一個 ord 再傳一次＝取代）
  mime       TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),  -- 格式（Worker 另外檢查魔術位元組）
  bytes      INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 1200000),  -- 大小（≤1.2 MB）
  width      INTEGER,  -- 寬
  height     INTEGER,  -- 高
  sha256     TEXT NOT NULL,  -- 雜湊（hex）
  data       BLOB NOT NULL CHECK (length(data) = bytes),  -- 照片本體
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),  -- 上傳時間
  expires_at INTEGER NOT NULL,  -- 上傳後 24 小時
  UNIQUE (case_id, ord),
  CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_assist_photos_expire ON assist_photos(expires_at);
CREATE INDEX IF NOT EXISTS idx_assist_photos_user   ON assist_photos(user_id, case_id);

-- 學習報告：一版一列（version 依使用者遞增；每人保留最近 10 版）。
CREATE TABLE IF NOT EXISTS assist_reports (
  id             TEXT PRIMARY KEY,  -- UUID（＝ai_ops.ref_id）
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  version        INTEGER NOT NULL CHECK (version >= 1),  -- 第幾版
  based_on       TEXT,  -- 上一版的 id（不設外鍵：舊版可能已刪）
  status         TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),  -- 狀態
  op_id          TEXT,  -- ai_ops.id
  target_json    TEXT NOT NULL CHECK (json_valid(target_json) AND length(target_json) <= 1024),  -- 目標、練習難度、每週時間、段考日期
  exam_date      TEXT NOT NULL CHECK (exam_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- 考試日
  feedback_text  TEXT CHECK (feedback_text IS NULL OR length(feedback_text) <= 500),  -- 學生對上一版的回饋（遮過個資）
  input_json     TEXT NOT NULL CHECK (json_valid(input_json) AND length(input_json) <= 65536),  -- 摘要、facts、伺服器重建的候選、代表案例 id
  report_json    TEXT CHECK (report_json IS NULL OR (json_valid(report_json) AND length(report_json) <= 131072)),  -- AI 的報告＋程式排好的逐週計畫
  failure        TEXT,  -- 退還原因（AiRefundReason）
  prompt_version TEXT,  -- 提示詞版本
  served_model   TEXT,  -- 實際服務的模型
  meta_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json) AND length(meta_json) <= 2048),  -- 版本、截斷與過濾的處理數
  lease_until    INTEGER,  -- consumer 的租約到期時間
  tries          INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),  -- consumer 處理過幾次
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 最後更新時間
  expires_at     INTEGER NOT NULL,  -- updated_at + 180 天
  UNIQUE (user_id, version)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assist_reports_inflight ON assist_reports(user_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS idx_assist_reports_expire ON assist_reports(expires_at);
