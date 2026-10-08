# 06｜Claude API 使用規劃：模型選擇、呼叫方式與成本

> 撰寫日期：2026-10-07。
> 依據：Claude Code 內建的 `claude-api` 技能（模型表快取日期 2026-09-25），以及 2026-10-07 直接下載的 Anthropic、Cloudflare、GitHub 官方文件。原始檔放在 `data/raw/anthropic-docs/`、`data/raw/cloudflare-docs/`、`data/raw/misc-docs/`，這些目錄不進版本控制。
> 金額一律是美元，換算新臺幣用中央銀行公布的 2026/10/07 新臺幣對美元銀行間收盤匯率 **31.795** [CBC-FX]。
> 文中所有「token 量」都是本文件的估算，不是官方數字。上線前要用 token counting API（免費）[ANT-TOKEN] 和實際回應的 `usage` 欄位校正。
> 來源代號（例如 [ANT-PRICE]）對應文末「參考來源」的網址。
> **對抗式查證（2026-10-08）**：逐條回到 `data/raw/` 的原始檔核對，並重新下載官方頁面，新檔放在 `data/raw/anthropic-docs/recheck-2026-10-08/`、`data/raw/cloudflare-docs/recheck-2026-10-08/`。重新下載時發現兩項官方變動，已改寫進內文：
> - **Claude Haiku 5.5 於 2026-10-07 發布**（`claude-haiku-5-5`），原稿撰寫時的官方頁面還沒有它 [ANT-H55]。
> - **Sonnet 5.5 的快取讀取從 $0.20 降為 $0.10／MTok（0.05 倍）**。2026-10-07 下載的價目表還是 $0.20，2026-10-08 的版本已改 [ANT-PRICE] [ANT-S55]。
> 其他修正與補充直接寫在內文，標有「（2026-10-08 查證）」。

---

## 0. 重點摘要

1. **預設模型用 Claude Opus 5.5**，API ID 是 `claude-opus-5-5`。
   - 2026-09-22 發布，價格 $4／$20 per MTok（輸入／輸出），1M context，最大輸出 128K [ANT-O55] [ANT-PRICE]。
   - 官方建議多數工作從它開始 [ANT-MODELS]。
2. **獨立驗證的第二位解題者用 Claude Sonnet 5.5**，API ID 是 `claude-sonnet-5-5`。
   - 價格 $2／$10，快取讀取 $0.10（2026-10-08 起，原為 $0.20），2026-09-28 發布 [ANT-S55] [ANT-PRICE]。
   - 用它的理由是「換一個模型才算獨立」，不是為了省錢。
3. **不用 Haiku 4.5**：官方只承諾退役日期「不早於 2026-10-15」[ANT-DEPR]，離今天只剩 8 天。
   - **Haiku 5.5（2026-10-08 查證補充）**：`claude-haiku-5-5` 於 2026-10-07 發布。價格 $0.10／$0.50（prompt 不超過 100,000 tokens；超過則 $0.50／$2.50），1M context，最大輸出 128K，adaptive thinking 預設 `medium`，支援結構化輸出，**沒有 server-side fallback** [ANT-H55] [ANT-H55-NEW] [ANT-SO]。
   - 官方定位是「分類、擷取、路由等大量、講求低延遲的工作」[ANT-H55]。本文件把它列為大量、低風險任務的**候選**，例如單字增補、題目初篩。單價約是 Opus 5.5 的 1/40，但品質沒有評測過，要先評測，再由使用者決定（§2.4、§3.3）。
4. **Fable 5.1 先不用**：價格 $10／$50。只有在 Opus 5.5 調高 effort 仍過不了評測時才考慮（官方原文是「at higher effort still fall short」）[ANT-MODELS]。
5. **共用題庫一律走 Message Batches API，再搭配結構化輸出（`output_config.format`）。**
   - Batch 的輸入和輸出都打五折 [ANT-BATCH]。
   - Opus 5.5 和 Sonnet 5.5 不接受強制 `tool_choice`（`any`／`tool`），會回 400 [ANT-O55-MIG]。所以不要沿用「強制呼叫工具取得 JSON」的舊寫法（Sekai 的審核功能就是這樣寫的）。
6. **Opus 5.5 的思考不能關，只能用 `effort` 控制，預設是 `medium`。** 思考 token 照輸出單價計費 [ANT-O55-MIG] [ANT-THINK]。
   - 所以成本的大宗在**輸出**。在本專案的出題請求裡，輸入只占約 16%，快取最多也只能省這一塊（本文件計算）。
7. **兩個新模型都不接受非預設的 `temperature`**（回 400）[ANT-O55-MIG]。
   - 02 文件 §6.5 提議「用不同 temperature 做兩次評分」，在這兩個模型上做不到。
   - 改成「兩位不同的評分者」：用不同模型，或用不同的評分框架。
8. **成本估算**（基準情境，§3）：

   | 項目 | 基準 | 思考 token 減半～加倍的範圍 |
   |---|---|---|
   | 建題庫一次性 | 約 **US$1,166（約 NT$37,000）** | US$900–1,700 |
   | 每位學生每月（一般用量） | 約 **US$4.5（約 NT$142）** | US$3.6–6.3 |
   | 手寫作文一份（OCR＋雙評） | 約 **US$0.25（約 NT$7.8）** | — |

9. **Anthropic 每月花費上限會卡住營運規模。** 各用量級距的上限是 Start $500、Build $1,000、Scale $200,000 [ANT-RL]。
   - 建題庫一次就超過 Start 的上限，必須分月跑，或先申請升級。
   - 以一般用量計，Start 只能服務約 110 位學生，Build 約 220 位。
10. **Cloudflare Worker 的做法：**
    - 用官方 TypeScript SDK（官方列為支援 Cloudflare Workers）[ANT-TS]。
    - 金鑰用 `wrangler secret put ANTHROPIC_API_KEY` 存 [CF-SECRET]。
    - 對話用 SSE 串流。
    - `ctx.waitUntil()` 只在回應送出後再多給 30 秒 [CF-CTX]，所以作文批改這類長任務改用 Queues，consumer 最長可跑 15 分鐘 [CF-Q-LIMIT]。
    - 免費方案每個請求只有 10 ms CPU、50 個 subrequest [CF-LIMITS]，建議用 Workers Paid。
11. **對話紀錄只能往後加。** 2026-08-31 00:00 UTC 之後建立的帳號，只要改動過歷史訊息再把思考區塊送回去，API 會回 400 [ANT-THINK] [ANT-PT]。
12. **額度控管沿用 Sekai Center 的三層，但改單位：**
    - 沿用：任務型端點、每人每日上限、全站保護網。
    - 單位從「次數」改成「依成本加權的點數」。
    - 全站上限改成**以實際 usage 換算的美元預算**。
    - 最後一道防線是 Anthropic workspace 的 spend limit [ANT-WS]。

---

## 1. 可用模型、價格與能力

### 1.1 模型一覽（2026-10-07）

| 模型 | API ID | 發布 | 退役承諾 | Context | 最大輸出（同步） | 思考 | 預設 effort | 相對延遲 | 本專案用途 |
|---|---|---|---|---|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | — | 不早於 2027-09-01 | 1M | 128K | Adaptive（一律開啟） | `high` | Slower | 不預設使用 |
| **Claude Opus 5.5** | `claude-opus-5-5` | 2026-09-22 | 不早於 2027-09-22 | 1M | 128K | Adaptive（一律開啟） | **`medium`** | Moderate | **預設** |
| **Claude Sonnet 5.5** | `claude-sonnet-5-5` | 2026-09-28 | 不早於 2027-09-28 | 1M | 128K | Adaptive（可用 `between_tools` 關掉預先思考） | `high` | Fast | 第二解題者；低成本選項 |
| Claude Haiku 5.5（2026-10-08 查證補列） | `claude-haiku-5-5` | 2026-10-07 | 不早於 2027-10-07 | 1M | 128K | Adaptive（`disabled` 只能搭配 `high` 以下的 effort） | `medium` | Fastest | 候選：大量擷取、分類（要先評測） |
| Claude Haiku 4.5 | `claude-haiku-4-5`（`claude-haiku-4-5-20251001`） | — | **不早於 2026-10-15** | 200K | 64K | Extended（`budget_tokens`） | 不支援 | — | 不使用 |

來源：[ANT-MODELS] [ANT-O55] [ANT-S55] [ANT-H55] [ANT-H55-NEW] [ANT-DEPR]。2026-10-08 的官方比較表已經改列 Haiku 5.5（Fastest），Haiku 4.5 移到 legacy 清單，所以 Haiku 4.5 的延遲欄改成「—」。

- 舊模型仍可使用，包括 Opus 5（$5／$25）、Sonnet 5（$2／$10）、Opus 4.8 等 [ANT-MODELS] [ANT-PRICE]。新專案沒有理由選它們。
- 所有現行模型都支援文字和圖片輸入、文字輸出、多語言、視覺和工具呼叫 [ANT-MODELS]。
- 所有 active 模型都支援 PDF [ANT-PDF] 和 Message Batches [ANT-BATCH]。
- Opus 5.5 和 Sonnet 5.5 都支援結構化輸出 [ANT-SO]。2026-10-08 版的支援清單也列入了 `claude-haiku-5-5`。
- 在 Batches API 加上 `output-300k-2026-03-24` beta 標頭，Opus 5.5 和 Sonnet 5.5 的輸出上限可到 300K [ANT-MODELS]。本專案用不到。
- 模型的能力可以用 Models API（`GET /v1/models/{id}`）即時查詢，回傳的 `max_input_tokens`、`max_tokens`、`capabilities` 都是即時值 [ANT-MODELS]。

### 1.2 價格（每百萬 tokens，美元）

| 模型 | 輸入 | 輸出 | 5 分鐘快取寫入 | 1 小時快取寫入 | 快取讀取 | Batch 輸入 | Batch 輸出 |
|---|---|---|---|---|---|---|---|
| Fable 5.1 | 10 | 50 | 12.50 | 20 | 0.25 | 5 | 25 |
| **Opus 5.5** | **4** | **20** | 5 | 8 | **0.20**（0.05 倍） | **2** | **10** |
| **Sonnet 5.5** | **2** | **10** | 2.50 | 4 | **0.10**（0.05 倍；2026-10-07 版為 0.20） | **1** | **5** |
| Haiku 5.5（prompt ≤100K tokens） | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 | 0.05 | 0.25 |
| Haiku 5.5（prompt >100K tokens） | 0.50 | 2.50 | 0.625 | 1 | 0.05 | 0.25 | 1.25 |
| Haiku 4.5 | 1 | 5 | 1.25 | 2 | 0.10 | 0.50 | 2.50 |
| Opus 5（對照） | 5 | 25 | 6.25 | 10 | 0.50 | 2.50 | 12.50 |

來源：[ANT-PRICE]（Sonnet 5.5 快取讀取與 Haiku 5.5 兩列依 2026-10-08 重新下載的版本）。

**計價規則：**

- **快取倍率**：寫入 5 分鐘版是基本輸入價的 1.25 倍，1 小時版是 2 倍；讀取一般是 0.1 倍，但 Opus 5.5 和 Sonnet 5.5 是 0.05 倍（2026-10-08 版起 Sonnet 5.5 也適用），Fable 5.1 是 0.025 倍。
  - 這些倍率可以和 Batch 折扣疊加 [ANT-PRICE]。
  - Opus 5.5、Sonnet 5.5（以及 Haiku 5.5）的最小可快取長度是 **512 tokens**，不到這個長度就不會快取，也不會報錯 [ANT-CACHE]。
- **長 context 不加價**：Claude 4.6 以後的模型，整個 1M context 都是標準價，900k tokens 的請求和 9k tokens 的請求單價相同 [ANT-PRICE]。**例外是 Haiku 5.5**：prompt 超過 100,000 tokens 時，所有單價都變成 5 倍（見上表）[ANT-PRICE]。
- **`inference_geo: "us"`** 會讓所有 token 價格乘以 1.1 [ANT-PRICE]。本專案不需要，維持預設的 global。
- **工具的額外成本**：請求裡只要有 `tools`，Opus 5.5 和 Sonnet 5.5 就會自動加上 286 tokens 的系統提示（`tool_choice` 為 auto 或 none 時；Haiku 5.5 也是 286，強制 any／tool 時 406）[ANT-PRICE]。結構化輸出也會自動加一段系統提示，但長度沒有公開 [ANT-SO]。
- **網路工具**：
  - Web search 每 1,000 次 $10，另外計算搜尋結果的 token。
  - Web fetch 不另外收費，只算 token。一般 10 kB 的網頁約 2,500 tokens [ANT-PRICE]。
