-- 0002_ai_photo_temp.sql：手寫作文照片的暫存表（AI 批改 MVP，docs/design/ai-auth-mvp.md §4）。
--
-- 為什麼要這張表：正式設計是照片放私有 R2、D1 只存中繼資料（0001 的 submission_photos）。MVP 還沒有 R2，
-- 照片改成「用完即丟」暫存在 D1：一張一列（BLOB），每張 ≤1.2 MB（D1 單列上限約 2 MB），最多 2 張。
-- migrations/README 的「照片不要放進 D1」原則在 MVP 以下列規則處理，R2 上線後改回 submission_photos、刪掉這張表：
--   - OCR 結算（成功或失敗）時、學生 PUT /api/submissions/{id}/confirm 時、學生 DELETE …/photos 時立即刪除；
--   - 刪提交或刪帳號時隨外鍵 CASCADE 刪除；
--   - 每次上傳照片前順手 DELETE … WHERE expires_at < now（最長 24 小時）。
-- 照片不匯出、管理員看不到、不寫進日誌。
--
-- 題組外鍵（submissions.group_id → item_groups.id）不在這支遷移處理：Worker 建立提交時才以
-- INSERT OR IGNORE 補上該題組的最小 item_groups 列（status='draft'，不會出現在任何學生端檢視表或抽題），
-- 授權用 0001 已有的 'CEEC-exam'。理由見設計文件 §4 的決定：題目文字由 Worker 打包的
-- src/generated/writing-prompts.json 決定，新增考卷不必再寫遷移。
--
-- 注意：建表、建索引一律 IF NOT EXISTS，整支檔案可以重跑；不寫 PRAGMA 與 BEGIN／COMMIT（同 0001 的慣例）。

CREATE TABLE IF NOT EXISTS submission_photo_temp (
  id            TEXT PRIMARY KEY,  -- UUID
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,  -- 提交（只有 kind='essay'、input_mode='photo'）
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者（每句查詢都帶 user_id，防 IDOR）
  ord           INTEGER NOT NULL CHECK (ord BETWEEN 1 AND 2),  -- 第幾張（同一個 ord 再傳一次＝取代）
  mime          TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),  -- 格式（Worker 另外檢查魔術位元組）
  bytes         INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 1200000),  -- 大小（≤1.2 MB）
  width         INTEGER,  -- 寬（解析檔頭得到；解析不了為 NULL）
  height        INTEGER,  -- 高
  sha256        TEXT NOT NULL,  -- 雜湊（hex）
  data          BLOB NOT NULL CHECK (length(data) = bytes),  -- 照片本體（JPEG 已剝除 EXIF 的 APP1 區段）
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),  -- 上傳時間
  expires_at    INTEGER NOT NULL,  -- 最晚刪除時間（上傳後 24 小時）
  UNIQUE (submission_id, ord),
  CHECK (expires_at > created_at)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_photo_temp_expire ON submission_photo_temp(expires_at);
CREATE INDEX IF NOT EXISTS idx_photo_temp_user   ON submission_photo_temp(user_id, submission_id);
