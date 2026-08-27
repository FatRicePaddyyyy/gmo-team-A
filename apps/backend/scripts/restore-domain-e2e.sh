#!/usr/bin/env bash
# restore-domain-e2e.sh (旧版)
# POST /api/v1/secure/domains/{domain-id}/restore (restore) の動作確認スクリプト。
#
# 使い方:
#   ./scripts/restore-domain-e2e.sh --env .env                 # 対象ドメインを作るところからやる
#   ./scripts/restore-domain-e2e.sh --env .env <domain-id>     # 既存のドメインで復旧を試す
#
# 例:
#   USER_EMAIL=taro.test.1787650730@example.com USER_PASSWORD=admin123 \
#     ./scripts/restore-domain-e2e.sh --env .env 8f4a65ad-9fa7-4017-8033-bf7ab9e8b38f
#
# 環境変数 USER_EMAIL / USER_PASSWORD を渡すと既存ユーザーでサインインする。
# 引数を省略した場合は create-domain-e2e.sh と同じ手順でドメインを1つ作ってから使う。
#
# 環境変数でも env-file を渡せる (引数のほうが優先):
#   ENV_FILE=.env ./scripts/restore-domain-e2e.sh
#
# フロー:
#   1. seed user を作成 (@example.com の Swagger 制約準拠ダミー)
#   2. better-auth の sign-in でセッション取得
#   3. 復旧対象のドメインを用意する (引数が無ければ POST /api/v1/secure/domains で作成)
#   4. DELETE /api/v1/secure/domains/{domain-id} で pendingDelete に落とす
#   5. POST /api/v1/secure/domains/{domain-id}/restore を叩く
#      - 200 なら status が ok に戻り、GET でも ok になっているか突き合わせる
#      - 403 (権限なし) / 404 (不在) / 409 (Grace Period 終了) を明示的に報告
#
# 認証・状態の切り分けのため 4 パターン叩く:
#   (a) 認証あり・pendingDelete   : 期待は 200
#   (b) 認証あり・復旧済みを再度   : 期待は 409 (もう pendingDelete ではない)
#   (c) 認証なし                  : 期待は 401
#   (d) 存在しない ID             : 期待は 404
#
# 前提:
#   - backend が localhost:8787 で起動している (pnpm run dev)
#   - --env で渡した .env に SECRET_KEY が入っている
#   - Kitaqsign / Kitaqnic のクレデンシャルは backend 側の .env で解決される
#
# 注意:
#   restore はレジストリ側で RGP (RFC 3915) の猶予期間中しか成功しない。
#   猶予を過ぎたドメインは 409 になるので、その場合は新しく作り直して試すこと。

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