- **Fast mode**：Opus 5.5 的 fast mode 是 $8／$40，只在 Claude API 提供，也不能搭配 Batch [ANT-PRICE]。本專案不需要。

### 1.3 Token 換算（估算用）

- **英文**：
  - 現行 tokenizer 從 Claude Opus 4.7 開始使用，Opus 5.5 和 Sonnet 5.5 都是。官方換算是「1M tokens 約等於 55.5 萬個英文字，或 250 萬個 Unicode 字元」[ANT-MODELS]。
  - 換算下來，**1 個英文字約 1.8 tokens**。
  - 同一段文字，新 tokenizer 比舊的多約 30% [ANT-PRICE]。
- **繁體中文**：官方沒有提供換算。本文件暫時以**1 個漢字約 1 token**估算（未驗證），上線前要用 count_tokens 實測。
- **真題實測樣本**（本專案計算，以 `pdftotext -layout` 抽出的文字計數）：
  - 115 學測英文題本整份約 3,536 個英文字、1,246 個漢字，估約 7,600–8,000 tokens。
  - 113、114 學年度也差不多，分別是 3,382／1,271 和 3,321／1,200（英文字／漢字）。
  - 115 各大題的英文字數（含選項）：

    | 大題 | 英文字數 |
    |---|---|
    | 詞彙題 | 263 |
    | 綜合測驗（每篇） | 265–270 |
    | 文意選填 | 291 |
    | 篇章結構 | 336 |
    | 閱讀測驗（每篇） | 513–549 |
    | 混合題 | 486 |

### 1.4 視覺（圖片）

| 項目 | 規格 | 來源 |
|---|---|---|
| 格式 | JPEG、PNG、GIF、WebP（動畫只讀第一格） | [ANT-VISION] |
| 單張上限 | Claude API 直連 10 MB（base64）；8000×8000 px | [ANT-VISION] |
| 每個請求的張數 | 600 張；200K context 的模型是 100 張 | [ANT-VISION] |
| 超過 20 張 | 每張改用較嚴格的尺寸上限，建議每邊 ≤2000 px | [ANT-VISION] |
| 整個請求 | 32 MB（超過回 413） | [ANT-ERR] |
| 計價 | 視覺 token 數＝⌈寬/28⌉×⌈高/28⌉ | [ANT-VISION] |
| 高解析層（Claude 4.7 以後，含 Opus 5.5、Sonnet 5.5） | 長邊上限 2576 px，每張最多 4,784 視覺 token | [ANT-VISION] |
| 標準層（其他模型，含 Haiku 4.5） | 長邊上限 1568 px，每張最多 1,568 視覺 token | [ANT-VISION] |

**手寫作文照片的成本換算：**

- 用手機拍 A4 作文，縮到 1932×2576 時，視覺 token 是 69×92＝6,348，超過上限，API 會自動等比例縮小，所以實際按 4,784 tokens 計。
- 每張成本：Opus 5.5 約 **US$0.019**，Sonnet 5.5 約 US$0.0096（本文件計算）。
- 1000×1000 的圖片是 1,296 tokens（官方範例）[ANT-VISION]。

**限制和品質：**

- 低畫質、旋轉、或小於 200 px 的圖片可能判讀錯誤 [ANT-VISION]。前端要自動轉正，太模糊就請學生重拍。
- **Claude 不能產生或編輯圖片**，只能理解圖片 [ANT-VISION]。所以：
  - 閱讀測驗的圖表題和表格題，Claude 只輸出資料和圖表規格，由前端繪製。
  - 看圖作文的圖片要另外處理（見 §2.2）。
- 讀圖能力：
  - 官方說 Opus 5.5 不靠工具就能更精確地讀出密集圖表和版面相關圖像的數值 [ANT-O55-NEW]。
  - `claude-api` 技能轉述 Anthropic 的測試：Opus 5.5 即使用 `low`，讀圖表也比 Opus 5 用最高 effort 準 [SKILL]。這句在官方頁面上沒有逐字核對到。
- 官方 FAQ：Anthropic 不會用上傳的圖片訓練模型 [ANT-VISION]。

### 1.5 PDF

- 每個請求上限 32 MB、600 頁；如果請求的 context window 小於 1M，上限是 100 頁 [ANT-PDF]。
- 每一頁會同時當作文字和圖片處理：文字每頁約 1,500–3,000 tokens，再加上圖片 token [ANT-PDF]。
- 本專案的做法：
  - 09 文件的 manifest 顯示，57 份學測／指考題本 PDF 全部可以抽出文字（學測 35 份、指考 22 份，`text_extractable=true`）。2026-10-08 以 `data/exams/manifest.json` 重新計數，結果相同；加上 9 份參考試卷或試辦試卷，共 66 份。
  - 例外（09 文件 §6）：學測 90、92、92 補考、93 和指考 92、93 的中文字會抽成「㈻」「㆗」這類括號字，要先做 NFKC 等正規化；指考 91 第 1 頁的中文說明是亂碼。英文本文不受影響。
  - 所以結構化歷屆題本時**送抽出的文字，不送 PDF**，省掉每頁的圖片 token。
  - 只有含圖的頁面（看圖作文、圖表題）才把那一頁轉成 PNG，走視覺。

### 1.6 Opus 5.5／Sonnet 5.5 會影響本專案的 API 規則

| # | 規則 | 對本專案的影響 | 作法 | 來源 |
|---|---|---|---|---|
| 1 | **Opus 5.5 的思考不能關**：`thinking:{type:"disabled"}` 或 `budget_tokens` 會回 400；只能用 `effort` 控制，預設是 `medium` | 每個任務都會有思考 token | 每個任務都明確設定 `effort`；要省成本先調降 effort，不要用提示詞要求「少想一點」 | [ANT-O55-MIG] [ANT-EFFORT] |
| 2 | **Sonnet 5.5** 送 `disabled` 會回 400；最低設定是 `between_tools`，只能搭配 `high` 以下的 effort | 想用 Sonnet 5.5 又不要思考時用這個 | 對話類任務先試 adaptive 加 `low` effort | [ANT-S55-NEW] |
| 3 | 思考 token **照輸出價計費**，也算進 `max_tokens` | `max_tokens` 太小會截斷回答 | 設定 `max_tokens` 時要把思考的空間算進去；成本估算也把思考算進輸出 | [ANT-THINK] |
| 4 | 思考內容的 `display` 預設是 `"omitted"`：思考區塊的文字是空的，但保留 signature | 串流時前端會先停頓一段時間 | 前端顯示「思考中」的動畫；不需要把思考內容給學生看 | [ANT-THINK] |
| 5 | **強制 `tool_choice`（`any`／`tool`）會回 400**。Messages、Batches、count_tokens 都一樣 | 出題和批改不能靠強制工具呼叫拿 JSON | 改用 `output_config.format`（JSON schema） | [ANT-O55-MIG] |
| 6 | `temperature`、`top_p`、`top_k` 設成非預設值會回 400 | 02 文件 §6.5 的「用不同 temperature 雙閱」做不到 | 第二位評分者改用不同模型，或用不同的評分框架 | [ANT-O55-MIG] |
| 7 | 不能在 `messages` 最後放 assistant 預填（prefill） | 不能用預填 `{` 的方式逼模型輸出 JSON | 用結構化輸出 | [ANT-O55-MIG] |
| 8 | **拒答**：HTTP 200，`stop_reason:"refusal"`，`stop_details.category` 標出類別（Opus 5.5 有 `cyber`、`bio`、`reasoning_extraction`） | 先檢查 `stop_reason`，再讀 `content` | 同步呼叫加上 `fallbacks:"default"`，並帶 beta 標頭 `server-side-fallback-2026-07-01`。**Batch 不支援 fallbacks**，帶了那一筆會變成 errored；要自己收集被拒的項目，換模型重送。**Haiku 5.5 沒有 server-side fallback**，只能自己重送 [ANT-H55-NEW] | [ANT-REFUSAL] [ANT-O55-MIG] |
| 8a | **拒答也可能收費**（2026-10-08 查證補充）：輸出前就拒答時，類別是 `bio`、`frontier_llm`、`reasoning_extraction` 的會照一般請求計費，其他類別不收費；中途拒答則收輸入和已串流的輸出。用了 fallback 時，觸發 fallback 的那次拒答（符合上述條件時）和 fallback 請求都要付費 | 帳本和點數退還規則要依類別處理，不能一律當成 0 元 | 依實際 `usage`（有 fallback 時看 `usage.iterations`，見 §5.2(d)）結算成本；給學生的點數可以照退，但站內成本照記 | [ANT-REFUSAL] |
| 9 | 要求模型把內部推理寫進回答，可能被判定為 `reasoning_extraction` 而拒答（這一類在輸出前拒答也會收費，見 #8a；官方說這一類沒有建議的 fallback 模型，要改提示詞而不是重送） | schema 不要有「逐步推理」這種欄位 | 欄位取名 `explanation_zh`，內容是「簡短解析」 | [ANT-SO] [ANT-REFUSAL] |
| 10 | **Preserved thinking**：思考區塊只在 `system`、`tools` 和之前的訊息都沒改動時有效。2026-08-31 00:00 UTC 之後建立的帳號預設強制檢查，改了就回 400 | 本專案的 Anthropic 帳號如果是新開的，就一定受影響 | 對話紀錄只往後加；assistant 回傳的 `content`（含思考區塊）原樣存、原樣送回 | [ANT-THINK] [ANT-PT] [ANT-ERR] |
| 11 | **結構化輸出的限制**：不支援 `minLength`、`maxLength`、`minimum`、`maximum`、遞迴 schema；`minItems` 只能是 0 或 1；整個請求的可選參數總共最多 24 個、union 型別最多 16 個；物件都必須設 `additionalProperties:false`；`enum` 的大小寫不保證；第一次用某個 schema 會有編譯延遲，編譯結果快取 24 小時；不能和 citations 一起用；可以用在 Batch | 題目的「空格數」「選項數」不能交給 schema 強制 | 欄位一律列為 required；數量和長度用程式驗證；`enum` 比對不分大小寫 | [ANT-SO] |
| 12 | Haiku 4.5 退役日期是「不早於 2026-10-15」 | 不要建立新的依賴 | Sekai 的審核功能用的是 `claude-haiku-4-5-20251001`（`worker/wrangler.toml:94`），搬過來時要換掉。同級的後繼是 `claude-haiku-5-5`，但換過去會碰到這些破壞性變更：`budget_tokens`、非預設 `temperature`、assistant 預填都會回 400；思考預設開啟，`max_tokens` 要把思考算進去；同一段文字的 token 數約多 30%。另外 Haiku 5.5 仍接受強制 `tool_choice`，只是那次回應不會思考 | [ANT-DEPR] [ANT-H55-NEW] [ANT-H55-MIG] |
| 13 | 對話中途要加指示時，可以在 `messages` 裡加一則 `role:"system"` 訊息，不用改最上層的 `system`。Opus 5.5 和 Sonnet 5.5 都支援，不需要 beta 標頭 | 例如切換「提示模式／詳解模式」 | 用中途 system 訊息，快取和思考區塊都不會失效 | [ANT-MIDSYS] |

### 1.7 速率上限和花費上限

**Messages API 的速率上限**（Opus 5.5 和 Sonnet 5.5 的數字相同，各自獨立計算，不共用額度；2026-10-08 版加入的 Haiku 5.5 在各級距也是同樣的數字）[ANT-RL]：

| 用量級距 | RPM | ITPM（輸入 tokens／分） | OTPM（輸出 tokens／分） | 每月花費上限 |
|---|---|---|---|---|
| Start | 1,000 | 2,000,000 | 400,000 | **$500** |
| Build | 5,000 | 5,000,000 | 1,000,000 | **$1,000** |
| Scale | 10,000 | 10,000,000 | 2,000,000 | $200,000 |

- 大部分模型（含 Opus 5.5、Sonnet 5.5）讀快取的 token **不計入 ITPM** [ANT-RL]。所以快取同時能省錢、又能提高吞吐量。
- 新組織可能先被放在 Evaluation tier，上限比上表低，會隨使用紀錄自動調升 [ANT-RL]。
- 使用量急遽增加時，可能觸發 acceleration limit 而收到 429，所以流量要逐步放大 [ANT-RL]。
- **Batches API 有自己的上限**，所有模型共用 [ANT-RL]：

  | 用量級距 | RPM | 處理中佇列上限 | 每批上限 |
  |---|---|---|---|
  | Start | 1,000 | 200,000 筆 | 100,000 筆 |
  | Build | 2,000 | 300,000 筆 | 100,000 筆 |
  | Scale | 4,000 | 500,000 筆 | 100,000 筆 |

