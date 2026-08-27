#!/usr/bin/env bash
# create-domain-e2e.sh (旧版)
# 現行版は apps/backend/scripts/create-domain-e2e.sh を使うこと。
# ここは旧世代のスクリプトを歴史的経緯で残してあるだけ。
#
# ドメイン作成の一連のフローを検証する E2E テスト。
#
# 使い方:
#   pnpm run dev  # 別ターミナルで backend を起動 (8787)
#   ./scripts/create-domain-e2e.sh --env .env
#
# 環境変数でも渡せる (引数のほうが優先):
#   ENV_FILE=.env ./scripts/create-domain-e2e.sh
#
# 前提:
#   - backend が localhost:8787 で起動している
#   - --env で渡した .env に SECRET_KEY が入っている
#   - Kitaqsign / Kitaqnic のクレデンシャルは backend (wrangler dev) 側の .env で解決される

set -euo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RESET=$'\033[0m'

step() { printf "\n${YELLOW}==> %s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
fail() { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./_load-env.sh
source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

# 実行ごとに衝突しないよう timestamp で email / domain を一意化する。
# email のローカル部で "+" は Kitaqsign 側で弾かれることがあるため "." で分離する。
TIMESTAMP="$(date +%s)"
USER_EMAIL="taro.test.${TIMESTAMP}@example.com"
USER_NAME="Taro Test"
USER_PASSWORD="admin123"
DOMAIN_NAME="e2e-${TIMESTAMP}.com"

# --- backend 疎通確認 ------------------------------------------------------
step "backend の疎通確認"
if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
      -H "Content-Type: application/json" \
      -d '{"name":"example.com"}' >/dev/null; then
  fail "${BACKEND_URL} に接続できません。backend を起動してください (pnpm run dev)"
fi
ok "backend 応答あり"

# --- 1. seed user 作成 -----------------------------------------------------
step "seed user を作成: ${USER_EMAIL}"
SEED_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${USER_EMAIL}\",\"name\":\"${USER_NAME}\",\"password\":\"${USER_PASSWORD}\"}")"

if ! echo "${SEED_RES}" | grep -q '"success":true'; then
  fail "seed user 作成失敗: ${SEED_RES}"
fi
USER_ID="$(echo "${SEED_RES}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
ok "作成成功 (id=${USER_ID})"

# --- 2. better-auth でサインインしてセッション取得 --------------------------
step "サインインでセッション取得"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

SIGNIN_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -c "${COOKIE_JAR}" \
  -d "{\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASSWORD}\"}")"

if ! echo "${SIGNIN_RES}" | grep -q '"token"'; then
  fail "サインイン失敗: ${SIGNIN_RES}"
fi

SESSION_TOKEN="$(grep -E "better-auth.session_token" "${COOKIE_JAR}" | awk '{print $7}')"
if [ -z "${SESSION_TOKEN}" ]; then
  fail "セッションクッキーを取得できませんでした"
fi
ok "セッション取得完了"

# --- 3. 認証必須の create domain を叩く ------------------------------------
step "ドメイン作成: ${DOMAIN_NAME}"
CREATE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" \
  -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"${DOMAIN_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"

CREATE_STATUS="$(echo "${CREATE_RES}" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p')"
CREATE_BODY="$(echo "${CREATE_RES}" | sed 's/__HTTP__[0-9]*$//')"

if [ "${CREATE_STATUS}" != "201" ]; then
  fail "ドメイン作成失敗 (HTTP ${CREATE_STATUS}): ${CREATE_BODY}"
fi
if ! echo "${CREATE_BODY}" | grep -q "\"name\":\"${DOMAIN_NAME}\""; then
  fail "レスポンスに作成ドメインが含まれない: ${CREATE_BODY}"
fi
if ! echo "${CREATE_BODY}" | grep -q "\"registry\":\"kitaqsign\""; then
  fail "レジストリが kitaqsign と判定されていない: ${CREATE_BODY}"
fi
DOMAIN_ID="$(echo "${CREATE_BODY}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
ok "作成成功 (id=${DOMAIN_ID}, registry=kitaqsign)"

# --- 4. GET /domains 一覧に含まれるか確認 -----------------------------------
step "ドメイン一覧で作成結果を確認"
LIST_RES="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains" -b "${COOKIE_JAR}")"

if ! echo "${LIST_RES}" | grep -q "\"name\":\"${DOMAIN_NAME}\""; then
  fail "一覧に作成したドメインが含まれない: ${LIST_RES}"
fi
ok "一覧に ${DOMAIN_NAME} が含まれる"

# --- 完了 -------------------------------------------------------------------
printf "\n${GREEN}=== E2E 完了 ===${RESET}\n"
printf "  user_id    : %s\n" "${USER_ID}"
printf "  user_email : %s\n" "${USER_EMAIL}"
printf "  domain_id  : %s\n" "${DOMAIN_ID}"
printf "  domain_name: %s\n" "${DOMAIN_NAME}"
