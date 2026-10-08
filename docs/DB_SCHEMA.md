# 資料庫設計（D1／SQLite）

> 版本：2026-10-08（初版，對應遷移檔 `apps/api/migrations/0001_init.sql`）。
> 這份文件說明每一張表的用途、欄位、關聯與設計理由，以及歷屆試題（`data/exams/parsed/`）和單字資料（`data/vocab/`）怎麼匯入。**欄位表由遷移檔自動產生**（產生器同時檢查：遷移檔的每張表、每個欄位、每個 trigger、每個檢視表都有出現在本文件，見 §10），兩者保證一致。
> 相關文件：功能規格 `docs/SPEC.md`、系統架構 `docs/ARCHITECTURE.md`、路線圖 `docs/ROADMAP.md`、歷屆試題 JSON 格式 `docs/exam-json-schema.md`。
> 標記：「（未驗證）」＝還沒在 D1 上實測；「（設計值）」＝上線後用資料校正的數字。

**目錄**：[0. 摘要](#0-摘要)｜[1. 設計原則](#1-設計原則)｜[2. 表格總覽與關聯](#2-表格總覽與關聯)｜[3. 各表說明](#3-各表說明)｜[4. trigger 與檢視表](#4-trigger-與檢視表)｜[5. 匯入對應](#5-匯入對應)｜[6. D1 限制與對策](#6-d1-限制與對策)｜[7. 主要查詢與索引](#7-主要查詢索引與-rows_read-上限)｜[8. 容量與保存期限](#8-容量估算與保存期限)｜[9. 備案](#9-d1-功能不支援時的備案)｜[10. 驗證](#10-驗證方式與原型實測結果)

---

## 0. 摘要

給站主的白話版：

1. **一個 D1 資料庫、一支遷移檔、56 張表。** 題庫、單字、帳號、作答、複習、作文批改、AI 帳本都在同一個資料庫（`gsat-english`）。不分兩個資料庫：跨庫沒有外鍵也沒有交易，一個人維運不划算。
2. **歷屆題和 AI 題共用同一套表**（`item_groups` 題組＋`items` 小題）。歷屆考卷可以「匯入 → 匯出」還原成和原檔逐字相同的 JSON：已用目前 66 份 `gsat-exam/v1.1`（776 個題組、3,783 小題）實測，**66／66 完全相同**（§10）。
3. **題目只增不減。** 已上架的題目不能改也不能刪，要改就出新版本；這由資料庫的 trigger 強制，不靠人記得。唯一的例外是權利人要求下架時的「墓碑化」：清空內文、保留編號與紀錄。
4. **受著作權保護的東西分欄放。** 大考中心的評分原則與官方中譯英參考譯文放在 `items.restricted_json`；詞典裡 Collins／Oxford 的內部特徵放在 `vocab_entries.internal_json`。學生端的程式只能查四個「學生檢視表」（`v_*_student`），這些檢視表裡根本沒有那幾欄。
5. **作答紀錄記得夠細，之後才能校正難度、算學習成效**：第一次接觸、用了幾層提示、第幾次嘗試、開了哪些作答中鷹架、作答時間、信心、錯因、評分當下的答案版本。
6. **容量有上限（D1 每個資料庫 10 GB）**，所以作答、複習這類高頻表用整數主鍵、不放長字串，原始紀錄 13 個月後彙整再刪；刪帳號分批進行。
7. **AI 額度用一句 SQL 原子預扣**，同時檢查每人每日／每月點數、每日篇數、同時任務數、全站每日／每月美元（含進行中的預扣）與暫停開關，不會有兩個請求同時扣超的競態（§3.7、已實測）。

## 1. 設計原則

| # | 原則 | 做法 | 理由 |
|---|---|---|---|
| 1 | 單一資料庫 | 只有一個 D1（binding `DB`，沿用骨架的 `wrangler.toml`） | 跨庫沒有外鍵、交易與 JOIN；答案更正重算、統計彙整都要跨表。容量問題用保存期限與彙整解決（§8） |
| 2 | STRICT 表 | 全部表加 `STRICT`；可能是整數也可能是小數的 JSON 數值用 `ANY` 欄位 | 型別錯直接報錯。`REAL` 會把 100 存成 100.0，匯出就不是原檔；`ANY` 原樣保存（原型實測匯出逐字相同） |
| 3 | 內容用有意義的字串 id | 題組 `{uid}@{version}`、小題 `{題組 id}#{label}`、單字 `entry_id` | 同一份 JSON 重複匯入得到同一個 id；內容庫重建後，使用者紀錄照樣對得上（不能用自動流水號，重建會錯位） |
| 4 | 高頻使用者表用整數鍵 | `attempts`、`srs_reviews`、`srs_cards`、`practice_sessions` 用 `INTEGER PRIMARY KEY`；冪等改用自然唯一鍵 | 原型實測：作答表每列（含索引）177 位元組，用 UUID 主鍵與 UUID 外鍵的寫法是 459 位元組；1,000 位活躍學生一年約省 3 GB（§8） |
| 5 | `users.id` 用 AUTOINCREMENT | 外部一律用 `public_id`（UUID） | session cookie 內放 `users.id`；刪掉的 id 若被重用，舊 cookie 可能對到新帳號 |
| 6 | 時間存秒 | `INTEGER` Unix 秒；台灣日期另存 `tw_day 'YYYY-MM-DD'` | 額度與日彙整不用每次做時區運算（台灣沒有日光節約時間）。例外：`srs_reviews.reviewed_at_ms` 用毫秒，兼當冪等鍵 |
| 7 | 必填欄位成欄、選填與未知欄位進 `extra_json` | `gsat-exam/v1.1` 的必填欄位各自成欄；選填欄位（`parts`、`stats`、`group_label`、`refers_to`、`reused_from`…）與規格外欄位原樣放 `extra_json`；查詢會用到的再用生成欄位（`GENERATED ALWAYS AS (json_extract(…)) VIRTUAL`）拉出來建索引 | 「省略」與「null」的差別原樣保留，匯出一定無損；格式升級（v1.2）時匯入程式不必先改表 |
| 8 | 受保護欄位分欄 | `items.restricted_json`、`vocab_entries.internal_json`、`item_groups.generation_json`；學生端只查 `v_*_student` 檢視表 | 「公開查詢根本不 SELECT 這一欄」比「程式記得過濾」可靠；另有自動化測試掃描所有公開回應（ARCHITECTURE §7） |
| 9 | 只增不減用 trigger 強制 | 題組、小題、註解、審核紀錄禁止 DELETE；上架後內容欄位禁止 UPDATE；狀態只能照固定路線前進 | 作答紀錄指向確切版本，統計與答案更正才算得清楚 |
| 10 | CHECK 只用在定死的列舉 | 大題類型、作答模式、狀態機、難度用 CHECK；任務代號、稽核動作、測驗類型、授權代碼由程式驗證 | SQLite 改 CHECK 要重建整張表 |
| 11 | 外鍵政策 | 使用者資料 `ON DELETE CASCADE`；帳本與回報 `ON DELETE SET NULL`；稽核與審核者欄位不設外鍵 | 刪帳號一次清乾淨；帳本與稽核保留但去識別。稽核表的 trigger 禁止 UPDATE，`SET NULL` 會被擋，所以不設外鍵 |
| 12 | 衍生資料可以重算 | 難度、文章指標、詞彙對照（glossary）、統計、出現明細都標為「衍生欄位／衍生表」，可以更新或重建 | 校正難度不必改版題目 |

## 2. 表格總覽與關聯

### 2.1 表格總覽（56 張表、4 個檢視表、19 個 trigger）

「開始使用」是指哪個階段開始寫入或讀取（ROADMAP）；表在 0001 一次建好。

| 群組 | 表 | 開始使用 | 一句話 |
|---|---|---|---|
| 授權與來源 | `licenses` | Phase 1 | 授權類型（可否改作、商用、相同方式分享） |
| | `sources` | Phase 1 | 考卷、資料集、文章、事實單 |
| | `curriculum_codes` | Phase 1 | 108 課綱代碼 |
| | `grammar_patterns` | Phase 2 | 句型與轉承詞 |
| | `gen_runs` | Phase 1 | 一次生成工作（代理、Batch、人工） |
| | `import_runs` | Phase 1 | 一次匯入（含 Time Travel 書籤與筆數守門） |
| 單字 | `vocab_entries` | Phase 1 | 詞彙表 6,012 筆 |
| | `vocab_forms` | Phase 1 | 詞形 → 條目（16,953 個詞形） |
| | `vocab_senses` | Phase 2 | 義項（OEWN、ECDICT、代理整理） |
| | `phrases` | Phase 2 | 片語 |
| | `vocab_relations` | Phase 2 | 同義、近義、反義、詞族、易混淆、搭配詞 |
| | `vocab_examples` | Phase 1 | 例句（Tatoeba、歷屆原句、AI） |
| | `vocab_exam_stats` | Phase 1 | 歷屆出現統計與重要度 |
| | `vocab_exam_occurrences` | Phase 1 | 出現明細（衍生表） |
| 題庫 | `papers` | Phase 1 | 試卷（歷屆、參考、本站模擬、檢核） |
| | `paper_sections` | Phase 1 | 大題 |
| | `paper_groups` | Phase 1 | 試卷的題組順序 |
| | `item_groups` | Phase 1 | 題組（帶版本、只增不減） |
| | `items` | Phase 1 | 小題 |
| | `group_sources` | Phase 2 | 題組 ↔ 來源 |
| | `item_curriculum` | Phase 2 | 小題 ↔ 課綱代碼 |
| | `item_params` | Phase 2 | 題目參數（共同量尺） |
| | `annotations` | Phase 2 | 解析、中譯、評分規準、範文、生字推測、思考表達題、排除法矩陣 |
| | `item_reviews` | Phase 2 | 驗證與審核紀錄（只增不減） |
| | `item_stats` | Phase 2 | 站內作答統計（衍生表） |
| | `takedowns` | Phase 2 | 授權撤回處理紀錄 |
| 帳號 | `users` | Phase 2 | 帳號與 AI 核准狀態 |
| | `consents` | Phase 2 | 同意紀錄（分種類、分版本） |
| | `user_prefs` | Phase 2 | 偏好 |
| | `invite_codes` | Phase 3 | 邀請碼 |
| | `user_notices` | Phase 2 | 站內通知 |
| 學習 | `practice_sessions` | Phase 2 | 練習、試卷、模擬考、重測 |
| | `attempts` | Phase 2 | 逐題作答 |
| | `user_group_seen` | Phase 2 | 接觸過的題組 |
| | `attempt_regrades` | Phase 2 | 答案更正後的重算紀錄 |
| | `answer_corrections` | Phase 2 | 答案更正流程 |
| | `srs_cards` | Phase 2 | 間隔重複卡片 |
| | `srs_reviews` | Phase 2 | 複習紀錄 |
| | `user_skill_daily` | Phase 2 | 學習分析日彙整 |
| | `score_predictions` | Phase 4 | 預測級分與實得 |
| | `user_ability` | Phase 5 | 能力估計 |
| | `item_reports` | Phase 2 | 題目回報 |
| 寫作 | `submissions` | Phase 2（自評）／Phase 3（AI） | 中譯英、作文、思考表達的提交 |
| | `submission_photos` | Phase 4 | 手寫照片的中繼資料 |
| | `gradings` | Phase 2（自評）／Phase 3（AI） | 批改結果 |
| AI | `ai_ops` | Phase 3 | 一次 AI 操作（點數與美元預扣） |
| | `ai_calls` | Phase 3 | 每一次 API 呼叫 |
| | `ai_budget_daily` | Phase 3 | 全站每日預算 |
| | `ai_reconciliations` | Phase 3 | 每日對帳 |
| | `ai_shared_cache` | Phase 3 | 全站共用的 AI 結果快取 |
| | `ai_safety_events` | Phase 3 | 未成年安全事件（只存類別） |
| | `chat_threads` | Phase 5 | 家教追問 |
| | `chat_messages` | Phase 5 | 追問訊息 |
| 稽核維運 | `admin_audit` | Phase 2 | 管理稽核 |
| | `ops_events` | Phase 2 | 告警與維運事件 |
| | `deletion_log` | Phase 2 | 刪除證明 |

### 2.2 關聯（主要外鍵）

```
licenses ◄─ sources ◄─ group_sources ─► item_groups ◄─ items ◄─ item_curriculum ─► curriculum_codes
                                          ▲    ▲ ▲        ▲ ▲ ▲
papers ◄─ paper_sections ◄─ paper_groups ─┘    │ │        │ │ └─ item_params、item_stats（衍生，1:1）
                                               │ │        │ └─── attempts ─► practice_sessions ─► users
gen_runs ◄────────────────────────────────────┘ │        │        └─ attempt_regrades ─► answer_corrections
item_reviews（只增不減）──────────────────────────┘        └──── srs_cards（kind='item'）◄─ srs_reviews
annotations ── group_uid（跨版本，非外鍵）＋ answer_hash 綁定

vocab_entries ◄─ vocab_forms、vocab_senses、vocab_relations、vocab_examples、vocab_exam_stats、vocab_exam_occurrences
      ▲  phrases ◄─ vocab_relations、vocab_examples
      └─ items.answer_entry_id、srs_cards（word／spell／usage）

users ◄─ consents、user_prefs、user_notices、practice_sessions、attempts、user_group_seen、srs_cards、srs_reviews、
         user_skill_daily、score_predictions、user_ability、submissions、submission_photos、gradings、chat_threads（CASCADE）
users ◄─ ai_ops、item_reports（SET NULL）
submissions ◄─ submission_photos、gradings（CASCADE）；submissions.revision_of ─► submissions（SET NULL）
ai_ops ◄─ ai_calls（SET NULL）；ai_calls、ai_safety_events、deletion_log 只用 HMAC 假名 user_ref
admin_audit、ops_events、takedowns：不設外鍵
```

跨版本的關聯刻意用「uid」而不是外鍵：`annotations.group_uid`、`user_group_seen.group_uid`、`srs_cards.ref_key`。題目出新版本時，解析（答案沒變的話）、錯題卡、「做過了」的紀錄都自動延續。

## 3. 各表說明

每張表先說「存什麼、為什麼這樣設計」，再附遷移檔產生的欄位表。

### 3.1 授權、來源、課綱、生成與匯入

#### `licenses`

授權類型做成資料（04 文件 §1 的速查表），Credits 頁與「收費前要清查的資料」直接由 SQL 產生，例如 `SELECT … FROM item_groups g JOIN licenses l ON l.code = g.license WHERE l.commercial_ok = 0`。遷移檔已放入 15 筆種子資料（`INSERT OR IGNORE`），其中 `CEEC-restricted` 標示評分原則與官方參考答案「不可改作、不可商用、不對外顯示全文」。`CC0-1.0`（Tatoeba 有 96 句英文例句是 CC0）、`CEFR-J`（CEFR 參考級別，須標示出處）、`WordNet-Princeton`（OEWN 的上游授權）是 `data/vocab/` 實際用到的授權；少了它們，匯入 `vocab_examples` 時外鍵會失敗（2026-10-08 匯入草稿實測）。新的授權代碼一律先加進這張表再匯入資料。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `code` | `TEXT PRIMARY KEY` | 授權代碼，例如 'CEEC-exam'、'CC-BY-4.0'、'original-ai' |
| `name` | `TEXT NOT NULL` | 顯示名稱 |
| `url` | `TEXT` | 授權條款網址 |
| `attribution_required` | `INTEGER NOT NULL CHECK (attribution_required IN (0,1))` | 是否必須標示出處 |
| `adaptation_allowed` | `INTEGER NOT NULL CHECK (adaptation_allowed IN (0,1))` | 是否可改作（挖空、改寫都算改作） |
| `share_alike` | `INTEGER NOT NULL CHECK (share_alike IN (0,1))` | 改作後是否須以相同授權釋出 |
| `commercial_ok` | `INTEGER NOT NULL CHECK (commercial_ok IN (0,1))` | 可否商用；「營利須書面同意」也記 0 |
| `notes` | `TEXT` | 補充說明 |

選項：`STRICT`

#### `sources`

一個「來源」可以是一份歷屆考卷（`ceec:gsat-115`）、一個資料集版本（`owid:co2-2025`）、一篇可改作的 CC BY 文章、或一份事實單（`fact:sdg14-0007`）。事實單只存事實與網址、不存原句（04 文件 §7.2）；原始檔不進 git，只存 `sha256`。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'ceec:gsat-115'、'fact:sdg14-0007'、'owid:co2-2025'、'ecdict@bc015ed' |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('exam','article','dataset','dictionary','corpus','fact_sheet','image','other'))` | 來源種類 |
| `name` | `TEXT NOT NULL` | 顯示名稱 |
| `url` | `TEXT` | 原始網址 |
| `license` | `TEXT NOT NULL REFERENCES licenses(code)` | 授權代碼 |
| `attribution_text` | `TEXT` | 畫面上要顯示的標示文字 |
| `version` | `TEXT` | 資料集版本或取得版本 |
| `sha256` | `TEXT` | 原始檔雜湊（原始檔在 data/raw/，不進 git；雜湊進資料庫） |
| `retrieved_at` | `INTEGER` | 取得時間 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

選項：`STRICT`

#### `curriculum_codes`

108 課綱第五學習階段的學習表現（95 條）、學習內容（52 條）與核心素養，來自 `data/curriculum/english-108.json`。`assessed_in_gsat` 標示學測紙筆測驗是否評量（01 文件 §6.3）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `code` | `TEXT PRIMARY KEY` | code_ascii，例如 '3-V-12'、'Ac-V-3'、'S-U-A2' |
| `code_display` | `TEXT NOT NULL` | 原字，例如 '3-Ⅴ-12' |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('performance','content','competency'))` | 學習表現／學習內容／核心素養 |
| `category` | `TEXT NOT NULL` | 類別，例如 '3'、'Ac'、'A2' |
| `text_zh` | `TEXT NOT NULL` | 條目原文 |
| `advanced` | `INTEGER NOT NULL DEFAULT 0 CHECK (advanced IN (0,1))` | 星號（較高階）條目 |
| `recurring` | `INTEGER NOT NULL DEFAULT 0 CHECK (recurring IN (0,1))` | 雙圈（重複出現）條目 |
| `assessed_in_gsat` | `INTEGER NOT NULL DEFAULT 0 CHECK (assessed_in_gsat IN (0,1))` | 學測紙筆測驗是否評量（01 文件 §6.3） |

選項：`STRICT`

#### `grammar_patterns`

`data/curriculum/grammar-patterns.json` 的 108 個句型與 111 個轉承詞（286 個片語另存 `phrases`）。用途：中譯英的句型鷹架與句型卡（`srs_cards.kind='pattern'`）、作文寫作區的轉承詞上色、出題規格引用的句型 id。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'gp-present-perfect'、'cn-however' |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('pattern','connective'))` | 句型／轉承詞 |
| `name_zh` | `TEXT NOT NULL` | 中文名稱；轉承詞放功能，例如「轉折（對比）」 |
| `pattern` | `TEXT NOT NULL` | 句型公式或轉承詞本身 |
| `category` | `TEXT` | 句型類別（時態、子句…）或轉承詞功能 |
| `body_json` | `TEXT NOT NULL CHECK (json_valid(body_json))` | 原始條目（例句、程度、課本出處、歷屆中譯英引用） |
| `updated_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 最後匯入時間 |

選項：`STRICT`

#### `gen_runs`