- **碰到級距的每月花費上限**：回 HTTP 429，`error.details.error_code` 是 `enforced_spend_limit_reached`，**沒有 `retry-after` 標頭**。在下個月 1 日 00:00 UTC 之前，重試都會失敗 [ANT-RL]。
- **碰到自己設的 spend limit**（組織或 workspace 層級）：回 HTTP 400 `invalid_request_error`，訊息開頭是「You have reached your specified …API usage limits」[ANT-RL]。
- **Workspace 層級的限制**：
  - 每個 workspace 可以各自設定 RPM、ITPM、OTPM，以及每月花費上限和提醒門檻 [ANT-WS]。
  - Default Workspace 不能設這些限制 [ANT-RL]。
  - API key 可以只綁定單一 workspace [ANT-WS]。
  - 快取是**按 workspace 隔離**的 [ANT-CACHE]。

---

## 2. 各功能的建議模型和呼叫方式

### 2.0 總覽

| 功能 | 誰觸發 | 模型 | effort（起點，要做 sweep） | API | 輸出 | 快取 |
|---|---|---|---|---|---|---|
| 出題：詞彙題、綜合測驗、文意選填、篇章結構、閱讀、混合題、中譯英、作文題＋範文 | GitHub Actions 排程 | Opus 5.5 | `high`（先比較 `medium`／`high`／`xhigh`） | **Batch** | JSON schema | 共用前綴；TTL 依命中率選（§2.1） |
| 驗證 A：盲解 | 同上 | **Sonnet 5.5** | `medium` | Batch | JSON schema | — |
| 驗證 B：盲解 | 同上 | Opus 5.5 | `medium` | Batch | JSON schema | — |
| 驗證 C：干擾選項稽核 | 同上 | Opus 5.5 | `medium` | Batch | JSON schema | — |
| 單字資料增補 | 一次性＋之後增量 | Opus 5.5（Sonnet 5.5 要先試做評測，由使用者決定） | `low` | Batch | JSON schema | system 前綴 |
| 歷屆題本結構化 | 一次性 | Opus 5.5 | `low` | Batch | JSON schema | system 前綴 |
| 手寫作文 OCR | 學生上傳照片 | Opus 5.5 | `low` | 即時（輸出短，不必串流） | JSON schema | — |
| 作文批改（含第二位評分者） | 學生確認文字後 | Opus 5.5 | `medium` | 即時：Queue 背景執行；「慢速批改」走 Batch | JSON schema | 評分基準當前綴 |
| 中譯英批改 | 學生送出答案 | Opus 5.5 | `medium` | 即時 | JSON schema | 評分基準當前綴 |
| 解析追問、錯題講解 | 學生點擊 | Opus 5.5（和 Sonnet 5.5 做 A/B 測試） | `low` | 即時**串流** | 文字 | 題目前綴＋自動快取 |

**為什麼不分很多個模型：**

- `claude-api` 技能的建議是：在建立多模型分流之前，先量「最強模型配低 effort」這個較簡單的做法 [SKILL]。
- `claude-api` 技能轉述 Anthropic 的測試結果 [SKILL]（官方頁面上沒有逐字核對到）：
  - 在程式設計和知識工作評測上，Opus 5.5 用 `medium` 超過 Opus 5 用 `high`。
  - 在幾項程式設計評測上，`low` 也接近這個水準。
- 官方頁面只寫了「預設 effort 是 `medium`，請明確設定並重做 sweep」[ANT-O55-NEW] [ANT-EFFORT]。
- 所以除了「獨立驗證」需要第二個模型，其他功能都先用 Opus 5.5。
- Sonnet 5.5 的單價正好是 Opus 5.5 的一半。原稿寫「快取讀取同為 $0.20」，但 2026-10-08 的價目表已把 Sonnet 5.5 的快取讀取降為 $0.10，所以現在連快取讀取也是一半 [ANT-PRICE]。凡是寫「可改用 Sonnet 5.5」的地方，那一項的成本大約減半；但要先過品質評測才能換。
- Haiku 5.5 的單價約是 Opus 5.5 的 1/40（prompt ≤100K tokens 時）[ANT-PRICE]。官方建議它用在分類、擷取、路由 [ANT-H55]。本專案可以評測的地方有：單字增補（§2.4）、題目的第三位盲解者（§2.3）、混合題簡答的寬鬆比對。出題、批改、家教對話這些品質敏感的任務，先不考慮。

### 2.1 共通架構：離線內容管線和線上任務端點

```
【離線：共用內容，生成一次、全站共用】
 GitHub Actions（cron）
   ① 素材蒐集：授權白名單來源（見 04 文件）→ 事實摘要與來源網址
   ② 出題請求：組裝 Batch，建立前先估成本，超過預算就不送
   ③ 收取結果：另一支排程每 30 分鐘檢查一次，狀態為 ended 才下載
   ④ 程式檢查：格式、空格數、選項、詞彙級別、答案分布
   ⑤ 驗證 Batch：盲解 A、盲解 B、干擾選項稽核
   ⑥ 判定：通過／退回重生／淘汰 → 人工抽審
   ⑦ 上架：寫入 D1（透過 wrangler d1 或 Worker 的管理端點）

【線上：個人化，依點數計費】
 瀏覽器 → Worker 任務端點（/api/ai/essay-ocr、/essay-grade、/translation-grade、/explain-chat）
   → 驗證身分 → 預扣點數 → 呼叫 Claude（串流或 Queue）→ 依 usage 結算 → 寫入 D1
```

**Batch 的幾個重點**（[ANT-BATCH]）：

- **單筆限制**：每批最多 100,000 筆或 256 MB；每筆的 `max_tokens` 至少要是 1；不能用 `stream:true`、`speed` 和 `max_tokens:0`。
- **時間**：大部分批次在 1 小時內完成；24 小時內沒處理完的會 **expired**。
- **結果**：保留 29 天，**回傳順序不固定**，必須用 `custom_id` 對應。
- **`custom_id` 格式**：必須符合 `^[a-zA-Z0-9_-]{1,64}$`。建議格式是 `{題型}-{難度}-{主題}-{流水號}-v{版本}`，例如 `cloze-t2-sdg13-000123-v1`。
- **不收費的情況**：`errored`、`canceled`、`expired` 都不收費。
- **花費上限**：批次可能稍微超過 workspace 設定的 spend limit，所以預算要留緩衝。
- **拒答**：被拒的那筆會以 `result.type:"succeeded"`、`stop_reason:"refusal"` 回來。要自己收集起來，換模型重送 [ANT-REFUSAL]。

**GitHub Actions 的時間限制：**

- GitHub 代管的 runner，每個 job 最多跑 6 小時 [GH-LIMITS]。
- Batch 最長可能要 24 小時，所以**不要在同一個 job 裡等結果**。
- 拆成兩支 workflow：
  - **submit**：建立 batch，把 batch id 記錄到 D1 或 repo。
  - **collect**：用 cron 定時檢查，處理完就下載結果。
- 也可以改用 Worker 的 Cron Trigger 來收結果。牆鐘時間上限是 15 分鐘，但 **CPU 時間另有上限**（2026-10-08 查證補充）：Workers Paid 的排程間隔小於 1 小時時只有 30 秒，間隔 1 小時以上才有 15 分鐘；免費方案只有 10 ms [CF-LIMITS]。
  - 所以「每 30 分鐘收一次」如果放在 Worker Cron，解析大批結果的 JSON 可能超過 30 秒 CPU。
  - 建議收取仍放在 GitHub Actions；要用 Worker Cron 的話，排程改成每小時一次，或每次只處理一部分結果。

**送出前先估成本：**

- 用 token counting API 算輸入量，它免費，只受 RPM 限制 [ANT-TOKEN]。
- 輸出用 `max_tokens` 當上限，再乘上 Batch 單價。
- 超過 `AI_BATCH_BUDGET_USD` 就不送出。

**Batch 搭配快取划不划算**（本文件計算）：

- 官方說 Batch 裡的快取命中是盡力而為，命中率通常在 30%–98% 之間；官方建議 Batch 考慮用 1 小時 TTL [ANT-BATCH]。
- 但 1 小時 TTL 的寫入是 2 倍價，命中率太低反而更貴。以 Opus 5.5 計算的損益兩平點：
  - 5 分鐘 TTL：命中率要超過 **21%** 才划算。
  - 1 小時 TTL：命中率要超過 **51%** 才划算。
  - 公式：(1−h)×寫入倍率＋h×0.05 ＜ 1。
- 出題請求的輸入只占成本約 16%（以綜合測驗為例），所以快取最多省一成多。
- **建議**：
  - 第一批先用 5 分鐘 TTL，每筆請求的前綴要完全相同，並讓請求連續送入。
  - 查看 `usage.cache_read_input_tokens` 的實際命中率，再決定要不要改成 1 小時 TTL。
  - §3 的成本估算**完全不計 Batch 的快取效益**（保守估計）。

### 2.2 批次出題

#### 2.2.1 提示詞的組成（可快取的前綴放前面，變動的部分放後面）

快取是前綴比對，順序是 `tools` → `system` → `messages`。前綴裡任何一個位元組變了，後面的快取全部失效 [ANT-CACHE]。依序排列如下：

1. **固定 system（每種題型一份，跨請求完全相同）**
   - 命題角色。
   - 大考中心各大題的測驗目標，逐字引自 02 文件 §2.2。
   - 108 課綱要點，引自 01 文件。
   - 三種難度的規格：
     - 穩定基礎、進階練習、超越頂標。
     - 各自規定詞彙級別比例、句長、考點類型。
     - 設計依據是 02 文件 §6.4 和 03 文件的詞彙級別。
   - 輸出規則：解析用繁體中文、不能有第二個正解、選項詞性和長度要一致、不得照抄來源文章。
2. **固定 few-shot（每種題型 1–2 組真題）**
   - 附大考中心公布的答對率和鑑別度。09 文件列出學測 91–115、指考 91–110 都有逐題統計。
   - 用途是讓模型對齊難度。
   - 在這一段結尾設 `cache_control`。
3. **變動部分（放在最後一個快取斷點之後）**
   - 主題，例如 SDG 13。
   - 素材事實摘要，加上來源網址。
   - 難度等級、目標考點清單、需要避開的近期已出題詞彙。

**不要放進前綴的東西**：時間戳記、請求 id、會隨機排序的 JSON。這些都會讓快取每次失效 [ANT-CACHE]。

#### 2.2.2 Schema 設計原則（以綜合測驗為例）

- **所有欄位都列為 `required`**。理由有三：
  - 可選參數全請求加起來最多 24 個 [ANT-SO]。
  - 輸出時 required 欄位會排在前面 [ANT-SO]。
  - 全部 required 最不容易出錯。
