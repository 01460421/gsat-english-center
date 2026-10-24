# 桌機改版的前後對照截圖

`docs/design/desktop-polish.md` 的每個 PR 都要附「改版前／改版後」的桌機截圖給站主與審查者看（§5.0、附錄 B）。這個資料夾就是產生那些截圖的工具：
三種桌機視窗（1366×768、1440×900、1920×1080）加 1440×900 深色，每個頁面狀態一張「打開時的第一個畫面」，頁面會捲動時再一張整頁圖（`__full`）。

和上一層的 `capture.shots.ts` 分工：

| | `../capture.shots.ts`（`visual.config.ts`） | 這裡（`audit.config.ts`） |
| --- | --- | --- |
| 用途 | 證明手機與平板**逐像素不變**（`compare.mjs` exit 0） | 給人看的桌機前後對照 |
| 視窗 | 12 種（3 種窄視窗＋9 種桌機） | 3 種桌機＋1440×900 深色（手機 375×812 只截改到手機的修正） |
| 狀態 | 每個路由的基本狀態，改動前要先補截 | 設計文件引用的 106 個以上狀態（檔名＝文件裡的截圖 ID） |
| 功能開關 | 登入、AI、自訂題目批改（學習助手只在 37-* 開） | 正式站的設定（學習助手與拍照問題目也開著） |

兩邊共用 `../fixtures.ts`（時間、帳號狀態、寫作的假提交）與 `tests/support/backend.ts`（假後端）。`npm run test:e2e`、`npm test` 都不會跑到這裡；`npm run typecheck` 會檢查。
**截圖一律輸出到 repo 外**（設定檔會拒絕 repo 裡的資料夾）。

## 用法（在 repo 根目錄；照抄附錄 B）

```bash
A=${TMPDIR:-/tmp}/gsat-visual/audit     # 截圖放這裡（repo 外）
PR=pr1

# 1. 建置，複製一份凍結的產物；資料換成改版前那份（兩邊題庫相同，差異只反映介面）
npm run build -w @gsat/web
rm -rf $A/dist-$PR && cp -r apps/web/dist $A/dist-$PR && rm -rf $A/dist-$PR/data && cp -r $A/dist-before/data $A/dist-$PR/data

# 2. 截這個 PR 列出的狀態（--grep 比對測試名稱；省略就是全部）
mkdir -p $A/after-$PR
cd apps/web
AUDIT_DIST=$A/dist-$PR AUDIT_OUT=$A/after-$PR AUDIT_PORT=4681 \
  npx playwright test -c tests/visual/audit/audit.config.ts --grep '12-exam-paper-exam-flow|14-mock-flow|09-essay-exam-filled|05-practice-reading-flow' 2>&1 | tee $A/after-$PR/run.log

# 3. 索引（--before 給改版前的資料夾，每張圖旁邊有改版前的連結）
node tests/visual/audit/make-index.mjs $A/after-$PR/_meta $A/after-$PR --log $A/after-$PR/run.log --dist $A/dist-$PR \
  --title '桌機介面 AFTER 截圖（PR 1）' --before $A/before
```

- 改版前的截圖：在改版前的 commit 用同一個工具截一次（`AUDIT_OUT=$A/before`），建置產物留著當 `dist-before`（資料用它的）。
  新增的狀態（例如 PR 1 的交卷確認列）在改版前的程式上本來就不存在，那幾個流程在舊的建置上會失敗，屬預期。
- 只要某些視窗：`AUDIT_PROJECTS=1366x768,1440x900-dark`。改到手機的修正（PR 1 的交卷確認焦點、交卷後清除的確認）另外用
  `AUDIT_PROJECTS=375x812` 截（只跑 `desktop.audit.ts` 裡標了 `mobile: true` 的狀態）。
- 同時有 e2e 在跑時換連接埠（`AUDIT_PORT`）；被佔用時直接失敗，不會截到別人的伺服器。
- 確定性：時間固定在 2026-10-18 10:00（台北）、`Math.random` 固定 0.5、關掉動畫與轉場、隱藏游標、連續兩次截到一樣才存檔。
  桌機的整頁圖不用 Playwright 的 `fullPage`（會讓 `(min-width: 64rem)` 短暫失效、頁面換成手機的樹），改成把視窗拉高到整頁高度再截，
  所以側邊欄只畫到第一個視窗高度。學習助手案例頁的兩欄工作區在整頁圖裡展開內部捲動。

## 增加狀態

在 `desktop.audit.ts` 的 `STATIC` 表加一行（進頁面就截），或在對應的流程測試裡接著操作再 `c.shot(名稱, 說明, 選項)`：

- `dark: true`：也在 1440×900 深色截；`full: false`：只截視窗（對話框、選單）；`keepScroll: true`：保留目前的捲動位置（只截視窗）；
- `mobile: true`：也在 375×812 截（只給改到手機的修正用），並把流程名稱加進 `MOBILE_TESTS`。

名稱沿用設計文件的截圖 ID，前後兩次才對得起來。
