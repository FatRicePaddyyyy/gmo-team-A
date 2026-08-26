#!/usr/bin/env bash
# transfer-outbound-reject-e2e-kitaqnic.sh (kitaqnic / .xyz)
# 6 ステップ e2e (outbound reject: teama-2 losing / teama gaining, teama は backend 経由):
#   1. teama-2: registry でドメイン作成 (authInfo 取得)
#   2. teama:   backend API で移管申請 (POST /api/v1/secure/transfers)
#   3. teama-2: registry で poll → op=request 受信
#   4. teama-2: registry で transfer/reject
#   5. teama-2: registry で info 確認 (所有権は teama-2 のまま)
#   6. teama:   /__scheduled で cron 発火 → backend で outbound=clientRejected に確定
#              → teama の /secure/domains に domain 行が「無い」ことを確認
#
# 前提:
#   - backend が localhost:8787 で起動 (`pnpm dev` = `wrangler dev --test-scheduled`)
#   - .env に teama credentials + SECRET_KEY
#   - .env.teama2 に teama-2 credentials
#   - D1 local sqlite で migrate 済み (0006_add_outbound_transfer_requests 適用済み)

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

# kitaqnic 用にハードコード。kitaqsign 版は別ファイル (-kitaqsign.sh)。
REGISTRY_KIND="kitaqnic"
REGISTRY_URL="https://epp.kitaqnic.com"
TLD="xyz"

source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files
[ -n "${SECRET_KEY:-}" ] || fail "SECRET_KEY が --env で指定されたファイルに無い"
TEAMA_REG="${KITAQNIC_REGISTRAR_ID}"
T2_USER="${T2_KITAQNIC_BASIC_USER}"
T2_PASS="${T2_KITAQNIC_BASIC_PASS}"
T2_REG="${T2_KITAQNIC_REGISTRAR_ID}"
T2_API="${T2_KITAQNIC_API_KEY}"

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
D1_DIR="${D1_DIR:-${BACKEND_DIR}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject}"

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
  local email="teama-oe2e-$(date +%s)-$$@example.com"
  local pw="P@ssw0rd-oe2e"
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

trigger_cron() {
  local raw status
  raw="$(curl -sS -w '\n__HTTP__%{http_code}' --max-time 60 "${BACKEND_URL}/__scheduled")"
  status="$(status_of "$raw")"
  [ "$status" = "200" ] || fail "cron 発火失敗 HTTP:${status}"
}

# kitaqnic は DELETE /messages/{id} で ack (kitaqsign と違うので専用実装)
ack_registry_msg() {
  local id="$1"
  t2_call DELETE "/api/v1/epp/messages/${id}"
}

# ─── 準備 ────────────────────────────────────────────────────
step "準備: backend 疎通 + D1 sqlite 特定 + teama session"
# 疎通確認は認証系エンドポイントを叩いて 401 (認証必要) が返れば OK とする。
# domains/check は両レジストリ hello の Promise.all を叩くので、片方でも落ちてると failed になる。
CHK_RAW="$(curl -sS -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/v1/secure/domains" --max-time 10)"
[ "$CHK_RAW" = "401" ] || fail "backend 疎通失敗 (expected 401, got ${CHK_RAW})"
D1_SQLITE="$(find_d1_sqlite)"
info "  D1 = ${D1_SQLITE}"
teama_setup
trap 'rm -f "${COOKIE}"' EXIT

STAMP="$(date +%s)"
RAND="$(head -c 3 /dev/urandom | xxd -p)"
DOMAIN="tr-out-rej-${STAMP}-${RAND}.${TLD}"
info "  registry  = ${REGISTRY_KIND} (${REGISTRY_URL})"
info "  domain    = ${DOMAIN}"

