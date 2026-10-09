# AI 題庫（gsat-bank/v1）

代理通道（SPEC §5.1）與之後的批次通道產生的題組都放在這裡，格式、檢查與匯入方式相同。規格來源：
`docs/DB_SCHEMA.md` §5.3（檔案格式與資料表對應）、`docs/SPEC.md` §3（難度）、§5（出題與驗證流程）、§6.2–6.7（各題型）；
TypeScript 型別在 `packages/shared/src/bank.ts`，難度規格資料在 `packages/shared/src/tiers.ts`。

## 1. 目錄

| 路徑 | 內容 |
|---|---|
| `v1/{section_type}/{tier}/{uid}@{version}.json` | 一個檔案一個題組版本。`section_type`：vocabulary、cloze、word_bank、structure（第一批）、reading、mixed、translation、composition；`tier`：basic、advanced、top |
| `lots/{section_type}-{tier}-{nn}.json` | 批次規格（SPEC §5.2 步驟 1），由 `tools/make_lots.py` 產生；中譯英、作文由 `tools/make_writing_lots.py` 產生（§7.1） |
| `topic-plan-writing.json` | 中譯英、作文的主題總表（`gsat-bank-topic-plan-writing/v1`，§7.1）；其他題型第 2 批起的主題在 `topic-plan.json`（§9） |
| `facts/{id}.json` | 事實單（SPEC §5.2 步驟 2；格式見 §8）。`provenance.sources[].source_id` 寫 `fact:{id}` |
| `sources-whitelist.json` | 素材來源白名單與禁止清單（SPEC §5.3；規則見 §8.2） |
| `annotations/ceec/{paper}/{group}.json` | 歷屆題的註解（DB_SCHEMA §5.3；之後加入） |

`data/specs/tiers.json` 是 `tiers.ts` 的鏡像（給 Python 工具讀），由 `npm run gen:tiers` 產生，`npm run test:data` 會檢查兩者一致。
出題規格書在 `data/exams/generation-spec/{vocabulary,cloze,word_bank,structure,reading,mixed,writing}.json`，說明在 `docs/analysis/sections/`
（01–07；origin/main 的審查定稿）。`lots/` 裡現有、由 `make_lots.py` 產生的批次規格（前四種題型與閱讀、混合題）是用審查中版本的快照產生的，和現在的規格書重算的結果有些欄位不同（批次規格開始生成後不再修改，見 §2）；之後的批次照現在的規格書產生。

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
  "section_type": "word_bank",        // 與 uid 縮寫一致：vo 詞彙、cz 綜合、wb 文意選填、st 篇章、rd 閱讀、mx 混合、tr 中譯英、cp 作文（composition）
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
| 閱讀 reading | 4 題 `single_choice`，題幹必填 | 每題 A–D | `tags.item_type` 要填（SPEC §3.5 題型配比）；文本形式見 §3.1；圖表 §3.2 |
| 混合題 mixed | 4 子題依序 `fill_in_blank`、`fill_in_blank`、`multi_select`、`short_answer`（配分 2、2、4、2） | 只有多選有 `options`：6／8／10 個 | 詳見 §3.3 |
| 中譯英 translation | 2 句 `translation`（各 4 分），`stem` 是中文題目 | 無 | `answer`＝本站首選參考譯文；評分規準在 `annotations.rubric`；詳見 §3.5 |
| 作文 composition | 1 題 `composition`（20 分），`stem` 是題目提示，`answer` null | 無 | 1–3 張圖（可帶 SVG 示意圖）；範文在 `annotations.model_texts`；詳見 §3.6 |

文字一律不出現「推理過程」類欄位名（reasoning、chain_of_thought、step_by_step、thinking），要說明就用 `explanation_zh`、`evidence`。

### 3.1 閱讀（reading）

- **一組 1 篇 4 題**（`format_version` 是 `reading-4`），題號 1–4，每題 4 個選項 A–D、`single_choice`、題幹必填。
- **文本形式**（批次規格 `form_quota` 依這個分類計數，`validate_bank.reading_form`）：

  | 形式 | 寫法 | `tags.text_format`（v1.1 規則） |
  |---|---|---|
  | 長文 `continuous` | `passage`；看文選圖的配圖可以放 `figures`（`kind` 照 exam 規格，例如 picture） | `continuous`（有配圖時 `mixed`） |
  | 圖表 `chart` | `passage`＋一張 `kind: "chart"` 的 figure，figure 帶 `chart` 物件（§3.2） | `mixed` |
  | 表格 `table` | `passage`＋一張 `kind: "table"` 的 figure，表格內容寫在 `rows`（沿用 gsat-exam 的寫法：字串二維陣列、第一列是表頭、每列欄數相同） | `mixed` |
  | 多文本 `multi_text` | 沿用 gsat-exam 的 `passage_parts`（`[{label, title, text}]`，兩篇以上）；`passage` 可以是 null 或一段引言 | `multi_text` |

- **figures**（閱讀、混合題才檢查）：欄位同 gsat-exam（`kind`、`caption`、`description` 必填；`rows`、`label`、`question_no` 選填），
  另加選填的 `chart`。AI 題的 `description` 一律要完整描述圖表內容（盲解者與無障礙都靠它）；描述裡的數字必須和 `chart` 一致。
- **解析**：每題都要有 `explanation_zh` 與逐字 `evidence`。證據可以引用選文、題幹、圖的 `caption`／`description`、表格的一列
  （儲存格以 ` | ` 相接）或圖表文字版的一行（學生畫面資料的 `chart_text`／`data_table`，§3.2）。
  另可選填 `option_codes`（錯誤選項的誘答碼，出題規格書 `distractor_taxonomy`：TI、TN、OP、SP、OG、DS、NM、LS、CX、SF、NA、VS、MT、PL）
  與 `option_evidence`（`{選項代號: [逐字證據句]}`）。
- **題型配比**照 SPEC §3.5 檢查（穩定基礎：細節〔含讀圖、NOT、排序〕≥2、主旨 1、上下文詞義或指代 1；進階：指代、推論各 ≥1；
  超越頂標：推論、目的或態度、圖表整合合計 ≥2）。出題規格書 05-reading.md §7 建議改用誘答強度定級，兩者不一致處只列 warning。
  有圖表或表格的題組至少要有 1 題 `item_type: "chart_reading"`（warning）；同一篇同一個正解字母 ≤2 次（warning，RD-FMT-03）。
- **SDG**：`tags.sdgs` 標 SDG 編號（文字標籤，不用官方圖示）；寫成具體事件或物件，不寫成政策宣導（SPEC §6.6）。
- 思考表達開放題放 `annotations.open_tasks`（SPEC §6.6.1；bank.ts 的 `OpenTask`），生字推測放 `guess_targets`（目前只檢查是陣列）。

### 3.2 圖表：`figure.chart`

圖表題沿用 gsat-exam 的 figure（`kind: "chart"`），多一個 `chart` 物件，前端依它繪圖（不貼來源網站的圖片），「⇄ 資料表」也由它產生：

```jsonc
{
  "kind": "chart", "label": "Chart 1", "caption": "Children who die before age 5 (per 1,000 live births), 1990–2020",
  "description": "折線圖。橫軸是年份（1990、2000、2010、2020）……World 從 93.5 降到 39.2……",   // 數字要和 chart 一致
  "rows": null, "question_no": null,
  "chart": {
    "type": "line",                          // bar（類別長條；多個數列＝分組長條）／line（x 是時間點）／stacked_bar（≥2 個數列堆疊）／pie（1 個數列，類別是切片）
    "title": "Children who die before age 5, 1990–2020",
    "x": { "label": "Year", "unit": null },  // 類別軸；pie 是切片的類別名
    "y": { "label": "Deaths before age 5", "unit": "per 1,000 live births" },   // 數值軸；unit 沒有就 null
    "categories": ["1990", "2000", "2010", "2020"],
    "series": [ { "name": "World", "values": [93.5, 76.7, 50.6, 39.2] },        // values：JSON number，長度＝categories
                { "name": "South Asia", "values": [128.6, 90, 56.3, 32.4] } ],
    "note": null,                            // 圖下附註（字串或 null）
    "source": { "publisher": "World Bank", "title": "World Development Indicators: Mortality rate, under-5",
                "url": "https://data.worldbank.org/indicator/SH.DYN.MORT", "license": "CC-BY-4.0", "accessed": "2026-10-09" }
  }
}
```