- **數量和長度不交給 schema**。例如「剛好 5 個空格」「每題 4 個選項」：`minItems` 只能是 0 或 1，所以一律由程式驗證 [ANT-SO]。
- **用 `enum` 限制範圍**：答案代號、考點類型、難度都用 enum；但比對時不分大小寫 [ANT-SO]。
- **解析欄位叫 `explanation_zh`**，內容要求「簡短解析」，不要叫「推理過程」，以免觸發拒答 [ANT-SO]。
- **每個題型一份 schema**。改了 schema 會讓已編譯的語法快取和 prompt 快取失效 [ANT-SO]。

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["title", "passage", "blanks", "translation_zh", "topic_tags", "source_urls"],
  "properties": {
    "title": { "type": "string" },
    "passage": { "type": "string", "description": "以 __1__ 到 __5__ 標示空格" },
    "blanks": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["no", "test_point", "options", "answer", "explanation_zh", "distractor_notes_zh", "target_level"],
        "properties": {
          "no": { "type": "integer" },
          "test_point": { "type": "string", "enum": ["grammar", "vocabulary", "phrase", "collocation", "connector"] },
          "options": { "type": "array", "items": { "type": "string" } },
          "answer": { "type": "string", "enum": ["A", "B", "C", "D"] },
          "explanation_zh": { "type": "string" },
          "distractor_notes_zh": { "type": "array", "items": { "type": "string" } },
          "target_level": { "type": "integer" }
        }
      }
    },
    "translation_zh": { "type": "string" },
    "topic_tags": { "type": "array", "items": { "type": "string" } },
    "source_urls": { "type": "array", "items": { "type": "string" } }
  }
}
```

#### 2.2.3 各題型的重點

| 題型 | 一次請求產出 | 關鍵欄位 | 程式檢查 |
|---|---|---|---|
| 詞彙題 | 10 題 | 題幹、4 個選項、答案、目標字和級別、解析、每個干擾選項的說明 | 目標字在詞彙表裡、級別符合難度、4 個選項詞性相同 |
| 綜合測驗 | 1 篇 5 空格（真題每篇約 265–270 字，含選項） | `test_point` 標示文法／字彙／片語／搭配詞／轉折詞 | 剛好 5 個空格、題號連續、選項不重複 |
| 文意選填 | 1 篇 10 空格，選項 A–J 共 10 個 | 每格的詞性要求、上下文線索、連接詞、篇章連貫的解析 | 每個選項只能用一次；選項的詞性分布要能區分各空格 |
| 篇章結構 | 4 空格，5 個選項（115 起的格式，見 02 文件 §2.2） | 每格的銜接線索；**多出來的那個選項為什麼放哪裡都不對** | 5 個選項都是完整句子；多出的選項和每個空格都不相容 |
| 閱讀測驗 | 1 篇 4 題 | `format`：`prose`／`chart`／`table`／`multi_text`；圖表題輸出 `chart_spec`（類型、標籤、數列），由前端繪製；能力標籤：上下文推測生難字詞、主旨、細節、推論、統整；生難字詞表 | 圖表數字和文章內容一致；每題能在文中找到依據 |
| 混合題 | 1 個題組，含填充、多選、簡答 | `accepted_variants`（可接受的答案寫法）；評分規則照 02 文件 §4.2：全對 2 分、字形或拼字錯 1 分、其他 0 分 | 簡答答案的字數；能找到原文依據 |
| 中譯英 | 5 句 | 中文句子、標的詞彙（以 1–4 級為主，見 02 文件 §4.3）、句型、2–3 個參考譯文；切成 4 個部分各 1 分（設計假設，見 02 文件 §6.5）；常見錯誤 | 標的詞彙出現在參考譯文裡 |
| 作文題目＋範文 | 1 題＋2 篇範文 | 題型：看圖／信函／主題／圖表；範文要有細節和個人經驗，並靈活運用連接詞、片語、句型，逐一標註；附大綱和依評分指標的自評 | 範文至少 120 字；有分段；標註的連接詞真的出現在範文裡 |

**看圖作文的圖片：**

- Claude 不能產生圖片 [ANT-VISION]。
- 它只能輸出「分格的圖片描述」，圖片本身要另外處理：人工繪製、使用授權圖庫，或改成以文字、表格呈現的情境。目前還沒決定（未驗證）。

**素材來源：**

- 照 04 文件的主策略：「以多來源的事實為素材，由 Claude 寫成原創文章，再附上參考連結」。
- 素材建議由程式依授權白名單抓取並整理成事實摘要，再交給 Claude。
- 也可以讓 Claude 自己用 `web_search`／`web_fetch`，並用 `allowed_domains` 限制網域。費用是每 1,000 次搜尋 $10，加上抓回內容的 token [ANT-PRICE]。
  - 注意：在 Batch 裡，web search 會依組織被節流，大批次會跑比較久 [ANT-BATCH] [ANT-WEBSEARCH]。
  - 工具版本（2026-10-08 查證補充）：`web_search_20260209` 以後的版本（最新是 `web_search_20260318`）和 `web_fetch_20260209` 以後的版本（最新是 `web_fetch_20260318`）有「dynamic filtering」，會先用程式篩掉不相關的內容再放進 context，可以省 token。Claude 4.6 以後的模型都支援 [ANT-WEBSEARCH] [ANT-WEBFETCH]。
  - `allowed_domains` 和 `blocked_domains` 只能擇一，兩個都給會回 400 [ANT-WEBSEARCH]。
  - **web fetch 只能抓對話裡出現過的網址**：可以是 user 訊息、工具結果裡的網址。只寫在 system prompt 裡、或只出現在 Claude 自己輸出裡的網址都抓不到。它也會遵守 `robots.txt`，被擋時回 `url_not_allowed` [ANT-WEBFETCH]。所以白名單文章的網址要放在 user 訊息裡。

**effort 的選擇：**

- 官方建議用自己的評測做 effort sweep，不要沿用舊模型的設定 [ANT-EFFORT]。
- 官方也提醒：同一個 effort 等級下，Opus 5.5 每回合的思考量往往比 Opus 5 多，在 `xhigh`、`max` 最明顯，所以 `max_tokens` 要留空間 [ANT-O55-NEW]。§3 的思考 token 假設要用這個角度實測。
- 建議做法：每種題型先各出 30 組，分別用 `medium` 和 `high`，比較驗證通過率和人工審核結果，選最便宜而且合格的那一級。
- **「低 effort 先跑、失敗才用高 effort 重跑」**（2026-10-08 查證補充）：官方的成本指南說，結果能自動檢查的任務，最便宜的做法通常不是固定一個 effort，而是全部先用低 effort 跑，只把失敗的用高 effort 重跑 [ANT-COSTINTEL]。
  - 官方實測（SWE-bench Pro 子集）：Opus 5.5 全用 `low` 時 13% 失敗；把失敗的用 `high` 重跑，通過率約 97%，每題約 $0.17。全部用 `high` 是 95.3%、每題約 $0.29 [ANT-COSTINTEL]。
  - 本專案的出題有程式檢查和盲解驗證，結果是可以檢查的，所以適用。§2.3 的「退回重生」可以改成用較高 effort 重生。這是程式評測的數據，用在出題上的效果要自己實測。
- `xhigh`／`max` 只用在有實測證據的地方 [SKILL]。

#### 2.2.4 程式範例：建立和收取 Batch（Node 22，GitHub Actions 執行）

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // 從 GitHub Actions secret 讀取 ANTHROPIC_API_KEY

// 送出
const batch = await client.messages.batches.create({
  requests: jobs.map((j) => ({
    custom_id: j.id, // 例：cloze-t2-sdg13-000123-v1
    params: {
      model: "claude-opus-5-5",
      max_tokens: 32000, // 要容納思考加上輸出
      output_config: { effort: "high", format: { type: "json_schema", schema: CLOZE_SCHEMA } },
      system: [{ type: "text", text: GEN_SYSTEM_CLOZE, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: renderJob(j) }],
    },
  })),
});

// 收取（另一支排程執行）
const b = await client.messages.batches.retrieve(batchId);
if (b.processing_status === "ended") {
  for await (const r of await client.messages.batches.results(batchId)) {
    if (r.result.type === "succeeded") {
      const m = r.result.message;
      if (m.stop_reason === "refusal") { /* 記下來，之後換模型重送 */ continue; }
      if (m.stop_reason === "max_tokens") { /* JSON 可能不完整，提高 max_tokens 後重送 */ continue; }
      const text = m.content.find((c) => c.type === "text");
      // JSON.parse(text.text) → 程式驗證 → 進入驗證佇列；同時記錄 m.usage
    } else {
      // errored／expired／canceled：不收費，修正後重送
    }
  }
}
```

寫法依據：`claude-api` 技能的 TypeScript batches 範例 [SKILL]，以及官方結構化輸出的請求格式 [ANT-SO]。`stop_reason:"max_tokens"` 時輸出可能不符合 schema，官方建議提高 `max_tokens` 後重試 [ANT-SO]。

### 2.3 題目驗證

**流程**：程式檢查 → 兩位盲解者 → 干擾選項稽核 → 判定 → 人工抽審。

1. **程式檢查（不花 token）**
   - 格式、空格數、選項數。
   - 文意選填的每個選項只能用一次。
   - 詞彙級別比例：用 `data/vocab/ceec-wordlist.json` 比對。
   - 答案代號在題庫裡的分布。
   - 文章長度。
   - 解析裡引用的原文必須逐字出現在文章裡。
2. **盲解 A（Sonnet 5.5）和盲解 B（Opus 5.5）**
   - 兩位都只看得到學生看到的內容，答案、解析、出題時的思考區塊都拿掉。
   - 每次都是全新的請求。
   - 圖表題給**前端繪出的 PNG**，不給原始資料，順便檢查圖表本身看不看得懂。
   - 輸出：每題選的答案、信心等級（enum）、「其他也說得通的選項」清單、文中證據的原句。
3. **干擾選項稽核（Opus 5.5，看得到答案）**
   - 每個錯誤選項都要判定：
     - verdict（enum）：`clearly_wrong`（明確錯誤）或 `arguably_acceptable`（可能也對）。
     - 錯在哪一類：文法、搭配、語意、邏輯／連貫、詞性。
     - 上下文中使它錯誤的那一句原文。
4. **判定規則**
   - **通過**：兩位盲解者的答案都等於標準答案，沒有任何選項被標成 `arguably_acceptable`，而且所有證據句都能在原文逐字找到。
   - **其他情況**：把稽核意見附回去重生一次；連續兩次不過就淘汰。
   - **文意選填**：盲解者必須給出 10 格的完整配對，而且和答案完全一樣。
   - **混合題的簡答**：先用程式比對 `accepted_variants`，比不到再交給 Opus 5.5 判定。
5. **人工抽審**
   - 上線初期，「超越頂標」的題目全部人工審，其他難度抽 10%。
   - 審核結果記錄下來，用來校正規則。

**限制**：模型解題的成功率**不能拿來衡量難度**。上線後要用學生的作答資料（答對率、鑑別度）重新校正難度標籤。這件事要另外設計（未驗證）。

**成本**：每個 5 題題組驗證約 US$0.11（§3.2）。基礎難度如果改成只用一位盲解者，可以省約四成；要不要這樣做，請使用者決定。

**可評測的選項（2026-10-08 查證補充）**：再加一位 Haiku 5.5 盲解者，每組約 US$0.001（Batch，思考量假設與盲解 A 相同，本文件估算）。用途是多一個不同模型的訊號，例如三位裡有一位選錯，就把題目送人工抽審。Haiku 5.5 的定位不是難題推理 [ANT-H55]，所以它答錯不一定代表題目有問題；同樣不能拿來衡量難度。

### 2.4 單字資料增補（同義詞、多義詞、搭配詞、片語、例句、中文釋義）

**範圍：**

- 詞彙表共 **6,012 筆**，每級 1,002 筆（03 文件，本專案解析結果）。
- 使用者需求是「以 Level 3–5 為主力」，這三級共 3,006 筆（03 文件）。可以先增補這 3,006 筆，成本約是下表 6,012 筆的一半。
- 原稿寫「任務說明寫『約 7,000 字』」，但目前的需求說明裡找不到這個數字（未驗證）。下面仍保留 7,000 字的試算，當作把片語、衍生詞或詞表外高頻字也算進去時的上限。

**分工：**

| 工作 | 由誰做 | 理由 |
|---|---|---|
| 重要度：歷屆出現次數、出現在哪些大題、年份分布、近 10 年加權 | **程式**，從結構化的歷屆題庫計算 | 計數不該交給 LLM |
| 基本釋義、音標 | ECDICT（MIT 授權，見 04 文件） | 已有授權明確的資料 |
| 多義（各詞義、詞性）、同義與近義辨析、搭配詞、片語、原創例句、中文釋義潤飾、易混淆字 | **Claude** | 這是 LLM 擅長的語言知識整理 |
| Cambridge 辭典 | **只提供外連網址**，例如 `https://dictionary.cambridge.org/dictionary/english-chinese-traditional/{slug}` | 條款禁止爬取和建立資料庫；不能把 Cambridge 的內容餵給 Claude（04 文件 §2.2） |

**請求設計：**

- 每個字一個請求，`custom_id` 用 `vocab-{level}-{lemma}`，方便重試。
- 輸入：
  - system 約 3,000 tokens（規則加 2 個範例），可快取。
  - 每個字約 400 tokens：詞條、級別、詞性、ECDICT 釋義、最多 5 句歷屆真題原句（附年份和大題）、程式算好的統計數字。
- 輸出：JSON。例句標示為「AI 生成」（04 文件也這樣建議）。

**模型：**

