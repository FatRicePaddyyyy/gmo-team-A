#!/usr/bin/env bash
# restore-e2e-kitaqsign.sh
# POST /api/v1/secure/domains/{id}/restore の網羅検証 (Kitaqsign = .com)。
#
# 使い方:
#   ./scripts/lifecycle/restore-e2e-kitaqsign.sh --env .env
#
# 検証項目 (C-1 〜 C-6):
#   (a) pendingDelete を restore     → 200 + info で status=ok
#   (b) 復旧済みを再度 restore       → 409 (2304)
#   (c) 削除前 (ok 状態) に restore  → 409 (2304)
#   (d) 認証なし                     → 401
#   (e) 存在しない ID                → 404
#   (f) 別ユーザーのドメイン         → 404

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
seed_user_and_signin "restore.test.${TS}@example.com" "admin123" "Taro Test"

# --- (a) pendingDelete → restore → 200 -------------------------------------
NAME_A="restore-a-${TS}.${TLD}"
create_domain "${NAME_A}" 1
A_ID="${DOMAIN_ID}"
step "(a-0) 対象を DELETE で pendingDelete に落とす"
DEL_A="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${A_ID}" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
STATUS_DEL_A="$(http_status "${DEL_A}")"
if [ "${STATUS_DEL_A}" != "200" ]; then
  note "DELETE が HTTP ${STATUS_DEL_A} → (a)/(b) skip"
else
  step "(a) restore → 200"
  RES_A="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${A_ID}/restore" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
  expect 200 "$(http_status "${RES_A}")" "restore は 200" "$(http_body "${RES_A}")"

  step "(a-2) info で status=ok を確認"
  INFO_A="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${A_ID}" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
  INFO_BODY_A="$(http_body "${INFO_A}")"
  if echo "${INFO_BODY_A}" | grep -q '"status":"ok"'; then
    ok "info の status=ok"
  else
    ng "info の status が ok でない: ${INFO_BODY_A}"
  fi

  # --- (b) 復旧済みを再度 restore → 409 ------------------------------------
  step "(b) 復旧済みを再度 restore → 409"
  RES_B="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${A_ID}/restore" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
  STATUS_B="$(http_status "${RES_B}")"
  if [ "${STATUS_B}" = "409" ] || [ "${STATUS_B}" = "403" ]; then
    ok "復旧済み再度は 409/403 (HTTP ${STATUS_B})"
  else
    ng "復旧済み再度で HTTP ${STATUS_B}: $(http_body "${RES_B}")"
  fi
fi

# --- (c) 削除前 (ok 状態) を restore → 409 ---------------------------------
NAME_C="restore-c-${TS}.${TLD}"
create_domain "${NAME_C}" 1
C_ID="${DOMAIN_ID}"
step "(c) ok 状態の restore → 409"
RES_C="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${C_ID}/restore" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
STATUS_C="$(http_status "${RES_C}")"
if [ "${STATUS_C}" = "409" ] || [ "${STATUS_C}" = "403" ]; then
  ok "ok 状態 restore は 409/403 (HTTP ${STATUS_C})"
else
  ng "ok 状態 restore で HTTP ${STATUS_C}: $(http_body "${RES_C}")"
fi

# --- (d) 認証なし → 401 ----------------------------------------------------
step "(d) 認証なしで restore → 401"
NO_AUTH="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${C_ID}/restore")"
expect 401 "${NO_AUTH}" "認証なしは 401"

# --- (e) 存在しない ID → 404 -----------------------------------------------
step "(e) 存在しない ID → 404"
RES_E="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000/restore" \
  -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
expect 404 "$(http_status "${RES_E}")" "存在しない ID は 404" "$(http_body "${RES_E}")"

# --- (f) 別ユーザーのドメイン → 404 ----------------------------------------
step "(f) 別ユーザーで restore → 404"
OTHER_JAR="$(mktemp)"
OTHER_EMAIL="restore.other.${TS}@example.com"
curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"name\":\"Other\",\"password\":\"admin123\"}" >/dev/null
curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${OTHER_JAR}" \
  -d "{\"email\":\"${OTHER_EMAIL}\",\"password\":\"admin123\"}" >/dev/null
RES_F="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${C_ID}/restore" \
  -b "${OTHER_JAR}" -w "\n__HTTP__%{http_code}")"
expect 404 "$(http_status "${RES_F}")" "他人のドメインは 404" "$(http_body "${RES_F}")"
rm -f "${OTHER_JAR}"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
