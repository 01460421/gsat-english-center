# 單字資料的來源與授權標示

> 本檔由 `tools/build_vocab.py` 產生，請勿手動修改。對應 `docs/research/04-data-sources-licensing.md` §2、§7.1、§7.3。
> `lexicon.json`（或 `lexicon-L1.json`…`lexicon-L6.json`）與 `forms-index.json` 混合了下列來源；每個欄位的來源見最後一節。
> 原始檔的網址、版本、下載日期與 sha256 記錄在 `data/vocab/sources.json`。

## App 內標示文字（照 04 文件 §7.1）

| 位置 | 標示文字 |
|---|---|
| 單字卡（詞、級別、詞類） | 詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》 |
| 音標、中文釋義、詞形變化 | 音標、中文釋義與詞形變化：ECDICT（MIT License），中文經 OpenCC 轉為台灣繁體 |
| 同義詞、反義詞、上位詞、英文釋義 | 同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet |
| 例句 | 每句旁小字顯示「Tatoeba #句子ID by 作者名」並連到 `url`；中文翻譯另外標「中文 Tatoeba #zh_id by zh_author」 |
| CEFR 參考等級 | 「約 CEFR B1」，並標示「CEFR 對照依 CEFR-J Wordlist」；C1／C2 來自 Octanove（CC BY-SA 4.0） |
| 外部辭典 | 按鈕「在 Cambridge 辭典查看」（只外連，新分頁開啟） |
| Credits 頁 | 列出本檔各節的完整聲明 |

不在介面顯示 Collins 星級或 Oxford 3000 標記（04 文件 §7.4）。`internal_core_flag`（ECDICT `oxford` 欄）與
`internal_star`（ECDICT `collins` 欄）只當內部重要度特徵。

## 1. 大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》

- 欄位：`word`、`level`、`pos`、`variants`、`raw`、`tags`，以及由這些組成的 `entry_id`。
- 來源：https://www.ceec.edu.tw/xmdoc?xsmsid=0K213553204833715309
- 授權：封面聲明「僅供非營利目的使用，轉載請註明出處。若作為營利目的使用，應事前經由財團法人大學入學考試中心基金會書面同意授權。」
  App 若有任何收費或廣告，須先取得大考中心書面授權（03 文件 §9.8、04 文件 §4.3）。`commercial_ok = false`。

## 2. ECDICT

- 欄位：`forms`、`ipa`（`ipa_source.source = "ecdict"`）、`zh`、`variant_info`、`en_def`（`en_def_source = "ecdict"`）、`freq`、`internal_core_flag`、`internal_star`。
- 來源：https://raw.githubusercontent.com/skywind3000/ECDICT/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/ecdict.csv（git bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b；2026-10-07 下載；sha256 `1a6947e04785db63…`）
- 授權：MIT License。修改：中文以 OpenCC s2twp 轉成台灣繁體，再以本專案的對照表補正（`tools/build_vocab.py` 的 `TW_PHRASES`，例如 土豆→馬鈴薯、计算机→電腦；`KEEP_PHRASES` 保留 程序、文件、對象、循環 等一般用詞，不套用 OpenCC 的電腦用語改寫），並刪除轉換後重複的義項；音標字元統一為 IPA（ә→ə、є→ɛ、g→ɡ、'→ˈ、:→ː 等）；屈折形只保留條目詞類能產生的形式；只取詞彙表需要的列與欄。
- 中文釋義依 04 文件 §2.1 的建議，上線前還要由 Claude 改成台灣用語並人工抽查。

```
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. Open English WordNet 2025（衍生自 Princeton WordNet）

- 欄位：`wordnet`（義項、定義、例句、同義詞、反義詞、上位詞、衍生詞）、`en_def`（`en_def_source = "oewn"`）、`ipa`（`ipa_source.source = "oewn"`）、`family`（部分連結）。
- 來源：https://en-word.net/static/english-wordnet-2025-json.zip（Open English WordNet 2025 Edition (released 2025-12-31; git tag 2025-edition = dc343f2683279ecbb13fab4e2fd778d7b162d287)；2026-10-07 下載；sha256 `7d749f6e2c39e697…`）
- 授權：CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。「You may share and adapt this resource providing attribution is given to both Princeton WordNet and the Open English Wordnet team.」
- 標示：Open English WordNet 2025, © 2019–present The Open English WordNet Team, CC BY 4.0（https://en-word.net/）；
  以及 Princeton WordNet（WordNet 3.1 Copyright 2011 by Princeton University）。
- 引用：John P. McCrae, Alexandre Rademaker, Francis Bond, Ewa Rudnicka and Christiane Fellbaum (2019). *English WordNet 2019 – An Open-Source WordNet for English*. Proceedings of the 10th Global WordNet Conference (GWC 2019).
- 修改：只取詞彙表條目相關的義項；同義詞加上「是否在大考詞彙表與級別」的標記；上位詞只取前 3 個。
- Princeton WordNet 授權聲明（依授權條件必須隨資料附上）：

```
This software and database is being provided to you, the LICENSEE, by
the Open English Wordnet team under the Creative Commons Attribution 4.0
International License (CC-BY 4.0).

Open English Wordnet 2023 Copyright 2023 by the Open English Wordnet team.

