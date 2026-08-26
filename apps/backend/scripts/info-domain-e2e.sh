#!/usr/bin/env bash
# info-domain-e2e.sh
# GET /api/v1/secure/domains/{domain-id} (info) の動作確認スクリプト。
#
# 使い方:
#   ./scripts/info-domain-e2e.sh --env .env <domain-id>
#
# 例:
#   ./scripts/info-domain-e2e.sh --env .env 717d7e13-1d48-4e5e-b273-aa41702c4263
#
# 環境変数 USER_EMAIL / USER_PASSWORD を渡すと既存ユーザーでサインインする。
# 例: create-domain-e2e.sh が作ったユーザーで info を叩く
#   USER_EMAIL=taro.test.1787650730@example.com USER_PASSWORD=admin123 \
#     ./scripts/info-domain-e2e.sh --env .env 8f4a65ad-9fa7-4017-8033-bf7ab9e8b38f
#
# 環境変数で env-file も渡せる (引数のほうが優先):
#   ENV_FILE=.env ./scripts/info-domain-e2e.sh <domain-id>
#
# フロー:
#   1. seed user を作成 (@example.com の Swagger 制約準拠ダミー)
#   2. better-auth の sign-in でセッション取得
#   3. GET /api/v1/secure/domains/{domain-id} を叩く
#      - 200 なら詳細フィールドの必須項目が揃っているかチェック
#      - 404 (他人のドメインまたは不在) や 401 (認証切れ) を明示的に報告
#
# 認証切り分けのため 3 パターン叩く:
#   (a) 認証あり: 期待は 200 (自分が作ったドメインなら) または 404 (他人のドメイン)
#   (b) 認証なし: 期待は 401
#   (c) 存在しない ID: 期待は 404
#
# 前提:
#   - backend が localhost:8787 で起動している (pnpm run dev)
#   - --env で渡した .env に SECRET_KEY が入っている
#   - 引数の domain-id は、認証したユーザーの所有物である必要がある。
#     所有者が違うと 404 になり (a) が失敗する。
#     自分の所有ドメインで確認したい場合は、まず create-domain-e2e.sh を実行して
#     出力された domain_id をこのスクリプトに渡す運用が想定されている。

set -euo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

step() { printf "\n${YELLOW}==> %s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn() { printf "${CYAN}!${RESET} %s\n" "$*"; }
fail() { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./_load-env.sh
source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files

# 残った位置引数から <domain-id> を取り出す
if [ "${#POSITIONAL_ARGS[@]}" -lt 1 ]; then
  echo "usage: $0 --env <path> <domain-id>" >&2
  exit 2
fi
DOMAIN_ID="${POSITIONAL_ARGS[0]}"

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

TIMESTAMP="$(date +%s)"
# USER_EMAIL / USER_PASSWORD が渡されればそれを既存ユーザーとして使う。
# 未指定なら新規に seed user を作成する。
USER_EMAIL="${USER_EMAIL:-info.tester.${TIMESTAMP}@example.com}"
USER_NAME="${USER_NAME:-Taro Test}"
USER_PASSWORD="${USER_PASSWORD:-admin123}"
# 既存ユーザーで動かすかどうか。USER_EMAIL が渡されたら既存ユーザー扱い。
if [ -n "${USER_EMAIL_ARG:-}" ] || [ "${USER_EMAIL}" != "info.tester.${TIMESTAMP}@example.com" ]; then
  REUSE_EXISTING_USER=1
else
  REUSE_EXISTING_USER=0
fi

# --- backend 疎通確認 ------------------------------------------------------
# 疎通確認は環境変数 HEALTHCHECK_TLD (default "xyz" = Kitaqnic) に合わせる。
# Kitaqsign メンテ中でも Kitaqnic 側で backend の生存確認だけ通せるようにする。
HEALTHCHECK_TLD="${HEALTHCHECK_TLD:-xyz}"
step "backend の疎通確認 (example.${HEALTHCHECK_TLD})"
if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"example.${HEALTHCHECK_TLD}\"}" >/dev/null; then
  fail "${BACKEND_URL} に接続できません。backend を起動してください (pnpm run dev)"
fi
ok "backend 応答あり"

# --- seed user 作成 (既存ユーザー指定時はスキップ) -------------------------
if [ "${REUSE_EXISTING_USER}" = "1" ]; then
  step "既存ユーザーを使用: ${USER_EMAIL} (seed user 作成をスキップ)"
else
  step "seed user を作成: ${USER_EMAIL}"
  SEED_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secret/create-seed-user" \
    -H "Authorization: Bearer ${SECRET_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${USER_EMAIL}\",\"name\":\"${USER_NAME}\",\"password\":\"${USER_PASSWORD}\"}")"

  if ! echo "${SEED_RES}" | grep -q '"success":true'; then
    fail "seed user 作成失敗: ${SEED_RES}"
  fi
  ok "作成成功"
fi

# --- サインイン ------------------------------------------------------------
step "サインインでセッション取得"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT

SIGNIN_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -c "${COOKIE_JAR}" \
  -d "{\"email\":\"${USER_EMAIL}\",\"password\":\"${USER_PASSWORD}\"}")"

if ! echo "${SIGNIN_RES}" | grep -q '"token"'; then
  fail "サインイン失敗: ${SIGNIN_RES}"
fi
ok "セッション取得完了"

# --- (a) 認証あり: GET /domains/{id} ----------------------------------------
step "(a) 認証ありで GET /api/v1/secure/domains/${DOMAIN_ID}"
INFO_RES="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}")"
INFO_STATUS="$(echo "${INFO_RES}" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p')"
INFO_BODY="$(echo "${INFO_RES}" | sed 's/__HTTP__[0-9]*$//')"

