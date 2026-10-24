# 出版社模考匯入的覆寫檔

`tools/import_publisher.py` 每回試卷讀一個覆寫檔 `{試卷代號}.json`（例如 `ny-113-n2.json`），記錄站方的人工決定。
沒有覆寫檔時當作全部是空的。改完覆寫檔後重跑匯入工具（見最下面），工具會依內容重寫正規化檔與檢查表
`docs/publisher-import/report.md`；題目文字、答案或難度改了才升版本，只改狀態時覆寫同一個版本。

覆寫檔是公開 repo 的一部分：**不要寫題目、選文、選項或詳解的原文**，只寫題號與站方的判斷。

## 格式

```jsonc
{
  "paper_id": "ny-113-n2",                 // 必須和檔名相同
  "notes": ["給站主看的說明，印在檢查表的「站方備註」"],

  // 稽核（.verify.json）的未決事項：鍵是 unresolved 陣列的索引（從 0 起）。
  // 提到匯入題組題號的未決事項一定要在這裡確認，否則該題組維持 draft。
  "unresolved": {
    "2": { "affects_answer": false, "note": "答案是字庫裡唯一合適的選項，稽核同意答案表" },
    "5": { "affects_answer": true,  "note": "題目有兩個說得通的答案，等出版社回覆" }   // true → 題組維持 draft
  },

  // 稽核的答案爭議（.verify.json 的 disputes）：鍵是原卷題號。沒有裁決的爭議讓題組維持 draft。
  "disputes": {
    "11": { "decision": "keep",   "reason": "維持答案表的理由" },
    "38": { "decision": "change", "answer": "C", "reason": "改答案的理由" }      // 改答案會改內容 → 版本 +1
  },

  // 題組層級的決定：鍵是原卷第一題與最後一題（檢查表「原卷題號」那一欄的寫法，用半形連字號）：
  // 1-10、11-15、21-30、47-50、47A-49D；只有一題的題組就是那個題號。
  "groups": {
    "43-46": {
      "exclude": "排除的理由",                 // 有值就不輸出這組，理由印在檢查表
      "tier": "advanced",                      // 站方指定難度（basic／advanced／top）→ tier_basis manual
      "tier_reason": "指定難度的理由",
      "status": "draft",                       // 強制草稿（只能是 draft；verified 由檢查決定）
      "status_reason": "理由",
      "notes": "備註（目前只存檔，不影響輸出）"
    },

    // 混合題：所有填充、簡答都補齊可接受寫法、校對者確認後，才標 open_key_complete，題組才會輸出（open_key: complete）。
    "47-50": {
      "accepted_answers": {                    // 鍵是原卷題號；值是完整清單（一定要含原卷答案）
        "47": ["borrow", "Borrow"],
        "50": ["harvest", "the harvest"]
      },
      "scoring_extra": {                       // 部分給分寫法與可對調的格（gsat-pub/v1 的 scoring_extra；鍵是原卷題號）
        "47": { "partial_credit_forms": ["borrows"], "interchangeable_with": null }
      },
      "open_key_complete": true
    }
  }
}
```

`scoring_extra` 的 `interchangeable_with` 寫的是**重編後的題號**（組內從 1 起，例如原卷 47–50 的第 48 題是 2）；
鍵是原卷題號，工具會換成組內題號。

## 判斷 verified／draft 的規則

一個題組是 verified，要同時符合：

1. 試卷有 `.verify.json`（獨立稽核完成）；
2. 題組裡沒有未裁決的答案爭議（`disputes`）；
3. 稽核未決事項只要提到題組裡的題號，都在 `unresolved` 確認過，而且 `affects_answer` 是 false；
4. 沒有被 `groups.*.status` 指定為草稿。

混合題另外要 `open_key_complete`，否則不輸出（`validate_publisher.py` 只收 `open_key: complete`）。

## 重跑

```sh
python3 -I tools/import_publisher.py --work <轉錄目錄> [--validator <validate_publisher.py 的路徑>]
# 只重做幾回（快，但不更新檢查表；最後要跑一次全部）
python3 -I tools/import_publisher.py --work <轉錄目錄> --paper ny-113-n2 --paper tc-111-g1
```

轉錄目錄（`manifest.json` 與 `papers/{試卷代號}.json`、`.extras.json`、`.verify.json`）和原始 PDF 都不進 repo。

## 難度的對照（翰林、北模、中模：publisher）

這三家的詳解都逐題印五級難易度（易、中偏易、中、中偏難、難），所以來源登記 `data/sources.json` 帶 `tier_labels`，
依 §8.5 的順序（作答統計 → 出版社標示 → 文章指標）用出版社標示：易、中偏易 → basic；中 → advanced；中偏難、難 → top。
題組取各題（0／1／2）的平均：< 0.5 basic、< 1.5 advanced、其餘 top（剛好在界線上算較難的一級）。

理由（weak-paper.md §8.5 的 G50）：只有全體答對率 P 時，G50 的門檻是 P ≥ .514 穩定基礎、.393 ≤ P < .514 進階練習、
P < .393 超越頂標。出版社的「中」大約是五成答對，代入 `rule.imputation.p_only` 得 Pc ≈ .48（未達 .50）、Pb ≈ .65，
正好落在進階練習；「中偏易」約六成以上，Pc ≥ .50，是穩定基礎；「中偏難」約四成以下，Pb < .50，是超越頂標。
這些模考沒有作答統計，所以 G50 本身（tier_basis `stats`）用不上。

## 難度（南一：metrics；南一的詳解沒有印難易度）

- 選文類：`tools/text_metrics.py` 的字數、L1–4／L1–6 覆蓋率、表外字比例、平均句長，和 `data/specs/tiers.json` 三級的帶比距離
  （超出帶的量 ÷ 尺度：字數 30、覆蓋率與表外字 0.02、句長 2），取距離最小的一級；距離相同取離帶中心近的，再相同取 advanced。
- 詞彙：10 題正解的詞表級別平均（片語取最高級的字，表外字算 6 級）：< 3.85 basic、< 4.5 advanced、其餘 top。
  門檻用學測 91–115 的詞彙大題校準：歷屆詞彙大題的 G50 多半是穩定基礎，正解平均級別 2.7–4.1；這條規則和 G50 一致 17／25 回，
  訊號偏弱，站主可以用 `groups.*.tier` 改。

## 已經輸出過的題組

- 工具不刪檔：題組後來被排除（例如站方排除、跨卷重複）時，既有的正規化檔留著。還沒發布過的直接刪檔；已經發布過的用
  `data/unpublish.jsonl` 下架（路徑指到正規化檔）。
- 題組的 uid 一旦輸出就固定（同來源、同原卷題號沿用），之後只升版本。
