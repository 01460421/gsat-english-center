# 07｜高中英文教科書（108 課綱版）的文法、句型、連接詞與片語範圍

> 撰寫日期：2026-10-08。範圍：普通型高中部定必修英文（第一～五冊）。
> 對應資料檔：[`data/curriculum/grammar-patterns.json`](../../data/curriculum/grammar-patterns.json)，收錄句型 108 個、連接詞 111 個、片語 286 個，所有例句都是本專案自己寫的。
> 用途：翻譯（中譯英）與作文命題時「考量課程內容」，範文要「靈活運用高中所學的連接詞、片語、常用句型」。
> 標記：〔官〕表示大考中心文件明示；〔參〕表示大考中心參考答案用了這個寫法；〔析〕表示本文自行分析，不是官方說法；（未驗證）表示找不到一手來源。

---

## 0. 重點摘要

1. **108 課綱的部定必修英文只有五冊，沒有「第六冊」。** 國教院 115-1 審定清冊裡，普高英文第一～五冊的出版者是「三民、三民(乙版)、翰林、龍騰」四套 [S-naer-list]。必修學分是高一、高二每學期 4 學分，高三上 2 學分，合計 18 學分。高三下沒有部定必修課本，只有加深加廣選修（英語聽講、英文閱讀與寫作、英文作文）[S-curr]。所以需求中的「第一至第六冊」，本文改為 B1–B5，再加上一節說明高三下的情況。
2. **課綱沒有列出高中要教的文法清單。** 第五學習階段的學習內容只寫「Ad-Ⅴ-1 高中階段所學的結構」；附錄六只列國中基礎文法 [S-curr]。所以高中實際教哪些句型，是由各家教科書決定的。課綱另外把句型分成兩類：較常用、需要會用的「應用結構」，以及較複雜、只需理解的「認識結構」[S-curr]。JSON 的設計呼應這個區分〔析〕：`typical_use` 為 `translation`／`all` 的高頻句型要練到會用；高二以後的倒裝、假設等 `composition` 句型，大多數學生先求看懂，有餘力再用在作文裡。
3. **逐課句型只取得龍騰版。** 龍騰 B1（113–114 學年度版）、B3（111 版）、B4（111 版）、B5（112 版）的逐課句型，可以從中山女高、師大附中、金甌女中公開的課程計畫核對 [S-cogsh-114-1-g10][S-csghs-111-1-g11][S-hsnu-111-1-g11][S-csghs-111-2-g11][S-csghs-112-1-g12]。B2 只取得課名。三民甲版、乙版只有各課課名，翰林沒有任何課次資料（未驗證）。
4. **龍騰的進度大致如下**：B1 教名詞子句、關係子句、使役動詞、so/such…that、the + 比較級、分詞構句；B3 教虛受詞 it、完成式被動、感官動詞被動、It is not until…that、介系詞＋關代、否定倒裝；B4 集中教假設語氣（與現在、過去事實相反、But for、意志動詞＋should）、Not until 和 Only 倒裝、倍數比較、關係副詞；B5 教複合關代、lest、倍數、as if、省略 if 的倒裝，並加入篇章概念（指涉、同義重述、轉承詞、平行結構）。
5. **學測中譯英常用的句型其實很基礎。** 本文逐題分析 93–115 學年度學測的 46 個中譯英句子（§5）：
   - 最常用的是現在完成式（10 句，其中 7 句有大考中心佐證）、比較級／最高級（9 句）、分詞片語或分詞構句（8 句）、動名詞主詞（7 句）、關係子句（6 句）、被動語態（6 句）、副詞子句（6 句）、不定詞表目的（5 句）。
   - **沒有任何一句必須用倒裝、假設語氣、It is…that 強調句或 No sooner…than。**
   - 大考中心考試說明寫的是「高中階段所學之基本句型（例如：單句、合句、複句）」[S-ceec-115-spec]。115 學測試題特色也說，中譯英「多使用基礎文法句構與觀念即能作答」，並建議教師「考慮捨棄課本或教材中過難及罕見的文法句型」[S-ceec-ep351]。
6. **對 App 的建議**：中譯英命題的主軸放在上述高頻句型。課本高二下到高三的倒裝和假設語氣，留給「超越頂標」難度的題目和作文範文使用。轉承詞依功能（遞進、轉折、因果、舉例、結論…）均衡使用，讓範文看得出文章結構（§6）。

---

## 1. 範圍、名詞與資料來源

### 1.1 普高英文必修冊次與出版社

| 項目 | 內容 | 來源 |
|---|---|---|
| 部定必修冊次 | 第一冊～第五冊（高一上、高一下、高二上、高二下、高三上） | [S-naer-list] |
| 115-1 審定出版者 | 三民、三民(乙版)、翰林、龍騰 | [S-naer-list] |
| 龍騰執照號碼 | B1 普審字第108032號、B2 108121、B3 109057、B4 109109、B5 110033 | [S-naer-list] |
| 三民（甲版）執照號碼 | B1 108033、B2 108132、B3 109068、B4 109108、B5 110026 | [S-naer-list] |
| 三民（乙版）執照號碼 | B1 112007、B2 112017、B3 113012、B4 113016、B5 114008 | [S-naer-list] |
| 翰林執照號碼 | B1 108005、B2 108120、B3 109049、B4 109092、B5 110032 | [S-naer-list] |
| 三民甲、乙版主編 | 甲版：車畇庭；乙版：劉宇挺（二手資料） | [S-blog-sm] |
| 必修學分 | 第十、十一年級每學期 4 學分，第十二年級上學期 2 學分 | [S-curr] |
| 高三下 | 沒有部定必修英文。加深加廣選修有英語聽講、英文閱讀與寫作、英文作文（各 2 學分），學測只考部定必修範圍 | [S-curr]；另見 [01-curriculum-108.md](01-curriculum-108.md) |

清冊上的執照號碼和出版者是分行排版的，本文依「出版者名稱的上下行」對應到序號。龍騰 B1＝108032 也與師大附中 114-1 的版本明細表一致（附中檔案網址未保存，未另列來源）。

### 1.2 取得了哪些資料、缺了哪些

| 出版社 | 課次目錄 | 逐課文法／句型 | 主要來源 |
|---|---|---|---|
| 龍騰 | B1–B5 全部 | B1（113–114 版）、B3（111 版）、B4（111 版）、B5（112 版，114-1 內容相同）；**B2 未取得** | 金甌、中山、附中課程計畫；部落格課次表 |
| 三民（甲版） | B1–B5 課名 | **未取得** | 部落格（二手） |
| 三民（乙版） | B1–B5 課名（B1 經均一核對、B3 經金甌計畫核對） | **未取得** | 部落格、均一、金甌 |
| 翰林 | **未取得**（只確認清冊上有第一～五冊） | **未取得** | 清冊 |

搜尋過程：學校課程計畫（臺北市公私立高中、師大附中、大直、花蓮女中等）中，逐課列出句型的大多是龍騰版，三民和翰林的計畫多半只列課名或議題。出版社官網的目錄頁、試閱本與酷英網「課本戰力提升包」，本次都沒有取得可公開引用的逐課句型（未驗證）。所以第 3 節的句型對照表只有龍騰是完整的。

### 1.3 版本更迭（同一冊不同學年課文不同）

| 冊 | 課 | 舊版 | 新版 | 證據 |
|---|---|---|---|---|
| B1 | L1 | Freshman Zit Girl（109-1、112-1 仍使用） | Firsts in Life（附中 113-1 起） | [S-dcsh-109-1][S-csghs-112-1-g10][S-hsnu-113-1-g10][S-cogsh-114-1-g10] |
| B1 | L7 | The White Envelope | From Trash to Triumph | 同上 |
| B2 | L3 | Mammon and the Archer（110-2、112-2） | The Birthmark（114-2） | [S-csghs-110-2-g10][S-hsnu-112-2-g10][S-hsnu-114-2-g10] |
| B3 | L6 | My Life in Your Hands（110-1、111-1） | The Country of the Blind（114-1） | [S-csghs-110-1-g11][S-csghs-111-1-g11][S-hsnu-114-1-g11][S-csghs-114-1-g11] |
| B4 | L1 | The Lady or the Tiger?（111-2） | The Bet（114-2） | [S-csghs-111-2-g11][S-hsnu-114-2-g11] |
| B5 | L1 | Life Lessons in Rudyard Kipling's "If—"（111–114） | The Road Not Taken（部落格稱 115 起更新，未驗證） | [S-hsnu-111-1-g12][S-csghs-114-1-g12][S-blog-lt] |
| 三民乙版 B1 | Unit 2 | I See You, Taiwan | 部落格留言稱 115 學年度更換（未驗證） | [S-blog-sm] |

**影響**：換課後，該課的句型重點可能也換了（未驗證）。所以 JSON 的 `textbook_refs[].edition_seen` 會記錄核對的是哪一學年的版本。例如「It isn't until…that」是在 111 版 B3 L6（My Life in Your Hands）看到的，不能直接當成 114 版 The Country of the Blind 的句型。

---

## 2. 課綱對高中文法句型的規定

- **學習內容只有一條總括條目**：「Ad-Ⅴ-1 高中階段所學的結構。」寫作、口語方面另有「B-Ⅴ-2 高中階段所學字詞及句型的生活溝通」[S-curr]。
- **只有國中有列表**：附錄六「國民中學英語文基礎文法句構參考表」列出 that 子句、wh-名詞子句、關係代名詞、so…that、not only…but also、It is + adj. + to、too…to、It takes…to、比較級、最高級、動名詞當主詞、被動句、現在完成式、使役動詞＋原形、感官動詞＋原形、used to 等 [S-curr]。JSON 的 `junior_high_base: true` 就是依這張表標的。
- **教材編寫原則**（實施要點「文法句構」）[S-curr]：
  - 「應以基本常用者為主…避免冷僻、抽象文法知識的灌輸」。
  - 「許多複雜概念的文法或句構，應該小量、多層、分次地漸進介紹…切勿第一次出現，便在教材或教學中窮盡所有相關的文法、句構，大量補充」。
  - 較複雜或較不常用的句型「學生僅需理解即可…可視為『認識結構』」；較常用的重要句型「學生則需熟習…可視為『應用結構』」。
