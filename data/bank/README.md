# AI 題庫（gsat-bank/v1）

代理通道（SPEC §5.1）與之後的批次通道產生的題組都放在這裡，格式、檢查與匯入方式相同。規格來源：
`docs/DB_SCHEMA.md` §5.3（檔案格式與資料表對應）、`docs/SPEC.md` §3（難度）、§5（出題與驗證流程）、§6.2–6.5（各題型）；
TypeScript 型別在 `packages/shared/src/bank.ts`，難度規格資料在 `packages/shared/src/tiers.ts`。

## 1. 目錄

| 路徑 | 內容 |
|---|---|
| `v1/{section_type}/{tier}/{uid}@{version}.json` | 一個檔案一個題組版本。`section_type`：vocabulary、cloze、word_bank、structure（第一批）、reading、mixed、translation、composition；`tier`：basic、advanced、top |
| `lots/{section_type}-{tier}-{nn}.json` | 批次規格（SPEC §5.2 步驟 1），由 `tools/make_lots.py` 產生 |
| `facts/{id}.json` | 事實單（SPEC §5.2 步驟 2；格式待事實單工作線定案）。`provenance.sources[].source_id` 寫 `fact:{id}` |
| `annotations/ceec/{paper}/{group}.json` | 歷屆題的註解（DB_SCHEMA §5.3；之後加入） |

`data/specs/tiers.json` 是 `tiers.ts` 的鏡像（給 Python 工具讀），由 `npm run gen:tiers` 產生，`npm run test:data` 會檢查兩者一致。
出題規格書在 `data/exams/generation-spec/{vocabulary,cloze,word_bank,structure}.json`，說明在 `docs/analysis/sections/`
（目前是另一條工作線審查中版本的快照，合併時再同步）。

## 2. 只增不減

- `v1/` 底下的檔案一旦 merge 就不能刪改（DB_SCHEMA §5.3；CI 之後由 `tools/only_add_guard.py` 檢查）。改題目一律新增 `@{version+1}` 的檔案，uid 不變。唯一例外是 `data/takedowns.jsonl` 有登記的路徑。
- **merge 之前**（還在 PR 裡）的檔案可以改：工具會把 metrics、verification、status 寫回同一個檔案。
- `rejected` 的檔案也要保留並 merge（`status_reason` 記錄淘汰原因）。依 SPEC §5.2 步驟 9「附意見重生一次」：重生的題組用**新的 uid**，在 `generation.regenerated_from` 填被退回的 uid；重生後仍不過，就停在 rejected。
- 批次規格開始生成後不再修改（裡面的數字就是那一批的依據）；規格改了就開下一批（`--seq 02`）。

## 3. 檔案格式

完整型別見 `packages/shared/src/bank.ts`；未列出的欄位一律是 error（`tools/validate_bank.py`）。