Permission to use, copy, modify and distribute this software and
database and its documentation for any purpose and without fee or
royalty is hereby granted, provided that you agree to comply with
the following copyright notice and statements, including the disclaimer,
and that the same appear on ALL copies of the software, database and
documentation, including modifications that you make for internal
use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in
advertising or publicity pertaining to distribution of the software
and/or database.  Title to copyright in this software, database and
any associated documentation shall at all times remain with
Princeton University and LICENSEE agrees to preserve same.
```

## 4. Tatoeba

- 欄位：`examples`（每句的 `tatoeba_id`、`en`、`author`、`license`、`url`，以及中文翻譯的 `zh_id`、`zh`、`zh_author`、`zh_license`）。
- 來源：https://tatoeba.org/ 每週匯出檔（Sat, 03 Oct 2026 06:29:49 GMT 版；2026-10-07 下載）：
  - https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_detailed.tsv.bz2
  - https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences_detailed.tsv.bz2
  - https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2
  - https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences_CC0.tsv.bz2、https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences_CC0.tsv.bz2
- 授權：句子預設 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/），列在 CC0 匯出檔中的句子為 CC0 1.0。
  CC BY 句子使用時「必須標示作者」（Tatoeba Terms of Use §6.2「only allowed if the name of the author is cited」、§6.5），所以每句都保存作者名稱與句子 ID；作者為空（孤兒句）的 CC BY 句子不採用。
- 顯示格式：`Tatoeba #{tatoeba_id} by {author}`（連到 `url`），中文翻譯 `Tatoeba #{zh_id} by {zh_author}`。
- 修改：中文句用 OpenCC s2twp 轉成台灣繁體；原文是簡體的句子另以 `TW_PHRASES` 補正大陸用語，所有句子都以 `KEEP_PHRASES` 保留一般用詞（不改成 程式、檔案、物件…），再把日文新字體或異體字（髪、説、産…）與「箇」換成台灣通行字（`zh_converted = true` 表示文字有變動），應標示「中文經轉換為台灣繁體」。
- 不使用 Tatoeba 音檔（音檔授權依錄音者而定）。

## 5. CEFR-J Wordlist 與 Octanove Vocabulary Profile

- 欄位：`cefr`（`source` 標示來自 CEFR-J 1.6 或 Octanove C1/C2 1.0）。
- CEFR-J（A1–B2）來源：https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip（CEFR-J Wordlist Version 1.6 (xlsx dated 2020-03-24)；2026-10-07 下載；sha256 `c837d2c00ab8954e…`）
  - 條件：可免費用於研究與商業用途，但必須依指定格式引用（Ver1.6 活頁簿 README 工作表：「The citation should be made as follows: The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http:XXX on dd/mm/yy.」）。本專案的引用（日期依指定的 dd/mm/yy）：
    The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/download.html on 07/10/26.
  - 日文格式（同一份 README 的「引用の仕方」）：『CEFR-J Wordlist Version 1.6』 東京外国語大学投野由紀夫研究室. （URL: https://www.cefr-j.org/download.html より2026年10月ダウンロード）
  - 商用時的附帶條件（同一份 README 免責事項 2）：商用且需要監修等服務時，另行洽談並支付必要費用。
- Octanove（C1–C2）來源：https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/d4e45b75b38f27b30dfc5c44d8c571aec7e7092f/octanove-vocabulary-profile-c1c2-1.0.csv（Octanove Vocabulary Profile C1/C2 ver 1.0 (olp-en-cefrj git d4e45b75b38f27b30dfc5c44d8c571aec7e7092f)；2026-10-07 下載；sha256 `18c33a407f2f89f7…`）
  - 授權：CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）。Octanove Vocabulary Profile C1/C2 (ver 1.0), created by Octanove Labs, distributed by Open Language Profiles (https://github.com/openlanguageprofiles/olp-en-cefrj).
  - **相同方式分享**：`cefr.source` 含 Octanove 的值屬於 CC BY-SA 4.0 素材。若把這些值連同資料一起再散布，該部分要以 CC BY-SA 4.0 釋出並標示；04 文件 §7.3 的 `share_alike` 欄位應設為 true。

## 6. OpenCC

- 用途：簡體→台灣繁體（s2twp）轉換工具，本次使用 OpenCC（官方 Python 綁定） 1.4.2。Apache License 2.0（https://github.com/BYVoid/OpenCC）。轉換結果不另受 OpenCC 授權限制。

## 7. Cambridge Dictionary

- 欄位：`cambridge_url` 只是外部連結（英漢繁體），依 03 文件 §9.4 的 slug 規則由 `word` 產生。
- 沒有抓取、快取或嵌入任何 Cambridge 內容（04 文件 §2.2、§7.4）。本專案與 Cambridge University Press & Assessment 無關。

## 欄位來源對照

| 欄位 | 來源 | 授權 |
|---|---|---|
| entry_id, word, level, pos, variants, raw, tags | 大考中心詞彙表 | 非營利使用、註明出處 |
| forms, ipa, zh, variant_info, freq, internal_core_flag, internal_star | ECDICT（`zh` 中 `fixed: true` 的行是本專案補寫的釋義，見 `ZH_OVERRIDES`） | MIT |
| en_def | OEWN（優先）或 ECDICT | CC BY 4.0／MIT |
| wordnet | OEWN 2025（`in_list`、`level`、`entry_ids` 由本專案比對詞彙表） | CC BY 4.0（標示 Princeton WordNet 與 OEWN） |
| family, family_id | 本專案計算（詞彙表＋OEWN derivation） | CC BY 4.0 部分 |
| examples | Tatoeba | CC BY 2.0 FR／CC0（逐句標示） |
| cefr | CEFR-J 1.6／Octanove C1–C2 | CEFR-J 條款／CC BY-SA 4.0 |
| cambridge_url | 連結（本專案產生） | — |
