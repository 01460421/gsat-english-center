-- 0001_init.sql：學測英文中心的初版資料庫結構（D1／SQLite）。
--
-- 為什麼一次建好全部的表：規格（docs/SPEC.md、docs/ARCHITECTURE.md）已經定案，資料模型一次設計完整，
-- 後面各階段只「開始使用」某些表，不必在考前尖峰改結構。之後真的要改結構，一律新增 0002 以後的遷移檔，
-- 這支檔案一旦套用到線上就不能再修改（見 migrations/README.md）。
-- 每一張表、每一個欄位的用途與設計理由寫在 docs/DB_SCHEMA.md，兩者必須一致（CI 會比對表名與欄位）。
--
-- 共通慣例
--   1. 全部是 STRICT 表：型別錯了直接報錯，不會被 SQLite 默默轉型。從 JSON 原樣搬來、可能是整數也可能是小數的
--      數值（配分、滿分）用 ANY 欄位，整數存回整數、小數存回小數，匯出時 100 不會變成 100.0。
--   2. 時間一律存 Unix 秒（INTEGER）。「台灣日期」另存 tw_day TEXT 'YYYY-MM-DD'（UTC+8，台灣沒有日光節約時間），
--      額度與日彙整都用它。唯一例外是 srs_reviews.reviewed_at_ms（毫秒，兼當冪等鍵）。
--   3. 內容（題組、小題、註解、單字）用有意義、可重現的字串 id；同一份 JSON 重複匯入得到同一個 id，
--      內容庫重建後使用者紀錄照樣對得上。高頻的使用者表（作答、複習、練習、卡片）用 INTEGER 主鍵，
--      冪等改用自然唯一鍵（例如 (session_id, item_id, attempt_no)），控制 D1 的 10 GB 容量。
--      users.id 用 AUTOINCREMENT：刪除的帳號 id 永遠不會被重用，否則舊 cookie 可能對到新帳號。
--   4. *_json 欄位一律 json_valid()，大的另加長度上限，避免單列意外變大（D1 單列上限 2 MB）。
--   5. CHECK 只用在「外部規格定死」的列舉（大題類型、作答模式、狀態機、難度）。會增加的列舉
--      （任務代號、稽核動作、測驗類型、授權代碼…）由程式用 @gsat/shared 的常數陣列驗證，
--      因為 SQLite 改 CHECK 要重建整張表。
--   6. 外鍵：使用者資料 ON DELETE CASCADE；帳本與回報 ON DELETE SET NULL；稽核與審核紀錄刻意不設外鍵
--      （它們的 trigger 禁止 UPDATE，SET NULL 會被擋下）；內容表之間一般外鍵（內容本來就不刪）。
--   7. 只增不減由 trigger 強制，不靠自律：題組、小題、註解、審核紀錄禁止 DELETE；已上架的內容欄位禁止 UPDATE；
--      狀態只能照固定路線前進。唯一的例外是授權撤回的「墓碑化」（清空內文、保留 id 與紀錄）。
--   8. 受著作權保護或只供內部使用的欄位分欄存放（items.restricted_json、vocab_entries.internal_json、
--      item_groups.generation_json），公開與學生端的查詢一律透過檔尾的 v_*_student 檢視表，檢視表根本不含這些欄。
--
-- 注意：建表、建索引、建 trigger、建檢視表一律 IF NOT EXISTS；種子資料用 INSERT OR IGNORE，整支檔案可以重跑。
-- 不寫 PRAGMA 與 BEGIN／COMMIT：D1 預設強制外鍵，遷移由 wrangler 包在交易裡執行。

-- ═════════════════════════════════════════════════════════════════════════════
-- 一、授權、來源、課綱、生成與匯入紀錄
-- ═════════════════════════════════════════════════════════════════════════════

-- 授權類型做成資料：Credits 頁與「可否商用」清單直接由 SQL 產生（04 文件 §1、§7.3）。
CREATE TABLE IF NOT EXISTS licenses (
  code                 TEXT PRIMARY KEY,  -- 授權代碼，例如 'CEEC-exam'、'CC-BY-4.0'、'original-ai'
  name                 TEXT NOT NULL,  -- 顯示名稱
  url                  TEXT,  -- 授權條款網址
  attribution_required INTEGER NOT NULL CHECK (attribution_required IN (0,1)),  -- 是否必須標示出處
  adaptation_allowed   INTEGER NOT NULL CHECK (adaptation_allowed IN (0,1)),  -- 是否可改作（挖空、改寫都算改作）
  share_alike          INTEGER NOT NULL CHECK (share_alike IN (0,1)),  -- 改作後是否須以相同授權釋出
  commercial_ok        INTEGER NOT NULL CHECK (commercial_ok IN (0,1)),  -- 可否商用；「營利須書面同意」也記 0
  notes                TEXT  -- 補充說明
) STRICT;

INSERT OR IGNORE INTO licenses (code, name, url, attribution_required, adaptation_allowed, share_alike, commercial_ok, notes) VALUES
  ('CEEC-exam',      '大考中心歷屆試題（著作權法第 9 條第 1 項第 5 款）', NULL, 0, 1, 0, 1, '試題本身不得為著作權標的；慣例上仍標示來源年度並連到官方 PDF'),
  ('CEEC-restricted','大考中心評分原則與非選擇題參考答案', NULL, 1, 0, 0, 0, '受著作權保護：只供內部 AI 批改參考，不對外顯示全文（04 文件 §4.3）'),
  ('CEEC-wordlist',  '大考中心《高中英文參考詞彙表（111 學年度起適用）》', NULL, 1, 0, 0, 0, '非營利使用並註明出處；營利須事前書面同意'),
  ('original-ai',    '本站以 AI 原創（人工審核）', NULL, 0, 1, 0, 1, '依 Anthropic 條款歸客戶；純 AI 產出在我國可能不受著作權保護'),
  ('original-human', '本站人工撰寫', NULL, 0, 1, 0, 1, NULL),
  ('facts-only',     '事實素材（只存事實與網址，不存原句）', NULL, 1, 1, 0, 1, '事實不受著作權保護（著作權法第 10-1 條）；仍列參考連結'),
  ('CC-BY-4.0',      'Creative Commons 姓名標示 4.0', 'https://creativecommons.org/licenses/by/4.0/', 1, 1, 0, 1, NULL),
  ('CC-BY-3.0',      'Creative Commons 姓名標示 3.0', 'https://creativecommons.org/licenses/by/3.0/', 1, 1, 0, 1, NULL),
  ('CC-BY-2.0-FR',   'Creative Commons 姓名標示 2.0 法國', 'https://creativecommons.org/licenses/by/2.0/fr/', 1, 1, 0, 1, 'Tatoeba 例句：逐句標示作者與連結'),
  ('CC0-1.0',        'Creative Commons CC0 1.0（公眾領域貢獻）', 'https://creativecommons.org/publicdomain/zero/1.0/', 0, 1, 0, 1, 'Tatoeba 部分英文句（lexicon.json 有 96 句）；慣例上仍標示作者與連結'),
  ('CEFR-J',         'CEFR-J Wordlist 使用條款', 'https://www.cefr-j.org/download.html', 1, 1, 0, 1, '研究與商業使用皆可，須適當標示（data/vocab/sources.json 的 cefrj）'),
  ('WordNet-Princeton','Princeton WordNet License', 'https://wordnet.princeton.edu/license-and-commercial-use', 1, 1, 0, 1, 'OEWN 衍生自 Princeton WordNet，須保留其授權聲明（04 文件 §7.1）'),
  ('CC-BY-SA-4.0',   'Creative Commons 姓名標示－相同方式分享 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/', 1, 1, 1, 1, '改作須以相容授權釋出，題庫獨立存放'),
  ('MIT',            'MIT License', 'https://opensource.org/license/mit', 1, 1, 0, 1, 'ECDICT 等；保留版權聲明'),
  ('TW-OGDL-1.0',    '政府資料開放授權條款－第1版', 'https://data.gov.tw/license', 1, 1, 0, 1, '依顯名聲明標示；與 CC BY 4.0 相容');

-- 來源：一份考卷、一個資料集版本、一篇可改作的文章、一份事實單（04 文件 §7.3）。
CREATE TABLE IF NOT EXISTS sources (
  id               TEXT PRIMARY KEY,  -- 'ceec:gsat-115'、'fact:sdg14-0007'、'owid:co2-2025'、'ecdict@bc015ed'
  kind             TEXT NOT NULL CHECK (kind IN ('exam','article','dataset','dictionary','corpus','fact_sheet','image','other')),  -- 來源種類
  name             TEXT NOT NULL,  -- 顯示名稱
  url              TEXT,  -- 原始網址
  license          TEXT NOT NULL REFERENCES licenses(code),  -- 授權代碼
  attribution_text TEXT,  -- 畫面上要顯示的標示文字
  version          TEXT,  -- 資料集版本或取得版本
  sha256           TEXT,  -- 原始檔雜湊（原始檔在 data/raw/，不進 git；雜湊進資料庫）
  retrieved_at     INTEGER,  -- 取得時間
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())  -- 建立時間
) STRICT;

-- 108 課綱代碼（data/curriculum/english-108.json）。
CREATE TABLE IF NOT EXISTS curriculum_codes (
  code             TEXT PRIMARY KEY,  -- code_ascii，例如 '3-V-12'、'Ac-V-3'、'S-U-A2'
  code_display     TEXT NOT NULL,  -- 原字，例如 '3-Ⅴ-12'
  kind             TEXT NOT NULL CHECK (kind IN ('performance','content','competency')),  -- 學習表現／學習內容／核心素養
  category         TEXT NOT NULL,  -- 類別，例如 '3'、'Ac'、'A2'
  text_zh          TEXT NOT NULL,  -- 條目原文
  advanced         INTEGER NOT NULL DEFAULT 0 CHECK (advanced IN (0,1)),  -- 星號（較高階）條目
  recurring        INTEGER NOT NULL DEFAULT 0 CHECK (recurring IN (0,1)),  -- 雙圈（重複出現）條目
  assessed_in_gsat INTEGER NOT NULL DEFAULT 0 CHECK (assessed_in_gsat IN (0,1))  -- 學測紙筆測驗是否評量（01 文件 §6.3）
) STRICT;

-- 句型與轉承詞（data/curriculum/grammar-patterns.json）。片語另存 phrases 表。
CREATE TABLE IF NOT EXISTS grammar_patterns (
  id         TEXT PRIMARY KEY,  -- 'gp-present-perfect'、'cn-however'
  kind       TEXT NOT NULL CHECK (kind IN ('pattern','connective')),  -- 句型／轉承詞
  name_zh    TEXT NOT NULL,  -- 中文名稱；轉承詞放功能，例如「轉折（對比）」
  pattern    TEXT NOT NULL,  -- 句型公式或轉承詞本身
  category   TEXT,  -- 句型類別（時態、子句…）或轉承詞功能
  body_json  TEXT NOT NULL CHECK (json_valid(body_json)),  -- 原始條目（例句、程度、課本出處、歷屆中譯英引用）
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())  -- 最後匯入時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_patterns_kind ON grammar_patterns(kind, category);

-- 一次生成工作：Claude Code 代理通道、Message Batches 通道、人工或程式。
CREATE TABLE IF NOT EXISTS gen_runs (
  id                 TEXT PRIMARY KEY,  -- 'agent-2026-10-20-wb-adv-01'、'batch-msgbatch_01ab…'
  channel            TEXT NOT NULL CHECK (channel IN ('agent','batch','human','program')),  -- 生成通道
  purpose            TEXT NOT NULL CHECK (purpose IN ('generate','verify','annotate','enrich')),  -- 出題／驗證／註解／單字增補
  section_type       TEXT,  -- 題型（單字增補為 NULL）
  tier               TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top')),  -- 目標難度
  model              TEXT,  -- 模型 ID（代理通道也要記，例如 'claude-opus-5-5'）
  effort             TEXT CHECK (effort IS NULL OR effort IN ('low','medium','high','xhigh','max')),  -- effort 設定
  prompt_id          TEXT,  -- 提示詞範本名稱（prompts/ 下）
  prompt_sha256      TEXT,  -- 範本＋schema＋難度規格的雜湊：改一個字就是新值
  spec_id            TEXT,  -- 難度規格版本，例如 'word_bank-advanced@2026-10'
  request_count      INTEGER,  -- 請求數或題組數
  est_cost_micros    INTEGER CHECK (est_cost_micros IS NULL OR est_cost_micros >= 0),  -- 送出前估價（微美元）；代理通道為 NULL
  cost_micros        INTEGER CHECK (cost_micros IS NULL OR cost_micros >= 0),  -- 實際花費（微美元）
  status             TEXT NOT NULL CHECK (status IN ('running','submitted','ended','collected','failed','canceled')),  -- 狀態
  anthropic_batch_id TEXT,  -- Batch 通道的批次 id
  git_sha            TEXT,  -- 產生時的 commit
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  ended_at           INTEGER,  -- 完成時間
  collected_at       INTEGER,  -- 結果收取時間
  remote_deleted_at  INTEGER  -- 已呼叫 DELETE /v1/messages/batches/{id} 的時間
) STRICT;

