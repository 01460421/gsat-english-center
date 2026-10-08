# 04 外部資料來源與授權條款調查

> 撰寫日期：2026-10-07。本文件逐項查證 App 會用到的辭典、詞彙、例句、文章、數據、可讀性工具與 TTS 的授權條款，最後給出各功能的資料來源與授權處理建議。
> 查證方式：直接下載各來源的授權頁、服務條款、API 文件（原始檔在 `data/raw/licensing/`，不進版控），引用條文盡量保留原文。方括號代號（例如 [ECDICT]）對應第 9 節的網址。
> 標「本專案計算」的數字是我們用腳本算出來的結果，不是官方數字。標「（未驗證）」的項目沒能用一手來源確認。
> **本文件不是法律意見。** 涉及營利、大量轉載或爭議時，請另外諮詢律師或直接向權利人取得書面授權。
> **對抗式查證（2026-10-08）**：逐條回到原始檔或重新連線核對。Cambridge 網站條款與舊 API 條款改以 Wayback Machine 封存頁核對；新下載的佐證檔放在 `data/raw/licensing/verify04/`。修正與補充處都已直接改寫在內文，第 8 節更新了仍未驗證的清單。

---

## 0. 重點摘要

1. **大考中心歷屆試題本身不受著作權保護，但周邊資料受保護。** 《著作權法》第 9 條第 1 項第 5 款規定「依法令舉行之各類考試試題及其備用試題」不得為著作權之標的 [TW-CA]。智慧局函釋說明，連高中自辦的學測／指考模擬考題都屬於這一類，「任何人均得利用」[TIPO-1111221]。不過以下內容仍受保護：**解答**（具原創性的解答仍受保護）[TIPO-1111221]、試題裡引用的**第三方文章**[LEEANDLI]、《高中英文參考詞彙表》（封面寫明「著作權屬財團法人大學入學考試中心基金會所有」，營利使用要先取得書面同意）[V111]。非選擇題評分原則、選才電子報文章、考生作文佳作則是本專案依著作權法一般原則推論為受保護的語文著作（評分原則可能屬於智慧局所說的「解答」；沒有找到直接針對這幾項的函釋）。
2. **大考中心商標**：「大考中心」「大學入學考試中心」「CEEC」和圖形標誌都已註冊（聲明 PDF 列出的是書法字體／設計字樣與圖形，純文字字樣的註冊範圍未在智慧局商標檢索核對，**未驗證**）。大考中心聲明，未經書面同意，這些商標不得用於商業活動，**也不得當作網域名稱、社群帳號名稱或識別圖示** [CEEC-TM]。之後接 Cloudflare 付費網域時，網域和 App 名稱都不能含 `ceec` 或「大考中心」。
3. **單字資料的主幹可以完全用開放授權資料組成**（本專案計算，以詞彙表 Level 3–5 共 3,006 筆為準）：
   - ECDICT（MIT）收錄全部 3,006 筆，都有中文釋義；有 Collins 星級的 2,843 筆，有詞形變化的 2,557 筆。
   - Open English WordNet 2025（CC BY 4.0）收錄 2,996 筆，其中有同義詞的 2,690 筆。
   - Tatoeba 的英中對照例句（CC BY 2.0 FR）涵蓋 2,652 筆，其中 1,840 筆有 3 句以上。
4. **Cambridge Dictionary 只能外連，不能爬取、不能嵌入。**
   - 英漢繁體網址格式是 `https://dictionary.cambridge.org/dictionary/english-chinese-traditional/{slug}`，已實測可用；片語的空白要換成連字號，例如 `give-up`。
   - 頁面送出 `X-Frame-Options: SAMEORIGIN`，所以無法用 iframe 嵌入。
   - Cambridge 網站條款（Wayback 2026-10-04 封存）只允許「personal, non-commercial purposes」，並禁止「'Scrape' or store content from the Site … or create an electronic database」；外連則允許，但連結不得誤導、要能看出目的地、不得暗示 Cambridge 背書 [CAM-TOU]。
   - 官方 API 入口 `dictionary-api.cambridge.org` 在 2026-10-07／10-08 實測會 301 轉回首頁。封存的舊 API 條款只發「evaluation」用的試用 key（30 天、3,000 次），正式開發要另簽合約 [CAM-API-WB]。資料授權要另外透過「License Data」頁面聯絡洽談 [CAM-LIC]。
5. **CC BY-SA 資料（Wiktionary、kaikki.org、Free Dictionary API、Wikipedia、CC-CEDICT）可以用，但改作後也要用相容授權釋出**（姓名標示＋相同方式分享），並附連結、註明有修改 [WIKT] [WP-REUSE]。建議把這類內容和原創題庫分開存放，每筆都記錄授權。
6. **新聞、期刊類文章能直接「挖空改作」的很少**：
   - **Guardian**：Open Platform 條款禁止編輯改寫，也禁止任何 AI 用途；內容最多只能保留 24 小時 [GUARDIAN-TOU]。
   - **The Conversation**：CC BY-ND，不得改作 [CONV]。
   - **聯合國、UNICEF、UNESCO 網站**：限個人或非商業使用，不得做衍生作品，或需要事先許可 [UN-TOU] [UNICEF] [UNESCO-TOU]。
   - **WHO 出版品**：CC BY-NC-SA 3.0 IGO [WHO-COPY]。
   - **VOA**：自製內容屬公有領域，但 Learning English 很多文章是改寫自 AFP、AP、Reuters 的稿件，而 VOA 條款明文禁止改寫這些通訊社的稿件 [VOA-TOU]。VOA Learning English 實際上已停止更新：「As It Is」最新一則是 2025-03-12，RSS 最新項目是 2025-04-29（2026-10-08 重測相同）[VOALE-ASITIS] [VOALE-RSS]。
   - **可以改作、也可以商用的開放文字來源**（只要標示出處並註明修改）：Global Voices（CC BY 3.0；但合作媒體轉載稿不適用）[GV]、Frontiers for Young Minds（CC BY 4.0，由 8–15 歲青少年審稿）[FYM]、PLOS 期刊（CC BY）[PLOS]，以及 Wikipedia／Simple English Wikipedia（CC BY-SA 4.0）。
7. **主策略：「以多來源事實為素材，由 Claude 寫成原創文章，再附上參考連結」。** 大考中心自己描述的命題方式也是這樣：「題材大多來自網路文章或新聞報導等……將數篇文章資訊精簡與融合後，進行改寫」[CEEC-EP351]。事實本身不受著作權保護（《著作權法》第 10-1 條；第 9 條第 1 項第 4 款「單純為傳達事實之新聞報導」）[TW-CA]，但必須避免和原文的表達方式實質相似。另外要注意：Anthropic 的智財賠償條款**不涵蓋**因客戶提供的 Inputs、客戶對 Outputs 的修改、或把 Outputs 和非 Anthropic 提供的內容結合所引起的主張（K.3），而且只涵蓋付費使用（K.1）[ANT-CTOS]。所以不要把受保護的全文丟給 Claude「改寫一下」就上線。
8. **數據與圖表**：
   - World Bank 資料集預設 CC BY 4.0，API 不需要金鑰，但 WDI 查不到台灣（TWN 查詢結果為 0 筆，本專案實測）[WB-DS] [WB-API]。
   - Our World in Data 的自製圖表與資料是 CC BY 4.0，第三方資料要依原授權，有台灣資料；不過它的**文章不得編輯** [OWID-FAQ]。
   - UN SDG API 免金鑰可用 [SDG-API]，但**沒有台灣資料**：台灣在 GeoArea 清單裡是代碼 158「Other non-specified areas in Eastern Asia」，抽測 3 個指標序列都是 0 筆（本專案實測）。
   - 台灣數據改用我國政府開放資料：「政府資料開放授權條款－第1版」允許不限目的利用（含改作），要依「顯名聲明」標示，並和 CC BY 4.0 相容 [TW-ODL]。
   - WHO 資料集只授權用於「public health purposes」[WHO-DATA]，不建議當作主要來源。
9. **NewsAPI 類服務只能當作「找題材的索引」。** 免費方案只能在開發環境使用，`content` 欄位截斷為 200 字元 [NEWSAPI-TOU] [NEWSAPI-DOC]。
10. **難度分級**：
    - Flesch-Kincaid 是公開公式，可以自己算（textstat 用 MIT 授權）[TEXTSTAT]。
    - Lexile 是 MetaMetrics 的專有指標，免費 Analyzer 的結果僅供課堂教學用途，也不是認證值 [LEXILE-FAQ]，所以 **App 不顯示 Lexile**。
    - CEFR 對照用 CEFR-J Wordlist（可商用，需標示出處）[CEFRJ]。
    - 主要指標用「大考詞彙表級數覆蓋率」。115 學測英文全卷的覆蓋率是 L1–4 約 90.9%、L1–6 約 95.2%（本專案計算），可以當作校準點。
11. **TTS 發音**：
    - 預設用瀏覽器 Web Speech API，免費，但聲音取決於使用者的裝置 [MDN-SS]。
    - 預錄音檔用 Cloudflare Workers AI 的 MeloTTS：模型是 MIT 授權，價格 $0.0002／音訊分鐘（定價總表；模型頁寫 $0.000205），每日免費 10,000 Neurons，約可產生 536 分鐘（本專案計算）[CF-PRICE] [CF-MELO] [MELO-LIC]。
12. **使用者是未成年的高中生，而且會上傳作文與手寫照片**（原版本遺漏，本次補上，詳見 §7.5）：
    - Anthropic Usage Policy（2025-09-15 生效）規定，讓未成年人直接使用 API 產品的組織，必須遵守 Help Center 的未成年人指引（年齡驗證、內容過濾、監控回報、安全使用說明、公開聲明法規遵循、告知使用者對方是 AI）[ANT-AUP] [ANT-MINORS]。
    - 上傳的作文與照片屬於個人資料，要依《個人資料保護法》第 8 條告知、第 19 條取得蒐集依據（契約或同意）[TW-PDPA]。

---

## 1. 授權類型速查

| 授權 | 可轉載 | 可改寫／挖空 | 可商用 | 必須標示 | 改作後的授權義務 | 本文出現的來源 |
|---|---|---|---|---|---|---|
| 公有領域（PD） | 可 | 可 | 可 | 法律上不需要，但來源常要求標示（例如 VOA 要求 credit） | 無 | VOA 自製內容 [VOA-TOU]、NASA 媒體（限美國境內）[NASA] |
| CC0 | 可 | 可 | 可 | 不需要 | 無 | Tatoeba 部分句子 [TATOEBA-DL] |
| CC BY（2.0／3.0／4.0） | 可 | 可 | 可 | 需要：作者、來源連結、授權連結，並註明修改 | 無 | Tatoeba（2.0 FR）、Global Voices（3.0）、FYM／World Bank／OWID／OEWN（4.0）、Google Books Ngram（3.0）、PLOS（CC BY，版本依各文章標示） |
| CC BY-SA | 可 | 可 | 可 | 需要 | **改作要用相同或相容授權釋出** | Wiktionary、Wikipedia、CC-CEDICT、Free Dictionary API 回傳資料、Octanove C1–C2 字表、wordfreq 資料 |
| CC BY-ND | 可（原樣） | **不可**（法律意義上的改作都不行；The Conversation 另外明訂不得編輯）| 可，但 The Conversation 表示非新聞性的商業使用可能要付費 | 需要 | 不可分享改作 | The Conversation [CONV] [CC-BYND] |
| CC BY-NC-SA 3.0 IGO | 可 | 可 | **不可** | 需要，且要加 WHO 規定的免責聲明 | 相同方式分享 | WHO 出版品 [WHO-COPY] |
| MIT／Apache-2.0 | 可 | 可 | 可 | 保留版權聲明 | 無 | ECDICT、OpenCC、textstat、MeloTTS、Kokoro |
| 政府網站資料開放宣告（台灣） | 可 | 可 | 可 | 需要註明出處 | 無 | 國家教育研究院樂詞網 [NAER-OPEN] |
| 政府資料開放授權條款－第1版（台灣） | 可 | 可 | 可 | 需要，依「顯名聲明」格式 | 無；和 CC BY 4.0 相容 | 政府資料開放平臺上的資料集 [TW-ODL] |
| 個別條款（非 CC） | 依條款 | 多半不可 | 多半不可 | — | — | 聯合國、UNICEF、UNESCO、Guardian、Cambridge |