- **片語的教學原則**：「成語及片語…可視為一個廣義的字詞…切勿將其拆解成個別的單字」[S-curr]。所以 JSON 的 `phrases` 是整條片語搭配一個中文意思，不拆開解釋。

---

## 3. 各出版社各冊文法句型對照表

### 3.1 龍騰版逐課句型

「句型重點」一欄依學校課程計畫原文整理，引號內是原文寫法。附中欄是師大附中 111-1 進度表補充的第二句型或轉承詞。

#### B1（高一上；113–114 學年度版）[S-cogsh-114-1-g10]

| 課 | 課名 | 句型重點 | 主題／議題（計畫原文） |
|---|---|---|---|
| L1 | Firsts in Life | S + V + that + S + V…；感官類連綴動詞 | 人生課題與自我探索；第一次經驗的短文寫作 |
| L2 | Goodbye, John | It is + adj. (+ for sb.) + to VR…；觀察現在完成式於篇章 | 科技資訊與媒體素養（手機成癮）；書信體短文 |
| L3 | Do Animals Sleep like You and Me? | S + V + wh- (+ S) + V…；觀察被動式於篇章 | 生物新知；cause and effect 寫作 |
| R1 | When Shocked in Rome | （未列） | ─ |
| L4 | Sniffing Out More Than Just Bones | 形容詞子句限定與非限定用法 | 人類與動物（嗅聞犬）；說明文 |
| L5 | The Life of a Plastic Bag | 使役動詞；because 與 because of | 海洋資源與永續；童話／寓言摘要 |
| L6 | Built for Freedom: The Statue of Liberty | 強調句型；so/such…that… | 多元文化與國際理解；空間記敘文 |
| R2 | Having Fun with Change | （未列） | ─ |
| L7 | From Trash to Triumph | S + have + O + p.p.…；間接問句的簡化 | 生命教育／社會關懷；Story Mountain 記敘 |
| L8 | Convenience Stores: Where Our Wallets Are Always Open | 比較級「愈……愈……」；so that 表示因果關係 | 商業與經濟（行銷策略）；活動規劃短文 |
| L9 | Fighting for or against Graffiti | S + V…, V-ing/p.p.…；S + V…, while/whereas S + V… | 藝術涵養與美感；OREO 意見寫作 |
| R3 | An Island's Beauty, an Islander's Duty | （未列） | ─ |

R 課課名來自部落格 [S-blog-lt]。

#### B2（高一下）：只取得課名

L1 The Heart of a Champion／L2 My Mouth's in Airplane Mode!／L3 The Birthmark（舊版 Mammon and the Archer）／R1 How Do You Take Your Tea, High or Low?／L4 Malala: Stronger Than Violence／L5 Walt Disney's Inspirational Message: Dare to Dream／L6 No Wonder He's Special／R2 Note How to Really Learn／L7 TED Talks: Spreading Ideas for a Better World／L8 Ban-Doh: The Most Authentic Taiwanese Eating Experience／L9 The Story behind Eponyms／R3 Living above the Earth—and Beyond [S-csghs-110-2-g10][S-hsnu-114-2-g10][S-blog-lt]。

附中 114-2 進度表記載的主題：L1 運動員面對困難的堅毅、L2 環境對飲食的影響（學習因果關係）、L3 改編自 Hawthorne 的 The Birthmark、L4 馬拉拉爭取受教權、L5 迪士尼創業、L6 改編自小說 Wonder 的校園霸凌、L7 TED Talks、L8 辦桌文化、L9 Eponyms [S-hsnu-114-2-g10]。**逐課句型未取得（未驗證）。**

#### B3（高二上；111 學年度版）[S-csghs-111-1-g11]＋附中 [S-hsnu-111-1-g11]

| 課 | 課名 | 句型重點（中山） | 附中補充 | 主題 |
|---|---|---|---|---|
| L1 | The Day I Broke the Rules | S + find/consider/feel/think… + it + adj./N + to VR；表達信念與想法 | It seems/appears that… | 社會關懷、兩難抉擇 |
| L2 | The Marshmallow Challenge | have/has + been + p.p.；代名詞 that/those 代替前述字詞 | not…until… | 批判思考 |
| L3 | Prometheus: The Champion of Humankind | Adj…, S + V…；By the time… 表事件先後 | not only…but also… | 希臘神話 |
| R1 | 3-D Printing | 從前後文判斷代名詞指涉 | Pronoun: They | 科技新知 |
| L4 | Day of the Dead | S + be + thought/said/believed + to VR/have + p.p. | would rather…than…；轉承詞 Instead | 生命教育、節慶 |
| L5 | Kyoto: The Heart of Japan | be seen/heard + V-ing/to VR；雙重否定 | no/not/never…without + V-ing/N | 異國文化 |
| L6 | My Life in Your Hands（114 版換為 The Country of the Blind） | It isn't/wasn't until… + that + S + V… | either…or… / neither…nor… | 手足之情 |
| R2 | The Mystery of the Disappearing Bees | 辨識因果關係的字詞 | ─ | 生態 |
| L7 | Bodies Speak Louder Than Words | …N(,) prep. + which/whom + S + V…；can't help but + VR／can't help + V-ing | the belief/news/fact…that + S + V；In Contrast | 身體語言 |
| L8 | Elephant Abuse | N, all/most/some/… of which/whom (+ S) + V…；It is high time… | What's More / Worse Still | 環境倫理 |
| L9 | Mazu Mania | Never/Seldom/Hardly/Rarely/Barely + be/aux. + S…；「It is no + V-ing」（原文） | It is no exaggeration to say that… / It is not too much to say that… | 宗教文化 |
| R3 | Fast Fashion, but at What Cost? | ─ | ─ | 永續發展 |

#### B4（高二下；111 學年度版）[S-csghs-111-2-g11]

| 課 | 課名 | 句型重點 | 主題／寫作任務 |
|---|---|---|---|
| L1 | The Lady or the Tiger?（114-2 換為 The Bet） | S + suggest/order/recommend/insist/advise/demand that + S (+ should) + VR；(As) + adj./adv. + as… | 經典短篇、人性；撰寫故事結局 |
| L2 | Boat Schools | If + S + V-ed/were…, S + would/could/might + VR；it 作虛主詞與虛受詞 | 弱勢關懷與教育；描述一項發明 |
| L3 | Progress and Preservation | It is necessary/essential/important/crucial/vital/critical/urgent that S (+ should) + VR；間接問句 | 文化資產保存 |
| R1 | Grasse | 口說：介紹一個地點 | 文化與商業 |
| L4 | Living under Nature's Wing | S + seem/appear + to VR/have + p.p.；with + O + OC | 達悟族飛魚季、SDGs |
| L5 | Irena Sendler | If + S + had + p.p.…, S + would/could/might + have + p.p.；分詞構句 | 普世人權；介紹歷史人物 |
| L6 | Dabbawalas | Not until… + be/aux. + S…；形容詞子句 | 商業管理；流程寫作 |
| R2 | Watch Out! Danger Ahead on the Information Superhighway | 口說：網路隱私 | 資訊安全 |
| L7 | Iceland's Road to Gender Equality | If it were not for/If it had not been for/But for/Without + N…, S…；關係副詞 | 性別平等；公開信 |
| L8 | Too Much of a Good Thing—Overtourism in Barcelona | Only…be/aux. + S…；倍數比較 | 過度觀光、SDGs；抱怨信 |
| L9 | To Kill a Mockingbird | S + must/may/might/could + VR/have + p.p.；分詞片語描述人事物 | 小說、歧視；小說摘要 |
| R3 | Marathons | 口說：介紹競速比賽 | 運動 |

#### B5（高三上；112 學年度版，114-1 計畫內容相同）[S-csghs-112-1-g12][S-csghs-114-1-g12]

| 課 | 課名 | 句型／篇章重點 | 主題／寫作任務 |
|---|---|---|---|
| L1 | Life Lessons in Rudyard Kipling's "If—"（部落格稱 115 起換為 The Road Not Taken，未驗證） | Whoever/Whatever/Whichever (+ S) + V…；指涉字與取代 | 詩、生涯規劃；說明文 |
| L2 | Battling Fake News | S + V + lest + S (+ should) + VR；for fear that + S + would/should/might + VR；同義重述、反義 | 媒體識讀；問題解決文 |
| L3 | Formosa: One Name, Two Stories | S + V + half/twice/three times… + the N of…；上下位、整體局部、比較對比轉承詞 | 文化異同；比較對比文 |
| L4 | Lab-Grown Meat | 複合形容詞；語意場與轉承詞 | 科技倫理、氣候；歸納說明文 |
| L5 | Venice: A Sinking City | as if + S + were/V-ed/had + p.p.；因果轉承詞；時態使用 | 氣候變遷；描述事件 |
| L6 | I Have a Dream | Were + S…, S + would…；Had + S + p.p.…, S + would have p.p.；平行結構與省略 | 人權；資訊分析歸納 |

### 3.2 三民（甲版，車畇庭主編）：只取得課名 [S-blog-sm]