- 預設 Opus 5.5，effort `low`，走 Batch。
- 先各抽 200 個字，比較 Opus 5.5 和 Sonnet 5.5 的人工審核結果，再由使用者決定要不要全面改用 Sonnet 5.5。
- Haiku 5.5（2026-10-08 發布）也一起放進這 200 字的比較。這個任務接近「擷取＋整理」，正是官方說 Haiku 5.5 適合的工作 [ANT-H55]；但多義、近義辨析和原創例句的品質要看人工審核結果。

**驗證：**

- 程式檢查：例句裡一定要出現詞條或它的變化形；詞性欄位要在詞表的詞性範圍內。
- 再用 Sonnet 5.5 複核一次，標出可疑的釋義和搭配。
- 人工抽查 5%。

**成本**（§3.2、§3.3）：

| 方案 | 6,012 字 | 7,000 字 |
|---|---|---|
| Opus 5.5 增補（每字 US$0.025）＋Sonnet 5.5 複核 | 約 **US$190** | 約 US$221 |
| 全部改用 Sonnet 5.5 | 約 US$115 | — |
| Haiku 5.5 增補（每字約 US$0.0006）＋Sonnet 5.5 複核（2026-10-08 補列，品質未評測） | 約 US$45（增補本身約 US$3.7） | 約 US$52 |
| 只做 Level 3–5（3,006 筆），Opus 5.5 增補＋Sonnet 5.5 複核 | 約 US$95 | — |

### 2.5 作文 OCR 與批改

**流程：**

1. **前端**
   - 拍照或選圖後自動轉正，縮到長邊 ≤2576 px，用適中的 JPEG 品質壓縮，建議每張 ≤2 MB。
   - 長邊超過 2576 px 會被 API 自動縮小，只是白白增加上傳量 [ANT-VISION]。
   - 壓縮太重會讓文字看不清楚 [ANT-VISION]。
2. **Worker**
   - 把照片暫存到 R2，批改完成後依保存期限刪除。R2 的費用見 §4.2（2026-10-08 查證）。
   - 呼叫 OCR：**Opus 5.5，effort `low`，結構化輸出**。規則如下：
     - 逐字轉錄，**保留拼字和文法錯誤，不要修正**。
     - 看不清楚的地方用 `[[?]]` 標記，並提供候選字。
     - 保留分段，刪改痕跡只取最後的版本。
3. **學生確認**
   - 前端顯示轉錄結果，不確定的地方加亮。
   - 學生只修正「辨識錯誤」的地方，然後確認。
   - 系統同時保存 OCR 原文和確認版，以及兩者的差異。
4. **批改**（Queue 背景執行，見 §4.2）
   - system（可快取）：評分角色、115 評分指標（逐字，見 02 文件 §4.4）、111–114 的分數區間、扣分規則（字數明顯不足扣 1 分、未分段扣 1 分、兩者不重複扣）、輸出規則，之後再加上已評分的錨定範文。
   - user：題目、確認版文字、OCR 原文與確認版的差異。手寫作文再附上**原始照片**，並指示「拼字以照片為準」。這樣可以避免學生在確認時順手改掉自己的拼字錯誤（02 文件 §6.5 也提醒過這一點）。
5. **輸出 JSON**
   - 內容、組織、文法句構、字彙拼字四項各 0–5 分，整體分數，等級。
   - 扣分項目。
   - 逐句錯誤：類型、原文、建議改法、說明。
   - 優點、改進建議。
   - 保留學生原意的參考改寫。
   - 建議使用的連接詞、片語、句型。
6. **第二位評分者**
   - 大考中心是兩位委員各自評分、取平均；作文差距超過 5 分就送第三閱（02 文件 §4.4）。
   - 本專案的第二位評分者用 Opus 5.5，但換評分框架：先給整體分數再檢查分項。也可以改用 Sonnet 5.5。
   - 只輸出分數和簡短評語。
   - 兩者差距 >5 分就再評第三次。最後的分數取平均。
   - 因為不能用 temperature 製造差異（§1.6 #6），所以改用這個方式。
   - 中譯英（2026-10-08 查證補充）：大考中心的中譯英也是兩位委員評分，差距超過 2 分送第三閱；02 文件 §6.5 也建議比照辦理。本文件的中譯英批改目前只有一位評分者。如果要雙評，第二位評分者只輸出分數時，每組約再加 US$0.02（假設輸入 600、快取讀取 2,500、輸出 200、思考 800 tokens，本文件估算），差距超過 2 分再評第三次。
7. **存檔**：結果存進 D1，前端呈現。

**每份成本（Opus 5.5，即時；詳見 §3.2）：**

| 項目 | 美元 | 新臺幣 |
|---|---|---|
| OCR（1 張照片） | 0.045 | 1.4 |
| 批改（快取命中／未命中） | 0.125／0.149 | 4.0／4.7 |
| 批改另附原始照片 | ＋0.019 | ＋0.6 |
| 第二位評分者 | 0.057 | 1.8 |
| **手寫作文一份（OCR＋批改附照片＋第二評分）** | **0.25** | **7.8** |
| **打字作文一份（批改＋第二評分）** | **0.18** | **5.8** |
| 第三閱（假設 10% 的作文需要），每份攤提 | ＋0.006 | ＋0.2 |
| 「慢速批改」（批改走 Batch，通常 1 小時內完成）：手寫／打字 | 0.15／0.09 | 4.6／2.9 |

**測試資料：**

- 09 文件收集了 **366 篇英文作文佳作的手寫原卷掃描檔**（學測 98–115、指考 98–110），附官方評分說明。
- 可以用來測 OCR 正確率，但需要先人工轉錄 30–50 篇當標準答案。
- 也可以用來校正評分。但這些全是佳作，分數偏高，還需要另外蒐集中低分樣本（目前沒有）。

**資料保存：**

- Batch 的請求和回應最多保存 29 天，可以呼叫 `DELETE /v1/messages/batches/{id}` 提早刪除 [ANT-BATCH]。
- 未成年學生資料的保存和告知規範，不在本文件範圍（未驗證）。

### 2.6 即時互動（解析追問、錯題講解）

**模型：**

- 預設 Opus 5.5，effort `low`。
- 同時和 Sonnet 5.5 做 A/B 測試：Sonnet 5.5 的延遲等級是 Fast，Opus 5.5 是 Moderate [ANT-MODELS]。官方對 Sonnet 5.5 的建議是：聊天這類講求延遲的工作，effort 從 `medium` 或 `low` 開始 [ANT-S55-NEW]。
- 比較的是首字延遲、學生滿意度和成本。
- **A/B 要以「整個工作階段」為單位分組，不能在同一段對話中途換模型**（2026-10-08 查證補充）：思考區塊綁定產生它的模型。在 Claude API 上，Opus 5.5 的思考區塊只有 Fable 5.1／Mythos 5.1 讀得到 [ANT-O55-MIG]；Sonnet 5.5 的思考區塊只有 Opus 5.5 讀得到，Sonnet 5.5 則讀不到 Opus 5.5 的區塊 [ANT-S55-NEW]。所以從 Opus 5.5 換到 Sonnet 5.5，之前的推理就失效了；快取也是依模型分開的 [SKILL]。

**錯題講解先用資料庫裡的解析：**

- 出題時已經產生了解析（`explanation_zh`），學生看這份解析**不花 token**。
- 只有學生按「追問」時才呼叫 AI。

**串流：**

- Worker 用 SDK 的 `client.messages.stream()`，把 `text_delta` 轉成 SSE 送給瀏覽器（§4.3）。
- 串流中途可能收到 `event: error`（例如 `overloaded_error`），也可能收到任意數量的 `ping`。程式要能處理不認得的事件類型 [ANT-STREAM]。
- 思考區塊預設不顯示內容（`display:"omitted"`）[ANT-THINK]，前端顯示「思考中」就好。

**快取怎麼放**（[ANT-CACHE]）：

| 位置 | 內容 | 快取 |
|---|---|---|
| `system` | 家教角色和規則（繁體中文、引導式教學、不直接報答案的模式等），全站共用，約 1,500 tokens | 斷點 1（`cache_control`）。超過 512 tokens 的門檻 |
| `messages[0]` 第一個內容區塊 | 題目的上下文：文章、題目、答案、資料庫裡的解析、學生的作答。JSON 用固定的鍵順序序列化 | 斷點 2 |
| 後續對話 | 學生和 AI 的往返 | 在請求最上層加 `cache_control:{type:"ephemeral"}`（自動快取），斷點會跟著對話往後移；它會占用 4 個斷點名額中的 1 個 |

- **TTL**：學生通常幾分鐘內就會追問，用 5 分鐘 TTL 就夠，每次讀取都會重新計時。只有在常見間隔落在 5–60 分鐘之間時，才值得用 1 小時 TTL [SKILL] [ANT-CACHE]。
  - 官方成本指南的具體門檻（2026-10-08 查證補充）[ANT-COSTINTEL]：
    - 同一段對話裡，相鄰兩次請求的間隔大約每 20 次有超過 1 次落在 5–60 分鐘，而且很少超過 1 小時，就改用 1 小時 TTL。
    - Opus 5.5 有例外：如果 20 次裡只有 1–2 次落在這個範圍，而且都不超過約 30 分鐘，官方建議繼續用 5 分鐘 TTL，另外送 keep-alive 請求保溫。
    - 間隔常常超過 1 小時，就維持預設的 5 分鐘。
  - 上線後用 D1 的 `chat_messages` 時間戳記統計間隔分布，再決定。Sekai 也是用實際紀錄做決定的（§5.1）。
- **讓快取失效的操作**：在對話中途改最上層的 `effort` 或 `output_config.format`，都會讓訊息快取失效 [ANT-CACHE] [ANT-SO]。
- **切換模式**（例如「只給提示」切換成「完整詳解」）：在對話中加一則 `role:"system"` 訊息，不要改最上層的 system [ANT-MIDSYS]。

**對話紀錄只能往後加**（[ANT-PT]）：

- D1 的 `chat_messages` 要存 assistant 回傳的**完整 `content` 陣列**，包含思考區塊和它的 signature。下一輪原封不動送回。
- 不要刪除或改寫之前的任何一輪。
- 對話太長時，**限制每個工作階段的輪數**（例如 8 輪），超過就開新的工作階段。不要用截掉前面幾輪的方式處理。
- 官方允許的例外是「從頭或從尾拿掉思考區塊」，但這樣模型就失去那段推理。

**其他限制：**

- `max_tokens` 設 4,000，要容納思考和回覆。
- 學生每則訊息最多 500 字。
- 同步呼叫加上 `fallbacks:"default"`；發生 fallback 時，接手的模型讀不到 Opus 5.5 的思考區塊 [ANT-O55-MIG]。
  - 一段對話 fallback 之後，API 會記住由哪個模型接手（約 1 小時，盡力而為）。之後帶 `fallbacks` 的請求會直接送到那個模型，不再先試 Opus 5.5（sticky routing）[ANT-REFUSAL]。
  - 所以帳本要依每次回應實際的 `model` 和 `usage.iterations` 記帳（§5.2(d)(e)）。

**成本**：一個 4 輪的對話，平均每輪約 US$0.024（Opus 5.5）或 US$0.0125（Sonnet 5.5）（§3.2）。

---

## 3. 成本估算

### 3.1 估算假設

- **單價**：照 §1.2。Batch 按五折計算。
- **Token 換算**：英文 1 字約 1.8 tokens [ANT-MODELS]；中文 1 字約 1 token（未驗證）。
- **思考 token 的假設值**（未驗證，上線前用 `usage.output_tokens` 實測）：

  | 任務 | effort | 每次思考 tokens |
  |---|---|---|
  | 出題 | `high` | 4,000–7,000 |
  | 驗證 | `medium` | 3,000 |
  | 批改 | `medium` | 3,000 |
  | 中譯英批改 | `medium` | 1,500 |
  | 單字、OCR | `low` | 500 |
  | 追問 | `low` | 300 |

  §3.3 附上思考 token 減半和加倍的敏感度。
- **快取**：
  - Batch 完全不計快取效益（見 §2.1）。
  - 線上批改假設評分基準前綴命中快取。命中和未命中的價格都列出。
  - 追問每輪寫入新增的 500 tokens。
- **重生率**：題目有 30% 會被退回重生，生成和驗證都乘以 1.3。
- **匯率**：1 美元＝31.795 新臺幣 [CBC-FX]。不含信用卡海外手續費和營業稅。
- **計算方法**：用 Python 腳本依上述假設逐項計算，下表是腳本的輸出。

### 3.2 每次呼叫的 token 量和金額