一次生成工作。Claude Code 代理通道（開發階段離線產生，不走 API 帳單）也要記模型與 `prompt_sha256`，產物才能追溯、必要時由 Batch 通道重做（ROADMAP 風險 R5）。Batch 通道另記 Anthropic 的批次 id、送出前估價、實際花費，以及收取結果後是否已呼叫 `DELETE /v1/messages/batches/{id}` 刪除 Anthropic 端資料。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'agent-2026-10-20-wb-adv-01'、'batch-msgbatch_01ab…' |
| `channel` | `TEXT NOT NULL CHECK (channel IN ('agent','batch','human','program'))` | 生成通道 |
| `purpose` | `TEXT NOT NULL CHECK (purpose IN ('generate','verify','annotate','enrich'))` | 出題／驗證／註解／單字增補 |
| `section_type` | `TEXT` | 題型（單字增補為 NULL） |
| `tier` | `TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top'))` | 目標難度 |
| `model` | `TEXT` | 模型 ID（代理通道也要記，例如 'claude-opus-5-5'） |
| `effort` | `TEXT CHECK (effort IS NULL OR effort IN ('low','medium','high','xhigh','max'))` | effort 設定 |
| `prompt_id` | `TEXT` | 提示詞範本名稱（prompts/ 下） |
| `prompt_sha256` | `TEXT` | 範本＋schema＋難度規格的雜湊：改一個字就是新值 |
| `spec_id` | `TEXT` | 難度規格版本，例如 'word_bank-advanced@2026-10' |
| `request_count` | `INTEGER` | 請求數或題組數 |
| `est_cost_micros` | `INTEGER CHECK (est_cost_micros IS NULL OR est_cost_micros >= 0)` | 送出前估價（微美元）；代理通道為 NULL |
| `cost_micros` | `INTEGER CHECK (cost_micros IS NULL OR cost_micros >= 0)` | 實際花費（微美元） |
| `status` | `TEXT NOT NULL CHECK (status IN ('running','submitted','ended','collected','failed','canceled'))` | 狀態 |
| `anthropic_batch_id` | `TEXT` | Batch 通道的批次 id |
| `git_sha` | `TEXT` | 產生時的 commit |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `ended_at` | `INTEGER` | 完成時間 |
| `collected_at` | `INTEGER` | 結果收取時間 |
| `remote_deleted_at` | `INTEGER` | 已呼叫 DELETE /v1/messages/batches/{id} 的時間 |

選項：`STRICT`

#### `import_runs`

`content-import.yml` 每次匯入前後的各表筆數，加上匯入前的 D1 Time Travel 書籤。匯入後任何內容表「筆數變少」就讓匯入失敗並告警（Sekai「只增不減守門」的資料庫版，05 文件 §2.7）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{kind}-{git sha 前 12 碼}-{時間}' |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('curriculum','exams','bank','annotations','vocab','decisions','batch','params'))` | 匯入種類 |
| `git_sha` | `TEXT NOT NULL` | 來源 commit |
| `bookmark` | `TEXT` | 匯入前的 D1 Time Travel 書籤，出事可還原到匯入前 |
| `counts_before_json` | `TEXT CHECK (counts_before_json IS NULL OR json_valid(counts_before_json))` | 匯入前各表筆數 |
| `counts_after_json` | `TEXT CHECK (counts_after_json IS NULL OR json_valid(counts_after_json))` | 匯入後各表筆數（只能增加，守門用） |
| `status` | `TEXT NOT NULL CHECK (status IN ('started','succeeded','failed'))` | 狀態 |
| `error` | `TEXT` | 失敗原因 |
| `started_at` | `INTEGER NOT NULL` | 開始時間 |
| `finished_at` | `INTEGER` | 結束時間 |

選項：`STRICT`

### 3.2 單字

#### `vocab_entries`

詞彙表條目，主鍵是 `entry_id`（例如 `address|v./n.|2`），因為 `word` 不唯一：有 9 個字各出現兩筆（03 文件 §6.3）。`entry_id` ＝ `{word}|{pos 以 / 相接}|{level}`：`lexicon.json` 已帶這個值；只有 `ceec-wordlist.json` 時照同一規則算出，6,012 筆唯一且和 `lexicon.json` 逐筆相同（匯入草稿實測）。`pages_json` 保存 `ceec-wordlist.json` 的原表印刷頁碼（`lexicon.json` 沒有這個欄位），詞頁可以提供「回原表第 N 頁查看」（03 文件 §9.2）；`extra_json` 原樣保存 `lexicon.json` 沒有成欄的欄位（`ipa_source`、`en_def_source`、`cefr` 明細、`sources`、`variant_info`），和題庫一樣做到匯出無損（原則 7）。`display_word` 處理 `capital(ism) n. 4` 這類條目的顯示詞形（capitalism）。`internal_json` 放 ECDICT 帶來的 Collins 星級與 Oxford 3000 旗標（lexicon 的 `internal_core_flag`、`internal_star`），只當排序特徵，學生端檢視表不含這一欄（04 文件 §7.4 禁止在介面顯示這些品牌指標）。`wordnet_json` 是 OEWN 原始資料（CC BY 4.0，可以顯示，要標示出處）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | entry_id，例如 'address\|v./n.\|2' |
| `word` | `TEXT NOT NULL` | 原表主要詞形 |
| `word_norm` | `TEXT NOT NULL` | 小寫、去重音、彎引號轉 ' |
| `display_word` | `TEXT` | 顯示用詞形（例如 capitalism、a.m.；NULL＝同 word） |
| `level` | `INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 6)` | 級別；附錄詞為 NULL |
| `list_name` | `TEXT NOT NULL DEFAULT 'ceec-111' CHECK (list_name IN ('ceec-111','appendix','curriculum-2000','extra'))` | 所屬清單 |
| `pos_json` | `TEXT NOT NULL CHECK (json_valid(pos_json))` | 詞類，保留原表順序（第一個最常用） |
| `pos_primary` | `TEXT NOT NULL` | 第一個詞類 |
| `raw` | `TEXT` | 原表文字 |
| `pages_json` | `TEXT CHECK (pages_json IS NULL OR json_valid(pages_json))` | 原表印刷頁碼 {"alpha":53,"level":1}（ceec-wordlist.json 的 pages；「回原表第 N 頁查看」，03 文件 §9.2） |
| `variants_json` | `TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(variants_json))` | 斜線與括號變體 |
| `tags_json` | `TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json))` | 解析標記，例如 'slash-forms' |
| `forms_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(forms_json))` | 屈折變化（ECDICT exchange） |
| `ipa` | `TEXT` | 音標 |
| `zh_json` | `TEXT CHECK (zh_json IS NULL OR json_valid(zh_json))` | ECDICT 中文釋義（MIT），含是否和詞類相符 |
| `en_def` | `TEXT` | 英文定義（OEWN） |
| `cefr` | `TEXT CHECK (cefr IS NULL OR cefr IN ('A1','A2','B1','B2','C1','C2'))` | 參考 CEFR（CEFR-J） |
| `freq_rank` | `INTEGER` | ECDICT frq |
| `bnc_rank` | `INTEGER` | ECDICT bnc |
| `family_id` | `TEXT` | 詞族 id（accurate／accuracy 串在一起） |
| `wordnet_json` | `TEXT CHECK (wordnet_json IS NULL OR (json_valid(wordnet_json) AND length(wordnet_json) <= 131072))` | OEWN 原始資料（義項、同義、上位詞） |
| `internal_json` | `TEXT CHECK (internal_json IS NULL OR json_valid(internal_json))` | Collins 星級、Oxford 旗標：只當排序特徵，學生端永不回傳（04 §7.4） |
| `extra_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')` | lexicon.json 中沒有成欄的欄位原樣保存（ipa_source、en_def_source、cefr 明細、sources、variant_info），匯出無損 |
| `cambridge_slug` | `TEXT NOT NULL` | Cambridge 英漢繁體外連的 slug |
| `enrich_version` | `INTEGER NOT NULL DEFAULT 0` | 代理增補版本；0＝尚未增補 |
| `data_version` | `TEXT NOT NULL` | lexicon.json 的 sha256 前 12 碼 |

選項：`STRICT`

#### `vocab_forms`

詞形 → 條目的反查表，來自 `data/vocab/forms-index.json`（16,953 個詞形、17,073 組詞形與條目的對應）。點字查詞、選文的詞彙級數計算、混合題「同一條目的不同詞形給 1 分」都靠它。查一整篇選文的詞形用 `WHERE form_norm IN (SELECT value FROM json_each(?1))`：一個參數帶整個陣列，避開 D1 每句 100 個綁定參數的上限（原型的查詢計畫確認走主鍵）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `form_norm` | `TEXT NOT NULL` | 正規化詞形 |
| `entry_id` | `TEXT NOT NULL REFERENCES vocab_entries(id)` | 對應條目 |
| `types_json` | `TEXT NOT NULL CHECK (json_valid(types_json))` | lemma、slash、plural、past…（照 forms-index.json） |
| `base_json` | `TEXT CHECK (base_json IS NULL OR json_valid(base_json))` | 若是某個變體的屈折形，記變體（陣列） |
| `extra_pos` | `INTEGER NOT NULL DEFAULT 0 CHECK (extra_pos IN (0,1))` | 只供詞形還原、不屬於原表詞類的屈折形 |
| `rank` | `INTEGER NOT NULL DEFAULT 0` | 同形多筆時的排序（forms-index 的順序） |

表層約束：`PRIMARY KEY (form_norm, entry_id)`　選項：`STRICT, WITHOUT ROWID`

#### `vocab_senses`、`phrases`、`vocab_relations`、`vocab_examples`

03 文件 §9.4 要的多義、同義、近義辨析、搭配詞、片語、例句。來源欄位分清楚 OEWN、ECDICT、Tatoeba、歷屆考題、代理、批次、人工，畫面依來源標示：Tatoeba 例句逐句標作者與連結，AI 例句標「AI 生成」（04 文件 §7.1）。

- `vocab_senses.exam_salient`：學測常考的延伸義（例如 address 當動詞「處理」），由歷屆語料統計＋代理整理，是「多義選義」卡的出題依據。
- `phrases`：片語獨立成表，因為課綱要求片語當成一個語意單位（01 文件 §7.2），也是 SRS 卡片。種子是 `grammar-patterns.json` 的 286 個片語。
- `vocab_relations`：同義只連到詞彙表內的字（`target_entry_id`），表外的字只放 `target_text`，練習才會留在高中範圍內（03 文件 §9.4）。唯一索引用運算式 `IFNULL(sense_id, '')`，因為 SQLite 的 UNIQUE 把 NULL 視為不同值。
- `vocab_examples.cloze_ok`：這句的語境足以推出目標字，才拿來出例句填空。
- `vocab_examples` 的 Tatoeba 中文譯句是另一位作者的作品（CC BY 2.0 FR），所以 `zh_author`、`zh_license`、`zh_source_ref` 另外成欄；`zh_converted=1` 表示已用 OpenCC 轉成台灣用語，標示時要註明「經本站轉換」（CC BY 要求註明修改）。表層 CHECK 要求 Tatoeba 例句的英文作者、中文作者與授權都不能是空的。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{entry_id}#{source}:{key}'，key 由來源決定且穩定 |
| `entry_id` | `TEXT NOT NULL REFERENCES vocab_entries(id)` | 所屬條目 |
| `source` | `TEXT NOT NULL CHECK (source IN ('oewn','ecdict','agent','batch','human'))` | 來源 |
| `ord` | `INTEGER NOT NULL` | 顯示順序 |
| `pos` | `TEXT NOT NULL` | 詞類 |
| `gloss_zh` | `TEXT` | 中文義（台灣用語） |
| `def_en` | `TEXT` | 英文定義 |
| `usage_note_zh` | `TEXT` | 用法說明 |
| `exam_hits` | `INTEGER NOT NULL DEFAULT 0` | 歷屆考題用到這個義項的次數 |
| `exam_salient` | `INTEGER NOT NULL DEFAULT 0 CHECK (exam_salient IN (0,1))` | 學測常考的延伸義（多義選義卡用） |
| `synset_id` | `TEXT` | OEWN synset |
| `review_status` | `TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged'))` | flagged 的不顯示 |

表層約束：`UNIQUE (entry_id, source, ord)`　選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'ph:deal-with' |
| `text` | `TEXT NOT NULL` | 片語 |
| `text_norm` | `TEXT NOT NULL UNIQUE` | 正規化 |
| `head_entry_id` | `TEXT REFERENCES vocab_entries(id)` | 中心詞條目 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('phrasal_verb','idiom','fixed_collocation','prep_phrase','pattern'))` | 片語種類 |
| `meaning_zh` | `TEXT NOT NULL` | 中文義 |
| `pattern` | `TEXT` | 'deal with + N' |
| `level_est` | `INTEGER CHECK (level_est IS NULL OR level_est BETWEEN 1 AND 6)` | 估計級別 |
| `exam_hits` | `INTEGER NOT NULL DEFAULT 0` | 歷屆出現次數 |
| `source` | `TEXT NOT NULL CHECK (source IN ('exam','grammar_patterns','agent','batch','human'))` | 來源 |
| `review_status` | `TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged'))` | 審核狀態 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `entry_id` | `TEXT NOT NULL REFERENCES vocab_entries(id)` | 來源條目 |
| `sense_id` | `TEXT REFERENCES vocab_senses(id)` | 屬於哪個義項（可空） |
| `rel` | `TEXT NOT NULL CHECK (rel IN ('synonym','near_synonym','antonym','derivation','family','confusable','collocation','phrase','hypernym'))` | 關係 |
| `target_entry_id` | `TEXT REFERENCES vocab_entries(id)` | 詞彙表內的目標字 |
| `target_phrase_id` | `TEXT REFERENCES phrases(id)` | 目標片語 |
| `target_text` | `TEXT NOT NULL` | 顯示文字；詞彙表外的字只放這裡 |
| `note_zh` | `TEXT` | 近義辨析、易混淆說明 |
| `pattern` | `TEXT` | 搭配詞型：'V + N'、'adj + N' |
| `strength` | `REAL` | 搭配強度或相似度 |
| `source` | `TEXT NOT NULL CHECK (source IN ('oewn','ecdict','exam','ngram','agent','batch','human'))` | 來源 |
| `review_status` | `TEXT NOT NULL DEFAULT 'auto' CHECK (review_status IN ('auto','checked','flagged'))` | 審核狀態 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{entry_id 或 phrase_id}#tatoeba:1337'、'#exam:{item_id}'、'#ai:{hash}'：同一句 Tatoeba 會掛在多個條目（lexicon.json 有 3,577 句被 2–10 個條目共用），id 要含所屬條目才不會互相覆蓋 |
| `entry_id` | `TEXT REFERENCES vocab_entries(id)` | 所屬條目 |
| `phrase_id` | `TEXT REFERENCES phrases(id)` | 所屬片語 |
| `sense_id` | `TEXT REFERENCES vocab_senses(id)` | 所屬義項 |
| `ord` | `INTEGER NOT NULL DEFAULT 0` | 顯示順序 |
| `en` | `TEXT NOT NULL` | 英文句 |
| `zh` | `TEXT` | 中文翻譯 |
| `zh_source_ref` | `TEXT` | 中文譯句在來源內的 id（Tatoeba 中文句號） |
| `zh_author` | `TEXT` | 中文譯句作者（Tatoeba 的中文句是另一位作者，同樣要標示） |
| `zh_license` | `TEXT REFERENCES licenses(code)` | 中文譯句授權 |
| `zh_converted` | `INTEGER CHECK (zh_converted IS NULL OR zh_converted IN (0,1))` | 1＝已用 OpenCC 轉成台灣用語（改作，標示時註明「經本站轉換」） |
| `source_kind` | `TEXT NOT NULL CHECK (source_kind IN ('tatoeba','oewn','exam','agent','batch'))` | 來源種類 |
| `source_ref` | `TEXT` | 來源內的 id（Tatoeba 句號、題目 id） |
| `author` | `TEXT` | 作者（Tatoeba 必填） |
| `license` | `TEXT NOT NULL REFERENCES licenses(code)` | 授權 |
| `url` | `TEXT` | 原句連結 |
| `within_level` | `INTEGER CHECK (within_level IS NULL OR within_level IN (0,1))` | 句中其他字是否都在學生程度內 |
| `cloze_ok` | `INTEGER NOT NULL DEFAULT 0 CHECK (cloze_ok IN (0,1))` | 可否用來出例句填空（語境足以推出目標字） |

表層約束：`CHECK (entry_id IS NOT NULL OR phrase_id IS NOT NULL)`；`CHECK (source_kind <> 'tatoeba' OR (author IS NOT NULL AND (zh IS NULL OR (zh_author IS NOT NULL AND zh_license IS NOT NULL))))`　選項：`STRICT`

#### `vocab_exam_stats`

重要度的特徵分開存（當正解、當干擾、在題幹、在選文、現制考卷數），`components_json` 存每一項的分數，詞頁點開就看得到「為什麼是 A 級」（SPEC §6.1）。`formula_version` 讓公式可以改版、回測（precision@k）後再切換。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `entry_id` | `TEXT PRIMARY KEY REFERENCES vocab_entries(id)` | 條目 |
| `as_answer` | `INTEGER NOT NULL DEFAULT 0` | 當正解次數 |
| `as_answer_phrase` | `INTEGER NOT NULL DEFAULT 0` | 在片語正解中的次數 |
| `as_distractor` | `INTEGER NOT NULL DEFAULT 0` | 當干擾選項次數 |
| `in_stem` | `INTEGER NOT NULL DEFAULT 0` | 在題幹出現次數 |
| `in_passage` | `INTEGER NOT NULL DEFAULT 0` | 在選文出現次數 |
| `papers` | `INTEGER NOT NULL DEFAULT 0` | 出現過的考卷數 |
| `papers_current` | `INTEGER NOT NULL DEFAULT 0` | 現制（111 起）考卷數 |
| `last_year` | `INTEGER` | 最近一次出現的學年度 |
| `by_section_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(by_section_json))` | 依大題的出現次數 |
| `components_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(components_json))` | 重要度的各項組成（畫面上點開看） |
| `importance` | `REAL NOT NULL DEFAULT 0 CHECK (importance BETWEEN 0 AND 100)` | 重要度 0–100 |
| `importance_tier` | `TEXT NOT NULL CHECK (importance_tier IN ('A','B','C','D'))` | 分級 |
| `formula_version` | `TEXT NOT NULL` | 公式版本，例如 'imp@1' |
| `computed_at` | `INTEGER NOT NULL` | 計算時間 |

選項：`STRICT`

#### `vocab_exam_occurrences`

衍生表：每個條目在哪一份考卷、哪一個題組、以什麼角色出現（正解、干擾、題幹、選文、選項庫）。詞頁「最近 5 次出現的句子」與「連到該題」靠它。功能詞（the、that…）只寫統計總數，不寫明細，控制列數（估計約 6 萬列）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `entry_id` | `TEXT NOT NULL REFERENCES vocab_entries(id)` | 條目 |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `item_label` | `TEXT NOT NULL DEFAULT ''` | 小題；選文層級為 '' |
| `role` | `TEXT NOT NULL CHECK (role IN ('answer','answer_in_phrase','distractor','stem','passage','option_bank'))` | 出現角色 |
| `surface` | `TEXT NOT NULL` | 原文詞形 |
| `hits` | `INTEGER NOT NULL DEFAULT 1 CHECK (hits >= 1)` | 次數 |
| `paper_id` | `TEXT NOT NULL` | 試卷 |
| `year` | `INTEGER NOT NULL` | 學年度 |
| `era` | `TEXT NOT NULL` | 時期 |

表層約束：`PRIMARY KEY (entry_id, group_id, item_label, role)`　選項：`STRICT, WITHOUT ROWID`

### 3.3 題庫：試卷、題組、小題

#### `papers`、`paper_sections`、`paper_groups`

試卷只是「組裝資訊」：有哪些大題、每個大題放哪些題組版本、什麼順序。內容本身在 `item_groups`／`items`。歷屆卷、參考試卷、本站模擬卷（Phase 5）、檢核卷（Phase 5）共用這三張表；本站卷用 `paper_groups.no_offset` 重新編號，題組本身的題號不動。

