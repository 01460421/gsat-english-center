# 單字資料管線報告（lexicon）

> 本檔由 `tools/build_vocab.py build` 產生，請勿手動修改。數字全部是本專案計算。
> 輸入：`data/vocab/ceec-wordlist.json`（6,012 筆）與 `data/vocab/sources.json` 列出的原始檔。

## 1. 輸出檔

| 檔案 | 大小 | sha256 |
|---|---:|---|
| `data/vocab/CREDITS.md` | 12,348 bytes | `cc123ad96e4172d3015bf1da057cb872e1488037fdaf634bee4c1f82e228f137` |
| `data/vocab/forms-index.json` | 1,246,993 bytes | `7c814e1f0335037bd1b32a7ccbb66f8723d0ac83ef46e3c1fe075f3d624252ad` |
| `data/vocab/lexicon.json` | 22,337,236 bytes | `6e9346caff04fc48d824e79b3708c3e35d5303b732576f33e3b7f8f9744f612e` |

- 條目數 6,012；forms-index 詞形數 16,953。lexicon.json 上限 25 MB，未超過，輸出單一檔。
- forms-index 各型態的（詞形, 條目）組數：comparative 259、derived_ment 61、derived_suffix 1、lemma 6,012、past 2,661、past_participle 2,630、plural 4,081、plural_rule 97、plural_usual 22、present 3、present_participle 2,671、pronoun_case 24、slash 85、superlative 216、third_person 2,140。其中 `plural_rule` 是 ECDICT 沒列複數、規則複數在 Tatoeba 英文句出現至少 3 次的 96 筆名詞；另有 224 筆名詞的規則複數沒有語料證據，不收（例如 accordances、accountings、acnes、advices、agricultures、aircrafts、aluminums、applauses、archaeologies、assistances、asthmas、astronomies，多為不可數名詞或拼法錯誤）。
- 屈折形只收條目詞類能產生的形式：ECDICT exchange 中 2,529 個屈折形不屬於條目詞類（名詞 fee 的過去式 feed、名詞 ox 的比較級 oxer、形容詞 abnormal 的複數 abnormals…），不放進 `forms`；其中可當詞形還原線索的 1,367 組（例如名詞 angle 的 angled）在 forms-index 標 `extra_pos: true`，比較級／最高級、等於任何條目原形或變體的（feed、wedding、shorts）則完全不收。變體列的屈折形同樣依變體詞類過濾，代名詞格（mine、her）不帶屈折形，共略過 69 個（原本 mined、mining、hering 會對到代名詞 I、she）。ECDICT 的錯誤形式依 `FORM_FIXES` 修正 11 個（sheep 的複數 sheeps→sheep）。-l 結尾的動詞改用美式拼法 67 個（traveled，英式 travelled 仍在 forms-index）。
- forms-index 中對應到多個條目的詞形：120 個（例如 accounting, advanced, am, armed, arms, backward, bathed, being, best, better, bit, blessing）。
- OpenCC：OpenCC（官方 Python 綁定） 1.4.2（s2twp）。重跑一致性：`python3 tools/build_vocab.py check` 會在暫存目錄重建並逐位元比對，上表 sha256 也可以直接比對。

## 2. 各欄位非空比例（依級別）