> CC 授權裡的「改作」（Adapted Material）定義是：以授權素材為基礎，經「translated, altered, arranged, transformed, or otherwise modified」而需要權利人許可的素材 [CC-BYND]。CC 官方 FAQ 說明，修改是否構成改作，主要取決於適用的著作權法 [CC-FAQ]。挖空、刪改字詞、重組段落都很可能落在改作範圍，所以本文一律把挖空視為改作。

---

## 2. 辭典、詞彙、例句資源

### 2.1 總表

| 名稱 | 內容 | 授權／條款重點 | 轉載 | 改寫／挖空 | 商用 | 標示 | API 與額度 | 本專案建議 |
|---|---|---|---|---|---|---|---|---|
| **Cambridge Dictionary 網站**（英漢繁體） | 英英釋義、繁中翻譯、例句、CEFR 等級標記、英美音 | 關於頁寫明「Material on these pages is copyright Cambridge University Press or reproduced with permission」[CAM-ABOUT]。辭典頁尾的「Terms of Use」連到 `cambridge.org/about-us/terms-use/`，該網址 301 轉到 Website Terms（條款自述適用於「any other Cambridge websites which link to this page」）。原頁直連仍被 Cloudflare 擋下 403，改用 Wayback 2026-10-04 封存頁逐字核對（條款末註「We last updated these Website Terms in August 2022」）：「Only use the Site and its content for personal, non-commercial purposes」；Do not「'Scrape' or store content from the Site on a server or other storage device or create an electronic database by downloading and storing the Site's content」；外連要「not misleading」「fairly indicates its destination」「not imply that we endorse you」[CAM-TOU] | 不可 | 不可 | 不可 | — | 無公開免費 API；robots.txt 對 `User-agent: *` 禁止 `/search/`、`/browse/`、`/autocomplete/` 等路徑，沒有禁止 `/dictionary/`。但 robots.txt 不等於授權 [CAM-ROBOTS] | **只做外連**（新分頁開啟）。不要爬取、不要快取、不要 iframe |
| **Cambridge Dictionary API／License Data** | 英式、國際、美式、商務英語資料集，以及發音資料、音檔 | License Data 頁：「We're happy to discuss a pricing model…」，需填表聯絡 [CAM-LIC]。footer 的「Dictionary API」連到 `http://dictionary-api.cambridge.org`，**2026-10-07／10-08 實測 `https://dictionary-api.cambridge.org`、`/api/faq`、`/api/terms-and-conditions` 都會 301 轉到首頁** [CAM-API]。Wayback 2026-04-10 封存的舊 API 頁 [CAM-API-WB]：FAQ 說要先寄信說明用途，核准後才發 key；一般條款不允許儲存資料（Cambridge 要記錄每次請求），離線或研究用途要另談授權。條款寫試用 key「for evaluation purposes only」，「limited to 3,000 free calls for a period of 30 days」，30 天後自動失效；要正式開發得另申請「API Development Key」並簽 Application Development Agreement。封存頁裡**找不到**費率；先前搜尋摘錄說的「依瀏覽次數計費」「不提供研究或原型的免費存取」都無法證實（**未驗證**）[CAM-API-SNIP] | 依合約 | 依合約 | 依合約（付費） | 依合約 | 試用 3,000 次／30 天；正式需簽約 | MVP 不用。之後若有預算再寄信詢價 |
| **ECDICT** | 約 77 萬詞條（ecdict.csv 共 770,611 列，本專案計算）。欄位：`word, phonetic, definition（英）, translation（中）, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio` [ECDICT] | **MIT**（Copyright (c) 2025 Linwei）[ECDICT]。README 自述音標有部分是爬蟲取得，資料來源包括 EDictAZ、cdict。另外 ecdict.csv 有 42,042 列的中文釋義帶「[网络]」標記（本專案計算；這個標記出現在資料裡，README 沒有說明）。上游來源的權利是否乾淨，作者沒有說明（**未驗證**） | 可 | 可 | 可 | 保留 MIT 聲明 | 離線 CSV（65.9 MB）；附 Python 存取程式 | **單字主表的種子資料**。中文是簡體和中國用語，要先用 OpenCC `s2twp` 轉換，再讓 Claude 改成台灣用語，最後人工抽查。`collins`、`oxford`、`bnc`、`frq` 只當作內部的重要度特徵，**不在介面顯示 Collins 或 Oxford 品牌標籤** |
| **ECDICT lemma.en.txt** | 186,523 個詞形對應 84,487 個詞元（檔頭自述）| 檔頭寫「free to use for any research and/or educational purposes」，和 repo 的 MIT 不同 [ECDICT-LEMMA] | 可（教育用途） | 可 | 商用有疑義（**未驗證**）| 註明出處 | 離線 | 用於文章詞元還原、難度計算。若之後轉為商用，改用 ECDICT 的 `exchange` 欄位（MIT）自行產生對照表 |
| **Princeton WordNet 3.1** | 同義詞集、上下位關係等 | 「Permission to use, copy, modify and distribute this software and database … for any purpose and without fee or royalty is hereby granted」，條件是保留版權聲明，且不得用 Princeton 名義做廣告 [OEWN-WNDB]。官方授權頁有 Cloudflare 驗證，無法直接下載 [PWN] | 可 | 可 | 可 | 保留聲明 | 離線 | 改用 OEWN |
| **Open English WordNet 2025** | 2025 版（2025-12-31 釋出）：core 135,969 詞、107,519 個 synset。關係有 hypernymy、antonymy、meronymy、similar、derivation 等；synset 附定義與例句 [OEWN] | **CC BY 4.0**，衍生自 Princeton WordNet。「You may share and adapt this resource providing attribution is given to both Princeton WordNet and the Open English Wordnet team.」[OEWN-LIC] | 可 | 可 | 可 | 要同時標示 Princeton WordNet 與 OEWN | JSON 壓縮檔 10 MB（解壓後 72 MB，本專案實測）；另有 JSON API，文件在 https://en-word.net/api/docs | **同義詞、近義、上下位、多義（sense 數）的主資料**。在 GitHub Actions 離線處理後寫入 D1 |
| **Wiktionary** | 釋義、詞源、發音、片語、派生詞、各語言翻譯（含中文） | 文字採 **CC BY-SA 4.0** 與 GFDL 雙授權。重用時「your materials have to be licensed under the same, similar, or compatible license」；附上醒目連結回原條目即可滿足 GFDL 的標示要求 [WIKT] | 可 | 可（改作要 SA） | 可 | 要標示，並連回條目 | 透過 kaikki 下載 | 用於片語、多義、派生詞的**補充參考**。顯示原文時一定要附連結與 CC BY-SA 標示 |
| **kaikki.org（wiktextract）** | 英文版 Wiktionary 的結構化 JSONL，2026-10-03 從 2026-09-02 的 enwiktionary dump 擷取（全部語言的原始資料 2.8 GB gz，解壓 23.9 GB）；欄位含 glosses、translations、hypernyms、hyponyms、derived、related、sounds 等 [KAIKKI] [WIKTEXTRACT]。另有中文版 Wiktionary 擷取（zh-extract，gz 223.6 MB），含英文詞條的中文釋義 [KAIKKI-RAW] | 「made available under the same licenses as Wiktionary - both CC-BY-SA and GFDL」[KAIKKI]。學術使用請引用 Ylonen (LREC 2022)。wiktextract 程式本身是 MIT | 可 | 可（SA） | 可 | 要標示 | 大型離線檔，「usually at least once a week」更新 [KAIKKI-RAW] | 只在 CI 裡篩選 L1–6 約 6,000 詞的子集，不要整包放進 D1 |
| **Free Dictionary API**（dictionaryapi.dev） | 英英釋義、音標、例句、同反義詞、部分音檔 | 回傳資料內含 `"license":{"name":"CC BY-SA 3.0"}` 與 `sourceUrls`（指向 Wiktionary），音檔來自 Wikimedia Commons（BY-SA 3.0）[FDA-SAMPLE]。程式碼 repo 的 LICENSE 是 GPL-3.0，但 `package.json` 寫 ISC（兩者不一致；我們只用回傳資料，不用程式碼）[FDA] | 可（SA） | 可（SA） | 可 | 要標示 | 免金鑰。回應標頭 `x-ratelimit-limit: 450`（時間窗未公開，本專案實測）。README 自述每月超過 1,000 萬次請求，伺服器費用靠贊助支撐，沒有 SLA [FDA] | **不要在正式環境即時呼叫**。需要的話在 CI 批次抓一次，連同授權一起存 |
| **Merriam-Webster API** | 英英／學習者辭典 | 「If your app is considered "commercial"… you will be required to pay」；非商業使用免費，上限每把 key 每日 1,000 次 [MW] | 依條款 | 依條款 | 需付費 | — | 每日 1,000 次 | 不需要 |
| **CC-CEDICT** | 中→英辭典，125,215 筆（2026-10-07 版），繁簡並列 [CEDICT] | **CC BY-SA 4.0**：商用、非商用都可以，要標示，改善後要相同方式分享 [CEDICT]。MDBG 網站頁尾寫「Automated or scripted access is prohibited」[CEDICT] | 可 | 可（SA） | 可 | 要標示 | 離線；**不能用 CI 腳本自動到 mdbg.net 下載**，要人工下載後放進私有儲存 | 中譯英模組可以用來做「中文詞→英文候選詞」的反查提示 |
| **OpenCC** | 簡繁轉換；`s2tw`（台灣正體）、`s2twp`（含台灣慣用詞彙）[OPENCC] | **Apache-2.0** | — | — | 可 | 保留聲明 | 函式庫 | ECDICT、Tatoeba 中文都先用 `s2twp` 轉換 |
| **國家教育研究院 樂詞網** | 學術名詞、雙語詞彙、教科書名詞、兩岸對照名詞（下載區有 29 個雙語詞彙檔）[NAER-DL] | 「政府網站資料開放宣告」：「以無償、非專屬，得再授權之方式提供公眾使用……重製、改作、編輯、公開傳輸……使用時，應註明出處」，但機關特別聲明須經同意的部分除外 [NAER-OPEN]。另一頁的「版權聲明」又寫「任何形式之轉載，請先與本院聯繫」[NAER-PRIV]，**兩份聲明互相矛盾** | 依開放宣告可 | 可 | 可 | 要註明出處 | 下載區 | SDGs 主題的專有名詞（環境、衛生）用來對照台灣譯名。大量使用前，先寫信向國教院確認是否適用開放宣告 |
| **Oxford Collocations Dictionary** | 搭配詞 | OUP 的商業辭典，在 Oxford Learner's Dictionaries 網站上提供 [OCD]。Oxford Dictionaries API 是付費訂閱制 [OXAPI]。沒有找到開放授權（**未驗證**是否能透過 API 取得搭配詞資料）| 不可 | 不可 | 不可 | — | 付費 | **不使用**。改用下面的開放替代方案 |
| **Datamuse API** | `rel_jja`／`rel_jjb`（形容詞與名詞的搭配）、`rel_bga`／`rel_bgb`（常見後接詞、前接詞，例如 wreak → havoc），這幾種都依 Google Books Ngrams；另有 `lc`／`rc` 左右文脈參數、`rel_syn`／`rel_ant`（依 WordNet）、`rel_trg`、IPA [DATAMUSE] | 「Until January 1, 2027, you can use this service without restriction and without an API key for up to 100,000 requests per day」。頁首公告又寫「starting February 1, 2027, an API key will be required」（兩個日期不一致）。要用在面對使用者的應用，需要先寫信說明；公開 App 要在文件中致謝 [DATAMUSE] | 未明定 | 未明定 | 未明定（**未驗證**）| 在文件中致謝 | 每日 10 萬次；2027 起需要金鑰 | **只在 CI 離線**取得 L3–5 詞的搭配候選，交給 Claude 篩選、加例句，再人工抽查。不要讓前端直接呼叫。只用 `rel_jja/jjb/bga/bgb/syn/ant`；不用 `ml`，因為 `ml` 也用了「dozens of online dictionaries crawled by OneLook」，來源權利不明 [DATAMUSE] |
| **Google Books Ngram 資料集** | 1–5 gram 次數 | 「This compilation is licensed under a Creative Commons Attribution 3.0 Unported License.」[NGRAM] | 可 | 可 | 可 | 要標示 | 離線（檔案非常大） | 搭配詞強度（logDice、PMI）的自算來源。若算力有限，先用 Datamuse |
| **wordfreq** | 多語詞頻 | 程式 Apache；資料 CC BY-SA 4.0；資料只到約 2021 年，「unlikely to be updated again」[WORDFREQ] | 可 | 可（SA） | 可 | 要標示 | 函式庫 | 選用。ECDICT 的 `frq` 已經足夠 |
| **Tatoeba** | 例句與翻譯（英文 2,038,137 句；中文 89,177 句；有中文翻譯的英文句 72,751 句；英文 CC0 句 41,512 句。皆為 2026-10-03 匯出檔，本專案計算）| 句子「released under CC BY 2.0 FR」，部分句子是 CC0。音檔授權由各錄音者決定；授權欄空白者「you may not reuse the audio outside the Tatoeba project」[TATOEBA-DL]。依條款，使用 CC BY 句子時必須標示作者 [TATOEBA-TOU] | 可 | 可 | 可（個別錄音另計）| **逐句標示作者**（作者名稱在 `sentences_detailed` 匯出檔） | 每週六 06:30 UTC 更新匯出檔 | **例句主來源之一**。存句子 ID、作者、授權；中文用 `s2twp` 轉換。音檔不使用 |
| **CEFR-J Wordlist／Octanove C1–C2** | 英文詞彙的 CEFR A1–C2 分級。官方最新版是 1.6（2020-03-24）[CEFRJ]；§5.3 的計算用的是 OLP repo 的 1.5 CSV [OLP] | CEFR-J：「can be used for both research and commercial purposes with a proper acknowledgement of the source」，著作權屬東京外國語大學投野研究室 [CEFRJ] [OLP]。Octanove C1–C2 是 **CC BY-SA 4.0** [OLP] | 可 | 可 | 可 | 要依指定格式引用 | 離線 CSV | CEFR 對照（§5.3）。C1／C2 標籤來自 Octanove，要記 `share_alike=true`；若不想讓詞表帶 SA 義務，介面只顯示 CEFR-J 的 A1–B2，C1 以上顯示「B2 以上」 |
| **NGSL** | 通用核心字表 | 官網寫「Free under Creative Commons, including commercial use」，但沒有標明是哪一種 CC 授權（**版本未驗證**）[NGSL] | 可 | 依授權 | 可 | 要標示 | 離線 | 選用 |
| **English Vocabulary Profile（EVP）** | 依 CEFR 分級的詞義與片語 | englishprofile.org 的字表頁與條款頁 2026-10-07 都是 404，**授權未驗證** | — | — | — | — | — | 不使用 |

