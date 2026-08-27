#!/usr/bin/env bash
# create-seed-user.sh
# テスト用アカウントを作る。ローカルにも本番にも使える。
#
# 使い方:
#   ./scripts/create-seed-user.sh                                  # ローカル (localhost:8787)
#   ./scripts/create-seed-user.sh --prod                           # 本番
#   ./scripts/create-seed-user.sh --prod --email me@example.com    # メールを指定
#
# SECRET_KEY の渡し方 (上から順に探す):
#   1. 環境変数 SECRET_KEY
#   2. --env <path> で指定した env ファイル
#   3. ローカルなら apps/backend/.env を自動で読む
#   いずれも無ければ、その場で入力を求める (画面に表示されない)。
#
# なぜスクリプトにするか:
#   curl を直接共有すると、コマンドの中に SECRET_KEY を書くことになる。
#   チャットや手順書に貼られた瞬間そこに残り続けるので、鍵は値として渡さない。

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

info() { printf "${CYAN}  %s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
fail() { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

LOCAL_URL="http://localhost:8787"
PROD_URL="https://backend-production.fatricepaddy.workers.dev"

TARGET="local"
BASE_URL=""
ENV_FILE=""
EMAIL="taro.test@example.com"
NAME="Taro Test"
PASSWORD="admin123"

usage() {
  cat <<'USAGE'
使い方: ./scripts/create-seed-user.sh [オプション]

  --prod              本番に作る (既定はローカル)
  --url <url>         接続先を直接指定する
  --env <path>        SECRET_KEY を含む env ファイル
  --email <address>   作成するメールアドレス (既定: taro.test@example.com)
  --name <name>       表示名 (既定: Taro Test)
  --password <pass>   パスワード (既定: admin123)
  -h, --help          この使い方を表示

例:
  ./scripts/create-seed-user.sh --prod
  SECRET_KEY=xxx ./scripts/create-seed-user.sh --prod --email hanako@example.com
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --prod)     TARGET="prod"; shift ;;
    --url)      BASE_URL="${2:-}"; shift 2 ;;
    --env)      ENV_FILE="${2:-}"; shift 2 ;;
    --email)    EMAIL="${2:-}"; shift 2 ;;
    --name)     NAME="${2:-}"; shift 2 ;;
    --password) PASSWORD="${2:-}"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          fail "不明なオプション: $1（--help で使い方を表示）" ;;
  esac
done

if [ -z "${BASE_URL}" ]; then
  if [ "${TARGET}" = "prod" ]; then BASE_URL="${PROD_URL}"; else BASE_URL="${LOCAL_URL}"; fi
fi

# --- SECRET_KEY の解決 -------------------------------------------------------
# env ファイルは source せず、必要な 1 行だけ読む。
# source すると KITAQSIGN_* などが丸ごと現在のシェルに載ってしまう。
read_secret_from_file() {
  local path="$1"
  [ -f "${path}" ] || return 1
  local line
  line="$(grep -E '^\s*SECRET_KEY=' "${path}" | tail -1)" || return 1
  [ -n "${line}" ] || return 1
  # KEY=value の value 部分だけ取り、前後の引用符を外す
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "${line}"
}

SECRET_KEY="${SECRET_KEY:-}"

if [ -z "${SECRET_KEY}" ] && [ -n "${ENV_FILE}" ]; then
  SECRET_KEY="$(read_secret_from_file "${ENV_FILE}")" || fail "${ENV_FILE} に SECRET_KEY がありません"
fi

# ローカル向けのときだけ、既定の .env を探しに行く。
# 本番の鍵がローカルの .env に入っていることは無いので、prod では自動で読まない。
if [ -z "${SECRET_KEY}" ] && [ "${TARGET}" = "local" ]; then
  SECRET_KEY="$(read_secret_from_file "${SCRIPT_DIR}/../.env")" || true
fi

if [ -z "${SECRET_KEY}" ]; then
  # -s: 入力を画面に出さない。履歴にも残らない
  printf "SECRET_KEY を入力してください（表示されません）: "
  read -rs SECRET_KEY
  printf "\n"
fi

[ -n "${SECRET_KEY}" ] || fail "SECRET_KEY が空です"

# --- 実行 --------------------------------------------------------------------
printf "\n${YELLOW}==> アカウントを作成${RESET}\n"
info "接続先: ${BASE_URL}"
info "メール: ${EMAIL}"

RESPONSE="$(curl -sS -X POST "${BASE_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"email\":\"${EMAIL}\",\"name\":\"${NAME}\",\"password\":\"${PASSWORD}\"}")" \
  || fail "接続できませんでした（${BASE_URL} が起動しているか確認してください）"

STATUS="$(printf '%s' "${RESPONSE}" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p')"
BODY="$(printf '%s' "${RESPONSE}" | sed 's/__HTTP__[0-9]*$//')"

case "${STATUS}" in
  200|201)
    ok "作成しました（HTTP ${STATUS}）"
    printf "\n${GREEN}このアカウントでログインできます${RESET}\n"
    info "メール:     ${EMAIL}"
    info "パスワード: ${PASSWORD}"
    ;;
  401|403)
    fail "SECRET_KEY が違います（HTTP ${STATUS}）"
    ;;
  409)
    # 作り直しではなく「もう使える」ので、失敗にはしない
    ok "既に存在します（HTTP ${STATUS}）。このアカウントでログインできます"
    info "メール:     ${EMAIL}"
    info "パスワード: ${PASSWORD}"
    ;;
  *)
    printf "${RED}✗ 作成に失敗しました（HTTP ${STATUS}）${RESET}\n" >&2
    printf "%s\n" "${BODY}" >&2
    exit 1
    ;;
esac
