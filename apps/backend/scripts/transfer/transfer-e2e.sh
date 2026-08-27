#!/usr/bin/env bash
# transfer-e2e.sh
# transfer 機能の動作確認スクリプト。
#
# 「実 backend で叩けるすべてのパス」を網羅する:
#   1. 認可 / バリデーション / エラーマッピング
#   2. transfer request → bridge 失敗 → rollback (Drop #1 + NB-9 + Smell 1)
#   3. DB unique 制約 (B14)
#
# 実行不可 (原理的制約) なので対象外:
#   - transfer request の happy path (Kitaqsign は同一レジストラ内 transfer を拒否)
#   - poll consumer / DLQ / safety-net cron (Cloudflare Workers 環境で数十分〜1時間必要)
#
# 使い方:
#   pnpm run dev  # 別ターミナル
#   ./scripts/transfer-e2e.sh
#
# 前提:
#   - backend が localhost:8787 で起動している
#   - SECRET_KEY 環境変数が設定されている (see .env.example)
#   - D1 local sqlite が既に migrate 済み

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
# S-I: hardcoded secret を廃止。SECRET_KEY は env から強制取得する。
if [[ -z "${SECRET_KEY:-}" ]]; then
  echo "SECRET_KEY 環境変数が設定されていません。.env.example を参照して設定してください。" >&2
  exit 1
fi
D1_DIR="${D1_DIR:-/Users/ota/Desktop/git-managed/gmo-domain/apps/backend/.wrangler/state/v3/d1/miniflare-D1DatabaseObject}"

TIMESTAMP="$(date +%s)"
OWNER_EMAIL="losing.${TIMESTAMP}@example.com"
OWNER_NAME="Taro Test"
GAINING_EMAIL="gaining.${TIMESTAMP}@example.com"
GAINING_NAME="Hanako Test"
PASSWORD="admin123"
DOMAIN_NAME="tr-e2e-${TIMESTAMP}.com"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

