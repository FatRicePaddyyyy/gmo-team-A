# scripts/mock/

**モックレジストリ (`mock-registry.mjs`) を使う** スクリプト置き場。実レジストリでは動かないもの、または実レジストリでは再現できない挙動 (5xx 強制、`result.code` 強制) をテストするためのものだけをここに置く。

`scripts/lifecycle/` と `scripts/transfer/` 配下は実レジストリ (`https://epp.kitaqsign.com` / `https://epp.kitaqnic.com`) 向け。ここのスクリプトを追加するときは、必ず「なぜモックでないと再現できないか」を script の docstring に書くこと。

## 中身

| ファイル | 用途 |
|---|---|
| `mock-registry.mjs` | Node の HTTP サーバとして起動する簡易モック。`?forceHttp=500&forceCode=2400` などのクエリ / パスパターンで強制レスポンスを返せる。 |
| `bridge-error-map-e2e.sh` | bridge の HTTP ステータス / `result.code` → 会員 API のエラーコード写像を全パターン網羅する e2e。 |

## 使い方

```bash
# 1. モックを別ターミナルで起動 (デフォルト port 9999)
node ./scripts/mock/mock-registry.mjs

# 2. .env で両レジストリの BASE_URL を localhost:9999 に向ける
#    KITAQSIGN_BASE_URL=http://localhost:9999
#    KITAQNIC_BASE_URL=http://localhost:9999

# 3. backend を再起動
pnpm --filter backend dev

# 4. スクリプト実行
./scripts/mock/bridge-error-map-e2e.sh --env .env
```

終わったら `.env` を実レジストリ向けに戻して backend を再起動する。
