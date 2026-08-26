# scripts

`apps/backend/scripts/` の e2e スクリプト集。ローカルの backend + 実レジストリ
(Kitaqsign / Kitaqnic) を組み合わせて、ドメイン単体系フローを叩く。

移管フロー (transfer) 系は別ディレクトリ `apps/backend/scripts/transfer/` にあり、
そちらは独自の env 注入契約 (`--env` + `--env-teama2`) を持つ。
本 README は **transfer 以外** のスクリプト向け。

---

## 前提

- backend が `localhost:8787` で起動していること (`pnpm dev`)
- `apps/backend/.env` に `SECRET_KEY` と Kitaqsign / Kitaqnic のクレデンシャルがある
- D1 の local sqlite が最新 migration まで適用済み

---

## スクリプト一覧

| ファイル | 用途 |
|---|---|
| `create-domain-e2e.sh` | seed user → sign-in → POST /domains → GET /domains の一連フローを検証。`TLD` 環境変数で kitaqsign / kitaqnic を切替可能 |
| `info-domain-e2e.sh`   | GET /domains/{id} を認証あり / なし / 存在しない ID の 3 パターンで叩く |
| `renew-domain-e2e.sh`  | POST /domains/{id}/renew の 6 パターン検証 (1年延長 / 範囲外 / 更新禁止 / 認証なし / 不在) |
| `restore-domain-e2e.sh`| POST /domains/{id}/restore の 4 パターン検証 |
| `verify-fixes.sh`      | PR #32 で直した 4 件のリグレッション検知 (.com / .xyz 両方) |
| `create-domain-e2e-legacy.sh` | `create-domain-e2e.sh` の初期実装 (TLD=com 固定)。歴史的経緯で残存 |
| `info-domain-e2e-legacy.sh`   | `info-domain-e2e.sh` の初期実装 (レスポンスフィールド検査が旧セット) |
| `mock-registry.mjs`    | ローカル用モックレジストリ (node で起動、env 注入対象外) |
| `_load-env.sh`         | 上記スクリプトが共通で `source` する env 注入ヘルパ (直接実行不可) |

---

## 実行方法

env-file は必ず引数で渡す (スクリプト内で自動読み込みしない):

```bash
cd apps/backend
# 別ターミナルで backend を起動
pnpm dev

# 現行版
./scripts/create-domain-e2e.sh --env .env
./scripts/info-domain-e2e.sh   --env .env <domain-id>

# TLD を kitaqnic 系に切替
TLD=xyz ./scripts/create-domain-e2e.sh --env .env

# 旧版 (legacy 名で同じ場所に置いてある)
./scripts/create-domain-e2e-legacy.sh --env .env
./scripts/info-domain-e2e-legacy.sh   --env .env <domain-id>

# renew / restore / verify-fixes
./scripts/renew-domain-e2e.sh   --env .env
./scripts/restore-domain-e2e.sh --env .env
./scripts/verify-fixes.sh       --env .env
```

環境変数でも渡せる (引数のほうが優先):

```bash
ENV_FILE=.env ./scripts/create-domain-e2e.sh
ENV_FILE=.env ./scripts/info-domain-e2e.sh <domain-id>
```

### env-file の中身

`--env` で指定するファイルに必要なキー:

- `SECRET_KEY` … `/api/v1/secret/create-seed-user` を叩くための Bearer key

Kitaqsign / Kitaqnic のクレデンシャル (`KITAQSIGN_*`, `KITAQNIC_*`) は backend
(`wrangler dev`) 側の `.env` で解決されるので、スクリプトからは直接参照しない。

---

## 設計方針

### なぜ env 注入をスクリプト外に出したか

以前は `SECRET_KEY="${SECRET_KEY:-becd7db1d8ce68758ccdf404014f1252}"` のような
**hardcoded default** をスクリプト内に持っていた。これは:

- 未設定時に silent に本番 secret を偶然使う事故を招く
- git 履歴に secret が残る
- CI / 他人の環境で挙動が変わる原因になる

現在は `_load-env.sh` で env-file を明示 source し、必要キーが無ければ **早期 fail** する。
`fail()` は呼び出し側スクリプトで定義しておく契約 (transfer/ 側と同じパターン)。

### 位置引数の扱い

`parse_env_args "$@"` は `--env <path>` だけを消費し、それ以外の引数は
`POSITIONAL_ARGS` 配列に残す。呼び出し側は `${POSITIONAL_ARGS[0]}` などで参照する。

例: `./info-domain-e2e.sh --env .env <domain-id>` → `--env .env` を消費 →
`POSITIONAL_ARGS=("<domain-id>")` が残る。

### mock-registry.mjs は対象外

`mock-registry.mjs` は Node 製の in-memory モックサーバーで、外部 env に
一切依存しない (backend の `.env` を書き換えて `KITAQSIGN_BASE_URL=http://localhost:9999`
に向ける運用)。したがって env 注入契約の対象外。

### legacy 版はなぜ残っているか

`create-domain-e2e-legacy.sh` / `info-domain-e2e-legacy.sh` は現行版の初期実装。
両者で挙動が微妙に違うケース (mapper の defensive default が効いているかの検査項目差など) を
regression 検出したいときに legacy 側も並行で叩けるように残してある。
不要になったら削除してよい。

---

## ⚠️ 注意

- **secret を script 内に書かない**。必ず `--env <path>` 経由で渡す。
- **`.env` を git に commit しない**。`.gitignore` で除外済みだが、`--env` に渡す前に
  `git check-ignore apps/backend/.env` で確認しておくと安全。
- 実レジストリ (Kitaqsign / Kitaqnic) にテストドメインが積み上がる。定期的に整理する。
