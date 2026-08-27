#!/usr/bin/env bash
# verify-fixes.sh (旧版)
# PR #32 で直した4件が、本当に直っているかを自分の目で確かめるスクリプト。
#
# 使い方:
#   ./scripts/verify-fixes.sh --env .env
#
# 環境変数でも渡せる (引数のほうが優先):
#   ENV_FILE=.env ./scripts/verify-fixes.sh
#
# 前提:
#   - backend が localhost:8787 で起動している (pnpm run dev)
#   - --env で渡した .env に SECRET_KEY とレジストリの認証情報が入っている
#
# 直っていない状態と比べたい場合（修正はコミット済みなので git stash では戻せない）:
#
#   ★ ファイルを差し替えたら必ず backend を再起動すること。
#     wrangler dev は git checkout での変更を拾わないことがあり、
#     古いコードのまま動き続けて「戻したのに PASS」になる。
#
#   # 1. 修正前に戻す
#   git checkout origin/main -- src/lib/bridge/index.ts src/routes/domains/service.ts
#   # 2. backend を Ctrl+C で止めて pnpm dev で起動しなおす
#   ./scripts/verify-fixes.sh --env .env  # ← PASS 5 / FAIL 4 になる
#
#   # 3. 元に戻す
#   git checkout HEAD -- src/lib/bridge/index.ts src/routes/domains/service.ts
#   # 4. backend をまた起動しなおす
#   ./scripts/verify-fixes.sh --env .env  # ← PASS 11 / FAIL 0 になる
#
# 注意: レジストリとの通信が 10回に1回くらい失敗する（"レジストリへの接続中に問題が
#       発生しました" = network_error）。この修正とは無関係の別問題なので、
#       出たらもう一度流す。

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

PASS=0
FAIL=0
step() { printf "\n${YELLOW}==> %s${RESET}\n" "$*"; }
ok()   { PASS=$((PASS+1)); printf "${GREEN}✓${RESET} %s\n" "$*"; }
ng()   { FAIL=$((FAIL+1)); printf "${RED}✗ %s${RESET}\n" "$*"; }
note() { printf "${CYAN}  %s${RESET}\n" "$*"; }
# _load-env.sh の fail() 契約 (エラーで exit 1) に合わせる
fail() { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

# expect <期待HTTP> <実際HTTP> <ラベル> [レスポンス]
expect() {
  if [ "$1" = "$2" ]; then
    ok "$3（HTTP $2）"
  else
    ng "$3 — 期待 $1 / 実際 $2"
    [ -n "${4:-}" ] && note "$4"
    case "${4:-}" in
      *"レジストリへの接続中に問題"*)
        note "↑ 一時的な通信エラーです。修正の問題ではないので、もう一度流してください" ;;
    esac
  fi
}

status_of() { echo "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
body_of()   { echo "$1" | sed 's/__HTTP__[0-9]*$//'; }
json_str()  { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./_load-env.sh
source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

TS="$(date +%s)"
EMAIL="verify.$TS@example.com"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

step "準備: テストユーザーを作ってログイン"
curl -sS -X POST "$BACKEND_URL/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer $SECRET_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"name\":\"Taro Test\",\"password\":\"admin123\"}" >/dev/null
SIGNIN="$(curl -sS -X POST "$BACKEND_URL/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "$JAR" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"admin123\"}")"
if ! echo "$SIGNIN" | grep -q '"token"'; then
  printf "${RED}✗ ログインできません。backend が起動しているか確認してください${RESET}\n" >&2
  exit 1
fi
ok "ログイン完了"

# ── 修正3: hello が kitaqnic のレスポンス形を読めるか ───────────────────────
step "修正3: .xyz（kitaqnic 管轄）が解決できるか"
note "直っていないと 400「拡張子に対応していません」になる"
RES="$(curl -sS -X POST "$BACKEND_URL/api/v1/public/domains/check" \
  -H "Content-Type: application/json" -d '{"name":"example.xyz"}' -w "\n__HTTP__%{http_code}")"
expect 200 "$(status_of "$RES")" ".xyz が解決できる" "$(body_of "$RES")"
note "$(body_of "$RES")"

# ── 修正1 と 4: restore ─────────────────────────────────────────────────────
step "準備: .com のドメインを作って廃止する"
CR="$(curl -sS -X POST "$BACKEND_URL/api/v1/secure/domains" -b "$JAR" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"verify-$TS.com\",\"period\":{\"unit\":\"Y\",\"value\":1}}" -w "\n__HTTP__%{http_code}")"
expect 201 "$(status_of "$CR")" "ドメイン作成" "$(body_of "$CR")"
ID="$(json_str "$(body_of "$CR")" id)"
note "domain=verify-$TS.com  id=$ID"

