# ドメインライフサイクル API 実装プラン

## Context

ハッカソン用疑似レジストラとして、Kitaqsign / Kitaqnic の EPP-over-REST API を呼ぶバックエンドを実装する。issue #10 の統合仕様に従い、check / create / info / renew / update / delete / restore / transfer 系エンドポイントと、transfer の20分遅延 Queue consumer を一括実装する。

BRIDGE 層はバックエンド内の静的クラスとして実装し、レジストリごとのホスト・Poll/Ack 差分を吸収する。

---

## アーキテクチャ方針

```
routes/domains/  ← ハンドラ（Zod + OpenAPI）
  → service.ts  ← ユースケース
    → repository.ts  ← DB操作（Drizzle）
    → lib/bridge/  ← レジストリ呼び出し（静的クラス）
```

認証: 全エンドポイントは `/api/v1/secure/*`（セッション認証）

---

## テーブル定義

### `general-schema.ts` に追加

```ts
// ドメイン
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),                          // FQDN (example.com)
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("ok"),        // ok / pendingDelete / pendingTransfer
  expiresAt: text("expires_at").notNull(),               // ISO8601
  createdAt: text("created_at").notNull(),               // ISO8601
  authInfo: text("auth_info"),                           // 移管パスフレーズ（ハッシュ不要、レジストリ側が管理）
  ownerUserId: text("owner_user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// 移管レコード（gaining側が持つ）
export const transfers = sqliteTable("transfers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domainId: text("domain_id").notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  domainName: text("domain_name").notNull(),
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("pendingTransfer"),
  // clientApproved / clientRejected / clientCancelled / serverApproved
  gainingUserId: text("gaining_user_id").notNull()
    .references(() => user.id),
  createdAt: text("created_at").notNull(),
});
```

---

## ディレクトリ構成（新規作成）

```
apps/backend/src/
├── lib/
│   └── bridge/
│       ├── index.ts          # RegistryBridge 静的クラス（レジストリ呼び出し）
│       └── types.ts          # レジストリAPI の型定義
├── routes/
│   └── domains/
│       ├── check/
│       │   ├── post.ts       # POST /api/v1/secure/domains/check
│       │   └── post.spec.ts
│       ├── create/
│       │   ├── post.ts       # POST /api/v1/secure/domains
│       │   └── post.spec.ts
│       ├── [domain-id]/
│       │   ├── get.ts        # GET  /api/v1/secure/domains/{id}
│       │   ├── renew/
│       │   │   └── post.ts   # POST /api/v1/secure/domains/{id}/renew
│       │   ├── update/
│       │   │   └── put.ts    # PUT  /api/v1/secure/domains/{id}
│       │   ├── delete/
│       │   │   └── delete.ts # DELETE /api/v1/secure/domains/{id}
│       │   └── restore/
│       │       └── post.ts   # POST /api/v1/secure/domains/{id}/restore
│       ├── service.ts        # ユースケース層（全操作）
│       ├── repository.ts     # DB操作
│       └── mapper.ts         # DB行 → APIレスポンス変換
└── routes/
    └── transfers/
        ├── post.ts           # POST /api/v1/secure/transfers（移管IN申請）
        ├── [transfer-id]/
        │   └── cancel/
        │       └── post.ts   # POST /api/v1/secure/transfers/{id}/cancel
        ├── [domain-id]/
        │   ├── approve/
        │   │   └── post.ts   # POST /api/v1/secure/domains/{id}/transfer/approve
        │   └── reject/
        │       └── post.ts   # POST /api/v1/secure/domains/{id}/transfer/reject
        ├── service.ts
        └── repository.ts
```

---

## BRIDGE 層（`src/lib/bridge/`）

### `types.ts`

レジストリAPIレスポンスの型定義:
- `EppResult` (`{ code: number; message: string }`)
- `DomainCheckResponse`
- `DomainCreateResponse`
- `DomainResponse`（info）
- `DomainRenewResponse`
- `DomainTransferResponse`

### `index.ts` — `RegistryBridge` 静的クラス

```ts
export class RegistryBridge {
  // 内部: レジストリごとのベースURL・Poll/Ack パスを解決
  private static baseUrl(registry: "kitaqsign" | "kitaqnic"): string
  private static authHeaders(env: CloudflareBindings): HeadersInit

  // ドメイン操作
  static async check(name: string, registry, env): Promise<Result<{avail: boolean}>>
  static async createContact(registry, env): Promise<Result<{contactId: string}>>
  static async create(params, env): Promise<Result<DomainCreateResponse>>
  static async info(name, registry, env): Promise<Result<DomainResponse>>
  static async renew(params, env): Promise<Result<DomainRenewResponse>>
  static async update(name, body, registry, env): Promise<Result<void>>
  static async delete(name, registry, env): Promise<Result<void>>
  static async restore(name, registry, env): Promise<Result<void>>

  // 移管
  static async transferRequest(name, authInfo, registry, env): Promise<Result<DomainTransferResponse>>
  static async transferApprove(name, registry, env): Promise<Result<void>>
  static async transferReject(name, registry, env): Promise<Result<void>>
  static async transferCancel(name, registry, env): Promise<Result<void>>

  // Poll（20分後の Queue consumer から呼ばれる）
  static async pollAndAck(registry, env): Promise<Result<PollMessage | null>>
}
```