### 2.2 Cambridge Dictionary 外連的實作細節

- **網址格式**（2026-10-07 實測，HTTP 200，canonical 一致）[CAM-TC]：
  - 單字：`https://dictionary.cambridge.org/dictionary/english-chinese-traditional/abandon`
  - 片語：空白換成連字號，例如 `…/english-chinese-traditional/give-up`、`…/look-forward-to`。網站會自動把 `give%20up` 轉成 `give-up`。
  - 查不到的字（例如 `qwertyzzx`）**不會回 404**，而是回 302 轉到英漢繁體辭典首頁（`…/english-chinese-traditional/`，最後是 200）。所以不能用 HTTP 狀態碼判斷有沒有這個字（2026-10-08 重測）。
  - 屈折形可以改用搜尋網址：`https://dictionary.cambridge.org/search/direct/?datasetsearch=english-chinese-traditional&q={詞}`，實測 `q=gave` 會 302 轉到 `…/english-chinese-traditional/gave` 條目頁。這個路徑在 robots.txt 對爬蟲是禁止的，但使用者自己點擊不受影響 [CAM-ROBOTS]。
  - 隨機抽測 8 個 L5 詞，都有英漢繁體條目：entity、viewpoint、collector、generate、progressive、apt、ballot、statistical。另外測了表外詞 exacerbate 和 well-being，也都有條目（本專案實測）。
- **不能嵌入**：回應標頭是 `x-frame-options: SAMEORIGIN` 和 `content-security-policy: frame-ancestors 'self' *.cambridge.org`（本專案實測，2026-10-08 重測相同），所以一律用 `target="_blank" rel="noopener"` 開新分頁。
- **外連的寫法**：依網站條款的外連規定 [CAM-TOU]，按鈕文字要清楚寫出目的地（例如「在 Cambridge Dictionary 查看（另開新分頁）」），不用 Cambridge 標誌，也不寫「Cambridge 推薦」之類暗示背書的文字。
- **官方免費小工具**：Cambridge 提供免費的「Search Box Widget」HTML 表單，還有 Double-Click Lookup [CAM-WIDGET]。這些是 Cambridge 自己提供的嵌入方式，比自建連結更沒有條款疑慮，但介面比較受限。
- **不要做的事**：不抓取頁面文字或例句來充實自家資料庫，不快取 Cambridge 的音檔，不用 Cambridge 的 CEFR 標記做分級（改用 CEFR-J）。

### 2.3 開放資料對大考詞彙表 Level 3–5 的覆蓋率（本專案計算）

依 `data/vocab/ceec-wordlist.json` 的 Level 3–5 共 3,006 筆比對。ECDICT 比對時同時用詞頭和並列拼法（variants），而且不分大小寫（ECDICT 的 conservative、core、fax、polish 等 7 詞只有大寫開頭的詞條）。OEWN 的數字只用詞頭比對；若加上 variants，「有同義詞」是 2,691 筆、「synset 附例句」是 2,372 筆（78.9%）。以上數字 2026-10-08 用同一批原始檔重算後確認（本專案計算）。

| 資料 | 指標 | 筆數 | 比例 |
|---|---|---|---|
| ECDICT | 收錄且有中文釋義 | 3,006 | 100% |
| ECDICT | 有 Collins 星級 | 2,843 | 94.6% |
| ECDICT | `oxford`=1（Oxford 3000）| 1,003 | 33.4% |
| ECDICT | 有當代語料庫詞頻 `frq` | 2,991 | 99.5% |
| ECDICT | 有詞形變化 `exchange` | 2,557 | 85.1% |
| OEWN 2025 | 收錄 | 2,996 | 99.7% |
| OEWN 2025 | 至少一個 synset 有其他成員（同義詞）| 2,690 | 89.5% |
| OEWN 2025 | 有上位詞 | 2,547 | 84.7% |
| OEWN 2025 | synset 附例句 | 2,369 | 78.8% |
| Tatoeba 英中對照 | ≥1 句含該詞（含屈折形）| 2,652 | 88.2% |
| Tatoeba 英中對照 | ≥3 句 | 1,840 | 61.2% |

觀察：
- ECDICT 的英文釋義大多和 WordNet 的定義相同。例如 abandon 的英文釋義「v. give up with the intent of never claiming again」，和 OEWN synset 02232523-v 的定義一致。
- ECDICT 的音標用 Cyrillic「ә」（U+04D9），而不是 IPA「ə」（U+0259），匯入時要統一字元。
- 例句不足的詞（約 1,166 筆不到 3 句）由 Claude 生成原創例句補齊，再標示為「AI 生成」。

---

## 3. 文章與數據來源

### 3.1 總表