檢查（`tools/validate_bank.py`）：

- 欄位齊全、沒有未知欄位；`type` 在上面 4 種；`categories` 是不重複的非空字串；每個數列 `name` 不重複、`values` 都是數字且長度等於
  `categories`；pie 只能 1 個數列、不可為負（單位是 `%` 時加總不是 100 列 warning）；stacked_bar 至少 2 個數列；line 至少 2 個類別。
- `source.url` 的網域要在白名單、用途是 `dataset`、`license` 符合白名單（§8.2）；`accessed` 是 YYYY-MM-DD。
- **圖表數字一致**：`chart` 的每個數值都要在 provenance 裡 `role: "dataset"` 的事實單 `datasets` 找得到（可以依圖上的小數位數四捨五入；
  圖表題一定要有 `role: "dataset"` 的來源）；figure 的 `description`、`caption`、`rows` 提到的數字要和 `chart` 資料（含標題、軸名、單位、附註）一致。
- **文中與題目提到的數字都查得到**：選文、`passage_parts`、題幹（題幹的中文作答說明與配分標示不算）裡的阿拉伯數字，必須等於
  圖表數值、類別、表格儲存格、事實單（事實文字與 datasets）裡的某個數字——比對時依文中寫的小數位數四捨五入（圖上 41.2，文中寫 41 也算），
  同一數列兩值或同一類別兩數列的差也算（rose by 12 points）；`tags.sdgs` 的編號也算。查不到：有圖表或表格的題組是 error、
  沒有的題組是 warning（交給 fact_check）；選項裡查不到的數字只列 warning（誘答可以故意寫錯數字）。倍數、平均這類衍生數字請寫進事實單。
- 學生畫面資料（`tools/student_view.py`）把有 `chart` 的 figure 另外加上 `chart_text`（文字版：類型與標題、軸、數列、每個資料點一行
  `"{類別}, {數列}: {數值}{單位}"`〔只有一個數列時是 `"{類別}: {數值}{單位}"`〕、附註、資料來源）與 `data_table`（第一列表頭）。

### 3.3 混合題（mixed）

一組 4 子題，題號 1–4（對應正式卷 47–50），`format_version` 是 `mixed-4`：

| 題號 | `mode` | 配分 | 規則 |
|---|---|---|---|
| 1、2 | `fill_in_blank` | 各 2 | 兩題的 `stem` 相同：中文作答說明＋英文摘要句，空格寫 `[[1]]`、`[[2]]`（不在 `passage` 裡）。`answer` 是單一英文單詞；**答案的原形要出現在文中、答案本身不出現**（SPEC §5.4；穩定基礎允許 1 格原形照抄〔SPEC §3.5〕，但至少 1 格的所有可接受答案都不逐字出現在文中，MIX-FIL-03） |
| 3 | `multi_select` | 4 | `options` 6／8／10 個（SPEC §5.4；各難度的範圍見 §3.5，超出只列 warning）；`answer` 是選項代號陣列（依字母排序），2–4 個正解（MIX-FMT-02） |
| 4 | `short_answer` | 2 | `answer` **逐字出現在文中**（不分大小寫；出現多次列 warning）；字數照 SPEC §3.5（超出列 warning） |

- **`accepted_answers`**（填充、簡答）：AI 題寫**完整的可接受答案清單，含 `answer` 本身，至少 1 個**（SPEC §5.4「可接受答案 ≥1」）；
  填充的每個可接受答案都要是單一英文單詞。比對時用 SPEC §4.6 的正規化（去頭尾空白、統一引號、不分大小寫、去句尾句點、圈號數字＝阿拉伯數字）。
- **選文**：`passage` 是 35–80 字的引言，`passage_parts` 是雙文本（各 120–200 字）或 6–10 則短段落（各 15–70 字），每段有 `label`
  （MIX-PAS-02／03，warning）。圖只作裝飾或定位時寫進 `figures`，`description` 註明作答資訊在文字中。
- **解析的擴充欄位**（只在閱讀、混合題允許；其他題型仍是「未知欄位」error），各自限定作答模式：

  | 欄位 | 作答模式 | 內容 |
  |---|---|---|
  | `source_token` | 填充 | 答案在文中的來源字（逐字出現在選文） |
  | `transform` | 填充 | `none`／`inflection`／`pos_shift`／`pos_shift+inflection`（出題規格書 MIX-FIL-02；超越頂標要轉詞性） |
  | `partial_credit_forms` | 填充、簡答 | 選字對、字形錯給 1 分的寫法（SPEC §4.6）；不可和 `accepted_answers` 重疊 |
  | `interchangeable_with` | 填充 | 可以和哪一格對調（題號）或 null |
  | `option_codes` | 多選（閱讀單選也可） | 多選：正解標 `E1`（文中明寫）／`E2`（要推論），誤選標 `PT`／`CT`／`NM`／`PL`／`ST`／`ST*`（MIX-MUL-01／02） |
  | `option_evidence` | 多選（閱讀單選也可） | `{選項代號: [逐字證據句]}`；正解要對每個需要符合的對象各附一句 |

  沒寫 `source_token`、`transform`、`option_codes` 列 warning。答案的「原形」先用 `source_token` 判定；沒寫時找文中與答案同一詞目
  （`data/vocab/forms-index.json`）或同字族（`lexicon.json` 的 family）的字，只靠字首相同找到的列 warning。
- 表格填寫（`table_completion`）第一批不使用，只做共通檢查（要有 `answer_table`）。

### 3.4 閱讀、混合題的出處（provenance）

- `derivation: "ai-original-from-facts"`（SPEC §5.3：生成者只拿到事實單與難度規格，不提供來源原文），`license: "original-ai"`，
  `attribution_text` 用「本文由 AI 參考下列資料撰寫，非原文轉載」（有圖表另寫資料來源）。
- `sources[]`：`{ "source_id": "fact:{id}", "role": "fact" }`；圖表資料用 `role: "dataset"`（同一份事實單可以兩個角色都列）。
  **每個 fact／dataset 來源都要有事實單**（不存在是 error）、事實單本身不能有 error（`--facts` 的檢查，含來源網域在白名單、不在禁止清單）；
  `role: "dataset"` 的事實單要有 `datasets`。`sources[].url`（選填）也依角色檢查白名單（fact→fact_only、dataset→dataset、adapted_text→adaptable_text）。

### 3.5 中譯英（translation）

一組 2 句、同一主題（`format_version` 是 `translation-2`），型別見 bank.ts 的 `TranslationRubric`；範例 `tools/tests/data/ai.tr.0b1c2d@1.json`。

- **group**：照 exam.ts 的 translation 題型。題號 1、2，`label` "1"／"2"，`mode: "translation"`，`points` 4（SPEC §4.6；writing.ts 的
  AI 批改只收 2 句 × 4 分），`stem` 是中文題目（表外專有名詞在括號附英文），`options`、`passage` 為 null，`figures` []。
  `answer` 是本站首選參考譯文（＝`references[0]`），`accepted_answers` 是其他本站參考譯文（＝`references[1:]`，或 null）；
  `answer_segments` 選填（各段第一個寫法串起來要等於 `answer`）。`group.tags.topic` 必填（照批次規格的 `topic_zh`）。
- **annotations.explanations**（必填）：每句 `explanation_zh`＋`evidence`（逐字引用中文題目）；`hints` 依序寫鷹架三層：語意單位切分、
  標的詞彙、句型框架（SPEC §6.8 步驟 2）。常見錯誤的解析也寫在這裡。
- **annotations.rubric**：

```jsonc
{ "kind": "translation",
  "items": { "1": {
    "references": ["In recent years, many students have started …", "Many students have begun …"],   // 本站參考譯文 ≥2（超越頂標建議 ≥3）
    "target_words": [ { "word": "start", "zh": "開始", "alternatives": ["begin"] } ],   // 標的詞彙：每個參考譯文都要含（詞形變化可，換字寫 alternatives）
    "patterns": [ { "code": "PERF", "grammar_id": "gp-present-perfect", "label_zh": "現在完成式",
                    "frame": "S + have/has + p.p.", "zh_trigger": "已經開始" } ],          // 標的句型：每個參考譯文都要用到
    "parts": [                                                                            // 評分規準：剛好 4 個部分（各 1 分）
      { "zh": "近年來", "accepted": ["In recent years", "Recently"], "targets": ["recent"],  // zh 逐字在題目；accepted[0] 在首選譯文
        "common_errors": [ { "wrong": "In recent year", "right": "In recent years", "explanation_zh": "years 要用複數。" } ] } ],
    "traps": [ { "type": "tense_trigger", "zh": "已經", "literal_error": "…", "part": 2, "explanation_zh": "…" } ],   // 誘錯點
    "bonus": [ { "text": "…", "grammar_id": "gp-not-until-inversion", "explanation_zh": "…" } ],   // 加分寫法：倒裝、假設等只放這裡
    "restructuring_zh": "…"                                                               // 選填：要改寫句構才通順的說明（進階以上至少 1 句）
  } } }
```