認証ヘッダ: `Authorization: Basic ...` + `X-Registrar-Id` + `X-Api-Key` を env から取得。

Poll/Ack 差分:
- kitaqsign: `GET .../messages/poll` / `POST .../messages/{id}/ack`
- kitaqnic:  `GET .../messages`      / `DELETE .../messages/{id}`

---

## Queue（transfer 20分遅延）

### wrangler.jsonc に追加

```jsonc
"queues": {
  "producers": [{ "queue": "transfer-poll-queue", "binding": "TRANSFER_QUEUE" }],
  "consumers": [{ "queue": "transfer-poll-queue", "max_retries": 3 }]
}
```

### CloudflareBindings 追加

`TRANSFER_QUEUE: Queue` をバインディングに追加。

### `src/index.ts` に追加

```ts
export default {
  fetch: routes.fetch,
  async queue(batch: MessageBatch<TransferPollMessage>, env: CloudflareBindings) {
    // scheduled/transfer-poll/ の consumer を呼ぶ
  }
}
```

### `src/scheduled/transfer-poll/`

```
src/scheduled/transfer-poll/
├── index.ts      # queue consumer エントリ
├── service.ts    # RegistryBridge.pollAndAck → DB更新
└── repository.ts # transfers / domains の status 更新
```

consumer のロジック:
1. `RegistryBridge.pollAndAck(registry, env)` でメッセージ取得
2. `status` に応じて `transfers` と `domains` を更新
   - `serverApproved` / `clientApproved` → transfers.status 更新、domains.ownerUserId を gaining に変更
   - `clientRejected` / `clientCancelled` → transfers.status 更新、domains.status を `ok` に戻す

---

## 各エンドポイントの実装方針

### POST /api/v1/secure/domains/check
- `RegistryBridge.check(name, registry, env)`
- レスポンス: `{ name, avail, reason? }`

### POST /api/v1/secure/domains
- `RegistryBridge.createContact(registry, env)` でコンタクト作成
- `RegistryBridge.create({ domain, period, registrant, authInfo, nameservers }, env)`
- result.code === 1000 → `domains` テーブルに保存、`201 Domain` 返却

### GET /api/v1/secure/domains/{id}
- DB から保有確認（ownerUserId === userId）
- `RegistryBridge.info(name, registry, env)` で最新状態取得
- DB に status/expiresAt 差分同期 → `200 Domain` 返却

### POST /api/v1/secure/domains/{id}/renew
- DB から curExpDate 取得
- `RegistryBridge.renew({ name, curExpDate, period }, env)`
- DB の expiresAt を更新

### PUT /api/v1/secure/domains/{id}
- リクエストを add/rem/chg に変換
- `RegistryBridge.update(name, { add, rem, chg }, env)`
- result.code !== 1000 → 409

### DELETE /api/v1/secure/domains/{id}
- `RegistryBridge.delete(name, env)`
- result.code === 1000 → DB の status を `pendingDelete` に更新

### POST /api/v1/secure/domains/{id}/restore
- `RegistryBridge.restore(name, env)`
- HTTP 200 かつ result.code === 1000 → DB status を `ok` に更新
- result.code === 2304 → 409

### POST /api/v1/secure/transfers
- `RegistryBridge.transferRequest(name, authInfo, registry, env)`
- 202 受付 → `transfers` テーブルに保存
- `env.TRANSFER_QUEUE.send({ transferId, domainName, registry }, { delaySeconds: 1200 })`

### POST /api/v1/secure/domains/{id}/transfer/approve
- losing 側ユーザーの操作（自分が ownerUserId）
- `RegistryBridge.transferApprove(name, registry, env)`

### POST /api/v1/secure/domains/{id}/transfer/reject
- `RegistryBridge.transferReject(name, registry, env)`

### POST /api/v1/secure/transfers/{id}/cancel
- `RegistryBridge.transferCancel(domainName, registry, env)`
- `transfers` の status を `clientCancelled` に更新

---

## env に追加が必要なシークレット

| キー | 用途 |
|------|------|
| `REGISTRY_BASIC_USER` | Basic認証ユーザー名 |
| `REGISTRY_BASIC_PASS` | Basic認証パスワード |
| `REGISTRAR_ID` | X-Registrar-Id |
| `REGISTRY_API_KEY` | X-Api-Key |
| `KITAQSIGN_BASE_URL` | `https://epp.kitaqsign.com` |
| `KITAQNIC_BASE_URL` | `https://epp.kitaqnic.com` |

---

## 実装順序

1. **テーブル定義** — `general-schema.ts` に `domains` / `transfers` 追加 → migration生成
2. **BRIDGE層** — `src/lib/bridge/types.ts` + `src/lib/bridge/index.ts`
3. **domains routes** — check → create → info → renew → update → delete → restore の順
4. **transfers routes** — request → approve → reject → cancel
5. **Queue consumer** — `src/scheduled/transfer-poll/` + `wrangler.jsonc` 更新 + `src/index.ts` に queue handler 追加
6. **index.ts** — 全ハンドラをルート登録

---

## 確認方法

- `pnpm tsc --noEmit`（型チェック）
- ローカル: `wrangler dev` で各エンドポイントを curl で叩く
- MCP: `mcp__cloudflare__queue_create` で `transfer-poll-queue` を本番に作成
- MCP: `mcp__cloudflare__d1_query` で DB レコードを直接確認