| 欄位 | L1 | L2 | L3 | L4 | L5 | L6 | **L3–5** | 全部 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 條目數 | 1,002 | 1,002 | 1,002 | 1,002 | 1,002 | 1,002 | 3,006 | 6,012 |
| variants（有變體） | 3.6% | 4.5% | 1.9% | 2.7% | 0.7% | 3.4% | 1.8% | 2.8% |
| forms（ECDICT 屈折形） | 78.2% | 82.4% | 82.6% | 78.7% | 81.4% | 77.2% | 80.9% | 80.1% |
| ipa | 99.8% | 99.8% | 99.9% | 99.8% | 99.9% | 99.5% | 99.9% | 99.8% |
| 　ipa 來自 ECDICT | 99.5% | 99.5% | 99.8% | 99.6% | 99.9% | 99.0% | 99.8% | 99.6% |
| zh（ECDICT 中文） | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| 　zh 有詞性相符的行 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| en_def | 95.6% | 98.7% | 99.7% | 99.4% | 99.6% | 99.8% | 99.6% | 98.8% |
| 　en_def 來自 OEWN | 95.1% | 98.6% | 99.7% | 99.3% | 99.6% | 99.4% | 99.5% | 98.6% |
| wordnet（依條目詞類有義項） | 95.1% | 98.6% | 99.7% | 99.3% | 99.6% | 99.4% | 99.5% | 98.6% |
| 　≥1 義項有例句 | 81.2% | 77.6% | 73.1% | 80.3% | 74.9% | 70.4% | 76.1% | 76.2% |
| 　≥1 義項有同義詞 | 88.2% | 89.7% | 87.9% | 89.4% | 88.2% | 87.4% | 88.5% | 88.5% |
| 　同義詞中有詞彙表內的字 | 70.6% | 68.5% | 64.0% | 65.3% | 62.0% | 57.4% | 63.7% | 64.6% |
| 　antonyms | 31.5% | 24.3% | 19.7% | 22.3% | 17.8% | 14.1% | 19.9% | 21.6% |
| 　hypernyms | 76.9% | 84.4% | 81.5% | 80.0% | 83.5% | 81.8% | 81.7% | 81.4% |
| 　derivations（詞彙表內） | 21.1% | 30.3% | 28.1% | 43.9% | 31.8% | 26.1% | 34.6% | 30.2% |
| family（有同詞族條目） | 23.1% | 32.5% | 29.1% | 45.0% | 31.5% | 26.1% | 35.2% | 31.2% |
| examples ≥1 | 99.9% | 97.0% | 90.6% | 81.9% | 65.9% | 49.8% | 79.5% | 80.9% |
| examples ≥3 | 99.3% | 87.1% | 65.5% | 46.9% | 23.5% | 10.8% | 45.3% | 55.5% |
| examples =5 | 97.6% | 77.0% | 44.9% | 27.8% | 8.6% | 2.9% | 27.1% | 43.1% |
| 　例句全部在級別內（≤level+1） | 92.6% | 64.8% | 55.5% | 52.1% | 41.4% | 33.5% | 49.7% | 56.7% |
| Tatoeba 候選句 ≥1（tatoeba_count） | 100.0% | 98.5% | 95.4% | 90.7% | 78.5% | 65.3% | 88.2% | 88.1% |
| Tatoeba 候選句 ≥3 | 99.8% | 93.7% | 79.4% | 63.8% | 39.8% | 22.9% | 61.0% | 66.6% |
| cefr | 99.4% | 96.0% | 88.8% | 88.1% | 73.8% | 51.6% | 83.6% | 83.0% |
| freq.frq | 98.8% | 99.0% | 99.2% | 99.5% | 99.8% | 99.3% | 99.5% | 99.3% |
| freq.bnc | 98.8% | 98.8% | 99.2% | 99.7% | 99.2% | 98.0% | 99.4% | 99.0% |
| internal_core_flag = true | 92.4% | 78.3% | 49.4% | 38.3% | 12.4% | 2.0% | 33.4% | 45.5% |
| internal_star 有值 | 97.9% | 95.6% | 95.4% | 92.7% | 95.6% | 88.0% | 94.6% | 94.2% |
| cambridge_url | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

說明：
- `wordnet` 只算條目詞類對應的 WordNet 詞性（n.、v.、adj.、adv.；aux. 視為 v.）。prep.、conj.、pron.、art. 在 WordNet 沒有對應，所以 L1–2 的功能詞比例較低。
- `zh 有詞性相符的行`：ECDICT 中文的行首詞性（vt.、n.、a.…）屬於條目詞類，介面可預設只顯示這些行；沒有任何一行相符的 12 筆改標 `fallback`（見 §9），3 筆 ECDICT 中文明顯錯誤的條目補了 `fixed` 行（`ZH_OVERRIDES`）。
- `Tatoeba 候選句`：含該條目任一詞形（原形、變體、屈折形）且有中文翻譯的英文句數，未套用句長與作者條件；`examples` 是套用句長 6–20、作者必填（CC0 例外）、去重後實際收錄的句子（最多 5 句）。

## 3. 與 04 文件 §2.3（Level 3–5 共 3,006 筆）比較

