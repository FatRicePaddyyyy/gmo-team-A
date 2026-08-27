#!/usr/bin/env bash
# check-e2e-kitaqnic.sh
# POST /api/v1/public/domains/check の網羅検証 (Kitaqnic = .xyz)。
#
# 使い方:
#   ./scripts/lifecycle/check-e2e-kitaqnic.sh --env .env

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

step "(a) 空きあり: 一意な .${TLD}"
NAME_A="check-e2e-${TS}.${TLD}"
RES_A="$(curl -sS -X POST "${BACKEND_URL}/api/v1/public/domains/check" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"${NAME_A}\"}")"
expect 200 "$(http_status "${RES_A}")" "空きあり (HTTP 200)" "$(http_body "${RES_A}")"
if echo "$(http_body "${RES_A}")" | grep -q '"avail":true'; then
  ok "avail=true"
else
  ng "avail が true でない: $(http_body "${RES_A}")"
fi

step "(b) 空きなし: example.${TLD} (予約ドメイン想定)"
RES_B="$(curl -sS -X POST "${BACKEND_URL}/api/v1/public/domains/check" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"example.${TLD}\"}")"
expect 200 "$(http_status "${RES_B}")" "空きなし応答 (HTTP 200)" "$(http_body "${RES_B}")"

step "(c) 不正形式: TLD 無し (invalid-name)"
RES_C="$(curl -sS -X POST "${BACKEND_URL}/api/v1/public/domains/check" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP__%{http_code}" \
  -d '{"name":"invalid-name"}')"
STATUS_C="$(http_status "${RES_C}")"
if [ "${STATUS_C}" = "400" ] || [ "${STATUS_C}" = "422" ]; then
  ok "不正形式は 400/422 (HTTP ${STATUS_C})"
else
  ng "不正形式で HTTP ${STATUS_C} を返した (400 or 422 を期待): $(http_body "${RES_C}")"
fi

step "(d) 非対応TLD: .thisisnotarealtld"
RES_D="$(curl -sS -X POST "${BACKEND_URL}/api/v1/public/domains/check" \
  -H "Content-Type: application/json" \
  -w "\n__HTTP__%{http_code}" \
  -d '{"name":"example.thisisnotarealtld"}')"
STATUS_D="$(http_status "${RES_D}")"
if [ "${STATUS_D}" = "400" ] || [ "${STATUS_D}" = "422" ] || [ "${STATUS_D}" = "500" ]; then
  ok "非対応TLD は 400/422/500 (HTTP ${STATUS_D})"
else
  ng "非対応TLD で HTTP ${STATUS_D} を返した (400/422 期待): $(http_body "${RES_D}")"
fi

printf "\n%s\n" "----------------------------------------"
printf "  registry : kitaqnic (.${TLD})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