| 冊 | Units（Review 課略） |
|---|---|
| B1 | The First Day of School Around the World／A Lesson in Forgiveness／Making Society Work／A Colorful Life／Go to Bed!／The Real 'Price' of Plastic／A Little Science Works a Lot of Magic／Customs and Superstitions Everywhere?／The World's Love Affair with Chocolate／A 'Hero' Called Frankenstein |
| B2 | Animal Imagery in Different Languages／Reading Can Be a Daring Act／One Box, Many Solutions／Let's Dig In!／Gaming for Good?／Mother's Hands／Celebrating Science That Is Anything But Useful／The Hidden Costs of Our Clothing／Why Do We Lie?／The Men Behind Sherlock Holmes |
| B3 | Wrestling with Cultural Differences／Social Media: Finding a Balance／Dying to Be Attractive／A Quest for Taiwan's Freedom／The Stolen Generations: An Australian Tragedy／They're Back!／Gynaikratia: The Day Women 'Rule'／Choose Love - Shop for Refugees／Celebrations That Come at a Price／A Human War for a Dispute Among Gods |
| B4 | A Love Coach's Game Plan／The Truth About Fake News／The Woman That Never Dies／The Journey Ahead／A Future Without Forests／Would It Be Right to Let Our Loved Ones Go?／Living Together for the Greater Good／To Bribe or Not to Bribe, That Is the Question／Slash Careers: The Future of Work／Anne Frank's Diary |
| B5 | Harvesting Power from Rotten Tomatoes／Be Afraid, Be Very Afraid／I Have a Dream／Why Can't I say 'No!'?／English for All: A Truly Global Language／The Road Not Taken |

### 3.3 三民（乙版，劉宇挺主編）：只取得課名 [S-blog-sm][S-junyi-sm-b1][S-cogsh-114-1-g11]

| 冊 | Units（Review 課略） |
|---|---|
| B1 | Are You Ready for the Climb?／I See You, Taiwan／Where Do Our Digital Footprints Lead?／From Our Family to Yours: "Eid Mubarak!"／Diversity Matters in Medical Science／Reaching for Space／Sunlight in Our Wallets／Brew a Better Life for Coffee Farmers／I Owe You a Big Apology |
| B2 | Reviving the Dream in Dust／Listen Before Talking Your Way Through Conflict／Beyond the Graves: Two Unexpected Cemeteries／Stand Tall and Grow Strong with Resilience／Truth Be Told／Decisions Are Never Black-and-White／The Career Path to Becoming a 'Speech Doctor'／Freeing Morocco's Tree-Climbing Goats／The Sky's the Limit for Vertical Farming |
| B3 | City Planning: Building a Better Future／Embracing the Power of AI／Standing Up for What Is Right／A Journey of Redemption／Closing the STEM Gap／The True Face of a Favela: My Time in Rocinha／History Repeats: Lessons from Pandemics／Sore No More／Calligraphy in Motion |
| B4 | Crafting Taiwan's Future: A Journey Through Changing Industries／Human Stories at the Human Library／From Judgment to Reflection／Step into the Virtual Wonderland／The Forgotten Fear: Oppenheimer and Nuclear War／Seeing Isn't Always Believing／For a World Where Nature Stands Tall／Woof! Meow! The Work of an Animal Communicator／'Oh! Susanna': A Song with Regrettable Echoes |
| B5 | Beyond the Music: Concerts as Economic Engines／The Bubble Tea Buzz／The Destiny of Apollo and Daphne／Understanding Social Cues／Final Farewell Messages／Hooked on the Fishing Life |

金甌女中 114-1 普二計畫的教學目標，只列學習內容代碼（例如 Ad-V-1、C-V-4「國際議題（如全球暖化、人工智慧、氣候變遷等）」），沒有逐課句型 [S-cogsh-114-1-g11]。

### 3.4 翰林：未取得

國教院清冊只能證明翰林第一～五冊目前仍是審定本 [S-naer-list]。本次沒找到可公開引用的課次目錄或句型表（未驗證）。花蓮女中 111-1 第一次定期考範圍表的高三英語文欄寫「翰林英文第五冊第一課與第二課」，可見仍有學校採用翰林版，但沒有課名（網址見 §8.2）。

### 3.5 龍騰句型的冊次分布

依 §3.1 的龍騰資料整理（B2 未知）：

| 句型家族 | B1 | B3 | B4 | B5 | 備註 |
|---|---|---|---|---|---|
| 名詞子句、間接問句 | L1、L3、L7（簡化） | L7（同位語） | L3（複習） | L1（whoever） | 國中已學 that／wh- 子句 |
| 形容詞子句 | L4（限定、非限定） | L7（介系詞＋關代）、L8（數量詞 of which） | L6、L7（關係副詞） | ─ | 螺旋式重複 |
| 虛主詞、虛受詞 it | L2 | L1（find it…to） | L2 | ─ | |
| 被動 | L3（觀察） | L2（完成式被動）、L4（be said to）、L5（be seen V-ing） | ─ | ─ | |
| 比較 | L8（the + 比較級） | ─ | L8（倍數） | L3（倍數 the N of） | |
| 分詞 | L9（分詞構句） | L3（形容詞片語置首） | L4（with + O + OC）、L5（分詞構句）、L9（分詞片語） | L4（複合形容詞） | |
| 連接詞 | L5（because/because of）、L6（so/such…that）、L8（so that）、L9（while/whereas） | L3（not only…but also）、L6（either/neither） | ─ | L2（lest/for fear that） | |
| 強調 | L6（強調句型） | L6（It is not until…that）、L9（It is no exaggeration…） | ─ | ─ | |
| 倒裝 | ─ | L9（否定副詞） | L6（Not until）、L8（Only） | L6（省略 if 倒裝） | 高二起才出現 |
| 假設 | ─ | L8（It is high time） | L1（意志動詞 should）、L2（現在）、L3（It is essential that）、L5（過去）、L7（But for） | L5（as if）、L6（省略 if） | 集中在 B4 |
| 助動詞 | ─ | ─ | L4（seem to have p.p.）、L9（must have p.p.） | ─ | |
| 篇章／轉承 | ─ | R1 指涉、R2 因果、附中列 instead／in contrast／what's more | L4 話語標記（discourse markers）[S-csghs-111-2-g11] | L1–L6 指涉、同義、轉承詞、平行與省略 | B5 明顯轉向篇章 |

**觀察**〔析〕：
- 高一著重把國中句型延伸到篇章中使用。
- 高二是「特殊句型」最密集的一年，包括倒裝、假設、分裂句和各種關係子句變化。
- 高三上轉向篇章結構與轉承詞，這和學測選擇題的篇章結構、文意選填題型方向一致 [S-ceec-ep351]。

---

## 4. 各冊主題類型與對作文、閱讀選材的啟示

龍騰的主題與議題，依學校計畫原文整理（§3.1）。三民兩版只有課名，以下分類**依課名推測，未讀課文**。

| 主題類型 | 龍騰 | 三民甲版（依課名推測） | 三民乙版（依課名推測） |
|---|---|---|---|
| 個人成長、品德、人際 | B1 L1 Firsts in Life；B2 L1 運動員堅毅；B3 L1 兩難抉擇 | A Lesson in Forgiveness；Why Do We Lie?；Why Can't I say 'No!'? | I Owe You a Big Apology；Stand Tall… with Resilience；Decisions Are Never Black-and-White；Understanding Social Cues |
| 環境、永續、SDGs | B1 L5 塑膠袋；B3 R2 蜜蜂、R3 快時尚；B3 L8 大象觀光；B4 L4 飛魚季（SDGs）、L8 過度觀光（SDGs）；B5 L4 人造肉、L5 威尼斯 | The Real 'Price' of Plastic；The Hidden Costs of Our Clothing；A Future Without Forests；Harvesting Power from Rotten Tomatoes | Brew a Better Life for Coffee Farmers；Sunlight in Our Wallets；Vertical Farming；For a World Where Nature Stands Tall |
| 科技、媒體識讀 | B1 L2 手機成癮；B2 L7 TED；B3 R1 3D 列印；B4 R2 個資；B5 L2 假新聞 | Gaming for Good?；Social Media: Finding a Balance；The Truth About Fake News | Digital Footprints；Embracing the Power of AI；Step into the Virtual Wonderland；Seeing Isn't Always Believing |
| 人權、性別、社會正義 | B2 L4 Malala；B4 L5 Irena Sendler、L7 冰島性別平等、L9 To Kill a Mockingbird；B5 L6 I Have a Dream | The Stolen Generations；Gynaikratia；Choose Love - Shop for Refugees；I Have a Dream；Anne Frank's Diary | Standing Up for What Is Right；Closing the STEM Gap；Diversity Matters in Medical Science |
| 文化、節慶、旅遊 | B1 L6 自由女神；B2 L8 辦桌；B3 L4 亡靈節、L5 京都、L9 媽祖遶境；B4 L3 文化資產、R1 格拉斯 | The First Day of School Around the World；Customs and Superstitions；Celebrations That Come at a Price；Wrestling with Cultural Differences | Eid Mubarak!；Two Unexpected Cemeteries；Calligraphy in Motion；The Bubble Tea Buzz |
| 台灣在地 | B2 L8 辦桌；B3 L9 媽祖；B4 L4 達悟族；B5 L3 兩個福爾摩沙 | A Quest for Taiwan's Freedom | I See You, Taiwan；Crafting Taiwan's Future；The Bubble Tea Buzz |
| 文學經典（神話、小說、詩） | B2 L3 The Birthmark；B3 L3 Prometheus、L6 名畫故事／The Country of the Blind；B4 L1 The Lady or the Tiger?／The Bet、L9 To Kill a Mockingbird；B5 L1 If—／The Road Not Taken | A 'Hero' Called Frankenstein；The Men Behind Sherlock Holmes；A Human War for a Dispute Among Gods；The Woman That Never Dies；The Road Not Taken | The Destiny of Apollo and Daphne；Final Farewell Messages |
| 科學、健康、動物 | B1 L3 動物睡眠、L4 嗅聞犬；B3 L7 身體語言 | Go to Bed!；A Little Science Works a Lot of Magic；Celebrating Science…；Dying to Be Attractive | Reaching for Space；Sore No More；History Repeats: Lessons from Pandemics；Animal Communicator |
| 商業、職涯、經濟 | B1 L8 便利商店；B4 L6 Dabbawalas | Slash Careers: The Future of Work；To Bribe or Not to Bribe | Speech Doctor；Concerts as Economic Engines；Hooked on the Fishing Life |

