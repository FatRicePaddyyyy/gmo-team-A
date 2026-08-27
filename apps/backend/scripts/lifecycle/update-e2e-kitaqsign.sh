#!/usr/bin/env bash
# update-e2e-kitaqsign.sh
# PUT /api/v1/secure/domains/{id} の網羅検証 (Kitaqsign = .com)。
#
# 使い方:
#   ./scripts/lifecycle/update-e2e-kitaqsign.sh --env .env
#
# 検証項目 (A-1 〜 A-11):
#   (a) nameServers 差し替え             → 200
#   (b) 空 body (no-op)                  → 200
#   (c) addStatuses に clientTransferProhibited → 200
#   (d) remStatuses で status 解除       → 200
#   (e) add と rem に同一 status 同時    → 400 (Zod refine)
#   (f) chg.authInfo で authInfo ローテ  → 200
#   (g) chg.registrant を不在 contact に → 400 or 500
#   (h) clientUpdateProhibited 付与済み → 409
#   (i) 認証なし                          → 401
#   (j) 別ユーザーのドメイン              → 404
#   (k) 存在しない ID                     → 404

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

PASS=0; FAIL=0
step() { printf "\n${YELLOW}==> %s${RESET}\n" "$*"; }
ok()   { PASS=$((PASS+1)); printf "${GREEN}✓${RESET} %s\n" "$*"; }
ng()   { FAIL=$((FAIL+1)); printf "${RED}✗ %s${RESET}\n" "$*"; }
fail() { printf "\n${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=../_load-env.sh
source "${SCRIPT_DIR}/../_load-env.sh"
# shellcheck source=../_lifecycle-helpers.sh
source "${SCRIPT_DIR}/../_lifecycle-helpers.sh"
parse_env_args "$@"
load_env_files

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
TLD="com"
TS="$(date +%s)"

check_backend "${TLD}"
seed_user_and_signin "update.test.${TS}@example.com" "admin123" "Taro Test"

NAME="update-e2e-${TS}.${TLD}"
create_domain "${NAME}" 1
MAIN_ID="${DOMAIN_ID}"

# --- (a) nameServers 差し替え -----------------------------------------------
step "(a) nameServers 差し替え"
RES_A="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"nameServers\":[\"ns1.example.com\",\"ns2.example.com\"]}")"
expect 200 "$(http_status "${RES_A}")" "nameServers 差し替えは 200" "$(http_body "${RES_A}")"

# --- (b) 空 body (no-op) ----------------------------------------------------
step "(b) 空 body で PUT"
RES_B="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{}")"
STATUS_B="$(http_status "${RES_B}")"
if [ "${STATUS_B}" = "200" ] || [ "${STATUS_B}" = "400" ]; then
  ok "空 body は 200 (no-op) or 400 (仕様依存) (HTTP ${STATUS_B})"
else
  ng "空 body で HTTP ${STATUS_B}: $(http_body "${RES_B}")"
fi

# --- (c) addStatuses (clientTransferProhibited) -----------------------------
step "(c) addStatuses に clientTransferProhibited を付与"
RES_C="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"addStatuses\":[\"clientTransferProhibited\"]}")"
expect 200 "$(http_status "${RES_C}")" "addStatuses は 200" "$(http_body "${RES_C}")"

# --- (d) remStatuses (直前に付けた clientTransferProhibited を解除) ---------
step "(d) remStatuses で clientTransferProhibited を解除"
RES_D="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"remStatuses\":[\"clientTransferProhibited\"]}")"
expect 200 "$(http_status "${RES_D}")" "remStatuses は 200" "$(http_body "${RES_D}")"

# --- (e) add と rem に同一 status 同時 (Zod refine で 400) -----------------
step "(e) addStatuses と remStatuses に同一値 → 400"
RES_E="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"addStatuses\":[\"clientHold\"],\"remStatuses\":[\"clientHold\"]}")"
expect 400 "$(http_status "${RES_E}")" "add/rem 重複は 400" "$(http_body "${RES_E}")"