| 功能 | 模型 | 模式 | 輸入（未快取） | 快取寫入 | 快取讀取 | 可見輸出 | 思考（假設） | **美元** | 單位 |
|---|---|---|---|---|---|---|---|---|---|
| 詞彙題 | Opus 5.5 | Batch | 6,300 | — | — | 3,100 | 4,000 | **0.084** | 每 10 題 |
| 綜合測驗 | Opus 5.5 | Batch | 7,400 | — | — | 2,800 | 5,000 | **0.093** | 每組（5 空格） |
| 文意選填 | Opus 5.5 | Batch | 7,600 | — | — | 3,900 | 6,000 | **0.114** | 每組（10 空格） |
| 篇章結構 | Opus 5.5 | Batch | 7,600 | — | — | 2,500 | 6,000 | **0.100** | 每組 |
| 閱讀測驗（含圖表／表格資料） | Opus 5.5 | Batch | 8,000 | — | — | 3,300 | 6,000 | **0.109** | 每組（4 題） |
| 混合題（含評分規準） | Opus 5.5 | Batch | 8,000 | — | — | 3,200 | 7,000 | **0.118** | 每組 |
| 中譯英題 | Opus 5.5 | Batch | 6,500 | — | — | 3,750 | 4,000 | **0.091** | 每 5 句 |
| 作文題目＋2 篇範文 | Opus 5.5 | Batch | 7,000 | — | — | 3,000 | 6,000 | **0.104** | 每題 |
| 驗證 A：盲解 | Sonnet 5.5 | Batch | 3,000 | — | — | 600 | 3,000 | 0.021 | 每組 |
| 驗證 B：盲解 | Opus 5.5 | Batch | 3,000 | — | — | 600 | 3,000 | 0.042 | 每組 |
| 驗證 C：干擾選項稽核 | Opus 5.5 | Batch | 3,500 | — | — | 1,200 | 3,000 | 0.049 | 每組 |
| **驗證合計（以 5 題題組為準）** | | | | | | | | **0.112** | 每組 |
| 驗證 D：盲解（選用，2026-10-08 補列） | Haiku 5.5 | Batch | 3,000 | — | — | 600 | 3,000 | 0.001 | 每組 |
| 單字增補 | Opus 5.5 | Batch | 3,400 | — | — | 1,300 | 500 | **0.025** | 每字 |
| 單字增補（替代方案） | Sonnet 5.5 | Batch | 3,400 | — | — | 1,300 | 500 | 0.012 | 每字 |
| 單字增補（候選，2026-10-08 補列） | Haiku 5.5 | Batch | 3,400 | — | — | 1,300 | 500 | 0.0006 | 每字 |
| 單字增補複核 | Sonnet 5.5 | Batch | 3,800 | — | — | 400 | 200 | 0.007 | 每字 |
| 歷屆題本結構化 | Opus 5.5 | Batch | 11,000 | — | — | 10,000 | 2,000 | 0.142 | 每份 |
| 手寫 OCR | Opus 5.5 | 即時 | 5,700（含照片 4,784） | — | — | 600 | 500 | **0.045** | 每份 |
| 手寫 OCR（替代方案） | Sonnet 5.5 | 即時 | 5,700 | — | — | 600 | 500 | 0.022 | 每份 |
| 作文批改（快取命中） | Opus 5.5 | 即時 | 1,000 | — | 5,000 | 3,000 | 3,000 | **0.125** | 每份 |
| 作文批改（快取未命中，5 分鐘寫入） | Opus 5.5 | 即時 | 1,000 | 5,000 | — | 3,000 | 3,000 | 0.149 | 每份 |
| 作文批改＋附原始照片 | Opus 5.5 | 即時 | 5,784 | — | 5,000 | 3,000 | 3,000 | 0.144 | 每份 |
| 第二位評分者 | Opus 5.5 | 即時 | 1,000 | — | 5,000 | 600 | 2,000 | 0.057 | 每份 |
| 作文批改（替代方案） | Sonnet 5.5 | 即時 | 1,000 | — | 5,000 | 3,000 | 3,000 | 0.063（快取讀取改依 $0.10 計是 0.0625） | 每份 |
| 中譯英批改 | Opus 5.5 | 即時 | 600 | — | 2,500 | 800 | 1,500 | **0.049** | 每組（2 句） |
| 追問第 1 輪（寫入快取） | Opus 5.5 | 即時 | 1,050 | 4,000 | — | 400 | 300 | 0.038 | 每輪 |
| 追問第 2 輪起（讀快取） | Opus 5.5 | 即時 | 500 | 500 | 5,000 | 400 | 300 | 0.020 | 每輪 |
| **追問平均**（4 輪對話） | Opus 5.5 | 即時 | | | | | | **0.024** | 每輪 |
| 追問平均（替代方案） | Sonnet 5.5 | 即時 | | | | | | 0.0121（原稿依舊快取價 $0.20 算出 0.0125） | 每輪 |

> 2026-10-08 查證：上表各列已用 Python 依 §3.1 的假設重算，Opus 5.5 各列與原稿一致。只有 Sonnet 5.5 用到快取讀取的兩列，因為官方降價而改變。Haiku 5.5 各列沿用同樣的思考 token 假設，但 Haiku 5.5 實際的思考量完全沒有實測過。

**怎麼讀這張表：**

- **成本主要來自輸出，而輸出大半是思考**。
  - 以綜合測驗為例，輸出（含思考）占 84%，輸入只占 16%。
  - 降低 effort 對成本的影響，比任何快取策略都大。
- 「附原始照片」只多約 US$0.019，卻能讓拼字判定有依據，建議手寫作文預設開啟。
- 中譯英批改和作文批改的評分基準前綴要至少 512 tokens 才能快取 [ANT-CACHE]，本設計的前綴都超過。

### 3.3 建題庫的一次性成本

**題庫規模是本文件的假設**（三種難度各占三分之一），成本和數量成正比，可以直接縮放。

| 項目 | 數量 | 生成單價 | 生成（×1.3 重生） | 驗證（×1.3） | 小計 |
|---|---|---|---|---|---|
| 詞彙題 | 1,500 題（150 個請求） | US$0.084／10 題 | US$16.30 | US$43.68 | US$59.98 |
| 綜合測驗 | 600 組 | US$0.093 | US$72.38 | US$87.36 | US$159.74 |
| 文意選填 | 300 組 | US$0.114 | US$44.54 | US$87.36（每組 2 倍驗證量） | US$131.90 |
| 篇章結構 | 300 組 | US$0.100 | US$39.08 | US$43.68 | US$82.76 |
| 閱讀測驗 | 600 組 | US$0.109 | US$85.02 | US$87.36 | US$172.38 |
| 混合題 | 300 組 | US$0.118 | US$46.02 | US$52.42 | US$98.44 |
| 中譯英 | 900 句（180 個請求） | US$0.091／5 句 | US$21.18 | — | US$21.18 |
| 作文題＋範文 | 300 題 | US$0.104 | US$40.56 | — | US$40.56 |
| 中譯英和作文的複核（估計） | — | — | — | US$15.29 | US$15.29 |
| **題庫小計** | | | **US$365.08** | **US$417.15** | **US$782.23** |
| 單字增補 6,012 字（含複核） | 6,012 | US$0.032／字 | | | US$189.98 |
| 歷屆題本結構化 | 66 份（57 份正式／補考＋9 份參考或試辦） | US$0.142 | | | US$9.37 |
| OCR／批改校準（366 篇佳作，走 Batch） | 366 | US$0.094 | | | US$34.58 |
| 開發與評測預留（假設值） | — | | | | US$150.00 |
| **一次性合計** | | | | | **US$1,166（約 NT$37,078）** |

**敏感度：**

| 情境 | 一次性合計 |
|---|---|
| 思考 token 減半 | US$902（約 NT$28,666） |
| 基準 | US$1,166（約 NT$37,078） |
| 思考 token 加倍 | US$1,695（約 NT$53,901） |
| 單字增補改成 7,000 字 | ＋US$31 |
| 單字增補全面改用 Sonnet 5.5 | −US$75 |
| 單字增補改用 Haiku 5.5（複核仍用 Sonnet 5.5；品質未評測，2026-10-08 補列） | −US$145 |
| 單字增補只做 Level 3–5（3,006 筆） | −US$95 |
| 出題和驗證全面改用 Sonnet 5.5（不建議在評測前這樣做） | 那兩項約減半 |

**注意 Anthropic 的每月花費上限：**

- Start 級距每月上限 $500，Build 是 $1,000 [ANT-RL]。
- 一次性的 US$1,166 必須**分 2–3 個月跑**，或先申請升到更高級距。
- 這個上限是**整個組織**共用的，所以要預留額度給線上學生使用。

### 3.4 每位學生每月的使用成本

| 情境 | 手寫作文 | 打字作文 | 中譯英批改 | 追問輪數 | 全用 Opus 5.5 | 追問改用 Sonnet 5.5 |
|---|---|---|---|---|---|---|
| 輕度 | 2 | 2 | 8 組 | 30 | **US$2.00（約 NT$63）** | US$1.63（約 NT$52） |
| 一般 | 4 | 4 | 16 組 | 80 | **US$4.47（約 NT$142）** | US$3.51（約 NT$111） |
| 重度（考前衝刺） | 10 | 10 | 40 組 | 200 | **US$11.18（約 NT$356）** | US$8.77（約 NT$279） |

（2026-10-08 查證：最後一欄依 Sonnet 5.5 新的快取讀取價 $0.10 重算；原稿依 $0.20 算出的是 1.64／3.54／8.84。）

- 「一般」用量如果作文全部改走「慢速批改」（Batch）：約 US$3.68（約 NT$117）。
- 敏感度（一般用量，思考 token 減半到加倍）：US$3.56–6.31（約 NT$113–200）。2026-10-08 重算結果相同。一次性合計的敏感度重算是 US$899–1,701，和原稿的 902–1,695 差幾美元，差在「中譯英和作文複核 US$15.29」要不要跟著思考量縮放。
- 做題、看資料庫裡的解析都**不花 token**，不列入計算。

**換算成可以服務的學生人數**（以一般用量 US$4.47／月計，本文件計算）：

| 用量級距 | 每月上限 | 約可服務 |
|---|---|---|
| Start | $500 | 112 人 |
| Build | $1,000 | 224 人 |
| Scale | $200,000 | 實務上不受限 |

再多就要升到 Scale，或降低每人的額度。

**對照 Sekai Center**：Sekai 的註解寫一次助手呼叫平均約 US$0.1385（Opus 5，in 約 20,700／out 約 1,400 tokens）（`worker/wrangler.toml:100-101`）。本專案一份手寫作文約 US$0.25，大約是 Sekai 的兩次助手呼叫。

---

## 4. Cloudflare Worker 呼叫 Anthropic API 的注意事項

### 4.1 用 SDK 還是 fetch

- 官方 TypeScript SDK `@anthropic-ai/sdk` 明列支援 Cloudflare Workers [ANT-TS]。它內建這些功能：
  - 型別。
  - 有型別的錯誤類別，例如 `Anthropic.RateLimitError`。
  - 自動重試：預設 2 次，重試 408、409、429、5xx 和連線錯誤，並遵守 `retry-after`。
  - 串流輔助：`messages.stream()` 和 `finalMessage()`。
  - 結構化輸出輔助：`messages.parse()` 加 `zodOutputFormat()`。
  - 來源：[ANT-ERR] [SKILL]。
- Sekai 是直接用 `fetch` 呼叫 `/v1/messages`（`worker/src/admin.js:211-249`、`302-379`），也能用，但重試、串流解析和錯誤分類都要自己寫。
- **建議改用 SDK**。
- 如果使用 Zod，Cloudflare 建議用 4.5.0 以後的版本，舊版每個 schema 會用掉多很多記憶體 [CF-LIMITS]。
- 用法：在請求內用 handler 收到的 `env` 建立 client：

  ```ts
  new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 })
  ```

  原稿寫「`env` 在每個請求才拿得到」，這不正確（2026-10-08 查證）。Cloudflare 文件說明可以 `import { env } from "cloudflare:workers"`，在 handler 外面（包括模組頂層）讀取 secret [CF-SECRET]。所以也可以在模組頂層建立一個共用的 client。兩種寫法都可以；在請求內建立比較單純，也方便每個任務設定不同的 `timeout`。

### 4.2 逾時和執行時間

