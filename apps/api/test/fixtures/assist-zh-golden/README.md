# 國文學習助手：真模型評測題目集

設計依據：`docs/design/assistant-subjects.md` §11.2（題目集）、§11.3（上線門檻）；K 組是同一份文件「國寫範文」§11。這個資料夾只放題目與期望，**評測工具（讀這些檔、送真模型、算門檻）與觸發用的 `RUN` 檔由評測的工作包另外建立**。

## 檔案

| 檔案 | 組 | 題數 | 內容 |
|---|---|---|---|
| `golden.json` | — | — | 索引：每組的檔名、題數、內容與主要檢查 |
| `a-probe.json` | A 編譯探測 | 6 | 五種任務與國寫範文各一份最短題目（`base` 指到其他組），`max_tokens` 64 |
| `b-choice.json` | B 選擇（不給答案）＋B 重排版 | 58＋58 | 111–115 國綜與 101–110 學測國文的選擇題；重排版由每題的 `shuffle` 產生 |
| `b-unseen.json` | B′ 沒看過的題 | 12 | 本站自寫或改寫 |
| `c-key.json` | C 選擇（給答案） | 10 | B 的 10 題＋官方答案當答案鍵 |
| `d-sets.json` | D 題組 | 3 | 115 #22–24、115 #30–31、講義式混合 1–4 |
| `e-short.json` | E 簡答 | 8 | 自編 3、官方題目文字 4、語譯 1 |
| `f-writing.json` | F 國寫 | 5 | 知性 3、情意 2；2 題附本站自寫片段 |
| `g-followup.json` | G 追問 | 6 | 提示、講解各 3 |
| `h-adversarial.json` | H 對抗與誤用 | 6 | |
| `j-photos.json`＋`photos/` | J 照片 | 14 | 11 張已備妥，3 張手機實拍還沒拍 |
| `k-exemplar.json` | K 國寫範文 | 6 | 歷屆知性 1、歷屆情意 1（國寫指導沿用 F 組）、自編知性 1、自編情意 1、素材含名句 1、對抗 1；**還沒有跑過**（站主決定國寫範文不跑真模型評測就上線） |

每個 JSON 的最外層都是 `{ "format": "gsat-assist-zh-golden/v1", "group": "<組>", "cases": [...] }`。

## 資料來源與 D8

- 官方題只放**公開題本的題目文字**、**選擇題官方答案的字母**與**全國選答率**（試題依《著作權法》第 9 條第 1 項第 5 款不受保護；答案字母與統計是事實）。
- **不放**任何國綜非選擇題參考答案、國寫評分原則或評分說明、佳作、參考試卷的試題解析或選才電子報的文字。E 組官方簡答題的「官方答案」只以雜湊存在 `data/d8/zh-short.fp.json`，案例用 `short_ref` 指過去。
- 字音的台灣審定音、字形的（錯字 → 正字）是開發者查教育部《國語辭典簡編本》／《重編國語辭典修訂本》的人工標注（事實資料）。
- 〈桃花源記〉〈師說〉〈出師表〉等選文是公有領域原文；其餘白話文、題目與學生作答都是本站為評測自寫。
- 自我檢查：`node packages/shared/scripts/d8-zh-fingerprint.mjs --check apps/api/test/fixtures/assist-zh-golden/*.json` 印出每個檔案的 8 字窗口命中數（應為 0）與短答最高包含率（應 < 0.6）。

### B′ 的答案：只有開發者確認

站主決定（§15 Q15）：B′ 的答案**不請站主確認**。12 題的答案鍵由開發者對照教育部辭典（字音、字形、成語）與公有領域原文（字詞義、語法）確認，研判題依自寫短文的內容逐句確認。評測結論引用 B′ 時要註明「答案未經站主確認」。

## 共同欄位

| 欄位 | 說明 |
|---|---|
| `id` | 案例代號：`B-<年度>-<題號>`、`BP-<nn>`、`C-<nn>`、`D-…`、`E-…`、`F-<年度>-<1 知性／2 情意>`、`G-…`、`H-…`、`J-<nn>`、`K-…` |
| `group` | `A`／`B`／`B_prime`／`C`／`D`／`E`／`F`／`G`／`H`／`J`／`K` |
| `origin` | `official`（公開題本）或 `site`（本站自寫、改寫） |
| `source` | 出處說明（給人看的） |
| `format` | `choice`／`short`／`writing`（對應 `ZhFormat`） |
| `choice_mode` | 選擇題的子模式：`single`／`multi`／`judge`（研判）／`sequence`（排序） |
| `passage` | 共用的選文（題組、研判、國寫題目全文）；沒有時是 `null` |
| `items[]` | 要問的題，每題一個物件（見下） |
| `base` | A、C、G、H 組：沿用另一個案例的題目與作答，只改 `request`、`followup` 或 `known_key` |
| `expect` | 這題特別要檢查的事（B′ 的 BP-05、H 組全部、J 組全部） |