```jsonc
{
  "schema": "gsat-bank/v1",
  "uid": "ai.wb.7f3a9c",              // ai.{vo|cz|wb|st|rd|mx|tr|cp}（同 DB_SCHEMA §3.3）.{6 位小寫十六進位}；改版不換 uid
  "version": 1,
  "section_type": "word_bank",        // 與 uid 縮寫一致：vc 詞彙、cl 綜合、wb 文意選填、st 篇章、rd 閱讀、mx 混合、tr 中譯英、es 作文（composition）
  "format_version": "word_bank-10x10",// vocabulary-10、cloze-5、word_bank-10x10、structure-4x5（tiers.ts 的 SECTION_FORMATS）
  "tier": "advanced",
  "pool": "practice",                 // checkpoint＝檢核卷專用
  "group": {                          // 就是 gsat-exam/v1.1 的 group（docs/exam-json-schema.md），規則見下
    "id": "g1", "passage": "… [[1]] …", "passage_parts": null, "figures": [],
    "options_bank": { "A": "…", "…": "…", "J": "…" },
    "questions": [ { "no": 1, "label": "1", "mode": "bank_choice", "stem": null, "options": null, "answer": "E",
                     "accepted_answers": null, "points": 1, "stats": null, "scoring_notes": null,
                     "tags": { "test_point": "word_meaning", "answer_pos": "adjective" } } ],
    "tags": { "topic": "history of the umbrella", "genre": "expository", "sdgs": [], "text_format": "continuous" }
  },
  "annotations": {                    // 7 個鍵都要寫（沒有就 null 或 []）
    "explanations": { "items": { "1": {
      "explanation_zh": "…", "evidence": ["逐字證據句"],             // 必填；evidence 必須逐字出現在選文（詞彙題：題幹）
      "blank_pos": "adjective", "clue_type": "collocation",        // 選填（文意選填建議填 blank_pos）
      "sense": "core",                                             // 詞彙題必填：core／extended／conversion／idiom
      "option_notes_zh": { "B": "…" }, "strategy_zh": "…", "hints": ["…", "…", "…"] } } },
    "translation_zh": { "text": "…" },
    "elimination": null,              // 文意選填、篇章結構：由 record_verification.py 寫入，不要自己填
    "guess_targets": [], "open_tasks": [], "rubric": null, "model_texts": null
  },
  "curriculum": [ { "code": "3-V-12", "weight": "primary", "basis": "generator" } ],   // code 用 ASCII 寫法
  "provenance": { "sources": [ { "source_id": "fact:sdg14-0007", "role": "fact" } ],  // role：fact／dataset／adapted_text
                  "license": "original-ai", "derivation": "ai-original-from-facts",
                  "share_alike": false, "commercial_ok": true, "attribution_text": "本文由 AI 參考下列資料撰寫，非原文轉載" },
  "generation": { "channel": "agent", "run_id": "agent-2026-10-20-wb-adv-01", "lot": "word_bank-advanced-01",
                  "model": "claude-opus-5-5", "prompt_id": "gen/word_bank", "prompt_sha256": "<64 位十六進位>",
                  "spec_id": "word_bank-advanced@2026-10-08", "regenerated_from": null },
  "metrics": null,                    // tools/text_metrics.py --write 填，不由 AI 填
  "verification": [],                 // tools/record_verification.py 填
  "status": "draft",                  // draft → verified／rejected
  "status_reason": null               // rejected 時必填
}
```

**group 的規則**（gsat-exam/v1.1 之外再加的）：題號從 1 連續、`label` 等於題號字串、`stats` 為 null；選項代號從 A 依序；
空格 `[[n]]` 依序各出現一次並與小題一一對應；有選文的題型 `tags.topic` 必填。各題型：

| 題型 | 小題 | 選項 | 其他 |
|---|---|---|---|
| 詞彙題 vocabulary | 10 題 `single_choice`，題幹有 `____` | 每題 A–D，單字，4 個詞性相同 | `passage`、`options_bank` 為 null；正解在詞彙表且級別符合難度（SPEC §3.5；超越頂標用常用字延伸義時在解析標 `sense`） |
| 綜合測驗 cloze | 5 格 `single_choice`、`stem` null | 每格 A–D | `tags.test_point` 要填（考點組合依 SPEC §3.5 檢查） |
| 文意選填 word_bank | 10 格 `bank_choice` | `options_bank` A–J，每個選項剛好用一次 | `tags.answer_pos`（片語另加 `answer_function`）要填，用來檢查每格的詞性相容選項數 |
| 篇章結構 structure | 4 格 `bank_choice` | `options_bank` A–E，5 個都是完整句，剛好 1 個多餘句 | `tags.clue` 建議填 |

文字一律不出現「推理過程」類欄位名（reasoning、chain_of_thought、step_by_step、thinking），要說明就用 `explanation_zh`、`evidence`。

## 4. 流程與工具

一組題目從生成到可以 merge（SPEC §5.2 步驟 3–9）：

```bash
# 3. 生成：代理依 lots/{lot}.json 與出題規格書寫出 v1/{section}/{tier}/{uid}@1.json（status: draft）
# 4. 程式檢查（不過就改到過；不算一次失敗）
python3 tools/validate_bank.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json
python3 tools/text_metrics.py --write data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json
# 5. 盲解 A、B：給兩個全新工作階段（B 盡量用不同模型）學生畫面資料，各自產生 blind-a.json、blind-b.json（§5 的格式）
python3 tools/student_view.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json > /tmp/view.json
# 6. 干擾選項稽核：看得到答案的代理產生 audit.json（§5 的格式）
# 7–9. 寫入驗證紀錄、算唯一正解、判定 status
python3 tools/record_verification.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json \
    --blind-a blind-a.json --blind-b blind-b.json --audit audit.json
# 整批檢查（組數、每組題數、答案字母分布、近期正解字）
python3 tools/validate_bank.py --lot data/bank/lots/word_bank-advanced-01.json
```

