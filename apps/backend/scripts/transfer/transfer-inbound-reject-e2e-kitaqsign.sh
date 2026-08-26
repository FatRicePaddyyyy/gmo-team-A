#!/usr/bin/env bash
# transfer-inbound-reject-e2e.sh
# 6 ステップ e2e (reject 版):
#   1. teama: backend API でドメイン作成
#   2. teama-2: 移管リクエストをレジストリ直で投げる (1 の authInfo を使う)
#   3. teama: /__scheduled で cron 発火 → backend が pending を DB に保存
#   4. teama: backend API で reject
#   5. teama: /secure/domains にドメインが残り + backend DB の domain.status=ok
#         + transfers.status=clientRejected を確認
#   6. teama-2: /api/v1/epp/domains/{name} で info 取得 → 200 で見えるが所有権は teama のまま
#         (registry の info は sponsoring registrar 情報を返さないので、5 で teama backend に
#          domain が残っていることで所有権未移動を確認する)
#
# 前提:
#   - backend が localhost:8787 で起動 (`pnpm dev` = `wrangler dev --test-scheduled`)
#   - .env に teama credentials + SECRET_KEY
#   - .env.teama2 に teama-2 credentials
#   - D1 local sqlite で migrate 済み

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
BLUE=$'\033[0;34m'
RESET=$'\033[0m'

