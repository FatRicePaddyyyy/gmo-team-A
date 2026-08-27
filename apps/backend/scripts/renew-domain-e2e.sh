#!/usr/bin/env bash
# renew-domain-e2e.sh (旧版)
# POST /api/v1/secure/domains/{domain-id}/renew (renew) の動作確認スクリプト。
#
# 使い方:
#   ./scripts/renew-domain-e2e.sh --env .env                 # ドメインを作るところからやる
#   ./scripts/renew-domain-e2e.sh --env .env <domain-id>     # 既存のドメインで試す
#
# 環境変数でも渡せる (引数のほうが優先):
#   ENV_FILE=.env ./scripts/renew-domain-e2e.sh
#
# 前提:
#   - backend が localhost:8787 で起動している (pnpm run dev)
#   - --env で渡した .env に SECRET_KEY が入っている
#   - .env にレジストリの認証情報が入っている (backend 側で解決)
#
# フロー:
#   1. seed user を作成 → サインイン
#   2. 対象ドメインを用意する（引数が無ければ新規作成）
#   3. 更新前の有効期限を控える
#   4. renew を叩き、有効期限が延びたかを確認する
#
# 確認する内容:
#   (a) 1年延長          → 200 / expiresAt が1年後
#   (b) 期間 0 年        → 400（範囲外。Swagger は 1-10 年）
#   (c) 期間 11 年       → 400（同上）
#   (d) 更新禁止のドメイン → 409（update で clientRenewProhibited を付けて作る）
#   (e) 認証なし         → 401
#   (f) 存在しない ID    → 404
#
# 注意:
#   レジストリとの通信が時々失敗する（"レジストリへの接続中に問題が発生しました"）。
#   これは運営側で調査中の別問題なので、出たらもう一度流す。

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
warn() { printf "${CYAN}!${RESET} %s\n" "$*"; }
note() { printf "${CYAN}  %s${RESET}\n" "$*"; }
die()  { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }
# _load-env.sh の fail() 契約 (エラーで exit 1) に合わせるためのエイリアス
fail() { die "$@"; }

http_status() { echo "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
http_body()   { echo "$1" | sed 's/__HTTP__[0-9]*$//'; }
json_str()    { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

# expect <期待HTTP> <実際HTTP> <ラベル> [レスポンス]
expect() {
  if [ "$1" = "$2" ]; then
    ok "$3（HTTP $2）"
  else
    ng "$3 — 期待 $1 / 実際 $2"
    [ -n "${4:-}" ] && note "$4"
    case "${4:-}" in
      *"レジストリへの接続中に問題"*)
        note "↑ 一時的な通信エラーです（運営側で調査中）。もう一度流してください" ;;
    esac
  fi
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./_load-env.sh
source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files

DOMAIN_ID="${POSITIONAL_ARGS[0]:-}"

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

TIMESTAMP="$(date +%s)"
USER_EMAIL="${USER_EMAIL:-renew.tester.${TIMESTAMP}@example.com}"
USER_NAME="${USER_NAME:-Taro Test}"
USER_PASSWORD="${USER_PASSWORD:-admin123}"
if [ "${USER_EMAIL}" != "renew.tester.${TIMESTAMP}@example.com" ]; then
  REUSE_EXISTING_USER=1
else
  REUSE_EXISTING_USER=0
fi

# --- backend 疎通確認 ------------------------------------------------------
step "backend の疎通確認"
if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
      -H "Content-Type: application/json" \
      -d '{"name":"example.com"}' >/dev/null; then
  die "${BACKEND_URL} に接続できません。backend を起動してください (pnpm run dev)"
fi
ok "backend 応答あり"

# --- seed user 作成 / サインイン --------------------------------------------
if [ "${REUSE_EXISTING_USER}" = "1" ]; then
  step "既存ユーザーを使用: ${USER_EMAIL}"
else
  step "seed user を作成: ${USER_EMAIL}"
  SEED_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
    -H "Authorization: Bearer ${SECRET_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${USER_EMAIL}\",\"name\":\"${USER_NAME}\",\"password\":\"${USER_PASSWORD}\"}")"
  echo "${SEED_RES}" | grep -q '"success":true' || die "seed user 作成失敗: ${SEED_RES}"
  ok "作成成功"
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

SIGNIN_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${COOKIE_JAR}" \
  -d "{\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASSWORD}\"}")"
echo "${SIGNIN_RES}" | grep -q '"token"' || die "サインイン失敗: ${SIGNIN_RES}"
ok "セッション取得完了"