- 句構代碼（`code`）：PERF、PASS、COMP、PART、NFSUBJ、ADVCL、REL、NRREL、PURP、VOC、PREPVING、PARA、CORR、NCL、PROG、PASTPERF、BASIC
  （出題規格書 WRT-TRN-STR-01）；`grammar_id` 是 `data/curriculum/grammar-patterns.json` 的句型 id。分類是倒裝、假設、強調的句型不可當標的句型。
  誘錯點 `type`：tense_trigger、plural_countable、collocation、word_form、subjectless、prenominal_modifier、verbal_subject、abstract_nominal、redundancy。
- **檢查**（`validate_bank.py`；SPEC 規則是 error，出題規格書比 SPEC 細的參數是 warning）：
  - error：參考譯文 ≥2、不重複、句首大寫句尾標點；`answer`／`accepted_answers` 和 `references` 一致；**每個參考譯文都含每個標的詞彙**（依 forms-index
    比對詞目，`alternatives` 也算）；**每個參考譯文都用到每個標的句型**（PERF、PASTPERF、PROG、PASS、COMP、CORR、NRREL、PREPVING、ADVCL 由程式比對，
    比對不到是 error；PURP、NFSUBJ、REL、PARA、NCL、PART 只能粗略比對，比對不到是 warning；VOC、BASIC 不比對）；`zh_trigger` 逐字在題目；
    **評分規準剛好 4 個部分**，每部分在每個參考譯文都找得到一種可接受寫法，至少 1 個常見錯誤；每句 4 分。
  - error（SPEC §3.5）：首選參考譯文字數 basic 10–18、advanced 14–24、top 20–30（其他參考譯文超出列 warning）；句構數 basic 1、advanced 2、top ≥2；
    標的詞彙在詞彙表內且 basic ≤L4、advanced ≤L4（每句最多 1 個 L5）、top ≤L6；advanced 首選譯文的實詞最多 1 個 L5、沒有 L6；
    top 一組至少 1 個指定句型（非限定關係子句、句尾分詞表結果、no matter＋wh-、what／whether 子句）。
  - warning（出題規格書）：中文字數、譯文字數、L3 以上與 L5 以上詞目數、首選譯文超過該級上限或表外的字、句構不在該級範圍、可替換段數、誘錯點數、
    兩句看不出同一主題、穩定基礎兩句同一句構、進階以上沒有 `restructuring_zh`、超越頂標沒有加分寫法、參考譯文看起來用了倒裝或假設。
  - D8：參考譯文、各部分的可接受寫法、加分寫法和 `data/exams/parsed` 的官方參考譯文（`answer`、`accepted_answers`、`answer_variants`、
    `answer_segments` 全部展開）有 **8 字以上相同字串**是 error；中文題目和任何歷屆中譯英題目有連續 10 個以上相同漢字是 error（8–9 個 warning）。

### 3.6 作文（composition）

一題一篇（`format_version` 是 `composition-1`），型別見 bank.ts 的 `CompositionRubric`、`ModelText`；範例 `tools/tests/data/ai.cp.0e1f2a@1.json`。

- **group**：照 exam.ts 的 composition 題型。1 題，`label` "1"，`mode: "composition"`，`answer` null，`points` 20；`stem` 以「提示：」開頭，
  寫情境與「請…寫一篇英文作文，文分兩段。第一段…；第二段…」；`tags`：`essay_type`（picture／chart）、`paragraphs` 2、
  `word_count` `{min: 120, max: null, approx: null}`、`topic`。`group.tags.topic` 必填。
- **figures**（1–3 張，SPEC §3.5 三種難度都看圖或圖表）：欄位同 gsat-exam（`kind`、`caption`、`description` 必填），另可加 `svg`
  （ROADMAP D9：代理畫的簡單示意圖，完整的 `<svg …>…</svg>`，要有 `xmlns` 與 `viewBox`，不可有 `<script>`、事件屬性、外部連結、`<image>`、
  `<foreignObject>`、`<style>`、`url(`、tab，≤30,000 字元）。沒有 SVG 時 `description` 就是學生看到的情境。
  圖表題 `kind: "chart"`／`"table"`，數字寫在 `rows`（第一列表頭；是題目設定的假設調查，題目寫明情境），`description` 提到的數字要在 `rows` 裡。
- **annotations.rubric**：

```jsonc
{ "kind": "composition",
  "prompt_type": "picture_scene",           // picture_scene／topic_experience／picture_issue／letter／topic_opinion／picture_issue_abstract／chart／social_phenomenon
  "moves": [ { "paragraph": 1, "code": "describe", "zh": "描述圖中的學生們正在做哪些打掃工作" },     // 題目要求的內容步驟
             { "paragraph": 2, "code": "personal_experience", "zh": "…" } ],
  "criteria": {                             // 四項各 0–5：content 內容、organization 組織、grammar 文法句構、vocabulary 字彙拼字
    "content": { "focus_zh": "這一題在這一項要看什麼",
                 "bands": [ { "min": 4, "max": 5, "descriptor_zh": "本站自己的文字" }, { "min": 3, "max": 3, … },
                            { "min": 1, "max": 2, … }, { "min": 0, "max": 0, … } ] }, … },
  "deductions_zh": "字數明顯不足或沒有分成兩段，各扣總分 1 分；…",
  "scaffold": { "kind": "outline+sentence_starters",               // 穩定基礎：構思圖＋兩段大綱＋每段 2–3 個句型開頭
                "planning_map": { "center_zh": "打掃時間", "branches": [ { "label_zh": "什麼時候", "prompt_zh": "…" } ] },
                "outline": [ { "paragraph": 1, "topic_sentence_zh": "…", "details_zh": ["…", "…"], "closing_zh": "…" }, { "paragraph": 2, … } ],
                "sentence_starters": [ ["The picture shows ...", "..."], ["In my class, I am in charge of ...", "..."] ] } }
// 進階：{ "kind": "outline", "outline": [...] } 或 null（不給句型開頭）；超越頂標：{ "kind": "checklist", "checklist_zh": [...] } 或 null
```

  `moves` 的 code：describe、compare、explain_function、describe_data、select_one（第一段常用）；personal_experience、preference_reasons、simple_plan、
  ideal_design、experience_solution、imagined_plan、opinion、reasons、effects、evaluate、propose、compare_self、concede_rebut（第二段常用）。
- **annotations.model_texts**：剛好兩篇，`label` 各一篇 `steady`（穩健版）與 `top`（頂標版）：

```jsonc
{ "label": "steady",
  "text": "第一段……\n第二段……",              // ≥120 字（writing.ts countEnglishWords 的算法）、剛好 2 段（段落之間一個換行）
  "paragraphs": [ { "function_zh": "描述圖片：…", "topic_sentence": "逐字引用第一段的主題句" }, { … } ],   // 段落功能
  "notes": [                                // text 都要逐字出現在範文
    { "kind": "connective", "text": "First,", "function": "sequence", "zh": "列舉" },   // function：sequence／addition／cause_effect／contrast／example／conclusion
    { "kind": "detail", "text": "整句", "zh": "…" }, { "kind": "experience", "text": "整句", "zh": "…" },
    { "kind": "pattern", "text": "not only a chore but also a chance", "zh": "好用句型" }, { "kind": "phrase", "text": "in charge of", "zh": "…" } ],
  "self_assessment": { "scores": { "content": 4, "organization": 4, "grammar": 4, "vocabulary": 3 },   // 本站標的分數：穩健版 14–17、頂標版 18–20
                       "explanation_zh": "依四項指標說明為什麼是這個分數" } }
```

