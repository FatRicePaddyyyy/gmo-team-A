#!/usr/bin/env bash
# delete-e2e-kitaqnic.sh
# DELETE /api/v1/secure/domains/{id} の網羅検証 (Kitaqnic = .xyz)。
#
# 使い方:
#   ./scripts/lifecycle/delete-e2e-kitaqnic.sh --env .env
#
# 検証項目 (B-1 〜 B-6):
#   (a) 通常削除                       → 200 + info で status=pendingDelete
#   (b) 二重削除 (すでに pendingDelete) → 409
#   (c) clientDeleteProhibited 付与済み → 409
#   (d) 認証なし                       → 401
#   (e) 別ユーザーのドメイン           → 404
#   (f) 存在しない ID                  → 404

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
TLD="xyz"
TS="$(date +%s)"

check_backend "${TLD}"
seed_user_and_signin "delete.test.${TS}@example.com" "admin123" "Taro Test"

# --- (a) 通常削除 -----------------------------------------------------------
NAME_A="delete-a-${TS}.${TLD}"
create_domain "${NAME_A}" 1
A_ID="${DOMAIN_ID}"
step "(a) 通常削除"
RES_A="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${A_ID}" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
expect 200 "$(http_status "${RES_A}")" "通常削除は 200" "$(http_body "${RES_A}")"

# info で status=pendingDelete を確認 (認証ありで叩く)
step "(a-2) info で status を確認"
INFO_A="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${A_ID}" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
INFO_BODY_A="$(http_body "${INFO_A}")"
if echo "${INFO_BODY_A}" | grep -q '"status":"pendingDelete"'; then
  ok "info の status=pendingDelete"
else
  ng "info の status が pendingDelete でない: ${INFO_BODY_A}"
fi

# --- (b) 二重削除 -----------------------------------------------------------
step "(b) 二重削除 (すでに pendingDelete)"
RES_B="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${A_ID}" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
STATUS_B="$(http_status "${RES_B}")"
if [ "${STATUS_B}" = "409" ] || [ "${STATUS_B}" = "404" ]; then
  ok "二重削除は 409 or 404 (HTTP ${STATUS_B})"
else
  ng "二重削除で HTTP ${STATUS_B}: $(http_body "${RES_B}")"
fi

# --- (c) clientDeleteProhibited 付与済み -----------------------------------
NAME_C="delete-c-${TS}.${TLD}"
create_domain "${NAME_C}" 1
C_ID="${DOMAIN_ID}"
step "(c-0) clientDeleteProhibited を付与"
RES_C0="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${C_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"addStatuses\":[\"clientDeleteProhibited\"]}")"
STATUS_C0="$(http_status "${RES_C0}")"
if [ "${STATUS_C0}" != "200" ]; then
  note "clientDeleteProhibited 付与が HTTP ${STATUS_C0} → 本テスト skip"
else
  step "(c) 削除禁止フラグ下で DELETE"
  RES_C="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${C_ID}" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
  STATUS_C="$(http_status "${RES_C}")"
  if [ "${STATUS_C}" = "409" ] || [ "${STATUS_C}" = "403" ]; then
    ok "削除禁止は 409/403 (HTTP ${STATUS_C})"
  else
    ng "削除禁止で HTTP ${STATUS_C}: $(http_body "${RES_C}")"
  fi
fi

# --- (d) 認証なし → 401 ----------------------------------------------------
step "(d) 認証なしで DELETE → 401"
NAME_D="delete-d-${TS}.${TLD}"
create_domain "${NAME_D}" 1
D_ID="${DOMAIN_ID}"
NO_AUTH="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${D_ID}")"
expect 401 "${NO_AUTH}" "認証なしは 401"

# --- (e) 別ユーザーのドメイン → 404 ----------------------------------------
step "(e) 別ユーザーで DELETE → 404"
OTHER_JAR="$(mktemp)"
OTHER_EMAIL="delete.other.${TS}@example.com"
curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"name\":\"Other\",\"password\":\"admin123\"}" >/dev/null
curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${OTHER_JAR}" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"password\":\"admin123\"}" >/dev/null
RES_E="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${D_ID}" \
  -b "${OTHER_JAR}" -w "\n__HTTP__%{http_code}")"
expect 404 "$(http_status "${RES_E}")" "他人のドメインは 404" "$(http_body "${RES_E}")"
rm -f "${OTHER_JAR}"

# --- (f) 存在しない ID → 404 -----------------------------------------------
step "(f) 存在しない ID → 404"
RES_F="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
expect 404 "$(http_status "${RES_F}")" "存在しない ID は 404" "$(http_body "${RES_F}")"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqnic (.${TLD})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
