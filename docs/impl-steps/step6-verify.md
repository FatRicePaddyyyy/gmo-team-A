# Step 6: 動作確認

## 目的

全エンドポイントと Queue consumer の動作を確認する。

---

## 1. 型チェック

```bash
cd apps/backend
pnpm tsc --noEmit
```

---

## 2. ローカル起動

```bash
pnpm wrangler dev
```

---

## 3. エンドポイント確認（curl）

```bash
TOKEN="your-session-token"

# check
curl -X POST http://localhost:8787/api/v1/secure/domains/check \
  -H "Cookie: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "example.com", "registry": "kitaqsign"}'

# create
curl -X POST http://localhost:8787/api/v1/secure/domains \
  -H "Cookie: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "example.com", "registry": "kitaqsign", "period": {"unit": "Y", "value": 1}}'

# info
curl http://localhost:8787/api/v1/secure/domains/{id} \
  -H "Cookie: $TOKEN"

# renew
curl -X POST http://localhost:8787/api/v1/secure/domains/{id}/renew \
  -H "Cookie: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"period": {"unit": "Y", "value": 1}}'

# delete
curl -X DELETE http://localhost:8787/api/v1/secure/domains/{id} \
  -H "Cookie: $TOKEN"

# restore
curl -X POST http://localhost:8787/api/v1/secure/domains/{id}/restore \
  -H "Cookie: $TOKEN"

# transfer request
curl -X POST http://localhost:8787/api/v1/secure/transfers \
  -H "Cookie: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "example.com", "authInfo": "s3cr3t", "registry": "kitaqsign"}'
```

---

## 4. DB確認（MCP）

```
mcp__cloudflare__d1_query(
  databaseId: "2ba676de-7422-4e9e-971f-f084f812c5fb",
  query: "SELECT * FROM domains LIMIT 10"
)

mcp__cloudflare__d1_query(
  databaseId: "2ba676de-7422-4e9e-971f-f084f812c5fb",
  query: "SELECT * FROM transfers LIMIT 10"
)
```

---

## 5. Queue確認（MCP）

```
mcp__cloudflare__queue_get("transfer-poll-queue")
```

---

## 完了条件

- [ ] `pnpm tsc --noEmit` がエラーなし
- [ ] check / create / info / renew / update / delete / restore が curl で正常レスポンス
- [ ] transfer request → 20分後に Queue consumer が発火し `transfers` / `domains` のステータスが更新されている