**啟示**〔析〕：

1. **閱讀選材（SDGs 主題）和課本高度重疊。** 三套課本都大量選用環境、人權、科技倫理的文章。App 依 SDGs 改寫閱讀文章時，可以優先選課本「沒有寫過的角度」，避免和課文雷同。課綱學習內容也列了「C-Ⅴ-4 國際議題（如全球暖化、人工智慧、氣候變遷等）」[S-curr]。
2. **作文體裁對應課本的寫作任務。** 龍騰各課的寫作任務涵蓋書信（B1 L2、B4 L7 公開信、L8 抱怨信）、記敘（B1 L7 Story Mountain）、說明文（B1 L4、B5 L1）、意見文（B1 L9 OREO）、比較對比（B5 L3）、問題解決（B5 L2）。這些和學測作文的信函、看圖、主題寫作題型一致 [S-ceec-115-spec]。範文生成時可以標示「這篇用的是哪一課的寫作框架」。
3. **台灣在地與節慶題材**（辦桌、媽祖、達悟族、珍奶）適合用在中譯英命題。學測中譯英多是台灣生活情境，例如玉山、高鐵、夜市、選舉廟宇、颱風（見 §5 題幹）。
4. **文學經典題材**（神話、短篇小說、詩）沒有出現在 93–115 學測中譯英的題幹中（§5.2）。App 可以把這類題材放在閱讀模組，不必用於翻譯命題。

---

## 5. 學測中譯英最常用到的句型

### 5.1 大考中心的官方說法

| 文件 | 內容 | 來源 |
|---|---|---|
| 115 學年度起適用考試說明 | 中譯英「評量考生是否具備英文句子書寫能力，內容以高中階段所學之基本句型（例如：單句、合句、複句）及字彙為主」 | [S-ceec-115-spec] |
| 107 學年度起適用學測考試說明（舊制） | 「內容以結構較為簡單之句型（如單句、合句、複句）為主」 | [leg-gsat-107] |
| 107 學年度起適用指考考試說明（舊制） | 「內容以結構較為複雜之句型（如合句、複句、複合句等）為主」 | [leg-ast-107] |
| 115 學測試題特色 | 「混合題組非選擇題及中譯英句子等試題設計，也多使用基礎文法句構與觀念即能作答。因此在讀寫教學上，教師可以考慮捨棄課本或教材中過難及罕見的文法句型」；「使用句構也屬高中常見，並無過於複雜及罕見的句型應用」 | [S-ceec-ep351] |
| 106–108、110 學測閱卷說明 | 反覆出現「所測驗之句型亦為高中生熟悉的範圍」 | 見 §9 表 gsat106–gsat110 評分文件 |
| 112–115 學測評分原則 | 「所評量的字詞大致都以詞彙表一至四級詞彙為主」 | 見 §9 表 gsat112–gsat115 評分文件 |

### 5.2 93–115 學年度學測中譯英逐題句構（46 句）

說明：
- 題幹取自大考中心各年題本（§9）。學測 86–92 年的非選擇題只有作文；84、85 年是 5 句一組的翻譯，格式不同，不列入統計。
- 「依據」欄：官＝大考中心考試說明、評分原則或閱卷說明明示；參＝大考中心參考答案使用；析＝本文分析的自然譯法（非官方）。
- 一句可以有多個句構，「可選」表示參考答案或常見正確譯法之一，但不是唯一寫法。
- 105、108 學測的句型說明見 111 學年度起適用考試說明的試題舉例 [S-ceec-111-spec]；109、111 學測見 115 學年度起適用考試說明 [S-ceec-115-spec]；110 試辦考試見 [S-ceec-110-trial]；其餘年度見 §9 各年評分文件。

| 年度-題 | 中文題幹 | 主要句構（依據） | 備註 |
|---|---|---|---|
| 93-1 | 雖然Lily生來又瞎又聾，但她從來不氣餒。 | 副詞子句（析） | although 不與 but 並用；be born + adj. |
| 93-2 | 她的故事證明了，我們只要努力必能成功。 | 名詞子句（析）；副詞子句（析） | prove that…；as long as… |
| 94-1 | 人類對外太空所知非常有限，但長久以來我們對它卻很感興趣。 | 現在完成式（析） | know little about…, but … have long been interested in… |
| 94-2 | 太空科技的快速發展，使我們得以探索它的奧秘。 | 動詞＋受詞＋to V／補語（析） | The rapid development of … enables us to … |
| 95-1 | 一般人都知道閱讀對孩子有益。 | 名詞子句（析）；動名詞／不定詞片語當主詞（析） | 評分說明列 good for、beneficial to |
| 95-2 | 老師應該多鼓勵學生到圖書館借書。 | 動詞＋受詞＋to V／補語（析） | encourage sb to V |
| 96-1 | 如果我們只為自己而活，就不會真正地感到快樂。 | 副詞子句（析） | if 條件子句（直說法） |
| 96-2 | 當我們開始為他人著想，快樂之門自然會開啟。 | 副詞子句（析） | when 時間子句 |
| 97-1 | 聽音樂是一個你可以終生享受的嗜好。 | 動名詞／不定詞片語當主詞（官）；關係子句（參） | 評分說明：以動名詞（Ving）為主詞的句子 |
| 97-2 | 但能彈奏樂器可以為你帶來更多的喜悅。 | 動名詞／不定詞片語當主詞（參）；比較級／最高級（官） | 評分說明：(much) more 等詞彙、連接詞 But/Yet/However 為首的句子 |
| 98-1 | 大部分學生不習慣自己解決問題，他們總是期待老師提供標準答案。 | 介系詞＋V-ing（參）；動詞＋受詞＋to V／補語（析） | 評分說明：以 Most students 為主詞的基本句型；參考答案含 used to |
| 98-2 | 除了用功讀書獲取知識外，學生也應該培養獨立思考的能力。 | 介系詞＋V-ing（官） | 評分說明：Besides + Ving, S + V |
| 99-1 | 在過去，腳踏車主要是作為一種交通工具。 | 被動語態（官） | 評分說明：served as / were used as、in the past |
| 99-2 | 然而，騎腳踏車現在已經成為一種熱門的休閒活動。 | 現在完成式（官）；動名詞／不定詞片語當主詞（官） | 評分說明：riding bicycles/cycling、has become |
| 100-1 | 臺灣的夜市早已被認為足以代表我們的在地文化。 | 現在完成式（官）；被動語態（官） | 評分說明：have long been regarded as |
| 100-2 | 每年它們都吸引了成千上萬來自不同國家的觀光客。 | 基本句構 S＋V＋O | 簡單現在式＋介系詞片語後位修飾；評分說明：hundreds and thousands of |
| 101-1 | 近年來，許多臺灣製作的影片已經受到國際的重視。 | 現在完成式（官）；分詞（析） | 評分說明：現在完成式 have + p.p.；films made in Taiwan |
| 101-2 | 拍攝這些電影的地點也成為熱門的觀光景點。 | 關係子句（官）；被動語態（官） | 評分說明：關係子句與被動式；shot (p.p.) |
| 102-1 | 都會地區的高房價對社會產生了嚴重的影響。 | 現在完成式（官） | 評分說明：介系詞片語、現在完成式 |
| 102-2 | 政府正推出新的政策，以滿足人們的住房需求。 | 現在進行式（官）；不定詞表目的（析） | 評分說明：現在進行式 is + Ving |
| 103-1 | 有些年輕人辭掉都市裡的高薪工作，返回家鄉種植有機蔬菜。 | 對等並列（析）；不定詞表目的（析） | quit … and return … to grow … |
| 103-2 | 藉由決心與努力，很多人成功了，不但獲利更多，還過著更健康的生活。 | 關聯連接詞（析）；比較級／最高級（析） | not only … but also …＋比較級 |
| 104-1 | 一個成功的企業不應該把獲利當作最主要的目標。 | 比較級／最高級（析） | regard/see A as B；the most important/main goal |
| 104-2 | 它應該負起社會責任，以增進大眾的福祉。 | 不定詞表目的（析） | take social responsibility to … |
| 105-1 | 相較於他們父母的世代，現今年輕人享受較多的自由和繁榮。 | 分詞（參）；比較級／最高級（參） | 參考答案：Compared to/with …, … enjoy more freedom |
| 105-2 | 但是在這個快速改變的世界中，他們必須學習如何有效地因應新的挑戰。 | 基本句構 S＋V＋O | 參考答案：fast-changing（複合形容詞）、learn (how) to |
| 106-1 | 玉山(Jade Mountain)在冬天常常覆蓋著厚厚的積雪，使整個山頂閃耀如玉。 | 被動語態（官）；分詞（析）；動詞＋受詞＋to V／補語（析） | 閱卷說明：不少考生「覆蓋著」未用被動語態；…, making the peak shine like jade |
| 106-2 | 征服玉山一直是國內外登山者最困難的挑戰之一。 | 動名詞／不定詞片語當主詞（析）；現在完成式（析）；比較級／最高級（析） | Conquering … has always been one of the most difficult … |
| 107-1 | 近年來，有越來越多超級颱風，通常造成嚴重災害。 | 現在完成式（析）；比較級／最高級（析）；關係子句（析，可選）；分詞（析，可選） | there have been more and more …, which often cause / often causing … |
| 107-2 | 颱風來襲時，我們應準備足夠的食物，並待在室內，若有必要，應迅速移動至安全的地方。 | 副詞子句（析）；對等並列（析） | When …, we should V1, V2, and (if necessary) V3 |
| 108-1 | 自2007年營運以來，高鐵（the High Speed Rail）已成為臺灣最便利、最快速的交通工具之一。 | 現在完成式（官）；比較級／最高級（析） | 考試說明：現在完成式 have + p.p. |
| 108-2 | 對於強調職場效率的人而言，高鐵當然是商務旅行的首選。 | 關係子句（官） | 考試說明：關係代名詞 who 子句 |
| 109-1 | 我們有時會違背自己的意願去做某些事情，就只為了要取悅朋友。 | 不定詞表目的（參） | 參考答案：… against our will only/just/simply to please our friends |
| 109-2 | 其實，在面對同儕壓力的時候，我們應該學習堅持自己的原則。 | 分詞（參） | 參考答案：when faced with / when facing / in face of peer pressure |
| 110-1 | 根據新聞報導，每年全球有超過百萬人在道路事故中喪失性命。 | 基本句構 S＋V＋O | According to …；more than a million；lose their lives |
| 110-2 | 因此，交通法規必須嚴格執行，以確保所有用路人的安全。 | 被動語態（析）；不定詞表目的（析） | must be enforced strictly to ensure … |
| 111-1 | 飼養寵物並非一項短暫的人生體驗，而是一個對動物的終生承諾。 | 動名詞／不定詞片語當主詞（官）；關聯連接詞（官） | 考試說明：動名詞片語作主詞、not…but… |
| 111-2 | 在享受寵物所帶來的歡樂時，我們不該忽略要善盡照顧他們的責任。 | 副詞子句（官）；分詞（官）；關係子句（參，可選）；介系詞＋V-ing（參） | 考試說明：時間副詞子句、should；評分原則：while enjoying / when we enjoy |
| 112-1 | 歷史一再證明，戰爭會造成極為可怕的災難。 | 名詞子句（參）；現在完成式（參，可選） | 參考答案：History proves/has proven time and again that … |
| 112-2 | 避免衝突、確保世界和平應該是所有人類追求的目標。 | 動名詞／不定詞片語當主詞（參）；分詞（參）；對等並列（參） | 參考答案：To avoid … and ensure … should be the goal pursued by … |
| 113-1 | 每逢選舉季節，總會看到政治人物造訪各地著名廟宇。 | 被動語態（參） | 參考答案：politicians can be seen making visits to … |
| 113-2 | 除了祈求好的選舉結果，他們也希望展現對在地文化與習俗的尊重。 | 介系詞＋V-ing（官） | 評分原則：besides/aside from/apart from/in addition to |
| 114-1 | 人類的想像和創意是科技進步最大的驅動力。 | 比較級／最高級（官） | 評分原則：第一句要使用比較級（參考答案為 the biggest/strongest） |
| 114-2 | 過去在科幻電影中出現的神奇物件，現在正逐一成真。 | 關係子句（官）；現在進行式（官） | 評分原則：關係子句、過去式、現在進行式 |
| 115-1 | 現在越來越多高中英文老師已經增加在課堂上使用英文的百分比。 | 現在完成式（官）；比較級／最高級（參） | 評分原則：第一句要使用現在完成式 |
| 115-2 | 他們將學生依英語能力分成不同組別，進行多樣的聽、說活動。 | 分詞（官，可選） | 評分原則：基本句構（S＋V），後半句可用分詞構句 |

