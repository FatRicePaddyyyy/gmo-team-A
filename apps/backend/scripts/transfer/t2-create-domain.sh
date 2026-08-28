#!/usr/bin/env bash
# t2-create-domain.sh
# teama-2 側 (別レジストラアカウント) で「移管元ドメイン」を1本作るだけの補助スクリプト。
#
# 用途:
#   frontend の /transfer フォームに貼るための authInfo / contactId を最小手数で発行する。
#   inbound e2e シナリオの前段 (「他社が持っているドメイン」の準備) を手で試したいときに使う。
#
# 使い方:
#   ./scripts/transfer/t2-create-domain.sh --env .env.teama2 --registry kitaqsign
#   ./scripts/transfer/t2-create-domain.sh --env .env.teama2 --registry kitaqnic
#
# 引数:
#   --env <path>       teama-2 用の env ファイル (KITAQSIGN_* / KITAQNIC_* を含む)
#   --registry <kind>  kitaqsign | kitaqnic
#
# 出力:
#   contact 作成 → domain 作成 → info で確認 の 3 ステップを走らせ、
#   最後に registry / domain / authInfo / contactId を表形式で出す。
#   ここで出た authInfo と contactId を frontend の /transfer フォームに貼る。

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

step()  { printf "\n${YELLOW}==> %s${RESET}\n" "$*" >&2; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*" >&2; }
info()  { printf "${CYAN}  %s${RESET}\n" "$*" >&2; }
fail()  { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

ENV_FILE=""
REGISTRY_KIND=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      [ $# -ge 2 ] || fail "--env に値がない"
      ENV_FILE="$2"; shift 2 ;;
    --registry)
      [ $# -ge 2 ] || fail "--registry に値がない"
      REGISTRY_KIND="$2"; shift 2 ;;
    -h|--help)
      cat >&2 <<EOF
使い方: $(basename "$0") --env <path> --registry <kitaqsign|kitaqnic>

  --env <path>       teama-2 用の env ファイル (KITAQSIGN_* / KITAQNIC_* を含む)
  --registry <kind>  kitaqsign または kitaqnic

出力される authInfo / contactId を frontend の /transfer フォームに貼って移管申請する。
EOF
      exit 0 ;;
    *)
      fail "未知の引数: $1 (使い方: --help)" ;;
  esac
done

[ -n "${ENV_FILE}" ]      || fail "--env <path> を指定してください"
[ -f "${ENV_FILE}" ]      || fail "--env で指定されたファイルが無い: ${ENV_FILE}"
[ -n "${REGISTRY_KIND}" ] || fail "--registry <kitaqsign|kitaqnic> を指定してください"

# env は teama-2 用。同名キー衝突を気にせず素直に export する
# (このスクリプトは teama credentials を使わない)
set -a; . "${ENV_FILE}"; set +a

case "${REGISTRY_KIND}" in
  kitaqsign)
    REGISTRY_URL="https://epp.kitaqsign.com"
    TLD="com"
    T2_USER="${KITAQSIGN_BASIC_USER:-}"
    T2_PASS="${KITAQSIGN_BASIC_PASS:-}"
    T2_REG="${KITAQSIGN_REGISTRAR_ID:-}"
    T2_API="${KITAQSIGN_API_KEY:-}"
    ;;
  kitaqnic)
    REGISTRY_URL="https://epp.kitaqnic.com"
    TLD="xyz"
    T2_USER="${KITAQNIC_BASIC_USER:-}"
    T2_PASS="${KITAQNIC_BASIC_PASS:-}"
    T2_REG="${KITAQNIC_REGISTRAR_ID:-}"
    T2_API="${KITAQNIC_API_KEY:-}"
    ;;
  *)
    fail "未知の registry: ${REGISTRY_KIND} (kitaqsign | kitaqnic)" ;;
esac

