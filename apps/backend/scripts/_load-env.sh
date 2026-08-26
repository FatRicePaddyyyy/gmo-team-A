#!/usr/bin/env bash
# _load-env.sh
# scripts/ 配下の E2E スクリプトが共通で使う env 読み込みヘルパー。
# 単体では実行せず、各スクリプトから source して使う。
#
#   source "${SCRIPT_DIR}/_load-env.sh"
#   parse_env_args "$@"
#   load_env_files
#
# 提供するもの:
#   parse_env_args  ... --env <path> を拾い、それ以外を POSITIONAL_ARGS に残す
#   load_env_files  ... env ファイルを読み込んで環境変数に展開し、SECRET_KEY を検証する
#   POSITIONAL_ARGS ... --env を取り除いた残りの引数 (配列)
#
# env ファイルの決め方 (上にあるものが優先):
#   1. --env <path> / --env=<path>
#   2. 環境変数 ENV_FILE
#   3. スクリプトの1つ上 (= apps/backend/.env)
#
# 既に環境変数として設定されている値は上書きしない。
# CI やワンライナーで SECRET_KEY=xxx ./scripts/... と渡すケースを壊さないため。

# 呼び出し側が set -u でも困らないよう、先に空配列で初期化しておく。
POSITIONAL_ARGS=()
ENV_FILES=()

# --env <path> / --env=<path> を取り出し、残りを POSITIONAL_ARGS に積む。
# --env は複数回渡せる (先に書いたものが優先)。
parse_env_args() {
  POSITIONAL_ARGS=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --env)
        if [ "$#" -lt 2 ]; then
          echo "--env にはパスが必要です" >&2
          exit 2
        fi
        ENV_FILES+=("$2")
        shift 2
        ;;
      --env=*)
        ENV_FILES+=("${1#--env=}")
        shift
        ;;
      --)
        shift
        while [ "$#" -gt 0 ]; do
          POSITIONAL_ARGS+=("$1")
          shift
        done
        ;;
      *)
        POSITIONAL_ARGS+=("$1")
        shift
        ;;
    esac
  done
}

# 1ファイルを読み込む。KEY=VALUE 形式のみを見る。
# - 行頭の `export ` は無視する
# - `#` で始まる行と空行は飛ばす
# - 値を囲むシングル/ダブルクォートは剥がす
# - 既に環境変数がある場合は上書きしない
_load_one_env_file() {
  local file="$1"
  [ -f "$file" ] || return 1

  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"          # 先頭の空白を落とす
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    line="${line#export }"
    case "$line" in *=*) ;; *) continue ;; esac

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"             # キー末尾の空白を落とす
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac

    # 値を囲むクォートを剥がす
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac

    # 既に設定されているものは尊重する
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
    fi
  done < "$file"
  return 0
}

# env ファイルを順に読み込み、SECRET_KEY が揃っているか確認する。
load_env_files() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

  # 明示指定 (--env / ENV_FILE) があるときは、それだけを読む。
  # 指定したのに黙って apps/backend/.env を混ぜると、
  # 「渡したファイルが効いていない」ことに気づけなくなるため。
  local candidates=() explicit=0
  if [ "${#ENV_FILES[@]}" -gt 0 ]; then
    candidates+=("${ENV_FILES[@]}")
    explicit=1
  fi
  if [ -n "${ENV_FILE:-}" ]; then
    candidates+=("${ENV_FILE}")
    explicit=1
  fi
  if [ "$explicit" = "0" ]; then
    candidates+=("${script_dir}/../.env")
  fi

  local loaded=0 missing=() f
  for f in "${candidates[@]}"; do
    if _load_one_env_file "$f"; then
      loaded=1
    else
      missing+=("$f")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "env ファイルが見つかりません: ${missing[*]}" >&2
    exit 2
  fi

  if [ "$loaded" = "0" ]; then
    echo "env ファイルが見つかりません。--env <path> で指定するか apps/backend/.env を用意してください" >&2
    exit 2
  fi

  if [ -z "${SECRET_KEY:-}" ]; then
    echo "SECRET_KEY が未設定です。--env で渡した .env に SECRET_KEY を入れてください" >&2
    exit 2
  fi
}
