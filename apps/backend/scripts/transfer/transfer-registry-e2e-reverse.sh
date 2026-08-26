#!/usr/bin/env bash
# transfer-registry-e2e-reverse.sh
# 2 レジストラ間の実 transfer フロー e2e (backend を介さずレジストリ直叩き)。
# ★向き★: teama-2 = 登録者 (losing) / teama = 移管申請者 (gaining)
#         (transfer-registry-e2e.sh とは登録者/gaining の役割が逆)
#
# 前提: 2 セットのレジストリ credentials
#   - .env        ... teama の credentials
#   - .env.teama2 ... teama-2 の credentials
#
# 検証シナリオ (シナリオごとに新ドメイン作成 → cleanup):
#   A. 承認フロー: teama-2 が create → teama が transfer/request → teama-2 が approve
#                  → 応答で teama が sponsoring registrar になったことを確認
#   B. 拒否フロー: 同 request → teama-2 が reject → 所有権据え置き確認
#   C. 取消フロー: 同 request → teama が cancel (申請者自身の取消)
#   D. authInfo 不一致: teama が違う authInfo で request → 401/403 + 2202 確認
#
# 使い方:
#   cd apps/backend
#   ./scripts/transfer-registry-e2e-reverse.sh
#
# 注意: シナリオ A 後は teama の所有になったドメインが残る。cleanup では持ち主に応じて delete する。

set -uo pipefail  # errexit は個別ハンドリングするので付けない

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
# fail はスクリプト全体を止める用 (setup 段階の致命的エラー)
fail()  { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }
# scenario_fail はシナリオ関数内で使い、関数を return 1 で抜ける
scenario_fail() { printf "${RED}✗ %s${RESET}\n" "$*" >&2; return 1; }

# シナリオ単位の pass/fail サマリ用
PASSED=()
FAILED=()

# ─── env ロード ──────────────────────────────────────────────
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"

[ -f "${BACKEND_DIR}/.env" ]         || fail "${BACKEND_DIR}/.env が見つかりません (teama credentials)"
[ -f "${BACKEND_DIR}/.env.teama2" ]  || fail "${BACKEND_DIR}/.env.teama2 が見つかりません (teama-2 credentials)"

# 逆向き: 登録者 (owner=losing) は teama-2、gaining は teama
# 変数名は前スクリプトと合わせて OWNER_* / GAINING_* にする (前は TEAMA_* / TEAMA2_* だった)。

# 登録者 (losing) = teama-2
set -a; source "${BACKEND_DIR}/.env.teama2"; set +a
OWNER_KS_USER="${KITAQSIGN_BASIC_USER}"
OWNER_KS_PASS="${KITAQSIGN_BASIC_PASS}"
OWNER_KS_REG="${KITAQSIGN_REGISTRAR_ID}"
OWNER_KS_API="${KITAQSIGN_API_KEY}"

# 移管申請者 (gaining) = teama
set -a; source "${BACKEND_DIR}/.env"; set +a
GAINING_KS_USER="${KITAQSIGN_BASIC_USER}"
GAINING_KS_PASS="${KITAQSIGN_BASIC_PASS}"
GAINING_KS_REG="${KITAQSIGN_REGISTRAR_ID}"
GAINING_KS_API="${KITAQSIGN_API_KEY}"

# レジストラ ID の同一性チェック
if [ "${OWNER_KS_REG}" = "${GAINING_KS_REG}" ]; then
  fail "owner (teama-2) と gaining (teama) の KITAQSIGN_REGISTRAR_ID が同じです (${OWNER_KS_REG})。別レジストラ間 transfer が検証できません。"
fi
info "登録者 (owner=losing) = teama-2  registrar = ${OWNER_KS_REG}"
info "移管申請者 (gaining)  = teama    registrar = ${GAINING_KS_REG}"
info ""
info "role assignment:"
info "  teama-2 は登録者。teama に移管される役。(script 上の呼び名: 'owner')"
info "  teama   は移管申請を出す gaining 役。teama が transfer/request を叩く。"

BASE_URL="${BASE_URL:-https://epp.kitaqsign.com}"
CLEANUP="${CLEANUP:-1}" # 1 なら最後に持ち主で delete を試みる

# ─── curl ラッパ ─────────────────────────────────────────────