[ -n "${T2_USER}" ] && [ -n "${T2_PASS}" ] && [ -n "${T2_REG}" ] && [ -n "${T2_API}" ] \
  || fail "${ENV_FILE} に ${REGISTRY_KIND^^}_{BASIC_USER,BASIC_PASS,REGISTRAR_ID,API_KEY} が揃っていない"

# ─── curl ヘルパ ─────────────────────────────────────────────
status_of() { printf "%s" "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
body_of()   { printf "%s" "$1" | sed 's/__HTTP__[0-9]*$//'; }
json_get() {
  local raw="$1" path="$2"
  printf "%s" "$raw" | python3 -c "
import sys, json
try: d = json.load(sys.stdin)
except: print(''); sys.exit(0)
try:
    for p in '$path'.split('.'):
        if not p: continue
        d = d[p]
    print(d if not isinstance(d, (list, dict)) else json.dumps(d, ensure_ascii=False))
except: print('')
"
}

t2_call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "${REGISTRY_URL}${path}" -u "${T2_USER}:${T2_PASS}" -H "X-Registrar-Id: ${T2_REG}" -H "X-Api-Key: ${T2_API}" -H "Content-Type: application/json" -w "\n__HTTP__%{http_code}" --max-time 20)
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

# ─── 1. contact 作成 ─────────────────────────────────────────
CID="C-$(head -c 4 /dev/urandom | xxd -p | tr 'a-f' 'A-F')"
step "teama-2 の contact を作成 (${CID})"
CONTACT_BODY="{\"id\":\"${CID}\",\"postalInfo\":{\"name\":\"Taro Test\",\"addr\":{\"street\":\"N/A\",\"city\":\"N/A\",\"cc\":\"JP\"}},\"email\":\"taro.test@example.com\",\"authInfo\":\"$(head -c 8 /dev/urandom | xxd -p)\"}"
RAW="$(t2_call POST /api/v1/epp/contacts "${CONTACT_BODY}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "201" ] || [ "$ST" = "200" ] || fail "contact 作成失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
ok "contact 作成 (HTTP ${ST})"

# ─── 2. domain 作成 ──────────────────────────────────────────
STAMP="$(date +%s)"
RAND="$(head -c 4 /dev/urandom | xxd -p)"
DOMAIN="t2-e2e-${STAMP}-${RAND}.${TLD}"
AUTH_INFO="$(head -c 16 /dev/urandom | xxd -p)"

step "ドメイン作成: ${DOMAIN}"
DOMAIN_BODY="{\"domain\":\"${DOMAIN}\",\"period\":{\"unit\":\"Y\",\"value\":1},\"registrant\":\"${CID}\",\"contacts\":{\"ADMIN\":\"${CID}\",\"TECH\":\"${CID}\",\"BILLING\":\"${CID}\"},\"authInfo\":\"${AUTH_INFO}\"}"
RAW="$(t2_call POST /api/v1/epp/domains "${DOMAIN_BODY}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "201" ] || fail "ドメイン作成失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
ok "ドメイン作成 (HTTP ${ST})"

# ─── 3. info で確認 ──────────────────────────────────────────
step "info で確認"
RAW="$(t2_call GET "/api/v1/epp/domains/${DOMAIN}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "info 取得失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
INFO_DOMAIN="$(json_get "$BD" 'resData.domain')"
[ "$INFO_DOMAIN" = "${DOMAIN}" ] || fail "info の domain が違う (${INFO_DOMAIN})"
ok "info 取得成功"

# ─── 総括 ────────────────────────────────────────────────────
printf "\n----------------------------------------\n"
printf "  registry   : %s (.%s)\n" "${REGISTRY_KIND}" "${TLD}"
printf "  domain     : %s\n" "${DOMAIN}"
printf "  authInfo   : %s\n" "${AUTH_INFO}"
printf "  contactId  : %s\n" "${CID}"
printf "----------------------------------------\n"
printf "\n次の操作: teama frontend の /transfer フォームに ↑ を貼って移管申請\n"
