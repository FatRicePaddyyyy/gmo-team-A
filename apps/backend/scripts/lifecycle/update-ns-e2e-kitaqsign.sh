#!/usr/bin/env bash
# update-ns-e2e-kitaqsign.sh
# PUT /api/v1/secure/domains/{id} のネームサーバー変更を検証する (Kitaqsign = .com)。
#
# 使い方:
#   ./scripts/lifecycle/update-ns-e2e-kitaqsign.sh --env .env
#
# なぜ要るか:
#   EPP のネームサーバーは独立したホストオブジェクトで、domain:update から
#   参照する前に host:create しておく必要がある。これを怠るとレジストリが
#   2303 (Object does not exist) を返す。さらに domain:update は add/rem の
#   差分しか受け付けないため、add だけ送ると外したはずの NS が残り続ける。
#   どちらも一度壊すと画面からは気づきにくいので、ここで固定する。
#
# 検証項目:
#   (a) NS を 2 件設定           → 200 / 指定した 2 件がそのまま入る
#   (b) NS を 1 件に減らす       → 200 / 減らした 1 件だけになる（rem が効く）
#   (c) 別の NS に入れ替える     → 200 / 旧 NS が消えて新 NS だけになる
#   (d) NS を空にする            → 200 / 0 件になる
#   (e) 同じ NS を送り直す       → 200 / 変化なし（差分ゼロで空 update を投げない）
#   (f) 大文字で送る             → 200 / 小文字と同一視され増えない
#   (g) 作成時に NS を指定       → 201 / 指定した NS が入る（domain:create 側）
#   (h) 認証なし                 → 401
#   (i) 存在しない ID            → 404

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
seed_user_and_signin "update-ns.test.${TS}@example.com" "admin123" "Taro Test"

NAME="update-ns-e2e-${TS}.${TLD}"
create_domain "${NAME}" 1

# nameservers 配列を "a,b,c" の形で取り出す (順不同なのでソートして比較する)
current_ns() {
  curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}" \
    | sed -n 's/.*"nameservers":\[\([^]]*\)\].*/\1/p' \
    | tr -d '" ' | tr ',' '\n' | grep -v '^$' | sort | paste -sd, -
}

# レジストリは意図的に一時障害を注入してくる（500 + 「予期しない応答」）。
# 実装の不具合と区別するため、一時障害らしい応答のときだけ 1 度だけ再試行する。
retry_note() {
  note "一時障害らしい応答のため 1 度だけ再試行する: $*"
}

# $1 = 送る JSON, $2 = 期待する NS (ソート済みカンマ区切り), $3 = ラベル
put_ns() {
  local body="$1" expected="$2" label="$3"
  local res status
  res="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" -d "${body}")"
  status="$(http_status "${res}")"
  if [ "${status}" = "500" ] && [[ "$(http_body "${res}")" == *"予期しない応答"* ]]; then
    retry_note "${label}"
    sleep 1
    res="$(curl -sS -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
      -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
      -w "\n__HTTP__%{http_code}" -d "${body}")"
    status="$(http_status "${res}")"
  fi
  expect 200 "${status}" "${label}" "$(http_body "${res}")"
  [ "${status}" = "200" ] || return

  local actual
  actual="$(current_ns)"
  if [ "${actual}" = "${expected}" ]; then
    ok "NS が期待どおり (${actual:-空})"
  else
    ng "NS が一致しない (期待: ${expected:-空} / 実際: ${actual:-空})"
  fi
}

# --- (a) NS を 2 件設定 -----------------------------------------------------
# host:create を呼んでいないと、ここが 2303 由来のエラーで落ちる
step "(a) NS を 2 件設定 → 200 + 2 件入る"
put_ns "{\"nameServers\":[\"ns1.${NAME}\",\"ns2.${NAME}\"]}" \
  "ns1.${NAME},ns2.${NAME}" "NS 2 件設定"

# --- (b) NS を 1 件に減らす -------------------------------------------------
# add しか送っていないと、ns2 が残ってここで落ちる
step "(b) NS を 1 件に減らす → 200 + 1 件だけになる"
put_ns "{\"nameServers\":[\"ns1.${NAME}\"]}" "ns1.${NAME}" "NS 1 件へ削減"

# --- (c) 別の NS に入れ替える -----------------------------------------------
step "(c) 別の NS に入れ替える → 200 + 新しい NS だけになる"
put_ns "{\"nameServers\":[\"ns3.${NAME}\",\"ns4.${NAME}\"]}" \
  "ns3.${NAME},ns4.${NAME}" "NS 入れ替え"