`papers.sources_json`、`extraction_json` 是原 JSON 的內部欄位（repo 路徑、解析紀錄），只供匯出與後台，不對外。`paper_sections.extra_json` 收 v1.1 的 `section.stats`（中譯英、作文的全國分數分布），模擬考成績單會用它換算「大約贏過多少比例的考生」。

`papers` 與 `paper_groups` 可以更新（例如歷屆題轉錄修正後改指新版本題組），每次都記在 `import_runs`。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'gsat-115'、'ref-98-a'、'mock-adv-0001'、'ckpt-a-01' |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('official','reference','mock','checkpoint'))` | 正式卷／參考試卷／本站模擬卷／檢核卷 |
| `exam` | `TEXT CHECK (exam IS NULL OR exam IN ('gsat','ast','reference'))` | 原 JSON 的 exam；本站卷為 NULL |
| `year` | `INTEGER` | 學年度；本站卷為 NULL |
| `session` | `TEXT CHECK (session IS NULL OR session IN ('regular','makeup'))` | 正式／補考；本站卷為 NULL |
| `era` | `TEXT NOT NULL CHECK (era IN ('gsat-legacy','gsat-current','ast','reference','site'))` | 時期 |
| `title` | `TEXT NOT NULL` | 標題（逐字） |
| `time_minutes` | `INTEGER` | 作答時間 |
| `full_score` | `ANY CHECK (typeof(full_score) IN ('integer','real','null'))` | 滿分（原樣保留整數或小數） |
| `schema_id` | `TEXT` | 'gsat-exam/v1.1'；本站卷為 NULL |
| `sources_json` | `TEXT CHECK (sources_json IS NULL OR json_valid(sources_json))` | 原 JSON 的 sources（內部路徑，不對外） |
| `extraction_json` | `TEXT CHECK (extraction_json IS NULL OR json_valid(extraction_json))` | 原 JSON 的 extraction（解析紀錄，不對外） |
| `extra_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')` | 選填與規格外的頂層欄位（例如 parts） |
| `verified` | `INTEGER GENERATED ALWAYS AS (CASE WHEN json_extract(extraction_json, '$.verified_by') IS NOT NULL THEN 1 ELSE 0 END) VIRTUAL` | 是否經過查證 |
| `blueprint` | `TEXT` | 本站卷的藍圖，例如 'gsat-current@115' |
| `tier` | `TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top'))` | 本站卷的難度 |
| `status` | `TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','retired'))` | 狀態 |
| `content_hash` | `TEXT NOT NULL` | 整份 JSON 的雜湊（偵測來源有沒有改） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `updated_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 最後更新時間 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `paper_id` | `TEXT NOT NULL REFERENCES papers(id)` | 試卷 |
| `ord` | `INTEGER NOT NULL CHECK (ord >= 1)` | 第幾大題（從 1 起） |
| `section_key` | `TEXT NOT NULL` | 原 JSON 的大題 id，例如 's1' |
| `type` | `TEXT NOT NULL CHECK (type IN ('vocabulary','cloze','word_bank','structure','reading','mixed','sentence_matching','short_answer','translation','composition','other'))` | 大題類型 |
| `title` | `TEXT NOT NULL` | 大題標題（逐字） |
| `part` | `TEXT` | 題本的部分名稱；舊卷為 NULL |
| `instructions` | `TEXT NOT NULL` | 說明（逐字） |
| `points_total` | `ANY CHECK (typeof(points_total) IN ('integer','real','null'))` | 配分 |
| `extra_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')` | 選填與規格外欄位（例如 stats 分數分布） |

表層約束：`PRIMARY KEY (paper_id, ord)`；`UNIQUE (paper_id, section_key)`　選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `paper_id` | `TEXT NOT NULL` | 試卷 |
| `section_ord` | `INTEGER NOT NULL` | 第幾大題 |
| `ord` | `INTEGER NOT NULL CHECK (ord >= 1)` | 大題內第幾個題組 |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `no_offset` | `INTEGER NOT NULL DEFAULT 0` | 本站卷重新編號用；歷屆卷為 0 |

表層約束：`PRIMARY KEY (paper_id, section_ord, ord)`；`FOREIGN KEY (paper_id, section_ord) REFERENCES paper_sections(paper_id, ord)`　選項：`STRICT`

#### `item_groups`

題組是內容的最小單位：學生一次看到的、AI 一次產生的、驗證與審核的，都是整個題組（選文＋小題）。詞彙題也包成題組（歷屆卷 10–20 題一組，AI 題一題一組或十題一組）。

- **id 與版本**：`id = '{uid}@{version}'`。歷屆題 `uid = '{paper}.{group}'`（例如 `gsat-115.s6g1`），AI 題 `uid = 'ai.{題型縮寫}.{6 碼}'`（`vo` 詞彙、`cz` 綜合、`wb` 文意選填、`st` 篇章、`rd` 閱讀、`mx` 混合、`tr` 中譯英、`cp` 作文）。作答紀錄指向確切版本，統計不會因為改題而失真。
- **`format_version`**：例如篇章結構 111–114 是 `structure-4x4`、115 起 `structure-4x5`、指考 `structure-5x5`；文意選填 `word_bank-10x10`、指考舊卷 `word_bank-10x12`（01 文件 §7.3 要求能區分格式）。
- **三個雜湊**：`content_hash` 是整個題組（含小題與受保護欄位）的雜湊，匯入時判斷「有沒有改」；`face_hash` 只算學生看得到的欄位（選文、題幹、選項、答案、圖表），只改了標註的新版本可以和舊版合併統計；`answer_hash` 是各小題 `answer_hash` 的雜湊，解析綁定它（§3.4）。
- **`pool`**：`checkpoint` 的題組只出現在檢核卷（Phase 5），不進練習池、不出現在公開題庫，答案也不會送到前端（SPEC §7.4）。
- **`pick_order`**：匯入時給的亂數。抽題用 `pick_order >= 隨機值 ORDER BY pick_order LIMIT n`（不足再從頭補），走 `idx_groups_pick` 索引，讀取列數約等於 n；不用 `ORDER BY random()`，那會整表掃描，而 D1 依讀取列數計費（§7）。
- **衍生欄位**：`tier`、`tier_basis`、`theta70`、文章指標、`glossary_json`（選文 token → 條目、級別）可以更新，不在 `content_hash` 裡，校正難度或詞彙表更新後不必改版題目。
- **狀態機**（trigger 強制）：`draft → verifying → needs_review → published`，中途可 `rejected`；`published ⇄ quarantined`（答案疑似有誤時暫時下架）；`published／quarantined → retired`；任何上架過的狀態 → `withdrawn`（授權撤回，墓碑化）。歷屆題匯入時直接 `published`、`approval_mode='official'`。
- **墓碑化**：表層 CHECK 規定 `withdrawn` 的題組必須清空選文、圖表、選項庫、標註、衍生指標與詞彙對照，保留 id、雜湊與審核紀錄；小題的 trigger 只允許把文字欄位清空。作答紀錄仍指得到這個 id，畫面顯示「本題已依權利人要求下架」。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{uid}@{version}'，例如 'gsat-115.s6g1@1' |
| `uid` | `TEXT NOT NULL` | 跨版本不變的題組代號：歷屆 '{paper}.{group}'、AI 'ai.wb.7f3a9c' |
| `version` | `INTEGER NOT NULL CHECK (version >= 1)` | 版本 |
| `section_type` | `TEXT NOT NULL CHECK (section_type IN ('vocabulary','cloze','word_bank','structure','reading','mixed','sentence_matching','short_answer','translation','composition','other'))` | 題型 |
| `origin` | `TEXT NOT NULL CHECK (origin IN ('ceec','agent','batch','human'))` | 來源：歷屆／代理／批次／人工 |
| `pool` | `TEXT NOT NULL DEFAULT 'practice' CHECK (pool IN ('practice','checkpoint'))` | checkpoint＝檢核卷專用，不進練習、不公開 |
| `source_key` | `TEXT` | 原 JSON 的題組 id（'s6g1'），匯出時還原 |
| `format_version` | `TEXT NOT NULL` | 格式版本：'structure-4x5'、'structure-4x4'、'word_bank-10x10'、'cloze-5'、'reading-4'… |
| `passage` | `TEXT` | 選文；空格寫成 [[題號]]（AI 題 [[1]]…[[n]]） |
| `passage_parts_json` | `TEXT CHECK (passage_parts_json IS NULL OR json_valid(passage_parts_json))` | 多文本 |
| `figures_json` | `TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(figures_json) AND json_type(figures_json) = 'array')` | 圖表；AI 圖表題多一個 chart 物件 |
| `options_bank_json` | `TEXT CHECK (options_bank_json IS NULL OR json_valid(options_bank_json))` | 選項庫（文意選填、篇章結構） |
| `tags_json` | `TEXT CHECK (tags_json IS NULL OR json_valid(tags_json))` | 題組標註（topic、genre、sdgs、text_format）；原樣保留 |
| `extra_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')` | 選填與規格外欄位（group_label…） |
| `group_label` | `TEXT GENERATED ALWAYS AS (json_extract(extra_json, '$.group_label')) VIRTUAL` | 題本印的題組標示 |
| `topic` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.topic')) VIRTUAL` | 主題 |
| `genre` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.genre')) VIRTUAL` | 文體 |
| `text_format` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.text_format')) VIRTUAL` | 文本形式 |
| `tier` | `TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top'))` | 難度 |
| `tier_basis` | `TEXT CHECK (tier_basis IS NULL OR tier_basis IN ('official_fit','official_p','spec','calibrated','manual'))` | 難度依據 |
| `theta70` | `REAL` | 題組平均的 θ70（預測答對率 70% 的能力位置，SPEC §3） |
| `word_count` | `INTEGER` | 選文字數 |
| `cov_l1_4` | `REAL CHECK (cov_l1_4 IS NULL OR cov_l1_4 BETWEEN 0 AND 1)` | L1–4 token 覆蓋率 |
| `cov_l1_6` | `REAL CHECK (cov_l1_6 IS NULL OR cov_l1_6 BETWEEN 0 AND 1)` | L1–6 token 覆蓋率 |
| `offlist_ratio` | `REAL CHECK (offlist_ratio IS NULL OR offlist_ratio BETWEEN 0 AND 1)` | 表外字比例 |
| `metrics_json` | `TEXT CHECK (metrics_json IS NULL OR json_valid(metrics_json))` | tools/text_metrics.py 完整輸出 |
| `glossary_json` | `TEXT CHECK (glossary_json IS NULL OR (json_valid(glossary_json) AND length(glossary_json) <= 262144))` | 選文 token → 條目、級別（點字查詞、生字標示） |
| `pick_order` | `INTEGER NOT NULL` | 匯入時給的亂數：抽題走索引，不用 ORDER BY random() |
| `license` | `TEXT NOT NULL REFERENCES licenses(code)` | 授權代碼 |
| `derivation` | `TEXT NOT NULL CHECK (derivation IN ('verbatim','adapted','ai-original-from-facts','original'))` | 衍生方式 |
| `share_alike` | `INTEGER NOT NULL DEFAULT 0 CHECK (share_alike IN (0,1))` | 相同方式分享 |
| `commercial_ok` | `INTEGER NOT NULL DEFAULT 1 CHECK (commercial_ok IN (0,1))` | 可否商用 |
| `attribution_text` | `TEXT` | 畫面標示文字 |
| `gen_run_id` | `TEXT REFERENCES gen_runs(id)` | 生成批次 |
| `generation_json` | `TEXT CHECK (generation_json IS NULL OR json_valid(generation_json))` | 模型、提示詞版本、custom_id：只供內部 |
| `status` | `TEXT NOT NULL CHECK (status IN ('draft','verifying','needs_review','published','quarantined','rejected','retired','withdrawn'))` | 狀態機（trigger 強制） |
| `review_lot` | `TEXT` | 整批抽樣審核的批號 |
| `approval_mode` | `TEXT CHECK (approval_mode IS NULL OR approval_mode IN ('official','individual','lot_sample'))` | 核准方式 |
| `approved_by` | `INTEGER` | users.id；刻意不設外鍵（帳號刪除後紀錄仍在） |
| `approved_at` | `INTEGER` | 核准時間 |
| `supersedes_id` | `TEXT REFERENCES item_groups(id)` | 取代的舊版本 |
| `status_reason` | `TEXT` | 下架、隔離、退回的原因 |
| `content_hash` | `TEXT NOT NULL` | 整個題組（含小題、受保護欄位）的雜湊：匯入時偵測有沒有改 |
| `face_hash` | `TEXT NOT NULL` | 只算學生看得到的欄位：跨版本合併統計用 |
| `answer_hash` | `TEXT NOT NULL` | 各小題 answer_hash 的雜湊：解析綁定用 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `published_at` | `INTEGER` | 上架時間 |
| `retired_at` | `INTEGER` | 下架時間 |
| `tombstoned_at` | `INTEGER` | 墓碑化時間（授權撤回） |

表層約束：`UNIQUE (uid, version)`；`CHECK (status <> 'withdrawn' OR (tombstoned_at IS NOT NULL AND passage IS NULL AND passage_parts_json IS NULL AND figures_json = '[]' AND options_bank_json IS NULL AND tags_json IS NULL AND extra_json = '{}' AND metrics_json IS NULL AND glossary_json IS NULL))`　選項：`STRICT`

#### `items`

小題。`gsat-exam/v1.1` 的必填欄位各自成欄，選填欄位（`refers_to`、`scoring_exception`、`reused_from`、`answer_table`）與規格外欄位原樣放 `extra_json`。

- **答案的存法**：`answer_json` 是答案的 JSON 文字：單選、選項庫是字串（`"B"`），多選是陣列，填充、簡答是字串或 `null`，作文固定是 `null`。**中譯英一律是 SQL NULL**：官方參考譯文受著作權保護（04 文件 §4.3），和 `accepted_answers`、`answer_segments`、`answer_variants`、`answer_is_composite` 一起放在 `restricted_json`；本站自己寫的參考譯文放在 `annotations`（kind `rubric`）。表層 CHECK 強制這一點，程式寫錯也存不進去。
- **`restricted_json`**：所有作答模式的 `scoring_notes`（評分原則逐字）都放這裡。只有 AI 批改的內部提示、匯出工具與後台會讀它；學生端檢視表 `v_items_student` 沒有這一欄。
- **`answer_hash`**：答案、可接受答案、計分例外（`scoring_exception`）的雜湊。作答時存進 `attempts.answer_hash`；官方答案更正時，用它找出所有「用舊答案計分」的作答重算（SPEC §4.7）。
- **生成欄位**：`test_point`、`answer_pos`、`grammar_point`、`item_type`、`clue`、`correct_rate`、`discrimination` 從原樣保存的 JSON 拉出來建索引，匯入程式不必認識每個標註欄位。`skill` 是「主要技能」：`test_point`、`item_type`、`clue` 取第一個有值的，錯題重測用它找同技能的新題。
- `group_uid`、`section_type` 是反正規化的副本（不可變），讓「同一題的所有版本」「同題型同技能的題」不必 join。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{group_id}#{label}'，例如 'gsat-115.s6g1@1#47' |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 所屬題組版本 |
| `group_uid` | `TEXT NOT NULL` | 題組 uid（反正規化；跨版本找同一題用） |
| `section_type` | `TEXT NOT NULL` | 題型（反正規化） |
| `ord` | `INTEGER NOT NULL CHECK (ord >= 1)` | 題組內順序 |
| `no` | `INTEGER NOT NULL` | 題號（v1.1 編號規則）；AI 題 1…n |
| `label` | `TEXT NOT NULL` | 題本印的題號字串，例如 '47A'、'中譯英1' |
| `mode` | `TEXT NOT NULL CHECK (mode IN ('single_choice','multi_select','bank_choice','fill_in_blank','short_answer','table_completion','translation','composition'))` | 作答模式 |
| `stem` | `TEXT` | 題幹（逐字） |
| `options_json` | `TEXT CHECK (options_json IS NULL OR json_valid(options_json))` | 選項 |
| `answer_json` | `TEXT CHECK (answer_json IS NULL OR json_valid(answer_json))` | 答案：單選字母、多選陣列、填充字串、JSON null；中譯英一律 NULL（官方譯文在 restricted_json） |
| `accepted_json` | `TEXT CHECK (accepted_json IS NULL OR json_valid(accepted_json))` | 其他可接受答案；中譯英一律 NULL |
| `points` | `ANY CHECK (typeof(points) IN ('integer','real','null'))` | 配分（原樣） |
| `stats_json` | `TEXT CHECK (stats_json IS NULL OR json_valid(stats_json))` | 大考中心統計（原樣） |
| `tags_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(tags_json) AND json_type(tags_json) = 'object')` | 小題標註（原樣） |
| `restricted_json` | `TEXT CHECK (restricted_json IS NULL OR (json_valid(restricted_json) AND json_type(restricted_json) = 'object'))` | 受保護：scoring_notes；中譯英的 answer、accepted_answers、answer_segments、answer_variants、answer_is_composite。學生端永不 SELECT |
| `extra_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND json_type(extra_json) = 'object')` | 選填與規格外欄位 |
| `answer_hash` | `TEXT NOT NULL` | 答案、可接受答案、計分例外的雜湊：作答與解析綁定它 |
| `test_point` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.test_point')) VIRTUAL` | 考點 |
| `answer_pos` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.answer_pos')) VIRTUAL` | 答案詞性 |
| `grammar_point` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.grammar_point')) VIRTUAL` | 文法點 |
| `item_type` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.item_type')) VIRTUAL` | 閱讀題目類型 |
| `clue` | `TEXT GENERATED ALWAYS AS (json_extract(tags_json, '$.clue')) VIRTUAL` | 篇章結構線索類型 |
| `skill` | `TEXT GENERATED ALWAYS AS (COALESCE(json_extract(tags_json, '$.test_point'), json_extract(tags_json, '$.item_type'), json_extract(tags_json, '$.clue'))) VIRTUAL` | 主要技能（錯題重測找同技能新題） |
| `correct_rate` | `REAL GENERATED ALWAYS AS (json_extract(stats_json, '$.correct_rate')) VIRTUAL` | 全國答對率 |
| `discrimination` | `REAL GENERATED ALWAYS AS (json_extract(stats_json, '$.discrimination')) VIRTUAL` | 鑑別度 |
| `answer_entry_id` | `TEXT REFERENCES vocab_entries(id)` | 詞彙類題目的正解條目 |
| `answer_level` | `INTEGER CHECK (answer_level IS NULL OR answer_level BETWEEN 1 AND 6)` | 正解級別 |
| `tier` | `TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top'))` | 小題難度 |

表層約束：`UNIQUE (group_id, label)`；`UNIQUE (group_id, ord)`；`CHECK (mode <> 'translation' OR (answer_json IS NULL AND accepted_json IS NULL))`；`CHECK (mode NOT IN ('single_choice','bank_choice') OR (answer_json IS NOT NULL AND json_type(answer_json) = 'text'))`；`CHECK (mode <> 'multi_select' OR (answer_json IS NOT NULL AND json_type(answer_json) = 'array'))`；`CHECK (mode <> 'composition' OR (answer_json IS NOT NULL AND answer_json = 'null'))`　選項：`STRICT`

#### `group_sources`、`item_curriculum`

`group_sources` 是授權明細（04 文件 §7.3）：一個 AI 題組可能參考了 3 份事實單和 1 個 OWID 資料集；題組本身另存「最嚴格者」的摘要（`license`、`share_alike`、`commercial_ok`），日後決定收費時一句 SQL 就能清查。`item_curriculum` 是每題的課綱代碼，`basis` 標明是本站判讀（`inferred`）、大考中心〈試題特色〉明文引用（`ceec_feature`）、還是生成器標的（01 文件 §7.1）；用連結表而不是 JSON 陣列，「哪些學習表現練得少」這類查詢才能走索引。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `source_id` | `TEXT NOT NULL REFERENCES sources(id)` | 來源 |
| `role` | `TEXT NOT NULL CHECK (role IN ('exam','fact','adapted_text','data','image'))` | 來源角色 |
| `locator` | `TEXT` | 頁碼、資料欄位等定位資訊 |