# ─── 1. teama-2 registry でドメイン作成 ─────────────────────
step "[1] teama-2: registry でドメイン作成 (${DOMAIN})"
# コンタクト作成
CID="C-$(head -c 4 /dev/urandom | xxd -p | tr 'a-f' 'A-F')"
CONTACT_BODY="{\"id\":\"${CID}\",\"postalInfo\":{\"name\":\"Taro Test\",\"addr\":{\"street\":\"N/A\",\"city\":\"N/A\",\"cc\":\"JP\"}},\"email\":\"taro.test@example.com\",\"authInfo\":\"$(head -c 8 /dev/urandom | xxd -p)\"}"
RAW="$(t2_call POST /api/v1/epp/contacts "${CONTACT_BODY}")"
ST="$(status_of "$RAW")"
[ "$ST" = "201" ] || [ "$ST" = "200" ] || fail "[1] teama-2 contact create 失敗 HTTP:${ST}"
info "  contact id = ${CID}"

# authInfo をクライアント側で生成
AUTH_INFO="$(head -c 12 /dev/urandom | xxd -p)"
DOMAIN_BODY="{\"domain\":\"${DOMAIN}\",\"period\":{\"unit\":\"Y\",\"value\":1},\"registrant\":\"${CID}\",\"contacts\":{\"ADMIN\":\"${CID}\",\"TECH\":\"${CID}\",\"BILLING\":\"${CID}\"},\"authInfo\":\"${AUTH_INFO}\"}"
RAW="$(t2_call POST /api/v1/epp/domains "${DOMAIN_BODY}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "201" ] || fail "[1] teama-2 domain create 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
info "  domain    = ${DOMAIN}"
info "  authInfo  = ${AUTH_INFO}"
ok "[1] teama-2 registry でドメイン作成成功"

# ─── 2. teama backend で移管申請 ─────────────────────────────
step "[2] teama: backend API で移管申請 (POST /api/v1/secure/transfers)"
RAW="$(teama_call POST /api/v1/secure/transfers "{\"name\":\"${DOMAIN}\",\"authInfo\":\"${AUTH_INFO}\",\"registry\":\"${REGISTRY_KIND}\"}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "202" ] || fail "[2] backend transfer request 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
KIND="$(json_get "$BD" 'data.kind')"
OUT_ID="$(json_get "$BD" 'data.id')"
info "  kind      = ${KIND}"
info "  outbound id = ${OUT_ID}"
[ "$KIND" = "outbound" ] || fail "[2] kind が outbound でない (${KIND})"

# DB に outbound 行が入っているか確認
DB_OUT="$(sqlite3 "${D1_SQLITE}" "SELECT id||'|'||status||'|'||gaining_user_id FROM outbound_transfer_requests WHERE domain_name='${DOMAIN}' AND status='pendingTransfer';")"
[ -n "$DB_OUT" ] || fail "[2] outbound_transfer_requests に pending 行が無い"
info "  DB outbound row = ${DB_OUT}"
ok "[2] backend で outbound 申請完了 (registry にも request 済み)"

# ─── 3. teama-2 registry でポーリング → op=request 確認 ──────
step "[3] teama-2: registry で poll → op=request が届いていることを確認"
sleep 1  # registry がキューにメッセージ入れる時間
# キューに前回テストの残骸があるかもしれない (未 ack のまま先頭に居座る)。
# 該当ドメインが先頭に来るまで先頭を ack して drain する (最大 30 件)。
FOUND=0
for i in $(seq 1 30); do
  POLL_RAW="$(t2_call GET /api/v1/epp/messages)"
  POLL_BD="$(body_of "$POLL_RAW")"
  MSG_ID="$(json_get "$POLL_BD" 'resData.message.id')"
  MSG_OP="$(json_get "$POLL_BD" 'resData.message.payload.op')"
  MSG_DOM="$(json_get "$POLL_BD" 'resData.message.payload.domain')"
  [ -z "$MSG_ID" ] && { warn "  キューが空になった (該当メッセージ未着)"; break; }
  if [ "$MSG_DOM" = "${DOMAIN}" ] && [ "$MSG_OP" = "request" ]; then
    info "  msg_id = ${MSG_ID} op=${MSG_OP} domain=${MSG_DOM}"
    ack_registry_msg "${MSG_ID}" >/dev/null
    FOUND=1
    break
  fi
  # 別ドメインの残骸メッセージなので ack して次へ
  info "  drain: id=${MSG_ID} op=${MSG_OP} domain=${MSG_DOM} → ack"
  ack_registry_msg "${MSG_ID}" >/dev/null
done
[ "$FOUND" = "1" ] || fail "[3] キューを 30 件 drain しても該当 op=request メッセージが見つからなかった"
ok "[3] teama-2 で op=request 受信・ack 完了"

# ─── 4. teama-2 registry で reject ───────────────────────────
step "[4] teama-2: registry で transfer/reject"
RAW="$(t2_call POST "/api/v1/epp/domains/${DOMAIN}/transfer/reject")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "[4] teama-2 reject 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
REJ_STATUS="$(json_get "$BD" 'resData.status')"
info "  transfer.status=${REJ_STATUS}"
[ "$REJ_STATUS" = "clientRejected" ] || fail "[4] reject 応答 status が clientRejected でない (${REJ_STATUS})"
ok "[4] teama-2 reject 成功"

# ─── 5. teama-2 registry で info 確認 (所有権据え置き) ────────
step "[5] teama-2: registry で info 確認 (teama-2 所有のまま)"
RAW="$(t2_call GET "/api/v1/epp/domains/${DOMAIN}")"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "[5] info 失敗 HTTP:${ST} body=$(printf '%s' "$BD" | head -c 300)"
INFO_STATUS="$(json_get "$BD" 'resData.status')"
info "  status = ${INFO_STATUS}"
# reject 後は pendingTransfer が解けて ok に戻っているはず
case "$INFO_STATUS" in
  *pendingTransfer*) fail "[5] reject 後もレジストリ側の status に pendingTransfer が残っている (${INFO_STATUS})" ;;