| 資料 | 指標 | 04 文件 | 本次 | 差異說明 |
|---|---|---:|---:|---|
| ECDICT | 收錄且有中文釋義 | 3,006（100%） | 3,006（100.0%） | |
| ECDICT | 有 Collins 星級 | 2,843（94.6%） | 2,843（94.6%） | 欄位改名 `internal_star` |
| ECDICT | `oxford`=1 | 1,003（33.4%） | 1,003（33.4%） | 欄位改名 `internal_core_flag` |
| ECDICT | 有 `frq` | 2,991（99.5%） | 2,991（99.5%） | 0 視為缺值 |
| ECDICT | 有 `exchange` | 2,557（85.1%） | 2,433（80.9%） | 本次只算詞頭（或第一個查得到的變體）那一列，而且只算條目詞類能產生的屈折形（名詞 tension 的 tensioned 這類不算） |
| OEWN 2025 | 收錄 | 2,996（99.7%） | 2,992（99.5%） | 本次限條目詞類；不限詞類見下一列 |
| OEWN 2025 | 收錄（不限詞類） | 2,996（99.7%） | 2,996（99.7%） | |
| OEWN 2025 | 至少一個 synset 有其他成員 | 2,690（89.5%） | 2,661（88.5%） | 限條目詞類 |
| OEWN 2025 | 有上位詞 | 2,547（84.7%） | 2,456（81.7%） | 限條目詞類 |
| OEWN 2025 | synset 附例句 | 2,369（78.8%） | 2,287（76.1%） | 限條目詞類 |
| Tatoeba 英中對照 | ≥1 句含該詞（含屈折形） | 2,652（88.2%） | 2,652（88.2%） | |
| Tatoeba 英中對照 | ≥3 句 | 1,840（61.2%） | 1,834（61.0%） | |
| Tatoeba（收錄） | examples ≥1 | — | 2,389（79.5%） | 句長 6–20、作者必填 |
| Tatoeba（收錄） | examples ≥3 | — | 1,361（45.3%） | |

## 4. CEFR 對照分布（與 04 文件 §5.3 比較）

本次用 CEFR-J **1.6**（ALL_sep 工作表，斜線並列已拆開）加 Octanove C1–C2；04 文件用的是 1.5。同一詞多個詞性時，先取和條目詞類相符的詞性中最低級，沒有相符的才取全部詞性中最低級。

| 大考級數 | 筆數 | A1 | A2 | B1 | B2 | C1 | C2 | 無對照 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| L1 | 1,002 | 741 | 202 | 44 | 9 | 0 | 0 | 6 |
| L2 | 1,002 | 129 | 412 | 320 | 99 | 2 | 0 | 40 |
| L3 | 1,002 | 28 | 248 | 412 | 194 | 7 | 1 | 112 |
| L4 | 1,002 | 10 | 95 | 461 | 292 | 24 | 1 | 119 |
| L5 | 1,002 | 1 | 16 | 216 | 416 | 76 | 14 | 263 |
| L6 | 1,002 | 2 | 19 | 115 | 272 | 89 | 20 | 485 |

04 文件 §5.3 的「無對照」：L1 7、L2 40、L3 112、L4 119、L5 263、L6 483。

## 5. 音標字元統一