# call_with_creds <role: owner|gaining> <method> <path> [body]
# owner=登録者 (今スクリプトでは teama-2)、gaining=移管申請者 (今スクリプトでは teama)
# 標準出力: 1行目 __HTTP__NNN, 2行目以降 body
call_with_creds() {
  local role="$1" method="$2" path="$3" body="${4:-}"
  local user pass reg api
  case "$role" in
    owner)
      user="${OWNER_KS_USER}"; pass="${OWNER_KS_PASS}"; reg="${OWNER_KS_REG}"; api="${OWNER_KS_API}";;
    gaining)
      user="${GAINING_KS_USER}"; pass="${GAINING_KS_PASS}"; reg="${GAINING_KS_REG}"; api="${GAINING_KS_API}";;
    *)
      fail "unknown role: $role";;
  esac
  # レジストリはハッカソン用に 504 gateway timeout を確率的に注入する。
  # ただし POST/DELETE (非べき等) は "サーバ側で処理は完了しているがレスポンスが届かない"
  # ケースがあり、自動リトライすると 409 "already processed" が返って script が誤失敗する。
  # そのため GET のみ retry を許可する。POST/DELETE は script 側で 504 リトライを明示制御する。
  local args=(
    -sS -X "$method" "${BASE_URL}${path}"
    -u "${user}:${pass}"
    -H "X-Registrar-Id: ${reg}"
    -H "X-Api-Key: ${api}"
    -H "Content-Type: application/json"
    -w "\n__HTTP__%{http_code}"
    --max-time 20
  )
  if [ "$method" = "GET" ]; then
    args+=(--retry 3 --retry-delay 2 --retry-all-errors)
  fi
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  curl "${args[@]}"
}

# raw の末尾 __HTTP__NNN から HTTP ステータスを抽出。
# status は関数を経由すると subshell で消えるので、呼び出し側で
# 直接展開したいときは status_of / body_of を使う。
status_of() {
  printf "%s" "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'
}
body_of() {
  printf "%s" "$1" | sed 's/__HTTP__[0-9]*$//'
}

# JSON パーサ (Python 依存)
json_get() {
  local raw="$1" jq_path="$2"
  printf "%s" "$raw" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print('')
    sys.exit(0)
try:
    for p in '$jq_path'.split('.'):
        if p == '':
            continue
        if p.startswith('[') and p.endswith(']'):
            d = d[int(p[1:-1])]
        else:
            d = d[p]
    print(d if not isinstance(d, (list, dict)) else json.dumps(d, ensure_ascii=False))
except Exception:
    print('')
"
}

# ─── ドメイン準備ヘルパ ──────────────────────────────────────

# 一意なコンタクト ID を生成
gen_contact_id() {
  echo "C-$(head -c 4 /dev/urandom | xxd -p | tr 'a-f' 'A-F')"
}

# 登録者 (owner=teama-2) がコンタクト作成 → stdout: contactId
create_contact_owner() {
  local cid="$(gen_contact_id)"
  local body="{\"id\":\"$cid\",\"postalInfo\":{\"name\":\"Taro Test\",\"addr\":{\"street\":\"N/A\",\"city\":\"N/A\",\"cc\":\"JP\"}},\"email\":\"taro.test@example.com\",\"authInfo\":\"$(head -c 8 /dev/urandom | xxd -p)\"}"
  local raw="$(call_with_creds owner POST /api/v1/epp/contacts "$body")"
  local status="$(status_of "$raw")"
  local resp="$(body_of "$raw")"
  if [ "$status" != "201" ] && [ "$status" != "200" ]; then
    warn "createContact failed HTTP:${status} body=$(printf '%s' "$resp" | head -c 200)"
    return 1
  fi
  echo "$cid"
}

# 登録者 (owner=teama-2) がドメイン作成 → stdout: authInfo
create_domain_owner() {
  local domain="$1"
  local contact_id="$2"
  local auth_info="$(head -c 12 /dev/urandom | xxd -p)"
  local body="{\"domain\":\"$domain\",\"period\":{\"unit\":\"Y\",\"value\":1},\"registrant\":\"$contact_id\",\"contacts\":{\"ADMIN\":\"$contact_id\",\"TECH\":\"$contact_id\",\"BILLING\":\"$contact_id\"},\"authInfo\":\"$auth_info\"}"
  local raw="$(call_with_creds owner POST /api/v1/epp/domains "$body")"
  local status="$(status_of "$raw")"
  local resp="$(body_of "$raw")"
  if [ "$status" != "201" ]; then
    warn "createDomain failed HTTP:${status} body=$(printf '%s' "$resp" | head -c 300)"
    return 1
  fi
  echo "$auth_info"
}

