# 歷屆試題 JSON 格式（`gsat-exam/v1.1`）

每一份考卷（含補考、參考試卷）一個檔案：`data/exams/parsed/{id}.json`。這份格式是題庫資料庫的來源，之後會由腳本匯入 D1。

| 工具 | 用途 |
|---|---|
| `python3 tools/validate_exam.py --all` | 檢查格式；有 error 就以 1 結束（CI 必跑） |
| `python3 tools/normalize_exams.py` | 把 v1 檔案升級成 v1.1（可重跑、冪等；`--check` 只檢查不寫檔），並產生下一階段的工作清單 `data/exams/normalize-todo.json` |
| `python3 tools/exam_stats.py` | 跨年統計，輸出 `data/exams/stats/*` 與 `docs/analysis/exam-stats.md` |
| `packages/shared/src/exam.ts` | TypeScript 型別與共用小工具；`npm run test:data` 用實際 JSON 檢查型別 |

本文件以「**（v1.1 新增）**」「**（v1.1 改變）**」標出與 v1 不同的地方；完整清單見最後的〈v1.1 變更一覽〉。v1 檔案不再被接受，validator 會報 error，請先跑 `tools/normalize_exams.py`。

## 檔名與 id

| 考試 | id 規則 | 例 |
|---|---|---|
| 學測 | `gsat-{學年度}`，補考加 `-makeup` | `gsat-115`、`gsat-91-makeup` |
| 指考 | `ast-{學年度}`，補考加 `-makeup` | `ast-110`、`ast-109-makeup` |
| 參考試卷／試辦 | `ref-{學年度}`，同年多份加 `-a`、`-b` | `ref-115`、`ref-98-a` |

## 頂層

```jsonc
{
  "schema": "gsat-exam/v1.1",   // （v1.1 改變）v1 是 "gsat-exam/v1"，已不接受
  "id": "gsat-115",
  "exam": "gsat",               // gsat | ast | reference
  "year": 115,                  // 學年度（民國）
  "session": "regular",         // regular | makeup
  "title": "115學年度學科能力測驗英文考科",
  "time_minutes": 100,          // 題本沒印就填 null
  "full_score": 100,
  "sources": { /* 見下 */ },
  "parts": [ /* 選填，見下 */ ],
  "sections": [ /* 見下 */ ],
  "extraction": {
    "method": "pdftotext -layout + 人工校對",   // 用了哪些方法（含 Read 看頁面影像）
    "issues": [],               // 無法確定的地方，逐條寫清楚題號與原因
    "verified_by": null         // 查證者填 "verifier"
  }
}
```

### sources

repo 內相對路徑（`data/raw/` 不進 git，但路徑要對得上 `data/exams/manifest.json`）。

| 欄位 | 必填 | 型別 | 說明 |
|---|---|---|---|
| `paper` | ✓ | 字串 | 題本 PDF |
| `answer`、`scoring`、`stats` | ✓ | 字串陣列 | 答案檔、評分原則、統計檔（沒有就是空陣列） |
| `paper_word` | | 字串陣列 | **（v1.1 新增）** 題本 Word 版。v1 有的檔案寫成字串，統一成陣列 |
| `answer_sheet` | | 字串陣列 | **（v1.1 新增）** 答案卷／答題卷，也就是 manifest `subkind` 為 `answer_sheet*` 的檔案。v1 有的放在 `other`，統一搬到這裡 |
| `other` | | 字串陣列 | **（v1.1 新增）** 其他官方附件：封面、考試說明、試題解析 |

沒有的選填欄位直接省略，不要寫空陣列。

### parts **（v1.1 新增）**

題本的「部分」（第壹部分：選擇題…）。v1 的頂層 `parts`（部分檔案用 `name` 而不是 `title`）與 `section.part_title`、`section.part_instructions` 是同一件事的兩種寫法，v1.1 統一成頂層 `parts`，section 上的兩個欄位移除。沒有記錄就省略整個欄位。

```jsonc
"parts": [
  { "title": "第壹部分：單選題（占72分）", "points": 72, "instructions": null, "sections": ["s1", "s2", "s3", "s4"] },
  { "title": "第貳部分：非選擇題（占28分）", "points": 28, "instructions": "說明：本部分共有二大題…", "sections": ["s5", "s6"] }
]
```