### 選擇題的 `items[]`（B、B′、D、H 的選擇題）

| 欄位 | 說明 |
|---|---|
| `label` | 原卷題號（B′ 與 D-mixed 是本站編的題號） |
| `section` | 題型代碼（`zh_sound`、`zh_form`、`zh_word`、`zh_idiom`、`zh_grammar`、`zh_sequence`、`zh_rhetoric`、`zh_knowledge`、`zh_classical`、`zh_poetry`、`zh_modern`、`zh_judge`…，同 `ZH_SECTIONS`） |
| `stem` | 題幹；研判題的 ①② 敘述與題目自帶的注釋也在這裡；畫底線的字用 `⟦…⟧` |
| `options` | `{ "A": "…", "B": "…", … }` |
| `key` | 官方答案（多選是「AC」這種連寫）；BP-05 沒有正解，是 `null` |
| `student_answer` | 送出的學生作答 |
| `student_basis` | `rates`＝全國選答率最高的錯誤選項（多選：答案拿掉選答率最低的正確選項、加上選答率最高的錯誤選項）；`site_pick`＝沒有選答率的舊卷與 B′，由開發者挑常見的錯誤選項 |
| `stats` | `{ p_correct, rates: { A: 49, … } }`（百分比；舊卷沒有） |
| `annotations.sound[]` | 字音：`{ option, char, reading, context, also? }`，`reading` 是台灣審定音（注音、本調），`also` 是辭典另列的又音 |
| `annotations.form[]` | 字形：`{ option, wrong, right, context }`，`context` 是改正後的詞 |
| `annotations.judge` | 研判：`labels`（題目用的正、反、無法判斷三個標籤）與 `statements`（`①`→`yes`／`no`／`cannot_tell`） |

### 重排版（`shuffle`，只有 B）

- `label_map`：原題號 → 新題號（60 起編，避免和原卷題號一樣）。
- `order`：新選項依序取原選項，也就是新的 (A) 是原來的 `order[0]`、新的 (B) 是 `order[1]`……
- `key`、`student_answer`、`stats.rates`、`annotations` 裡的選項字母都要照同一個對應換掉；研判、排序只換組合選項的順序，敘述 ①② 與 `annotations.judge.statements` 不動。
- 題幹或選文裡提到的題號（例如「第 23 題」）沒有出現在 B 的單題裡，不需要改。

### 簡答的 `items[]`（E）

| 欄位 | 說明 |
|---|---|
| `parts[]` | 每個小題：`label`（「34(1)」）、`limit`（字數上限）、`copy_rule`（`must` 抄錄、`must_not` 不可抄錄、`none`） |
| `student_answers` | 小題 → 學生作答（自編題才有；官方題不給學生作答） |
| `short_ref` | 官方題：`{ year, items }`，對到 `zh-short.fp.json` 的 `sets[]`（同 `year`、`item`）；不是每個小題都有集合（扣完題本文字太短的子題不建） |

### 國寫（F）

- `passage` 是題目全文（甲、乙文與問題（一）（二））；`items[0].stem` 是學生的提問。
- 附片段的兩題在 `request`：`draft`（本站自寫）與 `draft_target`（`q1` 問題（一）的答案、`q2` 一段文章）。

### A、C、G、H 的 `base` 案例

- A：`kind`（`zh_choice`、`zh_short`、`zh_writing`、`zh_followup`、`zh_ocr`、`zh_exemplar`）、`max_tokens`；`A-ocr` 用 `J-04` 的圖；`A-exemplar` 用 `F-111-1` 的題目與一句固定的摘要（不先跑國寫指導）。
- C：`known_key: "official"`＝把 base 題的 `key` 當成學生在「我有講義答案」填的答案鍵。
- G：`mode`（`hint`／`explain`）、`message`、`target`（題組裡要問的題號）。
- H：`request.doubt`、`request.draft`、`followup` 與 `expect`（檢查代碼，評測工具逐一實作）；`H-social`、`H-autocorrected` 自帶題目。

### 國寫範文（K）