| 限制 | Workers Free | Workers Paid | 來源 |
|---|---|---|---|
| 每個 HTTP 請求的 CPU 時間 | 10 ms | 預設 30 秒，最多可調到 5 分鐘（`limits.cpu_ms`） | [CF-LIMITS] |
| 等待 `fetch` 的時間算 CPU 嗎 | 不算 | 不算 | [CF-LIMITS] |
| HTTP 請求的總執行時間 | 不限，只要用戶端還連著 | 同左 | [CF-LIMITS] |
| `ctx.waitUntil()` | 回應送出或用戶端斷線後，最多再 30 秒；同一個請求的所有 waitUntil 共用這 30 秒 | 同左 | [CF-CTX] |
| Cron Trigger／Queue consumer／Durable Object alarm 的執行時間 | 15 分鐘 | 15 分鐘 | [CF-LIMITS] [CF-Q-LIMIT] |
| 每次呼叫的 subrequest 數 | 50 | 10,000 | [CF-LIMITS] |
| 同時等待回應標頭的連線數 | 6 | 6 | [CF-LIMITS] |
| 記憶體（每個 isolate） | 128 MB | 128 MB | [CF-LIMITS] |
| 請求本體大小 | 依 Cloudflare 方案而定，Free 和 Pro 是 100 MB | 同左 | [CF-LIMITS] |
| 方案月費 | — | 至少 $5／月 | [CF-PRICE] |

**各功能怎麼配置：**

| 功能 | 做法 | 理由 |
|---|---|---|
| **追問** | 在同一個請求內串流（§4.3） | 學生一直在看，用戶端保持連線，Worker 就會一直執行 |
| **OCR** | 同一個請求內非串流呼叫，SDK 的 timeout 設 90 秒 | 輸出短 |
| **作文批改** | 寫入 D1 工作紀錄 → 送進 Cloudflare Queue → consumer（最長 15 分鐘）呼叫 Claude → 結果寫回 D1 → 前端輪詢或用 SSE 讀 D1 的狀態 | 批改要 1–2 分鐘（未驗證）。手機網路一斷，同步請求就會被取消，而 waitUntil 只多 30 秒，不夠 |
| **Batch 收取** | GitHub Actions 或 Worker Cron | — |

**作文批改用 Queue 的細節：**

- 一則 Queue 訊息最大 128 KB，所以只傳工作 id，照片放 R2 [CF-Q-LIMIT]。
- Queues 的免費方案每天有 10,000 次操作；付費方案每月 1,000,000 次，超過的部分每百萬次 $0.40 [CF-Q-PRICE]。
- Queue consumer 的 CPU 時間預設 30 秒，可以用 `limits.cpu_ms` 調到 5 分鐘；牆鐘時間上限 15 分鐘 [CF-Q-LIMIT]。等待 Claude 回應不算 CPU 時間 [CF-LIMITS]。
- **並行上限（2026-10-08 查證，原稿列為未驗證）**：consumer 預設會自動擴充到最多 250 個並行呼叫。要限制的話，在 Wrangler 設定的 `[[queues.consumers]]` 加上 `max_concurrency`（1–250）[CF-Q-CONC] [CF-Q-LIMIT]。可以用它控制同時呼叫 Claude 的批改數，不必另外用 D1 計數。
- **R2 費用（2026-10-08 查證，原稿列為未驗證）**：Standard 儲存 $0.015／GB-月，Class A 操作每百萬次 $4.50，Class B 每百萬次 $0.36，流出流量免費；每月免費額度是 10 GB-月、Class A 100 萬次、Class B 1,000 萬次 [CF-R2]。照片每張 ≤2 MB、批改完就刪，初期應該落在免費額度內（本文件推估）。

**SDK 的 timeout：**

- 預設 10 分鐘，TypeScript 的單位是**毫秒**。
- 逾時也會重試，所以最壞情況的等待時間是 timeout ×（重試次數＋1）[SKILL]。
- 官方建議：超過 10 分鐘的長請求改用串流或 Batch；`max_tokens` 很大時不要用非串流呼叫 [ANT-ERR]。

**建議用 Workers Paid 方案：**

- 免費方案每個請求只有 10 ms CPU，解析一段 6,000 tokens 的 SSE 串流再做 JSON 驗證，有超過的風險（未實測）。
- 免費方案只有 50 個 subrequest。

### 4.3 串流（SSE）轉送範例

```ts
import Anthropic from "@anthropic-ai/sdk";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. 驗證身分、檢查 Origin、讀取並限制輸入大小、預扣點數、從 D1 取出歷史（原樣，只往後加）
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (o: unknown) => writer.write(enc.encode(`data: ${JSON.stringify(o)}\n\n`));

    const run = (async () => {
      try {
        const stream = client.messages.stream({
          model: env.AI_MODEL_CHAT,            // "claude-opus-5-5"
          max_tokens: 4000,                    // 思考＋回覆
          output_config: { effort: "low" },
          cache_control: { type: "ephemeral" }, // 自動快取：斷點跟著對話往後移
          system: [{ type: "text", text: TUTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: history,                   // messages[0] 的第一個區塊是題目上下文，另設 cache_control
        });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            await send({ t: ev.delta.text });
          }
        }
        const msg = await stream.finalMessage();
        if (msg.stop_reason === "refusal") { /* 回覆固定文字，退還點數 */ }
        // msg.content 原樣（含 thinking 區塊）存進 D1；依 msg.usage 結算點數
        await send({ done: true });
      } catch (e) {
        await send({ error: "ai_unavailable" }); // 退還預扣點數；Anthropic.RateLimitError 等分開處理（§4.5）
      } finally {
        await writer.close();
      }
    })();
    ctx.waitUntil(run); // 用戶端中途斷線時，多給 30 秒把已完成的部分寫進 D1
    return new Response(readable, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  },
};
```

寫法依據：`claude-api` 技能的 TypeScript 串流範例 [SKILL]，以及 Cloudflare 的 waitUntil 說明 [CF-CTX]。

- 用戶端還在接收串流時，Worker 的執行會持續，不需要靠 waitUntil [CF-CTX]。
- 學生中途關掉分頁時，Anthropic 那邊已經產生的 token 怎麼計費，沒有查證（未驗證）。
- `fallbacks:"default"` 要走 `client.beta.messages` 並帶 beta 標頭 `server-side-fallback-2026-07-01` [ANT-REFUSAL]。SDK 的型別是否支援 `"default"` 這種字串寫法，沒有查證（未驗證）；不支援的話，照官方 raw HTTP 的格式送。

### 4.4 金鑰保管

**正式環境：**

- 指令是 `npx wrangler secret put ANTHROPIC_API_KEY`。這個指令會**立刻建立新版本並部署** [CF-SECRET]。
- 如果使用漸進式部署，改用 `wrangler versions secret put` [CF-SECRET]。
- 在儀表板加的 secret，值在 Wrangler 和儀表板上都看不到 [CF-SECRET]。
- 帳號層級的 Secrets Store 還在 beta [CF-SECRET]。

**本機開發：**

- 放在 `.dev.vars` 或 `.env`，兩者只能擇一。
- 兩種檔案都**不能提交**，要加進 `.gitignore` [CF-SECRET]。

**Batch 管線：**

- 另外申請一把 key，存成 GitHub Actions 的 repo secret。

**分 workspace：**

- 在 Anthropic Console 建立 `online`（Worker 用）、`pipeline`（Batch 用）、`dev` 三個 workspace，每把 key 只綁定一個 workspace [ANT-WS]。
- 每個 workspace 各自設定 spend limit 和速率上限 [ANT-WS] [ANT-RL]。
- 快取按 workspace 隔離 [ANT-CACHE]，所以線上流量要集中在同一個 workspace。

**前端絕對不能拿到 key：**

- SDK 在瀏覽器預設是停用的，要明確設 `dangerouslyAllowBrowser` 才會啟用 [ANT-TS]。不要開。

**Admin API key（`sk-ant-admin…`）：**

- 只在對帳的排程裡使用，**不要放進 Worker**（§5.2）。

### 4.5 重試和錯誤處理

| HTTP | 類型 | 意義 | 處理方式 | 來源 |
|---|---|---|---|---|
| 400 | `invalid_request_error` | 請求格式錯誤；**也包括碰到自己設的 spend limit** | 不重試；記錄 request-id 並通知管理員；spend limit 用完就顯示「AI 功能暫停」 | [ANT-ERR] [ANT-RL] |
| 401 | `authentication_error` | key 錯誤、被撤銷或過期 | 通知管理員 | [ANT-ERR] |
| 402 | `billing_error` | 帳單或付款問題 | 通知管理員去儲值。**Sekai 把 403 當成餘額不足**（`admin.js:359-364`），但官方文件把餘額問題列為 402 | [ANT-ERR] |
| 403 | `permission_error` | key 沒有權限使用這個資源 | 檢查 workspace 和模型權限 | [ANT-ERR] |
| 413 | `request_too_large` | 超過 32 MB；在 Claude API 直連時由 Cloudflare 直接擋下 | 前端限制圖片大小 | [ANT-ERR] |
| 429 | `rate_limit_error` | 超過速率上限：有 `retry-after` | SDK 會自動重試 | [ANT-RL] |
| 429 | `rate_limit_error` | **碰到級距的每月上限**：`error.details.error_code` 是 `enforced_spend_limit_reached`，沒有 `retry-after` | **不要重試**，要分辨清楚 | [ANT-RL] |
| 500 | `api_error` | Anthropic 內部錯誤 | 指數退避重試 | [ANT-ERR] |
| 504 | `timeout_error` | 處理逾時 | 長請求改用串流或 Batch | [ANT-ERR] |
| 529 | `overloaded_error` | API 暫時過載 | 退避重試；串流中途也可能以 `event: error` 出現 | [ANT-ERR] [ANT-STREAM] |

**應用層的做法：**

- **錯誤分類**：用 SDK 的錯誤類別，從最具體的開始判斷，不要比對錯誤訊息字串 [SKILL]。
- **SDK 重試完還是失敗**：
  - 退還預扣的點數。
  - 回應學生「稍後再試」。
  - 記下 `request-id`。每個回應都有這個標頭，TypeScript SDK 也可以從 `_request_id` 讀到 [ANT-ERR]。
- **拒答**：拒答是 200 回應，不會被當成錯誤。要檢查 `stop_reason`，並記錄 `stop_details.category`。
- **重送的範圍**：串流中途失敗沒辦法從中斷點接續，只能整則重送，所以要先把學生的訊息存起來。

### 4.6 速率上限的管理

- 每個模型各自計算上限 [ANT-RL]。
- 估算 Start 級距的容量（本文件計算）：
  - OTPM 是 400k。作文批改一份約 6,000 個輸出 tokens，所以**每分鐘約可處理 66 份**。
  - 追問每輪約 700 個輸出 tokens，每分鐘約可處理 570 輪。
- 在 Worker 端加一道並行上限：用 D1 或 Durable Object 記錄「處理中的批改數」。Queue consumer 的並行數或許也能設上限，但參數名稱和用法沒有查證（未驗證）。
- 流量要逐步放大，避免觸發 acceleration limit [ANT-RL]。

### 4.7 其他

- **Cloudflare AI Gateway**：可以選擇讓請求經過它。
  - 端點是 `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`，官方說明的用途是「可觀測性與控制」[CF-AIG]。
  - 本文件沒有查證它的快取、限流、費用等細節（未驗證）。
  - 初期先不用，少一個轉手環節。
- **Sekai 的 403 診斷端點**（`admin.js:642-749`）：用二分法排查 Workers 呼叫 Anthropic 時偶爾出現的 403。
  - Sekai 的註解說這是「已知會發生的情形」，但本文件沒有在官方文件找到對應的說明（未驗證）。
  - 這支診斷端點值得搬過來保留。
- **Sekai 預設值不一致的教訓**：
  - `AI_CAP_SITE` 在 `wrangler.toml:77` 設成 1500。
  - 但 `api.js:108` 的程式預設值是 6000，`review.js:403` 的預設值是 1500。
  - 本專案應該把預設值集中在一個設定模組裡。

---

## 5. 額度和費用控管

### 5.1 Sekai Center 現在的設計