case "${INFO_STATUS}" in
  200)
    ok "HTTP 200"
    # 必須フィールドが揃っているか確認 (mapper の defensive default が効いているか)
    for field in id name registry status expiresAt createdAt ownerUserId autoRenew statuses registrant contacts nameservers rgpStatus upDate trDate; do
      if ! echo "${INFO_BODY}" | grep -q "\"${field}\""; then
        fail "レスポンスに ${field} フィールドがない: ${INFO_BODY}"
      fi
    done
    ok "必須フィールド (statuses/registrant/contacts/nameservers/rgpStatus/upDate/trDate) 全て存在"

    # exDate が Invalid Date になっていないか確認 (isNaN チェックが効いているか)
    EXP="$(echo "${INFO_BODY}" | sed -n 's/.*"expiresAt":"\([^"]*\)".*/\1/p')"
    if [ -z "${EXP}" ] || [ "${EXP}" = "Invalid Date" ]; then
      fail "expiresAt が不正: ${EXP}"
    fi
    ok "expiresAt = ${EXP} (有効な日時)"

    echo ""
    printf "${CYAN}--- response body ---${RESET}\n"
    echo "${INFO_BODY}"
    ;;
  404)
    warn "HTTP 404: このユーザーは domain-id=${DOMAIN_ID} を所有していない (認証されているが 認可 で弾かれた)"
    warn "自分が作ったドメインで確認するには先に create-domain-e2e.sh で作成した ID を渡してください"
    ;;
  401)
    fail "HTTP 401: 認証されているはずが 401。middleware バグの可能性"
    ;;
  *)
    fail "予期しない HTTP ${INFO_STATUS}: ${INFO_BODY}"
    ;;
esac

# --- (b) 認証なし: 401 を確認 ------------------------------------------------
step "(b) 認証なしで GET (401 を期待)"
NO_AUTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}")"
if [ "${NO_AUTH_STATUS}" != "401" ]; then
  fail "認証なしで HTTP ${NO_AUTH_STATUS} を返した (401 を期待)"
fi
ok "HTTP 401 (期待通り認証必須が効いている)"

# --- (c) 存在しない ID: 404 を確認 -------------------------------------------
step "(c) 存在しない ID で GET (404 を期待)"
BOGUS_ID="00000000-0000-0000-0000-000000000000"
BOGUS_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/v1/secure/domains/${BOGUS_ID}" -b "${COOKIE_JAR}")"
if [ "${BOGUS_STATUS}" != "404" ]; then
  fail "存在しない ID で HTTP ${BOGUS_STATUS} を返した (404 を期待)"
fi
ok "HTTP 404 (期待通り)"

# --- 完了 -------------------------------------------------------------------
printf "\n${GREEN}=== info 動作確認 完了 ===${RESET}\n"