| 欄位 | 型別 | 說明 |
|---|---|---|
| `title` | 字串或 null | 題本印的部分標題；解析時沒有記下就是 null |
| `points` | 數字或 null | 題本有印照印；沒印時是所屬大題 `points_total` 的加總 |
| `instructions` | 字串或 null | 部分層級的說明，逐字 |
| `sections` | 字串陣列 | 所屬大題 id，依題本順序；每個大題最多屬於一個部分 |

## section（大題）

```jsonc
{
  "id": "s1",
  "type": "vocabulary",          // 見下方 type 表
  "title": "一、詞彙題（占10分）",  // 題本原文
  "part": "選擇題",               // 題本原文的部分名稱：選擇題／混合題／非選擇題…；舊卷沒有就 null
  "instructions": "說明︰第1題至第10題為單選題，每題1分。",  // 逐字
  "points_total": 10,
  "stats": { /* 選填，見下 */ },
  "groups": [ /* 見下 */ ]
}
```

| type | 中文 | 說明 |
|---|---|---|
| `vocabulary` | 詞彙題／詞彙與慣用語／詞彙與語法 | 單句一空格 |
| `cloze` | 綜合測驗 | 短文挖空，每空各自 4 選項 |
| `word_bank` | 文意選填 | 短文挖空，共用選項庫（A–J） |
| `structure` | 篇章結構 | 短文挖空，選項是句子，共用選項庫 |
| `reading` | 閱讀測驗 | 選文＋選擇題 |
| `mixed` | 混合題 | 同一題組有兩種以上作答方式 |
| `sentence_matching` | 句子配合題／配合題 | 舊學測 |
| `short_answer` | 簡答題 | 舊學測 |
| `translation` | 中譯英／翻譯題 | |
| `composition` | 英文作文 | |
| `other` | 其他 | 例如舊卷的信函、短詩閱讀；在 `title` 寫清楚 |

### section.stats **（v1.1 新增）**

大考中心只公布非選擇題「一大題」的分數人數統計（中譯英兩小題合計、作文），拆不到小題，所以放在大題層級。v1 各檔用了 `stats` 與直接掛在 section 上的 `score_distribution` 兩種位置、十幾種欄位名稱，v1.1 統一如下（對照表見〈v1.1 變更一覽〉）：

```jsonc
"stats": {
  "source": "stats-3.xls「英文科非選擇題分數人數統計表」第一題(滿分:8分)",  // 統計檔與工作表
  "max_score": 8,          // 滿分（v1 也叫 full_marks）
  "registered": 146302,    // 報名／報考人數，含缺考（v1 也叫 examinees_registered）
  "absent": 2450,          // 缺考
  "examinees": 143852,     // 到考（v1 也叫 examinees_present）
  "rate_base": "registered",  // 比例的分母說明（v1 也叫 percent_base、score_distribution_base）
  "note": null,
  "score_distribution": [
    { "range": "8.00-8.99", "min": 8.0, "max": 8.99, "count": 2921, "rate": 0.02,
      "cumulative_count": 2921, "cumulative_rate": 0.02 }
  ]
}
```

`score_distribution` 必填、其他選填。每一列：`range`（原表字串，缺考列是 `"缺考"`）與 `count` 必填；`min`／`max` 由 `range` 解析，解析不了是 null；`rate`、`cumulative_rate` 是 0–1 的小數（v1 也叫 `percent`、`cum_percent`、`cumulative_percent`）；`cumulative_count`（v1 也叫 `cum_count`）。

## group（題組）

詞彙題這種單題形式，也包成一個 group（`passage` 為 null）。

```jsonc
{
  "id": "s2g1",
  "group_label": "第16至20題為題組",  // （v1.1 新增）選填：題本印的題組標示；題本沒印是 null
  "passage": "Text with blanks [[11]] ... [[12]] ...\nSecond paragraph ...",   // 空格一律寫成 [[題號]]；沒有選文填 null
  "passage_parts": null,         // 多文本：[{ "label": "A", "title": "...", "text": "..." }]
  "figures": [                   // 圖、表、地圖、海報；用文字完整描述，表格要轉成 rows
    { "kind": "table", "label": null, "caption": "...", "description": "...", "rows": [["Year","Sales"],["2020","12"]], "question_no": null }
  ],
  "options_bank": null,          // word_bank／structure／sentence_matching：{ "A": "...", ... }
  "questions": [ /* 見下 */ ],
  "tags": {                      // （v1.1 改變）必填：沒有選文可標（詞彙題、翻譯、作文）就填 null
    "topic": "plastic pollution",
    "genre": "expository",
    "sdgs": [12, 14],
    "text_format": "continuous"
  }
}
```