表層約束：`PRIMARY KEY (group_id, source_id, role)`　選項：`STRICT, WITHOUT ROWID`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `item_id` | `TEXT NOT NULL REFERENCES items(id)` | 小題 |
| `code` | `TEXT NOT NULL REFERENCES curriculum_codes(code)` | 課綱代碼 |
| `weight` | `TEXT NOT NULL CHECK (weight IN ('primary','secondary'))` | 主要／次要 |
| `basis` | `TEXT NOT NULL CHECK (basis IN ('inferred','ceec_feature','generator'))` | 判讀依據 |

表層約束：`PRIMARY KEY (item_id, code)`　選項：`STRICT, WITHOUT ROWID`

#### `item_params`

共同量尺上的題目參數（SPEC §3）。歷屆 111–115 題由官方五組答對率 Pa–Pe 擬合（`official_fit`），其他有全國答對率的題用 P 換算（`official_p`），AI 題上架時依規格給先驗（`spec`），Phase 5 起用站內作答線上校正（`online`）。`theta70` 是「預測答對率 70% 的能力位置」，三種難度直接用它分級。這張表可以更新；同一個 uid 出新版本時，若 `face_hash` 相同就沿用參數。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `item_id` | `TEXT PRIMARY KEY REFERENCES items(id)` | 小題（版本） |
| `a` | `REAL` | 鑑別參數 |
| `b` | `REAL` | 難度位置（學測母體 θ~N(0,1)） |
| `c` | `REAL` | 猜測參數（依作答形式固定） |
| `theta70` | `REAL` | 預測答對率 70% 的能力位置：三種難度的分級依據 |
| `se` | `REAL` | 標準誤 |
| `n` | `INTEGER NOT NULL DEFAULT 0` | 校正用的作答數 |
| `basis` | `TEXT NOT NULL CHECK (basis IN ('official_fit','official_p','spec','online','manual'))` | 參數來源 |
| `fit_json` | `TEXT CHECK (fit_json IS NULL OR json_valid(fit_json))` | 擬合殘差、可信區間 |
| `updated_at` | `INTEGER NOT NULL` | 更新時間 |

選項：`STRICT`

#### `annotations`

附在題組上的「註解」，和題目內容分開版本化：

| kind | 內容 | 綁 `answer_hash` |
|---|---|---|
| `explanations` | 逐題解析：正解依據（逐字證據句）、你選的為什麼錯（逐選項）、可遷移策略、詞性與線索、提示階梯三層 | 是 |
| `translation_zh` | 選文中文翻譯 | 否 |
| `rubric` | 中譯英：4 個語意單位與標的詞彙、句型、本站參考譯文（≥2 種）；混合題：可接受答案的判斷說明 | 是 |
| `model_texts` | 作文範文兩篇（穩健版、頂標版）與逐句註解 | 否 |
| `guess_targets` | 閱讀生字推測：目標字、三個選項、線索類型 | 否 |
| `open_tasks` | 思考表達開放題：題目、參考回答、自評檢核表 | 否 |
| `elimination` | 文意選填、篇章結構的「可行集合」矩陣（驗證流程算出的），交卷後的排除法畫面用 | 是 |

為什麼分開：(1) 歷屆題是大考中心的內容，本站寫的詳解不能混進同一列；(2) 改一個錯字只要新增註解版本，題組不用改版，作答統計不受影響；(3) **綁 `group_uid`＋`answer_hash`**：題目出新版本但答案沒變（例如只修正轉錄錯字），解析自動沿用；答案一改，舊解析的 `answer_hash` 對不上，自動不顯示，不會出現「解析和答案對不上」。讀取規則：同一 `(group_uid, kind)` 取已上架、`answer_hash` 為 NULL 或等於題組目前版本的最新版本。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | '{group_uid}:{kind}@{version}' |
| `group_uid` | `TEXT NOT NULL` | 題組 uid（跨版本） |
| `kind` | `TEXT NOT NULL` | explanations｜translation_zh｜rubric｜model_texts｜guess_targets｜open_tasks｜elimination（程式驗證） |
| `version` | `INTEGER NOT NULL CHECK (version >= 1)` | 註解版本 |
| `answer_hash` | `TEXT` | 依賴答案的註解必填，必須等於題組目前版本的 answer_hash 才顯示 |
| `body_json` | `TEXT NOT NULL CHECK (json_valid(body_json) AND length(body_json) <= 262144)` | 內容 |
| `origin` | `TEXT NOT NULL CHECK (origin IN ('program','agent','batch','human'))` | 來源 |
| `gen_run_id` | `TEXT REFERENCES gen_runs(id)` | 生成批次 |
| `status` | `TEXT NOT NULL CHECK (status IN ('needs_review','published','rejected','retired','withdrawn'))` | 狀態 |
| `approved_by` | `INTEGER` | users.id（不設外鍵） |
| `approved_at` | `INTEGER` | 核准時間 |
| `body_hash` | `TEXT NOT NULL` | 內容雜湊 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

表層約束：`UNIQUE (group_uid, kind, version)`；`CHECK (status <> 'withdrawn' OR body_json = '{}')`　選項：`STRICT`

#### `item_reviews`

程式檢查、兩位盲解、干擾選項稽核、唯一正解、相似度、事實核對、人工審核、回報處理、上線後監控的完整紀錄，只增不減。上架判定規則（SPEC §5）直接查這張表；也因此「每一個已上架題組都通過了哪些檢查」可以用 SQL 證明（Phase 2 驗收項）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('program','blind_solver','distractor_audit','unique_solution','similarity','fact_check','grader_check','human','report_triage','stats_monitor'))` | 檢查種類 |
| `reviewer` | `TEXT NOT NULL` | 模型 ID、'validate_bank.py@<sha>'、'admin:{users.id}' |
| `verdict` | `TEXT NOT NULL CHECK (verdict IN ('pass','warn','fail','revise','info'))` | 判定 |
| `report_json` | `TEXT NOT NULL CHECK (json_valid(report_json) AND length(report_json) <= 65536)` | 報告 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

選項：`STRICT`

#### `item_stats`

站內作答統計，由 Cron 每 5 分鐘從 `attempts` 增量彙整（`cursor_attempt_id` 記到哪一筆），不在每次作答時寫同一列（避免熱點寫入）。只計入「首次接觸、第一次嘗試、作答前沒看過答案、沒用提示、沒開作答中鷹架（`scaffold=0`）、不是過快作答、`answer_hash` 相同」的作答，這些才能用來校正難度。帶 `reused_from` 的小題（參考試卷沿用歷屆題，214 題）不另外校正，參數沿用原題（§5.1）。`flags_json` 是上線後監控的異常旗標（鑑別度為負、前段學生偏選某個干擾、沒人選的干擾），會把題組送回復審。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `item_id` | `TEXT PRIMARY KEY REFERENCES items(id)` | 小題（版本） |
| `answer_hash` | `TEXT NOT NULL` | 統計所依據的答案版本 |
| `n_first` | `INTEGER NOT NULL DEFAULT 0` | 校正用作答數（首次接觸、沒看答案、沒用提示、沒開作答中鷹架、非過快） |
| `n_first_correct` | `REAL NOT NULL DEFAULT 0` | 其中答對（部分給分以比例累計） |
| `n_all` | `INTEGER NOT NULL DEFAULT 0` | 全部作答數 |
| `option_counts_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(option_counts_json))` | 各選項人數 |
| `top_option_counts_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(top_option_counts_json))` | 能力前 27% 的選項分布 |
| `p_value` | `REAL` | 首答答對率 |
| `disc_index` | `REAL` | 前後 27% 答對率差 |
| `time_ms_median` | `INTEGER` | 作答時間中位數 |
| `rapid_rate` | `REAL` | 過快作答比例 |
| `flags_json` | `TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(flags_json))` | 'negative_discrimination'、'top_prefers_distractor'、'dead_distractor'… |
| `cursor_attempt_id` | `INTEGER NOT NULL DEFAULT 0` | 已彙整到哪一筆 attempts.id |
| `updated_at` | `INTEGER NOT NULL` | 更新時間 |

選項：`STRICT`

#### `takedowns`

權利人來信或授權撤回的處理紀錄。流程（ARCHITECTURE §9.4 手冊）：題組改 `withdrawn` 並墓碑化 → git 端在 `data/takedowns.jsonl` 登記並刪除檔案（CI 的只增不減守門只在有登記時放行刪檔）→ 這張表記完成時間與 commit。不存請求者的個資。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | 'td-2027-0001' |
| `target_kind` | `TEXT NOT NULL CHECK (target_kind IN ('group','annotation','source','vocab_example','other'))` | 撤回對象種類 |
| `target_id` | `TEXT NOT NULL` | 對象 id（題組 uid、來源 id…） |
| `reason` | `TEXT NOT NULL` | 原因摘要 |
| `requester_kind` | `TEXT NOT NULL CHECK (requester_kind IN ('rights_holder','ceec','internal','other'))` | 請求者類型 |
| `received_at` | `INTEGER NOT NULL` | 收到時間 |
| `completed_at` | `INTEGER` | 完成時間（D1 墓碑化＋git 登記都完成） |
| `git_ref` | `TEXT` | 對應 data/takedowns.jsonl 的 commit |
| `notes` | `TEXT` | 補充 |

選項：`STRICT`

### 3.4 帳號、同意、偏好

#### `users`

AI 核准狀態（`ai_status`）和帳號狀態（`status`）分開：不必核准就能登入、存紀錄；只有 AI 功能要核准。核准流程的欄位直接放在 `users`（沿用 Sekai，05 文件 §2.2），歷史動作記在 `admin_audit`，不另開申請表。`ai_apply_note` 是申請者寫的文字，後台顯示時標示為不可信資料（二階注入防護）。

- `age_band`：首次登入自述「未滿 18 歲／18 歲以上」，不收生日。未滿 18 歲的帳號申請 AI 時要另外勾選「已告知法定代理人」（`consents.kind='guardian_ack'`）。作文保存期限的預設對兩種年齡相同（1 年，學生可改 30 天或直到自己刪除）；要不要對未成年改用更短的預設，列在律師確認事項（ROADMAP D6、D7），確定後只改程式預設值，不必改表。
- `session_ver`：session cookie 帶著它；「登出所有裝置」、停權、刪帳號都把它加 1，舊 cookie 下一個請求就失效。
- `last_active_day`：一天最多寫一次，不在每個請求寫 D1。
- `waitlist`：核准名額（ARCHITECTURE §6.6）已滿時的候補狀態。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 內部 id（cookie 內的 u）；AUTOINCREMENT 保證不重用 |
| `public_id` | `TEXT NOT NULL UNIQUE` | crypto.randomUUID()：匯出、後台網址用 |
| `google_sub` | `TEXT NOT NULL UNIQUE` | Google 帳號識別鍵（不用 email） |
| `email` | `TEXT NOT NULL` | 只供登入識別與管理員聯絡；介面不顯示 |
| `display_name` | `TEXT CHECK (display_name IS NULL OR length(display_name) <= 40)` | 暱稱 |
| `role` | `TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','admin'))` | 角色 |
| `status` | `TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleting'))` | 帳號狀態 |
| `age_band` | `TEXT CHECK (age_band IS NULL OR age_band IN ('under18','18plus'))` | 首次登入自述的年齡區間（不收生日） |
| `ai_status` | `TEXT NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none','pending','waitlist','approved','rejected','suspended'))` | AI 核准狀態 |
| `ai_tier` | `TEXT NOT NULL DEFAULT 'standard' CHECK (ai_tier IN ('trial','standard','unlimited'))` | 額度等級 |
| `ai_points_day` | `INTEGER CHECK (ai_points_day IS NULL OR ai_points_day >= 0)` | 每日點數個別覆寫 |
| `ai_points_month` | `INTEGER CHECK (ai_points_month IS NULL OR ai_points_month >= 0)` | 每月點數個別覆寫 |
| `ai_applied_at` | `INTEGER` | 最近一次申請時間（冷卻用） |
| `ai_apply_count` | `INTEGER NOT NULL DEFAULT 0 CHECK (ai_apply_count BETWEEN 0 AND 10)` | 申請次數（上限 10） |
| `ai_apply_note` | `TEXT CHECK (ai_apply_note IS NULL OR length(ai_apply_note) <= 300)` | 申請說明：不可信資料 |
| `ai_invite_hash` | `TEXT` | 用了哪個邀請碼（雜湊） |
| `ai_reviewed_by` | `INTEGER` | 核准者 users.id（不設外鍵） |
| `ai_reviewed_at` | `INTEGER` | 核准時間 |
| `session_ver` | `INTEGER NOT NULL DEFAULT 1 CHECK (session_ver >= 1)` | +1＝所有裝置登出 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `last_active_day` | `TEXT` | 最後活動的台灣日期（一天最多寫一次） |
| `delete_requested_at` | `INTEGER` | 申請刪除的時間 |

表層約束：`CHECK (status <> 'deleting' OR delete_requested_at IS NOT NULL)`　選項：`STRICT`

#### `consents`

同意紀錄依種類分版本，只增不改：`privacy`（隱私權說明）、`terms`（服務條款）、`ai_processing`（作文、照片會傳給 Anthropic 的 API 處理，處理地點可能在境外）、`guardian_ack`（未滿 18 歲者勾選「已告知法定代理人」）、`improve_grading`（同意以去識別方式用於改善批改，管理員才能在品質抽查中看到這篇作文）。條款改版時，`users` 最新一筆該種類同意的版本不是現行版本，就要求重新同意。trigger 禁止修改，只能隨帳號刪除。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('privacy','terms','ai_processing','guardian_ack','improve_grading'))` | 同意種類；ai_processing 含「傳給 Anthropic（境外）處理」 |
| `version` | `TEXT NOT NULL` | 條款版本，例如 '2026-11-01' |
| `granted` | `INTEGER NOT NULL CHECK (granted IN (0,1))` | 1＝同意、0＝撤回 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |

選項：`STRICT`

#### `user_prefs`

少量結構化設定。`exam_date` 預設 116 學測英文考科日 `2027-01-23`，FSRS 排程不讓到期日跨過它（SPEC §6.1）；`essay_retention` 讓學生自己選作文保存期限（30 天、1 年、直到自己刪除）；`confidence_enabled` 可以關掉作答時的信心選擇。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `user_id` | `INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `target_tier` | `TEXT NOT NULL DEFAULT 'advanced' CHECK (target_tier IN ('basic','advanced','top'))` | 目標難度 |
| `target_level` | `INTEGER CHECK (target_level IS NULL OR target_level BETWEEN 1 AND 15)` | 目標級分 |
| `exam_date` | `TEXT CHECK (exam_date IS NULL OR exam_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')` | 考試日（排程不跨過它） |
| `srs_daily_new` | `INTEGER NOT NULL DEFAULT 15 CHECK (srs_daily_new BETWEEN 0 AND 100)` | 每日新字數 |
| `srs_retention` | `REAL NOT NULL DEFAULT 0.9 CHECK (srs_retention BETWEEN 0.7 AND 0.97)` | FSRS 目標保留率 |
| `srs_decks_json` | `TEXT NOT NULL DEFAULT '["L3","L4","L5"]' CHECK (json_valid(srs_decks_json))` | 學習範圍 |
| `srs_params_json` | `TEXT CHECK (srs_params_json IS NULL OR json_valid(srs_params_json))` | 個人化 FSRS 權重（Phase 5） |
| `confidence_enabled` | `INTEGER NOT NULL DEFAULT 1 CHECK (confidence_enabled IN (0,1))` | 作答時是否詢問信心 |
| `essay_retention` | `TEXT NOT NULL DEFAULT '1y' CHECK (essay_retention IN ('30d','1y','forever'))` | 作文保存期限（學生自選） |
| `scale_year` | `INTEGER NOT NULL DEFAULT 115` | 級分換算用哪一年的對照表 |
| `ui_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ui_json) AND length(ui_json) <= 8192)` | 介面偏好（不放作答紀錄） |
| `updated_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 更新時間 |

選項：`STRICT`

#### `invite_codes`、`user_notices`

邀請碼只存雜湊，外流也只能用到 `max_uses` 為止；`used` 用條件式 UPDATE 遞增（`WHERE used < max_uses AND revoked_at IS NULL AND expires_at > ?`），不會超用。`user_notices` 是站內通知：答案更正後的分數重算、條款改版、批改完成；只存文案參數，不存學生內容。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `code_hash` | `TEXT PRIMARY KEY` | SHA-256(邀請碼)；原碼只在建立時顯示一次 |
| `label` | `TEXT NOT NULL` | 例如「某校 302 班」 |
| `ai_tier` | `TEXT NOT NULL CHECK (ai_tier IN ('trial','standard'))` | 核准後的額度等級 |
| `max_uses` | `INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 500)` | 可用次數 |
| `used` | `INTEGER NOT NULL DEFAULT 0` | 已用次數（條件式 UPDATE，不會超用） |
| `expires_at` | `INTEGER NOT NULL` | 到期時間 |
| `revoked_at` | `INTEGER` | 撤銷時間 |
| `created_by` | `INTEGER NOT NULL` | 建立者 users.id（不設外鍵） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

表層約束：`CHECK (used BETWEEN 0 AND max_uses)`　選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `kind` | `TEXT NOT NULL` | 'regrade'、'terms_update'、'grading_done'、'relogin'（程式白名單） |
| `ref_id` | `TEXT` | 相關 id |
| `params_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(params_json) AND length(params_json) <= 2048)` | 文案參數（不放學生內容） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `read_at` | `INTEGER` | 已讀時間 |

選項：`STRICT`

### 3.5 作答、錯題、間隔重複、學習分析

#### `practice_sessions`

一次練習、一份歷屆卷、一次模擬考、一次錯題重測或檢核。前端產生 `client_id`（UUID），伺服器用 `UNIQUE(user_id, client_id)` 做冪等，內部用整數 id。模擬考的作答暫存在 `draft_json`（≤64 KB，每 30 秒與切換分頁時存），交卷後才拆成 `attempts`。`config_json` 凍結這份練習用到的題組版本，之後題目改版也不影響這份卷。級分與換算年度一起存，換對照表後仍能重現當時的結果（畫面標「非官方級分」）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 內部 id |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `client_id` | `TEXT NOT NULL` | 前端產生的 UUID（重送冪等） |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('set','paper','mock','retest','checkpoint','diagnostic'))` | 種類 |
| `paper_id` | `TEXT REFERENCES papers(id)` | 整份試卷時 |
| `section_type` | `TEXT` | 題型 |
| `tier` | `TEXT CHECK (tier IS NULL OR tier IN ('basic','advanced','top'))` | 難度 |
| `config_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(config_json) AND length(config_json) <= 16384)` | 計時模式、提示開關、題組清單（凍結版本） |
| `status` | `TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','abandoned'))` | 狀態 |
| `draft_json` | `TEXT CHECK (draft_json IS NULL OR (json_valid(draft_json) AND length(draft_json) <= 65536))` | 模擬考暫存（每 30 秒） |
| `started_at` | `INTEGER NOT NULL` | 開始時間（伺服器時鐘） |
| `deadline_at` | `INTEGER` | 模擬考期限 |
| `submitted_at` | `INTEGER` | 交卷時間 |
| `elapsed_s` | `INTEGER CHECK (elapsed_s IS NULL OR elapsed_s >= 0)` | 用時 |
| `raw_score` | `REAL` | 原得分 |
| `max_score` | `REAL` | 滿分 |
| `section_scores_json` | `TEXT CHECK (section_scores_json IS NULL OR json_valid(section_scores_json))` | 各大題得分與用時 |
| `scaled_score` | `INTEGER CHECK (scaled_score IS NULL OR scaled_score BETWEEN 0 AND 15)` | 級分（非官方） |
| `scale_year` | `INTEGER` | 換算年度 |
| `pending_writing` | `INTEGER NOT NULL DEFAULT 0` | 還在等 AI 或自評的非選擇題數 |

