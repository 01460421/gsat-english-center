# 單字講義 PDF（講義版、背誦版、句意填空、測驗卷）：設計

> 版本：2026-10-23 第 1 版（設計，交給實作）。
> 需求（站主）：「單字功能必須要能渲染匯出成講義」；追加：「單字講義還附有句意填空」。也就是說，單字模組要能把一批單字在瀏覽器裡當場排成可列印的 A4 講義 PDF（同模擬考 PDF 的做法），而且每份講義都附「句意填空」：從例句挖掉目標字，學生依句意寫出該字（可能要寫變化形），題號對應，答案放在最後、另起一頁可以拆下；句意填空也能單獨印成練習卷。
> 相關文件：`docs/design/mock-exam-pdf.md`（PDF 引擎、字型、§9.1 驗收）、`docs/design/bank-mock.md` §7（自組卷 PDF：雙面列印、粗體字串檢查、缺字替代）、`docs/design/desktop-ui.md`（R1–R11、§5.9 /words）、`docs/SPEC.md` §6.1、`data/vocab/CREDITS.md`、`docs/research/03-vocab-list.md` §9、`docs/research/04-data-sources-licensing.md` §7。
> 基準：origin/main **4e8749a**（詞彙表 6,012 筆、資料由 `apps/web/scripts/build-data.mjs` 從 `data/vocab/lexicon.json` 產生）。
> 標記：「（實測）」＝在 4e8749a 的 `lexicon.json`、字型子集與 Google Fonts 原始字型上量到的數字（量測腳本在工作階段的 scratchpad，不進 repo）；「（設計值）」＝上線前用實作量測校正；「（估計）」＝推算。

