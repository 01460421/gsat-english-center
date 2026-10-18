-- 0003_custom_essay_prompts.sql：英文作文自訂題目（docs/design/custom-essay.md §3）。
--
-- 為什麼要這次遷移：學生自己輸入的作文題目是使用者資料，要能匯出、隨提交與帳號刪除。item_groups 是只增不減的
-- 內容表（trg_groups_no_delete）、沒有 user_id，不能放學生的題目。所以：
--   1. 新增授權代碼 user-provided（licenses 沒有 CHECK）；
--   2. 新增所有自訂題共用的佔位題組 custom:essay@1：submissions.group_id 是 NOT NULL 外鍵，一定要指向一列。
--      origin 用既有的 'human'（item_groups.origin 的 CHECK 只有 ceec／agent／batch／human，加值要重建整張表與
--      10 個外鍵）；真正標示來源的是 license='user-provided' 與 id 前綴 'custom:'。status='draft'：不出現在
--      v_groups_student／v_items_student、抽題與審核清單。trg_groups_custom_frozen 讓這一列永遠不能被更新
--      （匯入工具「更新 draft 列後推進狀態」的流程碰不到它）。
--   3. 新增 submission_custom_prompts：一份提交一列，存題目本文與設定；submission_id 與 user_id 都
--      ON DELETE CASCADE（刪提交、刪帳號時一起刪）；rev 是修改次數（送批改時確認題目沒被改過）。
--      trg_custom_prompts_owner_*：題目列的 user_id 必須等於那份提交的 user_id，而且那份提交是自訂題。
-- submissions、item_groups 的 CHECK 與外鍵都不用改；submissions.kind 沿用 'essay'。
-- 種子資料用 INSERT … ON CONFLICT(主鍵) DO NOTHING：只略過「已經有這一列」，CHECK 或 NOT NULL 寫錯會讓遷移失敗
-- （INSERT OR IGNORE 會連 CHECK 錯誤一起吞掉，遷移照樣記為已套用）。其他一律 IF NOT EXISTS，整支檔案可以重跑
-- （沒有 ALTER TABLE）；不寫 PRAGMA 與 BEGIN／COMMIT（同 0001 的慣例）。
-- 自訂題的分數不進入任何能力估計、分數預測或排行（score_predictions、user_ability 等）：題目由學生提供，
-- 分數可以被題目寬鬆程度影響。之後寫彙總查詢時加 group_id <> 'custom:essay@1'（DB_SCHEMA §3.6）。

INSERT INTO licenses (code, name, url, attribution_required, adaptation_allowed, share_alike, commercial_ok, notes) VALUES
  ('user-provided', '使用者自行提供的內容', NULL, 0, 0, 0, 0,
   '學生自己輸入或貼上的作文題目：只存在該學生的提交（submission_custom_prompts），只顯示給本人、只為批改送 AI；不公開、不進題庫')
ON CONFLICT(code) DO NOTHING;

INSERT INTO item_groups
  (id, uid, version, section_type, origin, pool, source_key, format_version, figures_json, extra_json,
   pick_order, license, derivation, share_alike, commercial_ok, status, content_hash, face_hash, answer_hash, tier)
VALUES
  ('custom:essay@1', 'custom:essay', 1, 'composition', 'human', 'practice', NULL, 'composition-custom-1', '[]',
   '{"placeholder":"custom-essay","prompt_table":"submission_custom_prompts"}',
   0, 'user-provided', 'original', 0, 0, 'draft', 'custom-essay-placeholder', 'custom-essay-placeholder', 'none', NULL)
ON CONFLICT(id) DO NOTHING;

CREATE TRIGGER IF NOT EXISTS trg_groups_custom_frozen BEFORE UPDATE ON item_groups
WHEN OLD.id LIKE 'custom:%'
BEGIN SELECT RAISE(ABORT, 'custom placeholder group is frozen'); END;

CREATE TABLE IF NOT EXISTS submission_custom_prompts (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,  -- 提交（一份一列；只有 group_id='custom:essay@1'）
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,       -- 使用者（每句查詢都帶 user_id，防 IDOR）
  prompt_text   TEXT NOT NULL CHECK (length(prompt_text) BETWEEN 1 AND 1000),  -- 題目（正規化、遮掉聯絡方式後；程式另外要求不含空白至少 10 字）
  figure_text   TEXT CHECK (figure_text IS NULL OR length(figure_text) BETWEEN 1 AND 800),  -- 圖片或圖表的文字描述（學生撰寫）
  paragraphs    INTEGER CHECK (paragraphs IS NULL OR paragraphs BETWEEN 1 AND 5),  -- 段數要求；NULL＝不指定
  min_words     INTEGER CHECK (min_words IS NULL OR min_words BETWEEN 20 AND 600),  -- 至少幾個單詞；NULL＝不指定
  max_words     INTEGER CHECK (max_words IS NULL OR max_words BETWEEN 20 AND 600),  -- 最多幾個單詞；NULL＝不指定
  rev           INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),  -- 修改次數：建立是 1，每次 PUT 題目加 1
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),  -- 最後修改時間
  CHECK (min_words IS NULL OR max_words IS NULL OR min_words <= max_words),
  CHECK (length(prompt_text) + COALESCE(length(figure_text), 0) <= 1200)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_custom_prompts_user ON submission_custom_prompts(user_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_custom_prompts_owner_insert BEFORE INSERT ON submission_custom_prompts
WHEN NOT EXISTS (SELECT 1 FROM submissions WHERE id = NEW.submission_id AND user_id = NEW.user_id AND group_id = 'custom:essay@1')
BEGIN SELECT RAISE(ABORT, 'custom prompt must belong to a custom essay submission of the same user'); END;

CREATE TRIGGER IF NOT EXISTS trg_custom_prompts_owner_update BEFORE UPDATE OF submission_id, user_id ON submission_custom_prompts
WHEN NOT EXISTS (SELECT 1 FROM submissions WHERE id = NEW.submission_id AND user_id = NEW.user_id AND group_id = 'custom:essay@1')
BEGIN SELECT RAISE(ABORT, 'custom prompt must belong to a custom essay submission of the same user'); END;