表層約束：`UNIQUE (user_id, client_id)`　選項：`STRICT`

#### `attempts`

逐題作答，是學習分析、難度校正、錯題與答案更正的根據，所以是正規化的表，不是 Sekai 那種 JSON KV（05 文件 §3.5 第 10 點）。

**第一天就要記的欄位**（之後才能校正難度、算學習指標，少了補不回來）：

| 欄位 | 為什麼 |
|---|---|
| `first_exposure` | 只有第一次接觸的作答能拿來校正題目難度；重做的題目答對可能只是記得答案 |
| `attempt_no` | 「答錯再試一次」的第二次作答（2）不計分，只更新精熟度 |
| `hints_used` | 用了提示的作答不計入校正，FSRS 評分最多 Hard |
| `saw_answer` | 先看過答案或解析再作答的，不計入校正 |
| `time_ms`、`rapid` | 過快作答（低於 max(3 秒, 該題型中位數 10%)）視為亂猜，不計入校正 |
| `scaffold` | 逐格回饋（填一格就知道對錯，後面的格子等於有了提示）、文意選填的詞性預判（先對過詞性答案）、比較表或「從文中選取」協助都會讓題目變簡單；開過的作答不計入校正，但照常計分與排程（2026-10-08 審查補上：原設計 SPEC §4.2 說「開啟後不計入校正」卻沒有欄位可篩） |
| `confidence` | 「確定卻答錯」要特別回饋並優先重測；也用來算信心校準（可在偏好關閉，關閉時 NULL） |
| `error_tag` | 學生自評錯因，和系統依標註推定的錯因比對 |
| `answer_hash` | 評分當下的答案版本，答案更正時找出要重算的作答 |

- 冪等鍵 `(session_id, item_id, attempt_no)`：前端重送同一批作答時 `INSERT … ON CONFLICT DO NOTHING`，不會重複。
- 只建兩個索引（另加唯一約束的索引）：`(user_id, answered_at)` 給個人紀錄與保存期限清理，`(item_id, answer_hash)` 給答案更正與題目統計。Cron 增量彙整用整數主鍵當游標，不需要索引。
- 不存 `tw_day`、不存 `group_id`：日期由 `answered_at` 換算，題組由 `item_id` 推得；每列省幾十個位元組。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 內部 id（Cron 彙整的游標） |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `session_id` | `INTEGER NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE` | 練習 |
| `item_id` | `TEXT NOT NULL REFERENCES items(id)` | 小題（版本） |
| `attempt_no` | `INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no IN (1,2))` | 1＝第一次；2＝「再試一次」（不計分，只更新精熟度） |
| `answer_hash` | `TEXT NOT NULL` | 評分當下的答案版本（答案更正時找出要重算的作答） |
| `response_json` | `TEXT NOT NULL CHECK (json_valid(response_json) AND length(response_json) <= 4096)` | 作答內容 |
| `score` | `REAL CHECK (score IS NULL OR score >= 0)` | 得分；NULL＝待批改 |
| `max_score` | `REAL NOT NULL CHECK (max_score >= 0)` | 滿分 |
| `is_correct` | `INTEGER CHECK (is_correct IS NULL OR is_correct IN (0,1))` | 是否全對；NULL＝待批改 |
| `scoring` | `TEXT NOT NULL CHECK (scoring IN ('auto','variant','partial_rule','ai','self','pending','regrade'))` | 這一分怎麼來的 |
| `first_exposure` | `INTEGER NOT NULL CHECK (first_exposure IN (0,1))` | 這個人第一次接觸這個題組 |
| `hints_used` | `INTEGER NOT NULL DEFAULT 0 CHECK (hints_used BETWEEN 0 AND 3)` | 用了幾層提示 |
| `saw_answer` | `INTEGER NOT NULL DEFAULT 0 CHECK (saw_answer IN (0,1))` | 作答前是否已看過答案或解析 |
| `confidence` | `INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 2)` | 0 猜的、1 有點把握、2 確定；關閉時 NULL |
| `error_tag` | `TEXT` | 學生自評的錯因（vocab、collocation、grammar、context、careless、time、misread） |
| `time_ms` | `INTEGER CHECK (time_ms IS NULL OR time_ms BETWEEN 0 AND 7200000)` | 作答時間 |
| `rapid` | `INTEGER NOT NULL DEFAULT 0 CHECK (rapid IN (0,1))` | 過快作答（不計入校正） |
| `scaffold` | `INTEGER NOT NULL DEFAULT 0 CHECK (scaffold BETWEEN 0 AND 255)` | 作答中鷹架位元旗標：1 逐格回饋、2 詞性預判、4 比較表或「從文中選取」；非 0 不計入難度校正（SPEC §3.6、§4.2） |
| `answered_at` | `INTEGER NOT NULL` | 作答時間（前端時鐘，伺服器做合理性檢查） |

表層約束：`UNIQUE (session_id, item_id, attempt_no)`　選項：`STRICT`

#### `user_group_seen`

每人接觸過哪些題組（跨版本，用 uid）。兩個用途：(1) 抽題時排除做過的題組：先用 `pick_order` 取 20–40 個候選，再用 `json_each` 一次查出哪些做過；(2) 判斷作答的 `first_exposure`。每人約數百列，比每次掃 `attempts` 便宜得多。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `group_uid` | `TEXT NOT NULL` | 題組 uid |
| `first_at` | `INTEGER NOT NULL` | 第一次接觸 |
| `last_at` | `INTEGER NOT NULL` | 最近一次 |
| `times` | `INTEGER NOT NULL DEFAULT 1` | 次數 |

表層約束：`PRIMARY KEY (user_id, group_uid)`　選項：`STRICT, WITHOUT ROWID`

#### `answer_corrections`、`attempt_regrades`

官方答案更正（或本站 AI 題的答案錯誤）時的流程紀錄（SPEC §4.7）：題組先隔離 → 建新版本 → **試算**受影響的作答數、人數與分數變化分布（`dry_run_json`）→ 管理員確認 → 批次重算 `attempts.score`、錯題本與模擬考總分 → 每一筆原分數寫進 `attempt_regrades` → 對受影響的學生發 `user_notices`。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `group_uid` | `TEXT NOT NULL` | 題組 uid |
| `from_group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 舊版本 |
| `to_group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 新版本 |
| `status` | `TEXT NOT NULL CHECK (status IN ('dry_run','confirmed','applied','canceled'))` | 狀態 |
| `affected_attempts` | `INTEGER` | 試算：受影響作答數 |
| `affected_users` | `INTEGER` | 試算：受影響人數 |
| `dry_run_json` | `TEXT CHECK (dry_run_json IS NULL OR json_valid(dry_run_json))` | 試算的分數變化分布 |
| `created_by` | `INTEGER NOT NULL` | 管理員 users.id（不設外鍵） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `applied_at` | `INTEGER` | 完成時間 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `attempt_id` | `INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE` | 作答 |
| `correction_id` | `TEXT NOT NULL` | answer_corrections.id |
| `regraded_at` | `INTEGER NOT NULL` | 重算時間 |
| `old_score` | `REAL` | 原分數 |
| `new_score` | `REAL` | 新分數 |
| `old_answer_hash` | `TEXT NOT NULL` | 原答案版本 |
| `new_answer_hash` | `TEXT NOT NULL` | 新答案版本 |

表層約束：`PRIMARY KEY (attempt_id, correction_id)`　選項：`STRICT, WITHOUT ROWID`

#### `srs_cards`

間隔重複卡片，FSRS 排程（`ts-fsrs`）。卡別：

| kind | 內容 | 建立時機 |
|---|---|---|
| `word` | 認得（看英選中、例句中選義、例句填空） | 每日新字、查詞加入、答錯的正解字 |
| `spell` | 會拼（給中文與首字母，限 L1–4） | `word` 卡穩定度 ≥7 天時自動建立 |
| `usage` | 用法：搭配詞選擇、近義辨析、詞性轉換（輪替出題） | 有搭配、近義或詞族資料的字，`word` 卡穩定度 ≥7 天時 |
| `sense` | 多義選義：同一字的學測常考延伸義 | 有 `exam_salient` 義項的字 |
| `phrase` | 片語（整條，不拆字） | 片語學習、查詞加入 |
| `pattern` | 句型（中譯英用到的句型） | 中譯英批改後自動建立（Phase 3） |
| `item` | 錯題重測 | 選擇題答錯時 |

錯題卡（`kind='item'`）記原題 `item_id` 和 `skill_key`（`{題型}:{主要技能}`）。到期時優先出「同一主要技能、這個人沒做過的新題」，沒有新題才出原題，並在 `srs_reviews` 標 `is_variant=0`、`counts_for_mastery=0`（SPEC §6.12）。`ref_key` 加唯一約束防重複（SQLite 的 UNIQUE 把 NULL 視為不同值，不能直接拿可為 NULL 的外鍵欄位當唯一鍵）。新字不預先建卡：學生第一次學到才建，避免一個人一開始就有 3,006 列。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 內部 id |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('word','spell','usage','sense','phrase','pattern','item'))` | 卡別 |
| `entry_id` | `TEXT REFERENCES vocab_entries(id)` | 單字卡 |
| `sense_id` | `TEXT REFERENCES vocab_senses(id)` | 多義卡 |
| `phrase_id` | `TEXT REFERENCES phrases(id)` | 片語卡 |
| `pattern_id` | `TEXT REFERENCES grammar_patterns(id)` | 句型卡 |
| `item_id` | `TEXT REFERENCES items(id)` | 錯題卡的原題 |
| `skill_key` | `TEXT` | 錯題卡：'{section_type}:{skill}'，到期時找同技能的新題 |
| `ref_key` | `TEXT NOT NULL` | 去重鍵：entry_id／sense_id／phrase_id／pattern_id／'{group_uid}#{label}' |
| `origin` | `TEXT NOT NULL CHECK (origin IN ('deck','wrong_answer','lookup','manual','item_option','translation'))` | 怎麼建立的 |
| `state` | `INTEGER NOT NULL DEFAULT 0 CHECK (state BETWEEN 0 AND 3)` | ts-fsrs：0 New 1 Learning 2 Review 3 Relearning |
| `due_at` | `INTEGER NOT NULL` | 下次到期 |
| `stability` | `REAL NOT NULL DEFAULT 0` | FSRS 穩定度（天） |
| `difficulty` | `REAL NOT NULL DEFAULT 0` | FSRS 難度 |
| `elapsed_days` | `INTEGER NOT NULL DEFAULT 0` | 距上次複習天數 |
| `scheduled_days` | `INTEGER NOT NULL DEFAULT 0` | 排定間隔 |
| `learning_steps` | `INTEGER NOT NULL DEFAULT 0` | 學習步驟 |
| `reps` | `INTEGER NOT NULL DEFAULT 0` | 複習次數 |
| `lapses` | `INTEGER NOT NULL DEFAULT 0` | 遺忘次數（≥6 進難字區） |
| `last_review_at` | `INTEGER` | 最近一次複習 |
| `suspended` | `INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1))` | 暫停 |
| `note` | `TEXT CHECK (note IS NULL OR length(note) <= 500)` | 學生筆記 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

表層約束：`UNIQUE (user_id, kind, ref_key)`；`CHECK ((kind IN ('word','spell','usage') AND entry_id IS NOT NULL) OR (kind = 'sense'   AND sense_id   IS NOT NULL) OR (kind = 'phrase'  AND phrase_id  IS NOT NULL) OR (kind = 'pattern' AND pattern_id IS NOT NULL) OR (kind = 'item'    AND item_id    IS NOT NULL AND skill_key IS NOT NULL))`　選項：`STRICT`

#### `srs_reviews`

每次複習一列，只增不改（trigger）。`retrievability_before` 存排程器當時預測的提取機率，可以直接量測「排程器準不準」（SPEC §7，指標 M2）；`counts_for_mastery`、`is_variant` 讓錯題訂正率只算新題。冪等鍵 `(card_id, reviewed_at_ms)`：同一張卡不會在同一毫秒複習兩次，不必另存 UUID。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 內部 id |
| `card_id` | `INTEGER NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE` | 卡片 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `reviewed_at_ms` | `INTEGER NOT NULL` | 複習時間（毫秒；兼冪等鍵） |
| `rating` | `INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4)` | Again／Hard／Good／Easy（多半由作答自動換算） |
| `quiz_type` | `TEXT NOT NULL` | flashcard、en2zh、context_meaning、sentence_cloze、zh2en、spelling、collocation、synonym、word_family、sense_choice、phrase_cloze、pattern、item_retest（程式白名單） |
| `served_item_id` | `TEXT REFERENCES items(id)` | 錯題卡實際出的題 |
| `is_variant` | `INTEGER NOT NULL DEFAULT 0 CHECK (is_variant IN (0,1))` | 出的是同技能新題（1）還是原題（0） |
| `counts_for_mastery` | `INTEGER NOT NULL DEFAULT 1 CHECK (counts_for_mastery IN (0,1))` | 原題重做、用了提示：不計入精熟 |
| `hinted` | `INTEGER NOT NULL DEFAULT 0 CHECK (hinted IN (0,1))` | 用了提示（評分最多 Hard） |
| `state_before` | `INTEGER NOT NULL` | 複習前狀態 |
| `stability_before` | `REAL` | 複習前穩定度 |
| `difficulty_before` | `REAL` | 複習前難度 |
| `retrievability_before` | `REAL` | 排程器預測的提取機率（量測排程器準不準） |
| `due_before` | `INTEGER` | 原到期時間 |
| `elapsed_days` | `REAL NOT NULL` | 距上次複習天數 |
| `scheduled_days` | `INTEGER NOT NULL` | 新排定間隔 |
| `response_ms` | `INTEGER` | 反應時間 |

表層約束：`UNIQUE (card_id, reviewed_at_ms)`　選項：`STRICT`

#### `user_skill_daily`

學習分析的日彙整，交卷時 UPSERT。原始作答 13 個月後刪除，分析圖表照樣有資料。`skill` 的前綴：`tp:` 考點、`it:` 閱讀題目類型、`gp:` 文法點、`cl:` 篇章線索。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `tw_day` | `TEXT NOT NULL` | 台灣日期 |
| `section_type` | `TEXT NOT NULL` | 題型或 'vocab' |
| `skill` | `TEXT NOT NULL` | 'all'、'tp:collocation'、'it:inference'、'gp:tense'、'cl:pronoun_reference' |
| `n` | `INTEGER NOT NULL DEFAULT 0` | 作答數 |
| `correct` | `REAL NOT NULL DEFAULT 0` | 答對（部分給分以比例） |
| `first_n` | `INTEGER NOT NULL DEFAULT 0` | 其中首次接觸的作答數 |
| `first_correct` | `REAL NOT NULL DEFAULT 0` | 其中首次接觸答對 |
| `hints` | `INTEGER NOT NULL DEFAULT 0` | 提示使用次數 |
| `time_ms` | `INTEGER NOT NULL DEFAULT 0` | 累計用時 |

表層約束：`PRIMARY KEY (user_id, tw_day, section_type, skill)`　選項：`STRICT, WITHOUT ROWID`

#### `score_predictions`、`user_ability`

`score_predictions`：每次預測級分記一列（含 80% 區間），下一次模擬考或檢核卷後補上實得，算預測誤差（MAE）與區間覆蓋率（學習指標 M8）。畫面一律標「非官方級分」。`user_ability`：Phase 5 線上校正後的能力估計 θ（與題目 b 同尺度）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `made_at` | `INTEGER NOT NULL` | 預測時間 |
| `basis` | `TEXT NOT NULL CHECK (basis IN ('mock','checkpoint','model'))` | 依據 |
| `scale_year` | `INTEGER NOT NULL` | 換算年度 |
| `predicted_raw` | `REAL NOT NULL` | 預測原得總分 |
| `raw_low` | `REAL NOT NULL` | 80% 區間下限 |
| `raw_high` | `REAL NOT NULL` | 80% 區間上限 |
| `predicted_level` | `INTEGER NOT NULL CHECK (predicted_level BETWEEN 0 AND 15)` | 預測級分 |
| `level_low` | `INTEGER NOT NULL` | 級分區間下限 |
| `level_high` | `INTEGER NOT NULL` | 級分區間上限 |
| `outcome_session_id` | `INTEGER REFERENCES practice_sessions(id) ON DELETE SET NULL` | 之後實際作答的模擬考 |
| `outcome_raw` | `REAL` | 實得原始分 |
| `outcome_level` | `INTEGER` | 實得級分 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `section_type` | `TEXT NOT NULL` | 題型或 'overall' |
| `theta` | `REAL NOT NULL` | 與題目 b 同尺度 |
| `se` | `REAL NOT NULL` | 標準誤 |
| `n` | `INTEGER NOT NULL` | 依據的作答數 |
| `updated_at` | `INTEGER NOT NULL` | 更新時間 |

表層約束：`PRIMARY KEY (user_id, section_type)`　選項：`STRICT, WITHOUT ROWID`

#### `item_reports`

「回報題目錯誤」（答案可能有誤、有兩個答案、錯字、解析有誤、內容不當）。同一題「答案有誤／兩個答案」累積 3 位不同學生回報，自動進復審佇列（SPEC §5.9）。`message` 是學生自由輸入的文字（可能夾帶個資），所以：帳號刪除時刪除流程把該帳號回報的 `message` 清成 NULL（`user_id` 由外鍵設 NULL，`kind` 保留給統計）；已處理的回報 180 天後由 Cron 清空 `message`（ARCHITECTURE §8.3）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `item_id` | `TEXT REFERENCES items(id)` | 小題（可空） |
| `user_id` | `INTEGER REFERENCES users(id) ON DELETE SET NULL` | 回報者 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('wrong_answer','two_answers','typo','explanation','offensive','other'))` | 種類 |
| `message` | `TEXT CHECK (message IS NULL OR length(message) <= 500)` | 說明（不可信資料） |
| `status` | `TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','duplicate'))` | 處理狀態 |
| `resolved_by` | `INTEGER` | 處理者 users.id（不設外鍵） |
| `resolved_at` | `INTEGER` | 處理時間 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

選項：`STRICT`

### 3.6 中譯英、作文、思考表達

#### `submissions`

中譯英以「題組」為單位（2 句一組、一次批改），作文一題一份，思考表達開放題一題一份（Phase 5 才有 AI 回饋）。手寫和打字共用：手寫多了 `ocr_text`（30 天後清空）、`ocr_uncertain_json`（看不清的位置與候選字）、`ocr_diff_json`（學生確認時改了哪些字；批改時告訴模型「這些地方以照片為準」）。差異與候選字可以拼回原始轉錄，所以三欄在 30 天時**一起**清空，只留學生確認版（`body_json`）。