- 來源：ECDICT 5,985 筆，OEWN 補 14 筆，仍缺 13 筆。
- 輸出音標使用的字元：`␠` `(` `)` `,` `-` `a` `b` `d` `e` `f` `h` `i` `j` `k` `l` `m` `n` `o` `p` `r` `s` `t` `u` `v` `w` `z` `æ` `ð` `ŋ` `ɑ` `ɒ` `ɔ` `ə` `ɚ` `ɛ` `ɡ` `ɪ` `ɹ` `ʃ` `ʊ` `ʌ` `ʒ` `ˈ` `ˌ` `ː` `θ`
- 殘留的 Cyrillic ә／є、ASCII `'`、`:`、`g`：無；白名單以外的字元：無。
- 對應：`ә`(U+04D9)→`ə`(U+0259)、`є`(U+0454)→`ɛ`(U+025B)、ASCII `g`→`ɡ`(U+0261)、`'`→`ˈ`、`:`→`ː`、緊接音標的 `,`／`.`→`ˌ`；`. `、`, `、兩段都有主重音或兩段都沒有重音記號的 `.`（`bæθ.bɑ:θ`），以及後一段以 `-` 開頭或結尾的 `,` 視為多種讀法，輸出成 `, `；重複的 `''` 與 `'` 後的空白合併。OEWN 補的發音本來就是 IPA（美式，例如 `ɹ`、`ɚ`），只做同樣的 `g`→`ɡ` 與白名單檢查。
- 只統一字元，不改標音體系：ECDICT 是舊式英式標音（`əu`、`ai`、`e`），OEWN 是美式寬式標音（`oʊ`、`aɪ`、`ɛ`），介面若要一致的體系需另行轉寫。`(r)`、`(ə)` 表示可省略的音，`-dəkt` 這類只寫出不同部分的第二讀法照原樣保留。
- 不採用的 ECDICT 音標（corrupt）：8 次，例如 `God ^ɔd`；`chairperson 'tʃeәp\\\\:s(e)n`；`goodwill ^jd'wil`；`guava '^wɑ:vә`；`photographer fә'tɔ^rәfә`；`seagull 'si:^ʌl`；`workbook 'w\\\\:kbjk`；`yogurt 'jɔ^әt`
- ECDICT 音標錯字：和 OEWN 發音逐筆比對子音（`ipa_skeleton`）後確認 13 個，依 `IPA_FIXES` 修正（assault əˈsɒːlt、celebrity siˈlebriti、consider kənˈsidə、convenience kənˈviːnjəns、electric iˈlektrik、homosexual ˌhɒməuˈsekʃuəl、influential ˌinfluˈenʃəl、liberty ˈlibəti、maximum ˈmæksiməm、shut ʃʌt、soften ˈsɒfn、splendid ˈsplendid、translator trænsˈleitə），`ipa_source.fixed = true`。沒有 OEWN 發音可比對的條目（約四成）無法用這個方法檢查。
- 沒有音標的條目（13）：am/a.m. adv. 1、basics n. 2、chairperson/chair/chairman/chairwoman n. 6、cosmetics n. 6、customs n. 5、firework n. 3、including prep. 4、pm/p.m. adv. 1、seagull/gull n. 6、telecommunications n. 6、workbook n. 2、workforce n. 6、workplace n. 4

## 6. 例句（Tatoeba）

- 匯出檔：有中文連結的英文句 72,933 句（實際載入 72,768），對應中文句 66,251 句；CC0 清單 41,513 句。
- 收錄例句 17,646 句次（不重複英文句 12,291）；英文 CC0 96 句次；中文經 s2twp 改變文字的 9,880 句次；全句在級別內（其他字 ≤ level+1）的 15,549 句次。
- 同形異詞處理：58 筆條目的原形同時是另一個（級別不高於它的）條目的屈折形，例如 saw／see、found／find、lay／lie、rose／rise、learned／learn。只靠這種詞形命中、而且前一個字無法判斷詞類的句子不採用，共排除 1,880 句次。排除最多的條目：thought（264）、left（242）、used（202）、saw（187）、found（174）、being（165）、broke（79）、learning（62）、evening（55）、means（46）、bit（42）、building（37）。規則見 `tools/build_vocab.py`。
- 反方向的同形異詞：73 筆條目有屈折形同時是另一筆的原形或變體（wed 的 wedding、bore 的 bored／boring、grind 的 ground、clothe 的 clothes、find 的 found）。只靠這種詞形命中、而且前後文看不出是本條目屈折用法的句子不採用，共排除 2,797 句次。排除最多的條目：good（564）、use（152）、interest（147）、bite（139）、leave（128）、marry（122）、tire（118）、meet（113）、be（97）、clothe（97）、bear（88）、late（86）。
- 同字多筆（§6.3 的 9 組）依前後文分配句子（`sibling_ok`），排除 168 句次；`to prep.` 排除不定詞用法（to＋動詞原形）6,985 句次。
- 內容過濾：含粗話、色情或自殘字眼（`SENSITIVE_RE`）的句子不採用，共排除 329 句次（命中的字是條目本身時例外，例如 suicide、sexy 的例句）。
- 英文句作者前 10：CK（5,087）、CM（1,583）、sharris123（443）、eastasiastudent（419）、sundown（416）、Zifre（351）、LeviHighway（309）、AlanF_US（302）、CN（282）、Amastan（250）