### 5.3 統計：哪些句型最常被用到

| 句構家族 | 出現句數（含可選寫法） | 其中必要／首選寫法 | 其中有大考中心文件或參考答案佐證 | 題號（* 為可選寫法） |
|---|---|---|---|---|
| 現在完成式（含完成被動） | 10 | 9 | 7 | 94-1, 99-2, 100-1, 101-1, 102-1, 106-2, 107-1, 108-1, 112-1*, 115-1 |
| 比較級／最高級（含 more and more、one of the + 最高級） | 9 | 9 | 4 | 97-2, 103-2, 104-1, 105-1, 106-2, 107-1, 108-1, 114-1, 115-1 |
| 分詞（分詞構句、分詞片語修飾、連接詞＋分詞） | 8 | 6 | 5 | 101-1, 105-1, 106-1, 107-1*, 109-2, 111-2, 112-2, 115-2* |
| 動名詞／不定詞片語當主詞 | 7 | 7 | 5 | 95-1, 97-1, 97-2, 99-2, 106-2, 111-1, 112-2 |
| 副詞子句（時間／條件／讓步） | 6 | 6 | 1 | 93-1, 93-2, 96-1, 96-2, 107-2, 111-2 |
| 關係子句（含關係副詞、省略關代） | 6 | 4 | 5 | 97-1, 101-2, 107-1*, 108-2, 111-2*, 114-2 |
| 被動語態 | 6 | 6 | 5 | 99-1, 100-1, 101-2, 106-1, 110-2, 113-1 |
| 不定詞表目的 | 5 | 5 | 1 | 102-2, 103-1, 104-2, 109-1, 110-2 |
| 動詞＋受詞＋to V／補語（enable、encourage、expect、make） | 4 | 4 | 0 | 94-2, 95-2, 98-1, 106-1 |
| 介系詞＋V-ing（besides、be used to、responsibility of） | 4 | 4 | 4 | 98-1, 98-2, 111-2, 113-2 |
| 名詞子句（that／wh-） | 3 | 3 | 1 | 93-2, 95-1, 112-1 |
| 對等並列（並列動詞、平行結構） | 3 | 3 | 1 | 103-1, 107-2, 112-2 |
| 現在進行式 | 2 | 2 | 2 | 102-2, 114-2 |
| 關聯連接詞（not only…but also、not…but） | 2 | 2 | 1 | 103-2, 111-1 |

無特定句構家族的句子： 100-2、105-2、110-1（以基本句構 S＋V＋O 搭配片語即可，例如 105-2 的 learn (how) to、fast-changing）

**解讀**〔析〕：

1. **前八名都是國中到高一的基礎句型。**
   - 現在完成式、被動語態、動名詞主詞、比較級、不定詞，都列在課綱附錄六的國中基礎文法表 [S-curr]。
   - 分詞構句與分詞片語是龍騰 B1 L9、B4 L5、B4 L9 的重點。
   - 關係子句是 B1 L4 與 B4 L6、L7 的重點。
2. **課本的高階句型完全沒有成為必要寫法。** 倒裝（Not until／Only／Never…）、假設語氣（If…had p.p.／But for／It is high time）、It is…that 強調句、No sooner…than、lest，在 46 句中都不是必要寫法。這和 115 試題特色「捨棄過難及罕見的文法句型」的建議一致 [S-ceec-ep351]。
3. **有一個課本句型直接成為參考答案。** 113 學測第 1 題的參考答案用了「can be seen making visits to」〔參〕，這正是龍騰 B3 L5「be seen/heard + V-ing」〔S-csghs-111-1-g11〕的句型。
4. **時態判斷是主要失分點。** 115 評分原則明示第一句要用現在完成式〔官〕。媒體報導閱卷結果時也說「第一題需使用現在完成式描述現況，卻有考生未能正確掌握時態」，並舉出拼字錯誤（devide、sinior）與用字錯誤（hear／listen、talk／speak）[S-news-1111-115]。這篇報導是二手資料，引述的閱卷說法未逐字對照官方文件。
5. **中文的「觸發詞」很固定**，App 可以據此自動判斷句型〔析〕：
   - 「已經、近年來、自…以來、一直」→ 現在完成式
   - 「被認為、覆蓋著、必須（被）執行、總會看到」→ 被動
   - 「……的＋名詞」→ 關係子句或分詞片語
   - 「以…、為了…、就只為了…」→ 不定詞表目的
   - 「除了…」→ besides／in addition to + V-ing
   - 「並非…而是…」→ not…but…
   - 「越來越多」→ more and more
   - 「相較於…」→ compared with

### 5.4 舊制指考中譯英（93–110 學年度，含 109 補考）

指考的定位是「結構較為複雜」[leg-ast-107]。實際題目比學測多了下列句構〔析〕：
- 非限定關係子句：106-1、107-1
- 句尾分詞構句表結果：105-2（例：…, causing deaths far beyond what we can imagine）、107-2
- 讓步：95-2 Despite／Although、110-2 No matter what／Whatever
- whether 名詞子句：110-1
- once 子句：105-1
- 關係子句內含插入句：101-1（例：Some packaged foods that we think are safe…）
- take…for granted 加 not…any more：97-2，評分說明列 experts、warn、take for granted、not any more，並提到「含有名詞子句」〔官〕（§9 表 ast97 評分文件）

即使是指考，93–110 的 38 句（含 109 補考 2 句）同樣**沒有一句必須用倒裝或假設語氣**〔析〕。完整題幹見各年題本（§9）。

### 5.5 校訂選修課的「翻譯句型」清單（旁證）

金甌女中 114-1 校訂選修「中英翻譯練習」的單元順序 [S-cogsh-114-1-trans]，可以看出高中翻譯課實際操練哪些句型：
- 基本句型與時態：不及物、及物、授與動詞，使役與感官動詞，leave／find／keep，祈使句，被動語態
- 特殊句型：感嘆句、強調句
- 假設：與現在、過去事實相反的假設，Wish，It is time that…，as if
- 連接與比較：not only…but also、so…that、such…that、To one's 情緒名詞、find it Adj/N to V、either…or、neither…nor、as…as、倍數、too…to
- 其他：should have p.p.、雙重否定、the fact that、比較級、最高級、have trouble + V-ing、have no choice but to VR、would rather、名詞子句

同校的「英文文法與句型」選修依序教基本句型、時態、被動、助動詞、主詞動詞一致、假設語氣、名詞子句 [S-cogsh-114-1-grammar]。

這些單元已寫進 JSON 的 `school_course_refs`。可以看出學校翻譯課仍會教假設語氣和強調句，但從 §5.3 的統計來看，學測實際上很少用到這些句型。

---

## 6. 對 App 的設計建議

### 6.1 中譯英命題的三種難度〔析〕

