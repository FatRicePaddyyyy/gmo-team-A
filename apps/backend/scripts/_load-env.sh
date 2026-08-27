# _load-env.sh
# 非-transfer 系スクリプトの env 注入共通ヘルパ。
#
# 呼び出し側で `fail()` (エラーで exit 1) が定義済みであること。
#
# 使い方 (呼び出し側):
#   source "${SCRIPT_DIR}/_load-env.sh"
#   parse_env_args "$@"     # --env をパース (それ以外の引数は POSITIONAL_ARGS に残る)
#   load_env_files          # 実際に source する
#
# 呼び出し側は次の 1 変数を必ず渡す:
#   --env  <path>  … .env (SECRET_KEY, KITAQSIGN_*, KITAQNIC_* を含む)
# 環境変数からの上書きも許可 (CI 向け):
#   ENV_FILE=...
#
# 位置引数 (例: <domain-id>) は削除されずに POSITIONAL_ARGS 配列に残す。
# 呼び出し側で `set -- "${POSITIONAL_ARGS[@]}"` してから `$1` 等で使うか、
# `POSITIONAL_ARGS[0]` で参照する。

ENV_FILE="${ENV_FILE:-}"
POSITIONAL_ARGS=()

parse_env_args() {
  POSITIONAL_ARGS=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --env)
        [ $# -ge 2 ] || fail "--env に値がない"
        ENV_FILE="$2"; shift 2 ;;
      -h|--help)
        cat >&2 <<EOF
使い方: $(basename "${BASH_SOURCE[1]:-script}") --env <path> [その他の位置引数...]

  --env <path>   .env ファイル (SECRET_KEY, KITAQSIGN_*, KITAQNIC_* を含む)

環境変数 ENV_FILE でも指定可 (引数が優先)。
EOF
        exit 0 ;;
      *)
        POSITIONAL_ARGS+=("$1")
        shift ;;
    esac
  done
}

load_env_files() {
  [ -n "${ENV_FILE}" ] || fail "--env <path> を指定してください (または ENV_FILE 環境変数)"
  [ -f "${ENV_FILE}" ] || fail "--env で指定されたファイルが無い: ${ENV_FILE}"

  # .env を普通に export (SECRET_KEY, KITAQSIGN_*, KITAQNIC_* 等)
  set -a; . "${ENV_FILE}"; set +a

  # このスクリプトが直接使うのは SECRET_KEY だけだが、レジストリ関連の env は backend
  # (wrangler dev) が既に読んでいる前提なので、ここでは追加検証しない。
  [ -n "${SECRET_KEY:-}" ] || fail "${ENV_FILE} に SECRET_KEY が定義されていない"
}