**段落（v1.1 改變）**：`passage` 與 `passage_parts[].text` 的段落之間只用一個 `"\n"`（v1 有的檔案用 `"\n\n"`），段內不換行，前後不留空白。唯一的例外是詩（`tags.genre` 為 `poem`）：行與行之間是 `"\n"`，節與節之間是 `"\n\n"`。

### figure

| 欄位 | 必填 | 說明 |
|---|---|---|
| `kind` | ✓ | 開放值域：`table`、`chart`、`map`、`poster`、`image`、`picture`、`photo`、`illustration`、`diagram`、`advertisement`、`other`… |
| `caption` | ✓ | 字串或 null |
| `description` | ✓ | 完整的文字描述 |
| `rows` | | 表格內容（字串二維陣列，第一列通常是表頭） |
| `label` | | **（v1.1 新增）** 題本上對這張圖的標示或指稱，例如「連環圖片第1幅」「the following diagram（第50題）」 |
| `question_no` | | **（v1.1 新增）** 圖只屬於某一小題時的題號（例如選項是圖片的那一題）；必須是本題組小題的題號 |

## question（小題）

```jsonc
{
  "no": 11,                      // 題號（整數）；混合題的 47A 這種寫 no: 47, label: "47A"；編號規則見下
  "label": "11",
  "mode": "single_choice",       // single_choice | multi_select | bank_choice | fill_in_blank | short_answer | table_completion | translation | composition
  "stem": "The mayor has such a ______ schedule ...",   // 題幹逐字；克漏字類沒有題幹就填 null
  "options": { "A": "hasty", "B": "tight", "C": "diligent", "D": "routine" },  // 用 options_bank 的題目填 null
  "answer": "B",                 // 單選：字母；多選：["C","D"]；填充／簡答：官方參考答案字串；翻譯：官方參考譯文（沒公布填 null）；作文：null
  "accepted_answers": null,      // 評分原則列出的其他可接受答案
  "points": 1,
  "stats": { /* 見下 */ },
  "scoring_notes": null,         // 非選擇題：評分原則中與本題相關的逐字內容
  "tags": { }                    // 見「標註」

  // 以下是 v1.1 新增的選填欄位，不適用就省略
  // "refers_to": { "text": "it", "occurrence": 3, "note": null },
  // "scoring_exception": { "type": "all_credit", "note": "..." },
  // "reused_from": { "exam": "gsat-111", "no": 1, "modified": null },
  // "answer_segments": [["..."]], "answer_variants": ["..."], "answer_is_composite": true,   // 只有翻譯題
  // "answer_table": [["", "nutrient(s)"], ["kale", "iron and vitamins"]]                   // 只有表格填寫題
}
```

### 編號規則 **（v1.1 改變）**

- 選擇題與混合題用題本印的題號，整份考卷連續（從 1 開始、不可跳號）。混合題的子題（47A、47B）共用 `no`，label 寫成「題號＋大寫字母」，而且必須在同一個題組；其他情況的重複題號都是 error。
- 題本分部分重新編號時（例如 gsat-83 第二部分的文意選填又從 1 編起），這一段另外計算連續性：條件是該大題第一題是 1，且 `section.part` 與前一個大題不同。
- **翻譯與作文的 `no` 一律用大題內序號**（中譯英 1、2…；作文 1），不再接續選擇題題號（v1 的 gsat-93～99 用 56–59）。簡答題（`short_answer`），以及只有非選擇作答的 `other` 大題（例如 gsat-87 短詩閱讀）也一樣各自從 1 編號。validator 檢查卷內連續時只看其他大題，不再對這些題號重複發 warning。
- 翻譯與作文的 `label` 用題本印的大題名稱：大題標題去掉序號與配分，翻譯再去掉結尾的「題」，後面接子題號，例如「一、中譯英（占8分）」→「中譯英1」、「一、翻譯題(8%)」→「翻譯1」、「一、英文翻譯(8%)」的 (a)(b) →「英文翻譯(a)」；作文就是大題名稱本身，例如「英文作文」（gsat-85 題本印「作文」）。
- `label` 在整份考卷內不可重複。