| 名稱 | 內容 | 授權／條款重點 | 轉載 | 改寫／挖空 | 商用 | 標示 | API 與額度 | 本專案建議 |
|---|---|---|---|---|---|---|---|---|
| **VOA（voanews.com）** | 國際新聞 | 「All text, audio and video material produced exclusively by the Voice of America is in the public domain. Credit … should be given to voanews.com, Voice of America, or VOA.」但 AFP、AP、Reuters 的素材「shall not be published, broadcast, **rewritten** for broadcast or publication」[VOA-TOU]。「Voice of America」是商標，未經許可不得用於商業目的 [VOA-TOU] | 自製內容可 | 自製內容可 | 自製內容可 | 依 VOA 要求 credit | RSS | 只採用「完全由 VOA 自製」的文章，並排除照片 |
| **VOA Learning English** | 分級新聞、Words in This Story 字彙表 | 條款同 VOA，第三方段落只列 AP [VOALE-TOU]。另外，SaveVOA 時間軸記載，Kari Lake 在 2025-03-13 宣布終止 VOA 與 AP、Reuters、AFP 的供稿合約 [SAVEVOA]，但這不會讓舊稿變成公有領域。**實例**：小行星文章署名「Daniel Lawler with Issam Ahmed reported this story for Agence France-Presse. Jill Robbins adapted it for Learning English.」[VOALE-ART]。這類 AFP／AP 改寫稿**不屬於「produced exclusively by VOA」**，風險高 | 只限非通訊社稿 | 只限非通訊社稿 | 只限非通訊社稿 | credit VOA | RSS `https://learningenglish.voanews.com/api/` | 篩選標準：文末沒有「reported this story for AFP／AP／Reuters」字樣。主要拿來當作「分級英文寫法」的風格參考 |
| **UN News／un.org（含 SDGs 頁面）** | 聯合國新聞、SDGs 說明 | UN 網站條款：只允許「personal, non-commercial use, without any right to resell or redistribute them or to compile or create derivative works therefrom」[UN-TOU]。著作權頁：「News-related material can be used as long as the appropriate credit is given and the United Nations is advised.」[UN-COPY]。UN News 的 footer 直接連到這兩頁 [UNNEWS] | 新聞類，標示並通知 UN 後可以 | **不可**（衍生作品）| 不可 | 要標示 | RSS | **只當事實素材與主題來源**，改寫成原創文章並附連結 |
| **SDG 標誌與 17 個圖示** | 色輪、圖示 | 非 UN 單位可依指引使用，但要加連結和這段聲明：「The content of this publication has not been approved by the United Nations and does not reflect the views of the United Nations or its officials or Member States」。募款與商業用途要先取得書面許可，也不得暗示聯合國背書 [SDG-COMM] | 依指引 | 不得變形 | 商業用途需許可 | 加連結與聲明 | 下載 | 題目卡用 SDG 編號文字標籤（例如「SDG 13 氣候行動」），不使用官方圖示，避免觸及商業限制。若要用圖示，就照指引加聲明 |
| **UN SDG Global Database API** | 官方 SDG 指標資料（75 個端點，例如 `/v1/sdg/Goal/List`、`/v1/sdg/Series/Data`）[SDG-API]。**沒有台灣資料**：台灣在 `/v1/sdg/GeoArea/List` 是 158「Other non-specified areas in Eastern Asia」，`SI_POV_DAY1`、`SP_DYN_IMRT`、`EN_ATM_CO2` 查 `areaCode=158` 都是 0 筆（2026-10-08 本專案實測） | API 頁面沒有授權聲明。同為 UNSD 的 UNdata 條款寫「may be copied freely, duplicated and further distributed provided that UNdata is cited as the reference」[UNDATA]，但是否同樣適用於 SDG API **未驗證** | 數據可（推定） | 數據可（推定） | 推定可 | 引用 UNSD 與資料保管機構 | 免金鑰（本專案實測 200）| 用於圖表題的跨國數據來源，標示「UN SDG Global Database」與指標代碼。台灣數據另找政府開放資料 |
| **SDG Report 2025（PDF）** | 年度進度報告 | PDF 全文用 pdftotext 檢索，找不到 CC 授權聲明（本專案檢索），所以回歸 UN 網站條款；封面照片 © UNICEF [SDGR2025] | 不可 | 不可 | 不可 | — | — | 只引用數字，並附連結 |
| **UNICEF** | 新聞、報告、照片 | 「The UNICEF Web Site is provided by UNICEF for personal use and educational purposes only. Any other use, including reproduction or translation of anything more than a de minimis portion … requires the express prior written permission」[UNICEF] | 不可 | 不可 | 不可 | — | — | 只當事實素材 |
| **WHO 出版品** | 報告、指引 | WHO 出版品採 **CC BY-NC-SA 3.0 IGO**，改編時要加 WHO 指定的免責聲明；商業用途要先申請許可 [WHO-COPY] | 非商業可 | 非商業可（SA）| **不可** | 要依指定格式引用 | — | App 若會收費就不要用；否則只當事實素材 |
| **WHO 資料集** | GHO 等統計 | 授權用途限「for public health purposes」，除了調整格式外不得修改，也不得用於推廣商業產品 [WHO-DATA] | 限公衛目的 | 小幅可 | 不可 | 指定格式 | — | 英語教學是否算公衛目的有疑義，改用 OWID 或 World Bank 的同類指標 |
| **UNESCO** | 網站、出版品 | 網站條款：個別素材可以「on an occasional and individual basis, for personal use and for non-commercial educational and research purposes」引用、翻譯、重製。引用上限是 1,000 字或原文 25%（取較少者）。禁止商業使用、自動化爬取、大量下載與 **AI 訓練**。AI 即時擷取（含 RAG）有條件允許：要標示 UNESCO 並附連結，不得留存 [UNESCO-TOU]。出版品依開放取用政策個別採用 CC BY-SA、BY-NC-SA、BY-NC-ND、BY-ND 等 IGO 授權 [UNESCO-OA] | 偶發、個別可 | 依個別授權 | 不可 | 要標示 | 禁止自動化爬取 | 不納入 CI 爬取。需要時由人工閱讀後當作事實參考 |
| **The Guardian Open Platform** | 全文 API | Developer key 限非商業，「Up to 500 calls per day」、每秒 1 次 [GUARDIAN-ACCESS]。條款：24 小時內必須刪除或更新內容；**不得「Edit, adapt, translate or otherwise alter」**；不得把內容用於「any machine learning … artificial intelligence-related purposes」，也不得「with any machine learning and/or artificial intelligence technologies to generate any data or content」；重刊時要掛「Powered by The Guardian」標誌 [GUARDIAN-TOU] | 依條款原樣 | **不可** | 要另購商業 key | 要掛標誌 | 500 次／日 | **完全不用**，連「AI 擷取事實」都不行。最多只能放外部連結 |
| **The Conversation** | 學者撰寫的評論與科普 | **CC BY-ND**。「You can't edit our material, except to reflect relative changes in time, location and editorial style」；翻譯也算衍生，要作者同意；不得系統性轉載全部文章；「Commercial, non-journalism usage: license fees may apply」[CONV] | 原樣可 | **不可**（要作者同意）| 可能要付費 | 作者、機構、連結、page counter | — | 只當事實素材與外部延伸閱讀連結 |
| **Wikipedia／Simple English Wikipedia** | 百科全文 | **CC BY-SA 4.0**（加 GFDL）。標示方式：附超連結或作者名單；修改時要註明，並以 CC BY-SA 4.0 或更新版本授權，附授權連結 [WP-COPY] [WP-REUSE]。Simple English 頁尾同樣連到 CC BY-SA 4.0 [SIMPLEWP] | 可 | 可（SA）| 可 | 連結＋授權＋註明修改 | REST API；腳本要帶有聯絡方式的 User-Agent，否則可能 403 [WM-UA] | 適合「穩定基礎」難度的素材。改作出來的文章與題目**整筆標示 CC BY-SA 4.0**，存在獨立的 SA 題庫 |
| **Global Voices** | 世界各地公民新聞（含亞洲、SDG 議題）| 「Unless otherwise stated, all content created by Global Voices is published under a Creative Commons Attribution-Only license」（CC BY 3.0）；要在文章頂端附原文連結與作者名；第三方照片和影音另計 [GV]。**注意**：RSS 裡有合作媒體的轉載稿，文末寫「republished here with permission」「published on Global Voices as part of a content-sharing agreement」「republished here under a partnership agreement」（2026-10-08 實測 RSS 15 則中就有 3 則）[GV-RSS]，這些不是 GV 自製內容，不適用 CC BY | 可（限 GV 自製）| 可（限 GV 自製）| 可 | 作者、連結、註明修改 | RSS | **可挖空改作的新聞來源首選**。只用文字，不用照片；CI 遇到上述轉載字樣就排除 |
| **Frontiers for Young Minds** | 科學家寫給年輕讀者的科普文章，由 8–15 歲的青少年在科學導師協助下審稿 [FYM-ABOUT] | 文章頁：「distributed under the terms of the Creative Commons Attribution License (CC BY)」，連到 CC BY 4.0 [FYM] | 可 | 可 | 可 | 作者、期刊、連結 | 網站 | **SDGs 科學類（SDG 3／6／13／14／15）閱讀與克漏字的優質來源**，語言難度接近高中 |
| **PLOS 期刊** | 開放取用論文 | 「published immediately and freely under a CC-BY license … reuse and remix without restriction, as long as the author and the original source are properly attributed」[PLOS] | 可 | 可 | 可 | 要標示 | — | 論文太難，當作「超越頂標」的事實素材與改寫來源 |
| **Our World in Data** | 圖表、資料、文章 | 自製圖表與資料：CC BY（連到 4.0），引用即可；第三方資料「subject to the license terms of those providers」；文章可以轉載，但「You must not edit the material」[OWID-FAQ] | 圖表、資料可 | 圖表、資料可；文章不可 | 可 | 要依 FAQ 格式引用 | Chart Data API：在 grapher 網址後加 `.csv`、`.metadata.json`，免金鑰（本專案實測 200，有台灣資料）| **圖表題主來源**。每個圖表都存 `citationShort`，並檢查原始資料的授權。OWID 的 Grapher 程式碼「not freely licensed for reuse without permission」[OWID-FAQ]，所以前端自己畫圖，不複製 Grapher 程式碼 |
| **World Bank Open Data** | WDI 等指標 | 資料集預設「Creative Commons Attribution 4.0 International license (CC-BY 4.0)」，商用也可以，要標示並註明修改 [WB-DS]。網站其他素材限非商業 [WB-TOU] | 可 | 可 | 可 | 要標示 | Indicators API v2：「API keys … are no longer necessary」[WB-API] | 跨國比較圖表。**WDI 查不到台灣**，台灣數據改用 OWID 或我國政府開放資料 |
| **Project Gutenberg** | 公版書 | 在美國不受著作權限制；「If you are not located in the United States, you'll have to check the laws of the country」；Project Gutenberg 商標另有授權條件，把商標與授權文字全部移除後的純文字可以自由使用 [PG-LIC]。網站「intended for human users only」，批次下載要用鏡像站或 harvest 端點 [PG-ROBOT]。台灣著作財產權存續期間是著作人終身加死亡後 50 年 [TW-CA 第 30 條] | 可（需確認作者卒年）| 可 | 可（不使用商標）| 不需要 | 鏡像站 | 只做「超越頂標」的文學選文。著作財產權存續到著作人死亡後 50 年當年年底（第 30、35 條）[TW-CA]，所以 2026 年只能用 1975 年以前（含）過世作者的作品（**本專案推算**）。去掉 PG 標頭再使用 |
| **NewsAPI** | 新聞索引 | 免費 Developer 方案：「may be used for development and testing in a development environment only」；每日 100 次、文章延遲 24 小時、只能查一個月內 [NEWSAPI-TOU] [NEWSAPI-PRICE]。`content` 欄位「truncated to 200 chars」[NEWSAPI-DOC]。條款禁止「use the service to reproduce or republish copyrighted material」[NEWSAPI-TOU]。Business 方案每月 $449 | 不可 | 不可 | 需 Business 方案 | — | 100 次／日（開發用）| 不需要。找題材改用各媒體的 RSS 標題 |
| **NASA**（補充） | 科學新聞、影像 | NASA 媒體在美國一般不受著作權保護，教育用途不需許可。AI 應用另有規定：「attribution of the information directly to NASA is not permitted」，AI 產品裡**禁止**出現「according to NASA」等說法；只能以事實陳述說明工具包含 NASA 的素材，而且不得暗示 NASA 審閱過；NASA 也「strongly encourages」AI 產物標示為 AI 生成 [NASA] | 可 | 可 | 可（不得暗示背書）| 標示為「資料來源之一」| — | 可以當事實素材，但 AI 改寫的文章裡**不寫**「according to NASA」 |
| **Taiwan Today**（外交部，補充）| 台灣主題英文報導 | 頁尾「Copyright © 2026 Ministry of Foreign Affairs」，沒有找到開放授權聲明 [TT]。《著作權法》第 50 條允許在合理範圍內重製「以中央或地方機關或公法人之名義公開發表之著作」[TW-CA] | 合理範圍 | **未驗證** | **未驗證** | 要標示 | — | 當作台灣在地題材的事實參考；正式使用前先函詢外交部 |

### 3.2 VOA 與 VOA Learning English 的營運狀況（截至 2026-10-07）

- **2025-03-14**：美國總統簽署行政命令，要求精簡 USAGM（VOA 的上級機關）的「non-statutory components」。**2025-03-15** VOA 停播，超過 1,300 名員工被安排行政休假 [SAVEVOA]。
- **2025-04-22**：Lamberth 法官命令恢復節目。**2025-05-06** 只恢復波斯語、華語、達利語、普什圖語 4 種語言的少量內容 [SAVEVOA]。
- **2026-03**：哥倫比亞特區聯邦地方法院（Senior Judge Royce Lamberth）認定 USAGM 停止播出違反《行政程序法》，命令「operations, staffing and broadcasting activities to be fully restored」（JURIST，2026-03-19 報導）[JURIST]。
- **2026-10-05**：SaveVOA 時間軸記載，VOANews.com 恢復發文，內容是各語言服務精選報導的英文翻譯，但「It has not resumed any broadcasting in English」[SAVEVOA]。本專案 2026-10-07 實測，voanews.com 首頁確實以各語言服務的報導為主。
- **Learning English 實測**（2026-10-07）：
  - RSS 的 `lastBuildDate` 是 2026-10-07，但 20 則項目中最新的 `pubDate` 是 **2025-04-29**（Everyday Grammar Video）[VOALE-RSS]。2026-10-08 重測：`lastBuildDate` 更新為 2026-10-08，最新項目仍是 2025-04-29。
  - 「As It Is」欄目的最新日期是 **2025-03-12**（2026-10-08 重測相同）[VOALE-ASITIS]。
  - 科學與科技（Science & Technology）類別頁最新是 2025-03-17 的文章；2025-03-12 的小行星文章目前仍可正常開啟（HTTP 200）[VOALE-ART]。
- **結論**：舊文仍可取得，但 VOA Learning English 已經一年半沒有新內容。條款上的公有領域聲明還在，不過很多文章是通訊社稿件的改寫。本專案不把 VOA 當主要文章來源。

