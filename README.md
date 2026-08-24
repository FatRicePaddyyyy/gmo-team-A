# gmo-domain

お名前.com ライクなドメイン管理サービス。pnpm workspace で `apps/frontend`（Next.js on Cloudflare Workers）と `apps/backend`（Hono + Cloudflare Workers + D1）の 2 アプリ構成。

---

## 構成

```
apps/
├── frontend/   # Next.js App Router（vinext）→ Cloudflare Workers
└── backend/    # Hono API → Cloudflare Workers + D1
```

| | ローカル | 本番 |
|--|--|--|
| フロントエンド | `http://localhost:3000` | `https://frontend-production.fatricepaddy.workers.dev` |
| バックエンド | `http://localhost:8787` | `https://backend-production.fatricepaddy.workers.dev` |

---

## セットアップ

### 必要なもの

- Node.js 24+
- pnpm 10.26.0+
- Cloudflare アカウント（デプロイ時のみ）

### インストール

```bash
git clone https://github.com/FatRicePaddyyyy/gmo-team-A.git
cd gmo-team-A
pnpm install
```

### 環境変数

**`apps/frontend/.env`** を作成:

```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8787

# E2E テスト用
E2E_TEST_EMAIL=admin@example.com
E2E_TEST_PASSWORD=admin123
```

`apps/backend` は `wrangler.jsonc` の `vars` に記載済みのためローカルでは追加設定不要。

### ローカル DB のセットアップ

```bash
# 1. D1 マイグレーション（ローカル）
pnpm --filter backend run db:migrate:local

# 2. バックエンドを起動
pnpm --filter backend run dev

# 3. シードユーザーを作成（別ターミナルで）
curl -X POST "http://localhost:8787/api/v1/secret/create-seed-user" \
  -H "Authorization: Bearer becd7db1d8ce68758ccdf404014f1252" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "name": "管理者太郎", "password": "admin123"}'
```

---

## 開発

バックエンドとフロントエンドを **別ターミナル** で起動する。

```bash
# ターミナル 1: バックエンド（localhost:8787）
pnpm --filter backend run dev

# ターミナル 2: フロントエンド（localhost:3000）
pnpm --filter frontend run dev
```

### Lint / テスト

```bash
pnpm lint                               # 全体 lint
pnpm lint:fix                           # 自動修正
pnpm --filter backend run test:run      # バックエンド ユニットテスト（一回実行）
pnpm --filter backend run test          # バックエンド ユニットテスト（watch）
```

---

## E2E テスト（Playwright）

バックエンドとフロントエンドを起動した状態で実行する。

```bash
pnpm --filter frontend run test:e2e          # ヘッドレス実行
pnpm --filter frontend run test:e2e:ui       # UI モード（デバッグ向け）
pnpm --filter frontend run test:e2e:headed   # ブラウザを表示して実行
```

テストは `apps/frontend/e2e/` に配置する。

| ディレクトリ | 役割 |
|--|--|
| `e2e/pages/` | Page Object Model（ロケーターを集約） |
| `e2e/helpers/` | 共通ヘルパー（ログイン・ログアウトなど） |
| `e2e/*.spec.ts` | テストファイル |

---

## デプロイ

### GitHub Actions（推奨）

GitHub の Actions タブから各ワークフローを手動実行する。

| ワークフロー | 用途 | 実行タイミング |
|--|--|--|
| `Migrate Production DB` | D1 マイグレーション | スキーマ変更があるとき**最初に**実行 |
| `Deploy Backend` | バックエンドのみデプロイ | マイグレーション完了後 |
| `Deploy Frontend` | フロントエンドのみデプロイ | 単独で実行可能 |

`Deploy Backend` ワークフローはデプロイ前に自動で `wrangler secret put` を実行して Workers の環境変数を最新化する。

**初回セットアップ: GitHub Secrets の登録**

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo FatRicePaddyyyy/gmo-team-A
gh secret set CLOUDFLARE_ACCOUNT_ID --repo FatRicePaddyyyy/gmo-team-A
printf '%s' "3a2e28cfe14df850c4eff9c4fd19f2e6" | gh secret set BETTER_AUTH_SECRET --repo FatRicePaddyyyy/gmo-team-A
printf '%s' "becd7db1d8ce68758ccdf404014f1252" | gh secret set SECRET_KEY --repo FatRicePaddyyyy/gmo-team-A
printf '%s' "admin@example.com" | gh secret set E2E_TEST_EMAIL --repo FatRicePaddyyyy/gmo-team-A
printf '%s' "admin123" | gh secret set E2E_TEST_PASSWORD --repo FatRicePaddyyyy/gmo-team-A
```

### 手動デプロイ

> **注意**: スキーマ変更がある場合は必ずマイグレーションを先に実行する。逆にすると新 API が存在しないテーブルを参照して落ちる。

```bash
# スキーマ変更あり（マイグレーション → デプロイ）
pnpm db:migrate:production
pnpm deploy

# コードのみ変更
pnpm deploy

# 個別にデプロイ
pnpm --filter frontend run deploy
pnpm --filter backend run deploy
```

`pnpm deploy` は pnpm 本体のコマンドと名前が被るため、スクリプトを呼ぶときは必ず `run` を付けること（例: `pnpm --filter frontend run deploy`）。

---

## Wrangler の使い方

Cloudflare Workers のローカル開発・デプロイ CLI。

### ログイン

```bash
npx wrangler login
```

### D1 データベース操作

```bash
# ローカル D1 にマイグレーション適用
pnpm --filter backend run db:migrate:local

# 本番 D1 にマイグレーション適用（--env production と --remote が必要）
pnpm db:migrate:production
# 内部では↓が実行される
# npx wrangler d1 migrations apply db-production --env production --remote

# ローカル D1 に SQL を直接実行
npx wrangler d1 execute db-local --local --command "SELECT * FROM users LIMIT 5"

# 本番 D1 に SQL を直接実行（注意して使うこと）
npx wrangler d1 execute db-production --env production --remote --command "SELECT COUNT(*) FROM users"
```

### Secrets（本番環境変数）の登録・更新

```bash
printf '%s' "your-secret-value" | npx wrangler secret put SECRET_NAME --env production

# 例: BETTER_AUTH_SECRET を更新
printf '%s' "3a2e28cfe14df850c4eff9c4fd19f2e6" | npx wrangler secret put BETTER_AUTH_SECRET --env production
```

### Cloudflare 型定義の再生成

`wrangler.jsonc` を変更した後に実行する。

```bash
pnpm --filter backend run cf-typegen
pnpm --filter frontend run cf-typegen
```

### 本番ログのリアルタイム確認

```bash
npx wrangler tail --env production --name backend-production
npx wrangler tail --env production --name frontend-production
```