-- 每一次匯入（content-import.yml 用 wrangler d1 execute 執行產生的 SQL 檔）。
CREATE TABLE IF NOT EXISTS import_runs (
  id                 TEXT PRIMARY KEY,  -- '{kind}-{git sha 前 12 碼}-{時間}'
  kind               TEXT NOT NULL CHECK (kind IN ('curriculum','exams','bank','annotations','vocab','decisions','batch','params')),  -- 匯入種類
  git_sha            TEXT NOT NULL,  -- 來源 commit
  bookmark           TEXT,  -- 匯入前的 D1 Time Travel 書籤，出事可還原到匯入前
  counts_before_json TEXT CHECK (counts_before_json IS NULL OR json_valid(counts_before_json)),  -- 匯入前各表筆數
  counts_after_json  TEXT CHECK (counts_after_json IS NULL OR json_valid(counts_after_json)),  -- 匯入後各表筆數（只能增加，守門用）
  status             TEXT NOT NULL CHECK (status IN ('started','succeeded','failed')),  -- 狀態
  error              TEXT,  -- 失敗原因
  started_at         INTEGER NOT NULL,  -- 開始時間
  finished_at        INTEGER  -- 結束時間
) STRICT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 二、單字（先建，因為 items.answer_entry_id 參照它）
-- ═════════════════════════════════════════════════════════════════════════════

-- 詞彙表條目（data/vocab/ceec-wordlist.json＋lexicon.json，6,012 筆）。主鍵是 entry_id，因為 word 不唯一（03 文件 §6.3）。
-- entry_id ＝ '{word}|{pos 以 / 相接}|{level}'；lexicon.json 已帶這個值，只有 ceec-wordlist.json 時由匯入程式照同一規則算出。
CREATE TABLE IF NOT EXISTS vocab_entries (
  id             TEXT PRIMARY KEY,  -- entry_id，例如 'address|v./n.|2'
  word           TEXT NOT NULL,  -- 原表主要詞形
  word_norm      TEXT NOT NULL,  -- 小寫、去重音、彎引號轉 '
  display_word   TEXT,  -- 顯示用詞形（例如 capitalism、a.m.；NULL＝同 word）
  level          INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 6),  -- 級別；附錄詞為 NULL
  list_name      TEXT NOT NULL DEFAULT 'ceec-111' CHECK (list_name IN ('ceec-111','appendix','curriculum-2000','extra')),  -- 所屬清單
  pos_json       TEXT NOT NULL CHECK (json_valid(pos_json)),  -- 詞類，保留原表順序（第一個最常用）
  pos_primary    TEXT NOT NULL,  -- 第一個詞類
  raw            TEXT,  -- 原表文字
  pages_json     TEXT CHECK (pages_json IS NULL OR json_valid(pages_json)),  -- 原表印刷頁碼 {"alpha":53,"level":1}（ceec-wordlist.json 的 pages；「回原表第 N 頁查看」，03 文件 §9.2）
  variants_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(variants_json)),  -- 斜線與括號變體
  tags_json      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),  -- 解析標記，例如 'slash-forms'
  forms_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(forms_json)),  -- 屈折變化（ECDICT exchange）
  ipa            TEXT,  -- 音標
  zh_json        TEXT CHECK (zh_json IS NULL OR json_valid(zh_json)),  -- ECDICT 中文釋義（MIT），含是否和詞類相符
  en_def         TEXT,  -- 英文定義（OEWN）
  cefr           TEXT CHECK (cefr IS NULL OR cefr IN ('A1','A2','B1','B2','C1','C2')),  -- 參考 CEFR（CEFR-J）
  freq_rank      INTEGER,  -- ECDICT frq
  bnc_rank       INTEGER,  -- ECDICT bnc
  family_id      TEXT,  -- 詞族 id（accurate／accuracy 串在一起）
  wordnet_json   TEXT CHECK (wordnet_json IS NULL OR (json_valid(wordnet_json) AND length(wordnet_json) <= 131072)),  -- OEWN 原始資料（義項、同義、上位詞）
  internal_json  TEXT CHECK (internal_json IS NULL OR json_valid(internal_json)),  -- Collins 星級、Oxford 旗標：只當排序特徵，學生端永不回傳（04 §7.4）
  extra_json     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),  -- lexicon.json 中沒有成欄的欄位原樣保存（ipa_source、en_def_source、cefr 明細、sources、variant_info），匯出無損
  cambridge_slug TEXT NOT NULL,  -- Cambridge 英漢繁體外連的 slug
  enrich_version INTEGER NOT NULL DEFAULT 0,  -- 代理增補版本；0＝尚未增補
  data_version   TEXT NOT NULL  -- lexicon.json 的 sha256 前 12 碼
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vocab_level  ON vocab_entries(level, word_norm);
CREATE INDEX IF NOT EXISTS idx_vocab_word   ON vocab_entries(word_norm);
CREATE INDEX IF NOT EXISTS idx_vocab_family ON vocab_entries(family_id) WHERE family_id IS NOT NULL;

