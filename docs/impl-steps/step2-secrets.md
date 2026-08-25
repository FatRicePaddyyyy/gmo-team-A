# Step 2: シークレット設定

## 目的

BRIDGE 層がレジストリを呼ぶために必要な認証情報を、実装開始前に設定する。
ここを済ませておくことで、Step 3 以降の実装中にすぐ動作確認できる。

---

## 設定が必要な値

レジストリごとに認証情報が異なるため、それぞれ別々に設定する。

| キー | 種別 | 説明 |
|------|------|------|
| `KITAQSIGN_BASIC_USER` | secret（機密） | Kitaqsign Basic認証ユーザー名 |
| `KITAQSIGN_BASIC_PASS` | secret（機密） | Kitaqsign Basic認証パスワード |
| `KITAQSIGN_REGISTRAR_ID` | secret（機密） | Kitaqsign X-Registrar-Id ヘッダ値 |
| `KITAQSIGN_API_KEY` | secret（機密） | Kitaqsign X-Api-Key ヘッダ値 |
| `KITAQNIC_BASIC_USER` | secret（機密） | Kitaqnic Basic認証ユーザー名 |
| `KITAQNIC_BASIC_PASS` | secret（機密） | Kitaqnic Basic認証パスワード |
| `KITAQNIC_REGISTRAR_ID` | secret（機密） | Kitaqnic X-Registrar-Id ヘッダ値 |
| `KITAQNIC_API_KEY` | secret（機密） | Kitaqnic X-Api-Key ヘッダ値 |
| `KITAQSIGN_BASE_URL` | vars（非機密） | `https://epp.kitaqsign.com` |
| `KITAQNIC_BASE_URL` | vars（非機密） | `https://epp.kitaqnic.com` |

---

## 1. wrangler.jsonc の vars に非機密URLを追加

```jsonc
// ローカル
"vars": {
  // ...既存...
  "KITAQSIGN_BASE_URL": "https://epp.kitaqsign.com",
  "KITAQNIC_BASE_URL": "https://epp.kitaqnic.com"
},

// production 環境
"env": {
  "production": {
    "vars": {
      // ...既存...
      "KITAQSIGN_BASE_URL": "https://epp.kitaqsign.com",
      "KITAQNIC_BASE_URL": "https://epp.kitaqnic.com"
    }
  }
}
```

---

## 2. ローカル開発用 .env に機密値を追加

`apps/backend/.env` に追記（git 管理外）:

```
KITAQSIGN_BASIC_USER=your-kitaqsign-user
KITAQSIGN_BASIC_PASS=your-kitaqsign-pass
KITAQSIGN_REGISTRAR_ID=your-kitaqsign-registrar-id
KITAQSIGN_API_KEY=your-kitaqsign-api-key

KITAQNIC_BASIC_USER=your-kitaqnic-user
KITAQNIC_BASIC_PASS=your-kitaqnic-pass
KITAQNIC_REGISTRAR_ID=your-kitaqnic-registrar-id
KITAQNIC_API_KEY=your-kitaqnic-api-key
```

---

## 3. 型ファイルを再生成（必須）

wrangler.jsonc と .env を変更したら必ず実行する。
`worker-configuration.d.ts` が更新され、`CloudflareBindings` 型に新しい変数が追加される。

```bash
cd apps/backend
npx wrangler types --env-interface CloudflareBindings
```

実行後、`worker-configuration.d.ts` の `Env` に以下が追加されていることを確認:

```ts
interface Env {
  // ...既存...
  KITAQSIGN_BASE_URL: string;
  KITAQNIC_BASE_URL: string;
  REGISTRY_BASIC_USER: string;
  REGISTRY_BASIC_PASS: string;
  REGISTRAR_ID: string;
  REGISTRY_API_KEY: string;
}
```

---

## 4. 本番シークレット登録

```bash
cd apps/backend
wrangler secret put KITAQSIGN_BASIC_USER --env production
wrangler secret put KITAQSIGN_BASIC_PASS --env production
wrangler secret put KITAQSIGN_REGISTRAR_ID --env production
wrangler secret put KITAQSIGN_API_KEY --env production
wrangler secret put KITAQNIC_BASIC_USER --env production
wrangler secret put KITAQNIC_BASIC_PASS --env production
wrangler secret put KITAQNIC_REGISTRAR_ID --env production
wrangler secret put KITAQNIC_API_KEY --env production
```

