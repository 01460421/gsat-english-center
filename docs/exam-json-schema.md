# 歷屆試題 JSON 格式（`gsat-exam/v1`）

每一份考卷（含補考、參考試卷）一個檔案：`data/exams/parsed/{id}.json`。這份格式是題庫資料庫的來源，之後會由腳本匯入 D1。檢查工具：`python3 tools/validate_exam.py data/exams/parsed/*.json`。

## 檔名與 id

| 考試 | id 規則 | 例 |
|---|---|---|
| 學測 | `gsat-{學年度}`，補考加 `-makeup` | `gsat-115`、`gsat-91-makeup` |
| 指考 | `ast-{學年度}`，補考加 `-makeup` | `ast-110`、`ast-109-makeup` |
| 參考試卷／試辦 | `ref-{學年度}`，同年多份加 `-a`、`-b` | `ref-115`、`ref-98-a` |

## 頂層

```jsonc
{
  "schema": "gsat-exam/v1",
  "id": "gsat-115",
  "exam": "gsat",               // gsat | ast | reference
  "year": 115,                  // 學年度（民國）
  "session": "regular",         // regular | makeup
  "title": "115學年度學科能力測驗英文考科",
  "time_minutes": 100,          // 題本沒印就填 null
  "full_score": 100,
  "sources": {                  // repo 內相對路徑（data/raw/ 不進 git，但路徑要對得上 manifest）
    "paper": "data/raw/ceec/gsat/115/paper-1.pdf",
    "answer": ["data/raw/ceec/gsat/115/answer.pdf"],
    "scoring": ["data/raw/ceec/gsat/115/scoring.pdf"],
    "stats": ["data/raw/ceec/gsat/115/stats-1.xls"]
  },
  "sections": [ /* 見下 */ ],
  "extraction": {
    "method": "pdftotext -layout + 人工校對",   // 用了哪些方法（含 Read 看頁面影像）
    "issues": [],               // 無法確定的地方，逐條寫清楚題號與原因
    "verified_by": null         // 查證者填 "verifier"
  }
}
```

## section（大題）