| 難度 | 句型取用原則 | JSON 篩選方式 |
|---|---|---|
| 穩定基礎 | 只用 §5.3 前八名句型，一句一個核心句構，詞彙限一～四級 | `typical_use ∈ {translation, all}` 且 `level == "國中基礎"` 或 `textbook_first_stage == "高一上"` |
| 進階練習 | 一句兩個句構（例如現在完成式＋關係子句、分詞構句＋比較級），加入高一、高二課本的 translation 類句型 | `typical_use == "translation"`，或有 `exam_translation_refs` 且 `basis ∈ {ceec, ref_answer}` |
| 超越頂標 | 仿指考「結構較為複雜」：非限定關係子句、句尾分詞表結果、no matter + wh-、what 子句。倒裝與假設只放在「加分寫法」提示，不設為唯一正解 | 上述再加上 `exam_translation_refs` 有 `ast-` 開頭的句型 |

每題的批改要提供多種可接受寫法，因為大考中心參考答案會用大括號並列多種寫法，例如 109-2 接受 when faced with、when facing、in face of 三種〔參〕。不能只認一種句型。

### 6.2 作文範文的句型與轉承詞配比〔析〕

- 轉承詞依 JSON `connectives[].function` 分組。建議 120–180 字的兩段式範文至少包含：一個列舉或時間順序詞（first of all／to begin with）、一個因果詞（as a result／therefore）、一個轉折或讓步詞（however／although）、一個舉例詞（for example），結尾用一個結論詞（all in all／in short）。正式度以 `register` 為「中性」或「正式」為主。
- 每篇範文加入一到兩個 `composition` 類句型，作為「亮點句」。例如 Not until…、It is no exaggeration to say that…、Had I known…，要搭配個人經驗的細節，避免硬套。
- 依課綱實施要點，片語要整條使用，不拆字解釋 [S-curr]。範文的片語註解直接引用 `phrases[].meaning_zh`。
- 常見錯誤提示可以直接用 JSON `notes` 的內容，例如 although 與 but 不並用、however 不能連接兩個子句、such as 後不接子句、數字＋名詞複合形容詞用單數。

### 6.3 JSON 欄位使用說明

| 欄位 | 說明 |
|---|---|
| `patterns[].textbook_refs` | 只列在學校公開計畫核對過的龍騰課次，並附 `edition_seen` 與 `source`。空陣列只代表「本次取得的資料未見」，不代表課本沒教 |
| `patterns[].exam_translation_refs` | 題號格式 `gsat-年-題`、`ast-年-題`、`ast-109m-題`（補考）、`gsat-110t-題`（110 試辦）、`ref115-題`（115 參考試卷）；`basis` 為 ceec／ref_answer／analysis |
| `patterns[].school_course_refs` | 金甌女中校訂選修單元（旁證） |
| `patterns[].junior_high_base` | 是否列於課綱附錄六 |
| `connectives[]` | `function`（遞進、轉折、讓步、原因、結果、舉例、強調、換句話說、相似、時間順序、列舉、結論、條件、目的、表達意見…）、`register`、`grammar_type`（對等連接詞、從屬連接詞、連接副詞、介系詞片語…）、`note`（常見錯誤） |
| `phrases[]` | `phrase`、`meaning_zh`、`example`、`type`；`exam_refs` 只列在大考中心題本、參考答案或評分文件中核對過，或本文標明「分析」的題目 |
| `textbooks` | 四套課本的執照號碼、龍騰逐課句型、三民課名 |
| `exam_item_docs` | 題號對應的大考中心題本與評分文件網址 |

---

## 7. 未驗證與缺口

1. 龍騰 B2 的逐課句型。
2. 龍騰 B3 L6（The Country of the Blind）與 B4 L1（The Bet）換課後的句型。
3. B5 L1 在 115 學年度是否確實換成 The Road Not Taken（目前只有部落格的說法）。
4. 三民甲版、乙版各課的文法句型（只有課名，且課名主要來自部落格）。
5. 翰林第一～五冊的課次與句型（完全未取得）。
6. §4 的三民主題分類只依課名推測，沒讀過課文。
7. 中山女高 110-1 高二計畫（S-csghs-110-1-g11）線上檔與本機檔雜湊不同，只確認文字內容一致。
8. 學測 84、85 年中譯英的參考答案未核對。86–92 年無中譯英，是依本專案已下載題本的章節標題判斷。
9. 師大附中 114-1 教科書版本明細表（確認龍騰 B1 執照 108032）的下載網址未保存。
10. 1111 人力銀行報導屬二手資料，引述的閱卷說法未逐字對照大考中心原文。

---

## 8. 來源清單

### 8.1 課綱、清冊、學校課程計畫

| 代號 | 文件 | 網址 |
|---|---|---|
| [S-curr] | 十二年國民基本教育課程綱要 國民中小學暨普通型高級中等學校 語文領域－英語文（發布版）（國家教育研究院） | <https://www.naer.edu.tw/upload/1/16/doc/812/%28%E7%99%BC%E5%B8%83%E7%89%88%29%E5%9C%8B%E6%B0%91%E4%B8%AD%E5%B0%8F%E5%AD%B8%E6%9A%A8%E6%99%AE%E9%80%9A%E5%9E%8B%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1-%E8%AA%9E%E6%96%87%E9%A0%98%E5%9F%9F-%E8%8B%B1%E8%AA%9E%E6%96%87%E8%AA%B2%E7%A8%8B%E7%B6%B1%E8%A6%81.pdf> |
| [S-naer-list] | 115學年度第1學期高級中等學校審定本教科用書清冊（首次公告 115-05-04；學校網站轉載版）（國家教育研究院教科書研究中心） | <https://www.tssh.cyc.edu.tw/df_ufiles/g/%E5%9C%8B%E5%AE%B6%E6%95%99%E8%82%B2%E7%A0%94%E7%A9%B6%E9%99%A2115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E7%AC%AC1%E5%AD%B8%E6%9C%9F%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1%E5%AF%A9%E5%AE%9A%E6%9C%AC%E6%95%99%E7%A7%91%E7%94%A8%E6%9B%B8%E6%B8%85%E5%86%8A2.pdf> |
| [S-cogsh-114-1-g10] | 金甌女中普一忠班 114 學年度第一學期英文科授課計畫（龍騰 B1，逐課句型）（臺北市私立金甌女子高級中學） | <https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/4ff431b7a0a6519d3e4dce5a6f08c8a8.pdf> |
| [S-cogsh-114-1-g11] | 金甌女中 114 學年度第一學期普二忠英文科授課計畫（三民乙版 B3 課名，無逐課句型）（臺北市私立金甌女子高級中學） | <https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/6a0b64f60f41d1a727289c8b5cf474c1.pdf> |
| [S-cogsh-114-1-grammar] | 金甌女中英二壹班 114 學年度第一學期英文文法與句型課授課計畫（校訂選修）（臺北市私立金甌女子高級中學） | <https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/d61670e918717404135d144f62056b0c.pdf> |
| [S-cogsh-114-1-trans] | 金甌女中英二壹班 114 學年度第一學期中英翻譯練習課授課計畫（校訂選修，Unit 1–48 句型）（臺北市私立金甌女子高級中學） | <https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/4422693db80a8b46b47d25aa3ad955b5.pdf> |
| [S-csghs-110-2-g10] | 中山女高 110-2 課程計畫表 高一英文（龍騰 B2 課名；檔內表頭誤植為 110-1）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/110-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87.pdf> |
| [S-csghs-110-1-g11] | 中山女高 110-1 高二英文課程計畫表（龍騰 B3 課名）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8.pdf> |
| [S-csghs-111-1-g11] | 中山女高 111-1 課程計畫表（高二英文）（龍騰 B3，逐課句型）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-111-2-g11] | 中山女高 111-2 課程計畫表（高二英文）（龍騰 B4，逐課句型）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-111-1-g12] | 中山女高 111-1 課程計畫表（高三英文）（龍騰 B5 課名）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-112-1-g10] | 中山女高 112-1 課程計畫表（高一英文）（龍騰 B1 舊版課名）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/112-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-112-1-g12] | 中山女高 112-1 課程計畫表（高三英文）（龍騰 B5，逐課句型）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/112-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-113-1-g11] | 中山女高 113-1 高二英文課程計畫（龍騰 B3 課名）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/113-1%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB.pdf> |
| [S-csghs-114-1-g10] | 中山女高 114-1 課程計畫表（高一英文）（龍騰 B1 課名與議題）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-114-1-g11] | 中山女高 114-1 課程計畫表（高二英文）（龍騰 B3 課名，含 The Country of the Blind）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%20%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-114-1-g12] | 中山女高 114-1 課程計畫（高三英文）（龍騰 B5，逐課句型）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf> |
| [S-csghs-114-2-g10] | 中山女高 114-2 課程計畫表（高一英文）（龍騰 B2 課名與議題）（臺北市立中山女子高級中學） | <https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf> |
| [S-hsnu-111-1-g11] | 師大附中 111-1 高二英文教學進度表（龍騰 B3，逐課句型與轉承詞）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW166675026148664.pdf> |
| [S-hsnu-111-1-g12] | 師大附中 111-1 高三英文教學進度表（龍騰 B5 課名）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW166676861876612.pdf> |
| [S-hsnu-112-2-g10] | 師大附中 112-2 高一英文教學進度表（龍騰 B2 課名，L3 Mammon and the Archer）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW171325541591680.pdf> |
| [S-hsnu-113-1-g10] | 師大附中 113-1 高一英文教學進度表（龍騰 B1，已為 Firsts in Life 版）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW172662320999711.pdf> |
| [S-hsnu-114-1-g10] | 師大附中 114-1 高一英文教學進度表（龍騰 B1，逐課主題）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW175876365606997.pdf> |
| [S-hsnu-114-1-g11] | 師大附中 114-1 高二英文教學進度表（龍騰 B3 課名）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW175876788297236.pdf> |
| [S-hsnu-114-2-g10] | 師大附中 114-2 高一英文(下)教學進度表（龍騰 B2，L3 The Birthmark）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW177276013176838.pdf> |
| [S-hsnu-114-2-g11] | 師大附中 114-2 高二英文教學進度表（龍騰 B4，L1 The Bet）（國立臺灣師範大學附屬高級中學） | <https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW177276080467360.pdf> |
| [S-dcsh-109-1] | 大直高中 109-1 英文科教學活動計畫書（龍騰 B1 舊版課名）（臺北市立大直高級中學） | <https://schoolday.dcsh.tp.edu.tw/sites/schoolday/files/teach_plan/109-1/psyche205-%E8%8B%B1%E6%96%87-102-105-107-108.pdf> |
| [S-blog-lt] | 傑夫的英文學習部落格〈高中英文龍騰版課文講解及相關資源(B1-B5)〉（2026-07-16 更新）（個人部落格（二手資料）） | <http://jefffong5464.blogspot.com/2024/10/b1-b5.html> |
| [S-blog-sm] | 傑夫的英文學習部落格〈高中英文三民版相關數位資源〉（2026-03-03；甲版車畇庭主編、乙版劉宇挺主編）（個人部落格（二手資料）） | <http://jefffong5464.blogspot.com/2026/03/blog-post.html> |
| [S-junyi-sm-b1] | 均一教育平台 三民 x 東大專區 高中英文 十年級(一上)（均一教育平台） | <https://www.junyiacademy.org/topics/s-eng-s-g10-b1> |
| [S-ceec-115-spec] | 學科能力測驗英文考科考試說明（115學年度起適用）（大學入學考試中心） | <https://www.ceec.edu.tw/files/file_pool/1/0P091472305863258925/01_115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E.pdf> |
| [S-ceec-111-spec] | 學科能力測驗英文考科考試說明（111學年度起適用）（大學入學考試中心） | <https://www.ceec.edu.tw/files/file_pool/1/0M263605645292734329/111%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E.pdf> |
| [S-ceec-110-trial] | 110 年試辦考試英文考科試題解析（大學入學考試中心） | <https://www.ceec.edu.tw/files/file_pool/1/0L273571052052407166/02-110%E5%B9%B4%E8%A9%A6%E8%BE%A6%E8%80%83%E8%A9%A6%E8%8B%B1%E6%96%87%E8%A7%A3%E6%9E%90.pdf> |
| [S-news-1111-115] | 〈115學測英文非選閱卷重點大公開 教授點名「這些錯誤」最致命〉（2026-02-02，記者林育如）（1111人力銀行 產經新聞（二手報導）） | <https://www.1111.com.tw/news/jobns/164351> |
| [S-ceec-ep351] | 選才電子報〈115學年度學科能力測驗試題特色－【英文】〉（大學入學考試中心） | <https://www.ceec.edu.tw/xcepaper/cont?xsmsid=0J066588036013658199&qunit=0Q105367191322447606&sid=0Q105583094870257539> |