- 狀態機與租約：`queued → grading → graded`；Queue consumer 用條件式 UPDATE 搶 `lease_until`，重送不會重複批改。
- `self_assess_json`：看分數前的自評（作文四項、中譯英各部分），用來算自評校準（SPEC §6.9）。
- `revision_of`、`prev_error_count`、`fixed_count`：修訂稿指向原稿，結果頁顯示「上次標記的 12 個錯誤，這次改正 9 個」。
- `expires_at`：依學生選的保存期限計算；`NULL` 表示「直到自己刪除」。`support_share_until`：學生主動「分享給管理員 7 天」，期限內管理員才看得到這篇，查看寫稽核。
- `safety_flag`：作文內容涉及身心安全（例如自我傷害）時，批改輸出帶的類別旗標；畫面改顯示關懷與求助資訊（ARCHITECTURE §8.5），資料庫只存類別。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('translation','essay','open'))` | 中譯英（2 句一組）／作文／思考表達開放題 |
| `group_id` | `TEXT NOT NULL REFERENCES item_groups(id)` | 題組版本 |
| `session_id` | `INTEGER REFERENCES practice_sessions(id) ON DELETE SET NULL` | 模擬考時 |
| `revision_of` | `TEXT REFERENCES submissions(id) ON DELETE SET NULL` | 修訂稿指向原稿 |
| `input_mode` | `TEXT NOT NULL CHECK (input_mode IN ('typed','photo'))` | 打字／手寫照片 |
| `body_json` | `TEXT CHECK (body_json IS NULL OR (json_valid(body_json) AND length(body_json) <= 16384))` | 中譯英 [{item_id,text}]；作文 {text, plan} |
| `self_assess_json` | `TEXT CHECK (self_assess_json IS NULL OR json_valid(self_assess_json))` | 看分數前的自評（四項或各部分） |
| `ocr_text` | `TEXT CHECK (ocr_text IS NULL OR length(ocr_text) <= 12000)` | OCR 原始轉錄（30 天後清空） |
| `ocr_uncertain_json` | `TEXT CHECK (ocr_uncertain_json IS NULL OR json_valid(ocr_uncertain_json))` | 看不清的位置與候選字 |
| `ocr_diff_json` | `TEXT CHECK (ocr_diff_json IS NULL OR json_valid(ocr_diff_json))` | 學生確認時改了哪些字 |
| `word_count` | `INTEGER` | 字數（程式計算） |
| `paragraphs` | `INTEGER` | 段落數（程式計算） |
| `status` | `TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ocr_queued','ocr_ready','confirmed','queued','grading','graded','self_graded','failed'))` | 狀態機 |
| `lease_until` | `INTEGER` | Queue consumer 用條件式 UPDATE 搶租約 |
| `tries` | `INTEGER NOT NULL DEFAULT 0 CHECK (tries BETWEEN 0 AND 5)` | 嘗試次數 |
| `op_id` | `TEXT` | ai_ops.id |
| `final_score` | `REAL` | 最後分數（程式合成） |
| `final_band` | `TEXT` | 等級 |
| `prev_error_count` | `INTEGER` | 修訂稿：原稿標記的錯誤數 |
| `fixed_count` | `INTEGER` | 修訂稿：改正了幾個（修訂採納率） |
| `injection_flag` | `INTEGER NOT NULL DEFAULT 0 CHECK (injection_flag IN (0,1))` | 疑似提示注入 |
| `safety_flag` | `TEXT` | 內容涉及身心安全時的旗標（只存類別） |
| `support_share_until` | `INTEGER` | 學生主動分享給管理員到這個時間 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `updated_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 更新時間 |
| `graded_at` | `INTEGER` | 批改完成時間 |
| `expires_at` | `INTEGER` | 依學生選的保存期限計算；NULL＝直到自己刪除 |

選項：`STRICT`

#### `submission_photos`

照片本體在私有 R2（`PHOTOS`），D1 只存中繼資料。批改（含第二、第三位評分者）完成就立即刪除 R2 物件並記 `purged_at`；`purge_after`（上傳後 7 天）與 R2 生命週期規則是兜底。R2 key 以 `users.id` 開頭，刪帳號時可以用前綴列出全部照片。`ON DELETE CASCADE` 只會刪 D1 這一列，所以刪除流程一定是「先刪 R2 物件、再刪列」。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `submission_id` | `TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE` | 提交 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `ord` | `INTEGER NOT NULL CHECK (ord BETWEEN 1 AND 2)` | 第幾張 |
| `r2_key` | `TEXT NOT NULL UNIQUE` | 'essay-photos/{users.id}/{submission_id}/{id}.jpg' |
| `bytes` | `INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 2097152)` | 大小（≤2 MB） |
| `mime` | `TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/webp','image/png'))` | 格式 |
| `width` | `INTEGER` | 寬 |
| `height` | `INTEGER` | 高 |
| `sha256` | `TEXT NOT NULL` | 雜湊 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 上傳時間 |
| `purge_after` | `INTEGER NOT NULL` | 最晚刪除時間（上傳後 7 天） |
| `purged_at` | `INTEGER` | R2 物件刪除時間 |

表層約束：`UNIQUE (submission_id, ord)`　選項：`STRICT`

#### `gradings`

一份提交可以有第一、第二、第三位評分者與學生自評，各一列（`UNIQUE(submission_id, role)` 保證重試不會多寫）。**模型只給分項判斷與錯誤清單（`judgments_json`），分數由程式算**（`program_score`）：作文四項加總、字數與分段扣分；中譯英每個錯誤扣 0.5、各部分扣完為止、相同錯誤只扣一次、大小寫與標點只扣一次。最後分數由程式依官方規則合成：兩位評分者平均，作文差 >5 分、中譯英差 >2 分時加第三位，取三者中最接近的兩個平均（第三閱後的定分方式是設計值，SPEC §6.8、§6.9；ARCHITECTURE §6.1）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `submission_id` | `TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE` | 提交 |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `role` | `TEXT NOT NULL CHECK (role IN ('primary','second','third','self'))` | 評分者角色 |
| `model` | `TEXT` | 實際服務的模型（自評為 NULL） |
| `prompt_version` | `TEXT NOT NULL` | 提示詞版本 |
| `rubric_version` | `TEXT NOT NULL` | 'ceec-essay-115'、'translation-4part@1' |
| `judgments_json` | `TEXT NOT NULL CHECK (json_valid(judgments_json) AND length(judgments_json) <= 65536)` | 模型的分項判斷與錯誤清單 |
| `program_score` | `REAL NOT NULL CHECK (program_score BETWEEN 0 AND 20)` | 程式依分項與官方規則算出的分數（不採用 AI 給的總分） |
| `deductions_json` | `TEXT CHECK (deductions_json IS NULL OR json_valid(deductions_json))` | 程式判定的扣分（字數、分段、大小寫標點） |
| `feedback_json` | `TEXT CHECK (feedback_json IS NULL OR (json_valid(feedback_json) AND length(feedback_json) <= 61440))` | 回饋（三個優先改進、改寫、建議句型） |
| `call_id` | `INTEGER` | ai_calls.id |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |

表層約束：`UNIQUE (submission_id, role)`　選項：`STRICT`

### 3.7 AI 帳本、預算、快取、安全事件、家教對話

#### `ai_ops`

「學生看得到的一次操作」＝一列（一次中譯英批改、一篇作文批改），扣固定點數；同時預扣這次操作**最壞情況的美元**（輸入估計＋`max_tokens` 全額輸出，含可能的第三位評分者）。這張表同時就是每人每日／每月的用量計數器。

**預扣（一句 SQL，原子操作）**：D1 的寫入是序列化的，單一敘述就是原子操作。條件不成立就插入 0 列，`meta.changes === 1` 才算成功：

```sql
-- :id :uid :task :ref :pts :usd(微美元) :day 'YYYY-MM-DD' :month 'YYYY-MM' :now
-- :cap_day :cap_month 每人點數上限；:family_cap :family_tasks 任務家族每日篇數上限（例如作文 3 篇）
-- :cap_conc 每人同時任務數；:site_day :site_month 全站美元上限（微美元）
INSERT INTO ai_ops (id, user_id, task, ref_id, status, points_reserved, usd_reserved_micros, tw_day, tw_month, created_at)
SELECT :id, :uid, :task, :ref, 'reserved', :pts, :usd, :day, :month, :now
WHERE (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
        WHERE user_id = :uid AND tw_day = :day AND status <> 'refunded') + :pts <= :cap_day
  AND (SELECT COALESCE(SUM(COALESCE(points_charged, points_reserved)), 0) FROM ai_ops
        WHERE user_id = :uid AND tw_month = :month AND status <> 'refunded') + :pts <= :cap_month
  AND (:family_cap = 0 OR (SELECT COUNT(*) FROM ai_ops WHERE user_id = :uid AND tw_day = :day
        AND task IN (SELECT value FROM json_each(:family_tasks)) AND status <> 'refunded') < :family_cap)
  AND (SELECT COUNT(*) FROM ai_ops WHERE user_id = :uid AND status = 'reserved') < :cap_conc
  AND COALESCE((SELECT paused FROM ai_budget_daily WHERE tw_day = :day), 0) = 0
  -- 全站今日：已結算 ＋ 所有進行中的預扣 ＋ 這次 ≤ 上限
  AND COALESCE((SELECT online_usd_micros FROM ai_budget_daily WHERE tw_day = :day), 0)
      + (SELECT COALESCE(SUM(usd_reserved_micros), 0) FROM ai_ops WHERE status = 'reserved') + :usd <= :site_day
  -- 全站本月：同上
  AND (SELECT COALESCE(SUM(online_usd_micros), 0) FROM ai_budget_daily
        WHERE tw_day BETWEEN :month || '-01' AND :month || '-31')
      + (SELECT COALESCE(SUM(usd_reserved_micros), 0) FROM ai_ops WHERE status = 'reserved') + :usd <= :site_month;
```

- 失敗時再跑一次唯讀查詢判斷是哪個條件擋下，回固定錯誤碼（`quota_day`、`quota_month`、`daily_limit`、`busy`、`ai_paused`、`site_budget`）。
- **結算與退還**放在同一個 `db.batch()`（D1 的 batch 是交易）：先 `UPDATE ai_ops SET status='settled'（或 'refunded'）, points_charged=…, usd_actual_micros=…, settle_token=:tok WHERE id=:id AND status='reserved'`，再 `INSERT INTO ai_budget_daily … SELECT … FROM ai_ops WHERE id=:id AND settle_token=:tok ON CONFLICT DO UPDATE SET online_usd_micros = online_usd_micros + excluded.online_usd_micros`。`settle_token` 是每次結算產生的隨機值：Queue 重送同一則訊息時，第一句更新 0 列、第二句也找不到這個 token，預算不會重複累加（已實測）。
- **退還時美元照記**：拒答（`stop_reason='refusal'`）在 `bio`、`frontier_llm`、`reasoning_extraction` 類別即使輸出前拒答也會收費（06 文件 §1.6 #8a），所以 `refunded` 的列 `points_charged=0` 但 `usd_actual_micros` 是實際成本，照樣累加進全站預算。
- 回收：Cron 每 5 分鐘把 30 分鐘前還是 `reserved`、對應工作不在進行中的操作退還。
- `user_id` 在帳號刪除時設為 NULL；13 個月以上的列由 Cron 設為 NULL（額度只需要當月資料）。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `user_id` | `INTEGER REFERENCES users(id) ON DELETE SET NULL` | 使用者（帳號刪除或 13 個月後設為 NULL） |
| `task` | `TEXT NOT NULL` | 任務代號（程式白名單） |
| `ref_id` | `TEXT` | submission id／attempt id；不放內容 |
| `status` | `TEXT NOT NULL CHECK (status IN ('reserved','settled','refunded'))` | 預扣／結算／退還 |
| `points_reserved` | `INTEGER NOT NULL CHECK (points_reserved >= 0)` | 預扣點數 |
| `points_charged` | `INTEGER CHECK (points_charged IS NULL OR points_charged >= 0)` | 實扣點數（退還為 0） |
| `usd_reserved_micros` | `INTEGER NOT NULL CHECK (usd_reserved_micros >= 0)` | 預扣美元：輸入估計＋max_tokens 全額輸出（最壞情況） |
| `usd_actual_micros` | `INTEGER NOT NULL DEFAULT 0 CHECK (usd_actual_micros >= 0)` | 依 usage 實算（拒答的成本照記） |
| `settle_token` | `TEXT` | 結算或退還時寫入的隨機值；預算累加只認這個值，重送不會重複累加 |
| `refund_reason` | `TEXT` | 退還原因代碼 |
| `tw_day` | `TEXT NOT NULL` | 台灣日期 |
| `tw_month` | `TEXT NOT NULL` | 台灣月份 'YYYY-MM' |
| `created_at` | `INTEGER NOT NULL` | 預扣時間 |
| `settled_at` | `INTEGER` | 結算或退還時間 |

選項：`STRICT`

#### `ai_calls`

每一次 Anthropic API 呼叫一列（線上與批次都記）。**不存提示詞和回應內容**（05 文件 §3.5 第 11 點），使用者只以 HMAC 假名 `user_ref` 出現。

- 成本用整數微美元（`cost_micros`），避免浮點誤差累積；`pricing_version` 記當時用哪一版價格表，價格調整後舊帳不會被重算錯。
- 開了 server-side fallback 時，`usage.iterations` 的每一次嘗試各用自己模型的單價計費，`iterations` 記嘗試數、`served_model` 記實際服務的模型、`refusal_category` 記拒答類別。
- 價格表查不到接手模型時（fallback 由伺服器決定，事先不知道是哪一個）：呼叫已經完成，不能拒絕，先記 `price_pending=1`、`cost_micros=0` 並告警；補上價格後由 trigger 允許「只補一次」。
- trigger 禁止改 token 數與成本，24 個月內禁止刪除。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `op_id` | `TEXT REFERENCES ai_ops(id) ON DELETE SET NULL` | 線上操作 |
| `gen_run_id` | `TEXT REFERENCES gen_runs(id)` | 批次工作 |
| `channel` | `TEXT NOT NULL CHECK (channel IN ('online','batch'))` | 通道 |
| `workspace` | `TEXT NOT NULL CHECK (workspace IN ('online','pipeline','dev'))` | Anthropic workspace |
| `task` | `TEXT NOT NULL` | 任務代號 |
| `role` | `TEXT` | 'primary'、'second'、'third'、'ocr'、'judge'、'blind_a'… |
| `model` | `TEXT NOT NULL` | 請求的模型 ID |
| `served_model` | `TEXT` | 實際服務的模型（server-side fallback 時不同） |
| `effort` | `TEXT` | effort |
| `prompt_version` | `TEXT NOT NULL` | 提示詞版本（sha 前 12 碼） |
| `pricing_version` | `TEXT NOT NULL` | 價格表版本：價格調整後舊帳不變 |
| `request_id` | `TEXT` | Anthropic request-id |
| `stop_reason` | `TEXT` | end_turn、max_tokens、refusal… |
| `refusal_category` | `TEXT` | 拒答類別（bio、reasoning_extraction…） |
| `iterations` | `INTEGER NOT NULL DEFAULT 1` | usage.iterations 的嘗試數（fallback 時 >1） |
| `input_tokens` | `INTEGER NOT NULL DEFAULT 0` | 輸入（各次嘗試加總） |
| `output_tokens` | `INTEGER NOT NULL DEFAULT 0` | 輸出（含思考） |
| `cache_read_tokens` | `INTEGER NOT NULL DEFAULT 0` | 快取讀取 |
| `cache_write_5m_tokens` | `INTEGER NOT NULL DEFAULT 0` | 5 分鐘快取寫入 |
| `cache_write_1h_tokens` | `INTEGER NOT NULL DEFAULT 0` | 1 小時快取寫入 |
| `images` | `INTEGER NOT NULL DEFAULT 0` | 圖片張數 |
| `cost_micros` | `INTEGER NOT NULL CHECK (cost_micros >= 0)` | 成本（微美元，逐次嘗試依各自模型單價加總） |
| `price_pending` | `INTEGER NOT NULL DEFAULT 0 CHECK (price_pending IN (0,1))` | 價格表查不到接手模型：先記「待補價」並告警 |
| `latency_ms` | `INTEGER` | 延遲 |
| `error_code` | `TEXT` | 錯誤代碼 |
| `user_ref` | `TEXT` | HMAC(users.id, LEDGER_SALT)：帳號刪除後無法回推 |
| `tw_day` | `TEXT NOT NULL` | 台灣日期 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |

選項：`STRICT`

#### `ai_budget_daily`、`ai_reconciliations`

`ai_budget_daily` 是全站預算的計數器，一天一列，結算時累加，預扣時直接讀，不必掃 `ai_calls`；`paused` 是管理員的緊急暫停開關。`ai_reconciliations` 是每日對帳結果：GitHub Actions 用 Admin API key 呼叫 Usage & Cost API，和 `ai_calls` 依 workspace 加總比對，差 >5% 標 `alert` 並告警（從 AI 上線第一天就做，ARCHITECTURE §6.9）。`dev` workspace（校準與評測）不對帳，但它的花費同樣算進組織的用量級距月上限，所以它的 spend limit 要列進 ARCHITECTURE §6.3 的啟動檢查。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `tw_day` | `TEXT PRIMARY KEY` | 台灣日期 |
| `online_usd_micros` | `INTEGER NOT NULL DEFAULT 0 CHECK (online_usd_micros >= 0)` | 線上已結算美元（微美元） |
| `batch_usd_micros` | `INTEGER NOT NULL DEFAULT 0 CHECK (batch_usd_micros >= 0)` | 批次美元 |
| `calls` | `INTEGER NOT NULL DEFAULT 0` | 呼叫次數 |
| `paused` | `INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1))` | 管理員緊急暫停 |
| `updated_at` | `INTEGER NOT NULL` | 更新時間 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `day` | `TEXT NOT NULL` | 日期（UTC，與 Anthropic 報表一致） |
| `workspace` | `TEXT NOT NULL CHECK (workspace IN ('online','pipeline'))` | workspace |
| `ledger_micros` | `INTEGER NOT NULL` | 本站帳本 |
| `provider_micros` | `INTEGER NOT NULL` | Anthropic 報表 |
| `diff_ratio` | `REAL NOT NULL` | 差異比例 |
| `status` | `TEXT NOT NULL CHECK (status IN ('ok','warn','alert'))` | 結果 |
| `checked_at` | `INTEGER NOT NULL` | 檢查時間 |

表層約束：`PRIMARY KEY (day, workspace)`　選項：`STRICT, WITHOUT ROWID`

#### `ai_shared_cache`

全站共用的 AI 結果快取，鍵和學生身分無關：

| kind | 鍵的組成 | 用途 |
|---|---|---|
| `explain_template` | 小題版本＋固定問題範本＋選項＋提示詞版本＋模型 | 固定問題型追問（「為什麼不是 (B)？」「再給我兩個例句」），第一個人付費、之後的人免費（Phase 5） |
| `short_answer_judge` | 小題版本＋正規化後的作答＋提示詞版本 | 混合題簡答、填充的 AI 判定：同一題同一答案直接沿用 |
| `translation_grade` | 題組版本＋正規化後的兩句譯文＋評分規準版本＋提示詞版本 | 中譯英相同答案直接沿用批改結果 |

不含任何帳號資訊；預設 180 天過期；學生回報結果不佳可停用（`flagged`／`disabled`）。

個資注意：`translation_grade` 與 `short_answer_judge` 的結果是針對「某一題的某個正規化答案」，`result_json` 會引用學生寫的句子或片語。快取鍵與學生身分無關、也不連回提交，所以學生刪除提交或帳號時**不會**連帶刪除這筆快取（它已無法對應到任何人），到期才刪。這點要寫進隱私權說明（ARCHITECTURE §8.3）；作文（自由寫作、可能含個人經驗）**永遠不進共用快取**。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `cache_key` | `TEXT PRIMARY KEY` | sha256(kind\|item 或 group id\|正規化輸入\|prompt_version\|rubric_version\|model) |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('explain_template','short_answer_judge','translation_grade'))` | 種類 |
| `ref_id` | `TEXT NOT NULL` | 小題或題組版本 id |
| `prompt_version` | `TEXT NOT NULL` | 提示詞版本 |
| `model` | `TEXT NOT NULL` | 產生結果的模型 |
| `result_json` | `TEXT NOT NULL CHECK (json_valid(result_json) AND length(result_json) <= 32768)` | 結果 |
| `status` | `TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','flagged','disabled'))` | 被回報不佳可停用 |
| `hits` | `INTEGER NOT NULL DEFAULT 0` | 命中次數 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `last_hit_at` | `INTEGER` | 最近命中 |
| `expires_at` | `INTEGER NOT NULL` | 到期（預設 180 天） |