step()  { printf "\n${YELLOW}==> %s${RESET}\n" "$*" >&2; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*" >&2; }
info()  { printf "${CYAN}  %s${RESET}\n" "$*" >&2; }
warn()  { printf "${BLUE}  ! %s${RESET}\n" "$*" >&2; }
fail()  { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"

source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files
[ -n "${SECRET_KEY:-}" ] || fail "SECRET_KEY が --env で指定されたファイルに無い"
TEAMA_REG="${KITAQSIGN_REGISTRAR_ID}"
T2_USER="${T2_KITAQSIGN_BASIC_USER}"
T2_PASS="${T2_KITAQSIGN_BASIC_PASS}"
T2_REG="${T2_KITAQSIGN_REGISTRAR_ID}"
T2_API="${T2_KITAQSIGN_API_KEY}"

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
REGISTRY_URL="${REGISTRY_URL:-https://epp.kitaqsign.com}"
D1_DIR="${D1_DIR:-${BACKEND_DIR}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject}"

# curl ヘルパ
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

find_d1_sqlite() {
  local f base
  for f in "${D1_DIR}"/*.sqlite; do
    base="$(basename "${f}")"
    [ "${base}" = "metadata.sqlite" ] && continue
    if echo "${base}" | grep -qE '^[a-f0-9]{32,}\.sqlite$'; then echo "${f}"; return 0; fi
  done
  fail "D1 sqlite が見つからない"
}

# teama backend (cookie 経由)
COOKIE=""
teama_setup() {
  local email="teama-e2e-$(date +%s)-$$@example.com"
  local pw="P@ssw0rd-e2e"
  curl -sSf -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
    -H "Authorization: Bearer ${SECRET_KEY}" -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"name\":\"Taro Test\",\"password\":\"${pw}\"}" --max-time 15 >/dev/null || fail "seed user 作成失敗"
  COOKIE="$(mktemp)"
  curl -sSf -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
    -H "Content-Type: application/json" -c "${COOKIE}" \
    -d "{\"email\":\"${email}\",\"password\":\"${pw}\"}" --max-time 15 >/dev/null || fail "sign-in 失敗"
  info "  teama session: ${email}"
}

teama_call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "${BACKEND_URL}${path}" -b "${COOKIE}" -H "Content-Type: application/json" -w "\n__HTTP__%{http_code}" --max-time 20)
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

# teama-2 registry
t2_call() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "${REGISTRY_URL}${path}" -u "${T2_USER}:${T2_PASS}" -H "X-Registrar-Id: ${T2_REG}" -H "X-Api-Key: ${T2_API}" -H "Content-Type: application/json" -w "\n__HTTP__%{http_code}" --max-time 20)
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

# cron 発火 (wrangler dev --test-scheduled が必須)
trigger_cron() {
  local raw status
  raw="$(curl -sS -w '\n__HTTP__%{http_code}' --max-time 60 "${BACKEND_URL}/__scheduled")"
  status="$(status_of "$raw")"
  [ "$status" = "200" ] || fail "cron 発火失敗 HTTP:${status}"
}

# ─────────────────────────────────────────────
# 準備
# ─────────────────────────────────────────────
step "準備: backend 疎通 + D1 sqlite 特定 + teama session"
curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" -H "Content-Type: application/json" -d '{"name":"example.com"}' --max-time 5 >/dev/null || fail "backend 疎通失敗"
D1_SQLITE="$(find_d1_sqlite)"
info "  D1 = ${D1_SQLITE}"
teama_setup
trap 'rm -f "${COOKIE}"' EXIT

STAMP="$(date +%s)"
RAND="$(head -c 3 /dev/urandom | xxd -p)"
DOMAIN="tr-in-${STAMP}-${RAND}.com"

# ─────────────────────────────────────────────
# 1. teama backend でドメイン作成
# ─────────────────────────────────────────────
step "[1] teama: backend API でドメイン作成 (${DOMAIN})"
RAW="$(teama_call POST /api/v1/secure/domains "{\"name\":\"${DOMAIN}\",\"registry\":\"kitaqsign\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "201" ] || fail "[1] create 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
DOMAIN_ID="$(json_get "$BD" 'data.id')"
[ -n "$DOMAIN_ID" ] || fail "[1] レスポンスに data.id が無い"
AUTH_INFO="$(sqlite3 "${D1_SQLITE}" "SELECT auth_info FROM domains WHERE name='${DOMAIN}';")"
[ -n "$AUTH_INFO" ] || fail "[1] DB から authInfo が取れない"
info "  domain_id = ${DOMAIN_ID}"
info "  authInfo  = ${AUTH_INFO} (DB 直読み)"
ok "[1] backend でドメイン作成成功"

# ─────────────────────────────────────────────
# 2. teama-2 レジストリに transfer/request
# ─────────────────────────────────────────────
step "[2] teama-2: registry に transfer/request (authInfo 一致)"
RAW="$(t2_call POST "/api/v1/epp/domains/${DOMAIN}/transfer/request" "{\"op\":\"request\",\"authInfo\":\"${AUTH_INFO}\"}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "202" ] || [ "$ST" = "200" ] || fail "[2] request 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
REQ_ST="$(json_get "$BD" 'resData.status')"
case "$REQ_ST" in pendingTransfer|pending) : ;; *) fail "[2] status が pendingTransfer|pending でない (${REQ_ST})" ;; esac
ok "[2] request 受付 → ${REQ_ST} (registry 側)"

# ─────────────────────────────────────────────
# 3. cron 発火 → backend DB に pending が INSERT されるか確認
# ─────────────────────────────────────────────
step "[3] teama: /__scheduled で cron 発火 → DB に外部 pending が保存される"
# レジストリキューは前段で空にした前提。teama-2 の request 直後は
# teama 側キューに 1 件だけ (対象ドメインの request メッセージ) 積まれてるはず。
trigger_cron
info "  cron 発火完了、DB 検証..."
PENDING="$(sqlite3 "${D1_SQLITE}" "SELECT t.id||'|'||t.status||'|'||COALESCE(t.gaining_user_id,'NULL')||'|'||COALESCE(t.gaining_registrar,'NULL') FROM transfers t JOIN domains d ON t.domain_id=d.id WHERE d.name='${DOMAIN}' AND t.status='pendingTransfer';")"
[ -n "$PENDING" ] || fail "[3] DB に pending 行が INSERT されていない"
info "  DB pending row = ${PENDING}"
# gaining_registrar が teama-2 (= T2_REG) であることを確認
GR="$(echo "$PENDING" | awk -F'|' '{print $4}')"
[ "$GR" = "${T2_REG}" ] || fail "[3] gaining_registrar が teama-2 でない (${GR})"
GU="$(echo "$PENDING" | awk -F'|' '{print $3}')"
[ "$GU" = "NULL" ] || fail "[3] gaining_user_id は NULL のはず (${GU})"
ok "[3] backend DB に外部 pending 行が作成された (gainingRegistrar=${T2_REG}, gainingUserId=null)"

# ─────────────────────────────────────────────
# 4. teama backend で reject
# ─────────────────────────────────────────────
step "[4] teama: backend API で reject"
RAW="$(teama_call POST "/api/v1/secure/domains/${DOMAIN_ID}/transfer/reject")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
info "  → HTTP:${ST}"
[ "$ST" = "200" ] || fail "[4] backend reject 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
ok "[4] backend reject 成功"

# ─────────────────────────────────────────────
# 5. teama backend にドメインが残り、DB が正しい状態に戻ることを確認
# ─────────────────────────────────────────────
step "[5] teama: /secure/domains にドメインが残り、DB が clientRejected + status=ok に戻る"
RAW="$(teama_call GET /api/v1/secure/domains)"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "[5] /secure/domains 取得失敗 HTTP:${ST}"
if ! echo "$BD" | grep -q "\"${DOMAIN}\""; then
  fail "[5] teama backend からドメイン ${DOMAIN} が消えている (reject では残るべき): $(echo "$BD" | head -c 400)"
fi
info "  API レスポンスに ${DOMAIN} 含まれる ✓"

# DB の domain 行が残り、status=ok に戻っていることを確認
DB_DOM="$(sqlite3 "${D1_SQLITE}" "SELECT id||'|'||status FROM domains WHERE name='${DOMAIN}';")"
[ -n "$DB_DOM" ] || fail "[5] DB の domains 行が消えている (reject では残るべき)"
DOM_STATUS="$(echo "$DB_DOM" | awk -F'|' '{print $2}')"
info "  domain 行 = ${DB_DOM}"
[ "$DOM_STATUS" = "ok" ] || fail "[5] domain.status が ok でない (${DOM_STATUS})"

# transfer 行が clientRejected に更新されていることを確認
DB_TR="$(sqlite3 "${D1_SQLITE}" "SELECT t.status||'|'||COALESCE(t.gaining_registrar,'NULL') FROM transfers t JOIN domains d ON t.domain_id=d.id WHERE d.name='${DOMAIN}' ORDER BY t.created_at DESC LIMIT 1;")"
info "  transfer 行 = ${DB_TR}"
TR_STATUS="$(echo "$DB_TR" | awk -F'|' '{print $1}')"
[ "$TR_STATUS" = "clientRejected" ] || fail "[5] transfer.status が clientRejected でない (${TR_STATUS})"
ok "[5] backend にドメイン残存 + domain.status=ok + transfer.status=clientRejected を確認"

# ─────────────────────────────────────────────
# 6. teama-2 側でも所有権が移っていないことを確認
# ─────────────────────────────────────────────
step "[6] teama-2: registry で info 取得 → 見えるが所有権は teama のまま"
RAW="$(t2_call GET "/api/v1/epp/domains/${DOMAIN}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "[6] teama-2 で info 取得失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
INFO_STATUS="$(json_get "$BD" 'resData.status')"
INFO_NAME="$(json_get "$BD" 'resData.domain')"
info "  domain    = ${INFO_NAME}"
info "  status    = ${INFO_STATUS} (レジストリの info は sponsoring registrar を返さないので"
info "               所有権未移動の直接確認は [5] の teama 側 domain 残存で代用)"
[ "$INFO_NAME" = "${DOMAIN}" ] || fail "[6] info の domain が違う (${INFO_NAME})"
# reject 後は pendingTransfer が解けているはず (ok に戻る)
case "$INFO_STATUS" in
  *pendingTransfer*)
    fail "[6] reject 後もレジストリ側の status に pendingTransfer が残っている (${INFO_STATUS})"
    ;;
esac
ok "[6] レジストリ側も pendingTransfer が解けている (拒否確定)"

# ─────────────────────────────────────────────
# 総括
# ─────────────────────────────────────────────
printf "\n${GREEN}=== 6 ステップ e2e (reject) 完了 ===${RESET}\n"
printf "  domain     : %s (teama 所有のまま)\n" "$DOMAIN"
printf "  domain_id  : %s\n" "$DOMAIN_ID"
printf "  authInfo   : %s\n" "$AUTH_INFO"
printf "  結果       : teama-2 の移管申請を teama が拒否 → transfer.status=clientRejected\n"