# ログ関数は stderr に出す。assert_status のように stdout を戻り値として使う関数から呼ばれても、
# 呼び出し元の $(...) キャプチャに混ざらないようにする。
step()  { printf "\n${YELLOW}==> %s${RESET}\n" "$*" >&2; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*" >&2; }
info()  { printf "${CYAN}  %s${RESET}\n" "$*" >&2; }
fail()  { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

# HTTP ステータスを取得する共通関数。
# 出力: 1行目=HTTP status, 2行目以降=response body
http_call() {
  local method="$1" url="$2" cookie="$3" body="${4:-}"
  local args=(-sS -X "${method}" "${url}" -H "Content-Type: application/json" -w "\n__HTTP__%{http_code}")
  if [ -n "${cookie}" ]; then args+=(-b "${cookie}"); fi
  if [ -n "${body}" ]; then args+=(-d "${body}"); fi
  curl "${args[@]}"
}

# response と期待ステータスを検証。
assert_status() {
  local raw="$1" expected="$2" label="$3"
  local status
  status="$(echo "${raw}" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p')"
  local body
  body="$(echo "${raw}" | sed 's/__HTTP__[0-9]*$//')"
  if [ "${status}" != "${expected}" ]; then
    fail "${label}: HTTP ${status} (期待 ${expected}) / body=${body}"
  fi
  ok "${label}: HTTP ${status}"
  # body を追加で assert したい呼び出し元向けに body を stdout に返す
  echo "${body}"
}

# D1 sqlite ファイルを特定 (glob展開を避けるため ls で解決)。
find_d1_sqlite() {
  # メタデータ以外の *.sqlite を探す (glob が展開されない場合の "*.sqlite" ファイル自体は除外)
  local f
  for f in "${D1_DIR}"/*.sqlite; do
    local base
    base="$(basename "${f}")"
    if [ "${base}" = "metadata.sqlite" ]; then continue; fi
    if [ "${base}" = "*.sqlite" ]; then continue; fi
    # 32文字hex.sqlite 形式なら本命
    if echo "${base}" | grep -qE '^[a-f0-9]{32,}\.sqlite$'; then
      echo "${f}"
      return 0
    fi
  done
  fail "D1 sqlite ファイルが見つかりません (${D1_DIR})"
}

# ─────────────────────────────────────────────────────────────
# 準備: backend 疎通 + owner/gaining ユーザー作成 + owner ドメイン作成
# ─────────────────────────────────────────────────────────────

step "backend の疎通確認"
if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
      -H "Content-Type: application/json" -d '{"name":"example.com"}' >/dev/null; then
  fail "${BACKEND_URL} に接続できません。backend を起動してください (pnpm run dev)"
fi
ok "backend 応答あり"

step "owner (losing) user 作成: ${OWNER_EMAIL}"
curl -sSf -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${OWNER_EMAIL}\",\"name\":\"${OWNER_NAME}\",\"password\":\"${PASSWORD}\"}" >/dev/null
ok "owner 作成成功"

COOKIE_OWNER="$(mktemp)"
trap 'rm -f "${COOKIE_OWNER}" "${COOKIE_GAINING:-}"' EXIT
curl -sSf -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${COOKIE_OWNER}" \
  -d "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"${PASSWORD}\"}" >/dev/null
ok "owner セッション取得"

step "owner ドメイン作成: ${DOMAIN_NAME}"
CREATE_RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/domains" "${COOKIE_OWNER}" \
  "{\"name\":\"${DOMAIN_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
BODY="$(assert_status "${CREATE_RES}" "201" "domain create")"
DOMAIN_ID="$(echo "${BODY}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
info "domain_id=${DOMAIN_ID}"
if [ -z "${DOMAIN_ID}" ]; then fail "domain_id が取れませんでした: ${BODY}"; fi

# ─────────────────────────────────────────────────────────────
# 1. Zod / バリデーション系
# ─────────────────────────────────────────────────────────────

step "[1] 不正 FQDN で transfer request (NB-4 RFC 1035 regex)"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_OWNER}" \
  '{"name":"-invalid-.com","authInfo":"aaa"}')"
assert_status "${RES}" "400" "invalid FQDN" >/dev/null

step "[2] authInfo が空で transfer request (B18 Zod min(1))"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_OWNER}" \
  "{\"name\":\"${DOMAIN_NAME}\",\"authInfo\":\"\"}")"
assert_status "${RES}" "400" "empty authInfo" >/dev/null

step "[3] 存在しないドメインで transfer request → 404"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_OWNER}" \
  '{"name":"nonexistent-domain-xyz-e2e.com","authInfo":"someauth"}')"
assert_status "${RES}" "404" "domain not found" >/dev/null

# ─────────────────────────────────────────────────────────────
# 2. B1: self_transfer 拒否
# ─────────────────────────────────────────────────────────────

step "[4] owner が自分のドメインに transfer 申請 (B1 self_transfer → 403)"
D1_SQLITE="$(find_d1_sqlite)"
info "D1 = ${D1_SQLITE}"
AUTH_INFO="$(sqlite3 "${D1_SQLITE}" "SELECT auth_info FROM domains WHERE name='${DOMAIN_NAME}'")"
if [ -z "${AUTH_INFO}" ]; then fail "DB から authInfo が取れませんでした"; fi
info "authInfo=${AUTH_INFO}"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_OWNER}" \
  "{\"name\":\"${DOMAIN_NAME}\",\"authInfo\":\"${AUTH_INFO}\"}")"
BODY="$(assert_status "${RES}" "403" "self_transfer")"
if ! echo "${BODY}" | grep -q "自分が所有"; then fail "self_transfer メッセージが違う: ${BODY}"; fi
ok "self_transfer ユーザーメッセージ OK"

# ─────────────────────────────────────────────────────────────
# 3. 認可系 (owner でないユーザーの操作)
# ─────────────────────────────────────────────────────────────

step "[5] 未認証で /transfers 取得 → 401"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/transfers" "")"
assert_status "${RES}" "401" "unauthenticated /transfers" >/dev/null

step "[6] owner が transfer レコード無しで approve → 409 (B2)"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/transfer/approve" "${COOKIE_OWNER}" "")"
assert_status "${RES}" "409" "approve without pending" >/dev/null

step "[7] owner が transfer レコード無しで reject → 409 (B2)"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/transfer/reject" "${COOKIE_OWNER}" "")"
assert_status "${RES}" "409" "reject without pending" >/dev/null

step "[8] owner が transfer 一覧取得 (自分は gaining ではないので空)"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_OWNER}")"
BODY="$(assert_status "${RES}" "200" "owner /transfers")"
if ! echo "${BODY}" | grep -q '"data":\[\]'; then fail "owner の /transfers は空のはず: ${BODY}"; fi
ok "owner の /transfers は空"

step "[8b] owner が inbound pending transfers 取得 (まだ申請なし → 空)"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/domains/pending-inbound-transfers" "${COOKIE_OWNER}")"
BODY="$(assert_status "${RES}" "200" "owner inbound pending")"
if ! echo "${BODY}" | grep -q '"data":\[\]'; then fail "inbound pending は空のはず: ${BODY}"; fi
ok "owner の inbound pending は空 (申請前)"

# ─────────────────────────────────────────────────────────────
# 4. gaining ユーザーからの操作 (認可 + rollback)
# ─────────────────────────────────────────────────────────────

step "gaining user 作成: ${GAINING_EMAIL}"
curl -sSf -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer ${SECRET_KEY}" -H "Content-Type: application/json" \
  -d "{\"email\":\"${GAINING_EMAIL}\",\"name\":\"${GAINING_NAME}\",\"password\":\"${PASSWORD}\"}" >/dev/null
ok "gaining 作成成功"

COOKIE_GAINING="$(mktemp)"
curl -sSf -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" -c "${COOKIE_GAINING}" \
  -d "{\"email\":\"${GAINING_EMAIL}\",\"password\":\"${PASSWORD}\"}" >/dev/null
ok "gaining セッション取得"

step "[9] gaining が別 owner のドメインに approve → 403"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/transfer/approve" "${COOKIE_GAINING}" "")"
assert_status "${RES}" "403" "gaining approve someone else's domain" >/dev/null

step "[10] gaining が別 owner のドメインに reject → 403"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/transfer/reject" "${COOKIE_GAINING}" "")"
assert_status "${RES}" "403" "gaining reject someone else's domain" >/dev/null

step "[11] gaining が存在しない transferId を cancel → 404"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers/nonexistent-id/cancel" "${COOKIE_GAINING}" "")"
assert_status "${RES}" "404" "cancel nonexistent" >/dev/null

step "[12] gaining が正しい authInfo で transfer request (bridge 500 → rollback)"
info "Kitaqsign は同一レジストラ内 transfer を拒否するので bridge は 500 を返す。"
info "重要なのは rollback (Drop #1 + NB-9) で DB が clientCancelled + domain.status=ok に戻ること。"
RES="$(http_call POST "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_GAINING}" \
  "{\"name\":\"${DOMAIN_NAME}\",\"authInfo\":\"${AUTH_INFO}\"}")"
assert_status "${RES}" "500" "gaining transfer request (registry rejects)" >/dev/null

step "[13] gaining の /transfers に clientCancelled レコードが返る (B16 + rollback)"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/transfers" "${COOKIE_GAINING}")"
BODY="$(assert_status "${RES}" "200" "gaining /transfers")"
if ! echo "${BODY}" | grep -q '"status":"clientCancelled"'; then
  fail "clientCancelled が /transfers に無い: ${BODY}"
fi
ok "clientCancelled が /transfers に返る (rollback 経由)"

# ─────────────────────────────────────────────────────────────
# 5. DB 直接検証: rollback 後の状態が正しいか
# ─────────────────────────────────────────────────────────────

step "[14] DB 直接検証: transfer.status=clientCancelled + domain.status=ok"
TR_STATUS="$(sqlite3 "${D1_SQLITE}" \
  "SELECT status FROM transfers WHERE domain_id='${DOMAIN_ID}' ORDER BY created_at DESC LIMIT 1;")"
DOM_STATUS="$(sqlite3 "${D1_SQLITE}" \
  "SELECT status FROM domains WHERE id='${DOMAIN_ID}';")"
DOM_OWNER="$(sqlite3 "${D1_SQLITE}" \
  "SELECT owner_user_id FROM domains WHERE id='${DOMAIN_ID}';")"
OWNER_ID="$(sqlite3 "${D1_SQLITE}" \
  "SELECT id FROM user WHERE email='${OWNER_EMAIL}';")"
info "transfer.status = ${TR_STATUS}"
info "domain.status   = ${DOM_STATUS}"
info "domain.owner    = ${DOM_OWNER}"
info "expected owner  = ${OWNER_ID}"
[ "${TR_STATUS}" = "clientCancelled" ] || fail "transfer.status が clientCancelled ではない (${TR_STATUS})"
[ "${DOM_STATUS}" = "ok" ]              || fail "domain.status が ok に戻っていない (${DOM_STATUS})"
[ "${DOM_OWNER}" = "${OWNER_ID}" ]      || fail "domain.owner が変わっている (期待 ${OWNER_ID}, 実 ${DOM_OWNER})"
ok "rollback 後の DB 状態が完全整合 (Smell 1 settleAndReleaseDomain batch 動作確認)"

# ─────────────────────────────────────────────────────────────
# 6. B14: partial UNIQUE 制約が実際に効くか
# ─────────────────────────────────────────────────────────────

step "[15] B14 partial UNIQUE index が存在するか"
IDX="$(sqlite3 "${D1_SQLITE}" \
  "SELECT sql FROM sqlite_master WHERE type='index' AND name='transfers_pending_domain_unique_idx';")"
info "${IDX}"
echo "${IDX}" | grep -q "pendingTransfer" || fail "partial UNIQUE index の定義が期待と異なる"
ok "transfers_pending_domain_unique_idx が正しい定義で存在"

step "[16] 手動 insert で同ドメインに 2 つ目 pendingTransfer → UNIQUE 違反"
TEST_TR_1="test-pending-1-${TIMESTAMP}"
TEST_TR_2="test-pending-2-${TIMESTAMP}"
GAINING_ID="$(sqlite3 "${D1_SQLITE}" "SELECT id FROM user WHERE email='${GAINING_EMAIL}';")"
sqlite3 "${D1_SQLITE}" \
  "INSERT INTO transfers (id, domain_id, registry, status, gaining_user_id, created_at) VALUES ('${TEST_TR_1}', '${DOMAIN_ID}', 'kitaqsign', 'pendingTransfer', '${GAINING_ID}', unixepoch()*1000);"
ok "1 つ目 pendingTransfer 挿入成功"

if sqlite3 "${D1_SQLITE}" \
     "INSERT INTO transfers (id, domain_id, registry, status, gaining_user_id, created_at) VALUES ('${TEST_TR_2}', '${DOMAIN_ID}', 'kitaqsign', 'pendingTransfer', '${GAINING_ID}', unixepoch()*1000);" 2>/dev/null; then
  fail "2 つ目 pendingTransfer が挿入できてしまった (UNIQUE 制約失敗)"
fi
ok "2 つ目 pendingTransfer は UNIQUE 違反で拒否"

step "[16b] owner (losing) が inbound pending 一覧を取得 → 手動挿入した pending が見える"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/domains/pending-inbound-transfers" "${COOKIE_OWNER}")"
BODY="$(assert_status "${RES}" "200" "owner inbound pending after insert")"
if ! echo "${BODY}" | grep -q "\"transferId\":\"${TEST_TR_1}\""; then
  fail "inbound pending に手動挿入した transfer が含まれていない: ${BODY}"
fi
if ! echo "${BODY}" | grep -q "\"domainName\":\"${DOMAIN_NAME}\""; then
  fail "inbound pending に domain 名が含まれていない: ${BODY}"
fi
# gainingUserId は情報漏洩防止のため含めない
if echo "${BODY}" | grep -q "\"gainingUserId\""; then
  fail "inbound pending のレスポンスに gainingUserId が含まれている (情報漏洩): ${BODY}"
fi
ok "owner の inbound pending に該当 transfer が返却され、gainingUserId が漏洩していない"

step "[16c] gaining ユーザーで inbound pending 取得 → 空 (自分は losing ではない)"
RES="$(http_call GET "${BACKEND_URL}/api/v1/secure/domains/pending-inbound-transfers" "${COOKIE_GAINING}")"
BODY="$(assert_status "${RES}" "200" "gaining inbound pending")"
if ! echo "${BODY}" | grep -q '"data":\[\]'; then
  fail "gaining の inbound pending は空のはず: ${BODY}"
fi
ok "gaining の inbound pending は空 (自分は losing ではない)"

step "[17] settled (clientRejected) は同ドメインに複数挿入可能"
TEST_TR_3="test-settled-1-${TIMESTAMP}"
sqlite3 "${D1_SQLITE}" \
  "INSERT INTO transfers (id, domain_id, registry, status, gaining_user_id, created_at) VALUES ('${TEST_TR_3}', '${DOMAIN_ID}', 'kitaqsign', 'clientRejected', '${OWNER_ID}', unixepoch()*1000);"
ok "settled 挿入成功"

step "[18] テストレコード掃除"
sqlite3 "${D1_SQLITE}" "DELETE FROM transfers WHERE id LIKE 'test-%${TIMESTAMP}';"
ok "テストレコード削除"

# ─────────────────────────────────────────────────────────────
# 完了
# ─────────────────────────────────────────────────────────────
printf "\n${GREEN}=== transfer E2E 動作確認 完了 (全パス緑) ===${RESET}\n"
printf "  owner_email    : %s\n" "${OWNER_EMAIL}"
printf "  gaining_email  : %s\n" "${GAINING_EMAIL}"
printf "  domain_id      : %s\n" "${DOMAIN_ID}"
printf "  domain_name    : %s\n" "${DOMAIN_NAME}"
