#!/usr/bin/env bash
# renew-e2e-kitaqsign.sh
# POST /api/v1/secure/domains/{id}/renew の網羅検証 (Kitaqsign = .com)。
#
# 使い方:
#   ./scripts/lifecycle/renew-e2e-kitaqsign.sh --env .env
#
# 検証項目:
#   (a) 1年延長                        → 200 / expiresAt が1年後
#   (b) period=0                       → 400
#   (c) period=11                      → 400
#   (d) clientRenewProhibited を付与   → renew は 409
#   (e) 認証なし                       → 401
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
TLD="com"
TS="$(date +%s)"

check_backend "${TLD}"
seed_user_and_signin "renew.test.${TS}@example.com" "admin123" "Taro Test"

NAME="renew-e2e-${TS}.${TLD}"
create_domain "${NAME}" 1

BEFORE_BODY="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}")"
BEFORE_EXP="$(json_str "${BEFORE_BODY}" expiresAt)"
note "更新前の expiresAt: ${BEFORE_EXP:-取得できず}"

# --- (a) 1年延長 -----------------------------------------------------------
step "(a) 1年延長 → 200 + expiresAt 1年後"
RENEW_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d '{"period":{"unit":"Y","value":1}}')"
RENEW_STATUS="$(http_status "${RENEW_RES}")"
RENEW_BODY="$(http_body "${RENEW_RES}")"
expect 200 "${RENEW_STATUS}" "1年延長" "${RENEW_BODY}"
if [ "${RENEW_STATUS}" = "200" ]; then
  AFTER_EXP="$(json_str "${RENEW_BODY}" expiresAt)"
  BEFORE_Y="${BEFORE_EXP:0:4}"; AFTER_Y="${AFTER_EXP:0:4}"
  if [ -n "${BEFORE_Y}" ] && [ "${AFTER_Y}" -eq $((BEFORE_Y + 1)) ] 2>/dev/null; then
    ok "expiresAt が 1 年延びた (${BEFORE_Y} → ${AFTER_Y})"
  else
    ng "expiresAt が 1 年延びていない (${BEFORE_EXP} → ${AFTER_EXP})"
  fi
fi

# --- (b) period=0 -----------------------------------------------------------
step "(b) period=0 → 400"
R0="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":0}}')"
expect 400 "$(http_status "${R0}")" "period=0 は 400" "$(http_body "${R0}")"

# --- (c) period=11 ----------------------------------------------------------
step "(c) period=11 → 400"
R11="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":11}}')"
expect 400 "$(http_status "${R11}")" "period=11 は 400" "$(http_body "${R11}")"

# --- (d) clientRenewProhibited → 409 ---------------------------------------
# 実測: kitaqsign は client*Prohibited を PUT で受け付けても info の statuses に反映しない
# (HTTP 200 は返るがフラグが立たない)。付与直後に info でフラグを確認し、無ければ skip する。
step "(d) clientRenewProhibited を付けて renew → 409"
LOCK_RES="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"addStatuses":["clientRenewProhibited"]}')"
if [ "$(http_status "${LOCK_RES}")" != "200" ]; then
  note "clientRenewProhibited の付与が失敗 (HTTP $(http_status "${LOCK_RES}")): $(http_body "${LOCK_RES}")"
  note "このケースは検証スキップ (ロック付与自体が失敗)"
else
  # info でフラグが実際に立っているか確認
  INFO_D="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}")"
  if ! echo "${INFO_D}" | grep -q "clientRenewProhibited"; then
    note "実 API が clientRenewProhibited を反映していない (kitaqsign 側の既知の未対応) → 本テスト skip"
  else
    ok "clientRenewProhibited を付けた"
    PROH="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
      -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
      -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":1}}')"
    expect 409 "$(http_status "${PROH}")" "更新禁止中の renew は 409" "$(http_body "${PROH}")"
    # 後片付け
    curl -sS -o /dev/null -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
      -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
      -d '{"remStatuses":["clientRenewProhibited"]}'
  fi
fi

# --- (e) 認証なし ------------------------------------------------------------
step "(e) 認証なしで renew → 401"
NA="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/renew" \
  -H "Content-Type: application/json" -d '{"period":{"unit":"Y","value":1}}')"
expect 401 "${NA}" "認証なしは 401"

# --- (f) 存在しない ID ------------------------------------------------------
step "(f) 存在しない ID で renew → 404"
BOG="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000/renew" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" -d '{"period":{"unit":"Y","value":1}}')"
expect 404 "$(http_status "${BOG}")" "存在しない ID は 404" "$(http_body "${BOG}")"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.${TLD})\n"
printf "  target id  : ${DOMAIN_ID}\n"
printf "  expiresAt  : ${BEFORE_EXP:-?} → ${AFTER_EXP:-未更新}\n"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf '%s\n' "----------------------------------------"
[ "${FAIL}" -eq 0 ]