# ドメインの sponsoring registrar (clID) を info で取得
info_domain_clid() {
  local role="$1" domain="$2"
  local raw="$(call_with_creds "$role" GET "/api/v1/epp/domains/$domain")"
  local status="$(status_of "$raw")"
  local resp="$(body_of "$raw")"
  if [ "$status" != "200" ]; then
    printf "%s\n" "http:${status}"
    return
  fi
  # resData.clID
  json_get "$resp" "resData.clID"
}

# ドメイン削除 (teama or teama-2、role 指定)
delete_domain() {
  local role="$1" domain="$2"
  local raw="$(call_with_creds "$role" DELETE "/api/v1/epp/domains/$domain")"
  local status="$(status_of "$raw")"
  local resp="$(body_of "$raw")"
  info "  delete ($role) $domain → HTTP:${status}"
}

# ─── シナリオ内共通ヘルパ ────────────────────────────────────

# シナリオ 1 ステップ目: 新ドメイン作成 → stdout: authInfo (成功時)
# owner (=teama-2) が contact 作成 + domain 作成
setup_scenario_domain() {
  local domain="$1"
  local cid
  cid="$(create_contact_owner)" || return 1
  info "  contact id = $cid"
  local ai
  ai="$(create_domain_owner "$domain" "$cid")" || return 1
  info "  domain     = $domain"
  info "  authInfo   = $ai"
  info "  registrant = $cid"
  printf "%s\n" "$ai"
}

# ─── 疎通確認 ────────────────────────────────────────────────
step "疎通確認: owner (teama-2) で hello"
raw="$(call_with_creds owner GET /api/v1/epp/sessions/hello)"
status="$(status_of "$raw")"; resp="$(body_of "$raw")"
[ "$status" = "200" ] || fail "owner (teama-2) hello 失敗 HTTP:${status} body=$(printf '%s' "$resp" | head -c 200)"
ok "owner (teama-2) hello 疎通 OK"

step "疎通確認: gaining (teama) で hello"
raw="$(call_with_creds gaining GET /api/v1/epp/sessions/hello)"
status="$(status_of "$raw")"; resp="$(body_of "$raw")"
[ "$status" = "200" ] || fail "gaining (teama) hello 失敗 HTTP:${status} body=$(printf '%s' "$resp" | head -c 200)"
ok "gaining (teama) hello 疎通 OK"

# 生成するドメイン名の共通接頭辞 (逆向きなので rev サフィックス)
STAMP="$(date +%s)"
RAND="$(head -c 3 /dev/urandom | xxd -p)"

# シナリオ間で使ったドメインを覚えて cleanup で消す
CLEANUP_OWNER=()    # owner (teama-2) 所有のはずのドメイン
CLEANUP_GAINING=()  # 承認後に gaining (teama) 所有になったドメイン

cleanup_all() {
  [ "$CLEANUP" = "1" ] || { warn "CLEANUP=0 のためドメインを残します"; return; }
  step "cleanup: 生成したドメインを削除"
  for d in "${CLEANUP_OWNER[@]:-}"; do [ -n "$d" ] && delete_domain owner "$d"; done
  for d in "${CLEANUP_GAINING[@]:-}"; do [ -n "$d" ] && delete_domain gaining "$d"; done
}
trap cleanup_all EXIT