| 工具 | 用法 | 作用 |
|---|---|---|
| `tools/validate_bank.py` | `FILE…`／`--all`／`--lot LOT`／`--json` | SPEC §5.4 的共通與四種題型檢查；有 error 結束碼 1；`--all` 沒有檔案時以 0 結束（CI） |
| `tools/text_metrics.py` | `FILE…`／`--write FILE…`／`--json`／`--text "…" --section word_bank --tier advanced` | SPEC §3.4 的指標與是否在帶內；`--write` 寫回 `metrics` |
| `tools/student_view.py` | `FILE…`／`--out-dir DIR FILE…` | 學生畫面資料（去掉答案、標註、annotations、generation、verification、難度），給盲解者 |
| `tools/record_verification.py` | `FILE --blind-a A --blind-b B --audit AUDIT [--extra X…] [--dry-run] [--json]` | 寫入 program／blind_solver／distractor_audit／unique_solution（＋similarity／fact_check），判定 status |
| `tools/make_lots.py` | （無參數）／`--seq 02`／`--dry-run`／`--force` | 產生批次規格 |

**文章指標的算法**：去掉 `<b>`／`<u>` 與 `[[n]]` 後斷詞（和 `tools/exam_stats.py` 相同，所以能和歷屆選文比）；詞形還原用
`data/vocab/forms-index.json`，規則衍生的 -ly 副詞沿用形容詞級別；專有名詞（句中大寫且不在詞表，或句首大寫但文中別處也以大寫出現在句中、
全大寫縮寫）與數字（含拼出來的基數、序數詞）不算分母。字數不含空格的正解與篇章結構被挖掉的句子（歷屆統計也這樣算）。

**帶**：檔案的 `generation.lot` 對得到批次規格時，用批次規格的 `passage_band`（SPEC §3.4 疊上出題規格書的 `passage_overrides`，
疊了哪些寫在 `basis`；原本的 SPEC 帶保留在 `spec_3_4`）；否則用 SPEC §3.4。詞彙題沒有選文，不比對帶。

## 5. 盲解與稽核結果的 JSON 格式

三種輸入檔都必須帶 `uid`、`version`（和題組一致），不可有未列出的欄位，也不可有「推理過程」類欄位名。
證據句（`evidence`）一律逐字引用學生畫面資料裡的選文、題幹或選項句；比對時會忽略 `<b>`／`<u>`、多餘空白、彎直引號差異，
空格可以寫成 `[[n]]` 或 `____`。

### 5.1 盲解（`gsat-bank-blind/v1`，A、B 各一份）

```jsonc
{
  "schema": "gsat-bank-blind/v1",
  "uid": "ai.wb.7f3a9c",
  "version": 1,
  "solver": "A",                         // A 或 B；要和 --blind-a／--blind-b 對上
  "reviewer": "claude-opus-5-5",         // 模型 ID
  "session_id": "session_…",             // 選填：盲解工作階段
  "created_at": "2026-10-20T08:00:00Z",  // 選填：ISO 8601（UTC）；省略時用寫入時間
  "answers": {                           // 每一題都要有；鍵是題號字串
    "1": {
      "answer": "E",                     // 選項代號
      "confidence": "high",              // high／medium／low
      "also_plausible": [],              // 其他也說得通的選項代號
      "evidence": ["逐字證據句"],          // 至少 1 句
      "explanation_zh": "為什麼選這個（中文，一兩句）",
      "feasible": ["A", "E"]             // 文意選填、篇章結構必填：這一格「放得進去」的全部選項（必含 answer）；其他題型省略
    }
  }
}
```

### 5.2 干擾選項稽核（`gsat-bank-audit/v1`）

```jsonc
{
  "schema": "gsat-bank-audit/v1",
  "uid": "ai.wb.7f3a9c",
  "version": 1,
  "reviewer": "claude-opus-5-5",
  "session_id": "session_…",             // 選填
  "created_at": "2026-10-20T08:30:00Z",  // 選填
  "items": {                             // 題號 → 錯誤選項代號 → 判定
    "1": {
      "A": {
        "verdict": "clearly_wrong",      // clearly_wrong／arguably_acceptable
        "error_type": "pos_mismatch",    // pos_mismatch／grammar／collocation／meaning／logic／register／cohesion／off_topic／factual／other
        "evidence": "使它錯的那句原文（逐字）",
        "explanation_zh": "為什麼錯"
      }
    }
  }
}
```

每一題的每個錯誤選項都要判定（詞彙、綜合：3 個；篇章結構：4 個，含多餘句；文意選填：9 個，缺的只列 warn，至少要判詞性相容的選項）。
正解不要出現在 `items` 裡。