例句數分布（依級別）：

| 級別 | 0 句 | 1–2 句 | 3–4 句 | 5 句 |
|---|---:|---:|---:|---:|
| L1 | 1 | 6 | 17 | 978 |
| L2 | 30 | 99 | 101 | 772 |
| L3 | 94 | 252 | 206 | 450 |
| L4 | 181 | 351 | 191 | 279 |
| L5 | 342 | 425 | 149 | 86 |
| L6 | 503 | 391 | 79 | 29 |

## 7. 詞族

- 有 2 個以上條目的詞族 835 個，涵蓋 1,878 筆條目。合併依據（實際造成合併的連結數）：同字多筆 9、變體等於另一筆詞形 3、OEWN 衍生類義項關係 999、OEWN synset attribute 32。
- 規則：OEWN 連結兩端的「義項詞性」都要能代表各自條目的詞類（詞性相同，或 OEWN 標了同字轉類，例如 war n.↔war v.），而且兩個詞要有共同字首；另以黑名單排除 bet–better、let–letter、life–liver、live–liver、lively–liver、stock–stocking、tow–tower（OEWN 連到的是同形異義的少見義項）。
- 已知限制：OEWN 沒有連結的衍生詞不會成為詞族，例如 admire–admirable、except–exception（except 在詞彙表只是 prep./conj.）。曾試過用字尾規則補（-able、-ion…），但 apple–apply、corn–corner、list–listen 這類誤判太多，所以沒有採用。
- 詞族大小分布：2 筆×667、3 筆×137、4 筆×24、5 筆×5、6 筆×2
- 最大的詞族：create(2)、creative(3)、creator(3)、creature(3)、creation(4)、creativity(4)；sense(2)、sensitive(2)、sensible(3)、sensation(5)、sensitivity(5)、sensor(5)；act(1)、action(1)、actor(1)、active(2)、activity(2)；economic(4)、economical(4)、economics(4)、economist(4)、economy(4)；operate(2)、operator(2)、operation(3)、operational(5)、operative(6)
- 03 文件 §7.3 的例子：
  - admire（L3）→ admiration(L4)
  - accurate（L3）→ accuracy(L4)
  - accuse（L4）→ accusation(L6)
  - analyze（L4）→ analysis(L4)、analyst(L5)、analytical(L6)
  - adolescent（L5）→ adolescence(L6)
  - compete（L3）→ competition(L4)、competitive(L4)、competitor(L4)
  - economy（L4）→ economic(L4)、economical(L4)、economics(L4)、economist(L4)

## 8. 特殊條目抽樣