# ============================================================
# シナリオ A: 承認フロー
# ============================================================
scenario_a() {
  step "[A] 承認フロー: teama が request → teama-2 が approve"
  local domain="tr-e2e-rev-a-${STAMP}-${RAND}.com"
  CLEANUP_OWNER+=("$domain")

  info "[A-1] teama-2 (owner) がドメイン作成"
  local auth
  auth="$(setup_scenario_domain "$domain")" || return 1

  info "[A-2] teama (gaining) が transfer/request (authInfo 一致)"
  local raw status resp
  raw="$(call_with_creds gaining POST "/api/v1/epp/domains/${domain}/transfer/request" "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[A] request 失敗 HTTP:${status}"; return 1; }
  local req_status
  req_status="$(json_get "$resp" 'resData.status')"
  info "  transfer.status = ${req_status}"
  [ "$req_status" = "pendingTransfer" ] || { scenario_fail "[A] request 直後の status が pendingTransfer でない (${req_status})"; return 1; }
  ok "[A-2] request 受付 → pendingTransfer"

  info "[A-3] teama-2 (owner) が transfer/approve"
  raw="$(call_with_creds owner POST "/api/v1/epp/domains/${domain}/transfer/approve" "")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[A] approve 失敗 HTTP:${status}"; return 1; }
  local app_status app_gain app_lose
  app_status="$(json_get "$resp" 'resData.status')"
  app_gain="$(json_get "$resp" 'resData.gainingRegistrar')"
  app_lose="$(json_get "$resp" 'resData.losingRegistrar')"
  info "  transfer.status     = ${app_status}"
  info "  gainingRegistrar    = ${app_gain}"
  info "  losingRegistrar     = ${app_lose}"
  [ "$app_status" = "serverApproved" ] || [ "$app_status" = "clientApproved" ] || { scenario_fail "[A] approve 応答 status が承認系でない (${app_status})"; return 1; }
  [ "$app_gain" = "${GAINING_KS_REG}" ] || { scenario_fail "[A] gainingRegistrar が teama (${GAINING_KS_REG}) でない (${app_gain})"; return 1; }
  [ "$app_lose" = "${OWNER_KS_REG}" ]  || { scenario_fail "[A] losingRegistrar が teama-2 (${OWNER_KS_REG}) でない (${app_lose})"; return 1; }
  ok "[A] 承認フロー完了: 所有権 ${app_lose} → ${app_gain}"
  # 所有者が teama (gaining) に変わったので cleanup も gaining 側に付け替え
  CLEANUP_OWNER=("${CLEANUP_OWNER[@]/${domain}}")
  CLEANUP_GAINING+=("$domain")
  return 0
}

# ============================================================
# シナリオ B: 拒否フロー
# ============================================================
scenario_b() {
  step "[B] 拒否フロー: teama が request → teama-2 が reject"
  local domain="tr-e2e-rev-b-${STAMP}-${RAND}.com"
  CLEANUP_OWNER+=("$domain")

  info "[B-1] teama-2 (owner) がドメイン作成"
  local auth
  auth="$(setup_scenario_domain "$domain")" || return 1

  info "[B-2] teama (gaining) が transfer/request"
  local raw status resp
  raw="$(call_with_creds gaining POST "/api/v1/epp/domains/${domain}/transfer/request" "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status}"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[B] request 失敗 HTTP:${status}"; return 1; }

  info "[B-3] teama-2 (owner) が transfer/reject"
  raw="$(call_with_creds owner POST "/api/v1/epp/domains/${domain}/transfer/reject" "")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[B] reject 失敗 HTTP:${status}"; return 1; }
  local rej_status
  rej_status="$(json_get "$resp" 'resData.status')"
  info "  transfer.status = ${rej_status}"
  [ "$rej_status" = "clientRejected" ] || [ "$rej_status" = "serverRejected" ] || { scenario_fail "[B] reject 応答 status が拒否系でない (${rej_status})"; return 1; }
  ok "[B] 拒否フロー完了: 所有権据え置き (transfer.status=${rej_status})"
  return 0
}