esac
ok "[5] レジストリ側 pendingTransfer 解除 (teama-2 所有のまま)"

# ─── 6. teama backend で cron 発火 → outbound=clientRejected 確認 ─
step "[6] teama: /__scheduled で cron 発火 → outbound=clientRejected、domain 行は作られない"
trigger_cron
info "  cron 発火完了、DB 検証..."

# domain 行が作られていないことを確認
DB_DOM="$(sqlite3 "${D1_SQLITE}" "SELECT id FROM domains WHERE name='${DOMAIN}';")"
[ -z "$DB_DOM" ] || fail "[6] teama backend DB に domain 行が誤って作られている: ${DB_DOM}"
info "  domain 行なし ✓"

# outbound_transfer_requests が clientRejected に更新されているか
DB_OUT_NEW="$(sqlite3 "${D1_SQLITE}" "SELECT status FROM outbound_transfer_requests WHERE id='${OUT_ID}';")"
info "  outbound.status = ${DB_OUT_NEW}"
[ "${DB_OUT_NEW}" = "clientRejected" ] || fail "[6] outbound.status が clientRejected でない (${DB_OUT_NEW})"

# teama backend API 経由で domain が見えないことも確認
RAW="$(teama_call GET /api/v1/secure/domains)"
ST="$(status_of "$RAW")"; BD="$(body_of "$RAW")"
[ "$ST" = "200" ] || fail "[6] /secure/domains 取得失敗 HTTP:${ST}"
if echo "$BD" | grep -q "\"${DOMAIN}\""; then
  fail "[6] teama backend の /secure/domains に ${DOMAIN} が誤って出ている: $(echo "$BD" | head -c 400)"
fi
ok "[6] teama backend に domain 未出現 + outbound=clientRejected 確認"

# ─── 総括 ────────────────────────────────────────────────────
printf "\n${GREEN}=== 6 ステップ e2e (outbound reject: teama-2 が拒否) 完了 ===${RESET}\n"
printf "  domain     : %s (teama-2 所有のまま)\n" "$DOMAIN"
printf "  outbound_id: %s\n" "$OUT_ID"
printf "  結果       : teama-2 が移管申請を拒否 → outbound=clientRejected\n"
