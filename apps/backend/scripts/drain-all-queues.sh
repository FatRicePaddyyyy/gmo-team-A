#!/usr/bin/env bash
# drain-all-queues.sh
# 4 系統 (teama × kitaqsign/kitaqnic, teama-2 × kitaqsign/kitaqnic) の
# レジストリキューを空になるまで drain する。手動テストの前に流して
# HoL blocking や前回テストの残骸を消し込むための道具。
#
# 使い方:
#   ./scripts/drain-all-queues.sh --env .env --env-teama2 .env.teama2
#
# 環境変数でも渡せる (引数のほうが優先):
#   ENV_FILE=.env ENV_FILE_TEAMA2=.env.teama2 ./scripts/drain-all-queues.sh
#
# 前提:
#   - .env       に teama 用の KITAQSIGN_*, KITAQNIC_* が入っている
#   - .env.teama2 に teama-2 用の KITAQSIGN_*, KITAQNIC_* が入っている
#   - registry のエンドポイント差 (poll/ack のパスと HTTP method) を吸収する
#     - kitaqsign: GET  /messages/poll   +  POST   /messages/{id}/ack
#     - kitaqnic : GET  /messages        +  DELETE /messages/{id}
#
# 出力:
#   各系統について「id / op / domain / ack ステータス」を 1 行ずつ表示し、
#   最後に drained 件数を出す。並列は不可 (キューは registrar 単位で 1 本)。

set -uo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

step() { printf "\n${YELLOW}==> %s${RESET}\n" "$*"; }
info() { printf "${CYAN}  %s${RESET}\n" "$*"; }
ok()   { printf "${GREEN}✓${RESET} %s\n" "$*"; }
fail() { printf "${RED}✗ %s${RESET}\n" "$*" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

# transfer/ の env-loader を再利用 (teama を素で export、teama-2 を T2_ prefix で export)
# shellcheck source=./transfer/_load-env.sh
source "${SCRIPT_DIR}/transfer/_load-env.sh"
parse_env_args "$@"
load_env_files

# 上限 (無限ループ防止)。1 系統あたり最大この件数まで drain する。
MAX_ITERATIONS="${MAX_ITERATIONS:-200}"

# キュー 1 本を drain する汎用関数。
# args:
#   $1 label            ログ用ラベル
#   $2 base_url         レジストリベース URL
#   $3 poll_path        GET する poll パス
#   $4 ack_method       ack HTTP メソッド (POST or DELETE)
#   $5 ack_path_fmt     ack パステンプレ ("%s" が msg id に置き換わる)
#   $6 user
#   $7 pass
#   $8 registrar_id
#   $9 api_key
drain_queue() {
  local label="$1" base="$2" poll_path="$3" ack_method="$4" ack_fmt="$5"
  local u="$6" p="$7" r="$8" a="$9"
  local drained=0

  for _ in $(seq 1 "$MAX_ITERATIONS"); do
    local resp msg_id op dom
    resp=$(curl -sS --max-time 10 -u "$u:$p" \
      -H "X-Registrar-Id: $r" -H "X-Api-Key: $a" \
      "${base}${poll_path}" || echo "")

    msg_id=$(python3 -c '
import sys, json
try:
  d = json.loads(sys.argv[1])
  m = (d.get("resData") or {}).get("message")
  print(m["id"] if m else "")
except Exception:
  print("")
' "$resp")
    if [ -z "$msg_id" ]; then
      info "[$label] drained=$drained (queue empty)"
      return
    fi

    op=$(python3 -c '
import sys, json
try:
  print((((json.loads(sys.argv[1]).get("resData") or {}).get("message") or {}).get("payload") or {}).get("op", ""))
except Exception:
  print("")
' "$resp")
    dom=$(python3 -c '
import sys, json
try:
  print((((json.loads(sys.argv[1]).get("resData") or {}).get("message") or {}).get("payload") or {}).get("domain", ""))
except Exception:
  print("")
' "$resp")

    local ack_path ack_status
    # shellcheck disable=SC2059  # ack_fmt に %s を埋める意図
    ack_path=$(printf "$ack_fmt" "$msg_id")
    ack_status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 -X "$ack_method" \
      -u "$u:$p" -H "X-Registrar-Id: $r" -H "X-Api-Key: $a" \
      "${base}${ack_path}")

    drained=$((drained+1))
    info "[$label] id=$msg_id op=$op domain=$dom ack=$ack_status"

    # ack 失敗を検知したら中断 (キュー先頭が動かないので何度回しても drain されない)
    case "$ack_status" in
      2*) : ;;
      *) fail "[$label] ack failed (HTTP $ack_status). aborting drain." ;;
    esac
  done
  info "[$label] drained=$drained (hit MAX_ITERATIONS=${MAX_ITERATIONS})"
}

step "teama × kitaqsign"
drain_queue "teama/sign" "https://epp.kitaqsign.com" \
  "/api/v1/epp/messages/poll" "POST" "/api/v1/epp/messages/%s/ack" \
  "${KITAQSIGN_BASIC_USER}" "${KITAQSIGN_BASIC_PASS}" \
  "${KITAQSIGN_REGISTRAR_ID}" "${KITAQSIGN_API_KEY}"

step "teama × kitaqnic"
drain_queue "teama/nic" "https://epp.kitaqnic.com" \
  "/api/v1/epp/messages" "DELETE" "/api/v1/epp/messages/%s" \
  "${KITAQNIC_BASIC_USER}" "${KITAQNIC_BASIC_PASS}" \
  "${KITAQNIC_REGISTRAR_ID}" "${KITAQNIC_API_KEY}"

step "teama-2 × kitaqsign"
drain_queue "t2/sign" "https://epp.kitaqsign.com" \
  "/api/v1/epp/messages/poll" "POST" "/api/v1/epp/messages/%s/ack" \
  "${T2_KITAQSIGN_BASIC_USER}" "${T2_KITAQSIGN_BASIC_PASS}" \
  "${T2_KITAQSIGN_REGISTRAR_ID}" "${T2_KITAQSIGN_API_KEY}"

step "teama-2 × kitaqnic"
drain_queue "t2/nic" "https://epp.kitaqnic.com" \
  "/api/v1/epp/messages" "DELETE" "/api/v1/epp/messages/%s" \
  "${T2_KITAQNIC_BASIC_USER}" "${T2_KITAQNIC_BASIC_PASS}" \
  "${T2_KITAQNIC_REGISTRAR_ID}" "${T2_KITAQNIC_API_KEY}"

ok "全 4 系統 drain 完了"