# --- (d) NS を空にする ------------------------------------------------------
step "(d) NS を空にする → 200 + 0 件になる"
put_ns '{"nameServers":[]}' "" "NS を空に"

# --- (e) 同じ NS を送り直す --------------------------------------------------
# 差分ゼロのとき空の domain:update を投げると 2001 で弾かれうる
step "(e) 同じ NS を送り直す → 200 + 変化なし"
put_ns "{\"nameServers\":[\"ns5.${NAME}\"]}" "ns5.${NAME}" "NS を 1 件設定"
put_ns "{\"nameServers\":[\"ns5.${NAME}\"]}" "ns5.${NAME}" "同じ NS を再送"

# --- (f) 大文字で送る --------------------------------------------------------
# ホスト名は大小を区別しない。差分判定で増殖しないこと
step "(f) 大文字で送る → 200 + 増えない"
UPPER_NS="$(echo "ns5.${NAME}" | tr '[:lower:]' '[:upper:]')"
put_ns "{\"nameServers\":[\"${UPPER_NS}\"]}" "ns5.${NAME}" "大文字で再送"

# --- (g) 作成時に NS を指定 --------------------------------------------------
# domain:create でも nameservers を参照するので、こちらも host:create が要る
step "(g) 作成時に NS を指定 → 201 + 指定した NS が入る"
CREATE_NAME="update-ns-create-${TS}.${TLD}"
CREATE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}" \
  -d "{\"name\":\"${CREATE_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1},\"nameServers\":[\"ns1.${CREATE_NAME}\",\"ns2.${CREATE_NAME}\"]}")"
CREATE_STATUS="$(http_status "${CREATE_RES}")"
if [ "${CREATE_STATUS}" = "500" ] && [[ "$(http_body "${CREATE_RES}")" == *"予期しない応答"* ]]; then
  retry_note "NS 付きで作成"
  sleep 1
  CREATE_NAME="update-ns-create-${TS}b.${TLD}"
  CREATE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
    -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"name\":\"${CREATE_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1},\"nameServers\":[\"ns1.${CREATE_NAME}\",\"ns2.${CREATE_NAME}\"]}")"
  CREATE_STATUS="$(http_status "${CREATE_RES}")"
fi
expect 201 "${CREATE_STATUS}" "NS 付きで作成" "$(http_body "${CREATE_RES}")"
if [ "${CREATE_STATUS}" = "201" ]; then
  CREATED_ID="$(json_str "$(http_body "${CREATE_RES}")" id)"
  CREATED_NS="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${CREATED_ID}" -b "${COOKIE_JAR}" \
    | sed -n 's/.*"nameservers":\[\([^]]*\)\].*/\1/p' \
    | tr -d '" ' | tr ',' '\n' | grep -v '^$' | sort | paste -sd, -)"
  if [ "${CREATED_NS}" = "ns1.${CREATE_NAME},ns2.${CREATE_NAME}" ]; then
    ok "作成時の NS が入った (${CREATED_NS})"
  else
    ng "作成時の NS が入っていない (実際: ${CREATED_NS:-空})"
  fi
fi

# --- (h) 認証なし ------------------------------------------------------------
step "(h) 認証なしで update → 401"
NA="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -H "Content-Type: application/json" -d '{"nameServers":["ns1.example.com"]}')"
expect 401 "${NA}" "認証なしは 401"

# --- (i) 存在しない ID -------------------------------------------------------
step "(i) 存在しない ID → 404"
NF="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X PUT "${BACKEND_URL}/api/v1/secure/domains/00000000-0000-0000-0000-000000000000" \
  -H "Content-Type: application/json" -b "${COOKIE_JAR}" \
  -d '{"nameServers":["ns1.example.com"]}')"
expect 404 "${NF}" "存在しない ID は 404"

printf "\n%s\n" "----------------------------------------"
printf "  registry   : kitaqsign (.%s)\n" "${TLD}"
printf "  domain     : %s\n" "${NAME}"
printf "  domain id  : %s\n" "${DOMAIN_ID}"
printf "  ${GREEN}PASS %d${RESET} / ${RED}FAIL %d${RESET}\n" "${PASS}" "${FAIL}"
printf "%s\n" "----------------------------------------"

[ "${FAIL}" -eq 0 ] || exit 1