### 3.3 圖表題資料的實測

- **OWID**：`https://ourworldindata.org/grapher/annual-co2-emissions-per-country.csv?v=1&csvType=filtered&useColumnShortNames=true&time=2020..latest&country=TWN~OWID_WRL` 回傳台灣與全球 2020–2024 年的排放量（`data/raw/licensing/owid_co2.csv`；例如台灣 2024 年 262,344,820 噸）。`.metadata.json` 提供 `citationShort`：「Global Carbon Budget (2025) – with major processing by Our World in Data」（本專案實測）。
- **World Bank**：`https://api.worldbank.org/v2/country/TWN/indicator/SP.POP.TOTL?format=json` 回傳 `total: 0`；同一個查詢換成 JPN 則正常（本專案實測）。
- **UN SDG API**：`/v1/sdg/Goal/List?includechildren=false` 與 `/v1/sdg/Series/Data?seriesCode=SI_POV_DAY1&areaCode=1` 都回 200，不需要金鑰（本專案實測）。`areaCode=158`（台灣所在的「Other non-specified areas in Eastern Asia」）查 3 個序列都是 `totalElements: 0`（2026-10-08 本專案實測）。
- **台灣數據**：政府資料開放平臺的資料集採「政府資料開放授權條款－第1版」：「不限目的、時間及地域、非專屬、不可撤回、免授權金」，可以改作；要依附件「顯名聲明」標示提供機關；條款和 CC BY 4.0 相容 [TW-ODL]。個別資料集若另有授權要逐一確認。

---

## 4. 大考中心試題與相關資料的著作權

### 4.1 法律依據

| 依據 | 內容 | 來源 |
|---|---|---|
| 《著作權法》第 9 條第 1 項第 5 款 | 「依法令舉行之各類考試試題及其備用試題」不得為著作權之標的 | [TW-CA] |
| 《著作權法》第 9 條第 1 項第 4 款 | 「單純為傳達事實之新聞報導所作成之語文著作」不得為著作權之標的 | [TW-CA] |
| 《著作權法》第 10-1 條 | 著作權保護只及於表達，「不及於其所表達之思想、程序、製程、系統、操作方法、概念、原理、發現」 | [TW-CA] |
| 《著作權法》第 52 條 | 為報導、評論、教學、研究或其他正當目的之必要，可以在合理範圍內引用已公開發表的著作 | [TW-CA] |
| 《著作權法》第 54 條 | 機關、學校或教育機構辦理的考試，可以重製已公開發表的著作作為試題（**只適用於辦考試的單位**，不適用於私人 App） | [TW-CA] |
| 《著作權法》第 65 條 | 合理使用的四個判斷基準，第一項是「包括係為商業目的或非營利教育目的」 | [TW-CA] |
| 智慧局 電子郵件 1111221（111-12-21，114-04-28 更新） | 學測、指考模擬考題屬於依法令舉行之考試試題，「任何人均得利用，因此利用此類考題製作課程教材，尚不生著作權侵權問題」。但排除範圍「僅限於試題本身，並不包含解答」，具原創性與創作性的解答仍受保護 | [TIPO-1111221] |
| 章忠信〈大考中心徵題，著作權歸誰？〉（100-07-04） | 大學入學考試是依《大學法》第 24 條第 2 項辦理，受託辦理考試的大考中心，其題庫與試題「不得為著作權之標的，任何人得自由利用」，引用「不需經大考中心同意，即使未註明出處，亦不違法」 | [CNOTE] |
| 理律法律事務所（丁靜玟，2005） | 「試題所使用其他出版社或教科書業者已公開發表之著作，並不因著作內容被利用成為依法令舉行之各類考試試題，而喪失該著作本身之著作權」 | [LEEANDLI] |

### 4.2 大考中心網站的實際聲明（2026-10-07 檢視）

- 網站頁尾只有「大學入學考試中心 版權所有 © 2026 All Rights Reserved.」[CEEC-HOME]。「歷年試題及答題卷」列表頁沒有任何試題使用聲明 [CEEC-GSAT]。
- 115 學測英文試卷 PDF（12 頁）的封面是「財團法人大學入學考試中心基金會 115學年度學科能力測驗試題 英文考科」，全文沒有著作權或轉載聲明（pdftotext 檢索）[CEEC-115ENG]。
- **商標使用管理聲明**（PDF 建立日期 2026-07-02）：「非經本中心正式書面同意，任何個人或單位不得擅自將本中心商標用於商業活動；亦不得將其作為網域名稱、社群媒體帳號名稱或識別圖示（包括但不限使用於 FB、IG、LINE 等社群媒體）。」已註冊的商標包括「財團法人大學入學考試中心基金會」「大學入學考試中心」「大考中心」「CEEC」，以及兩個圖形標誌；清單是圖片，文字商標都是書法或設計字體（2026-10-08 轉成影像檢視）[CEEC-TM]。
- **作文佳作**：「酌選考生作文佳作英文考科10篇，經徵詢考生同意後，以原卷影像檔及其簡要評分說明提供各界參考」[CEEC-ESSAY115]。考生同意的是讓大考中心提供，本專案沒有因此取得轉載權。
- **詞彙表**封面：「著作權屬財團法人大學入學考試中心基金會所有，僅供非營利目的使用，轉載請註明出處。若作為營利目的使用，應事前經由財團法人大學入學考試中心基金會書面同意授權。」[V111]（詳見 `03-vocab-list.md` §9.8）
- **選文來源**：大考中心自述，115 學測英文的「題材大多來自網路文章或新聞報導等……將數篇文章資訊精簡與融合後，進行改寫」[CEEC-EP351]。

### 4.3 對本專案的意義

| 資料 | 狀態 | 本專案做法 |
|---|---|---|
| 歷屆試題（題幹、選項、閱讀選文、翻譯與作文題目） | 不受著作權保護（§9-1-5）。選文若是第三方原文的近似重製，原作者的權利仍在；試卷裡若有取自第三方的照片或圖表，依同一邏輯也保留原權利（本專案依 [LEEANDLI] 推論）| 可以結構化存進 D1 並在 App 內顯示。圖片類題目優先改用文字描述或自繪圖。**慣例上仍標示**「試題來源：大學入學考試中心 OOO 學年度學科能力測驗」，並連到官方 PDF。不使用大考中心的商標圖形 |
| 選擇題答案（A／B／C／D） | 單純的答案代號沒有創作性，推定不受保護（**本專案推論，未驗證**） | 可以存 |
| 非選擇題參考答案與評分原則、選才電子報的試題分析 | 受保護：具原創性的參考答案屬於「解答」[TIPO-1111221]；評分原則與電子報文章是本專案依一般原則推論為語文著作（沒有直接的函釋）。原版本另列的《試題與解析》出版品，查證時沒有找到出處，已刪除 | 不轉載全文。內部可以做 AI 分析的輸入，App 內只摘要重點（依 §52 合理引用短句並標示出處），並附連結 |
| 考生作文佳作 | 著作權屬考生 | 只提供連結；不拿來當 RAG 檢索的原文；範文由 Claude 原創 |
| 詳解、範文、AI 出的題目 | 本專案自己產生 | 依 [ANT-CTOS]，「As between the parties」Customer「owns its Outputs」，Anthropic 也把它對 Outputs 的權利「(if any)」讓給客戶。但這只是雙方之間的約定，不代表這些內容在我國一定受著作權保護。智慧局電子郵件 1111031 指出，「人工智慧獨立創作」，也就是人類沒有實際創意投入的成果，「原則上無法享有著作權」；把 AI 當輔助工具、由人實際投入創意的成果才受保護（引自智慧局網站上的 113 年度著作權講座講義，函釋原文未開啟，**原文未驗證**）[TIPO-AI]。所以純 AI 產出的題庫可能**無法阻止他人複製**。要主張權利，就要保留人工選題、編修、審稿的紀錄 |
| 《高中英文參考詞彙表》 | 非營利可用並註明出處；營利需書面同意 | 標示出處。只要 App 有任何收費或廣告，就先向大考中心申請書面授權 |
| 商標（大考中心、CEEC） | 註冊商標，禁止用於網域名稱、帳號、識別圖示與商業活動 | 網域、App 名稱、Logo、社群帳號都不含這些字。說明文字裡用「大學入學考試中心公告之試題」敘述來源，屬於說明性質的使用（是否完全不涉及商標使用，**未驗證**）|

---

## 5. 可讀性與難度分級

### 5.1 Flesch-Kincaid

- 公式：FKGL = 0.39 ×（平均句長）＋ 11.8 ×（平均每字音節數）− 15.59。textstat 原始碼（本地 `data/raw/licensing/ts_textstat.py`）第 581 行的 docstring 是 `(.39*avg\ sentence\ length)+(11.8*avg\ syllables\ per\ word)-15.59` [TEXTSTAT]。原始出處是 Kincaid et al. (1975) 的美國海軍技術報告，DTIC 編號 ADA006655 [KINCAID1975]（2026-10-07 DTIC 網站維護中；2026-10-08 重試被擋，Wayback 封存頁是 JS 動態載入、看不到內容，**編號未驗證**）。
- 授權：公式屬於「方法」，不受著作權保護（§10-1）[TW-CA]。textstat 是 MIT 授權 [TEXTSTAT]。可以在 CI 用 Python 計算，也可以在 Worker 用 TypeScript 自己實作（音節計算可用 CMUdict 或規則法）。
- 限制：FK 是為英語母語讀者設計，對 EFL 讀者只能當作輔助指標。

### 5.2 Lexile

- Lexile Hub FAQ（本地檔名 `lexile_hubsupport.html`，canonical 是 <https://hub.lexile.com/faqs/>）：「Results from the Lexile Analyzer are intended for classroom and instructional use only. They provide an estimated Lexile measure … and are not certified Lexile measures. They should not be used or represented as official, certified Lexile measures.」[LEXILE-FAQ]
- 搜尋引擎摘錄的免費版限制：每次最多 500 字、每月 50 次；結果「not for commercial use」、不得公開散布（**未驗證**，原頁 403）[LEXILE-SNIP]。
- 結論：Lexile 是 MetaMetrics 的專有演算法與註冊商標，無法自行計算，也**不應自稱 Lexile**。App 不顯示 Lexile。

### 5.3 CEFR 對照

- 用 CEFR-J Wordlist 1.5（A1–B2，OLP repo 的 CSV；官方最新是 1.6）加 Octanove C1–C2 對照大考詞彙表級數。同一個詞有多個詞性時取最低級，查不到的歸為 none（本專案計算）。2026-10-08 用同一批檔案重算，L5、L6 兩列完全一致，L1–L4 部分格子差 1–3 筆（斜線並列詞的拆法不同），結論不變；改用 1.6 並限條目詞類的版本見 `data/vocab/lexicon-report.md` §4：

| 大考級數 | 筆數 | A1 | A2 | B1 | B2 | C1 | C2 | 無對照 |
|---|---|---|---|---|---|---|---|---|
| L1 | 1,002 | 746 | 201 | 41 | 7 | 0 | 0 | 7 |
| L2 | 1,002 | 130 | 413 | 322 | 95 | 2 | 0 | 40 |
| L3 | 1,002 | 30 | 248 | **413** | 191 | 7 | 1 | 112 |
| L4 | 1,002 | 10 | 96 | **461** | 291 | 24 | 1 | 119 |
| L5 | 1,002 | 1 | 16 | 216 | **416** | 76 | 14 | 263 |
| L6 | 1,002 | 2 | 19 | 115 | 273 | 88 | 22 | **483** |

  大致對應：L3 ≈ B1，L4 ≈ B1–B2，L5 ≈ B2，L6 有近半數不在 CEFR-J 範圍內。App 可以顯示「約 CEFR B1」這類參考標籤，並標示「CEFR 對照依 CEFR-J Wordlist」[CEFRJ]。