-- 詞形 → 條目（data/vocab/forms-index.json：16,953 個詞形、17,073 組對應）。點字查詞與文章指標都靠它。
CREATE TABLE IF NOT EXISTS vocab_forms (
  form_norm  TEXT NOT NULL,  -- 正規化詞形
  entry_id   TEXT NOT NULL REFERENCES vocab_entries(id),  -- 對應條目
  types_json TEXT NOT NULL CHECK (json_valid(types_json)),  -- lemma、slash、plural、past…（照 forms-index.json）
  base_json  TEXT CHECK (base_json IS NULL OR json_valid(base_json)),  -- 若是某個變體的屈折形，記變體（陣列）
  extra_pos  INTEGER NOT NULL DEFAULT 0 CHECK (extra_pos IN (0,1)),  -- 只供詞形還原、不屬於原表詞類的屈折形
  rank       INTEGER NOT NULL DEFAULT 0,  -- 同形多筆時的排序（forms-index 的順序）
  PRIMARY KEY (form_norm, entry_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_forms_entry ON vocab_forms(entry_id);

-- 義項：OEWN、ECDICT 與代理整理（依歷屆考題用法排序）。
CREATE TABLE IF NOT EXISTS vocab_senses (
  id            TEXT PRIMARY KEY,  -- '{entry_id}#{source}:{key}'，key 由來源決定且穩定
  entry_id      TEXT NOT NULL REFERENCES vocab_entries(id),  -- 所屬條目
  source        TEXT NOT NULL CHECK (source IN ('oewn','ecdict','agent','batch','human')),  -- 來源
  ord           INTEGER NOT NULL,  -- 顯示順序
  pos           TEXT NOT NULL,  -- 詞類
  gloss_zh      TEXT,  -- 中文義（台灣用語）
  def_en        TEXT,  -- 英文定義
  usage_note_zh TEXT,  -- 用法說明
  exam_hits     INTEGER NOT NULL DEFAULT 0,  -- 歷屆考題用到這個義項的次數
  exam_salient  INTEGER NOT NULL DEFAULT 0 CHECK (exam_salient IN (0,1)),  -- 學測常考的延伸義（多義選義卡用）
  synset_id     TEXT,  -- OEWN synset
  review_status TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged')),  -- flagged 的不顯示
  UNIQUE (entry_id, source, ord)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_senses_entry ON vocab_senses(entry_id, source, ord);

-- 片語：課綱要求當成一個語意單位（01 文件 §7.2），也是 SRS 卡片。
CREATE TABLE IF NOT EXISTS phrases (
  id            TEXT PRIMARY KEY,  -- 'ph:deal-with'
  text          TEXT NOT NULL,  -- 片語
  text_norm     TEXT NOT NULL UNIQUE,  -- 正規化
  head_entry_id TEXT REFERENCES vocab_entries(id),  -- 中心詞條目
  kind          TEXT NOT NULL CHECK (kind IN ('phrasal_verb','idiom','fixed_collocation','prep_phrase','pattern')),  -- 片語種類
  meaning_zh    TEXT NOT NULL,  -- 中文義
  pattern       TEXT,  -- 'deal with + N'
  level_est     INTEGER CHECK (level_est IS NULL OR level_est BETWEEN 1 AND 6),  -- 估計級別
  exam_hits     INTEGER NOT NULL DEFAULT 0,  -- 歷屆出現次數
  source        TEXT NOT NULL CHECK (source IN ('exam','grammar_patterns','agent','batch','human')),  -- 來源
  review_status TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged'))  -- 審核狀態
) STRICT;
CREATE INDEX IF NOT EXISTS idx_phrases_head ON phrases(head_entry_id);

-- 同義、近義、反義、詞族、易混淆、搭配詞、上位詞。
CREATE TABLE IF NOT EXISTS vocab_relations (
  id               INTEGER PRIMARY KEY,  -- 流水號
  entry_id         TEXT NOT NULL REFERENCES vocab_entries(id),  -- 來源條目
  sense_id         TEXT REFERENCES vocab_senses(id),  -- 屬於哪個義項（可空）
  rel              TEXT NOT NULL CHECK (rel IN ('synonym','near_synonym','antonym','derivation','family','confusable','collocation','phrase','hypernym')),  -- 關係
  target_entry_id  TEXT REFERENCES vocab_entries(id),  -- 詞彙表內的目標字
  target_phrase_id TEXT REFERENCES phrases(id),  -- 目標片語
  target_text      TEXT NOT NULL,  -- 顯示文字；詞彙表外的字只放這裡
  note_zh          TEXT,  -- 近義辨析、易混淆說明
  pattern          TEXT,  -- 搭配詞型：'V + N'、'adj + N'
  strength         REAL,  -- 搭配強度或相似度
  source           TEXT NOT NULL CHECK (source IN ('oewn','ecdict','exam','ngram','agent','batch','human')),  -- 來源
  review_status    TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged'))  -- 審核狀態
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vocab_rel ON vocab_relations(entry_id, rel, target_text, IFNULL(sense_id, ''));
CREATE INDEX IF NOT EXISTS idx_rel_target ON vocab_relations(target_entry_id) WHERE target_entry_id IS NOT NULL;

-- 例句：Tatoeba（逐句標作者）、歷屆考題原句、AI 例句（標「AI 生成」）。
CREATE TABLE IF NOT EXISTS vocab_examples (
  id           TEXT PRIMARY KEY,  -- '{entry_id 或 phrase_id}#tatoeba:1337'、'#exam:{item_id}'、'#ai:{hash}'：同一句 Tatoeba 會掛在多個條目（lexicon.json 有 3,577 句被 2–10 個條目共用），id 要含所屬條目才不會互相覆蓋
  entry_id     TEXT REFERENCES vocab_entries(id),  -- 所屬條目
  phrase_id    TEXT REFERENCES phrases(id),  -- 所屬片語
  sense_id     TEXT REFERENCES vocab_senses(id),  -- 所屬義項
  ord          INTEGER NOT NULL DEFAULT 0,  -- 顯示順序
  en           TEXT NOT NULL,  -- 英文句
  zh           TEXT,  -- 中文翻譯
  zh_source_ref TEXT,  -- 中文譯句在來源內的 id（Tatoeba 中文句號）
  zh_author    TEXT,  -- 中文譯句作者（Tatoeba 的中文句是另一位作者，同樣要標示）
  zh_license   TEXT REFERENCES licenses(code),  -- 中文譯句授權
  zh_converted INTEGER CHECK (zh_converted IS NULL OR zh_converted IN (0,1)),  -- 1＝已用 OpenCC 轉成台灣用語（改作，標示時註明「經本站轉換」）
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('tatoeba','oewn','exam','agent','batch')),  -- 來源種類
  source_ref   TEXT,  -- 來源內的 id（Tatoeba 句號、題目 id）
  author       TEXT,  -- 作者（Tatoeba 必填）
  license      TEXT NOT NULL REFERENCES licenses(code),  -- 授權
  url          TEXT,  -- 原句連結
  within_level INTEGER CHECK (within_level IS NULL OR within_level IN (0,1)),  -- 句中其他字是否都在學生程度內
  cloze_ok     INTEGER NOT NULL DEFAULT 0 CHECK (cloze_ok IN (0,1)),  -- 可否用來出例句填空（語境足以推出目標字）
  CHECK (entry_id IS NOT NULL OR phrase_id IS NOT NULL),
  -- Tatoeba 例句逐句標示作者（04 文件 §7.1）：英文句與中文譯句的作者都必填
  CHECK (source_kind <> 'tatoeba' OR (author IS NOT NULL AND (zh IS NULL OR (zh_author IS NOT NULL AND zh_license IS NOT NULL))))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_examples_entry  ON vocab_examples(entry_id, ord);
CREATE INDEX IF NOT EXISTS idx_examples_phrase ON vocab_examples(phrase_id, ord) WHERE phrase_id IS NOT NULL;

-- 歷屆出現統計與重要度（程式計算；畫面顯示組成，不是黑箱）。
CREATE TABLE IF NOT EXISTS vocab_exam_stats (
  entry_id         TEXT PRIMARY KEY REFERENCES vocab_entries(id),  -- 條目
  as_answer        INTEGER NOT NULL DEFAULT 0,  -- 當正解次數
  as_answer_phrase INTEGER NOT NULL DEFAULT 0,  -- 在片語正解中的次數
  as_distractor    INTEGER NOT NULL DEFAULT 0,  -- 當干擾選項次數
  in_stem          INTEGER NOT NULL DEFAULT 0,  -- 在題幹出現次數
  in_passage       INTEGER NOT NULL DEFAULT 0,  -- 在選文出現次數
  papers           INTEGER NOT NULL DEFAULT 0,  -- 出現過的考卷數
  papers_current   INTEGER NOT NULL DEFAULT 0,  -- 現制（111 起）考卷數
  last_year        INTEGER,  -- 最近一次出現的學年度
  by_section_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(by_section_json)),  -- 依大題的出現次數
  components_json  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(components_json)),  -- 重要度的各項組成（畫面上點開看）
  importance       REAL NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 100),  -- 重要度 0–100
  importance_tier  TEXT NOT NULL CHECK (importance_tier IN ('A','B','C','D')),  -- 分級
  formula_version  TEXT NOT NULL,  -- 公式版本，例如 'imp@1'
  computed_at      INTEGER NOT NULL  -- 計算時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vstats_importance ON vocab_exam_stats(importance_tier, importance DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- 三、題庫：試卷、題組、小題（歷屆題與 AI 題共用）
-- ═════════════════════════════════════════════════════════════════════════════

-- 試卷是「組裝資訊」：哪些題組、什麼順序。內容本身在 item_groups／items。
-- 歷屆卷的 gsat-exam/v1.1 頂層欄位：必填欄位成欄，選填欄位（parts）與規格外欄位原樣放 extra_json。
CREATE TABLE IF NOT EXISTS papers (
  id              TEXT PRIMARY KEY,  -- 'gsat-115'、'ref-98-a'、'mock-adv-0001'、'ckpt-a-01'
  kind            TEXT NOT NULL CHECK (kind IN ('official','reference','mock','checkpoint')),  -- 正式卷／參考試卷／本站模擬卷／檢核卷
  exam            TEXT CHECK (exam IS NULL OR exam IN ('gsat','ast','reference')),  -- 原 JSON 的 exam；本站卷為 NULL
  year            INTEGER,  -- 學年度；本站卷為 NULL
  session         TEXT CHECK (session IS NULL OR session IN ('regular','makeup')),  -- 正式／補考；本站卷為 NULL
  era             TEXT NOT NULL CHECK (era IN ('gsat-legacy','gsat-current','ast','reference','site')),  -- 時期
  title           TEXT NOT NULL,  -- 標題（逐字）
  time_minutes    INTEGER,  -- 作答時間
  full_score      ANY CHECK (typeof(full_score) IN ('integer','real','null')),  -- 滿分（原樣保留整數或小數）
  schema_id       TEXT,  -- 'gsat-exam/v1.1'；本站卷為 NULL
  sources_json    TEXT CHECK (sources_json IS NULL OR json_valid(sources_json)),  -- 原 JSON 的 sources（內部路徑，不對外）
  extraction_json TEXT CHECK (extraction_json IS NULL OR json_valid(extraction_json)),  -- 原 JSON 的 extraction（解析紀錄，不對外）
  extra_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),  -- 選填與規格外的頂層欄位（例如 parts）
  verified        INTEGER GENERATED ALWAYS AS (CASE WHEN json_extract(extraction_json, '$.verified_by') IS NOT NULL THEN 1 ELSE 0 END) VIRTUAL,  -- 是否經過查證
  blueprint       TEXT,  -- 本站卷的藍圖，例如 'gsat-current@115'
  tier            TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top')),  -- 本站卷的難度
  status          TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','retired')),  -- 狀態
  content_hash    TEXT NOT NULL,  -- 整份 JSON 的雜湊（偵測來源有沒有改）
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())  -- 最後更新時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_papers_kind_year ON papers(kind, year);

CREATE TABLE IF NOT EXISTS paper_sections (
  paper_id     TEXT NOT NULL REFERENCES papers(id),  -- 試卷
  ord          INTEGER NOT NULL CHECK (ord >= 1),  -- 第幾大題（從 1 起）
  section_key  TEXT NOT NULL,  -- 原 JSON 的大題 id，例如 's1'
  type         TEXT NOT NULL CHECK (type IN ('vocabulary','cloze','word_bank','structure','reading','mixed','sentence_matching','short_answer','translation','composition','other')),  -- 大題類型
  title        TEXT NOT NULL,  -- 大題標題（逐字）
  part         TEXT,  -- 題本的部分名稱；舊卷為 NULL
  instructions TEXT NOT NULL,  -- 說明（逐字）
  points_total ANY CHECK (typeof(points_total) IN ('integer','real','null')),  -- 配分
  extra_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),  -- 選填與規格外欄位（例如 stats 分數分布）
  PRIMARY KEY (paper_id, ord),
  UNIQUE (paper_id, section_key)
) STRICT;

-- 題組（選文）：內容的最小單位，帶版本，只增不減。詞彙題也包成題組。
-- gsat-exam/v1.1 的 group：必填欄位成欄，選填（group_label）與規格外欄位原樣放 extra_json。
CREATE TABLE IF NOT EXISTS item_groups (
  id                 TEXT PRIMARY KEY,  -- '{uid}@{version}'，例如 'gsat-115.s6g1@1'
  uid                TEXT NOT NULL,  -- 跨版本不變的題組代號：歷屆 '{paper}.{group}'、AI 'ai.wb.7f3a9c'
  version            INTEGER NOT NULL CHECK (version >= 1),  -- 版本
  section_type       TEXT NOT NULL CHECK (section_type IN ('vocabulary','cloze','word_bank','structure','reading','mixed','sentence_matching','short_answer','translation','composition','other')),  -- 題型
  origin             TEXT NOT NULL CHECK (origin IN ('ceec','agent','batch','human')),  -- 來源：歷屆／代理／批次／人工
  pool               TEXT NOT NULL DEFAULT 'practice' CHECK (pool IN ('practice','checkpoint')),  -- checkpoint＝檢核卷專用，不進練習、不公開
  source_key         TEXT,  -- 原 JSON 的題組 id（'s6g1'），匯出時還原
  format_version     TEXT NOT NULL,  -- 格式版本：'structure-4x5'、'structure-4x4'、'word_bank-10x10'、'cloze-5'、'reading-4'…
  passage            TEXT,  -- 選文；空格寫成 [[題號]]（AI 題 [[1]]…[[n]]）
  passage_parts_json TEXT CHECK (passage_parts_json IS NULL OR json_valid(passage_parts_json)),  -- 多文本
  figures_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(figures_json) AND json_type(figures_json) = 'array'),  -- 圖表；AI 圖表題多一個 chart 物件
  options_bank_json  TEXT CHECK (options_bank_json IS NULL OR json_valid(options_bank_json)),  -- 選項庫（文意選填、篇章結構）
  tags_json          TEXT CHECK (tags_json IS NULL OR json_valid(tags_json)),  -- 題組標註（topic、genre、sdgs、text_format）；原樣保留
  extra_json         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),  -- 選填與規格外欄位（group_label…）
  group_label        TEXT GENERATED ALWAYS AS (json_extract(extra_json, '$.group_label')) VIRTUAL,  -- 題本印的題組標示
  topic              TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.topic')) VIRTUAL,  -- 主題
  genre              TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.genre')) VIRTUAL,  -- 文體
  text_format        TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.text_format')) VIRTUAL,  -- 文本形式
  -- 以下是衍生欄位：可以更新（校正用），不屬於內容，不在 content_hash 裡
  tier               TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top')),  -- 難度
  tier_basis         TEXT CHECK (tier_basis IS NULL OR tier_basis IN ('official_fit','official_p','spec','calibrated','manual')),  -- 難度依據
  theta70            REAL,  -- 題組平均的 θ70（預測答對率 70% 的能力位置，SPEC §3）
  word_count         INTEGER,  -- 選文字數
  cov_l1_4           REAL CHECK (cov_l1_4 IS NULL OR cov_l1_4 BETWEEN 0 AND 1),  -- L1–4 token 覆蓋率
  cov_l1_6           REAL CHECK (cov_l1_6 IS NULL OR cov_l1_6 BETWEEN 0 AND 1),  -- L1–6 token 覆蓋率
  offlist_ratio      REAL CHECK (offlist_ratio IS NULL OR offlist_ratio BETWEEN 0 AND 1),  -- 表外字比例
  metrics_json       TEXT CHECK (metrics_json IS NULL OR json_valid(metrics_json)),  -- tools/text_metrics.py 完整輸出
  glossary_json      TEXT CHECK (glossary_json IS NULL OR (json_valid(glossary_json) AND length(glossary_json) <= 262144)),  -- 選文 token → 條目、級別（點字查詞、生字標示）
  pick_order         INTEGER NOT NULL,  -- 匯入時給的亂數：抽題走索引，不用 ORDER BY random()
  -- 授權（取所有來源中最嚴格者；明細在 group_sources）
  license            TEXT NOT NULL REFERENCES licenses(code),  -- 授權代碼
  derivation         TEXT NOT NULL CHECK (derivation IN ('verbatim','adapted','ai-original-from-facts','original')),  -- 衍生方式
  share_alike        INTEGER NOT NULL DEFAULT 0 CHECK (share_alike IN (0,1)),  -- 相同方式分享
  commercial_ok      INTEGER NOT NULL DEFAULT 1 CHECK (commercial_ok IN (0,1)),  -- 可否商用
  attribution_text   TEXT,  -- 畫面標示文字
  -- 來歷與審核
  gen_run_id         TEXT REFERENCES gen_runs(id),  -- 生成批次
  generation_json    TEXT CHECK (generation_json IS NULL OR json_valid(generation_json)),  -- 模型、提示詞版本、custom_id：只供內部
  status             TEXT NOT NULL CHECK (status IN ('draft','verifying','needs_review','published','quarantined','rejected','retired','withdrawn')),  -- 狀態機（trigger 強制）
  review_lot         TEXT,  -- 整批抽樣審核的批號
  approval_mode      TEXT CHECK (approval_mode IS NULL OR approval_mode IN ('official','individual','lot_sample')),  -- 核准方式
  approved_by        INTEGER,  -- users.id；刻意不設外鍵（帳號刪除後紀錄仍在）
  approved_at        INTEGER,  -- 核准時間
  supersedes_id      TEXT REFERENCES item_groups(id),  -- 取代的舊版本
  status_reason      TEXT,  -- 下架、隔離、退回的原因
  content_hash       TEXT NOT NULL,  -- 整個題組（含小題、受保護欄位）的雜湊：匯入時偵測有沒有改
  face_hash          TEXT NOT NULL,  -- 只算學生看得到的欄位：跨版本合併統計用
  answer_hash        TEXT NOT NULL,  -- 各小題 answer_hash 的雜湊：解析綁定用
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  published_at       INTEGER,  -- 上架時間
  retired_at         INTEGER,  -- 下架時間
  tombstoned_at      INTEGER,  -- 墓碑化時間（授權撤回）
  UNIQUE (uid, version),
  CHECK (status <> 'withdrawn' OR (tombstoned_at IS NOT NULL AND passage IS NULL AND passage_parts_json IS NULL AND figures_json = '[]' AND options_bank_json IS NULL AND tags_json IS NULL AND extra_json = '{}' AND metrics_json IS NULL AND glossary_json IS NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_groups_pick ON item_groups(section_type, tier, status, pool, pick_order);
CREATE INDEX IF NOT EXISTS idx_groups_uid  ON item_groups(uid, version);
CREATE INDEX IF NOT EXISTS idx_groups_lot  ON item_groups(review_lot, status) WHERE review_lot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_groups_review ON item_groups(status, section_type) WHERE status IN ('needs_review','quarantined');
CREATE INDEX IF NOT EXISTS idx_groups_topic ON item_groups(section_type, topic) WHERE status = 'published';

-- 小題。gsat-exam/v1.1 的 question：必填欄位成欄；選填（refers_to、scoring_exception、reused_from、answer_table）
-- 與規格外欄位原樣放 extra_json；受保護欄位放 restricted_json（見下）。
CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,  -- '{group_id}#{label}'，例如 'gsat-115.s6g1@1#47'
  group_id        TEXT NOT NULL REFERENCES item_groups(id),  -- 所屬題組版本
  group_uid       TEXT NOT NULL,  -- 題組 uid（反正規化；跨版本找同一題用）
  section_type    TEXT NOT NULL,  -- 題型（反正規化）
  ord             INTEGER NOT NULL CHECK (ord >= 1),  -- 題組內順序
  no              INTEGER NOT NULL,  -- 題號（v1.1 編號規則）；AI 題 1…n
  label           TEXT NOT NULL,  -- 題本印的題號字串，例如 '47A'、'中譯英1'
  mode            TEXT NOT NULL CHECK (mode IN ('single_choice','multi_select','bank_choice','fill_in_blank','short_answer','table_completion','translation','composition')),  -- 作答模式
  stem            TEXT,  -- 題幹（逐字）
  options_json    TEXT CHECK (options_json IS NULL OR json_valid(options_json)),  -- 選項
  answer_json     TEXT CHECK (answer_json IS NULL OR json_valid(answer_json)),  -- 答案：單選字母、多選陣列、填充字串、JSON null；中譯英一律 NULL（官方譯文在 restricted_json）
  accepted_json   TEXT CHECK (accepted_json IS NULL OR json_valid(accepted_json)),  -- 其他可接受答案；中譯英一律 NULL
  points          ANY CHECK (typeof(points) IN ('integer','real','null')),  -- 配分（原樣）
  stats_json      TEXT CHECK (stats_json IS NULL OR json_valid(stats_json)),  -- 大考中心統計（原樣）
  tags_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'object'),  -- 小題標註（原樣）
  restricted_json TEXT CHECK (restricted_json IS NULL OR (json_valid(restricted_json) AND json_type(restricted_json) = 'object')),  -- 受保護：scoring_notes；中譯英的 answer、accepted_answers、answer_segments、answer_variants、answer_is_composite。學生端永不 SELECT
  extra_json      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object'),  -- 選填與規格外欄位
  answer_hash     TEXT NOT NULL,  -- 答案、可接受答案、計分例外的雜湊：作答與解析綁定它
  test_point      TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.test_point')) VIRTUAL,  -- 考點
  answer_pos      TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.answer_pos')) VIRTUAL,  -- 答案詞性
  grammar_point   TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.grammar_point')) VIRTUAL,  -- 文法點
  item_type       TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.item_type')) VIRTUAL,  -- 閱讀題目類型
  clue            TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.clue')) VIRTUAL,  -- 篇章結構線索類型
  skill           TEXT GENERATED ALWAYS AS (COALESCE(json_extract(tags_json, '$.test_point'), json_extract(tags_json, '$.item_type'), json_extract(tags_json, '$.clue'))) VIRTUAL,  -- 主要技能（錯題重測找同技能新題）
  correct_rate    REAL GENERATED ALWAYS AS (json_extract(stats_json, '$.correct_rate')) VIRTUAL,  -- 全國答對率
  discrimination  REAL GENERATED ALWAYS AS (json_extract(stats_json, '$.discrimination')) VIRTUAL,  -- 鑑別度
  -- 衍生欄位（匯入時由程式算出，可更新）
  answer_entry_id TEXT REFERENCES vocab_entries(id),  -- 詞彙類題目的正解條目
  answer_level    INTEGER CHECK (answer_level IS NULL OR answer_level BETWEEN 1 AND 6),  -- 正解級別
  tier            TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top')),  -- 小題難度
  UNIQUE (group_id, label),
  UNIQUE (group_id, ord),
  CHECK (mode <> 'translation' OR (answer_json IS NULL AND accepted_json IS NULL)),
  CHECK (mode NOT IN ('single_choice','bank_choice') OR (answer_json IS NOT NULL AND json_type(answer_json) = 'text')),
  CHECK (mode <> 'multi_select' OR (answer_json IS NOT NULL AND json_type(answer_json) = 'array')),
  CHECK (mode <> 'composition' OR (answer_json IS NOT NULL AND answer_json = 'null'))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_items_uid_label  ON items(group_uid, label);
CREATE INDEX IF NOT EXISTS idx_items_skill      ON items(section_type, skill) WHERE skill IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_test_point ON items(test_point) WHERE test_point IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_items_entry      ON items(answer_entry_id) WHERE answer_entry_id IS NOT NULL;

-- 試卷的題組順序。可以更新（歷屆題修正後改指新版本），每次都記在 import_runs。
CREATE TABLE IF NOT EXISTS paper_groups (
  paper_id    TEXT NOT NULL,  -- 試卷
  section_ord INTEGER NOT NULL,  -- 第幾大題
  ord         INTEGER NOT NULL CHECK (ord >= 1),  -- 大題內第幾個題組
  group_id    TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  no_offset   INTEGER NOT NULL DEFAULT 0,  -- 本站卷重新編號用；歷屆卷為 0
  PRIMARY KEY (paper_id, section_ord, ord),
  FOREIGN KEY (paper_id, section_ord) REFERENCES paper_sections(paper_id, ord)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_paper_groups_group ON paper_groups(group_id);

-- 題組版本 ↔ 來源（授權明細）。
CREATE TABLE IF NOT EXISTS group_sources (
  group_id  TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  source_id TEXT NOT NULL REFERENCES sources(id),  -- 來源
  role      TEXT NOT NULL CHECK (role IN ('exam','fact','adapted_text','data','image')),  -- 來源角色
  locator   TEXT,  -- 頁碼、資料欄位等定位資訊
  PRIMARY KEY (group_id, source_id, role)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_group_sources_source ON group_sources(source_id);

-- 小題 ↔ 課綱代碼。basis 標明是本站判讀（inferred）還是大考中心〈試題特色〉引用（ceec_feature）。
CREATE TABLE IF NOT EXISTS item_curriculum (
  item_id TEXT NOT NULL REFERENCES items(id),  -- 小題
  code    TEXT NOT NULL REFERENCES curriculum_codes(code),  -- 課綱代碼
  weight  TEXT NOT NULL CHECK (weight IN ('primary','secondary')),  -- 主要／次要
  basis   TEXT NOT NULL CHECK (basis IN ('inferred','ceec_feature','generator')),  -- 判讀依據
  PRIMARY KEY (item_id, code)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_item_curriculum_code ON item_curriculum(code);

-- 題目參數（共同量尺，SPEC §3）：歷屆題由官方 Pa–Pe 或 P 換算，AI 題先用規格、上線後用作答校正。可更新。
CREATE TABLE IF NOT EXISTS item_params (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),  -- 小題（版本）
  a          REAL,  -- 鑑別參數
  b          REAL,  -- 難度位置（學測母體 θ~N(0,1)）
  c          REAL,  -- 猜測參數（依作答形式固定）
  theta70    REAL,  -- 預測答對率 70% 的能力位置：三種難度的分級依據
  se         REAL,  -- 標準誤
  n          INTEGER NOT NULL DEFAULT 0,  -- 校正用的作答數
  basis      TEXT NOT NULL CHECK (basis IN ('official_fit','official_p','spec','online','manual')),  -- 參數來源
  fit_json   TEXT CHECK (fit_json IS NULL OR json_valid(fit_json)),  -- 擬合殘差、可信區間
  updated_at INTEGER NOT NULL  -- 更新時間
) STRICT;

-- 註解：解析、中譯、評分規準、範文、生字推測、思考表達題、排除法矩陣。
-- 和題目內容分開版本：改一個錯字不必出新題組。綁 group_uid＋answer_hash：答案一改，舊解析自動不顯示。
CREATE TABLE IF NOT EXISTS annotations (
  id          TEXT PRIMARY KEY,  -- '{group_uid}:{kind}@{version}'
  group_uid   TEXT NOT NULL,  -- 題組 uid（跨版本）
  kind        TEXT NOT NULL,  -- explanations｜translation_zh｜rubric｜model_texts｜guess_targets｜open_tasks｜elimination（程式驗證）
  version     INTEGER NOT NULL CHECK (version >= 1),  -- 註解版本
  answer_hash TEXT,  -- 依賴答案的註解必填，必須等於題組目前版本的 answer_hash 才顯示
  body_json   TEXT NOT NULL CHECK (json_valid(body_json) AND length(body_json) <= 262144),  -- 內容
  origin      TEXT NOT NULL CHECK (origin IN ('program','agent','batch','human')),  -- 來源
  gen_run_id  TEXT REFERENCES gen_runs(id),  -- 生成批次
  status      TEXT NOT NULL CHECK (status IN ('needs_review','published','rejected','retired','withdrawn')),  -- 狀態
  approved_by INTEGER,  -- users.id（不設外鍵）
  approved_at INTEGER,  -- 核准時間
  body_hash   TEXT NOT NULL,  -- 內容雜湊
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  UNIQUE (group_uid, kind, version),
  CHECK (status <> 'withdrawn' OR body_json = '{}')
) STRICT;
CREATE INDEX IF NOT EXISTS idx_annotations_live ON annotations(group_uid, kind, status, version);

-- 驗證與審核紀錄（程式檢查、盲解、干擾稽核、唯一正解、相似度、事實、人工、回報處理、上線後監控）。只增不減。
CREATE TABLE IF NOT EXISTS item_reviews (
  id          INTEGER PRIMARY KEY,  -- 流水號
  group_id    TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  kind        TEXT NOT NULL CHECK (kind IN ('program','blind_solver','distractor_audit','unique_solution','similarity','fact_check','grader_check','human','report_triage','stats_monitor')),  -- 檢查種類
  reviewer    TEXT NOT NULL,  -- 模型 ID、'validate_bank.py@<sha>'、'admin:{users.id}'
  verdict     TEXT NOT NULL CHECK (verdict IN ('pass','warn','fail','revise','info')),  -- 判定
  report_json TEXT NOT NULL CHECK (json_valid(report_json) AND length(report_json) <= 65536),  -- 報告
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())  -- 建立時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_item_reviews_group ON item_reviews(group_id, kind, created_at);

-- 站內作答統計（Cron 彙整，不在每次作答時寫）。只算同一個 answer_hash 下、符合校正條件的作答。
CREATE TABLE IF NOT EXISTS item_stats (
  item_id               TEXT PRIMARY KEY REFERENCES items(id),  -- 小題（版本）
  answer_hash           TEXT NOT NULL,  -- 統計所依據的答案版本
  n_first               INTEGER NOT NULL DEFAULT 0,  -- 校正用作答數（首次接觸、沒看答案、沒用提示、沒開作答中鷹架、非過快）
  n_first_correct       REAL NOT NULL DEFAULT 0,  -- 其中答對（部分給分以比例累計）
  n_all                 INTEGER NOT NULL DEFAULT 0,  -- 全部作答數
  option_counts_json    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(option_counts_json)),  -- 各選項人數
  top_option_counts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(top_option_counts_json)),  -- 能力前 27% 的選項分布
  p_value               REAL,  -- 首答答對率
  disc_index            REAL,  -- 前後 27% 答對率差
  time_ms_median        INTEGER,  -- 作答時間中位數
  rapid_rate            REAL,  -- 過快作答比例
  flags_json            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(flags_json)),  -- 'negative_discrimination'、'top_prefers_distractor'、'dead_distractor'…
  cursor_attempt_id     INTEGER NOT NULL DEFAULT 0,  -- 已彙整到哪一筆 attempts.id
  updated_at            INTEGER NOT NULL  -- 更新時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_item_stats_flags ON item_stats(updated_at) WHERE flags_json <> '[]';

-- 授權撤回與權利人來信的處理紀錄（搭配題組墓碑化與 data/takedowns.jsonl）。不存請求者個資。
CREATE TABLE IF NOT EXISTS takedowns (
  id             TEXT PRIMARY KEY,  -- 'td-2027-0001'
  target_kind    TEXT NOT NULL CHECK (target_kind IN ('group','annotation','source','vocab_example','other')),  -- 撤回對象種類
  target_id      TEXT NOT NULL,  -- 對象 id（題組 uid、來源 id…）
  reason         TEXT NOT NULL,  -- 原因摘要
  requester_kind TEXT NOT NULL CHECK (requester_kind IN ('rights_holder','ceec','internal','other')),  -- 請求者類型
  received_at    INTEGER NOT NULL,  -- 收到時間
  completed_at   INTEGER,  -- 完成時間（D1 墓碑化＋git 登記都完成）
  git_ref        TEXT,  -- 對應 data/takedowns.jsonl 的 commit
  notes          TEXT  -- 補充
) STRICT;

-- 詞彙在歷屆題的出現明細（衍生表，可重建）：詞頁「在哪幾年哪一題出現過」。
CREATE TABLE IF NOT EXISTS vocab_exam_occurrences (
  entry_id   TEXT NOT NULL REFERENCES vocab_entries(id),  -- 條目
  group_id   TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  item_label TEXT NOT NULL DEFAULT '',  -- 小題；選文層級為 ''
  role       TEXT NOT NULL CHECK (role IN ('answer','answer_in_phrase','distractor','stem','passage','option_bank')),  -- 出現角色
  surface    TEXT NOT NULL,  -- 原文詞形
  hits       INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 1),  -- 次數
  paper_id   TEXT NOT NULL,  -- 試卷
  year       INTEGER NOT NULL,  -- 學年度
  era        TEXT NOT NULL,  -- 時期
  PRIMARY KEY (entry_id, group_id, item_label, role)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_occ_entry_year ON vocab_exam_occurrences(entry_id, year DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- 四、帳號、同意、偏好
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,  -- 內部 id（cookie 內的 u）；AUTOINCREMENT 保證不重用
  public_id           TEXT NOT NULL UNIQUE,  -- crypto.randomUUID()：匯出、後台網址用
  google_sub          TEXT NOT NULL UNIQUE,  -- Google 帳號識別鍵（不用 email）
  email               TEXT NOT NULL,  -- 只供登入識別與管理員聯絡；介面不顯示
  display_name        TEXT CHECK (display_name IS NULL OR length(display_name) <= 40),  -- 暱稱
  role                TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin')),  -- 角色
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleting')),  -- 帳號狀態
  age_band            TEXT CHECK (age_band IS NULL OR age_band IN ('under18','18plus')),  -- 首次登入自述的年齡區間（不收生日）
  ai_status           TEXT NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none','pending','waitlist','approved','rejected','suspended')),  -- AI 核准狀態
  ai_tier             TEXT NOT NULL DEFAULT 'standard' CHECK (ai_tier IN ('trial','standard','unlimited')),  -- 額度等級
  ai_points_day       INTEGER CHECK (ai_points_day IS NULL OR ai_points_day >= 0),  -- 每日點數個別覆寫
  ai_points_month     INTEGER CHECK (ai_points_month IS NULL OR ai_points_month >= 0),  -- 每月點數個別覆寫
  ai_applied_at       INTEGER,  -- 最近一次申請時間（冷卻用）
  ai_apply_count      INTEGER NOT NULL DEFAULT 0 CHECK (ai_apply_count BETWEEN 0 AND 10),  -- 申請次數（上限 10）
  ai_apply_note       TEXT CHECK (ai_apply_note IS NULL OR length(ai_apply_note) <= 300),  -- 申請說明：不可信資料
  ai_invite_hash      TEXT,  -- 用了哪個邀請碼（雜湊）
  ai_reviewed_by      INTEGER,  -- 核准者 users.id（不設外鍵）
  ai_reviewed_at      INTEGER,  -- 核准時間
  session_ver         INTEGER NOT NULL DEFAULT 1 CHECK (session_ver >= 1),  -- +1＝所有裝置登出
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  last_active_day     TEXT,  -- 最後活動的台灣日期（一天最多寫一次）
  delete_requested_at INTEGER,  -- 申請刪除的時間
  CHECK (status <> 'deleting' OR delete_requested_at IS NOT NULL)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_users_ai_queue ON users(ai_status, ai_applied_at) WHERE ai_status IN ('pending','waitlist');
CREATE INDEX IF NOT EXISTS idx_users_inactive ON users(last_active_day);
CREATE INDEX IF NOT EXISTS idx_users_deleting ON users(delete_requested_at) WHERE status = 'deleting';

-- 同意紀錄：依種類分版本，只增不改；條款改版時看得出每個人同意的是哪一版。
CREATE TABLE IF NOT EXISTS consents (
  id         INTEGER PRIMARY KEY,  -- 流水號
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  kind       TEXT NOT NULL CHECK (kind IN ('privacy','terms','ai_processing','guardian_ack','improve_grading')),  -- 同意種類；ai_processing 含「傳給 Anthropic（境外）處理」
  version    TEXT NOT NULL,  -- 條款版本，例如 '2026-11-01'
  granted    INTEGER NOT NULL CHECK (granted IN (0,1)),  -- 1＝同意、0＝撤回
  created_at INTEGER NOT NULL DEFAULT (unixepoch())  -- 時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents(user_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  target_tier        TEXT NOT NULL DEFAULT 'advanced' CHECK (target_tier IN ('basic','advanced','top')),  -- 目標難度
  target_level       INTEGER CHECK (target_level IS NULL OR target_level BETWEEN 1 AND 15),  -- 目標級分
  exam_date          TEXT CHECK (exam_date IS NULL OR exam_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),  -- 考試日（排程不跨過它）
  srs_daily_new      INTEGER NOT NULL DEFAULT 15 CHECK (srs_daily_new BETWEEN 0 AND 100),  -- 每日新字數
  srs_retention      REAL NOT NULL DEFAULT 0.9 CHECK (srs_retention BETWEEN 0.7 AND 0.97),  -- FSRS 目標保留率
  srs_decks_json     TEXT NOT NULL DEFAULT '["L3","L4","L5"]' CHECK (json_valid(srs_decks_json)),  -- 學習範圍
  srs_params_json    TEXT CHECK (srs_params_json IS NULL OR json_valid(srs_params_json)),  -- 個人化 FSRS 權重（Phase 5）
  confidence_enabled INTEGER NOT NULL DEFAULT 1 CHECK (confidence_enabled IN (0,1)),  -- 作答時是否詢問信心
  essay_retention    TEXT NOT NULL DEFAULT '1y' CHECK (essay_retention IN ('30d','1y','forever')),  -- 作文保存期限（學生自選）
  scale_year         INTEGER NOT NULL DEFAULT 115,  -- 級分換算用哪一年的對照表
  ui_json            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ui_json) AND length(ui_json) <= 8192),  -- 介面偏好（不放作答紀錄）
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())  -- 更新時間
) STRICT;