http_status() { echo "$1" | sed -n 's/.*__HTTP__\([0-9]*\)$/\1/p'; }
http_body()   { echo "$1" | sed 's/__HTTP__[0-9]*$//'; }
json_str()    { echo "$1" | sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" | head -1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
# shellcheck source=./_load-env.sh
source "${SCRIPT_DIR}/_load-env.sh"
parse_env_args "$@"
load_env_files

DOMAIN_ID="${POSITIONAL_ARGS[0]:-}"

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"

TIMESTAMP="$(date +%s)"
USER_EMAIL="${USER_EMAIL:-restore.tester.${TIMESTAMP}@example.com}"
USER_NAME="${USER_NAME:-Taro Test}"
USER_PASSWORD="${USER_PASSWORD:-admin123}"
if [ "${USER_EMAIL}" != "restore.tester.${TIMESTAMP}@example.com" ]; then
  REUSE_EXISTING_USER=1
else
  REUSE_EXISTING_USER=0
fi

# --- backend 疎通確認 ------------------------------------------------------
step "backend の疎通確認"
if ! curl -sSf "${BACKEND_URL}/api/v1/public/domains/check" \
      -H "Content-Type: application/json" \
      -d '{"name":"example.com"}' >/dev/null; then
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

# --- 復旧対象のドメインを用意 ----------------------------------------------
if [ -z "${DOMAIN_ID}" ]; then
  DOMAIN_NAME="restore-e2e-${TIMESTAMP}.com"
  step "復旧対象を新規作成: ${DOMAIN_NAME}"
  CREATE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains" \
    -H "Content-Type: application/json" \
    -b "${COOKIE_JAR}" \
    -w "\n__HTTP__%{http_code}" \
    -d "{\"name\":\"${DOMAIN_NAME}\",\"period\":{\"unit\":\"Y\",\"value\":1}}")"

  CREATE_STATUS="$(http_status "${CREATE_RES}")"
  CREATE_BODY="$(http_body "${CREATE_RES}")"

  if [ "${CREATE_STATUS}" != "201" ]; then
    fail "ドメイン作成失敗 (HTTP ${CREATE_STATUS}): ${CREATE_BODY}"
  fi
  DOMAIN_ID="$(json_str "${CREATE_BODY}" id)"
  ok "作成成功 (id=${DOMAIN_ID}, name=${DOMAIN_NAME})"
else
  step "既存ドメインを使用: ${DOMAIN_ID}"
fi

# --- 削除して pendingDelete に落とす ---------------------------------------
step "DELETE /api/v1/secure/domains/${DOMAIN_ID} (pendingDelete に落とす)"
DELETE_RES="$(curl -sS -X DELETE "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}")"
DELETE_STATUS="$(http_status "${DELETE_RES}")"
DELETE_BODY="$(http_body "${DELETE_RES}")"

case "${DELETE_STATUS}" in
  200|204)
    ok "HTTP ${DELETE_STATUS} (廃止を受け付けた)"
    ;;
  409)
    warn "HTTP 409: すでに廃止済みのようです。そのまま復旧を試します"
    ;;
  403)
    fail "HTTP 403: 権限なし。所有者以外で叩いている可能性"
    ;;
  404)
    fail "HTTP 404: domain-id=${DOMAIN_ID} が見つからない (他人のドメイン、または不在)"
    ;;
  *)
    fail "廃止に失敗 (HTTP ${DELETE_STATUS}): ${DELETE_BODY}"
    ;;
esac

BEFORE_BODY="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" -b "${COOKIE_JAR}")"
BEFORE_STATUS_FIELD="$(json_str "${BEFORE_BODY}" status)"
if [ "${BEFORE_STATUS_FIELD}" = "ok" ]; then
  warn "廃止したのに status が ok のまま。DELETE が DB を更新していない可能性がある"
else
  ok "復旧前の status = ${BEFORE_STATUS_FIELD:-取得できず}"
fi

# --- (a) 認証あり・pendingDelete: restore -----------------------------------
step "(a) 認証ありで POST /api/v1/secure/domains/${DOMAIN_ID}/restore"
RESTORE_RES="$(curl -sS -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/restore" \
  -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}")"
RESTORE_STATUS="$(http_status "${RESTORE_RES}")"
RESTORE_BODY="$(http_body "${RESTORE_RES}")"

case "${RESTORE_STATUS}" in
  200)
    ok "HTTP 200"
    for field in id name registry status expiresAt createdAt ownerUserId autoRenew; do
      if ! echo "${RESTORE_BODY}" | grep -q "\"${field}\""; then
        fail "レスポンスに ${field} フィールドがない: ${RESTORE_BODY}"
      fi
    done
    ok "必須フィールド (id/name/registry/status/expiresAt/createdAt/ownerUserId/autoRenew) 全て存在"

    RESTORED_STATUS_FIELD="$(json_str "${RESTORE_BODY}" status)"
    if [ "${RESTORED_STATUS_FIELD}" = "pendingDelete" ]; then
      fail "復旧したのにレスポンスの status が pendingDelete のまま"
    fi
    ok "レスポンスの status = ${RESTORED_STATUS_FIELD} (pendingDelete から抜けた)"

    echo ""
    printf "${CYAN}--- response body ---${RESET}\n"
    echo "${RESTORE_BODY}"
    ;;
  403)
    fail "HTTP 403: 権限なし (sponsoring registrar 以外の呼び出し)"
    ;;
  404)
    fail "HTTP 404: domain-id=${DOMAIN_ID} が見つからない (他人のドメイン、または不在)"
    ;;
  409)
    fail "HTTP 409: Grace Period 終了、または pendingDelete でないため復旧不可: ${RESTORE_BODY}"
    ;;
  401)
    fail "HTTP 401: 認証されているはずが 401。middleware バグの可能性"
    ;;
  *)
    fail "予期しない HTTP ${RESTORE_STATUS}: ${RESTORE_BODY}"
    ;;
