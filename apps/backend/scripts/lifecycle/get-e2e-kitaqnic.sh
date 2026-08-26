#!/usr/bin/env bash
# get-e2e-kitaqnic.sh
# GET /api/v1/secure/domains (list) と GET /api/v1/secure/domains/{id} (info) の網羅検証
# (Kitaqnic = .xyz)
#
# 使い方:
#   ./scripts/lifecycle/get-e2e-kitaqnic.sh --env .env

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
seed_user_and_signin "get.test.${TS}@example.com" "admin123" "Taro Test"

NAME="get-e2e-${TS}.${TLD}"
create_domain "${NAME}" 1

step "(a) 一覧取得 → 200 + 作成 domain を含む"
LIST_RES="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}")"
expect 200 "$(http_status "${LIST_RES}")" "list HTTP 200" "$(http_body "${LIST_RES}")"
if echo "$(http_body "${LIST_RES}")" | grep -q "\"name\":\"${NAME}\""; then
  ok "一覧に ${NAME} が含まれる"
else
  ng "一覧に ${NAME} が含まれない: $(http_body "${LIST_RES}")"
fi

step "(b) 一覧取得 認証なし → 401"
NO_AUTH_LIST="$(curl -sS -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/v1/secure/domains")"
expect 401 "${NO_AUTH_LIST}" "認証なしの list は 401"

step "(c) 詳細取得 → 200 + 必須フィールド"
INFO_RES="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
INFO_BODY="$(http_body "${INFO_RES}")"
expect 200 "$(http_status "${INFO_RES}")" "info HTTP 200" "${INFO_BODY}"
MISSING=0
for field in id name registry status expiresAt createdAt ownerUserId autoRenew statuses registrant contacts nameservers rgpStatus upDate trDate; do
  if ! echo "${INFO_BODY}" | grep -q "\"${field}\""; then
    ng "info に ${field} が無い"
    MISSING=1
  fi
done
[ "${MISSING}" = "0" ] && ok "必須フィールド全て存在"

step "(d) info 認証なし → 401"
NO_AUTH_INFO="$(curl -sS -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}")"
expect 401 "${NO_AUTH_INFO}" "認証なしの info は 401"

step "(e) 存在しない ID → 404"
BOGUS_ID="00000000-0000-0000-0000-000000000000"
BOGUS_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  "${BACKEND_URL}/api/v1/secure/domains/${BOGUS_ID}" -b "${COOKIE_JAR}")"
expect 404 "${BOGUS_STATUS}" "存在しない ID は 404"

step "(f) 別ユーザーで作った domain の ID を叩く → 404"
OTHER_JAR="$(mktemp)"
trap 'rm -f "${OTHER_JAR}"; rm -f "${COOKIE_JAR}"' EXIT
OTHER_EMAIL="get.other.${TS}@example.com"
curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"name\":\"Other User\",\"password\":\"admin123\"}" >/dev/null
curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${OTHER_JAR}" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"password\":\"admin123\"}" >/dev/null
OTHER_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${OTHER_JAR}")"
expect 404 "${OTHER_STATUS}" "他人の ID は 404 (認可)"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqnic (.${TLD})\n"
printf "  target id  : ${DOMAIN_ID}\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