### 8.2 其他

- [leg-gsat-107] 學科能力測驗英文考科考試說明（107 學年度起適用）：<https://www.ceec.edu.tw/files/file_pool/1/0J052605777209194600/107%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E%E5%AE%9A%E7%A8%BF.pdf>
- [leg-ast-107] 指定科目考試英文考科考試說明（107 學年度起適用）：<https://www.ceec.edu.tw/files/file_pool/1/0J052605777021346555/107%E6%8C%87%E8%80%83%E8%8B%B1%E6%96%87%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E%E5%AE%9A%E7%A8%BF.pdf>
- 花蓮女中 111-1 第一次定期考範圍（高三英語文欄：「翰林英文第五冊第一課與第二課」）：<https://www.hlgs.hlc.edu.tw/wp-content/uploads/sites/74/2022/10/111-1-%E7%AC%AC%E4%B8%80%E6%AC%A1%E5%AE%9A%E6%9C%9F%E8%80%83%E7%AF%84%E5%9C%8D1006%E6%9B%B4%E6%96%B0.pdf>
- 均一教育平台「高中文法」（鄭博仁老師授權影片，列出 it 句型、主動詞一致、分詞、倒裝、假設、使役、五大句型、不定詞；作為一般高中文法分類參考）：<https://www.junyiacademy.org/topics/eng-senior-grammar>

---

## 9. 大考中心題本與評分文件（§5 題幹與依據）

歷屆試題列表頁：學測 <https://www.ceec.edu.tw/xmfile?xsmsid=0J052424829869345634>，指考 <https://www.ceec.edu.tw/xmfile?xsmsid=0J052427633128416650>。110 年試辦考試解析：[S-ceec-110-trial]。

