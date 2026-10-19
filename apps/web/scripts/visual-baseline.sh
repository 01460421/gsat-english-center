#!/usr/bin/env bash
# 從任一個 commit 重建版面截圖的基準（docs/design/desktop-ui.md §11.1；完整說明見 apps/web/tests/visual/README.md）：
# git worktree 把 <commit> 檢出到 repo 外的暫存資料夾 → 安裝套件 → 建置（保留建置產物，含當時的 data/）
# → 移除暫存的 worktree → 用「目前工作目錄」的截圖工具（tests/visual/）截圖。
# 只建置 commit 裡的內容；工作目錄還沒 commit 的改動不算（要截工作目錄用 visual-run.sh）。
#
# 用法：
#   apps/web/scripts/visual-baseline.sh [<commit>] [--out <截圖資料夾>] [--dist-out <建置產物資料夾>] [--rebuild] [--npm-ci]
#                                       [--viewports narrow|desktop|all|320x640,…] [--grep <正規式>] [--port 4417] [--workers 3]
#
#   <commit>     預設 HEAD
#   --out        截圖資料夾；預設 ${VISUAL_OUT:-${TMPDIR:-/tmp}/gsat-visual}/baseline-<commit 前 7 碼>
#   --dist-out   建置產物；預設 <截圖資料夾>.dist。裡面已經有建置好的產物時直接沿用、不再檢出與建置
#                （之後增加截圖情境時，用它補截基準就好）
#   --rebuild    建置產物已經存在也重新建置
#   --npm-ci     在暫存資料夾一律跑 npm ci。預設：<commit> 的 package-lock.json 和目前工作目錄的相同時，
#                直接借用目前的 node_modules（連結過去；工作區套件 @gsat/* 仍指向暫存資料夾裡的原始碼），不同時才 npm ci
#   其餘選項原樣交給 visual-run.sh。
#
# 結束碼同 visual-run.sh。
set -euo pipefail