**目錄**：[0. 決策摘要](#0-決策摘要)｜[1. 範圍與限制](#1-範圍與限制)｜[2. 資料盤點與授權](#2-資料盤點與授權)｜[3. 四種 PDF 的內容與版面](#3-四種-pdf-的內容與版面)｜[4. 句意填空](#4-句意填空)｜[5. 選字與選項介面](#5-選字與選項介面)｜[6. PDF 引擎的改動](#6-pdf-引擎的改動)｜[7. 字型涵蓋](#7-字型涵蓋)｜[8. 效能與上限](#8-效能與上限)｜[9. 測試](#9-測試)｜[10. 工作項目與檔案](#10-工作項目與檔案)｜[11. 驗收清單](#11-驗收清單)｜[12. 風險](#12-風險)｜[13. 待站主決定](#13-待站主決定附預設值)

---

## 0. 決策摘要

1. **四種 PDF**（§3）：
   - **講義版**：每字一段（字、IPA、詞類、級別、中文釋義、例句＋翻譯、不規則變化、同詞族），依級別與字母分組、連續編號 → 句意填空 → 資料來源與授權 → 答案。
   - **背誦版**：對折表（左英右中，沿虛線對折遮住一邊自我測驗）→ 句意填空 → 資料來源 → 答案。
   - **句意填空卷**：只有句意填空 → 資料來源 → 答案。
   - **測驗卷**：句意填空＋中翻英拼字＋英選中（後兩者可取消）→ 資料來源 → 答案。
   - **每一種都附句意填空**（站主的追加需求），不能關掉；答案預設附上，另起一頁、頁碼另計，可以整疊拆下。
2. **句意填空的句子只用 Tatoeba 例句**（單字資料裡已有、CC BY 2.0 FR／CC0，逐句標示作者；§4.1）。主力 L3–5 的實詞約 79% 找得到合格句子（L3 90%、L4 81%、L5 66%，L6 49%）（實測）。沒有合格句子的字不出題，答案頁列出「未出題」與原因。v1 **不用**本站 AI 題庫的詞彙題題幹：只能多補 44 個字（實測），卻要多處理 AI 標示與題庫練習被提前看到的問題（§4.1、§13 第 3 點）。
3. **挖空規則**（§4.2–§4.4）：
   - 目標字（含屈折變化）在句中恰好出現一次，整個字挖掉；句中不能有同詞族的字、原表的其他寫法或含原形的複合字。
   - 同一句不重複使用；盡量避開含其他題答案的句子；講義版盡量和單字條目裡印的例句不同。
   - 提示預設「首字母」，可加「字母數」。答案印句中實際的字（`adults`），並註明原形（adult）。
   - 題目順序依講義代號洗牌，不照講義順序。
4. **選字**（§5.3）：
   - 來源有四種：級別＋範圍（全部、依字母、依份數「每份 50／100 字的第 k 份」）、單字庫目前的搜尋與篩選結果、錯題本、每日學習的字。
   - 每份 PDF 上限 **600 字**；句意填空最多 200 題；拼字、英選中各最多 100 題。
   - 本站沒有「收藏」功能，「學習中的字」用每日學習的卡片代替（§13 第 5 點）。
5. **入口與畫面**（§5.1–§5.2）：
   - 入口在單字庫（結果數那一列）、錯題本、每日學習的「做成講義」。
   - 講義頁是 `/words?handout=1`，和單字卡一樣蓋過分頁內容、關掉回到原分頁；畫面元件 lazy 載入。
   - 下載的狀態、進度、取消、iOS 分享與 App 內建瀏覽器提示，和考卷 PDF 共用同一個 hook（`usePdfDownload`，從 `ExamPdfDownload` 抽出，考卷的畫面不變）。
6. **PDF 引擎**（§6）：
   - 沿用 pdfmake 0.3.11＋Web Worker＋同一套子集字型與 `blocks.ts` 的分頁工具。
   - 主執行緒先把條目組成純資料 `VocabHandoutPdfData`（選句、挖空、洗牌、授權字串都在這一步完成），Worker 只負責排版，PDF 模組不匯入單字模組。
   - Worker 訊息改成 `kind: 'exam' | 'vocab'` 兩種。歷屆卷、模擬考、自組卷的文件定義不變。
7. **授權**（§2、§3.6）：
   - 每頁頁尾印詞彙表的出處（沿用現有常數 `VOCAB_CREDITS.wordlist`，不改寫），並標「非營利使用」。
   - 每一句例句都附「Tatoeba #編號 by 作者」，句意填空的題目也附。
   - 最後有「資料來源與授權」頁：ECDICT 的 MIT 全文；有印同詞族或同義詞時，加上 OEWN 與 Princeton WordNet 的聲明。
   - **不印 CEFR**，避開 Octanove 的 CC BY-SA 相同方式分享。
   - **新寫的講義文字與介面文字都不出現「大考中心」或 CEEC**，唯一例外是上面那條沿用的詞彙表出處；歷屆出現次數寫「歷屆 N 次」，沿用單字庫的寫法。
8. **字型**（§7）：
   - 單字資料要印的字，有 130 個不在現在的中文子集裡，另有 IPA 音標 17 種符號完全沒有字形（實測），所以要擴充子集。
   - 中文 130 字補進 Noto Serif TC；IPA 和少數希臘字母、拼音補進 Tinos（原始字型都有，實測）。中文子集約多 36 KB，三個 Tinos 檔合計約多 13 KB（gzip，估計）。
   - 建置時檢查「講義會印的字串」：字頭、音標、釋義缺字就建置失敗；只有例句缺字時只警告，那一句不採用（目前只有 2 句，實測）。
   - 只加現在任何子集都沒有的字，歷屆卷的字型分配不變。
9. **效能**（§8）：
   - 講義版每頁約 8 字、背誦版每頁約 34 字（估計）；600 字的講義版約 100 頁。
   - 時間目標（設計值）：600 字講義版在桌機 ≤ 8 秒、4 倍 CPU 降速 ≤ 30 秒；100 字講義版在手機首次 ≤ 10 秒。
   - WP0 先實測；達不到時，手機上的講義版上限降為 300 字。
   - 分頁不用 `pageBreakBefore` 型的「標題不落單」，一律把標題和第一個條目包成不跨頁的區塊：pdfmake 每遇到一次換頁回呼就要重排整份文件。

## 1. 範圍與限制

| 項目 | 決定 |
|---|---|
| 產生方式 | 瀏覽器內產生、直接下載（同考卷 PDF，`docs/design/mock-exam-pdf.md` §2）。沒有伺服器端產生，也不用 `window.print()` |
| 開關 | 沿用全站的 `PDF_DOWNLOAD_ENABLED`／`pdfDownloadVisible()`（目前開放）；關掉時所有「做成講義」入口一起消失 |
| 紙張 | A4 直式。B4、A3 不做（§13 第 4 點） |
| 裝置 | 同全站：iOS Safari 16.4+、Android Chrome、桌機近兩年的瀏覽器；320–390 px 手機沒有水平捲動；≥ 1024 px 依 `desktop-ui.md` |
| 套件 | 不新增任何 npm 套件；pdfmake、字型、Worker 全部沿用 |
| 文案 | 繁體中文、台灣用語。新文字不出現「大考中心」或 CEEC（例外見 §2.2）；不出現任何 AI 模型名稱（v1 的講義內容沒有 AI 產生的東西） |
| 公開資料 | 不改 `public/data/vocab/*.json` 的格式；只多一道建置時的字型檢查（§7） |
| 不做 | KK 音標（資料沒有，§13 第 1 點）、搭配詞（資料還沒有，§13 第 2 點）、CEFR、Word／Excel 匯出、自訂字表上傳、單一單字卡的 PDF、伺服器端保存講義 |

## 2. 資料盤點與授權

### 2.1 每個欄位能不能印

`VocabEntry`（`src/data/vocab.ts`，各級檔 `/data/vocab/L{1..6}.json`）的欄位，依 `data/vocab/CREDITS.md` 的「欄位來源對照」：

| 欄位 | 來源與授權 | 講義用法 | 數字（實測） |
|---|---|---|---|
| `word`、`variants`、`level`、`pos`、`raw` | 參考詞彙表：僅供非營利使用、轉載註明出處 | 字頭、其他寫法（a／an）、級別標籤 L1–L6、詞類照原表寫法（`n./adj.`） | 6,012 筆，每級 1,002 |
| `ipa` | ECDICT，MIT | 字頭旁 `/ˈædʌlt/`（IPA，舊式英式標音為主） | 13 筆沒有音標（不印） |
| `zh` | ECDICT，MIT（`fixed` 行是本專案補寫） | `match: true` 的行（沒有就用第一行）；有 `domain` 的行不印 | 平均每字 1.5 行、17.5 字 |
| `forms` | ECDICT，MIT | 只印**不規則**變化（不是 `regularInflections()` 產生得出來的形式），例如 go → went／gone；規則變化不印 | 4,817 筆有變化形 |
| `variant_info` | ECDICT，MIT | 原表衍生字的音標與釋義（achieve(ment) 的 achievement） | 168 筆 |
| `family` | 本專案計算（詞彙表＋OEWN 衍生關係，CC BY 4.0 部分） | 「同詞族：creative L4・creation L4」，最多 4 個 | 1,878 筆 |
| `synonyms`、`antonyms` | OEWN 2025，CC BY 4.0（要標示 Princeton WordNet） | 選用（預設關）：只印詞彙表內的字 | — |
| `examples` | Tatoeba，CC BY 2.0 FR／CC0，**每句標作者** | 講義版每字 1 句（英＋中）、句意填空的題目 | 17,646 句；沒有例句：L1 1、L2 30、L3 94、L4 181、L5 342、L6 503 |
| `exam_stats` | 本站依歷屆試題統計 | 「歷屆 12 次」（`total`，同單字庫列表的寫法） | — |
| `en_def` | OEWN／ECDICT | 不印（中文講義，留給單字卡） | — |
| `cefr` | CEFR-J 條款／Octanove CC BY-SA 4.0 | **不印**：C1／C2 一印就要整份以 CC BY-SA 釋出並標示；學生用的是 L1–6 | — |
| `cambridge_url` | 外部連結 | 不印 | — |
| 搭配詞 | **資料裡沒有**（AboutPage 標「規劃使用」Datamuse／Ngram） | v1 不印；版面預留一行，資料上線後再加（§13 第 2 點） | — |
| `internal_core_flag`、`internal_star` | ECDICT 的 Oxford／Collins 欄 | 公開資料檔本來就沒有，也不能顯示 | — |

### 2.2 出處標示的規則

- **詞彙表**：
  - 每頁頁尾照印 `VOCAB_CREDITS.wordlist`，也就是單字卡、Credits 頁、關於頁現有的同一句。這是原表要求的「轉載請註明出處」，也是 `CREDITS.md`「App 內標示文字」規定的寫法，所以從常數匯入，不重打、不改寫。這是講義裡唯一出現機構名稱的地方；其他新寫的文字一律不寫「大考中心」或 CEEC。
  - 原表只能非營利使用，所以資料來源頁寫「依原表封面聲明，僅供非營利目的使用並註明出處。」（不寫機構名稱），頁尾也標「非營利使用」。PDF 免費下載、不放廣告。
- **ECDICT**：資料來源頁印 `VOCAB_CREDITS.ecdict`、版權行與 MIT 全文。一份講義只用到辭典極小一部分，未必算「substantial portion」；但全文只要 8 pt 約 10 行，照印比較保險。
- **OEWN**：有印同詞族或同義詞時，資料來源頁印 `VOCAB_CREDITS.wordnet`、CREDITS.md 的 OEWN 標示，以及 Princeton WordNet 的授權聲明（授權條件要求「appear on ALL copies」）。都沒印就省略整段。
- **Tatoeba**：
  - 每一句都印 `exampleAttribution()` 產生的文字（「Tatoeba #2852917 by CK」；中文另標「中文 Tatoeba #4265060 by notabene」）。`zh_converted` 為真時，再加「中文經轉換為台灣繁體」。講義版的例句、句意填空的題目、答案頁的整句都照這個規則。
  - 句意填空的題目上，英文句的標示**不加連結**（點了就看得到答案）；資料來源頁寫出句子頁網址的格式 `https://tatoeba.org/en/sentences/show/{編號}`，並說明句意填空的句子挖去了目標字（改作）。講義版與答案頁的標示加連結。
- **歷屆出現次數**：資料來源頁寫「歷屆出現次數：本站依歷屆學測、指考英文試題統計」。不用 `VOCAB_CREDITS.examStats`，因為那句含機構名稱，而且不是詞彙表的出處。

## 3. 四種 PDF 的內容與版面

### 3.1 各類型的組成

| 類型 | 依序 | 答案頁內容 | 適合 |
|---|---|---|---|
| 講義版 | 標題區 → 單字條目 → 句意填空 → 資料來源 → 答案 | 句意填空 | 新學、上課講義 |
| 背誦版 | 標題區 → 對折表 → 句意填空 → 資料來源 → 答案 | 句意填空（對折表本身就是答案） | 考前背誦、自我測驗 |
| 句意填空卷 | 標題區 → 句意填空 → 資料來源 → 答案 | 句意填空 | 單獨練習、小考 |
| 測驗卷 | 標題區 → 一、句意填空 → 二、中翻英拼字 → 三、英選中 → 資料來源 → 答案 | 三部分 | 週考、複習考 |

- 每一段都用 pdfmake 的 section，從新的一頁開始。「答案」不勾時整段不印；勾選時頁首寫「答案」，頁碼另起「答案 第 1 頁／共 2 頁」，拆下後不影響前面的頁碼。
- **雙面列印**（選用）：句意填空、資料來源、答案落在雙數頁時先補一張空白頁（沿用 `KeepRegistry.duplexStart()`，空白頁印「（本頁空白）」），拆下答案不會撕走題目的背面。
- **題號**：
  - 講義版的單字條目編號 #1–#N。
  - 練習題號從 1 起連續編到最後，測驗卷三部分也接續編號，同學測。答案頁用同一組題號。
  - 講義版的句意填空答案另附「→ 講義 #12」，方便回頭查。
- **講義代號**：5 個字元（例如 `7Q2MK`），由類型、條目 id 清單、題目選項與「重新出題」次數算出雜湊，同時當選句與洗牌的種子。代號印在每頁頁尾與答案頁頁首，題目和答案分開列印時可以核對。相同選擇在同一份資料版本上會產生相同的 PDF。

### 3.2 標題區、頁首頁尾、文件屬性

- **標題區**（第 1 頁上方，不另印封面頁）：
  1. 第一行：「學測英文中心　單字講義」（依類型換成背誦版、句意填空、測驗卷）。
  2. 標題，例如「Level 4　第 201–300 字」「錯題本　45 字」「單字庫篩選結果　L3–5・動詞」。
  3. 說明行：「100 字・句意填空 86 題・2026-10-23 製作・講義代號 7Q2MK」。
  4. 填寫欄：班級、座號、姓名，測驗卷另加得分（沿用 `fieldRow`；可以關掉）。
  5. 一行使用方式，例如講義版：「先讀單字與例句，再做第 9 頁起的句意填空；答案在最後，可以拆下。」頁碼依估計填，估不準時改寫「後面的句意填空」。
- **頁首**（第 2 頁起）：左側印類型與標題（「單字講義・Level 4 第 201–300 字」），右側印「第 3 頁／共 12 頁」。單字條目、句意填空與資料來源連續編頁；答案另外編頁。
- **頁尾**（每一頁）：
  - 第 1 行：`VOCAB_CREDITS.wordlist`。
  - 第 2 行：「音標與釋義：ECDICT（MIT）・例句：Tatoeba（CC BY 2.0 FR，逐句標示）・學測英文中心製作，非營利使用・講義代號 7Q2MK」。
  - 7.5 pt，放不下時照 `chrome.ts` 的做法拆成兩行。
- **文件屬性**：Title「學測英文中心 單字講義 Level 4 第 201–300 字」，Subject「學測英文中心單字講義，非營利使用」，Author、Creator「學測英文中心」，`language: 'zh-TW'`。

### 3.3 講義版的單字條目

一欄（預設）時，每個字是一個不跨頁的區塊，約 80–95 pt 高，每頁約 8 字（估計）：

```
#12  choose   /tʃuːz/   v.   [L1]                                          歷屆 40 次
     及物 選擇, 寧願, 欲；不及物 作出選擇, 願意
     不規則變化：chose（過去式）・chosen（過去分詞）
     It took her a long time to choose a hat.
     她花了好長時間挑帽子。
     Tatoeba #315866 by CK · 中文 Tatoeba #2411906 by User5120 · 中文經轉換為台灣繁體
```

（實際資料：choose 沒有同詞族，所以那一行只有不規則變化。）

| 元素 | 字型與大小（設計值） | 規則 |
|---|---|---|
| 編號、字頭 | Tinos Bold 13 pt | 原表其他寫法接在後面（「a / an」） |
| 音標 | Tinos 10.5 pt，灰 | `/…/`；沒有就不印 |
| 詞類、級別、歷屆 | Tinos 10 pt、級別細框標籤、灰色小字 | 歷屆 0 次不印 |
| 釋義 | Noto Serif TC 10.5 pt | 詞性標籤用短寫（名、動、及物、不及物、形、副、介、連、代…；新增 `zhSenseShortLabel()`），行與行之間用「；」。「精簡」（預設）時每行取前 3 個義項（同 `shortGloss` 的切法），「完整」時整行照印 |
| 衍生字 | 9.5 pt | `variant_info`：「achievement n. 成就, 完成」 |
| 不規則變化、同詞族、同義／反義 | 9 pt，一行 | 都沒有時不印這行；搭配詞資料上線後加在這一行之後 |
| 例句 | 英文 Tinos 10.5 pt（目標字粗體，`findWordInSentence`）、中文 9.5 pt、標示 7 pt 灰 | 依 §4.5 選句；沒有可印的例句時省略這三行 |

- **分組**：
  - 依「級別」分段，例如「Level 4」（14 pt 粗體）。同一級再依首字母加小標「A」「B」（12 pt 粗體）。
  - 標題一律和後面第一個條目包成不跨頁的區塊（`flowBlocks` 的 keepWithNext 合併，條目都很短，一定合併得了），不登記 `pageBreakBefore`（§8.3）。
  - 排序可選「依字母」（預設）、「依歷屆出現次數」、「依來源順序」。後兩種不分組，只依級別分段。
- **兩欄**（選用）：不印例句（勾選會停用「附例句」並說明）。每個條目只有字頭行、釋義、變化與詞族，兩欄排，每頁約 30–36 字（估計）。
- 研究文件（03 §9）建議「衍生字和詞類變化放在次要區塊，以情境例句為主」：所以變化與詞族用小字一行，例句排在條目的最後面、行距較寬。

### 3.4 背誦版

- 一張表格佔滿版心寬，每頁約 34 列（11 pt、列高約 20 pt，估計）。表頭在每頁重複（`headerRows: 1`）。欄位：
  - 遮中文（預設）：□（自評勾選）｜No.｜英文＋詞類＋音標（音標可關）｜**對折虛線**｜中文（短釋義）。
  - 遮英文：□｜No.｜中文＋詞類｜**對折虛線**｜英文。
- 對折線：中間欄位的左框線改成 0.6 pt 虛線。表格上方印一行「沿虛線對折，遮住右半邊自我測驗；答錯的在 □ 打勾」。
- 不印例句。分組與排序同講義版：每一級或每個首字母之前插一列粗體分組列，該列設 `dontBreakRows`，表格不在列中間切開。

### 3.5 測驗卷的另外兩部分

- **中翻英拼字**：
  - 「1. 成人, 成蟲（n.）　a _ _ _ _」：短釋義＋詞類＋首字母＋字母數，同線上拼字題的提示。
  - 只出 L1–4 的實詞，沿用 `isSpellable` 與 `QUIZ_POS`（課程手冊把拼寫範圍定在一至四級）。
  - 答案是原形；可接受寫法用 `acceptedSpellings()` 列在答案旁（「亦可：advisor」）。
- **英選中**：
  - 「1. adult　(A) 成人, 成蟲　(B) …」：用 `buildMeaningQuestion(target, 'en2zh', pool, rng)`，干擾選項同級、同詞類（`quiz.ts` 的規則）。`pool` 用選字所在各級的完整條目。
  - 選項依 `options.ts` 的寬度規則排成一列四個、兩欄或一個一行。
  - 干擾選項不夠時，那個字不出題。
- 每個字只出在一個部分（實作備註「審查後的修正」第 2 點）：英選中印出英文字和它的短釋義，那正是拼字的題目與答案，句意填空的答案字出現在英選中也等於印出答案。選的字依「歷屆當正解次數」分到題數最少、能出的部分，三部分大約各占三分之一（Level 5–6 沒有拼字，句意填空與英選中各半）；拼字、英選中各最多 100 題，句意填空依題數選項。測驗卷勾選的部分，題目順序各自依講義代號洗牌。

### 3.6 資料來源與授權頁

新的一頁，標題「資料來源與授權」，只列這份 PDF 實際用到的來源：

1. 詞彙與級別：`VOCAB_CREDITS.wordlist`；「依原表封面聲明，僅供非營利目的使用並註明出處。」
2. 音標、釋義、詞形變化：`VOCAB_CREDITS.ecdict`；「MIT License，Copyright (c) 2025 Linwei」；MIT 全文（8 pt）。
3. 例句（有印例句或句意填空時）：Tatoeba、CC BY 2.0 FR（部分 CC0 1.0）、標示格式、句子頁網址格式；「句意填空的句子挖去目標字」；「標『中文經轉換為台灣繁體』的翻譯經 OpenCC 轉換並調整用字」。
4. 同詞族與同義詞（有印時）：`VOCAB_CREDITS.wordnet`、OEWN 2025 的標示、Princeton WordNet 授權聲明全文（8 pt）。
5. 歷屆出現次數：本站依歷屆學測、指考英文試題統計。
6. 一句說明：「本講義由學測英文中心依上列公開資料製作，免費提供，非營利使用。」

上面 1、2、4 的授權全文與版權行從 `data/vocab/CREDITS.md` 抄進 `layout/vocab/strings.ts`；`CREDITS.md` 由 `tools/build_vocab.py` 產生，所以加一個單元測試，比對兩邊的版權行與授權全文一致。

### 3.7 答案頁

- **答案速查表**（每部分一張，5 欄網格，例如「1 adults　2 postponed　…」）：老師批改、學生對答案都先看這張。200 題約 1 頁（估計）。
- **句意填空詳解**（預設附，可關）：每題三行。
  1. 整句，答案粗體，接「（原形 adult）成人, 成蟲」；講義版另附「→ 講義 #12」。
  2. 中文翻譯（9.5 pt）。
  3. 英文與中文的 Tatoeba 標示（有連結）。
- 可接受的其他寫法印在答案後（「亦可：…」），只列真正的拼法差異：英式的雙 l（資料的美式形式是單 l 時，travelled → traveled）、英式拼法的字頭（dialogue → dialog），以及原表斜線列出、只是拼法不同的寫法（adviser／advisor、judgment／judgement，只在答案是原形時）；和印出來的提示（首字母、字母數）不合的不列。**不用** `spelling.ts` 的 `americanize` 字尾規則：那是線上拼字題比對學生輸入用的，倒過來產生會印出 hor、sciense、promize 這種錯字（實作備註「審查後的修正」第 1 點）。答案頁開頭另有一行通則：「拼法依例句；答案後面「亦可」列出的拼法也算對。」
- **未出題**：列出選了卻沒出題的字和原因。原因有三種：沒有合適的例句、功能詞不出題、超過題數上限。
- 拼字、英選中：速查表之後列「答案＋短釋義」，不另附詳解。

## 4. 句意填空

### 4.1 句子來源的決定

| 來源 | 授權 | 品質 | 涵蓋（實測） | v1 |
|---|---|---|---|---|
| 單字資料裡的 Tatoeba 例句 | CC BY 2.0 FR／CC0，逐句標示即可再散布；`build-data.mjs` 已擋掉沒有作者的 CC BY 句子 | 句子較短（中位數 9 個字，第 10–90 百分位 7–12）；`within_level` 表示句中其他字都不超過該條目級別＋1 | 實詞 5,899 筆中 4,713 筆有合格句子（79.9%）：L1 99%、L2 97%、L3 90%、L4 81%、L5 66%、L6 49% | **採用** |
| 本站 AI 題庫的詞彙題題幹（300 題，全部 verified，`original-ai`） | 本站自有 | 學測詞彙題的寫法（中位數 18 字），最像學測 | 285 題對得到條目，但只能替「沒有合格 Tatoeba 句子」的字多補 44 個（L3 7、L4 15、L5 20、L6 2） | 不採用 |
| 之後的 AI 例句（SPEC §6.1「AI 例句（標『AI 生成』）」） | 本站自有 | 可以照學測詞彙題規格產生 | 可以補滿 L5–6 | 列為 §13 第 3 點 |

不採用題庫題幹的理由：

- 只多 0.7% 的涵蓋。
- 要把 30 個題組檔載進單字頁。
- PDF 要另加「AI 撰寫」標示。
- 題庫練習的題目會被講義提前看到。

### 4.2 合格句子（每個條目）

只出實詞：第一個詞類是 n.、v.、adj.、adv.（同 `QUIZ_POS`，學測詞彙題考的也是 content words）；功能詞（113 筆）在答案頁列為「功能詞不出題」。同一個字有兩個條目時（content n./adj. 與 content v.），只出一題。

一句例句要**全部**符合下列條件才合格（`handout/cloze.ts` 的 `clozeSentences(entry, context)`）：

1. **印得出來**：先做 §7.3 的正規化，`missingGlyphs()` 對英文句與中文句都是空的；而且不在排除清單 `handout/exclude.ts` 裡（Tatoeba 編號，§12 R3）。
2. **長度** 6–30 個字（`TOKEN_RE` 計算）。
3. **恰好出現一次**：`findWordInSentence(en, buildFormMap(entry))` 只找到一個字。同一個字出現兩次（不論同形或不同形）都不合格。這比線上「例句填空」嚴格：線上的規則允許同形出現多次。
4. **不能從句子其他部分看出答案**：其他每個字（`normalizeWord` 後）都不能是下列任何一種：
   - 同詞族成員（`family` 的字及其 `buildFormMap` 的所有形式）；
   - 原表其他寫法（`variants` 及其形式）；
   - 原形長度 ≥ 4 時，以原形開頭的字（careful 之於 care、playground 之於 play）；
   - 含連字號而某一段是目標字的複合字（well-known 之於 known）。
5. 所有格（adult's）、縮寫裡的目標字找不到，或會被規則 4 判為洩漏：那句直接不用，不做部分挖空。

### 4.3 選哪一句（全份一起決定）

每個合格句子給分，取最高分的；同分時用講義代號的種子決定：

| 條件 | 分數（設計值） |
|---|---|
| `within_level` | ＋2 |
| 長度 8–20 個字 | ＋1 |
| 挖空不在句首 | ＋0.5 |
| 句中含有本份其他題的答案字（任何形式） | −1（避免第 5 題的句子露出第 2 題的答案） |
| 講義版：和這個字條目裡要印的例句相同 | −1.5 |

- 同一句（`tatoeba_id`）在一份 PDF 裡只用一次。依「合格句子少的字先選」的順序貪婪分配，L5–6 只有一句合格的字才不會被別的字搶走。
- 講義版先選句意填空的句子，再從剩下的句子挑條目裡要印的例句（`within_level` 優先，即 `feedbackExample` 的規則）。只有一句合格時兩處用同一句：講義本來就是先讀後練，這是預期的情況。有兩句以上合格句子的字：L3 762、L4 616、L5 389（實測）。
- 題數超過上限（句意填空最多 200）時：依「歷屆當正解次數」高者優先，同次數再用種子隨機取；沒選上的列為「超過題數上限」。

### 4.4 挖空與提示

- **整個字挖掉**：句中實際的字（`adults`、`went`、`stopped`）整個換成空格。答案就是這個字；原形與形式寫在答案頁。
  - 形式名稱只在明確時才寫（「複數」「比較級」）。過去式與過去分詞拼法相同時寫「過去式或過去分詞」，因為程式判斷不了句中是哪一種。
- **提示**（兩個勾選，套用整份）：

| 首字母 | 字母數 | 印出來（答案 adults） | 預設 |
|---|---|---|---|
| ✓ | — | `a__________`（首字母＋固定長度底線，約 2.8 cm，長度不透露字數） | **預設** |
| ✓ | ✓ | `a _ _ _ _ _`（每個字母一格；連字號、撇號照印） | |
| — | ✓ | `_ _ _ _ _ _` | |
| — | — | `____________`（固定長度） | |

  - 首字母照句中的大小寫（挖空在句首時是大寫）。
  - 空格用不換行空白加底線組成，同 `blankInline()` 的做法，換行時不會被截斷。
- **中文提示**（選用，預設關）：題目下一行印這句的中文翻譯，並在同一行加中文句的 Tatoeba 標示。適合 L1–3 或初學，等於在語境裡做中翻英。
- **題目格式**：「12. Only a__________ may watch that film.　Tatoeba #49532 by CK」。題號懸掛（同考卷的 18 pt 題號欄），英文 11 pt，標示 7 pt 灰色接在句尾（放不下就換到下一行）。每題設不跨頁。
- **說明**（句意填空標題下）：「依句意在空格內寫出一個英文單字；空格前的字母是提示。答案可能要寫成變化形（例如複數、過去式），請寫出完整的字。」

### 4.5 講義版例句（條目內）與句意填空的關係

- 條目例句的目標字用粗體標出，這正是 §4.3 盡量讓兩邊不同句的原因。
- 條目例句不要求「恰好一次」：只要求印得出來、不在排除清單裡。

### 4.6 品質的現實

- Tatoeba 的句子比學測詞彙題短，有些句子只看句意猜不出唯一答案（例如「He is very __.」）。對策：
  - 長度規則已排除 5 個字以下的句子；
  - 預設給首字母；
  - `within_level` 優先；
  - 答案頁寫「答案以例句原文為準；意思相通的其他字請老師斟酌給分」。
- 上線後依使用回饋擴充排除清單（§12 R4）。

## 5. 選字與選項介面

### 5.1 入口

| 位置 | 元件 | 帶進講義頁的來源 |
|---|---|---|
| 單字庫：結果數那一列（「共 1,002 筆」右側） | 文字按鈕「做成講義」（`FileText` 圖示）；有結果時才顯示 | `{ kind: 'filters', filters }`：目前的搜尋與篩選（含排序） |
| 錯題本：「錯題練習」區塊裡、「開始練習」按鈕旁 | 次要按鈕「錯題做成講義」 | `{ kind: 'mistakes' }` |
| 每日學習：「今日進度」卡片下方 | 文字連結「把加入學習的字做成講義」；沒有卡片時不顯示 | `{ kind: 'study', which: 'all' }` |
| 直接開 `/words?handout=1` | — | 上次用的來源（localStorage），沒有就預設 Level 3 第 1 份（50 字） |

- 入口都用 `pdfDownloadVisible()` 判斷顯示與否。
- 不新增第五個分頁：分頁列在手機上是四等分，320 px 時每格只有約 70 px。

### 5.2 講義頁（`/words?handout=1`）

- **網址與導覽**：
  - `navigation.ts` 加 `handout` 參數：`vocabSearch(tab, word, { handout: true })`、`useVocabLocation()` 多回傳 `handout`。
  - 開啟時和單字卡一樣蓋過分頁內容（分頁列的 `aria-current` 拿掉），捲到頂端。
  - 「返回」或關閉時回到原分頁和原本的捲動位置：沿用 `VocabModule` 的捲動還原；新增 `useCloseHandout()`，規則同 `useCloseWord()`（從模組內進來就 `navigate(-1)`，從外部連結進來就換成原分頁的網址）。`useCloseWord` 不改名，免得和桌機介面 PR C 衝突。
  - 來源放在 history state（`{ vocabHandoutSource }`，重新整理後還在）。
- **元件**：`views/HandoutView.tsx` 用 `React.lazy` 載入，載入中顯示 `LoadingBlock`。單字模組的主程式只多一個 import 與按鈕。
- **手機版**（單欄，由上而下）：
  1. 標題「做成講義」與一行說明：「在瀏覽器裡產生 A4 PDF，可以直接列印。每份都附句意填空，答案在最後、可以拆下。」
  2. **講義類型**：四個單選卡片（標題＋一行說明），用 `fieldset`／`legend`。
  3. **選字**：
     - 來源單選：級別範圍、單字庫篩選結果（只在從單字庫進來時出現）、錯題本（N 字）、每日學習的字（N 字）。
     - 選級別範圍時展開 `LevelPicker` 與「範圍」下拉（§5.3）。
  4. **選項**：常用的直接顯示；其餘收在 `<details>`「更多選項」（§5.4）。
  5. **摘要**（`role="status"`、`aria-live="polite"`）：「L4 第 201–300 字，共 100 字・約 16 頁・句意填空 81 題（19 字沒有合適的例句，列在答案頁）」；超過上限時加一行警告。
  6. **下載**：「下載 PDF」按鈕、進度（「載入單字資料…」→「載入 PDF 產生器…」→「下載字型…」→「排版中（約 16 頁）…」）、取消、完成後「分享／儲存到檔案」（iOS）與「在新分頁開啟 PDF」。另有「重新出題」按鈕：換一組選句與順序，講義代號跟著換。
- **規格**：
  - 觸控目標 ≥ 44 px；320 px 沒有水平捲動。
  - 長的字與檔名用 `break-words`。
  - 下拉選單用原生 `<select>`（同單字庫的 `FilterSelect`）。
- **桌機（≥ lg，依 desktop-ui）**：
  - 卡片 `lg:mx-auto lg:max-w-3xl`，同每日學習與測驗。
  - 主欄達 ws 寬度時改兩欄 `lg:@ws/main:grid-cols-[minmax(0,1fr)_18rem]`：左欄類型、選字、選項；右欄摘要與下載。右欄不 sticky（R10）。
  - 只有一棵樹，分欄只靠 CSS（R4）；新的 class 都帶 `lg:` 前綴（R1）。

### 5.3 選字來源與範圍

```ts
type HandoutSource =
  | { kind: 'levels'; levels: VocabLevel[]; range: { by: 'all' } | { by: 'letters'; from: string; to: string } | { by: 'part'; size: 50 | 100; part: number } }
  | { kind: 'filters'; filters: LibraryFilters }       // searchVocab() 的結果，照單字庫的排序
  | { kind: 'mistakes'; order: 'recent' | 'count' | 'alpha' }
  | { kind: 'study'; which: 'all' | 'due' };           // all：每日學習加入過的所有卡片；due：今天到期（isDue）
```

- **級別範圍**：
  - 依級別、再依字母排序（索引本來就照字母排）。
  - 「依份數」把排序後的清單每 50 或 100 字切成一份，下拉選單列出「第 3 份（201–300：ban – bulk）」，讓學生照份數逐週印。
  - 「依字母」用兩個下拉選起訖字母。
- **上限**：
  - 超過 600 字時只取排序後的前 600 字，摘要寫「超過 600 字，只收前 600 字；請改用『依份數』分成幾份」。
  - 0 字時下載按鈕停用並說明。
- **資料載入**：
  - 摘要的字數用 `index.json` 就能算（單字庫已經載過）。
  - 句意填空的題數與頁數要用到例句：講義頁打開後，自動載入選字涵蓋的各級檔案（`fetchLevels`，每級 gzip 240–630 KB，同一頁只下載一次）。下載中，摘要的題數顯示「計算中…」。
  - 錯題本或每日學習橫跨六級時約 2.4 MB（估計），摘要另寫「需要下載 L1–L6 的單字資料」。

### 5.4 選項與預設值

| 選項 | 適用 | 預設 | 備註 |
|---|---|---|---|
| 欄數 1／2 | 講義版 | 1 | 2 欄時停用「附例句」 |
| 附例句 | 講義版 | 開 | |
| 附音標 | 講義版、背誦版 | 開 | |
| 釋義 精簡／完整 | 講義版 | 精簡 | |
| 附不規則變化、附同詞族 | 講義版 | 開 | |
| 附同義／反義詞（只列詞彙表內的字） | 講義版 | 關 | 開了資料來源頁加 OEWN |
| 排序 依字母／歷屆次數／來源順序 | 講義版、背誦版 | 依字母（錯題本：依最近答錯） | |
| 遮哪一邊 遮中文／遮英文 | 背誦版 | 遮中文 | |
| 句意填空：首字母提示、顯示字母數、中文提示 | 全部 | 開、關、關 | |
| 句意填空題數 全部／50／30／20 | 全部 | 全部（最多 200） | |
| 測驗卷：中翻英拼字、英選中 | 測驗卷 | 開、開 | 句意填空不能關 |
| 附答案（最後，另起一頁可拆下） | 全部 | 開 | |
| 答案附詳解（整句與翻譯） | 全部 | 開 | 關掉時只有速查表 |
| 姓名欄 | 全部 | 開 | |
| 雙面列印 | 全部 | 關 | |
| 紙張 | — | A4 直式（只顯示，不能改） | |

- 上次用的類型與選項記在 `localStorage` 的 `gsat-vocab-handout:v1`（`{ type, options, levels, range }`），讀寫都包在 try/catch 裡，讀不到就用上表的預設。
- 來源不記：錯題本和每日學習每天都會變。

### 5.5 檔名

格式是 `學測英文中心_{類型}_{範圍}[_{N}字][_{YYYYMMDD}][_含答案].pdf`：

- 類型：單字講義、單字背誦版、句意填空、單字測驗卷。
- 範圍：
  - 級別範圍：`L4_第201-300字`、`L3-L5_A-C`、`L6_全部`。
  - 篩選結果：`單字庫篩選`。
  - 錯題本：`錯題本`。
  - 每日學習：`每日學習` 或 `今日複習`。
- 字數只在範圍本身看不出來時加（篩選、錯題本、每日學習）。日期也只加在這三種會變動的來源。
- `_含答案`：勾選附答案時加。
- 過濾檔名不允許的字元，同 `pdfFileName` 的 `safe()`。
- 例子：`學測英文中心_單字講義_L4_第201-300字_含答案.pdf`、`學測英文中心_句意填空_錯題本_45字_20261023_含答案.pdf`。

## 6. PDF 引擎的改動

### 6.1 資料流

1. 講義頁（主執行緒，lazy chunk）：
   - 來源 → 條目 id（`handout/selection.ts`）；
   - 載入各級檔；
   - `assembleHandout(entries, options, seed)`（`handout/assemble.ts`）完成選句、挖空、洗牌、出拼字與英選中題、算出授權字串，產生 `VocabHandoutPdfData`（純資料，可以 `postMessage`）。
   - 600 字約數十毫秒（估計），同時算出摘要要用的題數與頁數估計。
2. `renderVocabHandoutPdf(data, { onProgress, signal })`（`features/pdf/index.ts`，動態載入 `engine/render.ts`）→ Worker（`kind: 'vocab'`）→ `generateVocabHandoutPdf()` → `buildVocabHandoutDocDefinition(data)` → Blob。
3. 存檔、分享、新分頁開啟：沿用 `saveBlob` 與 `usePdfDownload`。

PDF 模組只認 `VocabHandoutPdfData`，不匯入單字模組；方向和自組卷相同（`engine/generate.ts`：「PDF 模組不匯入組卷程式」）。授權常數（`VOCAB_CREDITS`）由主執行緒放進資料裡，Worker 不必匯入 `src/data/vocab.ts`（它有載入器與頂層呼叫，會把資料存取程式帶進 Worker）。

### 6.2 介面約定（`features/pdf/vocabTypes.ts`，新增；`types.ts` 只加匯出）

```ts
export type VocabHandoutKind = 'notes' | 'recite' | 'cloze' | 'quiz';   // 講義版、背誦版、句意填空卷、測驗卷

export interface VocabHandoutPdfData {
  kind: VocabHandoutKind;
  code: string;                 // 講義代號
  kicker: string;               // 「學測英文中心　單字講義」
  title: string;                // 「Level 4　第 201–300 字」
  meta: string;                 // 「100 字・句意填空 86 題・2026-10-23 製作」
  howTo: string;                // 使用方式一行
  options: {
    columns: 1 | 2; examples: boolean; ipa: boolean; fullSenses: boolean; forms: boolean; family: boolean; synonyms: boolean;
    hide: 'zh' | 'en'; hint: { firstLetter: boolean; letterCount: boolean }; clozeZh: boolean;
    answerKey: boolean; keyDetails: boolean; nameFields: boolean; duplex: boolean;
  };
  groups: { heading: string; sub: string | null; words: HandoutWord[] }[];   // 講義版、背誦版；其他類型是空陣列
  cloze: ClozeItem[];
  spelling: SpellingItem[];     // 只有測驗卷
  choice: ChoiceItem[];         // 只有測驗卷
  skipped: { word: string; reason: 'no_sentence' | 'function_word' | 'over_limit' | 'no_distractors'; section: 'cloze' | 'spelling' | 'choice' }[];
  credits: { wordlist: string; ecdict: string; wordnet: string | null; tatoeba: boolean };  // 字串來自 VOCAB_CREDITS
}

export interface HandoutWord {
  no: number; id: string; word: string; variants: string[]; pos: string; level: number; ipa: string | null;
  senses: { label: string | null; text: string }[];
  derived: { form: string; ipa: string | null; zh: string }[];          // variant_info
  irregular: { label: string; form: string }[];
  family: { word: string; level: number }[];
  related: { synonyms: string[]; antonyms: string[] } | null;
  examTotal: number; gloss: string;
  example: { parts: { text: string; target: boolean }[]; zh: string; attribution: string; url: string; zhAttribution: string; zhUrl: string; zhConverted: boolean } | null;
}

export interface ClozeItem {
  no: number; wordNo: number | null;        // 講義版：對應的條目編號
  before: string; after: string;            // 空格前後的原文
  answer: string; base: string; formLabel: string | null; alsoAccepted: string[]; gloss: string;
  hint: string;                              // 依提示選項算好的空格文字（「a」或「a _ _ _ _ _」的字母部分）
  letters: number;
  zh: string; enAttribution: string; enUrl: string; zhAttribution: string; zhUrl: string; zhConverted: boolean;
}
export interface SpellingItem { no: number; prompt: string; pos: string; first: string; letters: number; answer: string; alsoAccepted: string[] }
export interface ChoiceItem { no: number; word: string; options: string[]; answerIndex: number; answerGloss: string }

export type RenderVocabHandoutPdf = (data: VocabHandoutPdfData, options: { onProgress?: (p: PdfProgress) => void; signal?: AbortSignal }) => Promise<Blob>;
```

所有字串在主執行緒就做完 §7.3 的正規化。版面程式只排版，不再判斷資料。

### 6.3 引擎與共用元件

| 檔案 | 改動 |
|---|---|
| `engine/protocol.ts` | `PdfWorkerRequest` 改成 `{ id, kind: 'exam', exam, options } \| { id, kind: 'vocab', data }` |
| `engine/render.ts` | 把建立 Worker、進度、取消、錯誤的部分抽成 `runJob(request, onProgress, signal)`；`renderExamPdf` 行為不變，另加 `renderVocabHandoutPdf`；沒有 Worker 的環境同樣改在主執行緒產生 |
| `engine/generate.ts` | 新增 `generateVocabHandoutPdf(data, onProgress, signal)`，共用 `loadPdfMake` 與進度階段 |
| `engine/pdf.worker.ts` | 依 `kind` 分派 |
| `index.ts` | 匯出 lazy 的 `renderVocabHandoutPdf` 與型別 |
| `usePdfDownload.ts`（新增） | 從 `ExamPdfDownload.tsx` 抽出狀態機：idle／busy／done／error、`warmed`、取消、`saveBlob`、iOS 分享、App 內建瀏覽器偵測、物件網址釋放。`ExamPdfDownload` 改用它，**輸出的 DOM 完全不變**（既有單元測試與視覺基準照樣通過） |
| `PdfDownloadStatus.tsx`（新增，選用） | 按鈕列、進度、完成後的分享與新分頁連結。講義頁用；`ExamPdfDownload` 要不要換用，看能否做到 DOM 不變，不能就不換 |

### 6.4 版面程式（`features/pdf/layout/vocab/`，新增）

| 檔案 | 內容 |
|---|---|
| `buildVocabHandoutDocDefinition.ts` | 依類型組 section：主體（標題區＋條目或對折表）→ 練習 → 資料來源 → 答案；`info`、`defaultStyle`、`pageBreakBefore: registry.pageBreakBefore`（只有雙面列印的段落開頭會用到） |
| `metrics.ts` | 版心：邊界 左右 50、上 64、下 58（講義比題本緊，約多 6% 字數，設計值）；字級與行高見 §3.3 |
| `chrome.ts` | `VocabPageChrome`：頁首頁尾，頁碼依段落記錄（同 `chrome.ts` 的「先呼叫全部頁首、再呼叫全部頁尾」做法）；答案另起頁碼；雙面列印的空白頁 |
| `title.ts` | 標題區（沿用 `fieldRow`） |
| `wordBlocks.ts` | 講義版條目：一欄與兩欄，分組標題（keepWithNext） |
| `recite.ts` | 背誦版表格與對折虛線 |
| `cloze.ts` | 句意填空題目、空格片段（首字母＋底線或字母格）、說明 |
| `quiz.ts` | 拼字、英選中（選項排法沿用 `options.ts` 的寬度判斷） |
| `answerKey.ts` | 速查表、詳解、未出題清單 |
| `credits.ts` | 資料來源與授權頁 |
| `strings.ts` | 講義 PDF 的所有固定文字 `VOCAB_PDF_TEXT`，以及粗體字串 `VOCAB_PDF_BOLD`（只能寫字串常值，字型檢查會讀這個常數，§7.2） |
| `testFixtures.ts` | 測試用的 `VocabHandoutPdfData`（含變化形、同詞族、沒有例句、IPA、雙面列印） |

沿用：`blocks.ts`（`flowBlocks`、`KeepRegistry`、`maybeUnbreakable`）、`richInline.ts`（`plainInline`、`runInlines`、`blankInline` 的寫法）、`estimate.ts`（高度估計）、`nodes.ts`（`fieldRow`、`boxLayout`）、`fontRuns.ts`。每個含中文的片段都要經過 `splitFontRuns`，不能直接寫 `{ text: '…' }`（mock-exam-pdf §10 R4）。

## 7. 字型涵蓋

### 7.1 現況（實測）

用現在的子集（`fonts/metrics.json`）檢查單字資料會印的字串，結果如下：

- **IPA 音標**：17 種符號沒有字形，例如 ˈ ə ː ɒ ʃ ʌ ɡ ˌ ʒ ɑ θ ɛ ɔ ɪ ɹ ʊ ɚ。原因是 `latinRanges` 只到 U+017F，這些字元被分給 Noto Serif TC，而中文子集裡沒有。
  - 原始的 Tinos 1.340（SHA-256 和 `subset_fonts.py` 鎖定的相同）有完整的 IPA Extensions 與 Spacing Modifier Letters（U+0250–02FF 共 176 個），也有 α β Г ǎ。
  - 歷屆試題目前沒有用到這些字，所以補進 Tinos 不會改變考卷 PDF 的字型分配。
- **中文**：釋義、衍生字、例句翻譯一共有 130 個字不在中文子集裡（佈 粘 糰 跤 勳 唇 噁 廄 侄 鮭 蜒…，加上 ＂ ﹐ ﹣ 三個標點）。原始的 Noto Serif TC 全部都有。
- **兩種字型都沒有的**：只出現在 2 句例句裡（cock 的一句中文有 CJK 擴充 B 的 𣬠 𣬶；communism 的一句有 ☭），不採用這兩句。
- **看不見的字元**：U+200B 出現在 3 句、U+202F 出現在 2 句。

### 7.2 做法

1. **子集化**（`scripts/fonts/subset_fonts.py`）：
   - `LATIN_WANTED` 加 IPA：U+0250–02AF，以及 U+02C8、U+02CC、U+02D0、U+03B8。三個 Tinos 檔一起加，因為 `fontRuns.ts` 假設 Tinos 的粗體和一般粗細涵蓋相同。
   - 新增 `collect_vocab_chars()`：呼叫 `node font-coverage.mjs --print-vocab-chars` 取得講義會印的字，中文併進 Noto Serif TC Regular；非中文且 Tinos 有字形的（α β ǎ），併進 Tinos。
   - 粗體子集收 `VOCAB_PDF_BOLD` 的字。
   - 重跑後更新 `metrics.json`（`latinRanges` 會自動包含新範圍）與 `fonts/README.md`。
   - 大小：中文 130 字約 +36 KB gzip（以現在每字約 0.28 KB 推算）；三個 Tinos 檔各加約 100 個字形（每個約 44 B gzip），合計約 +13 KB。總計約 +50 KB，字型從 1.54 MB 變成約 1.59 MB（估計）。
2. **檢查**（`scripts/font-coverage.mjs`）：
   - 新增 `vocabPrintableStrings(entry)`：依 §2.1 的「講義用法」列出會印的字串，分成兩類。
     - 「條目」：字頭、其他寫法、音標、會印的釋義行、`variant_info`、變化形、同詞族、詞彙表內的同義與反義詞。
     - 「例句」：英文、中文、兩個作者名。
   - 新增 `vocabPrintableCoverage(levelFiles)`：條目缺字是**錯誤**（建置失敗，同歷屆試題）；例句缺字只是**警告**（列出 Tatoeba 編號，講義不採用那一句）。
   - 新增 `--print-vocab-chars`。
   - `PDF_TEXT_FILES` 加 `layout/vocab/strings.ts`。
   - `PDF_DYNAMIC_FILES` 加三個檔：`../../data/vocab.ts`（`VOCAB_CREDITS`、`FORM_LABELS`、`VOCAB_POS_LABELS`）、`../vocab/lib/text.ts`（詞性短標籤）、`../vocab/handout/labels.ts`（標題、說明、範圍名稱）。
   - `VOCAB_PDF_BOLD` 的字不在粗體子集裡是錯誤（同 `SITE_PAPER_BOLD`）。
   - 直接執行時多讀 `public/data/vocab/L*.json`，印出「單字 6,012 筆、例句缺字 2 句（不採用）」。
3. **建置**（`scripts/build-data.mjs`）：`assertFontCoverage` 多傳各級條目。修法訊息同現在：照 `fonts/README.md` 重跑 `subset_fonts.py`。
4. **只加不改**：這次只加入目前任何子集都沒有的字元，所以歷屆卷、模擬考、自組卷每個字元選到的字型不變，文件定義也相同。PDF 檔裡嵌入的字型位元組會變，版面不會。用 `pdf-render-check.mjs` 的頁數與現有文件定義測試確認（§9）。

### 7.3 執行時的正規化與缺字防線

- `handout/printable.ts`：
  - `printableText(s)`：刪除 U+200B、U+FEFF；U+202F 和 U+2009 換成一般空白。
  - `isPrintable(s)`：用 `fontRuns.ts` 的 `missingGlyphs()`，它讀 `metrics.json`，在講義頁的 lazy chunk 裡約 16 KB gzip。
- 例句不能印 → 換下一句（§4.2 第 1 點）；條目欄位不能印（建置時就擋了，理論上不會發生）→ 那一行改印「（含 PDF 無法顯示的字，請到單字卡查看）」，不讓整份失敗。

## 8. 效能與上限

### 8.1 頁數估計（估計，WP0 校正）

| 內容 | 每頁 | 100 字 | 600 字 |
|---|---|---|---|
| 講義版（一欄、附例句） | 約 8 字 | 13 頁 | 75 頁 |
| 講義版（兩欄、不附例句） | 約 32 字 | 4 頁 | 19 頁 |
| 背誦版 | 約 34 字 | 3 頁 | 18 頁 |
| 句意填空題目（不附中文提示） | 約 26 題 | 4 頁 | 8 頁（200 題） |
| 答案：速查表＋詳解 | 約 17 題 | 1＋5 頁 | 1＋12 頁（200 題） |

最壞的情況是 600 字講義版＋200 題句意填空＋詳解，約 100 頁。摘要用 `handout/estimate.ts` 的係數顯示「約 N 頁」。

### 8.2 時間與記憶體預算（設計值）

| 情境 | 目標 |
|---|---|
| 100 字講義版，手機首次（含約 2 MB 引擎與字型、單級資料） | ≤ 10 秒 |
| 100 字講義版，桌機第二次 | ≤ 1.5 秒 |
| 600 字講義版，桌機 | ≤ 8 秒 |
| 600 字講義版，Chromium CPU 4 倍降速 | ≤ 30 秒；Worker 記憶體高峰 < 300 MB |
| 主執行緒 | 組資料 ≤ 100 ms（600 字，4 倍降速）；排版全部在 Worker，主執行緒最長停頓 < 50 ms |

- **WP0 先量**：在 scratchpad 用原型版面，在 Node 與 Chromium（含 4 倍降速）跑 600 字的講義版。
  - 比較基準：考卷 PDF 14 頁在 4 倍降速是 3.3 秒（mock-exam-pdf §2.2，實測），線性外推 100 頁約 24 秒。
  - 超過 30 秒，或記憶體不正常時：手機（`pointer: coarse` 且寬度 < 768）的講義版上限降為 300 字，摘要說明「手機上講義版一次最多 300 字，請分份」。背誦版與練習卷仍是 600。
- **產生中**：
  - pdfmake 排版沒有進度回報，所以進度文字寫「排版中（約 N 頁）…」。
  - 可以取消（終止 Worker）。
  - 講義頁保持可捲動。

### 8.3 分頁規則

- pdfmake 每次 `pageBreakBefore` 回呼回傳 true，就要重排整份文件（`blocks.ts` 檔頭）。一百頁的講義如果每個字母標題都靠回呼換頁，可能重排二十幾次。
- 所以：
  - 分組標題一律和後面第一個條目包成 `unbreakable` 的 stack（`flowBlocks` 的合併路徑，條目遠小於 `KEEP_LIMIT`）；
  - 每個條目、每題各自 `unbreakable`；
  - 背誦版表格設 `dontBreakRows`；
  - 只有雙面列印的三個段落開頭用 `duplexStart`（最多重排 3 次）。
- 單元測試確認：講義版的文件定義裡，除了 `duplex-*`，沒有登記其他 `KeepRegistry` id。

## 9. 測試

### 9.1 單元（Vitest，`npm test`）

| 檔案 | 測什麼 |
|---|---|
| `features/vocab/handout/selection.test.ts` | 四種來源 → id 清單；依份數與依字母的切法；排序；600 上限與警告；同字兩條目的處理；空來源 |
| `features/vocab/handout/cloze.test.ts` | 恰好一次（同形兩次、不同形兩次都不合格）；變化形整字挖空（adults、went、stopped、cancelled）；洩漏規則（同詞族、其他寫法、careful／care、well-known）；所有格與縮寫不用；長度；不能印的句子（含 U+200B 正規化後可用、☭ 不可用）；排除清單；同一句不重用；避開含其他答案的句子；講義例句盡量不同；種子相同結果相同、「重新出題」改變結果；四種提示字串；首字母大小寫；功能詞與無句子列入 `skipped`；題數上限依歷屆當正解次數取捨 |
| `features/vocab/handout/assemble.test.ts` | 每種類型的 `VocabHandoutPdfData`：只印不規則變化、短詞性標籤、`credits.wordnet` 只在印同詞族或同義詞時有值、拼字只出 L1–4 實詞、英選中干擾選項同級同詞類（沿用 `quiz.ts`）、題號連續 |
| `features/vocab/handout/fileName.test.ts` | §5.5 的例子、非法字元 |
| `features/pdf/layout/vocab/*.test.ts` | 各類型的 section 順序；答案是獨立 section；雙面列印時段落開頭有 `duplex-*`；講義版沒有其他 `pageBreakBefore` 登記；每個含中文的字串都用 `NotoSerifTC`（`cjkWithoutChineseFont`）；IPA 片段用 Tinos；每個例句與每題都有 Tatoeba 標示，題目上的英文標示沒有 `link`；答案字不出現在題目文字裡（`allText` 比對整字）；除了 `credits.wordlist` 那一句，不出現 `OFFICIAL_NAMES`；頁首頁尾（`renderChrome`）每頁都有詞彙表出處與講義代號，答案頁碼另起；資料來源頁只列用到的來源 |
| `features/pdf/layout/vocab/strings.test.ts` | 授權全文與版權行和 `data/vocab/CREDITS.md` 一致 |
| `features/pdf/usePdfDownload.test.ts`、既有 `ExamPdfDownload.test.tsx` | hook 狀態轉換；`ExamPdfDownload` 原有測試全部不改照樣通過 |
| `features/vocab/views/HandoutView.test.tsx` | 從單字庫帶入篩選、切換來源與類型、摘要題數、0 字停用、上限警告、按下下載時以預期資料呼叫（mock 的）`renderVocabHandoutPdf` 與檔名、localStorage 壞資料時用預設 |
| `features/vocab/navigation.test.ts`（新增或併入既有） | `handout` 參數的讀寫與關閉後回原分頁 |
| `scripts/font-coverage.test.ts` | `vocabPrintableStrings` 的分類；條目缺字是錯誤、例句缺字是警告；`VOCAB_PDF_BOLD` 缺粗體字是錯誤 |

### 9.2 整份產生檢查（手動，`scripts/pdf-render-check.mjs --ids vocab`）

- 在現有腳本加 `vocab` 組，同 `bank` 的做法：用 Vite 的 module runner 載入 `handout/assemble.ts` 與版面程式，讀 `public/data/vocab/`。
- 產生下列固定組合：
  - L1 第 1 份 100 字 × 四種類型；
  - L4 第 3 份 100 字的講義版雙面列印；
  - L6 全部（取前 600 字）的講義版；L1 前 600 字講義版＋全部選項＋雙面：最壞的情況（例句最多），同時記錄時間；
  - L5 全部 600 字的背誦版。
- 用 poppler 檢查：
  1. 不拋錯、`%PDF-` 開頭；頁數在 §8.1 估計的 ±25% 內；
  2. 每一頁都有詞彙表出處與講義代號；全文除了那一句出處，找不到機構名稱；
  3. 每個字頭、每題題號、每題的 Tatoeba 編號都取得到；
  4. 每題題目那一段文字裡找不到答案字（洩漏檢查），答案頁找得到；
  5. 答案從新的一頁開始，雙面列印時從單數頁開始；
  6. `pdffonts`：全部嵌入子集；`pdftotext` 取回的字頭與音標和資料一致（沒有缺字）；
  7. 印出每份的產生時間與頁數。
- 歷屆卷照舊全部跑一次，頁數與改動前相同（§7.2 第 4 點）。

### 9.3 e2e（`tests/vocab-handout.spec.ts`，桌機與手機 project）

1. 單字庫選 Level 4、搜尋前綴 → 「做成講義」→ 講義頁顯示篩選來源與字數 → 下載講義版：
   - `download` 事件；`%PDF-` 開頭；頁數 ≥ 3；
   - 檔名符合 §5.5，或是 `download`（POSIX 語系，mock-exam-pdf §4.4）。
2. 按下前沒有任何 `pdfmake`、`pdf.worker`、`.subset.ttf` 請求；`/words` 的一般 JS 不含 pdfmake（同 `pdf.spec.ts` 的 LAZY 檢查）。
3. 錯題本：先用 `addInitScript` 寫入兩個錯題 → 「錯題做成講義」→ 選句意填空卷 → 下載成功。
4. 直接開 `/words?handout=1`：預設 Level 3 第 1 份；改成背誦版、勾雙面列印 → 下載成功；「返回」回到單字庫。
5. 手機 375 與 320 px：講義頁沒有水平捲動；全程沒有 console error。

執行：`npm run build -w @gsat/web`，然後 `cd apps/web && E2E_PORT=<給定> npx playwright test tests/vocab-handout.spec.ts tests/vocab.spec.ts tests/pdf.spec.ts --reporter=line`。

### 9.4 其他必過的檢查

`npm run typecheck`、`npm test`、`npm run build`、`npm run test:data`、`npm run check:fonts -w @gsat/web`。

## 10. 工作項目與檔案

| WP | 內容 | 檔案 | 依賴 |
|---|---|---|---|
| **WP0** 量測 | 原型版面量 600 字講義版的時間與記憶體（§8.2），決定手機上限；選句規則在全資料上的統計（每級出題率、被排除的原因分布），寫回本文件 §4 與 §8 | scratchpad（不進 repo）；結果寫回本文件 | — |
| **WP1** 字型與檢查 | IPA 與單字資料的字補進子集；字型檢查加單字資料；建置接上 | `apps/web/scripts/fonts/subset_fonts.py`、`apps/web/src/features/pdf/fonts/*`（重新產生＋`README.md`）、`apps/web/scripts/font-coverage.mjs`、`apps/web/scripts/font-coverage.test.ts`、`apps/web/scripts/build-data.mjs`（只改 `assertFontCoverage` 的呼叫） | — |
| **WP2** 選字與組資料（純函式） | 來源、選句與挖空、拼字、英選中、授權字串、代號與種子、頁數估計、檔名、正規化、排除清單 | `apps/web/src/features/vocab/handout/{selection,cloze,assemble,printable,exclude,estimate,fileName,labels,options}.ts`＋測試；`lib/text.ts` 加 `zhSenseShortLabel`；`lib/forms.ts` 加 `isIrregularForm`；`testing/fixtures.ts` 補例句測資 | WP3 的型別 |
| **WP3** PDF 約定與引擎 | `vocabTypes.ts`、Worker 兩種工作、`renderVocabHandoutPdf`、`usePdfDownload` 抽出 | `apps/web/src/features/pdf/{vocabTypes,types,index,usePdfDownload,ExamPdfDownload}.ts(x)`、`engine/{protocol,render,generate,pdf.worker}.ts`＋測試 | — |
| **WP4** 版面 | §3、§4.4、§6.4 | `apps/web/src/features/pdf/layout/vocab/*.ts`＋測試 | WP1（字）、WP3 |
| **WP5** 介面 | 講義頁、入口、導覽參數、設定記憶 | `apps/web/src/features/vocab/{navigation.ts,VocabModule.tsx}`、`views/HandoutView.tsx`（＋子元件 `ui/HandoutSourcePicker.tsx`、`ui/HandoutOptions.tsx`、`ui/HandoutSummary.tsx`）、`views/{LibraryView,MistakesView,StudyView}.tsx`（只加入口）＋元件測試 | WP2、WP3 |
| **WP6** 檢查與文件 | 整份產生檢查、e2e、文件更新 | `apps/web/scripts/pdf-render-check.mjs`（`vocab` 組）、`apps/web/tests/vocab-handout.spec.ts`、`apps/web/src/pages/AboutPage.tsx`（pdfmake 用途加「單字講義」）、`docs/SPEC.md` §6.1（加一行指到本文件）、`docs/design/mock-exam-pdf.md` §4.1（檔案表加 `layout/vocab/`、`vocabTypes.ts`）、本文件「實作備註」 | 全部 |

- 順序：WP0 → WP1 與 WP3 並行 → WP2 → WP4 → WP5 → WP6。
- 和桌機介面的 PR C（同樣會改 `VocabModule.tsx`、`LibraryView.tsx`、`StudyView.tsx`、`MistakesView.tsx`）可能衝突。單字庫、錯題本、每日學習這三個檔案只加一個按鈕；講義頁本身是新檔案。先合併的一方在 PR 說明裡列出改動的行，讓後合併的一方處理衝突。

## 11. 驗收清單

| # | 類別 | 標準 |
|---|---|---|
| V1 | 必要 | 四種類型都能從三個入口與直接網址下載；桌機與手機 e2e 通過 |
| V2 | 必要 | 每一份都有句意填空；答案是獨立段落、另起頁碼，雙面列印時從單數頁開始 |
| V3 | 必要 | 句意填空：題目文字裡找不到答案字（整字比對）；同一句不重複；變化形整字挖空，答案頁寫原形；未出題的字列在答案頁並寫原因 |
| V4 | 必要 | 授權：每頁頁尾有 `VOCAB_CREDITS.wordlist`；每句例句與每題都有 Tatoeba 標示；資料來源頁有 ECDICT 的 MIT 全文，用到同詞族或同義詞時有 OEWN 與 Princeton 聲明；沒有 CEFR；除了那一句出處，沒有「大考中心」「CEEC」；沒有 AI 模型名稱 |
| V5 | 必要 | 字型：`check:fonts` 通過；條目缺字為 0；`pdffonts` 全部嵌入子集；講義與歷屆卷的 PDF 都沒有方框 |
| V6 | 必要 | 一般頁面的 JS 不變大：按下前不載入引擎與字型；`/words` 的主 chunk 不含 pdfmake 與 `metrics.json` |
| V7 | 必要 | 歷屆卷、模擬考、自組卷的文件定義與頁數不變（既有單元測試、`pdf-render-check.mjs`） |
| V8 | 必要 | 320、375、390 px 沒有水平捲動；≥ 1024 px 符合 desktop-ui R1–R11；只用鍵盤可以完成選字、選項與下載 |
| V9 | 必要 | §8.2 的時間預算（或依 WP0 調整後的上限）在 `pdf-render-check` 與 Chromium 4 倍降速下達成 |
| V10 | 體驗 | 實機：iPhone Safari 與 Android Chrome 各下載一份 100 字講義版並用內建檢視器打開，記錄時間（同 mock-exam-pdf P8） |
| V11 | 體驗 | 站主或老師抽查 L3、L4、L5 各 30 題句意填空，判斷「依句意可以寫出答案」的比例 ≥ 85%（設計值），結果寫回 §4.6 |

## 12. 風險

| # | 風險 | 影響 | 對策 |
|---|---|---|---|
| R1 | 長講義在低階手機排版太久或記憶體不足 | 分頁被系統重載、下載失敗 | WP0 實測決定上限；在 Worker 裡排版；摘要顯示頁數與「手機較慢」；可以取消；建議分份 |
| R2 | pdfmake 因 `pageBreakBefore` 反覆重排 | 時間暴增 | §8.3：只用不跨頁區塊，測試擋住多餘的登記 |
| R3 | Tatoeba 例句內容不適合印給學生（俚語、粗話，例如 loser 那一句的中文用了「屌絲」） | 老師不敢用 | `handout/exclude.ts` 的排除清單：WP2 用一份敏感字詞清單掃過全部例句，人工確認後收錄；之後依回報增補。單字卡畫面不受影響 |
| R4 | 句子短，有時依句意不能確定唯一答案 | 學生挫折 | 預設首字母提示、`within_level` 優先、長度規則；答案頁說明可斟酌給分；V11 抽查 |
| R5 | 老師把答案拆掉、或只印部分頁面，例句標示跟著不見 | CC BY 標示不完整 | 標示放在每一題旁邊，不放在答案頁；每頁頁尾有來源摘要 |
| R6 | 詞彙表只能非營利使用，補習班可能拿講義收費 | 授權爭議 | 頁尾與資料來源頁寫「非營利使用」；網站本身免費、PDF 不放廣告；營利使用不在本站控制範圍，關於頁已有說明 |
| R7 | 字型子集擴充後，歷屆卷的 PDF 位元組改變 | 誤以為版面變了 | 只加新字元；用文件定義測試與頁數比對證明版面不變（V7） |
| R8 | 詞彙資料改版加入新的罕用字 | 建置失敗 | 錯誤訊息直接寫修法（重跑 `subset_fonts.py`，約 6 秒）；例句缺字只警告 |
| R9 | 和桌機介面 PR C 同時改單字模組的四個檔案 | 合併衝突 | §10 的協調方式；入口只加按鈕 |
| R10 | iOS 下載、LINE 等內建瀏覽器擋下載 | 拿不到檔案 | 沿用考卷 PDF 的分享按鈕、新分頁開啟與提示（`usePdfDownload`） |
| R11 | IPA 是英式為主，台灣學生習慣 KK | 學生看不懂音標 | 資料來源頁寫「IPA（英式為主）」；可以關掉音標；KK 列為待決 |

## 13. 待站主決定（附預設值）

1. **KK 音標**：資料只有 ECDICT 的 IPA（英式為主），從 IPA 自動轉 KK 會錯（英式與美式的母音、r 音不同）。**預設**：只印 IPA，可關；之後若取得可授權的美式音標資料再加 KK。
2. **搭配詞**：資料還沒有（關於頁標示規劃使用 Datamuse／Google Books Ngram，經人工抽查）。**預設**：v1 不印，版面在不規則變化那一行之後預留一行；搭配詞資料上線後打開。
3. **用本站 AI 寫的句子補足沒有例句的字**：L5 有 34%、L6 有 51% 的實詞沒有合格句子。**預設**：v1 只用 Tatoeba；之後另開一批「單字例句」AI 出題，照學測詞彙題的規格、標「AI 撰寫」並經審核，專門補 L4–6。題庫詞彙題題幹不拿來用（只能補 44 字）。
4. **紙張**：學校常用 B4。**預設**：只有 A4（印表機都可以縮放到 B4）。
5. **收藏功能**：本站沒有「收藏／星號」。**預設**：用「每日學習的字」代替；收藏功能另案。
6. **例句排除清單**：**預設**：由實作者掃描後人工確認，清單放在程式裡（`handout/exclude.ts`），不改 `data/vocab/`。
7. **句意填空的預設提示**：**預設**：首字母開、字母數關、中文提示關。
8. **上限**：**預設**：600 字、句意填空 200 題、拼字與英選中各 100 題；WP0 後可能把手機上的講義版降為 300 字。
9. **背誦版也附句意填空**：依「單字講義還附有句意填空」，**預設**：四種都附、不能關。測驗卷的拼字與英選中可以關。
10. **獨立封面頁**：**預設**：不要，第 1 頁上方印標題區，省紙。
11. **CEFR**：**預設**：講義不印（避免 CC BY-SA 相同方式分享的義務）。
12. **單一單字卡的 PDF**：**預設**：不做；要印一個字就在單字庫用搜尋篩出來再做成講義。

## 實作備註

2026-10-23 實作完成後，和上面各節不同的做法、以及設計時寫「WP0 量測」「依實測校正」的數字，記在這裡；兩者不一致時以這一節為準。
§11 的 V10（實機下載）與 V11（老師抽查句意填空）需要人做，還沒有做；§13 的待決事項都照預設值實作。

### 句意填空的出題率與排除（§4、R3）

全部 6,012 筆用實際的選句規則（`handout/cloze.ts` 的 `clozeRejectReason`，含同詞族的變化形）統計；實詞＝第一個詞類是 n.／v.／adj.／adv.：

| 級別 | 實詞 | 有合格句子 | 出題率 | 2 句以上 | 沒有任何例句 | 功能詞（不出題） |
|---|---|---|---|---|---|---|
| L1 | 922 | 913 | 99.0% | 905 | 1 | 80 |
| L2 | 986 | 952 | 96.6% | 896 | 30 | 16 |
| L3 | 996 | 893 | 89.7% | 758 | 94 | 6 |
| L4 | 998 | 808 | 81.0% | 615 | 181 | 4 |
| L5 | 997 | 650 | 65.2% | 387 | 341 | 5 |
| L6 | 1,000 | 484 | 48.4% | 204 | 503 | 2 |
| 合計 | 5,899 | 4,700 | 79.7% | | | 113 |

- L3–5 是 2,351／2,991＝78.6%。沒有出題的字幾乎都是「資料裡沒有例句」，不是規則太嚴。
- 實詞的 17,119 句例句：合格 16,626；目標字出現 0 次或 2 次以上 341；排除清單 79；洩漏答案 43；長度不合 20；中文句含答案的英文 9；有字型沒有的字 1。
- 排除清單（`handout/exclude.ts`）：用英文、中文各約 50 個敏感詞掃過 12,291 句不重複的例句，命中 273 句，逐句判斷後收 55 個編號（性 25、粗話與罵人 16、吸毒 2、自殺 7、政治宗教族群爭議 5）；英文句或中文句的編號都比對。
- 資料測試（`scripts/lib/vocab-handout.data.test.ts`）擋出題率退步（L3 > 85%、L4 > 75%、L5 > 60%），並把 L3–5 每 100 字一份的句意填空卷全部組一次，確認題目文字裡找不到答案的任何形式、同一份沒有重複的句子。

### 頁數與時間（§8）

`node apps/web/scripts/pdf-render-check.mjs --ids vocab`（Node 22，開發機；排版是第 n 份時的時間，第一份含 JIT 暖機；2026-10-23 審查修正後重量，測驗卷改成每個字只出一個部分）：

| 組合 | 頁數（估計） | 組資料 | 排版 | 內容 |
|---|---|---|---|---|
| L1 第 1 份 講義版 | 25（25） | 73 ms | 1.09 秒 | 條目 13、練習 4、資料來源 2、答案 6；句意填空 79 題 |
| L1 第 1 份 背誦版 | 15（15） | 16 ms | 0.49 秒 | 對折表 4、練習 4、資料來源 1、答案 6 |
| L1 第 1 份 句意填空卷 | 11（11） | 15 ms | 0.36 秒 | 練習 4、資料來源 1、答案 6 |
| L1 第 1 份 測驗卷 | 10（10） | 49 ms | 0.28 秒 | 練習 5（句意填空 27、拼字 26、英選中 28）、答案 4 |
| L4 第 3 份 講義版雙面 | 27（27） | 28 ms | 1.10 秒 | 補 1 張空白頁；練習、資料來源、答案都從單數頁開始 |
| L6 前 600 字 講義版 | 84（86） | 135 ms | 2.52 秒 | 條目 59、練習 9、答案 14；句意填空 200 題 |
| L5 600 字 背誦版 | 44（44） | 124 ms | 1.61 秒 | 對折表 19、練習 10、答案 14 |
| L3 第 2 份 講義版兩欄 | 16（17） | 23 ms | 0.66 秒 | 條目 4 |
| L3 第 2 份 句意填空卷＋中文＋字母數 | 13（14） | 18 ms | 0.47 秒 | 練習 6 |
| **L1 前 600 字 講義版＋全部選項＋雙面**（最壞情況） | 116（107） | 188 ms | 4.60 秒 | 條目 86、練習 13、資料來源 2、答案 14、空白 1；句意填空 200 題 |
| L1 前 600 字 測驗卷 | 37（39） | 223 ms | 1.09 秒 | 練習 19（句意填空 200、拼字 100、英選中 100）、答案 17 |

**最壞的情況是 L1（或 L2）前 600 字講義版開全部選項（完整釋義、同義反義、中文提示、字母數）＋雙面，約 116 頁**，不是原先記的「L6 前 600 字」：
L6 很多字沒有例句，反而是最輕的 600 字講義版（84 頁）。`pdf-render-check` 已加上這一份與 L1 前 600 字測驗卷，之後排版變慢會看得到。

Chromium（建置後的產物、`vite preview`）：

- CDP 不能讓 Worker 降速（`Emulation.setCPUThrottlingRate` 對 Worker 回「Operation is only supported for pages, not workers」）。所以 4 倍降速是把 `Worker` 拿掉、讓引擎改在（降速的）主執行緒排版來量，當作慢手機上 Worker 時間的上限：
  - 最壞情況（L1 前 600 字＋全部選項＋雙面、116 頁）：第一次 28.6 秒（含下載引擎與字型）、第二次 25.1 秒（2026-10-23 審查修正後，開發機負載約 3）；審查時另一台機器量到 29.8／20.8 秒。都在 30 秒預算內，但只剩約 5% 的餘裕。
  - L6 前 600 字講義版（85 頁）：第一次 13.1 秒、第二次 11.4 秒。
  - 100 字講義版（L1 第 1 份、25 頁）：第一次 7.4 秒、第二次 4.6 秒（預算 10 秒）。
- 不降速、用 Worker：最壞情況 5.3–6.9／4.4–5.8 秒（桌機 1280，預算 8 秒）；L6 600 字 3.7／2.8 秒；100 字 1.9／1.4 秒（手機 375 模擬）。Worker 的 JS heap 高峰：最壞情況 112–163 MB（每 0.1 秒取樣）、L6 600 字 108–118 MB、100 字 42 MB，都在 300 MB 預算內。
- 依最壞情況重新判斷：時間與記憶體都在 §8.2 的預算內，所以**手機的講義版上限維持 600 字**（`HANDOUT_LIMITS.notesOnPhone` 等於 `words`，介面沒有另外的手機上限與說明）。餘裕很小：之後講義版的內容變多（例如加搭配詞），先重量這一份；超過 30 秒就照 §8.2 把手機的講義版上限降為 300 字。
- 主執行緒：下載時沒有長任務（排版全在 Worker）。組資料是一個長任務，4 倍降速下按「重新出題」：L1 前 600 字測驗卷 125–164 ms、L1 前 600 字講義版＋全部選項 136–219 ms（含 React 重繪；`useDeferredValue` 讓勾選框先更新，摘要晚一拍），比 §8.2 的 100 ms 多。審查時測驗卷是 157–292 ms（本次修正前在開發機量到 367–556 ms：分題後英選中每題都把整級幾百個字檢查一遍），改成「先洗牌、湊滿三個干擾選項就停」（`lib/quiz.ts` 的 `pickDistractors`，隨機策略）與依條目快取條目例句的排序後降到上面的數字。要壓到 100 ms 以下得把 `assembleHandout` 搬進 Worker（每次改選項都要把幾千個條目傳過去，或讓 Worker 自己載入各級檔），列為之後的工作。
- 為了這個時間做的快取（結果不變）：`cloze.ts` 依條目快取合格句子（同一個 `lookup` 才沿用，講義頁的 `lookup` 依已載入的條目陣列固定）與每個字的形式；`printable.ts` 依字串快取 `isPrintable`；`lib/quiz.ts` 的 `pickDistractors` 依條目快取正規化後的其他寫法與同義詞；`assemble.ts` 依條目快取條目例句的排序與形式表。Node 上 600 字重新組資料：講義版 37–54 ms、測驗卷 23–43 ms（L1）。

`handout/estimate.ts` 的係數依上表校正：講義版有例句的字每頁 8 個、沒有例句的 14 個、兩欄 30 個；背誦版 32；句意填空 22（附中文 16）；拼字 32；英選中 15；答案速查 160、詳解 16、拼字與英選中答案列 70。原本九份的估計都在 1 頁以內；最壞情況那一份估 107 頁、實際 116 頁（完整釋義與同義反義讓條目變高，差 8%），`pdf-render-check` 容許 ±25%（至少 1 頁）。

### 字型（§7）

- 子集：中文內文 5,083 → 5,219 字（+39 KB gzip）、粗體 466 → 494 字（+8 KB）、Tinos 三個字重各 363 → 467 字（IPA Extensions、ˈ ˌ ː ˑ、θ，以及資料裡的 ǎ α β；各 +6–7 KB）。合計 1.54 → 1.61 MB（gzip）。
- **只加不改**的驗證：六個字型的新字元表都包含舊的、共同字元的字寬全部相同；舊字元選到的字型（`latinRanges`／`emojiRanges`）0 個改變；用舊字型與新字型各跑一次 `pdf-render-check`（66 份歷屆卷＋6 份模擬考版＋3 份自組卷的 12 種變化，共 84 個 PDF），頁數、各段頁數與 `pdftotext -layout` 的輸出完全相同。
- `subset_fonts.py` 改成保留原始字型的 `head.modified`（`recalcTimestamp=False`），同樣的輸入每次產生的檔案位元組都相同（README 原本就寫「輸出可重現」，之前其實會寫入產生的時間）。所以 Noto Emoji 的字形沒有變，檔案位元組也跟著換了一次（只差 `head` 的時間）。
- Noto Serif TC 本身沒有的字：☭ 與擴充 B 區的 𣬠 𣬶，在兩句例句裡（Tatoeba #1257568、#2806272），講義不採用；`check:fonts` 只警告。條目欄位沒有缺字。

### 和上面各節不同的做法

1. **使用方式的頁碼**（§3.2 第 5 點）：寫成「句意填空起始頁：9」，放在使用方式框右邊自己一格（`auto` 寬），用 pdfmake 的 `pageReference` 指到「句意填空」標題的文字節點。原因（pdfmake 0.3.11）：`pageReference` 只在文字節點的第一行會被換成頁碼（`LayoutBuilder` 只替第一行設 `_pageNodeRef`，和使用方式寫在同一段、換到第二行時印出佔位的 `00000`）；`stack` 沒有位置紀錄，id 要放在文字節點上；量寬度時用 5 位數的佔位字，換成頁碼後後面留白，所以頁碼一定在行尾。雙面列印時補的空白頁不算頁碼，`pageReference` 給的頁碼會對不上，所以不寫頁碼。句意填空卷與測驗卷的練習從第 1 頁開始，也不寫。`pdf-render-check` 檢查這個頁碼等於練習實際的起始頁、全文沒有 `00000`。
2. **使用方式的文字**：講義版「先讀單字與例句，再做後面的句意填空。」（兩欄或不附例句時「先讀單字，…」）、背誦版「先用對折背誦表自我測驗，再做句意填空。」、句意填空卷「依句意在空格內寫出單字。」、測驗卷依實際印出的部分數寫「共三部分，題號連續。」或「共兩部分，題號連續。」（只有句意填空時同句意填空卷），附答案時都接「答案在最後，另起一頁，可以整疊拆下。」
3. **級別標籤**：pdfmake 行內文字的 `background` 會塗滿整個行高，所以講義版一欄的條目把級別畫成右上角的框線小方塊（和「歷屆 N 次」同一行），兩欄、同詞族與背誦版用灰色小字。
4. **背誦版**：每個分組一個表格，`headerRows: 1`＋`keepWithHeaderRows: 1`＋`dontBreakRows`（跨頁時表頭重印、不把一列拆開）；欄寬 □、No.、英文、中文＝10、22、*、*，中線畫虛線當對折線。
5. **標題與檔名**：標題不寫 CEFR 篩選（§13 第 11 點）。來源超過一份的上限、只收前 600 字時，標題寫「Level 6　第 1–600 字」「單字庫篩選結果　L3–5・第 1–600 字」「錯題本　第 1–600 字（共 700 字）」，檔名寫「L6_第1-600字」，不寫「全部」。
6. **釋義**：ECDICT 把專業領域寫在釋義開頭的方括號、沒有標 `domain` 的行（「[計] 累加器, …」，目前只有 a 這個字）同樣不印。
7. **未出題的原因**：測驗卷每個字只出一個部分，三部分都出不了才列（Level 5–6 的字改出句意填空或英選中，不再列「拼字只出 Level 1–4」）；另有 `shown_elsewhere`（拼字的答案出現在句意填空的句子裡、或和英選中某題的正確選項同義，又沒辦法改出英選中）。答案頁的「未出題的字」每種原因最多列 80 個字，其餘寫「…等 306 字」。
8. **答案頁**：標題與兩條說明 → 每個部分一張「答案速查」（5 欄）→ 句意填空詳解（整句、答案粗體；答案不是原形時寫「原形 bird・複數」；短釋義；講義版接「→ 講義 #12」；中文翻譯；英文與中文的 Tatoeba 標示，含連結）→ 拼字、英選中的答案列 → 未出題的字。
9. **測試檔**：§9.1 的 `features/pdf/layout/vocab/strings.test.ts` 改成 `scripts/lib/vocab-handout.data.test.ts`（data 專案，`npm run test:data`）：它要讀 `data/vocab/CREDITS.md` 與 `public/data/vocab/`，而 `src` 的 tsconfig 不載入 Node 型別。同一個檔案也放真實資料的出題率、洩漏與「全部條目印得出來」的檢查。另加 `features/vocab/navigation.test.ts`、`features/vocab/handout/fileName.test.ts`、`features/pdf/usePdfDownload.test.tsx`。
10. **`pdf-render-check` 的 `vocab` 組**：除了 §9.2 的七份，另加「L3 第 2 份講義版兩欄」與「L3 第 2 份句意填空卷＋中文提示＋字母數」兩種選項組合。洩漏檢查依 `pdftotext -layout` 的行首題號切出每題的文字（去掉頁首頁尾與 Tatoeba 標示），整字比對答案。不加 `--ids` 時和歷屆卷、自組卷一起跑（全部約 64 秒）。
11. **桌機版面**：講義頁 `lg:max-w-3xl` 置中；主欄到 ws 寬度時改成兩欄（設定｜18rem 的摘要與下載）、最寬 `max-w-5xl`。
12. **鍵盤**：類型與來源是原生 radio、選項是原生 checkbox 與 select，e2e 加一個只用鍵盤的測試（方向鍵換類型、空白鍵勾選項、Enter 下載）。

### 審查後的修正（2026-10-23）

實作完成後的審查找到的問題與修法。和上面各節不同時以這裡為準。

1. **答案頁的「亦可」不再印錯字**：原本拿線上拼字題的 `americanize()`（只用來比對學生輸入，轉完剛好等於答案才採用）倒過來產生其他寫法，-our、-ise、-ence 的字尾規則印出 hor、sciense、promize、conveniense 這種錯字（全部合格句子 117 組裡只有 dialog、canceled、traveling 是對的）；原表斜線的寫法也全部照收，actor 列出 actress、airplane 列出 plane、no 列出 nope。改成只列真正的拼法差異（`cloze.ts` 的 `alsoAcceptedFor`）：英式雙 l 只在資料（ECDICT，美式）的同一形式是單 l 時列（cancelled → canceled；compelled 的資料就是雙 l，不列）；英式拼法的字頭用手寫對照（詞彙表只有 dialogue、catalogue 兩個）；斜線寫法只收手寫清單裡只是拼法不同的幾組（adviser／advisor、judgment／judgement、disk／disc…），性別配對、單複數、縮寫與口語、-ward／-wards 都不收；和印出的提示（首字母、字母數）不合的不列。測驗卷拼字題的「亦可」同樣要符合首字母與字母數。全部合格句子現在只有 6 組「亦可」，都是資料裡真的有的寫法（`vocab-handout.data.test.ts` 擋住）。答案頁的通則改成「拼法依例句；答案後面「亦可」列出的拼法也算對。」。
2. **測驗卷每個字只出在一個部分**（`assemble.ts` 的 `partitionQuiz`）：原本三部分用同一批字，拼字的題目（短釋義）正是英選中同一個字的正確選項，英選中又把英文字印出來（L1 第 1–100 字 79／79 題都這樣），句意填空的答案字也全部出現在英選中。現在依「歷屆當正解次數」把字分到能出、題數最少的部分，再把能改出的字移到題數少的部分，三部分大約各三分之一（100 字的 L1–L4 約 27–34／26–33／27–33 題，L5–6 句意填空與英選中各約 50 題）；句子被別的字搶光、找不到干擾選項的字改出其他部分，有空位時再從「超過題數上限」的字遞補。另外擋兩種跨部分的洩漏：選句意填空的句子時，含拼字答案（任何形式）的句子 −1 分（同「含其他題答案」）；還是露出來、或拼字提示和英選中某題的正確選項相同時，改出英選中，不行就列在未出題（`shown_elsewhere`「答案出現在句意填空的句子裡」）。L1–L6 每 100 字一份、各重新出題一次，沒有一個字需要這樣處理；600 字時 L1 有 17 個字、L2–L4 各 2–4 個字，拼字的空位由超過題數上限的字遞補（仍是 100 題）。
3. **測驗卷的使用方式**依實際印出的部分數寫「共三部分」「共兩部分」，只有句意填空時同句意填空卷（Level 5–6 沒有拼字、或取消了某一部分）。
4. **不換行空白造成的超出右邊界**：pdfmake 0.3.11 把片段頭尾的空白（含不換行空白）算成行尾可截掉的寬度，量「黏在一起、不能分行」的幾個片段時扣掉了這些寬度，整串放不下時超出右邊界（實測最多 5.3 pt），斷行也落在標示中間（「…rate?   Tatoeba」／「#13789360 by frpzzd」、「同」／「義」、行尾孤零零的「→」）。改成：以不換行空白開頭或結尾的片段都設 `preserveLeadingSpaces`／`preserveTrailingSpaces`（寬度才算得對）；Tatoeba 標示、「→ 講義 #12」、小標＋第一個字是「不拆開的一段」（段內用不換行空白、片段不在中間換行，`inlines.ts` 的 `unitInlines`），前面接一般空白，放不下就整段換到下一行；字頭行的字、音標、詞類之間改成一般空白（窄欄可以換行）。`pdf-render-check` 加 `pdftotext -bbox` 檢查：任何一個字超出版心左右邊界就失敗（拿掉上面的屬性時，L6 前 600 字與最壞情況那兩份都會被抓到）。
5. **最壞情況的時間**：見上面「頁數與時間」。
6. **條目例句**：句中有字頭（或它的變化形）的句子優先，其次才是 within_level；剩下的句子都沒有字頭時，寧可和句意填空同一句。句中只有原表其他寫法或衍生字時（actor 的 actress、airplane 的 plane、develop 的 development），那個字標粗體；含句點的字頭與寫法（a.m.、Mr.）整段比對。全部 6,012 字的講義版只剩 shall（例句只有 should）沒有粗體。
7. **和功能詞同形的字**（`exclude.ts` 的 `FUNCTION_HOMOGRAPHS`）：mine（n./v. 礦、開採）的例句全是代名詞「a friend of mine」，句意填空卻配「礦, 礦藏, 地雷」。這種條目的例句只有句中是變化形（mines、mined）才用，原形的句子既不出句意填空、也不印成條目例句。檢查全部條目，只有 mine 一筆；長期應在資料管線就排除。
8. **講義頁**：
   - 打開時焦點移到「做成講義」標題（同單字卡）：從單字庫、錯題本的入口按 Enter 打開時，焦點原本掉到 body，下一個 Tab 跳到頁尾的授權聲明。
   - 每日學習的來源選項固定寫「加入學習的所有字」的字數，到期的字數寫在「每日學習的範圍」的選項上；目前選著的來源一律不停用（原本選「今天到期」而今天沒有到期的字時，選項變成 0 字並停用，換到別的來源後回不去）。
   - 超過 600 字的說明依來源：級別範圍才叫人「依份數」分份；篩選結果建議縮小篩選或改用級別範圍，並有「改用級別範圍分份」按鈕（帶入篩選的級別、每份 100 字第 1 份）；錯題本、每日學習說明收了哪 600 字。這一行改用提醒的底色。
   - 錯題本預設「依來源順序」只用在錯題本來源、而且這次沒有改過排序時，不寫進記住的設定（原本從錯題本進來一次，之後所有講義都沒有 A、B、C 小標）。
   - 「更多選項」加會轉向的箭頭（`flex` 會拿掉瀏覽器內建的展開記號）。
9. **音標的出處**：14 筆的音標取自 Open English WordNet（CC BY 4.0、美式標音），不是 ECDICT。`build-data.mjs` 在這些條目多寫一欄 `ipa_source: "oewn"`（公開資料檔只多這一個選填欄位，其他條目沒有這一欄）；講義印到這些音標時，資料來源頁加 OEWN 一項（列出是哪些字、附 Princeton WordNet 聲明），ECDICT 那一項註明「其中 N 個字的音標取自 Open English WordNet」，頁尾也寫「部分音標：Open English WordNet（CC BY 4.0）」。單字卡畫面的出處沒有改。
10. **授權條款的網址**印在資料來源頁：Tatoeba 的 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/）與 CC0 1.0（https://creativecommons.org/publicdomain/zero/1.0/）、OEWN 的 CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。CC BY 要求每份複本附授權條款或它的網址，同考卷 PDF 的資料來源頁。
11. **只寫這份講義成立的說明**：「完整的原句印在答案頁」只在附答案且答案附詳解時寫；「歷屆出現次數」一項只在講義版、而且有字印了「歷屆 N 次」時列；頁尾第 2 行起依實際用到的來源組成（沒有例句時不寫 Tatoeba，用到 OEWN 時寫它），放不下時在項目之間分行。
12. **只有專業領域釋義的字**（Internet、hacker 只有一行「計」）照印那一行、不印領域標籤，講義版的條目不會沒有釋義。
13. **不規則變化**：規則拼法不再列成不規則——重複字尾子音（upped、quitting、equipped）、-c 加 k（picnicked）、-ch 唸 /k/ 只加 s（stomachs、monarchs）、英式的 l 重複（crueller）、單音節 -y 形容詞保留 y（shyer）；判斷時不看條目的詞類（資料有這個形式就照它的規則）。本身就是複數形的名詞（clothes、jeans、scissors、goods…）不再印「clothes（複數）clothes」；sheep、cattle 這種單複數同形、cut 這種過去式和原形同形的照列。全部條目的不規則變化從 243 筆降到 217 筆。
14. **元件測試的 lazy 等待**：講義頁是 lazy 載入的，第一個測試在機器忙時等不到 1 秒的預設逾時；改成先在 `beforeAll` 載入講義 chunk，等待也放寬到 10 秒。