または Cloudflare MCP で:

```
mcp__cloudflare__secret_put(workerName: "backend-production", secretName: "KITAQSIGN_BASIC_USER", ...)
```

---

## 5. GitHub Actions のワークフローを更新

`.github/workflows/production_deploy_api.yml` の `env` と `preCommands` に追加:

```yaml
env:
  # ...既存...
  KITAQSIGN_BASIC_USER: ${{ secrets.KITAQSIGN_BASIC_USER }}
  KITAQSIGN_BASIC_PASS: ${{ secrets.KITAQSIGN_BASIC_PASS }}
  KITAQSIGN_REGISTRAR_ID: ${{ secrets.KITAQSIGN_REGISTRAR_ID }}
  KITAQSIGN_API_KEY: ${{ secrets.KITAQSIGN_API_KEY }}
  KITAQNIC_BASIC_USER: ${{ secrets.KITAQNIC_BASIC_USER }}
  KITAQNIC_BASIC_PASS: ${{ secrets.KITAQNIC_BASIC_PASS }}
  KITAQNIC_REGISTRAR_ID: ${{ secrets.KITAQNIC_REGISTRAR_ID }}
  KITAQNIC_API_KEY: ${{ secrets.KITAQNIC_API_KEY }}

# preCommands に追加:
preCommands: |
  printf '%s' "${{ env.BETTER_AUTH_SECRET }}" | npx wrangler secret put BETTER_AUTH_SECRET --env production
  printf '%s' "${{ env.SECRET_KEY }}" | npx wrangler secret put SECRET_KEY --env production
  printf '%s' "${{ env.KITAQSIGN_BASIC_USER }}" | npx wrangler secret put KITAQSIGN_BASIC_USER --env production
  printf '%s' "${{ env.KITAQSIGN_BASIC_PASS }}" | npx wrangler secret put KITAQSIGN_BASIC_PASS --env production
  printf '%s' "${{ env.KITAQSIGN_REGISTRAR_ID }}" | npx wrangler secret put KITAQSIGN_REGISTRAR_ID --env production
  printf '%s' "${{ env.KITAQSIGN_API_KEY }}" | npx wrangler secret put KITAQSIGN_API_KEY --env production
  printf '%s' "${{ env.KITAQNIC_BASIC_USER }}" | npx wrangler secret put KITAQNIC_BASIC_USER --env production
  printf '%s' "${{ env.KITAQNIC_BASIC_PASS }}" | npx wrangler secret put KITAQNIC_BASIC_PASS --env production
  printf '%s' "${{ env.KITAQNIC_REGISTRAR_ID }}" | npx wrangler secret put KITAQNIC_REGISTRAR_ID --env production
  printf '%s' "${{ env.KITAQNIC_API_KEY }}" | npx wrangler secret put KITAQNIC_API_KEY --env production
```

あわせて GitHub の Settings → Secrets and variables → Actions に8つのシークレットを登録する。

---

## フロントエンドへの影響

**なし。** フロントエンドが参照するのは `NEXT_PUBLIC_BACKEND_URL`（GitHub Actions の env に直書き）のみ。
今回追加するシークレットはバックエンドがレジストリを呼ぶためのもので、フロントエンドは完全に無関係。

---

## 完了条件

- [ ] `wrangler.jsonc` の `vars` に `KITAQSIGN_BASE_URL` / `KITAQNIC_BASE_URL` が追加されている
- [ ] `apps/backend/.env` に4つのシークレットが設定されている
- [ ] `npx wrangler types --env-interface CloudflareBindings` を実行し `worker-configuration.d.ts` が更新されている
- [ ] 本番 Worker（`backend-production`）に4つのシークレットが登録されている
- [ ] GitHub Actions のワークフローと GitHub Secrets が更新されている
- [ ] `pnpm tsc --noEmit`（バックエンド）で型エラーなし
- [ ] `pnpm tsc --noEmit`（フロントエンド）で型エラーなし（`tsconfig.json` が `../backend/worker-configuration.d.ts` を参照しているため、バックエンドの型変更が自動反映される）
