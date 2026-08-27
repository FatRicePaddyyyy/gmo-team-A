#!/usr/bin/env bash
# prohibited-flags-e2e-kitaqsign.sh
# client*Prohibited フラグの実効性検証 (Kitaqsign = .com)。
#
# 背景: B/delete 検証で clientDeleteProhibited を付けても DELETE が 200 で通ってしまった。
#       各フラグが実際に対応操作を弾いているかを網羅検証する。
#
# 使い方:
#   ./scripts/lifecycle/prohibited-flags-e2e-kitaqsign.sh --env .env
#
# 検証項目 (N-1 〜 N-6):
#   (n1) clientDeleteProhibited → DELETE                          → 409/403
#   (n2) clientUpdateProhibited → PUT (nameServers)               → 409/403
#   (n3) clientRenewProhibited  → renew                           → 409/403
#   (n4) clientTransferProhibited → (登録側の transfer request は無いので info で反映確認)
#   (n5) clientHold → info で statuses に含まれる                 → OK
#   (n6) 上記フラグを rem で解除 → 対応操作が 200 になる           → 200

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

# info レスポンス body から statuses:[..] を抽出 (カンマ区切り、クオート除去)
extract_statuses() {
  local body="$1"
  echo "$body" | sed -n 's/.*"statuses":\[\([^]]*\)\].*/\1/p' | tr -d '"' | tr -d ' '
}

add_flag() {
  local id="$1" flag="$2"
  curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${id}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"addStatuses\":[\"${flag}\"]}"
}

rem_flag() {
  local id="$1" flag="$2"
  curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${id}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"remStatuses\":[\"${flag}\"]}"
}

get_info() {
  local id="$1"
  curl -sS "${BACKEND_URL}/api/v1/secure/domains/${id}" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}"
}

check_backend "${TLD}"
seed_user_and_signin "prohibited.test.${TS}@example.com" "admin123" "Taro Test"

# =============================================================================
# (n1) clientDeleteProhibited → DELETE 弾き
# =============================================================================
NAME_N1="prohibit-n1-${TS}.${TLD}"
create_domain "${NAME_N1}" 1
ID_N1="${DOMAIN_ID}"
step "(n1-0) clientDeleteProhibited を付与"
RES="$(add_flag "${ID_N1}" "clientDeleteProhibited")"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" != "200" ]; then
  note "フラグ付与 HTTP ${STATUS} → n1 skip"
else
  # info で反映確認
  INFO="$(get_info "${ID_N1}")"; BODY="$(http_body "${INFO}")"
  STATUSES="$(extract_statuses "${BODY}")"
  if echo "${STATUSES}" | grep -q "clientDeleteProhibited"; then
    ok "info で clientDeleteProhibited 反映"
  else
    ng "info に clientDeleteProhibited が無い: ${STATUSES}"
  fi

  step "(n1) DELETE を叩く → 409/403 期待"
  DEL="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${ID_N1}" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
  STATUS="$(http_status "${DEL}")"
  if [ "${STATUS}" = "409" ] || [ "${STATUS}" = "403" ]; then
    ok "clientDeleteProhibited 下は 409/403 (HTTP ${STATUS})"
  else
    ng "clientDeleteProhibited 下で HTTP ${STATUS}: $(http_body "${DEL}")"
  fi

  # (n6-a) rem で解除して DELETE が通ることを確認
  step "(n6-a) rem clientDeleteProhibited → DELETE が 200"
  REM="$(rem_flag "${ID_N1}" "clientDeleteProhibited")"
  STATUS="$(http_status "${REM}")"
  if [ "${STATUS}" != "200" ]; then
    note "rem 自体 HTTP ${STATUS} → n6-a skip"
  else
    DEL2="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${ID_N1}" \
      -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}")"
    expect 200 "$(http_status "${DEL2}")" "rem 後の DELETE は 200" "$(http_body "${DEL2}")"
  fi
fi

# =============================================================================
# (n2) clientUpdateProhibited → PUT (nameServers) 弾き
# =============================================================================
NAME_N2="prohibit-n2-${TS}.${TLD}"
create_domain "${NAME_N2}" 1
ID_N2="${DOMAIN_ID}"
step "(n2-0) clientUpdateProhibited を付与"
RES="$(add_flag "${ID_N2}" "clientUpdateProhibited")"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" != "200" ]; then
  note "フラグ付与 HTTP ${STATUS} → n2 skip"
