#!/usr/bin/env bash
# nameservers-e2e-kitaqsign.sh
# PUT /api/v1/secure/domains/{id} の nameServers 補完ロジック検証 (Kitaqsign = .com)。
#
# 背景: A/B/C 検証で nameServers オンリー PUT が 404 を返す事象を発見。
#       add/rem の補完 (現状 NS と要求 NS の差分計算) が実装されているかを検証する。
#
# 使い方:
#   ./scripts/lifecycle/nameservers-e2e-kitaqsign.sh --env .env
#
# 検証項目 (M-1 〜 M-5):
#   (m1) 現状 NS 空 → 2本を渡す (create 時 NS 未指定パターン)  → 200 + info で 2本反映
#   (m2) 現状 2本 → 同じ 2本を渡す (no-op)                    → 200 + info で 2本
#   (m3) 現状 2本 → 別 2本に差し替え                          → 200 + info で新 2本
#   (m4) 現状 2本 → 3本に増やす (追加 1)                      → 200 + info で 3本
#   (m5) 現状 3本 → 1本削除                                    → 200 + info で 2本

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

# info レスポンスの "nameservers":[...] を抽出して 1行 CSV にする。空配列は "" を返す。
extract_nameservers() {
  local body="$1"
  echo "$body" | sed -n 's/.*"nameservers":\[\([^]]*\)\].*/\1/p' | tr -d '"' | tr -d ' '
}

# CSV 内の要素数を返す (空文字なら 0)
count_csv() {
  local csv="$1"
  [ -z "$csv" ] && { echo 0; return; }
  echo "$csv" | tr ',' '\n' | grep -c .
}

put_nameservers() {
  local id="$1" ns_json="$2"
  curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${id}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"nameServers\":${ns_json}}"
}

get_info() {
  local id="$1"
  curl -sS "${BACKEND_URL}/api/v1/secure/domains/${id}" \
    -b "${COOKIE_JAR}" -w "\n__HTTP__%{http_code}"
}

check_backend "${TLD}"
seed_user_and_signin "ns.test.${TS}@example.com" "admin123" "Taro Test"

# --- (m1) 現状 NS 空 → 2本を渡す ------------------------------------------
NAME1="ns-m1-${TS}.${TLD}"
create_domain "${NAME1}" 1
ID1="${DOMAIN_ID}"
step "(m1-0) 作成直後 info で nameservers を確認"
INFO="$(get_info "${ID1}")"
BODY="$(http_body "${INFO}")"
INIT_NS="$(extract_nameservers "${BODY}")"
INIT_COUNT="$(count_csv "${INIT_NS}")"
note "初期 NS 数=${INIT_COUNT} (${INIT_NS})"

step "(m1) NS を 2本に設定"
RES="$(put_nameservers "${ID1}" '["ns1.example.com","ns2.example.com"]')"
STATUS="$(http_status "${RES}")"
expect 200 "${STATUS}" "空→2本 PUT は 200" "$(http_body "${RES}")"
if [ "${STATUS}" = "200" ]; then
  INFO="$(get_info "${ID1}")"
  BODY="$(http_body "${INFO}")"
  NS="$(extract_nameservers "${BODY}")"
  if [ "$(count_csv "${NS}")" = "2" ]; then
    ok "info で NS=2本 (${NS})"
  else
    ng "info で NS 数が 2 でない: ${NS}"
  fi
fi

# --- (m2) 現状 2本 → 同じ 2本 (no-op) -------------------------------------
step "(m2) 同じ 2本を再送 (no-op)"
RES="$(put_nameservers "${ID1}" '["ns1.example.com","ns2.example.com"]')"
STATUS="$(http_status "${RES}")"
if [ "${STATUS}" = "200" ] || [ "${STATUS}" = "400" ]; then
  ok "同一 NS 再送は 200 (no-op) or 400 (差分なし判定) (HTTP ${STATUS})"
else
  ng "同一 NS 再送で HTTP ${STATUS}: $(http_body "${RES}")"
fi

# --- (m3) 現状 2本 → 別 2本に差し替え --------------------------------------
step "(m3) 別 2本に差し替え"
RES="$(put_nameservers "${ID1}" '["ns3.example.com","ns4.example.com"]')"
STATUS="$(http_status "${RES}")"
expect 200 "${STATUS}" "別 2本差し替えは 200" "$(http_body "${RES}")"
if [ "${STATUS}" = "200" ]; then
  INFO="$(get_info "${ID1}")"
  BODY="$(http_body "${INFO}")"
  NS="$(extract_nameservers "${BODY}")"
  if echo "${NS}" | grep -q 'ns3.example.com' && echo "${NS}" | grep -q 'ns4.example.com'; then
    ok "info で NS が新 2本に差し替わっている (${NS})"
  else
    ng "info の NS が新 2本になっていない: ${NS}"
  fi
fi

# --- (m4) 現状 2本 → 3本に増やす (追加 1) ---------------------------------
step "(m4) 3本に増やす"
RES="$(put_nameservers "${ID1}" '["ns3.example.com","ns4.example.com","ns5.example.com"]')"
STATUS="$(http_status "${RES}")"
expect 200 "${STATUS}" "3本 PUT は 200" "$(http_body "${RES}")"
if [ "${STATUS}" = "200" ]; then
  INFO="$(get_info "${ID1}")"
  BODY="$(http_body "${INFO}")"
  NS="$(extract_nameservers "${BODY}")"
  if [ "$(count_csv "${NS}")" = "3" ]; then
    ok "info で NS=3本 (${NS})"
  else
    ng "info で NS 数が 3 でない: ${NS}"
  fi
fi

# --- (m5) 現状 3本 → 1本削除 (2本にする) ----------------------------------
step "(m5) 1本削除 (2本にする)"
RES="$(put_nameservers "${ID1}" '["ns3.example.com","ns4.example.com"]')"
STATUS="$(http_status "${RES}")"
expect 200 "${STATUS}" "3→2本 PUT は 200" "$(http_body "${RES}")"
if [ "${STATUS}" = "200" ]; then
  INFO="$(get_info "${ID1}")"
  BODY="$(http_body "${INFO}")"
  NS="$(extract_nameservers "${BODY}")"
  if [ "$(count_csv "${NS}")" = "2" ]; then
    ok "info で NS=2本 (${NS})"
  else
    ng "info で NS 数が 2 でない: ${NS}"
  fi
fi

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  target     : ${NAME1} (${ID1})\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