# ============================================================
# シナリオ C: 取消フロー
# ============================================================
scenario_c() {
  step "[C] 取消フロー: teama が request → teama が自分で cancel"
  local domain="tr-e2e-rev-c-${STAMP}-${RAND}.com"
  CLEANUP_OWNER+=("$domain")

  info "[C-1] teama-2 (owner) がドメイン作成"
  local auth
  auth="$(setup_scenario_domain "$domain")" || return 1

  info "[C-2] teama (gaining) が transfer/request"
  local raw status resp
  raw="$(call_with_creds gaining POST "/api/v1/epp/domains/${domain}/transfer/request" "{\"op\":\"request\",\"authInfo\":\"${auth}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status}"
  [ "$status" = "202" ] || [ "$status" = "200" ] || { scenario_fail "[C] request 失敗 HTTP:${status}"; return 1; }

  info "[C-3] teama (gaining) が transfer/cancel (申請者自身が取消)"
  raw="$(call_with_creds gaining POST "/api/v1/epp/domains/${domain}/transfer/cancel" "")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 200)"
  [ "$status" = "200" ] || { scenario_fail "[C] cancel 失敗 HTTP:${status}"; return 1; }
  local can_status
  can_status="$(json_get "$resp" 'resData.status')"
  info "  transfer.status = ${can_status}"
  [ "$can_status" = "clientCancelled" ] || { scenario_fail "[C] cancel 応答 status が clientCancelled でない (${can_status})"; return 1; }
  ok "[C] 取消フロー完了: 所有権据え置き (transfer.status=${can_status})"
  return 0
}

# ============================================================
# シナリオ D: authInfo 不一致
# ============================================================
scenario_d() {
  step "[D] authInfo 不一致: teama が違う authInfo で request → 拒否される"
  local domain="tr-e2e-rev-d-${STAMP}-${RAND}.com"
  CLEANUP_OWNER+=("$domain")

  info "[D-1] teama-2 (owner) がドメイン作成"
  local auth
  auth="$(setup_scenario_domain "$domain")" || return 1

  info "[D-2] teama (gaining) が **間違った** authInfo で transfer/request"
  local raw status resp code
  raw="$(call_with_creds gaining POST "/api/v1/epp/domains/${domain}/transfer/request" "{\"op\":\"request\",\"authInfo\":\"WRONG-authInfo-${STAMP}\"}")"
  status="$(status_of "$raw")"; resp="$(body_of "$raw")"
  info "  → HTTP:${status} body(head)=$(printf '%s' "$resp" | head -c 300)"

  # 実測: レジストリの返し方に幅あり (どれでも "authInfo 不一致で拒否" の意味):
  #   - HTTP 401  (Kitaqnic 相当 / 一部の Kitaqsign モード)
  #   - HTTP 403 + result.code 2202
  #   - HTTP 202/200 + result.code 2202
  code="$(json_get "$resp" 'result.code')"
  info "  result.code = ${code}"
  if [ "$status" = "401" ]; then
    ok "[D] authInfo 不一致で HTTP 401 (Kitaqnic 相当)"
  elif [ "$status" = "403" ] && [ "$code" = "2202" ]; then
    ok "[D] authInfo 不一致で HTTP 403 + result.code 2202"
  elif { [ "$status" = "202" ] || [ "$status" = "200" ]; } && [ "$code" = "2202" ]; then
    ok "[D] authInfo 不一致で HTTP ${status} + result.code 2202 (Kitaqsign 相当)"
  else
    scenario_fail "[D] authInfo 不一致で予期せぬ HTTP:${status} + code:${code}"
    return 1
  fi

  ok "[D] authInfo 不一致フロー完了: request 段階で拒否"
  return 0
}

# ============================================================
# 実行 (シナリオごとに独立、失敗しても他を続ける)
# ============================================================
if scenario_a; then PASSED+=("A: 承認"); else FAILED+=("A: 承認"); fi
if scenario_b; then PASSED+=("B: 拒否"); else FAILED+=("B: 拒否"); fi
if scenario_c; then PASSED+=("C: 取消"); else FAILED+=("C: 取消"); fi
if scenario_d; then PASSED+=("D: authInfo 不一致"); else FAILED+=("D: authInfo 不一致"); fi

# ============================================================
# 総括
# ============================================================
printf "\n${YELLOW}=== transfer registry e2e (逆向き) サマリ ===${RESET}\n"
printf "  passed: %d\n" "${#PASSED[@]}"
for s in "${PASSED[@]:-}"; do [ -n "$s" ] && printf "    ${GREEN}✓${RESET} %s\n" "$s"; done
printf "  failed: %d\n" "${#FAILED[@]}"
for s in "${FAILED[@]:-}"; do [ -n "$s" ] && printf "    ${RED}✗${RESET} %s\n" "$s"; done

if [ ${#FAILED[@]} -gt 0 ]; then
  exit 1
fi