```jsonc
{
  "id": "s1",
  "type": "vocabulary",          // 見下方 type 表
  "title": "一、詞彙題（占10分）",  // 題本原文
  "part": "選擇題",               // 題本原文的部分名稱：選擇題／混合題／非選擇題…；舊卷沒有就 null
  "instructions": "說明︰第1題至第10題為單選題，每題1分。",  // 逐字
  "points_total": 10,
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

## group（題組）

詞彙題這種單題形式，也包成一個 group（`passage` 為 null）。

```jsonc
{
  "id": "s2g1",
  "passage": "Text with blanks [[11]] ... [[12]] ...",   // 空格一律寫成 [[題號]]；沒有選文填 null
  "passage_parts": null,         // 多文本：[{ "label": "A", "title": "...", "text": "..." }]
  "figures": [                   // 圖、表、地圖、海報；用文字完整描述，表格要轉成 rows
    { "kind": "table", "caption": "...", "description": "...", "rows": [["Year","Sales"],["2020","12"]] }
  ],
  "options_bank": null,          // word_bank／structure／sentence_matching：{ "A": "...", ... }
  "questions": [ /* 見下 */ ],
  "tags": {                      // 題組層級標註（見「標註」）
    "topic": "plastic pollution",
    "genre": "expository",
    "sdgs": [12, 14],
    "text_format": "continuous"
  }
}
```

## question（小題）

```jsonc
{
  "no": 11,                      // 題號（整數）；混合題的 47A 這種寫 no: 47, label: "47A"
  "label": "11",
  "mode": "single_choice",       // single_choice | multi_select | bank_choice | fill_in_blank | short_answer | table_completion | translation | composition
  "stem": "The mayor has such a ______ schedule ...",   // 題幹逐字；克漏字類沒有題幹就填 null
  "options": { "A": "hasty", "B": "tight", "C": "diligent", "D": "routine" },  // 用 options_bank 的題目填 null
  "answer": "B",                 // 單選：字母；多選：["C","D"]；填充／簡答：官方參考答案字串；翻譯：官方參考譯文（沒公布填 null）；作文：null
  "accepted_answers": null,      // 評分原則列出的其他可接受答案
  "points": 1,
  "stats": {                     // 大考中心統計（有才填，數值用 0–1 的小數）
    "correct_rate": 0.62, "high_group": 0.91, "low_group": 0.30, "discrimination": 0.61,
    "option_rates": { "A": 0.05, "B": 0.62, "C": 0.20, "D": 0.13 }
  },
  "scoring_notes": null,         // 非選擇題：評分原則中與本題相關的逐字內容
  "tags": { }                    // 見「標註」
}
```

## 標註（tags）

解析時一併標上，跨年分析時會再統一修正。不確定就省略該欄，不要猜。

**選擇題共通**（vocabulary／cloze／word_bank）

| 欄位 | 值 |
|---|---|
| `test_point` | `word_meaning` 詞義、`collocation` 搭配詞、`phrase` 片語／慣用語、`connective` 轉折詞／連接詞、`grammar` 文法、`word_form` 詞性／字形、`discourse` 上下文邏輯 |
| `answer_pos` | `noun`、`verb`、`adjective`、`adverb`、`preposition`、`conjunction`、`pronoun`、`phrase`、`clause` |
| `grammar_point` | `test_point` 是 grammar 時填，例如 `relative_clause`、`participle`、`subjunctive`、`tense`、`passive`、`inversion`、`comparison`、`infinitive_gerund`、`conditional`、`agreement` |
| `key_phrase` | 答案涉及的片語或搭配，例如 `"elbow one's way"` |

**閱讀、混合題**

| 欄位 | 值 |
|---|---|
| `item_type` | `main_idea`、`detail`、`inference`、`vocab_in_context`、`reference`、`purpose`、`tone_attitude`、`structure`、`chart_reading`、`sequencing`、`title`、`not_mentioned`、`application`、`synthesis` |

**篇章結構**：`clue`（例如 `pronoun_reference`、`transition_word`、`topic_sentence`、`example`、`contrast`）。

**題組**：`topic`（英文短語）、`genre`（`news`、`expository`、`narrative`、`biography`、`letter_email`、`advertisement`、`dialogue`、`opinion`、`instructions`、`poem`、`other`）、`sdgs`（相關的 SDG 編號，沒有就空陣列）、`text_format`（`continuous`、`chart`、`table`、`multi_text`、`map`、`form`、`timeline`、`mixed`）。

**翻譯**：`patterns`（核心句型，例如 `"not only ... but also"`、`"so ... that"`、`"分詞構句"`）、`topic`。

**作文**：`essay_type`（`picture`、`topic`、`letter`、`chart`、`two_paragraph`、`continuation`、`other`）、`paragraphs`（要求段數）、`word_requirement`（例如 `"120 words"`）、`topic`。

## 原則

1. **逐字**：題幹、選項、選文、說明一律照題本原文，連拼字錯誤都保留（另在 `extraction.issues` 註記）。斜體、粗體、底線不保留格式，但如果題目在問「畫底線的字」，用 `<u>...</u>` 標出。
2. **答案以官方為準**：選擇題答案來自大考中心公布的答案檔；混合題、翻譯、作文的參考答案與評分原則來自評分原則檔。官方沒有公布就填 null，不可以自己作答填入。
3. **統計對齊題號**：答對率、鑑別度、選項分析要對準題號，數值換成 0–1 的小數。
4. **圖表一定要轉文字**：看頁面影像，完整描述圖表內容；表格轉成 `rows`。
5. 驗證不過不算完成：`python3 tools/validate_exam.py` 沒有 error 才算完成，warning 要逐條確認合理。