| 代號 | 考試 | 題本 | 非選擇題評分原則／閱卷說明 |
|---|---|---|---|
| gsat93 | 93 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076565053189025902/93english.pdf) | （本專案清單無） |
| gsat94 | 94 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076565680353985442/94english.pdf) | （本專案清單無） |
| gsat95 | 95 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076566377626944973/95english.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j199411483242610099/95%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| gsat96 | 96 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076567034255034586/02-96.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j199414025017032168/96%e5%ad%b8%e6%b8%ac%e5%9c%8b%e8%8b%b1%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| gsat97 | 97 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076567488514105513/02-97%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e9%a1%8c%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j199414961733809184/97%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e5%9c%8b%e6%96%87%e3%80%81%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat98 | 98 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076568022684428584/02-98%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e9%a1%8c%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j199417512785404281/98%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| gsat99 | 99 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076568905764750556/02-99%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j199419158754452819/99%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e8%aa%aa%e6%98%8e.pdf) |
| gsat100 | 100 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076570267209194600/02-100%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j204496801635770142/100%e5%b9%b4%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e8%aa%aa%e6%98%8e.pdf) |
| gsat101 | 101 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076570671923496609/02-101%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j204500048783677725/101%e5%b9%b4%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e8%aa%aa%e6%98%8e.pdf) |
| gsat102 | 102 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076571313825971626/02-102%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%28%e5%ae%9a%e7%a8%bf%29%20.pdf) | [評分1](https://www.ceec.edu.tw/files/file_pool/1/0j076571315648697608/102%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf)、[評分2](https://www.ceec.edu.tw/files/file_pool/1/0j212352513246037936/102%e5%b9%b4%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e8%aa%aa%e6%98%8e.pdf) |
| gsat103 | 103 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076572147183041652/02-103%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87-%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j076572149906768624/103%e5%ad%b8%e6%b8%ac%e8%a8%98%e8%80%85%e6%9c%83%e8%aa%aa%e6%98%8e%e8%b3%87%e6%96%99%e5%ae%9a%e7%a8%bf140121.pdf) |
| gsat104 | 104 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076572827714606282/02-104%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j076572827992454237/104%e5%ad%b8%e5%b9%b4%e5%ba%a6%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86.pdf) |
| gsat105 | 105 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076573375790393795/02-105%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e7%a7%91_%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j076573386979130740/105%e5%ad%b8%e5%b9%b4%e5%ba%a6%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86.pdf) |
| gsat106 | 106 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076574214786979208/02-106%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j076574215965727252/106%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c_5c%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat107 | 107 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076574893317534748/02-107%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j076574894851413865/107%e5%ad%b8%e5%b9%b4%e5%ba%a6%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat108 | 108 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j196548669826315609/01-108%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j196548660005162654/108%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat109 | 109 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0k050359836694452838/02-109%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7-%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0k050360046863300883/109%e5%ad%b8%e5%b9%b4%e5%ba%a6%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e%e4%bf%ae%28%e5%ae%9a%e7%a8%bf%29.pdf) |
| gsat110 | 110 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0l069608312283063557/110%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%20.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0l069609024006780639/110%e5%ad%b8%e5%b9%b4%e5%ba%a6%e5%ad%b8%e7%a7%91%e8%83%bd%e5%8a%9b%e6%b8%ac%e9%a9%97%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat111 | 111 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0m053357638065462325/02-111%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0m088557831942240372/02-111%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| gsat112 | 112 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0n045359274947649605/02-112%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0n049421311322447606/03-112%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e5%8f%83%e8%80%83%e7%ad%94%e6%a1%88%e8%88%87%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| gsat113 | 113 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0o051427482769341323/02-113%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e7%a7%91%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0o051427944026947323/03-113%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e5%8f%83%e8%80%83%e7%ad%94%e6%a1%88%e8%88%87%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| gsat114 | 114 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0p056425554473267580/02-114%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e9%a1%8c.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0p055378620142741052/03-114%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e5%8f%83%e8%80%83%e7%ad%94%e6%a1%88%e8%88%87%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| gsat115 | 115 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0q054532302653501476/02-115%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0q054335046832331817/115%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e5%8f%83%e8%80%83%e7%ad%94%e6%a1%88%e8%88%87%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| ref115 | 115 學年度參考試卷 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0O211576602559573811/02_02_%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91115%E8%B5%B7%E9%81%A9%E7%94%A8%E5%8F%83%E8%80%83%E8%A9%A6%E5%8D%B7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0O211577274372290893/02_03_%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91115%E8%B5%B7%E9%81%A9%E7%94%A8%E5%8F%83%E8%80%83%E8%A9%A6%E5%8D%B7%E5%8F%83%E8%80%83%E7%AD%94%E6%A1%88%E5%8F%8A%E8%A9%95%E5%88%86%E5%8E%9F%E5%89%87.pdf) |
| ast93 | 93 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075806499546533816/93english.pdf) | （本專案清單無） |
| ast94 | 94 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075807645706288959/94english.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j198542498340692232/94%e5%9c%8b%e6%96%87%e5%8f%8a%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| ast95 | 95 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075808109886501931/95%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j205600154098180038/95%e6%8c%87%e8%80%83%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e%ef%bd%9e%e8%8b%b1.pdf) |
| ast96 | 96 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075808706150560462/02-96%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j205600832968613683/96%e6%8c%87%e8%80%83%20%e5%9c%8b%e6%96%87%e3%80%81%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| ast97 | 97 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075809234323420902/02-97%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j205602171337963318/97%e6%8c%87%e8%80%83%e5%9c%8b%e6%96%87%e3%80%81%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96%e8%aa%aa%e6%98%8e.pdf) |
| ast98 | 98 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075809741597499543/02-98%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075809752775247597/180-5-02%e8%8b%b1%e6%96%87.pdf) |
| ast99 | 99 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075810590583175055/02-99%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075810591761923000/192-02-02%e8%8b%b1%e6%96%87.pdf) |
| ast100 | 100 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075811329569761568/02-100%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075811320748519513/204-03-02%e8%8b%b1%e6%96%87.pdf) |
| ast101 | 101 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075812147911578043/01-101%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分1](https://www.ceec.edu.tw/files/file_pool/1/0j075812148734295125/2-101%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87.pdf)、[評分2](https://www.ceec.edu.tw/files/file_pool/1/0j198593741495413846/101a%e8%8b%b1%e6%96%87.pdf) |
| ast102 | 102 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075812726542134683/02-102%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e9%a1%8c%28%e5%ae%9a%e7%a8%bf%29.pdf) | [評分1](https://www.ceec.edu.tw/files/file_pool/1/0j075812727720982638/102%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a8%98%e8%80%85%e6%9c%83%e8%aa%aa%e6%98%8e%e8%b3%87%e6%96%99.pdf)、[評分2](https://www.ceec.edu.tw/files/file_pool/1/0j198598201460336585/2-102%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e6%a8%99%e6%ba%96.pdf) |
| ast103 | 103 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075814065538810196/02-103%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075814066616668141/103%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a8%98%e8%80%85%e6%9c%83%e8%aa%aa%e6%98%8e%e8%b3%87%e6%96%990710.pdf) |
| ast104 | 104 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075814764524406609/02-104%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%28%e5%ae%9a%e7%a8%bf%29.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075814765603254654/104%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a8%98%e8%80%85%e6%9c%83%e8%aa%aa%e6%98%8e%e8%b3%87%e6%96%99.pdf) |
| ast105 | 105 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075815413055061239/02-105%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075815402976213284/02-105%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87.pdf) |
| ast106 | 106 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075816211853909797/02-106%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf%20.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075816212675626779/106%e5%ad%b8%e5%b9%b4%e5%ba%a6%e6%8c%87%e5%ae%9a%e7%a7%91%e7%9b%ae%e8%80%83%e8%a9%a6%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| ast107 | 107 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j075817351662312282/02-107%e5%ad%b8%e5%b9%b4%e5%ba%a6%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e7%a7%91_%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j075817350849685209/01-107%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| ast108 | 108 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j196363132626956988/02-108%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0j197365982206281209/%e9%99%84%e4%bb%b6%e4%b8%8001-108%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| ast109 | 109 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0k220529427431863441/02-109%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e7%a7%91-%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0k220529356353015496/01-109%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| ast109m | 109 學年度指考（補考） | [題本](https://www.ceec.edu.tw/files/file_pool/1/0k233400357137242710/02-109%e6%8c%87%e8%80%83%28%e8%a3%9c%e8%80%83%29%e8%8b%b1%e6%96%87%e7%a7%91-%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0k233400708315190764/01-109%e6%8c%87%e8%80%83%28%e8%a3%9c%e8%80%83%29%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| ast110 | 110 學年度指考 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0l251623650717537197/02-110%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e7%a7%91%e8%a9%a6%e5%8d%b7%e5%ae%9a%e7%a8%bf.pdf) | [評分](https://www.ceec.edu.tw/files/file_pool/1/0l266472648655955440/01-110%e6%8c%87%e8%80%83%e8%8b%b1%e6%96%87%e8%80%83%e7%a7%91%e9%9d%9e%e9%81%b8%e6%93%87%e9%a1%8c%e9%96%b1%e5%8d%b7%e8%a9%95%e5%88%86%e5%8e%9f%e5%89%87%e8%aa%aa%e6%98%8e.pdf) |
| gsat84 | 84 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076560158185999261/84%e5%b9%b4%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e7%a7%91.pdf) | （本專案清單無） |
| gsat85 | 85 學年度學測 | [題本](https://www.ceec.edu.tw/files/file_pool/1/0j076560475359959792/85%e5%b9%b4%e5%ad%b8%e6%b8%ac%e8%8b%b1%e6%96%87%e7%a7%91.pdf) | （本專案清單無） |


[S-curr]: https://www.naer.edu.tw/upload/1/16/doc/812/%28%E7%99%BC%E5%B8%83%E7%89%88%29%E5%9C%8B%E6%B0%91%E4%B8%AD%E5%B0%8F%E5%AD%B8%E6%9A%A8%E6%99%AE%E9%80%9A%E5%9E%8B%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1-%E8%AA%9E%E6%96%87%E9%A0%98%E5%9F%9F-%E8%8B%B1%E8%AA%9E%E6%96%87%E8%AA%B2%E7%A8%8B%E7%B6%B1%E8%A6%81.pdf
[S-naer-list]: https://www.tssh.cyc.edu.tw/df_ufiles/g/%E5%9C%8B%E5%AE%B6%E6%95%99%E8%82%B2%E7%A0%94%E7%A9%B6%E9%99%A2115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E7%AC%AC1%E5%AD%B8%E6%9C%9F%E9%AB%98%E7%B4%9A%E4%B8%AD%E7%AD%89%E5%AD%B8%E6%A0%A1%E5%AF%A9%E5%AE%9A%E6%9C%AC%E6%95%99%E7%A7%91%E7%94%A8%E6%9B%B8%E6%B8%85%E5%86%8A2.pdf
[S-cogsh-114-1-g10]: https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/4ff431b7a0a6519d3e4dce5a6f08c8a8.pdf
[S-cogsh-114-1-g11]: https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/6a0b64f60f41d1a727289c8b5cf474c1.pdf
[S-cogsh-114-1-grammar]: https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/d61670e918717404135d144f62056b0c.pdf
[S-cogsh-114-1-trans]: https://www.cogsh.tp.edu.tw/ischool/wr/file/1/4227/4422693db80a8b46b47d25aa3ad955b5.pdf
[S-csghs-110-2-g10]: https://www.csghs.tp.edu.tw/wp-content/uploads/110-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87.pdf
[S-csghs-110-1-g11]: https://www.csghs.tp.edu.tw/wp-content/uploads/%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8.pdf
[S-csghs-111-1-g11]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-111-2-g11]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-111-1-g12]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/111-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-112-1-g10]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/112-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-112-1-g12]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs2222/112-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-113-1-g11]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/113-1%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB.pdf
[S-csghs-114-1-g10]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-114-1-g11]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%20%28%E9%AB%98%E4%BA%8C%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-114-1-g12]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-1%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%28%E9%AB%98%E4%B8%89%E8%8B%B1%E6%96%87%29.pdf
[S-csghs-114-2-g10]: https://www.csghs.tp.edu.tw/wp-content/uploads/doc/zs222/114-2%E8%AA%B2%E7%A8%8B%E8%A8%88%E7%95%AB%E8%A1%A8%28%E9%AB%98%E4%B8%80%E8%8B%B1%E6%96%87%29.pdf
[S-hsnu-111-1-g11]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW166675026148664.pdf
[S-hsnu-111-1-g12]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW166676861876612.pdf
[S-hsnu-112-2-g10]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW171325541591680.pdf
[S-hsnu-113-1-g10]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW172662320999711.pdf
[S-hsnu-114-1-g10]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW175876365606997.pdf
[S-hsnu-114-1-g11]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW175876788297236.pdf
[S-hsnu-114-2-g10]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW177276013176838.pdf
[S-hsnu-114-2-g11]: https://www.hs.ntnu.edu.tw/static/webroot/G162269151451663/application/NW177276080467360.pdf
[S-dcsh-109-1]: https://schoolday.dcsh.tp.edu.tw/sites/schoolday/files/teach_plan/109-1/psyche205-%E8%8B%B1%E6%96%87-102-105-107-108.pdf
[S-blog-lt]: http://jefffong5464.blogspot.com/2024/10/b1-b5.html
[S-blog-sm]: http://jefffong5464.blogspot.com/2026/03/blog-post.html
[S-junyi-sm-b1]: https://www.junyiacademy.org/topics/s-eng-s-g10-b1
[S-ceec-115-spec]: https://www.ceec.edu.tw/files/file_pool/1/0P091472305863258925/01_115%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E.pdf
[S-ceec-111-spec]: https://www.ceec.edu.tw/files/file_pool/1/0M263605645292734329/111%E5%AD%B8%E5%B9%B4%E5%BA%A6%E8%B5%B7%E9%81%A9%E7%94%A8%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E7%A7%91%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E.pdf
[S-ceec-110-trial]: https://www.ceec.edu.tw/files/file_pool/1/0L273571052052407166/02-110%E5%B9%B4%E8%A9%A6%E8%BE%A6%E8%80%83%E8%A9%A6%E8%8B%B1%E6%96%87%E8%A7%A3%E6%9E%90.pdf
[S-news-1111-115]: https://www.1111.com.tw/news/jobns/164351
[S-ceec-ep351]: https://www.ceec.edu.tw/xcepaper/cont?xsmsid=0J066588036013658199&qunit=0Q105367191322447606&sid=0Q105583094870257539
[leg-gsat-107]: https://www.ceec.edu.tw/files/file_pool/1/0J052605777209194600/107%E5%AD%B8%E6%B8%AC%E8%8B%B1%E6%96%87%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E%E5%AE%9A%E7%A8%BF.pdf
[leg-ast-107]: https://www.ceec.edu.tw/files/file_pool/1/0J052605777021346555/107%E6%8C%87%E8%80%83%E8%8B%B1%E6%96%87%E8%80%83%E8%A9%A6%E8%AA%AA%E6%98%8E%E5%AE%9A%E7%A8%BF.pdf