# --- (f) chg.authInfo ローテ ------------------------------------------------
step "(f) chg.authInfo で authInfo をローテ"
RES_F="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"chg\":{\"authInfo\":\"new-secret-${TS}\"}}")"
expect 200 "$(http_status "${RES_F}")" "chg.authInfo は 200" "$(http_body "${RES_F}")"

# --- (g) chg.registrant を不在 contact に -----------------------------------
step "(g) chg.registrant を不在 contact ID に → 400 or 500"
RES_G="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"chg\":{\"registrant\":\"C-DOES-NOT-EXIST-${TS}\"}}")"
STATUS_G="$(http_status "${RES_G}")"
if [ "${STATUS_G}" = "400" ] || [ "${STATUS_G}" = "404" ] || [ "${STATUS_G}" = "500" ]; then
  ok "不在 contact ID は 400/404/500 (HTTP ${STATUS_G})"
else
  ng "不在 contact ID で HTTP ${STATUS_G}: $(http_body "${RES_G}")"
fi

# --- (h) clientUpdateProhibited を付けた状態で update → 409 -----------------
step "(h) clientUpdateProhibited を付けた後に他の update → 409"
# 別ドメインで検証 (main を壊さない)
NAME_H="update-h-${TS}.${TLD}"
create_domain "${NAME_H}" 1
H_ID="${DOMAIN_ID}"
# まず clientUpdateProhibited を add
RES_H0="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${H_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"addStatuses\":[\"clientUpdateProhibited\"]}")"
STATUS_H0="$(http_status "${RES_H0}")"
if [ "${STATUS_H0}" != "200" ]; then
  note "clientUpdateProhibited の付与自体が HTTP ${STATUS_H0} → 本テスト skip"
else
  RES_H="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${H_ID}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"nameServers\":[\"ns3.example.com\"]}")"
  STATUS_H="$(http_status "${RES_H}")"
  # 実装は "operation_prohibited" を 409 に写像。実レジストリが 200+2304 or HTTP 403 で返す可能性あり
  if [ "${STATUS_H}" = "409" ] || [ "${STATUS_H}" = "403" ]; then
    ok "clientUpdateProhibited 下は 409/403 (HTTP ${STATUS_H})"
  else
    ng "clientUpdateProhibited 下で HTTP ${STATUS_H}: $(http_body "${RES_H}")"
  fi
fi

# --- (i) 認証なし → 401 -----------------------------------------------------
step "(i) 認証なしで PUT → 401"
NO_AUTH="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"nameServers\":[\"ns1.example.com\"]}")"
expect 401 "${NO_AUTH}" "認証なしは 401"

# --- (j) 別ユーザーのドメイン → 404 ----------------------------------------
step "(j) 別ユーザーでサインインして他人のドメインを PUT → 404"
OTHER_JAR="$(mktemp)"
OTHER_EMAIL="update.other.${TS}@example.com"
curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"name\":\"Other User\",\"password\":\"admin123\"}" >/dev/null
curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${OTHER_JAR}" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"password\":\"admin123\"}" >/dev/null
RES_J="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${MAIN_ID}" \
  -H "Content-Type: application/json" -b "${OTHER_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"nameServers\":[\"ns1.example.com\"]}")"
expect 404 "$(http_status "${RES_J}")" "他人のドメインは 404" "$(http_body "${RES_J}")"
rm -f "${OTHER_JAR}"

# --- (k) 存在しない ID → 404 -----------------------------------------------
step "(k) 存在しない domain-id → 404"
RES_K="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"nameServers\":[\"ns1.example.com\"]}")"
expect 404 "$(http_status "${RES_K}")" "存在しない ID は 404" "$(http_body "${RES_K}")"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  target     : ${NAME} (${MAIN_ID})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