| 條目 | entry_id | ipa | 第一行中文 | WordNet 義項數 | 例句數 | 詞族 |
|---|---|---|---|---:|---:|---|
| `backward adj. 2` | `backward\|adj.\|2` | ˈbækwəd | a. 向後的, 相反的 | 4 | 0 | backward |
| `backward/backwards adv. 2` | `backward\|adv.\|2` | ˈbækwəd | adv. 向後地, 相反地 | 3 | 5 | backward |
| `capital n./adj. 2` | `capital\|n./adj.\|2` | ˈkæpitəl | n. 首都, 大寫字母, 資本 | 9 | 5 | capital、capitalist |
| `capital(ism) n. 4` | `capital\|n.\|4` | ˈkæpitəl | n. 首都, 大寫字母, 資本 | 6 | 2 | capital、capitalist |
| `content n./adj. 4` | `content\|n./adj.\|4` | kənˈtent | n. 內容, 滿足, 意義, 要旨 | 8 | 5 | contain、container、content |
| `content(ment) v./(n.) 4` | `content\|v./(n.)\|4` | kənˈtent | vt. 使...滿足, 使...安心 | 2 | 3 | contain、container、content |
| `measure(ment) v./(n.) 2` | `measure\|v./(n.)\|2` | ˈmeʒə | vt. 測量, 測度, 估量, 權衡, 調節, 拿(自己或自 | 4 | 5 | measurable、measure |
| `measure(s) n. 4` | `measure\|n.\|4` | ˈmeʒə | n. 尺寸, 量度器, 量度標準, 測量, 量具, 程度,  | 9 | 5 | measure、measurable |
| `medium adj. 1` | `medium\|adj.\|1` | ˈmiːdiəm | a. 半生熟的, 中間的 | 2 | 3 | media、medium |
| `medium/media n. 3` | `medium\|n.\|3` | ˈmiːdiəm | n. 媒體, 方法, 媒介 | 11 | 5 | media、medium |
| `am/a.m. adv. 1` | `am\|adv.\|1` | — | 上午, 午前 | 1 | 5 | — |
| `pm/p.m. adv. 1` | `pm\|adv.\|1` | — | 下午, 午後 | 1 | 5 | — |
| `O.K./OK/okay adj./adv./n./v. 1` | `O.K.\|adj./adv./n./v.\|1` | ˈəuˈkei | a. 好, 可以, 行, 對, 好嗎, 很好 | 3 | 5 | — |
| `o’clock adv. 1` | `o’clock\|adv.\|1` | əˈklɔk | n. ...點鐘, 鐘頭 | 1 | 5 | — |
| `café/cafe n. 2` | `café\|n.\|2` | kɑːˈfei | n. 咖啡館, 酒店 | 1 | 5 | — |
| `T-shirt n. 1` | `T-shirt\|n.\|1` | ˈtiːˌʃəːt | n. 圓領汗衫, T恤 | 1 | 5 | — |
| `Mr./Mister n. 1` | `Mr.\|n.\|1` | ˈmistə(r) | 閣下, 先生 | 1 | 5 | — |
| `I (me, my, mine, myself) pron. 1` | `I\|pron.\|1` | ai | pron. 我 | 0 | 5 | — |
| `advertise(ment)/ad v./(n.) 3` | `advertise\|v./(n.)\|3` | ˈædvətaiz | vt. 做廣告, 通知, 公佈 | 2 | 5 | — |
| `chairperson/chair/chairman/chairwoman n. 6` | `chairperson\|n.\|6` | — | n. 主席 | 1 | 5 | chair |
| `calm v./adj./n 2` | `calm\|v./adj./n.\|2` | kɑːm | n. 平穩, 風平浪靜 | 8 | 5 | — |

處理規則見 `tools/build_vocab.py` 檔頭註解。

## 9. 自動查核（全量）

`build` 每次都對輸出做下列檢查；標「必須為 0」的項目只要不是 0，`python3 tools/build_vocab.py check` 就失敗。

| 檢查 | 結果 | 必須為 0 | 例子／說明 |
|---|---:|---|---|
| entry_id 重複 | 0 | 是 |  |
| entry_id 不等於 word\|pos\|level | 0 | 是 |  |
| 中文欄位含 Big5 以外的漢字（殘留簡體或日文字形） | 0 | 是 | （例外：咔嵴擀酶顬鯿） |
| 音標含白名單以外的字元或重音記號錯置 | 0 | 是 |  |
| 音標殘留 Cyrillic ә／є 或 ASCII ' : g | 0 | 是 |  |
| forms 含條目詞類以外的屈折形 | 0 | 是 |  |
| forms-index 詞類不符的對應 | 0 | 是 |  |
| 例句缺作者、句子 ID 或連結（CC0 例外） | 0 | 是 |  |
| 例句授權值不是 CC-BY-2.0-FR／CC0-1.0 | 0 | 是 |  |
| 例句不含該條目的任何詞形 | 0 | 是 |  |
| 同義詞標為詞彙表內、但詞彙表條目的詞類不同 | 0 | 是 |  |
| 欄位名稱含品牌字樣（Collins、Oxford…） | 0 | 是 | （cambridge_url 是外連欄位，不算） |
| cambridge_url 不符合 slug 規則 | 0 | 是 |  |
| 沒有音標的條目 | 13 | 否 | am/a.m. adv. 1；basics n. 2；chairperson/chair/chairman/chairwoman n. 6；cosmetics n. 6 |
| 中文沒有詞性相符的行、改用 fallback | 12 | 否 | affiliate\|n.\|6；Celsius\|n.\|6；downward\|adv.\|6；goodbye\|n.\|1 |
| ECDICT 音標與 OEWN 發音的子音不一致（比對 3,757 筆） | 26 | 否 | actual ˈæktʃuəl／ˈæk(t)ʃ(əw)əl；buffet ˈbʌfit／ˈbʊfeɪ；character ˈkærəktə／ˈkɛɹ(ə)ktɚ；clothes kləuðz／kləʊ(ð)z（其餘多為英美讀法差異或可省略音（buffet、lieutenant、picture）；已確認的 ECDICT 錯字 13 個收在 IPA_FIXES） |

- 中文用 Big5（cp950）字集檢查：台灣通行的繁體字都在 Big5 內，殘留的簡體字（们、这、说…）與日文新字體（髪、説）都不在。用 OpenCC 反向轉換（t2s 或對已轉換文字再跑一次 s2tw）比對會把 說明了→說明瞭、里約→裡約 這類正確的繁體也算成差異，所以不採用。
- 人工抽查用 `python3 tools/build_vocab.py sample --seed 20261008` 列出每級 10 筆（共 60 筆）的完整內容；每級優先抽同字多筆、斜線條目、括號條目、不規則變化與帶符號的條目各一筆，其餘隨機。

## 10. 來源版本

| id | 檔案 | 版本 | 下載日 | sha256 |
|---|---|---|---|---|
| ecdict | `ecdict/ecdict.csv` | git bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b | 2026-10-07 | `1a6947e04785db63…` |
| ecdict-license | `ecdict/LICENSE` | git bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b | 2026-10-07 | `f8552dd246f61a4e…` |
| oewn | `oewn/english-wordnet-2025-json.zip` | Open English WordNet 2025 Edition (released 2025-12-31; git tag 2025-edition = dc343f2683279ecbb13fab4e2fd778d7b162d287) | 2026-10-07 | `7d749f6e2c39e697…` |
| oewn-license | `oewn/LICENSE.md` | git tag 2025-edition | 2026-10-07 | `672cc8b5663e8dc7…` |
| oewn-wndb-license | `oewn/WNDB_License.txt` | git tag 2025-edition | 2026-10-07 | `df30ec18fbabcdaf…` |
| tatoeba-eng | `tatoeba/eng_sentences_detailed.tsv.bz2` | Tatoeba weekly export (see http_last_modified) | 2026-10-07 | `d2c8fc271db70967…` |
| tatoeba-cmn | `tatoeba/cmn_sentences_detailed.tsv.bz2` | Tatoeba weekly export (see http_last_modified) | 2026-10-07 | `934fdfad76366c10…` |
| tatoeba-links | `tatoeba/eng-cmn_links.tsv.bz2` | Tatoeba weekly export (see http_last_modified) | 2026-10-07 | `634ededd116a92f1…` |
| tatoeba-eng-cc0 | `tatoeba/eng_sentences_CC0.tsv.bz2` | Tatoeba weekly export (see http_last_modified) | 2026-10-07 | `a51307f6eccb2ca5…` |
| tatoeba-cmn-cc0 | `tatoeba/cmn_sentences_CC0.tsv.bz2` | Tatoeba weekly export (see http_last_modified) | 2026-10-07 | `72c6ac699497cbc9…` |
| cefrj | `cefrj/CEFRJ_wordlist_ver1.6.zip` | CEFR-J Wordlist Version 1.6 (xlsx dated 2020-03-24) | 2026-10-07 | `c837d2c00ab8954e…` |
| olp-cefrj | `cefrj/cefrj-vocabulary-profile-1.5.csv` | CEFR-J Wordlist 1.5 CSV (olp-en-cefrj git d4e45b75b38f27b30dfc5c44d8c571aec7e7092f); reference only, build uses 1.6 | 2026-10-07 | `b0dd3c635f1c9a4f…` |
| octanove | `cefrj/octanove-vocabulary-profile-c1c2-1.0.csv` | Octanove Vocabulary Profile C1/C2 ver 1.0 (olp-en-cefrj git d4e45b75b38f27b30dfc5c44d8c571aec7e7092f) | 2026-10-07 | `18c33a407f2f89f7…` |
| olp-readme | `cefrj/olp-README.md` | olp-en-cefrj git d4e45b75b38f27b30dfc5c44d8c571aec7e7092f | 2026-10-07 | `8b69f7366fa3c7be…` |
