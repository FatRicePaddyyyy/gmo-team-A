# _load-env.sh
# transfer 系スクリプトの env 注入共通ヘルパ。
#
# 呼び出し側で `fail()` (エラーで exit 1) が定義済みであること。
#
# 使い方 (呼び出し側):
#   source "${SCRIPT_DIR}/_load-env.sh"
#   parse_env_args "$@"     # --env / --env-teama2 をパース
#   load_env_files          # 実際に source する
#
# 呼び出し側は次の 3 変数を必ず渡す:
#   --env         <path>  … teama 用 (.env)
#   --env-teama2  <path>  … teama-2 用 (.env.teama2)
# 環境変数からの上書きも許可 (CI 向け):
#   ENV_FILE=..., ENV_FILE_TEAMA2=...

ENV_FILE="${ENV_FILE:-}"
ENV_FILE_TEAMA2="${ENV_FILE_TEAMA2:-}"

parse_env_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --env)
        [ $# -ge 2 ] || fail "--env に値がない"
        ENV_FILE="$2"; shift 2 ;;
      --env-teama2)
        [ $# -ge 2 ] || fail "--env-teama2 に値がない"
        ENV_FILE_TEAMA2="$2"; shift 2 ;;
      -h|--help)
        cat >&2 <<EOF
使い方: $(basename "${BASH_SOURCE[1]:-script}") --env <path> --env-teama2 <path>

  --env <path>          teama 用の .env ファイル (SECRET_KEY, KITAQSIGN_*, KITAQNIC_* を含む)
  --env-teama2 <path>   teama-2 用の .env.teama2 ファイル (KITAQSIGN_*, KITAQNIC_* を含む)

環境変数 ENV_FILE / ENV_FILE_TEAMA2 でも指定可 (引数が優先)。
EOF
        exit 0 ;;
      *)
        fail "未知の引数: $1 (使い方: --help)" ;;
    esac
  done
}

load_env_files() {
  [ -n "${ENV_FILE}"        ] || fail "--env <path> を指定してください (または ENV_FILE 環境変数)"
  [ -n "${ENV_FILE_TEAMA2}" ] || fail "--env-teama2 <path> を指定してください (または ENV_FILE_TEAMA2 環境変数)"
  [ -f "${ENV_FILE}"        ] || fail "--env で指定されたファイルが無い: ${ENV_FILE}"
  [ -f "${ENV_FILE_TEAMA2}" ] || fail "--env-teama2 で指定されたファイルが無い: ${ENV_FILE_TEAMA2}"

  # teama 用は普通に export (KITAQSIGN_*, KITAQNIC_*, SECRET_KEY など)
  set -a; . "${ENV_FILE}"; set +a

  # teama-2 用は同名キーを持つので、上書きしないように別プロセスで読んで T2_ prefix を付けて export
  local line key val
  while IFS= read -r line; do
    # 空行 / コメント / 継続行 / 明らかにキー=値でない行はスキップ
    case "$line" in
      ''|'#'*|' '*) continue ;;
    esac
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    # 前後の空白と export 接頭辞を除去
    key="${key# }"; key="${key% }"; key="${key#export }"
    # 引用符を剥がす (シンプルに先頭末尾の " または ' だけ)
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    # T2_ prefix で export
    export "T2_${key}=${val}"
  done < "${ENV_FILE_TEAMA2}"
}