### stats（小題統計）

大考中心統計，有才填，數值一律是 0–1 的小數（百分比要除以 100），全部選填。

| 欄位 | 說明 |
|---|---|
| `correct_rate`、`high_group`、`low_group` | 答對率、高分組／低分組通過率 |
| `discrimination` | 鑑別度（-1–1） |
| `option_rates` | 全體各選項選答比例 `{ "A": 0.05, ... }` |
| `option_rates_high`、`option_rates_low` | **（v1.1 新增）** 高分組、低分組各選項選答比例 |
| `omit_rate` | **（v1.1 新增）** 未作答比例（v1 有的檔案叫 `no_answer_rate`，已改名） |
| `full_correct_rate` | **（v1.1 新增）** 多選題全對比例 |
| `five_groups` | **（v1.1 新增）** 五等分組通過率，固定 5 個數字，由高分組到低分組 |

### reused_from **（v1.1 新增）**

參考試卷沿用歷屆試題時的出處：`{ "exam": "gsat-111", "no": 1, "modified": null }`。

- `exam`：原卷 id（不可是自己）。
- `no`：原卷「同類大題」中的題號，依 v1.1 編號規則（作文是 1；v1 的作文寫 null，已改成 1）。validator 會到原卷找同一種 type 的大題裡有沒有這一題。
- `modified`：與原題的差異說明；逐字相同是 null（v1 省略這個欄位的，補成 null）。

`tools/exam_stats.py` 把帶 `reused_from` 的題目排除在統計外（參考試卷本來就整份不計）。

### scoring_exception **（v1.1 新增）**

計分例外：`{ "type": "all_credit" | "multiple_correct" | "other", "note": "..." }`。

| type | 意思 |
|---|---|
| `all_credit` | 送分（所有考生都給分，不論作答內容） |
| `multiple_correct` | 官方公告多個答案皆給分；其他也給分的答案列在 `accepted_answers` |
| `other` | 其他例外，`note` 必須說明 |

`note` 選填（字串或 null），寫官方公告原文或出處。

### refers_to **（v1.1 新增）**

題目指涉選文中某個特定字詞或行號時（「第三段粗體的 it」「line 5」「the word *mourned*」），標出被指涉的字串，讓前端可以高亮：`{ "text": "it", "occurrence": 3, "note": null }`。

- `text`：選文原文中的字串（不含強調標記、前後不留空白）。
- `occurrence`：在「題組選文」中第幾次出現，從 1 起算。題組選文＝`passage` 接著各 `passage_parts[].text`，以換行相接，再去掉 `<u>`／`<b>` 標記。
- 計數規則：`text` 以英數字開頭（結尾）時，前（後）一個字元不可是英數字——找 `it` 不會算到 `with` 裡的 it。TypeScript 端的 `findOccurrences()`、`locateRefersTo()` 與 validator 用同一個定義。
- `note` 選填，例如「原卷粗體」「line 5 指題本排版行數」。

### 中譯英：answer_segments／answer_variants／answer_is_composite **（v1.1 新增）**

這三個欄位只能用在 `mode` 為 `translation` 的題目。

- `answer_segments`：官方大括號／樹狀圖譯法的結構化寫法。陣列中每一段是「可替換寫法」的陣列，空字串代表這一段可省略；依序各取一個寫法串接即為一個可接受的譯文。每段至少要有一個非空寫法、寫法不重複、前後不留空白。
  - 串接規則：略過空字串、以一個空格相接、`, . ; : ? !` 前不留空格（`joinAnswerSegments()`）。標點可以是獨立一段，也可以黏在前一段的寫法上（例如 `"today."`）。
  - 例：`[["High"], ["house", "housing"], ["prices in"], ["urban areas", "city areas"], ["have"], ["produced", "created", "resulted in"], ["serious", "severe"], ["effects", "impacts", "influences"], ["on", "in"], ["", "the"], ["society."]]`
- `answer_variants`：完整句子的陣列。官方答案有跨段相依時（例如主詞單複數連動、平行結構的兩組括號要同時換）用這個列出所有可接受的整句，此時 `answer_segments` 可以省略。
- `answer_is_composite`：`true` 表示 `answer` 是由樹狀圖各段第一個選項組成，不是官方印出的整句。有 `answer_segments` 時，validator 會檢查 `answer` 等於各段第一個寫法串接的結果。