CREATE TABLE IF NOT EXISTS invite_codes (
  code_hash  TEXT PRIMARY KEY,  -- SHA-256(邀請碼)；原碼只在建立時顯示一次
  label      TEXT NOT NULL,  -- 例如「某校 302 班」
  ai_tier    TEXT NOT NULL CHECK (ai_tier IN ('trial','standard')),  -- 核准後的額度等級
  max_uses   INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 500),  -- 可用次數
  used       INTEGER NOT NULL DEFAULT 0,  -- 已用次數（條件式 UPDATE，不會超用）
  expires_at INTEGER NOT NULL,  -- 到期時間
  revoked_at INTEGER,  -- 撤銷時間
  created_by INTEGER NOT NULL,  -- 建立者 users.id（不設外鍵）
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  CHECK (used BETWEEN 0 AND max_uses)
) STRICT;

-- 給學生的站內通知（答案更正後重算分數、條款改版、批改完成）。
CREATE TABLE IF NOT EXISTS user_notices (
  id         INTEGER PRIMARY KEY,  -- 流水號
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  kind       TEXT NOT NULL,  -- 'regrade'、'terms_update'、'grading_done'、'relogin'（程式白名單）
  ref_id     TEXT,  -- 相關 id
  params_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params_json) AND length(params_json) <= 2048),  -- 文案參數（不放學生內容）
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  read_at    INTEGER  -- 已讀時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_notices_user ON user_notices(user_id, created_at DESC);