### 5.4 用大考詞彙表級數估計文章難度（建議方法）

1. **詞元還原**：用 ECDICT 的 `exchange` 欄位或 `lemma.en.txt`，把屈折形還原為詞元，例如 gave→give、teeth→tooth [ECDICT] [ECDICT-LEMMA]。再加上簡單的詞族規則：-ly 副詞對應到形容詞；would、could 對應到 will、can；數字詞歸入 L1。
2. **排除**專有名詞（句中大寫且不在字典中）、數字與單一字母。
3. **計算 token 覆蓋率**：L1–2、L3–4、L5–6、表外詞（off-list）的比例，並列出表外詞清單。
4. **門檻參考**：Laufer & Ravenhorst-Kalovski (2010) 提出兩個門檻：理想門檻是認識 8,000 個詞族、覆蓋率 98%；最低門檻是 4,000–5,000 個詞族、覆蓋率 95%（兩者都含專有名詞）[LR2010]。注意大考詞彙表的 6,000 筆是「詞」不是「詞族」，不能直接比較。
5. **校準點**（本專案計算）：115 學測英文全卷（含題幹與選項，不含中文）共 3,281 個 token，各級覆蓋率如下。2026-10-08 用簡化腳本獨立重算（專有名詞與數字詞規則較粗），得到 3,321 個 token、L1–4 90.6%、L1–6 94.6%，和下表差距在 1 個百分點內：

   | 級數 | L1 | L2 | L3 | L4 | L5 | L6 | 表外 |
   |---|---|---|---|---|---|---|---|
   | 比例 | 69.0% | 12.1% | 5.6% | 4.2% | 2.3% | 2.0% | 4.8% |
   | 累計 | 69.0% | 81.2% | 86.7% | **90.9%** | 93.2% | **95.2%** | — |

   表外詞的例子有 staircase、rhinos、dementia、exacerbated（選文主題詞）。
6. **三種難度的初始設定**（**本專案的假設，要等歷屆題本結構化後，用各年度選文逐篇校準**）：
   - 穩定基礎：L1–4 ≥ 93%，表外詞 ≤ 3%，平均句長 ≤ 18 字。
   - 進階練習：接近學測實況，L1–4 約 89–92%，L1–6 約 95%，表外詞 ≤ 5% 而且都要附註解。
   - 超越頂標：L1–6 約 92–94%，表外詞 ≤ 7%，句構較複雜（可以參考舊指考選文）。
7. **輔助指標**：FK 年級、平均句長、子句密度、CEFR-J 最高等級分布。生成文章後，由 Worker 依這些門檻檢查；不合格就讓 Claude 改寫，最多重試 N 次。

---

## 6. 發音 TTS

| 方案 | 內容 | 授權／條款 | 額度與價格 | 本專案建議 |
|---|---|---|---|---|
| **Web Speech API**（`speechSynthesis`）| 瀏覽器內建語音合成 | 瀏覽器標準，沒有授權問題。MDN 標為「Baseline Widely available」，「available across browsers since September 2018」；`getVoices()` 回傳的是「available on the current device」的聲音 [MDN-SS] | 免費 | **預設發音**。聲音品質因裝置而異，要提供選擇聲音的介面，並在 `voiceschanged` 事件後重新載入聲音清單 |
| **Workers AI：MeloTTS**（`@cf/myshell-ai/melotts`）| 多語 TTS，輸出 MP3；`lang` 參數預設 `en` [CF-MELO] | 模型是 MIT（Copyright (c) 2024 MyShell.ai）[MELO-LIC]；Cloudflare 託管 [CF-MELO] | $0.0002／音訊分鐘，約 18.63 Neurons／分鐘 [CF-PRICE]（模型頁寫 $0.000205／音訊分鐘 [CF-MELO]，兩頁略有出入，以帳單為準）。免費方案與付費方案都含**每日 10,000 Neurons** [CF-PRICE]，約 536 分鐘／日（本專案計算）| **預錄單字與例句音檔**。估算：6,012 個單字每個約 1.5 秒，共約 150 分鐘，費用約 $0.03；3,006 句例句每句約 5 秒，共約 250 分鐘，費用約 $0.05（本專案估算）。在 GitHub Actions 批次產生後存 R2，前端走 CDN |
| **Workers AI：Deepgram Aura-1／Aura-2-en** | 自然語調英文 TTS，有多種聲音 | 屬於 Partner 模型，條款連到 Deepgram Terms [CF-AURA1] [CF-AURA2]（Deepgram 條款內容未逐條檢視，**未驗證**）| Aura-1 $0.015／千字元；Aura-2-en $0.030／千字元 [CF-PRICE]。每日免費額度約可合成 7,333 字元（Aura-1）或 3,667 字元（Aura-2）（本專案計算）| 文章朗讀（閱讀測驗全文）的高品質選項，結果要快取 |
| **Kokoro-82M** | 開放權重 TTS | Apache-2.0；「Kokoro has been deployed in numerous projects and commercial APIs」[KOKORO] | 自己架設 | 離線批次產生的備案（GitHub Actions 的 CPU 可以跑）|
| **Piper** | 本機 TTS | 開發已移到 `OHF-Voice/piper1-gpl`，授權 GPL-3.0 [PIPER]；各聲音模型授權不同（**未逐一驗證**）| 自己架設 | 不優先 |
| **Google Cloud TTS** | 雲端 TTS | 要啟用計費。Standard 與 WaveNet 每月前 400 萬字元免費；Neural2 與 Chirp 3 HD 前 100 萬字元免費 [GCP-TTS] | 見左 | 不需要，Cloudflare 已足夠 |
| Free Dictionary API 音檔、Tatoeba 音檔 | 真人錄音 | 來自 Wikimedia Commons（CC BY-SA）；Tatoeba 音檔授權依錄音者，空白者不得在 Tatoeba 以外使用 [FDA-SAMPLE] [TATOEBA-DL] | — | 不使用，避免逐檔授權管理 |
| Cambridge 音檔 | 英美真人發音 | 受著作權保護，可透過 License Data 洽購 [CAM-LIC] | — | 只透過外連讓使用者到 Cambridge 收聽 |

---

## 7. 最終建議：各功能用哪些來源、如何處理授權

### 7.1 功能與來源對照

| 功能 | 主要來源 | 輔助來源 | 授權處理 | App 內標示 |
|---|---|---|---|---|
| 單字主表（詞、級別、詞性） | 大考中心《高中英文參考詞彙表》 | — | 非營利使用並註明出處；營利前先取得書面授權 | 「詞彙與級別取自大學入學考試中心《高中英文參考詞彙表（111 學年度起適用）》」 |
| 音標、中文釋義、詞形變化、詞頻 | ECDICT（MIT） | OpenCC `s2twp`、Claude 改成台灣用語 | 保留 MIT 聲明；Collins 與 Oxford 只當內部特徵 | Credits 頁列出 ECDICT 與 MIT |
| 同義詞、近義、上下位、多義 | OEWN 2025（CC BY 4.0） | Wiktionary（kaikki，CC BY-SA）、Datamuse `rel_syn` | OEWN：標示 Princeton WordNet 與 OEWN。Wiktionary：只顯示自己整理的關聯詞清單；顯示原句時要標 SA | 「同義詞資料：Open English WordNet（CC BY 4.0），衍生自 Princeton WordNet」 |
| 搭配詞 | Datamuse（CI 離線）、Google Books Ngram（CC BY 3.0）自算 | 歷屆試題語料（不受著作權保護）、Claude 篩選 | 不使用 Oxford Collocations。搭配詞組合本身屬於語言事實，例句另外生成 | 「搭配詞候選來自 Datamuse API／Google Books Ngram，經 AI 篩選」 |
| 片語 | 歷屆試題語料、Wiktionary 片語條目 | Claude 生成解釋 | 解釋與例句由 Claude 原創；只把 Wiktionary 當候選清單 | — |
| 例句 | Tatoeba 英中對照（CC BY 2.0 FR） | OEWN 例句（CC BY 4.0）、Claude 原創例句 | Tatoeba 逐句標示作者與句子連結；AI 例句標示「AI 生成」 | 每句例句旁小字顯示「Tatoeba #12345 by 作者名」或「AI 生成」 |
| 歷屆出現重要度 | 學測 83–115、指考 91–110 試題（不受著作權保護） | ECDICT `frq`／`bnc`、CEFR-J | 試題可以自由利用；仍標示來源年度 | 「依大考中心歷屆試題統計（本站計算）」 |
| 外部辭典 | Cambridge 英漢繁體（外連） | Cambridge 官方 Search Widget | 只外連，不嵌入、不爬取 | 按鈕「在 Cambridge 辭典查看」 |
| 克漏字、文意選填、篇章結構、詞彙題的文章 | **Claude 依事實清單寫的原創文章** | 可改作的 CC BY 文字：Global Voices、FYM、PLOS（標示並註明修改）；CC BY-SA：Simple English Wikipedia（獨立 SA 題庫） | 見 §7.2 的流程 | 原創文章標「本文由 AI 參考下列資料撰寫，非原文轉載」並列出參考連結；CC BY 改作標「改寫自 [作者]《標題》，[來源]，CC BY 4.0，經本站刪節與挖空」 |
| SDGs 閱讀（長文、多文本） | Claude 原創；事實來自 UN News、SDG Report、FYM、Global Voices、Wikipedia | OWID、World Bank 數據 | UN、UNICEF、UNESCO、The Conversation、Guardian 只當事實素材或外部連結（Guardian 連 AI 擷取都不行） | 同上；SDG 標籤只用文字，不用官方圖示 |
| 圖表題、表格題 | OWID Chart Data API（CC BY 4.0，並依原始資料授權）、World Bank（CC BY 4.0）、UN SDG API | 我國政府開放資料（台灣數據；授權**未在本文驗證**）| 圖表由前端自己繪製（不貼 OWID 的圖片）；每張圖存原始資料的 citation | 圖下標示「資料來源：Global Carbon Budget (2025) – with major processing by Our World in Data（CC BY 4.0）」 |
| 翻譯、作文題目 | 歷屆試題（不受著作權保護）＋ Claude 仿題 | — | 歷屆題標年度；仿題標 AI | — |
| 範文、詳解、批改評語 | Claude 原創 | 大考中心評分原則只做內部參考 | 不轉載佳作與評分原則全文。純 AI 產出可能不受著作權保護（§4.3）| 「AI 生成範文，僅供參考」；批改頁明示「本評分由 AI 產生，非大考中心評分」 |
| 手寫作文 OCR 與批改（使用者上傳）| 使用者自己的作文與照片 | — | 作文著作權屬學生；照片是個人資料。要在服務條款取得「為批改而儲存、傳給 AI 處理」的授權，並依個資法告知（§7.5）| 上傳頁顯示告知事項與保存期限 |
| 發音 | Web Speech API；MeloTTS 預錄 | Aura（文章朗讀） | MeloTTS 是 MIT；Aura 依 Deepgram 條款 | Credits 頁列出 |

### 7.2 「事實素材 → AI 原創文章」流程（降低著作權風險）

1. **找題材**：只存 RSS 標題、網址、日期、SDG 編號，不存全文。Guardian、UNESCO 不進入自動化流程。
2. **萃取事實**（GitHub Actions）：
   - 優先使用 PD、CC BY、CC BY-SA 和數據來源（Global Voices、FYM、PLOS、Wikipedia、OWID、World Bank、SDG API、VOA 自製文章）。
   - UN News、UNICEF 等非開放來源，只由人工閱讀後整理成「事實清單」，不讓爬蟲抓全文。
   - 事實清單只保留數字、日期、人名、地名、因果關係，**不保留原句**。
