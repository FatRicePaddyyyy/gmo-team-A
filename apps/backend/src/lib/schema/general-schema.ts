import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// 親：カテゴリ（id, name のみ）
export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  name: text("name").notNull(),
});

// 子：商品（id, name, categoryId のみ）
export const products = sqliteTable("products", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  name: text("name").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "no action" }),
});

// リレーション（型安全な with 用）
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));
export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}));

// ドメイン
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("ok"),
  // ok / redemptionPeriod / pendingDelete / pendingTransfer
  // redemptionPeriod は廃止後の「まだ復旧できる猶予期間」、pendingDelete は削除待ちで意味が違う
  // clientDeleteProhibited 等はレジストリ側で管理。info で都度取得するため DB には持たない
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  authInfo: text("auth_info").notNull(),
  // Issue #24: 自動更新設定。true なら期限切れ前に自動 renew する（今回はフラグのみ、自動実行は別途 Cron で実装予定）
  autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
  ownerUserId: text("owner_user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  index("domains_owner_user_id_idx").on(table.ownerUserId),
]);

// 移管レコード
export const transfers = sqliteTable("transfers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domainId: text("domain_id").notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  // restrict: pendingTransfer 中のドメインは削除不可（cascade だと Queue consumer が参照できなくなる）
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("pendingTransfer"),
  // 取り得る値:
  //   - pendingTransfer: 申請直後・poll 待ち
  //   - clientApproved:  losing 側が承認 (approve エンドポイント経由)
  //   - clientRejected:  losing 側が拒否 (reject エンドポイント経由)
  //   - clientCancelled: gaining 側が取消 (cancel エンドポイント経由)
  //   - serverApproved:  レジストリが自動承認
  //   - expired:         poll 試行が上限超過して backend が諦めた (NB-10 対応)
  gainingUserId: text("gaining_user_id").notNull()
    .references(() => user.id),
  // losingUserId は持たない。domains.ownerUserId が losing 相当
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
}, (table) => [
  index("transfers_domain_id_idx").on(table.domainId),
  index("transfers_gaining_user_id_idx").on(table.gainingUserId),
  // 同一ドメインに対して pendingTransfer が同時に 2 つ以上存在しないよう部分 UNIQUE 制約を張る。
  // SQLite の partial index で status='pendingTransfer' の行だけを対象にする。
  uniqueIndex("transfers_pending_domain_unique_idx")
    .on(table.domainId)
    .where(sql`${table.status} = 'pendingTransfer'`),
]);

export const domainsRelations = relations(domains, ({ one, many }) => ({
  owner: one(user, { fields: [domains.ownerUserId], references: [user.id] }),
  transfers: many(transfers),
}));

export const transfersRelations = relations(transfers, ({ one }) => ({
  domain: one(domains, { fields: [transfers.domainId], references: [domains.id] }),
  gainingUser: one(user, { fields: [transfers.gainingUserId], references: [user.id] }),
}));