### answer_table **（v1.1 新增）**

表格填寫題（`mode` 為 `table_completion`）的完整答案表，字串二維陣列，第一列為表頭，與題組 `figures` 中的作答表格對應。

## 標註（tags）

解析時一併標上，不確定就省略該欄，不要猜。**（v1.1 改變）** 所有列舉都是封閉集合，不在集合內是 error；小題 tags 只能用下表中所屬大題允許的欄位，其他欄位（包括 v1 的 `word_requirement`）是 error。

| 大題 type | 允許的小題 tags |
|---|---|
| `vocabulary`、`cloze`、`word_bank`、`sentence_matching` | `test_point`、`answer_pos`、`answer_function`、`grammar_point`、`grammar_point_raw`、`key_phrase` |
| `structure` | `clue`、`clue_raw`、`key_phrase` |
| `reading`、`mixed`、`short_answer`、`other` | `item_type`、`item_type_raw`、`key_phrase` |
| `translation` | `patterns`、`topic` |
| `composition` | `essay_type`、`paragraphs`、`word_count`、`word_requirement_raw`、`topic` |

`*_raw` 欄位（**v1.1 新增**）保存被正規化改掉之前的原值，只有真的改了才會出現；有 `*_raw` 就一定有對應的正式欄位。

### 選擇題共通（vocabulary／cloze／word_bank／sentence_matching）

| 欄位 | 值 |
|---|---|
| `test_point` | `word_meaning` 詞義、`collocation` 搭配詞、`phrase` 片語／慣用語、`connective` 轉折詞／連接詞、`grammar` 文法、`word_form` 詞性／字形、`discourse` 上下文邏輯 |
| `answer_pos` | `noun`、`verb`、`adjective`、`adverb`、`preposition`、`conjunction`、`pronoun`、`phrase`、`clause` |
| `answer_function` | **（v1.1 新增）** `answer_pos` 為 `phrase` 時，片語原本的功能詞性：`noun`、`verb`、`adjective`、`adverb`、`preposition`、`conjunction`、`pronoun` |
| `grammar_point` | `test_point` 是 grammar 時填。**（v1.1 改變）** 封閉集合，見下 |
| `key_phrase` | 答案涉及的片語或搭配，例如 `"elbow one's way"` |

**answer_pos 的片語規則（v1.1 新增）**：vocabulary／cloze／word_bank 的答案若是兩個字以上（以空白分詞），`answer_pos` 一律是 `phrase`；整句或子句保留 `clause`。原本標的功能詞性（`preposition`、`conjunction`、`verb`…）移到 `answer_function`。一個字的答案不應標 `phrase`／`clause`（validator 發 warning）。

**grammar_point（v1.1 改變：封閉集合）**：`tense`、`passive`、`participle`、`relative_clause`、`noun_clause`、`adverb_clause`、`conditional`、`subjunctive`、`inversion`、`comparison`、`infinitive_gerund`、`modal`、`agreement`、`pronoun`、`determiner`、`article`、`preposition`、`conjunction`、`parallel_structure`、`with_construction`、`causative`、`emphasis`、`existential`、`substitution`、`degree`、`other`。

v1 的其他寫法已對應如下，原值保留在 `grammar_point_raw`：

| v1 原值 | v1.1 |
|---|---|
| `modal_perfect` | `modal` |
| `with_absolute_construction` | `with_construction` |
| `parallelism` | `parallel_structure` |
| `there_be`、`existential_there` | `existential` |
| `emphatic_do` | `emphasis` |
| `dummy_it` | `pronoun` |
| `auxiliary_substitution` | `substitution` |
| `concessive_clause` | `adverb_clause` |
| `not_until` | `inversion` |
| `enough_to`、`degree_adverb` | `degree` |
| `correlative_conjunction` | `conjunction` |
| `indirect_question` | `noun_clause` |

### 閱讀、混合、簡答題

| 欄位 | 值 |
|---|---|
| `item_type` | `main_idea`、`detail`、`inference`、`vocab_in_context`、`reference`、`purpose`、`tone_attitude`、`structure`、`chart_reading`、`sequencing`、`title`、`not_mentioned`、`application`、`synthesis` |