3. **生成**：Claude 只拿到事實清單和難度規格（字數、級數分布、目標文法點、搭配詞、題型），**不提供原文全文**。這樣做是為了避免輸出和原文表達相似；而且 Anthropic 的智財賠償不涵蓋因 Inputs 引起的主張，也不涵蓋因客戶修改 Outputs、或把 Outputs 和非 Anthropic 內容結合所引起的主張（K.3）[ANT-CTOS]，原文本來就不該當成 Input 交給 Claude 改寫。CC BY 改作的文章（人工挖空 Global Voices 原文）屬於「結合」，不在賠償範圍內，要自己確保授權標示正確。
4. **相似度檢查**：每篇文章和它的每個來源比對，例如 8-gram 重疊率，以及最長共同字串長度。超過門檻就重新生成。門檻值待訂，建議初始設為「沒有任何 12 個字以上的連續相同字串」（**本專案建議**）。
5. **事實核對**：Worker 把文章裡的數字回查來源。依 Anthropic 條款，必須告知使用者「AI 輸出的事實陳述可能不正確」[ANT-CTOS]。
6. **標示**：文章頁列出「參考資料」連結。NASA 素材不寫「according to NASA」[NASA]；SDG 圖示照指引加聲明 [SDG-COMM]。
7. **抽查**：每批文章人工抽查約 10%，確認事實正確、語言自然、難度符合規格。
8. **Usage Policy 的對照**：Anthropic Usage Policy 把「Media or professional journalistic content」（自動產生內容並對外發布）和「Academic testing, accreditation and admissions」（辦理入學考試的標準化測驗機構，含評分、排名考生）列為 High-Risk Use Cases，要求發布前由合格專業人員審閱，並在每個工作階段開頭告知使用者有用 AI [ANT-AUP]。本專案是練習用 App，不辦理真正的入學考試，文章也不是新聞報導，所以推定不屬於這兩類（**本專案判斷，未驗證**）。不過為了保守起見，仍照做「人工審閱＋AI 標示」：上面第 7 步的抽查由具英文教學背景的人執行，文章頁與批改頁都標示 AI 生成。

### 7.3 資料庫的授權欄位（建議）

每筆文章、題目、例句、辭典資料都加上以下欄位，讓 Credits 頁和授權檢查可以自動產生：

```
source_id, source_name, source_url, license (e.g. "CC-BY-4.0" / "CC-BY-SA-4.0" / "PD-VOA" / "MIT" / "CEEC-exam" / "original-ai"),
license_url, attribution_text, derivation ("verbatim" | "adapted" | "ai-original-from-facts"),
share_alike (bool), commercial_ok (bool), retrieved_at
```

- `share_alike = true` 的題目放在獨立集合，下載或分享時一併附上 CC BY-SA 授權。
- `commercial_ok = false` 的資料（例如 WHO 出版品、ECDICT lemma 檔、大考詞彙表的營利用途），在 App 開始收費前要全面清查。
- Octanove C1–C2 標籤、wordfreq 詞頻、Wiktionary／kaikki 摘錄、CC-CEDICT 都是 CC BY-SA，要記 `share_alike = true`。

### 7.4 禁止清單

- 不爬取 Cambridge、Oxford、Guardian、UNESCO、Project Gutenberg 主站的頁面，也不建立它們內容的資料庫。
- 不用 iframe 嵌入 Cambridge。
- 不把 Guardian 的任何內容交給 Claude。
- 不把 The Conversation、OWID 文章、WHO 出版品、UN 網站文章挖空或改寫後放進題庫。
- 不把 VOA Learning English 的通訊社改寫稿當作公有領域。
- 不在介面顯示 Lexile、Collins、Oxford 3000 等品牌指標。
- 網域、App 名稱、Logo 不使用「大考中心」「CEEC」。
- 不用 CI 腳本到 mdbg.net 自動下載 CC-CEDICT（網站禁止自動化存取）。
- 不把 Global Voices 的合作媒體轉載稿當成 CC BY。

### 7.5 未成年使用者與使用者上傳內容（本次補充）

使用者主要是 15–18 歲的高中生，作文批改還會收手寫照片，這兩件事有額外的條款與法規要求：

| 項目 | 依據 | 本專案做法 |
|---|---|---|
| Anthropic 的未成年人規定 | Usage Policy（2025-09-15 生效）：「Products serving minors … must comply with the additional guidelines outlined in our Help Center article」；minor 指「any individual under the age of 18 years old, regardless of jurisdiction」[ANT-AUP]。Help Center 指引（2026-03-16 版）要求的措施包括：年齡驗證、內容審查與過濾、監控與回報機制、安全使用說明；要遵守當地兒少與隱私法規，並「clearly stated on the organization's website」；必須告知使用者「they are interacting with an AI system rather than a human」。Anthropic 會定期稽核，違規率高又不改善可能停權 [ANT-MINORS] | 登入時確認身分與年齡層；所有 AI 回覆過濾後才顯示；AI 對話頁開頭固定顯示「你正在和 AI 對話」；隱私權政策頁寫明遵循的法規；若 Anthropic 提供 child-safety system prompt 就套用 |
| 消費者聊天介面 | Usage Policy：「All consumer-facing chatbots … must disclose to users that they are interacting with AI rather than a human」，至少每個對話開頭要告知 [ANT-AUP] | 同上 |
| 個人資料（作文內容、手寫照片、帳號）| 《個人資料保護法》第 8 條：向當事人蒐集時要告知機關名稱、目的、資料類別、利用期間／地區／對象／方式、當事人權利等；第 19 條：非公務機關蒐集要有特定目的，並符合契約關係或當事人同意等要件；第 20-1 條：要做安全維護；第 21 條：國際傳輸可能被主管機關限制 [TW-PDPA] | 上傳前顯示告知事項（會傳給 Anthropic 的 API 處理；資料處理地點推定在台灣境外，**未驗證**，第 21 條的國際傳輸問題要一併評估）；照片 OCR 後預設刪除原圖，只留文字；作文文字不放進 AI 稽核日誌全文。未成年人同意是否需要法定代理人一併同意，屬民法與個資法交錯問題，**未驗證**，上線前請律師確認 |
| 學生作文的著作權 | 學生自己寫的作文是學生的著作（《著作權法》第 10 條：「著作人於著作完成時享有著作權」）[TW-CA] | 服務條款取得「為批改、統計與改進服務而儲存與處理」的非專屬授權；未經另外同意，不把學生作文當範文公開 |

---

## 8. 待決事項與未驗證清單

1. ~~Cambridge 網站條款全文~~：2026-10-08 已用 Wayback 封存頁（2026-10-04）逐字核對，見 §2.1 [CAM-TOU]。直連仍是 403，正式上線前建議再用瀏覽器人工看一次現行版。舊 API 的試用條款也已用封存頁核對 [CAM-API-WB]；**正式授權的費率仍未知**，要寄信詢價。
2. Princeton WordNet 授權頁（Cloudflare 驗證擋下）。本文改用 OEWN repo 裡附的 WordNet 授權全文。
3. 大考中心是否同意本專案在付費 App 中使用《參考詞彙表》，以及說明文字中提到「大學入學考試中心」是否算商標使用。建議寄信詢問大考中心。
4. 國家教育研究院樂詞網的「政府網站資料開放宣告」和另一頁的「版權聲明」互相矛盾，要函詢確認。
5. UN SDG Global Database API 的資料授權，是否等同於 UNdata 的「可自由複製並引用」。
6. Datamuse 要用在面對使用者的應用，需要先寫信；2027 年起需要 API key（公告寫 2027-02-01，使用限制段落寫 2027-01-01，兩者不一致）。
7. Lexile 免費 Analyzer 的使用限制（500 字、禁止散布等），只有搜尋摘錄。
8. NGSL 的 CC 授權版本（2026-10-08 再看首頁、/about、/faqs-4，只寫「released under Creative Commons」「the least restrictive Creative Commons License」，仍沒有版本）、EVP 授權（englishprofile.org 字表頁 2026-10-08 仍是 404）、Deepgram 條款、Piper 各聲音模型的授權、UNICEF Data 條款（403）都還沒逐條核對。
9. 美國政府著作（VOA、NASA）在台灣是否同樣不受保護（17 U.S.C. §105 只適用於美國境內），**未驗證**。本專案以「來源自己宣告為公有領域」和「事實素材化」兩層方式降低風險。
10. 三種難度的詞彙覆蓋率門檻（§5.4），要等歷屆題本結構化後逐篇校準。
11. 純 AI 生成的題目、範文、詳解在我國是否受著作權保護：目前依據是智慧局網站上講座講義引用的電子郵件 1111031，函釋原文還沒開啟核對 [TIPO-AI]。智慧局是否已正式發布生成式 AI 著作權指引，**未驗證**。
12. 本專案是否落在 Anthropic Usage Policy 的 High-Risk Use Cases（「Academic testing, accreditation and admissions」「Media or professional journalistic content」）：本專案判斷不屬於，**未驗證**，可寫信向 Anthropic 確認（§7.2 第 8 步）。
13. 未成年人使用與個資：法定代理人同意的要件、資料傳到境外處理的評估、隱私權政策內容，都要請律師確認（§7.5）。
14. 大考中心已註冊商標是否包含純文字字樣（聲明 PDF 只列出設計字樣與圖形）：可在智慧局商標檢索系統查詢。
15. Taiwan Today 沒有找到開放授權聲明（首頁直連 403，第二次取得的頁尾只有「Copyright © 2026 Ministry of Foreign Affairs」）。

---

## 9. 來源

所有網址都是 2026-10-07 存取（標 2026-10-08 者為查證時新增或重測）；原始檔在 `data/raw/licensing/`，查證時新增的檔案在 `data/raw/licensing/verify04/`。

