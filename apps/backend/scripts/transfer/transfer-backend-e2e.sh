#!/usr/bin/env bash
# transfer-backend-e2e.sh
# 2 レジストラ間 transfer e2e (teama = backend 経由 / teama-2 = レジストリ直叩き)
#
# 役割:
#   teama   = 登録者 (owner=losing)。すべての操作を backend API 経由で行う。
#             create / approve / reject / delete をユーザー視点で叩く。
#   teama-2 = 移管申請者 (gaining)。backend 側にセッションを持たないので
#             レジストリ (epp.kitaqsign.com) を直接叩いて request / cancel する。
#
# 前提:
#   - backend が localhost:8787 で起動 (pnpm run dev)
#   - .env に teama credentials + SECRET_KEY (seed user 作成用)
#   - .env.teama2 に teama-2 credentials
#   - D1 local sqlite が migrate 済み (authInfo を取り出すため sqlite 直読み)
#
# シナリオ:
#   A. 承認: teama が create → teama-2 が transfer/request → teama が approve
#   B. 拒否: 同 request → teama が reject
#   C. 取消: 同 request → teama-2 が自分で cancel
#   D. authInfo 不一致: teama-2 が違う authInfo で request → 401/403 + 2202
#
# 使い方:
#   cd apps/backend
#   pnpm run dev  # 別ターミナル
#   ./scripts/transfer-backend-e2e.sh

set -uo pipefail

# ─── 色 ──────────────────────────────────────────────────────
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
scenario_fail() { printf "${RED}✗ %s${RESET}\n" "$*" >&2; return 1; }

PASSED=()
FAILED=()

# ─── env ロード ──────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"

[ -f "${BACKEND_DIR}/.env" ]         || fail "${BACKEND_DIR}/.env が見つかりません (teama credentials + SECRET_KEY)"
[ -f "${BACKEND_DIR}/.env.teama2" ]  || fail "${BACKEND_DIR}/.env.teama2 が見つかりません (teama-2 credentials)"

# teama の credentials (backend 経由で使うので直接は要らないが、確認だけ)
set -a; source "${BACKEND_DIR}/.env"; set +a
[ -n "${SECRET_KEY:-}" ] || fail "SECRET_KEY が .env に無い (seed user 作成に必要)"
TEAMA_KS_REG="${KITAQSIGN_REGISTRAR_ID}"

# teama-2 の credentials (レジストリ直叩き用)
set -a; source "${BACKEND_DIR}/.env.teama2"; set +a
TEAMA2_KS_USER="${KITAQSIGN_BASIC_USER}"
TEAMA2_KS_PASS="${KITAQSIGN_BASIC_PASS}"
TEAMA2_KS_REG="${KITAQSIGN_REGISTRAR_ID}"
TEAMA2_KS_API="${KITAQSIGN_API_KEY}"

if [ "${TEAMA_KS_REG}" = "${TEAMA2_KS_REG}" ]; then
  fail "teama と teama-2 の KITAQSIGN_REGISTRAR_ID が同じ (${TEAMA_KS_REG})。別レジストラ間 transfer が検証できません。"
fi

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
REGISTRY_URL="${REGISTRY_URL:-https://epp.kitaqsign.com}"
D1_DIR="${D1_DIR:-${BACKEND_DIR}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject}"
CLEANUP="${CLEANUP:-1}"

info "backend       = ${BACKEND_URL}"
info "registry      = ${REGISTRY_URL}"
info "teama         = backend API 経由 (registrar id = ${TEAMA_KS_REG})"
info "teama-2       = レジストリ直叩き (registrar id = ${TEAMA2_KS_REG})"

# ─── レジストリ直叩き (teama-2 用) ───────────────────────────