選項：`STRICT`

#### `ai_safety_events`

Anthropic 未成年人指引要求的監控與回報（04 文件 §7.5）：AI 輸出被過濾器擋下、學生回報有害輸出、作文內容涉及身心安全、疑似提示注入、拒答。只存類別與假名，不存內容；後台「安全事件」頁處理。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `op_id` | `TEXT` | ai_ops.id |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('output_filtered','student_report','wellbeing_flag','injection_flag','refusal'))` | 事件種類 |
| `category` | `TEXT` | 過濾規則或拒答類別 |
| `user_ref` | `TEXT` | HMAC 假名 |
| `status` | `TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed'))` | 處理狀態 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |
| `reviewed_by` | `INTEGER` | 處理者 users.id（不設外鍵） |
| `reviewed_at` | `INTEGER` | 處理時間 |

選項：`STRICT`

#### `chat_threads`、`chat_messages`（Phase 5）

家教追問。Opus 5.5 的思考區塊要原樣送回，對話只能往後加（06 文件 §1.6 #10），所以伺服器要存 assistant 回傳的完整 content 陣列（含思考簽章），不交給前端保管（防止竄改歷史）。**一則訊息一列**：每輪只新增一列，不必整串重寫；trigger 不需要，程式只做 INSERT。一串對話固定一個模型、上限 8 輪、7 天後刪除。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | 使用者 |
| `item_id` | `TEXT NOT NULL REFERENCES items(id)` | 針對哪一題 |
| `model` | `TEXT NOT NULL` | 一串對話固定一個模型 |
| `mode` | `TEXT NOT NULL DEFAULT 'hint' CHECK (mode IN ('hint','explain'))` | 預設提示模式（引導、不直接給答案） |
| `turns` | `INTEGER NOT NULL DEFAULT 0 CHECK (turns BETWEEN 0 AND 8)` | 輪數（上限 8） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 建立時間 |
| `expires_at` | `INTEGER NOT NULL` | 建立後 7 天 |

選項：`STRICT`

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `thread_id` | `TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE` | 對話 |
| `seq` | `INTEGER NOT NULL CHECK (seq >= 1)` | 序號 |
| `role` | `TEXT NOT NULL CHECK (role IN ('user','assistant','system'))` | 角色（system＝中途切換模式） |
| `content_json` | `TEXT NOT NULL CHECK (json_valid(content_json) AND length(content_json) <= 65536)` | assistant 回傳的完整 content 陣列（含思考簽章），原樣存、原樣送回 |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |

表層約束：`PRIMARY KEY (thread_id, seq)`　選項：`STRICT, WITHOUT ROWID`

### 3.8 稽核、維運、刪除證明

#### `admin_audit`

後台每個動作一列：核准、停權、額度、邀請碼、上架、下架、隔離、答案更正、重算、預算、**查看學生分享的作文**（`submission.view`）。不存學生內容。trigger 禁止修改、兩年內禁止刪除。`actor_id` 刻意不設外鍵：管理員帳號刪除時，`SET NULL` 會被禁止 UPDATE 的 trigger 擋下。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 流水號 |
| `actor_id` | `INTEGER` | users.id；刻意不設外鍵（帳號刪除時 SET NULL 會被 trigger 擋下） |
| `actor_kind` | `TEXT NOT NULL CHECK (actor_kind IN ('admin','system','pipeline','user'))` | 執行者種類 |
| `action` | `TEXT NOT NULL` | 'user.approve'、'content.publish'、'submission.view'…（程式白名單） |
| `target_kind` | `TEXT` | 對象種類 |
| `target_id` | `TEXT` | 對象 id |
| `reason` | `TEXT CHECK (reason IS NULL OR length(reason) <= 500)` | 理由 |
| `detail_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 4096)` | 細節（不放學生內容） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |

選項：`STRICT`

#### `ops_events`