| 機制 | 設定或程式位置 | 內容 |
|---|---|---|
| 每人每日操作數 | `AI_OPS_USER = "20"`（`worker/wrangler.toml:58`）；`opsCapOf`、`startOp`（`worker/src/api.js:95-129`） | 以「操作」為單位：一次提問或一次截圖辨識算一次，中間跑幾輪都不另外計。台灣時間 00:00 重置，管理員不限 |
| 試用額度 | `AI_OPS_AUTO`（`api.js:100-102`）；`AI_CAP_AUTO = "20"`（`wrangler.toml:91-96`） | 自動核准、還沒人工覆核的帳號用較低的額度。註解寫：以 400 次計，一個惡意帳號一天可以燒掉 $55；壓到 20 次就只有 $3 |
| 全站保護網 | `AI_CAP_SITE = "1500"`（`wrangler.toml:77`）；`api.js:108-113` | 帳戶餘額是共用的，個人上限擋不住很多人同時用滿 |
| 點數（beta） | `CREDITS_BETA`、`AI_PLANS`（`wrangler.toml:98-106`） | 免費額度用完才扣點數，一次操作扣 1 點。定價基準是一次 US$0.1385，約 NT$4.4（`wrangler.toml:100-101`） |
| 操作的有效期限 | `createOp`、`touchOp`（`worker/src/db.js:484-494`）；`AI_OP_TTL`（`api.js:126`） | 每次操作有 TTL（預設 1800 秒），最多 60 輪 |
| 模型由伺服器決定 | `AI_MODEL`（`wrangler.toml:46`）；`PROFILES`（`admin.js:289-300`） | 前端只能指定設定檔的代號 |
| 快取 TTL 的決策紀錄 | `admin.js:309-318` | 依實際紀錄決定用 1 小時：121 次呼叫裡 86% 落在前一次的 5 分鐘內，1 小時 TTL 淨省約 14% |

### 5.2 本專案的建議

**(a) 單位改成「依成本加權的點數」**

1 點約等於 US$0.025（約 NT$0.8），由 §3.2 的成本反推：

| 任務 | 估計成本 | 點數 |
|---|---|---|
| 做題、看資料庫裡的解析 | 0 | 0 |
| 追問 1 輪 | US$0.024 | 1 |
| 中譯英批改 1 組（2 句） | US$0.049 | 2 |
| 打字作文批改（雙評） | US$0.18 | 7 |
| 手寫作文（OCR 2 點＋批改 8 點） | US$0.25 | 10 |
| 「慢速批改」（Batch） | 約一半 | 約一半 |

- 點數權重寫在 Worker 的任務設定表裡，每個任務綁定 model、effort、max_tokens、schema 和點數（呼應 05 文件 §3.2）。
- 換模型或調 effort 時，要一起重算點數。

**(b) 每人上限（預設值，可以調整）**

| 設定 | 預設值 | 說明 |
|---|---|---|
| 每日點數 | 30 點（約 US$0.75） | — |
| 每月點數 | 300 點（約 US$7.5） | 約可支應 §3.4 的「一般」用量 |
| 每日作文份數 | 3 份 | — |
| 自動核准、未覆核帳號的每日點數 | 10 點 | 沿用 Sekai 的試用額度概念 |
| 管理員 | 不限 | 但仍要記帳 |

**(c) 全站預算改用美元**

- Sekai 的 `AI_CAP_SITE` 數的是「次數」。但本專案各任務的成本差了 10 倍，數次數不準。
- 改成用每次呼叫的 `usage` 乘上價格表，累計「今日已花費美元」：
  - `AI_BUDGET_SITE_USD_DAY`，例如 20。
  - `AI_BUDGET_SITE_USD_MONTH`，例如 400。
- 超過就暫停新的 AI 任務。已經在執行的任務讓它完成（沿用 Sekai「不中途打斷」的原則）。

**(d) 預扣再結算**

- 呼叫前，用 D1 的條件式 UPDATE 預扣「估計點數」，避免多個請求同時扣點時出錯（沿用 Sekai 的做法，見 05 文件）。
- 呼叫後，依實際的 `usage` 結算：
  - 快取寫入要分開計算 5 分鐘版和 1 小時版，數字在 `usage.cache_creation.ephemeral_5m_input_tokens` 和 `ephemeral_1h_input_tokens` [ANT-CACHE]。
- 失敗就全額退還。

**(e) 價格表明確列出每個模型 ID**

- 不要用前綴比對。Sekai 的 `pricing.js` 會把 `claude-opus-5-5` 算成 Opus 5 的價格，帳面因此高估（見 05 文件 §3.4）。
- 遇到不認得的模型 ID，就**拒絕呼叫並發出警示**（fail closed），不要記成 0 元。

**(f) Anthropic 端的最後防線**

- `online` 和 `pipeline` 兩個 workspace 各自設定每月 spend limit 和提醒門檻 [ANT-WS]。
- 設定值要比站內預算略高，讓站內的控管先觸發。
- 三層的大小關係：站內月預算 ＜ workspace 的 spend limit ＜ 級距的每月上限。

**(g) 對帳**

- 每天跑一次排程（GitHub Actions），用 Admin API key 呼叫 Usage & Cost API，和 D1 的帳本比對，差異超過 5% 就通知管理員。
  - 用量端點是 `/v1/organizations/usage_report/messages`，可以依 model、workspace、API key 分組 [ANT-USAGE]。
- Admin key 只存在 GitHub Actions secret，不放進 Worker。

**(h) Batch 的預算閘**

- 送出前估算成本（§2.1），超過 `AI_BATCH_BUDGET_USD` 就不送。
- 每批的筆數也設上限。

**(i) 防止濫用**

- 只開放任務型端點。提示詞、評分基準和 schema 都放在伺服器端（05 文件 §3.2）。
- 限制輸入：
  - 作文最多 600 字。
  - 每份作文最多 2 張照片，每張 ≤2 MB。
  - 追問訊息最多 500 字，每個工作階段最多 8 輪。
- 不提供匿名使用 AI。

**(j) 建議的 `wrangler.toml` `[vars]`**（名稱是建議，數值要依實測調整）

```toml
# 模型（換模型時要同步更新程式裡的價格表；表裡沒有的模型 ID 會被拒絕呼叫）
AI_MODEL_DEFAULT = "claude-opus-5-5"
AI_MODEL_CHAT = "claude-opus-5-5"      # 和 claude-sonnet-5-5 做 A/B 測試
AI_EFFORT_CHAT = "low"
AI_EFFORT_GRADE = "medium"
AI_EFFORT_OCR = "low"
# 個人額度（點；1 點約 US$0.025）
AI_POINTS_USER_DAY = "30"
AI_POINTS_USER_MONTH = "300"
AI_POINTS_AUTO_DAY = "10"
AI_ESSAY_USER_DAY = "3"
AI_CHAT_MAX_TURNS = "8"
# 全站預算（美元；依實際 usage 換算）
AI_BUDGET_SITE_USD_DAY = "20"
AI_BUDGET_SITE_USD_MONTH = "400"
AI_OP_TTL = "1800"
# 機密資訊（ANTHROPIC_API_KEY 等）一律用 wrangler secret put，不要寫在這裡
```

---

## 6. 未驗證或待實測

1. **繁體中文的 token 換算**：本文件用 1 字約 1 token 估算，要用 count_tokens 實測 [ANT-TOKEN]。
2. **各任務在各種 effort 下的實際思考 token 量**：§3 的成本對這個數字最敏感。
3. **Batch 的實際快取命中率**：決定要用 5 分鐘還是 1 小時 TTL。
4. **Opus 5.5 讀手寫作文的正確率**：
   - 要先人工轉錄 30–50 篇佳作當標準答案。
   - 還要測不同拍攝品質。
   - Sonnet 5.5 的正確率也要比較。
5. **AI 評分和大考中心分數的一致性**：
   - 366 篇佳作都是高分卷。
   - 還需要中低分的樣本（目前沒有）。
6. **作文批改的實際耗時**：決定 Queue 和前端輪詢的設計。
7. **學生中途斷線時已產生 token 的計費方式。**
8. **SDK 的型別是否支援 `fallbacks:"default"`。**
9. **Cloudflare 的其他細節**：AI Gateway 的快取、限流和費用；Queue consumer 並行數的設定參數；R2 的費用。
10. **Sekai 註解提到的「Workers 呼叫 Anthropic 回 403」**：官方文件裡沒有找到對應說明。
11. **看圖作文的圖片來源**（Claude 不能產生圖片）。
12. **難度標籤的校正**：要靠上線後學生的作答資料。
13. **未成年學生資料的保存與告知規範。**
14. **Anthropic 新組織的初始級距**：可能是 Evaluation tier；實際額度要在 Console 確認 [ANT-RL]。

---

## 參考來源

**Anthropic（2026-10-07 下載，存於 `data/raw/anthropic-docs/`）**

- [ANT-MODELS] Models overview：https://platform.claude.com/docs/en/about-claude/models/overview （會轉址到 https://platform.claude.com/docs/en/models/overview ）
- [ANT-O55] Claude Opus 5.5：https://platform.claude.com/docs/en/models/opus-5-5/overview
- [ANT-O55-MIG] Migrating to Claude Opus 5.5：https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
- [ANT-O55-NEW] What's new in Claude Opus 5.5：https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
- [ANT-S55] Claude Sonnet 5.5：https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- [ANT-S55-NEW] What's new in Claude Sonnet 5.5：https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5
- [ANT-DEPR] Model deprecations：https://platform.claude.com/docs/en/about-claude/model-deprecations
- [ANT-PRICE] Pricing：https://platform.claude.com/docs/en/about-claude/pricing
- [ANT-BATCH] Batch processing：https://platform.claude.com/docs/en/build-with-claude/batch-processing
- [ANT-CACHE] Prompt caching：https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- [ANT-SO] Structured outputs：https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- [ANT-VISION] Vision：https://platform.claude.com/docs/en/build-with-claude/vision
- [ANT-PDF] PDF support：https://platform.claude.com/docs/en/build-with-claude/pdf-support
- [ANT-THINK] Thinking：https://platform.claude.com/docs/en/build-with-claude/thinking
- [ANT-PT] Preserved thinking：https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
- [ANT-EFFORT] Effort：https://platform.claude.com/docs/en/build-with-claude/effort
- [ANT-MIDSYS] Mid-conversation system messages：https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages
- [ANT-REFUSAL] Refusals, fallback, and billing：https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- [ANT-STREAM] Streaming：https://platform.claude.com/docs/en/build-with-claude/streaming
- [ANT-ERR] Errors：https://platform.claude.com/docs/en/api/errors
- [ANT-RL] Rate limits：https://platform.claude.com/docs/en/api/rate-limits
- [ANT-TOKEN] Token counting：https://platform.claude.com/docs/en/build-with-claude/token-counting
- [ANT-USAGE] Usage and Cost API：https://platform.claude.com/docs/en/manage-claude/usage-cost-api
- [ANT-WS] Workspaces：https://platform.claude.com/docs/en/manage-claude/workspaces
- [ANT-TS] Claude SDK for TypeScript（README，支援的執行環境）：https://github.com/anthropics/anthropic-sdk-typescript
- [SKILL] Claude Code 內建的 `claude-api` 技能（模型表快取日期 2026-09-25）。內容來自上列官方文件。沒有逐字對應到官方頁面的說法，本文都標註 [SKILL]。

**Cloudflare（2026-10-07 下載，存於 `data/raw/cloudflare-docs/`）**

- [CF-LIMITS] Workers limits：https://developers.cloudflare.com/workers/platform/limits/
- [CF-CTX] Context API（waitUntil）：https://developers.cloudflare.com/workers/runtime-apis/context/
- [CF-SECRET] Secrets：https://developers.cloudflare.com/workers/configuration/secrets/
- [CF-PRICE] Workers pricing：https://developers.cloudflare.com/workers/platform/pricing/
- [CF-Q-LIMIT] Queues limits：https://developers.cloudflare.com/queues/platform/limits/
- [CF-Q-PRICE] Queues pricing：https://developers.cloudflare.com/queues/platform/pricing/
- [CF-AIG] AI Gateway：Anthropic：https://developers.cloudflare.com/ai-gateway/usage/providers/anthropic/

**其他**

- [GH-LIMITS] GitHub Actions limits：https://docs.github.com/en/actions/reference/limits
- [CBC-FX] 中央銀行「新臺幣/美元 銀行間收盤匯率」（2026/10/07 為 31.795）：https://www.cbc.gov.tw/tw/lp-645-1.html

**本機檔案（唯讀參考）**

- Sekai Center：`/home/user/project-sekai-center/worker/wrangler.toml`、`worker/src/api.js`、`worker/src/admin.js`、`worker/src/db.js`、`worker/src/review.js`
- 本專案研究文件：`docs/research/01-curriculum-108.md`、`02-gsat-english-spec.md`、`03-vocab-list.md`、`04-data-sources-licensing.md`、`05-sekai-center-patterns.md`、`09-exam-inventory.md`
