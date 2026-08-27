# _lifecycle-helpers.sh
# lifecycle/ 配下の e2e スクリプト共通ヘルパ。
#
# 呼び出し側で先に _load-env.sh を source し、fail() / step / ok / ng が
# 定義済みであること。以下は上乗せする関数と規約:
#
#   http_status <response>   … `\n__HTTP__NNN` 末尾マーカーから status を取り出す
#   http_body   <response>   … 同じマーカーから body を取り出す
#   json_str    <body> <key> … "key":"value" の value を取り出す (最初の 1 個)
#   expect <期待HTTP> <実際HTTP> <ラベル> [レスポンス] … PASS/FAIL カウンタを進める
#
#   check_backend <TLD>      … backend の疎通確認。片側レジストリメンテ中でも通せるよう
#                              TLD を引数で受ける (kitaqsign なら com、kitaqnic なら xyz)。
#
#   seed_user_and_signin <email> <password> <name>
#     … /api/v1/secret/create-seed-user + /api/v1/auth/sign-in を叩いて Cookie JAR を張る。
#       成功時に USER_ID / COOKIE_JAR (グローバル) をセット。
#
#   create_domain <name> <period_years>
#     … POST /api/v1/secure/domains を叩き、成功時に DOMAIN_ID (グローバル) をセット。
#       COOKIE_JAR は事前にセット済みであること。
#
# 呼び出し側で PASS / FAIL カウンタを持ち、最後に集計を print + exit する。

# HTTP 応答の末尾マーカー (curl の -w "\n__HTTP__%{http_code}" と対応)
http_status() { echo "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
http_body()   { echo "$1" | sed 's/__HTTP__[0-9]*$//'; }
json_str()    { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

# expect <期待HTTP> <実際HTTP> <ラベル> [レスポンス]
#   PASS/FAIL は呼び出し側の PASS / FAIL 変数をインクリメントする。
#   一時的な通信エラー (レジストリ 504 系) は note で明示する。
expect() {
  local want="$1" got="$2" label="$3" body="${4:-}"
  if [ "${want}" = "${got}" ]; then
    ok "${label}（HTTP ${got}）"
  else
    ng "${label} — 期待 ${want} / 実際 ${got}"
    [ -n "${body}" ] && note "${body}"
    case "${body}" in
      *"レジストリへの接続中に問題"*|*"レジストリから予期しない応答"*)
        note "↑ 一時的な通信エラー / fault injection の可能性。1〜2 回リトライして直るなら別問題" ;;
    esac
  fi
}

note() { printf "${CYAN:-}  %s${RESET:-}\n" "$*"; }

check_backend() {
  local tld="${1:-xyz}"
  step "backend の疎通確認 (example.${tld})"
  if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"example.${tld}\"}" >/dev/null; then
    fail "${BACKEND_URL} に接続できません。backend を起動してください (pnpm run dev)"
  fi
  ok "backend 応答あり"
}

# グローバル: USER_ID / COOKIE_JAR
USER_ID=""
COOKIE_JAR=""

seed_user_and_signin() {
  local email="$1" password="$2" name="${3:-Taro Test}"
  step "seed user を作成: ${email}"
  local seed_res
  seed_res="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
    -H "Authorization: Bearer ${SECRET_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${email}\",\"name\":\"${name}\",\"password\":\"${password}\"}")"
  if ! echo "${seed_res}" | grep -q '"success":true'; then
    fail "seed user 作成失敗: ${seed_res}"
  fi
  USER_ID="$(echo "${seed_res}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)"
  ok "作成成功 (id=${USER_ID})"

  step "サインインでセッション取得"
  COOKIE_JAR="$(mktemp)"
  trap 'rm -f "${COOKIE_JAR}"' EXIT
  local signin_res
  signin_res="$(curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
    -H "Content-Type: application/json" \
    -c "${COOKIE_JAR}" \
    -d "{\"email\":\"${email}\",\"password\":\"${password}\"}")"
  if ! echo "${signin_res}" | grep -q '"token"'; then
    fail "サインイン失敗: ${signin_res}"
  fi
  ok "セッション取得完了"
}

# create_domain <name> <period_years>
# 成功時 DOMAIN_ID をセット。失敗時 fail。
DOMAIN_ID=""
create_domain() {
  local name="$1" period="${2:-1}"
  step "ドメイン作成: ${name}"
  local res status body
  res="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
    -H "Content-Type: application/json" \
    -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"name\":\"${name}\",\"period\":{\"unit\":\"Y\",\"value\":${period}}}")"
  status="$(http_status "${res}")"
  body="$(http_body "${res}")"
  if [ "${status}" != "201" ]; then
    fail "ドメイン作成失敗 (HTTP ${status}): ${body}"
  fi
  DOMAIN_ID="$(json_str "${body}" id)"
  ok "作成成功 (id=${DOMAIN_ID}, name=${name})"
}