**辭典與詞彙**
- **[CAM-TC]** Cambridge Dictionary 英漢繁體條目：<https://dictionary.cambridge.org/dictionary/english-chinese-traditional/abandon>
- **[CAM-ABOUT]** Cambridge Dictionary About：<https://dictionary.cambridge.org/about.html>
- **[CAM-ROBOTS]** <https://dictionary.cambridge.org/robots.txt>
- **[CAM-LIC]** License our data：<https://dictionary.cambridge.org/license.html>
- **[CAM-WIDGET]** Free widgets：<https://dictionary.cambridge.org/freesearch.html>
- **[CAM-API]** <http://dictionary-api.cambridge.org>（實測 301 → <https://dictionary.cambridge.org/>）
- **[CAM-API-SNIP]** 舊 API 頁（搜尋引擎索引，現已 301）：<https://dictionary-api.cambridge.org/api/faq>、<https://dictionary-api.cambridge.org/api/terms-and-conditions>
- **[CAM-API-WB]** 舊 API 頁的 Wayback 封存（2026-04-10，2026-10-08 存取）：FAQ <https://web.archive.org/web/20260410090719/https://dictionary-api.cambridge.org/api/faq>、Terms <https://web.archive.org/web/20260410083528/https://dictionary-api.cambridge.org/api/terms-and-conditions>、About <https://web.archive.org/web/20260410084154/https://dictionary-api.cambridge.org/api/about>（本地 `verify04/cam_api_*_wb*.txt`）
- **[CAM-TOU]** Cambridge Website Terms：<https://www.cambridge.org/legal/website-terms-of-use>（直連 403）。逐字核對用的是 Wayback 封存 <https://web.archive.org/web/20261004132417/https://www.cambridge.org/legal/website-terms-of-use>（2026-10-08 存取，本地 `verify04/cam_tou_wb20261004.txt`）。辭典頁尾連結 <https://www.cambridge.org/about-us/terms-use/> 會 301 轉到這一頁（依 Wayback 2026-10-03 紀錄）
- **[ECDICT]** <https://github.com/skywind3000/ECDICT>（README、LICENSE、ecdict.csv）
- **[ECDICT-LEMMA]** <https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt>
- **[OEWN]** <https://github.com/globalwordnet/english-wordnet>、<https://en-word.net/>
- **[OEWN-LIC]** <https://raw.githubusercontent.com/globalwordnet/english-wordnet/main/LICENSE.md>
- **[OEWN-WNDB]** <https://raw.githubusercontent.com/globalwordnet/english-wordnet/main/WNDB_License.txt>
- **[PWN]** <https://wordnet.princeton.edu/license-and-commercial-use>（Cloudflare 驗證擋下）
- **[WIKT]** <https://en.wiktionary.org/wiki/Wiktionary:Copyrights>
- **[KAIKKI]** <https://kaikki.org/dictionary/>；**[KAIKKI-RAW]** <https://kaikki.org/dictionary/rawdata.html>
- **[WIKTEXTRACT]** <https://github.com/tatuylonen/wiktextract>
- **[FDA]** <https://dictionaryapi.dev/>、<https://github.com/meetDeveloper/freeDictionaryAPI>
- **[FDA-SAMPLE]** <https://api.dictionaryapi.dev/api/v2/entries/en/abandon>
- **[MW]** <https://dictionaryapi.com/info/frequently-asked-questions>
- **[CEDICT]** <https://www.mdbg.net/chinese/dictionary?page=cc-cedict>
- **[OPENCC]** <https://github.com/BYVoid/OpenCC>
- **[NAER-OPEN]** 樂詞網 政府網站資料開放宣告：<https://terms.naer.edu.tw/mysite/about/2/>
- **[NAER-PRIV]** 樂詞網 隱私權及版權聲明：<https://terms.naer.edu.tw/mysite/about/4/>
- **[NAER-DL]** 樂詞網 下載專區：<https://terms.naer.edu.tw/download/>
- **[OCD]** <https://www.oxfordlearnersdictionaries.com/definition/collocations/>
- **[OXAPI]** <https://developer.oxforddictionaries.com/about>
- **[DATAMUSE]** <https://www.datamuse.com/api/>
- **[NGRAM]** <https://storage.googleapis.com/books/ngrams/books/datasetsv3.html>
- **[WORDFREQ]** <https://github.com/rspeer/wordfreq>
- **[TATOEBA-DL]** <https://tatoeba.org/en/downloads>；**[TATOEBA-TOU]** <https://tatoeba.org/en/terms_of_use>
- **[CEFRJ]** <https://www.cefr-j.org/download.html>；**[OLP]** <https://github.com/openlanguageprofiles/olp-en-cefrj>
- **[NGSL]** <https://www.newgeneralservicelist.com/>
- **[CC-BYND]** <https://creativecommons.org/licenses/by-nd/4.0/legalcode.en>；**[CC-FAQ]** <https://creativecommons.org/faq/>

**文章與數據**
- **[VOA-TOU]** <https://www.voanews.com/p/5338.html>
- **[VOALE-TOU]** <https://learningenglish.voanews.com/p/6021.html>
- **[VOALE-RSS]** <https://learningenglish.voanews.com/api/>
- **[VOALE-ASITIS]** <https://learningenglish.voanews.com/z/3521>
- **[VOALE-ART]** <https://learningenglish.voanews.com/a/methods-for-protecting-earth-against-an-asteroid-strike/7989189.html>
- **[SAVEVOA]** <https://savevoa.com/timeline.html>
- **[JURIST]** <https://www.jurist.org/news/2026/03/us-federal-judge-orders-voice-of-america-broadcasting-restored/>
- **[UN-TOU]** <https://www.un.org/en/about-us/terms-of-use>；**[UN-COPY]** <https://www.un.org/en/about-us/copyright>；**[UNNEWS]** <https://news.un.org/en/>
- **[SDG-COMM]** <https://www.un.org/sustainabledevelopment/news/communications-material/>（SDG Guidelines PDF 連結：<https://www.un.org/sustainabledevelopment/wp-content/uploads/2023/09/E_SDG_Guidelines_Sep20238.pdf>，未開啟）
- **[SDG-API]** <https://unstats.un.org/sdgs/UNSDGAPIV5/swagger/index.html>（spec：<https://unstats.un.org/sdgs/UNSDGAPIV5/swagger/v1/swagger.json>）
- **[UNDATA]** <https://data.un.org/Host.aspx?Content=UNdataUse>
- **[SDGR2025]** <https://unstats.un.org/sdgs/report/2025/The-Sustainable-Development-Goals-Report-2025.pdf>
- **[UNICEF]** <https://www.unicef.org/legal>
- **[WHO-COPY]** <https://www.who.int/about/policies/publishing/copyright>；**[WHO-DATA]** <https://www.who.int/about/policies/publishing/data-policy/terms-and-conditions>
- **[UNESCO-TOU]** <https://www.unesco.org/en/terms-use>；**[UNESCO-OA]** <https://www.unesco.org/en/open-access>
- **[GUARDIAN-ACCESS]** <https://open-platform.theguardian.com/access/>；**[GUARDIAN-TOU]** <https://www.theguardian.com/open-platform/terms-and-conditions>
- **[CONV]** <https://theconversation.com/us/republishing-guidelines>
- **[WP-COPY]** <https://en.wikipedia.org/wiki/Wikipedia:Copyrights>；**[WP-REUSE]** <https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content>；**[SIMPLEWP]** <https://simple.wikipedia.org/wiki/Wikipedia:Copyrights>；**[WM-UA]** <https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy>
- **[GV]** <https://globalvoices.org/about/global-voices-attribution-policy/>
- **[GV-RSS]** Global Voices RSS：<https://globalvoices.org/feed/>（2026-10-08 存取）
- **[TW-ODL]** 政府資料開放授權條款－第1版：<https://data.gov.tw/license>（2026-10-08 存取，本地 `verify04/datagov_license.txt`）
- **[FYM]** <https://kids.frontiersin.org/articles/10.3389/frym.2026.1664406>（文章頁授權聲明）；**[FYM-ABOUT]** <https://kids.frontiersin.org/about/journal>
- **[PLOS]** <https://plos.org/open-science-publishing/>（由 <https://plos.org/license/> 轉址）
- **[OWID-FAQ]** <https://ourworldindata.org/faqs>
- **[WB-DS]** <https://datacatalog.worldbank.org/public-licenses>；**[WB-TOU]** <https://www.worldbank.org/ext/en/legal/terms-conditions>；**[WB-API]** <https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation>
- **[PG-LIC]** <https://www.gutenberg.org/policy/license.html>；**[PG-ROBOT]** <https://www.gutenberg.org/policy/robot_access.html>
- **[NEWSAPI-PRICE]** <https://newsapi.org/pricing>；**[NEWSAPI-TOU]** <https://newsapi.org/terms>；**[NEWSAPI-DOC]** <https://newsapi.org/docs/endpoints/everything>
- **[NASA]** <https://www.nasa.gov/nasa-brand-center/images-and-media/>
- **[TT]** <https://taiwantoday.tw/>

**大考中心與法規**
- **[TW-CA]** 《著作權法》（全國法規資料庫，最新修正 111-06-15）：<https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0070017>
- **[TIPO-1111221]** 智慧局著作權主題網 解釋資料 電子郵件1111221：<https://www.tipo.gov.tw/tw/copyright/692-16847.html>
- **[CNOTE]** 章忠信〈大考中心徵題，著作權歸誰？〉：<https://www.copyrightnote.org/ArticleContent.aspx?ID=2&aid=415>
- **[LEEANDLI]** 理律法律事務所〈試題與著作權〉：<https://www.leeandli.com/TW/Newsletters/2254.htm>
- **[CEEC-HOME]** <https://www.ceec.edu.tw/>
- **[CEEC-GSAT]** 學測 歷年試題 一般試題：<https://www.ceec.edu.tw/xmfile?xsmsid=0J052424829869345634>
- **[CEEC-115ENG]** 115 學測英文試卷：<https://www.ceec.edu.tw/files/file_pool/1/0q054532302653501476/02-115%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf>
- **[CEEC-TM]** 大學入學考試中心商標使用管理聲明：<https://www.ceec.edu.tw/files/file_pool/1/0Q245474553537345169/%E5%A4%A7%E5%AD%B8%E5%85%A5%E5%AD%B8%E8%80%83%E8%A9%A6%E4%B8%AD%E5%BF%83%E5%95%86%E6%A8%99%E4%BD%BF%E7%94%A8%E7%AE%A1%E7%90%86%E8%81%B2%E6%98%8E.pdf>
- **[CEEC-ESSAY115]** 115 學測英文作文佳作：<https://www.ceec.edu.tw/xmdoc/cont?xsmsid=0J071624926253508127&sid=0Q077622448864496628>
- **[CEEC-EP351]** 選才電子報〈115學年度學科能力測驗試題特色－【英文】〉：<https://www.ceec.edu.tw/xcepaper/cont?xsmsid=0J066588036013658199&qunit=0Q105367191322447606&sid=0Q105583094870257539>
- **[V111]** 《高中英文參考詞彙表（111 學年度起適用）》封面，網址見 `03-vocab-list.md` §10（本地 `data/raw/vocab/ceec-wordlist-111.pdf`）
- **[TIPO-AI]** 賴文智律師〈AI人工智慧相關著作權議題〉，113 年度經濟部智慧財產局著作權講座講義（智慧局網站附件），引用智慧局電子郵件 1111031、1121229：<https://www.tipo.gov.tw/wSite/public/Attachment/0/f1747358373643.pdf>（2026-10-08 存取，本地 `verify04/tipo_f1747358373643.pdf`）
- **[TW-PDPA]** 《個人資料保護法》（全國法規資料庫，最新修正 114-11-11）：<https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0050021>（2026-10-08 存取）

**可讀性**
- **[TEXTSTAT]** <https://github.com/textstat/textstat>（LICENSE：MIT；公式見 `textstat/textstat.py`）
- **[KINCAID1975]** Kincaid, J. P. et al. (1975), DTIC ADA006655：<https://apps.dtic.mil/sti/citations/ADA006655>（2026-10-07 網站維護中）
- **[LEXILE-FAQ]** <https://hub.lexile.com/faqs/>
- **[LEXILE-SNIP]** 搜尋引擎摘錄：<https://hub.lexile.com/?p=547>（403，未驗證）
- **[LR2010]** Laufer, B. & Ravenhorst-Kalovski, G. C. (2010). Lexical threshold revisited. *Reading in a Foreign Language*, 22(1)：<https://nflrc.hawaii.edu/rfl/item/206>

**TTS 與 AI**
- **[MDN-SS]** <https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis>
- **[CF-PRICE]** <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- **[CF-MELO]** <https://developers.cloudflare.com/workers-ai/models/melotts/>
- **[CF-AURA1]** <https://developers.cloudflare.com/workers-ai/models/aura-1/>；**[CF-AURA2]** <https://developers.cloudflare.com/workers-ai/models/aura-2-en/>
- **[MELO-LIC]** <https://github.com/myshell-ai/MeloTTS>（LICENSE：MIT）
- **[KOKORO]** <https://huggingface.co/hexgrad/Kokoro-82M>
- **[PIPER]** <https://github.com/OHF-Voice/piper1-gpl>（COPYING：GPL-3.0）；舊 repo <https://github.com/rhasspy/piper>
- **[GCP-TTS]** <https://cloud.google.com/text-to-speech/pricing>
- **[ANT-CTOS]** Anthropic Commercial Terms of Service（Effective June 17, 2025）：<https://www.anthropic.com/legal/commercial-terms>（引用條款：B 段 Outputs 歸屬、D.3、K.1、K.3）
- **[ANT-AUP]** Anthropic Usage Policy（Effective September 15, 2025）：<https://www.anthropic.com/legal/aup>（2026-10-08 存取）
- **[ANT-MINORS]** Claude Help Center〈Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors〉（頁面日期 2026-03-16）：<https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors>（2026-10-08 存取）