告警與維運事件（門檻見 ARCHITECTURE §9.3）：今日 AI 花費達日預算 80%、全站暫停、Queue 積壓、對帳差異、Cron 失敗、D1 容量、安全事件。後台首頁顯示未確認的事件。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY` | 流水號 |
| `kind` | `TEXT NOT NULL` | 'budget_80'、'budget_paused'、'queue_backlog'、'reconcile_alert'、'cron_failed'、'db_size'… |
| `severity` | `TEXT NOT NULL CHECK (severity IN ('info','warn','error'))` | 嚴重度 |
| `detail_json` | `TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 4096)` | 細節（不放學生內容） |
| `created_at` | `INTEGER NOT NULL DEFAULT (unixepoch())` | 時間 |
| `acked_at` | `INTEGER` | 確認時間 |
| `acked_by` | `INTEGER` | 確認者 users.id |

選項：`STRICT`

#### `deletion_log`

刪除證明：不含個資，只證明「何時、因為什麼、刪了多少列與多少 R2 物件」。回覆個資刪除請求時用。

| 欄位 | 型別與約束 | 說明 |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | UUID |
| `user_ref` | `TEXT NOT NULL` | HMAC 假名 |
| `kind` | `TEXT NOT NULL CHECK (kind IN ('account','submission','retention_expiry','idle_account'))` | 刪除原因 |
| `requested_at` | `INTEGER NOT NULL` | 申請或到期時間 |
| `completed_at` | `INTEGER` | 完成時間 |
| `rows_json` | `TEXT CHECK (rows_json IS NULL OR json_valid(rows_json))` | 各表刪除列數 {"attempts":1234,…} |
| `r2_objects` | `INTEGER NOT NULL DEFAULT 0` | 刪除的 R2 物件數 |

選項：`STRICT`

## 4. trigger 與檢視表

### 4.1 trigger（19 個）

| trigger | 作用 |
|---|---|
| `trg_groups_no_delete` | 題組禁止刪除 |
| `trg_groups_immutable` | 上架過（published、quarantined、retired、withdrawn）的題組，內容欄位禁止修改；唯一例外是改成 `withdrawn`（墓碑化，且 uid、版本、三個雜湊不變） |
| `trg_groups_status_flow` | 狀態只能照 §3.3 的路線前進 |
| `trg_items_no_delete` | 小題禁止刪除 |
| `trg_items_immutable_keys` | 題組上架後，小題的識別、答案、配分、統計、標註、`answer_hash` 禁止修改 |
| `trg_items_immutable_text` | 題組上架後，小題的文字欄位禁止修改；題組已墓碑化時只允許清空 |
| `trg_annotations_no_delete` | 註解禁止刪除 |
| `trg_annotations_immutable` | 已上架的註解內容禁止修改（墓碑化例外） |
| `trg_annotations_status_flow` | 註解狀態路線：`needs_review → published／rejected`、`published → retired／withdrawn`、`retired → withdrawn` |
| `trg_reviews_no_update`、`trg_reviews_no_delete` | 審核紀錄只增不減 |
| `trg_consents_no_update`、`trg_consents_no_delete` | 同意紀錄只增不改；只能隨帳號刪除（父列不存在或狀態為 `deleting`） |
| `trg_srs_reviews_no_update` | 複習紀錄不可修改（可隨帳號或保存期限刪除） |
| `trg_calls_immutable` | 帳本的模型、token 數、價格版本不可改 |
| `trg_calls_cost` | 成本只有「待補價」的列可以補一次 |
| `trg_calls_retention` | 帳本 24 個月內不可刪 |
| `trg_audit_no_update`、`trg_audit_no_early_delete` | 稽核禁止修改、兩年內禁止刪除 |

衍生欄位（難度、文章指標、詞彙對照、統計）不在 trigger 的欄位清單裡，可以照常更新。

### 4.2 學生檢視表（4 個）

公開與學生端 API 的資料存取模組（`apps/api/src/db/student.ts`）**只能查這四個檢視表**；後台與 AI 批改模組才能直接查基底表。CI 用靜態檢查擋下學生端模組引用基底表名稱（ARCHITECTURE §7）。

| 檢視表 | 拿掉的欄位 | 篩選 |
|---|---|---|
| `v_groups_student` | `generation_json`、審核欄位、文章指標原始輸出 | 只有 `status='published' AND pool='practice'` |
| `v_items_student` | `restricted_json`（評分原則、官方中譯英參考譯文） | 所屬題組 `pool='practice'` 且狀態是 `published`／`quarantined`／`retired`／`withdrawn`：學生回看自己做過、之後被隔離或下架的題目也走這裡；**檢核卷題組與還沒上架的題組（draft、verifying、needs_review、rejected）一律排除**，否則以 group_id 查小題的公開端點會送出未審題目與檢核卷答案 |
| `v_vocab_entries_student` | `internal_json`（Collins、Oxford） | —（含 `pages_json`、`extra_json`） |
| `v_annotations_student` | 審核欄位 | 只有已上架的版本，而且所屬題組是練習池裡上架過的題組（排除檢核卷與未上架題組的解析） |

## 5. 匯入對應

匯入一律由 GitHub Actions 產生純 SQL 檔，再用 `wrangler d1 execute --remote --file` 分段執行（不另外寫「管理匯入 API」，少一個可以寫入內容庫的攻擊面）。匯入是冪等的：內容 `INSERT … ON CONFLICT DO NOTHING`，單字與衍生表 `DO UPDATE`，中斷後重跑即可。匯入前記 Time Travel 書籤（`wrangler d1 time-travel info`），出事可以還原到匯入前（D1 Time Travel 的指令、保留天數與還原方式都不在研究文件裡，未驗證，Phase 1 實測）。

### 5.1 歷屆試題：`gsat-exam/v1.1` → 資料表

**規則：必填欄位成欄；選填與未知欄位原樣進所在層級的 `extra_json`；受保護欄位進 `items.restricted_json`；JSON 的 `null` 存 SQL NULL（例外見下表）。** 匯入程式遇到未知欄位不丟棄，記一筆警告。

| JSON 位置 | 資料表.欄位 | 備註 |
|---|---|---|
| `schema` | `papers.schema_id` | 目前全部是 `gsat-exam/v1.1` |
| `id`、`exam`、`year`、`session`、`title`、`time_minutes`、`full_score` | `papers` 同名欄位 | `kind`：gsat／ast → `official`，reference → `reference`；`era`：gsat 111 起 `gsat-current`、110 以前 `gsat-legacy`、ast、reference |
| `sources`、`extraction` | `papers.sources_json`、`extraction_json` | 原樣；`verified` 是生成欄位（`extraction.verified_by` 不為 NULL） |
| `parts`（選填）及其他頂層欄位 | `papers.extra_json` | 目前 35 份有 `parts` |
| `sections[i]` 的 `id`、`type`、`title`、`part`、`instructions`、`points_total` | `paper_sections`（`ord = i+1`、`section_key = id`） | |
| `sections[i].stats`（選填）及其他欄位 | `paper_sections.extra_json` | 非選擇題分數分布（60 個大題有） |
| `groups[j]` | `item_groups`（`uid = '{paper}.{group id}'`、`version = 1`、`source_key = group id`）＋ `paper_groups(paper, i+1, j+1)` | `status='published'`、`approval_mode='official'`、`license='CEEC-exam'`、`derivation='verbatim'` |
| `groups[j].passage`、`passage_parts`、`figures`、`options_bank`、`tags` | 同名欄位（JSON 的存 `*_json`） | `figures` 一定是陣列；`tags` 可為 null（124 個題組） |
| `groups[j].group_label`（選填）及其他欄位 | `item_groups.extra_json` | `group_label` 另有生成欄位 |
| `questions[k]` 的 `no`、`label`、`mode`、`stem`、`options`、`points`、`stats`、`tags` | `items`（`ord = k+1`、`id = '{題組 id}#{label}'`） | |
| `questions[k].answer`、`accepted_answers`（非中譯英） | `items.answer_json`、`accepted_json` | `answer` 的 JSON null 存成字串 `'null'`（作文、部分舊簡答），和中譯英的 SQL NULL 區分 |
| `questions[k].scoring_notes`（所有模式） | `items.restricted_json.scoring_notes` | 受保護；null 不寫入 |
| 中譯英的 `answer`、`accepted_answers`、`answer_segments`、`answer_variants`、`answer_is_composite` | `items.restricted_json` | 受保護；`answer_json`、`accepted_json` 為 NULL（CHECK 強制） |
| `refers_to`、`scoring_exception`、`reused_from`、`answer_table`（選填）及其他欄位 | `items.extra_json` | |

**沿用歷屆題（`reused_from`）**：參考試卷有 214 小題沿用歷屆試題（`ref-115` 的 53 題裡有 49 題，其中 30 題來自 `gsat-111`；2026-10-08 匯入草稿計算）。它們以參考試卷自己的 uid 匯入（匯出才能無損），但：(1) 判斷 `first_exposure` 時，原題所屬題組也查 `user_group_seen`（原題由 `reused_from.exam`＋同類大題＋`no` 找到）；(2) 不另外校正難度，`item_params` 沿用原題；(3) 模擬考成績單標示「本卷 N 題你在 {原卷} 做過」（SPEC §6.11）。

**由程式算出的欄位**：`format_version`（題型＋小題數＋選項數）、三個雜湊（雜湊對象是 `sort_keys` 後的緊湊 JSON）、`pick_order`（亂數）、`answer_hash`（非中譯英：`{answer, accepted_answers, scoring_exception}`；中譯英：常數，因為官方譯文不參與自動計分）、`items.answer_entry_id`／`answer_level`（詞彙類題目的正解條目，由 `vocab_forms` 還原）、文章指標與 `glossary_json`（`tools/text_metrics.py`）、`item_params` 與 `tier`（`tools/irt_anchor.py`，SPEC §3）。

**匯出（反向）**：依上表組回物件；中譯英的 `answer`、`accepted_answers` 從 `restricted_json` 取（缺鍵表示 null），選填受保護欄位只在存在時輸出；`extra_json` 的鍵原樣合併回所在層級。比對方式是兩邊都 `json.dumps(sort_keys=True)` 後逐字比較（這樣也會分辨整數 100 和小數 100.0）。

### 5.2 歷屆題修正時（只增不減）

解析檔仍在持續查證與正規化（`data/exams/normalize-todo.json` 還有需要看原卷判斷的項目）。`content-import.yml` 的「規劃」步驟先查 D1 現有的 `(uid, version, content_hash)`：

- `content_hash` 相同 → 跳過。
- 不同 → 插入 `version + 1`（`supersedes_id` 指向舊版）、舊版改 `retired`（`status_reason='source corrected'`）、`paper_groups` 改指新版本。
- 新舊版 `face_hash` 相同（只改了標註）：`item_params` 沿用，統計合併。
- 某小題的 `answer_hash` 改變（官方答案更正或轉錄錯誤）：建立 `answer_corrections(status='dry_run')`，後台試算後由管理員確認重算（SPEC §4.7）。
- 題組 id 改變（解析器重新編號）屬於 CI 錯誤：歷屆題的 `{paper}.{group id}` 一旦匯入就不能變。

### 5.3 AI 題組：`gsat-bank/v1` → 資料表

一個檔案一個題組版本：`data/bank/v1/{section_type}/{tier}/{uid}@{version}.json`。`group` 欄位就是 `gsat-exam/v1.1` 的 group（含 questions），所以讀取、計分、畫面元件和歷屆題完全共用。

```jsonc
{
  "schema": "gsat-bank/v1",
  "uid": "ai.wb.7f3a9c",                     // 改版不換 uid
  "version": 1,
  "section_type": "word_bank",
  "format_version": "word_bank-10x10",
  "tier": "advanced",
  "pool": "practice",                        // checkpoint＝檢核卷專用
  "group": { /* gsat-exam/v1.1 的 group：題號從 1 開始，空格 [[1]]…[[10]]；圖表題的 figure 多一個 chart 物件 */ },
  "annotations": {                           // 各自成為 annotations 的一列（status=needs_review）
    "explanations": { "items": { "1": { "explanation_zh": "…", "evidence": ["逐字證據句"], "blank_pos": "noun",
                       "clue_type": "collocation", "option_notes_zh": { "B": "…" }, "strategy_zh": "…",
                       "hints": ["這一格需要名詞", "看前一句的 …", "刪去 B、F"] } } },
    "translation_zh": { "text": "…" },
    "elimination": { "feasible": { "1": ["D","E"], "…": [] }, "perfect_matchings": 1 },
    "guess_targets": [], "open_tasks": [], "rubric": null, "model_texts": null
  },
  "curriculum": [ { "code": "3-V-12", "weight": "primary", "basis": "generator" } ],
  "provenance": { "sources": [ { "source_id": "fact:sdg14-0007", "role": "fact" } ], "license": "original-ai",
                  "derivation": "ai-original-from-facts", "share_alike": false, "commercial_ok": true,
                  "attribution_text": "本文由 AI 參考下列資料撰寫，非原文轉載" },
  "generation": { "channel": "agent", "run_id": "agent-2026-10-20-wb-adv-01", "model": "claude-opus-5-5",
                  "prompt_id": "gen/word_bank", "prompt_sha256": "…", "spec_id": "word_bank-advanced@2026-10" },
  "metrics": null,                           // 由 tools/text_metrics.py 填，不由 AI 填
  "verification": [ /* program、blind_solver ×2、distractor_audit、unique_solution… 各自成為 item_reviews 的一列 */ ],
  "status": "verified"                       // verified → 匯入成 needs_review；rejected 的檔案也保留（記錄淘汰原因）
}
```

| 檔案欄位 | 資料表 |
|---|---|
| `uid`、`version`、`section_type`、`format_version`、`pool`、`group.*` | `item_groups`（`origin` 依 `generation.channel`：agent／batch／human）、`items` |
| `tier` | `item_groups.tier`（`tier_basis='spec'`）；`item_params`（`basis='spec'`，先驗依難度帶中心） |
| `annotations.*` | `annotations`（每個 kind 一列，`version` 1，依答案的 kind 帶 `answer_hash`） |
| `curriculum` | `item_curriculum` |
| `provenance` | `item_groups` 的授權欄位＋`group_sources` |
| `generation` | `item_groups.gen_run_id`、`generation_json`＋`gen_runs` |
| `verification[]` | `item_reviews` |

檔案一旦 merge 就不能刪改：CI 的 `tools/only_add_guard.py` 檢查 `git diff --diff-filter=DMR` 在 `data/bank/**` 底下為空（新增 `@2` 檔案才是改版），唯一例外是 `data/takedowns.jsonl` 有登記的路徑。歷屆題的註解放在 `data/bank/annotations/ceec/{paper}/{group}.json`，格式就是上面的 `annotations` 物件加上 `group_uid` 與 `answer_hash`。

### 5.4 單字：`data/vocab` → 資料表

| 來源 | 資料表 | 說明 |
|---|---|---|
| `ceec-wordlist.json`（6,012 筆） | `vocab_entries` | `word`、`level`、`pos`、`variants`、`raw`、`tags` 與 `lexicon.json` 逐筆相同；`entry_id` 照 `{word}\|{pos 以 / 相接}\|{level}` 算出；**`pages → pages_json`**（lexicon.json 沒有頁碼）。只匯入這個檔也能建出完整條目（其他欄位留預設或 NULL；`cambridge_slug` 依 03 文件 §9.4 的 slug 規則算），匯入→匯出 6,012／6,012 相同（§10） |
| `lexicon.json`（6,012 筆） | `vocab_entries` | `entry_id → id`；`word`；`word_norm`（小寫、去重音、彎引號轉 `'`）；`level`；`pos → pos_json`（原順序）、`pos_primary`；`raw`；`variants`、`tags`、`forms`；`ipa`；`zh → zh_json`；`en_def`；`cefr.level → cefr`；`freq.frq／bnc`；`family_id`；`wordnet → wordnet_json`；**`internal_core_flag`、`internal_star` → `internal_json`**；`cambridge_url` 的最後一段 → `cambridge_slug`；檔案 sha256 前 12 碼 → `data_version`；**其餘沒有成欄的欄位**（`ipa_source`、`en_def_source`、`cefr` 整個物件、`sources`、`variant_info`）→ `extra_json` |
| `lexicon.json` 的 `examples[]` | `vocab_examples`（`id='{entry_id}#tatoeba:{tatoeba_id}'`、`source_ref=tatoeba_id`、`license`、`author`、`url`、`within_level`；`zh_id → zh_source_ref`、`zh_author`、`zh_license`、`zh_converted`） | 只收 Tatoeba 例句（17,646 列，其中 96 列 CC0-1.0）；英文與中文作者逐句標示。id 必須含 `entry_id`：12,291 句 Tatoeba 裡有 3,577 句同時掛在 2–10 個條目，只用句號當 id 會在 `ON CONFLICT DO NOTHING` 時默默丟掉 5,355 列 |
| `lexicon.json` 的 `wordnet.senses[]`（id `'{entry_id}#oewn:{synset_id}'`）與各義項的 `synonyms[]`（`in_list=true` 者連 `target_entry_id`） | `vocab_senses`（`source='oewn'`）、`vocab_relations`（`rel='synonym'`、`sense_id`） | 表外同義詞只放 `target_text` |
| `lexicon.json` 的 `wordnet.antonyms[]`、`hypernyms[]`、`derivations[]` | `vocab_relations`（`rel='antonym'`／`'hypernym'`／`'derivation'`，`source='oewn'`） | 2026-10-08 審查補上：原對照只列同義詞，反義（1,555 個）、上位詞（12,020 個）、衍生（2,072 個）只留在 `wordnet_json`，詞頁的「反義」查不到（SPEC §6.1 第 5 項） |
| `lexicon.json` 的 `wordnet.senses[].examples[]` | `vocab_examples`（`source_kind='oewn'`、`license='CC-BY-4.0'`、id `'{entry_id}#oewn:{synset_id}:{序號}'`） | OEWN 例句；畫面標示 OEWN 出處 |
| `lexicon.json` 的 `family`、`variant_info` | `vocab_relations`（`rel='family'`／`'derivation'`） | |
| `forms-index.json`（16,953 個詞形、17,073 組對應） | `vocab_forms` | `types → types_json`；`base → base_json`；`extra_pos`；同形多筆的順序 → `rank` |
| `data/exams/stats/word-frequency.json` | `vocab_exam_stats`、`vocab_exam_occurrences` | 重要度公式 `imp@1`（SPEC §6.1） |
| `data/curriculum/grammar-patterns.json` | `grammar_patterns`（patterns、connectives）、`phrases`（`source='grammar_patterns'`） | |
| `data/vocab/enrich/*.jsonl`（代理增補） | `vocab_senses`／`vocab_relations`／`vocab_examples`／`phrases`（`source='agent'`），`vocab_entries.enrich_version` | 依考題用法排序的義項、近義辨析、搭配詞、片語、AI 例句 |

單字表是「可重建的參考資料」，用 `INSERT … ON CONFLICT(id) DO UPDATE`；**但 id 必須穩定、不能刪除**，因為 `srs_cards`、`items.answer_entry_id` 指向它們。守門條件：條目、義項、片語的筆數只能增加；確實要刪的（例如 AI 義項被判錯）改成 `review_status='flagged'`，畫面不顯示。

### 5.5 課綱

`data/curriculum/english-108.json` 的 `learning_performances`（95）、`learning_contents`（52）、`core_competencies`（9）→ `curriculum_codes`；`code_ascii → code`、`code → code_display`、`advanced`、`recurring`；`ceec_gsat_english_alignment.question_type_mapping_inferred` 決定 `assessed_in_gsat` 與歷屆題的 `item_curriculum`（`basis='inferred'`，〈試題特色〉引用過的標 `ceec_feature`）。

### 5.6 匯入工具與 CI

| 工具（新增） | 作用 |
|---|---|
| `tools/build_d1_seed.py` | 讀 JSON → 產生 SQL 檔（每檔 ≤5 MB、單句 <90 KB；超過就把長文字拆成「先 INSERT 前段、再 `UPDATE … SET col = col \|\| ?` 補後段」） |
| `tools/export_d1.py` | 從 SQLite 檔組回 `gsat-exam/v1.1` JSON |
| `tools/text_metrics.py` | 文章指標與 `glossary_json` |
| `tools/irt_anchor.py` | 由官方統計算 `item_params` 與初始難度 |
| `tools/only_add_guard.py` | `data/bank/**` 只增不減（`data/takedowns.jsonl` 登記者例外） |
| `tools/d1_feature_check.sql` | 在遠端 D1 檢查 STRICT、生成欄位與其索引、trigger、部分索引、運算式唯一索引、`WITHOUT ROWID`、`json_each`、`unixepoch()`、檢視表 |

**CI 必跑（每個 PR）**：產生 SQL → 套用到空的 SQLite（`node:sqlite` 或 Python 標準庫）→ 匯出 → 和 `data/exams/parsed/*.json` 逐檔比對，必須 100% 相同；同一份種子匯入兩次，各表筆數不變；遷移檔重跑兩次不出錯；本文件與遷移檔的一致性檢查（§10）。

## 6. D1 限制與對策

| 限制（05 文件 §3.6、06 文件 §4.2） | 影響 | 對策 |
|---|---|---|
| 單列（字串）最大 2 MB | 長選文、批改回饋、對話 | 最大的題組約 2.5 KB、最大的小題 `restricted_json` 約 79 KB；JSON 欄位加長度上限（`feedback_json` 60 KB、`judgments_json` 64 KB、`chat_messages.content_json` 64 KB、`glossary_json` 256 KB）；照片放 R2 |
| 單句 SQL 最長 100 KB | 用純 SQL 檔匯入時，一列的文字太長會失敗 | 原型實測最長一句 80,007 位元組（2026-10-08 以最新資料重跑；是評分原則很長的中譯英題，歷屆題仍在修正，長度會小幅變動），已接近上限；產生器逐句檢查，>90 KB 就拆成 INSERT＋`UPDATE … SET col = col \|\| ?` |
| 每句最多 100 個綁定參數 | 批次寫入、`IN (…)` 清單 | 執行期一律「一列一句」放進 `db.batch()`；清單查詢用 `json_each(?)` 一個參數帶整個陣列（預扣 SQL 的任務家族也是） |
| 每次 Worker 呼叫最多 1,000 次查詢（付費） | 交卷、Cron 彙整 | 一次交卷約 50 題 ×（作答＋1–2 個 skill UPSERT＋錯題卡）≈ 200 句；Cron 分頁處理，每輪最多 500 列 |
| 沒有 `BEGIN TRANSACTION` | 多句要同時成功 | 用 `db.batch()`（交易）；「條件成立才寫」用單句 `INSERT … SELECT … WHERE` 或條件式 `UPDATE` |
| 單一資料庫最大 10 GB | 作答與複習紀錄會一直長 | §8：高頻表整數鍵、原始紀錄 13 個月後彙整再刪；後台顯示資料庫大小，>7 GB 告警 |
| 依讀取列數計費、沒有索引就整表掃描（未驗證：研究文件沒有查 D1 的計價方式與免費額度，Phase 1 查證） | 抽題、清單 | `pick_order` 索引抽題；CI 對關鍵查詢設 `rows_read` 上限（§7） |
| 單一寫入者（未驗證；SQLite 單一敘述本身是原子的，D1 上的併發行為由 Phase 1 遠端實測確認） | 熱點寫入會排隊 | 站內統計交給 Cron 增量彙整，不在每次作答時更新同一列 |
| 單次查詢有執行時間上限（未驗證：確切秒數） | 刪帳號、保存期限清理 | 一律分批：`DELETE FROM attempts WHERE id IN (SELECT id FROM attempts WHERE user_id = ? LIMIT 5000)`，每批每表 ≤5,000 列，Cron 接續；最後才刪 `users` 列 |
| 遠端匯入 | 大量種子資料 | `wrangler d1 execute --remote --file` 分檔；匯入前記 Time Travel 書籤 |
| 外鍵預設強制 | 重建表的遷移 | 需要重建表時用 `PRAGMA defer_foreign_keys = on` |

## 7. 主要查詢、索引與 rows_read 上限

D1 依「讀取的列數」計費，每支 SQL 在開發時記錄 `meta.rows_read`；CI 的整合測試（本機 D1 或 `node:sqlite`＋EXPLAIN）對關鍵查詢設上限，超過就失敗。

| 查詢 | 寫法 | 索引 | rows_read 上限（設計值） |
|---|---|---|---|
| 抽題 | `SELECT id, uid FROM v_groups_student WHERE section_type=? AND tier=? AND pick_order >= ? ORDER BY pick_order LIMIT 40`（不足再從 0 補），再用 `user_group_seen` 排除做過的 | `idx_groups_pick`（原型查詢計畫確認：`SEARCH … USING INDEX idx_groups_pick`） | 50 |
| 排除做過的 | `SELECT group_uid FROM user_group_seen WHERE user_id=? AND group_uid IN (SELECT value FROM json_each(?))` | 主鍵 | 40 |
| 讀一個題組（學生畫面） | `v_groups_student` 主鍵＋`v_items_student WHERE group_id=?` | 主鍵、`UNIQUE(group_id, ord)` | 30 |
| 讀註解 | `v_annotations_student WHERE group_uid=? AND kind=? ORDER BY version DESC LIMIT 1` | `idx_annotations_live`；檢視表的題組篩選走 `idx_groups_uid` | 8 |
| 點字查詞（整篇） | `vocab_forms WHERE form_norm IN (SELECT value FROM json_each(?))` | 主鍵 | 篇幅字數 ×1.1 |
| 單字查詢 | `vocab_forms WHERE form_norm = ?`＋條目 | 主鍵 | 5 |
| 詞頁 | 條目＋義項＋關聯＋例句＋出現明細（一個 batch 5 句） | 各表 `entry_id` 索引 | 80 |
| 今日複習佇列 | `srs_cards WHERE user_id=? AND suspended=0 AND due_at<=? ORDER BY due_at LIMIT 100` | `idx_srs_due`（部分索引） | 100 |
| 錯題重測找新題 | `items WHERE section_type=? AND skill=?` 再排除做過的題組 | `idx_items_skill` | 60 |
| 學習分析 30 天 | `user_skill_daily WHERE user_id=? AND tw_day>=?` | 主鍵前綴 | 依技能數 |
| AI 預扣 | §3.7 的 INSERT…SELECT | `idx_ops_user_day`、`idx_ops_user_month`、`idx_ops_inflight`（部分索引，只含進行中的列）、`ai_budget_daily` 主鍵 | 100 |
| 審核佇列 | `item_groups WHERE review_lot=? AND status='needs_review'` | `idx_groups_lot` | 批大小 |
| 依考點找歷屆題 | `items WHERE test_point='collocation'` | `idx_items_test_point`（生成欄位索引，原型確認有用到） | 結果數 |
| 答案更正試算 | `attempts WHERE item_id IN (同 uid 同 label 的各版本) AND answer_hash = ?` | `idx_attempts_item_hash` | 結果數 |

## 8. 容量估算與保存期限

| 資料 | 每列約（含索引） | 筆數 | 大小 |
|---|---|---|---|
| 歷屆題＋單字（原型實測，SQLite 檔） | — | 776 題組、3,783 小題、6,012 條目、17,073 詞形 | 約 22 MB |
| 單字增補、例句、關聯（估計） | — | 約 20 萬列 | 約 40 MB |
| AI 題庫（一年後） | — | 約 3,000 題組 | 約 40 MB |
| 作答（每位活躍學生每天 60 題、一學年 200 天） | 177 B（實測） | 每人 1.2 萬列 | 每人約 2.1 MB；1,000 人約 2.1 GB |
| 複習（每人每天 80 張） | 107 B（實測） | 每人 1.6 萬列 | 每人約 1.7 MB；1,000 人約 1.7 GB |
| 作文與批改 | 約 30 KB／份 | 每人每月 8 份 | 1,000 人一年約 2.9 GB（但受核准名額限制，實際約 60 人：約 0.2 GB） |

每列大小是原型實測值（20 萬列合成資料、含全部索引、VACUUM 後量測）。同樣的作答表若用 UUID 主鍵、UUID 使用者 id 與題組 id 欄位（四個索引），實測每列 459 B，1,000 位活躍學生一年是 5.5 GB；整數鍵設計是 2.1 GB。1,000 位活躍學生一年合計約 4–5 GB，在 10 GB 以內，13 個月滾動刪除讓它不再成長。**保存期限**（Cron 每日執行；ARCHITECTURE §8.3 有完整表）：

| 資料 | 期限 |
|---|---|
| 原始作答（`attempts`）、複習（`srs_reviews`） | 13 個月後刪除；`user_skill_daily`、`item_stats`、卡片狀態保留 |
| 手寫照片 | 批改完成立即刪除；最長 7 天 |
| OCR 原始轉錄（`ocr_text`、`ocr_uncertain_json`、`ocr_diff_json`） | 30 天後一起清空 |
| 作文、中譯英、批改結果 | 學生自選 30 天／1 年（預設）／直到自己刪除 |
| 家教對話 | 7 天 |
| 帳號 | 12 個月沒有登入：到期前 30 天站內通知，之後整個刪除 |
| `ai_ops.user_id` | 13 個月後設為 NULL；`ai_ops`、`ai_calls` 24 個月後刪除 |
| `admin_audit` | 2 年 |
| `ai_shared_cache` | 180 天（不連回任何帳號；作文不進快取） |
| `item_reports.message` | 已處理 180 天後清空；帳號刪除時清空 |
| `ai_safety_events` | 24 個月（只有類別與 HMAC 假名） |

如果使用者破千、資料庫接近 7 GB：先縮短原始作答保存期限，再評估「依使用者 id 雜湊分庫」。所有使用者資料查詢都以 `user_id` 開頭，分庫時程式改動很小。

## 9. D1 功能不支援時的備案

Phase 1 的驗收項是在**遠端 D1** 跑 `tools/d1_feature_check.sql`（ROADMAP Phase 1）。這些都是 SQLite 標準功能，但 D1 的支援要以實測為準（未驗證）：

| 功能 | 用在哪 | 不支援時的備案 |
|---|---|---|
| `STRICT` | 全部表 | 拿掉 `STRICT`，`ANY` 欄位改 `NUMERIC`（整數仍存回整數）；型別改由程式與 CI 檢查 |
| 生成欄位與其索引 | `items.test_point` 等、`papers.verified` | 匯入時算好存成一般欄位（匯出時忽略） |
| trigger（`BEGIN … END` 能否被 `wrangler d1 migrations` 正確切分） | 只增不減、狀態機、帳本 | 改由資料存取模組統一檢查＋CI 只增不減守門；`import_runs` 筆數守門仍有效 |
| 部分索引 | `idx_srs_due`、`idx_ops_inflight` 等 | 改成一般索引（多一點寫入成本） |
| 運算式唯一索引 | `uq_vocab_rel` | 新增 `sense_key TEXT NOT NULL DEFAULT ''` 欄位當唯一鍵 |
| `json_each` | 清單查詢、預扣 | 改成產生多句查詢（每句 ≤100 參數） |
| `unixepoch()` | 預設值、trigger | 改用 `CAST(strftime('%s','now') AS INTEGER)` |
| 檢視表 | 學生端查詢 | 學生端資料存取模組改用寫死的欄位清單，CI 檢查不含受保護欄位 |

任何一項不支援，都在 Phase 2 開始前新增 `0002` 遷移檔處理並更新本文件。

## 10. 驗證方式與原型實測結果

**文件與遷移檔的一致性**：本文件的欄位表由產生器從 `0001_init.sql` 產生；產生器同時把遷移檔套用到記憶體 SQLite，確認每張表的實際欄位（`pragma_table_xinfo`，含生成欄位）和文件表格完全一致，且每張表、每個 trigger、每個檢視表的名稱都出現在本文件。這支檢查會搬進 CI（`tools/check_schema_doc.py`），之後改遷移檔或文件任何一邊沒同步就失敗。

**原型實測**（2026-10-08，SQLite 3.45.1，Python 標準庫；拋棄式腳本，正式版見 §5.6）：

| 項目 | 結果 |
|---|---|
| 遷移檔連續套用兩次 | 成功（冪等）；56 張表、64 個索引、19 個 trigger、4 個檢視表 |
| 匯入 66 份 `gsat-exam/v1.1` | papers 66、paper_sections 437、item_groups 776、items 3,783、paper_groups 776 |
| 匯入 → 匯出 → 逐檔比對 | **66／66 完全相同** |
| 受保護欄位 | 167 個小題有 `restricted_json`（中譯英 92、作文 48、填充 14、簡答 9、其他 4）；119 個中譯英小題的 `answer_json` 全為 NULL；`v_items_student` 查不到任何官方譯文 |
| 純 SQL 檔匯入 | 5,838 句 INSERT；最長一句 80,007 位元組、第 99 百分位 7,483 位元組（2026-10-08 以最新資料重跑）；超過 90 KB 的 0 句 |
| 單字 | vocab_entries 6,012、vocab_forms 17,073（16,953 個不同詞形）；`v_vocab_entries_student` 沒有 `internal_json` |
| trigger 與 CHECK | 擋下刪題組、刪小題、改已上架內容、倒退狀態、未清空就墓碑化、墓碑化後還原；允許隔離與恢復、改難度、墓碑化；中譯英存官方譯文與單選題答案為 NULL 都被 CHECK 擋下 |
| 冪等 | 同一作答送兩次只存一列；同一複習送兩次只存一列 |
| 原子預扣 | 剩 30 點、同時任務上限 2 時連送 20 個請求只成功 2 個；全站日預算有算進進行中的預扣；暫停開關有效；作文每天 3 篇上限有效；結算重送不會重複累加預算 |
| 帳本 | token 數不能改；待補價只能補一次；24 個月內不能刪 |
| 刪帳號 | 作答、練習、卡片、複習、同意紀錄全部連鎖刪除；`ai_ops.user_id` 變 NULL；稽核保留且不能改；新帳號不會拿到舊 id |
| 查詢計畫 | 抽題走 `idx_groups_pick`；考點查詢走生成欄位索引；點字查詞走 `vocab_forms` 主鍵；技能查詢走 `idx_items_skill`；進行中預扣加總走 `idx_ops_inflight` |

**匯入草稿複驗**（2026-10-08，對抗式審查；拋棄式腳本，不進 repo）：依 §5.1、§5.4 寫一支獨立的匯入→匯出程式重做一次。

| 項目 | 結果 |
|---|---|
| 3 份代表性考卷（gsat-115 現制、gsat-83 分部分重新編號、ast-97 作文字數人工對照）＋全部 66 份 | 3／3、66／66 匯入→匯出逐字相同；`PRAGMA foreign_key_check` 0 列；中譯英 `answer_json` 全為 NULL；`v_items_student` 不含任何官方譯文 |
| `ceec-wordlist.json` → `vocab_entries` | 原 schema 沒有放頁碼的欄位，6,012 筆的 `pages` 全部遺失；新增 `pages_json` 後 6,012／6,012 相同 |
| `lexicon.json` 例句 → `vocab_examples` | 原種子授權缺 `CC0-1.0`，96 列外鍵失敗；原 id 規則 `tatoeba:{句號}` 會讓 5,355 列互相覆蓋；中文譯句作者沒有欄位（CC BY 標示不完整）。修正後 17,646 列全部匯入 |
| 學生檢視表 | 原 `v_items_student` 不篩狀態，檢核卷與待審題組的答案查得到；修正後 0 列 |

D1 上要再實測一次（Phase 1 驗收項，§9）。
