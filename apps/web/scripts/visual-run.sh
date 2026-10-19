#!/usr/bin/env bash
# 版面截圖（docs/design/desktop-ui.md §11.1、§11.2；完整說明見 apps/web/tests/visual/README.md）：
# 建置目前的工作目錄（或直接用現成的建置產物）→ 用 tests/visual/visual.config.ts 截圖 → 寫 manifest.json。
#
# 用法：
#   apps/web/scripts/visual-run.sh [<輸出資料夾>] [--data-from <建置產物>] [--viewports narrow|desktop|all|320x640,…]
#                                  [--dist <建置產物>] [--build-to <資料夾>] [--grep <正規式>] [--port 4417] [--workers 3]
#
#   <輸出資料夾>  截圖放這裡（每個視窗一個子資料夾）；預設 ${VISUAL_OUT:-${TMPDIR:-/tmp}/gsat-visual}/after。必須在 repo 外
#   --data-from   建置完把 data/ 換成另一份建置產物的 data/（例如基準的）：題庫、考卷資料兩邊一樣，比對只反映介面改動
#   --viewports   只截這些視窗：narrow（320x640、375x812、768x1024）、desktop（九種桌機）、all（預設），或逗號分隔的名稱
#   --dist        不建置，直接截這份建置產物（不改動它，所以不能和 --data-from 一起用）
#   --build-to    建置到這個資料夾；預設 <輸出資料夾>.dist
#   --grep        只截名稱符合的（Playwright 的 --grep，比對測試名稱，例如 '01-home|13-exams'）
#   --port        vite preview 的連接埠；預設 4417。同時跑兩份截圖時要錯開（被佔用時直接失敗，不會截到別人的伺服器）
#   --workers     Playwright 的 worker 數；預設 3（4 核心的機器上還有別的工作時用 2）
#
# 結束碼：全部截到 0；有截圖失敗時照樣寫 manifest.json，回傳 Playwright 的結束碼；用法錯誤 2。
#
# 整支包在 main() 裡：bash 先讀完整個函式才執行，跑到一半改這個檔案也不會讀到錯位的指令。
set -euo pipefail

main() {
  local SCRIPT_DIR WEB REPO
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  WEB="$(cd "$SCRIPT_DIR/.." && pwd)"
  REPO="$(git -C "$WEB" rev-parse --show-toplevel)"
  local ROOT="${VISUAL_OUT:-${TMPDIR:-/tmp}/gsat-visual}"
  local OUT="" DIST="" BUILD_TO="" DATA_FROM="" GREP=""
  local VIEWPORTS="${SHOTS_VIEWPORTS:-all}" PORT="${SHOTS_PORT:-4417}" WORKERS="${SHOTS_WORKERS:-3}"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dist | --build-to | --data-from | --viewports | --grep | --port | --workers)
        [[ $# -ge 2 && "$2" != --* ]] || { echo "$1 後面少了值" >&2; return 2; }
        case "$1" in
          --dist) DIST="$2" ;;
          --build-to) BUILD_TO="$2" ;;
          --data-from) DATA_FROM="$2" ;;
          --viewports) VIEWPORTS="$2" ;;
          --grep) GREP="$2" ;;
          --port) PORT="$2" ;;
          --workers) WORKERS="$2" ;;
        esac
        shift 2 ;;
      -h | --help) sed -n '2,20p' "${BASH_SOURCE[0]}"; return 0 ;;
      -*) echo "未知的選項：$1（visual-run.sh --help）" >&2; return 2 ;;
      *) if [[ -z "$OUT" ]]; then OUT="$1"; shift; else echo "多餘的參數：$1" >&2; return 2; fi ;;
    esac
  done

  OUT="${OUT:-$ROOT/after}"
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  # 截圖（每套數百張 PNG）與建置產物一律放在 repo 外，不會被 git 看到。
  case "$OUT/" in "$REPO"/*) echo "輸出資料夾在 repo 裡（$OUT）：請放到 repo 外，例如 $ROOT/after" >&2; return 2 ;; esac

  if [[ -n "$DIST" ]]; then
    [[ -z "$DATA_FROM" ]] || { echo "--data-from 只能在建置時用（不改動 --dist 指定的建置產物）" >&2; return 2; }
    [[ -z "$BUILD_TO" ]] || { echo "--dist 與 --build-to 只能選一個" >&2; return 2; }
  else
    DIST="${BUILD_TO:-${OUT%/}.dist}"
    mkdir -p "$DIST"
    DIST="$(cd "$DIST" && pwd)"
    case "$DIST/" in "$REPO"/*) echo "建置產物資料夾在 repo 裡（$DIST）：請放到 repo 外" >&2; return 2 ;; esac
    if [[ -n "$DATA_FROM" ]]; then
      [[ -f "$DATA_FROM/data/meta.json" ]] || { echo "找不到 $DATA_FROM/data/meta.json（--data-from 要指向一份建置產物）" >&2; return 1; }
      DATA_FROM="$(cd "$DATA_FROM" && pwd)"
      [[ "$DATA_FROM" != "$DIST" ]] || { echo "--data-from 和要建置的資料夾是同一個" >&2; return 2; }
    fi
    echo "▶ 建置 $WEB → $DIST"
    (cd "$WEB" && npm run build:data && npx vite build --outDir "$DIST" --emptyOutDir --logLevel warn)
    if [[ -n "$DATA_FROM" ]]; then
      echo "▶ data/ 換成 $DATA_FROM/data"
      rm -rf "$DIST/data"
      cp -R "$DATA_FROM/data" "$DIST/data"
    fi
    node "$WEB/tests/visual/manifest.mjs" --record-source "$DIST" "$REPO" ${DATA_FROM:+"$DATA_FROM"}
  fi
  DIST="$(cd "$DIST" && pwd)"
  [[ -f "$DIST/index.html" ]] || { echo "找不到 $DIST/index.html" >&2; return 1; }

  echo "▶ 截圖：$DIST → $OUT（視窗：$VIEWPORTS，連接埠 $PORT，$WORKERS 個 worker）"
  local status=0
  (
    cd "$WEB"
    SHOTS_OUT="$OUT" SHOTS_DIST="$DIST" SHOTS_PORT="$PORT" SHOTS_VIEWPORTS="$VIEWPORTS" \
      npx playwright test -c tests/visual/visual.config.ts --workers "$WORKERS" ${GREP:+--grep "$GREP"}
  ) || status=$?

  node "$WEB/tests/visual/manifest.mjs" "$OUT" "$DIST" "$REPO"
  if [[ $status -ne 0 ]]; then
    echo "⚠ 有截圖失敗（exit $status）：上面的 Playwright 輸出列出哪幾張；其餘的圖照常寫入。" >&2
  fi
  return $status
}

main "$@"
exit $?