main() {
  local SCRIPT_DIR WEB REPO
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  WEB="$(cd "$SCRIPT_DIR/.." && pwd)"
  REPO="$(git -C "$WEB" rev-parse --show-toplevel)"
  local ROOT="${VISUAL_OUT:-${TMPDIR:-/tmp}/gsat-visual}"
  local COMMIT="" OUT="" DIST="" REBUILD=0 NPM_CI=0
  local -a PASS=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --out | --dist-out | --viewports | --grep | --port | --workers)
        [[ $# -ge 2 && "$2" != --* ]] || { echo "$1 後面少了值" >&2; return 2; }
        case "$1" in
          --out) OUT="$2" ;;
          --dist-out) DIST="$2" ;;
          *) PASS+=("$1" "$2") ;;
        esac
        shift 2 ;;
      --rebuild) REBUILD=1; shift ;;
      --npm-ci) NPM_CI=1; shift ;;
      -h | --help) sed -n '2,22p' "${BASH_SOURCE[0]}"; return 0 ;;
      -*) echo "未知的選項：$1（visual-baseline.sh --help）" >&2; return 2 ;;
      *) if [[ -z "$COMMIT" ]]; then COMMIT="$1"; shift; else echo "多餘的參數：$1" >&2; return 2; fi ;;
    esac
  done

  local SHA
  SHA="$(git -C "$REPO" rev-parse --short=7 "${COMMIT:-HEAD}^{commit}")" || { echo "找不到 commit：${COMMIT:-HEAD}" >&2; return 2; }
  OUT="${OUT:-$ROOT/baseline-$SHA}"
  DIST="${DIST:-${OUT%/}.dist}"
  mkdir -p "$OUT" "$DIST"
  OUT="$(cd "$OUT" && pwd)"
  DIST="$(cd "$DIST" && pwd)"
  case "$OUT/" in "$REPO"/*) echo "截圖資料夾在 repo 裡（$OUT）：請放到 repo 外" >&2; return 2 ;; esac
  case "$DIST/" in "$REPO"/*) echo "建置產物資料夾在 repo 裡（$DIST）：請放到 repo 外" >&2; return 2 ;; esac

  if [[ -f "$DIST/index.html" && $REBUILD -eq 0 ]]; then
    echo "▶ 沿用已經建置好的 $DIST（要重新建置加 --rebuild）"
  else
    build "$REPO" "$SHA" "$DIST" "$NPM_CI" "$WEB"
  fi

  "$SCRIPT_DIR/visual-run.sh" "$OUT" --dist "$DIST" ${PASS[@]+"${PASS[@]}"}
}

# 暫存的 worktree（cleanup 用；全域變數，trap 觸發時函式的區域變數已經不在了）。
CLEAN_REPO=""
CLEAN_TMP=""
cleanup() {
  [[ -n "$CLEAN_TMP" ]] || return 0
  # 先刪借來的 node_modules（裡面是連結；rm 只刪連結本身，不會碰到目前工作目錄的套件）。
  rm -rf "$CLEAN_TMP/src/node_modules"
  git -C "$CLEAN_REPO" worktree remove --force "$CLEAN_TMP/src" 2>/dev/null || true
  git -C "$CLEAN_REPO" worktree prune 2>/dev/null || true
  rm -rf "$CLEAN_TMP"
  CLEAN_TMP=""
}

# 檢出 → 安裝套件 → 建置 → 記錄來源 → 移除 worktree（失敗或按 Ctrl-C 中斷時也會移除）。
build() {
  local REPO="$1" SHA="$2" DIST="$3" NPM_CI="$4" WEB="$5"
  local WT
  CLEAN_REPO="$REPO"
  CLEAN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/gsat-visual-wt.XXXXXX")"
  WT="$CLEAN_TMP/src"
  trap cleanup EXIT
  trap 'exit 130' INT TERM

  echo "▶ 檢出 $SHA → $WT"
  git -C "$REPO" worktree add --quiet --detach "$WT" "$SHA"

  if [[ "$NPM_CI" -eq 0 ]] && [[ -d "$REPO/node_modules" ]] && git -C "$REPO" diff --quiet "$SHA" -- package-lock.json; then
    echo "▶ package-lock.json 和目前的工作目錄相同：借用 $REPO/node_modules"
    link_node_modules "$REPO/node_modules" "$WT/node_modules"
  else
    echo "▶ npm ci（$WT）"
    (cd "$WT" && npm ci --no-audit --no-fund)
  fi

  echo "▶ 建置 $SHA → $DIST"
  (cd "$WT/apps/web" && npm run build:data && npx vite build --outDir "$DIST" --emptyOutDir --logLevel warn)
  node "$WEB/tests/visual/manifest.mjs" --record-source "$DIST" "$WT"

  cleanup
  trap - EXIT INT TERM
}

# 在 dst 建一個 node_modules：每個套件都連到 src 裡的同名項目；工作區套件（@gsat/*）照原本的相對連結重建，
# 指向 dst 那邊的原始碼（直接把整個 node_modules 連過去的話，@gsat/shared 會解析到目前工作目錄的 packages/shared）。
link_node_modules() {
  local src="$1" dst="$2" entry name
  mkdir -p "$dst"
  for entry in "$src"/* "$src"/.[!.]*; do
    [[ -e "$entry" || -L "$entry" ]] || continue
    name="$(basename "$entry")"
    # 工具的快取（vite、vitest）不借，免得暫存資料夾的建置寫進目前工作目錄的快取。
    [[ "$name" == ".vite" || "$name" == ".cache" ]] && continue
    if [[ "$name" == "@gsat" ]]; then
      mkdir -p "$dst/@gsat"
      local ws
      for ws in "$entry"/*; do
        if [[ -L "$ws" ]]; then ln -s "$(readlink "$ws")" "$dst/@gsat/$(basename "$ws")"; else ln -s "$ws" "$dst/@gsat/$(basename "$ws")"; fi
      done
    else
      ln -s "$entry" "$dst/$name"
    fi
  done
}

main "$@"
exit $?