### 5.3 其他檢查（`gsat-bank-check/v1`，相似度、事實核對；用 `--extra` 傳入，可多個）

```jsonc
{ "schema": "gsat-bank-check/v1", "uid": "ai.wb.7f3a9c", "version": 1,
  "kind": "similarity",                  // similarity／fact_check
  "reviewer": "similarity.py",           // 工具或模型 ID
  "result": "pass",                      // pass／warn／fail
  "created_at": "2026-10-20T09:00:00Z",  // 選填
  "details": { "max_common_words": 7, "threshold": 12, "against": ["fact:sdg14-0007"], "problems": [] } }
// fact_check 的 details：{ "checked": [ { "claim": "…", "source_id": "fact:…", "ok": true } ], "problems": [] }
```

### 5.4 寫進題組檔的 verification 項目

`record_verification.py` 把上面的輸入轉成 `verification[]`（各自成為 D1 `item_reviews` 的一列，`result` 對應 `verdict`）：

```jsonc
{ "kind": "blind_solver", "reviewer": "claude-opus-5-5", "result": "pass", "created_at": "…",
  "details": { "solver": "A", "session_id": "…", "answers": { /* 原樣 */ }, "problems": [] } }
// program：        details { errors: [], warnings: [] }（validate_bank.py 的結果；有 warning 時 result 是 warn）
// distractor_audit：details { session_id, items: { /* 原樣 */ }, problems: [] }
// unique_solution： details { method: perfect_matching_dp（文意選填）／injective_assignment（篇章結構），
//                             perfect_matchings, matches_key, feasible, problems }
```

同一種檢查重跑時取代舊紀錄（盲解依 A／B 分別取代）。

## 6. 判定規則（SPEC §5.6、§5.7）

**唯一正解**（文意選填、篇章結構）：把兩位盲解者每格的 `feasible` 取聯集，寫成 `annotations.elimination.feasible`；
算「每格各放一個不同選項」的填法數（文意選填用子集合動態規劃，2¹⁰ 個狀態），寫成 `perfect_matchings`。
必須**剛好 1 種，而且就是標準答案**；篇章結構的多餘句在每一格都不可行。

**verified** 要同時滿足：

1. `program` 沒有 error（warning 可以，但 SPEC §5.8：任何 warn 都進 100% 人工審核）。
2. 兩位盲解者每一題都答對、信心至少 `medium`、`also_plausible` 為空、證據句逐字找得到；文意選填、篇章結構每格都有 `feasible`。
3. 稽核沒有任何 `arguably_acceptable`，證據句逐字找得到，該判的選項都判了。
4. `unique_solution` 通過（適用者）。
5. `--extra` 傳入的 similarity／fact_check 沒有 fail。

任何一項 fail → **rejected**，`status_reason` 列出原因（每項最多 3 條）。必要的輸入不齊（缺盲解 A／B 或稽核）時維持 **draft**、不判定。
結束碼：0 verified、1 rejected、2 輸入檔錯誤、3 輸入不齊。

## 7. 批次規格（lots）

`tools/make_lots.py` 依 ROADMAP §9.2 產生第一批 12 個檔案：

| 題型 | 每個難度的組數 × 每組題數 | 答案字母分布 | 唯一正解檢查 |
|---|---|---|---|
| 詞彙題 | 5 × 10 | 每個字母 20–30% | — |
| 綜合測驗 | 8 × 5 | 每個字母 20–30% | — |
| 文意選填 | 5 × 10 | 不適用（每個選項用一次） | 有 |
| 篇章結構 | 5 × 4 | 不適用 | 有 |

每個檔案的欄位：`lot`、`section_type`、`tier`、`count`、`questions_per_group`、`format_version`、`uid_prefix`、`path`、
`spec_id`／`spec_file`／`spec_tier_key`／`spec_status`（出題規格書）、`topic_quota`（08 §6.1：每 8 組「起源與演變 3、科普與健康 2–3、
文化與歷史 2、社會與議題 1」依組數等比例取整；詞彙題不設）、`answer_letter_share`、`avoid`（gsat-111～115 與 ref-115 同一大題的正解字、
正解句與主題）、`passage_band`、`item_rules`（SPEC §3.5）、`targets`（出題規格書該難度的配方：考點配比、誘答規則、常見錯誤）、
`set_composition`（一組內各難度格數）、`verification`（盲解人數、稽核、唯一正解、人工審核比例）。