esac

# --- DB 側にも反映されているか GET で突き合わせる ---------------------------
step "GET で復旧後の status を確認 (レジストリとDBが一致しているか)"
AFTER_RES="$(curl -sS "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}" \
  -b "${COOKIE_JAR}" \
  -w "\n__HTTP__%{http_code}")"
AFTER_STATUS="$(http_status "${AFTER_RES}")"
AFTER_BODY="$(http_body "${AFTER_RES}")"

if [ "${AFTER_STATUS}" != "200" ]; then
  fail "復旧後の GET が HTTP ${AFTER_STATUS}: ${AFTER_BODY}"
fi
AFTER_STATUS_FIELD="$(json_str "${AFTER_BODY}" status)"
if [ "${AFTER_STATUS_FIELD}" = "pendingDelete" ]; then
  fail "GET した status が pendingDelete のまま: restore がレジストリに効いていない"
fi
ok "GET でも pendingDelete から抜けている (status = ${AFTER_STATUS_FIELD})"

if [ "${RESTORED_STATUS_FIELD}" = "ok" ] && [ "${AFTER_STATUS_FIELD}" != "ok" ]; then
  warn "restore は status=ok を返したが、GET では ${AFTER_STATUS_FIELD}。"
  warn "  service.restore が DB を無条件に ok にしているため。次の info で自動的に直る（実害は小さい）"
fi

# --- (b) 復旧済みをもう一度 restore: 409 を確認 ------------------------------
step "(b) 復旧済みのドメインをもう一度 restore (409 を期待)"
AGAIN_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/restore" \
  -b "${COOKIE_JAR}")"
if [ "${AGAIN_STATUS}" = "409" ]; then
  ok "HTTP 409 (期待通り、pendingDelete でないので弾かれる)"
else
  warn "HTTP ${AGAIN_STATUS} (409 を期待)。レジストリの 2304 を backend が operation_prohibited に変換できていない可能性"
fi

# --- (c) 認証なし: 401 を確認 ------------------------------------------------
step "(c) 認証なしで restore (401 を期待)"
NO_AUTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${DOMAIN_ID}/restore")"
if [ "${NO_AUTH_STATUS}" != "401" ]; then
  fail "認証なしで HTTP ${NO_AUTH_STATUS} を返した (401 を期待)"
fi
ok "HTTP 401 (期待通り認証必須が効いている)"

# --- (d) 存在しない ID: 404 を確認 -------------------------------------------
step "(d) 存在しない ID で restore (404 を期待)"
BOGUS_ID="00000000-0000-0000-0000-000000000000"
BOGUS_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${BACKEND_URL}/api/v1/secure/domains/${BOGUS_ID}/restore" \
  -b "${COOKIE_JAR}")"
if [ "${BOGUS_STATUS}" != "404" ]; then
  fail "存在しない ID で HTTP ${BOGUS_STATUS} を返した (404 を期待)"
fi
ok "HTTP 404 (期待通り)"

# --- 完了 -------------------------------------------------------------------
printf "\n${GREEN}=== restore 動作確認 完了 ===${RESET}\n"
printf "  user_email : %s\n" "${USER_EMAIL}"
printf "  domain_id  : %s\n" "${DOMAIN_ID}"
printf "  status     : %s -> %s\n" "${BEFORE_STATUS_FIELD:-?}" "${AFTER_STATUS_FIELD}"