# --- 対象ドメインの用意 ----------------------------------------------------
if [ -z "${DOMAIN_ID}" ]; then
  DOMAIN_NAME="renew-e2e-${TIMESTAMP}.com"
  step "対象ドメインを新規作成: ${DOMAIN_NAME}"
  CREATE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"name\":\"${DOMAIN_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
  [ "$(http_status "${CREATE_RES}")" = "201" ] \
    || die "ドメイン作成失敗 (HTTP $(http_status "${CREATE_RES}")): $(http_body "${CREATE_RES}")"
  DOMAIN_ID="$(json_str "$(http_body "${CREATE_RES}")" id)"
  ok "作成成功 (id=${DOMAIN_ID}, name=${DOMAIN_NAME})"
else
  step "既存ドメインを使用: ${DOMAIN_ID}"
fi

BEFORE_BODY="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}")"
BEFORE_EXP="$(json_str "${BEFORE_BODY}" expiresAt)"
note "更新前の有効期限: ${BEFORE_EXP:-取得できず}"

# --- (a) 1年延長 ------------------------------------------------------------
step "(a) 1年延長 → 200 / 有効期限が1年後になるか"
RENEW_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d '{"period":{"unit":"Y","value":1}}')"
RENEW_STATUS="$(http_status "${RENEW_RES}")"
RENEW_BODY="$(http_body "${RENEW_RES}")"
expect 200 "${RENEW_STATUS}" "1年延長できる" "${RENEW_BODY}"

if [ "${RENEW_STATUS}" = "200" ]; then
  AFTER_EXP="$(json_str "${RENEW_BODY}" expiresAt)"
  note "更新後の有効期限: ${AFTER_EXP}"
  BEFORE_Y="${BEFORE_EXP:0:4}"
  AFTER_Y="${AFTER_EXP:0:4}"
  if [ -n "${BEFORE_Y}" ] && [ -n "${AFTER_Y}" ] && [ "${AFTER_Y}" -eq $((BEFORE_Y + 1)) ] 2>/dev/null; then
    ok "有効期限が1年延びた（${BEFORE_Y} → ${AFTER_Y}）"
  else
    ng "有効期限が1年延びていない（${BEFORE_EXP} → ${AFTER_EXP}）"
  fi

  GET_BODY="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}")"
  GET_EXP="$(json_str "${GET_BODY}" expiresAt)"
  if [ "${GET_EXP:0:4}" = "${AFTER_Y}" ]; then
    ok "GET でも延長後の有効期限になっている"
  else
    ng "GET が延長前のまま（${GET_EXP}）"
  fi
fi

# --- (b)(c) 期間の範囲外 -----------------------------------------------------
step "(b) 期間 0 年 → 400 を期待"
ZERO_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":0}}')"
expect 400 "$(http_status "${ZERO_RES}")" "0年は弾かれる" "$(http_body "${ZERO_RES}")"

step "(c) 期間 11 年 → 400 を期待（Swagger は 1-10 年）"
ELEVEN_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":11}}')"
expect 400 "$(http_status "${ELEVEN_RES}")" "11年は弾かれる" "$(http_body "${ELEVEN_RES}")"

# --- (d) 更新禁止のドメイン --------------------------------------------------
step "(d) 更新禁止（clientRenewProhibited）を付けて renew → 409 を期待"
LOCK_RES="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"addStatuses":["clientRenewProhibited"]}')"
LOCK_STATUS="$(http_status "${LOCK_RES}")"

if [ "${LOCK_STATUS}" != "200" ]; then
  warn "更新禁止を付けられませんでした (HTTP ${LOCK_STATUS})。このケースは確認できません"
  note "$(http_body "${LOCK_RES}")"
else
  ok "更新禁止を付けた"
  PROHIBITED_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":1}}')"
  note "直っていないと 500「レジストリから予期しない応答がありました」になる"
  expect 409 "$(http_status "${PROHIBITED_RES}")" "更新禁止のドメインは 409" "$(http_body "${PROHIBITED_RES}")"

  UNLOCK_RES="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" -d '{"remStatuses":["clientRenewProhibited"]}')"
  if [ "$(http_status "${UNLOCK_RES}")" = "200" ]; then
    note "更新禁止を外した"
  else
    warn "更新禁止を外せませんでした (HTTP $(http_status "${UNLOCK_RES}"))。手動で外してください"
  fi
fi

# --- (e) 認証なし ------------------------------------------------------------
step "(e) 認証なしで renew → 401 を期待"
NO_AUTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -d '{"period":{"unit":"Y","value":1}}')"
expect 401 "${NO_AUTH_STATUS}" "認証必須が効いている"

# --- (f) 存在しない ID -------------------------------------------------------
step "(f) 存在しない ID で renew → 404 を期待"
BOGUS_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":1}}')"
expect 404 "$(http_status "${BOGUS_RES}")" "存在しないドメインは 404" "$(http_body "${BOGUS_RES}")"

# --- 完了 -------------------------------------------------------------------
printf "\n"; printf "%s\n" "----------------------------------------"
printf "  domain_id : %s\n" "${DOMAIN_ID}"
printf "  有効期限   : %s -> %s\n" "${BEFORE_EXP:-?}" "${AFTER_EXP:-未更新}"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
