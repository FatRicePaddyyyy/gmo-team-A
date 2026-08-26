#!/usr/bin/env bash
# create-e2e-kitaqsign.sh
# POST /api/v1/secure/domains の網羅検証 (Kitaqsign = .com)。
#
# 使い方:
#   ./scripts/lifecycle/create-e2e-kitaqsign.sh --env .env
#
# 検証項目:
#   (a) 新規作成             → 201 + registry=kitaqsign
#   (b) 二重作成 (409)       → 同じ name で再度叩く
#   (c) 未対応 TLD           → 400 or 422
#   (d) period 範囲外 (0年)  → 400
#   (e) period 範囲外 (11年) → 400
#   (f) 認証なし             → 401

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
seed_user_and_signin "create.test.${TS}@example.com" "admin123" "Taro Test"

# --- (a) 新規作成 -----------------------------------------------------------
NAME_A="create-e2e-${TS}.${TLD}"
step "(a) 新規作成: ${NAME_A}"
RES_A="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"${NAME_A}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
BODY_A="$(http_body "${RES_A}")"
expect 201 "$(http_status "${RES_A}")" "新規作成 (HTTP 201)" "${BODY_A}"
if echo "${BODY_A}" | grep -q '"registry":"kitaqsign"'; then
  ok "registry=kitaqsign と判定"
else
  ng "registry=kitaqsign と判定されていない: ${BODY_A}"
fi
DOMAIN_ID="$(json_str "${BODY_A}" id)"

# --- (b) 二重作成 (409) -----------------------------------------------------
step "(b) 二重作成: 同じ ${NAME_A} を再度作成 → 409 期待"
RES_B="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"${NAME_A}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
expect 409 "$(http_status "${RES_B}")" "二重作成は 409" "$(http_body "${RES_B}")"

# --- (c) 未対応 TLD ---------------------------------------------------------
step "(c) 未対応 TLD (.thisisnotarealtld)"
RES_C="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"invalid-${TS}.thisisnotarealtld\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
STATUS_C="$(http_status "${RES_C}")"
if [ "${STATUS_C}" = "400" ] || [ "${STATUS_C}" = "422" ]; then
  ok "未対応 TLD は 400/422 (HTTP ${STATUS_C})"
else
  ng "未対応 TLD で HTTP ${STATUS_C}: $(http_body "${RES_C}")"
fi

# --- (d) period=0 (Zod で 400) -----------------------------------------------
step "(d) period=0 → 400"
RES_D="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"zero-${TS}.${TLD}\",\"period\":{\"unit\":\"Y\",\"value\":0}}")"
expect 400 "$(http_status "${RES_D}")" "period=0 は 400" "$(http_body "${RES_D}")"

# --- (e) period=11 (Zod で 400) ---------------------------------------------
step "(e) period=11 → 400"
RES_E="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"eleven-${TS}.${TLD}\",\"period\":{\"unit\":\"Y\",\"value\":11}}")"
expect 400 "$(http_status "${RES_E}")" "period=11 は 400" "$(http_body "${RES_E}")"

# --- (f) 認証なし → 401 -----------------------------------------------------
step "(f) 認証なしで create → 401"
NO_AUTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"noauth-${TS}.${TLD}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
expect 401 "${NO_AUTH_STATUS}" "認証なしは 401"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  created id : ${DOMAIN_ID}\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