**item_type 規則（v1.1 新增）**，被改掉的原值保留在 `item_type_raw`：

1. `reading`、`mixed` 大題的題幹含大寫 `NOT` 或 `EXCEPT` 的，一律是 `not_mentioned`。
2. 需要讀圖、表、地圖、照片才能作答的，一律是 `chart_reading`。normalize 腳本只改「確定」的：圖表的 `question_no` 或 caption／label／description 寫明「第N題」是這一題（標示「作答用」的表格除外），或題幹提到 picture、map、diagram、chart、table、illustration、photo 等字。題組有圖但無法確定的，列進工作清單交給人判斷；description 註明「僅為裝飾」「為配圖」「僅為插圖」「不需依圖作答」「作答所需資訊在文字中」的圖不算。

### 篇章結構

`clue`（**v1.1 改變：封閉集合**）：`pronoun_reference`、`lexical_cohesion`、`transition_word`、`topic_sentence`、`contrast`、`example`、`elaboration`、`enumeration`、`summary`、`chronology`、`other`。v1 的 `lexical_link`、`keyword_repetition` 併入 `lexical_cohesion`，`conclusion` 併入 `summary`，原值保留在 `clue_raw`。

### 題組

`topic`（英文短語）、`genre`（`news`、`expository`、`narrative`、`biography`、`letter_email`、`advertisement`、`dialogue`、`opinion`、`instructions`、`poem`、`other`）、`sdgs`（相關的 SDG 編號，沒有就空陣列）、`text_format`（`continuous`、`chart`、`table`、`multi_text`、`map`、`form`、`timeline`、`mixed`）。

**text_format 規則（v1.1 新增）**，翻譯、作文題組不適用，其他有選文或圖表的題組一律依此標：

1. 有 `figures` 又有選文（`passage` 或 `passage_parts`）→ `mixed`；
2. 否則 `passage_parts` 兩篇以上 → `multi_text`；
3. 否則只有圖表、沒有連續選文 → 依圖表種類：`chart`（含 graph、diagram）、`table`、`map`、`form`、`timeline`；
4. 其他有選文 → `continuous`。

TypeScript 端的 `expectedTextFormat()` 實作同一個規則。

### 翻譯

`patterns`（核心句型，例如 `"not only ... but also"`、`"so ... that"`、`"分詞構句"`）、`topic`。

### 作文

| 欄位 | 值 |
|---|---|
| `essay_type` | **（v1.1 改變）** `picture`、`chart`、`letter`、`topic`、`continuation`、`other`。v1 的 `two_paragraph` 改為 `topic`（段數已在 `paragraphs`） |
| `paragraphs` | 要求段數（正整數） |
| `word_count` | **（v1.1 新增，取代 `word_requirement`）** `{ "min": 數字或 null, "max": 數字或 null, "approx": 數字或 null }`，三個鍵都要寫出 |
| `word_requirement_raw` | **（v1.1 新增）** v1 的 `word_requirement` 原字串 |
| `topic` | 英文短語 |

`word_count` 的對應：「at least 120 words」→ `{min:120, max:null, approx:null}`；「about 120 words」「120 words」「120字左右」「120字為原則」「100 words左右」→ `{min:null, max:null, approx:120}`；「about 120 to 150 words」「100至150字」→ `{min:120 / 100, max:150, approx:null}`。`approx` 與 `min`／`max` 互斥、不可全是 null、`min` 不可大於 `max`。規則套不上的寫法人工判斷後寫在 `tools/normalize_exams.py` 的 `WORD_COUNT_MANUAL`（目前只有 ast-97 的「at least 120 words (about 120-150)」→ `{min:120, max:150}`：說明寫至少 120 個單詞，提示寫大約 120–150 字）。

## 文字規則 **（v1.1 新增）**