-- ═════════════════════════════════════════════════════════════════════════════
-- 五、作答、錯題、間隔重複、學習分析
-- ═════════════════════════════════════════════════════════════════════════════

-- 一次練習、一份試卷、一次模擬考、一次重測或檢核。
CREATE TABLE IF NOT EXISTS practice_sessions (
  id                  INTEGER PRIMARY KEY,  -- 內部 id
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  client_id           TEXT NOT NULL,  -- 前端產生的 UUID（重送冪等）
  kind                TEXT NOT NULL CHECK (kind IN ('set','paper','mock','retest','checkpoint','diagnostic')),  -- 種類
  paper_id            TEXT REFERENCES papers(id),  -- 整份試卷時
  section_type        TEXT,  -- 題型
  tier                TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top')),  -- 難度
  config_json         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json) AND length(config_json) <= 16384),  -- 計時模式、提示開關、題組清單（凍結版本）
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','abandoned')),  -- 狀態
  draft_json          TEXT CHECK (draft_json IS NULL OR (json_valid(draft_json) AND length(draft_json) <= 65536)),  -- 模擬考暫存（每 30 秒）
  started_at          INTEGER NOT NULL,  -- 開始時間（伺服器時鐘）
  deadline_at         INTEGER,  -- 模擬考期限
  submitted_at        INTEGER,  -- 交卷時間
  elapsed_s           INTEGER CHECK (elapsed_s IS NULL OR elapsed_s >= 0),  -- 用時
  raw_score           REAL,  -- 原得分
  max_score           REAL,  -- 滿分
  section_scores_json TEXT CHECK (section_scores_json IS NULL OR json_valid(section_scores_json)),  -- 各大題得分與用時
  scaled_score        INTEGER CHECK (scaled_score IS NULL OR scaled_score BETWEEN 0 AND 15),  -- 級分（非官方）
  scale_year          INTEGER,  -- 換算年度
  pending_writing     INTEGER NOT NULL DEFAULT 0,  -- 還在等 AI 或自評的非選擇題數
  UNIQUE (user_id, client_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON practice_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON practice_sessions(user_id, kind) WHERE status = 'in_progress';

-- 逐題作答：學習分析、難度校正、錯題的根據。整數主鍵、不放長字串（容量）；冪等鍵是 (session_id, item_id, attempt_no)。
-- 難度校正只用 first_exposure=1、attempt_no=1、hints_used=0、saw_answer=0、rapid=0、scaffold=0、answer_hash 與目前版本相同的作答。
CREATE TABLE IF NOT EXISTS attempts (
  id             INTEGER PRIMARY KEY,  -- 內部 id（Cron 彙整的游標）
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  session_id     INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,  -- 練習
  item_id        TEXT NOT NULL REFERENCES items(id),  -- 小題（版本）
  attempt_no     INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no IN (1,2)),  -- 1＝第一次；2＝「再試一次」（不計分，只更新精熟度）
  answer_hash    TEXT NOT NULL,  -- 評分當下的答案版本（答案更正時找出要重算的作答）
  response_json  TEXT NOT NULL CHECK (json_valid(response_json) AND length(response_json) <= 4096),  -- 作答內容
  score          REAL CHECK (score IS NULL OR score >= 0),  -- 得分；NULL＝待批改
  max_score      REAL NOT NULL CHECK (max_score >= 0),  -- 滿分
  is_correct     INTEGER CHECK (is_correct IS NULL OR is_correct IN (0,1)),  -- 是否全對；NULL＝待批改
  scoring        TEXT NOT NULL CHECK (scoring IN ('auto','variant','partial_rule','ai','self','pending','regrade')),  -- 這一分怎麼來的
  first_exposure INTEGER NOT NULL CHECK (first_exposure IN (0,1)),  -- 這個人第一次接觸這個題組
  hints_used     INTEGER NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3),  -- 用了幾層提示
  saw_answer     INTEGER NOT NULL DEFAULT 0 CHECK (saw_answer IN (0,1)),  -- 作答前是否已看過答案或解析
  confidence     INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 2),  -- 0 猜的、1 有點把握、2 確定；關閉時 NULL
  error_tag      TEXT,  -- 學生自評的錯因（vocab、collocation、grammar、context、careless、time、misread）
  time_ms        INTEGER CHECK (time_ms IS NULL OR time_ms BETWEEN 0 AND 7200000),  -- 作答時間
  rapid          INTEGER NOT NULL DEFAULT 0 CHECK (rapid IN (0,1)),  -- 過快作答（不計入校正）
  scaffold       INTEGER NOT NULL DEFAULT 0 CHECK (scaffold BETWEEN 0 AND 255),  -- 作答中鷹架位元旗標：1 逐格回饋、2 詞性預判、4 比較表或「從文中選取」；非 0 不計入難度校正（SPEC §3.6、§4.2）
  answered_at    INTEGER NOT NULL,  -- 作答時間（前端時鐘，伺服器做合理性檢查）
  UNIQUE (session_id, item_id, attempt_no)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_attempts_user_time ON attempts(user_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_attempts_item_hash ON attempts(item_id, answer_hash);

-- 每人接觸過哪些題組（跨版本）：抽題排除、判斷 first_exposure。比掃 attempts 便宜得多。
CREATE TABLE IF NOT EXISTS user_group_seen (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  group_uid TEXT NOT NULL,  -- 題組 uid
  first_at  INTEGER NOT NULL,  -- 第一次接觸
  last_at   INTEGER NOT NULL,  -- 最近一次
  times     INTEGER NOT NULL DEFAULT 1,  -- 次數
  PRIMARY KEY (user_id, group_uid)
) STRICT, WITHOUT ROWID;

-- 答案更正後的重算紀錄（attempts.score 被更新，原分數留在這裡）。
CREATE TABLE IF NOT EXISTS attempt_regrades (
  attempt_id      INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,  -- 作答
  correction_id   TEXT NOT NULL,  -- answer_corrections.id
  regraded_at     INTEGER NOT NULL,  -- 重算時間
  old_score       REAL,  -- 原分數
  new_score       REAL,  -- 新分數
  old_answer_hash TEXT NOT NULL,  -- 原答案版本
  new_answer_hash TEXT NOT NULL,  -- 新答案版本
  PRIMARY KEY (attempt_id, correction_id)
) STRICT, WITHOUT ROWID;

-- 答案更正流程：隔離 → 新版本 → 試算影響 → 確認 → 重算 → 通知（SPEC §4.7）。
CREATE TABLE IF NOT EXISTS answer_corrections (
  id                TEXT PRIMARY KEY,  -- UUID
  group_uid         TEXT NOT NULL,  -- 題組 uid
  from_group_id     TEXT NOT NULL REFERENCES item_groups(id),  -- 舊版本
  to_group_id       TEXT NOT NULL REFERENCES item_groups(id),  -- 新版本
  status            TEXT NOT NULL CHECK (status IN ('dry_run','confirmed','applied','canceled')),  -- 狀態
  affected_attempts INTEGER,  -- 試算：受影響作答數
  affected_users    INTEGER,  -- 試算：受影響人數
  dry_run_json      TEXT CHECK (dry_run_json IS NULL OR json_valid(dry_run_json)),  -- 試算的分數變化分布
  created_by        INTEGER NOT NULL,  -- 管理員 users.id（不設外鍵）
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  applied_at        INTEGER  -- 完成時間
) STRICT;

-- 間隔重複卡片：單字（認得／會拼／用法）、多義、片語、句型、錯題重測。
CREATE TABLE IF NOT EXISTS srs_cards (
  id             INTEGER PRIMARY KEY,  -- 內部 id
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  kind           TEXT NOT NULL CHECK (kind IN ('word','spell','usage','sense','phrase','pattern','item')),  -- 卡別
  entry_id       TEXT REFERENCES vocab_entries(id),  -- 單字卡
  sense_id       TEXT REFERENCES vocab_senses(id),  -- 多義卡
  phrase_id      TEXT REFERENCES phrases(id),  -- 片語卡
  pattern_id     TEXT REFERENCES grammar_patterns(id),  -- 句型卡
  item_id        TEXT REFERENCES items(id),  -- 錯題卡的原題
  skill_key      TEXT,  -- 錯題卡：'{section_type}:{skill}'，到期時找同技能的新題
  ref_key        TEXT NOT NULL,  -- 去重鍵：entry_id／sense_id／phrase_id／pattern_id／'{group_uid}#{label}'
  origin         TEXT NOT NULL CHECK (origin IN ('deck','wrong_answer','lookup','manual','item_option','translation')),  -- 怎麼建立的
  state          INTEGER NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3),  -- ts-fsrs：0 New 1 Learning 2 Review 3 Relearning
  due_at         INTEGER NOT NULL,  -- 下次到期
  stability      REAL NOT NULL DEFAULT 0,  -- FSRS 穩定度（天）
  difficulty     REAL NOT NULL DEFAULT 0,  -- FSRS 難度
  elapsed_days   INTEGER NOT NULL DEFAULT 0,  -- 距上次複習天數
  scheduled_days INTEGER NOT NULL DEFAULT 0,  -- 排定間隔
  learning_steps INTEGER NOT NULL DEFAULT 0,  -- 學習步驟
  reps           INTEGER NOT NULL DEFAULT 0,  -- 複習次數
  lapses         INTEGER NOT NULL DEFAULT 0,  -- 遺忘次數（≥6 進難字區）
  last_review_at INTEGER,  -- 最近一次複習
  suspended      INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1)),  -- 暫停
  note           TEXT CHECK (note IS NULL OR length(note) <= 500),  -- 學生筆記
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  UNIQUE (user_id, kind, ref_key),
  CHECK ((kind IN ('word','spell','usage') AND entry_id IS NOT NULL)
      OR (kind = 'sense'   AND sense_id   IS NOT NULL)
      OR (kind = 'phrase'  AND phrase_id  IS NOT NULL)
      OR (kind = 'pattern' AND pattern_id IS NOT NULL)
      OR (kind = 'item'    AND item_id    IS NOT NULL AND skill_key IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_cards(user_id, due_at) WHERE suspended = 0;

-- 每次複習一列（FSRS 參數最佳化與學習指標用）。冪等鍵是 (card_id, reviewed_at_ms)。
CREATE TABLE IF NOT EXISTS srs_reviews (
  id                    INTEGER PRIMARY KEY,  -- 內部 id
  card_id               INTEGER NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE,  -- 卡片
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  reviewed_at_ms        INTEGER NOT NULL,  -- 複習時間（毫秒；兼冪等鍵）
  rating                INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),  -- Again／Hard／Good／Easy（多半由作答自動換算）
  quiz_type             TEXT NOT NULL,  -- flashcard、en2zh、context_meaning、sentence_cloze、zh2en、spelling、collocation、synonym、word_family、sense_choice、phrase_cloze、pattern、item_retest（程式白名單）
  served_item_id        TEXT REFERENCES items(id),  -- 錯題卡實際出的題
  is_variant            INTEGER NOT NULL DEFAULT 0 CHECK (is_variant IN (0,1)),  -- 出的是同技能新題（1）還是原題（0）
  counts_for_mastery    INTEGER NOT NULL DEFAULT 1 CHECK (counts_for_mastery IN (0,1)),  -- 原題重做、用了提示：不計入精熟
  hinted                INTEGER NOT NULL DEFAULT 0 CHECK (hinted IN (0,1)),  -- 用了提示（評分最多 Hard）
  state_before          INTEGER NOT NULL,  -- 複習前狀態
  stability_before      REAL,  -- 複習前穩定度
  difficulty_before     REAL,  -- 複習前難度
  retrievability_before REAL,  -- 排程器預測的提取機率（量測排程器準不準）
  due_before            INTEGER,  -- 原到期時間
  elapsed_days          REAL NOT NULL,  -- 距上次複習天數
  scheduled_days        INTEGER NOT NULL,  -- 新排定間隔
  response_ms           INTEGER,  -- 反應時間
  UNIQUE (card_id, reviewed_at_ms)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_srs_reviews_user ON srs_reviews(user_id, reviewed_at_ms);

-- 學習分析的日彙整（作答時 UPSERT；原始作答 13 個月後刪除，這裡保留）。
CREATE TABLE IF NOT EXISTS user_skill_daily (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  tw_day       TEXT NOT NULL,  -- 台灣日期
  section_type TEXT NOT NULL,  -- 題型或 'vocab'
  skill        TEXT NOT NULL,  -- 'all'、'tp:collocation'、'it:inference'、'gp:tense'、'cl:pronoun_reference'
  n            INTEGER NOT NULL DEFAULT 0,  -- 作答數
  correct      REAL NOT NULL DEFAULT 0,  -- 答對（部分給分以比例）
  first_n      INTEGER NOT NULL DEFAULT 0,  -- 其中首次接觸的作答數
  first_correct REAL NOT NULL DEFAULT 0,  -- 其中首次接觸答對
  hints        INTEGER NOT NULL DEFAULT 0,  -- 提示使用次數
  time_ms      INTEGER NOT NULL DEFAULT 0,  -- 累計用時
  PRIMARY KEY (user_id, tw_day, section_type, skill)
) STRICT, WITHOUT ROWID;

-- 預測級分（非官方）：預測當下記一列，下一次模擬考或檢核卷後補上實得，算預測誤差（學習指標 M8）。
CREATE TABLE IF NOT EXISTS score_predictions (
  id                 INTEGER PRIMARY KEY,  -- 流水號
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  made_at            INTEGER NOT NULL,  -- 預測時間
  basis              TEXT NOT NULL CHECK (basis IN ('mock','checkpoint','model')),  -- 依據
  scale_year         INTEGER NOT NULL,  -- 換算年度
  predicted_raw      REAL NOT NULL,  -- 預測原得總分
  raw_low            REAL NOT NULL,  -- 80% 區間下限
  raw_high           REAL NOT NULL,  -- 80% 區間上限
  predicted_level    INTEGER NOT NULL CHECK (predicted_level BETWEEN 0 AND 15),  -- 預測級分
  level_low          INTEGER NOT NULL,  -- 級分區間下限
  level_high         INTEGER NOT NULL,  -- 級分區間上限
  outcome_session_id INTEGER REFERENCES practice_sessions(id) ON DELETE SET NULL,  -- 之後實際作答的模擬考
  outcome_raw        REAL,  -- 實得原始分
  outcome_level      INTEGER  -- 實得級分
) STRICT;
CREATE INDEX IF NOT EXISTS idx_predictions_user ON score_predictions(user_id, made_at DESC);

-- 能力估計（Phase 5：線上校正後才使用）。
CREATE TABLE IF NOT EXISTS user_ability (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  section_type TEXT NOT NULL,  -- 題型或 'overall'
  theta        REAL NOT NULL,  -- 與題目 b 同尺度
  se           REAL NOT NULL,  -- 標準誤
  n            INTEGER NOT NULL,  -- 依據的作答數
  updated_at   INTEGER NOT NULL,  -- 更新時間
  PRIMARY KEY (user_id, section_type)
) STRICT, WITHOUT ROWID;

-- 回報題目錯誤。
CREATE TABLE IF NOT EXISTS item_reports (
  id          TEXT PRIMARY KEY,  -- UUID
  group_id    TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  item_id     TEXT REFERENCES items(id),  -- 小題（可空）
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 回報者
  kind        TEXT NOT NULL CHECK (kind IN ('wrong_answer','two_answers','typo','explanation','offensive','other')),  -- 種類
  message     TEXT CHECK (message IS NULL OR length(message) <= 500),  -- 說明（不可信資料）
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','duplicate')),  -- 處理狀態
  resolved_by INTEGER,  -- 處理者 users.id（不設外鍵）
  resolved_at INTEGER,  -- 處理時間
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())  -- 建立時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_reports_status ON item_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_user   ON item_reports(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_group  ON item_reports(group_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 六、中譯英、作文、思考表達的提交與批改
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS submissions (
  id                  TEXT PRIMARY KEY,  -- UUID
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  kind                TEXT NOT NULL CHECK (kind IN ('translation','essay','open')),  -- 中譯英（2 句一組）／作文／思考表達開放題
  group_id            TEXT NOT NULL REFERENCES item_groups(id),  -- 題組版本
  session_id          INTEGER REFERENCES practice_sessions(id) ON DELETE SET NULL,  -- 模擬考時
  revision_of         TEXT REFERENCES submissions(id) ON DELETE SET NULL,  -- 修訂稿指向原稿
  input_mode          TEXT NOT NULL CHECK (input_mode IN ('typed','photo')),  -- 打字／手寫照片
  body_json           TEXT CHECK (body_json IS NULL OR (json_valid(body_json) AND length(body_json) <= 16384)),  -- 中譯英 [{item_id,text}]；作文 {text, plan}
  self_assess_json    TEXT CHECK (self_assess_json IS NULL OR json_valid(self_assess_json)),  -- 看分數前的自評（四項或各部分）
  ocr_text            TEXT CHECK (ocr_text IS NULL OR length(ocr_text) <= 12000),  -- OCR 原始轉錄（30 天後清空）
  ocr_uncertain_json  TEXT CHECK (ocr_uncertain_json IS NULL OR json_valid(ocr_uncertain_json)),  -- 看不清的位置與候選字
  ocr_diff_json       TEXT CHECK (ocr_diff_json IS NULL OR json_valid(ocr_diff_json)),  -- 學生確認時改了哪些字
  word_count          INTEGER,  -- 字數（程式計算）
  paragraphs          INTEGER,  -- 段落數（程式計算）
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ocr_queued','ocr_ready','confirmed','queued','grading','graded','self_graded','failed')),  -- 狀態機
  lease_until         INTEGER,  -- Queue consumer 用條件式 UPDATE 搶租約
  tries               INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5),  -- 嘗試次數
  op_id               TEXT,  -- ai_ops.id
  final_score         REAL,  -- 最後分數（程式合成）
  final_band          TEXT,  -- 等級
  prev_error_count    INTEGER,  -- 修訂稿：原稿標記的錯誤數
  fixed_count         INTEGER,  -- 修訂稿：改正了幾個（修訂採納率）
  injection_flag      INTEGER NOT NULL DEFAULT 0 CHECK (injection_flag IN (0,1)),  -- 疑似提示注入
  safety_flag         TEXT,  -- 內容涉及身心安全時的旗標（只存類別）
  support_share_until INTEGER,  -- 學生主動分享給管理員到這個時間
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),  -- 更新時間
  graded_at           INTEGER,  -- 批改完成時間
  expires_at          INTEGER  -- 依學生選的保存期限計算；NULL＝直到自己刪除
) STRICT;
CREATE INDEX IF NOT EXISTS idx_sub_user   ON submissions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_work   ON submissions(status, lease_until) WHERE status IN ('ocr_queued','queued','grading');
CREATE INDEX IF NOT EXISTS idx_sub_expire ON submissions(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_shared ON submissions(support_share_until) WHERE support_share_until IS NOT NULL;

-- 手寫照片的中繼資料（本體在私有 R2；批改完成立即刪，R2 生命週期 7 天兜底）。
CREATE TABLE IF NOT EXISTS submission_photos (
  id            TEXT PRIMARY KEY,  -- UUID
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,  -- 提交
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  ord           INTEGER NOT NULL CHECK (ord BETWEEN 1 AND 2),  -- 第幾張
  r2_key        TEXT NOT NULL UNIQUE,  -- 'essay-photos/{users.id}/{submission_id}/{id}.jpg'
  bytes         INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 2097152),  -- 大小（≤2 MB）
  mime          TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/webp','image/png')),  -- 格式
  width         INTEGER,  -- 寬
  height        INTEGER,  -- 高
  sha256        TEXT NOT NULL,  -- 雜湊
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),  -- 上傳時間
  purge_after   INTEGER NOT NULL,  -- 最晚刪除時間（上傳後 7 天）
  purged_at     INTEGER,  -- R2 物件刪除時間
  UNIQUE (submission_id, ord)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_photos_purge ON submission_photos(purge_after) WHERE purged_at IS NULL;

-- 批改結果：一份提交可有第一、第二、第三位評分者與學生自評，各一列（重試不會多寫）。
CREATE TABLE IF NOT EXISTS gradings (
  id              TEXT PRIMARY KEY,  -- UUID
  submission_id   TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,  -- 提交
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  role            TEXT NOT NULL CHECK (role IN ('primary','second','third','self')),  -- 評分者角色
  model           TEXT,  -- 實際服務的模型（自評為 NULL）
  prompt_version  TEXT NOT NULL,  -- 提示詞版本
  rubric_version  TEXT NOT NULL,  -- 'ceec-essay-115'、'translation-4part@1'
  judgments_json  TEXT NOT NULL CHECK (json_valid(judgments_json) AND length(judgments_json) <= 65536),  -- 模型的分項判斷與錯誤清單
  program_score   REAL NOT NULL CHECK (program_score BETWEEN 0 AND 20),  -- 程式依分項與官方規則算出的分數（不採用 AI 給的總分）
  deductions_json TEXT CHECK (deductions_json IS NULL OR json_valid(deductions_json)),  -- 程式判定的扣分（字數、分段、大小寫標點）
  feedback_json   TEXT CHECK (feedback_json IS NULL OR (json_valid(feedback_json) AND length(feedback_json) <= 61440)),  -- 回饋（三個優先改進、改寫、建議句型）
  call_id         INTEGER,  -- ai_calls.id
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  UNIQUE (submission_id, role)
) STRICT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 七、AI 帳本、預算、共用快取、安全事件、家教對話
-- ═════════════════════════════════════════════════════════════════════════════

-- 一次「學生看得到的操作」＝一列，扣固定點數；同時預扣最壞情況的美元（SPEC §9、ARCHITECTURE §6）。
CREATE TABLE IF NOT EXISTS ai_ops (
  id                  TEXT PRIMARY KEY,  -- UUID
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- 使用者（帳號刪除或 13 個月後設為 NULL）
  task                TEXT NOT NULL,  -- 任務代號（程式白名單）
  ref_id              TEXT,  -- submission id／attempt id；不放內容
  status              TEXT NOT NULL CHECK (status IN ('reserved','settled','refunded')),  -- 預扣／結算／退還
  points_reserved     INTEGER NOT NULL CHECK (points_reserved >= 0),  -- 預扣點數
  points_charged      INTEGER CHECK (points_charged IS NULL OR points_charged >= 0),  -- 實扣點數（退還為 0）
  usd_reserved_micros INTEGER NOT NULL CHECK (usd_reserved_micros >= 0),  -- 預扣美元：輸入估計＋max_tokens 全額輸出（最壞情況）
  usd_actual_micros   INTEGER NOT NULL DEFAULT 0 CHECK (usd_actual_micros >= 0),  -- 依 usage 實算（拒答的成本照記）
  settle_token        TEXT,  -- 結算或退還時寫入的隨機值；預算累加只認這個值，重送不會重複累加
  refund_reason       TEXT,  -- 退還原因代碼
  tw_day              TEXT NOT NULL,  -- 台灣日期
  tw_month            TEXT NOT NULL,  -- 台灣月份 'YYYY-MM'
  created_at          INTEGER NOT NULL,  -- 預扣時間
  settled_at          INTEGER  -- 結算或退還時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_ops_user_day   ON ai_ops(user_id, tw_day);
CREATE INDEX IF NOT EXISTS idx_ops_user_month ON ai_ops(user_id, tw_month);
CREATE INDEX IF NOT EXISTS idx_ops_inflight   ON ai_ops(status, usd_reserved_micros, user_id) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_ops_created    ON ai_ops(created_at);

-- 每一次 Anthropic API 呼叫（線上與批次）。只記數字，不存提示詞與回應；使用者只以 HMAC 假名出現。
CREATE TABLE IF NOT EXISTS ai_calls (
  id                    INTEGER PRIMARY KEY,  -- 流水號
  op_id                 TEXT REFERENCES ai_ops(id) ON DELETE SET NULL,  -- 線上操作
  gen_run_id            TEXT REFERENCES gen_runs(id),  -- 批次工作
  channel               TEXT NOT NULL CHECK (channel IN ('online','batch')),  -- 通道
  workspace             TEXT NOT NULL CHECK (workspace IN ('online','pipeline','dev')),  -- Anthropic workspace
  task                  TEXT NOT NULL,  -- 任務代號
  role                  TEXT,  -- 'primary'、'second'、'third'、'ocr'、'judge'、'blind_a'…
  model                 TEXT NOT NULL,  -- 請求的模型 ID
  served_model          TEXT,  -- 實際服務的模型（server-side fallback 時不同）
  effort                TEXT,  -- effort
  prompt_version        TEXT NOT NULL,  -- 提示詞版本（sha 前 12 碼）
  pricing_version       TEXT NOT NULL,  -- 價格表版本：價格調整後舊帳不變
  request_id            TEXT,  -- Anthropic request-id
  stop_reason           TEXT,  -- end_turn、max_tokens、refusal…
  refusal_category      TEXT,  -- 拒答類別（bio、reasoning_extraction…）
  iterations            INTEGER NOT NULL DEFAULT 1,  -- usage.iterations 的嘗試數（fallback 時 >1）
  input_tokens          INTEGER NOT NULL DEFAULT 0,  -- 輸入（各次嘗試加總）
  output_tokens         INTEGER NOT NULL DEFAULT 0,  -- 輸出（含思考）
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,  -- 快取讀取
  cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,  -- 5 分鐘快取寫入
  cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,  -- 1 小時快取寫入
  images                INTEGER NOT NULL DEFAULT 0,  -- 圖片張數
  cost_micros           INTEGER NOT NULL CHECK (cost_micros >= 0),  -- 成本（微美元，逐次嘗試依各自模型單價加總）
  price_pending         INTEGER NOT NULL DEFAULT 0 CHECK (price_pending IN (0,1)),  -- 價格表查不到接手模型：先記「待補價」並告警
  latency_ms            INTEGER,  -- 延遲
  error_code            TEXT,  -- 錯誤代碼
  user_ref              TEXT,  -- HMAC(users.id, LEDGER_SALT)：帳號刪除後無法回推
  tw_day                TEXT NOT NULL,  -- 台灣日期
  created_at            INTEGER NOT NULL DEFAULT (unixepoch())  -- 時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_calls_day ON ai_calls(tw_day, task);
CREATE INDEX IF NOT EXISTS idx_calls_op  ON ai_calls(op_id) WHERE op_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_pending ON ai_calls(created_at) WHERE price_pending = 1;

-- 全站每日預算（結算時累加；預扣時直接讀，不必掃 ai_calls）。
CREATE TABLE IF NOT EXISTS ai_budget_daily (
  tw_day            TEXT PRIMARY KEY,  -- 台灣日期
  online_usd_micros INTEGER NOT NULL DEFAULT 0 CHECK (online_usd_micros >= 0),  -- 線上已結算美元（微美元）
  batch_usd_micros  INTEGER NOT NULL DEFAULT 0 CHECK (batch_usd_micros >= 0),  -- 批次美元
  calls             INTEGER NOT NULL DEFAULT 0,  -- 呼叫次數
  paused            INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),  -- 管理員緊急暫停
  updated_at        INTEGER NOT NULL  -- 更新時間
) STRICT;

-- 每日對帳：本站帳本 vs Anthropic Usage & Cost API（差 >5% 告警）。
CREATE TABLE IF NOT EXISTS ai_reconciliations (
  day                 TEXT NOT NULL,  -- 日期（UTC，與 Anthropic 報表一致）
  workspace           TEXT NOT NULL CHECK (workspace IN ('online','pipeline')),  -- workspace
  ledger_micros       INTEGER NOT NULL,  -- 本站帳本
  provider_micros     INTEGER NOT NULL,  -- Anthropic 報表
  diff_ratio          REAL NOT NULL,  -- 差異比例
  status              TEXT NOT NULL CHECK (status IN ('ok','warn','alert')),  -- 結果
  checked_at          INTEGER NOT NULL,  -- 檢查時間
  PRIMARY KEY (day, workspace)
) STRICT, WITHOUT ROWID;

-- 全站共用的 AI 結果快取：固定問題型追問、混合題 AI 判定、相同答案的中譯英批改。
-- 鍵和學生身分無關：第一個人付費，之後的人免費。不含任何帳號資訊。
CREATE TABLE IF NOT EXISTS ai_shared_cache (
  cache_key      TEXT PRIMARY KEY,  -- sha256(kind|item 或 group id|正規化輸入|prompt_version|rubric_version|model)
  kind           TEXT NOT NULL CHECK (kind IN ('explain_template','short_answer_judge','translation_grade')),  -- 種類
  ref_id         TEXT NOT NULL,  -- 小題或題組版本 id
  prompt_version TEXT NOT NULL,  -- 提示詞版本
  model          TEXT NOT NULL,  -- 產生結果的模型
  result_json    TEXT NOT NULL CHECK (json_valid(result_json) AND length(result_json) <= 32768),  -- 結果
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','flagged','disabled')),  -- 被回報不佳可停用
  hits           INTEGER NOT NULL DEFAULT 0,  -- 命中次數
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  last_hit_at    INTEGER,  -- 最近命中
  expires_at     INTEGER NOT NULL  -- 到期（預設 180 天）
) STRICT;
CREATE INDEX IF NOT EXISTS idx_cache_ref ON ai_shared_cache(ref_id);
CREATE INDEX IF NOT EXISTS idx_cache_expire ON ai_shared_cache(expires_at);

-- 未成年使用者安全事件（Anthropic 未成年人指引的監控與回報）：只存類別，不存內容。
CREATE TABLE IF NOT EXISTS ai_safety_events (
  id          INTEGER PRIMARY KEY,  -- 流水號
  op_id       TEXT,  -- ai_ops.id
  kind        TEXT NOT NULL CHECK (kind IN ('output_filtered','student_report','wellbeing_flag','injection_flag','refusal')),  -- 事件種類
  category    TEXT,  -- 過濾規則或拒答類別
  user_ref    TEXT,  -- HMAC 假名
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),  -- 處理狀態
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),  -- 時間
  reviewed_by INTEGER,  -- 處理者 users.id（不設外鍵）
  reviewed_at INTEGER  -- 處理時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_safety_open ON ai_safety_events(status, created_at);

-- 家教追問（Phase 5）：一串對話一列，訊息逐則一列、只往後加（preserved thinking，06 §1.6 #10）。
CREATE TABLE IF NOT EXISTS chat_threads (
  id         TEXT PRIMARY KEY,  -- UUID
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 使用者
  item_id    TEXT NOT NULL REFERENCES items(id),  -- 針對哪一題
  model      TEXT NOT NULL,  -- 一串對話固定一個模型
  mode       TEXT NOT NULL DEFAULT 'hint' CHECK (mode IN ('hint','explain')),  -- 預設提示模式（引導、不直接給答案）
  turns      INTEGER NOT NULL DEFAULT 0 CHECK (turns BETWEEN 0 AND 8),  -- 輪數（上限 8）
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),  -- 建立時間
  expires_at INTEGER NOT NULL  -- 建立後 7 天
) STRICT;
CREATE INDEX IF NOT EXISTS idx_threads_user   ON chat_threads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_expire ON chat_threads(expires_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  thread_id    TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,  -- 對話
  seq          INTEGER NOT NULL CHECK (seq >= 1),  -- 序號
  role         TEXT NOT NULL CHECK (role IN ('user','assistant','system')),  -- 角色（system＝中途切換模式）
  content_json TEXT NOT NULL CHECK (json_valid(content_json) AND length(content_json) <= 65536),  -- assistant 回傳的完整 content 陣列（含思考簽章），原樣存、原樣送回
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),  -- 時間
  PRIMARY KEY (thread_id, seq)
) STRICT, WITHOUT ROWID;