- `annotations.explanations` 選填（審題重點，`evidence` 引用題目）。
- **檢查**：
  - error：題目有「文分兩段」「第一段」「第二段」；`points` 20、`paragraphs` 2、`word_count.min` 120、`essay_type` 有標；1–3 張圖，每張有 caption 與完整描述，
    SVG 安全；評分規準四項各自的 `bands` 剛好涵蓋 0–5；兩篇範文、各 ≥120 字、剛好 2 段；段落功能 2 筆、主題句逐字在該段；**註解的範圍都在文中**；
    **轉承詞涵蓋 ≥4 種功能**（sequence 列舉或時序、cause_effect 因果、contrast 轉折或讓步、example 舉例、conclusion 結論；addition 不算，SPEC §5.4）；
    **有細節句與個人經驗句的標註**、至少 1 個好用句型；自評總分在目標區間。
  - error（SPEC §3.5 的難度）：basic 第一段要描述（describe／compare）、第二段要有個人經驗（personal_experience／experience_solution／compare_self），
    鷹架是 outline+sentence_starters；advanced 第二段要有看法、原因或影響（opinion／reasons／effects／evaluate／propose／concede_rebut／preference_reasons），
    不給句型開頭；top 要有圖表或 ≥2 張圖、第一段比較或描述數據、第二段評估或提出方案、課綱標 9-V-7 或 9-V-8。
  - warning（出題規格書）：提示字數、內容步驟數、鷹架種類、範文的字數、第二段占比、句數、平均句長、句長變異、轉承詞密度與種類、L1–4 覆蓋率、
    L5 以上比例、MATTR(50)、倒裝句數（穩健版用 foundation.model_essay、頂標版用 beyond_top.model_essay）、轉承詞不在清單、細節句不足 2 句。
  - D8：範文和官方英文內容有 8 字以上相同字串是 error；評分規準（含 focus、鷹架）的中文和官方評分說明（`scoring_notes`）有連續 8 個以上相同漢字
    （不跨標點）是 error；題目提示和歷屆作文題有連續 12 個以上相同漢字是 warning。

### 3.7 中譯英、作文的出處與 D8