1. **空白**：文字中不可有 U+00A0（不換行空格）及其他看不見的特殊空白：一般空格與 U+3000 以外的所有 Unicode 空白（Zs 類，例如 U+2000–U+200A、U+202F、U+205F）、行／段落分隔符 U+2028／U+2029（Zl、Zp）、格式字元（Cf 類，例如零寬字元 U+200B–U+200D、U+2060、U+FEFF、軟連字號 U+00AD、方向標記 U+200E／U+200F）、換行以外的控制字元（Tab 等）。normalize 腳本把空白類換成一般空格、分隔符換成 `\n`、格式字元刪除；validator（`check_text`）與 `npm run test:data` 用同一個定義檢查。中文全形空白 U+3000 只能出現在中文文字中（前後至少一邊是全形字元），英文文字中的要換成一般空格。這條適用於所有字串（含 `extraction`）。
2. **段落**：見〈group〉的段落規則。
3. **強調標記**：文字中允許的標記只有 `<u>…</u>`（底線）與 `<b>…</b>`（粗體），而且只在題目會用到時使用（例如題目問「畫底線的字」「粗體的 it」）。標記不可帶屬性、必須成對、不可交錯（`<u>a <b>b</u></b>`）、不可自我巢狀、內容不可為空。檢查範圍是題本內容欄位；`extraction`、`reused_from`、各種 `note` 與 `tags` 是說明文字，會用文字提到標記本身，不檢查。選文有標記、但題組裡沒有題目用到（題幹沒提到底線／粗體、沒有引用該字串、也沒有 `refers_to`）時 validator 發 warning。

## 原則

1. **逐字**：題幹、選項、選文、說明一律照題本原文，連拼字錯誤都保留（另在 `extraction.issues` 註記）。斜體不保留格式；底線、粗體只在題目會用到時用 `<u>`、`<b>` 標出（見〈文字規則〉），被問的字串同時寫進 `refers_to`。
2. **答案以官方為準**：選擇題答案來自大考中心公布的答案檔；混合題、翻譯、作文的參考答案與評分原則來自評分原則檔。官方沒有公布就填 null，不可以自己作答填入。送分、多個答案皆給分用 `scoring_exception` 標出。
3. **統計對齊題號**：答對率、鑑別度、選項分析要對準題號，數值換成 0–1 的小數。
4. **圖表一定要轉文字**：看頁面影像，完整描述圖表內容；表格轉成 `rows`。
5. **驗證不過不算完成**：`python3 tools/validate_exam.py` 沒有 error 才算完成，warning 要逐條確認合理。

## 下一階段工作清單（`data/exams/normalize-todo.json`）**（v1.1 新增）**

`tools/normalize_exams.py` 只做不看原卷也能決定的事；需要看原卷判斷的列在這個 JSON 陣列，每筆 `{ "id", "kind", "location", "detail" }`：

| 欄位 | 說明 |
|---|---|
| `id` | 考卷 id |
| `kind` | `refers_to`、`answer_segments`、`scoring_exception`、`chart_reading`、`image_options`、`other` |
| `location` | 小題寫成「題組 id／label」（例如 `s4g2/45`）；issue 寫成 `extraction.issues[索引]` |
| `detail` | 觸發原因、候選字串與出現次數、相關 issue 索引、要做的事 |

| kind | 什麼時候會列 | 下一階段要做的事 |
|---|---|---|
| `refers_to` | 閱讀類題目的 item_type 是 reference／vocab_in_context，或題幹提到 bold、underlined、italic、highlighted、line N、the word／phrase／pronoun、「it in the … paragraph」、「in／from the last sentence」，或引用選文中的字串（雙引號、彎單引號 ‘…’、沒加引號的「closest in meaning to X」與「the X in the second paragraph」都算；比對時彎直撇號視為相同，引文中間的刪節號分段比對）；「Which word in the passage means “…”」這種要考生自己找字的題目，只有引號內的字串不在選文中時才排除 | 看原卷確認被指涉的字串與第幾次出現，填 `refers_to`；選文中原本用 `<u>` 標的若原卷其實是粗體，一併改成 `<b>` |
| `answer_segments` | 中譯英有官方大括號／樹狀圖譯法（answer 帶大括號記號，或 accepted_answers 有其他譯法） | 對照官方樹狀圖填 `answer_segments`（跨段相依改填 `answer_variants`），判斷 `answer_is_composite` |
| `scoring_exception` | 選擇題有 accepted_answers，或 scoring_notes／extraction.issues 提到送分、一律給分、「B或C」 | 核對答案檔與評分原則，填 `scoring_exception` |
| `chart_reading` | 題組有圖表（不是裝飾用），但題幹沒有明說要看圖、圖也沒有指明屬於哪一題 | 判斷是否必須讀圖才能作答，是就把 `item_type` 改成 `chart_reading` |
| `image_options` | 選項只有圖片（目前以「［圖］…」「（圖片）…」文字描述代替），或選項是圖上標示的代號 | 決定前端呈現方式 |
| `other` | extraction.issues 中仍需人工判斷的事項（原卷損壞、誤植、選文原文疑義、推測的轉錄、官方未說明的給分方式等）；逐條看過、確定不需再判斷的列在腳本的 `OTHER_ISSUE_SKIP` | 看原卷判斷，必要時修正資料或在前端加註 |