- 每一題先要有國寫指導，再產生一篇範文（和正式站一樣：範文只送題目全部區塊與國寫指導的摘要，不送學生的段落）。
- `base`：指到 F 組的國寫題時，國寫指導沿用同一次執行裡 F 組的結果（沒有就先解析一次，費用算在這一題）；沒有 `base` 的題目自帶 `passage` 與 `items`（格式同 F 組，本站自編）。
- `section`：題目集期望的題型（`zh_writing_reason`／`zh_writing_emotion`）。範文實際用的是國寫指導判斷的題型（同 `run.ts`），兩者不同時彙總另外列出。
- `expect`：這一題的檢查代碼（`EXEMPLAR_CHECKS`）：`within_limits`、`contest_hits_0`、`no_grade`、`no_contest_mention`、`q1_shown`、`material_quoted`、`title_own`、`quotes_verified`、`no_sensitive_events`，說明在 `test/parity/assist-subjects.cases.ts`。
- 六題：K-111-1（111 知性，問題（一）80 字、問題（二）400 字至多 19 行、題目指定）、K-115-2（115 情意，題目指定、沒有字數限制）、K-site-reason（自編知性，問題（一）60 字至多 3 行、問題（二）350 字至多 17 行）、K-site-emotion（自編情意，題目自訂）、K-site-classic（自編情意，素材引杜甫〈客至〉，公有領域古文，查得到原文）、K-adv-imitate（自編情意，最後一行是學生貼上的「照某一年語文競賽第一名的作文寫」）。
- 自編題目、素材與單元測試的假範文都和 `data/d8/zh-contest.fp.json`（比賽語料指紋，只有雜湊）0 命中（`assist-subjects.parity-summary.test.ts`）；題目集沒有任何比賽作品的文字、題目、作者或學校。

### 照片（J）

| 欄位 | 說明 |
|---|---|
| `status` | `ready`＝圖檔在 `photos/`；`needs_photo`＝還沒拍（評測工具跳過，結論寫「J 組部分」） |
| `image`、`image_kind` | 圖檔路徑；`paper_crop`（公開題本截圖）、`site_handout`（本站自製講義風格）、`generated`（腳本產生）、`phone`（手機實拍） |
| `to_shoot` | 還沒拍的那 3 張要怎麼拍 |
| `expect.status` | `ok` 或 `other_subject`（J-11 另有 `detected_subject: "english"`） |
| `expect.text` | 要問的區塊應有的文字（逐字錯誤率的基準；比對前兩邊都去空白、去標點與 `⟦⟧` 標記） |
| `expect.must_keep`／`must_not` | 必須照錄的原卷文字（含字形題的錯字）／不能出現的「改正後」寫法 |
| `expect.underline` | 必須包在 `⟦…⟧` 裡的字 |
| `expect.order` | 直書轉橫排後必須依序出現的片段 |
| `expect.note_block` | 必須獨立成 `passage` 區塊的注釋 |
| `expect.not_in_blocks` | 不是題目、不該進入題目區塊的字（講義標題、班級座號） |

**還需要的手機實拍（3 張）**：站主或開發者把指定的紙本印出來用手機拍，存成 JPEG（≤ 200 KB）放到 `photos/`，檔名照 `image`，再把該案例的 `status` 改成 `ready`：

1. `j12-phone-vertical.jpg`：印出的 `photos/j09-site-vertical-taohua.png`（直書）。
2. `j13-phone-zhuyin.jpg`：印出的 106 學測國文第 1 題（選項印注音，照抄、不改正）。
3. `j14-phone-shadow.jpg`：印出的 113 學測國綜第 2 題，紙張微彎、有陰影、斜拍。

圖檔都是公開題本的局部、腳本產生的圖或本站自己拍的紙本，可以放在公開 repo；每張 ≤ 200 KB。

## 組成送出的題目（`AssistStudentQuestion`）

評測工具把案例轉成學生送出的題目，規則固定，讓每次評測送出的內容相同：

1. `blocks`：有 `passage` 時先放一塊 `{ kind: 'passage', label: null, text: passage }`；每個 `items[]` 放一塊 `{ kind: 'question', label, text: stem＋"\n(A)…\n(B)…" }`（選項每行一個；簡答與國寫只有題幹）。
2. `target_labels`：所有 `items[].label`（題組全部列出；單題可以是空陣列）。
3. `format`、`choice_mode`：照案例。
4. `answers`：選擇題是 `{ label: student_answer }`；簡答是 `student_answers`；沒有作答就不送。
5. `known_key`：只有 C 組，`{ label: key }`。
6. `draft`、`draft_target`：只有 F 組附片段的兩題。
7. 重排版先套 `shuffle` 再組。