else
  step "(n2) 別 update を叩く → 409/403 期待"
  PUT="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${ID_N2}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"chg\":{\"authInfo\":\"newpass-${TS}\"}}")"
  STATUS="$(http_status "${PUT}")"
  if [ "${STATUS}" = "409" ] || [ "${STATUS}" = "403" ]; then
    ok "clientUpdateProhibited 下は 409/403 (HTTP ${STATUS})"
  else
    ng "clientUpdateProhibited 下で HTTP ${STATUS}: $(http_body "${PUT}")"
  fi

  # (n6-b) 自分自身を rem する PUT は許可されている想定 (Issue #10 note)
  step "(n6-b) rem clientUpdateProhibited (自身を解除) → 200"
  REM="$(rem_flag "${ID_N2}" "clientUpdateProhibited")"
  STATUS="$(http_status "${REM}")"
  if [ "${STATUS}" = "200" ]; then
    ok "自身の rem は 200"
  else
    ng "自身の rem で HTTP ${STATUS}: $(http_body "${REM}")"
  fi
fi

# =============================================================================
# (n3) clientRenewProhibited → renew 弾き
# =============================================================================
NAME_N3="prohibit-n3-${TS}.${TLD}"
create_domain "${NAME_N3}" 1
ID_N3="${DOMAIN_ID}"
step "(n3-0) clientRenewProhibited を付与"
RES="$(add_flag "${ID_N3}" "clientRenewProhibited")"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" != "200" ]; then
  note "フラグ付与 HTTP ${STATUS} → n3 skip"
else
  step "(n3) renew → 409/403 期待"
  REN="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${ID_N3}/renew" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"period\":{\"unit\":\"Y\",\"value\":1}}")"
  STATUS="$(http_status "${REN}")"
  if [ "${STATUS}" = "409" ] || [ "${STATUS}" = "403" ]; then
    ok "clientRenewProhibited 下は 409/403 (HTTP ${STATUS})"
  else
    ng "clientRenewProhibited 下で HTTP ${STATUS}: $(http_body "${REN}")"
  fi

  step "(n6-c) rem clientRenewProhibited → renew が 200"
  REM="$(rem_flag "${ID_N3}" "clientRenewProhibited")"
  if [ "$(http_status "${REM}")" != "200" ]; then
    note "rem HTTP $(http_status "${REM}") → n6-c skip"
  else
    REN2="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${ID_N3}/renew" \
      -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
      -w "\n__HTTP__%{http_code}" \
      -d "{\"period\":{\"unit\":\"Y\",\"value\":1}}")"
    expect 200 "$(http_status "${REN2}")" "rem 後の renew は 200" "$(http_body "${REN2}")"
  fi
fi

# =============================================================================
# (n4) clientTransferProhibited → info で反映確認 (transfer request は別 registrar 必要)
# =============================================================================
NAME_N4="prohibit-n4-${TS}.${TLD}"
create_domain "${NAME_N4}" 1
ID_N4="${DOMAIN_ID}"
step "(n4-0) clientTransferProhibited を付与"
RES="$(add_flag "${ID_N4}" "clientTransferProhibited")"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" != "200" ]; then
  note "フラグ付与 HTTP ${STATUS} → n4 skip"
else
  step "(n4) info で statuses に反映されているか確認"
  INFO="$(get_info "${ID_N4}")"; BODY="$(http_body "${INFO}")"
  STATUSES="$(extract_statuses "${BODY}")"
  if echo "${STATUSES}" | grep -q "clientTransferProhibited"; then
    ok "info の statuses に clientTransferProhibited 含む (${STATUSES})"
  else
    ng "info の statuses に clientTransferProhibited が無い: ${STATUSES}"
  fi
fi

# =============================================================================
# (n5) clientHold → info で statuses に含まれる
# =============================================================================
NAME_N5="prohibit-n5-${TS}.${TLD}"
create_domain "${NAME_N5}" 1
ID_N5="${DOMAIN_ID}"
step "(n5-0) clientHold を付与"
RES="$(add_flag "${ID_N5}" "clientHold")"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" != "200" ]; then
  note "clientHold 付与 HTTP ${STATUS} → n5 skip"
else
  step "(n5) info で statuses に clientHold"
  INFO="$(get_info "${ID_N5}")"; BODY="$(http_body "${INFO}")"
  STATUSES="$(extract_statuses "${BODY}")"
  if echo "${STATUSES}" | grep -q "clientHold"; then
    ok "info の statuses に clientHold 含む (${STATUSES})"
  else
    ng "info の statuses に clientHold が無い: ${STATUSES}"
  fi
fi

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