DEL="$(curl -sS -X DELETE "$BACKEND_URL/api/v1/secure/domains/$ID" -b "$JAR" -w "\n__HTTP__%{http_code}")"
expect 200 "$(status_of "$DEL")" "廃止（pendingDelete へ）" "$(body_of "$DEL")"
note "status = $(json_str "$(body_of "$DEL")" status)"

step "修正4: 復旧後の status がレジストリの値になるか"
RS="$(curl -sS -X POST "$BACKEND_URL/api/v1/secure/domains/$ID/restore" -b "$JAR" -w "\n__HTTP__%{http_code}")"
expect 200 "$(status_of "$RS")" "復旧できる" "$(body_of "$RS")"
RS_STATUS="$(json_str "$(body_of "$RS")" status)"
if [ "$RS_STATUS" = "pendingDelete" ]; then
  ng "復旧したのに status が pendingDelete のまま"
else
  ok "status が pendingDelete から抜けた（${RS_STATUS}）"
fi

step "修正1: 復旧済みをもう一度 restore → 409 か"
note "直っていないと 500「レジストリから予期しない応答がありました」になる"
AGAIN="$(curl -sS -X POST "$BACKEND_URL/api/v1/secure/domains/$ID/restore" -b "$JAR" -w "\n__HTTP__%{http_code}")"
expect 409 "$(status_of "$AGAIN")" "復旧できない状態は 409" "$(body_of "$AGAIN")"
note "$(body_of "$AGAIN")"

# ── 修正2: delete も同じ ────────────────────────────────────────────────────
step "修正2: 廃止済みをもう一度 delete → 409 か"
note "直っていないと 500 になる"
curl -sS -o /dev/null -X DELETE "$BACKEND_URL/api/v1/secure/domains/$ID" -b "$JAR"
AGAIN2="$(curl -sS -X DELETE "$BACKEND_URL/api/v1/secure/domains/$ID" -b "$JAR" -w "\n__HTTP__%{http_code}")"
expect 409 "$(status_of "$AGAIN2")" "廃止できない状態は 409" "$(body_of "$AGAIN2")"
note "$(body_of "$AGAIN2")"

# ── 修正3の本命: kitaqnic のドメインで復旧まで通るか ─────────────────────────
step "修正3の本命: .xyz を作って廃止 → 復旧まで通るか"
note "直っていないと、そもそも作成が失敗する"
XCR="$(curl -sS -X POST "$BACKEND_URL/api/v1/secure/domains" -b "$JAR" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"verify-$TS.xyz\",\"period\":{\"unit\":\"Y\",\"value\":1}}" -w "\n__HTTP__%{http_code}")"
expect 201 "$(status_of "$XCR")" ".xyz を作成できる" "$(body_of "$XCR")"
XID="$(json_str "$(body_of "$XCR")" id)"
if [ -n "$XID" ]; then
  note "registry = $(json_str "$(body_of "$XCR")" registry)"
  XDEL="$(curl -sS -X DELETE "$BACKEND_URL/api/v1/secure/domains/$XID" -b "$JAR" -w "\n__HTTP__%{http_code}")"
  expect 200 "$(status_of "$XDEL")" ".xyz を廃止できる" "$(body_of "$XDEL")"
  XRS="$(curl -sS -X POST "$BACKEND_URL/api/v1/secure/domains/$XID/restore" -b "$JAR" -w "\n__HTTP__%{http_code}")"
  expect 200 "$(status_of "$XRS")" ".xyz を復旧できる" "$(body_of "$XRS")"
fi

printf "\n"; printf "%s\n" "----------------------------------------"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "$PASS" "$FAIL"
printf '%s\n' "----------------------------------------"
[ "$FAIL" -eq 0 ]