-- ═════════════════════════════════════════════════════════════════════════════
-- 八、稽核、維運、刪除證明
-- ═════════════════════════════════════════════════════════════════════════════

-- 管理稽核：後台每個動作一列，不存學生內容。trigger 禁止修改、兩年內禁止刪除。
CREATE TABLE IF NOT EXISTS admin_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- 流水號
  actor_id    INTEGER,  -- users.id；刻意不設外鍵（帳號刪除時 SET NULL 會被 trigger 擋下）
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('admin','system','pipeline','user')),  -- 執行者種類
  action      TEXT NOT NULL,  -- 'user.approve'、'content.publish'、'submission.view'…（程式白名單）
  target_kind TEXT,  -- 對象種類
  target_id   TEXT,  -- 對象 id
  reason      TEXT CHECK (reason IS NULL OR length(reason) <= 500),  -- 理由
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 4096),  -- 細節（不放學生內容）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())  -- 時間
) STRICT;
CREATE INDEX IF NOT EXISTS idx_audit_time   ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit(target_kind, target_id);

-- 維運事件與告警（預算 80%、佇列積壓、對帳差異、Cron 失敗、D1 容量…）。
CREATE TABLE IF NOT EXISTS ops_events (
  id          INTEGER PRIMARY KEY,  -- 流水號
  kind        TEXT NOT NULL,  -- 'budget_80'、'budget_paused'、'queue_backlog'、'reconcile_alert'、'cron_failed'、'db_size'…
  severity    TEXT NOT NULL CHECK (severity IN ('info','warn','error')),  -- 嚴重度
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 4096),  -- 細節（不放學生內容）
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),  -- 時間
  acked_at    INTEGER,  -- 確認時間
  acked_by    INTEGER  -- 確認者 users.id
) STRICT;
CREATE INDEX IF NOT EXISTS idx_ops_events_open ON ops_events(severity, created_at) WHERE acked_at IS NULL;