- `provenance`：`sources` []、`license: "original-ai"`、`derivation: "original"`、`attribution_text` null；圖表題的數字是題目設定的假設調查，不引真實資料。
- **D8**（ROADMAP §11）：本站參考譯文、評分規準、範文全部自己寫，不重製大考中心的官方參考譯文、評分原則原文或官方範文、佳作（佳作只連結不重製）。
  程式比對的範圍是 `data/exams/parsed` 全部考卷（§3.5、§3.6 的 D8 檢查）。

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
# 整批檢查（組數、每組題數、答案字母分布、近期正解字；第 2 批起另查指定主題、題庫已用的正解與干擾字，§9.4）
python3 tools/validate_bank.py --lot data/bank/lots/word_bank-advanced-01.json
```

**閱讀、混合題**多兩步（SPEC §5.2 步驟 2、§5.3）：

```bash
# 2. 事實單：從白名單來源整理「只有事實、沒有原句」的清單（§8），圖表資料存在 datasets；先檢查事實單
python3 tools/validate_bank.py --facts data/bank/facts/sdg14-0007.json
# 3. 生成：生成者只拿到事實單、批次規格（lots/reading-*.json、lots/mixed-*.json）與出題規格書，不給來源原文
# 4–9. 同上：validate_bank → text_metrics --write → student_view（圖表有 chart_text、data_table）→ 盲解 A、B（混合題格式見 §5.1）
#      → 干擾選項稽核（閱讀每題 3 個錯誤選項；混合題只稽核多選的錯誤選項）→ record_verification
```

**中譯英、作文**沒有干擾選項稽核，盲解改成盲譯、盲評（§5.5、§5.6）：

```bash
# 3. 生成：依 lots/translation-*.json、lots/composition-*.json（主題、句型配置、評分規準範本）與出題規格書 writing.json
# 4. 程式檢查
python3 tools/validate_bank.py data/bank/v1/translation/basic/ai.tr.1a2b3c@1.json
# 5. 中譯英盲譯：盲譯者只拿學生畫面資料（只有中文題目），先寫 answers，再打開題組檔寫 review
python3 tools/student_view.py data/bank/v1/translation/basic/ai.tr.1a2b3c@1.json > /tmp/view.json
#    作文盲評：盲評者只拿題目、評分規準與兩篇範文（E1、E2，不標版本、不給目標分數）
python3 tools/student_view.py --grading data/bank/v1/composition/basic/ai.cp.4d5e6f@1.json > /tmp/grading.json
# 7–9. 寫入驗證紀錄並判定（不給 --audit）
python3 tools/record_verification.py data/bank/v1/translation/basic/ai.tr.1a2b3c@1.json --blind-a tr-a.json --blind-b tr-b.json
python3 tools/validate_bank.py --lot data/bank/lots/translation-basic-01.json
```

| 工具 | 用法 | 作用 |
|---|---|---|
| `tools/validate_bank.py` | `FILE…`／`--all`／`--lot LOT`／`--json`／`--facts [FACTS…]` | SPEC §5.4 的共通與八種題型檢查（中譯英、作文見 §3.5–3.7）；`--facts` 另查事實單（不給檔名就是 `data/bank/facts` 全部；JSON 報告多一個 `facts` 陣列）；有 error 結束碼 1；`--all` 沒有檔案時以 0 結束（CI） |
| `tools/text_metrics.py` | `FILE…`／`--write FILE…`／`--json`／`--text "…" --section word_bank --tier advanced` | SPEC §3.4 的指標與是否在帶內；`--write` 寫回 `metrics` |
| `tools/student_view.py` | `FILE…`／`--out-dir DIR FILE…`／`--grading FILE…` | 學生畫面資料（去掉答案、標註、annotations、generation、verification、難度），給盲解者；圖表另加 `chart_text`、`data_table`（§3.2），混合題、中譯英、作文每題加 `answer_format`；`--grading`（只用在作文）另加 `grading`：評分規準、題目步驟與兩篇範文（E1、E2，§5.6） |
| `tools/record_verification.py` | `FILE --blind-a A --blind-b B --audit AUDIT [--extra X…] [--dry-run] [--json]` | 寫入 program／blind_solver／distractor_audit／unique_solution（＋similarity／fact_check），判定 status；混合題的多選、填充、簡答見 §5.1；中譯英、作文不給 `--audit`，盲譯／盲評見 §5.5、§5.6 |
| `tools/make_lots.py` | （無參數）／`--sections reading,mixed`／`--seq 02`／`--dry-run`／`--force`；第 2 批起 `--topics data/bank/topic-plan.json`／`--avoid-existing-bank`／`--check-topics`（§9） | 產生批次規格（已存在的檔案略過）；`--check-topics` 只檢查主題總表 |
| `tools/make_writing_lots.py` | （無參數）／`--sections translation`／`--tiers basic`／`--dry-run`／`--force`／`--check-topics`／`--plan FILE` | 依 `topic-plan-writing.json` 產生中譯英、作文的批次規格（§7.1；已存在的檔案略過） |

**文章指標的算法**：去掉 `<b>`／`<u>` 與 `[[n]]` 後斷詞（和 `tools/exam_stats.py` 相同，所以能和歷屆選文比）；詞形還原用
`data/vocab/forms-index.json`，規則衍生的 -ly 副詞沿用形容詞級別；專有名詞（句中大寫且不在詞表，或句首大寫但文中別處也以大寫出現在句中、
全大寫縮寫）與數字（含拼出來的基數、序數詞）不算分母。字數不含空格的正解與篇章結構被挖掉的句子（歷屆統計也這樣算）。

**帶**：檔案的 `generation.lot` 對得到批次規格時，用批次規格的 `passage_band`（SPEC §3.4 疊上出題規格書的 `passage_overrides`，
疊了哪些寫在 `basis`；原本的 SPEC 帶保留在 `spec_3_4`）；否則用 SPEC §3.4。詞彙題沒有選文，不比對帶。
閱讀與混合題同一套方法：閱讀的 `passage_overrides` 給的是區間（`words`、`cov_L1_4`、`cov_L1_6`、`offlist`、`beyond_l4_ratio`、
`mean_sent_len`），整段取代 SPEC 的帶（`mean_sent_len` 取代 `avg_sentence_length`）；混合題給 `words` 與上限 `beyond_l4_max`。
出題規格書 warning 級的篇章指標（段落數、句數、最長句、FK、長字比例、相異 L5–6 詞目數）放在 `passage_band.advisory`，不檢查。
混合題的字數是引言加各段合計（SPEC §3.4「多文本合計」）；圖表的文字不算進選文。

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

**閱讀**的格式和詞彙、綜合相同（`answer` 是選項代號，不寫 `feasible`）；引用圖表時逐字引用學生畫面資料 `chart_text` 的一行或 `data_table` 的一列
（儲存格以 ` | ` 相接）。**混合題**依作答模式（學生畫面資料每題的 `answer_format` 也會寫）：

```jsonc
"answers": {
  "1": { "answer": "turns", "confidence": "high", "also_plausible": ["makes"],      // 填充、簡答：字串；also_plausible 是其他也說得通的寫法
         "evidence": ["Third, we turn food that is getting old into something new."], "explanation_zh": "…" },
  "3": { "answer": ["A", "D"], "confidence": "high", "also_plausible": [],          // 多選：選項代號陣列；also_plausible＝「可能也對」的選項
         "evidence": ["…"], "explanation_zh": "…",
         "option_evidence": { "A": ["逐字證據句"], "D": ["逐字證據句"] } }           // 多選選填：每個選項的證據（超越頂標的 E2 正解要有）
}
```

- 多選（SPEC §5.6）：`answer` 與標準答案逐一比對每個選項（選了不該選、漏選都算錯；順序不拘），`also_plausible` 必須是空陣列。
  超越頂標標 `E2` 的正解，兩位盲解者在 `option_evidence` 引用的證據句要有交集（出題規格書 MIX-MUL-03），否則兩份盲解都判 fail。
- 填充、簡答：`answer` 正規化後（SPEC §4.6）要在 `accepted_answers` 內；`also_plausible` 列的每個寫法也都要在 `accepted_answers` 內，
  否則是「可接受答案清單不完整」，退回補清單或改寫題目（MIX-FIL-07）。
- 只多了選填的 `option_evidence`（只在多選題允許）；其他欄位與規則不變。

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

每一題的每個錯誤選項都要判定（詞彙、綜合、閱讀：3 個；篇章結構：4 個，含多餘句；文意選填：9 個，缺的只列 warn，至少要判詞性相容的選項；
混合題：只有多選題，判所有不是正解的選項，填充與簡答不列）。正解不要出現在 `items` 裡（多選題的每個正解都不要列）。

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

### 5.5 中譯英盲譯（`gsat-bank-blind-translation/v1`，A、B 各一份）

SPEC §5.7：另一個代理從中文自行翻譯，要自然用到同一個句型與標的詞彙（代表中文題目沒有歧義），並檢查參考譯文沒有錯、4 個部分切得公平。
盲譯者分兩階段寫同一個檔案：**先**只看 `student_view.py` 的學生畫面資料（只有中文題目；標的詞彙、句型、參考譯文都不在裡面）寫 `answers`，
**寫完才**打開題組檔的 `annotations.rubric` 寫 `review`。

```jsonc
{
  "schema": "gsat-bank-blind-translation/v1",
  "uid": "ai.tr.0b1c2d", "version": 1, "solver": "A", "reviewer": "claude-opus-5-5",
  "session_id": "session_…", "created_at": "2026-10-20T08:00:00Z",   // 選填
  "answers": {                                   // 第一階段（盲譯）：每句都要有
    "1": { "translation": "In recent years, many students have started to bring …", "confidence": "high",
           "explanation_zh": "翻譯時的判斷（例如為什麼用完成式）" } },
  "review": {                                    // 第二階段（對答案）：每句都要有
    "1": { "used_patterns": ["PERF"],            // 自己的譯文用到了這一句的哪些標的句型（rubric 的 code）
           "used_target_words": ["recent", "start", "bring", "bottle"],   // 用到了哪些標的詞彙（rubric 的 word）
           "within_accepted": true,              // 自己的譯文是否落在可接受寫法內（參考譯文＋各部分 accepted）
           "closest_reference": 0,               // 選填：最接近的參考譯文索引
           "reference_check": "pass",            // 參考譯文有沒有錯：pass／warn／fail
           "parts_check": "pass",                // 4 部分切得公不公平：pass／warn／fail
           "issues_zh": [] } }                   // 不是 pass 時寫原因
}
```

`record_verification.py` 的判定（每句）：信心至少 medium；**程式在盲譯裡找標的詞彙，命中 ≥80%**（出題規格書 WRT-TRN-KEY-02；詞形變化與
`alternatives` 都算）；`used_patterns` 要包含這一句**全部**的標的句型（沒自然用到＝中文題目沒有引出句型，fail）；`within_accepted` 是 false →
fail（參考譯文或評分規準太窄，或中文有歧義）；`reference_check`／`parts_check` 是 fail → fail、warn → 這份結果是 warn；不是 pass 時 `issues_zh`
不可空。驗證者說用了某個標的詞彙或句型、程式卻在譯文裡比對不到時列 warn。寫進題組檔的是 `blind_solver`，`details` 多了
`task: "blind_translation"`、`review`、`checks`（每句命中的標的詞彙與比例、句構比對、譯文是否和某個可接受整句完全相同 `program_match`）。

### 5.6 作文盲評（`gsat-bank-blind-grading/v1`，A、B 各一份）

SPEC §5.7：另一個代理依評分指標給分，穩健版落在 14–17、頂標版 18–20。盲評者只看 `student_view.py --grading` 的輸出（題目、圖、本站評分規準、
題目的內容步驟與兩篇範文）。範文以中性代號 **E1、E2** 呈現，順序依 uid 決定（`student_view.grading_order`），不標穩健版或頂標版，也看不到註解與
本站的目標分數。

```jsonc
{
  "schema": "gsat-bank-blind-grading/v1",
  "uid": "ai.cp.0e1f2a", "version": 1, "solver": "A", "reviewer": "claude-opus-5-5",
  "session_id": "session_…", "created_at": "…",                        // 選填
  "essays": {                                    // E1、E2 都要評
    "E1": { "scores": { "content": 4, "organization": 4, "grammar": 4, "vocabulary": 3 },   // 各 0–5 的整數
            "off_topic": false,                  // 是否離題
            "covers_all_tasks": true,            // 是否回應題目每一項要求
            "errors": [],                        // 語言錯誤：{ "excerpt": "逐字引文", "explanation_zh": "…", "suggestion": "…" }（範文要 0 錯）
            "comment_zh": "簡短評語" },
    "E2": { … } },
  "prompt_check": "pass",                        // 題目本身清不清楚、合不合難度：pass／warn／fail
  "issues_zh": []                                // prompt_check 不是 pass 時寫原因
}
```

`record_verification.py` 把 E1、E2 換回 steady／top，判定：四項加總穩健版 14–17、頂標版 18–20；`off_topic` false、`covers_all_tasks` true、
`errors` 空（有錯就退回改範文；引文要逐字在範文裡）；`prompt_check` fail → fail、warn → warn；兩位盲評者對同一篇的總分差 >2 分時兩份都 fail
（出題規格書 WRT-MOD-SCR-01）。寫進題組檔的 `blind_solver` 的 `details` 是 `task: "blind_grading"`、`order`（E1／E2 對應的版本）、
`essays`（以 steady／top 為鍵，含原本的 id）、`totals`、`prompt_check`、`issues_zh`、`problems`。

## 6. 判定規則（SPEC §5.6、§5.7）

**唯一正解**（文意選填、篇章結構）：把兩位盲解者每格的 `feasible` 取聯集，寫成 `annotations.elimination.feasible`；
算「每格各放一個不同選項」的填法數（文意選填用子集合動態規劃，2¹⁰ 個狀態），寫成 `perfect_matchings`。
必須**剛好 1 種，而且就是標準答案**；篇章結構的多餘句在每一格都不可行。

**verified** 要同時滿足：

1. `program` 沒有 error（warning 可以，但 SPEC §5.8：任何 warn 都進 100% 人工審核）。
2. 兩位盲解者每一題都答對、信心至少 `medium`、`also_plausible` 為空、證據句逐字找得到；文意選填、篇章結構每格都有 `feasible`。
   混合題：多選每個選項的判斷都和標準答案一致、沒有「可能也對」；填充、簡答的答案與 `also_plausible` 都在 `accepted_answers` 內（§5.1）。
3. 稽核沒有任何 `arguably_acceptable`，證據句逐字找得到，該判的選項都判了。
4. `unique_solution` 通過（適用者）。
5. `--extra` 傳入的 similarity／fact_check 沒有 fail。

任何一項 fail → **rejected**，`status_reason` 列出原因（每項最多 3 條）。必要的輸入不齊（缺盲解 A／B 或稽核）時維持 **draft**、不判定。
結束碼：0 verified、1 rejected、2 輸入檔錯誤、3 輸入不齊。

**中譯英、作文**：`program` 沒有 error，而且兩位驗證者（盲譯 §5.5／盲評 §5.6）都通過（warn 也算通過）→ **verified**；沒有干擾選項稽核與
唯一正解檢查（給 `--audit` 是輸入錯誤，結束碼 2）；缺 A 或 B 時維持 draft（結束碼 3）。`validate_bank.py` 對 verified 的中譯英、作文只要求
program 1 筆、blind_solver 2 筆通過。

## 7. 批次規格（lots）

`tools/make_lots.py` 依 ROADMAP §9.2 產生第一批 18 個檔案（前四種題型 12 個，閱讀、混合題 6 個；已存在的檔案略過）：

| 題型 | 每個難度的組數 × 每組題數 | 答案字母分布 | 唯一正解檢查 |
|---|---|---|---|
| 詞彙題 | 5 × 10 | 每個字母 20–30% | — |
| 綜合測驗 | 8 × 5 | 每個字母 20–30% | — |
| 文意選填 | 5 × 10 | 不適用（每個選項用一次） | 有 |
| 篇章結構 | 5 × 4 | 不適用 | 有 |
| 閱讀 | 8 × 4（長文 4、圖表 2、表格 1、多文本 1） | 每個字母 20–30% | — |
| 混合題 | 4 × 4 子題（雙文本 2、多則短段落 2） | 多選正解字母各 ≤30%（warning） | —（多選另有 SPEC §5.6 的盲解一致檢查） |

每個檔案的欄位：`lot`、`section_type`、`tier`、`count`、`questions_per_group`、`format_version`、`uid_prefix`、`path`、
`spec_id`／`spec_file`／`spec_tier_key`／`spec_status`（出題規格書）、`topic_quota`（08 §6.1：每 8 組「起源與演變 3、科普與健康 2–3、
文化與歷史 2、社會與議題 1」依組數等比例取整；詞彙題不設）、`answer_letter_share`、`avoid`（gsat-111～115 與 ref-115 同一大題的正解字、
正解句與主題）、`passage_band`、`item_rules`（SPEC §3.5）、`targets`（出題規格書該難度的配方：考點配比、誘答規則、常見錯誤）、
`set_composition`（一組內各難度格數）、`verification`（盲解人數、稽核、唯一正解、人工審核比例）。

閱讀、混合題的批次規格另外有（`build_reading_mixed`）：

| 欄位 | 內容 |
|---|---|
| `form_quota` | 閱讀 `{continuous: 4, chart: 2, table: 1, multi_text: 1}`（計數方式 §3.1，`validate_bank.reading_form`）；混合題 `{two_texts: 2, entries: 2}`（`passage_parts` 2 篇／3 則以上）。`--lot` 在整批齊了以後，閱讀不符是 error、混合題是 warning |
| `sdg_quota` | `focus_sdgs` [3, 12, 14, 15]、`min_groups_with_focus_sdg`（閱讀 1：每批至少 1 篇 SDG 3／12／14／15 的具體事件切入；混合題 0）、`min_share_with_any_sdg` 0.5（RD-SDG-01，warning） |
| `format` | 混合題的子題格式（出題規格書 `format.sub_items`）：題號、作答模式、配分、多選可用的選項數（6／8／10 與 SPEC §3.5 的交集）、正解數、簡答字數、題幹標示用語 |
| `multi_select_key_letter_share_max` | 混合題 0.3（MIX-MUL-04） |
| `avoid` | 閱讀：近期正解選項句（`answer_sentences`）與主題；混合題：近期填充、簡答的答案（`answer_words`，單字取主形；`--lot` 撞到列 warning）與主題 |
| `passage_band` | 見 §4「帶」；另有 `advisory`（不檢查的篇章指標）、`genre_allowed`、`text_format_allowed`、`structure`（混合題的選文結構） |
| `targets` | 出題規格書該難度的配方（題型配比、證據規則、正解改寫、誘答碼、作法、常見錯誤；去掉 `*_current` 這類觀察值） |
| `materials` | 事實單、白名單、圖表格式的位置，`derivation`、`attribution_text` |

### 7.1 中譯英、作文（`tools/make_writing_lots.py`）

站主要求**中譯英每個難度 100 句（50 組×2 句）、作文每個難度 10 題**（ROADMAP §9.2 原訂 10 組、4 題，依站主要求放大）。
`tools/make_writing_lots.py` 依主題總表 `topic-plan-writing.json` 產生 18 個檔案（`make_lots.py` 另有工作線在改，兩支寫的檔名不重疊）：

| 題型 | 批次 | 每批 | 每個難度合計 |
|---|---|---|---|
| 中譯英 | `translation-{basic,advanced,top}-{01..05}`（15 批） | 10 組 × 2 句 | 50 組＝100 句 |
| 作文 | `composition-{basic,advanced,top}-01`（3 批） | 10 題（每題穩健版＋頂標版範文） | 10 題 |

- **主題總表** `topic-plan-writing.json`（`gsat-bank-topic-plan-writing/v1`）：`lots`（批次與組數）、`topics`（每組一個主題：`id`、`lot`、`slot`、
  `domain_zh`、`topic_zh`、`angle_en`、`keywords`；作文另有 `prompt_type`、`essay_type`、`figures_hint_zh`、`moves`）。
  `--check-topics` 檢查：每批的 slot 齊全、每個難度的組數（中譯英 50、作文 10）、主題不重複、關鍵字不和 `topic-plan.json`（其他題型的主題與
  `used_concepts`）、`data/bank/v1` 已用過的主題、歷屆中譯英與作文的主題撞題（近期學測 111–115 與參考試卷是 error，其他歷屆題 warning）。
- **中譯英批次規格**的欄位（共同欄位同 §7）：`topics`、`pattern_plan`（每組兩句各自的標的句型：code、grammar_id、label_zh、frame；
  穩定基礎每句 1 個、進階 2 個、超越頂標 2 個且每組至少 1 個指定句型；`restructuring_hint` 標出適合改寫句構的組）、`pattern_coverage`
  （這一批要涵蓋的句型 id 與句構次數：依歷屆 119 句的句構次數等比例分配，同一難度各批輪流用不同句型；整體涵蓋 grammar-patterns.json 裡
  歷屆出現 ≥2 次的全部中譯英句型）、`avoid`（近期學測與參考試卷的中文題目與主題；D8 規則）、`item_rules`（SPEC §3.5）、`targets`／`design`
  （出題規格書該難度的參數、誘錯規則、配方、常見錯誤）、`format`（格式重點與範例檔）、`verification`（盲譯 2 位、命中率 0.8、不做干擾稽核）。
- **作文批次規格**的欄位：`topics`、`prompt_type_quota`（basic 圖片描述 10；advanced 圖片議題 10；top 圖表 4、多圖比較 4、社會現象 2）、
  `prompt_rules`（提示寫法、圖與 SVG、字數與步驟數、課綱）、`scaffold`（各難度的鷹架規則）、`model_texts`（穩健版 14–17、頂標版 18–20 與
  出題規格書的範文參數）、`rubric_template`（四項分數帶的本站文字，出題者照抄、另寫每題的 focus_zh）、`avoid`（近期作文主題與第二段任務）、
  `item_rules`、`targets`、`verification`（盲評 2 位、兩位差 ≤2）。
- `--lot` 整批檢查（`validate_bank.py`）：組數、每組題數、主題不重複且照批次規格的 `topic_zh`；中譯英另查中文題目重複與 `pattern_coverage`
  （整批齊了以後沒涵蓋是 error）；作文另查題型配額（整批齊了以後不符是 error）與第二段任務組合重複 4 次以上（warning）。答案字母分布不適用。

## 8. 事實單與來源白名單

### 8.1 事實單 `facts/{id}.json`（`gsat-bank-facts/v1`）

SPEC §5.2 步驟 2：**只有事實、沒有原句**（數字、日期、因果、人名地名），每條事實附來源；圖表資料存原始資料與出處。
生成者只拿到事實單（不給來源原文），所以事實要用自己的話寫、一條寫一件事。型別見 bank.ts 的 `FactSheet`。

```jsonc
{
  "schema": "gsat-bank-facts/v1",
  "id": "sdg3-0001",                       // 等於檔名；小寫英數字與連字號；題組以 fact:sdg3-0001 引用
  "title": "Under-five mortality, 1990–2020 and SDG target 3.2",
  "sdgs": [3],                             // 選填
  "created_on": "2026-10-09",
  "created_by": "claude-opus-5-5",         // 整理者：模型 ID 或 admin:{users.id}
  "sources": [                             // 至少 1 個；每個都要被事實或資料集引用（沒引用列 warning）
    { "id": "s1", "publisher": "World Bank", "title": "World Development Indicators: Mortality rate, under-5 (SH.DYN.MORT)",
      "url": "https://data.worldbank.org/indicator/SH.DYN.MORT", "accessed": "2026-10-09",
      "license": "CC-BY-4.0",              // adaptable_text、dataset：必須是白名單列的授權；fact_only：照實記錄原站授權（例如 UN terms of use）
      "use": "dataset",                    // fact_only｜adaptable_text｜dataset（§8.2）
      "note": "原始提供者：UN IGME" },     // 選填
    { "id": "s2", "publisher": "United Nations", "title": "Goal 3", "url": "https://sdgs.un.org/goals/goal3",
      "accessed": "2026-10-09", "license": "UN terms of use", "use": "fact_only" }
  ],
  "facts": [                               // 事實與資料集至少要有一種
    { "id": "f1", "text": "Under SDG target 3.2, every country should cut its under-5 death rate to 25 or fewer per 1,000 live births by 2030.",
      "source_ids": ["s2"],                // 至少 1 個，都要在 sources
      "kind": "number" }                   // 選填：number／date／cause_effect／person／place／event／definition／other；另可寫 note
  ],
  "datasets": [                            // 選填：圖表的原始資料（來源的 use 必須是 dataset）；格式同 chart 的 categories／series
    { "id": "d1", "source_id": "s1", "title": "Mortality rate, under-5 (per 1,000 live births)", "indicator": "SH.DYN.MORT",
      "unit": "per 1,000 live births", "categories": ["1990", "2000", "2010", "2020"],
      "series": [ { "name": "World", "values": [93.5, 76.7, 50.6, 39.2] } ], "note": null }
  ],
  "notes": null                            // 選填
}
```

檢查（`python3 tools/validate_bank.py --facts …`）：欄位齊全、沒有未知欄位；`id` 等於檔名；日期是 YYYY-MM-DD；來源 id、事實與資料集 id 不重複；
`source_ids`、`source_id` 都對得到；每個來源依 §8.2 的白名單判定（網域、用途、授權）；資料集的 `values` 都是數字且長度等於 `categories`。
事實文字有引號（像是原句引用）或超過 60 字列 warning。題組引用的事實單有 error 時，題組本身也是 error。

### 8.2 來源白名單 `sources-whitelist.json`（`gsat-bank-sources-whitelist/v1`）

依 SPEC §5.3（與 04 §0、§7.1、§7.4）：

| 用途 `use` | 可以用的來源（`allow`） |
|---|---|
| `adaptable_text`（標示出處並註明修改） | Global Voices（CC BY 3.0；合作媒體轉載稿除外，用到時列 warning 提醒逐篇確認）、Frontiers for Young Minds（kids.frontiersin.org，CC BY 4.0）、PLOS（CC BY） |
| `dataset`（圖由前端自己繪製） | Our World in Data（CC BY 4.0）、World Bank（CC BY 4.0）、政府資料開放平臺 data.gov.tw（政府資料開放授權條款第1版，`OGDL-Taiwan-1.0`） |
| `fact_only`（只取事實） | 上面全部，加上聯合國與其機構（含 WHO）、各國政府（gov.tw、gov、gov.uk、europa.eu…）、研究機構與大學、主要新聞媒體、期刊——列網域 |

- **比對**：網址主機等於 `domains` 的某個網域或是它的子網域（`match: "domain"`）；`match: "host"` 只比對列出的主機（UNESCO、Project Gutenberg 主站）。
  先看 `deny`：網域與用途都對上（`uses` 含 `"*"` 表示任何用途）就不能用；再看 `allow`：取網域最長（最具體）的一筆，用途要在 `uses` 內，
  `adaptable_text`、`dataset` 的 `license` 要在 `licenses` 內。
- **禁止清單**（SPEC §5.3 最後一點，全部照列成 `deny`）：Guardian（任何內容都不交給 Claude，含只取事實）、Cambridge、Oxford、UNESCO 主站、
  Project Gutenberg 主站（不爬、不建立內容資料庫）；The Conversation、OWID 文章、WHO 出版品、UN 網站文章、VOA Learning English 不改寫（只取事實）；
  Global Voices 合作媒體轉載稿不當 CC BY；mdbg.net（CC-CEDICT）不自動下載。介面規則（不用 iframe 嵌入 Cambridge、不顯示 Lexile／Collins／Oxford 3000
  等品牌指標、不用「大考中心」「CEEC」命名）以 `scope: "interface"` 記錄，不比對網址。
- 新增來源：先確認授權，再在 `allow` 加一筆（`id`、`publisher`、`match`、`domains`、`uses`、`licenses`、`conditions_zh`、`basis`）；改動白名單要開 PR 讓站主看。

### 8.3 範例

`tools/tests/data/` 有一組走完全流程的範例（只給單元測試用，不在 `data/bank/v1`、`data/bank/facts`；中譯英、作文的範例見 `tools/tests/test_writing.py`：
`ai.tr.0b1c2d@1.json`＋`tr-blind-*.json`、`ai.cp.0e1f2a@1.json`＋`cp-grade-*.json`）：圖表閱讀‧穩定基礎
`ai.rd.0c1d2e@1.json`（World Bank WDI 五歲以下兒童死亡率，事實單 `facts/sdg3-0001.json`）、混合題‧穩定基礎 `ai.mx.0f1a2b@1.json`
（UNEP Food Waste Index Report 2024 的數字，事實單 `facts/sdg12-0001.json`），以及對應的假盲解與稽核（`rd-*.json`、`mx-*.json`）；
測試在 `tools/tests/test_reading_mixed.py`。

## 9. 第 2 批起（seq 02～）：擴充到每個難度 ≥100 小題

站主要求每個題型、每個難度至少 100 小題。第一批照 §7 的組數；第 2 批起的批次、組數與**每一組的主題**都寫在主題總表
`data/bank/topic-plan.json`，`tools/make_lots.py --topics … --avoid-existing-bank` 依它產生批次規格。第一批的批次規格（`*-01.json`）不改。

### 9.1 批次表

| 題型 | 每組小題 | 第一批（每個難度，不含 rejected） | 第 2 批起（每個難度） | 每個難度合計 |
|---|---|---|---|---|
| 詞彙題 | 10 | 5 | 02：5 組 | 10 組＝100 題 |
| 綜合測驗 | 5 | 8 | 02、03：各 6 組 | 20 組＝100 題 |
| 文意選填 | 10 | 5 | 02：5 組 | 10 組＝100 題 |
| 篇章結構 | 4 | 5 | 02–05：各 5 組 | 25 組＝100 題 |
| 閱讀 | 4 | 8（長文 4、圖表 2、表格 1、多文本 1） | 02、03：各 6 組；04：5 組（合計長文 9、圖表 4、表格 2、多文本 2） | 25 組＝100 題；形式 13：6：3：3 ≈ 4：2：1：1 |
| 混合題 | 4 | 4（雙文本 2、多則短段落 2）；advanced 目前 3 | 02、03：各 6 組；04：5 組；05：4 組（advanced 5 組）（雙文本與多則短段落約各半） | 25 組＝100 題 |

每批最多 6 組（一位出題者負擔得了）。既有組數只算 verified＋draft；第一批還沒產生的（閱讀 advanced／top、混合題 top）先以批次規格的組數計
（`topic-plan.json` 的 `counting_rule_zh`、`targets`）。混合題 advanced 第一批有 1 組 rejected（ai.mx.981e5b），所以 mixed-advanced-05 開 5 組；
那一組重生通過的話，多的 1 組當緩衝。之後第一批若又有題組 rejected 而不重生，重算 `targets`，從 `reserve_topics` 取主題開新批號（已開始生成的批次規格不改）。

### 9.2 主題總表 `topic-plan.json`（`gsat-bank-topic-plan/v1`）

| 欄位 | 內容 |
|---|---|
| `lots[]` | 每一批：`lot`、`section`、`tier`、`seq`、`count`；閱讀、混合題另有 `forms`（文本形式分配） |
| `topics[]` | 每組一個主題：`id`（例如 `cz-b02-3`＝綜合測驗‧basic‧02 批第 3 組）、`lot`、`slot`（第幾組）、`category`（08 §6.1 四類；詞彙題不設）、`domain_zh`（領域）、`topic_zh`（繁體中文主題名，題組的 `tags.topic` 逐字照抄）、`angle_en`（英文切入角度）、`keywords`（撞題比對用的英文關鍵字片語）、`sdgs`；閱讀、混合題另有 `form`、`form_hint_zh`；詞彙題沒有選文，改給 `contexts_en`（5 種題幹情境）；需要時有 `note_zh` |
| `reserve_topics[]` | 備用主題（同樣檢查過不重複、不撞題，還沒分配批次；`former_*` 記原本的位置）。搬進 `topics` 時給新的 `lot`、`slot`、`id` |
| `used_concepts[]` | 題庫已用的主題概念，人工整理成英文關鍵字（第一批閱讀、混合題的 `tags.topic` 是中文，也整理在這裡） |
| `reviewed_overlaps[]` | 人工確認不算撞題的配對：`id`、`against`（對方的主題原文或 `concept_zh`）、`note_zh` |
| `replaced_topics[]` | 換掉的主題：原主題、換成什麼、原因（換主題時 `id` 不變） |
| `used_topics_snapshot` | 規劃當下 data/bank/v1 全部題組（含 draft、rejected）的 `tags.topic`、選文第一句、批次與狀態（`generation` 沒有文字說明欄位） |
| `targets` | 每個題型 × 難度：第一批的 verified／draft／rejected、計入的既有組數、新批次與預估小題數 |

主題規則：

- 主題彼此不重複（`topic_zh`、`angle_en` 都不同，一個主題的關鍵字片語也不能全部出現在另一個主題），並避開題庫（含 draft、rejected）與
  data/exams/parsed 全部歷屆試題用過的主題。題庫裡已經重複的腳踏車、鉛筆與筆、絲路、食物浪費、光害、睡眠、電子廢棄物、眼鏡等都列在
  `used_concepts`，新主題一律避開。
- 配額照 08 §6.1、每批依組數取整（`make_lots.topic_quota`）；閱讀、混合題每批至少 1 篇 SDG 3／12／14／15 的具體事件切入，且 ≥50% 的篇有 SDG
  （第 2 批起混合題也這樣要求）。
- 題材分散在科學、自然、科技、藝術、運動、飲食、語言、心理、地理、歷史、經濟生活、環境、健康、職業、台灣與世界文化（`domain_zh`），
  適合高中生、不冷僻、不敏感。

`python3 tools/make_lots.py --check-topics` 檢查主題總表（不寫檔；有 error 結束碼 1）：

- error：lot 名稱與 `section`／`tier` 一致、`count` 等於主題數且 1–6、slot 連續、必填欄位、主題配額、SDG 配額、主題重複、
  關鍵字碰到 `used_concepts`、關鍵字片語全部出現在題庫或歷屆試題的主題、主題原文相同。
- warning：和題庫的中文主題共用兩字實詞（去掉虛詞、「由來、演變、台灣」這類框架詞與國名）；人工確認不是同一主題後記進 `reviewed_overlaps`。
- 題庫裡 `generation.lot` 等於主題所屬批次的題組就是照該主題出的，不算撞題。第一批閱讀 advanced／top、混合題 top 產生後要再跑一次。

### 9.3 產生批次規格

```bash
python3 tools/make_lots.py --check-topics                                                 # 先檢查主題總表
python3 tools/make_lots.py --topics data/bank/topic-plan.json --avoid-existing-bank         # 主題總表裡 02 以後的全部批次
python3 tools/make_lots.py --seq 02,03 --sections cloze --topics data/bank/topic-plan.json --avoid-existing-bank
```

- `--seq` 可寫逗號清單或範圍（`02-05`）；給了 `--topics` 而沒給 `--seq` 時是主題總表裡的全部批次。
- 第一批不能用 `--topics`／`--avoid-existing-bank` 重寫（結束碼 2）；已存在的檔案照舊略過（`--force` 才覆寫）。
- 不加 `--topics`／`--avoid-existing-bank` 時，輸出和以前完全相同。

第 2 批起的批次規格有 §7 的全部欄位（同一份出題規格書算出的數字），另外：

| 欄位 | 內容 |
|---|---|
| `count` | 主題總表該批的組數；`topic_quota` 依它重算；閱讀、混合題的 `form_quota` 改成主題總表的分配，`sdg_quota.min_groups_with_focus_sdg` 至少 1 |
| `assigned_topics` | 每組一個指定主題（`slot`＝第幾組；欄位同 `topics[]`，另加 `category_zh`）。`group.tags.topic` 逐字照抄 `topic_zh`；`group.tags.sdgs` 要包含指定的 `sdgs`；閱讀、混合題的文本形式照 `form` |
| `topic_plan` | 主題總表的位置與規則 |
| `avoid_bank_answers` | `--avoid-existing-bank`：產生規格當下 data/bank/v1（含 draft，不含 rejected）已用過的正解。單字取詞彙表主形（功能詞、L1 字不列），片語整串。詞彙題、綜合測驗、文意選填、混合題（填充、簡答）：`answer_words`（同題型）與 `answer_words_other_sections`（其他題型）；篇章結構、閱讀：`answer_sentences`；詞彙題、綜合測驗另有 `distractor_words`（已用過的干擾字）。`scanned_groups` 記掃描了幾組 |
| `generation_notes` | 第一批審查意見轉成的出題提醒（`GN-TOPIC`、`GN-AVOID`、`GN-DISTRACTOR`、`GN-BASIC-CONTEXT`、`GN-STRUCTURE-CLUES`），每條寫明怎麼檢查（`checked_by`） |
| `inherited_from_seq01` | 第一批規格檔有人工調整（列在 `make_lots.SEQ01_ADJUSTMENTS`、且和程式算出的不同，例如混合題 advanced／top 放寬的 `passage_band`）時沿用，並記下沿用了哪些欄位；規格書在第一批之後的審查修正不算人工調整，照新的規格書 |

近期學測的 `avoid` 照舊；`avoid_bank_answers` 是另外加的。

### 9.4 整批檢查（`validate_bank --lot`）

批次規格有 `assigned_topics`／`avoid_bank_answers`／`generation_notes` 時另做下列檢查（第一批的批次規格沒有這些欄位，結果不變）；
組數照舊比對該批的 `count`。還沒產生任何題組時只有「尚未產生完畢」的 warning。

| 項目 | error | warning |
|---|---|---|
| 指定主題（GN-TOPIC） | `assigned_topics` 數量 ≠ `count`、slot 不連續、主題名重複、同一個主題被兩組用 | `tags.topic` 對不到 `topic_zh`；`tags.sdgs` 沒包含指定的 SDG；文本形式和 `form` 不同；其他批次已用掉同一個主題 |
| 題庫已用的正解（GN-AVOID） | 詞彙題、文意選填的正解在 `answer_words`；篇章結構的正解句在 `answer_sentences` | 綜合測驗、混合題的正解在 `answer_words`；閱讀的正解句在 `answer_sentences`；正解在 `answer_words_other_sections`；和產生規格後其他批次新增的正解重複；同一個正解在本批 2 組以上 |
| 干擾字（GN-DISTRACTOR，詞彙題、綜合測驗） | 同一個干擾字出現在本批 2 組以上 | 干擾字在 `distractor_words` |
| 篇章結構線索（GN-STRUCTURE-CLUES） | 一組的線索類型（`clue_type` 歸成 7 種）少於 3 種 | 有格沒填 `clue_type`；同一種承接句型（All of this…、This＋名詞、One such…、The simplest…、For example）在本批超過 2 次 |
| basic 誘答（GN-BASIC-CONTEXT，文意選填、篇章結構） | — | verified 之後 `elimination.feasible` 不只正解的格數 < 2 |

測試在 `tools/tests/test_lots_seq02.py`。
