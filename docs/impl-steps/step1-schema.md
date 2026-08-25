# Step 1: テーブル定義 & マイグレーション

## 目的

`domains` と `transfers` テーブルを追加し、DBスキーマを確定させる。
後続のすべてのステップはこのスキーマに依存するため最初に完了させる。

---

## 作業ファイル

- `apps/backend/src/lib/schema/general-schema.ts` — テーブル定義追加
- `apps/backend/drizzle/` — マイグレーションSQL（自動生成）

---

## 追加するテーブル

### `domains`

```ts
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),    // FQDN (example.com)。重複登録防止
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("ok"),
  // ok / pendingDelete / pendingTransfer
  // clientDeleteProhibited 等はレジストリ側で管理。info で都度取得するため DB には持たない
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  authInfo: text("auth_info").notNull(),    // BRIDGE が create 時に生成。会員が確認・変更できるようキャッシュ
  ownerUserId: text("owner_user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  index("domains_owner_user_id_idx").on(table.ownerUserId), // 一覧取得で使用
]);
```

### `transfers`

```ts
export const transfers = sqliteTable("transfers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domainId: text("domain_id").notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  // restrict: pendingTransfer 中のドメインは削除不可（cascade だと Queue consumer が参照できなくなる）
  // domainName は持たない。必要なら domainId から JOIN で取得
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("pendingTransfer"),
  // pendingTransfer / clientApproved / clientRejected / clientCancelled / serverApproved
  gainingUserId: text("gaining_user_id").notNull()
    .references(() => user.id),
  // losingUserId は持たない。domains.ownerUserId が losing 相当
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
}, (table) => [
  index("transfers_domain_id_idx").on(table.domainId),         // approve/reject/Queue consumer で使用
  index("transfers_gaining_user_id_idx").on(table.gainingUserId), // cancel の権限チェックで使用
]);
```

### リレーション

```ts
export const domainsRelations = relations(domains, ({ one, many }) => ({
  owner: one(user, { fields: [domains.ownerUserId], references: [user.id] }),
  transfers: many(transfers),
}));

export const transfersRelations = relations(transfers, ({ one }) => ({
  domain: one(domains, { fields: [transfers.domainId], references: [domains.id] }),
  gainingUser: one(user, { fields: [transfers.gainingUserId], references: [user.id] }),
}));
```

---

## インポート

`general-schema.ts` の先頭に以下を追加:

```ts
import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";
```

---

## 実行コマンド

```bash
# マイグレーションSQL生成
cd apps/backend
pnpm drizzle-kit generate

# ローカルD1に適用
pnpm wrangler d1 migrations apply db-local --local

# 型チェック
pnpm tsc --noEmit
```

---

## 完了条件

- [ ] `general-schema.ts` に `domains` / `transfers` テーブルと relations が追加されている
- [ ] `drizzle/` に新しいマイグレーションSQLが生成されている
- [ ] `pnpm tsc --noEmit` がエラーなし