# レジストリを teama-2 credentials で叩く。stdout: 1行目 __HTTP__NNN, 2行目以降 body
call_registry_teama2() {
  local method="$1" path="$2" body="${3:-}"
  local args=(
    -sS -X "$method" "${REGISTRY_URL}${path}"
    -u "${TEAMA2_KS_USER}:${TEAMA2_KS_PASS}"
    -H "X-Registrar-Id: ${TEAMA2_KS_REG}"
    -H "X-Api-Key: ${TEAMA2_KS_API}"
    -H "Content-Type: application/json"
    -w "\n__HTTP__%{http_code}"
    --max-time 20
  )
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

# ─── backend API 呼び出し (teama 用) ─────────────────────────

# teama のセッション cookie ファイル (sign-in 後に保存)
COOKIE_TEAMA=""

# teama backend 呼び出し。stdout: 1行目 __HTTP__NNN, 2行目以降 body
call_backend_teama() {
  local method="$1" path="$2" body="${3:-}"
  local args=(
    -sS -X "$method" "${BACKEND_URL}${path}"
    -b "${COOKIE_TEAMA}"
    -H "Content-Type: application/json"
    -w "\n__HTTP__%{http_code}"
    --max-time 20
  )
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

# ─── ヘルパ ──────────────────────────────────────────────────
status_of() { printf "%s" "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
body_of()   { printf "%s" "$1" | sed 's/__HTTP__[0-9]*$//'; }

json_get() {
  local raw="$1" jq_path="$2"
  printf "%s" "$raw" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(''); sys.exit(0)
try:
    for p in '$jq_path'.split('.'):
        if p == '': continue
        if p.startswith('[') and p.endswith(']'):
            d = d[int(p[1:-1])]
        else:
            d = d[p]
    print(d if not isinstance(d, (list, dict)) else json.dumps(d, ensure_ascii=False))
except Exception:
    print('')
"
}

# D1 sqlite を特定
find_d1_sqlite() {
  local f base
  for f in "${D1_DIR}"/*.sqlite; do
    base="$(basename "${f}")"
    [ "${base}" = "metadata.sqlite" ] && continue
    [ "${base}" = "*.sqlite" ] && continue
    if echo "${base}" | grep -qE '^[a-f0-9]{32,}\.sqlite$'; then
      echo "${f}"; return 0
    fi
  done
  fail "D1 sqlite が見つかりません (${D1_DIR})"
}

# ドメイン名から authInfo を D1 直読みで取り出す
# backend の DomainSchema には authInfo が含まれないため、DB を直接見るしかない
get_auth_info() {
  local domain_name="$1"
  sqlite3 "${D1_SQLITE}" "SELECT auth_info FROM domains WHERE name='${domain_name}';"
}

# ─── teama 側の一連の操作を backend 経由で ───────────────────

# teama ユーザーを seed 作成 + sign-in
setup_teama_session() {
  local email="teama-$(date +%s)-$$@example.com"
  local password="P@ssw0rd-teama"
  local name="Taro Test"

  local raw status resp
  raw="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
    -H "Authorization: Bearer ${SECRET_KEY}" \
    -H "Content-Type: application/json" \
    -w "\n__HTTP__%{http_code}" --max-time 15 \
    -d "{\"email\":\"${email}\",\"name\":\"${name}\",\"password\":\"${password}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  [ "$status" = "200" ] || [ "$status" = "201" ] || fail "seed user 作成失敗 HTTP:${status} body=${resp}"

  COOKIE_TEAMA="$(mktemp)"
  raw="$(curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
    -H "Content-Type: application/json" -c "${COOKIE_TEAMA}" \
    -w "\n__HTTP__%{http_code}" --max-time 15 \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  [ "$status" = "200" ] || fail "sign-in 失敗 HTTP:${status} body=${resp}"

  ok "teama session 取得 (${email})"
}

# teama がドメイン作成 (backend 経由) → stdout: "domainId|domainName|authInfo"
# authInfo は backend response に無いので DB 直読み
create_domain_teama_via_backend() {
  local name="$1"
  local raw status resp
  raw="$(call_backend_teama POST /api/v1/secure/domains \
    "{\"name\":\"${name}\",\"registry\":\"kitaqsign\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  if [ "$status" != "201" ]; then
    warn "backend create domain 失敗 HTTP:${status} body=$(printf '%s' "$resp" | head -c 300)"
    return 1
  fi
  local domain_id
  domain_id="$(json_get "$resp" 'data.id')"
  [ -n "$domain_id" ] || { warn "backend create レスポンスに data.id が無い: $resp"; return 1; }

  local auth_info
  auth_info="$(get_auth_info "$name")"
  [ -n "$auth_info" ] || { warn "DB から authInfo が取れない (name=${name})"; return 1; }

  printf "%s|%s|%s\n" "$domain_id" "$name" "$auth_info"
}

# cron を手動発火する (wrangler dev の scheduled ハンドラを叩く)。
# これで teama-2 が registry に投げた request メッセージを cron poll が拾って
# 自 backend の transfers テーブルに pending 行を作る。
trigger_cron() {
  local raw status
  raw="$(curl -sS -w '\n__HTTP__%{http_code}' --max-time 30 \
    "${BACKEND_URL}/cdn-cgi/handler/scheduled?cron=*+*+*+*+*")"
  status="$(status_of "$raw")"
  info "  cron trigger → HTTP:${status}"
  [ "$status" = "200" ]
}

# teama が transfer/approve (backend 経由)
approve_teama_via_backend() {
  local domain_id="$1"
  call_backend_teama POST "/api/v1/secure/domains/${domain_id}/transfer/approve"
}

# teama が transfer/reject (backend 経由)
reject_teama_via_backend() {
  local domain_id="$1"
  call_backend_teama POST "/api/v1/secure/domains/${domain_id}/transfer/reject"
}

# teama が domain delete (backend 経由)
delete_teama_via_backend() {
  local domain_id="$1"
  local raw status
  raw="$(call_backend_teama DELETE "/api/v1/secure/domains/${domain_id}")"
  status="$(status_of "$raw")"
  info "  delete (teama backend) domain_id=${domain_id} → HTTP:${status}"
}

# ─── 準備: backend 疎通 + teama session ──────────────────────

step "backend 疎通"
raw="$(curl -sS "${BACKEND_URL}/api/v1/public/domains/check" \
  -H "Content-Type: application/json" -d '{"name":"example.com"}' \
  -w "\n__HTTP__%{http_code}" --max-time 10)"
status="$(status_of "$raw")"
[ "$status" = "200" ] || fail "backend 疎通失敗 HTTP:${status}"
ok "backend 応答あり"

step "D1 sqlite 特定"
D1_SQLITE="$(find_d1_sqlite)"
info "D1 = ${D1_SQLITE}"

step "teama session (backend 経由) を確立"
setup_teama_session
# cookie の削除は cleanup_all の後 (下の統合 trap) に行う

step "teama-2 疎通 (レジストリ直叩き)"
raw="$(call_registry_teama2 GET /api/v1/epp/sessions/hello)"
status="$(status_of "$raw")"; resp="$(body_of "$raw")"
[ "$status" = "200" ] || fail "teama-2 hello 失敗 HTTP:${status} body=$(printf '%s' "$resp" | head -c 200)"
ok "teama-2 hello 疎通 OK"

# 生成するドメイン名の共通接頭辞
STAMP="$(date +%s)"
RAND="$(head -c 3 /dev/urandom | xxd -p)"

# cleanup 用: teama が backend 経由で delete する対象 (domainId)
CLEANUP_TEAMA_IDS=()
# teama-2 が持ってしまったドメイン (承認済み) はレジストリ直叩きで delete
CLEANUP_TEAMA2_NAMES=()

cleanup_all() {
  [ "$CLEANUP" = "1" ] || { warn "CLEANUP=0 のためドメインを残します"; return; }
  step "cleanup: 生成したドメインを削除"
  for id in "${CLEANUP_TEAMA_IDS[@]:-}"; do [ -n "$id" ] && delete_teama_via_backend "$id"; done
  for name in "${CLEANUP_TEAMA2_NAMES[@]:-}"; do
    [ -n "$name" ] || continue
    raw="$(call_registry_teama2 DELETE "/api/v1/epp/domains/${name}")"
    status="$(status_of "$raw")"
    info "  delete (teama-2 registry) $name → HTTP:${status}"
  done
}
trap 'cleanup_all; rm -f "${COOKIE_TEAMA}"' EXIT

# ============================================================
# シナリオ A: 承認フロー
# ============================================================
scenario_a() {
  step "[A] 承認フロー: teama が create (backend) → teama-2 が request (registry) → teama が approve (backend)"
  local name="tr-be-a-${STAMP}-${RAND}.com"

  info "[A-1] teama が backend 経由で create"
  local triple
  triple="$(create_domain_teama_via_backend "$name")" || return 1
  local domain_id="${triple%%|*}"
  local rest="${triple#*|}"
  local domain_name="${rest%%|*}"
  local auth="${rest#*|}"
  CLEANUP_TEAMA_IDS+=("$domain_id")
  info "  domain_id = $domain_id"
  info "  name      = $domain_name"
  info "  authInfo  = $auth (DB から取得)"

  info "[A-2] teama-2 が registry 直叩きで transfer/request"
  local raw status resp
  raw="$(call_registry_teama2 POST "/api/v1/epp/domains/${name}/transfer/request" \
    "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[A] request 失敗 HTTP:${status}"; return 1; }
  local req_status
  req_status="$(json_get "$resp" 'resData.status')"
  info "  transfer.status = ${req_status}"
  [ "$req_status" = "pendingTransfer" ] || { scenario_fail "[A] status が pendingTransfer でない (${req_status})"; return 1; }
  ok "[A-2] request 受付 → pendingTransfer"

  info "[A-2b] cron 発火: 外部 pending を backend DB に取り込ませる"
  trigger_cron || { scenario_fail "[A] cron 発火失敗"; return 1; }

  info "[A-3] teama が backend 経由で approve"
  raw="$(approve_teama_via_backend "$domain_id")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[A] backend approve 失敗 HTTP:${status}"; return 1; }
  ok "[A-3] backend approve 成功 (backend が bridge 経由で transferApprove を叩き、DB を commitApproved した)"

  # 承認後は teama-2 の所有になっているはず。cleanup を teama-2 側に付け替え。
  # (backend の DB では teama の domain レコードが残ってるが、レジストリでは teama-2 所有)
  # backend の delete は「レジストリで delete」→「DB で status=pendingDelete」の流れ。
  # 所有権が teama-2 に移った後は teama backend からは delete できない (sponsoring registrar でない)。
  # そのため cleanup 対象を teama_ids から外して teama2_names に付け替える。
  CLEANUP_TEAMA_IDS=("${CLEANUP_TEAMA_IDS[@]/${domain_id}}")
  CLEANUP_TEAMA2_NAMES+=("$name")
  ok "[A] 承認フロー完了: 所有権が teama-2 に移動"
  return 0
}

# ============================================================
# シナリオ B: 拒否フロー
# ============================================================
scenario_b() {
  step "[B] 拒否フロー: teama が create (backend) → teama-2 が request (registry) → teama が reject (backend)"
  local name="tr-be-b-${STAMP}-${RAND}.com"

  info "[B-1] teama が backend 経由で create"
  local triple
  triple="$(create_domain_teama_via_backend "$name")" || return 1
  local domain_id="${triple%%|*}"
  local rest="${triple#*|}"
  local auth="${rest#*|}"
  CLEANUP_TEAMA_IDS+=("$domain_id")

  info "[B-2] teama-2 が registry 直叩きで transfer/request"
  local raw status resp
  raw="$(call_registry_teama2 POST "/api/v1/epp/domains/${name}/transfer/request" \
    "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status}"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[B] request 失敗 HTTP:${status}"; return 1; }

  info "[B-2b] cron 発火: 外部 pending を backend DB に取り込ませる"
  trigger_cron || { scenario_fail "[B] cron 発火失敗"; return 1; }

  info "[B-3] teama が backend 経由で reject"
  raw="$(reject_teama_via_backend "$domain_id")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[B] backend reject 失敗 HTTP:${status}"; return 1; }
  ok "[B] 拒否フロー完了: 所有権据え置き"
  return 0
}

# ============================================================
# シナリオ C: 取消フロー (teama-2 が申請者として cancel)
# ============================================================
scenario_c() {
  step "[C] 取消フロー: teama が create (backend) → teama-2 が request (registry) → teama-2 が cancel (registry)"
  local name="tr-be-c-${STAMP}-${RAND}.com"

  info "[C-1] teama が backend 経由で create"
  local triple
  triple="$(create_domain_teama_via_backend "$name")" || return 1
  local domain_id="${triple%%|*}"
  local rest="${triple#*|}"
  local auth="${rest#*|}"
  CLEANUP_TEAMA_IDS+=("$domain_id")

  info "[C-2] teama-2 が registry 直叩きで transfer/request"
  local raw status resp
  raw="$(call_registry_teama2 POST "/api/v1/epp/domains/${name}/transfer/request" \
    "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status}"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[C] request 失敗 HTTP:${status}"; return 1; }

  info "[C-3] teama-2 が registry 直叩きで transfer/cancel (申請者自身が取消)"
  raw="$(call_registry_teama2 POST "/api/v1/epp/domains/${name}/transfer/cancel")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[C] cancel 失敗 HTTP:${status}"; return 1; }
  local can_status
  can_status="$(json_get "$resp" 'resData.status')"
  [ "$can_status" = "clientCancelled" ] || { scenario_fail "[C] cancel 応答 status が clientCancelled でない (${can_status})"; return 1; }
  ok "[C] 取消フロー完了 (transfer.status=${can_status})"
  return 0
}

# ============================================================
# シナリオ D: authInfo 不一致
# ============================================================
scenario_d() {
  step "[D] authInfo 不一致: teama-2 が違う authInfo で request → 拒否される"
  local name="tr-be-d-${STAMP}-${RAND}.com"

  info "[D-1] teama が backend 経由で create"
  local triple
  triple="$(create_domain_teama_via_backend "$name")" || return 1
  local domain_id="${triple%%|*}"
  CLEANUP_TEAMA_IDS+=("$domain_id")

  info "[D-2] teama-2 が **間違った** authInfo で transfer/request"
  local raw status resp code
  raw="$(call_registry_teama2 POST "/api/v1/epp/domains/${name}/transfer/request" \
    "{\"op\":\"request\",\"authInfo\":\"WRONG-authInfo-${STAMP}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 300)"
  code="$(json_get "$resp" 'result.code')"
  info "  result.code = ${code}"
  if [ "$status" = "401" ]; then
    ok "[D] authInfo 不一致で HTTP 401"
  elif [ "$status" = "403" ] && [ "$code" = "2202" ]; then
    ok "[D] authInfo 不一致で HTTP 403 + result.code 2202"
  elif { [ "$status" = "202" ] || [ "$status" = "200" ]; } && [ "$code" = "2202" ]; then
    ok "[D] authInfo 不一致で HTTP ${status} + result.code 2202"
  else
    scenario_fail "[D] authInfo 不一致で予期せぬ HTTP:${status} + code:${code}"
    return 1
  fi
  return 0
}

# ============================================================
# 実行
# ============================================================
if scenario_a; then PASSED+=("A: 承認"); else FAILED+=("A: 承認"); fi
if scenario_b; then PASSED+=("B: 拒否"); else FAILED+=("B: 拒否"); fi
if scenario_c; then PASSED+=("C: 取消"); else FAILED+=("C: 取消"); fi
if scenario_d; then PASSED+=("D: authInfo 不一致"); else FAILED+=("D: authInfo 不一致"); fi

printf "\n${YELLOW}=== transfer backend e2e サマリ (teama=backend / teama-2=registry) ===${RESET}\n"
printf "  passed: %d\n" "${#PASSED[@]}"
for s in "${PASSED[@]:-}"; do [ -n "$s" ] && printf "    ${GREEN}✓${RESET} %s\n" "$s"; done
printf "  failed: %d\n" "${#FAILED[@]}"
for s in "${FAILED[@]:-}"; do [ -n "$s" ] && printf "    ${RED}✗${RESET} %s\n" "$s"; done

if [ ${#FAILED[@]} -gt 0 ]; then exit 1; fi