-- 刪除證明：不含個資，只證明「何時、刪了多少」。
CREATE TABLE IF NOT EXISTS deletion_log (
  id           TEXT PRIMARY KEY,  -- UUID
  user_ref     TEXT NOT NULL,  -- HMAC 假名
  kind         TEXT NOT NULL CHECK (kind IN ('account','submission','retention_expiry','idle_account')),  -- 刪除原因
  requested_at INTEGER NOT NULL,  -- 申請或到期時間
  completed_at INTEGER,  -- 完成時間
  rows_json    TEXT CHECK (rows_json IS NULL OR json_valid(rows_json)),  -- 各表刪除列數 {"attempts":1234,…}
  r2_objects   INTEGER NOT NULL DEFAULT 0  -- 刪除的 R2 物件數
) STRICT;

-- ═════════════════════════════════════════════════════════════════════════════
-- 九、trigger：只增不減、狀態機、墓碑化、稽核
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TRIGGER IF NOT EXISTS trg_groups_no_delete BEFORE DELETE ON item_groups
BEGIN SELECT RAISE(ABORT, 'item_groups is append-only; retire or withdraw instead'); END;

-- 上架後內容欄位不可改；唯一例外是改成 withdrawn（墓碑化，表上的 CHECK 保證內文已清空）。
CREATE TRIGGER IF NOT EXISTS trg_groups_immutable
BEFORE UPDATE OF uid, version, section_type, origin, pool, source_key, format_version, passage, passage_parts_json,
                 figures_json, options_bank_json, tags_json, extra_json, license, derivation, share_alike,
                 commercial_ok, content_hash, face_hash, answer_hash, gen_run_id, generation_json ON item_groups