重跑 normalize 會重新產生這份清單；填好的欄位（例如已有 `refers_to`、`answer_segments`、`scoring_exception`，或 `item_type` 已是 `chart_reading`）就不會再列出。

## v1.1 變更一覽

| 位置 | 變更 | v1 → v1.1 |
|---|---|---|
| 頂層 `schema` | 改變 | `"gsat-exam/v1"` → `"gsat-exam/v1.1"`；不再接受 v1 |
| 頂層 `parts` | 新增（選填） | 統一 v1 的頂層 `parts`（`name` → `title`）與 `section.part_title`／`part_instructions` |
| `section.part_title`、`section.part_instructions` | 移除 | 併入頂層 `parts` |
| `sources.paper_word`、`answer_sheet`、`other` | 新增（選填） | 一律是字串陣列；答案卷依 manifest 從 `other` 搬到 `answer_sheet` |
| `section.stats` | 新增（選填） | 大題層級得分分布；v1 直接掛在 section 的 `score_distribution`（內含 `bins`）併入 |
| `section.stats` 欄位名 | 統一 | `full_marks` → `max_score`；`examinees_registered` → `registered`；`examinees_present` → `examinees`；`percent_base`、`score_distribution_base` → `rate_base`；`bins` → `score_distribution` |
| `score_distribution[]` 欄位名 | 統一 | `score_range` → `range`；`percent` → `rate`；`cum_count` → `cumulative_count`；`cum_percent`、`cumulative_percent` → `cumulative_rate`；補上 `min`／`max` |
| `group.group_label` | 新增（選填） | |
| `group.tags` | 改變 | 必填，可為 null（v1 可以省略） |
| `passage` 段落 | 改變 | 段落分隔一律單一 `"\n"`（詩的分節 `"\n\n"` 例外） |
| `figure.label`、`figure.question_no` | 新增（選填） | |
| `question.reused_from` | 新增（選填） | `{exam, no, modified}`；`modified` 一律寫出（null＝未修改）；作文的 `no` 由 null 改為 1 |
| `question.answer_table` | 新增（選填） | 表格填寫題的答案表 |
| `question.stats` | 新增欄位 | `option_rates_high`、`option_rates_low`、`omit_rate`（← `no_answer_rate`）、`full_correct_rate`、`five_groups` |
| `question.scoring_exception` | 新增（選填） | 只定義格式，內容下一階段填 |
| `question.refers_to` | 新增（選填） | 只定義格式，內容下一階段填 |
| `question.answer_segments`、`answer_variants`、`answer_is_composite` | 新增（選填） | 只有翻譯題；只定義格式，內容下一階段填 |
| 翻譯、作文、簡答的 `no`／`label` | 改變 | `no` 用大題內序號；`label` 用題本印的大題名稱 |
| `tags` | 改變 | 未知欄位、不適用於該大題的欄位是 error |
| `tags.word_requirement` | 移除 | → `word_count` ＋ `word_requirement_raw` |
| `tags.essay_type` | 改變 | 移除 `two_paragraph`（→ `topic`） |
| `tags.grammar_point`、`tags.clue` | 改變 | 封閉集合；改動的原值保留在 `*_raw` |
| `tags.item_type` | 改變 | NOT／EXCEPT → `not_mentioned`；讀圖題 → `chart_reading`；原值保留在 `item_type_raw` |
| `tags.answer_pos`、`tags.answer_function` | 改變／新增 | 兩個字以上的答案一律 `phrase`（保留 `clause`），原功能詞性放 `answer_function` |
| `tags.text_format` | 改變 | 依規則決定（見〈題組〉） |
| 文字 | 新增規則 | 不可殘留 U+00A0 等特殊空白（Zs／Zl／Zp／Cf 類、控制字元）；強調標記只有成對的 `<u>`、`<b>` |