WHEN OLD.status IN ('published','quarantined','retired','withdrawn')
 AND NOT (OLD.status <> 'withdrawn' AND NEW.status = 'withdrawn'
          AND NEW.uid = OLD.uid AND NEW.version = OLD.version AND NEW.content_hash = OLD.content_hash
          AND NEW.face_hash = OLD.face_hash AND NEW.answer_hash = OLD.answer_hash)
BEGIN SELECT RAISE(ABORT, 'published content is immutable; insert a new version'); END;

CREATE TRIGGER IF NOT EXISTS trg_groups_status_flow BEFORE UPDATE OF status ON item_groups
WHEN OLD.status <> NEW.status AND NOT (
     (OLD.status = 'draft'        AND NEW.status IN ('verifying','needs_review','rejected'))
  OR (OLD.status = 'verifying'    AND NEW.status IN ('needs_review','rejected'))
  OR (OLD.status = 'needs_review' AND NEW.status IN ('published','rejected'))
  OR (OLD.status = 'published'    AND NEW.status IN ('quarantined','retired','withdrawn'))
  OR (OLD.status = 'quarantined'  AND NEW.status IN ('published','retired','withdrawn'))
  OR (OLD.status = 'retired'      AND NEW.status = 'withdrawn'))
BEGIN SELECT RAISE(ABORT, 'illegal status transition'); END;

CREATE TRIGGER IF NOT EXISTS trg_items_no_delete BEFORE DELETE ON items
BEGIN SELECT RAISE(ABORT, 'items is append-only'); END;

-- 小題的識別與計分欄位：題組上架後永遠不可改。
CREATE TRIGGER IF NOT EXISTS trg_items_immutable_keys
BEFORE UPDATE OF id, group_id, group_uid, section_type, ord, no, label, mode, answer_json, points, stats_json,
                 tags_json, answer_hash ON items
WHEN (SELECT status FROM item_groups WHERE id = OLD.group_id) IN ('published','quarantined','retired','withdrawn')
BEGIN SELECT RAISE(ABORT, 'published items are immutable'); END;

-- 小題的文字欄位：題組上架後不可改；題組已墓碑化時只允許清空。
CREATE TRIGGER IF NOT EXISTS trg_items_immutable_text
BEFORE UPDATE OF stem, options_json, accepted_json, restricted_json, extra_json ON items
WHEN (SELECT status FROM item_groups WHERE id = OLD.group_id) IN ('published','quarantined','retired','withdrawn')
 AND NOT ((SELECT status FROM item_groups WHERE id = OLD.group_id) = 'withdrawn'
          AND NEW.stem IS NULL AND NEW.options_json IS NULL AND NEW.accepted_json IS NULL
          AND NEW.restricted_json IS NULL AND NEW.extra_json = '{}')
BEGIN SELECT RAISE(ABORT, 'published items are immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_annotations_no_delete BEFORE DELETE ON annotations
BEGIN SELECT RAISE(ABORT, 'annotations is append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_annotations_immutable
BEFORE UPDATE OF group_uid, kind, version, answer_hash, body_json, body_hash, origin ON annotations
WHEN OLD.status IN ('published','retired','withdrawn')
 AND NOT (OLD.status <> 'withdrawn' AND NEW.status = 'withdrawn' AND NEW.body_json = '{}'
          AND NEW.group_uid = OLD.group_uid AND NEW.kind = OLD.kind AND NEW.version = OLD.version)
BEGIN SELECT RAISE(ABORT, 'published annotation is immutable; insert a new version'); END;

CREATE TRIGGER IF NOT EXISTS trg_annotations_status_flow BEFORE UPDATE OF status ON annotations
WHEN OLD.status <> NEW.status AND NOT (
     (OLD.status = 'needs_review' AND NEW.status IN ('published','rejected'))
  OR (OLD.status = 'published'    AND NEW.status IN ('retired','withdrawn'))
  OR (OLD.status = 'retired'      AND NEW.status = 'withdrawn'))
BEGIN SELECT RAISE(ABORT, 'illegal annotation status transition'); END;

CREATE TRIGGER IF NOT EXISTS trg_reviews_no_update BEFORE UPDATE ON item_reviews
BEGIN SELECT RAISE(ABORT, 'item_reviews is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_reviews_no_delete BEFORE DELETE ON item_reviews
BEGIN SELECT RAISE(ABORT, 'item_reviews is append-only'); END;

-- 同意紀錄只增不改；只能隨帳號一起刪（父列已不存在或正在刪除）。
CREATE TRIGGER IF NOT EXISTS trg_consents_no_update BEFORE UPDATE ON consents
BEGIN SELECT RAISE(ABORT, 'consents is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_consents_no_delete BEFORE DELETE ON consents
WHEN EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id AND u.status <> 'deleting')
BEGIN SELECT RAISE(ABORT, 'consents can only be deleted with the account'); END;

CREATE TRIGGER IF NOT EXISTS trg_srs_reviews_no_update BEFORE UPDATE ON srs_reviews
BEGIN SELECT RAISE(ABORT, 'srs_reviews is append-only'); END;

-- 帳本：token 數與成本不可改；只有「待補價」的列可以補上成本一次。
CREATE TRIGGER IF NOT EXISTS trg_calls_immutable
BEFORE UPDATE OF model, served_model, task, input_tokens, output_tokens, cache_read_tokens, cache_write_5m_tokens,
                 cache_write_1h_tokens, images, iterations, pricing_version, created_at ON ai_calls
BEGIN SELECT RAISE(ABORT, 'ai_calls is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_calls_cost
BEFORE UPDATE OF cost_micros, price_pending ON ai_calls
WHEN NOT (OLD.price_pending = 1 AND NEW.price_pending = 0)
BEGIN SELECT RAISE(ABORT, 'ai_calls cost can only be filled once for price_pending rows'); END;
CREATE TRIGGER IF NOT EXISTS trg_calls_retention BEFORE DELETE ON ai_calls
WHEN OLD.created_at > unixepoch() - 730 * 86400
BEGIN SELECT RAISE(ABORT, 'ai_calls rows are kept for 24 months'); END;

CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON admin_audit
BEGIN SELECT RAISE(ABORT, 'admin_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_early_delete BEFORE DELETE ON admin_audit
WHEN OLD.created_at > unixepoch() - 730 * 86400
BEGIN SELECT RAISE(ABORT, 'admin_audit rows are kept for 2 years'); END;

-- ═════════════════════════════════════════════════════════════════════════════
-- 十、學生端檢視表：公開與學生 API 只查這些，受保護欄位根本不在裡面
-- ═════════════════════════════════════════════════════════════════════════════

-- 題組：不含 generation_json、審核欄位；只列已上架、練習池的題組。
CREATE VIEW IF NOT EXISTS v_groups_student AS
SELECT id, uid, version, section_type, source_key, format_version, passage, passage_parts_json, figures_json,
       options_bank_json, tags_json, extra_json, group_label, topic, genre, text_format, tier, theta70, word_count,
       glossary_json, license, derivation, share_alike, attribution_text, face_hash, answer_hash, pick_order, status,
       published_at
FROM item_groups
WHERE status = 'published' AND pool = 'practice';

-- 小題：不含 restricted_json（評分原則、官方中譯英參考譯文）。
-- 學生回看自己做過、之後被隔離或下架的題目也走這裡，所以放行 published／quarantined／retired／withdrawn（墓碑化後文字已清空）；
-- 但一律排除檢核卷題組（pool='checkpoint'，答案不送前端，SPEC §7.4）與還沒上架的題組（draft、verifying、needs_review、rejected），
-- 否則任何以 group_id 查小題的公開端點都會把未審題目與檢核卷的答案送出去。
CREATE VIEW IF NOT EXISTS v_items_student AS
SELECT i.id, i.group_id, i.group_uid, i.section_type, i.ord, i.no, i.label, i.mode, i.stem, i.options_json, i.answer_json,
       i.accepted_json, i.points, i.stats_json, i.tags_json, i.extra_json, i.answer_hash, i.test_point, i.answer_pos,
       i.grammar_point, i.item_type, i.clue, i.skill, i.correct_rate, i.discrimination, i.answer_entry_id, i.answer_level, i.tier
FROM items i JOIN item_groups g ON g.id = i.group_id
WHERE g.pool = 'practice' AND g.status IN ('published','quarantined','retired','withdrawn');

-- 單字：不含 internal_json（Collins／Oxford）。
CREATE VIEW IF NOT EXISTS v_vocab_entries_student AS
SELECT id, word, word_norm, display_word, level, list_name, pos_json, pos_primary, raw, pages_json, variants_json, tags_json,
       forms_json, ipa, zh_json, en_def, cefr, freq_rank, bnc_rank, family_id, wordnet_json, extra_json, cambridge_slug,
       enrich_version, data_version
FROM vocab_entries;

-- 註解：只列已上架的版本，而且所屬題組要是練習池裡已上架過的題組（同上，排除檢核卷與未上架題組的解析）。
CREATE VIEW IF NOT EXISTS v_annotations_student AS
SELECT a.id, a.group_uid, a.kind, a.version, a.answer_hash, a.body_json
FROM annotations a
WHERE a.status = 'published'
  AND EXISTS (SELECT 1 FROM item_groups g
              WHERE g.uid = a.group_uid AND g.pool = 'practice' AND g.status IN ('published','quarantined','retired'));
